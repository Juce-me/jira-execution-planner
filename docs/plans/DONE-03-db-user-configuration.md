# DONE-03: DB User Configuration Plan

> **Status:** Done. Executed on branch `cdx/auth-db-context-plan` in commits `80ae665`, `42a1427`, `e9adbe4`, `b520a18`, `983d617`, and `d18e40b`, with follow-ups `eaf3cda`, `03d05b8`, `fcfb9a0`, and `c8d9311`. Kept for audit context only; do not execute as an active plan.

## Goal

Move dashboard and EPM view configuration from one local file-backed model toward database-backed user-owned saved views. This phase builds on `docs/plans/DONE-01-db-auth-foundation.md`.

## Execution Order

Execute only after `DONE-01-db-auth-foundation.md` has landed or is present on the current checkout and verified DB `RequestAuthContext`, token-bound CSRF, admin/service-integration checks, JSON fallback behavior, and cache partitioning.

This plan does not depend on `DONE-02-db-home-user-api-token-bridge.md`. `DONE-03` proceeded after `DONE-01` while `GATE-05-home-write-capability.md` remained blocked; it did not add Home write routes, user API-token connection requirements, or dependencies on `atlassian_user_api_token`.

## Scope

This phase includes:

- User-owned saved view configurations.
- User-owned EPM configuration: Home goal scope, selected sub-goals, label prefix, issue-type grouping, project label mappings, selected EPM tab, and selected sprint.
- ENG/EPM/mixed view behavior inherited from the selected user view.
- Versioned configuration payloads.
- Compatibility for existing config endpoints during migration.

This phase does not include:

- Shareable links.
- Save-copy behavior from another user's shared link.
- Background cache warming or product analytics.
- Workspace default EPM configuration. Each authenticated user owns their EPM view/config.

## Design Principle

Do not split users into `dev_lead` and `epm` roles. The user is a system user. The selected configuration determines whether the dashboard opens ENG, EPM, or mixed behavior.

All configuration reads and writes inherit the environment/workspace isolation from `docs/plans/DONE-01-db-auth-foundation.md`. User views are scoped by `workspace_id` and `owner_user_id`, and the workspace is resolved from `RequestAuthContext`; the client must not choose an arbitrary workspace id or owner id.

There is no shared workspace EPM default in this phase. Normal authenticated users can create and update their own EPM view/config. Jira project references must be checked against the current `RequestAuthContext` project-access snapshot. Home/Townsquare goals and Home projects are discovered through the workspace service-backed catalog while the Home GraphQL 3LO gate fails; do not describe them as user-ACL filtered. User EPM configs may store Home goal/project references and Jira label mappings for that user's view, but they must not store token material, service integration settings, or arbitrary Home GraphQL operations.

## Storage Backend Selector And JSON Scope

Use an explicit selector. Do not auto-detect DB availability for configuration reads.

- `CONFIG_STORAGE_BACKEND=jsonfile` keeps the current JSON-backed single-user behavior and is the default until DB user-view import is verified.
- `CONFIG_STORAGE_BACKEND=db` reads and writes through the DB user-view repository and requires migrations to be at head.
- Startup must fail if `CONFIG_STORAGE_BACKEND=db` and `DATABASE_URL` is missing or migrations are not applied.
- JSON fallback remains available for local single-user mode until the DB-backed config path has passed final verification.

Import idempotency:

- Import `dashboard-config.json` into the current user's default private view only once per `(workspace_id, owner_user_id, source_path, source_hash)`.
- If the same source hash was already imported, the command exits without creating another version.
- If the source hash changed, create a new user view version history row and keep the previous version exportable for rollback.
- Export rollback writes a sanitized JSON file outside committed paths and does not include secrets.

Out of scope for this phase:

- `team-groups.json` and `team-catalog.json` remain JSON-backed generated/local catalog files until a separate Team And Project Catalog Governance plan lands.
- This phase may keep `GET /api/groups-config` compatible through the existing JSON source; it must not silently claim team/group catalog migration is complete.

User-view validation:

- Define a reusable validator in `backend/config/view_validation.py` that rejects token material, service integration settings, raw GraphQL operations, and caller-supplied credential fields in saved-view payloads.
- Allow EPM view-owned mappings such as `epm.projects`, `epm.labelPrefix`, and `epm.issueTypes` because EPM configuration is user-owned in this phase.
- Use the same forbidden credential/proxy field list from the Home/Townsquare guardrail tests where possible. Do not duplicate sensitive key lists across modules.

## Data Model

### `view_configs`

Versioned user-owned view definitions. EPM configuration lives here, not in shared workspace defaults.

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
| `visibility` | `private` in this phase. |
| `is_default` | Whether this is the user's default view for the workspace. |
| `source_path`, `source_hash` | Optional import provenance for idempotency. |
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
    "labelPrefix": "rnd_project_*",
    "projects": {
      "home-project-1": {
        "homeProjectId": "home-project-1",
        "name": "Private Beta",
        "label": "rnd_project_private_beta"
      }
    },
    "issueTypes": {
      "initiatives": ["Initiative"],
      "epics": ["Epic"],
      "stories": ["Story"]
    },
    "selectedSprint": "Active"
  }
}
```

The payload stores user view state, EPM scope, and user-owned EPM mappings. It does not store tokens, service integration definitions, or raw Home/Townsquare GraphQL requests.

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
2. Load the user's selected private view, or their default private view for that workspace.
3. If no DB view exists yet, import the legacy JSON config into that user's default private view or return the JSON-compatible fallback until import is run.
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

Return this metadata from the new resolved-view/config repository path used by dashboard bootstrap and from any new saved-view endpoint that returns an effective view. Preserve the legacy non-secret response shape for `GET /api/config` and `GET /api/epm/config` until the frontend is explicitly migrated to the metadata wrapper; compatibility tests must compare those legacy endpoint bodies byte-for-byte before import, after import, and after rollback to JSON mode for the current user.

## API Surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/me/views` | User-owned saved views for the selected workspace. |
| `POST /api/me/views` | Save a new user-owned view config. |
| `PATCH /api/me/views/<id>` | Rename, archive, or update a user-owned view. |
| `GET /api/me/views/default` | Current user's resolved default view for the selected workspace. |

Existing `GET /api/config` and `GET /api/epm/config` should continue to work during migration by reading from the selected user's resolved view repository. `GET /api/groups-config` stays compatible through the existing JSON-backed generated/local source in this phase. Do not break the current frontend bootstrap in the first configuration slice.

`POST /api/me/views` and `PATCH /api/me/views/<id>` require an authenticated active user, CSRF validation, workspace scoping from `RequestAuthContext`, and ownership checks. No admin role is required to create, edit, or select the user's own EPM view/config.

Personal saved views may store Home/Townsquare project ids, goal keys, label prefix, issue type grouping, and project-to-Jira-label mappings for that user's EPM view. If Home/Townsquare 3LO is still unavailable, validate Home references against the workspace service-backed catalog and validate Jira project/label reachability against the user's Jira access snapshot.

## Migration Plan

Execute only after `docs/plans/DONE-01-db-auth-foundation.md` has landed and the preflight below verifies DB `RequestAuthContext`, token-bound CSRF, admin/service-integration checks, JSON fallback behavior, and cache partitioning.

### Preflight: DONE-01 Completion Required Before This Plan

Do not start Task 1 until DONE-01 has landed or is present on the current checkout and the listed verifications pass:

- DONE-01 Task 1: DB runtime, migration harness, and local commands.
- DONE-01 Task 3: DB auth context resolver and local OAuth store cutover prep.
- DONE-01 Task 5: Admin and service integration auth APIs.
- DONE-01 Task 6: Token-bound CSRF and visible recovery pages.
- DONE-01 Task 7: Jira project access, cache partitioning, and Home 3LO gate outcomes.
- DONE-01 Task 8: Final DB auth verification, including JSON fallback compatibility.

Re-run and attach the results to the DONE-03 execution notes:

```bash
.venv/bin/python -m unittest tests.test_db_session tests.test_db_migrations tests.test_auth_context_db tests.test_db_oauth_cutover tests.test_service_integrations tests.test_db_admin_routes tests.test_csrf_token_bound tests.test_db_auth_recovery_pages tests.test_db_project_access tests.test_cache_partitioning tests.test_home_3lo_gate_outcomes
node tests/test_auth_isolation_source_guard.js
```

Expected: DB `RequestAuthContext` resolves the active user/workspace/auth connection, unsafe admin/config routes require token-bound CSRF, service integrations are admin/operator-controlled, Home/Townsquare metadata remains service-integration-scoped while the Home 3LO gate fails, and Jira/Home-derived caches are partitioned or disabled by auth context.

Also verify the DONE-01 JSON fallback compatibility evidence for `GET /api/config`, `GET /api/groups-config`, and `GET /api/epm/config`. If the test module names differ after DONE-01 has merged, replace the command with the actual DONE-01 test names — do not invent new test names or start Task 1 without a concrete JSON fallback verification.

### Task 1: Config Tables And Migration Tests

**Files:**
- Modify: `backend/db/models.py`
- Create: `backend/db/migrations/versions/*_user_config.py`
- Test: `tests/test_view_configs_db.py`

- [x] Add `view_configs` and `view_config_versions` tables scoped by `(workspace_id, owner_user_id)`.
- [x] Add an `is_default` constraint so each user has at most one active default view per workspace.
- [x] Add `source_path` and `source_hash` to `view_configs` for legacy JSON import idempotency.
- [x] Test migration upgrade/downgrade and constraints for owner/workspace isolation.
- [x] Test CRUD, archive, and version snapshot behavior in `tests/test_view_configs_db.py`.
- [x] Commit with `git commit -m "Add database tables for user view configs"`.

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

- [x] Implement `CONFIG_STORAGE_BACKEND=jsonfile|db`; default to `jsonfile` until import verification passes.
- [x] Fail startup when `CONFIG_STORAGE_BACKEND=db` and `DATABASE_URL` is missing or migrations are not at head.
- [x] Add idempotent import keyed by `(workspace_id, owner_user_id, source_path, source_hash)` and an operator export rollback command that writes sanitized JSON outside committed paths.
- [x] Prove `GET /api/config` and `GET /api/epm/config` return byte-identical non-secret payloads before import, after import, and after rollback to JSON mode.
- [x] Prove `GET /api/groups-config` remains JSON-backed and compatible before and after config storage migration.
- [x] Keep `team-groups.json` and `team-catalog.json` JSON-backed generated/local catalog files. Do not migrate them in this phase.
- [x] Commit with `git commit -m "Add deterministic config storage selector"`.

### Task 3: User View Payload Validator

**Files:**
- Create: `backend/config/view_validation.py`
- Test: `tests/test_view_config_validator.py`
- Modify: `tests/test_epm_home_oauth_source_guard.py` only if the Home/Townsquare plan has already created it

- [x] Define `FORBIDDEN_VIEW_PAYLOAD_KEYS` for token material, credential fields, service integrations, raw GraphQL proxy fields, and caller-supplied Authorization data.
- [x] Implement `validate_user_view_payload(payload)` and use it from saved-view writes.
- [x] Allow user-owned EPM mappings: `epm.projects`, `epm.labelPrefix`, `epm.issueTypes`, `epm.scope`, selected tab, and selected sprint.
- [x] Cross-link this helper with the Part 2 Home/Townsquare guardrail tests so forbidden credential/proxy fields are not duplicated.
- [x] Test that saved-view payloads cannot store token material, service integration definitions, raw Home GraphQL operations, or credential fields.
- [x] Commit with `git commit -m "Validate user view payloads"`.

### Task 4: Effective Config Resolution

**Files:**
- Modify: `backend/config/db_repository.py`
- Modify: `backend/config/repository.py`
- Test: `tests/test_view_config_resolution.py`

