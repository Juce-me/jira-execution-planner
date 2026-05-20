const test = require('node:test');
const assert = require('node:assert/strict');

test('priority weight helpers normalize rows and fall back to defaults', async () => {
    const {
        DEFAULT_PRIORITY_WEIGHT_ROWS,
        clonePriorityWeightRows,
        buildPriorityWeightMap,
    } = await import('../frontend/src/stats/priorityWeights.js');

    assert.equal(DEFAULT_PRIORITY_WEIGHT_ROWS.length, 6);
    assert.deepEqual(clonePriorityWeightRows([{ priority: ' Major ', weight: 0.25 }]), [
        { priority: 'Major', weight: '0.25' },
    ]);
    assert.deepEqual(buildPriorityWeightMap([{ priority: 'Major', weight: '0.25' }]), {
        major: 0.25,
    });
    assert.equal(buildPriorityWeightMap([]).blocker, 0.4);
});
