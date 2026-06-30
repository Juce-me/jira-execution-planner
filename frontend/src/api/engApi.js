import { getJson, trackedFetch } from './http.js';

export const fetchMissingPlanningInfo = (backendUrl, { sprintId, teamIds = [], components = [], signal } = {}) => {
    const params = new URLSearchParams({ sprint: String(sprintId), t: Date.now().toString() });
    if (teamIds.length) {
        params.set('teamIds', teamIds.join(','));
    }
    if (components.length) {
        params.set('components', components.join(','));
    }
    return fetch(`${backendUrl}/api/missing-info?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const fetchSprints = (backendUrl, { forceRefresh = false } = {}) => {
    const params = new URLSearchParams({
        t: Date.now().toString()
    });
    if (forceRefresh) {
        params.append('refresh', 'true');
    }
    return fetch(`${backendUrl}/api/sprints?${params}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        cache: 'no-cache'
    });
};

export const fetchCapacity = (backendUrl, { sprintName, teams = [] } = {}) => {
    const params = new URLSearchParams({
        sprint: sprintName,
        t: Date.now().toString()
    });
    if (teams.length) {
        params.append('teams', teams.join(','));
    }
    return fetch(`${backendUrl}/api/capacity?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
};

export const fetchEngTasks = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], refresh = false, purpose = '', epicKeys = [], signal } = {}) => {
    const params = new URLSearchParams({
        t: Date.now().toString(),
        sprint,
        sprintName,
        team: 'all',
        project: project || 'all',
        groupId: groupId || ''
    });
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
    return trackedFetch('eng_tasks', `${backendUrl}/api/tasks-with-team-name?${params.toString()}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        cache: 'no-cache',
        signal
    }, { featureName: 'eng' });
};

export const fetchStorySubtasks = (backendUrl, { parentKey, sprint, refresh = false, signal } = {}) => {
    const params = new URLSearchParams({
        parentKey: String(parentKey || ''),
        sprint: String(sprint || ''),
        t: Date.now().toString()
    });
    if (refresh) {
        params.set('refresh', 'true');
    }
    return trackedFetch('eng_subtasks', `${backendUrl}/api/issues/subtasks?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    }, { featureName: 'eng' });
};

export const fetchBacklogEpics = (backendUrl, { project, teamIds = [] } = {}) => {
    const params = new URLSearchParams({
        t: Date.now().toString(),
        project: project || 'all'
    });
    if (teamIds.length > 0) {
        params.set('teamIds', teamIds.join(','));
    }
    return getJson(`${backendUrl}/api/backlog-epics?${params.toString()}`, 'Backlog epics', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
};

export const fetchExcludedCapacityStatsSource = (backendUrl, { sprintIds = [], teamIds = [], refresh = false, signal } = {}) => {
    const body = { sprintIds, teamIds };
    if (refresh) body.refresh = true;
    return fetch(`${backendUrl}/api/stats/excluded-capacity-source`, {
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

export const fetchDependencies = (backendUrl, keys, { signal } = {}) =>
    fetch(`${backendUrl}/api/dependencies`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
        },
        body: JSON.stringify({ keys }),
        signal
    });

export const fetchProjectTrackPhaseDurations = (backendUrl, { epicKeys = [], signal } = {}) =>
    fetch(`${backendUrl}/api/stats/project-track-phase-durations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
        },
        cache: 'no-cache',
        signal,
        body: JSON.stringify({ epicKeys }),
    });
