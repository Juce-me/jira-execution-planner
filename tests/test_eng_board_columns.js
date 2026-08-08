const test = require('node:test');
const assert = require('node:assert/strict');

// engBoardColumns.js is the board's pure half (§6.1, §6.1.2, D11, D43): status -> column mapping,
// the name-based default the composer's *Reset to default columns* also uses, the priority
// sort, and the one function that may choose focus. No React, no DOM — the rules are asserted here
// and the view only renders them.

async function loadModule() {
    return import('../frontend/src/eng/engBoardColumns.js');
}

async function loadFixture() {
    return import('./fixtures/groupBoardReference.mjs');
}

const COLUMN_ID_PATTERN = /^col-[0-9a-f]{8}$/;

// Deterministic id source: createColumnId draws 8 hex digits per id, so a cycling sequence gives
// stable ids without pinning the implementation to a particular draw count.
function sequenceRandom(values) {
    let index = 0;
    return () => {
        const value = values[index % values.length];
        index += 1;
        return value;
    };
}

function column(spec, index = 0) {
    return {
        id: spec.id || `col-1000000${index}`,
        name: spec.name || `Column ${index + 1}`,
        colour: spec.colour || '#8c8c8c',
        star: Boolean(spec.star),
        min: spec.min ?? null,
        max: spec.max ?? null,
        statuses: (spec.statuses || []).slice(),
    };
}

function columns(...specs) {
    return specs.map((spec, index) => column(spec, index));
}

// The shape dashboard.jsx's groupTasksByEpic produces: { epic, key, tasks, storyPoints }.
function epicGroup(key, { status = 'To Do', priority = null, storyPoints = 0, epic } = {}) {
    if (epic === null) return { key, epic: null, tasks: [], storyPoints };
    return {
        key,
        epic: { key, summary: `${key} summary`, status, priority, ...(epic || {}) },
        tasks: [],
        storyPoints,
    };
}

function ids(list) {
    return list.map((entry) => entry.id);
}

/* ── The name-based default (§6.1, §5.5 fixture 2) ─────────────────────────────────────────── */

test('deriveDefaultBoardColumns produces §5.5 second fixture exactly', async () => {
    const { deriveDefaultBoardColumns } = await loadModule();
    const { REFERENCE_STATUSES, REFERENCE_DEFAULT_COLUMNS } = await loadFixture();

    const derived = deriveDefaultBoardColumns(REFERENCE_STATUSES, { random: sequenceRandom([0.1, 0.2, 0.3]) });

    assert.equal(derived.length, REFERENCE_DEFAULT_COLUMNS.length);
    derived.forEach((got, index) => {
        const want = REFERENCE_DEFAULT_COLUMNS[index];
        assert.equal(got.name, want.name);
        assert.equal(got.colour, want.colour);
        assert.equal(got.star, want.star);
        assert.equal(got.min, want.min);
        assert.equal(got.max, want.max);
        assert.deepEqual(got.statuses, want.statuses);
        assert.match(got.id, COLUMN_ID_PATTERN);
    });
});

test('deriveDefaultBoardColumns generates unique ids and never reuses one already issued', async () => {
    const { deriveDefaultBoardColumns } = await loadModule();
    const { REFERENCE_STATUSES } = await loadFixture();

    // A degenerate random source would draw the same hex every time; the id generator must still
    // hand out three distinct ids, none of them one the session has already issued (§5.6).
    const derived = deriveDefaultBoardColumns(REFERENCE_STATUSES, {
        usedIds: ['col-aaaaaaaa'],
        random: () => 0.65625,
    });
    const seen = new Set(ids(derived));
    assert.equal(seen.size, 3);
    assert.ok(!seen.has('col-aaaaaaaa'));
    derived.forEach((entry) => assert.match(entry.id, COLUMN_ID_PATTERN));
});

