# Project Track Left Capacity Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Follow repository publication rules; this plan does not authorize commit, push, or PR creation.

**Status:** Planned, 2026-09-08. UI approved; implementation not started.

**Goal:** Extend Project Track's By team bars with aligned Board-style status strips and exact selected-sprint SP left.

**Architecture:** Aggregate the existing normalized stats-source stories in a pure helper. Extend the shared stacked-bar primitive with an opt-in segment-footer slot; render the status strips through the Project Track breakdown component. Reuse the existing scoped, progressive source cache and request wrapper; do not add an API or a history fetch.

**Tech stack:** React 19, existing CSS/esbuild, Node unit tests, existing Playwright mocked dashboard fixture; existing Flask stats-source contract.

**Approved design:** [Decision](SUPPORT-project-track-left-capacity-design.md) and [standalone visual](../../assets/mockups/project-track-left-capacity.html). These are normative, including current-sprint scoping, track order, 7px strips, inline readout, and responsive fallbacks.

## Evidence and boundaries

- `projectTrackStats.js` currently aggregates range SP and reads `epicProjectTrack`, team identity, and normalized sprint fields. Its `firstSprint()` assumption must not be copied into selected-sprint membership: a carried story can have multiple sprint entries.
- `jira_server.py`'s stats-source normalization already supplies `fields.status.name`, `customfield_10004`, `customfield_10101`, team identity, and `epicProjectTrack`. No status category or Epic lifecycle status is supplied. Do not plan against invented fields.
- `StackedBar.jsx` is shared by totals, breakdown, and phase consumers; default rendering and hover behavior must remain unchanged.
- `EngBoardEpicCard.jsx` reuses `.story-subtasks-progress-*` styling. `computeEpicStoryProgress()` counts stories, includes abandoned stories in its denominator, and classifies Incomplete as in progress. It is **not** the capacity calculation.
- The existing source loader uses per-sprint/per-team-signature cache entries, bounded chunk loading, cancellation, and 30-second timeouts. Reuse those safeguards.
- Read MRT017 (hover bounds), MRT020 (bespoke filter controls), MRT021 (overriding shared segmented controls), and the root instruction chain before execution.
- This is frontend display/aggregation work. No storage, ownership, auth migration, settings permission, Home, Jira write, or publication work is authorized.

## File map

Modify:

| File | Responsibility |
| --- | --- |
| `frontend/src/stats/projectTrackStats.js` | Pure selected-sprint capacity model and status buckets |
| `frontend/src/stats/ProjectTrackBreakdownChart.jsx` | Optional capacity mode, strips, legend, inline readout |
| `frontend/src/stats/StackedBar.jsx` | Opt-in footer slot sharing segment width math |
| `frontend/src/styles/stats/project-track.css` | Aligned footer geometry and compact responsive layout only |
| `frontend/src/dashboard.jsx` | Selected-sprint source state and By team wiring; existing filters stay intact |
| `tests/test_project_track_stats.js` | Calculation and membership fixtures |
| `tests/ui/codebase_structure_smoke.spec.js` | Existing Project Track fixture, data loading, interaction, geometry, screenshots |
| `tests/test_excluded_capacity_stats_source_guards.js` | Preserve dedicated stats-only loading constraints |
| `docs/features/statistics.md` | Explain current-sprint By team exception and metric definitions |
| `docs/README_ANALYTICS.md` | Explicit informational-readout no-new-event allowlist entry |
| `docs/plans/EXEC-project-track-left-capacity.md` | Task progress and verification evidence |
| `docs/plans/README.md` | Execution status |

Generated only: `frontend/dist/` via `npm run build`.

Read/reuse without modifying: `frontend/src/stats/excludedCapacityStats.js`, `frontend/src/stats/statsUtils.js`, `frontend/src/eng/engTaskUtils.js`, `frontend/src/styles/eng/issues.css`, `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/engBoardCardModel.js`, `backend/routes/stats_routes.py`, `jira_server.py`, `frontend/src/analytics/dashboardAnalytics.js`, `tests/test_analytics_events.js`.

