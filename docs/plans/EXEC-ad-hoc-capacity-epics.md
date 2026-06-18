# Ad Hoc Capacity Epic Configuration Plan

> **For agentic workers:** REQUIRED SUB-SKILL when available: use Superpowers `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Goal:** Add a department/team-group Ad Hoc capacity epic selector that is separate from excluded capacity. Configured Ad Hoc epics, including business-as-usual work, must remain included in Product capacity and reporting, while `excludedCapacityEpics` stays the only list that subtracts capacity, hides stories from included Planning totals, and creates Scenario capacity placeholders.

**Architecture:** Extend the shared group config contract with `teamGroups.groups[].adHocCapacityEpics`. Reuse the existing Jira epic search selector pattern in Settings, normalize the new field through the same backend and frontend group-config paths, then teach reporting helpers to treat Ad Hoc epics as an included Product subcategory. Keep `/api/capacity/config` limited to Jira capacity project and field configuration. Keep `/api/stats/excluded-capacity-source` as the existing scoped issue source for compatibility, but stop using summary matching as Ad Hoc configuration.

**Tech Stack:** Python 3.10+ Flask routes, existing shared group config services, React 19, existing Settings components, existing stats/planning helper modules, Python `unittest`, Node tests, Playwright UI tests.

---

## Status

Not implemented. This plan is ready for execution only after confirming the shared department-group implementation is the current baseline. `EXEC-shared-department-groups.md` is marked implemented in its Status section but still has an `EXEC-*` filename; reconcile that status before editing the shared group contract.

## Product Decisions

1. **Separate config fields.** `excludedCapacityEpics` means not included in planning/product/tech reporting capacity. `adHocCapacityEpics` means included Product capacity that can also be reported as Ad Hoc.
2. **Ad Hoc config is explicit classification.** If a configured Ad Hoc epic appears in data that would otherwise be bucketed as Tech by project key, the Ad Hoc config wins and the story is counted as Product for reporting. This matches the user correction that Ad Hoc/business-as-usual work is Product capacity.
3. **No capacity-admin route change.** `Settings -> Admin -> Capacity`, `/api/capacity/config`, and `/api/capacity` remain only the Jira team-capacity source. They do not store Ad Hoc epic lists.
4. **No auto-selection by summary.** The existing `bau|ad hoc` summary regex in `excludedCapacityStats.js` must not decide Ad Hoc config. It can be deleted or limited to non-persistent suggestions only if the UI clearly saves explicit keys.
5. **No Scenario placeholder behavior.** Ad Hoc epics are scheduled like ordinary included Product work. Only `excludedCapacityEpics` is sent as `excluded_capacity_epics` to Scenario.
6. **Shared group ownership.** Ad Hoc epic keys are shared department/team-group config, not a per-user preference. Existing `baseRevision` conflict behavior applies.
7. **Analytics reuse.** Use existing `settings_action`, `filter_changed`, `stats_action`, and `chart_action` event contracts. Do not send raw epic keys, summaries, group names, team IDs, or Jira issue keys.
8. **Conflict behavior is fail-closed.** One epic key cannot be both excluded and Ad Hoc for the same group. Backend validation rejects normalized overlaps; the UI and shared Planning/Reporting excluded-capacity toggle surface that validation instead of silently moving keys between lists.
9. **Lead Times gets an explicit Ad Hoc selector.** Lead Times/Cohort keeps raw Jira project filters, and also gets a separate Ad Hoc capacity selector. To make Ad Hoc epics visible when their raw project would otherwise be outside the cohort project scope, `/api/stats/epic-cohort` must include configured Ad Hoc epic keys in its backend query and tag them as Ad Hoc. Product/Tech virtual filters for Lead Times are deferred unless a separate report needs them.
10. **Code value naming.** Code-facing values use `AdHoc`, `adHoc*`, or `ad_hoc`. `BAU` must not be a code value; it may appear only in code comments or docs explaining that Ad Hoc includes business-as-usual work.

## Affected Reports

| Surface | Current behavior | Required behavior |
| --- | --- | --- |
| ENG Planning capacity bar and team microbars (`frontend/src/eng/planningCapacityUtils.js`, `frontend/src/dashboard.jsx`) | Subtracts `excludedCapacityEpics` from team capacity and still counts selected SP from raw selected tasks. | Continue subtracting only `excludedCapacityEpics`. Ad Hoc selected stories remain in selected SP and team load. |
| ENG Planning project split (`frontend/src/eng/PlanningProjectSplitBar.jsx`, `frontend/src/eng/planningSelectionStats.js`) | Filters excluded epics out, then buckets included stories by Product/Tech project key. | Filter out only excluded epics. Bucket configured Ad Hoc stories as Product and expose Ad Hoc SP as a Product subcategory in tooltip or segment text. |
| ENG capacity table totals (`buildTeamCapacityStats`, `buildCapacityTotals`) | Counts all capacity tasks and buckets by Product/Tech project key. | Count Ad Hoc stories as Product. Excluded capacity remains out of included Planning math but can still be shown as excluded metadata where already supported. |
| Stats Teams and delivery summary (`frontend/src/stats/statsUtils.js`, `StatsTeamsView.jsx`) | `statsTaskList` removes excluded epics, then local stats bucket Product/Tech by project key. | Ad Hoc stories stay in `statsTaskList`, contribute to total/product done and incomplete counts, and do not reduce Product denominators. |
| Stats Priority (`StatsPriorityView.jsx`) | Uses local stats priority points/counts after excluded epics are removed. | Ad Hoc stories remain included in priority totals. If a product/tech priority split is added later, Ad Hoc belongs to Product. |
| Stats Burndown (`BurnoutChart.jsx`, `/api/stats/burnout`) | Uses issue keys derived from `statsTaskList`. | Ad Hoc stories remain in the issue-key set. Excluded capacity remains out. No Product/Tech split is needed in this report. |
| Stats Lead Times / Cohort (`/api/stats/epic-cohort`, `frontend/src/api/statsApi.js`, `frontend/src/cohort/cohortUtils.js`) | Backend fetches Epics by configured raw project scope; optional "exclude capacity" toggle removes excluded Epic keys from cohort issues; project filter uses issue `projectKey`; the UI has legacy BAU/ad hoc language in this area. | Backend query includes configured Ad Hoc Epic keys in addition to raw project scope, response tags those records as `capacityType: 'ad_hoc'`, the exclude toggle removes only excluded capacity, and Lead Times exposes a selectable Ad Hoc capacity filter. Raw project filters remain raw Jira projects in this slice. |
| Stats Excluded Capacity / effort split (`frontend/src/stats/excludedCapacityStats.js`, `EffortTypeSplitChart.jsx`) | Builds `Excluded Capacity`, `Tech`, and `Product` buckets. A `BAU / ad hoc` dropdown item auto-selects excluded epics by summary regex. | Remove the `BAU / ad hoc` auto-selection label from excluded filters. Add explicit Ad Hoc bucket based on `adHocCapacityEpics`; totals should distinguish `excludedCapacityPoints`, `adHocPoints`, `productPoints`, and `techPoints`, with Product total including Ad Hoc when summarized. |
| Stats Excluded Capacity line chart | Numerator is configured excluded epics; denominator is scoped story points. | Keep numerator as excluded epics only. Add Ad Hoc line/bar reporting only if it shares the same chart component without confusing labels; otherwise document Ad Hoc through effort split in this slice. |
| Stats Mono vs Cross (`buildEpicTeamModeOverall`, `buildEpicTeamModeSprintRows`, `buildEpicTeamModeShare` in `frontend/src/stats/excludedCapacityStats.js` via `dashboard.jsx`) | Uses the same progressive source issues and includes all scoped stories in total SP. | Keep Ad Hoc stories in total and cross denominators. Do not treat Ad Hoc as excluded or a separate denominator. |
| Scenario Planner (`jira_server.py`, `frontend/src/scenario/scenarioLaneUtils.js`) | Receives `excluded_capacity_epics`; those stories become fixed capacity placeholder rows and do not consume scheduling slots. | Continue sending only `excludedCapacityEpics`. Ad Hoc stories must stay in the regular scheduling pipeline and must not use `scheduled_reason='excluded_capacity'`. |
| Legacy `GET /api/stats` (`jira_server.py`) | Backend aggregation buckets by project and appears unused by the current React stats panel. | Audit callers. If any caller remains, apply the same Ad Hoc as Product classification; if none remain, add a source guard proving the frontend does not call it for current stats. |

## Endpoint Contract

| Route | Auth | CSRF | Request | Success | Errors / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/groups-config` in DB/OAuth mode | Existing authenticated read | None | None | Each group includes `excludedCapacityEpics` and `adHocCapacityEpics`, both normalized arrays of uppercase Jira epic keys. | Existing DB rows missing `adHocCapacityEpics` must normalize to `[]` on read, 409 conflict `current`, and export without requiring a destructive migration. Workspace scoping must prevent cross-workspace leakage. |
| `POST /api/groups-config` in DB/OAuth mode | Existing user/shared config write | Existing OAuth token CSRF plus `X-Requested-With` | Existing shared group payload plus optional `groups[*].adHocCapacityEpics`. | Saves the shared catalog with incremented `configRevision`; another user in the same workspace sees the saved Ad Hoc epics. | Existing `400 invalid_groups_config`, `400 unsupported_group_config_field`, `409 group_config_conflict`, auth/CSRF errors. Backend rejects normalized overlap between `excludedCapacityEpics` and `adHocCapacityEpics`. |
| `GET/POST /api/groups-config` in JSON/basic mode | Existing local/basic behavior | Existing behavior | Existing shared group payload plus optional `groups[*].adHocCapacityEpics`. | Reads and writes normalized JSON config. | Preserve the existing JSON-mode response shape unless a separate task intentionally unifies it with DB mode; tests must assert the exact chosen shape. Backend rejects normalized overlap between `excludedCapacityEpics` and `adHocCapacityEpics`. |
| `GET /api/epics/search` | Existing authenticated read | None | `query`, optional `limit` | Existing `{ epics: [{ key, summary }] }`. | Reused by the new selector. No endpoint change. |
| `POST /api/stats/excluded-capacity-source` | Existing authenticated read | Existing `X-Requested-With` behavior | Existing `{ sprintIds, teamIds, refresh? }`. | Existing scoped issues with epic keys/summaries. | Keep route name for compatibility; callers classify excluded versus Ad Hoc locally. |
| `POST /api/stats/epic-cohort` | Existing stats route policy | Existing `X-Requested-With` behavior | Existing `{ startQuarter, teamIds, components, refresh? }` plus normalized `adHocCapacityEpics`. | Cohort issues include normal raw-project-scope Epics plus configured Ad Hoc Epics, tagged with `capacityType: 'ad_hoc'` when applicable. | Cache key must include the normalized Ad Hoc signature. Request logging/analytics must not include raw epic keys. |
| `GET /api/capacity`, `GET/POST /api/capacity/config` | Existing capacity policies | Existing behavior | Existing capacity project/field payloads. | Existing capacity payloads. | No Ad Hoc fields. Add tests/source guards to prevent mixing config responsibilities. |
| `POST /api/scenario` | Existing scenario policy | Existing behavior | Existing `config.excluded_capacity_epics`. | Scenario result. | Do not add Ad Hoc to `excluded_capacity_epics`; no new Scenario payload field is required for this slice. |