test('deriveDefaultBoardColumns ignores category changes and sends non-phase names to To Do', async () => {
    const { deriveDefaultBoardColumns } = await loadModule();
    const statuses = [
        { name: 'Analysis', statusCategoryKey: 'done' },
        { name: 'Accepted', statusCategoryKey: 'new' },
        { name: 'In Progress', statusCategoryKey: 'new' },
        { name: 'Release', statusCategoryKey: 'done' },
        { name: 'Done', statusCategoryKey: 'indeterminate' },
    ];
    const changedCategories = statuses.map((status) => ({
        ...status,
        statusCategoryKey: status.statusCategoryKey === 'done' ? 'new' : 'done',
    }));

    const derived = deriveDefaultBoardColumns(statuses);
    const changed = deriveDefaultBoardColumns(changedCategories);

    assert.deepEqual(derived.map(({ id, ...column }) => column), changed.map(({ id, ...column }) => column));
    assert.deepEqual(derived.map((entry) => entry.statuses), [
        ['Analysis', 'Accepted', 'Release'],
        ['In Progress'],
        ['Done'],
    ]);
});

test('deriveDefaultBoardColumns trims names, deduplicates case-insensitively, and omits empty phases', async () => {
    const { deriveDefaultBoardColumns } = await loadModule();
    const derived = deriveDefaultBoardColumns([
        { name: ' Analysis ' },
        { name: 'analysis' },
        { name: '' },
        { name: '   ' },
    ]);

    assert.deepEqual(derived.map((entry) => entry.name), ['To Do']);
    assert.deepEqual(derived[0].statuses, ['Analysis']);
});

test('the two §5.5 fixtures are interchangeable: same twelve statuses, different grouping', async () => {
    const { deriveDefaultBoardColumns } = await loadModule();
    const { REFERENCE_STATUSES, REFERENCE_STATUS_NAMES, REFERENCE_COLUMNS } = await loadFixture();

    const derivedStatuses = deriveDefaultBoardColumns(REFERENCE_STATUSES).flatMap((entry) => entry.statuses);
    const composedStatuses = REFERENCE_COLUMNS.flatMap((entry) => entry.statuses);

    assert.equal(derivedStatuses.length, 12);
    assert.equal(composedStatuses.length, 12);
    assert.deepEqual([...derivedStatuses].sort(), [...REFERENCE_STATUS_NAMES].sort());
    assert.deepEqual([...derivedStatuses].sort(), [...composedStatuses].sort());
    // Different grouping, or the fixture would not be testing anything.
    assert.notDeepEqual(
        deriveDefaultBoardColumns(REFERENCE_STATUSES).map((entry) => entry.statuses),
        REFERENCE_COLUMNS.map((entry) => entry.statuses),
    );
});

/* ── Priority sort (D11) ────────────────────────────────────────────────────────────────────── */

test('sortEpicGroupsByPriority orders by PRIORITY_AXIS index, highest first', async () => {
    const { sortEpicGroupsByPriority } = await loadModule();

    const sorted = sortEpicGroupsByPriority([
        epicGroup('E-TRIVIAL', { priority: 'Trivial' }),
        epicGroup('E-MAJOR', { priority: 'Major' }),
        epicGroup('E-BLOCKER', { priority: 'Blocker' }),
        epicGroup('E-LOW', { priority: 'Low' }),
        epicGroup('E-CRITICAL', { priority: 'Critical' }),
        epicGroup('E-MINOR', { priority: 'Minor' }),
    ]);

    assert.deepEqual(sorted.map((entry) => entry.key), [
        'E-BLOCKER', 'E-CRITICAL', 'E-MAJOR', 'E-MINOR', 'E-LOW', 'E-TRIVIAL',
    ]);
});

