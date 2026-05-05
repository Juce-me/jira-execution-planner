# Atlassian OAuth Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Atlassian OAuth 2.0 3LO login so Jira Execution Planner can call Jira on behalf of the signed-in user without requiring a personal API token.

**Architecture:** Keep `basic` auth as the default and introduce `atlassian_oauth` behind `JIRA_AUTH_MODE`. Add a small backend auth/client boundary in the current `backend/` package, migrate the first Jira endpoints through it, and keep auth-mode changes isolated from `frontend/src/dashboard.jsx`. This slice is the prerequisite for later database-backed identity and token storage; it does not create database tables or production multi-user persistence.

**Tech Stack:** Python Flask, `requests`, existing `backend/jira_client.py` helpers, Flask session id plus process-local token store for local OAuth testing, Python `unittest`, Node source-guard tests. Later database phases use PostgreSQL with encrypted token storage.

---

## Alignment Notes

These notes supersede older snippets in this plan that assume the pre-split backend layout or store OAuth token material directly in Flask's signed cookie.

- The first OAuth slice must create the centralized auth/client boundary that the database work depends on. Do this before any database-backed identity or user-configuration phase.
- Do not add database migrations, PostgreSQL setup, user tables, workspace tables, or saved-view tables in this OAuth slice.
- Store local OAuth token material server-side behind an opaque Flask session id, for example `session['atlassian_oauth_session_id']` plus a process-local `OAUTH_TOKEN_STORE`. The signed cookie may contain the opaque session id and OAuth `state`, but not access tokens, refresh tokens, or API tokens.
- The later database auth phase should move connection metadata and encrypted token material into PostgreSQL tables equivalent to `users`, `workspaces`, `auth_connections`, `auth_tokens`, and `jira_project_access`.
- Keep Basic API-token mode local by default. Do not store Basic API tokens in the database unless a later requirement explicitly asks for server-side Basic credential persistence.
- The auth/client boundary must expose enough request auth context for later cache partitioning by workspace and user or auth connection. Do not let Jira/Home-derived caches stay process-global once multi-user auth exists.
- Do not introduce `dev_lead` or `epm` user roles. Database-backed access control should distinguish normal users from admins only; ENG/EPM behavior comes from the selected configuration or saved view.
- Preserve initial-load performance. Auth status and later `/api/me`-style bootstrapping must stay compact and must not trigger broad Jira/Home fan-out.

## Security Gates Before Database Work

The following must be implemented or explicitly verified before starting the database introduction plan:

1. **Stable identity:** the OAuth callback must fetch `https://api.atlassian.com/me` with the granted token, store `account_id` as the stable user subject, and treat email/display name as mutable profile metadata only. The first database login path must upsert users by `(external_provider='atlassian', external_subject=account_id)`, update changed email/name fields, and reject `account_status` values other than `active`.
2. **PKCE:** the authorize URL must include an S256 `code_challenge`, and the token exchange must include the matching `code_verifier`. Keep `state` as a separate one-time CSRF value.
3. **Local token store guard:** the process-local `OAUTH_TOKEN_STORE` is a local bridge only. It must have TTL cleanup, logout/revoke deletion, refresh locking, and a runtime guard such as `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true` that blocks OAuth startup outside explicitly approved local/single-process mode.
4. **Session/CORS/CSRF:** set `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE=Lax`, and `SESSION_COOKIE_SECURE` for non-local HTTPS deployments. Replace broad Flask-CORS defaults with an allowlist. Require CSRF protection for state-changing browser routes before adding DB-backed admin/config endpoints.
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
- Jira/Home clients must accept `context` explicitly, for example `jira_get(context, path, ...)` and `home_graphql(context, query, ...)`.
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
- CSRF: all state-changing browser routes require a server-issued CSRF token, preferably sent in an `X-CSRF-Token` header and bound to the session.

## File Structure

**Create:**

- `backend/auth/__init__.py` - package marker for auth helpers.
- `backend/auth/context.py` - `RequestAuthContext` dataclasses and cache-key helpers shared by Jira/Home clients.
- `backend/auth/jira_auth.py` - auth mode parsing, OAuth URL/token helpers, resource matching, token refresh, Jira URL/header construction.
- `backend/routes/auth_routes.py` - auth status, Atlassian login/callback, and logout blueprint.
- `tests/test_auth_context.py` - request auth context, synthetic local context, and cache-key unit tests.
- `tests/test_jira_auth.py` - backend unit tests for auth mode, URLs, resources, refresh behavior, and request headers.
- `tests/test_auth_routes.py` - Flask route tests for auth status, login redirect, callback errors, and logout.
- `tests/test_auth_isolation_source_guard.js` - source guard that auth-mode work stays out of `frontend/src/dashboard.jsx`.

