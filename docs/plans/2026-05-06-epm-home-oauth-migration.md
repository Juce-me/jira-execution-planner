# Atlassian OAuth Migration Plan, Part 2: EPM/Home Routes

> **Execution note:** Implement this plan task-by-task in order. Steps use checkbox (`- [ ]`) syntax for tracking. This is Part 2 of the singular Atlassian OAuth migration plan; start only after Part 1 final verification passes. Do not use a secondary worktree for this repo.

**Goal:** Keep EPM/Home routes guarded while Home/Townsquare user 3LO is unsupported. Jira REST remains user-OAuth-backed; Home/Townsquare metadata remains server-side service-credential-backed until a fresh real Home GraphQL probe proves user 3LO works.

**Architecture:** Keep Part 1's Jira REST boundary as the only path for Jira issue search and field lookup. Do not use a user's Jira OAuth access token for Home/Townsquare GraphQL while the Home GraphQL gate is `FAIL home_graphql_3lo_unsupported`. The current executable path is database-backed users plus admin-managed `home_townsquare_basic` service integration credentials; Home metadata is app/workspace-scoped service data, and Jira issue/rollup data is constrained by the signed-in user's Jira OAuth permissions. The user-3LO route migration tasks later in this file are dormant unless a fresh real probe returns PASS before DB auth lands. If DB auth has landed, those tasks must be rewritten to use DB `RequestAuthContext`, encrypted `auth_tokens`, DB refresh locking, and revoked/disabled-user checks before execution.

**Tech Stack:** Python, Flask, unittest, React 19, esbuild, Atlassian OAuth 2.0 3LO, Atlassian Home/Townsquare GraphQL.

---

## Migration Plan Structure

Use these two files as one ordered migration plan:

1. Part 1: `docs/plans/2026-05-05-oauth-jira-client-route-migration.md`
   - Must be implemented and verified before this file starts.
   - Provides the Jira REST OAuth client boundary that this Part 2 plan depends on.
2. Part 2, this file: `docs/plans/2026-05-06-epm-home-oauth-migration.md`
   - Starts with a real Home/Townsquare GraphQL OAuth feasibility gate.
   - Stops before user-3LO route migration if the gate fails.
   - Hands Home/Townsquare route work to the DB auth service-integration path while the gate fails.
   - Migrates EPM/Home routes through user 3LO only after the gate passes and only before DB auth lands; after DB auth lands, use the DB auth boundary instead of local OAuth token-store helpers.

Execute Part 2 tasks in order. Do not run Part 2 implementation in parallel with unfinished Part 1 work because the EPM rollup tasks depend on Part 1's `current_jira_get` and `current_jira_search` boundary.

## Implementation Status Reconciliation

Status as of 2026-05-07: this is the canonical Home/Townsquare 3LO migration plan. The older same-dated Home/Townsquare readiness plan has been deleted; do not recreate or execute a parallel migration.

- Part 2 Task 1's local feasibility helper, local dev probe route, wrapper script, and unit tests already exist in the checkout.
- The latest documented local Home GraphQL gate result in `docs/atlassian-oauth-setup.md` is `FAIL home_graphql_3lo_unsupported`, so Home/Townsquare-backed EPM routes must remain guarded with `route_not_oauth_ready` until either a real local probe produces `PASS` or the DB auth plan introduces an admin-managed service-integration route design.
- `current_home_graphql_client`, `current_teamwork_graph_client`, and `OAUTH_READY_API_PATH_PATTERNS` do not exist yet. Task 1A and Tasks 2 through 9 remain unimplemented.
- `backend/routes/epm_routes.py` already calls `fetch_issues_by_jql(jql, build_epm_fields_list())` for `GET /api/epm/projects/<home_project_id>/issues`. Do not reintroduce `build_jira_headers()` in that route; Task 6 should verify the existing no-header call and finish the OAuth boundary, auth-error, cache, and dynamic route-readiness work.
- Any Home/Townsquare-backed or Jira-project-backed mutation must have a tool-admin or service-account guard before it is marked OAuth-ready. `docs/plans/2026-05-05-database-introduction-user-auth.md` Task 0 is the single implementation owner for the pre-DB shared-config tool-admin gate; this plan only verifies that gate unless it adds a new persistent Home mutation.

## Part 2 Route Surface Review

Part 1 now lists the full EPM route surface and keeps Home-backed EPM routes guarded. Part 2 owns the migration details for that surface:

- `POST /api/epm/projects/preview` is an alias of `POST /api/epm/projects/configuration` in `backend/routes/epm_routes.py`; migrate and test both names.
- `GET /api/epm/projects/<home_project_id>/issues` currently performs Jira issue search through `fetch_issues_by_jql(jql, build_epm_fields_list())`; verify that helper uses the Part 1 Jira REST boundary and do not add a Basic header argument back.
- `GET /api/epm/projects/rollup/all` performs Home project discovery plus per-project Jira rollups, while `GET /api/epm/projects/<project_id>/rollup` performs one Home/custom project lookup plus Jira rollup queries; test them separately.
- Dynamic EPM issue and rollup routes need explicit OAuth-ready pattern matching before they can work under OAuth.
- `GET /api/epm/config` and `POST /api/epm/config` are local configuration routes. Part 1 may already migrate them with local config routes; Part 2 keeps EPM-specific regression coverage.

## Documentation Evidence And Non-Doc Gate

- Atlassian Jira Cloud REST docs say OAuth 2.0 3LO REST calls use `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/<resource-name>`; Basic REST calls use the tenant site URL. See <https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/>.
- Atlassian Jira OAuth docs describe rotating refresh tokens and `offline_access`; the Home boundary must reuse Part 1's server-side refresh locking and must not expose token material. See <https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/>.
- Atlassian GraphQL docs say OAuth clients use `https://api.atlassian.com/graphql`, while browser sessions and API tokens use tenant or product gateway URLs such as `https://team.atlassian.com/gateway/api/graphql`. The current code uses `https://team.atlassian.com/gateway/api/graphql` and `{siteUrl}/gateway/api/graphql/twg`, so docs are not enough. See <https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/>.
- Atlassian GraphQL docs also state beta fields require `X-ExperimentalApi: <betaName>`. The current Home client sends `X-ExperimentalApi: Townsquare`, so the OAuth probe must preserve that header.

This plan therefore requires a real local OAuth-session test before any Home-backed EPM route is marked OAuth-ready. Do not "fix" the endpoint to `https://api.atlassian.com/graphql` in this plan; first probe the exact Home and TWG endpoints the current code uses.

## Files Map

- Modify: `backend/epm/home.py` for the Home GraphQL client boundary, OAuth-vs-Basic header creation, Home/TWG endpoint selection, and exact-query feasibility helpers.
- Modify: `backend/epm/projects.py` only where context/cache handling needs to be explicit for OAuth isolation.
- Modify: `backend/epm/rollup.py` to remove `build_jira_headers` from OAuth-ready rollup paths and call the Jira REST boundary.
- Modify: `backend/routes/epm_routes.py` to add route-level `AuthError` handling, use Home/Jira boundaries, preserve `Server-Timing`, and keep unsafe methods behind OAuth CSRF.
- Modify: `jira_server.py` to add dynamic OAuth-ready path matching for EPM project issue/rollup routes, expose the Home boundary callbacks, and remove `build_jira_headers` from migrated EPM dependencies.
- Modify: `frontend/src/api/epmApi.js` so EPM POST helpers send `X-Requested-With: jira-execution-planner`.
- Verify: `frontend/src/dashboard.jsx` keeps the Part 1 EPM config save `X-Requested-With: jira-execution-planner` header and does not add dashboard-owned auth UI or token handling.
- Create: `scripts/check_home_graphql_oauth.py` for the local Home GraphQL OAuth feasibility probe helper.
- Create: `tests/test_epm_home_oauth_client.py` for Home boundary tests.
- Create: `tests/test_epm_home_oauth_feasibility.py` for probe construction and redaction tests.
- Create: `tests/test_oauth_epm_config_routes.py` for local EPM config OAuth/Basic behavior.
- Create: `tests/test_oauth_epm_settings_routes.py` for EPM settings Home workflow OAuth/Basic behavior.
- Create: `tests/test_oauth_epm_projects_routes.py` for EPM Home project discovery OAuth/Basic behavior.
- Create: `tests/test_oauth_epm_rollup_routes.py` for EPM issue and rollup OAuth/Basic behavior.
- Create: `tests/test_epm_home_oauth_source_guard.py` for backend EPM/Home auth source guards.
- Modify: `tests/test_auth_isolation_source_guard.js` to keep frontend/dashboard token and auth UI guards while allowing CSRF headers.

