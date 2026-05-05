# Database Introduction And User Auth Plan

## Goal

Introduce a database-backed identity and auth foundation for Jira Execution Planner without changing the current dashboard configuration model yet. This phase creates the storage boundary needed for authenticated users, the configured workspace/site context, encrypted integration tokens, and admin user inspection.

## Scope

This phase includes:

- Database connection and migration tooling.
- User records.
- Workspace record for the configured Jira/Atlassian site.
- Per-user auth connection metadata.
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

## Current Constraints

- Runtime dashboard configuration is currently stored in local JSON files, mainly `dashboard-config.json`, `team-groups.json`, and `team-catalog.json`.
- Credentials are intentionally outside committed files and currently belong in `.env` or the local OAuth session path described in `docs/superpowers/specs/2026-04-27-atlassian-oauth-auth-design.md`.
- Initial dashboard load is performance-critical. This phase must not add extra heavy startup requests.
- Admin views must not expose token material.

## Related Repo Context

- `docs/plans/2026-04-27-atlassian-oauth-auth.md` defines the first OAuth slice and intentionally defers production multi-user persistence.
- `docs/features/epm-view.md` documents current EPM config shape and exact-label rollup behavior that later phases must preserve.
- `postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md` and `postmortem/MRT015-epm-first-load-home-fanout-overfetch.md` show why database-backed bootstrapping must stay compact and measured.

## Blocker

Do not implement this database phase until the Jira/Home auth-client boundary exists and the OAuth slice has closed the local-only safety gaps.

The phase assumes backend Jira/Home calls can resolve the current request's authenticated user, auth connection, workspace/site, and headers without reading process-global `JIRA_EMAIL` / `JIRA_TOKEN` directly in every route. Before starting this phase, the OAuth slice must also serialize refresh-token replacement, return `route_not_oauth_ready`/501 for un-migrated API routes in `JIRA_AUTH_MODE=atlassian_oauth`, and disable or auth-key Jira/Home process caches for OAuth users. Either complete `docs/plans/2026-04-27-atlassian-oauth-auth.md` first or add an equivalent centralized auth/client layer with those same gates before database-backed identity work starts.

## Security Preconditions

Before this database phase starts, the OAuth slice must settle these items:

- Fetch `https://api.atlassian.com/me` during OAuth callback and use Atlassian `account_id` as the stable external subject. Email and display name are mutable profile metadata and must not be used as identity keys.
- Reject inactive Atlassian accounts before creating or updating local user records.
- Use PKCE S256 in the Atlassian authorization-code flow, with one-time `state` and `code_verifier` cleanup on callback success or failure.
- Keep the process-local `OAUTH_TOKEN_STORE` local-only. It must require both `APP_ENVIRONMENT_KEY=local` or `dev` and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`; production database auth must hard-fail if it would use that store instead of encrypted database tokens.
- Serialize local OAuth refresh per session and re-read token state inside the lock before calling Atlassian. The database refresh path can then replace this with `SELECT ... FOR UPDATE` or an advisory lock without changing the caller contract.
- Make unsupported OAuth route surface explicit. Until a route is migrated through the auth/client boundary, `JIRA_AUTH_MODE=atlassian_oauth` must return `route_not_oauth_ready`/501 instead of falling through to empty Basic credentials.
- Define session cookie, CORS, and CSRF policy before exposing DB-backed admin/config mutation endpoints: `HttpOnly`, `SameSite=Lax`, `Secure` outside local HTTP development, a restricted origin allowlist, and CSRF checks for state-changing browser routes.
- Partition or disable every Jira/Home-derived cache for OAuth users before multiple users can share a process.
- Define and use `RequestAuthContext` for all Jira/Home clients and caches. Routes must not reach into global auth state after this boundary exists.

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

All Jira and Home client entry points must take `RequestAuthContext` as an explicit argument. Cache helpers must also take this context and use it in cache keys. This includes Jira issue searches, project/field/label/board lookups, Home goal/project fetches, EPM rollups, and generated project metadata caches.

The database phase must not add new DB-backed routes that still call `build_jira_headers()`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_URL`, `fetch_home_*`, or process caches directly from route globals. Any remaining Basic-mode compatibility wrapper should first build a `RequestAuthContext`, then call the same Jira/Home client boundary.

On every authenticated request, the auth context resolver reads `users.status` and `auth_connections.status` from the database before issuing Jira/Home calls. Do not cache these statuses beyond the request by default. The only acceptable optimization is a per-process status cache with a maximum 30-second TTL, keyed by `(user_id, auth_connection_id, token_version)`, and invalidated immediately by admin enable/disable, admin grant/revoke, connection revoke, and reconnect events. Any non-active user or connection returns `401` with a stable error such as `account_disabled` or `auth_connection_revoked` before Jira/Home calls run.

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

### `audit_events`

Append-only security and admin event log. Events must not contain token material, OAuth codes, PKCE verifiers, raw authorization headers, or full callback URLs.

