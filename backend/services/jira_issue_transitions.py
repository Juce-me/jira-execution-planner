"""Pure, dependency-injected Jira issue status transition helpers.

This module resolves and performs Jira issue status transitions using only
injected Jira request/search callables plus a request auth context. It never
imports Flask, ``requests``, ``build_jira_headers``, ``backend.epm``,
Home/Townsquare helpers, or service integrations; the route layer injects the
real OAuth-bound wrappers and threads ``context`` through so worker threads with
no Flask request context still authenticate as the signed-in user.
"""

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError


MAX_STATUS_TRANSITION_ISSUES = 50

# Bounded per-issue Jira fan-out. A batch of up to MAX_STATUS_TRANSITION_ISSUES
# issues drives up to one GET plus one POST per issue; cap concurrency and hold
# an overall per-request time budget so a large batch cannot run unbounded.
STATUS_TRANSITION_WORKERS = 8
STATUS_TRANSITION_TIMEOUT_BUDGET_SECONDS = 90.0

# Issue snapshot fields fetched in a single batch search.
SNAPSHOT_FIELDS = ["summary", "status", "issuetype"]

# Jira issue keys: a project key (letter then letters/digits) plus a numeric
# suffix, e.g. PROD-1, TECH-22, OPS2-3.
_ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]+-[0-9]+$")

# Sanitized per-issue error codes for Jira HTTP failures. Never surface raw
# Jira response bodies to callers.
_JIRA_STATUS_ERROR_CODES = {
    400: "invalid_transition",
    401: "jira_auth_error",
    403: "transition_forbidden",
    404: "issue_not_found",
    409: "transition_conflict",
    422: "invalid_transition",
}


class IssueTransitionInputError(ValueError):
    """Raised for caller input problems before any Jira call is made."""

    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


class IssueTransitionServiceError(Exception):
    """Raised on catastrophic upstream failure that prevents per-issue results."""

    def __init__(self, code, status_code=None, message=None):
        self.code = code
        self.status_code = status_code
        super().__init__(message or code)


def normalize_issue_keys(issue_keys):
    """Trim, uppercase, validate, and de-duplicate issue keys in request order.

    Raises ``IssueTransitionInputError`` with ``issue_keys_required`` for an
    empty or non-list input, ``invalid_issue_key`` for a blank/malformed key,
    and ``too_many_issues`` when the unique count exceeds the cap.
    """
    if not isinstance(issue_keys, list):
        raise IssueTransitionInputError("issue_keys_required")

    normalized = []
    seen = set()
    for raw in issue_keys:
        if not isinstance(raw, str):
            raise IssueTransitionInputError("invalid_issue_key")
        key = raw.strip().upper()
        if not key or not _ISSUE_KEY_RE.match(key):
            raise IssueTransitionInputError("invalid_issue_key")
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)

    if not normalized:
        raise IssueTransitionInputError("issue_keys_required")
    if len(normalized) > MAX_STATUS_TRANSITION_ISSUES:
        raise IssueTransitionInputError("too_many_issues")
    return normalized


def normalize_status_name(value):
    """Case-insensitive, whitespace-collapsed status name for comparisons."""
    return " ".join(str(value or "").strip().lower().split())


def select_transition_for_target(transitions, target_status):
    """Return the transition whose ``to.name`` matches ``target_status``.

    Matches on the destination status name, never the transition display name.
    """
    target = normalize_status_name(target_status)
    if not target:
        return None
    for transition in transitions or []:
        destination = (transition or {}).get("to") or {}
        if normalize_status_name(destination.get("name")) == target:
            return transition
    return None


def resolve_issue_transition(current_status, transitions, target_status):
    """Decide the outcome for one issue without performing any IO.

    Returns ``{"outcome": "already_in_status"}`` when the issue already sits in
    the target, ``{"outcome": "transition", "transition": {...}}`` when a
    matching transition exists, else ``{"outcome": "transition_not_available"}``.
    """
    target = normalize_status_name(target_status)
    if target and normalize_status_name(current_status) == target:
        return {"outcome": "already_in_status"}
    transition = select_transition_for_target(transitions, target_status)
    if transition:
        return {"outcome": "transition", "transition": transition}
    return {"outcome": "transition_not_available"}


