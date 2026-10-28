const { test, expect } = require('@playwright/test');
const {
    appBaseUrl,
    enabledEpmOptions,
    epmAccessCalls,
    epmMetadataCalls,
    installDashboardFixture,
    openConnectionsSettings,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_view_fixture');

// EPM reads are gated by the private "Enable EPM view" checkbox, verified Home scopes and one access
// decision. Home is read only through OAuth: no Home token endpoint is ever requested.

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

const connectionCalls = (calls) => calls.filter(call => call.pathname.startsWith('/api/me/connections/'));

test('OAuth user with the checkbox off hides EPM and makes no EPM, access or Home token request', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, {
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
    expect(connectionCalls(fixture.calls)).toEqual([]);

    const dialog = await openConnectionsSettings(page);
    await expect(dialog.getByText('Off', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'Enable EPM view' })).not.toBeChecked();
    await expect(dialog.locator('.user-connection-card')).toHaveCount(1);
    expect(connectionCalls(fixture.calls)).toEqual([]);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
});

test('basic auth mode shows EPM without an access read or the checkbox gate', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, {
        authMode: 'basic',
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeChecked();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toBeVisible();
    expect(epmMetadataCalls(fixture.calls).map(call => call.pathname)).toContain('/api/epm/projects');
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
    expect(connectionCalls(fixture.calls)).toEqual([]);
});

test('an enabled OAuth user sees EPM after one access read and Connections opens without a Home token request', async ({ page }) => {
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    const fixture = await installDashboardFixture(page, {
        ...enabledEpmOptions(),
        userCanEditEpmConfig: true,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);

    const dialog = await openConnectionsSettings(page);
    await expect(dialog.getByRole('checkbox', { name: 'Enable EPM view' })).toBeChecked();
    await expect(dialog.locator('.user-connection-card')).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    expect(connectionCalls(fixture.calls)).toEqual([]);
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);
});
