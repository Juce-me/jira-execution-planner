# Statistics Module Extraction Plan

Extract statistics-related code from `dashboard.jsx` into `frontend/src/statistics/` — mirroring the `frontend/src/scenario/` pattern.

## Goal

Move pure functions, constants, and presentational components out of the 12,800-line monolith into focused, testable modules while keeping all stateful logic (useState, useEffect, useMemo) in `dashboard.jsx`.

## Current Scenario Pattern (Reference)

```
frontend/src/scenario/
├── scenarioUtils.js   — pure functions + constants (173 lines)
└── ScenarioBar.jsx    — thin memoized presentational component (35 lines)
```

**Rules followed by scenario extraction:**
1. Only pure functions and constants go into `*Utils.js` — zero closure dependencies.
2. Components are thin wrappers: parent pre-computes all props; component only renders.
3. All state, memos, effects, and handlers stay in `dashboard.jsx`.
4. esbuild picks up new imports automatically — no config changes needed.

## Proposed Statistics Structure

```
frontend/src/statistics/
├── statsConstants.js       — priority config, color palette, priority order maps
├── statsUtils.js           — pure calculation functions (rates, aggregation, formatting)
├── burnoutChartUtils.js    — burnout chart data model builder (pure function)
├── StatsTeamsView.jsx      — teams view table + bar chart component
├── StatsPriorityView.jsx   — priority matrix table + radar chart component
└── BurnoutChart.jsx        — burnout stacked area chart SVG component
```

---

## Step 1: Extract `statsConstants.js`

**What moves** (from `dashboard.jsx`):

| Constant | Current Location | Description |
|----------|-----------------|-------------|
| `DEFAULT_PRIORITY_WEIGHT_ROWS` | L51-58 | Frozen array of `{priority, weight}` objects |
| `priorityOrder` | L3212-3223 | Map of priority name → sort rank |
| `priorityAxis` | L3266 | Array of radar chart axis labels |
| `priorityLabelByKey` | L3267-3274 | Map of lowercase key → display label |
| `priorityAliases` | L3751-3756 | Map of Jira priority names → normalized keys |
| `radarPalette` | L3275-3288 | 12-color array for team charts |

**New file** (`frontend/src/statistics/statsConstants.js`):
```js
// Statistics constants — zero closure dependencies.

export const DEFAULT_PRIORITY_WEIGHT_ROWS = Object.freeze([
    { priority: 'Blocker', weight: '0.4' },
    { priority: 'Critical', weight: '0.3' },
    { priority: 'Major', weight: '0.2' },
    { priority: 'Minor', weight: '0.06' },
    { priority: 'Low', weight: '0.03' },
    { priority: 'Trivial', weight: '0.01' }
]);

export const PRIORITY_ORDER = { ... };
export const PRIORITY_AXIS = ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial'];
export const PRIORITY_LABEL_BY_KEY = { ... };
export const PRIORITY_ALIASES = { ... };
export const RADAR_PALETTE = [ ... ];
```

**Dashboard changes**: Replace inline definitions with `import { ... } from './statistics/statsConstants.js'`.

> Note: `DEFAULT_PRIORITY_WEIGHT_ROWS` is also used by the settings panel (`clonePriorityWeightRows` at L60). After extraction, both settings and stats code import from the same source.

**Verify**: `npm run build` succeeds. No behavioral change.

---

## Step 2: Extract `statsUtils.js`

**What moves** (pure functions only — no closures over component state):

| Function | Current Location | Signature |
|----------|-----------------|-----------|
| `formatPercent` | L3749 | `(value) → string` |
| `normalizePriority` | L3774-3777 | `(name) → string` |
| `getPriorityLabel` | L3779-3782 | `(name) → string` |
| `computeRate` | L3796-3801 | `(metrics) → number` |
| `getRateClass` | L3803-3808 | `(rate) → string` |
| `hashTeamId` | L3290-3297 | `(value) → number` |
| `resolveTeamColor` | L3299-3303 | `(teamId) → string` |
| `buildRadarPoints` | L3833-3844 | `({values, radius, center, maxValue, axes}) → string` |
| `buildLocalStatsFromTasks` | L3846-3948 | `(taskList, excludedSet, opts) → statsData` |

**Closure-breaking changes needed:**

- `normalizePriority` currently closes over `priorityAliases` — after Step 1 it imports from `statsConstants.js` instead.
- `getPriorityLabel` closes over `normalizePriority` + `priorityLabelByKey` — same fix: import constants, call local `normalizePriority`.
- `resolveTeamColor` closes over `radarPalette` — import from `statsConstants.js`.
- `buildLocalStatsFromTasks` closes over `normalizeStatus`, `getTeamInfo`, `techProjectKeys`, `selectedSprintInfo` — must be refactored to accept these as parameters:
  ```js
  export function buildLocalStatsFromTasks(taskList, excludedSet, {
      normalizeStatus,
      getTeamInfo,
      techProjectKeys,
      sprintName
  })
  ```
  The call site in dashboard.jsx passes these from its existing scope.