def summarize_transition_options(issue_entries):
    """Aggregate per-issue transition entries into target-status availability.

    Each returned row is ``{"name", "availableCount", "blockedCount"}``. Rows
    are the union of reachable ``toStatus`` values in first-seen order. Issues
    already in a status are counted as neither available nor blocked for it, and
    errored issues are excluded entirely.
    """
    entries = [entry for entry in (issue_entries or []) if not entry.get("error")]

    order = []
    display = {}
    for entry in entries:
        for transition in entry.get("transitions") or []:
            name = (transition or {}).get("toStatus")
            normalized = normalize_status_name(name)
            if normalized and normalized not in display:
                display[normalized] = name
                order.append(normalized)

    summary = []
    for normalized in order:
        available_count = 0
        blocked_count = 0
        for entry in entries:
            current = normalize_status_name(entry.get("currentStatus"))
            reachable = {
                normalize_status_name((transition or {}).get("toStatus"))
                for transition in entry.get("transitions") or []
            }
            if normalized in reachable:
                available_count += 1
            elif current == normalized:
                continue
            else:
                blocked_count += 1
        summary.append({
            "name": display[normalized],
            "availableCount": available_count,
            "blockedCount": blocked_count,
        })
    return summary


def sanitize_jira_error(status_code):
    """Map a Jira HTTP status to a short, body-free error code."""
    return _JIRA_STATUS_ERROR_CODES.get(status_code, "transition_failed")


def shape_transition_success(key, from_status, to_status):
    """Per-issue success payload without any raw Jira response body."""
    return {
        "key": key,
        "result": "success",
        "fromStatus": from_status,
        "toStatus": to_status,
    }


def shape_transition_failure(key, error, current_status=None, issue_type=None):
    """Per-issue failure payload without any raw Jira response body."""
    result = {"key": key, "result": "failure", "error": error}
    if current_status is not None:
        result["currentStatus"] = current_status
    if issue_type is not None:
        result["issueType"] = issue_type
    return result


def build_issue_snapshot_search_payload(issue_keys):
    """Single-page ``/rest/api/3/search/jql`` payload for issue snapshots.

    ``maxResults`` is set to the cap because that wrapper returns a single page
    without ``nextPageToken`` pagination.
    """
    quoted = ",".join(f'"{key}"' for key in issue_keys)
    return {
        "jql": f"key in ({quoted})",
        "fields": list(SNAPSHOT_FIELDS),
        "maxResults": MAX_STATUS_TRANSITION_ISSUES,
    }


def load_issue_snapshots(issue_keys, *, search_request, context=None):
    """Fetch ``summary``/``status``/``issuetype`` for each key in one batch.

    Returns a ``{key: {key, summary, currentStatus, issueType}}`` map. Raises
    ``IssueTransitionServiceError`` when the batch search itself fails.
    """
    keys = normalize_issue_keys(issue_keys)
    payload = build_issue_snapshot_search_payload(keys)
    response = search_request(payload, context=context)
    if getattr(response, "status_code", None) != 200:
        raise IssueTransitionServiceError("issue_snapshot_fetch_failed", getattr(response, "status_code", None))

    data = response.json() or {}
    snapshots = {}
    for issue in data.get("issues") or []:
        key = issue.get("key")
        if not key:
            continue
        fields = issue.get("fields") or {}
        status = fields.get("status") or {}
        issue_type = fields.get("issuetype") or {}
        snapshots[key] = {
            "key": key,
            "summary": fields.get("summary") or "",
            "currentStatus": status.get("name") or "",
            "issueType": issue_type.get("name") or "",
        }
    return snapshots


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
    workers = max(1, min(STATUS_TRANSITION_WORKERS, len(keys)))
    future_map = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for key in keys:
            future_map[pool.submit(worker, key, context)] = key
        try:
            for future in as_completed(future_map, timeout=STATUS_TRANSITION_TIMEOUT_BUDGET_SECONDS):
                key, value = future.result()
                results[key] = value
        except FuturesTimeoutError:
            pass
        finally:
            for future in future_map:
                if not future.done():
                    future.cancel()
    return results


def _make_options_worker(jira_request):
    def worker(key, context):
        try:
            response = jira_request("GET", f"/rest/api/3/issue/{key}/transitions", context=context)
        except Exception:
            return key, {"error": "transitions_unavailable"}
        if getattr(response, "status_code", None) != 200:
            return key, {"error": "transitions_unavailable"}
        try:
            data = response.json() or {}
        except Exception:
            return key, {"error": "transitions_unavailable"}
        return key, {"transitions": data.get("transitions") or []}

    return worker


