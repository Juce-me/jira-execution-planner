const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dashboard = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');
const rangePath = 'frontend/src/stats/StatsRangeControl.jsx';

test('stats ranges use one stats-owned component and existing control classes', () => {
    assert.equal(fs.existsSync(rangePath), true);
    const source = fs.readFileSync(rangePath, 'utf8');
    ['ControlField', 'stats-control-group', 'controls-label', 'view-filters', 'sprint-dropdown',
        'sprint-dropdown-toggle', 'sprint-dropdown-panel', 'sprint-dropdown-list',
        'sprint-dropdown-option'].forEach((token) => assert.ok(source.includes(token), token));
    assert.equal(source.includes('style={{'), false);
    assert.equal(source.includes("import './"), false);
});

test('dashboard keeps the global Sprint control isolated from stats ranges', () => {
    const globalSprint = dashboard.match(/const renderSprintControl = \(surface\) => \([\s\S]*?const renderGroupControl/)?.[0] || '';
    assert.ok(globalSprint.includes('<ControlField label="Sprint">'));
    assert.equal(globalSprint.includes('StatsRangeControl'), false);
});

test('implemented stats ranges use StatsRangeControl and native non-range selects remain', () => {
    assert.equal((dashboard.match(/<StatsRangeControl/g) || []).length, 3);
    assert.equal(/<label>Start Sprint<\/label>/.test(dashboard), false);
    assert.equal(/<label>End Sprint<\/label>/.test(dashboard), false);
    assert.ok(dashboard.includes('<label>Project</label>'));
    assert.ok(dashboard.includes('<label>Assignee</label>'));
});
