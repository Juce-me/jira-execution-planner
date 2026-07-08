import { fetchCsrfToken } from './authApi.js';
import { json, trackedFetch } from './http.js';

const headers = (csrfToken = '') => ({
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
});

export function fetchIssueTransitionOptions(backendUrl, issueKeys, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions/options`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(),
        body: JSON.stringify({ issueKeys }),
    }, { featureName: 'eng_status_transitions' }).then(response => json(response, 'Issue transition options'));
}

export async function transitionIssues(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_status_transitions' }).then(response => json(response, 'Issue transition'));
}
