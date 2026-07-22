# Application Hosting Readiness Implementation Plan

> **Status:** Done. Executed and merged in [PR #64](https://github.com/Juce-me/jira-execution-planner/pull/64). Kept for audit context only.

> **Current accuracy (2026-07-19):** The Task 7 GitLab CI skeleton (`.gitlab-ci.yml` and `tests/test_gitlab_ci_contract.py`) was removed because the repo's CI is GitHub Actions and GitLab hosting is no longer planned. Do not re-create those files from this plan. The Docker packaging, hosted env contract, and pre-SRE checklist deliverables remain current.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jira Delivery Planner deployable as a prebuilt Docker image under the Internal Applications Hosting workflow: one HTTP container, DB-backed OAuth/config state, no required local mutable files, explicit secret/runtime config, and a production-capable WSGI runtime.

**Architecture:** Keep the app as one Flask web service serving the existing static frontend and API. Add a hosted DB/OAuth profile that uses encrypted DB token/config storage instead of local OAuth token files or JSON config files, make frontend API calls same-origin by default, and add container packaging around the existing app rather than changing the product surface. The platform OAuth2 proxy remains perimeter access only; the app still performs Atlassian OAuth 3LO for Jira REST and user-owned Home/Townsquare token connection for EPM reads.

**Tech Stack:** Python 3.10+ Flask, SQLAlchemy/Alembic/PostgreSQL, React 19/esbuild, Gunicorn, Docker multi-stage build, unittest and Node `node:test`.

---

## Preconditions And Non-Goals

- `docs/plans/GATE-05-home-write-capability.md` remains blocked with `FAIL insufficient_home_write_probe_input`; this plan must not add Home write routes, Home write UI, or generic Home GraphQL proxy behavior.
- Hosted deployment target is Linux container hosting behind NGINX ingress + platform OAuth2 proxy.
- The app-level Atlassian OAuth callback must be registered to the hosted HTTPS callback URL, for example `https://jira-execution-planner.internal.example/api/auth/atlassian/callback`.
- Secret delivery is assumed to exist outside the v1 non-secret YAML contract, for example Kubernetes Secret, ExternalSecret, sealed secret, or an equivalent operator-managed mechanism. Do not encode secrets in the plan YAML, Docker image, docs examples, commit messages, or PR text.
- No new analytics event is required. This work changes deployment and auth/storage mechanics; it does not add a user-visible behavioral event. Docs should mention that existing GA4 env vars remain optional and disabled by default.
- Do not trust OAuth2 Proxy identity headers inside the app until SRE confirms exact header names and ingress/header-spoofing protections. OAuth2 Proxy is perimeter access only for this plan; app-level Atlassian OAuth remains required for Jira REST and Home/Townsquare user-token flows.

## Current Pre-SRE Readiness Split

### Can Do Now

- Clean repository hygiene for GitLab: keep generated `frontend/dist` committed from `npm run build`, keep `.env` and local JSON/cache/token files untracked, and add Docker-specific context exclusions in `.dockerignore`.
- Implement hosted DB/OAuth startup support: token encryption from an explicit env-secret source, no local OAuth token-store requirement in DB mode, network bind parity, secure cookie/origin preflight checks, and same-origin frontend API defaults.
- Package the app as a single Docker image: Node 20 frontend build stage, Python 3.11 slim runtime stage, pinned Gunicorn dependency, non-root runtime user, one HTTP port, stdout/stderr logs, startup preflight, and optional migration hook.
- Add a GitLab CI skeleton that installs dependencies, runs backend/frontend verification, builds the Docker image tagged by commit SHA, and keeps registry push disabled unless confirmed.
- Document a hosted `.env.example` block with local defaults preserved and production values commented out.
- Document the minimal runtime contract: one HTTP port, `/health` liveness, startup preflight as first readiness gate, DB/OAuth required for hosted mode, and rough v1 resources.

### Can-Do-Now Gate Matrix

These gates split work that Codex can complete now from validation that depends on later SRE, registry, database, or OAuth details. Implement the "Immediate Gate" in this plan. Run the "Prerequisite-Ready Gate" as soon as the named prerequisite becomes available.

| Workstream | Can Complete Now | Immediate Gate | Prerequisite-Ready Gate |
| --- | --- | --- | --- |
| Docker runtime | Add `Dockerfile`, `.dockerignore`, pinned `gunicorn`, `scripts/docker-entrypoint.sh`, non-root runtime, `PORT=5050`, stdout/stderr Gunicorn logs, and `/health` liveness. | `tests.test_container_packaging` passes; `docker build -t jira-execution-planner:test .` passes when Docker is available; optional local container smoke returns `200` from `/health`. | GitLab/SRE-approved runner builds the same image tagged by `CI_COMMIT_SHA`; clean container starts with hosted-shaped non-secret env and fails explicitly on missing DB/secrets rather than falling back to local files. |
| Hosted DB/OAuth | Remove local OAuth token-store requirement for DB-backed OAuth, preserve DB token version in the browser session, and make CSRF/auth routes work without `.oauth-token-store.json`. | `tests.test_db_oauth_cutover`, `tests.test_auth_routes`, `tests.test_csrf_token_bound`, `tests.test_user_api_token_connections`, and `tests.test_startup_preflight` pass with DB/OAuth mocks and hosted-shaped env. | With SRE-provided database and registered Atlassian OAuth callback, startup preflight passes, login completes through Atlassian OAuth, and one authenticated read route succeeds without local token-store files. |
| Hosted env docs | Add commented hosted block to `.env.example`, README/INSTALL hosting contract, and OAuth support doc guidance without real hostnames, emails, tokens, or database passwords. | `tests.test_env_config_docs` passes and diff secret scan finds no real tenant URLs, credentials, bearer tokens, OAuth callback query strings, or local absolute paths. | SRE-provided host, secret names, callback URL, registry path, and migration strategy map onto the documented env contract without new app config keys except explicitly agreed follow-up keys. |
| GitLab CI | Add `.gitlab-ci.yml` verify/container stages, backend/frontend checks, committed-dist check, and Docker build tagged by `$CI_COMMIT_SHA`; keep `PUSH_IMAGE=false` by default and no deploy stage. | `tests.test_gitlab_ci_contract` passes; CI file has no real registry, secret, deploy, `kubectl`, or `helm upgrade` content. | In the actual GitLab project, verify jobs pass, the selected runner can build the image, and registry push is enabled only after registry credentials/path are confirmed. |
| Health and startup gates | Keep `/health` as shallow liveness, run `scripts/check_startup_preflight.py` before Gunicorn, and document startup preflight as the v1 readiness gate. | Container entrypoint runs preflight before Gunicorn; bad hosted config exits non-zero with explicit preflight failures; `/health` stays public and cheap. | SRE confirms `/health` + startup preflight are acceptable for Kubernetes liveness/readiness/startup probes, or opens a follow-up for a separate `/ready` endpoint with DB/migration checks. |

### Needs Confirmation

- GitLab group/project location, default branch policy, registry path, image naming convention, and whether runners support Docker-in-Docker, BuildKit, Kaniko, or another container builder.
- Registry credentials and whether GitLab built-in registry variables are sufficient or Google Artifact Registry/GCR credentials are required.
- Final internal hostname, Atlassian OAuth callback URL, TLS termination point, `APP_ALLOWED_ORIGINS`, and whether an additional app-level `APP_BASE_URL` setting is required by SRE conventions. The app currently reads explicit callback/origin values rather than a single base-url key.
- OAuth2 Proxy configuration, session lifetime for daily perimeter reauth, exact user/email/group headers if app-side header trust is ever required, and the ingress policy that strips spoofed inbound headers.
- Secret delivery mechanism and secret object names, not secret values.
- PostgreSQL provisioning, migration owner, and whether `RUN_DB_MIGRATIONS=true` is allowed for one replica or migrations must run as a separate release job/init step.
- Whether `/health` is acceptable as liveness and startup preflight is acceptable as readiness for v1, or whether SRE requires a separate ongoing `/ready` endpoint.
- CPU/memory requests and limits after a clean container smoke test; start with conservative defaults, then measure Jira fan-out and cache behavior before raising concurrency.

### Blocked Until Deployment Reference

- Final Helm chart values, Kubernetes namespace, region/cluster, ingress/routing/VPN/proxy setup, TLS secret names, NetworkPolicy, ServiceAccount, HPA, and resource-limit conventions.
- Registry push and deployment jobs against the real target registry.
- Secret references in Helm/Kubernetes manifests.
- OAuth2 Proxy chart/config values and final allowlist/group policy.
- Multi-replica migration strategy and any platform-required readiness probe semantics.

## File Map

- Modify `backend/auth/key_provider.py`: add explicit env-secret key source for hosted token encryption and fail closed for key-id-only external provider until a real adapter exists.
- Modify `scripts/check_startup_preflight.py`: validate hosted DB/OAuth profile, token encryption wrap/unwrap, secure cookies, explicit origins, disabled local token store, and network bind parity.
- Modify `jira_server.py`: split local OAuth token-store validation from DB/OAuth validation, store DB OAuth browser sessions without local token-store writes, preserve `db_token_version`, add local-file-state policy wrappers, and skip JSON startup reads in hosted mode.
- Modify `backend/routes/auth_routes.py`: make `/api/auth/csrf` DB-session-first so unsafe routes work without local OAuth token store.
- Modify `backend/routes/settings_routes.py`: route team catalog reads/writes through DB-backed dashboard config in DB mode, and keep JSON file behavior only for local JSON mode.
- Modify `backend/scenario_drafts.py`: make legacy `scenario-overrides.json` import opt-in/local-only through the local-file-state policy.
- Add `frontend/src/api/backendUrl.js`: testable backend URL resolver.
- Modify `frontend/src/dashboard.jsx`: use the backend URL resolver and default HTTP(S) pages to same origin.
- Modify `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map`: rebuilt output from `npm run build`.
- Modify `requirements.txt`: add `gunicorn`.
- Add `Dockerfile`: multi-stage image that builds frontend assets and runs the app through Gunicorn.
- Add `.dockerignore`: exclude secrets, local caches, tests, docs-only plan artifacts, git metadata, and local dependency folders from Docker context.
- Add `scripts/docker-entrypoint.sh`: run optional migrations, run startup preflight, then `exec` Gunicorn.
- Add `.gitlab-ci.yml`: minimal GitLab verify/container-build pipeline that tags images by commit SHA and leaves registry push disabled until runner/registry/secret contracts are confirmed.
- Add `tests/test_container_packaging.py`: source guards for Dockerfile, entrypoint, WSGI runtime, and ignored files.
- Add `tests/test_gitlab_ci_contract.py`: source guards for GitLab backend/frontend verify jobs, committed-dist check, Docker build/tag behavior, disabled-by-default image push, and no deploy stage.
- Add `tests/test_hosted_stateless_state_policy.py`: hosted/stateless policy tests for file caches and startup JSON reads.
- Modify tests: `tests/test_db_oauth_cutover.py`, `tests/test_auth_routes.py`, `tests/test_csrf_token_bound.py`, `tests/test_user_api_token_connections.py`, `tests/test_startup_preflight.py`, `tests/test_network_bind_guards.py`, `tests/test_token_encryption.py`, `tests/test_token_key_rotation.py`, `tests/test_frontend_api_source_guards.js`, `tests/test_team_catalog_api.py`, `tests/test_scenario_draft_routes.py`, and any source guard budgets touched by the implementation.
- Modify docs: `.env.example`, `README.md`, `INSTALL.md`, `docs/SUPPORT-atlassian-oauth-setup.md`, and `docs/plans/README.md`.

## Task 1: Hosted Token Encryption Source

**Files:**
- Modify: `backend/auth/key_provider.py`
- Modify: `scripts/check_startup_preflight.py`
- Modify: `tests/test_token_encryption.py`
- Modify: `tests/test_token_key_rotation.py`
- Modify: `tests/test_startup_preflight.py`

- [ ] **Step 1: Write failing key-provider tests**

Add tests proving hosted env-secret mode is explicit and key-id-only mode fails until a real external provider exists.

```python
def test_env_key_source_allows_master_key_outside_local_dev(self):
    env = {
        "APP_ENVIRONMENT_KEY": "production",
        "TOKEN_ENCRYPTION_KEY_SOURCE": "env",
        "TOKEN_ENCRYPTION_MASTER_KEY_B64": base64.b64encode(bytes([3]) * 32).decode("ascii"),
        "TOKEN_ENCRYPTION_KEY_ID": "container-key",
    }

    provider = key_provider_from_env(env)
    wrapped = provider.wrap_key(bytes([4]) * 32, b"aad")

    self.assertEqual(provider.primary_key_id(), "container-key")
    self.assertEqual(provider.unwrap_key(wrapped, b"aad"), bytes([4]) * 32)


def test_key_id_only_external_provider_fails_closed_until_adapter_exists(self):
    env = {
        "APP_ENVIRONMENT_KEY": "production",
        "TOKEN_ENCRYPTION_KEY_ID": "kms-key",
    }

    with self.assertRaises(KeyProviderConfigurationError) as raised:
        key_provider_from_env(env)

    self.assertIn("TOKEN_ENCRYPTION_KEY_SOURCE=env", str(raised.exception))
```

Add a preflight test:

```python
def test_db_oauth_hosted_preflight_accepts_explicit_env_key_source(self):
    code, output = self._run({
        "APP_ENVIRONMENT_KEY": "production",
        "JIRA_URL": "https://example.atlassian.net",
        "JIRA_AUTH_MODE": "atlassian_oauth",
        "ATLASSIAN_CLIENT_ID": "client",
        "ATLASSIAN_CLIENT_SECRET": "secret",
        "ATLASSIAN_REDIRECT_URI": "https://planner.example.test/api/auth/atlassian/callback",
        "FLASK_SECRET_KEY": "flask-secret",
        "CONFIG_STORAGE_BACKEND": "db",
        "DATABASE_URL": "postgresql+psycopg://jep_user@db:5432/jep",
        "TOKEN_ENCRYPTION_KEY_SOURCE": "env",
        "TOKEN_ENCRYPTION_MASTER_KEY_B64": base64.b64encode(bytes([8]) * 32).decode("ascii"),
        "TOKEN_ENCRYPTION_KEY_ID": "container-key",
        "APP_BIND_HOST": "0.0.0.0",
        "ALLOW_NETWORK_BIND": "true",
        "SESSION_COOKIE_SECURE": "true",
        "APP_ALLOWED_ORIGINS": "https://planner.example.test",
        "OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "false",
    })

    self.assertIn("PASS token_encryption: key id container-key", output)
    self.assertIn("PASS oauth_local_token_store: not required for db oauth", output)
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_token_encryption tests.test_token_key_rotation tests.test_startup_preflight
```

Expected: new tests fail because production env master keys are currently rejected, key-id-only mode returns an unusable `ExternalKeyProvider`, and preflight does not probe wrap/unwrap.

- [ ] **Step 3: Implement minimal key-provider change**

Change `key_provider_from_env()` so:

```python
key_source = str(env.get("TOKEN_ENCRYPTION_KEY_SOURCE") or "").strip().lower()
if local_key:
    if environment_key not in LOCAL_KEY_ENVIRONMENTS and key_source != "env":
        raise KeyProviderConfigurationError(
            "TOKEN_ENCRYPTION_MASTER_KEY_B64 outside local/dev requires TOKEN_ENCRYPTION_KEY_SOURCE=env."
        )
    return LocalKeyProvider(
        primary_key_id=key_id or ("local-dev" if environment_key in LOCAL_KEY_ENVIRONMENTS else "env"),
        primary_key=_decode_key(local_key, "TOKEN_ENCRYPTION_MASTER_KEY_B64"),
        retired_keys=_retired_keys_from_env(env),
    )
if key_id:
    raise KeyProviderConfigurationError(
        "External token encryption key provider is not configured; use TOKEN_ENCRYPTION_KEY_SOURCE=env with TOKEN_ENCRYPTION_MASTER_KEY_B64 or add a real external adapter."
    )
```

Do not add KMS abstractions in this slice; the internal hosting requirement is a container secret, not a new key-management integration.

- [ ] **Step 4: Add preflight wrap/unwrap probe**

In `_check_token_encryption()`, after building the provider:

```python
probe_dek = bytes(range(32))
wrapped = provider.wrap_key(probe_dek, b"startup-preflight")
if provider.unwrap_key(wrapped, b"startup-preflight") != probe_dek:
    raise PreflightError("Token encryption key probe failed.")
```

Keep output as `key id container-key` for the hosted-profile test above and `key id` plus the configured key id in normal operator runs.

- [ ] **Step 5: Run focused verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_token_encryption tests.test_token_key_rotation tests.test_startup_preflight
```

Expected: PASS.

## Task 2: DB/OAuth Without Local Token Store

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `tests/test_db_oauth_cutover.py`
- Modify: `tests/test_auth_routes.py`
- Modify: `tests/test_csrf_token_bound.py`
- Modify: `tests/test_user_api_token_connections.py`

- [ ] **Step 1: Write failing DB-only OAuth tests**

Add tests covering:

```python
def test_db_oauth_callback_stores_db_session_without_local_token_store(self):
    result = self._store_callback_through_route()

    with self.client.session_transaction() as session:
        self.assertIn("db_oauth_session", session)
        self.assertEqual(session["db_oauth_session"]["db_auth_connection_id"], result.connection_id)
        self.assertIn("db_token_version", session["db_oauth_session"])
        self.assertNotIn("atlassian_oauth_session_id", session)

    self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})
