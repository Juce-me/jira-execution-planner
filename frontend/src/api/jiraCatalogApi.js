import { apiFetch, getJson } from './http.js';

const postJsonWithCsrf = (backendUrl, path, payload) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' }).then(({ csrfToken }) =>
        apiFetch(`${backendUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'jira-execution-planner',
                'X-CSRF-Token': csrfToken || '',
            },
            body: JSON.stringify(payload)
        })
    );

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
    apiFetch(`${backendUrl}/api/team-catalog?t=${Date.now()}`);

export const saveTeamCatalog = (backendUrl, { catalog, meta, merge }) =>
    postJsonWithCsrf(backendUrl, '/api/team-catalog', { catalog, meta, merge });

export const fetchAllTeams = (backendUrl, { sprint }) => {
    const sprintParam = sprint || '';
    return apiFetch(`${backendUrl}/api/teams?_t=${Date.now()}&sprint=${sprintParam}&all=true`);
};

export const resolveTeams = (backendUrl, teamIds) => {
    const params = new URLSearchParams({
        teamIds: teamIds.join(','),
        t: Date.now().toString()
    });
    return apiFetch(`${backendUrl}/api/teams/resolve?${params.toString()}`);
};

export const fetchProjects = (backendUrl) =>
    apiFetch(`${backendUrl}/api/projects`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const fetchBoards = (backendUrl) =>
    apiFetch(`${backendUrl}/api/boards`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const searchProjects = (backendUrl, { query, signal }) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', '25');
    return apiFetch(`${backendUrl}/api/projects?${params.toString()}`, {
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
    return apiFetch(`${backendUrl}/api/boards?${params.toString()}`, {
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
    return apiFetch(`${backendUrl}/api/components?${params.toString()}`, {
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
    return apiFetch(`${backendUrl}/api/epics/search?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal
    });
};

export const fetchFields = (backendUrl, { projectKey } = {}) => {
    const params = projectKey ? `?project=${encodeURIComponent(projectKey)}` : '';
    return apiFetch(`${backendUrl}/api/fields${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
};