Expected group config shape:

```json
{
  "id": "platform",
  "name": "Platform",
  "teamIds": ["team-a"],
  "missingInfoComponents": ["Needs Product"],
  "excludedCapacityEpics": ["OPS-EXCLUDED"],
  "adHocCapacityEpics": ["PROD-ADHOC"],
  "teamLabels": {"team-a": "Platform"}
}
```

## File Map

- Modify: `backend/services/group_config.py` - normalize `adHocCapacityEpics` alongside `excludedCapacityEpics` and reject per-group overlaps.
- Modify: `backend/services/shared_group_config.py` - normalize legacy DB row payloads on read, conflict `current`, save, and export paths.
- Modify: `backend/config/import_config.py` - preserve/normalize Ad Hoc group fields during JSON-to-DB import and rollback export.
- Modify: `tests/test_group_config_service.py`, `tests/test_group_excluded_capacity_epics_api.py`, `tests/test_shared_group_config_routes.py`, `tests/test_shared_group_config_import.py`, `tests/test_config_jsonfile_fallback.py` - backend normalization, conflict, import/export, workspace isolation, and shared persistence coverage.
- Modify: `frontend/src/settings/groupConfigUtils.js` - normalize the new group field and add pure helper coverage.
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx` - add "Epics for Ad Hoc capacity" selector near the existing excluded-capacity selector.
- Modify: `frontend/src/settings/sharedExcludedCapacityToggle.js` - keep Planning/Reporting excluded-capacity toggles from creating excluded/Ad Hoc overlaps.
- Modify or create: `frontend/src/settings/GroupEpicSelector.jsx` only if it removes duplicated selector code without changing current selected-chip/remove/search behavior.
- Create: `frontend/src/capacityClassification.mjs` - shared Product/Tech/Ad Hoc classifier used by Planning, Stats, and Cohort helpers.
- Modify: `frontend/src/dashboard.jsx` - derive `activeGroupAdHocCapacityEpics`, `adHocEpicSet`, and pass it only to reporting/classification helpers.
- Modify: `frontend/src/eng/planningSelectionStats.js`, `frontend/src/eng/planningCapacityUtils.js` - Product classification override and Ad Hoc Product subcategory stats.
- Modify: `frontend/src/eng/PlanningProjectSplitBar.jsx` - expose Ad Hoc as included Product capacity without making it look excluded.
- Modify: `frontend/src/api/statsApi.js`, `frontend/src/stats/statsUtils.js`, `frontend/src/cohort/cohortUtils.js`, `frontend/src/stats/excludedCapacityStats.js`, `frontend/src/stats/EffortTypeSplitChart.jsx` - report classification, cohort request, and effort split changes.
- Modify: `frontend/src/styles/stats/excluded-capacity.css` and any Planning CSS touched by the Ad Hoc subcategory display.
- Modify: `tests/test_group_config_utils.js`, `tests/test_capacity_classification.js`, `tests/test_planning_selection_stats.js`, `tests/test_planning_capacity_utils.js`, `tests/test_stats_utils.js`, `tests/test_excluded_capacity_stats.js`, `tests/test_excluded_capacity_stats_source_guards.js`, `tests/test_frontend_api_source_guards.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js` - frontend helper, analytics, and source guard coverage.
- Modify: `tests/test_epic_cohort_api.py`, `tests/test_oauth_stats_routes.py` - cohort route request/cache/JQL coverage for configured Ad Hoc Epic keys.
- Modify: `tests/ui/shared_department_groups.spec.js`, `tests/ui/planning_selection_defaults.spec.js`, `tests/ui/codebase_structure_smoke.spec.js` - Settings selector, Planning, Stats, and visual smoke coverage.
- Modify: `docs/README_ANALYTICS.md` - document reused analytics events and any new chart `series_type` value such as `ad_hoc`.
- Inspect/modify: `docs/plans/SUPPORT-ga4-user-configuration.md`, `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` only if implementation adds a new dataLayer field or newly registered GA4 custom definition.
- Modify: `README.md` - distinguish excluded capacity from included Ad Hoc Product capacity in setup docs.
- Modify: `docs/plans/README.md` - move this plan to `DONE-*` only after implementation is complete and accepted.

## Task 1: Data Contract And Backend Normalization

**Files:**
- Modify: `backend/services/group_config.py`
- Modify: `backend/services/shared_group_config.py`
- Modify: `backend/config/import_config.py`
- Modify: `tests/test_group_config_service.py`
- Modify: `tests/test_group_excluded_capacity_epics_api.py`
- Modify: `tests/test_shared_group_config_routes.py`
- Modify: `tests/test_shared_group_config_import.py`
- Modify: `tests/test_config_jsonfile_fallback.py`

- [ ] **Step 1.1: Add failing tests for `adHocCapacityEpics` normalization.**
  - Accept arrays and single strings.
  - Trim, uppercase, de-duplicate, and drop blanks.
  - Preserve `excludedCapacityEpics` independently.
  - Existing configs without the field normalize to `[]`.

- [ ] **Step 1.2: Add failing tests for excluded/Ad Hoc overlap validation.**
  - Detect overlaps after trim, uppercase, and de-duplication.
  - Reject overlap in pure service validation, DB/OAuth `POST /api/groups-config`, JSON/basic `POST /api/groups-config`, and imported JSON configs.
  - Assert rejected payloads are not persisted.

- [ ] **Step 1.3: Add shared route persistence and compatibility tests.**
  - Save a group with both `excludedCapacityEpics` and `adHocCapacityEpics`.
  - Load as another user in the same workspace and assert both fields survive.
  - Save `/api/groups-preferences` and assert neither shared epic list changes.
  - Seed a legacy `WorkspaceGroupConfig.payload` without `adHocCapacityEpics` and verify `GET /api/groups-config` returns `adHocCapacityEpics: []`.
  - Create a stale DB save and verify the `409 group_config_conflict.current` payload also includes normalized `adHocCapacityEpics: []`.
  - Create two workspaces and verify Ad Hoc epics saved in workspace A are not visible in workspace B.

- [ ] **Step 1.4: Add import/export coverage.**
  - Import legacy JSON without `adHocCapacityEpics` and assert DB rows normalize the field to `[]`.
  - Import JSON with `adHocCapacityEpics` and assert normalized values survive DB import and rollback export.
  - Export a legacy DB row and assert the exported `teamGroups` contains normalized `adHocCapacityEpics`.

- [ ] **Step 1.5: Implement backend normalization and validation.**
  - Use the existing `normalize_epic_keys_fn` path for both fields.
  - Include `adHocCapacityEpics: []` in `build_default_groups_config()`.
  - Normalize existing DB payloads in `shared_group_config` read/save/conflict/export paths.
  - Preserve existing JSON/basic response shape unless this task intentionally changes and tests that shape.

**Verification:**

```bash
.venv/bin/python -m unittest tests.test_group_config_service tests.test_group_excluded_capacity_epics_api tests.test_shared_group_config_routes tests.test_shared_group_config_import tests.test_config_jsonfile_fallback
```

## Task 2: Settings UI Selector

**Files:**
- Modify: `frontend/src/settings/groupConfigUtils.js`
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx`
- Modify: `frontend/src/settings/sharedExcludedCapacityToggle.js`
- Modify or create: `frontend/src/settings/GroupEpicSelector.jsx`
- Modify: `tests/test_group_config_utils.js`
- Modify: `tests/test_excluded_capacity_stats_source_guards.js`
- Modify: `tests/ui/shared_department_groups.spec.js`

