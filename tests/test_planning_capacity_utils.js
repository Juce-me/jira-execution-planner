const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/planningCapacityUtils.js');
}

test('getCapacityStatus preserves empty and in-band capacity states', async () => {
    const { getCapacityStatus } = await loadUtils();

    assert.deepEqual(getCapacityStatus(10, 0), { label: '', text: '', status: '', title: '' });
    assert.deepEqual(getCapacityStatus(10, 10), {
        label: '0% over',
        text: '10.0 selected | 10.0 capacity | 0% over',
        status: '',
        title: ''
    });
});

test('getCapacityStatus preserves under and over threshold copy', async () => {
    const { getCapacityStatus } = await loadUtils();

    assert.deepEqual(getCapacityStatus(8, 10), {
        label: '20% under',
        text: '8.0 selected | 10.0 capacity | 20% under',
        status: 'under',
        title: 'Please add at least 1.0 SP to reach 90%.'
    });
    assert.deepEqual(getCapacityStatus(13, 10), {
        label: '30% over',
        text: '13.0 selected | 10.0 capacity | 30% over',
        status: 'over',
        title: 'Please remove at least 1.0 SP to reach 120%.'
    });
});

test('getTeamCapacityMeta preserves remaining and over-capacity metadata', async () => {
    const { getTeamCapacityMeta } = await loadUtils();

    assert.deepEqual(getTeamCapacityMeta(0, 0), { text: '', status: '', title: '' });
    assert.deepEqual(getTeamCapacityMeta(7, 10), { text: '3.0 SP left', status: '', title: '' });
    assert.deepEqual(getTeamCapacityMeta(11, 10), {
        text: '↑ 1.0 SP · 10%',
        status: '',
        title: 'Please remove some story points or add capacity.'
    });
    assert.deepEqual(getTeamCapacityMeta(12, 10), {
        text: '↑ 2.0 SP · 20%',
        status: 'over',
        title: 'Please remove some story points or add capacity.'
    });
});

test('buildCapacityTotalsSummary subtracts excluded capacity before multiplier', async () => {
    const { buildCapacityTotalsSummary } = await loadUtils();
    const displayedTeamOptions = [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }];
    const getTeamCapacity = (name) => name === 'Team A' ? 10 : 20;

    assert.deepEqual(
        buildCapacityTotalsSummary({
            capacityEnabled: true,
            displayedTeamOptions,
            getTeamCapacity,
            excludedCapacityByTeamId: { 'team-a': 2, 'team-b': 3 },
            capacityMultiplier: 0.7
        }),
        {
            totalCapacityBase: 30,
            excludedCapacityTotal: 5,
            estimatedCapacityRaw: 25,
            totalCapacityAdjusted: 21,
            estimatedCapacityAdjusted: 17.5,
            excludedCapacityAdjusted: 3.5
        }
    );
});

test('buildProjectCapacity uses tech-heavy split and product/tech visibility gates', async () => {
    const { buildProjectCapacity } = await loadUtils();
    const displayedTeamOptions = [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }];
    const selectedTeamProjectStats = {
        'team-a': { product: 8, tech: 2 },
        'team-b': { product: 2, tech: 8 }
    };
    const getTeamNetCapacity = (team) => team.id === 'team-a' ? 10 : 20;

    assert.deepEqual(
        buildProjectCapacity({
            showPlanning: true,
            capacityEnabled: true,
            displayedTeamOptions,
            selectedTeamProjectStats,
            getTeamNetCapacity,
            capacitySplit: { product: 0.7, tech: 0.3 },
            showProduct: true,
            showTech: true
        }),
        {
            PRODUCT: 11,
            TECH: 19
        }
    );

    assert.deepEqual(
        buildProjectCapacity({
            showPlanning: true,
            capacityEnabled: true,
            displayedTeamOptions,
            selectedTeamProjectStats,
            getTeamNetCapacity,
            capacitySplit: { product: 0.7, tech: 0.3 },
            showProduct: true,
            showTech: false
        }),
        {
            PRODUCT: 11,
            TECH: 0
        }
    );
});

