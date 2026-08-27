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
| EPM settings and EPM view state | Current user's private `view_configs` payload | Current user | `user_write` | Private to the owning user and saved view; never stored in workspace administrator configuration |
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

EPM configuration belongs to the current user's private saved view. This includes EPM goal scope,
label prefix, EPM issue-type grouping, project-label mappings, selected EPM tab, and selected sprint.
`/api/epm/config` must read and update only that user's view payload, preserve unrelated private view
fields, and never require tool-admin permission. EPM Home/Townsquare reads continue to use that
user's connected credential and user-partitioned caches.

## HTTP Meaning

- `401` means authentication or connection recovery is required. It must not mean "not an admin."
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
6. Frontend tabs, edit gates, save payloads, and auth recovery match backend permissions.
7. Tests cover two users in one workspace, two workspaces, non-admin access, `401` versus `403`,
   concurrency, and preservation of unrelated private/shared fields.
8. Migrations do not infer private-to-shared ownership or publish one user's configuration to others.
