// Pure rules that keep client-derived alert data in step with a per-epic refresh (issue #213). No React, no I/O.

// Statuses the Missing Info endpoint excludes (backend/routes/eng_routes.py).
const TERMINAL_STATUSES = new Set(['killed', 'done', 'postponed']);
// Statuses that do not make a Story actionable (backend/services/story_readiness.py, _NON_ACTIONABLE_STORY_STATUSES).
const NON_ACTIONABLE_STATUSES = new Set(['blocked', 'done', 'killed', 'incomplete']);

const text = value => String(value ?? '').trim();
const statusOf = story => text(story?.fields?.status?.name).toLowerCase();

// Names and order follow the endpoint: Sprint, Story Points (at most 0 counts as missing), Team. Never 'Assignee'.
function missingNamesFor(story) {
    const fields = story.fields || {};
    const sprint = fields.customfield_10101 ?? fields.sprint;
    const points = fields.customfield_10004;
    const names = [];
    if (!(Array.isArray(sprint) ? sprint.length : sprint)) names.push('Sprint');
    if (points === null || points === undefined || points === '' || !(Number.parseFloat(points) > 0)) names.push('Story Points');
    if (!text(fields.teamId) && !text(fields.teamName)) names.push('Team');
    return names;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function recomputeMissingPlanningInfo({ held, refreshedStories, epicKey }) {
    const refreshed = new Map((refreshedStories || []).map(story => [story.key, story]));
    let changed = false;
    const next = [];
    for (const entry of held) {
        const story = refreshed.get(entry.key);
        if (!story || text(entry.fields?.epicKey) !== text(epicKey)) { next.push(entry); continue; }
        const names = TERMINAL_STATUSES.has(statusOf(story)) ? [] : missingNamesFor(story);
        if (!names.length) { changed = true; continue; }
        const nested = Array.isArray(entry.fields?.missingFields);
        const fields = { ...entry.fields, ...story.fields, ...(nested ? { missingFields: names } : {}) };
        const before = nested ? entry.fields.missingFields : entry.missingFields;
        if (sameJson(before, names) && sameJson(entry.fields, fields)) { next.push(entry); continue; }
        changed = true;
        next.push(nested ? { ...entry, fields } : { ...entry, fields, missingFields: names });
    }
    return changed ? next : held;
}

// Keyed merge of one lane's `*EpicsInScope` list (alerts or ready-to-close shape): replace the epic's entry in place, append it when new,
// delete it when the lane no longer returns it. Entries of other epics and the array identity survive when nothing changes.
export function mergeEpicScopeEntries({ held, incoming, epicKey, deleteWhenAbsent = true }) {
    const key = text(epicKey);
    const fresh = (incoming || []).find(entry => text(entry?.key) === key);
    const at = held.findIndex(entry => text(entry?.key) === key);
    if (!fresh) return at < 0 || !deleteWhenAbsent ? held : held.filter((_, index) => index !== at);
    if (at < 0) return [...held, fresh];
    return sameJson(held[at], fresh) ? held : held.map((entry, index) => (index === at ? fresh : entry));
}

// Keyed replace of the story-shaped copies (`readyToClose*Tasks`) that belong to one epic; identity is kept when the set is equal.
export function replaceEpicStories({ held, incoming, epicKey, emptyConfirmed = true }) {
    const key = text(epicKey);
    const mine = entry => text(entry?.fields?.epicKey) === key;
    const byKey = (a, b) => text(a.key).localeCompare(text(b.key));
    const before = held.filter(mine);
    const after = (incoming || []).filter(mine);
    // An empty answer can be a swallowed server failure (partial data, MRT019): it deletes the epic's copies only when confirmed.
    if (after.length === 0 && !emptyConfirmed) return held;
    if (sameJson([...before].sort(byKey), [...after].sort(byKey))) return held;
    return [...held.filter(entry => !mine(entry)), ...after];
}

// Keyed merge of the held Missing Info issues for one epic (`fields.epicKey`): replace in place, append new ones. The endpoint swallows a
// failed Story search and still answers 200, so an absent issue is kept (partial data, MRT019); the epic's issues are deleted only when the
// epic itself left the endpoint's scope (`epicInScope: false`, its epic search answers an error on failure).
export function mergeEpicMissingIssues({ held, incoming, epicKey, epicInScope = true }) {
    const key = text(epicKey);
    const mine = entry => text(entry?.fields?.epicKey) === key;
    if (!epicInScope) return held.some(mine) ? held.filter(entry => !mine(entry)) : held;
    const fresh = new Map((incoming || []).filter(mine).map(entry => [entry.key, entry]));
    if (!fresh.size) return held;
    let changed = false;
    const next = held.map(entry => {
        const replacement = mine(entry) ? fresh.get(entry.key) : undefined;
        if (!replacement) return entry;
        fresh.delete(entry.key);
        if (sameJson(entry, replacement)) return entry;
        changed = true;
        return replacement;
    });
    if (fresh.size) { changed = true; next.push(...fresh.values()); }
    return changed ? next : held;
}

// Readiness fields the epic details also carry. When the refreshed details cleared one, the held readiness copy must not shadow it
// (`mergeEpic` in engWorkHierarchy.js falls back to the readiness value when the details value is empty).
const READINESS_SHADOW_FIELDS = [['assignee', null], ['projectTrack', ''], ['initiative', null]];
const hasValue = (field, value) => (field === 'initiative' ? Boolean(text(value?.key)) : value !== null && value !== undefined && value !== '');

// Keyed merge of one epic into the Stories Required snapshot (`snapshot.epics[]`): upsert or delete by key from the per-epic payload, keep
// every other epic and the snapshot identity when nothing changes. A missing payload (failed or skipped call) never deletes. `epicDetails`
// (the refreshed epic) clears readiness assignee, track and initiative values the details no longer carry.
export function mergeReadinessEpic({ snapshot, epicPayload, epicKey, epicDetails }) {
    if (!snapshot || !Array.isArray(snapshot.epics)) return snapshot;
    const key = text(epicKey);
    const at = snapshot.epics.findIndex(epic => text(epic?.key) === key);
    let epics = snapshot.epics;
    if (Array.isArray(epicPayload?.epics)) {
        const fresh = epicPayload.epics.find(epic => text(epic?.key) === key);
        if (!fresh) epics = at < 0 ? epics : epics.filter((_, index) => index !== at);
        else if (at < 0) epics = [...epics, fresh];
        else if (!sameJson(epics[at], fresh)) epics = epics.map((epic, index) => (index === at ? fresh : epic));
    }
    const now = epics.findIndex(epic => text(epic?.key) === key);
    if (epicDetails && now >= 0) {
        // Epic details are replaced as whole objects and omit `initiative` when there is none (design 3.5), so an absent key means cleared.
        const cleared = READINESS_SHADOW_FIELDS.filter(([field]) => (field === 'initiative' || field in epicDetails) && !hasValue(field, epicDetails[field]) && hasValue(field, epics[now][field]));
        const moved = hasValue('initiative', epicDetails.initiative) && text(epicDetails.initiative.key) !== text(epics[now].initiative?.key);
        if (cleared.length || moved) epics = epics.map((epic, index) => (index === now ? { ...epic, ...Object.fromEntries(cleared), ...(moved ? { initiative: epicDetails.initiative } : {}) } : epic));
    }
    return epics === snapshot.epics ? snapshot : { ...snapshot, epics };
}

// Local field patch of one epic in the Stories Required snapshot (an inline edit of a readiness-only epic, which `epicDetails` does not hold).
// Keeps the snapshot identity for an unknown epic key or an unchanged value; every other epic keeps its identity.
export function patchReadinessEpicField(snapshot, epicKey, field, value) {
    const key = text(epicKey).toUpperCase();
    const name = text(field);
    if (!key || !name || !snapshot || !Array.isArray(snapshot.epics)) return snapshot;
    const at = snapshot.epics.findIndex(epic => text(epic?.key).toUpperCase() === key);
    if (at < 0 || sameJson(snapshot.epics[at][name], value)) return snapshot;
    return { ...snapshot, epics: snapshot.epics.map((epic, index) => (index === at ? { ...epic, [name]: value } : epic)) };
}

// Alert calls vocabulary, in the order they run: `readyToClose` and `epicAlerts` (Task 11), `missingInfo`, `backlog` and `readiness` (Task 12).
const ALERT_CALL_ORDER = ['readyToClose', 'epicAlerts', 'missingInfo', 'backlog', 'readiness'];

// Which epic-scoped alert calls a refresh update needs (design section 3.6). `update` is the controller's update object, optionally with
// `epicChangedFields` (the epic diff's displayed fields). Planning never re-checks alerts.
export function alertCallsFor(update, { isFutureSprint = false, isCatchUp = false } = {}) {
    if (!isCatchUp || !update) return [];
    const fieldsByKey = update.changedFieldsByKey || {};
    const storyFields = new Set((update.changedKeys || []).flatMap(key => fieldsByKey[key] || []));
    const membership = (update.addedKeys || []).length > 0 || (update.removedKeys || []).length > 0 || storyFields.has('sprint');
    const epicFields = update.epicChangedFields;
    const epicTrigger = update.epicSilent === true
        || (epicFields ? epicFields.some(field => field === 'status' || field === 'assignee') : update.epicChanged === true);
    const anyChange = (update.changedKeys || []).length > 0 || (update.silentKeys || []).length > 0 || membership
        || update.epicChanged === true || update.epicSilent === true;
    const calls = new Set();
    if (membership) ['readyToClose', 'epicAlerts', 'missingInfo', 'readiness'].forEach(call => calls.add(call));
    if (storyFields.has('status')) ['readyToClose', 'epicAlerts', 'readiness'].forEach(call => calls.add(call));
    if (storyFields.has('teamId')) ['missingInfo', 'readiness'].forEach(call => calls.add(call));
    if (epicTrigger) calls.add('epicAlerts');
    if (isFutureSprint && anyChange) calls.add('epicAlerts');
    if (isFutureSprint && (membership || epicTrigger)) calls.add('backlog');
    return ALERT_CALL_ORDER.filter(call => calls.has(call));
}

// Which epic-scoped alert calls an inline edit needs (Task 13b), in the `ALERT_CALL_ORDER` order. Only a status edit in Catch Up re-checks:
// priority feeds no alert rule, Missing Info does not follow a status change (same as `alertCallsFor`), and an unknown field asks for nothing.
export function alertCallsForEdit({ field, isFutureSprint = false, isCatchUp = false } = {}) {
    if (!isCatchUp || field !== 'status') return [];
    const calls = new Set(['readyToClose', 'epicAlerts', 'readiness']);
    if (isFutureSprint) calls.add('backlog');
    return ALERT_CALL_ORDER.filter(call => calls.has(call));
}

// True when the stories already hold an actionable Story for the team, so its "Stories Required" ghost is stale.
export function shouldHideReadinessGhost({ epicKey, teamId, stories }) {
    return (stories || []).some(story => text(story?.fields?.epicKey) === text(epicKey)
        && text(story.fields.teamId) === text(teamId)
        && !NON_ACTIONABLE_STATUSES.has(statusOf(story)));
}
