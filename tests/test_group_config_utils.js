const test = require('node:test');
const assert = require('node:assert/strict');

test('buildGroupsConfigWithExcludedCapacityToggle adds an epic to the active group only', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = buildGroupsConfigWithExcludedCapacityToggle({
        version: 1,
        configRevision: 7,
        groups: [
            { id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: ['BAU-1'] },
            { id: 'beta', name: 'Beta', teamIds: ['team-b'], excludedCapacityEpics: ['BAU-2'] }
        ],
        defaultGroupId: 'alpha'
    }, 'alpha', ' bau-3 ');

    assert.equal(result.changed, true);
    assert.equal(result.nextExcluded, true);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['BAU-1', 'BAU-3']);
    assert.deepEqual(result.config.groups[1].excludedCapacityEpics, ['BAU-2']);
    assert.equal(result.config.configRevision, 7);
});

test('buildGroupsConfigWithExcludedCapacityToggle removes an existing epic from the active group', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = buildGroupsConfigWithExcludedCapacityToggle({
        version: 1,
        groups: [
            { id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: ['BAU-1', 'BAU-3'] }
        ],
        defaultGroupId: 'alpha'
    }, 'alpha', 'BAU-3');

    assert.equal(result.changed, true);
    assert.equal(result.nextExcluded, false);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['BAU-1']);
});

test('buildGroupsConfigWithExcludedCapacityToggle reports unchanged for missing group or key', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const config = {
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: [] }],
        defaultGroupId: 'alpha'
    };

    assert.deepEqual(
        buildGroupsConfigWithExcludedCapacityToggle(config, 'missing', 'BAU-1'),
        { config, changed: false, nextExcluded: false }
    );
    assert.deepEqual(
        buildGroupsConfigWithExcludedCapacityToggle(config, 'alpha', ''),
        { config, changed: false, nextExcluded: false }
    );
});