```

```python
def test_db_oauth_startup_does_not_require_local_token_store(self):
    with patch.dict(os.environ, {"CONFIG_STORAGE_BACKEND": "db"}), \
         patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
         patch.object(jira_server, "OAUTH_LOCAL_TOKEN_STORE_ALLOWED", False):
        jira_server.validate_startup_auth_config()
```

```python
def test_db_oauth_csrf_succeeds_without_local_oauth_session(self):
    result = self._store_callback()
    with self.client.session_transaction() as session:
        session["db_oauth_session"] = {
            "db_auth_connection_id": result.connection_id,
            "db_token_version": result.token_version,
        }

    response = self.client.get("/api/auth/csrf")

    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    self.assertIn("csrfToken", response.get_json())
```

Also add a stale-token-version test that expects the existing `auth_connection_stale` recovery path when `db_token_version` is older than the DB connection token version.

- [ ] **Step 2: Run focused auth tests to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_oauth_cutover tests.test_auth_routes tests.test_csrf_token_bound tests.test_user_api_token_connections
```

Expected: new tests fail on local token-store validation, local token-store writes, missing `db_token_version`, and DB-only CSRF.

- [ ] **Step 3: Split local OAuth validation from DB/OAuth validation**

In `validate_local_token_store_allowed()` return early for DB-backed OAuth:

```python
if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
    return
if database_storage_enabled():
    return
```

Keep the existing local/dev + `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true` guard for non-DB OAuth.

- [ ] **Step 4: Preserve DB token version in browser session**

Update `_db_oauth_browser_session_payload()`:

```python
payload = {"db_auth_connection_id": connection_id}
token_version = str((data or {}).get("db_token_version") or "").strip()
if token_version:
    payload["db_token_version"] = token_version
return payload
```

Ensure `store_db_oauth_callback_session_metadata()` session metadata includes the token version already produced by DB token storage. If the stored metadata key differs, map it here rather than adding a second DB query.

- [ ] **Step 5: Stop DB/OAuth local token-store writes**

Update `save_oauth_session(data)`:

```python
payload = _db_oauth_browser_session_payload(data)
if payload:
    session["db_oauth_session"] = payload
    session_id = session.pop("atlassian_oauth_session_id", None)
    if session_id:
        _drop_oauth_session(session_id)
    return
```

Then keep the existing local token-store behavior for non-DB session payloads.

Remove DB-mode fallback from `db_oauth_browser_session_data()` so a hosted request does not recover DB metadata from local memory:

```python
stored = session.get("db_oauth_session")
if isinstance(stored, dict):
    return _db_oauth_browser_session_payload(stored)
return {}
```

