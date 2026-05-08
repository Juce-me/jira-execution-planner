# DB Home User API Token Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not use subagent-driven execution unless the user explicitly asks for it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the DB auth migration so Home/Townsquare reads can stay workspace service-account-backed while Home/Townsquare write actions require the signed-in user to connect their own Atlassian API token.

**Architecture:** Atlassian OAuth remains the production login and default Jira REST credential. Because the latest documented Home GraphQL probe is `FAIL home_graphql_3lo_unsupported`, Home/Townsquare metadata reads use the workspace `home_townsquare_basic` service integration, while user-initiated Home/Townsquare mutations use a separate per-user `atlassian_user_api_token` connection stored in encrypted `auth_tokens`. The user's API token is never shared app auth, never used for workspace metadata reads by default, and never used to bypass Home/Townsquare permissions.

**Tech Stack:** Python, Flask, SQLAlchemy/Alembic, PostgreSQL, encrypted DB token storage from the DB auth plan, React settings UI, unittest, source-guard tests.

---

## Decision

Yes, we can support the model the user described, with one important correction:

- OAuth gives us the stable Atlassian `account_id` and usually an email address for prefill.
- Basic/API-token auth still requires an email plus API token.
- The email is not proof of identity. On connect, the backend must call Jira `/rest/api/3/myself` with the supplied Basic credential and verify the returned `accountId` matches the signed-in OAuth `account_id`.

This makes the user's API token a user-owned Home/Townsquare write credential. It is not a service account and must not be stored in `service_integration_tokens`.

## Current Gate Evidence

The latest local Home GraphQL OAuth probe result from this branch is:

```text
FAIL home_graphql_3lo_unsupported
```

That means:

- Do not use the user's Jira 3LO access token for Home/Townsquare GraphQL.
- Keep Home/Townsquare metadata reads service-integration-scoped.
- Add the user API-token bridge only for actions where the user is explicitly writing to Home/Townsquare as themselves.
- If a fresh probe later returns `PASS home_graphql_3lo_supported`, prefer DB-stored user OAuth tokens for Home/Townsquare instead of requiring a personal API token.

## Credential Model

### Workspace Service Integration

Use for app/workspace metadata reads:

- `service_integrations.provider = "home_townsquare_basic"`
- `service_integration_tokens.token_kind = "api_token"`
- Created, rotated, disabled, and deleted only by tool admins or operator CLI.
- Used for EPM Home goal/project discovery and workspace-scoped Home metadata caches.
- Never used for user-initiated Home/Townsquare mutations.

### User API Token Connection

Use only for user-initiated Home/Townsquare write actions while Home 3LO is unsupported:

- `auth_connections.provider = "atlassian_user_api_token"`
- `auth_connections.user_id = current user`
- `auth_connections.workspace_id = current workspace`
- `auth_connections.cloud_id = current workspace cloud id`
- `auth_connections.site_url = current workspace Jira site`
- `auth_connections.credential_subject = verified Basic email`
- `auth_connections.capabilities = ["home_townsquare_graphql"]`
- `auth_tokens.token_kind = "api_token"`

The API token is encrypted with the same envelope encryption and key rotation model as OAuth tokens. Admin APIs may show only status metadata such as provider, verified email, last validation time, status, and `needsReconnect`.

## UX Contract

EPM/Home browsing remains available after OAuth login if the workspace service integration exists.

When a user clicks a Home/Townsquare action that writes data:

1. Backend checks active OAuth session, active DB user, and active OAuth auth connection.
2. Backend checks for active `atlassian_user_api_token` with `home_townsquare_graphql` capability.
3. If missing, backend returns:

```json
{
  "error": "home_user_token_required",
  "message": "Connect your Atlassian API token to edit Jira Home as yourself.",
  "connectUrl": "/settings/connections/home-token"
}
```

4. Frontend opens Settings -> Connections and shows a token form.
5. Email is prefilled from the OAuth profile when available; if Atlassian did not provide email, the user must enter it.
6. The token is accepted only if Basic Jira `/myself` returns the same Atlassian `accountId` as the current OAuth user.
7. After connect, the original Home/Townsquare write can be retried.

Do not require the personal API token at login or to open the EPM tab.

## Route Policy

Allowed:

- `GET /api/me/connections/home-token`
- `POST /api/me/connections/home-token`
- `DELETE /api/me/connections/home-token`
- Specific Home/Townsquare mutation routes that call the per-user write credential resolver.

Not allowed:

- A generic Home GraphQL proxy.
- Any Home mutation route that silently falls back to the workspace service credential.
- Any route that stores a normal user's personal API token in `service_integration_tokens`.
- Any frontend code that stores the API token outside the one POST request body.

## File Map

