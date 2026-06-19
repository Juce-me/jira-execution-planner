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
            { id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: ['EX-1'], adHocCapacityEpics: ['ADHOC-1'] },
            { id: 'beta', name: 'Beta', teamIds: ['team-b'], excludedCapacityEpics: ['EX-2'], adHocCapacityEpics: ['ADHOC-2'] }
        ],
        defaultGroupId: 'alpha'
    }, 'alpha', ' ex-3 ');

    assert.equal(result.changed, true);
    assert.equal(result.nextExcluded, true);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['EX-1', 'EX-3']);
    assert.deepEqual(result.config.groups[0].adHocCapacityEpics, ['ADHOC-1']);
    assert.deepEqual(result.config.groups[1].excludedCapacityEpics, ['EX-2']);
    assert.deepEqual(result.config.groups[1].adHocCapacityEpics, ['ADHOC-2']);
    assert.equal(result.config.configRevision, 7);
});

test('buildGroupsConfigWithExcludedCapacityToggle removes an existing epic from the active group', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = buildGroupsConfigWithExcludedCapacityToggle({
        version: 1,
        groups: [
            { id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: ['EX-1', 'EX-3'], adHocCapacityEpics: ['ADHOC-1'] }
        ],
        defaultGroupId: 'alpha'
    }, 'alpha', 'EX-3');

    assert.equal(result.changed, true);
    assert.equal(result.nextExcluded, false);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['EX-1']);
    assert.deepEqual(result.config.groups[0].adHocCapacityEpics, ['ADHOC-1']);
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
        buildGroupsConfigWithExcludedCapacityToggle(config, 'missing', 'EX-1'),
        { config, changed: false, nextExcluded: false }
    );
    assert.deepEqual(
        buildGroupsConfigWithExcludedCapacityToggle(config, 'alpha', ''),
        { config, changed: false, nextExcluded: false }
    );
});

test('normalizeGroupsConfig preserves normalized Ad Hoc capacity epics', async () => {
    const {
        normalizeGroupsConfig
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const normalized = normalizeGroupsConfig({
        version: 1,
        groups: [{
            id: 'alpha',
            name: 'Alpha',
            teamIds: ['team-a'],
            excludedCapacityEpics: [' ex-1 '],
            adHocCapacityEpics: [' adhoc-1 ', 'ADHOC-1', '', null, 'adhoc-2'],
        }],
        defaultGroupId: 'alpha'
    });

    assert.deepEqual(normalized.groups[0].excludedCapacityEpics, ['EX-1']);
    assert.deepEqual(normalized.groups[0].adHocCapacityEpics, ['ADHOC-1', 'ADHOC-2']);
});

test('buildGroupsConfigWithExcludedCapacityToggle blocks Ad Hoc overlap without mutation', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const config = {
        version: 1,
        groups: [{
            id: 'alpha',
            name: 'Alpha',
            teamIds: ['team-a'],
            excludedCapacityEpics: ['EX-1'],
            adHocCapacityEpics: ['ADHOC-1'],
        }],
        defaultGroupId: 'alpha'
    };

    const result = buildGroupsConfigWithExcludedCapacityToggle(config, 'alpha', 'adhoc-1');

    assert.equal(result.changed, false);
    assert.equal(result.nextExcluded, false);
    assert.match(result.error, /configured as Ad Hoc capacity/);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['EX-1']);
    assert.deepEqual(result.config.groups[0].adHocCapacityEpics, ['ADHOC-1']);
});
