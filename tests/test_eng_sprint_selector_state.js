const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engSprintSelectorState.js');
}

const readyGroup = {
    board: { columns: [{ id: 'todo', name: 'To do' }] },
    missingInfoComponents: ['Platform'],
    teamIds: ['team-1'],
};

const readyInput = {
    boardMode: true,
    catalogReady: true,
    bootstrapStatus: 'ready',
    capability: true,
    groupsLoading: false,
    groupsFailed: false,
    group: readyGroup,
    savedProjects: ['PROJECT'],
    savedBoardId: '',
};

test('ENG Sprint selector keeps Board choices selectable while readiness reports each configuration state', async () => {
    const { resolveEngSprintSelectorState } = await loadModule();
    const cases = [
        ['pending bootstrap', { bootstrapStatus: 'loading' }, 'loading', 'loading'],
        ['failed bootstrap', { bootstrapStatus: 'error' }, 'error', 'error'],
        ['unsupported capability', { capability: false }, 'unsupported', 'unsupported'],
        ['pending capability', { capability: null }, 'error', 'error'],
        ['malformed capability', { capability: 'true' }, 'error', 'error'],
        ['missing columns', { group: { ...readyGroup, board: { columns: [] } } }, 'columns_required', 'columns_required'],
        ['missing saved authority', { savedProjects: [], savedBoardId: '' }, 'projects_required', 'projects_required'],
        ['Component-only department', { group: { ...readyGroup, teamIds: [] } }, 'ready', 'ready'],
        ['Team-only department', { group: { ...readyGroup, missingInfoComponents: [] } }, 'components_required', 'ready'],
        ['department without Components or Teams', { group: { ...readyGroup, missingInfoComponents: [], teamIds: [] } }, 'components_required', 'membership_required'],
        ['missing department', { group: null }, 'department_required', 'department_required'],
        ['group read pending', { groupsLoading: true }, 'loading', 'loading'],
        ['group read failed', { groupsFailed: true }, 'error', 'error'],
        ['valid saved projects', {}, 'ready', 'ready'],
        ['saved Board fallback', { savedProjects: [], savedBoardId: '42' }, 'ready', 'ready'],
        ['Board mode inactive', { boardMode: false }, 'ready', 'ready', false],
    ];

    for (const [name, override, componentReadiness, allWorkReadiness, boardSelectable = true] of cases) {
        const state = resolveEngSprintSelectorState({ ...readyInput, ...override });
        assert.equal(state.ordinarySelectable, true, `${name}: ordinary Sprint stays selectable`);
        assert.equal(state.boardSelectable, boardSelectable, `${name}: Board scope selectability`);
        assert.equal(state.componentReadiness, componentReadiness, `${name}: Component readiness`);
        assert.equal(state.allWorkReadiness, allWorkReadiness, `${name}: All work readiness`);
    }
});

test('ENG Sprint selector requires a usable catalog for every selection type', async () => {
    const { resolveEngSprintSelectorState } = await loadModule();
    const state = resolveEngSprintSelectorState({ ...readyInput, catalogReady: false });

    assert.deepEqual(state, {
        ordinarySelectable: false,
        boardSelectable: false,
        componentReadiness: 'catalog_pending',
        allWorkReadiness: 'catalog_pending',
    });
});

test('ordinary Sprint eligibility is independent of Board mode and Board readiness', async () => {
    const { resolveEngSprintSelectorState } = await loadModule();
    const boardStates = [
        { boardMode: false },
        { bootstrapStatus: 'loading' },
        { bootstrapStatus: 'error' },
        { capability: false },
        { capability: null },
        { groupsLoading: true },
        { groupsFailed: true },
        { group: null },
        { group: { ...readyGroup, board: { columns: [] } } },
        { savedProjects: [], savedBoardId: '' },
    ];

    for (const override of boardStates) {
        assert.equal(
            resolveEngSprintSelectorState({ ...readyInput, ...override }).ordinarySelectable,
            true,
            JSON.stringify(override),
        );
    }
});
