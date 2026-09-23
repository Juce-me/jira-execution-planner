"""ENG task, team, and dependency route blueprint."""

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import hashlib
import json
import re
import threading
import time

from flask import Blueprint

from backend.auth.cache_policy import build_jira_home_process_cache_key, jira_home_partitioned_process_cache_enabled
from backend.auth.scope_policy import missing_context_oauth_scopes
from backend.auth.db_context import is_db_auth_context
from backend.auth.jira_auth import AuthError
from backend.auth.project_access import project_access_denied_response, project_access_status
from backend.epm.home import adf_to_html
from backend.services import eng_board, shared_group_config
from backend.services.eng_board_stream import (
    EngBoardRequestBudget,
    EngBoardRequestDeadline,
    EngBoardRequestTransport,
)
from backend.services.story_readiness import (
    InvalidCompleteReadinessInput,
    project_story_readiness,
)
from backend.services.team_catalog import normalize_team_catalog
from backend.services.eng_subtasks import (
    SUBTASK_FIELDS,
    SubtasksFetchError,
    build_subtasks_jql,
    fetch_subtask_issues_by_jql,
    normalize_sprint_id,
    shape_subtasks_payload,
)
from backend.services.jira_issue_priorities import (
    IssuePriorityInputError,
    IssuePriorityServiceError,
    load_priority_options,
    load_priority_options_for_issue,
    update_issue_priorities,
)
from backend.services.jira_issue_field_edits import (
    FieldEditInputError,
    FieldEditServiceError,
    load_editable_field,
    search_field_users,
    update_issue_field,
)
from backend.services.jira_issue_project_track import (
    ProjectTrackInputError,
    ProjectTrackServiceError,
    load_project_track_options_for_issue,
    update_issue_project_track,
)
from backend.services.jira_issue_transitions import (
    IssueTransitionInputError,
    IssueTransitionServiceError,
    load_status_catalog,
    load_transition_options,
    transition_issues,
)

from . import bind_server_globals


bp = Blueprint("eng_routes", __name__)
SUBTASKS_CACHE = {}
SUBTASKS_CACHE_TTL_SECONDS = 300

_STORY_READINESS_CACHE = OrderedDict()
_STORY_READINESS_INFLIGHT = {}
_STORY_READINESS_LOCK = threading.RLock()
_STORY_READINESS_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix='story-readiness')
_STORY_READINESS_CACHE_TTL_SECONDS = 300
_STORY_READINESS_CACHE_MAX_ENTRIES = 128
_STORY_READINESS_MAX_EPICS = 2000
_STORY_READINESS_MAX_CHILDREN = 20000
_STORY_READINESS_DEADLINE_SECONDS = 25

_STORY_READINESS_ERRORS = {
    'invalid_story_readiness_scope': (400, 'Story readiness scope is invalid.'),
    'story_readiness_scope_not_found': (404, 'Story readiness scope was not found.'),
    'story_readiness_configuration_invalid': (409, 'Story readiness configuration is incomplete.'),
    'story_readiness_scope_too_large': (422, 'Story readiness scope is too large.'),
    'story_readiness_unavailable': (502, 'Story readiness is temporarily unavailable.'),
}


class _StoryReadinessConfigurationError(ValueError):
    pass

# One project key, letters/digits/underscore, then a numeric suffix, e.g. PROD-1, TECH_2-22.
_ISSUE_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]+-\d+$')


def _adf_html_is_blank(html):
    """True when rendered ADF HTML carries no visible text (empty or tags-only)."""
    return not re.sub(r'<[^>]+>', '', html or '').strip()


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


def _eng_auth_error_response(error):
    if error.code == "auth_required":
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    return auth_error_response(error, 401)


def _story_readiness_response(payload, status=200, *, cache_result=None, timing=None):
    response = jsonify(payload)
    response.status_code = status
    response.headers['Cache-Control'] = 'private, no-store'
    if cache_result is not None:
        response.headers['X-Story-Readiness-Cache'] = cache_result
    if timing is not None:
        response.headers['Server-Timing'] = timing
    return response


def _story_readiness_error(code):
    status, message = _STORY_READINESS_ERRORS[code]
    return _story_readiness_response({'error': code, 'message': message}, status)


def _story_readiness_bool(value):
    normalized = str(value or 'false').strip().lower()
    if normalized not in {'true', 'false'}:
        raise ValueError('invalid_refresh')
    return normalized == 'true'


def _story_readiness_digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(encoded.encode('utf-8')).hexdigest()


def _story_readiness_effective_groups(context):
    db_context = context if is_db_auth_context(context) else None
    return shared_group_config.load_effective_groups(
        db_context,
        fallback_loader=lambda: load_dashboard_config(source='jsonfile'),
        validate_groups_config_fn=validate_groups_config,
        dashboard_loader=load_dashboard_config,
        groups_file_loader=lambda: load_groups_config_file(resolve_groups_config_path()),
        environment_loader=parse_groups_config_env,
        default_builder=build_default_groups_config,
    )


def _story_readiness_team_catalog(context):
    if is_db_auth_context(context):
        raw = build_db_config_repository().load_team_catalog(context) or {}
    else:
        raw = load_team_catalog() or {}
    catalog = raw.get('catalog') if isinstance(raw, dict) and 'catalog' in raw else raw
    return normalize_team_catalog(catalog or {})


def _story_readiness_dashboard_snapshot(context, *, fresh=False):
    if fresh and is_db_auth_context(context):
        return build_db_config_repository().load_dashboard_config_snapshot(
            context,
            fallback_loader=lambda: load_dashboard_config(source='jsonfile'),
            legacy_site_url=JIRA_URL or '',
        )
    return load_dashboard_config_snapshot()


def _story_readiness_projects(config):
    selected = ((config or {}).get('projects') or {}).get('selected') or []
    projects = []
    seen = set()
    for raw in selected:
        if isinstance(raw, str):
            key, kind = raw, 'product'
        elif isinstance(raw, dict):
            key, kind = raw.get('key'), raw.get('type', 'product')
        else:
            continue
        key = str(key or '').strip().upper()
        kind = str(kind or '').strip().lower()
        if key and kind in {'product', 'tech'} and key not in seen:
            projects.append({'key': key, 'type': kind})
            seen.add(key)
    return projects


def _story_readiness_group_snapshot(groups, group_id, catalog):
    match = next((group for group in groups.get('groups') or []
                  if str(group.get('id') or '').strip() == group_id), None)
    if match is None:
        return None
    labels = match.get('teamLabels') if isinstance(match.get('teamLabels'), dict) else {}
    teams = []
    for raw_id in match.get('teamIds') or []:
        team_id = str(raw_id or '').strip()
        label = str(labels.get(team_id) or '').strip()
        if not team_id or not label:
            raise _StoryReadinessConfigurationError('missing_team_label')
        entry = catalog.get(team_id) or {}
        teams.append({'id': team_id, 'name': str(entry.get('name') or team_id), 'label': label})
    return {
        'id': group_id,
        'revision': int(groups.get('configRevision') or 0),
        'teams': teams,
    }


def _story_readiness_cache_key(
        context, requested, group_snapshot, projects, config_snapshot, config, catalog,
        issue_generation):
    project_types = sorted({project['type'] for project in projects})
    return _story_readiness_digest({
        'auth': build_jira_home_process_cache_key(context, 'story-readiness'),
        'group': group_snapshot,
        'sprint': list(requested),
        'configRevision': int(getattr(config_snapshot, 'config_revision', 0) or 0),
        'config': config,
        'catalog': catalog,
        'projects': projects,
        'projectAccess': {
            kind: project_access_status(context, kind)
            for kind in project_types
        },
        'issueGeneration': issue_generation,
    })


def _story_readiness_access_denied(context, project_types):
    for project_type in sorted(set(project_types)):
        response, status = project_access_denied_response(context, project_type)
        if response is not None:
            response.status_code = status
            response.headers['Cache-Control'] = 'private, no-store'
            return response
    return None


def _story_readiness_response_json(response):
    if response.status_code != 200:
        raise RuntimeError('jira_unavailable')
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError('jira_unavailable') from exc
    if not isinstance(payload, dict):
        raise RuntimeError('jira_unavailable')
    return payload


