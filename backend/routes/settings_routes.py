"""Settings, config, and catalog route blueprint."""

from urllib.parse import quote as _url_quote

from flask import Blueprint, Response
from werkzeug.exceptions import BadRequest

from backend.auth.admin_bootstrap import workspace_tool_admin_display_names
from backend.auth.db_context import is_db_auth_context
from backend.epm.access import SCOPE_LOGIN_URL
from backend.epm.home import (
    HOME_READ_PROFILE_PUBLIC_READ_V1,
    HOME_READ_PROFILE_SCOPE_REQUIRED,
    select_epm_home_read_profile,
)
from backend.config.db_repository import ViewConfigNotFound
from backend.config.repository import ConfigStorageError, config_storage_db_enabled, db_repository
from backend.config.shared_config import normalize_shared_admin_section
from backend.db.engine import DatabaseConfigurationError
from backend.services import eng_board, shared_group_config
from backend.services import work_structure as work_structure_service
from backend.services import shared_capacity_config
from backend.services.capacity import CapacityUpstreamUnauthorized
from backend.services.user_view_config import UserViewConfigStorageError
from backend.services.workspace_dashboard_config import (
    TeamCatalogConflict,
    WorkspaceConfigConflict,
    WorkspaceConfigFenceUnavailable,
)
import re as _re

from backend.services.catalog_refresh_runtime import CatalogCompletionError
from backend.services.workspace_catalog_cache import (
    in_range_sprints,
    load_scoped_sprint_catalog,
    load_sprint_catalog,
)
from backend.services.workspace_catalog_config import (
    build_merged_catalog_identity,
    build_projection_identity,
)
from . import bind_server_globals
from . import work_structure_routes as work_routes


bp = Blueprint("settings_routes", __name__)
_CONFIGURATION_ID_PATTERN = _re.compile(r'[A-Za-z0-9_-]{1,64}')


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


def _settings_process_cache_enabled():
    return jira_home_process_cache_enabled(current_request_auth_context())


def _config_revision():
    return load_dashboard_config_snapshot().config_revision if config_storage_db_enabled() else None


def _with_config_revision(payload):
    result = dict(payload)
    revision = _config_revision()
    if revision is not None:
        result['configRevision'] = revision
    return result


def _parse_shared_write(payload, allowed_fields):
    if not isinstance(payload, dict):
        raise ValueError('request body must be a JSON object')
    allowed = set(allowed_fields)
    if config_storage_db_enabled():
        allowed.add('baseRevision')
        if 'baseRevision' not in payload:
            raise ValueError('baseRevision is required')
    unknown = set(payload) - allowed
    if unknown:
        raise ValueError(f'unsupported configuration field: {sorted(unknown)[0]}')
    return payload.get('baseRevision')


def _workspace_conflict_response(error):
    value = (error.current.payload or {}).get(error.section)
    return jsonify({
        'error': 'workspace_config_conflict',
        'message': 'Shared settings changed while you were editing. Your changes are still unsaved.',
        'currentRevision': error.current.config_revision,
        'current': {
            'section': error.section,
            'value': value if value is not None else {},
            'configRevision': error.current.config_revision,
        },
    }), 409


def _config_fence_unavailable_response():
    return jsonify({
        'error': 'config_storage_unavailable',
        'message': 'Configuration storage is temporarily unavailable.',
    }), 503


def _onboarding_storage_error_response(_error):
    return jsonify({
        'error': 'config_storage_unavailable',
        'message': 'Onboarding preferences require database-backed configuration storage.',
    }), 503


def _persist_shared_section(section, value, base_revision):
    if config_storage_db_enabled():
        return save_dashboard_config_section(section, value, base_revision=base_revision).config_revision
    dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
    dashboard_config[section] = value
    save_dashboard_config(dashboard_config)
    return None


def _has_dashboard_config_value(value):
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_has_dashboard_config_value(item) for item in value)
    if isinstance(value, dict):
        return any(_has_dashboard_config_value(item) for item in value.values())
    return value not in (None, False)


_UNSUPPORTED_GROUP_CONFIG_FIELDS = {
    'workspaceId',
    'workspace_id',
    'userId',
    'user_id',
    'cloudId',
    'cloud_id',
    'siteUrl',
    'site_url',
    'accountId',
    'account_id',
}

_GROUP_PREFERENCE_FIELDS = {'visibleGroupIds', 'activeGroupId'}
_ONBOARDING_PREFERENCE_FIELDS = {'completedModule', 'onboardingDone'}


def _unsupported_group_fields(payload):
    if not isinstance(payload, dict):
        return []
    return sorted(field for field in _UNSUPPORTED_GROUP_CONFIG_FIELDS if field in payload)


def _shared_group_db_auth_context():
    if not config_storage_db_enabled():
        return None
    auth_context = current_request_auth_context()
    if not is_db_auth_context(auth_context):
        return None
    return auth_context


_CAPACITY_ALLOWED_FIELDS = {'project', 'fieldId', 'fieldName', 'baseRevision'}


def _shared_capacity_db_auth_context():
    if not config_storage_db_enabled():
        return None
    auth_context = current_request_auth_context()
    return auth_context if is_db_auth_context(auth_context) else None


def _capacity_payload_error(payload):
    if not isinstance(payload, dict) or set(payload) - _CAPACITY_ALLOWED_FIELDS:
        return 'invalid_capacity_config'
    if any(
        key in payload and payload.get(key) is not None and not isinstance(payload.get(key), str)
        for key in ('project', 'fieldId', 'fieldName')
    ):
        return 'invalid_capacity_config'
    if 'baseRevision' in payload and (
        isinstance(payload.get('baseRevision'), bool)
        or not isinstance(payload.get('baseRevision'), int)
        or payload.get('baseRevision') < 0
    ):
        return 'invalid_capacity_config'
    return None


def load_current_site_field_catalog(context):
    """Read the current user's Jira field catalog for Capacity attestation."""
    try:
        response = current_jira_request('GET', '/rest/api/3/field', timeout=20, context=context)
        if response is None or response.status_code != 200:
            if response is not None and response.status_code == 401:
                raise CapacityUpstreamUnauthorized()
            return None
        fields = response.json()
    except AuthError:
        raise
    except (CapacityUpstreamUnauthorized, ConfigStorageError, DatabaseConfigurationError):
        raise
    except Exception:
        return None
    return fields if isinstance(fields, list) else None


def _clear_capacity_field_cache():
    global CAPACITY_FIELD_CACHE
    with _cache_lock:
        _jira_server_module.CAPACITY_FIELD_CACHE = None
        CAPACITY_FIELD_CACHE = None


def _environment_dashboard_config_exists(config=None):
    if config is None:
        config = load_dashboard_config() or {}
    if not isinstance(config, dict):
        return False

    projects = config.get('projects') or {}
    if isinstance(projects, dict) and _has_dashboard_config_value(projects.get('selected')):
        return True

    for section in ('board', 'capacity', 'sprintField', 'storyPointsField', 'parentNameField', 'teamField'):
        if _has_dashboard_config_value(config.get(section)):
            return True

    if _has_dashboard_config_value(config.get('statsPriorityWeights')):
        return True
    if _has_dashboard_config_value(config.get('issueTypes')):
        return True

    return False


def _resolve_bootstrap_view_config(auth_context):
    if not config_storage_db_enabled():
        return None
    try:
        return db_repository().resolve_effective_view_config(auth_context)
    except ViewConfigNotFound:
        return None


def _load_team_catalog_dashboard_config():
    if config_storage_db_enabled():
        return db_repository().load_team_catalog(current_request_auth_context()) or {}
    return load_dashboard_config() or {}


def _metadata_selection(*, required, allow_quarter_only=False):
    """``(selection, error_response)``; selection is None on the unscoped legacy path."""
    try:
        return work_routes.resolve_metadata_selection(
            request.args, current_request_auth_context(),
            required=required, allow_quarter_only=allow_quarter_only,
        ), None
    except work_structure_service.WorkConfigError as error:
        return None, work_routes.work_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError, WorkspaceConfigFenceUnavailable):
        return None, work_routes.storage_unavailable_response()


def _selection_incomplete(selection, *needed):
    """Error response when the selected entry lacks a needed mapping, else None."""
    try:
        work_routes.require_complete(selection, *needed)
    except work_structure_service.WorkConfigError as error:
        return work_routes.work_error_response(error)
    return None


def _scoped_jira_failure(code='jira_unavailable'):
    return jsonify({'error': code, 'status': 'error', 'message': 'Jira could not complete the request.'}), 502


def _scoped_components(selection, query, limit):
    incomplete = _selection_incomplete(selection, 'scope.projects')
    if incomplete is not None:
        return incomplete
    seen_names, all_components = set(), []
    for project_key in selection['projects']:
        try:
            resp = current_jira_get(
                f'/rest/api/3/project/{_url_quote(project_key, safe="")}/components', timeout=10,
            )
            if resp.status_code != 200:
                return work_routes.upstream_error_response(resp.status_code)
            components = resp.json() or []
        except AuthError:
            raise
        except Exception:
            return _scoped_jira_failure()
        for comp in components if isinstance(components, list) else []:
            name = str((comp or {}).get('name') or '').strip()
            if not name or name.lower() in seen_names:
                continue
            seen_names.add(name.lower())
            all_components.append({'id': comp.get('id', ''), 'name': name, 'projectKey': project_key})
    all_components.sort(key=lambda c: c['name'].lower())
    if query:
        all_components = [c for c in all_components if query in c['name'].lower()]
    return jsonify({
        'components': all_components[:limit],
        'configurationId': selection['id'], 'configurationRevision': selection['revision'],
    })


def _scoped_epic_search(selection, query, limit):
    incomplete = _selection_incomplete(selection, 'scope.projects', 'hierarchy.parentIssueTypeId')
    if incomplete is not None:
        return incomplete
    authority = work_routes.parent_type_authority(selection['entry'])
    if authority is None:
        return work_routes.work_error_response(work_structure_service.WorkConfigError(
            'configuration_incomplete', paths=['hierarchy.parentIssueTypeId'],
            configuration_id=selection['id'],
        ))
    kind, value = authority
    projects = selection['projects']
    escaped_projects = ', '.join(f'"{_escape_jql_literal(project)}"' for project in projects)
    escaped_query = _escape_jql_literal(query)
    escaped_key = _escape_jql_literal(query.upper())
    if re.match(r'^[A-Za-z][A-Za-z0-9_]+-\d+$', query) is not None:
        query_clause = f'key = "{escaped_key}"'
    else:
        query_clause = f'(summary ~ "\\"{escaped_query}\\"" OR key ~ "{escaped_key}*")'
    type_clause = 'issuetype = Epic' if kind == 'name' else f'issuetype = "{_escape_jql_literal(value)}"'
    try:
        response = jira_search_request({
            'jql': f'{type_clause} AND project in ({escaped_projects}) AND {query_clause} ORDER BY updated DESC',
            'maxResults': limit,
            'fields': ['summary', 'status', 'project', 'issuetype'],
        })
        if response.status_code != 200:
            return work_routes.upstream_error_response(response.status_code)
        issues = (response.json() or {}).get('issues') or []
    except AuthError:
        raise
    except Exception:
        return _scoped_jira_failure()
    project_set = set(projects)
    epics = []
    for issue in issues:
        key = str(issue.get('key') or '').strip().upper()
        fields = issue.get('fields') or {}
        project_key = str((fields.get('project') or {}).get('key') or '').strip()
        issue_type = fields.get('issuetype') or {}
        if kind == 'id':
            matches_type = str(issue_type.get('id') or '') == value
        else:
            matches_type = (str(issue_type.get('name') or '').strip().lower() == 'epic'
                            or str(issue_type.get('hierarchyLevel')) == '1')
        if not key or not matches_type or (project_key and project_key not in project_set):
            continue
        epics.append({
            'key': key,
            'summary': str(fields.get('summary') or '').strip(),
            'status': ((fields.get('status') or {}).get('name') or ''),
            'projectKey': project_key,
        })
    return jsonify({
        'epics': epics, 'configurationId': selection['id'], 'configurationRevision': selection['revision'],
    })


