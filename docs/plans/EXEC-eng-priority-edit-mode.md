# ENG Priority Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ENG users change an issue priority by clicking the existing `task-priority-icon`, using the same compact popout menu UX and OAuth-bound Jira write pattern as ENG status changes.

**Architecture:** Add a Jira OAuth priority catalog endpoint fetched once per app session, a CSRF-protected priority mutation endpoint, and a frontend priority edit hook/menu that reuses the status menu visual grammar. Extend the status transition cache so status catalogs are fetched once per app session, while transition availability remains cached by project/issue-type/current-status target signatures and is revalidated on mutation.

**Tech Stack:** Python 3.10+ Flask blueprints, Jira Cloud REST API v3 issue priorities and issue edit APIs, Atlassian OAuth 2.0 3LO, existing token-bound CSRF guards, React 19, existing `trackedFetch` API wrappers, Playwright UI assertions, Node source guards, Python `unittest`, GA4 dataLayer analytics contract.

---

## Feasibility Answer

Yes for priority: Jira priorities are a catalog-style field. The app can fetch priority options once per browser app session, cache them in a module-level frontend cache, and reuse them when users click different `task-priority-icon` controls.

Partly for status: the app can fetch a status catalog once per app session, but it must not assume every catalog status is a valid transition for every issue. Jira transition availability depends on the current issue, workflow, current status, and the signed-in user's permissions. The plan therefore caches status transition options across app usage by a safer key such as `projectKey|issueType|currentStatus|sourceSurface`, invalidates affected entries after a successful status write, and still resolves the transition server-side at write time.

Subtasks are out of scope for the first priority UI slice because expanded subtask rows do not currently render `task-priority-icon` or carry priority in their subtask payload. This plan covers the existing icon surfaces: Story cards and Epic headers in ENG Catch Up and Planning. A later slice can add priority to subtask payloads and render a subtask priority icon.

## External API Facts Checked

- Atlassian documents `GET /rest/api/3/priority` as returning all issue priorities, requiring Jira access and classic OAuth scope `read:jira-work`; the same page says it is deprecated in favor of search, but search currently documents `manage:jira-configuration`, which is too broad for normal users. Use `/priority` unless this scope situation changes.
- Atlassian documents `GET /rest/api/3/priority/search` as supporting project filters, but its documented OAuth scope is `manage:jira-configuration`; do not add that scope for this UX.
- Atlassian documents `GET /rest/api/3/issue/{issueIdOrKey}/editmeta` as returning the fields the current user may edit on that issue, including `fields.priority.allowedValues` (the issue's real priority scheme). Required classic OAuth scope is `read:jira-work` (granular `read:issue-meta:jira`, `read:field-configuration:jira`) — the SAME `read:jira-work` already granted for issue reads, so filtering priority options to one issue's scheme needs NO new scope and no `manage:jira-configuration`. Scope confirmed 2026-07-10 via WebSearch of the Atlassian "Scopes for OAuth 2.0 (3LO) and Forge apps" reference; the direct api-group-issues WebFetch returned truncated page content, so this is fetched-via-search-and-reasoned-consistent with the plan's existing "issue read = `read:jira-work`" citation, not fetched from the endpoint anchor itself.
- Atlassian documents `PUT /rest/api/3/issue/{issueIdOrKey}` as editing fields, requiring Browse Projects + Edit Issues and classic OAuth scope `write:jira-work`. Use this route with `{"fields":{"priority":{"id":"<priorityId>"}}}` and do not send `transition`, `update`, `historyMetadata`, or arbitrary fields.
- Atlassian documents `GET /rest/api/3/status` as returning statuses associated with active workflows with classic OAuth scope `read:jira-work`; this is appropriate for a session-level status catalog, but not a replacement for per-issue transition validation.
- Keep these source URLs in docs/plans or support docs, not in production comments:
  - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-priorities/
  - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put
  - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-editmeta
  - https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
  - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-statuses/

## Product And Safety Decisions

- Use the existing visible priority icon as the only click target. Do not add a separate "Change priority" button.
- Keep EPM, Statistics, Scenario, and Settings-modal issue surfaces read-only/inert for priority edits, matching the status-transition isolation rules.
- Use only the signed-in user's Jira OAuth context for priority writes. Do not use Jira Basic credentials, service integrations, Home/Townsquare credentials, local token-store helpers, or shared service-account tokens.
- Keep the priority catalog read endpoint OAuth-bound and body-free. Fetch once per frontend app lifetime; only refetch after auth recovery, explicit hard refresh, or a server `priority_catalog_stale` error.
- Use Jira priority IDs for writes. Display names are for UI only; never trust a client-provided priority name as the mutation identifier.
- For priority writes, return per-issue results even though the first UI path sends one issue. This mirrors the status API, keeps the cap/validation reusable, and allows future selected-target priority changes without a backend redesign.
- If the selected priority is already applied, return `already_in_priority` counted as success and do not call Jira `PUT`.
- After successful priority writes, clear Jira-derived process caches and update the local rendered issue immediately before triggering the existing refresh path.
- Reuse the compact status dropdown visual grammar: narrow white panel, shadow, dashed rows, full-row hover, color/icon marker, rounded corners, and no chip-like option cards.
- Analytics uses a new low-cardinality `issue_priority_action` event and a new `jira_issue_priorities` API surface. Do not emit issue keys, summaries, Jira URLs, priority IDs, account IDs, raw errors, or JQL.

### Amendments (2026-07-09 product review)

After the product owner reviewed the live UI, three corrections were implemented in a follow-up batch. No change to the one-click flow, OAuth-only posture, EPM/Stats/Scenario/Settings inertness, or analytics contract.

- **REQ-A — real priority icons in the menu.** Option rows now render the app's OWN priority icon (the same `renderPriorityIcon` visual as the trigger and task rows), seeded uniquely per option (`${issueKey}-${option.id}`) so gradient/aria ids stay collision-free. A colored `statusColor` dot is kept only as a fallback for an exotic priority the app has no icon for (name not in `isRecognizedPriorityIconName`) that still carries a Jira color. Status-menu markers are unchanged (dots are their grammar).
- **REQ-B — real priority values (per-project scheme).** The menu no longer lists the site-wide catalog. `GET /api/issues/priorities/options` accepts an optional `issueKey` and filters the catalog to that issue's `fields.priority.allowedValues` via editmeta (OAuth `read:jira-work` only; NOT `/priority/search` / `manage:jira-configuration`). The frontend cache moved from a single global catalog to a module-level Map keyed by the issue's `projectKey|issueType` tuple (`priorityOptionCacheKey`), with per-tuple promise dedup; only successful NON-EMPTY schemes are cached so an uneditable issue's empty result never poisons the tuple. Steady state: one options request per project/issue-type per app session (≈2–6 small requests for 2 projects). The no-`issueKey` full-catalog path is kept for backward compatibility. Epic own-priority omission composes after the scheme filter (filter first, omit the Epic's own current priority next).
- **REQ-C — dismiss the menu on any outside click.** The shared `IssueFieldOptionMenu` now dismisses on a document-level `pointerdown` scoped to the field wrapper (trigger + menu), replacing the click-away backdrop that `.task-item`/`.epic-header`'s persisted `task-appear` transform had clamped to the card box (a non-none transform makes the card the containing block for `position:fixed`, so outside-card clicks missed the backdrop). Escape still closes; the defeated backdrop element was removed. Fixes both the priority and the shipped status menu (shared component).

