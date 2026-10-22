const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SRC = path.join(__dirname, '..', 'frontend', 'src');

// One bundle holds the resolver, its defaults and the repo functions the vectors are defined against.
function loadModules() {
    const code = esbuild.buildSync({
        stdin: {
            contents: [
                "export * from './shareView/resolver.js';",
                "export * from './shareView/viewDefaults.js';",
                "export { sanitizeSelectedTeamsForScope } from './teamSelectionUtils.mjs';",
                "export { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } from './eng/engCatchUpFilters.js';",
            ].join('\n'),
            resolveDir: SRC,
        },
        bundle: true, write: false, format: 'cjs', platform: 'node',
    }).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
    return loaded.exports;
}

function loadEngModeControl() {
    const entryPoint = path.join(SRC, 'eng', 'EngModeControl.jsx');
    const result = esbuild.buildSync({
        entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'cjs',
        external: ['react'], loader: { '.jsx': 'jsx', '.js': 'jsx' },
    });
    const mod = new Module(entryPoint, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entryPoint));
    mod._compile(result.outputFiles[0].text, entryPoint);
    return mod.exports.default;
}

const {
    resolveShareViewScope, buildShareViewFieldPlan, resolveShareViewTeams, resolveShareViewFacets,
    resolveShareViewFocus, SHARE_VIEW_DEFAULTS, SHARE_VIEW_ALERT_KEYS,
    sanitizeSelectedTeamsForScope, buildEngCatchUpFacetModel, resolveEngCatchUpFilters,
} = loadModules();

// Synthetic catalogs only. Ids are numbers as the validated Sprint catalog holds them.
const GROUP = { id: 'dept/a', teamIds: ['t1', 't2', 't3', 't4'] };
const SPRINTS = [
    { id: 4180, name: 'Sprint 80', state: 'closed', startDate: '2026-08-03' },
    { id: 4181, name: 'Sprint 81', state: 'closed', startDate: '2026-08-17' },
    { id: 4182, name: 'Sprint 82', state: 'active', startDate: '2026-08-31' },
    { id: 4183, name: 'Sprint 83', state: 'future', startDate: '2026-09-14' },
];
const CTX = { visibleGroups: [GROUP, { id: 'dept-b', teamIds: ['t9'] }], sprints: SPRINTS, currentQuarter: '2026Q4' };
const OPTIONS = {
    status: ['To Do', 'In Progress', 'Done'],
    priority: ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial'],
    track: ['committed', 'flexible'],
};
const ALL_ALERTS_OPEN = Object.fromEntries(SHARE_VIEW_ALERT_KEYS.map((key) => [key, true]));
const ALL_ALERTS_SHUT = Object.fromEntries(SHARE_VIEW_ALERT_KEYS.map((key) => [key, false]));

const link = (overrides = {}) => ({ version: 1, mode: 'catch-up', group: 'dept/a', sprint: '4182', ...overrides });
const scopeFor = (overrides = {}, ctx = CTX) => resolveShareViewScope(link(overrides), ctx);
function planFor(overrides = {}, ctx = CTX) {
    const state = link(overrides);
    return buildShareViewFieldPlan(state, resolveShareViewScope(state, ctx), ctx);
}
const withSprint = (state) => ({ ...CTX, sprints: [{ id: 4182, name: 'Sprint 82', state, startDate: '2026-08-31' }] });

// --- Contract with viewDefaults ----------------------------------------------------------------

test('viewDefaults holds every default the resolver reads, with the values the design fixes', () => {
    for (const key of ['teams', 'find', 'status', 'priority', 'lanes', 'initiatives', 'sort', 'layout', 'rows', 'scope', 'stats']) {
        assert.equal(Object.hasOwn(SHARE_VIEW_DEFAULTS, key), true, `SHARE_VIEW_DEFAULTS.${key}`);
    }
    assert.deepEqual(SHARE_VIEW_DEFAULTS.teams, ['all']);
    assert.equal(SHARE_VIEW_DEFAULTS.find, '');
    assert.deepEqual(SHARE_VIEW_DEFAULTS.status, { hidden: ['Killed'] });
    assert.equal(SHARE_VIEW_DEFAULTS.priority, null);
    assert.equal(SHARE_VIEW_DEFAULTS.track, undefined);
    assert.deepEqual(SHARE_VIEW_DEFAULTS.lanes, { product: true, tech: true });
    assert.equal(SHARE_VIEW_DEFAULTS.initiatives, null);
    assert.equal(SHARE_VIEW_DEFAULTS.sort, 'priority');
    assert.equal(SHARE_VIEW_DEFAULTS.layout, 'table');
    assert.equal(SHARE_VIEW_DEFAULTS.rows, 'epic');
    assert.equal(SHARE_VIEW_DEFAULTS.scope, '');
    assert.equal(SHARE_VIEW_DEFAULTS.stats, 'teams');
    assert.deepEqual([...SHARE_VIEW_ALERT_KEYS], [
        'missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done',
    ]);
});

// --- Scope: group, sprint, mode --------------------------------------------------------------

