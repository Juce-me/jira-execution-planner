const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDashboardCssSource } = require('./css_source_helpers');

const repoRoot = path.join(__dirname, '..');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx'), 'utf8');
const cssSource = readDashboardCssSource(repoRoot);
const lineChartSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'ExcludedCapacityLineChart.jsx'), 'utf8');
const effortSplitChartSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'EffortTypeSplitChart.jsx'), 'utf8');
const statsSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'excludedCapacityStats.js'), 'utf8');
const hoverBubblePositionSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'ui', 'hoverBubblePosition.js'), 'utf8');
const sharedExcludedToggleSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'settings', 'sharedExcludedCapacityToggle.js'), 'utf8');
const statsTeamsViewSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'stats', 'StatsTeamsView.jsx'), 'utf8');

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

test('excluded-capacity summary shows effort share cards instead of source copy', () => {
    const excludedSummaryBlock = dashboardSource.match(/className="stats-summary excluded-capacity-summary"[\s\S]*?\n\s*\{excludedCapacityLoading/)?.[0] || '';
    assert.ok(
        dashboardSource.includes('summarizeEffortTypeSplitTotals'),
        'Expected dashboard to use shared effort split totals for summary cards'
    );
    assert.ok(
        excludedSummaryBlock.includes('<h4>Product total</h4>'),
        'Expected visible Product total card (Product including Ad Hoc)'
    );
    assert.ok(
        excludedSummaryBlock.includes('<h4>Ad Hoc Share</h4>'),
        'Expected visible Ad Hoc Share card'
    );
    assert.ok(
        excludedSummaryBlock.includes('<h4>Tech Share</h4>'),
        'Expected visible Tech Share card'
    );
    assert.ok(
        !excludedSummaryBlock.includes('<h4>Range</h4>'),
        'Excluded Capacity summary should not repeat the selected sprint range as a card'
    );
    assert.ok(
        !excludedSummaryBlock.includes('<h4>Source</h4>'),
        'Excluded Capacity summary should not render the old Source card'
    );
    assert.ok(
        !excludedSummaryBlock.includes('Planning config'),
        'Excluded Capacity summary should not show implementation source copy'
    );
    assert.ok(
        !excludedSummaryBlock.includes('Excluded epic keys from team group settings'),
        'Excluded Capacity summary should not expose team-group config internals'
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
        effortSplitChartSource.includes('onToggleBucket?.(bucket.key);'),
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

test('effort split bar segments reset global button spacing and rounding', () => {
    assert.match(
        cssSource,
        /\.effort-type-split-segment\s*\{[\s\S]*flex:\s*0 0 auto/,
        'Expected bar segment widths to use the explicit percentage basis'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-segment\s*\{[\s\S]*margin-right:\s*0/,
        'Expected bar segments to reset the global button margin that shifts zero-width buckets'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-segment\s*\{[\s\S]*border-radius:\s*0/,
        'Expected only the track, not every segment, to create the rounded bar shape'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-segment:hover\s*\{[\s\S]*transform:\s*none/,
        'Expected segment hover to avoid the global button lift'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-legend-item\s*\{[\s\S]*margin-right:\s*0/,
        'Expected legend buttons to reset the global button margin'
    );
});

test('effort split readout clamps away from viewport edges', () => {
    assert.ok(
        effortSplitChartSource.includes('function clampReadoutPoint'),
        'Expected readout coordinates to be clamped before rendering'
    );
    assert.ok(
        effortSplitChartSource.includes("import { createPortal } from 'react-dom';"),
        'Expected Effort Split readout to render outside transformed stats containers'
    );
    assert.ok(
        effortSplitChartSource.includes('createPortal(') && effortSplitChartSource.includes('document.body'),
        'Expected Effort Split readout portal to use document.body'
    );
    assert.ok(
        effortSplitChartSource.includes('resolveFloatingHoverPosition') &&
            hoverBubblePositionSource.includes('function normalizeBoundary'),
        'Expected readout clamp to use the shared hover positioning helper'
    );
    assert.ok(
        effortSplitChartSource.includes('READOUT_MAX_WIDTH'),
        'Expected readout positioning to reserve explicit maximum tooltip width'
    );
    assert.ok(
        effortSplitChartSource.includes('READOUT_HEIGHT'),
        'Expected readout positioning to reserve explicit tooltip height'
    );
    assert.ok(
        effortSplitChartSource.includes('verticalInset: READOUT_VERTICAL_INSET'),
        'Expected readout to preserve the vertical inset through shared positioning'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-readout\s*\{[\s\S]*width:\s*max-content/,
        'Expected readout to size to its content instead of reserving a wide fixed box'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-readout\s*\{[\s\S]*max-width:\s*min\(220px, calc\(100vw - 24px\)\)/,
        'Expected readout to keep a narrow maximum width'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-readout\.is-left\s*\{[\s\S]*translate\(calc\(-100% - 12px\), -50%\)/,
        'Expected right-edge readouts to open to the left of the pointer'
    );
    assert.match(
        cssSource,
        /\.effort-type-split-readout span\s*\{[\s\S]*white-space:\s*nowrap/,
        'Expected readout values to avoid one-character wrapping'
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
        effortSplitChartSource.includes('onClick={(event) => {') &&
            effortSplitChartSource.includes('setHovered(readoutFromElement(event, readout));'),
        'Expected effort split readouts to be available to click/touch users'
    );
    assert.ok(
        cssSource.includes('.effort-type-split-summary'),
        'Expected dedicated visually hidden summary styles'
    );
});

test('effort split segment labels fall back to compact integer percentages', () => {
    assert.ok(
        effortSplitChartSource.includes('const FULL_SEGMENT_LABEL_MIN_WIDTH = 10.5;'),
        'Expected full Effort Split labels to start at the 10.5% fit threshold'
    );
    assert.ok(
        effortSplitChartSource.includes('formatCompactSegmentValue'),
        'Expected a compact label formatter for narrow segments'
    );
    assert.ok(
        effortSplitChartSource.includes('Math.round(percentValue)'),
        'Expected narrow percent labels to use integer percentages'
    );
    assert.ok(
        effortSplitChartSource.includes('width >= FULL_SEGMENT_LABEL_MIN_WIDTH ? valueText : compactValueText'),
        'Expected narrow nonzero segments to render compact labels instead of hiding'
    );
    assert.ok(
        !effortSplitChartSource.includes('width >= 12 && <span>{valueText}</span>'),
        'Effort Split labels should not disappear below the old 12% threshold'
    );
});

test('shared team dropdown panels layer above open stats panels', () => {
    assert.match(
        cssSource,
        /\.view-selector:has\(\.sprint-dropdown-panel\),\s*[\s\S]*\.view-selector:has\(\.team-dropdown-panel\)\s*\{[\s\S]*z-index:\s*calc\(var\(--sticky-control-overlay-z\) \+ 2\)/,
        'Expected main controls to elevate only while a dropdown is open'
    );
    assert.match(
        cssSource,
        /\.compact-sticky-header:has\(\.sprint-dropdown-panel\),\s*[\s\S]*\.compact-sticky-header:has\(\.team-dropdown-panel\)\s*\{[\s\S]*z-index:\s*calc\(var\(--sticky-control-overlay-z\) \+ 2\)/,
        'Expected compact controls to elevate only while a dropdown is open'
    );
    assert.match(
        cssSource,
        /\.team-dropdown-panel\s*\{[\s\S]*z-index:\s*calc\(var\(--sticky-control-overlay-z\) \+ 3\)/,
        'Expected team dropdown panel to layer above the open Statistics panel'
    );
    assert.match(
        cssSource,
        /\.group-dropdown-panel\s*\{[\s\S]*z-index:\s*calc\(var\(--sticky-control-overlay-z\) \+ 3\)/,
        'Expected group dropdown panel to use the shared control overlay layer'
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
});

test('excluded-capacity filter has no BAU/ad hoc summary auto-select preset', () => {
    assert.ok(
        !dashboardSource.includes('excludedCapacityAutoEpicKeys'),
        'The summary-regex BAU/ad hoc auto-selection preset must be removed'
    );
    assert.ok(
        !dashboardSource.includes('selectAutoExcludedCapacityEpics'),
        'The BAU/ad hoc preset restore action must be removed'
    );
    assert.ok(
        !dashboardSource.includes('Filter: BAU / ad hoc'),
        'The BAU/ad hoc dropdown label must be removed'
    );
    assert.ok(
        !dashboardSource.includes('pickAutoSelectedExcludedEpics'),
        'The dashboard must not import or call the removed summary auto-select helper'
    );
    assert.ok(
        !statsSource.includes('pickAutoSelectedExcludedEpics'),
        'The excluded-capacity stats helper must no longer export the summary auto-select function'
    );
    assert.ok(
        !statsSource.includes('AUTOSELECT_SUMMARY_PATTERN'),
        'The bau|ad hoc summary regex must be removed'
    );
});

test('excluded-capacity capacity mix loads when excluded OR Ad Hoc epics are configured', () => {
    assert.ok(
        dashboardSource.includes('!excludedCapacityEpicOptions.length && adHocEpicSet.size === 0'),
        'Expected the source-load gate to require excluded OR Ad Hoc epics, not excluded only'
    );
    assert.match(
        dashboardSource,
        /buildEffortTypeSplitRows\(excludedCapacityIssues, excludedCapacitySprintRange, \{[\s\S]*adHocEpicKeys: Array\.from\(adHocEpicSet\)/,
        'Expected Effort Split rows to receive the Ad Hoc set'
    );
    const effortSplitMemoBlock = dashboardSource.match(/const effortSplitRows = React\.useMemo\(\(\) => \{[\s\S]*?\n\s*\]\);/)?.[0] || '';
    assert.ok(
        effortSplitMemoBlock.includes('adHocEpicSignature'),
        'Expected effortSplitRows dependency array to include adHocEpicSignature'
    );
});

test('excluded line chart stays excluded-only and shows an excluded-only empty state', () => {
    assert.ok(
        dashboardSource.includes('This chart tracks excluded capacity only; Ad Hoc is reported in the Effort Split above.'),
        'Expected an excluded-only empty state when no excluded epics are configured'
    );
    const effortSplitRowsMemo = dashboardSource.match(/const effortSplitRows = React\.useMemo[\s\S]*?\]\);/)?.[0] || '';
    // The excluded line chart numerator must never receive the Ad Hoc set.
    const lineSeriesMemo = dashboardSource.match(/const excludedCapacityLineSeries = React\.useMemo[\s\S]*?\]\);/)?.[0] || '';
    assert.ok(
        !lineSeriesMemo.includes('adHoc'),
        'Excluded line chart series must not include Ad Hoc keys'
    );
    assert.ok(
        effortSplitRowsMemo.includes('adHocEpicKeys'),
        'Effort Split rows (not the line chart) carry Ad Hoc'
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
        dashboardSource.includes("const isStatsSourceOnlyStatsView = showStats && (statsView === 'excludedCapacity' || statsView === 'monoCrossShare' || statsView === 'projectTrack');"),
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
        lineChartSource.includes('event.clientX') && lineChartSource.includes('event.clientY'),
        'Expected line chart readout to follow pointer coordinates'
    );
    assert.ok(
        lineChartSource.includes('HOVER_BUBBLE_WIDTH') && lineChartSource.includes('HOVER_BUBBLE_HEIGHT'),
        'Expected line chart readout to reserve measured bubble bounds'
    );
    assert.ok(
        lineChartSource.includes('resolveFloatingHoverPosition') &&
            hoverBubblePositionSource.includes("side = rightSpace >= effectiveWidth || rightSpace >= leftSpace ? 'right' : 'left'"),
        'Expected line chart readout to use shared bounded hover positioning'
    );
    assert.ok(
        lineChartSource.includes("closest?.('.excluded-capacity-line-chart')"),
        'Expected line chart readout to clamp against the chart boundary, not only the viewport'
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
        /\.excluded-capacity-line-hover-bubble\.is-left\s*\{[\s\S]*translate\(calc\(-100% - 12px\), -50%\)/,
        'Expected line chart readout to stay readable when it opens left of the pointer'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-line-hover-bubble\s*\{[\s\S]*z-index:\s*calc\(var\(--sticky-control-overlay-z\) \+ 4\)/,
        'Expected line chart readout to layer above chart and sticky controls'
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
    assert.match(
        dashboardSource,
        /<StatsRangeControl\s+idPrefix="excluded-capacity-sprint"[\s\S]*?startValue=\{excludedCapacityStartSprintId\}[\s\S]*?endValue=\{excludedCapacityEndSprintId\}/,
        'Expected the unified sprint range control to be bound to the excluded-capacity start/end sprint state'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-filter-controls \[data-stats-range="excluded-capacity-sprint"\]\s*\{[\s\S]*grid-column:\s*2 \/ span 2/,
        'Expected the unified sprint range group to span both compact sprint columns'
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

test('planning and reporting excluded capacity are backed by shared group config', () => {
    assert.ok(
        sharedExcludedToggleSource.includes('buildGroupsConfigWithExcludedCapacityToggle'),
        'Expected dashboard to use the shared group excluded-capacity toggle helper'
    );
    assert.ok(
        sharedExcludedToggleSource.includes("trackSettingsAction('departments', 'toggle_excluded_capacity'"),
        'Expected shared excluded-capacity toggles to emit settings_action analytics'
    );
    assert.ok(
        sharedExcludedToggleSource.includes('requestSaveGroupsConfig(backendUrl, buildSharedGroupsPayload(nextGroupsConfig))'),
        'Expected excluded-capacity toggle to save through /api/groups-config'
    );
    assert.ok(
        sharedExcludedToggleSource.includes('const { config: nextGroupsConfig, changed, nextExcluded, error } = buildGroupsConfigWithExcludedCapacityToggle'),
        'Expected excluded-capacity toggle to surface Ad Hoc overlap errors from the shared payload helper'
    );
    assert.ok(
        sharedExcludedToggleSource.includes('setGroupDraftError(error)'),
        'Expected excluded-capacity toggle to display Ad Hoc overlap errors instead of silently changing config'
    );
    assert.ok(
        sharedExcludedToggleSource.includes('showGroupManage && isGroupDraftDirty'),
        'Expected inline excluded-capacity toggles to guard against open dirty Department settings drafts'
    );
    assert.ok(
        sharedExcludedToggleSource.includes("setGroupDraftError('Save or discard open Department settings changes before changing excluded capacity from the board.')"),
        'Expected dirty draft guard to tell users how to recover'
    );
    assert.ok(
        sharedExcludedToggleSource.includes('applySavedGroupsConfig(payload)'),
        'Expected shared group saves to reuse the same config application helper'
    );
    assert.ok(
        /const excludedEpicSet = React\.useMemo\(\(\) => \{\s*const set = new Set\(\);\s*\(activeGroupExcludedCapacityEpics \|\| \[\]\)\.forEach/.test(dashboardSource),
        'Expected excludedEpicSet to be derived from activeGroupExcludedCapacityEpics'
    );
    assert.doesNotMatch(
        dashboardSource,
        /excludedStatsEpics/,
        'Local excludedStatsEpics must not drive Planning or Reporting excluded capacity'
    );
});

test('Ad Hoc capacity is derived from the saved active group, separate from excluded', () => {
    assert.match(
        dashboardSource,
        /const activeGroupAdHocCapacityEpics = React\.useMemo\(\(\) => \{[\s\S]*activeGroup\?\.adHocCapacityEpics/,
        'Expected activeGroupAdHocCapacityEpics to be derived from the saved active group'
    );
    assert.match(
        dashboardSource,
        /const adHocEpicSet = React\.useMemo\(\(\) => \{[\s\S]*activeGroupAdHocCapacityEpics/,
        'Expected adHocEpicSet to be derived from activeGroupAdHocCapacityEpics'
    );
    assert.ok(
        dashboardSource.includes('const adHocEpicSignature = React.useMemo('),
        'Expected a stable Ad Hoc signature for memo/cache dependency arrays'
    );
    // Ad Hoc must stay separate from the excluded set, which is the only capacity-subtracting list.
    assert.doesNotMatch(
        dashboardSource,
        /excludedEpicSet[^;]*adHocCapacityEpics/,
        'Ad Hoc epics must not be merged into excludedEpicSet'
    );
});

test('Ad Hoc set threads only into classification/reporting helpers, never excluded math', () => {
    assert.ok(
        dashboardSource.includes('buildSelectedProjectStats(selectedPlanningTasksList, techProjectKeys, adHocEpicSet)'),
        'Expected Planning selected project stats to receive the Ad Hoc set'
    );
    assert.ok(
        dashboardSource.includes('buildSelectedTeamProjectStats(selectedPlanningTasksList, getTeamInfo, techProjectKeys, adHocEpicSet)'),
        'Expected Planning selected team project stats to receive the Ad Hoc set'
    );
    assert.match(
        dashboardSource,
        /buildLocalStatsFromTasks\(statsTaskList, \{[\s\S]*adHocEpicSet,/,
        'Expected the local stats build to receive the Ad Hoc set'
    );
    assert.match(
        dashboardSource,
        /buildTeamCapacityStats\(\{[\s\S]*adHocEpicSet[\s\S]*\}\);/,
        'Expected team capacity stats to receive the Ad Hoc set'
    );
    // Excluded-capacity math must never receive the Ad Hoc set.
    assert.doesNotMatch(
        dashboardSource,
        /buildExcludedProjectStats\([^)]*adHocEpicSet/,
        'buildExcludedProjectStats must not receive the Ad Hoc set'
    );
    assert.doesNotMatch(
        dashboardSource,
        /buildExcludedCapacityByTeamId\(\{[^}]*adHocEpicSet/,
        'buildExcludedCapacityByTeamId must not receive the Ad Hoc set'
    );
});

test('Planning split bar reports Ad Hoc as included Product capacity', () => {
    const splitBarSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'eng', 'PlanningProjectSplitBar.jsx'), 'utf8');
    assert.ok(
        dashboardSource.includes('adHocProductSP={selectedAdHocProductSP}'),
        'Expected dashboard to pass Ad Hoc Product SP into the split bar'
    );
    assert.ok(
        splitBarSource.includes('Incl. Ad Hoc'),
        'Expected the Product tooltip to surface the included Ad Hoc portion'
    );
    assert.ok(
        splitBarSource.includes('project-bar-fill product-adhoc'),
        'Expected an Ad Hoc Product subsegment that reuses Product bar styling'
    );
    assert.ok(
        !/className="[^"]*product-adhoc[^"]*excluded/.test(splitBarSource),
        'Ad Hoc subsegment must not use excluded-zone styling classes'
    );
    assert.match(
        cssSource,
        /\.project-bar-fill\.product-adhoc\s*\{[\s\S]*repeating-linear-gradient/,
        'Expected dedicated Product-toned Ad Hoc subsegment styling in the Planning split CSS'
    );
});

test('Stats Teams and capacity-table links keep Ad Hoc consistent with reclassification', () => {
    // Product links INCLUDE Ad Hoc stories; Tech links EXCLUDE them.
    assert.ok(
        dashboardSource.includes('const adHocEpicChildrenClause = () => {'),
        'Expected a reusable Ad Hoc epic-children JQL clause helper'
    );
    assert.match(
        dashboardSource,
        /adHocEpicChildrenClause[\s\S]*"Epic Link" in \(\$\{quoted\}\) OR parent in \(\$\{quoted\}\)/,
        'Expected the Ad Hoc clause to reuse the established epic-children JQL pattern'
    );
    assert.match(
        dashboardSource,
        /capacityType === 'product'[\s\S]*OR \$\{adHocClause\}/,
        'Expected Product links to OR in Ad Hoc stories from any project'
    );
    assert.match(
        dashboardSource,
        /capacityType === 'tech'[\s\S]*NOT \$\{adHocClause\}/,
        'Expected Tech links to exclude Ad Hoc stories'
    );
    // Stats Teams Product/Tech link options carry the capacity type.
    assert.match(
        statsTeamsViewSource,
        /projectName: 'PRODUCT ROADMAPS'[\s\S]*capacityType: 'product'/,
        'Expected Stats Teams Product links to declare product capacity type'
    );
    assert.match(
        statsTeamsViewSource,
        /projectName: 'TECHNICAL ROADMAP'[\s\S]*capacityType: 'tech'/,
        'Expected Stats Teams Tech links to declare tech capacity type'
    );
    // Planning capacity table infers capacity type from the single roadmap project.
    assert.ok(
        dashboardSource.includes('const inferRoadmapCapacityType = ({ projectName, projectNames, capacityType }) => {'),
        'Expected Planning capacity-table links to infer Product/Tech capacity type'
    );
    assert.match(
        dashboardSource,
        /inferRoadmapCapacityType[\s\S]*single === 'PRODUCT ROADMAPS'[\s\S]*return 'product'/,
        'Expected Product roadmap rows to infer product capacity type'
    );
    assert.match(
        dashboardSource,
        /inferRoadmapCapacityType[\s\S]*single === 'TECHNICAL ROADMAP'[\s\S]*return 'tech'/,
        'Expected Tech roadmap rows to infer tech capacity type'
    );
});

test('Scenario payload sends only excluded capacity, never Ad Hoc keys', () => {
    const payloadBlock = dashboardSource.match(/const buildScenarioPayload = \(\) => \{[\s\S]*?\n {12}\};/)?.[0] || '';
    assert.ok(payloadBlock, 'Expected to locate buildScenarioPayload');
    assert.ok(
        payloadBlock.includes('excluded_capacity_epics: Array.from(excludedEpicSet)'),
        'Scenario payload must send excluded_capacity_epics from excludedEpicSet only'
    );
    assert.ok(
        !/adHoc/i.test(payloadBlock),
        'Scenario payload must never include Ad Hoc keys'
    );
    assert.ok(
        !payloadBlock.includes('adHocEpicSet'),
        'Scenario payload must not reference the Ad Hoc set'
    );
});
