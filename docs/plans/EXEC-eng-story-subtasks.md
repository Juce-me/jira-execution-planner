# ENG Story Subtasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight ENG story subtask visibility: stories with subtasks show a compact subtask count/progress control, and clicking it loads selected-sprint subtask rows on demand.

**Architecture:** Reuse the existing ENG story fetch for a cheap embedded subtask summary when Jira returns one, but do not add any new startup requests. Add one authenticated read endpoint for exact on-demand subtask details, cache it by auth context, parent story key, and selected Jira sprint ID, and render the expanded rows inside `IssueCard`. Keep new frontend state in a small hook instead of growing `dashboard.jsx`; progress is count-based, so done subtasks are green, in-progress subtasks are animated blue, and story points are not used.

**Tech Stack:** Python 3.10+ Flask route blueprint, Jira Cloud `/rest/api/3/search/jql` with `nextPageToken` pagination, React 19, existing esbuild frontend, existing Playwright UI tests, existing GA4 dataLayer analytics contract.

---

## Assumptions And Decisions

- "Current quarter" maps to the existing selected ENG sprint ID, not a new calendar-date or quarter-label calculation. The UI must pass the same numeric `selectedSprint` value it already sends to `/api/tasks-with-team-name`.
- The initial page load must not add a new request per story, per epic, or per page. Startup request counts in the ENG smoke test must stay unchanged.
- Exact selected-sprint subtask rows load only after the user clicks the subtask control.
- The count/progress line before expansion uses Jira's embedded `subtasks` field when available in the existing story search response. That adds one field to an existing request, not another request. If Jira does not return embedded subtask statuses for a story, the implementation still shows the count when present and waits for the on-demand fetch to show exact progress.
- Expanded details are filtered by the selected sprint with `parent = "<storyKey>" AND Sprint = <selectedSprintId>`. The endpoint accepts numeric Jira sprint IDs only; if implementation testing proves Jira subtasks do not carry the sprint field reliably in this tenant, stop and ask before changing the route to parent-only filtering.
- "Completed" means status normalized to `done`. `in progress` gets the blue animated segment. `killed` is excluded from the denominator. All other non-killed statuses count as waiting.
- The subtask row "progress" is the subtask status pill. Jira `progress` and `aggregateprogress` may be returned but should not drive the story-level progress bar unless a later requirement asks for it.
- Do not make the whole story card clickable. Add a dedicated subtask toggle button so Jira links, planning checkboxes, and dependency controls keep their current behavior.

## Endpoint Contract

| Item | Contract |
| --- | --- |
| Route | `GET /api/issues/subtasks` |
| Auth | `authenticated_read` in `backend/security/policy.py` |
| CSRF / unsafe-method guard | Not required because the route is GET-only. Do not implement this as POST. |
| Required query params | `parentKey`, `sprint` where `sprint` is the numeric Jira sprint ID already stored in `selectedSprint` |
| Optional query params | `refresh=true` bypasses the process cache |
| Success body | `{"parentKey":"PROD-123","sprint":"42","cached":false,"summary":{"total":3,"done":1,"inProgress":1,"waiting":1,"percentComplete":33.3,"statusCounts":{"Done":1,"In Progress":1,"To Do":1}},"subtasks":[{"id":"10001","key":"PROD-124","summary":"Synthetic subtask","status":{"name":"In Progress"},"progressPercent":null,"assignee":{"displayName":"Synthetic Owner"},"updated":"2026-05-01T00:00:00.000+0000"}]}` |
| Empty success | Same shape with `summary.total=0`, `subtasks=[]` |
| Missing/invalid input | `400 {"error":"missing_parent_key"}`, `400 {"error":"missing_sprint"}`, or `400 {"error":"invalid_sprint"}` |
| Expired auth | Existing `401 {"error":"auth_required","loginUrl":"/login?reason=session_expired"}` |
| Jira failure | `502 {"error":"subtasks_fetch_failed","message":"Failed to fetch subtasks from Jira."}` without raw JQL, tokens, or Jira response text |
| Cache headers | `Cache-Control: no-cache, no-store, must-revalidate`, `Server-Timing`, and `X-Cache: HIT|MISS` |
| Pagination | Jira search must use `nextPageToken` / `isLast`; never `startAt` |

## File Map

