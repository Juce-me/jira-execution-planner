// The two startup reads the early script (earlyBootstrap.js) may start before the dashboard entry
// runs, shared with the registry the app adopts them through (earlyBootstrapRegistry.js). Each
// init equals, without its signal, what the existing loader in configApi.js passes to fetch.
export const EARLY_BOOTSTRAP_SLOT = '__JEP_EARLY_BOOTSTRAP__';
export const EARLY_BOOTSTRAP_MAX_AGE_MS = 30000;

export function earlyBootstrapRequests(backendUrl) {
    return [
        { key: 'config', url: `${backendUrl}/api/config?includeViewConfig=true`, init: {} },
        {
            key: 'groups',
            url: `${backendUrl}/api/groups-config`,
            init: { method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-cache' },
        },
    ];
}

// One entry per key, created by whichever side reaches the key first: state 'early' (the script
// started the request) or 'app' (the application made its own request).
export function earlySlot(win) {
    if (!win[EARLY_BOOTSTRAP_SLOT] || typeof win[EARLY_BOOTSTRAP_SLOT] !== 'object') win[EARLY_BOOTSTRAP_SLOT] = {};
    return win[EARLY_BOOTSTRAP_SLOT];
}