test('the group matches exactly and case-sensitively in the visible groups', () => {
    const resolved = scopeFor();
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.group, { id: 'dept/a', teamIds: ['t1', 't2', 't3', 't4'] });
    for (const group of ['Dept/A', 'dept/a ', 'dept-a', '', undefined]) {
        assert.deepEqual(scopeFor({ group }), { ok: false, reason: 'group_unresolved', reported: ['group'] }, String(group));
    }
});

test('the sprint is matched by String(id) and returns the catalog entry own id, name and state', () => {
    const resolved = scopeFor();
    assert.deepEqual(resolved.sprint, { id: 4182, name: 'Sprint 82', state: 'active' });
    assert.equal(resolved.sprint.id, 4182, 'the catalog id keeps its own type: downstream compares with ===');
    const stringCatalog = { ...CTX, sprints: SPRINTS.map((sprint) => ({ ...sprint, id: String(sprint.id) })) };
    assert.equal(scopeFor({}, stringCatalog).sprint.id, '4182');
    for (const sprint of ['4999', '04182', '4182.0', '', undefined]) {
        assert.deepEqual(scopeFor({ sprint }), { ok: false, reason: 'sprint_unresolved', reported: ['sprint'] }, String(sprint));
    }
});

test('an unresolved group and sprint report both categories, group first', () => {
    assert.deepEqual(scopeFor({ group: 'nope', sprint: '1' }), {
        ok: false, reason: 'group_unresolved', reported: ['group', 'sprint'],
    });
});

test('group team ids come back trimmed, de-duplicated and non-empty', () => {
    const ctx = { ...CTX, visibleGroups: [{ id: 'dept/a', teamIds: [' t1 ', 't1', '', null, 't2'] }] };
    assert.deepEqual(scopeFor({}, ctx).group.teamIds, ['t1', 't2']);
});

test('Planning needs a sprint that is not closed; Statistics and Board allow every sprint state', () => {
    const cases = [
        // [mode, sprint state, resolved mode, reported]
        ['catch-up', 'closed', 'catch-up', []], ['catch-up', 'active', 'catch-up', []], ['catch-up', 'future', 'catch-up', []],
        ['board', 'closed', 'board', []], ['board', 'active', 'board', []], ['board', 'future', 'board', []],
        ['planning', 'closed', 'catch-up', ['mode']], ['planning', 'active', 'planning', []], ['planning', 'future', 'planning', []],
        ['statistics', 'future', 'statistics', []], ['statistics', 'active', 'statistics', []], ['statistics', 'closed', 'statistics', []],
        ['planning', 'CLOSED', 'catch-up', ['mode']], ['statistics', 'Future', 'statistics', []],
        ['planning', '', 'planning', []], ['statistics', undefined, 'statistics', []],
    ];
    for (const [mode, sprintState, expected, reported] of cases) {
        const resolved = scopeFor({ mode }, withSprint(sprintState));
        assert.equal(resolved.ok, true);
        assert.equal(resolved.mode, expected, `${mode} on ${sprintState}`);
        assert.deepEqual(resolved.reported, reported, `${mode} on ${sprintState}`);
    }
});

test('scenario, epm and unknown modes fall back to Catch Up and report mode', () => {
    for (const mode of ['scenario', 'epm', 'Board', 'Catch-Up', '', undefined, null, '__proto__', 'constructor']) {
        const resolved = scopeFor({ mode });
        assert.equal(resolved.mode, 'catch-up', String(mode));
        assert.deepEqual(resolved.reported, ['mode'], String(mode));
    }
});

test('mode availability equals what the real EngModeControl disables', () => {
    const EngModeControl = loadEngModeControl();
    for (const sprintState of ['active', 'future', 'closed', '']) {
        const markup = renderToStaticMarkup(React.createElement(EngModeControl, {
            activeMode: 'catch-up',
            isCompletedSprintSelected: sprintState === 'closed',
            isFutureSprintSelected: sprintState === 'future',
            onChange: () => {},
            selectedSprint: '4182',
        }));
        for (const [mode, label] of [['planning', 'Planning'], ['statistics', 'Statistics'], ['board', 'Board']]) {
            const button = markup.match(new RegExp(`<button[^>]*>${label}</button>`))[0];
            assert.equal(scopeFor({ mode }, withSprint(sprintState)).mode === mode, !/disabled/.test(button), `${label} on "${sprintState}"`);
        }
    }
});

test('dashboard.jsx still derives the sprint-state predicates the resolver mirrors', () => {
    const source = fs.readFileSync(path.join(SRC, 'dashboard.jsx'), 'utf8');
    for (const line of [
        "const selectedSprintState = (selectedSprintInfo?.state || '').toLowerCase();",
        "const isCompletedSprintSelected = selectedSprintState === 'closed';",
        "const isFutureSprintSelected = selectedSprintState === 'future';",
        "(resume.engMode === 'planning' && isCompletedSprintSelected)",
    ]) {
        assert.ok(source.includes(line), `dashboard.jsx no longer contains: ${line}`);
    }
});

// --- Teams -----------------------------------------------------------------------------------

test('teams: all, and an omitted key, resolve to all without a report', () => {
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['all'] }), GROUP), { teams: ['all'], reported: [] });
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t1', 'all'] }), GROUP), { teams: ['all'], reported: [] });
    assert.deepEqual(resolveShareViewTeams(link(), GROUP), { teams: ['all'], reported: [] });
});

