# Atlassian OAuth Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Atlassian OAuth 2.0 3LO login so Jira Execution Planner can call Jira on behalf of the signed-in user without requiring a personal API token.

**Architecture:** Keep `basic` auth as the default and introduce `atlassian_oauth` behind `JIRA_AUTH_MODE`. Add a small backend auth/client boundary in the current `backend/` package, migrate only the first Jira endpoints through it, and keep auth-mode changes isolated from `frontend/src/dashboard.jsx`. Serve the unauthenticated OAuth entry screen outside the dashboard bundle so `dashboard.jsx` stays focused on authenticated product state. This slice is a developer-only local OAuth bridge: the supported OAuth route surface is `/login`, `/api/auth/*`, `/api/auth/status`, and the migrated `/api/test`; every other API route must fail clearly with `route_not_oauth_ready`/501 until it is migrated through the auth/client boundary. This slice is the prerequisite for later database-backed identity and token storage; it does not create database tables or production multi-user persistence.

**Tech Stack:** Python Flask, `requests`, existing `backend/jira_client.py` helpers, Flask session id plus process-local token store for local OAuth testing, Python `unittest`, Node source-guard tests. Later database phases use PostgreSQL with encrypted token storage.

---

## Alignment Notes

These notes supersede older snippets in this plan that assume the pre-split backend layout or store OAuth token material directly in Flask's signed cookie.

- The first OAuth slice must create the centralized auth/client boundary that the database work depends on. Do this before any database-backed identity or user-configuration phase.
- Do not add database migrations, PostgreSQL setup, user tables, workspace tables, or saved-view tables in this OAuth slice.
- Store local OAuth token material server-side behind an opaque Flask session id, for example `session['atlassian_oauth_session_id']` plus a process-local `OAUTH_TOKEN_STORE`. The signed cookie may contain the opaque session id and OAuth `state`, but not access tokens, refresh tokens, or API tokens.
- The later database auth phase should move connection metadata and encrypted token material into PostgreSQL tables equivalent to `users`, `workspaces`, `auth_connections`, `auth_tokens`, and `jira_project_access`.
- Keep Basic API-token mode local by default. Do not store Basic API tokens in the database unless a later requirement explicitly asks for server-side Basic credential persistence.
- The auth/client boundary must expose enough request auth context for later cache partitioning by workspace and user or auth connection. In this first OAuth slice, Jira/Home-derived process caches must be disabled for OAuth users unless the implementation has already keyed that cache with `RequestAuthContext`.
- Do not introduce `dev_lead` or `epm` user roles. Database-backed access control should distinguish normal users from admins only; ENG/EPM behavior comes from the selected configuration or saved view.
- Preserve initial-load performance. Auth status and later `/api/me`-style bootstrapping must stay compact and must not trigger broad Jira/Home fan-out.

## Security Gates Before Database Work

The following must be implemented or explicitly verified before starting the database introduction plan:

1. **Stable identity:** the OAuth callback must fetch `https://api.atlassian.com/me` with the granted token, store `account_id` as the stable user subject, and treat email/display name as mutable profile metadata only. The first database login path must upsert users by `(external_provider='atlassian', external_subject=account_id)`, update changed email/name fields, and reject `account_status` values other than `active`.
2. **PKCE:** the authorize URL must include an S256 `code_challenge`, and the token exchange must include the matching `code_verifier`. Keep `state` as a separate one-time CSRF value.
3. **Local token store guard:** the process-local `OAUTH_TOKEN_STORE` is a local bridge only. It must have TTL cleanup, logout/revoke deletion, refresh locking, and a startup/runtime guard that requires both `APP_ENVIRONMENT_KEY=local` or `dev` and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`. OAuth startup must fail outside explicitly approved local/single-process mode.
4. **Session/CORS/CSRF:** set `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE=Lax`, and `SESSION_COOKIE_SECURE` for non-local HTTPS deployments. Replace broad Flask-CORS defaults with an allowlist. In the OAuth slice, require a custom unsafe-method header on every browser `POST`, `PUT`, `PATCH`, and `DELETE` route so classic form-post CSRF cannot hit cookie-authenticated endpoints. Before DB-backed admin/config endpoints, upgrade that header guard to token-bound CSRF protection.
5. **Cache isolation:** Jira/Home-derived caches must include `workspace_id` plus `user_id` or `auth_connection_id` and a token/access version, or must be disabled for OAuth users until partitioning exists.
6. **Admin bootstrap:** define how the first admin is created, how later admins are granted, and how disabled/deleted users are blocked before any admin DB endpoints are exposed.
7. **Request auth context:** define a `RequestAuthContext` and make every Jira/Home client and cache accept it explicitly. Do not let routes or caches read process-global auth state once OAuth users can exist.
8. **Mutable config gate inventory:** list every current write route that must require an authenticated admin and CSRF protection before DB auth lands. At minimum this includes selected projects, board config, capacity, field mappings, priority weights, and persistent EPM config writes.
9. **Token storage operating model:** define envelope encryption, key source, `key_id`, rotation, refresh-token replacement transaction, concurrent refresh lock, audit events, and redacted logging before writing `auth_tokens`.
10. **Environment/workspace isolation:** database-backed identity, token, config, and cache state must be scoped to the deployment environment and configured Jira/Atlassian workspace/site.

## Current Codebase Alignment

This plan was drafted before the backend split. Implement it against current `main` as follows:

- Put pure auth helpers in `backend/auth/jira_auth.py`.
- Put OAuth route handlers in `backend/routes/auth_routes.py` as a blueprint.
- Register the auth blueprint from `backend/app.py`.
- Keep env-derived runtime values and compatibility wrappers in `jira_server.py` while route modules continue using `backend.routes.bind_server_globals`.
- Reuse `backend/jira_client.py` for resilient request behavior; keep auth-mode decisions in `backend/auth/jira_auth.py`.
- Use the old local branch `feature/atlassian-oauth-auth` only as source material. Do not copy it directly over current `main`, because it predates the `backend/routes` split.

## Execution Status Reconciliation

As of 2026-05-07, this plan's task checkboxes below are historical and must be reconciled before using this plan as a database-auth blocker. The current codebase already contains many OAuth-slice primitives; use this table as the pre-DB status source and rerun the listed verification commands before starting `docs/plans/2026-05-05-database-introduction-user-auth.md`.

| Plan area | Current code status | Verification before DB auth |
| --- | --- | --- |
| Task 0 request auth context | Present in `backend/auth/context.py`; used from `jira_server.py`. | `.venv/bin/python -m unittest tests.test_auth_context` |
| Task 1 auth helper foundation | Present in `backend/auth/jira_auth.py`. | `.venv/bin/python -m unittest tests.test_jira_auth tests.test_oauth_jira_client` |
| Task 2 OAuth routes | Present in `backend/routes/auth_routes.py`. | `.venv/bin/python -m unittest tests.test_auth_routes tests.test_auth_entry_page` |
| Task 3 Jira wrappers | Present in `jira_server.py` as `current_jira_get`, `current_jira_request`, and related helpers. | `.venv/bin/python -m unittest tests.test_oauth_jira_client tests.test_oauth_eng_routes tests.test_oauth_settings_routes tests.test_oauth_stats_routes` |
| Task 4 entry/recovery | Present as backend-served `/login`, focus refresh, and API auth-required responses. | `.venv/bin/python -m unittest tests.test_auth_entry_page` and browser smoke test from Task 9 |
| Task 5 unsupported route guard | Present in `jira_server.py` as `OAUTH_READY_API_PATHS`, `is_oauth_ready_api_path`, and `reject_unmigrated_oauth_routes`. | `.venv/bin/python -m unittest tests.test_oauth_route_guards` |
| Task 6 cache isolation | Present in `backend/auth/cache_policy.py` and route/cache callers, but must be re-run before DB work. | `.venv/bin/python -m unittest tests.test_oauth_cache_isolation` |
| Task 7 dashboard isolation | Source guards exist. | `node tests/test_auth_isolation_source_guard.js` |
| Task 8 startup validation | Present in auth config validation and local token-store startup checks. | `.venv/bin/python -m unittest tests.test_jira_auth` plus manual invalid-env startup check |
| Task 9 final verification | Must be re-run immediately before DB auth starts. | `.venv/bin/python -m unittest discover -s tests`; `node tests/test_auth_isolation_source_guard.js`; browser smoke test |

Remaining pre-DB blockers:

- Add the pre-DB admin mutation gate now owned by `docs/plans/2026-05-05-database-introduction-user-auth.md`.
- Upgrade unsafe-method protection to token-bound CSRF before any DB-backed browser admin/config endpoint ships.
- Re-run Task 9 final verification and record the command results in the DB auth execution notes.

## Previous OAuth Branch Porting Map

The local branch `feature/atlassian-oauth-auth` is a prototype/reference branch, not the implementation branch to merge. It added useful OAuth primitives, route tests, source guards, and docs, but it predates the current backend package and route blueprint split.

Carry these ideas forward:

- Auth mode constants, `AuthConfig`, config validation, normalized site URL matching, accessible-resource selection, token expiry buffering, refresh-on-demand, and Jira gateway URL construction.
- Route behavior for `/api/auth/status`, `/api/auth/atlassian/login`, `/api/auth/atlassian/callback`, and `/api/auth/logout`.
- Server-side token storage behind an opaque Flask session id. Keep the test that proves access and refresh tokens are not stored in the Flask signed session.
- Refresh failure behavior that clears the local auth session before returning `auth_required`.
- The dashboard source guard that prevents this first slice from modifying `frontend/src/dashboard.jsx` or storing Atlassian tokens in `localStorage`; the OAuth entry screen is served separately by backend auth routes.
- `.env.example` and README documentation structure for Basic fallback plus Atlassian OAuth setup.

Change these before implementation:

- Move root `jira_auth.py` into `backend/auth/jira_auth.py`.
- Put request context dataclasses and cache-key helpers in `backend/auth/context.py`.
- Put OAuth routes in `backend/routes/auth_routes.py` as a blueprint and register it from `backend/app.py`; do not add new direct `@app.route` handlers in `jira_server.py`.
- Use `backend.routes.bind_server_globals` for transition globals until dependencies are moved out of `jira_server.py`.
- Add `read:me`, PKCE S256, `/me` identity fetch, inactive-account rejection, one-time state/verifier cleanup, sanitized OAuth errors, cookie/CORS/CSRF policy, and the compound local-token-store runtime guard.
- Make Jira/Home clients take `RequestAuthContext`; do not keep wrappers that read `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_URL`, or OAuth token session globals inside route handlers.
- Disable existing Jira/Home process caches for OAuth users in this slice. Keying them with `RequestAuthContext` can happen route-by-route later, but the DB phase must not inherit process-global Jira/Home cache behavior.

Do not carry these prototype details forward:

- Root-level `jira_auth.py`.
- Direct OAuth route definitions in `jira_server.py`.
- OAuth authorize URLs without PKCE.
- OAuth callback paths that do not fetch `/me` before saving session state.
- Process-local `OAUTH_TOKEN_STORE` without TTL cleanup, a lock, logout/revoke deletion, and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED`.
- Tests that only assert the authorize URL contains state but do not assert `code_challenge_method=S256`.