Existing files in this map were checked during planning. Verify them again before execution. The approved mockup and design decision are fixed references, not targets for an implementation-driven redesign.

## Task 1 — Pure model, with fail-first tests

- [ ] Add tests to `tests/test_project_track_stats.js` for `buildProjectTrackLeftCapacityRows(tasks, opts)`. Keep the current helper tests intact. Define opts as existing capacity-side/exclusion sets plus `selectedSprintId` and `teamIds` (a Set of scoped team IDs).
- [ ] Use this exact core fixture/assertion pattern, extending the existing `story()` fixture with status:

```js
const tracked = (key, sp, status) => ({
  ...story(key, sp, 'Committed', '10'),
  fields: { ...story(key, sp, 'Committed', '10').fields,
    status: { name: status } }
});
const result = buildProjectTrackLeftCapacityRows([
  tracked('SYN-1', 5, 'Done'),
  tracked('SYN-2', 2, 'Incomplete'),
  tracked('SYN-3', 3, 'In Progress'),
  tracked('SYN-4', 2, 'To Do'),
  tracked('SYN-5', 99, 'Killed')
], { ...base, selectedSprintId: '10', teamIds: new Set(['team-a']) });
assert.deepEqual(result.rows[0].capacityByTrack.Committed, {
  total: 12, spent: 7, inProgress: 3, todo: 2, left: 5,
  residualByStatus: { 'To Do': 2 }
});
```

- [ ] Run `node --test tests/test_project_track_stats.js`; confirm the new test fails because the exported helper is missing, then implement it.
- [ ] Normalize selected sprint IDs to strings and match **any** entry of `fields.customfield_10101`; deduplicate by issue key/id before summing. Do not mutate input. Reuse `storyPointsFor`, existing capacity classification/exclusion logic, and `getStatusPhaseRank`.
- [ ] Follow this bucket precedence exactly:

```js
const status = String(task.fields?.status?.name || '').trim();
const normalized = status.toLowerCase();
if (normalized === 'killed') continue;
const bucket = normalized === 'done' || normalized === 'incomplete'
  ? 'spent' : getStatusPhaseRank(status) === 4 ? 'inProgress' : 'todo';
```

- [ ] Return `{ rows, tracks: ['Committed', 'Flexible'], unestimatedCount }`. Each row is `{id, label, total, byTrack, capacityByTrack}`. `byTrack` contains track totals; `capacityByTrack` uses the exact shape above. Sum at full numeric precision; round only display formatting. Sort by descending team total, then label for ties. Omit zero-SP teams; disclose missing estimates separately.
- [ ] Cover decimals; case/whitespace; Done vs Incomplete; In Progress, Release, To Do, blocked and unknown statuses; missing estimates; Killed; missing/unknown track; no selected sprint; duplicate records; selected sprint second in the sprint array; out-of-scope team/sprint; zero track; all-spent team; Product/Tech/Ad Hoc exclusions. Assert conservation: `spent + inProgress + todo === total` within floating tolerance, and `left === inProgress + todo`.
- [ ] Re-run the file and `node --test tests/test_excluded_capacity_stats.js`; all existing range/dominant-sprint calculations must still pass.

## Task 2 — Obtain the correct sprint without duplicate requests

- [ ] Extend the existing Project Track UI test fixture with a header sprint outside the Start/End range. Prove the card must show only that header sprint, while the totals/per-sprint sections keep the range. Add request-count assertions before loader changes.
- [ ] In `dashboard.jsx`, give Left capacity a separate selected-sprint data/loading/error state. For `statsView === 'projectTrack' && projectTrackMode === 'team'`, derive a deduplicated source request list with the selected sprint first, followed by the existing range IDs. Reuse `fetchSprintChunk` and the existing cache keys, wrapper, cancellation, timeout, and concurrency limit.

```js
const requestedSprintIds = needsLeftCapacity && selectedSprint
  ? [...new Set([String(selectedSprint), ...excludedCapacitySprintIds])]
  : excludedCapacitySprintIds;
```

