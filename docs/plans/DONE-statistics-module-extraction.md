# Statistics Module Extraction Implementation Plan

> **Status:** Done. Executed in PR #37 / `4d3c478`. Kept for audit context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the remaining legacy Statistics Teams, Priority, and Burndown code from `frontend/src/dashboard.jsx` into focused modules under the existing `frontend/src/stats/` package without changing UI behavior.

**Architecture:** Keep app state, data fetching effects, cache refs, user preferences, and cross-view wiring in `dashboard.jsx`. Move pure calculations into stats utility modules and move render-only JSX into stats components that receive fully prepared props. Use the current `frontend/src/stats/` package; do not create a parallel `frontend/src/statistics/` directory.

**Tech Stack:** React 19 JSX, existing esbuild frontend bundle, Node `node:test` source/utility tests, Python `unittest`, Playwright smoke coverage, generated `frontend/dist/*` committed after source changes.

---

## Current Main Verification

Verified against current local `main` source on 2026-05-20. The source tree has the effort split changes already merged and contains a docs-only local commit after `origin/main`; the frontend source matches the current mainline Statistics implementation.

Commands used to verify the branch draft against current code:

```bash
git diff --name-status origin/main...origin/plan/statistics-module-extraction
rg --files frontend/src/stats | sort
rg -n "priorityAxis|priorityLabelByKey|radarPalette|buildLocalStatsFromTasks|burnoutChartModel|statsView === 'teams'|statsView === 'priority'|statsView === 'burnout'" frontend/src/dashboard.jsx
rg -n "buildEffortTypeSplitRows|EffortTypeSplitChart|ExcludedCapacityLineChart|excludedCapacityStats" frontend/src tests
```

Findings:

- `origin/plan/statistics-module-extraction` only adds `statistics_module_extraction_plan.md`; no extraction was implemented there.
- The old draft proposed `frontend/src/statistics/`, but current main already uses `frontend/src/stats/` for extracted Statistics code.
- Already extracted and out of scope for this plan:
  - `frontend/src/stats/excludedCapacityStats.js`
  - `frontend/src/stats/ExcludedCapacityLineChart.jsx`
  - `frontend/src/stats/EffortTypeSplitChart.jsx`
  - `frontend/src/cohort/*`
- Still embedded in `frontend/src/dashboard.jsx` and in scope:
  - legacy delivery-rate constants and utility functions
  - local sprint stats aggregation
  - Teams Statistics table/bar view JSX
  - Priority Statistics radar/table view JSX
  - Burndown chart model builder and Burndown view JSX

The old root-level draft is superseded by this file. Do not execute `statistics_module_extraction_plan.md` as-is.

## Non-Goals

- No backend route changes.
- No new endpoints, request fan-out, cache policy, or persisted state.
- No visual redesign of Statistics.
- No changes to Excluded Capacity, Effort Split, Mono vs Cross, or Lead Times behavior beyond keeping their imports compatible.
- No extraction of React state, effects, refs, or preference hydration from `dashboard.jsx`.
- No hand edits to `frontend/dist/*`; regenerate with `npm run build`.

## Target File Map

Create:

- `frontend/src/stats/statsConstants.js`
  - Owns `PRIORITY_AXIS`, `PRIORITY_LABEL_BY_KEY`, `PRIORITY_ALIASES`, and `RADAR_PALETTE`.
- `frontend/src/stats/priorityWeights.js`
  - Owns `DEFAULT_PRIORITY_WEIGHT_ROWS`, `clonePriorityWeightRows`, and `buildPriorityWeightMap`.
- `frontend/src/stats/statsUtils.js`
  - Owns `formatPercent`, `normalizePriority`, `getPriorityLabel`, `computePriorityWeighted`, `computeRate`, `getRateClass`, `hashTeamId`, `resolveTeamColor`, `buildRadarPoints`, and `buildLocalStatsFromTasks`.
- `frontend/src/stats/burnoutChartUtils.js`
  - Owns `buildBurnoutChartModel`.
- `frontend/src/stats/StatsDeliverySummary.jsx`
  - Render-only summary cards for Delivery Rate, Weighted Rate, Totals, and Source.
- `frontend/src/stats/StatsTeamsView.jsx`
  - Render-only Teams Statistics bar grid and table.
- `frontend/src/stats/StatsPriorityView.jsx`
  - Render-only Priority radar chart and table.
- `frontend/src/stats/BurnoutChart.jsx`
  - Render-only Burndown controls, summary cards, SVG chart, hover/readout markup, and legend.
- `tests/test_stats_utils.js`
  - Node utility tests for extracted pure functions.
- `tests/test_burnout_chart_utils.js`
  - Node utility tests for the extracted chart model.
- `tests/test_stats_module_extraction_source_guards.js`
  - Source guards proving the extraction stays extracted.

Modify:

- `frontend/src/dashboard.jsx`
  - Replace inline utilities and JSX blocks with imports and component usage.
  - Keep all state, effects, refs, fetch logic, cache refs, preferences, and cross-view wiring.
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `tests/ui/codebase_structure_smoke.spec.js`
  - Add a focused Statistics subview test and keep the existing broad smoke coverage.
- `docs/plans/README.md`

Do not modify:

- `frontend/src/stats/excludedCapacityStats.js`
- `frontend/src/stats/ExcludedCapacityLineChart.jsx`
- `frontend/src/stats/EffortTypeSplitChart.jsx`
- `frontend/src/cohort/*`
- backend files

## Execution Rules

- Execute tasks sequentially. Multiple workers must not edit `frontend/src/dashboard.jsx` at the same time.
- Before each task, run the task's focused source search and confirm every named symbol still exists.
- Commit after each task that leaves verification green.
- Keep commits extraction-only. If a behavior bug is found, stop and write a separate fix plan or user-facing note.
- Keep generated dist output in the same commit as the source change that produced it.
- If existing focused tests fail before edits, record the baseline and do not weaken tests to pass.

## Preflight

- [x] **Step 1: Confirm branch and dirty files**

Run:

```bash
git status --short --branch
git fetch origin
git status --short --branch
```

Expected:

- Work is on a non-`main` branch.
- If `git fetch origin` is unavailable, record that sync was unavailable and continue only if the user approves executing from the current local baseline.
- The branch is not behind its upstream. If it is behind, stop and sync before editing.
- Any unrelated dirty files are identified and left unstaged.

- [x] **Step 2: Read relevant postmortems**

Run:

```bash
sed -n '1,220p' postmortem/MRT001-missing-teams-stats.md
sed -n '1,220p' postmortem/MRT007-bundled-frontend-regression.md
sed -n '1,220p' postmortem/MRT017-chart-hover-readout-placement.md
```

Carry these prevention checks into execution:

- Preserve zero-issue teams in selector/stat rows; do not derive team coverage only from returned issue rows.
- Verify committed `frontend/dist/dashboard.js` and `.map`, not only freshly bundled source.
- Do not move chart hover/readout code into transformed or scrollable containers without edge-position Playwright checks.

