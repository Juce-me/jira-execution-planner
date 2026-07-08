# Jira OAuth ENG Status Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ENG Catch Up and Planning users change Jira status for Epics, Stories, and Subtasks through signed-in-user Jira OAuth, while keeping EPM Jira/Home-backed issue surfaces view-only.

**Architecture:** Add two Jira REST-backed issue transition endpoints: one read-style options endpoint and one CSRF-protected mutation endpoint. The backend resolves transition IDs per issue from Jira at action time and posts only `/rest/api/3/issue/{issueIdOrKey}/transitions` through `current_jira_request()` using the current request's OAuth context. The frontend makes the existing ENG status pill/text the click target for status changes: Catch Up opens an issue-scoped status menu from the clicked status, and Planning opens either an issue-scoped or selected-target batch menu from the clicked status. Planning keeps existing story selection for capacity math and uses separate status-target state for Epics and expanded Subtasks without adding separate "Change status" buttons.

**Tech Stack:** Python 3.10+ Flask blueprints, Jira Cloud REST API v3 issue transitions, Atlassian OAuth 2.0 3LO, existing token-bound CSRF guards, React 19, existing frontend API modules, Node source-guard tests, Python `unittest`, Playwright visual/interaction tests, GA4 dataLayer analytics contract.

---

## External API Facts Checked

- Atlassian documents `GET /rest/api/3/issue/{issueIdOrKey}/transitions` as returning transitions the user can perform for an issue, constrained by Browse Projects, issue security, and Transition Issues permissions. Classic OAuth scope: `read:jira-work`; granular scopes include `read:issue.transition:jira`, `read:status:jira`, and `read:field-configuration:jira`.
- Atlassian documents `POST /rest/api/3/issue/{issueIdOrKey}/transitions` as performing an issue transition. Required permissions are Browse Projects and Transition Issues for that issue. Classic OAuth scope: `write:jira-work`; granular scopes include `write:issue:jira` and `write:issue.property:jira`.
- Atlassian's OAuth 2.0 3LO docs state operation scopes must come from the relevant API docs and the user's own permissions still constrain the app even when scopes are granted.
- Use repo links in implementation comments sparingly; keep these source URLs in docs/support material, not code:
  - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-transitions-get
  - https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-transitions-post
  - https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/

## Scope And Product Decisions

- This plan is Jira REST issue status mutation only for ENG Catch Up and ENG Planning. It does not add Home/Townsquare writes and does not unblock `docs/plans/GATE-05-home-write-capability.md`.
- The mutation path must use only the signed-in user's Jira OAuth context. Do not use Jira Basic credentials, service integrations, Home/Townsquare credentials, local token-store helpers, or shared service-account tokens.
- The route must reject non-OAuth mode with `403 jira_oauth_required` before any Jira request. Basic/local mode stays read-oriented for this feature.
- The app uses classic Atlassian scopes today. Add `write:jira-work` to the configured `ATLASSIAN_SCOPES` set and operator docs. Because the scope is promoted into the global `ATLASSIAN_SCOPES` (`jira_server.py`, `backend/auth/jira_auth.py`, and the two copies in `.env.example`), the existing missing-scope check re-auths every signed-in user, including read-only users, on their next load — not only users attempting a write. State this global re-auth impact explicitly in the operator docs. The write route must additionally perform a route-level granted-scope check and return `401 missing_oauth_scope` before any Jira POST when the session lacks `write:jira-work`, so recovery surfaces `/login?reason=missing_scope` instead of per-issue Jira 403s.
- EPM remains view-only while `GATE-05` is blocked. EPM status pills/text stay inert even if the same shared issue-card component renders clickable status pills in ENG. Do not render status transition triggers in `selectedView === 'epm'`, do not pass status-transition props through `EpmView` or `EpmRollupPanel`, and do not let EPM issue cards call the Jira transition API even though the backend route exists for ENG.
- Jira-project-backed and Home/Townsquare-backed EPM/APM surfaces remain read-oriented for normal users. This plan must not introduce EPM mutation buttons, EPM route writes, Home project writes, or a hidden EPM path to `/api/issues/transitions`.
- Catch Up mode supports one-at-a-time status changes for an Epic, Story, or expanded Subtask. It does not introduce Planning capacity selection controls.
- Planning Stories keep using the existing `selectedTasks` map because that map drives capacity totals and selected story points.
- Epics and Subtasks must not be added to `selectedTasks`; doing so would corrupt Planning capacity math. Keep separate status-target state for Epics and expanded Subtasks, surfaced through the clicked status menu or status-pill selected state, then build one Planning batch target list from selected Stories + selected Epics + selected Subtasks.
- Planning batch mode applies to every selected target in the composed target list. It must never silently apply to only the first issue, current page subset, or visible subset. If the target count exceeds the server cap, reject before mutating any issue.
- Set `MAX_STATUS_TRANSITION_ISSUES = 50` server-side. This creates a strict fan-out limit and avoids runaway per-issue GET/POST transition calls. The UI must show a recoverable `too_many_issues` state and ask the user to narrow selection.
- Bound the per-issue Jira fan-out for both routes; the count cap alone is not enough. A 50-issue write is up to ~101 sequential upstream calls (one batch snapshot search + up to 50 `GET .../transitions` + up to 50 `POST .../transitions`) against a per-call `timeout=30`, which risks gateway timeouts in hosted mode. Run the per-issue GET/POST calls through a bounded `ThreadPoolExecutor` (reuse the pattern already used by the stats phase-duration endpoint) with an explicit worker cap and an overall per-request time budget. Because worker threads have no Flask request context, capture `current_request_auth_context()` once in the route and pass it explicitly as `context=` into every worker call (per the no-request-context auth rule).
- Transition options are fetched on demand when the user clicks an ENG Catch Up status pill/text, clicks a Planning issue status pill/text, or when the selected Planning target set changes while a Planning status menu is open. Do not add startup transition fetches.
- The server resolves transitions by target status name at write time. Do not trust client-provided transition IDs for mutation.
- Treat an issue already in the requested target status as a success, not a failure. When `currentStatus == targetStatus` there is no transition targeting it; return a distinct per-issue `already_in_status` result counted as success in the summary and analytics, never `transition_not_available`.
- Partial success is expected when Jira workflows differ across Epics, Stories, and Subtasks. Return per-issue results and update only successfully changed items in the UI before triggering a refresh.
- After any successful transition, clear Jira-derived process caches so later task, subtask, stats, and EPM reads do not serve stale statuses.
- Analytics uses a new documented `issue_status_action` event for Catch Up and Planning submit/result interactions, and uses existing `api_result` for network reliability. Add only low-cardinality params and the new API surface; never send Jira issue keys, summaries, transition IDs, assignees, JQL, Jira URLs, account IDs, or raw error text.

