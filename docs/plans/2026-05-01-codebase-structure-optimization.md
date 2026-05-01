# Codebase Structure Optimization Execution Plan

Date: 2026-05-01
Plan branch: `docs/codebase-structure-optimization-plan`

Implementation branches should be separate phase branches, for example
`improvement/codebase-phase-1-css-source` or
`improvement/codebase-phase-4-epm-boundary`.

## Goal

Make the project easier for humans to read and safely change by separating:

- view ownership: EPM, ENG, settings, planning, stats, scenario
- shared UI primitives: controls, buttons, loading states, issue cards
- frontend API calls: typed-by-convention request modules
- backend route/service/domain code: `backend/`, with EPM under `backend/epm/`

The cleanup must preserve current behavior, route contracts, startup request count,
cache behavior, and endpoint timing visibility.

## Current Problem

- `frontend/src/dashboard.jsx` is about 17k lines and owns app shell,
  ENG task loading, EPM state, settings, alerts, planning, stats, scenario mode,
  shared controls, and substantial render logic.
- `jira_server.py` is about 7.7k lines and owns Flask setup, Jira client behavior,
  config persistence, ENG endpoints, EPM endpoints, stats, scenario, static file
  serving, and shared helper code.
- `frontend/dist/dashboard.css` is treated as generated output, but it is also the
  only stylesheet source today.
- Existing EPM extraction work is useful but incomplete:
  `frontend/src/epm/*`, `epm_home.py`, `epm_scope.py`, and `epm_rollup.py`
  should be expanded and then moved into the final backend package structure.

## Non-Goals

- No new frontend framework, state library, router, CSS framework, or component library.
- No route renames or response shape changes.
- No broad visual redesign.
- No migration away from Flask, React, esbuild, or `unittest`.
- No speculative abstractions, retries, caching layers, or request deduping.
- No new Jira fan-out unless a feature-specific plan defines strict limits and
  timing verification.

## Target Structure

Frontend target:

```text
frontend/src/
  dashboard.jsx                  # thin app shell and cross-view wiring only
  api/
    http.js                      # shared JSON/error helpers
    configApi.js                 # settings/config endpoints
    engApi.js                    # ENG task, backlog, dependency, sprint requests
    epmApi.js                    # EPM config, Home, project, rollup, label requests
    jiraCatalogApi.js            # Jira field/project/board/label catalogs
  ui/
    ControlField.jsx
    IconButton.jsx
    SegmentedControl.jsx
    StatusPill.jsx
    LoadingRows.jsx
    EmptyState.jsx
  issues/
    IssueCard.jsx
    IssueDependencies.jsx
    issueViewUtils.js
  eng/
    EngView.jsx
    useEngSprintData.js
    engTaskUtils.js
    EngAlertsPanel.jsx
  epm/
    EpmView.jsx
    EpmControls.jsx
    EpmSettings.jsx
    useEpmViewData.js
    epmProjectUtils.mjs
    EpmRollupPanel.jsx
    EpmRollupTree.jsx
  settings/
    SettingsModal.jsx
    TeamGroupsSettings.jsx
    JiraFieldSettings.jsx
  styles/
    dashboard.css
```

Backend target:

```text
jira_server.py                   # thin compatibility entrypoint
backend/
  __init__.py
  app.py                         # Flask app creation and blueprint registration
  jira_client.py                 # Jira auth, resilience, search pagination
  config_store.py                # dashboard-config persistence
  epm/
    __init__.py
    home.py                      # Atlassian Home/Townsquare access
    scope.py                     # EPM JQL scope helpers
    rollup.py                    # EPM rollup builders
    projects.py                  # EPM project payload/config resolution
  routes/
    __init__.py
    epm_routes.py
    eng_routes.py
    settings_routes.py
    stats_routes.py
    scenario_routes.py
  services/
    __init__.py
    eng_tasks.py
    alerts.py
    stats.py
    scenario.py
```

Keep root `jira_server.py` throughout the migration because existing commands and
tests import it. Its final role is to import/create the Flask app from
`backend.app`, expose compatibility names needed by tests, and run the local dev
server when executed directly.

## Execution Model

This is not one implementation task. Execute it as independent packages. Each
package gets its own commit, and larger phases should get their own branch.

Subagent rules:

- Give each worker one package and a disjoint write set.
- Tell workers they are not alone in the codebase and must not revert unrelated
  edits.
- Do not run two workers in parallel on `frontend/src/dashboard.jsx` or
  `jira_server.py`.