test('teams: ids are de-duplicated, kept in link order and intersected with the group', () => {
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t3', 't1', 't3'] }), GROUP), { teams: ['t3', 't1'], reported: [] });
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t2', 'x9', 't1'] }), GROUP), { teams: ['t2', 't1'], reported: ['teams'] });
});

test('teams: no match skips the key and reports teams, never the widened all', () => {
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['zz'] }), GROUP), { teams: null, reported: ['teams'] });
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t1'] }), { id: 'g', teamIds: [] }), { teams: null, reported: ['teams'] });
});

test('teams: the repo vectors, and what sanitizeSelectedTeamsForScope would have done instead', () => {
    const scope = { activeGroupTeamIds: GROUP.teamIds, availableTeamIds: GROUP.teamIds };
    // all wins
    assert.deepEqual(sanitizeSelectedTeamsForScope(['t1', 'all'], scope), ['all']);
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t1', 'all'] }), GROUP).teams, ['all']);
    // a partial match keeps the rest, but only the resolver reports the dropped id
    const narrow = { id: 'g', teamIds: ['t1', 't2', 't3'] };
    assert.deepEqual(sanitizeSelectedTeamsForScope(['t1', 't4'], { activeGroupTeamIds: narrow.teamIds, availableTeamIds: narrow.teamIds }), ['t1']);
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t1', 't4'] }), narrow), { teams: ['t1'], reported: ['teams'] });
    // no match: the repo widens, the resolver must not apply that
    assert.deepEqual(sanitizeSelectedTeamsForScope(['zz'], scope), ['all']);
    assert.equal(resolveShareViewTeams(link({ teams: ['zz'] }), GROUP).teams, null);
    // duplicates pass through the repo function untouched, so the resolver de-duplicates first
    assert.deepEqual(sanitizeSelectedTeamsForScope(['t1', 't1', 't2'], scope), ['t1', 't1', 't2']);
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['t1', 't1', 't2'] }), GROUP), { teams: ['t1', 't2'], reported: [] });
});

test('teams: ids with comma, colon, percent, plus, quote and non-ASCII characters match by exact equality', () => {
    const odd = ['a,b', 'team::orbit', '100%', 'x+y', "o'neil", 'caf\u00e9'];
    const group = { id: 'g', teamIds: [...odd, 'plain'] };
    assert.deepEqual(resolveShareViewTeams(link({ teams: odd }), group), { teams: odd, reported: [] });
    assert.deepEqual(resolveShareViewTeams(link({ teams: ['A,B', 'team:orbit'] }), group), { teams: null, reported: ['teams'] });
});

test('teams apply to Catch Up, Planning and the task-loading Statistics views only', () => {
    const teams = ['t1', 't2'];
    for (const mode of ['catch-up', 'planning']) {
        assert.deepEqual(resolveShareViewTeams(link({ mode, teams }), GROUP).teams, teams, mode);
    }
    for (const stats of ['teams', 'priority', 'burnout', 'cohort', undefined]) {
        assert.deepEqual(resolveShareViewTeams(link({ mode: 'statistics', stats, teams }), GROUP).teams, teams, String(stats));
    }
    for (const stats of ['excludedCapacity', 'monoCrossShare', 'projectTrack']) {
        assert.deepEqual(resolveShareViewTeams(link({ mode: 'statistics', stats, teams }), GROUP), { teams: null, reported: [] }, stats);
    }
    assert.deepEqual(resolveShareViewTeams(link({ mode: 'board', teams }), GROUP), { teams: null, reported: [] });
    assert.deepEqual(resolveShareViewTeams(link({ mode: 'scenario', teams }), GROUP), { teams: null, reported: [] });
});

test('teams follow the resolved mode, not the requested one, after a fall-back to Catch Up', () => {
    const state = link({ mode: 'statistics', stats: 'projectTrack', teams: ['t1'] });
    assert.equal(resolveShareViewTeams(state, GROUP).teams, null);
    assert.deepEqual(resolveShareViewTeams(state, GROUP, 'catch-up').teams, ['t1']);
});

// --- Facets ----------------------------------------------------------------------------------

test('facets: an omitted key is the default constant, not matched against the options', () => {
    const { apply, reported } = resolveShareViewFacets(link(), OPTIONS);
    assert.deepEqual(apply, { status: SHARE_VIEW_DEFAULTS.status, priority: null, track: undefined });
    assert.equal(apply.status, SHARE_VIEW_DEFAULTS.status, 'Killed is absent from OPTIONS.status and must survive');
    assert.equal(Object.hasOwn(apply, 'track'), true, 'neutral track is an own property holding undefined');
    assert.deepEqual(reported, []);
});

test('facets: all is the neutral null', () => {
    const { apply, reported } = resolveShareViewFacets(link({ status: null, priority: null }), OPTIONS);
    assert.deepEqual(apply, { status: null, priority: null, track: undefined });
    assert.deepEqual(reported, []);
});

