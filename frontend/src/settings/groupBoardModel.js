// The Group Board composer's model. Pure: no React, no DOM, no fetching, no clock. The one
// impurity is `createColumnId`'s default random source, which is injectable so every test is
// deterministic.
//
// Everything here produces data that must satisfy the server-side validator Task 6 shipped
// (backend/services/group_board.py), which runs on every group-config *read*, not only on writes —
// so a shape it rejects is not merely a failed save.
//
// Shapes
//   column   { id, name, colour, star, min, max, statuses: [statusName, ...] }
//   board    { columns: [column, ...] }   — absence is represented by an omitted group `board` key

// §5.8 / D46: a closed enum, duplicated from BOARD_COLUMN_COLOURS in
// backend/services/group_board.py. tests/test_group_board_model.js asserts the two lists are equal
// value for value and in order, because a drift here becomes a silent coercion warning on save.
export const BOARD_COLUMN_COLOURS = [
    '#8c8c8c', // grey — the default for a new column
    '#b37feb', // violet
    '#597ef7', // blue
    '#13c2c2', // teal
    '#52c41a', // green
    '#e8a11d', // amber
    '#ff4d4f', // red
];

export const DEFAULT_COLUMN_COLOUR = BOARD_COLUMN_COLOURS[0];

export const MAX_BOARD_COLUMNS = 12;
export const MAX_COLUMN_NAME_LENGTH = 40;
export const MIN_COLUMN_BOUND = 0;
export const MAX_COLUMN_BOUND = 9999;

const COLUMN_ID_PREFIX = 'col-';
const COLUMN_ID_HEX_LENGTH = 8;
const COLUMN_ID_PATTERN = /^col-[0-9a-f]{8}$/;
const HEX_DIGITS = '0123456789abcdef';

export function isValidColumnId(value) {
    return typeof value === 'string' && COLUMN_ID_PATTERN.test(value);
}

function randomHex(random) {
    let hex = '';
    for (let position = 0; position < COLUMN_ID_HEX_LENGTH; position += 1) {
        // `% 16` clamps a random() of exactly 1 rather than indexing past the alphabet.
        hex += HEX_DIGITS[Math.floor(random() * 16) % 16];
    }
    return hex;
}

function nextHexAfter(hex) {
    const incremented = (parseInt(hex, 16) + 1) >>> 0;
    return incremented.toString(16).padStart(COLUMN_ID_HEX_LENGTH, '0');
}

// A column id is generated once and never reused: `usedIds` must carry every id the session has
// ever issued, including deleted ones, or per-user focus state rebinds to a different column
// (§6.1.2). The bounded random draws cover the real case; the deterministic scan after them
// guarantees termination for a degenerate random source without ever leaving the id format.
export function createColumnId(usedIds = [], random = Math.random) {
    const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
    let hex = randomHex(random);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!used.has(COLUMN_ID_PREFIX + hex)) return COLUMN_ID_PREFIX + hex;
        hex = randomHex(random);
    }
    while (used.has(COLUMN_ID_PREFIX + hex)) {
        hex = nextHexAfter(hex);
    }
    return COLUMN_ID_PREFIX + hex;
}

export function createColumn({ usedIds = [], name = 'New column', random = Math.random } = {}) {
    return {
        id: createColumnId(usedIds, random),
        name,
        colour: DEFAULT_COLUMN_COLOUR,
        star: false,
        min: null,
        max: null,
        statuses: [],
    };
}

/* ── Min / Max numeric grammar (§5.8) ───────────────────────────────────────────────────────── */

const NOT_A_NUMBER_REASON = 'Enter a whole number, or leave it empty for no threshold.';
const OUT_OF_RANGE_REASON = `Enter a whole number between ${MIN_COLUMN_BOUND} and ${MAX_COLUMN_BOUND}, or leave it empty for no threshold.`;

function normalizeBound(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= MIN_COLUMN_BOUND && value <= MAX_COLUMN_BOUND) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseBoundInput(value, null);
        return parsed.ok ? parsed.value : null;
    }
    return null;
}

// Parsed on blur, never on a keystroke: parsing mid-type turns `12` into `1` then `12` and fights
// the caret. `Math.max(0, parseInt(raw, 10) || 0)` — the handler used elsewhere in the app — turns
// `abc` into a silent, meaningful `0` the user never typed, and 0 is a legitimate Min.
export function parseBoundInput(raw, previousValue = null) {
    const trimmed = String(raw ?? '').trim();
    if (trimmed === '') return { value: null, ok: true, reason: '' };
    if (!/^\d+$/.test(trimmed)) {
        return { value: normalizeBound(previousValue), ok: false, reason: NOT_A_NUMBER_REASON };
    }
    const value = Number(trimmed);
    if (value < MIN_COLUMN_BOUND || value > MAX_COLUMN_BOUND) {
        return { value: normalizeBound(previousValue), ok: false, reason: OUT_OF_RANGE_REASON };
    }
    return { value, ok: true, reason: '' };
}

