# Home/Townsquare 3LO Readiness Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Home/Townsquare-backed EPM/APM read routes to user Atlassian 3LO only after Atlassian Home/Townsquare GraphQL accepts real user OAuth tokens.

**Architecture:** This plan is intentionally gate-first. The current safe state is server-side Home/Townsquare service credentials plus `route_not_oauth_ready` guards for Home/Townsquare-backed OAuth routes. When the Home GraphQL 3LO gate passes, add a request-bound Home/Townsquare OAuth client and migrate read routes while keeping user-facing mutation routes admin/service guarded.

**Tech Stack:** Python, Flask, `unittest`, Atlassian OAuth 2.0 (3LO), Atlassian Home/Townsquare GraphQL, Jira REST.

---

## Current Guardrails

- Normal users may read Home/Townsquare-backed and Jira-project-backed EPM/APM data only through routes that are explicitly migrated and tested.
- Normal users must not be able to mutate Home/Townsquare data, Jira project metadata, or saved Home/Jira-project-backed EPM/APM configuration unless an explicit admin/service-account guard is implemented and tested.
- Server-side Basic/API-token credentials are service-account credentials. Do not ask individual users to create personal Atlassian API tokens for shared app auth.
- Do not expose token material in logs, plans, commit messages, PR notes, screenshots, or chat.
- Do not add any Home/Townsquare-backed route to `OAUTH_READY_API_PATHS` until Task 1 passes with a real local OAuth session.

## Files

- Modify: `docs/atlassian-oauth-setup.md`
- Modify: `docs/plans/2026-05-06-epm-home-oauth-migration.md`
- Modify: `backend/epm/home.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `jira_server.py`
- Test: `tests/test_home_townsquare_3lo_client.py`
- Test: `tests/test_home_townsquare_oauth_routes.py`
- Test: `tests/test_home_townsquare_guardrails.py`

## Task 1: Home/Townsquare 3LO Readiness Gate

**Files:**
- Modify: `docs/atlassian-oauth-setup.md`
- Test: use `scripts/check_home_graphql_oauth.py`

- [ ] **Step 1: Start the local server in OAuth mode**

Run:

```bash
JIRA_AUTH_MODE=atlassian_oauth .venv/bin/python jira_server.py
```

Expected: the server starts on `http://localhost:5050` without printing tokens or OAuth callback query strings.

- [ ] **Step 2: Log in with a real Atlassian OAuth session**

Open `http://localhost:5050/`, sign in through Atlassian, and confirm:

```bash
curl -s http://localhost:5050/api/auth/status
```

Expected: JSON includes `"authenticated": true`. Do not copy any callback URL from browser history.

- [ ] **Step 3: Capture the Home/Townsquare GraphQL probe**

Run:

```bash
.venv/bin/python scripts/check_home_graphql_oauth.py
```

Open the printed local probe URL in the same browser session. Save the response JSON to `/tmp/home-graphql-oauth-probe.json`, outside the repo.

- [ ] **Step 4: Verify the gate result**

Run:

```bash
.venv/bin/python scripts/check_home_graphql_oauth.py --input /tmp/home-graphql-oauth-probe.json
```

Expected pass result:

```text
PASS home_graphql_3lo_supported
```

Expected blocked result:

```text
FAIL home_graphql_3lo_unsupported
```

If the result is not `PASS`, stop this plan. Keep Home/Townsquare-backed routes guarded with `route_not_oauth_ready`, keep Home/Townsquare metadata on server-side service credentials, and report the blocked outcome to the user.

- [ ] **Step 5: Document the pass result**

In `docs/atlassian-oauth-setup.md`, update the Home GraphQL OAuth gate section with:

```markdown
Latest local gate result: PASS with a real Atlassian OAuth user session on the date recorded in this commit.

The probe did not expose token material. Home/Townsquare GraphQL accepted the request-bound user 3LO token, so the migration plan in `docs/plans/2026-05-06-home-townsquare-3lo-readiness-migration.md` is ready to execute.
```

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/atlassian-oauth-setup.md
git commit -m "Record Home Townsquare 3LO readiness"
```

## Task 2: Add Source Guards for Home/Townsquare Route Readiness

**Files:**
- Test: `tests/test_home_townsquare_guardrails.py`
- Modify: `jira_server.py`

- [ ] **Step 1: Write the failing source guard tests**

Create `tests/test_home_townsquare_guardrails.py`:

```python
import inspect
import unittest

