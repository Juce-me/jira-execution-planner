const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css'), 'utf8');

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
    assert.ok(cssSource.includes('.excluded-capacity-epic-menu'), 'Expected multi-select excluded epic menu CSS');
    assert.ok(cssSource.includes('.epic-mode-bars'), 'Expected mono/cross epic mode chart CSS');
});

test('excluded-capacity epic menu wraps long labels without horizontal scroll', () => {
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-menu\s*\{[\s\S]*overflow-x:\s*hidden/,
        'Expected excluded epic menu to suppress horizontal scrolling'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-option\s*\{[\s\S]*grid-template-columns:\s*1\.1rem minmax\(0, 1fr\)/,
        'Expected excluded epic options to keep checkbox in a fixed left column'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-primary\s*\{[\s\S]*white-space:\s*normal[\s\S]*overflow-wrap:\s*anywhere/,
        'Expected excluded epic labels to wrap long Home epic names'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-option \.component-result-meta\s*\{[\s\S]*grid-column:\s*2/,
        'Expected excluded epic keys to stay in the text column under the wrapped label'
    );
});

test('excluded-capacity epic dropdown follows shared component-search styling', () => {
    const actionBlock = cssSource.match(/\.excluded-capacity-epic-action\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-toggle:focus,\s*\.excluded-capacity-epic-toggle:active\s*\{[\s\S]*background-color:\s*#fff/,
        'Expected excluded epic toggle to stay white on focus/active states'
    );
    assert.match(
        cssSource,
        /\.excluded-capacity-epic-action\s*\{[\s\S]*border:\s*1px solid var\(--border\)[\s\S]*color:\s*var\(--text-primary\)/,
        'Expected excluded epic quick actions to use neutral component styling'
    );
    assert.ok(
        !actionBlock.includes('color: var(--accent)'),
        'Excluded epic actions should not use the red accent-link menu style'
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
