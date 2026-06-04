# Shared Department Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Goal:** Make department/team-group definitions a workspace-shared configuration that any authenticated user can create or edit, while each user controls which shared groups appear in their dashboard controls.

**Architecture:** Move team-group definitions out of private user view configuration in DB mode and into a workspace-owned shared catalog with revision-based conflict protection. Keep the current JSON-backed behavior as the compatibility source for local/basic mode and first DB import. Preserve the existing star as the shared default-group marker, and add a separate per-user "Show in my controls" visibility preference so one user's favorite selection does not change everyone else's dashboard.

**Tech Stack:** Python 3.10+ Flask routes, SQLAlchemy/Alembic DB migrations, existing config repository helpers, React 19, existing settings components, existing GA4 dataLayer contract, Python `unittest`, Node source-guard tests, Playwright UI tests.

---

## Status

Implemented on `feature/shared-department-groups` on 2026-06-04. The branch includes shared DB catalog/preference storage, DB import/export cleanup, route/security coverage, frontend first-run and per-user visibility flows, analytics/docs updates, generated frontend build output, and focused UI verification. `GATE-05-home-write-capability.md` remains blocked as expected because this plan does not add Home/Townsquare writes.

## Product Decisions

1. **Shared definitions, personal visibility.** Department/team-group definitions are shared at the workspace level. Visibility in the dashboard Group dropdown is per user.
2. **Do not overload the star.** The existing star in Team Groups continues to mean "shared default group." The new per-user control is a checkbox/switch labeled "Show in my controls" in Settings, with an icon-only affordance allowed only if the accessible label remains explicit.
3. **Explicit first-run visibility in DB/OAuth mode.** If a DB/OAuth user has no saved group preference row, `GET /api/groups-config` returns `preferences.onboardingRequired:true` and the dashboard opens a focused department-selection popup. The user must confirm at least one group before dashboard group-scoped data loads. JSON/basic mode keeps today's browser-local compatibility behavior.
4. **Create and duplicate are shared actions.** Adding or duplicating a group writes to the shared catalog and automatically includes that group in the creator's visible groups. Other users can see it in Settings and opt into showing it in their controls.
5. **Default is always visible.** The shared default group is always present in the dashboard controls, even if it is absent from a user's visible list.
6. **Any authenticated user can edit Departments.** Team Groups and Group Labels remain normal authenticated-user workflows. Admin-only settings stay under Admin and must not be bundled into a department save.
7. **Conflict protection is required.** Shared group saves use `baseRevision`. If another user saved first, the route returns `409 group_config_conflict` with the current catalog and revision; the UI shows a reload/review path instead of overwriting.
8. **Scenario drafts reference group IDs only.** Scenario Planner drafts must not persist private group definitions, nested groups, or membership snapshots.
9. **No Home/Townsquare writes.** This feature does not touch Home project mutation capability. `docs/plans/GATE-05-home-write-capability.md` remains blocked.
10. **First-ever users must choose departments.** A first-ever DB/OAuth user in a workspace with shared groups lands on the dashboard shell with a blocking, lightweight department-selection popup. The popup lists all shared groups, suggests the shared default when present, disables Continue unless at least one group is selected, and saves the user's first `user_group_preferences` row through `/api/groups-preferences`.
11. **DB mode has one group source of truth.** `teamGroups` must not remain in private `ViewConfig.payload` after DB import. DB import splits it into `WorkspaceGroupConfig`; DB export/rollback merges the current shared catalog back into exported JSON.
12. **JSON/basic visibility is browser-local.** `/api/groups-preferences` persists only in DB/OAuth mode. JSON/basic mode keeps current shared-file group definitions and stores personal visibility in existing browser UI preferences; it must not write personal visibility to shared JSON.
13. **Revision protection is atomic.** Shared group saves use one conditional DB update keyed by `workspace_id` and `config_revision`. A read-then-check sequence is not acceptable because it can lose concurrent edits.
14. **No new admin setup for Departments.** Keep Department group configuration open to any authenticated user. Do not add a new tool-admin setup flow, admin picker, or role requirement for creating, editing, or choosing department groups. Existing Admin-only settings and admin APIs remain separate from this feature.

## Approaches Considered

**Recommended: shared catalog plus per-user visibility.** This matches the request while avoiding a misleading global favorite. It also gives every user discovery in Settings without forcing every new group into everyone's top-level controls.

**Alternative: make the star user-specific.** Rejected because the current star already means shared default group in both Settings and the group dropdown. Reusing it would create two meanings for one icon.

**Alternative: show all shared groups everywhere.** Rejected because it solves sharing but not the user's request for an explicit favorite/control mechanism, and it will become noisy as the group list grows.

## First-Run Department Selection UX Contract

First-run is defined as a DB/OAuth user with no `user_group_preferences` row for the current workspace. This is the durable marker that the user has explicitly chosen which shared departments should appear in their dashboard controls.

For a first-run user in a workspace that already has shared groups:

1. The dashboard shell loads, then a modal popup opens before the user can interact with dashboard controls.
2. Group-scoped dashboard requests wait until the popup is completed. Do not fetch tasks, stats, or scenario data with an implicit all-groups scope.
3. The popup lists every shared group in the workspace. The shared default group is preselected as a suggestion when one exists; the user can add more groups before continuing. If no shared default exists, no group is preselected and Continue is disabled until the user selects at least one group.
4. Continuing calls `POST /api/groups-preferences` with the selected `visibleGroupIds` and `activeGroupId`, creates the preference row with `customized:true`, closes the popup, and then loads dashboard group-scoped data for the saved active group.
5. Reloading after a completed first-run selection must not show the popup again. Later changes happen through `Settings -> Departments -> Team Groups`.

Empty and small-list states:

- **No shared groups:** show the first-run popup as an empty Departments state with an Add group action for authenticated users, because there is no valid group to choose. Dashboard group-scoped requests stay paused until a group exists and the user saves at least one selected group. If the user closes the app and returns before a group exists, the popup appears again.
- **One shared group:** show the popup with the single group selected and Continue enabled. The user still confirms the first preference row explicitly.
- **Many shared groups:** show a compact checkbox list sorted by group name, with search/filter available whenever shared groups exist. Continue remains disabled until at least one group is selected.
- **Hidden or deleted active group after first-run:** reset active group to shared default, then first visible group, then `null` only if no groups exist. If all selected groups are later deleted and shared groups remain, show the same department-selection popup again.

