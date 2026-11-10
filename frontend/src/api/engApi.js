import { apiFetch, getJson, jsonOrStructuredError, trackedFetch } from './http.js';
import { applyContextToParams } from '../workStructure/configurationContext.js';
import { runInWorkContext, stampBody, stampParams } from '../workStructure/requestContext.js';

// Work reads carry the accepted work-configuration context (id, revision, quarter) and are dropped as an
// abort when that context changes before they complete. Catalog reads (`fetchSprints`) are stamped with the
// context the controller captured for them instead.
const scopedFetch = (url, init) => runInWorkContext(init, next => apiFetch(url, next));
const scopedTracked = (surface, url, init, analytics) => runInWorkContext(init, next => trackedFetch(surface, url, next, analytics));
const scopedJson = (url, label, options) => runInWorkContext(options, next => getJson(url, label, next));

export const fetchMissingPlanningInfo = (backendUrl, { sprintId, teamIds = [], components = [], signal } = {}) => {
    const params = new URLSearchParams({ sprint: String(sprintId), t: Date.now().toString() });
    if (teamIds.length) {
        params.set('teamIds', teamIds.join(','));
    }
    if (components.length) {
        params.set('components', components.join(','));
    }
    stampParams(params);
    return scopedFetch(`${backendUrl}/api/missing-info?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const fetchSprints = (backendUrl, {
    context = null,
    forceRefresh = false,
    completionAttemptId = null,
    catalogIdentity = null,
    signal,
} = {}) => {
    const hasCompletion = Boolean(completionAttemptId || catalogIdentity);
    if (hasCompletion && (!completionAttemptId || !catalogIdentity)) {
        throw new Error('Sprint completion requires both attempt identity fields.');
    }
    if (forceRefresh && hasCompletion) {
        throw new Error('Sprint forced refresh cannot be combined with completion parameters.');
    }
    const params = new URLSearchParams();
    if (forceRefresh) {
        params.append('refresh', 'true');
    }
    if (hasCompletion) {
        params.set('completionAttemptId', String(completionAttemptId));
        params.set('catalogIdentity', String(catalogIdentity));
    }
    applyContextToParams(params, context, { includeQuarter: false });
    const query = params.toString();
    return apiFetch(`${backendUrl}/api/sprints${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal,
    });
};

export const fetchEngTasks = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], refresh = false, purpose = '', epicKeys = [], signal, debugTimings = false, apiSurface = 'eng_tasks', featureName = 'eng', automatic = false } = {}) => {
    const params = new URLSearchParams({
        t: Date.now().toString(),
        sprint,
        sprintName,
        team: 'all',
        project: project || 'all',
        groupId: groupId || ''
    });
    if (debugTimings) params.set('debugTimings', 'true');
    if (refresh) {
        params.set('refresh', 'true');
    }
    if (teamIds.length > 0) {
        params.set('teamIds', teamIds.join(','));
    }
    if (teamLabels.length > 0) {
        const uniqueTeamLabels = Array.from(new Set(teamLabels.map((label) => String(label || '').trim()).filter(Boolean)));
        if (uniqueTeamLabels.length) {
            params.set('teamLabels', uniqueTeamLabels.join(','));
        }
    }
    if (purpose) {
        params.set('purpose', String(purpose));
    }
    if (epicKeys && epicKeys.length) {
        const uniqueEpicKeys = Array.from(new Set(epicKeys.filter(Boolean)));
        if (uniqueEpicKeys.length) {
            params.set('epicKeys', uniqueEpicKeys.join(','));
        }
    }
    stampParams(params);
    return scopedTracked(apiSurface, `${backendUrl}/api/tasks-with-team-name?${params.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        cache: 'no-cache',
        signal
    }, { featureName, ...(automatic ? { suppressAbortResult: true } : {}) });
};

export const fetchEpicRefresh = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], epicKey, signal, automatic = false } = {}) => fetchEngTasks(backendUrl, {
    project, sprint, sprintName, groupId, teamIds, teamLabels, refresh: true, purpose: 'epic-refresh', epicKeys: [epicKey], signal, automatic,
    apiSurface: 'epic_refresh', featureName: 'epic_refresh',
});

// One epic's alert object: `{ epicsInScope: [epic] or [] }`, no issues.
export const fetchEpicAlertBundle = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], epicKey, signal } = {}) => fetchEngTasks(backendUrl, {
    project, sprint, sprintName, groupId, teamIds, teamLabels, refresh: true, purpose: 'epic-alerts', epicKeys: [epicKey], signal,
    apiSurface: 'epic_refresh', featureName: 'epic_refresh',
});

// Ready to Close for one epic across all sprints (the sprint parameter stays empty, as in the department request).
export const fetchEpicReadyToClose = (backendUrl, { project, sprintName = '', groupId, teamIds = [], teamLabels = [], epicKey, signal } = {}) => fetchEngTasks(backendUrl, {
    project, sprint: '', sprintName, groupId, teamIds, teamLabels, refresh: true, purpose: 'ready-to-close', epicKeys: [epicKey], signal,
    apiSurface: 'epic_refresh', featureName: 'epic_refresh',
});

export const fetchStoryReadiness = async (backendUrl, {
    sprint,
    sprintName,
    sprintState,
    groupId,
    refresh = false,
    signal,
} = {}) => {
    const params = new URLSearchParams({
        sprint: String(sprint ?? ''),
        sprintName: String(sprintName ?? ''),
        sprintState: String(sprintState ?? ''),
        groupId: String(groupId ?? ''),
    });
    if (refresh) params.set('refresh', 'true');
    stampParams(params);
    const response = await scopedTracked(
        'eng_story_readiness',
        `${backendUrl}/api/eng/story-readiness?${params.toString()}`,
        {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
            signal,
        },
        { featureName: 'eng', suppressAbortResult: true },
    );
    return jsonOrStructuredError(response, 'Story readiness');
};

// One epic's Stories Required entry: `{ epics: [epic] or [] }` in the department snapshot shape. Separate from the department request.
export const fetchEpicReadiness = async (backendUrl, { sprint, sprintName, sprintState, groupId, epicKey, signal } = {}) => {
    const params = new URLSearchParams({
        sprint: String(sprint ?? ''),
        sprintName: String(sprintName ?? ''),
        sprintState: String(sprintState ?? ''),
        groupId: String(groupId ?? ''),
        epicKeys: String(epicKey ?? ''),
        refresh: 'true',
    });
    stampParams(params);
    const response = await scopedTracked(
        'epic_refresh',
        `${backendUrl}/api/eng/story-readiness?${params.toString()}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-cache', signal },
        { featureName: 'epic_refresh', suppressAbortResult: true },
    );
    return jsonOrStructuredError(response, 'Story readiness');
};

