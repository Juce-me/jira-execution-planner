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
