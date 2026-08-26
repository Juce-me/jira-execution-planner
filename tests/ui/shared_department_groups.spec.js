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

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
}

function visibleStoryPayload(project = 'product') {
    const key = project === 'product' ? 'PLAT-1' : 'TECH-1';
    const epicKey = project === 'product' ? 'PLAT-EPIC' : 'TECH-EPIC';
    return {
        issues: [{
            id: key,
            key,
            fields: {
                summary: `${project} visible story`,
                status: { name: 'To Do' },
                priority: { name: 'High' },
                issuetype: { name: 'Story' },
                assignee: { displayName: 'Synthetic Owner' },
                updated: '2026-08-25T00:00:00.000+0000',
                customfield_10004: 3,
                epicKey,
                parentSummary: `${project} delivery epic`,
                projectKey: project === 'product' ? 'PLAT' : 'TECH',
                teamId: project === 'product' ? 'team-platform' : 'team-platform',
                teamName: 'Platform',
                sprint: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }],
            },
        }],
        epics: {
            [epicKey]: {
                key: epicKey,
                summary: `${project} delivery epic`,
                status: { name: 'In Progress' },
                teamId: 'team-platform',
                teamName: 'Platform',
                sprint: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }],
            },
        },
        epicsInScope: [],
        names: {},
    };
}

function defaultGroupPreferences(overrides = {}) {
    return {
        customized: false,
        preferenceExists: false,
        onboardingRequired: true,
        visibleGroupIds: [],
        activeGroupId: null,
        effectiveVisibleGroupIds: [],
        ...overrides,
    };
}

