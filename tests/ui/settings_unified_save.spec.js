const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = path.join(__dirname, '..', '..', 'test-results', 'settings-unified-save-qa');
const administratorConfigPaths = new Set([
    '/api/projects/selected',
    '/api/stats/priority-weights-config',
    '/api/board-config',
    '/api/capacity/config',
    '/api/sprint-field/config',
    '/api/parent-name-field/config',
    '/api/story-points-field/config',
    '/api/team-field/config',
    '/api/delivery-owner-field/config',
    '/api/issue-types/config',
]);

let fixture;

test.beforeAll(async () => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    fixture = await import('../fixtures/groupBoardReference.mjs');
});

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (_) {
        return null;
    }
}

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
}

// Expands a { statusName: count } map into synthetic sprint-scoped epics, the shape the dashboard
// buckets into `epicsByStatus` for the composer.
function epicsFromCounts(counts) {
    const epics = [];
    let n = 0;
    Object.entries(counts).forEach(([statusName, count]) => {
        for (let i = 0; i < count; i += 1) {
            n += 1;
            epics.push({ key: `EPC-${n}`, status: { name: statusName } });
        }
    });
    return epics;
}

function baseGroupsConfig() {
    return {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'], board: fixture.referenceBoard() },
        ],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
        preferences: {
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        },
    };
}

// What another user's save left on the server: same group, a different first column name, and a
// revision ahead of the draft's baseRevision (2). Renaming the column is what makes "kept my
// draft" and "took theirs" distinguishable in the composer.
function conflictingServerConfig() {
    const config = baseGroupsConfig();
    config.groups[0].board.columns[0].name = 'Server Column';
    config.configRevision = 9;
    return config;
}

async function mockConfigSettings(page, {
    groupsConfig = baseGroupsConfig(),
    conflictCurrents = [],
    failGroupsSaveOnce = null,
    capacityConfig = {},
    priorityWeights = [],
    // Synthetic id: the Delivery Owner custom field id differs per Jira instance and the
    // product ships no default for it (O11).
    deliveryOwnerFieldConfig = { fieldId: 'customfield_20501', fieldName: 'Delivery Owner' },
    extraFields = [],
    workspaceSnapshots = null,
    workspaceSaveResponses = {},
    epmSaveResponse = null,
    epmLoadResponse = null,
    epmSaveGate = null,
    epmLoadGate = null,
    workspaceLoadGate = null,
    workspaceLoadResponse = null,
    configRetryAuthRequired = false,
    failFirstGroupsConnection = false,
    keepServerConnectionError = false,
    failFirstSelectedProjectsConnection = false,
    groupsRetryAuthRequired = false,
    initialTeamCatalog = {
        catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } },
        meta: { updatedAt: '2026-09-02T09:00:00Z', sprintId: '42', source: 'sprint' },
    },
    teamCatalogLoadGate = null,
    teamCatalogSaveGate = null,
    sprintsLoadGate = null,
    refreshedTeams = [
        { id: 'team-platform', name: 'Platform Team' },
        { id: 'team-data', name: 'Data Team' },
    ],
} = {}) {
    const calls = [];
    const epicsInScope = epicsFromCounts(fixture.REFERENCE_EPICS_BY_STATUS);
    let groupsPostCount = 0;
    let configGetCount = 0;
    let teamCatalogGetCount = 0;
    let persistedTeamCatalog = JSON.parse(JSON.stringify(initialTeamCatalog));
    const workspaceResponseQueues = Object.fromEntries(
        Object.entries(workspaceSaveResponses).map(([pathname, responses]) => [pathname, [...responses]])
    );
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
            search: url.search,
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
        if (url.pathname === '/api/config') {
            const requestIndex = configGetCount;
            const workspaceSnapshot = workspaceSnapshots?.[
                Math.min(configGetCount, workspaceSnapshots.length - 1)
            ];
            configGetCount += 1;
            if (configRetryAuthRequired && requestIndex > 0) {
                return json({
                    error: 'auth_required',
                    message: 'Sign in required.',
                    loginUrl: '/login?reason=session_expired',
                }, 401);
            }
            if (workspaceLoadGate && requestIndex > 0) await workspaceLoadGate.promise;
            if (workspaceLoadResponse && requestIndex > 0) {
                return json(workspaceLoadResponse.body, workspaceLoadResponse.status || 200);
            }
            return json({
            jiraUrl: workspaceSnapshot?.jiraUrl || 'https://jira.example',
            authMode: workspaceSnapshot ? 'atlassian_oauth' : '',
            projectsConfigured: true,
            settingsAdminOnly: false,
            userCanEditSettings: true,
            userCanEditEpmConfig: true,
            epm: workspaceSnapshot?.sharedConfig?.epm || epmConfig,
            ...(workspaceSnapshot || {}),
            });
        }
        if (request.method() === 'POST' && workspaceResponseQueues[url.pathname]?.length) {
            const response = workspaceResponseQueues[url.pathname].shift();
            return json(response.body, response.status || 200);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') {
            const groupGets = calls.filter(call => call.method === 'GET' && call.pathname === '/api/groups-config').length;
            if (groupsRetryAuthRequired && groupGets > 1) {
                return json({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
            }
            if (failFirstGroupsConnection && groupGets === 1) {
                await new Promise(resolve => setTimeout(resolve, 300));
                return route.abort('connectionrefused');
            }
            return json(groupsConfig);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            groupsPostCount += 1;
            if (failGroupsSaveOnce && groupsPostCount === 1) {
                return json(failGroupsSaveOnce.body, failGroupsSaveOnce.status);
            }
            // The optimistic lock rejecting an attempt, exactly as
            // backend/services/shared_group_config.py:173-175 does. One entry per rejected POST.
            const conflict = conflictCurrents[groupsPostCount - 1];
            if (conflict) {
                return json({
                    error: 'group_config_conflict',
                    message: 'Team groups were changed by another user.',
                    current: conflict,
                }, 409);
            }
            return json({
                ...requestBody(request),
                configRevision: (conflictCurrents[conflictCurrents.length - 1]?.configRevision || 2) + 1,
                source: 'workspace_db',
                preferences: groupsConfig.preferences,
            });
        }
        if (url.pathname === '/api/groups-preferences') return json({ preferences: groupsConfig.preferences });
        if (url.pathname === '/api/epm/config' && request.method() === 'GET') {
            if (epmLoadGate) await epmLoadGate.promise;
            if (epmLoadResponse) return json(epmLoadResponse.body, epmLoadResponse.status || 200);
            return json(epmConfig);
        }
        if (url.pathname === '/api/epm/config' && request.method() === 'POST') {
            if (epmSaveGate) await epmSaveGate.promise;
            if (epmSaveResponse) return json(epmSaveResponse.body, epmSaveResponse.status || 200);
            return json(requestBody(request));
        }
        if (url.pathname === '/api/epm/scope') return json({ cloudId: 'synthetic-cloud', error: '' });
        if (url.pathname === '/api/epm/goals') {
            if (url.searchParams.get('rootGoalKey')) {
                return json({ goals: [{ id: 'child', key: 'CHILD-200', name: 'Child Goal' }], error: '' });
            }
            return json({ goals: [{ id: 'root', key: 'ROOT-100', name: 'Root Goal' }], error: '' });
        }
        if (url.pathname === '/api/epm/projects/configuration') return json({ projects: [] });
        if (url.pathname === '/api/sprints') {
            if (keepServerConnectionError) return json({ error: 'unavailable' }, 500);
            if (sprintsLoadGate) await sprintsLoadGate.promise;
            return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        }
        if (url.pathname === '/api/team-catalog' && request.method() === 'GET') {
            teamCatalogGetCount += 1;
            const catalogSnapshot = JSON.parse(JSON.stringify(persistedTeamCatalog));
            if (teamCatalogLoadGate && teamCatalogGetCount === 1) await teamCatalogLoadGate.promise;
            return json(catalogSnapshot);
        }
        if (url.pathname === '/api/team-catalog' && request.method() === 'POST') {
            const body = requestBody(request);
            if (teamCatalogSaveGate) await teamCatalogSaveGate.promise;
            persistedTeamCatalog = { catalog: body.catalog || {}, meta: body.meta || {} };
            return json(persistedTeamCatalog);
        }
        if (url.pathname === '/api/teams') return json({ teams: refreshedTeams });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [] });
        if (url.pathname === '/api/projects/selected') {
            const projectGets = calls.filter(call => call.method === 'GET' && call.pathname === '/api/projects/selected').length;
            if (failFirstSelectedProjectsConnection && projectGets === 1) {
                await new Promise(resolve => setTimeout(resolve, 300));
                return route.abort('connectionrefused');
            }
            if (keepServerConnectionError) return json({ error: 'unavailable' }, 500);
            return json({ selected: [{ key: 'DEMO', type: 'product' }] });
        }
        if (url.pathname === '/api/projects') return json({ projects: [{ key: 'DEMO', name: 'Demo' }, { key: 'EXTRA', name: 'Extra' }] });
        if (url.pathname === '/api/fields') {
            // The real /api/fields answers a `project` query from that project's createmeta
            // screens, which is a subset of the instance's field catalog: a custom field that
            // is not on the project's create screens is simply absent. The mapping pickers
            // configure instance-wide fields, so they must ask for the unscoped catalog.
            const scoped = [
                { id: 'customfield_10020', name: 'Sprint' },
                { id: 'customfield_10099', name: 'Sprint (new)' },
            ];
            if (url.searchParams.get('project')) return json({ fields: scoped, scoped: true });
            return json({
                fields: [...scoped, { id: 'customfield_20501', name: 'Delivery Owner' }, ...extraFields],
                scoped: false,
            });
        }
        if (url.pathname === '/api/board-config') return json({ boardId: fixture.REFERENCE_BOARD_ID, boardName: 'Synthetic Board' });
        if (url.pathname === '/api/board-config/statuses') return json(fixture.referenceStatusesResponse());
        if (url.pathname === '/api/stats/priority-weights-config') {
            if (keepServerConnectionError) return json({ error: 'unavailable' }, 500);
            return json({ weights: priorityWeights });
        }
        if (url.pathname === '/api/capacity/config') return json(capacityConfig);
        if (url.pathname === '/api/sprint-field/config') return json({ fieldId: 'customfield_10020', fieldName: 'Sprint' });
        if (url.pathname === '/api/parent-name-field/config') return json({ fieldId: 'customfield_10021', fieldName: 'Parent Link' });
        if (url.pathname === '/api/story-points-field/config') return json({ fieldId: 'customfield_10022', fieldName: 'Story points' });
        if (url.pathname === '/api/team-field/config') return json({ fieldId: 'customfield_10023', fieldName: 'Team' });
        if (url.pathname === '/api/delivery-owner-field/config') return json(deliveryOwnerFieldConfig);
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });

    return calls;
}

