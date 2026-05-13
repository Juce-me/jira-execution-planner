import { getJson, postJson } from './http.js';

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
    return fetch(url, options).then(response => epmJson(response, label));
}

export const fetchEpmConfig = (backendUrl) =>
    getJson(`${backendUrl}/api/epm/config`, 'EPM config', { cache: 'no-cache' });

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
    return getJson(url, 'EPM projects', { cache: 'no-cache' });
};

export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const refreshParam = forceRefresh ? '?refresh=true' : '';
    return postJson(`${backendUrl}/api/epm/projects/configuration${refreshParam}`, draftConfig || {}, 'EPM project configuration', {
        cache: 'no-cache'
    });
}

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint, subGoalKeys } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    appendEpmSubGoalKeysParam(params, subGoalKeys);
    return getEpmJson(`${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`, 'EPM rollup', { cache: 'no-cache' });
};

export const fetchEpmAllProjectsRollup = (backendUrl, { tab, sprint, subGoalKeys } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    appendEpmSubGoalKeysParam(params, subGoalKeys);
    return getEpmJson(`${backendUrl}/api/epm/projects/rollup/all?${params.toString()}`, 'EPM all-projects rollup', { cache: 'no-cache' });
};
