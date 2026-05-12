# DONE-02: DB Home User API Token Bridge Implementation Plan

> **Status:** Done for the user-token connection bridge. Executed on branch `cdx/auth-db-context-plan` in commits `67b1771`, `5c900c4`, `4278125`, and `c428a2d`. The blocked Home write capability was split to `GATE-05-home-write-capability.md`; keep this file for audit context only.

**Goal:** Extend the DB auth migration so Home/Townsquare reads can stay workspace service-account-backed while Home/Townsquare write actions require the signed-in user to connect their own Atlassian API token.

**Architecture:** Atlassian OAuth remains the production login and default Jira REST credential. Because the latest documented Home GraphQL probe is `FAIL home_graphql_3lo_unsupported`, Home/Townsquare metadata reads use the workspace `home_townsquare_basic` service integration, while user-initiated Home/Townsquare mutations use a separate per-user `atlassian_user_api_token` connection stored in encrypted `auth_tokens`. The user's API token is never shared app auth, never used for workspace metadata reads by default, and never used to bypass Home/Townsquare permissions.

**Tech Stack:** Python, Flask, SQLAlchemy/Alembic, PostgreSQL, encrypted DB token storage from the DB auth plan, React settings UI, unittest, source-guard tests.

---

> **Checklist reconciliation:** Task 1 through Task 4 checkboxes were updated on 2026-05-12 from the branch commit history. The Home write probe and route work moved to `GATE-05-home-write-capability.md`.

## Preflight: DONE-01 Tasks Required Before This Plan

Do not start Task 1 until the following DONE-01 tasks have landed or are present on the current checkout and the listed verifications pass:

- DONE-01 Task 1: DB runtime, migration harness, and local commands.
- DONE-01 Task 2: Token encryption, keyring, and audit redaction.
- DONE-01 Task 3: DB auth context resolver and local OAuth store cutover prep.
- DONE-01 Task 4: Refresh race, refresh reuse, and token versioning.
- DONE-01 Task 5: Admin and service integration auth APIs.
- DONE-01 Task 6: Token-bound CSRF and visible recovery pages.
- DONE-01 Task 7: Jira project access, cache partitioning, and Home 3LO gate outcomes.

Re-run and attach the results to the DONE-02 execution notes:

```bash
.venv/bin/python -m unittest tests.test_db_session tests.test_db_migrations tests.test_token_encryption tests.test_token_key_rotation tests.test_audit_redaction_source_guard tests.test_auth_context_db tests.test_db_oauth_cutover tests.test_token_refresh_race tests.test_token_refresh_reuse tests.test_service_integrations tests.test_db_admin_routes tests.test_csrf_token_bound tests.test_db_auth_recovery_pages tests.test_db_project_access tests.test_cache_partitioning tests.test_home_3lo_gate_outcomes
```

If any task above is unlanded, stop and finish DONE-01 first.

If specific test module names listed above do not exist after DONE-01 has merged, replace with the actual DONE-01 test names from `DONE-01-db-auth-foundation.md` Tasks 1-7 — do not invent test names.

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

This read probe does not prove that a user API token can perform Home/Townsquare writes. The separate Home write gate is tracked in `GATE-05-home-write-capability.md`.

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

Historical DONE-02 behavior did not require the personal API token at login or to open the EPM tab. `EXEC-04-db-user-home-epm-read-token.md` supersedes this for DB/OAuth EPM reads: the EPM tab is hidden until the current user has connected a Home/Townsquare token.

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