- [ ] **Step 2.1: Add frontend normalization/helper tests.**
  - `normalizeGroupsConfig()` preserves `adHocCapacityEpics`.
  - Existing helper tests prove excluded toggles do not mutate Ad Hoc keys.
  - Existing shared excluded-capacity toggle tests prove the toggle carries the current group payload without dropping `adHocCapacityEpics`.
  - Add a pure helper only if inline add/remove logic would otherwise duplicate the excluded selector.

- [ ] **Step 2.2: Add the Settings selector.**
  - Place it beside "Epics for excluded capacity" in `Settings -> Departments -> Team groups`.
  - Label: `Epics for Ad Hoc capacity`.
  - Add a short code comment only where needed to explain that Ad Hoc includes business-as-usual work; do not add BAU as a UI label or config value.
  - Reuse `/api/epics/search`.
  - Preserve selected-chip remove behavior and keyboard add/remove behavior.
  - Prevent the same key from appearing twice in the Ad Hoc list.

- [ ] **Step 2.3: Add conflict validation.**
  - Block save if the same normalized epic key is present in both `excludedCapacityEpics` and `adHocCapacityEpics` for one group.
  - Show the validation in the existing Settings save error path without silently removing the key from either list.
  - Treat backend validation from Task 1 as the source of truth so imported JSON and stale clients cannot create contradictory config.

