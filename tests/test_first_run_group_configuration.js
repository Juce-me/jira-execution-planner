const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadFirstRunGroupConfiguration() {
    const modulePath = path.join(
        __dirname,
        '..',
        'frontend',
        'src',
        'settings',
        'firstRunGroupConfiguration.js'
    );
    assert.ok(fs.existsSync(modulePath), 'Expected frontend/src/settings/firstRunGroupConfiguration.js to exist');
    const source = fs.readFileSync(modulePath, 'utf8')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return {
        shouldShowFirstRunGroupSearch,
        buildFirstRunGroupDraft,
        beginFirstRunGroupConfiguration,
    };`)();
}

test('shouldShowFirstRunGroupSearch hides search for zero through three groups', () => {
    const { shouldShowFirstRunGroupSearch } = loadFirstRunGroupConfiguration();
    [0, 1, 2, 3].forEach(count => assert.equal(shouldShowFirstRunGroupSearch(count), false));
});

test('shouldShowFirstRunGroupSearch shows search for four and five groups', () => {
    const { shouldShowFirstRunGroupSearch } = loadFirstRunGroupConfiguration();
    [4, 5].forEach(count => assert.equal(shouldShowFirstRunGroupSearch(count), true));
});

test('beginFirstRunGroupConfiguration returns normalized controlled state', () => {
    const { beginFirstRunGroupConfiguration } = loadFirstRunGroupConfiguration();

    assert.deepEqual(beginFirstRunGroupConfiguration({ mode: 'duplicate', sourceGroupId: 'platform' }), {
        mode: 'duplicate',
        sourceGroupId: 'platform',
        removeTeams: false,
        removeComponents: false,
    });
    assert.deepEqual(beginFirstRunGroupConfiguration({ mode: 'repair', sourceGroupId: null }), {
        mode: 'repair',
        sourceGroupId: null,
        removeTeams: false,
        removeComponents: false,
    });
});

test('duplicate draft preserves its source and copies unrelated fields', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const sourceGroup = {
        id: 'source',
        name: 'Source',
        teamIds: ['team-a'],
        teamLabels: { 'team-a': 'Alpha' },
        missingInfoComponents: ['Backend'],
        excludedCapacityEpics: ['SYN-1'],
        board: { columns: [{ id: 'todo', name: 'To do' }] },
    };
    const before = structuredClone(sourceGroup);

    const draft = buildFirstRunGroupDraft({
        mode: 'duplicate',
        sourceGroup,
        existingGroups: [sourceGroup],
    });

    assert.deepEqual(sourceGroup, before);
    assert.notEqual(draft, sourceGroup);
    assert.deepEqual(draft.teamIds, ['team-a']);
    assert.deepEqual(draft.teamLabels, { 'team-a': 'Alpha' });
    assert.deepEqual(draft.missingInfoComponents, ['Backend']);
    assert.deepEqual(draft.excludedCapacityEpics, ['SYN-1']);
    assert.deepEqual(draft.board, sourceGroup.board);
    assert.equal(draft.name, 'Source Copy');
    assert.equal(draft.id, 'source-copy');
});

test('duplicate cleanup flags independently remove teams and components', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const sourceGroup = {
        id: 'source',
        name: 'Source',
        teamIds: ['team-a'],
        teamLabels: { 'team-a': 'Alpha' },
        missingInfoComponents: ['Backend'],
    };
    const teamsRemoved = buildFirstRunGroupDraft({
        mode: 'duplicate', sourceGroup, existingGroups: [sourceGroup], removeTeams: true,
    });
    const componentsRemoved = buildFirstRunGroupDraft({
        mode: 'duplicate', sourceGroup, existingGroups: [sourceGroup], removeComponents: true,
    });
    const bothRemoved = buildFirstRunGroupDraft({
        mode: 'duplicate', sourceGroup, existingGroups: [sourceGroup], removeTeams: true, removeComponents: true,
    });

    assert.deepEqual(teamsRemoved.teamIds, []);
    assert.deepEqual(teamsRemoved.teamLabels, {});
    assert.deepEqual(teamsRemoved.missingInfoComponents, ['Backend']);
    assert.deepEqual(componentsRemoved.teamIds, ['team-a']);
    assert.deepEqual(componentsRemoved.teamLabels, { 'team-a': 'Alpha' });
    assert.deepEqual(componentsRemoved.missingInfoComponents, []);
    assert.deepEqual(bothRemoved.teamIds, []);
    assert.deepEqual(bothRemoved.teamLabels, {});
    assert.deepEqual(bothRemoved.missingInfoComponents, []);
});

test('duplicate draft chooses collision-free Source Copy N names and ids', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const sourceGroup = { id: 'source', name: 'Source', teamIds: ['team-a'] };
    const existingGroups = [
        sourceGroup,
        { id: 'source-copy', name: 'Source Copy' },
        { id: 'source-copy-2', name: 'Source Copy 2' },
    ];

    const draft = buildFirstRunGroupDraft({ mode: 'duplicate', sourceGroup, existingGroups });

    assert.equal(draft.name, 'Source Copy 3');
    assert.equal(draft.id, 'source-copy-3');
});

test('create draft starts clean and avoids existing name and id collisions', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const draft = buildFirstRunGroupDraft({
        mode: 'create',
        existingGroups: [
            { id: 'new-department', name: 'New Department' },
            { id: 'new-department-2', name: 'New Department 2' },
        ],
    });

    assert.deepEqual(draft, {
        id: 'new-department-3',
        name: 'New Department 3',
        teamIds: [],
        missingInfoComponents: [],
        excludedCapacityEpics: [],
    });
});