def _scoped_board_statuses(selection):
    incomplete = _selection_incomplete(selection, 'scope.projects')
    if incomplete is not None:
        return incomplete
    authority = work_routes.parent_type_authority(selection['entry'])
    if authority is None:
        return work_routes.work_error_response(work_structure_service.WorkConfigError(
            'configuration_incomplete', paths=['hierarchy.parentIssueTypeId'],
            configuration_id=selection['id'],
        ))
    kind, value = authority
    project_keys = selection['projects']
    statuses, seen_status_ids = [], set()
    for project_key in project_keys:
        try:
            response = current_jira_get(
                f'/rest/api/3/project/{_url_quote(project_key, safe="")}/statuses',
            )
            if response.status_code in (401, 403):
                return jsonify({
                    'error': 'board_statuses_forbidden', 'status': 'error',
                    'message': 'Jira refused the project statuses read.',
                }), 502
            if response.status_code != 200:
                return _scoped_jira_failure('board_statuses_fetch_failed')
            issue_types = response.json() or []
        except AuthError:
            raise
        except Exception:
            return _scoped_jira_failure('board_statuses_fetch_failed')
        for issue_type in issue_types if isinstance(issue_types, list) else []:
            if not isinstance(issue_type, dict):
                continue
            if kind == 'id':
                if str(issue_type.get('id') or '').strip() != value:
                    continue
            elif str(issue_type.get('name') or '').strip().lower() != 'epic':
                continue
            for status in issue_type.get('statuses') or []:
                if not isinstance(status, dict):
                    continue
                status_id = str(status.get('id') or '').strip()
                name = str(status.get('name') or '').strip()
                if status_id and name and status_id not in seen_status_ids:
                    seen_status_ids.add(status_id)
                    statuses.append({'id': status_id, 'name': name})
    if not statuses:
        return jsonify({
            'error': 'board_statuses_unavailable', 'status': 'error',
            'message': 'Jira returned no usable statuses for the selected projects.',
        }), 502
    payload = {
        'boardId': selection['entry']['scope']['boardId'] or None,
        'projectKeys': project_keys,
        'statuses': statuses,
        'configurationId': selection['id'],
        'configurationRevision': selection['revision'],
        'configurationDigest': selection['digest'],
    }
    if len(project_keys) == 1:
        payload['projectKey'] = project_keys[0]
    return jsonify(payload)


class _IssueTypeCatalogUnavailable(Exception):
    def __init__(self, status_code):
        super().__init__(status_code)
        self.status_code = status_code


_ISSUE_TYPE_PROJECT_CHUNK = 50
_ISSUE_TYPE_PROJECT_CHUNK_LIMIT = 20


def _project_issue_type_applicability(project_keys):
    """Map issue type id -> (sorted project ids, sorted project keys) for the selected projects (all or raise)."""
    if len(project_keys) > _ISSUE_TYPE_PROJECT_CHUNK * _ISSUE_TYPE_PROJECT_CHUNK_LIMIT:
        raise _IssueTypeCatalogUnavailable(0)
    applicable, keys = {}, {}
    for start in range(0, len(project_keys), _ISSUE_TYPE_PROJECT_CHUNK):
        chunk = project_keys[start:start + _ISSUE_TYPE_PROJECT_CHUNK]
        response = current_jira_get('/rest/api/3/project/search', params={
            'keys': chunk, 'expand': 'issueTypes', 'maxResults': _ISSUE_TYPE_PROJECT_CHUNK,
        }, timeout=15)
        if response.status_code != 200:
            raise _IssueTypeCatalogUnavailable(response.status_code)
        data = response.json() or {}
        if data.get('isLast') is False:
            raise _IssueTypeCatalogUnavailable(0)
        for project in data.get('values') or []:
            project_id = str((project or {}).get('id') or '').strip()
            project_key = str((project or {}).get('key') or '').strip()
            if not project_id.isdigit():
                continue
            for issue_type in project.get('issueTypes') or []:
                type_id = str((issue_type or {}).get('id') or '').strip()
                if type_id.isdigit():
                    applicable.setdefault(type_id, set()).add(project_id)
                    if project_key:
                        keys.setdefault(type_id, set()).add(project_key)
    return {
        type_id: (sorted(ids, key=int), sorted(keys.get(type_id, ())))
        for type_id, ids in applicable.items()
    }


def _feature_issue_types(selection):
    try:
        response = current_jira_get('/rest/api/3/issuetype', timeout=15)
        if response.status_code != 200:
            return work_routes.upstream_error_response(response.status_code)
        data = response.json()
        site_url = current_request_auth_context().site_url
        types = {}
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            type_id = str(item.get('id') or '').strip()
            name = str(item.get('name') or '').strip()[:255]
            if not type_id.isdigit() or not name or type_id in types:
                continue
            level = item.get('hierarchyLevel')
            types[type_id] = {
                'id': type_id, 'name': name,
                'hierarchyLevel': level if isinstance(level, int) and not isinstance(level, bool) else None,
                'subtask': item.get('subtask') is True,
                'iconUrl': work_routes.safe_icon_url(item.get('iconUrl'), site_url),
                'projectIds': [], 'projectKeys': [],
            }
        if selection is not None and selection['projects']:
            for type_id, (project_ids, project_keys) in _project_issue_type_applicability(selection['projects']).items():
                if type_id in types:
                    types[type_id]['projectIds'] = project_ids
                    types[type_id]['projectKeys'] = project_keys
    except AuthError:
        raise
    except _IssueTypeCatalogUnavailable as error:
        return work_routes.upstream_error_response(error.status_code)
    except Exception:
        return _scoped_jira_failure()
    return jsonify({
        'issueTypes': sorted(types.values(), key=lambda item: (item['name'].lower(), item['id'])),
        'configurationId': selection['id'] if selection else None,
        'configurationRevision': selection['revision'] if selection else None,
    })



@bp.route('/api/boards', methods=['GET'])
def get_boards():
    """Fetch available boards from Jira API"""
    try:
        query = (request.args.get('query') or '').strip()
        limit_raw = request.args.get('limit') or ''
        try:
            limit = int(limit_raw) if limit_raw else 200
        except ValueError:
            limit = 200
        limit = max(1, min(limit, 500))

        log_info(
            f'Fetching boards mode={"search" if query else "all"} '
            f'limit={limit} queryLen={len(query)}'
        )

        # Get boards from Jira Agile API (paginated)
        boards = []
        seen_board_ids = set()
        start_at = 0
        page_size = 100
        max_pages = 50  # safety cap (up to 5000 boards)
        pages_fetched = 0

        # Fast path: direct board-id lookup for numeric search terms.
        if query and query.isdigit():
            direct_resp = current_jira_get(f'/rest/agile/1.0/board/{query}', timeout=30)
            log_debug(f'Board direct lookup status={direct_resp.status_code} boardId={query}')
            if direct_resp.status_code == 200:
                board = direct_resp.json() or {}
                board_id = board.get('id')
                if board_id is not None and board_id not in seen_board_ids:
                    boards.append(board)
                    seen_board_ids.add(board_id)
            elif direct_resp.status_code not in (400, 401, 403, 404):
                error_text = direct_resp.text
                log_error(f'Board direct lookup failed: status={direct_resp.status_code}')
                return jsonify({
                    'error': f'Jira API error: {direct_resp.status_code}',
                    'details': error_text
                }), direct_resp.status_code

        while pages_fetched < max_pages:
            params = {'maxResults': page_size, 'startAt': start_at}
            if query:
                params['name'] = query
            response = current_jira_get('/rest/agile/1.0/board', params=params, timeout=30)

            log_debug(f'Boards response status={response.status_code} startAt={start_at}')

            if response.status_code != 200:
                error_text = response.text
                log_error(f'Boards fetch failed: status={response.status_code} startAt={start_at}')
                return jsonify({
                    'error': f'Jira API error: {response.status_code}',
                    'details': error_text
                }), response.status_code

            data = response.json() or {}
            page_boards = data.get('values', []) or []
            for board in page_boards:
                board_id = board.get('id')
                if board_id is None or board_id in seen_board_ids:
                    continue
                boards.append(board)
                seen_board_ids.add(board_id)
            pages_fetched += 1

            if query and len(boards) >= limit:
                break

            is_last = bool(data.get('isLast'))
            if is_last:
                break

            if not page_boards:
                break

            # Jira Agile board API typically returns paging metadata;
            # fall back to page length progression if absent.
            start_at = int(data.get('startAt', start_at)) + len(page_boards)
            total = data.get('total')
            if isinstance(total, int) and start_at >= total:
                break

        # Format boards
        formatted_boards = []
        query_lower = query.lower()
        for board in boards:
            formatted = {
                'id': board.get('id'),
                'name': board.get('name'),
                'type': board.get('type'),
                'location': board.get('location', {})
            }
            if query:
                board_id = str(formatted.get('id') or '')
                board_name = str(formatted.get('name') or '').lower()
                if not (
                    query_lower in board_id.lower()
                    or query_lower in board_name
                ):
                    continue
            formatted_boards.append(formatted)

        if query:
            formatted_boards = formatted_boards[:limit]

        log_info(
            f'Found {len(formatted_boards)} boards pages={pages_fetched} '
            f'mode={"search" if query else "all"}'
        )

        success_response = jsonify({'boards': formatted_boards})
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response

    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        logger.exception('Boards endpoint error')
        error_response = jsonify({
            'error': 'Failed to fetch boards from Jira',
            'message': str(e)
        })
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


def _catalog_timestamp(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _catalog_cache_envelope(context, config, snapshot, *, refresh_started=False):
    now = datetime.now(timezone.utc)
    deadline = snapshot.attempt_deadline_at
    if deadline is not None and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    retry_at = snapshot.retry_at
    failure_code = snapshot.failure_code
    refresh_status = snapshot.refresh_status
    if refresh_status == 'pending' and deadline is not None and deadline <= now:
        refresh_status = 'failed'
        failure_code = 'refresh_budget_exhausted'
        retry_at = deadline + timedelta(seconds=300)
    next_refresh = snapshot.next_refresh_at
    if next_refresh is not None and next_refresh.tzinfo is None:
        next_refresh = next_refresh.replace(tzinfo=timezone.utc)
    if refresh_status == 'failed':
        state = 'failed'
    elif refresh_status == 'pending' and deadline is not None and deadline > now:
        state = 'refreshing'
    elif snapshot.payload is None:
        state = 'missing'
    elif next_refresh is None or next_refresh <= now:
        state = 'stale'
    else:
        state = 'fresh'
    return {
        'backend': 'postgresql',
        'identity': config.sprint_identity,
        'browserContextId': catalog_browser_context_id(context),
        'boardId': config.board_id,
        'scopeDigest': None,
        'catalogVersion': snapshot.catalog_version,
        'validatedAt': _catalog_timestamp(snapshot.validated_at),
        'state': state,
        'refreshStarted': bool(refresh_started),
        'refreshFailed': refresh_status == 'failed',
        'refreshAttemptId': snapshot.refresh_attempt_id,
        'refreshStatus': refresh_status,
        'refreshDeadlineAt': _catalog_timestamp(snapshot.attempt_deadline_at),
        'failureCode': failure_code,
        'retryAt': _catalog_timestamp(retry_at),
    }


def _catalog_response(payload, status, started_at, *, retry_after=False):
    response = jsonify(payload)
    response.status_code = status
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Server-Timing'] = (
        f'catalog_db;dur={round((time.perf_counter() - started_at) * 1000, 1)}'
    )
    if retry_after:
        response.headers['Retry-After'] = '1'
    return response


def _db_sprint_response(context, config, snapshot, *, refresh_started, started_at):
    cache = _catalog_cache_envelope(
        context, config, snapshot, refresh_started=refresh_started,
    )
    if snapshot.payload is not None:
        return _catalog_response(
            {'sprints': snapshot.payload, 'cache': cache}, 200, started_at,
        )
    if cache['refreshStatus'] == 'failed':
        return _catalog_response(
            {'error': 'sprint_catalog_unavailable', 'cache': cache}, 502, started_at,
        )
    return _catalog_response(
        {'error': 'catalog_refresh_pending', 'cache': cache}, 503, started_at,
        retry_after=bool(cache['refreshAttemptId']),
    )


