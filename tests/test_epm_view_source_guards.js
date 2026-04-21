const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');

const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const helperSource = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, 'utf8') : '';

function countOccurrences(source, needle) {
    return (source.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

function hasCallAfter(source, marker, call) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) return false;
    return source.indexOf(call, markerIndex) !== -1;
}

test('dashboard source keeps the ENG and EPM switch contract', () => {
    assert.ok(dashboardSource.includes('selectedView'), 'Expected selectedView state in dashboard.jsx');
    assert.ok(dashboardSource.includes('epmTab'), 'Expected epmTab state in dashboard.jsx');
    assert.ok(dashboardSource.includes('mode-switch'), 'Expected mode-switch usage in dashboard.jsx');
    assert.ok(dashboardSource.includes('mode-switch-button'), 'Expected mode-switch-button usage in dashboard.jsx');
    assert.ok(!dashboardSource.includes('view-switch'), 'Did not expect view-switch in dashboard.jsx');
});

test('dashboard source reuses renderViewSwitch in both header contexts', () => {
    assert.ok(dashboardSource.includes('renderViewSwitch()'), 'Expected renderViewSwitch() in dashboard.jsx');
    assert.ok(countOccurrences(dashboardSource, 'renderViewSwitch()') >= 2, 'Expected renderViewSwitch() in both header contexts');
    assert.ok(
        hasCallAfter(dashboardSource, 'header-actions-row', 'renderViewSwitch()'),
        'Expected renderViewSwitch() near the main header actions row'
    );
    assert.ok(
        hasCallAfter(dashboardSource, 'compact-sticky-header-controls', 'renderViewSwitch()'),
        'Expected renderViewSwitch() near the compact sticky header controls'
    );
});

test('dashboard source exposes EPM settings access in both header contexts', () => {
    assert.ok(dashboardSource.includes('openEpmSettingsTab'), 'Expected openEpmSettingsTab in dashboard.jsx');
    assert.ok(
        countOccurrences(dashboardSource, 'Open EPM settings') >= 2,
        'Expected Open EPM settings controls in both full and compact headers'
    );
});

test('epm helper file exists and owns the Active only copy', () => {
    assert.ok(fs.existsSync(helperPath), 'Expected frontend/src/epm/epmProjectUtils.mjs to exist');
    assert.ok(helperSource.includes('shouldUseEpmSprint'), 'Expected shouldUseEpmSprint in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('getEpmSprintHelper'), 'Expected getEpmSprintHelper in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('Active only'), 'Expected Active only in epmProjectUtils.mjs');
    assert.ok(dashboardSource.includes('getEpmSprintHelper'), 'Expected dashboard.jsx to reference getEpmSprintHelper');
    assert.ok(dashboardSource.includes('shouldUseEpmSprint'), 'Expected dashboard.jsx to reference shouldUseEpmSprint');
});