- Run source guards before moving large code blocks.
- Move code before rewriting behavior.
- After two failed attempts in one package, stop and write down the failure mode
  before retrying.

Commit rules:

- Commit after every package that leaves tests green.
- Commit messages should describe the boundary created, not just "cleanup".
- Do not combine behavior changes with extraction commits.

## Package 0: Baseline And Guardrails

Owner: test/source-guard worker.

Write set:

- `tests/test_epm_view_source_guards.js`
- `tests/test_epm_shell_source_guards.js`
- `tests/test_epm_settings_source_guards.js`
- `tests/test_frontend_api_source_guards.js`
- `tests/test_backend_route_source_guards.py`

Steps:

1. Record current file sizes:

   ```bash
   wc -l frontend/src/dashboard.jsx jira_server.py frontend/src/epm/*.js frontend/src/epm/*.jsx frontend/src/epm/*.mjs epm_*.py
   ```

2. Run baseline checks:

   ```bash
   npm run build
   node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js
   .venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_issues_endpoint
   ```

3. Add frontend source guards:
   - EPM modules must not call ENG endpoints:
     `/api/tasks-with-team-name`, `/api/backlog-epics`, planning/scenario endpoints.
   - ENG modules must not call `/api/epm/*`.
   - New frontend request wrappers must live under `frontend/src/api/` or an
     explicitly allowed feature wrapper.

4. Add backend source guards:
   - After `backend/routes/epm_routes.py` exists, `jira_server.py` must not contain
     large `/api/epm/*` route bodies.
   - After `backend/epm/` exists, new EPM backend helpers must not be added at repo root.

Verification gate:

- `npm run build`
- `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js tests/test_frontend_api_source_guards.js`
- `.venv/bin/python -m unittest tests.test_backend_route_source_guards`

Stop conditions:

- If existing focused tests fail before code changes, record the baseline and do
  not weaken guards to pass.
- If a guard is too broad and blocks current valid code, narrow the allowed path
  instead of deleting the guard.

## Package 1: CSS Source Hygiene

Owner: frontend build/styles worker.

Write set:

- `frontend/src/styles/dashboard.css`
- `frontend/src/dashboard.jsx`
- `package.json`
- `tests/test_dashboard_css_extraction.py`
- `tests/test_epm_view_source_guards.js`
- generated `frontend/dist/dashboard.css`
- generated `frontend/dist/dashboard.js`
- generated `frontend/dist/dashboard.js.map`

Steps:

1. Create `frontend/src/styles/dashboard.css` from the current
   `frontend/dist/dashboard.css`.
2. Import the stylesheet from `frontend/src/dashboard.jsx`.
3. Adjust the build so esbuild emits `frontend/dist/dashboard.css`.
4. Keep `jira-dashboard.html` pointing at `/frontend/dist/dashboard.css`.
5. Update tests to assert both:
   - source CSS exists under `frontend/src/styles/`
   - served dist CSS still contains required selectors.

Guardrails:

- Do not change selector names in this package.
- Do not restyle the UI.
- Generated CSS diffs should be mechanically explainable.

Verification gate:

```bash
npm run build
.venv/bin/python -m unittest tests.test_dashboard_css_extraction
node --test tests/test_epm_view_source_guards.js tests/test_task_filter_menu_compaction_source_guards.js tests/test_initiative_icon_source_guards.js
```

Manual check:

- Load `/jira-dashboard.html`.
- Confirm the stylesheet loads from `/frontend/dist/dashboard.css`.

Stop conditions:

- If esbuild cannot produce equivalent CSS without a larger build change, stop and
  write a smaller build-plan amendment before touching UI code.

## Package 2A: Shared API HTTP Helpers

Owner: frontend API worker.

Write set:

- `frontend/src/api/http.js`
- `tests/test_frontend_api_source_guards.js`

Steps:

1. Add small helpers only:
   - `json(response, label)`
   - `getJson(url, label, options = {})`
   - `postJson(url, body, label, options = {})`
2. Do not migrate feature calls yet.
3. Add guards documenting where raw `fetch()` is still allowed during migration.

Guardrails:

- No retries.
- No global cache.
- No deduping.
- Preserve all caller-provided options.

Verification gate:

```bash
npm run build
node --test tests/test_frontend_api_source_guards.js
```

## Package 2B: EPM API Module

Owner: EPM frontend API worker.

Write set:

- `frontend/src/api/epmApi.js`
- `frontend/src/epm/epmFetch.js`
- `frontend/src/dashboard.jsx`
- generated `frontend/dist/dashboard.js`
- generated `frontend/dist/dashboard.js.map`
- `tests/test_epm_shell_source_guards.js`
- `tests/test_epm_view_source_guards.js`
- `tests/test_frontend_api_source_guards.js`

Steps:

1. Move existing EPM wrapper logic from `frontend/src/epm/epmFetch.js` into
   `frontend/src/api/epmApi.js`.
2. Keep `frontend/src/epm/epmFetch.js` as a compatibility re-export for this phase.
3. Update dashboard imports if needed.
4. Preserve URL construction, query params, `cache: 'no-cache'`, and error labels.

Verification gate:

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_frontend_api_source_guards.js
```

Manual/network check:

- In EPM Active with a sprint selected, request URLs are unchanged.
- In EPM all-projects mode, no duplicate metadata request appears on cold load.

## Package 2C: ENG And Settings API Modules

Owner: ENG/settings frontend API worker.

Write set:

- `frontend/src/api/engApi.js`
- `frontend/src/api/configApi.js`
- `frontend/src/api/jiraCatalogApi.js`
- `frontend/src/dashboard.jsx`
- generated `frontend/dist/dashboard.js`
- generated `frontend/dist/dashboard.js.map`
- `tests/test_dashboard_alert_source_guards.js`
- `tests/test_frontend_api_source_guards.js`

Steps:

1. Move ENG task/backlog/dependency URL construction into `engApi.js`.
2. Move config/catalog requests into `configApi.js` and `jiraCatalogApi.js`.
3. Preserve all request options and request sequencing.
4. Leave startup orchestration in `dashboard.jsx` until Package 5.

Guardrails:

- Do not alter alert preload timing.
- Do not add any request during initial render.

Verification gate:

```bash
npm run build
node --test tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js
```

Manual/network check:

- ENG default initial load has the same endpoint set as before.

## Package 3A: Basic UI Primitives

Owner: frontend UI primitive worker.

Write set:

- `frontend/src/ui/SegmentedControl.jsx`
- `frontend/src/ui/ControlField.jsx`
- `frontend/src/ui/IconButton.jsx`
- `frontend/src/ui/LoadingRows.jsx`
- `frontend/src/ui/EmptyState.jsx`
- `frontend/src/styles/dashboard.css`
- `frontend/src/dashboard.jsx`
- generated `frontend/dist/dashboard.js`
- generated `frontend/dist/dashboard.js.map`

Steps:

1. Extract only repeated UI primitives already visible in the current UI.
2. Keep existing class names where tests or CSS depend on them.
3. Replace one control family at a time:
   - segmented controls
   - labeled control fields
   - compact icon buttons
   - loading/empty states

Guardrails:

- No visual redesign.
- No new icon library.
- No nested cards.
- No broad CSS palette or spacing pass.

Verification gate:

```bash
npm run build
node --test tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js
.venv/bin/python -m unittest tests.test_dashboard_css_extraction
```

Manual check:

- Main header.
- Compact sticky header.
- EPM settings Projects.
- EPM portfolio board.

## Package 3B: Shared Status And Issue UI Prep

Owner: issue UI prep worker.

Write set:

- `frontend/src/ui/StatusPill.jsx`
- `frontend/src/issues/issueViewUtils.js`
- `frontend/src/styles/dashboard.css`
- `frontend/src/dashboard.jsx`
- `frontend/src/epm/EpmRollupPanel.jsx`
- generated `frontend/dist/dashboard.js`
- generated `frontend/dist/dashboard.js.map`
- `tests/test_epm_view_source_guards.js`
- `tests/test_dashboard_alert_source_guards.js`

Steps:

1. Move pure display helpers for status/priority/team labels into `issueViewUtils.js`.
2. Add `StatusPill.jsx` where repeated status/label chips already exist.
3. Do not move full issue cards yet.

Verification gate:

```bash
npm run build
node --test tests/test_epm_view_source_guards.js tests/test_dashboard_alert_source_guards.js
```

## Package 4A: EPM Data Hook

Owner: EPM state worker.

Write set:

- `frontend/src/epm/useEpmViewData.js`
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_epm_settings_source_guards.js`
- `tests/test_epm_view_source_guards.js`
- `tests/test_epm_shell_source_guards.js`

Steps:

1. Move EPM data state and effects into `useEpmViewData.js`:
   - `epmTab`
   - project list/loading/error state
   - selected project id
   - rollup tree/boards/duplicates state
   - request id refs
   - `refreshEpmProjects`, `refreshEpmRollup`, `refreshEpmView`
