import { fetchCsrfToken } from './authApi.js';
import { trackedFetch } from './http.js';

export const REVIEW_REQUEST_TIMEOUT_MS = 20000;
const url = (backendUrl, sprintId, suffix = '') => `${backendUrl}/api/eng/sprints/${encodeURIComponent(String(sprintId))}/review${suffix}`;

async function request(backendUrl, sprintId, suffix, method, payload, { signal, timeoutMs = REVIEW_REQUEST_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timedOut = false, dispatched = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const csrf = method === 'GET' ? null : await Promise.race([
            fetchCsrfToken(backendUrl),
            new Promise((resolve, reject) => {
                if (controller.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
                else controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            }),
        ]);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        dispatched = true;
        const response = await trackedFetch('planning_review', url(backendUrl, sprintId, suffix), {
            method, signal: controller.signal, cache: 'no-cache',
            headers: {
                'X-Requested-With': 'jira-execution-planner',
                ...(payload ? { 'Content-Type': 'application/json' } : {}),
                ...(csrf?.csrfToken ? { 'X-CSRF-Token': csrf.csrfToken } : {}),
            },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
        }, { featureName: 'planning_review', suppressAbortResult: true });
        const data = await response.json();
        if (!response.ok) {
            const error = new Error(data.message || 'Review request failed.');
            error.status = response.status;
            error.code = data.code || data.error;
            if (response.status === 409) error.conflict = { schemaConflict: data.schemaConflict, cellConflicts: data.cellConflicts || [] };
            throw error;
        }
        return data;
    } catch (error) {
        if (timedOut) { const timeout = new Error('Review request timed out.'); timeout.code = 'review_timeout'; timeout.unconfirmed = method === 'PATCH' && dispatched; throw timeout; }
        else if (method === 'PATCH' && dispatched && !error.status && error.name !== 'AuthenticationRequiredError') error.unconfirmed = true;
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export const fetchSprintReview = (backendUrl, sprintId, options) => request(backendUrl, sprintId, '', 'GET', null, options);
export const readSprintReviewValues = (backendUrl, sprintId, payload, options) => request(backendUrl, sprintId, '/values/read', 'POST', payload, options);
export const saveSprintReview = (backendUrl, sprintId, payload, options) => request(backendUrl, sprintId, '', 'PATCH', payload, options);
