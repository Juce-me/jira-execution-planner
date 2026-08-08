const test = require('node:test');
const assert = require('node:assert/strict');

// §6.4 / D37 / D42 — the drop resolver, asserted without a drag. A column is a SET of statuses, so
// dropping a card on one is not a single answer: the column's configured statuses are intersected
// with the transitions Jira offers for that issue right now, and the intersection is 0 (refuse),
// 1 (transition straight through) or many (ask, scoped to the column). Keeping this pure is what
// makes the whole resolution testable here instead of only through a browser drag.

async function loadModule() {
    return import('../frontend/src/eng/engBoardDrop.js');
}

async function loadFixture() {
    return import('./fixtures/groupBoardReference.mjs');
}

// The shape POST /api/issues/transitions/options returns (backend/services/jira_issue_transitions.py
// load_transition_options): an aggregate `targetStatuses`, plus the per-issue transitions it was
// summarized from.
function optionsPayload(names) {
    return {
        issues: [{
            key: 'PLAT-1',
            issueType: 'Epic',
            currentStatus: 'In Progress',
            transitions: names.map((name) => ({ name: `Move to ${name}`, toStatus: name })),
        }],
        targetStatuses: names.map((name) => ({ name, availableCount: 1, blockedCount: 0 })),
    };
}

/* ── The intersection: 0 / 1 / many ─────────────────────────────────────────────────────────── */

test('resolveBoardDrop: one eligible status transitions straight to it', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-a',
        targetColumn: { id: 'col-b', statuses: ['Accepted'] },
        offeredStatuses: ['Accepted', 'Done'],
    });
    assert.deepEqual(resolution, { outcome: 'transition', statuses: ['Accepted'] });
});

test('resolveBoardDrop: several eligible statuses ask, in the column\'s own order', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-a',
        targetColumn: { id: 'col-b', statuses: ['Done', 'Killed', 'Incomplete'] },
        // Deliberately offered in a different order: the menu follows the COLUMN, not Jira.
        offeredStatuses: ['Incomplete', 'Done', 'Killed'],
    });
    assert.deepEqual(resolution, { outcome: 'choose', statuses: ['Done', 'Killed', 'Incomplete'] });
});

test('resolveBoardDrop: no eligible status refuses and offers nothing', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-a',
        targetColumn: { id: 'col-b', statuses: ['Done', 'Killed'] },
        offeredStatuses: ['To Do', 'Analysis'],
    });
    assert.deepEqual(resolution, { outcome: 'refused', statuses: [] });
});

test('resolveBoardDrop: a column status Jira does not offer is excluded from the menu', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-a',
        targetColumn: { id: 'col-b', statuses: ['Done', 'Killed', 'Incomplete'] },
        offeredStatuses: ['Done', 'Incomplete'],
    });
    // Killed is configured on the column but Jira will not accept it, so it is never offered.
    assert.deepEqual(resolution, { outcome: 'choose', statuses: ['Done', 'Incomplete'] });
});

test('resolveBoardDrop: a Jira transition outside the column is excluded from the menu', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-a',
        targetColumn: { id: 'col-b', statuses: ['In Progress', 'Release'] },
        offeredStatuses: ['In Progress', 'Release', 'Done', 'Killed'],
    });
    assert.deepEqual(resolution, { outcome: 'choose', statuses: ['In Progress', 'Release'] });
});

test('resolveBoardDrop: the source column is a no-op, whatever Jira offers', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-b',
        targetColumn: { id: 'col-b', statuses: ['Done', 'Killed'] },
        offeredStatuses: ['Done', 'Killed'],
    });
    assert.deepEqual(resolution, { outcome: 'no-op', statuses: [] });
});

test('resolveBoardDrop: status matching ignores case and surrounding space', async () => {
    const { resolveBoardDrop } = await loadModule();
    const resolution = resolveBoardDrop({
        sourceColumnId: 'col-a',
        targetColumn: { id: 'col-b', statuses: ['In Progress'] },
        offeredStatuses: ['  in progress '],
    });
    assert.deepEqual(resolution, { outcome: 'transition', statuses: ['In Progress'] });
});

test('resolveBoardDrop: a column with no statuses refuses rather than throwing', async () => {
    const { resolveBoardDrop } = await loadModule();
    assert.deepEqual(
        resolveBoardDrop({ sourceColumnId: 'col-a', targetColumn: { id: 'col-b', statuses: [] }, offeredStatuses: ['Done'] }),
        { outcome: 'refused', statuses: [] },
    );
    assert.deepEqual(resolveBoardDrop({}), { outcome: 'no-op', statuses: [] });
});

