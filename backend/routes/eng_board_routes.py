"""Strict request-local ENG Board read route."""

from __future__ import annotations

from dataclasses import dataclass
import logging
import secrets
import queue
import time

from flask import Blueprint, Response, current_app, jsonify, request
from sqlalchemy.exc import SQLAlchemyError

from backend.auth.db_context import is_db_auth_context, resolve_db_request_auth_context
from backend.auth.jira_auth import AuthError
from backend.config.repository import ConfigStorageError
from backend.db.engine import DatabaseConfigurationError, database_storage_enabled
from backend.services import eng_board, eng_board_basic, shared_group_config, workspace_dashboard_config
from backend.services.eng_board_stream import (
    ENG_BOARD_PROTOCOL_VERSION, EngBoardChildScheduler, EngBoardRequestDeadline,
    EngBoardRequestTransport, EngBoardStreamWriter,
)

from . import get_jira_server


bp = Blueprint('eng_board_routes', __name__)
LOGGER = logging.getLogger(__name__)
_QUERY_KEYS = {'departmentId', 'scope', 'sprintId', 'focusedColumnId', 'refresh'}
_PROJECT_CATALOG_PAGE_SIZE = 100
_PROJECT_CATALOG_MAX_PAGES = 101


class BoardRouteError(RuntimeError):
    def __init__(self, code, status):
        super().__init__(code)
        self.code = code
        self.status = status


class BoardScopeChanged(RuntimeError):
    pass


class BoardJiraUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class BoardQuery:
    department_id: str
    scope: str
    sprint_id: int | None
    focused_column_id: str | None
    refresh: bool


@dataclass(frozen=True)
class BoardSnapshot:
    query: BoardQuery
    context: object
    browser_session_id: str
    required_scopes: str
    authority_payload: dict
    dashboard_payload: dict
    group: dict
    raw_group: dict
    board: dict
    projects: tuple
    components: tuple
    teams: tuple
    issue_type_ids: tuple
    epic_link_field_id: str | None
    sprint_field_id: str
    story_points_field_id: str
    team_field_id: str
    project_track_field_id: str
    delivery_owner_field_id: str | None
    scope_version: str
    scope_cohort_digest: str
    secret_key: bytes
    adapter: str = 'db_oauth'
    focused_column_id: str | None = None
    adapter_server: object | None = None


def _error(code, status, message='The ENG Board request could not continue safely.'):
    return jsonify({'error': code, 'message': message}), status


def _public_eng_board_error(error):
    return ('scope_too_large' if error.code == 'board_scope_too_large' else 'invalid_page'
            if error.phase == 'page' else 'board_config_invalid'
            if error.phase in ('config', 'catalog') else 'board_data_invalid')


def _unavailable():
    return _error('board_unavailable', 409, 'Strict ENG Board loading is unavailable in this deployment.')


def _single_arg(args, key, *, required=False):
    values = args.getlist(key)
    if len(values) > 1:
        raise BoardRouteError('invalid_board_scope', 400)
    value = values[0].strip() if values else ''
    if required and not value:
        raise BoardRouteError('invalid_board_scope', 400)
    return value


def _parse_query(args):
    if set(args) - _QUERY_KEYS:
        raise BoardRouteError('invalid_board_scope', 400)
    department_id = _single_arg(args, 'departmentId', required=True)
    scope = _single_arg(args, 'scope', required=True)
    sprint_raw = _single_arg(args, 'sprintId')
    focused = _single_arg(args, 'focusedColumnId') or None
    refresh = _single_arg(args, 'refresh') or '0'
    if len(department_id.encode('utf-8')) > 256 or scope not in {'all_work', 'component', 'sprint'}:
        raise BoardRouteError('invalid_board_scope', 400)
    if focused is not None and len(focused.encode('utf-8')) > 256:
        raise BoardRouteError('invalid_board_scope', 400)
    if refresh not in {'0', '1'}:
        raise BoardRouteError('invalid_board_scope', 400)
    sprint_id = None
    if scope == 'sprint':
        try:
            sprint_id = int(sprint_raw)
        except (TypeError, ValueError):
            raise BoardRouteError('board_sprint_required', 400) from None
        if sprint_id <= 0 or str(sprint_id) != sprint_raw:
            raise BoardRouteError('board_sprint_required', 400)
    elif sprint_raw:
        raise BoardRouteError('invalid_board_scope', 400)
    return BoardQuery(department_id, scope, sprint_id, focused, refresh == '1')


