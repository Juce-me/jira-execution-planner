const test = require('node:test');
const assert = require('node:assert/strict');

test('epics in scope can match active group by configured team label', async () => {
    const { filterEpicsInScopeForTeamSet } = await import('../frontend/src/eng/engTaskUtils.js');

    const activeGroupTeamIds = ['team-alpha', 'team-beta'];
    const activeGroupTeamSet = new Set(activeGroupTeamIds);
    const activeGroupTeamLabels = {
        'team-alpha': 'team_alpha_label',
        'team-beta': 'team_beta_label'
    };
    const epics = [
        {
            key: 'PRODUCT-1',
            teamId: 'product-team',
            teamName: 'Product Team',
            labels: ['2026Q3', 'team_alpha_label']
        },
        {
            key: 'PRODUCT-2',
            teamId: 'product-team',
            teamName: 'Product Team',
            labels: ['2026Q3', 'other_label']
        }
    ];

    assert.deepEqual(
        filterEpicsInScopeForTeamSet(epics, activeGroupTeamIds, activeGroupTeamSet, activeGroupTeamLabels)
            .map(epic => epic.key),
        ['PRODUCT-1']
    );
});