function sharedWorkspaceSnapshot({ revision = 3, jiraUrl = 'https://jira.example', boardId = '7', boardName = 'Sprint Board' } = {}) {
    return {
        jiraUrl,
        sharedConfigRevision: revision,
        sharedConfig: {
            version: 1,
            projects: { selected: [{ key: 'DEMO', type: 'product' }] },
            board: { boardId, boardName },
            capacity: {},
            sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
            parentNameField: { fieldId: 'customfield_10021', fieldName: 'Parent Link' },
            storyPointsField: { fieldId: 'customfield_10022', fieldName: 'Story points' },
            teamField: { fieldId: 'customfield_10023', fieldName: 'Team' },
            deliveryOwnerField: { fieldId: 'customfield_20501', fieldName: 'Delivery Owner' },
            statsPriorityWeights: [],
            issueTypes: ['Story'],
            epm: {
                version: 2,
                labelPrefix: 'rnd_project_',
                scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] },
                projects: {},
            },
        },
    };
}

async function openBoardsTab(page, dialog) {
    await dialog.getByRole('tab', { name: 'Boards' }).click();
    await expect(page.locator('#department-settings-boards-panel')).toBeVisible();
}

// Renames the first board column, which is the cheapest edit that makes `groups[].board` dirty
// and is visible in the composer afterwards.
async function makeBoardDraftDirty(page, dialog, name) {
    await openBoardsTab(page, dialog);
    await dialog.locator('.board-column').first().locator('.board-column-name').fill(name);
}

function groupsPosts(calls) {
    return calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config');
}

async function makeTwoWorkspaceSectionsDirty(dialog) {
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Scope projects' }).click();
    await dialog.getByPlaceholder('Search projects to add...').fill('EXTRA');
    await dialog.locator('.team-search-result-item', { hasText: 'EXTRA' }).getByRole('button', { name: 'Product' }).click();
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();
}