## RequestAuthContext Contract

Before database work starts, create a single request-scoped auth object and pass it into every Jira/Home client and cache helper. The local OAuth slice can populate synthetic local ids where the database id is not available yet; the field names must match the later database-backed version so route migrations do not churn.

```python
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProjectAccessSnapshot:
    project_key: str
    project_type: str
    status: str
    checked_at: str = ''


@dataclass(frozen=True)
class RequestAuthContext:
    auth_mode: str
    user_id: str
    stable_subject: str
    atlassian_account_id: str
    workspace_id: str
    auth_connection_id: str
    cloud_id: str
    site_url: str
    token_version: str
    account_status: str
    is_admin: bool
    project_access: tuple[ProjectAccessSnapshot, ...] = field(default_factory=tuple)
```

Rules:

- `stable_subject` is the provider-stable identity key. For Atlassian OAuth it is the `/me` `account_id`; for local Basic mode use a clearly synthetic value such as `local-basic`.
- `workspace_id` identifies the deployment environment plus Jira/Atlassian site. Before the DB exists, use a deterministic local value derived from normalized `JIRA_URL` and the environment key.
- `auth_connection_id` identifies the credential connection used for Jira/Home calls. Before the DB exists, use an opaque local id tied to the OAuth session id, not the token value.
- `token_version` changes whenever the credential or project-access snapshot changes. Cache keys must include it or must opt out for OAuth users.
- `account_status` must be `active` before Jira/Home calls run. Disabled/deleted local users and inactive Atlassian accounts are blocked.
- `is_admin` is required for shared configuration mutation and admin inspection only. Jira project access is not an admin signal.
- Jira/Home clients must accept `context` explicitly, for example `jira_get(config, context, session_data, path, ...)` and `home_graphql(context, query, ...)`.
- Caches that contain Jira/Home-derived data must accept `context` explicitly and build keys from `workspace_id`, `auth_connection_id` or `user_id`, `cloud_id`, `token_version`, and route-specific parameters. If a cache cannot be keyed this way, disable it for OAuth users.

## OAuth Callback And Browser Policy

The callback must be strict because the DB phase will persist identities and tokens created by this flow:

- Reject callback requests with missing `code`, missing `state`, unknown state, mismatched state, missing PKCE verifier, or provider `error`.
- Consume `state` and `code_verifier` exactly once by clearing both on every callback path, including validation failures and token-exchange failures.
- Exchange the code with the exact configured redirect URI and the matching PKCE verifier.
- Fetch `/me` before writing session state. If `account_id` is missing or `account_status` is not `active`, clear local auth state and return a sanitized auth error.
- Return only sanitized error codes to the browser, such as `invalid_oauth_state`, `oauth_exchange_failed`, `user_identity_failed`, `user_inactive`, or `jira_site_not_accessible`.
- Never log access tokens, refresh tokens, API tokens, OAuth codes, PKCE verifiers, raw authorization headers, or full callback query strings. Logs may include a correlation id, sanitized provider error code, HTTP status, `cloud_id`, and `account_id` only after identity validation.

Browser policy before DB-backed admin/config endpoints:

- Flask session cookie: `HttpOnly`, `SameSite=Lax`, and `Secure` outside local HTTP development.
- CORS: explicit `APP_ALLOWED_ORIGINS` allowlist only; no broad wildcard origin when credentials are enabled.
- CSRF in this OAuth slice: all unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) require a non-simple custom header, initially `X-Requested-With: jira-execution-planner`, before route handlers run. This forces CORS preflight and blocks classic cross-site form posts against cookie-authenticated endpoints.
- CSRF before DB-backed admin/config endpoints: replace or augment the temporary custom-header guard with a server-issued CSRF token, preferably sent in an `X-CSRF-Token` header and bound to the session.

## Microsoft Entra SSO Support Model

Microsoft Entra ID, formerly Azure AD, is supported through Atlassian Cloud SSO. The app must start the Atlassian OAuth 2.0 3LO authorization flow at `https://auth.atlassian.com/authorize`; for managed Atlassian accounts whose organization enforces Microsoft Entra SAML SSO, Atlassian redirects the browser to Microsoft during that login flow. After Entra authenticates the user, Atlassian returns the OAuth authorization code to this app's callback.

The authorization/consent screen is Atlassian-hosted and must be included by using `prompt=consent` in the authorize URL. That screen shows the user the app, requested scopes, and Atlassian site access before the callback receives a code. For Entra-backed managed accounts, the expected browser flow is Atlassian authorize URL, Microsoft Entra SSO if required, Atlassian consent/site authorization, then `/api/auth/atlassian/callback`.

The app must exchange and store Atlassian OAuth tokens only. Do not accept Microsoft Entra ID tokens or access tokens as Jira REST API bearer tokens, and do not add a direct Entra application registration for Jira API access in this slice. The stable identity remains Atlassian `/me` `account_id`; Entra is the upstream identity provider used by Atlassian to authenticate the managed account.

Manual OAuth smoke tests must use a managed Atlassian account from the Entra-backed organization and confirm the browser is sent through Microsoft SSO before Atlassian returns to `/api/auth/atlassian/callback`.

## User Journey Verification Contract

Do not treat backend OAuth routes as complete until the supported browser journey is verified end-to-end. This slice has a deliberately small product surface, but it still needs a face:

1. Unauthenticated user opens `/` and is redirected to `/login`.
2. `/login` shows a clear `Sign in with Atlassian` action and no token material.
3. The sign-in action starts Atlassian OAuth, routes through Microsoft Entra SSO when required by the managed Atlassian org, shows Atlassian consent/site authorization, and returns to `/api/auth/atlassian/callback`.
4. Authenticated user returns to `/` and is not sent back to `/login`.
5. `/api/auth/status` shows the authenticated site state without tokens.
6. The migrated test route proves Jira calls use the OAuth token.
7. If the local OAuth session expires, token refresh fails, or the server clears auth state, the browser shows `/login?reason=session_expired` with a clear re-auth message and `Sign in with Atlassian` action. Do not leave the user on a blank dashboard or a generic backend error.
8. When the browser tab becomes visible or focused, a small auth-shell script outside `frontend/src/dashboard.jsx` makes a throttled `POST /api/auth/refresh` call. The server refreshes only if needed and returns no token material. If refresh fails, the script sends the user to `/login?reason=session_expired`.
9. Un-migrated API routes fail with `route_not_oauth_ready`/501 instead of a silent empty-Basic Jira failure.

For each future route added to the OAuth-supported surface, the implementation plan must name the user-visible entry point or dashboard state that exercises it. If no user journey exists, the route should stay out of scope or be explicitly marked developer-only with a manual verification path.

## File Structure

**Create:**

- `backend/auth/__init__.py` - package marker for auth helpers.
- `backend/auth/context.py` - `RequestAuthContext` dataclasses and cache-key helpers shared by Jira/Home clients.
- `backend/auth/jira_auth.py` - auth mode parsing, OAuth URL/token helpers, resource matching, token refresh, refresh serialization, Jira URL/header construction.
- `backend/auth/cache_policy.py` - cache policy helper that disables Jira/Home process caches for OAuth until they are auth-keyed.
- `backend/routes/auth_routes.py` - auth status, Atlassian login/callback, and logout blueprint.
- `tests/test_auth_context.py` - request auth context, synthetic local context, and cache-key unit tests.
- `tests/test_jira_auth.py` - backend unit tests for auth mode, URLs, resources, refresh behavior, refresh serialization, and request headers.
- `tests/test_auth_routes.py` - Flask route tests for auth status, login redirect, callback errors, and logout.
- `tests/test_auth_entry_page.py` - Flask route tests for the OAuth entry screen and unauthenticated dashboard gate.
- `tests/test_oauth_route_guards.py` - Flask route tests that unsupported API routes return `route_not_oauth_ready`/501 in OAuth mode.
- `tests/test_oauth_cache_isolation.py` - unit/source tests that Jira/Home process caches are disabled in OAuth mode.
- `tests/test_auth_isolation_source_guard.js` - source guard that auth-mode work stays out of `frontend/src/dashboard.jsx`.

**Modify:**

- `backend/app.py` - register the auth blueprint.
- `jira_server.py` - configure auth env values, Flask secret key, local token store helpers, per-session refresh locks, OAuth entry screen, unsupported-route guard, Basic-only startup validation, request auth context helpers, and migrate `/api/test` plus one small read endpoint to the auth helper.
- `jira-dashboard.html` - load a tiny auth-shell focus/visibility refresh script outside the React dashboard bundle.
- `.env.example` - document `JIRA_AUTH_MODE` and Atlassian OAuth variables.
- `README.md` - document local OAuth setup and Basic auth fallback.

---

## Task 0: Request Auth Context Foundation

**Files:**
- Create: `backend/auth/__init__.py`
- Create: `backend/auth/context.py`
- Create: `tests/test_auth_context.py`

- [ ] **Step 1: Write failing context tests**

Create `tests/test_auth_context.py`:

```python
import unittest

from backend.auth.context import (
    ProjectAccessSnapshot,
    RequestAuthContext,
    build_auth_cache_key,
    stable_local_workspace_id,
)


class TestAuthContext(unittest.TestCase):
    def test_stable_local_workspace_id_includes_environment_and_site(self):
        first = stable_local_workspace_id('local', 'https://example.atlassian.net/')
        second = stable_local_workspace_id('local', 'https://example.atlassian.net')
        other_env = stable_local_workspace_id('staging', 'https://example.atlassian.net')
        self.assertEqual(first, second)
        self.assertNotEqual(first, other_env)

    def test_cache_key_includes_workspace_connection_cloud_and_token_version(self):
        context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id='user-1',
            stable_subject='account-1',
            atlassian_account_id='account-1',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='7',
            account_status='active',
            is_admin=False,
            project_access=(ProjectAccessSnapshot('PROD', 'product', 'accessible'),),
        )
        key = build_auth_cache_key(context, 'epm-rollup', 'active', 'Sprint 1')
        self.assertEqual(
            key,
            (
                'workspace-1',
                'connection-1',
                'cloud-1',
                '7',
                'epm-rollup',
                'active',
                'Sprint 1',
            ),
        )

    def test_cache_key_changes_when_token_version_changes(self):
        base = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id='user-1',
            stable_subject='account-1',
            atlassian_account_id='account-1',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )
        changed = RequestAuthContext(**{**base.__dict__, 'token_version': '2'})
        self.assertNotEqual(
            build_auth_cache_key(base, 'projects'),
            build_auth_cache_key(changed, 'projects'),
        )
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 -m unittest tests.test_auth_context -v`

Expected: FAIL because `backend/auth/context.py` does not exist.

- [ ] **Step 3: Add context module**

Create `backend/auth/__init__.py` as an empty package marker.

Create `backend/auth/context.py`:

```python
import hashlib
from dataclasses import dataclass, field


def _normalize_site_url(value):
    return (value or '').strip().rstrip('/').lower()


@dataclass(frozen=True)
class ProjectAccessSnapshot:
    project_key: str
    project_type: str
    status: str
    checked_at: str = ''


@dataclass(frozen=True)
class RequestAuthContext:
    auth_mode: str
    user_id: str
    stable_subject: str
    atlassian_account_id: str
    workspace_id: str
    auth_connection_id: str
    cloud_id: str
    site_url: str
    token_version: str
    account_status: str
    is_admin: bool
    project_access: tuple[ProjectAccessSnapshot, ...] = field(default_factory=tuple)


def stable_local_workspace_id(environment_key, jira_site_url, cloud_id=''):
    environment = (environment_key or 'local').strip().lower()
    site = _normalize_site_url(jira_site_url)
    cloud = (cloud_id or '').strip()
    source = f'{environment}|{cloud or site}'
    digest = hashlib.sha256(source.encode('utf-8')).hexdigest()[:16]
    return f'local-workspace-{digest}'


def build_auth_cache_key(context, *parts):
    subject = context.auth_connection_id or context.user_id
    return (
        context.workspace_id,
        subject,
        context.cloud_id,
        str(context.token_version),
        *[str(part) for part in parts],
    )
```

- [ ] **Step 4: Run context tests**

Run: `python3 -m unittest tests.test_auth_context -v`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/auth/__init__.py backend/auth/context.py tests/test_auth_context.py
git commit -m "Add request auth context foundation"
```

---

## Task 1: Auth Helper Foundation

**Files:**
- Create: `backend/auth/jira_auth.py`
- Create: `tests/test_jira_auth.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_jira_auth.py`:

```python
import time
import unittest
from unittest.mock import Mock

from backend.auth.jira_auth import (
    AuthConfig,
    AuthError,
    build_authorize_url,
    build_jira_api_url,
    build_jira_headers,
    build_pkce_challenge,
    choose_accessible_resource,
    is_oauth_token_expired,
    normalize_site_url,
    token_session_payload,
)
from backend.auth.context import RequestAuthContext


class TestJiraAuth(unittest.TestCase):
    def test_normalize_site_url_removes_trailing_slash(self):
        self.assertEqual(
            normalize_site_url('https://example.atlassian.net/'),
            'https://example.atlassian.net',
        )

    def test_choose_accessible_resource_matches_jira_url(self):
        resource = choose_accessible_resource(
            [
                {'id': 'cloud-1', 'url': 'https://other.atlassian.net'},
                {'id': 'cloud-2', 'url': 'https://example.atlassian.net/'},
            ],
            'https://example.atlassian.net',
        )
        self.assertEqual(resource['id'], 'cloud-2')

    def test_choose_accessible_resource_raises_when_missing(self):
        with self.assertRaises(AuthError):
            choose_accessible_resource(
                [{'id': 'cloud-1', 'url': 'https://other.atlassian.net'}],
                'https://example.atlassian.net',
            )

    def test_build_authorize_url_contains_required_values(self):
        config = AuthConfig(
            auth_mode='atlassian_oauth',
            jira_url='https://example.atlassian.net',
            jira_email='',
            jira_token='',
            client_id='client-123',
            client_secret='secret-123',
            redirect_uri='http://localhost:5050/api/auth/atlassian/callback',
            scopes='read:me read:jira-work read:jira-user offline_access',
        )
        url = build_authorize_url(config, 'state-123', build_pkce_challenge('verifier-123'))
        self.assertIn('https://auth.atlassian.com/authorize?', url)
        self.assertIn('audience=api.atlassian.com', url)
        self.assertIn('client_id=client-123', url)
        self.assertIn('response_type=code', url)
        self.assertIn('prompt=consent', url)
        self.assertIn('state=state-123', url)
        self.assertIn('code_challenge=', url)
        self.assertIn('code_challenge_method=S256', url)

    def test_token_session_payload_keeps_stable_atlassian_identity(self):
        payload = token_session_payload(
            {'access_token': 'access-123', 'refresh_token': 'refresh-123', 'expires_in': 3600},
            {'id': 'cloud-123', 'url': 'https://example.atlassian.net', 'name': 'Example'},
            {
                'account_id': 'account-123',
                'account_status': 'active',
                'email': 'new@example.com',
                'name': 'New Name',
            },
        )
        self.assertEqual(payload['account_id'], 'account-123')
        self.assertEqual(payload['account_status'], 'active')
        self.assertEqual(payload['email'], 'new@example.com')

    def test_basic_headers_use_basic_auth(self):
        config = AuthConfig(
            auth_mode='basic',
            jira_url='https://example.atlassian.net',
            jira_email='user@example.com',
            jira_token='token-123',
        )
        headers = build_jira_headers(config, session_data={})
        self.assertEqual(headers['Accept'], 'application/json')
        self.assertTrue(headers['Authorization'].startswith('Basic '))

    def test_oauth_headers_use_session_access_token(self):
        config = AuthConfig(
            auth_mode='atlassian_oauth',
            jira_url='https://example.atlassian.net',
            jira_email='',
            jira_token='',
        )
        headers = build_jira_headers(config, session_data={'access_token': 'access-123'})
        self.assertEqual(headers['Authorization'], 'Bearer access-123')

    def test_oauth_headers_raise_without_session_token(self):
        config = AuthConfig(
            auth_mode='atlassian_oauth',
            jira_url='https://example.atlassian.net',
            jira_email='',
            jira_token='',
        )
        with self.assertRaises(AuthError):
            build_jira_headers(config, session_data={})

    def test_basic_jira_url_uses_site_url(self):
        config = AuthConfig(auth_mode='basic', jira_url='https://example.atlassian.net')
        context = RequestAuthContext(
            auth_mode='basic',
            user_id='local-user',
            stable_subject='local-basic',
            atlassian_account_id='',
            workspace_id='workspace-1',
            auth_connection_id='local-basic-connection',
            cloud_id='',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=True,
        )
        self.assertEqual(
            build_jira_api_url(config, context, '/rest/api/3/project/search'),
            'https://example.atlassian.net/rest/api/3/project/search',
        )

    def test_oauth_jira_url_uses_cloudid_gateway(self):
        config = AuthConfig(auth_mode='atlassian_oauth', jira_url='https://example.atlassian.net')
        context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id='user-1',
            stable_subject='account-1',
            atlassian_account_id='account-1',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            cloud_id='cloud-123',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )
        self.assertEqual(
            build_jira_api_url(config, context, '/rest/api/3/project/search'),
            'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/project/search',
        )

    def test_token_expiry_has_buffer(self):
        self.assertTrue(is_oauth_token_expired({'expires_at': time.time() + 30}))
        self.assertFalse(is_oauth_token_expired({'expires_at': time.time() + 600}))
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `python3 -m unittest tests.test_jira_auth -v`

Expected: FAIL because `backend/auth/jira_auth.py` does not exist.

- [ ] **Step 3: Add the helper module**

Create `backend/auth/jira_auth.py`:

```python
import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlencode

import requests

from backend.auth.context import RequestAuthContext


AUTH_MODE_BASIC = 'basic'
AUTH_MODE_ATLASSIAN_OAUTH = 'atlassian_oauth'
ATLASSIAN_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize'
ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'
ATLASSIAN_API_BASE = 'https://api.atlassian.com'
TOKEN_EXPIRY_BUFFER_SECONDS = 60


class AuthError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@dataclass
class AuthConfig:
    auth_mode: str = AUTH_MODE_BASIC
    jira_url: str = ''
    jira_email: str = ''
    jira_token: str = ''
    client_id: str = ''
    client_secret: str = ''
    redirect_uri: str = ''
    scopes: str = 'read:me read:jira-work read:jira-user offline_access'
    flask_secret_key: str = ''


def normalize_site_url(value):
    return (value or '').strip().rstrip('/')


def validate_auth_config(config):
    if not normalize_site_url(config.jira_url):
        raise AuthError('missing_jira_url', 'JIRA_URL must be set')
    if config.auth_mode == AUTH_MODE_BASIC:
        if not config.jira_email or not config.jira_token:
            raise AuthError('missing_basic_auth', 'JIRA_EMAIL and JIRA_TOKEN must be set in basic auth mode')
        return
    if config.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
        if not config.client_id or not config.client_secret or not config.redirect_uri:
            raise AuthError(
                'missing_oauth_config',
                'ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET, and ATLASSIAN_REDIRECT_URI must be set',
            )
        if not config.flask_secret_key:
            raise AuthError('missing_flask_secret_key', 'FLASK_SECRET_KEY must be set in OAuth auth mode')
        return
    raise AuthError('invalid_auth_mode', f'Unsupported JIRA_AUTH_MODE: {config.auth_mode}')


def new_oauth_state():
    return secrets.token_urlsafe(32)


def new_pkce_verifier():
    return secrets.token_urlsafe(64)


def build_pkce_challenge(verifier):
    digest = hashlib.sha256(verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).decode('ascii').rstrip('=')


def build_authorize_url(config, state, code_challenge=None):
    params = {
        'audience': 'api.atlassian.com',
        'client_id': config.client_id,
        'scope': config.scopes,
        'redirect_uri': config.redirect_uri,
        'state': state,
        'response_type': 'code',
        'prompt': 'consent',
    }
    if code_challenge:
        params['code_challenge'] = code_challenge
        params['code_challenge_method'] = 'S256'
    return f'{ATLASSIAN_AUTHORIZE_URL}?{urlencode(params)}'


def exchange_authorization_code(config, code, code_verifier=None, http_post=requests.post):
    body = {
        'grant_type': 'authorization_code',
        'client_id': config.client_id,
        'client_secret': config.client_secret,
        'code': code,
        'redirect_uri': config.redirect_uri,
    }
    if code_verifier:
        body['code_verifier'] = code_verifier
    response = http_post(
        ATLASSIAN_TOKEN_URL,
        json=body,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        timeout=20,
    )
    if response.status_code != 200:
        raise AuthError('oauth_exchange_failed', f'Atlassian token exchange failed with {response.status_code}')
    return response.json()


def fetch_current_user(access_token, http_get=requests.get):
    response = http_get(
        'https://api.atlassian.com/me',
        headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'},
        timeout=20,
    )
    if response.status_code != 200:
        raise AuthError('user_identity_failed', f'User identity lookup failed with {response.status_code}')
    return response.json()


def fetch_accessible_resources(access_token, http_get=requests.get):
    response = http_get(
        ATLASSIAN_RESOURCES_URL,
        headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'},
        timeout=20,
    )
    if response.status_code != 200:
        raise AuthError('accessible_resources_failed', f'Accessible resources failed with {response.status_code}')
    return response.json()


def choose_accessible_resource(resources, jira_url):
    expected = normalize_site_url(jira_url)
    for resource in resources:
        if normalize_site_url(resource.get('url')) == expected:
            return resource
    raise AuthError('jira_site_not_accessible', f'No accessible Jira site matched {expected}')


def token_session_payload(token_data, resource, user_profile=None):
    now = int(time.time())
    expires_in = int(token_data.get('expires_in') or 0)
    return {
        'access_token': token_data.get('access_token', ''),
        'refresh_token': token_data.get('refresh_token', ''),
        'expires_at': now + expires_in,
        'scope': token_data.get('scope', ''),
        'cloudid': resource.get('id', ''),
        'site_url': normalize_site_url(resource.get('url')),
        'site_name': resource.get('name', ''),
        'account_id': (user_profile or {}).get('account_id', ''),
        'account_status': (user_profile or {}).get('account_status', ''),
        'email': (user_profile or {}).get('email', ''),
        'display_name': (user_profile or {}).get('name', ''),
    }


def is_oauth_token_expired(session_data):
    expires_at = float(session_data.get('expires_at') or 0)
    return expires_at <= time.time() + TOKEN_EXPIRY_BUFFER_SECONDS


def refresh_oauth_token(config, session_data, http_post=requests.post):
    refresh_token = session_data.get('refresh_token')
    if not refresh_token:
        raise AuthError('auth_required', 'Missing OAuth refresh token')
    response = http_post(
        ATLASSIAN_TOKEN_URL,
        json={
            'grant_type': 'refresh_token',
            'client_id': config.client_id,
            'client_secret': config.client_secret,
            'refresh_token': refresh_token,
        },
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        timeout=20,
    )
    if response.status_code != 200:
        raise AuthError('auth_required', f'Atlassian token refresh failed with {response.status_code}')
    refreshed = response.json()
    merged = dict(session_data)
    merged['access_token'] = refreshed.get('access_token', '')
    merged['refresh_token'] = refreshed.get('refresh_token', refresh_token)
    merged['expires_at'] = int(time.time()) + int(refreshed.get('expires_in') or 0)
    merged['scope'] = refreshed.get('scope', merged.get('scope', ''))
    return merged


def build_jira_headers(config, session_data):
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    if config.auth_mode == AUTH_MODE_BASIC:
        auth_base64 = base64.b64encode(f'{config.jira_email}:{config.jira_token}'.encode('ascii')).decode('ascii')
        headers['Authorization'] = f'Basic {auth_base64}'
        return headers
    access_token = session_data.get('access_token')
    if not access_token:
        raise AuthError('auth_required', 'User must sign in with Atlassian')
    headers['Authorization'] = f'Bearer {access_token}'
    return headers


def build_jira_api_url(config, context, path):
    clean_path = '/' + path.lstrip('/')
    if config.auth_mode == AUTH_MODE_BASIC:
        return f'{normalize_site_url(config.jira_url)}{clean_path}'
    if not context.cloud_id:
        raise AuthError('auth_required', 'Missing Atlassian cloudid in session')
    return f'{ATLASSIAN_API_BASE}/ex/jira/{context.cloud_id}{clean_path}'
```

- [ ] **Step 4: Run the helper tests**

Run: `python3 -m unittest tests.test_jira_auth -v`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/auth/jira_auth.py tests/test_jira_auth.py
git commit -m "Add Jira auth helper foundation"
```

---

## Task 2: Flask OAuth Routes

**Files:**
- Create: `backend/routes/auth_routes.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Create: `tests/test_auth_routes.py`

- [ ] **Step 1: Write route tests**

Create `tests/test_auth_routes.py`:

```python
import unittest
from unittest.mock import patch

import jira_server


class TestAuthRoutes(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        if hasattr(jira_server, 'OAUTH_TOKEN_STORE'):
            jira_server.OAUTH_TOKEN_STORE.clear()
        if hasattr(jira_server, 'OAUTH_REFRESH_LOCKS'):
            jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()

    def test_basic_auth_status_reports_configured(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'user@example.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token-123'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['authMode'], 'basic')
        self.assertTrue(response.get_json()['authenticated'])

    def test_oauth_status_requires_login_without_session(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()['authenticated'])
        self.assertTrue(response.get_json()['loginRequired'])

    def test_oauth_login_redirects_to_atlassian(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 302)
        self.assertIn('https://auth.atlassian.com/authorize?', response.headers['Location'])
        self.assertIn('code_challenge=', response.headers['Location'])
        self.assertIn('code_challenge_method=S256', response.headers['Location'])

    def test_oauth_login_rejects_non_local_token_store_environment(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'production'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')

    def test_oauth_logout_requires_unsafe_method_header(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/auth/logout')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_oauth_login_rejects_basic_mode(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'user@example.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token-123'):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'oauth_not_enabled')

    def test_callback_rejects_invalid_state(self):
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/atlassian/callback?state=bad&code=abc')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_oauth_state')
        with self.client.session_transaction() as session:
            self.assertNotIn('oauth_state', session)
            self.assertNotIn('oauth_pkce_verifier', session)

    def test_logout_clears_auth_session(self):
        with self.client.session_transaction() as session:
            session['atlassian_oauth_session_id'] = 'session-123'
        jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
        response = self.client.post(
            '/api/auth/logout',
            headers={'X-Requested-With': 'jira-execution-planner'},
        )
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertNotIn('session-123', jira_server.OAUTH_TOKEN_STORE)

    def test_save_oauth_session_clears_falsy_payload(self):
        with jira_server.app.test_request_context('/'):
            jira_server.session['atlassian_oauth_session_id'] = 'session-123'
            jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
            jira_server.OAUTH_REFRESH_LOCKS['session-123'] = object()
            jira_server.save_oauth_session({})
            self.assertNotIn('atlassian_oauth_session_id', jira_server.session)
            self.assertNotIn('session-123', jira_server.OAUTH_TOKEN_STORE)
            self.assertNotIn('session-123', jira_server.OAUTH_REFRESH_LOCKS)

    def test_callback_stores_oauth_tokens_server_side_with_identity(self):
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'

        token_data = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_in': 3600,
        }
        user_profile = {
            'account_id': 'account-123',
            'account_status': 'active',
            'email': 'new@example.com',
            'name': 'New Name',
        }
        resource = {
            'id': 'cloud-123',
            'url': 'https://example.atlassian.net/',
            'name': 'Example Jira',
        }
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token_data) as exchange_code, \
             patch.object(jira_server, 'fetch_current_user', return_value=user_profile), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]):
            response = self.client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 302)
        exchange_code.assert_called_once()
        self.assertEqual(exchange_code.call_args.args[2], 'verifier-123')
        with self.client.session_transaction() as session:
            session_payload = dict(session)
            session_id = session.get('atlassian_oauth_session_id')
            self.assertIsNotNone(session_id)
            self.assertNotIn('oauth_state', session)
            self.assertNotIn('oauth_pkce_verifier', session)
            self.assertNotIn('atlassian_oauth', session)
            self.assertNotIn('access-123', str(session_payload))
            self.assertNotIn('refresh-123', str(session_payload))

        stored = jira_server.OAUTH_TOKEN_STORE[session_id]
        self.assertEqual(stored['access_token'], 'access-123')
        self.assertEqual(stored['account_id'], 'account-123')
        self.assertEqual(stored['account_status'], 'active')
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `python3 -m unittest tests.test_auth_routes -v`

Expected: FAIL because the auth routes are not registered.

- [ ] **Step 3: Register OAuth config and routes**

In `jira_server.py`, change the Flask import to include `session`:

```python
from flask import abort, jsonify, request, send_file, send_from_directory, session
```

Add this import near the existing local imports:

```python
from backend.auth.jira_auth import (
    AUTH_MODE_ATLASSIAN_OAUTH,
    AUTH_MODE_BASIC,
    AuthConfig,
    AuthError,
    build_authorize_url,
    build_pkce_challenge,
    choose_accessible_resource,
    exchange_authorization_code,
    fetch_accessible_resources,
    fetch_current_user,
    new_pkce_verifier,
    new_oauth_state,
    normalize_site_url,
    token_session_payload,
    validate_auth_config,
)
```

Add env config near existing Jira config:

```python
JIRA_AUTH_MODE = os.getenv('JIRA_AUTH_MODE', AUTH_MODE_BASIC).strip() or AUTH_MODE_BASIC
ATLASSIAN_CLIENT_ID = os.getenv('ATLASSIAN_CLIENT_ID', '').strip()
ATLASSIAN_CLIENT_SECRET = os.getenv('ATLASSIAN_CLIENT_SECRET', '').strip()
ATLASSIAN_REDIRECT_URI = os.getenv('ATLASSIAN_REDIRECT_URI', '').strip()
ATLASSIAN_SCOPES = os.getenv(
    'ATLASSIAN_SCOPES',
    'read:me read:jira-work read:jira-user offline_access'
).strip()
FLASK_SECRET_KEY = os.getenv('FLASK_SECRET_KEY', '').strip()
app.secret_key = FLASK_SECRET_KEY or os.urandom(32)
APP_ENVIRONMENT_KEY = os.getenv('APP_ENVIRONMENT_KEY', 'local').strip() or 'local'
OAUTH_TOKEN_STORE = {}
OAUTH_TOKEN_STORE_LOCK = threading.RLock()
OAUTH_REFRESH_LOCKS = {}
OAUTH_LOCAL_TOKEN_STORE_ALLOWED = os.getenv('OAUTH_LOCAL_TOKEN_STORE_ALLOWED', '').strip().lower() in {'1', 'true', 'yes'}
OAUTH_TOKEN_STORE_TTL_SECONDS = int(os.getenv('OAUTH_TOKEN_STORE_TTL_SECONDS', '28800'))
```

Add auth helpers in `jira_server.py` near the auth config. These helpers keep token material server-side for the local OAuth slice and give the later database phase a single storage boundary to replace:

```python
def current_auth_config():
    return AuthConfig(
        auth_mode=JIRA_AUTH_MODE,
        jira_url=JIRA_URL or '',
        jira_email=JIRA_EMAIL or '',
        jira_token=JIRA_TOKEN or '',
        client_id=ATLASSIAN_CLIENT_ID,
        client_secret=ATLASSIAN_CLIENT_SECRET,
        redirect_uri=ATLASSIAN_REDIRECT_URI,
        scopes=ATLASSIAN_SCOPES,
        flask_secret_key=FLASK_SECRET_KEY,
    )