2. Keep shared sprint/search/header state in `dashboard.jsx` and pass it in.
3. Preserve the cold-load ordering from MRT014.

Guardrails:

- Do not change EPM request parameters.
- Do not change default all-projects behavior.
- Do not move settings JSX in this package.

Verification gate:

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js
.venv/bin/python -m unittest tests.test_epm_projects_api tests.test_epm_rollup_api
```

Manual/network check:

- EPM Active cold load.
- EPM all-projects mode.
- EPM focus mode.

## Package 4B: EPM Controls And View Shell

Owner: EPM render worker.

Write set:

- `frontend/src/epm/EpmView.jsx`
- `frontend/src/epm/EpmControls.jsx`
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_epm_view_source_guards.js`
- `tests/test_epm_shell_source_guards.js`
- `tests/test_epm_settings_source_guards.js`

Steps:

1. Move EPM header controls into `EpmControls.jsx`.
2. Move the EPM render branch into `EpmView.jsx`.
3. Keep `EpmRollupPanel.jsx` as the existing rollup renderer.
4. Keep dashboard responsible for cross-view shell and shared controls only.

Guardrails:

- No change to tab labels, project picker values, or sprint gating.
- No visual redesign.

Verification gate:

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js
```

Manual check:

- EPM Active, Backlog, Archived.
- All-projects and focus mode.
- Compact sticky controls.

## Package 4C: EPM Settings Component

Owner: EPM settings worker.

Write set:

- `frontend/src/epm/EpmSettings.jsx`
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_epm_settings_source_guards.js`
- `tests/test_epm_view_source_guards.js`
- `docs/plans/2026-05-01-codebase-structure-optimization.md`

Steps:

1. Move EPM settings tab content into `EpmSettings.jsx`.
2. Keep the shared settings modal shell in `dashboard.jsx` for now.
3. Preserve selected-chip/remove/search behavior.
4. Preserve saved sub-goal and project label behavior.

Verification gate:

```bash
npm run build
node --test tests/test_epm_settings_source_guards.js tests/test_epm_project_utils.js
```

Manual check:

- Settings -> EPM -> Scope.
- Settings -> EPM -> Projects.
- Existing label picker behavior.

## Package 5A: Shared Issue Card

Owner: issue rendering worker.

Write set:

- `frontend/src/issues/IssueCard.jsx`
- `frontend/src/issues/IssueDependencies.jsx`
- `frontend/src/issues/issueViewUtils.js`
- `frontend/src/dashboard.jsx`
- `frontend/src/epm/EpmRollupPanel.jsx`
- `frontend/src/epm/EpmView.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_epm_view_source_guards.js`
- `docs/plans/2026-05-01-codebase-structure-optimization.md`

Steps:

1. Extract the shared issue/task row renderer into `IssueCard.jsx`.
2. Extract dependency pill/details rendering into `IssueDependencies.jsx`.
3. Wire EPM and ENG to the shared renderer without EPM importing ENG modules.

Guardrails:

- No layout redesign.
- Keep dependency focus/hover behavior.
- Keep task status class names stable.

Verification gate:

```bash
npm run build
node --test tests/test_epm_view_source_guards.js tests/test_dashboard_alert_source_guards.js
```

Manual check:

- ENG task cards.
- EPM issue cards.
- Dependency pills and focus details.

## Package 5B: ENG View And Data Hook

Owner: ENG frontend worker.

Write set:

- `frontend/src/eng/EngView.jsx`
- `frontend/src/eng/useEngSprintData.js`
- `frontend/src/eng/engTaskUtils.js`
- `frontend/src/eng/EngAlertsPanel.jsx`
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_dashboard_alert_source_guards.js`
- `tests/test_epm_view_source_guards.js`
- `docs/plans/2026-05-01-codebase-structure-optimization.md`

Steps:

1. Move ENG sprint task loading into `useEngSprintData.js`.
2. Move ENG-only render panels into `EngView.jsx`.
3. Move alert rendering into `EngAlertsPanel.jsx`.
4. Preserve the request sequencing from MRT010:
   - visible sprint task loads first
   - non-critical alert preload stays deferred/scoped
   - dependency analysis does not duplicate on startup

Verification gate:

```bash
npm run build
node --test tests/test_dashboard_alert_source_guards.js tests/test_epm_view_source_guards.js
node --test tests/test_backlog_alert_sprint_filter.js
.venv/bin/python -m unittest tests.test_epic_cohort_api tests.test_burnout_stats_api
```

Manual/network check:

- ENG default initial load has no additional startup requests.
- Catch Up mode still renders alerts.

## Package 6A: Settings Modal Shell

Owner: settings shell worker.

Write set:

- `frontend/src/settings/SettingsModal.jsx`
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_epm_settings_source_guards.js`
- `docs/plans/2026-05-01-codebase-structure-optimization.md`