def _catalog_auth_required_response(started_at):
    payload, status = oauth_auth_required_payload()
    return _catalog_response(payload, status, started_at)


def _load_and_refresh_board_snapshot(auth_context, config, resolve_config, force_refresh):
    """Board row: load, start a due refresh, reload; returns ``(snapshot, refresh_started)``."""
    snapshot = load_sprint_catalog(auth_context, config=config)
    now = datetime.now(timezone.utc)
    deadline = snapshot.attempt_deadline_at
    if deadline is not None and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    live_attempt = snapshot.refresh_status == 'pending' and deadline is not None and deadline > now
    retry_at = snapshot.retry_at
    if retry_at is not None and retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    next_refresh = snapshot.next_refresh_at
    if next_refresh is not None and next_refresh.tzinfo is None:
        next_refresh = next_refresh.replace(tzinfo=timezone.utc)
    due = snapshot.payload is not None and (next_refresh is None or next_refresh <= now)
    should_refresh = (
        not live_attempt
        and (force_refresh or snapshot.payload is None or due)
        and (force_refresh or retry_at is None or retry_at <= now)
    )
    refresh_started = False
    if should_refresh:
        background = snapshot.payload is not None
        claim = catalog_refresh_runtime().refresh(
            auth_context, kind='sprints', config=config, background=background,
            resolve_config=resolve_config,
        )
        refresh_started = claim is not None
        snapshot = load_sprint_catalog(auth_context, config=config)
        reload_deadline = snapshot.attempt_deadline_at
        if reload_deadline is not None and reload_deadline.tzinfo is None:
            reload_deadline = reload_deadline.replace(tzinfo=timezone.utc)
        matching_live_attempt = bool(
            snapshot.refresh_status == 'pending'
            and snapshot.refresh_attempt_id
            and reload_deadline is not None
            and reload_deadline > datetime.now(timezone.utc)
        )
        if (
            not background and claim is None and snapshot.payload is None
            and matching_live_attempt
        ):
            deadline_at = time.monotonic() + 2
            while time.monotonic() < deadline_at:
                time.sleep(0.1)
                snapshot = load_sprint_catalog(auth_context, config=config)
                if snapshot.payload is not None or snapshot.refresh_status != 'pending':
                    break
    return snapshot, refresh_started


def _load_and_refresh_scoped_snapshot(auth_context, config, resolve_config, force_refresh):
    """Issue-scanned source: same refresh rules, scanned in the request thread."""
    snapshot = load_scoped_sprint_catalog(auth_context, config=config)
    now = datetime.now(timezone.utc)
    deadline = snapshot.attempt_deadline_at
    live_attempt = snapshot.refresh_status == 'pending' and deadline is not None and deadline > now
    due = snapshot.payload is not None and (
        snapshot.next_refresh_at is None or snapshot.next_refresh_at <= now
    )
    retry_at = snapshot.retry_at
    should_refresh = (
        not live_attempt
        and (force_refresh or snapshot.payload is None or due)
        and (force_refresh or retry_at is None or retry_at <= now)
    )
    refresh_started = False
    if should_refresh:
        attempt = refresh_scoped_sprint_catalog(
            auth_context, config=config, resolve_config=resolve_config, force=force_refresh,
        )
        refresh_started = attempt is not None
        snapshot = load_scoped_sprint_catalog(auth_context, config=config)
    return snapshot, refresh_started


def _get_db_sprints(auth_context, *, force_refresh, completion_attempt_id,
                    expected_identity, started_at):
    with session_scope() as catalog_session:
        sources = resolve_request_catalog_sources(catalog_session, auth_context)
        config = (
            None if sources is not None
            else resolve_request_effective_catalog_config(catalog_session, auth_context)
        )
    if sources is not None:
        return _get_configuration_sprints(
            auth_context, sources, force_refresh=force_refresh,
            completion_attempt_id=completion_attempt_id,
            expected_identity=expected_identity, started_at=started_at,
        )
    if {'configurationId', 'configurationRevision', 'configurationDigest'} & set(request.args):
        return _catalog_response({'error': 'unsupported_catalog_parameter'}, 400, started_at)
    if not config.board_id or not config.sprint_identity:
        return _catalog_response({'error': 'sprint_board_required'}, 409, started_at)

    if completion_attempt_id is not None:
        try:
            snapshot = read_catalog_completion(
                auth_context, kind='sprints', attempt_id=completion_attempt_id,
                expected_identity=expected_identity,
                resolve_config=resolve_request_effective_catalog_config,
            )
        except AuthError:
            return _catalog_auth_required_response(started_at)
        except CatalogCompletionError as error:
            if error.code == 'invalid_catalog_completion':
                return _catalog_response({'error': error.code}, 400, started_at)
            source = {
                'backend': 'postgresql', 'identity': config.sprint_identity,
                'boardId': config.board_id,
                'browserContextId': catalog_browser_context_id(auth_context),
            }
            return _catalog_response(
                {'error': error.code, 'sprintCatalogSource': source}, 409, started_at,
            )
        return _db_sprint_response(
            auth_context, config, snapshot, refresh_started=False,
            started_at=started_at,
        )

    try:
        snapshot, refresh_started = _load_and_refresh_board_snapshot(
            auth_context, config, resolve_request_effective_catalog_config, force_refresh,
        )
    except AuthError:
        return _catalog_auth_required_response(started_at)
    return _db_sprint_response(
        auth_context, config, snapshot, refresh_started=refresh_started,
        started_at=started_at,
    )


def _configuration_cache_envelope(auth_context, config, snapshot, *, refresh_started=False, identity_of=None):
    """Envelope of ``snapshot``; ``identity_of`` names the configuration whose identity it answers as."""
    cache = _catalog_cache_envelope(auth_context, config, snapshot, refresh_started=refresh_started)
    owner = identity_of or config
    cache.update({
        'identity': build_projection_identity(owner),
        'rowIdentity': owner.sprint_identity,
        'configurationId': config.configuration_id,
        'configurationRevision': config.configuration_revision,
        'sourceMode': owner.source_mode,
        'sourceDigest': config.source_digest,
        'boardId': owner.board_id or None,
    })
    return cache


def _configuration_source_result(auth_context, config, *, force_refresh):
    """One saved configuration's source: rows inside its range, envelope, usability state."""
    base = {
        'configurationId': config.configuration_id,
        'configurationRevision': config.configuration_revision,
        'fromQuarter': config.from_quarter, 'throughQuarter': config.through_quarter,
        'sourceMode': config.source_mode, 'sprints': [], 'cache': None,
    }
    if not config.sprint_identity or (config.board_inherited and config.observed_source is None):
        base.update(
            state='setup_required',
            missingFields=list(config.missing_admin_settings),
            code=config.scope_error or 'configuration_incomplete',
        )
        base['diagnostics'] = work_routes.source_diagnostics('setup_required', base['code'])
        return base, None, None
    resolve = catalog_configuration_resolver(config.configuration_id)
    if config.board_inherited:
        # An inherited Board's Sprint ids belong to the configuration that owns it: this
        # configuration lists only its own issue scan, and never falls back to Board rows.
        source = config.observed_source
        snapshot, started = _load_and_refresh_scoped_snapshot(
            auth_context, source, catalog_configuration_resolver(config.configuration_id, observed=True),
            force_refresh,
        )
    elif config.source_mode == work_structure_service.SOURCE_MODE_SCOPED_ISSUES:
        source = config
        snapshot, started = _load_and_refresh_scoped_snapshot(
            auth_context, config, resolve, force_refresh,
        )
    else:
        source = config
        snapshot, started = _load_and_refresh_board_snapshot(
            auth_context, config, resolve, force_refresh,
        )
    cache = _configuration_cache_envelope(
        auth_context, source, snapshot, refresh_started=started, identity_of=config,
    )
    rows = None
    if snapshot.payload is not None:
        rows = in_range_sprints(source, snapshot.payload)
    scanned = None
    observed_rows = None
    if config.observed_source is not None and source is config:
        # A Board lists only its own Sprints: also scan the configuration's scoped issues so a
        # Sprint carried by its work but absent from the Board is admitted. A failed or pending
        # scan never degrades the Board result; with its own Board, the Board row wins a
        # same-name tie.
        observed = config.observed_source
        scan, scan_started = _load_and_refresh_scoped_snapshot(
            auth_context, observed, catalog_configuration_resolver(config.configuration_id, observed=True),
            force_refresh,
        )
        scanned = scan
        if scan.payload is not None:
            observed_rows = in_range_sprints(observed, scan.payload)
            names = {item.get('name') for item in rows or []}
            rows = (rows or []) + [item for item in observed_rows if item.get('name') not in names]
            if snapshot.payload is None:
                cache = {
                    **_configuration_cache_envelope(auth_context, observed, scan, refresh_started=scan_started),
                    'identity': cache['identity'], 'rowIdentity': cache['rowIdentity'],
                    'sourceMode': config.source_mode, 'boardId': config.board_id or None,
                }
            cache['refreshStarted'] = bool(cache['refreshStarted'] or scan_started)
    if rows is not None:
        rows = [
            {**item, 'configurationId': config.configuration_id, 'sourceIdentity': cache['identity']}
            for item in rows
        ]
        state = 'ready'
    elif cache['refreshStatus'] == 'failed':
        state = 'failed'
    else:
        state = 'refreshing'
    base.update(
        state=state, cache=cache, sprints=rows or [], code=cache['failureCode'],
        sprintCount=len(rows) if rows is not None else None,
        diagnostics=work_routes.source_diagnostics(state, cache['failureCode'], snapshot, scanned),
    )
    return base, snapshot, rows


def _merged_cache_envelope(auth_context, configs, results, *, refresh_started):
    ready = [item for item in results if item['state'] == 'ready']
    if ready:
        state = 'stale' if any(item['cache']['state'] == 'stale' for item in ready) else 'fresh'
    elif any(item['state'] == 'refreshing' for item in results):
        state = 'refreshing'
    elif any(item['state'] == 'failed' for item in results):
        state = 'failed'
    else:
        state = 'missing'
    failed = [item['cache'] for item in results if item['state'] == 'failed']
    pending = [item['cache'] for item in results if item['state'] == 'refreshing']
    versions = sorted(str(item['cache']['catalogVersion']) for item in ready)
    validated = [item['cache']['validatedAt'] for item in ready if item['cache']['validatedAt']]
    return {
        'backend': 'postgresql',
        'identity': build_merged_catalog_identity(configs),
        'browserContextId': catalog_browser_context_id(auth_context),
        'boardId': None,
        'scopeDigest': None,
        'catalogVersion': ':'.join(versions) if versions else None,
        'validatedAt': min(validated) if validated else None,
        'state': state,
        'refreshStarted': bool(refresh_started),
        'refreshFailed': bool(failed),
        'refreshAttemptId': None,
        'refreshStatus': 'failed' if failed else 'pending' if pending else 'completed' if ready else 'idle',
        'refreshDeadlineAt': None,
        'failureCode': failed[0]['failureCode'] if failed else None,
        'retryAt': failed[0]['retryAt'] if failed else None,
    }


