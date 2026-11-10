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
        allocationReadiness: 'catalog_pending',
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


test('DELIVERY Allocation scope uses only the Department mapping and rejects Legacy Component scope', async () => {
    const { resolveEngSprintSelectorState } = await loadModule();
    const state = resolveEngSprintSelectorState({ ...readyInput, workModel: 'rnd_2027',
        group: { ...readyGroup, teamIds: [], allocationTypes: [{ value: 'Platform', type: 'tech' }] } });
    assert.equal(state.componentReadiness, 'scope_model_mismatch');
    assert.equal(state.allocationReadiness, 'ready');
    assert.equal(state.allWorkReadiness, 'ready');
    const empty = resolveEngSprintSelectorState({ ...readyInput, workModel: 'rnd_2027', group: { ...readyGroup, teamIds: [] } });
    assert.equal(empty.allocationReadiness, 'allocations_required');
    assert.equal(empty.allWorkReadiness, 'membership_required');
    const teamsOnly = resolveEngSprintSelectorState({ ...readyInput, workModel: 'rnd_2027' });
    assert.equal(teamsOnly.allocationReadiness, 'allocations_required');
    assert.equal(teamsOnly.allWorkReadiness, 'ready');
    assert.equal(resolveEngSprintSelectorState(readyInput).allocationReadiness, 'scope_model_mismatch');
});

test('wrong-era scopes stay mismatched despite settled Board setup errors and wait for metadata loading', async () => {
    const { resolveEngSprintSelectorState } = await loadModule();
    for (const [workModel, property] of [['rnd_2027', 'componentReadiness'], ['legacy', 'allocationReadiness']]) {
        for (const setup of [
            { group: { ...readyGroup, board: { columns: [] } } },
            { savedProjects: [], savedBoardId: '' },
            { group: null },
            { capability: false },
        ]) {
            const input = { ...readyInput, workModel, ...setup };
            assert.equal(resolveEngSprintSelectorState(input)[property], 'scope_model_mismatch');
            for (const [pending, expected] of [
                [{ catalogReady: false }, 'catalog_pending'],
                [{ bootstrapStatus: 'loading' }, 'loading'],
                [{ groupsLoading: true }, 'loading'],
            ]) {
                assert.equal(resolveEngSprintSelectorState({ ...input, ...pending })[property], expected);
            }
        }
    }
});