- [ ] **Step 2.4: Guard the shared excluded-capacity toggle path.**
  - When Planning/Reporting toggles an epic into excluded capacity, block with a clear message if that key is configured as Ad Hoc for the active group.
  - Do not silently remove it from `adHocCapacityEpics`.
  - Add a source guard that `saveSharedExcludedCapacityToggle()` preserves `adHocCapacityEpics` and surfaces backend overlap errors.

- [ ] **Step 2.5: Add Playwright Settings coverage.**
  - Open Settings -> Departments -> Team groups.
  - Add a synthetic Ad Hoc epic.
  - Save all dirty Settings sections through the existing footer Save.
  - Assert the `/api/groups-config` payload includes `adHocCapacityEpics` and preserves `excludedCapacityEpics`.
  - Attempt an overlap and assert the UI blocks or surfaces the backend validation without saving.

**Verification:**

```bash
node --test tests/test_group_config_utils.js tests/test_excluded_capacity_stats_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js
```

## Task 3: Shared Product Classification Helpers

**Files:**
- Create: `frontend/src/capacityClassification.mjs`
- Create: `tests/test_capacity_classification.js`
- Modify: `frontend/src/eng/planningSelectionStats.js`
- Modify: `frontend/src/eng/planningCapacityUtils.js`
- Modify: `frontend/src/stats/statsUtils.js`
- Modify: `frontend/src/cohort/cohortUtils.js`
- Modify: related Node tests