def _story_readiness_search(context, transport, jql, fields, *, counters, key_budget=None,
                            max_unique_keys=None):
    def search(payload):
        response = current_jira_search(
            payload,
            context=context,
            timeout=transport.budget.jira_retry_timeout(),
            diagnostic_transport=transport,
        )
        return _story_readiness_response_json(response)

    return eng_board.strict_search(
        search, jql, fields, counters=counters, cancel_check=transport.budget.check,
        key_budget=key_budget, max_unique_keys=max_unique_keys,
    )


def _story_readiness_validate_sprint(context, transport, requested, board_id):
    sprint_id, sprint_name, sprint_state = requested
    found = None
    if board_id:
        start_at = 0
        seen_offsets = set()
        while True:
            transport.budget.check('sprint')
            response = current_jira_get(
                f'/rest/agile/1.0/board/{board_id}/sprint',
                params={'state': 'active,future,closed', 'startAt': start_at, 'maxResults': 100},
                context=context, timeout=transport.budget.jira_retry_timeout(),
                diagnostic_transport=transport,
            )
            body = _story_readiness_response_json(response)
            values = body.get('values')
            if not isinstance(values, list):
                raise RuntimeError('jira_unavailable')
            for item in values:
                if isinstance(item, dict) and str(item.get('id')) == sprint_id:
                    found = item
            if body.get('isLast') is True:
                break
            next_offset = start_at + len(values)
            if not values or next_offset in seen_offsets:
                raise RuntimeError('jira_unavailable')
            seen_offsets.add(next_offset)
            start_at = next_offset
    else:
        response = current_jira_get(
            f'/rest/agile/1.0/sprint/{sprint_id}', context=context,
            timeout=transport.budget.jira_retry_timeout(), diagnostic_transport=transport,
        )
        if response.status_code == 404:
            raise LookupError('invalid_sprint_tuple')
        found = _story_readiness_response_json(response)
    if (not isinstance(found, dict)
            or str(found.get('id')) != sprint_id
            or str(found.get('name') or '').strip() != sprint_name
            or str(found.get('state') or '').strip().lower() != sprint_state):
        raise LookupError('invalid_sprint_tuple')


def _story_readiness_quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


def _story_readiness_values(value):
    if isinstance(value, list):
        return value
    return [value] if value not in (None, '') else []


def _story_readiness_ids(value):
    result = []
    for item in _story_readiness_values(value):
        if isinstance(item, dict):
            item = item.get('id') or item.get('teamId') or item.get('value')
        text = str(item or '').strip()
        if text and text not in result:
            result.append(text)
    return result


def _story_readiness_project_track(value):
    if isinstance(value, list):
        tracks = [track for item in value if (track := _story_readiness_project_track(item))]
        return tracks[0] if len(set(tracks)) == 1 else ''
    if isinstance(value, dict):
        value = value.get('value', value.get('name'))
    return str(value or '').strip() if isinstance(value, str) else ''


def _story_readiness_compute(context, requested, group_snapshot, projects, config, transport):
    started = time.monotonic()
    board = (config.get('board') or {}) if isinstance(config, dict) else {}
    _story_readiness_validate_sprint(context, transport, requested, str(board.get('boardId') or '').strip())
    sprint_id, sprint_name, sprint_state = requested
    project_keys = [item['key'] for item in projects]
    project_map = {item['key']: item['type'] for item in projects}
    if not project_keys or not group_snapshot['teams']:
        raise _StoryReadinessConfigurationError('configuration_incomplete')

    sprint_field = str(((config.get('sprintField') or {}).get('fieldId')) or get_sprint_field_id()).strip()
    team_field = str(((config.get('teamField') or {}).get('fieldId')) or get_team_field_id()).strip()
    track_field = str(((config.get('projectTrackField') or {}).get('fieldId')) or get_project_track_field_id()).strip()
    if not sprint_field or not team_field:
        raise _StoryReadinessConfigurationError('configuration_incomplete')

    counters = eng_board.PagerCounters()
    project_jql = ', '.join(_story_readiness_quote(key) for key in project_keys)
    label_jql = ', '.join(_story_readiness_quote(team['label']) for team in group_snapshot['teams'])
    discovery_jql = (
        f'project in ({project_jql}) AND issuetype = Epic '
        f'AND status not in (Done, Killed, Incomplete, Postponed) '
        f'AND ({sprint_field} = {sprint_id} OR labels in '
        f'({_story_readiness_quote(sprint_name)}, {_story_readiness_quote(sprint_name + "_candidate")})) '
        f'AND labels in ({label_jql}) ORDER BY key ASC'
    )
    discovery_started = time.monotonic()
    candidates = _story_readiness_search(
        context, transport, discovery_jql, ('project',), counters=counters,
        max_unique_keys=_STORY_READINESS_MAX_EPICS,
    )
    discovery_ms = (time.monotonic() - discovery_started) * 1000
    epic_keys = sorted({str(item.get('key') or '').strip().upper() for item in candidates})

    if not epic_keys:
        result = project_story_readiness({
            'status': 'complete',
            'canonicalSprint': {'id': sprint_id, 'name': sprint_name, 'state': sprint_state},
            'groupSnapshot': group_snapshot,
            'projectAccessSnapshot': {'product': 'accessible', 'tech': 'accessible'},
            'epics': [],
            'children': [],
        })
        total_ms = (time.monotonic() - started) * 1000
        return result, (
            f'discovery;dur={discovery_ms:.1f}, child-distribution;dur=0.0, '
            f'enrichment;dur=0.0, total;dur={total_ms:.1f}'
        )

    epic_link_field = None
    fields_response = current_jira_get(
        '/rest/api/3/field', context=context,
        timeout=transport.budget.jira_retry_timeout(), diagnostic_transport=transport,
    )
    if fields_response.status_code == 200:
        try:
            field_rows = fields_response.json()
        except Exception:
            field_rows = None
        if not isinstance(field_rows, list):
            raise RuntimeError('jira_unavailable')
        for field in field_rows:
            if isinstance(field, dict) and str(field.get('name') or '').strip().lower() == 'epic link':
                epic_link_field = str(field.get('id') or '').strip() or None
                break
    else:
        raise RuntimeError('jira_unavailable')

    child_started = time.monotonic()
    children = []
    child_budget = eng_board.UniqueKeyBudget(_STORY_READINESS_MAX_CHILDREN)
    child_fields = ['status', 'parent', sprint_field, team_field]
    if epic_link_field:
        child_fields.append(epic_link_field)
    for batch in eng_board.split_epic_batches(
            epic_keys,
            lambda keys: 'issuetype = Story AND parent in (' + ','.join(_story_readiness_quote(k) for k in keys) + ')',
            child_fields):
        clauses = ['parent in (' + ','.join(_story_readiness_quote(key) for key in batch) + ')']
        if epic_link_field:
            clauses.append(f'{epic_link_field} in (' + ','.join(_story_readiness_quote(key) for key in batch) + ')')
        rows = _story_readiness_search(
            context, transport, f'issuetype = Story AND ({" OR ".join(clauses)})', child_fields,
            counters=counters, key_budget=child_budget,
        )
        for row in rows:
            fields = row.get('fields') if isinstance(row.get('fields'), dict) else {}
            parent = fields.get('parent') if isinstance(fields.get('parent'), dict) else {}
            epic_key = str(parent.get('key') or fields.get(epic_link_field or '') or '').strip().upper()
            children.append({
                'key': str(row.get('key') or '').strip().upper(),
                'epicKey': epic_key,
                'statusName': str((fields.get('status') or {}).get('name') or '').strip(),
                'sprintIds': _story_readiness_ids(fields.get(sprint_field)),
                'teamIds': _story_readiness_ids(fields.get(team_field)),
            })
    child_ms = (time.monotonic() - child_started) * 1000

    enrichment_started = time.monotonic()
    epics = []
    enrichment_fields = ['summary', 'status', 'priority', 'assignee', 'labels', 'parent',
                         'project', track_field]
    for batch in eng_board.split_epic_batches(
            epic_keys,
            lambda keys: 'key in (' + ','.join(_story_readiness_quote(k) for k in keys) + ')',
            enrichment_fields):
        batch_set = set(batch)
        rows = _story_readiness_search(
            context, transport,
            'key in (' + ','.join(_story_readiness_quote(key) for key in batch) + ')',
            enrichment_fields, counters=counters,
        )
        if {str(row.get('key') or '').strip().upper() for row in rows} != batch_set:
            raise RuntimeError('jira_unavailable')
        for row in rows:
            fields = row.get('fields') if isinstance(row.get('fields'), dict) else {}
            project_key = str((fields.get('project') or {}).get('key') or '').strip().upper()
            parent = fields.get('parent') if isinstance(fields.get('parent'), dict) else None
            parent_fields = parent.get('fields') if isinstance(parent, dict) and isinstance(parent.get('fields'), dict) else {}
            initiative = None
            if parent and parent.get('key') and parent_fields.get('summary'):
                initiative = {'key': str(parent['key']), 'summary': str(parent_fields['summary'])}
            epics.append({
                'key': str(row.get('key') or '').strip().upper(),
                'summary': str(fields.get('summary') or '').strip(),
                'status': {'name': str((fields.get('status') or {}).get('name') or '').strip()},
                'priority': ({'name': str((fields.get('priority') or {}).get('name') or '').strip()}
                             if fields.get('priority') else None),
                'assignee': fields.get('assignee') if isinstance(fields.get('assignee'), dict) else None,
                'labels': fields.get('labels') if isinstance(fields.get('labels'), list) else [],
                'projectTrack': _story_readiness_project_track(fields.get(track_field)),
                'projectKey': project_key,
                'projectClass': project_map.get(project_key, ''),
                'initiative': initiative,
            })
    enrichment_ms = (time.monotonic() - enrichment_started) * 1000
    result = project_story_readiness({
        'status': 'complete',
        'canonicalSprint': {'id': sprint_id, 'name': sprint_name, 'state': sprint_state},
        'groupSnapshot': group_snapshot,
        'projectAccessSnapshot': {'product': 'accessible', 'tech': 'accessible'},
        'epics': epics,
        'children': children,
    })
    total_ms = (time.monotonic() - started) * 1000
    timing = (
        f'discovery;dur={discovery_ms:.1f}, child-distribution;dur={child_ms:.1f}, '
        f'enrichment;dur={enrichment_ms:.1f}, total;dur={total_ms:.1f}'
    )
    return result, timing


