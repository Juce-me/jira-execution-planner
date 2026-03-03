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

## Verification Standard (every step)

Run after each extraction step before commit:

```bash
npm run build
python3 -m unittest discover -s tests
```

Required artifact checks:
- `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` must be regenerated and committed when source changes.
- No unexpected runtime behavior changes in Statistics (Teams, Priority, Burnout) after each step.

---

## Step 1: Extract `statsConstants.js`

**What moves** (from `dashboard.jsx`):

| Constant | Current Location | Description |
|----------|-----------------|-------------|
| `priorityOrder` | Search: `rg "priorityOrder" frontend/src/dashboard.jsx` | Map of priority name → sort rank |
| `priorityAxis` | Search: `rg "priorityAxis" frontend/src/dashboard.jsx` | Array of radar chart axis labels |
| `priorityLabelByKey` | Search: `rg "priorityLabelByKey" frontend/src/dashboard.jsx` | Map of lowercase key → display label |
| `priorityAliases` | Search: `rg "priorityAliases" frontend/src/dashboard.jsx` | Map of Jira priority names → normalized keys |
| `radarPalette` | Search: `rg "radarPalette" frontend/src/dashboard.jsx` | 12-color array for team charts |

**Important shared constant split**:
- `DEFAULT_PRIORITY_WEIGHT_ROWS` is used by both Settings and Statistics.
- Do **not** move it into `frontend/src/statistics/`.
- Move it to a shared module, e.g. `frontend/src/config/dashboardDefaults.js`, then import it from both settings and stats code.

**New file** (`frontend/src/statistics/statsConstants.js`):
```js
// Statistics constants — zero closure dependencies.

export const PRIORITY_ORDER = { ... };
export const PRIORITY_AXIS = ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial'];
export const PRIORITY_LABEL_BY_KEY = { ... };
export const PRIORITY_ALIASES = { ... };
export const RADAR_PALETTE = [ ... ];
```

**Dashboard changes**:
- Replace inline statistics constant definitions with imports from `./statistics/statsConstants.js`.
- Replace `DEFAULT_PRIORITY_WEIGHT_ROWS` imports with shared-module import (`./config/dashboardDefaults.js`).

**Verify**:
- `npm run build`
- `python3 -m unittest discover -s tests`
- Confirm regenerated `frontend/dist/dashboard.js` + `.map` are staged.

---

## Step 2: Extract `statsUtils.js`

**What moves** (pure functions only — no closures over component state):

| Function | Current Location | Signature |
|----------|-----------------|-----------|
| `formatPercent` | Search: `rg "function formatPercent|const formatPercent" frontend/src/dashboard.jsx` | `(value) → string` |
| `normalizePriority` | Search: `rg "normalizePriority" frontend/src/dashboard.jsx` | `(name) → string` |
| `getPriorityLabel` | Search: `rg "getPriorityLabel" frontend/src/dashboard.jsx` | `(name) → string` |
| `computeRate` | Search: `rg "computeRate" frontend/src/dashboard.jsx` | `(metrics) → number` |
| `getRateClass` | Search: `rg "getRateClass" frontend/src/dashboard.jsx` | `(rate) → string` |
| `hashTeamId` | Search: `rg "hashTeamId" frontend/src/dashboard.jsx` | `(value) → number` |
| `resolveTeamColor` | Search: `rg "resolveTeamColor" frontend/src/dashboard.jsx` | `(teamId) → string` |
| `buildRadarPoints` | Search: `rg "buildRadarPoints" frontend/src/dashboard.jsx` | `({values, radius, center, maxValue, axes}) → string` |
| `buildLocalStatsFromTasks` | Search: `rg "buildLocalStatsFromTasks" frontend/src/dashboard.jsx` | `(taskList, excludedSet, opts) → statsData` |

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

- `computePriorityWeighted` closes over `effectivePriorityWeightMap` (a memo). **Solution**: accept the weight map as a parameter:
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

**Verify**:
- `npm run build`
- `python3 -m unittest discover -s tests`
- Add/update JS unit tests for `statsUtils.js` pure functions (especially `buildLocalStatsFromTasks`, `computeRate`, `computePriorityWeighted`).

---

## Step 3: Extract `burnoutChartUtils.js`

**What moves:**

| Code | Current Location | Description |
|------|-----------------|-------------|
| `burnoutChartModel` memo body | Search: `rg "const burnoutChartModel = React.useMemo" frontend/src/dashboard.jsx` | Pure data transform |

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

**Verify**:
- `npm run build`
- `python3 -m unittest discover -s tests`
- Add/update JS unit tests for `buildBurnoutChartModel` (date range, team fallback, active-team filtering, today/future overlay model fields).

---

## Step 4: Extract `StatsTeamsView.jsx`

**What moves** (JSX only — presentational):

| JSX | Current Location | Description |
|-----|-----------------|-------------|
| Teams view block | Search: `rg "statsView === 'teams'" frontend/src/dashboard.jsx` | Bar chart grid + detailed table |

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

**Verify**:
- `npm run build`
- `python3 -m unittest discover -s tests`
- Manual parity check: same table rows, rates, and bars for identical sprint/team selection.

---

## Step 5: Extract `StatsPriorityView.jsx`

**What moves:**

| JSX | Current Location | Description |
|-----|-----------------|-------------|
| Priority view block | Search: `rg "statsView === 'priority'" frontend/src/dashboard.jsx` | Priority table + radar chart SVG |

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

**Verify**:
- `npm run build`
- `python3 -m unittest discover -s tests`
- Manual parity check: priority totals, weighted rates, radar hover behavior.

---

## Step 6: Extract `BurnoutChart.jsx`

**What moves:**

