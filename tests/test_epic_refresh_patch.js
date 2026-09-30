import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEpic, diffStory, mergeEpicStories, normalizeStory, patchEpicScopeEntries, patchStoryCopies } from '../frontend/src/eng/epicRefreshPatch.js';

const story = (key, fields = {}) => ({
    key,
    id: key,
    fields: {
        summary: `Story ${key}`,
        status: { name: 'To Do' },
        priority: { name: 'Medium' },
        issuetype: { name: 'Story' },
        assignee: { accountId: 'a1', displayName: 'Ana' },
        updated: '2026-09-30T10:00:00.000+0000',
        customfield_10004: 3,
        teamId: 't1',
        epicKey: 'EPIC-1',
        customfield_10101: [{ id: 7 }],
        ...fields,
    },
});
const base = {
    epicKey: 'EPIC-1', laneApplied: true, capped: false, detailsMissing: false,
    protectedKeys: new Set(), clickSnapshot: new Map(), userRemovedKeys: new Set(),
};

test('a comment-only change (updated differs, displayed fields equal) is silent', () => {
    const diff = diffStory(story('S-1'), story('S-1', { updated: '2026-09-30T11:00:00.000+0000' }));
    assert.deepEqual(diff.changedFields, []);
    assert.equal(diff.silent, true);
    assert.equal(diff.equal, false);
});

test('an identical item is equal', () => {
    assert.equal(diffStory(story('S-1'), story('S-1')).equal, true);
});

test('status, priority, summary and issuetype changes are reported by field', () => {
    const diff = diffStory(story('S-1'), story('S-1', { status: { name: 'Done' }, summary: 'New', priority: { name: 'High' }, issuetype: { name: 'Task' } }));
    assert.deepEqual(diff.changedFields.sort(), ['issuetype', 'priority', 'status', 'summary']);
});

test('Story Points null, undefined and 0 are equal; 0 and 3 differ', () => {
    assert.equal(diffStory(story('S-1', { customfield_10004: null }), story('S-1', { customfield_10004: 0 })).equal, true);
    assert.equal(diffStory(story('S-1', { customfield_10004: undefined }), story('S-1', { customfield_10004: 0 })).equal, true);
    assert.deepEqual(diffStory(story('S-1', { customfield_10004: 0 }), story('S-1', { customfield_10004: 3 })).changedFields, ['storyPoints']);
});

test('assignee falls back to display name and ignores unrelated person fields', () => {
    const a = story('S-1', { assignee: { displayName: 'Ana' } });
    const b = story('S-1', { assignee: { displayName: 'Ana', avatar: 'x' } });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { assignee: { displayName: 'Bo' } })).changedFields, ['assignee']);
});

test('sprint compares as an id-sorted list', () => {
    const a = story('S-1', { customfield_10101: [{ id: 2 }, { id: 1 }] });
    const b = story('S-1', { customfield_10101: [{ id: 1 }, { id: 2 }] });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { customfield_10101: [{ id: 3 }] })).changedFields, ['sprint']);
});

test('subtaskSummary compares by content, not key order', () => {
    const a = story('S-1', { subtaskSummary: { total: 2, done: 1 } });
    const b = story('S-1', { subtaskSummary: { done: 1, total: 2 } });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { subtaskSummary: { total: 2, done: 2 } })).changedFields, ['subtaskSummary']);
});

test('normalizeStory is total on an empty issue', () => {
    assert.equal(normalizeStory({}).storyPoints, 0);
    assert.equal(normalizeStory(undefined).status, '');
});

test('merge keeps the held array identity when nothing changed', () => {
    const held = [story('S-1'), story('S-2')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2')] });
    assert.equal(result.items, held);
    assert.equal(result.changed, false);
});

test('merge replaces only the changed item and keeps other identities', () => {
    const held = [story('S-1'), story('S-2')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2', { status: { name: 'Done' } })] });
    assert.equal(result.items[0], held[0]);
    assert.notEqual(result.items[1], held[1]);
    assert.deepEqual(result.changedKeys, ['S-2']);
    assert.equal(result.changed, true);
});

test('a silent-only update replaces the item but reports it as silent', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { updated: '2026-09-30T12:00:00.000+0000' })] });
    assert.deepEqual(result.silentKeys, ['S-1']);
    assert.deepEqual(result.changedKeys, []);
});

test('a fetched story that is not held is added; a user-removed one is not', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2'), story('S-3')], userRemovedKeys: new Set(['S-3']) });
    assert.deepEqual(result.addedKeys, ['S-2']);
    assert.deepEqual(result.items.map(i => i.key), ['S-1', 'S-2']);
});

test('a held story of this epic missing from a complete lane is removed', () => {
    const held = [story('S-1'), story('S-2'), story('S-9', { epicKey: 'EPIC-2' })];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1')] });
    assert.deepEqual(result.removedKeys, ['S-2']);
    assert.deepEqual(result.items.map(i => i.key), ['S-1', 'S-9']);
});

test('no removal when the lane is capped or the epic details are missing', () => {
    const held = [story('S-1'), story('S-2')];
    assert.equal(mergeEpicStories({ ...base, held, fetched: [story('S-1')], capped: true }).removedKeys.length, 0);
    assert.equal(mergeEpicStories({ ...base, held, fetched: [story('S-1')], detailsMissing: true }).removedKeys.length, 0);
});

