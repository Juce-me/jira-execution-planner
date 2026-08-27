# User-Owned EPM Configuration Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore EPM settings to each authenticated user's private saved view while preserving workspace-shared, user-editable department groups and workspace-shared, administrator-only dashboard settings.

**Architecture:** Treat `backend/security/CONFIGURATION_OWNERSHIP.md` as the canonical boundary. In DB mode, resolve and patch EPM only in the current user's default private `view_configs` row and append `view_config_versions`; keep legacy JSON mode as the existing local single-user compatibility path. Remove EPM from workspace administrator allowlists, snapshots, revisions, recovery, and frontend conflict handling, and clean already-misplaced workspace EPM data without copying it into any user row.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy 2, Alembic, React 19, esbuild, `unittest`, Node test runner, Playwright, SQLite/PostgreSQL-compatible schema.

**Status:** Documentation contract committed in `ef81333`; implementation tasks pending.

**Concurrency decision:** Private EPM saves use the same same-owner last-write-wins behavior as the existing `/api/me/views` PATCH contract and append view history for audit. This correction does not add an EPM-only compare-and-swap field because whole-view PATCH would still bypass it; workspace `baseRevision` and workspace conflict UI must never participate in private EPM saves.

---

## Acceptance Contract

| Configuration | Storage and scope | Read | Write |
| --- | --- | --- | --- |
| Dashboard administrator settings | `workspace_dashboard_configs`, one row per workspace | authenticated workspace users | `shared_admin_write` |
| Department groups, labels, memberships, exclusions, and department boards | `workspace_group_configs`, one row per workspace | `authenticated_read` | `user_write` |
| Visible groups and favorite/active group | `user_group_preferences`, workspace + user | current user | `user_write` |
| EPM scope, label prefix, issue types, project-label mappings, and EPM view state | private `view_configs`, workspace + owner | current user | `user_write` |
| Connections and tokens | user auth connection/token tables | current user | `user_write` |

Required behavior:

- Two users in one workspace read the same administrator and department-group configuration but different EPM configuration and group preferences.
- A non-admin user can open and save Departments and EPM. The Admin tabs remain hidden or read-only according to the existing admin gate.
- `GET/POST /api/epm/config` use the current user's default private view in DB mode. POST patches only `view.epm`, preserves every unrelated private field, appends one `ViewConfigVersion`, and does not require or advance the workspace `baseRevision`.
- `POST /api/epm/projects/configuration` remains a draft preview/read operation. It uses the submitted draft to fetch configuration candidates, does not persist, and is classified `authenticated_read`, not an administrator mutation.
- Workspace snapshots and administrator recovery never expose, import, save, or promote EPM.
- Existing workspace rows containing the mistakenly shared `epm` section are cleaned by a forward migration. The migration does not infer an owner and does not create or update any `ViewConfig` or `ViewConfigVersion`.
- `401` always means authentication recovery is required. A non-admin user does not receive `401` or `403 admin_required` for group or EPM writes when the authenticated `user_write` checks pass.
- Group/EPM load and save `401` responses preserve dirty UI state and show the sanitized sign-in recovery action instead of only `Groups config error 401`.

## Endpoint Contract

All unsafe OAuth requests require an active session, `X-Requested-With: jira-execution-planner`, and the token-bound `X-CSRF-Token`.

| Route | Policy | Request | Success | Relevant errors |
| --- | --- | --- | --- | --- |
| `GET /api/config?includeViewConfig=true` | `authenticated_read` | none | shared administrator snapshot/revision plus private resolved view; `epm` compatibility field comes only from the private view | `401 auth_required`, `503 config_storage_unavailable` |
| `GET /api/epm/config` | `authenticated_read` | none | normalized current-user EPM object; no workspace `configRevision`; empty defaults when no view exists | `401`, `503` |
| `POST /api/epm/config` | `user_write` | normalized EPM object; no workspace identity or `baseRevision` | normalized saved EPM object and private `viewConfigId` metadata | `400 invalid shape/forbidden field`, `401`, `403` CSRF, `503`; never `admin_required` |
| `POST /api/epm/projects/configuration` | `authenticated_read` | EPM draft | derived project candidate payload; no persistence | `400`, `401`, `409 home_user_token_required` |
| `GET/POST /api/groups-config` | `authenticated_read` / `user_write` | existing revisioned group payload | existing shared group snapshot | `400`, `401`, `403` CSRF, `409` stale shared revision, `503`; never `admin_required` |

