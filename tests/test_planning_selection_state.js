const test = require('node:test');
const assert = require('node:assert/strict');

async function harness() {
    const { createPlanningSelectionHandlers } = await import('../frontend/src/eng/planningSelectionActions.js');
    const { createPlanningInclusionDraft } = await import('../frontend/src/eng/planningInclusionDraft.js');
    const tasks = [
        { id: '1', key: 'SYN-1', fields: { status: { name: 'To Do' } } },
        { id: '2', key: 'SYN-2', fields: { status: { name: 'In Progress' } } },
        { id: '3', key: 'SYN-3', fields: { status: { name: 'To Do' } } },
    ];
    const draft = createPlanningInclusionDraft();
    const controller = {
        includeShown: ids => draft.apply(ids, true), removeShown: ids => draft.apply(ids, false),
        undoInclusion: () => draft.undo(),
        getSelectedTasks: () => Object.fromEntries(tasks.filter(task => draft.effectiveEntries.get(task.id)?.included).map(task => [task.key, true])),
    };
    const events = [];
    return { tasks, draft, controller, events, actions: shown => createPlanningSelectionHandlers({
        controller, selectionTasks: tasks, visibleTasksForList: shown,
        normalizeStatus: value => String(value).toLowerCase(), trackPlanningSelection: (...args) => events.push(args),
        storage: new Proxy({}, { get() { throw new Error('Legacy storage must remain untouched'); } }),
    }) };
}

test('scope labels stay stable without browser selection storage', async () => {
    const { buildPlanningScopeKey } = await import('../frontend/src/planningSelectionState.mjs');
    assert.equal(buildPlanningScopeKey({ sprintId: ' 17 ', groupId: ' group-a ' }), 'planning::17::group-a');
});

test('Select All is additive across Team filters and Clear Selection affects matching rows only', async () => {
    const h = await harness();
    h.actions([h.tasks[0]]).selectAllVisiblePlanningTasks();
    h.actions(h.tasks.slice(1)).selectAllVisiblePlanningTasks();
    assert.deepEqual(h.controller.getSelectedTasks(), { 'SYN-1': true, 'SYN-2': true, 'SYN-3': true });
    h.actions([h.tasks[0]]).clearSelectedTasks();
    assert.deepEqual(h.controller.getSelectedTasks(), { 'SYN-2': true, 'SYN-3': true });
    h.actions([h.tasks[0]]).undoPlanningSelectionChange();
    assert.equal(h.controller.getSelectedTasks()['SYN-1'], true);
});

test('bulk gestures include all matching rows, ignore placeholders, and no-ops create no history/event', async () => {
    const h = await harness(), actions = h.actions([...h.tasks, { key: 'placeholder' }]);
    actions.selectAllVisiblePlanningTasks();
    const sequence = h.draft.actionSequence, events = h.events.length;
    actions.selectAllVisiblePlanningTasks();
    assert.equal(h.draft.actionSequence, sequence);
    assert.equal(h.events.length, events);
    assert.equal(Object.keys(h.controller.getSelectedTasks()).length, 3);
    actions.undoPlanningSelectionChange();
    assert.deepEqual(h.controller.getSelectedTasks(), {});
});

test('status Include and Remove are explicit and preserve other matching states and hidden Teams', async () => {
    const h = await harness();
    h.actions([h.tasks[2]]).selectAllVisiblePlanningTasks();
    const actions = h.actions(h.tasks.slice(0, 2));
    actions.includePlanningTasksByStatus(['In Progress']);
    assert.deepEqual(h.controller.getSelectedTasks(), { 'SYN-2': true, 'SYN-3': true });
    actions.removePlanningTasksByStatus(['In Progress']);
    assert.deepEqual(h.controller.getSelectedTasks(), { 'SYN-3': true });
});

