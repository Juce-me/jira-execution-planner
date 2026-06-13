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

const dashboardCss = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'dist', 'dashboard.css'),
    'utf8'
);

test('dashboard uses compact task filter labels without repeated show/hide verbs', () => {
    assert.ok(engViewSource.includes('>Total<'), 'Expected compact Total stat label');
    assert.ok(engViewSource.includes('>Done<'), 'Expected compact Done stat label');
    assert.ok(engViewSource.includes('>Queued<'), 'Expected compact Queued stat label');
    assert.ok(
        engViewSource.includes('`Tech (${techTasksCount})`'),
        'Expected compact Tech toggle label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('`Product (${productTasksCount})`'),
        'Expected compact Product toggle label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('`Closed work (${doneTasks.length + incompleteTasks.length})`'),
        'Expected compact Closed work Display toggle label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('`Killed (${killedTasks.length})`'),
        'Expected compact Killed Display toggle label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('aria-label="Show only To Do, Pending, and Accepted tasks"'),
        'Expected Queued stat filter to preserve exact status meaning'
    );
    assert.ok(
        engViewSource.includes('aria-label="Include Done and Incomplete tasks"'),
        'Expected Closed work Display toggle to preserve inclusion semantics'
    );
    assert.ok(
        dashboardSource.includes('setShowKilled={setShowKilled}'),
        'Expected dashboard to pass setShowKilled into EngView for the Killed Display toggle'
    );
    assert.equal(
        engViewSource.includes('stat-card killed'),
        false,
        'Killed must not render as a Show only stat-card'
    );
    assert.equal(
        engViewSource.includes('Killed Tasks'),
        false,
        'Killed must not use a redundant Show only stat label'
    );
    assert.equal(
        dashboardSource.includes("statusFilter !== 'killed'"),
        false,
        'Killed visibility must be controlled only by showKilled'
    );
    assert.equal(
        dashboardSource.includes("if (statusFilter === 'killed')"),
        false,
        'Killed must not be reachable as a Show only statusFilter branch'
    );
    assert.equal(
        engViewSource.includes('<div className="stat-label">Done Tasks</div>'),
        false,
        'Done stat filter should use compact visible copy'
    );
    assert.equal(
        engViewSource.includes('<div className="stat-label">To Do / Pending / Accepted</div>'),
        false,
        'Queued stat filter should not expose long status list as visible copy'
    );
    assert.equal(
        engViewSource.includes('`Done / Incomplete (${doneTasks.length + incompleteTasks.length})`'),
        false,
        'Display toggle should use Closed work visible copy'
    );
    assert.equal(
        `${dashboardSource}\n${engViewSource}`.includes('Hide Tech Tasks'),
        false,
        'Did not expect old Hide Tech Tasks copy'
    );
    assert.equal(
        `${dashboardSource}\n${engViewSource}`.includes('Show Product Tasks'),
        false,
        'Did not expect old Show Product Tasks copy'
    );
    assert.equal(
        `${dashboardSource}\n${engViewSource}`.includes('Hide Done/Incomplete'),
        false,
        'Did not expect old Hide Done/Incomplete copy'
    );
    assert.equal(
        `${dashboardSource}\n${engViewSource}`.includes('Hide Killed Tasks'),
        false,
        'Did not expect old Hide Killed Tasks copy'
    );
});

test('dashboard CSS tightens the task filter toolbar spacing', () => {
    assert.ok(
        dashboardCss.includes('padding: 0.42rem 0.78rem;'),
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
