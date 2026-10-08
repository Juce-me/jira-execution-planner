# Dashboard App Decomposition Implementation Plan

> **Status:** In progress on 2026-10-08. Task 0 safety nets and tooling passed, including all twelve positive browser baselines and the deliberately red hover-isolation gate. Operator approved preserving the existing group-switch assignee reset. Task 0 completed at `7e18428c` with clean review and post-commit rebuild; Task 1 completed at `13075f93` with clean review/rebuild; Task 2 completed at `3ccea324` with clean review/rebuild. Task 3 completed at `d754f1cb` with hover isolation, DOM/screenshot parity, full verification, clean review and committed rebuild; Task 4 completed at `2c7e4bb3` with full gates, clean review and committed rebuild; Task 5 completed at `a29d657f` with full gates, clean review and committed rebuild; Task 6 completed at `46aa831a` with full gates, clean review and committed rebuild; Task 7 completed at `e745f601` with full gates, clean review and committed rebuild; Task 8 split build/lazy recovery passed full gates and review; its authorized local checkpoint awaits committed rebuild; the three operator-approved decisions are recorded below. The panel interface, narrow DOM capture exception, verified wrapper correction and Task 8 runtime wording are approved. The [readiness review and resolution map](#implementation-readiness-review-2026-10-08) records the original findings and their task-level corrections. Follows the closed [#220 extraction plan](DONE-dashboard-scenario-settings-state-extraction.md). Historical line anchors use `cd2ae405`; Task 0 records the actual synchronized base and must pass its preflight before any extraction.
> **Branch:** `improvement/dashboard-app-decomposition` in the active checkout. One PR at the end; separate commits inside it. Local checkpoint, main integration and gated task commits authorized by the operator on 2026-10-08; push and PR creation remain blocked pending final confirmation.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `App()` in `frontend/src/dashboard.jsx` by moving Statistics, Alerts derivation and Capacity ownership into feature modules, turning the closure renderers into components, naming the shared scope, and lazy-loading the Stats, Scenario and Settings views, without changing behavior, data requests or analytics.

**Architecture:** Follow the proven #220 pattern. State read or written by the group bootstrap stays in containers called from `App()` with flat interfaces. Derivation and data effects retain their logical call positions. `StatsPanel` owns chart hover state and the two explicitly characterized chart effects; other views retain their existing state owners. Alerts derives, filters and groups in one composite hook. Capacity has separate state and lifecycle exports in one file. A small memoized shared scope is hoisted only after its real consumers exist. Lazy views use stable loaders and a manifest for the mounted build when retrying failed chunks.

**Tech Stack:** React 19, esbuild 0.27, Node 20 `node --test`, Playwright (Chromium), Python `unittest`, `scripts/extraction_lint`.

## Global Constraints

- Preserve application behavior, API requests/bodies and analytics for the same scope and interaction. Chunk and retry-manifest requests are static assets, outside the API request ledger. Analytics allowlist reason: pure refactor with unchanged canonical events and typed params; Task 0 adds positive Stats pins and a synthetic dataLayer baseline, and Task 3 compares them. No new app event is added for chunk retries.
- One PR, published once at the end through the section 10 publication transaction in `AGENTS.md`. Never merge feature work into local `main`.
- Task commits require an approved execution/publication contract and section 10 checks before the first commit; this planning request grants neither commit nor push/PR authority. Task 9 is the final push/PR stop. Any strategic deviation, uncertain user edit or failed gate still stops under `AGENTS.md`. After two failed attempts on one issue, report the evidence and leave the affected uncommitted changes for the operator. Task 3 Gate 1 must pass before Task 4 starts.
- Out of scope (own plan later): group state and config bootstrap (`buildDefaultGroupState`, `buildGroupStateSnapshot`, `applyGroupState`, `groupStateSnapshot`, `resetSprintScopedState`, `loadConfig`), the Sprint catalog and its cache-first startup, the task-loading pipeline, and Scenario history/save/rollback (issue #230). Also out of scope: extracting Basic auth (operator direction 2026-10-07: the app will rely only on OAuth; its own plan later). This plan acts on one consequence only, the end of direct `file://` open (Task 8).
- Persisted per-group state stays in `App()` through a container hook. Moving it into a component that unmounts is forbidden: `applyGroupState` writes it on every group switch.
- Caches and selections survive closing Stats. Chart hover state resets with the view. `StatsPanel` also owns `burnoutChartRef`, `resolveBurnoutPointer` and scroll-to-today, so chart DOM effects run when the view actually mounts. The excluded-capacity dropdown state, ref and outside-click effect stay in the mounted state/data hooks. `hideExcludedStats` stays in `App()` at its existing Stats–Scenario bootstrap insertion point.
- No new dependency. Opening `jira-dashboard.html` from `file://` is not supported (operator decision, 2026-10-07: Basic auth will be extracted and the app will rely only on OAuth). The app is always served from localhost by Flask, which is why Task 8 may emit ES modules and chunk files.
- Do not hand-edit `frontend/dist/`; rebuild with `npm run build` and commit the output because `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff.
- No Co-Authored-By or agent branding in commits, branch names or the PR. Commit as the noreply identity with one-shot `-c user.email=` flags; never commit the personal address.
- Use the active checkout's `.venv/bin/python` and export `JEP_TEST_PYTHON="$PWD/.venv/bin/python"` for Flask-backed specs. If it is absent, select an existing approved Python 3.10+ runtime before running those checks; never claim them passed without one.
- Stay in the checkout the operator is viewing. Run `npm ci` there in Task 0 under Node 20; do not create or switch to another worktree. Reinstall only if the lockfile or dependency installation changes.
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
| Capacity | state 977-993, derivation and fetch 6453-6774 | `fetchCapacity` at 6592; `handleCapacitySaved` at 6573, passed to `PlanningTeamCapacityCards` as `onCapacitySaved`. `capacityEnabled` and `searchInputRef` stay in App; group-reset setters, Refresh's nonce setter and Epic refresh's `capacityScopeHoldRef` remain externally available |
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
| `frontend/src/stats/statsGroupState.js` | Pure per-group seam for the contiguous main Stats keys; leaves `hideExcludedStats` in App after Scenario; defaults, snapshots, setters and cache resets |
| `frontend/src/stats/useStatsState.js` | State container called in `App()`; no effects, no getters; returns the same flat names `App()` uses today |
| `frontend/src/stats/useStatsData.js` | Layered hooks for Stats derivation memos and fetch effects, each called at its original effect position |
| `frontend/src/stats/StatsPanel.jsx` | Stats view; owns chart hover cells, chart DOM ref/pointer callback, hover-reset and scroll-to-today effects. Task 8 adds `export default StatsPanel;` while retaining the named export, so the planned literal lazy loader and manifest default export resolve consistently |
| `frontend/src/eng/useEngAlerts.js` | Composite derivation, unchanged `useEngAlertFilters` call, then filtered team lists/counts; no state or effects |
| `frontend/src/eng/useEngCapacity.js` | `useEngCapacityState` container plus `useEngCapacity` read lifecycle/totals |
| `frontend/src/eng/EngControls.jsx` | `SprintControl`, `GroupControl`, `TeamControl`, `SearchControl`, `ViewSwitch` components (`renderEngModeControl`, `renderEpmControls` and `renderPlanningReviewFieldEditor` stay in `App()`; see Task 6) |
| `frontend/src/eng/EpicBlock.jsx` | `renderEpicBlock` as a component |
| `frontend/src/eng/useEngScope.js` | Hoisted scope object (Task 7 only) |
| `frontend/src/components/LazyViewBoundary.jsx` | Owns stable lazy identity between attempts, Suspense, keyed error boundary and one explicit retry (Task 8) |
| `frontend/src/components/lazyViewLoaders.js` | Literal first-load imports, mounted-build manifest validation and cache-busted retry imports (Task 8) |
| `scripts/build_dashboard.mjs` | Deterministic split build/manifest and serialized watch rebuilds using the existing esbuild dependency (Task 8) |
| `tests/ui/runtime_probe_helpers.js` | `buildRuntimeProbeBundle`, `readAppRenderCount` for the `?perf` counter |
| `tests/test_stats_group_state.js`, `tests/test_use_stats_state.js`, `tests/test_use_stats_data.js`, `tests/test_stats_panel.js`, `tests/test_use_eng_alerts.js`, `tests/test_use_eng_capacity.js`, `tests/test_eng_controls.js`, `tests/test_use_eng_scope.js`, `tests/test_lazy_view_boundary.js` | Node contracts per module |
| `tests/test_lazy_view_loaders.js`, `tests/test_dashboard_split_build.js` | Retry-manifest validation and deterministic build/watch contracts (Task 8) |

**Modify**

| File | Change |
| --- | --- |
| `frontend/src/dashboard.jsx` | Remove moved ranges, add imports and call sites |
| `tests/ui/codebase_structure_smoke.spec.js` | Add the three gate tests and the `runtimeProbe` option to `installApiMocks` (Task 0), DOM-parity capture calls (Task 3) and the chunk-failure tests (Task 8) |
| `tests/ui/dom_parity_helpers.js`, `tests/ui/dom_parity_helpers.spec.js` | Exact approved closed Stats range/listbox capture exception with positive/negative controls (Task 3) |
| `tests/ui/epm_home_token_fixture.js` | Serve committed chunks and `lazy-views-*.json`; use URL pathname for disk lookup so retry queries work (Task 8) |
| `tests/ui/onboarding_tour.spec.js` | Synchronize production-fixture readiness with visible Catch Up DOM when auto-tour intentionally hides the background from accessibility lookup; retain owner-bridge and read-only assertions (Task 8 full-suite fixture race) |
| `tests/ui/auth_focus_refresh_counts.spec.js` | Wait jointly for the already-required task and forced Sprint reads before snapshotting long-absence requests; preserve existing assertions (Task 8 full-suite failure reproduced at accepted Task 7) |
| `tests/ui/eng_epic_sort_and_track.spec.js` | Keyed Epic identity across real sort reversal and sibling filtering, direct and initiative-grouped (Task 6) |
| `tests/test_status_column_colours_source_guards.js` | Transfer the exact Epic-header status call-site counts/props from dashboard to EpicBlock, preserving the complete classified-site inventory (Task 6 immutable-source inventory) |
| `tests/test_dashboard_epic_icon_source_guards.js` | Transfer one of the two purple 16×16 Epic icon sites to EpicBlock while preserving the exact closed two-site inventory (Task 6 full-suite failure) |
| `tests/test_story_subtasks.js` | Transfer the three moved IssueCard subtask prop assertions to EpicBlock; retain App hook/clear wiring and endpoint-literal exclusion, also guard the positively anchored Epic owner (Task 6 full-suite failure) |
| `backend/routes/performance_routes.py` | Only if the Task 8 fingerprint rule shows the entry hash ignoring chunk changes |
| `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/tooling_controls.mjs` | Add `stats` and `eng` as owner features for the new files |
| `scripts/extraction_lint/check_move_conservation.mjs`, `scripts/extraction_lint/tooling_controls.mjs` | Explicit pure/component owner coverage and two exact effect-relocation allowances with negative controls (Task 0) |
| `tests/test_stats_module_extraction_source_guards.js`, `tests/test_stats_controls_source_guards.js`, `tests/test_excluded_capacity_stats_source_guards.js`, `tests/test_cohort_grid_source_guards.js`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_dashboard_missing_labels_source_guards.js`, `tests/test_dashboard_epic_alert_team_links.js`, `tests/test_extraction_quirk_pins.js`, `tests/test_auth_isolation_source_guard.js` | Re-point source reads from `dashboard.jsx` to the new owner files via `readOwnerSource`; never weaken an assertion. A scan at `cd2ae405` also flags `tests/test_epic_refresh_source_guards.js`, `tests/test_epm_shell_source_guards.js`, `tests/test_epm_view_source_guards.js`, `tests/test_first_run_group_configuration.js`, `tests/test_frontend_api_source_guards.js`, `tests/test_planning_action_source_guards.js` and `tests/test_use_shared_config_save.js` as possible readers of moved code; re-point one only when its guard fails after a move |
| `tests/test_frontend_api_source_guards.js` | Preserve the native application-API fetch prohibition while pinning/removing only the one exact mounted-build static manifest fetch expression from the lazy loader scan (Task 8 full-suite failure); forbid any additional loader fetch/API literal |
| `tests/test_analytics_source_guards.js`, `tests/test_extraction_quirk_pins.js` | Re-point moved positive anchors, retain exclusions, add frozen Stats event-call pins (Tasks 0/3) |
| `tests/test_onboarding_tour_utils.js` | Re-point the proven moved Statistics overview target assertion to StatsPanel; retain native-control and all other destination assertions (Task 3 full-suite failure) |
| `tests/test_load_performance.py` | Task 3 operator-approved correction of the expired fixed timestamps in `test_board_cache_filter_is_applied_before_the_query_limit` to current UTC minus one minute/current UTC; preserve all assertions. Task 8 changes only if the entry-fingerprint check requires a backend fingerprint change |
| `package.json` | `build:js`/`watch:js` call the split-build helper; auth/CSS scripts keep their existing behavior (Task 8) |
| `Dockerfile` | Copy the split-build helper into the existing Node frontend stage before `npm run build` (Task 8) |
| `tests/test_scenario_view.js`, `tests/test_settings_modal_container.js`, `tests/test_epm_settings_source_guards.js` | Transfer exact static-import/call-site assertions to the literal lazy loaders and render-function call sites while preserving props, children and mount gates (Task 8; immutable-source inventory confirms the EPM guard duplicates the Settings container contract) |
| `jira-dashboard.html` | Entry script tag for the split build (Task 8 only) |
| `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/run.sh` | Ratchet the `dashboard.jsx` ceiling and `MAX_WARNINGS` in every commit that lowers them; exact final values in Task 9 |
| `docs/ontology.md` (every commit that moves an owner), `docs/plans/README.md`, `docs/features/statistics.md`, `README.md` (lines 88 and 200), `AGENTS.md` (section 10 runtime line), this plan | Documentation; the `file://` wording changes in Task 8, the rest closes out in Task 9 |
| `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/chunks/*`, `frontend/dist/lazy-views-*.json` | Generated output only, including removal of stale chunks/manifests |

**Forbidden regressions:** added/removed API calls or changed bodies relative to each mode's own baseline; changed analytics; lost Stats selections/caches; unapproved effect reordering; hover re-rendering `App()`; visual changes; lost Epic list identity; a lazy view outside `<StatusColourProvider>`; loading another deployment's lazy graph; stale generated chunks/manifests. The two Task 3 chart-effect relocations are the only effect-order exceptions.

## Per-Commit Gate

Run these before each authorized task commit. Task 0 installs dependencies once and records the baseline. A gate that cannot run is reported as not run, never as passed. Commit steps require execution-time authorization and the section 10 history/scope transaction checks; push/PR always require the final operator confirmation.

```bash
export JEP_TEST_PYTHON="$PWD/.venv/bin/python"
fnm exec --using 20 node --test tests/test_*.js
JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile "$JEP_TEST_PYTHON" -m unittest discover -s tests
fnm exec --using 20 npm run build
git status --short frontend/dist
fnm exec --using 20 bash scripts/extraction_lint/run.sh
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js --browser=chromium --workers=4 -g "Statistics|Project Track|Lead Times|Excluded Capacity|Catch Up, Planning"
```

For code-moving commits, use `fnm exec --using 20 node tmp/lint/check_move_conservation.mjs --base "$TASK_START_SHA"` with the task's explicit created/existing owners and pure/component symbols under the contract below. `run.sh` must run first so the copied checker resolves its pinned parser. Review every residual and record its disposition in the Ledger; zero exit alone does not approve a source rewrite. Snapshot the complete generated file list and bytes after one build, rebuild, then compare the second snapshot byte-for-byte, including new/deleted chunks and manifests. A changed `git status` against the previous commit is expected before committing new output. After the authorized commit, rebuild and run `make verify-dist-clean`; it must pass at that exact committed head. Then run `git show --stat HEAD` and `git status` and confirm the intended content and a clean worktree.

The Playwright command must select all original 9 baseline cases plus `Statistics preserves per-mode cold-load request contracts and cached reopen`, `Statistics preserves group state across A B A`, and `Statistics preserves analytics event contracts`. Check the selected titles with `--list`, not just a minimum count. Gate 1 and render measurement remain opt-in under `JEP_RUNTIME_PROBE=1`; Gate 1 is knowingly red until Task 3 and is mandatory thereafter. Under Task 8 also select all `Statistics lazy` tests explicitly. Fewer required titles or zero tests is a failed gate.

In the same commit, ratchet the `dashboard.jsx` line ceiling (`tests/test_codebase_structure_budgets.py` `LEGACY_ENTRYPOINT_LINE_BUDGETS`, and `owner_budgets.json` `dashboard.lineCount` and `lineCeiling`) and `run.sh` `MAX_WARNINGS` to the measured values (`validate_owner_budgets` fails unless every line count, interface count and aggregate equals the measured value), update the `docs/ontology.md` entries of every concept that moved (root `AGENTS.md` section 1), and compare `git diff --name-status` with the File Map.

### Conservation and binding contracts

Task 0 extends the existing checker before any move. Preserve current hook flags and strict created/deleted/base-file validation. Add `--owner-function FILE#SYMBOL` for named top-level pure functions/components; a pure owner must name every moved exported function. Include those bodies in statement accounting, reject missing/ambiguous symbols and do not silently enumerate unrelated functions. Preserve recursive hook effect-order checking. Component effects are tracked under their named component owner, separately from App's lifecycle.

Add `--allow-effect-move FROM_FILE#OWNER=>TO_FILE#OWNER@TOKEN_SHA256`. It requires one exact source occurrence before, none there after, no destination occurrence before, one unchanged occurrence after, and an identical token signature including hook kind, callback and dependencies. Remove only that explicitly relocated occurrence before comparing retained effect order; any duplicate, stale allowance, wrong owner, changed callback/dependencies or additional unapproved effect fails. Only Task 3 uses allowances:

| Effect | Source owner at Task 3 base | Destination | Token-signature SHA256 at `1f161a29` |
| --- | --- | --- | --- |
| Hover reset | `frontend/src/dashboard.jsx#App` | `frontend/src/stats/StatsPanel.jsx#StatsPanel` | `020d7cc238f50f3d5caf741768a0d01d73100e3d9a3ebe313f1cb7a95547685c` |
| Scroll-to-today | `frontend/src/stats/useStatsData.js#useStatsDerivedC` | `frontend/src/stats/StatsPanel.jsx#StatsPanel` | `d102b57c272da087edd05d3877fc7e8b16887697e34acf4fbc4b8072897d49b4` |

Recompute each digest from the Task 3 base using the checker's token-signature algorithm; a source change requires review of the changed effect, not an automatic allowance update. Task 0's negative controls cover named pure/component bodies, omitted ownership, missing symbols, duplicate effects, changed callbacks/dependencies, wrong destinations, stale allowances and unapproved reordering, while retaining every existing control. Task 3 must print exactly these two approved relocations and zero unexplained effects.

Before extracting a closure, make a binding ledger by reading its declaration and using `rg` to trace each identifier's declaration and external consumers. Classify locals, imports/platform globals and App-owned bindings; record each external input and returned value with caller lines. JSX attribute/property names are not identifier references. Check declaration availability at each proposed call position and deferred callback timing. Existing imports and platform globals are allowed; owners may never import/re-export `dashboard.jsx`. After owner interfaces exist, use `node tmp/lint/check_hook_interfaces.mjs --write-inventory tmp/stats-inventory.json --manifest scripts/extraction_lint/owner_budgets.json frontend/src/dashboard.jsx` to validate declared inputs/returns. It does not discover pre-extraction closure free variables.

SSR probes reuse `tests/test_use_capacity_mapping_settings.js`: esbuild to CommonJS with React external, then `renderToString` a probe component. These tests prove initial values and return contracts only; browser tests prove effects, retries, mounted identity and dirty/conflict/auth flows. Freeze synthetic expected values in tests rather than deriving them from the post-move implementation.

## Task 0: Safety net, baselines and tooling

Commit message: `Add render-isolation and request baselines for the App decomposition`

**Files:** Create `tests/ui/runtime_probe_helpers.js`. Modify `docs/ontology.md`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/test_extraction_quirk_pins.js`, `tests/test_analytics_source_guards.js`, `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/check_move_conservation.mjs`, `scripts/extraction_lint/tooling_controls.mjs`.

**Produces:** a red Gate 1, green per-mode API/analytics/group-state baselines, and tested tooling for Stats/ENG pure, hook and component owners. State-restoration and event tests must pass on the unchanged baseline before extraction.

- [x] **Step 1: Startup checks, branch, base and numbers.** Read the instruction chain and named postmortems. Record `git status --short`, branch, HEAD and fetched `origin/main` SHAs. Preserve these plan revisions and other user changes; never stash, discard or switch checkouts implicitly. Integrate `origin/main` into the dedicated branch only under the execution-time Git authorization, then confirm `git merge-base --is-ancestor origin/main HEAD`. If integration cannot be performed safely, stop before implementation and report the required base sync. Record `TASK_START_SHA=$(git rev-parse HEAD)` and the Task 0 base, source line/hook counts, installed Python/Node versions and initial bundle raw/gzip bytes. Run `fnm exec --using 20 npm ci`, then the unmodified baseline checks. Re-stamp the relevant ontology measurements. List gates; GATE-05 is unrelated to this read-only extraction and not due until 2026-10-12, so record its existing dates without modifying or probing it. Reassess only if execution happens on or after that review date. Baseline failures stop before a move.

- [x] **Step 2: Create the probe helper.**

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

- [x] **Step 3: Add the `runtimeProbe` option to `installApiMocks`.** In `tests/ui/codebase_structure_smoke.spec.js` import the helper, build the probe bundle in `beforeAll` only when `process.env.JEP_RUNTIME_PROBE === '1'`, and extend the route at line 804:

```js
if (options.runtimeProbe) {
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: runtimeProbeBundle,
    }));
} else if (!options.useCommittedDist) {
    // existing route unchanged
}
```

- [x] **Step 4: Write the gate-1 test (must fail now).** Append beside the test at line 1763. It uses the same prefs and mocks as that test, sets `?perf=1` with an init script and loads `/` (the shared shell route in `epm_home_token_fixture.js` matches only a bare `/`, so navigating to `/?perf=1` would bypass it and the page would never load), opens Priority then Burndown, and asserts that hovering does not change the `App()` render count.

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

- [x] **Step 5: Run it and confirm it fails.**

Run: `JEP_RUNTIME_PROBE=1 fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Stats chart hover" --browser=chromium`
Expected: FAIL on the equality assertion because the hover increments the count today. Keep the failing output in the Baseline Log.

