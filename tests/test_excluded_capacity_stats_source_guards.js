const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css'), 'utf8');
const lineChartSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'ExcludedCapacityLineChart.jsx'), 'utf8');

test('dashboard wires excluded-capacity analytics into the existing Statistics view', () => {
    assert.ok(
        dashboardSource.includes("from './stats/excludedCapacityStats.js'"),
        'Expected dashboard to import excluded-capacity stats helpers'
    );
    assert.ok(
        dashboardSource.includes('fetchExcludedCapacityStatsSource'),
        'Expected dashboard to use the excluded-capacity stats API wrapper'
    );
    assert.ok(
        /resolveStatsView[\s\S]*excludedCapacity/.test(dashboardSource),
        'Expected stats view resolver to accept excludedCapacity'
    );
    assert.ok(
        dashboardSource.includes('Excluded Capacity'),
        'Expected Statistics view toggle text for Excluded Capacity'
    );
});

test('excluded-capacity analytics has dedicated chart styling', () => {
    assert.ok(cssSource.includes('.excluded-capacity-line-chart'), 'Expected excluded capacity line chart CSS');
    assert.ok(cssSource.includes('.excluded-capacity-line-legend'), 'Expected line chart legend CSS for click-to-isolate');
    assert.ok(cssSource.includes('.excluded-capacity-epic-panel'), 'Expected multi-select excluded epic panel CSS');
    assert.ok(cssSource.includes('.epic-mode-bars'), 'Expected mono/cross epic mode chart CSS');
});

