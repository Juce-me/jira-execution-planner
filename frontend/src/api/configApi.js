import { apiFetch, getJson, jsonOrStructuredError, trackedFetch } from './http.js';

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
    if (viewConfig?.view?.epm) normalized.epm = viewConfig.view.epm;
    return normalized;
};

export const fetchAppConfig = (backendUrl, options = {}) =>
    getJson(`${backendUrl}/api/config?includeViewConfig=true`, 'Config', {
        ...options,
        analytics: { apiSurface: 'config_bootstrap', featureName: 'config' },
    }).then(normalizeAppConfig);

// The startup config read gates all sprint discovery and ENG Jira work, so a hung response must end
// as a retryable connection failure instead of an endless loading state.
export const CONFIG_BOOTSTRAP_TIMEOUT_MS = 15_000;

export class ConfigBootstrapTimeoutError extends Error {
    constructor() {
        super('The server did not answer the startup configuration request in time.');
        this.name = 'ConfigBootstrapTimeoutError';
    }
}

export const fetchBootstrapConfig = (backendUrl) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, CONFIG_BOOTSTRAP_TIMEOUT_MS);
    return fetchAppConfig(backendUrl, { signal: controller.signal })
        .catch(error => {
            throw timedOut && error?.name === 'AbortError' ? new ConfigBootstrapTimeoutError() : error;
        })
        .finally(() => clearTimeout(timer));
};

export const testJiraConnection = (backendUrl) =>
    apiFetch(`${backendUrl}/api/test`);

export const fetchGroupsConfig = (backendUrl) =>
    apiFetch(`${backendUrl}/api/groups-config`, {
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

const postOnboardingPreference = (backendUrl, payload) =>
    postJsonWithCsrf(backendUrl, '/api/me/onboarding', payload, {
        apiSurface: 'settings_save',
        featureName: 'settings'
    }).then(response => jsonOrStructuredError(response, 'Onboarding preference'));

export const completeOnboardingModule = (backendUrl, moduleId) =>
    postOnboardingPreference(backendUrl, { completedModule: moduleId });

export const resetOnboardingModules = (backendUrl) =>
    postOnboardingPreference(backendUrl, { onboardingDone: false });

export const saveOnboardingPreference = (backendUrl, onboardingDone) =>
    postOnboardingPreference(backendUrl, { onboardingDone });

export const fetchSelectedProjects = (backendUrl) =>
    apiFetch(`${backendUrl}/api/projects/selected`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveSelectedProjects = (backendUrl, selected, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/projects/selected', { selected, baseRevision });

export const fetchBoardConfig = (backendUrl) =>
    apiFetch(`${backendUrl}/api/board-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveBoardConfig = (backendUrl, payload, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/board-config', { ...payload, baseRevision });

export const fetchPriorityWeightsConfig = (backendUrl) =>
    apiFetch(`${backendUrl}/api/stats/priority-weights-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const savePriorityWeightsConfig = (backendUrl, weights, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/stats/priority-weights-config', { weights, baseRevision });

export const saveScenarioAccessConfig = (backendUrl, enabledForEveryone, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/scenario-access/config', { enabledForEveryone, baseRevision });

export const fetchCapacityConfig = (backendUrl) =>
    apiFetch(`${backendUrl}/api/capacity/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const buildCapacityConfigPayload = (payload = {}) => {
    const scoped = {
        project: payload.project,
        fieldId: payload.fieldId,
        fieldName: payload.fieldName,
    };
    if (Number.isInteger(payload.baseRevision)) {
        scoped.baseRevision = payload.baseRevision;
    }
    return scoped;
};

export const saveCapacityConfig = (backendUrl, payload, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/capacity/config', buildCapacityConfigPayload({ ...payload, baseRevision }));

export const fetchFieldConfig = (backendUrl, endpoint) =>
    apiFetch(`${backendUrl}/api/${endpoint}/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveFieldConfig = (backendUrl, endpoint, payload, baseRevision) =>
    postWorkspaceConfig(backendUrl, `/api/${endpoint}/config`, { ...payload, baseRevision });

export const fetchIssueTypesConfig = (backendUrl) =>
    apiFetch(`${backendUrl}/api/issue-types/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveIssueTypesConfig = (backendUrl, issueTypes, baseRevision) =>
    postWorkspaceConfig(backendUrl, '/api/issue-types/config', { issueTypes, baseRevision });

export const fetchAvailableIssueTypes = (backendUrl) =>
    apiFetch(`${backendUrl}/api/issue-types`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

// Quarterly Project config bundle. GET returns {workConfigurations,configRevision,promoted,
// userCanEditSettings,featureEnabled}; POST carries the whole bundle (first save adds legacyEdits,
// later saves add clearProjectsForConfigurationIds). Failures throw with .status/.payload/.code.
export const fetchWorkStructureConfig = (backendUrl, { signal } = {}) =>
    apiFetch(`${backendUrl}/api/work-structure/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal,
    }).then(workspaceConfigJson);

// Range-agnostic Sprint values observed by the saved sources, for the Scope boundary pickers:
// {sprintValues:[{value,label,canonical,state,sprintIds,configurationIds}],sources,promoted}. Metadata read; no quarter.
export const fetchWorkSprintValues = (backendUrl, { signal } = {}) =>
    apiFetch(`${backendUrl}/api/work-structure/sprint-values`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal,
    }).then(workspaceConfigJson);

// One saved configuration's Sprint catalog: `refresh` starts a read from Jira; a pending answer is completed by repeating
// the read with the attempt and catalog identity it named (the existing Sprint catalog completion contract).
export const fetchConfigurationSprints = (backendUrl, { configurationId, refresh = false, completionAttemptId = null, catalogIdentity = null, signal } = {}) => {
    const params = new URLSearchParams({ configurationId });
    if (refresh) params.set('refresh', 'true');
    if (completionAttemptId) {
        params.set('completionAttemptId', String(completionAttemptId));
        params.set('catalogIdentity', String(catalogIdentity));
    }
    return apiFetch(`${backendUrl}/api/sprints?${params.toString()}`, {
        method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-cache', signal,
    }).then(async response => ({ httpStatus: response.status, ...(await response.json().catch(() => ({}))) }));
};

export const saveWorkStructureConfig = (backendUrl, payload) =>
    postWorkspaceConfig(backendUrl, '/api/work-structure/config', payload);

// Saved-configuration Test: sanitized {ok,status,code,configurationId,configurationRevision,
// missingFields,checks}; the server reads only the saved entry.
export const testWorkConfiguration = (backendUrl, { configurationId, configurationRevision }) => {
    const params = new URLSearchParams({
        configurationId: String(configurationId),
        configurationRevision: String(configurationRevision),
    });
    return apiFetch(`${backendUrl}/api/test?${params.toString()}`, { method: 'GET', cache: 'no-cache' });
};

export const fetchWorkIssueTypes = (backendUrl, { configurationId, configurationRevision, signal } = {}) => {
    const params = new URLSearchParams({
        configurationId: String(configurationId),
        configurationRevision: String(configurationRevision),
    });
    return apiFetch(`${backendUrl}/api/issue-types?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal,
    });
};