import jira_server


HOME_TOWNSQUARE_READ_ROUTES = {
    "/api/epm/scope",
    "/api/epm/goals",
    "/api/epm/projects",
    "/api/epm/projects/configuration",
    "/api/epm/projects/preview",
    "/api/epm/projects/rollup/all",
}

class HomeTownsquareGuardrailTests(unittest.TestCase):
    def test_home_townsquare_routes_are_added_explicitly(self):
        for path in HOME_TOWNSQUARE_READ_ROUTES:
            self.assertIn(path, jira_server.OAUTH_READY_API_PATHS)

    def test_dynamic_epm_routes_use_explicit_matcher(self):
        source = inspect.getsource(jira_server.is_oauth_ready_api_path)
        self.assertIn("is_oauth_ready_epm_dynamic_path", source)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_guardrails
```

Expected: FAIL because the Home/Townsquare paths and dynamic matcher are not implemented yet.

- [ ] **Step 3: Add explicit route readiness helpers**

In `jira_server.py`, add helpers next to `OAUTH_READY_API_PATHS`:

```python
OAUTH_READY_EPM_DYNAMIC_PREFIXES = (
    "/api/epm/projects/",
)


def is_oauth_ready_epm_dynamic_path(path):
    return (
        path.startswith("/api/epm/projects/")
        and (path.endswith("/issues") or path.endswith("/rollup"))
    )
```

Update `is_oauth_ready_api_path(path)`:

```python
def is_oauth_ready_api_path(path):
    return (
        path.startswith('/api/auth/')
        or path in OAUTH_READY_API_PATHS
        or is_oauth_ready_epm_dynamic_path(path)
    )
```

- [ ] **Step 4: Add read-route paths only after Task 1 passed**

Add these paths to `OAUTH_READY_API_PATHS`:

```python
    '/api/epm/scope',
    '/api/epm/goals',
    '/api/epm/projects',
    '/api/epm/projects/configuration',
    '/api/epm/projects/preview',
    '/api/epm/projects/rollup/all',
```

Keep `/api/epm/config` separate because it mutates saved configuration.

- [ ] **Step 5: Run tests**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_guardrails
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add jira_server.py tests/test_home_townsquare_guardrails.py
git commit -m "Guard Home Townsquare OAuth route readiness"
```

## Task 3: Add Admin/Service Guard for Home/Jira-Project-Backed Mutations

**Files:**
- Test: `tests/test_home_townsquare_oauth_routes.py`
- Test: `tests/test_home_townsquare_guardrails.py`
- Modify: `backend/routes/epm_routes.py`

This task guards every mutation path that can change shared Home/Townsquare-backed or Jira-project-backed EPM/APM state. It is not limited to `/api/epm/config`.

Mutation inventory:

- Existing shared EPM config write: `POST /api/epm/config`.
- DB-era shared workspace config write: `PATCH /api/workspace/config`.
- Compatibility shared config writes that persist Home/Jira-project-backed mappings, including any DB-backed replacement for `POST /api/epm/config`.
- Service integration writes such as create, rotate, disable, or revoke of `home_townsquare_basic` or `jira_basic` service credentials.
- Saved-view routes that accept user-owned view payloads, such as `POST /api/me/views` and `PATCH /api/me/views/<id>`, only when they reject shared mapping definitions.

- [ ] **Step 1: Write failing route tests**

Create `tests/test_home_townsquare_oauth_routes.py`:

```python
import inspect
import unittest
from unittest.mock import patch

import jira_server


class HomeTownsquareOauthRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = jira_server.app.test_client()

    def test_epm_config_post_requires_admin_or_service_guard_in_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/epm/config",
                json={"scope": {"rootGoalKey": "ROOT", "subGoalKeys": ["CHILD"]}},
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "admin_required")

    def test_workspace_config_patch_requires_admin_for_home_jira_mappings(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.patch(
                "/api/workspace/config",
                json={"epm": {"projects": {"home-project-1": {"label": "rnd_project_a"}}}},
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "admin_required")

    def test_service_integration_write_requires_admin_or_service_guard(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/admin/service-integrations",
                json={"provider": "home_townsquare_basic", "credentialSubject": "svc@example.com"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "admin_required")

    def test_saved_view_rejects_shared_home_mapping_backdoor(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/me/views",
                json={
                    "name": "Private EPM view",
                    "viewType": "epm",
                    "payload": {
                        "epm": {
                            "projectMappings": {
                                "home-project-1": {"jiraLabel": "rnd_project_a"}
                            }
                        }
                    },
                },
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "shared_mapping_not_allowed")

    def test_preview_route_remains_read_only(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
                patch.object(jira_server, "build_epm_projects_payload", return_value={"projects": []}):
            response = self.client.post(
                "/api/epm/projects/preview",
                json={"scope": {"rootGoalKey": "ROOT", "subGoalKeys": ["CHILD"]}},
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"projects": []})
```

- [ ] **Step 2: Run tests to verify the mutation test fails**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_oauth_routes
```

Expected: FAIL because shared Home/Jira-project-backed mutation routes either do not exist yet or still allow normal OAuth users to write shared mappings.

- [ ] **Step 3: Add source guard coverage**

Extend `tests/test_home_townsquare_guardrails.py`:

```python
    def test_mutation_routes_require_admin_or_service_guard(self):
        source = inspect.getsource(jira_server)
        for path in (
            "/api/epm/config",
            "/api/workspace/config",
            "/api/admin/service-integrations",
            "/api/me/views",
        ):
            self.assertIn(path, source)
        self.assertIn("require_epm_shared_mapping_write_access", source)
        self.assertIn("reject_shared_mapping_payload_keys", source)
```

Run:

```bash
python3 -m unittest tests.test_home_townsquare_guardrails
```

Expected: FAIL because the shared mapping write guard and saved-view payload rejection are not implemented yet.

- [ ] **Step 4: Implement the guard**

Add a shared guard and use it from every shared Home/Jira-project-backed mutation route:

```python
def require_epm_shared_mapping_write_access():
    auth_context = current_request_auth_context()
    if auth_context.is_admin:
        return None
    if getattr(auth_context, "service_integration_job", False):
        return None
    return jsonify({
        "error": "admin_required",
        "message": "This Home/Townsquare-backed configuration change requires an admin or service-account guarded path.",
    }), 403
```

At the start of `save_epm_config_endpoint()`, add:

```python
    guard = require_epm_shared_mapping_write_access()
    if guard is not None:
        return guard
```

Use the same guard for `PATCH /api/workspace/config`, service-integration create/rotate/revoke endpoints, and any compatibility route that persists Home project ids, Jira labels, Home goal keys, or Jira project mapping defaults. Do not implement a browser header that lets a normal user impersonate a service-account path.

For saved-view endpoints, implement a separate payload check so normal users can save private view state but cannot write shared Home/Jira-project-backed mappings:

```python
SHARED_MAPPING_PAYLOAD_KEYS = {
    "projectMappings",
    "projects",
    "homeProjectMappings",
    "jiraLabelDefinitions",
    "serviceIntegrations",
}


def reject_shared_mapping_payload_keys(payload):
    if not isinstance(payload, dict):
        return None
    epm_payload = payload.get("epm") if isinstance(payload.get("epm"), dict) else {}
    if any(key in epm_payload for key in SHARED_MAPPING_PAYLOAD_KEYS):
        return jsonify({
            "error": "shared_mapping_not_allowed",
            "message": "Saved views may reference configured Home/Jira metadata but cannot mutate shared mappings.",
        }), 400
    return None
```

- [ ] **Step 5: Run tests**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_oauth_routes tests.test_home_townsquare_guardrails
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/routes/epm_routes.py tests/test_home_townsquare_oauth_routes.py tests/test_home_townsquare_guardrails.py
git commit -m "Guard Home backed EPM mutations"
```

## Post-DB Execution Mode Check

Before Task 4, `docs/plans/2026-05-05-database-introduction-user-auth.md` Phase 1 must be merged and verified. Do not start Task 4 against the local OAuth token-store bridge.

