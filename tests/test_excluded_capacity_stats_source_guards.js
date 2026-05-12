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
    assert.ok(cssSource.includes('.excluded-capacity-chart'), 'Expected excluded capacity chart CSS');
    assert.ok(cssSource.includes('.epic-mode-bars'), 'Expected mono/cross epic mode chart CSS');
});