def _field_id(payload, key, default=None):
    raw = payload.get(key)
    if isinstance(raw, dict):
        raw = raw.get('fieldId')
    return str(raw or default or '').strip() or None


def _configured_teams(group):
    return tuple(dict.fromkeys(
        str(value or '').strip() for value in (group or {}).get('teamIds') or ()
        if str(value or '').strip()
    ))


def _secret_bytes(value):
    return value if isinstance(value, bytes) else str(value or '').encode('utf-8')


def _jira_json(server, path, context, transport, *, params=None, phase='catalog'):
    transport.budget.check(phase)
    response = server.current_jira_get(
        path, params=params, timeout=transport.budget.jira_retry_timeout(), context=context,
        diagnostic_transport=transport,
    )
    transport.budget.check(phase)
    if response.status_code == 401:
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    if response.status_code == 403:
        raise BoardRouteError('board_permission_denied', 403)
    if response.status_code != 200:
        raise BoardJiraUnavailable('jira_unavailable')
    try:
        return response.json()
    except (TypeError, ValueError):
        raise BoardJiraUnavailable('jira_unavailable') from None


def _accessible_project_catalog(server, context, transport):
    keys = set()
    start_at = 0
    for _page in range(_PROJECT_CATALOG_MAX_PAGES):
        # Project search is offset-paged; only enhanced issue search uses tokens.
        params = {'maxResults': _PROJECT_CATALOG_PAGE_SIZE, 'orderBy': 'key', 'startAt': start_at}
        body = _jira_json(
            server, '/rest/api/3/project/search', context, transport,
            params=params,
        )
        if not isinstance(body, dict) or not isinstance(body.get('values'), list) or not isinstance(body.get('isLast'), bool):
            raise BoardRouteError('board_config_invalid', 409)
        values = body['values']
        if body.get('startAt', start_at) != start_at:
            raise BoardRouteError('board_config_invalid', 409)
        if len(values) > _PROJECT_CATALOG_PAGE_SIZE:
            raise BoardRouteError('board_config_invalid', 409)
        for row in values:
            if not isinstance(row, dict) or not str(row.get('key') or '').strip():
                raise BoardRouteError('board_config_invalid', 409)
            key = str(row['key']).strip().upper()
            if key in keys:
                raise BoardRouteError('board_config_invalid', 409)
            keys.add(key)
        if body['isLast']:
            return keys
        if not values:
            raise BoardRouteError('board_config_invalid', 409)
        start_at += len(values)
    raise BoardRouteError('board_scope_too_large', 422)


def _load_authority(context, query):
    dashboard = workspace_dashboard_config.load_workspace_config(context)
    if dashboard.source != 'workspace_db':
        raise BoardRouteError('board_config_invalid', 409)
    server = get_jira_server()
    try:
        groups = shared_group_config.require_existing_shared_groups_snapshot(
            context, validate_groups_config_fn=server.validate_groups_config,
        )
        preferences = shared_group_config.load_group_preferences(context, groups.groups_config)
    except (shared_group_config.SharedGroupsSnapshotRequired,
            shared_group_config.InvalidSharedGroupConfig,
            shared_group_config.InvalidGroupPreferences) as error:
        raise BoardRouteError('board_config_invalid', 409) from error
    group = next((row for row in groups.groups_config.get('groups') or []
                  if str((row or {}).get('id') or '').strip() == query.department_id), None)
    if group is None:
        raise BoardRouteError('board_group_not_found', 404)
    if query.department_id not in set(preferences.get('effectiveVisibleGroupIds') or []):
        raise BoardRouteError('board_permission_denied', 403)
    raw_group = next((row for row in groups.raw_payload.get('groups') or []
                      if str((row or {}).get('id') or '').strip() == query.department_id), group)
    authority = {
        'auth': {
            'workspaceId': context.workspace_id, 'userId': context.user_id,
            'connectionId': context.auth_connection_id, 'browserSessionId': context.browser_session_id,
            'siteId': context.cloud_id, 'siteUrl': context.site_url,
            'projectAccess': [vars(value) for value in context.project_access],
        },
        'dashboard': {'revision': dashboard.config_revision, 'payload': dashboard.payload},
        'groups': {
            'revision': groups.config_revision, 'payloadVersion': groups.payload_version,
            'payload': groups.raw_payload,
        },
        'visibility': {
            'effectiveVisibleGroupIds': preferences.get('effectiveVisibleGroupIds') or [],
            'onboardingRequired': bool(preferences.get('onboardingRequired')),
        },
    }
    return authority, dashboard.payload, dict(group), dict(raw_group), groups.config_revision, dashboard.config_revision


