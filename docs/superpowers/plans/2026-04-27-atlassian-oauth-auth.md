# Atlassian OAuth Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Atlassian OAuth 2.0 3LO login so Jira Execution Planner can call Jira on behalf of the signed-in user without requiring a personal API token.

**Architecture:** Keep `basic` auth as the default and introduce `atlassian_oauth` behind `JIRA_AUTH_MODE`. Add a small backend auth/client boundary, migrate the first Jira endpoints through it, and gate the frontend on `/api/auth/status` before loading Jira data.

**Tech Stack:** Python Flask, `requests`, Flask signed sessions for local OAuth testing, React 19 frontend, Python `unittest`, Node source-guard tests.

---

## File Structure

**Create:**

- `jira_auth.py` - auth mode parsing, OAuth URL/token helpers, resource matching, token refresh, Jira URL/header construction.
- `tests/test_jira_auth.py` - backend unit tests for auth mode, URLs, resources, refresh behavior, and request headers.
- `tests/test_auth_routes.py` - Flask route tests for auth status, login redirect, callback errors, and logout.
- `tests/test_auth_source_guards.js` - frontend source guards for auth status and sign-in behavior.

**Modify:**

- `jira_server.py` - register auth routes, configure Flask secret key, relax Basic-only startup validation, and migrate `/api/test` plus one small read endpoint to `jira_auth`.
- `frontend/src/dashboard.jsx` - add auth status state, sign-in screen, and `401 auth_required` handling.
- `.env.example` - document `JIRA_AUTH_MODE` and Atlassian OAuth variables.
- `README.md` - document local OAuth setup and Basic auth fallback.

---

## Task 1: Auth Helper Foundation

**Files:**
- Create: `jira_auth.py`
- Create: `tests/test_jira_auth.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_jira_auth.py`:

```python
import time
import unittest
from unittest.mock import Mock

from jira_auth import (
    AuthConfig,
    AuthError,
    build_authorize_url,
    build_jira_api_url,
    build_jira_headers,
    choose_accessible_resource,
    is_oauth_token_expired,
    normalize_site_url,
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
            scopes='read:jira-work read:jira-user offline_access',
        )
        url = build_authorize_url(config, 'state-123')
        self.assertIn('https://auth.atlassian.com/authorize?', url)
        self.assertIn('audience=api.atlassian.com', url)
        self.assertIn('client_id=client-123', url)
        self.assertIn('response_type=code', url)
        self.assertIn('prompt=consent', url)
        self.assertIn('state=state-123', url)

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

Expected: FAIL because `jira_auth.py` does not exist.

- [ ] **Step 3: Add the helper module**

Create `jira_auth.py`:

```python
import base64
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
    scopes: str = 'read:jira-work read:jira-user offline_access'


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
        return
    raise AuthError('invalid_auth_mode', f'Unsupported JIRA_AUTH_MODE: {config.auth_mode}')


def new_oauth_state():
    return secrets.token_urlsafe(32)


def build_authorize_url(config, state):
    params = {
        'audience': 'api.atlassian.com',
        'client_id': config.client_id,
        'scope': config.scopes,
        'redirect_uri': config.redirect_uri,
        'state': state,
        'response_type': 'code',
        'prompt': 'consent',
    }
    return f'{ATLASSIAN_AUTHORIZE_URL}?{urlencode(params)}'


def exchange_authorization_code(config, code, http_post=requests.post):
    response = http_post(
        ATLASSIAN_TOKEN_URL,
        json={
            'grant_type': 'authorization_code',
            'client_id': config.client_id,
            'client_secret': config.client_secret,
            'code': code,
            'redirect_uri': config.redirect_uri,
        },
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        timeout=20,
    )
    if response.status_code != 200:
        raise AuthError('oauth_exchange_failed', f'Atlassian token exchange failed with {response.status_code}')
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