test('sortEpicGroupsByPriority ranks Jira priority aliases without changing their raw labels', async () => {
    const { epicPriorityName, sortEpicGroupsByPriority } = await loadModule();
    const groups = [
        epicGroup('E-LOWEST', { priority: { name: 'Lowest' } }),
        epicGroup('E-MEDIUM', { priority: 'Medium' }),
        epicGroup('E-HIGH', { priority: 'High' }),
        epicGroup('E-HIGHEST', { priority: { name: 'Highest' } }),
    ];

    assert.deepEqual(sortEpicGroupsByPriority(groups).map((entry) => entry.key), [
        'E-HIGHEST', 'E-HIGH', 'E-MEDIUM', 'E-LOWEST',
    ]);
    assert.deepEqual(groups.map((entry) => epicPriorityName(entry.epic)), [
        'Lowest', 'Medium', 'High', 'Highest',
    ]);
});

test('sortEpicGroupsByPriority breaks ties by key and sorts unknown priority last', async () => {
    const { sortEpicGroupsByPriority } = await loadModule();

    const sorted = sortEpicGroupsByPriority([
        epicGroup('PLAT-9', { priority: null }),
        epicGroup('PLAT-3', { priority: 'Major' }),
        epicGroup('PLAT-1', { priority: 'Major' }),
        epicGroup('PLAT-7', { priority: 'Nonsense' }),
        epicGroup('PLAT-2', { priority: 'Blocker' }),
    ]);

    assert.deepEqual(sorted.map((entry) => entry.key), ['PLAT-2', 'PLAT-1', 'PLAT-3', 'PLAT-7', 'PLAT-9']);
});

test('sortEpicGroupsByPriority does not mutate its input', async () => {
    const { sortEpicGroupsByPriority } = await loadModule();
    const input = [epicGroup('B', { priority: 'Trivial' }), epicGroup('A', { priority: 'Blocker' })];
    sortEpicGroupsByPriority(input);
    assert.deepEqual(input.map((entry) => entry.key), ['B', 'A']);
});

/* ── buildBoardColumns: status -> column, unmapped, stale, counts, breach ───────────────────── */

test('buildBoardColumns places each epic in the column holding its status', async () => {
    const { buildBoardColumns } = await loadModule();
    const board = columns(
        { id: 'col-00000001', name: 'To do', statuses: ['To Do'] },
        { id: 'col-00000002', name: 'In progress', statuses: ['In Progress', 'Release'] },
    );

    const built = buildBoardColumns({
        columns: board,
        epicGroups: [
            epicGroup('A-1', { status: 'To Do', storyPoints: 3 }),
            epicGroup('A-2', { status: 'Release', storyPoints: 5 }),
            epicGroup('A-3', { status: 'In Progress', storyPoints: 8 }),
        ],
    });

    assert.deepEqual(built.map((entry) => entry.id), ['col-00000001', 'col-00000002']);
    assert.deepEqual(built[0].epicGroups.map((entry) => entry.key), ['A-1']);
    assert.deepEqual(built[1].epicGroups.map((entry) => entry.key).sort(), ['A-2', 'A-3']);
    assert.equal(built[0].epicCount, 1);
    assert.equal(built[1].epicCount, 2);
    assert.equal(built[0].storyPoints, 3);
    assert.equal(built[1].storyPoints, 13);
});

test('buildBoardColumns reads both epic status shapes through epicStatusName', async () => {
    const { buildBoardColumns } = await loadModule();
    const board = columns({ id: 'col-00000001', name: 'To do', statuses: ['To Do'] });

    const built = buildBoardColumns({
        columns: board,
        epicGroups: [
            epicGroup('FLAT-1', { status: 'To Do' }),
            { key: 'NESTED-1', epic: { key: 'NESTED-1', status: { name: 'To Do' }, priority: 'Major' }, tasks: [], storyPoints: 0 },
        ],
    });

    assert.equal(built[0].epicCount, 2);
});