The DB EPM save response is:

```json
{
  "version": 2,
  "labelPrefix": "rnd_project_*",
  "scope": {"rootGoalKey": "ROOT-1", "subGoalKeys": ["GOAL-2"]},
  "issueTypes": {"initiative": ["Initiative"], "epic": ["Epic"], "leaf": ["Story"]},
  "projects": {},
  "viewConfigId": "synthetic-view-id"
}
```

The corrected EPM endpoints must not add actor/user/workspace identifiers, credentials, Home tokens, or real local Jira/Home identifiers to their response bodies or logs. Existing resolved-view source metadata returned by `/api/config?includeViewConfig=true` remains unchanged.

## File Map

- `backend/config/shared_config.py`: administrator/private allowlists and EPM input validation.
- `backend/config/db_repository.py`: owner-scoped default-view EPM read/patch and version history.
- `backend/config/import_config.py`: legacy JSON split between workspace sections, shared groups, and the importing user's private EPM/view state.
- `backend/routes/epm_routes.py`: user-owned EPM GET/POST contract and draft preview route.
- `backend/routes/settings_routes.py`: bootstrap precedence and explicit EPM edit permission.
- `backend/security/policy.py`: EPM write and preview policy classes.
- `backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py`: remove misplaced EPM data from workspace rows only.
- `frontend/src/api/configApi.js`: private EPM bootstrap precedence and structured group-load errors.
- `frontend/src/api/epmApi.js`: EPM save without workspace `baseRevision`.
- `frontend/src/dashboard.jsx`: EPM permission, save, bootstrap, recovery, and conflict separation.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`: generated frontend build.
- Focused backend, Node, and Playwright files named in the tasks below.
- Ownership/status docs named in Task 5.

---

### Task 1: Restore The Backend Ownership Boundary

**Files:**
- Modify: `backend/config/shared_config.py`
- Modify: `backend/config/db_repository.py`
- Test: `tests/test_shared_admin_config_validation.py`
- Test: `tests/test_view_config_resolution.py`
- Test: `tests/test_user_view_config_routes.py`

- [ ] **Step 1: Write failing ownership and repository tests**

Add tests proving the administrator allowlist excludes `epm`, a complete normalized EPM object is allowed in private views, workspace payload validation rejects `epm`, and a targeted user EPM update preserves `filters`, `eng`, and other private keys while appending exactly one next-numbered `ViewConfigVersion`.

```python
self.assertNotIn('epm', ADMIN_CONFIG_SECTIONS)
self.assertEqual(validate_private_view_ownership({'epm': private_epm}), {'epm': private_epm})
with self.assertRaisesRegex(ValueError, 'unsupported configuration field: <root>.epm'):
    normalize_workspace_admin_payload({'version': 1, 'epm': private_epm})
```

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_view_config_resolution tests.test_user_view_config_routes
```

Expected: FAIL because EPM is still administrator-owned and private EPM keys are stripped/rejected.

- [ ] **Step 2: Implement targeted private EPM persistence**

Make private ownership explicit:

```python
ADMIN_CONFIG_SECTIONS = frozenset({
    'version', 'projects', 'board', 'capacity', 'sprintField',
    'storyPointsField', 'parentNameField', 'teamField', 'projectTrackField',
    'deliveryOwnerField', 'statsPriorityWeights', 'issueTypes',
})
PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS = ADMIN_CONFIG_SECTIONS - {'version'}
PRIVATE_EPM_KEYS = frozenset({'version', 'labelPrefix', 'scope', 'issueTypes', 'projects', 'tab', 'selectedSprint'})
```