## Endpoint Contracts

### `POST /api/issues/transitions/options`

| Item | Contract |
| --- | --- |
| Purpose | Read available status targets for selected ENG issue keys. |
| Auth | `authenticated_read`, but route code rejects non-OAuth with `403 jira_oauth_required`. |
| CSRF | No `X-CSRF-Token`; unsafe OAuth request still requires `X-Requested-With: jira-execution-planner`. |
| Request body | `{"issueKeys":["PROD-1","PROD-2"]}` |
| Success body | `{"issues":[{"key":"PROD-1","issueType":"Story","currentStatus":"To Do","transitions":[{"name":"Start Progress","toStatus":"In Progress"}]}],"targetStatuses":[{"name":"In Progress","availableCount":1,"blockedCount":0}]}` |
| Empty / invalid | `400 issue_keys_required`, `400 invalid_issue_key`, `400 too_many_issues`, `400 invalid_json` |
| Auth recovery | Existing `401 auth_required`, `401 missing_oauth_scope`, `401 auth_connection_stale`, or `401 auth_connection_revoked` payloads. |
| Jira errors | Per-issue unavailable transitions become `issues[].error="transitions_unavailable"` with no raw Jira body. Catastrophic Jira outage returns sanitized `502 jira_transition_options_failed`. |

### `POST /api/issues/transitions`

| Item | Contract |
| --- | --- |
| Purpose | Transition every requested ENG issue key to the requested status name. |
| Auth | `user_write`, token-bound CSRF, explicit route-level `JIRA_AUTH_MODE == atlassian_oauth` guard, and a granted-scope check returning `401 missing_oauth_scope` when the session lacks `write:jira-work`, before any Jira POST. |
| CSRF | Requires both `X-Requested-With: jira-execution-planner` and valid `X-CSRF-Token`. |
| Request body | `{"issueKeys":["PROD-1","PROD-2"],"targetStatus":"Accepted","clientMutationId":"optional-low-cardinality-id"}` |
| Success body | `{"requested":2,"succeeded":1,"failed":1,"targetStatus":"Accepted","results":[{"key":"PROD-1","result":"success","fromStatus":"To Do","toStatus":"Accepted"},{"key":"PROD-2","result":"failure","error":"transition_not_available","currentStatus":"Done"}]}` |
| HTTP status for partials | `200` with per-issue `result`. No multi-status dependency. |
| Empty / invalid | `400 issue_keys_required`, `400 target_status_required`, `400 invalid_issue_key`, `400 too_many_issues`, `400 invalid_json` |
| No mutation cases | If no requested issue has the target transition, return `200` with `succeeded=0` and per-issue `transition_not_available`; do not treat workflow mismatch as server failure. An issue whose `currentStatus` already equals `targetStatus` returns per-issue `already_in_status` counted as a success, not a failure. |
| Jira errors | Per-issue `401/403/404/409/422` become sanitized per-issue failures. Network-wide failure returns `502 jira_transition_failed` only if no issue result can be produced. |
| Cache invalidation | If `succeeded > 0`, clear Jira-derived caches before responding. |

## File Map

