import { getCapacityStatus } from './planningCapacityUtils.js';

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

export function validateCellDraft(field, text) {
    if (NUMBER_FIELDS.includes(field)) return validateNumberDraft(text);
    if (field === 'notes') return validateNoteDraft(text);
    return { ok: false, error: 'Unknown field.' };
}

// ---- effort ---------------------------------------------------------------

export const UNASSIGNED_KEY = null;
export const isUnassigned = task => !task?.fields?.assignee?.accountId;
export const storyPointsHundredths = task => toHundredths(task?.fields?.customfield_10004);

function accumulate(tasks) {
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
        // people's Selected only, against the sum of Capacity
        cue: active.some(row => numberStringToHundredths(row.capacity) != null) ? capacityCue(peopleSelectedH, capacityH) : '',
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
        if (row?.storyName && row.storyName !== row.storedName) change.displayName = row.storyName;
        changes.push(change);
    }
    return changes;
}

export function chunkChanges(changes, size = MAX_CHANGES) {
    const chunks = [];
    for (let index = 0; index < changes.length; index += size) chunks.push(changes.slice(index, index + size));
    return chunks;
}