- [ ] In each successful `fetchSprintChunk(sprintId)`, including the cache-hit path, populate the selected-sprint state only when the current generation is still active and the ID matches the captured selected sprint. Reuse its `data.issues` for Task 1. Filter aggregate progress/final chunks back to the existing range before calling `mergeExcludedCapacityStatsSourceChunks`; keep range counts and range cache payloads range-only.
- [ ] Keep an effect-local `Map` from requested sprint ID to its success/error result; the shared chunk loader filters sparse arrays and its payloads do not carry a reliable sprint ID. Build range merges from that map in range order, retaining range-specific failure warning chunks. Never match a chunk to a sprint by its compacted array index or by its first issue. Preserve `meta.warnings`/`meta.truncated`; incomplete selected-sprint data must show an incomplete-data state, not claim exact final capacity or silently convert a failed request into an empty team list.
- [ ] Audit the existing early range-cache return: it may return only after the selected-sprint data has also been supplied or scheduled. An in-range selected sprint must fetch at most once per scoped load; an out-of-range sprint adds at most one chunk. Selected-sprint failure must not be masked by successful range chunks. Conversely, range failure must not suppress a successfully loaded selected-sprint card.
- [ ] Include selected sprint, Team-mode need, and existing scope signatures in effect dependencies. Clear stale capacity rows/readout on sprint/team/Department change. On abort or stale completion, do not update the new scope. Force refresh replaces both datasets under the current scope.
- [ ] Keep other Stats tabs' request lists and behavior unchanged. Never mount ENG alerts, task lists, or Board fetches to obtain capacity. No changelog fetch, per-story enrichment, new endpoint, or request on strip click.
- [ ] Exercise cold/cached loads, scope changes during load, selected-sprint-only failure, empty scope, refresh, and terminal app-wide 401 recovery in the existing mocked dashboard fixture.

## Task 3 — Extend the existing bars exactly as approved

- [ ] Add an optional `renderSegmentFooter({row, segmentKey, value, width})` prop to `StackedBar`. With the prop absent, retain its original DOM/CSS and hover behavior. With it present, place the original `.stacked-bar-track` and a separate aligned flex footer inside one visual column. Use the **same** segment order, omission rule, denominator and percentage for the main segment and its footer.
- [ ] Implement this footer structure (no nested buttons):

```jsx
<div className="project-track-capacity-footer" style={{ width: `${width}%` }}>
  <button type="button" className="project-track-capacity-strip"
    aria-label={readoutText} onClick={() => setReadout(readoutText)}
    onFocus={() => setReadout(readoutText)}>
    <span className="story-subtasks-progress-segment story-subtasks-progress-done"
      style={{ width: `${spent / total * 100}%` }} />
    <span className="story-subtasks-progress-segment story-subtasks-progress-in-progress"
      style={{ width: `${inProgress / total * 100}%` }} />
    <span className="project-track-capacity-todo"
      style={{ width: `${todo / total * 100}%` }} />
  </button>
  <div className="project-track-capacity-left"><strong>{formatSP(left)}</strong> left</div>
</div>
```

- [ ] Define the snippet's values from `row.capacityByTrack[segmentKey]`. Guard total > 0 before rendering. Define `formatSP` with the existing one-decimal SP formatting convention. Build `readoutText` from team, track and all exact buckets, including actual residual statuses when not literally To Do. `setReadout` belongs to `ProjectTrackBreakdownChart`; reset it on model/scope change.
- [ ] Add an optional capacity-data prop to `ProjectTrackBreakdownChart`. In capacity mode, pass the new rows and footer renderer, render the approved legend and one inline live readout. Keep the original default branch for existing non-capacity consumers.
- [ ] In `dashboard.jsx`, wire the enhanced existing **By team** card only in Team mode; put the header sprint name in its card header. Keep the existing mode title and other range charts unchanged. Render loading/error/empty content inside this card, not misleading zeros or stale rows. Remove sample-only text from production.
- [ ] CSS: preserve original main-bar height (28px), track colors and shared row label column; add 3px gap, 7px strip, compact left-label row, and existing Board colors. Override animation only on the new strip's progress span. Preserve track boundary alignment at every width. Provide a larger transparent interaction hit area without overlapping adjacent controls; essential left values never require hovering.
- [ ] On narrow layouts reuse the existing labels/total/bar arrangement and the approved narrow fallback. Do not force long left quantities into tiny segments; measure text-bearing elements, not just outer boxes. Existing main bar hover readouts still use the shared bounded portal; the new status readout is inline.

