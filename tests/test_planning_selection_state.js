const test = require('node:test');
const assert = require('node:assert/strict');

async function loadPlanningSelectionActions() {
    return import('../frontend/src/eng/planningSelectionActions.js');
}

test('recovered selection overrides shared storage only for its exact loaded scope', async () => {
    const { resolvePlanningAuthResume } = await loadPlanningSelectionActions();
    const result = resolvePlanningAuthResume({
        resume: {
            scopeKey: 'planning::sprint-1::group-a',
            selectedTaskKeys: ['PLAN-1', 'REMOVED-9'],
            selectedTeams: ['team-a', 'team-removed'],
            selectionMode: 'manual',
        },
        planningScopeKey: 'planning::sprint-1::group-a',
        validTaskKeys: new Set(['PLAN-1', 'PLAN-2']),
        validTeamIds: new Set(['team-a', 'team-b']),
    });
    assert.deepEqual(result, {
        selectedTaskKeys: ['PLAN-1'],
        selectedTeams: ['team-a'],
        selectionMode: 'manual',
    });
});

test('recovered selection ignores mismatched scope and sorts exact-scope keys deterministically', async () => {
    const { resolvePlanningAuthResume } = await loadPlanningSelectionActions();
    const resume = {
        scopeKey: 'planning::sprint-1::group-a',
        selectedTaskKeys: ['PLAN-2', 'PLAN-1', 'PLAN-2'],
        selectedTeams: ['team-b', 'team-a', 'team-b'],
        selectionMode: 'default_all',
    };
    const validTaskKeys = new Set(['PLAN-3', 'PLAN-1', 'PLAN-2']);
    const validTeamIds = new Set(['team-a', 'team-b']);

    assert.equal(resolvePlanningAuthResume({
        resume,
        planningScopeKey: 'planning::sprint-2::group-a',
        validTaskKeys,
        validTeamIds,
    }), null);
    assert.deepEqual(resolvePlanningAuthResume({
        resume,
        planningScopeKey: resume.scopeKey,
        validTaskKeys,
        validTeamIds,
    }), {
        selectedTaskKeys: ['PLAN-1', 'PLAN-2', 'PLAN-3'],
        selectedTeams: ['team-a', 'team-b'],
        selectionMode: 'default_all',
    });
});

test('planning persistence preserves the saved-object contract and reports failures to recovery callers', async () => {
    const { persistPlanningSelectionState } = await loadPlanningSelectionActions();
    const { savePlanningState } = await import('../frontend/src/planningSelectionState.mjs');
    const workingStorage = {
        value: null,
        getItem() { return this.value; },
        setItem(key, value) { this.value = String(value); },
    };
    const throwingStorage = {
        getItem() { return null; },
        setItem() { throw new Error('quota'); },
    };

    assert.deepEqual(savePlanningState(workingStorage, 'planning::sprint-1::group-a', {
        selectedTaskKeys: ['PLAN-1'],
        selectedTeams: ['team-a'],
    }), {
        selectedTaskKeys: ['PLAN-1'],
        selectedTeams: ['team-a'],
        selectedTeamId: 'team-a',
        selectionMode: 'manual',
    });
    assert.equal(persistPlanningSelectionState({
        storage: workingStorage,
        scopeKey: 'planning::sprint-1::group-a',
        selectedTasks: { 'PLAN-1': true },
        selectedTeams: ['team-a'],
        selectionMode: 'manual',
        normalizeSelectedTeams: value => value,
    }), true);
    assert.equal(savePlanningState(null, 'planning::sprint-1::group-a', {}), false);
    assert.equal(savePlanningState(throwingStorage, 'planning::sprint-1::group-a', {}), false);
    assert.equal(persistPlanningSelectionState({
        storage: throwingStorage,
        scopeKey: 'planning::sprint-1::group-a',
        selectedTasks: { 'PLAN-1': true },
        selectedTeams: ['team-a'],
        selectionMode: 'manual',
        normalizeSelectedTeams: value => value,
    }), false);
});

