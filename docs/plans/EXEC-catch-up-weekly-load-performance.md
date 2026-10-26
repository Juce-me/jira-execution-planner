# Catch Up Weekly Load Performance Implementation Plan

> **Status:** Planned on 2026-10-25 from `origin/main` at `57601293` on branch `feature/catch-up-weekly-load-performance` (no issue number was supplied; rename the branch to `feature/<issue>-catch-up-weekly-load-performance` if one exists). Revised the same day after four independent reviews (metrics and definition of done, backend and data, frontend and project rules, contract and execution safety); every finding folded in was checked against the code first. Executed locally on 2026-10-26 (Tasks 0-4, subagent-driven); not pushed, no PR, awaiting the requester's review and confirmation of the calls. This plan is its own design record (no separate spec file).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings -> Admin -> Performance shows, for Surface `eng_sprint` (Catch Up), two weekly line charts of average, median and p95: "List loaded" (the slower of the Product and Tech lane) and "Fully loaded" (the whole load including dependencies), so the weekly trend is visible the way the Board's weekly view shows it.

**Architecture:** `load_report` gains a derived `catchUpWeekly` value computed server-side over every scanned row (not the 200 returned samples), grouped by UTC Monday like the Board's `_weekly`. A new `PerformanceCatchUpWeeks` component renders it with the Board weekly chart grammar (native-button legend, in-app pointer-positioned readout via `resolveFloatingHoverPosition`, `niceMaximum` axis, 2s/4s references). `PerformanceSettings` renders it in place of the daily chart when Surface is `eng_sprint`. No schema change, no migration, no new route, no new measurement.

**Tech Stack:** Python 3.10+ / SQLAlchemy / unittest; React 19 ES modules; Node 20 `node --test`; Playwright; esbuild; CSS.

**Spec:** this document's "Decisions", "Expected behavior", "Definition of Done" and "Global Constraints" sections.

## Why (evidence from the 2026-10-25 production HAR and the Performance panel)

- Catch Up has only a daily average/p95 chart (`PerformanceTrend`); no median and no weekly view. The Board has a weekly view (`PerformanceBoardWeeks`).
- In the HAR sample `durationMs` is 8236 ms, of which the dependency tail is 7515 ms; the two lanes took 286 ms and 526 ms, so List loaded is 526 ms and Fully loaded 8236 ms. `firstContentMs` (467 ms) records only the first lane, so a slow second lane is hidden. Plotting the two numbers separately makes each trend visible.
- Both numbers start at the data requests (3.39 s into the page in the HAR) and the lane clock stops at JSON parse, before apply and paint. The roughly 3.4 s of bootstrap (JS download, config chain) and the 6.3 s `story-readiness` call are in neither number. The chart copy says so. Speed-ups (compression, early API prefetch, dependency and readiness parallelisation) and a page-start-to-list metric are separate efforts (parked in `docs/TODO.md` by Task 4).

## Decisions

Made by the requester (2026-10-25): plot both List loaded (slowest of the Product/Tech lane) and Fully loaded; weekly average, median and p95 lines; keep 30-day retention (`RETENTION_DAYS` stays 30, so at most six calendar weeks).

My calls (the requester may override each; none is an agreement):

