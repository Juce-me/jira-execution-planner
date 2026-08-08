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
const catchUpFiltersSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'eng', 'engCatchUpFilters.js'),
    'utf8'
);

const dashboardCss = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'dist', 'dashboard.css'),
    'utf8'
);

test('Catch Up renders the shared compact filter bar instead of the filter cards', () => {
    assert.ok(
        engViewSource.includes("import EngFilterBar from './EngFilterBar.jsx'"),
        'Expected EngView to render the shared filter bar component'
    );
    assert.ok(
        engViewSource.includes('<EngFilterBar'),
        'Expected EngView to mount EngFilterBar'
    );
    assert.ok(
        engViewSource.includes('subject={engFilters.subject}'),
        'Expected the bar to state its subject on screen so the two facet sets stay distinguishable'
    );
});

test('the ten Catch Up filter cards and their grids no longer render', () => {
    [
        'status-filter-grid',
        'display-filter-grid',
        'view-control-grid',
        'stat-card',
        'stats-note',
        'display-filter-card',
        'display-tech',
        'display-product',
        'display-closed-work',
        'display-killed',
        'initiative-toggle',
        'filters-strip',
    ].forEach((token) => {
        assert.equal(
            engViewSource.includes(token),
            false,
            `Expected the filter-card chrome "${token}" to be gone from EngView.jsx`
        );
    });
    ['>Total<', '>Queued<', '>High Priority<', '>Minor + Lower<'].forEach((label) => {
        assert.equal(engViewSource.includes(label), false, `Expected the card label ${label} to be gone`);
    });
});

test('the single statusFilter select and the four Display toggles are gone from the dashboard', () => {
    ['setStatusFilter(', 'setShowDone(', 'setShowKilled(', "statusFilter === '", "statusFilter !== '"].forEach((symbol) => {
        assert.equal(
            dashboardSource.includes(symbol),
            false,
            `Expected ${symbol} to be replaced by the Status facet`
        );
    });
    assert.equal(
        engViewSource.includes('showKilled'),
        false,
        'Expected the Killed Display toggle to be subsumed by the Status facet'
    );
    assert.equal(
        engViewSource.includes('showDone'),
        false,
        'Expected the Done Display toggle to be subsumed by the Status facet'
    );
});

test('Catch Up supplies the Status, Priority and Projects facets and nothing else', () => {
    assert.ok(catchUpFiltersSource.includes("id: 'status'"), 'Expected a Status facet (D14: Catch Up is a list)');
    assert.ok(catchUpFiltersSource.includes("id: 'priority'"), 'Expected a Priority facet');
    assert.ok(catchUpFiltersSource.includes("id: 'projects'"), 'Expected a Projects facet');
    assert.equal(
        catchUpFiltersSource.includes("id: 'track'"),
        false,
        'Delivery track is an epic field and is not a Catch Up facet'
    );
    assert.equal(
        catchUpFiltersSource.includes("id: 'assignee'"),
        false,
        'Assignee filtering is not part of Catch Up'
    );
});

test('the Projects facet keeps the product and tech fetches separate', () => {
    assert.ok(
        dashboardSource.includes('showTech') && dashboardSource.includes('showProduct'),
        'Expected showTech/showProduct to survive as the Projects facet state (MRT010: two fetches stay two fetches)'
    );
    assert.equal(
        catchUpFiltersSource.includes('fetch('),
        false,
        'The Catch Up facet model must stay pure: no fetching'
    );
});

test('sort and grouping move into the bar as view controls, outside the chip grammar', () => {
    assert.ok(
        engViewSource.includes('viewControls={'),
        'Expected sort and grouping to be slotted into the bar as view controls (D30)'
    );
    assert.ok(
        engViewSource.includes('eng-epic-sort-dropdown'),
        'Expected the existing sprint-dropdown sort control to be reused, not replaced'
    );
    assert.ok(
        engViewSource.includes('sprint-dropdown sprint-dropdown-compact'),
        'Expected the compact size to come from the control\'s own modifier hook, not bar CSS'
    );
    assert.ok(
        engViewSource.includes('group-visible-control'),
        'Expected grouping to reuse the existing checkbox-label control'
    );
});

test('an explicit initiative-grouping choice survives new initiative data', () => {
    assert.equal(
        dashboardSource.includes('setGroupByInitiative(hasInitiativeData)'),
        false,
        'The data-driven effect must not overwrite an explicit user choice'
    );
    assert.ok(
        dashboardSource.includes('groupByInitiativeChoice'),
        'Expected an explicit-choice state distinct from the data-driven default'
    );
    assert.ok(
        /saveUiPrefs\(\{[\s\S]*?groupByInitiativeChoice,/.test(dashboardSource),
        'Expected the grouping choice to be persisted (§2)'
    );
});

test('the persisted Catch Up filter state round-trips through prefs and per-group state', () => {
    ['engStatusFilter', 'engPriorityFilter'].forEach((key) => {
        const occurrences = dashboardSource.split(key).length - 1;
        assert.ok(
            occurrences >= 4,
            `Expected ${key} in the state, the prefs payload, the per-group default and the restore (found ${occurrences})`
        );
    });
});

test('dashboard CSS carries the filter bar geometry contract', () => {
    assert.ok(
        dashboardCss.includes('.filterbar {'),
        'Expected the compact filter bar to reach the built stylesheet'
    );
    assert.ok(
        /\.filterbar \{[^}]*height: 42px;/.test(dashboardCss),
        'Expected the bar to keep its fixed single-row height (D36)'
    );
    assert.ok(
        /\.fb-chips \{[^}]*overflow: hidden;/.test(dashboardCss),
        'Expected the chips lane to clip before the bar can grow a second row'
    );
    assert.ok(
        /\.sprint-dropdown-compact \.sprint-dropdown-toggle \{[^}]*height: 30px;/.test(dashboardCss),
        'Expected the sort control to take its own compact modifier rather than the bar growing to 38px'
    );
    assert.equal(
        /\.fb-view-controls \.sprint-dropdown-toggle \{[^}]*height:/.test(dashboardCss),
        false,
        'MRT021: the bar must not set a shared control\'s height from its own stylesheet'
    );
});