- If DB auth has landed, Home/Townsquare user 3LO must resolve through `RequestAuthContext`, `auth_connections`, encrypted `auth_tokens`, DB refresh locking, `token_version`, revoked/disabled-user checks, and user/auth cache partitioning.
- In DB mode, Home/Townsquare route code must not call `oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`, or `OAUTH_TOKEN_STORE`.
- In DB mode, do not store Home/Townsquare Basic service credentials as a user's `auth_connection`; they remain `service_integrations` until this Home user 3LO path is verified and implemented.

## Task 4: Add Request-Bound Home/Townsquare 3LO Client

**Files:**
- Test: `tests/test_home_townsquare_3lo_client.py`
- Modify: `backend/epm/home.py`

- [ ] **Step 1: Write failing client tests**

Create `tests/test_home_townsquare_3lo_client.py`:

```python
import unittest
from unittest.mock import patch

from backend.epm.home import HomeGraphQLClient, HomeGraphQLOAuthClient


class HomeTownsquare3loClientTests(unittest.TestCase):
    def test_oauth_client_uses_bearer_header(self):
        client = HomeGraphQLOAuthClient("user-access-token")
        self.assertEqual(client.headers["Authorization"], "Bearer user-access-token")
        self.assertEqual(client.headers["X-ExperimentalApi"], "Townsquare")

    def test_basic_client_remains_basic_auth_compatible(self):
        client = HomeGraphQLClient("service@example.com", "token")
        self.assertTrue(client.headers["Authorization"].startswith("Basic "))

    def test_oauth_client_does_not_log_token_on_graphql_error(self):
        client = HomeGraphQLOAuthClient("secret-access-token")
        with patch("backend.epm.home.urlopen") as urlopen:
            urlopen.side_effect = OSError("network failed")
            with self.assertRaises(Exception) as raised:
                client.execute("query { viewer { id } }")
        self.assertNotIn("secret-access-token", str(raised.exception))
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_3lo_client
```

Expected: FAIL because `HomeGraphQLOAuthClient` does not exist.

- [ ] **Step 3: Implement the OAuth client**

In `backend/epm/home.py`, add:

```python
class HomeGraphQLOAuthClient(HomeGraphQLClient):
    def __init__(self, access_token: str, endpoint: str = HOME_GRAPHQL_ENDPOINT):
        self.endpoint = endpoint
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
            "X-ExperimentalApi": "Townsquare",
        }
```

Keep `HomeGraphQLClient` unchanged so Basic/service-account compatibility remains intact.

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_3lo_client
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/epm/home.py tests/test_home_townsquare_3lo_client.py
git commit -m "Add Home Townsquare OAuth client"
```

## Task 5: Route Home/Townsquare Reads Through User 3LO

**Files:**
- Test: `tests/test_home_townsquare_oauth_routes.py`
- Create: `backend/auth/home_oauth.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/epm/home.py`
- Modify: `jira_server.py`

- [ ] **Step 1: Add failing route-boundary tests**

Extend `tests/test_home_townsquare_oauth_routes.py`:

```python
    def test_projects_route_uses_request_bound_home_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
                patch.object(jira_server, "current_home_oauth_token_for_context", return_value={
                    "access_token": "user-token",
                    "cloudid": "cloud-1",
                    "site_url": "https://example.atlassian.net",
                    "token_version": "7",
                }), \
                patch.object(jira_server.epm_home, "HomeGraphQLOAuthClient") as oauth_client, \
                patch.object(jira_server, "build_epm_projects_payload", return_value={"projects": []}):
            response = self.client.get("/api/epm/projects")
        self.assertEqual(response.status_code, 200)
        oauth_client.assert_called()

    def test_post_db_home_client_boundary_does_not_use_local_session_helpers(self):
        source = inspect.getsource(jira_server.current_home_graphql_client)
        for forbidden in (
            "oauth_session_data",
            "save_oauth_session",
            "oauth_refresh_lock",
            "OAUTH_TOKEN_STORE",
        ):
            self.assertNotIn(forbidden, source)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_oauth_routes