**Modify:**

- `backend/app.py` - register the auth blueprint.
- `jira_server.py` - configure auth env values, Flask secret key, local token store helpers, Basic-only startup validation, request auth context helpers, and migrate `/api/test` plus one small read endpoint to the auth helper.
- `.env.example` - document `JIRA_AUTH_MODE` and Atlassian OAuth variables.
- `README.md` - document local OAuth setup and Basic auth fallback.

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
        self.assertEqual(
            build_jira_api_url(config, '/rest/api/3/project/search', {}),
            'https://example.atlassian.net/rest/api/3/project/search',
        )

    def test_oauth_jira_url_uses_cloudid_gateway(self):
        config = AuthConfig(auth_mode='atlassian_oauth', jira_url='https://example.atlassian.net')
        self.assertEqual(
            build_jira_api_url(config, '/rest/api/3/project/search', {'cloudid': 'cloud-123'}),
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


def build_jira_api_url(config, path, session_data):
    clean_path = '/' + path.lstrip('/')
    if config.auth_mode == AUTH_MODE_BASIC:
        return f'{normalize_site_url(config.jira_url)}{clean_path}'
    cloudid = session_data.get('cloudid')
    if not cloudid:
        raise AuthError('auth_required', 'Missing Atlassian cloudid in session')
    return f'{ATLASSIAN_API_BASE}/ex/jira/{cloudid}{clean_path}'
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
        self.client = jira_server.app.test_client()

    def test_basic_auth_status_reports_configured(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
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

    def test_callback_rejects_invalid_state(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/atlassian/callback?state=bad&code=abc')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_oauth_state')

    def test_logout_clears_auth_session(self):
        with self.client.session_transaction() as session:
            session['atlassian_oauth_session_id'] = 'session-123'
        jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
        response = self.client.post('/api/auth/logout')
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertNotIn('session-123', jira_server.OAUTH_TOKEN_STORE)
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
OAUTH_TOKEN_STORE = {}
OAUTH_TOKEN_STORE_LOCK = threading.RLock()
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
        if not session_id:
            session_id = new_oauth_state()
            session['atlassian_oauth_session_id'] = session_id
        OAUTH_TOKEN_STORE[session_id] = dict(data, stored_at=now)


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
    if JIRA_AUTH_MODE == AUTH_MODE_ATLASSIAN_OAUTH and not OAUTH_LOCAL_TOKEN_STORE_ALLOWED:
        raise AuthError(
            'local_token_store_not_allowed',
            'OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true is required for the temporary local OAuth token store',
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

- [ ] **Step 1: Add request wrapper tests**

Append to `tests/test_jira_auth.py`:

```python
    def test_jira_get_uses_built_url_and_headers(self):
        config = AuthConfig(
            auth_mode='basic',
            jira_url='https://example.atlassian.net',
            jira_email='user@example.com',
            jira_token='token-123',
        )
        http_get = Mock()
        http_get.return_value.status_code = 200
        from backend.auth.jira_auth import jira_get
        response = jira_get(config, {}, '/rest/api/3/project/search', http_get=http_get, timeout=15)
        self.assertEqual(response.status_code, 200)
        called_url = http_get.call_args.args[0]
        self.assertEqual(called_url, 'https://example.atlassian.net/rest/api/3/project/search')
        self.assertIn('Authorization', http_get.call_args.kwargs['headers'])
```

- [ ] **Step 2: Run test to verify failure**

Run: `python3 -m unittest tests.test_jira_auth.TestJiraAuth.test_jira_get_uses_built_url_and_headers -v`

Expected: FAIL because `jira_get` does not exist.

- [ ] **Step 3: Add request wrappers**

Append to `backend/auth/jira_auth.py`:

```python
def ensure_oauth_token(config, session_data, save_session, http_post=requests.post):
    if config.auth_mode != AUTH_MODE_ATLASSIAN_OAUTH:
        return session_data
    if not session_data.get('access_token'):
        raise AuthError('auth_required', 'User must sign in with Atlassian')
    if not is_oauth_token_expired(session_data):
        return session_data
    refreshed = refresh_oauth_token(config, session_data, http_post=http_post)
    save_session(refreshed)
    return refreshed


def jira_get(config, session_data, path, http_get=requests.get, save_session=None, **kwargs):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(config, session_data, save_session)
    return http_get(
        build_jira_api_url(config, path, active_session),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )


def jira_post(config, session_data, path, http_post=requests.post, save_session=None, **kwargs):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(config, session_data, save_session)
    return http_post(
        build_jira_api_url(config, path, active_session),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )
```

In `jira_server.py`, import `jira_get` and `jira_post` from `backend.auth.jira_auth`. Reuse the `save_oauth_session` and `oauth_session_data` helpers from Task 2, then add:

```python
def jira_session_data():
    if JIRA_AUTH_MODE == AUTH_MODE_ATLASSIAN_OAUTH:
        return oauth_session_data()
    return {}
```

Migrate `/api/test` to call a small Jira endpoint through `jira_get`. Keep its response shape compatible with current frontend expectations. Use:

```python
response = jira_get(
    current_auth_config(),
    jira_session_data(),
    '/rest/api/3/myself',
    save_session=save_oauth_session,
    timeout=15,
)
```

If the route currently tests another endpoint, preserve the route's JSON keys and only replace URL/header construction.

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

## Task 4: Dashboard Isolation Guard

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

## Task 5: Configuration Docs and Startup Validation

**Files:**
- Modify: `jira_server.py`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add startup validation tests or manual check**

If no existing startup validation tests are practical, use the route tests from Task 2 as coverage and add a manual startup check in Step 4.

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

# Required for JIRA_AUTH_MODE=atlassian_oauth.
# Create an OAuth 2.0 (3LO) app in the Atlassian Developer Console.
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user offline_access

# Required for stable Flask sessions in OAuth mode. Use a long random value locally.
FLASK_SECRET_KEY=
```

Add a README section:

```markdown
### Atlassian OAuth login

The dashboard can run with Atlassian OAuth 2.0 (3LO) instead of a personal Jira API token.

1. Create an OAuth 2.0 app in the Atlassian Developer Console.
2. Add Jira API permissions for the scopes in `ATLASSIAN_SCOPES`.
3. Set the callback URL to `http://localhost:5050/api/auth/atlassian/callback`, or to an HTTPS tunnel URL if your Atlassian app requires HTTPS.
4. Set `JIRA_AUTH_MODE=atlassian_oauth`, `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_REDIRECT_URI`, and `FLASK_SECRET_KEY`.
5. Start the server and open `/api/auth/atlassian/login` to complete Atlassian login. Confirm `/api/auth/status` reports `authenticated: true`, then use the migrated test endpoints such as `/api/test`. Dashboard login UI is intentionally deferred. If your company Atlassian org uses Microsoft Entra SSO, Atlassian will send managed users through that company login flow.

Jira still receives Atlassian OAuth tokens, not Microsoft Entra tokens. Direct Microsoft access tokens cannot be used as Jira REST API bearer tokens.
```

- [ ] **Step 4: Run verification**

Run:

```bash
python3 -m unittest tests.test_jira_auth tests.test_auth_routes -v
node tests/test_auth_isolation_source_guard.js
JIRA_AUTH_MODE=atlassian_oauth JIRA_URL=https://example.atlassian.net ATLASSIAN_CLIENT_ID=client ATLASSIAN_CLIENT_SECRET=secret ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback FLASK_SECRET_KEY=test python3 jira_server.py --help
```

Expected: Python tests PASS, source guard PASS, and `--help` prints CLI help without starting the server.

- [ ] **Step 5: Commit**

Run:

```bash
git add jira_server.py .env.example README.md
git commit -m "Document Atlassian OAuth configuration"
```

---

## Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend tests**

Run: `python3 -m unittest discover -s tests`

Expected: PASS.

- [ ] **Step 2: Run dashboard isolation guard**

Run: `node tests/test_auth_isolation_source_guard.js`

Expected: PASS.

- [ ] **Step 3: Manual OAuth smoke test**

With a real Atlassian OAuth app configured in `.env`, run:

```bash
python3 jira_server.py
```

Open `http://localhost:5050/api/auth/atlassian/login`, complete Atlassian login, and confirm `/api/auth/status` returns:

```json
{
  "authMode": "atlassian_oauth",
  "authenticated": true,
  "loginRequired": false
}
```

- [ ] **Step 4: Review commits**

Run: `git log --oneline -5`

Expected: the OAuth commits from this plan are visible and only contain the planned files.

- [ ] **Step 5: Stop for user review before push**

Do not push. This repo requires explicit user confirmation before push.

---

## Plan Self-Review

- Spec coverage: the plan covers auth mode config, OAuth login/callback, local server-side token storage, resource selection, Jira URL/header construction, dashboard isolation, docs, and verification.
- DB alignment: this plan creates the auth/client boundary required before PostgreSQL-backed `users`, `workspaces`, `auth_connections`, encrypted `auth_tokens`, and `jira_project_access`; it intentionally does not implement those tables.
- Scope: Confluence support, dashboard login UI, production multi-user persistence, and user-owned saved views are intentionally deferred.
- Risk: dashboard login UX is intentionally deferred so the auth-mode slice does not modify `frontend/src/dashboard.jsx`.