## Route Coverage Matrix

Do not add a route to `OAUTH_READY_API_PATHS` or an OAuth-ready dynamic path matcher until the named OAuth test and the listed Basic compatibility test pass. While the Home GraphQL gate remains failed, this matrix is not permission to migrate Home-backed routes through user OAuth; use it only as route inventory for the later service-integration or PASS-gated user-3LO design.

| Route | Owning task | Named OAuth test | Named Basic compatibility test | Home GraphQL boundary mocked | Jira REST boundary mocked | Expired-auth behavior | CSRF behavior for unsafe methods | Cache policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/epm/config` | Part 1 Task 4 / Part 2 Task 3 regression | `OAuthEpmConfigRouteTests.test_get_epm_config_is_oauth_ready_without_home_or_jira` | `BasicEpmConfigRouteTests.test_get_epm_config_basic_mode_returns_saved_config` | N/A | N/A | `401 auth_required` with `loginUrl` before local config if OAuth session is missing/stale | N/A | Local file only; clears no Home/Jira cache |
| `POST /api/epm/config` | Part 1 Task 4 / DB auth Task 0 / Part 2 Task 3 regression | `OAuthEpmConfigRouteTests.test_post_epm_config_requires_csrf_header_in_oauth_mode`, `PreDbToolAdminGateTests.test_epm_config_post_requires_tool_admin`, and a tool-admin-save regression | `BasicEpmConfigRouteTests.test_post_epm_config_basic_mode_does_not_require_csrf_header` | N/A | N/A | `401 auth_required` with `loginUrl` before save if OAuth session is missing/stale; `403 admin_required` for non-tool-admin OAuth users once the pre-DB tool-admin gate lands | Requires `X-Requested-With: jira-execution-planner` in OAuth before DB auth; DB auth upgrades to token-bound CSRF | Clears EPM project and rollup caches exactly as current route does |
| `GET /api/epm/scope` | Part 2 Task 4 | `OAuthEpmSettingsRouteTests.test_scope_route_uses_oauth_cloud_id_without_tenant_info_fetch` | `BasicEpmSettingsRouteTests.test_scope_route_basic_uses_existing_tenant_info_lookup` | N/A for GraphQL; uses session cloud ID in OAuth | N/A | `401 auth_required` with `loginUrl` if session missing/stale | N/A | No process-global `_CLOUD_ID_CACHE` read/write in OAuth; Basic cache unchanged |
| `GET /api/epm/goals` | Part 2 Task 4 | `OAuthEpmSettingsRouteTests.test_goals_route_uses_oauth_home_client_for_catalog` and `OAuthEpmSettingsRouteTests.test_goals_route_uses_oauth_home_client_for_sub_goals` | `BasicEpmSettingsRouteTests.test_goals_route_basic_uses_basic_home_client` | `current_home_graphql_client` / fake Home client | N/A | `401 auth_required` with `loginUrl` when Home client raises `AuthError("auth_required")` | N/A | OAuth bypasses `_GOAL_BY_KEY_CACHE`; Basic cache unchanged |
| `GET /api/epm/projects` | Part 2 Task 5 | `OAuthEpmProjectsRouteTests.test_projects_route_uses_oauth_home_client_and_preserves_server_timing` | `BasicEpmProjectsRouteTests.test_projects_route_basic_reuses_process_home_project_cache` | `current_home_graphql_client` / fake Home project fetcher | N/A | `401 auth_required` with `loginUrl` when Home client raises `AuthError("auth_required")` | N/A | OAuth bypasses `EPM_PROJECTS_CACHE`; Basic process cache unchanged |
| `POST /api/epm/projects/configuration` | Part 2 Task 4 | `OAuthEpmSettingsRouteTests.test_projects_configuration_uses_oauth_home_client_with_csrf_header` and `OAuthEpmSettingsRouteTests.test_projects_configuration_requires_csrf_header_in_oauth_mode` | `BasicEpmSettingsRouteTests.test_projects_configuration_basic_mode_does_not_require_csrf_header` | `current_home_graphql_client` / fake Home project fetcher | N/A | `401 auth_required` with `loginUrl` when Home client raises `AuthError("auth_required")` | Requires `X-Requested-With: jira-execution-planner` in OAuth; Basic does not require it | OAuth bypasses `EPM_PROJECTS_CACHE`; Basic process cache unchanged |
| `POST /api/epm/projects/preview` | Part 2 Task 4 | `OAuthEpmSettingsRouteTests.test_projects_preview_uses_oauth_home_client_with_csrf_header` and `OAuthEpmSettingsRouteTests.test_projects_preview_requires_csrf_header_in_oauth_mode` | `BasicEpmSettingsRouteTests.test_projects_preview_basic_mode_does_not_require_csrf_header` | `current_home_graphql_client` / fake Home project fetcher | N/A | Same as configuration route | Requires `X-Requested-With: jira-execution-planner` in OAuth; Basic does not require it | Same as configuration route |
| `GET /api/epm/projects/rollup/all` | Part 2 Task 7 | `OAuthEpmRollupRouteTests.test_all_projects_rollup_uses_oauth_home_and_current_jira_search` | `BasicEpmRollupRouteTests.test_all_projects_rollup_basic_uses_existing_basic_jira_headers` | `current_home_graphql_client` / fake Home project fetcher | `current_jira_search`, `current_jira_get` for field helpers | `401 auth_required` with `loginUrl` from either Home or Jira boundary | N/A | OAuth bypasses `EPM_PROJECTS_CACHE` and `EPM_ROLLUP_CACHE`; `Server-Timing` preserved; Basic process cache unchanged |
| `GET /api/epm/projects/<home_project_id>/issues` | Part 2 Task 6 | `OAuthEpmRollupRouteTests.test_project_issues_uses_oauth_home_boundary_and_current_jira_search` | `BasicEpmRollupRouteTests.test_project_issues_basic_uses_existing_basic_jira_headers` | `current_home_graphql_client` / fake `find_epm_project_or_404` path | `current_jira_search` | `401 auth_required` with `loginUrl` from either Home or Jira boundary | N/A | OAuth bypasses `EPM_ISSUES_CACHE`; Basic process cache unchanged |
| `GET /api/epm/projects/<project_id>/rollup` | Part 2 Task 6 | `OAuthEpmRollupRouteTests.test_project_rollup_uses_oauth_home_boundary_and_current_jira_search` | `BasicEpmRollupRouteTests.test_project_rollup_basic_uses_existing_basic_jira_headers` | `current_home_graphql_client` / fake `find_epm_project_or_404` path | `current_jira_search`, `current_jira_get` for field helpers | `401 auth_required` with `loginUrl` from either Home or Jira boundary | N/A | OAuth bypasses `EPM_ROLLUP_CACHE`; Basic process cache unchanged |

## Part 2 Task 1: Home GraphQL OAuth Feasibility Gate

**Files:**
- Create: `scripts/check_home_graphql_oauth.py`
- Create: `tests/test_epm_home_oauth_feasibility.py`
- Modify: `backend/epm/home.py`
- Modify: `backend/routes/auth_routes.py` only if a local-only server-side probe route is needed for browser-session testing
- Modify: `docs/atlassian-oauth-setup.md`

- [x] **Step 1: Write failing probe tests**

Create `tests/test_epm_home_oauth_feasibility.py` with these methods:

```python
import json
import unittest
from unittest.mock import Mock

import jira_server
from backend.epm import home as epm_home


