const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/shared-department-groups-qa';
const dashboardSourceBundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;

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

function expectOnlyFirstRunPreferenceRequest(calls, baseline) {
    const requestDelta = calls.slice(baseline);
    expect(requestDelta.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(1);
    expect(
        requestDelta.filter(call => !['/api/groups-preferences', '/api/auth/csrf'].includes(call.pathname)),
        `Unexpected requests before first-run preferences were verified: ${requestDelta.map(call => call.pathname).join(', ')}`
    ).toEqual([]);
}

async function expectContainedInViewport(locator) {
    await expect(locator).toBeVisible();
    const geometry = await locator.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            viewportWidth: document.documentElement.clientWidth,
            viewportHeight: window.innerHeight,
            clipped: node.scrollWidth > node.clientWidth + 1,
        };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.clipped).toBe(false);
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
        onboardingDone: true,
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
    let onboardingComplete = !preferences.onboardingRequired;
    let sprintFailureCount = 0;
    let sprintRequestCount = 0;
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardSourceBundle,
    }));
    const savedSprintId = Object.prototype.hasOwnProperty.call(options, 'savedSprintId')
        ? options.savedSprintId
        : 42;
    await page.addInitScript(({ selectedSprint }) => {
        const preferences = { selectedView: 'eng' };
        if (selectedSprint !== null) preferences.selectedSprint = selectedSprint;
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(preferences));
    }, { selectedSprint: savedSprintId });
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
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'test-csrf' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/config') {
            return json({
                authMode: options.authMode || 'atlassian_oauth',
                jiraUrl: 'https://jira.example',
                projectsConfigured: true,
                settingsAdminOnly: options.settingsAdminOnly ?? false,
                userCanEditSettings: options.userCanEditSettings ?? true,
                userCanEditEpmConfig: options.userCanEditEpmConfig ?? false,
            });
        }
        if (url.pathname === '/api/groups-config') {
            if (request.method() === 'POST') {
                if (options.groupsConfigConflict) {
                    return json({
                        error: 'group_config_conflict',
                        message: 'Team groups were changed by another user.',
                        current: options.groupsConfigConflict,
                    }, 409);
                }
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
            onboardingComplete = true;
            const savedPreferences = {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                onboardingDone: preferences.onboardingDone !== false,
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
        if (url.pathname === '/api/me/onboarding') {
            const body = requestBody(request) || {};
            return json({ onboardingDone: body.onboardingDone });
        }
        if (url.pathname === '/api/teams') {
            return json({ teams: options.teams || [{ id: 'team-new', name: 'New Team' }] });
        }
        if (url.pathname === '/api/sprints') {
            const plannedResponse = (options.sprintResponsePlan || [])[sprintRequestCount];
            sprintRequestCount += 1;
            if (plannedResponse) {
                if (plannedResponse.delayMs) {
                    await new Promise(resolve => setTimeout(resolve, plannedResponse.delayMs));
                }
                return json(
                    plannedResponse.body || (plannedResponse.status === 200
                        ? { sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] }
                        : { error: 'sprints_unavailable' }),
                    plannedResponse.status
                );
            }
            if (options.rejectSprintBeforeOnboarding && !onboardingComplete) {
                return json({
                    error: 'sprint_load_blocked',
                    message: 'Sprint discovery started before department onboarding completed.',
                }, 502);
            }
            if (onboardingComplete && sprintFailureCount < (options.sprintFailuresAfterOnboarding || 0)) {
                sprintFailureCount += 1;
                return json({ error: 'sprints_unavailable' }, 502);
            }
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
        if (url.pathname === '/api/board-config/statuses') return json({ statuses: [{ name: 'Ready' }] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/capacity/config') return json({});
        if (url.pathname.endsWith('-field/config')) return json({});
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });
    return calls;
}

async function openFirstRunCreateDepartment(page) {
    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await picker.getByRole('button', { name: 'Add Department' }).click();
    const choice = page.getByRole('dialog', { name: 'Add a Department' });
    await choice.getByRole('radio', { name: 'Create clean Department' }).check();
    await choice.getByRole('button', { name: 'Continue to Team Groups' }).click();
}

async function openFirstRunDuplicateDepartment(page, sourceGroupId) {
    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await picker.getByRole('button', { name: 'Add Department' }).click();
    const choice = page.getByRole('dialog', { name: 'Add a Department' });
    await choice.getByRole('radio', { name: 'Duplicate existing Department' }).check();
    await choice.getByRole('combobox', { name: 'Department to duplicate' }).selectOption(sourceGroupId);
    await choice.getByRole('button', { name: 'Continue to Team Groups' }).click();
}

test('normal users can edit shared Departments without admin or EPM permission', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        settingsAdminOnly: true,
        userCanEditSettings: false,
        userCanEditEpmConfig: false,
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        }),
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.locator('.group-modal');
    await expect(dialog.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'EPM', exact: true })).toHaveCount(0);
    await dialog.getByPlaceholder('Group name').fill('Platform Core');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    const save = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(save.body.groups[0].name).toBe('Platform Core');
    expect(calls.some(call => call.method === 'POST' && [
        '/api/projects/selected',
        '/api/board-config',
        '/api/epm/config',
    ].includes(call.pathname))).toBe(false);
});

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

