"""Pure, dependency-injected Jira Epic Project Track helpers.

Mirrors ``backend.services.jira_issue_priorities``: this module resolves and
performs the single-issue Project Track dropdown change using only injected
Jira request callables plus a request auth context. It never imports Flask,
the HTTP client library, the header-building helper, the EPM package,
Home/Townsquare helpers, or service integrations; the route layer injects
the OAuth-bound wrapper and the configured field-id getter and threads
``context`` through. The browser may submit only one issue key and one
canonical target; field ids and option ids stay server-owned, resolved from
that exact issue's edit metadata at submission time.
"""

from backend.services.jira_issue_transitions import (
    IssueTransitionInputError,
    normalize_issue_keys,
)

CANONICAL_TRACKS = ("Flexible", "Committed")


class ProjectTrackInputError(ValueError):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


class ProjectTrackServiceError(Exception):
    def __init__(self, code, status_code=None, message=None):
        self.code = code
        self.status_code = status_code
        super().__init__(message or code)


def _normalize_single_issue_key(value):
    try:
        return normalize_issue_keys([value])[0]
    except IssueTransitionInputError as error:
        raise ProjectTrackInputError("invalid_issue_key") from error


def normalize_project_track_target(value):
    if not isinstance(value, str):
        raise ProjectTrackInputError("invalid_project_track")
    lowered = value.strip().lower()
    for canonical in CANONICAL_TRACKS:
        if lowered == canonical.lower():
            return canonical
    raise ProjectTrackInputError("invalid_project_track")


def _resolve_field_id(get_project_track_field_id):
    field_id = (get_project_track_field_id() or "").strip()
    if not field_id:
        raise ProjectTrackServiceError("project_track_not_editable", 409)
    return field_id


def _load_editmeta_allowed_values(key, field_id, *, jira_request, context):
    response = jira_request("GET", f"/rest/api/3/issue/{key}/editmeta", context=context)
    if response.status_code == 404:
        raise ProjectTrackServiceError("issue_not_found", 404)
    if response.status_code != 200:
        raise ProjectTrackServiceError("project_track_options_fetch_failed", response.status_code)
    field_meta = ((response.json() or {}).get("fields") or {}).get(field_id)
    if not isinstance(field_meta, dict):
        raise ProjectTrackServiceError("project_track_not_editable", 409)
    allowed = field_meta.get("allowedValues") or []
    values = {}
    for option in allowed:
        if isinstance(option, dict):
            value = str(option.get("value") or "").strip()
            option_id = str(option.get("id") or "").strip()
            if value and option_id:
                values[value.lower()] = {"value": value, "id": option_id}
    return values


def load_project_track_options_for_issue(issue_key, *, jira_request,
                                         get_project_track_field_id, context=None):
    key = _normalize_single_issue_key(issue_key)
    field_id = _resolve_field_id(get_project_track_field_id)
    allowed = _load_editmeta_allowed_values(
        key, field_id, jira_request=jira_request, context=context)
    options = [
        {"value": canonical}
        for canonical in CANONICAL_TRACKS
        if canonical.lower() in allowed
    ]
    if not options:
        raise ProjectTrackServiceError("project_track_not_editable", 409)
    return {"options": options, "source": "jira"}


def _load_issue_snapshot(key, field_id, *, jira_request, context):
    response = jira_request(
        "GET", f"/rest/api/3/issue/{key}",
        params={"fields": f"issuetype,{field_id}"}, context=context)
    if response.status_code == 404:
        raise ProjectTrackServiceError("issue_not_found", 404)
    if response.status_code != 200:
        raise ProjectTrackServiceError("project_track_update_failed", response.status_code)
    fields = (response.json() or {}).get("fields") or {}
    issue_type = str(((fields.get("issuetype") or {}).get("name")) or "").strip()
    track_field = fields.get(field_id)
    current = ""
    if isinstance(track_field, dict):
        current = str(track_field.get("value") or "").strip()
    return issue_type, current


def update_issue_project_track(issue_key, target_track, *, jira_request,
                               get_project_track_field_id, context=None):
    key = _normalize_single_issue_key(issue_key)
    target = normalize_project_track_target(target_track)
    field_id = _resolve_field_id(get_project_track_field_id)
    issue_type, current = _load_issue_snapshot(
        key, field_id, jira_request=jira_request, context=context)
    if issue_type.lower() != "epic":
        raise ProjectTrackServiceError("issue_not_epic", 409)
    if current.lower() == target.lower():
        return {"issueKey": key, "result": "already_in_track", "fromTrack": target}
    allowed = _load_editmeta_allowed_values(
        key, field_id, jira_request=jira_request, context=context)
    option = allowed.get(target.lower())
    if option is None:
        raise ProjectTrackServiceError("project_track_option_unavailable", 409)
    response = jira_request(
        "PUT", f"/rest/api/3/issue/{key}",
        json_body={"fields": {field_id: {"id": option["id"]}}}, context=context)
    if response.status_code == 404:
        raise ProjectTrackServiceError("issue_not_found", 404)
    if response.status_code not in (200, 204):
        raise ProjectTrackServiceError("project_track_update_failed", response.status_code)
    return {"issueKey": key, "result": "success", "fromTrack": current, "toTrack": target}
