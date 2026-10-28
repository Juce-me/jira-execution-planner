const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardFixture } = require('./epm_view_fixture');

// The early startup script (frontend/dist/early-bootstrap.js, built from frontend/src/api/earlyBootstrap.js)
// starts /api/config and /api/groups-config at HTML parse; the app adopts each response once through the
// shared HTTP boundary. Every case runs the committed bundle through the shared dashboard fixture.
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'jira-dashboard.html'), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const sampleConfig = {
    jiraUrl: 'https://jira.example.test', authMode: 'atlassian_oauth', settingsAdminOnly: false,
    userCanEditSettings: true, environmentConfigExists: true, projectsConfigured: true,
    performanceDebugEnabled: false, performanceAdminAvailable: false,
};
const sampleGroups = {
    version: 1, groups: [{ id: 'sample-group', name: 'Sample Department', teamIds: ['sample-team'] }],
    defaultGroupId: 'sample-group', source: 'workspace_db', preferences: {
        customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true,
        completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
        visibleGroupIds: ['sample-group'], activeGroupId: 'sample-group', effectiveVisibleGroupIds: ['sample-group'],
    },
};
const authRequiredBody = { error: 'auth_required', loginUrl: '/login?reason=session_expired' };

async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) await sleep(10);
}

async function settle(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(300);
}

const sprintButton = page => page.getByRole('button', { name: 'Select sprint', exact: true }).first();

const earlySlot = page => page.evaluate(() => Object.fromEntries(Object.entries(window.__JEP_EARLY_BOOTSTRAP__ || {})
    .map(([key, entry]) => [key, { state: entry.state, claimed: entry.claimed, startedAtEpoch: entry.startedAtEpoch ?? null }])));

async function openDashboard(page, { url = appBaseUrl, configRoute, groupsRoute, beforeGoto } = {}) {
    await installDashboardFixture(page);
    const requests = [];
    page.on('request', request => {
        const parsed = new URL(request.url());
        requests.push({ request, path: parsed.pathname, purpose: parsed.searchParams.get('purpose') || '', type: request.resourceType() });
    });
    await page.addInitScript(() => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'eng', selectedSprint: 34625 }));
        window.__authEvents = [];
        window.addEventListener('jep:authentication-required', event => window.__authEvents.push(event.detail));
        window.__earlyScriptExecuted = false;
        document.addEventListener('load', event => {
            if (String(event.target?.src || '').endsWith('/frontend/dist/early-bootstrap.js')) window.__earlyScriptExecuted = true;
        }, true);
    });
    await page.route('**/api/config?**', configRoute || (route => route.fulfill({ json: sampleConfig })));
    await page.route('**/api/groups-config', groupsRoute || (route => route.fulfill({ json: sampleGroups })));
    await page.route('**/api/tasks-with-team-name?**', route => {
        const params = Object.fromEntries(new URL(route.request().url()).searchParams);
        const key = params.project === 'tech' ? 'TEST-2' : 'TEST-1';
        return route.fulfill({ json: { issues: [{ key, fields: { summary: `Sample ${params.project} story`, teamId: 'sample-team', teamName: 'Sample Team', issuetype: { name: 'Story' }, status: { name: 'In Progress' }, priority: { name: 'Medium' }, issuelinks: [] } }], epics: {}, epicsInScope: [], loadMetrics: { completeness: 'unknown', cacheState: 'miss', jiraRequests: 1, jiraPages: 1, jiraRetries: 0 } } });
    });
    await page.route('**/api/eng/story-readiness?**', route => route.fulfill({ json: { schemaVersion: 1, complete: true, scope: {}, epics: [] } }));
    await page.route('**/api/dependencies', route => route.fulfill({ json: { dependencies: {} } }));
    await page.route('**/api/performance/loads', route => route.fulfill({ json: { saved: true } }));
    if (beforeGoto) await beforeGoto();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return {
        requests,
        count: pathname => requests.filter(entry => entry.path === pathname).length,
        laneCount: () => requests.filter(entry => entry.path === '/api/tasks-with-team-name' && !entry.purpose).length,
        documents: () => requests.filter(entry => entry.type === 'document').length,
        // The Jira reads the config bootstrap gates (as in expectConfigBootstrapHoldsJiraWork); the stored
        // priority-weights Settings read under /api/stats/ is configuration, loaded once config has arrived.
        jiraWork: () => requests.map(entry => entry.path).filter(pathname => (
            pathname === '/api/sprints' || pathname === '/api/tasks-with-team-name'
                || pathname.startsWith('/api/eng/board')
                || (pathname.startsWith('/api/stats/') && pathname !== '/api/stats/priority-weights-config')
        )),
    };
}