- [x] **Step 6: Write `Statistics preserves per-mode cold-load request contracts and cached reopen` (green on the baseline).** Parameterize fresh browser contexts for Catch Up, Planning and each Stats subview. Freeze a separate sorted request multiset per mode after that mode's known task/alert/readiness/Stats responses settle. Reuse the fixture's `method`, `pathname`, `params`, `headers` and parsed `body` fields. Recursively sort object keys, preserve array order and all semantic query/body values, and remove only the existing timestamp cache-busters (`t`/`_ts`) and explicitly fixture-volatile transport identifiers; list every excluded field in the test. Include requested-with/CSRF behavior where applicable; never capture credential headers. Assert each mode against its own literal baseline. Then warm Burndown, switch to Catch Up and back, assert Burndown remains selected and its POST count remains 1 with zero additional Stats requests. Keep the exact cold-load expectations unchanged during extraction.

```js
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, canonical(value[key])])
    );
    return value;
}
function requestContract(call) {
    const params = { ...call.params };
    delete params.t;
    delete params._ts;
    return canonical({ method: call.method, pathname: call.pathname, params,
        body: call.body, requestedWith: call.headers['x-requested-with'] || null,
        csrf: call.headers['x-csrf-token'] ? 'present' : 'absent' });
}
const requestMultiset = calls => calls.map(call => JSON.stringify(requestContract(call))).sort();
```

- [x] **Step 6a: Write `Statistics preserves group state across A B A` (green on the baseline).** Use two synthetic groups with distinct Team sets and valid assignees. In A select Burndown/Issue Count and a valid assignee, configure a distinct Lead Times quarter range/grouping, then return to Burndown. Set different values in B. Switch A → B → A through the existing group selector, waiting for scoped data and persistence each time; assert each group's view, metric and both cohort quarter endpoints/grouping restore. Pin the existing Burndown assignee reset to `all` on scope reload/return, with distinct valid selections before switching to prove the reset (operator continuation decision, 2026-10-08). Return to B too to verify its saved controls. Freeze scope-specific request bodies/counts from the original behavior; group switches may clear caches, so compare against that baseline rather than assuming zero requests across groups. A close/reopen in the same warmed scope adds zero Stats calls. Include one real Burndown point click that filters the external task list and Clear that restores it.

- [x] **Step 6c: Write `Statistics preserves analytics event contracts` (green on the baseline).** Enable analytics only in the synthetic `/api/analytics/context` mock with no external GTM container, collect `window.dataLayer`, and freeze app-owned `userevent`/`pageview` records after startup and a view change, graph-mode change, effort-split chart action and exclusion filter action. Keep canonical event names, event type, feature/page names and typed params; exclude only named wall-clock/session transport values. Assert the no-event Lead Times exclusion case. In `test_extraction_quirk_pins.js`, freeze the tokenized Stats analytics call expressions from the baseline, including `trackStatsAction` and `trackStatsAnalyticsAction`, and read the later Stats owner files through positive anchors. Do not derive expectations from the post-move source. Run these tests before any move; preserve their assertions throughout.

- [x] **Step 6b: Add the render-count measurement (gate 3).** Add an opt-in test `App render counts for common interactions` (skipped unless `JEP_RUNTIME_PROBE=1`) that, on the same fixture, reads `readAppRenderCount` before and after (a) toggling one Team in the Teams dropdown and (b) switching the Stats view from Teams to Priority, and attaches the two deltas with `testInfo.annotations.push({ type: 'app-renders', description: JSON.stringify({ filterChange, statsViewSwitch }) })`. It asserts nothing about the numbers; Task 9 compares them. Run it three times and record the min and max for each delta in the Baseline Log, because render counts vary with timers.

- [x] **Step 7: Extend the owner tooling.** In `tests/test_codebase_structure_budgets.py` allow `"stats"` and `"eng"` in the feature check, seed both in `totals` and require matching `aggregates`. In `check_hook_interfaces.mjs`, read the selected manifest before call-site enforcement. Measure the deduplicated union of root-discovered files and explicit `manifest.modules[].path` files; include explicit registered files in `owned()` so their hook/component contracts are enforced. Registered outside-root paths must be normalized repo-relative JS/JSX/MJS files inside `frontend/src`, excluding generated/test files; reject missing/duplicate/escaping paths rather than dropping them. Replace the blanket outside-root rejection with this explicit-registration rule. Infer features for existing roots as before (`epm` stays `settings`); use each explicit module's frozen `features` for outside-root modules, and extend aggregate totals for Stats/ENG. Register only the new owners from the File Map, including Task 8's shared boundary/loader under `['scenario', 'settings', 'stats']`; do **not** add whole Stats/ENG/components directories to `ownerRoots`, so existing files there remain outside ownership budgets. Inventory output must include explicit modules/interfaces/callers exactly once. Add seeded controls for both new features, valid outside-root measurement/enforcement, escaping/missing paths, duplicate registration, changed exports and stale interface counts. Preserve the old root-discovery/unregistered-source controls.

- [x] **Step 7a: Extend conservation before relying on it.** Implement the named-owner and exact effect-relocation contract above in `check_move_conservation.mjs`. Use synthetic App/pure/component copies under ignored `tmp/` to prove an unchanged move passes and every listed defect fails for its intended reason. Preserve old CLI behavior and every existing negative control. The actual effect bodies/digests above remain unchanged; a third relocated effect must fail. Run the negative-control suite before any feature extraction.

- [x] **Step 8: Verify the tooling.** Run `bash scripts/extraction_lint/run.sh` and `bash scripts/extraction_lint/negative_controls.sh` with `JEP_TEST_PYTHON` exported (`run.sh` falls back to `.venv/bin/python`). Expected at `cd2ae405`: `run.sh` exits 0 with `106 problems (0 errors, 106 warnings)`, `owner budgets: 69 modules; problems: 0` and `checked 36 destructure sites in 69 modules; enforced problems: 0; informational: 34; baselined: 0`; `negative_controls.sh` exits 0 and ends with `tooling controls passed: 66` and `negative controls failed: 0`. After this step the module count stays 69 and the passed-controls count rises by exactly the new seeded failures; record every summary line in the Baseline Log.

- [x] **Step 9: Gate and authorized commit.** Run the per-commit gate (the gate-1 test is excluded from it because it is opt-in and red). Follow the section 10 scope/history checks and commit only under the approved execution contract, with the message above and no trailer. Rebuild and require the post-commit dist-clean check.

## Task 1: Stats state container and per-group seam

Commit message: `Extract the Statistics state container and per-group seam`

**Files:** Create `frontend/src/stats/statsGroupState.js`, `frontend/src/stats/useStatsState.js`, `tests/test_stats_group_state.js`, `tests/test_use_stats_state.js`. Modify `frontend/src/dashboard.jsx`, `scripts/extraction_lint/owner_budgets.json` and the mapped Stats source guards.

**Interfaces:** the pure seam exports `STATS_GROUP_STATE_KEYS`, `buildDefaultStatsGroupState(savedPrefs, resolvers)`, `snapshotStatsGroupState(values)`, `applyStatsGroupState(nextState, setters, resolvers)` and `resetStatsTransientRefs(refs)`. The ordered key literal is:

```js
const STATS_GROUP_STATE_KEYS = [
    'statsView', 'statsGraphMode', 'burnoutData', 'burnoutLoading', 'burnoutError',
    'burnoutAssigneeFilter', 'burndownMetric', 'cohortData', 'cohortLoading',
    'cohortError', 'cohortStartQuarter', 'cohortEndQuarter', 'cohortGroupBy',
    'cohortProjectFilter', 'cohortAssigneeFilter', 'cohortExcludeAdHoc',
    'cohortExcludeCapacity', 'cohortStatusToggles', 'cohortSelectedRow'
];
```

`useStatsState({ savedPrefsRef, resolveStatsView, resolveStatsGraphMode, resolveBurndownMetric, resolveCohortGroupBy })` moves the existing Stats cells/refs, with their exact initializers and flat names. Include excluded-capacity, Project Track, effort-split state, cache/force-refresh refs, dropdown state/ref, `burnoutTaskFilter`, and `issuePeopleStatsRevision`/its setter. The latter's external invalidation setter stays wired in App. Exclude `hideExcludedStats`/its setter; three chart-hover cells; `burnoutChartRef`; `isStatsSourceOnlyStatsView`; and the interleaved Catch Up/Board declarations. State container owns no effects/getters.

Import the existing `getCurrentQuarterLabel` from `cohortUtils.js` in the state/seam owners where their unchanged initializers/fallbacks need it; do not invent a new resolver or change evaluation timing.

- [x] **Step 1: Freeze the binding ledger.** Read the state declarations and all bootstrap/cache/invalidation consumers, recording each moved cell/setter/ref and every external reader. Split combined declarations mechanically where required. Verify the state hook call at the first former Stats state declaration has every input available. `issuePeopleStatsRevision` remains exposed for `invalidateEngIssueFieldSources`.
- [x] **Step 2: Write the pure seam tests and run red.** Freeze the 19-key literal above, original empty/partial/invalid saved-pref results, falsy fallbacks and ordered stub-setter calls. Test all three cache clears. Pin the complete composed defaults/snapshot/setter sequence: main Stats → unchanged Scenario → unchanged `hideExcludedStats`. Do not extract expected keys from a source block that the move removes.
- [x] **Step 3: Move only the contiguous main Stats blocks.** Delegate defaults/snapshot/application at those original insertion points. Leave Scenario and following `hideExcludedStats` statements untouched; move only the existing three cache-ref assignments into `resetStatsTransientRefs`. Keep force-refresh assignment behavior unchanged. Run the seam tests green and verify each key still receives its actual App value/setter.
- [x] **Step 4: Test and move the state container.** Use the established esbuild/SSR probe to assert the frozen return-name set and initializers; add a source assertion for no `useEffect`/getters. Move declarations verbatim, destructure the flat names in App, and keep `isStatsSourceOnlyStatsView` immediately after the destructure. Confirm the group round-trip, same-scope reopen and external point-filter tests remain green.
- [x] **Step 5: Migrate source-guard ownership.** Existing render/pure Stats modules retain the request/storage ban. State is now owned by `useStatsState`; orchestration remains App until Task 2. Preserve positive anchors and every negative assertion, changing the explicit owner contract where ownership transfers. Never grant the whole Stats directory blanket request/storage rights.
- [x] **Step 6: Register, ratchet, gate and commit.** Register measured owners and interfaces, update ontology and run the per-commit gate. Conservation uses `--created-hook frontend/src/stats/useStatsState.js --created-hook frontend/src/stats/statsGroupState.js` plus repeated `--owner-function` for the four seam functions (`buildDefaultStatsGroupState`, `snapshotStatsGroupState`, `applyStatsGroupState`, `resetStatsTransientRefs`). `STATS_GROUP_STATE_KEYS` is a constant export, not a function owner. Review residuals; run the post-commit clean-build check only after an authorized commit.

## Task 2: Stats derivation and fetch effects

Commit message: `Move Statistics derivation and fetch effects into useStatsData`

