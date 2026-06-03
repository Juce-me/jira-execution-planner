"""Helpers for ENG story subtask lookups and payload shaping."""


DONE_STATUSES = {"done"}
IN_PROGRESS_STATUSES = {"analysis", "in progress", "release", "waiting for release"}
EXCLUDED_STATUSES = {"killed"}
PAGE_SIZE = 100

SUBTASK_FIELDS = [
    "summary",
    "status",
    "assignee",
    "updated",
    "issuetype",
    "parent",
    "progress",
    "aggregateprogress",
]


class SubtasksFetchError(Exception):
    def __init__(self, status_code):
        super().__init__(f"subtasks_fetch_failed:{status_code}")
        self.status_code = status_code


def normalize_status(value):
    return " ".join(str(value or "").strip().lower().split())


def normalize_sprint_id(value):
    text = str(value or "").strip()
    if not text:
        raise ValueError("missing_sprint")
    if not text.isdigit():
        raise ValueError("invalid_sprint")
    return text


def quote_jql_value(value):
    text = str(value or "").strip()
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_subtasks_jql(parent_key, sprint):
    sprint_text = normalize_sprint_id(sprint)
    return f"parent = {quote_jql_value(parent_key)} AND Sprint = {sprint_text} ORDER BY updated DESC"


def fetch_subtask_issues_by_jql(jql, fields_list, *, search_request, context=None, max_results=500, log_warning_fn=None):
    issues = []
    next_page_token = None
    while len(issues) < max_results:
        remaining = max_results - len(issues)
        payload = {
            "jql": jql,
            "maxResults": min(PAGE_SIZE, remaining),
            "fields": fields_list,
        }
        if next_page_token:
            payload["nextPageToken"] = next_page_token

        response = search_request(payload, context=context)
        if response.status_code != 200:
            if log_warning_fn:
                log_warning_fn(f"Subtasks fetch error: status={response.status_code}")
            raise SubtasksFetchError(response.status_code)

        data = response.json() or {}
        page_issues = data.get("issues") or []
        if not page_issues:
            break
        issues.extend(page_issues)
        next_page_token = data.get("nextPageToken")
        if data.get("isLast", not next_page_token) or not next_page_token:
            break
    return issues


def shape_subtask_issue(issue):
    fields = issue.get("fields") or {}
    assignee = fields.get("assignee") or {}
    status = fields.get("status") or {}
    progress = fields.get("progress") or fields.get("aggregateprogress") or {}
    progress_percent = progress.get("percent") if isinstance(progress, dict) else None
    return {
        "id": issue.get("id"),
        "key": issue.get("key"),
        "summary": fields.get("summary") or "",
        "status": {"name": status.get("name") or ""} if status else None,
        "progressPercent": progress_percent,
        "assignee": {"displayName": assignee.get("displayName")} if assignee else None,
        "updated": fields.get("updated"),
    }


def build_subtask_summary(subtasks):
    summary = {
        "total": 0,
        "done": 0,
        "inProgress": 0,
        "waiting": 0,
        "percentComplete": 0,
        "statusCounts": {},
    }
    for subtask in subtasks or []:
        status_name = ((subtask.get("status") or {}).get("name") or "")
        normalized = normalize_status(status_name)
        if normalized in EXCLUDED_STATUSES:
            continue
        summary["total"] += 1
        if status_name:
            summary["statusCounts"][status_name] = summary["statusCounts"].get(status_name, 0) + 1
        if normalized in DONE_STATUSES:
            summary["done"] += 1
        elif normalized in IN_PROGRESS_STATUSES:
            summary["inProgress"] += 1
        else:
            summary["waiting"] += 1
    if summary["total"]:
        summary["percentComplete"] = round((summary["done"] / summary["total"]) * 100, 1)
    return summary


def shape_subtasks_payload(parent_key, sprint, issues, cached=False):
    subtasks = [shape_subtask_issue(issue) for issue in (issues or [])]
    return {
        "parentKey": parent_key,
        "sprint": str(sprint or ""),
        "cached": bool(cached),
        "summary": build_subtask_summary(subtasks),
        "subtasks": subtasks,
    }


def build_embedded_subtask_summary(raw_subtasks):
    shaped = []
    for item in raw_subtasks or []:
        fields = item.get("fields") or {}
        status = fields.get("status") or {}
        shaped.append({"status": {"name": status.get("name") or ""} if status else None})
    return build_subtask_summary(shaped)