def token_session_payload(token_data, resource):
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
git add jira_auth.py tests/test_jira_auth.py
git commit -m "Add Jira auth helper foundation"
```

---

## Task 2: Flask OAuth Routes

**Files:**
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
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 302)
        self.assertIn('https://auth.atlassian.com/authorize?', response.headers['Location'])

    def test_callback_rejects_invalid_state(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/atlassian/callback?state=bad&code=abc')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_oauth_state')

    def test_logout_clears_auth_session(self):
        with self.client.session_transaction() as session:
            session['atlassian_oauth'] = {'access_token': 'access-123'}
        response = self.client.post('/api/auth/logout')
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('atlassian_oauth', session)
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `python3 -m unittest tests.test_auth_routes -v`

Expected: FAIL because the auth routes are not registered.

- [ ] **Step 3: Register OAuth config and routes**

In `jira_server.py`, change the Flask import to include `redirect` and `session`:

```python
from flask import Flask, jsonify, request, send_file, send_from_directory, redirect, session
```

Add this import near the existing local imports:

```python
from jira_auth import (
    AUTH_MODE_ATLASSIAN_OAUTH,
    AUTH_MODE_BASIC,
    AuthConfig,
    AuthError,
    build_authorize_url,
    choose_accessible_resource,
    exchange_authorization_code,
    fetch_accessible_resources,
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
    'read:jira-work read:jira-user offline_access'
).strip()
FLASK_SECRET_KEY = os.getenv('FLASK_SECRET_KEY', '').strip()
app.secret_key = FLASK_SECRET_KEY or os.urandom(32)
```

Add helpers and routes before the existing API routes:

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
    )


def oauth_session_data():
    return session.get('atlassian_oauth') or {}


def auth_error_response(error, status=401):
    return jsonify({'error': error.code, 'message': str(error)}), status


@app.route('/api/auth/status', methods=['GET'])
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


@app.route('/api/auth/atlassian/login', methods=['GET'])
def api_atlassian_login():
    config = current_auth_config()
    try:
        validate_auth_config(config)
    except AuthError as error:
        return auth_error_response(error, 400)
    state = new_oauth_state()
    session['oauth_state'] = state
    return redirect(build_authorize_url(config, state))


@app.route('/api/auth/atlassian/callback', methods=['GET'])
def api_atlassian_callback():
    expected_state = session.get('oauth_state')
    actual_state = request.args.get('state')
    if not expected_state or actual_state != expected_state:
        return jsonify({'error': 'invalid_oauth_state'}), 400
    code = request.args.get('code')
    if not code:
        return jsonify({'error': 'missing_oauth_code'}), 400
    config = current_auth_config()
    try:
        token_data = exchange_authorization_code(config, code)
        resources = fetch_accessible_resources(token_data.get('access_token', ''))
        resource = choose_accessible_resource(resources, config.jira_url)
        session['atlassian_oauth'] = token_session_payload(token_data, resource)
        session.pop('oauth_state', None)
    except AuthError as error:
        return auth_error_response(error, 401 if error.code != 'jira_site_not_accessible' else 403)
    return redirect('/')


@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    session.pop('atlassian_oauth', None)
    session.pop('oauth_state', None)
    return jsonify({'ok': True})
```

- [ ] **Step 4: Run route tests**

Run: `python3 -m unittest tests.test_auth_routes -v`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add jira_server.py tests/test_auth_routes.py
git commit -m "Add Atlassian OAuth login routes"
```

---

## Task 3: Migrate First Jira Calls Through Auth Helper

**Files:**
- Modify: `jira_auth.py`
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
        from jira_auth import jira_get
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

Append to `jira_auth.py`:

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

In `jira_server.py`, import `jira_get` and `jira_post` from `jira_auth`. Add:

```python
def save_oauth_session(data):
    session['atlassian_oauth'] = data


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
git add jira_auth.py jira_server.py tests/test_jira_auth.py
git commit -m "Route initial Jira calls through auth helper"
```

---

## Task 4: Frontend Auth Gate

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Create: `tests/test_auth_source_guards.js`

- [ ] **Step 1: Add source guard tests**

Create `tests/test_auth_source_guards.js`:

```javascript
const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');

assert(
  source.includes('/api/auth/status'),
  'dashboard must check auth status before loading Jira data'
);

assert(
  source.includes('/api/auth/atlassian/login'),
  'dashboard must expose Atlassian login URL'
);

assert(
  source.includes('auth_required'),
  'dashboard must handle backend auth_required responses'
);

