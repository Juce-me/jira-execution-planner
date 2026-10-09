const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { readOwnerSource, repoRoot } = require('./frontend_source_helpers');

const OWNERS = ['frontend/src/dashboard.jsx', 'frontend/src/scenario', 'frontend/src/settings', 'frontend/src/epm'];
const count = (source, text) => source.split(text).length - 1;

// Frozen from the unchanged Task 0 base d0f8bc79, before any Stats extraction.
// Whitespace/comments and file order may change; event arguments and multiplicity may not.
const STATS_ANALYTICS_CALLS = [
    "trackStatsAction ( eventName , statsView , params )",
    "trackStatsAction ( 'stats_action' , nextView , { workflow_action : 'view_change' } )",
    "trackStatsAnalyticsAction ( 'chart_action' , { workflow_action : 'mode_change' , chart_id : 'excluded_capacity' , series_type : analyticsToken ( nextMode ) } )",
    "trackStatsAnalyticsAction ( 'stats_action' , { workflow_action : 'metric_change' , metric : nextMetric === 'storyPoints' ? 'story_points' : 'percent' } )",
    "trackStatsAnalyticsAction ( 'chart_action' , { workflow_action : 'capacity_side_change' , chart_id : 'project_track' , capacity_side : analyticsToken ( nextSide ) } )",
    "trackStatsAnalyticsAction ( 'filter_changed' , { filter_type : 'exclude_ad_hoc' , chart_id : 'project_track' , value_state : checked ? 'on' : 'off' } )",
    "trackStatsAnalyticsAction ( 'filter_changed' , { filter_type : 'exclude_excluded_capacity' , chart_id : 'project_track' , value_state : checked ? 'on' : 'off' } )",
    "trackStatsAnalyticsAction ( 'stats_action' , { workflow_action : 'mode_change' , chart_id : 'project_track' , mode : analyticsToken ( nextMode ) } )",
];

function statsAnalyticsCalls(source) {
    // esbuild is already installed by npm ci, including in the Node test CI job.
    // Parse JSX and remove comments before locating balanced call expressions.
    const code = esbuild.transformSync(source, {
        loader: 'jsx', minifyWhitespace: true, legalComments: 'none',
    }).code;
    const calls = [];
    for (const match of code.matchAll(/\b(?:trackStatsAction|trackStatsAnalyticsAction)\s*\(/g)) {
        let depth = 1;
        let quote = null;
        let end = match.index + match[0].length;
        for (; end < code.length && depth > 0; end++) {
            const char = code[end];
            if (quote) {
                if (char === '\\') end++;
                else if (char === quote) quote = null;
            } else if (char === "'" || char === '"' || char === '`') {
                quote = char;
            } else if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
            }
        }
        assert.equal(depth, 0, 'Stats analytics call must have balanced parentheses');
        calls.push(normalizeAnalyticsCall(code.slice(match.index, end)));
    }
    return calls;
}

function normalizeAnalyticsCall(expression) {
    // Only remove trivia/normalize string quoting. Do not rename identifiers or
    // simplify syntax: the exact callee, arguments and parameter expressions are pinned.
    return esbuild.transformSync(expression, {
        minifyWhitespace: true, legalComments: 'none',
    }).code;
}

test('Stats analytics call expressions retain the frozen baseline across the planned owners', () => {
    // Only these File Map owners may receive the calls. Parse each module separately:
    // concatenating modules would make duplicate imports/declarations invalid JavaScript.
    const owners = [
        ['frontend/src/dashboard.jsx', 'function App('],
        ['frontend/src/stats/useStatsState.js', 'function useStatsState('],
        ['frontend/src/stats/useStatsData.js', 'function useStatsDerived'],
        ['frontend/src/stats/StatsPanel.jsx', 'function StatsPanel('],
    ];
    const calls = owners.flatMap(([file, anchor], index) => {
        // Future owners are absent until their planned task creates them.
        if (index > 0 && !fs.existsSync(path.join(repoRoot, file))) return [];
        return statsAnalyticsCalls(readOwnerSource([file], { anchor }));
    });
    assert.equal(calls.length, 8);
    assert.deepEqual(calls.sort(), STATS_ANALYTICS_CALLS.map(normalizeAnalyticsCall).sort());
});

test('analytics call counts do not change when code moves between owner files', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'trackScenarioAction(' });
    assert.equal(count(source, 'trackScenarioAction('), 17);
    assert.equal(count(source, 'trackSettingsAction('), 33);
});

test('scheduleScenarioEdgeUpdate keeps its late-assignment quirk', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'let scheduleScenarioEdgeUpdate;' });
    const declaration = source.indexOf('let scheduleScenarioEdgeUpdate;');
    const layoutDeps = source.indexOf('scenarioLaneMeta, scheduleScenarioEdgeUpdate, perfEnabled]);');
    const assignment = source.indexOf('scheduleScenarioEdgeUpdate = React.useCallback(() => {');
    assert.equal(count(source, 'let scheduleScenarioEdgeUpdate;'), 1);
    assert.equal(count(source, 'scheduleScenarioEdgeUpdate = React.useCallback(() => {'), 1);
    // The layout effect's dependency array reads the variable before the assignment has run.
    assert.ok(declaration !== -1 && declaration < layoutDeps && layoutDeps < assignment);
});
