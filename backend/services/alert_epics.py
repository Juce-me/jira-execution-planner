"""Helpers for ENG alert epic payloads."""


def quote_jql_value(value):
    text = str(value or "").strip()
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def fetch_complete_alert_epic_issues(payload, search_request):
    """Read a complete bounded Epic scope; never return a partial result."""
    issues = []
    seen_keys = set()
    seen_tokens = set()
    next_page_token = None
    for _ in range(101):
        if next_page_token:
            payload['nextPageToken'] = next_page_token
        response = search_request(payload)
        if response.status_code != 200:
            raise RuntimeError(f'Alert Epic search failed: status={response.status_code}')
        try:
            data = response.json()
        except (TypeError, ValueError) as error:
            raise RuntimeError('Alert Epic search returned malformed JSON') from error
        if not isinstance(data, dict) or not isinstance(data.get('issues'), list) or len(data['issues']) > 100 or not isinstance(data.get('isLast'), bool):
            raise RuntimeError('Alert Epic search returned a malformed page')
        for issue in data['issues']:
            if not isinstance(issue, dict) or not isinstance(issue.get('key'), str) or not issue['key'] or not isinstance(issue.get('fields'), dict):
                raise RuntimeError('Alert Epic search returned a malformed issue')
            if issue['key'] not in seen_keys:
                seen_keys.add(issue['key'])
                issues.append(issue)
                if len(seen_keys) > 2000:
                    raise RuntimeError('Alert Epic search exceeded the Epic limit')
        if data['isLast']:
            return issues
        next_page_token = data.get('nextPageToken')
        if not isinstance(next_page_token, str) or not next_page_token or next_page_token in seen_tokens:
            raise RuntimeError('Alert Epic search returned an invalid continuation token')
        seen_tokens.add(next_page_token)
    raise RuntimeError('Alert Epic search exceeded the page limit')


def build_alert_epic_payloads(issues, team_field_id, sprint_field_id=None, *, build_team_value, extract_team_name):
    epics = []
    for issue in issues or []:
        fields = issue.get("fields", {}) or {}
        raw_team = fields.get(team_field_id) if team_field_id and fields.get(team_field_id) is not None else None
        team_value = build_team_value(raw_team) if raw_team is not None else None
        team_name = extract_team_name(raw_team) if raw_team is not None else None
        assignee = fields.get("assignee") or {}
        status = fields.get("status") or {}
        epics.append({
            "key": issue.get("key"),
            "summary": fields.get("summary"),
            "status": {"name": status.get("name")} if status else None,
            "assignee": {
                "accountId": assignee.get("accountId"), "displayName": assignee.get("displayName")
            } if assignee else None,
            "labels": fields.get("labels") or [],
            "team": team_value,
            "teamName": team_name,
            "teamId": team_value.get("id") if isinstance(team_value, dict) else None,
            "fields": {
                "customfield_10101": fields.get(sprint_field_id) if sprint_field_id else None
            },
        })
    return epics


def fetch_epics_for_alert_scope(
    epic_jql, team_field_id, epic_name_field, sprint_field_id, *,
    search_request, parent_name_field_default, build_team_value,
    extract_team_name, complete_alert_scope=False, log_warning_fn=None,
):
    fields_list = ['summary', 'status', 'assignee', 'labels', epic_name_field or parent_name_field_default]
    if team_field_id and team_field_id not in fields_list:
        fields_list.append(team_field_id)
    if sprint_field_id and sprint_field_id not in fields_list:
        fields_list.append(sprint_field_id)
    payload = {
        'jql': epic_jql,
        'maxResults': 100 if complete_alert_scope else 250,
        'fields': fields_list,
    }
    if complete_alert_scope:
        issues = fetch_complete_alert_epic_issues(payload, search_request)
    else:
        response = search_request(payload)
        if response.status_code != 200:
            if log_warning_fn:
                log_warning_fn(f'Epic empty-state fetch failed: status={response.status_code}')
            return []
        issues = (response.json() or {}).get('issues', []) or []
    return build_alert_epic_payloads(
        issues, team_field_id, sprint_field_id,
        build_team_value=build_team_value,
        extract_team_name=extract_team_name,
    )


def fetch_epics_by_keys_for_alert(
    epic_keys,
    jql,
    team_field_id,
    epic_name_field,
    sprint_field_id=None,
    *,
    search_request,
    derive_epic_jql,
    remove_team_filter_from_jql,
    add_clause_to_jql,
    parent_name_field_default,
    build_team_value,
    extract_team_name,
    log_warning_fn=None,
):
    keys = sorted({str(key or "").strip() for key in (epic_keys or []) if str(key or "").strip()})
    if not keys:
        return []

    epic_jql = derive_epic_jql(remove_team_filter_from_jql(jql), [])
    quoted_keys = ", ".join(quote_jql_value(key) for key in keys)
    epic_jql = add_clause_to_jql(epic_jql, f"issueKey in ({quoted_keys})")
    fields_list = ["summary", "status", "assignee", "labels", epic_name_field or parent_name_field_default]
    if team_field_id and team_field_id not in fields_list:
        fields_list.append(team_field_id)
    if sprint_field_id and sprint_field_id not in fields_list:
        fields_list.append(sprint_field_id)

    response = search_request({"jql": epic_jql, "maxResults": min(len(keys), 250), "fields": fields_list})
    if response.status_code != 200:
        if log_warning_fn:
            log_warning_fn(f"Ready-to-close epic key fetch failed: status={response.status_code}")
        return []

    return build_alert_epic_payloads(
        (response.json() or {}).get("issues") or [],
        team_field_id,
        sprint_field_id,
        build_team_value=build_team_value,
        extract_team_name=extract_team_name,
    )
