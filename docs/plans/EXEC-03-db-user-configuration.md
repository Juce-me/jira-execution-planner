# EXEC-03: DB User Configuration Plan

> **Execution expectation:** Execute only after `EXEC-01-db-auth-foundation.md` has landed and verified DB `RequestAuthContext`, token-bound CSRF, admin checks, and JSON fallback behavior.

## Goal

Move dashboard and view configuration from one local file-backed model toward database-backed workspace defaults and user-owned saved views. This phase builds on `docs/plans/EXEC-01-db-auth-foundation.md`.

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

All configuration reads and writes inherit the environment/workspace isolation from `docs/plans/EXEC-01-db-auth-foundation.md`. Workspace defaults and saved views are scoped by `workspace_id`, and that workspace is resolved from `RequestAuthContext`; the client must not choose an arbitrary workspace id.

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
- If the source hash changed, create a new `workspace_config_versions` history row and keep the previous version exportable for rollback.
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

### `workspace_config_versions`

Immutable history for imported or edited workspace defaults.

| Column | Purpose |
| --- | --- |
| `id` | Version UUID. |
| `workspace_id` | Workspace scope. |
| `version_number` | Monotonic version for the workspace defaults. |
| `source_path`, `source_hash` | Import provenance for idempotency. |
| `payload` | Snapshot JSONB of non-secret shared defaults. |
| `created_by`, `created_at` | Change audit. |
| `change_note` | Optional short system/admin note. Do not build a rollback UI in this phase; export rollback is an operator action only. |

### `view_configs`

Versioned user-owned view definitions. Workspace defaults live only in `workspace_config`.

| Column | Purpose |
| --- | --- |
| `id` | Config UUID. |
| `workspace_id` | Workspace scope. |
| `owner_user_id` | User owner; not nullable in this phase. |
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

Immutable history for saved-view rollback and audit.

| Column | Purpose |
| --- | --- |
| `id` | Version UUID. |
| `view_config_id` | Parent config. |
| `version_number` | Monotonic version. |
| `payload` | Snapshot JSONB. |
| `created_by`, `created_at` | Change audit. |
| `change_note` | Optional short system/admin note. Do not build a rollback UI in this phase; export rollback is an operator action only. |

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

Existing `GET /api/config` and `GET /api/epm/config` should continue to work during migration by reading from the selected config repository. `GET /api/groups-config` stays compatible through the existing JSON-backed generated/local source in this phase. Do not break the current frontend bootstrap in the first configuration slice.

`PATCH /api/workspace/config` and any compatibility route that mutates shared workspace defaults must require an authenticated admin and CSRF validation. `POST /api/me/views` and `PATCH /api/me/views/<id>` require an authenticated active user, CSRF validation, workspace scoping from `RequestAuthContext`, and ownership checks.

Personal saved views may store references to configured Home/Townsquare project ids or goal keys, but they do not create or edit the shared Home/Townsquare-backed EPM/APM configuration. If Home/Townsquare 3LO is still unavailable, validate those references against the workspace service-backed catalog and validate Jira project/label reachability against the user's Jira access snapshot.

## Migration Plan

Execute only after `docs/plans/EXEC-01-db-auth-foundation.md` has landed and verified DB `RequestAuthContext`, token-bound CSRF, admin checks, and JSON fallback behavior.

### Task 1: Config Tables And Migration Tests

**Files:**
- Modify: `backend/db/models.py`
- Create: `backend/db/migrations/versions/*_user_config.py`
- Test: `tests/test_view_configs_db.py`

- [ ] Add `workspace_config`, `workspace_config_versions`, `view_configs`, and `view_config_versions` tables scoped by `workspace_id`.
- [ ] Test migration upgrade/downgrade and constraints for owner/workspace isolation.
- [ ] Test CRUD, archive, and version snapshot behavior in `tests/test_view_configs_db.py`.
- [ ] Commit with `git commit -m "Add database tables for user view configs"`.

### Task 2: Explicit Storage Selector And JSON Fallback

**Files:**
- Create: `backend/config/repository.py`
- Create: `backend/config/json_repository.py`
- Create: `backend/config/db_repository.py`
- Create: `backend/config/import_config.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/routes/epm_routes.py`
- Test: `tests/test_config_storage_selector.py`
- Test: `tests/test_config_jsonfile_fallback.py`

- [ ] Implement `CONFIG_STORAGE_BACKEND=jsonfile|db`; default to `jsonfile` until import verification passes.
- [ ] Fail startup when `CONFIG_STORAGE_BACKEND=db` and `DATABASE_URL` is missing or migrations are not at head.
- [ ] Add idempotent import keyed by `(workspace_id, source_path, source_hash)` and an operator export rollback command that writes sanitized JSON outside committed paths.
- [ ] Prove `GET /api/config` and `GET /api/epm/config` return byte-identical non-secret payloads before import, after import, and after rollback to JSON mode.
- [ ] Prove `GET /api/groups-config` remains JSON-backed and compatible before and after config storage migration.
- [ ] Keep `team-groups.json` and `team-catalog.json` JSON-backed generated/local catalog files. Do not migrate them in this phase.
- [ ] Commit with `git commit -m "Add deterministic config storage selector"`.

### Task 3: Shared Mapping Payload Validator

