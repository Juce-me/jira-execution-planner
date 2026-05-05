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

Do not implement this database phase until the Jira/Home auth-client boundary exists.

The phase assumes backend Jira/Home calls can resolve the current request's authenticated user, auth connection, workspace/site, and headers without reading process-global `JIRA_EMAIL` / `JIRA_TOKEN` directly in every route. Either complete `docs/plans/2026-04-27-atlassian-oauth-auth.md` first or add an equivalent centralized auth/client layer before database-backed identity work starts.

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
| `external_subject` | Stable provider user/account id. |
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
| `name` | Human-readable workspace name. |
| `jira_site_url` | Normalized Jira site URL. |
| `jira_cloud_id` | Atlassian cloud id when OAuth is used. |
| `created_by`, `created_at`, `updated_at` | Ownership and lifecycle. |

This table is not an access-control list in this phase. Jira project permissions come from Jira, not from Jira Execution Planner workspace membership.

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
| `ciphertext` | Encrypted token value. |
| `key_id` | Encryption key identifier for rotation. |
| `expires_at` | Token expiry when known. |
| `rotated_at`, `revoked_at` | Secret lifecycle. |

Frontend APIs should receive only status such as `authenticated`, `provider`, `expiresAt`, and `needsReconnect`.

## Admin Configuration Access

Admin-only configuration areas:

- Scope projects, including product/tech project selection.
- Jira source, including site, board, and query source settings.
- Field mapping.
- Capacity.
- Priority weights.

All other settings/configuration tabs remain available to all authenticated users. Normal users can still receive the effective non-secret configuration needed to render the dashboard, but they cannot edit the admin-only shared configuration areas.

Do not model this as separate `dev_lead` or `epm` roles. Admin access controls shared configuration and user inspection only.

## API Surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/me` | Current user, account type, current workspace/site, Jira project access status, auth connection status. |
| `GET /api/auth/connections` | List connection statuses only. |
| `DELETE /api/auth/connections/<id>` | Revoke a stored connection. |
| `GET /api/admin/users` | Admin-only list of user properties, Jira project access, and auth connection status. |
| `GET /api/admin/users/<id>` | Admin-only user detail: ids, creator, timestamps, status, Jira project access, and auth connection status. |
| `GET /api/admin/config` | Admin-only shared configuration summary for scope projects, Jira source, field mapping, capacity, and priority weights. |

Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` continue reading the current JSON-backed configuration during this phase.

## Migration Plan

1. Add database connection config and migration tooling.
2. Create `users`, `workspaces`, `auth_connections`, `auth_tokens`, and `jira_project_access`.
3. Bootstrap one workspace from the current configured Jira site.
4. Create or upsert the current authenticated user on login.
5. Store OAuth connection metadata and encrypted refresh tokens in the database.
6. Validate configured Jira project access for the user's auth connection without adding heavy startup fan-out.
7. Keep Basic API-token mode local-only unless there is a clear requirement to store API tokens server-side.
8. Add admin user inspection endpoints.
9. Gate only the admin-only shared configuration areas; keep all other configuration tabs available to authenticated users.

## Multi-User Cache Safety

Any cache that contains Jira/Home-derived data must be partitioned by the authorization context that produced it.

At minimum, cache keys for issue/project/rollup data must include the `workspace_id` and either the `user_id` or a stable `auth_connection_id` plus token/access version. This prevents a user with broader Jira access from warming a process-wide cache that is later served to a user with narrower Jira access.

Shared caches are acceptable only for data that is both non-secret and independent of Jira/Home permissions. Revoke, reconnect, project-access changes, and admin changes to scope projects must invalidate affected user/workspace cache entries.

## Security Rules

- Never store tokens in browser localStorage, share URLs, or dashboard config payloads.
- Encrypt token values before database insert and store the encryption `key_id`.
- Define token key source, `key_id` format, rotation procedure, and local-development behavior before storing production tokens.
- Store refresh-token replacements atomically and guard concurrent refreshes so an older refresh response cannot overwrite newer token material.
- Admin endpoints return token status only, never token ciphertext or plaintext.
- Revoke auth connections without deleting saved user identity.
- Enforce active user, current auth connection, admin-only configuration gates, and Jira project access checks in backend routes.

## Verification Criteria

- `GET /api/me` returns the current user, current workspace/site, Jira project access status, and auth connection status without token material.
- Admin user detail shows user id, provider id, created-by, timestamps, status, Jira project access status, and auth connection status.
- A user with product-only, tech-only, or no configured Jira project access receives explicit access states instead of leaked cached data or generic Jira failures.
- Revoking an auth connection prevents future Jira/Home calls for that user.
- Existing dashboard config endpoints still return the same non-secret payloads as before this phase.
- Initial dashboard bootstrap remains one compact user/auth request plus the existing scoped data requests.