def load_transition_options(issue_keys, *, jira_request, search_request, context=None):
    """Resolve available status targets for each requested issue key.

    Fetches issue snapshots in one batch search, then fetches transitions per
    issue through a bounded pool. Per-issue transition failures become
    ``error="transitions_unavailable"`` with no raw Jira body.
    """
    keys = normalize_issue_keys(issue_keys)
    snapshots = load_issue_snapshots(keys, search_request=search_request, context=context)
    fetched = _run_bounded_pool(keys, _make_options_worker(jira_request), context)

    issues = []
    for key in keys:
        snapshot = snapshots.get(key) or {}
        entry = {
            "key": key,
            "issueType": snapshot.get("issueType", ""),
            "currentStatus": snapshot.get("currentStatus", ""),
        }
        transition_data = fetched.get(key)
        if not transition_data or transition_data.get("error"):
            entry["error"] = "transitions_unavailable"
            issues.append(entry)
            continue
        entry["transitions"] = [
            {
                "name": (transition or {}).get("name") or "",
                "toStatus": ((transition or {}).get("to") or {}).get("name") or "",
            }
            for transition in transition_data.get("transitions") or []
        ]
        issues.append(entry)

    return {"issues": issues, "targetStatuses": summarize_transition_options(issues)}


def _make_transition_worker(jira_request, snapshots, target_status):
    normalized_target = normalize_status_name(target_status)

    def worker(key, context):
        snapshot = snapshots.get(key) or {}
        current_status = snapshot.get("currentStatus") or ""
        issue_type = snapshot.get("issueType") or ""

        if normalized_target and normalize_status_name(current_status) == normalized_target:
            return key, {"key": key, "result": "already_in_status", "currentStatus": current_status}

        try:
            response = jira_request("GET", f"/rest/api/3/issue/{key}/transitions", context=context)
        except Exception:
            return key, shape_transition_failure(key, "transitions_unavailable", current_status, issue_type)
        if getattr(response, "status_code", None) != 200:
            return key, shape_transition_failure(key, sanitize_jira_error(getattr(response, "status_code", None)), current_status, issue_type)
        try:
            transitions = (response.json() or {}).get("transitions") or []
        except Exception:
            return key, shape_transition_failure(key, "transitions_unavailable", current_status, issue_type)

        outcome = resolve_issue_transition(current_status, transitions, target_status)
        if outcome["outcome"] == "already_in_status":
            return key, {"key": key, "result": "already_in_status", "currentStatus": current_status}
        if outcome["outcome"] != "transition":
            return key, shape_transition_failure(key, "transition_not_available", current_status, issue_type)

        transition = outcome["transition"]
        transition_id = transition.get("id")
        if not transition_id:
            return key, shape_transition_failure(key, "transition_not_available", current_status, issue_type)

        try:
            post_response = jira_request(
                "POST",
                f"/rest/api/3/issue/{key}/transitions",
                json_body={"transition": {"id": transition_id}},
                context=context,
            )
        except Exception:
            return key, shape_transition_failure(key, "transition_failed", current_status, issue_type)
        if getattr(post_response, "status_code", None) in (200, 204):
            to_status = (transition.get("to") or {}).get("name") or target_status
            return key, shape_transition_success(key, current_status, to_status)
        return key, shape_transition_failure(key, sanitize_jira_error(getattr(post_response, "status_code", None)), current_status, issue_type)

    return worker


def transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
    """Transition every requested issue key to ``target_status``.

    Validates and caps input before any Jira call, fetches snapshots, then runs
    the per-issue GET/POST sequence through a bounded pool. One issue failing
    never aborts the others; results are collected per issue and issues already
    in the target status are reported as ``already_in_status`` successes without
    posting a transition.
    """
    keys = normalize_issue_keys(issue_keys)
    target = str(target_status or "").strip()
    if not target:
        raise IssueTransitionInputError("target_status_required")

    snapshots = load_issue_snapshots(keys, search_request=search_request, context=context)
    worker = _make_transition_worker(jira_request, snapshots, target)
    computed = _run_bounded_pool(keys, worker, context)

    results = []
    for key in keys:
        result = computed.get(key)
        if result is None:
            snapshot = snapshots.get(key) or {}
            result = shape_transition_failure(key, "transition_timeout", snapshot.get("currentStatus"), snapshot.get("issueType"))
        results.append(result)

    succeeded = sum(1 for result in results if result.get("result") in ("success", "already_in_status"))
    failed = sum(1 for result in results if result.get("result") == "failure")
    return {
        "requested": len(keys),
        "succeeded": succeeded,
        "failed": failed,
        "targetStatus": target,
        "results": results,
    }
