// Built as a classic script (frontend/dist/early-bootstrap.js) and loaded async first in <head>, so the
// two startup reads begin while the dashboard entry, the stylesheet and the fonts are still loading.
// The app adopts each response once through earlyBootstrapRegistry.js; a key the app reached first
// is skipped. The request differs from the loader's only by sending no Referer, so a share-link query
// in the address bar never leaves the page. It reads no query string and no storage and never throws.
import { resolveBackendUrl } from './backendUrl.js';
import { earlyBootstrapRequests, earlySlot } from './earlyBootstrapContract.js';

function startEarlyRequest(slot, request) {
    if (slot[request.key]) return;
    const controller = new AbortController();
    const entry = {
        state: 'early',
        url: request.url,
        method: request.init.method || 'GET',
        cache: request.init.cache,
        startedAt: performance.now(),
        startedAtEpoch: Date.now(),
        settledAt: null,
        claimed: false,
        controller,
        promise: null,
    };
    slot[request.key] = entry;
    const settle = response => {
        entry.settledAt = performance.now();
        return response;
    };
    let pending;
    try {
        pending = fetch(request.url, { ...request.init, signal: controller.signal, credentials: 'same-origin', referrerPolicy: 'no-referrer' });
    } catch {
        pending = null;
    }
    // Any HTTP status resolves to the Response; a network error or an abort resolves to null.
    entry.promise = Promise.resolve(pending).then(settle, () => settle(null));
}

try {
    const protocol = typeof window === 'undefined' ? '' : String(window.location?.protocol || '');
    if ((protocol === 'http:' || protocol === 'https:') && typeof fetch === 'function' && typeof AbortController === 'function') {
        const slot = earlySlot(window);
        earlyBootstrapRequests(resolveBackendUrl(window)).forEach(request => startEarlyRequest(slot, request));
    }
} catch {
    // The app requests whatever this script could not start.
}