function workspacePosts(calls, pathname) {
    return calls.filter(call => call.method === 'POST' && call.pathname === pathname);
}

test('empty team catalog locks editing, auto-refreshes once, and reuses the saved cache on reopen', async ({ page }) => {
    const sprintsLoadGate = deferred();
    const teamCatalogSaveGate = deferred();
    const calls = await mockConfigSettings(page, {
        initialTeamCatalog: { catalog: {}, meta: {} },
        sprintsLoadGate,
        teamCatalogSaveGate,
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    const groupName = dialog.getByPlaceholder('Group name');
    const addGroup = dialog.getByRole('button', { name: '+ Add group' });
    const save = dialog.getByRole('button', { name: /^Save$/ });

    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/team-catalog').length).toBe(1);
    await expect(groupName).toBeDisabled();
    await expect(addGroup).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('title', 'Team cache is loading');
    await expect(dialog).toContainText('Waiting for sprint data...');
    expect(calls.filter(call => call.method === 'GET' && call.pathname === '/api/teams')).toHaveLength(0);
    await dialog.screenshot({ path: `${screenshotDir}/team-catalog-auto-refresh-loading.png`, animations: 'disabled' });

    sprintsLoadGate.resolve();
    await expect.poll(() => calls.filter(call => call.method === 'POST' && call.pathname === '/api/team-catalog').length).toBe(1);
    await expect(groupName).toBeDisabled();
    await dialog.getByRole('tab', { name: 'Boards' }).click();
    await expect(save).toHaveAttribute('title', 'Team cache is loading');
    await dialog.getByRole('tab', { name: 'Team groups' }).click();
    await expect(groupName).toBeDisabled();

    teamCatalogSaveGate.resolve();
    await expect(dialog).toContainText('Teams: Cached');
    await expect(groupName).toBeEnabled();
    await expect(addGroup).toBeEnabled();
    await dialog.screenshot({ path: `${screenshotDir}/team-catalog-auto-refresh-ready.png`, animations: 'disabled' });

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    await expect(dialog).toContainText('Teams: Cached');
    await expect(groupName).toBeEnabled();
    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/team-catalog').length).toBe(2);
    expect(calls.filter(call => call.method === 'GET' && call.pathname === '/api/teams')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/team-catalog')).toHaveLength(1);
});

test('stale cache load after cancel and reopen cannot trigger a duplicate refresh', async ({ page }) => {
    const teamCatalogLoadGate = deferred();
    const calls = await mockConfigSettings(page, {
        initialTeamCatalog: { catalog: {}, meta: {} },
        teamCatalogLoadGate,
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/team-catalog').length).toBe(1);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/team-catalog').length).toBe(2);
    await expect(dialog).toContainText('Teams: Cached');

    teamCatalogLoadGate.resolve();
    await page.waitForTimeout(100);
    expect(calls.filter(call => call.method === 'GET' && call.pathname === '/api/teams')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/team-catalog')).toHaveLength(1);
    await expect(dialog.getByPlaceholder('Group name')).toBeEnabled();
});

test('workspace conflict preserves later drafts and Keep mine rebases onto the server revision', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        workspaceSnapshots: [sharedWorkspaceSnapshot()],
        workspaceSaveResponses: {
            '/api/projects/selected': [{ body: { selected: [{ key: 'DEMO', type: 'product' }, { key: 'EXTRA', type: 'product' }], configRevision: 4 } }],
            '/api/board-config': [
                { status: 409, body: {
                    error: 'workspace_config_conflict',
                    message: 'Shared settings changed while you were editing. Your changes are still unsaved.',
                    currentRevision: 5,
                    current: { section: 'board', value: { boardId: '9', boardName: 'Server Board' }, configRevision: 5 },
                } },
                { body: { boardId: '', boardName: '', configRevision: 6 } },
            ],
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeTwoWorkspaceSectionsDirty(dialog);
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => workspacePosts(calls, '/api/projects/selected').length).toBe(1);
    await expect.poll(() => workspacePosts(calls, '/api/board-config').length).toBe(1);

    const banner = dialog.locator('.group-modal-validation');
    await expect(dialog).toBeVisible();
    await expect(banner).toContainText('Already saved: Scope projects.');
    await expect(banner).toContainText('Still unsaved: Jira board.');
    await expect(banner.getByRole('button', { name: 'Use latest' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();

    const geometry = await banner.locator(':scope > div, :scope button').evaluateAll((nodes) => nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const parent = node.parentElement.getBoundingClientRect();
        return {
            clipped: node.scrollWidth > node.clientWidth + 1,
            inside: box.left >= parent.left - 1 && box.right <= parent.right + 1,
        };
    }));
    expect(geometry.every(item => !item.clipped && item.inside)).toBe(true);
    await banner.screenshot({ path: `${screenshotDir}/workspace-config-conflict-banner.png`, animations: 'disabled' });

    expect(workspacePosts(calls, '/api/projects/selected')[0].body.baseRevision).toBe(3);
    expect(workspacePosts(calls, '/api/board-config')[0].body.baseRevision).toBe(4);
    await banner.getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog).toHaveCount(0);
    expect(workspacePosts(calls, '/api/board-config').map(call => call.body.baseRevision)).toEqual([4, 5]);
});

test('Use latest replaces workspace drafts without touching a dirty private EPM draft', async ({ page }) => {
    const latest = sharedWorkspaceSnapshot({ revision: 5, jiraUrl: 'https://second.example', boardId: '9', boardName: 'Server Board' });
    latest.sharedConfig.projects.selected = [{ key: 'DEMO', type: 'product' }];
    const calls = await mockConfigSettings(page, {
        workspaceSnapshots: [sharedWorkspaceSnapshot(), latest],
        workspaceSaveResponses: {
            '/api/projects/selected': [{ body: { selected: [{ key: 'DEMO', type: 'product' }, { key: 'EXTRA', type: 'product' }], configRevision: 4 } }],
            '/api/board-config': [{ status: 409, body: {
                error: 'workspace_config_conflict',
                message: 'Shared settings changed while you were editing. Your changes are still unsaved.',
                currentRevision: 5,
                current: { section: 'board', value: latest.sharedConfig.board, configRevision: 5 },
            } }],
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeTwoWorkspaceSectionsDirty(dialog);
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_private_');
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => workspacePosts(calls, '/api/projects/selected').length).toBe(1);
    await expect.poll(() => workspacePosts(calls, '/api/board-config').length).toBe(1);

    const banner = dialog.locator('.group-modal-validation');
    await expect(banner).not.toContainText('EPM settings');
    await banner.getByRole('button', { name: 'Use latest' }).click();
    await expect(banner.getByTestId('workspace-config-conflict-actions')).toHaveCount(0);
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    await expect(dialog.locator('#admin-settings-source-panel')).toContainText('Server Board');
    await dialog.getByRole('tab', { name: 'Scope projects' }).click();
    await expect(dialog.locator('#admin-settings-scope-panel')).not.toContainText('EXTRA');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await expect(dialog.locator('[data-epm-scope-field="labelPrefix"]')).toHaveValue('rnd_project_private_');
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(calls.filter(call => call.method === 'GET' && call.pathname === '/api/config')).toHaveLength(2);
    expect(workspacePosts(calls, '/api/epm/config')).toHaveLength(0);
});

for (const workspaceResult of [
    { name: 'succeeds', response: null },
    { name: 'fails', response: { status: 500, body: { error: 'config_unavailable', message: 'Configuration is temporarily unavailable.' } } },
]) {
    test(`a delayed Use latest load that ${workspaceResult.name} cannot overwrite an EPM draft edited after the request starts`, async ({ page }) => {
        const workspaceLoadGate = deferred();
        const latest = sharedWorkspaceSnapshot({ revision: 5, jiraUrl: 'https://second.example', boardId: '9', boardName: 'Server Board' });
        const calls = await mockConfigSettings(page, {
            workspaceSnapshots: [sharedWorkspaceSnapshot(), latest],
            workspaceLoadGate,
            workspaceLoadResponse: workspaceResult.response,
            workspaceSaveResponses: {
                '/api/projects/selected': [{ body: { selected: [{ key: 'DEMO', type: 'product' }], configRevision: 4 } }],
                '/api/board-config': [{ status: 409, body: {
                    error: 'workspace_config_conflict',
                    message: 'Shared settings changed while you were editing. Your changes are still unsaved.',
                    currentRevision: 5,
                    current: { section: 'board', value: latest.sharedConfig.board, configRevision: 5 },
                } }],
            },
        });

        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Manage team groups' }).click();
        const dialog = page.getByRole('dialog').first();
        await makeTwoWorkspaceSectionsDirty(dialog);
        await dialog.getByRole('button', { name: /^Save$/ }).click();
        const banner = dialog.locator('.group-modal-validation');
        await expect(banner.getByRole('button', { name: 'Use latest' })).toBeVisible();
        await banner.getByRole('button', { name: 'Use latest' }).click();
        await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/config').length).toBe(2);

        await dialog.getByRole('button', { name: 'EPM' }).click();
        await dialog.getByRole('tab', { name: 'Scope' }).click();
        const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
        await labelPrefix.fill('rnd_project_during_workspace_load_');
        const configResponse = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === '/api/config');
        workspaceLoadGate.resolve();
        await configResponse;

        await expect(labelPrefix).toHaveValue('rnd_project_during_workspace_load_');
        await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    });
}

test('a delayed EPM load cannot overwrite a draft edited after the request starts', async ({ page }) => {
    const epmLoadGate = deferred();
    const calls = await mockConfigSettings(page, {
        epmLoadGate,
        epmLoadResponse: {
            body: {
                version: 2,
                labelPrefix: 'rnd_project_remote_',
                scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] },
                issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story'] },
                projects: {},
            },
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/epm/config').length).toBe(1);
    const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
    await labelPrefix.fill('rnd_project_local_');
    const loadResponse = page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/epm/config');
    epmLoadGate.resolve();
    await loadResponse;

    await expect(labelPrefix).toHaveValue('rnd_project_local_');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
});

test('a delayed failing EPM load cannot reset a draft edited after the request starts', async ({ page }) => {
    const epmLoadGate = deferred();
    const calls = await mockConfigSettings(page, {
        epmLoadGate,
        epmLoadResponse: {
            status: 500,
            body: { error: 'epm_config_unavailable', message: 'EPM settings are temporarily unavailable.' },
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/epm/config').length).toBe(1);
    const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
    await labelPrefix.fill('rnd_project_local_after_failure_');
    const loadResponse = page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/epm/config');
    epmLoadGate.resolve();
    await loadResponse;

    await expect(labelPrefix).toHaveValue('rnd_project_local_after_failure_');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
});

test('a delayed EPM save advances only the submitted baseline and preserves a newer draft', async ({ page }) => {
    const epmSaveGate = deferred();
    const calls = await mockConfigSettings(page, { epmSaveGate });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
    await labelPrefix.fill('rnd_project_submitted_');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => workspacePosts(calls, '/api/epm/config').length).toBe(1);
    await labelPrefix.fill('rnd_project_newer_');
    const saveResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/epm/config');
    epmSaveGate.resolve();
    await saveResponse;

    await expect(dialog).toBeVisible();
    await expect(labelPrefix).toHaveValue('rnd_project_newer_');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => workspacePosts(calls, '/api/epm/config').length).toBe(2);
    expect(workspacePosts(calls, '/api/epm/config')[0].body.labelPrefix).toBe('rnd_project_submitted_');
    expect(workspacePosts(calls, '/api/epm/config')[1].body.labelPrefix).toBe('rnd_project_newer_');
});

test('workspace auth expiry preserves the draft, Cancel confirmation, and safe re-auth path', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        workspaceSnapshots: [sharedWorkspaceSnapshot()],
        workspaceSaveResponses: {
            '/api/board-config': [{ status: 401, body: {
                error: 'auth_required',
                message: 'Your session expired. Sign in again to save.',
                loginUrl: '/login?reason=session_expired',
            } }],
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.locator('.group-modal')).toHaveCount(1);
    await expect(page.locator('.group-modal .group-modal-dirty')).toHaveCount(1);
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    expect(workspacePosts(calls, '/api/board-config')[0].body.baseRevision).toBe(3);

    await expect(page.locator('#root > div[aria-hidden="true"]')).toHaveCount(1);
    await expect(page.locator('.group-modal .group-modal-dirty')).toHaveCount(1);
    await expect(page.locator('#admin-settings-source-panel')).toContainText('No board selected');
});

test('a 409 keeps the dirty board draft instead of overwriting it, and says so', async ({ page }) => {
    await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    const conflictResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/groups-config');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    expect((await conflictResponse).status()).toBe(409);
    // Let the rejection handler's state updates flush; without this the assertions below can pass
    // against the pre-rejection render and prove nothing.
    await page.waitForTimeout(300);

    // The defect: applySavedGroupsConfig(errorPayload.current) replaced groupDraft with the server
    // config, so the composer re-seeded to "Server Column" and the user's layout was gone.
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Local Column');
    // ...and the baseline reset made the form stop reading as dirty, so there was nothing left to save.
    await expect(page.locator('.group-modal .group-modal-dirty')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeEnabled();

    // Element-level, not a substring of the whole modal: the banner's own lines, in order.
    const banner = dialog.locator('.group-modal-validation');
    const lines = banner.locator(':scope > div:not(.group-modal-button-row)');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveText('• Team groups changed while you were editing. Your board layout is unsaved.');
    await expect(lines.nth(1)).toHaveText('• Nothing else was saved.');
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Discard mine' })).toBeVisible();
    // The modal stays open: losing the draft to a dismissed modal is the same defect.
    await expect(dialog).toBeVisible();

    // Fix 3: the exits render ahead of the footer in DOM order, so without a focus target here a
    // keyboard user tabbing forward from the Save click that produced this conflict sails past them
    // and has to Shift+Tab back. Focus must land in the alert itself when it appears.
    await expect(banner).toBeFocused();

    // No line or exit is clipped by the banner box.
    const clipped = await banner.locator(':scope > div, :scope button').evaluateAll((nodes) => nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => `${node.className || node.tagName}@${Math.round(node.getBoundingClientRect().width)}px`));
    expect(clipped).toEqual([]);
    await banner.screenshot({ path: `${screenshotDir}/groups-config-conflict-banner.png`, animations: 'disabled' });
    await dialog.screenshot({ path: `${screenshotDir}/groups-config-conflict-modal.png`, animations: 'disabled' });
});

test('Keep mine re-POSTs the local board rebased onto the server revision', async ({ page }) => {
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await dialog.locator('.group-modal-validation').getByRole('button', { name: 'Keep mine' }).click();

    await expect(dialog).toHaveCount(0);
    const posts = groupsPosts(calls);
    expect(posts).toHaveLength(2);
    // Rebase, not retry: re-sending baseRevision 2 would 409 forever.
    expect(posts[0].body.baseRevision).toBe(2);
    expect(posts[1].body.baseRevision).toBe(9);
    // The user's groups win whole — the same columns, in the same order, with the same ids.
    const rejected = posts[0].body.groups.find(group => group.id === 'platform');
    const kept = posts[1].body.groups.find(group => group.id === 'platform');
    expect(kept.board.columns[0].name).toBe('Local Column');
    expect(kept.board.columns).toEqual(rejected.board.columns);
    expect(kept.teamIds).toEqual(rejected.teamIds);
});

test('a second conflict rebases again rather than replaying a revision the server already rejected', async ({ page }) => {
    const second = conflictingServerConfig();
    second.configRevision = 14;
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig(), second] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    const banner = dialog.locator('.group-modal-validation');
    await banner.getByRole('button', { name: 'Keep mine' }).click();
    // Rejected again, by someone who saved in between: the banner comes back rather than the
    // draft being lost on the second round.
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Local Column');
    await banner.getByRole('button', { name: 'Keep mine' }).click();

    await expect(dialog).toHaveCount(0);
    // Strictly advancing, never repeated: each attempt carries the newest revision the server
    // reported, which is why this terminates instead of looping on a stale one.
    expect(groupsPosts(calls).map(post => post.body.baseRevision)).toEqual([2, 9, 14]);
});

test('a non-409 save failure keeps the existing error path, with no conflict banner', async ({ page }) => {
    await mockConfigSettings(page, { failGroupsSaveOnce: { status: 500, body: { error: 'Server exploded' } } });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    const failedResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/groups-config');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    expect((await failedResponse).status()).toBe(500);
    await page.waitForTimeout(300);

    // Today's behaviour, unchanged: the error text in the Team groups pane, no exits to choose
    // between, modal open, draft intact.
    await expect(dialog.locator('.group-modal-validation')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Keep mine' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Team groups' }).click();
    await expect(dialog.locator('.group-modal-warning')).toContainText('Server exploded');
    await expect(dialog).toBeVisible();
});

test('Discard mine applies the server config and clears the dirty state', async ({ page }) => {
    await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await dialog.locator('.group-modal-validation').getByRole('button', { name: 'Discard mine' }).click();

    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Server Column');
    await expect(dialog.locator('.group-modal-validation')).toHaveCount(0);
    await expect(dialog.locator('.group-modal-dirty')).toHaveCount(0);
    const saveButton = dialog.getByRole('button', { name: /^Save$/ });
    await expect(saveButton).toBeDisabled();
    await expect(saveButton).toHaveAttribute('title', 'No changes to save');
    // Deliberate choice, not a dismissal: the modal is still open on the server's board.
    await expect(dialog).toBeVisible();
});

test('the conflict banner names the sections that committed before the rejected groups POST', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        conflictCurrents: [conflictingServerConfig()],
        capacityConfig: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Capacity is section 4 of the twelve, committed by its own endpoint before the groups POST.
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.locator('#admin-settings-capacity-panel').getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.locator('#admin-settings-capacity-panel').getByRole('button', { name: 'Remove capacity project' }).click();

    await dialog.getByRole('button', { name: 'Departments' }).click();
    await makeBoardDraftDirty(page, dialog, 'Local Column');
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    const banner = dialog.locator('.group-modal-validation');
    await expect(banner).toContainText('Capacity');
    await expect(banner).toContainText('already saved');
    // The rejected half is named too, or "saved" reads as if everything went through.
    await expect(banner).toContainText('Team groups changed while you were editing.');
    // The claim is checked against the wire, not just against its own label list.
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
    expect(groupsPosts(calls)).toHaveLength(1);
});

// Fix 1: EPM settings save after the groups POST inside saveAllSettings, so a rejected groups POST
// never reaches it — dirty EPM was also a change, and it was also skipped, exactly like the group
// draft itself. The old fallback line claimed groups/board "were the only change" whenever nothing
// had committed through the admin-gated endpoints, which is false here: EPM is a second unsaved
// change the banner never named.
test('the conflict banner names EPM settings as pending instead of claiming groups were the only change', async ({ page }) => {
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');

    await dialog.getByRole('button', { name: /^Save$/ }).click();

    const banner = dialog.locator('.group-modal-validation');
    const lines = banner.locator(':scope > div:not(.group-modal-button-row)');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(1)).toHaveText('• EPM settings is also unsaved.');
    await expect(banner).not.toContainText('only change');
    // EPM never reached its own endpoint: saveAllSettings returns as soon as saveGroupsConfig throws.
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(0);
});

// Fix 2: the trigger is any dirty group draft (D45), not only a dirty board, but the mandated
// "Your board layout is unsaved." sentence was written for the board-only trigger. A user who edits
// only teamIds must not be told about a board they never touched.
test('the conflict headline names what changed instead of a board the user never touched', async ({ page }) => {
    const groupsConfig = baseGroupsConfig();
    groupsConfig.groups[0].teamIds = ['team-platform', 'team-secondary'];
    await mockConfigSettings(page, { groupsConfig, conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Dirty teamIds only — every other conflict test in this file dirties the board too.
    await dialog.locator('.selected-team-chip .remove-btn').first().click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    const banner = dialog.locator('.group-modal-validation');
    const lines = banner.locator(':scope > div:not(.group-modal-button-row)');
    await expect(lines.nth(0)).toHaveText('• Team groups changed while you were editing. Your changes are unsaved.');
    await expect(banner).not.toContainText('board layout');
});

// Fix 4: a plain footer Save while a conflict is open replays the stale baseRevision and must 409
// again rather than silently rebasing — auto-rebasing the ordinary Save is exactly the choice "Keep
// mine" exists to make explicit. Nothing pinned this before.
test('a plain Save while a conflict is open 409s again and the banner returns with the newer revision', async ({ page }) => {
    const second = conflictingServerConfig();
    second.configRevision = 14;
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig(), second] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    const banner = dialog.locator('.group-modal-validation');
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();

    // Not Keep mine: the plain footer Save, which still carries the original stale baseRevision (2).
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Local Column');

    const posts = groupsPosts(calls);
    expect(posts).toHaveLength(2);
    expect(posts[0].body.baseRevision).toBe(2);
    expect(posts[1].body.baseRevision).toBe(2);
    // The banner now carries the second rejection's newer revision (14), not the first's (9) —
    // proof the retry actually 409ed again instead of the first banner simply staying on screen.
    await banner.getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog).toHaveCount(0);
    expect(groupsPosts(calls).map(post => post.body.baseRevision)).toEqual([2, 2, 14]);
});

test('the unified save persists every dirty section together, group board included', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        capacityConfig: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        priorityWeights: [{ priority: 'P1', weight: 0.5 }],
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Departments: the group itself and its board, both inside the one groups payload.
    await dialog.getByPlaceholder('Group name').fill('Platform Core');
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Scope projects' }).click();
    await dialog.getByPlaceholder('Search projects to add...').fill('EXTRA');
    await dialog.locator('.team-search-result-item', { hasText: 'EXTRA' }).getByRole('button', { name: 'Product' }).click();

    // The global board id — the other thing called "board config", saved by its own endpoint.
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();

    await dialog.getByRole('tab', { name: 'Field mapping' }).click();
    await dialog.getByRole('button', { name: 'Remove delivery owner field' }).click();
    await dialog.getByRole('button', { name: 'Remove issue type Story' }).click();

    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();

    await dialog.getByRole('tab', { name: 'Priority weights' }).click();
    await dialog.getByLabel('P1 weight').fill('0.75');

    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);

    const posts = pathname => calls.filter(call => call.method === 'POST' && call.pathname === pathname);
    expect(posts('/api/projects/selected')).toHaveLength(1);
    expect(posts('/api/stats/priority-weights-config')).toHaveLength(1);
    expect(posts('/api/board-config')).toHaveLength(1);
    expect(posts('/api/capacity/config')).toHaveLength(1);
    expect(posts('/api/delivery-owner-field/config')).toHaveLength(1);
    expect(posts('/api/issue-types/config')).toHaveLength(1);
    expect(posts('/api/epm/config')).toHaveLength(1);

    // Each endpoint payload stays scoped to its own section, and the board rides the groups one.
    expect(posts('/api/board-config')[0].body).toEqual({ boardId: '', boardName: '', baseRevision: 0 });
    expect(posts('/api/capacity/config')[0].body).toEqual({ project: '', fieldId: '', fieldName: '', baseRevision: 0 });
    expect(posts('/api/epm/config')[0].body.labelPrefix).toBe('rnd_project_core_');
    expect(Object.keys(posts('/api/epm/config')[0].body).sort()).toEqual([
        'issueTypes', 'labelPrefix', 'projects', 'scope', 'version',
    ]);
    expect(posts('/api/epm/config')[0].body.baseRevision).toBeUndefined();
    expect(posts('/api/epm/config')[0].body.tab).toBeUndefined();
    expect(posts('/api/epm/config')[0].body.selectedSprint).toBeUndefined();
    const groupsBody = posts('/api/groups-config')[0].body;
    expect(groupsBody.groups[0].name).toBe('Platform Core');
    expect(groupsBody.groups[0].board.columns[0].name).toBe('Local Column');
    expect(groupsBody.board).toBeUndefined();
});

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
    expect(calls.some(call => call.method === 'POST' && (
        call.pathname.startsWith('/api/admin/') || administratorConfigPaths.has(call.pathname)
    ))).toBe(false);
});

