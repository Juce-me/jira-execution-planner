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

test('initiative toggle belongs to the View controls, not Display filters', () => {
    assert.ok(
        engViewSource.includes('display-view-row'),
        'Expected Display and View controls to share an inline row'
    );
    assert.ok(
        engViewSource.includes('view-control-grid'),
        'Expected a dedicated View controls grid in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('view-toggle-card initiative-toggle'),
        'Expected the initiative toggle to use the View toggle card styling'
    );
    assert.ok(
        !engViewSource.includes('display-view-divider'),
        'Expected Display and View labels without a divider glyph'
    );
    assert.ok(
        !engViewSource.includes('display-filter-card display-initiative'),
        'Expected initiative grouping not to be styled as a Display filter'
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