1. The weekly charts replace the daily average/p95 chart only when Surface is `eng_sprint`, as the Board's weekly view replaced it for `eng_board`. Surface "All" keeps the daily chart and every existing line. The new graph therefore needs the raw Surface value `eng_sprint` to be picked, exactly as the Board's needs `eng_board`.
2. Series: Average (blue, circle), Median (green, square), p95 (purple, diamond, the same shape as the Board's p95 key). Colour and shape both carry the series, in the chart and in the legend swatch.
3. The 2s target and 4s SLO references are drawn on both charts, as on the Board chart.
4. List loaded counts a load once both lists have arrived, even when the dependency request later failed or the user left during the dependency tail. `createGroupLoadMeasurement.finish` records those as `error` or `cancelled`; counting only `success` would blank List loaded whenever `/api/dependencies` fails and would bias p95 low (people leave during a 7 s tail). Fully loaded counts successful loads only.
5. Weeks blend revisions, cache states, Sprints and Groups on purpose (a trend across deploys is the point); the filters narrow the rows first. Because every Catch Up row has a NULL `cache_state` column, the Cache filter lists Board values only, so it is not offered as the remedy; a per-week cache-hit share is shown instead.
6. No week selection or drill-down; the existing "Recent load evidence" list stays below the charts. The Board has a selected-week summary and drill-down; this is a deliberate difference.
7. A week with loads but none qualifying for a metric still appears (zero counts, no marker) so an outage week is visible; capped loads (a lane at 250 issues or more) are counted per week but never enter the percentiles.
8. For Surface `eng_sprint` the existing "Choose one surface, scope, cache, revision and configuration cohort ..." notice is not shown above the weekly charts, because the weekly view blends cohorts by design. Every other legacy line stays.
9. Headings keep the requester's names ("List loaded", "Fully loaded"); the bootstrap and parse-only caveats live in the notes under each chart.
10. A new line-chart component instead of `ExcludedCapacityLineChart` (its API is Team, Sprint and percent specific) and instead of extracting a shared frame from `PerformanceBoardWeeks` (that would change the Board file and its registered digest); the Board's constants are reused by import.

Accepted limitations: at a 390 px viewport the chart text scales to about 4 px, exactly as the Board chart does (the weekly table is the readable fallback); the readout is 260 px wide because the shared Board bubble class fixes it; tapping a week shows the readout and tapping elsewhere does not dismiss it (Board parity); the daily `trend` and the samples' `recordedAt` carry the same non-UTC database-session exposure that Task 1 fixes only inside `_week_start` (parked in `docs/TODO.md`).

## Expected behavior

- Surface Catch Up shows two charts, "List loaded, by week" and "Fully loaded, by week"; each has Average, Median and p95 lines with a marker per week, the 2s target and 4s SLO references, one shared legend and a hover or tap readout; below them a weekly table with exact values and the explanatory notes; then the unchanged evidence list.
- A week's numbers come from the stored observations of the current selection (Group, Sprint, Cache, Revision filters apply first); weeks are UTC Monday weeks, oldest first, at most six.
- List loaded = the slower of the Product and Tech lane duration, once both lanes returned a body. Fully loaded = the whole load duration of a successful, non-capped load.
- Surface "All" and Board render exactly as before.

## Definition of Done

Each item is checked by the task named.

1. Surface `eng_sprint` shows both charts with Average, Median and p95 per UTC Monday week and the 2s/4s references (T2 unit, T3 browser).
2. The server returns `catchUpWeekly.weeks` with exactly the contract keys, oldest first, computed over every scanned row, with `round(sum/n, 2)` averages and linear-interpolated percentiles (T1).
3. List loaded and Fully loaded are defined as above in code, UI copy and `docs/ontology.md`; the copy states what is excluded (app start, readiness, alerts, paint of the slower lane) (T1, T2, T4).
4. List loaded does not depend on the dependency outcome; a lane that failed or was aborted never counts (T1).
5. Every week reports its list and full load counts, errors, cancelled and capped counts and cache-hit share, including weeks with no qualifying load (T1, T2).
6. Retention stays 30 days; the current week and any week that starts before the retention window or follows a truncated scan are marked partial (starred) (T1, T2).
7. A week with fewer than 20 loads is marked preliminary in the readout and notes (T2, T3).
8. Weeks are UTC even when the database session is not (T1).
9. The renderer accepts the server's exact key set, pinned on both sides (T1, T2).
10. Chart geometry: no clipped text or marks and no sideways page scroll at 1000 px and 390 px with six weeks; the readout stays inside the viewport, above the settings layer, and a tap opens it; legend isolation dims lines and markers in both charts (T3).
11. Admin-only and workspace-scoped: a non-admin gets 403 without the key; another workspace sees `weeks: []` (T1).
12. Surface "All", the Board view and the daily chart are unchanged (T3, T4).
13. No client emission, schema, route, analytics event, Jira call or credential change; the final diff touches only File Map paths (T2 source guard, T4 diff check).
14. Full Python suite, `make test-security`, full frontend unit suite, the Chromium `load_performance` and `design_system_hover_surfaces` specs pass against the Task 0 baseline; the extraction lint shows no new problem identity and no more ESLint warnings than baseline; `frontend/dist` rebuilt and committed; docs updated (T0, T4).
15. A cross-layer acceptance run feeds real `load_report` output into the real component and the table matches the server numbers (T4).
16. The requester has seen the calls under "My calls" (hand-off in T4 step 5).

## Forbidden regressions

Board weekly behaviour (apart from the UTC normalisation in `_week_start`, which changes output only if the database session is not UTC); Surface "All" layout and daily chart; `RETENTION_DAYS` and `QUERY_LIMIT`; `validate_load`, `TOP_KEYS`, `LANE_KEYS`; what the client records (`frontend/src/eng/loadPerformance.js`); admin-only access and workspace scoping of `/api/admin/performance`; any Jira request or write; any analytics event.

## Global Constraints

Every task's requirements include this section.

- Retention: `RETENTION_DAYS = 30` and `QUERY_LIMIT = 10000` are not edited. No new stored field and no change to what the client sends.
- Row rules (all rows are `surface == 'eng_sprint'`):
  - **List-eligible:** outcome `success`, `error` or `cancelled`; lanes include both `product` and `tech`, each with a finite int/float (not bool) `durationMs` and `payloadBytes > 0` (a failed or aborted lane is recorded with `payloadBytes` 0); no lane has `completeness == 'capped'`. List value = the larger of the two lane `durationMs`.
  - **Full-eligible:** outcome `success`, no capped lane, finite numeric `duration_ms`. Full value = `duration_ms`.
  - `errors` and `cancelled` count rows by outcome and `capped` counts rows with a capped lane, whether or not eligible; the counts overlap with the load counts.
  - Capped test is tolerant: `any(isinstance(lane, dict) and lane.get('completeness') == 'capped' for lane in (row.lanes or []))`.
- Weeks: UTC Monday start through `_week_start`, which normalises an aware datetime to UTC before `.date()` (naive is read as UTC, as today). A week exists when the selection has at least one `eng_sprint` row in it. `partial` is true when `start + 7 days > now.date()`, or `start <= (now - RETENTION_DAYS days).date()`, or the week is the oldest returned and the scan was truncated.
- Percentiles: the existing `_percentile` (linear interpolation, rounded to 2 decimals); average is `round(sum / len, 2)`; a metric with zero eligible loads is `None` in all three values.
- Response contract (read-only, admin-only, workspace-scoped):
  `catchUpWeekly: { weeks: [ { weekStart: 'YYYY-MM-DD', partial: bool, loads: int, listLoads: int, errors: int, cancelled: int, capped: int, cacheHitShare: float | None, listLoaded: { avgMs, medianMs, p95Ms }, fullyLoaded: { avgMs, medianMs, p95Ms } } ] }`, oldest week first; `weeks: []` when the selection has no `eng_sprint` row. `loads` counts Full-eligible rows, `listLoads` List-eligible rows. `cacheHitShare` is the share (2 decimals) of List-eligible rows whose lanes all have `cacheState == 'hit'`, `None` when `listLoads` is 0.
- Exact UI copy (tests pin these):
  - Headings "List loaded, by week" and "Fully loaded, by week".
  - List note: "Time until both the Product and Tech issue lists arrive (the slower of the two). Counts a load even when its dependency request failed or it was cancelled afterwards. Measured from the start of the data requests; downloading and starting the app is not included."
  - Full note: "Time until the issue lists and the requested dependencies have loaded and painted. Successful loads only."
  - Disclosure "About the weekly charts" with four paragraphs: "Weeks are UTC calendar weeks starting Monday. * marks a partial week: the current week is still filling, and the oldest week can begin before the 30-day window. Neither measurement includes the readiness check or alerts." / "Each week blends every revision, cache state, Sprint and Group in the current selection; Cache hit shows how much of the week was served from cache. Use the Group, Sprint and Revision filters to compare like with like." / "Fewer than 20 loads in a week is preliminary: its p95 is close to the slowest load." / "With dependencies hidden or skipped, Fully loaded ends with the lists."
  - Empty states: "No Catch Up loads in this selection yet." (no week at all); "No loads in this selection reached this measurement yet." in place of a chart whose every week is empty.
  - Readout rows: title "Week of Oct 19 · 14 loads" (the chart's own count), one row per series ("Average: 3.20s"), a muted row of the form "Errors 1 · cancelled 1 · capped 0 · cache hit 25%", and for fewer than 20 loads a muted row "Preliminary: fewer than 20 loads".
- Reuse, do not reinvent: `niceMaximum` and `REFERENCES` from `PerformanceBoardWeeks.jsx`, `resolveFloatingHoverPosition`, the `performance-week-*` chart classes (each chart sits in a `div.performance-week-chart`, which the readout uses as its boundary), `burnout-hover-bubble`, `burnout-legend`, `burnout-color`, `performance-phase` (extended with `is-avg`, `is-median`, `is-p95` slugs for colour and swatch), `performance-table-scroll`, right-aligned `num` cells, `weekLabel` and `seconds` from `performanceFormat.js`. New hooks: `performance-line-path` and `performance-line-point` (SVG only). No new font-family, font-size, border-radius value (`50%` is already baselined), or pill/chip/badge/button class. No `secondsShort` import (it would add an unused-import warning).
- Legend items are native `button` elements with `aria-pressed`; no native `title` tooltips, no `span role="button"`; the readout is in-app, pointer-positioned inside the viewport, above the settings layer (`z-index` above 9100), `pointer-events: none`, shown by hover and by click (touch). Numeric columns are right-aligned. Postmortems to honour: MRT017 (chart hover readout placement), MRT020 and MRT021 (control reuse, no local override of a shared component's layout).
- The new component performs no fetch and no analytics (source guard in Task 2). Operational diagnostics only, per the docs/README_ANALYTICS.md allowlist.
- Settings owner modules are registered in `scripts/extraction_lint/owner_budgets.json`; `tests/test_codebase_structure_budgets.py` checks registration, line counts, ceilings and aggregates only. The extraction checker (`check_hook_interfaces.mjs`) checks reviewed-bag digests and callers. Untouched `origin/main` already reports six enforced problems (GroupBoardSettings, `useTeamCatalogLifecycle`, `useTeamGroupSettings`) and 104 ESLint warnings against a cap of 106, so the gate is "the same problem identities, no more warnings", never a zero count.
- Environment: Python via `.venv/bin/python` with the CI env `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile`; Node 20 via `fnm exec --using 20`; Playwright one spec at a time with `--browser=chromium --workers=1`. Do not start a server on port 5050. Screenshots use synthetic data under gitignored `tmp/load-performance/`, with animations disabled; look at every screenshot.
- Git: commit subjects at most 72 characters, no agent or tool attribution (no `Co-Authored-By`, no "Generated with"). Every commit and merge uses the noreply identity through one-shot flags, never the personal address in local git config: `git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit ...`. After every commit run `git show --stat HEAD`, `git status --short` and `git log -1 --format='%an <%ae>'` and read them (Gate A). Publication (push, PR) follows the AGENTS.md publication transaction and needs explicit user confirmation.

## Review Focus

Inputs and conditions the spec implies but the obvious tests would miss; each has a test in the owning task.

1. A week whose average exceeds its p95 (one 60 s load among many fast ones): the average marker must stay inside the axis, which is sized over average, median and p95 (Task 2).
2. A week of cache hits (a few hundred ms) next to a spike week: tiny values draw inside the plot, never NaN (Task 2).
3. One week only, or a gap week between data weeks: markers without a line, lines broken at the gap, no NaN (Task 2).
4. Both lists loaded but the dependency request failed or the tab was left: the load still counts for List loaded and never for Fully loaded; a lane that failed fast never counts (Task 1).
5. A non-UTC database session and the 30-day window edge: the Sunday 22:30 UTC load belongs to the previous week, and the oldest week is flagged partial, also after a truncated scan (Task 1).

## File Map

- Modify `backend/services/load_performance.py`: `_week_start` (UTC normalisation), new `catch_up_list_ms`, `_catch_up_weekly`; `load_report` returns `catchUpWeekly`.
- Modify `tests/test_load_performance.py`: helper `catch_up_load`, the tests in Task 1, assertions added to two existing security tests.
- Create `frontend/src/settings/PerformanceCatchUpWeeks.jsx`; modify `frontend/src/settings/PerformanceBoardWeeks.jsx` (export `REFERENCES` only); modify `frontend/src/styles/settings/performance.css`; modify `tests/test_performance_settings.js` (Task 2).
- Modify `frontend/src/settings/PerformanceSettings.jsx` (import, one conditional, one notice condition); modify `tests/ui/load_performance.spec.js` (Task 3).
- Modify `scripts/extraction_lint/owner_budgets.json` (Tasks 2 and 3).
- Modify `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/design-system.md`, `docs/TODO.md`, `docs/plans/DONE-in-app-load-performance.md`, `docs/plans/README.md`; rebuild `frontend/dist` (Task 4).
- Forbidden to touch: `backend/routes/performance_routes.py`, `frontend/src/eng/loadPerformance.js`, `frontend/src/api/performanceApi.js`, the DB models and migrations, `backend/security/policy.py`, `RETENTION_DAYS`.

## Execution Status

Task 4's own commits cannot be recorded here (they contain this file); the final report and the PR description list them.

| Task | Status | Commit | Notes |
|---|---|---|---|
| T0 | done 2026-10-26 | | baseline at `e09a078d` (plan commit; origin/main `57601293`): `make test` Ran 2413 tests, OK (skipped=50); `make test-security` Ran 82 tests, OK; `test:frontend:unit` 3048 pass, 0 fail; Chromium `load_performance` + `design_system_hover_surfaces` 42 passed; extraction lint exit 1 with the six enforced problems (GroupBoardSettings `expandedInputCount` and unresolved inventory, `useTeamCatalogLifecycle` default, `useTeamGroupSettings` x3) and 104 ESLint warnings (0 errors); 'before' screenshots copied to `tmp/load-performance/before/` |
| T1 | done 2026-10-26 | `8daf153b` | backend; `tests.test_load_performance` + endpoint guards 86 tests OK; four mutations (smaller lane, error rows in Fully loaded, no UTC normalisation, ignored truncation flag) each turned tests red and were reverted |
| T2 | done 2026-10-26 | `66198528` | chart component; `test_performance_settings.js` + `test_design_system_ratchets.js` 29 pass; budgets OK; lint unchanged (same six problems, 104 warnings, 83 modules) |
| T3 | done 2026-10-26 | `bf1ad44e` | wiring and browser spec; `load_performance.spec.js` 26 passed (16 existing + 10 new); `design_system_hover_surfaces` 26 passed; Surface All screenshots byte-identical to `before/` |
| T4 | done 2026-10-26 | | docs, bundle, full verification at head; its commits and the review-fix commit are in the final report; results under Divergences and in the final report |

## Divergences from the plan (recorded during execution, 2026-10-26)

1. **Entry bundle growth (plan premise wrong).** The plan expects the new code to land in the lazy Settings chunk. On `origin/main` `PerformanceSettings` is already imported statically through `AdminSettingsContainer` from `dashboard.jsx` and lives in the entry `dashboard.js` (it contains the `Choose one surface, scope, cache` copy; `SettingsModalContainer` does not). The rebuild therefore grew only the entry (+8,210 B raw, +2,133 B gzip) and renamed only `lazy-views-*.json`; no chunk file changed. Making the Performance panel lazy would touch `dashboard.jsx` or `AdminSettingsContainer.jsx`, outside the File Map. The requester accepted the growth on 2026-10-26; lazy-loading the admin settings is parked in `docs/TODO.md` (Deferred).
2. **Readout counts row (review finding, fixed).** The pinned row "Errors n · cancelled n · capped n · cache hit p%" needs about 292 px but the 260 px bubble leaves 241 px, so the shared `nowrap`/ellipsis style cut it; `getByText().toBeVisible()` cannot see that. Only that row now wraps (`performance-week-counts`), `HOVER_BUBBLE_HEIGHT` is 144, and the Playwright test asserts `scrollWidth <= clientWidth` on every readout row at 390 and 700 px, including large counts.
3. **Retention-window flag (plan rule wrong, fixed).** `start < window_start.date()` misses the week the window starts in whenever `now` is a Wednesday (`now - 30 days` is then a Monday at the same time of day). The rule is now `start <=`, with a test on the plan's own Wednesday `NOW`.
4. **Two bundle commits.** The bundle was rebuilt and committed once after Task 3 and docs (as planned) and once more after the review fixes; no history was rewritten.
5. **Plan was already committed** (`e09a078d`) rather than uncommitted when execution started.
6. **Requester decisions of 2026-10-26** (calls 1, 4 and 6 confirmed as planned; the bundle growth accepted):
    - Call 8 amended: for Surface `eng_sprint` the legacy "Average ... p50 ... p95" line and the "About these measurements" disclosure are also hidden (the counts line and "Contextual timings" stay); the "p95 exceeds the 4s SLO" line still renders when the legacy summary's p95 is known.
    - The first "About the weekly charts" paragraph gained "Neither measurement includes the readiness check or alerts."
    - A calendar week with no rows breaks the line (more than 7 days between consecutive weeks); markers keep equal spacing.
    - The 2s and 4s reference labels are pushed apart when the axis is large (label baselines at least 12 units apart); the scroll check now covers the panel and its ancestors.

### Verification at the committed head (2026-10-26, numbers only)

Head after the requester's decisions and the third bundle commit. `make test` Ran 2423 tests, OK (skipped=50) (baseline 2413); `make test-security` Ran 82 tests, OK; `test:frontend:unit` 3057 pass, 0 fail (baseline 3048); Chromium `load_performance` + `design_system_hover_surfaces` 55 passed (baseline 42); extraction lint exit 1 with the same six enforced problem identities and 104 ESLint warnings, 83 modules.

| Check | Measured | Threshold | Result |
|---|---|---|---|
| P1 `_catch_up_weekly`, 10,000 rows, six weeks, median of 5 (three trials) | 60.7 to 61.2 ms | <= 150 ms | PASS |
| P1 `load_report` now minus origin/main, same rows (three trials) | 74.7, 75.1, 62.7 ms (earlier runs: 98.3, 82.1, 68.8 ms; one under CPU load: 110.6 ms) | <= 100 ms | PASS, close to the limit and noisy |
| P1 `catchUpWeekly` JSON, six weeks | 1,589 bytes | <= 3 KB | PASS |
| P2 entry `dashboard.js` raw / gzip vs origin/main | +8,552 B / +2,293 B (accepted by the requester 2026-10-26) | <= 1 KB raw | FAIL (see Divergence 1: the Performance panel is in the entry bundle, not a lazy chunk) |
| P2 Settings chunk raw | +0 B (code is not in it) | <= 12 KB | PASS, vacuous |
| P2 'real dashboard emits one measured load ...' unchanged | green in the 53-spec run | green | PASS |
| P3 load-path files in the branch diff | 0 | none | PASS |
| P4 select Surface until both charts exist, Chromium, 5 runs | median 7.7 ms (7.5 to 13 ms), 0 long tasks, 0 console errors or warnings | <= 500 ms, no long task > 100 ms, none | PASS |
| P5a HAR golden (lanes 286 and 526 ms, hit, 8236 ms) | server 526 / 8236 ms; rendered 0.53s and 8.24s | exact | PASS |
| P5b offline real data (the app's own database, read-only transaction) | `load_report(...)['catchUpWeekly']` computed for the two workspaces that have Catch Up rows (4 weeks each, none truncated); the figures were compared in the session only and are deliberately not recorded here | n/a | DONE, comparison with P5c pending |
| P5c browser on the user's server | server on 5050 verified to run from this checkout and to serve the committed bundle (sha256 equal); the built-in browser needs the requester to sign in as an admin | n/a | PENDING sign-in |
| Step 4 cross-layer (six seeded weeks, all outcomes) | 6 table rows, every cell equals the server value, no `NaN`, `Unknown` only where the server sent null | identical | PASS |

### Task 0: Baseline

**Files:** none changed.

- [ ] **Step 1: Confirm the branch is clean and based on `origin/main`**

Run: `git fetch origin && git status --short && git log --oneline origin/main..HEAD`
Expected: only this plan and its `docs/plans/README.md` entry (uncommitted or as the sole commit); no inherited commits. Read `docs/postmortem/MRT017-chart-hover-readout-placement.md`, `MRT020-project-track-filter-bar-bespoke-controls.md` and `MRT021-project-track-segmented-control-override.md`.

- [ ] **Step 2: Record the baseline of everything Task 4 will claim**

Run, and write each summary line into the Execution Status notes:
`make test` (full Python suite) and `make test-security`
`fnm exec --using 20 npm run test:frontend:unit`
`fnm exec --using 20 npx playwright test tests/ui/load_performance.spec.js tests/ui/design_system_hover_surfaces.spec.js --browser=chromium --workers=1 --reporter=line`
`JEP_TEST_PYTHON=.venv/bin/python fnm exec --using 20 bash scripts/extraction_lint/run.sh`: record the exit code, the names of the enforced problems and the ESLint warning count.
Expected: green except anything already red on `origin/main`; before accepting a pre-existing failure explain its cause, user impact, reproducibility and remedy. Copy `tmp/load-performance/admin-spike.png` and `board-weeks.png` (written by the spec run) to `tmp/load-performance/before/` as the "before" screenshots.

### Task 1: Server-side weekly aggregation

**Files:**
- Modify: `backend/services/load_performance.py` (`_week_start`, after `_weekly`, the `load_report` return)
- Test: `tests/test_load_performance.py`

**Interfaces:**
- Produces: `catch_up_list_ms(row) -> float | None`; `_catch_up_weekly(rows, now, truncated=False) -> {'weeks': [...]}` with the contract in Global Constraints; `load_report(...)['catchUpWeekly']`.

- [ ] **Step 1: Add the helper and the failing tests to `tests/test_load_performance.py`**

Import `LoadPerformance` next to `Base`, and `SimpleNamespace` is already imported. Add beside `observation`:

```python
def catch_up_load(product_ms, tech_ms, total_ms, *, cache='miss', group='department-a', outcome='success',
                  completeness='unknown', failed=(), first_content_ms=None):
    payload = observation(total_ms, completeness=completeness, outcome=outcome)
    payload['groupId'] = group
    if first_content_ms is not None:
        payload['firstContentMs'] = first_content_ms
    for lane, duration in zip(payload['lanes'], (product_ms, tech_ms)):
        lane.update(durationMs=duration, cacheState=cache)
        if lane['project'] in failed:   # a failed or aborted lane is recorded without a body
            lane.update(payloadBytes=0, issueCount=0, epicCount=0, storyCount=0)
    return payload

WEEK_KEYS = ['cacheHitShare', 'cancelled', 'capped', 'errors', 'fullyLoaded', 'listLoaded', 'listLoads', 'loads',
             'partial', 'weekStart']
```

Add to `LoadPerformanceTests` (`NOW` is a class attribute; weeks matter, so every report call passes `now`):

```python
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)   # a Wednesday

def test_catch_up_weekly_plots_the_slower_lane_and_the_full_duration_per_utc_week(self):
    for days_ago, loads, extra in ((9, (1000, 3000, 9000), {'first_content_ms': 100}), (8, (2000, 2500, 7000), {}),
                                   (7, (4000, 1000, 11000), {}), (2, (1500, 500, 3000), {}), (1, (500, 2500, 5000), {})):
        self.save(catch_up_load(*loads, **extra), now=self.NOW - timedelta(days=days_ago))
    self.save(catch_up_load(60000, 60000, 60000), 'workspace-b', now=self.NOW - timedelta(days=1))
    report = performance.load_report(self.session, 'workspace-a', now=self.NOW)
    weeks = report['catchUpWeekly']['weeks']
    self.assertEqual(['2026-10-12', '2026-10-19'], [week['weekStart'] for week in weeks])
    first, second = weeks
    self.assertEqual(WEEK_KEYS, sorted(first))
    self.assertEqual((3, 3, False, 0, 0, 0, 0.0), (first['loads'], first['listLoads'], first['partial'], first['errors'],
                                                  first['cancelled'], first['capped'], first['cacheHitShare']))
    self.assertEqual({'avgMs': 3166.67, 'medianMs': 3000, 'p95Ms': 3900}, first['listLoaded'])
    self.assertEqual({'avgMs': 9000, 'medianMs': 9000, 'p95Ms': 10800}, first['fullyLoaded'])
    self.assertEqual((2, 2, True), (second['loads'], second['listLoads'], second['partial']))
    self.assertEqual({'avgMs': 2000, 'medianMs': 2000, 'p95Ms': 2450}, second['listLoaded'])
    self.assertEqual({'avgMs': 4000, 'medianMs': 4000, 'p95Ms': 4900}, second['fullyLoaded'])
    for week in weeks:
        for key in ('avgMs', 'medianMs', 'p95Ms'):
            self.assertLessEqual(week['listLoaded'][key], week['fullyLoaded'][key])

def test_catch_up_weekly_blends_revisions_and_cache_states_that_blank_the_summary(self):
    for revision, cache, duration in (('rev-a', 'hit', 1000), ('rev-b', 'miss', 3000)):
        performance.record_load(self.session, 'workspace-a', catch_up_load(duration, duration, duration, cache=cache),
                                environment='local', revision=revision, now=self.NOW - timedelta(hours=2))
    report = performance.load_report(self.session, 'workspace-a', now=self.NOW)
    self.assertTrue(report['summary']['mixedCohorts'])
    self.assertIsNone(report['summary']['p95Ms'])
    week, = report['catchUpWeekly']['weeks']
    self.assertEqual((2, 0.5), (week['loads'], week['cacheHitShare']))
    self.assertEqual({'avgMs': 2000, 'medianMs': 2000, 'p95Ms': 2900}, week['listLoaded'])
    self.assertEqual(week['listLoaded'], week['fullyLoaded'])

def test_catch_up_list_loaded_survives_a_failed_dependency_tail_but_not_a_failed_lane(self):
    hours = iter(range(8, 0, -1))
    def at():
        return self.NOW - timedelta(hours=next(hours))
    self.save(catch_up_load(500, 600, 1000), now=at())                                        # success: list 600, full 1000
    self.save(catch_up_load(500, 600, 2000, completeness='capped'), now=at())                 # capped: counted only as capped
    self.save(catch_up_load(700, 900, 3000, outcome='error'), now=at())                       # dependency failed: list 900
    self.save(catch_up_load(500, 200, 3000, outcome='error', failed=('tech',)), now=at())     # tech lane failed: nothing
    self.save(catch_up_load(800, 400, 4000, outcome='cancelled'), now=at())                   # left during the tail: list 800
    self.save(catch_up_load(300, 100, 4000, outcome='cancelled', failed=('tech',)), now=at()) # aborted lane: nothing
    self.save(phased_board(10000, 1000, 7000, 3000), now=at())                                # Board ignored
    week, = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
    self.assertEqual((1, 3, 2, 2, 1), (week['loads'], week['listLoads'], week['errors'], week['cancelled'], week['capped']))
    self.assertEqual({'avgMs': 766.67, 'medianMs': 800, 'p95Ms': 890}, week['listLoaded'])
    self.assertEqual({'avgMs': 1000, 'medianMs': 1000, 'p95Ms': 1000}, week['fullyLoaded'])

def test_catch_up_weekly_keeps_empty_weeks_and_ignores_malformed_lanes(self):
    self.save(phased_board(10000, 1000, 7000, 3000), now=self.NOW - timedelta(hours=1))
    self.assertEqual({'weeks': []}, performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly'])
    broken = [dict(project='product', durationMs=True, payloadBytes=10, completeness='unknown', cacheState='miss'),
              dict(project='tech', durationMs='3000', payloadBytes=10, completeness='unknown', cacheState='miss')]
    for lanes in ([], broken):
        self.session.add(LoadPerformance(workspace_id='workspace-a', load_id=str(uuid.uuid4()), group_id='department-a',
                                         sprint_id='sprint-a', surface='eng_sprint', outcome='success', duration_ms=1000,
                                         lanes=lanes, environment='local', revision='abc123',
                                         recorded_at=self.NOW - timedelta(hours=1)))
    self.save(catch_up_load(500, 600, 3000, outcome='error', failed=('tech',)), now=self.NOW - timedelta(days=8))
    self.session.flush()
    outage, current = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
    self.assertEqual((0, 0, 1), (outage['loads'], outage['listLoads'], outage['errors']))
    self.assertEqual({'avgMs': None, 'medianMs': None, 'p95Ms': None}, outage['fullyLoaded'])
    self.assertEqual((2, 0, None), (current['loads'], current['listLoads'], current['cacheHitShare']))
    self.assertEqual({'avgMs': None, 'medianMs': None, 'p95Ms': None}, current['listLoaded'])
    self.assertEqual({'avgMs': 1000, 'medianMs': 1000, 'p95Ms': 1000}, current['fullyLoaded'])

def test_catch_up_weekly_follows_the_report_filters_and_the_environment(self):
    self.save(catch_up_load(1000, 1000, 1000, cache='hit'), now=self.NOW - timedelta(hours=3))
    self.save(catch_up_load(3000, 3000, 3000, group='department-b'), now=self.NOW - timedelta(hours=2))
    performance.record_load(self.session, 'workspace-a', catch_up_load(9000, 9000, 9000), environment='production',
                            revision='abc123', now=self.NOW - timedelta(hours=1))
    def weeks(filters=None, environment='local'):
        return performance.load_report(self.session, 'workspace-a', filters, environment=environment,
                                       now=self.NOW)['catchUpWeekly']['weeks']
    self.assertEqual([2], [week['loads'] for week in weeks()])
    self.assertEqual([(1, 1000)], [(w['loads'], w['listLoaded']['avgMs']) for w in weeks({'cacheState': 'hit'})])
    self.assertEqual([(1, 3000)], [(w['loads'], w['listLoaded']['avgMs']) for w in weeks({'groupId': 'department-b'})])

def test_catch_up_weekly_counts_every_scanned_row_not_only_the_returned_samples(self):
    for minute in range(205):
        self.save(catch_up_load(500, 600, 1000), now=self.NOW - timedelta(minutes=minute))
    report = performance.load_report(self.session, 'workspace-a', now=self.NOW)
    self.assertEqual(205, report['catchUpWeekly']['weeks'][0]['loads'])
    self.assertEqual(200, len(report['samples']))

def test_catch_up_weekly_flags_the_oldest_week_after_a_truncated_scan(self):
    for day in (6, 13, 20):                                        # three weeks of ten loads each
        for index in range(10):
            self.save(catch_up_load(500, 600, 1000), now=self.NOW.replace(day=day) + timedelta(minutes=index))
    report = performance.load_report(self.session, 'workspace-a', now=self.NOW, limit=12)
    self.assertTrue(report['truncated'])
    oldest, newest = report['catchUpWeekly']['weeks']
    self.assertEqual(('2026-10-12', 2, True), (oldest['weekStart'], oldest['loads'], oldest['partial']))
    self.assertEqual(('2026-10-19', 10), (newest['weekStart'], newest['loads']))

def test_catch_up_weekly_splits_at_utc_monday_midnight_in_any_database_zone(self):
    self.save(catch_up_load(500, 600, 1000), now=datetime(2026, 10, 18, 23, 59, 59, tzinfo=timezone.utc))
    self.save(catch_up_load(500, 600, 1000), now=datetime(2026, 10, 19, 0, 0, 0, tzinfo=timezone.utc))
    weeks = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
    self.assertEqual(['2026-10-12', '2026-10-19'], [week['weekStart'] for week in weeks])
    paris = timezone(timedelta(hours=2))                           # Monday 00:30 in Paris is Sunday 22:30 UTC
    moment = datetime(2026, 10, 19, 0, 30, tzinfo=paris)
    self.assertEqual('2026-10-12', performance._week_start(moment).isoformat())
    row = SimpleNamespace(surface='eng_sprint', outcome='success', duration_ms=1000, recorded_at=moment,
                          lanes=catch_up_load(500, 600, 1000)['lanes'])
    self.assertEqual(['2026-10-12'], [week['weekStart'] for week in performance._catch_up_weekly([row], self.NOW)['weeks']])

def test_catch_up_weekly_marks_a_week_that_starts_before_the_retention_window(self):
    now = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)       # a Sunday: the window starts Sep 25, a Friday
    self.save(catch_up_load(500, 600, 1000), now=now - timedelta(days=31))
    self.save(catch_up_load(500, 600, 1000), now=now - timedelta(days=29))
    report = performance.load_report(self.session, 'workspace-a', now=now)
    week = report['catchUpWeekly']['weeks'][0]
    self.assertEqual(('2026-09-21', 1, True), (week['weekStart'], week['loads'], week['partial']))
    self.assertEqual(30, report['retentionDays'])
```

Extend two existing tests in `LoadPerformanceSecurityTests` (read each first): in `test_ingestion_and_admin_read_are_workspace_scoped` assert that the admin response body contains `catchUpWeekly` and that the other workspace's `catchUpWeekly` is `{'weeks': []}`; in `test_admin_denied_even_when_settings_are_collaborative` assert that the 403 body has no `catchUpWeekly` key.

- [ ] **Step 2: Run the new tests and watch them fail**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_load_performance -k catch_up -v` and the two extended security tests.
Expected: the new tests fail with `KeyError: 'catchUpWeekly'` (the UTC test also fails on `_week_start`).

- [ ] **Step 3: Implement in `backend/services/load_performance.py`**

- `_week_start(moment)`: if `moment.tzinfo` is set, convert with `.astimezone(timezone.utc)` before `.date()`.
- `catch_up_list_ms(row)`: the List-eligible rule in Global Constraints; returns the larger lane `durationMs` or `None`.
- `_catch_up_weekly(rows, now, truncated=False)`: keep `eng_sprint` rows, group by `_week_start`, build every week field per the contract (Full-eligible and List-eligible rules, tolerant capped test, `cacheHitShare`, `None` metrics for zero loads, the three-way `partial` rule using `RETENTION_DAYS`, the oldest week partial when `truncated`), weeks oldest first, `{'weeks': []}` when there are none.
- `load_report` adds `catchUpWeekly=_catch_up_weekly(rows, now, truncated)`.
Do not touch `_weekly`, `_summary`, `validate_load` or the constants.

- [ ] **Step 4: Run the whole module and the guards**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_load_performance tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards`
Expected: OK; the Board weekly tests unchanged and green.

- [ ] **Step 5: Commit**

```bash
git add backend/services/load_performance.py tests/test_load_performance.py
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add weekly Catch Up load stats to the performance report"
git show --stat HEAD && git status --short && git log -1 --format='%an <%ae>'
```

### Task 2: Weekly line chart component

**Files:**
- Create: `frontend/src/settings/PerformanceCatchUpWeeks.jsx`
- Modify: `frontend/src/settings/PerformanceBoardWeeks.jsx` (add `export` to `REFERENCES`, nothing else), `frontend/src/styles/settings/performance.css`, `scripts/extraction_lint/owner_budgets.json`
- Test: `tests/test_performance_settings.js`

**Interfaces:**
- Consumes: `niceMaximum(valueMs)` and `REFERENCES` from `PerformanceBoardWeeks.jsx`; `resolveFloatingHoverPosition` from `../ui/hoverBubblePosition.js`; `seconds`, `weekLabel` from `./performanceFormat.js`.
- Produces: `export const SERIES = [{ key: 'avgMs', slug: 'avg', label: 'Average' }, { key: 'medianMs', slug: 'median', label: 'Median' }, { key: 'p95Ms', slug: 'p95', label: 'p95' }]`; `export const METRICS = [{ key: 'listLoaded', countKey: 'listLoads', title: 'List loaded' }, { key: 'fullyLoaded', countKey: 'loads', title: 'Fully loaded' }]`; `export const PRELIMINARY_LOADS = 20`; default export `PerformanceCatchUpWeeks({ weekly })` where `weekly` is the `catchUpWeekly` value (`weekly?.weeks` may be absent).

- [ ] **Step 1: Write the failing unit tests in `tests/test_performance_settings.js`**

Add `loadCatchUp()` (the `loadWeeks` esbuild-to-CJS pattern, entry `PerformanceCatchUpWeeks.jsx`, externals `react` and `react-dom`), fixtures and helpers:

```js
const metric = (avg, median, p95) => ({ avgMs: avg, medianMs: median, p95Ms: p95 });
const none = metric(null, null, null);
// A valid week: 12 successful loads; 14 list-eligible loads (the other two were an error and a cancellation after both lists arrived).
const catchWeek = (weekStart, overrides = {}) => ({ weekStart, partial: false, loads: 12, listLoads: 14, errors: 1, cancelled: 2, capped: 0,
    cacheHitShare: 0.25, listLoaded: metric(3200, 3000, 5200), fullyLoaded: metric(9000, 8500, 12000), ...overrides });
const renderCatchUp = weekly => renderToStaticMarkup(React.createElement(loadCatchUp().default, { weekly }));
const chartOf = (html, key) => html.match(new RegExp(`<svg[^>]*data-chart="${key}"[\\s\\S]*?</svg>`))[0];
const points = svg => [...svg.matchAll(/<(circle|rect)([^>]*data-point[^>]*)>/g)].map(([, kind, attrs]) => ({
    series: attrs.match(/data-point="(\w+)"/)[1], value: Number(attrs.match(/data-value="([\d.]+)"/)[1]),
    x: kind === 'circle' ? Number(attrs.match(/cx="([\d.]+)"/)[1])
        : Number(attrs.match(/ x="([\d.]+)"/)[1]) + Number(attrs.match(/width="([\d.]+)"/)[1]) / 2,
    y: kind === 'circle' ? Number(attrs.match(/cy="([\d.]+)"/)[1])
        : Number(attrs.match(/ y="([\d.]+)"/)[1]) + Number(attrs.match(/height="([\d.]+)"/)[1]) / 2 }));
const seriesValues = (svg, series) => points(svg).filter(point => point.series === series).map(point => point.value);
const plotY = (value, axis) => 22 + 192 * (1 - value / axis);
```

Tests (names and assertions):

```js
test('Catch Up weekly view draws average, median and p95 lines for list and full loads', () => {
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { partial: true })] });
    assert.match(html, /^<section aria-label="Catch Up weekly load times"/);
    assert.equal(html.match(/<polyline[^>]*data-series=/g).length, 6, 'three series in each of two charts');
    assert.equal(html.match(/data-week-hit=/g).length, 4);
    assert.equal(html.match(/<button(?=[^>]*aria-pressed="true")(?=[^>]*performance-week-legend-item)[^>]*>/g).length, 3);
    assert.match(html, /Average<\/button>[\s\S]*Median<\/button>[\s\S]*p95<\/button>/, 'legend order');
    assert.equal(html.match(/class="burnout-color performance-phase is-(avg|median|p95)"/g).length, 3, 'legend swatches reuse the phase hook');
    assert.equal(html.match(/<div class="performance-week-chart"/g).length, 2, 'each chart is its own readout boundary');
    assert.doesNotMatch(html, /<title>|\stitle=/, 'readouts are in-app, never native title tooltips');
    assert.equal(html.match(/2s target/g).length, 2);
    assert.equal(html.match(/4s SLO/g).length, 2);
    assert.match(html, /Oct 19\*/);
    assert.doesNotMatch(html, /Oct 12\*/, 'only the partial week is starred');
    assert.ok(chartOf(html, 'listLoaded').includes('Oct 19*') && chartOf(html, 'fullyLoaded').includes('Oct 19*')
        && !chartOf(html, 'listLoaded').includes('Oct 12*'), 'the chart labels star the partial week');
    assert.match(html, /<details[^>]*open[^>]*><summary>Weekly table/);
    assert.match(html, /<details(?![^>]*open)[^>]*><summary>About the weekly charts/);
    assert.match(html, /aria-label="Weekly average, median and p95 of List loaded time for Catch Up\. Exact values follow in the table\."/);
    assert.match(chartOf(html, 'listLoaded').match(/<rect[^>]*data-point="p95Ms"[^>]*>/)[0], /width="8"/);
    assert.match(html, /performance-table-scroll"><table/);
    for (const copy of [
        'Counts a load even when its dependency request failed or it was cancelled afterwards. Measured from the start of the data requests; downloading and starting the app is not included.',
        'Time until the issue lists and the requested dependencies have loaded and painted. Successful loads only.',
        'Weeks are UTC calendar weeks starting Monday. * marks a partial week: the current week is still filling, and the oldest week can begin before the 30-day window.',
        'Each week blends every revision, cache state, Sprint and Group in the current selection; Cache hit shows how much of the week was served from cache. Use the Group, Sprint and Revision filters to compare like with like.',
        'Fewer than 20 loads in a week is preliminary: its p95 is close to the slowest load.',
        'With dependencies hidden or skipped, Fully loaded ends with the lists.']) assert.ok(html.includes(copy), copy);
});

test('each chart plots its own metric under its own heading, weeks in order', () => {
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { listLoaded: metric(1000, 900, 1500), fullyLoaded: metric(2000, 1800, 2500), listLoads: 5, loads: 4 })] });
    const list = chartOf(html, 'listLoaded');
    const full = chartOf(html, 'fullyLoaded');
    assert.ok(html.indexOf('List loaded, by week') < html.indexOf(list) && html.indexOf(list) < html.indexOf('Fully loaded, by week')
        && html.indexOf('Fully loaded, by week') < html.indexOf(full), 'heading, chart, heading, chart');
    assert.deepEqual([seriesValues(list, 'avgMs'), seriesValues(list, 'medianMs'), seriesValues(list, 'p95Ms')], [[3200, 1000], [3000, 900], [5200, 1500]]);
    assert.deepEqual([seriesValues(full, 'avgMs'), seriesValues(full, 'medianMs'), seriesValues(full, 'p95Ms')], [[9000, 2000], [8500, 1800], [12000, 2500]]);
    for (const svg of [list, full]) assert.deepEqual([...svg.matchAll(/data-week-hit="([\d-]+)"/g)].map(match => match[1]), ['2026-10-12', '2026-10-19']);
    assert.ok(list.includes('14 loads') && list.includes('5 loads') && !list.includes('12 loads'), 'the list chart labels list loads');
    assert.ok(full.includes('12 loads') && full.includes('4 loads') && !full.includes('14 loads'), 'the full chart labels full loads');
    const listNote = 'Time until both the Product and Tech issue lists arrive';
    const fullNote = 'Time until the issue lists and the requested dependencies have loaded and painted.';
    assert.ok(html.indexOf('List loaded, by week') < html.indexOf(listNote) && html.indexOf(listNote) < html.indexOf(list), 'the list note sits under the list heading');
    assert.ok(html.indexOf('Fully loaded, by week') < html.indexOf(fullNote) && html.indexOf(fullNote) < html.indexOf(full), 'the full note sits under the full heading');
    for (const svg of [list, full]) for (const series of ['avgMs', 'medianMs', 'p95Ms']) {
        const xs = points(svg).filter(point => point.series === series).map(point => point.x);
        assert.ok(xs.every((x, index) => index === 0 || x > xs[index - 1]), `${series} weeks run left to right`);
    }
});

test('each chart sizes its own axis from its largest average, median or p95 and draws every mark at its height', () => {
    const weeks = [catchWeek('2026-10-05', { listLoaded: metric(140, 120, 160), fullyLoaded: metric(150, 130, 170) }),
        catchWeek('2026-10-12', { listLoaded: metric(4000, 3000, 9000), fullyLoaded: metric(9000, 8500, 12000) }),
        catchWeek('2026-10-19', { listLoaded: metric(4900, 3000, 3000), fullyLoaded: metric(30000, 20000, 12000) })];
    const html = renderCatchUp({ weeks });
    // List axis: the 9 s p95 decides (niceMaximum = 12000). Full axis: the 30 s average decides (niceMaximum = 40000).
    for (const [key, axis] of [['listLoaded', 12000], ['fullyLoaded', 40000]]) {
        const found = points(chartOf(html, key));
        assert.equal(found.length, 9);
        for (const point of found) {
            assert.ok(Math.abs(point.y - plotY(point.value, axis)) < 0.5, `${key} ${point.series} ${point.value}`);
            assert.ok(point.y >= 22 && point.y <= 214, `${point.y} inside the 22 to 214 plot`);
        }
    }
    assert.doesNotMatch(html, /NaN/);
});

test('one week draws markers without a line; a gap week breaks the line', () => {
    const one = renderCatchUp({ weeks: [catchWeek('2026-10-19')] });
    assert.doesNotMatch(one, /<polyline/);
    assert.equal(one.match(/data-point=/g).length, 6);
    const gap = renderCatchUp({ weeks: [catchWeek('2026-09-21'), catchWeek('2026-09-28'),
        catchWeek('2026-10-05', { listLoads: 0, listLoaded: none, cacheHitShare: null }), catchWeek('2026-10-12'), catchWeek('2026-10-19')] });
    assert.equal(gap.match(/<polyline[^>]*data-series=/g).length, 9, 'list chart: two segments per series; full chart: one');
    assert.equal(gap.match(/data-point=/g).length, 27, 'list chart skips the gap week: 4 weeks x 3 series; full chart 5 x 3');
});

test('an empty selection and a chart with no qualifying week say so', () => {
    for (const weekly of [{ weeks: [] }, undefined]) {
        const html = renderCatchUp(weekly);
        assert.match(html, /No Catch Up loads in this selection yet\./);
        assert.doesNotMatch(html, /<svg/);
    }
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12', { listLoads: 0, listLoaded: none, cacheHitShare: null })] });
    assert.match(html, /<p role="status"[^>]*>No loads in this selection reached this measurement yet\./);
    assert.equal(html.match(/data-chart=/g).length, 1, 'only the Fully loaded chart is drawn');
});

test('Catch Up weekly table keeps the exact numbers in the right column order and alignment', () => {
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { partial: true, cacheHitShare: 0.666 }),
        catchWeek('2026-10-26', { listLoads: 0, listLoaded: none, cacheHitShare: null })] });
    assert.match(html, /<th scope="col">Week<\/th><th scope="col" class="num">List loads<\/th><th scope="col" class="num">List avg<\/th><th scope="col" class="num">List median<\/th><th scope="col" class="num">List p95<\/th><th scope="col" class="num">Full loads<\/th><th scope="col" class="num">Full avg<\/th><th scope="col" class="num">Full median<\/th><th scope="col" class="num">Full p95<\/th><th scope="col" class="num">Cache hit<\/th><th scope="col" class="num">Errors<\/th><th scope="col" class="num">Cancelled<\/th><th scope="col" class="num">Capped<\/th>/);
    assert.match(html, /<td>Oct 12<\/td><td class="num">14<\/td><td class="num">3\.20s<\/td><td class="num">3\.00s<\/td><td class="num">5\.20s<\/td><td class="num">12<\/td><td class="num">9\.00s<\/td><td class="num">8\.50s<\/td><td class="num">12\.00s<\/td><td class="num">25%<\/td><td class="num">1<\/td><td class="num">2<\/td><td class="num">0<\/td>/);
    assert.match(html, /<td>Oct 19\*<\/td>[\s\S]*?<td class="num">67%<\/td>/, 'a partial week is starred in the table and the share is rounded');
    assert.match(html, /<td>Oct 26<\/td><td class="num">0<\/td><td class="num">Unknown<\/td><td class="num">Unknown<\/td><td class="num">Unknown<\/td>[\s\S]*?<td class="num">12\.00s<\/td><td class="num">Unknown<\/td><td class="num">1<\/td>/);
});

test('the week contract is pinned and the component never fetches or emits analytics', () => {
    assert.deepEqual(Object.keys(catchWeek('2026-10-12')).sort(),
        ['cacheHitShare', 'cancelled', 'capped', 'errors', 'fullyLoaded', 'listLoaded', 'listLoads', 'loads', 'partial', 'weekStart']);
    const source = require('node:fs').readFileSync('frontend/src/settings/PerformanceCatchUpWeeks.jsx', 'utf8');
    assert.doesNotMatch(source, /dataLayer|analytics|fetch\(|api\//);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `fnm exec --using 20 node --test tests/test_performance_settings.js`
Expected: the seven new tests fail (cannot resolve `PerformanceCatchUpWeeks.jsx`); the existing tests still pass.

- [ ] **Step 3: Implement `PerformanceCatchUpWeeks.jsx`, the CSS and the `REFERENCES` export**

- Root element `<section aria-label="Catch Up weekly load times">`. Parent: holds `isolated` (series key or `null`); renders one legend (`burnout-legend performance-week-legend`, three native `performance-week-legend-item` buttons written with `aria-pressed` before `className`, swatch `<i className="burnout-color performance-phase is-{slug}" />`, a press isolates that series in both charts); then per `METRICS` entry an `<h4>`, the note, and a chart (or, when every week's count for that metric is 0, `<p role="status" className="performance-note">` with the chart-empty copy); then the table and a closed `<details className="performance-methodology"><summary>About the weekly charts</summary>` with the four paragraphs of the Global Constraints disclosure copy (one paragraph per quoted string). No weeks (or no `weekly`): only the empty-state status.
- Table columns in this order: Week, List loads, List avg, List median, List p95, Full loads, Full avg, Full median, Full p95, Cache hit, Errors, Cancelled, Capped; the Week cell is a plain `<td>` showing `weekLabel` plus `*` for a partial week; numbers use `num` cells and `seconds`; Cache hit is `Math.round(share * 100)%` or `Unknown` (local helper, not a change to `performanceFormat.js`); inside `performance-table-scroll`, wrapped as in the Board table by `<details className="performance-methodology" open><summary>Weekly table</summary>`.
- `PerformanceLineChart({ weeks, metric, isolated })` (wrapper `div.performance-week-chart`): `CHART_WIDTH 700`, `CHART_HEIGHT 260`, `PADDING { left: 44, right: 92, top: 22, bottom: 46 }` (plot 22 to 214); axis maximum `niceMaximum(largest of every non-null average, median and p95 of the metric)`; ticks, grid and `REFERENCES` lines as in the Board chart; `<svg className="performance-week-svg" data-chart={metric.key} role="img">` labelled "Weekly average, median and p95 of {title} time for Catch Up. Exact values follow in the table."; one x slot per week (one week centred); a week whose metric is null gets no marker; per series the polyline is split into runs of consecutive non-null weeks and a run draws a `<polyline className="performance-line-path performance-phase is-{slug}" data-series={key}>` only with two or more points; markers `data-point={key}` immediately followed by `data-value={value}` (the raw milliseconds), class `performance-line-point performance-phase is-{slug}`: circle r 4 (Average), 7 x 7 square (Median), 8 x 8 square rotated 45 degrees (p95); dimmed series add `is-dimmed`; week label (`weekLabel`, `*` when partial) and "{n} loads" under it; a transparent `performance-week-hit` rect per week with `data-week-hit`, `onMouseEnter`, `onMouseMove` and `onClick` all calling `showBubble` (the Board logic: portal to `document.body`, class `burnout-hover-bubble performance-week-hover-bubble`, `HOVER_BUBBLE_HEIGHT 130` (the measured readout is 122 px tall without the wrapped counts row and 138 px with it; implemented as 144)) with the readout rows from Global Constraints.
- CSS in `performance.css`: add `--performance-phase-avg: #2563eb; --performance-phase-median: #15803d; --performance-phase-p95: #a344b4;` to the existing `.performance-settings, .performance-week-hover-bubble` custom-property rule; `.performance-phase.is-avg|is-median|is-p95 { --phase-color: var(--performance-phase-...); }` beside the existing slugs; `.performance-phase.is-avg.burnout-color { border-radius: 50%; }` and `.performance-phase.is-p95.burnout-color { transform: rotate(45deg); }`; `.performance-line-path { fill: none; stroke: var(--phase-color); stroke-width: 2; background: none; transition: opacity .12s ease; }`; `.performance-line-point { fill: var(--phase-color); stroke: var(--bg-secondary); stroke-width: 2; background: none; transition: opacity .12s ease; }`; `.performance-line-path.is-dimmed, .performance-line-point.is-dimmed { opacity: .25; }`.

- [ ] **Step 4: Run the unit tests and the design-system ratchets**

Run: `fnm exec --using 20 node --test tests/test_performance_settings.js tests/test_design_system_ratchets.js`
Expected: all pass, including the existing Board tests; the ratchets stay green (no new font size, radius value or pill class).

- [ ] **Step 5: Register the new module and re-pin the Board entry**

Run `JEP_TEST_PYTHON=.venv/bin/python fnm exec --using 20 bash scripts/extraction_lint/run.sh` once so `tmp/lint` holds the tooling, then `fnm exec --using 20 node tmp/lint/check_hook_interfaces.mjs --write-inventory tmp/lint/inventory.json frontend/src/dashboard.jsx` writes the measured entries to that file. In `owner_budgets.json`: append `settings.PerformanceCatchUpWeeks` at the END of `modules` (never re-sort) with its measured `lineCount`, `lineCeiling`, `exports` (`METRICS`, `PRELIMINARY_LOADS`, `SERIES`, `default`) and the `default` interface (prop `weekly`; expanded inputs `weekly` and `weekly.weeks`) and an empty `callers` list; for `settings.PerformanceBoardWeeks` add `REFERENCES` to `exports` (sorted: `PHASES`, `REFERENCES`, `default`, `niceMaximum`, `phaseTotal`) and bump only its `sourceDigest`; copy the `settings`, `uniqueOwners` and `appPlusOwners` aggregates from the inventory.
Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets` and the extraction lint.
Expected: the budgets test OK; the checker reports the same problem identities as Task 0, and ESLint no more warnings than Task 0 (compare identities, not counts).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/settings/PerformanceCatchUpWeeks.jsx frontend/src/settings/PerformanceBoardWeeks.jsx frontend/src/styles/settings/performance.css tests/test_performance_settings.js scripts/extraction_lint/owner_budgets.json
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add weekly Catch Up load chart component"
git show --stat HEAD && git status --short && git log -1 --format='%an <%ae>'
```

### Task 3: Wire into the panel and prove it in the browser

**Files:**
- Modify: `frontend/src/settings/PerformanceSettings.jsx`, `scripts/extraction_lint/owner_budgets.json`
- Test: `tests/ui/load_performance.spec.js`

**Interfaces:**
- Consumes: `PerformanceCatchUpWeeks({ weekly })` from Task 2 and `data.catchUpWeekly` from Task 1.
- Produces: in the Surface `eng_sprint` branch, `<PerformanceCatchUpWeeks weekly={data.catchUpWeekly} />` replaces `<PerformanceTrend trend={data.trend} />`, and the `mixedCohorts` notice is not rendered for `eng_sprint`; every other selection is unchanged.

- [ ] **Step 1: Write the failing Playwright tests**

In `tests/ui/load_performance.spec.js` add (the first week is a window-edge partial week and the last the current partial week; every week has 12 successful loads, 14 list loads, one error and two cancelled loads (errors differ from cancelled so a swap shows), which the row rules allow):

```js
const catchUpWeek = (weekStart, list, full, extra = {}) => ({ weekStart, partial: false, loads: 12, listLoads: 14, errors: 1, cancelled: 2, capped: 0,
    cacheHitShare: 0.25, listLoaded: { avgMs: Math.round(list * 1.1), medianMs: list, p95Ms: Math.round(list * 1.7) },
    fullyLoaded: { avgMs: Math.round(full * 1.05), medianMs: full, p95Ms: Math.round(full * 1.4) }, ...extra });
const catchUpWeeks = [
    catchUpWeek('2026-09-14', 2400, 7600, { partial: true }), catchUpWeek('2026-09-21', 2800, 8200), catchUpWeek('2026-09-28', 3000, 9500),
    catchUpWeek('2026-10-05', 2900, 9000), catchUpWeek('2026-10-12', 4100, 12000), catchUpWeek('2026-10-19', 3300, 9800, { partial: true }),
];
const catchUpPayload = { ...payload, summary: { ...payload.summary, avgMs: null, p50Ms: null, p95Ms: null, mixedCohorts: true },
    filters: { ...payload.filters, surfaces: ['eng_sprint', 'eng_board'] }, catchUpWeekly: { weeks: catchUpWeeks } };
const catchUpSection = 'section[aria-label="Catch Up weekly load times"]';

async function openCatchUpWeeks(page, viewport = { width: 1000, height: 1100 }, data = catchUpPayload) {
    await page.setViewportSize(viewport);
    await openPanel(page, data);
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.getByRole('heading', { name: 'List loaded, by week' })).toBeVisible();
}
```

Tests:

```js
test('Catch Up weekly view plots both durations as three lines per week', async ({ page }) => {
    await openCatchUpWeeks(page);
    for (const chart of ['listLoaded', 'fullyLoaded']) {
        const svg = page.locator(`.performance-week-svg[data-chart="${chart}"]`);
        await expect(svg).toBeVisible();
        await expect(svg.locator('.performance-line-path')).toHaveCount(3);
        await expect(svg.locator('.performance-line-point')).toHaveCount(18);
        await expect(svg.locator('.performance-week-hit')).toHaveCount(6);
    }
    await expect(page.locator('.performance-trend')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent load evidence' })).toBeVisible();
    const rows = page.locator('.performance-settings table').first().locator('tbody tr');
    await expect(rows).toHaveCount(6);
    const cells = await rows.nth(1).locator('td').allTextContents();
    expect(cells.slice(0, 9)).toEqual(['Sep 21', '14', '3.08s', '2.80s', '4.76s', '12', '8.61s', '8.20s', '11.48s']);   // list before full
    expect(cells.slice(9)).toEqual(['25%', '1', '2', '0']);
    expect((await rows.nth(0).locator('td').first().textContent())).toBe('Sep 14*');
    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/catch-up-weeks.png'), fullPage: true, animations: 'disabled' });
});

test('Catch Up series are told apart by colour and by shape, in the chart and in the legend', async ({ page }) => {
    await openCatchUpWeeks(page);
    const svg = page.locator('.performance-week-svg[data-chart="listLoaded"]');
    const strokes = await svg.locator('.performance-line-path').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke));
    expect(new Set(strokes).size).toBe(3);
    expect(strokes).not.toContain('none');
    const fills = await svg.locator('.performance-line-point').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
    expect(fills).not.toContain('none');
    await expect(svg.locator('circle[data-point="avgMs"]')).toHaveCount(6);
    await expect(svg.locator('rect[data-point="medianMs"]')).toHaveCount(6);
    expect(await svg.locator('rect[data-point="medianMs"]').first().getAttribute('width')).toBe('7');
    expect(await svg.locator('rect[data-point="p95Ms"]').first().getAttribute('transform')).toContain('rotate(45');
    const swatches = await page.locator('.performance-week-legend .burnout-color').evaluateAll(nodes => nodes.map(node => ({ radius: getComputedStyle(node).borderRadius, transform: getComputedStyle(node).transform })));
    expect(swatches[0].radius).toBe('50%');                 // Average: circle
    expect(swatches[1].radius).not.toBe('50%');             // Median: square
    expect(swatches[2].transform).not.toBe('none');         // p95: diamond
});

test('Catch Up weekly charts and the blended-cohort notice follow the Surface', async ({ page }) => {
    await openPanel(page, catchUpPayload);                                    // Surface "All": daily chart, legacy notice
    await expect(page.locator('.performance-trend')).toBeVisible();
    await expect(page.locator('.performance-week-svg[data-chart]')).toHaveCount(0);
    await expect(page.getByText('Choose one surface, scope, cache, revision and configuration cohort', { exact: false })).toBeVisible();
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.locator('.performance-week-svg[data-chart]')).toHaveCount(2);
    await expect(page.getByText('Choose one surface, scope, cache, revision and configuration cohort', { exact: false })).toHaveCount(0);
});

test('Catch Up legend isolates one series in both charts, lines and markers, and a second press restores them', async ({ page }) => {
    await openCatchUpWeeks(page);
    const median = page.getByRole('button', { name: 'Median', exact: true });
    await median.click();
    await expect(page.locator('.performance-line-path.is-dimmed')).toHaveCount(4);      // two other series in two charts
    await expect(page.locator('.performance-line-point.is-dimmed')).toHaveCount(24);    // 6 weeks x 2 series x 2 charts
    await expect.poll(() => page.locator('.performance-line-path.is-dimmed').first().evaluate(node => getComputedStyle(node).opacity)).toBe('0.25');
    await expect(page.getByRole('button', { name: 'p95', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(median).toHaveAttribute('aria-pressed', 'true');
    await median.click();
    await expect(page.locator('.performance-line-path.is-dimmed, .performance-line-point.is-dimmed')).toHaveCount(0);
});

test('Catch Up weekly labels and marks stay inside each drawing, and the page never scrolls sideways, with six weeks', async ({ page }) => {
    for (const viewport of [{ width: 1000, height: 1100 }, { width: 390, height: 900 }]) {
        await openCatchUpWeeks(page, viewport);
        for (const chart of ['listLoaded', 'fullyLoaded']) {
            const clipped = await page.locator(`.performance-week-svg[data-chart="${chart}"]`).evaluate(svg => {
                const box = svg.getBoundingClientRect();
                return [...svg.querySelectorAll('text, polyline, circle, rect:not(.performance-week-hit)')]
                    .map(node => ({ node: node.textContent || node.getAttribute('class'), rect: node.getBoundingClientRect() }))
                    .filter(({ rect }) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5 || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5)
                    .map(({ node }) => node);
            });
            expect(clipped, `${chart} ${viewport.width}px`).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${viewport.width}px page overflow`).toBeLessThanOrEqual(0);
    }
});