| Column | Purpose |
| --- | --- |
| `id` | Event UUID. |
| `workspace_id` | Workspace scope. |
| `actor_user_id` | User who caused the event, nullable for system/bootstrap events. |
| `target_user_id` | Affected user when applicable. |
| `auth_connection_id` | Affected connection when applicable. |
| `event_type` | `login_success`, `login_failure`, `token_refresh_success`, `token_refresh_failure`, `connection_revoked`, `admin_granted`, `admin_revoked`, `user_disabled`, `user_enabled`, `config_write`, `key_rotation_started`, `key_rotation_completed`. |
| `metadata` | Redacted JSON metadata: status code, sanitized provider error code, project key, config section, or key id. |
| `created_at` | Event timestamp. |

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
| `GET /api/admin/audit-events` | Admin-only redacted security/admin event log. |

Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` continue reading the current JSON-backed configuration during this phase.

## Migration Plan

1. Add database connection config and migration tooling.
2. Create `users`, `workspaces`, `auth_connections`, `auth_tokens`, `jira_project_access`, and `audit_events`.
3. Bootstrap one workspace from the current configured Jira site.
4. Create or upsert the current authenticated user on login by `(external_provider, external_subject)` from the Atlassian `account_id`; update changed email/display-name fields without creating a duplicate user.
5. Resolve every request into `RequestAuthContext` and pass it to Jira/Home clients and cache helpers.
6. Store OAuth connection metadata and encrypted refresh tokens in the database.
7. Validate configured Jira project access for the user's auth connection without adding heavy startup fan-out.
8. Keep Basic API-token mode local-only unless there is a clear requirement to store API tokens server-side.
9. Add admin bootstrap, admin user inspection, admin grant/revoke, user lifecycle, and audit-event endpoints.
10. Gate only the admin-only shared configuration areas; keep all other configuration tabs available to authenticated users.

## Multi-User Cache Safety

Any cache that contains Jira/Home-derived data must be partitioned by the authorization context that produced it.

At minimum, cache keys for issue/project/rollup data must include the `workspace_id` and either the `user_id` or a stable `auth_connection_id` plus token/access version. This prevents a user with broader Jira access from warming a process-wide cache that is later served to a user with narrower Jira access.

Shared caches are acceptable only for data that is both non-secret and independent of Jira/Home permissions. Revoke, reconnect, project-access changes, and admin changes to scope projects must invalidate affected user/workspace cache entries.

Existing process caches that must be either auth-keyed or disabled for OAuth users include project search, component lookup, epic search, labels, issue types, EPM issue payloads, EPM rollups, EPM Home project metadata, sprint caches when the board/source is workspace-specific, and any Home goal/project catalog cache. A cache key built only from project key, JQL, tab, sprint, Home project id, label prefix, or goal key is not sufficient in DB/OAuth mode.

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
- User-journey verification covers unauthenticated entry, Atlassian/Microsoft login, authenticated bootstrap, admin access, non-admin denial, revoked/disabled user denial, and at least one Jira/Home data fetch through the authenticated context.
- PR notes include evidence for the relevant journey, such as screenshots or a concise browser-test transcript. Do not merge a faceless backend-only auth slice unless the plan explicitly marks it as developer-only and lists its manual verification path.
- `GET /api/me` returns the current user, current workspace/site, Jira project access status, and auth connection status without token material.
- All Jira/Home routes construct and pass `RequestAuthContext`; source guards fail if routes call Jira/Home clients or caches without context.
- Every Jira/Home-derived cache is keyed by workspace and auth context or disabled for OAuth users.
- OAuth login creates or updates a user by Atlassian `account_id`; an email change updates profile metadata and does not create another user.
- Inactive Atlassian accounts and disabled/deleted local users cannot create active sessions.
- Disabling a signed-in user terminates their next authenticated request within 30 seconds without process restart; the response is `401 account_disabled` and no Jira/Home call runs.
- Revoking an auth connection terminates that user's next authenticated Jira/Home request within 30 seconds without process restart; the response is `401 auth_connection_revoked`.
- First admin bootstrap succeeds only for configured Atlassian account ids and only while the workspace has zero admins.
- Later admin grant/revoke actions require an existing admin and create audit events.
- Non-admin users cannot mutate selected projects, board config, capacity, field mapping, priority weights, team/group config, issue-type config, or EPM config.
- Token encryption tests prove tokens are not stored as plaintext, use the configured `key_id`, decrypt with retired keys during rotation, and redact logs.
- Concurrent refresh tests prove one refresh updates tokens, deletes the previous refresh-token row, and increments `token_version` while stale refresh attempts cannot overwrite newer token material.
- Refresh-reuse tests prove `invalid_grant` or provider reuse signals revoke the connection, delete usable tokens, write a redacted `connection_revoked` audit event with cause `refresh_reuse_detected`, and do not retry.
- Data for one environment/Jira workspace cannot be read with another environment/workspace context.
- Admin user detail shows user id, provider id, created-by, timestamps, status, Jira project access status, and auth connection status.
- A user with product-only, tech-only, or no configured Jira project access receives explicit access states instead of leaked cached data or generic Jira failures.
- Revoking an auth connection prevents future Jira/Home calls for that user.
- Existing dashboard config endpoints still return the same non-secret payloads as before this phase.
- Initial dashboard bootstrap remains one compact user/auth request plus the existing scoped data requests.
