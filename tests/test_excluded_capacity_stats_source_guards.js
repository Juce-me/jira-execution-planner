const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css'), 'utf8');
const lineChartSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'ExcludedCapacityLineChart.jsx'), 'utf8');
const effortSplitChartSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'EffortTypeSplitChart.jsx'), 'utf8');

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

test('effort split chart uses explicit Excluded Capacity naming', () => {
    assert.ok(
        dashboardSource.includes("import EffortTypeSplitChart from './stats/EffortTypeSplitChart.jsx';"),
        'Expected dashboard to import the effort split chart'
    );
    assert.ok(
        dashboardSource.includes('Effort Split'),
        'Expected short chart title'
    );
    assert.ok(
        dashboardSource.includes('Excluded Capacity'),
        'Expected metric naming to remain Excluded Capacity'
    );
    assert.ok(
        effortSplitChartSource.includes('effort-type-split-chart'),
        'Expected dedicated effort split chart markup'
    );
    assert.ok(
        cssSource.includes('.effort-type-split-chart'),
        'Expected dedicated effort split chart styles'
    );
});

test('effort split chart uses selected sprint range source data and visible scope text', () => {
    assert.ok(
        dashboardSource.includes('buildEffortTypeSplitRows'),
        'Expected dashboard to derive effort split rows with the pure helper'
    );
    assert.ok(
        dashboardSource.includes('buildEffortTypeSplitRows(excludedCapacityIssues, excludedCapacitySprintRange'),
        'Expected Effort Split to use the Start Sprint / End Sprint range'
    );
    assert.ok(
        !dashboardSource.includes('excludedCapacitySelectedSprintForSplit'),
        'Effort Split should not use the top selected sprint independently from the range controls'
    );
    assert.ok(
        !dashboardSource.includes('excludedCapacitySourceSprintIds'),
        'Stats source fetches should follow the selected range, not a separate Effort Split sprint union'
    );
    assert.ok(
        dashboardSource.includes('effortSplitSprintLabel'),
        'Expected Effort Split to render visible selected-range scope text'
    );
    assert.ok(
        dashboardSource.includes('<EffortTypeSplitChart'),
        'Expected dashboard to render the Effort Split chart'
    );
});

test('effort split legend is the bucket control surface', () => {
    assert.ok(
        !dashboardSource.includes('effort-type-split-actions'),
        'Effort Split should not render duplicate bucket buttons above the legend'
    );
    assert.ok(
        dashboardSource.includes('onToggleBucket={toggleEffortSplitBucket}'),
        'Expected dashboard to pass bucket toggles to the chart legend'
    );
    assert.ok(
        effortSplitChartSource.includes('aria-pressed={isActive}'),
        'Expected legend buttons to expose selected bucket state'
    );
    assert.ok(
        effortSplitChartSource.includes('onClick={() => onToggleBucket?.(bucket.key)}'),
        'Expected legend buttons to control bucket visibility'
    );
    assert.ok(
        cssSource.includes('text-transform: uppercase'),
        'Expected Effort Split legend labels to render uppercase'
    );
});

test('effort split chart uses matching color tokens and pointer readouts', () => {
    assert.match(
        cssSource,
        /\.effort-type-split-legend-item\.excludedCapacity\s*\{[\s\S]*--effort-color:\s*#d89b2b/,
        'Expected excluded-capacity legend chip to use the same color token as the bar'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-segment\.excludedCapacity\s*\{[\s\S]*background:\s*var\(--effort-color\)/,
        'Expected excluded-capacity segment to use the shared color token'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-track\s*\{[\s\S]*background:\s*transparent/,
        'Expected Effort Split track to avoid the old outlined underfill background'
    );
    assert.ok(
        effortSplitChartSource.includes('onMouseMove={(event) => setHovered(readoutFromPointer(event, readout))}'),
        'Expected mouse readouts to follow the hovered segment'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-readout\s*\{[\s\S]*position:\s*fixed/,
        'Expected Effort Split readout to float near the hovered segment'
    );
});

test('effort split chart exposes keyboard and screen-reader values', () => {
    assert.ok(
        effortSplitChartSource.includes('className="effort-type-split-summary"'),
        'Expected an accessible effort split data summary'
    );
    assert.ok(
        effortSplitChartSource.includes('tabIndex={0}'),
        'Expected effort split segments to be keyboard focusable'
    );
    assert.ok(
        effortSplitChartSource.includes('onFocus={(event) => setHovered(readoutFromElement(event, readout))}'),
        'Expected effort split readouts to appear on keyboard focus'
    );
    assert.ok(
        effortSplitChartSource.includes('onClick={(event) => setHovered(readoutFromElement(event, readout))}'),
        'Expected effort split readouts to be available to click/touch users'
    );
    assert.ok(
        cssSource.includes('.effort-type-split-summary'),
        'Expected dedicated visually hidden summary styles'
    );
});

test('shared team dropdown panels layer above open stats panels', () => {
    assert.match(
        cssSource,
        /\.team-dropdown-panel\s*\{[\s\S]*z-index:\s*calc\(var\(--sticky-planning-z\) \+ 10\)/,
        'Expected team dropdown panel to layer above the open Statistics panel'
    );
    assert.match(
        cssSource,
        /\.stats-panel\.open\s*\{[\s\S]*z-index:\s*var\(--sticky-stats-z\)/,
        'Expected open Statistics panel to use an explicit sticky-layer token'
    );
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
    assert.ok(
        dashboardSource.includes("statsView === 'monoCrossShare' ? excludedCapacityModeTeamLineSeries.series : excludedCapacityLineSeries.series"),
        'Expected isolated team validation to use the Mono vs Cross team series while that tab is active'
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
    assert.ok(
        lineChartSource.includes('aria-label={isIsolated ?'),
        'Expected legend buttons to use accessible labels instead of native title tooltips'
    );
    assert.ok(
        !lineChartSource.includes('title={isIsolated ?'),
        'Legend buttons should not use native title tooltips'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-line-legend-item\s*\{[\s\S]*cursor:\s*pointer/,
        'Expected line chart legend item button styling to keep pointer affordance'
    );
});

test('excluded-capacity line chart uses a readable custom hover readout', () => {
    assert.ok(
        lineChartSource.includes('excluded-capacity-line-hover-capture'),
        'Expected line chart to have a hover capture layer'
    );
    assert.ok(
        lineChartSource.includes('excluded-capacity-line-hover-bubble'),
        'Expected line chart to render a custom hover bubble'
    );
    assert.ok(
        lineChartSource.includes('setHoverPoint'),
        'Expected line chart to track hover point state'
    );
    assert.ok(
        !lineChartSource.includes('<title>{tooltip}</title>'),
        'Line chart points should not rely on native SVG title tooltips'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-line-hover-bubble\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255/,
        'Expected custom hover bubble to use a readable light background'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-line-legend-item:hover\s*\{[\s\S]*box-shadow:/,
        'Expected legend hover to use a subtle glow instead of a dark tooltip'
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