- [ ] **Step 3.1: Introduce a small classification helper.**
  - Add `frontend/src/capacityClassification.mjs`.
  - Export `classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet })`.
  - Return shape: `{ projectType: 'product' | 'tech', capacityType: 'ad_hoc' | 'product' | 'tech', productSubtype: 'ad_hoc' | 'standard' | null }`.
  - Normalize story-level parent epic keys from `epicKey`/`parentKey`, and Epic-level keys from `key` for Lead Times/Cohort.
  - Rule: `adHocEpicSet` wins over `techProjectKeys`; excluded filtering happens before classification and is not part of this helper.
  - Add dedicated tests for Tech-project Ad Hoc stories, ordinary Product stories, ordinary Tech stories, blank keys, and Epic-level cohort records.

- [ ] **Step 3.2: Update Planning helpers.**
  - `buildSelectedPlanningTasksList()` continues to remove only excluded epics.
  - `buildSelectedProjectStats()` and `buildSelectedTeamProjectStats()` count Ad Hoc as Product.
  - `buildExcludedProjectStats()` remains excluded-only and does not accept Ad Hoc keys.

- [ ] **Step 3.3: Update local Stats helpers.**
  - `buildLocalStatsFromTasks()` receives `adHocEpicSet`.
  - Product done/incomplete/priority counts include Ad Hoc even when project key is otherwise Tech.
  - Existing total counts remain unchanged except for issues previously misclassified as Tech.

