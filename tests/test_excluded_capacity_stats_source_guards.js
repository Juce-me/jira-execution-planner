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
