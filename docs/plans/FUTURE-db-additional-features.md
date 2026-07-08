# FUTURE: DB Additional Features Plan

> **Future scope:** Do not pull this plan forward into the first DB auth phase or the DB user-configuration phase. Execute only after those phases are complete, verified, and explicitly reopened for follow-up work.

## Goal

Define later database-backed features that become possible after database-backed auth and user configuration exist. These features should not be included in the first database or user-configuration implementation unless explicitly pulled into scope.

## Prerequisites

This plan depends on:

- `docs/plans/DONE-01-db-auth-foundation.md`
- `docs/plans/DONE-03-db-user-configuration.md`

## Future Feature Areas

### Shareable View Links

Users should be able to save a view, create a link, paste it into chat, and let another authenticated user open it if their request resolves to the same workspace/site and they can authorize against the configured Jira/Atlassian site.

This plan does not introduce workspace membership or workspace ACLs. Until a separate membership model exists, share-link access is gated by the resolved `workspace_id` / site context from `RequestAuthContext`, optional explicit Atlassian account allowlists, and Jira authorization checks.

Share links must never contain Jira tokens, OAuth tokens, API tokens, credential env names, or complete private configuration dumps.

Data model:

| Table | Purpose |
| --- | --- |
| `shared_view_links` | Stores a hashed opaque token, target view version, workspace/site gate, expiry, and revocation state. |
| `user_saved_views` | Tracks a recipient saving a shared view into their own configuration. |

Suggested `shared_view_links` columns:

| Column | Purpose |
| --- | --- |
| `id` | Share UUID. |
| `token_hash` | Hash of the opaque URL token. Store only the hash. |
| `view_config_id`, `version_id` | Shared view snapshot. |
| `created_by` | Link owner. |
| `access_scope` | `same_resolved_workspace_site` or `specific_atlassian_accounts`. |
| `workspace_id` | Resolved workspace/site required to open the link; not a membership ACL. |
| `allowed_atlassian_account_ids` | Optional list when `access_scope` is `specific_atlassian_accounts`. |
| `expires_at` | Optional expiry. |
| `revoked_at` | Revocation timestamp. |
| `created_at`, `last_used_at` | Lifecycle and usage. |

Link format:

```text
https://planner.example.com/share/v/<opaque-token>
```

Flow:

1. Owner saves a view configuration.
2. Owner clicks `Share`.
3. Backend validates that the owner's request resolves to the view's workspace/site and that the owner can authorize against the configured Jira/Atlassian site.
4. Backend creates `shared_view_links` with an opaque token and workspace/site access policy.
5. Owner pastes the link into chat.
6. Recipient opens the link.
7. If unauthenticated, recipient is redirected through auth and returned to the link.
8. Backend verifies the recipient's request resolves to the same workspace/site, matches any explicit Atlassian account allowlist, and can authorize against the configured Jira/Atlassian site.
9. Backend returns the shared view snapshot without exposing owner credentials.
10. Recipient can use it temporarily or save a private copy.

Failure behavior:

- Not logged in: redirect to login and preserve the share token in server-side state.
- Logged in but resolved to another workspace/site: `403 workspace_site_required`.
- Logged in but not in the explicit account allowlist: `403 share_recipient_not_allowed`.
- Logged in but unable to authorize against the configured site: `403 authorization_required`.
- Revoked or expired link: `404 share_not_found` or `410 share_expired`.

Future API:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/views/<id>/share` | Create or rotate a share link. |
| `GET /api/share/v/<token>` | Resolve a shared view after auth and workspace/site checks. |
| `POST /api/share/v/<token>/save` | Save the shared view as the current user's private copy. |

Verification:

- A share URL contains only an opaque token and no serialized config or secret values.
- Users whose request resolves to a different workspace/site cannot open workspace/site-gated links.
- A user opening a shared view must be able to authorize against the configured Jira/Atlassian site.
- Revoking a share prevents new opens but does not delete recipient-owned saved copies.

### Safer EPM Project Metadata Caching

The database can store Home project metadata cache rows keyed by workspace, service integration, root goal, sub-goal, lifecycle tab, and cache version. Until the Home GraphQL 3LO gate passes, this cache is service-credential-backed app metadata and must not be treated as proof of user-level Home/Townsquare visibility. If Home/Townsquare user 3LO later becomes supported, follow `docs/plans/SUPPORT-epm-home-oauth-migration.md` and add user/auth-context cache partitioning before serving Home metadata as user-scoped data. This should be done only after measuring that database caching reduces Jira/Home fan-out without making first load stale or harder to reason about.

This feature must preserve lessons from:

- `docs/postmortem/MRT014-epm-cold-load-cache-race.md`
- `docs/postmortem/MRT015-epm-first-load-home-fanout-overfetch.md`

Verification:

- Cold-load request count and response timings do not regress.
- Cache keys include the visible lifecycle scope.
- Cache keys include service integration version, or user auth context only after the Home/Townsquare 3LO gate passes.
- Jira/Home remains the source of truth.

### Background Jobs

Token refresh, cache warming, and link-expiry cleanup can run as jobs with visible status instead of being hidden inside page-load requests.

Potential tables:

| Table | Purpose |
| --- | --- |
| `background_jobs` | Job type, target id, status, attempts, timestamps, and last error. |
| `job_locks` | Optional distributed locking if multiple server workers run jobs. |

Verification:

- Page-load requests do not synchronously perform cache warming work.
- Failed jobs expose enough status for admin diagnosis without logging secrets.

### Team And Project Catalog Governance

Generated local caches like `team-catalog.json` can become workspace-scoped tables with explicit provenance, timestamps, and refresh status. This reduces accidental divergence across users.

Verification:

- Catalog data is scoped by workspace.
- Refresh provenance is visible.
- No real Jira fixture data is committed in tests.

### Product Analytics Without Jira Replication

The database can track app-level usage such as active saved views, slow endpoint timings, share-link usage, and configuration churn. This helps prioritize performance work without storing full Jira issue content.

Verification:

- Analytics events do not include token material.
- Jira issue content is excluded unless a later analytics feature defines retention, privacy, and deletion rules.
- Performance data can identify slow endpoints without storing private Jira payloads.