- Create: `backend/services/jira_issue_transitions.py` - pure issue-key normalization, transition option shaping, target-status matching, per-issue result shaping, and capped orchestration helpers.
- Modify: `backend/routes/eng_routes.py` - add the two ENG/Jira issue transition routes near existing issue routes.
- Modify: `backend/security/policy.py` - add `EndpointPolicy` entries for `/api/issues/transitions/options` and `/api/issues/transitions`.
- Modify: `jira_server.py` - add `write:jira-work` to default `ATLASSIAN_SCOPES`; expose or call a focused cache invalidation helper for successful status transitions.
- Modify: `backend/auth/jira_auth.py` - align the default `AuthConfig.scopes`.
- Modify: `.env.example` and `docs/SUPPORT-atlassian-oauth-setup.md` - document the new Jira API write scope, Developer Console permission, and required re-auth path.
- Create: `frontend/src/api/jiraIssueApi.js` - endpoint wrappers for transition options and transition execution, including CSRF fetch for writes.
- Modify: `frontend/src/api/authApi.js` only if the existing `fetchCsrfToken()` export is insufficient for the new API wrapper; do not duplicate CSRF URL logic.
- Create: `frontend/src/eng/engStatusTransitionUtils.js` - pure target composition, issue-type counts, target-status availability, result summary, source-surface, and UI label helpers.
- Create: `frontend/src/eng/useEngStatusTransitions.js` - React state for Catch Up single-issue status changes, Planning selected Epic/Subtask status targets, option loading, mutation submission, auth recovery, and result state.
- Modify: `frontend/src/eng/PlanningActionBar.jsx` - add compact Planning selected-status-target count/result feedback while preserving existing selection, undo, and open-in-Jira actions; do not add a separate status-change button.
- Modify: `frontend/src/issues/IssueCard.jsx` - make existing ENG status pills/text clickable for Catch Up/Planning Story cards and expanded Subtask rows without changing EPM cards.
- Modify: `frontend/src/dashboard.jsx` - wire the hook to Catch Up and Planning data, Epic headers, Issue cards, and refresh behavior; keep new logic in helpers/hooks and keep EPM read-only.
- Modify: `frontend/src/epm/EpmView.jsx` and `frontend/src/epm/EpmRollupPanel.jsx` - add source guards or explicit prop isolation so EPM issue cards never receive clickable-status handlers or transition props while Home/Jira-project-backed EPM remains view-only.
- Modify: `frontend/src/styles/planning.css` and `frontend/src/styles/eng.css` - add scoped clickable-status styling that preserves the current status-pill look and does not alter sticky order or EPM issue-board density.
- Modify: `frontend/src/analytics/analytics.js`, `frontend/src/analytics/dashboardAnalytics.js`, `frontend/src/analytics/events.js`, and `docs/README_ANALYTICS.md` - add the new API surface and low-cardinality `issue_status_action` params for Catch Up and Planning.
- Create: `tests/test_jira_issue_transitions.py` - backend service and route tests for options, writes, OAuth-only guard, CSRF, per-issue failures, cache invalidation, and no Basic/service credential fallback.
- Modify: `tests/test_oauth_eng_routes.py`, `tests/test_endpoint_security_matrix.py`, `tests/test_endpoint_policy_inventory.py`, and `tests/test_backend_route_source_guards.py` - route policy and OAuth guard coverage.
- Create: `tests/test_eng_status_transition_utils.js` - pure frontend target composition, source-surface gating, and result summary tests.
- Modify: `tests/test_frontend_api_source_guards.js`, `tests/test_planning_action_source_guards.js`, `tests/test_analytics_events.js`, and `tests/test_analytics_source_guards.js` - API wrapper, action-bar, analytics, and endpoint-literal guards.
- Modify or create: `tests/test_epm_view_source_guards.js` - EPM source guard coverage proving clickable status triggers and API wrappers are not wired into EPM.
- Modify: `tests/ui/planning_selection_defaults.spec.js` or create `tests/ui/eng_status_transitions.spec.js` - Catch Up and Planning interaction/visual coverage for single issue, mixed issue-type batch, partial failure, EPM read-only behavior, and sticky layout.
- Modify: `tests/test_jira_auth.py`, `tests/oauth_test_helpers.py`, and `tests/test_auth_routes.py` - default OAuth scope coverage including `write:jira-work` (also `tests/oauth_test_helpers.py::FULL_OAUTH_SCOPE`).
- Modify: `tests/test_codebase_structure_budgets.py` - ratchet the `jira_server.py` and `frontend/src/dashboard.jsx` line budgets with a justifying comment for the code this plan adds; do not exceed a budget silently. `jira_server.py` is at its budget with zero headroom and `frontend/src/dashboard.jsx` has 2 lines of headroom, so this file must be touched.
- Generated by build: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`.

## Task 0: Pre-Execution Gates

**Files:**
- Read: `AGENTS.md`
- Read: `docs/plans/AGENTS.md`
- Read: `docs/plans/README.md`
- Read: `docs/plans/GATE-05-home-write-capability.md`
- Read: `postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md`
- Read: `postmortem/MRT016-exec-02-plan-file-map-drift.md`

- [x] **Step 0.1: Verify the named file map exists or is marked Create**

Run:

```bash
rg --files | rg '^(\.env\.example|backend/routes/eng_routes.py|backend/security/policy.py|jira_server.py|backend/auth/jira_auth.py|frontend/src/eng/PlanningActionBar.jsx|frontend/src/issues/IssueCard.jsx|frontend/src/dashboard.jsx|frontend/src/epm/EpmView.jsx|frontend/src/epm/EpmRollupPanel.jsx|frontend/src/styles/planning.css|frontend/src/styles/eng.css|frontend/src/analytics/analytics.js|frontend/src/analytics/dashboardAnalytics.js|frontend/src/analytics/events.js|docs/README_ANALYTICS.md|docs/SUPPORT-atlassian-oauth-setup.md|tests/test_jira_auth.py|tests/oauth_test_helpers.py|tests/test_auth_routes.py|tests/test_oauth_eng_routes.py|tests/test_endpoint_security_matrix.py|tests/test_endpoint_policy_inventory.py|tests/test_backend_route_source_guards.py|tests/test_frontend_api_source_guards.js|tests/test_planning_action_source_guards.js|tests/test_epm_view_source_guards.js|tests/test_analytics_events.js|tests/test_analytics_source_guards.js)$'
```

Expected: every listed `Modify` file appears. If a file is missing, stop and update this plan before coding.

- [x] **Step 0.2: Recheck gates**

Run:

```bash
rg --files docs/plans | rg '/GATE-'
```

Open every returned file. For `GATE-05`, do not run the destructive Home write probe unless the required disposable Home project inputs are present and approved. If inputs remain unavailable, update only `Checked on`, `Last result`, and `Last Check Notes`, keeping it blocked.

- [x] **Step 0.3: Confirm this plan does not authorize Home writes**

Search the future diff:

```bash
rg -n 'home-update|HOME_PROJECT_UPDATE|resolve_home_credential|home_townsquare_basic|service_integration_tokens' backend frontend/src tests docs/plans/EXEC-jira-oauth-planning-status-transitions.md
```

Expected: matches only in existing gate/support docs or this plan's "do not use" language. No implementation route should call Home/Townsquare write helpers.

## Task 1: OAuth Scope And Route Policy

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/auth/jira_auth.py`
- Modify: `.env.example`
- Modify: `docs/SUPPORT-atlassian-oauth-setup.md`
- Modify: `backend/security/policy.py`
- Modify: `tests/test_jira_auth.py`
- Modify: `tests/oauth_test_helpers.py`
- Modify: `tests/test_auth_routes.py`
- Modify: `tests/test_oauth_eng_routes.py`
- Modify: `tests/test_endpoint_security_matrix.py`
- Modify: `tests/test_endpoint_policy_inventory.py`

- [x] **Step 1.1: Add failing scope tests**

Add coverage that the default scope strings include `write:jira-work` in:

```text
jira_server.ATLASSIAN_SCOPES
backend.auth.jira_auth.AuthConfig().scopes
tests.oauth_test_helpers.FULL_OAUTH_SCOPE
.env.example
docs/SUPPORT-atlassian-oauth-setup.md
```

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_auth tests.test_auth_routes
```

Expected before implementation: tests fail because `write:jira-work` is absent.

- [x] **Step 1.2: Add route policy tests**

Add policy samples:

```python
("POST", "/api/issues/transitions/options")
("POST", "/api/issues/transitions")
```

Expected policy classes:

```text
/api/issues/transitions/options -> authenticated_read
/api/issues/transitions -> user_write
```

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory
```

Expected before implementation: policy tests fail because the routes are unclassified or not sampled.

- [x] **Step 1.3: Implement scope and policy changes**

Change the default scope string everywhere the repo defines or documents it from:

```text
read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access
```

to:

```text
read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access
```

Add these policies in `backend/security/policy.py` near the existing issue routes:

```python
EndpointPolicy("jira-issue-transition-options", "/api/issues/transitions/options", frozenset({"POST"}), "authenticated_read"),
EndpointPolicy("jira-issue-transitions-write", "/api/issues/transitions", frozenset({"POST"}), "user_write"),
```

- [x] **Step 1.4: Verify scope and route guard behavior**

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_auth tests.test_auth_routes tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_oauth_eng_routes
```

Expected: pass. The write route sample must require token-bound CSRF in OAuth mode, while the options route must require `X-Requested-With` but not a CSRF token.

## Task 2: Backend Transition Service

**Files:**
- Create: `backend/services/jira_issue_transitions.py`
- Create: `tests/test_jira_issue_transitions.py`

- [x] **Step 2.1: Add pure helper tests**

Add tests for:

- Normalizing issue keys by trimming, uppercasing, de-duplicating, and preserving request order.
- Rejecting blanks and malformed keys with `invalid_issue_key`.
- Rejecting more than `MAX_STATUS_TRANSITION_ISSUES`.
- Matching a target status by normalized `transition.to.name`, not transition display name.
- Returning `transition_not_available` when no transition targets the requested status.
- Returning `already_in_status` (counted as success) when `currentStatus` already equals the requested target status.
- Shaping per-issue success/failure payloads without raw Jira response bodies.

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_transitions
```

Expected before implementation: fails because `backend.services.jira_issue_transitions` does not exist.

- [x] **Step 2.2: Implement pure helpers**

Create helpers with these public names:

```python
MAX_STATUS_TRANSITION_ISSUES = 50

class IssueTransitionInputError(ValueError):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)

def normalize_issue_keys(issue_keys):
    ...

def normalize_status_name(value):
    ...

def select_transition_for_target(transitions, target_status):
    ...

def summarize_transition_options(issue_entries):
    ...

def shape_transition_success(key, from_status, to_status):
    ...

def shape_transition_failure(key, error, current_status=None, issue_type=None):
    ...
```

Issue key validation should allow standard Jira keys with uppercase letters, digits, and hyphenated numeric suffixes after normalization. Use synthetic keys such as `PROD-1`, `TECH-22`, and `OPS2-3` in tests.

- [x] **Step 2.3: Add Jira orchestration tests**

Add tests using fake request/search functions:

- Options flow fetches issue snapshots by one batch Jira search for `summary`, `status`, and `issuetype`, then fetches transitions per issue.
- Write flow fetches current issue snapshots, fetches transitions per issue, posts only `{"transition":{"id":"<id>"}}`, and does not send `fields`, `update`, `properties`, or `historyMetadata`.
- Write flow continues after one issue fails and returns a partial success summary.
- Write flow rejects over-cap requests before making any Jira call.
- Options and write flows executed with no Flask request context still reach the real Jira auth wrapper using the passed `context`, proving worker threads do not silently fall back to Basic/service credentials (route mocks alone are not sufficient).
- An issue already in the target status returns `already_in_status` as a success without posting a transition.

- [x] **Step 2.4: Implement Jira orchestration helpers**

Add public helpers:

```python
def build_issue_snapshot_search_payload(issue_keys):
    ...

def load_issue_snapshots(issue_keys, *, search_request, context=None):
    ...

def load_transition_options(issue_keys, *, jira_request, search_request, context=None):
    ...

def transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
    ...
```

Implementation rules:

- Fetch issue snapshots by key. Prefer reusing the existing `fetch_issues_by_keys` helper (`backend/jira_client.py`), which already batches keys and scopes fields; if instead building a payload for the `current_jira_search()` wrapper directly, set `maxResults >= MAX_STATUS_TRANSITION_ISSUES`, because that wrapper hits `/rest/api/3/search/jql` and returns a single page without pagination.
- Use `current_jira_request("GET", f"/rest/api/3/issue/{key}/transitions", context=context)` for transitions.
- Use `current_jira_request("POST", f"/rest/api/3/issue/{key}/transitions", json_body={"transition":{"id": transition_id}}, context=context)` for writes.
- Run the per-issue GET/POST calls through a bounded `ThreadPoolExecutor` with an explicit worker cap, and pass `context=` into every worker so contextless threads still authenticate as the signed-in user. Do not fan out unbounded.
- Do not call `build_jira_headers()`, `requests`, Home/Townsquare helpers, or service integrations.
- Return sanitized per-issue errors for Jira `400`, `401`, `403`, `404`, `409`, and `422`.

