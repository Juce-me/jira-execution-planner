# OAuth Jira Client Route Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the dashboard's Jira REST calls from direct Basic-header construction to the request-scoped OAuth-aware Jira client boundary, while keeping Basic mode compatible.

**Architecture:** Keep the existing OAuth login slice intact and add a thin request-bound Jira API wrapper around `backend/auth/jira_auth.py`'s `jira_get`/`jira_post` helpers. Migrate routes in batches, only adding each route to `OAUTH_READY_API_PATHS` after tests prove it uses the auth boundary, preserves its response shape, and does not fall back to process-global Basic credentials. Keep Home/Townsquare GraphQL and EPM Home project fetches guarded with `route_not_oauth_ready` in this plan because they need a separate Home auth client and permission review.

**Tech Stack:** Python Flask, `requests`, existing `backend/jira_client.py` retry/search-param helpers, `backend/auth/jira_auth.py`, Python `unittest`, Node source-guard tests, esbuild frontend bundle.

---

## Critical Review

The OAuth login path is working for the small slice already verified:

- `/api/auth/status` reports OAuth authenticated state without token material.
- `/api/test` calls Jira through Atlassian OAuth and returns the current user.
- Full ENG dashboard data still fails with `route_not_oauth_ready`, which is expected until the data routes migrate.

Do not remove the route guard globally. It is the safety gate that prevents empty Basic credentials in OAuth mode. Each route must earn OAuth readiness with tests first.

This plan does not add direct Microsoft Entra bearer-token support. Microsoft Entra remains part of Atlassian Cloud SSO during Atlassian OAuth login. Jira REST calls still use Atlassian OAuth tokens.

This plan also does not require Compass GraphQL API permissions. Compass/Home GraphQL is outside the Jira REST client migration. Keep these EPM Home routes guarded unless a separate Home auth plan migrates them:

- `/api/epm/scope`
- `/api/epm/goals`
- `/api/epm/projects`
- `/api/epm/projects/configuration`
- `/api/epm/projects/preview`
- `/api/epm/projects/rollup/all`
- `/api/epm/projects/<home_project_id>/issues`
- `/api/epm/projects/<project_id>/rollup`

`/api/epm/config` is local configuration and can be OAuth-ready only if tests prove it does not call Jira or Home.

The current scopes are enough only for Jira Platform and identity reads:

- `read:me`
- `read:jira-work`
- `read:jira-user`
- `offline_access`

This plan also migrates Jira Software Agile endpoints for boards and sprints. Those endpoints need Jira Software granular scopes in the Atlassian Developer Console and in `ATLASSIAN_SCOPES`:

- `read:board-scope:jira-software`
- `read:sprint:jira-software`
- `read:project:jira`

Do not migrate `/api/boards` or `/api/sprints` until the scope setup docs, `.env.example`, and default OAuth scopes include these Jira Software scopes. Atlassian documents Jira Software scopes separately from Jira Platform classic scopes; Jira Software does not support classic scopes for those Agile APIs.

Do not migrate any Jira write endpoint in this plan. If a Jira issue create/update route appears during implementation, leave it guarded until the Atlassian app has the exact write scopes required by Atlassian docs and tests prove the route uses the unsafe-method header.

## Route Surface

### OAuth-Ready After This Plan

Auth and current test routes:

- `/login`
- `/api/auth/status`
- `/api/auth/atlassian/login`
- `/api/auth/atlassian/callback`
- `/api/auth/refresh`
- `/api/auth/logout`
- `/api/test`

Local config/bootstrap routes that do not call Jira:

- `/api/config`
- `/api/version`
- `/api/groups-config`
- `/api/team-catalog`
- `/api/projects/selected`
- `/api/board-config`
- `/api/capacity/config`
- `/api/sprint-field/config`
- `/api/story-points-field/config`
- `/api/parent-name-field/config`
- `/api/team-field/config`
- `/api/stats/priority-weights-config`
- `/api/issue-types/config`
- `/api/epm/config`
- `/api/scenario/overrides`

Jira REST read routes:

- `/api/boards`
- `/api/sprints`
- `/api/projects`
- `/api/components`
- `/api/epics/search`
- `/api/jira/labels`
- `/api/issue-types`
- `/api/fields`
- `/api/tasks`
- `/api/tasks-with-team-name`
- `/api/missing-info`
- `/api/dependencies`
- `/api/issues/lookup`
- `/api/teams`
- `/api/teams/resolve`
- `/api/teams/all`
- `/api/backlog-epics`
- `/api/capacity`
- `/api/planned-capacity`
- `/api/stats`
- `/api/stats/burnout`
- `/api/stats/epic-cohort`

Developer-only debug routes may remain guarded unless the implementation migrates and tests them:

- `/api/debug-fields`
- `/api/tasks-fields`

### Keep Guarded

Keep EPM Home/rollup routes guarded in OAuth mode because they call `backend/epm/home.py`, Home GraphQL, and Home/EPM caches that are not part of the Jira REST client boundary in this plan.

## File Structure

Modify these files only unless a named test exposes a required caller:

- `backend/auth/jira_auth.py` - low-level auth-aware Jira URL/header/request helpers.
- `backend/jira_client.py` - search-param helper remains transport-only; no auth decisions.
- `jira_server.py` - request-bound wrappers, route readiness list, remaining root routes, shared Jira helper functions.
- `backend/routes/eng_routes.py` - ENG route handlers move from inline Basic headers to request-bound Jira helpers.
- `backend/routes/settings_routes.py` - settings/catalog route handlers move from inline Basic headers to request-bound Jira helpers.
- `backend/routes/epm_routes.py` - only local `/api/epm/config` readiness if needed; no Home route migration.
- `frontend/src/api/http.js` - central JSON helpers add the unsafe-method header for POSTs.
- `frontend/src/api/configApi.js` - local config POST callers use the central POST helper or include the unsafe-method header.
- `frontend/src/api/engApi.js` - dependency POST includes the unsafe-method header.
- `frontend/src/api/jiraCatalogApi.js` - catalog POST callers include the unsafe-method header.
- `frontend/src/dashboard.jsx` - only add `X-Requested-With: jira-execution-planner` to existing POST fetches for routes migrated in this plan. Do not add auth status, refresh, login UI, token handling, or expired-auth routing here.
- `tests/test_jira_auth.py` - low-level auth helper tests.
- `tests/test_oauth_jira_client.py` - new request-bound Jira client tests.
- `tests/test_oauth_route_guards.py` - route readiness and guarded-route tests.
- `tests/test_oauth_eng_routes.py` - new ENG route OAuth tests.
- `tests/test_oauth_settings_routes.py` - new settings/catalog OAuth tests.
- `tests/test_oauth_stats_routes.py` - new stats/scenario/capacity OAuth tests.
- `tests/test_oauth_jira_client_source_guard.py` - new source guard against direct Basic/Jira URL construction in migrated route surfaces.
- `tests/test_auth_isolation_source_guard.js` - keep dashboard auth isolation; allow CSRF headers only.
- `docs/atlassian-oauth-setup.md` - update the migration status and route coverage note.
- `.env.example` - update comments only if route migration changes the local testing instructions.

Do not hand-edit `frontend/dist/`; run `npm run build` if frontend source changes.

---

## Task 0: OAuth Scope Audit For Planned Jira REST Routes

**Files:**
- Modify: `backend/auth/jira_auth.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `jira_server.py`
- Modify: `.env.example`
- Modify: `docs/atlassian-oauth-setup.md`
- Test: `tests/test_jira_auth.py`
- Test: `tests/test_auth_routes.py`

- [ ] **Step 1: Write failing scope and old-session tests**

Add this test to `tests/test_jira_auth.py` next to `test_default_scopes_include_read_me`:

```python
    def test_default_scopes_include_jira_software_agile_reads(self):
        scopes = set(AuthConfig().scopes.split())

        self.assertIn("read:board-scope:jira-software", scopes)
        self.assertIn("read:sprint:jira-software", scopes)
        self.assertIn("read:project:jira", scopes)
```

Also import `missing_oauth_scopes` from `backend.auth.jira_auth` and add helper coverage for already-issued OAuth sessions that do not have the new scope grant:

```python
    def test_missing_oauth_scopes_detects_old_session(self):
        required = {
            "read:me",
            "read:jira-work",
            "read:jira-user",
            "read:board-scope:jira-software",
            "read:sprint:jira-software",
            "read:project:jira",
            "offline_access",
        }
        session_data = {
            "access_token": "access-123",
            "scope": "read:me read:jira-work read:jira-user offline_access",
        }

        self.assertEqual(
            missing_oauth_scopes(session_data, required),
            {"read:board-scope:jira-software", "read:sprint:jira-software", "read:project:jira"},
        )
