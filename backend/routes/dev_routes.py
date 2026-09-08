"""Local-only development diagnostics."""

from __future__ import annotations

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import hashlib
import gc
import json
from pathlib import Path
import secrets
import time
import tracemalloc

from flask import Blueprint, jsonify, request, send_file
from sqlalchemy import Text, cast, select

from backend.config.shared_config import normalize_workspace_admin_payload
from backend.db import engine as db_engine
from backend.db import models
from backend.services import eng_board_measurement as measurement
from backend.services import shared_group_config
from backend.services.eng_board_measurement_runtime import (
    CAMPAIGNS, CAMPAIGN_TTL_SECONDS, SCHEMA_VERSION, STEP_TABLE,
    MeasurementRuntimeError, bind_diagnostic_transport, owner_key,
)
from . import get_jira_server


bp = Blueprint('dev_routes', __name__)
REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER_HTML = REPO_ROOT / 'runners' / 'local' / 'eng_board_measurement_runner.html'
RUNNER_JS = REPO_ROOT / 'runners' / 'local' / 'eng_board_measurement_runner.js'
PROFILE_ORDER = ('candidate_selected_sprint', 'candidate_all_work', 'candidate_team_fallback_selected_sprint')

ERROR_STATUS = {
    'invalid_measurement_scope': 400, 'measurement_sprint_required': 400,
    'measurement_group_not_found': 404, 'measurement_shared_groups_required': 409,
    'measurement_config_source_required': 409, 'measurement_board_invalid': 409,
    'measurement_project_scope_required': 409, 'measurement_components_required': 409,
    'measurement_team_scope_required': 409, 'measurement_field_config_invalid': 409,
    'measurement_sprint_invalid': 409, 'measurement_config_changed': 409,
    'measurement_membership_changed': 409, 'measurement_data_changed': 409,
    'measurement_cache_miss': 409, 'measurement_campaign_busy': 409,
    'measurement_campaign_expired': 409, 'measurement_scope_too_large': 422,
    'measurement_unrepresentative_scope': 422, 'measurement_projection_invalid': 422,
    'measurement_rate_limited': 429, 'measurement_jira_failed': 502,
    'measurement_breaker_contaminated': 502, 'config_storage_unavailable': 503,
    'measurement_memory_unavailable': 503, 'measurement_deadline_exceeded': 504,
}


@dataclass(frozen=True)
class MeasurementDashboardSnapshot:
    payload: dict
    row_id: str
    payload_version: int
    config_revision: int
    source: str = 'workspace_db'


@dataclass(frozen=True)
class MeasurementConfigSnapshot:
    dashboard: MeasurementDashboardSnapshot
    groups: shared_group_config.ExistingSharedGroupsSnapshot


def _decode_payload(raw):
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        value = {}
    return normalize_workspace_admin_payload(value if isinstance(value, dict) else {}, allow_legacy_excluded_fields=True)


