const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

const dashboardCss = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'dist', 'dashboard.css'),
    'utf8'
);

test('dashboard uses compact task filter labels without repeated show/hide verbs', () => {
    assert.ok(
        dashboardSource.includes('`Tech (${techTasksCount})`'),
        'Expected compact Tech toggle label in dashboard.jsx'
    );
    assert.ok(
        dashboardSource.includes('`Product (${productTasksCount})`'),
        'Expected compact Product toggle label in dashboard.jsx'
    );
    assert.ok(
        dashboardSource.includes('`Done / Incomplete (${doneTasks.length + incompleteTasks.length})`'),
        'Expected compact Done / Incomplete toggle label in dashboard.jsx'
    );
    assert.ok(
        dashboardSource.includes('`Killed (${killedTasks.length})`'),
        'Expected compact Killed toggle label in dashboard.jsx'
    );
    assert.equal(
        dashboardSource.includes('Hide Tech Tasks'),
        false,
        'Did not expect old Hide Tech Tasks copy in dashboard.jsx'
    );
    assert.equal(
        dashboardSource.includes('Show Product Tasks'),
        false,
        'Did not expect old Show Product Tasks copy in dashboard.jsx'
    );
    assert.equal(
        dashboardSource.includes('Hide Done/Incomplete'),
        false,
        'Did not expect old Hide Done/Incomplete copy in dashboard.jsx'
    );
    assert.equal(
        dashboardSource.includes('Hide Killed Tasks'),
        false,
        'Did not expect old Hide Killed Tasks copy in dashboard.jsx'
    );
});

test('dashboard CSS tightens the task filter toolbar spacing', () => {
    assert.ok(
        dashboardCss.includes('padding: 0.45rem 0.9rem;'),
        'Expected tighter toggle padding in dashboard.css'
    );
    assert.ok(
        dashboardCss.includes('margin: 0;'),
        'Expected toggle buttons to drop the extra horizontal margin in dashboard.css'
    );
    assert.ok(
        dashboardCss.includes('gap: 0.4rem;'),
        'Expected tighter gap in the toggle container in dashboard.css'
    );
});