Add `DbConfigRepository.load_user_epm_config(context)` and `save_user_epm_config(context, epm_payload)`. Both select by request-derived `workspace_id` and `owner_user_id`. Load returns normalized empty EPM defaults when no default view exists. Save creates a private default row named `Default view` only when none exists, merges the normalized settings keys into the existing `payload['epm']` so personal `tab` and `selectedSprint` survive, preserves every unrelated payload field, updates `view_type` through `infer_view_type`, and writes `ViewConfigVersion(change_note='user EPM update')`. Do not restore the forbidden full-dashboard replacement path.

- [ ] **Step 3: Run the focused tests and commit**

```bash
.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_view_config_resolution tests.test_user_view_config_routes
git diff --check
git add backend/config/shared_config.py backend/config/db_repository.py tests/test_shared_admin_config_validation.py tests/test_view_config_resolution.py tests/test_user_view_config_routes.py
git commit -m "Restore user-owned EPM persistence"
```

Expected: focused tests pass and the commit contains only repository/ownership behavior.

### Task 2: Correct EPM Routes, Bootstrap, And Access Policies

**Files:**
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/security/policy.py`
- Modify: `jira_server.py`
- Test: `tests/test_epm_config_api.py`
- Test: `tests/test_db_admin_routes.py`
- Test: `tests/test_dashboard_bootstrap_config_source.py`
- Test: `tests/test_endpoint_security_matrix.py`
- Test: `tests/test_oauth_settings_routes.py`
- Test: `tests/test_workspace_dashboard_config_service.py`

- [ ] **Step 1: Write failing route and bootstrap tests**

Cover a normal user's successful EPM POST, two-user isolation in one workspace, unrelated-view-field preservation, absence of EPM from `sharedConfig`, `userCanEditEpmConfig: true` for normal users, no workspace revision change after EPM save, and this policy classification:

```python
EndpointPolicy('epm-config-write', '/api/epm/config', frozenset({'POST'}), 'user_write')
EndpointPolicy('epm-projects-configuration', '/api/epm/projects/configuration', frozenset({'POST'}), 'authenticated_read')
```

Run:

```bash
.venv/bin/python -m unittest tests.test_epm_config_api tests.test_db_admin_routes tests.test_dashboard_bootstrap_config_source tests.test_endpoint_security_matrix tests.test_oauth_settings_routes tests.test_workspace_dashboard_config_service
```

Expected: FAIL with shared EPM, `admin_required`, and workspace revision assertions.

- [ ] **Step 2: Route DB EPM through the private repository**

In DB mode, `get_epm_config_endpoint()` calls `load_user_epm_config(current_request_auth_context())`; POST validates EPM input, rewrites draft row ids as today, calls `save_user_epm_config`, and clears only the current user's EPM caches when scope/config changes. Remove `WorkspaceConfigConflict`, `baseRevision`, workspace `configRevision`, and `save_dashboard_config_section('epm', ...)` from this route.

In JSON mode, preserve the existing local single-user file behavior. Both storage modes return the same normalized non-secret EPM fields; DB mode may add only `viewConfigId`.

In `/api/config`, set:

```python
'userCanEditEpmConfig': True,
'epm': private_epm_config,
```

and ensure `sharedConfig` has no `epm`. `includeViewConfig=true` must return the same private EPM source, never merge a workspace EPM value over it.

- [ ] **Step 3: Run route tests and commit**

```bash
.venv/bin/python -m unittest tests.test_epm_config_api tests.test_db_admin_routes tests.test_dashboard_bootstrap_config_source tests.test_endpoint_security_matrix tests.test_oauth_settings_routes tests.test_workspace_dashboard_config_service
git diff --check
git add backend/routes/epm_routes.py backend/routes/settings_routes.py backend/security/policy.py jira_server.py tests/test_epm_config_api.py tests/test_db_admin_routes.py tests/test_dashboard_bootstrap_config_source.py tests/test_endpoint_security_matrix.py tests/test_oauth_settings_routes.py tests/test_workspace_dashboard_config_service.py
git commit -m "Route EPM settings through private views"
```

Expected: focused tests pass; groups remain `authenticated_read`/`user_write` and administrator routes remain `shared_admin_write`.

### Task 3: Clean Misplaced Workspace Data And Correct Legacy Import

**Files:**
- Create: `backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py`
- Modify: `backend/config/import_config.py`
- Modify: `backend/services/workspace_dashboard_config.py`
- Test: `tests/test_db_migrations.py`
- Test: `tests/test_config_jsonfile_fallback.py`
- Test: `tests/test_shared_admin_config_recovery.py`

- [ ] **Step 1: Write failing migration/import/recovery tests**

Prove the migration removes only `payload['epm']`, preserves all other workspace keys, increments `config_revision` only for changed rows, leaves rows without EPM unchanged, and creates zero user view/version rows. Prove legacy JSON import retains EPM in the importing user's private default view and administrator recovery never promotes EPM.

```python
self.assertNotIn('epm', migrated_workspace.payload)
self.assertEqual(migrated_workspace.payload['board'], {'boardId': '7', 'boardName': 'Planning'})
self.assertEqual(session.query(models.ViewConfigVersion).count(), 0)
```

Run:

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_config_jsonfile_fallback tests.test_shared_admin_config_recovery
```

