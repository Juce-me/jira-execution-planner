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

// True when the stories already hold an actionable Story for the team, so its "Stories Required" ghost is stale.
export function shouldHideReadinessGhost({ epicKey, teamId, stories }) {
    return (stories || []).some(story => text(story?.fields?.epicKey) === text(epicKey)
        && text(story.fields.teamId) === text(teamId)
        && !NON_ACTIONABLE_STATUSES.has(statusOf(story)));
}
