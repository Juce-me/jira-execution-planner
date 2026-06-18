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
        engViewSource.includes('className="stats status-filter-grid"'),
        'Expected Show only cards to use the status filter card grid'
    );
    assert.ok(
        engViewSource.includes('className="stats display-filter-grid"'),
        'Expected Display controls to use the same compact card grid pattern'
    );
    assert.ok(
        engViewSource.includes('<span className="stat-label">Tech</span>'),
        'Expected compact Tech display card label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('<span className="stat-label">Product</span>'),
        'Expected compact Product display card label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('<span className="stat-label">Done</span>'),
        'Expected compact Done Display card label in EngView.jsx'
    );
    assert.equal(
        engViewSource.includes('<span className="stat-label">Closed Work</span>'),
        false,
        'Closed work Display card label should be shortened to Done'
    );
    assert.ok(
        engViewSource.includes('<span className="stat-label">Killed</span>'),
        'Expected compact Killed Display card label in EngView.jsx'
    );
    assert.ok(
        engViewSource.includes('aria-label="Show only To Do, Pending, and Accepted tasks"'),
        'Expected Queued stat filter to preserve exact status meaning'
    );
    assert.ok(
        engViewSource.includes('aria-label="Include Done and Incomplete tasks"'),
        'Expected Done Display toggle to preserve inclusion semantics'
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
        dashboardCss.includes('.filters-strip .display-filter-card'),
        'Expected Display controls to share compact stat-card styling in dashboard.css'
    );
    assert.ok(
        dashboardCss.includes('.filters-strip .display-filter-card.is-hidden:not(.applied-filter)'),
        'Expected hidden default Display cards to remain visually distinct without amber filter treatment'
    );
    assert.ok(
        dashboardCss.includes('.filters-strip .display-filter-icon'),
        'Expected the Initiative display card icon to use the shared card layout'
    );
});