test('buildBoardColumns collects unmapped statuses into a synthetic Unmapped column, last', async () => {
    const { buildBoardColumns, UNMAPPED_COLUMN_ID, UNMAPPED_COLUMN_NAME } = await loadModule();
    const board = columns({ id: 'col-00000001', name: 'To do', statuses: ['To Do'] });

    const built = buildBoardColumns({
        columns: board,
        epicGroups: [
            epicGroup('A-1', { status: 'To Do' }),
            epicGroup('A-2', { status: 'Escalated' }),
            epicGroup('A-3', { status: '' }),
        ],
    });

    assert.equal(built.length, 2);
    const unmapped = built[built.length - 1];
    assert.equal(unmapped.id, UNMAPPED_COLUMN_ID);
    assert.equal(unmapped.name, UNMAPPED_COLUMN_NAME);
    assert.equal(unmapped.isUnmapped, true);
    assert.equal(unmapped.epicCount, 2);
    assert.equal(unmapped.star, false);
    assert.equal(unmapped.breach, null);
});

test('buildBoardColumns renders no Unmapped column when every epic status is mapped', async () => {
    const { buildBoardColumns, UNMAPPED_COLUMN_ID } = await loadModule();
    const built = buildBoardColumns({
        columns: columns({ id: 'col-00000001', name: 'To do', statuses: ['To Do'] }),
        epicGroups: [epicGroup('A-1', { status: 'To Do' })],
    });
    assert.deepEqual(built.map((entry) => entry.id), ['col-00000001']);
    assert.ok(!built.some((entry) => entry.id === UNMAPPED_COLUMN_ID));
});

test('buildBoardColumns does not render a column with no statuses', async () => {
    const { buildBoardColumns } = await loadModule();
    const built = buildBoardColumns({
        columns: columns(
            { id: 'col-00000001', name: 'To do', statuses: ['To Do'] },
            { id: 'col-00000002', name: 'Empty', statuses: [] },
        ),
        epicGroups: [epicGroup('A-1', { status: 'To Do' })],
    });
    assert.deepEqual(built.map((entry) => entry.id), ['col-00000001']);
});

test('buildBoardColumns keeps a stale status harmless: it matches nothing and does not throw', async () => {
    const { buildBoardColumns } = await loadModule();
    const built = buildBoardColumns({
        columns: columns({ id: 'col-00000001', name: 'Old', statuses: ['Retired Status', 'To Do'] }),
        epicGroups: [epicGroup('A-1', { status: 'To Do' })],
    });
    assert.equal(built.length, 1);
    assert.equal(built[0].epicCount, 1);
    assert.deepEqual(built[0].statuses, ['Retired Status', 'To Do']);
});

test('buildBoardColumns skips the NO_EPIC bucket, which is stories without an epic', async () => {
    const { buildBoardColumns, UNMAPPED_COLUMN_ID } = await loadModule();
    const built = buildBoardColumns({
        columns: columns({ id: 'col-00000001', name: 'To do', statuses: ['To Do'] }),
        epicGroups: [epicGroup('A-1', { status: 'To Do' }), epicGroup('NO_EPIC', { epic: null })],
    });
    assert.equal(built.length, 1);
    assert.equal(built[0].epicCount, 1);
    assert.ok(!built.some((entry) => entry.id === UNMAPPED_COLUMN_ID));
});

test('buildBoardColumns sorts each column by priority, highest first', async () => {
    const { buildBoardColumns } = await loadModule();
    const built = buildBoardColumns({
        columns: columns({ id: 'col-00000001', name: 'To do', statuses: ['To Do'] }),
        epicGroups: [
            epicGroup('A-1', { status: 'To Do', priority: 'Low' }),
            epicGroup('A-2', { status: 'To Do', priority: 'Blocker' }),
            epicGroup('A-3', { status: 'To Do', priority: 'Major' }),
        ],
    });
    assert.deepEqual(built[0].epicGroups.map((entry) => entry.key), ['A-2', 'A-3', 'A-1']);
});

