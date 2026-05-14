# Scenario Planner Quarter Drafts 01 Persistence/API

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Scenario Planner saved overrides from `scenario-overrides.json` to DB-backed active drafts with append-only version history and optimistic concurrency.

**Architecture:** Add `ScenarioDraft` and `ScenarioDraftVersion` models, a small `backend/scenario_drafts.py` service boundary, and `/api/scenario/drafts` routes. Keep `/api/scenario/overrides` as a compatibility alias backed by the same service in DB mode and by the existing JSON helpers in JSON-file mode.

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
| Modify | `jira_server.py` | Keep `/api/scenario/overrides` as compatibility alias and mark new draft paths OAuth-ready. |
| Create | `tests/test_scenario_drafts_db.py` | Model, migration, repository, versioning, rollback, legacy import tests. |
| Create | `tests/test_scenario_draft_routes.py` | Route contract, auth, CSRF, conflict, fallback tests. |
| Modify | `tests/test_oauth_stats_routes.py` | Keep existing `/api/scenario/overrides` OAuth/basic compatibility assertions passing. |
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
| `revision` | `Integer` | Starts at `1`; increments on save and rollback. |
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
| `source` | `String(32)` | Check constraint: `user`, `legacy_json`, `rollback`. |

Unique constraint: `(scenario_draft_id, version_number)`.

`scenario_source_hash` uses `sha256:` plus the SHA-256 hex digest of canonical JSON: sorted keys, compact separators, and only the scenario source fields used to compute visible draft state (`config`, `filters`, `issues`, `dependencies`, and sprint boundaries). Do not include auth/session/user fields in the hash input.

## Guardrails

### OAuth-Only Jira Publishing

This slice stores local Scenario draft state only and must not add Jira mutation routes. If a later plan adds Jira publish/write-back, it must use only the current request's signed-in Atlassian OAuth Jira REST context. It must not use Jira Basic credentials, workspace service integrations, Home/Townsquare APIs, `home_townsquare_basic`, `jira_basic`, `atlassian_user_api_token`, or local OAuth token-store helpers for publishing.

### Shared Group Configuration

Group configuration is a shared environment-scoped entity created and maintained by project managers/EPMs. `ScenarioDraft.scope_payload` may include `groupId`, `groupName`, and a non-authoritative group config hash/version if available, but the Scenario draft must not own group membership or create per-user group copies.

The active draft uniqueness rule stays `(workspace_id, scope_key)` so two signed-in users in the same workspace/environment and group scope see the same active draft.

## Route Contract

### `GET /api/scenario/drafts?scope_key=<scope>`

Rules:
- `scope_key` is required.
- DB mode requires a current request auth context.
- If no DB draft exists, lazily import matching `scenario-overrides.json` data for this scope.
- If no draft exists after import, return `activeDraft: null`, `versions: []`.

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
  "baseRevision": 3,
  "scope": {"sprintId": "34625", "groupId": "grp-default"},
  "overrides": {"PROD-1": {"start": "2026-05-18", "end": "2026-05-22"}}
}
```

Rules:
- `scope_key` is required.
- `overrides` must be an object whose values only contain supported scenario override fields currently used by the UI: `start` and `end`.
- Creating the first draft may omit `baseRevision`.
- Updating an existing draft requires `baseRevision`.
- Stale `baseRevision` returns `409 scenario_draft_conflict` and the current active draft.
- Successful save updates active draft and appends one version snapshot.

### `GET /api/scenario/drafts/<draft_id>/versions/<int:version_number>`

Returns the selected version including `overrides`. The draft must belong to the current workspace.

### `POST /api/scenario/drafts/<draft_id>/rollback`

Request:

```json
{
  "targetVersionNumber": 2,
  "baseRevision": 4
}
```

Rules:
- Target version must belong to the draft and workspace.
- Stale `baseRevision` returns `409 scenario_draft_conflict`.
- Rollback copies the target version's overrides into the active draft and appends a new version with `source: "rollback"`.

### Legacy `/api/scenario/overrides`

Keep current behavior:
- `GET /api/scenario/overrides?scope_key=<scope>` returns at least `{ "overrides": {} }`.
- `POST /api/scenario/overrides` accepts `{scope_key, name, overrides}` and returns `{ok: true}` for existing callers.

In DB mode, include additive draft metadata but preserve `overrides`.

## Task 1: Models And Migration

- [ ] Add both models to `backend/db/models.py`.
- [ ] Add Alembic revision `20260514_0004_scenario_drafts.py`.
- [ ] Add tests in `tests/test_scenario_drafts_db.py` for table creation, unique active scope, duplicate version rejection, and downgrade cleanup.
- [ ] Add a shared-scope test proving two OAuth users in the same workspace/environment and same `scope_key` resolve the same active draft.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db
```

Expected: model/migration tests pass.

## Task 2: Draft Service

- [ ] Create `backend/scenario_drafts.py`.
- [ ] Implement `get_active_draft(context, scope_key, legacy_loader=None)`.
- [ ] Implement `save_draft(context, scope_key, name, overrides, base_revision=None, scope_payload=None)`.
- [ ] Implement `get_version(context, draft_id, version_number)`.
- [ ] Implement `rollback_to_version(context, draft_id, target_version_number, base_revision)`.
- [ ] Implement lazy legacy import from `scenario-overrides.json` without deleting or rewriting the JSON file.
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
- [ ] Update `jira_server.py` legacy `/api/scenario/overrides` routes to delegate to the draft service in DB mode and retain JSON fallback in basic/json-file mode.
- [ ] Add route tests proving draft save/load does not resolve Jira Basic, service-integration, Home/Townsquare, or `atlassian_user_api_token` credentials.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_draft_routes tests.test_oauth_stats_routes
```

Expected: new routes enforce auth/CSRF in OAuth mode; existing override tests still pass in OAuth and basic modes.

## Task 4: Documentation And Regression

- [ ] Update `docs/features/scenario-planner.md` to replace JSON-only persistence with DB draft history plus legacy alias.
- [ ] Verify no Home/Townsquare write route is added.
- [ ] Verify no Jira write-back mutation is added.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db tests.test_scenario_draft_routes tests.test_oauth_stats_routes tests.test_config_jsonfile_fallback
```

Expected: focused backend suite passes and legacy JSON fallback remains intact.

## Commit Messages

- Task 1: `git commit -m "feat: add scenario draft schema"`
- Task 2: `git commit -m "feat: add scenario draft repository"`
- Task 3: `git commit -m "feat: add scenario draft API routes"`
- Task 4: `git commit -m "docs: document scenario draft persistence"`