**Files:** Create `frontend/src/stats/useStatsData.js`, `tests/test_use_stats_data.js`. Modify `frontend/src/dashboard.jsx`, `scripts/extraction_lint/owner_budgets.json` and mapped Stats guards.

**Shared scope:** construct this memo immediately before the first Stats layer, preserving scalar dependency arrays. All members are already declared there and consumed by Stats plus an existing Alerts/Capacity consumer:

```js
const scope = React.useMemo(() => ({
    activeGroupId, selectedSprint, selectedSprintInfo, isAllTeamsSelected,
    selectedTeamSet, teamNameById, teamOptions, capacityTasks, techProjectKeys,
    excludedEpicSet, adHocEpicSet, adHocEpicSignature
}), [activeGroupId, selectedSprint, selectedSprintInfo, isAllTeamsSelected,
    selectedTeamSet, teamNameById, teamOptions, capacityTasks, techProjectKeys,
    excludedEpicSet, adHocEpicSet, adHocEpicSignature]);
```

State/helpers/gates and feature-only metadata remain explicit inputs. Do not add `statsTaskList`, generic `config`, later `visibleTasks`, or `scopedTasks`, which these Stats layers do not consume; do not replace an existing effect dependency array with `[scope]`.

**Layer contract** (historical `cd2ae405` anchors; remeasure by symbol):

| Export | Range | Task 2 effects | Call position |
| --- | --- | ---: | --- |
| `useStatsDerivedA` | 4300–4544 | 2 | Former `statsTaskList` declaration |
| Retained hover-reset | 4546–4549 | 1 in App | Between A and B, untouched until Task 3 |
| `useStatsDerivedB` | 4551–5270 | 13 | Immediately after the retained hover-reset |
| Scenario/non-Stats code | 5271–5488 | unchanged | Neither layer crosses it |
| `useStatsDerivedC` | 5489–5782 | 1 | Former `statsTeams` declaration |