test('first-run search threshold keeps Add Department available for small and empty catalogs', async ({ page }) => {
    for (const count of [0, 1, 2, 3]) {
        await page.unrouteAll({ behavior: 'wait' });
        const groups = Array.from({ length: count }, (_, index) => ({
            id: `department-${index + 1}`,
            name: `Department ${index + 1}`,
            teamIds: [`team-${index + 1}`],
        }));
        await mockFirstRunDashboard(page, {
            groupsConfig: {
                version: 1,
                groups,
                defaultGroupId: groups[0]?.id || '',
                configRevision: 2,
                source: 'workspace_db',
            },
        });
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

        const dialog = page.getByRole('dialog', { name: 'Choose your Department' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('searchbox', { name: 'Search Departments' })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Add Department' })).toBeVisible();
        if (count > 0) {
            await expect(dialog.getByText(`All available Departments are shown · ${count}`)).toBeVisible();
        } else {
            await dialog.getByRole('button', { name: 'Add Department' }).click();
            const choice = page.getByRole('dialog', { name: 'Add a Department' });
            await expect(choice.getByRole('radio', { name: 'Duplicate existing Department' })).toBeDisabled();
            await page.keyboard.press('Escape');
        }
    }
});

test('first-run search appears at four Departments and preserves Add Department with no matches', async ({ page }) => {
    await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: Array.from({ length: 4 }, (_, index) => ({
                id: `department-${index + 1}`,
                name: `Department ${index + 1}`,
                teamIds: [`team-${index + 1}`],
            })),
            defaultGroupId: 'department-1',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Choose your Department' });
    const search = dialog.getByRole('searchbox', { name: 'Search Departments' });
    await expect(search).toBeVisible();
    await search.fill('no match');
    await expect(dialog.getByText('No Departments match this search.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add Department' })).toBeVisible();
    await search.fill('Department 2');
    await expect(dialog.getByRole('radio', { name: /Department 2/ })).toBeVisible();
});

test('Add Department stages create clean and duplicate existing choices without requests', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: [
                { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
                { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
                { id: 'mobile', name: 'Mobile', teamIds: ['team-mobile'] },
                { id: 'data', name: 'Data', teamIds: ['team-data'] },
            ],
            defaultGroupId: 'platform',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    const pickerShell = page.locator('.department-first-run-backdrop').first();
    const query = picker.getByRole('searchbox', { name: 'Search Departments' });
    await query.fill('plat');
    await picker.getByRole('radio', { name: /Platform/ }).check();
    const add = picker.getByRole('button', { name: 'Add Department' });
    await add.focus();
    await add.click();

    const choice = page.getByRole('dialog', { name: 'Add a Department' });
    await expect(choice).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(pickerShell).toHaveAttribute('aria-hidden', 'true');
    await expect(pickerShell).toHaveAttribute('inert', '');
    const createChoice = choice.getByRole('radio', { name: 'Create clean Department' });
    await expect(createChoice).toBeChecked();
    await expect(createChoice).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(choice.getByRole('button', { name: 'Continue to Team Groups' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(createChoice).toBeFocused();
    await expect(choice.getByRole('radio', { name: 'Duplicate existing Department' })).toBeEnabled();
    await expect(choice.getByRole('combobox', { name: 'Department to duplicate' })).toHaveCount(0);
    await choice.getByRole('radio', { name: 'Duplicate existing Department' }).check();
    await expect(choice.getByRole('combobox', { name: 'Department to duplicate' })).toBeVisible();
    await expect(choice.getByRole('checkbox', { name: 'Remove existing teams' })).not.toBeChecked();
    await expect(choice.getByRole('checkbox', { name: 'Remove existing components' })).not.toBeChecked();
    await expect(choice.getByRole('button', { name: 'Continue to Team Groups' })).toBeEnabled();
    await choice.getByRole('button', { name: 'Continue to Team Groups' }).click();
    await expect(choice.getByRole('alert')).toHaveText('Choose a Department to duplicate.');
    await expect(choice.getByRole('alert')).toBeFocused();
    await choice.getByRole('combobox', { name: 'Department to duplicate' }).selectOption('platform');
    await choice.getByRole('checkbox', { name: 'Remove existing teams' }).check();
    await choice.getByRole('button', { name: 'Back' }).click();
    await expect(choice).toHaveCount(0);
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('aria-modal', 'true');
    await expect(picker).not.toHaveAttribute('aria-hidden', 'true');
    await expect(picker).not.toHaveAttribute('inert', '');
    await expect(query).toHaveValue('plat');
    await expect(picker.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await expect(add).toBeFocused();
    await add.click();
    await expect(choice.getByRole('radio', { name: 'Create clean Department' })).toBeChecked();
    await expect(choice.getByRole('combobox', { name: 'Department to duplicate' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(choice).toHaveCount(0);
    await expect(query).toHaveValue('plat');
    await expect(picker.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await expect(add).toBeFocused();

    expect(calls.filter(call => call.method === 'POST' && ['/api/groups-config', '/api/groups-preferences', '/api/me/onboarding'].includes(call.pathname))).toHaveLength(0);
});

test('create clean Department ignores the empty-search query when staging its draft', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: Array.from({ length: 4 }, (_, index) => ({
                id: `department-${index + 1}`,
                name: `Department ${index + 1}`,
                teamIds: [`team-${index + 1}`],
            })),
            defaultGroupId: 'department-1',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await picker.getByRole('searchbox', { name: 'Search Departments' }).fill('Secret raw query');
    await picker.getByRole('button', { name: 'Add Department' }).click();
    const choice = page.getByRole('dialog', { name: 'Add a Department' });
    await choice.getByRole('button', { name: 'Continue to Team Groups' }).click();

    const nameInput = page.locator('.group-modal').getByPlaceholder('Group name');
    await expect(nameInput).toHaveValue('New Department');
    await expect(nameInput).toBeFocused();
    expect(calls.filter(call => call.method === 'POST' && ['/api/groups-config', '/api/groups-preferences', '/api/me/onboarding'].includes(call.pathname))).toHaveLength(0);
});

test('duplicate existing Department submits one cleaned copy and preserves its source', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: [{
                id: 'source',
                name: 'Source',
                teamIds: ['team-source'],
                teamLabels: { 'team-source': 'Source Team' },
                missingInfoComponents: ['Backend'],
                excludedCapacityEpics: ['SYN-1'],
            }],
            defaultGroupId: 'source',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await picker.getByRole('button', { name: 'Add Department' }).click();
    const choice = page.getByRole('dialog', { name: 'Add a Department' });
    await choice.getByRole('radio', { name: 'Duplicate existing Department' }).check();
    await choice.getByRole('combobox', { name: 'Department to duplicate' }).selectOption('source');
    await choice.getByRole('checkbox', { name: 'Remove existing teams' }).check();
    await choice.getByRole('checkbox', { name: 'Remove existing components' }).check();
    await choice.getByRole('button', { name: 'Continue to Team Groups' }).click();

    const settings = page.locator('.group-modal');
    await expect(settings.getByPlaceholder('Group name')).toHaveValue('Source Copy');
    await expect(settings.getByPlaceholder('Group name')).toBeFocused();
    await expect(settings.locator('.group-list-item')).toHaveCount(2);
    await expect(settings.locator('.group-list-item', { hasText: 'Source Copy' })).toHaveCount(1);
    await expect(settings.getByText('No teams selected. Search and add teams below.')).toBeVisible();
    await expect(settings.getByText('Backend', { exact: true })).toHaveCount(0);
    await settings.locator('.group-list-item', { hasText: 'Source', hasNotText: 'Source Copy' }).click();
    await expect(settings.getByPlaceholder('Group name')).toHaveValue('Source');
    await expect(settings.locator('.selected-team-chip')).toContainText('team-source');
    await expect(settings.getByText('Backend', { exact: true })).toBeVisible();
    expect(calls.filter(call => call.method === 'POST' && ['/api/groups-config', '/api/groups-preferences', '/api/me/onboarding'].includes(call.pathname))).toHaveLength(0);
});

test('Configure and use opens the exact ineligible Department without saving', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: [
                { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
                { id: 'empty', name: 'Empty', teamIds: [] },
            ],
            defaultGroupId: 'platform',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(picker.getByRole('radio', { name: /Empty/ })).toBeDisabled();
    await picker.getByRole('button', { name: 'Configure and use Empty' }).click();
    const settings = page.locator('.group-modal');
    await expect(settings).toBeVisible();
    await expect(settings.getByPlaceholder('Group name')).toHaveValue('Empty');
    await expect(settings.getByPlaceholder('Group name')).toBeFocused();
    expect(calls.filter(call => call.method === 'POST' && ['/api/groups-config', '/api/groups-preferences', '/api/me/onboarding'].includes(call.pathname))).toHaveLength(0);
});

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
                { id: 'mobile', name: 'Mobile', teamIds: ['team-mobile'] },
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
                { id: 'mobile', name: 'Mobile', teamIds: ['team-mobile'] },
            ],
            defaultGroupId: 'platform',
            configRevision: 3,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[type="radio"]:focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Search Departments')).toBeVisible();
    await expect(page.locator('.department-first-run-option-name')).toHaveText(['Empty', 'Growth', 'Mobile', 'Platform']);
    await expect(dialog.getByRole('radio')).toHaveCount(4);
    await expect(dialog.getByRole('radio', { name: /Platform/ })).not.toBeChecked();
    await expect(dialog).toContainText('Next: dashboard');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /Empty/ })).toBeDisabled();
    await expect(page.getByText('Add at least one team before choosing this Department')).toBeVisible();
    await dialog.getByRole('radio', { name: /Platform/ }).check();
    await expect(dialog.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await page.getByLabel('Search Departments').fill('growth');
    await expect(dialog.getByRole('radio', { name: /Growth/ })).toBeVisible();
    await expect(dialog.getByText('Selected: Platform')).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear selection' }).click();
    await expect(dialog.getByText('Selected: Platform')).toHaveCount(0);
    await page.getByLabel('Search Departments').fill('');
    await dialog.getByRole('radio', { name: /Platform/ }).check();
    await dialog.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('searchbox', { name: 'Search Departments' })).toBeFocused();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${screenshotDir}/first-run-selection.png`, fullPage: true });
    await page.waitForTimeout(250);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);

    const requestBaseline = calls.length;
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: 'Saving...' }).click({ force: true }).catch(() => {});
    await expect.poll(() => calls.filter(call => call.pathname === '/api/groups-preferences').length).toBe(1);
    await page.waitForTimeout(200);
    expectOnlyFirstRunPreferenceRequest(calls, requestBaseline);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    expect(calls.filter(call => ['/api/tasks-with-team-name', '/api/sprints', '/api/missing-info'].includes(call.pathname))).toHaveLength(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    preferenceGate.resolve();

    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length).toBeGreaterThanOrEqual(2);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    const preferenceSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-preferences');
    expect(preferenceSave).toBeTruthy();
    expect(preferenceSave.body.visibleGroupIds).toEqual(['platform']);
    const taskCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name');
    expect(taskCalls.every(call => call.params.groupId === 'platform')).toBe(true);
    expect(taskCalls.every(call => call.params.teamIds === 'team-platform')).toBe(true);
    await expect(page.getByText('PLAT-1', { exact: true })).toBeVisible();
});

test('successful first-run selection starts the dashboard tour before any onboarding write', async ({ page }, testInfo) => {
    const preferenceGate = deferred();
    const calls = await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({ onboardingDone: false }),
        preferenceGate,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toContainText('Next: a skippable dashboard tour');
    expect(calls.filter(call => call.pathname === '/api/me/onboarding')).toHaveLength(0);

    await page.getByRole('radio', { name: /Platform/ }).check();
    const requestBaseline = calls.length;
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => calls.filter(call => call.pathname === '/api/groups-preferences').length).toBe(1);
    expectOnlyFirstRunPreferenceRequest(calls, requestBaseline);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    expect(calls.filter(call => ['/api/tasks-with-team-name', '/api/sprints', '/api/missing-info'].includes(call.pathname))).toHaveLength(0);
    expect(calls.filter(call => call.pathname === '/api/me/onboarding')).toHaveLength(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    preferenceGate.resolve();
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toBeVisible();
    expect(calls.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    expect(calls.filter(call => call.pathname === '/api/me/onboarding')).toHaveLength(0);
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath('dashboard-onboarding-desktop.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    const writes = calls.filter(call => call.pathname === '/api/me/onboarding');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({ onboardingDone: true });
});

test('existing users do not auto-start and can replay without changing dashboard scope', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            onboardingDone: true,
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        }),
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    expect(calls.filter(call => call.pathname === '/api/me/onboarding')).toHaveLength(0);

    const sprint = page.locator('[data-onboarding-target="sprint"][data-onboarding-surface="main"]');
    const teams = page.locator('[data-onboarding-target="teams"][data-onboarding-surface="main"]');
    await expect(sprint).toContainText('2026Q2 Sprint 42');
    const scopeBefore = await Promise.all([sprint.innerText(), teams.innerText()]);
    const settingsOpener = page.getByRole('button', { name: 'Manage team groups' });
    await settingsOpener.click();
    await page.getByRole('button', { name: 'Run onboarding again' }).click();

    await expect(page.locator('.group-modal')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toBeVisible();
    await expect.poll(() => calls.filter(call => call.pathname === '/api/me/onboarding').length).toBe(1);
    expect(calls.find(call => call.pathname === '/api/me/onboarding').body).toEqual({ onboardingDone: false });
    expect(await Promise.all([sprint.innerText(), teams.innerText()])).toEqual(scopeBefore);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name').every(call => call.params.groupId === 'platform')).toBe(true);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(0);
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    await expect(settingsOpener).toBeFocused();
    expect(await settingsOpener.evaluate((node) => node.isConnected)).toBe(true);
});

test('replay is disabled while Team groups settings are dirty', async ({ page }) => {
    await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            onboardingDone: true,
            visibleGroupIds: ['platform', 'growth'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform', 'growth'],
        }),
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const settings = page.locator('.group-modal');
    await expect(settings.getByRole('button', { name: 'Run onboarding again' })).toBeEnabled();
    await settings.locator('.group-list-item', { hasText: 'Growth' }).click();
    await settings.getByPlaceholder('Group name').fill('Growth updated');
    await expect(settings.getByRole('button', { name: 'Run onboarding again' })).toBeDisabled();
});

test('mobile first-run tour highlights the compact sprint target within the viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({ onboardingDone: false }),
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    const tour = page.getByRole('dialog', { name: 'Choose a sprint' });
    await expect(tour).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('[data-onboarding-target="sprint"][data-onboarding-surface="compact"]')).toBeVisible();
    await expectContainedInViewport(tour);
    await expectContainedInViewport(page.locator('.onboarding-tour-spotlight'));
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath('dashboard-onboarding-mobile.png'), animations: 'disabled' });
});

test('first-run Add Department reuses Team groups and returns to the mandatory picker', async ({ page }) => {
    await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole('tab', { name: 'Team groups' })).toHaveAttribute('aria-selected', 'true');
    await expect(settingsDialog.getByText('Easiest way to get started: duplicate an existing group, then adjust its teams.')).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Duplicate' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: /favorite group/ })).toHaveCount(0);
    await expect(settingsDialog.getByRole('checkbox', { name: 'Show in my controls' })).toHaveCount(0);
    await expect(settingsDialog.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);
    await expect(firstRunDialog).toHaveCount(0);

    await settingsDialog.getByRole('button', { name: 'Cancel' }).click();
    await settingsDialog.getByRole('button', { name: 'Discard' }).click();
    await expect(firstRunDialog).toBeVisible();
    await expect(firstRunDialog.getByRole('radio', { checked: true })).toHaveCount(0);
});

test('first-run Add Department stays usable in the compact layout and returns to the mandatory picker', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    const teamGroupsTab = settingsDialog.getByRole('tab', { name: 'Team groups' });
    const guidance = settingsDialog.getByText('Easiest way to get started: duplicate an existing group, then adjust its teams.');
    const duplicateButton = settingsDialog.getByRole('button', { name: 'Duplicate' });
    const groupsButton = settingsDialog.getByRole('button', { name: 'Groups', exact: true });
    const cancelButton = settingsDialog.getByRole('button', { name: 'Cancel' });
    const saveButton = settingsDialog.getByRole('button', { name: 'Save' });

    await expect(settingsDialog).toBeVisible();
    await expect(teamGroupsTab).toHaveAttribute('aria-selected', 'true');
    await expect(guidance).toBeVisible();
    await expect(duplicateButton).toBeVisible();
    await expect(groupsButton).toBeVisible();
    await expect(cancelButton).toBeVisible();
    await expect(saveButton).toBeVisible();

    for (const locator of [
        settingsDialog,
        settingsDialog.locator('.group-modal-content'),
        teamGroupsTab,
        groupsButton,
        guidance,
        duplicateButton,
        cancelButton,
        saveButton,
    ]) {
        await expectContainedInViewport(locator);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(0);

    const groupListDrawer = settingsDialog.locator('.group-pane-left');
    const closedDrawerTransform = await groupListDrawer.evaluate(node => getComputedStyle(node).transform);
    await groupsButton.click();
    const addGroupButton = settingsDialog.getByRole('button', { name: '+ Add group' });
    await expect(groupListDrawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await expectContainedInViewport(addGroupButton);
    await settingsDialog.getByRole('button', { name: 'Back' }).click();

    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);
    await expect(groupListDrawer).toHaveCSS('transform', closedDrawerTransform);
    await page.screenshot({ path: `${screenshotDir}/first-run-configure-compact.png`, fullPage: true });
    await cancelButton.click();
    await settingsDialog.getByRole('button', { name: 'Discard' }).click();

    await expect(firstRunDialog).toBeVisible();
    await expect(firstRunDialog.getByRole('radio', { checked: true })).toHaveCount(0);
    await expectContainedInViewport(firstRunDialog);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(0);
});

test('first-run no-groups configuration recovers from validation, saves a team group, and returns to selection', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: [],
            defaultGroupId: '',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    await expect(settingsDialog.getByText('Easiest way to get started: duplicate an existing group, then adjust its teams.')).toBeVisible();
    await expect(settingsDialog.getByPlaceholder('Group name')).toHaveValue('New Department');
    await expect(settingsDialog.getByRole('button', { name: 'Duplicate' })).toBeVisible();
    await expect(settingsDialog.locator('.group-modal-validation')).toHaveCount(0);

    await settingsDialog.getByRole('button', { name: 'Refresh teams' }).click();
    const teamSearch = settingsDialog.getByPlaceholder('Search teams to add...');
    await expect(teamSearch).toBeVisible();
    await teamSearch.fill('new');
    await settingsDialog.locator('.team-search-result-item', { hasText: 'New Team' }).click();
    await expect(settingsDialog.getByRole('button', { name: /favorite group/ })).toHaveCount(0);
    await expect(settingsDialog.getByRole('checkbox', { name: 'Show in my controls' })).toHaveCount(0);
    await expect(settingsDialog.getByRole('button', { name: 'Save' })).toBeEnabled();
    await settingsDialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
    await expect(settingsDialog).toHaveCount(0);

    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(firstRunDialog).toBeVisible();
    await expect(firstRunDialog.getByRole('radio', { name: /New Department/ })).toBeEnabled();
    await expect(firstRunDialog.getByRole('radio', { checked: true })).toHaveCount(0);
});

test('first-run shared board validation keeps configuration open until corrected and saved', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: [{
                id: 'platform',
                name: 'Platform',
                teamIds: ['team-platform'],
                board: {
                    columns: [{
                        id: 'col-a1b2c3d4',
                        name: 'Ready',
                        colour: '#8c8c8c',
                        star: false,
                        min: null,
                        max: null,
                        statuses: ['Ready'],
                    }],
                },
            }],
            defaultGroupId: 'platform',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');

    const settingsDialog = page.locator('.group-modal');
    await expect(settingsDialog.locator('.group-modal-validation')).toHaveCount(0);
    await settingsDialog.getByRole('tab', { name: 'Boards' }).click();
    await settingsDialog.getByRole('button', { name: 'Delete column Ready' }).click();
    await expect(settingsDialog.locator('.group-modal-validation')).toContainText('Platform Copy: A board needs at least one column.');
    await page.keyboard.press('Control+S');
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);

    await settingsDialog.getByRole('button', { name: '+ Add column' }).click();
    await expect(settingsDialog.locator('.group-modal-validation')).toContainText('Platform Copy: “New column” has no statuses. Add a status or delete the column.');
    await settingsDialog.locator('.board-add-status').click();
    await settingsDialog.locator('.board-pick').getByRole('button', { name: 'Ready not in a column', exact: true }).click();
    await expect(settingsDialog.locator('.group-modal-validation')).toHaveCount(0);
    await expect(settingsDialog.getByRole('button', { name: 'Save' })).toBeEnabled();
    await settingsDialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect(settingsDialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
});

test('first-run configuration keeps unified Save, validation, Cancel, discard, and return behavior', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    await settingsDialog.getByRole('button', { name: 'Duplicate' }).click();
    await expect(settingsDialog.locator('.group-modal-dirty')).toBeVisible();
    await settingsDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(settingsDialog.locator('.group-confirm')).toBeVisible();
    await settingsDialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(settingsDialog).toBeVisible();

    await settingsDialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect(settingsDialog).toHaveCount(0);

    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(firstRunDialog).toBeVisible();
    await expect(firstRunDialog.getByRole('radio', { checked: true })).toHaveCount(0);

    await openFirstRunCreateDepartment(page);
    await settingsDialog.getByRole('button', { name: 'Duplicate' }).click();
    await settingsDialog.getByRole('button', { name: 'Cancel' }).click();
    await settingsDialog.getByRole('button', { name: 'Discard' }).click();
    await expect(firstRunDialog).toBeVisible();
});

test('first-run configuration keeps the editor open across validation and a 409 conflict', async ({ page }) => {
    const groupsConfigConflict = {
        version: 1,
        groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'] }],
        defaultGroupId: 'platform',
        configRevision: 3,
        source: 'workspace_db',
        preferences: defaultGroupPreferences(),
    };
    await mockFirstRunDashboard(page, { groupsConfigConflict });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    await settingsDialog.getByPlaceholder('Group name').fill('Platform updated');
    await settingsDialog.getByRole('button', { name: 'Save' }).click();
    await expect(settingsDialog.locator('.group-modal-validation')).toContainText('Team groups changed while you were editing.');
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveCount(0);

    await settingsDialog.locator('.group-modal-validation').getByRole('button', { name: 'Discard mine' }).click();
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(settingsDialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
});
test('first-run invalid snapshot and auth failure keep mandatory selection gated', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, { omitPreferenceSnapshot: true });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Platform/ })).toBeChecked();
    await expect(page.locator('.group-modal-warning')).toBeVisible();
    await expect(page.locator('.group-modal-warning')).toBeFocused();
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
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    await expect(page.locator('input[type="radio"]:checked')).toHaveCount(1);
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
    await expect(unsafePage.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
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

test('first team selection after hydration survives page reload', async ({ page }) => {
    const groupsConfig = {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
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
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        }),
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    const teamControl = page.locator('.view-selector .team-dropdown').first();
    const teamLabel = teamControl.locator('.team-dropdown-selection-label');
    await expect(teamLabel).toHaveText('All Teams');
    await expect.poll(() => page.evaluate(() => {
        const state = JSON.parse(window.localStorage.getItem('jira_dashboard_team_selection_state_v1') || '{}');
        return state['team-selection::42::platform']?.selectedTeams || [];
    })).toEqual(['all']);

    await teamControl.locator('.team-dropdown-toggle').click();
    await teamControl.getByRole('checkbox', { name: 'Platform', exact: true }).check();
    await page.mouse.click(8, 8);
    await expect(teamLabel).toHaveText('Platform');
    await expect.poll(() => page.evaluate(() => {
        const state = JSON.parse(window.localStorage.getItem('jira_dashboard_team_selection_state_v1') || '{}');
        return state['team-selection::42::platform']?.selectedTeams || [];
    })).toEqual(['team-platform']);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(teamLabel).toHaveText('Platform');
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
    await expect(dialog.locator('button[aria-label="Growth is my favorite group"]')).toHaveClass(/active/);
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
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

test('empty first-run workspace does not load sprints while Configure opens settings', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfig: {
            version: 1,
            groups: [],
            defaultGroupId: '',
            configRevision: 1,
            source: 'workspace_db',
        },
        savedSprintId: null,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    await openFirstRunCreateDepartment(page);

    await expect(page.locator('.group-modal')).toBeVisible();
    await page.waitForTimeout(250);
    expect(calls.filter(call => call.pathname === '/api/sprints')).toHaveLength(0);
});

test('first-run department selection waits to load sprints and then loads the selected group', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        rejectSprintBeforeOnboarding: true,
        savedSprintId: null,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(250);
    expect(calls.filter(call => call.pathname === '/api/sprints')).toHaveLength(0);

    await dialog.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/sprints').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/Failed to load sprints/)).toHaveCount(0);

    const taskCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name');
    expect(taskCalls.every(call => call.params.groupId === 'platform')).toBe(true);
    expect(taskCalls.every(call => call.params.teamIds === 'team-platform')).toBe(true);
});

test('first-run sprint failure retries sprint discovery and clears the actionable error', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        sprintFailuresAfterOnboarding: 1,
        savedSprintId: null,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    const message = 'Failed to load sprints from Jira. Retry, or confirm you can access the configured board.';
    await expect(page.getByText(message)).toBeVisible();
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect.poll(() => calls.filter(call => call.pathname === '/api/sprints').length).toBe(2);
    expect(calls.filter(call => call.pathname === '/api/sprints')[1].params.refresh).toBe('true');
    await expect(page.getByText(message)).toHaveCount(0);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${screenshotDir}/first-run-sprint-retry-recovered.png`, fullPage: true });
});

test('sprint Retry ignores a second click while recovery is already in flight', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        savedSprintId: null,
        sprintResponsePlan: [
            { status: 502 },
            { status: 200, delayMs: 300 },
        ],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Platform/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    const message = 'Failed to load sprints from Jira. Retry, or confirm you can access the configured board.';
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(page.getByText(message)).toBeVisible();

    await retry.dblclick();

    await page.waitForTimeout(100);
    expect(calls.filter(call => call.pathname === '/api/sprints')).toHaveLength(2);
    await page.waitForTimeout(400);
    await expect(page.getByText(message)).toHaveCount(0);
    expect(calls.filter(call => call.pathname === '/api/sprints')[1].params.refresh).toBe('true');
});

test('explicit Jira refresh waits for active sprint discovery and then refreshes it', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        }),
        sprintResponsePlan: [
            { status: 200, delayMs: 3000 },
            { status: 200 },
        ],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => calls.filter(call => call.pathname === '/api/sprints').length).toBe(1);
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
    await expect(refresh).toBeEnabled();
    await refresh.click();

    await expect.poll(() => calls.filter(call => call.pathname === '/api/sprints').length).toBe(2);
    expect(calls.filter(call => call.pathname === '/api/sprints')[1].params.refresh).toBe('true');
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
