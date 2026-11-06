import { fetchCsrfToken } from './authApi.js';
import { jsonOrStructuredError, trackedFetch } from './http.js';
import { isStaleWorkContextError, reportWorkContextStale, stampWriteBody, stampWriteParams } from '../workStructure/requestContext.js';
import { workWriteErrorMessage } from '../workStructure/writeErrors.js';

// After promotion every issue write/option call names the configuration it was rendered under; before it (no active
// context) the shapes are untouched. A `configuration_scope_changed` rejection asks the dashboard to re-read the
// configuration and is re-thrown: the draft stays and nothing here retries the write.
const surfaceStale = (error) => {
    if (isStaleWorkContextError(error)) reportWorkContextStale();
    const safe = workWriteErrorMessage(error?.code);
    if (safe && (error?.status === 409 || error?.status === 400)) error.message = safe;
    throw error;
};
const withQuery = (path, params) => {
    const query = params.toString();
    return query ? `${path}?${query}` : path;
};

const headers = (csrfToken = '') => ({
    'Content-Type': 'application/json',
    'X-Requested-With': 'jira-execution-planner',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
});

function normalizedConflictValue(value) {
    if (typeof value === 'string') return value;
    if (value?.id && typeof value.id === 'string') return { id: value.id, name: typeof value.name === 'string' ? value.name : '' };
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
    const error = new Error(workWriteErrorMessage(code) || code);
    error.status = response.status;
    error.code = code;
    if (code === 'stale_issue') {
        if (typeof data?.issueKey === 'string') error.issueKey = data.issueKey;
        if (['assignee', 'deliveryOwner', 'storyPoints', 'summary', 'team'].includes(data?.field)) error.field = data.field;
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
    const query = stampWriteParams(new URLSearchParams({ field: String(field || '') }));
    return trackedFetch('jira_issue_field_edits', withQuery(issueFieldUrl(backendUrl, issueKey, 'editable-fields'), query), {
        method: 'GET', cache: 'no-cache', signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_issue_field_edits', suppressAbortResult: true })
        .then(issueFieldJsonOrError).catch(surfaceStale);
}

export async function searchIssueFieldUsers(backendUrl, issueKey, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_field_edits', issueFieldUrl(backendUrl, issueKey, 'user-options'), {
        method: 'POST', cache: 'no-cache', signal, headers: headers(csrfToken || ''),
        body: JSON.stringify(stampWriteBody(payload)),
    }, { featureName: 'eng_issue_field_edits', suppressAbortResult: true }).then(issueFieldJsonOrError).catch(surfaceStale);
}

export async function updateIssueField(backendUrl, issueKey, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_field_edits', issueFieldUrl(backendUrl, issueKey, 'field'), {
        method: 'POST', cache: 'no-cache', signal, headers: headers(csrfToken || ''),
        body: JSON.stringify(stampWriteBody(payload)),
    }, { featureName: 'eng_issue_field_edits' }).then(issueFieldJsonOrError).catch(surfaceStale);
}

export function fetchIssueTransitionOptions(backendUrl, issueKeys, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions/options`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(),
        body: JSON.stringify(stampWriteBody({ issueKeys })),
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue transition options')).catch(surfaceStale);
}

export async function transitionIssues(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/transitions`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(stampWriteBody(payload)),
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue transition')).catch(surfaceStale);
}

export function fetchIssuePriorityOptions(backendUrl, { issueKey, signal } = {}) {
    // With an issueKey the backend filters the catalog to that issue's own priority scheme
    // (editmeta); without it the full site catalog is returned (backward-compatible URL).
    // The no-issue site catalog stays unscoped; only an issue-scoped read names the configuration.
    const key = String(issueKey || '').trim();
    const params = new URLSearchParams();
    if (key) {
        params.set('issueKey', key);
        stampWriteParams(params);
    }
    const query = key ? `?${params}` : '';
    return trackedFetch('jira_issue_priorities', `${backendUrl}/api/issues/priorities/options${query}`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_priority_changes' }).then(response => jsonOrStructuredError(response, 'Issue priority options')).catch(surfaceStale);
}

export async function updateIssuePriorities(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_priorities', `${backendUrl}/api/issues/priorities`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(stampWriteBody(payload)),
    }, { featureName: 'eng_priority_changes' }).then(response => jsonOrStructuredError(response, 'Issue priority update')).catch(surfaceStale);
}

export function fetchIssueProjectTrackOptions(backendUrl, { issueKey, signal } = {}) {
    const query = `?${stampWriteParams(new URLSearchParams({ issueKey: String(issueKey || '') }))}`;
    return trackedFetch('jira_issue_project_track', `${backendUrl}/api/issues/project-track/options${query}`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_project_track_changes' }).then(response => jsonOrStructuredError(response, 'Issue project track options')).catch(surfaceStale);
}

export async function updateIssueProjectTrack(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    return trackedFetch('jira_issue_project_track', `${backendUrl}/api/issues/project-track`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: headers(csrfToken || ''),
        body: JSON.stringify(stampWriteBody(payload)),
    }, { featureName: 'eng_project_track_changes' }).then(response => jsonOrStructuredError(response, 'Issue project track update')).catch(surfaceStale);
}

export function fetchIssueStatusCatalog(backendUrl, { signal } = {}) {
    return trackedFetch('jira_issue_transitions', `${backendUrl}/api/issues/statuses/catalog`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { 'X-Requested-With': 'jira-execution-planner' },
    }, { featureName: 'eng_status_transitions' }).then(response => jsonOrStructuredError(response, 'Issue status catalog'));
}