test('facets: atoms match case-insensitively and are stored as the option ids', () => {
    const { apply, reported } = resolveShareViewFacets(link({
        status: { only: ['in progress', ' TO DO '] },
        priority: { only: ['blocker', 'MAJOR'] },
        track: ['COMMITTED'],
    }), OPTIONS);
    assert.deepEqual(apply, { status: { only: ['In Progress', 'To Do'] }, priority: { only: ['Blocker', 'Major'] }, track: ['committed'] });
    assert.deepEqual(reported, []);
    assert.deepEqual(resolveShareViewFacets(link({ status: { hidden: ['done'] } }), OPTIONS).apply.status, { hidden: ['Done'] });
});

test('facets: atoms with commas, quotes and non-ASCII characters match their option ids', () => {
    const options = { ...OPTIONS, status: ['Ready, set', "Won't Do", 'Termin\u00e9', 'To Do'] };
    const { apply, reported } = resolveShareViewFacets(link({ status: { hidden: ['ready, set', "WON'T DO", 'TERMIN\u00c9'] } }), options);
    assert.deepEqual(apply.status, { hidden: ['Ready, set', "Won't Do", 'Termin\u00e9'] });
    assert.deepEqual(reported, []);
});

test('facets: spellings of one option collapse without a report', () => {
    const { apply, reported } = resolveShareViewFacets(link({ status: { only: ['in progress', 'In Progress'] } }), OPTIONS);
    assert.deepEqual(apply.status, { only: ['In Progress'] });
    assert.deepEqual(reported, []);
});

test('facets: unmatched atoms are dropped and reported; a key left empty is skipped', () => {
    const partial = resolveShareViewFacets(link({ status: { hidden: ['killed', 'done'] } }), OPTIONS);
    assert.deepEqual(partial.apply.status, { hidden: ['Done'] });
    assert.deepEqual(partial.reported, ['filters']);
    const none = resolveShareViewFacets(link({ status: { only: ['Nonexistent'] }, track: ['nope'] }), OPTIONS);
    assert.equal(Object.hasOwn(none.apply, 'status'), false);
    assert.equal(Object.hasOwn(none.apply, 'track'), false);
    assert.deepEqual(none.apply, { priority: null });
    assert.deepEqual(none.reported, ['filters']);
});

test('facets: priority is limited to the six canonical labels', () => {
    const high = resolveShareViewFacets(link({ priority: { only: ['High'] } }), OPTIONS);
    assert.equal(Object.hasOwn(high.apply, 'priority'), false);
    assert.deepEqual(high.reported, ['filters']);
    const polluted = { ...OPTIONS, priority: ['High', 'Blocker'] };
    assert.deepEqual(resolveShareViewFacets(link({ priority: { only: ['high', 'blocker'] } }), polluted).apply.priority, { only: ['Blocker'] });
    assert.deepEqual(resolveShareViewFacets(link({ priority: { hidden: ['Trivial'] } }), { ...OPTIONS, priority: ['Blocker'] }).reported, ['filters']);
});

test('facets: track none is the empty list and a list is matched against the track options', () => {
    assert.deepEqual(resolveShareViewFacets(link({ track: [] }), OPTIONS).apply.track, []);
    assert.deepEqual(resolveShareViewFacets(link({ track: ['flexible', 'committed'] }), OPTIONS).apply.track, ['flexible', 'committed']);
    assert.deepEqual(resolveShareViewFacets(link({ track: ['flexible', 'nope'] }), OPTIONS), { apply: { status: SHARE_VIEW_DEFAULTS.status, priority: null, track: ['flexible'] }, reported: ['filters'] });
});

test('facets: no option ids at all skips every listed key', () => {
    const { apply, reported } = resolveShareViewFacets(link({ status: { only: ['To Do'] } }), { status: [], priority: [], track: [] });
    assert.equal(Object.hasOwn(apply, 'status'), false);
    assert.deepEqual(reported, ['filters']);
});

test('facets apply to Catch Up and Planning, follow the resolved mode, and are empty for Board and Statistics', () => {
    assert.equal(Object.hasOwn(resolveShareViewFacets(link({ mode: 'planning' }), OPTIONS).apply, 'status'), true);
    for (const mode of ['board', 'statistics', 'scenario']) {
        assert.deepEqual(resolveShareViewFacets(link({ mode, status: null }), OPTIONS), { apply: {}, reported: [] }, mode);
    }
    assert.equal(Object.hasOwn(resolveShareViewFacets(link({ mode: 'statistics' }), OPTIONS, 'catch-up').apply, 'status'), true);
});

