const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Characterizes two App() closures by running their real source with stubbed dependencies, the
// same technique as tests/test_dashboard_freshness_interactions.js. The first block pins the
// behavior that existed before issue #194 and must pass unchanged before and after the extraction
// of `commitSprintSelection` and `persistTeamSelection`; the second block pins the contract the
// shareable-link apply relies on.
const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');

// App() declares each helper as a 12-space-indented `const name = ...` that closes with a 12-space `};`.
function appClosure(name) {
    const start = source.indexOf(`\n            const ${name} = `);
    if (start < 0) return null;
    const end = source.indexOf('\n            };\n', start);
    assert.ok(end > start, `${name} must close with a 12-space "};"`);
    return source.slice(start + 1, end + '\n            };'.length);
}

const CLOSURES = ['normalizeSelectedTeams', 'persistTeamSelection', 'commitSprintSelection', 'applyOrdinarySprint', 'toggleTeamSelection'];

function loadClosures(deps) {
    const present = CLOSURES.filter(name => appClosure(name));
    const body = present.map(appClosure).join('\n');
    return new Function(...Object.keys(deps), `${body}\nreturn { ${present.join(', ')} };`)(...Object.values(deps));
}

let persistence;
test.before(async () => { persistence = await import('../frontend/src/teamSelectionPersistence.mjs'); });

function sprintHarness(overrides = {}) {
    const log = [];
    const deps = {
        boardStrictScope: '', selectedSprint: 41, showStats: false, statsView: 'teams',
        excludedCapacityStartSprintId: '', excludedCapacityEndSprintId: '',
        activeGroupId: 'grp-a', selectedTeams: ['team-1', 'team-2'],
        trackFilterChanged: (...args) => log.push(['trackFilterChanged', ...args]),
        analyticsToken: value => `tok:${value}`,
        currentDashboardView: () => 'eng',
        buildTeamSelectionScopeKey: (...args) => persistence.buildTeamSelectionScopeKey(...args),
        teamSelectionCarryForwardRef: { current: 'untouched' },
        setSelectedSprint: value => log.push(['setSelectedSprint', value]),
        setSprintName: value => log.push(['setSprintName', value]),
        excludedCapacityForceRefreshRef: { current: false },
        setExcludedCapacityStartSprintId: value => log.push(['setExcludedCapacityStartSprintId', value]),
        setExcludedCapacityEndSprintId: value => log.push(['setExcludedCapacityEndSprintId', value]),
        setExcludedCapacityRefreshNonce: updater => log.push(['setExcludedCapacityRefreshNonce', updater(7)]),
        setBoardStrictScope: value => log.push(['setBoardStrictScope', value]),
        closeSprintSelector: options => log.push(['closeSprintSelector', options]),
        ...overrides,
    };
    return { api: loadClosures(deps), deps, log };
}

function teamHarness(overrides = {}) {
    const log = [];
    const map = new Map();
    const storage = {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, value); log.push(['storage', Object.values(JSON.parse(value))[0].selectedTeams]); },
    };
    let teams = ['all'];
    const deps = {
        teamSelectionScopeKey: 'team-selection::42::grp-a',
        window: { localStorage: storage },
        saveTeamSelectionState: (...args) => persistence.saveTeamSelectionState(...args),
        teamSelectionHydratedSelectionRef: { current: null },
        setSelectedTeams: arg => { teams = typeof arg === 'function' ? arg(teams) : arg; log.push(['setSelectedTeams', teams]); },
        trackFilterChanged: (...args) => log.push(['trackFilterChanged', ...args]),
        bucketCount: count => `b${count}`,
        ...overrides,
    };
    return { api: loadClosures(deps), deps, log, getTeams: () => teams, storage };
}

// ---- Characterization: must pass before and after the extraction ----

test('a different Sprint reports the change, carries the Team selection forward and commits id and name', () => {
    const { api, deps, log } = sprintHarness();
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Future' }, false);
    assert.deepEqual(log, [
        ['trackFilterChanged', 'sprint', { sprint_selection_state: 'tok:future', source_surface: 'eng', scope_type: 'eng' }],
        ['setSelectedSprint', 42],
        ['setSprintName', 'Sprint 42'],
        ['closeSprintSelector', { restoreFocus: true }],
    ]);
    assert.deepEqual(deps.teamSelectionCarryForwardRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['team-1', 'team-2'] });
});

test('the Board scope control reports a Sprint scope and clears the strict scope after committing', () => {
    const { api, log } = sprintHarness();
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, true);
    assert.deepEqual(log.map(entry => entry[0]), ['trackFilterChanged', 'setSelectedSprint', 'setSprintName', 'setBoardStrictScope', 'closeSprintSelector']);
    assert.deepEqual(log[0][2], { sprint_selection_state: 'tok:active', source_surface: 'eng', scope_type: 'sprint' });
    assert.deepEqual(log[3], ['setBoardStrictScope', '']);
});