@bp.route('/api/eng/story-readiness', methods=['GET'])
def get_story_readiness():
    try:
        sprint_id = str(request.args.get('sprint') or '').strip()
        sprint_name = str(request.args.get('sprintName') or '').strip()
        sprint_state = str(request.args.get('sprintState') or '').strip().lower()
        group_id = str(request.args.get('groupId') or '').strip()
        refresh = _story_readiness_bool(request.args.get('refresh', 'false'))
        if not sprint_id or not sprint_id.isdigit() or not sprint_name or not group_id or sprint_state not in {'active', 'future'}:
            raise ValueError('invalid_scope')
    except ValueError:
        return _story_readiness_error('invalid_story_readiness_scope')

    try:
        context = current_request_auth_context()
    except AuthError as exc:
        return _eng_auth_error_response(exc)
    try:
        config_snapshot = _story_readiness_dashboard_snapshot(context)
        config = dict(config_snapshot.payload or {})
        projects = _story_readiness_projects(config)
    except AuthError as exc:
        return _eng_auth_error_response(exc)
    except Exception:
        return _story_readiness_error('story_readiness_configuration_invalid')
    if not projects:
        return _story_readiness_error('story_readiness_configuration_invalid')
    denied = _story_readiness_access_denied(
        context,
        {project['type'] for project in projects},
    )
    if denied is not None:
        return denied
    try:
        groups = _story_readiness_effective_groups(context)
        catalog = _story_readiness_team_catalog(context)
        group_snapshot = _story_readiness_group_snapshot(groups, group_id, catalog)
        if group_snapshot is None:
            return _story_readiness_error('story_readiness_scope_not_found')
        team_ids = [team['id'] for team in group_snapshot['teams']]
        team_labels = [team['label'] for team in group_snapshot['teams']]
        if (not group_snapshot['teams']
                or len(set(team_ids)) != len(team_ids)
                or len(set(team_labels)) != len(team_labels)):
            return _story_readiness_error('story_readiness_configuration_invalid')
        issue_generation = get_jira_issue_cache_generation()
        requested = (sprint_id, sprint_name, sprint_state)
        cache_key = _story_readiness_cache_key(
            context, requested, group_snapshot, projects, config_snapshot, config,
            catalog, issue_generation,
        )
    except AuthError as exc:
        return _eng_auth_error_response(exc)
    except Exception:
        return _story_readiness_error('story_readiness_configuration_invalid')

    now = time.monotonic()
    if not refresh:
        with _STORY_READINESS_LOCK:
            cached = _STORY_READINESS_CACHE.get(cache_key)
            if cached and now - cached['storedAt'] < _STORY_READINESS_CACHE_TTL_SECONDS:
                _STORY_READINESS_CACHE.move_to_end(cache_key)
                return _story_readiness_response(
                    cached['payload'], cache_result='hit', timing=cached['timing'],
                )

    transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(_STORY_READINESS_DEADLINE_SECONDS))
    with _STORY_READINESS_LOCK:
        future = _STORY_READINESS_INFLIGHT.get(cache_key)
        if future is None:
            future = _STORY_READINESS_EXECUTOR.submit(
                _story_readiness_compute, context, requested,
                group_snapshot, projects, config, transport,
            )
            _STORY_READINESS_INFLIGHT[cache_key] = future
            def retire(completed, *, expected_key=cache_key):
                with _STORY_READINESS_LOCK:
                    if _STORY_READINESS_INFLIGHT.get(expected_key) is completed:
                        _STORY_READINESS_INFLIGHT.pop(expected_key, None)
            future.add_done_callback(retire)
    try:
        payload, timing = future.result(timeout=_STORY_READINESS_DEADLINE_SECONDS)
        if get_jira_issue_cache_generation() != issue_generation:
            raise RuntimeError('stale_generation')
        try:
            fresh_config_snapshot = _story_readiness_dashboard_snapshot(context, fresh=True)
            fresh_config = dict(fresh_config_snapshot.payload or {})
            fresh_groups = _story_readiness_effective_groups(context)
            fresh_catalog = _story_readiness_team_catalog(context)
            fresh_group = _story_readiness_group_snapshot(fresh_groups, group_id, fresh_catalog)
            fresh_projects = _story_readiness_projects(fresh_config)
        except AuthError:
            raise
        except Exception as exc:
            raise RuntimeError('stale_scope') from exc
        if fresh_group is None or _story_readiness_cache_key(
                context, requested, fresh_group, fresh_projects, fresh_config_snapshot,
                fresh_config, fresh_catalog, issue_generation) != cache_key:
            raise RuntimeError('stale_scope')
    except AuthError as exc:
        return _eng_auth_error_response(exc)
    except LookupError:
        return _story_readiness_error('invalid_story_readiness_scope')
    except eng_board.EngBoardError as exc:
        if exc.code == 'board_scope_too_large':
            return _story_readiness_error('story_readiness_scope_too_large')
        return _story_readiness_error('story_readiness_unavailable')
    except _StoryReadinessConfigurationError:
        return _story_readiness_error('story_readiness_configuration_invalid')
    except InvalidCompleteReadinessInput:
        return _story_readiness_error('story_readiness_unavailable')
    except (EngBoardRequestDeadline, TimeoutError):
        transport.budget.cancel()
        return _story_readiness_error('story_readiness_unavailable')
    except Exception:
        return _story_readiness_error('story_readiness_unavailable')
    finally:
        with _STORY_READINESS_LOCK:
            if _STORY_READINESS_INFLIGHT.get(cache_key) is future and future.done():
                _STORY_READINESS_INFLIGHT.pop(cache_key, None)

    with _STORY_READINESS_LOCK:
        _STORY_READINESS_CACHE[cache_key] = {
            'payload': payload, 'timing': timing, 'storedAt': time.monotonic(),
        }
        _STORY_READINESS_CACHE.move_to_end(cache_key)
        while len(_STORY_READINESS_CACHE) > _STORY_READINESS_CACHE_MAX_ENTRIES:
            _STORY_READINESS_CACHE.popitem(last=False)
    return _story_readiness_response(payload, cache_result='miss', timing=timing)


