import { getCapacityStatus } from './planningCapacityUtils.js';
import { hashTeamId } from '../stats/statsUtils.js';
import { RADAR_PALETTE } from '../stats/statsConstants.js';

// One ENG task-load request collects at most this many issues (jira_server.py fetch_tasks).
export const TASK_LOAD_LIMIT = 250;
export const MAX_NUMBER_HUNDREDTHS = 1000000;
export const MAX_NOTE_LENGTH = 500;
export const MAX_CHANGES = 50;
export const NUMBER_FIELDS = ['capacity', 'vacations'];

// ---- integer hundredths -------------------------------------------------

export function toHundredths(value) {
    if (value == null || value === '') return 0;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function formatHundredths(hundredths) {
    const sign = hundredths < 0 ? '-' : '';
    const abs = Math.abs(Math.round(hundredths));
    const whole = Math.floor(abs / 100);
    const cents = abs % 100;
    if (!cents) return `${sign}${whole}`;
    return `${sign}${whole}.${String(cents).padStart(2, '0').replace(/0$/, '')}`;
}

export const sumHundredths = values => values.reduce((total, value) => total + value, 0);

// Wire/stored strings ("10.25") to hundredths without float arithmetic; null when unset.
export function numberStringToHundredths(text) {
    if (text == null || text === '') return null;
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(text));
    if (!match) return null;
    return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
}

// ---- draft validation (mirrors backend/services/assignee_capacity.py) ----

const hasControl = text => /[\u0000-\u001f\u007f-\u009f]/.test(text);

// Number cell: blank = unset (value null). Returns {ok, value} or {ok:false, error}.
export function validateNumberDraft(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return { ok: true, value: null };
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, error: 'Enter a number from 0 to 10000 with at most two decimals.' };
    const hundredths = numberStringToHundredths(trimmed);
    if (hundredths > MAX_NUMBER_HUNDREDTHS) return { ok: false, error: 'Enter a number from 0 to 10000 with at most two decimals.' };
    return { ok: true, value: formatHundredths(hundredths) };
}

export function validateNoteDraft(text) {
    const value = String(text ?? '');
    if (value.length > MAX_NOTE_LENGTH) return { ok: false, error: `Notes can be up to ${MAX_NOTE_LENGTH} characters.` };
    if (hasControl(value)) return { ok: false, error: 'Notes must be a single line of plain text.' };
    return { ok: true, value: value.trim() ? value : null };
}

export const MAX_DISPLAY_NAME_LENGTH = 200;