def require_existing_measurement_dashboard_snapshot(context, *, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = session.execute(select(
            models.WorkspaceDashboardConfig.id,
            cast(models.WorkspaceDashboardConfig.payload, Text),
            models.WorkspaceDashboardConfig.payload_version,
            models.WorkspaceDashboardConfig.config_revision,
        ).where(models.WorkspaceDashboardConfig.workspace_id == context.workspace_id)).first()
        if row is None or int(row[3] or 0) <= 0:
            raise MeasurementRuntimeError('measurement_config_source_required')
        return MeasurementDashboardSnapshot(_decode_payload(row[1]), str(row[0]), int(row[2] or 1), int(row[3]))


def _config_snapshot(context):
    server = get_jira_server()
    try:
        groups = shared_group_config.require_existing_shared_groups_snapshot(
            context, validate_groups_config_fn=server.validate_groups_config,
        )
    except shared_group_config.SharedGroupsSnapshotRequired as error:
        raise MeasurementRuntimeError(str(error)) from error
    return MeasurementConfigSnapshot(require_existing_measurement_dashboard_snapshot(context), groups)


def _signature(snapshot):
    value = {
        'dashboard': [snapshot.dashboard.row_id, snapshot.dashboard.payload_version,
                      snapshot.dashboard.config_revision, snapshot.dashboard.payload],
        'groups': [snapshot.groups.row_id, snapshot.groups.payload_version,
                   snapshot.groups.config_revision, snapshot.groups.raw_payload],
    }
    return hashlib.sha256(measurement.canonical_bytes(value)).digest()


def _find_group(snapshot, group_id):
    requested = str(group_id or '').strip()
    for group in snapshot.groups.groups_config.get('groups') or []:
        if str(group.get('id') or '').strip() == requested:
            raw = next((row for row in snapshot.groups.raw_payload.get('groups') or []
                        if str((row or {}).get('id') or '').strip() == requested), group)
            return deepcopy(group), deepcopy(raw)
    raise MeasurementRuntimeError('measurement_group_not_found', status=404)


def _validate_group(group, raw_group, dashboard, expected):
    try:
        projects = measurement.normalize_projects((dashboard.payload.get('projects') or {}).get('selected'))
        board = measurement.normalize_measurement_board((raw_group or {}).get('board'))
    except measurement.MeasurementCoreError as error:
        raise MeasurementRuntimeError(error.code) from error
    if not {'product', 'tech'}.issubset({kind for _key, kind in projects}):
        raise MeasurementRuntimeError('measurement_project_scope_required')
    components = measurement.configured_components(group)
    teams = measurement.configured_teams(group)
    if expected == 'components' and not components:
        raise MeasurementRuntimeError('measurement_components_required')
    if expected == 'teams' and (components or not teams):
        raise MeasurementRuntimeError('measurement_team_scope_required')
    return {'projects': projects, 'board': board, 'components': components, 'teams': teams}


def _stop_context(error, step=-1):
    row = STEP_TABLE[step] if isinstance(step, int) and 0 <= step < len(STEP_TABLE) else None
    bucket = getattr(error, 'observed_bucket', 'unknown')
    observed = getattr(error, 'observed', None)
    ceilings = {'epics': measurement.MAX_EPICS, 'children': measurement.MAX_CHILDREN,
                'pages': measurement.MAX_PAGES_PER_SAMPLE, 'batches': measurement.MAX_PAGES_PER_SAMPLE,
                'url_bytes': measurement.MAX_ENCODED_REQUEST_BYTES,
                'candidate_cache_bytes': measurement.MAX_CANDIDATE_CACHE_BYTES,
                'metadata_cache_bytes': measurement.MAX_METADATA_CACHE_BYTES}
    ceiling = ceilings.get(getattr(error, 'limit', 'none'))
    if ceiling is not None and isinstance(observed, (int, float)) and not isinstance(observed, bool):
        bucket = 'zero' if observed == 0 else ('over_limit' if observed > ceiling else
                 'at_limit' if observed == ceiling else 'near_limit' if observed >= ceiling * .8 else 'below_80')
    return {
        'round': row['round'] if row else 0, 'step': step if row else -1,
        'profile': row['profile'] if row else 'none', 'phase': getattr(error, 'phase', 'preflight'),
        'limit': getattr(error, 'limit', 'none'), 'observedBucket': bucket,
        'elapsedMs': None, 'jiraAttemptCount': None, 'jiraRetryCount': None,
        'jiraRateLimitCount': None, 'jiraRetrySleepMs': None, 'jiraFailedResponseBytes': None,
        'jiraFastFailCount': None, 'oauthAttemptCount': None, 'oauthRateLimitCount': None,
    }


def _error_response(error, step=-1):
    code = getattr(error, 'code', 'measurement_jira_failed')
    return jsonify({'error': code, 'message': 'The diagnostic could not continue safely.',
                    'stopContext': _stop_context(error, step)}), getattr(error, 'status', ERROR_STATUS.get(code, 502))


@bp.route('/api/debug-fields', methods=['GET'])
def debug_fields():
    return get_jira_server().debug_fields()


@bp.route('/api/tasks-fields', methods=['GET'])
def get_tasks_fields():
    return get_jira_server().get_tasks_fields()


@bp.route('/api/dev/eng-board-measurement', methods=['GET'])
def eng_board_measurement_runner():
    return send_file(RUNNER_HTML, mimetype='text/html', conditional=False, etag=False, max_age=0)


@bp.route('/api/dev/eng-board-measurement/runner.js', methods=['GET'])
def eng_board_measurement_runner_js():
    return send_file(RUNNER_JS, mimetype='application/javascript', conditional=False, etag=False, max_age=0)


@bp.route('/api/dev/eng-board-measurement/options', methods=['GET'])
def eng_board_measurement_options():
    try:
        context = get_jira_server().current_request_auth_context()
        snapshot = _config_snapshot(context)
        groups = []
        for group in snapshot.groups.groups_config.get('groups') or []:
            eligibility = measurement.profile_eligibility(group, snapshot.dashboard.payload)
            if eligibility:
                groups.append({'id': str(group.get('id') or ''),
                               'label': str(group.get('name') or group.get('label') or ''),
                               'profileEligibility': [value for value in PROFILE_ORDER if value in eligibility]})
        return jsonify({'schemaVersion': 2, 'configSource': 'workspace_db', 'groups': groups,
                        'sprintInput': 'numeric_id'})
    except Exception as error:
        if isinstance(error, (MeasurementRuntimeError, measurement.MeasurementCoreError)):
            return _error_response(error)
        return _error_response(MeasurementRuntimeError('config_storage_unavailable', status=503))


def revalidate_measurement_campaign(campaign, context):
    fresh = _config_snapshot(context)
    if _signature(fresh) != campaign.private.get('configSignature'):
        raise MeasurementRuntimeError('measurement_config_changed', phase='config')
    current_owner = (str(context.workspace_id or ''), str(context.user_id or ''),
                     str(context.auth_connection_id or ''), str(context.browser_session_id or ''),
                     str(context.token_version or ''))
    if campaign.owner != current_owner:
        raise MeasurementRuntimeError('measurement_config_changed', phase='auth')
    return fresh


def publish_tagged_legacy(campaign, step, lane, context, publish_fn):
    """Revalidate and publish one legacy lane atomically with abort/expiry."""
    with CAMPAIGNS.publication(campaign, step):
        revalidate_measurement_campaign(campaign, context)
        result = publish_fn()
        CAMPAIGNS.mark_legacy_complete(campaign, step, lane)
        return result


def _legacy_descriptor(campaign, row):
    if row['kind'] != 'legacy':
        return None
    group = campaign.component_group
    team_ids = [str(value) for value in group.get('teamIds') or []]
    labels = group.get('teamLabels') or {}
    team_labels = [str(labels.get(team_id) or '').strip() for team_id in team_ids] if isinstance(labels, dict) else [str(value).strip() for value in labels]
    return {'groupId': str(group.get('id') or ''), 'sprintId': campaign.sprint_id,
            'teamIds': team_ids, 'teamLabels': [value for value in team_labels if value],
            'refresh': row['cacheIntent'] == 'refresh'}


@bp.route('/api/dev/eng-board-measurement/control', methods=['POST'])
def eng_board_measurement_control():
    server = get_jira_server()
    campaign = None
    step = -1
    try:
        context = server.current_request_auth_context()
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or body.get('action') not in {'begin', 'continue', 'end', 'abort'}:
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
        action = body['action']
        if action == 'begin':
            if set(body) != {'action', 'componentGroupId', 'teamGroupId', 'sprintId'}:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            snapshot = _config_snapshot(context)
            component_group, component_raw = _find_group(snapshot, body['componentGroupId'])
            team_group, team_raw = _find_group(snapshot, body['teamGroupId'])
            _validate_group(component_group, component_raw, snapshot.dashboard, 'components')
            _validate_group(team_group, team_raw, snapshot.dashboard, 'teams')
            campaign = CAMPAIGNS.begin(context, snapshot, component_group, team_group, body['sprintId'])
            try:
                with CAMPAIGNS.inflight(campaign), bind_diagnostic_transport(campaign.transport):
                    response = server.current_jira_get(f'/rest/agile/1.0/sprint/{campaign.sprint_id}',
                                                       context=context, diagnostic_transport=campaign.transport)
                    campaign.transport.budget.check('preflight')
                    if response.status_code != 200 or not isinstance(response.json(), dict):
                        raise MeasurementRuntimeError('measurement_sprint_invalid')
                final_context = server.current_request_auth_context()
                final_snapshot = _config_snapshot(final_context)
                if _signature(final_snapshot) != _signature(snapshot):
                    raise MeasurementRuntimeError('measurement_config_changed', phase='config')
                campaign.owner = owner_key(final_context)
                campaign.snapshot = final_snapshot
                campaign.private.update({
                    'configSignature': _signature(final_snapshot), 'hmacKey': secrets.token_bytes(32),
                    'candidateCache': measurement.BoundedLru(max_entries=8, max_bytes=measurement.MAX_CANDIDATE_CACHE_BYTES,
                                                             ttl_seconds=300, now_fn=time.monotonic),
                    'metadataCache': measurement.BoundedLru(max_entries=4, max_bytes=measurement.MAX_METADATA_CACHE_BYTES,
                                                            ttl_seconds=300, now_fn=time.monotonic),
                })
                CAMPAIGNS.publish_begin(campaign)
            except Exception:
                CAMPAIGNS.fail_begin(campaign)
                raise
            return jsonify({'schemaVersion': 2, 'campaignId': campaign.campaign_id, 'nextStep': 0,
                            'state': 'active', 'ttlSeconds': int(CAMPAIGN_TTL_SECONDS)})
        if action == 'abort':
            if set(body) != {'action', 'campaignId'}:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            CAMPAIGNS.abort(context, body['campaignId'])
            return jsonify({'schemaVersion': 2, 'state': 'aborted'})
        if action == 'end':
            if set(body) != {'action', 'campaignId'}:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            CAMPAIGNS.end(context, body['campaignId'])
            return jsonify({'schemaVersion': 2, 'state': 'ended'})
        if set(body) != {'action', 'phase', 'campaignId', 'step'}:
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
        step = body['step']
        if body['phase'] == 'reserve':
            campaign, row = CAMPAIGNS.reserve(context, body['campaignId'], step)
            revalidate_measurement_campaign(campaign, context)
            return jsonify({'schemaVersion': 2, 'state': 'reserved', 'step': step,
                            'legacyRequest': _legacy_descriptor(campaign, row)})
        if body['phase'] == 'finish':
            campaign = CAMPAIGNS.get(context, body['campaignId'])
            revalidate_measurement_campaign(campaign, context)
            counters, next_step = CAMPAIGNS.finish(context, body['campaignId'], step)
            return jsonify({'schemaVersion': 2, 'state': 'active', 'nextStep': next_step, 'transport': counters})
        raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
    except Exception as error:
        if isinstance(error, (MeasurementRuntimeError, measurement.MeasurementCoreError)):
            return _error_response(error, step)
        return _error_response(MeasurementRuntimeError('measurement_jira_failed', status=502), step)


def _field_id(payload, key, default=None):
    raw = payload.get(key)
    if isinstance(raw, dict):
        raw = raw.get('fieldId')
    return str(raw or default or '').strip() or None


def _jira_json(server, path, campaign, context, phase):
    response = server.current_jira_get(path, context=context, diagnostic_transport=campaign.transport)
    if response.status_code == 429:
        raise MeasurementRuntimeError('measurement_rate_limited', status=429, phase=phase)
    if response.status_code != 200:
        raise MeasurementRuntimeError('measurement_jira_failed', status=502, phase=phase)
    try:
        return response.json()
    except ValueError as error:
        raise MeasurementRuntimeError('measurement_jira_failed', status=502, phase=phase) from error


def _stage_template():
    return {key: 0.0 for key in ('config', 'cache', 'epicIndex', 'sprintMembership',
                                  'bootstrapChildren', 'remainingChildren', 'shape', 'total')}


def _candidate_metrics(campaign, row, context, *, started=None):
    server = get_jira_server()
    started = time.monotonic() if started is None else started
    stages = _stage_template()
    snapshot = revalidate_measurement_campaign(campaign, context)
    group = campaign.team_group if row['profile'] == 'candidate_team_fallback_selected_sprint' else campaign.component_group
    raw_group = next(value for value in snapshot.groups.raw_payload.get('groups') or []
                     if str(value.get('id')) == str(group.get('id')))
    scope = _validate_group(group, raw_group, snapshot.dashboard,
                            'teams' if row['profile'] == 'candidate_team_fallback_selected_sprint' else 'components')
    cache = campaign.private['candidateCache']
    metadata_cache = campaign.private['metadataCache']
    cache_key = (row['profile'], campaign.sprint_id, campaign.private['configSignature'], campaign.owner)
    if row['cacheIntent'] == 'reuse':
        cached = cache.get(cache_key)
        metadata = metadata_cache.get((campaign.owner, campaign.private['configSignature']))
        if cached is None or metadata is None:
            raise MeasurementRuntimeError('measurement_cache_miss', phase='cache')
        metrics = deepcopy(cached)
        zero_keys = ('maxPagesPerSearch', 'maxBatchesPerColumn', 'jiraLogicalRequestCount', 'jiraCatalogCallCount',
                     'jiraSearchCallCount', 'jiraPageCount', 'jiraBatchCount', 'jiraAttemptCount', 'jiraRetryCount',
                     'jiraFailureAttemptCount', 'jiraRateLimitCount', 'jiraFastFailCount', 'jiraRetrySleepMs',
                     'jiraRetryAfterMs', 'jiraResponseBytes', 'jiraFailedResponseBytes', 'oauthRefreshCount',
                     'oauthAttemptCount', 'oauthRetryCount', 'oauthRateLimitCount', 'maxBatchSize', 'maxConcurrency',
                     'maxEncodedRequestBytes')
        for key in zero_keys:
            metrics[key] = 0
        elapsed = round((time.monotonic() - started) * 1000, 1)
        metrics.update({'wallMs': None, 'serverTimingMs': None, 'indexReadyMs': elapsed,
                        'bootstrapColumnReadyMs': elapsed, 'fullReadyMs': elapsed,
                        'memoryPeakDeltaBytes': 0, 'memoryRetainedDeltaBytes': 0,
                        'candidateCacheBytes': cache.total_bytes, 'metadataCacheBytes': metadata_cache.total_bytes})
        stages['total'] = elapsed
        metrics['stageMs'] = stages
        return metrics, None, None

    metadata_key = (campaign.owner, campaign.private['configSignature'])
    metadata_cache._drop(metadata_key)
    issue_types = _jira_json(server, '/rest/api/3/issuetype', campaign, context, 'catalog')
    fields = _jira_json(server, '/rest/api/3/field', campaign, context, 'catalog')
    metadata_bundle = {'issueTypes': issue_types, 'fields': fields}
    if len(measurement.canonical_bytes(metadata_bundle)) > measurement.MAX_METADATA_CACHE_BYTES:
        raise measurement.MeasurementCoreError('measurement_scope_too_large', phase='cache',
                                               limit='metadata_cache_bytes',
                                               observed=len(measurement.canonical_bytes(metadata_bundle)))
    payload = snapshot.dashboard.payload
    type_ids = measurement.resolve_issue_type_ids(issue_types, payload.get('issueTypes'), key_present='issueTypes' in payload)
    epic_link = measurement.resolve_epic_link_field(fields)
    sprint_field = _field_id(payload, 'sprintField', 'customfield_10101')
    story_points = _field_id(payload, 'storyPointsField', 'customfield_10004')
    team_field = _field_id(payload, 'teamField', 'customfield_30101')
    project_track = _field_id(payload, 'projectTrackField', 'customfield_35024')
    delivery_owner = _field_id(payload, 'deliveryOwnerField')
    for field_id in (sprint_field, story_points, team_field, project_track):
        measurement.validate_custom_field_id(field_id)
    measurement.validate_custom_field_id(delivery_owner, optional=True)
    terminal = scope['board']['columns'][-1]['statuses']
    index_jql = measurement.build_epic_index_jql(
        scope['projects'], scope['components'] if row['profile'] != 'candidate_team_fallback_selected_sprint' else (),
        terminal, 28)
    counters = measurement.PagerCounters()

    def search(search_payload):
        response = server.current_jira_search(search_payload, context=context, diagnostic_transport=campaign.transport)
        if response.status_code == 429:
            raise MeasurementRuntimeError('measurement_rate_limited', status=429, phase='index')
        if response.status_code != 200:
            raise MeasurementRuntimeError('measurement_jira_failed', status=502, phase='index')
        return response.json()

    index_started = time.monotonic()
    epic_fields = tuple(dict.fromkeys(measurement.EPIC_FIELDS + tuple(value for value in (project_track, delivery_owner) if value)))
    epics = measurement.strict_search(search, index_jql, epic_fields, counters=counters,
                                      cancel_check=lambda: campaign.transport.budget.check('index'))
    stages['epicIndex'] = round((time.monotonic() - index_started) * 1000, 1)
    index_ready = round((time.monotonic() - started) * 1000, 1)
    if len(epics) > measurement.MAX_EPICS:
        raise measurement.MeasurementCoreError('measurement_scope_too_large', phase='index', limit='epics', observed=len(epics))
    child_fields = tuple(dict.fromkeys(measurement.CHILD_BASE_FIELDS + tuple(
        value for value in (epic_link, sprint_field, story_points, team_field, project_track, delivery_owner) if value)))
    sprint_id = None if row['profile'] == 'candidate_all_work' else campaign.sprint_id
    team_ids = scope['teams'] if row['profile'] == 'candidate_team_fallback_selected_sprint' else ()

    def child_jql(keys):
        return measurement.build_child_jql(scope['projects'], type_ids, keys, epic_link_field_id=epic_link,
                                           sprint_field_id=sprint_field, sprint_id=sprint_id,
                                           team_field_id=team_field, team_ids=team_ids)

    batches = measurement.split_epic_batches([epic['key'] for epic in epics], child_jql, child_fields)
    children = []
    child_started = time.monotonic()
    bootstrap_count = 0
    bootstrap_ready = index_ready
    if batches:
        rows = measurement.strict_search(search, child_jql(batches[0]), child_fields, counters=counters,
                                         cancel_check=lambda: campaign.transport.budget.check('bootstrap'))
        children.extend(rows)
        if len(children) > measurement.MAX_CHILDREN:
            raise measurement.MeasurementCoreError('measurement_scope_too_large', phase='bootstrap',
                                                   limit='children', observed=len(children))
        bootstrap_count = len(rows)
        stages['bootstrapChildren'] = round((time.monotonic() - child_started) * 1000, 1)
        bootstrap_ready = round((time.monotonic() - started) * 1000, 1)
    if len(batches) > 1:
        try:
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix='eng-board-measurement') as pool:
                futures = [pool.submit(measurement.strict_search, search, child_jql(batch), child_fields,
                                       counters=counters,
                                       cancel_check=lambda: campaign.transport.budget.check('remaining'))
                           for batch in batches[1:]]
                for future in as_completed(futures):
                    children.extend(future.result())
                    if len(children) > measurement.MAX_CHILDREN:
                        raise measurement.MeasurementCoreError('measurement_scope_too_large', phase='remaining',
                                                               limit='children', observed=len(children))
        except Exception:
            campaign.transport.budget.cancel()
            raise
    stages['remainingChildren'] = max(0.0, round((time.monotonic() - child_started) * 1000, 1) - stages['bootstrapChildren'])
    shape_started = time.monotonic()
    projection = measurement.project_board(epics, children, project_map=scope['projects'],
                                           columns=scope['board']['columns'], epic_link_field_id=epic_link,
                                           story_points_field_id=story_points, team_field_id=team_field,
                                           sprint_field_id=sprint_field, project_track_field_id=project_track,
                                           delivery_owner_field_id=delivery_owner)
    if sprint_id is not None:
        projection['epics'] = [epic for epic in projection['epics'] if epic['children']]
    membership = [epic['key'] for epic in projection['epics']]
    membership_digest = measurement.private_digest(campaign.private['hmacKey'], membership)
    content_digest = measurement.private_digest(campaign.private['hmacKey'], projection)
    prior = campaign.private.setdefault('baselines', {}).get(row['profile'])
    if prior is not None and prior[0] != membership_digest:
        raise MeasurementRuntimeError('measurement_membership_changed', phase='shape')
    if prior is not None and prior[1] != content_digest:
        raise MeasurementRuntimeError('measurement_data_changed', phase='shape')
    campaign.private['baselines'][row['profile']] = (membership_digest, content_digest)
    stages['shape'] = round((time.monotonic() - shape_started) * 1000, 1)
    total = round((time.monotonic() - started) * 1000, 1)
    stages['total'] = total
    classifications = [child['projectClassification'] for epic in projection['epics'] for child in epic['children']]
    transport = campaign.transport.observer.snapshot()
    metrics = {
        'wallMs': None, 'indexReadyMs': index_ready, 'bootstrapColumnReadyMs': bootstrap_ready,
        'fullReadyMs': total, 'stageMs': stages, 'serverTimingMs': None,
        'candidateEpicCount': len(epics), 'epicCount': len(projection['epics']),
        'fetchedChildCount': len(children), 'childCount': len(classifications),
        'bootstrapChildCount': bootstrap_count, 'productChildCount': classifications.count('product'),
        'techChildCount': classifications.count('tech'), 'otherChildCount': classifications.count('other'),
        'projectCount': len(scope['projects']), 'componentCount': len(scope['components']),
        'teamCount': len(scope['teams']), 'columnCount': len(scope['board']['columns']),
        'terminalEpicCount': sum(epic['columnId'] == scope['board']['columns'][-1]['id'] for epic in projection['epics']),
        'unmappedEpicCount': sum(epic['columnId'] == 'unmapped' for epic in projection['epics']),
        'emptyEpicCount': sum(not epic['children'] for epic in projection['epics']),
        'maxPagesPerSearch': counters.max_pages_per_search, 'maxBatchesPerColumn': len(batches),
        'jiraPageCount': counters.pages, 'jiraBatchCount': len(batches),
        'shapedResponseBytes': len(measurement.canonical_bytes(projection)),
        'candidateCacheBytes': 0, 'metadataCacheBytes': metadata_cache.total_bytes,
        'maxBatchSize': max((len(batch) for batch in batches), default=0),
        'maxConcurrency': min(2, max(0, len(batches) - 1)) if len(batches) > 1 else (1 if batches else 0),
        'maxEncodedRequestBytes': counters.max_encoded_request_bytes,
        'memoryPeakDeltaBytes': 0, 'memoryRetainedDeltaBytes': 0, 'metricAvailability': 'complete',
        'legacyCapped': False, 'legacyDenominator': None, 'complete': True,
        'membershipStable': True, 'contentStable': True,
        'ceilingHeadroomLow': len(epics) >= 800 or len(children) >= 8000,
        **transport,
    }
    return metrics, metadata_bundle, projection