Steps:

1. Move only common modal shell behavior into `SettingsModal.jsx`.
2. Keep tab content in current locations.
3. Preserve dirty-state/save/cancel behavior.

Verification gate:

```bash
npm run build
node --test tests/test_epm_settings_source_guards.js
```

Manual check:

- Open/close settings.
- Dirty state.
- Discard confirmation.

## Package 6B: Settings Tab Components

Owner: settings tabs worker.

Write set:

- `frontend/src/settings/TeamGroupsSettings.jsx`
- `frontend/src/settings/JiraFieldSettings.jsx`
- `frontend/src/epm/EpmSettings.jsx`
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/test_epm_settings_source_guards.js`
- `tests/test_team_selection_utils.js`
- `tests/test_team_selection_persistence.js`
- `docs/plans/2026-05-01-codebase-structure-optimization.md`

Steps:

1. Move team group editing into `TeamGroupsSettings.jsx`.
2. Move Jira field/project/board/source config controls into `JiraFieldSettings.jsx`.
3. Keep EPM settings in `EpmSettings.jsx`.
4. Preserve selected-chip/remove/search behavior.

Verification gate:

```bash
npm run build
node --test tests/test_epm_settings_source_guards.js tests/test_team_selection_utils.js tests/test_team_selection_persistence.js
```

Manual check:

- Team groups.
- EPM Scope.
- EPM Projects.
- Source/project/field tabs.

## Package 7A: Backend Package Shell

Owner: backend shell worker.

Write set:

- `backend/__init__.py`
- `backend/app.py`
- `backend/routes/__init__.py`
- `backend/services/__init__.py`
- `jira_server.py`
- backend tests that import `jira_server`

Steps:

1. Create the package shell.
2. Move Flask app creation and blueprint registration scaffolding into `backend/app.py`.
3. Keep root `jira_server.py` as a thin shim that exposes the same `app` object and
   local-run behavior.
4. Do not move routes yet.

Verification gate:

```bash
.venv/bin/python -m py_compile jira_server.py backend/app.py
.venv/bin/python -c "import jira_server; print(jira_server.app.name)"
.venv/bin/python -m unittest tests.test_dashboard_css_extraction tests.test_jira_resilience
```

## Package 7B: Backend Jira And Config Services

Owner: backend infrastructure worker.

Write set:

- `backend/jira_client.py`
- `backend/config_store.py`
- `jira_server.py`
- relevant backend tests

Steps:

1. Extract Jira request mechanics into `backend/jira_client.py`.
2. Extract dashboard config persistence into `backend/config_store.py`.
3. Keep compatibility imports or assignments in `jira_server.py` for tests that
   still patch old names.

Guardrails:

- Jira pagination must keep using `nextPageToken` / `isLast`.
- Do not alter retry/circuit-breaker behavior.
- Do not alter config file shape.

Verification gate:

```bash
.venv/bin/python -m unittest tests.test_jira_resilience tests.test_board_config_api tests.test_priority_weights_config_api tests.test_team_catalog_api
```

## Package 7C: Backend EPM Domain Package

Owner: backend EPM domain worker.

Write set:

- `backend/epm/__init__.py`
- `backend/epm/home.py`
- `backend/epm/scope.py`
- `backend/epm/rollup.py`
- `backend/epm/projects.py`
- root compatibility shims if retained:
  - `epm_home.py`
  - `epm_scope.py`
  - `epm_rollup.py`
- `jira_server.py`
- EPM backend tests

Shim strategy:

Use one of these strategies and document the choice in the commit:

- Preferred for lower churn: keep temporary root-level shim modules
  (`epm_home.py`, `epm_scope.py`, `epm_rollup.py`) that re-export from
  `backend.epm.*`, then remove shims in a later cleanup once imports are updated.
- Preferred for a complete package move: update every import in one slice and add
  source guards preventing root-level EPM modules from returning.

Steps:

1. Move `epm_home.py` to `backend/epm/home.py`.
2. Move `epm_scope.py` to `backend/epm/scope.py`.
3. Move `epm_rollup.py` to `backend/epm/rollup.py`.
4. Extract EPM project payload/config resolution into `backend/epm/projects.py`.
5. Preserve patch targets used by tests, either via shims or explicit test updates.

Guardrails:

- Do not change EPM response shapes.
- Do not change rollup cache keys.
- Do not change Home project pagination or lifecycle visibility behavior.

Verification gate:

```bash
.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_issues_endpoint tests.test_epm_rollup_builder tests.test_epm_scope_resolution
```

## Package 7D: Backend Route Blueprints

Owner: backend route worker.

Write set:

- `backend/routes/epm_routes.py`
- `backend/routes/eng_routes.py`
- `backend/routes/settings_routes.py`
- `jira_server.py`
- route/source guard tests

Steps:

1. Move `/api/epm/*` routes into `backend/routes/epm_routes.py`.
2. Move ENG task/team/dependency routes into `backend/routes/eng_routes.py`.
3. Move settings/config routes into `backend/routes/settings_routes.py`.
4. Leave stats and scenario routes for later packages unless the move is trivial.
5. Register blueprints in `backend/app.py`.

Guardrails:

- Route paths, methods, response keys, status codes, cache headers, and
  `Server-Timing` headers must not change.
- Do not mix route extraction with service logic rewrites.

Verification gate:

```bash
.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_issues_endpoint
.venv/bin/python -m unittest tests.test_create_stories_alert tests.test_dependency_chain_ordering tests.test_team_catalog_api tests.test_board_config_api
```

Manual/API check:

```bash
curl http://localhost:5050/api/test
```

## Package 8: Full Performance And Visual Verification

Owner: verification worker.

Write set:

- test/source guard updates only
- PR notes or verification artifact paths

Checks:

1. Startup request count:
   - ENG default view: no extra task, team, config, dependency, or alert requests.
   - EPM all-projects view: no duplicate project metadata and no rollup before saved
     EPM config is loaded.
2. Server timing:
   - EPM aggregate endpoints still expose `Server-Timing`.
   - Heavy ENG task endpoints keep existing timing/debug behavior.
3. Payload scope:
   - Alert preload remains scoped to current-sprint epics.
   - EPM rollups use configured project labels plus selected sprint where applicable.
4. Visual/sticky checks:
   - Catch Up.
   - Planning.
   - Scenario.
   - EPM Active.
   - EPM Backlog.
   - EPM Archived.

Verification gate:

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js tests/test_dashboard_alert_source_guards.js tests/test_epm_settings_source_guards.js
.venv/bin/python -m unittest discover -s tests
```

Manual proof:

- Include screenshots or browser notes for changed UI surfaces.
- Include network request count notes for ENG and EPM cold loads.

## Parallelization Map

Safe to run in parallel:

- Package 0 with plan review only.
- Package 2A with backend planning work.
- Package 7B with frontend UI package only if neither touches shared tests.

Do not run in parallel:

- Any two packages touching `frontend/src/dashboard.jsx`.
- Any two packages touching `jira_server.py`.
- Package 4A/4B/4C with Package 5A/5B.
- Package 7A/7B/7C/7D with each other.

## Completion Criteria

The cleanup is complete when:

- `frontend/src/dashboard.jsx` is a shell that mounts view modules and owns only
  cross-view state.
- EPM code lives under `frontend/src/epm/` plus shared UI/API modules.
- ENG task/alert code lives under `frontend/src/eng/` plus shared issue/API modules.
- Repeated controls use `frontend/src/ui/` primitives.
- Raw frontend `fetch()` calls are rare and limited to API modules or documented
  exceptions.
- `backend/` owns backend internals, with EPM domain logic under `backend/epm/`.
- `jira_server.py` is a thin compatibility entrypoint and no longer contains large
  route bodies for EPM and ENG.
- Existing behavior, route contracts, startup performance, and sticky UI behavior
  are verified.

## Token And Session Budget

Expected total implementation budget: about 1.3M-2.5M agent tokens across multiple
focused sessions.

Rough package ranges:

- Packages 0-1: 80k-150k
- Packages 2A-2C: 150k-300k
- Packages 3A-3B: 150k-300k
- Packages 4A-4C: 250k-500k
- Packages 5A-5B: 250k-500k
- Packages 6A-6B: 150k-300k
- Packages 7A-7D: 300k-600k
- Package 8: 100k-250k

Do not attempt the full plan in one context. The intended shape is one package per
implementation session, with verification and a commit before moving on.
