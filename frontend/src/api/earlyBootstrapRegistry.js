// Hands the app's first read of each early URL the response the early script (earlyBootstrap.js)
// already started. Every HTTP status is adopted, 401 and 5xx included, so the shared boundary in
// http.js sees what its own request would have seen; only a network error or an abort (null) falls
// back to one normal request. A key the app reaches first is marked as the app's, so a script that
// arrives later skips it and each startup read is requested once in any arrival order.
import { resolveBackendUrl } from './backendUrl.js';
import { EARLY_BOOTSTRAP_MAX_AGE_MS, earlyBootstrapRequests, earlySlot } from './earlyBootstrapContract.js';

const earlyTimings = new WeakMap();

const cacheMode = cache => cache || 'default';

// The caller's signal governs the early request as it would its own: an abort while the headers or
// the body are pending aborts it. The listener goes once the request has finished.
function linkCallerSignal(signal, controller) {
    if (!signal) return () => {};
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) {
        abort();
        return () => {};
    }
    signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener('abort', abort);
}

export function takeEarlyResponse(url, options = {}) {
    const win = typeof window === 'undefined' ? null : window;
    if (!win) return null;
    const request = earlyBootstrapRequests(resolveBackendUrl(win)).find(candidate => candidate.url === url);
    if (!request) return null;
    const slot = earlySlot(win);
    const entry = slot[request.key];
    if (!entry) {
        slot[request.key] = { state: 'app', claimed: true };
        return null;
    }
    if (entry.claimed || entry.state !== 'early') return null;
    entry.claimed = true;
    if (performance.now() - entry.startedAt > EARLY_BOOTSTRAP_MAX_AGE_MS
        || String(options.method || 'GET').toUpperCase() !== 'GET'
        || entry.url !== url
        || cacheMode(options.cache) !== cacheMode(entry.cache)) {
        entry.controller.abort();
        return null;
    }
    const unlink = linkCallerSignal(options.signal, entry.controller);
    const promise = entry.promise.then(response => {
        if (!response) {
            unlink();
            return null;
        }
        earlyTimings.set(response, { startedAt: entry.startedAt, settledAt: entry.settledAt });
        response.clone().arrayBuffer().then(unlink, unlink);
        return response;
    });
    return { promise, startedAtEpoch: entry.startedAtEpoch };
}

export function earlyTimingOf(response) {
    return response && typeof response === 'object' ? earlyTimings.get(response) : undefined;
}
