const { test, expect } = require('@playwright/test');
const { installDashboardFixture, installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

// Sprint failures below simulate the outage; start them only after the bootstrap Sprint read landed.
async function gotoAfterInitialSprints(page) {
    const initialSprints = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sprints');
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await initialSprints;
}

async function openWithSprintOutage(page, { routes = async () => {} } = {}) {
    const state = { failSprints: false, documents: 0 };
    page.on('request', request => {
        if (request.resourceType() === 'document') state.documents += 1;
    });
    const fixture = await installDashboardFixture(page, { authMode: 'basic' });
    await routes();
    await page.route('**/api/sprints**', route => {
        if (state.failSprints) return route.abort('connectionrefused');
        return route.fallback();
    });
    await gotoAfterInitialSprints(page);
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
    await expect(refresh).toBeEnabled();
    state.failSprints = true;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('Server is not responding');
    state.failSprints = false;
    return { fixture, state };
}

test('shows a visible server error when bootstrap API requests cannot connect', async ({ page }) => {
    const consoleFailures = [];
    page.on('console', message => {
        if (['error', 'warning', 'warn'].includes(message.type())) {
            consoleFailures.push(message.text());
        }
    });
    await installDashboardShell(page);
    await page.route('**/api/**', route => route.abort('connectionrefused'));

    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Server is not responding');
    await expect(alert).toContainText(appBaseUrl);
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    expect(consoleFailures.filter(message => !message.includes('Failed to load resource'))).toEqual([]);
});

test('Retry connection probes config and performs one clean document reload', async ({ page }) => {
    let documentRequests = 0;
    let failSprints = false;
    page.on('request', request => {
        if (request.resourceType() === 'document') documentRequests += 1;
    });
    const fixture = await installDashboardFixture(page, { authMode: 'basic' });
    await page.route('**/api/sprints**', route => {
        if (failSprints) return route.abort('connectionrefused');
        return route.fallback();
    });
    await gotoAfterInitialSprints(page);
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
    await expect(refresh).toBeEnabled();

    failSprints = true;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('Server is not responding');

    failSprints = false;
    const configCallsBefore = fixture.calls.filter(call => call.pathname === '/api/config').length;
    const documentsBefore = documentRequests;
    await page.getByRole('button', { name: 'Retry connection' }).click();

    await expect.poll(() => documentRequests).toBe(documentsBefore + 1);
    await expect.poll(() => fixture.calls.filter(call => call.pathname === '/api/config').length).toBeGreaterThanOrEqual(configCallsBefore + 2);
    await expect(page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('jira_dashboard_connection_recovery_attempt_v1'))).toBeNull();
});

test('a concurrent config 401 wins over connection recovery and never reloads', async ({ page }) => {
    let documentRequests = 0;
    let failSprints = false;
    let authRequired = false;
    page.on('request', request => {
        if (request.resourceType() === 'document') documentRequests += 1;
    });
    await installDashboardFixture(page, { authMode: 'basic' });
    await page.route('**/api/config?**', route => {
        if (!authRequired) return route.fallback();
        return route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'auth_required', message: 'Sign in again.', loginUrl: '/api/auth/atlassian/login' }),
        });
    });
    await page.route('**/api/sprints**', route => {
        if (failSprints) return route.abort('connectionrefused');
        return route.fallback();
    });
    await gotoAfterInitialSprints(page);
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
    await expect(refresh).toBeEnabled();
    failSprints = true;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('Server is not responding');

    failSprints = false;
    authRequired = true;
    const documentsBefore = documentRequests;
    await page.getByRole('button', { name: 'Retry connection' }).click();

    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toBeVisible();
    expect(documentRequests).toBe(documentsBefore);
    expect(await page.evaluate(() => sessionStorage.getItem('jira_dashboard_connection_recovery_v1'))).toBeNull();
});

