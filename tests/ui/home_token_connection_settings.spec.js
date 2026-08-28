const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

async function mockBaseApp(page, { connection, connectStatus = 200 } = {}) {
    const requests = [];
    let currentConnection = connection || { connected: false };

    await installDashboardShell(page);

    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        requests.push({ method: request.method(), pathname, body: request.postDataJSON?.() });

        if (pathname === '/api/config') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    jiraUrl: 'https://example.atlassian.net',
                    settingsAdminOnly: false,
                    userCanEditSettings: true,
                    environmentConfigExists: true,
                    projectsConfigured: true,
                    epm: { version: 2, scope: {}, projects: {} },
                }),
            });
        }
        if (pathname === '/api/auth/status') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ authenticated: true, email: 'profile@example.com' }),
            });
        }
        if (pathname === '/api/auth/csrf') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ csrfToken: 'csrf-token' }),
            });
        }
        if (pathname === '/api/me/connections/home-token' && request.method() === 'GET') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(currentConnection),
            });
        }
        if (pathname === '/api/me/connections/home-token' && request.method() === 'POST') {
            if (connectStatus !== 200) {
                return route.fulfill({
                    status: connectStatus,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'home_credential_not_authorized', message: 'Home rejected this credential.' }),
                });
            }
            currentConnection = {
                connected: true,
                provider: 'atlassian_user_api_token',
                credentialSubject: 'profile@example.com',
                status: 'active',
                lastValidatedAt: '2026-05-11T09:00:00Z',
                needsReconnect: false,
            };
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(currentConnection),
            });
        }
        if (pathname === '/api/me/connections/home-token' && request.method() === 'DELETE') {
            currentConnection = { connected: false };
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(currentConnection),
            });
        }
        if (pathname === '/api/groups-config') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ version: 1, groups: [], defaultGroupId: '' }),
            });
        }
        if (pathname === '/api/version') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ enabled: false }),
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });

    return requests;
}

async function openConnections(page) {
    await page.goto(appBaseUrl);
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await expect(dialog.getByText('Jira Home write access')).toBeVisible();
    return dialog;
}

test('Connections tab connects Home token and clears token field', async ({ page }) => {
    const requests = await mockBaseApp(page);
    const dialog = await openConnections(page);

    await expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveValue('profile@example.com');
    await expect(dialog.getByText('Not connected')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toHaveCount(0);

    await dialog.getByLabel('Atlassian API token').fill('plain-user-token');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(dialog.getByText('Connected')).toBeVisible();
    await expect(dialog.getByLabel('Atlassian API token')).toHaveValue('');
    await expect(dialog).not.toContainText('plain-user-token');

    const connectRequest = requests.find(call => call.method === 'POST' && call.pathname === '/api/me/connections/home-token');
    expect(connectRequest.body).toEqual({ email: 'profile@example.com', apiToken: 'plain-user-token' });
});

test('Connections tab clears token field after connect failure', async ({ page }) => {
    await mockBaseApp(page, { connectStatus: 403 });
    const dialog = await openConnections(page);

    await dialog.getByLabel('Atlassian API token').fill('bad-user-token');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(dialog.getByText('Home token connection error 403')).toBeVisible();
    await expect(dialog.getByLabel('Atlassian API token')).toHaveValue('');
    await expect(dialog).not.toContainText('bad-user-token');
});

test('Connections tab shows reconnect and revoke states without token material', async ({ page }) => {
    await mockBaseApp(page, {
        connection: {
            connected: true,
            provider: 'atlassian_user_api_token',
            credentialSubject: 'user@example.com',
            status: 'expired',
            lastValidatedAt: '2026-05-11T09:00:00Z',
            needsReconnect: true,
        },
    });
    const dialog = await openConnections(page);

    await expect(dialog.getByText('Reconnect required')).toBeVisible();
    await expect(dialog.getByText('user@example.com')).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    await expect(dialog.getByText('Not connected')).toBeVisible();
    await expect(dialog).not.toContainText('api_token');
});