Each layer takes one object, returns an object literal and never calls another layer. The verified flat input sets and returns are in the [Stats interface ledger](#stats-interface-ledger). Scope members are destructured to their existing local names; remaining names are explicit feature inputs. A's outputs feed B/C where listed. Keep `EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY` as an explicit input from its existing owner in this task.

- [x] **Step 1: Freeze effect and binding ledgers.** List all 17 Stats effects plus neighboring effects with dependencies/callback tokens, and verify layer boundaries against current code. Record the two chart effects destined for the panel but keep them in their original App/hook positions through Task 2. Revalidate input declaration timing, counters and deferred callbacks.
- [x] **Step 2: Write SSR/interface and source tests; run red.** Probe each layer with synthetic scope/state; assert the frozen returned keys. Source scan expects 16 data-hook effects and no layer calling another. SSR does not prove fetch behavior: use Task 0's per-mode body/count ledger for that.
- [x] **Step 3: Move the three ranges verbatim.** Keep original dependency arrays, request payloads, cancellation/generation guards and `perfCountersRef.current.statsBuild`. Call each layer at its original first declaration and destructure exact names; do not cross the retained hover or Scenario/non-Stats code.
- [x] **Step 4: Migrate orchestration guards.** Only `useStatsData.js` may call the existing `statsApi` wrappers. It still must not own direct `fetch`, browser storage, credentials or auth/CSRF headers. Presentation/pure helpers retain their original ban; App delegates requests instead of retaining their implementation text. Preserve positive guards for wrapper calls and request bodies.
- [x] **Step 5: Prove preserved ordering and reads.** Run the copied conservation checker with all created/affected hooks and no effect allowances. Expect retained effect order identical; explain every statement residual. Run the exact per-mode request, cached reopen, group-state and analytics baseline tests.
- [x] **Step 6: Register, ratchet, update ontology, gate and commit.** Apply measured owner/interface budgets and the normal post-commit clean-build check.

## Task 3: StatsPanel view and chart DOM lifecycle

Commit message: `Render Statistics through StatsPanel and isolate chart hover`

**Files:** Create `frontend/src/stats/StatsPanel.jsx`, `tests/test_stats_panel.js`. Modify `frontend/src/dashboard.jsx`, `frontend/src/stats/useStatsData.js`, `tests/test_use_stats_data.js` (C loses its pointer output and scroll effect), owner budgets, mapped Stats/analytics guards, `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/dom_parity_helpers.js` and `tests/ui/dom_parity_helpers.spec.js` (approved closed-listbox capture contract).

**Interface:**

```jsx
StatsPanel({ stats, links, analytics, onSelectBurnoutTask,
    showStats, jiraUrl, activeGroupMissingComponents, priorityAxis,
    resolveStatsTeamColor })
```

`stats` combines the state/data outputs the panel reads, including `burnoutScopedTeamIds` for fallback JSX and `burnoutData` for the unchanged hover-reset effect; no shared `scope` prop is passed (operator-approved correction, 2026-10-08); `links` contains `buildStatLink` and `buildPriorityStatLink`; `analytics` contains `trackStatsAction` and `trackStatsAnalyticsAction`. `onSelectBurnoutTask` is the existing state setter and supports functional updates. Internally alias it as `setBurnoutTaskFilter` for the unchanged child props.

The panel owns `priorityHoverIndex`, `burnoutHoverPoint`, `burnoutHoverTeamKey`, `burnoutChartRef`, `resolveBurnoutPointer`, hover-reset and scroll-to-today. The ref has only panel/pointer/scroll readers. Dropdown state/ref/outside-click effects and `burnoutTaskFilter` stay in App's state/data composition. `canRenderStatsPanel` and its fallback remain inside the moved JSX. After this task C drops the chart ref/pointer callback and has zero effects; data layers have 15 effects, the panel has exactly two.

- [x] **Step 0: Capture before DOM and screenshots.** Import existing `captureDomParity` from `tests/ui/dom_parity_helpers.js` and add opt-in calls once per view (`teams`, `priority`, `burnout`, `cohort`, `excludedCapacity`, `monoCrossShare`, `projectTrack`) in the smoke campaign, targeting `.stats-panel`. Run with `JEP_DOM_PARITY_DIR=tmp/dom-parity-before`; the directory must be fresh. Require seven unique files and settled transitions. Capture Teams/Burndown/Lead Times/Project Track at 1280px and 375px using synthetic fixtures.
- [x] **Step 1: Test the panel contract; run red.** SSR each view, assert one panel root, the seven-option `SegmentedControl` with `eng-mode-control stats-view-toggle`, and no hover/ref/pointer values arriving as props. Freeze the existing positive Stats/analytics source anchors under the new owner.
- [x] **Step 2: Move JSX and chart-owned declarations verbatim.** Keep classes, child props and the existing mount condition inside `StatusColourProvider`. Move both chart effects with unchanged bodies/dependencies and the local ref/pointer callback. Keep `buildBurnoutTaskFilter` in C. Remove `priorityHoverIndex` from the diagnostic perf snapshot/dependency list; no App reader remains. Apply the two exact conservation allowances; retained App/hook effect order must remain identical and no third exception is permitted.
- [x] **Step 3: Gate 1 turns green.** Run `JEP_RUNTIME_PROBE=1 fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Stats chart hover" --browser=chromium`. Record before/after render counts; Task 4 cannot start until this passes. Point-click filtering, hover readouts and group restoration must also stay green.
- [x] **Step 4: DOM, screenshots and analytics parity.** Capture seven after files with `JEP_DOM_PARITY_DIR=tmp/dom-parity-after` in a separate fresh directory; `git diff --no-index tmp/dom-parity-before tmp/dom-parity-after` must be empty. Inspect before/after screenshots at both widths. Run the positive Stats call pins, `test_analytics_source_guards.js`, quirk pins and the `Statistics preserves analytics event contracts` browser test; preserve frozen baseline events/params. Re-point the Lead Times guard to `StatsPanel` without dropping its no-event assertion.
- [x] **Step 5: Register, ratchet, gate and commit.** Record two approved effect relocations separately from residual statements, update the ontology and run the ordinary gate/clean-build sequence. Task 8 adds the delayed-chunk mount proof for the scroll effect.

## Task 4: Composite Alerts derivation/filter/grouping hook

Commit message: `Extract Alerts derivation into useEngAlerts`

**Files:** Create `frontend/src/eng/useEngAlerts.js`, `tests/test_use_eng_alerts.js`. Modify `frontend/src/dashboard.jsx`, owner budgets and the three mapped Alert source guards.

**Interface:** `useEngAlerts({ scope, ...explicitAppBindings })` derives the current raw collections, calls unchanged `useEngAlertFilters` at the same logical position, then groups its filtered collections. Own no state, refs or effects; keep existing memos/callbacks and predicate order. Alert toggles, `showAlertsPanel`, dismissals, celebration state/callback and bootstrap handling stay App-owned. Do not add a toggles input: the moved producer range does not read it. The exact external bindings are traced under the common binding-ledger procedure before editing. Return only the 21 actual App-consumed names:

```text
visibleAlertCollections
missingAlertKeySet blockedAlertKeySet postponedAlertKeySet needsStoriesAlertKeySet
waitingAlertKeySet emptyAlertKeySet doneAlertKeySet alertCounts alertItemCount
missingAlertTeams blockedAlertTeams doneEpicTeams postponedAlertTeams
postponedEpicTeams emptyEpicTeams analysisEpicTeams backlogEpicTeams
missingTeamEpicTeams missingLabelEpicTeams needsStoriesTeams
```

Raw `consolidatedMissingStories` and other collections stay internal. Preserve the existing internal `backlogAlertKeySet` destructure; do not expose extra outputs just to test them. Existing `engAlertFilters.js` and `epicRefreshAlerts.js` remain unchanged.

- [x] **Step 1: Freeze bindings and write SSR tests; run red.** Assert the exact 21 returns. Synthetic fixtures cover missing SP, blocked, postponed, backlog, missing Team/labels, needs Stories, waiting, empty and done Epics, dismissed keys/requirement IDs, fallback sources, and strict absent/nonzero `openChildCount` rejection. Narrow search/Status/Priority/Project Track/focused-Stats filters and assert visible collections, team lists, keysets and counts agree.
- [x] **Step 2: Move the composite range verbatim.** Move the producer through the final `needsStoriesTeams` declaration, stopping before `triggerAlertCelebration`. Keep the nested filter call and post-filter grouping in order. App continues passing unchanged toggles/dismissals and the 21 returned values to the existing alert view.
- [x] **Step 3: Verify, register, ratchet and commit.** Run `tests/ui/eng_alert_loading_order.spec.js`, `eng_alerts_panel_summary.spec.js`, `eng_missing_story_ghosts.spec.js`, the per-commit gate and conservation with the new hook. Preserve fallback until replacement success for the same scope; no source or endpoint change.

## Task 5: Capacity state and read lifecycle

Commit message: `Extract Capacity read lifecycle and totals into useEngCapacity`

**Files:** Create `frontend/src/eng/useEngCapacity.js`, `tests/test_use_eng_capacity.js`. Modify `frontend/src/dashboard.jsx`, owner budgets and `tests/test_planning_action_source_guards.js` when re-pointing Capacity-owned positive anchors. Full Node verification proves two additional mapped positive readers need transfer: `tests/test_epic_refresh_source_guards.js` (hold/pin assignment) and `tests/test_excluded_capacity_stats_source_guards.js` (selected-project Ad Hoc classification). Re-point only those moved assertions to the explicit Capacity owner; retain all negative/UI/write checks. Other readers require a reviewed File Map update before editing.

**Interfaces:** export `useEngCapacityState()` at the old state position and `useEngCapacity({ scope, ...explicitAppBindings })` at the old derivation position. `capacityEnabled`/its setter and `searchInputRef` stay App-owned. Move the existing render-time ref assignments with their state owner. State returns exactly:

```text
capacityState setCapacityState capacityStateRef capacityLoading setCapacityLoading
capacityReadRevision setCapacityReadRevision capacityReadError setCapacityReadError
capacityDataStale setCapacityDataStale capacityReadModelRef capacityRefreshNonce
setCapacityRefreshNonce capacityReadGenerationRef capacityReadAbortRef
activeCapacityScopeRef capacityScopeHoldRef capacityScopePinRef capacityScopeKeyRef
```

The lifecycle/derivation export returns exactly:

```text
selectedAdHocProductSP excludedProjectStats capacityShareLabel teamCapacityEntries
 displayedTeamCapacityEntries capacityScopeSignature effectiveCapacityState
capacityMutationEnabled handleCapacitySaved retryCapacity capacityTeamIds
 totalCapacityAdjusted estimatedCapacityAdjusted excludedCapacityAdjusted
capacitySummary selectedProjectEntries selectedTeamEntries capacityTotals
showTotalsRow formatCapacityValue
```

`handleCapacitySaved` reconciles `PlanningTeamCapacityCards` saves. Keep group-reset setters, Refresh's `setCapacityRefreshNonce`, config's `setCapacityEnabled`, and Epic refresh's `capacityScopeHoldRef` wired under their current names. Settings capacity mapping is a separate owner. Internal math helpers remain private.

- [x] **Step 1: Freeze the caller and binding ledger.** Trace all state-reset, refresh, panel and Epic-refresh consumers, including the no-request-context-free frontend callbacks. Keep state and lifecycle calls at their separate original positions; do not move read effects upward with the state container.
- [x] **Step 2: Write SSR probes; run red.** Assert both 20-name interfaces, initial values and synthetic adjusted totals/selected Team entries. Reuse existing `planningCapacityUtils` test fixtures for internal math rather than exposing helpers only for tests. SSR does not run the lifecycle effects.
- [x] **Step 3: Move state and lifecycle verbatim.** Preserve scope signatures, abort/generation checks, read revision, stale flags, hold-window behavior, retry and save reconciliation. APIs/CSRF/global-401 handling remain in `capacityApi.js`/HTTP owners.
- [x] **Step 4: Browser/conservation gates and commit.** Run full `planning_capacity_editing.spec.js`, `adhoc_capacity_visual_proof.spec.js`, and focused `eng_epic_refresh.spec.js` cases 60/61/70/71 covering held scope, stale settlement and global Refresh. Confirm those case titles with `--list`. Run the per-commit gate and conservation for both exported hooks, update measured budgets/ontology, and use the ordinary authorized commit/clean-build sequence.

## Task 6: Closure renderers become keyed components

Commit message: `Turn ENG control and Epic renderers into components`

**Files:** Create `frontend/src/eng/EngControls.jsx`, `frontend/src/eng/EpicBlock.jsx`, `tests/test_eng_controls.js`. Modify `frontend/src/dashboard.jsx`, owner budgets and `tests/ui/eng_epic_sort_and_track.spec.js`. `EngView.jsx` already consumes the renderer prop and is unchanged. Proven full-suite readers also transfer only their moved positive anchors: `tests/test_dashboard_alert_source_guards.js` (IssueCard helpers), `tests/test_dashboard_epic_icon_source_guards.js` (one of two Epic icon sites), `tests/test_epm_settings_source_guards.js` (ControlField) and `tests/test_epm_view_source_guards.js` (shared selectors/primitives), plus `tests/test_story_subtasks.js` (three IssueCard subtask props). Preserve all other App checks, negatives and closed site counts.

- [x] **Step 1: Freeze bindings and test contracts; run red.** Inventory each closure's real free bindings using the common ledger procedure. SSR every new export, EpicBlock included, and both main/compact surfaces where supported. Assert root/shared classes and explicit App-owned props. Imports/platform globals remain allowed; owners never import/re-export dashboard. Add an AST/source assertion that App's returned `EpicBlock` carries `key={epicGroup.key}`.
- [x] **Step 2: Move one renderer at a time.** Order: SearchControl, ViewSwitch, SprintControl, GroupControl, TeamControl, EpicBlock. Keep each existing `surface` argument and SearchControl's `extraClassName`; ViewSwitch takes no old renderer arguments but still receives explicit closure props. Keep `renderEngModeControl`, `renderEpmControls` and `renderPlanningReviewFieldEditor` in App. Preserve current-base StatusPill props and provider context. The retained renderer returns a keyed component:

```jsx
const renderEpicBlock = epicGroup => (
    <EpicBlock key={epicGroup.key} epicGroup={epicGroup} {...epicBlockProps} />
);
```

`epicBlockProps` is a local object containing only the named bindings frozen in Step 1; destructure those names explicitly in the component. No `React.memo` is added. Register every new exported component as an explicit conservation owner, not a hook.

- [x] **Step 3: Identity, geometry and layering.** Extend `eng_epic_sort_and_track.spec.js` with a real order reversal and `isSameNode` for the same keyed Epic, then filter a sibling and verify surviving Epic identity/focus/ref mapping. Cover direct and initiative-grouped Epics with at least two siblings. Run existing header dropdown/sticky tests and normal non-forced option clicks; `eng_group_board_card.spec.js:557-768` already covers both header layouts and Planning include/exclude geometry. Also run specs selected by `rg -l "epic-header" tests/ui` and exclude helper-only modules from the executable list. Inspect settled synthetic screenshots for main/compact menus and both header layouts.
- [x] **Step 4: Register, ratchet, gate and commit.** Check statement residuals for all five control exports and EpicBlock, retain all other effect-order checks, update ontology and run the normal gate/clean-build sequence.

## Task 7: Hoist the existing shared scope

Commit message: `Hoist the shared ENG scope into useEngScope`

**Files:** Create `frontend/src/eng/useEngScope.js`, `tests/test_use_eng_scope.js`. Modify `frontend/src/dashboard.jsx`, owner budgets, ontology, `tests/ui/runtime_probe_helpers.js` and `tests/ui/codebase_structure_smoke.spec.js`.

**Interface:** `useEngScope(inputs)` returns the same 12-member memoized object introduced in Task 2. Each member is a current shared input, never a new source of state, fetching or storage. Feature-only helpers/state remain explicit feature inputs. Consumers destructure existing names and keep original scalar effect dependencies.

- [x] **Step 1: Freeze real consumers.** Check the 12 members against Stats/Alerts/Capacity and controls. Record every consuming symbol in the Ledger; do not add speculative members. A changed shared member set requires explaining actual consumers and updating its frozen test before hoisting.
- [x] **Step 2: Test and move.** SSR the hook and assert the exact 12-key contract. Move the Task 2 `useMemo` construction into the hook verbatim and call it at the same position. Add `Statistics shared scope preserves identity across mounted renders` in the smoke spec. The helper builds a small test-only React/createRoot IIFE importing the real hook, with stable synthetic values for all 12 inputs, a button that changes unrelated probe state, and a button that changes `selectedSprint`. Serve it on a synthetic routed page; expose only its returned object to the test. Assert the same object after the unrelated render and a new object with the new sprint after the member change. This fixture adds no production globals or test hooks. SSR alone cannot prove identity across renders.
- [x] **Step 3: Register, ratchet, gate and commit.** Run normal conservation and all per-mode/group/event baselines. No request, effect or bootstrap owner changes in this task.

## Task 8: Lazy-load Stats, Scenario and Settings with real retry

Commit message: `Lazy-load Statistics, Scenario and Settings with bounded recovery`

**Files:** Create `frontend/src/components/LazyViewBoundary.jsx`, `frontend/src/components/lazyViewLoaders.js`, `scripts/build_dashboard.mjs`, `tests/test_lazy_view_boundary.js`, `tests/test_lazy_view_loaders.js`, `tests/test_dashboard_split_build.js`. Modify `package.json`, `jira-dashboard.html`, `frontend/src/dashboard.jsx`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/epm_home_token_fixture.js`, generated dist, `README.md` and the approved runtime wording in `AGENTS.md`. Modify `backend/routes/performance_routes.py` and `tests/test_load_performance.py` only if the fingerprint check fails.

**Serving decision:** direct `file://` open ends under the recorded OAuth-only direction. This task does not implement Basic-auth extraction; keep `api/backendUrl.js` unchanged and list its fallback for follow-up. All three mounts stay inside `StatusColourProvider`. Hooks stay in the main composition; their data request behavior is compared against each mode's existing baseline.

**Build interface:** `node scripts/build_dashboard.mjs` builds once; `node scripts/build_dashboard.mjs --watch` serializes/debounces fresh builds. Preserve production build's minify/production define and watch's unminified/development define, with sourcemaps and the empty CSS loader in both. Add `format: 'esm'`, `splitting: true`, `outdir: 'frontend/dist'`, `chunkNames: 'chunks/[name]-[hash]'`, `metafile: true`, `write: false`. Keep dashboard as the single entry; its literal dynamic imports create the three hashed view chunks. Capture frontend source bytes once per generation. Compute `buildId` as SHA256 over the effective build mode/options, sorted repo-relative source paths plus those captured bytes, `package.json`, `package-lock.json`, and the helper's bytes; delimit path/content records and include no time or absolute path. Compile frontend JS/JSX/MJS/JSON through an esbuild `onLoad` plugin serving that same immutable snapshot with the original loader/resolve directory; never reread a source from disk under the captured ID. Keep CSS empty and dependencies resolved through the installed pinned packages. A frontend path outside the snapshot is an error, never an implicit disk fallback. Production and watch get different IDs even with identical source inputs. Define `__JEP_DASHBOARD_BUILD_ID__` into the bundle. The source loader uses `typeof __JEP_DASHBOARD_BUILD_ID__ === 'string' ? __JEP_DASHBOARD_BUILD_ID__ : 'source-probe'`, keeping existing IIFE fixtures executable.

From esbuild's metafile, require exactly one JS output for each expected dynamic entry and emit a manifest:

```json
{
  "schemaVersion": 1,
  "buildId": "the-computed-sha256",
  "views": {
    "stats": { "path": "chunks/StatsPanel-HASH.js", "exportName": "default" },
    "scenario": { "path": "chunks/ScenarioView-HASH.js", "exportName": "ScenarioView" },
    "settings": { "path": "chunks/SettingsModalContainer-HASH.js", "exportName": "default" }
  }
}
```

Here the ID and hashes are generated fields, not hand-authored literals. The filename is `frontend/dist/lazy-views-${buildId}.json`. Before any output write, recheck generation inputs and the dirty-generation counter; discard in-memory outputs and rerun if either changed during compilation. After a successful unchanged generation, write new chunks/maps and that manifest, then the entry/map; remove stale chunks/manifests as part of this successful publication of local build output. Never delete auth/CSS output. Failed builds retain the previous working output. Watch mode uses native Node file watching and fresh esbuild calls, recomputing the snapshot/ID/options on every rebuild; do not capture a fixed define once in `context.watch()`. Coalesce changes while building and rerun once after the current build if dirty. Changing helper/package inputs requires restarting watch; source edits are watched recursively. No build dependency is added.

**Loader interface:** `createLazyViewLoader({ viewId, initialLoad })` returns a stable `load(attempt)` function. Define the three functions at module scope in dashboard:

```js
const loadStatsView = createLazyViewLoader({ viewId: 'stats',
    initialLoad: () => import('./stats/StatsPanel.jsx') });
const loadScenarioView = createLazyViewLoader({ viewId: 'scenario',
    initialLoad: () => import('./scenario/ScenarioView.jsx').then(
        module => ({ default: module.ScenarioView })) });
const loadSettingsView = createLazyViewLoader({ viewId: 'settings',
    initialLoad: () => import('./settings/SettingsModalContainer.jsx') });
```

Attempt 0 uses that statically analyzable import. Cache a successfully resolved module in the stable loader, so later reopen does not revisit a previously failed original URL. For the single explicit retry, fetch only the mounted build's versioned manifest relative to the entry script (`id="dashboard-entry"`); cache its successful result. Validate schema, exact mounted ID, fixed view/export allowlists and the generated `chunks/<expected-view-name>-<hash>.js` same-origin path, rejecting traversal, absolute/external URLs and query/fragment content. Import the validated URL with a monotonically increasing `jep_retry` query using native `import(variableUrl)`, map the named Scenario export to default, and leave its relative shared-chunk imports unmodified. Missing or mismatched manifests are stale-build failures: show reload guidance and never fetch a latest manifest or import another deployment's graph. Keep raw asset `fetch` here; do not introduce an application API route/event. Pure manifest validation is exported for Node tests; actual import/error-boundary lifecycle is tested in Playwright.

**Boundary interface:** `LazyViewBoundary({ load, fallback, children })` receives a render function `children(View)`. It owns an attempt counter and memoizes `React.lazy(() => load(attempt))` by the stable loader/attempt, with a keyed inner class error boundary. Retry increments the attempt, replaces the lazy identity and remounts that error boundary; ordinary parent renders retain identity. Suspense renders the existing note-style fallback. The first retryable failure offers a native Retry button; the second failure or a stale-build error offers a sanitized “Reload the page to get the latest version” message. Never reload automatically. Preserve root state/interactivity and global auth-lock precedence.

```jsx
<LazyViewBoundary load={loadStatsView} fallback={statsLoadingFallback}>
    {View => <View {...statsPanelProps} />}
</LazyViewBoundary>
```

`statsLoadingFallback` reuses existing note markup; `statsPanelProps` is the explicit Task 3 contract. Scenario and Settings pass their existing props/children through the same render-function pattern at their current mount positions. No hook or draft owner moves into Suspense. Add a scoped Retry-button class in the existing component stylesheet only if required by the global button hover rules; if added, first add that stylesheet to the File Map and a settled hover-contrast assertion.

- [x] **Step 1: Inventory consumers and write unit/build tests; run red.** Scan committed-entry users, in-memory IIFE builds, packaging and fingerprinting. The IIFE fixtures keep normal initial imports inlined; only committed-build tests prove chunk behavior. Node tests prove manifest validation, original/default and named-export mapping, success caching, and stale-build failure. Boundary Node tests pin exported structure/attempt ownership and fallback markup; effects/errors are not tested by SSR alone. Build tests use a tiny synthetic project under ignored tmp and spawn the helper with that fixture as cwd: assert all three entries are mapped, stable bytes/ID across two identical builds, distinct production/watch IDs, changed ID/entry hash/manifest after a lazy source edit, cleanup, failed-build retention and serialized watch rebuilds. A deterministic build-module test holds compilation through a deferred injected build function, edits a lazy source, then releases it: no output for the stale generation is written, the next generation publishes the matching ID/graph, and concurrent builds never overlap. Export the build coordinator for this test and retain the normal CLI entry; no timing-based sleeps or production pause flags.
- [x] **Step 2: Implement builder and loader.** Set `build:js` to `node scripts/build_dashboard.mjs` and `watch:js` to `node scripts/build_dashboard.mjs --watch`; preserve auth/CSS scripts. Add the three literal loaders above, builder ID define and generated manifest. Set HTML to `<script id="dashboard-entry" type="module" src="frontend/dist/dashboard.js"></script>`. Route committed chunks and manifests from disk in `installDashboardShell`; strip query via URL pathname before validating/resolving a filename within dist. Browser fetch of a generated asset returns 200 through Flask's existing generic static route.
- [x] **Step 3: Implement boundary and wrap views.** Keep the loader functions stable outside App and default/named export mapping exact. Render each view through its boundary inside the provider, with state hooks still mounted above. Verify source-probe IIFE smoke tests still boot and committed ESM views actually request chunks.
- [x] **Step 4: Prove bounded recovery with committed assets.** Add `Statistics lazy Retry refetches its chunk after one abort`: intercept the actual StatsPanel chunk, observe one failed original request, one manifest read and a second chunk request carrying `jep_retry`; successful retry renders the panel and preserves a preexisting root Team selection/interactivity. Add `Statistics lazy failure twice offers reload guidance`: abort original and retry, observe both requests and no automatic reload/third request. Add `Statistics lazy recovery rejects a different build manifest`: return a mismatched ID/path and prove no newer graph is imported. Add malformed/path-traversal manifest negatives and a preserved root auth-lock case. These tests must use `useCommittedDist: true`; a single IIFE bundle cannot prove them.
- [x] **Step 5: Prove delayed DOM attachment.** Add `Statistics lazy Burndown mounts after data and scrolls to today`. Hold the Stats chunk until the synthetic Burndown response/model is ready, freeze the date inside the fixture sprint and release the chunk. Use an explicit test-only wide SVG fixture to ensure `scrollWidth > clientWidth + 2`, then assert a positive clamped scroll target `min(scrollWidth-clientWidth, max(0, todayX-clientWidth*0.6))`. Test-only geometry applies before chart attachment; production CSS stays unchanged. This proves the relocated DOM effect runs on mount rather than passing vacuously at zero.
- [x] **Step 6: Measure and verify fingerprinting.** Compare the Task 0 single-bundle raw/gzip bytes with the entry plus all transitively statically imported JS chunks at head; both totals must be smaller. Record first-open asset sizes separately. Compare API multiset/event baselines for the same modes/transitions; first-open Stats may retain its original API calls but splitting adds none. Change a lazy-view source in the synthetic build fixture and assert the mounted build ID, manifest filename and dashboard entry SHA all change. The ID is embedded in the entry, so the existing backend fingerprint should remain valid. If actual entry bytes fail to change, stop and add the narrowly scoped backend fingerprint fix plus `test_load_performance.py` coverage before continuing.
- [x] **Step 7: Register, docs, full browser gate and authorized commit.** Register the shared boundary/loader in the measured owner manifest through Task 0's explicit-file mechanism and update ontology. Update README's serving instructions. The runtime wording in preserved `AGENTS.md` section 10 needs prior operator authorization unless already granted during execution; present the exact one-line change, then apply it. Build twice and compare file lists/bytes before commit; inspect generated changes and run the full Chromium tests/ui campaign, including the explicit lazy tests. After the authorized generated-output commit, rebuild and require `make verify-dist-clean` to pass. The post-commit check must never be placed before the new dist is committed.

## Task 9: Close-out

Commit message: `Close the App decomposition plan and update the ontology`

- [ ] **Step 1: Final ratchet.** Each commit already ratcheted these; at head set the `dashboard.jsx` ceiling in `tests/test_codebase_structure_budgets.py` (`LEGACY_ENTRYPOINT_LINE_BUDGETS`) and `owner_budgets.json` (`dashboard.lineCount` and `lineCeiling`, 10855 at `cd2ae405`) to the exact measured line count, and `run.sh` `MAX_WARNINGS` (106 at `cd2ae405`) to the exact measured warning count, with no headroom; remove the growth-justification comments that no longer apply.
- [ ] **Step 2: Documentation.** Per-commit ontology updates already landed; finish `docs/ontology.md` (Statistics, Dashboard feature ownership, extraction verification, new owners with verified dates, coverage line), `docs/features/statistics.md` and `docs/plans/README.md` (the status stays `EXEC-` until the PR merges; the `DONE-` rename follows in a docs-only change, as #240 did for #220). Check every ontology path and symbol resolves.
- [ ] **Step 3: Remaining-App inventory.** Record what `App()` still owns (bootstrap, Sprint catalog, task loading, auth recovery, alert toggles) and the follow-up plan list: Basic-auth extraction (operator direction 2026-10-07), the now-unused non-http fallback in `frontend/src/api/backendUrl.js`, and the `renderEngModeControl`, EPM controls and Planning review field editor renderers left in `App()`.
- [ ] **Step 3b: Gate 3 comparison.** Re-run the `App render counts for common interactions` test three times at head and record min and max deltas next to the Task 0 baseline. Report them as numbers only.
- [ ] **Step 4: Final verification.** Run the per-commit Node/Python/build/lint checks under Node 20 and the active checkout's Python. Compare two pre-commit builds byte-for-byte. Run `fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes); run the opt-in hover/render probes with `JEP_RUNTIME_PROBE=1` and explicitly select all per-mode/group/event, scope-identity and `Statistics lazy` titles. List the selected tests before running; zero/missing required tests fails. Launch `.venv/bin/python jira_server.py` in this checkout and verify `/api/test`, with no dependency warning before the startup banner. When the existing environment uses DB storage, local Postgres must already be running and `alembic -c backend/db/alembic.ini current` must equal `heads`; do not upgrade the database without approval. If prerequisites are unavailable, report the server check as not run. Follow the authorized commit with a fresh build and `make verify-dist-clean`; record the exact verified head.
- [ ] **Step 5: Operator stop before push/PR.** Present Baseline Log and Gates 1–3, same-mode request multiset/event equality, raw/gzip initial-JS totals, retry outcomes, screenshots, `git log --oneline origin/main..HEAD` and `git diff --name-status origin/main...HEAD`. Record the already approved `AGENTS.md` runtime-line change and the end of `file://` direct open. Wait for explicit publication confirmation; approval must cover the exact commit list/count and paths.
- [ ] **Step 6: Publication transaction** per `AGENTS.md` section 10 and MRT025: fetch base, record base/head SHAs, compare the complete commit list/count and paths with the approved contract, and build/verify the exact proposed committed head. A changed base/head invalidates the prior evidence until rechecked. Push/create the PR only after confirmation, send the body through `gh pr create --body-file -` on stdin, read back the rendered body, visually inspect GitHub, prove remote head equality and changed-file/commit-count equality, and report actual CI state. PR notes include screenshots and no secrets, local paths or real issue keys. A failed post-publication check stops for operator direction.

## Acceptance Checklist

- [ ] Gate 1: `Stats chart hover does not re-render App` fails at the Task 0 commit and passes at head.
- [ ] Gate 2: each Catch Up, Planning and Stats-subview cold-load request multiset equals that mode's Task 0 baseline, including multiplicity and normalized bodies/query/header behavior. Same-scope warmed Stats reopening adds zero Stats requests. Group A → B → A restores its selections and preserves scope-specific baseline requests.
- [ ] Gate 3: before and after `App()` render counts reported as numbers for a filter change and a Stats view switch; no speed claim beyond them.
- [ ] Lazy-load: committed-ESM tests observe the failed original chunk, one mounted-build manifest request and a successful cache-busted retry with a fresh lazy identity. Two failures or a stale/malformed manifest show sanitized reload guidance; no automatic reload, extra API call/event or cross-build graph import occurs. Root selections/auth lock survive. Delayed Burndown attachment runs scroll-to-today on the synthetic overflowing chart.
- [ ] Initial JavaScript raw and gzip totals (entry plus transitively static JS imports, counted once) are both smaller than Task 0's single bundle. Builds have identical generated file lists/bytes when inputs match, lazy edits change the ID/entry fingerprint, failed builds preserve prior output and watch recomputes IDs. Post-commit rebuild passes `make verify-dist-clean` at the recorded head.
- [ ] Analytics guards, frozen positive Stats call pins and synthetic dataLayer event contracts pass. Designated orchestration source guards transfer ownership without permitting direct fetch/storage/credential ownership in Stats presentation or pure modules.
- [ ] Chart effects are the only two approved relocations; all other retained effect ordering passes conservation. The composite Alerts/Capacity return sets, explicit closure bindings, keyed Epic identity and 12-member scope identity are verified.
- [ ] Owner budgets, interface counts and aggregates equal measured values; `dashboard.jsx` ceiling ratcheted.
- [ ] Ontology (updated in every owner-moving commit), plan README, statistics feature doc, and the `file://` wording in `README.md` and `AGENTS.md` section 10 (approved before Task 8 edit) updated and verified.
- [ ] The File Map matches `git diff --name-status origin/main...HEAD`, or this plan records each divergence.

## Risks and Open Items

- **Effect order.** 90 effects; Stats effects interleave with non-Stats effects. Mitigation: Task 2 Step 1 ledger, layered hooks, conservation check.
- **Alerts and Stats coupling to the bootstrap** is intentional and recorded; the bootstrap plan owns the final move.
- **`burnoutTaskFilter` filters the visible task list**, so Stats and the task pipeline stay coupled through one setter.
- **Retry is bounded.** Native imports cache failures by URL, and React.lazy caches rejected promises; both identities change on Retry. Missing shared chunks or a removed mounted-build manifest require reload. The loader never substitutes a newer graph; committed-build failure/stale tests prove this boundary.
- **Static build writes are ordered, not a deployment mechanism.** A view open during a local rebuild may still encounter an old removed asset; reload guidance covers that case. Retaining multiple releases or atomic hosting deployment is outside this localhost build task.
- **`file://` ends.** Operator decision 2026-10-07 (OAuth-only direction). `README.md` and `AGENTS.md` section 10 change in Task 8; `resolveBackendUrl`'s non-http fallback stays and is listed for the follow-up plan. Basic-auth extraction is its own plan and is not started here: 117 files mention `JIRA_AUTH_MODE`, `jira_basic` or `home_townsquare_basic` at `cd2ae405`, 33 of them plans.
- **Line ranges drift** with every commit; re-measure at each task start.

## Stats interface ledger

Verified against the reviewed App ranges on 2026-10-08. These are identifier contracts, not an invitation to simplify expressions. Revalidate declarations and consumers at the synchronized Task 0 base. Imported React/model/API helpers remain imports; the sets below cover App/module-local free inputs. The 12 shared-scope members are supplied through `scope`, destructured under their existing names, and omitted as duplicate top-level props. Other inputs remain flat. Return keys must not be widened for testing.

### Layer A

Free inputs:

```text
BACKEND_URL activeGroupMissingComponents activeGroupTeamIds activeGroupTeamSet
adHocEpicSet adHocEpicSignature burnoutAssigneeFilter burnoutCacheRef burnoutData
capacityTasks cohortEndQuarter cohortStartQuarter excludedEpicSet getTeamInfo
groupPreferences isAllTeamsSelected isCompletedSprintSelected issueEditStateRef
issuePeopleStatsRevision normalizeEpicKey normalizeStatus perfCountersRef perfEnabled
selectedSprintInfo selectedTeamSet setBurnoutAssigneeFilter setBurnoutData
setBurnoutError setBurnoutLoading showStats statsView tasksFetched techProjectKeys
```

Returns:

```text
effectiveStatsData burnoutTaskTeamByIssueKey burnoutTaskStatusByIssueKey
burnoutIssueWeightByKey burnoutScopedTeamIds burnoutScopedTeamSignature
cohortScopedTeamSignature burnoutQueryKey cohortQueryKey
```

`statsTaskList` stays private to A. B consumes A's `burnoutQueryKey`, `burnoutScopedTeamIds`, `burnoutScopedTeamSignature`, `cohortQueryKey` and `cohortScopedTeamSignature`; C consumes the effective Stats data and the three issue maps.

### Layer B

Free inputs:

```text
BACKEND_URL EMPTY_ARRAY EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY activeGroup
activeGroupAdHocCapacityEpics activeGroupId activeGroupMissingComponents
activeGroupTeamIds adHocEpicSet adHocEpicSignature adminSettingsGate availableSprints
burnoutAssigneeFilter burnoutQueryKey burnoutScopedTeamIds burnoutScopedTeamSignature
cohortAssigneeFilter cohortCacheRef cohortData cohortEndQuarter cohortExcludeAdHoc
cohortExcludeCapacity cohortGroupBy cohortProjectFilter cohortQueryKey cohortScopedTeamSignature
cohortSelectedRow cohortStartQuarter cohortStatusToggles excludedCapacityCacheRef
excludedCapacityChartMode excludedCapacityData excludedCapacityEndSprintId
excludedCapacityEpicDropdownOpen excludedCapacityEpicDropdownRef excludedCapacityForceRefreshRef
excludedCapacityIsolatedTeam excludedCapacityRefreshNonce excludedCapacitySelectedEpicKeys
excludedCapacityStartSprintId excludedEpicSet groupPreferences isAllTeamsSelected
issueEditStateRef issuePeopleStatsRevision projectTrackCapacitySide projectTrackExcludeAdHoc
projectTrackExcludeExcludedCapacity projectTrackMode projectTrackPhaseAbortRef
projectTrackPhaseCacheRef projectTrackPhaseData selectedSprint selectedSprintInfo selectedTeamSet
setBurnoutTaskFilter setCohortAssigneeFilter setCohortData setCohortError setCohortLoading
setCohortProjectFilter setCohortSelectedRow setEffortSplitVisibleBuckets setExcludedCapacityData
setExcludedCapacityEndSprintId setExcludedCapacityEpicDropdownOpen setExcludedCapacityError
setExcludedCapacityIsolatedTeam setExcludedCapacityLoading setExcludedCapacitySelectedEpicKeys
setExcludedCapacityStartSprintId setProjectTrackPhaseData setProjectTrackPhaseError
setProjectTrackPhaseLoading showStats statsView teamNameById teamOptions techProjectKeys trackApiResult
```

Returns:

```text
cohortQuarterOptions cohortProjectOptions cohortAssigneeOptions cohortSummary
cohortWorkflowStatusTotal cohortGridModel cohortOpenBars cohortCompletedBars
cohortAverageLeadDays cohortMedianLeadDays cohortWarnings cohortStatusControls cohortSelectedRowLabel
excludedCapacitySprintOptions excludedCapacitySprintRange effortSplitSprintLabel
excludedCapacityEpicOptions projectTrackSeries projectTrackTotals projectTrackBreakdown
projectTrackColumnSplit projectTrackRangeLabel projectTrackPhaseEpics projectTrackPhaseSummary
excludedCapacityEpicCatalog excludedCapacityEffectiveFilters excludedCapacityFilterLabel
effortSplitRows excludedCapacityRows excludedCapacityLineSeries excludedCapacityModeOverall
excludedCapacityModeSprintRows excludedCapacityModeTeamLineSeries effortSplitTotals
excludedCapacityWarnings formatExcludedPoints toggleExcludedCapacityEpicKey
clearExcludedCapacityEpicSelection selectAllExcludedCapacityEpics toggleEffortSplitBucket
```

### Layer C

Task 2 free inputs:

```text
burndownMetric burnoutAssigneeFilter burnoutChartRef burnoutData burnoutIssueWeightByKey
burnoutTaskStatusByIssueKey burnoutTaskTeamByIssueKey effectivePriorityWeightMap effectiveStatsData
isAllTeamsSelected isBurnoutClosedStatus isCompletedSprintSelected priorityAxis priorityOrder
resolveStatsTeamColor selectedTeamSet showStats statsView teamNameById teamOptions
```

Task 2 returns:

```text
priorityTeamIds priorityRows priorityRadar statsTeamRows statsBarColumns statsTotals
burnoutAssigneeOptions burnoutChartModel burnoutTotals burndownMetricIsStoryPoints
formatBurndownValue resolveBurnoutPointer buildBurnoutTaskFilter canRenderStatsPanel isLeadTimesFocusMode
```

In Task 3 remove only `burnoutChartRef` from C's inputs and `resolveBurnoutPointer` from its returns when their ownership moves to the panel; the scroll effect leaves C at the same time. `priorityTeamIds` remains exposed to the Jira-link builder. `isLeadTimesFocusMode` remains exposed to the outer task-list rendering. `buildBurnoutTaskFilter` remains in C and feeds the external filter setter through the panel.

## Baseline Log

_Filled during Task 0 and updated at each commit with the measured numbers and command output summaries._

### Task 0 synchronized baseline (2026-10-08)

- Operator approved checkpoint, non-rewriting main integration and gated local task commits. Approved starting branch commits: `dc95f051`, `a9e46501`; revised-docs checkpoint `5f6f7295`; integration `d0f8bc79` incorporates fetched `origin/main` `1f161a29`. The only merge conflict was the ontology Coverage paragraph; combined both entries while preserving all document revisions. `git merge-base --is-ancestor origin/main HEAD` and clean status passed after integration. Push/PR require separate final confirmation.
- Task 0 base / `TASK_START_SHA`: `d0f8bc79071836df8ecdb3379b706eb8b16210c5`. Dashboard 10,855 lines; hook calls: State 168, Memo 181, Effect 90, Ref 90, Callback 34. Single dashboard bundle: 1,449,039 raw bytes and 415,062 gzip bytes (Python gzip, `mtime=0`).
- Node 20.20.0; Python 3.14.7 with OpenSSL 3.6.4. `fnm exec --using 20 npm ci` exited 0. All baseline commands ran on the integrated source before any tooling/test implementation.
- `fnm exec --using 20 node --test tests/test_*.js`: 1,995 passed, 0 failed. `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`: 2,128 tests, 29 skipped, OK, 133.826 seconds.
- `fnm exec --using 20 npm run build`: passed; generated bytes match upstream output. `make verify-dist-clean` passed after integration commit. Its pre-commit invocation saw expected staged upstream dist changes, so was not used as cleanliness evidence.
- `run.sh`: 106 warnings, 0 errors; owner budgets 69 modules, 0 problems; 36 destructure sites, 0 enforced problems, 34 informational, 0 baselined. `negative_controls.sh`: 66 tooling controls passed, 0 negative controls failed.
- Exact original nine smoke titles listed and passed (31.5 seconds). Chromium required authorized tool escalation after sandbox launch denial; no assertion had run in the denied attempt.
- Final browser gate: all twelve required titles passed (1.1 minutes), including A → B → A → B with both quarter endpoints, valid assignee selection before each switch and the approved reset to `all`, scoped requests, real point-click/Clear filtering and warmed reopening. The frozen group contract contains eight Stats calls: priority-config GET ×1, burnout POST ×2, cohort POST ×5.
- Gate 1 confirmed red before extraction: Priority hover increased App renders from 14 to 19. Three render measurements: filter change 7/7/7 (min 7, max 7); Stats view switch 2/2/2 (min 2, max 2).
- Independent Task 0 evidence before the completed group run: all 11 other positive browser cases passed (49.9 seconds); the strengthened Priority hover gate proves polygon/legend opacity changes before failing render equality, 14 → 21 in that run (the earlier 14 → 19 remains a recorded initial observation). Repeated query keys preserve their ordered values and have drop/reorder negatives. Analytics uses an isolated synthetic `performance.now` clock, preserving the typed duration bucket literals. Separate browser review approved those three corrections; the subsequent complete group run resolves its remaining coverage findings.
- Final tooling: `run.sh` passed with 106 warnings/0 errors; 69 owners, 0 budget problems; 36 destructure sites in 70 scanned modules, 0 enforced problems, 37 informational. Full negative controls: 100 passed (66 preserved + 34 added), 0 failed. New controls cover mixed inline/export-list pure omissions, named dashboard symbols and converging effect allowances. Unchanged conservation: 861/861 statements, 0 residual/0 new, 90 identical effects. Bounded tooling/analytics review is clean after corrections.
- Two final builds have identical file lists and byte contents (5 files); `make verify-dist-clean` passes against integration head because Task 0 has not changed production source. All pending changed paths match the File Map. Final Task 0 spec/quality review is clean: visible hover proof, exact query/event preservation, full two-group restoration and tooling negative controls are verified. The authorized checkpoint includes only the File Map safety nets/tooling/docs; production source and generated output are unchanged. Authorized checkpoint `7e18428c` passed `npm run build` and `make verify-dist-clean` at that exact head; `git show --stat` matches the twelve intended paths and the worktree was clean before Task 1 started.

- Frozen eight positive Stats analytics call expressions; focused source guards 32/32 passed. Frozen dataLayer interactions preserve the existing graph-mode no-event behavior, view changes, actual chart isolation/capacity-side actions, exclusion events and Lead Times no-event exclusion. Final Node suite: 1,996 passed; final Python suite: 2,128 tests, 29 skipped, OK (126.708 seconds).

- `GATE-05` remains unrelated and blocked, checked 2026-10-05, next review 2026-10-12; no mutation probe performed. Upstream instruction-template check could not retrieve the raw file (web cache miss / network DNS unavailable); no instruction update applied.


Pre-recorded at plan revalidation (2026-10-07, `origin/main` `cd2ae405`, run under Node 20): `dashboard.jsx` is 10,855 lines; `run.sh` exits 0 with `106 problems (0 errors, 106 warnings)`, `owner budgets: 69 modules; problems: 0` and `checked 36 destructure sites in 69 modules; enforced problems: 0; informational: 34; baselined: 0`; `negative_controls.sh` exits 0 with `tooling controls passed: 66` and `negative controls failed: 0`; the per-commit smoke `-g` regex matches 9 of 23 smoke tests and the Task 6 regex matches 3. Task 0 Step 1 re-records every value at its own base.

## Ledger

_Filled during Tasks 1, 2, 4, 5 and 7: measured inventories, effect classifications, interface tables and conservation residuals._

### Task 1 state/seam verification (2026-10-08)

- Base `7e18428cf3fa709066eff6f1706c78d7de40eb4d`. `useStatsState` owns 40 state pairs and seven refs, exposing 87 names. Flat values: `statsView`, `statsGraphMode`, `burnoutData`, `burnoutLoading`, `burnoutError`, `burnoutAssigneeFilter`, `burndownMetric`, `cohortData`, `cohortLoading`, `cohortError`, `cohortStartQuarter`, `cohortEndQuarter`, `cohortGroupBy`, `cohortProjectFilter`, `cohortAssigneeFilter`, `cohortExcludeAdHoc`, `cohortExcludeCapacity`, `cohortStatusToggles`, `cohortSelectedRow`, `excludedCapacityData`, `excludedCapacityLoading`, `excludedCapacityError`, `excludedCapacityStartSprintId`, `excludedCapacityEndSprintId`, `excludedCapacitySelectedEpicKeys`, `excludedCapacityChartMode`, `excludedCapacityMetric`, `effortSplitVisibleBuckets`, `excludedCapacityIsolatedTeam`, `excludedCapacityEpicDropdownOpen`, `excludedCapacityRefreshNonce`, `issuePeopleStatsRevision`, `projectTrackCapacitySide`, `projectTrackMode`, `projectTrackExcludeAdHoc`, `projectTrackExcludeExcludedCapacity`, `projectTrackPhaseData`, `projectTrackPhaseLoading`, `projectTrackPhaseError`, `burnoutTaskFilter`, plus each corresponding `set` + capitalized-name setter. Refs: `excludedCapacityEpicDropdownRef`, `projectTrackPhaseCacheRef`, `projectTrackPhaseAbortRef`, `burnoutCacheRef`, `cohortCacheRef`, `excludedCapacityCacheRef`, `excludedCapacityForceRefreshRef`.
- All five inputs are declared before the call; current-quarter initializers import the existing cohort utility and preserve timing. Group defaults/snapshot/application consume the first contiguous 19 keys at the original positions before Scenario and `hideExcludedStats`. The manifest records all remaining App readers: group persistence, Stats derivation/render, sprint range synchronization, external point filtering, issue-field invalidation and refresh paths. The revision setter, dropdown ref, cache/force-refresh refs remain externally available. Hover cells/chart ref, source-only derived flag and interleaved Board/Catch Up declarations stay App-owned.
- New seam/SSR tests failed before files existed, then passed 10/10; focused source/contracts 57/57. Full Node 2,006 passed; Python 2,128 tests, 29 skipped, OK (123.776 seconds). Exact twelve browser titles listed and passed (1.1 minutes), preserving mode/group requests, selections and analytics. Two builds have identical five-file lists/bytes.
- Final lint: 106 warnings/0 errors; 71 owners/0 budget problems; 37 destructure sites in 72 scanned modules, 0 enforced problems, 37 informational. App 10,855 → 10,802 lines; state owner 168, seam 114, Stats aggregate 282. Hook contract: five named inputs, 29 reviewed expanded members, 87 returns, no effects/getters. Manual alias inventory pins only the saved selected-Epic array and its existing map/filter normalization, with exact source digest. Unique owners 22,234; App plus owners 33,036. Warning ceiling remains 106.
- Conservation with both created owners and all four seam symbols: 861 → 889 statements, 8 removed/36 added residuals; 90 effects identical, no relocation allowance. Removed residuals: split combined nonce/revision declaration; group-clear wrapper; defaults wrapper; snapshot wrapper; application wrapper; assignee-invalidation wrapper; Refresh wrapper; Epic-refresh `clearAggregateSources` callback. Added residuals are those eight replacement call/wrappers, two split declarations, the state return, three seam object/destructure scaffolds, nineteen setter calls qualified through `setters` and three cache assignments qualified through `refs`. Original initializer expressions and setter/cache order are preserved; individual Story Points cache invalidation and force-refresh assignments are unchanged. No unexplained residual or effect change.
- Changed paths match the File Map. Final task spec/quality review is clean. Authorized checkpoint `13075f93` passed `npm run build` and `make verify-dist-clean` at that exact head; the thirteen changed paths and clean worktree were verified before Task 2 started.

### Task 2 data verification (2026-10-08)

- Base `13075f934a39d2fb3075ff19d3b394b366171a98`. Before-move ranges: A 4249–4493 (two effects), retained App hover 4495–4498, B 4500–5218 (thirteen effects), unchanged Scenario/auth/list 5219–5437, C 5438–5731 (one scroll effect). All free bindings in the frozen Stats interface ledger resolve before their layer calls; the exact twelve-member scope memo is created immediately before A. Counters, asynchronous read tokens, aborts/cancellation, cache keys, debounce timing, wrapper payloads and scalar dependencies retain their original expressions and evaluation positions.
- A/B/C contracts: 26/70/17 named inputs, 47/115/31 reviewed expanded members, 9/40/15 returns. A outputs feed B/C explicitly; layers do not call each other. The state/seam owners stay mounted, and the chart hover-reset effect stays in App between A and B. Scroll/pointer stay in C until Task 3. `requestExcludedCapacityStatsSource` remains imported from `engApi`; the other three wrappers remain in `statsApi`. Direct request/storage/credential bans remain across Stats, with only the three exact wrapper-module imports excluded from the data owner's original `/api/` substring ban.
- New interface tests failed before the module existed; final seven contracts and 382 focused source/contracts passed. Full Node 2,013 passed. All twelve browser titles listed and passed (1.1 minutes), preserving the literal same-mode/group request multisets, cached reopening and dataLayer records. Two builds produce identical five-file lists/bytes. The first concurrent browser run stopped before assertions on an erroneous import restoration; the corrected original runtime import and frozen source passed the complete rerun. Full Python rerun against the finalized manifest passed: 2,128 tests, 29 skipped, OK (124.889 seconds). Its earlier structural test saw stale registration and is not passing evidence.
- Lint: 106 warnings/0 errors, 72 owners/0 problems, 40 destructure sites in 73 scanned modules, 0 enforced problems, 37 informational. App 10,802 → 9,557 lines; data owner 1,345, Stats aggregate 1,627, unique owners 23,579, App plus owners 33,136. Both physical ceilings and interface counts equal measured values; warning ceiling remains 106.
- Conservation: 889 → 899 statements, zero removed/ten added, 90 effects identical, no relocation allowances. The ten additions are one shared scope memo, three App call/destructures, three hook scope destructures and three return literals. Existing statements all match. Source-guard edits are limited to four proven moved anchors; paths match the File Map. Final spec/quality review is clean after adding the pointer callback’s `burnoutChartRef.current.getBoundingClientRect` to C’s reviewed alias inventory (31 expanded members); production body unchanged. Staged new-file whitespace validation prevented the first checkpoint attempt; whitespace-only cleanup refreshed the three source digests/one-line physical aggregate difference, and sixteen focused contracts, conservation, lint and physical-budget checks passed. Both created files pass explicit new-file whitespace checks. The mistakenly invoked clean-build check after the prevented commit saw expected dirty dist and is excluded from evidence. Authorized checkpoint `3ccea324` passed `npm run build` and `make verify-dist-clean` at that exact head; all fourteen intended paths and a clean worktree were verified before Task 3 captures.

The following inventory digests hash space-joined Espree token values for the complete effect, including callback and dependencies. Source lines use the unchanged production body at `7e18428c`; Task 1 shifts positions only. Neighboring effects remain App-owned. Conservation independently compares the stricter type/raw-text token signatures. Task 3 must recompute its allowance digests with that checker algorithm; these inventory hashes do not authorize relocation.

| Owner | Source line | Dependencies | Inventory token-value SHA-256 |
| --- | --- | --- | --- |
| A | 4425 | `[ showStats, statsView, selectedSprintInfo?.name, tasksFetched, burnoutQueryKey, burnoutScopedTeamSignature, burnoutIssueKeysSignature, isCompletedSprintSelected, groupPreferences.onboardingRequired, issuePeopleStatsRevision ]` | `988f5433d52cc512868329441671b404e01df7c597feb9aff9e2481b7cd31e3f` |
| A | 4528 | `[burnoutData, burnoutAssigneeFilter]` | `51fbb264980c5c64848686a6570f01ce2918b8f797b7bc5c750455d59282d858` |
| App hover | 4546 | `[burnoutData, burnoutAssigneeFilter, statsView]` | `392c439833229ecc8759ed5163655c34961eeba6a3c3a55fb12fb661bf4e69fa` |
| B | 4551 | `[showStats, statsView]` | `221c8fcae66aea3f964945dec6a714d95fdeb4965f6efba2ffeba12c5bb2179d` |
| B | 4556 | `[selectedSprintInfo?.name, burnoutAssigneeFilter, burnoutQueryKey]` | `dd4901d5285041b826a2e726b1fa615e1dce7185d2934ea3fdc010e3e743d029` |
| B | 4560 | `[showStats, statsView, cohortStartQuarter, cohortEndQuarter, cohortQueryKey, cohortScopedTeamSignature, burnoutScopedTeamSignature, activeGroupMissingComponents, adHocEpicSignature, groupPreferences.onboardingRequired, adminSettingsGate.status, issuePeopleStatsRevision]` | `cb77f758023909ce67a40bdfa050b7496c70c22e28424a7c8a62e6b4e6801da3` |
| B | 4720 | `[cohortProjectFilter, cohortProjectOptions]` | `e366597351a62f48176223216a012e47d337d46adf946c7ec401df06a86a371c` |
| B | 4726 | `[cohortAssigneeFilter, cohortAssigneeOptions]` | `2d9369f3119cad39468b2f7ef3585e4098f8f4c392cb60ac52e61c9c0ebaee72` |
| B | 4732 | `[cohortGridModel, cohortSelectedRow]` | `b8a2091a6cea12382355eab53d0b6c0acb80bf8fedf3ceae9b88fbec3c628c5c` |
| B | 4746 | `[ excludedCapacitySprintOptions, excludedCapacityDefaultRange, excludedCapacityStartSprintId, excludedCapacityEndSprintId ]` | `b04f47b3c9f2f95d420402797183d537433ddcfffeaee28e76907e357d614f13` |
| B | 4820 | `[ showStats, statsView, excludedCapacityQueryKey, excludedCapacitySprintIdsSignature, excludedCapacityScopedTeamSignature, excludedCapacityEpicOptions, adHocEpicSignature, activeGroupId, activeGroupTeamIds.length, excludedCapacityRefreshNonce, groupPreferences.onboardingRequired, adminSettingsGate.status ]` | `1db9611a54cbd9e064daa9699da7d92042cdd5b01208a54ecb3898910d0f9093` |
| B | 5033 | `[ showStats, statsView, projectTrackMode, projectTrackPhaseSignature, ]` | `a934c1cc5e4dd7cc07cd654ef1ed7cdcafd831a2b19bc2c69cf5ee19c568c0c1` |
| B | 5110 | `[excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]` | `a11388ca392d22f59d994acc458fb77ec29027e5e6edcced9117b097c627e113` |
| B | 5115 | `[excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]` | `1843283958279a4d74f030017b491568e5d4589a29fd61a7ab849b4160b20f14` |
| B | 5220 | `[statsView, excludedCapacityChartMode, excludedCapacityIsolatedTeam, excludedCapacityIsolatedSeries]` | `cfd54473f13f113b2bf8b871f3e69c2ea74caa9d5001759bb0579f762dcc0a05` |
| B | 5259 | `[excludedCapacityEpicDropdownOpen]` | `bba9daea48cb27618533b671a6f2413bada1f30533aab4c3170a0fc3d0d9cb55` |
| App neighbor | 5314 | `[isFutureSprintSelected, showStats]` | `f5d6123af2db80a38c56c903110dc5bf18bf268d9a5925dc662f06e5fa1ca3d3` |
| App neighbor | 5333 | `[ planningScopeKey, activeGroupId, selectedSprint, teamSelectionScopeKey, isFutureSprintSelected, tasksFetched, productTasksLoading, techTasksLoading, selectionTasks, teamOptions, selectedTasks, selectedTeams, planningSelectionMode, activeGroupTeamIds.join('\|'), authResumeStagedRevision, planningAuthResumeLoadRevision, clearAuthResumeWhenSettled, ]` | `609487125d4631d9d4e7f9ec995e3f1bbaa82ad0eebdb5f112f26349e991aa85` |
| C | 5765 | `[burnoutChartModel, statsView]` | `d9cbc5b816c58ae55ffa5b09afd61af528e20ac8517a3e3bda932e456afe8169` |

### Approved interface/instruction decisions (2026-10-08)

Task 3's verified JSX consumes no member of the twelve-field shared ENG scope. `burnoutScopedTeamIds` is instead A's derived Stats output, and `burnoutData` is required by the unchanged panel hover-reset lifecycle. Proposed correction: carry both in `stats` and remove the unused `scope` prop from the panel's ten-prop interface. Operator approved this correction on 2026-10-08; the documented nine-prop signature now applies.

Task 3 Step 0's first DOM run selected two tests and failed both before writing artifacts: `excluded-capacity-sprint-start-listbox` is absent while its closed button retains `aria-controls`. `StatsRangeControl` always emits the reference and mounts the target only while open. The same baseline has eight exact pairs under `excluded-capacity-sprint`, `mono-cross-sprint`, `project-track-sprint`, and `lead-times-quarter` (Start/End). Proposed extension to the existing helper's capture contract: allow only these missing closed-listbox targets under exact group/button/end semantics, preserve the attributes, and add positive/negative tests while keeping unknown/open/duplicate/unrelated-reference rejection. Operator approved the narrow helper contract extension on 2026-10-08. Add its two files to the File Map and implement the characterized exception/tests before retrying capture; production remains unchanged. The next capture attempt exposed a fixture/helper hierarchy mismatch: the real range group contains `.view-filters` and `ControlField` wrappers above the dropdown. After the required two-failure stop, the operator approved matching that verified hierarchy on 2026-10-08 while retaining all exact ID, group, button, end and rejection checks.

Independent screenshot-only capture passed both selected tests (13.8 seconds) and produced eight settled before images: Teams, Burndown, Lead Times and Project Track at 1280/375 px. All were visually inspected. Existing 375px tab-label overlap and Teams table overflow are baseline observations, outside this refactor's scope. Smoke capture instrumentation is uncommitted; Step 0 remains incomplete until all seven DOM files are verified.

Task 8's required preserved section 10 runtime-line change was presented for prior operator approval: serve through Flask at `http://localhost:5050/` and state that direct `file://` opening is unsupported. Operator approved the exact line on 2026-10-08; apply it with Task 8.

### Task 8 consumer inventory correction (2026-10-08)

Verified against `13075f93`: the Docker frontend stage copies package files and `frontend/src` before building, so Task 8 must also copy its new helper at `scripts/build_dashboard.mjs`. Existing Scenario-view and Settings-container tests freeze the static imports/direct JSX that the approved lazy wiring replaces; they must follow the new owners while retaining exact prop/children/mount contracts. Added these three mechanical consumer updates to the File Map. Release packaging already includes `scripts` and all `frontend/dist` recursively; no release-workflow change is required. Backend fingerprint changes remain conditional on the actual entry-hash proof.

### Task 0 baseline decision (2026-10-08)

On the unchanged synchronized application, the A → B → A browser characterization restores the selected Burndown metric but resets a selected valid assignee to `all`. The existing effect at `dashboard.jsx` lines 4530–4544 resolves `burnoutData?.assignees || []` and resets any non-all selection while that list is empty, including scoped reloads. This contradicts Step 6a's requirement for a green restored-assignee baseline. No production source has been changed. Browser review also required both quarter endpoints and a second return to B to prove B restoration; the completed characterization verifies each. Operator chose to continue the behavior-preserving decomposition on 2026-10-08 after that choice was presented. Preserve and explicitly test the existing reset to `all`; fixing assignee restoration is separate scope. Both quarter endpoints/B-return coverage and downstream point-click/Clear assertions now pass in the twelve-test gate. No production fix is authorized or needed for this baseline.


## Implementation Readiness Review (2026-10-08)

**Initial verdict:** Required corrections before execution. Three independent reviewers checked Statistics/state/scope, ENG Alerts/Capacity/renderers, and lazy-loading/tooling/verification; their findings were checked against source. The revised tasks below close those contract gaps; implementation and its gates remain unexecuted. The resolution map distinguishes plan corrections from implementation proof.

**Final plan verdict (2026-10-08):** Ready to begin Task 0. The same three review scopes were rechecked against the revised contracts and current source; no remaining implementation-contract blockers were found. Re-review corrected an inaccurate `scopedTasks` description, explicit outside-root owner measurement/enforcement, production/watch ID separation, and the source-edit-during-build race. Task 0 base sync/baselines/tooling controls, all feature/browser/build gates and publication authorization remain required; this verdict does not claim implementation success.

**Reviewed revisions:** clean branch head `a9e46501`, whose application baseline is `da17de89`; fetched `origin/main` is `1f161a29`. Source line references below use the reviewed checkout unless another revision is named. Relevant current-main changes include `StatusColourProvider`; its existing plan constraint remains required. Task 0 must refresh measurements after integrating the intended base. Historical worktree/interpreter instructions must be checked against the active checkout, which currently has `.venv`.

### Resolution map

| Original finding | Revised execution contract |
| --- | --- |
| 1. Conservation cannot cover pure/components or moved effects | Task 0 implements explicit named owners and strict effect allowances before extraction; Task 3 names only the two chart relocations; copied parser-resolving command replaces the broken direct invocation |
| 2. Retry reuses rejected lazy/native-import identities | Task 8 creates a fresh lazy/error-boundary attempt and imports a query-distinct URL from the mounted build's versioned manifest; committed-ESM abort/retry/stale tests prove actual requests |
| 3. Cross-mode request set cannot establish parity | Task 0 freezes each mode/subview's own multiset, bodies/query/header behavior and same-scope cached reopening; those exact titles are in every gate |
| 4. Dist-clean check precedes generated commit | Two-build byte/file-list comparison precedes authorized commit; fresh build plus `make verify-dist-clean` follows it at the recorded head |
| 5. Chart scroll precedes lazy DOM attachment | Task 3 transfers chart DOM/ref/pointer/effect ownership together; Task 8 delays the chunk and proves a positive scroll target on a synthetic overflowing chart |
| 6. Epic component lacks sibling key | Task 6 puts `key={epicGroup.key}` on the returned component and proves identity after real reorder/filter on both layouts |
| 7. Source guards conflict with transferred ownership | Tasks 1–3 define a narrow data-owner exception, retain direct fetch/storage/credential bans, and include the analytics guard in the File Map |
| 8. Stats bootstrap keys span Scenario | Task 1 extracts only the contiguous 19-key seam and leaves `hideExcludedStats` at its original position; Task 0 freezes A → B → A and composed-key order |
| 9. Alert raw/post-filter outputs conflict | Task 4 nests unchanged filtering between production and grouping and freezes the 21 consumed outputs |
| 10. Capacity consumer/external interface is wrong | Task 5 names PlanningTeamCapacityCards, separate state/lifecycle call positions, both 20-name return sets and reset/refresh/hold consumers |
| 11. Interface checker cannot inventory free variables | Common binding-ledger procedure precedes each move; exact Stats inputs/returns are recorded above; interface tooling validates declarations after extraction |
| 12. Existing analytics checks lack Stats positive proof | Task 0 freezes Stats call expressions and synthetic dataLayer events; Task 3 transfers positive anchors and preserves Lead Times' no-event exclusion |

### Original findings (historical line references)

The findings below describe the pre-revision plan; their required changes are now incorporated through the resolution map. They are retained as audit evidence, not additional unresolved tasks.

1. **Blocker — The conservation gate cannot validate the planned owners.** The per-commit command (line 104) and Task 1 Step 7 (line 250) invoke the checker from `scripts/extraction_lint/` and pass pure `statsGroupState.js` as `--created-hook`. The parser is installed under `tmp/lint`, and [`run.sh:26-28`](../../scripts/extraction_lint/run.sh) copies the checkers there. The prescribed direct command fails with `ERR_MODULE_NOT_FOUND` for `espree`. Even from the configured directory, [`check_move_conservation.mjs:90-94`](../../scripts/extraction_lint/check_move_conservation.mjs) rejects owners without a `use*` function, including the pure seam and new components. Its effect traversal at lines 111-127 follows hook calls, not JSX; moving the hover-reset effect into `StatsPanel` also violates its identical-effect-sequence check at lines 150-159. **Required change:** use the configured checker path and define a checked procedure for pure functions and component moves before Task 1. Characterize intentional parent-to-child effect relocation explicitly. Add any checker changes and seeded negative controls to the File Map; omitting owners or ignoring unexplained differences is insufficient.

2. **Blocker — Retry has no defined way to reset a rejected lazy view.** Task 8's interface and Steps 2/4/5 (lines 346, 350, 352-353) promise that re-invoking `load` recovers a `React.lazy` child. React retains the rejection on that lazy identity ([installed React implementation, lines 460-513](../../node_modules/react/cjs/react.development.js)). A Node 20 probe confirmed that a successful second loader invocation leaves the original lazy identity throwing the same failure; a fresh lazy identity resolves. **Required change:** specify ownership and replacement of the lazy identity and reset of the error boundary, with stable identity between attempts. Prove actual browser module retry through the committed ESM build, including one-failure recovery and two-failure guidance; a synthetic Promise test alone is insufficient. Name the supported test harness for the boundary's interactive lifecycle.

3. **Blocker — Gate 2 requires an invalid cross-mode request baseline.** Task 0 Step 6 (line 222) and acceptance line 372 require one cold-load request set for Catch Up, Planning and Stats. [`dashboard.jsx:3937-3965`](../../frontend/src/dashboard.jsx) intentionally runs alert, missing-info and ready-to-close reads only in Catch Up; readiness is mode-gated at lines 3840-3855, and Burndown fetches are Stats-specific at lines 4424-4474. A unique method/path set also cannot detect duplicate requests or changed payloads. **Required change:** record separate baselines for each mode/subview and compare each before/after, including multiplicity and normalized query/body values. Define "no new requests" in Task 8 relative to the same baseline transition, rather than banning the existing first-open Stats reads. Give the new request test a name and explicitly include it in the per-commit command so the current `-g` regex cannot exclude it.

4. **Blocker — The clean-dist check runs before the state it requires exists.** Task 8 Step 7 (line 355) requires `make verify-dist-clean` before committing newly generated entry/chunk files. [`Makefile:28-34`](../../Makefile) fails on both modified and untracked dist output, which is the expected state then. The per-commit line 99 comment similarly conflates reproducibility with committed cleanliness. **Required change:** compare generated file lists and bytes across builds before commit; commit the verified generated output, then rebuild/check cleanliness at the exact committed head under the publication contract.

5. **P1 — Lazy Stats mounting can lose Burndown scroll positioning.** Tasks 2/8 retain data effects in `App()` while deferring the chart's mount. [`dashboard.jsx:5764-5779`](../../frontend/src/dashboard.jsx) reads `burnoutChartRef.current`, returns if absent, and depends only on `[burnoutChartModel, statsView]` (current-main lines 5765-5780). If data arrives before the chunk, the effect exits and child-only lazy resolution does not rerun it. **Required change:** specify a mount-aware handoff for this DOM effect, record the resulting effect-lifecycle exception, and add a committed-build test that delays the Stats chunk until data is ready and checks scroll-to-today on an overflowing chart.

6. **P1 — The new Epic component needs the existing list identity.** Task 6 (line 319) replaces the renderer's return with `<EpicBlock ... />`. Today [`dashboard.jsx:8322`](../../frontend/src/dashboard.jsx) keys the returned root, and [`EngView.jsx:143,147,152`](../../frontend/src/eng/EngView.jsx) inserts those returns directly into lists. A key left on an internal div cannot identify sibling components. **Required change:** explicitly return `<EpicBlock key={epicGroup.key} ... />` and verify filtering/reordering preserves the correct Epic's editor/readout and ref-map identity.

7. **P2 — Source-guard migration requires contract changes and one missing file.** The path-only migration rule (lines 82, 249, 256) cannot satisfy [`test_stats_module_extraction_source_guards.js:52-80`](../../tests/test_stats_module_extraction_source_guards.js): it bans `BACKEND_URL` in every Stats file and requires dashboard-owned request/cache symbols that Task 2 moves. Also, [`test_analytics_source_guards.js:231-245`](../../tests/test_analytics_source_guards.js) directly reads the Lead Times JSX that Task 3 moves; that file is absent from the explicit modify map. **Required change:** retain presentation/pure-helper prohibitions, explicitly permit orchestration only in the designated data owner through `statsApi`, and preserve negative guards against direct fetch, storage and credential/header ownership. Add the analytics guard to the modify map and migrate its positive owner anchor without dropping assertions.

8. **P2 — One Stats seam cannot preserve the promised interleaved bootstrap order.** Task 1 (lines 240-246) combines the main Stats keys and `hideExcludedStats` while requiring other keys/order to remain untouched. Scenario separates them in [`dashboard.jsx:2753-2755,2828-2830,2912-2914`](../../frontend/src/dashboard.jsx). **Required change:** preserve both insertion points or retain `hideExcludedStats` at its original position; pin the complete composed key/setter order. Add a synthetic Group A → Group B → Group A case with distinct Stats selections and expected request counts, since the planned relative-key/SSR checks do not prove restoration. No runtime defect from setter reordering alone was established.

9. **P2 — The Alert producer/filter interface contradicts the moved range.** Task 4 (lines 297-302) says the new hook only produces collections consumed by the existing filter hook, but also returns team lists/counts and moves the whole range. [`dashboard.jsx:7450-7471`](../../frontend/src/dashboard.jsx) calls `useEngAlertFilters`; the team groupings at lines 7473-7483 consume its filtered collections. **Required change:** specify the actual call composition and return set, choosing an unchanged nested filter call or explicit raw/post-filter layers. Pin call order and test narrowed filters against both team lists and counts.

10. **P2 — Capacity's documented consumer and external interface are incomplete.** The inventory (line 43) and Task 5 Step 1 (line 311) identify Settings as the `handleCapacitySaved` consumer. Its consumer is [`PlanningTeamCapacityCards` at dashboard.jsx:8829-8845](../../frontend/src/dashboard.jsx). External dependencies also include the reset setters at lines 1693-1696, config's `setCapacityEnabled` at 3549, and `capacityScopeHoldRef` supplied to `useEpicRefresh` at 8715. **Required change:** correct the consumer and freeze these external names in the hook interface. Keep Settings' capacity-mapping lifecycle distinct. The corresponding ontology consumer has been corrected during this review.

11. **P2 — The named interface tool does not inventory closure free variables.** Task 4 Step 1 and Task 6 Step 2 (lines 301, 322) rely on it to discover the current closures' dependencies. [`check_hook_interfaces.mjs:43-62`](../../scripts/extraction_lint/check_hook_interfaces.mjs) resolves top-level functions; its owner inventories measure declared inputs/returns, not the free variables of render closures inside `App()`. **Required change:** name a manual or explicit AST free-variable/caller inventory procedure before extraction, then validate the resulting owner interfaces with the existing checker.

12. **P2 — The stated analytics proof does not pin all moved Stats events.** The global analytics claim (line 16) relies on two tests. [`test_extraction_quirk_pins.js:5-13`](../../tests/test_extraction_quirk_pins.js) pins Scenario/Settings call counts; the analytics guards cover specific allowlists and exclusions, not every moved Stats trigger and payload. **Required change:** add positive Stats owner pins and before/after event assertions for representative view/filter/chart interactions, preserving canonical names and typed params. Keep the pure-refactor no-new-event allowlist reason; do not treat existing green tests as proof of full Stats event parity.

### Checked contracts and verification

- **Ownership and state:** the state-container approach is supported. Group-owned Stats cells, caches and excluded-dropdown state must stay mounted; only the identified chart hover cells are transient. Alerts toggles/dismissals remain in the bootstrap. Existing Capacity browser tests cover dirty drafts, conflicts, stale GET/PATCH settlements, aborts, retries and terminal auth recovery. Epic-header geometry coverage already exists for direct and initiative-grouped layouts in `tests/ui/eng_group_board_card.spec.js:557-768`.
- **Endpoint contracts:** this plan introduces no application API route or storage migration. Stats POST wrappers remain in `statsApi.js` with requested-with/tracked-fetch behavior; Capacity GET and user-OAuth PATCH remain in `capacityApi.js`, with CSRF on PATCH and global API-401 handling. The new chunk requests use the existing static `GET /frontend/dist/<path:filename>` route: JavaScript on 200 or an ordinary asset-load failure on a missing chunk. API auth, workspace boundaries, save/conflict payloads and request bodies must remain unchanged.
- **Gate scope:** `GATE-05-home-write-capability.md` remains blocked, checked 2026-10-05, next review 2026-10-12 (Europe/Berlin). This extraction adds no Home write path and does not depend on it; no mutation probe or gate edit was performed.
- **Actual checks:** Node 20 analytics/quirk tests passed 30/30; the ENG reviewer's focused capacity/alert/planning-action baseline passed 92/92; `.venv/bin/python tests/test_codebase_structure_budgets.py --manifest scripts/extraction_lint/owner_budgets.json` reported 0 problems; the prescribed smoke `--list` selected 9 tests. Direct conservation invocation failed on parser resolution; `node tmp/lint/check_move_conservation.mjs --base HEAD` passed the unchanged baseline with 861 statements, zero residuals and 90 identical effects. The read-only React probe demonstrated the cached rejection.
- **Revision validation:** reran the Node 20 analytics/quirk pair (30/30), owner budgets (0 problems) and smoke title listing (9 existing cases). `git diff --check` passed. All 34 concrete Modify paths exist, Create paths have no collisions, and the plan's local links resolve. The Statistics re-review independently verified the layer effect counts and both recorded effect digests against source. These checks validate the current baseline and document; proposed module tests remain execution work.

**Additional feasibility evidence:** an isolated synthetic Chromium module-import probe completed on 2026-10-08. The first URL failed, retrying the same URL failed without a second network request, and a query-distinct URL loaded successfully (`requests: 2`, exported synthetic value: 42). This supports the URL-change requirement; it does not prove the planned application boundary/manifest implementation. The earlier sandbox launch failure is superseded by this completed probe.

**Residual execution risks:** proposed files and migration tests do not yet exist, and current-main integration has not been performed. Full build, full Python/Node suites, application retry behavior and visual parity remain execution-time gates; they are not claimed as passed here. Bundle-size reduction and request/render preservation must be measured at the Task 0 base and final head. Base/source drift requires revalidation before moving code, and publication requires its separate authorization.


### Task 3 checkpoint verification — approved decisions (2026-10-08)

The panel owns three hover cells, its chart ref/pointer callback and exactly two unchanged chart effects. C now has zero effects/fourteen returns; A/B bodies and effects are unchanged. Nine SSR contracts and 91 focused Stats/data/analytics contracts pass. Seven before/after DOM files match; eight screenshot pairs are pixel-identical. The narrow helper controls pass, and independent spec/quality source review is clean. The finalized manifest preserves all 71 unchanged prior owner records and their order; 73 owners validate, 106 warnings/zero errors, 40 destructure sites in 74 modules, zero enforced problems/37 informational. App is 8,910 lines, Stats 2,529, unique owners 24,481, App plus owners 33,391.

Gate 1 passes at 1280×1100 with positive opacity/readout checks and unchanged scrolling: Priority 15 → 15, Burndown 21 → 21. Identical isolated geometry at accepted Task 2 fails 14 → 18. At the earlier 760-height viewport Playwright scrolled the legend into view, causing four shell renders; those diagnostic runs are not the accepted gate proof.

Full Node: 2,022 pass after transferring only the proven moved Statistics onboarding target assertion in `test_onboarding_tour_utils.js`. First full run had that single stale owner assertion (2,021 pass/one fail). Deterministic builds have five identical paths and bytes. No Task 3 commit yet; committed-head verification remains pending.

The operator approved all three following decisions on 2026-10-08 (“seems good, proceed, write down the decisions in the plan jic”). This authorization covers the exact corrections below; verification results remain separate from approval:

1. The plan requires removing `priorityHoverIndex` from the diagnostic snapshot and dependency array, while strict conservation requires retained effects to be identical. Original-base conservation recognizes exactly the two approved chart relocations but fails at the diagnostic effect. Independent review verifies only those two references are removed. Proposed procedure: record the raw failure, review the two diagnostic removals separately, then compare against a baseline copy containing only those removals, with the same two relocation allowances and no additional allowance/tooling change. Operator approved this exact diagnostic baseline procedure on 2026-10-08.
2. Full browser smoke: eleven pass/one fails at Project Track cached toggles. Diagnostic evidence shows the baseline was recorded before the existing 120 ms phase fetch debounce fired; the first phase POST starts 17 ms after that snapshot. B is token-identical to the accepted Task 2 source. Proposed correction: await the first phase request and populated phase rows/summary before recording the baseline, retaining the exact no-extra-request assertion for later toggles. The two-failure rule stopped further attempts; the operator approved the observable phase-data wait on 2026-10-08. Keep the no-extra-request assertion unchanged.
3. Full Python: 2,128 tests, 29 skipped, one failure in `test_board_cache_filter_is_applied_before_the_query_limit` (127.842 s). Its fixed 2026-09-08 timestamps are outside the unchanged 30-day retention window at the current session time. Proposed test-only scope addition: use current UTC time minus one minute and current UTC time, preserving ordering and assertions. Production retention behavior is unchanged. Operator approved the relative-time test fixtures and file-map extension on 2026-10-08.

Task 4 implementation remains blocked on acceptance of Task 3; its read-only inventory is prepared. No publication is authorized.


Task 3 approved-correction verification: the Project Track focused case passes after awaiting its first phase request and populated summary/row, with the cached-toggle no-request assertion unchanged. The corrected Python fixture case passes with all assertions unchanged. Adjusted conservation passes with the complete original owner coverage: 899 → 904 statements, three removed/eight added residuals; the removed/added C call and return drop only chart-ref/pointer ownership, App's return replaces the exact moved subtree with the explicit panel call, and five panel scaffolding statements destructure props/alias the setter/wrap the unchanged JSX. Exactly two chart relocations are printed; 88 retained App lifecycle effects are identical and two exact effects belong to the panel. Independent review verifies the adjusted baseline differs from the accepted source only in the two diagnostic lines, and all three immutable base-hook copies match their originals. No checker change or additional effect allowance.

The final twelve-title browser gate passes (12/12, 57.8 s), including request, analytics and group-state baselines. Full Node passes 2,022/2,022. Full Python rerun passes: 2,128 tests, 29 skipped, 123.221 s. Independent spec/quality review is clean. The authorized local Task 3 checkpoint is ready; its post-commit rebuild/clean-output check must pass before Task 4 implementation.

Task 3 checkpoint scope: the reviewed nineteen existing changed paths plus the two created panel/contract files match the approved File Map, including the proven onboarding guard transfer and approved relative-time fixture correction. Existing seven branch commits remain intact at base `1f161a29` and prior head `3ccea324`; no history rewriting or publication. Both created files pass explicit whitespace checks.

Task 3 accepted checkpoint `d754f1cb48c02d581d6ffd4c667c2c4ebf1183b1`: post-commit `npm run build` and `make verify-dist-clean` pass; all 21 intended paths and clean worktree verified. Task 4 starts from that exact head after Gate 1 passed.


### Task 4 checkpoint verification (2026-10-08)

Composite `useEngAlerts` moves the exact 447-line producer/filter/grouping block from accepted Task 3 `d754f1cb` with scope plus 28 explicit App inputs and exactly 21 returned names. No state, refs, effects, loading sources or endpoint changes; App retains toggles, dismissals, deferred callbacks, celebration and bootstrap handling. Only two mapped guards require positive source-owner transfers; the Epic-links guard remains unchanged.

Fifteen synthetic contracts pass after a review-driven test refinement: independent partial Status/Priority/Project Track/project, search and focused-Stats filters freeze all collection/group/keyset/count projections; fallback/replacement and unknown-Team/priority ordering cases remain. Initial reject-all cases did not meet the partial-filter acceptance requirement and were replaced before acceptance. Final independent spec/quality review is clean.

Verification: full Node 2,037/2,037; full Python 2,128 tests, 29 skipped, 124.193 s; the exact twelve smoke titles pass (58.2 s); three alert-specific UI specs pass all 49 cases (39.7 s). The initial sandboxed Chromium launch failed before application assertions; the authorized launch method passes. Two builds have five identical paths and bytes. Extraction lint: 106 warnings/zero errors, 74 registered owners/zero problems, 41 destructure sites in 75 modules, zero enforced/37 informational. All 73 existing owner records and roots are unchanged. App ceiling 8,477, ENG 475, Stats 2,529, unique owners 24,956, App plus owners 33,433.

Exact-base conservation: 904 → 907 statements, zero removed/three added. Additions are the App call/destructure, scope destructure and literal 21-key return. All existing statements match, 88 expanded App lifecycle effects remain identical, and the already-extracted panel effects are unchanged; no allowances or baseline adjustment. Created owner/test whitespace checks and ordinary diff checks pass. All twelve intended changed/created paths are covered by the File Map, including documentation of verified later-task guard/export compatibility transfers. No publication. The authorized Task 4 local checkpoint must pass its exact-head rebuild/clean-output proof before Task 5 implementation.

Task 4 accepted checkpoint `2c7e4bb32514152b131a0af55cfabddf90c26fa1`: post-commit build and `make verify-dist-clean` pass; all twelve intended paths and clean worktree verified. Task 5 starts from that exact head.


### Task 5 checkpoint verification (2026-10-08)

From accepted Task 4 `2c7e4bb3`, `useEngCapacityState` and `useEngCapacity` preserve the exact state and lifecycle ranges, their separate call positions, render-time ref assignments, two 20-name returns, and the single unchanged read effect. Lifecycle has scope plus 30 explicit inputs (56 reviewed expanded members); state has no inputs/effects. App retains enablement/config, search ref, group-reset/Refresh wiring, PATCH ownership and the `PlanningTeamCapacityCards` consumer. The unused deferred scroll helper moves unchanged with its actual closure inputs; no unrelated cleanup.

Full Node passes 2,042/2,042 after the two proven additional source-reader transfers; the first full run had 2,040 pass/two stale owner assertions. Three hold/pin and three Ad Hoc classification positives now read the explicit Capacity owner. All App mode/UI/write/analytics checks remain, and two forbidden-excluded-math checks now also inspect that positively anchored owner. Independent spec/quality/final-guard review is clean.

Full Python: 2,128 tests, 29 skipped, 124.874 s; exact twelve smoke cases pass (57.7 s); Capacity/Ad Hoc specs pass 33 cases; focused refresh passes five cases (19.9 s), with `--list` confirming both case-60 directions and cases 61/70/71. The controlled tests exercise initial atomic state, concrete totals, the real moved effect/reducers through the existing API binding, cancellation, stale settlement, failure, save and retry. Two builds have five identical paths and bytes. Lint: 106 warnings/zero errors, 75 owners/zero physical or interface problems; all 74 prior records and roots preserved. App ceiling 8,144; ENG 869; Stats 2,529; unique owners 25,350; App plus owners 33,494.

Exact-base conservation: 907 → 912 statements, zero removed/five added (two App call/destructures, scope destructure, two literal returns), 88 effects identical, no allowances. Initial malformed owner CLI separator was rejected before analysis, corrected to `#`; only the successful complete-owner run is verification evidence. Ordinary and created-file whitespace checks pass. The authorized local checkpoint must pass its exact-head rebuild/clean-output proof before Task 6 starts. No publication.

Task 5 accepted checkpoint `a29d657f80e459e8f5ab4398bbb98ae29f65e6dc`: post-commit build and `make verify-dist-clean` pass; all thirteen intended paths and clean worktree verified. Task 6 starts from that exact head. Its immutable-source inventory identified late `epicRefresh` initialization; construct the explicit Epic props bag after that initialization so the retained deferred renderer does not introduce a render-time TDZ.


### Task 6 checkpoint verification and decisions (2026-10-08)

From accepted Task 5 `a29d657f`, five control components and EpicBlock preserve the six original renderer bodies token-for-token. Retain the old small App adapters and all surface arguments; do not add memoization or move state/effects. EpicBlock receives the sibling key and exactly 65 App bindings plus epicGroup. Construct its props bag after epicRefresh initialization; the earlier deferred adapter remains safe. The three specified remaining closure renderers stay in App.

Independent specification, quality and final guard review are clean. Full Node: 2,057/2,057 passed; the initial run had six stale-owner failures, repaired by transferring only verified positive anchors in five mapped files. Closed icon/status inventories, App negatives, subtask hook/clear wiring and endpoint exclusions remain enforced. Focused final guard repairs: 103/103 passed. Full Python: 2,128 tests, 29 skipped, 190.118 s. Original twelve smoke cases passed in 1.0 minute. All twelve executable epic-header specs ran: 446 passed, four skipped, no failures (6.8 minutes); focused synthetic capture and keyed identity cases passed separately.

Eight before/after DOM captures match exactly. Seven screenshot pairs are byte-identical; compact Group has only thirteen antialiasing pixels with maximum channel delta one, visually unchanged after settled screenshot inspection. Direct and initiative-grouped tests prove real order reversal and sibling filtering retain the surviving Epic DOM/link identity, focus and ref-map behavior. No user-visible or analytics event change.

Two builds have five identical paths and bytes. Lint remains 106 warnings, zero errors; 77 registered owners, zero enforced physical/interface problems. All 75 prior owner records, ordering and roots remain unchanged. App ceiling 7,599; ENG 1,743; Stats 2,529; unique owners 26,224; App plus owners 33,823. Exact-base conservation: 912 → 940 statements, six old closure declarations removed and 34 adapter/props/component scaffolding statements added; original executable bodies match, 88 effects are identical and no relocation allowance is used. All residuals reviewed. The 21 intended paths match the File Map. Local checkpoint only; publication remains gated by final operator approval.

Task 6 accepted checkpoint `46aa831ae82a60615ec784f2a41433d64d0bb242`: post-commit build and `make verify-dist-clean` pass; all 21 intended paths and clean worktree verified. Task 7 starts from that exact head.


### Task 8 registration readiness decision (2026-10-08)

Verified at accepted Task 6 `46aa831a`: the existing explicit-file mechanism supports `components.LazyViewBoundary` and `components.lazyViewLoaders` outside the unchanged scenario/settings/epm roots. Register both with existing scenario/settings/stats features, counting each file in those feature totals and once in unique owners. No new feature, discovery root or checker expansion is needed. Pure loader exports are enforced; an empty interfaces array is faithful to the current JSX/hook interface parser, with behavior covered by loader contracts. The added StatsPanel default alias retains its named export and receives the parser-supported measured default interface. Dynamic lazy render-function calls are outside static caller inference; the mapped exact prop/children/mount contracts and committed-browser lifecycle tests provide their verification. Revalidate measurements at accepted Task 7 before implementation.


### Task 7 shared-scope ledger and verification (2026-10-08)

At accepted Task 6 `46aa831a`, move only the existing memo construction into `useEngScope` at its unchanged call position after adHocEpicSignature. Preserve the exact ordered twelve keys and scalar dependencies; no added state, effects, fetch, storage or speculative member. All five consumers receive the same scope binding. Controls/Epic retain explicit scalar props; StatsPanel receives no scope.

| Scope member | Verified consuming owners |
| --- | --- |
| `activeGroupId` | `useStatsDerivedB`, `useEngCapacity` |
| `selectedSprint` | `useStatsDerivedB`, `useEngAlerts` |
| `selectedSprintInfo` | `useStatsDerivedA`, `useStatsDerivedB`, `useEngAlerts`, `useEngCapacity` |
| `isAllTeamsSelected` | `useStatsDerivedA`, `useStatsDerivedB`, `useStatsDerivedC`, `useEngAlerts`, `useEngCapacity` |
| `selectedTeamSet` | `useStatsDerivedA`, `useStatsDerivedB`, `useStatsDerivedC`, `useEngAlerts`, `useEngCapacity` |
| `teamNameById` | `useStatsDerivedB`, `useStatsDerivedC`, `useEngAlerts` |
| `teamOptions` | `useStatsDerivedB`, `useStatsDerivedC`, `useEngCapacity` |
| `capacityTasks` | `useStatsDerivedA`, `useEngCapacity` |
| `techProjectKeys` | `useStatsDerivedA`, `useStatsDerivedB`, `useEngAlerts`, `useEngCapacity` |
| `excludedEpicSet` | `useStatsDerivedA`, `useStatsDerivedB`, `useEngCapacity` |
| `adHocEpicSet` | `useStatsDerivedA`, `useStatsDerivedB`, `useEngCapacity` |
| `adHocEpicSignature` | `useStatsDerivedA`, `useStatsDerivedB`, `useEngCapacity` |

Frozen SSR checks preserve all input references and reject an extra property. The separate synthetic mounted React probe proves unchanged identity after unrelated state, changed identity/value after selectedSprint, and the other eleven references unchanged. True twelve-key fresh-object and missing-Sprint-dependency mutants fail their intended identity checks; the extra-key mutant fails SSR. No production global or dashboard instrumentation added. Focused contracts: 29 passed; mounted identity: one passed.

Full Node passes 2,059/2,059. All fourteen selected browser cases pass in 59.2 s: original twelve baselines, scope identity and positive hover isolation (Priority 14→14, Burndown 20→20). Two builds have five identical paths and bytes. Lint: 106 warnings, zero errors; 78 owners, zero enforced physical/interface problems. All 77 prior records/order/roots remain exact. App 7,600 lines (one added import), scope hook nine; ENG 1,752, Stats 2,529, unique owners 26,233, App plus owners 33,833. The existing digest-reviewed memo-return inventory records the twelve names; the parser's unresolved memo return remains faithfully measured rather than expanding tooling.

Exact-base conservation: 940→941 statements, one old memo declaration removed and two call/return statements added; original memo tokens and all 88 effects identical, no allowances. Full Python passes: 2,128 tests, 29 skipped, 123.757 s. Independent specification and quality review passes with no findings. Authorized local checkpoint pending committed rebuild; no publication.

Task 7 accepted checkpoint `e745f60124e7cd1ed7bf3c67c587924bac5dbce2`: post-commit build and `make verify-dist-clean` pass; all twelve intended paths and clean worktree verified. Task 8 starts from that exact head.


### Task 8 builder review corrections (2026-10-08)

Independent builder review requires three corrections before acceptance: observed source changes must invalidate the active generation immediately, with debounce governing idle scheduling and no redundant covered rebuild; publication/cleanup failures must restore the previous working output under the existing failed-build retention contract; stale-chunk tests must name the changed view's old manifest path and prove it is gone, rather than testing an already-absent subset. Implement deterministic watcher/timer and injected publication-failure checks. These fulfill the approved contract; no retention narrowing, new dependency or deployment mechanism is approved. Source/build tests are unfrozen for the bounded repair, then both build and view integration must freeze before full gates.


Task 8 builder repair review passes specification and quality. Watch events now invalidate immediately; deterministic injected watcher/timer tests prove A→B→A changes discard the old generation and idle bursts coalesce. Staged publication and tracked rollback restore the complete prior output map after injected staging, entry-map promotion, stale cleanup and staging cleanup failures; rollback errors are surfaced together with the original error. All nine build tests pass. A cleanup-disabled negative control fails at the explicit old Stats chunk assertion. This is ordered local publication with failure recovery, not a cross-filesystem atomic deployment guarantee.

The approved section 10 runtime wording is applied exactly, with README serving instructions and the module script entry updated. Retry reuses the existing compact secondary button, so no new stylesheet or global hover override is introduced. All existing root/feature state remains above the lazy boundary; global auth-lock precedence and manifest/path failures are exercised with committed assets. Final integrated measurements, gates and review are still pending.

Task 8 first full Node run: 2,074 passed, one failed because the generic native API-fetch scan classified the approved static manifest fetch as an application request. Repair only the verified single expression at the positively anchored lazy owner, retaining all API ownership/endpoint negatives and rejecting additional fetches; no production change.


Task 8 integration and bounded static-fetch guard review pass specification and quality. Full Node rerun passes 2,076/2,076, including the narrow asset-fetch guard and its mutation controls. Parent build repetition matches all twenty paths/bytes; lint remains 106 warnings, zero errors, 80 owners and no enforced budget/interface problems.

The first concurrent full Python run completed 2,128 tests with 29 skips and one subprocess timeout in the unchanged local PostgreSQL runner test (`test_replacement_escalates_when_first_runner_cannot_handle_term`, 15-second communicate limit); total 274.093 s. No runner/test timeout or production behavior is changed. Re-run the affected case and full Python gate after the browser workload settles. The first full Chromium campaign also has an auth-focus request-order failure under independent baseline diagnosis; neither full gate is claimed passed.

Independent auth-focus diagnosis reproduced the same failure with accepted Task 7 App bytes and unchanged owner imports. The native Refresh button was enabled; task loads begin immediately, while Sprint controller scheduling uses a microtask. Waiting only for a task request can snapshot before the already-required forced Sprint request appears. Correct the test to wait jointly for both required paths before its existing assertions; no startup, request, controller or production timing changes.


The explicitly listed 22 required Task 8 browser titles pass together (1.3 minutes): original twelve request/group/event/mode baselines, mounted scope identity, opt-in hover isolation, and all eight committed lazy cases. Final initial entry plus four unique transitively static JS chunks totals 1,384,752 raw / 401,793 gzip bytes against Task 0 1,449,039 / 415,062; additional first-open Stats 77,131 / 19,447, Scenario 24,119 / 6,692 and Settings 5,346 / 1,741. Lazy-only fixture edits invalidate build ID, manifest filename and entry SHA; no backend fingerprint change is needed.

Task 8 measured ownership: App 7,616 lines, 80 owners; Scenario 5,715, Settings 16,439, Stats 2,632, ENG 1,752, unique owners 26,336, App plus owners 33,952. Wider complete-owner conservation covers 70 function-block modules and retains 153 identical effects, including the earlier 88-effect Stats/ENG ledger. Ten parser-ineligible untouched pure files are verified byte-identical. One old App JSX statement is replaced by three boundary wrappers; 23 additions comprise boundary/loader scaffolding and recovery helpers. No allowances, original state/data/model changes or checker expansion. Class methods/module-scope loaders are directly reviewed and covered by committed browser cases.

Two full-campaign onboarding failures share the initial fixture readiness wait: auto-started tour intentionally hides the background from accessible role queries, so an already-visible Catch Up control disappears from getByRole lookup before readiness settles. The stale-tuple case passes unchanged in isolation and passed Task 6. Use visible DOM control readiness for this bootstrap wait; keep production accessibility, tour behavior, bridge/read-only/analytics assertions unchanged.


The first full Chromium campaign completed: 1,307 passed, eight skipped, three failures (10.7 minutes), all in the two diagnosed fixture synchronization paths. Auth-focus joint-path fix passes the exact case; onboarding visible-DOM readiness fix passes five selected cases, including both original failures and destination/revisit controls. All application, owner-bridge, read-only and analytics assertions remain unchanged. No production or generated bytes changed for these repairs. Independent bounded review and full frozen reruns precede the local Task 8 checkpoint.


Independent final fixture review passes specification/quality. The frozen full Node gate passes 2,076/2,076 again. All 33 unchanged local PostgreSQL runner tests pass in 82.472 s without the browser workload; full Python rerun follows. Flask test-client static-route verification in the existing Basic/JSON unit-test profile returns HTTP 200 with exact disk bytes and correct MIME for the mounted manifest and all three view chunks, including retry queries. This is static-route proof, not a running DB/OAuth server or authenticated `/api/test` result.


Task 8 frozen full Python rerun passes: 2,128 tests, 29 skipped, 126.802 s. The unchanged subprocess timeout does not recur after the concurrent browser workload settles. Root visually inspected the settled synthetic Retry-before/Statistics-after pair: readable existing compact button, retained Alpha Team selection and normal panel restoration. Complete Chromium rerun with the reviewed fixture fixes is the final pending gate before Task 8 checkpoint.


Task 8 final full Chromium campaign passes: 1,310 passed, eight skipped, no failures (10.0 minutes). All baseline, recovery, auth, Planning, Scenario and Settings cases run at the frozen source/test state. All six created source/test files pass explicit whitespace validation; ordinary diff checks pass. Forty-three checkpoint paths (including fifteen generated chunk/map/manifest additions) match the File Map. The reviewed original failure runs remain recorded above; no application behavior, timeout or assertion was suppressed. Local checkpoint must pass committed rebuild/clean-output proof before Task 9 edits. No publication.