function automaticPlanningHarness() {
    const { mountBundledHook } = require('./react_hook_harness');
    const path = require('node:path');
    const state = { productTasks: [], techTasks: [], loadedProductTasks: [], loadedTechTasks: [], epicDetails: {},
        productEpicsInScope: [], techEpicsInScope: [], readyToCloseProductEpicsInScope: [], readyToCloseTechEpicsInScope: [],
        readyToCloseProductTasks: [], readyToCloseTechTasks: [], missingInfoEpics: [], missingPlanningInfoTasks: [] };
    const guards = { blocked: false, epoch: 1, version: 1, scopeKey: 'synthetic-group|1' };
    const selection = { selectedTasks: { 'DEMO-1': true }, selectedTeams: ['team-old'], planningSelectionMode: 'manual',
        engStatusFilter: {}, engPriorityFilter: {}, engProjectTrackFilter: {}, showTech: true, showProduct: true,
        activeGroupTeamIds: ['team-old', 'team-new'], isFutureSprintSelected: false };
    let current = true;
    const setters = Object.fromEntries(Object.keys(state).map(name => [`set${name[0].toUpperCase()}${name.slice(1)}`, value => { state[name] = typeof value === 'function' ? value(state[name]) : value; }]));
    const owner = mountBundledHook({ entry: path.resolve('frontend/src/eng/useEpicRefresh.js'), exportName: 'useEpicRefresh',
        modules: { 'react-dom': { flushSync: fn => fn() }, '../issues/IssueCard.jsx': { REMOVE_FADE_MS: 1 } },
        makeProps: () => ({ active: false, sourceSurface: 'planning', getState: () => state, getSelectionState: () => selection,
            readScopeGuards: () => guards, readGuards: () => guards, getProtectedKeys: () => new Set(), setters, priorityOrder: {} }) });
    owner.render();
    const job = { signal: new AbortController().signal, shouldApply: () => current };
    const apply = () => owner.result.applyScopeSnapshot(job, { guards: { ...guards }, lanes: {
        product: { status: 'ok', items: [{ key: 'DEMO-2', fields: { epicKey: 'EPIC-1', priority: { name: 'Medium' } } }] }, tech: { status: 'ok', items: [] } } });
    return { owner, state, guards, selection, apply, retire() { current = false; } };
}

test('automatic selection preservation validates exact accepted arrays, scope and selection identities', () => {
    for (const change of ['product', 'tech', 'scope', 'epoch', 'version', 'blocked', 'selectedTasks', 'selectedTeams', 'mode', 'filter', 'teams', 'retired']) {
        const h = automaticPlanningHarness();
        try {
            h.apply(); h.owner.render();
            assert.equal(h.owner.result.shouldPreserveAutomaticSelection(), true, `${change}: automatic commit accepted`);
            if (change === 'product') h.state.productTasks = [...h.state.productTasks];
            if (change === 'tech') h.state.techTasks = [...h.state.techTasks];
            if (change === 'scope') h.guards.scopeKey = 'other|2';
            if (change === 'epoch') h.guards.epoch++;
            if (change === 'version') h.guards.version++;
            if (change === 'blocked') h.guards.blocked = true;
            if (change === 'selectedTasks') h.selection.selectedTasks = { ...h.selection.selectedTasks };
            if (change === 'selectedTeams') h.selection.selectedTeams = [...h.selection.selectedTeams];
            if (change === 'mode') h.selection.planningSelectionMode = 'default_all';
            if (change === 'filter') h.selection.engStatusFilter = {};
            if (change === 'teams') h.selection.activeGroupTeamIds = [...h.selection.activeGroupTeamIds];
            if (change === 'retired') h.retire();
            h.owner.render();
            assert.equal(h.owner.result.shouldPreserveAutomaticSelection(), false, `${change}: normal reconciliation restored`);
        } finally { h.owner.unmount(); }
    }
});

test('automatic anchor acceptance marks its accepted arrays before selection reconciliation', async () => {
    const h = automaticPlanningHarness();
    try {
        h.owner.render({ loadEpicRefresh: async () => ({ product: { status: 'ok', items: [{ key: 'DEMO-3', fields: { epicKey: 'EPIC-1', priority: { name: 'Medium' } } }] }, tech: { status: 'ignored' } }) });
        await h.owner.result.refreshEpic('EPIC-1', { source: 'automatic', signal: new AbortController().signal, shouldApply: () => true });
        h.owner.render();
        assert.deepEqual(h.state.productTasks.map(task => task.key), ['DEMO-3']);
        assert.equal(h.owner.result.shouldPreserveAutomaticSelection(), true);
        h.state.productTasks = [...h.state.productTasks]; h.owner.render();
        assert.equal(h.owner.result.shouldPreserveAutomaticSelection(), false, 'later manual source replacement is authoritative');
    } finally { h.owner.unmount(); }
});

test('parent gestures share the matching child scope and emit nothing for empty or unchanged inclusion', async () => {
    const h = await harness(), actions = h.actions([h.tasks[0]]);
    actions.selectPlanningReviewStories([], true);
    assert.equal(h.events.length, 0);
    actions.selectPlanningReviewStories(h.tasks, true);
    assert.deepEqual(h.controller.getSelectedTasks(), { 'SYN-1': true });
    assert.equal(h.events.length, 1);
    const sequence = h.draft.actionSequence;
    actions.selectPlanningReviewStories(h.tasks, true);
    assert.equal(h.events.length, 1);
    assert.equal(h.draft.actionSequence, sequence);
    assert.equal(h.events[0][0], 'select_epic_visible');
    assert.deepEqual(h.events[0][2], h.tasks);
});
