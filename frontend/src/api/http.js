import {
    AUTH_REQUIRED_EVENT,
    AuthenticationRequiredError,
    publishAuthenticationRequired,
    readPendingAuthenticationRequired,
} from './authRequired.js';

async function authenticationPayload(response) {
    if (!response || response.ok) return null;
    try {
        return await response.clone().json();
    } catch (error) {
        return null;
    }
}

async function waitForResponseBody(response) {
    if (!response?.body) return;
    await response.clone().arrayBuffer();
}

function abortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfRequestStopped(signal, status = 0) {
    if (signal?.aborted) throw abortError(signal);
    const pending = readPendingAuthenticationRequired();
    if (pending) throw new AuthenticationRequiredError(pending, status);
}

export function requireAuthentication(payload = {}, status = 401) {
    const state = publishAuthenticationRequired(payload);
    throw new AuthenticationRequiredError(state, status);
}

export async function apiFetch(url, options = {}) {
    const pending = readPendingAuthenticationRequired();
    if (pending) throw new AuthenticationRequiredError(pending);
    let response;
    const requestStartedAt = Date.now();
    try {
        response = await fetch(url, options);
    } catch (error) {
        const lockedAfterFailure = readPendingAuthenticationRequired();
        if (lockedAfterFailure) throw new AuthenticationRequiredError(lockedAfterFailure, 0);
        throw error;
    }
    if (!response.ok) {
        const payload = await authenticationPayload(response);
        if (response.status === 401 || payload?.error === 'auth_required') {
            const state = publishAuthenticationRequired({ ...(payload || {}), requestStartedAt });
            throw new AuthenticationRequiredError(state, response.status);
        }
    }
    try {
        await waitForResponseBody(response);
    } catch (error) {
        const lockedAfterFailure = readPendingAuthenticationRequired();
        if (lockedAfterFailure) throw new AuthenticationRequiredError(lockedAfterFailure, response.status);
        throw error;
    }
    const lockedAfterResponse = readPendingAuthenticationRequired();
    if (lockedAfterResponse) throw new AuthenticationRequiredError(lockedAfterResponse, response.status);
    return response;
}

// Streaming callers opt into header-first delivery. The ordinary apiFetch path
// continues buffering a cloned response body so existing callers keep their
// global-auth race behavior.
export async function apiFetchHeaders(url, options = {}) {
    throwIfRequestStopped(options.signal);
    const requestStartedAt = Date.now();
    let response;
    try {
        response = await fetch(url, options);
    } catch (error) {
        const lockedAfterFailure = readPendingAuthenticationRequired();
        if (lockedAfterFailure) throw new AuthenticationRequiredError(lockedAfterFailure, 0);
        throw error;
    }
    throwIfRequestStopped(options.signal, response.status);
    if (!response.ok) {
        const payload = await authenticationPayload(response);
        if (response.status === 401 || payload?.error === 'auth_required') {
            requireAuthentication({ ...(payload || {}), requestStartedAt }, response.status);
        }
    }
    return response;
}

export async function readResponseStream(response, { signal, onChunk } = {}) {
    if (!response?.body?.getReader) throw new Error('Streaming response body is unavailable.');
    const reader = response.body.getReader();
    let completed = false;
    const cancelReader = () => { reader.cancel(abortError(signal)).catch(() => {}); };
    const cancelForAuthentication = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener?.('abort', cancelReader, { once: true });
    globalThis?.window?.addEventListener?.(AUTH_REQUIRED_EVENT, cancelForAuthentication, { once: true });
    try {
        while (true) {
            throwIfRequestStopped(signal, response.status);
            const { done, value } = await reader.read();
            throwIfRequestStopped(signal, response.status);
            if (done) {
                completed = true;
                return;
            }
            await onChunk(value, () => {
                completed = true;
            }, () => throwIfRequestStopped(signal, response.status));
            if (completed) return;
        }
    } finally {
        signal?.removeEventListener?.('abort', cancelReader);
        globalThis?.window?.removeEventListener?.(AUTH_REQUIRED_EVENT, cancelForAuthentication);
        if (!completed) await reader.cancel().catch(() => {});
        else if (response.body.locked) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function rejectAuthenticationResponse(response) {
    if (response?.ok) return;
    const payload = await authenticationPayload(response);
    if (response?.status === 401 || payload?.error === 'auth_required') {
        const state = publishAuthenticationRequired(payload || {});
        throw new AuthenticationRequiredError(state, response.status);
    }
}

export async function json(response, label) {
    await rejectAuthenticationResponse(response);
    if (!response.ok) {
        throw new Error(`${label} error ${response.status}`);
    }
    return response.json();
}

// Same contract as json() on success, but on a non-OK response parses the JSON
// body and throws an Error carrying .status/.code/.loginUrl/.recoveryUrl so
// callers can drive non-auth recoverable-error UI.
export async function jsonOrStructuredError(response, label) {
    await rejectAuthenticationResponse(response);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.message || errorData.error || `${label} error ${response.status}`);
        error.status = response.status;
        error.code = errorData.error;
        error.loginUrl = errorData.loginUrl;
        error.recoveryUrl = errorData.recoveryUrl;
        throw error;
    }
    return response.json();
}

function cacheStateFromResponse(response) {
    const header = response?.headers?.get?.('X-Cache') || response?.headers?.get?.('Server-Timing') || '';
    if (!header) return 'unknown';
    return /hit/i.test(header) ? 'hit' : /miss/i.test(header) ? 'miss' : 'unknown';
}

function safelyTrackApiResult(apiSurface, params) {
    try {
        globalThis?.JepAnalytics?.trackApiResult?.(apiSurface, params);
    } catch (err) {
        // Analytics must never change the API result seen by the caller.
    }
}

export async function trackedFetch(apiSurface, url, options = {}, analyticsParams = {}) {
    const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const method = String(options.method || 'GET').toUpperCase();
    try {
        const response = await apiFetch(url, options);
        const endedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        safelyTrackApiResult(apiSurface, {
            featureName: analyticsParams.featureName || 'api',
            method,
            status: response.status,
            durationMs: endedAt - startedAt,
            cacheState: analyticsParams.cacheState || cacheStateFromResponse(response),
            epmTab: analyticsParams.epmTab,
            projectScope: analyticsParams.projectScope,
            subgoalScope: analyticsParams.subgoalScope
        });
        return response;
    } catch (error) {
        if (error?.name === 'AbortError' && analyticsParams.suppressAbortResult) {
            throw error;
        }
        const endedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        safelyTrackApiResult(apiSurface, {
            featureName: analyticsParams.featureName || 'api',
            method,
            status: Number(error?.status) || 0,
            durationMs: endedAt - startedAt,
            cacheState: 'unknown',
            epmTab: analyticsParams.epmTab,
            projectScope: analyticsParams.projectScope,
            subgoalScope: analyticsParams.subgoalScope
        });
        throw error;
    }
}

export function getJson(url, label, options = {}) {
    const { analytics, ...fetchOptions } = options;
    const request = analytics
        ? trackedFetch(analytics.apiSurface, url, fetchOptions, analytics)
        : apiFetch(url, fetchOptions);
    return request.then(response => json(response, label));
}

export function postJson(url, body, label, options = {}) {
    const { analytics, ...fetchOptions } = options;
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('X-Requested-With')) {
        headers.set('X-Requested-With', 'jira-execution-planner');
    }

    const requestOptions = {
        ...fetchOptions,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    };
    const request = analytics
        ? trackedFetch(analytics.apiSurface, url, requestOptions, analytics)
        : apiFetch(url, requestOptions);
    return request.then(response => json(response, label));
}
