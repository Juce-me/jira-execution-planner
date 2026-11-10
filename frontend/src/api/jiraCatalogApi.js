import { apiFetch, getJson } from './http.js';
import { applyContextToParams } from '../workStructure/configurationContext.js';

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

// A Jira issue type's own icon (PNG), read by the server with the viewer's Jira auth. Kept relative: the page's CSP
// allows images from its own origin only.
export const issueTypeIconUrl = typeId => `/api/issue-type-icon/${typeId}`;

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

export const fetchAllTeams = (backendUrl, {
    context = null,
    sprint,
    refresh = false,
    completionAttemptId = null,
    catalogIdentity = null,
    signal,
} = {}) => {
    if (Boolean(completionAttemptId) !== Boolean(catalogIdentity)) {
        return Promise.reject(new Error('Team completion reads require attempt and catalog identity.'));
    }
    if (refresh && completionAttemptId) {
        return Promise.reject(new Error('Team completion reads cannot force a refresh.'));
    }
    const params = new URLSearchParams({
        sprint: String(sprint || ''),
        all: 'true',
    });
    if (refresh) params.set('refresh', 'true');
    if (completionAttemptId) params.set('completionAttemptId', String(completionAttemptId));
    if (catalogIdentity) params.set('catalogIdentity', String(catalogIdentity));
    applyContextToParams(params, context, { includeQuarter: false });
    return apiFetch(`${backendUrl}/api/teams?${params.toString()}`, {
        cache: 'no-cache',
        signal,
    });
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

// DELIVERY Allocation values for the Product/Tech mapping, read with the editor draft's field, project and planning type.
export const searchAllocationOptions = (backendUrl, { query, fieldId, projectKey, issueTypeId, signal }) => {
    const params = new URLSearchParams({ fieldId, query });
    if (projectKey) params.set('projectKey', projectKey);
    if (issueTypeId) params.set('issueTypeId', issueTypeId);
    return apiFetch(`${backendUrl}/api/work-structure/allocation-options?${params.toString()}`, {
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

export const searchComponents = (backendUrl, { query, signal, configurationId = '', configurationRevision = null, quarter = '' }) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('limit', '15');
    if (configurationId) {
        params.set('configurationId', String(configurationId));
        params.set('configurationRevision', String(configurationRevision ?? ''));
        if (quarter) params.set('quarter', String(quarter));
    }
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