test('excluded-capacity epic menu wraps long labels without horizontal scroll', () => {
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-panel\s*\{[\s\S]*overflow-x:\s*hidden/,
        'Expected excluded epic panel to suppress horizontal scrolling'
    );
    assert.match(
        cssSource,
        /\.team-dropdown-panel label\.team-dropdown-option\s*\{[\s\S]*grid-template-columns:\s*14px 1fr/,
        'Expected excluded epic options to use the shared team dropdown checkbox layout'
    );
    assert.match(
        cssSource,
        /\.team-dropdown-panel label\.team-dropdown-option:hover\s*\{[\s\S]*background:\s*var\(--bg-primary\)/,
        'Expected excluded epic option hover to come from the shared team dropdown style'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-panel \.team-dropdown-option > span\s*\{[\s\S]*overflow-wrap:\s*anywhere/,
        'Expected long excluded epic labels to wrap inside the shared team dropdown option'
    );
});

test('excluded-capacity epic dropdown follows shared team dropdown styling', () => {
    assert.match(
        dashboardSource,
        /className=\{`team-dropdown-toggle/,
        'Expected excluded epic dropdown button to use the shared team dropdown toggle class'
    );
    assert.ok(
        dashboardSource.includes('className="team-dropdown-panel excluded-capacity-epic-panel"'),
        'Expected excluded epic menu to use the shared team dropdown panel class'
    );
    assert.ok(
        dashboardSource.includes('className="team-dropdown-option"'),
        'Expected excluded epic options to use the shared team dropdown option class'
    );
    assert.ok(
        dashboardSource.includes('className="sprint-dropdown-option"'),
        'Expected excluded epic commands to use the shared dropdown option row class'
    );
    [
        'excluded-capacity-epic-toggle',
        'excluded-capacity-epic-caret',
        'excluded-capacity-epic-menu',
        'excluded-capacity-epic-menu-actions',
        'excluded-capacity-epic-action',
        'excluded-capacity-epic-option',
        'excluded-capacity-epic-primary'
    ].forEach((className) => {
        assert.ok(
            !dashboardSource.includes(className),
            `Excluded epic dropdown should not use bespoke ${className} markup`
        );
        assert.ok(
            !cssSource.includes(`.${className}`),
            `Excluded epic dropdown should not define bespoke ${className} CSS`
        );
    });
    assert.ok(
        cssSource.includes('.team-dropdown-toggle:hover'),
        'Expected reusable team dropdown hover styling'
    );
    assert.ok(
        cssSource.includes('.team-dropdown-toggle.open svg'),
        'Expected reusable team dropdown chevron rotation styling'
    );
});

test('excluded-capacity epic filter stays compact without selected chips', () => {
    assert.ok(
        !dashboardSource.includes('excluded-capacity-epic-chips'),
        'Excluded epic selections should live in the dropdown, not in removable chips above it'
    );
    assert.ok(
        dashboardSource.includes('excludedCapacityAutoEpicKeys'),
        'Expected dashboard to preserve the BAU/ad hoc auto-selection preset'
    );
    assert.ok(
        dashboardSource.includes('Filter: BAU / ad hoc'),
        'Expected compact dropdown label for the default BAU/ad hoc filter'
    );
    assert.ok(
        dashboardSource.includes('selectAutoExcludedCapacityEpics'),
        'Expected dropdown action to restore the BAU/ad hoc preset'
    );
});

test('mono-cross share counts all scoped epics without excluded-capacity filters', () => {
    const modeOverallBlock = dashboardSource.match(/const excludedCapacityModeOverall = React\.useMemo\(\(\) => \{[\s\S]*?\n\s*\}\);/)?.[0] || '';
    const modeSprintBlock = dashboardSource.match(/const excludedCapacityModeSprintRows = React\.useMemo\(\(\) => \{[\s\S]*?\n\s*\}\);/)?.[0] || '';
    const modeTeamLineBlock = dashboardSource.match(/const excludedCapacityModeTeamLineSeries = React\.useMemo\(\(\) => \{[\s\S]*?\n\s*\}\);/)?.[0] || '';
    assert.ok(modeOverallBlock.includes('includeAllEpics: true'), 'Expected mono/cross overall row to include all scoped epics');
    assert.ok(modeSprintBlock.includes('includeAllEpics: true'), 'Expected mono/cross sprint rows to include all scoped epics');
    assert.ok(!modeOverallBlock.includes('excludedEpicKeyFilters'), 'Mono/cross overall row should not use excluded-capacity filters');
    assert.ok(!modeSprintBlock.includes('excludedEpicKeyFilters'), 'Mono/cross sprint rows should not use excluded-capacity filters');
    assert.ok(!modeTeamLineBlock.includes('excludedEpicKeyFilters'), 'Mono/cross team graph should not use excluded-capacity filters');
});

test('mono-cross team share renders as a per-sprint team line graph', () => {
    assert.ok(
        dashboardSource.includes('buildEpicTeamCrossShareLineSeries'),
        'Expected dashboard to build a team cross-share line series'
    );
    assert.ok(
        dashboardSource.includes('excludedCapacityModeTeamLineSeries.series'),
        'Expected Team Cross Share to render the line-series model'
    );
    assert.ok(
        dashboardSource.includes('ariaLabel="Team cross share per sprint"'),
        'Expected the Team Cross Share graph to expose a specific chart label'
    );
    assert.ok(
        !dashboardSource.includes('epic-mode-sprint-breakdown'),
        'Team Cross Share should use the graph, not sprint text chips'
    );
});

test('excluded-capacity stats source loads progressively and source-only tabs skip ENG task surfaces', () => {
    assert.ok(
        dashboardSource.includes('mergeExcludedCapacityStatsSourceChunks'),
        'Expected dashboard to merge progressive excluded-capacity sprint chunks'
    );
    assert.ok(
        dashboardSource.includes('sprintIds: [sprintId]'),
        'Expected excluded-capacity stats source requests to load one sprint at a time'
    );
    assert.ok(
        !dashboardSource.includes('sprintIds: excludedCapacitySprintIds,'),
        'Excluded-capacity stats source should not request the whole sprint range in one blocking call'
    );
    assert.ok(
        dashboardSource.includes("const isStatsSourceOnlyStatsView = showStats && (statsView === 'excludedCapacity' || statsView === 'monoCrossShare');"),
        'Expected source-only stats tabs to be identified explicitly'
    );
    assert.ok(
        dashboardSource.includes('if (isStatsSourceOnlyStatsView) return;'),
        'Expected ENG task fetch effect to skip source-only stats tabs'
    );
    assert.ok(
        dashboardSource.includes('{shouldRenderEngTaskList && ('),
        'Expected source-only stats tabs to hide the ENG filter/alert/task list surface'
    );
});

test('excluded-capacity line chart legend uses native clickable controls', () => {
    assert.ok(
        /<button[^>]*className=\{`excluded-capacity-line-legend-item/.test(lineChartSource),
        'Expected line chart legend items to render the shared legend item class on native buttons'
    );
    assert.match(
        lineChartSource,
        /<button[^>]*type="button"[^>]*className=\{`excluded-capacity-line-legend-item/,
        'Expected line chart legend item buttons to declare type="button"'
    );
    assert.doesNotMatch(
        lineChartSource,
        /<span[^>]*className=\{`excluded-capacity-line-legend-item/,
        'Line chart legend items should not render as spans'
    );
    assert.ok(
        !lineChartSource.includes('role="button"'),
        'Line chart legend items should not rely on span role=button semantics'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-line-legend-item\s*\{[\s\S]*cursor:\s*pointer/,
        'Expected line chart legend item button styling to keep pointer affordance'
    );
});

test('excluded-capacity controls reserve the wide column for the epic filter', () => {
    assert.ok(
        dashboardSource.includes('excluded-capacity-filter-controls'),
        'Expected excluded capacity controls to opt into the compact sprint/filter layout'
    );
    assert.ok(
        dashboardSource.includes('excluded-capacity-start-sprint-control'),
        'Expected start sprint control to be targetable as a compact sprint selector'
    );
    assert.ok(
        dashboardSource.includes('excluded-capacity-end-sprint-control'),
        'Expected end sprint control to be targetable as a compact sprint selector'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-filter-controls\s*\{[\s\S]*grid-template-columns:\s*minmax\(320px, 1fr\) repeat\(2, minmax\(118px, 148px\)\)/,
        'Expected excluded epics to get the flexible column and sprint selectors to stay compact'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-filter-controls \.excluded-capacity-epic-filter\s*\{[\s\S]*grid-column:\s*1/,
        'Expected excluded epic filter to sit in the wide first column'
    );
});