def _get_configuration_sprints(auth_context, sources, *, force_refresh,
                               completion_attempt_id, expected_identity, started_at):
    """Promoted workspace: merge configuration-scoped rows with original physical ids."""
    ids = request.args.getlist('configurationId')
    configuration_id = ids[0] if ids else None
    if len(ids) > 1 or (
        configuration_id is not None and _CONFIGURATION_ID_PATTERN.fullmatch(configuration_id) is None
    ):
        return _catalog_response(
            work_routes.WorkConfigError('invalid_configuration_id').response()[0], 400, started_at,
        )
    selected = list(sources)
    if configuration_id is not None:
        selected = [item for item in sources if item.configuration_id == configuration_id]
        if not selected:
            return _catalog_response(
                work_routes.WorkConfigError('sprint_catalog_mismatch').response()[0], 409, started_at,
            )
    try:
        work_routes.check_catalog_stamp(
            request.args, configuration_id=configuration_id,
            revisions=[item.configuration_revision for item in selected])
    except work_routes.WorkConfigError as error:
        body, status = error.response()
        return _catalog_response(body, status, started_at)
    if completion_attempt_id is not None:
        return _configuration_completion_response(
            auth_context, selected, configuration_id, completion_attempt_id, expected_identity,
            started_at,
        )
    try:
        results, refreshed = [], False
        for config in selected:
            result, _snapshot, _rows = _configuration_source_result(
                auth_context, config, force_refresh=force_refresh,
            )
            results.append(result)
            refreshed = refreshed or bool(result['cache'] and result['cache']['refreshStarted'])
    except AuthError:
        return _catalog_auth_required_response(started_at)
    rows = sorted(
        (row for result in results if result['state'] == 'ready' for row in result['sprints']),
        key=lambda item: item['name'], reverse=True,
    )
    summaries = [{key: value for key, value in result.items() if key != 'sprints'} for result in results]
    if len(results) == 1 and results[0]['cache'] is not None:
        cache = results[0]['cache']
    else:
        cache = _merged_cache_envelope(auth_context, selected, results, refresh_started=refreshed)
    body = {'sources': summaries, 'cache': cache}
    if any(result['state'] == 'ready' for result in results):
        return _catalog_response({**body, 'sprints': rows}, 200, started_at)
    if all(result['state'] == 'setup_required' for result in results):
        missing = sorted({path for result in results for path in result['missingFields']})
        error = work_routes.WorkConfigError('configuration_incomplete', paths=missing)
        error_body, status = error.response()
        return _catalog_response({**error_body, **body}, status, started_at)
    if any(result['state'] == 'refreshing' for result in results):
        attempts = [
            result['cache']['refreshAttemptId'] for result in results if result['state'] == 'refreshing'
        ]
        return _catalog_response(
            {**body, 'error': 'catalog_refresh_pending'}, 503, started_at,
            retry_after=any(attempts),
        )
    return _catalog_response({**body, 'error': 'sprint_catalog_unavailable'}, 502, started_at)


def _configuration_completion_response(auth_context, selected, configuration_id,
                                       attempt_id, expected_identity, started_at):
    """Read one identified attempt of one configuration source; never admits Jira work."""
    if configuration_id is None or len(selected) != 1:
        return _catalog_response({'error': 'invalid_catalog_completion'}, 400, started_at)
    config = selected[0]
    projection = build_projection_identity(config)
    source = {
        'backend': 'postgresql', 'identity': projection, 'boardId': config.board_id or None,
        'browserContextId': catalog_browser_context_id(auth_context),
        'configurationId': config.configuration_id,
    }
    # An inherited Board with no own scan lists as setup_required; never complete from Board rows.
    if not config.sprint_identity or (config.board_inherited and config.observed_source is None):
        return _catalog_response(
            {'error': 'catalog_identity_changed', 'sprintCatalogSource': source}, 409, started_at,
        )
    # An inherited Board's attempts are the own issue scan's (``_configuration_source_result``).
    scan = config.observed_source if config.board_inherited else None
    row_source = scan or config
    row_identity = row_source.sprint_identity if expected_identity == projection else expected_identity
    resolve = catalog_configuration_resolver(config.configuration_id)
    try:
        if scan is not None or config.source_mode == work_structure_service.SOURCE_MODE_SCOPED_ISSUES:
            snapshot = read_scoped_sprint_completion(
                auth_context, attempt_id=attempt_id, expected_identity=row_identity, config=row_source,
            )
        else:
            snapshot = read_catalog_completion(
                auth_context, kind='sprints', attempt_id=attempt_id,
                expected_identity=row_identity, resolve_config=resolve,
            )
    except AuthError:
        return _catalog_auth_required_response(started_at)
    except CatalogCompletionError as error:
        if error.code == 'invalid_catalog_completion':
            return _catalog_response({'error': error.code}, 400, started_at)
        return _catalog_response(
            {'error': error.code, 'sprintCatalogSource': source}, 409, started_at,
        )
    cache = _configuration_cache_envelope(
        auth_context, row_source, snapshot, refresh_started=False, identity_of=config,
    )
    if snapshot.payload is not None:
        rows = [
            {**item, 'configurationId': config.configuration_id, 'sourceIdentity': cache['identity']}
            for item in in_range_sprints(row_source, snapshot.payload)
        ]
        return _catalog_response({'sprints': rows, 'cache': cache}, 200, started_at)
    if cache['refreshStatus'] == 'failed':
        return _catalog_response({'error': 'sprint_catalog_unavailable', 'cache': cache}, 502, started_at)
    return _catalog_response(
        {'error': 'catalog_refresh_pending', 'cache': cache}, 503, started_at,
        retry_after=bool(cache['refreshAttemptId']),
    )


@bp.route('/api/sprints', methods=['GET'])
def get_sprints():
    """Fetch the Sprint catalog from its selected compatibility backend."""
    started_at = time.perf_counter()
    try:
        allowed_parameters = {
            'refresh', 'completionAttemptId', 'catalogIdentity', 'configurationId',
            'configurationRevision', 'configurationDigest',
        }
        if any(key not in allowed_parameters for key in request.args):
            return _catalog_response(
                {'error': 'unsupported_catalog_parameter'}, 400, started_at,
            )
        force_value = request.args.get('refresh')
        force_refresh = force_value == 'true'
        completion_attempt_id = request.args.get('completionAttemptId')
        expected_identity = request.args.get('catalogIdentity')
        has_completion = completion_attempt_id is not None or expected_identity is not None
        if (
            any(len(request.args.getlist(key)) != 1 for key in request.args if key != 'configurationId')
            or force_value is not None and force_value != 'true'
            or has_completion and (
                force_refresh or not completion_attempt_id or not expected_identity
            )
        ):
            return _catalog_response(
                {'error': 'invalid_catalog_completion'}, 400, started_at,
            )
        auth_context = current_request_auth_context()
        if 'configurationId' in request.args and not (
            config_storage_db_enabled() and is_db_auth_context(auth_context)
        ):
            return _catalog_response(
                {'error': 'unsupported_catalog_parameter'}, 400, started_at,
            )
        if config_storage_db_enabled() and is_db_auth_context(auth_context):
            return _get_db_sprints(
                auth_context, force_refresh=force_refresh,
                completion_attempt_id=completion_attempt_id,
                expected_identity=expected_identity, started_at=started_at,
            )
        file_cache_enabled = _settings_process_cache_enabled()
        process_cache_enabled = jira_home_partitioned_process_cache_enabled(auth_context)
        board_id = str(get_effective_board_id() or '').strip()
        process_cache_key = build_jira_home_process_cache_key(auth_context, board_id)

        formatted_sprints = []

        if process_cache_enabled and not force_refresh:
            with _cache_lock:
                cached_entry = SPRINTS_PROCESS_CACHE.get(process_cache_key)
            if cached_entry and (time.time() - cached_entry.get('timestamp', 0)) < CACHE_EXPIRY_HOURS * 3600:
                formatted_sprints = cached_entry.get('data') or []
                log_info(f'Loaded {len(formatted_sprints)} sprints from process cache')

        # Check if we should use cache
        if not formatted_sprints and file_cache_enabled and not force_refresh and is_cache_valid():
            cache_data = load_sprints_cache()
            if cache_data and 'sprints' in cache_data:
                formatted_sprints = cache_data['sprints']
                log_info(f'Loaded {len(formatted_sprints)} sprints from cache')

        # If no valid cache or force refresh, fetch from Jira
        if not formatted_sprints or force_refresh:
            if force_refresh:
                log_info('Force refresh requested')

            formatted_sprints = fetch_sprints_from_jira()

            # Save to cache
            if file_cache_enabled and formatted_sprints:
                save_sprints_cache(formatted_sprints)

        if process_cache_enabled and formatted_sprints:
            with _cache_lock:
                SPRINTS_PROCESS_CACHE[process_cache_key] = {
                    'timestamp': time.time(),
                    'data': formatted_sprints,
                }

        log_info(f'Total quarterly sprints: {len(formatted_sprints)}')

        success_response = jsonify({'sprints': formatted_sprints})
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response

    except AuthError:
        if config_storage_db_enabled():
            return _catalog_auth_required_response(started_at)
        payload, status = oauth_auth_required_payload()
        return _catalog_response(payload, status, started_at)
    except work_routes.WorkConfigError as error:
        body, status = error.response()
        return _catalog_response(body, status, started_at)
    except (ConfigStorageError, DatabaseConfigurationError):
        logger.warning('Sprint catalog storage is unavailable')
        return _catalog_response({'error': 'catalog_storage_unavailable'}, 503, started_at)
    except Exception:
        if config_storage_db_enabled():
            logger.exception('Sprint catalog request failed')
            return _catalog_response({'error': 'catalog_storage_unavailable'}, 503, started_at)
        logger.exception('Sprints endpoint error')
        error_response = jsonify({'error': 'Failed to fetch sprints from Jira'})
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


def epm_view_enabled_for_bootstrap(auth_context, view_config):
    """Owner-private Enable EPM view flag; false for Basic/JSON/non-DB storage and when nothing is saved."""
    if not config_storage_db_enabled() or not is_db_auth_context(auth_context):
        return False
    if view_config is not None:
        return (((view_config.get('view') or {}).get('epm') or {}).get('viewEnabled')) is True
    return db_repository().load_user_epm_view_enabled(auth_context) is True


