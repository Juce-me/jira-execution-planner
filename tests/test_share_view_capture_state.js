const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const SHARE_VIEW = path.join(__dirname, '..', 'frontend', 'src', 'shareView');

// The builder runs against the real view defaults and codec: a capture is judged by the link a recipient would decode from it.
function loadModules() {
    const source = esbuild.buildSync({
        stdin: {
            contents: "export * from './captureState.js'; export { encodeShareView, decodeShareView } from './codec.js'; export { SHARE_VIEW_ALERT_KEYS } from './viewDefaults.js';",
            resolveDir: SHARE_VIEW, sourcefile: 'capture-state-test-entry.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', source)(loaded, loaded.exports);
    return loaded.exports;
}

const { buildShareViewState, encodeShareView, decodeShareView, SHARE_VIEW_ALERT_KEYS } = loadModules();

const noFlags = Object.fromEntries(SHARE_VIEW_ALERT_KEYS.map(key => [key, [true, () => {}]]));

function input(overrides = {}) {
    return {
        mode: 'catch-up', groupId: 'grp-a', sprintId: 4182,
        snapshot: {
            selectedTeams: ['all'], engStatusFilter: { hidden: ['Killed'] }, engPriorityFilter: null, engProjectTrackFilter: undefined,
            showProduct: true, showTech: true, groupByInitiativeChoice: null, statsView: 'teams',
            cohortStartQuarter: '2026Q3', cohortEndQuarter: '2026Q4', showAlertsPanel: true,
        },
        searchQuery: '', sort: 'priority', layout: 'table', rowsMode: null, boardStrictScope: '',
        sprintRange: { start: '', end: '' }, alertFlags: noFlags, alertCounts: {}, focus: null,
        ...overrides,
    };
}

// The link a recipient decodes from this capture: the encoder drops defaults and keys that do not apply to the mode.
function received(overrides) {
    const encoded = encodeShareView(buildShareViewState(input(overrides)));
    assert.equal(encoded.ok, true);
    const decoded = decodeShareView(`?${encoded.query}`);
    assert.equal(decoded.kind, 'ok');
    assert.deepEqual(decoded.reported, []);
    return { state: decoded.state, query: encoded.query };
}

test('a Catch Up capture carries the raw committed state and nothing outside the mode', () => {
    const { state, query } = received({
        searchQuery: 'login', focus: { kind: 'story', key: 'PROJ-7' }, rowsMode: 'story', boardStrictScope: 'component',
        snapshot: { ...input().snapshot, selectedTeams: ['t1', 't2'], engPriorityFilter: { only: ['Major'] }, engProjectTrackFilter: [], groupByInitiativeChoice: false },
    });
    assert.deepEqual(state, {
        version: 1, mode: 'catch-up', group: 'grp-a', sprint: '4182',
        teams: ['t1', 't2'], find: 'login', priority: { only: ['Major'] }, track: [], initiatives: false, focus: { kind: 'story', key: 'PROJ-7' },
    });
    assert.doesNotMatch(query, /(?:^|&)(?:rows|scope)=/, 'Planning rows and the Board scope are not Catch Up keys');
});

test('Teams are all only when the sender selection contains all, and an explicit full list stays explicit', () => {
    assert.deepEqual(buildShareViewState(input()).teams, ['all']);
    assert.deepEqual(buildShareViewState(input({ snapshot: { ...input().snapshot, selectedTeams: ['t1', 'all'] } })).teams, ['all']);
    const everyTeam = received({ snapshot: { ...input().snapshot, selectedTeams: ['t1', 't2', 't3'] } });
    assert.deepEqual(everyTeam.state.teams, ['t1', 't2', 't3']);
});

test('a null status filter is carried as neutral, and an undefined Project Track filter is left out', () => {
    const { state } = received({ snapshot: { ...input().snapshot, engStatusFilter: null } });
    assert.equal(Object.hasOwn(state, 'status'), true);
    assert.equal(state.status, null);
    assert.equal(Object.hasOwn(state, 'track'), false);
});

test('an alert focus is captured as an alertTeam and a Planning capture keeps its rows mode', () => {
    const alertState = buildShareViewState(input({ focus: { kind: 'alertTeam', anchor: 'blocked', id: 't1' } }));
    assert.deepEqual(alertState.alertTeam, { anchor: 'blocked', id: 't1' });
    assert.equal(Object.hasOwn(alertState, 'focus'), false);
    const planning = received({ mode: 'planning', rowsMode: 'story', focus: { kind: 'epic', key: 'PROJ-1' } });
    assert.deepEqual(planning.state, { version: 1, mode: 'planning', group: 'grp-a', sprint: '4182', rows: 'story', focus: { kind: 'epic', key: 'PROJ-1' } });
});

test('alerts lists only the categories that rendered and are expanded, none when all rendered ones are collapsed, off when the panel is hidden', () => {
    const flags = { ...noFlags, blocked: [false, () => {}], done: [false, () => {}] };
    const counts = { missing: 2, blocked: 1, done: 3 };
    assert.deepEqual(buildShareViewState(input({ alertFlags: flags, alertCounts: counts })).alerts, ['missing']);
    const collapsed = Object.fromEntries(Object.keys(noFlags).map(key => [key, [false, () => {}]]));
    assert.equal(buildShareViewState(input({ alertFlags: collapsed, alertCounts: counts })).alerts, 'none');
    assert.equal(buildShareViewState(input({ alertCounts: counts, snapshot: { ...input().snapshot, showAlertsPanel: false } })).alerts, 'off');
    assert.equal(Object.hasOwn(buildShareViewState(input()), 'alerts'), false, 'no alert rendered, nothing to carry');
});

test('a Board capture carries only the strict scope and the search text', () => {
    const { state } = received({ mode: 'board', boardStrictScope: 'all_work', searchQuery: 'epic one', snapshot: { ...input().snapshot, selectedTeams: ['t1'] } });
    assert.deepEqual(state, { version: 1, mode: 'board', group: 'grp-a', sprint: '4182', scope: 'all_work', find: 'epic one' });
    assert.equal(Object.hasOwn(received({ mode: 'board' }).state, 'scope'), false);
});

test('a Statistics capture carries the view, its range and Teams', () => {
    const cohort = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'cohort', selectedTeams: ['t1'] } });
    assert.deepEqual(cohort.state, { version: 1, mode: 'statistics', group: 'grp-a', sprint: '4182', teams: ['t1'], stats: 'cohort', from: '2026Q3', to: '2026Q4' });
    const sprintRange = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'projectTrack' }, sprintRange: { start: 4180, end: '4182' } });
    assert.equal(sprintRange.state.from, '4180');
    assert.equal(sprintRange.state.to, '4182');
    const noRange = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'burnout' } });
    assert.equal(Object.hasOwn(noRange.state, 'from'), false);
    const unsetRange = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'monoCrossShare' } });
    assert.equal(Object.hasOwn(unsetRange.state, 'to'), false);
});