async function mockFirstRunDashboard(page, options = {}) {
    const calls = [];
    const groupsConfig = options.groupsConfig || {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
            { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
        ],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
    };
    const preferences = options.preferences || defaultGroupPreferences();
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
            if (request.method() === 'POST') {
                const body = requestBody(request) || {};
                return json({
                    ...groupsConfig,
                    groups: body.groups || groupsConfig.groups,
                    defaultGroupId: body.defaultGroupId || groupsConfig.defaultGroupId,
                    configRevision: (groupsConfig.configRevision || 0) + 1,
                    preferences,
                });
            }
            return json({
                ...groupsConfig,
                preferences,
            });
        }
        if (url.pathname === '/api/groups-preferences') {
            const body = requestBody(request) || {};
            if (options.preferenceGate) await options.preferenceGate.promise;
            if (options.preferenceError) {
                return json(options.preferenceError.body, options.preferenceError.status);
            }
            const savedPreferences = {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                visibleGroupIds: body.visibleGroupIds || ['platform'],
                activeGroupId: body.activeGroupId || 'platform',
                effectiveVisibleGroupIds: body.visibleGroupIds || ['platform'],
            };
            const snapshot = options.preferenceSnapshotConfig || groupsConfig;
            return json({
                preferences: savedPreferences,
                ...(options.omitPreferenceSnapshot ? {} : {
                    groupsConfigSnapshot: {
                        ...snapshot,
                        preferences: savedPreferences,
                    },
                }),
            });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            return json(options.taskPayload === false
                ? { issues: [], epics: {}, epicsInScope: [] }
                : visibleStoryPayload(url.searchParams.get('project') || 'product'));
        }
        if (url.pathname === '/api/missing-info') {
            return json({ issues: [], epics: [] });
        }
        if (url.pathname === '/api/epics/search') {
            return json({ epics: options.epicSearchResults || [{ key: 'PROD-ADHOC', summary: 'Synthetic ad hoc' }] });
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

function overflowGroupConfig() {
    return {
        version: 1,
        groups: [{
            id: 'bidswitch',
            name: 'Bidswitch',
            teamIds: Array.from({ length: 12 }, (_, index) => `team-${index + 1}`),
            missingInfoComponents: Array.from({ length: 8 }, (_, index) => `ATS Component ${index + 1}`),
            excludedCapacityEpics: Array.from({ length: 28 }, (_, index) => `TECH-${26000 + index}`),
        }],
        defaultGroupId: 'bidswitch',
        configRevision: 4,
        source: 'workspace_db',
    };
}

test('first-run department selection blocks group-scoped task loads until preferences are saved', async ({ page }) => {
    const preferenceGate = deferred();
    const calls = await mockFirstRunDashboard(page, {
        preferenceGate,
        groupsConfig: {
            version: 1,
            groups: [
                { id: 'platform', name: 'Platform', teamIds: ['team-old'] },
                { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
                { id: 'empty', name: 'Empty', teamIds: [] },
            ],
            defaultGroupId: 'platform',
            configRevision: 2,
            source: 'workspace_db',
        },
        preferenceSnapshotConfig: {
            version: 1,
            groups: [
                { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
                { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
                { id: 'empty', name: 'Empty', teamIds: [] },
            ],
            defaultGroupId: 'platform',
            configRevision: 3,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Choose your group' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Search groups')).toBeVisible();
    await expect(page.locator('.department-first-run-option-name')).toHaveText(['Empty', 'Growth', 'Platform']);
    await expect(dialog.getByRole('radio')).toHaveCount(3);
    await expect(dialog.getByRole('radio', { name: /Platform/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /Empty/ })).toBeDisabled();
    await expect(page.getByText('Configure teams before choosing this group')).toBeVisible();
    await dialog.getByRole('radio', { name: /Platform/ }).check();
    await expect(dialog.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await page.getByLabel('Search groups').fill('growth');
    await expect(dialog.getByRole('radio', { name: /Growth/ })).toBeVisible();
    await page.getByLabel('Search groups').fill('');
    await expect(dialog.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${screenshotDir}/first-run-selection.png`, fullPage: true });
    await page.waitForTimeout(250);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Saving...' }).click({ force: true }).catch(() => {});
    await expect.poll(() => calls.filter(call => call.pathname === '/api/groups-preferences').length).toBe(1);
    await page.waitForTimeout(200);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);
    preferenceGate.resolve();

    await expect(page.getByRole('dialog', { name: 'Choose your group' })).toHaveCount(0);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length).toBeGreaterThanOrEqual(2);
    const preferenceSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-preferences');
    expect(preferenceSave).toBeTruthy();
    expect(preferenceSave.body.visibleGroupIds).toEqual(['platform']);
    const taskCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name');
    expect(taskCalls.every(call => call.params.groupId === 'platform')).toBe(true);
    expect(taskCalls.every(call => call.params.teamIds === 'team-platform')).toBe(true);
    await expect(page.getByText('PLAT-1', { exact: true })).toBeVisible();
});

test('first-run invalid snapshot and auth failure keep mandatory selection gated', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, { omitPreferenceSnapshot: true });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('dialog', { name: 'Choose your group' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await expect(page.locator('.group-modal-warning')).toBeVisible();
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);

    await page.unrouteAll({ behavior: 'wait' });
});

test('first-run auth recovery exposes only a safe sign-in URL', async ({ page }) => {
    const safeCalls = await mockFirstRunDashboard(page, {
        preferenceError: {
            status: 401,
            body: { error: 'auth_required', message: 'Sign in required.', loginUrl: '/login?reason=session_expired' },
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    await expect(page.getByRole('radio', { name: /Platform/ })).toBeChecked();
    expect(safeCalls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);

    const unsafePage = await page.context().newPage();
    await mockFirstRunDashboard(unsafePage, {
        preferenceError: {
            status: 401,
            body: { error: 'auth_required', message: 'Sign in required.', loginUrl: 'https://evil.example/login' },
        },
    });
    await unsafePage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await unsafePage.getByRole('radio', { name: /Platform/ }).check();
    await unsafePage.getByRole('button', { name: 'Continue' }).click();
    await expect(unsafePage.getByRole('link', { name: 'Sign in again' })).toHaveCount(0);
    await unsafePage.close();
});

test('personal favorite star is separate from shared default and temporary group scope', async ({ page }) => {
    const groupsConfig = {
        version: 1,
        groups: [
            { id: 'default', name: 'Default', teamIds: ['team-default'] },
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
            { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
            { id: 'empty', name: 'Empty', teamIds: [] },
        ],
        defaultGroupId: 'default',
        configRevision: 5,
        source: 'workspace_db',
    };
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig,
        preferenceSnapshotConfig: { ...groupsConfig, configRevision: 6 },
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform', 'growth', 'empty'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform', 'growth', 'empty'],
        }),
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.locator('.group-modal');
    await dialog.locator('.group-list-item', { hasText: 'Platform' }).click();
    await expect(dialog.getByRole('button', { name: 'Platform is my favorite group' })).toHaveClass(/active/);
    await expect(dialog.getByTitle('Default group')).toHaveCount(0);

    await dialog.locator('.group-list-item', { hasText: 'Empty' }).click();
    await expect(dialog.getByRole('button', { name: 'Configure teams before setting as favorite' })).toBeDisabled();

    await dialog.locator('.group-list-item', { hasText: 'Growth' }).click();
    const growthStar = dialog.getByRole('button', { name: 'Set Growth as my favorite group' });
    await expect(growthStar).toHaveCSS('width', '26px');
    await expect(growthStar).toHaveCSS('height', '26px');
    await growthStar.click();
    await expect(dialog.getByRole('button', { name: 'Growth is my favorite group' })).toHaveClass(/active/);
    await expect(dialog.getByRole('checkbox', { name: 'Show in my controls' })).toBeDisabled();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${screenshotDir}/personal-favorite-settings.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${screenshotDir}/personal-favorite-settings-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    const preferencePosts = calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences');
    expect(preferencePosts).toHaveLength(1);
    expect(preferencePosts[0].body).toEqual({
        visibleGroupIds: ['platform', 'growth', 'empty'],
        activeGroupId: 'growth',
    });
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);

    const groupControl = page.getByRole('button', { name: /Select group/ }).first();
    await groupControl.click();
    await expect(page.locator('.group-dropdown-option', { hasText: 'Growth' }).locator('[title="My favorite group"]')).toBeVisible();
    await page.locator('.group-dropdown-option', { hasText: 'Platform' }).click();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);

    await page.getByRole('button', { name: 'Manage team groups' }).click();
    await dialog.locator('.group-list-item', { hasText: 'Growth' }).click();
    await expect(dialog.getByRole('button', { name: 'Growth is my favorite group' })).toHaveClass(/active/);
});

test('personal favorite save preserves its draft and exposes only safe auth recovery', async ({ page }) => {
    const groupsConfig = {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
            { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
        ],
        defaultGroupId: 'platform',
        configRevision: 5,
        source: 'workspace_db',
    };
    await mockFirstRunDashboard(page, {
        groupsConfig,
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform', 'growth'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform', 'growth'],
        }),
        preferenceError: {
            status: 401,
            body: { error: 'auth_required', message: 'Sign in required.', loginUrl: '/login?reason=session_expired' },
        },
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.locator('.group-modal');
    await dialog.locator('.group-list-item', { hasText: 'Growth' }).click();
    await dialog.getByRole('button', { name: 'Set Growth as my favorite group' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Growth is my favorite group' })).toHaveClass(/active/);
    await expect(dialog.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
});

test('partial shared save failure retries only the personal favorite', async ({ page }) => {
    const groupsConfig = {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
            { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
        ],
        defaultGroupId: 'platform',
        configRevision: 5,
        source: 'workspace_db',
    };
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig,
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform', 'growth'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform', 'growth'],
        }),
        preferenceError: {
            status: 500,
            body: { error: 'preference_save_failed', message: 'Synthetic preference failure.' },
        },
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.locator('.group-modal');
    await dialog.locator('.group-list-item', { hasText: 'Growth' }).click();
    await dialog.getByPlaceholder('Group name').fill('Growth updated');
    await dialog.getByRole('button', { name: 'Set Growth updated as my favorite group' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Growth updated is my favorite group' })).toHaveClass(/active/);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(2);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
});

test('department group editor keeps save visible when selected group content overflows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const groupsConfig = overflowGroupConfig();
    await mockFirstRunDashboard(page, {
        groupsConfig,
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['bidswitch'],
            activeGroupId: 'bidswitch',
            effectiveVisibleGroupIds: ['bidswitch'],
        }),
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();

    const dialog = page.locator('.group-modal');
    await expect(dialog.locator('.group-modal-tab.active', { hasText: 'Departments' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Team groups' })).toHaveAttribute('aria-selected', 'true');

    const saveButton = dialog.getByRole('button', { name: 'Save' });
    await dialog.getByPlaceholder('Group name').fill('Bidswitch updated');
    await expect(dialog.getByText(/Unsaved changes/)).toBeVisible();
    await expect(saveButton).toBeEnabled();

    const paneScrollable = await dialog.locator('.group-pane-right').evaluate((node) => (
        node.scrollHeight > node.clientHeight + 8
    ));
    expect(paneScrollable).toBe(true);

    const saveBox = await saveButton.boundingBox();
    const modalBox = await dialog.boundingBox();
    expect(saveBox).not.toBeNull();
    expect(modalBox).not.toBeNull();
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(modalBox.y + modalBox.height - 6);
    expect(saveBox.y).toBeGreaterThanOrEqual(modalBox.y);

    await page.screenshot({ path: `${screenshotDir}/settings-save-footer-visible.png`, fullPage: true });
});

function adHocGroupConfig() {
    return {
        version: 1,
        groups: [{
            id: 'platform',
            name: 'Platform',
            teamIds: ['team-platform'],
            excludedCapacityEpics: ['PROD-EXCLUDED'],
            adHocCapacityEpics: [],
        }],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
    };
}

function adHocGroupPreferences() {
    return defaultGroupPreferences({
        customized: true,
        preferenceExists: true,
        onboardingRequired: false,
        visibleGroupIds: ['platform'],
        activeGroupId: 'platform',
        effectiveVisibleGroupIds: ['platform'],
    });
}

test('department group editor saves an added Ad Hoc capacity epic while preserving excluded capacity epics', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: adHocGroupConfig(),
        preferences: adHocGroupPreferences(),
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();

    const dialog = page.locator('.group-modal');
    await expect(dialog.getByRole('tab', { name: 'Team groups' })).toHaveAttribute('aria-selected', 'true');

    const adHocSelector = dialog.locator('.component-selector', {
        has: page.getByText('Epics for Ad Hoc capacity', { exact: true }),
    });
    await adHocSelector.locator('.component-search-input').fill('adhoc');
    const adHocResult = adHocSelector.locator('.component-search-result-item', { hasText: 'PROD-ADHOC' });
    await expect(adHocResult).toBeVisible();
    await adHocResult.click();

    await expect(adHocSelector.locator('.component-name', { hasText: 'PROD-ADHOC' })).toBeVisible();

    const saveButton = dialog.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled();
    await page.screenshot({ path: `${screenshotDir}/ad-hoc-epic-added.png`, fullPage: true });
    await saveButton.click();

    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length)
        .toBeGreaterThanOrEqual(1);
    const saveCall = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(saveCall).toBeTruthy();
    const savedGroup = (saveCall.body.groups || []).find(group => group.id === 'platform');
    expect(savedGroup).toBeTruthy();
    expect(savedGroup.adHocCapacityEpics).toContain('PROD-ADHOC');
    expect(savedGroup.excludedCapacityEpics).toContain('PROD-EXCLUDED');
});

test('department group editor blocks save when an epic is both excluded and Ad Hoc capacity', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: adHocGroupConfig(),
        preferences: adHocGroupPreferences(),
        epicSearchResults: [{ key: 'PROD-EXCLUDED', summary: 'Synthetic excluded' }],
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();

    const dialog = page.locator('.group-modal');
    await expect(dialog.getByRole('tab', { name: 'Team groups' })).toHaveAttribute('aria-selected', 'true');

    const adHocSelector = dialog.locator('.component-selector', {
        has: page.getByText('Epics for Ad Hoc capacity', { exact: true }),
    });
    await adHocSelector.locator('.component-search-input').fill('prod-excluded');
    const adHocResult = adHocSelector.locator('.component-search-result-item', { hasText: 'PROD-EXCLUDED' });
    await expect(adHocResult).toBeVisible();
    await adHocResult.click();

    await expect(adHocSelector.locator('.component-name', { hasText: 'PROD-EXCLUDED' })).toBeVisible();

    const validation = dialog.locator('.group-modal-validation');
    await expect(validation).toContainText('cannot be both excluded capacity and Ad Hoc');

    const saveButton = dialog.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeDisabled();
    await page.screenshot({ path: `${screenshotDir}/ad-hoc-excluded-overlap-blocked.png`, fullPage: true });

    await saveButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
});