// One epic's Missing Info: `{ issues, epics }` scoped to the epic key; `refresh` skips the server cache read.
export const fetchEpicMissingInfo = (backendUrl, { sprintId, teamIds = [], components = [], epicKey, signal } = {}) => {
    const params = new URLSearchParams({ sprint: String(sprintId), epicKeys: String(epicKey ?? ''), refresh: 'true', t: Date.now().toString() });
    if (teamIds.length) params.set('teamIds', teamIds.join(','));
    if (components.length) params.set('components', components.join(','));
    stampParams(params);
    return scopedFetch(`${backendUrl}/api/missing-info?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

// One epic's Backlog alert entry: `{ epics: [epic] or [] }`.
export const fetchEpicBacklog = (backendUrl, { project, teamIds = [], epicKey, signal } = {}) => {
    const params = new URLSearchParams({ t: Date.now().toString(), project: project || 'all', epicKeys: String(epicKey ?? '') });
    if (teamIds.length > 0) params.set('teamIds', teamIds.join(','));
    stampParams(params);
    return scopedJson(`${backendUrl}/api/backlog-epics?${params.toString()}`, 'Backlog epics', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const fetchStorySubtasks = (backendUrl, { parentKey, sprint, refresh = false, signal, automatic = false } = {}) => {
    const params = new URLSearchParams({
        parentKey: String(parentKey || ''),
        sprint: String(sprint || ''),
        t: Date.now().toString()
    });
    if (refresh) {
        params.set('refresh', 'true');
    }
    stampParams(params);
    return scopedTracked('eng_subtasks', `${backendUrl}/api/issues/subtasks?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    }, { featureName: 'eng', ...(automatic ? { suppressAbortResult: true } : {}) });
};

export const fetchBacklogEpics = (backendUrl, { project, teamIds = [], signal } = {}) => {
    const params = new URLSearchParams({
        t: Date.now().toString(),
        project: project || 'all'
    });
    if (teamIds.length > 0) {
        params.set('teamIds', teamIds.join(','));
    }
    stampParams(params);
    return scopedJson(`${backendUrl}/api/backlog-epics?${params.toString()}`, 'Backlog epics', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const fetchExcludedCapacityStatsSource = (backendUrl, { sprintIds = [], teamIds = [], groupId, refresh = false, signal, scoped = true } = {}) => {
    // A mixed-era range is sent unstamped: the server admits each sprintId through its own source.
    const selectors = { sprintIds, teamIds, ...(groupId ? { groupId } : {}) };
    const body = scoped ? stampBody(selectors) : selectors;
    if (refresh) body.refresh = true;
    return scopedFetch(`${backendUrl}/api/stats/excluded-capacity-source`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
        },
        cache: 'no-cache',
        signal,
        body: JSON.stringify(body)
    });
};

// The body is exactly `{ keys, refresh? }` (the server rejects any other field); the work selectors travel in the
// query string, where the route admits them like every other work read.
export const fetchDependencies = (backendUrl, keys, { signal, refresh = false } = {}) => {
    const query = stampParams(new URLSearchParams()).toString();
    return scopedFetch(`${backendUrl}/api/dependencies${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
        },
        body: JSON.stringify(refresh ? { keys, refresh: true } : { keys }),
        signal
    });
};