def _context_from_browser_session(snapshot):
    return resolve_db_request_auth_context(
        {'db_browser_session_id': snapshot.browser_session_id}, required_scopes=snapshot.required_scopes,
    )


def _auth_partition(context):
    return (
        context.workspace_id, context.user_id, context.auth_connection_id,
        context.browser_session_id, context.cloud_id, context.site_url,
        str(context.token_version),
    )


def _assert_current(snapshot):
    if snapshot.adapter == 'basic_json':
        return _assert_basic_snapshot_current(snapshot.adapter_server or get_jira_server(), snapshot)
    context = _context_from_browser_session(snapshot)
    if _auth_partition(context) != _auth_partition(snapshot.context):
        raise BoardScopeChanged('scope_changed')
    try:
        authority, *_unused = _load_authority(context, snapshot.query)
    except BoardRouteError as error:
        raise BoardScopeChanged('scope_changed') from error
    current = eng_board.build_scope_version(snapshot.secret_key, authority, token_version=context.token_version)
    if current != snapshot.scope_version:
        raise BoardScopeChanged('scope_changed')
    return context


def _basic_request_checkpoint(server, snapshot, budget, *, phase):
    cancelled = getattr(budget, 'cancelled', None)
    if cancelled is not None and cancelled.is_set():
        raise EngBoardRequestDeadline('request_cancelled')
    budget.check(phase)
    _assert_basic_snapshot_current(server, snapshot, checkpoint=phase)


def _assert_basic_snapshot_current(server, snapshot, *, checkpoint='scope'):
    del checkpoint
    try:
        current = eng_board_basic.capture_authority(
            server, snapshot.query.department_id, snapshot.secret_key,
        )
    except eng_board_basic.BasicBoardCompatibilityError as error:
        raise BoardScopeChanged('scope_changed') from error
    current_version = eng_board.build_scope_version(
        snapshot.secret_key, current.authority_payload,
        token_version=current.credential_version,
    )
    if current_version != snapshot.scope_version:
        raise BoardScopeChanged('scope_changed')
    return None


def _resolve_projects(server, dashboard_payload, context, transport):
    selected = (dashboard_payload.get('projects') or {}).get('selected') or []
    fallback = None
    if not selected:
        board_id = str((dashboard_payload.get('board') or {}).get('boardId') or '').strip()
        if board_id:
            board_data = _jira_json(server, f'/rest/agile/1.0/board/{board_id}', context, transport)
            fallback = str((board_data.get('location') or {}).get('projectKey') or '').strip()
    projects = eng_board.normalize_projects(selected, saved_board_project_key=fallback)
    accessible = _accessible_project_catalog(server, context, transport)
    if any(key not in accessible for key, _kind in projects):
        raise BoardRouteError('board_permission_denied', 403)
    return projects


