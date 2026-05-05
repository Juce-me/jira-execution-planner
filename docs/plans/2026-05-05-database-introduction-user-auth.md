# Database Introduction And User Auth Plan

## Goal

Introduce a database-backed identity and auth foundation for Jira Execution Planner without changing the current dashboard configuration model yet. This phase creates the storage boundary needed for authenticated users, workspace selection, encrypted integration tokens, and admin user inspection.

## Scope

This phase includes:

- Database connection and migration tooling.
- User records.
- Workspace records.
- Workspace membership and selection.
- Per-user auth connection metadata.
- Encrypted token storage.
- Admin inspection of user properties.

This phase does not include:

- Per-user saved dashboard configurations.
- Shareable view links.
- Role-specific ENG/EPM authorization. ENG/EPM behavior comes from the selected configuration in the later user-configuration phase, not from user roles.
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

## Recommended Approach

Use PostgreSQL for production because this feature needs concurrent users, transactions, constraints, encrypted token metadata, and reliable migrations. SQLite can be used for local development tests only, but it should not be the production sharing or auth store.

The first database slice should be deliberately narrow:

- Store who the user is.
- Store which workspace they can use.
- Store connection status and encrypted auth token material.
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

There are only two account types: `user` and `admin`. A normal user can authenticate and use accessible workspaces. An admin can choose or assign workspace access and inspect user properties such as user id, provider id, created-by, created-at, status, last-seen, workspace membership, and auth connection status.

### `workspaces`

One row per configured Jira/Atlassian site or deployment scope.

| Column | Purpose |
| --- | --- |
| `id` | Workspace UUID. |
| `name` | Human-readable workspace name. |
| `jira_site_url` | Normalized Jira site URL. |
| `jira_cloud_id` | Atlassian cloud id when OAuth is used. |
| `created_by`, `created_at`, `updated_at` | Ownership and lifecycle. |

### `workspace_memberships`

Assignment of users to the workspace configuration they can use.

| Column | Purpose |
| --- | --- |
| `user_id` | User assigned to the workspace. |
| `workspace_id` | Workspace the user can open. |
| `is_default` | Whether this workspace opens by default for the user. |
| `created_by`, `created_at`, `revoked_at` | Auditability. |

Admin workspace control stops here in this phase. Admins choose or assign workspace access; they do not assign separate `dev_lead` or `epm` roles.

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

## API Surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/me` | Current user, account type, workspaces, selected workspace, auth connection status. |
| `PATCH /api/me/workspace` | Select the user's active workspace from their memberships. |
| `GET /api/auth/connections` | List connection statuses only. |
| `DELETE /api/auth/connections/<id>` | Revoke a stored connection. |
| `GET /api/admin/users` | Admin-only list of user properties and workspace assignments. |
| `GET /api/admin/users/<id>` | Admin-only user detail: ids, creator, timestamps, status, workspace membership, and auth connection status. |
| `PATCH /api/admin/users/<id>/workspace` | Admin-only workspace assignment. |

Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` continue reading the current JSON-backed configuration during this phase.

## Migration Plan

1. Add database connection config and migration tooling.
2. Create `users`, `workspaces`, `workspace_memberships`, `auth_connections`, and `auth_tokens`.
3. Bootstrap one workspace from the current configured Jira site.
4. Create or upsert the current authenticated user on login.
5. Store OAuth connection metadata and encrypted refresh tokens in the database.
6. Keep Basic API-token mode local-only unless there is a clear requirement to store API tokens server-side.
7. Add admin user inspection endpoints.

## Security Rules

- Never store tokens in browser localStorage, share URLs, or dashboard config payloads.
- Encrypt token values before database insert and store the encryption `key_id`.
- Admin endpoints return token status only, never token ciphertext or plaintext.
- Revoke auth connections without deleting saved user identity.
- Enforce workspace access in backend routes.

## Verification Criteria

- `GET /api/me` returns the current user, selected workspace, and auth connection status without token material.
- Admin user detail shows user id, provider id, created-by, timestamps, status, workspace membership, and auth connection status.
- Revoking an auth connection prevents future Jira/Home calls for that user.
- Existing dashboard config endpoints still return the same non-secret payloads as before this phase.
- Initial dashboard bootstrap remains one compact user/auth request plus the existing scoped data requests.