class HomeGraphQLOAuthFeasibilityTests(unittest.TestCase):
    def test_probe_uses_exact_home_query_constants(self):
        queries = epm_home.home_graphql_feasibility_queries()

        self.assertIs(queries["goals_search"], epm_home.QUERY_GOALS_SEARCH)
        self.assertIs(queries["goal_by_key"], epm_home.QUERY_GOAL_BY_KEY)
        self.assertIs(queries["sub_goals"], epm_home.QUERY_SUB_GOALS)
        self.assertIs(queries["goal_projects"], epm_home.QUERY_GOAL_PROJECTS)
        self.assertIs(queries["project_details"], epm_home.QUERY_PROJECT_DETAILS)
        self.assertIs(queries["project_updates"], epm_home.QUERY_PROJECT_UPDATES)
        self.assertIs(queries["project_tags"], epm_home.QUERY_PROJECT_TAGS)
        self.assertIs(queries["teamwork_graph_project_tags"], epm_home.QUERY_TEAMWORK_GRAPH_PROJECT_TAGS)

    def test_probe_output_redacts_token_material(self):
        payload = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "authorization": "Bearer access-123",
            "results": [{"operation": "goals_search", "ok": True}],
        }

        redacted = epm_home.redact_home_oauth_probe_payload(payload)
        rendered = json.dumps(redacted)

        self.assertNotIn("access-123", rendered)
        self.assertNotIn("refresh-123", rendered)
        self.assertNotIn("Bearer", rendered)
        self.assertEqual(redacted["results"][0]["operation"], "goals_search")

    def test_probe_result_classifies_auth_failures_as_unsupported(self):
        result = epm_home.classify_home_graphql_probe_results([
            {"operation": "goals_search", "status": 401, "ok": False},
            {"operation": "teamwork_graph_project_tags", "status": 403, "ok": False},
        ])

        self.assertEqual(result["decision"], "fail")
        self.assertEqual(result["reason"], "home_graphql_3lo_unsupported")

    def test_probe_result_passes_only_when_home_and_twg_operations_succeed(self):
        operations = [
            "goals_search",
            "goal_by_key",
            "sub_goals",
            "goal_projects",
            "project_details",
            "project_updates",
            "project_tags",
            "teamwork_graph_project_tags",
        ]
        result = epm_home.classify_home_graphql_probe_results([
            {"operation": operation, "status": 200, "ok": True} for operation in operations
        ])

        self.assertEqual(result["decision"], "pass")
```

- [x] **Step 2: Run the failing probe tests**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_feasibility
```

Expected: FAIL because `home_graphql_feasibility_queries`, `redact_home_oauth_probe_payload`, and `classify_home_graphql_probe_results` do not exist.

- [x] **Step 3: Add the probe helper functions without marking any EPM route OAuth-ready**

In `backend/epm/home.py`, add helper functions that reference the exact query constants and strip token-bearing fields from diagnostic output. The classification must return:

```python
{"decision": "pass", "reason": "home_graphql_3lo_supported"}
```

only when all eight operations return `ok: True` with non-auth HTTP status. It must return:

```python
{"decision": "fail", "reason": "home_graphql_3lo_unsupported"}
```

when any Home or TWG operation returns HTTP `401`, HTTP `403`, a GraphQL error containing `Unauthorized`, `Forbidden`, or `scope does not match`. It must return:

```python
{"decision": "fail", "reason": "insufficient_home_fixture"}
```

when the saved EPM scope cannot resolve a root goal, sub-goal, and at least one Home project to exercise project detail, update, direct tag, and TWG tag operations.

- [x] **Step 4: Add the local OAuth-session probe path or script**

Prefer a local-only server-side probe route because the active OAuth token store is in the Flask server process. If Part 1 has already introduced another local diagnostic pattern, match it. Otherwise add a route under `/api/auth/dev/home-graphql-oauth-probe` in `backend/routes/auth_routes.py` with these guards. This path is reachable under the Part 1 global OAuth guard because `is_oauth_ready_api_path()` treats `/api/auth/*` as an OAuth-ready auth surface; if that exemption is missing in the implementation checkout, fix Part 1's guard first. Do not place the probe under `/api/epm/*`, and do not mark any Home-backed EPM route OAuth-ready just to run the probe.

```python
if APP_ENVIRONMENT_KEY.strip().lower() not in {"local", "dev"}:
    return jsonify({"error": "not_found"}), 404
if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
    return jsonify({"error": "oauth_required"}), 400
```

The route must use the current server-side OAuth session and must never return `access_token`, `refresh_token`, OAuth code, PKCE verifier, client secret, or Authorization header. It must accept optional `rootGoalKey`, `subGoalKey`, and `homeProjectId` query parameters; when omitted, it must use saved EPM config scope and the first project returned from `QUERY_GOAL_PROJECTS`.

Create `scripts/check_home_graphql_oauth.py` as the local operator wrapper. It should print the URL to open after OAuth login and validate a saved JSON response from the probe route:

```bash
python3 scripts/check_home_graphql_oauth.py --input /tmp/home-graphql-oauth-probe.json
```

Expected PASS output:

```text
PASS home_graphql_3lo_supported
```

Expected FAIL output for unsupported 3LO:

```text
FAIL home_graphql_3lo_unsupported
```

- [x] **Step 5: Run the unit probe tests**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_feasibility
```

Expected: PASS.

- [ ] **Step 6: Run the real local OAuth-session probe**

Start the local app in OAuth mode, sign in through the browser, then open:

```text
http://localhost:5050/api/auth/dev/home-graphql-oauth-probe
```

If the saved EPM config does not contain a root and sub-goal with projects, configure Settings -> EPM with a real root goal and sub-goal from the local Atlassian Home test tenant, save it, then open the same probe URL. Save the JSON response to `/tmp/home-graphql-oauth-probe.json` and run:

```bash
python3 scripts/check_home_graphql_oauth.py --input /tmp/home-graphql-oauth-probe.json
```

PASS means:

- `https://team.atlassian.com/gateway/api/graphql` accepted the OAuth bearer token for `QUERY_GOALS_SEARCH`, `QUERY_GOAL_BY_KEY`, `QUERY_SUB_GOALS`, `QUERY_GOAL_PROJECTS`, `QUERY_PROJECT_DETAILS`, `QUERY_PROJECT_UPDATES`, and `QUERY_PROJECT_TAGS`.
- The TWG endpoint currently produced by `build_teamwork_graph_client()` accepted the OAuth bearer token for `QUERY_TEAMWORK_GRAPH_PROJECT_TAGS`.
- The response contains no token material.

FAIL means:

- Any Home/TWG operation returns HTTP `401`, HTTP `403`, `scope does not match`, `Unauthorized`, or `Forbidden`.
- The probe cannot exercise a root goal, sub-goal, and Home project.
- The probe response includes token material.

- [ ] **Step 7: Apply the gate outcome**

If PASS, update `docs/atlassian-oauth-setup.md` with the exact granted OAuth scope string used by the passing local session and continue to Part 2 Task 2.

If FAIL with `home_graphql_3lo_unsupported`, stop this implementation before route migration. Keep `/api/epm/scope`, `/api/epm/goals`, `/api/epm/projects`, `/api/epm/projects/configuration`, `/api/epm/projects/preview`, `/api/epm/projects/rollup/all`, `/api/epm/projects/<home_project_id>/issues`, and `/api/epm/projects/<project_id>/rollup` guarded with `route_not_oauth_ready`. Add a short section to `docs/atlassian-oauth-setup.md` stating that EPM/Home needs an admin-owned service credential design later, stored only server-side and audited. Do not use the user's Jira OAuth token against Home when the probe says unsupported.

- [ ] **Step 8: Commit the feasibility gate**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_feasibility tests.test_oauth_route_guards
git add backend/epm/home.py backend/routes/auth_routes.py scripts/check_home_graphql_oauth.py tests/test_epm_home_oauth_feasibility.py docs/atlassian-oauth-setup.md
git commit -m "Add Home GraphQL OAuth feasibility gate"
```

Expected: tests PASS. Commit only the files changed in this task.

## Part 2 Task 1A: Tool-Admin/Service Guard For Home-Backed Mutations

Execute this task before marking any Home/Townsquare-backed or Jira-project-backed mutation OAuth-ready. If `docs/plans/2026-05-05-database-introduction-user-auth.md` has already landed its DB admin and service-integration boundary, verify this task against the DB implementation instead of adding a second guard.

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/routes/settings_routes.py` only if a shared settings mutation joins the Home/Jira-project-backed surface
- Create or modify: `backend/routes/admin_routes.py` only after DB auth owns service-integration mutations
- Test: `tests/test_pre_db_admin_gates.py`
- Test: `tests/test_service_integrations.py` after DB auth lands
- Test: `tests/test_epm_home_oauth_source_guard.py`

- [ ] **Step 1: Write the non-tool-admin mutation denial tests**