def save_oauth_session(data):
    if not data:
        session_id = session.pop('atlassian_oauth_session_id', None)
        if session_id:
            with OAUTH_TOKEN_STORE_LOCK:
                OAUTH_TOKEN_STORE.pop(session_id, None)
                OAUTH_REFRESH_LOCKS.pop(session_id, None)
        return
    now = time.time()
    session_id = session.get('atlassian_oauth_session_id')
    with OAUTH_TOKEN_STORE_LOCK:
        expired = [
            stored_id
            for stored_id, stored in OAUTH_TOKEN_STORE.items()
            if now - stored.get('stored_at', 0) > OAUTH_TOKEN_STORE_TTL_SECONDS
        ]
        for stored_id in expired:
            OAUTH_TOKEN_STORE.pop(stored_id, None)
            OAUTH_REFRESH_LOCKS.pop(stored_id, None)
        if not session_id:
            session_id = new_oauth_state()
            session['atlassian_oauth_session_id'] = session_id
        OAUTH_TOKEN_STORE[session_id] = dict(data, stored_at=now)
        OAUTH_REFRESH_LOCKS.setdefault(session_id, threading.Lock())


def oauth_refresh_lock():
    session_id = session.get('atlassian_oauth_session_id')
    if not session_id:
        return OAUTH_TOKEN_STORE_LOCK
    with OAUTH_TOKEN_STORE_LOCK:
        return OAUTH_REFRESH_LOCKS.setdefault(session_id, threading.Lock())


def oauth_session_data():
    session_id = session.get('atlassian_oauth_session_id')
    if not session_id:
        return {}
    with OAUTH_TOKEN_STORE_LOCK:
        data = OAUTH_TOKEN_STORE.get(session_id) or {}
    if data and time.time() - data.get('stored_at', 0) > OAUTH_TOKEN_STORE_TTL_SECONDS:
        save_oauth_session({})
        return {}
    return data


def auth_error_response(error, status=401):
    return jsonify({'error': error.code, 'message': str(error)}), status


def validate_local_token_store_allowed():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return
    environment = APP_ENVIRONMENT_KEY.strip().lower()
    if environment not in {'local', 'dev', 'development'} or not OAUTH_LOCAL_TOKEN_STORE_ALLOWED:
        raise AuthError(
            'local_token_store_not_allowed',
            'Local OAuth token storage requires APP_ENVIRONMENT_KEY=local or dev and OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true',
        )
```

Create `backend/routes/auth_routes.py` and register routes as a blueprint:

```python
from flask import Blueprint, jsonify, redirect, request, session

from . import bind_server_globals


bp = Blueprint("auth_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.route('/api/auth/status', methods=['GET'])
def api_auth_status():
    if JIRA_AUTH_MODE == AUTH_MODE_BASIC:
        return jsonify({
            'authMode': AUTH_MODE_BASIC,
            'authenticated': bool(JIRA_URL and JIRA_EMAIL and JIRA_TOKEN),
            'loginRequired': False,
        })
    data = oauth_session_data()
    return jsonify({
        'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
        'authenticated': bool(data.get('access_token') and data.get('cloudid')),
        'loginRequired': not bool(data.get('access_token') and data.get('cloudid')),
        'siteUrl': data.get('site_url'),
        'siteName': data.get('site_name'),
    })


@bp.route('/api/auth/atlassian/login', methods=['GET'])
def api_atlassian_login():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return auth_error_response(AuthError('oauth_not_enabled', 'Atlassian OAuth auth mode is not enabled'), 400)
    config = current_auth_config()
    try:
        validate_auth_config(config)
        validate_local_token_store_allowed()
    except AuthError as error:
        return auth_error_response(error, 400)
    state = new_oauth_state()
    verifier = new_pkce_verifier()
    session['oauth_state'] = state
    session['oauth_pkce_verifier'] = verifier
    return redirect(build_authorize_url(config, state, build_pkce_challenge(verifier)))


@bp.route('/api/auth/atlassian/callback', methods=['GET'])
def api_atlassian_callback():
    expected_state = session.pop('oauth_state', None)
    code_verifier = session.pop('oauth_pkce_verifier', None)
    actual_state = request.args.get('state')
    if not expected_state or actual_state != expected_state:
        return jsonify({'error': 'invalid_oauth_state'}), 400
    if request.args.get('error'):
        return jsonify({'error': 'oauth_authorization_failed'}), 400
    code = request.args.get('code')
    if not code:
        return jsonify({'error': 'missing_oauth_code'}), 400
    if not code_verifier:
        return jsonify({'error': 'missing_pkce_verifier'}), 400
    config = current_auth_config()
    try:
        token_data = exchange_authorization_code(config, code, code_verifier)
        user_profile = fetch_current_user(token_data.get('access_token', ''))
        if user_profile.get('account_status') != 'active':
            return jsonify({'error': 'user_inactive'}), 403
        resources = fetch_accessible_resources(token_data.get('access_token', ''))
        resource = choose_accessible_resource(resources, config.jira_url)
        save_oauth_session(token_session_payload(token_data, resource, user_profile))
    except AuthError as error:
        return auth_error_response(error, 401 if error.code != 'jira_site_not_accessible' else 403)
    return redirect('/')


@bp.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    save_oauth_session({})
    session.pop('oauth_state', None)
    session.pop('oauth_pkce_verifier', None)
    return jsonify({'ok': True})
```

Register the blueprint in `backend/app.py`:

```python
import os


def _allowed_cors_origins():
    raw = os.getenv('APP_ALLOWED_ORIGINS', 'http://localhost:5050,http://127.0.0.1:5050')
    return [origin.strip() for origin in raw.split(',') if origin.strip()]


def register_blueprints(flask_app):
    from backend.routes.auth_routes import bp as auth_bp
    from backend.routes.eng_routes import bp as eng_bp
    from backend.routes.epm_routes import bp as epm_bp
    from backend.routes.settings_routes import bp as settings_bp

    flask_app.register_blueprint(auth_bp)
    flask_app.register_blueprint(epm_bp)
    flask_app.register_blueprint(eng_bp)
    flask_app.register_blueprint(settings_bp)
    return flask_app
```

Also replace broad `CORS(flask_app)` with an explicit allowlist and set cookie defaults:

```python
flask_app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.getenv('SESSION_COOKIE_SECURE', 'false').lower() in {'1', 'true', 'yes'},
)
CORS(flask_app, origins=_allowed_cors_origins(), supports_credentials=True)
```

Add a temporary unsafe-method guard for OAuth mode. This is not the final DB-backed CSRF token design; it is the minimum OAuth-slice guard that prevents classic form-post CSRF once the app starts using a browser session cookie:

```python
UNSAFE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


@app.before_request
def require_oauth_unsafe_method_header():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    if request.method not in UNSAFE_METHODS:
        return None
    if request.headers.get('X-Requested-With') == 'jira-execution-planner':
        return None
    return jsonify({
        'error': 'csrf_required',
        'message': 'Unsafe OAuth requests require X-Requested-With: jira-execution-planner',
    }), 403
```

All first-party browser clients that call unsafe routes in OAuth mode must include `X-Requested-With: jira-execution-planner`. The DB phase may replace this with `X-CSRF-Token`, but it must not remove the unsafe-method protection.

- [ ] **Step 4: Run route tests**

Run: `python3 -m unittest tests.test_auth_routes -v`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/app.py backend/routes/auth_routes.py jira_server.py tests/test_auth_routes.py
git commit -m "Add Atlassian OAuth login routes"
```

---

## Task 3: Migrate First Jira Calls Through Auth Helper

**Files:**
- Modify: `backend/auth/jira_auth.py`
- Modify: `jira_server.py`
- Modify: `tests/test_jira_auth.py`

- [ ] **Step 1: Add request wrapper and refresh-lock tests**

Add these imports to `tests/test_jira_auth.py`:

```python
import threading
from concurrent.futures import ThreadPoolExecutor
```

Then append:

```python
    def test_jira_get_uses_built_url_and_headers(self):
        config = AuthConfig(
            auth_mode='basic',
            jira_url='https://example.atlassian.net',
            jira_email='user@example.com',
            jira_token='token-123',
        )
        context = RequestAuthContext(
            auth_mode='basic',
            user_id='local-user',
            stable_subject='local-basic',
            atlassian_account_id='',
            workspace_id='workspace-1',
            auth_connection_id='local-basic-connection',
            cloud_id='',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=True,
        )
        http_get = Mock()
        http_get.return_value.status_code = 200
        from backend.auth.jira_auth import jira_get
        response = jira_get(config, context, {}, '/rest/api/3/project/search', http_get=http_get, timeout=15)
        self.assertEqual(response.status_code, 200)
        called_url = http_get.call_args.args[0]
        self.assertEqual(called_url, 'https://example.atlassian.net/rest/api/3/project/search')
        self.assertIn('Authorization', http_get.call_args.kwargs['headers'])

    def test_concurrent_oauth_refresh_only_calls_provider_once(self):
        from backend.auth.jira_auth import ensure_oauth_token

        config = AuthConfig(
            auth_mode='atlassian_oauth',
            jira_url='https://example.atlassian.net',
            client_id='client-123',
            client_secret='secret-123',
        )
        shared_session = {
            'access_token': 'old-access',
            'refresh_token': 'refresh-1',
            'expires_at': time.time() - 10,
        }
        session_lock = threading.Lock()
        refresh_lock = threading.Lock()
        start = threading.Barrier(2)

        def load_session():
            with session_lock:
                return dict(shared_session)

        def save_session(data):
            with session_lock:
                shared_session.update(data)

        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            'access_token': 'access-2',
            'refresh_token': 'refresh-2',
            'expires_in': 3600,
        }
        http_post = Mock(return_value=response)

        def worker():
            initial = load_session()
            start.wait(timeout=5)
            return ensure_oauth_token(
                config,
                initial,
                save_session,
                http_post=http_post,
                reload_session=load_session,
                refresh_lock=refresh_lock,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: worker(), range(2)))

        self.assertEqual(http_post.call_count, 1)
        self.assertEqual(shared_session['refresh_token'], 'refresh-2')
        self.assertEqual([result['access_token'] for result in results], ['access-2', 'access-2'])
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
python3 -m unittest \
  tests.test_jira_auth.TestJiraAuth.test_jira_get_uses_built_url_and_headers \
  tests.test_jira_auth.TestJiraAuth.test_concurrent_oauth_refresh_only_calls_provider_once \
  -v
```

Expected: FAIL because `jira_get` and refresh-locked `ensure_oauth_token` do not exist.

- [ ] **Step 3: Add request wrappers**

Add this import near the top of `backend/auth/jira_auth.py`:

```python
from contextlib import nullcontext
```

Then append the request wrappers:

```python
def ensure_oauth_token(
    config,
    session_data,
    save_session,
    http_post=requests.post,
    reload_session=None,
    refresh_lock=None,
):
    if config.auth_mode != AUTH_MODE_ATLASSIAN_OAUTH:
        return session_data
    if not session_data.get('access_token'):
        raise AuthError('auth_required', 'User must sign in with Atlassian')
    if not is_oauth_token_expired(session_data):
        return session_data
    lock = refresh_lock or nullcontext()
    with lock:
        active_session = reload_session() if reload_session else session_data
        if not active_session.get('access_token'):
            raise AuthError('auth_required', 'User must sign in with Atlassian')
        if not is_oauth_token_expired(active_session):
            return active_session
        refreshed = refresh_oauth_token(config, active_session, http_post=http_post)
        save_session(refreshed)
        return refreshed


def jira_get(
    config,
    context,
    session_data,
    path,
    http_get=requests.get,
    save_session=None,
    reload_session=None,
    refresh_lock=None,
    **kwargs,
):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(
        config,
        session_data,
        save_session,
        reload_session=reload_session,
        refresh_lock=refresh_lock,
    )
    return http_get(
        build_jira_api_url(config, context, path),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )


def jira_post(
    config,
    context,
    session_data,
    path,
    http_post=requests.post,
    save_session=None,
    reload_session=None,
    refresh_lock=None,
    **kwargs,
):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(
        config,
        session_data,
        save_session,
        reload_session=reload_session,
        refresh_lock=refresh_lock,
    )
    return http_post(
        build_jira_api_url(config, context, path),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )
```

In `jira_server.py`, import `RequestAuthContext` and `stable_local_workspace_id` from `backend.auth.context`, plus `jira_get` and `jira_post` from `backend.auth.jira_auth`. Reuse `APP_ENVIRONMENT_KEY`, `save_oauth_session`, and `oauth_session_data` from Task 2, then add:

```python
def jira_session_data():
    if JIRA_AUTH_MODE == AUTH_MODE_ATLASSIAN_OAUTH:
        return oauth_session_data()
    return {}


def current_request_auth_context():
    session_data = jira_session_data()
    site_url = normalize_site_url(session_data.get('site_url') or JIRA_URL or '')
    cloud_id = session_data.get('cloudid', '')
    workspace_id = stable_local_workspace_id(APP_ENVIRONMENT_KEY, site_url, cloud_id)
    if JIRA_AUTH_MODE == AUTH_MODE_ATLASSIAN_OAUTH:
        session_id = session.get('atlassian_oauth_session_id') or ''
        return RequestAuthContext(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            user_id=f'local-oauth-user:{session_data.get("account_id", "")}',
            stable_subject=session_data.get('account_id', ''),
            atlassian_account_id=session_data.get('account_id', ''),
            workspace_id=workspace_id,
            auth_connection_id=f'local-oauth-connection:{session_id}',
            cloud_id=cloud_id,
            site_url=site_url,
            token_version=str(session_data.get('stored_at', '1')),
            account_status=session_data.get('account_status', ''),
            is_admin=False,
        )
    return RequestAuthContext(
        auth_mode=AUTH_MODE_BASIC,
        user_id='local-basic-user',
        stable_subject='local-basic',
        atlassian_account_id='',
        workspace_id=workspace_id,
        auth_connection_id='local-basic-connection',
        cloud_id='',
        site_url=site_url,
        token_version='1',
        account_status='active',
        is_admin=True,
    )
```

Migrate `/api/test` to call a small Jira endpoint through `jira_get`. Keep its response shape compatible with current frontend expectations. Use:

```python
try:
    response = jira_get(
        current_auth_config(),
        current_request_auth_context(),
        jira_session_data(),
        '/rest/api/3/myself',
        save_session=save_oauth_session,
        reload_session=oauth_session_data,
        refresh_lock=oauth_refresh_lock(),
        timeout=15,
    )
except AuthError as error:
    if error.code == 'auth_required':
        save_oauth_session({})
        return jsonify({
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        }), 401
    raise
```

If the route currently tests another endpoint, preserve the route's JSON keys and only replace URL/header construction. Every OAuth-aware route that can refresh tokens must pass both `reload_session=oauth_session_data` and `refresh_lock=oauth_refresh_lock()` so a waiting request re-reads the session after acquiring the lock before calling Atlassian.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_jira_auth tests.test_auth_routes -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/auth/jira_auth.py jira_server.py tests/test_jira_auth.py
git commit -m "Route initial Jira calls through auth helper"
```

---

## Task 4: OAuth Entry, Focus Refresh, And Recovery Outside Dashboard Bundle

**Files:**
- Modify: `backend/routes/auth_routes.py`
- Modify: `jira_server.py`
- Modify: `jira-dashboard.html`
- Modify: `tests/test_auth_routes.py`
- Create: `tests/test_auth_entry_page.py`

- [ ] **Step 1: Write entry-screen tests**

Create `tests/test_auth_entry_page.py`:

```python
import unittest
from unittest.mock import patch

import jira_server