def clear_jira_issue_status_caches(reason='issue_status_transition'):
    """Invalidate Jira-derived process caches after a successful status transition.

    Composes the existing auth-sensitive and EPM cache clearers (so
    jira_server.py does not grow) and additionally clears the local
    SUBTASKS_CACHE, which neither of those touches.
    """
    clear_auth_sensitive_caches(reason=reason)
    clear_epm_caches()
    try:
        with _cache_lock:
            SUBTASKS_CACHE.clear()
    except Exception:
        log_warning(f'Unable to clear subtask cache after {reason}')


def _missing_write_jira_work_scope(auth_context):
    """Defense-in-depth check that the current session was granted write:jira-work.

    DB-backed auth contexts already had every ATLASSIAN_SCOPES entry (including
    write:jira-work) verified inside current_request_auth_context(), via
    resolve_db_request_auth_context(); re-checking the local OAuth session store
    for those contexts would be both redundant and wrong (it holds no data for a
    DB-backed session). This only re-checks local (non-DB) OAuth sessions,
    mirroring backend/routes/auth_routes.py::api_auth_status().
    """
    if is_db_auth_context(auth_context):
        return False
    return bool(missing_oauth_scopes(oauth_session_data(), {'write:jira-work'}))


_ISSUE_FIELD_NAMES = frozenset({'assignee', 'deliveryOwner', 'storyPoints'})
_ISSUE_PEOPLE_FIELDS = frozenset({'assignee', 'deliveryOwner'})
_ISSUE_FIELD_ERROR_DETAIL_KEYS = {
    'stale_issue': frozenset({
        'issueKey', 'field', 'currentValue', 'baseUpdated', 'mappingRevision',
    }),
    'write_outcome_unknown': frozenset({'issueKey', 'field'}),
    'jira_rate_limited': frozenset({'retryAfterSeconds'}),
}


def _issue_field_ids():
    return {
        'assignee': 'assignee',
        'deliveryOwner': get_delivery_owner_field_id(),
        'storyPoints': get_story_points_field_id(),
    }


def _issue_field_scopes(field, *, write=False):
    if field not in _ISSUE_FIELD_NAMES:
        raise FieldEditInputError('invalid_field')
    scopes = {'read:jira-work'}
    if field in _ISSUE_PEOPLE_FIELDS:
        scopes.add('read:jira-user')
    if write:
        scopes.add('write:jira-work')
    return scopes


def _require_issue_field_scopes(auth_context, field, *, write=False):
    if missing_context_oauth_scopes(
            auth_context, _issue_field_scopes(field, write=write)):
        raise AuthError(
            'missing_oauth_scope',
            'Your Jira sign-in needs updated permissions.',
        )


def _issue_field_service_error_response(error):
    payload = {'error': error.code}
    allowed = _ISSUE_FIELD_ERROR_DETAIL_KEYS.get(error.code, ())
    for key in allowed:
        if key in error.details:
            payload[key] = error.details[key]
    return jsonify(payload), error.status or 502


def _issue_field_basic_denial():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    return None