- Modify: `backend/db/models.py`
- Create: `backend/db/migrations/versions/*_user_api_token_connection.py`
- Create: `backend/auth/user_api_tokens.py`
- Create: `backend/auth/home_credentials.py`
- Use existing: `backend/auth/token_crypto.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Create: `backend/routes/user_connection_routes.py`
- Modify: `backend/epm/home.py`
- Deferred: concrete Home/Townsquare write action belongs to `GATE-05-home-write-capability.md`
- Create: `frontend/src/api/authApi.js` because this module does not exist in the current repo
- Deferred: `frontend/src/api/epmApi.js` Home update wrapper belongs to `GATE-05-home-write-capability.md`
- Create: `frontend/src/settings/UserConnectionsSettings.jsx`
- Modify: `frontend/src/settings/SettingsModal.jsx` only to support the self-service Connections tab without the shared-config Save action
- Deferred: `frontend/src/epm/EpmRollupPanel.jsx` and `frontend/src/epm/EpmView.jsx` Home update UI belongs to `GATE-05-home-write-capability.md`
- Modify: `frontend/src/dashboard.jsx` only to add the Connections tab state/opener
- Test: `tests/test_user_api_token_connections.py`
- Test: `tests/test_home_credential_resolver.py`
- Deferred: Home write capability and mutation guard tests belong to `GATE-05-home-write-capability.md`
- Test: `tests/test_user_api_token_source_guard.py`
- Test: `tests/test_db_admin_routes.py`
- Create: `tests/ui/home_token_connection_settings.spec.js` because this Playwright spec does not exist in the current repo
- Modify: `tests/test_frontend_api_source_guards.js` when adding frontend API wrappers

## Deferred Gate: Home Write Capability

The Home write capability check moved to `GATE-05-home-write-capability.md`.

Do not add Home write routes, write buttons, retry UI, or write-route OAuth-ready behavior from this file. The delivered scope of `DONE-02` is the user API-token connection model, backend connection routes, credential resolver, and Settings -> Connections UI.

## Task 1: DB Schema And Provider Contract

**Files:**
- Modify: `backend/db/models.py`
- Create: `backend/db/migrations/versions/*_user_api_token_connection.py`
- Test: `tests/test_user_api_token_connections.py`

- [x] Create a follow-up migration `backend/db/migrations/versions/*_user_api_token_connection.py` only for user-token bridge fields or constraints not already landed by DONE-01; do not edit `*_initial_auth.py`.
- [x] Verify `atlassian_user_api_token` is an allowed `auth_connections.provider` value from DONE-01. If DONE-01 already added it, do not create a duplicate provider/check-constraint migration; add only the missing Task 1 fields and tests.
- [x] Add nullable `auth_connections.credential_subject` for the verified Basic-auth email in the model and follow-up migration.
- [x] Add non-null `auth_connections.capabilities` JSON/array storage with default `[]` in the model and follow-up migration.
- [x] Add a uniqueness constraint so each user has at most one current `atlassian_user_api_token` connection per workspace/cloud id in the model and follow-up migration.
- [x] Add tests proving `service_integrations` cannot use `atlassian_user_api_token` and `auth_connections` cannot use `home_townsquare_basic`.
- [x] Add tests proving `auth_tokens.token_kind = "api_token"` can attach to `atlassian_user_api_token` but the plaintext token never appears in model reprs, admin responses, logs, or audit event metadata.
- [x] Run:

```bash
.venv/bin/python -m unittest tests.test_user_api_token_connections tests.test_db_migrations
```

- [x] Commit with `git commit -m "Add user API token auth connection model"`.

## Task 2: User Token Connect, Validate, And Revoke API

**Files:**
- Create: `backend/auth/user_api_tokens.py`
- Create: `backend/routes/user_connection_routes.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Test: `tests/test_user_api_token_connections.py`

- [x] Add `GET /api/me/connections/home-token` returning only:

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

- [x] Add `POST /api/me/connections/home-token` with token-bound CSRF. Request body:

```json
{
  "email": "user@example.com",
  "apiToken": "plaintext-only-in-this-request"
}
```

- [x] Resolve effective email from `body.email` or the OAuth profile email. If neither exists, return `400 credential_email_required`.
- [x] Validate the credential by calling Jira `/rest/api/3/myself` through Basic auth for the current workspace site.
- [x] Reject credentials whose `/myself.accountId` does not equal `RequestAuthContext.atlassian_account_id` with `409 credential_subject_mismatch`.
- [x] Run a harmless Home/Townsquare read probe against the configured Home container. If Jira `/myself` succeeds but Home rejects the credential, store no token and return `403 home_credential_not_authorized`.
- [x] Store the API token in encrypted `auth_tokens`, set connection `status = "active"`, increment `token_version`, and write audit event `user_api_token_connected`.
- [x] Add `DELETE /api/me/connections/home-token` with token-bound CSRF. It revokes the connection, deletes usable token rows, increments `token_version`, and writes audit event `user_api_token_revoked`.
- [x] Ensure normal authenticated users can connect and revoke only their own user API token. Tool admin is not required for this user-owned credential.
- [x] Add and run `TestUserApiTokenConnections.test_home_credential_rejected_when_home_probe_fails` in `tests/test_user_api_token_connections.py`.
- [x] Add and run `TestUserApiTokenConnections.test_credential_subject_mismatch_when_account_id_differs` in `tests/test_user_api_token_connections.py`.
- [x] Run:

```bash
.venv/bin/python -m unittest tests.test_user_api_token_connections tests.test_user_api_token_connections.TestUserApiTokenConnections.test_home_credential_rejected_when_home_probe_fails tests.test_user_api_token_connections.TestUserApiTokenConnections.test_credential_subject_mismatch_when_account_id_differs tests.test_csrf_token_bound
```

- [x] Commit with `git commit -m "Add user Home API token connection routes"`.

## Task 3: Home Credential Resolver

**Files:**
- Create: `backend/auth/home_credentials.py`
- Modify: `backend/epm/home.py`
- Test: `tests/test_home_credential_resolver.py`

- [x] Add `resolve_home_credential(context, purpose)` with two accepted purposes: `read_metadata` and `write_as_user`.
- [x] For `read_metadata`, require active workspace `home_townsquare_basic` service integration and return a service credential descriptor keyed by `(workspace_id, service_integration_id, token_version)`.
- [x] For `write_as_user`, require active user `atlassian_user_api_token` connection and return a user credential descriptor keyed by `(workspace_id, user_id, auth_connection_id, token_version)`.
- [x] For `write_as_user`, never fall back to the workspace service integration.
- [x] For `read_metadata`, never use a normal user's API token unless a later explicit plan changes the read authorization model.
- [x] Update Home GraphQL client construction so callers must pass an explicit credential descriptor instead of reading `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` in DB mode.
- [x] Add tests for missing service integration, missing user token, revoked token, disabled user, revoked OAuth connection, and successful service/user credential resolution.
- [x] Run:

```bash
.venv/bin/python -m unittest tests.test_home_credential_resolver tests.test_epm_home_api
```

- [x] Commit with `git commit -m "Separate Home service and user credentials"`.

## Task 4: Frontend Connections UI

**Files:**
- Create: `frontend/src/api/authApi.js`
- Create: `frontend/src/settings/UserConnectionsSettings.jsx`
- Modify: `frontend/src/settings/SettingsModal.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_frontend_api_source_guards.js`
- Create: `tests/ui/home_token_connection_settings.spec.js`

- [x] Add API wrappers in `frontend/src/api/authApi.js` for `GET`, `POST`, and `DELETE /api/me/connections/home-token`, using `frontend/src/api/http.js` and never storing token material outside the single POST body.
- [x] Add frontend API source-guard coverage proving `authApi.js` owns the `/api/me/connections/home-token` endpoint construction.
- [x] Add a Settings -> Connections row named `Jira Home write access`.
- [x] Show connected, reconnect required, and not connected states without token material.
- [x] Prefill email from authenticated profile metadata when available.
- [x] Keep the API token in component state only until the connect request completes; clear it on success, failure, modal close, and navigation away.
- [x] Add a dashboard `openUserConnectionsSettings()` path that opens Settings -> Connections; do not wire Home write-route recovery here because the concrete Home write route is introduced in Task 5.
- [x] Run:

```bash
npm run build
node tests/test_frontend_api_source_guards.js
npx playwright test tests/ui/home_token_connection_settings.spec.js
```

- [x] Commit with `git commit -m "Add user Home token connection UI"`.

## Deferred Home Write Route

The Home project update route and final write-route verification moved to `GATE-05-home-write-capability.md`.

Do not reopen this completed plan to add Home mutations. If `GATE-05` records `PASS home_project_update_supported`, create a new implementation plan or execute the deferred scope from the gate document.

## Critical Misses This Plan Prevents

- Service account writes to Home/Townsquare that appear to come from the end user.
- Treating email as identity instead of verifying Atlassian `accountId`.
- Requiring a personal API token just to read the EPM tab was out of scope for DONE-02. `EXEC-04-db-user-home-epm-read-token.md` later makes that an explicit DB/OAuth EPM read requirement.
- Putting personal API tokens in service-integration storage.
- Building a generic GraphQL proxy that can run unreviewed Home mutations.
- Serving Home metadata from a cache warmed by one credential without including workspace, credential type, credential id, and token version in the cache key.
- Calling local OAuth token-store helpers after DB auth exists.