test('facets: the repo vectors, composed with the real facet model', () => {
    const story = (key, status, priority) => ({ key, fields: { status: { name: status }, priority: { name: priority }, projectKey: 'DEMO', epicKey: null } });
    const model = buildEngCatchUpFacetModel({
        tasks: [story('DEMO-1', 'To Do', 'Low'), story('DEMO-2', 'In Progress', 'Major'), story('DEMO-3', 'Done', 'Blocker')],
        isTechTask: () => false,
        epicDetails: {},
    });
    const options = Object.fromEntries(model.facets.map((facet) => [facet.id, facet.options.map((option) => option.id)]));
    const { apply } = resolveShareViewFacets(link({ status: { only: ['in progress'] }, priority: { only: ['blocker'] } }), options);
    assert.deepEqual(apply.status, { only: ['In Progress'] });
    assert.deepEqual(apply.priority, { only: ['Blocker'] });
    const view = resolveEngCatchUpFilters({ model, status: apply.status, priority: apply.priority });
    assert.equal(view.admitsStatus('In Progress'), true);
    assert.equal(view.admitsStatus('To Do'), false);
    assert.equal(view.admitsPriority('Blocker'), true);
    // The repo reads an unknown id as neutral while the stored value persists, which is why the
    // resolver rejects unmatched ids before any setter runs.
    const stale = resolveEngCatchUpFilters({ model, status: { only: ['Nonexistent'] } });
    assert.equal(stale.facetViews[0].isNeutral, true);
    assert.equal(Object.hasOwn(resolveShareViewFacets(link({ status: { only: ['Nonexistent'] } }), options).apply, 'status'), false);
});

// --- Field plan ------------------------------------------------------------------------------

test('Catch Up plan: find, lanes, initiatives, sort and alerts, each the default when omitted', () => {
    assert.deepEqual(planFor(), {
        apply: {
            find: SHARE_VIEW_DEFAULTS.find,
            lanes: SHARE_VIEW_DEFAULTS.lanes,
            initiatives: SHARE_VIEW_DEFAULTS.initiatives,
            sort: SHARE_VIEW_DEFAULTS.sort,
            alerts: { panel: true, expanded: ALL_ALERTS_OPEN },
        },
        reported: [],
    });
    assert.deepEqual(SHARE_VIEW_DEFAULTS.lanes, { product: true, tech: true });
    assert.equal(SHARE_VIEW_DEFAULTS.initiatives, null);
});

test('Catch Up plan carries the link values', () => {
    const { apply, reported } = planFor({ find: 'auth', lanes: { product: false, tech: true }, initiatives: false, sort: 'track-flexible', alerts: ['blocked', 'missing'] });
    assert.deepEqual(apply, {
        find: 'auth',
        lanes: { product: false, tech: true },
        initiatives: false,
        sort: 'track-flexible',
        alerts: { panel: true, expanded: { ...ALL_ALERTS_SHUT, missing: true, blocked: true } },
    });
    assert.deepEqual(reported, []);
    assert.equal(planFor({ initiatives: true }).apply.initiatives, true);
});

test('alerts: off hides the panel, none collapses all, and a category the sprint does not render is no error', () => {
    assert.deepEqual(planFor({ alerts: 'off' }).apply.alerts, { panel: false, expanded: ALL_ALERTS_OPEN });
    assert.deepEqual(planFor({ alerts: 'none' }).apply.alerts, { panel: true, expanded: ALL_ALERTS_SHUT });
    const closed = planFor({ alerts: ['backlog', 'missingTeam', '__proto__'], sprint: '4181' });
    assert.deepEqual(closed.apply.alerts, { panel: true, expanded: { ...ALL_ALERTS_SHUT, backlog: true, missingTeam: true } });
    assert.deepEqual(closed.reported, []);
    assert.deepEqual(Object.keys(planFor({ alerts: ['done'] }).apply.alerts.expanded), [...SHARE_VIEW_ALERT_KEYS]);
});

test('Planning plan: the table carries rows, the list carries initiatives and sort', () => {
    const table = planFor({ mode: 'planning', initiatives: true, sort: 'status' });
    assert.deepEqual(table, {
        apply: { find: '', lanes: SHARE_VIEW_DEFAULTS.lanes, layout: SHARE_VIEW_DEFAULTS.layout, rows: SHARE_VIEW_DEFAULTS.rows },
        reported: [],
    });
    assert.deepEqual(planFor({ mode: 'planning', layout: 'table', rows: 'story' }).apply.rows, 'story');
    const list = planFor({ mode: 'planning', layout: 'list', rows: 'story', initiatives: true, sort: 'status', find: 'x' });
    assert.deepEqual(list.apply, {
        find: 'x', lanes: SHARE_VIEW_DEFAULTS.lanes, layout: 'list', initiatives: true, sort: 'status',
    });
    assert.deepEqual(Object.keys(planFor({ mode: 'planning', layout: 'list' }).apply).sort(), ['find', 'initiatives', 'lanes', 'layout', 'sort']);
});

test('Board plan: find and scope; the default scope needs no readiness', () => {
    assert.deepEqual(planFor({ mode: 'board', find: 'x' }), { apply: { find: 'x', scope: SHARE_VIEW_DEFAULTS.scope, boardFilters: {}, boardColumn: null }, reported: [] });
    assert.equal(SHARE_VIEW_DEFAULTS.scope, '');
});

