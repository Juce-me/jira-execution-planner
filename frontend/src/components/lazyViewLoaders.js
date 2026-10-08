/* global __JEP_DASHBOARD_BUILD_ID__ */
const mountedBuildId = typeof __JEP_DASHBOARD_BUILD_ID__ === 'string' ? __JEP_DASHBOARD_BUILD_ID__ : 'source-probe';
const viewEntries = {
    stats: { name: 'StatsPanel', exportName: 'default' },
    scenario: { name: 'ScenarioView', exportName: 'ScenarioView' },
    settings: { name: 'SettingsModalContainer', exportName: 'default' },
};
const manifestViewIds = Object.keys(viewEntries).sort().join(',');
export const STALE_LAZY_BUILD_CODE = 'JEP_STALE_LAZY_BUILD';
const loadFailures = new WeakSet();
let mountedManifest;
let retrySequence = 0;

function createStaleBuildError() {
    const error = new Error('Reload the page to get the latest version');
    error.code = STALE_LAZY_BUILD_CODE;
    return error;
}

// Everything a loader throws is a load failure. The boundary rethrows any other error: that is a bug in the view.
function asLoadFailure(error) {
    const failure = error instanceof Error ? error : new Error('Lazy view unavailable');
    loadFailures.add(failure);
    return failure;
}

export function isLazyLoadFailure(error) {
    return loadFailures.has(error);
}

export function validateLazyViewManifest(manifest, buildId) {
    if (!manifest || Object.keys(manifest).sort().join(',') !== 'buildId,schemaVersion,views' || manifest.schemaVersion !== 1 || manifest.buildId !== buildId
        || !/^[a-f0-9]{64}$/.test(buildId) || !manifest.views
        || Object.keys(manifest.views).sort().join(',') !== manifestViewIds) throw createStaleBuildError();
    for (const [viewId, expected] of Object.entries(viewEntries)) {
        const entry = manifest.views[viewId];
        if (!entry || Object.keys(entry).sort().join(',') !== 'exportName,path' || entry.exportName !== expected.exportName || typeof entry.path !== 'string'
            || !new RegExp(`^chunks/${expected.name}-[A-Z0-9]{8}\\.js$`).test(entry.path)) throw createStaleBuildError();
    }
    return manifest;
}

async function readMountedManifest() {
    const script = typeof document === 'undefined' ? null : document.getElementById('dashboard-entry');
    if (!script || !/^[a-f0-9]{64}$/.test(mountedBuildId)) throw createStaleBuildError();
    const entryUrl = new URL(script.src, document.baseURI);
    if (entryUrl.origin !== window.location.origin) throw createStaleBuildError();
    const manifestUrl = new URL(`lazy-views-${mountedBuildId}.json`, entryUrl);
    let manifest;
    try {
        const response = await fetch(manifestUrl.href, { cache: 'no-store' });
        if (!response.ok) throw createStaleBuildError();
        manifest = validateLazyViewManifest(await response.json(), mountedBuildId);
    } catch {
        throw createStaleBuildError();
    }
    return { manifest, entryUrl };
}

// The in-flight read is shared by concurrent retries; a failed read is not kept.
function loadMountedManifest() {
    mountedManifest ??= readMountedManifest().catch(error => {
        mountedManifest = undefined;
        throw error;
    });
    return mountedManifest;
}

export function createLazyViewLoader({ viewId, initialLoad }) {
    if (!Object.hasOwn(viewEntries, viewId) || typeof initialLoad !== 'function') throw new Error('Unknown lazy view');
    let resolvedModule;
    return async function load(attempt) {
        if (resolvedModule) return resolvedModule;
        try {
            let module;
            if (attempt === 0) {
                module = await initialLoad();
            } else if (attempt === 1) {
                const { manifest, entryUrl } = await loadMountedManifest();
                const entry = manifest.views[viewId];
                const url = new URL(entry.path, entryUrl);
                if (url.origin !== entryUrl.origin) throw createStaleBuildError();
                url.searchParams.set('jep_retry', String(++retrySequence));
                const loaded = await import(url.href);
                module = { default: loaded[entry.exportName] };
            } else {
                throw createStaleBuildError();
            }
            if (!module || !module.default) throw new Error('Lazy view unavailable');
            resolvedModule = module;
            return module;
        } catch (error) {
            throw asLoadFailure(error);
        }
    };
}
