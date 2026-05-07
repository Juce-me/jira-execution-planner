# Database Introduction And User Auth Plan

## Goal

Introduce a database-backed identity and auth foundation for Jira Execution Planner without changing the current dashboard configuration model yet. This phase creates the storage boundary needed for authenticated users, the configured workspace/site context, encrypted integration tokens, and admin user inspection.

## Scope

This phase includes:

- Database connection and migration tooling.
- User records.
- Workspace record for the configured Jira/Atlassian site.
- Per-user OAuth auth connection metadata.
- Workspace-level service integration metadata for server-side service-account credentials.
- Per-user Jira project access status for configured product/tech projects.
- Encrypted token storage.
- Token/admin/config audit events.
- Admin inspection of user properties.
- Admin-only gates for specific shared configuration areas.

This phase does not include:

- Per-user saved dashboard configurations.
- Shareable view links.
- Role-specific ENG/EPM authorization. ENG/EPM behavior comes from the selected configuration in the later user-configuration phase, not from user roles.
- Workspace membership or workspace ACLs. In this phase, the workspace is the deployment's configured Jira/Atlassian site boundary, not a per-user authorization object.
- Long-lived Jira issue replication.
- Home/Townsquare user-ACL proof. Until the Home GraphQL 3LO gate passes, Home/Townsquare metadata is app/workspace-scoped service data, not user-filtered data.

## Current Constraints

- Runtime dashboard configuration is currently stored in local JSON files, mainly `dashboard-config.json`, `team-groups.json`, and `team-catalog.json`.
- Credentials are intentionally outside committed files and currently belong in `.env` or the local OAuth session path described in `docs/superpowers/specs/2026-04-27-atlassian-oauth-auth-design.md`. Server-side Basic/API-token credentials are service-account credentials, not personal user tokens.
- Initial dashboard load is performance-critical. This phase must not add extra heavy startup requests.
- Admin views must not expose token material.

## Related Repo Context

- `docs/plans/2026-04-27-atlassian-oauth-auth.md` defines the first OAuth slice and intentionally defers production multi-user persistence.
- `docs/features/epm-view.md` documents current EPM config shape and exact-label rollup behavior that later phases must preserve.
- `postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md` and `postmortem/MRT015-epm-first-load-home-fanout-overfetch.md` show why database-backed bootstrapping must stay compact and measured.

## Blocker

Do not implement this database phase until the Jira/Home auth-client boundary exists and the OAuth slice has closed the local-only safety gaps.

The phase assumes backend Jira calls can resolve the current request's authenticated user, auth connection, workspace/site, and headers without reading process-global `JIRA_EMAIL` / `JIRA_TOKEN` directly in every route. Home/Townsquare calls must not be treated as user-scoped until `docs/plans/2026-05-06-epm-home-oauth-migration.md` passes its real local 3LO gate. Until that gate passes, Home/Townsquare metadata uses workspace-level service credentials and remains guarded or read-only for normal users. Before starting this phase, the OAuth slice must also serialize refresh-token replacement, return `route_not_oauth_ready`/501 for un-migrated API routes in `JIRA_AUTH_MODE=atlassian_oauth`, and disable or auth-key Jira/Home process caches for OAuth users. Either complete `docs/plans/2026-04-27-atlassian-oauth-auth.md` first or add an equivalent centralized auth/client layer with those same gates before database-backed identity work starts.

## Home/Townsquare And Service-Credential Boundary

This database phase keeps three credential concepts separate:

- User OAuth connections: rows in `auth_connections` and `auth_tokens`, owned by an authenticated Atlassian user, used for Jira REST and any future provider that actually supports user 3LO.
- Workspace service integrations: rows in `service_integrations` and `service_integration_tokens`, owned by the deployment/workspace and provisioned by an admin/operator service account.
- Route authorization: normal users can read only through routes explicitly migrated and tested for their auth model; Home/Townsquare-backed or Jira-project-backed mutations require an admin or service-account guard.

Do not store a Home/Townsquare Basic API token as a user's `auth_connection`. Until the Home/Townsquare 3LO gate passes, Home/Townsquare Basic credentials are service-account credentials and their data must not be described as user-ACL filtered. `RequestAuthContext` may still be passed to Home/Townsquare helpers for workspace scoping, cache partitioning, audit, and response gating, but it is not proof that the signed-in user has Home/Townsquare object-level access.

## Security Preconditions

Before this database phase starts, the OAuth slice must settle these items:

- Fetch `https://api.atlassian.com/me` during OAuth callback and use Atlassian `account_id` as the stable external subject. Email and display name are mutable profile metadata and must not be used as identity keys.
- Reject inactive Atlassian accounts before creating or updating local user records.
- Use PKCE S256 in the Atlassian authorization-code flow, with one-time `state` and `code_verifier` cleanup on callback success or failure.
- Keep the local-dev `OAUTH_TOKEN_STORE` local-only. It may be process-local or persisted to the ignored local token-store file, but it must require both `APP_ENVIRONMENT_KEY=local` or `dev` and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`; production database auth must hard-fail if it would use that store instead of encrypted database tokens.
- Serialize local OAuth refresh per session and re-read token state inside the lock before calling Atlassian. The database refresh path can then replace this with `SELECT ... FOR UPDATE` or an advisory lock without changing the caller contract.
- Make unsupported OAuth route surface explicit. Until a route is migrated through the auth/client boundary, `JIRA_AUTH_MODE=atlassian_oauth` must return `route_not_oauth_ready`/501 instead of falling through to empty Basic credentials.
- Before any Home/Townsquare route is marked OAuth-ready, follow `docs/plans/AGENTS.md` and rerun the Home GraphQL 3LO probe with a real local OAuth session. If it fails or credentials are unavailable, keep Home/Townsquare-backed routes guarded or service-credential-backed as documented.
- Define session cookie, CORS, and CSRF policy before exposing DB-backed admin/config mutation endpoints: `HttpOnly`, `SameSite=Lax`, `Secure` outside local HTTP development, a restricted origin allowlist, and CSRF checks for state-changing browser routes.
- Partition or disable every Jira/Home-derived cache for OAuth users before multiple users can share a process.
- Define and use `RequestAuthContext` for Jira clients and for Home/Townsquare workspace/cache/audit scoping. Routes must not reach into global auth state after this boundary exists.

## RequestAuthContext Boundary

Before database tables are introduced, the auth slice must define a request-scoped context with these fields:

| Field | Source before DB | Source after DB |
| --- | --- | --- |
| `user_id` | Synthetic local id for Basic, or local OAuth session user id. | `users.id`. |
| `stable_subject` | Atlassian `/me` `account_id` or synthetic local subject. | `users.external_subject`. |
| `atlassian_account_id` | Atlassian `/me` `account_id` when OAuth is used. | `users.external_subject` for Atlassian users. |
| `workspace_id` | Deterministic local id from environment key plus normalized Jira site. | `workspaces.id`. |
| `auth_connection_id` | Opaque local OAuth session connection id or synthetic Basic connection id. | `auth_connections.id`. |
| `cloud_id` | Accessible resource `id`. | `workspaces.jira_cloud_id` and `auth_connections.cloud_id`. |
| `token_version` | Local token/session version. | Monotonic `auth_connections.token_version`. |
| `account_status` | Atlassian `/me` account status or local active status. | `users.status` plus provider status check. |
| `is_admin` | Local single-user default or bootstrap-only flag. | `users.account_type == "admin"`. |
| `project_access` | Empty or local snapshot. | Latest `jira_project_access` rows for the connection. |

All Jira client entry points must take `RequestAuthContext` as an explicit argument. Home/Townsquare entry points must take `RequestAuthContext` for workspace/cache/audit scoping, but must resolve credentials from the workspace service integration unless the Home/Townsquare 3LO gate has passed and the route has been migrated through the future Home OAuth client. Cache helpers must also take this context and use it in cache keys. This includes Jira issue searches, project/field/label/board lookups, Home goal/project fetches, EPM rollups, and generated project metadata caches.

The database phase must not add new DB-backed routes that still call `build_jira_headers()`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `fetch_home_*`, or process caches directly from route globals. Any remaining Basic-mode compatibility wrapper should first build a `RequestAuthContext`, then call the same Jira/Home client boundary. Any server-side API token loaded from the database must come from a service-integration boundary, not from a normal user's auth connection.

On every authenticated request, the auth context resolver reads `users.status` and `auth_connections.status` from the database before issuing user-scoped Jira calls or serving Home/Townsquare-backed route responses. Do not cache these statuses beyond the request by default. The only acceptable optimization is a per-process status cache with a maximum 30-second TTL, keyed by `(user_id, auth_connection_id, token_version)`, and invalidated immediately by admin enable/disable, admin grant/revoke, connection revoke, and reconnect events. Any non-active user or connection returns `401` with a stable error such as `account_disabled` or `auth_connection_revoked` before user-scoped Jira calls or Home/Townsquare-backed route responses run.

Every `401` auth-state response that a browser user can hit must include a stable re-auth target or screen state. Expired sessions and expired/error auth connections use `loginUrl: "/login?reason=session_expired"` or the DB-phase equivalent; disabled users and revoked connections use a visible account-disabled/reconnect screen instead of a generic dashboard failure.

The browser may proactively call a token-safe refresh endpoint when the tab becomes visible or focused, but this is an optimization only. It must be throttled, must not return token material, must use the unsafe-method CSRF guard, and must fall back to the same visible expired-auth recovery state when refresh fails.

## Environment And Workspace Isolation

Database-backed state is isolated by deployment environment and Jira/Atlassian workplace/site.

- Production, staging, and local development should use separate databases or schemas. If they share a PostgreSQL cluster, they still need distinct database/schema names and distinct token-encryption key ids.
- Every workspace row includes an `environment_key`, for example `local`, `staging`, or `production`, and the normalized Jira site identity.
- The effective workspace key is `(environment_key, jira_cloud_id)` when OAuth has a cloud id, otherwise `(environment_key, normalized_jira_site_url)`.
- All operational tables that store configuration, auth connections, tokens, project access, saved views, cache metadata, and audit events must include `workspace_id` directly or through a required parent row.
- API routes resolve the current workspace from `RequestAuthContext`; clients must not accept a caller-supplied workspace id unless it is checked against that context.
- No cache key may omit `workspace_id`; no token, config, or audit query may run without workspace scoping.

## Recommended Approach

Use PostgreSQL for production because this feature needs concurrent users, transactions, constraints, encrypted token metadata, and reliable migrations. SQLite can be used for local development tests only, but it should not be the production sharing or auth store.

## Migration Tool And DB Runtime

Use Alembic with SQLAlchemy 2.x as the migration/runtime boundary:

- Add dependencies to `requirements.txt`: `SQLAlchemy`, `alembic`, and `psycopg[binary]`.
- Put DB engine/session helpers in `backend/db/engine.py`.
- Put table metadata or ORM models in `backend/db/models.py`.
- Put migration environment files under `backend/db/migrations/`.
- Put Alembic versions under `backend/db/migrations/versions/`.
- Use PostgreSQL through `postgresql+psycopg://...` for local production-like auth testing and production.
- Use SQLite only for focused unit tests that do not depend on PostgreSQL locking, JSONB, or `SELECT ... FOR UPDATE` behavior.
- Tests that verify refresh locking, concurrent token refresh, cache invalidation across workers, or production key handling must run against PostgreSQL.

## Local Execution Notes

The executable DB implementation plan must include exact local setup and reset commands before schema work starts:

- `DATABASE_URL` examples for local PostgreSQL and test SQLite. SQLite is acceptable only for unit tests; local multi-user auth and production-like refresh locking must use PostgreSQL.
- A local PostgreSQL bootstrap example, for example `createdb jep_local`.
- Alembic migration and rollback commands, for example `alembic -c backend/db/alembic.ini upgrade head` and `alembic -c backend/db/alembic.ini downgrade -1`.
- A DB reset command that drops only the local/test database or schema and never targets production.
- A local encryption-key generation command, for example:

```bash
python3 -c "import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

- A documented `.env` key such as `TOKEN_ENCRYPTION_MASTER_KEY_B64` for local development and a production key reference such as `TOKEN_ENCRYPTION_KEY_ID`.
- Document these env keys in `.env.example`: `DATABASE_URL`, `TEST_DATABASE_URL`, `CONFIG_STORAGE_BACKEND`, `TOKEN_ENCRYPTION_MASTER_KEY_B64`, `TOKEN_ENCRYPTION_KEY_ID`, and `ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS`.
- Production startup must refuse `TOKEN_ENCRYPTION_MASTER_KEY_B64`; production must use `TOKEN_ENCRYPTION_KEY_ID` and a KMS/secrets-manager adapter. Supported adapter shape for the first slice is a small key provider interface with `wrap_key(dek, aad)`, `unwrap_key(wrapped_dek, aad)`, and `primary_key_id()`.
- A service-credential seeding path that reads service-account credentials from local env or an operator prompt and writes only encrypted `service_integration_tokens`; it must not commit secrets or ask normal users for personal API tokens.
- Name the operator CLI before implementation. Use `python3 -m backend.admin.seed_service_credential` unless another module already exists.

The first database slice should be deliberately narrow:

- Store who the user is.
- Store the configured workspace/site context.
- Store connection status and encrypted auth token material.
- Store the user's last known access status for configured Jira product/tech projects.
- Keep current JSON dashboard config behavior intact.

## Data Model

### `users`

One row per authenticated person.

| Column | Purpose |
| --- | --- |
| `id` | Internal UUID primary key. |
| `external_provider` | Identity provider, initially `atlassian`. |
| `external_subject` | Stable provider user/account id, initially Atlassian `account_id`. |
| `email` | Display and admin lookup only. |
| `display_name` | UI label. |
| `account_type` | `user` or `admin`. |
| `status` | `active`, `disabled`, or `deleted`. |
| `created_by` | `system`, `bootstrap`, or admin user id. |
| `created_at`, `updated_at`, `last_seen_at` | Account lifecycle timestamps visible to admins. |

There are only two account types: `user` and `admin`. A normal user can authenticate, use the dashboard, and use all non-admin configuration tabs. An admin can inspect user properties such as user id, provider id, created-by, created-at, status, last-seen, Jira project access status, and auth connection status. Admins also control the shared configuration areas listed in "Admin Configuration Access".

### `workspaces`

One row for the configured Jira/Atlassian site or deployment scope.

| Column | Purpose |
| --- | --- |
| `id` | Workspace UUID. |
| `environment_key` | Deployment environment scope such as `local`, `staging`, or `production`. |
| `name` | Human-readable workspace name. |
| `jira_site_url` | Normalized Jira site URL. |
| `jira_cloud_id` | Atlassian cloud id when OAuth is used. |
| `created_by`, `created_at`, `updated_at` | Ownership and lifecycle. |

Use a unique constraint on `(environment_key, jira_cloud_id)` when `jira_cloud_id` is present and on `(environment_key, jira_site_url)` for local Basic mode. This table is not an access-control list in this phase. Jira project permissions come from Jira, not from Jira Execution Planner workspace membership.

### `auth_connections`

One row per user and external service connection.

| Column | Purpose |
| --- | --- |
| `id` | Connection UUID. |
| `user_id`, `workspace_id` | Owner and scope. |
| `provider` | `atlassian_oauth`, `jira_basic`, or later `confluence_oauth`. |
| `site_url`, `cloud_id` | Provider target. |
| `scopes` | Granted scopes. |
| `status` | `active`, `expired`, `revoked`, or `error`. |
| `token_version` | Monotonic integer incremented on token refresh, revoke, reconnect, or project-access snapshot reset. |
| `last_validated_at`, `expires_at` | Token lifecycle. |
| `created_at`, `updated_at` | Lifecycle timestamps. |

### `jira_project_access`

Last known Jira access check for each configured product/tech project and user connection.

| Column | Purpose |
| --- | --- |
| `connection_id` | Auth connection used for validation. |
| `workspace_id` | Configured workspace/site. |
| `project_key` | Jira project key from shared configuration. |
| `project_type` | `product`, `tech`, or `other`. |
| `status` | `accessible`, `inaccessible`, or `unknown`. |
| `error_code` | Sanitized Jira/API error category when inaccessible or unknown. |
| `checked_at` | Last validation timestamp. |

The app should handle partial access explicitly:

- Product-only access: product views load; tech views show an access-required empty state.
- Tech-only access: tech views load; product views show an access-required empty state.
- No configured project access: the user is authenticated, but Jira-backed dashboard data is blocked with a clear access-required state.
- Unknown access: avoid heavy startup retries; show a retry/check action or revalidate only on explicit refresh.

### `auth_tokens`

Encrypted token material separated from connection metadata and never joined into config payloads.

| Column | Purpose |
| --- | --- |
| `connection_id` | Parent connection. |
| `token_kind` | `access_token`, `refresh_token`, or `api_token`. |
| `algorithm` | Encryption algorithm, initially `AES-256-GCM`. |
| `ciphertext` | Encrypted token value. |
| `nonce` | Per-token encryption nonce. |
| `wrapped_dek` | Data encryption key wrapped by the configured key-encryption key. |
| `key_id` | Encryption key identifier for rotation. |
| `aad_hash` | Hash of authenticated associated data such as workspace, connection, and token kind. |
| `expires_at` | Token expiry when known. |
| `rotated_at`, `revoked_at` | Secret lifecycle. |

Frontend APIs should receive only status such as `authenticated`, `provider`, `expiresAt`, and `needsReconnect`.

### `service_integrations`

One row per workspace-owned service credential configuration.

| Column | Purpose |
| --- | --- |
| `id` | Integration UUID. |
| `workspace_id` | Workspace scope. |
| `provider` | `jira_basic` or `home_townsquare_basic`. |
| `credential_subject` | Service-account email or non-secret account label. |
| `status` | `active`, `disabled`, `expired`, `revoked`, or `error`. |
| `token_version` | Monotonic integer incremented on rotation, revoke, or validation reset. |
| `last_validated_at`, `expires_at` | Credential lifecycle when known. |
| `created_by`, `updated_by` | Admin/operator actor ids. |
| `created_at`, `updated_at` | Lifecycle timestamps. |

Normal users cannot create or update service integrations. Admin/operator flows must verify that the credential belongs to a dedicated service account. Do not store personal API tokens here.

### `service_integration_tokens`

Encrypted token material for workspace service integrations.

| Column | Purpose |
| --- | --- |
| `service_integration_id` | Parent service integration. |
| `token_kind` | `api_token`. |
| `algorithm` | Encryption algorithm, initially `AES-256-GCM`. |
| `ciphertext` | Encrypted token value. |
| `nonce` | Per-token encryption nonce. |
| `wrapped_dek` | Data encryption key wrapped by the configured key-encryption key. |
| `key_id` | Encryption key identifier for rotation. |
| `aad_hash` | Hash of authenticated associated data such as workspace, service integration, and token kind. |
| `rotated_at`, `revoked_at` | Secret lifecycle. |

The encryption and redaction rules for `auth_tokens` apply here too. Admin APIs expose only status and service-account subject metadata, never token plaintext or ciphertext.

### `audit_events`

Append-only security and admin event log. Events must not contain token material, OAuth codes, PKCE verifiers, raw authorization headers, or full callback URLs.

| Column | Purpose |
| --- | --- |
| `id` | Event UUID. |
| `workspace_id` | Workspace scope. |
| `actor_user_id` | User who caused the event, nullable for system/bootstrap events. |
| `target_user_id` | Affected user when applicable. |
| `auth_connection_id` | Affected connection when applicable. |
| `event_type` | Phase-1 values: `login_success`, `login_failure`, `token_refresh_success`, `token_refresh_failure`, `connection_revoked`, `admin_granted`, `admin_revoked`, `user_disabled`, `user_enabled`, `service_integration_created`, `service_integration_rotated`, `service_integration_disabled`, `service_integration_deleted`, and `config_write`. Add future key-rotation workflow events only when the rotation workflow itself ships. |
| `metadata` | Redacted JSON metadata: status code, sanitized provider error code, project key, config section, or key id. |
| `created_at` | Event timestamp. |

### Required constraints

Implementers must encode the auth invariants in database constraints, not only in route code:

- `users`: unique `(external_provider, external_subject)`.
- `workspaces`: unique `(environment_key, jira_cloud_id)` when `jira_cloud_id` is present and unique `(environment_key, jira_site_url)` for local Basic mode.
- `auth_connections`: one current connection row per `(user_id, workspace_id, provider, cloud_id)` or `(user_id, workspace_id, provider, site_url)`; if later history is needed, add a separate history/audit table instead of allowing duplicate current connections.
- `auth_tokens`: at most one non-revoked row per `(connection_id, token_kind)`.
- `service_integrations`: at most one active integration per `(workspace_id, provider)` unless a later plan introduces named multiple credentials.
- `service_integration_tokens`: at most one non-revoked row per `(service_integration_id, token_kind)`.
- `jira_project_access`: unique `(connection_id, workspace_id, project_key, project_type)`.
- `audit_events`: always scoped by `workspace_id`; token-bearing columns must never be added.

## Admin Configuration Access

Admin bootstrap:

- First admin is granted only by stable Atlassian account id using `ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS`, a comma-separated list of account ids.
- Bootstrap runs only when the workspace has zero admin users. Email address and email domain are not accepted as bootstrap identity keys because they can change.
- If no bootstrap account id is configured, OAuth login can create normal active users, but admin endpoints and shared config writes remain unavailable until an operator runs an explicit local admin-grant command.
- Later admins are granted or revoked only by an existing admin through an admin endpoint, or by a local break-glass CLI command that requires server filesystem access and writes an `audit_events` row.
- Every admin grant, revocation, user disable, and user enable creates an audit event.
- Login admission requires an active Atlassian account and access to the configured Atlassian resource whose `cloud_id` or site URL matches the workspace. Optional `AUTH_ALLOWED_EMAIL_DOMAINS` can further restrict login admission, but it is not an identity key and does not grant admin rights.
- Jira project access is never sufficient for admin config endpoints.

Admin-only configuration areas:

- Scope projects, including product/tech project selection.
- Jira source, including site, board, and query source settings.
- Field mapping.
- Capacity.
- Priority weights.

All other settings/configuration tabs remain available to all authenticated users. Normal users can still receive the effective non-secret configuration needed to render the dashboard, but they cannot edit the admin-only shared configuration areas.

Do not model this as separate `dev_lead` or `epm` roles. Admin access controls shared configuration and user inspection only.

Current mutable routes that need an authenticated admin boundary before DB auth lands:

- `POST /api/groups-config` in `backend/routes/settings_routes.py`.
- `POST /api/team-catalog` in `backend/routes/settings_routes.py`.
- `POST /api/projects/selected` in `backend/routes/settings_routes.py`.
- `POST /api/board-config` in `backend/routes/settings_routes.py`.
- `POST /api/capacity/config` in `backend/routes/settings_routes.py`.
- `POST /api/sprint-field/config` in `backend/routes/settings_routes.py`.
- `POST /api/story-points-field/config` in `backend/routes/settings_routes.py`.
- `POST /api/parent-name-field/config` in `backend/routes/settings_routes.py`.
- `POST /api/team-field/config` in `backend/routes/settings_routes.py`.
- `POST /api/stats/priority-weights-config` in `backend/routes/settings_routes.py`.
- `POST /api/issue-types/config` in `backend/routes/settings_routes.py`.
- `POST /api/epm/config` in `backend/routes/epm_routes.py`.

`POST /api/epm/projects/configuration` and `POST /api/epm/projects/preview` are currently non-persistent preview helpers. They still need authentication and CSRF handling because they are browser POST routes, but they do not need admin authorization unless they start persisting configuration.

The executable checklist below assigns this pre-DB admin gate to Task 0. Do not start DB schema work before Task 0 passes.

## API Surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/me` | Current user, account type, current workspace/site, Jira project access status, auth connection status. |
| `GET /api/auth/connections` | List connection statuses only. |
| `DELETE /api/auth/connections/<id>` | Revoke a stored connection. |
| `GET /api/admin/users` | Admin-only list of user properties, Jira project access, and auth connection status. |
| `GET /api/admin/users/<id>` | Admin-only user detail: ids, creator, timestamps, status, Jira project access, and auth connection status. |
| `PATCH /api/admin/users/<id>/status` | Admin-only enable, disable, or mark deleted. |
| `POST /api/admin/users/<id>/admin-grant` | Admin-only grant admin account type. |
| `DELETE /api/admin/users/<id>/admin-grant` | Admin-only revoke admin account type. |
| `GET /api/admin/config` | Admin-only shared configuration summary for scope projects, Jira source, field mapping, capacity, and priority weights. |
| `GET /api/admin/service-integrations` | Admin-only list of workspace service integrations without token material. |
| `POST /api/admin/service-integrations` | Admin-only create service integration metadata and encrypted service token. CSRF required. |
| `POST /api/admin/service-integrations/<id>/rotate` | Admin-only rotate the encrypted service token and increment `token_version`. CSRF required. |
| `POST /api/admin/service-integrations/<id>/disable` | Admin-only disable a service integration. CSRF required. |
| `DELETE /api/admin/service-integrations/<id>` | Admin-only revoke/delete a service integration secret and invalidate dependent caches. CSRF required. |
| `GET /api/admin/audit-events` | Admin-only redacted security/admin event log. |

Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` continue reading the current JSON-backed configuration during this phase.

## Migration Plan

Execute these tasks in order. Each task should be a focused commit unless the task explicitly says it is documentation-only.

### Preflight: OAuth Boundary And Home Gate Evidence

Run this preflight before Task 0, and attach the command results to the DB auth execution notes. Do not start schema work until it passes or the blocker is explicitly resolved.

```bash
.venv/bin/python -m unittest tests.test_auth_context tests.test_jira_auth tests.test_oauth_jira_client tests.test_auth_routes tests.test_auth_entry_page tests.test_oauth_route_guards tests.test_oauth_cache_isolation
node tests/test_auth_isolation_source_guard.js
.venv/bin/python scripts/check_home_graphql_oauth.py
```

Expected: OAuth/Jira boundary tests pass, unsupported OAuth routes still return `route_not_oauth_ready`, OAuth process caches are disabled or auth-keyed, and the Home GraphQL gate result is recorded. If the Home gate is `FAIL home_graphql_3lo_unsupported`, keep Home/Townsquare user 3LO out of DB auth and use only admin-managed `home_townsquare_basic` service integration credentials for Home metadata.

### Task 0: Pre-DB Admin Gate For Current OAuth Shared Config Writes

**Files:**
- Modify: `jira_server.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/routes/epm_routes.py`
- Test: `tests/test_pre_db_admin_gates.py`

- [ ] Write failing tests proving a non-bootstrap OAuth user with `X-Requested-With: jira-execution-planner` receives `403 admin_required` for `POST /api/groups-config`, `POST /api/team-catalog`, `POST /api/projects/selected`, `POST /api/board-config`, `POST /api/capacity/config`, `POST /api/sprint-field/config`, `POST /api/story-points-field/config`, `POST /api/parent-name-field/config`, `POST /api/team-field/config`, `POST /api/stats/priority-weights-config`, `POST /api/issue-types/config`, and `POST /api/epm/config`.
- [ ] Implement a temporary admin check based only on stable Atlassian account ids in `ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS`; keep `RequestAuthContext.is_admin = False` for all other OAuth users until DB auth lands.
- [ ] Preserve Basic single-user behavior.
- [ ] Run `.venv/bin/python -m unittest tests.test_pre_db_admin_gates tests.test_oauth_route_guards`.
- [ ] Commit with `git commit -m "Gate OAuth shared config writes before DB auth"`.

### Task 1: DB Runtime, Migration Harness, And Local Commands

**Files:**
- Modify: `requirements.txt`
- Create: `backend/db/engine.py`
- Create: `backend/db/models.py`
- Create: `backend/db/alembic.ini`
- Create: `backend/db/migrations/env.py`
- Create: `backend/db/migrations/versions/*_initial_auth.py`
- Create: `backend/db/reset_local.py`
- Test: `tests/test_db_session.py`
- Test: `tests/test_db_migrations.py`

- [ ] Add `SQLAlchemy`, `alembic`, and `psycopg[binary]` dependencies.
- [ ] Add SQLAlchemy 2.x engine/session helpers keyed by `DATABASE_URL` and `TEST_DATABASE_URL`; startup fails when DB mode is selected without a database URL.
- [ ] Add Alembic config under `backend/db/` and document these commands in the plan implementation notes: `alembic -c backend/db/alembic.ini upgrade head`, `alembic -c backend/db/alembic.ini downgrade base`, and `python3 -m backend.db.reset_local`.
- [ ] Create the initial auth migration for `users`, `workspaces`, `auth_connections`, `auth_tokens`, `service_integrations`, `service_integration_tokens`, `jira_project_access`, and `audit_events`.
- [ ] Test migration upgrade/downgrade/rollback/idempotent rerun in `tests/test_db_migrations.py`.
- [ ] Test session factory isolation and unique constraints on `(environment_key, jira_cloud_id)` and `(environment_key, jira_site_url)` in `tests/test_db_session.py`.
- [ ] Ensure refresh-race tests refuse to run on SQLite or skip with a clear message because SQLite cannot prove PostgreSQL advisory-lock or `SELECT ... FOR UPDATE` semantics.
- [ ] Commit with `git commit -m "Add database auth migration harness"`.

### Task 2: Token Encryption, Keyring, And Audit Redaction

**Files:**
- Create: `backend/auth/token_crypto.py`
- Create: `backend/auth/key_provider.py`
- Modify: `backend/db/models.py`
- Test: `tests/test_token_encryption.py`
- Test: `tests/test_token_key_rotation.py`
- Test: `tests/test_audit_redaction_source_guard.py`

- [ ] Implement envelope encryption for `auth_tokens` and `service_integration_tokens` with AES-256-GCM, per-token data-encryption keys, wrapped DEKs, nonces, `key_id`, and AAD bound to `(workspace_id, auth_connection_id or service_integration_id, token_kind, key_id)`.
- [ ] Add a key provider interface with local `TOKEN_ENCRYPTION_MASTER_KEY_B64`, production `TOKEN_ENCRYPTION_KEY_ID`, and a retired-key read path such as `TOKEN_ENCRYPTION_RETIRED_KEY_IDS` / `TOKEN_ENCRYPTION_RETIRED_KEYS_B64`.
- [ ] Refuse production startup when `TOKEN_ENCRYPTION_MASTER_KEY_B64` is the only available key source and `APP_ENVIRONMENT_KEY` is not `local` or `dev`.
- [ ] Test ciphertext is not plaintext, AAD prevents cross-row decrypt, logs are redacted, retired keys can decrypt existing rows, and new writes use the primary `key_id`.
- [ ] Add an audit source guard that scans audit insert paths and fails if token material, OAuth codes, PKCE verifiers, raw Authorization headers, or full callback URLs can be written.
- [ ] Commit with `git commit -m "Add encrypted auth token storage"`.

### Task 3: DB Auth Context Resolver And Local OAuth Store Cutover Prep

**Files:**
- Create: `backend/auth/db_context.py`
- Create: `backend/auth/db_tokens.py`
- Modify: `backend/auth/jira_auth.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `jira_server.py`
- Test: `tests/test_auth_context_db.py`
- Test: `tests/test_db_oauth_cutover.py`

- [ ] Write DB-mode tests for active user plus active connection, disabled user, revoked connection, stale `token_version`, missing scopes, and the 30-second status TTL with immediate invalidation on admin enable/disable or connection revoke.
- [ ] Rewrite `current_request_auth_context()` so DB mode reads `users`, `workspaces`, and `auth_connections` instead of `oauth_session_data()`.
- [ ] OAuth callback cutover order for this task: write encrypted tokens to DB while still updating the local store, and resolve request identity/connection metadata from DB when a DB `auth_connection` exists. Do not make DB refresh authoritative in this task.
- [ ] If a DB-mode request needs token refresh before Task 4 lands, return the same visible reconnect/expired-auth recovery response instead of refreshing from DB without a row lock.
- [ ] Ensure local store and DB rows are never both authoritative for the same request context. DB identity/context wins once a DB `auth_connection` exists; DB token refresh becomes authoritative only after Task 4 passes.
- [ ] Extend source guards so active DB-mode route code cannot call `OAUTH_TOKEN_STORE`, `oauth_session_data`, `save_oauth_session`, or `oauth_refresh_lock`, and cannot read `JIRA_EMAIL` / `JIRA_TOKEN` outside the service-integration boundary. Local OAuth compatibility routes may keep local-store helpers only behind the explicit local/dev allow flag.
- [ ] Commit with `git commit -m "Resolve auth context from database tokens"`.

### Task 4: Refresh Race, Refresh Reuse, And Token Versioning

**Files:**
- Modify: `backend/auth/db_tokens.py`
- Modify: `backend/auth/jira_auth.py`
- Test: `tests/test_token_refresh_race.py`
- Test: `tests/test_token_refresh_reuse.py`

- [ ] Use a transaction plus `SELECT ... FOR UPDATE` or a PostgreSQL advisory lock keyed by `auth_connection_id` for every DB refresh.
- [ ] Under the lock, decrypt the current refresh token, call Atlassian, replace access/refresh token rows, update `auth_connections.expires_at` and `status`, and increment `auth_connections.token_version` in the same transaction.
- [ ] Hard-delete the previous refresh-token row before commit when Atlassian returns a replacement refresh token.
- [ ] Treat `invalid_grant`, `token_already_used`, or equivalent refresh-reuse signals as revocation: no retry, delete usable tokens, set connection `revoked`, write `connection_revoked` audit metadata with `cause: refresh_reuse_detected`, and force re-authentication.
- [ ] Test concurrent refresh serialization and monotonic `token_version` against PostgreSQL; skip or fail clearly on SQLite.
- [ ] After these tests pass, flip DB token reads and refresh to DB-only authority for DB-mode sessions; local token-store helpers remain only for the local OAuth bridge.
- [ ] Commit with `git commit -m "Serialize database OAuth token refresh"`.

### Task 5: Admin Bootstrap, Service Integrations, And Admin APIs

**Files:**
- Create: `backend/auth/admin_bootstrap.py`
- Create: `backend/auth/service_integrations.py`
- Create: `backend/admin/seed_service_credential.py`
- Create: `backend/routes/admin_routes.py`
- Modify: `backend/routes/auth_routes.py`
- Test: `tests/test_service_integrations.py`
- Test: `tests/test_db_admin_bootstrap.py`
- Test: `tests/test_db_admin_routes.py`

- [ ] Bootstrap the first admin only from `ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS` and only while the workspace has zero admins.
- [ ] Test that another Atlassian `account_id` cannot bootstrap admin even when it has the same email address.
- [ ] Add admin-only `GET /api/admin/users`, `GET /api/admin/users/<id>`, and `GET /api/admin/audit-events`. Add mutation route stubs for `PATCH /api/admin/users/<id>/status`, `POST /api/admin/users/<id>/admin-grant`, and `DELETE /api/admin/users/<id>/admin-grant` only if they return a non-success response such as `501 csrf_not_ready` until Task 6 enables token-bound CSRF.
- [ ] Add admin-only service-integration read routes and the operator seeding CLI in this task. Do not expose browser-callable create, rotate, disable, delete, admin-grant, admin-revoke, or user-status mutation routes until Task 6's token-bound CSRF is implemented; if stubs are registered, unsafe methods must return a non-success response such as `501 csrf_not_ready`.
- [ ] Add `python3 -m backend.admin.seed_service_credential` for operator seeding into `service_integration_tokens` only.
- [ ] Test redacted admin responses, admin-only mutation, service-token storage separation, and cache invalidation on service integration `token_version` changes.
- [ ] Commit with `git commit -m "Add admin and service integration auth APIs"`.

### Task 6: Token-Bound CSRF And Visible Recovery Pages

**Files:**
- Create: `backend/auth/csrf.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `backend/routes/admin_routes.py`
- Modify: `jira_server.py`
- Test: `tests/test_csrf_token_bound.py`
- Test: `tests/test_db_auth_recovery_pages.py`

- [ ] Add a server-issued CSRF token endpoint such as `GET /api/auth/csrf`.
- [ ] Require `X-CSRF-Token` on every browser-originating `POST`, `PUT`, `PATCH`, and `DELETE` route for DB admin/config endpoints. Keep `X-Requested-With` only as an additional same-origin signal during transition.
- [ ] Test missing, wrong, reused, and cross-session tokens return `403 csrf_required`.
- [ ] Enable the browser-callable unsafe admin/service-integration mutation routes from Task 5 only in the same commit that adds passing token-bound CSRF tests for them.
- [ ] Add visible recovery pages outside `frontend/src/dashboard.jsx`: unauthenticated/expired login, disabled account, revoked connection/reconnect, missing project access, non-admin denial, and service credential admin area.
- [ ] Browser-verify the journeys listed in "Verification Criteria".
- [ ] Commit with `git commit -m "Add token-bound CSRF and auth recovery screens"`.

### Task 7: Jira Project Access, Cache Partitioning, And Home 3LO Gate Outcomes

**Files:**
- Create: `backend/auth/project_access.py`
- Modify: cache helpers that read Jira/Home-derived data
- Modify: `tests/test_oauth_jira_client_source_guard.py`
- Test: `tests/test_db_project_access.py`
- Test: `tests/test_cache_partitioning.py`
- Test: `tests/test_home_3lo_gate_outcomes.py`

- [ ] Add explicit project-access snapshots for configured product/tech projects without broad startup fan-out.
- [ ] Test product-only, tech-only, no-access, and unknown-access user states.
- [ ] Partition or disable every named cache surface: project search, components, epic search, labels, issue types, EPM issue payloads, EPM rollups, EPM Home project metadata, sprint caches, Home goal/project catalog cache, `sprints_cache.json`, and `stats_cache.json`.
- [ ] Invalidate affected caches on revoke, disable, reconnect, service-credential rotation, admin scope-project changes, and token-version changes.
- [ ] Test the Home GraphQL probe outcomes: `PASS` uses the DB auth boundary for Home 3LO, while `FAIL` keeps Home/Townsquare routes guarded or service-integration-scoped.
- [ ] Commit with `git commit -m "Partition Jira and Home caches by auth context"`.

### Task 8: Final DB Auth Verification

**Files:**
- Modify: PR notes only if a PR is created later

- [ ] Run `.venv/bin/python -m unittest discover -s tests`.
- [ ] Run `node tests/test_auth_isolation_source_guard.js`.
- [ ] Run source guards for DB token-store and direct Basic credential reads.
- [ ] Run `npm run build` if frontend auth recovery or admin surfaces changed.
- [ ] Measure initial dashboard bootstrap before and after the DB landing and record `Server-Timing` or request-count evidence; do not claim performance neutrality without measurement.
- [ ] Browser-verify unauthenticated entry, Atlassian/Microsoft login through Atlassian Cloud SSO, expired-session recovery, disabled-user screen, revoked-connection screen, missing-project-access state, non-admin denial, service-credential admin area, and focus/visibility refresh.
- [ ] Review `git log --oneline -5` before push.

## Token-Bound CSRF Upgrade Task

The current OAuth unsafe-method guard uses `X-Requested-With: jira-execution-planner`. That is sufficient for the local OAuth bridge but not enough for DB-backed browser admin/config endpoints.

Before any DB-backed browser mutation route ships:

- Add a server-issued CSRF token endpoint, for example `GET /api/auth/csrf`.
- Store only a token hash or session-bound nonce server-side.
- Require `X-CSRF-Token` on every browser-originating `POST`, `PUT`, `PATCH`, and `DELETE` route.
- Keep the old `X-Requested-With` requirement only as an additional same-origin signal during transition; it must not be the only CSRF proof for DB admin/config routes.
- Tests in `tests/test_csrf_token_bound.py` must prove missing, wrong, reused, or cross-session tokens fail with `403 csrf_required`.

## User Recovery UI Surfaces

Do not put auth recovery screens in `frontend/src/dashboard.jsx`. Add or keep backend-served lightweight pages or route-specific shells:

- `/login` in `backend/routes/auth_routes.py` for unauthenticated and expired-session recovery.
- `/account-disabled` in `backend/routes/auth_routes.py` for `account_disabled`.
- `/connection-revoked` in `backend/routes/auth_routes.py` for `auth_connection_revoked` and reconnect.
- `/access-required` in `backend/routes/auth_routes.py` for missing Jira project access.
- `/admin/service-integrations` in `backend/routes/admin_routes.py` or the existing settings/admin shell for admin-only service credential status and rotation.

Browser verification must cover every screen before DB auth is considered complete.

## Multi-User Cache Safety

Any cache that contains Jira/Home-derived data must be partitioned by the authorization or service-integration context that produced it.

At minimum, cache keys for issue/project/rollup data must include the `workspace_id` and either the `user_id` or a stable `auth_connection_id` plus token/access version. This prevents a user with broader Jira access from warming a process-wide cache that is later served to a user with narrower Jira access.

Shared caches are acceptable only for data that is both non-secret and independent of Jira/Home permissions. Until Home/Townsquare 3LO passes, Home/Townsquare metadata caches are workspace/service-integration scoped, not user-ACL scoped, and must not be used as proof of user Home visibility. Revoke, reconnect, project-access changes, service-credential rotation, and admin changes to scope projects must invalidate affected user/workspace/service cache entries.

Existing process caches that must be either auth-keyed or disabled for OAuth users include project search, component lookup, epic search, labels, issue types, EPM issue payloads, EPM rollups, EPM Home project metadata, sprint caches when the board/source is workspace-specific, `sprints_cache.json`, `stats_cache.json`, and any Home goal/project catalog cache. A cache key built only from project key, JQL, tab, sprint, Home project id, label prefix, or goal key is not sufficient in DB/OAuth mode.

Tests in `tests/test_cache_partitioning.py` must explicitly cover project search, component lookup, epic search, labels, issue types, EPM issue payloads, EPM rollups, EPM Home project metadata, sprint caches, `sprints_cache.json`, `stats_cache.json`, and Home goal/project catalog cache.

## Token Encryption And Refresh Model

Token storage must be designed before writing `auth_tokens`.

- Use envelope encryption. Generate a random data-encryption key per stored token value, encrypt token plaintext with `AES-256-GCM`, and wrap the data-encryption key with a configured key-encryption key.
- Production key source should be a KMS or secrets-manager key referenced by `TOKEN_ENCRYPTION_KEY_ID`. Local development may use `TOKEN_ENCRYPTION_MASTER_KEY_B64`, but production startup must reject local-only key material.
- Store `key_id`, `algorithm`, `nonce`, `wrapped_dek`, `ciphertext`, and an authenticated-data hash. Associated data must bind the token to `workspace_id`, `auth_connection_id`, `token_kind`, and `key_id`.
- Keep a keyring for reads: one primary key for new writes and zero or more retired keys for decrypt-only access during rotation.
- Rotation adds a new primary `key_id`, writes an audit event, rewraps data-encryption keys or re-encrypts tokens in batches, then marks the old key decrypt-only until no rows need it.
- Refresh uses a transaction and a per-connection lock, either `SELECT ... FOR UPDATE` on `auth_connections` or a PostgreSQL advisory lock keyed by `auth_connection_id`.
- During refresh, read and decrypt the current refresh token under the lock, call Atlassian, then atomically update access-token and refresh-token rows, `auth_connections.expires_at`, `auth_connections.status`, and increment `auth_connections.token_version`.
- If Atlassian returns a replacement refresh token, replace the old refresh token in the same transaction and hard-delete the previous refresh-token row before commit. Old refresh-token ciphertext must not remain as a usable secret.
- If the refresh response is a provider `4xx` indicating `invalid_grant`, `token_already_used`, or any equivalent refresh-token reuse/replay signal, do not retry. Mark the connection `revoked`, delete usable token rows in the same transaction, write a `connection_revoked` audit event with cause `refresh_reuse_detected`, and force re-authentication.
- If the provider response omits a refresh token, retain the previous one only if the provider contract allows that; otherwise mark the connection `error` and require reconnect.
- A stale concurrent refresh response must not overwrite newer token rows. Use the row lock plus token-version check to enforce this.
- Logs and audit events are redacted: never log plaintext tokens, ciphertext, wrapped data-encryption keys, OAuth authorization codes, PKCE verifiers, raw `Authorization` headers, or full callback URLs.

## Security Rules

- Never store tokens in browser localStorage, share URLs, or dashboard config payloads.
- Encrypt token values before database insert and store the encryption `key_id`.
- Store server-side API tokens only as service-integration secrets for dedicated service accounts; never store a normal user's personal Atlassian API token as shared app auth.
- Define token key source, `key_id` format, rotation procedure, and local-development behavior before storing production tokens.
- Store refresh-token replacements atomically and guard concurrent refreshes so an older refresh response cannot overwrite newer token material.
- Treat refresh-token reuse or replay signals as a connection revocation event, not as a transient refresh failure.
- Admin endpoints return token status only, never token ciphertext or plaintext.
- Revoke auth connections without deleting saved user identity.
- Enforce active user, current auth connection, admin-only configuration gates, and Jira project access checks in backend routes.
- Block disabled or deleted local users even if Atlassian OAuth succeeds.
- Require CSRF checks for all browser-originating state-changing routes, including admin and shared-config mutations.

## Verification Criteria

- Every supported auth/admin backend path has a named browser or dashboard journey that exercises it. Backend route tests are required but not sufficient for completion.
- User-journey verification covers unauthenticated entry, Atlassian/Microsoft login, authenticated bootstrap, admin access, non-admin denial, revoked/disabled user denial, at least one Jira data fetch through the authenticated user context, and Home/Townsquare metadata fetch behavior through the correct service-integration or future Home 3LO boundary.
- User-journey verification covers expired-session recovery: the user sees an actionable expired-auth screen and can start re-authentication without reading a backend JSON error.
- User-journey verification covers focus/visibility refresh: returning to an open tab attempts a safe refresh when needed, and refresh failure routes to the expired-auth recovery screen.
- PR notes include evidence for the relevant journey, such as screenshots or a concise browser-test transcript. Do not merge a faceless backend-only auth slice unless the plan explicitly marks it as developer-only and lists its manual verification path.
- `GET /api/me` returns the current user, current workspace/site, Jira project access status, and auth connection status without token material.
- All Jira routes construct and pass `RequestAuthContext`; Home/Townsquare routes pass `RequestAuthContext` for workspace/cache/audit scoping and resolve credentials from either the service-integration boundary or the future Home 3LO boundary. Source guards fail if routes call Jira/Home clients or caches directly from process globals.
- Every Jira/Home-derived cache is keyed by workspace plus auth context or service-integration context, or disabled for OAuth users.
- The Home GraphQL gate is run or documented with `scripts/check_home_graphql_oauth.py`: a `FAIL` result keeps Home/Townsquare routes guarded or service-integration-scoped; a `PASS` result permits user Home 3LO only through the DB `auth_connections` / encrypted `auth_tokens` boundary with DB refresh locking, `token_version`, revoked/disabled-user checks, and user/auth cache partitioning.
- OAuth login creates or updates a user by Atlassian `account_id`; an email change updates profile metadata and does not create another user.
- Inactive Atlassian accounts and disabled/deleted local users cannot create active sessions.
- Disabling a signed-in user terminates their next authenticated request within 30 seconds without process restart; the response is `401 account_disabled` and no user-scoped Jira call or Home/Townsquare-backed route response runs.
- Revoking an auth connection terminates that user's next authenticated Jira request or Home/Townsquare-backed route response within 30 seconds without process restart; the response is `401 auth_connection_revoked`.
- First admin bootstrap succeeds only for configured Atlassian account ids and only while the workspace has zero admins.
- Later admin grant/revoke actions require an existing admin and create audit events.
- Non-admin users cannot mutate selected projects, board config, capacity, field mapping, priority weights, team/group config, issue-type config, or EPM config.
- Non-admin users cannot mutate Home/Townsquare-backed or Jira-project-backed EPM/APM configuration, even when they can read the resulting view.
- Token encryption tests prove tokens are not stored as plaintext, use the configured `key_id`, decrypt with retired keys during rotation, and redact logs.
- Service-integration tests prove only admins/operators can create, rotate, disable, or revoke `jira_basic` and `home_townsquare_basic` credentials.
- Service-token storage tests prove Basic/Home API tokens are stored only in `service_integration_tokens`, never as normal-user `auth_tokens`.
- Service-token encryption tests prove associated data binds ciphertext to `workspace_id`, `service_integration_id`, `token_kind`, and `key_id`.
- Admin API tests prove service-token plaintext, ciphertext, wrapped keys, and credential env names never appear in admin responses.
- Service-credential rotation tests prove affected Home/Townsquare and Jira-derived service caches are invalidated by service integration `token_version` changes.
- JSON fallback compatibility tests prove `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` return identical non-secret payloads before import, after import, and after rollback to JSON mode.
- Concurrent refresh tests prove one refresh updates tokens, deletes the previous refresh-token row, and increments `token_version` while stale refresh attempts cannot overwrite newer token material.
- Refresh-reuse tests prove `invalid_grant` or provider reuse signals revoke the connection, delete usable tokens, write a redacted `connection_revoked` audit event with cause `refresh_reuse_detected`, and do not retry.
- Data for one environment/Jira workspace cannot be read with another environment/workspace context.
- Admin user detail shows user id, provider id, created-by, timestamps, status, Jira project access status, and auth connection status.
- A user with product-only, tech-only, or no configured Jira project access receives explicit access states instead of leaked cached data or generic Jira failures.
- Revoking an auth connection prevents future user-scoped Jira calls and prevents Home/Townsquare-backed responses from being served through that user session. Workspace service metadata warmers may still run only through service integrations and must not expose data to a revoked user session.
- Existing dashboard config endpoints still return the same non-secret payloads as before this phase.
- Initial dashboard bootstrap remains one compact user/auth request plus the existing scoped data requests.
