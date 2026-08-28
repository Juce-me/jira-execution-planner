# Configuration Ownership And Access Contract

Read this contract before changing configuration persistence, database models or migrations,
endpoint policies, Settings visibility, or configuration save flows. Storage scope, read access,
write access, bootstrap precedence, and frontend edit gates must change together.

## Ownership Matrix

| Configuration | Canonical storage | Read access | Write access | Sharing rule |
| --- | --- | --- | --- | --- |
| Administrator settings | `workspace_dashboard_configs` | Authenticated workspace users | `shared_admin_write` | One effective value per workspace; only tool admins configure it when `SETTINGS_ADMIN_ONLY=true` |
| Department groups, group labels, memberships, exclusions, and department board layouts | `workspace_group_configs` | `authenticated_read` | `user_write` | One shared catalog per workspace; every authenticated user sees and may configure it |
| Group visibility, favorite/star, and active group | `user_group_preferences` | Current user | `user_write` | Private to one user in one workspace; never copied into shared group configuration |
| EPM scope, label prefix, issue types, and project-label mappings | Current user's default private `view_configs` payload | Current user | `user_write` | Private to the owning user; never stored in workspace administrator configuration |
| EPM tab and selected sprint UI state | Private browser preferences; preserve existing private-view values | Current user | Current user only | Never stored in workspace administrator or shared group configuration |
| Personal connections and tokens | User-owned auth connection/token tables | Current user | `user_write` | Private credentials; never configuration payload fields |
| Derived team catalog | `workspace_team_catalogs` | `authenticated_read` | `user_write` | Shared workspace cache refreshed by authenticated users; cannot mutate administrator settings |

## Exact Boundaries

Administrator settings contain workspace Jira planning inputs: selected Jira projects, Jira source
board, capacity mapping, Jira field mappings, priority weights, and dashboard issue-type
configuration outside EPM.
They do **not** contain EPM settings, department groups, group preferences, personal view state,
connections, credentials, or the derived team catalog.

Department group configuration is deliberately collaborative. A non-admin user must be able to
read and save `/api/groups-config`. Concurrent saves use `configRevision` and return `409` rather
than silently overwriting another user's change. Department board layouts belong to this shared
group payload; they are distinct from the administrator-owned Jira source board.

Stars/favorites are represented by the current user's group preferences (`visibleGroupIds` and
`activeGroupId`). They must not update shared `defaultGroupId` or any workspace group row.

EPM configuration belongs to the current user's default private saved view. This includes EPM goal
scope, label prefix, EPM issue-type grouping, and project-label mappings. `/api/epm/config` must read
and update only those settings in that user's view payload, preserve unrelated private view fields and
any existing private EPM tab/sprint state, and never require tool-admin permission. Dashboard UI choices
that remain in private browser preferences must never be promoted to workspace configuration. EPM
Home/Townsquare reads continue to use that user's connected `atlassian_user_api_token`, represented by
`auth_connections` and encrypted in `auth_tokens`; Jira REST continues to use the user's OAuth context.

Every projects, issues, and rollup cache key includes a SHA-256 digest of the canonical normalized
five-key EPM settings object. The digest, never raw configuration text, supplements the existing
workspace/user/token partition. A mutation that changes the effective default EPM configuration evicts
only that current partition, and only after its database transaction commits. Non-default or metadata-
only edits, no-ops, conflicts, validation failures, exhausted retries, and rollbacks do not invalidate.

Legacy import sends EPM only to the importing user's default private view and group definitions only to
the shared workspace group payload. Top-level `teamCatalog` is a derived cache and is discarded during
import; an existing `workspace_team_catalogs` row is not replaced. Misplaced EPM formerly stored in
`workspace_dashboard_configs` is removed into `workspace_epm_config_migration_archive`. The migration
does not infer a private owner, and downgrade restores the archived value without overwriting newer
administrator fields.

## HTTP Meaning

- Every application API `401` means the current document requires authentication recovery. The frontend
  must enter one global blocking auth-required state, preserve mounted drafts, and offer a sanitized
  same-origin sign-in action. Feature and Settings panels must never render raw `401` text.
- `401` must not mean "not an admin." The lock is terminal for the current document; same-tab sign-in
  creates a newly bootstrapped document, and failed writes are never replayed automatically.
- `403 admin_required` is reserved for authenticated users attempting administrator-only writes.
- Shared group writes and user-owned EPM writes require authenticated `user_write` plus the normal
  requested-with and token-bound CSRF checks, but no administrator check.
- `409` represents a revision conflict and must preserve the losing user's unsaved draft.

## Change Checklist

Before merging a database, rights, or configuration change, verify all of these together:

1. The model/table key matches the ownership scope (`workspace_id`, or `workspace_id + user_id`).
2. Route policies match the matrix above for both reads and writes.
3. Request identity comes from `RequestAuthContext`, never the payload.
4. `/api/config` and section GET routes resolve the same canonical source.
5. Private payloads cannot override workspace settings, and workspace payloads cannot absorb private state.
6. Frontend tabs, edit gates, save payloads, and the global auth-required lock match backend permissions.
7. Tests cover two users in one workspace, two workspaces, non-admin access, `401` versus `403`,
   concurrency, and preservation of unrelated private/shared fields.
8. Migrations do not infer private-to-shared ownership or publish one user's configuration to others.
