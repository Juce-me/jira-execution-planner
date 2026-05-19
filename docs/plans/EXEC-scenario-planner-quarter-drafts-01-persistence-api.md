# Scenario Planner Quarter Drafts 01 Persistence/API

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Scenario Planner saved overrides from `scenario-overrides.json` to DB-backed active drafts with append-only version history and optimistic concurrency.

**Architecture:** Add `ScenarioDraft` and `ScenarioDraftVersion` models, a small `backend/scenario_drafts.py` service boundary, and `/api/scenario/drafts` routes. Keep `/api/scenario/overrides` as a legacy read alias in DB mode and as the existing JSON-file fallback outside DB mode; DB-mode legacy writes must not accept the old no-revision contract.

**Tech Stack:** Flask, SQLAlchemy/Alembic, `session_scope()`, `current_request_auth_context()`, token-bound CSRF in OAuth mode, Python `unittest`.

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `backend/db/models.py` | Add `ScenarioDraft` and `ScenarioDraftVersion`. |
| Create | `backend/db/migrations/versions/20260514_0004_scenario_drafts.py` | Create draft/version tables and indexes. |
| Create | `backend/scenario_drafts.py` | Repository/service for active draft, save, history, rollback, legacy import, response serialization. |
| Create | `backend/routes/scenario_draft_routes.py` | New `/api/scenario/drafts` route contract with auth/CSRF handling. |
| Modify | `backend/app.py` | Register `scenario_draft_routes` blueprint. |
| Modify | `jira_server.py` | Keep `/api/scenario/overrides` as JSON fallback/read alias and mark new draft paths OAuth-ready. |
| Create | `tests/test_scenario_drafts_db.py` | Model, migration, repository, versioning, rollback, legacy import tests. |
| Create | `tests/test_scenario_draft_routes.py` | Route contract, auth, CSRF, conflict, fallback tests. |
| Create | `tests/test_scenario_draft_security_source_guards.py` | Source guards against forbidden credential/token-store imports in draft modules. |
| Modify | `tests/test_oauth_stats_routes.py` | Cover JSON-file/basic override fallback and DB-mode alias rejection. |
| Modify | `docs/features/scenario-planner.md` | Document DB-backed draft history and legacy override alias. |

## Data Model

`ScenarioDraft`:

| Column | Type | Rule |
|---|---|---|
| `id` | `String(36)` PK | UUID default. |
| `workspace_id` | FK `workspaces.id` | Required workspace boundary. |
| `scope_key` | `String(255)` | Required normalized sprint + team/group scope. |
| `name` | `String(255)` | Required display name. |
| `scope_payload` | `JSON` | Sprint/team/group metadata used to rebuild context; stores shared group references, not private group definitions. |
| `scenario_source_hash` | `String(128)`, nullable | Hash of the normalized Jira scenario source when available; updated by reload-from-Jira in slice 03. |
| `overrides` | `JSON` | Current active override map. |
| `draft_revision` | `Integer` | Starts at `1`; increments on save, rollback, and reload-from-Jira. Serialized as `draftRevision`. |
| `created_by` | FK `users.id`, nullable | Creator/importer. |
| `updated_by` | FK `users.id`, nullable | Last actor. |
| `created_at`, `updated_at` | timezone datetime | UTC. |
| `archived_at` | timezone datetime nullable | Reserved for future delete/archive. |

Indexes and constraints:
- partial unique active draft on `(workspace_id, scope_key)` where `archived_at IS NULL`;
- index `(workspace_id, updated_at)`;
- no `owner_user_id` in the unique key.

`ScenarioDraftVersion`:

| Column | Type | Rule |
|---|---|---|
| `id` | `String(36)` PK | UUID default. |
| `scenario_draft_id` | FK `scenario_drafts.id` | Cascade delete. |
| `version_number` | `Integer` | Monotonic per draft. |
| `draft_revision` | `Integer` | Active draft revision after this snapshot was created. |
| `name` | `String(255)` | Snapshot display name. |
| `scope_payload` | `JSON` | Snapshot scope metadata. |
| `scenario_source_hash` | `String(128)`, nullable | Source hash captured with this snapshot. |
| `overrides` | `JSON` | Snapshot override map. |
| `created_by` | FK `users.id`, nullable | Actor. |
| `created_at` | timezone datetime | UTC. |
| `change_note` | `String(255)` | `user save`, `legacy import`, `rollback to version N`. |
| `source` | `String(32)` | Check constraint: `user`, `legacy_json`, `rollback`, `reload_from_jira`. |