## Endpoint Contracts

### `GET /api/issues/priorities/options`

| Item | Contract |
| --- | --- |
| Purpose | Return the Jira priority catalog used by priority edit menus. |
| Auth | `authenticated_read`, route code rejects non-OAuth with `403 jira_oauth_required` to keep edit-mode behavior OAuth-only. |
| CSRF | No CSRF token; safe `GET`. |
| Query | Optional `issueKey`. Present: filter the catalog to that issue's own priority scheme via editmeta (see below). Absent: return the full site catalog (backward-compatible). |
| Jira call | No `issueKey`: `current_jira_request("GET", "/rest/api/3/priority", context=auth_context)`. With `issueKey`: `GET /rest/api/3/issue/{key}/editmeta` (read `fields.priority.allowedValues`), then — only when priority is editable — `GET /rest/api/3/priority`, filtered to the allowed ids preserving catalog order/rank/statusColor/iconUrl. One editmeta call + at most one catalog call; no other fan-out. OAuth-only (`current_jira_request`, request auth context); never `build_jira_headers`, Basic, Home, or service creds. |
| Per-project filtering | An allowed id missing from the catalog is appended, shaped from the allowedValue's own fields with `statusColor: null`, ranked after every catalog entry. If editmeta omits the priority field entirely (user cannot edit priority), return `{"priorities": []}` so the menu's empty state tells the truth. |
| Success body | `{"priorities":[{"id":"1","name":"Highest","statusColor":"#ff5630","iconUrl":"https://...","rank":10},{"id":"3","name":"Major","statusColor":"#ffab00","iconUrl":"https://...","rank":40}],"source":"jira","cached":false}` (same shape with or without `issueKey`). |
| Errors | `400 invalid_issue_key` (malformed `issueKey`), `404 issue_not_found` (editmeta 404), `401` auth recovery payloads, `403 jira_oauth_required`, sanitized `502 jira_priority_options_failed`. |

### `POST /api/issues/priorities`