- Modify: `docs/plans/2026-05-05-database-introduction-user-auth.md`
- Modify: `backend/db/models.py`
- Modify: `backend/db/migrations/versions/*_initial_auth.py` or add a follow-up migration if the initial DB plan already landed
- Create: `backend/auth/user_api_tokens.py`
- Create: `backend/auth/home_credentials.py`
- Modify: `backend/auth/token_crypto.py`
- Modify: `backend/routes/auth_routes.py`
- Create: `backend/routes/user_connection_routes.py`
- Modify: `backend/epm/home.py`
- Modify: `backend/routes/epm_routes.py` only when adding a concrete Home/Townsquare write action
- Modify: `frontend/src/api/authApi.js`
- Create: `frontend/src/settings/UserConnectionsSettings.jsx`
- Modify: `frontend/src/settings/SettingsModal.jsx`
- Modify: `frontend/src/dashboard.jsx` only to pass the new Connections tab state into the extracted settings component
- Test: `tests/test_user_api_token_connections.py`
- Test: `tests/test_home_credential_resolver.py`
- Test: `tests/test_home_mutation_auth_guards.py`
- Test: `tests/test_user_api_token_source_guard.py`
- Test: `tests/test_db_admin_routes.py`
- Test: `tests/ui/home_token_connection_settings.spec.js`

## Task 1: DB Schema And Provider Contract

**Files:**
- Modify: `backend/db/models.py`
- Modify: `backend/db/migrations/versions/*_initial_auth.py` or create a new Alembic version after DB auth lands
- Test: `tests/test_user_api_token_connections.py`

- [ ] Add `atlassian_user_api_token` as an allowed `auth_connections.provider` value.
- [ ] Add nullable `auth_connections.credential_subject` for the verified Basic-auth email.
- [ ] Add non-null `auth_connections.capabilities` JSON/array storage with default `[]`.
- [ ] Add a uniqueness constraint so each user has at most one current `atlassian_user_api_token` connection per workspace/cloud id.
- [ ] Add tests proving `service_integrations` cannot use `atlassian_user_api_token` and `auth_connections` cannot use `home_townsquare_basic`.
- [ ] Add tests proving `auth_tokens.token_kind = "api_token"` can attach to `atlassian_user_api_token` but the plaintext token never appears in model reprs, admin responses, logs, or audit event metadata.
- [ ] Run:

```bash
.venv/bin/python -m unittest tests.test_user_api_token_connections tests.test_db_migrations
```

- [ ] Commit with `git commit -m "Add user API token auth connection model"`.

## Task 2: User Token Connect, Validate, And Revoke API

**Files:**
- Create: `backend/auth/user_api_tokens.py`
- Create: `backend/routes/user_connection_routes.py`
- Modify: `backend/routes/auth_routes.py`
- Test: `tests/test_user_api_token_connections.py`

- [ ] Add `GET /api/me/connections/home-token` returning only:

```json
{
  "connected": true,
  "provider": "atlassian_user_api_token",
  "credentialSubject": "user@example.com",
  "status": "active",
  "lastValidatedAt": "2026-05-08T00:00:00Z",
  "needsReconnect": false
}
```

- [ ] Add `POST /api/me/connections/home-token` with token-bound CSRF. Request body:

```json
{
  "email": "user@example.com",
  "apiToken": "plaintext-only-in-this-request"
}
```

- [ ] Resolve effective email from `body.email` or the OAuth profile email. If neither exists, return `400 credential_email_required`.
- [ ] Validate the credential by calling Jira `/rest/api/3/myself` through Basic auth for the current workspace site.
- [ ] Reject credentials whose `/myself.accountId` does not equal `RequestAuthContext.atlassian_account_id` with `409 credential_subject_mismatch`.
- [ ] Run a harmless Home/Townsquare read probe against the configured Home container. If Jira `/myself` succeeds but Home rejects the credential, store no token and return `403 home_credential_not_authorized`.
- [ ] Store the API token in encrypted `auth_tokens`, set connection `status = "active"`, increment `token_version`, and write audit event `user_api_token_connected`.
- [ ] Add `DELETE /api/me/connections/home-token` with token-bound CSRF. It revokes the connection, deletes usable token rows, increments `token_version`, and writes audit event `user_api_token_revoked`.
- [ ] Ensure normal authenticated users can connect and revoke only their own user API token. Tool admin is not required for this user-owned credential.
- [ ] Run:

```bash
.venv/bin/python -m unittest tests.test_user_api_token_connections tests.test_csrf_token_bound
```

- [ ] Commit with `git commit -m "Add user Home API token connection routes"`.

## Task 3: Home Credential Resolver

**Files:**
- Create: `backend/auth/home_credentials.py`
- Modify: `backend/epm/home.py`
- Test: `tests/test_home_credential_resolver.py`

