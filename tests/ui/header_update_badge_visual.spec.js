const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/header-update-badge-qa';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

test('header update badge compacts while search is active', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'epm',
            epmTab: 'active',
            selectedSprint: 42,
        }));
    });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = (body) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                epm: {
                    version: 2,
                    labelPrefix: 'rnd_project_',
                    scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-A'] },
                    issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story', 'Task'] },
                    projects: {},
                },
            });
        }
        if (url.pathname === '/api/version') {
            return json({ enabled: true, updateAvailable: true, remote: { hash: 'remote-build-1' } });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 42, name: '2026Q2', state: 'active' }] });
        }
        if (url.pathname === '/api/groups-config') {
            return json({ version: 1, groups: [], defaultGroupId: '' });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/epm/projects') return json({ projects: [] });
        if (url.pathname === '/api/epm/projects/rollup/all') {
            return json({ projects: [], duplicates: {}, truncated: false, fallback: true });
        }
        return json({});
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    const badge = page.locator('.update-badge');
    await expect(badge).toHaveText('New version available');
    const expandedBox = await badge.boundingBox();
    expect(expandedBox).toBeTruthy();

    await page.getByPlaceholder('Search tickets...').first().focus();
    await expect(badge).toHaveText('Update');
    const compactBox = await badge.boundingBox();
    expect(compactBox).toBeTruthy();
    expect(compactBox.width).toBeLessThan(expandedBox.width - 80);

    await page.getByPlaceholder('Search tickets...').first().evaluate((node) => node.blur());
    await page.waitForTimeout(40);
    await expect(badge).toHaveText('Update');
    await page.screenshot({ path: `${screenshotDir}/search-blur-delayed-update-badge.png`, fullPage: true });
    await page.waitForTimeout(240);
    await expect(badge).toHaveText('New version available');
});