- [x] **Step 3: Confirm current stats module baseline**

Run:

```bash
rg --files frontend/src/stats | sort
rg -n "const priorityAxis|const priorityLabelByKey|const radarPalette|const buildLocalStatsFromTasks|const burnoutChartModel = React.useMemo" frontend/src/dashboard.jsx
rg -n "statsView === 'teams'|statsView === 'priority'|statsView === 'burnout'" frontend/src/dashboard.jsx
```

Expected:

- Existing stats modules are under `frontend/src/stats/`.
- The legacy Teams, Priority, and Burndown code is still in `dashboard.jsx`.

- [x] **Step 4: Run baseline verification**

Run:

```bash
npm run build
node --test tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js
python3 -m unittest discover -s tests
```

Expected:

- All commands pass before extraction begins.

---

### Task 1: Add Extraction Source Guards

**Files:**

- Create: `tests/test_stats_module_extraction_source_guards.js`

- [x] **Step 1: Add the failing source guard test**

Create `tests/test_stats_module_extraction_source_guards.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const sourcePath = (...parts) => path.join(repoRoot, ...parts);
const read = (...parts) => fs.readFileSync(sourcePath(...parts), 'utf8');

const dashboardSource = read('frontend', 'src', 'dashboard.jsx');
const statsDir = sourcePath('frontend', 'src', 'stats');
const statsFileNames = () => fs.readdirSync(statsDir).filter((fileName) => /\.(js|jsx|mjs)$/.test(fileName));
const readStatsFile = (fileName) => read('frontend', 'src', 'stats', fileName);

test('legacy statistics modules live in the existing stats package', () => {
    [
        'statsConstants.js',
        'priorityWeights.js',
        'statsUtils.js',
        'burnoutChartUtils.js',
        'StatsDeliverySummary.jsx',
        'StatsTeamsView.jsx',
        'StatsPriorityView.jsx',
        'BurnoutChart.jsx',
    ].forEach((fileName) => {
        assert.ok(
            fs.existsSync(sourcePath('frontend', 'src', 'stats', fileName)),
            `Expected frontend/src/stats/${fileName}`
        );
    });
    assert.ok(
        !fs.existsSync(sourcePath('frontend', 'src', 'statistics')),
        'Do not create a parallel frontend/src/statistics package'
    );
});

test('dashboard imports extracted statistics utilities and components', () => {
    [
        "from './stats/statsConstants.js'",
        "from './stats/priorityWeights.js'",
        "from './stats/statsUtils.js'",
        "from './stats/burnoutChartUtils.js'",
        "from './stats/StatsDeliverySummary.jsx'",
        "from './stats/StatsTeamsView.jsx'",
        "from './stats/StatsPriorityView.jsx'",
        "from './stats/BurnoutChart.jsx'",
    ].forEach((expectedImport) => {
        assert.ok(dashboardSource.includes(expectedImport), `Expected dashboard import ${expectedImport}`);
    });
});

test('extracted statistics modules remain render/pure helpers with no request or storage ownership', () => {
    const forbidden = [
        'fetch(',
        '/api/',
        'BACKEND_URL',
        'Authorization',
        'credentials',
        'X-CSRF-Token',
        'X-Requested-With',
        'localStorage',
        'sessionStorage',
    ];
    statsFileNames().forEach((fileName) => {
        const source = readStatsFile(fileName);
        forbidden.forEach((term) => {
            assert.equal(
                source.includes(term),
                false,
                `frontend/src/stats/${fileName} must not own request/storage behavior: ${term}`
            );
        });
    });
    [
        'burnoutCacheRef',
        'excludedCapacityCacheRef',
        '/api/stats/burnout',
        'requestExcludedCapacityStatsSource',
    ].forEach((term) => {
        assert.ok(dashboardSource.includes(term), `dashboard.jsx must keep request/cache ownership for ${term}`);
    });
});

test('dashboard no longer owns extracted statistics implementation bodies', () => {
    [
        /const priorityAxis = \[/,
        /const priorityLabelByKey = \{/,
        /const radarPalette = \[/,
        /const priorityAliases = \{/,
        /const formatPercent = \(value\)/,
        /const normalizePriority = \(name\)/,
        /const getPriorityLabel = \(name\)/,
        /const computePriorityWeighted = \(priorities\)/,
        /const computeRate = \(metrics\)/,
        /const getRateClass = \(rate\)/,
        /const hashTeamId = \(value\)/,
        /const resolveTeamColor = \(teamId\)/,
        /const buildRadarPoints = \(/,
        /const buildLocalStatsFromTasks = \(/,
        /const burnoutChartModel = React\.useMemo\(\(\) => \{\s*const parseDate/,
        /statsTeamRows\.map\(team =>/,
        /priorityRadar\.series\.map\(\(series/,
        /burnoutAssigneeOptions\.map\(\(item\)/,
        /className="burnout-chart"/,
        /burnout-hover-capture/,
        /burnout-legend/,
        /setStatsGraphMode\('absolute'\)/,
    ].forEach((pattern) => {
        assert.equal(pattern.test(dashboardSource), false, `Unexpected extracted body still in dashboard: ${pattern}`);
    });
});

test('extracted statistics components own their expected view markup', () => {
    assert.ok(readStatsFile('StatsDeliverySummary.jsx').includes("setStatsGraphMode('absolute')"));
    assert.ok(readStatsFile('StatsTeamsView.jsx').includes('stats-bars'));
    assert.ok(readStatsFile('StatsTeamsView.jsx').includes('statsTeamRows.map'));
    assert.ok(readStatsFile('StatsPriorityView.jsx').includes('priority-radar'));
    assert.ok(readStatsFile('StatsPriorityView.jsx').includes('priorityRadar.series.map'));
    assert.ok(readStatsFile('BurnoutChart.jsx').includes('burnout-chart'));
    assert.ok(readStatsFile('BurnoutChart.jsx').includes('burnout-hover-capture'));
    assert.ok(readStatsFile('BurnoutChart.jsx').includes('burnout-legend'));
});

test('existing excluded capacity stats extraction remains intact', () => {
    [
        "from './stats/excludedCapacityStats.js'",
        "import ExcludedCapacityLineChart from './stats/ExcludedCapacityLineChart.jsx';",
        "import EffortTypeSplitChart from './stats/EffortTypeSplitChart.jsx';",
    ].forEach((expectedImport) => {
        assert.ok(dashboardSource.includes(expectedImport), `Expected existing import ${expectedImport}`);
    });
});
```

- [x] **Step 2: Run the new guard and confirm it fails**

Run:

```bash
node --test tests/test_stats_module_extraction_source_guards.js
```

Expected:

- FAIL because the new modules do not exist yet and implementation bodies still live in `dashboard.jsx`.

- [x] **Step 3: Commit only if this task is intentionally split**

Usually do not commit this failing test alone unless the execution lead wants a red-green commit history. If committing it separately, the commit message is:

```bash
git add tests/test_stats_module_extraction_source_guards.js
git commit -m "test: guard statistics module extraction"
```

---

### Task 2: Extract Constants And Priority Weight Helpers

**Files:**

- Create: `frontend/src/stats/statsConstants.js`
- Create: `frontend/src/stats/priorityWeights.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_stats_utils.js`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Locate current definitions**

Run:

```bash
rg -n "DEFAULT_PRIORITY_WEIGHT_ROWS|clonePriorityWeightRows|priorityAxis|priorityLabelByKey|priorityAliases|radarPalette" frontend/src/dashboard.jsx
```

Expected symbols:

- `DEFAULT_PRIORITY_WEIGHT_ROWS`
- `clonePriorityWeightRows`
- `priorityAxis`
- `priorityLabelByKey`
- `priorityAliases`
- `radarPalette`

- [x] **Step 2: Create `statsConstants.js`**

Move the current constant values exactly, with uppercase exported names:

```js
export const PRIORITY_AXIS = ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial'];

export const PRIORITY_LABEL_BY_KEY = {
    blocker: 'Blocker',
    critical: 'Critical',
    major: 'Major',
    minor: 'Minor',
    low: 'Low',
    trivial: 'Trivial'
};

export const PRIORITY_ALIASES = {
    highest: 'blocker',
    high: 'major',
    medium: 'minor',
    lowest: 'trivial'
};

export const RADAR_PALETTE = [
    '#2563eb',
    '#0ea5e9',
    '#14b8a6',
    '#10b981',
    '#22c55e',
    '#84cc16',
    '#eab308',
    '#f59e0b',
    '#f97316',
    '#a855f7',
    '#6366f1',
    '#64748b'
];
```

- [x] **Step 3: Create `priorityWeights.js`**

Move `DEFAULT_PRIORITY_WEIGHT_ROWS` and `clonePriorityWeightRows`, and extract the current `effectivePriorityWeightMap` body into a pure builder:

```js
export const DEFAULT_PRIORITY_WEIGHT_ROWS = Object.freeze([
    { priority: 'Blocker', weight: '0.4' },
    { priority: 'Critical', weight: '0.3' },
    { priority: 'Major', weight: '0.2' },
    { priority: 'Minor', weight: '0.06' },
    { priority: 'Low', weight: '0.03' },
    { priority: 'Trivial', weight: '0.01' }
]);

export function clonePriorityWeightRows(rows) {
    const source = Array.isArray(rows) && rows.length ? rows : DEFAULT_PRIORITY_WEIGHT_ROWS;
    return source.map((row) => ({
        priority: String(row.priority || '').trim(),
        weight: String(row.weight ?? '').trim()
    }));
}

export function buildPriorityWeightMap(rows) {
    const map = {};
    (rows || []).forEach((row) => {
        const key = String(row?.priority || '').toLowerCase().trim();
        const numeric = Number(row?.weight);
        if (!key || Number.isNaN(numeric) || !Number.isFinite(numeric) || numeric < 0) return;
        map[key] = numeric;
    });
    if (Object.keys(map).length === 0) {
        clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS).forEach((row) => {
            map[String(row.priority || '').toLowerCase()] = Number(row.weight);
        });
    }
    return map;
}
```

- [x] **Step 4: Import constants and helpers in `dashboard.jsx`**

Add imports near existing stats imports:

```js
import { PRIORITY_AXIS, PRIORITY_LABEL_BY_KEY, PRIORITY_ALIASES, RADAR_PALETTE } from './stats/statsConstants.js';
import { DEFAULT_PRIORITY_WEIGHT_ROWS, buildPriorityWeightMap, clonePriorityWeightRows } from './stats/priorityWeights.js';
```

Remove the inline definitions from `dashboard.jsx`.

Replace local names with constants:

```js
const priorityAxis = PRIORITY_AXIS;
const priorityLabelByKey = PRIORITY_LABEL_BY_KEY;
const priorityAliases = PRIORITY_ALIASES;
const radarPalette = RADAR_PALETTE;
```

Replace the `effectivePriorityWeightMap` memo body with:

```js
const effectivePriorityWeightMap = React.useMemo(
    () => buildPriorityWeightMap(effectivePriorityWeightsRows),
    [effectivePriorityWeightsRows]
);
```

- [x] **Step 5: Add focused tests**

Create `tests/test_stats_utils.js` if it does not exist, then add:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('priority weight helpers normalize rows and fall back to defaults', async () => {
    const {
        DEFAULT_PRIORITY_WEIGHT_ROWS,
        clonePriorityWeightRows,
        buildPriorityWeightMap,
    } = await import('../frontend/src/stats/priorityWeights.js');

    assert.equal(DEFAULT_PRIORITY_WEIGHT_ROWS.length, 6);
    assert.deepEqual(clonePriorityWeightRows([{ priority: ' Major ', weight: 0.25 }]), [
        { priority: 'Major', weight: '0.25' },
    ]);
    assert.deepEqual(buildPriorityWeightMap([{ priority: 'Major', weight: '0.25' }]), {
        major: 0.25,
    });
    assert.equal(buildPriorityWeightMap([]).blocker, 0.4);
});
```

- [x] **Step 6: Verify and commit**

Run:

```bash
npm run build
node --test tests/test_stats_utils.js
python3 -m unittest discover -s tests
```

Expected:

- `tests/test_stats_utils.js` passes.
- `npm run build` passes and regenerates `frontend/dist/dashboard.js` plus `.map`.

Run the extraction guard separately so the remaining work stays visible:

```bash
node --test tests/test_stats_module_extraction_source_guards.js
```

Expected:

- FAIL because later modules and component bodies are not extracted yet.

Commit when the focused utility test and build pass:

```bash
git add frontend/src/stats/statsConstants.js frontend/src/stats/priorityWeights.js frontend/src/dashboard.jsx tests/test_stats_utils.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "refactor: extract statistics constants"
```

---

### Task 3: Extract Statistics Utility Functions

**Files:**

- Create: `frontend/src/stats/statsUtils.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_stats_utils.js`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Locate current utility bodies**

Run:

```bash
rg -n "formatPercent|normalizePriority|getPriorityLabel|computePriorityWeighted|computeRate|getRateClass|hashTeamId|resolveTeamColor|buildRadarPoints|buildLocalStatsFromTasks" frontend/src/dashboard.jsx
```

- [x] **Step 2: Create `statsUtils.js`**

Move these functions into `frontend/src/stats/statsUtils.js`:

```js
import { PRIORITY_ALIASES, PRIORITY_LABEL_BY_KEY, RADAR_PALETTE } from './statsConstants.js';

export function formatPercent(value) {
    return `${(value * 100).toFixed(2)}%`;
}

export function normalizePriority(name) {
    const key = String(name || '').toLowerCase().trim();
    return PRIORITY_ALIASES[key] || key;
}

