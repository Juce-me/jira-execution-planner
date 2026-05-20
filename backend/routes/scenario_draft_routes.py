"""Scenario Planner draft API routes."""

import json
import os
from copy import deepcopy

from flask import Blueprint, Response, g, jsonify, request, session, stream_with_context

from backend.auth.csrf import validate_csrf_token
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError
from backend.db.engine import DatabaseConfigurationError, database_storage_enabled
from backend.scenario_drafts import (
    ScenarioDraftConflict,
    ScenarioDraftLockConflict,
    ScenarioDraftNotFound,
    ScenarioDraftReloadTimeout,
    ScenarioDraftReloadUnavailable,
    ScenarioDraftValidationError,
    acquire_lock,
    append_event,
    block_writeback,
    get_active_draft,
    get_active_presence,
    get_events_page,
    get_version,
    preview_writeback,
    release_lock,
    reload_from_jira,
    rollback_to_version,
    save_draft,
    upsert_presence,
)

from . import bind_server_globals, get_jira_server


bp = Blueprint('scenario_draft_routes', __name__)

UNSAFE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}
SCENARIO_RELOAD_TIMEOUT_SECONDS = 20


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.before_request
def _require_token_bound_csrf():
    if request.method not in UNSAFE_METHODS:
        return None
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    if getattr(g, 'security_csrf_validated', False):
        return None
    if request.headers.get('X-Requested-With') != 'jira-execution-planner':
        return jsonify({
            'error': 'csrf_required',
            'message': 'A valid CSRF token is required for this request.',
        }), 403
    try:
        data = csrf_session_data_for_request()
    except AuthError as error:
        return auth_error_response(error, 401)
    except DatabaseConfigurationError:
        return _storage_error_response()
    if validate_csrf_token(session, data, request.headers.get('X-CSRF-Token')):
        return None
    return jsonify({
        'error': 'csrf_required',
        'message': 'A valid CSRF token is required for this request.',
    }), 403


@bp.before_request
def _require_db_storage_and_auth_context():
    if not database_storage_enabled():
        return _storage_error_response()
    try:
        g.auth_context = scenario_draft_request_auth_context()
    except AuthError as error:
        return auth_error_response(error, 401)
    except DatabaseConfigurationError:
        return _storage_error_response()
    return None


def _storage_error_response():
    return jsonify({
        'error': 'config_storage_unavailable',
        'message': 'Scenario drafts require database-backed configuration storage.',
    }), 503


def _error_response(code, message, status):
    return jsonify({'error': code, 'message': message}), status


def _conflict_response(error):
    return jsonify({
        'error': 'scenario_draft_conflict',
        'message': 'The scenario draft changed before this write could be saved.',
        'conflict': {
            'reason': error.reason,
            'receivedBaseDraftRevision': error.received_base_draft_revision,
            'currentDraftRevision': error.current_draft_revision,
            'currentVersionNumber': error.current_version_number,
        },
        'activeDraft': error.active_draft,
        'versions': error.versions,
        'storage': 'db',
    }), 409


def _validation_error_response(error):
    if error.code == 'jira_writeback_gate_blocked':
        return _error_response(error.code, error.message, 403)
    if error.code == 'scenario_scope_key_required':
        return _error_response('scope_key_required', error.message, 400)
    if error.code == 'scenario_overrides_invalid':
        return _error_response('invalid_scenario_overrides', error.message, 400)
    return _error_response(error.code, error.message, 400)


def _reload_timeout_response():
    return _error_response(
        'scenario_reload_timeout',
        'Scenario reload from Jira exceeded the synchronous 20-second SLA.',
        503,
    )


def scenario_draft_reload_source_loader(context, draft, timeout_seconds):
    server = globals().get('_jira_server_module') or get_jira_server()
    planner = getattr(server, 'scenario_planner', None)
    app = getattr(server, 'app', None)
    if planner is None or app is None:
        raise ScenarioDraftReloadUnavailable('scenario planner callable is not available')

    scope_payload = deepcopy(draft.get('scopePayload') or {})
    payload = _scenario_reload_payload(scope_payload)
    with app.test_request_context('/api/scenario', method='POST', json=payload):
        session['db_oauth_session'] = {'db_auth_connection_id': context.auth_connection_id}
        response = planner()

    if isinstance(response, tuple):
        flask_response, status = response[0], response[1]
    else:
        flask_response, status = response, getattr(response, 'status_code', 200)
    if int(status or 200) >= 500:
        raise ScenarioDraftReloadUnavailable('scenario planner failed during reload')
    data = flask_response.get_json() if hasattr(flask_response, 'get_json') else None
    if not isinstance(data, dict):
        raise ScenarioDraftReloadUnavailable('scenario planner returned an invalid reload source')
    return data


