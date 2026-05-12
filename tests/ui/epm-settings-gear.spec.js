const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    appBaseUrl,
    installDashboardFixture,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_home_token_fixture');

test('visible EPM tab exposes settings gear that opens EPM settings', async ({ page }) => {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });
    await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        userCanEditEpmConfig: true,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toBeVisible();

    await page.getByRole('button', { name: 'Open EPM settings' }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.locator('.group-modal-tab.active', { hasText: 'EPM' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByText('EPM projects')).toBeVisible();
});
