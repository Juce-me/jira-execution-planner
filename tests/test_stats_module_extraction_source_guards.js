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
        'requestBurnoutStats',
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

test('statistics team colors are unified through one shared resolver', () => {
    const burnoutUtilsSource = readStatsFile('burnoutChartUtils.js');
    assert.equal(burnoutUtilsSource.includes("import { RADAR_PALETTE }"), false);
    assert.equal(burnoutUtilsSource.includes('team.color = RADAR_PALETTE'), false);
    assert.ok(dashboardSource.includes('resolveTeamColor: resolveStatsTeamColor'));
    assert.ok((dashboardSource.match(/resolveTeamColor=\{resolveStatsTeamColor\}/g) || []).length >= 3);
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

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sliceBetween(source, startMarker, endMarker) {
    const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
    const match = source.match(pattern);
    assert.ok(match, `Expected a block from "${startMarker}" to "${endMarker}" in dashboard.jsx`);
    return match[0];
}

test('cohortEndQuarter is threaded through every per-group persistence site', () => {
    // Site 1: buildDefaultGroupState seeds cohortEndQuarter for a freshly-created group.
    const defaultStateSlice = sliceBetween(
        dashboardSource,
        'const buildDefaultGroupState = (groupId) => {',
        'const buildGroupStateSnapshot = () => ('
    );
    assert.ok(defaultStateSlice.includes('cohortEndQuarter:'), 'buildDefaultGroupState must seed cohortEndQuarter');

    // Site 2: buildGroupStateSnapshot captures it, and the memo wrapping it depends on it.
    const snapshotObjectSlice = sliceBetween(
        dashboardSource,
        'const buildGroupStateSnapshot = () => (',
        'const applyGroupState = (state) => {'
    );
    assert.ok(snapshotObjectSlice.includes('cohortEndQuarter,'), 'buildGroupStateSnapshot must capture cohortEndQuarter');
    const snapshotDepsSlice = sliceBetween(
        dashboardSource,
        'const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [',
        ']);'
    );
    assert.ok(snapshotDepsSlice.includes('cohortEndQuarter,'), 'groupStateSnapshot useMemo dependency array must include cohortEndQuarter');

    // Site 3: applyGroupState restores it on group switch, falling back to the current quarter.
    const applyStateSlice = sliceBetween(
        dashboardSource,
        'const applyGroupState = (state) => {',
        'const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), ['
    );
    assert.ok(
        applyStateSlice.includes('setCohortEndQuarter(nextState.cohortEndQuarter || getCurrentQuarterLabel())'),
        'applyGroupState must restore cohortEndQuarter with the getCurrentQuarterLabel() fallback'
    );

    // Site 4: the saveUiPrefs payload persists it, and the effect's dependency array reacts to it.
    const saveUiPrefsSlice = sliceBetween(dashboardSource, 'saveUiPrefs({', ']);');
    assert.equal(
        (saveUiPrefsSlice.match(/cohortEndQuarter/g) || []).length >= 2,
        true,
        'saveUiPrefs payload and its effect dependency array must both include cohortEndQuarter'
    );
});

test('cohort capacity exclusions replace the legacy inclusive filter at every state site', () => {
    assert.ok(dashboardSource.includes('const [cohortExcludeAdHoc, setCohortExcludeAdHoc]'));
    assert.equal(dashboardSource.includes('cohortCapacityFilter'), false);

    const defaultState = sliceBetween(
        dashboardSource,
        'const buildDefaultGroupState = (groupId) => {',
        'const buildGroupStateSnapshot = () => ('
    );
    const snapshot = sliceBetween(
        dashboardSource,
        'const buildGroupStateSnapshot = () => (',
        'const applyGroupState = (state) => {'
    );
    const applyState = sliceBetween(
        dashboardSource,
        'const applyGroupState = (state) => {',
        'const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), ['
    );
    const snapshotDeps = sliceBetween(
        dashboardSource,
        'const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [',
        ']);'
    );
    const savedPrefs = sliceBetween(dashboardSource, 'saveUiPrefs({', ']);');

    assert.ok(defaultState.includes('cohortExcludeAdHoc: Boolean(savedPrefsRef.current.cohortExcludeAdHoc)'));
    assert.ok(defaultState.includes('cohortExcludeCapacity:'));
    assert.ok(snapshot.includes('cohortExcludeAdHoc,'));
    assert.ok(snapshot.includes('cohortExcludeCapacity,'));
    assert.ok(snapshotDeps.includes('cohortExcludeAdHoc,'));
    assert.ok(snapshotDeps.includes('cohortExcludeCapacity,'));
    assert.ok(applyState.includes('setCohortExcludeAdHoc(Boolean(nextState.cohortExcludeAdHoc))'));
    assert.ok(applyState.includes('setCohortExcludeCapacity(nextState.cohortExcludeCapacity ?? true)'));
    assert.equal((savedPrefs.match(/cohortExcludeAdHoc/g) || []).length >= 2, true);
    assert.equal((savedPrefs.match(/cohortExcludeCapacity/g) || []).length >= 2, true);
});