test('buildBoardColumns reports a breach in both directions and never for a red accent alone', async () => {
    const { buildBoardColumns } = await loadModule();
    const built = buildBoardColumns({
        columns: columns(
            { id: 'col-00000001', name: 'Analysis', statuses: ['Analysis'], min: 3 },
            { id: 'col-00000002', name: 'In progress', statuses: ['In Progress'], max: 1 },
            { id: 'col-00000003', name: 'External block', colour: '#ff4d4f', statuses: ['Blocked'], max: 5 },
        ),
        epicGroups: [
            epicGroup('A-1', { status: 'Analysis' }),
            epicGroup('B-1', { status: 'In Progress' }),
            epicGroup('B-2', { status: 'In Progress' }),
            epicGroup('C-1', { status: 'Blocked' }),
        ],
    });

    assert.deepEqual(built[0].breach, { dir: 'under', by: 2, limit: 3 });
    assert.deepEqual(built[1].breach, { dir: 'over', by: 1, limit: 1 });
    assert.equal(built[2].breach, null);
    assert.equal(built[2].colour, '#ff4d4f');
});

// §6.1: a group that has never been configured is NOT the same thing as a configured board that
// forgot a status. "Unmapped" says the latter, so a first-run board must not borrow the word.
test('buildBoardColumns with no configured columns renders a first-run column, not Unmapped', async () => {
    const { buildBoardColumns, UNCONFIGURED_COLUMN_ID, UNCONFIGURED_COLUMN_NAME, UNMAPPED_COLUMN_ID } = await loadModule();
    const built = buildBoardColumns({ columns: [], epicGroups: [epicGroup('A-1', { status: 'To Do' })] });
    assert.deepEqual(built.map((entry) => entry.id), [UNCONFIGURED_COLUMN_ID]);
    assert.equal(built[0].name, UNCONFIGURED_COLUMN_NAME);
    assert.notEqual(built[0].name, 'Unmapped');
    assert.notEqual(built[0].id, UNMAPPED_COLUMN_ID);
    assert.equal(built[0].isUnconfigured, true);
    assert.equal(built[0].isUnmapped, false);
    assert.equal(built[0].epicCount, 1);
    assert.equal(built[0].breach, null);
});

test('the first-run column still renders when the group has no epics either', async () => {
    const { buildBoardColumns, UNCONFIGURED_COLUMN_ID } = await loadModule();
    const built = buildBoardColumns({ columns: [], epicGroups: [] });
    assert.deepEqual(built.map((entry) => entry.id), [UNCONFIGURED_COLUMN_ID]);
    assert.equal(built[0].epicCount, 0);
});

// A board whose every column lost its statuses is unusable in exactly the same way, and the fix is
// the same one: open the composer.
test('a board whose columns all have no statuses reads as unconfigured, not as an empty board', async () => {
    const { buildBoardColumns, UNCONFIGURED_COLUMN_ID } = await loadModule();
    const built = buildBoardColumns({
        columns: columns({ id: 'col-00000001', name: 'Ghost', statuses: [] }),
        epicGroups: [epicGroup('A-1', { status: 'To Do' })],
    });
    assert.deepEqual(built.map((entry) => entry.id), [UNCONFIGURED_COLUMN_ID]);
});

test('a configured board still calls its leftovers Unmapped, not first-run', async () => {
    const { buildBoardColumns, UNMAPPED_COLUMN_ID, UNCONFIGURED_COLUMN_ID } = await loadModule();
    const built = buildBoardColumns({
        columns: columns({ id: 'col-00000001', name: 'To do', statuses: ['To Do'] }),
        epicGroups: [epicGroup('A-1', { status: 'To Do' }), epicGroup('A-2', { status: 'Escalated' })],
    });
    assert.deepEqual(built.map((entry) => entry.id), ['col-00000001', UNMAPPED_COLUMN_ID]);
    assert.equal(built[1].isUnmapped, true);
    assert.equal(built[1].isUnconfigured, false);
    assert.ok(!built.some((entry) => entry.id === UNCONFIGURED_COLUMN_ID));
});