test('reselecting the current Sprint outside a strict Board scope only closes the selector', () => {
    const { api, deps, log } = sprintHarness();
    api.applyOrdinarySprint({ id: '41', name: 'Sprint 41', state: 'Active' }, false);
    assert.deepEqual(log, [['closeSprintSelector', { restoreFocus: true }]]);
    assert.equal(deps.teamSelectionCarryForwardRef.current, 'untouched');
});

test('choosing the same Sprint while a strict Board scope is active still commits it', () => {
    const { api, log } = sprintHarness({ boardStrictScope: 'component' });
    api.applyOrdinarySprint({ id: 41, name: 'Sprint 41', state: 'Active' }, true);
    assert.deepEqual(log.map(entry => entry[0]), ['trackFilterChanged', 'setSelectedSprint', 'setSprintName', 'setBoardStrictScope', 'closeSprintSelector']);
});

test('a missing Department stores no Team carry-forward', () => {
    const { api, deps, log } = sprintHarness({ activeGroupId: null });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.equal(deps.teamSelectionCarryForwardRef.current, null);
    assert.deepEqual(log.filter(entry => entry[0] === 'setSelectedSprint'), [['setSelectedSprint', 42]]);
});

test('the Team carry-forward normalizes an empty or string selection', () => {
    for (const [selection, expected] of [[[], ['all']], ['team-1', ['team-1']], [['team-2'], ['team-2']]]) {
        const { api, deps } = sprintHarness({ selectedTeams: selection });
        api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
        assert.deepEqual(deps.teamSelectionCarryForwardRef.current.selectedTeams, expected);
    }
});

test('a Sprint change on the Project Track Statistics view writes both range ends and forces a refresh', () => {
    const { api, deps, log } = sprintHarness({ showStats: true, statsView: 'projectTrack' });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.deepEqual(log.map(entry => entry[0]), [
        'trackFilterChanged', 'setSelectedSprint', 'setSprintName',
        'setExcludedCapacityStartSprintId', 'setExcludedCapacityEndSprintId', 'setExcludedCapacityRefreshNonce', 'closeSprintSelector',
    ]);
    assert.deepEqual(log.slice(3, 6), [
        ['setExcludedCapacityStartSprintId', '42'], ['setExcludedCapacityEndSprintId', '42'], ['setExcludedCapacityRefreshNonce', 8],
    ]);
    assert.equal(deps.excludedCapacityForceRefreshRef.current, true);
});

test('the Project Track range is left alone when the Sprint and range already match', () => {
    const { api, deps, log } = sprintHarness({ showStats: true, statsView: 'projectTrack', selectedSprint: 42, excludedCapacityStartSprintId: '42', excludedCapacityEndSprintId: '42' });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.deepEqual(log, [['closeSprintSelector', { restoreFocus: true }]]);
    assert.equal(deps.excludedCapacityForceRefreshRef.current, false);
});

test('the same Sprint with a stale Project Track range rewrites only the range, without analytics or a Sprint commit', () => {
    const { api, deps, log } = sprintHarness({ showStats: true, statsView: 'projectTrack', selectedSprint: 42, excludedCapacityStartSprintId: '40', excludedCapacityEndSprintId: '42' });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.deepEqual(log.map(entry => entry[0]), ['setExcludedCapacityStartSprintId', 'setExcludedCapacityEndSprintId', 'setExcludedCapacityRefreshNonce', 'closeSprintSelector']);
    assert.equal(deps.teamSelectionCarryForwardRef.current, 'untouched');
});

test('ticking All Teams persists the scope, records the hydrated selection and then sets the state', () => {
    const { api, deps, log, getTeams, storage } = teamHarness();
    api.toggleTeamSelection('all');
    assert.deepEqual(log, [['storage', ['all']], ['setSelectedTeams', ['all']], ['trackFilterChanged', 'team', { selection_count_bucket: '0' }]]);
    assert.deepEqual(deps.teamSelectionHydratedSelectionRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['all'] });
    assert.deepEqual(persistence.loadTeamSelectionState(storage, 'team-selection::42::grp-a').selectedTeams, ['all']);
    assert.deepEqual(getTeams(), ['all']);
});

test('ticking one Team replaces All, persists inside the update and reports the new count', () => {
    const { api, deps, log, getTeams } = teamHarness();
    api.toggleTeamSelection('team-1');
    assert.deepEqual(log, [['trackFilterChanged', 'team', { selection_count_bucket: 'b1' }], ['storage', ['team-1']], ['setSelectedTeams', ['team-1']]]);
    assert.deepEqual(deps.teamSelectionHydratedSelectionRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['team-1'] });
    assert.deepEqual(getTeams(), ['team-1']);
});

