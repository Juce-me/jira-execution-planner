const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

test('dashboard declares groupByInitiative state', () => {
    assert.ok(
        source.includes('groupByInitiative'),
        'Expected groupByInitiative state variable in dashboard.jsx'
    );
});

test('dashboard defines groupEpicsByInitiative function', () => {
    assert.ok(
        source.includes('groupEpicsByInitiative'),
        'Expected groupEpicsByInitiative function in dashboard.jsx'
    );
});

test('dashboard renders initiative-toggle button', () => {
    assert.ok(
        source.includes('initiative-toggle'),
        'Expected initiative-toggle class in dashboard.jsx'
    );
});

test('dashboard renders initiative-group wrapper', () => {
    assert.ok(
        source.includes('initiative-group'),
        'Expected initiative-group class in dashboard.jsx'
    );
});

test('dashboard renders initiative-label element', () => {
    assert.ok(
        source.includes('initiative-label'),
        'Expected initiative-label class in dashboard.jsx'
    );
});
