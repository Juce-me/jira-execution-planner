# Shared Admin Configuration Implementation Plan

> **Status:** Done. Executed and merged in PR #130 (`7ea40db`). Kept for audit context only; do not execute as an active plan.

> **Current accuracy:** The workspace administrator persistence, revision, recovery, and team-catalog work remains current. Only this plan's decision to share EPM configuration is superseded by `EXEC-user-owned-epm-configuration.md` and `backend/security/CONFIGURATION_OWNERSHIP.md`: EPM scope, label prefix, issue types, and project-label mappings belong to the owning user's default private saved view. EPM tab and sprint remain private UI state; existing private-view values are preserved but are not promoted to shared configuration. Misplaced workspace EPM is removed into a reversible migration archive without inferring an owner.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist administrator-controlled dashboard and EPM configuration once per workspace/Jira site so every user in that workspace reads the same values, without allowing private views, normal-user catalog refreshes, stale saves, or a process-wide JSON fallback to cross the ownership boundary.

**Architecture:** Add a revisioned `WorkspaceDashboardConfig` for allowlisted administrator sections and a separate `WorkspaceTeamCatalog` for the existing normal-user catalog refresh path. Resolve both by request-derived `workspace_id`, keep private saved views owner-scoped and runtime-sanitized, use section-scoped compare-and-swap writes with explicit conflict recovery, and permit legacy JSON fallback only for the matching configured Jira site.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy 2, Alembic, React 19, esbuild, `unittest`, Node test runner, Playwright, SQLite/PostgreSQL-compatible schema.

**Spec:** `docs/agents/bugfixes/2026-08-26-in-progress-shared-admin-configuration.md`

## Global Constraints

- Work on `bugfix/shared-admin-configuration`, not `main`.
- Share by resolved workspace/Jira site, never by a process-global environment key alone.
- Use request-derived `workspace_id` and actor identity; reject identity fields in request/config payloads.
- Store only `version`, `projects`, `board`, `capacity`, `sprintField`, `storyPointsField`, `parentNameField`, `teamField`, `projectTrackField`, `deliveryOwnerField`, `statsPriorityWeights`, `issueTypes`, and `epm` in `workspace_dashboard_configs`; reject unknown or malformed shared fields.
- Within `epm`, share only `version`, `labelPrefix`, `scope`, `issueTypes`, and `projects`. Keep personal `tab` and `selectedSprint` state in private views.
- Keep `/api/me/views` owner-scoped; existing stored rows remain exportable, but private runtime payloads cannot override shared configuration sections or shared EPM keys. A private top-level `version` remains structural metadata, not an override.
- Keep `teamGroups` in `workspace_group_configs` and per-user group preferences in `user_group_preferences`.
- Keep `/api/team-catalog` a normal authenticated-user write, but persist it in `workspace_team_catalogs`, not the administrator row or a private view.
- Make the schema migration data-neutral. Never auto-publish a private view into workspace configuration; require explicit fingerprint-confirmed recovery.
- Seed Settings values and their base revision from one atomic `/api/config` shared snapshot; never pair independently loaded section values with a newer revision.
- Preserve `shared_admin_write`, `SETTINGS_ADMIN_ONLY`, token-bound CSRF, and `X-Requested-With` behavior.
- Preserve JSON-file/basic mode and require revisions only in DB/OAuth mode.
- Do not add polling, SSE, or cross-user event transport; stale-save `409` plus explicit reload is the remote-change mechanism for this slice.
- Do not add startup requests or Jira/Home fan-out. Build the bootstrap snapshot from one workspace-config DB read and reuse it for existing compatibility fields.
- Do not add dependencies, Home/Townsquare mutations, Jira mutations, or service/personal credential paths.
- `GATE-05-home-write-capability.md` remains blocked as checked on 2026-08-26; this plan adds no Home/Townsquare write and does not depend on that gate passing.
- Do not log config payloads, Jira/Home identifiers, field ids, workspace/user ids discovered from the database, or credential material.
- Frontend source changes require `npm run build`; commit the generated `frontend/dist/` diff.

---

## Validation Findings Resolved By This Plan

| Severity | Draft flaw | Required correction |
| --- | --- | --- |
| Blocker | `change_note='compatibility save'` is not exclusive to administrator routes: `/api/team-catalog` also reaches `save_dashboard_config()`. Even a sole marked private version can be stale or catalog-originated. | Perform no automatic content backfill. Preserve private history and require explicit, fingerprint-confirmed recovery from one exact immutable version. |
| P1 | `GET /api/config?includeViewConfig=true` currently lets `viewConfig.view.epm` override the shared EPM source. | Make shared EPM scope/mappings authoritative and sanitize private runtime payloads; update the current-accuracy notes for the earlier user-owned EPM plans after execution. |
| P1 | Whole-payload read/modify/write loses concurrent administrator changes and lets a user-writable catalog save replay stale administrator sections. | Replace DB full-payload saves with route-owned section compare-and-swap updates and explicit `409` recovery. |
| P1 | Independent section GETs can return values from different revisions. Pairing a stale section value with the newest global revision can overwrite a remote edit without a conflict. | Return one atomic `sharedConfig` plus `sharedConfigRevision` from `/api/config` and seed all Settings shared drafts from that snapshot. |
| P1 | The legacy JSON fallback is process-wide and not bound to the request workspace. | Allow it only when the request Jira site exactly matches the configured legacy Jira site; otherwise return an empty revision-zero snapshot. |
| P1 | The original row has `payload_version` but no concurrency revision or conflict contract. | Add monotonic `config_revision`, `baseRevision`, conflict JSON, dirty-draft preservation, and retry/use-latest behavior. |
| P2 | `validate_user_view_payload()` blocks secrets but does not define administrator vs personal ownership. | Add an explicit shared-section allowlist and private-view shared-field rejection/runtime stripping. |
| P2 | One route regression cannot prove the full shared-config surface, and five field endpoints hide their generic save in `jira_server._save_field_config()`. | Test every route in the endpoint matrix, cut over the shared helper, and cover both authorization modes, two workspaces, stale saves, private-view precedence, and team-catalog privilege separation. |
| P2 | Current attribution is overwritten on each save and is not visible in the existing admin audit stream. | Add a redacted `workspace_dashboard_config_updated` audit event containing only section and revision. |
| P2 | Separating the user-writable team catalog removes privilege mixing but a read/merge/write implementation can still lose concurrent discoveries. | Give the catalog an internal revision and use bounded server-side compare-and-swap retry without exposing it as an administrator revision. |

