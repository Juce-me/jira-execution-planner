const test = require('node:test');
const assert = require('node:assert/strict');

// §6.3 / D12: the epic detail panel's story list sorts three ways, and status order follows the
// board's column order left to right (so Done falls last). Sorting reorders rows and nothing else,
// which is why every case below asserts a key ORDER and never a shape.

async function loadModule() {
    return import('../frontend/src/eng/engBoardPanelStories.js');
}

// Board reading order: Ready | In progress | Done. Deliberately NOT alphabetical and not the
// StatusTransitionMenu's own STATUS_SORT_RANK, so a fallback to either would fail.
const COLUMNS = [
    { id: 'col-aaaaaaaa', name: 'Ready', statuses: ['To Do', 'Analysis'] },
    { id: 'col-bbbbbbbb', name: 'In progress', statuses: ['In Progress', 'Blocked'] },
    { id: 'col-cccccccc', name: 'Done', statuses: ['Done', 'Killed'] },
];

function story(key, statusName, assigneeName) {
    return {
        key,
        fields: {
            summary: `${key} summary`,
            status: { name: statusName },
            assignee: assigneeName ? { displayName: assigneeName } : null,
            updated: '2026-07-20T00:00:00.000+0000',
        },
    };
}

const STORIES = [
    story('PLAT-11', 'Done', 'Bob Brown'),
    story('PLAT-12', 'To Do', 'Alice Adams'),
    story('PLAT-13', 'In Progress', 'Bob Brown'),
    story('PLAT-14', 'To Do', null),
    story('PLAT-15', 'Blocked', 'Alice Adams'),
];

const keys = (rows) => rows.map((row) => row.key);

test('buildPanelStatusOrder follows the board column order left to right, Done last', async () => {
    const { buildPanelStatusOrder } = await loadModule();
    const order = buildPanelStatusOrder(COLUMNS);
    assert.ok(order.get('to do') < order.get('in progress'));
    assert.ok(order.get('in progress') < order.get('done'));
    assert.ok(order.get('analysis') < order.get('blocked'));
});

test('sortPanelStories orders by status in board column order', async () => {
    const { buildPanelStatusOrder, sortPanelStories } = await loadModule();
    const sorted = sortPanelStories(STORIES, { sort: 'status', statusOrder: buildPanelStatusOrder(COLUMNS) });
    assert.deepEqual(keys(sorted), ['PLAT-12', 'PLAT-14', 'PLAT-13', 'PLAT-15', 'PLAT-11']);
});

test('sortPanelStories orders by assignee then key, Unassigned last', async () => {
    const { buildPanelStatusOrder, sortPanelStories } = await loadModule();
    const sorted = sortPanelStories(STORIES, { sort: 'assignee', statusOrder: buildPanelStatusOrder(COLUMNS) });
    assert.deepEqual(keys(sorted), ['PLAT-12', 'PLAT-15', 'PLAT-11', 'PLAT-13', 'PLAT-14']);
});

test('sortPanelStories groups by assignee then status within each assignee', async () => {
    const { buildPanelStatusOrder, sortPanelStories } = await loadModule();
    const sorted = sortPanelStories(STORIES, {
        sort: 'assignee-status',
        statusOrder: buildPanelStatusOrder(COLUMNS),
    });
    assert.deepEqual(keys(sorted), ['PLAT-12', 'PLAT-15', 'PLAT-13', 'PLAT-11', 'PLAT-14']);
});

test('sortPanelStories leaves the input array untouched', async () => {
    const { buildPanelStatusOrder, sortPanelStories } = await loadModule();
    const input = STORIES.slice();
    sortPanelStories(input, { sort: 'status', statusOrder: buildPanelStatusOrder(COLUMNS) });
    assert.deepEqual(keys(input), keys(STORIES));
});

test('a status held by no column sorts after every mapped status, ordered by key', async () => {
    const { buildPanelStatusOrder, sortPanelStories } = await loadModule();
    const rows = [story('PLAT-21', 'Postponed', 'Alice Adams'), story('PLAT-22', 'Done', 'Alice Adams')];
    const sorted = sortPanelStories(rows, { sort: 'status', statusOrder: buildPanelStatusOrder(COLUMNS) });
    assert.deepEqual(keys(sorted), ['PLAT-22', 'PLAT-21']);
});

test('PANEL_SORT_OPTIONS offers exactly the three §6.3 orders, default first', async () => {
    const { PANEL_SORT_OPTIONS } = await loadModule();
    assert.deepEqual(PANEL_SORT_OPTIONS.map((option) => option.value), ['assignee-status', 'status', 'assignee']);
    assert.equal(PANEL_SORT_OPTIONS[0].label, 'Assignee, then status');
});