- `computePriorityWeighted` (L3784-3794) closes over `effectivePriorityWeightMap` (a memo). **Solution**: accept the weight map as a parameter:
  ```js
  export function computePriorityWeighted(priorities, weightMap)
  ```

**New file** (`frontend/src/statistics/statsUtils.js`):
```js
import { PRIORITY_ALIASES, PRIORITY_LABEL_BY_KEY, RADAR_PALETTE } from './statsConstants.js';

export function formatPercent(value) { ... }
export function normalizePriority(name) { ... }
export function getPriorityLabel(name) { ... }
export function computePriorityWeighted(priorities, weightMap) { ... }
export function computeRate(metrics) { ... }
export function getRateClass(rate) { ... }
export function hashTeamId(value) { ... }
export function resolveTeamColor(teamId) { ... }
export function buildRadarPoints({ values, radius, center, maxValue, axes }) { ... }
export function buildLocalStatsFromTasks(taskList, excludedSet, opts) { ... }
```

**Dashboard changes**: Replace inline function definitions with imports. Update call sites for functions that gained parameters (`computePriorityWeighted`, `buildLocalStatsFromTasks`).

**Verify**: `npm run build` succeeds. Stats panel renders identically.

---

## Step 3: Extract `burnoutChartUtils.js`

**What moves:**

| Code | Current Location | Description |
|------|-----------------|-------------|
| `burnoutChartModel` memo body | L6161-6475 | 315-line pure data transform |

The `burnoutChartModel` useMemo body is a self-contained pure function: inputs are `burnoutData`, `burnoutAssigneeFilter`, and `burnoutTaskTeamByIssueKey`; output is the chart model object. It already contains its own local helpers (`parseDate`, `toDateKey`, `normalizeTeamCandidate`).

**New file** (`frontend/src/statistics/burnoutChartUtils.js`):
```js
import { resolveTeamColor } from './statsUtils.js';

/**
 * Build the burnout stacked-area chart model from API data.
 * Pure function — no React dependencies.
 *
 * @param {Object} burnoutData - API response data
 * @param {string} assigneeFilter - 'all' or specific assignee ID
 * @param {Map} taskTeamByIssueKey - Map<issueKey, {id, name}>
 * @returns {Object|null} Chart model with areas, paths, grid, etc.
 */
export function buildBurnoutChartModel(burnoutData, assigneeFilter, taskTeamByIssueKey) {
    // ... entire body extracted from the useMemo, unchanged
}
```

**Dashboard changes**: Replace the 315-line useMemo body with:
```js
const burnoutChartModel = React.useMemo(
    () => buildBurnoutChartModel(burnoutData, burnoutAssigneeFilter, burnoutTaskTeamByIssueKey),
    [burnoutData, burnoutAssigneeFilter, burnoutTaskTeamByIssueKey]
);
```

**Verify**: `npm run build` succeeds. Burnout chart renders identically.

---

## Step 4: Extract `StatsTeamsView.jsx`

**What moves** (JSX only — presentational):

| JSX | Current Location | Description |
|-----|-----------------|-------------|
| Teams view block | L8946-9143 | Bar chart grid + detailed table |

**New file** (`frontend/src/statistics/StatsTeamsView.jsx`):
```jsx
import * as React from 'react';

function StatsTeamsView({
    statsTeamRows,
    statsTotals,
    statsBarColumns,
    statsGraphMode,
    formatPercent,
    computeRate,
    getRateClass
}) {
    return (
        <div className="stats-view open">
            {/* bar chart grid */}
            {/* detailed table with Total/Product/Tech sections */}
        </div>
    );
}

export default React.memo(StatsTeamsView);
```

**Props**: All data pre-computed by dashboard.jsx memos; component only renders.

**Dashboard changes**: Replace the inline JSX block with:
```jsx
{statsView === 'teams' && canRenderStatsPanel && (
    <StatsTeamsView
        statsTeamRows={statsTeamRows}
        statsTotals={statsTotals}
        statsBarColumns={statsBarColumns}
        statsGraphMode={statsGraphMode}
        formatPercent={formatPercent}
        computeRate={computeRate}
        getRateClass={getRateClass}
    />
)}
```

**Verify**: `npm run build` succeeds. Teams view renders identically.

---

## Step 5: Extract `StatsPriorityView.jsx`

**What moves:**

| JSX | Current Location | Description |
|-----|-----------------|-------------|
| Priority view block | L9145-9342 | Priority table + radar chart SVG |

**New file** (`frontend/src/statistics/StatsPriorityView.jsx`):
```jsx
import * as React from 'react';

function StatsPriorityView({
    priorityRows,
    priorityRadar,
    priorityAxis,
    priorityHoverIndex,
    setPriorityHoverIndex,
    statsGraphMode,
    buildRadarPoints,
    resolveTeamColor,
    computeRate,
    getRateClass,
    formatPercent
}) {
    return (
        <div className="stats-view open">
            {/* priority matrix table */}
            {/* radar chart SVG */}
        </div>
    );
}

export default React.memo(StatsPriorityView);
```