@bp.route('/api/dev/eng-board-measurement/sample', methods=['POST'])
def eng_board_measurement_sample():
    campaign = None
    step = -1
    try:
        context = get_jira_server().current_request_auth_context()
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) != {'campaignId', 'step'}:
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
        step = body['step']
        campaign = CAMPAIGNS.get(context, body['campaignId'])
        if not isinstance(step, int) or campaign.reserved_step != step or STEP_TABLE[step]['kind'] != 'candidate':
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
        CAMPAIGNS.start_candidate(campaign, step)
        revalidate_measurement_campaign(campaign, context)
        if tracemalloc.is_tracing():
            raise MeasurementRuntimeError('measurement_memory_unavailable', status=503, phase='shape')
        with CAMPAIGNS.inflight(campaign), bind_diagnostic_transport(campaign.transport):
            measurement_started = time.monotonic()
            tracemalloc.start()
            baseline, _ = tracemalloc.get_traced_memory()
            tracemalloc.reset_peak()
            try:
                metrics, metadata_bundle, projection = _candidate_metrics(campaign, STEP_TABLE[step], context, started=measurement_started)
                row = STEP_TABLE[step]
                with CAMPAIGNS.publication(campaign, step):
                    revalidate_measurement_campaign(campaign, context)
                    if row['cacheIntent'] == 'refresh':
                        cache_key = (row['profile'], campaign.sprint_id,
                                     campaign.private['configSignature'], campaign.owner)
                        cache = campaign.private['candidateCache']
                        metadata_cache = campaign.private['metadataCache']
                        metadata_cache.put(
                            (campaign.owner, campaign.private['configSignature']), metadata_bundle,
                        )
                        metrics['metadataCacheBytes'] = metadata_cache.total_bytes
                        cache.put(cache_key, metrics, size_value=projection)
                        metrics['candidateCacheBytes'] = cache.total_bytes
                        cache._entries[cache_key] = (
                            cache._entries[cache_key][0], deepcopy(metrics), cache._entries[cache_key][2],
                        )
                    gc.collect()
                    retained, peak = tracemalloc.get_traced_memory()
                    metrics['memoryPeakDeltaBytes'] = max(0, peak - baseline)
                    metrics['memoryRetainedDeltaBytes'] = max(0, retained - baseline)
                    complete_ms = round((time.monotonic() - measurement_started) * 1000, 1)
                    metrics['fullReadyMs'] = complete_ms
                    metrics['stageMs']['total'] = complete_ms
                    CAMPAIGNS.mark_candidate_complete(campaign, step)
            finally:
                tracemalloc.stop()
        row = STEP_TABLE[step]
        sample = {'profile': row['profile'], 'cacheIntent': row['cacheIntent'],
                  'candidateCacheState': 'miss' if row['cacheIntent'] == 'refresh' else 'hit',
                  'metadataCacheState': 'miss' if row['cacheIntent'] == 'refresh' else 'hit',
                  'result': 'success', 'metrics': metrics}
        response = jsonify({'schemaVersion': 2, 'sample': sample})
        response.headers['Server-Timing'] = ', '.join(
            f'{token};dur={metrics["stageMs"][key]}' for token, key in (
                ('config', 'config'), ('cache', 'cache'), ('epic-index', 'epicIndex'),
                ('sprint-membership', 'sprintMembership'), ('bootstrap-children', 'bootstrapChildren'),
                ('remaining-children', 'remainingChildren'), ('shape', 'shape'), ('total', 'total')))
        return response
    except Exception as error:
        if isinstance(error, measurement.MeasurementCoreError):
            error = MeasurementRuntimeError(error.code, phase=error.phase,
                                            status=ERROR_STATUS.get(error.code, 422), limit=error.limit,
                                            observed=error.observed)
        if isinstance(error, MeasurementRuntimeError):
            return _error_response(error, step)
        return _error_response(MeasurementRuntimeError('measurement_jira_failed', status=502), step)