```

Add route-level status coverage in `tests/test_auth_routes.py`:

```python
    def test_status_requires_reconsent_when_oauth_session_has_old_scopes(self):
        with self.client.session_transaction() as flask_session:
            flask_session["atlassian_oauth_session_id"] = "session-1"
        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "site_name": "Example",
            "account_id": "account-123",
            "account_status": "active",
            "stored_at": time.time(),
            "scope": "read:me read:jira-work read:jira-user offline_access",
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "ATLASSIAN_SCOPES", "read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access"):
            response = self.client.get("/api/auth/status")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["authenticated"], False)
        self.assertEqual(payload["loginRequired"], True)
        self.assertEqual(payload["loginUrl"], "/login?reason=missing_scope")
        self.assertNotIn("access_token", str(payload))
        self.assertNotIn("refresh_token", str(payload))
```

- [ ] **Step 2: Run the failing scope and old-session tests**

Run:

```bash
python3 -m unittest tests.test_jira_auth.JiraAuthTests.test_default_scopes_include_jira_software_agile_reads tests.test_jira_auth.JiraAuthTests.test_missing_oauth_scopes_detects_old_session tests.test_auth_routes.TestAuthRoutes.test_status_requires_reconsent_when_oauth_session_has_old_scopes
```

Expected: FAIL because the default scopes currently omit Jira Software Agile read scopes and existing OAuth sessions are not checked for stale grants.

- [ ] **Step 3: Update default OAuth scopes and stale-scope detection**

In `backend/auth/jira_auth.py`, change the `AuthConfig.scopes` default to:

```python
scopes: str = "read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access"
```

Add helpers that normalize the configured scope string and the scope grant stored with OAuth token data:

```python
def oauth_scope_set(scopes):
    if isinstance(scopes, str):
        return {scope for scope in scopes.split() if scope}
    if isinstance(scopes, (list, tuple, set)):
        return {str(scope).strip() for scope in scopes if str(scope).strip()}
    return set()


def missing_oauth_scopes(session_data, required_scopes):
    granted = oauth_scope_set((session_data or {}).get("scope") or (session_data or {}).get("granted_scopes"))
    required = oauth_scope_set(required_scopes)
    if not granted:
        return required
    return required - granted
```

When storing token data after the OAuth callback, persist the token response's granted scope string as `scope`. If the token response omits scope, store an empty string so older or unknown sessions require consent after the app's required scopes change.

In `jira_server.py`, change the `ATLASSIAN_SCOPES` default to the same string:

```python
ATLASSIAN_SCOPES = os.getenv(
    'ATLASSIAN_SCOPES',
    'read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access',
).strip()
```

In `backend/routes/auth_routes.py`, make `/api/auth/status` treat missing required scopes as a re-consent requirement. In `jira_server.py`, add the same missing-scope check to the OAuth before-request guard for OAuth-ready API paths before the route handler runs:

```python
if missing_oauth_scopes(session_data, ATLASSIAN_SCOPES):
    login_url = "/login?reason=missing_scope"
    return {
        "authMode": "atlassian_oauth",
        "authenticated": False,
        "loginRequired": True,
        "loginUrl": login_url,
    }
```

For OAuth-ready API paths outside `/api/auth/status`, return `401 {"error": "auth_required", "loginUrl": "/login?reason=missing_scope"}` so the browser can drive the user back through Atlassian consent.

Do not include token material in the status payload. Do not include the user's access token, refresh token, OAuth authorization code, PKCE verifier, or client secret in logs.

- [ ] **Step 4: Update local setup docs and env example**

In `.env.example`, make the OAuth scopes example match the new default:

```text
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access
```

In `docs/atlassian-oauth-setup.md`, update the scope table so setup clearly maps each scope to the Atlassian Developer Console API:

```markdown
| API in Developer Console | Scope | Why this app needs it |
| --- | --- | --- |
| User identity API | `read:me` | Backend calls `https://api.atlassian.com/me` after callback. |
| Jira API | `read:jira-work` | Jira issue, project, field, label, component, and search reads. |
| Jira API | `read:jira-user` | User/profile fields returned by issue and team-related reads. |
| Jira Software API | `read:board-scope:jira-software` | `/rest/agile/1.0/board` board discovery. |
| Jira Software API | `read:sprint:jira-software` | `/rest/agile/1.0/board/{boardId}/sprint` sprint discovery. |
| Jira API | `read:project:jira` | Jira Software board APIs require project read scope. |
| OAuth authorize URL only | `offline_access` | Refresh tokens for local OAuth sessions; this does not appear as a separate API row. |
```

Also add reference links:

```markdown
- Jira Platform OAuth scopes: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Software OAuth scopes: https://developer.atlassian.com/cloud/jira/software/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Software board API scopes: https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- Jira Software sprint API scopes: https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/
```

Add a rollout note:

```markdown
If you already signed in before adding the Jira Software scopes, update `ATLASSIAN_SCOPES`, clear the local OAuth token session, and sign in again. `/api/auth/status` reports `loginUrl: "/login?reason=missing_scope"` when the stored session was issued without the current required scopes.
```

- [ ] **Step 5: Run scope and auth tests**

Run:

```bash
python3 -m unittest tests.test_jira_auth tests.test_auth_routes
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/auth/jira_auth.py backend/routes/auth_routes.py jira_server.py .env.example docs/atlassian-oauth-setup.md tests/test_jira_auth.py tests/test_auth_routes.py
git commit -m "Document Jira Software OAuth scopes"
```

---

## Task 1: Request-Bound Jira API Wrapper

**Files:**
- Modify: `backend/auth/jira_auth.py`
- Modify: `jira_server.py`
- Test: `tests/test_jira_auth.py`
- Test: `tests/test_oauth_jira_client.py`

- [ ] **Step 1: Write failing tests for auth-aware Jira search and GET**

Create `tests/test_oauth_jira_client.py`:

```python
import time
import unittest
from unittest.mock import patch

from flask import session

