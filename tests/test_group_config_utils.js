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

test('normalizeGroupsConfig preserves the board field instead of silently dropping it', async () => {
    const {
        normalizeGroupsConfig
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const board = {
        columns: [
            { id: 'col-00000001', name: 'To do', statuses: ['To Do'], colour: '#8c8c8c', star: false, min: null, max: null },
        ],
    };
    const normalized = normalizeGroupsConfig({
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], board }],
        defaultGroupId: 'alpha'
    });

    assert.deepEqual(normalized.groups[0].board, board);
});

test('normalizeGroupsConfig copies the board columns array instead of aliasing it', async () => {
    const {
        normalizeGroupsConfig
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const columns = [
        { id: 'col-00000001', name: 'To do', statuses: ['To Do'], colour: '#8c8c8c', star: false, min: null, max: null },
    ];
    const normalized = normalizeGroupsConfig({
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], board: { columns } }],
        defaultGroupId: 'alpha'
    });

    assert.notEqual(normalized.groups[0].board.columns, columns, 'output columns array must not be the same reference as the input');

    normalized.groups[0].board.columns.push({ id: 'col-00000002', name: 'Done', statuses: ['Done'], colour: '#8c8c8c', star: false, min: null, max: null });
    assert.equal(columns.length, 1, 'mutating the normalized output must not mutate the source config it was derived from');
});

test('normalizeGroupsConfig omits board (not an empty column list) when the group has none', async () => {
    const {
        normalizeGroupsConfig
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const normalized = normalizeGroupsConfig({
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'] }],
        defaultGroupId: 'alpha'
    });

    // Must be omitted, not defaulted to { columns: [] }: the backend
    // validator treats a present board with zero columns as invalid, so a
    // group that never configured a board must not send that key at all.
    assert.equal(normalized.groups[0].board, undefined);
    assert.equal(JSON.stringify(normalized.groups[0]).includes('"board"'), false);
});

test('formatGroupBoardSummary reports only group board configuration', async () => {
    const { formatGroupBoardSummary } = await import('../frontend/src/settings/groupConfigUtils.js');

    assert.equal(formatGroupBoardSummary(null), 'No board configured');
    assert.equal(formatGroupBoardSummary({ columns: [] }), 'No board configured');
    assert.equal(formatGroupBoardSummary({ columns: [{}] }), '1 column');
    assert.equal(formatGroupBoardSummary({ columns: [{}, {}] }), '2 columns');
    assert.equal(formatGroupBoardSummary({ columns: [{}] }, '1042'), '1 column');
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
