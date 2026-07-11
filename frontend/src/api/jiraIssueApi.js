import { fetchCsrfToken } from './authApi.js';
import { jsonOrStructuredError, trackedFetch } from './http.js';

const headers = (csrfToken = '') => ({
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
});

const csrfTokenRequests = new Map();

function fetchMutationCsrfToken(backendUrl) {
    const key = String(backendUrl || '');
    if (csrfTokenRequests.has(key)) return csrfTokenRequests.get(key);
    const request = Promise.resolve(fetchCsrfToken(backendUrl))
        .finally(() => {
            if (csrfTokenRequests.get(key) === request) csrfTokenRequests.delete(key);
        });
    csrfTokenRequests.set(key, request);
    return request;
}

export function fetchIssueTransitionOptions(backendUrl, issueKeys, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions/options`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(),
        body: JSON.stringify({ issueKeys }),
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue transition options'));
}

export async function transitionIssues(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchMutationCsrfToken(backendUrl);
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue transition'));
}

export function fetchIssuePriorityOptions(backendUrl, { issueKey, signal } = {}) {
    // With an issueKey the backend filters the catalog to that issue's own priority scheme
    // (editmeta); without it the full site catalog is returned (backward-compatible URL).
    const key = String(issueKey || '').trim();
    const query = key ? `?issueKey=${encodeURIComponent(key)}` : '';
    return trackedFetch('jira_issue_priorities', `${backendUrl}/api/issues/priorities/options${query}`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_priority_changes' }).then(response => jsonOrStructuredError(response, 'Issue priority options'));
}

export async function updateIssuePriorities(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchMutationCsrfToken(backendUrl);
    return trackedFetch('jira_issue_priorities', `${backendUrl}/api/issues/priorities`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_priority_changes' }).then(response => jsonOrStructuredError(response, 'Issue priority update'));
}

export function fetchIssueStatusCatalog(backendUrl, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/statuses/catalog`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue status catalog'));
}
