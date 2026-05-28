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

test('EPM settings sub-goal results keep wheel scroll inside the picker', async ({ page }) => {
    const epmSubGoals = Array.from({ length: 18 }, (_, index) => ({
        id: `child-${index + 1}`,
        key: `CHILD-${String(index + 1).padStart(3, '0')}`,
        name: `Connected Child Goal ${index + 1}`,
    }));
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
        epmConfig: {
            scope: { rootGoalKey: 'ROOT-100', subGoalKeys: [] },
        },
        epmSubGoals,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, 240));
    await page.getByRole('button', { name: 'Open EPM settings' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    const subGoalInput = dialog.getByPlaceholder('Add sub-goal...');
    await subGoalInput.focus();
    const results = dialog.locator('.team-search-results').last();
    await expect(results).toBeVisible();
    await expect(results.locator('.team-search-result-item')).toHaveCount(10);

    const beforePageScroll = await page.evaluate(() => window.scrollY);
    const resultsBox = await results.boundingBox();
    expect(resultsBox).not.toBeNull();
    await page.mouse.move(resultsBox.x + resultsBox.width / 2, resultsBox.y + resultsBox.height / 2);
    await page.mouse.wheel(0, 1800);

    await expect.poll(() => results.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforePageScroll);
});