- [ ] **Step 6: Make CSRF DB-first**

In `/api/auth/csrf`, before reading `oauth_session_data()`, add:

```python
if database_storage_enabled() and db_oauth_browser_session_data():
    try:
        current_request_auth_context()
        token = issue_csrf_token(session, csrf_session_data_for_request())
        bind_csrf_token(session, token, csrf_session_data_for_request())
    except AuthError as error:
        return auth_error_response(error, 401)
    except DatabaseConfigurationError:
        return jsonify({
            "error": "config_storage_unavailable",
            "message": "Database-backed authentication is unavailable.",
        }), 503
    return jsonify({"csrfToken": token})
```

Keep the existing local OAuth branch after this DB branch.

- [ ] **Step 7: Run focused auth verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_oauth_cutover tests.test_auth_routes tests.test_csrf_token_bound tests.test_user_api_token_connections tests.test_db_auth_recovery_pages
```

Expected: PASS.

## Task 3: Hosted Network-Bind And Preflight Parity

**Files:**
- Modify: `jira_server.py`
- Modify: `scripts/check_startup_preflight.py`
- Modify: `tests/test_network_bind_guards.py`
- Modify: `tests/test_startup_preflight.py`

- [ ] **Step 1: Write failing parity tests**

Add an allowed hosted OAuth bind case:

```python
def test_oauth_db_mode_allows_secure_network_bind_without_local_token_store(self):
    env = {
        "ALLOW_NETWORK_BIND": "true",
        "APP_ENVIRONMENT_KEY": "production",
        "APP_ALLOWED_ORIGINS": "https://planner.example.test",
        "FLASK_SECRET_KEY": "secret",
        "OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "false",
        "SESSION_COOKIE_SECURE": "true",
        "CONFIG_STORAGE_BACKEND": "db",
    }
    with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
         patch.dict("os.environ", env, clear=False):
        self.assertEqual(jira_server.validate_network_bind("0.0.0.0"), "0.0.0.0")
```

Add preflight rejection tests for missing origins, wildcard origins, missing `FLASK_SECRET_KEY`, and enabled local token store on network bind.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_network_bind_guards tests.test_startup_preflight
```

Expected: missing preflight parity tests fail.

- [ ] **Step 3: Align startup preflight checks**

Update `_check_oauth_local_token_store()`:

```python
if config.auth_mode != AUTH_MODE_ATLASSIAN_OAUTH:
    return "not required for basic auth"
if db_engine.database_storage_enabled(env):
    if _env_flag(env, "OAUTH_LOCAL_TOKEN_STORE_ALLOWED"):
        raise PreflightError("DB/OAuth hosted mode must not enable OAUTH_LOCAL_TOKEN_STORE_ALLOWED.")
    return "not required for db oauth"
```

Update `_check_network_bind()` to match runtime:

```python
if auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
    if not _env_flag(env, "SESSION_COOKIE_SECURE"):
        raise PreflightError("OAuth network bind requires SESSION_COOKIE_SECURE=true.")
    origins = [origin.strip() for origin in str(env.get("APP_ALLOWED_ORIGINS") or "").split(",") if origin.strip()]
    if not origins or "*" in origins:
        raise PreflightError("OAuth network bind requires explicit APP_ALLOWED_ORIGINS without *.")
    if not str(env.get("FLASK_SECRET_KEY") or "").strip():
        raise PreflightError("OAuth network bind requires FLASK_SECRET_KEY.")
    if _env_flag(env, "OAUTH_LOCAL_TOKEN_STORE_ALLOWED"):
        raise PreflightError("Local OAuth token storage cannot be used with network bind.")
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_network_bind_guards tests.test_startup_preflight tests.test_app_startup
```

Expected: PASS.

## Task 4: Same-Origin Frontend Backend URL

**Files:**
- Create: `frontend/src/api/backendUrl.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_frontend_api_source_guards.js`
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`

- [ ] **Step 1: Write resolver tests**

In `tests/test_frontend_api_source_guards.js`, add a loader for `frontend/src/api/backendUrl.js` and tests:

```javascript
test('backend URL resolver uses same origin for hosted HTTP pages', () => {
    const { resolveBackendUrl } = loadApiModule('backendUrl.js', ['resolveBackendUrl']);

    assert.equal(resolveBackendUrl({
        BACKEND_URL: '',
        location: { protocol: 'https:', origin: 'https://planner.example.test' },
    }), 'https://planner.example.test');

    assert.equal(resolveBackendUrl({
        BACKEND_URL: '',
        location: { protocol: 'http:', origin: 'http://localhost:5051' },
    }), 'http://localhost:5051');
});

test('backend URL resolver preserves explicit override and file fallback', () => {
    const { resolveBackendUrl } = loadApiModule('backendUrl.js', ['resolveBackendUrl']);

    assert.equal(resolveBackendUrl({
        BACKEND_URL: 'https://api.example.test',
        location: { protocol: 'https:', origin: 'https://planner.example.test' },
    }), 'https://api.example.test');

    assert.equal(resolveBackendUrl({
        BACKEND_URL: '',
        location: { protocol: 'file:', origin: 'null' },
    }), 'http://localhost:5050');
});

test('dashboard no longer hardcodes 5050 for HTTP-served pages', () => {
    const dashboardSource = readSource(path.join(frontendSrcPath, 'dashboard.jsx'));
    assert.ok(!dashboardSource.includes('`${window.location.protocol}//${window.location.hostname}:${DEFAULT_BACKEND_PORT}`'));
});
```

- [ ] **Step 2: Run frontend tests to verify failure**

Run:

```bash
npm run test:frontend:unit
```

Expected: FAIL because `backendUrl.js` does not exist.

- [ ] **Step 3: Add resolver and use it**

Create `frontend/src/api/backendUrl.js`:

```javascript
const DEFAULT_BACKEND_PORT = 5050;

