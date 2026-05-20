import { getJson } from './http.js';

const postJsonWithCsrf = (backendUrl, path, payload) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' }).then(({ csrfToken }) =>
        fetch(`${backendUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'jira-execution-planner',
                'X-CSRF-Token': csrfToken || '',
            },
            body: JSON.stringify(payload)
        })
    );

export const normalizeAppConfig = (config) => {
    const normalized = { ...(config || {}) };
    const viewConfig = normalized.viewConfig || normalized.resolvedView || null;
    if (viewConfig && !normalized.viewConfig) {
        normalized.viewConfig = viewConfig;
    }
    if (!normalized.epm && viewConfig?.view?.epm) {
        normalized.epm = viewConfig.view.epm;
    }
    return normalized;
};

export const fetchAppConfig = (backendUrl) =>
    getJson(`${backendUrl}/api/config?includeViewConfig=true`, 'Config').then(normalizeAppConfig);

export const fetchVersionInfo = (backendUrl) =>
    getJson(`${backendUrl}/api/version`, 'Version', { cache: 'no-cache' });

export const testJiraConnection = (backendUrl) =>
    fetch(`${backendUrl}/api/test`);

export const fetchGroupsConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/groups-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveGroupsConfig = (backendUrl, payload) =>
    postJsonWithCsrf(backendUrl, '/api/groups-config', payload);

export const fetchSelectedProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/projects/selected`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveSelectedProjects = (backendUrl, selected) =>
    postJsonWithCsrf(backendUrl, '/api/projects/selected', { selected });

export const fetchBoardConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/board-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveBoardConfig = (backendUrl, payload) =>
    postJsonWithCsrf(backendUrl, '/api/board-config', payload);

export const fetchPriorityWeightsConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/stats/priority-weights-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const savePriorityWeightsConfig = (backendUrl, weights) =>
    postJsonWithCsrf(backendUrl, '/api/stats/priority-weights-config', { weights });

export const fetchCapacityConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/capacity/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveCapacityConfig = (backendUrl, payload) =>
    postJsonWithCsrf(backendUrl, '/api/capacity/config', payload);

export const fetchFieldConfig = (backendUrl, endpoint) =>
    fetch(`${backendUrl}/api/${endpoint}/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveFieldConfig = (backendUrl, endpoint, payload) =>
    postJsonWithCsrf(backendUrl, `/api/${endpoint}/config`, payload);

export const fetchIssueTypesConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/issue-types/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveIssueTypesConfig = (backendUrl, issueTypes) =>
    postJsonWithCsrf(backendUrl, '/api/issue-types/config', { issueTypes });

export const fetchAvailableIssueTypes = (backendUrl) =>
    fetch(`${backendUrl}/api/issue-types`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