- Create: `backend/services/eng_subtasks.py` - pure JQL, status, summary, and response shaping helpers for subtask payloads.
- Modify: `backend/routes/eng_routes.py` - add `GET /api/issues/subtasks` route, cache lookup, Jira call, and error handling.
- Modify: `backend/security/policy.py` - add authenticated-read policy for `/api/issues/subtasks`.
- Modify: `jira_server.py` - add `subtasks` to the normal ENG task fields and shape an embedded `fields.subtaskSummary` for story cards.
- Modify: `frontend/src/api/engApi.js` - add `fetchStorySubtasks()` using `trackedFetch('eng_subtasks', ..., { featureName: 'eng' })`.
- Create: `frontend/src/issues/subtaskProgressUtils.js` - pure frontend helpers for count-based progress display and date formatting.
- Create: `frontend/src/issues/useStorySubtasks.js` - hook that owns expanded subtask state, abort controllers, on-demand loading, retry, sprint reset cleanup, and auth recovery behavior.
- Modify: `frontend/src/issues/IssueCard.jsx` - render the compact subtask count/progress control and expanded subtask rows.
- Modify: `frontend/src/eng/useEngSprintData.js` - export the existing ENG auth recovery helpers so subtask loading uses the same expired-auth redirect path.
- Modify: `frontend/src/dashboard.jsx` - wire `useStorySubtasks()` and pass handlers/state into `IssueCard`; do not place loader implementation or endpoint literals in this file.
- Modify: `frontend/src/styles/eng.css` - add scoped `story-subtasks-*` styles based on the EPM green/blue progress convention.
- Modify: `docs/README_ANALYTICS.md` - add a `No-Event Allowlist` section stating no separate expand/collapse `userevent`; `api_result` with `api_surface=eng_subtasks` covers on-demand load adoption and reliability.
- Create: `tests/test_eng_subtasks_api.py` - backend helper, route, pagination, auth, and cache coverage.
- Modify: `tests/test_backend_route_source_guards.py`, `tests/test_endpoint_policy_inventory.py`, and `tests/test_endpoint_security_matrix.py` - route inventory/security coverage.
- Modify: `tests/test_frontend_api_source_guards.js` - API wrapper and endpoint literal coverage.
- Create: `tests/test_story_subtasks.js` - frontend pure helper, hook source guard, auth recovery, and component source coverage.
- Create: `tests/ui/eng_story_subtasks.spec.js` - UI, no-startup-request, on-demand fetch, and visual coverage.
- Modify: `tests/test_codebase_structure_budgets.py` only if the final implementation exceeds the existing entrypoint budgets after extracting new logic into helper/hook modules; any increase must be the exact final measured count with a comment naming this plan.

## Task 1: Backend Subtask Helpers

**Files:**
- Create: `backend/services/eng_subtasks.py`
- Test: `tests/test_eng_subtasks_api.py`

- [ ] **Step 1: Write helper tests first**

Add tests that call pure helpers without Flask:

```python
def test_build_subtasks_jql_filters_parent_and_selected_sprint():
    self.assertEqual(
        build_subtasks_jql('PROD-123', '42'),
        'parent = "PROD-123" AND Sprint = 42 ORDER BY updated DESC',
    )

def test_build_subtasks_jql_rejects_non_numeric_sprint():
    with self.assertRaisesRegex(ValueError, 'invalid_sprint'):
        build_subtasks_jql('PROD-123', '2026Q2')

def test_build_subtask_summary_counts_done_in_progress_and_waiting():
    summary = build_subtask_summary([
        {'status': {'name': 'Done'}},
        {'status': {'name': 'In Progress'}},
        {'status': {'name': 'To Do'}},
        {'status': {'name': 'Killed'}},
    ])
    self.assertEqual(summary['total'], 3)
    self.assertEqual(summary['done'], 1)
    self.assertEqual(summary['inProgress'], 1)
    self.assertEqual(summary['waiting'], 1)
    self.assertEqual(summary['percentComplete'], 33.3)

def test_fetch_subtask_issues_by_jql_raises_on_jira_failure():
    def fake_search(_payload, context=None):
        return FakeResponse(500, {"errorMessages": ["Synthetic Jira failure"]})

    with self.assertRaises(SubtasksFetchError) as raised:
        fetch_subtask_issues_by_jql(
            'parent = "PROD-123" AND Sprint = 42 ORDER BY updated DESC',
            SUBTASK_FIELDS,
            search_request=fake_search,
        )
    self.assertEqual(raised.exception.status_code, 500)
```

Run:

```bash
.venv/bin/python -m unittest tests.test_eng_subtasks_api
```

Expected before implementation: fails because `backend.services.eng_subtasks` does not exist.

- [ ] **Step 2: Implement pure helpers**

Create `backend/services/eng_subtasks.py` with:

```python
DONE_STATUSES = {"done"}
IN_PROGRESS_STATUSES = {"in progress"}
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
    base = f"parent = {quote_jql_value(parent_key)}"
    sprint_text = normalize_sprint_id(sprint)
    base = f"{base} AND Sprint = {sprint_text}"
    return f"{base} ORDER BY updated DESC"

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
    summary = {"total": 0, "done": 0, "inProgress": 0, "waiting": 0, "percentComplete": 0, "statusCounts": {}}
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
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_eng_subtasks_api
```

Expected after helper implementation: helper tests pass; route tests still fail until Task 2.

## Task 2: On-Demand Backend Route

**Files:**
- Modify: `backend/routes/eng_routes.py`
- Modify: `backend/security/policy.py`
- Create: `tests/test_eng_subtasks_api.py`
- Modify: `tests/test_backend_route_source_guards.py`
- Modify: `tests/test_endpoint_policy_inventory.py`
- Modify: `tests/test_endpoint_security_matrix.py`

- [ ] **Step 1: Write failing route tests**

Cover:

- Missing `parentKey` returns `400`.
- Missing `sprint` returns `400`.
- Non-numeric `sprint` returns `400 {"error":"invalid_sprint"}`.
- Success calls Jira once with `parent = "PROD-1" AND Sprint = 42 ORDER BY updated DESC`.
- Pagination follows `nextPageToken`.
- Cache hit with the same auth context, parent key, and sprint does not call Jira again.
- `refresh=true` bypasses cache.
- Jira non-200 returns the documented sanitized `502 {"error":"subtasks_fetch_failed"}` rather than an empty successful payload.
- Expired OAuth returns the existing auth recovery body.