@bp.route('/api/config', methods=['GET'])
def get_config():
    """Get public configuration"""
    from backend.services.load_performance import collection_enabled
    auth_context = current_request_auth_context()
    include_view_config = str(request.args.get('includeViewConfig') or '').strip().lower() in {'1', 'true', 'yes'}
    try:
        view_config = _resolve_bootstrap_view_config(auth_context) if include_view_config else None
        effective_catalog_config = None
        if config_storage_db_enabled() and is_db_auth_context(auth_context):
            with session_scope() as catalog_session:
                effective_catalog_config = resolve_request_effective_catalog_config(
                    catalog_session, auth_context,
                )
            shared_config = dict(effective_catalog_config.workspace_payload or {})
            shared_config_revision = effective_catalog_config.config_revision
            board_section = shared_config.get('board')
            board_cfg = {
                'boardId': effective_catalog_config.board_id,
                'boardName': str(
                    (board_section or {}).get('boardName')
                    if isinstance(board_section, dict) else ''
                ).strip(),
                'source': (
                    'config' if isinstance(board_section, dict)
                    else 'env' if effective_catalog_config.board_id
                    else 'default'
                ),
            }
        else:
            shared_snapshot = load_dashboard_config_snapshot()
            shared_config = dict(shared_snapshot.payload or {})
            shared_config_revision = shared_snapshot.config_revision
            board_cfg = get_board_config()
        db_oauth_bootstrap = effective_catalog_config is not None
        work_flag = work_structure_service.work_configurations_enabled() and db_oauth_bootstrap
        work_promoted = db_oauth_bootstrap and work_structure_service.is_promoted(shared_config)
        if work_promoted:
            # No moved-key getter, Board or Jira work on a promoted bootstrap; the
            # bundle editor owns the full projection.
            board_cfg = {}
            work_bundle = work_structure_service.stored_bundle(shared_config)
            work_type_names = shared_config.get(work_structure_service.WORK_CONFIGURATION_TYPE_NAMES_KEY)
            for moved_key in (*work_structure_service.MOVED_STRUCTURAL_KEYS,
                              work_structure_service.WORK_CONFIGURATIONS_KEY):
                shared_config.pop(moved_key, None)
        shared_config.pop('epm', None)
        shared_config.pop(work_structure_service.WORK_CONFIGURATION_TYPE_NAMES_KEY, None)
        if include_view_config and view_config is not None:
            epm_config = normalize_epm_config(
                ((view_config or {}).get('view') or {}).get('epm') or {}
            )
        else:
            epm_config = get_epm_config(context=auth_context)
        epm_view_enabled = epm_view_enabled_for_bootstrap(auth_context, view_config)
        capacity_config = load_request_capacity_config(auth_context)
    except (ConfigStorageError, UserViewConfigStorageError, DatabaseConfigurationError) as error:
        logger.error('Dashboard bootstrap EPM config read failed errorClass=%s', type(error).__name__)
        return jsonify({
            'error': 'config_storage_unavailable',
            'message': 'EPM configuration storage is unavailable.',
        }), 503
    can_edit_shared_configuration = (not SETTINGS_ADMIN_ONLY) or bool(auth_context.is_admin)
    payload = {
        'jiraUrl': auth_context.site_url,
        'authMode': auth_context.auth_mode,
        'capacityProject': capacity_config.get('project', ''),
        'capacityConfigRequiresResolution': capacity_config.get('requiresResolution') is True,
        'capacityMutationEnabled': capacity_config.get('mutationEnabled') is True,
        'settingsAdminOnly': bool(SETTINGS_ADMIN_ONLY),
        'performanceDebugEnabled': collection_enabled(),
        'performanceAdminAvailable': bool(auth_context.is_admin),
        # The DB/OAuth adapter has passed the strict transport and completeness gates. Basic/JSON
        # keeps failing closed until its deployment-specific performance evidence is collected.
        'boardAllWorkAvailable': eng_board.strict_adapter_available(
            auth_context.auth_mode,
            database_backed=is_db_auth_context(auth_context) and config_storage_db_enabled(),
        ),
        'userCanEditSettings': can_edit_shared_configuration,
        # Scenario is for editors unless this workspace switch unlocks it; Scenario routes enforce the same rule.
        'scenarioPlannerForEveryone': scenario_planner_for_everyone(shared_config),
        'userCanEditViewConfig': True,
        'userCanEditEpmConfig': True,
        'adminUserManagementAvailable': is_db_auth_context(auth_context),
        'userIsToolAdmin': bool(auth_context.is_admin),
        'groupsConfigPath': resolve_groups_config_path(),
        'groupQueryTemplateEnabled': bool(JQL_QUERY_TEMPLATE),
        'epm': epm_config,
        'epmViewEnabled': epm_view_enabled,
        'workConfigurationsEnabled': work_flag,
        'workConfigurationsPromoted': work_promoted,
        'workConfigurationSummaries': [],
        'adminSettingsMissingByConfiguration': {},
    }
    if work_promoted:
        payload['environmentConfigExists'] = _environment_dashboard_config_exists(shared_config)
        entries = work_bundle['configurations']
        type_names = work_type_names if isinstance(work_type_names, dict) else {}
        payload['workConfigurationSummaries'] = [
            work_routes.entry_summary(entry, entries, type_names.get(entry['id'])) for entry in entries
        ]
        payload['adminSettingsMissingByConfiguration'] = {
            entry['id']: work_routes.entry_missing_fields(work_structure_service.effective_entry(entries, entry))
            for entry in entries
        }
    else:
        payload.update({
            'boardId': board_cfg.get('boardId', ''),
            'boardName': board_cfg.get('boardName', ''),
            'boardConfigSource': board_cfg.get('source', 'default'),
            'projectsConfigured': bool(get_selected_projects()),
            'environmentConfigExists': _environment_dashboard_config_exists(),
        })
    # Readiness from the provider-confirmed grant only; bootstrap makes no Home call.
    epm_home_profile = select_epm_home_read_profile(auth_context, view_enabled=epm_view_enabled)
    payload['epmHomeReadAvailable'] = epm_home_profile == HOME_READ_PROFILE_PUBLIC_READ_V1
    if epm_home_profile == HOME_READ_PROFILE_SCOPE_REQUIRED:
        payload['epmHomeReadLoginUrl'] = SCOPE_LOGIN_URL
    if effective_catalog_config is not None and work_promoted:
        # Per-entry missing setup; blank DELIVERY must not lock Legacy, so no AND.
        missing_admin_settings = [
            path for paths in payload['adminSettingsMissingByConfiguration'].values() for path in paths
        ]
        if missing_admin_settings and not can_edit_shared_configuration:
            with session_scope() as admin_session:
                payload['adminContacts'] = workspace_tool_admin_display_names(
                    admin_session, auth_context.workspace_id,
                )
    elif effective_catalog_config is not None:
        payload['sprintCatalogSource'] = {
            'backend': 'postgresql',
            'identity': effective_catalog_config.sprint_identity,
            'boardId': effective_catalog_config.board_id,
            'browserContextId': catalog_browser_context_id(auth_context),
        }
        # An unconfigured workspace blocks ENG loading; editors fix it, everyone else
        # sees only who to contact (display names, never the user directory).
        missing_admin_settings = list(effective_catalog_config.missing_admin_settings)
        payload['adminSettingsMissing'] = missing_admin_settings
        if missing_admin_settings and not can_edit_shared_configuration:
            with session_scope() as admin_session:
                payload['adminContacts'] = workspace_tool_admin_display_names(
                    admin_session, auth_context.workspace_id,
                )
    if config_storage_db_enabled():
        payload['sharedConfig'] = shared_config
        payload['sharedConfigRevision'] = shared_config_revision
    if view_config is not None:
        payload['viewConfig'] = view_config
    return jsonify(payload)


@bp.route('/api/groups-config', methods=['GET'])
def get_groups_config():
    """Return the saved team groups configuration."""
    auth_context = _shared_group_db_auth_context()
    config = shared_group_config.load_effective_groups(
        auth_context,
        fallback_loader=lambda: load_dashboard_config(source='jsonfile'),
        validate_groups_config_fn=validate_groups_config,
        dashboard_loader=load_dashboard_config,
        groups_file_loader=lambda: load_groups_config_file(resolve_groups_config_path()),
        environment_loader=parse_groups_config_env,
        default_builder=build_default_groups_config,
    )
    if auth_context is not None:
        config['preferences'] = shared_group_config.load_group_preferences(auth_context, config)
        return jsonify(config)
    config['preferences'] = shared_group_config.normalize_group_preferences(
        {},
        config,
        preference_exists=False,
        require_first_run=False,
    )
    return jsonify(config)


@bp.route('/api/groups-config', methods=['POST'])
def save_groups_config():
    """Persist team groups configuration to disk."""
    payload = request.get_json(silent=True) or {}
    if _unsupported_group_fields(payload):
        return jsonify({'error': 'unsupported_group_config_field'}), 400

    comma_scalar_errors = find_comma_scalar_team_label_errors(payload)

    auth_context = _shared_group_db_auth_context()
    if auth_context is not None:
        if comma_scalar_errors:
            return jsonify({'error': 'invalid_groups_config', 'errors': comma_scalar_errors}), 400
        current = shared_group_config.load_shared_groups(
            auth_context,
            fallback_loader=lambda: load_dashboard_config(source='jsonfile'),
            validate_groups_config_fn=validate_groups_config,
        )
        if not payload.get('clearGroups') and not payload.get('groups') and _has_dashboard_config_value(current.get('groups')):
            return jsonify({'error': 'team_groups_cannot_be_cleared_implicitly'}), 400
        try:
            saved = shared_group_config.save_shared_groups(
                auth_context,
                payload,
                payload.get('baseRevision'),
                validate_groups_config_fn=validate_groups_config,
            )
        except shared_group_config.GroupConfigConflict as error:
            return jsonify({
                'error': 'group_config_conflict',
                'message': 'Team groups were changed by another user. Reload the latest groups before saving.',
                'current': error.current,
            }), 409
        except shared_group_config.InvalidSharedGroupConfig as error:
            return jsonify({'error': 'invalid_groups_config', 'errors': list(error.errors)}), 400
        saved['preferences'] = shared_group_config.load_group_preferences(auth_context, saved)
        return jsonify(saved)

    if comma_scalar_errors:
        return jsonify({'errors': comma_scalar_errors}), 400

    normalized, errors, warnings = validate_groups_config(payload, allow_empty=True)
    if errors:
        return jsonify({'errors': errors}), 400

    # Save into unified dashboard config, preserving other sections
    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}}
        existing_team_groups = dashboard_config.get('teamGroups') or {}
        existing_groups = existing_team_groups.get('groups') if isinstance(existing_team_groups, dict) else []
        if not payload.get('clearGroups') and not normalized.get('groups') and _has_dashboard_config_value(existing_groups):
            return jsonify({'error': 'team groups cannot be cleared implicitly'}), 400
        dashboard_config['teamGroups'] = normalized
        save_dashboard_config(dashboard_config)
    except Exception as e:
        return jsonify({'error': 'Failed to save groups config', 'message': str(e)}), 500

    if warnings:
        normalized['warnings'] = warnings
    normalized['source'] = 'file'
    normalized['preferences'] = shared_group_config.normalize_group_preferences(
        {},
        normalized,
        preference_exists=False,
        require_first_run=False,
    )
    return jsonify(normalized)


@bp.route('/api/groups-preferences', methods=['POST'])
def save_groups_preferences():
    """Persist the current user's visible Department group preferences."""
    if not request.is_json:
        return jsonify({'error': 'invalid_json'}), 400
    try:
        payload = request.get_json()
    except BadRequest:
        return jsonify({'error': 'invalid_json'}), 400
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_group_preferences'}), 400
    if set(payload) - _GROUP_PREFERENCE_FIELDS:
        return jsonify({'error': 'unsupported_group_preference_field'}), 400
    auth_context = _shared_group_db_auth_context()
    if auth_context is None:
        return jsonify({'error': 'group_preferences_db_required'}), 409

    groups_config = shared_group_config.load_shared_groups(
        auth_context,
        fallback_loader=lambda: load_dashboard_config(source='jsonfile'),
        validate_groups_config_fn=validate_groups_config,
    )
    try:
        preferences = shared_group_config.save_group_preferences(
            auth_context,
            payload,
            groups_config,
        )
    except shared_group_config.InvalidGroupPreferences as error:
        return jsonify({'error': 'invalid_group_preferences', 'message': str(error)}), 400
    groups_config_snapshot = dict(groups_config)
    groups_config_snapshot['preferences'] = preferences
    return jsonify({
        'preferences': preferences,
        'groupsConfigSnapshot': groups_config_snapshot,
    })


@bp.route('/api/me/onboarding', methods=['POST'])
def save_onboarding_preference():
    """Persist the current user's onboarding completion state."""
    if not request.is_json:
        return jsonify({'error': 'invalid_json'}), 400
    try:
        payload = request.get_json()
    except BadRequest:
        return jsonify({'error': 'invalid_json'}), 400
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if set(payload) - _ONBOARDING_PREFERENCE_FIELDS:
        return jsonify({'error': 'unsupported_onboarding_field'}), 400
    if not payload:
        return jsonify({'error': 'onboarding_done_required'}), 400
    if len(payload) != 1:
        return jsonify({'error': 'unsupported_onboarding_field'}), 400

    completed_module = payload.get('completedModule')
    if 'completedModule' in payload:
        if (
            not isinstance(completed_module, str)
            or completed_module not in shared_group_config.ONBOARDING_MODULE_IDS
        ):
            return jsonify({'error': 'invalid_onboarding_module'}), 400
    else:
        onboarding_done = payload.get('onboardingDone')
        if not isinstance(onboarding_done, bool):
            return jsonify({'error': 'onboarding_done_required'}), 400

    try:
        auth_context = _shared_group_db_auth_context()
        if auth_context is None:
            return jsonify({'error': 'onboarding_db_required'}), 409
        if 'completedModule' in payload:
            saved_onboarding = shared_group_config.complete_onboarding_module(
                auth_context,
                completed_module,
            )
        else:
            saved_onboarding = shared_group_config.set_onboarding_done(
                auth_context,
                onboarding_done,
            )
    except (
        ConfigStorageError,
        DatabaseConfigurationError,
        shared_group_config.OnboardingStorageUnavailable,
    ) as error:
        return _onboarding_storage_error_response(error)
    except shared_group_config.OnboardingPreferencesUnavailable:
        return jsonify({'error': 'onboarding_db_required'}), 409
    except shared_group_config.InvalidOnboardingModule:
        return jsonify({'error': 'invalid_onboarding_module'}), 400
    except shared_group_config.GroupSelectionRequired:
        return jsonify({'error': 'group_selection_required'}), 409
    return jsonify(saved_onboarding)