Evidence: the private repository read/write boundary is in `backend/config/db_repository.py:62-130`; `/api/config` selects private EPM at `backend/routes/settings_routes.py:287-316`; normal-user catalog writes reach the generic save at `backend/routes/settings_routes.py:500-524`; administrator compatibility saves are spread across `backend/routes/settings_routes.py:862-1205`, `backend/routes/epm_routes.py:221-258`, and `jira_server.py:5963-5975`; route policies are registered at `backend/security/policy.py:97-129`; and the existing sequential Settings save flow is in `frontend/src/dashboard.jsx:3152-3339`.

## File And Module Map

- Create `backend/config/shared_config.py`: ownership constants, payload sanitization, legacy-site binding, and private runtime stripping.
- Create `backend/services/workspace_dashboard_config.py`: DB snapshots, optimistic section updates, conflict objects, audit insertion, and team-catalog persistence.
- Modify `backend/config/db_repository.py`: delegate shared reads/writes to the new service while preserving private-view resolution as a separate interface.
- Modify `backend/config/view_validation.py`: reject shared-only fields from new/updated private views without deleting old rows.
- Modify `backend/config/import_config.py`: split legacy imports so private views receive personal state only.
- Modify `backend/db/models.py`: add `WorkspaceDashboardConfig` and `WorkspaceTeamCatalog`.
- Create `backend/db/migrations/versions/20260826_0007_workspace_dashboard_config.py`: schema only; no private-view content migration.
- Create `scripts/promote_legacy_shared_admin_config.py`: explicit dry-run/fingerprint/apply recovery for one operator-selected immutable version.
- Modify `jira_server.py`: request-scoped config snapshot wrapper, safe fallback binding, DB section-save wrapper, and DB full-replacement guard.
- Modify `backend/routes/settings_routes.py` and `backend/routes/epm_routes.py`: revision-aware reads/writes and section-specific conflict responses.
- Modify `frontend/src/api/configApi.js`, `frontend/src/api/epmApi.js`, `frontend/src/settings/useJiraFieldPickers.js`, and `frontend/src/dashboard.jsx`: revision threading and dirty-draft conflict recovery.
- Create `frontend/src/settings/workspaceConfigConflict.js`: pure conflict/retry/message helpers.
- Modify focused Python/Node/Playwright tests, `docs/README_ANALYTICS.md`, generated `frontend/dist/`, plan/history docs, and `AGENTS.md` as named below.

## Endpoint Contract Matrix

All DB/OAuth POST routes below require an active session, `X-Requested-With: jira-execution-planner`, and a token-bound `X-CSRF-Token`. Administrator POST routes additionally require `baseRevision` and remain `shared_admin_write`; `/api/team-catalog` remains `user_write` with no client revision field. JSON/basic mode keeps current bodies and ignores an absent administrator revision.

| Route | Policy | Request body | Success body additions | Errors that must be tested |
| --- | --- | --- | --- | --- |
| `GET /api/config?includeViewConfig=true` | `authenticated_read` | none | atomic `sharedConfig` plus `sharedConfigRevision`; shared `epm`; sanitized `viewConfig` kept separate | `401 auth_required`, `503 config_storage_unavailable` |
| `GET/POST /api/projects/selected` | read / `shared_admin_write` | `{selected, baseRevision}` | `configRevision` | `400` shape/implicit clear, `401`, `403` CSRF/admin, `409`, `503` |
| `GET/POST /api/board-config` | read / `shared_admin_write` | `{boardId, boardName, baseRevision}` | `configRevision` | `400` non-numeric id, `401`, `403`, `409`, `503` |
| `GET/POST /api/capacity/config` | read / `shared_admin_write` | `{project, fieldId, fieldName, baseRevision}` | `configRevision` | `400` shape, `401`, `403`, `409`, `503` |
| `GET/POST /api/sprint-field/config` | read / `shared_admin_write` | `{fieldId, fieldName, baseRevision}` | `configRevision` | `400`, `401`, `403`, `409`, `503` |
| `GET/POST /api/story-points-field/config` | read / `shared_admin_write` | `{fieldId, fieldName, baseRevision}` | `configRevision` | `400`, `401`, `403`, `409`, `503` |
| `GET/POST /api/parent-name-field/config` | read / `shared_admin_write` | `{fieldId, fieldName, baseRevision}` | `configRevision` | `400`, `401`, `403`, `409`, `503` |
| `GET/POST /api/team-field/config` | read / `shared_admin_write` | `{fieldId, fieldName, baseRevision}` | `configRevision` | `400`, `401`, `403`, `409`, `503` |
| `GET/POST /api/delivery-owner-field/config` | read / `shared_admin_write` | `{fieldId, fieldName, baseRevision}` | `configRevision` | `400`, `401`, `403`, `409`, `503` |
| `GET/POST /api/stats/priority-weights-config` | read / `shared_admin_write` | `{weights, baseRevision}` | `configRevision` | `400` normalization, `401`, `403`, `409`, `503` |
| `GET/POST /api/issue-types/config` | read / `shared_admin_write` | `{issueTypes, baseRevision}` | `configRevision` | `400` shape, `401`, `403`, `409`, `503` |
| `GET/POST /api/epm/config` | read / `shared_admin_write` | normalized EPM object plus `baseRevision` | `configRevision` | `400` identity/shape, `401`, `403`, `409`, `503` |
| `GET/POST /api/team-catalog` | read / `user_write` | exactly `{catalog, meta, merge}` | unchanged `{catalog, meta}` | `400` unknown/identity fields, `401`, `403` CSRF, `409 team_catalog_conflict`, `503`; never `admin_required` |