## Task 4 — UI acceptance and regressions

- [ ] Extend `tests/ui/codebase_structure_smoke.spec.js` using the existing `installApiMocks`/dashboard shell pattern. Use synthetic 12-team fixtures with unequal totals, long names, decimal SP, one tiny track, one absent track, one all-spent team, unknown status and missing estimates.
- [ ] Assert each main track and its footer share left/right coordinates to within 1 CSS pixel. Assert the status strip is 7px high; status segment fractions match SP ratios; left labels never overlap or clip; each team row remains compact. Verify the status split is reset at each Committed/Flexible boundary.
- [ ] Assert click, Tab focus, Enter and Space reveal the exact breakdown in the single inline readout; no navigation/API request occurs. Scope changes reset the selected readout. Inspect the displayed green label: it must say Spent (Done + Incomplete).
- [ ] Capture and inspect settled screenshots at 1280px and 375px with all 12 teams, including the bottom rows; compare against the approved reference. Also inspect a narrow segment and long/three-digit left values. Do not access the user's Firefox. Use the repository's isolated fixture/testing environment.
- [ ] Keep existing Project Track control geometry, range calculations, Epic mode, phase view, shared StackedBar hover/edge tests, Excluded Capacity and Mono vs Cross behavior green. Verify status strips are not rendered in By assignee or the range totals bar.
- [ ] Run:

```bash
node --test tests/test_project_track_stats.js tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g 'Project Track'
npm run build
git diff --check
```

Expected: all named tests pass, build exits 0, no whitespace errors. If a server is required by the existing UI fixture, use its documented setup and an isolated test instance. Record commands and real results, not expected results as proof. Before publication, run the full suites and the separate repository publication gates.

## Task 5 — Documentation, analytics, and review

- [ ] Update `docs/features/statistics.md`: the By team card uses the header-selected sprint; range controls still govern range charts. Document the formula, status precedence, unestimated/residual handling, inherited filters, and interaction.
- [ ] Add a dated row to the no-new-event allowlist in `docs/README_ANALYTICS.md`: rendering, focusing and clicking the status strip only inspect already-loaded values, matching existing informational stacked-bar readouts. No independent workflow result or persistence occurs. Existing Stats view/mode/filter events remain unchanged. Trigger/event_type/event_name/typed params for the new informational readout are intentionally none; no duplicate events and no team names, issue keys, statuses or SP values are sent.
- [ ] Verify `node --test tests/test_analytics_events.js` remains green. No GA4 runbook or custom dimension change is needed; retain the existing pageview/userevent transport contract and gate.
- [ ] Review the complete diff against the approved design and allowed file map. Reject unrelated changes. Confirm default shared-bar consumers remain intact. Record screenshots and actual verification results in this plan.
- [ ] Leave status Planned until execution begins; use In progress during execution. Rename EXEC to DONE only after implementation is verified and accepted/merged, updating the index and execution reference. Do not publish an execution handoff while these artifacts are local-only.

## Planning self-review

The original burndown proposal is superseded. The accepted strip geometry, SP definitions and exact values are captured in the design reference and mapped to Tasks 1–4. Payload feasibility was traced to the actual normalizer. No backend contract changes are planned. Scope loading and status differences from Board are explicitly covered; duplicating Board's calculation or mixing a range total with a one-sprint status strip would fail the contract. Implementation tests and screenshot verification have not run because implementation has not started.