In `tests/test_pre_db_admin_gates.py`, prove that a valid OAuth session without a tool-admin account id receives `403 {"error": "admin_required"}` for every shared config write that can alter Home/Townsquare or Jira-project-backed behavior, including `POST /api/epm/config` and any future persistent EPM/APM mapping route.

Run:

```bash
python3 -m unittest tests.test_pre_db_admin_gates
```

Expected: FAIL until the temporary or DB-backed admin guard exists.

- [ ] **Step 2: Implement one tool-admin boundary**

If DB auth is not present, use only stable Atlassian account ids from `TOOL_ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS` as the temporary tool-admin signal, keep `RequestAuthContext.is_admin = False` for all other OAuth users, and preserve Basic single-user compatibility. Do not use Atlassian tenant/admin status, email, domain, Jira project access, or Home project access as tool-admin signals.

If DB auth is present, route the same check through DB `users.account_type == "admin"` and active user/connection status.

- [ ] **Step 3: Keep service-account credentials out of normal user token storage**

When service-integration routes exist, verify:

```text
GET /api/admin/service-integrations
POST /api/admin/service-integrations
POST /api/admin/service-integrations/<id>/rotate
POST /api/admin/service-integrations/<id>/disable
DELETE /api/admin/service-integrations/<id>
```

are admin-only, CSRF-required for unsafe methods, return redacted status metadata only, and store `jira_basic` / `home_townsquare_basic` token material only in `service_integration_tokens`.

- [ ] **Step 4: Add source guard coverage**

Extend the EPM/Home source guard so migrated Home route code cannot read `JIRA_EMAIL`, `JIRA_TOKEN`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, or service-token plaintext directly. The only allowed service-credential read path is the service-integration boundary.

- [ ] **Step 5: Run verification**

Run:

```bash
python3 -m unittest tests.test_pre_db_admin_gates tests.test_oauth_route_guards
python3 -m unittest tests.test_service_integrations
```

Expected: PASS for the tests that exist in the current phase. If DB service-integration routes do not exist yet, document that `tests.test_service_integrations` is deferred to the DB Auth plan and keep this Part 2 task blocked for service mutations.

- [ ] **Step 6: Commit**

Run:

```bash
git add jira_server.py backend/routes/epm_routes.py backend/routes/settings_routes.py backend/routes/admin_routes.py tests/test_pre_db_admin_gates.py tests/test_service_integrations.py tests/test_epm_home_oauth_source_guard.py
git commit -m "Guard Home-backed mutations behind admin auth"
```

Expected: commit includes only files needed for the active guard path.

## Part 2 Task 2: Request-Bound Home GraphQL Client Boundary

Execute this task only if Part 2 Task 1 passes before DB auth lands. Do not execute this task on the current documented `FAIL home_graphql_3lo_unsupported` path. If DB auth has already landed, replace the local OAuth session examples below with DB `RequestAuthContext`, encrypted `auth_tokens`, DB refresh locking, `token_version`, and revoked/disabled-user checks before writing code.

**Files:**
- Modify: `backend/epm/home.py`
- Modify: `jira_server.py`
- Test: `tests/test_epm_home_oauth_client.py`

- [ ] **Step 1: Write failing Home boundary tests**

Create `tests/test_epm_home_oauth_client.py` with these methods:

```python
import base64
import unittest
from unittest.mock import patch

import jira_server
from backend.epm import home as epm_home
from tests.oauth_test_helpers import push_oauth_request


class HomeGraphQLOAuthClientTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_current_home_graphql_client_oauth_uses_bearer_without_exposing_token(self):
        request_context = push_oauth_request(jira_server.app)
        self.addCleanup(request_context.pop)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            client = jira_server.current_home_graphql_client()

        self.assertEqual(client.endpoint, epm_home.HOME_GRAPHQL_ENDPOINT)
        self.assertEqual(client.headers["Authorization"], "Bearer access-123")
        self.assertEqual(client.headers["X-ExperimentalApi"], "Townsquare")
        self.assertNotIn("refresh-123", repr(client))

    def test_current_teamwork_graph_client_oauth_uses_site_twg_endpoint(self):
        request_context = push_oauth_request(jira_server.app, site_url="https://example.atlassian.net")
        self.addCleanup(request_context.pop)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            client = jira_server.current_teamwork_graph_client()

        self.assertEqual(client.endpoint, "https://example.atlassian.net/gateway/api/graphql/twg")
        self.assertEqual(client.headers["Authorization"], "Bearer access-123")

    def test_home_graphql_basic_mode_preserves_basic_auth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.dict("os.environ", {
                 "ATLASSIAN_EMAIL": "basic@example.com",
                 "ATLASSIAN_API_TOKEN": "api-token",
                 "JIRA_URL": "https://basic.atlassian.net",
             }, clear=False):
            client = jira_server.current_home_graphql_client()
            twg = jira_server.current_teamwork_graph_client()

        expected = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        self.assertEqual(client.headers["Authorization"], f"Basic {expected}")
        self.assertEqual(twg.endpoint, "https://basic.atlassian.net/gateway/api/graphql/twg")

    def test_current_home_graphql_client_expired_oauth_raises_auth_required(self):
        request_context = push_oauth_request(jira_server.app, access_token="", refresh_token="")
        self.addCleanup(request_context.pop)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.current_home_graphql_client()

        self.assertEqual(raised.exception.code, "auth_required")
```

- [ ] **Step 2: Run the failing Home boundary tests**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_client
```

Expected: FAIL because `current_home_graphql_client` and `current_teamwork_graph_client` do not exist.

- [ ] **Step 3: Implement the minimal Home boundary**

In `backend/epm/home.py`, change `HomeGraphQLClient` so it accepts a prebuilt endpoint and headers. Keep Basic construction in one explicit helper:

```python
def build_basic_home_headers(email, api_token):
    credentials = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    return {
        "Content-Type": "application/json",
        "Authorization": f"Basic {credentials}",
        "X-ExperimentalApi": "Townsquare",
    }
```

Add OAuth header construction that accepts only a server-side session callback result or session data object; do not accept raw tokens from frontend payloads. The resulting Home client must never log or return Authorization headers.

In `jira_server.py`, add:

```python
def current_home_graphql_client(context=None):
    auth_context = current_jira_auth_context(context)
    if JIRA_AUTH_MODE == AUTH_MODE_ATLASSIAN_OAUTH:
        session_data = jira_session_data()
        if not session_data.get("access_token"):
            raise AuthError("auth_required", "Atlassian authentication is required.")
        return epm_home.build_oauth_home_graphql_client(
            session_data,
            endpoint=epm_home.HOME_GRAPHQL_ENDPOINT,
            refresh_callbacks=current_oauth_session_callbacks(),
        )
    return epm_home.build_home_graphql_client()


def current_teamwork_graph_client(context=None):
    auth_context = current_jira_auth_context(context)
    site_url = (auth_context.site_url or JIRA_URL or "").rstrip("/")
    if not site_url:
        raise AuthError("auth_required", "Atlassian authentication is required.")
    if JIRA_AUTH_MODE == AUTH_MODE_ATLASSIAN_OAUTH:
        session_data = jira_session_data()
        if not session_data.get("access_token"):
            raise AuthError("auth_required", "Atlassian authentication is required.")
        return epm_home.build_oauth_home_graphql_client(
            session_data,
            endpoint=f"{site_url}/gateway/api/graphql/twg",
            refresh_callbacks=current_oauth_session_callbacks(),
        )
    return epm_home.build_teamwork_graph_client()
```

Use Part 1's token refresh helpers and `oauth_refresh_lock()` policy. If Home GraphQL returns HTTP `401`, retry once after server-side refresh exactly like Jira; after refresh failure raise `AuthError("auth_required", "Atlassian authentication is required.")`.

- [ ] **Step 4: Preserve Basic compatibility**

Keep `build_home_graphql_client()` and `build_teamwork_graph_client()` as Basic-compatible wrappers for existing Basic tests and local Basic mode. They may call the new lower-level helpers, but Basic mode must still read `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` or `JIRA_EMAIL` / `JIRA_TOKEN` server-side.

- [ ] **Step 5: Run Home boundary tests**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_client tests.test_epm_home_api
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/epm/home.py jira_server.py tests/test_epm_home_oauth_client.py
git commit -m "Add request-bound Home GraphQL client"
```

Expected: commit succeeds with only Part 2 Task 2 files.

