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
        doneEpicRetentionDays: 90,
    };
    const normalized = normalizeGroupsConfig({
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], board }],
        defaultGroupId: 'alpha'
    });

    assert.deepEqual(normalized.groups[0].board, board);
});

test('normalizeGroupsConfig materializes legacy retention without mutating the source board', async () => {
    const { normalizeGroupsConfig } = await import('../frontend/src/settings/groupConfigUtils.js');
    const board = {
        columns: [
            { id: 'col-00000001', name: 'Done', statuses: ['Done'] },
            { id: 'col-00000002', name: 'Release', statuses: ['Release'] },
        ],
    };
    const normalized = normalizeGroupsConfig({ groups: [{ id: 'alpha', name: 'Alpha', board }] });
    assert.equal(normalized.groups[0].board.doneEpicRetentionDays, 28);
    assert.deepEqual(normalized.groups[0].board.columns.map((column) => column.id), ['col-00000002', 'col-00000001']);
    assert.deepEqual(board.columns.map((column) => column.id), ['col-00000001', 'col-00000002']);
    assert.equal(Object.hasOwn(board, 'doneEpicRetentionDays'), false);
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

test('normalizeGroupsConfig converts a legacy scalar team label to a single-item array', async () => {
    const { normalizeGroupsConfig } = await import('../frontend/src/settings/groupConfigUtils.js');

    const normalized = normalizeGroupsConfig({
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], teamLabels: { 'team-a': 'label_team_a' } }],
        defaultGroupId: 'alpha',
    });

    assert.deepEqual(normalized.groups[0].teamLabels, { 'team-a': ['label_team_a'] });
});

test('normalizeGroupsConfig keeps a canonical one-to-three alias array, trimmed and ordered', async () => {
    const { normalizeGroupsConfig } = await import('../frontend/src/settings/groupConfigUtils.js');

    const normalized = normalizeGroupsConfig({
        version: 2,
        groups: [{
            id: 'alpha',
            name: 'Alpha',
            teamIds: ['team-a'],
            teamLabels: { 'team-a': [' label_team_a ', 'label_team_a_old', '   '] },
        }],
        defaultGroupId: 'alpha',
    });

    assert.deepEqual(normalized.groups[0].teamLabels, { 'team-a': ['label_team_a', 'label_team_a_old'] });
});

test('normalizeGroupsConfig defaults to the current version and drops a Team with only blank aliases', async () => {
    const { normalizeGroupsConfig, GROUPS_CONFIG_VERSION } = await import('../frontend/src/settings/groupConfigUtils.js');

    assert.equal(GROUPS_CONFIG_VERSION, 2);
    const normalized = normalizeGroupsConfig({
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], teamLabels: { 'team-a': ['', '   '] } }],
        defaultGroupId: 'alpha',
    });

    assert.equal(normalized.version, GROUPS_CONFIG_VERSION);
    assert.deepEqual(normalized.groups[0].teamLabels, {});
});