Unique constraint: `(scenario_draft_id, version_number)`.

`scenario_source_hash` uses `sha256:` plus the SHA-256 hex digest of canonical JSON: sorted keys, compact separators, and only the scenario source fields used to compute visible draft state (`config`, `filters`, `issues`, `dependencies`, and sprint boundaries). Sort `issues` by issue key, sort dependencies by `(from, to, type)`, sort object keys recursively, and omit auth/session/user fields. Jira response ordering must not change the hash.

## Guardrails

### OAuth-Only Jira Publishing

This slice stores local Scenario draft state only and must not add Jira mutation routes. If a later plan adds Jira publish/write-back, it must use only the current request's signed-in Atlassian OAuth Jira REST context. It must not use Jira Basic credentials, workspace service integrations, Home/Townsquare APIs, `home_townsquare_basic`, `jira_basic`, `atlassian_user_api_token`, or local OAuth token-store helpers for publishing.

### Shared Group Configuration

Group configuration is a shared environment-scoped entity created and maintained by project managers/EPMs. `ScenarioDraft.scope_payload` may include `groupId`, `groupName`, and a non-authoritative group config hash/version if available, but the Scenario draft must not own group membership or create per-user group copies.

The active draft uniqueness rule stays `(workspace_id, scope_key)` so two signed-in users in the same workspace/environment and group scope see the same active draft.

Reject membership-shaped data at the service boundary before saving. If `scope_payload` contains `members`, `teamIds`, `memberUserIds`, `groupDefinitions`, `groups`, `nestedGroups`, or any nested object/list with those keys, return `400 scenario_scope_membership_not_allowed`. Do not silently persist or strip these fields; failing closed makes ownership mistakes visible.

## Route Response Contract

Every DB-mode draft response includes `"storage": "db"`, including no-draft responses:

```json
{
  "activeDraft": null,
  "versions": [],
  "storage": "db"
}
```

Active draft payloads use `draftRevision`, not `revision`. Version history uses `versionNumber` plus `draftRevision`.

All stale save and rollback responses use the overview's canonical `409 scenario_draft_conflict` body with `conflict.reason = "stale_base_draft_revision"`.

## Route Contract Matrix

Every row below must be represented in `tests/test_scenario_draft_routes.py`; do not add or change a draft endpoint without updating this matrix first.

