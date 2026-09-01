const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/shared-department-groups-qa';
const onboardingScreenshotDir = path.join(__dirname, '..', '..', 'test-results', 'onboarding-tour-qa');
const dashboardSourceBundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;
const dashboardSourceCss = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'dashboard.css')],
    bundle: true,
    write: false,
    outfile: 'dashboard.css',
}).outputFiles.find(output => output.path.endsWith('.css')).text;

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.mkdirSync(onboardingScreenshotDir, { recursive: true });
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

async function expectGuideTargetGeometry(target, guide) {
    await expect(target).toBeVisible();
    const readGeometry = () => target.evaluate((node, guideSelector) => {
        const targetRect = node.getBoundingClientRect();
        const guideRect = document.querySelector(guideSelector)?.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportLeft = viewport?.offsetLeft || 0;
        const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
        const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
        const overlapsGuide = guideRect
            ? !(targetRect.right <= guideRect.left || targetRect.left >= guideRect.right || targetRect.bottom <= guideRect.top || targetRect.top >= guideRect.bottom)
            : false;
        return {
            left: targetRect.left,
            top: targetRect.top,
            right: targetRect.right,
            bottom: targetRect.bottom,
            viewportLeft,
            viewportTop,
            viewportRight,
            viewportBottom,
            width: targetRect.width,
            height: targetRect.height,
            contained: targetRect.left >= viewportLeft && targetRect.top >= viewportTop
                && targetRect.right <= viewportRight && targetRect.bottom <= viewportBottom,
            overlapsGuide,
        };
    }, '.first-run-configuration-guide');
    await expect.poll(readGeometry).toEqual(expect.objectContaining({
        contained: true,
        overlapsGuide: false,
    }));
    const geometry = await readGeometry();
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
}

