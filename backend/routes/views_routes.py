"""Current-user saved view configuration routes."""

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request, session
from sqlalchemy import func, select

from backend.auth.csrf import validate_csrf_token
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError
from backend.config.db_repository import DbConfigRepository, ViewConfigNotFound, infer_view_type
from backend.config.view_validation import ViewPayloadValidationError, validate_user_view_payload
from backend.db import models
from backend.db.engine import DatabaseConfigurationError, session_scope

from . import bind_server_globals


bp = Blueprint("views_routes", __name__)

VALID_VIEW_TYPES = {'eng', 'epm', 'mixed'}
UNSAFE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.before_request
def _require_token_bound_csrf():
    if request.method not in UNSAFE_METHODS:
        return None
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    data = oauth_session_data()
    if validate_csrf_token(session, data, request.headers.get('X-CSRF-Token')):
        return None
    return jsonify({
        'error': 'csrf_required',
        'message': 'A valid CSRF token is required for this request.',
    }), 403


@bp.before_request
def _require_authenticated_user():
    try:
        g.auth_context = current_request_auth_context()
    except AuthError as error:
        return auth_error_response(error, 401)
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)
    return None


def _storage_error_response(_error):
    return jsonify({
        'error': 'config_storage_unavailable',
        'message': 'Saved views require database-backed configuration storage.',
    }), 503


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace('+00:00', 'Z')


def _view_response(view):
    return {
        'id': view.id,
        'viewConfigId': view.id,
        'workspaceId': view.workspace_id,
        'name': view.name,
        'viewType': view.view_type,
        'view': dict(view.payload or {}),
        'isDefault': bool(view.is_default),
        'createdAt': _iso(view.created_at),
        'updatedAt': _iso(view.updated_at),
        'archivedAt': _iso(view.archived_at),
    }


def _active_user_view_statement(context):
    return select(models.ViewConfig).where(
        models.ViewConfig.workspace_id == context.workspace_id,
        models.ViewConfig.owner_user_id == context.user_id,
        models.ViewConfig.visibility == 'private',
        models.ViewConfig.archived_at.is_(None),
    )


def _active_user_view(session_obj, context, view_id):
    statement = _active_user_view_statement(context).where(models.ViewConfig.id == view_id)
    return session_obj.execute(statement).scalars().first()


def _next_version_number(session_obj, view_id):
    statement = select(func.max(models.ViewConfigVersion.version_number)).where(
        models.ViewConfigVersion.view_config_id == view_id,
    )
    return int(session_obj.execute(statement).scalar_one() or 0) + 1


def _add_version(session_obj, view, context, payload, change_note):
    session_obj.add(models.ViewConfigVersion(
        view_config_id=view.id,
        version_number=_next_version_number(session_obj, view.id),
        payload=dict(payload),
        created_by=context.user_id,
        change_note=change_note,
    ))


def _clear_default_views(session_obj, context, exclude_view_id=None):
    statement = _active_user_view_statement(context).where(models.ViewConfig.is_default.is_(True))
    if exclude_view_id:
        statement = statement.where(models.ViewConfig.id != exclude_view_id)
    for view in session_obj.execute(statement).scalars().all():
        view.is_default = False


def _extract_view_payload(raw):
    if not isinstance(raw, dict):
        raise ValueError('request body must be a JSON object')
    payload = raw.get('view')
    if payload is None:
        payload = raw.get('payload')
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ViewPayloadValidationError(['<root>'])
    validate_user_view_payload(payload)
    view_type = str(raw.get('viewType') or infer_view_type(payload)).strip().lower()
    if view_type not in VALID_VIEW_TYPES:
        raise ValueError('viewType must be eng, epm, or mixed')
    name = str(raw.get('name') or 'Saved view').strip() or 'Saved view'
    return name[:255], view_type, payload


def _normalize_project_keys(values):
    keys = set()
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return keys
    for value in values:
        if isinstance(value, dict):
            value = value.get('key') or value.get('projectKey')
        key = str(value or '').strip().upper()
        if key:
            keys.add(key)
    return keys


def _jira_project_references(payload):
    references = set()
    if not isinstance(payload, dict):
        return references
    filters = payload.get('filters') or {}
    if isinstance(filters, dict):
        references.update(_normalize_project_keys(filters.get('projectKeys')))
    projects = payload.get('projects') or {}
    if isinstance(projects, dict):
        references.update(_normalize_project_keys(projects.get('selected')))
    return references


def _validate_jira_project_references(context, payload):
    referenced = _jira_project_references(payload)
    if not referenced:
        return None
    accessible = {
        str(project.project_key or '').strip().upper()
        for project in context.project_access
        if project.status == 'accessible'
    }
    missing = sorted(referenced - accessible)
    if missing:
        return jsonify({
            'error': 'project_access_denied',
            'message': 'Saved view references Jira projects outside the current user project-access snapshot.',
            'projectKeys': missing,
        }), 403
    return None


def _home_project_references(payload):
    references = set()
    epm = payload.get('epm') if isinstance(payload, dict) else {}
    projects = epm.get('projects') if isinstance(epm, dict) else {}
    if not isinstance(projects, dict):
        return references
    for key, row in projects.items():
        if not isinstance(row, dict):
            continue
        home_project_id = str(row.get('homeProjectId') or '').strip()
        if home_project_id:
            references.add(home_project_id)
    return references