@bp.route('/api/team-catalog', methods=['GET'])
def get_team_catalog():
    """Return the team name catalog."""
    if config_storage_db_enabled():
        team_catalog = _load_team_catalog_dashboard_config()
        return jsonify({
            "catalog": normalize_team_catalog(team_catalog.get("catalog") or {}),
            "meta": normalize_team_catalog_meta(team_catalog.get("meta") or {}),
        })
    migrate_team_catalog_from_config()
    data = load_team_catalog()
    return jsonify(data)


@bp.route('/api/team-catalog', methods=['POST'])
def post_team_catalog():
    """Save the team name catalog."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    unknown = set(payload) - {'catalog', 'meta', 'merge'}
    if unknown:
        return jsonify({'error': 'unsupported_team_catalog_field'}), 400
    merge = payload.get('merge', False)
    incoming = {
        'catalog': normalize_team_catalog(payload.get('catalog') or {}),
        'meta': normalize_team_catalog_meta(payload.get('meta') or {})
    }
    if merge:
        if not config_storage_db_enabled():
            existing = load_team_catalog()
            merged_catalog = {**existing['catalog'], **incoming['catalog']}
            incoming['catalog'] = merged_catalog
    if config_storage_db_enabled():
        try:
            saved = db_repository().save_team_catalog(
                current_request_auth_context(), incoming, merge=bool(merge),
            )
        except TeamCatalogConflict:
            return jsonify({'error': 'team_catalog_conflict'}), 409
        except WorkspaceConfigFenceUnavailable:
            return _config_fence_unavailable_response()
        return jsonify(saved)
    saved = save_team_catalog_file(incoming)
    return jsonify(saved)


@bp.route('/api/projects', methods=['GET'])
def get_jira_projects():
    """Fetch available Jira projects via project search API with caching."""
    try:
        query = request.args.get('query', '').strip()
        limit_raw = request.args.get('limit', '').strip()
        refresh = request.args.get('refresh', '').strip().lower() in ('1', 'true', 'yes')
        cache_enabled = _settings_process_cache_enabled()

        # Return cached data only for full-list requests (no query/limit), unless refresh requested.
        if cache_enabled:
            with _cache_lock:
                if (not refresh and not query and not limit_raw and
                        PROJECTS_CACHE['data'] and (time.time() - PROJECTS_CACHE['timestamp']) < PROJECTS_CACHE_TTL):
                    return jsonify({'projects': PROJECTS_CACHE['data']})

        limit = None
        if limit_raw:
            try:
                limit = max(1, min(int(limit_raw), 500))
            except ValueError:
                return jsonify({'error': 'limit must be an integer'}), 400

        all_projects = []
        start_at = 0
        max_results = 200
        while True:
            params = {
                'startAt': start_at,
                'maxResults': max_results,
                'orderBy': 'key'
            }
            if query:
                params['query'] = query

            response = current_jira_get('/rest/api/3/project/search', params=params, timeout=15)
            if response.status_code != 200:
                return jsonify({'error': 'Failed to fetch projects', 'details': response.text}), response.status_code
            data = response.json()
            values = data.get('values', [])
            for proj in values:
                all_projects.append({
                    'key': proj.get('key', ''),
                    'name': proj.get('name', ''),
                    'id': proj.get('id', '')
                })
                if limit and len(all_projects) >= limit:
                    break

            if limit and len(all_projects) >= limit:
                all_projects = all_projects[:limit]
                break

            if data.get('isLast', True):
                break

            next_start = None
            next_page = data.get('nextPage')
            if next_page:
                parsed = parse_qs(urlparse(next_page).query)
                start_at_values = parsed.get('startAt') or parsed.get('startat')
                if start_at_values:
                    try:
                        next_start = int(start_at_values[0])
                    except (TypeError, ValueError):
                        next_start = None

            if next_start is None:
                response_page_size = data.get('maxResults')
                try:
                    response_page_size = int(response_page_size)
                except (TypeError, ValueError):
                    response_page_size = 0
                step = response_page_size if response_page_size > 0 else len(values)
                if step <= 0:
                    break
                next_start = start_at + step

            if next_start <= start_at:
                next_start = start_at + max(1, len(values))
            start_at = next_start

        # Cache results (only for unfiltered full list)
        if cache_enabled and not query:
            with _cache_lock:
                PROJECTS_CACHE['data'] = all_projects
                PROJECTS_CACHE['timestamp'] = time.time()

        return jsonify({'projects': all_projects})
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': 'Failed to fetch projects', 'details': str(e)}), 500


@bp.route('/api/components', methods=['GET'])
def get_jira_components():
    """Fetch Jira components across selected projects with caching."""
    try:
        query = request.args.get('query', '').strip().lower()
        limit_raw = request.args.get('limit', '').strip()
        cache_enabled = _settings_process_cache_enabled()

        limit = 25
        if limit_raw:
            try:
                limit = max(1, min(int(limit_raw), 200))
            except ValueError:
                return jsonify({'error': 'limit must be an integer'}), 400

        selection, failure = _metadata_selection(required=True)
        if failure is not None:
            return failure
        if selection is not None:
            return _scoped_components(selection, query, limit)

        # Return cached data when no query is specified and cache is fresh
        if cache_enabled:
            with _cache_lock:
                if (not query and COMPONENTS_CACHE['data'] and
                        (time.time() - COMPONENTS_CACHE['timestamp']) < COMPONENTS_CACHE_TTL):
                    return jsonify({'components': COMPONENTS_CACHE['data'][:limit]})

        projects = get_selected_projects()
        if not projects:
            return jsonify({'components': []})

        seen_names = set()
        all_components = []
        for project_key in projects:
            try:
                resp = current_jira_get(f'/rest/api/3/project/{project_key}/components', timeout=10)
                if resp.status_code != 200:
                    continue
                for comp in (resp.json() or []):
                    name = (comp.get('name') or '').strip()
                    if not name:
                        continue
                    name_lower = name.lower()
                    if name_lower in seen_names:
                        continue
                    seen_names.add(name_lower)
                    all_components.append({
                        'id': comp.get('id', ''),
                        'name': name,
                        'projectKey': project_key
                    })
            except AuthError:
                raise
            except Exception:
                continue

        all_components.sort(key=lambda c: c['name'].lower())

        # Cache the full unfiltered list
        if cache_enabled and not query:
            with _cache_lock:
                COMPONENTS_CACHE['data'] = all_components
                COMPONENTS_CACHE['timestamp'] = time.time()

        # Apply query filter
        if query:
            all_components = [c for c in all_components if query in c['name'].lower()]

        return jsonify({'components': all_components[:limit]})
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': 'Failed to fetch components', 'details': str(e)}), 500


@bp.route('/api/epics/search', methods=['GET'])
def search_epics():
    """Search epics by key or summary across selected projects."""
    try:
        query = str(request.args.get('query') or '').strip()
        if not query:
            return jsonify({'epics': []})

        limit_raw = str(request.args.get('limit') or '').strip()
        limit = 15
        if limit_raw:
            try:
                limit = max(1, min(int(limit_raw), 100))
            except ValueError:
                return jsonify({'error': 'limit must be an integer'}), 400

        selection, failure = _metadata_selection(required=True, allow_quarter_only=True)
        if failure is not None:
            return failure
        if selection is not None:
            return _scoped_epic_search(selection, query, limit)

        projects = get_selected_projects()
        if not projects:
            return jsonify({'epics': []})

        cache_enabled = _settings_process_cache_enabled()
        normalized_projects = sorted({str(project or '').strip() for project in projects if str(project or '').strip()})
        cache_key = f'{"|".join(normalized_projects)}::{query.lower()}::{limit}'
        now_ts = time.time()
        if cache_enabled:
            with _cache_lock:
                cached = EPICS_SEARCH_CACHE.get(cache_key)
                if cached and (now_ts - float(cached.get('timestamp') or 0)) < EPICS_SEARCH_CACHE_TTL:
                    return jsonify({'epics': cached.get('data') or []})
        escaped_projects = ', '.join(f'"{_escape_jql_literal(project)}"' for project in normalized_projects)
        escaped_query = _escape_jql_literal(query)
        escaped_key = _escape_jql_literal(query.upper())
        key_like = re.match(r'^[A-Za-z][A-Za-z0-9_]+-\d+$', query) is not None

        if key_like:
            query_clause = f'key = "{escaped_key}"'
        else:
            query_clause = f'(summary ~ "\\"{escaped_query}\\"" OR key ~ "{escaped_key}*")'

        jql = (
            f'issuetype = Epic AND project in ({escaped_projects}) '
            f'AND {query_clause} ORDER BY updated DESC'
        )

        response = jira_search_request({
            'jql': jql,
            'maxResults': limit,
            'fields': ['summary', 'status', 'project', 'issuetype']
        })
        if response.status_code != 200:
            return jsonify({
                'error': f'Jira API error: {response.status_code}',
                'details': response.text
            }), response.status_code

        issues = (response.json() or {}).get('issues') or []
        selected_project_set = set(normalized_projects)
        epics = []
        for issue in issues:
            key = str(issue.get('key') or '').strip().upper()
            fields = issue.get('fields') or {}
            summary = str(fields.get('summary') or '').strip()
            project_key = str((fields.get('project') or {}).get('key') or '').strip()
            issue_type = fields.get('issuetype') or {}
            issue_type_name = str(issue_type.get('name') or '').strip().lower()
            hierarchy_level = issue_type.get('hierarchyLevel')
            is_epic_type = issue_type_name == 'epic' or str(hierarchy_level) == '1'
            if not key:
                continue
            # Defensive filtering: keep only selected projects + actual epic type.
            # Jira search should already enforce this via JQL, but we re-check to
            # avoid leaking stories/tasks if Jira returns mixed issue types.
            if project_key and project_key not in selected_project_set:
                continue
            if not is_epic_type:
                continue
            epics.append({
                'key': key,
                'summary': summary,
                'status': ((fields.get('status') or {}).get('name') or ''),
                'projectKey': project_key
            })

        if cache_enabled:
            with _cache_lock:
                EPICS_SEARCH_CACHE[cache_key] = {
                    'timestamp': now_ts,
                    'data': epics
                }

        return jsonify({'epics': epics})
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': 'Failed to search epics', 'details': str(e)}), 500


@bp.route('/api/jira/labels', methods=['GET'])
def get_jira_labels():
    """Fetch Jira labels for autocomplete."""
    try:
        query = request.args.get('query', '').strip().lower()
        prefix = request.args.get('prefix', '').strip().lower()
        limit_raw = request.args.get('limit', '').strip()
        refresh = request.args.get('refresh', '').strip().lower() in ('1', 'true', 'yes')

        limit = 50
        if limit_raw.isdigit():
            limit = max(1, min(int(limit_raw), 200))
        if prefix:
            prefix = normalize_epm_label_prefix_mask(prefix)

        if query:
            # Typed search: Jira JQL autocomplete is prefix-only and capped (~15),
            # but avoids crawling the full site label catalog on every keystroke.
            response = current_jira_get(
                '/rest/api/3/jql/autocompletedata/suggestions',
                params={'fieldName': 'labels', 'fieldValue': query},
                timeout=15
            )
            if response.status_code != 200:
                return jsonify({'error': 'Failed to fetch labels from Jira'}), response.status_code
            results = (response.json() or {}).get('results') or []
            labels = []
            for item in results:
                value = str((item or {}).get('value') or '').strip()
                if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                if value:
                    labels.append(value)
            if prefix:
                labels = [label for label in labels if label.lower().startswith(prefix)]
            return jsonify({'labels': list(dict.fromkeys(labels))[:limit]})

        cache_enabled = _settings_process_cache_enabled()

        cached_labels = None
        cached_ts = 0
        if cache_enabled:
            with _cache_lock:
                cached_labels = LABELS_CACHE.get('data')
                cached_ts = LABELS_CACHE.get('timestamp', 0)

        if cache_enabled and cached_labels and not refresh and (time.time() - cached_ts) < LABELS_CACHE_TTL:
            labels = cached_labels
        else:
            labels = []
            start_at = 0
            max_results = 1000
            while True:
                response = current_jira_get(
                    '/rest/api/3/label',
                    params={'maxResults': max_results, 'startAt': start_at},
                    timeout=30
                )
                if response.status_code != 200:
                    return jsonify({'error': 'Failed to fetch labels from Jira'}), response.status_code
                payload = response.json() or {}
                values = [str(label).strip() for label in (payload.get('values') or []) if str(label).strip()]
                labels.extend(values)
                if payload.get('isLast', True) or not values:
                    break
                next_start = payload.get('startAt')
                if isinstance(next_start, int):
                    start_at = next_start + len(values)
                else:
                    start_at += len(values)
            labels = sorted(dict.fromkeys(labels), key=str.lower)
            if cache_enabled:
                with _cache_lock:
                    LABELS_CACHE['data'] = labels
                    LABELS_CACHE['timestamp'] = time.time()

        if prefix:
            labels = [label for label in labels if label.lower().startswith(prefix)]

        return jsonify({'labels': labels[:limit]})
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': 'Failed to fetch labels', 'details': str(e)}), 500


@bp.route('/api/projects/selected', methods=['GET'])
def get_selected_projects_endpoint():
    """Return the list of selected projects with type from dashboard config."""
    selected = get_selected_projects_typed()
    return jsonify(_with_config_revision({'selected': selected}))


@bp.route('/api/projects/selected', methods=['POST'])
def save_selected_projects():
    """Save selected projects with type to dashboard config."""
    payload = request.get_json(silent=True)
    try:
        base_revision = _parse_shared_write(payload, {'selected'})
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    try:
        sanitized = normalize_shared_admin_section(
            'projects', {'selected': payload.get('selected', [])},
        )['selected']
    except ValueError as error:
        return jsonify({'error': str(error)}), 400

    try:
        dashboard_config = load_dashboard_config() or {}
        existing_projects = dashboard_config.get('projects') or {}
        existing_selected = existing_projects.get('selected') if isinstance(existing_projects, dict) else []
        if not sanitized and _has_dashboard_config_value(existing_selected):
            return jsonify({'error': 'selected projects cannot be cleared implicitly'}), 400
        revision = _persist_shared_section('projects', {'selected': sanitized}, base_revision)
    except WorkspaceConfigConflict as error:
        return _workspace_conflict_response(error)
    except WorkspaceConfigFenceUnavailable:
        return _config_fence_unavailable_response()
    except work_structure_service.WorkConfigError as error:
        return work_routes.work_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to save project selection', 'message': str(e)}), 500

    # Invalidate tasks cache since project scope changed
    with _cache_lock:
        TASKS_CACHE.clear()

    result = {'selected': sanitized}
    if revision is not None:
        result['configRevision'] = revision
    return jsonify(result)


@bp.route('/api/capacity/config', methods=['GET'])
def get_capacity_config_endpoint():
    """Return current capacity configuration."""
    try:
        return jsonify(load_request_capacity_config(current_request_auth_context()))
    except (ConfigStorageError, DatabaseConfigurationError):
        return jsonify({
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }), 503


@bp.route('/api/board-config', methods=['GET'])
def get_board_config_endpoint():
    """Return current Jira board configuration."""
    board_cfg = get_board_config()
    return jsonify(_with_config_revision({
        'boardId': board_cfg.get('boardId', ''),
        'boardName': board_cfg.get('boardName', ''),
        'source': board_cfg.get('source', 'default')
    }))


@bp.route('/api/board-config', methods=['POST'])
def save_board_config_endpoint():
    """Save Jira board configuration used for sprint loading."""
    payload = request.get_json(silent=True)
    try:
        base_revision = _parse_shared_write(payload, {'boardId', 'boardName'})
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    try:
        board_value = normalize_shared_admin_section('board', {
            'boardId': payload.get('boardId', ''),
            'boardName': payload.get('boardName', ''),
        })
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    board_id = board_value['boardId']
    board_name = board_value['boardName']

    try:
        revision = _persist_shared_section('board', board_value, base_revision)
        with _cache_lock:
            TASKS_CACHE.clear()
            SPRINTS_PROCESS_CACHE.clear()
        invalidate_sprints_cache()
    except WorkspaceConfigConflict as error:
        return _workspace_conflict_response(error)
    except WorkspaceConfigFenceUnavailable:
        return _config_fence_unavailable_response()
    except work_structure_service.WorkConfigError as error:
        return work_routes.work_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to save board config', 'message': str(e)}), 500

    result = {'boardId': board_id, 'boardName': board_name, 'source': 'config'}
    if revision is not None:
        result['configRevision'] = revision
    return jsonify(result)


@bp.route('/api/board-config/statuses', methods=['GET'])
def get_board_config_statuses():
    """Fetch Epic workflow statuses for the projects rendered by Group Board."""
    try:
        selection, failure = _metadata_selection(required=True)
        if failure is not None:
            return failure
        if selection is not None:
            return _scoped_board_statuses(selection)
        board_id = get_board_config().get('boardId', '').strip()
        if not board_id:
            return jsonify({'error': 'no_board_configured'}), 400
        auth_context = current_request_auth_context()
        project_keys = []
        seen_project_keys = set()
        for raw_project_key in get_selected_projects():
            project_key = str(raw_project_key or '').strip()
            normalized_key = project_key.upper()
            if not project_key or normalized_key in seen_project_keys:
                continue
            seen_project_keys.add(normalized_key)
            project_keys.append(project_key)

        # Older/local configurations can have a saved board before selected projects
        # were introduced. Preserve that path as a fallback, but do not make a board's
        # optional location the source of truth for the workflows of ENG Epics.
        if not project_keys:
            board_response = current_jira_get(
                f'/rest/agile/1.0/board/{board_id}',
                context=auth_context,
            )
            if board_response.status_code in (401, 403):
                return jsonify({
                    'error': 'board_statuses_forbidden',
                    'message': f'Jira refused the saved board read (status {board_response.status_code})',
                }), 502
            if board_response.status_code != 200:
                raise RuntimeError(f'Jira returned status {board_response.status_code} for the saved board read')

            board_data = board_response.json() or {}
            project_key = str((board_data.get('location') or {}).get('projectKey') or '').strip()
            if not project_key:
                return jsonify({
                    'error': 'board_project_unavailable',
                    'message': f'The saved board {board_id} does not identify a Jira project',
                }), 502
            project_keys.append(project_key)

        project_issue_types = []
        for project_key in project_keys:
            statuses_response = current_jira_get(
                f'/rest/api/3/project/{project_key}/statuses',
                context=auth_context,
            )
            if statuses_response.status_code in (401, 403):
                return jsonify({
                    'error': 'board_statuses_forbidden',
                    'message': f'Jira refused the project statuses read for {project_key} '
                        f'(status {statuses_response.status_code})',
                }), 502
            if statuses_response.status_code != 200:
                raise RuntimeError(
                    f'Jira returned status {statuses_response.status_code} for the project statuses read'
                )
            project_issue_types.append((project_key, statuses_response.json() or []))
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        logger.exception('Board statuses Jira fetch failed')
        return jsonify({'error': 'board_statuses_fetch_failed', 'message': str(e)}), 502

    statuses = []
    seen_status_ids = set()
    for _, issue_types in project_issue_types:
        for issue_type in issue_types if isinstance(issue_types, list) else []:
            if not isinstance(issue_type, dict) or str(issue_type.get('name') or '').strip().lower() != 'epic':
                continue
            for status in issue_type.get('statuses') or []:
                if not isinstance(status, dict):
                    continue
                status_id = str(status.get('id') or '').strip()
                name = str(status.get('name') or '').strip()
                if not status_id or not name or status_id in seen_status_ids:
                    continue
                seen_status_ids.add(status_id)
                statuses.append({'id': status_id, 'name': name})

    if not statuses:
        message = f'Jira returned no usable Epic statuses for projects {", ".join(project_keys)}'
        logger.warning('Board statuses unavailable: %s', message)
        return jsonify({'error': 'board_statuses_unavailable', 'message': message}), 502

    payload = {
        'boardId': board_id,
        'projectKeys': project_keys,
        'statuses': statuses,
    }
    if len(project_keys) == 1:
        payload['projectKey'] = project_keys[0]
    return jsonify(payload)


@bp.route('/api/capacity/config', methods=['POST'])
def save_capacity_config_endpoint():
    """Save the workspace-owned Capacity Project/field mapping."""
    payload = request.get_json(silent=True) or {}
    if _capacity_payload_error(payload):
        return jsonify({'error': 'invalid_capacity_config'}), 400
    try:
        auth_context = current_request_auth_context()
        db_context = _shared_capacity_db_auth_context()
        if db_context is not None and 'baseRevision' not in payload:
            return jsonify({'error': 'invalid_capacity_config'}), 400
        if db_context is not None:
            fields = load_current_site_field_catalog(db_context)
            if fields is None:
                return jsonify({'error': 'jira_field_catalog_failed'}), 502
            try:
                saved = shared_capacity_config.save_shared_capacity_config(
                    db_context,
                    {key: payload.get(key) for key in ('project', 'fieldId', 'fieldName')},
                    payload.get('baseRevision'),
                    field_catalog=fields,
                    fallback_loader=_load_dashboard_config_json,
                    legacy_site_url=JIRA_URL or '',
                )
            except shared_capacity_config.CapacityConfigConflict as error:
                return jsonify({'error': 'capacity_config_conflict', 'current': error.current}), 409
            except shared_capacity_config.InvalidSharedCapacityConfig as error:
                code = 'capacity_field_not_numeric' if str(error) == 'capacity_field_not_numeric' else 'invalid_capacity_config'
                return jsonify({'error': code}), 400
            _clear_capacity_field_cache()
            return jsonify(saved)

        project = str(payload.get('project') or '').strip().upper()
        field_id = str(payload.get('fieldId') or '').strip()
        field_name = str(payload.get('fieldName') or '').strip()
        dashboard_config = load_dashboard_config(source='jsonfile') or {'version': 1, 'projects': {'selected': []}}
        capacity = {'project': project, 'fieldId': field_id, 'fieldName': field_name}
        if auth_context.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH and field_id:
            fields = load_current_site_field_catalog(auth_context)
            if fields is None:
                return jsonify({'error': 'jira_field_catalog_failed'}), 502
            verified = next((
                field for field in fields or []
                if str(field.get('id') or '') == field_id
                and (field.get('schema') or {}).get('type') == 'number'
            ), None)
            if verified is None:
                return jsonify({'error': 'capacity_field_not_numeric'}), 400
            capacity.update({
                'fieldName': str(verified.get('name') or '').strip(),
                'verifiedSiteUrl': auth_context.site_url,
                'verifiedCloudId': auth_context.cloud_id,
                'fieldSchemaType': 'number',
                'fieldVerifiedAt': datetime.now(timezone.utc).isoformat(),
            })
        dashboard_config['capacity'] = capacity
        save_dashboard_config(dashboard_config, source='jsonfile')
        _clear_capacity_field_cache()
        return jsonify(load_request_capacity_config(auth_context, source='jsonfile'))
    except CapacityUpstreamUnauthorized:
        if auth_context.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
            auth_payload, status = oauth_auth_required_payload()
            return jsonify(auth_payload), status
        return jsonify({'error': 'jira_field_catalog_failed'}), 502
    except AuthError as error:
        if error.code == 'auth_required':
            auth_payload, status = oauth_auth_required_payload()
            return jsonify(auth_payload), status
        return auth_error_response(error, 401)
    except (ConfigStorageError, DatabaseConfigurationError, WorkspaceConfigFenceUnavailable):
        return jsonify({
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }), 503


@bp.route('/api/sprint-field/config', methods=['GET'])
def get_sprint_field_config_endpoint():
    return jsonify(_with_config_revision(get_sprint_field_config()))


@bp.route('/api/sprint-field/config', methods=['POST'])
def save_sprint_field_config_endpoint():
    return _save_field_config('sprintField')


@bp.route('/api/story-points-field/config', methods=['GET'])
def get_story_points_field_config_endpoint():
    return jsonify(_with_config_revision(get_story_points_field_config()))


@bp.route('/api/story-points-field/config', methods=['POST'])
def save_story_points_field_config_endpoint():
    return _save_field_config('storyPointsField')


@bp.route('/api/parent-name-field/config', methods=['GET'])
def get_parent_name_field_config_endpoint():
    return jsonify(_with_config_revision(get_parent_name_field_config()))


@bp.route('/api/parent-name-field/config', methods=['POST'])
def save_parent_name_field_config_endpoint():
    return _save_field_config('parentNameField', 'PARENT_NAME_FIELD_CACHE')


@bp.route('/api/team-field/config', methods=['GET'])
def get_team_field_config_endpoint():
    return jsonify(_with_config_revision(get_team_field_config()))


@bp.route('/api/team-field/config', methods=['POST'])
def save_team_field_config_endpoint():
    return _save_field_config('teamField', 'TEAM_FIELD_CACHE')


@bp.route('/api/delivery-owner-field/config', methods=['GET'])
def get_delivery_owner_field_config_endpoint():
    return jsonify(_with_config_revision(get_delivery_owner_field_config()))


@bp.route('/api/delivery-owner-field/config', methods=['POST'])
def save_delivery_owner_field_config_endpoint():
    return _save_field_config('deliveryOwnerField')


@bp.route('/api/stats/priority-weights-config', methods=['GET'])
def get_stats_priority_weights_config_endpoint():
    payload = get_priority_weights_config()
    return jsonify(_with_config_revision(payload))


@bp.route('/api/stats/priority-weights-config', methods=['POST'])
def save_stats_priority_weights_config_endpoint():
    payload = request.get_json(silent=True)
    try:
        base_revision = _parse_shared_write(payload, {'weights'})
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    raw_weights = payload.get('weights', [])
    try:
        normalize_shared_admin_section('statsPriorityWeights', raw_weights)
        normalized = normalize_priority_weight_rows(raw_weights)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        revision = _persist_shared_section('statsPriorityWeights', normalized, base_revision)
    except WorkspaceConfigConflict as error:
        return _workspace_conflict_response(error)
    except WorkspaceConfigFenceUnavailable:
        return _config_fence_unavailable_response()
    except Exception as e:
        return jsonify({'error': 'Failed to save stats priority weights', 'message': str(e)}), 500

    result = {'weights': normalized, 'source': 'config'}
    if revision is not None:
        result['configRevision'] = revision
    return jsonify(result)


@bp.route('/api/scenario-access/config', methods=['GET'])
def get_scenario_access_config_endpoint():
    try:
        payload = load_dashboard_config_snapshot().payload
    except (ConfigStorageError, DatabaseConfigurationError, WorkspaceConfigFenceUnavailable):
        return _config_fence_unavailable_response()
    return jsonify(_with_config_revision({'enabledForEveryone': scenario_planner_for_everyone(payload)}))


@bp.route('/api/scenario-access/config', methods=['POST'])
def save_scenario_access_config_endpoint():
    """Admin-owned workspace switch that unlocks Scenario Planner for every user; its own section."""
    payload = request.get_json(silent=True)
    try:
        base_revision = _parse_shared_write(payload, {'enabledForEveryone'})
        normalized = normalize_shared_admin_section(
            SCENARIO_PLANNER_SECTION, {'enabledForEveryone': payload.get('enabledForEveryone')})
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    try:
        revision = _persist_shared_section(SCENARIO_PLANNER_SECTION, normalized, base_revision)
    except WorkspaceConfigConflict as error:
        return _workspace_conflict_response(error)
    except WorkspaceConfigFenceUnavailable:
        return _config_fence_unavailable_response()
    result = dict(normalized)
    if revision is not None:
        result['configRevision'] = revision
    return jsonify(result)


@bp.route('/api/issue-types', methods=['GET'])
def get_jira_issue_types():
    """Fetch available Jira issue types with caching."""
    try:
        selection, failure = _metadata_selection(required=False)
        if failure is not None:
            return failure
        try:
            feature_active = work_routes.work_feature_active(current_request_auth_context())
        except (ConfigStorageError, DatabaseConfigurationError, WorkspaceConfigFenceUnavailable):
            return work_routes.storage_unavailable_response()
        if feature_active:
            return _feature_issue_types(selection)
        cache_enabled = _settings_process_cache_enabled()
        if cache_enabled:
            with _cache_lock:
                if ISSUE_TYPES_CACHE['data'] and (time.time() - ISSUE_TYPES_CACHE['timestamp']) < ISSUE_TYPES_CACHE_TTL:
                    return jsonify({'issueTypes': ISSUE_TYPES_CACHE['data']})

        response = current_jira_get('/rest/api/3/issuetype', timeout=15)
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch issue types', 'details': response.text}), response.status_code
        data = response.json()
        result = []
        seen = set()
        for it in data:
            name = it.get('name', '')
            if name and name not in seen:
                seen.add(name)
                result.append({
                    'name': name,
                    'subtask': it.get('subtask', False),
                    'iconUrl': it.get('iconUrl', ''),
                })
        result.sort(key=lambda x: x['name'])

        if cache_enabled:
            with _cache_lock:
                ISSUE_TYPES_CACHE['data'] = result
                ISSUE_TYPES_CACHE['timestamp'] = time.time()

        return jsonify({'issueTypes': result})
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': 'Failed to fetch issue types', 'details': str(e)}), 500


ISSUE_TYPE_ICON_CACHE = {}
ISSUE_TYPE_ICON_TTL_SECONDS = 3600
_ISSUE_TYPE_ICON_CACHE_LIMIT = 512
_ISSUE_TYPE_ICON_MAX_BYTES = 64 * 1024
_PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def _fetch_issue_type_icon(type_id):
    """The type's Jira avatar as PNG bytes, or None. PNG only, so the page never serves Jira-supplied SVG."""
    response = current_jira_get(f'/rest/api/3/issuetype/{type_id}', timeout=15)
    body = response.json() if response.status_code == 200 else None
    avatar_id = body.get('avatarId') if isinstance(body, dict) else None
    if not isinstance(avatar_id, int) or isinstance(avatar_id, bool) or avatar_id <= 0:
        return None
    response = current_jira_get(
        f'/rest/api/3/universal_avatar/view/type/issuetype/avatar/{avatar_id}',
        params={'format': 'png', 'size': 'medium'}, timeout=15, accept='image/png',
    )
    content = response.content if response.status_code == 200 else b''
    if not content.startswith(_PNG_SIGNATURE) or len(content) > _ISSUE_TYPE_ICON_MAX_BYTES:
        return None
    return content