/* ── Column order (D46) — the board's left-to-right reading order, and nothing else stores it ── */

// Insert before the column whose horizontal midpoint the pointer has not yet passed; past the
// last midpoint, append. A pointer exactly on a midpoint counts as having passed it.
export function resolveInsertIndex(midpoints = [], pointerX = 0) {
    for (let index = 0; index < midpoints.length; index += 1) {
        if (pointerX < midpoints[index]) return index;
    }
    return midpoints.length;
}

// `insertIndex` is expressed in the *input* array's coordinates: the slot the column is inserted
// before, `columns.length` to append. Returns the new array and the moved column's new index, so
// the caller can keep focus on its handle.
export function moveColumn(columns = [], fromIndex, insertIndex) {
    if (fromIndex < 0 || fromIndex >= columns.length) return { columns: columns.slice(), index: fromIndex };
    const next = columns.slice();
    const [moved] = next.splice(fromIndex, 1);
    const target = Math.max(0, Math.min(next.length, insertIndex > fromIndex ? insertIndex - 1 : insertIndex));
    next.splice(target, 0, moved);
    return { columns: next, index: target };
}

// The Alt+←/Alt+→ path. Clamps at both ends rather than wrapping.
export function shiftColumn(columns = [], index, delta) {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return { columns: columns.slice(), index };
    return moveColumn(columns, index, delta > 0 ? target + 1 : target);
}

export function describeColumnMove(name, index, total) {
    return `${name} moved to position ${index + 1} of ${total}`;
}

/* ── Status assignment (D38) — assigning moves, it never copies ─────────────────────────────── */

// Every status the target column does not already hold: the orphans first, labelled "not in a
// column", then the ones sitting elsewhere, labelled "from <column>". Restricting the list to
// orphans would leave the control dead in the reference configuration, where all twelve statuses
// are already mapped.
export function buildStatusPickerRows({ columns = [], columnId = null, statuses = [] } = {}) {
    const target = columns.find((column) => column.id === columnId);
    const held = new Set(target ? target.statuses : []);
    const owners = new Map();
    columns.forEach((column) => {
        if (column.id === columnId) return;
        column.statuses.forEach((status) => owners.set(status, column));
    });

    const orphans = statuses
        .filter((status) => !held.has(status) && !owners.has(status))
        .map((status) => ({ status, fromColumnId: null, fromColumnName: null }));

    const elsewhere = columns
        .filter((column) => column.id !== columnId)
        .flatMap((column) => column.statuses
            .filter((status) => !held.has(status))
            .map((status) => ({ status, fromColumnId: column.id, fromColumnName: column.name })));

    return [...orphans, ...elsewhere];
}

export function assignStatusToColumn(columns = [], status, columnId) {
    return columns.map((column) => {
        const without = column.statuses.filter((held) => held !== status);
        if (column.id !== columnId) return { ...column, statuses: without };
        return { ...column, statuses: [...without, status] };
    });
}

export function removeStatusFromColumns(columns = [], status) {
    return columns.map((column) => ({ ...column, statuses: column.statuses.filter((held) => held !== status) }));
}

export function setStarredColumn(columns = [], columnId) {
    const wasStarred = columns.some((column) => column.id === columnId && column.star);
    return columns.map((column) => ({ ...column, star: !wasStarred && column.id === columnId }));
}

export function unmappedStatuses(statuses = [], columns = []) {
    const mapped = new Set(columns.flatMap((column) => column.statuses));
    return statuses.filter((status) => !mapped.has(status));
}

// A saved status that no longer exists on the board is retained verbatim and flagged, never
// blocking (§5.6). An unavailable catalog judges nothing rather than flagging everything.
export function staleColumnStatuses(columns = [], liveStatuses = null) {
    if (!Array.isArray(liveStatuses) || liveStatuses.length === 0) return [];
    const live = new Set(liveStatuses);
    const stale = [];
    columns.forEach((column) => {
        column.statuses.forEach((status) => {
            if (!live.has(status) && !stale.includes(status)) stale.push(status);
        });
    });
    return stale;
}

/* ── Counts and breaches — a fact about the work, never a blocker (D24) ─────────────────────── */

export function columnEpicCount(column, epicsByStatus = {}) {
    return column.statuses.reduce((total, status) => total + Number(epicsByStatus[status] || 0), 0);
}

export function describeBreach(column, epicCount) {
    if (!column.statuses.length) return null;
    if (column.max != null && epicCount > column.max) {
        return { dir: 'over', by: epicCount - column.max, limit: column.max };
    }
    if (column.min != null && epicCount < column.min) {
        return { dir: 'under', by: column.min - epicCount, limit: column.min };
    }
    return null;
}

/* ── Validation — the blocking half of the two severities ───────────────────────────────────── */

function columnLabel(column, index) {
    const name = String(column.name || '').trim();
    return name ? `“${name}”` : `the column at position ${index + 1}`;
}