- [ ] **Step 3.4: Update Lead Times filtering helpers.**
  - The existing exclude-capacity toggle removes only excluded keys.
  - `filterCohortIssues()` continues to compare excluded Epic keys to cohort issue `key`, because cohort records are Epics.
  - Raw project filtering remains raw Jira `projectKey`; no Product/Tech virtual filter is introduced in this slice.
  - Add a separate capacity filter option that can select only `capacityType: 'ad_hoc'`.
  - `deriveProjectOptions()` keeps raw Jira projects, and any Ad Hoc indicator comes from `capacityType`, not from rewriting `projectKey`.

**Verification:**

```bash
node --test tests/test_capacity_classification.js tests/test_planning_selection_stats.js tests/test_planning_capacity_utils.js tests/test_stats_utils.js
```

## Task 4: Dashboard Wiring And Planning Reports

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/PlanningProjectSplitBar.jsx`
- Modify: Planning/Stats UI tests and source guards

- [ ] **Step 4.1: Derive the active Ad Hoc set.**
  - Add `activeGroupAdHocCapacityEpics` and `adHocEpicSet`.
  - Do not merge it into `excludedEpicSet`.
  - Include Ad Hoc signatures in affected memo/cache dependencies:
    - Local stats build near `buildLocalStatsFromTasks()`.
    - Planning selected project stats.
    - Selected team project stats.
    - Team capacity stats and capacity table totals.
    - Effort split rows and chart state.
    - Cohort request/cache key.

- [ ] **Step 4.2: Pass Ad Hoc only to classification helpers.**
  - Planning selected project stats.
  - Selected team project stats.
  - Team capacity stats and capacity table totals.
  - Local stats build.
  - Cohort filter/classification, if needed.

- [ ] **Step 4.3: Update Planning project split display.**
  - Show Ad Hoc as part of Product capacity, either as a Product tooltip line or a small Product subsegment.
  - Do not use excluded-zone styling.
  - Keep text within the existing project split bar at desktop and mobile widths.

- [ ] **Step 4.4: Keep Product/Tech Jira links consistent with reclassification.**
  - Stats Teams Product links must include configured Ad Hoc issue keys when those issues are counted as Product.
  - Tech links must exclude configured Ad Hoc issue keys when those issues would otherwise match Tech project JQL.
  - Planning capacity table/status links must follow the same rule.
  - Prefer issue-key-list links when the loaded scoped issue set is available; otherwise add explicit `issuekey in (...)` / `issuekey not in (...)` clauses.
  - Add tests or source guards for `StatsTeamsView.jsx`, `buildTeamStatusLink()`, and Planning capacity table link construction.

- [ ] **Step 4.5: Guard Scenario payload.**
  - Add a source guard or unit test proving `buildScenarioPayload()` sends only `excluded_capacity_epics: Array.from(excludedEpicSet)`.
  - Add a Scenario test fixture where an Ad Hoc epic is scheduled as normal work, not a placeholder.

**Verification:**

```bash
node --test tests/test_excluded_capacity_stats_source_guards.js tests/test_frontend_api_source_guards.js
npx playwright test tests/ui/planning_selection_defaults.spec.js
```

## Task 5: Stats Capacity Mix Reporting

**Files:**
- Modify: `frontend/src/stats/excludedCapacityStats.js`
- Modify: `frontend/src/stats/EffortTypeSplitChart.jsx`
- Modify: `frontend/src/styles/stats/excluded-capacity.css`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_excluded_capacity_stats.js`
- Modify: `tests/ui/codebase_structure_smoke.spec.js`

