import { getJson, postJson, trackedFetch } from './http.js';

const fetchCsrfToken = (backendUrl) =>
    getJson(`${backendUrl}/api/auth/csrf`, 'CSRF token', { cache: 'no-cache' });

const DEFAULT_EPM_ISSUE_TYPES = {
    initiative: ['Initiative'],
    epic: ['Epic'],
    leaf: ['Story', 'Task', 'Sub-task', 'Subtask', 'Bug'],
};

function normalizeTextList(values, defaults = []) {
    const normalized = Array.isArray(values)
        ? values.map(value => String(value || '').trim()).filter(Boolean)
        : [];
    return normalized.length ? normalized : [...defaults];
}

function normalizeEpmSettingsPayload(draftConfig) {
    const draft = draftConfig && typeof draftConfig === 'object' ? draftConfig : {};
    const sourceProjects = draft.projects && typeof draft.projects === 'object' ? draft.projects : {};
    const projects = {};
    Object.entries(sourceProjects).forEach(([projectKey, row]) => {
        if (!row || typeof row !== 'object') return;
        const id = String(row.id || projectKey || '').trim();
        if (!id) return;
        const rawHomeProjectId = row.homeProjectId;
        const homeProjectId = rawHomeProjectId === null || rawHomeProjectId === undefined
            ? null
            : String(rawHomeProjectId).trim();
        projects[id] = {
            id,
            name: String(row.name || '').trim(),
            label: String(row.label || '').trim(),
            homeProjectId: homeProjectId || null,
        };
    });
    return {
        version: 2,
        labelPrefix: String(draft.labelPrefix || '').trim(),
        scope: {
            rootGoalKey: String(draft.scope?.rootGoalKey || '').trim().toUpperCase(),
            subGoalKeys: normalizeTextList(draft.scope?.subGoalKeys).map(value => value.toUpperCase()),
        },
        issueTypes: {
            initiative: normalizeTextList(draft.issueTypes?.initiative, DEFAULT_EPM_ISSUE_TYPES.initiative),
            epic: normalizeTextList(draft.issueTypes?.epic, DEFAULT_EPM_ISSUE_TYPES.epic),
            leaf: normalizeTextList(draft.issueTypes?.leaf, DEFAULT_EPM_ISSUE_TYPES.leaf),
        },
        projects,
    };
}

async function epmJson(response, label) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(payload?.message || `${label} error ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        error.code = payload?.error || payload?.errorCode || '';
        error.connectUrl = payload?.connectUrl || '';
        throw error;
    }
    return payload;
}

function getEpmJson(url, label, options = {}) {
    const { analytics, ...fetchOptions } = options;
    const request = analytics
        ? trackedFetch(analytics.apiSurface, url, fetchOptions, analytics)
        : fetch(url, fetchOptions);
    return request.then(response => epmJson(response, label));
}

export const fetchEpmConfig = (backendUrl) =>
    getEpmJson(`${backendUrl}/api/epm/config`, 'EPM config', { cache: 'no-cache' });

export async function saveEpmConfig(backendUrl, draftConfig) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    const response = await trackedFetch('settings_save', `${backendUrl}/api/epm/config`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': csrfToken || ''
        },
        body: JSON.stringify(normalizeEpmSettingsPayload(draftConfig))
    }, { featureName: 'settings' });
    return epmJson(response, 'Failed to save EPM config');
}

export const fetchEpmScope = (backendUrl) =>
    getJson(`${backendUrl}/api/epm/scope`, 'EPM scope', { cache: 'no-cache' });

export const fetchEpmGoals = (backendUrl, rootGoalKey = '') => {
    const key = String(rootGoalKey || '').trim();
    const url = key
        ? `${backendUrl}/api/epm/goals?rootGoalKey=${encodeURIComponent(key)}`
        : `${backendUrl}/api/epm/goals`;
    return getJson(url, 'EPM goals', { cache: 'no-cache' });
};

const normalizeEpmSubGoalKeysParam = (subGoalKeys) => {
    const values = Array.isArray(subGoalKeys) ? subGoalKeys : [];
    const seen = new Set();
    const normalized = [];
    values.forEach((value) => {
        const key = String(value || '').trim().toUpperCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        normalized.push(key);
    });
    return normalized.join(',');
};

const appendEpmSubGoalKeysParam = (params, subGoalKeys) => {
    const value = normalizeEpmSubGoalKeysParam(subGoalKeys);
    if (value) {
        params.set('subGoalKeys', value);
    }
};

export const fetchEpmProjects = (backendUrl, { tab, subGoalKeys } = {}) => {
    const params = new URLSearchParams();
    if (tab) {
        params.set('tab', String(tab));
    }
    appendEpmSubGoalKeysParam(params, subGoalKeys);
    const query = params.toString();
    const url = query ? `${backendUrl}/api/epm/projects?${query}` : `${backendUrl}/api/epm/projects`;
    return getJson(url, 'EPM projects', {
        cache: 'no-cache',
        analytics: {
            apiSurface: 'epm_projects',
            featureName: 'epm',
            epmTab: tab || 'active',
            projectScope: 'all',
            subgoalScope: (subGoalKeys || []).length ? 'selected' : 'all',
        },
    });
};

export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const refreshParam = forceRefresh ? '?refresh=true' : '';
    return fetchCsrfToken(backendUrl).then(({ csrfToken }) =>
        postJson(`${backendUrl}/api/epm/projects/configuration${refreshParam}`, draftConfig || {}, 'EPM project configuration', {
            cache: 'no-cache',
            headers: { 'X-CSRF-Token': csrfToken || '' },
        })
    );
}

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint, subGoalKeys } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    appendEpmSubGoalKeysParam(params, subGoalKeys);
    return getEpmJson(`${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`, 'EPM rollup', {
        cache: 'no-cache',
        analytics: {
            apiSurface: 'epm_rollup',
            featureName: 'epm',
            epmTab: effectiveTab,
            projectScope: 'single',
            subgoalScope: (subGoalKeys || []).length ? 'selected' : 'all',
        },
    });
};

export const fetchEpmAllProjectsRollup = (backendUrl, { tab, sprint, subGoalKeys } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    appendEpmSubGoalKeysParam(params, subGoalKeys);
    return getEpmJson(`${backendUrl}/api/epm/projects/rollup/all?${params.toString()}`, 'EPM all-projects rollup', {
        cache: 'no-cache',
        analytics: {
            apiSurface: 'epm_rollup',
            featureName: 'epm',
            epmTab: effectiveTab,
            projectScope: 'all',
            subgoalScope: (subGoalKeys || []).length ? 'selected' : 'all',
        },
    });
};