// A Story's display name made safe to send as a `displayName` snapshot (the server rejects more than 200 characters or
// control characters, which would fail the whole batch): control characters removed, cut to 200 code points; null when
// nothing is left, so the change is sent without a name.
export function sanitizeDisplayName(name) {
    if (typeof name !== 'string') return null;
    const clean = Array.from(name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')).slice(0, MAX_DISPLAY_NAME_LENGTH).join('');
    return clean.trim() ? clean : null;
}
export const isValidDisplayName = name => typeof name === 'string' && Array.from(name).length <= MAX_DISPLAY_NAME_LENGTH && !hasControl(name);

export function validateCellDraft(field, text) {
    if (NUMBER_FIELDS.includes(field)) return validateNumberDraft(text);
    if (field === 'notes') return validateNoteDraft(text);
    return { ok: false, error: 'Unknown field.' };
}

// ---- effort ---------------------------------------------------------------

export const UNASSIGNED_KEY = null;
export const isUnassigned = task => !task?.fields?.assignee?.accountId;
export const storyPointsHundredths = task => toHundredths(task?.fields?.customfield_10004);

// Accumulations are memoised by list identity so a selection toggle never re-sums the (stable) Total list.
const accumulated = new WeakMap();
function accumulate(tasks) {
    const cached = accumulated.get(tasks);
    if (cached) return cached;
    const result = accumulateTasks(tasks);
    accumulated.set(tasks, result);
    return result;
}

function accumulateTasks(tasks) {
    const byKey = new Map();
    const unassigned = { hundredths: 0, count: 0 };
    for (const task of tasks) {
        const sp = storyPointsHundredths(task);
        if (isUnassigned(task)) {
            unassigned.hundredths += sp;
            unassigned.count += 1;
            continue;
        }
        const key = task.fields.assignee.accountId;
        const entry = byKey.get(key) || { hundredths: 0, count: 0, displayName: '' };
        entry.hundredths += sp;
        entry.count += 1;
        entry.displayName = task.fields.assignee.displayName || entry.displayName;
        byKey.set(key, entry);
    }
    return { byKey, unassigned };
}

// Selected effort: the checked Stories (the same list the capacity bar sums).
export const selectedEffortByAssignee = selectedTasks => accumulate(selectedTasks || []);

// Total effort: every non-Killed Story of the team, independent of filters and checkboxes.
export function teamTasks(tasks, { teamId, getTeamInfo, normalizeStatus }) {
    return (tasks || []).filter(task => getTeamInfo(task).id === teamId
        && normalizeStatus(task?.fields?.status?.name) !== 'killed');
}

export const totalEffortByAssignee = (tasks, options) => accumulate(teamTasks(tasks, options));

// Checked Stories of the Team that the filters keep out of Selected effort (and out of the capacity bar's Selected):
// `selectedMap` is the Planning selection ({issueKey: true}), `selectedTasks` the filtered list both sum.
export function hiddenSelectedCount(teamTasksList, selectedMap, selectedTasks) {
    if (!selectedMap) return 0;
    const counted = new Set((selectedTasks || []).map(task => task.key));
    return (teamTasksList || []).filter(task => selectedMap[task.key] && !counted.has(task.key)).length;
}

// One load returns at most TASK_LOAD_LIMIT issues per request (Product and Tech are separate requests),
// so a lane at the limit may have dropped Stories and Total effort may be understated.
export function mayBeIncomplete({ laneIssueCounts = [], capped = false } = {}) {
    return capped === true || laneIssueCounts.some(count => count >= TASK_LOAD_LIMIT);
}

// ---- cues -----------------------------------------------------------------

// Same thresholds as getCapacityStatus (over above 120%, under below 90%), in integer hundredths.
export function capacityCue(selectedHundredths, capacityHundredths) {
    if (capacityHundredths == null || capacityHundredths <= 0) return '';
    if (selectedHundredths * 10 > capacityHundredths * 12) return 'over';
    if (selectedHundredths * 10 < capacityHundredths * 9) return 'under';
    return '';
}

export const capacityCueLabel = (selectedHundredths, capacityHundredths) =>
    capacityHundredths > 0 ? getCapacityStatus(selectedHundredths / 100, capacityHundredths / 100).label : '';

// ---- rows -------------------------------------------------------------------

const same = (left, right) => (left ?? null) === (right ?? null);
const byNameThenKey = (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);

export function buildAssigneeRows({
    document = null,          // GET payload {revision, rows, inherited}; null while not loaded
    teamTasksList = [],       // already filtered by teamTasks(); used for Stories, names and Total
    selectedTasks = [],
    ignoreInherited = false,  // closed Sprints show only their own document
} = {}) {
    const total = accumulate(teamTasksList);
    const selected = accumulate(selectedTasks);
    const own = document && document.revision > 0 ? document.rows || [] : [];
    const inheritedRows = !own.length && !ignoreInherited && document?.revision === 0 && document.inherited
        ? document.inherited.rows || [] : [];
    const useInherited = document?.revision === 0 && inheritedRows.length > 0;
    const stored = new Map();
    (useInherited ? inheritedRows : own).forEach(row => stored.set(row.assigneeKey, row));
    const keys = new Set([...stored.keys(), ...total.byKey.keys(), ...selected.byKey.keys()]);

    const active = [];
    const removed = [];
    for (const key of keys) {
        const row = stored.get(key);
        const stories = total.byKey.get(key) || selected.byKey.get(key) || null;
        const hasStories = Boolean(stories);
        const name = stories?.displayName || row?.displayName || key;
        const selectedHundredths = selected.byKey.get(key)?.hundredths || 0;
        const capacity = row?.capacity ?? null;
        const entry = {
            key,
            name,
            // the Story's current name; present only when it can refresh the stored snapshot
            storyName: stories?.displayName || null,
            storedName: row?.displayName ?? null,
            inRows: Boolean(row),
            inherited: useInherited && Boolean(row),
            capacity,
            // Vacations and Notes are never inherited
            vacations: useInherited ? null : row?.vacations ?? null,
            notes: useInherited ? null : row?.notes ?? null,
            hasStories,
            removable: !hasStories,
            selectedHundredths,
            totalHundredths: total.byKey.get(key)?.hundredths || 0,
            cue: capacityCue(selectedHundredths, numberStringToHundredths(capacity)),
        };
        // A person who has Stories is never removed.
        if (row?.removed && !hasStories) removed.push({ key, name });
        else active.push(entry);
    }
    active.sort(byNameThenKey);
    removed.sort(byNameThenKey);

    const capacityH = sumHundredths(active.map(row => numberStringToHundredths(row.capacity) || 0));
    const peopleSelectedH = sumHundredths(active.map(row => row.selectedHundredths));
    const totals = {
        capacityHundredths: capacityH,
        selectedHundredths: peopleSelectedH + selected.unassigned.hundredths,
        totalHundredths: sumHundredths(active.map(row => row.totalHundredths)) + total.unassigned.hundredths,
        vacationsHundredths: sumHundredths(active.map(row => numberStringToHundredths(row.vacations) || 0)),
        // the displayed Selected total (people plus Unassigned) against the sum of Capacity, the numbers the row shows
        cue: active.some(row => numberStringToHundredths(row.capacity) != null) ? capacityCue(peopleSelectedH + selected.unassigned.hundredths, capacityH) : '',
    };
    return {
        rows: active,
        removed,
        unassigned: total.unassigned.count || selected.unassigned.count
            ? {
                storyCount: total.unassigned.count,
                totalHundredths: total.unassigned.hundredths,
                selectedHundredths: selected.unassigned.hundredths,
            }
            : null,
        totals,
        inheritedFromSprintId: useInherited ? document.inherited.fromSprintId : null,
    };
}

// ---- first-write change building --------------------------------------------

// Last value per field per key; commits are {key, field, value} with a validated value
// (string|null for capacity, vacations, notes; boolean for removed).
export function coalesceCommits(commits) {
    const merged = new Map();
    for (const { key, field, value } of commits) {
        const entry = merged.get(key) || {};
        entry[field] = value;
        merged.set(key, entry);
    }
    return merged;
}

const shownValue = (row, field) => (field === 'removed' ? false : row?.[field] ?? null);
const equalValue = (field, shown, next) => (NUMBER_FIELDS.includes(field)
    ? numberStringToHundredths(shown) === numberStringToHundredths(next) && (shown == null) === (next == null)
    : same(shown, next));

// Minimal changes[] for a batch of commits against the rows currently shown. A commit equal to what is
// shown is dropped (so tabbing across gray rows sends nothing); inherited values are never sent;
// displayName is included only when a Story supplies a name that differs from the stored snapshot.
// `removedKeys` are people shown in the removed strip (their shown `removed` is true).
export function buildChanges(commits, shownRows, removedKeys = []) {
    const shown = new Map((shownRows || []).map(row => [row.key, row]));
    const removedSet = new Set(removedKeys);
    const changes = [];
    for (const [key, fields] of coalesceCommits(commits)) {
        const row = shown.get(key);
        const change = { assigneeKey: key };
        for (const [field, value] of Object.entries(fields)) {
            const current = field === 'removed' ? removedSet.has(key) : shownValue(row, field);
            if (!equalValue(field, current, value)) change[field] = value;
        }
        if (Object.keys(change).length === 1) continue;
        const storyName = sanitizeDisplayName(row?.storyName);
        if (storyName && storyName !== row.storedName) change.displayName = storyName;
        changes.push(change);
    }
    return changes;
}

// Add assignee: what picking a person from the search means for the rows shown. `exists` focuses the row,
// `restore` takes the person out of the removed strip, `add` sends a row with the result's name snapshot and no
// Capacity; null when the result has no usable id or name.
export function addAssigneeAction(person, shownRows, removedKeys = []) {
    const key = typeof person?.accountId === 'string' ? person.accountId.trim() : '';
    const name = sanitizeDisplayName(person?.displayName);
    if (!key || !name) return null;
    if ((shownRows || []).some(row => row.key === key)) return { type: 'exists', key };
    if ((removedKeys || []).includes(key)) return { type: 'restore', key };
    return { type: 'add', key, change: { assigneeKey: key, displayName: name.trim() } };
}

export function chunkChanges(changes, size = MAX_CHANGES) {
    const chunks = [];
    for (let index = 0; index < changes.length; index += size) chunks.push(changes.slice(index, index + size));
    return chunks;
}

// ---- team capacity (not in Jira) ----------------------------------------------

// The team-level stored number rides in the save queue as one pseudo-change under this reserved key (never an account id):
// `{assigneeKey: PLANNED_SLOT, planned: {value, source}}`, sent as the PATCH body's `planned`, never in `changes[]`.
export const PLANNED_SLOT = '\u0000planned';
export const isPlannedChange = change => change?.assigneeKey === PLANNED_SLOT;

// Half-up rounding to integer hundredths (the epsilon absorbs binary noise such as 1.005 * 100 = 100.49999…).
export function roundHalfUpHundredths(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.sign(number) * Math.round(Math.abs(number) * 100 + 1e-7);
}

// A Jira ticket value as the wire string the store accepts ("12.35"); null outside 0..10000 or when not a number.
export function plannedWireValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const hundredths = roundHalfUpHundredths(value);
    return hundredths < 0 || hundredths > MAX_NUMBER_HUNDREDTHS ? null : formatHundredths(hundredths);
}