def _capture_shape(server, query, transport, dashboard, group, raw_group, *, context):
    validated = eng_board.validate_scope_configuration(
        query.scope, raw_group.get('board'), group.get('missingInfoComponents') or (),
        team_ids=_configured_teams(group),
    )
    board = validated['board']
    column_ids = {row['id'] for row in board['columns']}
    if query.focused_column_id and query.focused_column_id not in column_ids:
        raise BoardRouteError('invalid_board_scope', 400)
    focused = query.focused_column_id or next(
        (row['id'] for row in board['columns'] if row.get('star')),
        board['columns'][0]['id'],
    )
    teams = _configured_teams(group)
    if query.scope == 'sprint' and not validated['components'] and not teams:
        raise BoardRouteError('board_team_scope_required', 409)
    projects = _resolve_projects(server, dashboard, context, transport)
    issue_types = _jira_json(server, '/rest/api/3/issuetype', context, transport)
    fields = _jira_json(server, '/rest/api/3/field', context, transport)
    issue_type_ids = eng_board.resolve_issue_type_ids(
        issue_types, dashboard.get('issueTypes'), key_present='issueTypes' in dashboard,
    )
    epic_link = eng_board.resolve_epic_link_field(fields)
    field_ids = {
        'sprint': _field_id(dashboard, 'sprintField', 'customfield_10101'),
        'storyPoints': _field_id(dashboard, 'storyPointsField', 'customfield_10004'),
        'team': _field_id(dashboard, 'teamField', 'customfield_30101'),
        'projectTrack': _field_id(dashboard, 'projectTrackField', 'customfield_35024'),
        'deliveryOwner': _field_id(dashboard, 'deliveryOwnerField'),
        'epicLink': epic_link,
    }
    for field_id in (field_ids['sprint'], field_ids['storyPoints'], field_ids['team'], field_ids['projectTrack']):
        eng_board.validate_custom_field_id(field_id)
    eng_board.validate_custom_field_id(field_ids['deliveryOwner'], optional=True)
    return {
        'board': board, 'focused': focused, 'teams': teams,
        'components': validated['components'], 'projects': projects,
        'issueTypeIds': issue_type_ids, 'fields': field_ids,
    }


def _capture_snapshot(server, query, transport, secret_key):
    initial = server.current_request_auth_context()
    if not is_db_auth_context(initial) or not initial.browser_session_id:
        raise BoardRouteError('board_unavailable', 409)
    server.current_jira_session_data(initial, diagnostic_transport=transport)
    context = server.current_request_auth_context()
    if not is_db_auth_context(context) or not context.browser_session_id:
        raise BoardRouteError('board_unavailable', 409)
    authority, dashboard, group, raw_group, groups_revision, dashboard_revision = _load_authority(context, query)
    shape = _capture_shape(
        server, query, transport, dashboard, group, raw_group, context=context,
    )
    fresh = server.current_request_auth_context()
    if not is_db_auth_context(fresh) or _auth_partition(fresh) != _auth_partition(context):
        raise BoardRouteError('scope_changed', 409)
    try:
        fresh_authority, *_unused = _load_authority(fresh, query)
    except BoardRouteError as error:
        raise BoardRouteError('scope_changed', 409) from error
    fresh_version = eng_board.build_scope_version(secret_key, fresh_authority, token_version=fresh.token_version)
    scope_version = eng_board.build_scope_version(secret_key, authority, token_version=context.token_version)
    if fresh_version != scope_version:
        raise BoardRouteError('scope_changed', 409)
    cohort = eng_board.build_scope_cohort_digest(
        secret_key, workspace_id=context.workspace_id, site_id=context.cloud_id or context.site_url,
        user_id=context.user_id, department_id=query.department_id,
        shared_config_revisions={'groups': groups_revision, 'dashboard': dashboard_revision},
        shared_config_content={'group': raw_group, 'dashboard': dashboard},
        effective_projects=shape['projects'], project_access=[vars(value) for value in context.project_access],
        fields=shape['fields'], eligible_issue_types=shape['issueTypeIds'],
        components=shape['components'], teams=shape['teams'],
        board=shape['board'], scope=query.scope, sprint_id=query.sprint_id,
    )
    return BoardSnapshot(
        query, context, context.browser_session_id, server.ATLASSIAN_SCOPES, authority, dashboard,
        group, raw_group, shape['board'], shape['projects'], shape['components'], shape['teams'],
        shape['issueTypeIds'], shape['fields']['epicLink'], shape['fields']['sprint'],
        shape['fields']['storyPoints'], shape['fields']['team'], shape['fields']['projectTrack'],
        shape['fields']['deliveryOwner'], scope_version, cohort, secret_key,
        focused_column_id=shape['focused'],
    )