- [ ] **Step 5.1: Allow Ad Hoc-only capacity mix reporting to load.**
  - Change the dashboard stats-source load gate so the source fetch runs when either `excludedCapacityEpics` or `adHocCapacityEpics` is configured.
  - Pass Ad Hoc keys into effort split classification.
  - If a group has Ad Hoc keys but no excluded keys, render the Ad Hoc effort split bucket and keep the excluded-capacity line chart empty/disabled with a clear excluded-only empty state.
  - Cache keys and loading dependencies must include both excluded and Ad Hoc signatures.

- [ ] **Step 5.2: Replace summary-regex auto-selection with explicit Ad Hoc config.**
  - Remove `pickAutoSelectedExcludedEpics()` or make it non-authoritative.
  - Remove the `BAU / ad hoc` option from the excluded-epic filter dropdown.
  - Keep excluded filtering about configured excluded epics only.
  - Migrate existing browser preference state for `excludedCapacitySelectedEpicKeys`: if it is `null`, default to all configured excluded epics; if it contains keys no longer in the excluded catalog, drop only invalid excluded keys.
  - Update source guards that currently require the old preset label, auto-select helper, or `Filter: BAU / ad hoc`.

- [ ] **Step 5.3: Add Ad Hoc effort split bucket.**
  - Extend effort split rows/totals with `adHocPoints`.
  - Bucket order: `Excluded Capacity`, `Ad Hoc`, `Product`, `Tech`.
  - Product summary should make clear whether it means Product total including Ad Hoc or Product excluding Ad Hoc. Prefer `Product total` in summary cards and `Product other` in stacked segments if both are shown.

- [ ] **Step 5.4: Keep excluded capacity line chart semantics strict.**
  - The excluded line chart numerator remains excluded epics only.
  - If Ad Hoc trend is added in this slice, use a separate label and series identity such as `ad_hoc`, not the excluded series.

- [ ] **Step 5.5: Verify Mono vs Cross denominators.**
  - Add a fixture with Ad Hoc stories in mono and cross epics.
  - Assert Total SP includes Ad Hoc and Cross Share uses cross SP / total team SP.
  - Assert no Excluded Capacity filter is applied to Mono vs Cross.
  - Cover `buildEpicTeamModeOverall`, `buildEpicTeamModeSprintRows`, and `buildEpicTeamModeShare` in `frontend/src/stats/excludedCapacityStats.js`.

**Verification:**

```bash
node --test tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js
```

## Task 6: Lead Times / Cohort Route And UI