test('Catch Up weekly readout shows its own chart\'s numbers, stays inside the viewport and above the settings layer', async ({ page }) => {
    await openCatchUpWeeks(page, { width: 700, height: 900 });
    await expect(page.locator('.performance-week-chart')).toHaveCount(2);
    const expected = {
        listLoaded: { first: ['Week of Sep 14 · 14 loads', 'Average: 2.64s', 'Median: 2.40s', 'p95: 4.08s'], last: ['Week of Oct 19 · 14 loads', 'Average: 3.63s', 'Median: 3.30s', 'p95: 5.61s'] },
        fullyLoaded: { first: ['Week of Sep 14 · 12 loads', 'Average: 7.98s', 'Median: 7.60s', 'p95: 10.64s'], last: ['Week of Oct 19 · 12 loads', 'Average: 10.29s', 'Median: 9.80s', 'p95: 13.72s'] },
    };
    for (const chart of ['listLoaded', 'fullyLoaded']) {
        for (const which of ['first', 'last']) {
            const hit = page.locator(`.performance-week-svg[data-chart="${chart}"] .performance-week-hit`)[which]();
            await hit.evaluate(node => node.scrollIntoView({ block: 'center' }));
            const box = await hit.boundingBox();
            for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.5], [0.95, 0.95]]) {
                await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
                const bubble = page.locator('.performance-week-hover-bubble');
                await expect(bubble).toBeVisible();
                const rect = await bubble.boundingBox();
                const viewport = page.viewportSize();
                expect(rect.x, `${chart} ${which} left`).toBeGreaterThanOrEqual(0);
                expect(rect.x + rect.width, `${chart} ${which} right`).toBeLessThanOrEqual(viewport.width);
                expect(rect.y, `${chart} ${which} top`).toBeGreaterThanOrEqual(0);
                expect(rect.y + rect.height, `${chart} ${which} bottom`).toBeLessThanOrEqual(viewport.height);
                expect(rect.width).toBeLessThanOrEqual(260);   // the shared Board bubble class fixes this width
            }
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.02);
            const topAtStart = (await page.locator('.performance-week-hover-bubble').boundingBox()).y;
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.98);
            const topAtEnd = (await page.locator('.performance-week-hover-bubble').boundingBox()).y;
            expect(topAtEnd - topAtStart, `${chart} ${which} readout follows the pointer`).toBeGreaterThan(40);
            const bubble = page.locator('.performance-week-hover-bubble');
            for (const text of expected[chart][which]) await expect(bubble).toContainText(text);
            await expect(bubble.getByText('Errors 1 · cancelled 2 · capped 0 · cache hit 25%')).toBeVisible();
            await expect(bubble.getByText('Preliminary: fewer than 20 loads')).toBeVisible();
            expect(await bubble.evaluate(node => ({ pointerEvents: getComputedStyle(node).pointerEvents, zIndex: Number(getComputedStyle(node).zIndex) })))
                .toEqual({ pointerEvents: 'none', zIndex: expect.any(Number) });
            expect(await bubble.evaluate(node => Number(getComputedStyle(node).zIndex))).toBeGreaterThan(9100);
            await page.mouse.move(2, 2);
            await expect(bubble).toHaveCount(0);
        }
    }
    expect(await page.locator(`${catchUpSection} [title], ${catchUpSection} title`).count()).toBe(0);
});

