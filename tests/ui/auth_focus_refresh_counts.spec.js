const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardFixture } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const repoRoot = path.join(__dirname, '..', '..');
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');

// Mirrors frontend/src/api/authRefreshContract.js's AUTH_LONG_ABSENCE_EVENT. Hardcoded
// rather than imported because this spec is CommonJS and the contract module is a plain
// side-effect-free ESM constants file.
const AUTH_LONG_ABSENCE_EVENT = 'jep:auth-long-absence-return';

// Built once for every test in this file: the same esbuild flags as
// `npm run build:auth`, minus --minify/--sourcemap, so assertions exercise
// real (but readable) build output instead of a possibly-stale dist copy.
let authFocusRefreshJs;
// Fresh esbuild bundle of the real dashboard source, used only by the wiring test so it
// proves against Task 4's listener instead of the (currently stale, pre-Task-7-rebuild)
// frontend/dist/dashboard.js copy. Same self-host pattern as eng_priority_transitions.spec.js.
let freshDashboardJs;

test.beforeAll(() => {
    authFocusRefreshJs = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'api', 'authFocusRefresh.js')],
        bundle: true,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"production"' },
        write: false,
    }).outputFiles[0].text;
    freshDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
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

// Date.now offset shim: only Date.now is patched (never the Date constructor), so the
// bundled module's `now - last` comparisons see a controllable clock via __advanceClock(ms).
async function installClockControl(page) {
    await page.addInitScript(() => {
        // Fully virtual clock pinned at a baseline captured once at init: Date.now() only
        // ever moves via explicit __advanceClock(ms), never with real wall-clock passage.
        // This keeps boundary assertions (e.g. exactly 12:00.000) exact regardless of how
        // much real time elapses between test steps (network round-trips, awaits, etc.).
        const baseline = Date.now();
        let offsetMs = 0;
        Date.now = () => baseline + offsetMs;
        window.__advanceClock = (ms) => {
            offsetMs += ms;
        };
    });
}

// document.visibilityState override with an in-page setter that also dispatches
// visibilitychange, so hidden/visible transitions drive the module the same way a real tab
// switch would.
async function installVisibilityControl(page) {
    await page.addInitScript(() => {
        window.__visState = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => window.__visState,
        });
        window.__setVisibility = (state) => {
            window.__visState = state;
            document.dispatchEvent(new Event('visibilitychange'));
        };
    });
}

// Records every jep:auth-long-absence-return dispatch (and its detail) from page load, via a
// window listener installed before the auth-shell script ever runs.
async function installLongAbsenceEventCounter(page) {
    await page.addInitScript((eventName) => {
        window.__laEvents = [];
        window.addEventListener(eventName, (event) => {
            window.__laEvents.push(event.detail);
        });
    }, AUTH_LONG_ABSENCE_EVENT);
}

async function longAbsenceEvents(page) {
    return page.evaluate(() => window.__laEvents || []);
}

async function blurWindow(page) {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
}

async function focusWindow(page) {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

async function advanceClock(page, ms) {
    await page.evaluate((amount) => window.__advanceClock(amount), ms);
}

async function setVisibility(page, state) {
    await page.evaluate((value) => window.__setVisibility(value), state);
}

async function focusAndVisibilityBurst(page) {
    await page.evaluate(() => {
        for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        }
    });
    await page.waitForTimeout(500);
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

test('blur then focus after 11 minutes stays under the long-absence threshold', async ({ page }) => {
    await installAuthShell(page);
    await installClockControl(page);
    await installVisibilityControl(page);
    await installLongAbsenceEventCounter(page);
    const counters = attachCounters(page);

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    expect(counters.authPosts.length).toBe(1);

    await blurWindow(page);
    await advanceClock(page, 11 * 60 * 1000);
    await focusWindow(page);
    // Below the long-absence threshold, but past the 60s throttle: exactly one more POST.
    await expect.poll(() => counters.authPosts.length).toBe(2);

    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);
    expect(await longAbsenceEvents(page)).toEqual([]);
    expect(counters.pageErrors).toEqual([]);
});

test('blur then focus after exactly 12 minutes stays under the long-absence threshold', async ({ page }) => {
    await installAuthShell(page);
    await installClockControl(page);
    await installVisibilityControl(page);
    await installLongAbsenceEventCounter(page);
    const counters = attachCounters(page);

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    expect(counters.authPosts.length).toBe(1);

    await blurWindow(page);
    await advanceClock(page, 12 * 60 * 1000);
    await focusWindow(page);
    // Exactly 12 minutes does not clear the strictly-greater-than boundary.
    await expect.poll(() => counters.authPosts.length).toBe(2);

    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);
    expect(await longAbsenceEvents(page)).toEqual([]);
    expect(counters.pageErrors).toEqual([]);
});

