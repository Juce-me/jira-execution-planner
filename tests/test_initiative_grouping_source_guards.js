const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);
const engViewSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngView.jsx'),
    'utf8'
);

test('dashboard declares groupByInitiative state', () => {
    assert.ok(
        dashboardSource.includes('groupByInitiative'),
        'Expected groupByInitiative state variable in dashboard.jsx'
    );
});

test('dashboard defines groupEpicsByInitiative function', () => {
    assert.ok(
        dashboardSource.includes('groupEpicsByInitiative'),
        'Expected groupEpicsByInitiative function in dashboard.jsx'
    );
});

test('dashboard renders initiative-toggle button', () => {
    assert.ok(
        engViewSource.includes('initiative-toggle'),
        'Expected initiative-toggle class in EngView.jsx'
    );
});

test('dashboard renders initiative-group wrapper', () => {
    assert.ok(
        engViewSource.includes('initiative-group'),
        'Expected initiative-group class in EngView.jsx'
    );
});

test('dashboard renders initiative-label element', () => {
    assert.ok(
        engViewSource.includes('initiative-label'),
        'Expected initiative-label class in EngView.jsx'
    );
});