| JSX | Current Location | Description |
|-----|-----------------|-------------|
| Burnout view block | Search: `rg "statsView === 'burnout'" frontend/src/dashboard.jsx` | Assignee filter, summary cards, stacked area SVG, legend |

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

**Verify**:
- `npm run build`
- `python3 -m unittest discover -s tests`
- Manual parity check: hover details, assignee filter, legend highlight, scroll-to-today behavior.

---

## Step-by-step Execution Checklist

| # | Step | Files Created | Files Modified | ~Lines Moved |
|---|------|--------------|----------------|-------------|
| 1 | `statsConstants.js` (+ shared defaults module) | 2 | `dashboard.jsx`, dist files | ~60 |
| 2 | `statsUtils.js` | 1 | `dashboard.jsx`, dist files | ~200 |
| 3 | `burnoutChartUtils.js` | 1 | `dashboard.jsx`, dist files | ~315 |
| 4 | `StatsTeamsView.jsx` | 1 | `dashboard.jsx`, dist files | ~200 |
| 5 | `StatsPriorityView.jsx` | 1 | `dashboard.jsx`, dist files | ~200 |
| 6 | `BurnoutChart.jsx` | 1 | `dashboard.jsx`, dist files | ~305 |
| **Total** | | **7 new files** | **dashboard + dist updated each step** | **~1,280 lines** |

Each step is independently committable and verifiable with the full gate (`npm run build` + `python3 -m unittest discover -s tests`).

## Key Constraints

- **No state migration**: All `useState`, `useEffect`, `useMemo` hooks stay in `dashboard.jsx`. Only pure functions and presentational JSX move out.
- **No behavior change**: Every step must produce identical UI. This is a pure refactoring.
- **No new dependencies**: esbuild bundles imports automatically.
- **Build gating**: `npm run build` and `python3 -m unittest discover -s tests` must pass after every step before committing.
- **Dist parity is mandatory**: when `frontend/src/dashboard.jsx` changes, commit regenerated `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` in the same step.
- **CSS unchanged**: All CSS classes remain in `dashboard.css` — no CSS extraction in this plan.

## Dependencies on Dashboard State (kept in dashboard.jsx)

These memos and effects reference too many component-scoped variables to extract cleanly. They stay in `dashboard.jsx`.
Use symbol search (not line numbers) to locate them during implementation:

| Code | Location | Why it stays |
|------|----------|-------------|
| `effectivePriorityWeightMap` memo | Search: `rg "effectivePriorityWeightMap" frontend/src/dashboard.jsx` | Depends on `effectivePriorityWeightsRows` (settings state) |
| `burnoutTaskTeamByIssueKey` memo | Search: `rg "burnoutTaskTeamByIssueKey" frontend/src/dashboard.jsx` | Depends on `statsTaskList`, `getTeamInfo` |
| `burnoutIssueKeys` memo | Search: `rg "burnoutIssueKeys" frontend/src/dashboard.jsx` | Depends on `statsTaskList`, `selectedTeamSet`, `isAllTeamsSelected` |
| `burnoutQueryKey` memo | Search: `rg "burnoutQueryKey" frontend/src/dashboard.jsx` | Depends on `selectedSprintInfo`, signatures |
| `fetchBurnout` effect | Search: `rg "const fetchBurnout = async" frontend/src/dashboard.jsx` | Depends on multiple state setters + refs |
| `burnoutAssigneeFilter` validation effect | Search: `rg "setBurnoutAssigneeFilter\\('all'\\)" frontend/src/dashboard.jsx` | Depends on state setters |
| `burnoutHoverPoint` reset effect | Search: `rg "setBurnoutHoverPoint\\(null\\)" frontend/src/dashboard.jsx` | Depends on state setters |
| `allowedStatsTeamIds` memo | Search: `rg "allowedStatsTeamIds" frontend/src/dashboard.jsx` | Depends on `selectedTeamSet` |
| `filteredStatsTeams` | Search: `rg "filteredStatsTeams" frontend/src/dashboard.jsx` | Depends on `allowedStatsTeamIds` |
| `priorityRows` memo | Search: `rg "const priorityRows = React.useMemo" frontend/src/dashboard.jsx` | Depends on `filteredStatsTeams` |
| `priorityRadar` memo | Search: `rg "const priorityRadar = React.useMemo" frontend/src/dashboard.jsx` | Depends on `filteredStatsTeams` |
| `statsTeamRows` | Search: `rg "const statsTeamRows =" frontend/src/dashboard.jsx` | Depends on `filteredStatsTeams` |
| `statsTotals` | Search: `rg "const statsTotals =" frontend/src/dashboard.jsx` | Depends on `statsTeamRows` |
| `burnoutAssigneeOptions` memo | Search: `rg "burnoutAssigneeOptions" frontend/src/dashboard.jsx` | Depends on `burnoutData` |
| `burnoutTotals` | Search: `rg "const burnoutTotals" frontend/src/dashboard.jsx` | Depends on `burnoutChartModel` |
| Scroll-to-today effect | Search: `rg "chart.scrollLeft = target" frontend/src/dashboard.jsx` | Depends on `burnoutChartRef` |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Prop drilling becomes verbose | Accept for now; this is a stepping stone. A future pass can introduce context or a stats hook. |
| `buildLocalStatsFromTasks` has 4 closure deps | Refactor to accept options object — explicit is better than implicit. |
| Large PR review surface | Each step is a separate commit; reviewer can check one at a time. |
| Dist/source drift | Regenerate and commit `frontend/dist/dashboard.js` + `.map` in every step touching `frontend/src/dashboard.jsx`. |
| Accidental behavior change | Build + backend tests + manual visual check after each step. Add focused JS unit tests for extracted pure modules. |