test('a click alone opens the Catch Up readout, so touch needs no hover', async ({ page }) => {
    await openCatchUpWeeks(page, { width: 700, height: 900 });
    const hit = page.locator('.performance-week-svg[data-chart="listLoaded"] .performance-week-hit').nth(2);
    await hit.scrollIntoViewIfNeeded();
    await hit.evaluate(node => {
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + 12 }));
    });
    await expect(page.locator('.performance-week-hover-bubble')).toContainText('Week of Sep 28');
});

test.describe('touch', () => {
    test.use({ hasTouch: true });
    test('tapping a week opens the Catch Up readout on a phone-width panel', async ({ page }) => {
        await openCatchUpWeeks(page, { width: 390, height: 900 });
        const hit = page.locator('.performance-week-svg[data-chart="fullyLoaded"] .performance-week-hit').nth(4);
        await hit.scrollIntoViewIfNeeded();
        await hit.tap();
        await expect(page.locator('.performance-week-hover-bubble')).toContainText('Week of Oct 12');
    });
});

test('Catch Up legend items hover inside their own box and move nothing', async ({ page }) => {
    await openCatchUpWeeks(page);
    for (const label of ['Average', 'Median', 'p95']) {
        const item = page.getByRole('button', { name: label, exact: true });
        const rest = await item.boundingBox();
        await item.hover();
        expect(await item.boundingBox()).toEqual(rest);
        expect(await item.evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, transform: getComputedStyle(node).transform }))).toEqual({ shadow: 'none', transform: 'none' });
    }
});