test('buildBoardColumns renders configured columns at zero when there are no epics at all', async () => {
    const { buildBoardColumns } = await loadModule();
    const built = buildBoardColumns({
        columns: columns(
            { id: 'col-00000001', name: 'To do', statuses: ['To Do'] },
            { id: 'col-00000002', name: 'Done', statuses: ['Done'] },
        ),
        epicGroups: [],
    });
    assert.deepEqual(built.map((entry) => entry.epicCount), [0, 0]);
});

test('boardScaleMax is the largest column epic count, and never zero', async () => {
    const { boardScaleMax, buildBoardColumns } = await loadModule();
    const built = buildBoardColumns({
        columns: columns(
            { id: 'col-00000001', name: 'To do', statuses: ['To Do'] },
            { id: 'col-00000002', name: 'Done', statuses: ['Done'] },
        ),
        epicGroups: [
            epicGroup('A-1', { status: 'To Do' }),
            epicGroup('A-2', { status: 'To Do' }),
            epicGroup('B-1', { status: 'Done' }),
        ],
    });
    assert.equal(boardScaleMax(built), 2);
    assert.equal(boardScaleMax([]), 1);
});

test('the reference configuration builds seven columns and the §5.5 counts', async () => {
    const { buildBoardColumns, boardScaleMax } = await loadModule();
    const { REFERENCE_COLUMNS, REFERENCE_EPICS_BY_STATUS } = await loadFixture();

    // One synthetic epic per counted epic, so the column totals are derived, not asserted twice.
    const epicGroups = [];
    Object.entries(REFERENCE_EPICS_BY_STATUS).forEach(([status, count]) => {
        for (let index = 0; index < count; index += 1) {
            epicGroups.push(epicGroup(`${status.replace(/\s+/g, '')}-${index}`, { status, priority: 'Major' }));
        }
    });

    const built = buildBoardColumns({ columns: REFERENCE_COLUMNS, epicGroups });
    assert.deepEqual(built.map((entry) => entry.epicCount), [18, 11, 9, 7, 2, 26, 14]);
    assert.equal(built.reduce((total, entry) => total + entry.epicCount, 0), 87);
    assert.equal(boardScaleMax(built), 26);
    assert.deepEqual(built.filter((entry) => entry.breach).map((entry) => [entry.name, entry.breach.dir]), [
        ['Analysis', 'under'],
        ['In progress', 'over'],
    ]);
});

/* ── resolveFocus: the §6.1.2 table, row by row (D43) ───────────────────────────────────────── */

const FOCUS_BOARD = () => [
    { id: 'col-00000001', name: 'To do', epicCount: 0 },
    { id: 'col-00000002', name: 'Analysis', epicCount: 4 },
    { id: 'col-00000003', name: 'In progress', epicCount: 9 },
];

test('resolveFocus: initial load with one starred column focuses the starred one', async () => {
    const { resolveFocus } = await loadModule();
    assert.equal(resolveFocus(FOCUS_BOARD(), { preferred: null, starredId: 'col-00000003' }), 'col-00000003');
});

test('resolveFocus: initial load with zero starred focuses the first column holding work', async () => {
    const { resolveFocus } = await loadModule();
    assert.equal(resolveFocus(FOCUS_BOARD(), { preferred: null, starredId: null }), 'col-00000002');
});

test('resolveFocus: every column empty still focuses exactly one — the first', async () => {
    const { resolveFocus } = await loadModule();
    const empty = FOCUS_BOARD().map((entry) => ({ ...entry, epicCount: 0 }));
    assert.equal(resolveFocus(empty, { preferred: null, starredId: null }), 'col-00000001');
});

test('resolveFocus: a live preferred id wins over the star', async () => {
    const { resolveFocus } = await loadModule();
    assert.equal(
        resolveFocus(FOCUS_BOARD(), { preferred: 'col-00000001', starredId: 'col-00000003' }),
        'col-00000001',
    );
});