Use synthetic Jira payloads only:

```python
def test_story_subtasks_route_fetches_selected_sprint_subtasks(self):
    calls = []
    def fake_search(payload, context=None):
        calls.append(payload)
        return FakeResponse(200, {
            "issues": [
                {
                    "id": "10002",
                    "key": "PROD-2",
                    "fields": {
                        "summary": "Synthetic subtask",
                        "status": {"name": "In Progress"},
                        "assignee": {"displayName": "Synthetic Owner"},
                        "updated": "2026-05-01T00:00:00.000+0000",
                    },
                }
            ],
            "isLast": True,
        })

    with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
         patch.object(jira_server, "jira_search_request", side_effect=fake_search):
        response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    self.assertEqual(calls[0]["jql"], 'parent = "PROD-1" AND Sprint = 42 ORDER BY updated DESC')
    self.assertIn("summary", response.get_json())
    self.assertEqual(response.get_json()["summary"]["inProgress"], 1)

def test_story_subtasks_route_rejects_non_numeric_sprint(self):
    response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=2026Q2")
    self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
    self.assertEqual(response.get_json()["error"], "invalid_sprint")

def test_story_subtasks_route_returns_sanitized_502_for_jira_failure(self):
    def fake_search(payload, context=None):
        return FakeResponse(500, {"errorMessages": ["Synthetic Jira failure with raw details"]})

    with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
         patch.object(jira_server, "jira_search_request", side_effect=fake_search):
        response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

    self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
    body = response.get_json()
    self.assertEqual(body["error"], "subtasks_fetch_failed")
    self.assertNotIn("Synthetic Jira failure", response.get_data(as_text=True))
```

- [ ] **Step 2: Add endpoint security policy**

Add:

```python
EndpointPolicy("eng-api-story-subtasks", "/api/issues/subtasks", PUBLIC_METHODS, "authenticated_read"),
```

near the existing ENG issue lookup policy in `backend/security/policy.py`.

Update route inventory tests so `/api/issues/subtasks` is recognized as `authenticated_read`.

Add `("GET", "/api/issues/subtasks?parentKey=PROD-1&sprint=42", "authenticated_read")` to the authenticated-read coverage in `tests/test_endpoint_security_matrix.py`. Because `/api/issues/subtasks` is static, do not add a dynamic sample unless `routes_requiring_samples()` starts requiring one.

- [ ] **Step 3: Implement the route**

In `backend/routes/eng_routes.py`, import:

```python
from backend.services.eng_subtasks import (
    SUBTASK_FIELDS,
    SubtasksFetchError,
    build_subtasks_jql,
    fetch_subtask_issues_by_jql,
    normalize_sprint_id,
    shape_subtasks_payload,
)
```

Add a GET route near `lookup_issues()`:

```python
@bp.route('/api/issues/subtasks', methods=['GET'])
def get_story_subtasks():
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
        cache_enabled = jira_home_partitioned_process_cache_enabled(auth_context)
        cache_key = build_jira_home_process_cache_key(auth_context, 'story-subtasks', parent_key.upper(), sprint_id)
        if cache_enabled and not refresh:
            with _cache_lock:
                cached_entry = SUBTASKS_CACHE.get(cache_key)
            if cached_entry and (time.time() - cached_entry.get('timestamp', 0)) < SUBTASKS_CACHE_TTL_SECONDS:
                response = jsonify(shape_subtasks_payload(parent_key, sprint_id, cached_entry.get('issues') or [], cached=True))
                response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                response.headers['Pragma'] = 'no-cache'
                response.headers['Expires'] = '0'
                response.headers['Server-Timing'] = 'cache;dur=1'
                response.headers['X-Cache'] = 'HIT'
                return response

        jql = build_subtasks_jql(parent_key, sprint_id)
        issues = fetch_subtask_issues_by_jql(
            jql,
            SUBTASK_FIELDS,
            search_request=jira_search_request,
            max_results=500,
            context=auth_context,
            log_warning_fn=log_warning,
        )
        payload = shape_subtasks_payload(parent_key, sprint_id, issues, cached=False)
        if cache_enabled:
            with _cache_lock:
                SUBTASKS_CACHE[cache_key] = {'timestamp': time.time(), 'issues': issues}

        response = jsonify(payload)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['Server-Timing'] = f'jira-search;dur={round((time.perf_counter() - started_at) * 1000, 1)}'
        response.headers['X-Cache'] = 'MISS'
        return response
    except AuthError as error:
        if error.code == "auth_required":
            payload, status = oauth_auth_required_payload()
            return jsonify(payload), status
        raise
    except SubtasksFetchError:
        logger.exception('Story subtasks Jira fetch failed')
        return jsonify({'error': 'subtasks_fetch_failed', 'message': 'Failed to fetch subtasks from Jira.'}), 502
    except Exception:
        logger.exception('Story subtasks endpoint error')
        return jsonify({'error': 'subtasks_fetch_failed', 'message': 'Failed to fetch subtasks from Jira.'}), 502
```

