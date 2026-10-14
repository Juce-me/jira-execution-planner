const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
test('header has no release update UI or request while search is active', async ({ page }, testInfo) => {
    const versionRequests = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/version') versionRequests.push(request.url());
    });
    await installDashboardShell(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'epm',
            epmTab: 'active',
            selectedSprint: 42,
            updateDismissedHash: 'legacy-dismissed-revision',
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
        if (url.pathname === '/api/auth/refresh') {
            return route.fulfill({ status: 204, body: '' });
        }
        if (url.pathname === '/api/me/connections/home-token') {
            return json({
                connected: true,
                provider: 'atlassian_user_api_token',
                credentialSubject: 'profile@example.com',
                status: 'active',
                needsReconnect: false,
            });
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
    await expect(page.locator('.subtitle-main')).toContainText('Jira Delivery Planner');
    const assertNoUpdate = async () => {
        await expect(page.locator('.update-badge, .update-modal-backdrop')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'New version available' })).toHaveCount(0);
        expect(versionRequests).toEqual([]);
    };
    await assertNoUpdate();
    const searchInput = page.getByPlaceholder('Search tickets...').first();
    await searchInput.focus();
    await assertNoUpdate();
    await page.screenshot({ path: testInfo.outputPath('search-focused-no-update.png'), fullPage: true, animations: 'disabled' });
    await searchInput.fill('synthetic');
    await assertNoUpdate();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(searchInput).toHaveValue('');
    await assertNoUpdate();
    await page.screenshot({ path: testInfo.outputPath('search-cleared-no-update.png'), fullPage: true, animations: 'disabled' });
});
