const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (_) {
        return null;
    }
}

async function mockConfigSettings(page) {
    const calls = [];
    const groupsConfig = {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
        ],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
        preferences: {
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        },
    };
    const epmConfig = {
        version: 2,
        labelPrefix: 'rnd_project_',
        scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] },
        projects: {},
    };

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
            body: requestBody(request),
        });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/me/connections/home-token') return json({
            connected: true,
            provider: 'atlassian_user_api_token',
            credentialSubject: 'profile@example.com',
            status: 'active',
            needsReconnect: false,
        });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example',
            projectsConfigured: true,
            settingsAdminOnly: false,
            userCanEditSettings: true,
            userCanEditEpmConfig: true,
            epm: epmConfig,
        });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') return json(groupsConfig);
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') return json({
            ...requestBody(request),
            configRevision: 3,
            source: 'workspace_db',
            preferences: groupsConfig.preferences,
        });
        if (url.pathname === '/api/groups-preferences') return json({ preferences: groupsConfig.preferences });
        if (url.pathname === '/api/epm/config' && request.method() === 'GET') return json(epmConfig);
        if (url.pathname === '/api/epm/config' && request.method() === 'POST') return json(requestBody(request));
        if (url.pathname === '/api/epm/scope') return json({ cloudId: 'synthetic-cloud', error: '' });
        if (url.pathname === '/api/epm/goals') {
            if (url.searchParams.get('rootGoalKey')) {
                return json({ goals: [{ id: 'child', key: 'CHILD-200', name: 'Child Goal' }], error: '' });
            }
            return json({ goals: [{ id: 'root', key: 'ROOT-100', name: 'Root Goal' }], error: '' });
        }
        if (url.pathname === '/api/epm/projects/configuration') return json({ projects: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [] });
        if (url.pathname === '/api/projects/selected') return json({ selected: [{ key: 'DEMO', type: 'product' }] });
        if (url.pathname === '/api/board-config') return json({ boardId: '42', boardName: 'Synthetic Board' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/capacity/config') return json({});
        if (url.pathname === '/api/sprint-field/config') return json({ fieldId: 'customfield_10020', fieldName: 'Sprint' });
        if (url.pathname === '/api/parent-name-field/config') return json({ fieldId: 'customfield_10021', fieldName: 'Parent Link' });
        if (url.pathname === '/api/story-points-field/config') return json({ fieldId: 'customfield_10022', fieldName: 'Story points' });
        if (url.pathname === '/api/team-field/config') return json({ fieldId: 'customfield_10023', fieldName: 'Team' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });

    return calls;
}

test('settings save persists dirty department and EPM sections together', async ({ page }) => {
    const calls = await mockConfigSettings(page);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByPlaceholder('Group name').fill('Platform Core');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');

    await dialog.getByRole('button', { name: /Save/ }).click();

    await expect(dialog).toHaveCount(0);
    const departmentSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    const epmSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/epm/config');
    expect(departmentSave).toBeTruthy();
    expect(epmSave).toBeTruthy();
    expect(departmentSave.body.groups[0].name).toBe('Platform Core');
    expect(epmSave.body.labelPrefix).toBe('rnd_project_core_');
});