Expected: FAIL because workspace EPM remains and import currently strips private EPM.

- [ ] **Step 2: Implement the data-neutral ownership cleanup**

Create an Alembic revision after `20260826_0007` that reads workspace JSON payloads, removes the top-level `epm` key, and updates only changed rows with `config_revision + 1`. The downgrade recreates no EPM data because ownership cannot be reconstructed safely. Do not log payloads or identifiers.

Update import splitting so local JSON EPM goes only to the importing user's private view. Update every workspace load/recovery allowlist so dormant or malformed `epm` data is filtered even before the migration runs.

- [ ] **Step 3: Run focused tests and commit**

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_config_jsonfile_fallback tests.test_shared_admin_config_recovery
git diff --check
git add backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py backend/config/import_config.py backend/services/workspace_dashboard_config.py tests/test_db_migrations.py tests/test_config_jsonfile_fallback.py tests/test_shared_admin_config_recovery.py
git commit -m "Remove EPM from workspace configuration"
```

Expected: migration and import tests pass with no inferred private owner.

### Task 4: Separate Frontend EPM Saving And Add Auth Recovery

**Files:**
- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/api/epmApi.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `tests/ui/settings_unified_save.spec.js`
- Modify: `tests/ui/settings_admin_access.spec.js`
- Modify: `tests/ui/shared_department_groups.spec.js`
- Generated: `frontend/dist/dashboard.js`
- Generated: `frontend/dist/dashboard.js.map`

- [ ] **Step 1: Write failing frontend tests**

Assert private EPM bootstrap wins even if a stale `sharedConfig.epm` fixture exists, EPM saves omit workspace `baseRevision`, EPM saving never calls `commitSharedConfigRevision`, and `canEditEpmConfiguration` derives only from explicit `userCanEditEpmConfig`.

Add Playwright coverage for a non-admin user who sees Departments and EPM but not Admin, can save groups and EPM, and never posts an administrator endpoint. Add group/EPM `401 auth_required` coverage that preserves the draft and renders the sanitized sign-in recovery link.

Run:

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js
npx playwright test tests/ui/settings_unified_save.spec.js tests/ui/settings_admin_access.spec.js tests/ui/shared_department_groups.spec.js
```

Expected: FAIL on shared EPM precedence, workspace revision threading, admin-derived EPM permission, and generic `Groups config error 401` handling.

- [ ] **Step 2: Implement independent private EPM UI behavior**

Change `saveEpmConfig(backendUrl, draftConfig)` to send only the EPM payload with the existing CSRF/requested-with headers. Seed EPM from `config.viewConfig?.view?.epm || config.epm`, never `sharedConfig.epm`. Set:

