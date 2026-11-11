const { expect } = require('@playwright/test');

// Observe the actual browser response boundary, not only route.fulfill(). Callers
// combine this with their mounted view and settled geometry, then dispose the
// ledger. There is no fixed quiet period or listener for later background work.
function observeBootstrapRequests(page) {
    const pending = new Set();
    const settledPaths = new Set();
    const apiPath = request => {
        const path = new URL(request.url()).pathname;
        return path.startsWith('/api/') && path !== '/api/performance/loads' ? path : null;
    };
    const started = request => { if (apiPath(request)) pending.add(request); };
    const settled = request => {
        const path = apiPath(request);
        if (!path) return;
        pending.delete(request);
        settledPaths.add(path);
    };
    page.on('request', started);
    page.on('requestfinished', settled);
    page.on('requestfailed', settled);
    return {
        async waitForBootstrap() {
            await expect.poll(() => ['/api/config', '/api/groups-config'].every(path => settledPaths.has(path))).toBe(true);
        },
        async waitForIdle() { await expect.poll(() => pending.size).toBe(0); },
        dispose() {
            page.off('request', started);
            page.off('requestfinished', settled);
            page.off('requestfailed', settled);
        },
    };
}

module.exports = { observeBootstrapRequests };
