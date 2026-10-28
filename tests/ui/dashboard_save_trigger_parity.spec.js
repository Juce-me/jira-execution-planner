// Mocked pages only: the host just scopes localStorage, and it must never be the live 5050 server.
process.env.JEP_TEST_BASE_URL ||= 'http://localhost:5051';
const { test, expect } = require('@playwright/test');
const { appBaseUrl, installPinFixture, openPinDashboard, settle } = require('./eng_alert_pin_fixture');

const PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const savedPrefs = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), PREFS_KEY);

test('a lone alerts-panel toggle survives a group A to B to A switch', async ({ page }) => {
    await openPinDashboard(page);
    const toggle = page.locator('.alerts-panel-toggle');
    const switchGroup = async (name, id) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await page.locator('.view-selector .group-dropdown-toggle').click();
        await page.locator('.view-selector .group-dropdown-option', { hasText: name }).click();
        await settle(page);
        await expect(page.locator('.view-selector .group-dropdown-toggle')).toContainText(name);
        await expect.poll(async () => (await savedPrefs(page)).activeGroupId).toBe(id);
    };
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await settle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Nothing else changes after the toggle, so only the per-group snapshot memo can carry it across the switch.
    await switchGroup('Second', 'grp-second');
    await switchGroup('Default', 'grp-default');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('a lone Project Track Statistics preference persists across reload', async ({ page }) => {
    await installPinFixture(page, { prefs: { showStats: true, statsView: 'teams' } });
    // The fixture re-seeds its prefs on every load; restore the saved copy after it so the reload reads what the app saved.
    await page.addInitScript(key => {
        const kept = window.sessionStorage.getItem('kept-prefs');
        if (kept) window.localStorage.setItem(key, kept);
    }, PREFS_KEY);
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const tabs = page.locator('.stats-panel.open .stats-view-toggle');
    await tabs.getByRole('radio', { name: 'Project Track', exact: true }).click();
    await settle(page);
    const side = () => page.locator('.stats-view.open').getByRole('radiogroup', { name: 'Capacity side', exact: true });
    expect((await savedPrefs(page)).projectTrackCapacitySide).not.toBe('tech');
    await side().getByRole('radio', { name: 'Tech', exact: true }).click();
    await settle(page);
    // Nothing else changes: the ui-prefs save effect must fire on this dependency alone.
    await expect.poll(async () => (await savedPrefs(page)).projectTrackCapacitySide).toBe('tech');
    await page.evaluate(key => window.sessionStorage.setItem('kept-prefs', window.localStorage.getItem(key)), PREFS_KEY);
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page);
    expect((await savedPrefs(page)).projectTrackCapacitySide).toBe('tech');
    await expect(side().getByRole('radio', { name: 'Tech', exact: true })).toHaveAttribute('aria-checked', 'true');
});
