import { getJson, trackedFetch } from './http.js';

const postJsonWithCsrf = (backendUrl, path, payload, analytics) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' }).then(({ csrfToken }) =>
        trackedFetch(analytics?.apiSurface || 'settings_save', `${backendUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'jira-execution-planner',
                'X-CSRF-Token': csrfToken || '',
            },
            body: JSON.stringify(payload)
        }, { featureName: analytics?.featureName || 'settings' })
    );

const workspaceConfigJson = async (response) => {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(payload?.message || payload?.error || `Save failed (${response.status})`);
        error.status = response.status;
        error.payload = payload;
        error.code = payload?.error || '';
        throw error;
    }
    return payload;
};

const postWorkspaceConfig = (backendUrl, path, payload) =>
    postJsonWithCsrf(backendUrl, path, payload, { apiSurface: 'settings_save' }).then(workspaceConfigJson);

export const normalizeAppConfig = (config) => {
    const normalized = { ...(config || {}) };
    const viewConfig = normalized.viewConfig || normalized.resolvedView || null;
    if (viewConfig && !normalized.viewConfig) {
        normalized.viewConfig = viewConfig;
    }
    if (!normalized.epm && normalized.sharedConfig?.epm) normalized.epm = normalized.sharedConfig.epm;
    return normalized;
};

export const fetchAppConfig = (backendUrl) =>
    getJson(`${backendUrl}/api/config?includeViewConfig=true`, 'Config', {
        analytics: { apiSurface: 'config_bootstrap', featureName: 'config' },
    }).then(normalizeAppConfig);

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
    postJsonWithCsrf(backendUrl, '/api/groups-config', payload, { apiSurface: 'settings_save' });

export const saveGroupPreferences = (backendUrl, payload) =>
    postJsonWithCsrf(backendUrl, '/api/groups-preferences', payload, {
        apiSurface: 'settings_save',
        featureName: 'settings'
    });

export const fetchSelectedProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/projects/selected`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveSelectedProjects = (backendUrl, selected, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/projects/selected', { selected, baseRevision });

export const fetchBoardConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/board-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveBoardConfig = (backendUrl, payload, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/board-config', { ...payload, baseRevision });

export const fetchPriorityWeightsConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/stats/priority-weights-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const savePriorityWeightsConfig = (backendUrl, weights, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/stats/priority-weights-config', { weights, baseRevision });

export const fetchCapacityConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/capacity/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveCapacityConfig = (backendUrl, payload, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/capacity/config', { ...payload, baseRevision });

export const fetchFieldConfig = (backendUrl, endpoint) =>
    fetch(`${backendUrl}/api/${endpoint}/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveFieldConfig = (backendUrl, endpoint, payload, baseRevision) =>
    postWorkspaceConfig(backendUrl, `/api/${endpoint}/config`, { ...payload, baseRevision });

export const fetchIssueTypesConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/issue-types/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveIssueTypesConfig = (backendUrl, issueTypes, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/issue-types/config', { issueTypes, baseRevision });

export const fetchAvailableIssueTypes = (backendUrl) =>
    fetch(`${backendUrl}/api/issue-types`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