| Item | Contract |
| --- | --- |
| Purpose | Change one or more ENG issue priorities to a target Jira priority ID. |
| Auth | `user_write`, token-bound CSRF, explicit OAuth-mode guard, and route-level `write:jira-work` granted-scope check before any Jira `PUT`. |
| CSRF | Requires both `X-Requested-With: jira-execution-planner` and valid `X-CSRF-Token`. |
| Request body | `{"issueKeys":["PROD-1"],"targetPriorityId":"3"}` |
| Jira calls | One snapshot search for current priority, then bounded per-issue `PUT /rest/api/3/issue/{key}` with `{"fields":{"priority":{"id":"3"}}}`. |
| Success body | `{"requested":1,"succeeded":1,"failed":0,"targetPriority":{"id":"3","name":"Major"},"results":[{"key":"PROD-1","result":"success","fromPriority":"High","toPriority":"Major"}]}` |
| No-op body | `{"result":"already_in_priority"}` per issue, counted as success. |
| Invalid input | `400 issue_keys_required`, `400 invalid_issue_key`, `400 target_priority_required`, `400 invalid_priority_id`, `400 too_many_issues`, `400 invalid_json`. |
| Jira failures | Per-issue sanitized failures: `priority_forbidden`, `issue_not_found`, `priority_conflict`, `priority_update_failed`. Catastrophic upstream failure returns `502 jira_priority_update_failed` only if no per-issue result can be produced. |
| Cache invalidation | If `succeeded > 0`, call the same Jira-derived cache clearing path used by status changes, with reason `issue_priority_update`. |

### `GET /api/issues/statuses/catalog`

| Item | Contract |
| --- | --- |
| Purpose | Return active Jira workflow statuses once per app session for menu ordering/color/category hints. |
| Auth | `authenticated_read`, OAuth-only route guard. |
| Jira call | `current_jira_request("GET", "/rest/api/3/status", context=auth_context)`. |
| Success body | `{"statuses":[{"id":"10000","name":"In Progress","statusCategoryKey":"indeterminate","statusCategoryColor":"yellow"}],"source":"jira","cached":false}` |
| Important limit | This catalog does not mean each status is a legal transition for each issue. Status mutation still uses `/api/issues/transitions/options` cache and `/api/issues/transitions` write-time validation. |

## File Map