def _home_project_catalog_ids(projects):
    ids = set()
    for project in projects or []:
        if not isinstance(project, dict):
            continue
        for key in ('homeProjectId', 'id'):
            value = str(project.get(key) or '').strip()
            if value:
                ids.add(value)
    return ids


def _validate_home_project_references(context, payload):
    referenced = _home_project_references(payload)
    if not referenced:
        return None
    epm = payload.get('epm') if isinstance(payload, dict) else {}
    scope = epm.get('scope') if isinstance(epm, dict) else {}
    projects = fetch_epm_home_projects(scope, context=context)
    missing = sorted(referenced - _home_project_catalog_ids(projects))
    if missing:
        return jsonify({
            'error': 'home_project_not_found',
            'message': 'Saved view references Home projects outside the workspace service-backed catalog.',
            'homeProjectIds': missing,
        }), 403
    return None


def _validate_view_references(context, payload):
    return (
        _validate_jira_project_references(context, payload)
        or _validate_home_project_references(context, payload)
    )


def _validation_error_response(error):
    payload = {'error': 'invalid_view_payload', 'message': str(error)}
    forbidden = getattr(error, 'forbidden_paths', None)
    if forbidden:
        payload['forbiddenPaths'] = list(forbidden)
    return jsonify(payload), 400


@bp.route('/api/me/views', methods=['GET'])
def api_me_views():
    context = g.auth_context
    try:
        with session_scope() as db_session:
            statement = _active_user_view_statement(context).order_by(
                models.ViewConfig.updated_at.desc(),
                models.ViewConfig.created_at.desc(),
            )
            return jsonify({
                'views': [_view_response(view) for view in db_session.execute(statement).scalars().all()],
            })
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)


@bp.route('/api/me/views', methods=['POST'])
def api_me_views_create():
    context = g.auth_context
    raw = request.get_json(silent=True) or {}
    try:
        name, view_type, payload = _extract_view_payload(raw)
    except (ValueError, ViewPayloadValidationError) as error:
        return _validation_error_response(error)
    invalid_response = _validate_view_references(context, payload)
    if invalid_response:
        return invalid_response

    try:
        with session_scope() as db_session:
            if bool(raw.get('isDefault')):
                _clear_default_views(db_session, context)
                db_session.flush()
            view = models.ViewConfig(
                workspace_id=context.workspace_id,
                owner_user_id=context.user_id,
                name=name,
                view_type=view_type,
                payload_version=int(payload.get('version') or 1),
                payload=payload,
                visibility='private',
                is_default=bool(raw.get('isDefault')),
            )
            db_session.add(view)
            db_session.flush()
            _add_version(db_session, view, context, payload, 'user create')
            db_session.flush()
            return jsonify({'view': _view_response(view)}), 201
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)


@bp.route('/api/me/views/<view_id>', methods=['PATCH'])
def api_me_views_patch(view_id):
    context = g.auth_context
    raw = request.get_json(silent=True) or {}
    if not isinstance(raw, dict):
        return _validation_error_response(ValueError('request body must be a JSON object'))

    try:
        with session_scope() as db_session:
            view = _active_user_view(db_session, context, view_id)
            if view is None:
                return jsonify({'error': 'view_not_found'}), 404

            payload_changed = 'view' in raw or 'payload' in raw
            if 'name' in raw:
                name = str(raw.get('name') or '').strip()
                if name:
                    view.name = name[:255]
            if payload_changed:
                try:
                    _, view_type, payload = _extract_view_payload({
                        'name': view.name,
                        'viewType': raw.get('viewType') or view.view_type,
                        'view': raw.get('view') if 'view' in raw else raw.get('payload'),
                    })
                except (ValueError, ViewPayloadValidationError) as error:
                    return _validation_error_response(error)
                invalid_response = _validate_view_references(context, payload)
                if invalid_response:
                    return invalid_response
                view.view_type = view_type
                view.payload_version = int(payload.get('version') or view.payload_version or 1)
                view.payload = payload
                _add_version(db_session, view, context, payload, 'user update')
            elif 'viewType' in raw:
                view_type = str(raw.get('viewType') or '').strip().lower()
                if view_type not in VALID_VIEW_TYPES:
                    return _validation_error_response(ValueError('viewType must be eng, epm, or mixed'))
                view.view_type = view_type

            if raw.get('archive') is True or raw.get('archived') is True:
                view.archived_at = datetime.now(timezone.utc)
                view.is_default = False
            elif 'isDefault' in raw:
                view.is_default = bool(raw.get('isDefault'))
                if view.is_default:
                    _clear_default_views(db_session, context, exclude_view_id=view.id)
            db_session.flush()
            return jsonify({'view': _view_response(view)})
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)


@bp.route('/api/me/views/default', methods=['GET'])
def api_me_views_default():
    context = g.auth_context
    try:
        return jsonify(DbConfigRepository().resolve_effective_view_config(context))
    except ViewConfigNotFound:
        return jsonify({'error': 'view_not_found'}), 404
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)