class TestAuthEntryPage(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        if hasattr(jira_server, 'OAUTH_TOKEN_STORE'):
            jira_server.OAUTH_TOKEN_STORE.clear()
        self.client = jira_server.app.test_client()

    def test_oauth_login_page_shows_atlassian_sign_in_action(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login')
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response.headers['Content-Type'])
        body = response.get_data(as_text=True)
        self.assertIn('Sign in with Atlassian', body)
        self.assertIn('/api/auth/atlassian/login', body)
        self.assertNotIn('access_token', body)
        self.assertNotIn('refresh_token', body)

    def test_oauth_dashboard_entry_redirects_unauthenticated_user_to_login_page(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/login')

    def test_basic_mode_does_not_show_oauth_login_page(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = self.client.get('/login')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/')

    def test_login_page_shows_expired_session_message(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login?reason=session_expired')
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('Your Jira sign-in expired', body)
        self.assertIn('Sign in with Atlassian', body)
```

Add `import time` to `tests/test_auth_routes.py`, then extend it:

```python
    def test_oauth_refresh_requires_session(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/auth/refresh',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertEqual(response.get_json()['loginUrl'], '/login?reason=session_expired')

    def test_oauth_refresh_returns_authenticated_without_tokens(self):
        with self.client.session_transaction() as session:
            session['atlassian_oauth_session_id'] = 'session-123'
        jira_server.OAUTH_TOKEN_STORE['session-123'] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 600,
            'cloudid': 'cloud-123',
            'site_url': 'https://example.atlassian.net',
        }
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/auth/refresh',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body['authenticated'])
        self.assertNotIn('access_token', body)
        self.assertNotIn('refresh_token', body)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 -m unittest tests.test_auth_entry_page tests.test_auth_routes -v`

Expected: FAIL because `/login`, `/api/auth/refresh`, and the unauthenticated dashboard gate do not exist.

- [ ] **Step 3: Add backend-served login page**

Add the OAuth entry page to `backend/routes/auth_routes.py`. Keep it intentionally separate from `frontend/src/dashboard.jsx`:

```python
@bp.route('/login', methods=['GET'])
def auth_entry_page():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return redirect('/')
    data = oauth_session_data()
    if data.get('access_token') and data.get('cloudid'):
        return redirect('/')
    reason = request.args.get('reason')
    message = ''
    if reason == 'session_expired':
        message = '<p>Your Jira sign-in expired. Sign in again to continue.</p>'
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in</title>
  </head>
  <body>
    <main>
      <h1>Sign in to Jira Execution Planner</h1>
      {message}
      <a href="/api/auth/atlassian/login">Sign in with Atlassian</a>
    </main>
  </body>
</html>
""", 200, {'Content-Type': 'text/html; charset=utf-8'}
```

Add a lightweight refresh endpoint to the same auth blueprint:

```python
@bp.route('/api/auth/refresh', methods=['POST'])
def api_auth_refresh():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'authenticated': True, 'authMode': AUTH_MODE_BASIC})
    data = oauth_session_data()
    if not data.get('access_token') or not data.get('cloudid'):
        save_oauth_session({})
        return jsonify({
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        }), 401
    try:
        active = ensure_oauth_token(
            current_auth_config(),
            data,
            save_oauth_session,
            reload_session=oauth_session_data,
            refresh_lock=oauth_refresh_lock(),
        )
    except AuthError as error:
        if error.code == 'auth_required':
            save_oauth_session({})
            return jsonify({
                'error': 'auth_required',
                'message': 'Your Jira sign-in expired. Sign in again to continue.',
                'loginUrl': '/login?reason=session_expired',
            }), 401
        return auth_error_response(error, 401)
    return jsonify({
        'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
        'authenticated': True,
        'loginRequired': False,
        'expiresAt': active.get('expires_at'),
        'siteUrl': active.get('site_url'),
        'siteName': active.get('site_name'),
    })
```

This page is an auth shell only. It must not read Jira data, call Home, load `frontend/src/dashboard.jsx`, store tokens in browser storage, or include product-dashboard controls. Atlassian and Microsoft own the downstream login, SSO, and consent screens.

- [ ] **Step 4: Gate dashboard entry in OAuth mode**

Add a small `before_request` guard in `jira_server.py` before the dashboard route runs:

```python
OAUTH_DASHBOARD_ENTRY_PATHS = {'/', '/jira-dashboard.html'}


@app.before_request
def redirect_unauthenticated_oauth_dashboard_entry():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    if request.path not in OAUTH_DASHBOARD_ENTRY_PATHS:
        return None
    data = oauth_session_data()
    if data.get('access_token') and data.get('cloudid'):
        return None
    reason = 'session_expired' if session.get('atlassian_oauth_session_id') else ''
    return redirect('/login?reason=session_expired' if reason else '/login')
```

Keep API behavior separate: API routes should return JSON auth errors or `route_not_oauth_ready`/501, not HTML redirects. When an OAuth-aware API route gets `AuthError('auth_required', ...)` from token refresh or missing token state, clear the local OAuth session and include `loginUrl: "/login?reason=session_expired"` in the JSON response so callers have a stable re-auth target.

- [ ] **Step 5: Add focus/visibility refresh outside dashboard JSX**

Add a tiny auth-shell script to `jira-dashboard.html`, not `frontend/src/dashboard.jsx`. It should be safe in Basic mode, no-op there through the server response, throttle calls to at most once per minute, and never handle token material:

```html
<script>
(() => {
  let lastAuthRefreshAt = 0;
  async function refreshAuthOnFocus() {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastAuthRefreshAt < 60000) return;
    lastAuthRefreshAt = now;
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'X-Requested-With': 'jira-execution-planner'},
      });
      if (response.status === 401) {
        const body = await response.json().catch(() => ({}));
        window.location.assign(body.loginUrl || '/login?reason=session_expired');
      }
    } catch (error) {
      // Leave network failures to the next focused attempt or API request.
    }
  }
  window.addEventListener('focus', refreshAuthOnFocus);
  document.addEventListener('visibilitychange', refreshAuthOnFocus);
})();
</script>
```

If the script is served conditionally by Flask instead of statically in `jira-dashboard.html`, keep the same isolation rule: the focus handler may live in the HTML/auth shell, but not in `frontend/src/dashboard.jsx`.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_auth_entry_page tests.test_auth_routes tests.test_jira_auth -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/routes/auth_routes.py jira_server.py jira-dashboard.html tests/test_auth_entry_page.py tests/test_auth_routes.py
git commit -m "Add OAuth entry screen outside dashboard"
```

---

## Task 5: Unsupported OAuth Route Guard

**Files:**
- Modify: `jira_server.py`
- Create: `tests/test_oauth_route_guards.py`

- [ ] **Step 1: Write route guard tests**

Create `tests/test_oauth_route_guards.py`:

```python
import unittest
from unittest.mock import patch

import jira_server


class TestOauthRouteGuards(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()

    def test_oauth_mode_blocks_unmigrated_api_route(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_oauth_mode_allows_auth_status(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)

    def test_basic_mode_does_not_apply_oauth_route_guard(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = self.client.get('/api/config')
        self.assertNotEqual(response.status_code, 501)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 -m unittest tests.test_oauth_route_guards -v`

Expected: FAIL because unsupported routes are not guarded in OAuth mode.

- [ ] **Step 3: Add the runtime guard**

Add the guard near the auth helpers in `jira_server.py`:

```python
OAUTH_READY_API_PATHS = {
    '/api/test',
}


def is_oauth_ready_api_path(path):
    return path.startswith('/api/auth/') or path in OAUTH_READY_API_PATHS


@app.before_request
def reject_unmigrated_oauth_routes():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    if request.path.startswith('/api/') and not is_oauth_ready_api_path(request.path):
        return jsonify({
            'error': 'route_not_oauth_ready',
            'message': 'This API route has not been migrated to Atlassian OAuth yet',
        }), 501
    return None
```

Also update the legacy `build_jira_headers()` helper in `jira_server.py` so any accidental direct call in OAuth mode fails instead of emitting `Authorization: Basic Og==`:

```python
def build_jira_headers():
    if JIRA_AUTH_MODE != AUTH_MODE_BASIC:
        raise AuthError(
            'route_not_oauth_ready',
            'This Jira route has not been migrated to Atlassian OAuth yet',
        )
    credentials = base64.b64encode(f"{JIRA_EMAIL or ''}:{JIRA_TOKEN or ''}".encode()).decode()
    return {
        'Authorization': f'Basic {credentials}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
```

The app-level guard is the protection for inline Basic-header construction sites in `backend/routes/eng_routes.py`, `backend/routes/settings_routes.py`, `backend/routes/epm_routes.py`, and the remaining `jira_server.py` routes. Do not migrate those routes in this slice; they must return 501 under OAuth until each route is intentionally moved to `jira_get`/`jira_post`.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_oauth_route_guards tests.test_auth_routes tests.test_jira_auth -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add jira_server.py tests/test_oauth_route_guards.py
git commit -m "Guard unmigrated routes in OAuth mode"
```

---

## Task 6: OAuth Cache Isolation Guard

**Files:**
- Create: `backend/auth/cache_policy.py`
- Modify: `jira_server.py`
- Modify: `backend/epm/home.py`
- Modify: `backend/epm/projects.py`
- Modify: `backend/epm/rollup.py`
- Modify: `backend/routes/epm_routes.py`
- Create: `tests/test_oauth_cache_isolation.py`

- [ ] **Step 1: Write cache isolation tests**

Create `tests/test_oauth_cache_isolation.py`:

```python
import unittest
from pathlib import Path

from backend.auth.cache_policy import jira_home_process_cache_enabled
from backend.auth.context import RequestAuthContext


def context(auth_mode):
    return RequestAuthContext(
        auth_mode=auth_mode,
        user_id='user-1',
        stable_subject='subject-1',
        atlassian_account_id='account-1',
        workspace_id='workspace-1',
        auth_connection_id='connection-1',
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version='1',
        account_status='active',
        is_admin=False,
    )


class TestOauthCacheIsolation(unittest.TestCase):
    def test_basic_mode_allows_process_caches(self):
        self.assertTrue(jira_home_process_cache_enabled(context('basic')))

    def test_oauth_mode_disables_process_caches(self):
        self.assertFalse(jira_home_process_cache_enabled(context('atlassian_oauth')))

    def test_known_jira_home_cache_modules_use_cache_policy(self):
        cache_sources = {
            'jira_server.py': [
                'SCENARIO_CACHE',
                'TASKS_CACHE',
                'EPIC_COHORT_CACHE',
                'EPM_PROJECTS_CACHE',
                'EPM_ISSUES_CACHE',
                'EPM_ROLLUP_CACHE',
                'TEAM_FIELD_CACHE',
                'PARENT_NAME_FIELD_CACHE',
                'EPIC_LINK_FIELD_CACHE',
                'CAPACITY_FIELD_CACHE',
            ],
            'backend/routes/epm_routes.py': ['EPM_ISSUES_CACHE'],
            'backend/epm/home.py': ['_CLOUD_ID_CACHE', '_GOAL_BY_KEY_CACHE'],
            'backend/epm/projects.py': ['build_epm_home_projects_cache_key'],
            'backend/epm/rollup.py': ['cache_key'],
        }
        for path, cache_symbols in cache_sources.items():
            source = Path(path).read_text()
            self.assertIn('jira_home_process_cache_enabled', source, path)
            for symbol in cache_symbols:
                self.assertIn(symbol, source, path)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python3 -m unittest tests.test_oauth_cache_isolation -v`

Expected: FAIL because cache policy and cache-site guards do not exist.

- [ ] **Step 3: Add the cache policy helper**

Create `backend/auth/cache_policy.py`:

```python
AUTH_MODE_BASIC = 'basic'


def jira_home_process_cache_enabled(context):
    return getattr(context, 'auth_mode', AUTH_MODE_BASIC) == AUTH_MODE_BASIC
```

- [ ] **Step 4: Guard all Jira/Home-derived process cache reads and writes**

Disable, rather than key, process caches for OAuth in this slice. Every read and write for the following caches must be wrapped in `jira_home_process_cache_enabled(context)`:

- `jira_server.py`: `SCENARIO_CACHE`, `TASKS_CACHE`, `EPIC_COHORT_CACHE`, `EPM_PROJECTS_CACHE`, `EPM_ISSUES_CACHE`, `EPM_ROLLUP_CACHE`, `TEAM_FIELD_CACHE`, `PARENT_NAME_FIELD_CACHE`, `EPIC_LINK_FIELD_CACHE`, `CAPACITY_FIELD_CACHE`.
- `backend/epm/home.py`: `_CLOUD_ID_CACHE`, `_GOAL_BY_KEY_CACHE`.
- `backend/epm/projects.py`: Home project metadata caches, including keys produced by `build_epm_home_projects_cache_key`.
- `backend/epm/rollup.py`: rollup payload caches keyed by scope/sprint.
- `backend/routes/epm_routes.py`: EPM issue payload cache reads/writes.

Do not clear Basic-mode cache entries just because an OAuth request arrives. The OAuth path must bypass reads and writes; Basic mode may continue using the existing caches.

If a helper does not currently accept `RequestAuthContext`, add the smallest parameter needed to pass `current_request_auth_context()` or an equivalent context from its caller. Do not use `JIRA_EMAIL`, `JIRA_TOKEN`, session globals, or raw OAuth token values as cache-key material.

After editing, run `rg -n "SCENARIO_CACHE|TASKS_CACHE|EPIC_COHORT_CACHE|EPM_PROJECTS_CACHE|EPM_ISSUES_CACHE|EPM_ROLLUP_CACHE|TEAM_FIELD_CACHE|PARENT_NAME_FIELD_CACHE|EPIC_LINK_FIELD_CACHE|CAPACITY_FIELD_CACHE|_CLOUD_ID_CACHE|_GOAL_BY_KEY_CACHE|build_epm_home_projects_cache_key" jira_server.py backend` and inspect every hit. Each cache read/write must either be Basic-only through `jira_home_process_cache_enabled(context)` or be removed from the OAuth path.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_oauth_cache_isolation tests.test_oauth_route_guards tests.test_jira_auth -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/auth/cache_policy.py jira_server.py backend/epm/home.py backend/epm/projects.py backend/epm/rollup.py backend/routes/epm_routes.py tests/test_oauth_cache_isolation.py
git commit -m "Disable Jira caches for OAuth users"
```

---

## Task 7: Dashboard Isolation Guard

**Files:**
- Create: `tests/test_auth_isolation_source_guard.js`

- [ ] **Step 1: Add source guard test**

Create `tests/test_auth_isolation_source_guard.js`:

```javascript
const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');

assert(
  !source.includes('/api/auth/status'),
  'auth-mode implementation must stay isolated from dashboard.jsx in this slice'
);

assert(
  !source.includes('/api/auth/atlassian/login'),
  'dashboard.jsx must not expose Atlassian login UI in this slice'
);

assert(
  !source.includes('/api/auth/refresh'),
  'dashboard.jsx must not own OAuth focus refresh in this slice'
);

assert(
  !source.includes('session_expired'),
  'dashboard.jsx must not own expired-auth screen routing in this slice'
);

assert(
  !source.includes('auth_required'),
  'dashboard.jsx must not add auth_required handling in this slice'
);

assert(
  !source.includes('localStorage.setItem(\\'atlassian'),
  'dashboard must not store Atlassian tokens in localStorage'
);
```

- [ ] **Step 2: Run source guard**

Run: `node tests/test_auth_isolation_source_guard.js`

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add tests/test_auth_isolation_source_guard.js
git commit -m "Guard dashboard isolation for OAuth auth mode"
```

Expected: commit includes only the source guard.

---

## Task 8: Configuration Docs and Startup Validation

**Files:**
- Modify: `jira_server.py`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add startup validation tests or manual check**

If no existing startup validation tests are practical, use the route tests from Task 2 as coverage and add the explicit positive and negative startup-validation checks in Step 4. Do not rely on `python3 jira_server.py --help`; argument help can exit before startup validation runs.

- [ ] **Step 2: Update startup validation**

In the `__main__` startup validation block in `jira_server.py`, replace the Basic-only check:

```python
if not JIRA_URL or not JIRA_EMAIL or not JIRA_TOKEN:
    log_error('JIRA_URL, JIRA_EMAIL and JIRA_TOKEN must be set via environment or CLI')
    log_info('Please copy .env.example to .env, fill in credentials, or pass them as flags')
    exit(1)
```

with:

```python
try:
    validate_auth_config(current_auth_config())
    validate_local_token_store_allowed()
except AuthError as error:
    log_error(str(error))
    log_info('Please copy .env.example to .env and configure either basic auth or Atlassian OAuth')
    exit(1)
```

Change startup logging so it does not print an email in OAuth mode:

```python
log_info(f'   Auth mode: {JIRA_AUTH_MODE}')
if JIRA_AUTH_MODE == AUTH_MODE_BASIC:
    log_info(f'   Email: {JIRA_EMAIL}')
```

- [ ] **Step 3: Update config docs**

Add to `.env.example`:

```text
# Auth mode: basic keeps the existing API-token flow; atlassian_oauth enables browser login.
JIRA_AUTH_MODE=basic
APP_ENVIRONMENT_KEY=local

# Required for JIRA_AUTH_MODE=atlassian_oauth.
# Create an OAuth 2.0 (3LO) app in the Atlassian Developer Console.
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user offline_access

# Required for stable Flask sessions in OAuth mode. Use a long random value locally.
FLASK_SECRET_KEY=

# Required to use the temporary process-local OAuth token store.
# Requires APP_ENVIRONMENT_KEY=local or dev. Keep false outside explicit local/single-process development.
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false
```

Add a README section:

```markdown
### Atlassian OAuth login

The dashboard can run with Atlassian OAuth 2.0 (3LO) instead of a personal Jira API token.

1. Create an OAuth 2.0 app in the Atlassian Developer Console.
2. Add Jira API permissions for the scopes in `ATLASSIAN_SCOPES`.
3. Set the callback URL to `http://localhost:5050/api/auth/atlassian/callback`, or to an HTTPS tunnel URL if your Atlassian app requires HTTPS.
4. Set `JIRA_AUTH_MODE=atlassian_oauth`, `APP_ENVIRONMENT_KEY=local`, `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_REDIRECT_URI`, `FLASK_SECRET_KEY`, and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true` for local single-process testing. OAuth startup must fail unless both the environment key is local/dev and the local token store flag is true.
5. Start the server and open `/`. If no OAuth session exists, the app should show `/login` with a `Sign in with Atlassian` action. That action starts Atlassian OAuth; for managed Atlassian accounts backed by Microsoft Entra SSO, the flow should redirect through Microsoft automatically, then show the Atlassian authorization/consent screen for this app before returning to the app callback. Confirm `/api/auth/status` reports `authenticated: true`, then use the migrated endpoint `/api/test`. Full dashboard data-route migration is intentionally deferred; un-migrated API routes return `route_not_oauth_ready`/501 in OAuth mode.

Jira still receives Atlassian OAuth tokens, not Microsoft Entra tokens. Direct Microsoft access tokens cannot be used as Jira REST API bearer tokens.
```

- [ ] **Step 4: Run verification**

Run:

```bash
python3 -m unittest tests.test_jira_auth tests.test_auth_routes tests.test_auth_entry_page tests.test_oauth_route_guards tests.test_oauth_cache_isolation -v
node tests/test_auth_isolation_source_guard.js
APP_ENVIRONMENT_KEY=local JIRA_AUTH_MODE=atlassian_oauth JIRA_URL=https://example.atlassian.net ATLASSIAN_CLIENT_ID=client ATLASSIAN_CLIENT_SECRET=secret ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback FLASK_SECRET_KEY=test OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true python3 -c "import jira_server; jira_server.validate_auth_config(jira_server.current_auth_config()); jira_server.validate_local_token_store_allowed()"
APP_ENVIRONMENT_KEY=production JIRA_AUTH_MODE=atlassian_oauth JIRA_URL=https://example.atlassian.net ATLASSIAN_CLIENT_ID=client ATLASSIAN_CLIENT_SECRET=secret ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback FLASK_SECRET_KEY=test OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true python3 -c "import jira_server; jira_server.validate_auth_config(jira_server.current_auth_config()); jira_server.validate_local_token_store_allowed()"
```

Expected: Python tests PASS, source guard PASS, the local validation command exits 0, and the production validation command exits nonzero with `local_token_store_not_allowed`.

- [ ] **Step 5: Commit**

Run:

```bash
git add jira_server.py .env.example README.md
git commit -m "Document Atlassian OAuth configuration"
```

---

## Task 9: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend tests**

Run: `python3 -m unittest discover -s tests`

Expected: PASS.

- [ ] **Step 2: Run dashboard isolation guard**

Run: `node tests/test_auth_isolation_source_guard.js`

Expected: PASS.

- [ ] **Step 3: Manual browser user-journey smoke test**

With a real Atlassian OAuth app configured in `.env` and a managed Atlassian account from the Microsoft Entra-backed organization, run:

```bash
python3 jira_server.py
```

Open `http://localhost:5050/`, confirm the unauthenticated app shows `/login` with a `Sign in with Atlassian` action, start sign-in, confirm the browser is redirected through Microsoft Entra SSO by Atlassian, confirm the Atlassian authorization/consent screen is shown with the app and requested Jira scopes, complete authorization, and confirm the browser returns to `/` without looping back to `/login`.

Capture or record evidence for the user journey in the PR notes: the `/login` entry screen, the `/login?reason=session_expired` expired-auth screen, the focus/visibility refresh behavior, the Atlassian consent step, and the authenticated post-callback state. Do not report the OAuth slice complete from backend tests alone.

Then confirm `/api/auth/status` returns:

```json
{
  "authMode": "atlassian_oauth",
  "authenticated": true,
  "loginRequired": false
}
```

Then confirm `/api/test` uses the OAuth Jira gateway successfully, returning to a visible tab calls `/api/auth/refresh` without exposing token material, an expired or cleared OAuth session returns `401` with `error: "auth_required"` and `loginUrl: "/login?reason=session_expired"`, and an un-migrated API route such as `/api/config` returns `501` with `error: "route_not_oauth_ready"`.

- [ ] **Step 4: Review commits**

Run: `git log --oneline -5`

Expected: the OAuth commits from this plan are visible and only contain the planned files.

- [ ] **Step 5: Stop for user review before push**

Do not push. This repo requires explicit user confirmation before push.

---

## Plan Self-Review

- Spec coverage: the plan covers auth mode config, an app-owned OAuth entry screen, focus/visibility refresh, OAuth login/callback, local server-side token storage, refresh locking, resource selection, Jira URL/header construction, unsupported-route guards, OAuth cache disabling, dashboard bundle isolation, docs, and verification.
- User journey coverage: the final gate requires browser evidence for unauthenticated entry, Atlassian/Microsoft sign-in, Atlassian consent, authenticated return, focus/visibility refresh, expired-auth recovery, `/api/auth/status`, the migrated Jira test route, and clear unsupported-route failure.
- Previous branch review: `feature/atlassian-oauth-auth` is treated as source material only. The plan carries forward its auth helper primitives, server-side token session idea, refresh failure clearing, route tests, source guard, and docs; it does not carry forward root-level `jira_auth.py`, direct `jira_server.py` routes, missing PKCE, missing `/me` identity, or global-session Jira wrappers.
- Implementation consistency: the Jira wrappers now take `RequestAuthContext` explicitly, serialize refresh per OAuth session, and require OAuth-aware callers to re-read session state inside the refresh lock.
- DB alignment: this plan creates the auth/client boundary required before PostgreSQL-backed `users`, `workspaces`, `auth_connections`, encrypted `auth_tokens`, and `jira_project_access`; it blocks un-migrated routes and disables Jira/Home process caches for OAuth users so the DB phase does not inherit silent Basic fallback or process-global cache leakage.
- Scope: Confluence support, full dashboard data-route migration, production multi-user persistence, and user-owned saved views are intentionally deferred.
- Risk: the OAuth entry screen is covered, but full dashboard data-route migration is intentionally deferred, so OAuth mode remains a local bridge until more routes migrate through the auth/client boundary.
