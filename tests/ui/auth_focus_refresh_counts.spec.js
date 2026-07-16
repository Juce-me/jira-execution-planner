const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const repoRoot = path.join(__dirname, '..', '..');
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');

// Built once for every test in this file: the same esbuild flags as
// `npm run build:auth`, minus --minify/--sourcemap, so assertions exercise
// real (but readable) build output instead of a possibly-stale dist copy.
let authFocusRefreshJs;

test.beforeAll(() => {
    authFocusRefreshJs = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'api', 'authFocusRefresh.js')],
        bundle: true,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"production"' },
        write: false,
    }).outputFiles[0].text;
});

// Self-contained shell scoped to the auth-refresh module only: the real
// jira-dashboard.html plus the real auth-focus-refresh bundle, with the
// dashboard bundle/styles stubbed empty and every other document reference
// (fonts, favicon, icon) route-fulfilled so nothing escapes to the network.
async function installAuthShell(page) {
    await page.route(/https?:\/\/[^/]+\/$/, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: dashboardHtml,
    }));
    await page.route('**/frontend/dist/auth-focus-refresh.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: authFocusRefreshJs,
    }));
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
    }));
    await page.route('**/api/auth/refresh', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
    }));
    await page.route('**/epm-burst.svg', route => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    }));
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
    }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
}

// Counts the three request classes the auth-refresh state machine can affect:
// the document itself, the auth-shell script, and the throttled refresh POST.
function attachCounters(page) {
    const counters = { documents: [], authScripts: [], authPosts: [], pageErrors: [] };
    page.on('request', request => {
        const url = new URL(request.url());
        if (request.resourceType() === 'document') counters.documents.push(url.pathname);
        if (url.pathname === '/frontend/dist/auth-focus-refresh.js') counters.authScripts.push(url.pathname);
        if (request.method() === 'POST' && url.pathname === '/api/auth/refresh') counters.authPosts.push(url.pathname);
    });
    page.on('pageerror', error => counters.pageErrors.push(error.message));
    return counters;
}

test('one document load produces one auth-script request and one auth POST; a focus/visibility burst adds none', async ({ page }) => {
    await installAuthShell(page);
    const counters = attachCounters(page);

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);
    expect(counters.authPosts.length).toBe(1);

    // Under-throttle burst while the document stays visible: today's module
    // never re-requests the document or script, so this must add zero
    // document/script requests and zero POSTs (the 60s throttle window has
    // not elapsed).
    await page.evaluate(() => {
        for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        }
    });
    await page.waitForTimeout(200);

    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);
    expect(counters.authPosts.length).toBe(1);
    expect(counters.pageErrors).toEqual([]);
});