- [ ] Add `resolve_home_credential(context, purpose)` with two accepted purposes: `read_metadata` and `write_as_user`.
- [ ] For `read_metadata`, require active workspace `home_townsquare_basic` service integration and return a service credential descriptor keyed by `(workspace_id, service_integration_id, token_version)`.
- [ ] For `write_as_user`, require active user `atlassian_user_api_token` connection and return a user credential descriptor keyed by `(workspace_id, user_id, auth_connection_id, token_version)`.
- [ ] For `write_as_user`, never fall back to the workspace service integration.
- [ ] For `read_metadata`, never use a normal user's API token unless a later explicit plan changes the read authorization model.
- [ ] Update Home GraphQL client construction so callers must pass an explicit credential descriptor instead of reading `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` in DB mode.
- [ ] Add tests for missing service integration, missing user token, revoked token, disabled user, revoked OAuth connection, and successful service/user credential resolution.
- [ ] Run:

```bash
.venv/bin/python -m unittest tests.test_home_credential_resolver tests.test_epm_home_api
```

- [ ] Commit with `git commit -m "Separate Home service and user credentials"`.

## Task 4: Frontend Connections UI

**Files:**
- Modify: `frontend/src/api/authApi.js`
- Create: `frontend/src/settings/UserConnectionsSettings.jsx`
- Modify: `frontend/src/settings/SettingsModal.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Test: `tests/ui/home_token_connection_settings.spec.js`

- [ ] Add API wrappers for `GET`, `POST`, and `DELETE /api/me/connections/home-token`.
- [ ] Add a Settings -> Connections row named `Jira Home write access`.
- [ ] Show connected, reconnect required, and not connected states without token material.
- [ ] Prefill email from authenticated profile metadata when available.
- [ ] Keep the API token in component state only until the connect request completes; clear it on success, failure, modal close, and navigation away.
- [ ] When Home write routes return `home_user_token_required`, open the same connection flow.
- [ ] Run:

```bash
npm run build
node tests/test_frontend_api_source_guards.js
```

- [ ] Commit with `git commit -m "Add user Home token connection UI"`.

## Task 5: Home/Townsquare Mutation Guard

**Files:**
- Modify: `backend/routes/epm_routes.py` or the route module that introduces the specific Home/Townsquare write action
- Modify: `backend/epm/home.py`
- Test: `tests/test_home_mutation_auth_guards.py`

- [ ] Add mutation routes one-by-one. Do not add a generic GraphQL forwarding route.
- [ ] Each Home/Townsquare mutation route must require active OAuth user, active DB user, active OAuth auth connection, token-bound CSRF, and active `atlassian_user_api_token`.
- [ ] Each Home/Townsquare mutation route must call `resolve_home_credential(context, "write_as_user")`.
- [ ] Each Home/Townsquare mutation route must return `409 home_user_token_required` when the user token is missing and `401 auth_connection_revoked` when the OAuth or user API-token connection is revoked.
- [ ] Tests must prove the workspace service integration is not used for mutation even when present and active.
- [ ] Tests must prove non-admin users can perform Home mutations only when Home accepts their own credential. Tool admin is required only when the route also changes JEP shared workspace config.
- [ ] Run:

```bash
.venv/bin/python -m unittest tests.test_home_mutation_auth_guards tests.test_home_credential_resolver
```

- [ ] Commit with `git commit -m "Guard Home mutations with user API token"`.

## Task 6: Source Guards And Final Verification

**Files:**
- Create: `tests/test_user_api_token_source_guard.py`
- Modify: `tests/test_auth_isolation_source_guard.js` if it owns backend/frontend token isolation checks
- Modify: `docs/atlassian-oauth-setup.md`
- Modify: `README.md`

- [ ] Add a source guard proving no frontend code stores `apiToken`, `access_token`, `refresh_token`, or `Authorization` in localStorage/sessionStorage.
- [ ] Add a backend source guard proving Home mutation routes do not call service-integration credential helpers.
- [ ] Add a backend source guard proving DB-mode Home clients do not read `ATLASSIAN_EMAIL` or `ATLASSIAN_API_TOKEN` directly except in the operator service-credential seeding path.
- [ ] Update docs to state that service credentials power workspace Home reads, while user API tokens are optional and required only for Home writes while Home 3LO remains unsupported.
- [ ] Run:

```bash
.venv/bin/python -m unittest discover -s tests
node tests/test_frontend_api_source_guards.js
node tests/test_auth_isolation_source_guard.js
```

- [ ] Browser-verify: OAuth login, EPM tab read path with service integration, Home write action missing-token state, user token connect, retry write action, revoke token, retry write action returns `home_user_token_required`.
- [ ] Commit with `git commit -m "Verify Home user token bridge"`.

## Critical Misses This Plan Prevents

- Service account writes to Home/Townsquare that appear to come from the end user.
- Treating email as identity instead of verifying Atlassian `accountId`.
- Requiring a personal API token just to read the EPM tab.
- Putting personal API tokens in service-integration storage.
- Building a generic GraphQL proxy that can run unreviewed Home mutations.
- Serving Home metadata from a cache warmed by one credential without including workspace, credential type, credential id, and token version in the cache key.
- Calling local OAuth token-store helpers after DB auth exists.