The DB/OAuth bootstrap additions have this shape; `sharedConfig` contains no workspace, actor, credential, or private-view fields:

```json
{
  "sharedConfig": {
    "version": 1,
    "board": {"boardId": "7", "boardName": "Planning"},
    "epm": {"version": 2, "scope": {}, "projects": {}}
  },
  "sharedConfigRevision": 3,
  "epm": {"version": 2, "scope": {}, "projects": {}},
  "viewConfig": {
    "source": "user_saved_view",
    "viewType": "mixed",
    "view": {"filters": {}, "epm": {"tab": "active", "selectedSprint": "Active"}}
  }
}
```

The common stale-write body is exact:

```json
{
  "error": "workspace_config_conflict",
  "message": "Shared settings changed while you were editing. Your changes are still unsaved.",
  "currentRevision": 7,
  "current": {
    "section": "board",
    "value": {},
    "configRevision": 7
  }
}
```

---

### Task 1: Define The Ownership And Validation Boundary

**Files:**
- Create: `backend/config/shared_config.py`
- Modify: `backend/config/view_validation.py:9-78`
- Modify: `backend/config/import_config.py:63-127`
- Modify: `backend/config/db_repository.py:28-31,83-98`
- Create: `tests/test_shared_admin_config_validation.py`
- Modify: `tests/test_user_view_config_routes.py`
- Modify: `tests/test_view_config_resolution.py`
- Modify: `tests/test_config_jsonfile_fallback.py`

**Interfaces:**
- Produces: `ADMIN_CONFIG_SECTIONS: frozenset[str]` with the exact top-level keys listed in Global Constraints.
- Produces: `PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS = ADMIN_CONFIG_SECTIONS - {'version', 'epm'}`; top-level `version` remains private structural metadata and `epm` is split by key ownership.
- Produces: `SHARED_EPM_KEYS = frozenset({'version', 'labelPrefix', 'scope', 'issueTypes', 'projects'})`.
- Produces: `PERSONAL_EPM_KEYS = frozenset({'tab', 'selectedSprint'})`.
- Produces: `normalize_workspace_admin_payload(payload: dict, *, allow_legacy_excluded_fields: bool = False) -> dict` using the same exact section normalizers as live routes.
- Produces: `strip_shared_sections_from_private_view(payload: dict) -> dict`.
- Produces: `validate_private_view_ownership(payload: dict) -> None`.
- Produces: `legacy_fallback_matches_workspace(context, legacy_site_url: str) -> bool`.
- `resolve_effective_view_config()` continues to return `source`, `workspaceId`, `viewConfigId`, `viewType`, and `view`, but `view` is runtime-sanitized.

- [x] **Step 1: Write failing allowlist and private-view tests**

Add table-driven tests with synthetic data:

```python
def test_workspace_payload_keeps_only_admin_sections(self):
    payload = {
        'version': 1,
        'board': {'boardId': '7'},
        'epm': {'version': 2, 'scope': {'rootGoalKey': 'GOAL-1'}},
        'filters': {'projectKeys': ['PRIVATE']},
        'eng': {'mode': 'planning'},
        'teamGroups': {'groups': []},
        'teamCatalog': {'catalog': {}},
    }
    normalized = normalize_workspace_admin_payload(payload, allow_legacy_excluded_fields=True)
    self.assertEqual(set(normalized), {'version', 'board', 'epm'})
    self.assertEqual(normalized['board'], {'boardId': '7', 'boardName': ''})
    self.assertEqual(normalized['epm']['scope']['rootGoalKey'], 'GOAL-1')

def test_private_runtime_view_cannot_override_shared_epm(self):
    payload = {
        'version': 1,
        'filters': {'projectKeys': ['PRODUCT']},
        'epm': {
            'tab': 'active',
            'selectedSprint': 'Active',
            'scope': {'rootGoalKey': 'PRIVATE'},
            'projects': {'private': {}},
        },
    }
    self.assertEqual(
        strip_shared_sections_from_private_view(payload),
        {
            'version': 1,
            'filters': {'projectKeys': ['PRODUCT']},
            'epm': {'tab': 'active', 'selectedSprint': 'Active'},
        },
    )
```

Also assert recursive rejection of `workspaceId`, `workspace_id`, `userId`, `user_id`, `accountId`, `cloudId`, `siteUrl`, token/service keys, raw GraphQL operations, unknown top-level shared payload keys, unknown nested fields, and malformed section values. Assert that one forbidden or malformed shared field rejects the whole recovery/persistence candidate rather than silently publishing a partial payload.

- [x] **Step 2: Run the focused tests to verify RED**

Run: `.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_user_view_config_routes tests.test_view_config_resolution`

Expected: FAIL because the ownership helpers do not exist and private EPM still passes through runtime resolution.

- [x] **Step 3: Implement pure ownership and section-shape helpers**