test('a lane that did not apply leaves the list untouched', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [], laneApplied: false });
    assert.equal(result.items, held);
    assert.equal(result.changed, false);
});

test('protected keys and keys edited since the click are kept as held', () => {
    const held = [story('S-1', { status: { name: 'Done' } }), story('S-2', { status: { name: 'In Progress' } })];
    const clickSnapshot = new Map([['S-2', story('S-2', { status: { name: 'To Do' } })]]);
    const result = mergeEpicStories({
        ...base, held, clickSnapshot, protectedKeys: new Set(['S-1']),
        fetched: [story('S-1'), story('S-2')],
    });
    assert.deepEqual(result.keptKeys.sort(), ['S-1', 'S-2']);
    assert.equal(result.items[0], held[0]);
    assert.equal(result.items[1], held[1]);
});

test('a story moved into this epic replaces the copy held under another epic (no duplicate)', () => {
    const held = [story('S-1', { epicKey: 'EPIC-2' })];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { epicKey: 'EPIC-1' })] });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fields.epicKey, 'EPIC-1');
    assert.deepEqual(result.changedKeys, ['S-1']);
});

test('epic diff normalizes status and priority shapes and ignores updated-only changes as silent', () => {
    const held = { key: 'EPIC-1', summary: 'E', status: 'In Progress', priority: 'High', projectTrack: 'Committed', assignee: { accountId: 'a1' }, updated: '1' };
    assert.equal(diffEpic(held, { ...held, status: { name: 'In Progress' }, priority: { name: 'High' } }).equal, true);
    const silent = diffEpic(held, { ...held, updated: '2' });
    assert.equal(silent.silent, true);
    assert.deepEqual(diffEpic(held, { ...held, status: 'Done', initiative: { key: 'INIT-1', summary: 'I' } }).changedFields.sort(), ['initiative', 'status']);
    assert.equal(diffEpic(held, undefined).equal, true);
});

test('merge reports the changed fields per key', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { status: { name: 'Done' }, customfield_10004: 5 })] });
    assert.deepEqual(result.changedFieldsByKey['S-1'].slice().sort(), ['status', 'storyPoints']);
});

test('two merges applied one after the other keep both epics updates (functional-updater semantics)', () => {
    const held = [story('A-1', { epicKey: 'EPIC-1' }), story('B-1', { epicKey: 'EPIC-2' })];
    const afterFirst = mergeEpicStories({ ...base, epicKey: 'EPIC-1', held, fetched: [story('A-1', { epicKey: 'EPIC-1', status: { name: 'Done' } })] }).items;
    const afterSecond = mergeEpicStories({ ...base, epicKey: 'EPIC-2', held: afterFirst, fetched: [story('B-1', { epicKey: 'EPIC-2', status: { name: 'Done' } })] }).items;
    assert.deepEqual(afterSecond.map(item => item.fields.status.name), ['Done', 'Done']);
});

test('patchEpicScopeEntries updates only the matching epic-shaped entry and keeps identity when equal', () => {
    const list = [
        { key: 'EPIC-1', summary: 'E', status: { name: 'In Progress' }, assignee: { accountId: 'a1' } },
        { key: 'EPIC-2', summary: 'F', status: { name: 'To Do' } },
    ];
    assert.equal(patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E', status: 'In Progress', assignee: { accountId: 'a1' } }), list);
    const next = patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E2', status: 'Done', assignee: { accountId: 'a1' } });
    assert.equal(next[0].status.name, 'Done');
    assert.equal(next[0].summary, 'E2');
    assert.equal(next[1], list[1]);
    assert.equal(patchEpicScopeEntries(list, 'EPIC-1', undefined), list);
});

test('patchEpicScopeEntries clears the scope assignee when the fetched epic is unassigned (assignee: null)', () => {
    const list = [{ key: 'EPIC-1', summary: 'E', status: { name: 'In Progress' }, assignee: { accountId: 'a1' } }];
    const next = patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E', status: 'In Progress', assignee: null });
    assert.notEqual(next, list);
    assert.equal(next[0].assignee, null);
});

test('patchEpicScopeEntries leaves the scope assignee alone when the fetched epic carries no assignee key', () => {
    const list = [{ key: 'EPIC-1', summary: 'E', status: { name: 'In Progress' }, assignee: { accountId: 'a1' } }];
    assert.equal(patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E', status: 'In Progress' }), list);
    const next = patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E2', status: 'In Progress' });
    assert.deepEqual(next[0].assignee, { accountId: 'a1' });
});

test('patchStoryCopies patches only keys present in both and keeps identity when equal', () => {
    const lightweight = { key: 'S-1', fields: { status: { name: 'To Do' }, epicKey: 'EPIC-1' } };
    const list = [lightweight, { key: 'S-9', fields: { status: { name: 'To Do' } } }];
    assert.equal(patchStoryCopies(list, new Map([['S-1', story('S-1', { status: { name: 'To Do' } })]])), list);
    const next = patchStoryCopies(list, new Map([['S-1', story('S-1', { status: { name: 'Done' } })]]));
    assert.equal(next[0].fields.status.name, 'Done');
    assert.equal(Object.keys(next[0].fields).sort().join(','), 'epicKey,status');
    assert.equal(next[1], list[1]);
});