@bp.route('/api/issues/<issue_key>/editable-fields', methods=['GET'])
def get_editable_issue_field(issue_key):
    basic_denial = _issue_field_basic_denial()
    if basic_denial is not None:
        return basic_denial
    if request.headers.get('X-Requested-With') != 'jira-execution-planner':
        return jsonify({
            'error': 'csrf_required',
            'message': 'OAuth metadata requests require X-Requested-With: jira-execution-planner',
        }), 403
    if set(request.args) != {'field'}:
        return jsonify({'error': 'invalid_field'}), 400
    field = request.args.get('field')
    try:
        auth_context = current_request_auth_context()
        _require_issue_field_scopes(auth_context, field)
        result = load_editable_field(
            issue_key,
            field,
            jira_request=current_jira_request,
            context=auth_context,
            field_ids=_issue_field_ids(),
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except FieldEditInputError as error:
        return jsonify({'error': error.code}), 400
    except FieldEditServiceError as error:
        return _issue_field_service_error_response(error)
    except Exception:
        logger.exception('Editable Jira issue field metadata failed')
        return jsonify({'error': 'jira_read_failed'}), 502
    return jsonify(result)


@bp.route('/api/issues/<issue_key>/user-options', methods=['POST'])
def post_issue_field_user_options(issue_key):
    basic_denial = _issue_field_basic_denial()
    if basic_denial is not None:
        return basic_denial
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    try:
        auth_context = current_request_auth_context()
        field = payload.get('field')
        _require_issue_field_scopes(auth_context, field)
        result = search_field_users(
            issue_key,
            payload,
            jira_request=current_jira_request,
            context=auth_context,
            field_ids=_issue_field_ids(),
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except FieldEditInputError as error:
        return jsonify({'error': error.code}), 400
    except FieldEditServiceError as error:
        return _issue_field_service_error_response(error)
    except Exception:
        logger.exception('Jira issue field user search failed')
        return jsonify({'error': 'jira_read_failed'}), 502
    return jsonify(result)


@bp.route('/api/issues/<issue_key>/field', methods=['POST'])
def post_issue_field(issue_key):
    basic_denial = _issue_field_basic_denial()
    if basic_denial is not None:
        return basic_denial
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    try:
        auth_context = current_request_auth_context()
        field = payload.get('field')
        _require_issue_field_scopes(auth_context, field, write=True)
        result = update_issue_field(
            issue_key,
            payload,
            jira_request=current_jira_request,
            context=auth_context,
            field_ids=_issue_field_ids(),
            invalidate=clear_jira_issue_status_caches,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except FieldEditInputError as error:
        return jsonify({'error': error.code}), 400
    except FieldEditServiceError as error:
        return _issue_field_service_error_response(error)
    except Exception:
        logger.exception('Jira issue field update failed')
        return jsonify({'error': 'jira_read_failed'}), 502
    return jsonify(result)


@bp.route('/api/dependencies', methods=['POST'])
def get_dependencies():
    """Fetch dependency links for a set of issues."""
    try:
        payload = request.get_json(silent=True) or {}
        keys = sorted({str(key).strip() for key in (payload.get('keys') or []) if str(key).strip()})
        if not keys:
            return jsonify({'dependencies': {}})

        started_at = time.perf_counter()
        auth_context = current_request_auth_context()
        cache_generation = get_jira_issue_cache_generation()
        cache_enabled = jira_home_partitioned_process_cache_enabled(auth_context)
        cache_key = build_jira_home_process_cache_key(auth_context, 'dependencies', ','.join(keys))
        cached_entry = None
        if cache_enabled:
            with _cache_lock:
                cached_entry = DEPENDENCIES_CACHE.get(cache_key)
        if cache_enabled and cached_entry and (time.time() - cached_entry.get('timestamp', 0)) < DEPENDENCIES_CACHE_TTL_SECONDS:
            response = jsonify({'dependencies': cached_entry.get('data') or {}})
            response.headers['Server-Timing'] = 'cache;dur=1'
            return response

        collect_started_at = time.perf_counter()
        dependencies = collect_dependencies(keys, context=auth_context)
        collect_ms = round((time.perf_counter() - collect_started_at) * 1000, 1)
        if cache_enabled:
            with _cache_lock:
                if get_jira_issue_cache_generation() == cache_generation:
                    DEPENDENCIES_CACHE[cache_key] = {'timestamp': time.time(), 'data': dependencies}
        total_ms = round((time.perf_counter() - started_at) * 1000, 1)
        response = jsonify({'dependencies': dependencies})
        response.headers['Server-Timing'] = f'collect;dur={collect_ms}, total;dur={total_ms}'
        return response
    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        logger.exception('Dependencies endpoint error')
        return jsonify({'error': 'Failed to fetch dependencies', 'message': str(e)}), 500


@bp.route('/api/issues/lookup', methods=['GET'])
def lookup_issues():
    """Lookup issues by key/id for dependency popovers."""
    try:
        keys_param = request.args.get('keys', '') or ''
        ids_param = request.args.get('ids', '') or ''
        keys = [k.strip() for k in keys_param.split(',') if k.strip()]
        ids = [i.strip() for i in ids_param.split(',') if i.strip()]
        if not keys and not ids:
            return jsonify({'issues': []})

        auth_context = current_request_auth_context()
        team_field_id = resolve_team_field_id(None, context=auth_context)
        epic_link_field_id = resolve_epic_link_field_id(None, context=auth_context)

        fields_list = [
            'summary',
            'status',
            'issuetype',
            'assignee',
            get_story_points_field_id(),
            'parent'
        ]
        if epic_link_field_id and epic_link_field_id not in fields_list:
            fields_list.append(epic_link_field_id)
        if team_field_id and team_field_id not in fields_list:
            fields_list.append(team_field_id)

        issues = []
        if keys:
            unique_keys = sorted({str(k).strip() for k in keys if str(k).strip()})
            issues.extend(fetch_issues_by_keys(unique_keys, fields_list))

        if ids:
            unique_ids = sorted({str(i).strip() for i in ids if str(i).strip()})
            jql = f'id in ({",".join(unique_ids)})'
            payload = {
                'jql': jql,
                'maxResults': len(unique_ids),
                'fields': fields_list
            }
            response = jira_search_request(payload)
            if response.status_code == 200:
                data = response.json() or {}
                issues.extend(data.get('issues', []) or [])
            else:
                log_warning(f'Lookup fetch error: status={response.status_code}')

        snapshots = []
        for issue in issues:
            snapshot = build_issue_snapshot(issue, team_field_id, epic_link_field_id)
            snapshot['id'] = issue.get('id')
            snapshots.append(snapshot)

        return jsonify({'issues': snapshots})
    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        logger.exception('Issue lookup error')
        return jsonify({'error': 'Failed to lookup issues', 'message': str(e)}), 500


@bp.route('/api/issues/subtasks', methods=['GET'])
def get_story_subtasks():
    """Fetch selected-sprint subtasks for one parent story."""
    try:
        parent_key = (request.args.get('parentKey') or '').strip()
        sprint = (request.args.get('sprint') or '').strip()
        refresh = str(request.args.get('refresh') or '').strip().lower() == 'true'
        if not parent_key:
            return jsonify({'error': 'missing_parent_key'}), 400
        if not sprint:
            return jsonify({'error': 'missing_sprint'}), 400
        try:
            sprint_id = normalize_sprint_id(sprint)
        except ValueError:
            return jsonify({'error': 'invalid_sprint'}), 400

        started_at = time.perf_counter()
        auth_context = current_request_auth_context()
        cache_generation = get_jira_issue_cache_generation()
        cache_enabled = jira_home_partitioned_process_cache_enabled(auth_context)
        cache_key = build_jira_home_process_cache_key(
            auth_context,
            'story-subtasks',
            parent_key.upper(),
            sprint_id,
        )
        if cache_enabled and not refresh:
            with _cache_lock:
                cached_entry = SUBTASKS_CACHE.get(cache_key)
            if cached_entry and (time.time() - cached_entry.get('timestamp', 0)) < SUBTASKS_CACHE_TTL_SECONDS:
                response = jsonify(shape_subtasks_payload(
                    parent_key,
                    sprint_id,
                    cached_entry.get('issues') or [],
                    cached=True,
                ))
                response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                response.headers['Pragma'] = 'no-cache'
                response.headers['Expires'] = '0'
                response.headers['Server-Timing'] = 'cache;dur=1'
                response.headers['X-Cache'] = 'HIT'
                return response

        issues = fetch_subtask_issues_by_jql(
            build_subtasks_jql(parent_key, sprint_id),
            SUBTASK_FIELDS,
            search_request=jira_search_request,
            context=auth_context,
            max_results=500,
            log_warning_fn=log_warning,
        )
        if cache_enabled:
            with _cache_lock:
                if get_jira_issue_cache_generation() == cache_generation:
                    SUBTASKS_CACHE[cache_key] = {'timestamp': time.time(), 'issues': issues}

        response = jsonify(shape_subtasks_payload(parent_key, sprint_id, issues, cached=False))
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['Server-Timing'] = f'jira-search;dur={round((time.perf_counter() - started_at) * 1000, 1)}'
        response.headers['X-Cache'] = 'MISS'
        return response
    except AuthError as error:
        return _eng_auth_error_response(error)
    except SubtasksFetchError:
        logger.exception('Story subtasks Jira fetch failed')
        return jsonify({'error': 'subtasks_fetch_failed', 'message': 'Failed to fetch subtasks from Jira.'}), 502
    except Exception:
        logger.exception('Story subtasks endpoint error')
        return jsonify({'error': 'subtasks_fetch_failed', 'message': 'Failed to fetch subtasks from Jira.'}), 502


@bp.route('/api/issues/description', methods=['GET'])
def get_issue_description():
    """Fetch and render one issue's Jira description for the epic detail panel.

    `description` is deliberately absent from every other fields list in this
    app (fetch_epic_details_bulk included) because its ADF body is large and is
    only needed once a panel opens. This route fetches it for exactly one issue,
    on demand, and renders it server-side with the shared ADF renderer so the
    client never has to parse ADF.
    """
    key = (request.args.get('key') or '').strip().upper()
    if not key or not _ISSUE_KEY_RE.match(key):
        return jsonify({'error': 'invalid_issue_key'}), 400

    try:
        auth_context = current_request_auth_context()
        response = current_jira_get(
            f'/rest/api/3/issue/{key}',
            params={'fields': 'description'},
            context=auth_context,
        )
        if response.status_code in (404, 403):
            # Jira returns 404 for "no such issue" and 403 for "issue exists
            # but you cannot see it" -- folding both into the same 404 body
            # keeps the two cases byte-identical so the response never leaks
            # which one occurred.
            return jsonify({'error': 'issue_not_found'}), 404
        if response.status_code != 200:
            raise RuntimeError(f'Jira returned status {response.status_code}')
        data = response.json() or {}
        html = adf_to_html((data.get('fields') or {}).get('description'))
    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        logger.exception('Issue description Jira fetch failed')
        return jsonify({'error': 'issue_description_fetch_failed', 'message': str(e)}), 502

    return jsonify({'key': key, 'html': html, 'isEmpty': _adf_html_is_blank(html)})


@bp.route('/api/issues/transitions/options', methods=['POST'])
def get_issue_transition_options():
    """Fetch available Jira status transitions for selected ENG issue keys."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403

    try:
        auth_context = current_request_auth_context()
        result = load_transition_options(
            payload.get('issueKeys'),
            jira_request=current_jira_request,
            search_request=current_jira_search,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except IssueTransitionInputError as error:
        return jsonify({'error': error.code}), 400
    except IssueTransitionServiceError:
        logger.exception('Issue transition options Jira fetch failed')
        return jsonify({'error': 'jira_transition_options_failed'}), 502
    except Exception:
        logger.exception('Issue transition options endpoint error')
        return jsonify({'error': 'jira_transition_options_failed'}), 502

    return jsonify(result)


@bp.route('/api/issues/transitions', methods=['POST'])
def post_issue_transitions():
    """Transition selected ENG issue keys to a requested Jira status."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403

    try:
        auth_context = current_request_auth_context()
        if _missing_write_jira_work_scope(auth_context):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')
        result = transition_issues(
            payload.get('issueKeys'),
            payload.get('targetStatus'),
            jira_request=current_jira_request,
            search_request=current_jira_search,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except IssueTransitionInputError as error:
        return jsonify({'error': error.code}), 400
    except IssueTransitionServiceError:
        logger.exception('Issue transition write Jira fetch failed')
        return jsonify({'error': 'jira_transition_failed'}), 502
    except Exception:
        logger.exception('Issue transition write endpoint error')
        return jsonify({'error': 'jira_transition_failed'}), 502

    if result.get('succeeded', 0) > 0:
        clear_jira_issue_status_caches()
    return jsonify(result)


@bp.route('/api/issues/priorities/options', methods=['GET'])
def get_issue_priority_options():
    """Fetch the Jira priority catalog used by priority edit menus.

    With an optional ``issueKey`` query param, the catalog is filtered to that issue's own
    priority scheme via editmeta (OAuth read:jira-work only); without it, the full site
    catalog is returned (backward-compatible).
    """
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403

    issue_key = (request.args.get('issueKey') or '').strip()
    try:
        auth_context = current_request_auth_context()
        if issue_key:
            result = load_priority_options_for_issue(
                issue_key, jira_request=current_jira_request, context=auth_context
            )
        else:
            result = load_priority_options(jira_request=current_jira_request, context=auth_context)
    except AuthError as error:
        return _eng_auth_error_response(error)
    except IssuePriorityInputError as error:
        return jsonify({'error': error.code}), 400
    except IssuePriorityServiceError as error:
        if error.code == 'issue_not_found':
            return jsonify({'error': 'issue_not_found'}), 404
        logger.exception('Issue priority options Jira fetch failed')
        return jsonify({'error': 'jira_priority_options_failed'}), 502
    except Exception:
        logger.exception('Issue priority options endpoint error')
        return jsonify({'error': 'jira_priority_options_failed'}), 502

    result['cached'] = False
    return jsonify(result)


@bp.route('/api/issues/priorities', methods=['POST'])
def post_issue_priorities():
    """Change one or more ENG issue priorities to a target Jira priority ID."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403

    try:
        auth_context = current_request_auth_context()
        if _missing_write_jira_work_scope(auth_context):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')
        result = update_issue_priorities(
            payload.get('issueKeys'),
            payload.get('targetPriorityId'),
            jira_request=current_jira_request,
            search_request=current_jira_search,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except IssuePriorityInputError as error:
        return jsonify({'error': error.code}), 400
    except IssuePriorityServiceError:
        logger.exception('Issue priority write Jira fetch failed')
        return jsonify({'error': 'jira_priority_update_failed'}), 502
    except Exception:
        logger.exception('Issue priority write endpoint error')
        return jsonify({'error': 'jira_priority_update_failed'}), 502

    if result.get('succeeded', 0) > 0:
        clear_jira_issue_status_caches(reason='issue_priority_update')
    return jsonify(result)


_PROJECT_TRACK_CONFLICT_CODES = {
    'issue_not_epic', 'project_track_not_editable', 'project_track_option_unavailable',
}


def _project_track_service_error_response(error, failure_code):
    if error.code == 'issue_not_found':
        return jsonify({'error': 'issue_not_found'}), 404
    if error.code in _PROJECT_TRACK_CONFLICT_CODES:
        return jsonify({'error': error.code}), 409
    logger.exception('Issue project track Jira call failed')
    return jsonify({'error': failure_code}), 502


@bp.route('/api/issues/project-track/options', methods=['GET'])
def get_issue_project_track_options():
    """Canonical Project Track options from this issue's Jira editmeta."""
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    issue_key = (request.args.get('issueKey') or '').strip()
    if not issue_key:
        return jsonify({'error': 'invalid_issue_key'}), 400
    try:
        auth_context = current_request_auth_context()
        result = load_project_track_options_for_issue(
            issue_key,
            jira_request=current_jira_request,
            get_project_track_field_id=get_project_track_field_id,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except ProjectTrackInputError as error:
        return jsonify({'error': error.code}), 400
    except ProjectTrackServiceError as error:
        return _project_track_service_error_response(error, 'jira_project_track_options_failed')
    except Exception:
        logger.exception('Issue project track options endpoint error')
        return jsonify({'error': 'jira_project_track_options_failed'}), 502
    return jsonify(result)


@bp.route('/api/issues/project-track', methods=['POST'])
def post_issue_project_track():
    """Set one real Epic's Project Track to Flexible or Committed."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    try:
        auth_context = current_request_auth_context()
        if _missing_write_jira_work_scope(auth_context):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')
        result = update_issue_project_track(
            payload.get('issueKey'),
            payload.get('targetTrack'),
            jira_request=current_jira_request,
            get_project_track_field_id=get_project_track_field_id,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except ProjectTrackInputError as error:
        return jsonify({'error': error.code}), 400
    except ProjectTrackServiceError as error:
        return _project_track_service_error_response(error, 'jira_project_track_update_failed')
    except Exception:
        logger.exception('Issue project track write endpoint error')
        return jsonify({'error': 'jira_project_track_update_failed'}), 502
    if result.get('result') == 'success':
        clear_jira_issue_status_caches(reason='issue_project_track_update')
    return jsonify(result)


@bp.route('/api/issues/statuses/catalog', methods=['GET'])
def get_issue_status_catalog():
    """Fetch the full Jira workflow status catalog once per app session."""
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403

    try:
        auth_context = current_request_auth_context()
        result = load_status_catalog(jira_request=current_jira_request, context=auth_context)
    except AuthError as error:
        return _eng_auth_error_response(error)
    except IssueTransitionServiceError:
        logger.exception('Issue status catalog Jira fetch failed')
        return jsonify({'error': 'jira_status_catalog_failed'}), 502
    except Exception:
        logger.exception('Issue status catalog endpoint error')
        return jsonify({'error': 'jira_status_catalog_failed'}), 502

    result['cached'] = False
    return jsonify(result)


@bp.route('/api/missing-info', methods=['GET'])
def get_missing_info():
    """Find stories under epics in a given sprint that are missing key planning fields (sprint/SP/team)."""
    try:
        started_at = time.perf_counter()
        sprint = request.args.get('sprint', '').strip()
        team_ids_param = request.args.get('teamIds', '').strip()
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])
        components_param = [c.strip() for c in request.args.get('components', '').split(',') if c.strip()]
        if not sprint:
            return jsonify({'error': 'Missing required query param: sprint'}), 400

        auth_context = current_request_auth_context()
        cache_generation = get_jira_issue_cache_generation()
        effective_components = components_param or ([MISSING_INFO_COMPONENT] if MISSING_INFO_COMPONENT else [])
        effective_team_ids = normalize_team_ids(team_ids or MISSING_INFO_TEAM_IDS)
        cache_enabled = jira_home_partitioned_process_cache_enabled(auth_context)
        cache_key = build_jira_home_process_cache_key(
            auth_context,
            'missing-info',
            sprint,
            ','.join(effective_team_ids),
            ','.join(sorted(effective_components)),
        )
        cached_entry = None
        if cache_enabled:
            with _cache_lock:
                cached_entry = MISSING_INFO_CACHE.get(cache_key)
        if cache_enabled and cached_entry and (time.time() - cached_entry.get('timestamp', 0)) < MISSING_INFO_CACHE_TTL_SECONDS:
            response = jsonify(cached_entry.get('data') or {'issues': [], 'epics': [], 'count': 0})
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
            response.headers['Server-Timing'] = 'cache;dur=1'
            return response

        # Resolve fields
        team_field_id = resolve_team_field_id(None, context=auth_context)
        epic_link_field_id = resolve_epic_link_field_id(None, context=auth_context)

        scope_clause = build_missing_info_scope_clause(effective_team_ids, effective_components)

        # 1) Fetch epics that are in the sprint (future sprint planning), scoped by component/team.
        epic_jql = f'Sprint = {sprint} AND issuetype = Epic'
        if scope_clause:
            epic_jql = add_clause_to_jql(epic_jql, scope_clause)
        epic_jql = add_clause_to_jql(epic_jql, 'status not in ("Killed","Done","Incomplete")')
        epic_jql = add_clause_to_jql(epic_jql, f'project in ("{JIRA_PRODUCT_PROJECT}","{JIRA_TECH_PROJECT}")')

        epic_fields = ['summary', 'status', 'assignee', 'parent', 'components']
        if team_field_id:
            epic_fields.append(team_field_id)

        epics_resp = jira_search_request({
            'jql': epic_jql,
            'maxResults': 250,
            'fields': epic_fields
        })
        if epics_resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch epics for missing-info scan', 'details': epics_resp.text}), 502

        epics_data = epics_resp.json() or {}
        epic_issues = epics_data.get('issues', []) or []
        epic_keys = [e.get('key') for e in epic_issues if e.get('key')]
        if not epic_keys:
            payload = {'issues': [], 'epics': [], 'count': 0}
            if cache_enabled:
                with _cache_lock:
                    if get_jira_issue_cache_generation() == cache_generation:
                        MISSING_INFO_CACHE[cache_key] = {'timestamp': time.time(), 'data': payload}
            response = jsonify(payload)
            response.headers['Server-Timing'] = f'total;dur={round((time.perf_counter() - started_at) * 1000, 1)}'
            return response

        # Build epics summary for the response
        epics_summary = []
        for epic in epic_issues:
            ef = epic.get('fields', {}) or {}
            epic_status = (ef.get('status') or {}).get('name') or ''
            epic_components = [c.get('name', '') for c in (ef.get('components') or []) if c.get('name')]
            raw_team = None
            if team_field_id and ef.get(team_field_id) is not None:
                raw_team = ef.get(team_field_id)
            epic_team_name = extract_team_name(raw_team) if raw_team else ''
            epic_team_id = None
            if raw_team:
                tv = build_team_value(raw_team)
                epic_team_id = tv.get('id') if isinstance(tv, dict) else None
            epics_summary.append({
                'key': epic.get('key'),
                'summary': ef.get('summary', ''),
                'status': epic_status,
                'components': epic_components,
                'teamName': epic_team_name,
                'teamId': epic_team_id
            })

        # 2) Fetch stories under those epics, regardless of story sprint (to catch missing Sprint field).
        story_fields = [
            'summary',
            'status',
            'priority',
            'issuetype',
            'assignee',
            'updated',
            get_story_points_field_id(),  # Story Points
            get_sprint_field_id(),  # Sprint
            'parent'
        ]
        if epic_link_field_id and epic_link_field_id not in story_fields:
            story_fields.append(epic_link_field_id)
        if team_field_id and team_field_id not in story_fields:
            story_fields.append(team_field_id)

        missing = []
        batch_size = 40
        for start in range(0, len(epic_keys), batch_size):
            batch = epic_keys[start:start + batch_size]

            link_clause = f'"Epic Link" in ({",".join(batch)})'
            parent_clause = f'parent in ({",".join(batch)})'
            # Important: do NOT scope stories by component/team here because the whole point is to
            # find stories missing those fields. We only scope epics, then pull every story under them.
            story_jql = f'({link_clause} OR {parent_clause}) AND issuetype = Story AND status not in (Killed, Done, Postponed)'

            next_page_token = None
            while True:
                payload = {
                    'jql': story_jql,
                    'maxResults': 250,
                    'fields': story_fields
                }
                if next_page_token:
                    payload['nextPageToken'] = next_page_token
                resp = jira_search_request(payload)
                if resp.status_code != 200:
                    break

                data = resp.json() or {}
                issues = data.get('issues', []) or []
                if not issues:
                    break

                for issue in issues:
                    fields = issue.get('fields', {}) or {}
                    status = (fields.get('status') or {}).get('name') or ''
                    if str(status).strip().lower() == 'postponed':
                        continue

                    # team enrichment
                    raw_team = None
                    if team_field_id and fields.get(team_field_id) is not None:
                        raw_team = fields.get(team_field_id)
                    if raw_team is not None:
                        team_name = extract_team_name(raw_team)
                        fields['team'] = build_team_value(raw_team)
                        fields['teamName'] = team_name
                        fields['teamId'] = fields['team'].get('id') if isinstance(fields['team'], dict) else None

                    # epic link
                    epic_key = None
                    if epic_link_field_id and fields.get(epic_link_field_id):
                        epic_key = fields.get(epic_link_field_id)
                    elif fields.get('parent') and fields['parent'].get('key') and \
                            fields['parent'].get('fields', {}).get('issuetype', {}).get('name', '').lower() == 'epic':
                        epic_key = fields['parent'].get('key')
                    if epic_key:
                        fields['epicKey'] = epic_key

                    sp = fields.get(get_story_points_field_id())
                    try:
                        sp_num = float(sp) if sp not in (None, '', []) else 0.0
                    except Exception:
                        sp_num = 0.0
                    has_sp = sp_num > 0

                    sprint_value = fields.get(get_sprint_field_id())
                    has_sprint = bool(sprint_value)
                    has_team = bool(fields.get('teamName'))

                    missing_fields = []
                    if not has_sprint:
                        missing_fields.append('Sprint')
                    if not has_sp:
                        missing_fields.append('Story Points')
                    if not has_team:
                        missing_fields.append('Team')

                    if not missing_fields:
                        continue

                    assignee = fields.get('assignee') or {}
                    priority = fields.get('priority') or {}
                    issuetype = fields.get('issuetype') or {}
                    missing.append({
                        'id': issue.get('id'),
                        'key': issue.get('key'),
                        'fields': {
                            'summary': fields.get('summary'),
                            'status': {'name': status} if status else None,
                            'priority': {'name': priority.get('name')} if priority else None,
                            'issuetype': {'name': issuetype.get('name')} if issuetype else None,
                            'assignee': shape_jira_person(assignee),
                            'updated': fields.get('updated'),
                            'customfield_10004': fields.get(get_story_points_field_id()),
                            'customfield_10101': fields.get(get_sprint_field_id()),
                            'team': fields.get('team'),
                            'teamName': fields.get('teamName'),
                            'teamId': fields.get('teamId'),
                            'epicKey': fields.get('epicKey'),
                            'missingFields': missing_fields
                        }
                    })

                next_page_token = data.get('nextPageToken')
                if data.get('isLast', not next_page_token) or not next_page_token:
                    break

        payload = {'issues': missing, 'epics': epics_summary, 'count': len(missing), 'epicCount': len(epic_keys)}
        if cache_enabled:
            with _cache_lock:
                if get_jira_issue_cache_generation() == cache_generation:
                    MISSING_INFO_CACHE[cache_key] = {'timestamp': time.time(), 'data': payload}
        response = jsonify(payload)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['Server-Timing'] = f'total;dur={round((time.perf_counter() - started_at) * 1000, 1)}'
        return response
    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        logger.exception('Missing-info error')
        return jsonify({'error': 'Failed to compute missing-info', 'message': str(e)}), 500


@bp.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API."""
    return fetch_tasks(include_team_name=False)


@bp.route('/api/tasks-with-team-name', methods=['GET'])
def get_tasks_with_team_name():
    """Fetch tasks with team name derived from Jira Team field."""
    return fetch_tasks(include_team_name=True)


@bp.route('/api/teams', methods=['GET'])
def get_teams():
    """Fetch all unique teams from the current sprint."""
    try:
        sprint = request.args.get('sprint', '')
        team_ids_param = request.args.get('teamIds', '').strip()
        fetch_all = request.args.get('all', '').lower() == 'true'
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])
        use_template = bool(team_ids and JQL_QUERY_TEMPLATE) and not fetch_all

        # Build JQL query from env or dashboard config
        if use_template:
            jql = apply_team_ids_to_template(team_ids)
            if not jql:
                jql = build_base_jql()
        else:
            jql = build_base_jql()

        if not jql:
            return jsonify({'error': 'No projects configured', 'teams': []}), 400

        # If fetching all teams, remove team filter but keep sprint scope
        project_scope_jql = None
        if fetch_all:
            jql = remove_team_filter_from_jql(jql)
            project_scope_jql = jql
            if sprint:
                jql = add_clause_to_jql(jql, f"Sprint = {sprint}")
        elif sprint:
            jql = add_clause_to_jql(jql, f"Sprint = {sprint}")

        auth_context = current_request_auth_context()
        team_field_id = resolve_team_field_id(None, context=auth_context)

        # Fetch tasks - paginate through all issues
        fields_list = ['summary', 'status']
        if team_field_id:
            fields_list.append(team_field_id)

        def fetch_team_issues(query):
            max_results = 100
            max_pages = 30  # Cap at ~3000 issues for team discovery
            page_count = 0
            next_page_token = None
            all_issues = []
            names_map = {}

            while True:
                payload = {
                    'jql': query,
                    'maxResults': max_results,
                    'fields': fields_list
                }
                if next_page_token:
                    payload['nextPageToken'] = next_page_token

                response = jira_search_request(payload)
                if response.status_code != 200:
                    return all_issues, names_map, response

                data = response.json()
                names_map.update(data.get('names', {}) or {})
                issues = data.get('issues', [])

                if not issues:
                    break

                all_issues.extend(issues)
                page_count += 1
                if page_count >= max_pages:
                    break

                # Check if we've fetched everything (using new pagination API)
                is_last = data.get('isLast', True)
                if is_last:
                    break

                next_page_token = data.get('nextPageToken')
                if not next_page_token:
                    break

            return all_issues, names_map, None

        def collect_teams_from_issues(issues, names_map, teams_map):
            effective_team_field_id = team_field_id
            if not effective_team_field_id:
                effective_team_field_id = next((k for k, v in names_map.items() if str(v).lower() == 'team[team]'), None)

            for issue in issues:
                fields = issue.get('fields', {})
                raw_team = None

                if effective_team_field_id and fields.get(effective_team_field_id) is not None:
                    raw_team = fields.get(effective_team_field_id)

                if raw_team is not None:
                    team_value = build_team_value(raw_team)
                    team_id = team_value.get('id') if isinstance(team_value, dict) else None
                    team_name = extract_team_name(raw_team)

                    if team_id and team_name:
                        teams_map[team_id] = {
                            'id': team_id,
                            'name': team_name
                        }

        all_issues, names_map, error_response = fetch_team_issues(jql)
        if error_response is not None:
            return jsonify({'error': 'Failed to fetch teams', 'details': error_response.text}), error_response.status_code

        # Extract unique teams (no filtering - return all teams)
        teams_map = {}
        collect_teams_from_issues(all_issues, names_map, teams_map)

        # When fetching all teams, also query Jira Teams API directly
        # to catch teams that have no issues in PRODUCT/TECH projects
        if fetch_all:
            api_teams = fetch_teams_from_jira_api()
            for tid, tval in api_teams.items():
                if tid not in teams_map:
                    teams_map[tid] = tval
            if not teams_map and sprint and project_scope_jql and project_scope_jql != jql:
                fallback_issues, fallback_names_map, error_response = fetch_team_issues(project_scope_jql)
                if error_response is not None:
                    return jsonify({'error': 'Failed to fetch teams', 'details': error_response.text}), error_response.status_code
                collect_teams_from_issues(fallback_issues, fallback_names_map, teams_map)

        # Sort teams by name
        teams_list = sorted(teams_map.values(), key=lambda t: t['name'].lower())

        return jsonify({'teams': teams_list})

    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to fetch teams', 'details': str(e)}), 500


@bp.route('/api/teams/resolve', methods=['GET'])
def resolve_team_names():
    """Resolve team names for a list of team IDs."""
    try:
        team_ids_param = request.args.get('teamIds', '').strip()
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])
        if not team_ids:
            return jsonify({'error': 'teamIds is required'}), 400

        auth_context = current_request_auth_context()
        team_field_id = resolve_team_field_id(None, context=auth_context)
        if not team_field_id:
            team_field_id = TEAM_FIELD_DEFAULT

        base_jql = remove_team_filter_from_jql(build_base_jql())
        quoted = ', '.join(f'"{team_id}"' for team_id in team_ids)
        jql = add_clause_to_jql(base_jql, f'"Team[Team]" in ({quoted})')

        fields_list = ['summary']
        if team_field_id and team_field_id not in fields_list:
            fields_list.append(team_field_id)

        max_results = 250
        next_page_token = None
        teams_map = {}

        while True:
            payload = {
                'jql': jql,
                'maxResults': max_results,
                'fields': fields_list
            }
            if next_page_token:
                payload['nextPageToken'] = next_page_token
            response = jira_search_request(payload)
            if response.status_code != 200:
                return jsonify({'error': 'Failed to resolve teams', 'details': response.text}), response.status_code
            data = response.json() or {}
            issues = data.get('issues', []) or []
            if not issues:
                break

            for issue in issues:
                fields = issue.get('fields', {}) or {}
                raw_team = None
                if team_field_id and fields.get(team_field_id) is not None:
                    raw_team = fields.get(team_field_id)
                if raw_team is None:
                    continue
                team_value = build_team_value(raw_team)
                team_id = team_value.get('id') if isinstance(team_value, dict) else None
                team_name = extract_team_name(raw_team)
                if team_id and team_name and team_id in team_ids:
                    teams_map[team_id] = {'id': team_id, 'name': team_name}

            if len(teams_map) >= len(team_ids):
                break

            next_page_token = data.get('nextPageToken')
            if data.get('isLast', not next_page_token) or not next_page_token:
                break

        missing = [team_id for team_id in team_ids if team_id not in teams_map]
        return jsonify({'teams': list(teams_map.values()), 'missing': missing})

    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to resolve teams', 'details': str(e)}), 500


@bp.route('/api/teams/all', methods=['GET'])
def get_all_teams_list():
    """Fetch ALL teams from Jira for debugging - no filtering, simple list format."""
    try:
        sprint = request.args.get('sprint', '')

        # Build JQL query - remove team filter to get ALL teams
        jql = remove_team_filter_from_jql(build_base_jql())
        if sprint:
            jql = add_clause_to_jql(jql, f"Sprint = {sprint}")

        auth_context = current_request_auth_context()
        team_field_id = resolve_team_field_id(None, context=auth_context)

        # Fetch tasks
        fields_list = ['summary', 'status']
        if team_field_id:
            fields_list.append(team_field_id)

        # Paginate through ALL issues using new API
        max_results = 100
        next_page_token = None
        all_issues = []

        while True:
            payload = {
                'jql': jql,
                'maxResults': max_results,
                'fields': fields_list
            }
            if next_page_token:
                payload['nextPageToken'] = next_page_token

            response = jira_search_request(payload)
            if response.status_code != 200:
                return jsonify({'error': 'Failed to fetch teams', 'details': response.text}), response.status_code

            data = response.json()
            issues = data.get('issues', [])

            if not issues:
                break

            all_issues.extend(issues)

            # Check if we've fetched everything (using new pagination API)
            is_last = data.get('isLast', True)
            if is_last:
                break

            next_page_token = data.get('nextPageToken')
            if not next_page_token:
                break

        names_map = data.get('names', {}) or {}
        if not team_field_id:
            team_field_id = next((k for k, v in names_map.items() if str(v).lower() == 'team[team]'), None)

        # Extract unique teams - NO FILTERING
        teams_map = {}
        for issue in all_issues:
            fields = issue.get('fields', {})
            raw_team = None

            if team_field_id and fields.get(team_field_id) is not None:
                raw_team = fields.get(team_field_id)

            if raw_team is not None:
                team_value = build_team_value(raw_team)
                team_id = team_value.get('id') if isinstance(team_value, dict) else None
                team_name = extract_team_name(raw_team)

                if team_id and team_name:
                    teams_map[team_id] = {
                        'id': team_id,
                        'name': team_name
                    }

        # Sort teams by name
        teams_list = sorted(teams_map.values(), key=lambda t: t['name'].lower())

        # Return simple format
        return jsonify({
            'total_teams': len(teams_list),
            'issues_fetched': len(all_issues),
            'sprint': sprint,
            'jql': jql,
            'teams': teams_list
        })

    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to fetch all teams', 'details': str(e)}), 500


@bp.route('/api/backlog-epics', methods=['GET'])
def get_backlog_epics():
    """Fetch backlog epics for future-planning alerts."""
    try:
        project_filter = request.args.get('project', '').strip().lower()
        team_ids_param = request.args.get('teamIds', '').strip()
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])

        if team_ids and JQL_QUERY_TEMPLATE:
            jql = apply_team_ids_to_template(team_ids) or build_base_jql()
        elif team_ids:
            jql = remove_team_filter_from_jql(build_base_jql())
            if len(team_ids) == 1:
                jql = add_clause_to_jql(jql, f'"Team[Team]" = "{team_ids[0]}"')
            else:
                quoted_teams = ', '.join(f'"{tid}"' for tid in team_ids)
                jql = add_clause_to_jql(jql, f'"Team[Team]" in ({quoted_teams})')
        else:
            jql = build_base_jql()

        if project_filter in ('product', 'tech'):
            typed = get_selected_projects_typed()
            if typed:
                matching_keys = [item['key'] for item in typed if item['type'] == project_filter]
                if matching_keys:
                    jql = remove_project_filter_from_jql(jql)
                    if len(matching_keys) == 1:
                        jql = add_clause_to_jql(jql, f'project = "{matching_keys[0]}"')
                    else:
                        quoted = ', '.join(f'"{key}"' for key in matching_keys)
                        jql = add_clause_to_jql(jql, f'project in ({quoted})')

        issue_types = get_configured_issue_types()
        if issue_types:
            if len(issue_types) == 1:
                jql = add_clause_to_jql(jql, f'type = "{issue_types[0]}"')
            else:
                quoted_types = ', '.join(f'"{issue_type}"' for issue_type in issue_types)
                jql = add_clause_to_jql(jql, f'type in ({quoted_types})')

        auth_context = current_request_auth_context()
        team_field_id = resolve_team_field_id(None, context=auth_context)
        epic_link_field_id = resolve_epic_link_field_id(None, context=auth_context)
        sprint_field_id = get_sprint_field_id()
        epics = fetch_backlog_epics_for_alert(
            jql,
            headers=None,
            team_field_id=team_field_id,
            sprint_field_id=sprint_field_id,
            epic_link_field=epic_link_field_id
        )
        return jsonify({'epics': epics})
    except AuthError as error:
        return _eng_auth_error_response(error)
    except Exception as e:
        return jsonify({'error': 'Failed to fetch backlog epics', 'details': str(e)}), 500