@bp.route('/api/issue-type-icon/<type_id>', methods=['GET'])
def get_issue_type_icon(type_id):
    """A Jira issue type's own icon, read with the viewer's Jira auth and served same-origin (the CSP allows no Jira host)."""
    if not type_id.isdigit() or len(type_id) > 18:
        return jsonify({'error': 'invalid_issue_type_id'}), 400
    auth_context = current_request_auth_context()
    cache_enabled = jira_home_partitioned_process_cache_enabled(auth_context)
    cache_key = build_jira_home_process_cache_key(auth_context, 'issue-type-icon', type_id)
    if cache_enabled:
        with _cache_lock:
            cached = ISSUE_TYPE_ICON_CACHE.get(cache_key)
        if cached and time.time() - cached[0] < ISSUE_TYPE_ICON_TTL_SECONDS:
            return Response(cached[1], mimetype='image/png')
    try:
        content = _fetch_issue_type_icon(type_id)
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception:
        content = None
    if content is None:
        return jsonify({'error': 'issue_type_icon_unavailable'}), 404
    if cache_enabled:
        with _cache_lock:
            if len(ISSUE_TYPE_ICON_CACHE) >= _ISSUE_TYPE_ICON_CACHE_LIMIT:
                ISSUE_TYPE_ICON_CACHE.clear()
            ISSUE_TYPE_ICON_CACHE[cache_key] = (time.time(), content)
    return Response(content, mimetype='image/png')


