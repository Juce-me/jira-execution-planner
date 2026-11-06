import { fetchCsrfToken } from './authApi.js';
import { trackedFetch } from './http.js';
import { getActiveWorkContext, isStaleWorkContextError, reportWorkContextStale, stampWriteBody, stampWriteParams } from '../workStructure/requestContext.js';

export const REVIEW_REQUEST_TIMEOUT_MS = 20000;
export const PLANNING_SAVE_TIMEOUT_MS = 35000;
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
            error.noCommit = data.noCommit === true;
            if (payload?.version === 2 && method === 'PATCH' && response.status >= 500 && !error.noCommit) error.unconfirmed = true;
            // The rejected draft stays with the caller; the dashboard re-reads the configuration, nothing replays.
            if (isStaleWorkContextError(error)) reportWorkContextStale();
            if (response.status === 409) error.conflict = { schemaConflict: data.schemaConflict, viewConflict: data.viewConflict, cellConflicts: data.cellConflicts || [], inclusionConflicts: data.inclusionConflicts || [] };
            throw error;
        }
        if (method === 'PATCH' && payload?.version === 2) validatePlanningAcknowledgement(data, payload);
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

// The review namespace follows the configuration the call is stamped with, so an era switch reads that era's own
// definitions and layout. The context active when the call is made is the one it carries and reports back.
export const reviewQuery = (groupId) => {
    // The group keeps its encodeURIComponent form (unpromoted URLs are byte-identical); the stamp appends after it.
    const stamp = stampWriteParams(new URLSearchParams()).toString();
    const parts = [groupId == null ? '' : `groupId=${encodeURIComponent(groupId)}`, stamp].filter(Boolean);
    return parts.length ? `?${parts.join('&')}` : '';
};
export const fetchSprintReview = (backendUrl, sprintId, { groupId, ...options } = {}) => request(backendUrl, sprintId, reviewQuery(groupId), 'GET', null, options);
export const readSprintReviewValues = (backendUrl, sprintId, payload, options) => request(backendUrl, sprintId, '/values/read', 'POST', stampWriteBody(payload), options);
export const saveSprintReview = (backendUrl, sprintId, payload, options) => request(backendUrl, sprintId, '', 'PATCH',
    payload?.version === 2 ? payload : stampWriteBody(payload),
    payload?.version === 2 ? { timeoutMs: PLANNING_SAVE_TIMEOUT_MS, ...options } : options);
export const activeReviewContext = () => getActiveWorkContext();

export function createPlanningOperationId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index--) { bytes[index] = timestamp % 256; timestamp = Math.floor(timestamp / 256); }
    bytes[6] = (bytes[6] & 15) | 112;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Stamp once before dispatch. Deliberate reconciliation/retry must retain these exact bytes and identity.
export function freezePlanningSavePayload(payload) {
    const copy = JSON.parse(JSON.stringify(stampWriteBody(payload)));
    const freeze = value => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        return value;
    };
    return freeze(copy);
}

function validatePlanningAcknowledgement(data, payload) {
    const validRevision = value => Number.isSafeInteger(value) && value >= 0;
    const invalid = () => { throw Object.assign(new Error('The plan save outcome could not be confirmed.'), { code: 'planning_acknowledgement_invalid', unconfirmed: true }); };
    if (!data || data.operationId !== payload.operationId || data.plan?.exists !== true || !validRevision(data.plan.revision) || data.plan.revision < 1) invalid();
    if (new TextEncoder().encode(JSON.stringify(data)).length > 1024 * 1024) invalid();
    if (data.reloadRequired === true && data.status === 'committed') return;
    if (!validRevision(data.schemaRevision) || !Array.isArray(data.columns) || !Array.isArray(data.cells) || data.cells.length > 100 || (data.viewRevision !== undefined && !validRevision(data.viewRevision))) invalid();
    if (!Array.isArray(data.inclusionChanges) || data.inclusionChanges.length !== payload.inclusionChanges.length) invalid();
    const submitted = new Map(payload.inclusionChanges.map(change => [change.issueId, change]));
    const seen = new Set();
    for (const change of data.inclusionChanges) {
        const original = submitted.get(change.issueId);
        if (!original || seen.has(change.issueId) || change.included !== original.included || !validRevision(change.revision) || (change.included && change.revision === 0) || change.revision < original.baseRevision) invalid();
        seen.add(change.issueId);
    }
    const submittedCells = new Map((payload.cellChanges || []).map(change => [`${change.issueId}::${change.rowKind}::${change.columnId}`, change]));
    if (data.cells.length !== submittedCells.size) invalid();
    const seenCells = new Set();
    for (const cell of data.cells) {
        const key = `${cell.issueId}::${cell.rowKind}::${cell.columnId}`, original = submittedCells.get(key);
        if (!original || seenCells.has(key) || !validRevision(cell.revision) || cell.revision !== original.baseRevision + 1 || (cell.value !== null && typeof cell.value !== 'string')) invalid();
        const columns = data.columns.filter(column => column.id === cell.columnId && column.rowKind === cell.rowKind);
        if (columns.length !== 1) invalid();
        if (columns[0].type === 'number' && original.value !== null && cell.value !== null) {
            // Compare decimal strings exactly without floating-point rounding; the server stores three places.
            const decimal = value => {
                if (typeof value !== 'string' || value.length > 64 || !/^-?\d+(?:\.\d{1,3})?$/.test(value)) return null;
                const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
                return (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))) * (value.startsWith('-') ? -1n : 1n);
            };
            const expected = decimal(original.value);
            if (expected === null || decimal(cell.value) !== expected) invalid();
        } else if (!['text', 'number'].includes(columns[0].type) || cell.value !== original.value) invalid();
        seenCells.add(key);
    }
}

export function fetchPlanningSaveOperation(backendUrl, sprintId, operationId, { groupId, configurationId, ...options } = {}) {
    const params = new URLSearchParams({ groupId });
    if (configurationId != null) params.set('configurationId', configurationId);
    return request(backendUrl, sprintId, `/operations/${encodeURIComponent(operationId)}?${params}`, 'GET', null, options);
}
