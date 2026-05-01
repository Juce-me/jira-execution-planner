import { getJson } from './http.js';

export const fetchJiraLabels = (backendUrl, { query = '', prefix = '', limit = 20 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query) {
        params.set('query', query);
    } else if (prefix) {
        params.set('prefix', prefix);
    }
    return getJson(`${backendUrl}/api/jira/labels?${params.toString()}`, 'Labels', { cache: 'no-cache' });
};

export const fetchTeamCatalog = (backendUrl) =>
    fetch(`${backendUrl}/api/team-catalog?t=${Date.now()}`);

export const saveTeamCatalog = (backendUrl, { catalog, meta, merge }) =>
    fetch(`${backendUrl}/api/team-catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog, meta, merge })
    });

export const fetchAllTeams = (backendUrl, { sprint }) => {
    const sprintParam = sprint || '';
    return fetch(`${backendUrl}/api/teams?_t=${Date.now()}&sprint=${sprintParam}&all=true`);
};

export const resolveTeams = (backendUrl, teamIds) => {
    const params = new URLSearchParams({
        teamIds: teamIds.join(','),
        t: Date.now().toString()
    });
    return fetch(`${backendUrl}/api/teams/resolve?${params.toString()}`);
};

export const fetchProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/projects`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const fetchBoards = (backendUrl) =>
    fetch(`${backendUrl}/api/boards`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const searchProjects = (backendUrl, { query, signal }) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', '25');
    return fetch(`${backendUrl}/api/projects?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const searchBoards = (backendUrl, { query, signal }) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', '25');
    return fetch(`${backendUrl}/api/boards?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const searchComponents = (backendUrl, { query, signal }) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', '15');
    return fetch(`${backendUrl}/api/components?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const searchEpics = (backendUrl, { query, signal }) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', '15');
    return fetch(`${backendUrl}/api/epics/search?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const fetchFields = (backendUrl, { projectKey } = {}) => {
    const params = projectKey ? `?project=${encodeURIComponent(projectKey)}` : '';
    return fetch(`${backendUrl}/api/fields${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
};
