import { getJson, postJson } from './http.js';

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

export const fetchEpmProjects = (backendUrl, { tab } = {}) => {
    const params = new URLSearchParams();
    if (tab) {
        params.set('tab', String(tab));
    }
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

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    return getJson(`${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`, 'EPM rollup', { cache: 'no-cache' });
};

export const fetchEpmAllProjectsRollup = (backendUrl, { tab, sprint } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    return getJson(`${backendUrl}/api/epm/projects/rollup/all?${params.toString()}`, 'EPM all-projects rollup', { cache: 'no-cache' });
};