test('Board scope applies only when the Board is ready for the link group', () => {
    const calls = [];
    const ready = (value) => ({ ...CTX, boardScopeReady: (groupId, scope) => { calls.push([groupId, scope]); return value; } });
    assert.deepEqual(planFor({ mode: 'board', scope: 'all_work' }, ready(true)).apply, { find: '', scope: 'all_work', boardFilters: {}, boardColumn: null });
    assert.deepEqual(calls, [['dept/a', 'all_work']]);
    assert.deepEqual(planFor({ mode: 'board', scope: 'component' }, ready(true)).apply.scope, 'component');
    for (const [label, ctx] of [['not ready', ready(false)], ['truthy but not true', ready('yes')], ['no readiness callback', CTX]]) {
        const plan = planFor({ mode: 'board', scope: 'component' }, ctx);
        assert.equal(Object.hasOwn(plan.apply, 'scope'), false, label);
        assert.deepEqual(plan.reported, ['mode'], label);
    }
    assert.deepEqual(planFor({ mode: 'board', scope: '__proto__' }, ready(true)).reported, ['mode']);
});

test('Board plan carries its own facet selection and focused column, nothing else', () => {
    const plan = planFor({ mode: 'board', bpriority: ['Major'], bprojects: ['tech', 'product'], bassignee: ['unassigned'], btrack: [], bcolumn: 'col-2' });
    assert.deepEqual(plan.apply.boardFilters, { priority: ['Major'], projects: ['tech', 'product'], assignee: ['unassigned'], track: [] });
    assert.equal(plan.apply.boardColumn, 'col-2');
    assert.equal(Object.hasOwn(planFor({ mode: 'catch-up', bpriority: ['Major'] }).apply, 'boardFilters'), false);
});

test('Statistics plan: stats and range; keys outside the resolved mode are absent', () => {
    assert.deepEqual(planFor({ mode: 'statistics' }), { apply: { stats: SHARE_VIEW_DEFAULTS.stats, range: null }, reported: [] });
    const future = planFor({ mode: 'statistics', sprint: '4183', stats: 'cohort' });
    assert.deepEqual(future, { apply: { stats: 'cohort', range: { from: '2026Q4', to: '2026Q4' }, lead: 'created', n: 30 }, reported: [] });
    const planning = planFor({ mode: 'planning', sprint: '4181' });
    assert.deepEqual(Object.keys(planning.apply).sort(), ['alerts', 'find', 'initiatives', 'lanes', 'sort']);
});

test('Statistics cohort range: both bounds or neither, from <= to, inside the 16-quarter window', () => {
    const cohort = (extra) => planFor({ mode: 'statistics', stats: 'cohort', ...extra });
    assert.deepEqual(cohort({}), { apply: { stats: 'cohort', range: { from: '2026Q4', to: '2026Q4' }, lead: 'created', n: 30 }, reported: [] });
    assert.deepEqual(cohort({ from: '2025Q3', to: '2026Q2' }).apply.range, { from: '2025Q3', to: '2026Q2' });
    assert.deepEqual(cohort({ from: '2023Q1', to: '2026Q4' }).apply.range, { from: '2023Q1', to: '2026Q4' });
    assert.deepEqual(cohort({ from: '2026Q3', to: '2026Q3' }).apply.range, { from: '2026Q3', to: '2026Q3' });
    for (const extra of [{ from: '2022Q4', to: '2026Q4' }, { from: '2023Q1', to: '2027Q1' }, { from: '2026Q4', to: '2026Q3' }, { from: '2026Q1' }, { to: '2026Q1' }, { from: '2026q1', to: '2026Q2' }]) {
        const plan = cohort(extra);
        assert.deepEqual(plan.apply.range, { from: '2026Q4', to: '2026Q4' }, JSON.stringify(extra));
        assert.deepEqual(plan.reported, ['mode'], JSON.stringify(extra));
    }
});

test('Statistics cohort window follows the current quarter, defaulting to the clock', () => {
    // The window comes from ctx.currentQuarter: 2030Q1 is inside the window ending 2030Q2 and far outside today's.
    const state = link({ mode: 'statistics', stats: 'cohort', from: '2030Q1', to: '2030Q2' });
    const later = { ...CTX, currentQuarter: '2030Q2' };
    const resolved = buildShareViewFieldPlan(state, resolveShareViewScope(state, later), later);
    assert.deepEqual(resolved, { apply: { stats: 'cohort', range: { from: '2030Q1', to: '2030Q2' }, lead: 'created', n: 30 }, reported: [] });
    const unbounded = link({ mode: 'statistics', stats: 'cohort' });
    assert.deepEqual(buildShareViewFieldPlan(unbounded, resolveShareViewScope(unbounded, later), later).apply.range, { from: '2030Q2', to: '2030Q2' });
    const now = new Date();
    const current = `${now.getFullYear()}Q${Math.floor(now.getMonth() / 3) + 1}`;
    const clock = { visibleGroups: CTX.visibleGroups, sprints: CTX.sprints };
    const defaulted = link({ mode: 'statistics', stats: 'cohort' });
    assert.deepEqual(buildShareViewFieldPlan(defaulted, resolveShareViewScope(defaulted, clock), clock).apply.range, { from: current, to: current });
});

