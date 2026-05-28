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