- Create: `backend/services/jira_issue_priorities.py` - pure priority option shaping, issue-key normalization reuse, priority ID validation, snapshot loading, per-issue result shaping, and bounded write orchestration.
- Modify: `backend/services/jira_issue_transitions.py` - expose or reuse issue-key normalization helpers if practical; do not create circular imports.
- Modify: `backend/routes/eng_routes.py` - add priority option/write routes and status catalog route near existing issue routes.
- Modify: `backend/security/policy.py` - add endpoint policies for the new priority and status catalog routes.
- Modify: `jira_server.py` only if cache clearing needs a tiny exported helper; avoid growing this file for implementation logic.
- Modify: `frontend/src/api/jiraIssueApi.js` - add priority options/write wrappers and status catalog wrapper, or split to `frontend/src/api/jiraIssuePriorityApi.js` if the source guard budget demands it.
- Create: `frontend/src/eng/engPriorityTransitionUtils.js` - pure priority sorting, result summary, analytics params, and display helpers.
- Create: `frontend/src/eng/useEngPriorityTransitions.js` - module-level priority catalog cache, active issue target state, option loading, mutation submission, auth recovery, and refresh callbacks.
- Modify: `frontend/src/eng/useEngStatusTransitions.js` - move status option cache to a module-level cache keyed by safe signatures; optionally consume the session-level status catalog for ordering/category hints.
- Create: `frontend/src/issues/IssueFieldOptionMenu.jsx` - shared compact menu row renderer for status and priority menus.
- Modify: `frontend/src/issues/StatusTransitionMenu.jsx` - refactor to use `IssueFieldOptionMenu` without changing status behavior.
- Create: `frontend/src/issues/PriorityTransitionMenu.jsx` - priority-specific trigger/menu shell using `IssueFieldOptionMenu`.
- Modify: `frontend/src/issues/IssueCard.jsx` - pass priority edit props and wrap the existing Story `renderPriorityIcon` result only when priority edit mode is enabled.
- Modify: `frontend/src/dashboard.jsx` - wire the priority hook into ENG Catch Up/Planning Story cards and Epic headers; keep wiring thin and preserve EPM inertness.
- Modify: `frontend/src/styles/eng/status-transitions.css` or create `frontend/src/styles/eng/issue-field-menu.css` - share compact dropdown styles between status and priority; avoid duplicate one-off classes.
- Modify: `frontend/src/styles/eng/issues.css` - add button reset/focus styling for interactive `.task-priority-icon` while preserving the existing icon geometry and tooltip behavior.
- Modify: `frontend/src/analytics/analytics.js`, `frontend/src/analytics/dashboardAnalytics.js`, `frontend/src/analytics/events.js`, and `docs/README_ANALYTICS.md` - add `jira_issue_priorities` API surface and `issue_priority_action`.
- Modify: `docs/plans/README.md` - index this plan under Frontend Planning Workflow.
- Generated by build: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`.
- Create: `tests/test_jira_issue_priorities.py` - backend service and route tests.
- Modify: `tests/test_oauth_eng_routes.py`, `tests/test_endpoint_security_matrix.py`, `tests/test_endpoint_policy_inventory.py`, and `tests/test_backend_route_source_guards.py` - endpoint policy, OAuth guard, forbidden credential, and source isolation coverage.
- Create: `tests/test_eng_priority_transition_utils.js` - priority sorting, result summary, and analytics param tests.
- Modify: `tests/test_frontend_api_source_guards.js`, `tests/test_planning_action_source_guards.js`, `tests/test_epm_view_source_guards.js`, `tests/test_analytics_events.js`, and `tests/test_analytics_source_guards.js`.
- Modify or create: `tests/ui/eng_priority_transitions.spec.js` - Story/Epic priority menu, one-fetch cache behavior, mutation, EPM inertness, menu geometry, and hover assertions.
- Modify: `tests/ui/eng_status_transitions.spec.js` - add status cache assertions proving status/catalog or tuple cache is reused across different clicked status icons where safe.
- Modify: `tests/test_codebase_structure_budgets.py` - ratchet `frontend/src/dashboard.jsx` only for unavoidable wiring, with a comment; do not add backend logic to `jira_server.py`.

## Task 0: Pre-Execution Gate And File-Map Checks

**Files:**
- Read: `AGENTS.md`
- Read: `docs/plans/AGENTS.md`
- Read: `docs/plans/README.md`
- Read: `docs/plans/GATE-05-home-write-capability.md`
- Read: `docs/postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md`
- Read: `docs/postmortem/MRT016-exec-02-plan-file-map-drift.md`

- [ ] **Step 0.1: Confirm branch and clean state**

Run:

```bash
git status --short --branch
```

Expected: a non-`main` branch and no unrelated dirty files. Stop if on `main`.

- [ ] **Step 0.2: Verify every Modify path exists**

Run:

```bash
rg --files | rg '^(backend/services/jira_issue_transitions.py|backend/routes/eng_routes.py|backend/security/policy.py|jira_server.py|frontend/src/api/jiraIssueApi.js|frontend/src/eng/useEngStatusTransitions.js|frontend/src/issues/StatusTransitionMenu.jsx|frontend/src/issues/IssueCard.jsx|frontend/src/dashboard.jsx|frontend/src/styles/eng/status-transitions.css|frontend/src/styles/eng/issues.css|frontend/src/analytics/analytics.js|frontend/src/analytics/dashboardAnalytics.js|frontend/src/analytics/events.js|docs/README_ANALYTICS.md|docs/plans/README.md|tests/test_oauth_eng_routes.py|tests/test_endpoint_security_matrix.py|tests/test_endpoint_policy_inventory.py|tests/test_backend_route_source_guards.py|tests/test_frontend_api_source_guards.js|tests/test_planning_action_source_guards.js|tests/test_epm_view_source_guards.js|tests/test_analytics_events.js|tests/test_analytics_source_guards.js|tests/test_codebase_structure_budgets.py)$'
```

Expected: every listed `Modify` file appears. If any path is missing, update this plan before coding.

- [ ] **Step 0.3: Keep Home write gate blocked**

Open `docs/plans/GATE-05-home-write-capability.md`. If the required `HOME_WRITE_PROBE_*` inputs are unavailable, do not run the Home write probe and keep the gate blocked. This priority plan must not add Home/Townsquare writes.

## Task 1: Backend Priority Service

**Files:**
- Create: `backend/services/jira_issue_priorities.py`
- Test: `tests/test_jira_issue_priorities.py`

- [x] **Step 1.1: Write failing service tests**

Add tests covering:

```python
def test_load_priority_options_shapes_catalog_without_raw_jira_body(self):
    # fake GET /rest/api/3/priority returns id, name, iconUrl, statusColor
    # assert options are sorted by existing priority urgency order and no self URL is required by callers

def test_update_issue_priorities_posts_priority_id_only(self):
    # fake snapshot search says PROD-1 priority is High
    # fake PUT sees json_body == {"fields": {"priority": {"id": "3"}}}
    # assert succeeded == 1 and from/to names are shaped

def test_update_issue_priorities_treats_same_priority_as_success_without_put(self):
    # fake snapshot priority id already equals target id
    # assert result == already_in_priority and fake PUT was never called

def test_update_issue_priorities_caps_and_validates_inputs(self):
    # assert invalid key, missing priority id, non-numeric id, and >50 keys raise input errors
```

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_priorities
```

Expected before implementation: fails because `backend.services.jira_issue_priorities` does not exist.

- [x] **Step 1.2: Implement the pure service**

Create `backend/services/jira_issue_priorities.py` with these public symbols:

