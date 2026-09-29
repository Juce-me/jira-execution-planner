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

function normalizedConflictValue(value) {
    if (value === null || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const accountId = typeof value.accountId === 'string' ? value.accountId : '';
    if (!accountId) return undefined;
    return {
        accountId,
        ...(typeof value.displayName === 'string' && value.displayName ? { displayName: value.displayName } : {}),
    };
}

function issueFieldError(response, data) {
    const code = typeof data?.error === 'string' && data.error ? data.error : 'jira_issue_field_failed';
    const error = new Error(code);
    error.status = response.status;
    error.code = code;
    if (code === 'stale_issue') {
        if (typeof data?.issueKey === 'string') error.issueKey = data.issueKey;
        if (['assignee', 'deliveryOwner', 'storyPoints'].includes(data?.field)) error.field = data.field;
        const currentValue = normalizedConflictValue(data?.currentValue);
        if (currentValue !== undefined) error.currentValue = currentValue;
        if (typeof data?.baseUpdated === 'string') error.baseUpdated = data.baseUpdated;
        if (typeof data?.mappingRevision === 'string') error.mappingRevision = data.mappingRevision;
    }
    if (code === 'jira_rate_limited') {
        const retryAfterSeconds = Number(data?.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds)) {
            error.retryAfterSeconds = Math.max(1, Math.min(60, Math.ceil(retryAfterSeconds)));
        }
    }
    return error;
}

async function issueFieldJsonOrError(response) {
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw issueFieldError(response, data);
    }
    return response.json();
}

function issueFieldUrl(backendUrl, issueKey, suffix) {
    return `${backendUrl}/api/issues/${encodeURIComponent(String(issueKey || '').trim())}/${suffix}`;
}

export function fetchEditableIssueField(backendUrl, issueKey, field, { signal } = {}) {
    const query = new URLSearchParams({ field: String(field || '') });
    return trackedFetch('jira_issue_field_edits', `${issueFieldUrl(backendUrl, issueKey, 'editable-fields')}?${query}`, {
        method: 'GET', cache: 'no-cache', signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_issue_field_edits', suppressAbortResult: true })
        .then(issueFieldJsonOrError);
}

export async function searchIssueFieldUsers(backendUrl, issueKey, payload, { signal } = {}) {
    const { csrfToken } = await fetchMutationCsrfToken(backendUrl);
    return trackedFetch('jira_issue_field_edits', issueFieldUrl(backendUrl, issueKey, 'user-options'), {
        method: 'POST', cache: 'no-cache', signal, headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_issue_field_edits', suppressAbortResult: true }).then(issueFieldJsonOrError);
}

export async function updateIssueField(backendUrl, issueKey, payload, { signal } = {}) {
    const { csrfToken } = await fetchMutationCsrfToken(backendUrl);
    return trackedFetch('jira_issue_field_edits', issueFieldUrl(backendUrl, issueKey, 'field'), {
        method: 'POST', cache: 'no-cache', signal, headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_issue_field_edits' }).then(issueFieldJsonOrError);
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

export function fetchIssueProjectTrackOptions(backendUrl, { issueKey, signal } = {}) {
    const query = `?issueKey=${encodeURIComponent(issueKey || '')}`;
    return trackedFetch('jira_issue_project_track', `${backendUrl}/api/issues/project-track/options${query}`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_project_track_changes' }).then(response => jsonOrStructuredError(response, 'Issue project track options'));
}

export async function updateIssueProjectTrack(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchMutationCsrfToken(backendUrl);
    return trackedFetch('jira_issue_project_track', `${backendUrl}/api/issues/project-track`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(payload),
    }, { featureName: 'eng_project_track_changes' }).then(response => jsonOrStructuredError(response, 'Issue project track update'));
}

export function fetchIssueStatusCatalog(backendUrl, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/statuses/catalog`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue status catalog'));
}
