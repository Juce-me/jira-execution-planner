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

test('grouping reuses the shared icon-button control', () => {
    assert.ok(
        engViewSource.includes("import IconButton from '../ui/IconButton.jsx'"),
        'Expected grouping to import the shared IconButton'
    );
    assert.ok(
        engViewSource.includes('className="fb-trigger fb-trigger-icon"'),
        'Expected grouping to use the filter-bar icon trigger'
    );
    assert.ok(
        engViewSource.includes('aria-label="Group by Initiative"'),
        'Expected the grouping button to have a stable accessible name'
    );
    assert.ok(
        engViewSource.includes('aria-pressed={groupByInitiative}'),
        'Expected the grouping button to expose its pressed state'
    );
    assert.equal(engViewSource.includes('className="group-visible-control"'), false);
    assert.equal(engViewSource.includes('type="checkbox"'), false);
    assert.equal(engViewSource.includes('initiative-toggle'), false);
});

test('dashboard initiative icon can suppress its native tooltip', () => {
    assert.ok(
        dashboardSource.includes("title={title || undefined}"),
        'Expected InitiativeIcon to permit the grouping control to own its tooltip'
    );
});

test('grouping is a view control in the filter bar, not a filter', () => {
    assert.ok(
        /viewControls=\{[\s\S]*initiative-grouping-control/.test(engViewSource),
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