const plannedHundredthsOf = planned => (planned?.value == null ? null : roundHalfUpHundredths(planned.value));
// Equality after rounding both sides half-up to hundredths; absent equals absent only.
export const samePlannedValue = (left, right) => plannedHundredthsOf(left) === plannedHundredthsOf(right);
export const plannedNumber = planned => { const hundredths = plannedHundredthsOf(planned); return hundredths == null ? null : hundredths / 100; };

// The stored number as shown: the Sprint's own, else the nearest earlier document's (gray, source `inherited`).
export function effectivePlanned(document) {
    if (!document) return null;
    if (document.revision > 0) return document.planned ?? null;
    return document.inherited?.planned ?? null;
}

const storedPlanned = planned => (planned?.value == null ? null : { value: planned.value, source: planned.source });

// Whether writing `next` over the shown `current` changes nothing. A typed number (`user`) equal to the shown one is a
// no-op whatever its source (tabbing over a gray number creates no document); a `jira` write also converts the source.
export function isPlannedNoop(current, next) {
    if (!samePlannedValue(current, next)) return false;
    if (next?.value == null) return true;
    return next.source === 'user' || (current?.source ?? null) === next.source;
}

// ---- optimistic overlay ------------------------------------------------------

const OVERLAY_FIELDS = ['capacity', 'vacations', 'notes', 'removed'];

