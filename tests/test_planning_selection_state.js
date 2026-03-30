const test = require('node:test');
const assert = require('node:assert/strict');

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
            selectedTeamId: 'all'
        }
    );
});