def _scenario_reload_payload(scope_payload):
    config = deepcopy(scope_payload.get('config') or scope_payload.get('scenarioConfig') or {})
    filters = deepcopy(scope_payload.get('filters') or {})
    if not filters:
        filters = {
            key: deepcopy(scope_payload[key])
            for key in ('sprint', 'teams', 'projects', 'epics', 'search')
            if key in scope_payload
        }
    return {'config': config, 'filters': filters}


def _not_found_response(error):
    message = str(error)
    if 'version' in message:
        return _error_response('scenario_draft_version_not_found', 'Scenario draft version not found.', 404)
    return _error_response('scenario_draft_not_found', 'Scenario draft not found.', 404)


def _request_json():
    body = request.get_json(force=True, silent=True) or {}
    return body if isinstance(body, dict) else {}


def _base_draft_revision(body):
    return body.get('baseDraftRevision')


def _display_name():
    return (
        getattr(g.auth_context, 'display_name', None)
        or getattr(g.auth_context, 'atlassian_account_id', None)
        or getattr(g.auth_context, 'stable_subject', None)
        or 'User'
    )


def _required_int(value, error_code, field_name):
    if value is None:
        raise ScenarioDraftValidationError(error_code, f'{field_name} is required')
    if isinstance(value, bool):
        raise ScenarioDraftValidationError(error_code, f'{field_name} is required')
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped or not stripped.isdigit():
            raise ScenarioDraftValidationError(error_code, f'{field_name} is required')
        parsed = int(stripped)
    else:
        raise ScenarioDraftValidationError(error_code, f'{field_name} is required')
    if parsed <= 0:
        raise ScenarioDraftValidationError(error_code, f'{field_name} is required')
    return parsed


@bp.route('/api/scenario/drafts', methods=['GET'])
def api_scenario_drafts_get():
    scope_key = request.args.get('scope_key', '').strip()
    if not scope_key:
        return _error_response('scope_key_required', 'scope_key is required', 400)
    try:
        return jsonify(get_active_draft(g.auth_context, scope_key, legacy_loader=load_scenario_overrides))
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts', methods=['POST'])
def api_scenario_drafts_post():
    body = _request_json()
    try:
        return jsonify(save_draft(
            g.auth_context,
            body.get('scope_key'),
            body.get('name'),
            body.get('overrides'),
            base_draft_revision=_base_draft_revision(body),
            scope_payload=body.get('scope'),
        ))
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftConflict as error:
        return _conflict_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/versions/<int:version_number>', methods=['GET'])
def api_scenario_draft_version_get(draft_id, version_number):
    try:
        return jsonify(get_version(g.auth_context, draft_id, version_number))
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/rollback', methods=['POST'])
def api_scenario_draft_rollback(draft_id):
    body = _request_json()
    try:
        target_version_number = _required_int(
            body.get('targetVersionNumber'),
            'target_version_required',
            'targetVersionNumber',
        )
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    try:
        base_draft_revision = _required_int(
            body.get('baseDraftRevision'),
            'base_draft_revision_required',
            'baseDraftRevision',
        )
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    try:
        return jsonify(rollback_to_version(
            g.auth_context,
            draft_id,
            target_version_number=target_version_number,
            base_draft_revision=base_draft_revision,
        ))
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except ScenarioDraftConflict as error:
        return _conflict_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/events', methods=['GET'])