The implementation should use short, direct modal wording. Primary user-visible labels: `Choose department groups`, `Select at least one group to show in controls`, `Search groups`, `Show in my controls`, `Continue`, `Add group`, and the existing `Groups`/`Departments` labels.

## Data Ownership And Compatibility Contract

- Routes derive `workspace_id`, `user_id`, `cloud_id`, `site_url`, and account identity only from `RequestAuthContext`. Request bodies must reject `workspaceId`, `workspace_id`, `userId`, `user_id`, `cloudId`, `cloud_id`, `siteUrl`, `site_url`, `accountId`, and `account_id` with `400 unsupported_group_config_field` or `400 unsupported_group_preference_field`.
- Workspace-shared group definitions live in `workspace_group_configs` in DB mode.
- Per-user visibility preferences live in `user_group_preferences` in DB/OAuth mode. A missing row means first-run selection is required when shared groups exist.
- Private `view_configs.payload` must not contain `teamGroups` after DB import, config save, or view-config resolution.
- JSON/basic mode remains shared-file based for group definitions. The frontend keeps visibility in browser-local UI preferences and does not call `POST /api/groups-preferences`.
- Deleting the final group requires an explicit `clearGroups:true` request with the current `baseRevision`; an empty groups list without `clearGroups:true` remains `400 team_groups_cannot_be_cleared_implicitly`.
- Group routes must not call Jira REST, Home/Townsquare GraphQL, service integrations, Home credential resolvers, or mutation/writeback helpers.

## Existing Anchors

- `backend/routes/settings_routes.py:303` - existing `GET /api/groups-config`.
- `backend/routes/settings_routes.py:344` - existing `POST /api/groups-config`.
- `backend/services/group_config.py:10` - current validation/normalization helpers.
- `backend/config/db_repository.py:48` - DB-backed dashboard config currently resolves private default views.
- `backend/db/models.py:83` - workspace/user DB model roots.
- `backend/security/policy.py:86` - `/api/groups-config` is already authenticated read plus `user_write` for POST.
- `frontend/src/api/configApi.js:40` - frontend groups-config API wrapper.
- `frontend/src/dashboard.jsx:425` - groups config state.
- `frontend/src/dashboard.jsx:1967` - active/default group resolution.
- `frontend/src/dashboard.jsx:11850` - dashboard group dropdown.
- `frontend/src/settings/TeamGroupsSettings.jsx:79` - Settings Team Groups list/editor.
- `docs/README_ANALYTICS.md:86` - existing `filter_changed` analytics contract.
- `docs/README_ANALYTICS.md:89` - existing `settings_action` analytics contract.

## Endpoint Contract

| Route | Auth | CSRF | Request | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| `GET /api/groups-config` | `authenticated_read` | none | none | Shared catalog plus current user's preferences and first-run requirement | Existing auth errors |
| `POST /api/groups-config` | `user_write` | OAuth requires `X-Requested-With` and token CSRF | Shared catalog payload plus `baseRevision`; optional `clearGroups:true` for intentional final clear | Updated shared catalog with incremented `configRevision` | `400 invalid_groups_config`, `400 unsupported_group_config_field`, `400 team_groups_cannot_be_cleared_implicitly`, `409 group_config_conflict` |
| `POST /api/groups-preferences` | `user_write` | OAuth requires `X-Requested-With` and token CSRF | `{"visibleGroupIds":["platform"],"activeGroupId":"platform"}` | Current user's normalized preferences and effective visible group IDs | `400 invalid_group_preferences`, `400 unsupported_group_preference_field`, `409 group_preferences_db_required`, existing auth/CSRF errors |

`GET /api/groups-config` response shape:

```json
{
  "version": 1,
  "groups": [
    {
      "id": "platform",
      "name": "Platform",
      "teamIds": ["team-a"],
      "missingInfoComponents": ["Needs Product"],
      "excludedCapacityEpics": [],
      "teamLabels": {"team-a": "Platform"}
    }
  ],
  "defaultGroupId": "platform",
  "configRevision": 3,
  "source": "workspace_db",
  "preferences": {
    "customized": true,
    "preferenceExists": true,
    "onboardingRequired": false,
    "visibleGroupIds": ["platform"],
    "activeGroupId": "platform",
    "effectiveVisibleGroupIds": ["platform"]
  },
  "warnings": []
}
```

Conflict response shape:

```json
{
  "error": "group_config_conflict",
  "message": "Team groups were changed by another user. Reload the latest groups before saving.",
  "current": {
    "version": 1,
    "groups": [],
    "defaultGroupId": "",
    "configRevision": 4,
    "source": "workspace_db"
  }
}
```

## File Map