test('buildPlanningScopeKey composes sprint and group into a stable scope key', async () => {
    const {
        buildPlanningScopeKey
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.equal(
        buildPlanningScopeKey({ sprintId: '2026Q2', groupId: 'group-alpha' }),
        'planning::2026Q2::group-alpha'
    );
});

test('reconcilePlanningSelection drops invalid stories and resets invalid team selection', async () => {
    const {
        reconcilePlanningSelection
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        reconcilePlanningSelection({
            selectedTaskKeys: ['A-1', 'A-2'],
            selectedTeamId: 'team-a'
        }, {
            validTaskKeys: new Set(['A-2', 'A-3']),
            validTeamIds: new Set(['team-b'])
        }),
        {
            selectedTaskKeys: ['A-2'],
            selectedTeams: ['all'],
            selectedTeamId: 'all',
            selectionMode: 'manual'
        }
    );
});

test('hydratePlanningState preserves the team-array contract after reconciliation', async () => {
    const {
        hydratePlanningState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        hydratePlanningState({
            storedState: {
                selectedTaskKeys: ['A-1', 'A-2'],
                selectedTeams: ['team-a']
            },
            sprintId: '2026Q2',
            groupId: 'group-alpha',
            validTaskKeys: new Set(['A-2']),
            validTeamIds: new Set(['team-a', 'team-b'])
        }),
        {
            selectedTaskKeys: ['A-2'],
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a',
            selectionMode: 'manual'
        }
    );
});

test('planning state round-trips through scoped browser storage', async () => {
    const {
        buildPlanningScopeKey,
        hasPlanningState,
        loadPlanningState,
        savePlanningState
    } = await import('../frontend/src/planningSelectionState.mjs');

    const storage = {
        data: {},
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
        },
        setItem(key, value) {
            this.data[key] = String(value);
        }
    };
    const scopeKey = buildPlanningScopeKey({ sprintId: '2026Q2', groupId: 'group-alpha' });

    savePlanningState(storage, scopeKey, {
        selectedTaskKeys: ['A-1', 'A-2'],
        selectedTeams: ['team-a']
    });

    assert.deepEqual(
        loadPlanningState(storage, scopeKey),
        {
            selectedTaskKeys: ['A-1', 'A-2'],
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a',
            selectionMode: 'manual'
        }
    );

    savePlanningState(storage, scopeKey, {
        selectedTaskKeys: [],
        selectedTeams: ['all']
    });

    assert.equal(hasPlanningState(storage, scopeKey), true);
    assert.deepEqual(
        loadPlanningState(storage, scopeKey),
        {
            selectedTaskKeys: [],
            selectedTeams: ['all'],
            selectedTeamId: 'all',
            selectionMode: 'manual'
        }
    );
});

test('resolvePlanningTeamSelection prefers live selection when no scoped state exists', async () => {
    const {
        resolvePlanningTeamSelection
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningTeamSelection({
            scopedState: null,
            liveSelectedTeams: ['team-live'],
            savedPrefsSelectedTeams: ['team-saved']
        }),
        ['team-live']
    );
});

test('future planning scopes without stored state default to all valid tasks', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: false,
            storedState: null,
            isFutureSprint: true,
            validTaskKeys: new Set(['PLAN-2', 'PLAN-1']),
            validTeamIds: new Set(['team-a'])
        }),
        {
            selectedTaskKeys: ['PLAN-1', 'PLAN-2'],
            selectedTeams: ['all'],
            selectedTeamId: 'all',
            selectionMode: 'default_all'
        }
    );
});

test('future planning manual mode preserves clicked task state', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: true,
            storedState: {
                selectedTaskKeys: ['PLAN-2'],
                selectedTeams: ['team-a'],
                selectionMode: 'manual'
            },
            isFutureSprint: true,
            validTaskKeys: new Set(['PLAN-1', 'PLAN-2', 'PLAN-3']),
            validTeamIds: new Set(['team-a'])
        }),
        {
            selectedTaskKeys: ['PLAN-2'],
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a',
            selectionMode: 'manual'
        }
    );
});