@bp.route('/api/issue-types/config', methods=['GET'])
def get_issue_types_config_endpoint():
    """Return configured issue types from dashboard config."""
    types = get_configured_issue_types()
    return jsonify(_with_config_revision({'issueTypes': types}))


@bp.route('/api/issue-types/config', methods=['POST'])
def save_issue_types_config_endpoint():
    """Save issue types configuration."""
    payload = request.get_json(silent=True)
    try:
        base_revision = _parse_shared_write(payload, {'issueTypes'})
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    try:
        sanitized = normalize_shared_admin_section('issueTypes', payload.get('issueTypes', []))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400

    try:
        revision = _persist_shared_section('issueTypes', sanitized, base_revision)
    except WorkspaceConfigConflict as error:
        return _workspace_conflict_response(error)
    except WorkspaceConfigFenceUnavailable:
        return _config_fence_unavailable_response()
    except work_structure_service.WorkConfigError as error:
        return work_routes.work_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to save issue types config', 'message': str(e)}), 500

    # Invalidate tasks cache since query scope changed
    with _cache_lock:
        TASKS_CACHE.clear()

    result = {'issueTypes': sanitized}
    if revision is not None:
        result['configRevision'] = revision
    return jsonify(result)


@bp.route('/api/fields', methods=['GET'])
def get_jira_fields():
    """Fetch available Jira fields, optionally scoped to a project."""
    project_key = request.args.get('project', '').strip()
    try:
        if project_key:
            # Fetch fields scoped to a specific project via createmeta
            seen = {}
            resp = current_jira_get(f'/rest/api/3/issue/createmeta/{project_key}/issuetypes', timeout=15)
            if resp.status_code == 200:
                issue_types = (resp.json() or {}).get('issueTypes', resp.json() if isinstance(resp.json(), list) else [])
                if isinstance(issue_types, list):
                    for it in issue_types[:5]:  # sample a few issue types
                        it_id = it.get('id', '')
                        if not it_id:
                            continue
                        fields_resp = current_jira_get(
                            f'/rest/api/3/issue/createmeta/{project_key}/issuetypes/{it_id}',
                            timeout=15
                        )
                        if fields_resp.status_code == 200:
                            field_values = (fields_resp.json() or {}).get('fields', fields_resp.json() if isinstance(fields_resp.json(), list) else [])
                            if isinstance(field_values, list):
                                for fv in field_values:
                                    fid = fv.get('fieldId', fv.get('key', ''))
                                    fname = fv.get('name', '')
                                    if fid and fid not in seen:
                                        seen[fid] = {'id': fid, 'name': fname, 'custom': fid.startswith('customfield_')}
                            elif isinstance(field_values, dict):
                                for fid, fv in field_values.items():
                                    fname = fv.get('name', '') if isinstance(fv, dict) else ''
                                    if fid and fid not in seen:
                                        seen[fid] = {'id': fid, 'name': fname, 'custom': fid.startswith('customfield_')}
            if seen:
                result = sorted(seen.values(), key=lambda f: f['name'].lower())
                return jsonify({'fields': result, 'scoped': True})
            # Fallback to global fields if createmeta didn't work

        response = current_jira_get('/rest/api/3/field', timeout=15)
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch fields', 'details': response.text}), response.status_code
        fields = response.json() or []
        result = []
        for field in fields:
            result.append({
                'id': field.get('id', ''),
                'name': field.get('name', ''),
                'custom': field.get('custom', False),
            })
        result.sort(key=lambda f: f['name'].lower())
        return jsonify({'fields': result, 'scoped': False})
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': 'Failed to fetch fields', 'details': str(e)}), 500