Use one source of truth for sensitive-key detection by reusing `FORBIDDEN_VIEW_PAYLOAD_KEYS`/the recursive collector rather than copying token names. Extract or wrap the existing pure section normalizers so live routes, fallback reads, recovery, and persistence all produce the same canonical shapes. Client writes use the strict default. Legacy fallback/recovery may set `allow_legacy_excluded_fields=True` to discard only the exact known legacy keys `filters`, `eng`, `teamGroups`, and `teamCatalog`; any other unknown top-level key, forbidden key, unknown nested shared field, or malformed shared section rejects the entire candidate. Do not maintain a second migration-only schema.

Implement exact site matching with normalized scheme/host/path and no substring or suffix matching. `https://example.atlassian.net` matches the same URL with a trailing slash; it does not match `https://other.example.atlassian.net` or an empty configured site.

- [x] **Step 4: Split private import and runtime behavior**

Make new/updated private views reject shared-only top-level sections and shared EPM keys with `invalid_view_payload`, while allowing only the documented personal EPM state. Make `resolve_effective_view_config()` strip shared fields from runtime output. Keep raw stored payload/version rows unchanged and keep `export_view_config_json()` able to export the historical row for operator recovery.

Change `import_dashboard_config()` so a legacy file import writes only the personal portion to `ViewConfig`; it must not create or replace workspace administrator configuration as a side effect.

- [x] **Step 5: Run the focused tests to verify GREEN**

Run: `.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_user_view_config_routes tests.test_view_config_resolution tests.test_config_jsonfile_fallback`

Expected: PASS with private ownership/isolation, raw-history preservation, runtime stripping, and exact legacy-site matching.

- [x] **Step 6: Commit the ownership boundary**

```bash
git add backend/config/shared_config.py backend/config/view_validation.py backend/config/import_config.py backend/config/db_repository.py tests/test_shared_admin_config_validation.py tests/test_user_view_config_routes.py tests/test_view_config_resolution.py tests/test_config_jsonfile_fallback.py
git commit -m "Define shared configuration ownership"
```

### Task 2: Add Workspace Persistence And Safe Recovery

**Files:**
- Modify: `backend/db/models.py:194-226`
- Create: `backend/db/migrations/versions/20260826_0007_workspace_dashboard_config.py`
- Create: `scripts/promote_legacy_shared_admin_config.py`
- Modify: `tests/test_db_migrations.py`
- Create: `tests/test_shared_admin_config_recovery.py`

**Interfaces:**
- Produces: `models.WorkspaceDashboardConfig(id, workspace_id, payload_version, payload, config_revision, created_by, updated_by, created_at, updated_at)`.
- Produces: `models.WorkspaceTeamCatalog(id, workspace_id, payload_version, payload, config_revision, updated_by, created_at, updated_at)`.
- Both tables are unique on `workspace_id` and cascade on workspace deletion; user attribution uses `ON DELETE SET NULL`.
- Recovery CLI accepts `--workspace-id`, `--view-config-id`, `--version-number`, `--expected-sha256`, and `--apply`; dry-run is the default and `--expected-sha256` is mandatory with `--apply`.

- [x] **Step 1: Write failing schema/migration tests**

Extend `tests/test_db_migrations.py` to upgrade a database at `20260604_0006`, then assert both new tables, exact columns, foreign keys, and unique constraints. Add downgrade-to-`20260604_0006`, re-upgrade, and offline SQL assertions.

Seed four synthetic cases before upgrade:

1. one active admin with a marked version containing admin plus private/catalog fields;
2. a normal user's later marked team-catalog version;
3. a later `user update` after a marked version; and
4. two active admins with divergent marked versions.

After upgrade, assert that all private rows and versions are unchanged and `workspace_dashboard_configs` is empty in every case. Migration must never infer publishable shared state from private history.

- [x] **Step 2: Run the migration test to verify RED**

Run: `.venv/bin/python -m unittest tests.test_db_migrations`

Expected: FAIL because revision `20260826_0007` and both tables do not exist.

- [x] **Step 3: Add models and migration**

Use revision `20260826_0007` with `down_revision='20260604_0006'`. Set server-safe non-null defaults in the migration for payload version, JSON payload, and revision; do not rely only on ORM defaults.

Create only the tables, constraints, indexes, server-safe defaults, and downgrade path. Do not import application helpers or inspect/copy `view_configs` or `view_config_versions` in the migration. Migration output must not report private candidate data because no candidate selection occurs.

- [x] **Step 4: Write failing recovery-command tests**

Test dry-run, explicit apply, missing/mismatched `--expected-sha256`, wrong-workspace rejection, actor/owner mismatch, non-marked-version rejection, inactive/non-admin actor rejection, forbidden/malformed candidate rejection, existing-row refusal, and output redaction. The test must assert that project keys, Home ids, field ids, user ids read from the database, and payload JSON are absent from stdout/stderr.

- [x] **Step 5: Implement the recovery command**

Resolve the configured DB through existing engine helpers. Read the exact immutable version payload, verify the selected view/version plus matching active-admin actor/owner, and call the same strict shared-section normalizer as live persistence. Print only operator-supplied identifiers, included section names, and a canonical `sha256:` fingerprint. With `--apply`, require the exact fingerprint from dry-run and recheck it in the insertion transaction before inserting revision `1`. Do not add an overwrite flag.

- [x] **Step 6: Run persistence/recovery tests to verify GREEN**

Run: `.venv/bin/python -m unittest tests.test_db_migrations tests.test_shared_admin_config_recovery`

Expected: PASS with a data-neutral schema migration, upgrade/downgrade/re-upgrade, offline SQL, fingerprint-verified explicit recovery, and redacted output.

- [x] **Step 7: Commit persistence**