test('Catch Up weekly view says so when the selection has no load', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await openPanel(page, { ...catchUpPayload, catchUpWeekly: { weeks: [] } });
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.getByRole('status').filter({ hasText: 'No Catch Up loads in this selection yet.' })).toBeVisible();
    await expect(page.locator('.performance-week-svg[data-chart]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec and watch the new tests fail**

Run: `fnm exec --using 20 npx playwright test tests/ui/load_performance.spec.js --browser=chromium --workers=1 --reporter=line`
Expected: the new tests fail (the daily chart still renders for `eng_sprint`, and the notice still shows); every pre-existing test matches the Task 0 baseline.

- [ ] **Step 3: Wire `PerformanceSettings.jsx`**

Import `PerformanceCatchUpWeeks from './PerformanceCatchUpWeeks.jsx'`; replace the single `<PerformanceTrend trend={data.trend} />` with `{filters.surface === 'eng_sprint' ? <PerformanceCatchUpWeeks weekly={data.catchUpWeekly} /> : <PerformanceTrend trend={data.trend} />}`; change the notice condition to `summary.mixedCohorts && filters.surface !== 'eng_sprint'`. Nothing else changes; `PerformanceTrend` stays exported and used.

- [ ] **Step 4: Run the spec, then look at the screenshots**

Run the Step 2 command. Expected: all pass. Open `tmp/load-performance/catch-up-weeks.png` (and a 390 px capture, via a temporary `page.screenshot` in the clip test): three distinguishable series and swatches, readable week labels with six weeks, notes and table below, no leftover contradiction with the legacy lines. Compare the Surface "All" screenshots (`admin-spike.png`, `board-weeks.png`) with `tmp/load-performance/before/`: they must look the same. Label size at 390 px scales with the drawing as in the Board chart; parity with the Board is the bar.

- [ ] **Step 5: Re-pin the registry for the edited file**

In `owner_budgets.json`: `settings.PerformanceSettings` gets the new `lineCount` and `lineCeiling`, its two `inventory.source` line numbers and the `PerformanceTrend` caller line, and `sourceDigest` on both interfaces (the `default` interface keeps its reviewed `memberNames` and `rationale`; first confirm by diff that no bag member, prop or count changed); `settings.PerformanceCatchUpWeeks` gets its caller entry (`frontend/src/settings/PerformanceSettings.jsx`, symbol `PerformanceCatchUpWeeks`, line, phase `render`); aggregates re-copied from the inventory. The checker matches callers by `path:symbol`; line numbers are cosmetic but keep them current.
Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets` and the extraction lint.
Expected: the budgets test OK; the checker's problem identities and the ESLint warning count no worse than Task 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/settings/PerformanceSettings.jsx tests/ui/load_performance.spec.js scripts/extraction_lint/owner_budgets.json
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Show weekly Catch Up load charts for the Catch Up surface"
git show --stat HEAD && git status --short && git log -1 --format='%an <%ae>'
```

### Task 4: Documentation, build output and full verification

**Files:**
- Modify: `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/design-system.md`, `docs/TODO.md`, `docs/plans/DONE-in-app-load-performance.md`, `docs/plans/README.md`, this plan; regenerate `frontend/dist`.

- [ ] **Step 1: Update the docs**

- `docs/ontology.md`: add **Performance weekly Catch Up stats** (aliases: Catch Up weekly view, List loaded / Fully loaded weekly charts; verified on the execution date) next to the Board entry: `catch_up_list_ms`, `_catch_up_weekly`, `catchUpWeekly` in `load_report`, `_week_start` UTC normalisation, `PerformanceCatchUpWeeks` rendered only for Surface `eng_sprint`, the two row rules, which loads are recorded (initial, Refresh, sprint or group change; cached group restores are not), what is excluded, the blend decision and the tests; update the file's header Coverage line; check every linked path and symbol resolves.
- `docs/README_ANALYTICS.md`: add a table row after the Board row (feature `settings`, trigger none, `event_type=none`, `event_name=none`, typed params none; the response only gains the derived `catchUpWeekly` value; legend isolation, hover and tap emit nothing; date column set to the execution date) and mention the Catch Up weekly view in the allowlist paragraph.
- `docs/design-system.md`: extend the "Chart segments, legends and readouts" row with `settings/PerformanceCatchUpWeeks.jsx`, the `performance-phase` avg/median/p95 slugs and `performance-line-path`/`performance-line-point`, and one sentence on why `ExcludedCapacityLineChart` is not reused.
- `docs/TODO.md` (Deferred): page-start-to-list metric with a `startOffsetMs`; static and JSON compression, early API prefetch and long-cache hashed bundle names; parallelising `/api/dependencies` and `/api/eng/story-readiness`; the alerts fetch duplicating the lane payloads; non-UTC exposure of `trend` and `recordedAt`; the Cache filter options coming from a column that is NULL for Catch Up rows; extracting a shared weekly chart frame from the Board and Catch Up components.
- `docs/plans/DONE-in-app-load-performance.md`: extend the "Current accuracy" note: with Surface `eng_sprint`, Settings -> Admin -> Performance shows the weekly List loaded / Fully loaded charts instead of the daily chart.
- `docs/plans/README.md`: update the "Catch Up weekly load performance" entry with the execution status. This plan: fill the Execution Status table and any divergence.

- [ ] **Step 2: Commit the docs, then build the bundle and commit it**

```bash
git add docs/ontology.md docs/README_ANALYTICS.md docs/design-system.md docs/TODO.md docs/plans/DONE-in-app-load-performance.md docs/plans/README.md docs/plans/EXEC-catch-up-weekly-load-performance.md
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Document the weekly Catch Up load stats"
fnm exec --using 20 npm ci && fnm exec --using 20 npm run build && git status --short
```
Expected after the build: `frontend/dist` changes only: `dashboard.css`, `dashboard.js` and its map, the renamed hashed chunk pairs (ScenarioView, SettingsModalContainer, StatsPanel and the shared chunks) and the renamed `lazy-views-*.json`; nothing else. Then:
```bash
git add frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Rebuild frontend bundle for the weekly Catch Up charts"
git show --stat HEAD && git status --short && git log -1 --format='%an <%ae>'
```
Order matters: `tests/test_scenario_draft_history_source_guards.js` fails when `frontend/dist` is dirty and `frontend/src` is clean, so verification runs only after the bundle is committed.

- [ ] **Step 3: Full verification at the committed head**

Run, each with its summary line recorded:
`make test` and `make test-security`
`fnm exec --using 20 npm run test:frontend:unit`
`JEP_TEST_PYTHON=.venv/bin/python fnm exec --using 20 bash scripts/extraction_lint/run.sh`
`fnm exec --using 20 npx playwright test tests/ui/load_performance.spec.js tests/ui/design_system_hover_surfaces.spec.js --browser=chromium --workers=1 --reporter=line`
Expected: nothing beyond the Task 0 baseline; the lint shows the same problem identities and no more ESLint warnings. Do not start a server.

- [ ] **Step 4: Cross-layer acceptance on real output**

In gitignored `tmp/`: a Python script seeds an in-memory SQLite database with synthetic loads across six weeks (all outcomes, capped lanes, hit and miss) and writes `load_report(...)['catchUpWeekly']` as JSON; a Node script esbuild-bundles `PerformanceCatchUpWeeks.jsx`, renders it with that JSON and checks that the table's per-week cells equal the server numbers (list and full avg, median, p95, counts, cache hit) and that no value renders as `Unknown` or `NaN` where the server sent a number. Expected: identical numbers, six table rows. Delete the scripts afterwards.

- [ ] **Step 5: Diff check and hand-off**

Run: `git diff --name-status origin/main...HEAD`. Expected: every changed path appears in the File Map; `git status --short` empty. Report to the requester: the commit list, the verification summary lines, the screenshots under `tmp/load-performance/`, and the ten "My calls", asking for confirmation of calls 4, 6 and 8 in particular. Push, the full Chromium `tests/ui` run required before push, and the PR follow the AGENTS.md publication transaction and wait for explicit confirmation.