```python
MAX_PRIORITY_UPDATE_ISSUES = 50
PRIORITY_UPDATE_WORKERS = 8
PRIORITY_UPDATE_TIMEOUT_BUDGET_SECONDS = 90.0

class IssuePriorityInputError(ValueError):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)

class IssuePriorityServiceError(Exception):
    def __init__(self, code, status_code=None, message=None):
        self.code = code
        self.status_code = status_code
        super().__init__(message or code)

def normalize_priority_id(value):
    priority_id = str(value or '').strip()
    if not priority_id or not priority_id.isdigit():
        raise IssuePriorityInputError('invalid_priority_id')
    return priority_id

def load_priority_options(*, jira_request, context=None):
    response = jira_request('GET', '/rest/api/3/priority', context=context)
    if getattr(response, 'status_code', None) != 200:
        raise IssuePriorityServiceError('priority_options_fetch_failed', getattr(response, 'status_code', None))
    priorities = shape_priority_options(response.json() or [])
    return {'priorities': priorities, 'source': 'jira'}

def update_issue_priorities(issue_keys, target_priority_id, *, jira_request, search_request, context=None):
    # Validate inputs, load current priority snapshots in one search,
    # then bounded PUT /rest/api/3/issue/{key} per issue.
```

Reuse the status service's issue-key validation shape where practical, but avoid circular imports if extraction becomes messy.

- [x] **Step 1.3: Run service tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_priorities
```

Expected: pass.

- [x] **Step 1.4: Commit**

```bash
git add backend/services/jira_issue_priorities.py tests/test_jira_issue_priorities.py
git commit -m "add jira issue priority service"
```

## Task 2: Backend Routes, Policy, And OAuth Guards

**Files:**
- Modify: `backend/routes/eng_routes.py`
- Modify: `backend/security/policy.py`
- Modify: `backend/services/jira_issue_transitions.py` (added `shape_status_catalog`/`load_status_catalog`; reuses the existing `IssueTransitionServiceError` instead of a new module/exception)
- Modify: `tests/test_oauth_eng_routes.py`
- Modify: `tests/test_endpoint_security_matrix.py`
- Modify: `tests/test_endpoint_policy_inventory.py`
- Modify: `tests/test_backend_route_source_guards.py`
- Modify: `tests/test_jira_issue_transitions.py` (direct unit coverage for the new pure catalog-shaping helpers)

- [x] **Step 2.1: Write failing route and policy tests**

Add route tests for:

```python
def test_priority_options_route_requires_oauth_mode(self): ...
def test_priority_options_route_uses_current_auth_context(self): ...
def test_priority_write_rejects_missing_x_requested_with_before_route_code(self): ...
def test_priority_write_rejects_missing_csrf_token_before_route_code(self): ...
def test_priority_write_returns_missing_scope_before_jira_call_when_write_scope_absent(self): ...
def test_priority_write_uses_oauth_context_and_clears_caches_on_success(self): ...
def test_priority_write_does_not_call_build_jira_headers(self): ...
```

Add policy assertions:

```python
("/api/issues/priorities/options", ["GET"]) -> authenticated_read
("/api/issues/priorities", ["POST"]) -> user_write
("/api/issues/statuses/catalog", ["GET"]) -> authenticated_read
```

Run:

```bash
.venv/bin/python -m unittest tests.test_oauth_eng_routes tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards
```

Expected before implementation: fails because the routes and policies do not exist.

- [x] **Step 2.2: Add endpoint policies**

Add to `backend/security/policy.py` near the existing Jira issue transition policies:

```python
EndpointPolicy("jira-issue-priority-options", "/api/issues/priorities/options", PUBLIC_METHODS, "authenticated_read"),
EndpointPolicy("jira-issue-priorities-write", "/api/issues/priorities", frozenset({"POST"}), "user_write"),
EndpointPolicy("jira-issue-status-catalog", "/api/issues/statuses/catalog", PUBLIC_METHODS, "authenticated_read"),
```

- [x] **Step 2.3: Add routes**

Add route handlers in `backend/routes/eng_routes.py` near the status transition routes:

```python
@bp.route('/api/issues/priorities/options', methods=['GET'])
def get_issue_priority_options():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    try:
        auth_context = current_request_auth_context()
        result = load_priority_options(jira_request=current_jira_request, context=auth_context)
    except AuthError as error:
        return _eng_auth_error_response(error)
    except IssuePriorityServiceError:
        logger.exception('Issue priority options Jira fetch failed')
        return jsonify({'error': 'jira_priority_options_failed'}), 502
    return jsonify(result)

@bp.route('/api/issues/priorities', methods=['POST'])
def post_issue_priorities():
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
    if result.get('succeeded', 0) > 0:
        clear_jira_issue_status_caches(reason='issue_priority_update')
    return jsonify(result)
```

Add `GET /api/issues/statuses/catalog` using `GET /rest/api/3/status`, shaped without raw Jira URLs.

- [x] **Step 2.4: Run backend route tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_priorities tests.test_oauth_eng_routes tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards
```

Expected: pass.

- [x] **Step 2.5: Commit**

```bash
git add backend/routes/eng_routes.py backend/security/policy.py tests/test_oauth_eng_routes.py tests/test_endpoint_security_matrix.py tests/test_endpoint_policy_inventory.py tests/test_backend_route_source_guards.py tests/test_jira_issue_priorities.py
git commit -m "add oauth priority edit routes"
```

