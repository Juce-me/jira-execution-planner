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

test('planning persistence reports success and fails soft for absent or throwing storage', async () => {
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

    assert.equal(savePlanningState(workingStorage, 'planning::sprint-1::group-a', {
        selectedTaskKeys: ['PLAN-1'],
        selectedTeams: ['team-a'],
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