async function expectLoaded(page, app) {
    await expect.poll(() => app.laneCount()).toBe(2);
    await expect(page.locator('[data-issue-key="TEST-1"]').first()).toBeVisible();
    await expect(page.locator('[data-issue-key="TEST-2"]').first()).toBeVisible();
    await expect(sprintButton(page)).toHaveAttribute('aria-disabled', 'false');
}

test('with the entry delayed 800 ms the config and groups requests start before it, and the same holds with the stylesheet and fonts held (G4a)', async ({ page, context }) => {
    for (const holdStyles of [false, true]) {
        const target = holdStyles ? await context.newPage() : page;
        const seen = {};
        let entryReleased = false;
        let stylesReleased = !holdStyles;
        const app = await openDashboard(target, {
            beforeGoto: async () => {
                target.on('request', request => {
                    const pathname = new URL(request.url()).pathname;
                    if ((pathname === '/api/config' || pathname === '/api/groups-config') && !(pathname in seen)) {
                        seen[pathname] = { entryReleased, stylesReleased };
                    }
                });
                await target.route('**/frontend/dist/dashboard.js', async route => {
                    await sleep(800);
                    entryReleased = true;
                    return route.fallback();
                });
                if (!holdStyles) return;
                // Held until both early reads were seen (at most 5 s): an early script that waited for
                // the stylesheet or the fonts would only start them after this release.
                const held = async route => {
                    await waitUntil(() => '/api/config' in seen && '/api/groups-config' in seen, 5000);
                    stylesReleased = true;
                    return route.fallback();
                };
                await target.route('**/frontend/dist/dashboard.css', held);
                await target.route('https://fonts.googleapis.com/**', held);
            },
        });
        await expect.poll(() => Object.keys(seen).sort()).toEqual(['/api/config', '/api/groups-config']);
        expect(seen['/api/config']).toEqual({ entryReleased: false, stylesReleased: !holdStyles });
        expect(seen['/api/groups-config']).toEqual({ entryReleased: false, stylesReleased: !holdStyles });
        await expectLoaded(target, app);
        await settle(target);
        expect(app.count('/api/config')).toBe(1);
        expect(app.count('/api/groups-config')).toBe(1);
        expect(await earlySlot(target)).toEqual({
            config: expect.objectContaining({ state: 'early', claimed: true }),
            groups: expect.objectContaining({ state: 'early', claimed: true }),
        });
        if (holdStyles) await target.close();
    }
});

test('each is requested exactly once in every arrival order, including a script that arrives after the app started (G4c)', async ({ page, context }) => {
    for (const order of ['script-first', 'at-config', 'after-config']) {
        const target = order === 'script-first' ? page : await context.newPage();
        let releaseScript = () => {};
        const scriptReleased = new Promise(resolve => { releaseScript = resolve; });
        const app = await openDashboard(target, {
            beforeGoto: async () => {
                if (order === 'script-first') return;
                // Hold the early script until the app itself has requested /api/config, then let it
                // arrive at once or 100 ms later; either way it finds both reads already claimed.
                target.on('request', request => {
                    if (new URL(request.url()).pathname !== '/api/config') return;
                    if (order === 'at-config') releaseScript();
                    else setTimeout(releaseScript, 100);
                });
                await target.route('**/frontend/dist/early-bootstrap.js', async route => {
                    await scriptReleased;
                    return route.fallback();
                });
            },
        });
        await expectLoaded(target, app);
        await expect.poll(() => target.evaluate(() => window.__earlyScriptExecuted)).toBe(true);
        await settle(target);
        expect(app.count('/api/config')).toBe(1);
        expect(app.count('/api/groups-config')).toBe(1);
        const expectedState = order === 'script-first' ? 'early' : 'app';
        expect(await earlySlot(target)).toEqual({
            config: expect.objectContaining({ state: expectedState, claimed: true }),
            groups: expect.objectContaining({ state: expectedState, claimed: true }),
        });
        if (target !== page) await target.close();
    }
});

