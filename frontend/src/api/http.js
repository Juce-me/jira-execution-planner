import { trackApiResult } from '../analytics/analytics.js';

export async function json(response, label) {
    if (!response.ok) {
        throw new Error(`${label} error ${response.status}`);
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
        trackApiResult(apiSurface, params);
    } catch (err) {
        // Analytics must never change the API result seen by the caller.
    }
}

export async function trackedFetch(apiSurface, url, options = {}, analyticsParams = {}) {
    const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const method = String(options.method || 'GET').toUpperCase();
    try {
        const response = await fetch(url, options);
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
        const endedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        safelyTrackApiResult(apiSurface, {
            featureName: analyticsParams.featureName || 'api',
            method,
            status: 0,
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
        : fetch(url, fetchOptions);
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
        : fetch(url, requestOptions);
    return request.then(response => json(response, label));
}