test('automatic visible-return reload runs once per outage and then requires explicit Retry', async ({ page }) => {
    let documentRequests = 0;
    let failSprints = false;
    page.on('request', request => {
        if (request.resourceType() === 'document') documentRequests += 1;
    });
    await installDashboardFixture(page, { authMode: 'basic' });
    await page.route('**/api/sprints**', route => {
        if (failSprints) return route.abort('connectionrefused');
        return route.fallback();
    });
    await gotoAfterInitialSprints(page);
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
    await expect(refresh).toBeEnabled();
    failSprints = true;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('Server is not responding');

    const documentsBeforeAutomatic = documentRequests;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => documentRequests).toBe(documentsBeforeAutomatic + 1);
    await expect(page.getByRole('alert')).toContainText('Server is not responding');

    failSprints = false;
    const documentsBeforeSuppressedAttempt = documentRequests;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Automatic recovery already ran for this outage.')).toBeVisible();
    expect(documentRequests).toBe(documentsBeforeSuppressedAttempt);

    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect.poll(() => documentRequests).toBe(documentsBeforeSuppressedAttempt + 1);
    await expect(page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' })).toBeEnabled();
});

test('explicit Retry reloads clean state even when the optional recovery capsule cannot be stored', async ({ page }) => {
    let documentRequests = 0;
    let failSprints = false;
    page.on('request', request => {
        if (request.resourceType() === 'document') documentRequests += 1;
    });
    await installDashboardFixture(page, { authMode: 'basic' });
    await page.route('**/api/sprints**', route => {
        if (failSprints) return route.abort('connectionrefused');
        return route.fallback();
    });
    await gotoAfterInitialSprints(page);
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
    await expect(refresh).toBeEnabled();
    await page.evaluate(() => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItem(key, value) {
            if (key === 'jira_dashboard_connection_recovery_v1') throw new DOMException('quota', 'QuotaExceededError');
            return originalSetItem.call(this, key, value);
        };
    });
    failSprints = true;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('Server is not responding');
    failSprints = false;
    const documentsBefore = documentRequests;
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect.poll(() => documentRequests).toBe(documentsBefore + 1);
});

test('a Retry probe that never answers times out, keeps the page, and allows another Retry', async ({ page }) => {
    await page.clock.install();
    let hangConfig = false;
    const hungRoutes = [];
    const { state } = await openWithSprintOutage(page, {
        routes: () => page.route('**/api/config?**', route => {
            if (!hangConfig) return route.fallback();
            hungRoutes.push(route);
            return undefined;
        }),
    });
    try {
        hangConfig = true;
        const documentsBefore = state.documents;
        await page.getByRole('button', { name: 'Retry connection' }).click();
        await expect(page.getByRole('button', { name: 'Checking connection…' })).toBeDisabled();

        await page.clock.fastForward(10_000);
        await expect(page.getByText('The server did not answer within 10 seconds.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' })).toBeDisabled();
        expect(state.documents).toBe(documentsBefore);

        hangConfig = false;
        await page.getByRole('button', { name: 'Retry connection' }).click();
        await expect.poll(() => state.documents).toBe(documentsBefore + 1);
    } finally {
        await Promise.all(hungRoutes.map(route => route.abort().catch(() => {})));
    }
});

test('a Retry probe that still cannot connect says so instead of silently repeating the banner', async ({ page }) => {
    let refuseConfig = false;
    const { state } = await openWithSprintOutage(page, {
        routes: () => page.route('**/api/config?**', route => (refuseConfig ? route.abort('connectionrefused') : route.fallback())),
    });
    refuseConfig = true;
    const documentsBefore = state.documents;
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByText('The server is still unreachable. Retry when it is available.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
    expect(state.documents).toBe(documentsBefore);
});

test('a reachable server that fails the Sprint read after reload still ends the outage', async ({ page }) => {
    let sprintStatus = 200;
    const { state } = await openWithSprintOutage(page, {
        routes: () => page.route('**/api/sprints**', route => (sprintStatus === 200
            ? route.fallback()
            : route.fulfill({ status: sprintStatus, contentType: 'application/json', body: JSON.stringify({ error: 'jira_unavailable' }) }))),
    });
    sprintStatus = 502;
    const documentsBefore = state.documents;
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect.poll(() => state.documents).toBe(documentsBefore + 1);

    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('jira_dashboard_connection_recovery_attempt_v1'))).toBeNull();
    await expect(page.getByRole('alert').filter({ hasText: 'Server is not responding' })).toHaveCount(0);

    sprintStatus = 200;
    state.failSprints = true;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await expect(page.getByRole('alert')).toContainText('Server is not responding');
    state.failSprints = false;
    const documentsBeforeNewOutage = state.documents;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => state.documents).toBe(documentsBeforeNewOutage + 1);
});
