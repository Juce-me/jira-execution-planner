const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    appBaseUrl,
    disconnectedHomeTokenConnection,
    epmMetadataCalls,
    installDashboardFixture,
    openConnectionsSettings,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_home_token_fixture');

async function runtimeTokenValue(page) {
    return page.evaluate(() => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
}

async function closeSettingsDialog(page, dialog) {
    await dialog.getByRole('button', { name: 'Close' }).click();
    const discardButton = page.getByRole('button', { name: 'Discard' });
    if (await discardButton.isVisible().catch(() => false)) {
        await discardButton.click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('dashboard without Home token hides EPM and skips EPM metadata startup', async ({ page }) => {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });
    const fixture = await installDashboardFixture(page, {
        connection: disconnectedHomeTokenConnection(),
        settingsAdminOnly: true,
        userCanEditSettings: false,
        userCanEditEpmConfig: false,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'ENG' })).toBeVisible();
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toHaveCount(0);
    expect(epmMetadataCalls(fixture.calls)).toEqual([]);

    const dialog = await openConnectionsSettings(page);
    await expect(dialog.getByText('Not connected')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
});

test('connecting and revoking Home token updates EPM visibility without restart', async ({ page }) => {
    const fixture = await installDashboardFixture(page, {
        connection: disconnectedHomeTokenConnection(),
        userCanEditEpmConfig: true,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' }).getByRole('radio', { name: 'EPM' })).toHaveCount(0);

    let dialog = await openConnectionsSettings(page);
    const firstToken = await runtimeTokenValue(page);
    await dialog.getByLabel('Atlassian API token').fill(firstToken);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByText('Connected')).toBeVisible();
    await expect(dialog.getByLabel('Atlassian API token')).toHaveValue('');
    await expect(dialog).not.toContainText(firstToken);
    await closeSettingsDialog(page, dialog);

    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    await viewSwitch.getByRole('radio', { name: 'EPM' }).click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toBeVisible();

    await page.getByRole('button', { name: 'Open EPM settings' }).click();
    dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    await expect(dialog.getByText('Not connected')).toBeVisible();
    await closeSettingsDialog(page, dialog);

    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toHaveCount(0);
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toHaveCount(0);

    const homeTokenPosts = fixture.calls.filter(call => call.method === 'POST' && call.pathname === '/api/me/connections/home-token');
    expect(homeTokenPosts).toHaveLength(1);
    expect(homeTokenPosts[0].body.email).toBe('profile@example.com');
    expect(homeTokenPosts[0].body.apiToken).toBe(firstToken);
});

test('backend Home-token prerequisite refreshes status and clears stale EPM content', async ({ page }) => {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });
    const fixture = await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        epmPrerequisite: true,
        userCanEditEpmConfig: true,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toHaveCount(0);
    await expect(page.locator('.epm-project-board-name')).toHaveCount(0);
    expect(fixture.calls.filter(call => call.method === 'GET' && call.pathname === '/api/me/connections/home-token').length).toBeGreaterThanOrEqual(1);
});