def api_scenario_draft_events_get(draft_id):
    try:
        return jsonify(get_events_page(
            g.auth_context,
            draft_id,
            since_event_number=request.args.get('since'),
        ))
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/events/stream', methods=['GET'])
def api_scenario_draft_events_stream(draft_id):
    if str(os.environ.get('SCENARIO_DRAFT_SSE_ENABLED') or '').lower() != 'true':
        return _error_response('scenario_draft_sse_disabled', 'Scenario draft event streams are disabled.', 404)
    try:
        page = get_events_page(
            g.auth_context,
            draft_id,
            since_event_number=request.args.get('since'),
        )
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()

    @stream_with_context
    def stream():
        for event in page['events']:
            yield f"event: {event['eventType']}\n"
            yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"

    return Response(stream(), mimetype='text/event-stream')


@bp.route('/api/scenario/drafts/<draft_id>/presence', methods=['POST'])
def api_scenario_draft_presence_post(draft_id):
    body = _request_json()
    try:
        presence = upsert_presence(
            g.auth_context,
            draft_id,
            display_name=_display_name(),
            cursor_payload=body.get('cursorPayload'),
            mode=body.get('mode') or 'viewing',
        )
        event = append_event(
            g.auth_context,
            draft_id,
            event_type='presence.updated',
            draft_revision=None,
            payload={'presence': presence},
        )
        return jsonify({'presence': presence, 'event': event})
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/presence', methods=['GET'])
def api_scenario_draft_presence_get(draft_id):
    try:
        return jsonify({'presence': get_active_presence(g.auth_context, draft_id)})
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/locks', methods=['POST'])
def api_scenario_draft_locks_post(draft_id):
    body = _request_json()
    action = str(body.get('action') or 'acquire').strip().lower()
    try:
        if action in {'acquire', 'refresh'}:
            lock = acquire_lock(
                g.auth_context,
                draft_id,
                resource_type=body.get('resourceType'),
                resource_id=body.get('resourceId'),
                holder_display_name=_display_name(),
            )
            event = append_event(
                g.auth_context,
                draft_id,
                event_type=f'lock.{action}d' if action == 'acquire' else 'lock.refreshed',
                draft_revision=None,
                payload={'lock': lock},
            )
            return jsonify({'lock': lock, 'event': event})
        if action == 'release':
            released = release_lock(
                g.auth_context,
                draft_id,
                resource_type=body.get('resourceType'),
                resource_id=body.get('resourceId'),
            )
            if released.get('released'):
                event = append_event(
                    g.auth_context,
                    draft_id,
                    event_type='lock.released',
                    draft_revision=None,
                    payload={
                        'resourceType': body.get('resourceType'),
                        'resourceId': body.get('resourceId'),
                    },
                )
                return jsonify({'lock': released, 'event': event})
            return jsonify({'lock': released})
        raise ScenarioDraftValidationError('scenario_lock_action_invalid', 'lock action is invalid')
    except ScenarioDraftLockConflict as error:
        return jsonify({
            'error': 'scenario_draft_lock_held',
            'message': 'Scenario draft lock is held by another user.',
            'activeLock': error.active_lock,
        }), 409
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/reload-from-jira', methods=['POST'])
def api_scenario_draft_reload_from_jira_route(draft_id):
    body = _request_json()
    try:
        base_draft_revision = _required_int(
            body.get('baseDraftRevision'),
            'base_draft_revision_required',
            'baseDraftRevision',
        )
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    try:
        return jsonify(reload_from_jira(
            g.auth_context,
            draft_id,
            base_draft_revision=base_draft_revision,
            source_loader=scenario_draft_reload_source_loader,
            timeout_seconds=SCENARIO_RELOAD_TIMEOUT_SECONDS,
        ))
    except ScenarioDraftReloadTimeout:
        return _reload_timeout_response()
    except ScenarioDraftReloadUnavailable as error:
        return _error_response('scenario_reload_unavailable', str(error), 503)
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except ScenarioDraftConflict as error:
        return _conflict_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/writeback/preview', methods=['POST'])
def api_scenario_draft_writeback_preview_post(draft_id):
    try:
        return jsonify(preview_writeback(g.auth_context, draft_id))
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()


@bp.route('/api/scenario/drafts/<draft_id>/writeback', methods=['POST'])
def api_scenario_draft_writeback_post(draft_id):
    try:
        return jsonify(block_writeback(g.auth_context, draft_id))
    except ScenarioDraftValidationError as error:
        return _validation_error_response(error)
    except ScenarioDraftNotFound as error:
        return _not_found_response(error)
    except DatabaseConfigurationError:
        return _storage_error_response()