**Files:**
- Create: `backend/config/view_validation.py`
- Test: `tests/test_view_config_validator.py`
- Modify: `tests/test_epm_home_oauth_source_guard.py` only if the Home/Townsquare plan has already created it

- [ ] Define one `SHARED_MAPPING_PAYLOAD_KEYS` constant containing `epm.projectMappings`, `epm.projects`, `epm.homeProjectMappings`, `epm.jiraLabelDefinitions`, and `epm.serviceIntegrations`.
- [ ] Implement `reject_shared_mapping_payload_keys(payload)` and use it from saved-view writes.
- [ ] Cross-link this helper with the Part 2 Home/Townsquare guardrail tests so the forbidden shared mapping list is not duplicated.
- [ ] Test that saved-view payloads cannot mutate shared Home/Townsquare-backed or Jira-project-backed mappings, labels, projects, or service integrations.
- [ ] Commit with `git commit -m "Reject shared mappings from saved views"`.

### Task 4: Effective Config Resolution

**Files:**
- Modify: `backend/config/db_repository.py`
- Modify: `backend/config/repository.py`
- Test: `tests/test_view_config_resolution.py`

- [ ] Resolve effective config in this order: DB `RequestAuthContext` workspace, `workspace_config` defaults, selected private/workspace-visible user view, and `view_type`.
- [ ] Return metadata that names `source`, `workspaceId`, `viewConfigId`, and `viewType`.
- [ ] Test workspace defaults to user-view layering, workspace isolation, owner checks, archived-view exclusion, and ENG/EPM/mixed view selection.
- [ ] Commit with `git commit -m "Resolve effective dashboard view config"`.

### Task 5: Saved View And Workspace Config Routes

**Files:**
- Create: `backend/routes/views_routes.py`
- Modify: app route registration file used by this repo
- Modify: `backend/routes/settings_routes.py`
- Test: `tests/test_view_configs_db.py`
- Test: `tests/test_workspace_config_admin.py`

- [ ] Add `GET /api/me/views`, `POST /api/me/views`, and `PATCH /api/me/views/<id>` for authenticated active users with token-bound CSRF on unsafe methods.
- [ ] Add `GET /api/workspace/config` and `PATCH /api/workspace/config`; PATCH is admin-only and token-bound CSRF-required.
- [ ] Validate Jira project references against the current `RequestAuthContext` project-access snapshot.
- [ ] Validate Home/Townsquare references against the workspace service-backed catalog while the Home 3LO gate remains failed; do not claim user-level Home visibility.
- [ ] Test normal users can save private views but cannot mutate workspace defaults.
- [ ] Commit with `git commit -m "Add saved view config routes"`.

### Task 6: Frontend Bootstrap Compatibility And Final Verification

**Files:**
- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/dashboard.jsx` only if bootstrap wiring is unavoidable; do not add auth UI here
- Test: `tests/test_dashboard_bootstrap_config_source.py::test_bootstrap_returns_resolved_view_with_source_metadata`

- [ ] Keep initial dashboard bootstrap to one compact user/config request plus existing scoped data requests.
- [ ] Preserve current JSON-compatible response shape for existing dashboard routes.
- [ ] Run `.venv/bin/python -m unittest tests.test_view_configs_db tests.test_view_config_resolution tests.test_workspace_config_admin tests.test_view_config_validator tests.test_config_jsonfile_fallback tests.test_dashboard_bootstrap_config_source.test_bootstrap_returns_resolved_view_with_source_metadata`.
- [ ] Run `node tests/test_auth_isolation_source_guard.js`.
- [ ] Run `npm run build` if frontend source changed.
- [ ] Measure first-load request count or `Server-Timing` before/after this phase and record the result.
- [ ] Commit with `git commit -m "Wire dashboard config bootstrap to DB views"`.

## Verification Criteria

- Existing JSON config can be imported once and exported for rollback during early migration.
- `CONFIG_STORAGE_BACKEND=jsonfile` and `CONFIG_STORAGE_BACKEND=db` select deterministic storage behavior; no auto DB probe changes config source silently.
- Existing `GET /api/config` and `GET /api/epm/config` return the same non-secret payloads before and after import.
- `GET /api/groups-config`, `team-groups.json`, and `team-catalog.json` remain JSON-backed and are explicitly out of scope for this phase.
- A user can save ENG, EPM, or mixed views in their selected workspace.
- ENG/EPM behavior comes from the selected configuration, not from separate user roles.
- A user cannot open or save a view for a workspace they cannot access.
- A request in one environment/Jira workspace cannot read or mutate defaults or saved views from another environment/Jira workspace.
- Normal users can save private views but cannot mutate shared workspace defaults.
- Normal users cannot mutate shared Home/Townsquare-backed or Jira-project-backed EPM/APM mappings through saved-view endpoints.
- Saved-view validation uses the shared `reject_shared_mapping_payload_keys` helper from `backend/config/view_validation.py`.
- Saved views that reference Home/Townsquare metadata do not claim user-level Home visibility unless the Home 3LO gate documented in `docs/plans/SUPPORT-epm-home-oauth-migration.md` has passed and the implementation validates that user 3LO path.
- No view payload contains token material.
- Initial dashboard bootstrap remains one compact user/config request plus the existing scoped data requests.
