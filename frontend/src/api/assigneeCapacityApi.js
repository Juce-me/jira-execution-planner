import { fetchCsrfToken } from './authApi.js';
import { trackedFetch } from './http.js';

export const ASSIGNEE_CAPACITY_REQUEST_TIMEOUT_MS = 20000;
const url = (backendUrl, sprintId, query = '') => `${backendUrl}/api/eng/sprints/${encodeURIComponent(String(sprintId))}/assignee-capacity${query}`;

// Every write fetches its own single-use CSRF token; tokens are never cached or shared.
async function request(backendUrl, sprintId, query, method, payload, { signal, timeoutMs = ASSIGNEE_CAPACITY_REQUEST_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timedOut = false, dispatched = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const csrfToken = method === 'GET' ? null : await Promise.race([
            fetchCsrfToken(backendUrl).then(result => result?.csrfToken),
            new Promise((resolve, reject) => {
                if (controller.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
                else controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            }),
        ]);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        dispatched = true;
        const response = await trackedFetch('planning_assignee_capacity', url(backendUrl, sprintId, query), {
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

// Batch read of stored Team numbers: sequential chunks of at most 500 ids and 128 KiB of UTF-8 JSON, one in flight.
// A 413 halves its chunk; a single id that still gets 413 is returned in failedTeamIds. Each chunk fetches its own CSRF token
// (request() does), and a 403 csrf_required is retried once with a fresh one. A 401 locks auth in apiFetch, so it rejects and no further chunk is sent.
const BATCH_MAX_IDS = 500;
const BATCH_MAX_BYTES = 128 * 1024;
const utf8 = new TextEncoder();

function planChunks(teamIds) {
    const chunks = []; let current = []; let bytes = utf8.encode('{"teamIds":[]}').length;
    for (const id of teamIds) {
        const cost = utf8.encode(JSON.stringify(id)).length + 1;
        if (current.length && (current.length >= BATCH_MAX_IDS || bytes + cost > BATCH_MAX_BYTES)) { chunks.push(current); current = []; bytes = utf8.encode('{"teamIds":[]}').length; }
        current.push(id); bytes += cost;
    }
    if (current.length) chunks.push(current);
    return chunks;
}

export async function readPlannedNumbers(backendUrl, sprintId, teamIds, { signal } = {}) {
    const queue = planChunks([...new Set((teamIds || []).map(String))]);
    const result = { sprintId: String(sprintId), capabilities: null, byTeam: {}, failedTeamIds: [] };
    while (queue.length) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
        const chunk = queue.shift();
        let data;
        for (let attempt = 0; ; attempt += 1) {
            try { data = await request(backendUrl, sprintId, '/planned/read', 'POST', { teamIds: chunk }, { signal }); break; }
            catch (error) {
                if (error.status === 413) {
                    if (chunk.length === 1) result.failedTeamIds.push(chunk[0]);
                    else { const mid = Math.ceil(chunk.length / 2); queue.unshift(chunk.slice(0, mid), chunk.slice(mid)); }
                    data = null; break;
                }
                if (error.status === 403 && error.code === 'csrf_required' && attempt === 0) continue;
                throw error;
            }
        }
        if (!data) continue;
        if (data.sprintId !== undefined && data.sprintId !== null) result.sprintId = String(data.sprintId);
        if (data.capabilities) result.capabilities = data.capabilities;
        for (const team of data.teams || []) result.byTeam[team.teamId] = { revision: team.revision, planned: team.planned, inherited: team.inherited };
    }
    return result;
}

// Add assignee: active people assignable in the workspace's selected Product and Tech projects (no email).
// Resolves to { users: [{ accountId, displayName }], reason }; `reason` is 'no_selected_projects' when there is nothing to search.
export async function searchAssignableUsers(backendUrl, query, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await trackedFetch('planning_assignee_capacity', `${backendUrl}/api/eng/assignee-capacity/user-options`, {
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
        .map(user => ({ accountId: user.accountId, displayName: user.displayName.trim(), ...(typeof user.avatarUrl === 'string' && user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) }));
    return { users, reason: typeof data.reason === 'string' ? data.reason : null };
}