import jira_server


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthJiraClientTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def _push_oauth_request(self):
        request_context = jira_server.app.test_request_context("/")
        request_context.push()
        self.addCleanup(request_context.pop)
        session["atlassian_oauth_session_id"] = "session-1"
        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "site_name": "Example",
            "account_id": "account-123",
            "account_status": "active",
            "stored_at": time.time(),
        }

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_current_jira_get_oauth_uses_gateway_and_bearer_token(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"ok": True})

        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_get("/rest/api/3/project/search", params={"maxResults": 1})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/project/search")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")
        self.assertEqual(calls[0][1]["params"], {"maxResults": 1})

    def test_current_jira_search_oauth_uses_search_jql_params(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"issues": []})

        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_search({
                "jql": 'project = "PROD"',
                "fields": ["summary", "status"],
                "maxResults": 50,
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search/jql")
        self.assertEqual(calls[0][1]["params"]["fields"], "summary,status")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")

    def test_current_jira_get_auth_required_returns_stable_payload(self):
        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            payload, status = jira_server.oauth_auth_required_payload()

        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "auth_required")
        self.assertEqual(payload["loginUrl"], "/login?reason=session_expired")
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
python3 -m unittest tests.test_oauth_jira_client
```

Expected: FAIL because `current_jira_get`, `current_jira_search`, and `oauth_auth_required_payload` do not exist.

- [ ] **Step 3: Add generic request helpers**

In `backend/auth/jira_auth.py`, add a generic request helper below `jira_post` without changing existing `jira_get` and `jira_post` signatures:

```python
def jira_request(
    config,
    context,
    session_data,
    method,
    path,
    http_request,
    save_session=None,
    reload_session=None,
    refresh_lock=None,
    refresh_http_post=requests.post,
    **kwargs,
):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(
        config,
        session_data,
        save_session,
        http_post=refresh_http_post,
        reload_session=reload_session,
        refresh_lock=refresh_lock,
    )
    return http_request(
        method,
        build_jira_api_url(config, context, path),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )
```

In `jira_server.py`, import `jira_request` and add request-bound wrappers near `current_request_auth_context()`:

```python
def oauth_auth_required_payload():
    save_oauth_session({})
    return {
        'error': 'auth_required',
        'message': 'Your Jira sign-in expired. Sign in again to continue.',
        'loginUrl': '/login?reason=session_expired',
    }, 401


def current_jira_get(path, *, params=None, timeout=30, context=None):
    auth_context = context or current_request_auth_context()

    def request_get(url, **kwargs):
        return resilient_jira_get(
            url,
            session=HTTP_SESSION,
            breaker=JIRA_SEARCH_CIRCUIT_BREAKER,
            **kwargs,
        )

    return jira_get(
        current_auth_config(),
        auth_context,
        jira_session_data(),
        path,
        http_get=request_get,
        save_session=save_oauth_session,
        reload_session=oauth_session_data,
        refresh_lock=oauth_refresh_lock(),
        params=params,
        timeout=timeout,
    )


def current_jira_search(payload, *, context=None, timeout=30):
    return current_jira_get(
        '/rest/api/3/search/jql',
        params=_jira_client.build_jira_search_params(payload),
        timeout=timeout,
        context=context,
    )


def current_jira_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
    auth_context = context or current_request_auth_context()

    def request_fn(method_name, url, **kwargs):
        return HTTP_SESSION.request(method_name, url, **kwargs)

    kwargs = {'timeout': timeout}
    if json_body is not None:
        kwargs['json'] = json_body
    if params is not None:
        kwargs['params'] = params
    return jira_request(
        current_auth_config(),
        auth_context,
        jira_session_data(),
        method,
        path,
        request_fn,
        save_session=save_oauth_session,
        reload_session=oauth_session_data,
        refresh_lock=oauth_refresh_lock(),
        **kwargs,
    )
```

Keep `build_jira_headers()` in `jira_server.py` as a Basic-only legacy guard. Do not make it OAuth-aware.

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.test_oauth_jira_client tests.test_jira_auth tests.test_oauth_route_guards
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/auth/jira_auth.py jira_server.py tests/test_jira_auth.py tests/test_oauth_jira_client.py
git commit -m "Add OAuth-aware Jira request wrappers"
```

---

## Task 2: Shared Jira Helper Migration

**Files:**
- Modify: `jira_server.py`
- Modify: `tests/test_backend_service_extraction.py`
- Modify: `tests/test_sprint_dates.py`
- Test: `tests/test_oauth_jira_client.py`

- [ ] **Step 1: Write failing tests for shared helper behavior**

Extend `tests/test_oauth_jira_client.py`:

```python
    def test_jira_search_request_uses_current_auth_boundary(self):
        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": []})) as mock_search:
            response = jira_server.jira_search_request({"jql": 'project = "PROD"', "fields": ["summary"]})

        self.assertEqual(response.status_code, 200)
        mock_search.assert_called_once_with({"jql": 'project = "PROD"', "fields": ["summary"]})

    def test_resolve_team_field_id_uses_current_jira_get_in_oauth_mode(self):
        self._push_oauth_request()
        fields_payload = [
            {"id": "customfield_12345", "name": "Team[Team]"},
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "TEAM_FIELD_CACHE", None), \
             patch.object(jira_server, "get_team_field_id", return_value=""), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, fields_payload)) as mock_get:
            field_id = jira_server.resolve_team_field_id(None, context=jira_server.current_request_auth_context())

        self.assertEqual(field_id, "customfield_12345")
        mock_get.assert_called_once_with("/rest/api/3/field", timeout=20, context=jira_server.current_request_auth_context())
```

- [ ] **Step 2: Run the failing helper tests**

Run:

```bash
python3 -m unittest tests.test_oauth_jira_client
```

Expected: FAIL because `jira_search_request` still requires legacy `headers`, and field resolvers still call `requests.get(f'{JIRA_URL}/rest/api/3/field', ...)`.

- [ ] **Step 3: Migrate shared helpers to request-bound calls**

In `jira_server.py`, change `jira_search_request` to the new single-payload signature:

```python
def jira_search_request(payload):
    """Call Jira search endpoint through the active request auth boundary."""
    return current_jira_search(payload)
```

Update every internal caller in `jira_server.py`, `backend/routes/eng_routes.py`, and `backend/routes/settings_routes.py` from:

```python
response = jira_search_request(headers, payload)
```

to:

```python
response = jira_search_request(payload)
```

Update field and Jira GET helpers in `jira_server.py`:

- `resolve_team_field_id(headers, context=None)`
- `resolve_epic_link_field_id(headers, names_map=None, context=None)`
- `resolve_capacity_field_id(headers, context=None)`
- `fetch_watchers_count(issue_key, headers)`
- `_cohort_fetch_terminal_date_from_changelog(issue_key, target_status, headers)`

Keep their current parameters during this task for compatibility, but ignore `headers` for HTTP. Use `current_jira_get(...)` with `context=context` where available:

```python
response = current_jira_get('/rest/api/3/field', timeout=20, context=context)
```

For issue watchers:

```python
response = current_jira_get(f'/rest/api/3/issue/{issue_key}/watchers', timeout=20)
```

For changelog:

```python
response = current_jira_get(
    f'/rest/api/3/issue/{issue_key}',
    params={'fields': 'status', 'expand': 'changelog'},
    timeout=20,
)
```

Do not remove the legacy `headers` argument yet; this keeps the diff small while the route batches are migrated.

- [ ] **Step 4: Update tests that patch `jira_search_request`**

Where tests patch or call `jira_search_request(headers, payload)`, update them to patch/call `jira_search_request(payload)`. Keep response payloads unchanged.

First inventory every affected test:

```bash
rg -n "jira_search_request|def fake_search\\(|call_args.*\\[1\\]|args\\[1\\]" tests -g '*.py'
```

Expected before edits: hits include `tests/test_backend_service_extraction.py`, `tests/test_group_excluded_capacity_epics_api.py`, `tests/test_burnout_stats_api.py`, `tests/test_epic_cohort_api.py`, `tests/test_sprint_dates.py`, `tests/test_create_stories_alert.py`, `tests/test_initiative_extraction.py`, and `tests/test_backend_route_source_guards.py`.

Example in `tests/test_backend_service_extraction.py`:

```python
with patch.object(jira_server, 'current_jira_search', return_value=sentinel.response) as mock_search:
    response = jira_server.jira_search_request({'jql': 'project = "PROD"', 'maxResults': 1})

self.assertIs(response, sentinel.response)
mock_search.assert_called_once_with({'jql': 'project = "PROD"', 'maxResults': 1})
```

For side effects, change two-argument fakes:

```python
def fake_search(_headers, payload):
    calls.append(payload)
    return DummyResponse({'issues': []})
```

to:

```python
def fake_search(payload):
    calls.append(payload)
    return DummyResponse({'issues': []})
```

For call assertions, change `mock_search.call_args[0][1]` and `mock_search.call_args_list[0].args[1]` to index `0`:

```python
called_payload = mock_search.call_args[0][0]
first_payload = mock_search.call_args_list[0].args[0]
```

After edits, re-run:

```bash
rg -n "def fake_search\\([^)]*,[^)]*\\)|call_args.*\\[1\\]|args\\[1\\]" tests -g '*.py'
```

Expected: no hits for Jira search helper fakes/assertions.

- [ ] **Step 5: Run helper and affected unit tests**

Run:

```bash
python3 -m unittest tests.test_oauth_jira_client tests.test_backend_service_extraction tests.test_sprint_dates tests.test_create_stories_alert tests.test_initiative_extraction tests.test_burnout_stats_api tests.test_epic_cohort_api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jira_server.py backend/routes/eng_routes.py backend/routes/settings_routes.py tests/test_oauth_jira_client.py tests/test_backend_service_extraction.py tests/test_sprint_dates.py tests/test_create_stories_alert.py tests/test_initiative_extraction.py tests/test_burnout_stats_api.py tests/test_epic_cohort_api.py
git commit -m "Migrate shared Jira helpers to auth context"
```

---

## Task 2A: Convert Jira Issue Search Pagination

**Files:**
- Modify: `backend/jira_client.py`
- Modify: `jira_server.py`
- Modify: `backend/routes/eng_routes.py`
- Modify: `backend/routes/settings_routes.py`
- Test: `tests/test_backend_service_extraction.py`
- Test: `tests/test_jira_search_pagination_source_guard.py`
- Test: affected route/helper tests

Atlassian's `/rest/api/3/search/jql` endpoint is token-paginated. It accepts `nextPageToken`, not `startAt`. Agile board and sprint discovery endpoints still use `startAt`; do not convert those `current_jira_get(... /rest/agile/...)` calls.

References:

- Jira issue search: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
- Jira Software board API: https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- Jira Software sprint API: https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/

- [ ] **Step 1: Inventory Jira issue-search pagination callers**

Run:

```bash
rg -n "jira_search_request\\(|current_jira_search\\(|['\\\"]startAt['\\\"]|nextPageToken" jira_server.py backend/routes tests -g '*.py'
```

Classify every hit:

- Jira issue search through `jira_search_request` / `current_jira_search`: must use `nextPageToken`.
- Agile board/sprint calls through `current_jira_get` / `resilient_jira_get` to `/rest/agile/...`: keep `startAt`.
- Tests and fixtures: update expected payloads when the production call was converted.

- [ ] **Step 2: Write failing pagination tests and source guard**

In `tests/test_backend_service_extraction.py`, add coverage that the shared Jira search param builder rejects `startAt` for `/rest/api/3/search/jql`:

```python
    def test_search_params_reject_start_at_for_search_jql(self):
        jira_client = importlib.import_module("backend.jira_client")
        with self.assertRaises(ValueError):
            jira_client.build_jira_search_params({"jql": "project = PROD", "startAt": 50, "maxResults": 100})

    def test_search_params_allow_next_page_token(self):
        jira_client = importlib.import_module("backend.jira_client")
        params = jira_client.build_jira_search_params({
            "jql": "project = PROD",
            "nextPageToken": "page-2",
            "maxResults": 100,
        })

        self.assertEqual(params["nextPageToken"], "page-2")
        self.assertNotIn("startAt", params)
```

Create `tests/test_jira_search_pagination_source_guard.py`:

```python
import re
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SEARCH_FILES = [
    REPO_ROOT / "jira_server.py",
    REPO_ROOT / "backend" / "routes" / "eng_routes.py",
    REPO_ROOT / "backend" / "routes" / "settings_routes.py",
]


class JiraSearchPaginationSourceGuardTests(unittest.TestCase):
    def test_issue_search_payloads_do_not_use_start_at(self):
        offenders = []
        for path in SEARCH_FILES:
            lines = path.read_text(encoding="utf8").splitlines()
            for index, line in enumerate(lines):
                if "jira_search_request(" not in line and "current_jira_search(" not in line:
                    continue
                window = "\n".join(lines[max(0, index - 20):index + 1])
                if re.search(r"['\"]startAt['\"]", window):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{index + 1}")

        self.assertEqual(offenders, [])
```

This guard is intentionally narrow: it checks the local construction window before Jira issue search calls and does not ban `startAt` in Agile board/sprint `current_jira_get` calls. If the guard false-positives because an unrelated Agile `startAt` is adjacent to an issue search call, refactor the code so those concerns are separated instead of weakening the guard.

- [ ] **Step 3: Run the failing pagination tests**

Run:

```bash
python3 -m unittest tests.test_backend_service_extraction tests.test_jira_search_pagination_source_guard
```

Expected: FAIL because `build_jira_search_params` still forwards `startAt`, and several issue-search payloads still use `startAt`.

- [ ] **Step 4: Convert issue-search callers to token pagination**

In `backend/jira_client.py`, remove `startAt` from the allowed `/rest/api/3/search/jql` params and fail fast if a caller still passes it:

```python
def build_jira_search_params(payload):
    if "startAt" in payload:
        raise ValueError("/rest/api/3/search/jql uses nextPageToken, not startAt")
    ...
    for key in ("jql", "maxResults", "expand", "fields", "fieldsByKeys", "nextPageToken"):
        ...
```

Convert every loop that calls `jira_search_request(payload)` with `startAt` to the token pattern:

```python
next_page_token = None
while True:
    payload = {
        "jql": jql,
        "maxResults": 100,
        "fields": fields,
    }
    if next_page_token:
        payload["nextPageToken"] = next_page_token

    response = jira_search_request(payload)
    data = response.json()
    issues.extend(data.get("issues") or [])

    next_page_token = data.get("nextPageToken")
    if data.get("isLast", not next_page_token) or not next_page_token:
        break
```

Do not keep `start_at += ...` fallbacks for `/rest/api/3/search/jql`. If the endpoint does not return `nextPageToken` and does not explicitly say `isLast: false`, stop after the current page.

Keep these `startAt` calls unchanged because they are Agile APIs:

- `GET /rest/agile/1.0/board`
- `GET /rest/agile/1.0/board/{boardId}/sprint`

- [ ] **Step 5: Run pagination and affected route/helper tests**

Run:

```bash
python3 -m unittest tests.test_backend_service_extraction tests.test_jira_search_pagination_source_guard tests.test_oauth_jira_client tests.test_oauth_eng_routes tests.test_oauth_settings_routes tests.test_oauth_stats_routes tests.test_burnout_stats_api tests.test_epic_cohort_api tests.test_group_excluded_capacity_epics_api tests.test_sprint_dates
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/jira_client.py jira_server.py backend/routes/eng_routes.py backend/routes/settings_routes.py tests/test_backend_service_extraction.py tests/test_jira_search_pagination_source_guard.py tests/test_oauth_jira_client.py tests/test_oauth_eng_routes.py tests/test_oauth_settings_routes.py tests/test_oauth_stats_routes.py tests/test_burnout_stats_api.py tests/test_epic_cohort_api.py tests/test_group_excluded_capacity_epics_api.py tests/test_sprint_dates.py
git commit -m "Convert Jira issue search to token pagination"
```

---

## Task 3: ENG Route Migration

**Files:**
- Modify: `backend/routes/eng_routes.py`
- Modify: `jira_server.py`
- Modify: `frontend/src/api/engApi.js`
- Test: `tests/test_oauth_eng_routes.py`
- Test: `tests/test_oauth_route_guards.py`

- [ ] **Step 1: Write failing ENG route tests**

Create `tests/test_oauth_eng_routes.py`:

```python
import time
import unittest
from unittest.mock import patch

import jira_server


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthEngRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()
        with self.client.session_transaction() as flask_session:
            flask_session["atlassian_oauth_session_id"] = "session-1"
        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "site_name": "Example",
            "account_id": "account-123",
            "account_status": "active",
            "stored_at": time.time(),
        }

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_tasks_with_team_name_is_oauth_ready(self):
        issue = {
            "id": "10001",
            "key": "PROD-1",
            "fields": {
                "summary": "Synthetic task",
                "status": {"name": "To Do"},
                "priority": {"name": "Major"},
                "issuetype": {"name": "Story"},
                "assignee": {"displayName": "Synthetic Owner"},
                "updated": "2026-05-01T00:00:00.000+0000",
                "customfield_sp": 3,
                "customfield_sprint": [{"id": 42, "name": "2026Q2"}],
                "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
                "parent": {},
                "project": {"key": "PROD", "name": "Product"},
            },
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [issue],
                 "names": {"customfield_team": "Team[Team]"},
                 "isLast": True,
             })) as mock_search, \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_tasks_with_team_name_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "current_jira_search", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_dependencies_requires_oauth_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/dependencies", json={"keys": ["PROD-1"]})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_dependencies_is_oauth_ready_with_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", return_value={"PROD-1": []}):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"dependencies": {"PROD-1": []}})
```

- [ ] **Step 2: Run the failing ENG tests**

Run:

```bash
python3 -m unittest tests.test_oauth_eng_routes tests.test_oauth_route_guards
```

Expected: FAIL because ENG paths are not in `OAUTH_READY_API_PATHS` and some handlers still build Basic headers inline.

- [ ] **Step 3: Replace inline Basic headers in `backend/routes/eng_routes.py`**

Remove every block shaped like:

```python
auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
auth_bytes = auth_string.encode('ascii')
auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
headers = {
    'Authorization': f'Basic {auth_base64}',
    'Accept': 'application/json',
    'Content-Type': 'application/json'
}
```

Use existing helpers directly:

```python
dependencies = collect_dependencies(keys, None)
team_field_id = resolve_team_field_id(None, context=current_request_auth_context())
epic_link_field_id = resolve_epic_link_field_id(None, context=current_request_auth_context())
issues.extend(fetch_issues_by_keys(unique_keys, None, fields_list))
response = jira_search_request(payload)
```

The `headers` argument remains present in shared helper signatures during this task but must not be constructed in route handlers.

- [ ] **Step 4: Add ENG auth-required recovery before route readiness**

Before editing `OAUTH_READY_API_PATHS`, update the migrated ENG handlers that call Jira so `AuthError("auth_required", ...)` returns the stable expired-session JSON:

```python
except AuthError as error:
    if error.code == "auth_required":
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    raise
```

At minimum, `test_tasks_with_team_name_expired_oauth_returns_login_url` must pass in the same commit that makes `/api/tasks-with-team-name` OAuth-ready. Do not add an ENG route to `OAUTH_READY_API_PATHS` if an expired OAuth session can still fall into a broad `except Exception` and return 500.

- [ ] **Step 5: Add ENG routes to OAuth readiness**

Before editing `OAUTH_READY_API_PATHS`, run:

```bash
rg -n "JIRA_EMAIL|JIRA_TOKEN|base64|build_jira_headers\\(|JIRA_URL.*/rest" backend/routes/eng_routes.py
```

Expected: no hits for Basic auth construction or direct Jira REST URL construction. Do not mark ENG routes OAuth-ready until this is clean.

In `jira_server.py`, expand `OAUTH_READY_API_PATHS`:

```python
OAUTH_READY_API_PATHS = {
    '/api/test',
    '/api/tasks',
    '/api/tasks-with-team-name',
    '/api/missing-info',
    '/api/dependencies',
    '/api/issues/lookup',
    '/api/teams',
    '/api/teams/resolve',
    '/api/teams/all',
    '/api/backlog-epics',
}
```

- [ ] **Step 6: Add unsafe-method header to ENG dependency POST**

In `frontend/src/api/engApi.js`, update `fetchDependencies`:

```javascript
export const fetchDependencies = (backendUrl, keys, { signal } = {}) =>
    fetch(`${backendUrl}/api/dependencies`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
        },
        body: JSON.stringify({ keys }),
        signal
    });
```

- [ ] **Step 7: Run ENG tests and source guard**

Run:

```bash
python3 -m unittest tests.test_oauth_eng_routes tests.test_oauth_route_guards tests.test_backend_route_source_guards
node tests/test_auth_isolation_source_guard.js
```

Expected: PASS.

- [ ] **Step 8: Build frontend if `engApi.js` changed**

Run:

```bash
npm run build
```

Expected: PASS. Do not manually edit `frontend/dist/`.

- [ ] **Step 9: Commit**

```bash
git add backend/routes/eng_routes.py jira_server.py frontend/src/api/engApi.js frontend/dist tests/test_oauth_eng_routes.py tests/test_oauth_route_guards.py
git commit -m "Migrate ENG Jira routes to OAuth client"
```

---

## Task 4: Settings And Catalog Route Migration

**Files:**
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `jira_server.py`
- Modify: `frontend/src/api/http.js`
- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/api/jiraCatalogApi.js`
- Modify: `frontend/src/dashboard.jsx`
- Test: `tests/test_oauth_settings_routes.py`
- Test: `tests/test_oauth_route_guards.py`

- [ ] **Step 1: Write failing settings/catalog tests**

Create `tests/test_oauth_settings_routes.py`:

```python
import time
import unittest
from unittest.mock import patch

import jira_server


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthSettingsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()
        with self.client.session_transaction() as flask_session:
            flask_session["atlassian_oauth_session_id"] = "session-1"
        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "site_name": "Example",
            "account_id": "account-123",
            "account_status": "active",
            "stored_at": time.time(),
        }

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_config_is_oauth_ready_and_uses_session_site_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["jiraUrl"], "https://example.atlassian.net")

    def test_projects_route_uses_oauth_client(self):
        payload = {"values": [{"key": "PROD", "name": "Product", "id": "10000"}], "isLast": True}
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, payload)) as mock_get:
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["projects"][0]["key"], "PROD")
        mock_get.assert_called()

    def test_projects_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_labels_route_bypasses_process_cache_for_oauth(self):
        first = FakeResponse(200, {"values": ["alpha"], "isLast": True})
        second = FakeResponse(200, {"values": ["beta"], "isLast": True})
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", side_effect=[first, second]):
            response_one = self.client.get("/api/jira/labels")
            response_two = self.client.get("/api/jira/labels")

        self.assertEqual(response_one.get_json()["labels"], ["alpha"])
        self.assertEqual(response_two.get_json()["labels"], ["beta"])

    def test_local_config_post_requires_csrf_header_in_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/board-config", json={"boardId": "42"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")