## Part 2 Task 3: EPM Config Route Regression And OAuth Route Matching

This regression task may run after Part 1 and DB auth Task 0 verification because `/api/epm/config` is local configuration, not a Home GraphQL route. Do not add Home-backed dynamic route patterns while the Home GraphQL gate remains failed.

Part 1 is allowed to migrate `/api/epm/config` as part of the local config route batch. In Part 2, treat `/api/epm/config` as a regression gate: add any missing EPM-specific tests, keep the CSRF/dashboard behavior verified, and avoid reworking the route if Part 1 already made it OAuth-ready.

**Files:**
- Modify: `backend/routes/epm_routes.py`
- Modify: `jira_server.py`
- Verify: `frontend/src/dashboard.jsx`
- Test: `tests/test_oauth_epm_config_routes.py`
- Test: `tests/test_oauth_route_guards.py`
- Test: `tests/test_auth_isolation_source_guard.js`

- [ ] **Step 1: Write failing route and CSRF tests**

Create `tests/test_oauth_epm_config_routes.py` with:

```python
import unittest
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import install_oauth_session


class OAuthEpmConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_get_epm_config_is_oauth_ready_without_home_or_jira(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2, "projects": {}, "scope": {}}), \
             patch.object(jira_server.epm_home, "build_home_graphql_client") as mock_home, \
             patch.object(jira_server, "current_jira_get") as mock_jira:
            response = self.client.get("/api/epm/config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["version"], 2)
        mock_home.assert_not_called()
        mock_jira.assert_not_called()

    def test_post_epm_config_requires_csrf_header_in_oauth_mode(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/epm/config", json={"version": 2, "projects": {}})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_post_epm_config_requires_tool_admin_account_in_oauth_mode(self):
        install_oauth_session(self.client, account_id="regular-user-account")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"TOOL_ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False):
            response = self.client.post(
                "/api/epm/config",
                json={"version": 2, "projects": {}},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "admin_required")

    def test_post_epm_config_tool_admin_saves_with_csrf_header(self):
        install_oauth_session(self.client, account_id="tool-admin-account")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"TOOL_ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False), \
             patch.object(jira_server, "load_dashboard_config", return_value={"version": 1, "projects": {"selected": []}, "teamGroups": {}}), \
             patch.object(jira_server, "save_dashboard_config") as mock_save:
            response = self.client.post(
                "/api/epm/config",
                json={"version": 2, "projects": {}},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200)
        mock_save.assert_called_once()

    def test_post_epm_config_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/epm/config",
                json={"version": 2, "projects": {}},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")


class BasicEpmConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        self.client = jira_server.app.test_client()

    def test_get_epm_config_basic_mode_returns_saved_config(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2, "projects": {}, "scope": {}}):
            response = self.client.get("/api/epm/config")

        self.assertEqual(response.status_code, 200)

    def test_post_epm_config_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "load_dashboard_config", return_value={"version": 1, "projects": {"selected": []}, "teamGroups": {}}), \
             patch.object(jira_server, "save_dashboard_config"):
            response = self.client.post("/api/epm/config", json={"version": 2, "projects": {}})

        self.assertEqual(response.status_code, 200)
```

Add `TestOauthRouteGuards.test_oauth_ready_dynamic_epm_project_routes_are_pattern_matched` to `tests/test_oauth_route_guards.py`:

```python
    def test_oauth_ready_dynamic_epm_project_routes_are_pattern_matched(self):
        with patch.object(jira_server, "OAUTH_READY_API_PATHS", set()), \
             patch.object(jira_server, "OAUTH_READY_API_PATH_PATTERNS", (r"^/api/epm/projects/[^/]+/issues$",)):
            self.assertTrue(jira_server.is_oauth_ready_api_path("/api/epm/projects/home-1/issues"))
            self.assertFalse(jira_server.is_oauth_ready_api_path("/api/epm/projects/home-1/unknown"))
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_config_routes tests.test_oauth_route_guards
```

Expected: FAIL if Part 1 did not already make `/api/epm/config` OAuth-ready or if dynamic pattern support does not exist. If the config route tests already pass from Part 1, keep them as regression coverage and continue with the dynamic route matcher failure.

- [ ] **Step 3: Add dynamic route pattern support without enabling Home-backed EPM routes yet**

In `jira_server.py`, add:

```python
OAUTH_READY_API_PATH_PATTERNS = ()
```

and update `is_oauth_ready_api_path(path)` to return true when the exact path is ready or any compiled pattern matches. Do not add EPM dynamic patterns until Tasks 6 and 7.

- [ ] **Step 4: Make only `/api/epm/config` OAuth-ready**

If Part 1 did not already do this, add `/api/epm/config` to `OAUTH_READY_API_PATHS`. In `backend/routes/epm_routes.py`, make `GET` and `POST /api/epm/config` require a valid OAuth session in OAuth mode before reading or writing config. `POST /api/epm/config` must also preserve the pre-DB tool-admin gate from `docs/plans/2026-05-05-database-introduction-user-auth.md` Task 0. Use the Part 1 missing-scope/session-expired behavior; missing or expired sessions return:

```json
{"error": "auth_required", "loginUrl": "/login?reason=session_expired"}
```

with HTTP `401`.

- [ ] **Step 5: Verify dashboard EPM save path keeps the CSRF header**

Part 1 owns the `frontend/src/dashboard.jsx` edit for the EPM config save request. In Part 2, inspect the save path and verify it already sends:

```javascript
headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
},
```

If the header is missing, stop and finish the Part 1 dashboard ownership before continuing Part 2; do not take a new `dashboard.jsx` edit in this task. Do not add auth status, login, refresh, token storage, or expired-session routing to `frontend/src/dashboard.jsx`.

- [ ] **Step 6: Run focused verification**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_config_routes tests.test_epm_config_api tests.test_oauth_route_guards
node tests/test_auth_isolation_source_guard.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/routes/epm_routes.py jira_server.py tests/test_oauth_epm_config_routes.py tests/test_oauth_route_guards.py
git commit -m "Verify EPM config OAuth readiness and route patterns"
```

Expected: commit succeeds with only Part 2 Task 3 files. If Part 1 already made `/api/epm/config` OAuth-ready and all tests pass without code changes, do not create an empty commit; record the passing verification in the Part 2 handoff notes.

## Part 2 Task 4: EPM Settings Workflow Migration

Execute this task only if Part 2 Task 1 passes before DB auth lands and Task 2's Home boundary is valid for the active auth model. While the gate is failed, keep these routes guarded and move service-credential-backed route work to the DB auth service-integration path.

**Routes:** `GET /api/epm/scope`, `GET /api/epm/goals`, `POST /api/epm/projects/configuration`, `POST /api/epm/projects/preview`.

**Files:**
- Modify: `backend/routes/epm_routes.py`
- Modify: `jira_server.py`
- Modify: `frontend/src/api/epmApi.js`
- Test: `tests/test_oauth_epm_settings_routes.py`

- [ ] **Step 1: Write failing settings workflow tests**

Create `tests/test_oauth_epm_settings_routes.py` with named methods from the route matrix. The OAuth tests must install a session with `cloudid: "cloud-123"` and patch `jira_server.current_home_graphql_client` or `jira_server.fetch_epm_home_projects` at the boundary. The Basic tests must patch `JIRA_AUTH_MODE` to `basic` and prove POST routes do not require `X-Requested-With`.

Include these exact tests and assertions:

- `test_scope_route_uses_oauth_cloud_id_without_tenant_info_fetch`: patch `epm_home.fetch_home_site_cloud_id` to fail if called, install an OAuth session with `cloudid="cloud-123"`, call `GET /api/epm/scope`, and assert `cloudId == "cloud-123"`.
- `test_goals_route_uses_oauth_home_client_for_catalog`: patch `jira_server.current_home_graphql_client` with a fake client whose `execute_paginated` returns one goal, call `GET /api/epm/goals`, and assert the fake client received `QUERY_GOALS_SEARCH`.
- `test_goals_route_uses_oauth_home_client_for_sub_goals`: patch `jira_server.current_home_graphql_client` with a fake client that resolves a root goal and child goal, call `GET /api/epm/goals?rootGoalKey=ROOT-1`, and assert the fake client received `QUERY_GOAL_BY_KEY` and `QUERY_SUB_GOALS`.
- `test_projects_configuration_requires_csrf_header_in_oauth_mode`: install an OAuth session, call `POST /api/epm/projects/configuration` without `X-Requested-With`, and assert HTTP `403` with `error == "csrf_required"`.
- `test_projects_configuration_uses_oauth_home_client_with_csrf_header`: install an OAuth session, post a synthetic draft config with `X-Requested-With`, patch the Home fetcher boundary, and assert HTTP `200`.
- `test_projects_preview_requires_csrf_header_in_oauth_mode`: install an OAuth session, call `POST /api/epm/projects/preview` without `X-Requested-With`, and assert HTTP `403`.
- `test_projects_preview_uses_oauth_home_client_with_csrf_header`: install an OAuth session, post a synthetic draft config to preview with `X-Requested-With`, patch the Home fetcher boundary, and assert HTTP `200`.
- `test_settings_routes_expired_oauth_return_login_url`: call each settings route without a stored OAuth session and assert HTTP `401`, `error == "auth_required"`, and `loginUrl == "/login?reason=session_expired"`.
- `test_scope_route_basic_uses_existing_tenant_info_lookup`: patch Basic mode and `epm_home.fetch_home_site_cloud_id` to return `cloud-basic`, call `GET /api/epm/scope`, and assert the value is returned.
- `test_goals_route_basic_uses_basic_home_client`: patch Basic mode and `epm_home.build_home_graphql_client`, call `GET /api/epm/goals`, and assert the Basic builder was used.
- `test_projects_configuration_basic_mode_does_not_require_csrf_header`: patch Basic mode, call `POST /api/epm/projects/configuration` without `X-Requested-With`, and assert HTTP `200`.
- `test_projects_preview_basic_mode_does_not_require_csrf_header`: patch Basic mode, call `POST /api/epm/projects/preview` without `X-Requested-With`, and assert HTTP `200`.

- [ ] **Step 2: Run the failing settings tests**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_settings_routes
```