```bash
git add backend/db/models.py backend/db/migrations/versions/20260826_0007_workspace_dashboard_config.py scripts/promote_legacy_shared_admin_config.py tests/test_db_migrations.py tests/test_shared_admin_config_recovery.py
git commit -m "Add workspace configuration persistence"
```

### Task 3: Implement Revisioned Repository Services

**Files:**
- Create: `backend/services/workspace_dashboard_config.py`
- Modify: `backend/config/db_repository.py:34-131`
- Modify: `jira_server.py:1640-1699`
- Modify: `tests/test_config_jsonfile_fallback.py`
- Create: `tests/test_workspace_dashboard_config_service.py`
- Modify: `tests/test_team_catalog_api.py`
- Modify: `tests/test_config_storage_selector.py`
- Modify: `tests/test_codebase_structure_budgets.py` only if the new extracted module legitimately changes a guarded budget.

**Interfaces:**

```python
@dataclass(frozen=True)
class WorkspaceConfigSnapshot:
    payload: dict
    config_revision: int
    source: str  # 'workspace_db', 'legacy_json', or 'empty'

class WorkspaceConfigConflict(Exception):
    current: WorkspaceConfigSnapshot
    section: str

def load_workspace_config(context, *, fallback_loader=None, legacy_site_url='', database_url=None) -> WorkspaceConfigSnapshot: ...
def update_workspace_config_section(context, section, value, base_revision, *, database_url=None) -> WorkspaceConfigSnapshot: ...
def load_workspace_team_catalog(context, *, database_url=None) -> dict: ...
def save_workspace_team_catalog(context, payload, *, merge=False, database_url=None) -> dict: ...
```

- `DbConfigRepository.load_dashboard_config()` remains a dict-returning compatibility wrapper over the snapshot.
- `DbConfigRepository.load_dashboard_config_snapshot()` exposes revision/source to routes.
- `DbConfigRepository.save_dashboard_config()` must no longer replace a DB payload or touch `ViewConfig`; DB callers use `save_dashboard_section()`.
- `jira_server.load_dashboard_config_snapshot()` caches one DB read in Flask `g` for the request; `load_dashboard_config()` returns `.payload`.

- [x] **Step 1: Write failing workspace service tests**

Cover same-workspace cross-user reads, second-workspace isolation, revision-zero empty/fallback snapshots, exact-site fallback allow/deny, read-without-write, section allowlisting, actor attribution, and audit metadata.

Add a concurrency test where two admins load revision `1`, the first updates `board` to revision `2`, and the second update returns `WorkspaceConfigConflict` with revision `2`; assert the first value remains stored. Assert that an existing workspace row remains authoritative and is never merged with later JSON fallback changes, including when a stored section is intentionally empty.

Add an insert race test where two revision-zero writers target the same workspace. Exactly one creates revision `1`; the other receives a conflict rather than `IntegrityError`/`500`. Add a matching-site legacy fallback test proving the first section write copies the latest normalized fallback snapshot and replaces only its route-owned section; a non-matching workspace must not copy any fallback data.

Add a team-catalog merge race where two users add different synthetic team mappings from the same internal catalog revision. The bounded compare-and-swap retry must preserve both mappings and must not touch the administrator revision or audit stream.

- [x] **Step 2: Run service tests to verify RED**

Run: `.venv/bin/python -m unittest tests.test_workspace_dashboard_config_service tests.test_config_jsonfile_fallback tests.test_team_catalog_api`

Expected: FAIL because the shared services and separate catalog repository do not exist.

- [x] **Step 3: Implement atomic section compare-and-swap**

Parse `base_revision` as a non-negative integer. For an existing row, load its payload, replace only the hard-coded section, and execute `UPDATE ... WHERE workspace_id=:workspace_id AND config_revision=:base_revision`. Increment revision and add the redacted audit event in the same transaction. If `rowcount != 1`, reload only the current workspace and raise `WorkspaceConfigConflict`.

For revision zero, reload the current exact-site fallback at write time, normalize it, replace only the route-owned section, and attempt a unique insert. This preserves untouched legacy sections during first-write cutover. A non-matching workspace starts from the empty snapshot. Translate a unique race into the same conflict object in a fresh transaction; do not leak a database exception.

- [x] **Step 4: Implement team-catalog separation**

Load/save only `WorkspaceTeamCatalog`. Normalize route input before the service call. For merge writes, conditionally update on the internal catalog revision and retry from the latest row a bounded number of times; convert exhausted contention to a catalog-specific conflict rather than losing entries. An unprivileged request cannot name an administrator section or call the administrator update interface. Do not expose the internal revision as `baseRevision`, increment the administrator `config_revision`, or add `workspace_dashboard_config_updated` audit events.

- [x] **Step 5: Add request-scoped snapshot caching and DB full-save guard**

Use one snapshot per Flask request so `/api/config` and its helper getters do not issue repeated DB config queries. `/api/config` must serialize `sharedConfig` and `sharedConfigRevision` from that same immutable snapshot. Replace the cached snapshot after a successful section save. Preserve `source='jsonfile'` for startup/no-request paths. In DB mode, make the legacy generic full-save wrapper fail closed with a clear internal error and remove its `compatibility save` marker/default so future route code cannot silently reintroduce whole-payload writes or create false recovery provenance.

- [x] **Step 6: Run repository/service tests to verify GREEN**

Run: `.venv/bin/python -m unittest tests.test_workspace_dashboard_config_service tests.test_config_jsonfile_fallback tests.test_team_catalog_api tests.test_config_storage_selector tests.test_view_config_resolution`

Expected: PASS with one request-scoped read, cross-user sharing, cross-workspace denial, safe fallback, atomic conflicts, team-catalog separation, and private-view isolation.

- [x] **Step 7: Commit repository services**

