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
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await expect(dialog.getByText('Main goal', { exact: true })).toBeVisible();
    const mainGoalChip = dialog.locator('.epm-scope-chip.is-root');
    await expect(mainGoalChip).toContainText('Connected Root Goal');
    await expect(mainGoalChip).toContainText('ROOT-100');
    const mainGoalBox = await mainGoalChip.boundingBox();
    expect(mainGoalBox.width).toBeLessThan(420);
    await expect(dialog.locator('.epm-scope-chip.is-child')).toContainText('Connected Child Goal');
    await expect(dialog.getByText('Connected Child Goal (CHILD-200)')).toBeVisible();
});
