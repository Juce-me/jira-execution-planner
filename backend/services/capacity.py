"""Capacity service helpers for Jira-backed team capacity data."""

import re


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


def fetch_capacity_for_sprint(
    sprint_name,
    headers,
    debug=False,
    team_names=None,
    *,
    capacity_project,
    resolve_capacity_field_id,
    search_request,
    build_capacity_jql_fn=build_capacity_jql,
    normalize_capacity_team_name_fn=normalize_capacity_team_name,
):
    if not capacity_project:
        return {
            'enabled': False,
            'capacities': {}
        }, None

    capacity_field_id = resolve_capacity_field_id(headers)
    if not capacity_field_id:
        return {
            'enabled': False,
            'capacities': {},
            'message': 'Missing Team capacity field ID'
        }, None

    capacities = {}
    debug_items = []
    issues = []
    jqls = []

    for chunk in _team_chunks(team_names):
        jql = _build_capacity_jql(build_capacity_jql_fn, sprint_name, chunk, capacity_project)
        jqls.append(jql)
        payload = {
            'jql': jql,
            'maxResults': 200,
            'fields': ['summary', capacity_field_id]
        }
        response = search_request(payload)
        if response.status_code != 200:
            return None, response.text
        data = response.json() or {}
        issues.extend(data.get('issues') or [])

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
        raw_capacity = fields.get(capacity_field_id)
        if debug:
            debug_items.append({
                'summary': summary,
                'rawCapacity': raw_capacity
            })
        try:
            capacity_value = float(raw_capacity)
        except (TypeError, ValueError):
            continue
        capacities[short_name] = capacity_value

    response_payload = {
        'enabled': True,
        'sprint': sprint_name,
        'capacities': capacities
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
            'maxResults': 200,
            'fields': ['summary', 'watches', 'reporter']
        }
        response = search_request(payload)
        if response.status_code != 200:
            log_warning_fn(f'Capacity size fetch failed: status={response.status_code}')
            continue
        data = response.json() or {}
        issues.extend(data.get('issues') or [])

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