```bash
git add backend/services/workspace_dashboard_config.py backend/config/db_repository.py jira_server.py tests/test_workspace_dashboard_config_service.py tests/test_config_jsonfile_fallback.py tests/test_team_catalog_api.py tests/test_config_storage_selector.py tests/test_view_config_resolution.py tests/test_codebase_structure_budgets.py
git commit -m "Route shared settings through workspace storage"
```

### Task 4: Wire Every Route And Security Contract

**Files:**
- Modify: `backend/routes/settings_routes.py:287-524,862-1205`
- Modify: `backend/routes/epm_routes.py:67-69,221-258`
- Modify: `jira_server.py:5963-5975`
- Modify: `backend/security/policy.py:92-129` only if implementation changes a policy classification
- Modify: `tests/test_dashboard_bootstrap_config_source.py`
- Modify: `tests/test_endpoint_security_matrix.py`
- Modify: `tests/test_oauth_settings_routes.py`
- Modify: `tests/test_epm_config_api.py`
- Modify: `tests/test_user_view_config_routes.py`
- Modify: `tests/test_db_admin_routes.py`
- Modify: `tests/test_backend_route_source_guards.py`

**Interfaces:**
- Routes implement the exact matrix above.
- DB/OAuth section reads return `configRevision`; `/api/config` returns `sharedConfig` and `sharedConfigRevision` from one snapshot. JSON/basic reads retain the current body.
- DB/OAuth writes require `baseRevision`; JSON/basic writes do not.
- Conflict JSON is produced by one shared helper and contains only the route-owned current section.

- [x] **Step 1: Expand the security matrix before route code**

Put every POST route from the matrix in `SECURITY_SAMPLES['shared_admin_write']` except `/api/team-catalog`, which remains in `user_write`. Parameterize tests so each route proves:

- anonymous OAuth returns `401 auth_required`;
- missing `X-Requested-With` returns `403 csrf_required` before route code;
- missing/invalid token-bound CSRF returns `403 csrf_required` before route code;
- non-admin returns `403 admin_required` when `SETTINGS_ADMIN_ONLY=true`;
- authenticated non-admin reaches the route when `SETTINGS_ADMIN_ONLY=false`.

- [x] **Step 2: Write failing two-workspace and bootstrap regressions**

Seed Admin A, Admin B, and a normal user in workspace 1 plus Admin C in workspace 2. Save each administrator section through its real route as Admin A, then read it as Admin B and the normal user. Assert Admin C receives workspace 2's empty/default value and never workspace 1's conflict body.

For `/api/config?includeViewConfig=true`, seed a private view with personal `epm.tab`/`epm.selectedSprint` plus conflicting shared `epm.scope`. Assert response `epm` and `sharedConfig.epm` come from `WorkspaceDashboardConfig`, the two revision fields describe that same snapshot, and `viewConfig.view.epm` retains only the personal keys.

Add a regression that changes one section between two compatibility GETs and proves Settings initialization still uses all values plus the revision from the single `/api/config` snapshot. It must never combine an older section body with the newer revision.

Patch Jira REST and Home/Townsquare fetch symbols to fail if called by `/api/config`, and assert the bootstrap performs one workspace-config repository read. Record the before/after startup request count; it must not increase.

- [x] **Step 3: Run route/security tests to verify RED**

Run: `.venv/bin/python -m unittest tests.test_dashboard_bootstrap_config_source tests.test_endpoint_security_matrix tests.test_oauth_settings_routes tests.test_epm_config_api tests.test_user_view_config_routes tests.test_db_admin_routes`

Expected: FAIL because routes neither expose/require revisions nor isolate shared EPM from private views.

- [x] **Step 4: Replace read/modify/full-save route code**

For each administrator POST route:

1. require a JSON object and reject identity/unknown fields;
2. remove and parse `baseRevision` before the existing section normalizer;
3. call `save_dashboard_config_section(<hard-coded-section>, <normalized-value>, base_revision=...)`;
4. invalidate only the caches currently invalidated by that route;
5. return the current success body plus `configRevision` in DB mode;
6. translate `WorkspaceConfigConflict` to the exact `409` body.

Do not accept a client-provided section name. Refactor `jira_server._save_field_config()` to call the section-save interface with its hard-coded `config_key` and parsed `baseRevision`; do not leave any DB route or delegated route helper calling generic `save_dashboard_config()`.

- [x] **Step 5: Make shared EPM authoritative**

Change `get_config()` to load one `WorkspaceConfigSnapshot`, expose its complete allowlisted payload as `sharedConfig`, expose its revision as `sharedConfigRevision`, and derive the existing compatibility fields—including `payload['epm']`—from that same snapshot. `includeViewConfig=true` may add sanitized `viewConfig`, but it must not select `view_payload.get('epm')`. Keep per-user Home token visibility/gating unchanged.

- [x] **Step 6: Lock down the team-catalog route**

Require a JSON object whose keys are a subset of `catalog`, `meta`, and `merge`. Reject identity and administrator-section fields with `400 unsupported_team_catalog_field`. In DB mode call only the team-catalog repository; in JSON mode keep the file path. Convert exhausted internal catalog-merge contention to `409 team_catalog_conflict` without returning administrator revision or payload data.

- [x] **Step 7: Add audit assertions and source guards**

Assert each successful administrator section save adds one `AuditEvent` with `event_type='workspace_dashboard_config_updated'`, correct request-derived workspace/actor, and metadata exactly `{'section': <name>, 'revision': <int>}`. Assert payload values and identifiers never appear in serialized metadata. Add an AST/source guard over every matrix administrator handler plus `jira_server._save_field_config()` that forbids a generic full-save call without forbidding the intentionally preserved JSON/basic groups path.

