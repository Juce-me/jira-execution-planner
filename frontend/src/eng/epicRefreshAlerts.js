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

// Alert calls vocabulary, in the order they run. Task 11 executes `readyToClose` and `epicAlerts`; the rest belongs to Task 12.
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
    if (storyFields.has('status')) ['readyToClose', 'epicAlerts'].forEach(call => calls.add(call));
    if (storyFields.has('teamId')) ['missingInfo', 'readiness'].forEach(call => calls.add(call));
    if (epicTrigger) calls.add('epicAlerts');
    if (isFutureSprint && anyChange) calls.add('epicAlerts');
    if (isFutureSprint && (membership || epicTrigger)) calls.add('backlog');
    return ALERT_CALL_ORDER.filter(call => calls.has(call));
}

// True when the stories already hold an actionable Story for the team, so its "Stories Required" ghost is stale.
export function shouldHideReadinessGhost({ epicKey, teamId, stories }) {
    return (stories || []).some(story => text(story?.fields?.epicKey) === text(epicKey)
        && text(story.fields.teamId) === text(teamId)
        && !NON_ACTIONABLE_STATUSES.has(statusOf(story)));
}