def _capture_basic_snapshot(server, query, transport, secret_key):
    try:
        captured = eng_board_basic.capture_authority(
            server, query.department_id, secret_key,
        )
    except eng_board_basic.BasicBoardCompatibilityError as error:
        raise BoardRouteError(error.code, error.status) from error
    group = captured.group
    shape = _capture_shape(
        server, query, transport, captured.dashboard_payload, group, group, context=None,
    )
    scope_version = eng_board.build_scope_version(
        secret_key, captured.authority_payload,
        token_version=captured.credential_version,
    )
    cohort = eng_board.build_scope_version(secret_key, {
        'adapter': 'basic_json',
        'departmentId': query.department_id,
        'dashboard': captured.dashboard_payload,
        'group': group,
        'projects': shape['projects'],
        'fields': shape['fields'],
        'issueTypeIds': shape['issueTypeIds'],
        'components': shape['components'],
        'teams': shape['teams'],
        'board': shape['board'],
        'scope': query.scope,
        'sprintId': query.sprint_id,
    }, token_version='basic-json-v1')
    snapshot = BoardSnapshot(
        query, None, '', '', captured.authority_payload, captured.dashboard_payload,
        group, group, shape['board'], shape['projects'], shape['components'], shape['teams'],
        shape['issueTypeIds'], shape['fields']['epicLink'], shape['fields']['sprint'],
        shape['fields']['storyPoints'], shape['fields']['team'], shape['fields']['projectTrack'],
        shape['fields']['deliveryOwner'], scope_version, cohort, secret_key,
        adapter='basic_json', focused_column_id=shape['focused'], adapter_server=server,
    )
    try:
        _assert_basic_snapshot_current(server, snapshot, checkpoint='preheader')
    except BoardScopeChanged as error:
        raise BoardRouteError('scope_changed', 409) from error
    return snapshot


def _wire_columns(board):
    last = len(board['columns']) - 1
    return [{
        'id': column['id'], 'name': column['name'], 'color': column.get('colour') or '#64748b',
        'statusNames': list(column['statuses']), 'terminal': index == last,
    } for index, column in enumerate(board['columns'])]


def _shells(projection):
    return [{key: value for key, value in epic.items() if key != 'children'} for epic in projection['epics']]


def _diagnostics(transport, counters, started, index_ms, focused_ms, peak, completeness):
    observed = transport.diagnostics()
    return {
        'indexMs': index_ms, 'focusedCompleteMs': focused_ms,
        'durationMs': round((time.monotonic() - started) * 1000, 1),
        'jiraRequests': int(observed['jiraRequests']),
        'jiraPages': int(max(observed['jiraPages'], counters.pages)),
        'jiraRetries': int(observed['jiraRetries']), 'peakChildSearches': int(peak),
        'cacheState': 'miss', 'completeness': completeness,
    }


def _search_page(server, snapshot, transport, payload, timeout):
    if snapshot.adapter == 'basic_json':
        _basic_request_checkpoint(server, snapshot, transport.budget, phase='jira_search')
    response = server.current_jira_search(
        payload, context=snapshot.context,
        timeout=timeout[1] if isinstance(timeout, tuple) else timeout,
        diagnostic_transport=transport,
    )
    if snapshot.adapter == 'basic_json':
        _basic_request_checkpoint(server, snapshot, transport.budget, phase='jira_search')
    if response.status_code == 401:
        if snapshot.adapter == 'basic_json':
            raise BoardJiraUnavailable('jira_unavailable')
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    if response.status_code != 200:
        raise BoardJiraUnavailable('jira_unavailable')
    try:
        return response.json()
    except (TypeError, ValueError):
        raise eng_board.EngBoardError('board_projection_invalid', phase='index') from None


