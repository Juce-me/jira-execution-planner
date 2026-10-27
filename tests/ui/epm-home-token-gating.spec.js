const { test, expect } = require('@playwright/test');
const {
    appBaseUrl,
    disconnectedHomeTokenConnection,
    enabledEpmOptions,
    epmAccessCalls,
    epmMetadataCalls,
    homeTokenStatusCalls,
    installDashboardFixture,
    openConnectionsSettings,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_home_token_fixture');

// EPM reads are gated by the private "Enable EPM view" checkbox, verified Home scopes and one access
// decision. The Home API-token connection is a write-purpose credential and gates nothing here.

const epmPrefs = {
    selectedView: 'epm',
    epmTab: 'active',
    epmSelectedProjectId: '',
    selectedSprint: selectedSprintId,
    sprintName: selectedSprintName,
};

async function seedEpmView(page) {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, epmPrefs);
}

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

test('OAuth user with the checkbox off hides EPM, skips EPM and access requests and token status at startup', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, {
        connection: disconnectedHomeTokenConnection(),
        settingsAdminOnly: true,
        userCanEditSettings: false,
        userCanEditEpmConfig: false,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' })).toHaveCount(0);
    await page.screenshot({
        path: 'tmp/h4c/epm-gating-no-view-switch.png',
        animations: 'disabled',
        fullPage: false,
    });
    expect(epmMetadataCalls(fixture.calls)).toEqual([]);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
    expect(homeTokenStatusCalls(fixture.calls)).toEqual([]);

    const dialog = await openConnectionsSettings(page);
    await expect(dialog.getByText('Not connected')).toBeVisible();
    await expect(dialog.getByText('Off', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
    expect(homeTokenStatusCalls(fixture.calls)).toHaveLength(1);
});

test('basic auth mode shows EPM without a Home token, an access read or the checkbox gate', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, {
        authMode: 'basic',
        connection: disconnectedHomeTokenConnection(),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeChecked();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toBeVisible();
    expect(epmMetadataCalls(fixture.calls).map(call => call.pathname)).toContain('/api/epm/projects');
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
    expect(homeTokenStatusCalls(fixture.calls)).toEqual([]);
});

test('connecting and revoking a Home token changes neither EPM visibility nor EPM requests', async ({ page }) => {
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    const fixture = await installDashboardFixture(page, {
        ...enabledEpmOptions(),
        connection: disconnectedHomeTokenConnection(),
        userCanEditEpmConfig: true,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);
    const startupEpmCalls = epmMetadataCalls(fixture.calls).length;

    let dialog = await openConnectionsSettings(page);
    const firstToken = await runtimeTokenValue(page);
    await dialog.getByLabel('Atlassian API token').fill(firstToken);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Atlassian API token')).toHaveValue('');
    await expect(dialog).not.toContainText(firstToken);
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    await expect(dialog.getByText('Not connected')).toBeVisible();
    await closeSettingsDialog(page, dialog);

    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    await viewSwitch.getByRole('radio', { name: 'EPM' }).click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toBeVisible();
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);
    expect(epmMetadataCalls(fixture.calls).length).toBeGreaterThanOrEqual(startupEpmCalls);

    const homeTokenPosts = fixture.calls.filter(call => call.method === 'POST' && call.pathname === '/api/me/connections/home-token');
    expect(homeTokenPosts).toHaveLength(1);
    expect(homeTokenPosts[0].body.email).toBe('profile@example.com');
    expect(homeTokenPosts[0].body.apiToken).toBe(firstToken);
    expect(fixture.calls.filter(call => call.method === 'DELETE' && call.pathname === '/api/me/connections/home-token')).toHaveLength(1);
});