export function resolveBackendUrl(windowLike = window) {
    if (windowLike.BACKEND_URL) return windowLike.BACKEND_URL;
    const location = windowLike.location || {};
    const protocol = String(location.protocol || '');
    if (protocol === 'http:' || protocol === 'https:') {
        return location.origin;
    }
    return `http://localhost:${DEFAULT_BACKEND_PORT}`;
}
```

In `frontend/src/dashboard.jsx`, import and use it:

```javascript
import { resolveBackendUrl } from './api/backendUrl.js';

const BACKEND_URL = resolveBackendUrl(window);
```

- [ ] **Step 4: Rebuild and verify**

Run:

```bash
npm run test:frontend:unit
npm run build
git diff -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map
```

Expected: frontend unit tests pass, dist changes only reflect the resolver import/use.

## Task 5: Hosted Stateless File-State Policy

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/scenario_drafts.py`
- Add: `tests/test_hosted_stateless_state_policy.py`
- Modify: `tests/test_team_catalog_api.py`
- Modify: `tests/test_scenario_draft_routes.py`
- Modify: `tests/test_oauth_stats_routes.py`

- [ ] **Step 1: Write failing stateless policy tests**

Create `tests/test_hosted_stateless_state_policy.py` with tests proving:

```python
def test_local_file_state_defaults_false_outside_local_dev(self):
    with patch.dict(os.environ, {"APP_ENVIRONMENT_KEY": "production"}, clear=False):
        self.assertFalse(jira_server.local_file_state_enabled())


def test_clear_auth_sensitive_caches_skips_file_invalidators_when_disabled(self):
    with patch.object(jira_server, "local_file_state_enabled", return_value=False), \
         patch.object(jira_server, "invalidate_sprints_cache") as invalidate_sprints, \
         patch.object(jira_server, "invalidate_stats_cache") as invalidate_stats:
        jira_server.clear_auth_sensitive_caches("test")

    invalidate_sprints.assert_not_called()
    invalidate_stats.assert_not_called()
```

Extend `tests/test_team_catalog_api.py`:

```python
def test_db_stateless_team_catalog_get_does_not_touch_json_file(self):
    with patch.object(jira_server, "config_storage_db_enabled", return_value=True), \
         patch.object(jira_server, "local_file_state_enabled", return_value=False), \
         patch.object(jira_server, "migrate_team_catalog_from_config", side_effect=AssertionError("json migration forbidden")), \
         patch.object(jira_server, "load_team_catalog", side_effect=AssertionError("json load forbidden")):
        response = self.client.get("/api/team-catalog")

    self.assertEqual(response.status_code, 200)
```

Add a scenario draft test where hosted/stateless mode does not invoke `load_scenario_overrides` when no DB draft exists.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_hosted_stateless_state_policy tests.test_team_catalog_api tests.test_scenario_draft_routes tests.test_oauth_stats_routes
```

Expected: FAIL on missing policy helper and unconditional local file calls.

- [ ] **Step 3: Add local-file-state policy**

In `jira_server.py` add:

```python
def local_file_state_enabled(environ=None):
    env = os.environ if environ is None else environ
    raw = str(env.get("LOCAL_FILE_STATE_ENABLED") or "").strip().lower()
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    environment = str(env.get("APP_ENVIRONMENT_KEY") or APP_ENVIRONMENT_KEY or "local").strip().lower()
    return environment in {"local", "dev"}
```

Use it to guard sprint/stats file cache load/save/invalidation wrappers and `clear_auth_sensitive_caches()`.

- [ ] **Step 4: Store team catalog in DB-backed dashboard config**

In DB mode, `GET /api/team-catalog` should read from `load_dashboard_config()`:

```python
config = load_dashboard_config() or {}
team_catalog = config.get("teamCatalog") or {}
return jsonify({
    "catalog": normalize_team_catalog(team_catalog.get("catalog") or {}),
    "meta": normalize_team_catalog_meta(team_catalog.get("meta") or {}),
})
```

In DB mode, `POST /api/team-catalog` should update the dashboard config:

```python
config = load_dashboard_config() or {"version": 1, "projects": {"selected": []}, "teamGroups": {}}
config["teamCatalog"] = saved
save_dashboard_config(config)
return jsonify(saved)
```

Keep current `team-catalog.json` behavior for JSON mode only.

- [ ] **Step 5: Gate scenario legacy import and startup JSON logging**

Add a helper such as:

```python
def scenario_legacy_import_enabled(environ=None):
    env = os.environ if environ is None else environ
    raw = str(env.get("SCENARIO_DRAFT_LEGACY_IMPORT_ENABLED") or "").strip().lower()
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    return local_file_state_enabled(env)
```

Pass this into scenario draft legacy import decisions. Skip `get_effective_board_id(source="jsonfile")` during startup logging when `config_storage_db_enabled()` and `not local_file_state_enabled()`.

- [ ] **Step 6: Run focused verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_hosted_stateless_state_policy tests.test_config_storage_selector tests.test_oauth_stats_routes tests.test_team_catalog_api tests.test_scenario_draft_routes
```

Expected: PASS.

## Task 6: Container Runtime Packaging

**Files:**
- Add: `Dockerfile`
- Add: `.dockerignore`
- Add: `scripts/docker-entrypoint.sh`
- Modify: `requirements.txt`
- Add: `tests/test_container_packaging.py`
- Modify: `.github/workflows/release-latest.yml` or add `.github/workflows/verify-container.yml`

- [ ] **Step 1: Write packaging source guards**

Create `tests/test_container_packaging.py`:

```python
class ContainerPackagingTests(unittest.TestCase):
    def test_requirements_include_gunicorn(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf8")
        self.assertIn("gunicorn==", requirements)

    def test_dockerfile_uses_gunicorn_not_flask_dev_server(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf8")
        self.assertIn("scripts/docker-entrypoint.sh", dockerfile)
        self.assertIn("frontend/dist", dockerfile)
        self.assertNotIn("python jira_server.py", dockerfile)
        self.assertNotIn("flask run", dockerfile)

    def test_dockerignore_excludes_local_secret_and_cache_files(self):
        ignored = (ROOT / ".dockerignore").read_text(encoding="utf8")
        for pattern in (".env", ".oauth-token-store.json", "dashboard-config.json", "team-catalog.json", "sprints_cache.json", "stats_cache.json", ".git", "node_modules"):
            self.assertIn(pattern, ignored)

    def test_entrypoint_runs_optional_migrations_before_preflight(self):
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf8")
        self.assertLess(entrypoint.index("alembic"), entrypoint.index("check_startup_preflight.py"))
        self.assertIn("exec gunicorn", entrypoint)
```

