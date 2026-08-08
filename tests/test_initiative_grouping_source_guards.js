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

test('grouping reuses the shared checkbox control', () => {
    assert.ok(
        engViewSource.includes('className="group-visible-control"'),
        'Expected grouping to reuse the existing checkbox-label control, not a new one'
    );
    assert.ok(
        engViewSource.includes('Group by initiative'),
        'Expected the grouping control to say what it groups by'
    );
});

test('grouping is a view control in the filter bar, not a filter', () => {
    assert.ok(
        /viewControls=\{[\s\S]*group-visible-control/.test(engViewSource),
        'Expected grouping to sit in the bar\'s view-control slot (D30: order and structure, not membership)'
    );
    assert.ok(
        !engViewSource.includes('display-view-row'),
        'Expected the Display/View card row to be gone'
    );
    assert.ok(
        !engViewSource.includes('view-control-grid'),
        'Expected the View card grid to be gone'
    );
    assert.ok(
        !engViewSource.includes('view-toggle-card'),
        'Expected the initiative toggle card to be gone'
    );
});

test('an explicit grouping choice is persisted, not recomputed from the data', () => {
    assert.ok(
        dashboardSource.includes('groupByInitiativeChoice'),
        'Expected an explicit-choice state distinct from the data-driven default'
    );
    assert.ok(
        !dashboardSource.includes('setGroupByInitiative(hasInitiativeData)'),
        'Expected initiative data to stop overwriting the user choice'
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
