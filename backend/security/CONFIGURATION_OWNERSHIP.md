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
| Derived Team name directory | `workspace_team_catalogs` | `authenticated_read` | Authenticated `user_write` for names only; catalog refresh may merge discovered names | One shared name directory per workspace; names do not grant Sprint membership or mutate administrator settings |
| Derived Sprint catalog | `workspace_sprint_catalogs` | `authenticated_read` | Authenticated Jira refresh runtime only | Shared per workspace and configured Jira source Board; complete validated empty lists are authoritative |
| Derived per-Sprint Team membership | `workspace_sprint_team_catalogs` | `authenticated_read` | Authenticated Jira refresh runtime only | Shared per workspace and Sprint, but valid only for the persisted effective-scope digest; membership is distinct from Team names |
| Workspace user directory and tool-admin grants | `users`, `auth_connections` (via `/api/admin/users*`) | Explicit tool admin only, regardless of `SETTINGS_ADMIN_ONLY` | `tool_admin`, explicit tool admin only | Non-admins never read other users; the only exposure is `adminContacts` (tool-admin display names) in `/api/config` while the workspace is unconfigured |
| ENG Sprint review definitions and custom cells | `workspace_sprint_reviews`, `sprint_review_cells` | Authenticated workspace users, cells additionally require current-user Jira issue authorization | `user_write` with requested-with and CSRF | Shared per workspace + Sprint; independent Epic/Story cells use immutable Jira IDs; Team/Department are filters, never storage keys |
| Debug load observations | `load_performance` | Explicit tool admin in the current workspace/environment | Authenticated `user_write`, debug-enabled only | Derived operational history, retained 30 days; workspace identity comes from auth context, never the browser payload; no configuration or issue content |

## Exact Boundaries

Administrator settings contain workspace Jira planning inputs: selected Jira projects, Jira source
board, capacity mapping, Jira field mappings, priority weights, and dashboard issue-type
configuration outside EPM.
They do **not** contain EPM settings, department groups, group preferences, personal view state,
connections, credentials, or derived catalog payloads. The selected Jira source Board, projects,
Sprint/Team fields, and base JQL remain administrator inputs; they identify derived catalogs but do
not transfer catalog ownership into administrator configuration.

In DB/OAuth mode, `resolve_effective_catalog_config` also reports `missing_admin_settings`: `scope`
when no selected projects and no `JQL_QUERY` exist, and `source` when no numeric Jira source Board
resolves. `/api/config` returns it as `adminSettingsMissing`; while it is non-empty the dashboard starts
no ENG Jira work, opens Admin settings for editors, and shows non-editors the `adminContacts` display
names (never emails or ids). Basic and JSON-file modes do not report it.

In DB/OAuth mode, `resolve_effective_catalog_config` is the canonical resolver for Sprint and Team
catalog identity. Sprint rows are keyed by `workspace_id + board_id`. Per-Sprint Team rows are keyed
by `workspace_id + sprint_id`, and their validated payload is usable only when `scope_digest` matches
the effective Board/projects/base-JQL/Team-field scope. `workspace_team_catalogs` remains the separate
workspace-wide name directory. A Team name from that directory or loaded Jira work never proves that
the Team belongs to the selected Sprint.

Catalog claim and publication share the workspace configuration advisory fence with administrator
configuration updates, capacity updates, and legacy promotion. Publication re-resolves the effective
configuration and revalidates the authenticated refresh actor, including the BrowserSession lock,
before atomically replacing a complete payload. A complete validated empty list is therefore a real
snapshot that clears old choices. A failed refresh keeps a matching prior validated snapshot and its
version while recording failure metadata; it never publishes partial discovery as membership.

Browser persistence is display-only until a response with matching server-produced catalog identity,
browser context, validation timestamp, and catalog version establishes authority in the current
document. Catalog completion reads are bound to the original attempt and identity, are bounded by the
server attempt deadline and browser lifecycle, and cannot be combined with a forced refresh. Auth,
Board, effective-scope, or document-generation changes retire stale completion work.

Department group configuration is deliberately collaborative. A non-admin user must be able to
read and save `/api/groups-config`. Concurrent saves use `configRevision` and return `409` rather
than silently overwriting another user's change. Department board layouts belong to this shared
group payload; they are distinct from the administrator-owned Jira source board.

The shared group payload's `teamLabels` field is `Record<TeamId, JiraLabel[]>`: each configured
Team maps to zero to three ordered, case-insensitively distinct Jira Epic-label aliases (any alias
matches the Team). The payload version for this shape is `2` (`GROUPS_PAYLOAD_VERSION` /
`GROUPS_CONFIG_VERSION`); a stored or imported legacy scalar label normalizes to a one-item array on
read without a write. This is a value-shape clarification only — ownership, read/write access, and
the collaborative-save contract above are unchanged. The unrelated personal group-preference row
(`user_group_preferences`) keeps its own `GROUP_PREFERENCES_PAYLOAD_VERSION = 1`.

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
import; an existing `workspace_team_catalogs` row is not replaced. Sprint and per-Sprint Team catalog
tables are populated only by their explicit migration/refresh paths, never inferred from private views
or group configuration. Misplaced EPM formerly stored in
`workspace_dashboard_configs` is removed into `workspace_epm_config_migration_archive`. The migration
does not infer a private owner, and downgrade restores the archived value without overwriting newer
administrator fields.

## ENG Sprint Reviews

ENG custom review definitions and cells use dedicated review tables, separate from administrator
configuration, Department groups, private views, and Scenario drafts. GET returns schema and
capabilities only. Batched values reads and saves authorize every requested immutable issue ID
through the current user's OAuth Jira REST context; workspace sharing never grants Jira access.
Inaccessible or nonexistent issues cannot expose saved cells. No Basic, service integration, Home,
or local token-store fallback is supported. Other profiles return saving-unavailable guidance.

A workspace/Sprint parent-row transaction fence protects first-create, schema, and cell races.
Schema changes require the current schema revision. Cell changes require only their own current
revisions, so disjoint saves may succeed despite another user's cell changes. Conflicts roll back
the complete transaction. Archived column definitions and values retain their immutable identity.
Bounds are 30 active columns per row kind, 100 changed cells, 500 read issues, 256 KiB requests,
1 MiB responses, and ten enhanced Jira search pages within a cooperative fifteen-second budget.
No request can return partially authorized data. Browser-supplied workspace/user authority is rejected.

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

Sprint review column order and optional visibility are shared per workspace/Sprint/row kind in `WorkspaceSprintReview.layouts`, under the same authenticated-user save rights and optimistic schema revision as custom definitions. They are not private user preferences. Key/Summary remain pinned and required columns cannot be hidden.
