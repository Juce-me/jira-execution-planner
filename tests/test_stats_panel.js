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
        cohortAssigneeFilter: 'all', cohortAssigneeOptions: [{ value: 'all', label: 'All assignees' }],
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