test('buildTeamCapacityStats groups status buckets by team and product type', async () => {
    const { buildTeamCapacityStats, buildTeamCapacityEntries } = await loadUtils();
    const normalizeStatus = value => String(value || '').trim().toLowerCase();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const tasks = [
        { key: 'PROD-1', fields: { status: { name: 'To Do' }, customfield_10004: '3', teamId: 'team-a', teamName: 'Team A', projectKey: 'PROD' } },
        { key: 'TECH-1', fields: { status: { name: 'Accepted' }, customfield_10004: '5', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'TECH-2', fields: { status: { name: 'Postponed' }, customfield_10004: 'bad', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'PROD-2', fields: { status: { name: 'Pending' }, customfield_10004: '2', teamId: 'team-b', teamName: 'Team B', projectKey: 'PROD' } }
    ];

    const stats = buildTeamCapacityStats({
        showPlanning: true,
        capacityEnabled: true,
        capacityTasks: tasks,
        normalizeStatus,
        getTeamInfo,
        techProjectKeys: new Set(['TECH'])
    });

    assert.deepEqual(buildTeamCapacityEntries(stats), [
        {
            id: 'team-a',
            name: 'Team A',
            product: { todoPending: 3, accepted: 0, postponed: 0 },
            tech: { todoPending: 0, accepted: 5, postponed: 0 },
            total: { todoPending: 3, accepted: 5, postponed: 0 }
        },
        {
            id: 'team-b',
            name: 'Team B',
            product: { todoPending: 2, accepted: 0, postponed: 0 },
            tech: { todoPending: 0, accepted: 0, postponed: 0 },
            total: { todoPending: 2, accepted: 0, postponed: 0 }
        }
    ]);
});

test('buildDisplayedTeamOptions filters by selected teams with story points', async () => {
    const { buildDisplayedTeamOptions, buildTeamSpTotals } = await loadUtils();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const teamOptions = [
        { id: 'all', name: 'All Teams' },
        { id: 'team-a', name: 'Team A' },
        { id: 'team-b', name: 'Team B' }
    ];
    const teamSpTotals = buildTeamSpTotals([
        { key: 'PROD-1', fields: { customfield_10004: '3', teamId: 'team-a', teamName: 'Team A' } },
        { key: 'PROD-2', fields: { customfield_10004: '0', teamId: 'team-b', teamName: 'Team B' } }
    ], getTeamInfo);

    assert.deepEqual(teamSpTotals, { 'team-a': 3 });
    assert.deepEqual(
        buildDisplayedTeamOptions({
            teamOptions,
            isAllTeamsSelected: false,
            selectedTeamSet: new Set(['team-a', 'team-b']),
            teamSpTotals
        }),
        [{ id: 'team-a', name: 'Team A' }]
    );
});

test('buildExcludedCapacityByTeamId sums normalized excluded epics', async () => {
    const { buildExcludedCapacityByTeamId } = await loadUtils();
    const getTeamInfo = task => ({ id: task.fields.teamId, name: task.fields.teamName });
    const normalizeEpicKey = value => String(value || '').trim().toUpperCase();

    assert.deepEqual(
        buildExcludedCapacityByTeamId({
            capacityEnabled: true,
            showPlanning: true,
            capacityTasks: [
                { key: 'PROD-1', fields: { epicKey: 'ep-1', customfield_10004: '3', teamId: 'team-a', teamName: 'Team A' } },
                { key: 'PROD-2', fields: { epicKey: 'ep-1', customfield_10004: 'bad', teamId: 'team-a', teamName: 'Team A' } },
                { key: 'PROD-3', fields: { epicKey: 'ep-2', customfield_10004: '5', teamId: 'team-a', teamName: 'Team A' } }
            ],
            excludedEpicSet: new Set(['EP-1']),
            normalizeEpicKey,
            getTeamInfo
        }),
        { 'team-a': 3 }
    );
});

test('buildSelected entries and capacity totals preserve display ordering and zero states', async () => {
    const { buildCapacityTotals, buildSelectedProjectEntries, buildSelectedTeamEntries } = await loadUtils();

    assert.deepEqual(buildCapacityTotals({ showPlanning: false, capacityEnabled: true, displayedTeamCapacityEntries: [] }), {
        product: { todoPending: 0, accepted: 0, postponed: 0 },
        tech: { todoPending: 0, accepted: 0, postponed: 0 },
        total: { todoPending: 0, accepted: 0, postponed: 0 }
    });

    assert.deepEqual(
        buildCapacityTotals({
            showPlanning: true,
            capacityEnabled: true,
            displayedTeamCapacityEntries: [
                {
                    product: { todoPending: 1, accepted: 2, postponed: 3 },
                    tech: { todoPending: 4, accepted: 5, postponed: 6 },
                    total: { todoPending: 5, accepted: 7, postponed: 9 }
                }
            ]
        }),
        {
            product: { todoPending: 1, accepted: 2, postponed: 3 },
            tech: { todoPending: 4, accepted: 5, postponed: 6 },
            total: { todoPending: 5, accepted: 7, postponed: 9 }
        }
    );

    assert.deepEqual(
        buildSelectedProjectEntries({
            showPlanning: true,
            selectedProjectStats: { TECH: 5, PRODUCT: 3, OTHER: 1 },
            capacityEnabled: true,
            projectCapacity: { TECH: 10, PRODUCT: 8 }
        }).map(entry => entry.id),
        ['PRODUCT', 'TECH', 'OTHER']
    );

    assert.deepEqual(
        buildSelectedTeamEntries({
            showPlanning: true,
            displayedTeamOptions: [{ id: 'team-a', name: 'Team A' }],
            selectedTeamStats: { 'team-a': { storyPoints: 7 } },
            capacityEnabled: true,
            getTeamCapacity: () => 10,
            getTeamNetCapacity: () => 8,
            capacityMultiplier: 0.7
        }),
        [{
            id: 'team-a',
            name: 'Team A',
            storyPoints: 7,
            teamCapacity: 7,
            planningCapacity: 5.6
        }]
    );
});
