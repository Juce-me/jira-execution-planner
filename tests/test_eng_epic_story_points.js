const test = require('node:test');
const assert = require('node:assert/strict');

// Issue #311: an Epic's displayed Story Points total leaves out Killed stories.

const task = (key, sp, status) => ({ key, fields: { epicKey: 'E-1', status: { name: status }, customfield_10004: sp } });
const tasks = [task('S-1', 1, 'Done'), task('S-2', 3, 'Killed'), task('S-3', null, 'To Do')];

test('sumEpicStoryPoints skips Killed stories only', async () => {
    const { sumEpicStoryPoints } = await import('../frontend/src/eng/engTaskUtils.js');
    assert.equal(sumEpicStoryPoints(tasks), 1);
    assert.equal(sumEpicStoryPoints([task('S-4', '2.5', ' killed '), task('S-5', 2, 'Cancelled')]), 2);
    assert.equal(sumEpicStoryPoints([]), 0);
});

test('groupTasksByEpic excludes Killed story points from the Epic total', async () => {
    const { groupTasksByEpic } = await import('../frontend/src/eng/useEngWorkHierarchy.js');
    const group = groupTasksByEpic(tasks, {})['E-1'];
    assert.equal(group.storyPoints, 1);
    assert.equal(group.tasks.length, 3);
});

test('EPM epic group excludes Killed story points', async () => {
    const { buildEpmEngEpicGroup } = await import('../frontend/src/epm/epmProjectUtils.mjs');
    const group = buildEpmEngEpicGroup({
        issue: { key: 'E-1' },
        stories: [{ key: 'S-1', status: 'Done', storyPoints: 1 }, { key: 'S-2', status: 'Killed', storyPoints: 3 }],
    });
    assert.equal(group.storyPoints, 1);
});

test('strict board view model excludes Killed story points from the Epic total', async () => {
    const { buildStrictEngBoardViewModel } = await import('../frontend/src/eng/engBoardViewModel.js');
    const child = (key, status, storyPoints) => ({
        key, epicKey: 'E-1', summary: key, status: { id: '1', name: status }, priority: null,
        issueType: { id: '1', name: 'Story' }, assignee: null, updated: null, storyPoints, team: null,
        project: { id: '1', name: 'P' }, projectClassification: 'other', sprintIds: [],
    });
    const model = buildStrictEngBoardViewModel({
        columns: [{ id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false }],
        epicsByKey: { 'E-1': { key: 'E-1', summary: 'E', status: { id: '2', name: 'In Progress' }, priority: null, assignee: null, deliveryOwner: null, projectTrack: null, updated: null, parent: null, columnId: 'active' } },
        columnEpicKeys: {},
        childrenByKey: { 'S-1': child('S-1', 'Done', 1), 'S-2': child('S-2', 'Killed', 3) },
        membershipAuthoritative: false,
        childrenAuthoritative: false,
    });
    assert.equal(model.epicGroups[0].storyPoints, 1);
});