- [ ] **Step 2: Run packaging test to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_container_packaging
```

Expected: FAIL because files and dependency do not exist.

- [ ] **Step 3: Add Gunicorn dependency**

Append a pinned dependency to `requirements.txt`:

```text
gunicorn==23.0.0
```

- [ ] **Step 4: Add Dockerfile and dockerignore**

Use a multi-stage Dockerfile:

```dockerfile
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/src ./frontend/src
RUN npm run build

FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PORT=5050 \
    APP_BIND_HOST=0.0.0.0 \
    ALLOW_NETWORK_BIND=true \
    WEB_CONCURRENCY=1 \
    GUNICORN_THREADS=8 \
    GUNICORN_TIMEOUT=120
WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin appuser
COPY requirements.txt pyproject.toml ./
RUN python -m pip install --no-cache-dir -r requirements.txt && python -m pip install --no-cache-dir -e .
COPY backend ./backend
COPY planning ./planning
COPY jira_server.py jira-dashboard.html favicon.ico epm-burst.svg ./
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY scripts/check_startup_preflight.py scripts/docker-entrypoint.sh ./scripts/
RUN chmod +x /app/scripts/docker-entrypoint.sh && chown -R appuser:appuser /app
USER appuser
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python -c "import json,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT','5050') + '/health', timeout=3).read()"
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
```

The `.dockerignore` must exclude secrets and local state:

```text
.git
.venv
node_modules
.env
.env.*
.oauth-token-store.json
dashboard-config.json
team-groups.json
team-catalog.json
scenario-overrides.json
sprints_cache.json
stats_cache.json
tests
docs/plans
```

- [ ] **Step 5: Add entrypoint**

Create `scripts/docker-entrypoint.sh`:

```sh
#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  python -m alembic -c backend/db/alembic.ini upgrade head
fi

python scripts/check_startup_preflight.py

exec gunicorn \
  --bind "0.0.0.0:${PORT:-5050}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-8}" \
  --timeout "${GUNICORN_TIMEOUT:-120}" \
  --access-logfile - \
  --error-logfile - \
  jira_server:app
```

- [ ] **Step 6: Add GitHub CI container build check**

Add a workflow or extend an existing verify workflow with:

```yaml
- name: Build container image
  run: docker build -t jira-execution-planner:test .
```

Do not push images from this workflow unless the release process explicitly requires it.

- [ ] **Step 7: Run focused verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_container_packaging tests.test_project_packaging tests.test_startup_preflight
```

If Docker is available locally:

```bash
docker build -t jira-execution-planner:test .
```

Expected: unit/source guards pass; Docker image builds.

## Task 7: GitLab CI Skeleton And Pre-SRE Checklist

**Files:**
- Add: `.gitlab-ci.yml`
- Add: `tests/test_gitlab_ci_contract.py`
- Modify: `README.md`
- Modify: `INSTALL.md`

- [ ] **Step 1: Add GitLab CI source guards**

Create `tests/test_gitlab_ci_contract.py` with assertions that:

```python
class GitLabCiContractTests(unittest.TestCase):
    def test_gitlab_ci_has_verify_and_container_stages(self):
        ci = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf8")
        self.assertIn("stages:", ci)
        self.assertIn("- verify", ci)
        self.assertIn("- container", ci)
        self.assertNotIn("- deploy", ci)

    def test_gitlab_ci_runs_existing_project_verification(self):
        ci = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf8")
        for command in (
            "python -m pip install -r requirements.txt",
            "python -m pip install -e .",
            "python -m unittest discover -s tests",
            "npm ci",
            "npm run build",
            "npm run test:frontend:unit",
            "git diff --exit-code frontend/dist",
        ):
            self.assertIn(command, ci)

    def test_gitlab_ci_builds_sha_tagged_image_without_default_push(self):
        ci = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf8")
        self.assertIn("docker build --pull -t \"$IMAGE_NAME:$CI_COMMIT_SHA\" .", ci)
        self.assertIn("PUSH_IMAGE: \"false\"", ci)
        self.assertIn("if [ \"$PUSH_IMAGE\" = \"true\" ]", ci)
        self.assertNotIn("kubectl", ci)
        self.assertNotIn("helm upgrade", ci)
```

Also assert that no real internal hostnames, registry names, OAuth client secrets, database URLs, bearer tokens, or local absolute paths are present in `.gitlab-ci.yml`.

- [ ] **Step 2: Run GitLab CI contract test to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_gitlab_ci_contract
```

Expected: FAIL because `.gitlab-ci.yml` does not exist.

- [ ] **Step 3: Add minimal GitLab CI skeleton**

Add `.gitlab-ci.yml`:

```yaml
stages:
  - verify
  - container

variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"
  JIRA_AUTH_MODE: "basic"
  CONFIG_STORAGE_BACKEND: "jsonfile"
  APP_ENVIRONMENT_KEY: "local"
  JIRA_URL: "https://example.atlassian.net"
  JIRA_EMAIL: "ci@example.invalid"
  JIRA_TOKEN: "ci-placeholder"
  PUSH_IMAGE: "false"

cache:
  key:
    files:
      - package-lock.json
      - requirements.txt
  paths:
    - .npm/
    - .cache/pip/

backend_verify:
  image: python:3.11-slim
  stage: verify
  before_script:
    - python -m pip install --upgrade pip
    - python -m pip install -r requirements.txt
    - python -m pip install -e .
  script:
    - python -m unittest discover -s tests
    - python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation

frontend_verify:
  image: node:20-bookworm-slim
  stage: verify
  before_script:
    - apt-get update
    - apt-get install -y --no-install-recommends git ca-certificates
    - npm ci --cache .npm --prefer-offline
  script:
    - npm run build
    - npm run test:frontend:unit
    - git diff --exit-code frontend/dist

container_build:
  image: docker:27
  stage: container
  services:
    - docker:27-dind
  needs:
    - backend_verify
    - frontend_verify
  variables:
    DOCKER_HOST: tcp://docker:2375
    DOCKER_TLS_CERTDIR: ""
  script:
    - IMAGE_NAME="${IMAGE_NAME:-${CI_REGISTRY_IMAGE:-jira-execution-planner}}"
    - docker build --pull -t "$IMAGE_NAME:$CI_COMMIT_SHA" .
    - |
      if [ "$PUSH_IMAGE" = "true" ]; then
        test -n "${CI_REGISTRY:-}" || (echo "CI_REGISTRY is required when PUSH_IMAGE=true" && exit 1)
        docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
        docker push "$IMAGE_NAME:$CI_COMMIT_SHA"
      fi