test('blur then focus after more than 12 minutes fires one long-absence event and stays stable under a burst', async ({ page }) => {
    await installAuthShell(page);
    await installClockControl(page);
    await installVisibilityControl(page);
    await installLongAbsenceEventCounter(page);
    const counters = attachCounters(page);

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    expect(counters.authPosts.length).toBe(1);

    await blurWindow(page);
    await advanceClock(page, 12 * 60 * 1000 + 1000);
    await focusWindow(page);
    await expect.poll(() => counters.authPosts.length).toBe(2);
    await expect.poll(async () => (await longAbsenceEvents(page)).length).toBe(1);

    const events = await longAbsenceEvents(page);
    expect(events).toHaveLength(1);
    expect(events[0].unfocusedMs).toBeGreaterThan(12 * 60 * 1000);
    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);

    // A focus/visibilitychange burst right after the long-absence return must not add a
    // second POST, a second event, or any document/script request (stability window).
    await focusAndVisibilityBurst(page);

    expect(counters.authPosts.length).toBe(2);
    expect(await longAbsenceEvents(page)).toHaveLength(1);
    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);
    expect(counters.pageErrors).toEqual([]);
});

test('hidden then visible after more than 12 minutes fires one long-absence event and stays stable under a burst', async ({ page }) => {
    await installAuthShell(page);
    await installClockControl(page);
    await installVisibilityControl(page);
    await installLongAbsenceEventCounter(page);
    const counters = attachCounters(page);

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    expect(counters.authPosts.length).toBe(1);

    await setVisibility(page, 'hidden');
    await advanceClock(page, 12 * 60 * 1000 + 1000);
    await setVisibility(page, 'visible');
    await expect.poll(() => counters.authPosts.length).toBe(2);
    await expect.poll(async () => (await longAbsenceEvents(page)).length).toBe(1);

    const events = await longAbsenceEvents(page);
    expect(events).toHaveLength(1);
    expect(events[0].unfocusedMs).toBeGreaterThan(12 * 60 * 1000);
    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);

    await focusAndVisibilityBurst(page);

    expect(counters.authPosts.length).toBe(2);
    expect(await longAbsenceEvents(page)).toHaveLength(1);
    expect(counters.documents.length).toBe(1);
    expect(counters.authScripts.length).toBe(1);
    expect(counters.pageErrors).toEqual([]);
});

test('two tabs share the cross-tab refresh throttle and each dispatches its own long-absence event', async ({ context }) => {
    const pageA = await context.newPage();
    await installAuthShell(pageA);
    await installClockControl(pageA);
    await installVisibilityControl(pageA);
    await installLongAbsenceEventCounter(pageA);
    const countersA = attachCounters(pageA);

    await pageA.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    expect(countersA.authPosts.length).toBe(1);

    const pageB = await context.newPage();
    await installAuthShell(pageB);
    await installClockControl(pageB);
    await installVisibilityControl(pageB);
    await installLongAbsenceEventCounter(pageB);
    const countersB = attachCounters(pageB);

    await pageB.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    // Page B loads inside page A's throttle window: the shared localStorage timestamp is
    // fresh, so page B's own initial visible-return POST is skipped.
    expect(countersB.authPosts.length).toBe(0);
    expect(await longAbsenceEvents(pageB)).toEqual([]);

    await setVisibility(pageA, 'hidden');
    await setVisibility(pageB, 'hidden');
    await advanceClock(pageA, 13 * 60 * 1000);
    await advanceClock(pageB, 13 * 60 * 1000);

    await setVisibility(pageA, 'visible');
    await expect.poll(() => countersA.authPosts.length).toBe(2);
    await expect.poll(async () => (await longAbsenceEvents(pageA)).length).toBe(1);

    // Page B returns right after, still within page A's fresh 60s throttle window: it skips
    // the POST but still dispatches its own long-absence event (its own view data is stale).
    await setVisibility(pageB, 'visible');
    await expect.poll(async () => (await longAbsenceEvents(pageB)).length).toBe(1);

    expect(countersB.authPosts.length).toBe(0);
    expect(countersA.authPosts.length + countersB.authPosts.length).toBe(2);
    expect(countersA.documents.length).toBe(1);
    expect(countersB.documents.length).toBe(1);
    expect(countersA.authScripts.length).toBe(1);
    expect(countersB.authScripts.length).toBe(1);
    expect(countersA.pageErrors).toEqual([]);
    expect(countersB.pageErrors).toEqual([]);
});