- [x] **Step 2.5: Verify backend service**

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_transitions
```

Expected: pass.

## Task 3: Flask Routes And Cache Invalidation

**Files:**
- Modify: `backend/routes/eng_routes.py`
- Modify: `jira_server.py`
- Modify: `tests/test_jira_issue_transitions.py`
- Modify: `tests/test_oauth_eng_routes.py`
- Modify: `tests/test_backend_route_source_guards.py`

- [x] **Step 3.1: Add route tests before implementation**

Cover:

- `POST /api/issues/transitions/options` returns available statuses in OAuth mode with `X-Requested-With`.
- Options route rejects Basic mode with `403 jira_oauth_required`.
- `POST /api/issues/transitions` rejects missing `X-Requested-With` before route code.
- Write route rejects missing `X-CSRF-Token` before route code.
- Write route rejects Basic mode with `403 jira_oauth_required` after CSRF requirements are satisfied only when OAuth mode is not active.
- Write route uses `current_request_auth_context()` and passes that context into service helpers.
- Write route does not call `build_jira_headers()`.
- Write route returns `401 missing_oauth_scope` when the OAuth session lacks `write:jira-work`, before any Jira POST.
- Successful write calls `clear_jira_issue_status_caches()` exactly once.

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_transitions tests.test_oauth_eng_routes
```

Expected before route implementation: fails because the routes do not exist.

- [x] **Step 3.2: Add focused cache invalidation helper**

Reuse the existing cache clearers instead of re-typing the task/scenario clearing (which would also add lines to the zero-headroom `jira_server.py`). `clear_auth_sensitive_caches(reason=...)` (`jira_server.py:1857`) already clears `TASKS_CACHE`, `MISSING_INFO_CACHE`, `DEPENDENCIES_CACHE`, `EPIC_COHORT_CACHE`, `EXCLUDED_CAPACITY_STATS_SOURCE_CACHE`, `EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE`, and resets `SCENARIO_CACHE`. `clear_epm_caches()` (`jira_server.py:1846`) clears only the EPM caches. Neither clears `SUBTASKS_CACHE`.

Prefer a thin helper that composes them:

```python
def clear_jira_issue_status_caches(reason='issue_status_transition'):
    clear_auth_sensitive_caches(reason=reason)
    clear_epm_caches()
    try:
        from backend.routes.eng_routes import SUBTASKS_CACHE
        SUBTASKS_CACHE.clear()
    except Exception:
        log_warning(f'Unable to clear subtask cache after {reason}')
```

If adding this helper to `jira_server.py` would exceed its line budget, define it in `backend/routes/eng_routes.py` (unbudgeted) instead, resolving `clear_auth_sensitive_caches`/`clear_epm_caches` from the injected server globals. If importing `SUBTASKS_CACHE` from the route module creates a cycle during tests, move the cache object to a focused service module and update the plan before continuing.

Note: these clearers wipe caches for all users/workspaces, so a successful transition in hosted multi-user mode forces a refetch on the next read for every user. This matches existing auth-context-change behavior and is correctness-safe, but keep the Task 2 fan-out cap in mind so a batch does not amplify the refetch cost (MRT010).

- [x] **Step 3.3: Implement routes**

Add routes to `backend/routes/eng_routes.py`:

```python
@bp.route('/api/issues/transitions/options', methods=['POST'])
def get_issue_transition_options():
    ...

@bp.route('/api/issues/transitions', methods=['POST'])
def post_issue_transitions():
    ...
```

Route rules:

- Parse JSON with `silent=True`; reject non-object bodies with `400 invalid_json`.
- Call `current_request_auth_context()` once and pass the context explicitly.
- Return `403 {"error":"jira_oauth_required"}` when `JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH`.
- On the write route, after the OAuth-mode guard, return `401 missing_oauth_scope` when the session's granted scopes do not include `write:jira-work`, before resolving or posting any transition.
- Convert `IssueTransitionInputError.code` to documented `400` payloads.
- Convert `AuthError` through the existing `_eng_auth_error_response()`.
- Return sanitized `502` only for unexpected upstream failure that prevents per-issue results.
- On write success with `succeeded > 0`, call `clear_jira_issue_status_caches()`.

- [x] **Step 3.4: Add source guards**

Guard that:

- `backend/routes/eng_routes.py` contains both route decorators.
- `backend/services/jira_issue_transitions.py` does not import `requests`, `backend.epm`, `service_integration`, or call `build_jira_headers`.
- `backend/security/policy.py` has the exact two endpoint policies.

- [x] **Step 3.5: Verify backend routes**

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_transitions tests.test_oauth_eng_routes tests.test_backend_route_source_guards tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory
```

Expected: pass.

## Task 4: Frontend API And Analytics Contract

**Files:**
- Create: `frontend/src/api/jiraIssueApi.js`
- Modify: `frontend/src/analytics/analytics.js`
- Modify: `frontend/src/analytics/dashboardAnalytics.js`
- Modify: `frontend/src/analytics/events.js`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/test_analytics_events.js`
- Modify: `tests/test_analytics_source_guards.js`

- [x] **Step 4.1: Add failing API wrapper tests**

Add tests proving:

- `fetchIssueTransitionOptions(backendUrl, issueKeys, { signal })` posts to `/api/issues/transitions/options` with JSON body and `X-Requested-With`.
- `transitionIssues(backendUrl, payload, { signal })` first fetches `/api/auth/csrf`, then posts to `/api/issues/transitions` with `X-CSRF-Token` and `X-Requested-With`.
- Both wrappers use `trackedFetch` with `apiSurface='jira_issue_transitions'` and `featureName='eng_status_transitions'`.

Run:

```bash
node --test tests/test_frontend_api_source_guards.js
```

Expected before implementation: fails because `jiraIssueApi.js` does not exist.

- [x] **Step 4.2: Implement API wrappers**

Create `frontend/src/api/jiraIssueApi.js`:

```js
import { fetchCsrfToken } from './authApi.js';
import { json, trackedFetch } from './http.js';

const headers = (csrfToken = '') => ({
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
});

export function fetchIssueTransitionOptions(backendUrl, issueKeys, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions/options`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(),
        body: JSON.stringify({ issueKeys }),
    }, { featureName: 'eng_status_transitions' }).then(response => json(response, 'Issue transition options'));
}