```javascript
const canEditEpmConfiguration = userCanEditEpmConfig;
```

Keep EPM dirty/save state outside `workspaceConfigConflict`; workspace “Use latest” must refresh administrator drafts without resetting a dirty EPM draft. Parse structured group/EPM load errors, use `safeAppLoginUrl`, keep the modal and draft open on `401`, and render the existing sign-in recovery action. Do not turn authentication failures into empty group/EPM baselines.

- [ ] **Step 3: Build, verify, and commit**

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js
npx playwright test tests/ui/settings_unified_save.spec.js tests/ui/settings_admin_access.spec.js tests/ui/shared_department_groups.spec.js
npm run build
git diff --check
git add frontend/src/api/configApi.js frontend/src/api/epmApi.js frontend/src/dashboard.jsx tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js tests/ui/settings_unified_save.spec.js tests/ui/settings_admin_access.spec.js tests/ui/shared_department_groups.spec.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "Separate EPM settings from admin saves"
```

Expected: focused Node/Playwright tests and build pass; generated output matches source.

### Task 5: Align Audit Documentation And Run Full Verification

**Files:**
- Modify: `docs/plans/DONE-shared-admin-configuration.md`
- Modify: `docs/plans/DONE-03-db-user-configuration.md`
- Modify: `docs/plans/DONE-04-db-user-home-epm-read-token.md`
- Modify: `docs/plans/SUPPORT-db-migration-claude-review-workflow.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md`
- Modify: `README.md`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/EXEC-user-owned-epm-configuration.md`

- [ ] **Step 1: Correct historical status without rewriting history**

Keep the PR #130 execution status and current-accuracy warning aligned with the implemented correction. Restore `DONE-03` and `DONE-04` as authoritative for private EPM scope/mappings and update the plan index. Document the access matrix in README. Record that existing `settings_action`/`api_result` events already cover the save/access correction and no new analytics event is needed.

- [ ] **Step 2: Run the complete verification set**

```bash
.venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python -m unittest discover -s tests
npm test
npm run build
git diff --exit-code -- frontend/dist
git diff --check
git status --short
```

Expected: every command exits `0`; the post-build generated diff is clean; only documentation/status files remain for the final commit.

- [ ] **Step 3: Review the complete diff and commit documentation/status**

```bash
git diff --stat origin/main...HEAD
git log --oneline -8
git add docs/plans/DONE-shared-admin-configuration.md docs/plans/DONE-03-db-user-configuration.md docs/plans/DONE-04-db-user-home-epm-read-token.md docs/plans/SUPPORT-db-migration-claude-review-workflow.md docs/plans/README.md docs/agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md README.md docs/README_ANALYTICS.md docs/plans/EXEC-user-owned-epm-configuration.md
git commit -m "Align configuration ownership documentation"
```

Expected: final commit contains only ownership/status/analytics documentation. Do not rename this correction plan to `DONE-*` until implementation is verified and accepted or merged.

## Final Review Checklist

- [ ] `rg -n "shared.*EPM|EPM.*shared|administrator-owned.*EPM" backend frontend/src docs tests README.md` returns only explicitly historical/superseded text.
- [ ] `rg -n "epm.*sharedConfigRevision|requestSaveEpmConfig.*sharedConfigRevision|save_dashboard_config_section\('epm'" backend frontend/src tests` returns no active implementation paths.
- [ ] Non-admin group/EPM route tests distinguish authenticated permission from `401` recovery.
- [ ] Two-user and two-workspace tests prove EPM isolation and shared group/admin behavior.
- [ ] Migration tests prove no user rows are inferred or modified.
- [ ] Frontend screenshot/interaction tests prove Admin, Departments, and EPM visibility matches the ownership matrix.
- [ ] Full Python, Node, Playwright focused suites, preflight, and frontend clean-build checks pass.
- [ ] Before push: review `git log --oneline -5`, summarize verification, and wait for explicit user confirmation.
