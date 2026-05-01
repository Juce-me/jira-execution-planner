const json = async (response, label) => {
    if (!response.ok) {
        throw new Error(`${label} error ${response.status}`);
    }
    return response.json();
};

export const fetchEpmConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/config`, { cache: 'no-cache' }).then(response => json(response, 'EPM config'));

export const fetchEpmScope = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/scope`, { cache: 'no-cache' }).then(response => json(response, 'EPM scope'));

export const fetchEpmGoals = (backendUrl, rootGoalKey = '') => {
    const key = String(rootGoalKey || '').trim();
    const url = key
        ? `${backendUrl}/api/epm/goals?rootGoalKey=${encodeURIComponent(key)}`
        : `${backendUrl}/api/epm/goals`;
    return fetch(url, { cache: 'no-cache' }).then(response => json(response, 'EPM goals'));
};

export const fetchEpmProjects = (backendUrl, { tab } = {}) => {
    const params = new URLSearchParams();
    if (tab) {
        params.set('tab', String(tab));
    }
    const query = params.toString();
    const url = query ? `${backendUrl}/api/epm/projects?${query}` : `${backendUrl}/api/epm/projects`;
    return fetch(url, { cache: 'no-cache' }).then(response => json(response, 'EPM projects'));
};

export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const refreshParam = forceRefresh ? '?refresh=true' : '';
    return fetch(`${backendUrl}/api/epm/projects/configuration${refreshParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftConfig || {}),
        cache: 'no-cache'
    }).then(response => json(response, 'EPM project configuration'));
}

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    return fetch(`${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`, { cache: 'no-cache' })
        .then(response => json(response, 'EPM rollup'));
};

export const fetchEpmAllProjectsRollup = (backendUrl, { tab, sprint } = {}) => {
    const effectiveTab = tab || 'active';
    const params = new URLSearchParams({ tab: effectiveTab });
    if (effectiveTab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    return fetch(`${backendUrl}/api/epm/projects/rollup/all?${params.toString()}`, { cache: 'no-cache' })
        .then(response => json(response, 'EPM all-projects rollup'));
};