test('future planning default all mode reselects new valid tasks', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: true,
            storedState: {
                selectedTaskKeys: ['PLAN-1'],
                selectedTeams: ['all'],
                selectionMode: 'default_all'
            },
            isFutureSprint: true,
            validTaskKeys: new Set(['PLAN-1', 'PLAN-2']),
            validTeamIds: new Set(['team-a'])
        }).selectedTaskKeys,
        ['PLAN-1', 'PLAN-2']
    );
});

test('active planning scopes without stored state keep the current empty selection default', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: false,
            storedState: null,
            isFutureSprint: false,
            validTaskKeys: new Set(['PLAN-1']),
            validTeamIds: new Set(['team-a'])
        }).selectedTaskKeys,
        []
    );
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

test('automatic Planning commit leaves selections and persisted state intact, later user selection resumes normal persistence', () => {
    const { mountBundledHook } = require('./react_hook_harness');
    const path = require('node:path'), h = automaticPlanningHarness();
    const refs = Object.fromEntries(['pendingPlanningAuthResumeRef', 'pendingShellAuthResumeRef', 'planningAuthResumeLoadRef',
        'teamSelectionHydratedSelectionRef', 'planningAuthResumePersistenceFailedRef', 'planningLoadedSelectionRef'].map(name => [name, { current: null }]));
    let writes = 0, setters = 0, persisted;
    const priorWindow = global.window;
    global.window = { localStorage: { setItem(_key, value) { writes++; persisted = JSON.parse(value); }, getItem: () => null } };
    const sync = mountBundledHook({ entry: path.resolve('frontend/src/eng/usePlanningSelectionSync.js'), exportName: 'usePlanningSelectionSync', makeProps: () => ({
        ...refs, lastLoadedSprintRef: { current: '1' }, planningBaselineScopeRef: { current: 'planning::1::synthetic-group' },
        clearAuthResumeWhenSettled() {}, normalizeSelectedTeams: value => value,
        shouldPreserveAutomaticSelection: () => h.owner.result.shouldPreserveAutomaticSelection(),
        planningScopeKey: 'planning::1::synthetic-group', activeGroupId: 'synthetic-group', selectedSprint: '1', teamSelectionScopeKey: 'scope',
        tasksFetched: true, productTasksLoading: false, techTasksLoading: false, selectionTasks: h.state.productTasks,
        teamOptions: [{ id: 'team-new' }], ...h.selection,
        setSelectedTasks: next => { setters++; h.selection.selectedTasks = typeof next === 'function' ? next(h.selection.selectedTasks) : next; },
        setSelectedTeams: next => { setters++; h.selection.selectedTeams = typeof next === 'function' ? next(h.selection.selectedTeams) : next; },
        setPlanningSelectionMode: next => { setters++; h.selection.planningSelectionMode = typeof next === 'function' ? next(h.selection.planningSelectionMode) : next; },
        setCanUndoPlanningSelection() {},
    }) });
    try {
        h.apply(); h.owner.render(); sync.render();
        assert.equal(writes, 0); assert.equal(setters, 0); assert.deepEqual(h.selection.selectedTasks, { 'DEMO-1': true }); assert.deepEqual(h.selection.selectedTeams, ['team-old']);
        h.selection.selectedTasks = { 'DEMO-2': true }; h.owner.render(); sync.render();
        assert.equal(writes, 1); assert.equal(setters, 3); assert.deepEqual(persisted['planning::1::synthetic-group'].selectedTaskKeys, ['DEMO-2']);
        h.apply(); h.owner.render();
        refs.pendingPlanningAuthResumeRef.current = { scopeKey: 'planning::1::synthetic-group', selectedTaskKeys: ['DEMO-2'], selectedTeams: ['team-new'], selectionMode: 'manual' };
        refs.planningAuthResumeLoadRef.current = { scopeKey: 'planning::1::synthetic-group', outcome: 'applied' };
        sync.render({ planningAuthResumeLoadRevision: 1 });
        assert.equal(writes, 2, 'auth recovery retains its authoritative persistence path');
        assert.equal(refs.pendingPlanningAuthResumeRef.current, null); assert.deepEqual(h.selection.selectedTeams, ['team-new']);
    } finally { sync.unmount(); h.owner.unmount(); global.window = priorWindow; }
});