// Rows a first write would start from: the document's own rows, or (mirroring the server's materialisation)
// the inherited source's non-removed people with their Capacity only.
export function baseRowsOf(document) {
    if (!document) return [];
    if (document.revision > 0) return document.rows || [];
    return (document.inherited?.rows || []).filter(row => !row.removed).map(row => ({
        assigneeKey: row.assigneeKey, displayName: row.displayName, capacity: row.capacity ?? null, vacations: null, notes: null, removed: false,
    }));
}

// The document as the server will hold it once `changes` are saved; used to show unsaved commits at once.
// The stored team number is materialised too (source `inherited`), so a pending commit never drops the gray number.
export function applyChangesToDocument(document, changes) {
    if (!document || !changes?.length) return document;
    const rows = new Map(baseRowsOf(document).map(row => [row.assigneeKey, { ...row }]));
    let planned = effectivePlanned(document);
    for (const change of changes) {
        if (isPlannedChange(change)) { planned = storedPlanned(change.planned); continue; }
        const row = rows.get(change.assigneeKey) || { assigneeKey: change.assigneeKey, displayName: change.displayName || change.assigneeKey, capacity: null, vacations: null, notes: null, removed: false };
        if (change.displayName) row.displayName = change.displayName;
        for (const field of OVERLAY_FIELDS) if (field in change) row[field] = field === 'removed' ? Boolean(change[field]) : change[field];
        rows.set(change.assigneeKey, row);
    }
    return { ...document, revision: Math.max(1, document.revision), rows: [...rows.values()], planned, inherited: null };
}

// What a document holds for one field, as the server would compare it (inherited rows hold Capacity only).
export function documentFieldValue(document, key, field) {
    const row = baseRowsOf(document).find(candidate => candidate.assigneeKey === key);
    return field === 'removed' ? row?.removed === true : row?.[field] ?? null;
}

// Drops the fields of a change that the document already holds; null when nothing is left to send.
// A named change for a person the document does not hold yet is an Add assignee and is kept.
export function pruneChange(change, document) {
    if (isPlannedChange(change)) return isPlannedNoop(effectivePlanned(document), change.planned) ? null : change;
    const next = { assigneeKey: change.assigneeKey };
    if (change.displayName) next.displayName = change.displayName;
    let fields = change.displayName && !baseRowsOf(document).some(row => row.assigneeKey === change.assigneeKey) ? 1 : 0;
    for (const field of OVERLAY_FIELDS) {
        if (!(field in change)) continue;
        if (equalValue(field, documentFieldValue(document, change.assigneeKey, field), change[field])) continue;
        next[field] = change[field];
        fields += 1;
    }
    return fields ? next : null;
}

// ---- undo shortcut ---------------------------------------------------------------

// Cmd/Ctrl+Z without Shift or Alt (Shift is redo); a key auto-repeat is never handled, so holding the keys undoes once.
export const isUndoShortcut = event => Boolean(event && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && String(event.key || '').toLowerCase() === 'z');
export const handlesUndoKey = event => isUndoShortcut(event) && !event.repeat;