```

Expected: FAIL because EPM route dependencies still use the process-global Home Basic client.

- [ ] **Step 3: Add request-bound Home client resolution**

Add `current_home_oauth_token_for_context(auth_context)` in `backend/auth/home_oauth.py`, then call it from a small server wrapper:

```python
from backend.auth.home_oauth import current_home_oauth_token_for_context


def current_home_graphql_client(auth_context=None):
    auth_context = auth_context or current_request_auth_context()
    if auth_context.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
        active = current_home_oauth_token_for_context(auth_context)
        return epm_home.HomeGraphQLOAuthClient(active.get("access_token", ""))
    return epm_home.build_home_graphql_client()
```

Implement `current_home_oauth_token_for_context(auth_context)` in `backend/auth/home_oauth.py`. It must read and refresh the user's encrypted `auth_tokens` through `auth_connections`, DB row/advisory refresh locking, `token_version` checks, active-user/active-connection checks, and revoked/disabled-user handling. Route modules must not call local token-store helpers directly.

Wire Home/Townsquare fetch paths used by `/api/epm/scope`, `/api/epm/goals`, `/api/epm/projects`, `/api/epm/projects/configuration`, `/api/epm/projects/preview`, and rollup routes to accept or resolve this request-bound client. Keep Jira issue fetches on the existing request-bound Jira OAuth client.

- [ ] **Step 4: Run focused tests**

Run:

```bash
python3 -m unittest tests.test_home_townsquare_3lo_client tests.test_home_townsquare_oauth_routes tests.test_home_townsquare_guardrails
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/epm/home.py backend/routes/epm_routes.py jira_server.py tests/test_home_townsquare_oauth_routes.py
git commit -m "Route Home Townsquare reads through OAuth"
```

## Task 6: Documentation and Manual Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/atlassian-oauth-setup.md`
- Modify: `docs/plans/2026-05-06-epm-home-oauth-migration.md`

- [ ] **Step 1: Update docs with the new supported model**

In the docs, state:

```markdown
Home/Townsquare GraphQL now supports user 3LO for the tested local Atlassian app scopes. Home/Townsquare-backed read routes use the signed-in user's OAuth session. Server-side Basic/API-token credentials remain service-account-only and are used only for Basic mode or explicitly admin-owned service workflows.

Normal users cannot mutate Home/Townsquare-backed or Jira-project-backed EPM/APM configuration. Mutation routes require an explicit admin/service-account guard.
```

- [ ] **Step 2: Build and run all tests**

Run:

```bash
npm run build
python3 -m unittest discover -s tests
```

Expected: both commands PASS.

- [ ] **Step 3: Browser/manual verification**

With `JIRA_AUTH_MODE=atlassian_oauth`, run:

```bash
.venv/bin/python jira_server.py
```

Verify in the browser:

- `/login` signs in through Atlassian without exposing callback query strings in logs.
- `ENG` data still loads with user OAuth Jira data.
- `EPM` scope, goals, projects, project issues, and rollups load with user OAuth for both Home/Townsquare and Jira data.
- A normal user POST to `/api/epm/config` returns `403 admin_required`.
- Basic mode still works with service-account credentials.

- [ ] **Step 4: Final source guards**

Run:

```bash
rg -n "ATLASSIAN_API_TOKEN|JIRA_TOKEN|Authorization|Bearer|callback\\?" README.md docs AGENTS.md backend tests
python3 -m unittest tests.test_home_townsquare_guardrails tests.test_oauth_jira_client_source_guard
```

Expected: no docs/log examples expose token material; tests PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md .env.example docs/atlassian-oauth-setup.md docs/plans/2026-05-06-epm-home-oauth-migration.md
git commit -m "Document Home Townsquare 3LO migration"
```

## Final Verification

Run:

```bash
git log --oneline -5
npm run build
python3 -m unittest discover -s tests
.venv/bin/python scripts/check_home_graphql_oauth.py --input /tmp/home-graphql-oauth-probe.json
```

Expected:

- The latest commits match this plan's commit messages.
- Frontend build passes.
- Full Python test suite passes.
- Home/Townsquare GraphQL gate prints `PASS home_graphql_3lo_supported`.

Report to the user whether the route migration executed or stopped at the Home/Townsquare 3LO gate.
