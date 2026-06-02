import { trackedFetch } from './http.js';

const statsPostOptions = (payload, signal) => ({
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'jira-execution-planner'
    },
    cache: 'no-cache',
    signal,
    body: JSON.stringify(payload)
});

export const fetchBurnoutStats = (backendUrl, payload, { signal } = {}) =>
    trackedFetch('stats_source', `${backendUrl}/api/stats/burnout`, statsPostOptions(payload, signal), { featureName: 'stats' });

export const fetchEpicCohortStats = (backendUrl, payload, { signal } = {}) =>
    trackedFetch('stats_source', `${backendUrl}/api/stats/epic-cohort`, statsPostOptions(payload, signal), { featureName: 'stats' });