- Create: `backend/db/migrations/versions/20260604_0006_shared_department_groups.py` - shared catalog and per-user preference tables.
- Modify: `backend/db/models.py` - SQLAlchemy models for `WorkspaceGroupConfig` and `UserGroupPreference`.
- Modify: `backend/config/import_config.py` - split legacy `teamGroups` into the shared catalog during DB import and merge current shared catalog into exported rollback JSON.
- Modify: `backend/config/db_repository.py` - make DB dashboard load/save strip `teamGroups` from private view payloads.
- Modify: `backend/config/view_validation.py` - reject private user view payloads that contain `teamGroups`.
- Create: `backend/services/shared_group_config.py` - DB/JSON compatibility service, revision handling, preference normalization, and visible-group resolution.
- Modify: `backend/routes/settings_routes.py` - route wiring for shared catalog load/save and new preference save.
- Modify: `backend/security/policy.py` - add `/api/groups-preferences` user-write policy.
- Modify: `tests/endpoint_security_samples.py` - add concrete samples for `/api/groups-config` and `/api/groups-preferences`.
- Create: `tests/test_shared_group_config_service.py` - pure service and DB persistence tests.
- Create: `tests/test_shared_group_config_routes.py` - route contract, auth, CSRF, conflict, and JSON fallback tests.
- Create: `tests/test_shared_group_config_db.py` - migration shape, downgrade, and uniqueness coverage.
- Create: `tests/test_shared_group_config_import.py` - DB import/export source-of-truth tests for stripping and restoring `teamGroups`.
- Modify: `tests/test_db_migrations.py` - include the new migration tables in upgrade/downgrade smoke coverage.
- Modify: `tests/test_endpoint_policy_inventory.py` and `tests/test_endpoint_security_matrix.py` - endpoint policy coverage.
- Modify: `tests/test_config_jsonfile_fallback.py` - prove legacy JSON import and rollback compatibility for shared groups.
- Modify: `frontend/src/api/configApi.js` - add `saveGroupPreferences()` and preserve `fetchGroupsConfig()` no-cache behavior.
- Create: `frontend/src/settings/groupVisibilityUtils.js` - pure helpers for effective visible groups, active-group fallback, and preference payload shaping.
- Create: `frontend/src/settings/FirstRunGroupSelectionModal.jsx` - focused first-run department-selection popup.
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx` - add visible-in-controls control without owning state.
- Modify: `frontend/src/dashboard.jsx` - add visible-group state, save preferences separately, filter dashboard group dropdown, and handle conflicts.
- Modify: `tests/test_frontend_api_source_guards.js` and `tests/test_epm_settings_source_guards.js` - source guards for API ownership and Settings prop/state boundaries.
- Create: `tests/test_group_visibility_utils.js` - frontend helper tests.
- Create: `tests/ui/shared_department_groups.spec.js` - Playwright coverage for shared catalog, personal visibility, conflict recovery, and no extra startup request.
- Modify: `docs/README_ANALYTICS.md` - document the analytics impact: reuse existing `settings_action` and `filter_changed`; do not send raw group names, team names, team IDs, or payloads.
- Modify: `README.md` - update Team Groups setup text to distinguish workspace-shared group definitions from per-user visible controls.
- Modify: `docs/plans/README.md` - add this active plan to the index.

## Task 1: DB Schema For Shared Groups

**Files:**
- Create: `backend/db/migrations/versions/20260604_0006_shared_department_groups.py`
- Modify: `backend/db/models.py`
- Test: `tests/test_shared_group_config_db.py`

- [x] **Step 1: Write migration/model tests**

Create `tests/test_shared_group_config_db.py` with tests that:

```python
def test_shared_group_migration_adds_catalog_and_preference_tables(self):
    command.upgrade(config, '20260514_0005')
    self.assertNotIn('workspace_group_configs', inspect(engine).get_table_names())

    command.upgrade(config, 'head')
    tables = set(inspect(engine).get_table_names())
    self.assertIn('workspace_group_configs', tables)
    self.assertIn('user_group_preferences', tables)
    catalog_columns = {column['name'] for column in inspector.get_columns('workspace_group_configs')}
    preference_columns = {column['name'] for column in inspector.get_columns('user_group_preferences')}
    self.assertTrue({'workspace_id', 'payload', 'config_revision', 'updated_by'}.issubset(catalog_columns))
    self.assertTrue({'workspace_id', 'user_id', 'visible_group_ids', 'active_group_id', 'customized'}.issubset(preference_columns))
```

Also test uniqueness:

```python
def test_shared_group_catalog_is_unique_per_workspace(self):
    with self.factory() as session:
        workspace, user = seed_workspace_and_user(session)
        session.add(models.WorkspaceGroupConfig(
            workspace_id=workspace.id,
            payload_version=1,
            payload={'groups': []},
            config_revision=1,
            created_by=user.id,
            updated_by=user.id,
        ))
        session.add(models.WorkspaceGroupConfig(
            workspace_id=workspace.id,
            payload_version=1,
            payload={'groups': []},
            config_revision=1,
            created_by=user.id,
            updated_by=user.id,
        ))
        with self.assertRaises(IntegrityError):
            session.commit()
```

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_db
```

Expected before implementation: fails because the migration and models do not exist.

- [x] **Step 2: Add the migration**

Create revision `20260604_0006`, down revision `20260514_0005`, with:

```python
op.create_table(
    'workspace_group_configs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('payload_version', sa.Integer(), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('config_revision', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('updated_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id', name='uq_workspace_group_configs_workspace'),
)
op.create_table(
    'user_group_preferences',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('payload_version', sa.Integer(), nullable=False),
    sa.Column('visible_group_ids', sa.JSON(), nullable=False),
    sa.Column('active_group_id', sa.String(length=255), nullable=True),
    sa.Column('customized', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id', 'user_id', name='uq_user_group_preferences_workspace_user'),
)
op.create_index('ix_user_group_preferences_user_workspace', 'user_group_preferences', ['user_id', 'workspace_id'])
```

The downgrade drops the index, `user_group_preferences`, then `workspace_group_configs`.

- [x] **Step 3: Add SQLAlchemy models**

Add `WorkspaceGroupConfig` and `UserGroupPreference` to `backend/db/models.py` using existing model style. Use `_uuid` and `_utcnow`. Store `visible_group_ids` as JSON to preserve group ID order.