## Task 3: Frontend API, Caches, And Analytics Contract

**Files:**
- Modify: `frontend/src/api/jiraIssueApi.js`
- Create: `frontend/src/eng/engPriorityTransitionUtils.js`
- Create: `frontend/src/eng/useEngPriorityTransitions.js`
- Modify: `frontend/src/eng/useEngStatusTransitions.js`
- Modify: `frontend/src/analytics/analytics.js`
- Modify: `frontend/src/analytics/dashboardAnalytics.js`
- Modify: `frontend/src/analytics/events.js`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `tests/test_frontend_api_source_guards.js`
- Create: `tests/test_eng_priority_transition_utils.js`
- Modify: `tests/test_planning_action_source_guards.js`
- Modify: `tests/test_analytics_events.js`
- Modify: `tests/test_analytics_source_guards.js`

- [x] **Step 3.1: Write failing API/cache tests**

Add tests proving:

```js
// frontend API
fetchIssuePriorityOptions('http://backend') sends GET /api/issues/priorities/options
updateIssuePriorities('http://backend', { issueKeys:['PROD-1'], targetPriorityId:'3' }) fetches CSRF then POSTs
fetchIssueStatusCatalog('http://backend') sends GET /api/issues/statuses/catalog

// hook/source guards
useEngPriorityTransitions contains module-level priorityOptionsCacheRef or equivalent module cache
useEngStatusTransitions no longer caches only per hook instance for every status option request
```

Run:

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_eng_priority_transition_utils.js tests/test_planning_action_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
```

Expected before implementation: fails because wrappers/hook/utils/events do not exist.

- [x] **Step 3.2: Add frontend API wrappers**

In `frontend/src/api/jiraIssueApi.js` add:

```js
export function fetchIssuePriorityOptions(backendUrl, { signal } = {}) {
    return trackedFetch('jira_issue_priorities', `${backendUrl}/api/issues/priorities/options`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_priority_changes' }).then(response => jsonOrStructuredError(response, 'Issue priority options'));
}

export async function updateIssuePriorities(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_priorities', `${backendUrl}/api/issues/priorities`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_priority_changes' }).then(response => jsonOrStructuredError(response, 'Issue priority update'));
}

