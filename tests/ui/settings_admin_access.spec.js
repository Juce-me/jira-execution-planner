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
    userIsToolAdmin = true,
    settingsAdminOnly = false,
    userCanEditSettings = true,
    userCanEditEpmConfig = true,
    omitEpmPermission = false,
    // Exact permission keys for /api/config, replacing settingsAdminOnly/userCanEditSettings (a missing key is omitted from the JSON).
    permissions = null,
    // Permission key sets for successive GET /api/config responses (the last one repeats): bootstrap, then the post-save refresh.
    permissionSequence = null,
    // Holds the first GET /api/config until the promise resolves.
    configGate = null,
} = {}) {
    const calls = [];
    let configGets = 0;
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
        if (url.pathname === '/api/config') {
            const configIndex = configGets;
            configGets += 1;
            if (configGate && configIndex === 0) await configGate;
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') return json({
            ...requestBody(request),
            configRevision: 3,
            source: 'workspace_db',
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
        if (url.pathname === '/api/epm/config' && request.method() === 'POST') return json(requestBody(request));
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example.test',
            authMode,
            ...(permissionSequence
                ? permissionSequence[Math.min(configGets - 1, permissionSequence.length - 1)]
                : (permissions || { settingsAdminOnly, userCanEditSettings })),
            ...(omitEpmPermission ? {} : { userCanEditEpmConfig }),
            adminUserManagementAvailable,
            userIsToolAdmin,
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
                onboardingDone: true,
                completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
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
        if (url.pathname === '/api/team-catalog') return json({
            catalog: { 'team-1': { id: 'team-1', name: 'Synthetic Team' } },
            meta: { updatedAt: '2026-09-02T09:00:00Z', sprintId: '42', source: 'sprint' },
        });
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

test('collaborative settings hide Access and never load the user directory for a non-admin', async ({ page }) => {
    const calls = await installSettingsFixture(page, {
        settingsAdminOnly: false,
        userCanEditSettings: true,
        userIsToolAdmin: false,
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin', exact: true }).click();

    await expect(dialog.getByRole('tab', { name: 'Scope projects' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Access' })).toHaveCount(0);
    expect(calls.some(call => call.pathname.startsWith('/api/admin/'))).toBe(false);
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

// G2 permission fix (issue #220): administrator-section editing requires the explicit boolean grant
// userCanEditSettings === true. settingsAdminOnly is metadata and can never grant editing by itself.
const ADMIN_CONFIG_PATHS = [
    '/api/projects/selected', '/api/stats/priority-weights-config', '/api/board-config', '/api/capacity/config',
    '/api/sprint-field/config', '/api/parent-name-field/config', '/api/story-points-field/config',
    '/api/team-field/config', '/api/delivery-owner-field/config', '/api/issue-types/config',
];
const adminWrites = calls => calls.filter(call => call.method !== 'GET'
    && (ADMIN_CONFIG_PATHS.includes(call.pathname) || call.pathname.startsWith('/api/admin/')));

// Waits for the bootstrap /api/config response and two animation frames before opening Settings, so an assertion that
// the Admin tab is absent cannot pass merely because the config has not been applied yet.
async function openSettings(page) {
    const configResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/config');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await configResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    return page.getByRole('dialog').first();
}

for (const denied of [
    { name: 'settingsAdminOnly and userCanEditSettings both missing', permissions: {} },
    { name: 'settingsAdminOnly missing, userCanEditSettings false', permissions: { userCanEditSettings: false } },
    { name: 'settingsAdminOnly false, userCanEditSettings missing', permissions: { settingsAdminOnly: false } },
    { name: 'settingsAdminOnly false, userCanEditSettings false', permissions: { settingsAdminOnly: false, userCanEditSettings: false } },
    { name: "settingsAdminOnly false, userCanEditSettings 'true'", permissions: { settingsAdminOnly: false, userCanEditSettings: 'true' } },
    { name: 'settingsAdminOnly false, userCanEditSettings 1', permissions: { settingsAdminOnly: false, userCanEditSettings: 1 } },
    { name: 'settingsAdminOnly false, userCanEditSettings null', permissions: { settingsAdminOnly: false, userCanEditSettings: null } },
    { name: 'settingsAdminOnly true, userCanEditSettings false', permissions: { settingsAdminOnly: true, userCanEditSettings: false } },
]) {
    test(`administrator editing is denied when ${denied.name}`, async ({ page }) => {
        const calls = await installSettingsFixture(page, { permissions: denied.permissions });
        const dialog = await openSettings(page);
        await expect(dialog.getByRole('button', { name: 'Departments', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
        expect(adminWrites(calls)).toEqual([]);
    });
}

for (const granted of [
    { name: 'settingsAdminOnly true', permissions: { settingsAdminOnly: true, userCanEditSettings: true } },
    { name: 'settingsAdminOnly false', permissions: { settingsAdminOnly: false, userCanEditSettings: true } },
    { name: 'settingsAdminOnly missing', permissions: { userCanEditSettings: true } },
]) {
    test(`an explicit true grant keeps administrator editing available with ${granted.name}`, async ({ page }) => {
        await installSettingsFixture(page, { permissions: granted.permissions, userIsToolAdmin: false });
        const dialog = await openSettings(page);
        await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toBeVisible();
    });
}

test('administrator editing stays denied while the config is loading and is granted once it arrives', async ({ page }) => {
    let release;
    const configGate = new Promise((resolve) => { release = resolve; });
    await installSettingsFixture(page, { permissions: { settingsAdminOnly: true, userCanEditSettings: true }, configGate });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const gear = page.getByRole('button', { name: 'Manage team groups' });
    await gear.click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    release();
    await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toBeVisible();
});

test('the post-save config refresh revokes administrator editing when the grant is no longer explicit', async ({ page }) => {
    const calls = await installSettingsFixture(page, {
        permissionSequence: [
            { settingsAdminOnly: true, userCanEditSettings: true },
            {},
        ],
    });
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    await dialog.getByPlaceholder('Group name').fill('Renamed Department');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.getByRole('dialog').first();
    await expect(reopened.getByRole('button', { name: 'Departments', exact: true })).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    expect(adminWrites(calls)).toEqual([]);
});

test('a valid non-admin still saves shared Department groups and private EPM settings without any administrator write', async ({ page }) => {
    const calls = await installSettingsFixture(page, {
        permissions: { settingsAdminOnly: true, userCanEditSettings: false },
        userCanEditEpmConfig: true,
    });
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    await dialog.getByPlaceholder('Group name').fill('Renamed Department');
    await dialog.getByRole('button', { name: 'EPM', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config').length).toBe(1);
    expect(adminWrites(calls)).toEqual([]);
    expect(calls.find(call => call.method === 'POST' && call.pathname === '/api/epm/config').body.labelPrefix).toBe('rnd_project_core_');
});