```

- [ ] **Step 2: Run the failing settings tests**

Run:

```bash
python3 -m unittest tests.test_oauth_settings_routes tests.test_oauth_route_guards
```

Expected: FAIL because settings/catalog routes are guarded and still construct Basic headers directly.

- [ ] **Step 3: Migrate settings Jira GET routes**

Replace direct Jira requests in `backend/routes/settings_routes.py`:

```python
response = requests.get(f'{JIRA_URL}/rest/agile/1.0/board', headers=headers, params=params, timeout=30)
```

with:

```python
response = current_jira_get('/rest/agile/1.0/board', params=params, timeout=30)
```

Apply the same pattern to:

- `/rest/agile/1.0/board/{query}`
- `/rest/api/3/project/search`
- `/rest/api/3/project/{project_key}/components`
- `/rest/api/3/label`
- `/rest/api/3/issuetype`
- `/rest/api/3/issue/createmeta/{project_key}/issuetypes`
- `/rest/api/3/issue/createmeta/{project_key}/issuetypes/{it_id}`
- `/rest/api/3/field`

Keep Agile board/sprint pagination on `startAt` because the Agile API uses that contract. Task 2A already converted Jira issue search pagination to `nextPageToken`; do not reintroduce `startAt` in any `jira_search_request` payload.

- [ ] **Step 4: Return OAuth session site URL from config**

In `/api/config`, use the request context site URL instead of process-global `JIRA_URL` when OAuth is active:

```python
auth_context = current_request_auth_context()
jira_url = auth_context.site_url or JIRA_URL
```

Return `jiraUrl: jira_url` and keep the rest of the response shape unchanged.

- [ ] **Step 5: Keep process caches disabled for OAuth users**

Wrap reads and writes of these caches with `jira_home_process_cache_enabled(current_request_auth_context())`:

- `PROJECTS_CACHE`
- `COMPONENTS_CACHE`
- `EPICS_SEARCH_CACHE`
- `LABELS_CACHE`
- `ISSUE_TYPES_CACHE`

Example:

```python
auth_context = current_request_auth_context()
cache_enabled = jira_home_process_cache_enabled(auth_context)
with _cache_lock:
    if cache_enabled and cached_labels and not refresh and (time.time() - cached_ts) < LABELS_CACHE_TTL:
        labels = cached_labels
