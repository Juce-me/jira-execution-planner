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

test('implemented stats ranges use StatsRangeControl and Lead Times headings share one style', () => {
    assert.equal((dashboard.match(/<StatsRangeControl/g) || []).length, 4);
    assert.equal(/<label>Start (?:Sprint|Quarter)<\/label>/.test(dashboard), false);
    assert.equal(/<label>End (?:Sprint|Quarter)<\/label>/.test(dashboard), false);

    const start = dashboard.indexOf('<div className="stats-controls cohort-controls">');
    const end = dashboard.indexOf('<div className="stats-actions cohort-status-actions">', start);
    assert.ok(start >= 0 && end > start, 'Expected the Lead Times controls block');
    const controls = dashboard.slice(start, end);
    ['Group By', 'Project', 'Assignee', 'Exclude'].forEach((label) => {
        assert.ok(controls.includes(`<div className="controls-label">${label}</div>`), label);
    });
    assert.ok(controls.includes('aria-label="Project"'));
    assert.ok(controls.includes('aria-label="Assignee"'));
    assert.ok(controls.includes('aria-label="Exclude Ad Hoc"'));
    assert.ok(controls.includes('aria-label="Exclude Excluded Capacity"'));
    assert.ok(controls.includes('<span>Ad Hoc</span>'));
    assert.ok(controls.includes('<span>Excluded Capacity</span>'));
    assert.equal(controls.includes('<span>Exclude Ad Hoc</span>'), false);
    assert.equal(controls.includes('<span>Exclude Excluded Capacity</span>'), false);
});