Define `SUBTASKS_CACHE = {}` and `SUBTASKS_CACHE_TTL_SECONDS = 300` at module scope in `backend/routes/eng_routes.py`. Route tests must import `backend.routes.eng_routes` and clear `eng_routes.SUBTASKS_CACHE` in `tearDown`.

- [ ] **Step 4: Run backend route tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_eng_subtasks_api tests.test_oauth_eng_routes tests.test_backend_route_source_guards tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix
```

Expected: pass.

## Task 3: Embedded Story Subtask Summary

**Files:**
- Modify: `jira_server.py`
- Modify: `tests/test_eng_subtasks_api.py`

- [ ] **Step 1: Write failing task payload test**

Add a synthetic story with embedded Jira subtasks:

```python
issue = _synthetic_issue()
issue["fields"]["subtasks"] = [
    {"fields": {"status": {"name": "Done"}}},
    {"fields": {"status": {"name": "In Progress"}}},
    {"fields": {"status": {"name": "To Do"}}},
]
```

Assert `/api/tasks-with-team-name` includes:

```python
self.assertEqual(payload["issues"][0]["fields"]["subtaskSummary"], {
    "total": 3,
    "done": 1,
    "inProgress": 1,
    "waiting": 1,
    "percentComplete": 33.3,
    "statusCounts": {"Done": 1, "In Progress": 1, "To Do": 1},
})
```

Also assert the Jira search fields include `"subtasks"` and that no extra Jira call is made for subtask summaries.

- [ ] **Step 2: Add `subtasks` to the normal ENG task fields**

In `fetch_tasks()` non-lightweight `fields_list`, add:

```python
"subtasks",
```

Do not add it to the lightweight ready-to-close path unless a test proves that path needs it.

- [ ] **Step 3: Shape `fields.subtaskSummary`**

Import or reference `build_embedded_subtask_summary` from `backend.services.eng_subtasks`. In the slim issue response, add:

```python
"subtaskSummary": build_embedded_subtask_summary(fields.get("subtasks")),
```

Only include the property when the summary total is greater than zero to keep the response compact:

```python
subtask_summary = build_embedded_subtask_summary(fields.get("subtasks"))
...
if subtask_summary.get("total", 0) > 0:
    slim_issue["fields"]["subtaskSummary"] = subtask_summary
```

- [ ] **Step 4: Run backend focused tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_eng_subtasks_api tests.test_oauth_eng_routes
```

Expected: pass.

## Task 4: Frontend API And Pure Progress Helpers

**Files:**
- Modify: `frontend/src/api/engApi.js`
- Create: `frontend/src/issues/subtaskProgressUtils.js`
- Modify: `tests/test_frontend_api_source_guards.js`
- Create: `tests/test_story_subtasks.js`

- [ ] **Step 1: Write failing API wrapper test**

In `tests/test_frontend_api_source_guards.js`, load `engApi.js` and assert:

```js
await engApi.fetchStorySubtasks('http://backend', {
    parentKey: 'PROD-1',
    sprint: '42',
    refresh: true,
});
const url = new URL(calls[0].url);
assert.equal(url.pathname, '/api/issues/subtasks');
assert.equal(url.searchParams.get('parentKey'), 'PROD-1');
assert.equal(url.searchParams.get('sprint'), '42');
assert.equal(url.searchParams.get('refresh'), 'true');
assertJsonHeader(calls[0].options);
```

- [ ] **Step 2: Write progress helper tests**

In `tests/test_story_subtasks.js`, cover:

- `buildStorySubtaskProgress({total: 4, done: 1, inProgress: 2})` returns done width `25%`, in-progress width `50%`, and label `25%`.
- Empty or missing summary returns a disabled/no-progress model.
- Killed subtasks are already excluded by backend summary, so frontend does not re-add them.
- `formatSubtaskUpdatedDate("2026-05-01T00:00:00.000+0000")` returns `2026-05-01`.

- [ ] **Step 3: Implement `fetchStorySubtasks()`**

In `frontend/src/api/engApi.js`:

```js
export const fetchStorySubtasks = (backendUrl, { parentKey, sprint, refresh = false, signal } = {}) => {
    const params = new URLSearchParams({
        parentKey: String(parentKey || ''),
        sprint: String(sprint || ''),
        t: Date.now().toString()
    });
    if (refresh) {
        params.set('refresh', 'true');
    }
    return trackedFetch('eng_subtasks', `${backendUrl}/api/issues/subtasks?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    }, { featureName: 'eng' });
};
```

- [ ] **Step 4: Implement frontend helper module**

Create `frontend/src/issues/subtaskProgressUtils.js`:

```js
export function formatPercent(value) {
    const bounded = Math.max(0, Math.min(100, Number(value) || 0));
    return `${bounded.toFixed(3).replace(/\.?0+$/, '')}%`;
}

export function buildStorySubtaskProgress(summary = {}) {
    const total = Math.max(0, Number(summary.total) || 0);
    const done = Math.max(0, Number(summary.done) || 0);
    const inProgress = Math.max(0, Number(summary.inProgress) || 0);
    const percentComplete = total > 0 ? (done / total) * 100 : 0;
    return {
        total,
        done,
        inProgress,
        waiting: Math.max(0, total - done - inProgress),
        percentLabel: `${Math.round(percentComplete)}%`,
        doneWidth: formatPercent(total > 0 ? (done / total) * 100 : 0),
        inProgressWidth: formatPercent(total > 0 ? (inProgress / total) * 100 : 0),
        hasProgress: total > 0,
        hasDone: done > 0,
        hasInProgress: inProgress > 0,
    };
}

export function formatSubtaskUpdatedDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA');
}
```

- [ ] **Step 5: Run frontend helper tests**

Run:

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_story_subtasks.js
```

Expected: pass.

## Task 5: IssueCard UI

**Files:**
- Modify: `frontend/src/issues/IssueCard.jsx`
- Modify: `frontend/src/styles/eng.css`
- Modify: `tests/test_story_subtasks.js`

- [ ] **Step 1: Add component source-guard coverage**

Add source-guard assertions in `tests/test_story_subtasks.js` that `IssueCard.jsx` contains:

- `aria-expanded`
- `aria-controls`
- `story-subtasks-toggle`
- `story-subtasks-progress`
- `story-subtasks-panel`
- `story-subtask-row`
- `formatSubtaskUpdatedDate`

- [ ] **Step 2: Add props to `IssueCard`**

Add optional props:

```js
subtaskState = null,
onToggleSubtasks,
onRetrySubtasks,
```

Compute the active summary:

```js
const embeddedSubtaskSummary = task.fields.subtaskSummary || null;
const activeSubtaskSummary = subtaskState?.summary || embeddedSubtaskSummary;
const subtaskProgress = buildStorySubtaskProgress(activeSubtaskSummary);
const showSubtaskControl = subtaskProgress.total > 0 || subtaskState?.expanded || subtaskState?.loading;
const subtaskPanelId = `story-subtasks-${task.key}`;
```

- [ ] **Step 3: Render compact one-line control**

Place this near `.task-inline-meta`, after story points:

```jsx
{showSubtaskControl && (
    <button
        type="button"
        className={`story-subtasks-toggle${subtaskState?.expanded ? ' is-expanded' : ''}`}
        onClick={(event) => {
            event.stopPropagation();
            onToggleSubtasks?.(task);
        }}
        aria-expanded={!!subtaskState?.expanded}
        aria-controls={subtaskPanelId}
        aria-label={`${subtaskState?.expanded ? 'Hide' : 'Show'} subtasks for ${task.key}`}
    >
        <span className="story-subtasks-count">{`${subtaskProgress.total} subtasks`}</span>
        <span className="story-subtasks-progress" aria-hidden="true">
            <span className="story-subtasks-progress-track">
                {subtaskProgress.hasDone && (
                    <span className="story-subtasks-progress-segment story-subtasks-progress-done" style={{ width: subtaskProgress.doneWidth }} />
                )}
                {subtaskProgress.hasInProgress && (
                    <span className="story-subtasks-progress-segment story-subtasks-progress-in-progress" style={{ width: subtaskProgress.inProgressWidth }} />
                )}
            </span>
            <span className="story-subtasks-progress-percent">{subtaskProgress.percentLabel}</span>
        </span>
    </button>
)}
```

Use "1 subtask" when total is one.

- [ ] **Step 4: Render expanded panel**

Below the main metadata/dependency area:

```jsx
{subtaskState?.expanded && (
    <div id={subtaskPanelId} className="story-subtasks-panel" aria-live="polite">
        {subtaskState.loading ? (
            <div className="story-subtasks-message">Loading subtasks...</div>
        ) : subtaskState.error ? (
            <div className="story-subtasks-message story-subtasks-error">
                <span>{subtaskState.error}</span>
                <button type="button" onClick={() => onRetrySubtasks?.(task)}>Retry</button>
            </div>
        ) : (subtaskState.items || []).length === 0 ? (
            <div className="story-subtasks-message">No subtasks in selected sprint.</div>
        ) : (
            <div className="story-subtasks-rows">
                {subtaskState.items.map((subtask) => (
                    <div key={subtask.key || subtask.id} className="story-subtask-row">
                        <a className="story-subtask-name" href={jiraUrl ? `${jiraUrl}/browse/${subtask.key}` : '#'} target="_blank" rel="noopener noreferrer">
                            {subtask.summary || subtask.key}
                        </a>
                        <StatusPill className={getIssueStatusClassName(subtask.status?.name)} label={subtask.status?.name || 'Unknown'} />
                        <span className="story-subtask-assignee">{subtask.assignee?.displayName || 'Unassigned'}</span>
                        {subtask.updated ? (
                            <time className="story-subtask-updated" dateTime={subtask.updated}>
                                {formatSubtaskUpdatedDate(subtask.updated)}
                            </time>
                        ) : (
                            <span className="story-subtask-updated">No update</span>
                        )}
                    </div>
                ))}
            </div>
        )}
    </div>
)}
```

- [ ] **Step 5: Add scoped ENG styles**

In `frontend/src/styles/eng.css`, add compact styles near existing `.task-*` styles:

- `.story-subtasks-toggle` as an inline button that fits beside story key/SP.
- `.story-subtasks-progress-track` with stable width and height.
- `.story-subtasks-progress-done` using `#52c41a`.
- `.story-subtasks-progress-in-progress` using the EPM blue gradient and a scoped keyframe such as `storySubtasksProgressShimmer`.
- `@media (prefers-reduced-motion: reduce)` disabling shimmer.
- `.story-subtasks-panel` as a lightweight full-width panel inside the story card, not a nested card.
- `.story-subtask-row` as a responsive grid with stable columns on desktop and wrapped rows on narrow screens.