def _frame_stream(server, snapshot, transport):
    writer = EngBoardStreamWriter()
    generation_id = secrets.token_urlsafe(24)
    sequence = 0
    started = time.monotonic()
    counters = eng_board.PagerCounters()
    scheduler = None
    index_ms = 0.0
    focused_ms = None
    peak = 0

    def emit(frame_type, **payload):
        nonlocal sequence
        frame = {
            'protocolVersion': ENG_BOARD_PROTOCOL_VERSION, 'generationId': generation_id,
            'sequence': sequence, 'type': frame_type, **payload,
        }
        sequence += 1
        return writer.write(frame)

    try:
        yield emit(
            'start', scope=snapshot.query.scope, scopeVersion=snapshot.scope_version,
            scopeCohortDigest=snapshot.scope_cohort_digest, columns=_wire_columns(snapshot.board),
        )
        index_started = time.monotonic()
        terminal_statuses = snapshot.board['columns'][-1]['statuses']
        index_jql = eng_board.build_epic_index_jql(
            snapshot.projects, snapshot.components if snapshot.components else (), terminal_statuses,
            snapshot.board['doneEpicRetentionDays'] or 28,
        )
        epic_fields = tuple(dict.fromkeys(eng_board.EPIC_FIELDS + tuple(
            value for value in (snapshot.project_track_field_id, snapshot.delivery_owner_field_id) if value
        )))
        epics = eng_board.strict_search(
            lambda payload: _search_page(server, snapshot, transport, payload, transport.budget.jira_retry_timeout()),
            index_jql, epic_fields, counters=counters, cancel_check=lambda: _assert_current(snapshot),
            max_unique_keys=eng_board.MAX_EPICS,
        ) if snapshot.components or snapshot.query.scope == 'sprint' else []
        if snapshot.query.scope == 'all_work' and snapshot.teams:
            if epics:
                provisional = eng_board.project_board(
                    epics, [], project_map=snapshot.projects, columns=snapshot.board['columns'],
                    project_track_field_id=snapshot.project_track_field_id,
                    delivery_owner_field_id=snapshot.delivery_owner_field_id,
                )
                yield emit('index', epics=_shells(provisional), membership='candidate')
            epics = eng_board.discover_team_epics(
                lambda payload: _search_page(server, snapshot, transport, payload, transport.budget.jira_retry_timeout()),
                projects=snapshot.projects, issue_type_ids=snapshot.issue_type_ids,
                team_ids=snapshot.teams, existing_epics=epics, epic_fields=epic_fields,
                terminal_statuses=terminal_statuses,
                retention_days=snapshot.board['doneEpicRetentionDays'] or 28,
                team_field_id=snapshot.team_field_id, epic_link_field_id=snapshot.epic_link_field_id,
                counters=counters, cancel_check=lambda: _assert_current(snapshot),
            )
        index_ms = round((time.monotonic() - index_started) * 1000, 1)
        index_projection = eng_board.project_board(
            epics, [], project_map=snapshot.projects, columns=snapshot.board['columns'],
            project_track_field_id=snapshot.project_track_field_id,
            delivery_owner_field_id=snapshot.delivery_owner_field_id,
        )
        index_shells = _shells(index_projection)
        yield emit('index', epics=index_shells,
                   membership='authoritative'
                   if snapshot.query.scope in {'all_work', 'component'} else 'candidate')
        raw_by_key = {str(row['key']).strip().upper(): row for row in epics}
        column_keys = {
            column['id']: [row['key'] for row in index_shells if row['columnId'] == column['id']]
            for column in snapshot.board['columns']
        }
        focused = snapshot.focused_column_id or snapshot.query.focused_column_id or snapshot.board['columns'][0]['id']
        ordered_ids = [focused] + [row['id'] for row in snapshot.board['columns'] if row['id'] != focused]
        child_fields = tuple(dict.fromkeys(eng_board.CHILD_BASE_FIELDS + tuple(
            value for value in (
                snapshot.epic_link_field_id, snapshot.sprint_field_id, snapshot.story_points_field_id,
                snapshot.team_field_id, snapshot.project_track_field_id, snapshot.delivery_owner_field_id,
            ) if value
        )))
        child_budget = eng_board.UniqueKeyBudget(eng_board.MAX_CHILDREN)
        team_ids = snapshot.teams if snapshot.query.scope == 'sprint' and not snapshot.components else ()

        def child_jql(keys):
            return eng_board.build_child_jql(
                snapshot.projects, snapshot.issue_type_ids, keys,
                epic_link_field_id=snapshot.epic_link_field_id,
                sprint_field_id=snapshot.sprint_field_id, sprint_id=snapshot.query.sprint_id,
                team_field_id=snapshot.team_field_id, team_ids=team_ids,
            )

        progress_queue = queue.Queue(maxsize=2)

        def column_search(column_id, keys):
            def run(timeout):
                children = []
                progress_by_epic = {key: {'epicKey': key, 'loadedChildren': 0, 'statusCounts': {}} for key in keys}
                def publish_page(rows):
                    projection = eng_board.project_board(
                        [raw_by_key[key] for key in keys], rows,
                        project_map=snapshot.projects, columns=snapshot.board['columns'],
                        epic_link_field_id=snapshot.epic_link_field_id,
                        story_points_field_id=snapshot.story_points_field_id,
                        team_field_id=snapshot.team_field_id, sprint_field_id=snapshot.sprint_field_id,
                        project_track_field_id=snapshot.project_track_field_id,
                        delivery_owner_field_id=snapshot.delivery_owner_field_id,
                    )
                    for row in projection['epics']:
                        progress = progress_by_epic[row['key']]
                        for child in row['children']:
                            status = child['status']['name']
                            progress['statusCounts'][status] = progress['statusCounts'].get(status, 0) + 1
                            progress['loadedChildren'] += 1
                    by_epic = [{**row, 'statusCounts': dict(row['statusCounts'])}
                               for row in progress_by_epic.values()]
                    update = (column_id, None, {
                        'loadedChildren': sum(row['loadedChildren'] for row in by_epic), 'byEpic': by_epic,
                    })
                    # Progress is replaceable; final column frames carry every
                    # child. A slow client must not accumulate a page backlog.
                    while True:
                        try:
                            progress_queue.put_nowait(update)
                            break
                        except queue.Full:
                            try:
                                progress_queue.get_nowait()
                            except queue.Empty:
                                pass
                try:
                    for batch in eng_board.split_epic_batches(keys, child_jql, child_fields):
                        _assert_current(snapshot)
                        children.extend(eng_board.strict_search(
                            lambda payload: _search_page(server, snapshot, transport, payload, timeout),
                            child_jql(batch), child_fields, counters=counters,
                            cancel_check=lambda: _assert_current(snapshot), key_budget=child_budget,
                            on_rows=publish_page,
                        ))
                    return column_id, children, None
                except BoardJiraUnavailable:
                    return column_id, [], 'jira_unavailable'
            return run

        searches = [column_search(column_id, column_keys[column_id])
                    for column_id in ordered_ids if column_keys[column_id]]
        scheduler = EngBoardChildScheduler(searches, budget=transport.budget) if searches else None
        result_iterator = scheduler.results(progress_queue=progress_queue) if scheduler is not None else iter(())
        emitted_epics = 0
        emitted_children = 0
        failed = []
        for column_id in ordered_ids:
            if column_keys[column_id]:
                result_column_id, children, error = next(result_iterator)
                while isinstance(error, dict):
                    yield emit('progress', columnId=result_column_id, **error)
                    result_column_id, children, error = next(result_iterator)
                if result_column_id != column_id:
                    raise eng_board.EngBoardError(
                        'board_projection_invalid', phase='shape', reason='scheduler.order',
                    )
            else:
                children, error = [], None
            if error:
                failed.append(column_id)
                yield emit('column_error', columnId=column_id, code=error, retryable=True)
                continue
            projection = eng_board.project_board(
                [raw_by_key[key] for key in column_keys[column_id]], children,
                project_map=snapshot.projects, columns=snapshot.board['columns'],
                epic_link_field_id=snapshot.epic_link_field_id,
                story_points_field_id=snapshot.story_points_field_id,
                team_field_id=snapshot.team_field_id, sprint_field_id=snapshot.sprint_field_id,
                project_track_field_id=snapshot.project_track_field_id,
                delivery_owner_field_id=snapshot.delivery_owner_field_id,
                require_children=snapshot.query.scope == 'sprint',
            )
            shells = _shells(projection)
            children_wire = [child for epic in projection['epics'] for child in epic['children']]
            emitted_epics += len(shells)
            emitted_children += len(children_wire)
            yield emit('column', columnId=column_id, epics=shells,
                       children=children_wire, authoritative=True)
            if column_id == focused:
                focused_ms = round((time.monotonic() - started) * 1000, 1)
        if scheduler is not None:
            try:
                next(result_iterator)
            except StopIteration:
                pass
            else:
                raise eng_board.EngBoardError(
                    'board_projection_invalid', phase='shape', reason='scheduler.extra_result',
                )
            peak = scheduler.peak_child_searches
        _assert_current(snapshot)
        if failed:
            yield emit(
                'complete', outcome='partial_error', authoritative=False, failedColumnIds=failed,
                diagnostics=_diagnostics(transport, counters, started, index_ms, focused_ms, peak, 'partial'),
            )
        else:
            yield emit(
                'complete', outcome='success', authoritative=True,
                epicCount=emitted_epics, childCount=emitted_children,
                diagnostics=_diagnostics(transport, counters, started, index_ms, focused_ms, peak, 'complete'),
            )
    except GeneratorExit:
        raise
    except AuthError:
        if not writer.complete:
            yield emit('error', code='auth_required')
    except BoardScopeChanged:
        if not writer.complete:
            yield emit('error', code='scope_changed', diagnostics=_diagnostics(
                transport, counters, started, index_ms, focused_ms, peak, 'partial'))
    except EngBoardRequestDeadline:
        if not writer.complete:
            yield emit('error', code='deadline_exceeded', diagnostics=_diagnostics(
                transport, counters, started, index_ms, focused_ms, peak, 'partial'))
    except eng_board.EngBoardError as error:
        code = _public_eng_board_error(error)
        LOGGER.warning('ENG Board stream rejected code=%s phase=%s reason=%s limit=%s observed=%s',
                       error.code, error.phase, error.reason, error.limit, error.observed)
        if not writer.complete:
            yield emit('error', code=code, diagnostics=_diagnostics(
                transport, counters, started, index_ms, focused_ms, peak, 'partial'))
    except BoardJiraUnavailable:
        if not writer.complete:
            yield emit('error', code='jira_unavailable', diagnostics=_diagnostics(
                transport, counters, started, index_ms, focused_ms, peak, 'partial'))
    except (ConfigStorageError, DatabaseConfigurationError, SQLAlchemyError):
        if not writer.complete:
            yield emit('error', code='storage_unavailable', diagnostics=_diagnostics(
                transport, counters, started, index_ms, focused_ms, peak, 'partial'))
    finally:
        if scheduler is not None:
            scheduler.retire()