async function captureSettledOnboardingScreenshot(page, name, { fullPage = false } = {}) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addStyleTag({
        content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshotPath = path.join(onboardingScreenshotDir, name);
    await page.screenshot({ path: screenshotPath, animations: 'disabled', fullPage });
    expect(fs.existsSync(screenshotPath), `${name} was not produced`).toBe(true);
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
    let latestGroupsConfig = structuredClone(groupsConfig);
    let onboardingComplete = !preferences.onboardingRequired;
    let sprintFailureCount = 0;
    let sprintRequestCount = 0;
    let capacityPostCount = 0;
    let epmPostCount = 0;
    let groupsPostCount = 0;
    let preferencePostCount = 0;
    let latestEpmConfig = structuredClone(options.epmConfig || {});
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardSourceBundle,
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: dashboardSourceCss,
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
        if (url.pathname === '/api/analytics/context') return json(options.analyticsEnabled ? {
            enabled: true,
            measurementId: 'G-SYNTHETIC',
            ga4UserId: 'synthetic-user',
            debugMode: false,
        } : { enabled: false });
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
                adminUserManagementAvailable: options.adminUserManagementAvailable ?? false,
                ...(options.sharedConfig ? { sharedConfig: options.sharedConfig, sharedConfigRevision: 4 } : {}),
                ...(options.epmConfig ? { epm: options.epmConfig } : {}),
            });
        }
        if (url.pathname === '/api/groups-config') {
            if (request.method() === 'POST') {
                const postIndex = groupsPostCount;
                const plannedConflict = options.groupsConfigConflicts
                    ? options.groupsConfigConflicts[postIndex]
                    : options.groupsConfigConflict;
                const plannedError = options.groupsConfigErrors?.[postIndex] || options.groupsConfigError;
                groupsPostCount += 1;
                if (plannedError) {
                    return json(plannedError.body, plannedError.status);
                }
                if (plannedConflict) {
                    return json({
                        error: 'group_config_conflict',
                        message: 'Team groups were changed by another user.',
                        current: plannedConflict,
                    }, 409);
                }
                const body = requestBody(request) || {};
                latestGroupsConfig = {
                    ...latestGroupsConfig,
                    groups: body.groups || groupsConfig.groups,
                    defaultGroupId: body.defaultGroupId || groupsConfig.defaultGroupId,
                    configRevision: Number(body.baseRevision || latestGroupsConfig.configRevision || 0) + 1,
                    preferences,
                };
                if (options.groupsConfigResponseTransform) {
                    latestGroupsConfig = options.groupsConfigResponseTransform(structuredClone(latestGroupsConfig), body);
                }
                return json(latestGroupsConfig);
            }
            return json({
                ...groupsConfig,
                preferences,
            });
        }
        if (url.pathname === '/api/groups-preferences') {
            const body = requestBody(request) || {};
            if (options.preferenceGate) await options.preferenceGate.promise;
            const plannedError = request.method() === 'POST'
                ? (options.preferenceErrors?.[preferencePostCount] || options.preferenceError)
                : null;
            if (request.method() === 'POST') preferencePostCount += 1;
            if (request.method() === 'POST' && preferencePostCount === 2 && options.preferenceRetryGate) {
                await options.preferenceRetryGate.promise;
            }
            if (plannedError) {
                return json(plannedError.body, plannedError.status);
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
            const snapshot = options.preferenceSnapshotConfig || latestGroupsConfig;
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
        if (url.pathname === '/api/epm/config') {
            if (request.method() === 'POST') {
                const plannedError = options.epmErrors?.[epmPostCount] || options.epmError;
                epmPostCount += 1;
                if (plannedError) return json(plannedError.body, plannedError.status);
                latestEpmConfig = requestBody(request);
            }
            return json(latestEpmConfig);
        }
        if (url.pathname === '/api/me/onboarding') {
            const body = requestBody(request) || {};
            return json({ onboardingDone: body.onboardingDone });
        }
        if (url.pathname === '/api/teams') {
            return json({ teams: options.teams || [{ id: 'team-new', name: 'New Team' }] });
        }
        if (url.pathname === '/api/fields') {
            return json({ fields: options.jiraFields || [] });
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
        if (url.pathname === '/api/projects/selected') {
            if (request.method() === 'POST') return json(requestBody(request));
            return json({ selected: options.sharedConfig?.projects?.selected || [] });
        }
        if (url.pathname === '/api/board-config') return json({ boardId: '42', boardName: 'Synthetic Board' });
        if (url.pathname === '/api/board-config/statuses') return json({ statuses: [{ name: 'Ready' }] });
        if (url.pathname === '/api/stats/priority-weights-config') {
            if (request.method() === 'POST' && options.priorityWeightsError) {
                return json(options.priorityWeightsError.body, options.priorityWeightsError.status);
            }
            return json(request.method() === 'POST' ? requestBody(request) : { weights: options.sharedConfig?.priorityWeights || [] });
        }
        if (url.pathname === '/api/capacity/config') {
            if (request.method() === 'POST') {
                const plannedError = options.capacityErrors?.[capacityPostCount] || options.capacityError;
                capacityPostCount += 1;
                if (plannedError) return json(plannedError.body, plannedError.status);
            }
            return json(options.capacityConfig || {});
        }
        if (url.pathname.endsWith('-field/config')) return json({});
        if (url.pathname === '/api/issue-types/config') return json(request.method() === 'POST'
            ? requestBody(request)
            : { issueTypes: options.sharedConfig?.issueTypes || ['Story'] });
        if (url.pathname === '/api/admin/users') return json({ users: options.adminUsers || [] });
        if (url.pathname.endsWith('/admin-grant')) return json({ user: options.adminUsers?.[0] || {} });
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

async function finishFirstRunConfigurationGuide(page) {
    const guide = page.locator('.first-run-configuration-guide');
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue without components', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(guide).toHaveCount(0);
}

async function finishFirstRunConfigurationGuideWithTeamRepair(page) {
    const dialog = page.locator('.group-modal');
    const guide = dialog.locator('.first-run-configuration-guide');
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    if (await guide.getByRole('button', { name: 'Continue', exact: true }).isDisabled()) {
        await dialog.getByRole('button', { name: 'Refresh teams' }).click();
        await dialog.getByPlaceholder('Search teams to add...').fill('new');
        await dialog.locator('.team-search-result-item', { hasText: 'New Team' }).click();
    }
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue without components', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Done', exact: true }).click();
}

test('Task 9 writes settled Department and Settings onboarding screenshots', async ({ page }) => {
    const resetDashboard = async ({ groupsConfig, preferences, viewport = { width: 1440, height: 1000 } } = {}) => {
        await page.unrouteAll({ behavior: 'wait' });
        await page.setViewportSize(viewport);
        await mockFirstRunDashboard(page, { groupsConfig, preferences });
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    };

    const twoGroups = {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
            { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
        ],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
    };
    await resetDashboard({ groupsConfig: twoGroups });
    let picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(picker.getByRole('searchbox', { name: 'Search Departments' })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Add Department' })).toBeVisible();
    await captureSettledOnboardingScreenshot(page, 'first-run-two-groups-desktop.png');

    const fourGroups = {
        ...twoGroups,
        groups: [
            ...twoGroups.groups,
            { id: 'mobile', name: 'Mobile', teamIds: ['team-mobile'] },
            { id: 'data', name: 'Data', teamIds: ['team-data'] },
        ],
    };
    await resetDashboard({ groupsConfig: fourGroups });
    picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(picker.getByRole('searchbox', { name: 'Search Departments' })).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Add Department' })).toBeVisible();
    await captureSettledOnboardingScreenshot(page, 'first-run-four-groups-desktop.png');

    await picker.getByRole('button', { name: 'Add Department' }).click();
    let choice = page.getByRole('dialog', { name: 'Add a Department' });
    await expect(choice.getByRole('radio', { name: 'Create clean Department' })).toBeChecked();
    await captureSettledOnboardingScreenshot(page, 'first-run-add-choice-desktop.png');
    await choice.getByRole('radio', { name: 'Duplicate existing Department' }).check();
    await choice.getByRole('combobox', { name: 'Department to duplicate' }).selectOption('platform');
    await expect(choice.getByRole('checkbox', { name: 'Remove existing teams' })).not.toBeChecked();
    await expect(choice.getByRole('checkbox', { name: 'Remove existing components' })).not.toBeChecked();
    await captureSettledOnboardingScreenshot(page, 'first-run-duplicate-defaults-desktop.png');

    await resetDashboard({ groupsConfig: twoGroups });
    await openFirstRunCreateDepartment(page);
    let settings = page.locator('.group-modal');
    let guide = settings.locator('.first-run-configuration-guide');
    await expect(guide).toContainText('Name your Department');
    await expect(settings.getByPlaceholder('Group name')).toHaveCount(1);
    await captureSettledOnboardingScreenshot(page, 'first-run-guide-name-desktop.png');

    await resetDashboard({ groupsConfig: twoGroups, viewport: { width: 390, height: 844 } });
    await openFirstRunCreateDepartment(page);
    settings = page.locator('.group-modal');
    guide = settings.locator('.first-run-configuration-guide');
    await expect(settings.locator('.group-pane-left')).toHaveClass(/is-mobile-active/);
    await expect(settings.getByPlaceholder('Group name')).toHaveCount(1);
    await expectGuideTargetGeometry(settings.locator('[data-first-run-guide-target="name"]'), guide);
    await captureSettledOnboardingScreenshot(page, 'first-run-guide-name-mobile.png');

    const existingPreferences = defaultGroupPreferences({
        customized: true,
        preferenceExists: true,
        onboardingRequired: false,
        onboardingDone: true,
        visibleGroupIds: ['platform', 'growth', 'mobile', 'data'],
        activeGroupId: 'platform',
        effectiveVisibleGroupIds: ['platform', 'growth', 'mobile', 'data'],
    });
    await resetDashboard({ groupsConfig: fourGroups, preferences: existingPreferences });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    settings = page.locator('.group-modal');
    await settings.locator('.group-list-item', { hasText: 'Growth' }).click();
    await settings.getByRole('button', { name: 'Set Growth as my favorite group' }).click();
    await expect(settings.getByRole('button', { name: 'Growth is my favorite group' })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByRole('checkbox', { name: 'Show in Department selector' })).toBeDisabled();
    await expect(settings.locator('.group-visible-helper')).toHaveText('Your favorite Department is always shown');
    await captureSettledOnboardingScreenshot(page, 'first-run-preferences-desktop.png');

    await settings.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(settings.getByRole('button', { name: 'Run onboarding again' })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Run onboarding again' })).toBeDisabled();
    await captureSettledOnboardingScreenshot(page, 'settings-replay-header-desktop.png');

    await resetDashboard({
        groupsConfig: fourGroups,
        preferences: existingPreferences,
        viewport: { width: 390, height: 844 },
    });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    settings = page.locator('.group-modal');
    await settings.getByRole('button', { name: 'Groups', exact: true }).click();
    await settings.locator('.group-list-item', { hasText: 'Growth' }).locator('.group-list-star').click();
    await expect(settings.locator('.group-modal-dirty')).toContainText('Unsaved changes');
    await expect(settings.getByRole('button', { name: 'Run onboarding again' })).toBeDisabled();
    await expect(settings.getByText('Save or discard changes before replaying onboarding.')).toBeVisible();
    await captureSettledOnboardingScreenshot(page, 'settings-replay-header-mobile.png');
});

for (const mode of ['create', 'duplicate', 'repair']) {
    for (const onboardingDone of [false, true]) {
        test(`first-run ${mode} preserves onboardingDone ${onboardingDone} through the private handoff`, async ({ page }) => {
            const calls = await mockFirstRunDashboard(page, {
                preferences: defaultGroupPreferences({ onboardingDone }),
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
            if (mode === 'create') await openFirstRunCreateDepartment(page);
            if (mode === 'duplicate') await openFirstRunDuplicateDepartment(page, 'platform');
            if (mode === 'repair') {
                await page.getByRole('dialog', { name: 'Choose your Department' })
                    .getByRole('button', { name: 'Configure and use Empty' }).click();
            }
            await finishFirstRunConfigurationGuideWithTeamRepair(page);
            await page.locator('.group-modal').getByRole('button', { name: /Save/ }).click();
            await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);
            const tour = page.getByRole('dialog', { name: 'Choose a sprint' });
            if (onboardingDone) await expect(tour).toHaveCount(0);
            else await expect(tour).toBeVisible();
            expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
            expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);
            expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/me/onboarding')).toHaveLength(0);
        });
    }
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
        if (count === 0) {
            await expect(dialog).toHaveCSS('position', 'fixed');
            await expect(dialog.locator('.department-first-run-modal')).toHaveCSS('display', 'flex');
        }
        await expect(dialog.getByRole('searchbox', { name: 'Search Departments' })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Add Department' })).toBeVisible();
        if (count > 0) {
            await expect(dialog.getByText(`All available Departments are shown · ${count}`)).toBeVisible();
            if (count === 2) {
                const firstOption = dialog.locator('.department-first-run-option', { hasText: 'Department 1' });
                const secondOption = dialog.locator('.department-first-run-option', { hasText: 'Department 2' });
                await expect(firstOption.locator('.department-first-run-option-main.eligible')).toHaveCSS('display', 'grid');
                await expect(firstOption.locator('.department-first-run-option-main.eligible')).toHaveCSS('grid-column-start', '2');
                await firstOption.getByText('Department 1', { exact: true }).click();
                await expect(firstOption.getByRole('radio')).toBeChecked();
                await secondOption.getByText('1 team', { exact: true }).click();
                await expect(secondOption.getByRole('radio')).toBeChecked();
            }
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

test('first-run saving locks every picker mutation and restores controls after failure', async ({ page }) => {
    const preferenceGate = deferred();
    const calls = await mockFirstRunDashboard(page, {
        preferenceGate,
        preferenceError: {
            status: 500,
            body: { error: 'preference_save_failed', message: 'Try choosing your Department again.' },
        },
        groupsConfig: {
            version: 1,
            groups: [
                { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
                { id: 'growth', name: 'Growth Department', teamIds: ['team-growth'] },
                { id: 'empty', name: 'Empty Department', teamIds: [] },
                { id: 'mobile', name: 'Mobile Department', teamIds: ['team-mobile'] },
            ],
            defaultGroupId: 'platform',
            configRevision: 2,
            source: 'workspace_db',
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    const search = picker.getByRole('searchbox', { name: 'Search Departments' });
    await picker.getByRole('radio', { name: /Platform/ }).check();
    await search.fill('Department');
    await expect(picker.getByText('Selected: Platform')).toBeVisible();

    await picker.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => calls.filter(call => call.pathname === '/api/groups-preferences').length).toBe(1);
    await expect(search).toBeDisabled();
    await expect(search).toHaveValue('Department');
    await expect(picker.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
    await expect(picker.getByRole('radio', { name: /Growth Department/ })).toBeDisabled();
    await expect(picker.getByRole('button', { name: 'Configure and use Empty Department' })).toBeDisabled();
    await expect(picker.getByRole('button', { name: 'Add Department' })).toBeDisabled();
    const savingTarget = picker.getByRole('button', { name: 'Saving...' });
    await expect(savingTarget).toHaveAttribute('aria-disabled', 'true');
    await expect(savingTarget).not.toHaveAttribute('disabled', '');
    await expect(savingTarget).toBeFocused();
    const savingTargetBounds = await savingTarget.boundingBox();
    await page.mouse.click(
        savingTargetBounds.x + savingTargetBounds.width / 2,
        savingTargetBounds.y + savingTargetBounds.height / 2
    );
    await expect(savingTarget).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(savingTarget).toBeFocused();
    await page.keyboard.press('Space');
    await expect(savingTarget).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(savingTarget).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(savingTarget).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Add a Department' })).toHaveCount(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(1);
    expect(calls.find(call => call.pathname === '/api/groups-preferences').body).toEqual({
        visibleGroupIds: ['platform'],
        activeGroupId: 'platform',
    });

    preferenceGate.resolve();
    const alert = picker.getByRole('alert');
    await expect(alert).toHaveText('Try choosing your Department again.');
    await expect(alert).toBeFocused();
    await expect(search).toBeEnabled();
    await expect(picker.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
    await expect(picker.getByRole('radio', { name: /Growth Department/ })).toBeEnabled();
    await expect(picker.getByRole('button', { name: 'Configure and use Empty Department' })).toBeEnabled();
    await expect(picker.getByRole('button', { name: 'Add Department' })).toBeEnabled();
    await expect(picker.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await expect(picker.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('dialog', { name: 'Add a Department' })).toHaveCount(0);
    await expect(page.locator('.group-modal')).toHaveCount(0);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences')).toHaveLength(1);
});

test('successful first-run selection starts the desktop dashboard tour before any onboarding write', async ({ page }, testInfo) => {
    const preferenceGate = deferred();
    const calls = await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({ onboardingDone: false }),
        preferenceGate,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' }))
        .toContainText('Next: the dashboard. The optional tour runs on desktop.');
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

test('mobile first-run handoff preserves the Department and never opens or completes dashboard onboarding', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 600 });
    const calls = await mockFirstRunDashboard(page, {
        preferences: defaultGroupPreferences({ onboardingDone: false }),
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    const chooser = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(chooser).toBeVisible();
    await expect(chooser).toContainText('Next: the dashboard. The optional tour runs on desktop.');
    await expect(chooser.getByRole('radio', { name: /Platform/ })).toBeEnabled();
    await chooser.getByRole('radio', { name: /Platform/ }).check();
    await chooser.getByRole('button', { name: 'Continue' }).click();

    await expect(chooser).toHaveCount(0);
    await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await expect(page.locator('[data-onboarding-target="sprint"][data-onboarding-surface="main"]')).toContainText('2026Q2 Sprint 42');
    await expect(page.locator('[data-onboarding-target="teams"][data-onboarding-surface="main"]')).toBeVisible();
    await expect.poll(() => calls.filter(call => call.pathname === '/api/groups-preferences').length).toBe(1);
    expect(calls.find(call => call.pathname === '/api/groups-preferences').body).toEqual({
        visibleGroupIds: ['platform'],
        activeGroupId: 'platform',
    });
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    const taskCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name');
    expect(taskCalls.length).toBeGreaterThan(0);
    expect(taskCalls.every(call => call.params.groupId === 'platform')).toBe(true);
    expect(calls.filter(call => call.pathname === '/api/me/onboarding')).toHaveLength(0);
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath('dashboard-onboarding-mobile-absent.png'), animations: 'disabled' });
});

test('first-run Add Department opens the anchored configuration guide and Cancel restores the picker', async ({ page }) => {
    await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    await expect(settingsDialog).toBeVisible();
    const guide = settingsDialog.locator('.first-run-configuration-guide');
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('Name your Department');
    await expect(settingsDialog.getByPlaceholder('Group name')).toBeFocused();
    await expect(settingsDialog.locator('[role="tab"][inert]')).toHaveCount(3);
    await expect(settingsDialog.getByText('Easiest way to get started: duplicate an existing group, then adjust its teams.')).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: /favorite group/ })).toHaveCount(0);
    await expect(settingsDialog.getByRole('checkbox', { name: 'Show in Department selector' })).toHaveCount(0);
    await expect(settingsDialog.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);
    await expect(firstRunDialog).toHaveCount(0);
    const canonicalNameInput = settingsDialog.getByPlaceholder('Group name');
    await canonicalNameInput.fill('Temporary rename');
    await canonicalNameInput.press('Escape');
    await expect(canonicalNameInput).toHaveValue('New Department');
    await settingsDialog.locator('.group-list-item', { hasText: 'Growth' }).click({ position: { x: 4, y: 4 } });
    await expect(canonicalNameInput).toHaveValue('New Department');

    const backgroundButton = page.locator('button[aria-label="Manage team groups"]');
    const footerCancel = settingsDialog.locator('[data-first-run-settings-cancel]');
    await expect(backgroundButton).toHaveAttribute('tabindex', '-1');
    await footerCancel.focus();
    await expect(footerCancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.first-run-configuration-guide')))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(footerCancel).toBeFocused();
    await page.evaluate(() => {
        const portalButton = document.createElement('button');
        portalButton.id = 'synthetic-unowned-portal-button';
        portalButton.textContent = 'Outside portal action';
        document.body.appendChild(portalButton);
    });
    const portalButton = page.locator('#synthetic-unowned-portal-button');
    await expect(portalButton).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.group-modal-backdrop')))).toBe(true);

    await footerCancel.click();
    await expect(firstRunDialog).toBeVisible();
    await expect(firstRunDialog.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(backgroundButton).not.toHaveAttribute('tabindex', '-1');
    await expect(portalButton).not.toHaveAttribute('tabindex', '-1');
});

test('first-run configuration guide target loss restores focus state and offers Return', async ({ page }) => {
    await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);
    const guide = page.locator('.first-run-configuration-guide');
    await page.evaluate(() => {
        const portalButton = document.createElement('button');
        portalButton.id = 'target-loss-unowned-portal';
        portalButton.textContent = 'Dynamic portal';
        portalButton.setAttribute('tabindex', '7');
        portalButton.setAttribute('aria-hidden', 'false');
        document.body.appendChild(portalButton);
    });
    const portalButton = page.locator('#target-loss-unowned-portal');
    await expect(portalButton).toHaveAttribute('tabindex', '-1');
    await expect(portalButton).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => portalButton.evaluate(node => node.inert)).toBe(true);
    await page.evaluate(() => document.querySelector('[data-first-run-guide-target="name"]')?.remove());
    await expect(guide).toContainText('no longer available');
    await expect(guide.getByRole('button', { name: 'Return' })).toBeVisible();
    await guide.getByRole('button', { name: 'Return' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    await expect(portalButton).toHaveAttribute('tabindex', '7');
    await expect(portalButton).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => portalButton.evaluate(node => node.inert)).toBe(false);
    await page.evaluate(() => document.querySelector('#target-loss-unowned-portal')?.remove());
});

test('first-run Add Department keeps the guide and canonical name keyboard-safe in compact layout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    const guide = settingsDialog.locator('.first-run-configuration-guide');
    const nameInput = settingsDialog.getByPlaceholder('Group name');
    const cancelButton = guide.getByRole('button', { name: 'Cancel' });

    await expect(settingsDialog).toBeVisible();
    await expect(guide).toBeVisible();
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeFocused();
    await expect(cancelButton).toBeVisible();

    for (const locator of [
        settingsDialog,
        settingsDialog.locator('.group-modal-content'),
        guide,
        nameInput,
        cancelButton,
    ]) {
        await expectContainedInViewport(locator);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(0);

    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(settingsDialog.locator('.group-pane-left')).not.toHaveClass(/is-mobile-active/);
    await expectContainedInViewport(settingsDialog.locator('[data-first-run-guide-target="teams"]'));
    await guide.getByRole('button', { name: 'Back' }).click();
    await expect(settingsDialog.locator('.group-pane-left')).toHaveClass(/is-mobile-active/);
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toBeInViewport({ ratio: 1 });

    await page.setViewportSize({ width: 390, height: 520 });
    await expectGuideTargetGeometry(settingsDialog.locator('[data-first-run-guide-target="name"]'), guide);
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await expectGuideTargetGeometry(settingsDialog.locator('[data-first-run-guide-target="teams"]'), guide);
    await settingsDialog.getByRole('button', { name: 'Refresh teams' }).focus();
    await page.keyboard.press('Enter');
    await settingsDialog.getByPlaceholder('Search teams to add...').fill('new');
    await settingsDialog.locator('.team-search-result-item', { hasText: 'New Team' }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await expectGuideTargetGeometry(settingsDialog.locator('[data-first-run-guide-target="components"]'), guide);
    await guide.getByRole('button', { name: 'Continue without components', exact: true }).click();
    await expectGuideTargetGeometry(settingsDialog.locator('[data-first-run-guide-target="favorite"]'), guide);
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await expectGuideTargetGeometry(settingsDialog.locator('[data-first-run-guide-target="visibility"]'), guide);
    await expect(settingsDialog.getByPlaceholder('Group name')).toHaveCount(1);
    await guide.getByRole('button', { name: 'Done', exact: true }).click();

    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);
    await page.screenshot({ path: `${screenshotDir}/first-run-configure-compact.png`, fullPage: true });
    await settingsDialog.locator('[data-first-run-settings-cancel]').click();

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
    await expect(settingsDialog.locator('.group-modal-validation')).toHaveCount(0);

    const guide = settingsDialog.locator('.first-run-configuration-guide');
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await settingsDialog.getByRole('button', { name: 'Refresh teams' }).click();
    const teamSearch = settingsDialog.getByPlaceholder('Search teams to add...');
    await expect(teamSearch).toBeVisible();
    await teamSearch.fill('new');
    await settingsDialog.locator('.team-search-result-item', { hasText: 'New Team' }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue without components', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(settingsDialog.getByRole('button', { name: /favorite group/ })).toHaveCount(0);
    await expect(settingsDialog.getByRole('checkbox', { name: 'Show in Department selector' })).toHaveCount(0);
    await expect(settingsDialog.getByRole('button', { name: 'Save' })).toBeEnabled();
    const saveButton = settingsDialog.getByRole('button', { name: 'Save' });
    await saveButton.evaluate((button) => {
        button.click();
        button.click();
    });
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);
    await expect(settingsDialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveCount(0);
});

test('first-run rejects a mismatched successful group snapshot and never saves preferences', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfigResponseTransform: (response) => ({
            ...response,
            groups: response.groups.map((group, index) => index === response.groups.length - 1
                ? { ...group, name: 'Wrong server name', missingInfoComponents: ['wrong-component'] }
                : group),
        }),
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);

    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog.locator('.group-modal-warning')).toContainText('did not match the submitted shared settings');
    await expect(dialog.getByRole('button', { name: 'Retry unsaved settings' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
});

for (const invalidCommit of [
    { label: 'missing revision', transform: response => ({ ...response, configRevision: null }) },
    { label: 'string revision', transform: response => ({ ...response, configRevision: String(response.configRevision) }) },
    { label: 'invalid source', transform: response => ({ ...response, source: 'jsonfile' }) },
]) {
    test(`first-run rejects a 2xx group snapshot with ${invalidCommit.label} and never saves preferences`, async ({ page }) => {
        const calls = await mockFirstRunDashboard(page, { groupsConfigResponseTransform: invalidCommit.transform });
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
        await openFirstRunDuplicateDepartment(page, 'platform');
        await finishFirstRunConfigurationGuide(page);
        const dialog = page.locator('.group-modal');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog.locator('.group-modal-warning')).toContainText('valid committed workspace revision');
        await expect(dialog.getByRole('button', { name: 'Retry unsaved settings' })).toHaveCount(0);
        expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
        expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
    });
}

test('first-run zero-commit group failure returns to editing without partial recovery actions', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfigError: { status: 500, body: { error: 'groups_save_failed', message: 'Synthetic groups failure.' } },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.locator('.group-modal-warning')).toContainText('Synthetic groups failure.');
    await expect(dialog.getByRole('button', { name: 'Retry unsaved settings' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Return' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
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
    await finishFirstRunConfigurationGuide(page);
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
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveCount(0);
});

test('first-run configuration blocks Save until Done and Cancel restores exact precommit state', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    const firstRunDialog = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(settingsDialog.locator('.group-modal-footer button').filter({ hasText: /^Save$/ })).toBeDisabled();
    await settingsDialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Cancel' }).click();
    await expect(firstRunDialog).toBeVisible();
    await expect(firstRunDialog.getByRole('radio', { checked: true })).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);

    await openFirstRunCreateDepartment(page);
    await expect(settingsDialog.getByPlaceholder('Group name')).toHaveValue('New Department');
    await settingsDialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Continue', exact: true }).click();
    await settingsDialog.getByRole('button', { name: 'Refresh teams' }).click();
    await settingsDialog.getByPlaceholder('Search teams to add...').fill('new');
    await settingsDialog.locator('.team-search-result-item', { hasText: 'New Team' }).click();
    const guide = settingsDialog.locator('.first-run-configuration-guide');
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue without components', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Done', exact: true }).click();
    await settingsDialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);
    await expect(settingsDialog).toHaveCount(0);
});

test('first-run preference pending recovery survives Done and retries only the private preference', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        preferenceError: {
            status: 500,
            body: { error: 'preference_save_failed', message: 'Synthetic preference failure.' },
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);

    const settingsDialog = page.locator('.group-modal');
    const guide = settingsDialog.locator('.first-run-configuration-guide');
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await settingsDialog.getByRole('button', { name: 'Refresh teams' }).click();
    await settingsDialog.getByPlaceholder('Search teams to add...').fill('new');
    await settingsDialog.locator('.team-search-result-item', { hasText: 'New Team' }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue without components', exact: true }).click();
    await guide.getByRole('button', { name: 'Continue', exact: true }).click();
    await guide.getByRole('button', { name: 'Done', exact: true }).click();
    await settingsDialog.getByRole('button', { name: 'Save' }).click();

    await expect(guide.getByRole('button', { name: 'Retry favorite save' })).toBeVisible();
    await expect(guide.getByRole('button', { name: 'Return' })).toBeVisible();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);

    await guide.getByRole('button', { name: 'Retry favorite save' }).evaluate((button) => { button.click(); button.click(); });
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(2);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);

    await guide.getByRole('button', { name: 'Return' }).click();
    await expect(settingsDialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
});

test('first-run group and EPM commits survive preference failure Retry without repeats', async ({ page }) => {
    const epmConfig = { version: 1, scope: { rootGoalKey: '', subGoalKey: '' }, labelPrefix: 'rnd_base_*', issueTypes: { initiative: 'Initiative', epic: 'Epic', story: 'Story' }, projects: [] };
    const preferenceRetryGate = deferred();
    const calls = await mockFirstRunDashboard(page, {
        analyticsEnabled: true,
        userCanEditEpmConfig: true,
        epmConfig,
        preferenceRetryGate,
        preferenceErrors: [{ status: 500, body: { error: 'preference_save_failed', message: 'Synthetic preference failure.' } }, null],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_committed_*');
    const preferenceResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/groups-preferences');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await preferenceResponse).status()).toBe(500);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);

    const retry = dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Retry favorite save' });
    await expect(retry).toBeVisible();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(1);
    const requestBaseline = calls.length;
    const analyticsBaseline = await page.evaluate(() => (window.dataLayer || []).length);
    await retry.evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(2);
    expectOnlyFirstRunPreferenceRequest(calls, requestBaseline);
    preferenceRetryGate.resolve();
    await expect(dialog).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(1);
    const analyticsDelta = await page.evaluate(start => (window.dataLayer || []).slice(start), analyticsBaseline);
    const settingsDelta = analyticsDelta.filter(entry => entry?.event_name === 'settings_action');
    expect(settingsDelta.filter(entry => entry.workflow_action === 'first_run_selection')).toHaveLength(1);
    expect(settingsDelta.filter(entry => ['save', 'save_result'].includes(entry.workflow_action))).toHaveLength(0);
});

test('first-run group and EPM commits survive preference failure Return with private state restored', async ({ page }) => {
    const epmConfig = { version: 1, scope: { rootGoalKey: '', subGoalKey: '' }, labelPrefix: 'rnd_base_*', issueTypes: { initiative: 'Initiative', epic: 'Epic', story: 'Story' }, projects: [] };
    const calls = await mockFirstRunDashboard(page, {
        analyticsEnabled: true,
        userCanEditEpmConfig: true,
        epmConfig,
        preferenceErrors: [{ status: 500, body: { error: 'preference_save_failed', message: 'Synthetic preference failure.' } }, null],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_committed_*');
    const preferenceResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/groups-preferences');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await preferenceResponse).status()).toBe(500);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config').length).toBe(1);
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);

    const guide = dialog.locator('.first-run-configuration-guide');
    await expect(guide.getByRole('button', { name: 'Return' })).toBeVisible();
    const requestBaseline = calls.length;
    const analyticsBaseline = await page.evaluate(() => (window.dataLayer || []).length);
    await guide.getByRole('button', { name: 'Return' }).click();
    const chooser = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(chooser.getByText('Platform Copy', { exact: true })).toBeVisible();
    await expect(chooser.getByRole('radio', { checked: true })).toHaveCount(0);
    expect(calls.slice(requestBaseline)).toEqual([]);
    expect(await page.evaluate(start => (window.dataLayer || []).slice(start).filter(entry => entry?.event_name === 'settings_action'), analyticsBaseline)).toEqual([]);

    await chooser.getByRole('radio', { name: /Platform Copy/ }).check();
    await chooser.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.locator('.group-modal');
    await reopened.getByRole('button', { name: 'EPM' }).click();
    await reopened.getByRole('tab', { name: 'Scope' }).click();
    await expect(reopened.locator('[data-epm-scope-field="labelPrefix"]')).toHaveValue('rnd_committed_*');
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(2);
});

test('first-run group-save 401 keeps the mounted configuration behind the global auth lock', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfigError: {
            status: 401,
            body: { error: 'auth_required', loginUrl: '/login?reason=session_expired' },
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    const settingsDialog = page.locator('.group-modal');
    await finishFirstRunConfigurationGuide(page);
    await settingsDialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(settingsDialog).toHaveCount(1);
    await expect(settingsDialog.locator('.first-run-configuration-error')).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
});

test('first-run admin-save 401 keeps the mounted configuration behind the global auth lock', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        capacityError: { status: 401, body: { error: 'auth_required', loginUrl: '/login?reason=session_expired' } },
        sharedConfig: {
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            board: { boardId: '42', boardName: 'Synthetic Board' },
            capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
            storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
            issueTypes: ['Story'],
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(dialog).toHaveCount(1);
    await expect(dialog.locator('.first-run-configuration-error')).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
});

test('first-run EPM-save 401 preserves the committed group behind the global auth lock', async ({ page }) => {
    const epmConfig = { version: 1, scope: {}, labelPrefix: 'rnd_base_*', issueTypes: {}, projects: [] };
    const calls = await mockFirstRunDashboard(page, {
        userCanEditEpmConfig: true,
        epmConfig,
        epmError: { status: 401, body: { error: 'auth_required', loginUrl: '/login?reason=session_expired' } },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_unsaved_*');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(dialog).toHaveCount(1);
    await expect(dialog.locator('.first-run-configuration-error')).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
});

test('first-run preference-save 401 preserves all committed sections behind the global auth lock', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        preferenceError: { status: 401, body: { error: 'auth_required', loginUrl: '/login?reason=session_expired' } },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(dialog).toHaveCount(1);
    await expect(dialog.locator('.first-run-configuration-error')).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);
});

test('first-run configuration keeps the editor open for a 409 choice and Discard returns to the chooser', async ({ page }) => {
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
    await openFirstRunDuplicateDepartment(page, 'platform');

    const settingsDialog = page.locator('.group-modal');
    await settingsDialog.getByPlaceholder('Group name').fill('Platform updated');
    await finishFirstRunConfigurationGuide(page);
    await settingsDialog.getByRole('button', { name: 'Save' }).click();
    await expect(settingsDialog.locator('.group-modal-validation')).toContainText('Team groups changed while you were editing.');
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toHaveCount(0);

    await settingsDialog.locator('.group-modal-validation').getByRole('button', { name: 'Discard mine' }).click();
    await expect(settingsDialog).toHaveCount(0);
    const chooser = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByText('Growth', { exact: true })).toHaveCount(0);
});

test('first-run postcommit group conflict exposes only recovery Retry and Return', async ({ page }) => {
    const groupsConfigConflict = {
        version: 1,
        groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'] }],
        defaultGroupId: 'platform',
        configRevision: 9,
        source: 'workspace_db',
    };
    const calls = await mockFirstRunDashboard(page, {
        groupsConfigConflict,
        sharedConfig: {
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            board: { boardId: '42', boardName: 'Synthetic Board' },
            capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
            storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
            issueTypes: ['Story'],
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Retry unsaved settings' })).toBeVisible();
    await expect(dialog.locator('button', { hasText: /^Discard mine$/ })).toHaveCount(0);
    await expect(dialog.locator('button', { hasText: /^Keep mine$/ })).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    const retry = dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Retry unsaved settings' });
    await retry.evaluate((button) => { button.click(); button.click(); });
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config').length).toBe(2);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
});

test('first-run postcommit group conflict Retry rebases mine and completes private handoff', async ({ page }) => {
    const current = {
        version: 1,
        groups: [{ id: 'platform', name: 'Platform remote', teamIds: ['team-platform'] }],
        defaultGroupId: 'platform',
        configRevision: 9,
        source: 'workspace_db',
    };
    const calls = await mockFirstRunDashboard(page, {
        groupsConfigConflicts: [current, null],
        sharedConfig: {
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
            storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
            issueTypes: ['Story'],
            capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    const dialog = page.locator('.group-modal');
    await dialog.getByPlaceholder('Group name').fill('Platform mine');
    await finishFirstRunConfigurationGuide(page);
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    const retry = dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Retry unsaved settings' });
    await expect(retry).toBeVisible();
    await retry.evaluate(button => { button.click(); button.click(); });
    await expect(dialog).toHaveCount(0);
    const groupPosts = calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(groupPosts).toHaveLength(2);
    expect(groupPosts[1].body.baseRevision).toBe(9);
    expect(groupPosts[1].body.groups.some(group => group.name === 'Platform mine')).toBe(true);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);
});

test('guide-complete Ctrl+S preserves the first-run session through ordered private handoff', async ({ page }) => {
    const preferenceGate = deferred();
    const calls = await mockFirstRunDashboard(page, {
        userCanEditEpmConfig: true,
        epmConfig: { version: 1, scope: {}, labelPrefix: 'rnd_base_*', issueTypes: {}, projects: [] },
        preferenceGate,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_keyboard_*');
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences').length).toBe(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(1);
    await expect(dialog).toBeVisible();
    preferenceGate.resolve();
    await expect(dialog).toHaveCount(0);
    const orderedPosts = calls.filter(call => call.method === 'POST').map(call => call.pathname);
    expect(orderedPosts.indexOf('/api/groups-config')).toBeLessThan(orderedPosts.indexOf('/api/epm/config'));
    expect(orderedPosts.indexOf('/api/epm/config')).toBeLessThan(orderedPosts.indexOf('/api/groups-preferences'));
});

test('guide 401 yields focus and normal click ownership to the auth recovery link', async ({ page }) => {
    const current = {
        version: 1,
        groups: [{ id: 'platform', name: 'Platform remote', teamIds: ['team-platform'] }],
        defaultGroupId: 'platform',
        configRevision: 9,
        source: 'workspace_db',
    };
    await mockFirstRunDashboard(page, {
        groupsConfigConflicts: [current, null],
        groupsConfigErrors: [null, { status: 401, body: { error: 'auth_required', loginUrl: '/login?reason=session_expired' } }],
        sharedConfig: {
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
            storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
            issueTypes: ['Story'],
            capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    const guide = dialog.locator('.first-run-configuration-guide');
    await expect(guide.getByRole('button', { name: 'Retry unsaved settings' })).toBeVisible();
    await guide.getByRole('button', { name: 'Retry unsaved settings' }).click();
    const authDialog = page.getByRole('alertdialog');
    const signIn = authDialog.getByRole('link', { name: 'Sign in again' });
    await expect(signIn).toBeFocused();
    await expect.poll(() => signIn.evaluate(node => node.inert || Boolean(node.closest('[inert]')))).toBe(false);
    await page.keyboard.press('Tab');
    await expect(signIn).toBeFocused();
    await signIn.evaluate(node => node.addEventListener('click', event => {
        event.preventDefault();
        window.__authRecoveryClicks = (window.__authRecoveryClicks || 0) + 1;
    }));
    await signIn.click();
    expect(await page.evaluate(() => window.__authRecoveryClicks)).toBe(1);
});

test('teams guide Tab reaches the allow-marked Refresh teams control without scripted focus', async ({ page }) => {
    await mockFirstRunDashboard(page, { teams: [] });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);
    const dialog = page.locator('.group-modal');
    await dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dialog.locator('[data-first-run-guide-target="teams"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Refresh teams' })).toBeFocused();
});

test('guide placement recomputes for Settings scroll and target or coachmark resize', async ({ page }) => {
    await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunCreateDepartment(page);
    const dialog = page.locator('.group-modal');
    const target = dialog.locator('[data-first-run-guide-target="name"]');
    const guide = dialog.locator('.first-run-configuration-guide');
    const initial = await guide.getAttribute('style');
    const initialTargetTop = await target.evaluate(node => node.getBoundingClientRect().top);
    const list = dialog.locator('.group-pane-list');
    const scrollTop = await list.evaluate(node => {
        const spacer = document.createElement('div');
        spacer.style.flex = '0 0 400px';
        node.prepend(spacer);
        node.scrollTop = node.scrollHeight;
        return node.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
    await expect.poll(() => target.evaluate(node => node.getBoundingClientRect().top)).not.toBe(initialTargetTop);
    await expect.poll(() => guide.getAttribute('style')).not.toBe(initial);
    const afterScrollTop = await guide.evaluate(node => node.style.top);
    const initialGuideWidth = await guide.evaluate(node => node.getBoundingClientRect().width);
    await guide.evaluate(node => { node.style.width = '160px'; });
    await expect.poll(() => guide.evaluate(node => node.getBoundingClientRect().width)).not.toBe(initialGuideWidth);
    await expect.poll(() => guide.evaluate(node => node.style.top)).not.toBe(afterScrollTop);
    await expectGuideTargetGeometry(target, guide);
});

test('first-run group commit followed by EPM failure Return preserves groups and drops the EPM draft', async ({ page }) => {
    const epmConfig = {
        version: 1,
        scope: { rootGoalKey: '', subGoalKey: '' },
        labelPrefix: 'rnd_base_*',
        issueTypes: { initiative: 'Initiative', epic: 'Epic', story: 'Story' },
        projects: [],
    };
    const calls = await mockFirstRunDashboard(page, {
        userCanEditEpmConfig: true,
        epmConfig,
        epmError: { status: 500, body: { error: 'epm_save_failed', message: 'Synthetic EPM failure.' } },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_unsaved_*');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const guide = dialog.locator('.first-run-configuration-guide');
    await expect(guide.getByRole('button', { name: 'Return' })).toBeVisible();
    await guide.getByRole('button', { name: 'Return' }).click();
    const chooser = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(chooser.getByText('Platform Copy', { exact: true })).toBeVisible();
    await chooser.getByRole('radio', { name: /Platform Copy/ }).check();
    await chooser.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    await page.locator('.group-modal').getByRole('button', { name: 'EPM' }).click();
    await page.locator('.group-modal').getByRole('tab', { name: 'Scope' }).click();
    await expect(page.locator('.group-modal').locator('[data-epm-scope-field="labelPrefix"]')).toHaveValue('rnd_base_*');
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(1);
});

test('first-run group commit followed by EPM failure Retry skips groups and completes once', async ({ page }) => {
    const epmConfig = {
        version: 1,
        scope: { rootGoalKey: '', subGoalKey: '' },
        labelPrefix: 'rnd_base_*',
        issueTypes: { initiative: 'Initiative', epic: 'Epic', story: 'Story' },
        projects: [],
    };
    const calls = await mockFirstRunDashboard(page, {
        userCanEditEpmConfig: true,
        epmConfig,
        epmErrors: [{ status: 500, body: { error: 'epm_save_failed', message: 'Synthetic EPM failure.' } }, null],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_saved_*');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const retry = dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Retry unsaved settings' });
    await retry.evaluate((button) => { button.click(); button.click(); });
    await expect(dialog).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(2);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);
});

test('first-run admin commit followed by group failure Return keeps admin and drops the group draft', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        groupsConfigError: { status: 500, body: { error: 'groups_save_failed', message: 'Synthetic groups failure.' } },
        sharedConfig: {
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            board: { boardId: '42', boardName: 'Synthetic Board' },
            capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
            storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
            issueTypes: ['Story'],
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Return' }).click();

    const chooser = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(chooser.getByText('Platform Copy', { exact: true })).toHaveCount(0);
    await chooser.getByRole('radio', { name: /Platform/ }).first().check();
    await chooser.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.locator('.group-modal');
    await reopened.getByRole('button', { name: 'Admin' }).click();
    await reopened.getByRole('tab', { name: 'Capacity' }).click();
    await expect(reopened.getByRole('button', { name: 'Remove capacity field' })).toHaveCount(0);
    await expect(reopened.getByRole('button', { name: 'Remove capacity project' })).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
});

test('first-run two-admin partial failure retry sends only the pending subsection', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page, {
        analyticsEnabled: true,
        capacityErrors: [{ status: 500, body: { error: 'capacity_save_failed', message: 'Synthetic capacity failure.' } }, null],
        sharedConfig: {
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            board: { boardId: '42', boardName: 'Synthetic Board' },
            capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
            storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
            issueTypes: ['Story'],
        },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    const retry = dialog.locator('.first-run-configuration-guide').getByRole('button', { name: 'Retry unsaved settings' });
    await expect(retry).toBeVisible();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/board-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    const retryBaseline = calls.length;
    await retry.evaluate((button) => { button.click(); button.click(); });
    await expect(dialog).toHaveCount(0);

    const retryDelta = calls.slice(retryBaseline);
    const settingsPostPaths = new Set(['/api/board-config', '/api/capacity/config', '/api/groups-config', '/api/groups-preferences']);
    expect(retryDelta.filter(call => call.method === 'POST' && settingsPostPaths.has(call.pathname)).map(call => call.pathname)).toEqual([
        '/api/capacity/config', '/api/groups-config', '/api/groups-preferences',
    ]);
    expect(retryDelta.filter(call => call.pathname === '/api/config')).toHaveLength(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/board-config')).toHaveLength(1);
    const adminSaveEvents = await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'settings_action'
        && entry.section === 'admin'
        && ['save', 'save_result'].includes(entry.workflow_action)
    )));
    expect(adminSaveEvents.map(entry => [entry.workflow_action, entry.result || null])).toEqual([
        ['save', null], ['save_result', 'failure'],
    ]);
});

test('first-run Return preserves committed projects and restores every uncommitted settings baseline', async ({ page }) => {
    const sharedConfig = {
        projects: { selected: [{ key: 'DEMO', type: 'product' }, { key: 'EXTRA', type: 'product' }] },
        statsPriorityWeights: [{ priority: 'P1', weight: 0.5 }],
        board: { boardId: '42', boardName: 'Synthetic Board' },
        capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
        parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
        storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
        teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
        deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
        issueTypes: ['Story'],
    };
    const epmConfig = { version: 1, scope: { rootGoalKey: '', subGoalKey: '' }, labelPrefix: 'rnd_base_*', issueTypes: { initiative: 'Initiative', epic: 'Epic', story: 'Story' }, projects: [] };
    const calls = await mockFirstRunDashboard(page, {
        sharedConfig,
        epmConfig,
        userCanEditEpmConfig: true,
        adminUserManagementAvailable: true,
        adminUsers: [{ id: 'user-1', externalSubject: 'synthetic-1', displayName: 'Synthetic Admin', accountType: 'admin', status: 'active' }],
        jiraFields: [{ id: 'customfield_19999', name: 'Alternate Field' }],
        priorityWeightsError: { status: 500, body: { error: 'priority_save_failed', message: 'Synthetic priority failure.' } },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Scope projects' }).click();
    await dialog.getByRole('button', { name: 'Remove product project EXTRA' }).click();
    await dialog.getByRole('tab', { name: 'Priority weights' }).click();
    await dialog.getByLabel('P1 weight').fill('0.75');
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();
    await dialog.getByRole('button', { name: 'Remove sprint field' }).click();
    await dialog.getByPlaceholder('Search fields...').fill('Alternate');
    await dialog.locator('.team-search-result-item', { hasText: 'Alternate Field' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();
    for (const [key, name] of [
        ['parent', 'Remove parent name field'],
        ['storyPoints', 'Remove story points field'],
        ['team', 'Remove team field'],
        ['deliveryOwner', 'Remove delivery owner field'],
    ]) {
        const mapping = dialog.locator(`[data-map-key="${key}"]`);
        await mapping.getByRole('button', { name }).click();
        await mapping.getByPlaceholder('Search fields...').fill('Alternate');
        await mapping.locator('.team-search-result-item', { hasText: 'Alternate Field' }).click();
    }
    await dialog.getByRole('button', { name: 'Remove issue type Story' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('tab', { name: 'Access' }).click();
    await dialog.getByRole('checkbox', { name: 'Administrator access for Synthetic Admin' }).uncheck();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_unsaved_*');
    await dialog.getByRole('button', { name: 'Save' }).click();

    const recovery = dialog.locator('.first-run-configuration-guide');
    await expect(recovery.getByRole('button', { name: 'Return' })).toBeVisible();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/projects/selected')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/stats/priority-weights-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && ['/api/board-config', '/api/capacity/config', '/api/groups-config', '/api/epm/config'].includes(call.pathname))).toHaveLength(0);
    await recovery.getByRole('button', { name: 'Return' }).click();

    const chooser = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(chooser.getByText('Platform Copy', { exact: true })).toHaveCount(0);
    await expect(chooser.getByRole('radio', { checked: true })).toHaveCount(0);
    await chooser.getByRole('radio', { name: /Platform/ }).first().check();
    await chooser.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.locator('.group-modal');
    await reopened.getByRole('button', { name: 'Admin' }).click();
    await reopened.getByRole('tab', { name: 'Scope projects' }).click();
    await expect(reopened.getByRole('button', { name: 'Remove product project EXTRA' })).toHaveCount(0);
    await expect(reopened.getByRole('button', { name: 'Remove product project DEMO' })).toBeVisible();
    await reopened.getByRole('tab', { name: 'Priority weights' }).click();
    await expect(reopened.getByLabel('P1 weight')).toHaveValue('0.5');
    await reopened.getByRole('tab', { name: 'Jira source' }).click();
    await expect(reopened.getByRole('button', { name: 'Clear sprint board' })).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Remove sprint field' })).toBeVisible();
    await reopened.getByRole('tab', { name: 'Field mapping' }).click();
    for (const name of ['Remove parent name field', 'Remove story points field', 'Remove team field', 'Remove delivery owner field', 'Remove issue type Story']) {
        await expect(reopened.getByRole('button', { name })).toBeVisible();
    }
    await reopened.getByRole('tab', { name: 'Capacity' }).click();
    await expect(reopened.getByRole('button', { name: 'Remove capacity field' })).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Remove capacity project' })).toBeVisible();
    await reopened.getByRole('tab', { name: 'Access' }).click();
    await expect(reopened.getByRole('checkbox', { name: 'Administrator access for Synthetic Admin' })).toBeChecked();
    await reopened.getByRole('button', { name: 'EPM' }).click();
    await reopened.getByRole('tab', { name: 'Scope' }).click();
    await expect(reopened.locator('[data-epm-scope-field="labelPrefix"]')).toHaveValue('rnd_base_*');
});

test('first-run workspace conflict Keep preserves the session and completes the private handoff', async ({ page }) => {
    const sharedConfig = {
        projects: { selected: [{ key: 'DEMO', type: 'product' }] },
        board: { boardId: '42', boardName: 'Synthetic Board' },
        capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
        parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
        storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
        teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
        deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
        issueTypes: ['Story'],
    };
    const calls = await mockFirstRunDashboard(page, {
        sharedConfig,
        capacityErrors: [{ status: 409, body: { error: 'workspace_config_conflict', message: 'Workspace changed.', currentRevision: 8 } }, null],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.locator('[data-testid="workspace-config-conflict-actions"]').getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(2);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);
});

test('first-run partial admin workspace conflict Retry rebases only pending work and completes', async ({ page }) => {
    const sharedConfig = {
        projects: { selected: [{ key: 'DEMO', type: 'product' }, { key: 'EXTRA', type: 'product' }] },
        board: { boardId: '42', boardName: 'Synthetic Board' },
        capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
        parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
        storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
        teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
        deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
        issueTypes: ['Story'],
    };
    const calls = await mockFirstRunDashboard(page, {
        sharedConfig,
        capacityErrors: [{ status: 409, body: { error: 'workspace_config_conflict', message: 'Workspace changed.', currentRevision: 8 } }, null],
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Scope projects' }).click();
    await dialog.getByRole('button', { name: 'Remove product project EXTRA' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    const guide = dialog.locator('.first-run-configuration-guide');
    const retry = guide.getByRole('button', { name: 'Retry unsaved settings' });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(dialog.locator('button', { hasText: /^Use latest$/ })).toHaveCount(0);
    await expect(dialog.locator('button', { hasText: /^Keep mine$/ })).toHaveCount(0);
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.click();
    await expect(dialog).toHaveCount(0);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/projects/selected')).toHaveLength(1);
    const capacityPosts = calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config');
    expect(capacityPosts).toHaveLength(2);
    expect(capacityPosts[1].body.baseRevision).toBe(8);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(1);
});

test('first-run workspace conflict Use latest exits through explicit recovery', async ({ page }) => {
    const sharedConfig = {
        projects: { selected: [{ key: 'DEMO', type: 'product' }] },
        board: { boardId: '42', boardName: 'Synthetic Board' },
        capacity: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
        parentNameField: { fieldId: 'customfield_10014', fieldName: 'Parent' },
        storyPointsField: { fieldId: 'customfield_10016', fieldName: 'Story points' },
        teamField: { fieldId: 'customfield_10001', fieldName: 'Team' },
        deliveryOwnerField: { fieldId: 'customfield_10002', fieldName: 'Delivery owner' },
        issueTypes: ['Story'],
    };
    const calls = await mockFirstRunDashboard(page, {
        sharedConfig,
        capacityError: { status: 409, body: { error: 'workspace_config_conflict', message: 'Workspace changed.', currentRevision: 8 } },
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await openFirstRunDuplicateDepartment(page, 'platform');
    await finishFirstRunConfigurationGuide(page);
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.locator('[data-testid="workspace-config-conflict-actions"]').getByRole('button', { name: 'Use latest' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-preferences')).toHaveLength(0);
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
    await expect(growthStar).toHaveCSS('width', '44px');
    await expect(growthStar).toHaveCSS('height', '44px');
    await expect(growthStar).toHaveAttribute('aria-pressed', 'false');
    await growthStar.click();
    await expect(dialog.getByRole('button', { name: 'Growth is my favorite group' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('checkbox', { name: 'Show in Department selector' })).toBeDisabled();
    await expect(dialog.locator('.group-visible-helper')).toHaveText('Your favorite Department is always shown');
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