test('Statistics sprint range: catalog ids, chronological from <= to, default is the link sprint', () => {
    for (const stats of ['excludedCapacity', 'monoCrossShare', 'projectTrack']) {
        const sprintView = (extra) => planFor({ mode: 'statistics', stats, ...extra });
        assert.deepEqual(sprintView({}), { apply: { stats, range: { from: '4182', to: '4182' } }, reported: [] }, stats);
        assert.deepEqual(sprintView({ from: '4180', to: '4182' }).apply.range, { from: '4180', to: '4182' }, stats);
        assert.deepEqual(sprintView({ from: '4181', to: '4181' }).apply.range, { from: '4181', to: '4181' }, stats);
        for (const extra of [{ from: '4182', to: '4180' }, { from: '4180', to: '9999' }, { from: '9999', to: '4182' }, { from: '4180' }, { to: '4182' }]) {
            const plan = sprintView(extra);
            assert.deepEqual(plan.apply.range, { from: '4182', to: '4182' }, `${stats} ${JSON.stringify(extra)}`);
            assert.deepEqual(plan.reported, ['mode'], `${stats} ${JSON.stringify(extra)}`);
        }
    }
});

test('stats=projectTrack&from=4182&to=4182: the resolver checks the view and the catalog', () => {
    assert.deepEqual(planFor({ mode: 'statistics', stats: 'projectTrack', from: '4182', to: '4182' }), {
        apply: { stats: 'projectTrack', range: { from: '4182', to: '4182' } }, reported: [],
    });
    const asCohort = planFor({ mode: 'statistics', stats: 'cohort', from: '4182', to: '4182' });
    assert.deepEqual(asCohort.apply.range, { from: '2026Q4', to: '2026Q4' });
    assert.deepEqual(asCohort.reported, ['mode']);
    assert.deepEqual(planFor({ mode: 'statistics', stats: 'projectTrack', from: '2026Q3', to: '2026Q4' }).reported, ['mode']);
});

test('Statistics sprint range orders by start date, not by numeric id', () => {
    const ctx = {
        ...CTX,
        sprints: [
            { id: 20, name: 'Early', state: 'closed', startDate: '2026-01-05' },
            { id: 10, name: 'Late', state: 'active', startDate: '2026-02-02' },
        ],
    };
    const plan = (from, to) => planFor({ mode: 'statistics', stats: 'projectTrack', sprint: '10', from, to }, ctx);
    assert.deepEqual(plan('20', '10').apply.range, { from: '20', to: '10' });
    assert.deepEqual(plan('10', '20').reported, ['mode']);
});

test('Statistics views without a range ignore from and to silently', () => {
    for (const stats of ['teams', 'priority', 'burnout']) {
        assert.deepEqual(planFor({ mode: 'statistics', stats, from: '2026Q1', to: '2026Q2' }), { apply: { stats, range: null }, reported: [] }, stats);
    }
});

// --- Focus -----------------------------------------------------------------------------------

test('focus: none when the link carries no target', () => {
    for (const mode of ['catch-up', 'planning', 'board', 'statistics']) assert.equal(resolveShareViewFocus(link({ mode }), mode), null, mode);
    assert.deepEqual(planFor().reported, []);
});

test('focus: alertTeam needs Catch Up and an alerts value that is not off', () => {
    const alertTeam = { anchor: 'blocked', id: 't1' };
    assert.deepEqual(resolveShareViewFocus(link({ alertTeam }), 'catch-up'), { kind: 'alertTeam', anchor: 'blocked', id: 't1' });
    assert.deepEqual(resolveShareViewFocus(link({ alertTeam: { anchor: 'followupEpics', id: 'Unknown Team' }, alerts: 'none' }), 'catch-up'), { kind: 'alertTeam', anchor: 'followupEpics', id: 'Unknown Team' });
    assert.deepEqual(planFor({ alertTeam }).reported, []);
    assert.equal(resolveShareViewFocus(link({ alertTeam, alerts: 'off' }), 'catch-up'), null);
    assert.deepEqual(planFor({ alertTeam, alerts: 'off' }).reported, ['focus']);
    for (const mode of ['planning', 'board', 'statistics']) {
        assert.equal(resolveShareViewFocus(link({ mode, alertTeam }), mode), null, mode);
    }
});

test('focus: an alert anchor outside the closed vocabulary never resolves', () => {
    for (const anchor of ['__proto__', 'constructor', 'toString', 'nope', 'Blocked']) {
        assert.equal(resolveShareViewFocus(link({ alertTeam: { anchor, id: 't1' } }), 'catch-up'), null, anchor);
        assert.deepEqual(planFor({ alertTeam: { anchor, id: 't1' } }).reported, ['focus'], anchor);
    }
});

test('focus: a kind outside epic and story never resolves', () => {
    for (const kind of ['__proto__', 'constructor', 'Epic', 'subtask', undefined]) {
        assert.equal(resolveShareViewFocus(link({ focus: { kind, key: 'DEMO-12' } }), 'catch-up'), null, String(kind));
        assert.deepEqual(planFor({ focus: { kind, key: 'DEMO-12' } }).reported, ['focus'], String(kind));
    }
});

test('focus: an Epic or Story resolves in Catch Up and in the Planning list', () => {
    for (const [mode, layout] of [['catch-up', undefined], ['planning', 'list']]) {
        assert.deepEqual(resolveShareViewFocus(link({ mode, layout, focus: { kind: 'epic', key: 'DEMO-12' } }), mode), { kind: 'epic', key: 'DEMO-12' }, mode);
        assert.deepEqual(resolveShareViewFocus(link({ mode, layout, focus: { kind: 'story', key: 'DEMO-34' } }), mode), { kind: 'story', key: 'DEMO-34' }, mode);
    }
});