| Endpoint | Method | Auth | CSRF | Workspace check | Request body | Success body | Error bodies | Tests |
|---|---|---|---|---|---|---|---|---|
| `/api/scenario/drafts?scope_key=<scope>` | `GET` | DB mode requires `current_request_auth_context()`; basic/json-file mode is not the source of truth for this route. | None. | Scope is resolved inside `context.workspace_id`; lazy JSON import is allowed only for the current single/configured workspace. | None; `scope_key` query required. | `200 {"activeDraft": null\|object, "versions": [], "storage": "db"}`. | `400 {"error": "scope_key_required"}`; `401 auth_required`; `503 config_storage_unavailable`. | `test_get_active_draft_requires_scope_key`, `test_get_active_draft_requires_auth_context`, `test_get_active_draft_imports_legacy_json_only_for_single_workspace`, `test_get_active_draft_skips_legacy_import_for_ambiguous_workspace`. |
| `/api/scenario/drafts` | `POST` | DB mode requires `current_request_auth_context()` and active user. | OAuth mode requires `X-Requested-With: jira-execution-planner` and token-bound `X-CSRF-Token`. | Saves by `(context.workspace_id, scope_key)`; first draft creates current-workspace row only. | JSON object with `scope_key`, `name`, `overrides`, optional/null `baseDraftRevision` only for first create, and display-safe `scope`. | `200 {"activeDraft": object, "versions": [...], "storage": "db"}` with incremented `draftRevision`. | `400 scope_key_required`; `400 invalid_scenario_overrides`; `400 scenario_scope_membership_not_allowed`; `401 auth_required`; `403 csrf_required`; `409 scenario_draft_conflict`; `503 config_storage_unavailable`. | `test_post_create_first_draft_allows_null_base_revision`, `test_post_update_requires_base_draft_revision`, `test_post_stale_base_returns_canonical_conflict`, `test_post_rejects_membership_scope_payload`, `test_post_requires_token_bound_csrf`. |
| `/api/scenario/drafts/<draft_id>/versions/<version_number>` | `GET` | DB mode requires `current_request_auth_context()` and active user. | None. | Load draft by id and return `404 scenario_draft_not_found` when missing or `draft.workspace_id != context.workspace_id`. | None. | `200` selected version payload including `overrides`, `versionNumber`, `draftRevision`, `source`, and `storage: "db"`. | `401 auth_required`; `404 scenario_draft_not_found`; `404 scenario_draft_version_not_found`; `503 config_storage_unavailable`. | `test_get_version_returns_snapshot_overrides`, `test_get_version_rejects_other_workspace_draft`, `test_get_version_missing_version_returns_not_found`. |
| `/api/scenario/drafts/<draft_id>/rollback` | `POST` | DB mode requires `current_request_auth_context()` and active user. | OAuth mode requires `X-Requested-With: jira-execution-planner` and token-bound `X-CSRF-Token`. | Load draft and target version by id under `context.workspace_id`; other-workspace ids return `404 scenario_draft_not_found`. | JSON object with `targetVersionNumber` and `baseDraftRevision`. | `200 {"activeDraft": object, "versions": [...], "storage": "db"}` with a new version whose `source` is `rollback`. | `400 target_version_required`; `400 base_draft_revision_required`; `401 auth_required`; `403 csrf_required`; `404 scenario_draft_not_found`; `404 scenario_draft_version_not_found`; `409 scenario_draft_conflict`. | `test_rollback_creates_new_version`, `test_rollback_requires_base_draft_revision`, `test_rollback_stale_base_returns_canonical_conflict`, `test_rollback_rejects_other_workspace_draft`. |
| `/api/scenario/overrides?scope_key=<scope>` | `GET` | OAuth-ready legacy alias; DB mode still resolves current request auth context before delegating. | None. | DB mode delegates only within `context.workspace_id`; basic/json-file mode reads the local JSON file. | None; `scope_key` query optional for legacy empty response. | DB mode `200` includes `overrides` plus additive `activeDraft`, `versions`, `storage: "db"`; basic/json-file mode preserves `{ "overrides": {} }`. | `401 auth_required` in DB/OAuth mode; no-scope legacy response remains `200 {"overrides": {}}`. | `test_legacy_get_delegates_to_active_draft_in_db_mode`, `test_legacy_get_preserves_json_fallback_shape_in_basic_mode`. |
| `/api/scenario/overrides` | `POST` | OAuth-ready legacy alias; DB mode still resolves current request auth context before rejecting. | DB/OAuth mode requires `X-Requested-With` and token-bound `X-CSRF-Token`; basic/json-file mode preserves current no-CSRF behavior. | DB mode may read current workspace draft state for conflict payload but never writes through the alias. | Basic/json-file body `{scope_key, name, overrides}`; DB mode rejects whether `baseDraftRevision` is absent or present. | Basic/json-file `200 {"ok": true}` only. | DB mode without `baseDraftRevision`: `409 scenario_draft_revision_required` with current `activeDraft`, `versions`, `storage: "db"`; DB mode with `baseDraftRevision`: `409 scenario_draft_api_required`; `403 csrf_required`; `401 auth_required`; `400 scope_key_required` in fallback mode. | `test_legacy_post_rejects_no_revision_in_db_mode`, `test_legacy_post_rejects_base_revision_in_db_mode`, `test_legacy_post_basic_mode_writes_json_without_csrf`. |

## Route Contract

### `GET /api/scenario/drafts?scope_key=<scope>`

Rules:
- `scope_key` is required.
- DB mode requires a current request auth context.
- If no DB draft exists, lazily import matching `scenario-overrides.json` data for this scope only when the current DB has a single workspace or `SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID == context.workspace_id`.
- If multiple workspaces exist and no import workspace is configured, do not import global JSON. Return `activeDraft: null`, `versions: []`, `storage: "db"` and log a sanitized warning.
- If no draft exists after import, return `activeDraft: null`, `versions: []`, `storage: "db"`.