test('a 401 on the initial refresh redirects to the stubbed login page and dispatches no long-absence event', async ({ page }) => {
    await installAuthShell(page);
    await installLongAbsenceEventCounter(page);
    const counters = attachCounters(page);

    await page.route('**/login**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Login</title>',
    }));
    // Registered after installAuthShell: the later-registered route wins and overrides the
    // shell's default 200 stub for this test only.
    await page.route('**/api/auth/refresh', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ loginUrl: `${appBaseUrl}/login?reason=session_expired` }),
    }));

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.pathname === '/login');

    expect(page.url()).toContain('reason=session_expired');
    expect(counters.authPosts.length).toBe(1);
    expect(await longAbsenceEvents(page)).toEqual([]);
    expect(counters.pageErrors).toEqual([]);
});

test('a 401 on the long-absence refresh redirects to login, dispatches no event, and never re-requests the dashboard document', async ({ page }) => {
    await installAuthShell(page);
    await installClockControl(page);
    await installVisibilityControl(page);
    await installLongAbsenceEventCounter(page);
    const counters = attachCounters(page);

    await page.route('**/login**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Login</title>',
    }));
    let refreshCallCount = 0;
    await page.route('**/api/auth/refresh', route => {
        refreshCallCount += 1;
        if (refreshCallCount === 1) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ loginUrl: `${appBaseUrl}/login?reason=session_expired` }),
        });
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    expect(counters.authPosts.length).toBe(1);

    await blurWindow(page);
    await advanceClock(page, 12 * 60 * 1000 + 1000);
    await focusWindow(page);
    await page.waitForURL((url) => url.pathname === '/login');

    expect(page.url()).toContain('reason=session_expired');
    expect(await longAbsenceEvents(page)).toEqual([]);
    // The login navigation is a different document (a different URL); the original
    // dashboard document at "/" must never be re-requested.
    expect(counters.documents.filter(pathname => pathname === '/')).toHaveLength(1);
    expect(counters.pageErrors).toEqual([]);
});

test('a long-absence return re-runs the active view fetches on the fresh dashboard bundle without reloading the document', async ({ page }) => {
    const { calls } = await installDashboardFixture(page);
    // Later-registered routes win: override the fixture's stale frontend/dist/dashboard.js
    // with the freshly bundled dashboard.jsx so this proves Task 4's wiring against current
    // source, not the pre-Task-7-rebuild dist copy. The auth-shell script is fulfilled empty
    // (hermetic): this test dispatches the CustomEvent manually and the real shell's own
    // behavior is proven by the scenarios above and by the unit suite.
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: freshDashboardJs,
    }));
    await page.route('**/frontend/dist/auth-focus-refresh.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
    }));
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const documentRequests = [];
    page.on('request', request => {
        if (request.resourceType() === 'document') documentRequests.push(new URL(request.url()).pathname);
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    // Deterministic proxy for "the manual refresh control is enabled": the default boot
    // state (no configured groups) still auto-selects a sprint from GET /api/sprints, and
    // the eng refresh button is disabled only while loading or before a sprint is selected.
    await expect(page.locator('.refresh-icon')).toBeEnabled();

    const callsBefore = calls.length;
    await page.evaluate((eventName) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: { unfocusedMs: 13 * 60 * 1000 } }));
    }, AUTH_LONG_ABSENCE_EVENT);

    // Poll for the specific proof-of-refetch pathname rather than a bare length increase:
    // the sprints/product/tech fetches fire together but land in `calls` at slightly
    // different times, so "length grew by 1" can be true before the tech fetch lands.
    await expect.poll(() => calls.slice(callsBefore).some(call => call.pathname === '/api/tasks-with-team-name')).toBe(true);
    const newCalls = calls.slice(callsBefore);
    expect(newCalls.some(call => call.pathname === '/api/sprints')).toBe(true);
    expect(newCalls.some(call => call.pathname === '/api/tasks-with-team-name')).toBe(true);
    expect(documentRequests.filter(pathname => pathname === '/')).toHaveLength(1);
    expect(pageErrors).toEqual([]);
});