**Dashboard changes**: Replace inline JSX block with component.

**Verify**: `npm run build` succeeds. Priority view + radar renders identically.

---

## Step 6: Extract `BurnoutChart.jsx`

**What moves:**

| JSX | Current Location | Description |
|-----|-----------------|-------------|
| Burnout view block | L9345-9650 | Assignee filter, summary cards, stacked area SVG, legend |

**New file** (`frontend/src/statistics/BurnoutChart.jsx`):
```jsx
import * as React from 'react';

function BurnoutChart({
    chartModel,
    totals,
    assigneeOptions,
    assigneeFilter,
    setAssigneeFilter,
    hoverPoint,
    setHoverPoint,
    hoverTeamKey,
    setHoverTeamKey,
    loading,
    error,
    chartRef
}) {
    return (
        <>
            {/* assignee filter dropdown */}
            {/* summary cards: Start / Added / Closed / Remaining */}
            {/* chart wrapper with SVG */}
            {/* legend */}
        </>
    );
}

export default React.memo(BurnoutChart);
```

**Dashboard changes**: Replace inline JSX block with component. All hover state setters passed as props.

**Verify**: `npm run build` succeeds. Burnout chart renders and interacts identically (hover, scroll-to-today, assignee filter).

---

## Step-by-step Execution Checklist

| # | Step | Files Created | Files Modified | ~Lines Moved |
|---|------|--------------|----------------|-------------|
| 1 | `statsConstants.js` | 1 | dashboard.jsx | ~50 |
| 2 | `statsUtils.js` | 1 | dashboard.jsx | ~200 |
| 3 | `burnoutChartUtils.js` | 1 | dashboard.jsx | ~315 |
| 4 | `StatsTeamsView.jsx` | 1 | dashboard.jsx | ~200 |
| 5 | `StatsPriorityView.jsx` | 1 | dashboard.jsx | ~200 |
| 6 | `BurnoutChart.jsx` | 1 | dashboard.jsx | ~305 |
| **Total** | | **6 new files** | **1 modified** | **~1,270 lines** |

Each step is independently committable and verifiable with `npm run build`.

## Key Constraints

- **No state migration**: All `useState`, `useEffect`, `useMemo` hooks stay in `dashboard.jsx`. Only pure functions and presentational JSX move out.
- **No behavior change**: Every step must produce identical UI. This is a pure refactoring.
- **No new dependencies**: esbuild bundles imports automatically.
- **Build gating**: `npm run build` must pass after every step before committing.
- **CSS unchanged**: All CSS classes remain in `dashboard.css` — no CSS extraction in this plan.

## Dependencies on Dashboard State (kept in dashboard.jsx)

These memos and effects reference too many component-scoped variables to extract cleanly. They stay in `dashboard.jsx`:

| Code | Location | Why it stays |
|------|----------|-------------|
| `effectivePriorityWeightMap` memo | L3758-3772 | Depends on `effectivePriorityWeightsRows` (settings state) |
| `burnoutTaskTeamByIssueKey` memo | L4099-4114 | Depends on `statsTaskList`, `getTeamInfo` |
| `burnoutIssueKeys` memo | L4115-4131 | Depends on `statsTaskList`, `selectedTeamSet`, `isAllTeamsSelected` |
| `burnoutQueryKey` memo | L4145-4149 | Depends on `selectedSprintInfo`, signatures |
| `fetchBurnout` effect | L4151-4249 | Depends on multiple state setters + refs |
| `burnoutAssigneeFilter` validation effect | L4251-4267 | Depends on state setters |
| `burnoutHoverPoint` reset effect | L4269-4272 | Depends on state setters |
| `allowedStatsTeamIds` memo | L5983-5988 | Depends on `selectedTeamSet` |
| `filteredStatsTeams` | L5990-5994 | Depends on `allowedStatsTeamIds` |
| `priorityRows` memo | L6013-6046 | Depends on `filteredStatsTeams` |
| `priorityRadar` memo | L6048-6066 | Depends on `filteredStatsTeams` |
| `statsTeamRows` | L6089-6111 | Depends on `filteredStatsTeams` |
| `statsTotals` | L6119-6146 | Depends on `statsTeamRows` |
| `burnoutAssigneeOptions` memo | L6147-6159 | Depends on `burnoutData` |
| `burnoutTotals` | L6477-6483 | Depends on `burnoutChartModel` |
| Scroll-to-today effect | L6484-6500 | Depends on `burnoutChartRef` |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Prop drilling becomes verbose | Accept for now; this is a stepping stone. A future pass can introduce context or a stats hook. |
| `buildLocalStatsFromTasks` has 4 closure deps | Refactor to accept options object — explicit is better than implicit. |
| Large PR review surface | Each step is a separate commit; reviewer can check one at a time. |
| Accidental behavior change | Build + manual visual check after each step. No logic changes — only code movement. |