Expected: FAIL because settings Home routes remain guarded or still use Basic Home client construction.

- [ ] **Step 3: Migrate scope and goals**

Update `jira_server.fetch_home_site_cloud_id(context=None)` so OAuth mode returns `current_request_auth_context().cloud_id` when present and does not call `JIRA_URL/_edge/tenant_info`. Keep Basic mode behavior unchanged.

Update `fetch_epm_goal_catalog()` and `fetch_epm_sub_goals(root_goal_key)` to use `current_home_graphql_client()` in OAuth mode and `build_home_graphql_client()` in Basic mode. Catch `AuthError("auth_required")` in `backend/routes/epm_routes.py` before broad exception handlers and return `oauth_auth_required_payload()`.

- [ ] **Step 4: Migrate configuration and preview POSTs**

Ensure `configure_epm_projects_endpoint()` and `preview_epm_projects_endpoint()` call Home discovery through the request-bound Home client under OAuth. Keep `preview_epm_projects_endpoint()` as an alias of the configuration path so behavior stays identical.

Add `/api/epm/scope`, `/api/epm/goals`, `/api/epm/projects/configuration`, and `/api/epm/projects/preview` to `OAUTH_READY_API_PATHS` only after the tests in this task pass.

- [ ] **Step 5: Add CSRF headers to EPM API POST helpers**

In `frontend/src/api/epmApi.js`, change `fetchEpmConfigurationProjects` to send:

```javascript
headers: {
    'X-Requested-With': 'jira-execution-planner',
},
```

Do not switch the settings workflow to `/api/epm/projects/preview`; existing source guard `tests/test_epm_shell_source_guards.js` expects settings to use `/api/epm/projects/configuration`.

- [ ] **Step 6: Run focused verification**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_settings_routes tests.test_epm_scope_api tests.test_epm_projects_api tests.test_epm_home_api
node tests/test_epm_shell_source_guards.js
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/routes/epm_routes.py jira_server.py frontend/src/api/epmApi.js tests/test_oauth_epm_settings_routes.py frontend/dist
git commit -m "Migrate EPM settings Home routes to OAuth"
```

Expected: commit succeeds with only Part 2 Task 4 files plus rebuilt `frontend/dist`.

## Part 2 Task 5: EPM Project Discovery Migration

Execute this task only if Part 2 Task 1 passes before DB auth lands and Task 2's Home boundary is valid for the active auth model. While the gate is failed, keep this route guarded and move service-credential-backed route work to the DB auth service-integration path.

**Route:** `GET /api/epm/projects`.

**Files:**
- Modify: `backend/epm/home.py`
- Modify: `backend/epm/projects.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `jira_server.py`
- Test: `tests/test_oauth_epm_projects_routes.py`

- [ ] **Step 1: Write failing project discovery tests**

Create `tests/test_oauth_epm_projects_routes.py` with these exact tests:

- `test_projects_route_uses_oauth_home_client_and_preserves_server_timing`: install an OAuth session, patch the Home fetcher boundary to return one synthetic Home project, call `GET /api/epm/projects`, assert HTTP `200`, one project, and `Server-Timing` contains `home-projects;dur=` and `total;dur=`.
- `test_projects_route_oauth_bypasses_process_home_project_cache`: install OAuth user A and user B in separate clients, make the Home fetcher return different synthetic projects, call `GET /api/epm/projects` for each, and assert user B never receives user A's project.
- `test_projects_route_expired_oauth_returns_login_url`: call `GET /api/epm/projects` in OAuth mode without a stored session and assert HTTP `401` with `loginUrl == "/login?reason=session_expired"`.
- `test_projects_route_basic_reuses_process_home_project_cache`: patch Basic mode, call `GET /api/epm/projects` twice with the same saved scope, assert the Home fetcher is called once and the second response has `cacheHit == True`.

The OAuth cache test must issue two GET requests as two different OAuth users with different `account_id` values and prove the second user does not receive the first user's Home project payload. Assert cache bypass by checking the Home fetcher is called once per OAuth user/request and no process-global cached project payload is reused across users.

- [ ] **Step 2: Run the failing project tests**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_projects_routes
```

Expected: FAIL because `/api/epm/projects` is not OAuth-ready yet or still uses the Basic Home client path.

- [ ] **Step 3: Migrate Home project discovery**

Ensure `fetch_epm_home_projects(epm_scope, context=None)` obtains the Home client from the request-bound boundary when `context.auth_mode == "atlassian_oauth"`. Ensure `fetch_project_tags()` uses `current_teamwork_graph_client()` for the TWG fallback under OAuth rather than `build_teamwork_graph_client()`.

Do not reintroduce process-global Home metadata leakage. For OAuth, bypass `EPM_PROJECTS_CACHE`, `_GOAL_BY_KEY_CACHE`, and `_CLOUD_ID_CACHE` by keeping `jira_home_process_cache_enabled(context) == False`. Preserve the existing Basic process-cache behavior. Do not add per-user Home/EPM process caches in Part 2; that is a later performance design if profiling proves bypass too slow.

- [ ] **Step 4: Preserve Server-Timing and route readiness**

Keep `Server-Timing` formatted as:

```text
home-projects;dur=<ms>, total;dur=<ms>
```

Add `/api/epm/projects` to `OAUTH_READY_API_PATHS` only after the OAuth and Basic tests pass.

- [ ] **Step 5: Run focused verification**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_projects_routes tests.test_epm_projects_api tests.test_epm_home_api tests.test_oauth_cache_isolation
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/epm/home.py backend/epm/projects.py backend/routes/epm_routes.py jira_server.py tests/test_oauth_epm_projects_routes.py
git commit -m "Migrate EPM project discovery to OAuth"
```

Expected: commit succeeds with only Part 2 Task 5 files.

## Part 2 Task 6: EPM Issue And Per-Project Rollup Migration

Execute this task only if Part 2 Task 1 passes before DB auth lands and Task 2's Home boundary is valid for the active auth model. While the gate is failed, keep these routes guarded and move service-credential-backed route work to the DB auth service-integration path.

**Routes:** `GET /api/epm/projects/<home_project_id>/issues`, `GET /api/epm/projects/<project_id>/rollup`.

