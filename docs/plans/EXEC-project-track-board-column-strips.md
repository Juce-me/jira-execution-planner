# Project Track Board-Column Strips Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) to implement this plan task by task. Follow repository publication rules; this plan does not authorize push or PR creation.

**Status:** Planned, 2026-09-29 (issue #173). UI approved; implementation not started. Supersedes the 2026-09-08 "Left capacity" plan, which lived at this path's predecessor `EXEC-project-track-left-capacity.md`.

**Goal:** In Project Track Team mode, add a thin strip under every track segment of the totals and By team bars that splits that track's SP by the parent Epic's current Board column, with a hover-only readout.

**Architecture:** One pure helper derives, per team row and per track, the SP for each resolved Board column from the stats-source stories already loaded for the Start–End range. `StackedBar` gains one opt-in strip prop that shares its segment width math and its bounded readout. The Board's column-ownership rule is extracted from `engBoardColumns.js`, not copied. The only backend change adds Jira `status` to the stats-source field list, so Team mode can exclude Killed stories. No new API, no new request, no Board data load on Statistics.

**Tech stack:** React 19, existing CSS/esbuild, Node `node:test` unit tests, Python `unittest`, existing Playwright mocked dashboard fixture.

**Approved design:** [Decision](SUPPORT-project-track-board-column-strips-design.md) and [standalone visual](../../assets/mockups/project-track-board-column-strips.html). Both are normative.

## Evidence and boundaries (verified against `main` e886a654, 2026-09-29)

- `frontend/src/stats/projectTrackStats.js`: `inScope()` drops stories whose `fields.epicStatus` is Done/Killed/Incomplete (`CLOSED_EPIC_STATUSES`, #186) for every mode. Sprint membership uses `firstSprint()`; that range behavior is not changed here. `buildProjectTrackBreakdownRows` in Team mode assigns every scoped story to a row (`teamId || teamName || 'unknown'`), so the rows sum to the totals.
- `dashboard.jsx` `projectTrackOpts` already carries `mode`. It builds `projectTrackSeries` → `summarizeProjectTrackTotals` → `ProjectTrackTotalsBar`, plus `projectTrackBreakdown` → `ProjectTrackBreakdownChart`, all from `excludedCapacityIssues`. `activeGroup` (`useMemo`) already exposes `activeGroup.board?.columns` (`{id, name, colour, statuses[]}`, shared Department config loaded at bootstrap; the ENG Board reads the same value).
- `frontend/src/eng/engBoardColumns.js` `buildBoardColumns` owns the column rule: exact `epicStatusName` match; first column wins a duplicated status; an unlisted status lands in the first column; columns without statuses are dropped; no usable column → synthetic "All epics". `deriveDefaultBoardColumns(statuses)` builds To Do / In Progress / Done from status names. Colours come from `BOARD_COLUMN_COLOURS` in `settings/groupBoardModel.js`.
- `jira_server.py` `_build_excluded_capacity_stats_source_fields` requests only SP, parent, project, sprint, Epic link and team. The payload builder already maps `fields.status` → `{name}` when present, and emits `epicStatus`. The server cache key hashes the field list, so adding `status` invalidates old entries safely. The base stats JQL has no status filter, so Killed stories are present today.
- `StackedBar.jsx` is shared by the Project Track totals, breakdown and phase charts. It has a portal readout clamped with a fixed `READOUT_HEIGHT = 72`, `resolveSegmentLink` anchors (No track links in By assignee), and a 10.5% compact-label rule. The global `button` / `button:hover` rules in `eng/controls.css` give segments a `translateY(-1px)` lift and a `#2f2f2f` background on hover.
- `backend/services/eng_board.py:902-907` is the authoritative server ownership rule (first column wins, unlisted → first column); the frontend `buildBoardColumns` rule matches it. The live Board uses the strict server path and shows one "All epics" column when no board is configured; To Do / In Progress / Done is the Board **composer's** Reset default (`deriveDefaultBoardColumns`), which accepts only `{ name }` rows and mints random column ids.
- `tests/test_codebase_structure_budgets.py` pins `frontend/src/dashboard.jsx` at exactly its current 18207 lines and `jira_server.py` at 6463. Any growth must raise the budget with a rationale comment in the same change.
- The smoke spec bundles JS with CSS stubbed and reads styles from `frontend/dist/`, so `npm run build` must run before Playwright.
- Read MRT017 (hover bounds), MRT020 and MRT021 (reuse without overriding shared controls), and MRT029 (a new category reuses its component's visual language) before execution.
- Frontend display/aggregation plus one read-only field-list addition. No storage, ownership, auth, settings, Home, Jira write, or new endpoint work is authorized.

## File map

Modify:

| File | Responsibility |
| --- | --- |
| `jira_server.py` | Add `status` inside the existing field tuple of `_build_excluded_capacity_stats_source_fields` (no new lines) |
| `tests/test_excluded_capacity_stats_api.py` | Update the exact field-list assertion (~:265-272) |
| `frontend/src/eng/engBoardColumns.js` | Export the extracted column-ownership resolver; `buildBoardColumns` uses it unchanged |
| `frontend/src/stats/projectTrackStats.js` | Team-mode scope (all Epics, Killed excluded) and the Board-column split helper |
| `frontend/src/stats/StackedBar.jsx` | Opt-in `resolveSegmentStrip` prop, strip rendering, multi-line bounded readout |
| `frontend/src/stats/ProjectTrackTotalsBar.jsx` | Pass the All teams strip split when provided |
| `frontend/src/stats/ProjectTrackBreakdownChart.jsx` | Pass per-team strip splits when provided |
| `frontend/src/styles/stats/project-track.css` | Strip geometry, readout swatch, no-lift segment hover |
| `frontend/src/dashboard.jsx` | Resolve Board columns and wire the split only in Team mode |
| `tests/test_project_track_stats.js` | Team scope and split calculations |
| `tests/test_eng_board_columns.js` | Extracted resolver keeps Board behavior |
| `tests/test_stacked_bar_render.js` (Create) | `renderToStaticMarkup` goldens for `StackedBar` without the strip prop, the phase `formatReadout` path, and with strips |
| `tests/test_codebase_structure_budgets.py` | Raise the `dashboard.jsx` budget by the measured growth, with rationale |
| `tests/ui/codebase_structure_smoke.spec.js` | 12-team/12-column fixture, geometry, hover, Epic-mode absence |
| `docs/features/statistics.md` | Team-mode scope change, strips, readout |
| `docs/ontology.md` | Project Track and Statistics source entries |
| `docs/README_ANALYTICS.md` | Extend the Project Track hover allowlist row |
| `docs/plans/EXEC-project-track-board-column-strips.md` | Progress and verification evidence |
| `docs/plans/README.md` | Execution status |

Generated only: `frontend/dist/` via `npm run build`.

Read/reuse without modifying: `frontend/src/settings/groupBoardModel.js`, `frontend/src/eng/engTaskUtils.js` (`epicStatusName`), `frontend/src/ui/hoverBubblePosition.js`, `frontend/src/stats/statsUtils.js` (`resolveProjectTrackColor`), `frontend/src/stats/excludedCapacityStats.js` (`storyPointsFor`), `frontend/src/styles/eng/controls.css`, `frontend/src/analytics/dashboardAnalytics.js`, `tests/test_analytics_events.js`.

## Task 1 — Stats source carries story status (backend, fail-first)

- [ ] Update the exact field-list assertion in `tests/test_excluded_capacity_stats_api.py` (~:265-272) to expect `'status'` once, after the team field. Run `.venv/bin/python -m unittest tests.test_excluded_capacity_stats_api` and confirm it fails. (The payload already maps `fields.status` when Jira returns it, `jira_server.py:5408,5421`; keep one assertion for it, which already passes.)
- [ ] Add `'status'` inside the existing tuple on the `for field_id in (...)` line so `jira_server.py` does not grow. Re-run that file. No response-shape or cache-TTL change.

## Task 2 — Reuse the Board column rule (extract, not copy)

- [ ] In `tests/test_eng_board_columns.js`, add tests for `resolveBoardColumnOwner(columns)` returning `(statusName) => columnId`: exact match; first column wins a duplicate; unlisted status → first live column; columns without statuses ignored; when no column has statuses the factory returns `null` (callers decide the fallback). Confirm they fail.
- [ ] Extract the existing `ownerByStatus` block of `buildBoardColumns` into exported `resolveBoardColumnOwner`, and have `buildBoardColumns` call it after its unchanged early synthetic "All epics" return. Existing `tests/test_eng_board_columns.js`, `tests/test_eng_board_render.js` and `tests/test_eng_board_view_model.js` stay green without edits.

## Task 3 — Team-mode scope and split model (pure, fail-first)

- [ ] In `tests/test_project_track_stats.js`, extend the `story()` fixture with `opts.status` (sets `fields.status = {name}`) and `opts.noEpic` (clears `epicKey` and `epicStatus`). Add failing tests:
  - Rewrite the existing #186 test (`tests/test_project_track_stats.js:53-67`, which runs with Team-mode `base`) to assert the closed-Epic exclusion with `mode: 'epic'` for the series, `inScopeEpicKeys` and the breakdown. Add a Team-mode case: Done and Incomplete Epics stay in the series, totals and rows; Killed drops.
  - Team mode drops stories with status Killed (any case/whitespace) and stories under a Killed Epic, from every Team-mode helper.
  - `buildProjectTrackColumnSplit(rows-source tasks, opts, columns)` returns `{ columns, rows: Map<rowId, {[track]: {[columnId]: sp}}>, all: {[track]: {[columnId]: sp}} }`, where `columns` is the resolved ordered list `{id, name, colour}` plus a trailing `{id: 'no-epic', name: 'No Epic', colour: '#e8edf7'}` only when a story has no Epic.
  - Conservation: for every row and track, the column SP sum equals `row.byTrack[track]` from `buildProjectTrackBreakdownRows` (float tolerance); `all` equals the sum of rows and matches `summarizeProjectTrackTotals`.
  - Column resolution uses the Task 2 resolver on `fields.epicStatus` (a plain string); an unlisted status, or an Epic with a null status, → first column; decimals preserved; zero-SP stories ignored like the existing helpers.
  - Default board: when the factory returns `null`, map the distinct observed Epic status names to `{ name }` rows (sorted for determinism) and call `deriveDefaultBoardColumns`, then replace its random ids with fixed render-only ids `default-to-do`, `default-in-progress`, `default-done`. Result: To Do / In Progress / Done in template order, only phases that hold a status. Assert the ids are stable across calls.
  - Colours: a column colour not in `BOARD_COLUMN_COLOURS` falls back to `DEFAULT_COLUMN_COLOUR`, as `renderColumn` does (`engBoardColumns.js:119`). There are 7 colours for up to 12 columns; repeated colours are expected and the readout names disambiguate.
- [ ] Implement: in `inScope`, apply `CLOSED_EPIC_STATUSES` only when `(opts.mode || 'epic') === 'epic'`; when `opts.mode === 'team'`, instead return false for a Killed story status or a Killed Epic status. Add `buildProjectTrackColumnSplit` using the same `inScope`, `storyPointsFor`, `trackOf` and team-row identity as `buildProjectTrackBreakdownRows`. Do not mutate input and do not duplicate the Board rule.
- [ ] Re-run `node --test tests/test_project_track_stats.js tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js tests/test_eng_board_columns.js`.

## Task 4 — `StackedBar` opt-in strip and readout

- [ ] Add optional `resolveSegmentStrip({ row, segmentKey, segment, value })` returning `{ parts: [{ key, label, colour, value }] }` or `null`. With the prop absent, the rendered markup stays identical: first add `tests/test_stacked_bar_render.js` (pattern: `tests/test_eng_board_render.js:5-11`) with `renderToStaticMarkup` goldens for the current `StackedBar` (default path, `resolveSegmentLink` anchor path, and the `ProjectTrackPhaseChart` `formatReadout` path), captured before editing; they must stay unchanged.
- [ ] With the prop present, render the existing `.stacked-bar-track` plus a sibling `.stacked-bar-strips` row inside a `.stacked-bar-track-stack` wrapper. For each rendered segment (same order, the same `value <= 0` omission, the same `width`), render one `.stacked-bar-strip` with that width containing `.stacked-bar-strip-part` spans (width = part SP / segment SP; zero parts omitted from the strip). A strip is a focusable non-button element (`tabIndex=0`, `role="group"`, `aria-label` = the readout text) with no click handler.
- [ ] Extend the readout state with optional `lines: [{ label, colour, valueText }]`. For a strip: a `<strong>` line with the row label, a line `Track: N SP`, then one line per part in column order, including 0 SP parts, each with a colour swatch. Clamp the position with a height derived from the line count instead of the fixed 72px, so a 12-column readout stays inside the viewport (MRT017). Pointer hover, pointer move, focus and blur behave like segments; no click. The row label may ellipsize, but the `Track: N SP` line and every column line must be unclipped at the existing 220px max width (assert `scrollWidth <= clientWidth`, MRT020).
- [ ] Keep `resolveSegmentLink` anchors working with strips present (By team has no links today; cover it in the unit/UI tests anyway).

## Task 5 — Styling

- [ ] In `project-track.css`: `.stacked-bar-track-stack { display: grid; gap: 3px; min-width: 0 }`; `.stacked-bar-strips { display: flex; min-width: 0 }`; `.stacked-bar-strip { flex: 0 0 auto; display: flex; height: 7px; overflow: hidden; background: #e8edf7 }` with 3px outer radii on the first and last strip; a 2px white `border-left` on each strip after the first (inside its width, so edges stay aligned); `.stacked-bar-strip-part { display: block; height: 100%; flex-shrink: 0 }`; a 10×5px swatch inside `.stacked-bar-readout`.
- [ ] Hover: `.stacked-bar-segment:hover` and `.stacked-bar-strip:hover, :focus-visible` → `transform: none`, keep `background: var(--stacked-bar-color)`, soft shadow (inset highlight on segments, `0 2px 6px rgba(26,26,26,0.18)` on strips). Do not touch the global `button` rules or other controls; the view switch keeps its lift.
- [ ] No animation on strips. At ≤760px the existing single-column row layout applies unchanged.

## Task 6 — Wiring

- [ ] `ProjectTrackTotalsBar` and `ProjectTrackBreakdownChart` accept an optional `columnSplit` and pass `resolveSegmentStrip` only when it is present. Keep their existing props, row labels (the totals row keeps `rangeLabel`, so its readout title is the range label), links and empty text unchanged. The totals track legend follows decision D1 below.
- [ ] In `dashboard.jsx`, memoize `projectTrackColumnSplit = projectTrackMode === 'team' ? buildProjectTrackColumnSplit(excludedCapacityIssues, projectTrackOpts, activeGroup?.board?.columns || []) : null` next to `projectTrackBreakdown`, and pass it to both components. No new state, effect, fetch or request-list change. Measure the `dashboard.jsx` growth and raise its budget in `tests/test_codebase_structure_budgets.py` with a one-line rationale; keep the growth to the memo and two props.

## Task 7 — UI acceptance

- [ ] Run `npm run build` first; the smoke spec reads CSS from `frontend/dist/`.
- [ ] In `tests/ui/codebase_structure_smoke.spec.js`, reuse `installApiMocks` and `makeExcludedCapacityIssue` (add an optional `status` argument, default `'To Do'`). Use synthetic data only:
  - 12 teams with unequal totals, one long team name, decimal SP, a tiny track segment, an absent track, a No track segment, one story without an Epic, and one Killed story plus one story under a Killed Epic;
  - a group with a 12-column configured Board, one Epic status that no column lists, plus a second run with no Board config (default split).
- [ ] Assert: each strip's left/right edges match its segment within 1px; strip height 7px; part width ratios match SP ratios; Killed SP absent from totals and rows; Done-Epic SP present in Team mode and absent in Epic mode; strips absent in Epic mode (totals, By assignee, phase); no text node containing `left` inside the Project Track cards; no legend beyond the existing totals track legend.
- [ ] Hover a strip: the readout title and one line per column (including a `0 SP` column), bounded inside the viewport at the right and bottom edges. Tab-focus shows the same readout. A click performs no navigation and fires no request.
- [ ] Hovering a segment has computed `transform: none`; the main view-switch button still lifts on hover.
- [ ] Request-count assertion: start in Epic mode and wait for the one-time phase-duration fetch; then toggle Team → Epic → Team and hover strips; assert no new API calls.
- [ ] The Team-mode "Story points per sprint" chart includes Done-Epic SP and excludes Killed SP (it shares the Team-mode scope).
- [ ] Capture and inspect settled screenshots at 1280px and 375px with all 12 teams visible and a strip readout open. Compare them with the approved preview.
- [ ] Keep the existing Project Track, Excluded Capacity, Mono vs Cross and ENG Board tests green.

## Task 8 — Docs, analytics, verification

- [ ] `docs/features/statistics.md`: Team mode (totals, per-sprint chart and By team) counts all Epics in the range and excludes Killed stories and Killed Epics; Epic mode keeps the closed-Epic exclusion; the strip definition, column mapping, default board and `No Epic` part; hover-only readout.
- [ ] `docs/ontology.md`: update Project Track (split helper, `StackedBar` strip prop) and Statistics source (`status` field). Record the verification date.
- [ ] `docs/README_ANALYTICS.md`: extend the existing "Project Track chart segment/legend hover…" no-event row to cover strip hover/focus readouts: informational, reading already-loaded values, no event, no persistence. Run `node --test tests/test_analytics_events.js`.
- [ ] Run and record real results:

```bash
.venv/bin/python -m unittest tests.test_excluded_capacity_stats_api
node --test tests/test_project_track_stats.js tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js tests/test_eng_board_columns.js tests/test_eng_board_render.js tests/test_eng_board_view_model.js tests/test_analytics_events.js
node --test tests/test_stacked_bar_render.js tests/test_analytics_source_guards.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g 'Project Track'
git diff --check
```

- [ ] Before any publication: the full suites `python3 -m unittest discover -s tests`, `npm run test:frontend:unit` and `npm run test:frontend:ui`, plus the section 10 publication gates.
- [ ] Set Status to In progress during execution, and record each task's result below. Rename to `DONE-*` only after verification and acceptance or merge.

## Decisions

- D1 — open: the existing totals-card track legend (Committed / Flexible / No track swatches). The approved preview omits it and the user asked to drop the legend pane; `ProjectTrackSprintChart` has its own legend. Remove it in Team mode, in both modes, or keep it. Default until answered: keep it unchanged.
- D2 — resolved 2026-09-29: an unconfigured Department uses the composer's To Do / In Progress / Done default for the strips, even though the Board page itself shows one "All epics" column.
- D3 — resolved: the preview's "Killed excluded" header text and its `project-track-column-strip*` class names are mockup-only; production uses `stacked-bar-strip*` classes and documents Killed exclusion in `docs/features/statistics.md`.

## Progress

| Task | Status | Evidence |
| --- | --- | --- |
| 1 | Not started | |
| 2 | Not started | |
| 3 | Not started | |
| 4 | Not started | |
| 5 | Not started | |
| 6 | Not started | |
| 7 | Not started | |
| 8 | Not started | |

## Planning self-review

Verified against `main` e886a654: every modified file exists; `activeGroup.board?.columns` is loaded without a Stats request; `epicStatus` is already in the payload; story status is not, so Task 1 is required for the Killed exclusion. Team-mode totals intentionally change (closed Epics now count, Killed stories are excluded), and this is documented for users in Task 8. The earlier "left capacity" requirements are withdrawn by the 2026-09-29 decision.
