"""Pure, dependency-injected Jira issue priority helpers.

Mirrors ``backend.services.jira_issue_transitions``: this module resolves and
performs Jira issue priority changes using only injected Jira request/search
callables plus a request auth context. It never imports Flask, ``requests``,
``build_jira_headers``, ``backend.epm``, Home/Townsquare helpers, or service
integrations; the route layer injects the real OAuth-bound wrappers and
threads ``context`` through so worker threads with no Flask request context
still authenticate as the signed-in user. Issue-key validation is reused from
``jira_issue_transitions``, which never imports this module, so there is no
circular import.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError

from backend.services.jira_issue_transitions import IssueTransitionInputError, normalize_issue_keys


MAX_PRIORITY_UPDATE_ISSUES = 50

# Bounded per-issue Jira fan-out. A batch of up to MAX_PRIORITY_UPDATE_ISSUES
# issues drives up to one PUT per issue; cap concurrency and hold an overall
# per-request time budget so a large batch cannot run unbounded.
PRIORITY_UPDATE_WORKERS = 8
PRIORITY_UPDATE_TIMEOUT_BUDGET_SECONDS = 90.0

# Issue snapshot fields fetched in a single batch search.
PRIORITY_SNAPSHOT_FIELDS = ["priority"]

# Sanitized per-issue error codes for Jira HTTP failures. Never surface raw
# Jira response bodies to callers.
_JIRA_PRIORITY_ERROR_CODES = {
    400: "priority_conflict",
    403: "priority_forbidden",
    404: "issue_not_found",
    409: "priority_conflict",
}


class IssuePriorityInputError(ValueError):
    """Raised for caller input problems before any Jira call is made."""

    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


class IssuePriorityServiceError(Exception):
    """Raised on catastrophic upstream failure that prevents per-issue results."""

    def __init__(self, code, status_code=None, message=None):
        self.code = code
        self.status_code = status_code
        super().__init__(message or code)


def _normalize_issue_keys(issue_keys):
    """Validate issue keys via the shared transitions helper.

    Reuses that helper's trim/uppercase/validate/dedup/cap logic, but raises
    this module's own ``IssuePriorityInputError`` (same ``code``) so callers
    only ever need to catch one input-error type from this module.
    """
    try:
        return normalize_issue_keys(issue_keys)
    except IssueTransitionInputError as error:
        raise IssuePriorityInputError(error.code) from error


def normalize_priority_id(value):
    """Validate a target Jira priority id is a non-empty digit string."""
    priority_id = str(value or "").strip()
    if not priority_id or not priority_id.isdigit():
        raise IssuePriorityInputError("invalid_priority_id")
    return priority_id


def shape_priority_options(raw_priorities):
    """Shape raw ``/rest/api/3/priority`` catalog entries for callers.

    Jira returns priorities in urgency order; ``rank`` is derived from that
    order (10, 20, 30, ...) instead of any Jira-supplied value, and the raw
    Jira ``self`` URL is never included.
    """
    options = []
    for index, raw in enumerate(raw_priorities or []):
        entry = raw or {}
        priority_id = str(entry.get("id") or "").strip()
        if not priority_id:
            continue
        options.append({
            "id": priority_id,
            "name": entry.get("name") or "",
            "statusColor": entry.get("statusColor") or "",
            "iconUrl": entry.get("iconUrl") or "",
            "rank": (index + 1) * 10,
        })
    return options


def load_priority_options(*, jira_request, context=None):
    response = jira_request("GET", "/rest/api/3/priority", context=context)
    if getattr(response, "status_code", None) != 200:
        raise IssuePriorityServiceError("priority_options_fetch_failed", getattr(response, "status_code", None))
    priorities = shape_priority_options(response.json() or [])
    return {"priorities": priorities, "source": "jira"}


def build_priority_snapshot_search_payload(issue_keys):
    """Single-page ``/rest/api/3/search/jql`` payload for priority snapshots."""
    quoted = ",".join(f'"{key}"' for key in issue_keys)
    return {
        "jql": f"key in ({quoted})",
        "fields": list(PRIORITY_SNAPSHOT_FIELDS),
        "maxResults": MAX_PRIORITY_UPDATE_ISSUES,
    }


def load_issue_priority_snapshots(issue_keys, *, search_request, context=None):
    """Fetch the current priority id/name for each key in one batch search.

    Returns a ``{key: {key, priorityId, priorityName}}`` map. Raises
    ``IssuePriorityServiceError`` when the batch search itself fails.
    """
    keys = _normalize_issue_keys(issue_keys)
    payload = build_priority_snapshot_search_payload(keys)
    response = search_request(payload, context=context)
    if getattr(response, "status_code", None) != 200:
        raise IssuePriorityServiceError(
            "issue_priority_snapshot_fetch_failed", getattr(response, "status_code", None)
        )

    data = response.json() or {}
    snapshots = {}
    for issue in data.get("issues") or []:
        key = issue.get("key")
        if not key:
            continue
        fields = issue.get("fields") or {}
        priority = fields.get("priority") or {}
        snapshots[key] = {
            "key": key,
            "priorityId": str(priority.get("id") or "").strip(),
            "priorityName": priority.get("name") or "",
        }
    return snapshots


def sanitize_jira_priority_error(status_code):
    """Map a Jira HTTP status to a short, body-free error code."""
    return _JIRA_PRIORITY_ERROR_CODES.get(status_code, "priority_update_failed")


def shape_priority_success(key, from_priority, to_priority):
    """Per-issue success payload without any raw Jira response body."""
    return {
        "key": key,
        "result": "success",
        "fromPriority": from_priority,
        "toPriority": to_priority,
    }


def shape_priority_failure(key, error):
    """Per-issue failure payload without any raw Jira response body."""
    return {"key": key, "result": "failure", "error": error}


def _resolve_target_priority_name(snapshots, target_priority_id, *, jira_request, context):
    """Resolve the target priority's display name without trusting the caller.

    Prefers an already-fetched snapshot that already sits at the target
    priority (zero extra Jira calls); only falls back to fetching the
    priority catalog when no snapshot has that answer. A catalog fetch
    failure here is cosmetic-only and must never block the priority write.
    """
    for snapshot in snapshots.values():
        if snapshot.get("priorityId") == target_priority_id and snapshot.get("priorityName"):
            return snapshot["priorityName"]
    try:
        catalog = load_priority_options(jira_request=jira_request, context=context)
    except IssuePriorityServiceError:
        return ""
    for option in catalog.get("priorities") or []:
        if option.get("id") == target_priority_id:
            return option.get("name") or ""
    return ""


def _run_bounded_pool(keys, worker, context):
    """Run ``worker(key, context)`` across a capped ThreadPoolExecutor.

    ``context`` is passed explicitly into every worker so contextless threads
    still authenticate as the signed-in user. Returns a ``{key: value}`` map;
    keys whose future did not finish within the time budget are simply absent so
    callers can shape their own timeout result.
    """
    results = {}
    if not keys:
        return results
    workers = max(1, min(PRIORITY_UPDATE_WORKERS, len(keys)))
    future_map = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for key in keys:
            future_map[pool.submit(worker, key, context)] = key
        try:
            for future in as_completed(future_map, timeout=PRIORITY_UPDATE_TIMEOUT_BUDGET_SECONDS):
                key, value = future.result()
                results[key] = value
        except FuturesTimeoutError:
            pass
        finally:
            for future in future_map:
                if not future.done():
                    future.cancel()
    return results


def _make_priority_worker(jira_request, snapshots, target_priority_id, target_priority_name):
    def worker(key, context):
        snapshot = snapshots.get(key) or {}
        from_priority_name = snapshot.get("priorityName") or ""

        if snapshot.get("priorityId") == target_priority_id:
            return key, {"key": key, "result": "already_in_priority", "fromPriority": from_priority_name}

        try:
            response = jira_request(
                "PUT",
                f"/rest/api/3/issue/{key}",
                json_body={"fields": {"priority": {"id": target_priority_id}}},
                context=context,
            )
        except Exception:
            return key, shape_priority_failure(key, "priority_update_failed")
        if getattr(response, "status_code", None) in (200, 204):
            return key, shape_priority_success(key, from_priority_name, target_priority_name)
        return key, shape_priority_failure(key, sanitize_jira_priority_error(getattr(response, "status_code", None)))

    return worker


def update_issue_priorities(issue_keys, target_priority_id, *, jira_request, search_request, context=None):
    """Change every requested issue key's priority to ``target_priority_id``.

    Validates and caps input before any Jira call, fetches priority snapshots
    in one batch search, then runs a bounded PUT per issue through a capped
    pool. Issues already at the target priority are reported as
    ``already_in_priority`` successes without a PUT; one issue failing never
    aborts the others.
    """
    keys = _normalize_issue_keys(issue_keys)
    raw_target = str(target_priority_id or "").strip()
    if not raw_target:
        raise IssuePriorityInputError("target_priority_required")
    priority_id = normalize_priority_id(raw_target)

    snapshots = load_issue_priority_snapshots(keys, search_request=search_request, context=context)
    target_priority_name = _resolve_target_priority_name(
        snapshots, priority_id, jira_request=jira_request, context=context
    )

    worker = _make_priority_worker(jira_request, snapshots, priority_id, target_priority_name)
    computed = _run_bounded_pool(keys, worker, context)

    results = []
    for key in keys:
        result = computed.get(key)
        if result is None:
            result = shape_priority_failure(key, "priority_update_timeout")
        results.append(result)

    succeeded = sum(1 for result in results if result.get("result") in ("success", "already_in_priority"))
    failed = sum(1 for result in results if result.get("result") == "failure")
    return {
        "requested": len(keys),
        "succeeded": succeeded,
        "failed": failed,
        "targetPriority": {"id": priority_id, "name": target_priority_name},
        "results": results,
    }