- [x] **Step 4: Verify schema tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_db tests.test_db_migrations
```

Expected after implementation: all tests pass.

## Task 2: Shared Group Config Service

**Files:**
- Create: `backend/services/shared_group_config.py`
- Test: `tests/test_shared_group_config_service.py`

- [x] **Step 1: Write service tests**

Create tests for:

```python
def test_load_imports_legacy_json_once_for_workspace(self):
    legacy = {'version': 1, 'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}], 'defaultGroupId': 'platform'}
    result = service.load_shared_groups(context, fallback_loader=lambda: {'teamGroups': legacy})
    self.assertEqual(result['groups'][0]['id'], 'platform')
    self.assertEqual(result['configRevision'], 1)
    self.assertEqual(result['source'], 'workspace_db')

def test_save_rejects_stale_base_revision(self):
    first = service.save_shared_groups(context, payload, base_revision=1)
    with self.assertRaises(GroupConfigConflict) as raised:
        service.save_shared_groups(other_context_same_workspace, next_payload, base_revision=1)
    self.assertEqual(raised.exception.current['configRevision'], first['configRevision'])

def test_concurrent_save_uses_atomic_revision_guard(self):
    first_loaded = service.load_shared_groups(context, fallback_loader=lambda: {'teamGroups': payload})
    second_loaded = service.load_shared_groups(other_context_same_workspace, fallback_loader=lambda: {})
    service.save_shared_groups(context, first_payload, base_revision=first_loaded['configRevision'])
    with self.assertRaises(GroupConfigConflict):
        service.save_shared_groups(other_context_same_workspace, second_payload, base_revision=second_loaded['configRevision'])

def test_preferences_filter_unknown_groups_and_keep_default_visible(self):
    groups = {'groups': [{'id': 'default'}, {'id': 'platform'}], 'defaultGroupId': 'default'}
    preferences = service.normalize_group_preferences(
        {'visibleGroupIds': ['platform', 'missing'], 'activeGroupId': 'missing'},
        groups,
    )
    self.assertEqual(preferences['visibleGroupIds'], ['platform'])
    self.assertEqual(preferences['effectiveVisibleGroupIds'], ['default', 'platform'])
    self.assertEqual(preferences['activeGroupId'], 'default')

def test_missing_db_preferences_require_first_run_selection(self):
    groups = {'groups': [{'id': 'default'}, {'id': 'platform'}, {'id': 'mobile'}], 'defaultGroupId': 'default'}
    preferences = service.normalize_group_preferences({}, groups, preference_exists=False, require_first_run=True)
    self.assertFalse(preferences['customized'])
    self.assertFalse(preferences['preferenceExists'])
    self.assertTrue(preferences['onboardingRequired'])
    self.assertEqual(preferences['visibleGroupIds'], [])
    self.assertEqual(preferences['effectiveVisibleGroupIds'], [])

def test_missing_json_preferences_keep_browser_local_all_visible(self):
    groups = {'groups': [{'id': 'default'}, {'id': 'platform'}], 'defaultGroupId': 'default'}
    preferences = service.normalize_group_preferences({}, groups, preference_exists=False, require_first_run=False)
    self.assertFalse(preferences['customized'])
    self.assertFalse(preferences['onboardingRequired'])
    self.assertEqual(preferences['effectiveVisibleGroupIds'], ['default', 'platform'])
```

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service
```

Expected before implementation: fails because `backend.services.shared_group_config` does not exist.

- [x] **Step 2: Implement service exceptions and result helpers**

Implement:

```python
class GroupConfigConflict(Exception):
    def __init__(self, current):
        super().__init__('group_config_conflict')
        self.current = current

class InvalidGroupPreferences(ValueError):
    pass
```

Add helpers:

- `load_shared_groups(context, fallback_loader, validate_groups_config_fn, database_url=None)`
- `save_shared_groups(context, payload, base_revision, validate_groups_config_fn, database_url=None)`
- `load_group_preferences(context, groups_config, database_url=None)`
- `save_group_preferences(context, payload, groups_config, database_url=None)`
- `normalize_group_preferences(payload, groups_config, preference_exists=True, require_first_run=False)`
- `effective_visible_group_ids(groups_config, preferences)`
- `is_first_run_required(context, groups_config, preference_exists, database_url=None)`

- [x] **Step 3: Preserve JSON/local compatibility**

When DB storage is not enabled, route code keeps using the existing JSON/dashboard config path. The service still exposes pure normalization so JSON and DB modes return the same response shape where possible.

For DB mode, first load imports `teamGroups` from the explicit JSON fallback (`load_dashboard_config(source='jsonfile')`) only when no `workspace_group_configs` row exists for the current workspace. It must not import from another user's private view payload.

For DB/OAuth mode, `load_group_preferences` returns `preferenceExists:false` and `onboardingRequired:true` when there is no preference row and the shared catalog has at least one group. It must return empty `visibleGroupIds`, empty `effectiveVisibleGroupIds`, and `activeGroupId:null` so the frontend pauses group-scoped requests until first-run selection completes.

- [x] **Step 4: Implement atomic revision writes**

`save_shared_groups` must update existing shared catalog rows with a single conditional statement:

```python
statement = (
    update(models.WorkspaceGroupConfig)
    .where(
        models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
        models.WorkspaceGroupConfig.config_revision == base_revision,
    )
    .values(
        payload=normalized,
        payload_version=int(normalized.get('version') or 1),
        config_revision=base_revision + 1,
        updated_by=context.user_id,
        updated_at=_utcnow(),
    )
)
result = session.execute(statement)
if result.rowcount != 1:
    raise GroupConfigConflict(load_current_shared_groups(session, context))
```

Do not implement conflict handling as read current revision, compare in Python, then write. Handle first-create races by catching the unique constraint `IntegrityError` for `uq_workspace_group_configs_workspace` and returning `GroupConfigConflict` with the current catalog.

- [x] **Step 5: Verify service tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service
```

Expected after implementation: all tests pass.

## Task 3: DB Import, Export, And Private View Cleanup

**Files:**
- Modify: `backend/config/import_config.py`
- Modify: `backend/config/db_repository.py`
- Modify: `backend/config/view_validation.py`
- Test: `tests/test_shared_group_config_import.py`
- Test: `tests/test_config_jsonfile_fallback.py`

- [x] **Step 1: Write source-of-truth migration tests**

Create `tests/test_shared_group_config_import.py` with tests that prove:

```python
def test_import_splits_team_groups_into_workspace_catalog_and_strips_private_view(self):
    imported = import_dashboard_config(
        database_url=self.database_url,
        context=self.context,
        source_path=self.dashboard_path,
        actor_user_id=self.user_id,
    )
    self.assertTrue(imported.imported)
    resolved = repository.resolve_effective_view_config(self.context, view_config_id=imported.view_config_id)
    self.assertNotIn('teamGroups', resolved['view'])
    shared = service.load_shared_groups(self.context, fallback_loader=lambda: {})
    self.assertEqual(shared['groups'][0]['id'], 'platform')

def test_export_merges_current_shared_groups_into_rollback_json(self):
    service.save_shared_groups(self.context, updated_groups, base_revision=1)
    export_view_config_json(
        database_url=self.database_url,
        context=self.context,
        view_config_id=self.view_config_id,
        output_path=export_path,
    )
    exported = json.load(open(export_path, encoding='utf-8'))
    self.assertEqual(exported['teamGroups']['groups'][0]['id'], 'updated')
```

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_import tests.test_config_jsonfile_fallback
```

Expected before implementation: fails because imported DB view payloads still include `teamGroups`.

- [x] **Step 2: Split `teamGroups` during DB import**

In `backend/config/import_config.py`, when importing dashboard JSON in DB mode:

- Extract `teamGroups` from the source JSON.
- Normalize and upsert it into `workspace_group_configs` for `context.workspace_id` only if the shared catalog does not already exist.
- Strip `teamGroups` from the payload before storing `ViewConfig.payload`.
- Keep import idempotency based on the full source hash, but never expose private `viewConfig.view.teamGroups` through `/api/config?includeViewConfig=true`.

- [x] **Step 3: Merge shared groups during DB export/rollback**

When exporting a DB view back to JSON, merge the current shared workspace catalog into the exported document as `teamGroups`. This preserves JSON rollback compatibility while keeping DB source of truth shared.

- [x] **Step 4: Guard private view payload validation**

Update `backend/config/view_validation.py` so user-owned view payloads reject `teamGroups`. This prevents future private-view saves from reintroducing group definitions.

- [x] **Step 5: Verify import/export tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_import tests.test_config_jsonfile_fallback tests.test_view_config_resolution tests.test_user_view_config_routes
```

Expected after implementation: all tests pass, and `viewConfig.view` responses never contain `teamGroups`.

## Task 4: Route Contract And Security

**Files:**
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/security/policy.py`
- Modify: `tests/endpoint_security_samples.py` if dynamic coverage requires it
- Test: `tests/test_shared_group_config_routes.py`
- Test: `tests/test_endpoint_policy_inventory.py`
- Test: `tests/test_endpoint_security_matrix.py`

- [x] **Step 1: Write route tests**

Cover these cases:

```python
def test_get_groups_config_returns_shared_workspace_catalog_for_two_users(self):
    first = self.client.get('/api/groups-config')
    self.assertEqual(first.status_code, 200)
    self.assertEqual(first.get_json()['source'], 'workspace_db')

    install_oauth_session(self.client, account_id='other-account')
    second = self.client.get('/api/groups-config')
    self.assertEqual(second.status_code, 200)
    self.assertEqual(second.get_json()['groups'], first.get_json()['groups'])

def test_new_user_get_groups_config_requires_first_run_group_selection(self):
    response = self.client.get('/api/groups-config')
    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    preferences = response.get_json()['preferences']
    self.assertFalse(preferences['customized'])
    self.assertFalse(preferences['preferenceExists'])
    self.assertTrue(preferences['onboardingRequired'])
    self.assertEqual(preferences['effectiveVisibleGroupIds'], [])

def test_post_groups_config_allows_normal_authenticated_user_with_csrf(self):
    csrf = self.client.get('/api/auth/csrf').get_json()['csrfToken']
    response = self.client.post(
        '/api/groups-config',
        json={'version': 1, 'baseRevision': 1, 'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}], 'defaultGroupId': 'platform'},
        headers={'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': csrf},
    )
    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    self.assertGreater(response.get_json()['configRevision'], 1)

def test_post_groups_config_rejects_stale_revision(self):
    response = self.client.post('/api/groups-config', json=stale_payload, headers=self._csrf_headers())
    self.assertEqual(response.status_code, 409)
    self.assertEqual(response.get_json()['error'], 'group_config_conflict')
    self.assertIn('current', response.get_json())

def test_post_groups_config_rejects_identity_spoofing_fields(self):
    response = self.client.post(
        '/api/groups-config',
        json={**valid_payload, 'workspaceId': 'other-workspace'},
        headers=self._csrf_headers(),
    )
    self.assertEqual(response.status_code, 400)
    self.assertEqual(response.get_json()['error'], 'unsupported_group_config_field')

def test_post_groups_config_requires_explicit_clear_groups_for_final_delete(self):
    response = self.client.post(
        '/api/groups-config',
        json={'version': 1, 'baseRevision': 2, 'groups': [], 'defaultGroupId': ''},
        headers=self._csrf_headers(),
    )
    self.assertEqual(response.status_code, 400)
    self.assertEqual(response.get_json()['error'], 'team_groups_cannot_be_cleared_implicitly')

    clear_response = self.client.post(
        '/api/groups-config',
        json={'version': 1, 'baseRevision': 2, 'clearGroups': True, 'groups': [], 'defaultGroupId': ''},
        headers=self._csrf_headers(),
    )
    self.assertEqual(clear_response.status_code, 200, clear_response.get_data(as_text=True))

def test_post_group_preferences_does_not_change_shared_catalog(self):
    response = self.client.post(
        '/api/groups-preferences',
        json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
        headers=self._csrf_headers(),
    )
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.get_json()['preferences']['visibleGroupIds'], ['platform'])

def test_post_group_preferences_rejects_identity_spoofing_fields(self):
    response = self.client.post(
        '/api/groups-preferences',
        json={'visibleGroupIds': ['platform'], 'workspaceId': 'other-workspace'},
        headers=self._csrf_headers(),
    )
    self.assertEqual(response.status_code, 400)
    self.assertEqual(response.get_json()['error'], 'unsupported_group_preference_field')

def test_group_catalog_and_preferences_are_isolated_by_workspace(self):
    first = self.client.get('/api/groups-config').get_json()
    install_oauth_session(self.client, account_id='other-account', site_url='https://other.atlassian.net')
    second = self.client.get('/api/groups-config').get_json()
    self.assertEqual(first['groups'][0]['id'], 'platform')
    self.assertEqual(second['groups'], [])

def test_group_routes_do_not_call_jira_home_or_service_credentials(self):
    with patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('jira reached')), \
         patch.object(jira_server, 'jira_post', side_effect=AssertionError('jira write reached')), \
         patch('backend.auth.home_credentials.resolve_home_credential', side_effect=AssertionError('home credential reached')):
        self.assertEqual(self.client.get('/api/groups-config').status_code, 200)
```

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_routes
```

Expected before route changes: fails because `/api/groups-preferences` does not exist and `/api/groups-config` still reads private DB view config.

- [x] **Step 2: Implement route behavior**

In `backend/routes/settings_routes.py`:

- `GET /api/groups-config` returns shared workspace catalog in DB mode and existing JSON/env/default behavior in JSON mode.
- In DB/OAuth mode, `GET /api/groups-config` sets `preferences.preferenceExists:false` and `preferences.onboardingRequired:true` for a current user with no preference row and at least one shared group.
- `POST /api/groups-config` saves the shared catalog only, preserves the existing implicit-clear guard, returns `409 group_config_conflict` on stale `baseRevision`, and never saves selected projects, board config, field config, priority weights, issue types, or EPM config.
- `POST /api/groups-preferences` saves only the current user's visibility preferences.
- `POST /api/groups-preferences` returns `409 group_preferences_db_required` in JSON/basic mode; the frontend must not call it outside DB/OAuth mode.
- Request bodies reject `workspaceId`, `workspace_id`, `userId`, `user_id`, `cloudId`, `cloud_id`, `siteUrl`, `site_url`, `accountId`, and `account_id`.
- `POST /api/groups-config` allows an empty catalog only when `clearGroups:true` is present with the current `baseRevision`.
- Group GET/POST routes must not call Jira REST, Jira writes, Home/Townsquare credential resolution, service integrations, or Home mutation helpers.
- Both POST routes keep existing OAuth CSRF behavior through the security wrapper; do not add route-local CSRF logic.

- [x] **Step 3: Update endpoint policy coverage**

Add:

```python
EndpointPolicy("settings-group-preferences-write", "/api/groups-preferences", frozenset({"POST"}), "user_write")
```

Update tests so `/api/groups-config` and `/api/groups-preferences` are classified as `user_write`, not `shared_admin_write`. Add both routes to `SECURITY_SAMPLES["user_write"]`, and add negative tests proving unauthenticated OAuth, missing `X-Requested-With`, missing CSRF, and invalid CSRF fail before route code executes.

- [x] **Step 4: Verify routes and security**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_routes tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_oauth_settings_routes tests.test_pre_db_admin_gates
```

Expected after implementation: all tests pass.

## Task 5: Frontend API And Visibility Helpers

**Files:**
- Modify: `frontend/src/api/configApi.js`
- Create: `frontend/src/settings/groupVisibilityUtils.js`
- Test: `tests/test_frontend_api_source_guards.js`
- Test: `tests/test_group_visibility_utils.js`

- [x] **Step 1: Write frontend helper tests**

Create tests:

```javascript
test('effectiveVisibleGroups shows all groups before customization', () => {
    const groups = [{ id: 'default' }, { id: 'platform' }];
    assert.deepEqual(effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, { customized: false, onboardingRequired: false }), ['default', 'platform']);
});

test('effectiveVisibleGroups returns no dashboard groups while first-run selection is required', () => {
    const groups = [{ id: 'default' }, { id: 'platform' }];
    assert.deepEqual(effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, { customized: false, onboardingRequired: true }), []);
});

test('effectiveVisibleGroups keeps default when user customizes', () => {
    const groups = [{ id: 'default' }, { id: 'platform' }, { id: 'mobile' }];
    assert.deepEqual(
        effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, { customized: true, visibleGroupIds: ['mobile'] }),
        ['default', 'mobile']
    );
});

test('resolveVisibleActiveGroup falls back from hidden or missing active group', () => {
    const groups = [{ id: 'default' }, { id: 'platform' }];
    assert.equal(resolveVisibleActiveGroupId({ groups, defaultGroupId: 'default' }, ['default'], 'platform'), 'default');
});

test('buildSharedGroupsPayload includes loaded base revision', () => {
    const draft = { version: 1, configRevision: 7, groups: [{ id: 'platform' }], defaultGroupId: 'platform' };
    assert.deepEqual(buildSharedGroupsPayload(draft), {
        version: 1,
        baseRevision: 7,
        groups: [{ id: 'platform' }],
        defaultGroupId: 'platform'
    });
});
```

Run:

```bash
node tests/test_group_visibility_utils.js
```

Expected before implementation: fails because the helper file does not exist.

- [x] **Step 2: Add API wrapper**

Add to `frontend/src/api/configApi.js`:

```javascript
export const saveGroupPreferences = (backendUrl, payload) =>
    postJsonWithCsrf(backendUrl, '/api/groups-preferences', payload, {
        apiSurface: 'settings_save',
        featureName: 'settings'
    });
```

Update `tests/test_frontend_api_source_guards.js` so endpoint construction remains in `configApi.js`.

- [x] **Step 3: Implement helper module**

`frontend/src/settings/groupVisibilityUtils.js` owns:

- `normalizeGroupPreferences(payload)`
- `effectiveVisibleGroupIds(groupsConfig, preferences)`
- `visibleGroupsForControls(groupsConfig, preferences)`
- `resolveVisibleActiveGroupId(groupsConfig, visibleGroupIds, currentActiveGroupId)`
- `buildGroupPreferencesPayload(visibleGroupIds, activeGroupId)`
- `buildFirstRunGroupPreferencesPayload(selectedGroupIds, defaultGroupId)`
- `buildSharedGroupsPayload(groupDraft)`
- `groupPreferencesSignature(preferences)`

Do not put this logic directly in `frontend/src/dashboard.jsx`.

Also update frontend normalization so `groupsConfig` and `groupDraft` preserve `configRevision`, `source`, and `preferences`. Current `normalizeGroupsConfig` drops unknown fields; that must change before the backend enforces `baseRevision`.

- [x] **Step 4: Verify frontend unit/source tests**

Run:

```bash
node tests/test_group_visibility_utils.js
node tests/test_frontend_api_source_guards.js
```

Expected after implementation: all tests pass.

## Task 6: Settings UX For Shared Catalog And Personal Visibility

**Files:**
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Test: `tests/test_epm_settings_source_guards.js`
- Test: `tests/ui/shared_department_groups.spec.js`

- [x] **Step 1: Write source guard expectations**

Extend `tests/test_epm_settings_source_guards.js` to assert:

- `TeamGroupsSettings` still has no `useState(`.
- The existing `.group-star-button` remains tied to `toggleDefaultGroupDraft`.
- A separate control exists for personal visibility with an accessible label containing `Show in my controls`.
- No `<input>` or other interactive control is nested inside `.group-list-item`.
- The default group's personal visibility control is checked and disabled/read-only because the shared default is always visible.
- The shared default star aria label uses shared language, for example `Set as shared default group`.
- `saveGroupsConfig` calls group preferences save separately from shared catalog save.
- `saveGroupsConfig` sends `baseRevision: groupDraft.configRevision` for shared catalog saves.
- Department saves do not call admin-only save functions outside the existing `canEditSharedConfiguration` guard.

- [x] **Step 2: Add Settings props and UI**

In `TeamGroupsSettings.jsx`, add props for:

- `visibleGroupDraftIds`
- `toggleGroupVisibleInControls`
- `isGroupVisibleInControls`
- `groupVisibilitySaving`

Render a compact checkbox/switch in the active group editor header, or restructure the left list row into sibling controls. Do not put the checkbox inside the existing `.group-list-item` button.

```jsx
<label className="group-visible-control">
    <input
        type="checkbox"
        checked={isGroupVisibleInControls(group.id)}
        disabled={groupDraft?.defaultGroupId === group.id}
        onChange={() => toggleGroupVisibleInControls(group.id)}
    />
    <span>Show in my controls</span>
</label>
```

Keep the shared default star in the editor header, but update its tooltip/aria label to make the shared scope clear.

- [x] **Step 3: Update dashboard state and save behavior**

In `dashboard.jsx`:

- Store `groupPreferences` from `GET /api/groups-config`.
- Keep a draft set of visible group IDs while Settings is open.
- Add `groupPreferencesBaselineRef`, `groupPreferencesDraftSignature`, and `isGroupVisibilityDraftDirty`.
- Include visibility dirty state in modal dirty state, discard confirmation, unsaved section count, Save disabled reason/title, and Save button enablement.
- Preserve `configRevision` in `groupsConfig`, `groupDraft`, and `groupDraftBaselineRef`.
- Saving Departments first saves shared group definitions when the shared draft changed, then saves the current user's visibility preferences when that draft changed.
- Opening Settings or saving shared group definitions alone must not create a preference row or flip `customized:false` to `true`. Only an explicit visibility toggle, create/duplicate when the user is already customized, or first-run popup Continue may call `POST /api/groups-preferences`.
- If the shared save succeeds but preference save fails, update the shared baseline from the shared save response, keep the modal open, preserve the visibility draft, and retry only `POST /api/groups-preferences` on the next Save.
- If the shared save returns `409 group_config_conflict`, show the route message in `groupDraftError`, keep the user's unsaved shared and visibility drafts in memory, store `current.configRevision`, and block blind retry until the user clicks `Reload latest groups` or explicitly reapplies the local draft against the new base revision.
- Handle `401`, `403 csrf_required`, and `auth_required/session_expired` from CSRF fetches or POSTs by keeping drafts, showing an actionable re-auth/retry message, and tracking `settings_action` `save_result=failure`.
- Do not save visibility preferences to `teamGroups`, Scenario drafts, EPM config, selected projects, or admin settings.

- [x] **Step 4: Verify Settings source guards**

Run:

```bash
node tests/test_epm_settings_source_guards.js
```

Expected after implementation: all tests pass.

## Task 7: Dashboard First-Run Popup And Group Controls

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Create: `frontend/src/settings/FirstRunGroupSelectionModal.jsx`
- Modify: `frontend/src/styles/settings.css`
- Test: `tests/ui/shared_department_groups.spec.js`
- Test: `tests/ui/codebase_structure_smoke.spec.js`

- [x] **Step 1: Write Playwright tests**

Add coverage that stubs:

- Two shared groups in `/api/groups-config`.
- User preferences with only one visible group.
- A shared default group that remains visible even when absent from `visibleGroupIds`.

Assertions:

```javascript
await expect(page.getByRole('button', { name: /select group/i })).toContainText('Default');
await page.getByRole('button', { name: /select group/i }).click();
await expect(page.getByText('Default')).toBeVisible();
await expect(page.getByText('Platform')).toBeVisible();
await expect(page.getByText('Mobile')).toHaveCount(0);
```

Add a second test for JSON/basic compatibility where `preferences.customized:false`, `preferences.onboardingRequired:false`, and all shared groups remain visible.

Add first-run state coverage:

- New user with many groups: first-run popup appears, lists every shared group, preselects the shared default, disables dashboard controls underneath, calls `POST /api/groups-preferences` on Continue, closes after success, and then the dropdown contains the selected groups plus default.
- New user with one group: first-run popup appears with the only group selected, Continue is enabled, the saved preference row prevents the popup from returning on reload, and the Group dropdown remains hidden because there is only one effective group.
- New user with no groups: first-run popup appears as a Departments empty state with an Add group action; group-scoped dashboard requests do not run until a group exists and the user saves a selected group.
- First-run user with no default group: no group is preselected, Continue is disabled until one group is checked, and the selected group becomes `activeGroupId`.
- User with customized preferences: only visible groups plus default appear in the dropdown; Settings still lists every shared group.
- Hidden saved active group after reload: the UI falls back to the shared default and task/stat/scenario requests use the fallback group's `teamIds`.
- Deleted active group after catalog save: the UI falls back without showing an empty or broken group scope.
- Compact sticky controls and mobile viewport: visible groups match the main dropdown.
- Auth recovery: `/api/auth/csrf` returning `401` and `POST /api/groups-config` or `POST /api/groups-preferences` returning `403 csrf_required` keep drafts open, show a retry/re-auth path, and do not lose unsaved shared or visibility edits.

- [x] **Step 2: Add the first-run selection modal**

Create `FirstRunGroupSelectionModal.jsx` with:

- `groups`
- `defaultGroupId`
- `selectedGroupIds`
- `onToggleGroup`
- `onContinue`
- `onAddGroup`
- `saving`
- `error`

Use existing modal and settings CSS patterns. The modal must be keyboard accessible, trap focus through the existing modal infrastructure if available, and keep text short. The Continue button is disabled when `selectedGroupIds.length === 0` or saving. For a long group list, include a compact search field inside the modal; for one group, keep the list visible instead of hiding the decision.

- [x] **Step 3: Filter control groups through helper output**

Use `visibleGroupsForControls(groupsConfig, groupPreferences)` for the dashboard dropdown only. Settings must continue to show all shared groups.

Resolve `activeGroup` from the effective visible list, not the raw shared catalog. While `groupPreferences.onboardingRequired` is true, keep `activeGroupId` unset and pause group-scoped data loads. Add a reconciliation effect after every groups-config load, preference save, catalog save, delete, reload, and saved UI-pref restore:

```javascript
const nextActiveGroupId = resolveVisibleActiveGroupId(groupsConfig, effectiveVisibleGroupIds, activeGroupId);
if (nextActiveGroupId !== activeGroupId) {
    setActiveGroupId(nextActiveGroupId);
}
```

When the active group becomes hidden or deleted, reset to:

1. Current shared default group.
2. First visible group.
3. `null` only when no groups exist.

- [x] **Step 4: Save first-run preferences**

On first-run Continue:

1. Call `saveGroupPreferences(backendUrl, buildFirstRunGroupPreferencesPayload(selectedGroupIds, defaultGroupId))`.
2. Replace `groupPreferences` and the visibility baseline with the server response.
3. Clear `onboardingRequired`.
4. Resolve the active group from the server response.
5. Start the normal group-scoped dashboard loading path.

If the save returns `401`, `403 csrf_required`, or `auth_required/session_expired`, keep the modal open, preserve selected groups, and show the same visible re-auth/retry path used by Settings saves.

- [x] **Step 5: Preserve startup performance**

Do not add a second startup request. `GET /api/groups-config` returns preferences with the shared catalog. Keep the existing `tests/ui/codebase_structure_smoke.spec.js` startup assertion at one groups-config request; update only fixtures, not the expected request count.

- [x] **Step 6: Verify visual/interaction behavior**

Run:

```bash
npx playwright test tests/ui/shared_department_groups.spec.js tests/ui/codebase_structure_smoke.spec.js
```

Expected after implementation: all tests pass. Assertions must be scoped to `.group-dropdown-panel` where dropdown behavior is tested, cover both main and compact sticky controls, cover a mobile viewport, prove hidden groups are absent from the panel, prove hidden groups cannot drive task requests, prove first-run modal completion creates one preference save and no shared-catalog save, and keep the existing one-request startup assertion. Capture screenshots for the first-run popup, Settings Departments tab, and the dashboard group dropdown for PR notes. The first-run screenshot must show the available shared groups before Continue so a reviewer can see what the first logged-in user can choose as their first group to look after.

## Task 8: Analytics And Documentation

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Modify: `README.md`
- Test: `tests/test_analytics_events.js`
- Test: `tests/test_analytics_source_guards.js`

- [x] **Step 1: Document analytics impact**

Update `docs/README_ANALYTICS.md`:

- `settings_action` covers open/save/save_result for `section=teams` or `section=departments`.
- `settings_action` covers first-run department popup completion with `workflow_action=first_run_selection`, `section=departments`, and bucketed selected/available counts.
- `filter_changed` covers dashboard group selection with `filter_type=group`, `group_count_bucket`, `selection_count_bucket`, `scope_type`, and `source_surface`.
- Visibility preference changes may use `settings_action` with `workflow_action=preference_change`, `section=departments`, and bucketed counts.
- Do not send group names, team names, team IDs, Jira labels, config payloads, validation text, workspace IDs, cloud IDs, URLs, account IDs, emails, or local file paths.

- [x] **Step 2: Add analytics tests**

Add or update tests that capture:

- `settings_action` when a user toggles "Show in my controls" and saves visibility preferences.
- `settings_action` when a first-run user completes the department-selection popup.
- `filter_changed` when a user changes the dashboard group selection.
- Required params are bucketed and low-cardinality only.
- Payloads do not contain raw group names, team names, team IDs, workspace IDs, cloud IDs, account IDs, URLs, or config payloads.

If `preference_change` or a new allowed parameter is needed, update `frontend/src/analytics/events.js` and `tests/test_analytics_events.js`. If existing values already allow this, add a no-new-schema note to `docs/README_ANALYTICS.md` and leave the event schema unchanged, but still test the emitted payload.

- [x] **Step 3: Verify analytics guards**

Run:

```bash
node tests/test_analytics_events.js
node tests/test_analytics_source_guards.js
```

Expected after implementation: all tests pass, with no raw group/team identifiers in analytics payloads.

## Task 9: Full Verification And Build

**Files:**
- Modify generated `frontend/dist/*` only through `npm run build`.

- [x] **Step 1: Run focused backend tests**

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_db tests.test_shared_group_config_service tests.test_shared_group_config_import tests.test_shared_group_config_routes tests.test_config_jsonfile_fallback tests.test_oauth_settings_routes tests.test_pre_db_admin_gates tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_codebase_structure_budgets
```

Expected: all pass.

- [x] **Step 2: Run focused frontend tests**

```bash
node tests/test_group_visibility_utils.js
node tests/test_frontend_api_source_guards.js
node tests/test_epm_settings_source_guards.js
node tests/test_analytics_events.js
node tests/test_analytics_source_guards.js
```

Expected: all pass.

- [x] **Step 3: Build frontend**

```bash
npm run build
```

Expected: build succeeds and regenerated `frontend/dist/*` matches source changes.

- [x] **Step 4: Run UI verification**

```bash
npx playwright test tests/ui/shared_department_groups.spec.js tests/ui/codebase_structure_smoke.spec.js
```

Expected: all pass. Include screenshots in PR notes because the first-run Department picker, Settings Departments UI, and dashboard dropdown changed. The implementation agent must also share the first-run available-groups screenshot in chat before marking the plan complete.

- [x] **Step 5: Run startup preflight**

```bash
.venv/bin/python scripts/check_startup_preflight.py
```

Expected: preflight passes.

- [x] **Step 6: Run the full test suite before push**

```bash
python3 -m unittest discover -s tests
```

Expected: all pass. If sandbox-local DB/socket failures appear, record the exact failures and rerun the affected tests with the project-local `.venv/bin/python` where appropriate before claiming completion.

## Acceptance Criteria

- Any authenticated user can create, edit, duplicate, and delete shared department/team groups.
- All users in the same workspace can see the same shared group catalog in Settings.
- Per-user visibility controls determine which shared groups appear in the dashboard Group dropdown.
- First-ever DB/OAuth users in configured workspaces see a focused department-selection popup, must confirm at least one group before group-scoped dashboard data loads, and do not see the popup again after the preference row is saved.
- Acceptance evidence includes a chat-shared screenshot of the first-run department-selection popup showing the available groups for the first logged-in user before they choose their first group to look after.
- Department group configuration remains a normal authenticated-user workflow; this feature does not add a new tool-admin setup flow or admin role requirement for Department groups.
- The shared default group remains a shared star and is always visible in controls.
- A stale shared-group save uses atomic DB revision protection, returns `409 group_config_conflict`, and does not overwrite another user's changes.
- DB private `ViewConfig.payload` and `viewConfig.view` responses do not contain `teamGroups`; DB export/rollback merges the current shared catalog into JSON.
- Group catalog and preference routes are isolated by workspace and reject spoofed identity/ownership fields.
- JSON/basic mode does not persist personal visibility to shared JSON and does not call `/api/groups-preferences` from the frontend.
- Department saves do not bundle Admin, EPM, selected project, field, priority, issue-type, Home/Townsquare, or Scenario draft writes.
- No Home/Townsquare mutation route or UI is added.
- Initial dashboard load does not gain an extra groups/preferences request.
- Analytics uses existing low-cardinality `settings_action` and `filter_changed` events and never sends raw group/team identifiers.
- `npm run build` is run after frontend source changes, and generated `frontend/dist/*` is committed if it changes.

## Residual Risks

- Existing local/basic mode has no durable multi-user identity, so personal visibility is only meaningful in DB/OAuth mode. JSON mode should preserve current shared-file behavior and may use local UI prefs as a single-user fallback.
- Group IDs are long-lived references in Planning, Scenario, and stats UI state. Deleting a group should reset active group selection, but historical localStorage scopes may remain until naturally overwritten.
- Existing source guards are string-based. Implementation should prefer pure helper tests and Playwright tests for behavior that string guards cannot prove.