When versions exist, each `versions[]` item must contain:

```json
{
  "versionNumber": 3,
  "draftRevision": 3,
  "overrideCount": 4,
  "createdAt": "2026-05-14T10:00:00Z",
  "createdBy": {"userId": "user-1", "displayName": "Ada"},
  "changeNote": "user save",
  "source": "user"
}
```

### `POST /api/scenario/drafts`

Request:

```json
{
  "scope_key": "2026Q2:sprint-34625:group-grp-default",
  "name": "Draft 2026-05-14",
  "baseDraftRevision": 3,
  "scope": {"sprintId": "34625", "groupId": "grp-default"},
  "overrides": {"PROD-1": {"start": "2026-05-18", "end": "2026-05-22"}}
}
```

Rules:
- `scope_key` is required.
- `overrides` must be an object whose values only contain supported scenario override fields currently used by the UI: `start` and `end`.
- Creating the first draft may omit `baseDraftRevision` or send it as `null`.
- Updating an existing draft requires `baseDraftRevision`.
- Stale `baseDraftRevision` returns the canonical `409 scenario_draft_conflict` body.
- Unsafe OAuth requests require both `X-Requested-With: jira-execution-planner` and a token-bound `X-CSRF-Token`.
- Successful save updates active draft and appends one version snapshot.

### `GET /api/scenario/drafts/<draft_id>/versions/<int:version_number>`

Returns the selected version including `overrides`. The draft must belong to the current workspace.

### `POST /api/scenario/drafts/<draft_id>/rollback`

Request:

```json
{
  "targetVersionNumber": 2,
  "baseDraftRevision": 4
}
```

Rules:
- Target version must belong to the draft and workspace.
- Stale `baseDraftRevision` returns the canonical `409 scenario_draft_conflict` body.
- Rollback copies the target version's overrides into the active draft and appends a new version with `source: "rollback"`.
- Unsafe OAuth requests require both `X-Requested-With: jira-execution-planner` and a token-bound `X-CSRF-Token`.

### Legacy `/api/scenario/overrides`

Keep current behavior:
- `GET /api/scenario/overrides?scope_key=<scope>` returns at least `{ "overrides": {} }`.
- JSON-file/basic mode `POST /api/scenario/overrides` accepts `{scope_key, name, overrides}` and returns `{ok: true}` for existing callers.

In DB mode:

- `GET /api/scenario/overrides` delegates to the active draft service and returns `overrides`, plus additive `activeDraft`, `versions`, and `storage: "db"` fields when available.
- `POST /api/scenario/overrides` must not last-write-wins into the DB. If the body lacks `baseDraftRevision`, return `409 scenario_draft_revision_required` with current `activeDraft`, `versions`, and `storage: "db"`. If the body includes `baseDraftRevision`, return `409 scenario_draft_api_required` with a message instructing callers to use `POST /api/scenario/drafts`; do not perform the write through the alias.
- Slice 02 removes all app frontend callers, so keeping this alias read-compatible does not keep it as an app source of truth.

DB-mode no-revision alias response:

```json
{
  "error": "scenario_draft_revision_required",
  "message": "Scenario draft writes require POST /api/scenario/drafts with baseDraftRevision.",
  "activeDraft": null,
  "versions": [],
  "storage": "db"
}
```

DB-mode alias response when a caller tries to supply `baseDraftRevision`:

```json
{
  "error": "scenario_draft_api_required",
  "message": "Use POST /api/scenario/drafts for DB-backed scenario draft writes.",
  "storage": "db"
}
```

## Task 1: Models And Migration

