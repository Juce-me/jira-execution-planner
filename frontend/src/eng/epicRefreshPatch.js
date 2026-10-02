// Pure diff and merge rules for the per-epic refresh (issue #213). No React, no I/O.

export const STORY_DISPLAYED_FIELDS = Object.freeze([
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'storyPoints', 'teamId', 'epicKey', 'sprint', 'subtaskSummary',
]);
export const EPIC_DISPLAYED_FIELDS = Object.freeze(['summary', 'status', 'priority', 'projectTrack', 'assignee', 'initiative']);

const nameOf = value => (value && typeof value === 'object' ? String(value.name ?? value.value ?? '') : String(value ?? ''));

const personKey = person => {
    if (!person) return '';
    if (typeof person === 'string') return person;
    return String(person.accountId || person.displayName || '');
};

const sprintKey = value => {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return list
        .map(item => (item && typeof item === 'object' ? String(item.id ?? item.name ?? '') : String(item)))
        .filter(Boolean)
        .sort()
        .join(',');
};

const stableStringify = value => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${key}:${stableStringify(value[key])}`).join(',')}}`;
};

const storyPointsKey = value => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
};

export function normalizeStory(issue) {
    const fields = issue?.fields || {};
    return {
        summary: String(fields.summary ?? ''),
        status: nameOf(fields.status),
        priority: nameOf(fields.priority),
        issuetype: nameOf(fields.issuetype),
        assignee: personKey(fields.assignee),
        storyPoints: storyPointsKey(fields.customfield_10004),
        teamId: String(fields.teamId ?? fields.team?.id ?? ''),
        epicKey: String(fields.epicKey ?? ''),
        sprint: sprintKey(fields.customfield_10101),
        subtaskSummary: stableStringify(fields.subtaskSummary),
    };
}

export function diffStory(held, fetched) {
    const before = normalizeStory(held);
    const after = normalizeStory(fetched);
    const changedFields = STORY_DISPLAYED_FIELDS.filter(field => before[field] !== after[field]);
    const updatedChanged = String(held?.fields?.updated ?? '') !== String(fetched?.fields?.updated ?? '');
    return {
        changedFields,
        silent: changedFields.length === 0 && updatedChanged,
        equal: changedFields.length === 0 && !updatedChanged,
    };
}

export function mergeEpicStories({
    held = [], fetched = [], epicKey, laneApplied = true, capped = false, detailsMissing = false,
    protectedKeys = new Set(), clickSnapshot = new Map(), userRemovedKeys = new Set(),
}) {
    const unchanged = { items: held, changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], keptKeys: [], changedFieldsByKey: {}, changed: false };
    if (!laneApplied) return unchanged;
    const fetchedByKey = new Map(fetched.map(issue => [issue.key, issue]));
    const heldKeys = new Set(held.map(issue => issue.key));
    const canRemove = !capped && !detailsMissing;
    const items = [];
    const changedKeys = [];
    const silentKeys = [];
    const addedKeys = [];
    const removedKeys = [];
    const keptKeys = [];
    const changedFieldsByKey = {};
    let replaced = false;

    for (const current of held) {
        const key = current.key;
        const snapshot = clickSnapshot.get(key);
        const editedSinceClick = Boolean(snapshot) && diffStory(snapshot, current).changedFields.length > 0;
        if (protectedKeys.has(key) || editedSinceClick) {
            items.push(current);
            keptKeys.push(key);
            continue;
        }
        const incoming = fetchedByKey.get(key);
        if (incoming) {
            const diff = diffStory(current, incoming);
            if (diff.equal) {
                items.push(current);
                continue;
            }
            items.push(incoming);
            replaced = true;
            changedFieldsByKey[key] = diff.changedFields;
            (diff.silent ? silentKeys : changedKeys).push(key);
            continue;
        }
        if (canRemove && String(current.fields?.epicKey ?? '') === String(epicKey)) {
            removedKeys.push(key);
            replaced = true;
            continue;
        }
        items.push(current);
    }
    for (const incoming of fetched) {
        if (heldKeys.has(incoming.key) || userRemovedKeys.has(incoming.key)) continue;
        items.push(incoming);
        addedKeys.push(incoming.key);
        replaced = true;
    }
    return { items: replaced ? items : held, changedKeys, silentKeys, addedKeys, removedKeys, keptKeys, changedFieldsByKey, changed: replaced };
}

export function normalizeEpic(epic) {
    return {
        summary: String(epic?.summary ?? ''),
        status: nameOf(epic?.status),
        priority: nameOf(epic?.priority),
        projectTrack: String(epic?.projectTrack ?? ''),
        assignee: personKey(epic?.assignee),
        initiative: epic?.initiative?.key ? `${epic.initiative.key}|${epic.initiative.summary ?? ''}` : '',
    };
}

export function diffEpic(held, fetched) {
    if (!fetched) return { changedFields: [], silent: false, equal: true };
    const before = normalizeEpic(held);
    const after = normalizeEpic(fetched);
    const changedFields = EPIC_DISPLAYED_FIELDS.filter(field => before[field] !== after[field]);
    const updatedChanged = String(held?.updated ?? '') !== String(fetched?.updated ?? '');
    return { changedFields, silent: changedFields.length === 0 && updatedChanged, equal: changedFields.length === 0 && !updatedChanged };
}

// Epic-shaped copies (`*EpicsInScope`, both `readyToClose*EpicsInScope`) keep their status as `{ name }`.
export function patchEpicScopeEntries(list, epicKey, fetchedEpic) {
    if (!Array.isArray(list) || !fetchedEpic) return list;
    let changed = false;
    const next = list.map(entry => {
        if (String(entry?.key ?? '') !== String(epicKey)) return entry;
        const patched = {
            ...entry,
            summary: fetchedEpic.summary ?? entry.summary,
            status: { name: nameOf(fetchedEpic.status) || entry.status?.name || '' },
            assignee: 'assignee' in fetchedEpic ? fetchedEpic.assignee : entry.assignee,
        };
        const same = patched.summary === entry.summary
            && nameOf(patched.status) === nameOf(entry.status)
            && personKey(patched.assignee) === personKey(entry.assignee);
        if (same) return entry;
        changed = true;
        return patched;
    });
    return changed ? next : list;
}

// Story-shaped copies (`readyToClose*Tasks`) are lightweight: patch only the keys they already carry.
export function patchStoryCopies(list, fetchedByKey) {
    if (!Array.isArray(list) || !fetchedByKey || !fetchedByKey.size) return list;
    let changed = false;
    const next = list.map(entry => {
        const incoming = fetchedByKey.get(entry?.key);
        if (!incoming) return entry;
        const keys = Object.keys(entry.fields || {}).filter(key => key !== 'missingFields' && key in (incoming.fields || {}));
        if (!keys.some(key => stableStringify(entry.fields[key]) !== stableStringify(incoming.fields[key]))) return entry;
        changed = true;
        const fields = { ...entry.fields };
        for (const key of keys) fields[key] = incoming.fields[key];
        return { ...entry, fields };
    });
    return changed ? next : list;
}