// ---- underbar -----------------------------------------------------------------

export const UNDERBAR_UNASSIGNED_KEY = '__unassigned__';

// Segments of the thin bar under the capacity bar: one per non-removed person with Capacity, plus a trailing
// Unassigned segment sized by unassigned Total effort. The denominator is the raw Jira capacity, else the sum of
// the people's Capacity; with no number at all there is no bar (null). Values are integer hundredths.
export function buildUnderbar(view, rawCapacity = null) {
    const rows = view?.rows || [];
    const people = rows
        .map(row => ({ key: row.key, name: row.name, capacityHundredths: numberStringToHundredths(row.capacity) || 0, selectedHundredths: row.selectedHundredths, totalHundredths: row.totalHundredths }))
        .filter(person => person.capacityHundredths > 0);
    const rawHundredths = Number(rawCapacity) > 0 ? toHundredths(rawCapacity) : 0;
    const peopleCapacity = sumHundredths(people.map(person => person.capacityHundredths));
    const denominatorHundredths = rawHundredths > 0 ? rawHundredths : peopleCapacity;
    if (denominatorHundredths <= 0) return null;
    const unassigned = view?.unassigned?.totalHundredths > 0
        ? { key: UNDERBAR_UNASSIGNED_KEY, name: 'Unassigned (effort)', totalHundredths: view.unassigned.totalHundredths, selectedHundredths: view.unassigned.selectedHundredths }
        : null;
    if (!people.length && !unassigned) return null;
    return { denominatorHundredths, source: rawHundredths > 0 ? 'jira' : 'sum', people, unassigned };
}

// The underbar on the amber bar's own axis (#323 D5). Person Capacity is raw Jira-scale while the bar is Product/Tech
// adjusted, so people are scaled by `multiplier`; Unassigned is effort and is drawn unscaled. Values are SP; the
// overflow (in hundredths, so float noise never draws a false mark) is what lies beyond the Team Cap marker.
export function underbarOnBarAxis(model, barCapacity, multiplier = 1) {
    const people = model.people.map(person => ({ ...person, value: (person.capacityHundredths * multiplier) / 100 }));
    const unassignedValue = model.unassigned ? model.unassigned.totalHundredths / 100 : 0;
    // Scale the raw sum once and round only the difference, so people equal to the raw team number never overflow.
    const stackedHundredths = sumHundredths(model.people.map(person => person.capacityHundredths)) * multiplier
        + (model.unassigned ? model.unassigned.totalHundredths : 0);
    const overflowHundredths = Math.max(0, Math.round(stackedHundredths - (Number(barCapacity) || 0) * 100));
    return { people, unassignedValue, stacked: stackedHundredths / 100, overflow: overflowHundredths / 100, overflowHundredths };
}

// The stats palette without the colours that clash with the Unassigned pink/red (`--warn`, the over cue) and the amber
// bar and amber under-cue text: lemon, magenta and amber are left out.
const CLASHING = new Set(['#eab308', '#db2777', '#d97706']);
export const ASSIGNEE_PALETTE = RADAR_PALETTE.filter(color => !CLASHING.has(color));

// One colour source for a person's underbar segment and tinted table row: the sorted-index map (name, then key) over
// every row of the view, as buildTeamColorMap, on ASSIGNEE_PALETTE.
export function buildAssigneeColorMap(rows) {
    const byKey = new Map();
    (rows || []).forEach(row => { const key = String(row?.key || '').trim(); if (key && !byKey.has(key)) byKey.set(key, String(row?.name || key).trim() || key); });
    return Object.fromEntries([...byKey.entries()]
        .sort(([leftKey, left], [rightKey, right]) => {
            const a = left.toLowerCase(), b = right.toLowerCase();
            return a < b ? -1 : a > b ? 1 : leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })
        .map(([key], index) => [key, ASSIGNEE_PALETTE[index % ASSIGNEE_PALETTE.length]]));
}
export function resolveAssigneeColor(key, colorMap) {
    const id = String(key || '').trim();
    return (id && colorMap?.[id]) || ASSIGNEE_PALETTE[hashTeamId(id) % ASSIGNEE_PALETTE.length];
}
// Only people with a Capacity have an underbar segment, so only they get a row tint (null otherwise).
export function assigneeRowColor(row, colorMap) {
    return numberStringToHundredths(row.capacity) > 0 ? resolveAssigneeColor(row.key, colorMap) : null;
}