**Files:**
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/epm/rollup.py`
- Modify: `jira_server.py`
- Test: `tests/test_oauth_epm_rollup_routes.py`

- [ ] **Step 1: Write failing issue and per-project rollup tests**

Create `tests/test_oauth_epm_rollup_routes.py` with these exact tests:

- `test_project_issues_uses_oauth_home_boundary_and_current_jira_search`: install an OAuth session, patch project lookup to return a labeled project, patch `current_jira_search` to return one synthetic issue, call `GET /api/epm/projects/home-1/issues?tab=active&sprint=42`, and assert `current_jira_search` received the label and sprint JQL.
- `test_project_issues_metadata_only_skips_jira_search`: patch project lookup to return an empty linkage, call `GET /api/epm/projects/home-1/issues?tab=backlog`, and assert `current_jira_search` is not called.
- `test_project_issues_expired_jira_oauth_returns_login_url`: patch `current_jira_search` to raise `AuthError("auth_required", "Atlassian authentication is required.")`, call the issues route, and assert HTTP `401` with the expired-session login URL.
- `test_project_issues_expired_home_oauth_returns_login_url`: patch Home project lookup to raise `AuthError("auth_required", "Atlassian authentication is required.")`, call the issues route, and assert HTTP `401` with the expired-session login URL.
- `test_project_issues_oauth_bypasses_process_issue_cache`: call the issues route as two OAuth users with different Jira search results and assert the second user does not receive the first user's cached issue.
- `test_project_rollup_uses_oauth_home_boundary_and_current_jira_search`: install an OAuth session, patch project lookup to return a labeled project, patch field helpers and `current_jira_search`, call `GET /api/epm/projects/project-1/rollup?tab=active&sprint=42`, and assert rollup hierarchy is built from boundary results.
- `test_project_rollup_expired_auth_returns_login_url`: patch a Jira or Home boundary to raise `AuthError("auth_required", "Atlassian authentication is required.")` and assert HTTP `401`.
- `test_project_rollup_keeps_jira_search_on_next_page_token`: patch `current_jira_search`, call the rollup route, and assert all Jira issue search payloads use `nextPageToken` for pagination and never `startAt`.
- `test_project_issues_basic_uses_existing_basic_jira_headers`: patch Basic mode and `build_jira_headers`, call the issues route, and assert Basic headers are used.
- `test_project_rollup_basic_uses_existing_basic_jira_headers`: patch Basic mode and `build_jira_headers`, call the rollup route, and assert Basic headers are used.

The Jira search assertions must patch `jira_server.current_jira_search`, not `build_jira_headers`. The pagination test must assert Jira issue search payloads use `nextPageToken` through the Part 1 boundary and do not add `startAt` to Jira issue search. Agile API `startAt` usage remains unchanged.

- [ ] **Step 2: Run the failing rollup tests**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_rollup_routes
```

Expected: FAIL because the routes are not OAuth-ready, do not have dynamic OAuth-ready path matching, or still miss Home/Jira auth-error handling.

- [ ] **Step 3: Verify and keep the project issues endpoint on the Part 1 Jira boundary**

The current checkout already uses the no-header call:

```python
issues = fetch_issues_by_jql(jql, build_epm_fields_list())
```

Keep that shape. Do not reintroduce this legacy Basic-header call:

```python
issues = fetch_issues_by_jql(jql, build_jira_headers(), build_epm_fields_list())
```

Verify that `fetch_issues_by_jql` internally calls `current_jira_search` after Part 1 cleanup. If Part 1 kept a legacy compatibility parameter in another branch, pass no headers and make the helper ignore legacy headers for OAuth.

Catch `AuthError("auth_required")` before broad exception handlers and return `oauth_auth_required_payload()`.

- [ ] **Step 4: Migrate per-project rollup dependencies**

In `backend/epm/rollup.py`, remove `build_jira_headers` from `EpmRollupDependencies` for OAuth-ready execution. Make field resolution and issue queries use Part 1 boundaries:

- `resolve_epic_link_field_id` and `resolve_team_field_id` must call their migrated Jira GET helpers.
- `fetch_epm_rollup_query` must call the migrated Jira issue search helper.
- `build_per_project_rollup` must not construct or pass Basic headers in OAuth mode.

Preserve Basic compatibility by keeping Basic mode behavior green in the named Basic tests.

- [ ] **Step 5: Add dynamic route readiness for issues and per-project rollups**

In `jira_server.py`, add exact dynamic patterns only after the tests pass:

```python
OAUTH_READY_API_PATH_PATTERNS = (
    r"^/api/epm/projects/[^/]+/issues$",
    r"^/api/epm/projects/[^/]+/rollup$",
)
```

Do not use a broad `/api/epm/projects/.*` pattern.

- [ ] **Step 6: Run focused verification**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_rollup_routes tests.test_epm_scope_resolution tests.test_epm_issues_endpoint tests.test_epm_rollup_api tests.test_epm_rollup_builder tests.test_oauth_route_guards
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/routes/epm_routes.py backend/epm/rollup.py jira_server.py tests/test_oauth_epm_rollup_routes.py tests/test_oauth_route_guards.py
git commit -m "Migrate EPM project issues and rollups to OAuth"
```

Expected: commit succeeds with only Part 2 Task 6 files.

## Part 2 Task 7: EPM All-Projects Rollup Migration

Execute this task only if Part 2 Task 1 passes before DB auth lands and Task 2's Home boundary is valid for the active auth model. While the gate is failed, keep this route guarded and move service-credential-backed route work to the DB auth service-integration path.

**Route:** `GET /api/epm/projects/rollup/all`.

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/epm/rollup.py`
- Test: `tests/test_oauth_epm_rollup_routes.py`

- [ ] **Step 1: Add failing aggregate rollup tests**

Extend `tests/test_oauth_epm_rollup_routes.py` with these exact tests:

- `test_all_projects_rollup_uses_oauth_home_and_current_jira_search`: install an OAuth session, patch Home discovery to return one labeled active project, patch `current_jira_search`, call `GET /api/epm/projects/rollup/all?tab=active&sprint=42`, and assert both boundaries were used.
- `test_all_projects_rollup_expired_auth_returns_login_url`: patch either Home discovery or `current_jira_search` to raise `AuthError("auth_required", "Atlassian authentication is required.")`, call the route, and assert HTTP `401`.
- `test_all_projects_rollup_preserves_server_timing`: call the aggregate route with boundary fakes and assert `Server-Timing` contains `home-projects;dur=`, `epm-rollups;dur=`, and `total;dur=`.
- `test_all_projects_rollup_oauth_bypasses_process_rollup_cache`: call aggregate rollup as two OAuth users with different Jira search results and assert user B does not receive user A's rollup.
- `test_all_projects_rollup_basic_uses_existing_basic_jira_headers`: patch Basic mode and `build_jira_headers`, call aggregate rollup, and assert Basic headers are used.

- [ ] **Step 2: Run the failing aggregate tests**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_rollup_routes.OAuthEpmRollupRouteTests.test_all_projects_rollup_uses_oauth_home_and_current_jira_search tests.test_oauth_epm_rollup_routes.OAuthEpmRollupRouteTests.test_all_projects_rollup_expired_auth_returns_login_url tests.test_oauth_epm_rollup_routes.OAuthEpmRollupRouteTests.test_all_projects_rollup_preserves_server_timing
```

Expected: FAIL until `/api/epm/projects/rollup/all` is migrated and OAuth-ready.

- [ ] **Step 3: Migrate aggregate rollup path**

Ensure `build_all_epm_projects_rollup()` uses migrated project discovery from Part 2 Task 5 and migrated per-project rollup dependencies from Part 2 Task 6. The route must preserve:

```text
Server-Timing: home-projects;dur=<ms>, epm-rollups;dur=<ms>, total;dur=<ms>
```

and current behavior for active, backlog, and archived tabs.

- [ ] **Step 4: Mark aggregate route OAuth-ready**

Add `/api/epm/projects/rollup/all` to `OAUTH_READY_API_PATHS` only after the Part 2 Task 7 tests pass. Do not add broader route patterns.

- [ ] **Step 5: Run focused verification**

Run:

```bash
python3 -m unittest tests.test_oauth_epm_rollup_routes tests.test_epm_rollup_api tests.test_epm_projects_api tests.test_oauth_cache_isolation
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add jira_server.py backend/routes/epm_routes.py backend/epm/rollup.py tests/test_oauth_epm_rollup_routes.py
git commit -m "Migrate EPM aggregate rollups to OAuth"
```

Expected: commit succeeds with only Part 2 Task 7 files.

## Part 2 Task 8: EPM/Home Source Guards

Execute this task only if Part 2 Task 1 passes before DB auth lands and Task 2's Home boundary is valid for the active auth model. If DB auth has landed, source guards must reject local token-store helpers and enforce DB token/service-integration boundaries instead.

**Files:**
- Create: `tests/test_epm_home_oauth_source_guard.py`
- Modify: `tests/test_auth_isolation_source_guard.js`

Post-DB rule: after `docs/plans/2026-05-05-database-introduction-user-auth.md` lands, extend this guard so Home/Townsquare route code and migrated EPM route code cannot call `oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`, or `OAUTH_TOKEN_STORE`. At that point token resolution must flow through `RequestAuthContext`, DB `auth_connections`, encrypted `auth_tokens`, DB refresh locking, and revoked/disabled-user checks.

- [ ] **Step 1: Write the source guard**

Create `tests/test_epm_home_oauth_source_guard.py`:

```python
import re
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]