```

This skeleton deliberately avoids deploy jobs and keeps image push disabled by default. If GitLab runners cannot use Docker-in-Docker, keep the job shape but replace the builder with the SRE-approved BuildKit or Kaniko convention.

- [ ] **Step 4: Add pre-SRE checklist docs**

Add a concise section to `README.md` or `INSTALL.md` named "Internal Hosting Pre-SRE Checklist" with:

```text
Can prepare now:
- Dockerfile, .dockerignore, Gunicorn runtime, startup preflight, and /health liveness.
- GitLab verify/container-build pipeline with image tags based on CI_COMMIT_SHA.
- Hosted env contract with explicit secret placeholders and local defaults preserved.
- DB/OAuth-only hosted profile with local token/file state disabled.

Needs confirmation:
- GitLab group/repo path, registry/image path, runner container-build method, and default branch/tag policy.
- Internal hostname, Atlassian OAuth callback URL, APP_ALLOWED_ORIGINS, and OAuth2 Proxy session policy.
- Secret delivery mechanism, PostgreSQL provisioning, migration owner, and initial CPU/memory limits.

Blocked until deployment reference:
- Helm values, Kubernetes namespace/region/routing/VPN/proxy setup, TLS secret names, OAuth2 Proxy config, and real registry push/deploy jobs.
```

- [ ] **Step 5: Run GitLab CI contract verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_gitlab_ci_contract
```

Expected: PASS.

## Task 8: Docs And Hosting Contract

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `docs/SUPPORT-atlassian-oauth-setup.md`
- Modify: `docs/plans/README.md`
- Modify: `tests/test_env_config_docs.py`

- [ ] **Step 1: Add docs tests**

Extend `tests/test_env_config_docs.py` with assertions that docs mention:

```python
for source in (env_example, readme, install):
    self.assertIn("PORT=5050", source)
    self.assertIn("TOKEN_ENCRYPTION_KEY_SOURCE=env", source)
    self.assertIn("LOCAL_FILE_STATE_ENABLED=false", source)
    self.assertIn("SESSION_COOKIE_SECURE=true", source)
    self.assertIn("APP_ALLOWED_ORIGINS", source)
    self.assertIn("ATLASSIAN_REDIRECT_URI", source)
    self.assertIn("RUN_DB_MIGRATIONS", source)
```

Add a negative assertion that the container section does not tell users to set legacy `JIRA_EMAIL`, `JIRA_TOKEN`, `ATLASSIAN_EMAIL`, or `ATLASSIAN_API_TOKEN` for DB/OAuth EPM.

- [ ] **Step 2: Run docs tests to verify failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_env_config_docs
```

Expected: FAIL until docs are updated.

- [ ] **Step 3: Update env docs**

In `.env.example`, add a hosted block:

```env
# Container/internal hosting profile
# APP_ENVIRONMENT_KEY=production
# PORT=5050
# APP_BIND_HOST=0.0.0.0
# ALLOW_NETWORK_BIND=true
# JIRA_AUTH_MODE=atlassian_oauth
# CONFIG_STORAGE_BACKEND=db
# ATLASSIAN_REDIRECT_URI=https://jira-execution-planner.internal.example/api/auth/atlassian/callback
# SESSION_COOKIE_SECURE=true
# APP_ALLOWED_ORIGINS=https://jira-execution-planner.internal.example
# OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false
# LOCAL_FILE_STATE_ENABLED=false
# TOKEN_ENCRYPTION_KEY_SOURCE=env
# TOKEN_ENCRYPTION_KEY_ID=container-key
# RUN_DB_MIGRATIONS=false
# UPDATE_CHECK=false
# GA4_ENABLED=false
# SETTINGS_ADMIN_ONLY=true
# TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS=
# DATABASE_URL=
# ATLASSIAN_CLIENT_ID=
# ATLASSIAN_CLIENT_SECRET=
# FLASK_SECRET_KEY=
# TOKEN_ENCRYPTION_MASTER_KEY_B64=
```

Keep local defaults local-friendly; do not make production-only values active defaults in `.env.example`. Do not add an `APP_BASE_URL` example unless the implementation starts reading that key; for this slice, `ATLASSIAN_REDIRECT_URI` and `APP_ALLOWED_ORIGINS` are the effective hosted URL contract.

- [ ] **Step 4: Update README and INSTALL**

Add a concise “Container/Internal Hosting” section with:

```yaml
appName: jira-execution-planner
image: registry.internal.example/jira-execution-planner:2026-06-04-hosting-readiness
containerPort: 5050
healthPath: /health
resources:
  requests: { cpu: 500m, memory: 1Gi }
  limits: { cpu: "1", memory: 2Gi }
env:
  APP_ENVIRONMENT_KEY: production
  PORT: "5050"
  APP_BIND_HOST: "0.0.0.0"
  ALLOW_NETWORK_BIND: "true"
  JIRA_AUTH_MODE: atlassian_oauth
  CONFIG_STORAGE_BACKEND: db
  ATLASSIAN_REDIRECT_URI: "https://jira-execution-planner.internal.example/api/auth/atlassian/callback"
  LOCAL_FILE_STATE_ENABLED: "false"
  OAUTH_LOCAL_TOKEN_STORE_ALLOWED: "false"
  SESSION_COOKIE_SECURE: "true"
  APP_ALLOWED_ORIGINS: "https://jira-execution-planner.internal.example"
  TOKEN_ENCRYPTION_KEY_SOURCE: env
  TOKEN_ENCRYPTION_KEY_ID: container-key
  RUN_DB_MIGRATIONS: "false"
  UPDATE_CHECK: "false"
secrets:
  - ATLASSIAN_CLIENT_ID
  - ATLASSIAN_CLIENT_SECRET
  - FLASK_SECRET_KEY
  - DATABASE_URL
  - TOKEN_ENCRYPTION_MASTER_KEY_B64
