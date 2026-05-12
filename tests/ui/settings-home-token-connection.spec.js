const { test, expect } = require('@playwright/test');
const {
    appBaseUrl,
    disconnectedHomeTokenConnection,
    installDashboardFixture,
    openConnectionsSettings,
} = require('./epm_home_token_fixture');

async function runtimeTokenValue(page) {
    return page.evaluate(() => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
}

test('normal authenticated user can connect update and revoke Home token', async ({ page }) => {
    const fixture = await installDashboardFixture(page, {
        connection: disconnectedHomeTokenConnection(),
        settingsAdminOnly: true,
        userCanEditSettings: false,
        userCanEditEpmConfig: false,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const dialog = await openConnectionsSettings(page);

    await expect(dialog.getByRole('button', { name: 'Scope projects' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Connections' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveValue('profile@example.com');

    const firstToken = await runtimeTokenValue(page);
    await dialog.getByLabel('Atlassian API token').fill(firstToken);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByText('Connected')).toBeVisible();
    await expect(dialog.getByLabel('Atlassian API token')).toHaveValue('');
    await expect(dialog).not.toContainText(firstToken);

    const secondToken = await runtimeTokenValue(page);
    await dialog.getByLabel('Atlassian API token').fill(secondToken);
    await dialog.getByRole('button', { name: 'Reconnect' }).click();
    await expect(dialog.getByText('Connection saved.')).toBeVisible();
    await expect(dialog.getByLabel('Atlassian API token')).toHaveValue('');
    await expect(dialog).not.toContainText(secondToken);

    await dialog.getByRole('button', { name: 'Revoke' }).click();
    await expect(dialog.getByText('Not connected')).toBeVisible();

    const homeTokenPosts = fixture.calls.filter(call => call.method === 'POST' && call.pathname === '/api/me/connections/home-token');
    expect(homeTokenPosts).toHaveLength(2);
    expect(homeTokenPosts[0].body).toEqual({ email: 'profile@example.com', apiToken: firstToken });
    expect(homeTokenPosts[1].body).toEqual({ email: 'profile@example.com', apiToken: secondToken });
    expect(fixture.calls.some(call => call.method === 'DELETE' && call.pathname === '/api/me/connections/home-token')).toBe(true);
});
