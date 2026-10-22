const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

const panelPath = path.join(__dirname, '../frontend/src/stats/StatsPanel.jsx');
const views = ['teams', 'priority', 'burnout', 'cohort', 'excludedCapacity', 'monoCrossShare', 'projectTrack'];
function loadPanel() {
    const code = esbuild.buildSync({ entryPoints: [panelPath], bundle: true, write: false,
        format: 'cjs', platform: 'node', external: ['react', 'react-dom'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.StatsPanel;
}
// Synthetic initial markup values, frozen from the existing panel's child contracts.
function panelProps(statsView) {
    const emptyCounts = { done: 0, incomplete: 0, killed: 0 };
    const stats = {
        statsView, canRenderStatsPanel: true, statsGraphMode: 'weighted', setStatsView() {}, setStatsGraphMode() {},
        statsTotals: { straight: emptyCounts, weighted: emptyCounts }, statsTeamRows: [], statsBarColumns: 1,
        priorityRadar: { series: [], maxValue: 1 }, priorityRows: [],
        burnoutData: null, burnoutAssigneeFilter: 'all', setBurnoutAssigneeFilter() {}, burnoutAssigneeOptions: [],
        burndownMetric: 'storyPoints', setBurndownMetric() {}, burndownMetricIsStoryPoints: true,
        burnoutTotals: { start: 0, added: 0, closed: 0, remaining: 0, closureBuckets: emptyCounts },
        burnoutLoading: false, burnoutError: '', burnoutChartModel: null, burnoutTaskFilter: null,
        formatBurndownValue: String, buildBurnoutTaskFilter() {},
        excludedCapacitySprintOptions: [], excludedCapacityStartSprintId: '', excludedCapacityEndSprintId: '',
        setExcludedCapacityStartSprintId() {}, setExcludedCapacityEndSprintId() {}, excludedCapacityEpicDropdownRef: { current: null },
        excludedCapacityEpicDropdownOpen: false, setExcludedCapacityEpicDropdownOpen() {}, excludedCapacityFilterLabel: 'All configured',
        excludedCapacityEpicCatalog: [], excludedCapacityEffectiveFilters: [], excludedCapacityChartMode: 'teams',
        excludedCapacityMetric: 'percent', excludedCapacityEpicOptions: [], excludedCapacityRows: [],
        excludedCapacityLoading: false, excludedCapacityError: '', excludedCapacityWarnings: [],
        excludedCapacityModeOverall: { totalPoints: 0, monoPoints: 0, crossPoints: 0, crossPercent: 0 },
        excludedCapacityModeSprintRows: [], excludedCapacityModeTeamLineSeries: { rows: [], teams: [] },
        excludedCapacityLineSeries: { rows: [], teams: [] }, excludedCapacitySprintRange: [],
        effortSplitTotals: { totalPoints: 0, excludedCapacityPoints: 0, excludedCapacityPercent: 0, adHocPercent: 0, productTotalPercent: 0, techPercent: 0 },
        effortSplitRows: [], effortSplitSprintLabel: '', effortSplitVisibleBuckets: {}, formatExcludedPoints: String,
        projectTrackCapacitySide: 'product', projectTrackMode: 'epic', projectTrackTotals: { byTrack: {} },
        projectTrackSeries: { tracks: [], sprints: [] }, projectTrackBreakdown: [], projectTrackRangeLabel: '',
        projectTrackPhaseLoading: false, projectTrackPhaseError: '', projectTrackPhaseSummary: { avgDaysToFirstTrack: 0 }, projectTrackPhaseEpics: [],
        cohortQuarterOptions: ['2026Q1'], cohortStartQuarter: '2026Q1', cohortEndQuarter: '2026Q1', cohortGroupBy: 'quarter',
        cohortProjectFilter: 'all', cohortProjectOptions: [{ value: 'all', label: 'All projects' }],
        cohortMode: 'created', setCohortMode() {}, cohortClosedStartQuarter: '2026Q1', setCohortClosedStartQuarter() {}, cohortClosedEndQuarter: '2026Q1', setCohortClosedEndQuarter() {},
        cohortLastN: 30, setCohortLastN() {}, cohortScope: null, cohortFetchedCount: 0, cohortAwaitingMode: false, cohortLastNShortfall: null,
        setCohortStartQuarter() {}, setCohortEndQuarter() {}, setCohortSelectedRow() {}, setCohortGroupBy() {}, setCohortProjectFilter() {},
        setCohortExcludeAdHoc() {}, setCohortExcludeCapacity() {}, setCohortStatusToggles() {},
        cohortExcludeAdHoc: false, cohortExcludeCapacity: true, cohortStatusControls: [], cohortStatusToggles: {},
        cohortSummary: { total: 0, done: 0, killed: 0, incomplete: 0, open: 0, inProgress: 0, postponed: 0, awaitingValidation: 0 },
        cohortWorkflowStatusTotal: 0, cohortAverageLeadDays: null, cohortMedianLeadDays: null,
        cohortLoading: false, cohortError: '', cohortWarnings: [], cohortSelectedRowLabel: '', cohortGridModel: null,
        cohortOpenBars: [], cohortCompletedBars: [], burnoutScopedTeamIds: [],
    };
    return { stats, links: { buildStatLink() {}, buildPriorityStatLink() {} },
        analytics: { trackStatsAction() {}, trackStatsAnalyticsAction() {} }, onSelectBurnoutTask() {},
        showStats: true, jiraUrl: 'https://synthetic.example', activeGroupMissingComponents: [], priorityAxis: [],
        resolveStatsTeamColor: () => '#123456' };
}
for (const view of views) test(`StatsPanel SSR preserves ${view} root and seven Statistics options`, () => {
    const html = renderToString(React.createElement(loadPanel(), panelProps(view)));
    assert.equal((html.match(/class="stats-panel open"/g) || []).length, 1);
    assert.equal((html.match(/class="stats-view open"/g) || []).length, 1);
    assert.match(html, /eng-mode-control stats-view-toggle/);
    const strip = html.match(/<div[^>]*aria-label="Statistics view"[\s\S]*?<\/div>/)?.[0];
    assert.ok(strip);
    assert.equal((strip.match(/role="radio"/g) || []).length, 7);
    for (const label of ['Teams', 'Priority', 'Burndown', 'Lead Times', 'Excluded Capacity', 'Mono vs Cross', 'Project Track']) assert.ok(strip.includes(label));
});
test('StatsPanel keeps the load-stats fallback inside its one root', () => {
    const props = panelProps('teams'); props.stats.canRenderStatsPanel = false;
    const html = renderToString(React.createElement(loadPanel(), props));
    assert.equal((html.match(/class="stats-panel open"/g) || []).length, 1);
    assert.ok(html.includes('Load stats for the selected sprint.'));
    assert.equal(html.includes('stats-view-toggle'), false);
});
test('StatsPanel owns chart state ref pointer and exactly two lifecycle effects', () => {
    const source = fs.readFileSync(panelPath, 'utf8');
    const signature = source.slice(source.indexOf('function StatsPanel('), source.indexOf('}) {') + 4);
    for (const name of ['priorityHoverIndex', 'burnoutHoverPoint', 'burnoutHoverTeamKey', 'burnoutChartRef', 'resolveBurnoutPointer', 'scope']) assert.equal(signature.includes(name), false, name);
    for (const name of ['priorityHoverIndex', 'burnoutHoverPoint', 'burnoutHoverTeamKey']) assert.ok(source.includes(`const [${name},`));
    assert.ok(source.includes('const burnoutChartRef = useRef(null)'));
    assert.ok(source.includes('const resolveBurnoutPointer = React.useCallback'));
    assert.equal((source.match(/useEffect\(\(\) =>/g) || []).length, 2);
    assert.ok(source.includes('[burnoutData, burnoutAssigneeFilter, statsView]'));
    assert.ok(source.includes('[burnoutChartModel, statsView]'));
    const app = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    assert.equal(app.includes('priorityHoverIndex'), false);
    assert.equal(app.includes('burnoutChartRef'), false);
    assert.equal(app.includes('resolveBurnoutPointer'), false);
});

// Every Statistics view is in the markup (the inactive ones are only closed), so slice out the Lead Times view.
function renderLeadTimes(overrides = {}) {
    const props = panelProps('cohort');
    Object.assign(props.stats, overrides);
    const html = renderToString(React.createElement(loadPanel(), props));
    return html.slice(html.indexOf('stats-controls cohort-controls'));
}
const closedChips = [{ key: 'done', label: 'Done' }, { key: 'killed', label: 'Killed' }, { key: 'incomplete', label: 'Incomplete' }];
const gridModel = { groupBy: 'quarter', columns: [{ index: 0, key: 'Q+0', label: 'Q+0' }], maxCellCount: 1, totals: { created: 1, resolvedWithDate: 1 },
    rows: [{ key: '2026Q1', label: '2026Q1', totalCreated: 1, openCount: 0, cells: [{ index: 0, count: 1, samples: [], statusCounts: {} }] }] };

test('Lead Times shows one Mode select with the three modes and no Assignee filter', () => {
    const html = renderLeadTimes();
    assert.match(html, /<select[^>]*aria-label="Lead Times mode"[^>]*>/);
    for (const label of ['Created', 'Closed', 'Last N']) assert.match(html, new RegExp(`<option[^>]*>${label}</option>`));
    assert.match(html, /<option value="created" selected=""/);
    assert.equal(/Assignee/.test(html), false);
});

test('Lead Times shows exactly the selection control of its mode', () => {
    const created = renderLeadTimes();
    assert.match(created, /Created quarter/);
    assert.equal(/Closed quarter|Number of epics/.test(created), false);
    const closed = renderLeadTimes({ cohortMode: 'closed', cohortStatusControls: closedChips });
    assert.match(closed, /Closed quarter/);
    assert.equal(/Created quarter|Number of epics/.test(closed), false);
    const lastN = renderLeadTimes({ cohortMode: 'last_n', cohortLastN: 50, cohortStatusControls: closedChips });
    assert.match(lastN, /<select[^>]*aria-label="Number of epics"[^>]*>/);
    for (const count of ['30', '50', '60']) assert.match(lastN, new RegExp(`<option value="${count}"`));
    assert.match(lastN, /<option value="50" selected=""/);
    assert.equal(/Created quarter|Closed quarter/.test(lastN), false);
});

test('Lead Times closed modes hide the open-work parts that Created shows', () => {
    const created = renderLeadTimes({ cohortGridModel: gridModel });
    assert.match(created, /Workflow Status/);
    assert.match(created, /Open Epics \(All Cohorts\)/);
    assert.match(created, /<th class="cohort-row-total">Open<\/th>/);
    for (const mode of ['closed', 'last_n']) {
        const html = renderLeadTimes({ cohortMode: mode, cohortGridModel: gridModel, cohortStatusControls: closedChips });
        assert.equal(/Workflow Status|Open Epics|In Progress|Postponed/.test(html), false, mode);
        assert.equal(/<th class="cohort-row-total">Open<\/th>/.test(html), false, mode);
        assert.match(html, /Completed Epics/);
        assert.match(html, /Epics Overview/);
    }
});

test('Lead Times names the mode in the card notes and the Completed Epics description', () => {
    assert.match(renderLeadTimes(), /Terminal epics with lead time/);
    assert.match(renderLeadTimes(), /Created within the selected Lead Times quarter range and reached a terminal status, with lead time shown\./);
    const closed = renderLeadTimes({ cohortMode: 'closed', cohortStatusControls: closedChips });
    assert.match(closed, /Epics closed in the selected range/);
    assert.match(closed, /Middle lead time of epics closed in the selected range/);
    assert.match(closed, /Closed within the selected Lead Times quarter range \(Done, Killed or Incomplete\), with lead time shown\./);
    const lastN = renderLeadTimes({ cohortMode: 'last_n', cohortStatusControls: closedChips });
    assert.match(lastN, /Most recently closed epics/);
    assert.match(lastN, /Middle lead time of the most recently closed epics/);
    assert.match(lastN, /The most recently closed epics that pass the current filters, with lead time shown\./);
});

test('Lead Times closed modes state their scope and any Last N shortfall outside the control bar', () => {
    const scopes = { components: 'Scope: Components', teams: 'Scope: Teams \\(no Components configured\\)', none: 'Scope: none configured \\(no Components or Teams\\)' };
    for (const [scope, text] of Object.entries(scopes)) {
        const html = renderLeadTimes({ cohortMode: 'closed', cohortScope: scope, cohortStatusControls: closedChips });
        assert.match(html, new RegExp(text));
        assert.ok(html.indexOf('Scope:') > html.indexOf('Excluded Capacity'), 'the note follows the control bar');
        assert.ok(html.indexOf('Scope:') < html.indexOf('cohort-status-actions'), 'the note sits above the status chips');
    }
    assert.equal(/Scope:/.test(renderLeadTimes()), false);
    const shortfall = renderLeadTimes({ cohortMode: 'last_n', cohortScope: 'components', cohortStatusControls: closedChips, cohortLastNShortfall: { shown: 20, requested: 30, ceiling: 120 } });
    assert.match(shortfall, /Showing 20 of 30: filters leave fewer than 30 Epics in the most recent 120 closed\./);
    assert.equal(/Showing \d+ of/.test(renderLeadTimes({ cohortMode: 'last_n', cohortStatusControls: closedChips })), false);
});

test('Lead Times shows loading while another mode data is awaited and never the empty message then', () => {
    const awaiting = renderLeadTimes({ cohortMode: 'closed', cohortAwaitingMode: true, cohortScope: null, cohortStatusControls: closedChips, cohortGridModel: { rows: [] } });
    assert.match(awaiting, /Loading lead time cohorts/);
    assert.equal(/cohort-empty|No closed epics/.test(awaiting), false);
    const loaded = renderLeadTimes({ cohortMode: 'closed', cohortScope: 'components', cohortFetchedCount: 0, cohortStatusControls: closedChips, cohortGridModel: { rows: [] } });
    assert.match(loaded, /No closed epics in this scope\./);
    const filtered = renderLeadTimes({ cohortMode: 'closed', cohortScope: 'components', cohortFetchedCount: 5, cohortStatusControls: closedChips, cohortGridModel: { rows: [] } });
    assert.match(filtered, /No cohort records for current filters\./);
    assert.match(renderLeadTimes({ cohortGridModel: { rows: [] } }), /No cohort records for current filters\./);
});

test('the Lead Times Mode and selection handlers clear the selected heatmap row', () => {
    const source = fs.readFileSync(panelPath, 'utf8');
    const modeSelect = source.slice(source.indexOf('aria-label="Lead Times mode"'), source.indexOf('</select>', source.indexOf('aria-label="Lead Times mode"')));
    assert.match(modeSelect, /setCohortMode\(/);
    assert.match(modeSelect, /setCohortSelectedRow\(null\)/);
    const lastNSelect = source.slice(source.indexOf('aria-label="Number of epics"'), source.indexOf('</select>', source.indexOf('aria-label="Number of epics"')));
    assert.match(lastNSelect, /setCohortLastN\(/);
    assert.match(lastNSelect, /setCohortSelectedRow\(null\)/);
});
