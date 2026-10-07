# Dashboard App Decomposition Implementation Plan

> **Status:** Planned (2026-10-07). Not started. Follows the closed [#220 extraction plan](DONE-dashboard-scenario-settings-state-extraction.md).
> **Branch:** `improvement/dashboard-app-decomposition`, cut from `origin/main` at `da17de89`. One PR at the end; separate commits inside it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `App()` in `frontend/src/dashboard.jsx` by moving Statistics, Alerts derivation and Capacity ownership into feature modules, turning the closure renderers into components, naming the shared scope, and lazy-loading the Stats, Scenario and Settings views, without changing behavior, data requests or analytics.

**Architecture:** Follow the proven #220 pattern. State that the group bootstrap reads and writes stays in a state-container hook called from `App()` with the same flat interface, beside a pure per-group seam module. Memos and effects move into hooks called at their original positions so effect order is unchanged. Views become stateless components that own only transient UI. The shared scope is first an inline memoized object in `App()` and is hoisted into `useEngScope()` only after Stats, Alerts and Capacity all consume it.

**Tech Stack:** React 19, esbuild 0.27, Node 20 `node --test`, Playwright (Chromium), Python `unittest`, `scripts/extraction_lint`.

## Global Constraints

- Behavior-preserving. No new user-visible feature, no new request, no changed request body, no changed analytics event. Analytics impact review: none; allowlist reason is "pure refactor, every `trigger`, `event_name`, `feature_name` and param stays byte-identical" and is proven by `tests/test_analytics_source_guards.js` plus `tests/test_extraction_quirk_pins.js`.
- One PR, published once at the end through the section 10 publication transaction in `AGENTS.md`. Never merge feature work into local `main`.
- The only operator stop is before the PR, after the full Chromium `tests/ui` run. Between commits the automated per-commit gate below is the only gate.
- Out of scope (own plan later): group state and config bootstrap (`buildDefaultGroupState`, `buildGroupStateSnapshot`, `applyGroupState`, `groupStateSnapshot`, `resetSprintScopedState`, `loadConfig`), the Sprint catalog and its cache-first startup, the task-loading pipeline, and Scenario history/save/rollback (issue #230).
- Persisted per-group state stays in `App()` through a container hook. Moving it into a component that unmounts is forbidden: `applyGroupState` writes it on every group switch.
- Caches and selections survive closing Stats. Only transient UI (chart hover, open dropdowns, scroll) resets with the view.
- No new dependency. No `file://` support is assumed anywhere: the app is always served from localhost by Flask.
- Do not hand-edit `frontend/dist/`; rebuild with `npm run build` and commit the output because `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff.
- No Co-Authored-By or agent branding in commits, branch names or the PR. Commit as the noreply identity with one-shot `-c user.email=` flags; never commit the personal address.
- Use `.venv/bin/python`; in this worktree there is no `.venv`, so export `JEP_TEST_PYTHON` to an existing interpreter before any Python or Flask-backed spec.
- Run `npm ci` in a fresh worktree before `npm run build` (a build that resolves `node_modules` from an ancestor embeds wrong paths in `dashboard.js.map`).
- Reuse existing classes and components. `SegmentedControl` keeps `eng-mode-control`; dropdowns keep `team-dropdown-*` / `sprint-dropdown-*`; no new global-button overrides.

## Measured Starting State (2026-10-07, `da17de89`)

`frontend/src/dashboard.jsx` is 10,851 lines, one `App()` from line 308, render `return` at 8,862 to 10,851. It holds 163 `useState`, 181 `useMemo`, 90 `useEffect`, 81 `useRef`, no `React.memo`. These ranges are approximate (from declaration spacing) and **must be re-measured at the start of each task** against the then-current file, because earlier commits shift them.

| Responsibility | Current location in `App()` | Notes |
| --- | --- | --- |
| Stats state cells and refs | 880-965, `hideExcludedStats` at 1000 | Lines 939-944 inside this range are not Stats (`isCatchUpMode`, `isEpicRefreshMode`, `boardScopeRequested`, a Board strict-scope effect) and stay in `App()`. Per-group keys: `statsView`, `statsGraphMode`, `burnout{Data,Loading,Error,AssigneeFilter}`, `burndownMetric`, `cohort{Data,Loading,Error,StartQuarter,EndQuarter,GroupBy,ProjectFilter,AssigneeFilter,ExcludeAdHoc,ExcludeCapacity,StatusToggles,SelectedRow}`, `hideExcludedStats` |
| Stats derivation and fetch effects | 4299-5269 and 5488-5779 | 17 anonymous `useEffect` calls inside these ranges (first at 4424, last at 5764); the neighbours at 5313 (reads `showStats`) and 5332 (planning auth resume, not Stats) must be classified; order must be preserved |
| Stats render | 9433-10185 | `<StatsDeliverySummary>`, `<StatsTeamsView>`, `<StatsPriorityView>`, `<BurnoutChart>`, cohort, excluded capacity, Project Track children |
| Stats hover state | 886, 958, 959 | `priorityHoverIndex`, `burnoutHoverPoint`, `burnoutHoverTeamKey`; no group-bootstrap readers; the only Stats cells free to move down |
| Stats readers outside Stats ranges | group bootstrap 2728-2753, 2810-2828, 2887-2899, 2972-2990, 3355-3430; cache clears 1679-1681, 6303, 8642-8647; `isStatsSourceOnlyStatsView` at 3610, 3695, 3725, 3727, 8646; `burnoutTaskFilter` at 5461-5470 (filters the visible task list) | These are why Stats state cannot leave `App()` |
| Alerts derivation | 7037-7482, celebration 7481-7652 | Toggles `show*Alert`, `showAlertsPanel`, `dismissedAlertKeys` are read and written by the group bootstrap (2757, 2833, 2918, 2997, 3382-3445) and stay in `App()` |
| Capacity | state 976-992, derivation and fetch 6452-6773 | `fetchCapacity` at 6591 |
| Closure renderers | 7713-8590 | `renderSearchControl`, `renderViewSwitch`, `renderEngModeControl`, `renderEpmControls`, `renderSprintControl` (7835), `renderGroupControl` (8002), `renderTeamControl` (8099), `renderPlanningReviewFieldEditor`, `renderEpicBlock` (8264, about 348 lines) |
| Out of scope bootstrap | 2664-3733 | Listed in Global Constraints |

Existing infrastructure this plan reuses:

- Render counter: `perfCountersRef.current.renders` increments on every `App()` render when the URL has `?perf` (`dashboard.jsx:315-334`). `tests/ui/scenario_draft_history.spec.js:28-60` shows the in-memory adapter that exposes it as `window.__JEP_EXTRACTION_PERF__` by patching a copy of the bundle; the source is never written.
- Owner budgets: `scripts/extraction_lint/owner_budgets.json` (schema 1), `tests/test_codebase_structure_budgets.py::validate_owner_budgets`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `check_move_conservation.mjs`, `run.sh`.
- Stats UI fixtures and helpers: `tests/ui/codebase_structure_smoke.spec.js` (`installApiMocks`, `waitForCallCount`, `callsFor`, the test at line 1763).
- Flask serves `/frontend/dist/<path:filename>` generically (`jira_server.py:6109`), so extra chunk files need no route.

## File Map

**Create**

| File | Responsibility |
| --- | --- |
| `frontend/src/stats/statsGroupState.js` | Pure per-group seam: ordered keys, defaults from saved prefs, snapshot builder, ordered setter application, transient-ref and cache resets |
| `frontend/src/stats/useStatsState.js` | State container called in `App()`; no effects, no getters; returns the same flat names `App()` uses today |
| `frontend/src/stats/useStatsData.js` | Layered hooks for Stats derivation memos and fetch effects, each called at its original effect position |
| `frontend/src/stats/StatsPanel.jsx` | Stateless Stats view; owns only hover and open-dropdown state |
| `frontend/src/eng/useEngAlerts.js` | Pure alert derivation: epic lists, team lists, counts |
| `frontend/src/eng/useEngCapacity.js` | Capacity read lifecycle and totals |
| `frontend/src/eng/EngControls.jsx` | `SprintControl`, `GroupControl`, `TeamControl`, `SearchControl`, `ViewSwitch` components |
| `frontend/src/eng/EpicBlock.jsx` | `renderEpicBlock` as a component |
| `frontend/src/eng/useEngScope.js` | Hoisted scope object (Task 7 only) |
| `frontend/src/components/LazyViewBoundary.jsx` | Suspense plus retry boundary for lazy views (Task 8) |
| `tests/ui/runtime_probe_helpers.js` | `buildRuntimeProbeBundle`, `readAppRenderCount` for the `?perf` counter |
| `tests/test_stats_group_state.js`, `tests/test_use_stats_state.js`, `tests/test_stats_panel.js`, `tests/test_use_eng_alerts.js`, `tests/test_use_eng_capacity.js`, `tests/test_lazy_view_boundary.js` | Node contracts per module |

**Modify**

| File | Change |
| --- | --- |
| `frontend/src/dashboard.jsx` | Remove moved ranges, add imports and call sites |
| `tests/ui/codebase_structure_smoke.spec.js` | Add the three gate tests and the `runtimeProbe` option to `installApiMocks` |
| `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/tooling_controls.mjs` | Add `stats` and `eng` as owner features for the new files |
| `tests/test_stats_module_extraction_source_guards.js`, `tests/test_stats_controls_source_guards.js`, `tests/test_excluded_capacity_stats_source_guards.js`, `tests/test_cohort_grid_source_guards.js`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_extraction_quirk_pins.js`, `tests/test_auth_isolation_source_guard.js` | Re-point source reads from `dashboard.jsx` to the new owner files via `readOwnerSource`; never weaken an assertion |
| `package.json` | Build config for code splitting (Task 8 only) |
| `jira-dashboard.html` | Entry script tag for the split build (Task 8 only) |
| `tests/test_codebase_structure_budgets.py` | Ratchet `dashboard.jsx` ceiling (Task 9) |
| `docs/ontology.md`, `docs/plans/README.md`, `docs/features/statistics.md`, `AGENTS.md` (section 10 wording), this plan | Documentation (Task 9) |

**Forbidden regressions:** any added or removed API request on cold load or on reopening Stats; changed analytics counts; Stats selections or caches lost on group switch, sprint change or closing Stats; changed effect order; a chart hover re-rendering `App()`; any Stats, Alerts or Capacity visual change.

## Per-Commit Gate

Run all of these before every commit and read the summary lines. A gate that cannot run is reported as not run, never as passed.

```bash
export JEP_TEST_PYTHON=<path to an existing python3.10+ interpreter>
npm ci
node --test tests/test_*.js
$JEP_TEST_PYTHON -m unittest discover -s tests
npm run build && git status --short frontend/dist   # dist must be exactly the committed build
bash scripts/extraction_lint/run.sh
npx playwright test tests/ui/codebase_structure_smoke.spec.js --browser=chromium --workers=4 -g "Statistics|Project Track|Lead Times|Excluded Capacity|Catch Up, Planning"
```

Plus, for every commit that moves code: `node scripts/extraction_lint/check_move_conservation.mjs --base <previous commit> --created-hook <each new owner file> [--deleted-hook <file>] <existing affected hook files>` (usage is in the first lines of the script), which fails on effect-order change and prints residual statements for human review; a zero exit does not approve the residuals. Then Gate A from the global instructions: `git show --stat HEAD` and `git status`, read both, confirm the intended files and content (a rename shows `| 0`).

## Task 0: Safety net, baselines and tooling

Commit message: `Add render-isolation and request baselines for the App decomposition`

**Files:** Create `tests/ui/runtime_probe_helpers.js`. Modify `tests/ui/codebase_structure_smoke.spec.js`, `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/tooling_controls.mjs`.

**Produces:** a red gate-1 test on current code, a green request-count test, and owner tooling that accepts `stats` and `eng` features.

- [ ] **Step 1: Startup checks, base and numbers.** Read `docs/plans/AGENTS.md` and run its startup gate sweep (`rg --files docs/plans | rg '/GATE-'`); no gate is expected to apply, record that.  Run `git branch --show-current` (expect `improvement/dashboard-app-decomposition`), `git rev-parse --short origin/main` and `wc -l frontend/src/dashboard.jsx`. Run the full per-commit gate once and write the pass counts into this plan's Baseline Log section. Any failure on unmodified code is reported to the operator before continuing.

- [ ] **Step 2: Create the probe helper.**

```js
// tests/ui/runtime_probe_helpers.js
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const repoRoot = path.join(__dirname, '..', '..');
const anchor = 'const perfStateLastRef = useRef({});';
const adapter = 'if (perfEnabled) window.__JEP_EXTRACTION_PERF__ = () => ({ ...perfCountersRef.current });';

// Builds a copy of the bundle with the in-memory render-counter adapter. The source file is never written.
function buildRuntimeProbeBundle() {
    const entry = path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx');
    const result = esbuild.buildSync({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
        plugins: [{
            name: 'runtime-probe-adapter',
            setup(build) {
                build.onLoad({ filter: /dashboard\.jsx$/ }, (args) => {
                    const contents = fs.readFileSync(args.path, 'utf8');
                    if (contents.split(anchor).length - 1 !== 1) {
                        throw new Error('runtime adapter anchor must occur exactly once');
                    }
                    return { contents: contents.replace(anchor, `${anchor}\n${adapter}`), loader: 'jsx', resolveDir: path.dirname(args.path) };
                });
            },
        }],
    });
    return result.outputFiles[0].text;
}

async function readAppRenderCount(page) {
    return page.evaluate(() => window.__JEP_EXTRACTION_PERF__().renders);
}

module.exports = { buildRuntimeProbeBundle, readAppRenderCount };
```

- [ ] **Step 3: Add the `runtimeProbe` option to `installApiMocks`.** In `tests/ui/codebase_structure_smoke.spec.js` import the helper, build the probe bundle in `beforeAll` only when `process.env.JEP_RUNTIME_PROBE === '1'`, and extend the route at line 804:

```js
if (options.runtimeProbe) {
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: runtimeProbeBundle,
    }));
} else if (!options.useCommittedDist) {
    // existing route unchanged
}
```

- [ ] **Step 4: Write the gate-1 test (must fail now).** Append beside the test at line 1763. It uses the same prefs and mocks as that test, loads `/?perf=1`, opens Priority then Burndown, and asserts that hovering does not change the `App()` render count.

```js
test('Stats chart hover does not re-render App', async ({ page }) => {
    test.skip(process.env.JEP_RUNTIME_PROBE !== '1', 'opt-in runtime probe');
    const calls = [];
    await installApiMocks(page, calls, { excludedCapacityEpics: ['BAU-EPIC'], runtimeProbe: true });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, { selectedView: 'eng', planningLayout: 'list', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
         activeGroupId: 'grp-default', selectedTeams: ['all'], showPlanning: false, showScenario: false,
         showStats: true, statsView: 'priority' });
    await page.goto(`${appBaseUrl}/?perf=1`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, isTaskListRequest, 2);
    const tabs = page.locator('.stats-panel.open .stats-view-toggle');

    const radarSeries = page.locator('.stats-view.open .priority-radar polygon').first();
    await expect(radarSeries).toBeVisible();
    const beforePriority = await readAppRenderCount(page);
    await radarSeries.hover();
    await page.locator('.stats-view.open .priority-legend > span').first().hover();
    expect(await readAppRenderCount(page)).toBe(beforePriority);

    await tabs.getByRole('radio', { name: 'Burndown' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/burnout', 1);
    const capture = page.locator('.stats-view.open .burnout-hover-capture');
    await expect(capture).toBeVisible();
    const box = await capture.boundingBox();
    const beforeBurnout = await readAppRenderCount(page);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await expect(page.locator('.burnout-hover-bubble')).toBeVisible();
    expect(await readAppRenderCount(page)).toBe(beforeBurnout);
});
```

If the `polygon` selector does not match the radar series element, read `frontend/src/stats/StatsPriorityView.jsx:84-92` and use the element that carries `onMouseEnter={() => setPriorityHoverIndex(idx)}`.

- [ ] **Step 5: Run it and confirm it fails.**

Run: `JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Stats chart hover" --browser=chromium`
Expected: FAIL on the equality assertion because the hover increments the count today. Keep the failing output in the Baseline Log.

- [ ] **Step 6: Write the request-count and reopen test (must pass now).** Same fixture, `useCommittedDist: true`. Record the sorted set of `pathname + method` pairs on cold load into a constant, then: open Stats on Burndown, switch to Catch Up and back, and assert `callsFor(calls, '/api/stats/burnout', 'POST').length` is still 1 and no `/api/stats/*` call count increased. Add a second assertion that the cold-load pair set for Catch Up, Planning and Stats equals the recorded constant. Run it and record it green.

- [ ] **Step 6b: Add the render-count measurement (gate 3).** Add an opt-in test `App render counts for common interactions` (skipped unless `JEP_RUNTIME_PROBE=1`) that, on the same fixture, reads `readAppRenderCount` before and after (a) toggling one Team in the Teams dropdown and (b) switching the Stats view from Teams to Priority, and attaches the two deltas with `testInfo.annotations.push({ type: 'app-renders', description: JSON.stringify({ filterChange, statsViewSwitch }) })`. It asserts nothing about the numbers; Task 9 compares them. Run it three times and record the min and max for each delta in the Baseline Log, because render counts vary with timers.

- [ ] **Step 7: Extend the owner tooling.** In `tests/test_codebase_structure_budgets.py` change the allowed feature set at `set(module["features"]) - {"scenario", "settings"}` to include `"stats"` and `"eng"`, and add both to `totals` and to the required `aggregates`. In `check_hook_interfaces.mjs` replace the `scenario/` versus `settings` feature inference at lines 376-383 with a directory map (`scenario`, `settings`, `epm` unchanged; `stats` and `eng` new) and extend the totals at line 428. Register new files only by explicit module entries; do **not** add `stats` or `eng` to `ownerRoots`, so existing files in those directories stay unregistered. Add a seeded failure for each new feature in `tooling_controls.mjs`.

- [ ] **Step 8: Verify the tooling.** Run `bash scripts/extraction_lint/run.sh` and `bash scripts/extraction_lint/negative_controls.sh`. Expected: all existing checks pass and the new seeded failures are detected.

- [ ] **Step 9: Gate and commit.** Run the per-commit gate (the gate-1 test is excluded from it because it is opt-in and red). Commit with the message above; no trailer. Run Gate A.

## Task 1: Stats state container and per-group seam

Commit message: `Extract the Statistics state container and per-group seam`

**Files:** Create `frontend/src/stats/statsGroupState.js`, `frontend/src/stats/useStatsState.js`, `tests/test_stats_group_state.js`, `tests/test_use_stats_state.js`. Modify `frontend/src/dashboard.jsx`, `scripts/extraction_lint/owner_budgets.json`, the Stats source-guard tests listed in the File Map.

**Interfaces**

- Produces `statsGroupState.js`: `STATS_GROUP_STATE_KEYS` (ordered array equal to the key order of `buildGroupStateSnapshot` for the Stats keys), `buildDefaultStatsGroupState(savedPrefs, resolvers)`, `snapshotStatsGroupState(values)`, `applyStatsGroupState(nextState, setters, resolvers)`, `resetStatsTransientRefs(refs)`.
- Produces `useStatsState(inputs)`: returns an object with exactly today's names and setters for the cells at `dashboard.jsx:880-965` and `1000`, plus the cache refs. No effects, no getters.
- Consumed by `App()` at the earliest former Stats cell (line 880). `buildDefaultGroupState`, `buildGroupStateSnapshot`, `applyGroupState` and `clearEngGroupScopeData` call the seam instead of inlining the Stats keys; their other keys and their order are untouched.

- [ ] **Step 1: Re-measure and write the inventory.** Run `node scripts/extraction_lint/check_hook_interfaces.mjs --write-inventory tmp/stats-inventory.json --manifest scripts/extraction_lint/owner_budgets.json frontend/src/dashboard.jsx` after Task 0, and record in this plan's Ledger section: every Stats cell with its line, whether the group seam reads it, and every reader outside Stats ranges. Use plain `node` scripts for any line counting; macOS `awk` does not support `\<`.
- [ ] **Step 2: Write the pure seam test first.** `tests/test_stats_group_state.js` asserts: `STATS_GROUP_STATE_KEYS` equals the order of the Stats keys extracted from `buildGroupStateSnapshot` in the dashboard source; the default builder reproduces the values at `dashboard.jsx:2728-2753` for a synthetic saved-prefs object (empty, partial, invalid `statsView`); `applyStatsGroupState` calls setters in the same order as `applyGroupState` at 2887-2899 (record the call order with stub setters); `resetStatsTransientRefs` empties `burnoutCacheRef`, `cohortCacheRef`, `excludedCapacityCacheRef` and sets `excludedCapacityForceRefreshRef` as the sites at 1679-1681 do. Run it and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement the seam by moving, not rewriting.** Cut the Stats lines out of the four bootstrap functions into `statsGroupState.js` verbatim and call it from the same positions. Run the new test and expect pass.
- [ ] **Step 4: Write `test_use_stats_state.js`.** Server-render the hook inside a probe component and assert the returned name set equals the measured Step 1 list and contains no `use*` effects (source scan: no `useEffect` in `useStatsState.js`). Confirm it fails, then implement by moving the `useState`/`useRef` lines 880-965 and 1000 verbatim, keeping the same initializers that read `savedPrefsRef.current`.
- [ ] **Step 5: Wire and ratchet.** Replace the moved lines with one `useStatsState(...)` destructure. Register both new files in `owner_budgets.json` with the measured line counts as ceilings and their interface counts; set the transfer checkpoint using the current-base measurement (the ceiling is net scaffolding only, no transfer credit).
- [ ] **Step 6: Re-point source guards.** Update the Stats source-guard tests to read the moved lines through `readOwnerSource` with a positive anchor. Run each one; every assertion must still exist.
- [ ] **Step 7: Gate and commit.** Per-commit gate plus the conservation check with `--created-hook frontend/src/stats/useStatsState.js --created-hook frontend/src/stats/statsGroupState.js`. Commit, run Gate A.

## Task 2: Stats derivation and fetch effects

Commit message: `Move Statistics derivation and fetch effects into useStatsData`

**Files:** Create `frontend/src/stats/useStatsData.js`, `tests/test_use_stats_data.js`. Modify `dashboard.jsx`, `owner_budgets.json`, Stats source-guard tests.

**Interfaces**

- Consumes the inline `scope` object defined in this task (memoized in `App()` directly above the first Stats call): `{ activeGroup, selectedSprintInfo, selectedTeams, scopedTasks, statsTaskList inputs, techProjectKeys, adHocEpicSet, excludedEpicSet, config }`. The exact member list is the measured input set from the inventory; no renames.
- Produces layered hooks in `useStatsData.js`, each taking one object and returning an object literal: `useStatsDerivedA` (ranges 4299-5269 derivations), `useStatsFetchEffects` (the effects at their original positions), `useStatsDerivedB` (5488-5779). If an effect depends on a non-Stats effect between two layers, split into more layers so every Stats effect keeps its position relative to every non-Stats effect.

- [ ] **Step 1: Classify every effect.** In the Ledger, list the 17 effects in the Stats ranges plus the neighbours at 5313 and 5332 with their dependency arrays and mark any non-Stats effect that sits between them. This list is the contract for layer boundaries.
- [ ] **Step 2: Write `test_use_stats_data.js`.** Server-render each layer with synthetic scope and state and assert the output keys equal the measured list; add a source scan that the layered hooks contain the same number of `useEffect` calls as the ledger and that no layer calls another layer.
- [ ] **Step 3: Move by ranges.** Cut the ranges verbatim into the hooks, keep the `perfEnabled` and `perfCountersRef.current.statsBuild` counters, and add one call per layer at the first former line of its range. Do not reorder or merge effects.
- [ ] **Step 4: Verify effect order.** Run `check_move_conservation.mjs`; it must report no effect-order change. Read the residual output and record it in the Ledger.
- [ ] **Step 5: Cold-load requests unchanged.** Run the Task 0 request-count test; expect green with the identical pair set.
- [ ] **Step 6: Gate, register owners, commit, Gate A.**

## Task 3: StatsPanel view and transient state

Commit message: `Render Statistics through a stateless StatsPanel and fix chart hover re-renders`

**Files:** Create `frontend/src/stats/StatsPanel.jsx`, `tests/test_stats_panel.js`. Modify `dashboard.jsx`, `owner_budgets.json`, the Stats source-guard tests.

**Interfaces**

- `StatsPanel` takes `{ stats, scope, links, analytics, onSelectBurnoutTask }`: `stats` is the `useStatsState` plus `useStatsData` output the panel reads; `links` carries `buildStatLink`, `buildPriorityStatLink`, `buildStatLink`-family builders; `analytics` carries `trackStatsAction` and `trackStatsAnalyticsAction`. It renders the `.stats-panel` subtree unchanged and owns `priorityHoverIndex`, `burnoutHoverPoint`, `burnoutHoverTeamKey` and `excludedCapacityEpicDropdownOpen` internally.
- `burnoutTaskFilter` stays in `App()` because `visibleTasks` filters on it (`dashboard.jsx:5461-5470`); the panel receives its setter through `onSelectBurnoutTask`.

- [ ] **Step 1: Write `test_stats_panel.js`.** Server-render `StatsPanel` for each `statsView` value (`teams`, `priority`, `burnout`, `cohort`, `excludedCapacity`, `monoCrossShare`, `projectTrack`) and assert one `.stats-panel` root, the seven-option `SegmentedControl` with class `eng-mode-control stats-view-toggle`, and that no hover state is read from props. Confirm it fails.
- [ ] **Step 2: Move the render.** Cut the JSX at `dashboard.jsx:9433-10185` into the component verbatim, keep every `className`, and move the four transient cells into the component with `useState`. Replace the block with one mount under the unchanged `selectedView === 'eng' && showStats && engWorkspaceConfigured` condition.
- [ ] **Step 3: Gate 1 turns green.** Run `JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Stats chart hover" --browser=chromium`. Expected: PASS. Record before and after counts in the Baseline Log.
- [ ] **Step 4: DOM parity and screenshots.** Capture DOM parity for the seven views before and after with `captureDomParity` (`tests/ui/dom_parity_helpers.js`), diff must be empty. Take screenshots of Teams, Burndown, Lead Times and Project Track at 1280px and 375px from the smoke spec's existing capture helper and compare; wait for animations to settle first.
- [ ] **Step 5: Analytics unchanged.** `node --test tests/test_analytics_source_guards.js tests/test_extraction_quirk_pins.js`; update only the source path the guards read, never a count.
- [ ] **Step 6: Gate, register, commit, Gate A.**

## Task 4: Alerts derivation hook

Commit message: `Extract Alerts derivation into useEngAlerts`

**Files:** Create `frontend/src/eng/useEngAlerts.js`, `tests/test_use_eng_alerts.js`. Modify `dashboard.jsx`, `owner_budgets.json`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_dashboard_missing_labels_source_guards.js`, `tests/test_dashboard_epic_alert_team_links.js`.

**Interfaces**

- `useEngAlerts({ scope, toggles, dismissedAlertSet, ... })` returns the alert lists, team lists, counts and `consolidatedMissingStories`. It owns no state. The `show*Alert` toggles, `showAlertsPanel` and `dismissedAlertKeys` stay in `App()` because the group bootstrap persists them.
- `triggerAlertCelebration` and `alertCelebrationPieces` (two uses) move with the alerts render only if the measured readers allow it; otherwise they stay and are listed in the Ledger.

- [ ] **Step 1: Inventory and test first.** Measure the exact input set with the interface tool. Write `test_use_eng_alerts.js` with synthetic Epics and Stories covering one fixture per alert category (missing Story Points, blocked, postponed, backlog, missing Team, missing labels, needs Stories, waiting, empty Epic, done Epic) plus a dismissed key, asserting the derived lists and team groupings equal expected literals. Run it, confirm failure.
- [ ] **Step 2: Move 7037-7482 verbatim.** Keep predicate order and the existing alert producer as a fallback exactly as today; no data-source change.
- [ ] **Step 3: Gates.** Run the alert specs `tests/ui/eng_alert_loading_order.spec.js`, `tests/ui/eng_alerts_panel_summary.spec.js`, `tests/ui/eng_missing_story_ghosts.spec.js` plus the per-commit gate; commit; Gate A.

## Task 5: Capacity hook

Commit message: `Extract Capacity read lifecycle and totals into useEngCapacity`

**Files:** Create `frontend/src/eng/useEngCapacity.js`, `tests/test_use_eng_capacity.js`. Modify `dashboard.jsx`, `owner_budgets.json`, capacity source-guard tests found with `rg -l "fetchCapacity|capacityState" tests`.

- [ ] **Step 1: Re-measure** state 976-992 and derivation 6452-6773; record readers outside the range (planning panel, Settings `handleCapacitySaved`) in the Ledger.
- [ ] **Step 2: Write `test_use_eng_capacity.js`** for the totals math (`capacityTotalsSummary`, `getTeamNetCapacity`, `excludedCapacityByTeamId`) with synthetic teams, then move the code verbatim, keeping `fetchCapacity` abort and generation-ref semantics.
- [ ] **Step 3: Gates.** `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/adhoc_capacity_visual_proof.spec.js` plus the per-commit gate; commit; Gate A.

## Task 6: Closure renderers become components

Commit message: `Turn ENG control and Epic renderers into components`

**Files:** Create `frontend/src/eng/EngControls.jsx`, `frontend/src/eng/EpicBlock.jsx`, `tests/test_eng_controls.js`. Modify `dashboard.jsx`, `owner_budgets.json`.

- [ ] **Step 1: Test the contract.** Server-render each component with synthetic props and assert the root element, shared class hooks (`eng-mode-control`, `team-dropdown-*`, `sprint-dropdown-*`) and that no component reads module globals. Confirm failure.
- [ ] **Step 2: Move one renderer per sub-commit step**, in this order: `renderSearchControl`, `renderViewSwitch`, `renderEngModeControl`, `renderSprintControl`, `renderGroupControl`, `renderTeamControl`, then `renderEpicBlock`. Props are explicit names from the closure's actual free variables, listed by the interface tool; wrap in `React.memo` only after the prop identities are stable (functions passed through `useCallback`).
- [ ] **Step 3: Geometry and layering.** Per the project learnings, run the header-dropdown and sticky specs: `tests/ui/codebase_structure_smoke.spec.js -g "header dropdown|Catch Up, Planning|multiple groups"` and `tests/ui/eng_sticky_stack_helpers.js` consumers, plus a normal (non-forced) click on each dropdown option.
- [ ] **Step 4: Gate, register, commit, Gate A.**

## Task 7: Hoist the scope object into `useEngScope`

Commit message: `Hoist the shared ENG scope into useEngScope`

**Files:** Create `frontend/src/eng/useEngScope.js`, `tests/test_use_eng_scope.js`. Modify `dashboard.jsx`, `owner_budgets.json`.

- [ ] **Step 1: Freeze the interface from real use.** List the union of members the Stats, Alerts, Capacity and control consumers read from the inline `scope` object (from the Ledger). The hook returns exactly that set; any member consumed by only one feature stays with that feature.
- [ ] **Step 2: Test, then move.** `test_use_eng_scope.js` server-renders the hook with synthetic inputs and asserts the returned member set. Move the inline construction and call `useEngScope` at the same position.
- [ ] **Step 3: Gate, register, commit, Gate A.**

## Task 8: Lazy-load Stats, Scenario and Settings

Commit message: `Lazy-load the Statistics, Scenario and Settings views`

**Files:** Create `frontend/src/components/LazyViewBoundary.jsx`, `tests/test_lazy_view_boundary.js`. Modify `package.json`, `jira-dashboard.html`, `dashboard.jsx`, `tests/ui/codebase_structure_smoke.spec.js`, `backend/routes/performance_routes.py` only if its test shows the revision fingerprint ignoring chunk changes.

**Interfaces**

- `LazyViewBoundary({ load, fallback, children })`: renders `fallback` (the existing `.stats-note` copy) while the chunk loads; on failure renders a message and a native `<button>` Retry that re-invokes `load`; after a second consecutive failure the message becomes "Reload the page to get the latest version" with no automatic reload.

- [ ] **Step 1: Failing boundary test.** `test_lazy_view_boundary.js` renders the boundary with a `load` that rejects once then resolves, asserts the Retry button, then rejects twice and asserts the reload message and no `location.reload` call.
- [ ] **Step 2: Build config.** Change `build:js` to `--format=esm --splitting --outdir=frontend/dist` with an entry that keeps `dashboard.js`, change `jira-dashboard.html:21` to `<script type="module" src="frontend/dist/dashboard.js">`, and apply the same change to `watch:js`. Confirm in the Browser pane that `/frontend/dist/<chunk>.js` is served with a normal `200`.
- [ ] **Step 3: Wrap the three views** with `React.lazy(() => import(...))` inside `LazyViewBoundary`; the hooks stay in the main bundle.
- [ ] **Step 4: Failure test.** In the smoke spec, abort the first chunk request and assert the Retry button appears, the rest of the app stays interactive, and a successful retry renders the view. Add a second test that aborts twice and asserts the reload message.
- [ ] **Step 5: Measure.** Record `dashboard.js` before and after, the first-open chunk size, and confirm zero new `/api` requests on first Stats open. The `performance_routes.py` revision must change when only a chunk changes; if it does not, include the chunk files in its fingerprint with a test.
- [ ] **Step 6: Re-run the CI dist check** (`make verify-dist-clean`) and commit the new `frontend/dist` files. Gate, commit, Gate A.

## Task 9: Close-out

Commit message: `Close the App decomposition plan and update the ontology`

- [ ] **Step 1: Ratchet budgets.** Set the `dashboard.jsx` ceiling in `tests/test_codebase_structure_budgets.py` (`LEGACY_ENTRYPOINT_LINE_BUDGETS`), `owner_budgets.json` and `run.sh` `MAX_WARNINGS` to the measured values; remove the growth-justification comments that no longer apply.
- [ ] **Step 2: Documentation.** Update `docs/ontology.md` (Statistics, Dashboard feature ownership, extraction verification, new owners with verified dates, coverage line), `docs/features/statistics.md`, `docs/plans/README.md`, and the `AGENTS.md` section 10 wording that says the dashboard can be "opened via `jira-dashboard.html`" (the app is always served by Flask on localhost). Check every ontology path and symbol resolves.
- [ ] **Step 3: Remaining-App inventory.** Record what `App()` still owns (bootstrap, Sprint catalog, task loading, auth recovery, alert toggles) and the follow-up plan list.
- [ ] **Step 3b: Gate 3 comparison.** Re-run the `App render counts for common interactions` test three times at head and record min and max deltas next to the Task 0 baseline. Report them as numbers only.
- [ ] **Step 4: Full verification, as the section 10 gate requires.** `node --test tests/test_*.js`; `$JEP_TEST_PYTHON -m unittest discover -s tests`; `npm run build` plus clean dist; `bash scripts/extraction_lint/run.sh`; full `npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes); the three gate tests with `JEP_RUNTIME_PROBE=1`; launch `.venv/bin/python jira_server.py` (or `JEP_TEST_PYTHON`) and verify `/api/test` with no dependency warning before the banner.
- [ ] **Step 5: Operator stop.** Present the Baseline Log, the three gate results, the render-count before and after, request-count equality, screenshots, `git log --oneline origin/main..HEAD` and `git diff --name-status origin/main...HEAD`. Wait for explicit confirmation.
- [ ] **Step 6: Publication transaction** per `AGENTS.md` section 10: fetch base, record SHAs, compare commit list and paths with this plan, rerun verification at the exact head, send the PR body through `gh pr create --body-file -` on stdin, read back the rendered body, verify the remote head and changed files, and report real CI state. PR notes include screenshots and no secrets or real issue keys.

## Acceptance Checklist

- [ ] Gate 1: `Stats chart hover does not re-render App` fails on `da17de89` and passes at head.
- [ ] Gate 2: cold-load request pair set is identical for Catch Up, Planning and Stats; reopening Stats adds zero requests.
- [ ] Gate 3: before and after `App()` render counts reported as numbers for a filter change and a Stats view switch; no speed claim beyond them.
- [ ] Lazy-load: Retry works for a transient failure and the reload message appears after two failures; first Stats open adds no `/api` request.
- [ ] Analytics guards and quirk pins pass with only source paths changed.
- [ ] Owner budgets, interface counts and aggregates equal measured values; `dashboard.jsx` ceiling ratcheted.
- [ ] Ontology, plan README, statistics feature doc and `AGENTS.md` wording updated and verified.

## Risks and Open Items

- **Effect order.** 90 effects; Stats effects interleave with non-Stats effects. Mitigation: Task 2 Step 1 ledger, layered hooks, conservation check.
- **Alerts and Stats coupling to the bootstrap** is intentional and recorded; the bootstrap plan owns the final move.
- **`burnoutTaskFilter` filters the visible task list**, so Stats and the task pipeline stay coupled through one setter.
- **Retry cannot fix a stale tab after a deploy** (the old chunk no longer exists); the second-failure reload message covers it.
- **Line ranges drift** with every commit; re-measure at each task start.

## Baseline Log

_Filled during Task 0 and updated at each commit with the measured numbers and command output summaries._

## Ledger

_Filled during Tasks 1, 2, 4, 5 and 7: measured inventories, effect classifications, interface tables and conservation residuals._
