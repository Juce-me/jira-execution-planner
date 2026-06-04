const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/shared-department-groups-qa';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (_) {
        return request.postData();
    }
}

async function mockFirstRunDashboard(page) {
    const calls = [];
    await installDashboardShell(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng',
            selectedSprint: 42,
        }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body: requestBody(request),
        });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                userCanEditEpmConfig: false,
            });
        }
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: [
                    { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
                    { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
                ],
                defaultGroupId: 'platform',
                configRevision: 2,
                source: 'workspace_db',
                preferences: {
                    customized: false,
                    preferenceExists: false,
                    onboardingRequired: true,
                    visibleGroupIds: [],
                    activeGroupId: null,
                    effectiveVisibleGroupIds: [],
                },
            });
        }
        if (url.pathname === '/api/groups-preferences') {
            const body = requestBody(request) || {};
            return json({
                preferences: {
                    customized: true,
                    preferenceExists: true,
                    onboardingRequired: false,
                    visibleGroupIds: body.visibleGroupIds || ['platform'],
                    activeGroupId: body.activeGroupId || 'platform',
                    effectiveVisibleGroupIds: body.visibleGroupIds || ['platform'],
                },
            });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            return json({ issues: [], epics: {}, epicsInScope: [] });
        }
        if (url.pathname === '/api/missing-info') {
            return json({ issues: [], epics: [] });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/board-config') return json({ boardId: '42', boardName: 'Synthetic Board' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/capacity/config') return json({});
        if (url.pathname.endsWith('-field/config')) return json({});
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });
    return calls;
}

test('first-run department selection blocks group-scoped task loads until preferences are saved', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('dialog', { name: 'Choose departments' })).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${screenshotDir}/first-run-selection.png`, fullPage: true });
    await expect(page.getByLabel('Platform')).toBeChecked();
    await page.waitForTimeout(250);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);

    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('dialog', { name: 'Choose departments' })).toHaveCount(0);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length).toBeGreaterThanOrEqual(2);
    const preferenceSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-preferences');
    expect(preferenceSave).toBeTruthy();
    expect(preferenceSave.body.visibleGroupIds).toEqual(['platform']);
    const taskCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name');
    expect(taskCalls.every(call => call.params.groupId === 'platform')).toBe(true);
    expect(taskCalls.every(call => call.params.teamIds === 'team-platform')).toBe(true);
});