// Mirrors every §5.6 rule the composer can reach, either by editing or by loading a stored board.
// It deliberately validates the raw draft: repairing ids or member shapes first would hide the
// exact errors that must block Save.
export function validateComposerBoard(columns = []) {
    const errors = [];
    if (!Array.isArray(columns) || columns.length === 0) {
        errors.push('A board needs at least one column.');
        return { errors };
    }

    if (columns.length > MAX_BOARD_COLUMNS) {
        errors.push(`A board can have at most ${MAX_BOARD_COLUMNS} columns.`);
    }

    const seenIds = new Set();
    const seenNames = new Set();
    const statusOwners = new Map();

    columns.forEach((entry, index) => {
        const column = asStoredColumn(entry);
        const label = columnLabel(column, index);
        if (!isValidColumnId(column.id)) {
            errors.push(`${label} needs a valid column id.`);
        }
        if (typeof column.id === 'string') {
            if (seenIds.has(column.id)) errors.push(`${label} repeats another column's id.`);
            else seenIds.add(column.id);
        }
        const name = String(column.name || '').trim();
        if (!name) {
            errors.push(`${label} needs a name.`);
        } else if (name.length > MAX_COLUMN_NAME_LENGTH) {
            errors.push(`${label} has a name longer than ${MAX_COLUMN_NAME_LENGTH} characters.`);
        } else if (seenNames.has(name.toLowerCase())) {
            errors.push(`${label} repeats another column's name.`);
        } else {
            seenNames.add(name.toLowerCase());
        }

        const statuses = Array.isArray(column.statuses)
            ? column.statuses.filter((status) => typeof status === 'string')
            : [];
        if (!statuses.length) {
            errors.push(`${label} has no statuses. Add a status or delete the column.`);
        }

        if (column.min != null && column.max != null && column.min > column.max) {
            errors.push(`${label} has a min above its max.`);
        }

        statuses.forEach((status) => {
            const owner = statusOwners.get(status);
            if (owner) {
                errors.push(`“${status}” is in both ${owner} and ${label}. A status belongs to one column.`);
            } else {
                statusOwners.set(status, label);
            }
        });
    });

    if (columns.filter((entry) => asStoredColumn(entry).star).length > 1) {
        errors.push('Only one column can be kept open.');
    }

    return { errors };
}

// Dashboard's unified Save validates only groups that actually carry a board key. That preserves
// the legal legacy/unconfigured state while ensuring a present empty or malformed imported draft
// reaches the same validator as the composer, without an id-repair pass first.
export function validatePresentGroupBoards(groups = []) {
    if (!Array.isArray(groups)) return [];
    const errors = [];
    groups.forEach((group) => {
        if (!group || typeof group !== 'object' || !Object.prototype.hasOwnProperty.call(group, 'board')) return;
        const groupName = String(group.name || group.id || 'Group').trim();
        validateComposerBoard(group.board?.columns).errors
            .forEach((message) => errors.push(`${groupName}: ${message}`));
    });
    return errors;
}

/* ── Storage ────────────────────────────────────────────────────────────────────────────────── */

function coerceColour(value) {
    return BOARD_COLUMN_COLOURS.includes(value) ? value : DEFAULT_COLUMN_COLOUR;
}

export function toStoredBoard(columns = []) {
    return {
        columns: columns.map((column) => ({
            id: column.id,
            name: String(column.name || '').trim(),
            statuses: column.statuses.slice(),
            colour: coerceColour(column.colour),
            star: Boolean(column.star),
            min: normalizeBound(column.min),
            max: normalizeBound(column.max),
        })),
    };
}

// An imported/stored column can be any shape valid JSON allows — `null`, a primitive, an array,
// or an object with wrong-typed fields — not only a well-formed `{ id, name, ... }` record. Falls
// back to `{}` (every field below already has its own default) so a garbage element becomes a
// blank column instead of a thrown TypeError on `.id`/`.statuses`/etc.
function asStoredColumn(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function fromStoredBoard(board, { random = Math.random } = {}) {
    const stored = Array.isArray(board?.columns) ? board.columns : [];
    const usedIds = new Set(stored.map((entry) => asStoredColumn(entry).id).filter(isValidColumnId));
    return stored.map((entry) => {
        const column = asStoredColumn(entry);
        const id = isValidColumnId(column.id) ? column.id : createColumnId(usedIds, random);
        usedIds.add(id);
        return {
            id,
            name: String(column.name || ''),
            colour: coerceColour(column.colour),
            star: Boolean(column.star),
            min: normalizeBound(column.min),
            max: normalizeBound(column.max),
            // Filtered to strings, not merely sliced: a non-string entry (an object, in
            // particular) reaches <StatusPill label={status}> unchanged and React throws
            // rendering it as a child, one hop past what this guard alone can stop at.
            statuses: Array.isArray(column.statuses) ? column.statuses.filter((status) => typeof status === 'string') : [],
        };
    });
}