test('normalizeTeamLabelAliases trims, dedupes case-insensitively, and does not mutate its input', async () => {
    const { normalizeTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const source = ['label_team_a', ' LABEL_TEAM_A ', 'label_team_a_old', 123, null];
    const frozenSource = Object.freeze([...source]);
    assert.deepEqual(normalizeTeamLabelAliases(frozenSource), ['label_team_a', 'label_team_a_old']);
    assert.deepEqual(normalizeTeamLabelAliases('label_team_a'), ['label_team_a']);
    assert.deepEqual(normalizeTeamLabelAliases(null), []);
});

test('normalizeTeamLabelAliases coerces a legacy numeric scalar and rejects a bool scalar', async () => {
    const { normalizeTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    assert.deepEqual(normalizeTeamLabelAliases(2026), ['2026']);
    assert.deepEqual(normalizeTeamLabelAliases(true), []);
});

test('validateTeamLabelAliases surfaces a fourth alias without truncating', async () => {
    const { validateTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = validateTeamLabelAliases(['label_a', 'label_b', 'label_c', 'label_d']);
    assert.deepEqual(result.aliases, ['label_a', 'label_b', 'label_c', 'label_d']);
    assert.equal(result.error, 'has more than 3 Jira labels.');
});

test('validateTeamLabelAliases surfaces a case-insensitive duplicate preserving first spelling', async () => {
    const { validateTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = validateTeamLabelAliases(['label_team_a', ' LABEL_TEAM_A ']);
    assert.deepEqual(result.aliases, ['label_team_a']);
    assert.equal(result.error, 'has duplicate Jira labels.');
});

test('validateTeamLabelAliases surfaces a non-string entry with a label-free message', async () => {
    const { validateTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = validateTeamLabelAliases(['label_team_a', 42]);
    assert.deepEqual(result.aliases, ['label_team_a']);
    assert.equal(result.error, 'has an invalid Jira label.');
    assert.equal(result.error.includes('label_team_a'), false);
});

test('validateTeamLabelAliases accepts a legacy numeric scalar and rejects a bool scalar', async () => {
    const { validateTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const numeric = validateTeamLabelAliases(2026);
    assert.deepEqual(numeric.aliases, ['2026']);
    assert.equal(numeric.error, null);

    const bool = validateTeamLabelAliases(true);
    assert.deepEqual(bool.aliases, []);
    assert.equal(bool.error, 'has an invalid Jira label.');
});

test('validateTeamLabelAliases accepts one-to-three aliases with no error', async () => {
    const { validateTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = validateTeamLabelAliases(['label_a', 'label_b', 'label_c']);
    assert.deepEqual(result.aliases, ['label_a', 'label_b', 'label_c']);
    assert.equal(result.error, null);
});

test('flattenTeamLabelAliases unions aliases across requested Teams case-insensitively', async () => {
    const { flattenTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const teamLabels = {
        'team-a': ['label_team_a', 'LABEL_TEAM_A_OLD'],
        'team-b': ['label_team_a_old', 'label_team_b'],
    };
    assert.deepEqual(
        flattenTeamLabelAliases(teamLabels, ['team-a', 'team-b']),
        ['label_team_a', 'LABEL_TEAM_A_OLD', 'label_team_b']
    );
    assert.deepEqual(flattenTeamLabelAliases(teamLabels, ['team-a']), ['label_team_a', 'LABEL_TEAM_A_OLD']);
});

test('flattenTeamLabelAliases flattens a legacy scalar map value', async () => {
    const { flattenTeamLabelAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    const teamLabels = {
        'team-a': 2026,
        'team-b': 'label_team_b',
    };
    assert.deepEqual(flattenTeamLabelAliases(teamLabels, ['team-a', 'team-b']), ['2026', 'label_team_b']);
});

test('epicMatchesTeamAliases matches case-insensitively on any alias', async () => {
    const { epicMatchesTeamAliases } = await import('../frontend/src/settings/groupConfigUtils.js');

    assert.equal(epicMatchesTeamAliases(['Label_Team_A'], ['label_team_a', 'label_team_a_old']), true);
    assert.equal(epicMatchesTeamAliases(['other-label'], ['label_team_a']), false);
    assert.equal(epicMatchesTeamAliases([], ['label_team_a']), false);
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

test('addTeamLabelAlias appends once in order without mutating the source map', async () => {
    const { addTeamLabelAlias } = await import('../frontend/src/settings/groupConfigUtils.js');

    const source = Object.freeze({ 'team-a': Object.freeze(['label_team_a']) });
    const result = addTeamLabelAlias(source, 'team-a', ' label_team_a_old ');
    assert.equal(result.status, 'added');
    assert.deepEqual(result.teamLabels, { 'team-a': ['label_team_a', 'label_team_a_old'] });
    assert.notEqual(result.teamLabels, source);
    assert.deepEqual(source, { 'team-a': ['label_team_a'] });

    const fromEmpty = addTeamLabelAlias(undefined, 'team-a', 'label_team_a');
    assert.equal(fromEmpty.status, 'added');
    assert.deepEqual(fromEmpty.teamLabels, { 'team-a': ['label_team_a'] });
});

test('addTeamLabelAlias leaves the map unchanged for duplicates, blanks, and a fourth alias', async () => {
    const { addTeamLabelAlias, TEAM_LABEL_ALIAS_LIMIT } = await import('../frontend/src/settings/groupConfigUtils.js');

    assert.equal(TEAM_LABEL_ALIAS_LIMIT, 3);
    const source = { 'team-a': ['label_team_a'] };
    const duplicate = addTeamLabelAlias(source, 'team-a', ' LABEL_TEAM_A ');
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.teamLabels, source);

    const blank = addTeamLabelAlias(source, 'team-a', '   ');
    assert.equal(blank.status, 'empty');
    assert.equal(blank.teamLabels, source);

    const full = { 'team-a': ['label_a', 'label_b', 'label_c'] };
    const fourth = addTeamLabelAlias(full, 'team-a', 'label_d');
    assert.equal(fourth.status, 'limit');
    assert.equal(fourth.teamLabels, full);
    assert.deepEqual(full, { 'team-a': ['label_a', 'label_b', 'label_c'] });
});

test('addTeamLabelAlias upgrades a legacy scalar draft value to an array', async () => {
    const { addTeamLabelAlias } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = addTeamLabelAlias({ 'team-a': 'label_team_a' }, 'team-a', 'label_team_a_old');
    assert.deepEqual(result.teamLabels, { 'team-a': ['label_team_a', 'label_team_a_old'] });
});

test('removeTeamLabelAlias removes only that alias and drops the Team entry after the last one', async () => {
    const { removeTeamLabelAlias } = await import('../frontend/src/settings/groupConfigUtils.js');

    const source = Object.freeze({
        'team-a': Object.freeze(['label_team_a', 'label_team_a_old']),
        'team-b': Object.freeze(['label_team_b']),
    });
    const once = removeTeamLabelAlias(source, 'team-a', 'label_team_a');
    assert.deepEqual(once, { 'team-a': ['label_team_a_old'], 'team-b': ['label_team_b'] });
    assert.deepEqual(source['team-a'], ['label_team_a', 'label_team_a_old']);

    const last = removeTeamLabelAlias(once, 'team-a', 'label_team_a_old');
    assert.deepEqual(last, { 'team-b': ['label_team_b'] });
    assert.equal(Object.hasOwn(last, 'team-a'), false);
});

test('validateImportedTeamLabels rejects invalid alias arrays with label-free messages', async () => {
    const { validateImportedTeamLabels } = await import('../frontend/src/settings/groupConfigUtils.js');

    assert.equal(validateImportedTeamLabels(undefined), null);
    assert.equal(validateImportedTeamLabels({ 'team-a': 'label_team_a' }), null);
    assert.equal(validateImportedTeamLabels({ 'team-a': ['label_team_a', 'label_team_a_old', 'label_team_a_extra'] }), null);

    const cases = [
        { 'team-a': ['label_a', 'label_b', 'label_c', 'label_d'] },
        { 'team-a': ['label_team_a', 'LABEL_TEAM_A'] },
        { 'team-a': ['label_team_a', 7] },
        ['label_team_a'],
    ];
    cases.forEach((teamLabels) => {
        const error = validateImportedTeamLabels(teamLabels);
        assert.equal(typeof error, 'string');
        assert.equal(/label_/i.test(error), false, error);
        assert.equal(error.includes('team-a'), false, error);
    });
    assert.equal(
        validateImportedTeamLabels({ 'team-a': ['label_a', 'label_b', 'label_c', 'label_d'] }),
        'Import rejected: a Team has more than 3 Jira labels.'
    );
});