- [x] **Step 8: Run route/security tests to verify GREEN**

Run: `.venv/bin/python -m unittest tests.test_dashboard_bootstrap_config_source tests.test_endpoint_security_matrix tests.test_oauth_settings_routes tests.test_epm_config_api tests.test_user_view_config_routes tests.test_db_admin_routes tests.test_backend_route_source_guards`

Expected: PASS for every endpoint/body/auth/CSRF/workspace/conflict/audit contract in the matrix.

- [x] **Step 9: Commit route contracts**

```bash
git add backend/routes/settings_routes.py backend/routes/epm_routes.py backend/security/policy.py jira_server.py tests/test_dashboard_bootstrap_config_source.py tests/test_endpoint_security_matrix.py tests/test_oauth_settings_routes.py tests/test_epm_config_api.py tests/test_user_view_config_routes.py tests/test_db_admin_routes.py tests/test_backend_route_source_guards.py
git commit -m "Enforce shared settings route contracts"
```

### Task 5: Add Settings Revision And Conflict Recovery

**Files:**
- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/api/epmApi.js`
- Modify: `frontend/src/settings/useJiraFieldPickers.js`
- Create: `frontend/src/settings/workspaceConfigConflict.js`
- Modify: `frontend/src/dashboard.jsx`
- Create: `tests/test_workspace_config_conflict.js`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `tests/ui/settings_unified_save.spec.js`
- Modify: `docs/README_ANALYTICS.md`
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`
- Rebuild if changed: `frontend/dist/dashboard.css`

**Interfaces:**
- API save helpers accept `baseRevision` and return/throw parsed JSON, including `409` payloads.
- `workspaceConfigConflict.js` exports `workspaceConfigConflictMessages`, `rebaseWorkspaceConfigSave`, and `committedWorkspaceSectionLabels`.
- Dashboard seeds every administrator draft plus one `sharedConfigRevision` from the same atomic `sharedConfig` bootstrap snapshot and updates the revision after each sequential success.

- [x] **Step 1: Write failing pure conflict tests**

```javascript
test('rebase uses the server revision and preserves dirty section payload', () => {
    assert.deepEqual(
        rebaseWorkspaceConfigSave({ boardId: '7' }, { currentRevision: 4 }),
        { boardId: '7', baseRevision: 4 }
    );
});

test('conflict copy names committed and pending sections', () => {
    const lines = workspaceConfigConflictMessages({
        savedSections: ['Scope projects'],
        pendingSections: ['Jira board', 'EPM settings'],
    });
    assert.match(lines.join(' '), /Scope projects/);
    assert.match(lines.join(' '), /Jira board/);
    assert.match(lines.join(' '), /EPM settings/);
});
```

- [x] **Step 2: Run Node tests to verify RED**

Run: `node --test tests/test_workspace_config_conflict.js tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js`

Expected: FAIL because revision helpers and request fields do not exist.

- [x] **Step 3: Thread revisions through API helpers**

In DB/OAuth mode, add `baseRevision` to every administrator save body without changing route-owned fields. Parse non-2xx JSON before throwing so `status`, `payload`, and `error` remain available. Keep `X-Requested-With`, CSRF fetch, `api_surface=settings_save`, and feature analytics unchanged.

`saveEpmConfig()` must remove `baseRevision` before EPM normalization on the server and must preserve the returned conflict payload rather than replacing it with `Failed to save EPM config: 409`.

Remove `normalizeAppConfig()`'s fallback from `viewConfig.view.epm` to top-level `epm`. Read shared EPM from `/api/config.epm`/`sharedConfig.epm`, and read personal tab/sprint state only from the sanitized private view.

- [x] **Step 4: Implement the Settings conflict state machine**

In DB/OAuth mode, seed all shared section baselines and `sharedConfigRevision` from the same `/api/config.sharedConfig` snapshot. Do not derive a section baseline from an independently timed GET and pair it with `/api/config.sharedConfigRevision`. Compatibility GETs may remain for non-Settings consumers; JSON/basic mode keeps its current initialization path. During modal-wide Save, send the current revision to the first dirty administrator section, replace it with each success response's revision, and pass the new value to the next dirty section.

On `409`:

- keep the conflicted and not-yet-saved drafts unchanged;
- keep already successful section baselines committed;
- render the existing validation/conflict area with saved and pending section labels;
- "Keep mine" retries from `currentRevision`;
- "Use latest" reloads administrator sections and clears only those drafts;
- do not close the modal;
- track `settings_action` save result with `result=failure`, `conflict_state=remote`, and `conflict_count_bucket=1_5` only.

On `401`, auth-expired `403`, network error, or validation error, keep drafts and use the existing recovery/error path. A workspace/site switch resets the revision/baselines before Save can be enabled.

- [x] **Step 5: Add Playwright conflict and geometry coverage**

Extend `tests/ui/settings_unified_save.spec.js` with two administrators' mocked sequence:

1. load revision `3` and edit at least two administrator sections;
2. first section returns revision `4`;
3. second section returns the exact `409` body at revision `5`;
4. assert the modal remains open, the second/later drafts remain dirty, and the banner names the already-saved section;
5. click "Keep mine", assert retry body uses `baseRevision: 5`, and assert success closes the modal;
6. repeat with "Use latest" and assert one atomic snapshot replaces only shared drafts;
7. assert Cancel/reopen and `401`/auth-expired `403` preserve the unsaved conflict draft and keep the existing visible re-auth path; and
8. replace the bootstrap with a second workspace/site and assert old values, revision, conflict state, and retry actions are cleared before Save is enabled.

Add element assertions for the conflict text/buttons and a settled screenshot. No sticky/header geometry is changed.