test('resolveBoardDrop: the reference Done column offers only what Jira accepts', async () => {
    const { resolveBoardDrop } = await loadModule();
    const { REFERENCE_COLUMNS } = await loadFixture();
    const done = REFERENCE_COLUMNS.find((column) => column.name === 'Done');
    assert.deepEqual(done.statuses, ['Done', 'Killed', 'Incomplete']);

    assert.deepEqual(
        resolveBoardDrop({
            sourceColumnId: 'col-6f708192',
            targetColumn: done,
            offeredStatuses: ['Done', 'Killed', 'Incomplete', 'To Do'],
        }),
        { outcome: 'choose', statuses: ['Done', 'Killed', 'Incomplete'] },
    );
    assert.deepEqual(
        resolveBoardDrop({ sourceColumnId: 'col-6f708192', targetColumn: done, offeredStatuses: ['Incomplete'] }),
        { outcome: 'transition', statuses: ['Incomplete'] },
    );
});

/* ── Reading the options contract ───────────────────────────────────────────────────────────── */

test('offeredStatusNames: reads the aggregated targetStatuses', async () => {
    const { offeredStatusNames } = await loadModule();
    assert.deepEqual(offeredStatusNames(optionsPayload(['Done', 'Killed'])), ['Done', 'Killed']);
});

test('offeredStatusNames: falls back to the per-issue transitions when the aggregate is absent', async () => {
    const { offeredStatusNames } = await loadModule();
    const payload = optionsPayload(['Done', 'Killed']);
    delete payload.targetStatuses;
    assert.deepEqual(offeredStatusNames(payload), ['Done', 'Killed']);
});

test('offeredStatusNames: a null/failed options response offers nothing', async () => {
    const { offeredStatusNames } = await loadModule();
    assert.deepEqual(offeredStatusNames(null), []);
    assert.deepEqual(offeredStatusNames({ issues: [{ key: 'PLAT-1', error: 'transitions_unavailable' }] }), []);
});

/* ── The unresolved-story gate (D42) ────────────────────────────────────────────────────────── */

test('isResolvedStatus: the three names the reference configuration puts in Done', async () => {
    const { isResolvedStatus } = await loadModule();
    ['Done', 'Killed', 'Incomplete', 'done', ' KILLED '].forEach((name) => {
        assert.equal(isResolvedStatus(name), true, `${name} is a resolution status`);
    });
    ['In Progress', 'Release', 'Blocked', 'To Do', '', null].forEach((name) => {
        assert.equal(isResolvedStatus(name), false, `${name} is not a resolution status`);
    });
});

test('isResolvedStatus: the general case is the done statusCategory, not the three names', async () => {
    const { isResolvedStatus } = await loadModule();
    // A board whose resolution status is named something else entirely still resolves.
    assert.equal(isResolvedStatus({ name: 'Shipped', statusCategoryKey: 'done' }), true);
    assert.equal(isResolvedStatus({ name: 'Shipped' }), false);
    assert.equal(isResolvedStatus({ name: 'In Progress', statusCategoryKey: 'indeterminate' }), false);
    // The name arm still wins when no category travels with the status.
    assert.equal(isResolvedStatus({ name: 'Killed' }), true);
});

/* ── Getting a category to the gate at all ──────────────────────────────────────────────────────
   The board only ever HAS status names: `board.columns[].statuses` stores names, and the
   transition-options response returns names. Without these two helpers the category arm above is
   unreachable in the running app, and a done-category status called anything but the three literal
   names moves silently past the gate. `describeStatus` builds the exact object the view hands to
   needsOpenStoryConfirmation, so the shape asserted here is the shape production produces. */

test('buildStatusCategoryIndex: indexes the catalog by lowercased name', async () => {
    const { buildStatusCategoryIndex } = await loadModule();
    const index = buildStatusCategoryIndex([
        { id: '1', name: 'In Progress', statusCategoryKey: 'indeterminate' },
        { id: '2', name: 'Shipped', statusCategoryKey: 'done' },
    ]);
    assert.deepEqual(index, { 'in progress': 'indeterminate', shipped: 'done' });
});

test('buildStatusCategoryIndex: a missing, empty or malformed catalog is an empty index', async () => {
    const { buildStatusCategoryIndex } = await loadModule();
    assert.deepEqual(buildStatusCategoryIndex(null), {});
    assert.deepEqual(buildStatusCategoryIndex([]), {});
    assert.deepEqual(buildStatusCategoryIndex([{ id: '1' }, null, { name: '  ' }]), {});
});

