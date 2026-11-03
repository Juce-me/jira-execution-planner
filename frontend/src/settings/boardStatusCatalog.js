import { fetchBoardStatuses } from '../api/boardConfigApi.js';

// The board-statuses route behind `fetchBoardStatuses` deliberately has no server cache: board
// configuration changes rarely, so the caching belongs on the client. This is that cache — one
// entry per saved board id and selected-project scope, for the lifetime of the page. The URL itself
// stays in the imported `boardConfigApi` module, where every endpoint literal in this app lives.
//
// Neither Legacy cache key is sent with the request (the server reads both from dashboard config). The
// saved values keep unsaved Admin drafts from filing the server's current response under a future
// board or project scope. After promotion the request names its stored entry and the key also carries
// that configuration's id, revision, digest and mapped parent authority, so the same Board and projects
// under a new parent-type mapping can never reuse an old answer.
//
// No caller `signal`: the request outlives whoever started it on purpose, because a session cache
// that aborts the fetch it was about to store refetches on the next mount. Consumers guard their
// own state with a cancelled flag.
const catalogByScope = new Map();

export const catalogScopeKey = (scope) => (scope?.configurationId
    ? [scope.configurationId, scope.configurationRevision ?? '', scope.digest || '', scope.parentAuthority || '', scope.quarter || ''].join('~')
    : '');

export function loadBoardStatusCatalog(backendUrl, { boardId = '', projectScopeKey = '', catalogScope = null } = {}) {
    const scopeKey = catalogScopeKey(catalogScope);
    const key = `${backendUrl}::${boardId}::${projectScopeKey}${scopeKey ? `::${scopeKey}` : ''}`;
    const cached = catalogByScope.get(key);
    if (cached) return cached;

    // Failures are never cached: a 502 is transient and a 400 clears the moment an admin
    // configures a board, so the next mount must be able to try again.
    const request = scopeKey
        ? { configurationId: catalogScope.configurationId, configurationRevision: catalogScope.configurationRevision, quarter: catalogScope.quarter || '' }
        : {};
    const pending = fetchBoardStatuses(backendUrl, request).catch((error) => {
        catalogByScope.delete(key);
        throw error;
    });
    catalogByScope.set(key, pending);
    return pending;
}

export function clearBoardStatusCatalogCache() {
    catalogByScope.clear();
}