**Files:**
- Modify: `jira_server.py`
- Modify: `frontend/src/api/statsApi.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/cohort/cohortUtils.js`
- Modify: `tests/test_epic_cohort_api.py`
- Modify: `tests/test_oauth_stats_routes.py`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/ui/codebase_structure_smoke.spec.js`

- [ ] **Step 6.1: Extend the cohort request contract.**
  - Send normalized `adHocCapacityEpics` from the active group when loading `/api/stats/epic-cohort`.
  - Add the normalized Ad Hoc signature to `cohortQueryKey` and `cohortCacheRef` keys.
  - Add Lead Times UI state for the capacity selector using code values such as `all` and `ad_hoc`; do not use BAU as a code value.
  - Keep request analytics at `featureName: 'stats'`; do not include raw epic keys in analytics payloads.

- [ ] **Step 6.2: Extend backend cohort JQL and response tags.**
  - Normalize and cap `adHocCapacityEpics` server-side using the same epic-key normalizer.
  - Query `issuetype = Epic AND (project in (...) OR key in (...adHoc keys...)) AND created >= ...`.
  - Preserve the existing team/component scope clause for both raw-project and Ad Hoc-key matches.
  - Add `capacityType: 'ad_hoc'` for configured Ad Hoc records and normal Product/Tech classification metadata only if needed by the UI.
  - Include the Ad Hoc signature in any backend cache key if the route adds caching in this slice.

- [ ] **Step 6.3: Keep cohort filters explicit.**
  - Raw project dropdowns remain raw Jira project keys.
  - The Ad Hoc capacity selector filters to configured `capacityType: 'ad_hoc'` cohort records. If the current UI label remains `BAU / ad hoc`, it is display copy only; code and analytics values use `ad_hoc`.
  - The "exclude capacity" toggle removes only configured excluded Epic keys.
  - Add tests proving a Tech-project Ad Hoc Epic returned by key remains visible in the cohort dataset, is selectable through the Ad Hoc capacity filter, and is only filtered out by raw project selection if the user chooses a different raw project.

**Verification:**

```bash
.venv/bin/python -m unittest tests.test_epic_cohort_api tests.test_oauth_stats_routes
node --test tests/test_frontend_api_source_guards.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js
```

## Task 7: Backend Legacy Stats Audit

**Files:**
- Inspect/modify: `jira_server.py`
- Modify: backend route/source guard tests only if needed

- [ ] **Step 7.1: Prove whether current frontend calls `GET /api/stats`.**
  - Use `rg` source guard coverage, not manual inspection alone.
  - If no frontend caller remains, document it in a source guard and leave route behavior unchanged.

- [ ] **Step 7.2: If a caller remains, apply Ad Hoc as Product classification there too.**
  - Route must get group config for the requested `groupId`.
  - Cache key must include the Ad Hoc epic signature if route output changes.
  - Tests must cover an Ad Hoc epic otherwise classified as Tech being returned under Product.

**Verification:**

```bash
.venv/bin/python -m unittest tests.test_backend_route_source_guards
```

## Task 8: Analytics, Docs, Build, And Visual Verification

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Inspect/modify: `docs/plans/SUPPORT-ga4-user-configuration.md`
- Inspect/modify: `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`
- Modify: `tests/test_analytics_events.js`
- Modify: `tests/test_analytics_source_guards.js`
- Modify: `README.md`
- Modify: generated `frontend/dist/*` through `npm run build`

- [ ] **Step 8.1: Update analytics documentation and tests.**
  - Settings selector add/remove/save uses `event=userevent`, canonical `event_name='settings_action'`, `feature_name='settings'`, and bucketed counts only.
  - Capacity mix/chart toggles use existing chart/filter events where possible; if `series_type: ad_hoc` is added, update `frontend/src/analytics/events.js`, `tests/test_analytics_events.js`, and `docs/README_ANALYTICS.md`.
  - Document trigger, event type, canonical `event_name`, `feature_name`/`page_name`, typed params, and privacy reason for each changed event.
  - Do not add raw epic keys, summaries, team names, group names, issue keys, or config payloads to events.
  - Update `docs/plans/SUPPORT-ga4-user-configuration.md` and `SUPPORT-ga4-gtm-mcp-execution.yaml` only if the implementation adds a new dataLayer field, custom definition, or runbook requirement; otherwise document why no GTM/GA4 config change is needed.

- [ ] **Step 8.2: Update user setup docs.**
  - Explain that excluded capacity epics are not included in planning capacity.
  - Explain that Ad Hoc capacity epics, including business-as-usual work, are included Product capacity and reported separately.
  - Clarify that Admin Capacity is only the Jira capacity project/field.

- [ ] **Step 8.3: Build and run focused verification.**
  - `npm run build`
  - Focused Node and Python tests from prior tasks.
  - Playwright screenshots for Settings selector, Planning capacity/project split, Stats effort split, and Mono vs Cross.

- [ ] **Step 8.4: Run full verification before push.**
  - `.venv/bin/python -m unittest discover -s tests`
  - `npm run build`
  - Relevant Playwright suite or documented subset if full UI run is too slow.

## Acceptance Criteria

- Settings exposes a department/team-group Ad Hoc epic selector separate from excluded capacity.
- `GET/POST /api/groups-config` round-trips `adHocCapacityEpics` in JSON and DB/OAuth modes.
- The same epic cannot silently behave as both excluded and Ad Hoc for one group.
- Ad Hoc stories remain included in Planning selected SP, Product project split, Stats Teams/Priority/Burndown/Lead Times, Mono vs Cross totals, and Scenario scheduling.
- Lead Times has a selectable Ad Hoc capacity filter backed by configured `adHocCapacityEpics`; any BAU/ad hoc text there is display copy only.
- Excluded capacity reports and Scenario placeholders are still driven only by `excludedCapacityEpics`.
- The old "BAU / ad hoc" summary regex no longer acts as hidden configuration.
- Analytics and docs distinguish excluded capacity from included Ad Hoc Product capacity without sending raw Jira identifiers.