test('buildStatusCategoryIndex: the transition catalog marks exactly the three Done statuses', async () => {
    const { buildStatusCategoryIndex } = await loadModule();
    const index = buildStatusCategoryIndex([
        { id: '1', name: 'To Do', statusCategoryKey: 'new' },
        { id: '2', name: 'In Progress', statusCategoryKey: 'indeterminate' },
        { id: '3', name: 'Done', statusCategoryKey: 'done' },
        { id: '4', name: 'Killed', statusCategoryKey: 'done' },
        { id: '5', name: 'Incomplete', statusCategoryKey: 'done' },
    ]);
    const done = Object.keys(index).filter((name) => index[name] === 'done').sort();
    assert.deepEqual(done, ['done', 'incomplete', 'killed']);
});

test('describeStatus: pairs a status name with its category from the index', async () => {
    const { describeStatus, isResolvedStatus } = await loadModule();
    const index = { shipped: 'done', 'in progress': 'indeterminate' };
    assert.deepEqual(describeStatus('Shipped', index), { name: 'Shipped', statusCategoryKey: 'done' });
    assert.deepEqual(describeStatus(' shipped ', index), { name: ' shipped ', statusCategoryKey: 'done' });
    assert.deepEqual(describeStatus('In Progress', index), { name: 'In Progress', statusCategoryKey: 'indeterminate' });
    // Unknown to the catalog: the name arm still decides, so the three literal names never depend
    // on the catalog having loaded.
    assert.deepEqual(describeStatus('Killed', {}), { name: 'Killed', statusCategoryKey: '' });
    assert.equal(isResolvedStatus(describeStatus('Killed', {})), true);
    assert.equal(isResolvedStatus(describeStatus('Shipped', {})), false);
});

test('describeStatus: what the view hands the gate resolves a done-category status by category', async () => {
    const { describeStatus, needsOpenStoryConfirmation } = await loadModule();
    const index = { shipped: 'done' };
    // The exact call the board makes: a name off the target column, a category off the catalog.
    assert.equal(
        needsOpenStoryConfirmation({ status: describeStatus('Shipped', index), progress: { total: 5, done: 2 } }),
        true,
    );
    assert.equal(
        needsOpenStoryConfirmation({ status: describeStatus('Shipped', index), progress: { total: 5, done: 5 } }),
        false,
    );
});

test('isResolvedStatus: every reference status in the done category resolves', async () => {
    const { isResolvedStatus } = await loadModule();
    const { REFERENCE_STATUSES } = await loadFixture();
    const resolved = REFERENCE_STATUSES.filter((status) => isResolvedStatus(status)).map((status) => status.name);
    assert.deepEqual(resolved, ['Done', 'Killed', 'Incomplete']);
});

test('openStoryCount: the open stories already on the card', async () => {
    const { openStoryCount } = await loadModule();
    assert.equal(openStoryCount({ total: 12, done: 7 }), 5);
    assert.equal(openStoryCount({ total: 3, done: 3 }), 0);
    assert.equal(openStoryCount({ total: 0, done: 0 }), 0);
    // Never negative, so a stale done count cannot invert the gate.
    assert.equal(openStoryCount({ total: 2, done: 5 }), 0);
    assert.equal(openStoryCount(null), 0);
});

test('needsOpenStoryConfirmation: only a resolution status with open stories asks', async () => {
    const { needsOpenStoryConfirmation } = await loadModule();
    // Not resolved -> move immediately, however many stories are open.
    assert.equal(needsOpenStoryConfirmation({ status: 'In Progress', progress: { total: 12, done: 0 } }), false);
    // Resolved and every story done -> no confirmation for the correct case.
    assert.equal(needsOpenStoryConfirmation({ status: 'Done', progress: { total: 4, done: 4 } }), false);
    // Resolved with open stories -> one confirmation.
    assert.equal(needsOpenStoryConfirmation({ status: 'Done', progress: { total: 12, done: 7 } }), true);
    assert.equal(needsOpenStoryConfirmation({ status: 'Killed', progress: { total: 1, done: 0 } }), true);
    // The general case travels through the same gate.
    assert.equal(
        needsOpenStoryConfirmation({ status: { name: 'Shipped', statusCategoryKey: 'done' }, progress: { total: 2, done: 1 } }),
        true,
    );
});