```

Only write to these caches when `cache_enabled` is true.

- [ ] **Step 6: Add settings auth-required recovery before route readiness**

Before editing `OAUTH_READY_API_PATHS`, update migrated settings/catalog handlers that call Jira so `AuthError("auth_required", ...)` returns:

```python
payload, status = oauth_auth_required_payload()
return jsonify(payload), status
```

At minimum, `test_projects_expired_oauth_returns_login_url` must pass in the same commit that makes `/api/projects` OAuth-ready. Do not add a settings/catalog route to `OAUTH_READY_API_PATHS` if an expired OAuth session can still fall into a broad `except Exception` and return 500.

- [ ] **Step 7: Add local and catalog routes to OAuth readiness**

Before editing `OAUTH_READY_API_PATHS`, run:

```bash
rg -n "JIRA_EMAIL|JIRA_TOKEN|base64|build_jira_headers\\(|JIRA_URL.*/rest" backend/routes/settings_routes.py
```

Expected: no hits for Basic auth construction or direct Jira REST URL construction. Do not mark settings/catalog routes OAuth-ready until this is clean.

Expand `OAUTH_READY_API_PATHS` in `jira_server.py` with settings/config routes:

```python
    '/api/config',
    '/api/version',
    '/api/groups-config',
    '/api/team-catalog',
    '/api/projects',
    '/api/components',
    '/api/epics/search',
    '/api/jira/labels',
    '/api/projects/selected',
    '/api/capacity/config',
    '/api/board-config',
    '/api/sprint-field/config',
    '/api/story-points-field/config',
    '/api/parent-name-field/config',
    '/api/team-field/config',
    '/api/stats/priority-weights-config',
    '/api/issue-types',
    '/api/issue-types/config',
    '/api/fields',
    '/api/boards',
    '/api/epm/config',
