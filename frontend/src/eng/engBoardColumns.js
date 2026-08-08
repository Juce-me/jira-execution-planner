// The board's pure half (§6.1, §6.1.2). No React, no DOM, no fetching: status -> column mapping,
// the name-based default, the priority sort, and the single function that may choose focus.
// EngBoardView.jsx renders what this returns and owns nothing else about the rules.
//
// Everything reusable already had a home, so nothing here is a second copy:
//   PRIORITY_AXIS           stats/statsConstants.js  — the one priority ordering (D11)
//   epicStatusName          eng/engTaskUtils.js      — the two-shape epic status read (§4.1)
//   describeBreach          settings/groupBoardModel.js — Min/Max, shared with the composer (D24)
//   createColumnId / colours settings/groupBoardModel.js — the stored column grammar (§5.6)
//
// Column identity is `id`, never `name` (§6.1.2): `board.columns[]` is shared DB-backed config, so
// one user renaming a column must not rebind another user's focus or the stored star.

import { PRIORITY_AXIS } from '../stats/statsConstants.js';
import { getPriorityLabel } from '../stats/statsUtils.js';
import { epicStatusName } from './engTaskUtils.js';
import {
    BOARD_COLUMN_COLOURS,
    DEFAULT_COLUMN_COLOUR,
    createColumnId,
    describeBreach,
} from '../settings/groupBoardModel.js';

// Two synthetic columns, render-time only and never stored, so their ids deliberately do not match
// `^col-[0-9a-f]{8}$` — a stored id could never collide with them.
//
// They are NOT interchangeable (§6.1). "Unmapped" means *your configuration forgot these
// statuses*, which is the wrong thing to tell someone who has not configured anything yet; a group
// with no usable board gets the first-run column instead, and the view offers the composer.
export const UNMAPPED_COLUMN_ID = 'board-unmapped';
export const UNMAPPED_COLUMN_NAME = 'Unmapped';
export const UNCONFIGURED_COLUMN_ID = 'board-unconfigured';
export const UNCONFIGURED_COLUMN_NAME = 'All epics';

// §6.1 / §5.5 fixture 2. The stable name-based three-phase default, in board reading order.
// Colours are BOARD_COLUMN_COLOURS members so a derived board is savable without the validator
// coercing it.
export const DEFAULT_BOARD_COLUMN_TEMPLATES = Object.freeze([
    Object.freeze({ name: 'To Do', colour: DEFAULT_COLUMN_COLOUR, star: false }),
    Object.freeze({ name: 'In Progress', colour: BOARD_COLUMN_COLOURS[2], star: true }),
    Object.freeze({ name: 'Done', colour: BOARD_COLUMN_COLOURS[4], star: false }),
]);

const PRIORITY_RANK = Object.fromEntries(PRIORITY_AXIS.map((name, index) => [name, index]));
// One past the axis, so a present-but-unrecognised priority and a missing one both sort last while
// still being ordered against each other by key rather than arbitrarily.
const UNRANKED_PRIORITY = PRIORITY_AXIS.length;

// Exported (§4.1's two-shape hazard is not unique to sorting): `data.epics` flattens priority to
// a string, the alerts payload keeps `{ name }`, and dashboard.jsx normalizes the same way inline
// at its epic header (`epicOwnPriority`, :12561-12563). EngBoardEpicCard.jsx reuses this rather
// than writing a third copy before handing the value to renderPriorityIcon.
export function epicPriorityName(epic) {
    const priority = epic && epic.priority;
    if (!priority) return '';
    return typeof priority === 'string' ? priority : (priority.name || '');
}

/* ── Name-based default, shared with the composer's Reset to default columns ───────────────── */

// `statuses` is the board status catalog `fetchBoardStatuses` returns (api/boardConfigApi.js):
// rows of `{ id, name }`. The endpoint path itself stays in that api module.
// Returns composer-shaped columns — the same records GroupBoardSettings edits and toStoredBoard
// writes — so the composer's Reset button and a board with no config cannot disagree.
//
// Status order inside a column is catalog order. A phase holding nothing produces no column: an
// empty `statuses` list is a validator error (§5.6), so emitting one would make Reset unsavable.
// Exact `In Progress` maps to In Progress; Done, Killed, and Incomplete map to Done; every other
// real status maps to To Do.
export function deriveDefaultBoardColumns(statuses = [], { usedIds = [], random = Math.random } = {}) {
    const used = usedIds instanceof Set ? new Set(usedIds) : new Set(usedIds);
    const byPhase = new Map(DEFAULT_BOARD_COLUMN_TEMPLATES.map((template) => [template.name, []]));
    const seenNames = new Set();

    statuses.forEach((status) => {
        const name = typeof status === 'string' ? '' : String(status?.name || '').trim();
        const normalized = name.toLowerCase();
        if (!name || seenNames.has(normalized)) return;
        seenNames.add(normalized);
        const phase = normalized === 'in progress'
            ? 'In Progress'
            : (['done', 'killed', 'incomplete'].includes(normalized) ? 'Done' : 'To Do');
        byPhase.get(phase).push(name);
    });

    return DEFAULT_BOARD_COLUMN_TEMPLATES
        .filter((template) => byPhase.get(template.name).length > 0)
        .map((template) => {
            const id = createColumnId(used, random);
            used.add(id);
            return {
                id,
                name: template.name,
                colour: template.colour,
                star: template.star,
                min: null,
                max: null,
                statuses: byPhase.get(template.name).slice(),
            };
        });
}

/* ── Priority sort (D11) ────────────────────────────────────────────────────────────────────── */

