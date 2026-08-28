const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotPath = path.join(__dirname, '..', '..', 'test-results', 'settings-admin-access.png');

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (_) {
        return null;
    }
}

async function installSettingsFixture(page, {
    authMode = 'atlassian_oauth',
    adminUserManagementAvailable = true,
    settingsAdminOnly = false,
    userCanEditSettings = true,
    userCanEditEpmConfig = true,
    omitEpmPermission = false,
} = {}) {
    const calls = [];
    let users = [
        {
            id: 'db-user-admin',
            externalProvider: 'atlassian',
            externalSubject: 'account-admin',
            displayName: 'Synthetic Admin',
            email: 'admin@example.test',
            accountType: 'admin',
            status: 'active',
            authConnections: [],
            projectAccess: [],
        },
        {
            id: 'db-user-member',
            externalProvider: 'atlassian',
            externalSubject: 'account-member',
            displayName: 'Synthetic Member',
            email: 'member@example.test',
            accountType: 'user',
            status: 'active',
            authConnections: [],
            projectAccess: [],
        },
    ];

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
        calls.push({ method: request.method(), pathname: url.pathname, body: requestBody(request) });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example.test',
            authMode,
            settingsAdminOnly,
            userCanEditSettings,
            ...(omitEpmPermission ? {} : { userCanEditEpmConfig }),
            adminUserManagementAvailable,
            environmentConfigExists: true,
            projectsConfigured: true,
            epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} },
        });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json({
            version: 1,
            groups: [{ id: 'synthetic', name: 'Synthetic Department', teamIds: ['team-1'] }],
            defaultGroupId: 'synthetic',
            source: 'workspace_db',
            preferences: {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                visibleGroupIds: ['synthetic'],
                activeGroupId: 'synthetic',
                effectiveVisibleGroupIds: ['synthetic'],
            },
        });
        if (url.pathname === '/api/admin/users' && request.method() === 'GET') return json({ users });
        const grantMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/admin-grant$/);
        if (grantMatch && request.method() === 'POST') {
            users = users.map(user => user.id === grantMatch[1] ? { ...user, accountType: 'admin' } : user);
            return json({ user: users.find(user => user.id === grantMatch[1]) });
        }
        if (grantMatch && request.method() === 'DELETE') {
            users = users.map(user => user.id === grantMatch[1] ? { ...user, accountType: 'user' } : user);
            return json({ user: users.find(user => user.id === grantMatch[1]) });
        }
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: 42, name: 'Synthetic Sprint', state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [] });
        if (url.pathname === '/api/projects/selected') return json({ selected: [{ key: 'DEMO', type: 'product' }] });
        if (url.pathname === '/api/board-config') return json({ boardId: '7', boardName: 'Synthetic Board' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/capacity/config') return json({});
        if (url.pathname === '/api/sprint-field/config') return json({ fieldId: 'customfield_10020', fieldName: 'Sprint' });
        if (url.pathname === '/api/parent-name-field/config') return json({ fieldId: 'customfield_10021', fieldName: 'Parent Link' });
        if (url.pathname === '/api/story-points-field/config') return json({ fieldId: 'customfield_10022', fieldName: 'Story points' });
        if (url.pathname === '/api/team-field/config') return json({ fieldId: 'customfield_10023', fieldName: 'Team' });
        if (url.pathname === '/api/delivery-owner-field/config') return json({ fieldId: 'customfield_10024', fieldName: 'Delivery Owner' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        if (url.pathname === '/api/epm/config') return json({ version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} });
        return json({});
    });

    return calls;
}

async function openAccessTab(page) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Access' }).click();
    return dialog;
}

test('OAuth account IDs back administrator selection and unified Save', async ({ page }) => {
    const calls = await installSettingsFixture(page);
    const dialog = await openAccessTab(page);

    await expect(dialog.getByRole('heading', { name: 'App administrators' })).toBeVisible();
    const memberRow = dialog.locator('[data-admin-account-id="account-member"]');
    await expect(memberRow).toContainText('Synthetic Member');
    await expect(memberRow.getByRole('checkbox')).not.toBeChecked();

    await memberRow.getByRole('checkbox').check();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    await dialog.screenshot({ path: screenshotPath, animations: 'disabled' });
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect.poll(() => calls.some(call => call.method === 'POST'
        && call.pathname === '/api/admin/users/db-user-member/admin-grant')).toBe(true);
    await expect(dialog).toBeHidden();
});

test('Basic mode states that every user is an administrator without loading OAuth users', async ({ page }) => {
    const calls = await installSettingsFixture(page, {
        authMode: 'basic',
        adminUserManagementAvailable: false,
    });
    const dialog = await openAccessTab(page);

    await expect(dialog.getByText('Basic authentication gives every user administrator access.')).toBeVisible();
    expect(calls.some(call => call.pathname === '/api/admin/users')).toBe(false);
});

for (const permissionCase of [
    { name: 'missing for an administrator', userCanEditSettings: true, omitEpmPermission: true, visible: false },
    { name: 'false for an administrator', userCanEditSettings: true, userCanEditEpmConfig: false, visible: false },
    { name: 'true for a non-admin', userCanEditSettings: false, userCanEditEpmConfig: true, visible: true },
]) {
    test(`EPM edit permission is fail-closed when ${permissionCase.name}`, async ({ page }) => {
        await installSettingsFixture(page, {
            settingsAdminOnly: true,
            userCanEditSettings: permissionCase.userCanEditSettings,
            userCanEditEpmConfig: permissionCase.userCanEditEpmConfig,
            omitEpmPermission: permissionCase.omitEpmPermission,
        });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Manage team groups' }).click();
        const dialog = page.getByRole('dialog').first();
        const epmTab = dialog.getByRole('button', { name: 'EPM', exact: true });
        if (permissionCase.visible) {
            await expect(epmTab).toBeVisible();
        } else {
            await expect(epmTab).toHaveCount(0);
        }
    });
}