- [x] Resolve effective config in this order: DB `RequestAuthContext` workspace/user, selected private view or default private view, and `view_type`.
- [x] Return metadata that names `source`, `workspaceId`, `viewConfigId`, and `viewType`.
- [x] Test user-view resolution, workspace isolation, owner checks, archived-view exclusion, default-view selection, and ENG/EPM/mixed view selection.
- [x] Commit with `git commit -m "Resolve effective dashboard view config"`.

### Task 5: Saved View Routes

**Files:**
- Create: `backend/routes/views_routes.py`
- Modify: app route registration file used by this repo
- Modify: `backend/routes/settings_routes.py`
- Test: `tests/test_view_configs_db.py`
- Test: `tests/test_user_view_config_routes.py`

- [x] Add `GET /api/me/views`, `POST /api/me/views`, and `PATCH /api/me/views/<id>` for authenticated active users with token-bound CSRF on unsafe methods.
- [x] Add `GET /api/me/views/default` for the current user's resolved default view.
- [x] Remove EPM from the admin-only settings tab filter once the user-owned EPM view UI is wired; normal users must be able to open and save their own EPM config.
- [x] Validate Jira project references against the current `RequestAuthContext` project-access snapshot.
- [x] Validate Home/Townsquare references against the workspace service-backed catalog while the Home 3LO gate remains failed; do not claim user-level Home visibility.
- [x] Test normal users can save private ENG, EPM, and mixed views, including EPM project label mappings, without tool-admin role.
- [x] Commit with `git commit -m "Add user saved view routes"`.

### Task 6: Frontend Bootstrap Compatibility And Final Verification

**Files:**
- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/dashboard.jsx` only if bootstrap wiring is unavoidable; do not add auth UI here
- Test: `tests/test_dashboard_bootstrap_config_source.py::test_bootstrap_returns_resolved_view_with_source_metadata`

- [x] Keep initial dashboard bootstrap to one compact user/config request plus existing scoped data requests.
- [x] Preserve current JSON-compatible response shape for existing dashboard routes.
- [x] Run `.venv/bin/python -m unittest tests.test_view_configs_db tests.test_view_config_resolution tests.test_user_view_config_routes tests.test_view_config_validator tests.test_config_jsonfile_fallback tests.test_dashboard_bootstrap_config_source.test_bootstrap_returns_resolved_view_with_source_metadata`.
- [x] Run `node tests/test_auth_isolation_source_guard.js`.
- [x] Run `npm run build` if frontend source changed.
- [x] Measure first-load request count or `Server-Timing` before/after this phase and record the result.
- [x] Commit with `git commit -m "Wire dashboard config bootstrap to DB views"`.

## Verification Criteria

- Existing JSON config can be imported once per user/workspace and exported for rollback during early migration.
- `CONFIG_STORAGE_BACKEND=jsonfile` and `CONFIG_STORAGE_BACKEND=db` select deterministic storage behavior; no auto DB probe changes config source silently.
- Existing `GET /api/config` and `GET /api/epm/config` return the same non-secret payloads before and after import.
- `GET /api/groups-config`, `team-groups.json`, and `team-catalog.json` remain JSON-backed and are explicitly out of scope for this phase.
- A user can save ENG, EPM, or mixed views in their selected workspace.
- ENG/EPM behavior comes from the selected configuration, not from separate user roles.
- A user cannot open or save a view for a workspace they cannot access.
- A request in one environment/Jira workspace cannot read or mutate defaults or saved views from another environment/Jira workspace.
- Normal users can save private EPM view configuration, including Home goal scope and project label mappings, without tool-admin role.
- Saved-view validation uses the shared `validate_user_view_payload` helper from `backend/config/view_validation.py`.
- Saved views that reference Home/Townsquare metadata do not claim user-level Home visibility unless the Home 3LO gate documented in `docs/plans/SUPPORT-epm-home-oauth-migration.md` has passed and the implementation validates that user 3LO path.
- No view payload contains token material.
- Initial dashboard bootstrap remains one compact user/config request plus the existing scoped data requests.