assert(
  !source.includes('localStorage.setItem(\\'atlassian'),
  'dashboard must not store Atlassian tokens in localStorage'
);
```

- [ ] **Step 2: Run source guard to verify failure**

Run: `node tests/test_auth_source_guards.js`

Expected: FAIL because the dashboard does not include auth status or login handling yet.

- [ ] **Step 3: Add auth state and gate**

In `frontend/src/dashboard.jsx`, add auth state near other top-level state:

```javascript
const [authStatus, setAuthStatus] = useState({
    loading: true,
    authenticated: false,
    loginRequired: false,
    authMode: 'basic'
});
```

Add a loader function near existing API helpers:

```javascript
async function loadAuthStatus() {
    const response = await fetch('/api/auth/status');
    const data = await response.json();
    setAuthStatus({
        loading: false,
        authenticated: Boolean(data.authenticated),
        loginRequired: Boolean(data.loginRequired),
        authMode: data.authMode || 'basic',
        siteName: data.siteName || '',
        siteUrl: data.siteUrl || ''
    });
    return data;
}
```

Call `loadAuthStatus()` before the first dashboard data fetch. If the returned status has `loginRequired: true`, skip Jira data loading.

Where fetch helpers process API responses, add a shared check:

```javascript
if (response.status === 401) {
    const body = await response.clone().json().catch(() => ({}));
    if (body.error === 'auth_required') {
        setAuthStatus((current) => ({
            ...current,
            authenticated: false,
            loginRequired: true,
            loading: false
        }));
        return null;
    }
}
```

Before rendering the main dashboard, add:

```javascript
if (authStatus.loading) {
    return <div className="loading">Loading...</div>;
}

if (authStatus.loginRequired && !authStatus.authenticated) {
    return (
        <div className="app-shell auth-required">
            <main className="auth-panel">
                <h1>Jira Execution Planner</h1>
                <p>Sign in with Atlassian to load Jira data.</p>
                <a className="primary-button" href="/api/auth/atlassian/login">
                    Sign in with Atlassian
                </a>
            </main>
        </div>
    );
}
```

Use existing button/container classes where possible. If the exact class names differ, reuse the closest existing primary action styling instead of introducing a new visual system.

- [ ] **Step 4: Run frontend guard and build**

Run:

```bash
node tests/test_auth_source_guards.js
npm run build
```

Expected: source guard PASS and build PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add frontend/src/dashboard.jsx tests/test_auth_source_guards.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "Add dashboard Atlassian auth gate"
```

If `frontend/dist/` is intentionally ignored or generated in this branch, do not force-add it.

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
ATLASSIAN_SCOPES=read:jira-work read:jira-user offline_access

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
5. Start the server and open the dashboard. The dashboard redirects users through Atlassian login. If your company Atlassian org uses Microsoft Entra SSO, Atlassian will send managed users through that company login flow.

Jira still receives Atlassian OAuth tokens, not Microsoft Entra tokens. Direct Microsoft access tokens cannot be used as Jira REST API bearer tokens.
```

- [ ] **Step 4: Run verification**

Run:

```bash
python3 -m unittest tests.test_jira_auth tests.test_auth_routes -v
npm run build
JIRA_AUTH_MODE=atlassian_oauth JIRA_URL=https://example.atlassian.net ATLASSIAN_CLIENT_ID=client ATLASSIAN_CLIENT_SECRET=secret ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback FLASK_SECRET_KEY=test python3 jira_server.py --help
```

Expected: tests PASS, build PASS, and `--help` prints CLI help without starting the server.

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

- [ ] **Step 2: Run frontend build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Manual OAuth smoke test**

With a real Atlassian OAuth app configured in `.env`, run:

```bash
python3 jira_server.py
```

Open `http://localhost:5050`, click `Sign in with Atlassian`, complete Atlassian login, and confirm `/api/auth/status` returns:

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

- Spec coverage: the plan covers auth mode config, OAuth login/callback, token storage, resource selection, Jira URL/header construction, frontend gating, docs, and verification.
- Scope: Confluence support is intentionally deferred; the helper architecture keeps room for a later Confluence client.
- Risk: Task 4 requires careful integration with existing dashboard load effects. Keep that edit narrow and verify with `npm run build`.
