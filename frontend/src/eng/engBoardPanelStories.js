// The epic detail panel's story ordering (§6.3, D12). Pure — no React, no DOM — so the three
// orders are unit-testable without mounting the panel, and so EngBoardEpicPanel.jsx (a .jsx file
// the plain-Node test runner cannot import) holds none of the rules.
//
// D12 is the constraint that shapes this file: "Sorting changes row order only — never the row
// layout." Everything here returns a reordered array; nothing here knows a class name.

// §6.3: status order follows the board's column order left to right, so Done falls last. That is
// the BOARD's order, not alphabetical and not StatusTransitionMenu's own STATUS_SORT_RANK — the
// columns are the thing the user is looking at.
export function buildPanelStatusOrder(columns = []) {
    const order = new Map();
    (columns || []).forEach((column) => {
        (column?.statuses || []).forEach((status) => {
            const name = String(status || '').trim().toLowerCase();
            if (name && !order.has(name)) order.set(name, order.size);
        });
    });
    return order;
}

export const PANEL_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'assignee-status', label: 'Assignee, then status' }),
    Object.freeze({ value: 'status', label: 'Status' }),
    Object.freeze({ value: 'assignee', label: 'Assignee' }),
]);

export const DEFAULT_PANEL_SORT = PANEL_SORT_OPTIONS[0].value;

export function panelSortLabel(value) {
    return (PANEL_SORT_OPTIONS.find((option) => option.value === value) || PANEL_SORT_OPTIONS[0]).label;
}

// A status no column claims sorts after every mapped one rather than arbitrarily, mirroring how
// engBoardColumns.js ranks an unrecognised priority one past the axis.
function statusRank(task, statusOrder) {
    const name = String(task?.fields?.status?.name || '').trim().toLowerCase();
    const rank = statusOrder.get(name);
    return rank === undefined ? statusOrder.size : rank;
}

// Unassigned sorts last, not under "U": an empty owner is the end of the list, not a name.
function assigneeKey(task) {
    return String(task?.fields?.assignee?.displayName || '').trim();
}

function compareAssignee(a, b) {
    const nameA = assigneeKey(a);
    const nameB = assigneeKey(b);
    if (!nameA !== !nameB) return nameA ? -1 : 1;
    return nameA.localeCompare(nameB);
}

const compareKey = (a, b) => String(a?.key || '').localeCompare(String(b?.key || ''));

// Every order ends in the issue key, so equal rows cannot reshuffle between repaints.
const COMPARATORS = {
    status: (statusOrder) => (a, b) => (statusRank(a, statusOrder) - statusRank(b, statusOrder)) || compareKey(a, b),
    assignee: () => (a, b) => compareAssignee(a, b) || compareKey(a, b),
    'assignee-status': (statusOrder) => (a, b) => compareAssignee(a, b)
        || (statusRank(a, statusOrder) - statusRank(b, statusOrder))
        || compareKey(a, b),
};

export function sortPanelStories(tasks = [], { sort = DEFAULT_PANEL_SORT, statusOrder = new Map() } = {}) {
    const build = COMPARATORS[sort] || COMPARATORS[DEFAULT_PANEL_SORT];
    return (tasks || []).slice().sort(build(statusOrder));
}
