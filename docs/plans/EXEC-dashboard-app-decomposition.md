# Dashboard App Decomposition Implementation Plan

> **Status:** Planned (2026-10-07). Not started. Follows the closed [#220 extraction plan](DONE-dashboard-scenario-settings-state-extraction.md). Revalidated on 2026-10-07 against `origin/main` at `cd2ae405`; the line anchors below are from that revision.
> **Branch:** `improvement/dashboard-app-decomposition`, which must contain current `origin/main` (Task 0 Step 1 creates or updates it). One PR at the end; separate commits inside it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `App()` in `frontend/src/dashboard.jsx` by moving Statistics, Alerts derivation and Capacity ownership into feature modules, turning the closure renderers into components, naming the shared scope, and lazy-loading the Stats, Scenario and Settings views, without changing behavior, data requests or analytics.

**Architecture:** Follow the proven #220 pattern. State that the group bootstrap reads and writes stays in a state-container hook called from `App()` with the same flat interface, beside a pure per-group seam module. Memos and effects move into hooks called at their original positions so effect order is unchanged. Views become stateless components that own only transient UI. The shared scope is first an inline memoized object in `App()` and is hoisted into `useEngScope()` only after Stats, Alerts and Capacity all consume it.

**Tech Stack:** React 19, esbuild 0.27, Node 20 `node --test`, Playwright (Chromium), Python `unittest`, `scripts/extraction_lint`.

## Global Constraints

- Behavior-preserving. No new user-visible feature, no new request, no changed request body, no changed analytics event. Analytics impact review: none; allowlist reason is "pure refactor, every `trigger`, `event_name`, `feature_name` and param stays byte-identical" and is proven by `tests/test_analytics_source_guards.js` plus `tests/test_extraction_quirk_pins.js`.
- One PR, published once at the end through the section 10 publication transaction in `AGENTS.md`. Never merge feature work into local `main`.
- The only operator stop is before the PR, after the full Chromium `tests/ui` run. Between commits the automated per-commit gate below is the only gate. A task whose gate is not green after two attempts stops the run: report the evidence, leave its uncommitted changes in place for the operator, and do not start the next task. Task 3 Step 3 (Gate 1) must pass before Task 4 starts.
- Out of scope (own plan later): group state and config bootstrap (`buildDefaultGroupState`, `buildGroupStateSnapshot`, `applyGroupState`, `groupStateSnapshot`, `resetSprintScopedState`, `loadConfig`), the Sprint catalog and its cache-first startup, the task-loading pipeline, and Scenario history/save/rollback (issue #230). Also out of scope: extracting Basic auth (operator direction 2026-10-07: the app will rely only on OAuth; its own plan later). This plan acts on one consequence only, the end of direct `file://` open (Task 8).
- Persisted per-group state stays in `App()` through a container hook. Moving it into a component that unmounts is forbidden: `applyGroupState` writes it on every group switch.
- Caches and selections survive closing Stats. Only chart hover state, which `StatsPanel` owns, resets with the view. The excluded-capacity epic dropdown state, its ref and its outside-click effect stay with the Stats state and data hooks, so their behavior does not change.
- No new dependency. Opening `jira-dashboard.html` from `file://` is not supported (operator decision, 2026-10-07: Basic auth will be extracted and the app will rely only on OAuth). The app is always served from localhost by Flask, which is why Task 8 may emit ES modules and chunk files.
- Do not hand-edit `frontend/dist/`; rebuild with `npm run build` and commit the output because `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff.
- No Co-Authored-By or agent branding in commits, branch names or the PR. Commit as the noreply identity with one-shot `-c user.email=` flags; never commit the personal address.
- Use `.venv/bin/python`; in this worktree there is no `.venv`, so export `JEP_TEST_PYTHON` to an existing interpreter before any Python or Flask-backed spec.
- Run `npm ci` in a fresh worktree before `npm run build` (a build that resolves `node_modules` from an ancestor embeds wrong paths in `dashboard.js.map`).
- Reuse existing classes and components. `SegmentedControl` keeps `eng-mode-control`; dropdowns keep `team-dropdown-*` / `sprint-dropdown-*`; no new global-button overrides.
- Before the task that needs them, read the postmortems in `docs/postmortem/`: MRT009 (sticky layering; Tasks 3 and 6), MRT010 (no fetch unification; Task 2), MRT016 (File Map drift; every commit), MRT017 and MRT018 (chart hover readouts, Stats panel overflow; Task 3), MRT020 and MRT021 (shared controls) and MRT028 (epic-header layout instructions) for Task 6, MRT007 (bundled frontend regression; Task 8), MRT022 (branch names; Task 0), MRT024 (head-stamped schema drift; Task 9 server check) and MRT025 (publication transaction; Task 9).
- The File Map is a contract: before each commit compare `git diff --name-status` with it and record any divergence in this plan.

## Measured Starting State (2026-10-07, `cd2ae405`)

`frontend/src/dashboard.jsx` is 10,855 lines, one `App()` from line 309 to 10,848, render `return (` at 8,859 and, from line 8,860, wrapped in `<StatusColourProvider>` (added by #246; every view this plan moves or lazy-loads must stay mounted inside it). Whole-file hook call counts: 168 `useState`, 181 `useMemo`, 90 `useEffect`, 90 `useRef`, 34 `useCallback`, no `React.memo`. These anchors were measured by symbol at `cd2ae405` and **must be re-measured at the start of each task** against the then-current file, because earlier commits shift them.

| Responsibility | Current location in `App()` | Notes |
| --- | --- | --- |
| Stats state cells and refs | 881-966 (resolvers 881-884), `hideExcludedStats` at 1001 | Lines 941-945 inside this range are not Stats (`isCatchUpMode`, `isEpicRefreshMode`, `boardScopeRequested`, a Board strict-scope effect) and stay in `App()`. Line 940 `isStatsSourceOnlyStatsView` is derived from `showStats` and `statsView`, is read outside Stats (3611, 3696, 3726, 3728, 5786, 8648), and stays in `App()` directly after the `useStatsState` destructure. Line 938 also declares `issuePeopleStatsRevision`; classify it in Task 1 Step 1. The excluded-capacity, Project Track and effort-split cells in this range are not in the group snapshot but move into `useStatsState` with the rest. Per-group keys: `statsView`, `statsGraphMode`, `burnout{Data,Loading,Error,AssigneeFilter}`, `burndownMetric`, `cohort{Data,Loading,Error,StartQuarter,EndQuarter,GroupBy,ProjectFilter,AssigneeFilter,ExcludeAdHoc,ExcludeCapacity,StatusToggles,SelectedRow}`, `hideExcludedStats` |
| Stats derivation and fetch effects | 4300-5270 and 5489-5780, then `canRenderStatsPanel` (5781) and `isLeadTimesFocusMode` (5782) | 17 anonymous `useEffect` calls inside these ranges (first at 4425, last at 5765, including the excluded-capacity dropdown outside-click effect at 5259-5270 and the burnout hover-reset effect at 4546-4549, which stays in `App()` until Task 3); the neighbours at 5314 (reads `showStats`) and 5333 (planning auth resume, not Stats) must be classified; order must be preserved. `canRenderStatsPanel` is read only by the Stats render block; `isLeadTimesFocusMode` is also read at 10228 outside it |
| Stats render | 9436-10186 | `<StatsDeliverySummary>`, `<StatsTeamsView>`, `<StatsPriorityView>`, `<BurnoutChart>`, cohort, excluded capacity, Project Track children |
| Stats hover state | 887, 959, 960 | `priorityHoverIndex`, `burnoutHoverPoint`, `burnoutHoverTeamKey`; no group-bootstrap readers; the only Stats cells free to move into the panel. `burnoutHoverPoint` and `burnoutHoverTeamKey` are read by the render block (9509, 9511) and reset by the effect at 4546-4549 (deps `[burnoutData, burnoutAssigneeFilter, statsView]`), which moves into `StatsPanel` with them in Task 3; `priorityHoverIndex` is also in the `?perf` snapshot object and dependency array (1938, 1975), which Task 3 edits |
| Stats readers outside Stats ranges | group bootstrap 2729-2756 (defaults), 2811-2831 (snapshot), 2888-2915 (apply), 2973-2993 (snapshot dependencies), 3356-3431 (clusters at 3356-3367, 3378, 3413-3424, 3431); cache clears 1680-1682, 6304, 8644-8649; `isStatsSourceOnlyStatsView` at 3611, 3696, 3726, 3728, 5786, 8648; `burnoutTaskFilter` at 5462-5471, 5815-5816 and 7471 (filters the visible task list and feeds the Alerts `focusedFilterActive`); `projectTrackSprintId` at 1569-1574 (reads `showStats` and `statsView`) | These are why Stats state cannot leave `App()` |
| Alerts derivation | 7038 to about 7485 (the Task 4 inventory fixes the end); `triggerAlertCelebration` is defined at 7486 and called at 6045, `alertCelebrationPieces` is state at 1016, cleared by the group bootstrap at 2928, set at 7521-7536 and rendered at 10253 | Toggles `show*Alert`, `showAlertsPanel`, `dismissedAlertKeys` are read and written by the group bootstrap (`showAlertsPanel` at 2767, 2842, 2926, 3389, 3442; `dismissedAlertKeys` at 2768, 2843, 2927, 3004; the `show*Alert` toggles beside them) and stay in `App()` |
| Capacity | state 977-993, derivation and fetch 6453-6774 | `fetchCapacity` at 6592; `handleCapacitySaved` at 6573 (passed to Settings as `onCapacitySaved` at 8847) |
| Closure renderers | 7714-8589 | `renderSearchControl` (7714), `renderViewSwitch` (7742), `renderEngModeControl` (7768), `renderEpmControls` (7783), `renderSprintControl` (7836), `renderGroupControl` (8003), `renderTeamControl` (8100), `renderPlanningReviewFieldEditor` (8189), `renderEpicBlock` (8265, about 325 lines). The controls are called on two surfaces, `'main'` (8883-8967) and `'compact'` (8991-9004); `EngView.jsx` already receives `renderEpicBlock` as a prop (`EngView.jsx:25,143,147,152`) |
| Out of scope bootstrap | 2665-3734 | Listed in Global Constraints |

Existing infrastructure this plan reuses:

- Render counter: `perfCountersRef.current.renders` increments on every `App()` render when the URL has `?perf` (`dashboard.jsx:316-335`). `tests/ui/scenario_draft_history.spec.js:28-60` shows the in-memory adapter that exposes it as `window.__JEP_EXTRACTION_PERF__` by patching a copy of the bundle; the source is never written.
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
| `frontend/src/stats/StatsPanel.jsx` | Stats view; owns only chart hover state (`priorityHoverIndex`, `burnoutHoverPoint`, `burnoutHoverTeamKey`) and the effect that resets the burnout hover cells, and receives everything else as props |
| `frontend/src/eng/useEngAlerts.js` | Pure alert derivation: epic lists, team lists, counts |
| `frontend/src/eng/useEngCapacity.js` | Capacity read lifecycle and totals |
| `frontend/src/eng/EngControls.jsx` | `SprintControl`, `GroupControl`, `TeamControl`, `SearchControl`, `ViewSwitch` components (`renderEngModeControl`, `renderEpmControls` and `renderPlanningReviewFieldEditor` stay in `App()`; see Task 6) |
| `frontend/src/eng/EpicBlock.jsx` | `renderEpicBlock` as a component |
| `frontend/src/eng/useEngScope.js` | Hoisted scope object (Task 7 only) |
| `frontend/src/components/LazyViewBoundary.jsx` | Suspense plus retry boundary for lazy views (Task 8) |
| `tests/ui/runtime_probe_helpers.js` | `buildRuntimeProbeBundle`, `readAppRenderCount` for the `?perf` counter |
| `tests/test_stats_group_state.js`, `tests/test_use_stats_state.js`, `tests/test_use_stats_data.js`, `tests/test_stats_panel.js`, `tests/test_use_eng_alerts.js`, `tests/test_use_eng_capacity.js`, `tests/test_eng_controls.js`, `tests/test_use_eng_scope.js`, `tests/test_lazy_view_boundary.js` | Node contracts per module |

**Modify**

| File | Change |
| --- | --- |
| `frontend/src/dashboard.jsx` | Remove moved ranges, add imports and call sites |
| `tests/ui/codebase_structure_smoke.spec.js` | Add the three gate tests and the `runtimeProbe` option to `installApiMocks` (Task 0), DOM-parity capture calls (Task 3) and the chunk-failure tests (Task 8) |
| `tests/ui/epm_home_token_fixture.js` | Serve `**/frontend/dist/chunks/*` from disk beside the committed entry in `installDashboardShell` (Task 8) |
| `backend/routes/performance_routes.py` | Only if the Task 8 fingerprint rule shows the entry hash ignoring chunk changes |
| `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/tooling_controls.mjs` | Add `stats` and `eng` as owner features for the new files |
| `tests/test_stats_module_extraction_source_guards.js`, `tests/test_stats_controls_source_guards.js`, `tests/test_excluded_capacity_stats_source_guards.js`, `tests/test_cohort_grid_source_guards.js`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_dashboard_missing_labels_source_guards.js`, `tests/test_dashboard_epic_alert_team_links.js`, `tests/test_extraction_quirk_pins.js`, `tests/test_auth_isolation_source_guard.js` | Re-point source reads from `dashboard.jsx` to the new owner files via `readOwnerSource`; never weaken an assertion. A scan at `cd2ae405` also flags `tests/test_epic_refresh_source_guards.js`, `tests/test_epm_shell_source_guards.js`, `tests/test_epm_view_source_guards.js`, `tests/test_first_run_group_configuration.js`, `tests/test_frontend_api_source_guards.js`, `tests/test_planning_action_source_guards.js` and `tests/test_use_shared_config_save.js` as possible readers of moved code; re-point one only when its guard fails after a move |
| `package.json` | ES module build with code splitting into `frontend/dist/chunks/`, plus `prebuild:js` and `prewatch:js` cleanup of that directory (Task 8 only) |
| `jira-dashboard.html` | Entry script tag for the split build (Task 8 only) |
| `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/run.sh` | Ratchet the `dashboard.jsx` ceiling and `MAX_WARNINGS` in every commit that lowers them; exact final values in Task 9 |
| `docs/ontology.md` (every commit that moves an owner), `docs/plans/README.md`, `docs/features/statistics.md`, `README.md` (lines 88 and 200), `AGENTS.md` (section 10 runtime line), this plan | Documentation; the `file://` wording changes in Task 8, the rest closes out in Task 9 |

**Forbidden regressions:** any added or removed API request on cold load or on reopening Stats; changed analytics counts; Stats selections or caches lost on group switch, sprint change or closing Stats; changed effect order; a chart hover re-rendering `App()`; any Stats, Alerts or Capacity visual change; a lazy view mounted outside `<StatusColourProvider>`; stale chunk files left in `frontend/dist`.

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

Plus, for every commit that moves code: `node scripts/extraction_lint/check_move_conservation.mjs --base <previous commit> --created-hook <each new owner file> [--deleted-hook <file>] <existing affected hook files>` (usage is in the first lines of the script), which fails on effect-order change and prints residual statements for human review; a zero exit does not approve the residuals. Record each residual group in the Ledger with a one-line disposition (moved verbatim, signature-only, or explained); an unexplained residual stops the task. Then Gate A from the global instructions: `git show --stat HEAD` and `git status`, read both, confirm the intended files and content (a rename shows `| 0`).

The Playwright line must run at least the number of tests recorded in the Baseline Log (9 at `cd2ae405`; confirm with the same command plus `--list`); fewer, or zero, is a failed gate. Run Node commands under the pinned Node 20 (`.nvmrc`; `fnm exec --using 20 <command>` where the system Node is newer).

In the same commit, ratchet the `dashboard.jsx` line ceiling (`tests/test_codebase_structure_budgets.py` `LEGACY_ENTRYPOINT_LINE_BUDGETS`, and `owner_budgets.json` `dashboard.lineCount` and `lineCeiling`) and `run.sh` `MAX_WARNINGS` to the measured values (`validate_owner_budgets` fails unless every line count, interface count and aggregate equals the measured value), update the `docs/ontology.md` entries of every concept that moved (root `AGENTS.md` section 1), and compare `git diff --name-status` with the File Map.

## Task 0: Safety net, baselines and tooling

Commit message: `Add render-isolation and request baselines for the App decomposition`

**Files:** Create `tests/ui/runtime_probe_helpers.js`. Modify `docs/ontology.md` (re-stamp the `App()` inventory baseline), `tests/ui/codebase_structure_smoke.spec.js`, `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/tooling_controls.mjs`.

**Produces:** a red gate-1 test on current code, a green request-count test, and owner tooling that accepts `stats` and `eng` features.

- [ ] **Step 1: Startup checks, branch, base and numbers.** Read `docs/plans/AGENTS.md`, the postmortems named in Global Constraints, and run the startup gate sweep (`rg --files docs/plans | rg '/GATE-'`). At `cd2ae405` the only gate is `GATE-05-home-write-capability.md`, next review 2026-10-12, which states that the extraction does not depend on it; record its `Checked on` and `Next review` values and that it is unaffected, and do not modify it. Run `git fetch origin` and `git branch --show-current`. Execute on `improvement/dashboard-app-decomposition`, never on an agent-generated name such as `cld/*` (MRT022). That branch already exists (at `cd2ae405` it sits at the plan commit `dc95f051` in its own worktree), so do not recreate it or rename around it: work in its worktree, merge `origin/main` into it, and bring this revised plan over from the review branch (cherry-pick or merge) before the first edit. Confirm `git merge-base --is-ancestor origin/main HEAD`. Record `git rev-parse --short origin/main` as the **Task 0 base** and `wc -l frontend/src/dashboard.jsx` in the Baseline Log. Run the full per-commit gate once and write the pass counts, including the Playwright `--list` count, into the Baseline Log, and re-stamp the `App()` inventory entry in `docs/ontology.md` (line 133 at `cd2ae405` still says `da17de89`, 10,851 lines, `App()` from line 308) with these measurements. Any failure on unmodified code is reported to the operator before continuing.

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
// esbuild's synchronous API rejects plugins, so the adapter is applied to the entry text and fed through
// stdin, the same way tests/ui/scenario_draft_history.spec.js does it.
function buildRuntimeProbeBundle() {
    const entry = path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx');
    const contents = fs.readFileSync(entry, 'utf8');
    if (contents.split(anchor).length - 1 !== 1) {
        throw new Error('runtime adapter anchor must occur exactly once');
    }
    const result = esbuild.buildSync({
        stdin: {
            contents: contents.replace(anchor, `${anchor}\n${adapter}`),
            resolveDir: path.dirname(entry),
            sourcefile: entry,
            loader: 'jsx',
        },
        bundle: true,
        write: false,
        nodePaths: [path.join(repoRoot, 'node_modules')],
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
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

- [ ] **Step 4: Write the gate-1 test (must fail now).** Append beside the test at line 1763. It uses the same prefs and mocks as that test, sets `?perf=1` with an init script and loads `/` (the shared shell route in `epm_home_token_fixture.js` matches only a bare `/`, so navigating to `/?perf=1` would bypass it and the page would never load), opens Priority then Burndown, and asserts that hovering does not change the `App()` render count.

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
    await page.addInitScript(() => window.history.replaceState(null, '', '/?perf=1'));
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, isTaskListRequest, 2);
    const tabs = page.locator('.stats-panel.open .stats-view-toggle');

    const radarSeries = page.locator('.stats-view.open .priority-radar polygon[fill-opacity]').last();
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

The series polygons are the only `polygon` elements with a `fill-opacity` attribute (`frontend/src/stats/StatsPriorityView.jsx:76-92`); the first four `polygon` elements in `.priority-radar` are grid rings without a hover handler, so a bare `polygon` selector would hover the wrong element. Series are drawn on top of each other, so use `.last()` (the topmost); `.first()` is covered by the next series and Playwright refuses to hover it. The legend hover below uses the same `setPriorityHoverIndex` handler. Commit this test knowingly red: it is opt-in (`JEP_RUNTIME_PROBE=1`), the per-commit gate skips it, and it turns green in Task 3.

- [ ] **Step 5: Run it and confirm it fails.**

Run: `JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Stats chart hover" --browser=chromium`
Expected: FAIL on the equality assertion because the hover increments the count today. Keep the failing output in the Baseline Log.

- [ ] **Step 6: Write the request-count and reopen test (must pass now).** Same fixture, `useCommittedDist: true`. Record the sorted set of `pathname + method` pairs on cold load into a constant, then: open Stats on Burndown, switch to Catch Up and back, and assert `callsFor(calls, '/api/stats/burnout', 'POST').length` is still 1 and no `/api/stats/*` call count increased. Add a second assertion that the cold-load pair set for Catch Up, Planning and Stats equals the recorded constant, and a third that Burndown is still the selected Stats view after the Catch Up round trip (selections survive closing Stats). Run it and record it green.

- [ ] **Step 6b: Add the render-count measurement (gate 3).** Add an opt-in test `App render counts for common interactions` (skipped unless `JEP_RUNTIME_PROBE=1`) that, on the same fixture, reads `readAppRenderCount` before and after (a) toggling one Team in the Teams dropdown and (b) switching the Stats view from Teams to Priority, and attaches the two deltas with `testInfo.annotations.push({ type: 'app-renders', description: JSON.stringify({ filterChange, statsViewSwitch }) })`. It asserts nothing about the numbers; Task 9 compares them. Run it three times and record the min and max for each delta in the Baseline Log, because render counts vary with timers.

- [ ] **Step 7: Extend the owner tooling.** In `tests/test_codebase_structure_budgets.py` allow `"stats"` and `"eng"` in the feature check (line 257, currently `set(module["features"]) - {"scenario", "settings"}`), seed both in `totals` (line 231) and require matching `aggregates`. In `check_hook_interfaces.mjs` replace the feature inference at lines 376-383 with a directory map (`scenario` and `settings` unchanged; the default `ownerRoots` is `['scenario', 'settings', 'epm']` and `epm` files are labelled `settings` today and stay so; `stats` and `eng` new) and extend the totals at line 428. Register new files only by explicit module entries; do **not** add `stats` or `eng` to `ownerRoots`, so existing files in those directories stay unregistered. Add a seeded failure for each new feature in `tooling_controls.mjs`.

- [ ] **Step 8: Verify the tooling.** Run `bash scripts/extraction_lint/run.sh` and `bash scripts/extraction_lint/negative_controls.sh` with `JEP_TEST_PYTHON` exported (`run.sh` falls back to `.venv/bin/python`). Expected at `cd2ae405`: `run.sh` exits 0 with `106 problems (0 errors, 106 warnings)`, `owner budgets: 69 modules; problems: 0` and `checked 36 destructure sites in 69 modules; enforced problems: 0; informational: 34; baselined: 0`; `negative_controls.sh` exits 0 and ends with `tooling controls passed: 66` and `negative controls failed: 0`. After this step the module count stays 69 and the passed-controls count rises by exactly the new seeded failures; record every summary line in the Baseline Log.

- [ ] **Step 9: Gate and commit.** Run the per-commit gate (the gate-1 test is excluded from it because it is opt-in and red). Commit with the message above; no trailer. Run Gate A.

## Task 1: Stats state container and per-group seam

Commit message: `Extract the Statistics state container and per-group seam`

**Files:** Create `frontend/src/stats/statsGroupState.js`, `frontend/src/stats/useStatsState.js`, `tests/test_stats_group_state.js`, `tests/test_use_stats_state.js`. Modify `frontend/src/dashboard.jsx`, `scripts/extraction_lint/owner_budgets.json`, the Stats source-guard tests listed in the File Map.

**Interfaces**

- Produces `statsGroupState.js`: `STATS_GROUP_STATE_KEYS` (ordered array equal to the key order of `buildGroupStateSnapshot` for the Stats keys), `buildDefaultStatsGroupState(savedPrefs, resolvers)`, `snapshotStatsGroupState(values)`, `applyStatsGroupState(nextState, setters, resolvers)`, `resetStatsTransientRefs(refs)`.
- Produces `useStatsState(inputs)`: returns an object with exactly today's names and setters for the cells at `dashboard.jsx:885-966` and `1001`, plus the cache refs, including `excludedCapacityEpicDropdownOpen` and `excludedCapacityEpicDropdownRef` (their outside-click effect moves in Task 2) and `burnoutTaskFilter`. It excludes the three chart-hover cells (`priorityHoverIndex`, `burnoutHoverPoint`, `burnoutHoverTeamKey`), which stay in `App()` until Task 3 moves them into `StatsPanel`, `isStatsSourceOnlyStatsView` (940) and the non-Stats lines 941-945. No effects, no getters.
- Consumed by `App()` at the earliest former Stats cell (line 881). `buildDefaultGroupState`, `buildGroupStateSnapshot`, `applyGroupState` and `clearEngGroupScopeData` call the seam instead of inlining the Stats keys; their other keys and their order are untouched.

- [ ] **Step 1: Re-measure and write the inventory.** Run `node scripts/extraction_lint/check_hook_interfaces.mjs --write-inventory tmp/stats-inventory.json --manifest scripts/extraction_lint/owner_budgets.json frontend/src/dashboard.jsx` after Task 0, and record in this plan's Ledger section: every Stats cell with its line, whether the group seam reads it, and every reader outside Stats ranges. Use plain `node` scripts for any line counting; macOS `awk` does not support `\<`.
- [ ] **Step 2: Write the pure seam test first.** `tests/test_stats_group_state.js` asserts: `STATS_GROUP_STATE_KEYS` equals the order of the Stats keys extracted from `buildGroupStateSnapshot` in the dashboard source; the default builder reproduces the values at `dashboard.jsx:2729-2756` for a synthetic saved-prefs object (empty, partial, invalid `statsView`); `applyStatsGroupState` calls setters in the same order as `applyGroupState` at 2888-2915 (record the call order with stub setters); `resetStatsTransientRefs` empties `burnoutCacheRef`, `cohortCacheRef` and `excludedCapacityCacheRef` as `clearEngGroupScopeData` does at 1680-1682 (the same three assignments also sit at 6304 and 8644-8646; `excludedCapacityForceRefreshRef` is set only at 1590 and 8649 and is not part of the seam). Run it and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement the seam by moving, not rewriting.** Cut the Stats lines out of the four bootstrap functions into `statsGroupState.js` verbatim and call it from the same positions. Run the new test and expect pass.
- [ ] **Step 4: Write `test_use_stats_state.js`.** Server-render the hook inside a probe component and assert the returned name set equals the measured Step 1 list and contains no `use*` effects (source scan: no `useEffect` in `useStatsState.js`). Confirm it fails, then implement by moving the `useState`/`useRef` lines 885-966 (minus the excluded cells above) and 1001 verbatim, keeping the same initializers that read `savedPrefsRef.current`.
- [ ] **Step 5: Wire and ratchet.** Replace the moved lines with one `useStatsState(...)` destructure. Register both new files in `owner_budgets.json` with the measured line counts as ceilings and their interface counts; set the transfer checkpoint using the current-base measurement (the ceiling is net scaffolding only, no transfer credit).
- [ ] **Step 6: Re-point source guards.** Update the Stats source-guard tests to read the moved lines through `readOwnerSource` with a positive anchor. Run each one; every assertion must still exist.
- [ ] **Step 7: Gate and commit.** Per-commit gate plus the conservation check with `--created-hook frontend/src/stats/useStatsState.js --created-hook frontend/src/stats/statsGroupState.js`. Commit, run Gate A.

## Task 2: Stats derivation and fetch effects

Commit message: `Move Statistics derivation and fetch effects into useStatsData`

**Files:** Create `frontend/src/stats/useStatsData.js`, `tests/test_use_stats_data.js`. Modify `dashboard.jsx`, `owner_budgets.json`, Stats source-guard tests.

**Interfaces**

- Consumes the inline `scope` object defined in this task (memoized in `App()` directly above the first Stats call): `{ activeGroup, selectedSprintInfo, selectedTeams, scopedTasks, statsTaskList inputs, techProjectKeys, adHocEpicSet, excludedEpicSet, config }`. The exact member list is the measured input set from the inventory; no renames.
- Produces layered hooks in `useStatsData.js`, each taking one object and returning an object literal: `useStatsDerivedA` (derivations in 4300-5270), `useStatsFetchEffects` (the effects at their original positions, including the excluded-capacity dropdown outside-click effect at 5259-5270, which reads state and a ref owned by `useStatsState`), `useStatsDerivedB` (5489-5782, including `canRenderStatsPanel` and `isLeadTimesFocusMode`; `App()` still reads the latter at 10228, so it is part of the returned object). If an effect depends on a non-Stats effect between two layers, split into more layers so every Stats effect keeps its position relative to every non-Stats effect.

- [ ] **Step 1: Classify every effect.** In the Ledger, list the 17 effects in the Stats ranges plus the neighbours at 5314 and 5333 with their dependency arrays and mark any non-Stats effect that sits between them. This list is the contract for layer boundaries. The hover-reset effect at 4546-4549 stays in `App()` at its position through this task (it writes the hover cells that Task 3 moves), so split the layers around it: `useStatsData` holds 16 effects and the Step 2 source scan expects 16.
- [ ] **Step 2: Write `test_use_stats_data.js`.** Server-render each layer with synthetic scope and state and assert the output keys equal the measured list; add a source scan that the layered hooks contain the same number of `useEffect` calls as the ledger and that no layer calls another layer.
- [ ] **Step 3: Move by ranges.** Cut the ranges verbatim into the hooks, keep the `perfEnabled` and `perfCountersRef.current.statsBuild` counters, and add one call per layer at the first former line of its range. Do not reorder or merge effects.
- [ ] **Step 4: Verify effect order.** Run `check_move_conservation.mjs`; it must report no effect-order change. Read the residual output and record it in the Ledger.
- [ ] **Step 5: Cold-load requests unchanged.** Run the Task 0 request-count test; expect green with the identical pair set.
- [ ] **Step 6: Gate, register owners, commit, Gate A.**

## Task 3: StatsPanel view and transient state

Commit message: `Render Statistics through a stateless StatsPanel and fix chart hover re-renders`

**Files:** Create `frontend/src/stats/StatsPanel.jsx`, `tests/test_stats_panel.js`. Modify `dashboard.jsx`, `owner_budgets.json`, the Stats source-guard tests, `tests/ui/codebase_structure_smoke.spec.js` (DOM-parity capture calls).

**Interfaces**

- `StatsPanel` takes `{ stats, scope, links, analytics, onSelectBurnoutTask }`: `stats` is the `useStatsState` plus `useStatsData` output the panel reads; `links` carries `buildStatLink`, `buildPriorityStatLink`, `buildStatLink`-family builders; `analytics` carries `trackStatsAction` and `trackStatsAnalyticsAction`. It renders the `.stats-panel` subtree unchanged and owns only `priorityHoverIndex`, `burnoutHoverPoint` and `burnoutHoverTeamKey` internally, plus the effect that resets the two burnout cells (moved from 4546-4549 with the same dependencies, which arrive through `stats`). The excluded-capacity epic dropdown state, ref and outside-click effect stay in `useStatsState` and `useStatsData` and arrive through `stats`, as does `canRenderStatsPanel`, because the panel gate and its `stats-note` fallback (9438-9441) are inside the moved block.
- `burnoutTaskFilter` stays outside the panel because `visibleTasks` filters on it (`dashboard.jsx:5462-5471`, also read at 5815-5816 and 7471); the panel receives its setter through `onSelectBurnoutTask`.

- [ ] **Step 0: Capture the DOM before moving anything.** `captureDomParity` (`tests/ui/dom_parity_helpers.js`) writes only when `JEP_DOM_PARITY_DIR` is set and refuses a nonempty directory. Add `await captureDomParity(page, '<view>', '.stats-panel.open')` calls to the existing smoke tests where each of the seven views (`teams`, `priority`, `burnout`, `cohort`, `excludedCapacity`, `monoCrossShare`, `projectTrack`) is open (find them with `rg -n "statsView|Statistics view" tests/ui/codebase_structure_smoke.spec.js`); without the variable they are no-ops. On the unchanged Task 2 tree run those tests with `JEP_DOM_PARITY_DIR=tmp/dom-parity-before` (`tmp/` is gitignored) and confirm the directory holds 7 files.
- [ ] **Step 1: Write `test_stats_panel.js`.** Server-render `StatsPanel` for each `statsView` value (`teams`, `priority`, `burnout`, `cohort`, `excludedCapacity`, `monoCrossShare`, `projectTrack`) and assert one `.stats-panel` root, the seven-option `SegmentedControl` with class `eng-mode-control stats-view-toggle`, and that no hover state is read from props. Confirm it fails.
- [ ] **Step 2: Move the render.** Cut the JSX at `dashboard.jsx:9436-10186` into the component verbatim, keep every `className`, delete the three chart-hover cells from `App()` and recreate them in the component with `useState`. Remove `priorityHoverIndex` from the `?perf` snapshot object and its dependency array (`dashboard.jsx:1938`, `1975`) in the same commit: it is a diagnostic-only key under `perfEnabled`, the state no longer lives in `App()`, and `rg -n priorityHoverIndex frontend/src/dashboard.jsx` must return nothing afterwards. Move the hover-reset effect (`dashboard.jsx:4546-4549`) into the component with the same dependency array. Replace the block with one mount under the unchanged `selectedView === 'eng' && showStats && engWorkspaceConfigured` condition.
- [ ] **Step 3: Gate 1 turns green.** Run `JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Stats chart hover" --browser=chromium`. Expected: PASS. Record before and after counts in the Baseline Log. If it fails, stop; Task 4 does not start.
- [ ] **Step 4: DOM parity and screenshots.** Run the Step 0 capture again into `tmp/dom-parity-after`; `diff -r tmp/dom-parity-before tmp/dom-parity-after` must be empty and both directories must hold exactly 7 files. Take screenshots of Teams, Burndown, Lead Times and Project Track at 1280px and 375px from the smoke spec's existing capture helper and compare; wait for animations to settle first.
- [ ] **Step 5: Analytics unchanged.** `node --test tests/test_analytics_source_guards.js tests/test_extraction_quirk_pins.js`; update only the source path the guards read, never a count.
- [ ] **Step 6: Gate, register, commit, Gate A.**

## Task 4: Alerts derivation hook

Commit message: `Extract Alerts derivation into useEngAlerts`

**Files:** Create `frontend/src/eng/useEngAlerts.js`, `tests/test_use_eng_alerts.js`. Modify `dashboard.jsx`, `owner_budgets.json`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_dashboard_missing_labels_source_guards.js`, `tests/test_dashboard_epic_alert_team_links.js`.

**Interfaces**

- `useEngAlerts({ scope, toggles, dismissedAlertSet, ... })` returns the alert lists, team lists, counts and `consolidatedMissingStories`. It owns no state. The `show*Alert` toggles, `showAlertsPanel` and `dismissedAlertKeys` stay in `App()` because the group bootstrap persists them.
- `triggerAlertCelebration` (defined at 7486, called at 6045 outside the Alerts block) and `alertCelebrationPieces` (state at 1016, cleared by the group bootstrap at 2928, set at 7521-7536, rendered at 10253) stay in `App()`: the bootstrap writes the state and a caller sits outside the derivation. List them in the Ledger.
- Existing modules stay as they are: `frontend/src/eng/useEngAlertFilters.js` and `engAlertFilters.js` keep filtering the derived collections and `epicRefreshAlerts.js` is untouched; `useEngAlerts` only produces the collections they consume.

- [ ] **Step 1: Inventory and test first.** Measure the exact input set with the interface tool. Write `test_use_eng_alerts.js` with synthetic Epics and Stories covering one fixture per alert category (missing Story Points, blocked, postponed, backlog, missing Team, missing labels, needs Stories, waiting, empty Epic, done Epic) plus a dismissed key, asserting the derived lists and team groupings equal expected literals. Run it, confirm failure.
- [ ] **Step 2: Move 7038 to about 7485 verbatim; the Step 1 inventory fixes the exact end.** Keep predicate order and the existing alert producer as a fallback exactly as today; no data-source change.
- [ ] **Step 3: Gates.** Run the alert specs `tests/ui/eng_alert_loading_order.spec.js`, `tests/ui/eng_alerts_panel_summary.spec.js`, `tests/ui/eng_missing_story_ghosts.spec.js` plus the per-commit gate; commit; Gate A.

## Task 5: Capacity hook

Commit message: `Extract Capacity read lifecycle and totals into useEngCapacity`

**Files:** Create `frontend/src/eng/useEngCapacity.js`, `tests/test_use_eng_capacity.js`. Modify `dashboard.jsx`, `owner_budgets.json`, capacity source-guard tests found with `rg -l "fetchCapacity|capacityState" tests`.

- [ ] **Step 1: Re-measure** state 977-993 and derivation 6453-6774. `handleCapacitySaved` (6573) is defined inside the range and moves with the hook, which returns it so `App()` keeps passing it to Settings (`onCapacitySaved`, 8847). Record every other reader outside the range (planning panel, capacity bars) in the Ledger.
- [ ] **Step 2: Write `test_use_eng_capacity.js`** for the totals math (`capacityTotalsSummary`, `getTeamNetCapacity`, `excludedCapacityByTeamId`) with synthetic teams, then move the code verbatim, keeping `fetchCapacity` abort and generation-ref semantics.
- [ ] **Step 3: Gates.** `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/adhoc_capacity_visual_proof.spec.js` plus the per-commit gate; commit; Gate A.

## Task 6: Closure renderers become components

Commit message: `Turn ENG control and Epic renderers into components`

**Files:** Create `frontend/src/eng/EngControls.jsx`, `frontend/src/eng/EpicBlock.jsx`, `tests/test_eng_controls.js`. Modify `dashboard.jsx`, `owner_budgets.json`. `EngView.jsx` is not modified: it already receives `renderEpicBlock` as a prop (`EngView.jsx:25,143,147,152`), and `App()` keeps passing a `renderEpicBlock(epicGroup)` function that now returns `<EpicBlock ... />`.

- [ ] **Step 1: Test the contract.** Server-render each component, `EpicBlock` included, with synthetic props (both the `'main'` and `'compact'` surface where the control takes one) and assert the root element, shared class hooks (`eng-mode-control`, `team-dropdown-*`, `sprint-dropdown-*`) and that no component reads module globals. Confirm failure.
- [ ] **Step 2: Move the renderers one at a time** (run the focused specs after each; the task is one commit), in this order: `renderSearchControl`, `renderViewSwitch`, `renderSprintControl`, `renderGroupControl`, `renderTeamControl`, then `renderEpicBlock`. `renderEngModeControl` (it only binds props and onboarding callbacks to the existing `EngModeControl.jsx`), `renderEpmControls` and `renderPlanningReviewFieldEditor` stay in `App()` and are listed in the Task 9 remaining-`App()` inventory. The controls render on two surfaces, `'main'` and `'compact'` (call sites 8883-9004), so each component keeps the closure's own arguments as props: `surface`, plus `extraClassName` for the search control (9004); `renderViewSwitch` takes none. Props are explicit names from the closure's actual free variables, listed by the interface tool. Do not add `React.memo` in this plan: none exists today, and memoization changes the render behavior that Gate 3 measures.
- [ ] **Step 3: Geometry and layering.** Per the project learnings, run the header-dropdown and sticky specs: `tests/ui/codebase_structure_smoke.spec.js -g "header dropdown|Catch Up, Planning|multiple groups"` and `tests/ui/eng_sticky_stack_helpers.js` consumers, plus a normal (non-forced) click on each dropdown option. Epic headers must hold on both direct task-list epics and initiative-grouped epics nested under `.initiative-body`: run every spec that mentions `.epic-header` (`rg -l "epic-header" tests/ui`, 13 files at `cd2ae405`, one of them a helper), and if none asserts the Catch Up epic-header text geometry (title, key, status, SP and assignee on one row) in both layouts, add that assertion before moving `renderEpicBlock`.
- [ ] **Step 4: Gate, register, commit, Gate A.**

## Task 7: Hoist the scope object into `useEngScope`

Commit message: `Hoist the shared ENG scope into useEngScope`

**Files:** Create `frontend/src/eng/useEngScope.js`, `tests/test_use_eng_scope.js`. Modify `dashboard.jsx`, `owner_budgets.json`.

- [ ] **Step 1: Freeze the interface from real use.** List the union of members the Stats, Alerts, Capacity and control consumers read from the inline `scope` object (from the Ledger). The hook returns exactly that set; any member consumed by only one feature stays with that feature.
- [ ] **Step 2: Test, then move.** `test_use_eng_scope.js` server-renders the hook with synthetic inputs and asserts the returned member set. Move the inline construction and call `useEngScope` at the same position.
- [ ] **Step 3: Gate, register, commit, Gate A.**

## Task 8: Lazy-load Stats, Scenario and Settings

Commit message: `Lazy-load the Statistics, Scenario and Settings views`

**Files:** Create `frontend/src/components/LazyViewBoundary.jsx`, `tests/test_lazy_view_boundary.js`. Modify `package.json`, `jira-dashboard.html`, `dashboard.jsx`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/epm_home_token_fixture.js`, `README.md` and `AGENTS.md` (the `file://` wording), and `backend/routes/performance_routes.py` only under the binary rule in Step 6.

**Operator decision (2026-10-07):** the app will rely only on OAuth (Basic auth is extracted in its own later plan), so opening `jira-dashboard.html` from `file://` is no longer supported. That is what allows `<script type="module">` and chunk files here. `frontend/src/api/backendUrl.js` keeps its non-http fallback in this PR; it becomes dead code and is listed in Task 9 Step 3.

**Interfaces**

- `LazyViewBoundary({ load, fallback, children })`: renders `fallback` (the existing `.stats-note` copy) while the chunk loads; on failure renders a message and a native `<button>` Retry that re-invokes `load`; after a second consecutive failure the message becomes "Reload the page to get the latest version" with no automatic reload.
- Each lazy view mounts at its current JSX position inside `<StatusColourProvider>` (opened at `dashboard.jsx:8860`); do not hoist `Suspense` or the boundary above it.

- [ ] **Step 1: Inventory every consumer of the bundle.** Run `rg -l "dist/dashboard.js" tests scripts backend .github Dockerfile README.md` and `rg -l "format: 'iife'" tests`, and record both lists. At `cd2ae405`: 26 `tests/ui` files rebuild the bundle in memory as a single `iife`, in which esbuild inlines dynamic imports; they stay unchanged because they test behavior, not chunking. `tests/ui/epm_home_token_fixture.js` is different: `installDashboardShell` (called from 37 files) reads the committed `frontend/dist/dashboard.js` and serves it for `**/frontend/dist/dashboard.js`, and the `useCommittedDist` smoke tests rely on that. With `--splitting` the entry statically imports shared chunks (`chunks/chunk-*.js`), so the fixture must also serve `**/frontend/dist/chunks/*` from disk; add that route in Step 3. `tests/endpoint_security_samples.py` only names the route sample, and `tests/test_dashboard_css_extraction.py` fetches `dashboard.js.map`, which the entry still emits. Packaging already ships the whole `frontend/dist` directory (`Dockerfile` copies it from the build stage; `.github/workflows/release-latest.yml` keeps `frontend/dist`), so `frontend/dist/chunks/` ships without a change. Any other consumer found is handled before Step 3.
- [ ] **Step 2: Failing boundary test.** `test_lazy_view_boundary.js` renders the boundary with a `load` that rejects once then resolves, asserts the Retry button, then rejects twice and asserts the reload message and no `location.reload` call.
- [ ] **Step 3: Build config.** Change `build:js` to `--format=esm --splitting --outdir=frontend/dist --chunk-names=chunks/[name]-[hash]` (keep `--bundle`, `--minify`, `--sourcemap`, the `.css` loader and the `define`), apply the same change to `watch:js`, and add `prebuild:js` and `prewatch:js` scripts that remove `frontend/dist/chunks` (`node -e "require('fs').rmSync('frontend/dist/chunks',{recursive:true,force:true})"`) so stale hashed chunks never stay in the committed `dist`. Change `jira-dashboard.html:21` to `<script type="module" src="frontend/dist/dashboard.js"></script>`. Verify: `npm run build` run twice leaves `git status --short frontend/dist` unchanged between runs; edit one line in a lazy view, rebuild, and confirm the old chunk file is gone and exactly one new chunk appears; the existing `useCommittedDist: true` smoke tests boot against the module build; and, in the Browser pane, a chunk URL under `/frontend/dist/chunks/` is served with `200`. Add the `**/frontend/dist/chunks/*` route to `installDashboardShell` in `tests/ui/epm_home_token_fixture.js` in this step.
- [ ] **Step 4: Wrap the three views** with `React.lazy(() => import(...))` inside `LazyViewBoundary`; the hooks stay in the main bundle.
- [ ] **Step 5: Failure test.** In the smoke spec use `useCommittedDist: true` (the default route swaps in an in-memory single-file bundle that makes no chunk requests, so an abort test there would pass vacuously), abort the first request for the lazy Stats chunk (`**/frontend/dist/chunks/StatsPanel-*.js`; lazy chunks are named after their module, while shared code sits in `chunks/chunk-*.js`, which the entry imports statically, so aborting one of those stops the app from mounting at all and proves nothing about the boundary), and assert that the abort was observed, the Retry button appears, the rest of the app stays interactive, and a successful retry renders the view. Add a second test that aborts twice and asserts the reload message.
- [ ] **Step 6: Measure.** Record `dashboard.js` raw and gzip bytes at the Task 0 base build and now, the first-open chunk sizes, and confirm zero new `/api` requests on first Stats open. Hard gate: the initial JavaScript, meaning the entry `dashboard.js` plus every chunk it imports statically (follow the `from"./chunks/..."` specifiers transitively), raw and gzip, must be strictly smaller than the single `dashboard.js` at the base; if it is not, stop and report, because the split bought nothing. Fingerprint rule: `backend/routes/performance_routes.py:43` hashes only `dashboard.js`, and with hashed chunk names the entry embeds each chunk file name, so a chunk change must change the entry bytes. Edit one line in a lazy view, rebuild and compare `shasum -a 256 frontend/dist/dashboard.js`: if it changed, leave `performance_routes.py` untouched; if it did not, add `frontend/dist/chunks/*` to the fingerprint with a unit test.
- [ ] **Step 7: Docs, dist check, commit.** Change `README.md` lines 88 and 200 (`Open jira-dashboard.html in your browser (or visit http://localhost:5050/)`) and the `AGENTS.md` section 10 runtime line (`dashboard served by Flask or opened via jira-dashboard.html`) so they say to visit `http://localhost:5050/` and that opening the file directly is not supported. The `AGENTS.md` change touches a preserved section, so it is listed again at the Task 9 operator stop for confirmation. Re-run the CI dist check (`make verify-dist-clean`). The per-commit subset does not exercise the fixture-served specs, so run the full Chromium `tests/ui` suite once here (about 8 minutes) before committing the new `frontend/dist` files. Gate, commit, Gate A.

## Task 9: Close-out

Commit message: `Close the App decomposition plan and update the ontology`

- [ ] **Step 1: Final ratchet.** Each commit already ratcheted these; at head set the `dashboard.jsx` ceiling in `tests/test_codebase_structure_budgets.py` (`LEGACY_ENTRYPOINT_LINE_BUDGETS`) and `owner_budgets.json` (`dashboard.lineCount` and `lineCeiling`, 10855 at `cd2ae405`) to the exact measured line count, and `run.sh` `MAX_WARNINGS` (106 at `cd2ae405`) to the exact measured warning count, with no headroom; remove the growth-justification comments that no longer apply.
- [ ] **Step 2: Documentation.** Per-commit ontology updates already landed; finish `docs/ontology.md` (Statistics, Dashboard feature ownership, extraction verification, new owners with verified dates, coverage line), `docs/features/statistics.md` and `docs/plans/README.md` (the status stays `EXEC-` until the PR merges; the `DONE-` rename follows in a docs-only change, as #240 did for #220). Check every ontology path and symbol resolves.
- [ ] **Step 3: Remaining-App inventory.** Record what `App()` still owns (bootstrap, Sprint catalog, task loading, auth recovery, alert toggles) and the follow-up plan list: Basic-auth extraction (operator direction 2026-10-07), the now-unused non-http fallback in `frontend/src/api/backendUrl.js`, and the `renderEngModeControl`, EPM controls and Planning review field editor renderers left in `App()`.
- [ ] **Step 3b: Gate 3 comparison.** Re-run the `App render counts for common interactions` test three times at head and record min and max deltas next to the Task 0 baseline. Report them as numbers only.
- [ ] **Step 4: Full verification, as the section 10 gate requires.** `node --test tests/test_*.js`; `$JEP_TEST_PYTHON -m unittest discover -s tests`; `npm run build` plus clean dist; `bash scripts/extraction_lint/run.sh`; full `npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes); the three gate tests with `JEP_RUNTIME_PROBE=1`; launch the server (`.venv/bin/python jira_server.py`, or `$JEP_TEST_PYTHON jira_server.py` in a worktree) and verify `/api/test` with no dependency warning before the banner. `jira_server.py` reads only `<checkout>/.env`, so a worktree needs the main checkout's gitignored `.env` and `dashboard-config.json` linked in (never copied) and, when `CONFIG_STORAGE_BACKEND=db`, the local Postgres running with `alembic -c backend/db/alembic.ini current` equal to `heads`; do not upgrade the operator's database without approval. If that environment cannot be provided, report `/api/test` as not run, never as passed.
- [ ] **Step 5: Operator stop.** Present the Baseline Log, the three gate results, the render-count before and after, request-count equality, screenshots, `git log --oneline origin/main..HEAD` and `git diff --name-status origin/main...HEAD`. Also list the `AGENTS.md` section 10 runtime-line change (a preserved section) and the end of `file://` direct open for explicit confirmation. Wait for explicit confirmation.
- [ ] **Step 6: Publication transaction** per `AGENTS.md` section 10 and MRT025: fetch base, record SHAs, compare commit list and paths with this plan, rerun verification at the exact head, send the PR body through `gh pr create --body-file -` on stdin, read back the rendered body, verify the remote head and changed files, and report real CI state. PR notes include screenshots and no secrets or real issue keys.

## Acceptance Checklist

- [ ] Gate 1: `Stats chart hover does not re-render App` fails at the Task 0 commit and passes at head.
- [ ] Gate 2: cold-load request pair set is identical for Catch Up, Planning and Stats; reopening Stats adds zero requests.
- [ ] Gate 3: before and after `App()` render counts reported as numbers for a filter change and a Stats view switch; no speed claim beyond them.
- [ ] Lazy-load: Retry works for a transient failure and the reload message appears after two failures; first Stats open adds no `/api` request; the initial JavaScript (entry plus statically imported chunks) is smaller than the single bundle at the Task 0 base; `npm run build` run twice is idempotent and leaves no stale chunk.
- [ ] Analytics guards and quirk pins pass with only source paths changed.
- [ ] Owner budgets, interface counts and aggregates equal measured values; `dashboard.jsx` ceiling ratcheted.
- [ ] Ontology (updated in every owner-moving commit), plan README, statistics feature doc, and the `file://` wording in `README.md` and `AGENTS.md` section 10 (confirmed at the operator stop) updated and verified.
- [ ] The File Map matches `git diff --name-status origin/main...HEAD`, or this plan records each divergence.

## Risks and Open Items

- **Effect order.** 90 effects; Stats effects interleave with non-Stats effects. Mitigation: Task 2 Step 1 ledger, layered hooks, conservation check.
- **Alerts and Stats coupling to the bootstrap** is intentional and recorded; the bootstrap plan owns the final move.
- **`burnoutTaskFilter` filters the visible task list**, so Stats and the task pipeline stay coupled through one setter.
- **Retry cannot fix a stale tab after a deploy** (the old chunk no longer exists); the second-failure reload message covers it.
- **`file://` ends.** Operator decision 2026-10-07 (OAuth-only direction). `README.md` and `AGENTS.md` section 10 change in Task 8; `resolveBackendUrl`'s non-http fallback stays and is listed for the follow-up plan. Basic-auth extraction is its own plan and is not started here: 117 files mention `JIRA_AUTH_MODE`, `jira_basic` or `home_townsquare_basic` at `cd2ae405`, 33 of them plans.
- **Line ranges drift** with every commit; re-measure at each task start.

## Baseline Log

_Filled during Task 0 and updated at each commit with the measured numbers and command output summaries._

Pre-recorded at plan revalidation (2026-10-07, `origin/main` `cd2ae405`, run under Node 20): `dashboard.jsx` is 10,855 lines; `run.sh` exits 0 with `106 problems (0 errors, 106 warnings)`, `owner budgets: 69 modules; problems: 0` and `checked 36 destructure sites in 69 modules; enforced problems: 0; informational: 34; baselined: 0`; `negative_controls.sh` exits 0 with `tooling controls passed: 66` and `negative controls failed: 0`; the per-commit smoke `-g` regex matches 9 of 23 smoke tests and the Task 6 regex matches 3. Task 0 Step 1 re-records every value at its own base.

## Ledger

_Filled during Tasks 1, 2, 4, 5 and 7: measured inventories, effect classifications, interface tables and conservation residuals._