- [ ] Add both models to `backend/db/models.py`.
- [ ] Add Alembic revision `20260514_0004_scenario_drafts.py`.
- [ ] Add tests in `tests/test_scenario_drafts_db.py` for table creation, unique active scope, duplicate version rejection, `reload_from_jira` source support, deterministic `scenario_source_hash`, and downgrade cleanup.
- [ ] Add a shared-scope test proving two OAuth users in the same workspace/environment and same `scope_key` resolve the same active draft.
- [ ] Add a multi-workspace same-scope test proving two workspaces can each have one active draft for the same `scope_key`.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db
```

Expected: model/migration tests pass.

## Task 2: Draft Service

- [ ] Create `backend/scenario_drafts.py`.
- [ ] Implement `get_active_draft(context, scope_key, legacy_loader=None)`.
- [ ] Implement `save_draft(context, scope_key, name, overrides, base_draft_revision=None, scope_payload=None)`.
- [ ] Implement `get_version(context, draft_id, version_number)`.
- [ ] Implement `rollback_to_version(context, draft_id, target_version_number, base_draft_revision)`.
- [ ] Implement lazy legacy import from `scenario-overrides.json` without deleting or rewriting the JSON file, gated to a single workspace as described above.
- [ ] Implement recursive `scope_payload` validation that rejects membership-shaped fields.
- [ ] Raise explicit exceptions: `ScenarioDraftConflict`, `ScenarioDraftNotFound`, `ScenarioDraftValidationError`.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db
```

Expected: create, update, conflict, history, version fetch, rollback, and legacy import tests pass.

## Task 3: Routes And Auth

- [ ] Create `backend/routes/scenario_draft_routes.py` with the new route contract.
- [ ] Require token-bound CSRF for unsafe OAuth requests, matching `backend/routes/views_routes.py`.
- [ ] Register the blueprint in `backend/app.py`.
- [ ] Add `/api/scenario/drafts` and `/api/scenario/drafts/` descendants to OAuth-ready path handling.
- [ ] Add route tests proving unsafe OAuth draft routes require both `X-Requested-With: jira-execution-planner` and a token-bound `X-CSRF-Token`.
- [ ] Update `jira_server.py` legacy `/api/scenario/overrides` routes so DB-mode `GET` delegates to the draft service, DB-mode `POST` rejects the no-revision alias contract, and basic/json-file mode preserves the current JSON fallback.
- [ ] Add route tests proving draft save/load does not resolve Jira Basic, service-integration, Home/Townsquare, or `atlassian_user_api_token` credentials by patching these paths to raise: `jira_server.jira_get`, `jira_server.jira_post`, `jira_server.jira_request`, `backend.auth.home_credentials.resolve_home_credential`, `backend.auth.service_integrations.get_service_integration_summary`, and `backend.auth.service_integrations.list_service_integration_summaries`.
- [ ] Add service tests that call `backend/scenario_drafts.py` with an explicit `RequestAuthContext` and patch `jira_server.oauth_session_data` and `jira_server.save_oauth_session` to raise, proving draft persistence does not depend on local token-store helpers outside the shared CSRF/auth entrypoint.
- [ ] Add `tests/test_scenario_draft_security_source_guards.py` assertions that `backend/scenario_drafts.py` and `backend/routes/scenario_draft_routes.py` do not import or reference `OAUTH_TOKEN_STORE`, `oauth_session_data`, `save_oauth_session`, `resolve_home_credential`, `home_townsquare_basic`, `jira_basic`, `atlassian_user_api_token`, `jira_get`, `jira_post`, or `jira_request`.
- [ ] Add model/service/route tests proving `scope_payload` rejects `members`, `teamIds`, `memberUserIds`, and nested group definitions.
- [ ] Add an OAuth-ready path test proving `/api/scenario/drafts`, `/api/scenario/drafts/<draft_id>/rollback`, and later descendant prefixes are recognized before the unsafe-header guard.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_draft_routes tests.test_scenario_draft_security_source_guards tests.test_oauth_stats_routes
```

Expected: new routes enforce auth/CSRF in OAuth mode; DB-mode legacy alias rejects unsafe stale writes; JSON-file/basic override fallback remains intact.

## Task 4: Documentation And Regression

- [ ] Update `docs/features/scenario-planner.md` to replace JSON-only persistence with DB draft history plus legacy alias.
- [ ] Verify no Home/Townsquare write route is added.
- [ ] Verify no Jira write-back mutation is added.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db tests.test_scenario_draft_routes tests.test_scenario_draft_security_source_guards tests.test_oauth_stats_routes tests.test_config_jsonfile_fallback
```

Expected: focused backend suite passes and legacy JSON fallback remains intact.

## Commit Messages

- Task 1: `git commit -m "feat: add scenario draft schema"`
- Task 2: `git commit -m "feat: add scenario draft repository"`
- Task 3: `git commit -m "feat: add scenario draft API routes"`
- Task 4: `git commit -m "docs: document scenario draft persistence"`
