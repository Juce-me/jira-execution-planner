const { test, expect } = require('@playwright/test');
const { activeHomeTokenConnection, installDashboardFixture } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

test('bootstrap 401 locks the mounted app behind one accessible sanitized recovery gate', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    let analyticsContextCalls = 0;
    let configCalls = 0;
    await page.route('**/api/analytics/context', async route => {
        analyticsContextCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ enabled: true, gtmContainerId: 'GTM-TEST' }),
        });
    });
    await page.route('**/api/config**', route => {
        configCalls += 1;
        return route.fulfill({ status: 401, contentType: 'text/plain', body: 'expired' });
    });
    await page.route('**/login?reason=session_expired', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<title>Sign in</title><h1>Sign in</h1>',
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    const gate = page.getByRole('alertdialog');
    await expect(gate).toBeVisible();
    await expect(page.getByText(/401/)).toHaveCount(0);
    const action = gate.getByRole('link', { name: 'Sign in again' });
    await expect(action).toBeFocused();
    await expect(action).toHaveAttribute('href', '/login?reason=session_expired');
    await expect(action).not.toHaveAttribute('target', /.+/);
    await expect(page.locator('#root > div[aria-hidden="true"]')).toHaveCount(1);
    expect(analyticsContextCalls).toBe(0);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'app_error_shown' && entry?.error_code === 'auth_required'
    )))).toEqual([]);
    const blockedKeys = await page.evaluate(() => {
        let count = 0;
        document.addEventListener('keydown', () => { count += 1; });
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return count;
    });
    expect(blockedKeys).toBe(0);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login\?reason=session_expired$/);
    expect(page.context().pages()).toEqual([page]);
    expect(configCalls).toBe(1);
});

test('parallel 401 failures keep the first safe target and do not stack dialogs', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/config**', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: '/login?reason=missing_scope' }),
    }));
    await page.route('**/api/groups-config', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: 'https://evil.example/login' }),
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('alertdialog')).toHaveCount(1);
    await expect(page.getByRole('alertdialog').getByRole('link')).toHaveAttribute('href', '/login?reason=missing_scope');
});

test('Home connection prerequisites retain targeted semantics without locking', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'epm' }));
    });
    await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        epmPrerequisite: true,
    });
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'EPM' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const settings = page.getByRole('dialog').first();
    await settings.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(settings.getByText('Not connected')).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
});

test('admin_required and csrf_required remain non-terminal application errors', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    for (const error of ['admin_required', 'csrf_required']) {
        await page.unroute('**/api/analytics/context');
        await page.route('**/api/analytics/context', route => route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error }),
        }));
        await page.evaluate(() => window.JepAnalytics.refreshAnalyticsContext());
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
    }
});

test('a latch published between render and external-store subscription is not missed', async ({ page }) => {
    await page.addInitScript(() => {
        const addEventListener = window.addEventListener.bind(window);
        let published = false;
        window.addEventListener = (type, listener, options) => {
            if (type === 'jep:authentication-required' && !published) {
                published = true;
                window.__JEP_AUTH_REQUIRED__ = Object.freeze({
                    locked: true,
                    loginUrl: '/login?reason=missing_scope',
                    reason: 'missing_scope',
                });
            }
            return addEventListener(type, listener, options);
        };
    });
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog').getByRole('link')).toHaveAttribute('href', '/login?reason=missing_scope');
});

test('focus refresh 401 before dashboard bootstrap is visible to the later root gate without redirect', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/auth/refresh', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: '//evil.example/login' }),
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog').getByRole('link')).toHaveAttribute('href', '/login?reason=session_expired');
    expect(new URL(page.url()).pathname).toBe('/');
});

test('an initialized enabled analytics session emits one privacy-safe auth lock event', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            enabled: true,
            gtmContainerId: 'GTM-TEST',
            ga4UserId: 'pseudonymous-user',
            debugMode: true,
        }),
    }));
    await page.route('https://www.googletagmanager.com/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.JepAnalytics))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).some(entry => entry?.event_name === 'page_view'))).toBe(true);

    await page.unroute('**/api/analytics/context');
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }),
    }));
    await page.evaluate(() => window.JepAnalytics.refreshAnalyticsContext().catch(() => {}));
    await expect(page.getByRole('alertdialog')).toBeVisible();

    const events = await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'app_error_shown' && entry?.error_code === 'auth_required'
    )));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
        event: 'userevent',
        trigger: 'userevent',
        event_type: 'event',
        event_name: 'app_error_shown',
        feature_name: 'auth',
        error_area: 'auth',
        error_code: 'auth_required',
        recoverable_state: 'reauth',
        source_surface: 'app',
    });
    expect(JSON.stringify(events[0])).not.toMatch(/https?:|@|token|workspace|response|config/i);
});

test('an initialized disabled analytics session emits no auth event', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: false }),
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.JepAnalytics))).toBe(true);
    await page.route('**/api/epm/projects**', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required' }),
    }));
    await page.getByRole('radio', { name: 'EPM', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => entry?.error_code === 'auth_required'))).toEqual([]);
});