- [ ] **Step 6: Run frontend focused tests**

Run:

```bash
node --test tests/test_story_subtasks.js
```

Expected: pass.

## Task 6: Story Subtask Hook And Dashboard Wiring

**Files:**
- Modify: `frontend/src/eng/useEngSprintData.js`
- Create: `frontend/src/issues/useStorySubtasks.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/api/engApi.js` import usage
- Modify: `tests/test_dashboard_alert_source_guards.js`
- Modify: `tests/test_story_subtasks.js`

- [ ] **Step 1: Add source-guard coverage**

Add a guard asserting:

- `frontend/src/eng/useEngSprintData.js` exports `authRecoveryLoginUrl` and `redirectToAuthRecovery`.
- `frontend/src/issues/useStorySubtasks.js` imports `fetchStorySubtasks` from `../api/engApi.js`.
- `frontend/src/issues/useStorySubtasks.js` imports `authRecoveryLoginUrl` and `redirectToAuthRecovery` from `../eng/useEngSprintData.js`.
- `dashboard.jsx` imports `useStorySubtasks` from `./issues/useStorySubtasks.js`.
- `dashboard.jsx` does not contain the literal `/api/issues/subtasks`.
- `IssueCard` receives `subtaskState`, `onToggleSubtasks`, and `onRetrySubtasks`.
- Sprint reset/config scoped refresh calls `clearStorySubtasks`.

- [ ] **Step 2: Export existing auth recovery helpers**

In `frontend/src/eng/useEngSprintData.js`, change the existing helper declarations to named exports without changing their bodies:

```js
export function authRecoveryLoginUrl(err) {
    const loginUrl = String(err.loginUrl || '').trim();
    if (!loginUrl.startsWith('/login')) {
        return '';
    }
    if (err.status !== 401 && err.code !== 'auth_required') {
        return '';
    }
    return loginUrl;
}

export function redirectToAuthRecovery(err) {
    const loginUrl = authRecoveryLoginUrl(err);
    if (!loginUrl) {
        return;
    }
    if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
        window.location.assign(loginUrl);
    }
}
```

- [ ] **Step 3: Create `useStorySubtasks()`**

Create `frontend/src/issues/useStorySubtasks.js`:

```jsx
import * as React from 'react';
import { fetchStorySubtasks } from '../api/engApi.js';
import { authRecoveryLoginUrl, redirectToAuthRecovery } from '../eng/useEngSprintData.js';

const EMPTY_SUMMARY = { total: 0, done: 0, inProgress: 0, waiting: 0, percentComplete: 0, statusCounts: {} };

export function useStorySubtasks({ backendUrl, selectedSprint, onAuthRecoveryRequired } = {}) {
    const [storySubtasksByKey, setStorySubtasksByKey] = React.useState({});
    const storySubtasksControllerRef = React.useRef({});

    const clearStorySubtasks = React.useCallback(() => {
        Object.values(storySubtasksControllerRef.current || {}).forEach(controller => controller?.abort?.());
        storySubtasksControllerRef.current = {};
        setStorySubtasksByKey({});
    }, []);

    React.useEffect(() => clearStorySubtasks, [clearStorySubtasks]);
    React.useEffect(() => {
        clearStorySubtasks();
    }, [selectedSprint, clearStorySubtasks]);

    const loadStorySubtasks = React.useCallback(async (task, { forceRefresh = false } = {}) => {
        const storyKey = task?.key;
        if (!storyKey || !selectedSprint) return;
        storySubtasksControllerRef.current[storyKey]?.abort?.();
        const controller = new AbortController();
        storySubtasksControllerRef.current[storyKey] = controller;
        setStorySubtasksByKey(prev => ({
            ...prev,
            [storyKey]: {
                ...(prev[storyKey] || {}),
                expanded: true,
                loading: true,
                error: '',
                summary: prev[storyKey]?.summary || task.fields.subtaskSummary || null,
                items: prev[storyKey]?.items || [],
            }
        }));
        try {
            const response = await fetchStorySubtasks(backendUrl, {
                parentKey: storyKey,
                sprint: selectedSprint,
                refresh: forceRefresh,
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const error = new Error(errorData.loginUrl ? 'Sign in with Atlassian again to load subtasks.' : 'Failed to load subtasks.');
                error.code = errorData.error;
                error.loginUrl = errorData.loginUrl;
                error.status = response.status;
                throw error;
            }
            const data = await response.json();
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: {
                    expanded: true,
                    loading: false,
                    error: '',
                    summary: data.summary || EMPTY_SUMMARY,
                    items: data.subtasks || [],
                }
            }));
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (authRecoveryLoginUrl(err)) {
                onAuthRecoveryRequired?.();
                redirectToAuthRecovery(err);
            }
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: {
                    ...(prev[storyKey] || {}),
                    expanded: true,
                    loading: false,
                    error: err.message || 'Failed to load subtasks.',
                }
            }));
        } finally {
            if (storySubtasksControllerRef.current[storyKey] === controller) {
                delete storySubtasksControllerRef.current[storyKey];
            }
        }
    }, [backendUrl, selectedSprint, onAuthRecoveryRequired]);

    const toggleStorySubtasks = React.useCallback((task) => {
        const storyKey = task?.key;
        if (!storyKey) return;
        const current = storySubtasksByKey[storyKey];
        if (current?.expanded) {
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: { ...current, expanded: false }
            }));
            return;
        }
        if (current?.items?.length || current?.summary) {
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: { ...current, expanded: true }
            }));
            if (!current.items?.length && !current.loading) {
                void loadStorySubtasks(task);
            }
            return;
        }
        void loadStorySubtasks(task);
    }, [loadStorySubtasks, storySubtasksByKey]);

    const retryStorySubtasks = React.useCallback((task) => {
        void loadStorySubtasks(task, { forceRefresh: true });
    }, [loadStorySubtasks]);

    return {
        storySubtasksByKey,
        clearStorySubtasks,
        toggleStorySubtasks,
        retryStorySubtasks,
    };
}
```