export function getPriorityLabel(name) {
    const key = normalizePriority(name);
    return PRIORITY_LABEL_BY_KEY[key] || name;
}

export function computePriorityWeighted(priorities, weightMap) {
    const totals = { done: 0, incomplete: 0, killed: 0 };
    Object.entries(priorities || {}).forEach(([priorityName, counts]) => {
        const normalized = normalizePriority(priorityName);
        const weight = weightMap?.[normalized] || 0;
        totals.done += weight * (counts.done || 0);
        totals.incomplete += weight * (counts.incomplete || 0);
        totals.killed += weight * (counts.killed || 0);
    });
    return totals;
}

export function computeRate(metrics) {
    const done = metrics?.done || 0;
    const incomplete = metrics?.incomplete || 0;
    const denom = done + incomplete;
    return denom > 0 ? done / denom : 0;
}

export function getRateClass(rate) {
    if (rate >= 1) return 'good';
    if (rate >= 0.6 && rate < 0.8) return 'warn';
    if (rate < 0.6) return 'bad';
    return '';
}

export function hashTeamId(value) {
    const str = String(value || '');
    let hash = 5381;
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return Math.abs(hash);
}

export function resolveTeamColor(teamId) {
    if (!RADAR_PALETTE.length) return '#94a3b8';
    const index = hashTeamId(teamId) % RADAR_PALETTE.length;
    return RADAR_PALETTE[index];
}