test('focus: the Planning table never switches rows, so the target must be in the link rows', () => {
    const epic = { kind: 'epic', key: 'DEMO-12' };
    const story = { kind: 'story', key: 'DEMO-34' };
    assert.deepEqual(resolveShareViewFocus(link({ mode: 'planning', focus: epic }), 'planning'), epic);
    assert.equal(resolveShareViewFocus(link({ mode: 'planning', focus: story }), 'planning'), null);
    assert.deepEqual(resolveShareViewFocus(link({ mode: 'planning', rows: 'story', focus: story }), 'planning'), story);
    assert.equal(resolveShareViewFocus(link({ mode: 'planning', rows: 'story', focus: epic }), 'planning'), null);
    assert.deepEqual(planFor({ mode: 'planning', focus: story }).reported, ['focus']);
    assert.deepEqual(planFor({ mode: 'planning', rows: 'story', focus: story }).reported, []);
});

test('focus: a Board link targets an Epic card only; Statistics has no target', () => {
    const board = link({ mode: 'board', focus: { kind: 'epic', key: 'DEMO-12' } });
    assert.deepEqual(resolveShareViewFocus(board, 'board'), { kind: 'epic', key: 'DEMO-12' });
    assert.deepEqual(planFor({ mode: 'board', focus: { kind: 'epic', key: 'DEMO-12' } }).reported, []);
    assert.equal(resolveShareViewFocus(link({ mode: 'board', focus: { kind: 'story', key: 'DEMO-12' } }), 'board'), null, 'the Board has no Story cards');
    for (const mode of ['statistics']) {
        const state = link({ mode, focus: { kind: 'epic', key: 'DEMO-12' } });
        assert.equal(resolveShareViewFocus(state, mode), null, mode);
        assert.deepEqual(planFor({ mode, focus: { kind: 'epic', key: 'DEMO-12' } }).reported, ['focus'], mode);
    }
});

test('focus: at most one target, alertTeam first, and the plan names focus for the one dropped', () => {
    const state = link({ alertTeam: { anchor: 'blocked', id: 't1' }, focus: { kind: 'story', key: 'DEMO-34' } });
    assert.deepEqual(resolveShareViewFocus(state, 'catch-up'), { kind: 'alertTeam', anchor: 'blocked', id: 't1' });
    assert.deepEqual(buildShareViewFieldPlan(state, resolveShareViewScope(state, CTX), CTX).reported, ['focus']);
    const offLink = link({ alerts: 'off', alertTeam: { anchor: 'blocked', id: 't1' }, focus: { kind: 'story', key: 'DEMO-34' } });
    assert.deepEqual(resolveShareViewFocus(offLink, 'catch-up'), { kind: 'story', key: 'DEMO-34' });
    assert.deepEqual(buildShareViewFieldPlan(offLink, resolveShareViewScope(offLink, CTX), CTX).reported, ['focus']);
});

test('focus follows the resolved mode: a Planning link on a closed sprint keeps its Epic as Catch Up', () => {
    const state = link({ mode: 'planning', sprint: '4181', rows: 'story', focus: { kind: 'epic', key: 'DEMO-12' } });
    const scope = resolveShareViewScope(state, CTX);
    assert.equal(scope.mode, 'catch-up');
    assert.deepEqual(resolveShareViewFocus(state, scope.mode), { kind: 'epic', key: 'DEMO-12' });
    assert.deepEqual(buildShareViewFieldPlan(state, scope, CTX).reported, []);
});

test('Statistics Lead Times modes: Closed validates its range like Created, Last N takes no range and defaults an invalid or missing N', () => {
    const cohort = (extra) => planFor({ mode: 'statistics', stats: 'cohort', ...extra });
    const closed = cohort({ lead: 'closed', from: '2025Q3', to: '2026Q2' });
    assert.deepEqual(closed, { apply: { stats: 'cohort', range: { from: '2025Q3', to: '2026Q2' }, lead: 'closed', n: 30 }, reported: [] });
    const closedBad = cohort({ lead: 'closed', from: '2022Q4', to: '2026Q4' });
    assert.deepEqual(closedBad.apply.range, { from: '2026Q4', to: '2026Q4' });
    assert.deepEqual(closedBad.reported, ['mode']);
    const lastN = cohort({ lead: 'last_n', n: 60 });
    assert.deepEqual(lastN, { apply: { stats: 'cohort', range: { from: '2026Q4', to: '2026Q4' }, lead: 'last_n', n: 60 }, reported: [] });
    assert.deepEqual(cohort({ lead: 'last_n', n: 60, from: 'nope', to: 'nope' }).reported, [], 'a Last N link ignores any quarters');
    const missingN = cohort({ lead: 'last_n' });
    assert.equal(missingN.apply.n, 30);
    assert.deepEqual(missingN.reported, ['mode']);
    assert.equal(Object.hasOwn(planFor({ mode: 'statistics', stats: 'teams', lead: 'closed' }).apply, 'lead'), false);
    assert.equal(cohort({ n: 50 }).apply.n, 30, 'n only counts with lead=last_n');
});
