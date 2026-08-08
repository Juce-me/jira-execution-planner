import { fetchEpicDescription } from '../api/boardConfigApi.js';
import { AUTH_SESSION_REFRESH_EVENT } from '../api/authRefreshContract.js';

// §9.2: the epic description is fetched lazily, one issue per opened panel, and "a second open of
// the same epic in one session must not refetch". Task 3 deliberately added no server cache — the
// body is user-permission-scoped — so the caching belongs here. Same shape as
// frontend/src/settings/boardStatusCatalog.js, the in-repo precedent: one entry per key for the
// lifetime of the page, holding the PROMISE so two concurrent openers share one request.
//
// The URL itself stays in boardConfigApi.js, where every endpoint literal in this app lives.
//
// No caller `signal`: a session cache that aborts the fetch it was about to store would refetch on
// the next open. The panel guards its own state with a cancelled flag instead.
const descriptionByKey = new Map();
let authPartition = 0;

export function loadEpicDescription(backendUrl, { key = '' } = {}) {
    const cacheKey = `${authPartition}::${backendUrl}::${String(key || '').trim().toUpperCase()}`;
    const cached = descriptionByKey.get(cacheKey);
    if (cached) return cached;

    // Failures are never cached: a 502 is transient and the Retry control in the description block
    // (§9.2's error state) must be able to try again.
    const pending = fetchEpicDescription(backendUrl, { key }).catch((error) => {
        descriptionByKey.delete(cacheKey);
        throw error;
    });
    descriptionByKey.set(cacheKey, pending);
    return pending;
}

export function clearEpicDescriptionCache() {
    descriptionByKey.clear();
}

export function advanceEpicDescriptionAuthPartition() {
    authPartition += 1;
    clearEpicDescriptionCache();
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener(AUTH_SESSION_REFRESH_EVENT, advanceEpicDescriptionAuthPartition);
}