test('ticking a second Team keeps insertion order and unticking the last Team returns to All', () => {
    const { api, getTeams, storage } = teamHarness();
    api.toggleTeamSelection('team-1');
    api.toggleTeamSelection('team-2');
    assert.deepEqual(getTeams(), ['team-1', 'team-2']);
    api.toggleTeamSelection('team-2');
    api.toggleTeamSelection('team-1');
    assert.deepEqual(getTeams(), ['all']);
    assert.deepEqual(persistence.loadTeamSelectionState(storage, 'team-selection::42::grp-a').selectedTeams, ['all']);
});

test('without a scope key a Team change updates the state and persists nothing', () => {
    const { api, deps, log, getTeams } = teamHarness({ teamSelectionScopeKey: '' });
    api.toggleTeamSelection('team-1');
    api.toggleTeamSelection('all');
    assert.equal(log.some(entry => entry[0] === 'storage'), false);
    assert.equal(deps.teamSelectionHydratedSelectionRef.current, null);
    assert.deepEqual(getTeams(), ['all']);
});

// ---- Contract for the shareable-link apply: fails until the helpers are extracted ----

test('commitSprintSelection commits a Sprint for a named Department and Team list without analytics, guard or selector side effects', () => {
    const { api, deps, log } = sprintHarness();
    assert.equal(typeof api.commitSprintSelection, 'function', 'dashboard.jsx must declare commitSprintSelection');
    api.commitSprintSelection({ id: 99, name: 'Sprint 99', state: 'Active' }, { groupId: 'grp-b', teams: ['team-9'] });
    assert.deepEqual(log, [['setSelectedSprint', 99], ['setSprintName', 'Sprint 99']]);
    assert.deepEqual(deps.teamSelectionCarryForwardRef.current, { scopeKey: 'team-selection::99::grp-b', selectedTeams: ['team-9'] });
});

test('commitSprintSelection defaults to the current Department and Team selection', () => {
    const { api, deps } = sprintHarness();
    api.commitSprintSelection({ id: 99, name: 'Sprint 99' });
    assert.deepEqual(deps.teamSelectionCarryForwardRef.current, { scopeKey: 'team-selection::99::grp-a', selectedTeams: ['team-1', 'team-2'] });
});

test('commitSprintSelection with no Department stores a null carry-forward and still commits the Sprint', () => {
    const { api, deps, log } = sprintHarness();
    api.commitSprintSelection({ id: 99, name: 'Sprint 99' }, { groupId: null });
    assert.equal(deps.teamSelectionCarryForwardRef.current, null);
    assert.deepEqual(log[0], ['setSelectedSprint', 99]);
});

test('commitSprintSelection writes the Project Track range on request and can write it alone', () => {
    const both = sprintHarness();
    both.api.commitSprintSelection({ id: 99, name: 'Sprint 99' }, { projectTrackRange: true });
    assert.deepEqual(both.log, [
        ['setSelectedSprint', 99], ['setSprintName', 'Sprint 99'],
        ['setExcludedCapacityStartSprintId', '99'], ['setExcludedCapacityEndSprintId', '99'], ['setExcludedCapacityRefreshNonce', 8],
    ]);
    assert.equal(both.deps.excludedCapacityForceRefreshRef.current, true);
    const rangeOnly = sprintHarness();
    rangeOnly.api.commitSprintSelection({ id: 99, name: 'Sprint 99' }, { sprintChanged: false, projectTrackRange: true });
    assert.deepEqual(rangeOnly.log.map(entry => entry[0]), ['setExcludedCapacityStartSprintId', 'setExcludedCapacityEndSprintId', 'setExcludedCapacityRefreshNonce']);
    assert.equal(rangeOnly.deps.teamSelectionCarryForwardRef.current, 'untouched');
});

test('persistTeamSelection saves the scope and records the hydrated selection without touching React state', () => {
    const { api, deps, log, storage } = teamHarness();
    assert.equal(typeof api.persistTeamSelection, 'function', 'dashboard.jsx must declare persistTeamSelection');
    api.persistTeamSelection(['team-3', 'team-4']);
    assert.deepEqual(log, [['storage', ['team-3', 'team-4']]]);
    assert.deepEqual(deps.teamSelectionHydratedSelectionRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['team-3', 'team-4'] });
    assert.deepEqual(persistence.loadTeamSelectionState(storage, 'team-selection::42::grp-a').selectedTeams, ['team-3', 'team-4']);
});

test('persistTeamSelection is a no-op without a scope key', () => {
    const { api, deps, log } = teamHarness({ teamSelectionScopeKey: '' });
    api.persistTeamSelection(['team-3']);
    assert.deepEqual(log, []);
    assert.equal(deps.teamSelectionHydratedSelectionRef.current, null);
});