export function buildRadarPoints({ values, radius, center, maxValue, axes }) {
    const count = axes.length;
    return axes.map((axis, index) => {
        const value = Math.max(0, values[axis] || 0);
        const ratio = maxValue > 0 ? value / maxValue : 0;
        const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
        const r = ratio * radius;
        const x = center + r * Math.cos(angle);
        const y = center + r * Math.sin(angle);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
}
```

Then move `buildLocalStatsFromTasks` with this signature:

```js
export function buildLocalStatsFromTasks(taskList, {
    excludedSet = new Set(),
    normalizeStatus,
    getTeamInfo,
    techProjectKeys,
    sprintName = ''
} = {}) {
    // Move the current body from dashboard.jsx.
    // Replace selectedSprintInfo?.name with sprintName.
    // Replace closure reads of normalizeStatus, getTeamInfo, and techProjectKeys with the option values above.
}
```

Use the existing body from `dashboard.jsx`; do not change bucketing behavior.

- [x] **Step 3: Import utilities in `dashboard.jsx`**

Add:

```js
import {
    buildLocalStatsFromTasks,
    buildRadarPoints,
    computePriorityWeighted,
    computeRate,
    formatPercent,
    getPriorityLabel,
    getRateClass,
    resolveTeamColor,
} from './stats/statsUtils.js';
```

Remove the inline extracted function declarations from `dashboard.jsx`.

Update call sites:

```js
const weighted = computePriorityWeighted(scoped.priorities, effectivePriorityWeightMap);
const weightedProduct = computePriorityWeighted(scopedProduct.priorities, effectivePriorityWeightMap);
const weightedTech = computePriorityWeighted(scopedTech.priorities, effectivePriorityWeightMap);
```

Update local stats build:

```js
const result = buildLocalStatsFromTasks(statsTaskList, {
    excludedSet: new Set(),
    normalizeStatus,
    getTeamInfo,
    techProjectKeys,
    sprintName: selectedSprintInfo?.name || ''
});
```

Update the `localStatsData` memo dependency array so it includes the project mapping that can change from Settings:

```js
}, [statsTaskList, selectedSprintInfo?.name, showStats, perfEnabled, techProjectKeys]);
```

Do not add `normalizeStatus` to the dependency list unless it is made stable first; in current `dashboard.jsx` it is recreated on each render even though the logic is constant. `getTeamInfo` is an imported helper alias. `techProjectKeys` must be included because Settings can change product/tech project mapping.

- [x] **Step 4: Add focused utility tests**

Append to `tests/test_stats_utils.js`:

```js
test('stats utilities normalize priorities, rates, weights, colors, and radar points', async () => {
    const {
        buildRadarPoints,
        computePriorityWeighted,
        computeRate,
        formatPercent,
        getPriorityLabel,
        getRateClass,
        normalizePriority,
        resolveTeamColor,
    } = await import('../frontend/src/stats/statsUtils.js');

    assert.equal(formatPercent(0.125), '12.50%');
    assert.equal(normalizePriority('High'), 'major');
    assert.equal(getPriorityLabel('Highest'), 'Blocker');
    assert.deepEqual(
        computePriorityWeighted({ High: { done: 2, incomplete: 1, killed: 1 } }, { major: 0.2 }),
        { done: 0.4, incomplete: 0.2, killed: 0.2 }
    );
    assert.equal(computeRate({ done: 3, incomplete: 1 }), 0.75);
    assert.equal(getRateClass(1), 'good');
    assert.equal(getRateClass(0.7), 'warn');
    assert.equal(getRateClass(0.5), 'bad');
    assert.match(resolveTeamColor('team-alpha'), /^#[0-9a-f]{6}$/i);
    assert.equal(
        buildRadarPoints({ values: { Blocker: 1 }, radius: 50, center: 60, maxValue: 1, axes: ['Blocker'] }),
        '60.00,10.00'
    );
});

test('buildLocalStatsFromTasks preserves sprint team project buckets and edge cases', async () => {
    const { buildLocalStatsFromTasks } = await import('../frontend/src/stats/statsUtils.js');
    const tasks = [
        {
            key: 'PROD-1',
            fields: {
                status: { name: 'Done' },
                priority: { name: 'High' },
                customfield_10004: 3,
                epicKey: 'EPIC-1',
                projectKey: 'PROD',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
        {
            key: 'TECH-1',
            fields: {
                status: { name: 'In Progress' },
                priority: { name: 'Low' },
                customfield_10004: 5,
                epicKey: 'EPIC-2',
                projectKey: 'TECH',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
        {
            key: 'TECH-2',
            fields: {
                status: { name: 'Killed' },
                priority: { name: 'Blocker' },
                customfield_10004: 2,
                epicKey: 'EPIC-3',
                teamId: 'team-beta',
                teamName: 'Beta',
            },
        },
        {
            key: 'PROD-EXCLUDED',
            fields: {
                status: { name: 'Done' },
                priority: { name: 'Major' },
                customfield_10004: 13,
                epicKey: 'EXCLUDED-1',
                projectKey: 'PROD',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
    ];
    const result = buildLocalStatsFromTasks(tasks, {
        excludedSet: new Set(['EXCLUDED-1']),
        normalizeStatus: (status) => {
            const key = String(status || '').toLowerCase();
            if (key === 'done') return 'done';
            if (key === 'killed') return 'killed';
            return 'incomplete';
        },
        getTeamInfo: (task) => ({ id: task.fields.teamId, name: task.fields.teamName }),
        techProjectKeys: new Set(['TECH']),
        sprintName: '2026Q2',
    });

    assert.equal(result.sprint, '2026Q2');
    assert.equal(result.totals.done, 1);
    assert.equal(result.totals.incomplete, 1);
    assert.equal(result.totals.killed, 1);
    assert.equal(result.storyPoints.total, 10);
    assert.deepEqual(result.teams.map((team) => team.name), ['Alpha', 'Beta']);
    assert.equal(result.teams[0].projects.product.done, 1);
    assert.equal(result.teams[0].projects.tech.incomplete, 1);
    assert.equal(result.teams[1].projects.tech.killed, 1);
    assert.equal(result.teams[0].priorityPoints.High, 3);
    assert.equal(result.teams[0].priorityPoints.Low, 5);
});
```

- [x] **Step 5: Verify and commit**

Run:

```bash
npm run build
node --test tests/test_stats_utils.js
python3 -m unittest discover -s tests
```

Expected:

- `tests/test_stats_utils.js` passes.

Run the extraction guard separately:

```bash
node --test tests/test_stats_module_extraction_source_guards.js
```

Expected:

- FAIL only for component/chart-model bodies not extracted yet.

Commit:

```bash
git add frontend/src/stats/statsUtils.js frontend/src/dashboard.jsx tests/test_stats_utils.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "refactor: extract statistics utilities"
```

---

### Task 4: Extract Burndown Chart Model Builder

**Files:**

- Create: `frontend/src/stats/burnoutChartUtils.js`
- Create: `tests/test_burnout_chart_utils.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Locate the current memo body**

Run:

```bash
rg -n "const burnoutChartModel = React.useMemo|const burnoutTotals|burndownMetricIsStoryPoints" frontend/src/dashboard.jsx
```

- [x] **Step 2: Create `buildBurnoutChartModel`**

Create `frontend/src/stats/burnoutChartUtils.js` with this public signature:

```js
export function buildBurnoutChartModel({
    burnoutData,
    assigneeFilter,
    taskTeamByIssueKey,
    taskStatusByIssueKey,
    issueWeightByKey,
    isCompletedSprintSelected,
    metric,
    resolveTeamColor,
    isClosedStatus
}) {
    // Move the current burnoutChartModel useMemo body from dashboard.jsx.
    // Replace:
    // - burnoutData with the option value above.
    // - burnoutAssigneeFilter with assigneeFilter.
    // - burnoutTaskTeamByIssueKey with taskTeamByIssueKey.
    // - burnoutTaskStatusByIssueKey with taskStatusByIssueKey.
    // - burnoutIssueWeightByKey with issueWeightByKey.
    // - burndownMetric with metric.
    // - isBurnoutClosedStatus with isClosedStatus, or define an equivalent private helper in this module.
    // Keep the returned model shape unchanged.
}
```

If passing a callback, use this default inside `burnoutChartUtils.js` so direct unit tests remain deterministic:

```js
function defaultIsClosedStatus(status) {
    const normalized = String(status || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return normalized === 'done' || normalized === 'killed' || normalized === 'incomplete';
}
```

Then resolve:

```js
const isClosed = typeof isClosedStatus === 'function' ? isClosedStatus : defaultIsClosedStatus;
```

Use `isClosed(currentStatus)` where the current memo calls `isBurnoutClosedStatus(currentStatus)`.

The extracted model must still return:

- `width`
- `height`
- `padding`
- `rows`
- `teams`
- `areas`
- `xStep`
- `yTicks`
- `weeklyMarkers`
- `todayDateKey`
- `todayX`
- `futureOverlay`
- `teamColors`
- `teamNameByKey`
- `issueSnapshots`
- `metric`
- `summary`

- [x] **Step 3: Replace the memo body in `dashboard.jsx`**

Import:

```js
import { buildBurnoutChartModel } from './stats/burnoutChartUtils.js';
```

Replace the memo with:

```js
const burnoutChartModel = React.useMemo(() => buildBurnoutChartModel({
    burnoutData,
    assigneeFilter: burnoutAssigneeFilter,
    taskTeamByIssueKey: burnoutTaskTeamByIssueKey,
    taskStatusByIssueKey: burnoutTaskStatusByIssueKey,
    issueWeightByKey: burnoutIssueWeightByKey,
    isCompletedSprintSelected,
    metric: burndownMetric,
    resolveTeamColor,
    isClosedStatus: isBurnoutClosedStatus
}), [
    burnoutData,
    burnoutAssigneeFilter,
    burnoutTaskTeamByIssueKey,
    burnoutTaskStatusByIssueKey,
    burnoutIssueWeightByKey,
    isCompletedSprintSelected,
    burndownMetric,
    isBurnoutClosedStatus
]);
```

- [x] **Step 4: Add chart model tests**

Create `tests/test_burnout_chart_utils.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('buildBurnoutChartModel builds story-point burndown summary and visible teams', async () => {
    const { buildBurnoutChartModel } = await import('../frontend/src/stats/burnoutChartUtils.js');
    const model = buildBurnoutChartModel({
        burnoutData: {
            range: { startDate: '2026-04-01', endDate: '2026-04-03' },
            issuesMeta: [
                {
                    issueKey: 'PROD-1',
                    createdDate: '2026-03-30',
                    assignee: { id: 'a1', name: 'Alex' },
                    teamAtStart: { id: 'team-alpha', name: 'Alpha' },
                },
                {
                    issueKey: 'PROD-2',
                    createdDate: '2026-04-02',
                    assignee: { id: 'a1', name: 'Alex' },
                    teamAtCreated: { id: 'team-alpha', name: 'Alpha' },
                },
            ],
            events: [
                {
                    issueKey: 'PROD-1',
                    date: '2026-04-03',
                    teamId: 'team-alpha',
                    teamName: 'Alpha',
                    assigneeName: 'Alex',
                    bucket: 'done',
                },
            ],
        },
        assigneeFilter: 'all',
        taskTeamByIssueKey: new Map(),
        taskStatusByIssueKey: new Map([['PROD-1', 'done'], ['PROD-2', 'to do']]),
        issueWeightByKey: new Map([['PROD-1', 3], ['PROD-2', 5]]),
        isCompletedSprintSelected: false,
        metric: 'storyPoints',
        resolveTeamColor: () => '#2563eb',
    });

    assert.ok(model);
    assert.equal(model.summary.start, 3);
    assert.equal(model.summary.added, 5);
    assert.equal(model.summary.closed, 3);
    assert.equal(model.summary.remaining, 5);
    assert.equal(model.summary.closureBuckets.done, 1);
    assert.equal(model.metric.key, 'storyPoints');
    assert.deepEqual(model.teams.map((team) => team.name), ['Alpha']);
    assert.ok(Array.isArray(model.rows));
    assert.ok(Array.isArray(model.areas));
    assert.ok(Array.isArray(model.issueSnapshots));
    assert.equal(model.teamNameByKey['team-alpha'], 'Alpha');
});

test('buildBurnoutChartModel filters assignees and closed-before-start stories', async () => {
    const { buildBurnoutChartModel } = await import('../frontend/src/stats/burnoutChartUtils.js');
    const model = buildBurnoutChartModel({
        burnoutData: {
            range: { startDate: '2026-04-01', endDate: '2026-04-03' },
            issuesMeta: [
                { issueKey: 'OPEN-1', createdDate: '2026-03-30', assignee: { id: 'a1', name: 'Alex' } },
                { issueKey: 'DONE-OLD', createdDate: '2026-03-30', assignee: { id: 'a1', name: 'Alex' } },
                { issueKey: 'OTHER-1', createdDate: '2026-03-30', assignee: { id: 'a2', name: 'Blair' } },
            ],
            events: [],
        },
        assigneeFilter: 'a1',
        taskTeamByIssueKey: new Map([['OPEN-1', { id: 'team-alpha', name: 'Alpha' }]]),
        taskStatusByIssueKey: new Map([['OPEN-1', 'to do'], ['DONE-OLD', 'done'], ['OTHER-1', 'to do']]),
        issueWeightByKey: new Map([['OPEN-1', 1], ['DONE-OLD', 1], ['OTHER-1', 1]]),
        isCompletedSprintSelected: false,
        metric: 'issueCount',
        resolveTeamColor: () => '#2563eb',
    });

    assert.ok(model);
    assert.equal(model.summary.start, 1);
    assert.deepEqual(model.issueSnapshots.map((snapshot) => snapshot.issueKey), ['OPEN-1']);
});
```

- [x] **Step 5: Verify and commit**

Run:

```bash
npm run build
node --test tests/test_burnout_chart_utils.js
python3 -m unittest discover -s tests
```

Expected:

- `tests/test_burnout_chart_utils.js` passes.

Run the extraction guard separately:

```bash
node --test tests/test_stats_module_extraction_source_guards.js
```

Expected:

- FAIL only for remaining component bodies.
- The source guard no longer reports the `burnoutChartModel` implementation body in `dashboard.jsx`.

Commit:

```bash
git add frontend/src/stats/burnoutChartUtils.js frontend/src/dashboard.jsx tests/test_burnout_chart_utils.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "refactor: extract burndown chart model"
```

---

### Task 5: Extract Delivery Summary And Teams View

**Files:**

- Create: `frontend/src/stats/StatsDeliverySummary.jsx`
- Create: `frontend/src/stats/StatsTeamsView.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Locate current JSX blocks**

Run:

```bash
rg -n "stats-summary|statsView === 'teams'|stats-bars|statsTeamRows.map" frontend/src/dashboard.jsx
```

- [x] **Step 2: Create `StatsDeliverySummary.jsx`**

Component contract:

```jsx
import * as React from 'react';

function StatsDeliverySummary({
    statsGraphMode,
    setStatsGraphMode,
    statsTotals,
    computeRate,
    formatPercent
}) {
    // Move the current stats-summary card JSX unchanged.
}

export default React.memo(StatsDeliverySummary);
```

Keep the current keyboard behavior for selectable cards.

- [x] **Step 3: Create `StatsTeamsView.jsx`**

Component contract:

```jsx
import * as React from 'react';

function StatsTeamsView({
    open,
    statsTeamRows,
    statsBarColumns,
    statsGraphMode,
    buildStatLink,
    computeRate,
    formatPercent,
    getRateClass
}) {
    // Move the current Teams view JSX unchanged.
}

export default React.memo(StatsTeamsView);
```

Keep Jira link labels, `stats-link` anchors, table column labels, and bar class names unchanged.

- [x] **Step 4: Replace dashboard JSX**

Import:

```js
import StatsDeliverySummary from './stats/StatsDeliverySummary.jsx';
import StatsTeamsView from './stats/StatsTeamsView.jsx';
```

Replace the inline summary block with:

```jsx
{statsView !== 'cohort' && statsView !== 'excludedCapacity' && statsView !== 'monoCrossShare' && (
    <StatsDeliverySummary
        statsGraphMode={statsGraphMode}
        setStatsGraphMode={setStatsGraphMode}
        statsTotals={statsTotals}
        computeRate={computeRate}
        formatPercent={formatPercent}
    />
)}
```

Replace the Teams block with:

```jsx
<StatsTeamsView
    open={statsView === 'teams'}
    statsTeamRows={statsTeamRows}
    statsBarColumns={statsBarColumns}
    statsGraphMode={statsGraphMode}
    buildStatLink={buildStatLink}
    computeRate={computeRate}
    formatPercent={formatPercent}
    getRateClass={getRateClass}
/>
```

Preserve the wrapper class behavior: the rendered root must still include `stats-view open` only when the Teams tab is active.

- [x] **Step 5: Verify and commit**

Run:

```bash
npm run build
node --test tests/test_excluded_capacity_stats_source_guards.js
python3 -m unittest discover -s tests
```

Expected:

- Build passes.

Run the extraction guard separately:

```bash
node --test tests/test_stats_module_extraction_source_guards.js
```

Expected:

- FAIL only for Priority and Burndown component bodies.

Commit:

```bash
git add frontend/src/stats/StatsDeliverySummary.jsx frontend/src/stats/StatsTeamsView.jsx frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "refactor: extract statistics teams view"
```

---

### Task 6: Extract Priority View

**Files:**

- Create: `frontend/src/stats/StatsPriorityView.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Locate current Priority JSX**

Run:

```bash
rg -n "statsView === 'priority'|priorityRadar|priorityRows|buildRadarPoints|priorityHoverIndex" frontend/src/dashboard.jsx
```

- [x] **Step 2: Create `StatsPriorityView.jsx`**

Component contract:

```jsx
import * as React from 'react';

function StatsPriorityView({
    open,
    priorityAxis,
    priorityHoverIndex,
    setPriorityHoverIndex,
    priorityRadar,
    priorityRows,
    buildRadarPoints,
    buildPriorityStatLink,
    formatPercent,
    resolveTeamColor
}) {
    // Move the current Priority view JSX unchanged.
}

export default React.memo(StatsPriorityView);
```

Keep these behaviors unchanged:

- radar hover state remains owned by `dashboard.jsx`
- `setPriorityHoverIndex` is passed through
- Jira links still use `buildPriorityStatLink`
- table and SVG classes remain unchanged

- [x] **Step 3: Replace dashboard JSX**

Import:

```js
import StatsPriorityView from './stats/StatsPriorityView.jsx';
```

Replace the inline Priority block with:

```jsx
<StatsPriorityView
    open={statsView === 'priority'}
    priorityAxis={priorityAxis}
    priorityHoverIndex={priorityHoverIndex}
    setPriorityHoverIndex={setPriorityHoverIndex}
    priorityRadar={priorityRadar}
    priorityRows={priorityRows}
    buildRadarPoints={buildRadarPoints}
    buildPriorityStatLink={buildPriorityStatLink}
    formatPercent={formatPercent}
    resolveTeamColor={resolveTeamColor}
/>
```

- [x] **Step 4: Verify and commit**

Run:

```bash
npm run build
python3 -m unittest discover -s tests
```

Expected:

- Build passes.

Run the extraction guard separately:

```bash
node --test tests/test_stats_module_extraction_source_guards.js
```

Expected:

- FAIL only for the Burndown component body.

Commit:

```bash
git add frontend/src/stats/StatsPriorityView.jsx frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "refactor: extract statistics priority view"
```

---

### Task 7: Extract Burndown View

**Files:**

- Create: `frontend/src/stats/BurnoutChart.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Locate current Burndown JSX and supporting callbacks**

Run:

```bash
rg -n "statsView === 'burnout'|burnoutAssigneeOptions|burnoutHoverPoint|setBurnoutHoverPoint|setBurnoutHoverTeamKey|burnoutTaskFilter|formatBurndownValue|resolveBurnoutPointer|buildBurnoutTaskFilter" frontend/src/dashboard.jsx
```

- [x] **Step 2: Create `BurnoutChart.jsx`**

Component contract:

```jsx
import * as React from 'react';

function BurnoutChart({
    open,
    burnoutAssigneeFilter,
    setBurnoutAssigneeFilter,
    burnoutAssigneeOptions,
    burndownMetric,
    setBurndownMetric,
    burndownMetricIsStoryPoints,
    burnoutTotals,
    burnoutLoading,
    burnoutError,
    burnoutChartModel,
    burnoutChartRef,
    burnoutHoverPoint,
    setBurnoutHoverPoint,
    burnoutHoverTeamKey,
    setBurnoutHoverTeamKey,
    burnoutTaskFilter,
    setBurnoutTaskFilter,
    formatBurndownValue,
    resolveBurnoutPointer,
    buildBurnoutTaskFilter
}) {
    // Move the current Burndown view JSX unchanged.
}

export default React.memo(BurnoutChart);
```

Keep in `dashboard.jsx`:

- `burnoutAssigneeFilter` state
- `burndownMetric` state
- `burnoutHoverPoint` state
- `burnoutHoverTeamKey` state
- `burnoutTaskFilter` state
- `burnoutChartRef`
- effects that reset hover/task filters
- scroll-to-today effect
- `formatBurndownValue`
- `resolveBurnoutPointer`
- `buildBurnoutTaskFilter`

- [x] **Step 3: Replace dashboard JSX**

Import:

```js
import BurnoutChart from './stats/BurnoutChart.jsx';
```

Replace the inline Burndown block with:

```jsx
<BurnoutChart
    open={statsView === 'burnout'}
    burnoutAssigneeFilter={burnoutAssigneeFilter}
    setBurnoutAssigneeFilter={setBurnoutAssigneeFilter}
    burnoutAssigneeOptions={burnoutAssigneeOptions}
    burndownMetric={burndownMetric}
    setBurndownMetric={setBurndownMetric}
    burndownMetricIsStoryPoints={burndownMetricIsStoryPoints}
    burnoutTotals={burnoutTotals}
    burnoutLoading={burnoutLoading}
    burnoutError={burnoutError}
    burnoutChartModel={burnoutChartModel}
    burnoutChartRef={burnoutChartRef}
    burnoutHoverPoint={burnoutHoverPoint}
    setBurnoutHoverPoint={setBurnoutHoverPoint}
    burnoutHoverTeamKey={burnoutHoverTeamKey}
    setBurnoutHoverTeamKey={setBurnoutHoverTeamKey}
    burnoutTaskFilter={burnoutTaskFilter}
    setBurnoutTaskFilter={setBurnoutTaskFilter}
    formatBurndownValue={formatBurndownValue}
    resolveBurnoutPointer={resolveBurnoutPointer}
    buildBurnoutTaskFilter={buildBurnoutTaskFilter}
/>
```

- [x] **Step 4: Verify source guards pass**

Run:

```bash
npm run build
node --test tests/test_stats_module_extraction_source_guards.js tests/test_burnout_chart_utils.js tests/test_stats_utils.js
python3 -m unittest discover -s tests
```

Expected:

- All listed commands pass.
- `tests/test_stats_module_extraction_source_guards.js` passes for the first time.

Commit:

```bash
git add frontend/src/stats/BurnoutChart.jsx frontend/src/dashboard.jsx tests/test_stats_module_extraction_source_guards.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "refactor: extract statistics burndown view"
```

---

### Task 8: Add Focused Statistics UI Verification

**Files:**

- Modify: `tests/ui/codebase_structure_smoke.spec.js`

- [x] **Step 1: Keep the existing helper usable with committed dist**

In `tests/ui/codebase_structure_smoke.spec.js`, update `installApiMocks(page, calls, options = {})` so the existing source-bundled override is optional.

Replace:

```js
await installDashboardShell(page);
await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: dashboardJs,
}));
```

with:

```js
await installDashboardShell(page);
if (!options.useCommittedDist) {
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
}
```

This keeps existing tests unchanged while allowing the new Statistics smoke test to exercise committed `frontend/dist/dashboard.js`.

- [x] **Step 2: Capture request headers and POST bodies in the UI helper**

In the `calls.push(...)` block inside `installApiMocks`, include headers and parsed JSON body:

```js
const postData = request.postData();
let body = null;
if (postData) {
    try {
        body = JSON.parse(postData);
    } catch (err) {
        body = postData;
    }
}
calls.push({
    method: request.method(),
    pathname: url.pathname,
    search: url.search,
    params: Object.fromEntries(url.searchParams.entries()),
    headers: request.headers(),
    body,
});
```

Keep existing `callsFor`, `waitForCallCount`, and startup-count assertions working against the existing fields.

- [x] **Step 3: Mock Burndown and Lead Times statistics endpoints**

Add route branches before the unexpected-call branch:

```js
if (url.pathname === '/api/stats/burnout') {
    return json({
        data: {
            range: { startDate: '2026-04-01', endDate: '2026-04-05' },
            assignees: [{ id: 'owner-alpha', name: 'Alpha Owner', events: 1 }],
            issuesMeta: [
                {
                    issueKey: 'PROD-1',
                    createdDate: '2026-03-30',
                    assignee: { id: 'owner-alpha', name: 'Alpha Owner' },
                    teamAtStart: { id: 'team-alpha', name: 'Alpha Team' },
                },
                {
                    issueKey: 'TECH-1',
                    createdDate: '2026-04-02',
                    assignee: { id: 'owner-alpha', name: 'Alpha Owner' },
                    teamAtCreated: { id: 'team-alpha', name: 'Alpha Team' },
                },
            ],
            events: [
                {
                    issueKey: 'PROD-1',
                    date: '2026-04-04',
                    teamId: 'team-alpha',
                    teamName: 'Alpha Team',
                    assigneeName: 'Alpha Owner',
                    bucket: 'done',
                },
            ],
        },
    });
}
if (url.pathname === '/api/stats/epic-cohort') {
    return json({
        data: {
            issues: [],
            range: { startDate: '2026-01-01', endDate: '2026-06-30' },
            meta: { warnings: [] },
        },
    });
}
```

- [x] **Step 4: Add the focused Statistics subview test**

Append a test to `tests/ui/codebase_structure_smoke.spec.js`:

```js
test('Statistics subviews render extracted panels and preserve stats API ownership', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        excludedCapacityEpics: ['BAU-EPIC'],
        useCommittedDist: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showStats: true,
        statsView: 'teams',
        excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name', 4);
    await expect(page.locator('.stats-panel.open')).toBeVisible();

    await expect(page.locator('.stats-view.open .stats-bars')).toBeVisible();
    await expect(page.locator('.stats-view.open .stats-table')).toContainText('Alpha Team');
    await captureSmokeScreenshot(page, 'statistics-teams');

    const statsTabs = page.locator('.stats-view-toggle');
    await statsTabs.getByRole('radio', { name: 'Priority' }).click();
    await expect(page.locator('.stats-view.open .priority-radar')).toBeVisible();
    await expect(page.locator('.stats-view.open .priority-legend')).toContainText('Alpha Team');
    await captureSmokeScreenshot(page, 'statistics-priority');

    await statsTabs.getByRole('radio', { name: 'Burndown' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/burnout', 1);
    await expect(page.locator('.stats-view.open .burnout-chart')).toBeVisible();
    await expect(page.locator('.stats-view.open .burnout-legend')).toContainText('Alpha Team');
    const burnoutCall = calls.find(call => call.pathname === '/api/stats/burnout');
    expect(burnoutCall.method).toBe('POST');
    expect(burnoutCall.headers['x-requested-with']).toBe('jira-execution-planner');
    expect(burnoutCall.body).toMatchObject({
        sprint: selectedSprintName,
        teamIds: groupTeamIds,
        includePostSprintClosures: false,
    });
    expect(Array.isArray(burnoutCall.body.issueKeys)).toBe(true);
    await captureSmokeScreenshot(page, 'statistics-burndown');

    await statsTabs.getByRole('radio', { name: 'Lead Times' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 1);
    await expect(page.locator('.stats-view.open')).toContainText('Lead');

    await statsTabs.getByRole('radio', { name: 'Excluded Capacity' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/excluded-capacity-source', 1);
    await expect(page.locator('.stats-view.open .effort-type-split-chart')).toBeVisible();

    await statsTabs.getByRole('radio', { name: 'Mono vs Cross' }).click();
    await expect(page.locator('.stats-view.open')).toContainText('Team Cross Share');
    await expect(page.locator('.stats-view.open .excluded-capacity-line-chart')).toBeVisible();

    expect(apiMocks.unexpectedCalls).toEqual([]);
});
```

If the exact visible text differs after running the test, update the assertion to another stable existing selector or label from the rendered view; do not weaken the test to only assert `.stats-view.open`.

- [x] **Step 5: Run focused UI verification**

Run:

```bash
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews render extracted panels"
```

Expected:

- The focused test passes.
- Screenshots exist for Teams, Priority, and Burndown under `/tmp/codebase-structure-qa`.
- The Burndown call is a POST with `X-Requested-With: jira-execution-planner`.
- No unexpected `/api/*` calls are recorded.

Commit:

```bash
git add tests/ui/codebase_structure_smoke.spec.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "test: cover extracted statistics subviews"
```

---

### Task 9: Final Regression And Dist Verification

**Files:**

- Modify only if verification exposes a regression in files already touched by this plan.

- [x] **Step 1: Run focused frontend regression checks**

Run:

```bash
npm run build
node --test tests/test_stats_utils.js tests/test_burnout_chart_utils.js tests/test_stats_module_extraction_source_guards.js tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js
```

Expected:

- All pass.

- [x] **Step 2: Run full backend/unit regression**

Run:

```bash
python3 -m unittest discover -s tests
```

Expected:

- All pass.

- [x] **Step 3: Run focused and broad UI smoke coverage**

Run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews render extracted panels"
npx playwright test tests/ui/codebase_structure_smoke.spec.js
```

Expected:

- Both commands pass.
- The focused Statistics test proves Teams, Priority, Burndown, Lead Times, Excluded Capacity, and Mono vs Cross render.
- The broad smoke file still covers Catch Up, Planning, Scenario, EPM, sticky/layout, and team dropdown regressions.

- [x] **Step 4: Verify committed dist output is synchronized**

Run after the final source/dist commit:

```bash
npm run build
git diff --exit-code -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
```

Expected:

- No diff. This mirrors `.github/workflows/verify-frontend-build.yml`, which fails if `npm run build` changes committed output.

- [x] **Step 5: Review generated output and commit final guard updates**

Run:

```bash
git diff --stat
git status --short
```

Expected:

- No unrelated files staged.
- `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` are changed only because `npm run build` regenerated them.

If Task 9 required a final adjustment, commit:

```bash
git add frontend/src/stats frontend/src/dashboard.jsx tests/test_stats_utils.js tests/test_burnout_chart_utils.js tests/test_stats_module_extraction_source_guards.js tests/ui/codebase_structure_smoke.spec.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "test: verify statistics extraction"
```

---

### Task 10: Plan Closeout After Acceptance

**Files:**

- Modify: `docs/plans/EXEC-statistics-module-extraction.md`
- Modify: `docs/plans/README.md`

- [x] **Step 1: Close out only after the implementation is accepted or merged**

Do not run this task before the implementation branch is accepted or merged.

- [x] **Step 2: Add the status note and rename the plan**

Add a top note to this plan:

```md
> **Status:** Done. Executed in PR #37 / `4d3c478`. Kept for audit context only.
```

Then rename:

```bash
git mv docs/plans/EXEC-statistics-module-extraction.md docs/plans/DONE-statistics-module-extraction.md
```

- [x] **Step 3: Update `docs/plans/README.md`**

Move the Frontend Structure entry from `EXEC-statistics-module-extraction.md` to `DONE-statistics-module-extraction.md` and change its description from expected output to completed output.

- [x] **Step 4: Commit closeout docs**

Run:

```bash
git add docs/plans/DONE-statistics-module-extraction.md docs/plans/README.md
git commit -m "docs: mark statistics extraction plan done"
```

## Completion Criteria

- `frontend/src/dashboard.jsx` no longer owns extracted Teams, Priority, or Burndown implementation bodies.
- `frontend/src/stats/` owns the extracted legacy stats utilities and render-only components.
- Existing Excluded Capacity and Effort Split modules remain intact.
- `npm run build` passes.
- Focused Node tests pass.
- `python3 -m unittest discover -s tests` passes.
- `npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews render extracted panels"` passes.
- `npx playwright test tests/ui/codebase_structure_smoke.spec.js` passes or any failure is documented as an unrelated baseline with evidence.
- `npm run build` followed by `git diff --exit-code -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css` reports no diff.
- Generated `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` are committed with source changes.