test('resolveFocus: unstarring the focused column leaves it focused, merely unpinned', async () => {
    const { resolveFocus } = await loadModule();
    assert.equal(resolveFocus(FOCUS_BOARD(), { preferred: 'col-00000003', starredId: null }), 'col-00000003');
});

test('resolveFocus: renaming the focused column keeps focus, because id did not change', async () => {
    const { resolveFocus } = await loadModule();
    const renamed = FOCUS_BOARD().map((entry) => (
        entry.id === 'col-00000002' ? { ...entry, name: 'Discovery' } : entry
    ));
    assert.equal(resolveFocus(renamed, { preferred: 'col-00000002', starredId: null }), 'col-00000002');
});

test('resolveFocus: a stale preferred id never survives — it falls through to the star', async () => {
    const { resolveFocus } = await loadModule();
    const afterDelete = FOCUS_BOARD().filter((entry) => entry.id !== 'col-00000002');
    assert.equal(
        resolveFocus(afterDelete, { preferred: 'col-00000002', starredId: 'col-00000003' }),
        'col-00000003',
    );
});

test('resolveFocus: a stale star is ignored the same way a stale preferred id is', async () => {
    const { resolveFocus } = await loadModule();
    const afterDelete = FOCUS_BOARD().filter((entry) => entry.id !== 'col-00000003');
    assert.equal(
        resolveFocus(afterDelete, { preferred: 'col-00000003', starredId: 'col-00000003' }),
        'col-00000002',
    );
});

test('resolveFocus: zero columns returns null rather than throwing', async () => {
    const { resolveFocus } = await loadModule();
    assert.equal(resolveFocus([], { preferred: 'col-00000001', starredId: 'col-00000002' }), null);
});

test('resolveFocus: called with no options at all still returns a live id', async () => {
    const { resolveFocus } = await loadModule();
    assert.equal(resolveFocus(FOCUS_BOARD()), 'col-00000002');
});

/* ── Folding the focused column transfers focus, never clears it ────────────────────────────── */

test('resolveFocusAfterFold: transfers to the starred column when there is one', async () => {
    const { resolveFocusAfterFold } = await loadModule();
    assert.equal(
        resolveFocusAfterFold(FOCUS_BOARD(), { columnId: 'col-00000002', starredId: 'col-00000003' }),
        'col-00000003',
    );
});

test('resolveFocusAfterFold: with no star, focus falls to the left neighbour', async () => {
    const { resolveFocusAfterFold } = await loadModule();
    assert.equal(
        resolveFocusAfterFold(FOCUS_BOARD(), { columnId: 'col-00000003', starredId: null }),
        'col-00000002',
    );
});

test('resolveFocusAfterFold: folding the first column falls right, there is no left one', async () => {
    const { resolveFocusAfterFold } = await loadModule();
    assert.equal(
        resolveFocusAfterFold(FOCUS_BOARD(), { columnId: 'col-00000001', starredId: null }),
        'col-00000002',
    );
});

test('resolveFocusAfterFold: a single column stays focused rather than leaving nothing', async () => {
    const { resolveFocusAfterFold } = await loadModule();
    const only = [{ id: 'col-00000001', name: 'Only', epicCount: 0 }];
    assert.equal(resolveFocusAfterFold(only, { columnId: 'col-00000001', starredId: null }), 'col-00000001');
});

test('resolveFocusAfterFold: eight consecutive folds never yield nothing', async () => {
    const { resolveFocusAfterFold, resolveFocus } = await loadModule();
    const board = FOCUS_BOARD();
    let focused = resolveFocus(board, { preferred: null, starredId: null });
    for (let step = 0; step < 8; step += 1) {
        focused = resolveFocusAfterFold(board, { columnId: focused, starredId: null });
        assert.ok(board.some((entry) => entry.id === focused), `fold ${step + 1} left focus on ${focused}`);
    }
});
