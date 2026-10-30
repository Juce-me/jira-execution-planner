import { fetchCsrfToken } from './authApi.js';
import { trackedFetch } from './http.js';

export const ASSIGNEE_CAPACITY_REQUEST_TIMEOUT_MS = 20000;
const url = (backendUrl, sprintId, query = '') => `${backendUrl}/api/eng/sprints/${encodeURIComponent(String(sprintId))}/assignee-capacity${query}`;

// `csrf` is a caller-owned { token } cache so one save queue fetches the CSRF token once.
async function request(backendUrl, sprintId, query, method, payload, { signal, csrf = null, timeoutMs = ASSIGNEE_CAPACITY_REQUEST_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timedOut = false, dispatched = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const csrfToken = method === 'GET' ? null : csrf?.token || await Promise.race([
            fetchCsrfToken(backendUrl).then(result => { const token = result?.csrfToken; if (csrf && token) csrf.token = token; return token; }),
            new Promise((resolve, reject) => {
                if (controller.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
                else controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            }),
        ]);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        dispatched = true;
        const response = await trackedFetch('planning_review', url(backendUrl, sprintId, query), {
            method, signal: controller.signal, cache: 'no-cache',
            headers: {
                'X-Requested-With': 'jira-execution-planner',
                ...(payload ? { 'Content-Type': 'application/json' } : {}),
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
        }, { featureName: 'planning_review', suppressAbortResult: true });
        const data = await response.json();
        if (!response.ok) {
            const error = new Error(data.message || 'Assignee capacity request failed.');
            error.status = response.status;
            error.code = data.code || data.error;
            throw error;
        }
        return data;
    } catch (error) {
        if (timedOut) { const timeout = new Error('Assignee capacity request timed out.'); timeout.code = 'assignee_capacity_timeout'; timeout.unconfirmed = method === 'PATCH' && dispatched; throw timeout; }
        else if (method === 'PATCH' && dispatched && !error.status && error.name !== 'AuthenticationRequiredError') error.unconfirmed = true;
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export const fetchAssigneeCapacity = (backendUrl, sprintId, teamId, options) => request(backendUrl, sprintId, `?teamId=${encodeURIComponent(teamId)}`, 'GET', null, options);
export const saveAssigneeCapacity = (backendUrl, sprintId, payload, options) => request(backendUrl, sprintId, '', 'PATCH', payload, options);

// Add assignee: active people assignable in the workspace's selected Product and Tech projects (no email).
// Resolves to { users: [{ accountId, displayName }], reason }; `reason` is 'no_selected_projects' when there is nothing to search.
export async function searchAssignableUsers(backendUrl, query, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await trackedFetch('planning_review', `${backendUrl}/api/eng/assignee-capacity/user-options`, {
        method: 'POST', signal, cache: 'no-cache',
        headers: { 'X-Requested-With': 'jira-execution-planner', 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        body: JSON.stringify({ query: String(query || '').trim() }),
    }, { featureName: 'planning_review', suppressAbortResult: true });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || 'People search failed.');
        error.status = response.status;
        error.code = data.error || 'jira_read_failed';
        throw error;
    }
    const users = (Array.isArray(data.users) ? data.users : [])
        .filter(user => typeof user?.accountId === 'string' && user.accountId && typeof user.displayName === 'string' && user.displayName.trim())
        .map(user => ({ accountId: user.accountId, displayName: user.displayName.trim() }));
    return { users, reason: typeof data.reason === 'string' ? data.reason : null };
}