- [ ] **Step 4: Wire the hook into `dashboard.jsx`**

Add the import:

```js
import { useStorySubtasks } from './issues/useStorySubtasks.js';
```

Add the hook call near the other ENG sprint hooks:

```js
const {
    storySubtasksByKey,
    clearStorySubtasks,
    toggleStorySubtasks,
    retryStorySubtasks,
} = useStorySubtasks({
    backendUrl: BACKEND_URL,
    selectedSprint,
    onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
});
```

Call `clearStorySubtasks()` in `invalidateSprintDataForConfigSave()` with the other sprint-scoped resets so same-sprint config refreshes cannot leave stale expanded rows:

```js
clearStorySubtasks();
```

- [ ] **Step 5: Pass props into `IssueCard`**

Inside `renderEpicBlock()`:

```jsx
<IssueCard
    ...
    subtaskState={storySubtasksByKey[task.key] || null}
    onToggleSubtasks={toggleStorySubtasks}
    onRetrySubtasks={retryStorySubtasks}
/>
```

- [ ] **Step 6: Add hook auth recovery test**

In `tests/test_story_subtasks.js`, add a source-level guard that fails if subtask loading handles `loginUrl` without the shared recovery helpers:

```js
test('story subtask hook uses shared ENG auth recovery helpers', () => {
    const hookSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'issues', 'useStorySubtasks.js'), 'utf8');
    assert.ok(hookSource.includes("from '../eng/useEngSprintData.js'"));
    assert.ok(hookSource.includes('authRecoveryLoginUrl(err)'));
    assert.ok(hookSource.includes('redirectToAuthRecovery(err)'));
    assert.ok(hookSource.includes('onAuthRecoveryRequired?.()'));
});
```

- [ ] **Step 7: Run source guard tests**

Run:

```bash
node --test tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js tests/test_story_subtasks.js
```

Expected: pass.

## Task 7: Analytics Contract

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Test: `tests/test_analytics_source_guards.js`
- Test: `tests/test_frontend_api_source_guards.js`

- [ ] **Step 1: Add a no-event allowlist section and row**

`docs/README_ANALYTICS.md` currently has a 6-column event taxonomy table and no dedicated no-event table. Add this section after the Event Taxonomy table and before the reserved-name paragraph:

```md
### No-Event Allowlist

These user-visible changes intentionally do not add a new app-owned `userevent`; the reason is documented here so future feature reviews do not re-add duplicate or sensitive analytics.

| Feature action | Primary anchors | Reason | Reviewed on |
| --- | --- | --- | --- |
| ENG story subtask expand/collapse | `frontend/src/issues/IssueCard.jsx`, `frontend/src/api/engApi.js` | No separate `userevent`; the only networked action is the on-demand subtask load, covered by existing `api_result` with `feature_name=eng` and `api_surface=eng_subtasks`. The event sends no issue keys, summaries, assignee names, sprint names, JQL, or Jira URLs. | 2026-06-03 |
```

- [ ] **Step 2: Add analytics source guard coverage**

In `tests/test_analytics_source_guards.js`, add:

```js
test('ENG story subtask expand does not add a separate app-owned event', () => {
    const analyticsDoc = fs.readFileSync(path.join(repoRoot, 'docs', 'README_ANALYTICS.md'), 'utf8');
    assert.ok(analyticsDoc.includes('### No-Event Allowlist'));
    assert.ok(analyticsDoc.includes('ENG story subtask expand/collapse'));
    assert.ok(analyticsDoc.includes('api_surface=eng_subtasks'));
    assert.ok(!analyticsDoc.includes('eng_action'));
});
```

- [ ] **Step 3: Verify no new analytics event names or params are needed**

Do not add `eng_action`, `issue_key`, `story_key`, `subtask_name`, `sprint_name`, or raw text parameters.

Run:

```bash
node --test tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js
```

Expected: pass.

## Task 8: UI And Performance Verification

**Files:**
- Create: `tests/ui/eng_story_subtasks.spec.js`
- Modify: `tests/ui/codebase_structure_smoke.spec.js` only if shared fixtures need the new endpoint mock

- [ ] **Step 1: Add Playwright fixture**

Use existing ENG startup fixture style from `tests/ui/codebase_structure_smoke.spec.js`. Add a story payload with:

```js
fields: {
    summary: 'Parent story with subtasks',
    status: { name: 'In Progress' },
    priority: { name: 'Major' },
    assignee: { displayName: 'Synthetic Owner' },
    updated: '2026-05-01T00:00:00.000+0000',
    subtaskSummary: { total: 3, done: 1, inProgress: 1, waiting: 1, percentComplete: 33.3, statusCounts: { Done: 1, 'In Progress': 1, 'To Do': 1 } },
}
```

Mock `/api/issues/subtasks` to return three subtasks.

- [ ] **Step 2: Assert no startup subtask request**

Before clicking:

```js
expect(startupCounts['GET /api/issues/subtasks'] || 0).toBe(0);
await expect(page.locator('.story-subtasks-toggle').first()).toContainText('3 subtasks');
await expect(page.locator('.story-subtasks-progress-percent').first()).toHaveText('33%');
```

- [ ] **Step 3: Assert on-demand fetch and rows**

After clicking the toggle:

```js
await page.locator('.story-subtasks-toggle').first().click();
await waitForCallCount(calls, call => call.pathname === '/api/issues/subtasks', 1);
const subtaskCall = callsFor(calls, '/api/issues/subtasks')[0];
expect(subtaskCall.params.parentKey).toBe('PROD-1');
expect(subtaskCall.params.sprint).toBe(String(selectedSprintId));
await expect(page.locator('.story-subtask-row')).toHaveCount(3);
await expect(page.locator('.story-subtask-row').first()).toContainText('Synthetic subtask');
await expect(page.locator('.story-subtask-row').first()).toContainText('In Progress');
await expect(page.locator('.story-subtask-row').first()).toContainText('Synthetic Owner');
await expect(page.locator('.story-subtask-row').first()).toContainText('2026-05-01');
```

- [ ] **Step 4: Assert collapse/reopen stays client-side**

Click collapse and reopen. If the state has loaded rows, reopening must not issue a second request. Retry is the only UI path that should pass `refresh=true`.

- [ ] **Step 5: Capture visual proof**

Run:

```bash
npx playwright test tests/ui/eng_story_subtasks.spec.js
```

Expected: pass with screenshots for desktop and narrow viewports after animations settle. The screenshot should show the compact one-line subtask count/progress inside the story card and expanded rows under that story without overlapping Jira links, checkboxes, dependency chips, or sticky epic headers.

## Task 9: Build And Final Verification

**Files:**
- Generated: `frontend/dist/*` from `npm run build`
- Verify/possibly modify: `tests/test_codebase_structure_budgets.py`

- [ ] **Step 1: Run focused backend tests**

```bash
.venv/bin/python -m unittest tests.test_eng_subtasks_api tests.test_oauth_eng_routes tests.test_backend_route_source_guards tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_jira_search_pagination_source_guard
```

Expected: pass.

- [ ] **Step 2: Run focused frontend tests**

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_dashboard_alert_source_guards.js tests/test_story_subtasks.js tests/test_analytics_source_guards.js
```

Expected: pass.

- [ ] **Step 3: Run UI verification**

```bash
npx playwright test tests/ui/eng_story_subtasks.spec.js tests/ui/codebase_structure_smoke.spec.js
```

Expected: pass. Confirm `GET /api/issues/subtasks` count is zero before click and one after click.

- [ ] **Step 4: Run the legacy entrypoint budget gate**

Run:

```bash
wc -l jira_server.py frontend/src/dashboard.jsx
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
```

Expected: pass. If this fails, fix it before build/full-suite verification by applying one of these two concrete paths:

1. Preferred: move enough newly added logic out of `jira_server.py` or `frontend/src/dashboard.jsx` into `backend/services/eng_subtasks.py`, `frontend/src/issues/useStorySubtasks.js`, or another focused helper module, then rerun the budget test.
2. If the only remaining overage is minimal feature wiring after the extraction above, update `LEGACY_ENTRYPOINT_LINE_BUDGETS` to the exact measured counts printed by `wc -l` and add this comment above the changed entries:

```python
# EXEC-eng-story-subtasks adds minimal route/payload and hook wiring while feature logic lives in focused helper modules.
```

Never add slack above the exact measured counts.

- [ ] **Step 5: Build frontend dist**

```bash
npm run build
```

Expected: pass. Commit generated `frontend/dist` changes if the build changes them.

- [ ] **Step 6: Run full checks before push**

```bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npm run test:frontend:ui
```

Expected: pass.

## Review Checklist

- [ ] No new startup requests for subtasks.
- [ ] No per-story fan-out on page load.
- [ ] Subtask details load only after explicit user action.
- [ ] Initial count/progress uses only data already returned by the existing story search.
- [ ] Progress denominator is subtask count, not story points.
- [ ] Green represents done subtasks only; animated blue represents in-progress subtasks.
- [ ] Expanded subtask rows show name, status/progress, assignee, and last updated.
- [ ] The story card is not globally clickable.
- [ ] Jira links, planning checkbox, dependency controls, and sticky epic headers still work.
- [ ] Analytics sends no issue keys, summaries, assignee names, sprint names, JQL, labels, or Jira URLs.
- [ ] Route is GET-only and `authenticated_read`.
- [ ] Jira pagination uses `nextPageToken` / `isLast`.
- [ ] UI visual verification covers collapsed and expanded states.