- [x] **Step 6: Update analytics documentation**

In `docs/README_ANALYTICS.md`, document that `settings_action` covers revision conflicts with `workflow_action=save_result`, `result=failure`, `conflict_state=remote`, and bucketed `conflict_count_bucket`. Explicitly forbid config values, revisions, Jira/Home identifiers, field ids, workspace ids, and user ids.

- [x] **Step 7: Run frontend tests and build**

Run:

```bash
node --test tests/test_workspace_config_conflict.js tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js
npx playwright test tests/ui/settings_unified_save.spec.js
npm run build
git diff -- frontend/dist
```

Expected: Node and Playwright tests PASS; `npm run build` exits `0`; inspect the generated diff and verify it traces only to source changes. Stage the intended source and generated output, run `npm run build` again, then require `git diff --exit-code -- frontend/dist` so no unstaged generated drift remains.

- [x] **Step 8: Commit frontend conflict handling and generated output**

```bash
git add frontend/src/api/configApi.js frontend/src/api/epmApi.js frontend/src/settings/useJiraFieldPickers.js frontend/src/settings/workspaceConfigConflict.js frontend/src/dashboard.jsx tests/test_workspace_config_conflict.js tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js tests/ui/settings_unified_save.spec.js docs/README_ANALYTICS.md frontend/dist
git commit -m "Handle concurrent shared settings saves"
```

### Task 6: Align Documentation And Run Final Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/plans/DONE-03-db-user-configuration.md`
- Modify: `docs/plans/DONE-04-db-user-home-epm-read-token.md`
- Modify: `docs/plans/GATE-05-home-write-capability.md`
- Modify: `docs/agents/bugfixes/2026-08-26-in-progress-shared-admin-configuration.md`
- Rename: `docs/agents/bugfixes/2026-08-26-in-progress-shared-admin-configuration.md` to `docs/agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md`
- Rename after acceptance/merge only: `docs/plans/EXEC-shared-admin-configuration.md` to `docs/plans/DONE-shared-admin-configuration.md`
- Modify: `docs/plans/README.md`

**Interfaces:**
- Documentation records the workspace/site ownership boundary, intentional EPM source-of-truth change, team-catalog separation, revision conflict contract, and actual verification evidence.

- [x] **Step 1: Update historical current-accuracy notes**

Keep `DONE-03` and `DONE-04` as accurate execution history. Add a current-accuracy note that this later plan makes normalized EPM scope/mappings workspace-admin-owned while private views retain personal view state and per-user Home credentials remain unchanged. Do not rewrite the historical tasks as if they originally implemented the new boundary.

Re-run the required startup gate sweep. Update `GATE-05`'s checked date/result without running its mutation probe unless all documented operator inputs and an approved disposable target are available. This plan remains executable while that write gate is blocked because it adds no Home mutation.

- [x] **Step 2: Record the recurring ownership rule**

Add this exact Project Learning:

```text
- Store administrator-owned dashboard and EPM configuration once per workspace; private views may contain only personal view state and must never override shared settings.
```

- [x] **Step 3: Run focused backend verification**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_db_migrations tests.test_shared_admin_config_recovery tests.test_workspace_dashboard_config_service tests.test_config_jsonfile_fallback tests.test_dashboard_bootstrap_config_source tests.test_view_config_resolution tests.test_team_catalog_api tests.test_endpoint_security_matrix tests.test_oauth_settings_routes tests.test_epm_config_api tests.test_user_view_config_routes tests.test_db_admin_routes tests.test_backend_route_source_guards
.venv/bin/python scripts/check_startup_preflight.py
```

Expected: all tests pass and preflight exits `0` without dependency/runtime warnings.

- [x] **Step 4: Run complete repository verification**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npm run test:frontend:ui
npm run build
git diff --exit-code -- frontend/dist
```

Expected: every command exits `0`; the final build produces a clean generated-output diff. If the full UI suite requires an unavailable browser/runtime, record the exact unavailable prerequisite and run the repository's documented focused fallback; do not claim the UI suite passed.

- [x] **Step 5: Inspect source-of-truth and safety guards**

Run:

```bash
rg -n "save_dashboard_config\(" backend/routes
rg -n "def _save_field_config|save_dashboard_config_section" jira_server.py
rg -n "compatibility save" backend scripts
! rg -n "view_payload.get\('epm'\)" backend jira_server.py
git diff --check
git status --short
git diff -- backend frontend/src tests scripts docs AGENTS.md
```

Expected:

- the remaining route-module generic save match is only the reviewed JSON/basic groups compatibility path, while the source guard proves no DB administrator handler or delegated field helper performs a generic full-payload save;
- only the reviewed explicit recovery path refers to the legacy marker;
- private view EPM does not override shared EPM;
- no whitespace errors, secrets, real identifiers, unrelated refactors, or hand-edited dist files;
- every changed line traces to this plan.

- [x] **Step 6: Close the work artifact**

Rename the bugfix artifact to `executed`, set `Status: executed`, and record exact commands/results, schema no-backfill evidence, recovery refusal/fingerprint behavior, screenshots, and any implementation divergence. Keep this plan `EXEC-*` until user acceptance or merge; then rename it to `DONE-*` and update `docs/plans/README.md`.

- [x] **Step 7: Commit documentation and final evidence**

```bash
git add AGENTS.md docs/plans/DONE-03-db-user-configuration.md docs/plans/DONE-04-db-user-home-epm-read-token.md docs/agents/bugfixes docs/plans/EXEC-shared-admin-configuration.md docs/plans/README.md
git commit -m "Document shared settings ownership"
```

Before any push, review `git log --oneline -5`, show the complete diff and verification results to the user, and wait for explicit confirmation.