// Highest first by PRIORITY_AXIS index, ties broken by epic key so a repaint cannot reshuffle
// equal-priority cards. Returns a new array.
export function sortEpicGroupsByPriority(epicGroups = []) {
    return epicGroups.slice().sort((a, b) => {
        const rankA = PRIORITY_RANK[getPriorityLabel(epicPriorityName(a.epic))] ?? UNRANKED_PRIORITY;
        const rankB = PRIORITY_RANK[getPriorityLabel(epicPriorityName(b.epic))] ?? UNRANKED_PRIORITY;
        if (rankA !== rankB) return rankA - rankB;
        return String(a.key || '').localeCompare(String(b.key || ''));
    });
}

/* ── Columns as rendered ────────────────────────────────────────────────────────────────────── */

function renderColumn(source, epicGroups) {
    const sorted = sortEpicGroupsByPriority(epicGroups);
    const epicCount = sorted.length;
    return {
        id: source.id,
        name: source.name,
        colour: BOARD_COLUMN_COLOURS.includes(source.colour) ? source.colour : DEFAULT_COLUMN_COLOUR,
        star: Boolean(source.star),
        min: source.min ?? null,
        max: source.max ?? null,
        statuses: (source.statuses || []).slice(),
        isUnmapped: Boolean(source.isUnmapped),
        isUnconfigured: Boolean(source.isUnconfigured),
        epicGroups: sorted,
        epicCount,
        storyPoints: sorted.reduce((total, group) => total + (Number(group.storyPoints) || 0), 0),
        // describeBreach is the composer's own rule, so the board and settings cannot disagree
        // about what a breach is. It returns null for a column with no statuses.
        breach: (source.isUnmapped || source.isUnconfigured) ? null : describeBreach(source, epicCount),
    };
}

function syntheticColumn(id, name, flag) {
    return {
        id,
        name,
        colour: DEFAULT_COLUMN_COLOUR,
        star: false,
        min: null,
        max: null,
        statuses: [],
        [flag]: true,
    };
}

// `columns` is the stored `board.columns[]`; `epicGroups` is dashboard.jsx's groupTasksByEpic
// output. Columns with no statuses do not render (§6.1) — the validator makes that a save-time
// error, but a config that predates the validator can still contain one.
export function buildBoardColumns({ columns = [], epicGroups = [] } = {}) {
    const live = (columns || []).filter((column) => (column?.statuses || []).length > 0);
    // Dropping the NO_EPIC bucket: those are stories with no epic, not an epic with no status.
    const epics = (epicGroups || []).filter((group) => group && group.epic);

    // Nothing usable is configured — no board at all, or a board whose every column lost its
    // statuses. Both are the same problem with the same fix, and neither is "Unmapped" (§6.1).
    // Rendered even at zero epics: "this board is not set up" is more use than "nothing here".
    if (!live.length) {
        return [renderColumn(
            syntheticColumn(UNCONFIGURED_COLUMN_ID, UNCONFIGURED_COLUMN_NAME, 'isUnconfigured'),
            epics,
        )];
    }

    // First column wins a status held by two. The validator makes that an error on save, but a
    // config written before it can still contain one, and an epic must land somewhere definite
    // rather than in whichever column happened to be iterated last.
    const ownerByStatus = new Map();
    live.forEach((column) => {
        (column.statuses || []).forEach((status) => {
            if (!ownerByStatus.has(status)) ownerByStatus.set(status, column.id);
        });
    });

    const bucketById = new Map(live.map((column) => [column.id, []]));
    const unmapped = [];

    epics.forEach((group) => {
        const owner = ownerByStatus.get(epicStatusName(group.epic));
        if (owner === undefined) unmapped.push(group);
        else bucketById.get(owner).push(group);
    });

    const rendered = live.map((column) => renderColumn(column, bucketById.get(column.id)));
    if (unmapped.length) {
        rendered.push(renderColumn(
            syntheticColumn(UNMAPPED_COLUMN_ID, UNMAPPED_COLUMN_NAME, 'isUnmapped'),
            unmapped,
        ));
    }
    return rendered;
}

// The folded rails are the chart (D9): every bar is a fraction of this, stated once above the
// board. Never zero, so an all-empty board divides safely.
export function boardScaleMax(columns = []) {
    return Math.max(1, ...columns.map((column) => column.epicCount || 0));
}

/* ── Focus: exactly one column, always (D43, §6.1.2) ────────────────────────────────────────── */

// The ONLY function that may choose a focus. It cannot return nothing while a column exists, which
// is what makes "exactly one column is focused and open" a total rather than a set of cases.
export function resolveFocus(columns = [], { preferred = null, starredId = null } = {}) {
    const ids = columns.map((column) => column.id);
    if (preferred && ids.includes(preferred)) return preferred;
    if (starredId && ids.includes(starredId)) return starredId;
    const withWork = columns.find((column) => (column.epicCount || 0) > 0);
    return (withWork || columns[0] || {}).id || null;
}

// Folding the focused column TRANSFERS focus, never clears it: the star if there is one, otherwise
// the left neighbour, otherwise the right. Folding the first column therefore falls right, because
// there is no left one. The result still goes through resolveFocus, so the invariant has one owner.
export function resolveFocusAfterFold(columns = [], { columnId = null, starredId = null } = {}) {
    const index = columns.findIndex((column) => column.id === columnId);
    const neighbour = (starredId && starredId !== columnId)
        ? starredId
        : (columns[index - 1] || columns[index + 1] || {}).id || columnId;
    return resolveFocus(columns, { preferred: neighbour, starredId });
}