@bp.route('/api/eng/board', methods=['GET'])
def get_eng_board():
    server = get_jira_server()
    auth_mode = server.JIRA_AUTH_MODE
    try:
        query = _parse_query(request.args)
        database_backed = database_storage_enabled() if auth_mode == 'atlassian_oauth' else False
        if not eng_board.strict_adapter_available(auth_mode, database_backed=database_backed):
            return _unavailable()
        transport = EngBoardRequestTransport()
        secret_key = _secret_bytes(current_app.secret_key)
        if auth_mode == 'atlassian_oauth':
            snapshot = _capture_snapshot(server, query, transport, secret_key)
        else:
            return _unavailable()
    except BoardRouteError as error:
        return _unavailable() if error.code == 'board_unavailable' else _error(error.code, error.status)
    except AuthError:
        if auth_mode == 'basic':
            return _unavailable()
        payload, status = server.oauth_auth_required_payload()
        return jsonify(payload), status
    except eng_board.EngBoardError as error:
        code = _public_eng_board_error(error)
        LOGGER.warning('ENG Board request rejected code=%s phase=%s reason=%s limit=%s observed=%s',
                       error.code, error.phase, error.reason, error.limit, error.observed)
        return _error(code, 422 if code == 'scope_too_large' else 409)
    except EngBoardRequestDeadline:
        return _error('deadline_exceeded', 503)
    except BoardJiraUnavailable:
        return _error('jira_unavailable', 503)
    except (ConfigStorageError, DatabaseConfigurationError, SQLAlchemyError):
        return _error('storage_unavailable', 503)
    response = Response(_frame_stream(server, snapshot, transport), content_type='application/x-ndjson')
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Accel-Buffering'] = 'no'
    return response