export async function transitionIssues(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_status_transitions' }).then(response => json(response, 'Issue transition'));
}
```

- [x] **Step 4.3: Add analytics contract tests**

Add `jira_issue_transitions` to the `api_result` allowlist and add `issue_status_action` as a canonical low-cardinality user event:

```text
workflow_action = status_options_open | status_change_submit | status_change_result
source_surface = catch_up | planning
status_bucket = selected target status bucket, not raw Jira status
selected_count_bucket
selected_sp_bucket
issue_type_mix = stories | epics | subtasks | mixed
result = success | partial | failure
```

If `issue_type_mix`, `source_surface`, or `status_bucket` is new, add it to `EVENT_PARAMS` with safe enum validation and tests. Do not add custom dimensions or GTM triggers.

- [x] **Step 4.4: Update analytics docs**

In `docs/README_ANALYTICS.md`, add the `issue_status_action` row for Catch Up and Planning status changes. Update the `api_result` row or no-event allowlist to state `api_surface=jira_issue_transitions` sends only `feature_name=eng_status_transitions`, source surface, status buckets, issue type mix, result, count buckets, and duration buckets.

- [x] **Step 4.5: Verify API and analytics**

Run:

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
```

Expected: pass.

## Task 5: ENG Status Target State

**Files:**
- Create: `frontend/src/eng/engStatusTransitionUtils.js`
- Create: `frontend/src/eng/useEngStatusTransitions.js`
- Create: `tests/test_eng_status_transition_utils.js`
- Modify: `tests/test_planning_action_source_guards.js`
- Modify or create: `tests/test_epm_view_source_guards.js`

- [ ] **Step 5.1: Add pure utility tests**

Cover:

- `isStatusTransitionSurfaceEnabled()` returns true only for ENG Catch Up and ENG Planning, and false for EPM, Stats, Scenario, Settings, and unknown surfaces.
- `buildCatchUpStatusTargets(issue)` returns one target for an Epic, Story, or expanded Subtask.
- `buildEngStatusTargets()` returns selected Planning Story targets from `selectedTasksList`.
- Selected Planning Epics and selected Planning Subtasks are included separately and do not affect selected story-point totals.
- Duplicate issue keys collapse once with deterministic type precedence: Epic, Story, Subtask.
- `summarizeIssueTypeMix()` returns `stories`, `epics`, `subtasks`, or `mixed`.
- `summarizeTransitionResults()` returns success/partial/failure counts without raw issue details.
- `buildStatusBucket()` maps status names to low-cardinality buckets such as `todo`, `accepted`, `in_progress`, `done`, `blocked`, `postponed`, `other`.

Run:

```bash
node --test tests/test_eng_status_transition_utils.js
```

Expected before implementation: fails because the file does not exist.

- [ ] **Step 5.2: Implement pure utilities**

The target shape used by the hook and UI should be:

```js
{
    key: 'PROD-1',
    issueType: 'Story',
    currentStatus: 'To Do',
    summary: 'Synthetic summary'
}
```

Do not include assignee, Jira URLs, team names, raw sprint names, or JQL in analytics payload builders.

- [ ] **Step 5.3: Add hook source guards**

Guard that `useEngStatusTransitions.js`:

- imports `fetchIssueTransitionOptions` and `transitionIssues` from `../api/jiraIssueApi.js`;
- imports `authRecoveryLoginUrl` and `redirectToAuthRecovery` from `./useEngSprintData.js`;
- aborts in-flight option requests when target signature changes;
- calls `trackIssueStatusAction('status_change_submit', ...)` before mutation;
- sends `source_surface='catch_up'` for Catch Up controls and `source_surface='planning'` for Planning controls;
- calls refresh callbacks only after `succeeded > 0`;
- never mutates `selectedTasks` for Epics or Subtasks;
- exports no EPM helper and imports no `frontend/src/epm` module.

- [ ] **Step 5.4: Implement hook**

The hook should own:

```js
{
    sourceSurface,
    selectedEpicStatusTargets,
    selectedSubtaskStatusTargets,
    activeSingleIssueTarget,
    openSingleIssueStatusControl,
    closeSingleIssueStatusControl,
    toggleEpicStatusTarget,
    toggleSubtaskStatusTarget,
    clearNonStoryStatusTargets,
    transitionOptions,
    transitionOptionsLoading,
    transitionError,
    transitionResult,
    loadTransitionOptions,
    submitStatusTransition,
}
```

Inputs should include `backendUrl`, `selectedStories`, `epicGroups`, `storySubtasksByKey`, `selectedSprint`, `sourceSurface`, `trackIssueStatusAction`, `onAuthRecoveryRequired`, and `onTransitionSuccessRefresh`.

For Catch Up, `submitStatusTransition()` must accept one explicit target key and must not read or mutate Planning selection state. For Planning, `submitStatusTransition()` must build the composed target set from selected Stories, selected Epics, and selected Subtasks.

- [ ] **Step 5.5: Verify utility and source guards**

Run:

```bash
node --test tests/test_eng_status_transition_utils.js tests/test_planning_action_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: pass.

## Task 6: ENG Catch Up And Planning UI Wiring

**Files:**
- Modify: `frontend/src/eng/PlanningActionBar.jsx`
- Modify: `frontend/src/issues/IssueCard.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/epm/EpmView.jsx`
- Modify: `frontend/src/epm/EpmRollupPanel.jsx`
- Modify: `frontend/src/styles/planning.css`
- Modify: `frontend/src/styles/eng.css`
- Modify: `tests/test_planning_action_source_guards.js`
- Modify or create: `tests/test_epm_view_source_guards.js`
- Modify or create: `tests/ui/eng_status_transitions.spec.js`

- [ ] **Step 6.1: Add UI tests before implementation**

Use synthetic fixtures only. Cover:

- Catch Up Epic headers render the existing status pill/text as a button-like menu trigger for the Epic when `selectedView === 'eng'` and Planning/Stats/Scenario are closed.
- Catch Up Story cards render the existing status pill/text as a button-like menu trigger for the Story.
- Catch Up expanded Subtask rows render the existing status pill/text as a button-like menu trigger for the Subtask.
- Catch Up has no separate visible "Change status" button beside the status pill/text.
- Catch Up status change sends exactly one issue key in the mutation body.
- Planning action bar shows selected-status-target count/result feedback when at least one Story is selected; it does not add a separate status-change button.
- Planning Story status pills/text open the status menu. When multiple status targets are selected, the menu's primary submit applies to the composed selected target set.
- Planning Epic status pills/text open the status menu for the Epic and can mark the Epic as included in the selected status-target set without toggling excluded capacity.
- Planning expanded Subtask status pills/text open the status menu for the Subtask and can mark the Subtask as included in the selected status-target set without affecting Story selected SP.
- Batch status change sends all selected Story + Epic + Subtask keys in one request body.
- Partial success shows a visible result summary and leaves failed issue statuses unchanged.
- `too_many_issues` shows a recoverable error and sends no mutation request.
- EPM project boards render inert status pills/text, pass no status-transition props into `IssueCard`, and make no `/api/issues/transitions` or `/api/issues/transitions/options` request when EPM issue cards render.
- Stats and Scenario views render inert status pills/text.
- Sticky order remains `planning-panel.open` above `.epic-header`; no Catch Up or Planning status menu overlaps the clicked status or header incoherently.

Run:

```bash
npx playwright test tests/ui/eng_status_transitions.spec.js
```

Expected before implementation: fails because the controls do not exist.

- [ ] **Step 6.2: Extend status-pill trigger and Planning feedback props**

Add compact props to the Epic header renderer and `IssueCard` where the current status is already rendered:

```js
statusTransitionEnabled
statusTransitionTargetsCount
statusTransitionOptions
statusTransitionLoading
statusTransitionSubmitting
statusTransitionError
statusTransitionResult
onOpenStatusTransitionOptions
onSubmitStatusTransition
```

Add compact feedback-only props to `PlanningActionBar`:

```js
statusTransitionTargetsCount
statusTransitionSubmitting
statusTransitionError
statusTransitionResult
```

UI rules:

- Use the existing status pill/text as the visible trigger. Preserve current status-pill sizing, casing, color semantics, and placement.
- Use a native `select` or existing menu pattern for target status names inside the popover anchored to the clicked status.
- Disable submit when no targets, no target status, options loading, submitting, or over cap.
- Keep `Accepted`, `To Do`, `Postponed`, `Awaiting Val.`, `Select All`, `Undo`, `Clear Selected`, and Jira external-link behavior intact.
- Do not add a separate "Change status" button next to Epic, Story, Subtask, or Planning action-bar content.
- Do not introduce a large modal unless the menu cannot show partial availability accessibly.

- [ ] **Step 6.3: Wire Catch Up status-pill triggers**

In `dashboard.jsx` Epic headers and `IssueCard.jsx`:

- Enable clickable status only when `selectedView === 'eng' && !showPlanning && !showStats && !showScenario`.
- Make the Epic header's current status pill/text open transition options for that Epic only.
- Make the Story card's current status pill/text in `IssueCard` open transition options for that Story only.
- Make the expanded-Subtask row's current status pill/text in `IssueCard` open transition options for that Subtask only.
- Keep links, labels, alerts, and existing status pills in their current layout positions; only the status pill/text becomes interactive.
- Do not render clickable status when the same `IssueCard` component is used by EPM.

- [ ] **Step 6.4: Wire Planning status-pill triggers and batch status targets**

In `dashboard.jsx` Epic headers:

- Make the Planning Epic current status pill/text open the status menu.
- Let the menu mark the Epic as included/excluded from the selected status-target set without toggling excluded capacity.
- Keep the excluded-capacity control separate from links, label pills, and clicked status pills.
- Do not nest anchors inside buttons or buttons inside anchors.

In `IssueCard.jsx`:

- Story status pills/text open the status menu; selected Stories are included in the batch target set because the existing Planning checkbox already selects the Story.
- Expanded Subtask status pills/text open the status menu and let the menu mark the Subtask as included/excluded from the selected status-target set because Subtasks must not affect Story selected SP.
- When multiple status targets are selected, the opened menu makes `Apply to selected targets (N)` the primary action and still allows applying only to the clicked issue.

- [ ] **Step 6.5: Keep EPM read-only while Home is gated**

In `EpmView.jsx` and `EpmRollupPanel.jsx`:

- Do not pass `statusTransition*`, `onOpenStatusTransitionOptions`, `onSubmitStatusTransition`, or `sourceSurface='epm'` props into `IssueCard`.
- If `IssueCard` grows status-transition props, default them to disabled and require an explicit ENG-only surface guard before making any status pill/text clickable.
- Add a source guard that fails if EPM imports `jiraIssueApi.js`, `useEngStatusTransitions.js`, or renders text/test ids associated with status transition menus.

- [ ] **Step 6.6: Wire refresh after success**

On `succeeded > 0`:

- Refresh ENG task data for the current Catch Up or Planning scope.
- Clear local transition options/results when the selected sprint or group changes.
- Keep failed target selection intact so the user can retry or open Jira.
- Do not force a full dashboard reload.

- [ ] **Step 6.7: Verify UI and sticky behavior**

Run:

```bash
npx playwright test tests/ui/eng_status_transitions.spec.js
npx playwright test tests/ui/planning_selection_defaults.spec.js
```

Expected: pass. Screenshots should show Catch Up, Planning expanded, Planning collapsed, and EPM board states after transitions/animations settle.

## Task 7: Full Verification And Build

**Files:**
- Modify: `tests/test_codebase_structure_budgets.py`
- Generated by build: `frontend/dist/dashboard.js`
- Generated by build: `frontend/dist/dashboard.js.map`
- Generated by build: `frontend/dist/dashboard.css`
- Inspect: `docs/plans/README.md`

- [ ] **Step 7.1: Run focused backend tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_jira_issue_transitions tests.test_oauth_eng_routes tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards
```

Expected: pass.

- [ ] **Step 7.2: Run focused frontend tests**

