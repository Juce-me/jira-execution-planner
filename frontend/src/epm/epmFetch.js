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

export const fetchEpmProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/projects`, { cache: 'no-cache' }).then(response => json(response, 'EPM projects'));

export const previewEpmProjects = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/epm/projects/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(response => json(response, 'EPM preview'));

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint } = {}) => {
    const params = new URLSearchParams({ tab: tab || 'active' });
    if (tab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    return fetch(`${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`, { cache: 'no-cache' })
        .then(response => json(response, 'EPM rollup'));
};
