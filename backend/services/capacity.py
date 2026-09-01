"""Capacity service helpers for Jira-backed team capacity data."""

import math
import re
from decimal import Decimal

from backend.auth.jira_auth import AuthError


class CapacityInputError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class CapacityServiceError(Exception):
    def __init__(self, code, status_code=None, current_capacity=None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.current_capacity = current_capacity


_CAPACITY_ISSUE_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]+-\d+$')
_CAPACITY_SEARCH_PAGE_SIZE = 200
_CAPACITY_SEARCH_PAGE_LIMIT = 10


class _CapacitySearchError(Exception):
    def __init__(self, status_code=None):
        super().__init__('capacity_search_failed')
        self.status_code = status_code


class CapacityUpstreamUnauthorized(_CapacitySearchError):
    def __init__(self):
        super().__init__(401)


def _noop(*_args, **_kwargs):
    return None


def normalize_capacity_team_name(team_name):
    """Strip prefixes to match capacity team labels."""
    if not team_name:
        return None
    cleaned = str(team_name).replace('\u00a0', ' ').strip()
    cleaned = re.sub(r'^\[archived\]\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'^r&d\s+', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'^(product|tech)\s*-\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()


def _team_chunks(team_names, chunk_size=20):
    chunks = [team_names[i:i + chunk_size] for i in range(0, len(team_names or []), chunk_size)]
    return chunks or [None]


def build_capacity_jql(sprint_name, team_names=None, *, capacity_project):
    sprint_label = str(sprint_name or '').replace('"', '\\"')
    if team_names:
        clauses = []
        for name in team_names:
            cleaned = str(name).replace('"', '\\"').strip()
            if not cleaned:
                continue
            phrase = f'\\"Team info {sprint_label} - {cleaned}\\"'
            clauses.append(f'summary ~ "{phrase}"')
        if clauses:
            return f'project = "{capacity_project}" AND ({ " OR ".join(clauses) })'
    phrase = f'\\"Team info {sprint_label} -\\"'
    return f'project = "{capacity_project}" AND summary ~ "{phrase}"'


def _build_capacity_jql(build_capacity_jql_fn, sprint_name, team_names, capacity_project):
    try:
        return build_capacity_jql_fn(sprint_name, team_names, capacity_project=capacity_project)
    except TypeError:
        return build_capacity_jql_fn(sprint_name, team_names)


def _search_capacity_issue_pages(search_request, payload, max_pages_per_chunk):
    try:
        page_limit = min(max(int(max_pages_per_chunk), 1), _CAPACITY_SEARCH_PAGE_LIMIT)
    except (TypeError, ValueError, OverflowError):
        page_limit = _CAPACITY_SEARCH_PAGE_LIMIT
    issues = []
    next_page_token = None
    seen_tokens = set()
    for _page_number in range(page_limit):
        page_payload = dict(payload)
        if next_page_token is not None:
            page_payload['nextPageToken'] = next_page_token
        try:
            response = search_request(page_payload)
            status_code = response.status_code
        except AuthError:
            raise
        except Exception as error:
            raise _CapacitySearchError() from error
        if status_code == 401:
            raise CapacityUpstreamUnauthorized()
        if status_code != 200:
            raise _CapacitySearchError(status_code)
        try:
            data = response.json() or {}
            page_issues = data.get('issues') or []
        except Exception as error:
            raise _CapacitySearchError() from error
        if not isinstance(data, dict) or not isinstance(page_issues, list):
            raise _CapacitySearchError()
        if len(page_issues) > _CAPACITY_SEARCH_PAGE_SIZE:
            raise _CapacitySearchError()
        issues.extend(page_issues)
        raw_token = data.get('nextPageToken')
        if data.get('isLast') is True or (data.get('isLast') is None and not raw_token):
            return issues
        if not isinstance(raw_token, str) or not raw_token.strip() or raw_token in seen_tokens:
            raise _CapacitySearchError()
        seen_tokens.add(raw_token)
        next_page_token = raw_token
    raise _CapacitySearchError()


def _jira_capacity_value(value):
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if math.isfinite(parsed) and parsed >= 0 else None


def _client_capacity_value(value, *, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CapacityInputError('invalid_capacity')
    try:
        parsed = float(value)
    except OverflowError as error:
        raise CapacityInputError('invalid_capacity') from error
    if not math.isfinite(parsed) or parsed < 0:
        raise CapacityInputError('invalid_capacity')
    return parsed


def _same_capacity(left, right):
    if left is None or right is None:
        return left is right
    return Decimal(str(left)) == Decimal(str(right))


def _capacity_snapshot(key, sprint_name, team_name, capacity_project, capacity_field_id, jira_request, context):
    try:
        response = jira_request(
            'GET',
            '/rest/api/3/issue/' + key,
            params={'fields': 'project,summary,' + capacity_field_id},
            context=context,
        )
    except AuthError:
        raise
    except Exception as error:
        raise CapacityServiceError('jira_capacity_update_failed', 502) from error

    if response.status_code == 401:
        raise AuthError('auth_required', 'Jira authentication is required.')
    if response.status_code == 403:
        raise CapacityServiceError('capacity_forbidden', 403)
    if response.status_code == 404:
        raise CapacityServiceError('capacity_issue_not_found', 404)
    if response.status_code != 200:
        raise CapacityServiceError('jira_capacity_update_failed', 502)

    try:
        issue = response.json() or {}
        fields = issue.get('fields') or {}
        project_key = (fields.get('project') or {}).get('key')
        summary = str(fields.get('summary') or '').strip()
    except Exception as error:
        raise CapacityServiceError('jira_capacity_update_failed', 502) from error

    if str(project_key or '').strip().upper() != capacity_project.strip().upper():
        raise CapacityServiceError('capacity_issue_mismatch', 409)

    summary_pattern = re.compile(
        rf'^Team info\s+{re.escape(sprint_name)}\s*-\s*(.+)$',
        re.IGNORECASE,
    )
    match = summary_pattern.match(summary)
    issue_team_name = normalize_capacity_team_name(match.group(1)) if match else None
    if not issue_team_name or issue_team_name.casefold() != team_name.casefold():
        raise CapacityServiceError('capacity_issue_mismatch', 409)

    return _jira_capacity_value(fields.get(capacity_field_id))


def _capacity_result(key, team_name, previous_capacity, target_capacity, result):
    return {
        'issueKey': key,
        'teamName': team_name,
        'previousCapacity': previous_capacity,
        'capacity': target_capacity,
        'result': result,
    }


def update_capacity_issue(
    issue_key,
    payload,
    *,
    capacity_project,
    capacity_field_id,
    jira_request,
    context=None,
):
    """Best-effort Jira capacity update, not an atomic compare-and-set.

    The validation GET detects a stale acknowledged baseline before the
    unconditional Jira PUT. A remote edit may still land between those calls.
    """
    key = str(issue_key or '').strip().upper()
    if not _CAPACITY_ISSUE_KEY_RE.fullmatch(key):
        raise CapacityInputError('invalid_issue_key')

    if not isinstance(payload, dict):
        raise CapacityInputError('capacity_identity_required')
    sprint_value = payload.get('sprintName')
    team_value = payload.get('teamName')
    if not isinstance(sprint_value, str) or not sprint_value.strip():
        raise CapacityInputError('capacity_identity_required')
    if not isinstance(team_value, str) or not team_value.strip():
        raise CapacityInputError('capacity_identity_required')
    sprint_name = sprint_value.strip()
    team_name = normalize_capacity_team_name(team_value)
    if not team_name:
        raise CapacityInputError('capacity_identity_required')

    if 'expectedCapacity' not in payload:
        raise CapacityInputError('invalid_capacity')
    expected_capacity = _client_capacity_value(payload.get('expectedCapacity'), allow_none=True)
    target_capacity = _client_capacity_value(payload.get('capacity'))

    if not isinstance(capacity_project, str) or not capacity_project.strip():
        raise CapacityServiceError('capacity_config_missing', 409)
    if not isinstance(capacity_field_id, str) or not capacity_field_id.strip():
        raise CapacityServiceError('capacity_config_missing', 409)
    configured_project = capacity_project.strip()
    field_id = capacity_field_id.strip()

    current_capacity = _capacity_snapshot(
        key,
        sprint_name,
        team_name,
        configured_project,
        field_id,
        jira_request,
        context,
    )
    if _same_capacity(current_capacity, target_capacity):
        return _capacity_result(key, team_name, current_capacity, target_capacity, 'already_current')
    if not _same_capacity(current_capacity, expected_capacity):
        raise CapacityServiceError('capacity_conflict', 409, current_capacity)

    try:
        response = jira_request(
            'PUT',
            '/rest/api/3/issue/' + key,
            json_body={'fields': {field_id: target_capacity}},
            context=context,
        )
    except AuthError:
        raise
    except Exception as error:
        raise CapacityServiceError('jira_capacity_update_failed', 502) from error

    if response.status_code in (200, 204):
        return _capacity_result(key, team_name, current_capacity, target_capacity, 'success')
    if response.status_code == 401:
        raise AuthError('auth_required', 'Jira authentication is required.')
    if response.status_code == 400:
        raise CapacityServiceError('capacity_field_not_editable', 409)
    if response.status_code == 403:
        raise CapacityServiceError('capacity_forbidden', 403)
    if response.status_code == 404:
        raise CapacityServiceError('capacity_issue_not_found', 404)
    if response.status_code != 409:
        raise CapacityServiceError('jira_capacity_update_failed', 502)

    latest_capacity = _capacity_snapshot(
        key,
        sprint_name,
        team_name,
        configured_project,
        field_id,
        jira_request,
        context,
    )
    if _same_capacity(latest_capacity, target_capacity):
        return _capacity_result(key, team_name, latest_capacity, target_capacity, 'already_current')
    if not _same_capacity(latest_capacity, expected_capacity):
        raise CapacityServiceError('capacity_conflict', 409, latest_capacity)
    raise CapacityServiceError('jira_capacity_update_conflict', 502)


def fetch_capacity_for_sprint(
    sprint_name,
    headers,
    debug=False,
    team_names=None,
    *,
    capacity_project,
    capacity_field_id,
    mutation_enabled=False,
    search_request,
    max_pages_per_chunk=_CAPACITY_SEARCH_PAGE_LIMIT,
    build_capacity_jql_fn=build_capacity_jql,
    normalize_capacity_team_name_fn=normalize_capacity_team_name,
):
    if not capacity_project:
        return {
            'enabled': False,
            'capacities': {},
            'entries': [],
            'mutationEnabled': False,
        }, None

    if not capacity_field_id:
        return {
            'enabled': False,
            'capacities': {},
            'entries': [],
            'mutationEnabled': False,
            'message': 'Missing Team capacity field ID'
        }, None

    capacities = {}
    entries = []
    debug_items = []
    issues = []
    jqls = []

    for chunk in _team_chunks(team_names):
        jql = _build_capacity_jql(build_capacity_jql_fn, sprint_name, chunk, capacity_project)
        jqls.append(jql)
        payload = {
            'jql': jql,
            'maxResults': _CAPACITY_SEARCH_PAGE_SIZE,
            'fields': ['summary', capacity_field_id]
        }
        try:
            issues.extend(_search_capacity_issue_pages(search_request, payload, max_pages_per_chunk))
        except CapacityUpstreamUnauthorized:
            raise
        except _CapacitySearchError:
            return None, 'jira_capacity_fetch_failed'

    pattern = re.compile(rf'^Team info\s+{re.escape(str(sprint_name))}\s*-\s*(.+)$', re.IGNORECASE)
    seen_issue_keys = set()
    for issue in issues:
        issue_key = str(issue.get('key') or '').strip().upper()
        if not issue_key or issue_key in seen_issue_keys:
            continue
        seen_issue_keys.add(issue_key)
        fields = issue.get('fields') or {}
        summary = str(fields.get('summary') or '').strip()
        match = pattern.match(summary)
        if not match:
            continue
        short_name = normalize_capacity_team_name_fn(match.group(1))
        if not short_name:
            continue
        raw_capacity = fields.get(capacity_field_id)
        if debug:
            debug_items.append({
                'summary': summary,
                'rawCapacity': raw_capacity
            })
        capacity_value = _jira_capacity_value(raw_capacity)
        entries.append({
            'teamName': short_name,
            'issueKey': issue_key,
            'capacity': capacity_value,
        })
        if capacity_value is not None:
            capacities[short_name] = capacity_value

    response_payload = {
        'enabled': True,
        'sprint': sprint_name,
        'capacities': capacities,
        'entries': entries,
        'mutationEnabled': mutation_enabled is True,
    }
    if debug:
        response_payload['debug'] = {
            'jql': jqls if len(jqls) > 1 else jqls[0],
            'issueCount': len(issues),
            'matched': debug_items[:20],
            'fieldId': capacity_field_id
        }
    return response_payload, None


def fetch_watchers_count(issue_key, *, current_jira_get, log_warning_fn=None, logger=None):
    """Fetch watchers count for an issue."""
    if not issue_key:
        return None
    log_warning_fn = log_warning_fn or _noop
    try:
        response = current_jira_get(f'/rest/api/3/issue/{issue_key}/watchers', timeout=20)
        if response.status_code != 200:
            log_warning_fn(f'Watchers fetch failed: status={response.status_code}')
            return None
        data = response.json() or {}
        if isinstance(data.get('watchCount'), int):
            return data['watchCount']
        watchers = data.get('watchers') or []
        return len(watchers)
    except Exception:
        if logger is not None:
            logger.exception('Watchers fetch exception')
        return None


def fetch_capacity_team_sizes(
    sprint_name,
    headers,
    team_names=None,
    *,
    capacity_project,
    search_request,
    max_pages_per_chunk=_CAPACITY_SEARCH_PAGE_LIMIT,
    fetch_watchers_count=None,
    build_capacity_jql_fn=build_capacity_jql,
    normalize_capacity_team_name_fn=normalize_capacity_team_name,
    log_warning_fn=None,
    log_debug_fn=None,
):
    """Fetch team sizes from Jira capacity issues."""
    if not capacity_project or not sprint_name:
        return {}, {}

    log_warning_fn = log_warning_fn or _noop
    log_debug_fn = log_debug_fn or _noop
    fetch_watchers_count = fetch_watchers_count or (lambda _issue_key: None)
    issues = []

    for chunk in _team_chunks(team_names):
        jql = _build_capacity_jql(build_capacity_jql_fn, sprint_name, chunk, capacity_project)
        payload = {
            'jql': jql,
            'maxResults': _CAPACITY_SEARCH_PAGE_SIZE,
            'fields': ['summary', 'watches', 'reporter']
        }
        try:
            issues.extend(_search_capacity_issue_pages(search_request, payload, max_pages_per_chunk))
        except _CapacitySearchError as error:
            detail = f'status={error.status_code}' if error.status_code is not None else 'pagination'
            log_warning_fn(f'Capacity size fetch failed: {detail}')
            continue

    sizes = {}
    details = {}
    pattern = re.compile(rf'^Team info\s+{re.escape(str(sprint_name))}\s*-\s*(.+)$', re.IGNORECASE)
    for issue in issues:
        fields = issue.get('fields') or {}
        summary = str(fields.get('summary') or '').strip()
        match = pattern.match(summary)
        if not match:
            continue
        short_name = normalize_capacity_team_name_fn(match.group(1))
        if not short_name:
            continue
        watch_count = None
        watches = fields.get('watches') or {}
        if isinstance(watches, dict):
            watch_count = watches.get('watchCount')
        if watch_count is None:
            watch_count = fetch_watchers_count(issue.get('key'))
        if watch_count is None:
            continue
        try:
            count = int(watch_count)
            sizes[short_name] = count
            reporter_name = (fields.get('reporter') or {}).get('displayName')
            details[short_name] = {
                'watchers': count,
                'issue_key': issue.get('key'),
                'reporter': reporter_name
            }
            if issue.get('key'):
                log_debug_fn(f'Capacity size resolved team={short_name} watchers={count} reporter={reporter_name}')
        except (TypeError, ValueError):
            continue

    return sizes, details