export function fetchIssueStatusCatalog(backendUrl, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/statuses/catalog`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue status catalog'));
}
```

- [x] **Step 3.3: Add priority hook with one-fetch app cache**

Create `frontend/src/eng/useEngPriorityTransitions.js` with a module-level cache:

```js
let priorityOptionsCache = null;
let priorityOptionsPromise = null;

export function clearPriorityOptionsCache() {
    priorityOptionsCache = null;
    priorityOptionsPromise = null;
}

async function loadPriorityOptionsOnce(backendUrl, signal) {
    if (priorityOptionsCache) return priorityOptionsCache;
    if (!priorityOptionsPromise) {
        priorityOptionsPromise = fetchIssuePriorityOptions(backendUrl, { signal })
            .then((payload) => {
                priorityOptionsCache = payload;
                return payload;
            })
            .finally(() => {
                priorityOptionsPromise = null;
            });
    }
    return priorityOptionsPromise;
}
```

The hook should expose `openPriorityControl(issue)`, `closePriorityControl()`, `submitPriorityChange(priorityId, issueKey)`, loading/error/result state, and `activePriorityTarget`.

- [x] **Step 3.4: Extend status caching across app usage**

Move the current hook-local `optionsCacheRef` behavior into a module-level cache in `useEngStatusTransitions.js`:

```js
const transitionOptionsCache = new Map();
let statusCatalogCache = null;
let statusCatalogPromise = null;

function transitionOptionCacheKey(targets) {
    return targets
        .map(target => [
            target.projectKey || String(target.key || '').split('-')[0],
            target.issueType || '',
            target.currentStatus || '',
        ].join('|'))
        .sort()
        .join(',');
}
```

Do not key only by status name. Include project key, issue type, and current status. On successful status transition, invalidate cache entries for the affected project/status tuples and the old issue-key signature. Keep write-time backend validation unchanged.

- [x] **Step 3.5: Add analytics contract**

Add:

```js
// analytics.js allowed API surfaces
'jira_issue_priorities'

// dashboardAnalytics.js
const trackIssuePriorityAction = useCallback((workflowAction, params = {}) => {
    trackProductEvent('issue_priority_action', {
        feature_name: 'eng_priority_changes',
        workflow_action: workflowAction,
        ...params,
    });
}, [trackProductEvent]);
```

Allowed params: `source_surface`, `issue_type_mix`, `selected_count_bucket`, `priority_bucket`, `result`. Do not include raw issue keys or priority IDs.

- [x] **Step 3.6: Run frontend API/cache/analytics tests**

Run:

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_eng_priority_transition_utils.js tests/test_planning_action_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
```

Expected: pass.

- [x] **Step 3.7: Commit**

```bash
git add frontend/src/api/jiraIssueApi.js frontend/src/eng/engPriorityTransitionUtils.js frontend/src/eng/useEngPriorityTransitions.js frontend/src/eng/useEngStatusTransitions.js frontend/src/analytics/analytics.js frontend/src/analytics/dashboardAnalytics.js frontend/src/analytics/events.js docs/README_ANALYTICS.md tests/test_frontend_api_source_guards.js tests/test_eng_priority_transition_utils.js tests/test_planning_action_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
git commit -m "add frontend priority edit api and caches"
```

## Task 4: Shared Menu UI And Priority Icon Trigger

**Files:**
- Create: `frontend/src/issues/IssueFieldOptionMenu.jsx`
- Modify: `frontend/src/issues/StatusTransitionMenu.jsx`
- Create: `frontend/src/issues/PriorityTransitionMenu.jsx`
- Modify: `frontend/src/issues/IssueCard.jsx`
- Modify: `frontend/src/styles/eng/status-transitions.css`
- Modify: `frontend/src/styles/eng/issues.css`
- Modify: `tests/ui/eng_priority_transitions.spec.js`
- Modify: `tests/ui/eng_status_transitions.spec.js`

- [x] **Step 4.1: Write failing Playwright UI tests**

Create `tests/ui/eng_priority_transitions.spec.js` with assertions mirroring status:

```js
test('priority icon opens compact app dropdown and fetches priorities once across icons', async ({ page }) => {
    // fixture renders two stories with task-priority-icon
    // click PROD-1 priority icon -> options endpoint called once
    // close, click PROD-2 priority icon -> options endpoint call count remains one
    // menu width <= 280, option height <= 36, full-row hover background changes
});

test('priority option click changes the clicked issue priority in one action', async ({ page }) => {
    // click icon, click "Major", assert POST /api/issues/priorities body has issueKeys ['PROD-1'] and targetPriorityId
});

test('EPM issue boards render inert priority icons and never call priority APIs', async ({ page }) => {
    // EPM surface has no interactive priority trigger and no /api/issues/priorities requests
});
```

Extend `eng_status_transitions.spec.js` with a cache assertion:

```js
test('status transition options reuse safe tuple cache across matching issue icons', async ({ page }) => {
    // two To Do Story issues in same project should not refetch options on second open
});
```

Run:

```bash
npx playwright test tests/ui/eng_priority_transitions.spec.js tests/ui/eng_status_transitions.spec.js
```

Expected before implementation: fails because priority UI does not exist and status cache is not tuple-wide.

- [x] **Step 4.2: Extract shared option menu**

Create `frontend/src/issues/IssueFieldOptionMenu.jsx`:

```jsx
export default function IssueFieldOptionMenu({
    issueKey,
    label,
    options,
    loading,
    error,
    result,
    disabled,
    renderMarker,
    optionLabel,
    onSelect,
    onEscape,
}) {
    // Render the same role="menu", backdrop, compact rows, focus-first-option,
    // dashed separators, and result/error notes used by status today.
}
```

Refactor `StatusTransitionMenu.jsx` to call `IssueFieldOptionMenu` and keep its public props stable.

- [x] **Step 4.3: Add priority menu**

Create `frontend/src/issues/PriorityTransitionMenu.jsx`:

```jsx
export default function PriorityTransitionMenu({
    issue,
    priorityLabel,
    renderPriorityIcon,
    isOpen,
    options,
    optionsLoading,
    submitting,
    error,
    result,
    onOpen,
    onClose,
    onSubmit,
}) {
    // Trigger is a native button wrapping the same priority icon visual.
    // Menu rows use IssueFieldOptionMenu, with icon/color markers from Jira priority data.
}
```

The trigger must preserve `.task-priority-icon` classes and data attributes so existing tooltip/visual tests continue to pass.

- [x] **Step 4.4: Wire Story cards and Epic headers**

Modify `IssueCard.jsx` to accept priority edit props and render `PriorityTransitionMenu` only when `priorityTransitionEnabled` is true.

Modify `dashboard.jsx` so:

```jsx
priorityTransitionEnabled={isStatusTransitionSurfaceEnabled && !isSettingsModalOpen}
priorityTransitionActiveKey={activePriorityTarget?.key}
onOpenPriorityTransition={openPriorityControl}
onSubmitPriorityTransition={submitPriorityChange}
```

Wire Epic headers where `renderPriorityIcon(effectivePriority.name, epicGroup.key)` currently renders the icon.

- [x] **Step 4.5: Apply shared styling**

Use `.issue-field-menu*` shared selectors or alias the existing `.status-transition-menu*` selectors without duplicating declarations. Add a button reset for interactive priority icons:

```css
button.task-priority-icon {
    appearance: none;
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    transition: background-color 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
}

button.task-priority-icon:hover,
button.task-priority-icon:focus-visible {
    background: var(--bg-primary);
    box-shadow: 0 0 0 2px rgba(47, 128, 237, 0.22);
}
```

- [x] **Step 4.6: Run UI tests**

Run:

```bash
npx playwright test tests/ui/eng_priority_transitions.spec.js tests/ui/eng_status_transitions.spec.js
```

Expected: pass.

- [x] **Step 4.7: Commit**

```bash
git add frontend/src/issues/IssueFieldOptionMenu.jsx frontend/src/issues/StatusTransitionMenu.jsx frontend/src/issues/PriorityTransitionMenu.jsx frontend/src/issues/IssueCard.jsx frontend/src/dashboard.jsx frontend/src/styles/eng/status-transitions.css frontend/src/styles/eng/issues.css tests/ui/eng_priority_transitions.spec.js tests/ui/eng_status_transitions.spec.js
git commit -m "add priority icon edit menu"
```

## Task 5: Refresh, EPM Isolation, And Source Guards

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `tests/test_planning_action_source_guards.js`
- Modify: `tests/test_codebase_structure_budgets.py`

- [x] **Step 5.1: Add source guards first**

Add assertions:

```js
assert.ok(!epmViewSource.includes('useEngPriorityTransitions'));
assert.ok(!epmRollupPanelSource.includes('PriorityTransitionMenu'));
assert.ok(!epmIssueBoardSource.includes('data-priority-transition-trigger'));
```

Add planning/dashboard guards that the priority hook exists and `dashboard.jsx` only wires it, while menu logic lives outside dashboard.

Run:

```bash
node --test tests/test_epm_view_source_guards.js tests/test_planning_action_source_guards.js
```

Expected before wiring cleanup: fail until guards and wiring match.

- [x] **Step 5.2: Refresh affected rows**

After `submitPriorityChange` succeeds, reuse the same refresh callback shape as status:

```js
onPrioritySuccessRefresh?.({ affectedSubtaskStoryKeys: [] });
```

For Stories/Epics, update local rendered priority immediately where the data model is already in memory, then trigger the existing task-list refresh. Do not add a new startup fetch.

- [x] **Step 5.3: Budget dashboard wiring**

If `frontend/src/dashboard.jsx` grows, update `tests/test_codebase_structure_budgets.py` with a short comment like:

```python
# docs/eng-priority-edit-mode-plan wires the ENG priority icon edit hook and menu props.
# Menu/state/API logic lives in dedicated eng/issues modules, so dashboard growth is wiring only.
"frontend/src/dashboard.jsx": <new exact count>,
```

Do not increase `jira_server.py` budget for this plan.

- [x] **Step 5.4: Run guards**

Run:

```bash
node --test tests/test_epm_view_source_guards.js tests/test_planning_action_source_guards.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
```

Expected: pass.

- [x] **Step 5.5: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_epm_view_source_guards.js tests/test_planning_action_source_guards.js tests/test_codebase_structure_budgets.py
git commit -m "guard priority edit surface isolation"
```

## Task 6: Build, Full Verification, And Dist

**Files:**
- Generated: `frontend/dist/dashboard.js`
- Generated: `frontend/dist/dashboard.js.map`
- Generated: `frontend/dist/dashboard.css`

- [x] **Step 6.1: Build frontend**

Run:

```bash
npm run build
```

Expected: exit 0 and generated dist changes.

- [x] **Step 6.2: Run focused UI and source checks**

Run:

```bash
npx playwright test tests/ui/eng_priority_transitions.spec.js tests/ui/eng_status_transitions.spec.js
node --test tests/test_frontend_api_source_guards.js tests/test_eng_priority_transition_utils.js tests/test_planning_action_source_guards.js tests/test_epm_view_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
.venv/bin/python -m unittest tests.test_jira_issue_priorities tests.test_oauth_eng_routes tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards tests.test_codebase_structure_budgets
```

Expected: all pass.

- [x] **Step 6.3: Run full backend suite before push**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: pass. If the sandbox blocks the local PostgreSQL socket, rerun the same command with approved escalation and record that the sandbox run failed for socket access only.

- [x] **Step 6.4: Review and commit dist**

Run:

```bash
git diff --stat
git diff --check
```

Expected: only planned source, tests, docs, and generated dist files changed; no whitespace errors.

Commit:

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "build priority edit frontend assets"
```

## Self-Review Checklist

- [ ] Priority options are fetched once per app session and reused across different priority icon clicks.
- [ ] Status catalog is fetched once per app session, but transition availability is not treated as globally valid.
- [ ] Status transition option cache keys include enough dimensions to avoid cross-workflow mistakes.
- [ ] Priority writes use Jira priority IDs and current user's OAuth context only.
- [ ] EPM, Statistics, Scenario, and Settings modal surfaces remain inert.
- [ ] The priority menu uses the same compact dropdown visual system as the status menu.
- [ ] Analytics contains no issue keys, priority IDs, raw errors, account IDs, Jira URLs, or JQL.
- [ ] No Home/Townsquare write route or mutation UI is introduced.