```

Do not add Home/EPM data routes.

- [ ] **Step 8: Add unsafe-method headers to frontend API helpers**

In `frontend/src/api/http.js`, update `postJson`:

```javascript
export function postJson(url, body, label, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('X-Requested-With')) {
        headers.set('X-Requested-With', 'jira-execution-planner');
    }

    return fetch(url, {
        ...options,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    }).then(response => json(response, label));
}
```

Update `configApi.js` and `jiraCatalogApi.js` direct POST `fetch(...)` calls to include:

```javascript
headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
}
```

Also update the existing `/api/epm/config` POST in `frontend/src/dashboard.jsx` in this task, because `/api/epm/config` becomes OAuth-ready in this task:

```javascript
headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
}
```

- [ ] **Step 9: Run settings tests and frontend build**

Run:

```bash
python3 -m unittest tests.test_oauth_settings_routes tests.test_oauth_route_guards tests.test_oauth_cache_isolation
node tests/test_auth_isolation_source_guard.js
npm run build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/routes/settings_routes.py backend/routes/epm_routes.py jira_server.py frontend/src/api/http.js frontend/src/api/configApi.js frontend/src/api/jiraCatalogApi.js frontend/src/dashboard.jsx frontend/dist tests/test_oauth_settings_routes.py tests/test_oauth_route_guards.py
git commit -m "Migrate settings Jira catalog routes to OAuth"
```

---

## Task 5: Sprints, Capacity, Stats, And Scenario Migration

**Files:**
- Modify: `jira_server.py`
- Modify: `frontend/src/dashboard.jsx`
- Test: `tests/test_oauth_stats_routes.py`
- Test: existing stats/scenario tests

- [ ] **Step 1: Write failing OAuth tests for remaining Jira read routes**

Create `tests/test_oauth_stats_routes.py`:

```python
import time
import unittest
from unittest.mock import patch