```

Document that `PORT` is the container runtime port and `SERVER_PORT` remains local/dev compatibility only if the code still reads it. Document that PostgreSQL migrations must run either through `RUN_DB_MIGRATIONS=true` for single-instance internal deployments or through a separate release job for multi-replica deployments.

- [ ] **Step 5: Update Atlassian OAuth support doc**

Add hosted callback guidance:

```text
For internal container hosting, register the HTTPS ingress callback URL, not localhost:
https://jira-execution-planner.internal.example/api/auth/atlassian/callback
```

State that ingress OAuth2 proxy access does not replace app-level Atlassian OAuth, because Jira REST and Home/Townsquare user token flows still require Atlassian app credentials.

- [ ] **Step 6: Run docs verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_env_config_docs
```

Expected: PASS.

## Task 9: Final Integration Verification

**Files:**
- All files changed by Tasks 1-8.

- [ ] **Step 1: Run focused backend auth/storage/container tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_db_oauth_cutover \
  tests.test_auth_routes \
  tests.test_csrf_token_bound \
  tests.test_user_api_token_connections \
  tests.test_startup_preflight \
  tests.test_network_bind_guards \
  tests.test_token_encryption \
  tests.test_token_key_rotation \
  tests.test_hosted_stateless_state_policy \
  tests.test_team_catalog_api \
  tests.test_scenario_draft_routes \
  tests.test_container_packaging \
  tests.test_gitlab_ci_contract \
  tests.test_env_config_docs
```

Expected: PASS.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
npm run test:frontend:unit
npm run build
```

Expected: PASS and `frontend/dist` updated only from source changes.

- [ ] **Step 3: Run full suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: PASS.

- [ ] **Step 4: Verify container build**

Run when Docker is available:

```bash
docker build -t jira-execution-planner:test .
```

Expected: image builds successfully. If Docker is unavailable in the execution environment, record that limitation in the PR notes and rely on the CI container build workflow.

- [ ] **Step 5: Verify preflight with hosted-shaped env**

Run with the concrete non-production example values below and a reachable test database when available:

```bash
APP_ENVIRONMENT_KEY=production \
JIRA_AUTH_MODE=atlassian_oauth \
JIRA_URL=https://example.atlassian.net \
ATLASSIAN_CLIENT_ID=client \
ATLASSIAN_CLIENT_SECRET=secret \
ATLASSIAN_REDIRECT_URI=https://planner.example.test/api/auth/atlassian/callback \
FLASK_SECRET_KEY=flask-secret \
CONFIG_STORAGE_BACKEND=db \
DATABASE_URL=postgresql+psycopg://jep_user@localhost:5432/jep_local \
TOKEN_ENCRYPTION_KEY_SOURCE=env \
TOKEN_ENCRYPTION_MASTER_KEY_B64=CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg= \
TOKEN_ENCRYPTION_KEY_ID=container-key \
APP_BIND_HOST=0.0.0.0 \
ALLOW_NETWORK_BIND=true \
SESSION_COOKIE_SECURE=true \
APP_ALLOWED_ORIGINS=https://planner.example.test \
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false \
LOCAL_FILE_STATE_ENABLED=false \
.venv/bin/python scripts/check_startup_preflight.py
```

Expected with DB and migrations available: all PASS. Expected without DB: explicit DB availability/migration failure only; no local-token-store, CORS/origin, or token-encryption failure.

- [ ] **Step 6: Review diff for secret safety**

Run:

```bash
git diff -- . ':!frontend/dist/dashboard.js.map'
```

Expected: no real tenant URLs, personal emails, OAuth callback query strings, API tokens, bearer tokens, refresh tokens, database passwords, or local absolute paths in docs, tests, Dockerfile, or workflow files.

- [ ] **Step 7: Record can-do-now gate results**

Before marking this plan executable work complete, record the immediate gate result for each can-do-now workstream in the PR notes or execution summary:

```text
Docker runtime gate:
- tests.test_container_packaging: PASS/FAIL
- docker build: PASS/FAIL/SKIPPED with reason
- local /health smoke from container: PASS/FAIL/SKIPPED with reason

Hosted DB/OAuth gate:
- DB/OAuth focused tests: PASS/FAIL
- hosted-shaped preflight: PASS/FAIL/SKIPPED with reason
- no local token-store fallback observed: PASS/FAIL

Hosted env docs gate:
- tests.test_env_config_docs: PASS/FAIL
- secret-risk diff scan: PASS/FAIL

GitLab CI gate:
- tests.test_gitlab_ci_contract: PASS/FAIL
- push disabled by default: PASS/FAIL
- no deploy stage: PASS/FAIL

Health/startup gate:
- entrypoint preflight before Gunicorn: PASS/FAIL
- /health liveness stays cheap/public: PASS/FAIL
- bad hosted config exits explicitly before serving: PASS/FAIL
```

- [ ] **Step 8: Record prerequisite-ready gates that remain external**

If SRE, registry, database, or OAuth prerequisites are not yet available, explicitly mark these as blocked by external inputs rather than incomplete implementation:

```text
Prerequisite-ready gates:
- GitLab project and runner build image tagged by CI_COMMIT_SHA: BLOCKED/PASS
- Registry push with confirmed registry path and credentials: BLOCKED/PASS
- Hosted DB migration/startup preflight with SRE-provided database: BLOCKED/PASS
- Atlassian OAuth login with registered hosted callback URL: BLOCKED/PASS
- Kubernetes probe acceptance for /health + startup preflight: BLOCKED/PASS
- Helm/Kubernetes deployment reference consumed without app-code workaround: BLOCKED/PASS
```

## Residual Risks After This Plan

- The Internal Applications Hosting v1 contract still does not define secret management. This app requires secrets; deployment cannot proceed until the platform accepts a Kubernetes Secret or equivalent add-on to the minimal contract.
- `/health` is shallow liveness. Startup preflight and optional migration checks cover readiness before Gunicorn starts, but a separate `/ready` endpoint can be added later if the platform requires ongoing DB readiness probes.
- Default `WEB_CONCURRENCY=1` is deliberate because process-local caches remain. Increase only after cache/session behavior is reviewed under multi-process load.
- Home/Townsquare write capability remains blocked by `GATE-05-home-write-capability.md`; this plan supports read-oriented EPM with user-connected Home tokens only.
- OAuth2 Proxy daily reauth does not automatically invalidate the app's Atlassian OAuth refresh-token session. If policy requires daily app-level Jira reauth too, add an explicit app session max-age/reconnect rule in a separate auth plan.
- Do not add app-side trust of OAuth2 Proxy user/email/group headers without a confirmed trusted-hop middleware contract and tests proving spoofed inbound headers are stripped or ignored.
- Do not enable image push, deploy jobs, Helm values, or production `RUN_DB_MIGRATIONS=true` defaults until SRE confirms registry, runner, secret, migration, and deployment conventions.
