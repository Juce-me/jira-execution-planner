const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engBoardViewModel.js');
}

test('strict adapter keeps server columns authoritative and saved presentation by id', async () => {
    const { buildStrictEngBoardViewModel } = await loadModule();
    const model = buildStrictEngBoardViewModel({
        columns: [
            { id: 'todo', name: 'Server todo', color: '#597ef7', statusNames: ['To Do'], terminal: false },
            { id: 'board-unmapped', name: 'Unmapped', color: '#8c8c8c', statusNames: [], terminal: false },
            { id: 'done', name: 'Server done', color: '#52c41a', statusNames: ['Done'], terminal: true },
        ],
        epicsByKey: {
            'E-1': {
                key: 'E-1', summary: 'First', status: { id: '3', name: 'Done' },
                priority: { id: '1', name: 'Blocker' }, assignee: null, deliveryOwner: null,
                projectTrack: null, updated: null, parent: null, columnId: 'todo',
            },
            'E-2': {
                key: 'E-2', summary: 'Second', status: { id: '1', name: 'To Do' },
                priority: null, assignee: null, deliveryOwner: null, projectTrack: null,
                updated: null, parent: null, columnId: 'done',
            },
        },
        columnEpicKeys: { todo: ['E-1'], 'board-unmapped': [], done: ['E-2'] },
        childrenByKey: {},
        membershipAuthoritative: true,
        childrenAuthoritative: true,
        progressByColumn: { todo: { loadedChildren: 0, byEpic: [] } },
    }, {
        savedBoard: {
            columns: [
                { id: 'done', name: 'Old done', colour: '#ff4d4f', statuses: ['Closed'], star: true, min: 1, max: 3 },
                { id: 'todo', name: 'Old todo', colour: '#ff4d4f', statuses: ['Open'], star: false, min: null, max: 7 },
            ],
        },
    });

    assert.deepEqual(model.columns.map((column) => column.id), ['todo', 'board-unmapped', 'done']);
    assert.deepEqual(model.columns.map((column) => column.epicGroups.map((group) => group.key)), [
        ['E-1'], [], ['E-2'],
    ]);
    assert.equal(model.columns[0].name, 'Server todo');
    assert.equal(model.columns[0].colour, '#597ef7');
    assert.deepEqual(model.columns[0].statuses, ['To Do']);
    assert.equal(model.columns[0].max, 7);
    assert.equal(model.columns[1].isUnmapped, true);
    assert.equal(model.columns[2].star, true);
    assert.equal(model.columns[2].terminal, true);
    assert.equal(model.authoritative, true);
    assert.deepEqual(model.progressByColumn, { todo: { loadedChildren: 0, byEpic: [] } });
});

test('strict adapter translates mixed work items, retains other, and keeps zero-child epics', async () => {
    const { buildStrictEngBoardViewModel } = await loadModule();
    const model = buildStrictEngBoardViewModel({
        columns: [{ id: 'active', name: 'Active', color: '#8c8c8c', statusNames: ['In Progress'], terminal: false }],
        candidateEpicsByKey: {
            'E-ZERO': {
                key: 'E-ZERO', summary: 'No children', status: { id: '2', name: 'In Progress' },
                priority: null, assignee: null, deliveryOwner: null, projectTrack: null, updated: null,
                parent: { key: 'I-1', summary: 'Initiative one', issueType: { id: '10', name: 'Initiative' } },
                columnId: 'active',
            },
            'E-MIXED': {
                key: 'E-MIXED', summary: 'Mixed children', status: { id: '2', name: 'In Progress' },
                priority: null, assignee: null, deliveryOwner: null, projectTrack: null, updated: null,
                parent: null, columnId: 'active',
            },
        },
        columnEpicKeys: {},
        childrenByKey: {
            'BUG-1': {
                key: 'BUG-1', epicKey: 'E-MIXED', summary: 'Bug child', status: { id: '1', name: 'To Do' },
                priority: null, issueType: { id: '10004', name: 'Bug' }, assignee: null, updated: null,
                storyPoints: 3, team: null, project: { id: '10000', name: 'Platform' },
                projectClassification: 'other', sprintIds: [21],
            },
            'TASK-1': {
                key: 'TASK-1', epicKey: 'E-MIXED', summary: 'Task child', status: { id: '2', name: 'In Progress' },
                priority: { id: '3', name: 'Major' }, issueType: { id: '10005', name: 'Task' },
                assignee: null, updated: null, storyPoints: 5, team: { id: '7', name: 'Core' },
                project: { id: '10001', name: 'Core' }, projectClassification: 'tech', sprintIds: [],
            },
        },
        membershipAuthoritative: false,
        childrenAuthoritative: false,
    });

    const groups = Object.fromEntries(model.epicGroups.map((group) => [group.key, group]));
    assert.deepEqual(model.columns[0].epicGroups.map((group) => group.key), ['E-MIXED', 'E-ZERO']);
    assert.equal(groups['E-ZERO'].tasks.length, 0);
    assert.equal(groups['E-ZERO'].epic.initiative.summary, 'Initiative one');
    assert.equal(groups['E-MIXED'].storyPoints, 8);
    assert.equal(groups['E-MIXED'].tasks[0].fields.issuetype.name, 'Bug');
    assert.equal(groups['E-MIXED'].tasks[0].projectClassification, 'other');
    assert.equal(groups['E-MIXED'].tasks[1].fields.teamName, 'Core');
    assert.equal(model.authoritative, false);
});

test('pending child pages expose provisional counts and stop loading after availability failure', async () => {
    const { buildStrictEngBoardViewModel } = await loadModule();
    const data = {
        columns: [{ id: 'todo', name: 'Todo', color: '#aaa', statusNames: ['Todo'] }],
        epicsByKey: { 'E-1': { key: 'E-1', columnId: 'todo', status: { name: 'Todo' } } },
        progressByColumn: { todo: { byEpic: [{ epicKey: 'E-1', loadedChildren: 4, statusCounts: { Done: 2, 'In Progress': 1, Killed: 1 } }] } },
    };
    const group = buildStrictEngBoardViewModel(data).epicGroups[0];
    assert.equal(group.childrenLoading, true);
    assert.equal(group.childProgress.total, 4);
    assert.equal(group.childProgress.done, 2);
    assert.equal(group.childProgress.inProgress, 1);
    const failed = buildStrictEngBoardViewModel({ ...data, terminal: { type: 'error' } }).epicGroups[0];
    assert.equal(failed.childrenLoading, false);
    assert.equal(failed.childrenIncomplete, true);
});

test('completed column keeps final counts while another column still hydrates', async () => {
    const { buildStrictEngBoardViewModel } = await loadModule();
    const model = buildStrictEngBoardViewModel({
        columns: ['todo', 'done'].map(id => ({ id, name: id, color: '#aaa', statusNames: [id] })),
        epicsByKey: {
            'E-1': { key: 'E-1', columnId: 'todo', status: { name: 'Todo' } },
            'E-2': { key: 'E-2', columnId: 'done', status: { name: 'Done' } },
        },
        columnAuthority: { done: true },
    });
    assert.equal(model.epicGroups.find(group => group.key === 'E-1').childrenLoading, true);
    assert.equal(model.epicGroups.find(group => group.key === 'E-2').childrenIncomplete, false);
    assert.equal(model.epicGroups.find(group => group.key === 'E-2').childrenLoading, false);
});
