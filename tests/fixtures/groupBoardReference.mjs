// The §5.5 reference configuration — Northwind over board 1042. Not illustrative: the plan says
// implement against it and assert it, so both the Node unit tests and the Playwright composer
// harness read this one file. ESM so the CJS suites can `await import()` it and esbuild can bundle
// it into the browser harness.
//
// One correction the plan already made and this fixture carries: "In progress" is `#597ef7`, not
// the `#2f80ed` the HTML asset still renders — `#2f80ed` is not in BOARD_COLUMN_COLOURS, so a
// fixture built from the asset would have produced a coercion warning on every save.

export const REFERENCE_BOARD_ID = '1042';

// The board's own status catalog, in the order GET /api/board-config/statuses returns it.
export const REFERENCE_STATUSES = [
    { id: '10000', name: 'To Do' },
    { id: '10001', name: 'Analysis' },
    { id: '10002', name: 'Awaiting Validation' },
    { id: '10003', name: 'Postponed' },
    { id: '10004', name: 'Pending' },
    { id: '10005', name: 'Accepted' },
    { id: '10006', name: 'Blocked' },
    { id: '10007', name: 'In Progress' },
    { id: '10008', name: 'Release' },
    { id: '10009', name: 'Done' },
    { id: '10010', name: 'Killed' },
    { id: '10011', name: 'Incomplete' },
];

export const REFERENCE_STATUS_NAMES = REFERENCE_STATUSES.map((status) => status.name);

// Work items per status on the board, §5.5's parenthesised counts. `Pending` is 0 on purpose: a
// real status with no work is not the same as an unmapped status, and it must still render.
export const REFERENCE_STATUS_WORK_ITEMS = {
    'To Do': 36,
    Analysis: 22,
    'Awaiting Validation': 13,
    Postponed: 6,
    Pending: 0,
    Accepted: 9,
    Blocked: 2,
    'In Progress': 48,
    Release: 1,
    Done: 260,
    Killed: 83,
    Incomplete: 4,
};

// Sprint-scoped epics per status. The composer sums these over each column's statuses, so a
// column's epic count follows a status when it is reassigned instead of being a frozen number.
// The column totals are §5.5's: 18, 11, 9, 7, 2, 26, 14 -> 87, bar scale max 26.
export const REFERENCE_EPICS_BY_STATUS = {
    'To Do': 18,
    Analysis: 11,
    'Awaiting Validation': 6,
    Postponed: 3,
    Pending: 0,
    Accepted: 7,
    Blocked: 2,
    'In Progress': 25,
    Release: 1,
    Done: 10,
    Killed: 3,
    Incomplete: 1,
};

export const REFERENCE_COLUMNS = [
    { id: 'col-1a2b3c4d', name: 'To do', colour: '#8c8c8c', star: false, min: null, max: null, statuses: ['To Do'] },
    { id: 'col-2b3c4d5e', name: 'Analysis', colour: '#b37feb', star: false, min: 15, max: null, statuses: ['Analysis'] },
    {
        id: 'col-3c4d5e6f',
        name: 'Ready to start',
        colour: '#597ef7',
        star: false,
        min: null,
        max: null,
        statuses: ['Awaiting Validation', 'Postponed', 'Pending'],
    },
    { id: 'col-4d5e6f70', name: 'Accepted in Q', colour: '#13c2c2', star: false, min: null, max: 12, statuses: ['Accepted'] },
    { id: 'col-5e6f7081', name: 'External block', colour: '#ff4d4f', star: false, min: null, max: 5, statuses: ['Blocked'] },
    {
        id: 'col-6f708192',
        name: 'In progress',
        colour: '#597ef7',
        star: true,
        min: null,
        max: 20,
        statuses: ['In Progress', 'Release'],
    },
    {
        id: 'col-708192a3',
        name: 'Done',
        colour: '#52c41a',
        star: false,
        min: null,
        max: null,
        statuses: ['Done', 'Killed', 'Incomplete'],
    },
];

export const REFERENCE_BOARD = { columns: REFERENCE_COLUMNS };

// §5.5's SECOND fixture: the default composition when a group has no `board` config, derived from
// status names and produced by the composer's *Reset to default columns*. Same twelve
// statuses as REFERENCE_COLUMNS, grouped by the stable default status-name rules.
//
// Statuses are listed in *catalog* order (the order GET /api/board-config/statuses returns them),
// which is what the derivation preserves. The resulting epic counts are 48 / 25 / 14, totalling
// the same 87 epics as fixture 1.
export const REFERENCE_DEFAULT_COLUMNS = [
    {
        name: 'To Do',
        colour: '#8c8c8c',
        star: false,
        min: null,
        max: null,
        statuses: ['To Do', 'Analysis', 'Awaiting Validation', 'Postponed', 'Pending', 'Accepted', 'Blocked', 'Release'],
    },
    {
        name: 'In Progress',
        colour: '#597ef7',
        star: true,
        min: null,
        max: null,
        statuses: ['In Progress'],
    },
    {
        name: 'Done',
        colour: '#52c41a',
        star: false,
        min: null,
        max: null,
        statuses: ['Done', 'Killed', 'Incomplete'],
    },
];

export function referenceBoard() {
    return { columns: REFERENCE_COLUMNS.map((column) => ({ ...column, statuses: column.statuses.slice() })) };
}

// The 200 body of GET /api/board-config/statuses for this board.
export function referenceStatusesResponse() {
    return {
        boardId: REFERENCE_BOARD_ID,
        projectKey: 'PLAT',
        statuses: REFERENCE_STATUSES.map((status) => ({ ...status })),
    };
}