test('the early requests carry no Referer even when the page URL has a share-link query', async ({ page }) => {
    const app = await openDashboard(page, {
        url: `${appBaseUrl}/?v=1&find=secret%20text`,
        beforeGoto: () => page.route(/https?:\/\/[^/]+\/\?v=[^#]*$/, route => route.fulfill({ status: 200, contentType: 'text/html', body: dashboardHtml })),
    });
    await expect.poll(() => app.count('/api/config') + app.count('/api/groups-config')).toBe(2);
    await expect.poll(async () => (await earlySlot(page)).config?.claimed).toBe(true);
    const early = app.requests.filter(entry => entry.path === '/api/config' || entry.path === '/api/groups-config');
    for (const entry of early) {
        const headers = await entry.request.allHeaders();
        expect(headers.referer, entry.path).toBeUndefined();
    }
    // The headers are observable: the document's ordinary same-origin requests do carry a Referer.
    await expect.poll(() => app.count('/api/auth/refresh')).toBeGreaterThan(0);
    const ordinary = app.requests.find(entry => entry.path === '/api/auth/refresh');
    expect((await ordinary.request.allHeaders()).referer).toContain('find=secret');
    expect(await earlySlot(page)).toEqual({
        config: expect.objectContaining({ state: 'early', claimed: true }),
        groups: expect.objectContaining({ state: 'early' }),
    });
});

test('with the early script aborted the app still loads and requests config and groups itself', async ({ page }) => {
    const app = await openDashboard(page, {
        beforeGoto: () => page.route('**/frontend/dist/early-bootstrap.js', route => route.abort()),
    });
    await expectLoaded(page, app);
    await settle(page);
    expect(app.count('/api/config')).toBe(1);
    expect(app.count('/api/groups-config')).toBe(1);
    expect(await page.evaluate(() => window.__earlyScriptExecuted)).toBe(false);
    expect(await earlySlot(page)).toEqual({
        config: { state: 'app', claimed: true, startedAtEpoch: null },
        groups: { state: 'app', claimed: true, startedAtEpoch: null },
    });
});

test('a 401 on the early config locks the document once and no second /api/config request is made even though one would succeed', async ({ page }) => {
    let configCalls = 0;
    const app = await openDashboard(page, {
        configRoute: route => {
            configCalls += 1;
            return configCalls === 1 ? route.fulfill({ status: 401, json: authRequiredBody }) : route.fulfill({ json: sampleConfig });
        },
    });
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toBeVisible();
    await settle(page);
    expect(configCalls).toBe(1);
    expect(app.count('/api/config')).toBe(1);
    expect(await page.evaluate(() => window.__authEvents.length)).toBe(1);
    const slot = await earlySlot(page);
    expect(slot.config).toMatchObject({ state: 'early', claimed: true });
    const lock = await page.evaluate(() => window.__JEP_AUTH_REQUIRED__);
    expect(lock).toMatchObject({ locked: true, loginUrl: '/login?reason=session_expired' });
    expect(lock.requestStartedAt).toBe(slot.config.startedAtEpoch);
    expect(app.jiraWork()).toEqual([]);
    await expect(page.getByRole('alertdialog')).toHaveCount(1);
});

test('a 401 on the early groups-config with a 200 config locks once', async ({ page }) => {
    let groupsCalls = 0;
    const app = await openDashboard(page, {
        groupsRoute: route => {
            groupsCalls += 1;
            return groupsCalls === 1 ? route.fulfill({ status: 401, json: authRequiredBody }) : route.fulfill({ json: sampleGroups });
        },
    });
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toBeVisible();
    await settle(page);
    expect(groupsCalls).toBe(1);
    expect(app.count('/api/groups-config')).toBe(1);
    expect(app.count('/api/config')).toBe(1);
    expect(await page.evaluate(() => window.__authEvents.length)).toBe(1);
    const slot = await earlySlot(page);
    expect(slot.groups).toMatchObject({ state: 'early', claimed: true });
    const lock = await page.evaluate(() => window.__JEP_AUTH_REQUIRED__);
    expect(lock.requestStartedAt).toBe(slot.groups.startedAtEpoch);
    expect(app.jiraWork()).toEqual([]);
    await expect(page.getByRole('alertdialog')).toHaveCount(1);
});

test.describe('stalled early body', () => {
    // A synthetic origin on an ephemeral loopback port. The fixture's routes serve the page, the assets
    // and every other API; the one /api/config request let through gets headers and a partial body, then nothing.
    let server;
    let stallOrigin;
    test.beforeAll(async () => {
        server = http.createServer((request, response) => {
            if (!request.url.startsWith('/api/config?')) {
                response.writeHead(404);
                response.end();
                return;
            }
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.write('{"jiraUrl":');
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        stallOrigin = `http://127.0.0.1:${server.address().port}`;
    });
    test.afterAll(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });

    test('early headers followed by a stalled body end in the existing startup timeout, connection banner and Retry', async ({ page }) => {
        await page.clock.install();
        let configCalls = 0;
        const app = await openDashboard(page, {
            url: `${stallOrigin}/`,
            configRoute: route => {
                configCalls += 1;
                return configCalls === 1 ? route.continue() : route.fulfill({ json: sampleConfig });
            },
        });
        await expect(sprintButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect.poll(async () => (await earlySlot(page)).config).toMatchObject({ state: 'early', claimed: true });
        await expect(page.getByRole('alert').filter({ hasText: 'Server is not responding' })).toHaveCount(0);
        await settle(page);
        expect(app.jiraWork()).toEqual([]);

        await page.clock.fastForward(15_000);
        await expect(page.getByRole('alert')).toContainText('Server is not responding');
        await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
        expect(configCalls).toBe(1);

        const documentsBefore = app.documents();
        const lanesBefore = app.laneCount();
        await page.getByRole('button', { name: 'Retry connection' }).click();
        await expect.poll(() => app.documents()).toBe(documentsBefore + 1);
        await expect.poll(() => app.laneCount()).toBe(lanesBefore + 2);
        await expect(page.locator('[data-issue-key="TEST-2"]').first()).toBeVisible();
        await expect(page.getByRole('alert').filter({ hasText: 'Server is not responding' })).toHaveCount(0);
        expect(app.documents()).toBe(documentsBefore + 1);
    });
});

for (const held of ['config', 'groups']) {
    test(`held early ${held === 'config' ? 'config' : 'groups-config'}: once the mounted app shows its disabled Sprint button and a settle has passed there is no sprint, lane or Board request, and releasing it makes them follow`, async ({ page }) => {
        let release = () => {};
        const gate = new Promise(resolve => { release = resolve; });
        let heldCalls = 0;
        const heldRoute = payload => async route => {
            heldCalls += 1;
            if (heldCalls === 1) await gate;
            return route.fulfill({ json: payload });
        };
        const app = await openDashboard(page, held === 'config'
            ? { configRoute: heldRoute(sampleConfig) }
            : { groupsRoute: heldRoute(sampleGroups) });
        await expect(sprintButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect.poll(async () => (await earlySlot(page))[held]).toMatchObject({ state: 'early', claimed: true });
        await settle(page);
        expect(app.jiraWork()).toEqual([]);
        await expect(sprintButton(page)).toHaveAttribute('aria-disabled', 'true');
        expect(heldCalls).toBe(1);

        release();
        await expect.poll(() => app.count('/api/sprints')).toBe(1);
        await expectLoaded(page, app);
        expect(heldCalls).toBe(1);
        expect(app.count('/api/config')).toBe(1);
        expect(app.count('/api/groups-config')).toBe(1);
    });
}