MIGRATED_EPM_FILES = [
    REPO_ROOT / "backend" / "routes" / "epm_routes.py",
    REPO_ROOT / "backend" / "epm" / "rollup.py",
]

HOME_FILE = REPO_ROOT / "backend" / "epm" / "home.py"
JIRA_SERVER_FILE = REPO_ROOT / "jira_server.py"
FRONTEND_FILES = [
    REPO_ROOT / "frontend" / "src" / "dashboard.jsx",
    REPO_ROOT / "frontend" / "src" / "api" / "epmApi.js",
]


class EpmHomeOauthSourceGuardTests(unittest.TestCase):
    def test_migrated_epm_paths_do_not_call_legacy_basic_header_builder(self):
        failures = []
        for path in MIGRATED_EPM_FILES:
            source = path.read_text(encoding="utf8")
            if "build_jira_headers(" in source:
                failures.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(failures, [])

    def test_migrated_epm_paths_do_not_call_jira_rest_with_direct_jira_url(self):
        pattern = re.compile(r"(?:requests|HTTP_SESSION|urlopen|resilient_jira_get).*JIRA_URL.*/rest/", re.S)
        failures = []
        for path in MIGRATED_EPM_FILES + [JIRA_SERVER_FILE]:
            source = path.read_text(encoding="utf8")
            if pattern.search(source):
                failures.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(failures, [])

    def test_home_oauth_boundary_is_the_only_home_bearer_construction_site(self):
        source = HOME_FILE.read_text(encoding="utf8")
        bearer_count = source.count('"Authorization": f"Bearer {')
        self.assertEqual(bearer_count, 1)
        self.assertIn("build_oauth_home_graphql_client", source)
        self.assertIn("build_basic_home_headers", source)

    def test_frontend_does_not_contain_token_material_or_auth_ui(self):
        forbidden = [
            "access_token",
            "refresh_token",
            "client_secret",
            "code_verifier",
            "Authorization",
            "/api/auth/atlassian/login",
            "/api/auth/refresh",
        ]
        failures = []
        for path in FRONTEND_FILES:
            source = path.read_text(encoding="utf8")
            for needle in forbidden:
                if needle in source:
                    failures.append(f"{path.relative_to(REPO_ROOT)} contains {needle}")
        self.assertEqual(failures, [])
```

- [ ] **Step 2: Run the failing source guard**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_source_guard
```

Expected: FAIL if any migrated EPM path still calls `build_jira_headers`, direct `JIRA_URL` REST, or frontend token/auth UI code.

- [ ] **Step 3: Fix guard failures by using boundaries, not by weakening the guard**

If `build_jira_headers` appears in `backend/routes/epm_routes.py` or `backend/epm/rollup.py`, finish the migration through `current_jira_search` / `current_jira_get`. If direct Home bearer construction appears outside the Home boundary helper, move it into the boundary. If frontend token strings appear, remove them from dashboard/API modules.

- [ ] **Step 4: Run source guards**

Run:

```bash
python3 -m unittest tests.test_epm_home_oauth_source_guard tests.test_oauth_jira_client_source_guard
node tests/test_auth_isolation_source_guard.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/test_epm_home_oauth_source_guard.py tests/test_auth_isolation_source_guard.js
git commit -m "Guard EPM OAuth auth boundaries"
```

Expected: commit succeeds with only source guard files unless guard fixes were required.

## Part 2 Task 9: Browser And Final Verification

Execute this task only if Part 2 Task 1 passes and Part 2 Tasks 2 through 8 are complete.

**Files:**
- Modify: PR notes only if a PR is created later
- Test: no new files

- [ ] **Step 1: Run full automated verification**

Run:

```bash
python3 -m unittest discover -s tests
node tests/test_auth_isolation_source_guard.js
python3 -m unittest tests.test_epm_home_oauth_source_guard
npm run build
git log --oneline -5
```

Expected: all tests PASS, build exits 0, and the last five commits are focused Part 2 commits.

- [ ] **Step 2: Run manual OAuth browser journey**

Start the local server in OAuth mode. In the browser, verify:

- OAuth login completes through Atlassian.
- `Settings -> EPM` opens.
- EPM scope loads and shows the active saved scope value.
- Root goals load.
- Sub-goals load after selecting a root goal.
- Project configuration preview loads through `/api/epm/projects/configuration`.
- Saving EPM config works with `X-Requested-With: jira-execution-planner`.
- EPM Active tab renders project cards.
- Active tab with a selected sprint renders rollups.
- Backlog tab still renders backlog projects and rollups.
- Archived tab still renders archived or metadata-only behavior.
- Clearing the OAuth token store or using an expired session returns visible expired-auth recovery, not blank EPM content.

- [ ] **Step 3: Run manual Basic browser regression**

Start the local server in Basic mode. Verify:

- `Settings -> EPM` scope, goals, project configuration, preview, and save still work.
- EPM Active tab with a selected sprint renders rollups.
- Backlog and Archived tabs still behave.
- POST routes do not require `X-Requested-With` in Basic mode.

- [ ] **Step 4: Capture PR notes**

Record:

- Home GraphQL feasibility PASS result, including whether `team.atlassian.com/gateway/api/graphql` and `{siteUrl}/gateway/api/graphql/twg` both accepted 3LO bearer tokens.
- Any additional OAuth scopes documented from the passing local session.
- Screenshot or browser notes for Settings -> EPM, Active rollups, Backlog, Archived, and expired-auth recovery.
- Confirmation that no token material appears in frontend/dashboard source or API payloads.

Do not include secrets, token placeholders, credential env vars, or local absolute paths in the PR description.

## Stop Path If Home GraphQL 3LO Is Unsupported

If Part 2 Task 1 fails with `home_graphql_3lo_unsupported`, do not execute Part 2 Tasks 2 through 9. Instead run:

```bash
python3 -m unittest tests.test_epm_home_oauth_feasibility tests.test_oauth_route_guards
node tests/test_auth_isolation_source_guard.js
git log --oneline -5
```

Expected:

- Feasibility tests PASS.
- Route guards still return `501 route_not_oauth_ready` for Home-backed EPM routes in OAuth mode.
- Dashboard source guard PASS.
- `/api/epm/config` may remain OAuth-ready if Part 1 already made local config routes ready, but no Home-backed route is marked ready.

Commit message for the stop path:

```bash
git add backend/epm/home.py backend/routes/auth_routes.py scripts/check_home_graphql_oauth.py tests/test_epm_home_oauth_feasibility.py docs/atlassian-oauth-setup.md
git commit -m "Record Home GraphQL OAuth gate result"
```

## Plan Readiness Assessment

This plan is executable immediately after Part 1 is implemented and verified only if a real local Atlassian OAuth session is available for the same tenant used by EPM/Home. The implementation is blocked from route migration until Part 2 Task 1 proves 3LO bearer tokens work against both current Home GraphQL surfaces: `https://team.atlassian.com/gateway/api/graphql` and the TWG endpoint produced by `build_teamwork_graph_client()`.

Remaining unknowns:

- Whether Atlassian 3LO bearer tokens are accepted by the current Home/Townsquare GraphQL operations and TWG `cypherQuery`.
- Whether the current Atlassian developer app needs additional GraphQL/Home scopes beyond the Part 1 Jira scopes.
- Whether the GraphQL field descriptions in the live explorer identify Home/Townsquare-specific scopes for the operations used here.

If the feasibility gate passes, the rest of the plan is concrete TDD migration work. If it fails, the plan deliberately stops before Home-backed route migration and leaves those routes guarded.