Run:

```bash
node --test tests/test_eng_status_transition_utils.js tests/test_frontend_api_source_guards.js tests/test_planning_action_source_guards.js tests/test_epm_view_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
```

Expected: pass.

- [ ] **Step 7.3: Build frontend**

Run:

```bash
npm run build
```

Expected: pass and generated `frontend/dist/` changes match source changes.

- [ ] **Step 7.4: Run visual/interaction tests**

Run:

```bash
npx playwright test tests/ui/eng_status_transitions.spec.js tests/ui/planning_selection_defaults.spec.js
```

Expected: pass with desktop and mobile screenshots where clicked status menus do not overlap Catch Up, Planning, Epic headers, Story cards, Subtask rows, or EPM issue boards.

- [ ] **Step 7.5: Ratchet structure budgets if entrypoints grew**

`tests/test_codebase_structure_budgets.py` pins `jira_server.py` (currently at its budget, zero headroom) and `frontend/src/dashboard.jsx` (2 lines of headroom). Keep new backend route code in `backend/routes/eng_routes.py` (unbudgeted) and compose the cache helper from the existing clearers so `jira_server.py` does not grow. Task 6 wiring grows `dashboard.jsx`, so raise its `LEGACY_ENTRYPOINT_LINE_BUDGETS` value to the new line count and add a `# <branch>: <reason>` justifying comment matching the existing convention. Do not exceed a budget without a comment.

Run:

```bash
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
```

Expected: pass.

- [ ] **Step 7.6: Run full test suite before push**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
node --test tests/*.js
```

Expected: pass. If the full suite exposes unrelated existing failures, capture exact failing tests and rerun all tests touched by this plan before asking for direction.

- [ ] **Step 7.7: Server startup gate**

Because this changes auth/startup scope defaults, run:

```bash
.venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python jira_server.py
```

Then in another terminal:

```bash
curl http://localhost:5050/api/test
```

Expected: Flask starts without dependency/runtime warnings before the startup banner, and `/api/test` returns a successful JSON response.

## Acceptance Checklist

- [ ] Catch Up mode can change status for one Epic through signed-in-user Jira OAuth.
- [ ] Catch Up mode can change status for one Story through signed-in-user Jira OAuth.
- [ ] Catch Up mode can change status for one expanded Subtask through signed-in-user Jira OAuth.
- [ ] Planning mode can change status for one selected Story through signed-in-user Jira OAuth.
- [ ] Planning mode can include an Epic in status targets and transition it without affecting selected story points.
- [ ] Planning mode can include an expanded Subtask in status targets and transition it without affecting selected story points.
- [ ] Batch mode sends every selected Story, Epic, and Subtask target in one request and never silently truncates the selection.
- [ ] EPM remains view-only while `GATE-05` is blocked: EPM status pills/text are inert, no EPM transition API calls occur, and no EPM mutation routes exist.
- [ ] Status pills/text are inert in Stats, Scenario, Settings, and unknown/non-ENG surfaces.
- [ ] The server rejects over-cap batches before any mutation.
- [ ] The write route requires OAuth mode, `X-Requested-With`, token-bound CSRF, and the signed-in user's Jira OAuth token.
- [ ] The implementation never uses Jira Basic credentials, service integrations, Home/Townsquare credentials, or local token-store helpers for the mutation.
- [ ] Transition IDs are resolved by the backend at write time from Jira transitions available to the user.
- [ ] An issue already in the requested status is reported as `already_in_status` success, not failure.
- [ ] Per-issue Jira transition GET/POST calls are bounded by a worker cap and carry request-scoped auth context, proven by a no-request-context test.
- [ ] The write route returns `401 missing_oauth_scope` before any Jira POST when the session lacks `write:jira-work`.
- [ ] Structure budgets pass: `frontend/src/dashboard.jsx` budget is ratcheted with a justifying comment and `jira_server.py` did not grow.
- [ ] Per-issue failures are visible and retryable without hiding successful transitions.
- [ ] Jira-derived caches are invalidated after successful transitions.
- [ ] Analytics sends no issue keys, summaries, transition IDs, JQL, Jira URLs, assignees, emails, account IDs, tokens, or raw Jira error text.
- [ ] `npm run build` regenerates `frontend/dist/` and leaves no post-build diff beyond committed generated output.
- [ ] Catch Up, Planning, and EPM layouts are visually verified; Planning sticky layout is verified in collapsed and expanded Epic states.

## Plan Self-Review

- Spec coverage: The plan covers OAuth scope authorization, backend transition option/write routes, Catch Up per-issue UI for Epics/Stories/Subtasks, Planning UI for Epics/Stories/Subtasks, batch behavior for all selected targets, EPM read-only guards while Home is gated, analytics, docs, cache invalidation, and verification.
- Placeholder scan: No task depends on an unspecified file or route. New files are marked `Create`; existing files are marked `Modify`. `tests/test_codebase_structure_budgets.py` is in the file map because `jira_server.py` sits at its line budget and `frontend/src/dashboard.jsx` has 2 lines of headroom; the plan keeps backend growth in `eng_routes.py`, composes the cache helper from existing clearers, and ratchets the `dashboard.jsx` budget in Task 7.
- Runtime feasibility: per-issue transition GET/POST calls are bounded by `MAX_STATUS_TRANSITION_ISSUES` and a `ThreadPoolExecutor` worker cap with request-scoped auth context; a no-request-context test proves worker threads do not fall back to Basic/service credentials.
- Type consistency: The plan consistently uses `issueKeys`, `targetStatus`, `currentStatus`, `targetStatuses`, `sourceSurface`, `selectedEpicStatusTargets`, `selectedSubtaskStatusTargets`, `issue_status_action`, and `jira_issue_transitions`.
- Scope control: The plan does not implement Home/Townsquare writes, Scenario write-back, EPM mutation routes, clickable EPM status, generic Jira edit fields, Jira comments, assignment, issue properties, or workflow configuration.