import jira_server


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthStatsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()
        with self.client.session_transaction() as flask_session:
            flask_session["atlassian_oauth_session_id"] = "session-1"
        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "site_name": "Example",
            "account_id": "account-123",
            "account_status": "active",
            "stored_at": time.time(),
        }

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_sprints_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "is_cache_valid", return_value=True), \
             patch.object(jira_server, "load_sprints_cache", side_effect=AssertionError("OAuth must not read sprints file cache")), \
             patch.object(jira_server, "save_sprints_cache") as mock_save_cache, \
             patch.object(jira_server, "get_effective_board_id", return_value="42"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": [{"id": 42, "name": "2026Q2", "state": "active", "originBoardId": 42}],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/sprints")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["sprints"][0]["name"], "2026Q2")
        mock_get.assert_called()
        mock_save_cache.assert_not_called()

    def test_capacity_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_capacity_field_id", return_value="customfield_capacity"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [{
                     "key": "CAP-1",
                     "fields": {
                         "summary": "Team info 2026Q2 - Alpha",
                         "customfield_capacity": 5,
                     },
                 }]
             })) as mock_search:
            response = self.client.get("/api/capacity?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["enabled"], True)
        self.assertEqual(response.get_json()["capacities"], {"Alpha": 5.0})
        mock_search.assert_called()

    def test_stats_route_bypasses_file_cache_for_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_stats_cache", side_effect=AssertionError("OAuth must not read stats file cache")), \
             patch.object(jira_server, "save_stats_cache") as mock_save_cache, \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "fetch_stats_for_sprint", return_value=({"teams": []}, None)):
            response = self.client.get("/api/stats?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["data"], {"teams": []})
        mock_save_cache.assert_not_called()

    def test_stats_route_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/stats?sprint=2026Q2")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_scenario_route_bypasses_sprint_cache_for_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_sprints_cache", side_effect=AssertionError("OAuth must not read sprints file cache")), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "fetch_issues_by_jql", return_value=[]), \
             patch.object(jira_server, "collect_dependencies", return_value={}), \
             patch.object(jira_server, "fetch_capacity_for_sprint", return_value=({"enabled": False, "capacities": {}}, None)):
            response = self.client.post(
                "/api/scenario",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"filters": {"sprint": "2026Q2"}, "config": {}},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_burnout_route_bypasses_sprint_cache_for_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_sprints_cache", side_effect=AssertionError("OAuth must not read sprints file cache")), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [], "isLast": True})):
            response = self.client.get("/api/stats/burnout?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_stats_burnout_post_requires_oauth_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/stats/burnout", json={"sprint": "2026Q2"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_unmigrated_epm_home_route_stays_guarded(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/epm/projects")

        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.get_json()["error"], "route_not_oauth_ready")
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
python3 -m unittest tests.test_oauth_stats_routes tests.test_oauth_route_guards
```

Expected: FAIL because these route paths are still guarded and root handlers still construct Basic headers.

- [ ] **Step 3: Migrate root Jira helpers and routes**

In `jira_server.py`, remove direct Basic header blocks from:

- `fetch_sprints_from_jira`
- `fetch_capacity_team_sizes`
- `get_completed_sprint_stats`
- `get_burnout_stats`
- `get_epic_cohort_stats`
- `get_capacity`
- `scenario_planner`

Use `None` for legacy `headers` parameters until Task 6 removes those parameters:

```python
team_field_id = resolve_team_field_id(None, context=current_request_auth_context())
issues_raw = fetch_issues_by_jql(scenario_jql, None, fields_list)
dependencies = collect_dependencies(issue_keys, None)
payload, error_message = fetch_capacity_for_sprint(sprint_name, None, debug=debug, team_names=team_names)
```

For direct Agile sprint calls inside `fetch_sprints_from_jira`, use:

```python
response = current_jira_get(
    f'/rest/agile/1.0/board/{effective_board_id}/sprint',
    params={'maxResults': 100, 'startAt': start_at, 'state': 'active,future,closed'},
    timeout=30,
)
```

For search calls, use:

```python
response = jira_search_request(payload)
```

For browser links in response payloads, use the request context site URL:

```python
jira_base_url = current_request_auth_context().site_url or (JIRA_URL or '').rstrip('/')
```

For file-backed Jira-derived caches, keep Basic behavior but bypass reads and writes in OAuth mode:

```python
auth_context = current_request_auth_context()
cache_enabled = jira_home_process_cache_enabled(auth_context)
```

Apply that policy to:

- `load_sprints_cache()` / `save_sprints_cache()` in `/api/sprints`.
- `load_stats_cache()` / `save_stats_cache()` in `/api/stats`.
- Scenario sprint boundary reads in `scenario_planner`.
- Sprint date lookup in `resolve_sprint_date_bounds`, which is used by burnout stats.

Update sprint-cache helpers that are shared by OAuth-ready routes to accept `context=None` or `cache_enabled=None`, and pass `current_request_auth_context()` from the route. In OAuth mode, fall back to quarter-derived dates or `sprintBoundaries: None`; do not read global sprint metadata from `sprints_cache.json`.

After edits, run:

```bash
rg -n "load_sprints_cache\\(|save_sprints_cache\\(|load_stats_cache\\(|save_stats_cache\\(" jira_server.py backend/routes
```

Expected: every remaining read/write in an OAuth-ready route is guarded by `jira_home_process_cache_enabled(current_request_auth_context())` or moved behind an auth-keyed cache. Do not read or write `sprints_cache.json` or `stats_cache.json` for OAuth users unless a later task auth-keys those files with `build_auth_cache_key(context, ...)`.

- [ ] **Step 4: Add stats/scenario auth-required recovery before route readiness**

Before editing `OAUTH_READY_API_PATHS`, update the migrated stats/scenario handlers that call Jira so `AuthError("auth_required", ...)` returns:

```python
payload, status = oauth_auth_required_payload()
return jsonify(payload), status
```

At minimum, `test_stats_route_expired_oauth_returns_login_url` must pass in the same commit that makes `/api/stats` OAuth-ready. Do not add a stats/scenario route to `OAUTH_READY_API_PATHS` if an expired OAuth session can still fall into a broad `except Exception` and return 500.

- [ ] **Step 5: Add route readiness**

Before editing `OAUTH_READY_API_PATHS`, run:

```bash
rg -n "JIRA_EMAIL|JIRA_TOKEN|base64|build_jira_headers\\(|JIRA_URL.*/rest|resilient_jira_get\\(" jira_server.py
```

Expected: any remaining hits are only in intentionally guarded legacy/debug/EPM sections: `build_jira_headers()`, `/api/debug-fields`, `/api/tasks-fields`, and EPM Home/Jira rollup routes that are not added to `OAUTH_READY_API_PATHS`. Do not add sprint/capacity/stats/scenario routes to `OAUTH_READY_API_PATHS` while their execution path still contains a direct Basic header block or direct `JIRA_URL` REST call.

Add these paths to `OAUTH_READY_API_PATHS`:

```python
    '/api/sprints',
    '/api/capacity',
    '/api/planned-capacity',
    '/api/scenario',
    '/api/scenario/overrides',
    '/api/stats',
    '/api/stats/burnout',
    '/api/stats/epic-cohort',
```

Keep `/api/debug-fields` and `/api/tasks-fields` guarded unless they are explicitly migrated and tested in the same task.

- [ ] **Step 6: Add unsafe-method headers to existing dashboard POSTs**

Only add the CSRF header to existing POST calls. Do not add auth status, refresh, login, token storage, or expired-session handling to `frontend/src/dashboard.jsx`.

For each direct POST in `frontend/src/dashboard.jsx`, include:

```javascript
headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
}
```

This applies to current POST calls for:

- `/api/scenario`
- `/api/stats/burnout`
- `/api/stats/epic-cohort`
- `/api/scenario/overrides`

Do not add EPM Home data routes to OAuth readiness in this task.

- [ ] **Step 7: Run stats/scenario tests and frontend guard**

Run:

```bash
python3 -m unittest tests.test_oauth_stats_routes tests.test_burnout_stats_api tests.test_epic_cohort_api tests.test_group_excluded_capacity_epics_api tests.test_sprint_dates
node tests/test_auth_isolation_source_guard.js
npm run build
```

Expected: PASS. The Node source guard must still reject auth status/refresh/login logic in `frontend/src/dashboard.jsx`; CSRF headers are allowed.

- [ ] **Step 8: Commit**

```bash
git add jira_server.py frontend/src/dashboard.jsx frontend/dist tests/test_oauth_stats_routes.py tests/test_oauth_route_guards.py
git commit -m "Migrate stats and scenario Jira routes to OAuth"
```

---

## Task 6: Remove Legacy Header Plumbing From Migrated Helpers

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/routes/eng_routes.py`
- Modify: `backend/routes/settings_routes.py`
- Test: `tests/test_oauth_jira_client_source_guard.py`
- Test: affected unit tests

- [ ] **Step 1: Write the source guard**

Create `tests/test_oauth_jira_client_source_guard.py`:

```python
import re
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
JIRA_SERVER_PATH = REPO_ROOT / "jira_server.py"

MIGRATED_FILES = [
    REPO_ROOT / "backend" / "routes" / "eng_routes.py",
    REPO_ROOT / "backend" / "routes" / "settings_routes.py",
]

ALLOWED_JIRA_SERVER_SECTIONS = [
    ("def build_jira_headers():", "\ndef build_epm_fields_list"),
    ("@app.route('/api/debug-fields'", "\n\n@app.route('/api/tasks-fields'"),
    ("@app.route('/api/tasks-fields'", "\n\n@app.route('/api/export-excel'"),
]

FORBIDDEN_PATTERNS = [
    re.compile(r'f[\"\']\\{JIRA_EMAIL\\}:\\{JIRA_TOKEN\\}[\"\']'),
    re.compile(r'base64\\.b64encode\\([^\\n]+JIRA_(?:EMAIL|TOKEN)', re.MULTILINE),
    re.compile(r'(?:requests|HTTP_SESSION)\\.get\\(\\s*f[\"\']\\{JIRA_URL\\}/rest/'),
    re.compile(r'(?:requests|HTTP_SESSION)\\.post\\(\\s*f[\"\']\\{JIRA_URL\\}/rest/'),
    re.compile(r'resilient_jira_get\\(\\s*f[\"\']\\{JIRA_URL\\}/rest/'),
]


def source_without_allowed_jira_server_sections():
    source = JIRA_SERVER_PATH.read_text(encoding="utf8")
    for start_marker, end_marker in ALLOWED_JIRA_SERVER_SECTIONS:
        start = source.find(start_marker)
        if start == -1:
            continue
        end = source.find(end_marker, start)
        if end == -1:
            end = len(source)
        source = source[:start] + source[end:]
    return source


class OAuthJiraClientSourceGuardTests(unittest.TestCase):
    def test_migrated_files_do_not_construct_basic_jira_requests(self):
        failures = []
        for path in MIGRATED_FILES:
            source = path.read_text(encoding="utf8")
            for pattern in FORBIDDEN_PATTERNS:
                if pattern.search(source):
                    failures.append(f"{path.relative_to(REPO_ROOT)} matches {pattern.pattern}")

        jira_server_source = source_without_allowed_jira_server_sections()
        for pattern in FORBIDDEN_PATTERNS:
            if pattern.search(jira_server_source):
                failures.append(f"jira_server.py migrated surface matches {pattern.pattern}")

        self.assertEqual(failures, [])

    def test_legacy_build_jira_headers_remains_basic_only_guard(self):
        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        self.assertIn("def build_jira_headers():", source)
        self.assertIn("'route_not_oauth_ready'", source)
```

- [ ] **Step 2: Run the failing source guard**

Run:

```bash
python3 -m unittest tests.test_oauth_jira_client_source_guard
```

Expected: FAIL while any migrated file still builds Jira Basic headers or direct `JIRA_URL` REST requests.

- [ ] **Step 3: Remove unused `headers` parameters where all callers migrated**

Update helper signatures in `jira_server.py`:

```python
def fetch_issues_by_keys(keys, fields_list):
def fetch_issues_by_jql(jql, fields_list, max_results=500):
def collect_dependencies(keys):
def fetch_teams_from_jira_api():
def fetch_watchers_count(issue_key):
```

Update every caller to remove the obsolete `headers` argument.

Keep a compatibility argument only if an existing test or route outside `OAUTH_READY_API_PATHS` still needs it. If compatibility is kept, name it `_legacy_headers=None` and do not use it for HTTP.

- [ ] **Step 4: Verify batch auth-error recovery remains in place**

Tasks 3, 4, and 5 add `AuthError("auth_required")` recovery before each route batch is marked OAuth-ready. Do not defer expired-session recovery to this cleanup task.

In this task, keep the route-batch expired-session tests in the focused test run and add source-guard coverage if a migrated handler has a broad `except Exception` before an `except AuthError` block. OAuth-ready API routes that call Jira must return:

```python
payload, status = oauth_auth_required_payload()
return jsonify(payload), status
```

Do not include token material, authorization headers, OAuth codes, PKCE verifiers, or callback URLs in error payloads or logs.

- [ ] **Step 5: Run source guard and focused tests**

Run:

```bash
python3 -m unittest tests.test_oauth_jira_client_source_guard tests.test_oauth_eng_routes tests.test_oauth_settings_routes tests.test_oauth_stats_routes tests.test_oauth_route_guards
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jira_server.py backend/routes/eng_routes.py backend/routes/settings_routes.py tests/test_oauth_jira_client_source_guard.py
git commit -m "Guard OAuth Jira client route migration"
```

---

## Task 7: Documentation And Manual OAuth Journey

**Files:**
- Modify: `docs/atlassian-oauth-setup.md`
- Modify: `.env.example` only if comments still imply full dashboard is not migrated after the route batches pass.
- Test: full backend/frontend verification.

- [ ] **Step 1: Update OAuth setup docs**

In `docs/atlassian-oauth-setup.md`, replace the current route limitation text:

```markdown
The full dashboard is not migrated in this OAuth slice. After login, ENG dashboard data requests can still report `route_not_oauth_ready`; that means OAuth login worked, but the data route is intentionally blocked until it is migrated.
```

with:

```markdown
The ENG dashboard and Jira REST catalog/statistics routes are migrated through the OAuth Jira client. EPM Home/GraphQL routes remain guarded until the Home client has its own auth migration. If a route returns `route_not_oauth_ready`, the OAuth session is valid but that route is intentionally outside the current OAuth Jira REST surface.
```

Keep the scope section unchanged unless implementation proves a documented read scope is wrong. Do not add Compass GraphQL API instructions for this Jira REST migration.

- [ ] **Step 2: Run full automated verification**

Run:

```bash
python3 -m unittest discover -s tests
node tests/test_auth_isolation_source_guard.js
python3 -m unittest tests.test_oauth_jira_client_source_guard
```

Expected:

- Python suite PASS.
- Dashboard source guard PASS.
- OAuth Jira client source guard PASS.

- [ ] **Step 3: Start the local server in OAuth mode**

Use the user's local `.env` with:

```bash
.venv/bin/python jira_server.py
```

or:

```bash
python3 jira_server.py
```

Expected: server starts without printing token material. Startup fails if OAuth mode lacks `JIRA_URL`, `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_REDIRECT_URI`, `FLASK_SECRET_KEY`, or the local token-store allow pair.

- [ ] **Step 4: Verify new scopes and force re-consent when needed**

Before the browser journey, confirm the local `.env` `ATLASSIAN_SCOPES` exactly includes the current required scope set:

```text
read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access
```

If you previously signed in with the older scope set, clear the local OAuth token session or use `/api/auth/status` to confirm it reports:

```json
{"loginRequired": true, "loginUrl": "/login?reason=missing_scope"}
```

Then sign in again and verify Atlassian consent includes the Jira Software API scopes. A session created before the Agile scopes were added is not sufficient for `/api/boards` or `/api/sprints`.

- [ ] **Step 5: Verify the browser journey**

In the browser, verify:

1. `http://localhost:5050/` redirects to `/login` when unauthenticated.
2. `Sign in with Atlassian` opens Atlassian OAuth.
3. Microsoft Entra SSO appears only if enforced by the Atlassian organization.
4. Atlassian consent appears because the authorize URL includes `prompt=consent`.
5. Callback returns to authenticated `/`.
6. Dashboard ENG task load no longer shows `route_not_oauth_ready` for `/api/tasks-with-team-name`.
7. `/api/auth/status` returns authenticated state without access tokens, refresh tokens, API tokens, OAuth codes, PKCE verifiers, or authorization headers.
8. `/api/boards` and `/api/sprints` return data through OAuth, proving the Jira Software scopes were granted.
9. `/api/test` returns success through OAuth.
10. Clearing the local OAuth token store or using an expired session makes API routes return `401 {"error": "auth_required", "loginUrl": "/login?reason=session_expired"}` and the browser shows the expired-auth screen.
11. Returning to a visible tab calls `POST /api/auth/refresh`; the response contains no token material.
12. An intentionally unmigrated route such as `/api/epm/projects` returns `501 {"error": "route_not_oauth_ready"}`.

- [ ] **Step 6: Review commits**

Run:

```bash
git log --oneline -5
```

Expected: the latest commits are the atomic OAuth Jira client migration commits from this plan.

- [ ] **Step 7: Commit docs**

```bash
git add docs/atlassian-oauth-setup.md .env.example
git commit -m "Document OAuth Jira client route coverage"
```

Do not push. Wait for explicit user confirmation before push.

---

## Part 2: EPM/Home OAuth Follow-Up Plan

Do not implement this part in the Jira REST migration commits above. Use it as the next plan once the Jira REST client boundary is stable.

### EPM Workflow Inventory

Frontend EPM entry points:

- Initial/local config:
  - `frontend/src/api/epmApi.js` `fetchEpmConfig()` -> `GET /api/epm/config`.
  - `frontend/src/dashboard.jsx` save path -> `POST /api/epm/config`.
- Settings scope and Home discovery:
  - `fetchEpmScope()` -> `GET /api/epm/scope`.
  - `fetchEpmGoals()` -> `GET /api/epm/goals`.
  - `fetchEpmConfigurationProjects()` -> `POST /api/epm/projects/configuration`.
- Main EPM view:
  - `fetchEpmProjects()` -> `GET /api/epm/projects`.
  - `fetchEpmAllProjectsRollup()` -> `GET /api/epm/projects/rollup/all`.
  - `fetchEpmProjectRollup()` -> `GET /api/epm/projects/<project_id>/rollup`.

Backend EPM dependencies:

- `backend/epm/home.py` calls Atlassian Home/Townsquare GraphQL at `https://team.atlassian.com/gateway/api/graphql`.
- `HomeGraphQLClient` currently builds Basic auth from `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` or `JIRA_EMAIL` / `JIRA_TOKEN`, plus `X-ExperimentalApi: Townsquare`.
- Home metadata caches include `_CLOUD_ID_CACHE`, `_GOAL_BY_KEY_CACHE`, `EPM_PROJECTS_CACHE`, `EPM_ISSUES_CACHE`, and `EPM_ROLLUP_CACHE`.
- EPM rollups combine Home project metadata and Jira issue searches, so they need both a Home auth boundary and the Jira REST boundary from Part 1.

### EPM Decision Gate

Before any EPM route is marked OAuth-ready, verify whether Atlassian OAuth 2.0 3LO tokens are accepted for the Home/Townsquare GraphQL gateway used here.

- If Atlassian 3LO is supported for these Home GraphQL operations, add a Home client boundary that accepts `RequestAuthContext`, uses server-side OAuth token material only, and applies the same refresh locking and auth-required recovery policy as Jira.
- If Atlassian 3LO is not supported for these Home GraphQL operations, keep Home-backed EPM routes returning `route_not_oauth_ready` in OAuth mode. Do not silently use a user's Jira OAuth token against Home. A later database phase can decide whether EPM uses an explicit admin-owned service credential, stored server-side and audited, rather than per-user OAuth.

### EPM Part 2 Tasks

1. **Home GraphQL feasibility spike**
   - Test a real OAuth session against the exact `team.atlassian.com/gateway/api/graphql` operations currently used in `backend/epm/home.py`.
   - Document required APIs/scopes or document that 3LO is unsupported for this Home surface.
   - Keep `/api/epm/scope`, `/api/epm/goals`, `/api/epm/projects`, `/api/epm/projects/configuration`, `/api/epm/projects/preview`, `/api/epm/projects/rollup/all`, and `/api/epm/projects/<project_id>/rollup` guarded until this passes.
2. **Home auth client boundary**
   - Add a Home client wrapper analogous to `current_jira_get/current_jira_search`.
   - Remove direct Basic auth construction from `backend/epm/home.py` for OAuth-ready paths.
   - Return `401 auth_required` with `loginUrl` on expired OAuth state; never expose token material.
3. **EPM settings workflow migration**
   - Migrate `GET /api/epm/scope`, `GET /api/epm/goals`, and `POST /api/epm/projects/configuration`.
   - Ensure `frontend/src/api/epmApi.js` POST helpers send `X-Requested-With`.
   - Verify Settings -> EPM can load root goals, sub-goals, and project previews under OAuth.
4. **EPM project and rollup migration**
   - Migrate `GET /api/epm/projects`, `GET /api/epm/projects/rollup/all`, and `GET /api/epm/projects/<project_id>/rollup`.
   - Jira rollup searches must use the Part 1 Jira client; Home project discovery must use the Part 2 Home client.
   - Disable or auth-key Home/EPM caches for OAuth users before marking routes ready.
5. **EPM manual verification**
   - OAuth login -> EPM view -> Active tab with selected sprint -> project rollup cards render.
   - Settings -> EPM -> scope loads -> sub-goals load -> project preview loads -> save works with CSRF header.
   - Backlog and Archived EPM tabs still behave as before.
   - Clearing OAuth auth state returns visible expired-auth recovery, not a blank EPM view.

---

## Final Verification Before Reporting Complete

Run:

```bash
python3 -m unittest discover -s tests
node tests/test_auth_isolation_source_guard.js
python3 -m unittest tests.test_oauth_jira_client_source_guard
git log --oneline -5
```

Then capture manual/browser evidence:

- `/` -> `/login` -> Sign in with Atlassian -> Microsoft Entra SSO if enforced -> Atlassian consent -> callback -> authenticated `/`.
- `/api/auth/status` authenticated state without token material.
- An old OAuth session issued before the Jira Software scope update reports `loginUrl: "/login?reason=missing_scope"` and requires re-consent.
- `/api/test` uses OAuth.
- `/api/boards` and `/api/sprints` use OAuth with Jira Software scopes.
- ENG dashboard task route loads without `route_not_oauth_ready`.
- Expired/cleared auth returns `401 auth_required` with `loginUrl: "/login?reason=session_expired"` and shows the expired-auth screen.
- Returning to a visible tab calls `/api/auth/refresh` without exposing token material.
- `/api/epm/projects` still returns `501 route_not_oauth_ready`.

## Self-Review Checklist

- Spec coverage: OAuth Jira REST routes migrate through the auth/client boundary; Basic mode remains compatible; Home/EPM GraphQL remains explicitly guarded; unsafe POST header is preserved; caches are disabled for OAuth unless auth-keyed.
- Security coverage: no OAuth token material in Flask signed session, localStorage, dashboard config, logs, URLs, or docs; no Microsoft bearer token acceptance; expired auth returns the stable login URL.
- Pagination coverage: Jira search uses `/rest/api/3/search/jql` with `nextPageToken`; Agile board/sprint APIs keep their `startAt` contract.
- Scope coverage: Jira Software Agile scopes are documented, old OAuth sessions without those grants force re-consent, and board/sprint routes are verified after re-login.
- UI coverage: browser journey is verified, and `frontend/src/dashboard.jsx` only receives CSRF headers for existing POSTs, not auth UI or refresh handling.
- Commit coverage: every task has a focused commit and `git log --oneline -5` is reviewed before asking to push.
