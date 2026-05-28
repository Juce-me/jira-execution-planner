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
    fetch(`${backendUrl}/api/stats/burnout`, statsPostOptions(payload, signal));

export const fetchEpicCohortStats = (backendUrl, payload, { signal } = {}) =>
    fetch(`${backendUrl}/api/stats/epic-cohort`, statsPostOptions(payload, signal));
