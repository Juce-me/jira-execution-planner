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

All configuration reads and writes inherit the environment/workspace isolation from `docs/plans/2026-05-05-database-introduction-user-auth.md`. Workspace defaults and saved views are scoped by `workspace_id`, and that workspace is resolved from `RequestAuthContext`; the client must not choose an arbitrary workspace id.

Shared workspace defaults remain admin-controlled. User-owned saved views can be created by normal authenticated users, but Jira project references must be checked against the current `RequestAuthContext` project-access snapshot. Home/Townsquare goals, Home projects, and EPM project mappings are app/workspace-scoped metadata until the Home GraphQL 3LO gate passes; do not describe them as user-ACL filtered or allow normal users to mutate the shared Home/Jira-project-backed mapping catalog.

## Storage Backend Selector And JSON Scope

Use an explicit selector. Do not auto-detect DB availability for configuration reads.

- `CONFIG_STORAGE_BACKEND=jsonfile` keeps the current JSON-backed behavior and is the default until DB config import is verified.
- `CONFIG_STORAGE_BACKEND=db` reads and writes through the DB config repository and requires migrations to be at head.
- Startup must fail if `CONFIG_STORAGE_BACKEND=db` and `DATABASE_URL` is missing or migrations are not applied.
- JSON fallback remains available for local single-user mode until the DB-backed config path has passed final verification.

Import idempotency:

- Import `dashboard-config.json` into `workspace_config` only once per `(workspace_id, source_path, source_hash)`.
- If the same source hash was already imported, the command exits without creating another version.
- If the source hash changed, create a new `view_config_versions`/history row and keep the previous version exportable for rollback.
- Export rollback writes a sanitized JSON file outside committed paths and does not include secrets.

Out of scope for this phase:

- `team-groups.json` and `team-catalog.json` remain JSON-backed generated/local catalog files until a separate Team And Project Catalog Governance plan lands.
- This phase may keep `GET /api/groups-config` compatible through the existing JSON source; it must not silently claim team/group catalog migration is complete.

Shared mapping validation:

- Define `SHARED_MAPPING_PAYLOAD_KEYS` and `reject_shared_mapping_payload_keys` once in `backend/config/view_validation.py`.
- Use the same helper from saved-view endpoints and from the Home/Townsquare 3LO guardrail tests. Do not duplicate the key list across plans or modules.

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

`PATCH /api/workspace/config` and any compatibility route that mutates shared workspace defaults must require an authenticated admin and CSRF validation. `POST /api/me/views` and `PATCH /api/me/views/<id>` require an authenticated active user, CSRF validation, workspace scoping from `RequestAuthContext`, and ownership checks.

Personal saved views may store references to configured Home/Townsquare project ids or goal keys, but they do not create or edit the shared Home/Townsquare-backed EPM/APM configuration. If Home/Townsquare 3LO is still unavailable, validate those references against the workspace service-backed catalog and validate Jira project/label reachability against the user's Jira access snapshot.

## Migration Plan

- [ ] Create DB config tables.
  - Files: `backend/db/models.py`, `backend/db/migrations/versions/*_user_config.py`
  - Tests: `tests/test_db_user_config_migrations.py`
- [ ] Add explicit storage selector and config repository.
  - Files: `backend/config/repository.py`, `backend/config/json_repository.py`, `backend/config/db_repository.py`
  - Tests: `tests/test_config_storage_selector.py`
- [ ] Add idempotent JSON import/export rollback command.
  - Files: `backend/config/import_config.py`
  - Tests: `tests/test_config_import_export.py`
- [ ] Keep JSON fallback for `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config`.
  - Files: `backend/routes/settings_routes.py`, `backend/routes/epm_routes.py`
  - Tests: `tests/test_config_json_fallback_compatibility.py`
- [ ] Add shared mapping payload validator.
  - Files: `backend/config/view_validation.py`
  - Tests: `tests/test_saved_view_validation.py`
- [ ] Add saved-view route endpoints.
  - Files: `backend/routes/views_routes.py`, `backend/app.py`
  - Tests: `tests/test_saved_view_routes.py`
- [ ] Add version snapshots when a saved view changes.
  - Files: `backend/config/db_repository.py`
  - Tests: `tests/test_view_config_versions.py`
- [ ] Update frontend bootstrap to use selected workspace and effective config without adding heavy startup fan-out.
  - Files: `frontend/src/api/config.js`, `frontend/src/dashboard.jsx` only if bootstrap wiring is unavoidable and auth UI stays outside dashboard state.
  - Tests: existing frontend source guards plus a focused bootstrap test.

## Verification Criteria

- Existing JSON config can be imported once and exported for rollback during early migration.
- `CONFIG_STORAGE_BACKEND=jsonfile` and `CONFIG_STORAGE_BACKEND=db` select deterministic storage behavior; no auto DB probe changes config source silently.
- Existing `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config` return the same non-secret payloads before and after import.
- `team-groups.json` and `team-catalog.json` remain JSON-backed and are explicitly out of scope for this phase.
- A user can save ENG, EPM, or mixed views in their selected workspace.
- ENG/EPM behavior comes from the selected configuration, not from separate user roles.
- A user cannot open or save a view for a workspace they cannot access.
- A request in one environment/Jira workspace cannot read or mutate defaults or saved views from another environment/Jira workspace.
- Normal users can save private views but cannot mutate shared workspace defaults.
- Normal users cannot mutate shared Home/Townsquare-backed or Jira-project-backed EPM/APM mappings through saved-view endpoints.
- Saved-view validation uses the shared `reject_shared_mapping_payload_keys` helper from `backend/config/view_validation.py`.
- Saved views that reference Home/Townsquare metadata do not claim user-level Home visibility unless `docs/plans/2026-05-06-home-townsquare-3lo-readiness-migration.md` has passed and the implementation validates that user 3LO path.
- No view payload contains token material.
- Initial dashboard bootstrap remains one compact user/config request plus the existing scoped data requests.
