# Database User Configuration Plan

## Goal

Move dashboard and view configuration from one local file-backed model toward database-backed workspace defaults and user-owned saved views. This phase builds on `docs/plans/2026-05-05-database-introduction-user-auth.md`.

## Scope

This phase includes:

- Workspace default configuration.
- User-owned saved view configurations.
- ENG/EPM/mixed view behavior inherited from the selected configuration.
- Versioned configuration payloads.
- Compatibility for existing config endpoints during migration.

This phase does not include:

- Shareable links.
- Save-copy behavior from another user's shared link.
- Background cache warming or product analytics.

## Design Principle

Do not split users into `dev_lead` and `epm` roles. The user is a system user. The selected configuration determines whether the dashboard opens ENG, EPM, or mixed behavior.

## Data Model

### `workspace_config`

Database-backed replacement for the non-secret parts of `dashboard-config.json`.

| Column | Purpose |
| --- | --- |
| `workspace_id` | Scope. |
| `payload_version` | Config schema version. |
| `payload` | Projects, field mappings, capacity settings, EPM label prefix, and EPM project mappings. |
| `updated_by`, `updated_at` | Change audit. |

This table owns shared defaults. User view configs can override active view state, but workspace defaults remain the baseline for project mappings and field configuration.

### `view_configs`

Versioned user or workspace view definitions.

| Column | Purpose |
| --- | --- |
| `id` | Config UUID. |
| `workspace_id` | Workspace scope. |
| `owner_user_id` | User owner, nullable for workspace defaults. |
| `name` | User-visible saved view name. |
| `view_type` | `eng`, `epm`, or `mixed`. |
| `mode_policy` | `configuration`, meaning ENG/EPM behavior is inherited from this view. |
| `payload_version` | Version of the JSON shape. |
| `payload` | Validated JSONB view configuration. |
| `visibility` | `private` or `workspace` in this phase. |
| `created_at`, `updated_at`, `archived_at` | Lifecycle. |

Example payload shape:

```json
{
  "filters": {
    "sprint": "Active",
    "projectKeys": ["PRODUCT"],
    "teamGroupId": "backend-platform"
  },
  "eng": {
    "mode": "planning",
    "selectedTeams": ["Team A", "Team B"],
    "visibleColumns": ["status", "assignee", "dependencies"]
  },
  "epm": {
    "tab": "active",
    "rootGoalKey": "GOAL-1",
    "subGoalKeys": ["GOAL-2"],
    "projectIds": ["home-project-1"],
    "selectedSprint": "Active"
  }
}
```

The payload stores view state and references to configured workspace entities. It does not store tokens.

### `view_config_versions`

Immutable history for rollback and audit.

| Column | Purpose |
| --- | --- |
| `id` | Version UUID. |
| `view_config_id` | Parent config. |
| `version_number` | Monotonic version. |
| `payload` | Snapshot JSONB. |
| `created_by`, `created_at` | Change audit. |
| `change_note` | Short user or system note. |

## Effective Configuration Resolution

Use a deterministic layering model:

1. Load the user's selected or default workspace from phase 1.
2. Load workspace defaults from `workspace_config`.
3. Apply the user's selected private or workspace-visible view when present.
4. Resolve `view_type` to choose ENG, EPM, or mixed dashboard behavior.

The response should include the resolved view plus metadata explaining where it came from:

```json
{
  "source": "user_saved_view",
  "workspaceId": "workspace-uuid",
  "viewConfigId": "view-config-uuid",
  "viewType": "epm",
  "view": {}
}
```

## API Surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/me/views` | User-owned and workspace-visible saved views for the selected workspace. |
| `POST /api/me/views` | Save a new user-owned view config. |
| `PATCH /api/me/views/<id>` | Rename, archive, or update a user-owned view. |
| `GET /api/workspace/config` | Current workspace default config. |
| `PATCH /api/workspace/config` | Update shared defaults for the selected workspace. |

Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` should continue to work during migration by reading from the database-backed config repository. Do not break the current frontend bootstrap in the first configuration slice.

## Migration Plan

1. Create `workspace_config`, `view_configs`, and `view_config_versions`.
2. Import the current `dashboard-config.json` into `workspace_config` for the default workspace.
3. Keep JSON file loading as fallback for local single-user mode.
4. Add a config repository boundary so existing routes can read either database-backed config or JSON fallback.
5. Add saved-view endpoints for user-owned configurations.
6. Add version snapshots when a saved view changes.
7. Update frontend bootstrap to use selected workspace and effective config without adding heavy startup fan-out.

## Verification Criteria

- Existing JSON config can be imported once and exported for rollback during early migration.
- Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` return the same non-secret payloads before and after import.
- A user can save ENG, EPM, or mixed views in their selected workspace.
- ENG/EPM behavior comes from the selected configuration, not from separate user roles.
- A user cannot open or save a view for a workspace they cannot access.
- No view payload contains token material.
- Initial dashboard bootstrap remains one compact user/config request plus the existing scoped data requests.
