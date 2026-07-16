# Excluded Capacity Control Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Implemented and verified locally on 2026-07-16; pending PR review/merge.

**Goal:** Render Sprint, Excluded Epics, Series mode, and Metric in one ordered Excluded Capacity desktop control row.

**Architecture:** Reorder the existing JSX and move the existing action wrapper into the existing `.excluded-capacity-filter-controls` grid. Change only feature-owned CSS and focused layout guards; keep every control component, state handler, analytics callback, and data flow intact.

**Tech Stack:** React 19, CSS Grid/Flexbox, Node test runner, Playwright, esbuild.

## Global Constraints

- Desktop DOM and visual order is Sprint, Excluded Epics, Series mode, Metric.
- Excluded Epics consumes remaining row width; the other groups stay content-sized.
- Narrow layouts wrap or stack in the same order without clipping or overlap.
- No analytics event, API, state, calculation, or reusable control changes.
- Rebuild `frontend/dist/`; do not hand-edit generated files.

---

### Task 1: Excluded Capacity control-row layout

**Files:**
- Modify: `tests/test_excluded_capacity_stats_source_guards.js`
- Modify: `tests/ui/codebase_structure_smoke.spec.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/stats/excluded-capacity.css`
- Generate: `frontend/dist/dashboard.js`
- Generate: `frontend/dist/dashboard.js.map`
- Generate: `frontend/dist/dashboard.css`

**Interfaces:**
- Consumes: existing `StatsRangeControl`, Excluded Epics dropdown, and two `SegmentedControl` instances.
- Produces: one `.excluded-capacity-filter-controls` row whose direct children are the range group, epic filter, and `.excluded-capacity-actions` wrapper in that order.

- [x] **Step 1: Write failing source and rendered-layout tests**

Update the source guard to assert the JSX order and these feature-owned CSS assignments:

```js
assert.ok(
    dashboardSource.indexOf('idPrefix="excluded-capacity-sprint"') <
        dashboardSource.indexOf('className="stats-control-group excluded-capacity-epic-filter"'),
    'Expected Sprint to precede Excluded Epics in DOM order'
);
assert.match(cssSource, /grid-template-columns:\s*max-content minmax\(240px, 1fr\) max-content/);
assert.match(cssSource, /\.excluded-capacity-actions\s*\{[\s\S]*grid-column:\s*3/);
```

In the existing Excluded Capacity Playwright test, measure direct-child left-to-right ordering for Sprint, Excluded Epics, and the actions wrapper. Assert the actual Sprint, Excluded Epics, Series mode, and Metric control surfaces share the same top edge and that segmented-control labels are not clipped. Measure the interactive controls rather than their differently headed parent groups, per MRT020.

- [x] **Step 2: Run tests to verify they fail for the old layout**

Run:

```bash
node --test tests/test_excluded_capacity_stats_source_guards.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Excluded Capacity summary"
```

Expected: the source guard fails because Excluded Epics precedes Sprint and the actions wrapper is outside the grid; Playwright fails its one-row geometry assertion.

- [x] **Step 3: Implement the minimal JSX and CSS change**

Move `StatsRangeControl` before the epic filter and move `.excluded-capacity-actions` inside `.excluded-capacity-filter-controls`. Preserve both `SegmentedControl` bodies exactly. Use:

```css
.excluded-capacity-filter-controls {
    grid-template-columns: max-content minmax(240px, 1fr) max-content;
}

.excluded-capacity-filter-controls [data-stats-range="excluded-capacity-sprint"] {
    grid-column: 1;
}

.excluded-capacity-filter-controls .excluded-capacity-epic-filter {
    grid-column: 2;
}

.excluded-capacity-filter-controls .excluded-capacity-actions {
    grid-column: 3;
    align-self: end;
    flex-wrap: nowrap;
    margin-bottom: 0;
}
```

Keep the existing `max-width: 760px` rule resetting all three items to automatic columns/rows, and allow `.excluded-capacity-actions` to wrap there.

- [x] **Step 4: Run focused tests and build**

Run:

```bash
node --test tests/test_excluded_capacity_stats_source_guards.js
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Excluded Capacity summary"
```

Expected: all commands exit 0, and the Playwright artifact shows one aligned desktop row without clipping or overlap.

- [x] **Step 5: Run final verification and commit**

Run:

```bash
npm run test:frontend:unit
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Excluded Capacity summary"
git diff --check
```

Inspect the settled Excluded Capacity screenshot, then commit the plan, tests, source, and generated bundle with a descriptive message.

## Outcome

- The source guard failed first because Sprint followed Excluded Epics; the rendered test failed first because the actions wrapper was outside the control row.
- The final row renders Sprint first, a flexible Excluded Epics filter second, and both existing segmented controls together on the right.
- The Playwright geometry check measures the interactive control surfaces rather than differently headed parent boxes, following MRT020.
- Verification passed: 523 frontend unit tests, 1,052 backend tests, two focused Statistics Playwright tests, production frontend build, and `git diff --check`.
- The settled 966px Statistics-panel screenshot was inspected: all four control surfaces share one row with no clipped or overlapping labels.