test('unverified saved Capacity mapping is re-attested without changing the selection', async ({ page }) => {
    const capacity = {
        project: 'DEMO',
        fieldId: 'customfield_10050',
        fieldName: 'Capacity',
    };
    const workspace = sharedWorkspaceSnapshot();
    workspace.capacityProject = capacity.project;
    workspace.capacityMutationEnabled = false;
    workspace.sharedConfig.capacity = capacity;
    const calls = await mockConfigSettings(page, {
        workspaceSnapshots: [workspace],
        capacityConfig: { ...capacity, mutationEnabled: true, configRevision: 4 },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();

    const saveButton = dialog.getByRole('button', { name: /^Save$/ });
    await expect(saveButton).toBeEnabled();
    await expect(dialog.locator('.group-modal-dirty')).toHaveText('Unsaved changes · 1');
    await dialog.screenshot({ path: `${screenshotDir}/capacity-reverification-ready.png`, animations: 'disabled' });
    await saveButton.click();

    await expect(dialog).toHaveCount(0);
    const posts = workspacePosts(calls, '/api/capacity/config');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ ...capacity, baseRevision: 3 });
});

test('local OAuth JSON mode loads and re-attests an existing Capacity mapping', async ({ page }) => {
    const capacity = {
        project: 'DEMO',
        fieldId: 'customfield_10050',
        fieldName: 'Capacity',
    };
    const calls = await mockConfigSettings(page, {
        workspaceSnapshots: [{
            jiraUrl: 'https://jira.example',
            authMode: 'atlassian_oauth',
            capacityProject: capacity.project,
            capacityMutationEnabled: false,
        }],
        capacityConfig: { ...capacity, mutationEnabled: false, configRevision: 0 },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();

    await expect(dialog.locator('.selected-team-chip', { hasText: 'DEMO' })).toBeVisible();
    await expect(dialog.locator('.selected-team-chip', { hasText: 'Capacity' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(dialog).toHaveCount(0);
    const posts = workspacePosts(calls, '/api/capacity/config');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ ...capacity, baseRevision: 0 });
});

test('Capacity config conflict can keep the draft and retry on the server revision', async ({ page }) => {
    const capacity = {
        project: 'DEMO',
        fieldId: 'customfield_10050',
        fieldName: 'Capacity',
    };
    const workspace = sharedWorkspaceSnapshot();
    workspace.capacityProject = capacity.project;
    workspace.capacityMutationEnabled = false;
    workspace.sharedConfig.capacity = capacity;
    const calls = await mockConfigSettings(page, {
        workspaceSnapshots: [workspace],
        workspaceSaveResponses: {
            '/api/capacity/config': [
                {
                    status: 409,
                    body: {
                        error: 'capacity_config_conflict',
                        current: { ...capacity, configRevision: 5, mutationEnabled: true },
                    },
                },
                { body: { ...capacity, configRevision: 6, mutationEnabled: true } },
            ],
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(dialog.getByTestId('workspace-config-conflict-actions')).toBeVisible();
    await expect(dialog).toContainText('Still unsaved: Capacity.');
    await dialog.getByRole('button', { name: 'Keep mine' }).click();

    await expect(dialog).toHaveCount(0);
    const posts = workspacePosts(calls, '/api/capacity/config');
    expect(posts).toHaveLength(2);
    expect(posts[0].body.baseRevision).toBe(3);
    expect(posts[1].body.baseRevision).toBe(5);
});

test('EPM save auth expiry preserves the private draft and exposes safe recovery without replay', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        epmSaveResponse: {
            status: 401,
            body: {
                error: 'auth_required',
                message: 'Your session expired. Sign in again to save.',
                loginUrl: '/login?reason=session_expired',
            },
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
    await labelPrefix.fill('rnd_project_unsaved_');
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.locator('.group-modal')).toHaveCount(1);
    await expect(page.locator('[data-epm-scope-field="labelPrefix"]')).toHaveValue('rnd_project_unsaved_');
    await expect(page.locator('.group-modal .group-modal-dirty')).toHaveCount(1);
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    await page.getByRole('alertdialog').dispatchEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    await page.waitForTimeout(100);
    expect(workspacePosts(calls, '/api/epm/config')).toHaveLength(1);
    expect(calls.some(call => call.method === 'POST' && (
        call.pathname.startsWith('/api/admin/') || administratorConfigPaths.has(call.pathname)
    ))).toBe(false);
});

test('group reload auth expiry preserves the visible group draft and blocks save shortcut', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        failFirstSelectedProjectsConnection: true,
        groupsRetryAuthRequired: true,
        keepServerConnectionError: true,
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.locator('.group-modal');
    const groupName = dialog.getByPlaceholder('Group name');
    await groupName.fill('Private draft name');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();

    await page.getByRole('button', { name: 'Retry connection' }).evaluate(button => button.click());
    const authDialog = page.getByRole('alertdialog');
    await expect(authDialog).toBeVisible();
    await expect(groupName).toHaveValue('Private draft name');
    await authDialog.dispatchEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    await page.waitForTimeout(100);

    expect(workspacePosts(calls, '/api/groups-config')).toHaveLength(0);
});

test('admin_required stays in targeted settings recovery and preserves the draft', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        workspaceSaveResponses: {
            '/api/board-config': [{ status: 403, body: {
                error: 'admin_required',
                message: 'Administrator access is required.',
            } }],
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog.getByText('Administrator access is required.')).toBeVisible();
    await expect(dialog.locator('#admin-settings-source-panel')).toContainText('No board selected');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    expect(workspacePosts(calls, '/api/board-config')).toHaveLength(1);
});

test('private EPM conflicts preserve the draft without opening workspace conflict actions', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        epmSaveResponse: {
            status: 409,
            body: {
                error: 'view_config_conflict',
                message: 'This private view changed while you were editing.',
                currentVersion: 8,
            },
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
    await labelPrefix.fill('rnd_project_conflicting_');
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(labelPrefix).toHaveValue('rnd_project_conflicting_');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    await expect(dialog.getByTestId('workspace-config-conflict-actions')).toHaveCount(0);
    await expect.poll(() => workspacePosts(calls, '/api/epm/config').length).toBe(1);
});

test('EPM settings load auth expiry preserves the bootstrapped private baseline', async ({ page }) => {
    await mockConfigSettings(page, {
        epmLoadResponse: {
            status: 401,
            body: {
                error: 'auth_required',
                message: 'Sign in required.',
                loginUrl: '/login?reason=session_expired',
            },
        },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    await expect(page.locator('.group-modal')).toHaveCount(1);
    await expect(dialog.locator('.group-modal-dirty')).toHaveCount(0);
});

test('connection retry auth expiry preserves the bootstrapped private EPM baseline and draft', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        configRetryAuthRequired: true,
        failFirstGroupsConnection: true,
        keepServerConnectionError: true,
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    const labelPrefix = dialog.locator('[data-epm-scope-field="labelPrefix"]');
    await expect(labelPrefix).toHaveValue('rnd_project_');
    await labelPrefix.fill('rnd_project_private_');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();

    await page.getByRole('button', { name: 'Retry connection' }).evaluate(button => button.click());

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(labelPrefix).toHaveValue('rnd_project_private_');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    expect(calls.filter(call => call.method === 'GET' && call.pathname === '/api/config')).toHaveLength(2);
});

test('the mapping pickers search the whole field catalog, not the capacity project’s screens', async ({ page }) => {
    // The live defect: with a capacity project configured, the field catalog was fetched
    // scoped to that project's createmeta screens, so an instance-wide custom field that is
    // not on those screens could never be found — Delivery Owner among them.
    const calls = await mockConfigSettings(page, {
        capacityConfig: { project: 'CAP', fieldId: 'customfield_10409', fieldName: 'Team capacity' },
        deliveryOwnerFieldConfig: { fieldId: '', fieldName: '' },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    const entry = dialog.locator('.mapping-config-grid [data-map-key="deliveryOwner"]');
    await entry.locator('.team-search-input').fill('Delivery Owner');
    await expect(entry.locator('.team-search-result-item')).toHaveCount(1);
    await expect(entry.locator('.team-search-result-item').first()).toContainText('Delivery Owner');

    const fieldCalls = calls.filter(call => call.pathname === '/api/fields');
    expect(fieldCalls.length).toBeGreaterThan(0);
    expect(fieldCalls.every(call => !call.search.includes('project='))).toBe(true);
});

test('a truncated field search says so instead of silently dropping matches', async ({ page }) => {
    await mockConfigSettings(page, { deliveryOwnerFieldConfig: { fieldId: '', fieldName: '' } });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    // The stub catalog has 3 fields, so an empty query is not truncated and must say nothing.
    const entry = dialog.locator('.mapping-config-grid [data-map-key="deliveryOwner"]');
    await entry.locator('.team-search-input').click();
    await expect(entry.locator('.team-search-result-item')).toHaveCount(3);
    await expect(entry.locator('.team-search-more')).toHaveCount(0);
});

test('a field search past the cap names how many matches it is hiding', async ({ page }) => {
    const extraFields = [];
    for (let i = 0; i < 25; i += 1) extraFields.push({ id: `customfield_3${i}`, name: `Owner Field ${i}` });
    await mockConfigSettings(page, { extraFields, deliveryOwnerFieldConfig: { fieldId: '', fieldName: '' } });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    // 26 fields match "owner" (the 25 above plus Delivery Owner); 20 are shown.
    const entry = dialog.locator('.mapping-config-grid [data-map-key="deliveryOwner"]');
    await entry.locator('.team-search-input').fill('owner');
    await expect(entry.locator('.team-search-result-item')).toHaveCount(20);
    await expect(entry.locator('.team-search-more')).toHaveText('+6 more matches — keep typing to narrow.');

    // A notice you only see after scrolling past 20 rows is still a silent truncation, so it is
    // sticky at the foot of the scroll container: assert it is inside the panel's visible box
    // with the list unscrolled, not merely present in the DOM.
    const geometry = await entry.evaluate((node) => {
        const panel = node.querySelector('.team-search-results');
        const more = node.querySelector('.team-search-more');
        const panelBox = panel.getBoundingClientRect();
        const moreBox = more.getBoundingClientRect();
        return {
            scrollTop: panel.scrollTop,
            scrollable: panel.scrollHeight > panel.clientHeight,
            visible: moreBox.top >= panelBox.top - 1 && moreBox.bottom <= panelBox.bottom + 1,
        };
    });
    expect(geometry.scrollTop).toBe(0);
    expect(geometry.scrollable).toBe(true);
    expect(geometry.visible).toBe(true);
});

test('Field mapping tab renders Delivery Owner Field as a fifth entry styled like its siblings', async ({ page }) => {
    await mockConfigSettings(page);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    const grid = dialog.locator('.mapping-config-grid');
    await expect(grid).toBeVisible();

    const entries = grid.locator(':scope > [data-map-key]');
    await expect(entries).toHaveCount(5);
    await expect(entries.nth(4)).toHaveAttribute('data-map-key', 'deliveryOwner');

    const deliveryOwnerEntry = grid.locator('[data-map-key="deliveryOwner"]');
    await expect(deliveryOwnerEntry.locator('.team-selector-label')).toHaveText('Delivery Owner Field');
    const deliveryOwnerChip = deliveryOwnerEntry.locator('.selected-team-chip');
    await expect(deliveryOwnerChip).toBeVisible();
    await expect(deliveryOwnerChip).toHaveClass(/mapping-delivery-owner-chip/);
    await expect(deliveryOwnerChip).toContainText('Delivery Owner');

    const teamEntry = grid.locator('[data-map-key="team"]');
    const teamChip = teamEntry.locator('.selected-team-chip');
    await expect(teamChip).toBeVisible();

    // Fix 2 regression guard: a class matching zero CSS rules still passes a
    // declaration-level check, so assert the computed pixel, not just the class name.
    const deliveryOwnerBorderColor = await deliveryOwnerChip.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
    const teamBorderColor = await teamChip.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
    expect(deliveryOwnerBorderColor).toBe('rgba(20, 184, 166, 0.72)');
    expect(deliveryOwnerBorderColor).not.toBe(teamBorderColor);

    // Fix 1 regression guard: Delivery Owner is an epic field with no counterpart in the
    // story preview, so hovering its config card must NOT trigger the preview's
    // dim-everything-highlight-nothing state.
    const previewDimmable = dialog.locator('.mapping-preview-dimmable').first();
    await deliveryOwnerEntry.hover();
    await page.waitForTimeout(300); // let the 0.15s dim/highlight transition settle
    await expect(previewDimmable).toHaveCSS('opacity', '1');

    // A sibling that IS linked (Team Field) must still dim the preview and highlight its
    // own linked element, proving this differs from the Delivery Owner case above rather
    // than asserting a tautology.
    const previewTeamLink = dialog.locator('.mapping-preview-card .task-team[data-map-key="team"]');
    await teamEntry.hover();
    await page.waitForTimeout(300);
    await expect(previewDimmable).toHaveCSS('opacity', '0.62');
    await expect(previewTeamLink).toHaveCSS('opacity', '1');

    // Wait for the tab-switch transition to settle before capturing the screenshot.
    await page.waitForTimeout(300);
    await dialog.screenshot({ path: `${screenshotDir}/field-mapping-delivery-owner.png` });
});
