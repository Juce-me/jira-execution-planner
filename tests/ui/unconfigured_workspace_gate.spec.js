const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = path.join(__dirname, '..', '..', 'test-results');
const JIRA_WORK_PATHS = new Set([
    '/api/sprints', '/api/tasks-with-team-name', '/api/missing-info', '/api/team-catalog',
    '/api/stats/epic-cohort', '/api/stats/excluded-capacity-source', '/api/eng-board/load',
]);

async function installGateFixture(page, { adminSettingsMissing, adminContacts, userCanEditSettings }) {
    const calls = [];
    await installDashboardShell(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng',
            selectedSprint: 42,
            selectedSprintName: 'Synthetic Sprint',
        }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({ pathname: url.pathname, at: Date.now() });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') {
            // Delay config so a sprint read racing it would be observable.
            await new Promise(resolve => setTimeout(resolve, 300));
            return json({
                jiraUrl: 'https://jira.example.test',
                authMode: 'atlassian_oauth',
                settingsAdminOnly: true,
                userCanEditSettings,
                userCanEditEpmConfig: true,
                adminUserManagementAvailable: true,
                environmentConfigExists: true,
                projectsConfigured: !adminSettingsMissing.includes('scope'),
                boardId: adminSettingsMissing.includes('source') ? '' : '7',
                adminSettingsMissing,
                ...(adminContacts ? { adminContacts } : {}),
                sharedConfig: adminSettingsMissing.length ? {} : {
                    board: { boardId: '7', boardName: 'Synthetic Board' },
                    projects: { selected: [{ key: 'DEMO', type: 'product' }] },
                },
                sharedConfigRevision: 1,
                epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} },
            });
        }
        if (url.pathname === '/api/groups-config') return json({
            version: 1,
            groups: [{ id: 'synthetic', name: 'Synthetic Department', teamIds: ['team-1'] }],
            defaultGroupId: 'synthetic',
            source: 'workspace_db',
            configRevision: 1,
            preferences: {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                onboardingDone: true,
                completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
                visibleGroupIds: ['synthetic'],
                activeGroupId: 'synthetic',
                effectiveVisibleGroupIds: ['synthetic'],
            },
        });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: 42, name: 'Synthetic Sprint', state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [] });
        return json({});
    });
    return calls;
}

function jiraWorkCalls(calls) {
    return calls.filter(call => JIRA_WORK_PATHS.has(call.pathname)).map(call => call.pathname);
}

test('non-admin sees the admin contact alert and no Jira work starts', async ({ page }) => {
    const calls = await installGateFixture(page, {
        adminSettingsMissing: ['scope', 'source'],
        adminContacts: ['Alice Admin', 'Zed Admin'],
        userCanEditSettings: false,
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    const notice = page.getByRole('alert', { name: 'Dashboard configuration' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('This dashboard is not configured yet.');
    await expect(notice).toContainText('Reach out to a tool admin to configure it:');
    await expect(notice.getByRole('listitem')).toHaveText(['Alice Admin', 'Zed Admin']);
    await expect(notice.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.sprint-dropdown-toggle').first()).not.toContainText('Loading');
    await expect(page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' })).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(jiraWorkCalls(calls)).toEqual([]);
    await notice.screenshot({ path: path.join(screenshotDir, 'unconfigured-workspace-user.png'), animations: 'disabled' });
});

test('non-admin without any tool admin sees the generic contact line', async ({ page }) => {
    await installGateFixture(page, {
        adminSettingsMissing: ['source'],
        adminContacts: [],
        userCanEditSettings: false,
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    const notice = page.getByRole('alert', { name: 'Dashboard configuration' });
    await expect(notice).toContainText('No tool admin is set up yet.');
    await expect(notice.getByRole('listitem')).toHaveCount(0);
});

test('admin gets admin settings opened on the first missing tab and no Jira work starts', async ({ page }) => {
    const calls = await installGateFixture(page, {
        adminSettingsMissing: ['scope', 'source'],
        userCanEditSettings: true,
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Scope projects' })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(800);
    expect(jiraWorkCalls(calls).filter(pathname => pathname !== '/api/team-catalog')).toEqual([]);

    await page.keyboard.press('Escape');
    const notice = page.getByRole('alert', { name: 'Dashboard configuration' });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('listitem')).toHaveCount(0);
    await notice.screenshot({ path: path.join(screenshotDir, 'unconfigured-workspace-admin.png'), animations: 'disabled' });
    await notice.getByRole('button', { name: 'Open admin settings' }).click();
    await expect(page.getByRole('dialog').first().getByRole('tab', { name: 'Scope projects' })).toHaveAttribute('aria-selected', 'true');
});

test('configured workspace requests sprints only after the config bootstrap', async ({ page }) => {
    await installGateFixture(page, {
        adminSettingsMissing: [],
        userCanEditSettings: false,
    });
    let configRespondedAt = null;
    let sprintsRequestedAt = null;
    page.on('response', response => {
        if (new URL(response.url()).pathname === '/api/config' && configRespondedAt === null) configRespondedAt = Date.now();
    });
    const sprintsRequest = page.waitForRequest(request => {
        if (new URL(request.url()).pathname !== '/api/sprints') return false;
        sprintsRequestedAt = Date.now();
        return true;
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await sprintsRequest;

    expect(configRespondedAt).not.toBeNull();
    expect(sprintsRequestedAt).toBeGreaterThanOrEqual(configRespondedAt);
    await expect(page.getByRole('alert', { name: 'Dashboard configuration' })).toHaveCount(0);
});
