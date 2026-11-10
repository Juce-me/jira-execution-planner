const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { expectConfigBootstrapHoldsJiraWork, installDashboardShell } = require('./epm_view_fixture');
const { createPlanningReviewMock } = require('./planning_review_mock');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const secondFutureSprintId = 5003;
const secondFutureSprintName = '2026Q3 Sprint 2';
const completedSprintId = 2001;
const completedSprintName = '2026Q1 Sprint 9';
const groupTeamIds = ['team-alpha'];
let dashboardJs;

test.beforeAll(() => {
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    dashboardJs = result.outputFiles[0].text;
});

function json(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

// Planning plans real Jira issues by numeric id (#331): PLAN-n is issue 900n.
const storyId = key => String(9000 + Number(key.split('-').pop()));

function makeStory(key, status, sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        id: storyId(key),
        key,
        fields: {
            summary: `${key} synthetic future planning story`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            customfield_10004: 1,
            epicKey,
            parentSummary: 'Future planning epic',
            projectKey: 'PLAN',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
        },
    };
}

function makeEpic(sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        key: epicKey,
        summary: 'Future planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
    };
}

const futureStories = [
    makeStory('PLAN-1', 'To Do'),
    makeStory('PLAN-2', 'Pending'),
    makeStory('PLAN-3', 'Accepted'),
];
const secondFutureStories = [
    makeStory('PLAN-4', 'To Do', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
    makeStory('PLAN-5', 'Accepted', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
];
const completedStories = [
    makeStory('PLAN-1', 'Done', completedSprintId, completedSprintName),
    makeStory('PLAN-2', 'Done', completedSprintId, completedSprintName),
];

async function installPlanningFixture(page, {
    futureIssues = futureStories,
    configuredTeamIds = groupTeamIds,
    taskFailureMode = '',
    delayConfig = false,
    shellAuthDependency = '',
    onboardingRequired = false,
    // Saved shared plans by Sprint id (#331): { [sprintId]: ['PLAN-1', ...] }. No Sprint has a plan unless named.
    plans = {},
    // Stories the server reports as unavailable to this user (for example, no longer in the Sprint).
    unavailableKeys = [],
} = {}) {
    const calls = [];
    const review = createPlanningReviewMock({ initialPlans: Object.fromEntries(Object.entries(plans)
        .map(([sprintId, keys]) => [`group-alpha:${sprintId}`, { includedIssueIds: keys.map(storyId) }])) });
    let futureProductTaskAttempts = 0;
    let releaseConfig;
    const configRelease = delayConfig
        ? new Promise(resolve => { releaseConfig = resolve; })
        : Promise.resolve();
    let releaseShellAuth;
    const shellAuthRelease = shellAuthDependency
        ? new Promise(resolve => { releaseShellAuth = resolve; })
        : Promise.resolve();
    let groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{
            id: 'group-alpha',
            name: 'Alpha Department',
            teamIds: configuredTeamIds,
            labels: ['alpha_label'],
            excludedCapacityEpics: []
        }],
        preferences: {
            onboardingRequired,
            onboardingDone: !onboardingRequired,
            completedOnboardingModules: onboardingRequired
                ? []
                : ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            customized: false,
            visibleGroupIds: [],
            effectiveVisibleGroupIds: ['group-alpha'],
            activeGroupId: 'group-alpha',
        },
    };

    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const body = request.method() === 'GET' ? null : requestBody(request);
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
            headers: request.headers(),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/epm/access') {
            // The shell waits for this read when EPM is enabled: a late 401 lands after the groups loaded.
            if (shellAuthDependency === 'epm-access') {
                await shellAuthRelease;
                return json(route, {
                    error: 'auth_required',
                    loginUrl: '/login?reason=session_expired',
                }, 401);
            }
            return json(route, { state: 'disabled', epmHomeReadAvailable: false });
        }
        if (url.pathname === '/api/config') {
            await configRelease;
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                authMode: shellAuthDependency ? 'atlassian_oauth' : 'basic',
                epmViewEnabled: shellAuthDependency === 'epm-access',
                epmHomeReadAvailable: shellAuthDependency === 'epm-access',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
                viewConfig: {
                    workspaceId: 'workspace-test',
                    viewConfigId: 'view-test',
                    version: 1,
                    view: {
                        selectedView: 'eng',
                        selectedSprint: activeSprintId,
                        sprintName: activeSprintName,
                        activeGroupId: 'group-alpha',
                        showPlanning: false,
                        showScenario: false,
                    },
                },
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') {
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            const payload = requestBody(request);
            if (payload.baseRevision !== groupsConfigPayload.configRevision) {
                return json(route, { error: 'group_config_conflict', current: groupsConfigPayload }, 409);
            }
            groupsConfigPayload = {
                version: payload.version || 1,
                source: 'workspace_db',
                configRevision: groupsConfigPayload.configRevision + 1,
                defaultGroupId: payload.defaultGroupId || '',
                groups: payload.groups || [],
                preferences: groupsConfigPayload.preferences,
            };
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/team-catalog') return json(route, { catalog: {}, meta: {} });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [
                    { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                    { id: completedSprintId, name: completedSprintName, state: 'closed', startDate: '2026-03-01' },
                    { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                    { id: secondFutureSprintId, name: secondFutureSprintName, state: 'future', startDate: '2026-07-15' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const sprint = url.searchParams.get('sprint');
            if (project === 'product' && !purpose && String(sprint) === String(futureSprintId)) {
                futureProductTaskAttempts += 1;
                if (taskFailureMode === 'non-auth-once' && futureProductTaskAttempts === 1) {
                    return json(route, { error: 'synthetic_task_failure' }, 500);
                }
                if (taskFailureMode === 'auth-required') {
                    return json(route, {
                        error: 'auth_required',
                        loginUrl: '/login?reason=session_expired',
                    }, 401);
                }
            }
            const issues = project === 'product' && !purpose
                ? (String(sprint) === String(secondFutureSprintId)
                    ? secondFutureStories
                    : String(sprint) === String(completedSprintId) ? completedStories : futureIssues)
                : [];
            const epic = String(sprint) === String(secondFutureSprintId)
                ? makeEpic(secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2')
                : String(sprint) === String(completedSprintId)
                    ? makeEpic(completedSprintId, completedSprintName)
                    : makeEpic();
            return json(route, {
                issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/capacity') return json(route, { enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        // One Team's stored capacity document (#323): none is saved yet.
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity$/.test(url.pathname)) {
            return json(route, { teamId: url.searchParams.get('teamId') || 'team-alpha', sprintId: url.pathname.split('/')[4], revision: 0, rows: [], inherited: null, capabilities: { canRead: true, canSave: true } });
        }
        if (/^\/api\/eng\/sprints\/[^/]+\/review(?:\/values\/read)?$/.test(url.pathname)) {
            return json(route, review.response(request, { capabilities: { canRead: true, canSave: true }, unavailableIssueIds: unavailableKeys.map(storyId) }));
        }
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity\/planned\/read$/.test(url.pathname)) {
            return json(route, { sprintId: url.pathname.split('/')[4], capabilities: { canRead: true, canSave: true }, teams: [] });
        }
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return {
        calls,
        getGroupsConfig: () => groupsConfigPayload,
        getFutureProductTaskAttempts: () => futureProductTaskAttempts,
        releaseConfig: () => releaseConfig?.(),
        releaseShellAuth: () => releaseShellAuth?.(),
    };
}

async function seedPlanningAuthResume(page, {
    selectedTaskKeys = ['PLAN-2'],
    sprintId = futureSprintId,
    engMode = 'planning',
    selectionMode = 'manual',
    principal = { workspaceId: 'workspace-test', viewConfigId: 'view-test' },
    capturedAtOffsetMs = 0,
    settingsOpen = false,
    settingsTab = 'teams',
    seedUiPrefs = false,
    seedRecoveryAttempt = false,
    // A shared-plan draft (#331) turns the capsule into version 2: [{ key, included, baseRevision }] over the saved plan.
    draft = null,
} = {}) {
    const sharedDraft = draft && { inclusionChanges: draft.map(({ key, included, baseRevision }) => ({ issueId: storyId(key), included, baseRevision })),
        initializePlan: false, basePlanRevision: 1, baseScopeProof: `synthetic-plan:group-alpha:${sprintId}`, baseSchemaRevision: 0, baseViewRevision: 0, schemaChanges: [], cellChanges: [] };
    await page.addInitScript(({ sprintId, selectedTaskKeys, engMode, selectionMode, principal, capturedAtOffsetMs, settingsOpen, settingsTab, seedUiPrefs, seedRecoveryAttempt, sharedDraft }) => {
        const seedMarker = 'planning_auth_resume_fixture_seeded';
        if (window.sessionStorage.getItem(seedMarker)) return;
        window.sessionStorage.setItem(seedMarker, 'true');
        const scopeKey = `planning::${sprintId}::group-alpha`;
        const capturedAt = Date.now() + capturedAtOffsetMs;
        const view = { selectedView: 'eng', activeGroupId: 'group-alpha', selectedSprint: String(sprintId), engMode, settingsOpen, settingsTab };
        if (sharedDraft) window.sessionStorage.setItem('jira_dashboard_auth_resume_v1', JSON.stringify({ version: 2, capturedAt, principal, view,
            planning: { scope: { workspaceId: 'workspace-test', groupId: 'group-alpha', sprintId: String(sprintId), namespaceId: null }, selectedTeams: ['team-alpha'], draft: sharedDraft, submission: null } }));
        else window.sessionStorage.setItem('jira_dashboard_auth_resume_v1', JSON.stringify({
            version: 1,
            capturedAt,
            principal,
            view: {
                selectedView: 'eng',
                activeGroupId: 'group-alpha',
                selectedSprint: String(sprintId),
                engMode,
                settingsOpen,
                settingsTab,
            },
            planning: {
                scopeKey,
                selectedTaskKeys,
                selectedTeams: ['team-alpha'],
                selectionMode,
            },
        }));
        if (seedRecoveryAttempt) {
            const attemptId = 'attempt-planning-hydration';
            window.localStorage.setItem('jira_dashboard_auth_recovery_lease_v1', JSON.stringify({
                attemptId,
                startedAt: capturedAt,
            }));
            window.sessionStorage.setItem('jira_dashboard_auth_recovery_attempt_v1', JSON.stringify({
                attemptId,
                startedAt: capturedAt,
            }));
        }
        if (seedUiPrefs) {
            window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
                selectedView: 'eng',
                activeGroupId: 'group-alpha',
                selectedSprint: sprintId,
                showPlanning: false,
            }));
        }
    }, { sprintId, selectedTaskKeys, engMode, selectionMode, principal, capturedAtOffsetMs, settingsOpen, settingsTab, seedUiPrefs, seedRecoveryAttempt, sharedDraft });
}

async function openFuturePlanning(page) {
    await selectSprint(page, futureSprintName);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    // Planning is the Table only (#323).
    await expect(page.locator('.planning-review-table tbody tr').filter({ has: page.getByRole('link', { name: 'PLAN-EPIC', exact: true }) })).toBeVisible();
}

async function selectSprint(page, sprintName) {
    const sprintDropdown = page.locator('.sprint-dropdown').first();
    const sprintToggle = sprintDropdown.locator('.sprint-dropdown-toggle');
    await expect(sprintToggle).toHaveAttribute('aria-disabled', 'false');
    if ((await sprintToggle.textContent() || '').includes(sprintName)) {
        return;
    }
    await sprintToggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: sprintName }).click();
}

// The overview summary ("N stories · X SP · ...") holds the counts the List's selected stat held (#323).
function selectedStat(page) {
    return page.locator('.planning-panel.open .planning-stats.compact').first();
}
const planned = (count, sp) => new RegExp(`^${count} ${count === 1 ? 'story' : 'stories'} · ${sp.replace('.', '\\.')} SP`);

function storyCheckbox(page, key) {
    return page.getByRole('checkbox', { name: `Select ${key}`, exact: true });
}
const storyRow = (page, key) => page.locator(`.planning-review-table tbody tr[data-issue-key="${key}"]`);
async function showStoryRows(page) {
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await expect(page.locator('.planning-review-table tbody tr[data-row-kind="story"]').first()).toBeVisible();
}
const planNote = page => page.locator('.planning-panel .planning-actions > .planning-review-state-note');
async function savePlan(page) {
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
}
const allFuture = { [futureSprintId]: ['PLAN-1', 'PLAN-2', 'PLAN-3'] };
const firstFuture = { [futureSprintId]: ['PLAN-1'] };

// The Table row of a Story: its selection checkbox, Story Points cell and row treatment.
async function planningRowLayout(page, key) {
    return storyRow(page, key).evaluate((row) => {
        const box = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, centerY: rect.y + rect.height / 2 }; };
        const cell = row.querySelector('td.planning-review-selection');
        const checkbox = cell?.querySelector('input[type=checkbox]');
        const points = row.querySelector('td.planning-review-storyPoints');
        const style = getComputedStyle(row);
        return {
            className: row.className,
            checkboxInSelectionCell: Boolean(checkbox),
            checkboxAriaLabel: checkbox?.getAttribute('aria-label') || '',
            checkboxChecked: Boolean(checkbox?.checked),
            checkbox: checkbox ? box(checkbox) : null,
            cell: cell ? box(cell) : null,
            row: box(row),
            points: points ? box(points) : null,
            backgroundColor: style.backgroundColor,
            boxShadow: style.boxShadow,
            documentClientWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
        };
    });
}

test('Team selector uses saved names before tasks load and keeps them during Refresh', async ({ page }, testInfo) => {
    const { calls, releaseConfig } = await installPlanningFixture(page, { delayConfig: true });
    await page.addInitScript(() => {
        const key = 'jira_dashboard_ui_prefs_v1';
        localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), selectedTeams: ['team-alpha'] }));
    });
    let catalogReads = 0;
    await page.route('**/api/team-catalog?*', route => {
        catalogReads += 1;
        return json(route, { catalog: { 'team-alpha': { id: 'team-alpha', name: 'Alpha Team' } }, meta: {} });
    });
    let releaseTasks;
    let taskGate = new Promise(resolve => { releaseTasks = resolve; });
    let pendingTasks = 0;
    await page.route('**/api/tasks-with-team-name?*', async route => {
        pendingTasks += 1;
        await taskGate;
        return route.fallback();
    });
    await page.goto(appBaseUrl);
    await expectConfigBootstrapHoldsJiraWork(page, () => calls.map(call => call.pathname));
    expect(catalogReads).toBe(0);
    releaseConfig();
    const toggle = page.locator('.team-dropdown-toggle').first();
    const label = toggle.locator('.team-dropdown-selection-label');
    await expect.poll(() => pendingTasks).toBeGreaterThan(0);
    await expect(toggle).toBeVisible();
    await expect(label).toHaveText('Alpha Team');
    await page.screenshot({ path: testInfo.outputPath('team-selector-loading.png'), animations: 'disabled' });
    expect(catalogReads).toBe(1);
    expect(calls.filter(call => call.pathname === '/api/teams')).toHaveLength(0);

    releaseTasks();
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true });
    await expect(refresh).toBeEnabled();
    await expect(label).toHaveText('Alpha Team');
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).check();
    taskGate = new Promise(resolve => { releaseTasks = resolve; });
    const initialPending = pendingTasks;
    await refresh.click();
    await expect.poll(() => pendingTasks).toBeGreaterThan(initialPending);
    await expect(label).toHaveText('Alpha Team');
    await page.screenshot({ path: testInfo.outputPath('team-selector-refreshing.png'), animations: 'disabled' });
    releaseTasks();
    await expect(refresh).toBeEnabled();
    await expect(label).toHaveText('Alpha Team');
    await toggle.click();
    await expect(page.locator('.team-dropdown-option', { hasText: 'Alpha Team' })).toBeVisible();
});

test('Team selector retains task-derived names when the directory contains only an ID placeholder', async ({ page }) => {
    await installPlanningFixture(page);
    let catalogReads = 0;
    await page.route('**/api/team-catalog?*', route => {
        catalogReads += 1;
        return json(route, { catalog: { 'team-alpha': { id: 'team-alpha', name: 'team-alpha' } }, meta: {} });
    });
    await page.goto(appBaseUrl);
    const toggle = page.locator('.team-dropdown-toggle').first();
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true });
    await expect(refresh).toBeEnabled();
    await expect.poll(() => catalogReads).toBe(1);
    await toggle.click();
    await page.locator('.team-dropdown-option', { hasText: 'Alpha Team' }).locator('input').check();
    await toggle.locator('input').press('Escape');
    const label = toggle.locator('.team-dropdown-selection-label');
    await expect(label).toHaveText('Alpha Team');
    let releaseTasks;
    const taskGate = new Promise(resolve => { releaseTasks = resolve; });
    let pendingTasks = 0;
    await page.route('**/api/tasks-with-team-name?*', async route => {
        pendingTasks += 1;
        await taskGate;
        return route.fallback();
    });
    await refresh.click();
    await expect.poll(() => pendingTasks).toBeGreaterThan(0);
    await expect(label).toHaveText('Alpha Team');
    releaseTasks();
    await expect(refresh).toBeEnabled();
    await expect(label).toHaveText('Alpha Team');
});

// The old default selection is gone (#331): a future Sprint starts with no saved plan, nothing included and Select All ready.
test('new future planning sprint starts without a saved plan and nothing selected', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);

    await expect(planNote(page)).toHaveText('No saved plan yet. Include stories to preview capacity, then save your plan.');
    for (const key of ['PLAN-1', 'PLAN-2', 'PLAN-3']) await expect(storyCheckbox(page, key)).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Select All' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Select All' })).not.toHaveClass(/active/);
});

test('Planning Jira export intersects selected stories with the active filters', async ({ page }) => {
    await installPlanningFixture(page, { plans: allFuture });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);
    await page.evaluate(() => {
        window.openedPlanningJiraUrls = [];
        window.open = url => window.openedPlanningJiraUrls.push(String(url));
    });
    const exportButton = page.getByRole('button', { name: 'Open planned stories in Jira', exact: true });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const statusOptions = page.getByRole('group', { name: 'Status', exact: true });
    await statusOptions.getByRole('button', { name: /to do/i }).click();
    await statusOptions.getByRole('button', { name: /pending/i }).click();
    await page.keyboard.press('Escape');
    await expect(storyRow(page, 'PLAN-1')).toHaveCount(0);
    await exportButton.click();
    const jql = await page.evaluate(() => new URL(window.openedPlanningJiraUrls.at(-1)).searchParams.get('jql'));
    expect(jql).toBe('key in (PLAN-3)');
    await storyCheckbox(page, 'PLAN-3').uncheck();
    await expect(exportButton).toBeDisabled();
});

test('Planning Jira export follows Team, search, priority and Sprint scope without clearing hidden selections', async ({ page }) => {
    const betaStory = makeStory('PLAN-6', 'To Do');
    betaStory.fields.teamId = 'team-beta';
    betaStory.fields.teamName = 'Beta Team';
    const minorStory = makeStory('PLAN-7', 'To Do');
    minorStory.fields.priority = { name: 'Minor' };
    await installPlanningFixture(page, {
        futureIssues: [...futureStories, betaStory, minorStory],
        configuredTeamIds: ['team-alpha', 'team-beta'],
        plans: { [futureSprintId]: ['PLAN-1', 'PLAN-2', 'PLAN-3', 'PLAN-6', 'PLAN-7'], [secondFutureSprintId]: ['PLAN-4', 'PLAN-5'] },
    });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);
    await page.evaluate(() => {
        window.openedPlanningJiraUrls = [];
        window.open = url => window.openedPlanningJiraUrls.push(String(url));
    });
    const storyRows = page.locator('.planning-review-table tbody tr[data-row-kind="story"]');
    const exportButton = page.getByRole('button', { name: 'Open planned stories in Jira', exact: true });
    const expectExport = async keys => {
        await exportButton.click();
        expect(await page.evaluate(() => new URL(window.openedPlanningJiraUrls.at(-1)).searchParams.get('jql')))
            .toBe(`key in (${keys.join(', ')})`);
    };
    await searchInput(page).fill('PLAN-1');
    await expect(storyRows).toHaveCount(1);
    await expectExport(['PLAN-1']);
    await searchInput(page).fill('no-matching-story');
    await expect(exportButton).toBeDisabled();
    await searchInput(page).fill('');
    await expect(storyRows).toHaveCount(5);
    await expectExport(['PLAN-1', 'PLAN-2', 'PLAN-3', 'PLAN-6', 'PLAN-7']);

    const teams = page.locator('.team-dropdown').first();
    await teams.locator('.team-dropdown-toggle').click();
    await teams.locator('.team-dropdown-option', { hasText: 'Alpha Team' }).locator('input').check();
    await page.keyboard.press('Escape');
    await expect(storyRow(page, 'PLAN-6')).toHaveCount(0);
    await expectExport(['PLAN-1', 'PLAN-2', 'PLAN-3', 'PLAN-7']);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('group', { name: 'Priority', exact: true }).getByRole('button', { name: /minor/i }).click();
    await page.keyboard.press('Escape');
    await expect(storyRow(page, 'PLAN-7')).toHaveCount(0);
    await expectExport(['PLAN-1', 'PLAN-2', 'PLAN-3']);
    await storyCheckbox(page, 'PLAN-2').uncheck();
    await expectExport(['PLAN-1', 'PLAN-3']);
    // A plan draft guards the scope (#331): save it before the Sprint changes.
    await savePlan(page);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.compact-sticky-header')).not.toHaveClass(/is-visible/);
    await selectSprint(page, secondFutureSprintName);
    await showStoryRows(page);
    await expect(storyRow(page, 'PLAN-4')).toBeVisible();
    await expectExport(['PLAN-4', 'PLAN-5']);
});

test('Planning Jira export uses filtered Story keys in Table layout', async ({ page }, testInfo) => {
    await installPlanningFixture(page, { plans: allFuture });
    // Planning has no List toggle (2026-11-06): the Table layout comes from the saved preference.
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({})));
    await page.goto(appBaseUrl);
    await selectSprint(page, futureSprintName);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-review-table')).toBeVisible();
    await page.evaluate(() => {
        window.openedPlanningJiraUrls = [];
        window.open = url => window.openedPlanningJiraUrls.push(String(url));
    });
    const exportButton = page.locator('.planning-panel').getByRole('button', { name: 'Open planned stories in Jira', exact: true });
    await searchInput(page).fill('PLAN-2');
    await expect(page.locator('.filterbar-wrap')).toContainText('1');
    await exportButton.click();
    expect(await page.evaluate(() => new URL(window.openedPlanningJiraUrls.at(-1)).searchParams.get('jql')))
        .toBe('key in (PLAN-2)');
    await page.locator('.planning-panel.open').screenshot({ path: testInfo.outputPath('filtered-export-enabled.png'), animations: 'disabled' });
    await searchInput(page).fill('no-matching-story');
    await expect(exportButton).toBeDisabled();
    await page.locator('.planning-panel.open').screenshot({ path: testInfo.outputPath('filtered-export-disabled.png'), animations: 'disabled' });
});

// The capsule is version 2 (#331): it carries the scope and the plan draft over the saved plan, never Story keys or payloads.
test('auth lock captures only the latest safe dashboard and Planning snapshot', async ({ page }) => {
    await installPlanningFixture(page, { plans: allFuture });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);
    await storyCheckbox(page, 'PLAN-2').click();
    await expect(selectedStat(page)).toHaveText(planned(2, '2.0'));

    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('jep:authentication-required'));
    });

    await expect.poll(() => page.evaluate(() => {
        const raw = window.sessionStorage.getItem('jira_dashboard_auth_resume_v1');
        return raw ? JSON.parse(raw) : null;
    })).toMatchObject({
        version: 2,
        principal: { workspaceId: 'workspace-test', viewConfigId: 'view-test' },
        view: {
            selectedView: 'eng',
            activeGroupId: 'group-alpha',
            selectedSprint: String(futureSprintId),
            engMode: 'planning',
            settingsOpen: false,
            settingsTab: 'scope',
        },
        planning: {
            scope: { workspaceId: 'workspace-test', groupId: 'group-alpha', sprintId: String(futureSprintId), namespaceId: null },
            draft: { inclusionChanges: [{ issueId: storyId('PLAN-2'), included: false, baseRevision: 1 }], basePlanRevision: 1 },
            submission: null,
            selectedTeams: ['all'],
        },
    });
    const storedKeys = await page.evaluate(() => {
        const value = JSON.parse(window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'));
        return {
            top: Object.keys(value).sort(),
            principal: Object.keys(value.principal).sort(),
            view: Object.keys(value.view).sort(),
            planning: Object.keys(value.planning).sort(),
            raw: JSON.stringify(value),
        };
    });
    expect(storedKeys.top).toEqual(['capturedAt', 'planning', 'principal', 'version', 'view']);
    expect(storedKeys.principal).toEqual(['viewConfigId', 'workspaceId']);
    expect(storedKeys.view).toEqual(['activeGroupId', 'engMode', 'selectedSprint', 'selectedView', 'settingsOpen', 'settingsTab']);
    expect(storedKeys.planning).toEqual(['draft', 'scope', 'selectedTeams', 'submission']);
    expect(storedKeys.raw).not.toContain('summary');
    expect(storedKeys.raw).not.toContain('response');
    expect(storedKeys.raw).not.toContain('token');
});

// The saved plan includes PLAN-1; the capsule's draft removes it and includes PLAN-2.
const swapDraft = [{ key: 'PLAN-1', included: false, baseRevision: 1 }, { key: 'PLAN-2', included: true, baseRevision: 0 }];

test('matching auth resume overrides shared Planning state after exact-scope hydration', async ({ page }) => {
    await seedPlanningAuthResume(page, { draft: swapDraft });
    await installPlanningFixture(page, { plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.sprint-dropdown-toggle').first()).toContainText(futureSprintName);
    await expect(selectedStat(page)).toHaveText(planned(1, '1.0'));
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).not.toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).toBeChecked();
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
});

test('a principal-mismatched capsule is rejected before shell or Planning restore', async ({ page }) => {
    await seedPlanningAuthResume(page, {
        principal: { workspaceId: 'workspace-other', viewConfigId: 'view-other' }, draft: swapDraft,
    });
    await installPlanningFixture(page, { plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.locator('.planning-panel.open')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await openFuturePlanning(page);
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).not.toBeChecked();
});

test('an expired capsule is pruned before shell or Planning restore', async ({ page }) => {
    await seedPlanningAuthResume(page, { capturedAtOffsetMs: -(30 * 60 * 1000 + 1), draft: swapDraft });
    await installPlanningFixture(page, { plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.locator('.planning-panel.open')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await openFuturePlanning(page);
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).not.toBeChecked();
});

// A recovered draft can name a Story the server no longer admits (#331): the draft is kept and the tab asks for a recovery choice.
test('a recovered draft naming an unavailable Story keeps the draft and blocks Save until recovery', async ({ page }) => {
    await seedPlanningAuthResume(page, { draft: [...swapDraft, { key: 'PLAN-999', included: true, baseRevision: 0 }] });
    await installPlanningFixture(page, { plans: firstFuture, unavailableKeys: ['PLAN-999'] });
    await page.goto(appBaseUrl);

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).not.toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).toBeChecked();
    await expect(storyRow(page, 'PLAN-999')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await expect(page.getByRole('alert').filter({ hasText: 'Shared values changed or are no longer available after recovery. Your draft is preserved.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Load current and discard draft', exact: true })).toBeEnabled();
});

test('Connections Settings reopens after recovery on the Connections tab', async ({ page }) => {
    await installPlanningFixture(page);
    await page.route('**/api/auth/status', route => json(route, {
        authMode: 'atlassian_oauth',
        authenticated: true,
        email: 'profile@example.test',
        profile: { email: 'profile@example.test' },
    }));
    await page.goto(appBaseUrl);
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const settings = page.getByRole('dialog').first();
    await settings.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(settings.getByRole('button', { name: 'Connections', exact: true })).toHaveClass(/active/);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('jep:authentication-required')));
    await expect.poll(() => page.evaluate(() => {
        const raw = window.sessionStorage.getItem('jira_dashboard_auth_resume_v1');
        return raw ? JSON.parse(raw) : null;
    })).toMatchObject({
        view: { settingsOpen: true, settingsTab: 'connections' },
    });

    await page.reload();
    const restoredSettings = page.getByRole('dialog').first();
    await expect(restoredSettings).toBeVisible();
    await expect(restoredSettings.getByRole('button', { name: 'Connections', exact: true })).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
});

// The local Planning persistence is gone (#331); what remains is that a restore is not an Undo step.
test('a restored Planning draft is not an Undo step and later gestures still undo', async ({ page }) => {
    await seedPlanningAuthResume(page, { draft: swapDraft });
    await installPlanningFixture(page, { plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-2')).toBeChecked();
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

    await page.getByRole('button', { name: 'Include by status' }).click();
    await page.getByRole('button', { name: /^Include all Accepted \+ In Progress/ }).click();
    await page.keyboard.press('Escape');
    await expect(selectedStat(page)).toHaveText(planned(2, '2.0'));
    await expect(storyCheckbox(page, 'PLAN-2')).toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-3')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(selectedStat(page)).toHaveText(planned(1, '1.0'));
    await expect(storyCheckbox(page, 'PLAN-3')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

// Default-all selection is gone (#331): a historical version-1 capsule resumes the shell and Teams, never a Story selection.
test('a version-1 default-all capsule resumes the shell but leaves the saved plan as it is', async ({ page }) => {
    await seedPlanningAuthResume(page, { selectedTaskKeys: ['PLAN-2', 'PLAN-3'], selectionMode: 'default_all' });
    await installPlanningFixture(page, { plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.sprint-dropdown-toggle').first()).toContainText(futureSprintName);
    await expect(selectedStat(page)).toHaveText(planned(1, '1.0'));
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).not.toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-3')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
});

// A shared-plan draft is retained when its Stories cannot load (#331): the tab says so, and the next document restores it.
test('non-auth Planning hydration failure retains the recovered draft and restores it on reload', async ({ page }) => {
    await seedPlanningAuthResume(page, { seedRecoveryAttempt: true, draft: swapDraft });
    const fixture = await installPlanningFixture(page, { taskFailureMode: 'non-auth-once', plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect.poll(() => page.evaluate(() => {
        const raw = window.localStorage.getItem('jira_dashboard_auth_recovery_success_v1');
        return raw ? JSON.parse(raw) : null;
    })).toMatchObject({ attemptId: 'attempt-planning-hydration' });
    await expect(page.getByText(/Failed to load tasks:/)).toBeVisible();
    await expect(page.getByText('Plan recovery could not load its stories. Your changes are retained in this tab.')).toBeVisible();
    expect(await page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).not.toBe(null);
    expect(fixture.getFutureProductTaskAttempts()).toBe(1);

    await page.reload();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(selectedStat(page)).toHaveText(planned(1, '1.0'));
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).not.toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).toBeChecked();
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    expect(fixture.getFutureProductTaskAttempts()).toBeGreaterThan(1);
});

test('a new typed auth interruption retains the staged Planning capsule', async ({ page }) => {
    await seedPlanningAuthResume(page, { draft: swapDraft });
    await installPlanningFixture(page, { taskFailureMode: 'auth-required', plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).not.toBe(null);
    const staged = await page.evaluate(() => JSON.parse(
        window.sessionStorage.getItem('jira_dashboard_auth_resume_v1')
    ).planning.draft.inclusionChanges);
    expect(staged).toEqual(swapDraft.map(({ key, included, baseRevision }) => ({ issueId: storyId(key), included, baseRevision })));
});

test('late authenticated config staging holds Jira work, then resumes shell and exact-scope Planning on release', async ({ page }) => {
    await seedPlanningAuthResume(page, { seedUiPrefs: true, draft: swapDraft });
    const fixture = await installPlanningFixture(page, { delayConfig: true, plans: firstFuture });
    await page.goto(appBaseUrl);

    await expectConfigBootstrapHoldsJiraWork(page, () => fixture.calls.map(call => call.pathname));
    expect(fixture.getFutureProductTaskAttempts()).toBe(0);
    fixture.releaseConfig();

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(selectedStat(page)).toHaveText(planned(1, '1.0'));
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-1')).not.toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-2')).toBeChecked();
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
});

test('typed auth during a shell dependency keeps the capsule for the next document', async ({ page }) => {
    await seedPlanningAuthResume(page, { engMode: 'catch-up' });
    const fixture = await installPlanningFixture(page, { shellAuthDependency: 'epm-access' });
    await page.goto(appBaseUrl);

    await expect.poll(() => fixture.calls.some(call => call.pathname === '/api/projects/selected')).toBe(true);
    fixture.releaseShellAuth();

    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const raw = window.sessionStorage.getItem('jira_dashboard_auth_resume_v1');
        if (!raw) return null;
        const capsule = JSON.parse(raw);
        return {
            activeGroupId: capsule.view.activeGroupId,
            selectedSprint: capsule.view.selectedSprint,
            selectedTaskKeys: capsule.planning.selectedTaskKeys,
        };
    })).toEqual({
        activeGroupId: 'group-alpha',
        selectedSprint: String(futureSprintId),
        selectedTaskKeys: ['PLAN-2'],
    });
});

// A version-2 draft for a completed Sprint is not restored (#331): the shell falls back to Catch Up and the saved plan is untouched.
test('completed recovered Planning sprint falls back without overwriting persisted selection', async ({ page }) => {
    await seedPlanningAuthResume(page, { sprintId: completedSprintId, draft: swapDraft });
    const fixture = await installPlanningFixture(page, { plans: { [completedSprintId]: ['PLAN-1'] } });
    await page.goto(appBaseUrl);

    await expect(page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' })).toBeChecked();
    await expect(page.locator('.planning-panel.open')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await page.waitForLoadState('networkidle');
    expect(fixture.calls.filter(call => call.method === 'PATCH' && /\/review$/.test(call.pathname))).toEqual([]);
});

// Onboarding skips Sprint discovery, so a staged shell recovery is dropped without any plan write.
test('onboarding terminalizes staged recovery when sprint discovery is skipped', async ({ page }) => {
    await seedPlanningAuthResume(page);
    const fixture = await installPlanningFixture(page, { delayConfig: true, onboardingRequired: true, plans: firstFuture });
    await page.goto(appBaseUrl);

    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    expect(fixture.calls.some(call => call.pathname === '/api/sprints')).toBe(false);
    fixture.releaseConfig();

    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await page.waitForLoadState('networkidle');
    expect(fixture.calls.filter(call => call.method === 'PATCH' && /\/review$/.test(call.pathname))).toEqual([]);
});

test('onboarding waits for delayed config and Home auth before deciding capsule abandonment', async ({ page }) => {
    await seedPlanningAuthResume(page);
    const fixture = await installPlanningFixture(page, {
        delayConfig: true,
        shellAuthDependency: 'epm-access',
        onboardingRequired: true,
    });
    await page.goto(appBaseUrl);

    await expect(page.getByRole('dialog', { name: 'Choose your Department' })).toBeVisible();
    fixture.releaseConfig();
    await expect.poll(() => fixture.calls.some(call => call.pathname === '/api/projects/selected')).toBe(true);
    fixture.releaseShellAuth();

    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const raw = window.sessionStorage.getItem('jira_dashboard_auth_resume_v1');
        if (!raw) return null;
        const capsule = JSON.parse(raw);
        return {
            activeGroupId: capsule.view.activeGroupId,
            selectedSprint: capsule.view.selectedSprint,
            selectedTaskKeys: capsule.planning.selectedTaskKeys,
        };
    })).toEqual({
        activeGroupId: 'group-alpha',
        selectedSprint: String(futureSprintId),
        selectedTaskKeys: ['PLAN-2'],
    });
});

// Planning is the Table only (#323): the Story row's selection checkbox sits in its own first column, level with the row.
test('planning story selection controls align with story-point metadata', async ({ page }) => {
    await installPlanningFixture(page, { plans: allFuture });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);

    const layout = await planningRowLayout(page, 'PLAN-1');
    expect(layout.checkboxInSelectionCell).toBe(true);
    expect(layout.checkboxAriaLabel).toBe('Select PLAN-1');
    expect(layout.checkboxChecked).toBe(true);
    expect(layout.points).toBeTruthy();
    expect(layout.checkbox.right).toBeLessThanOrEqual(layout.points.x);
    expect(Math.abs(layout.checkbox.centerY - layout.points.centerY)).toBeLessThanOrEqual(4);
    expect(Math.abs(layout.checkbox.centerY - layout.row.centerY)).toBeLessThanOrEqual(4);
    expect(layout.checkbox.x).toBeGreaterThanOrEqual(layout.cell.x);
    expect(layout.checkbox.right).toBeLessThanOrEqual(layout.cell.right);
    expect(layout.checkbox.height).toBeLessThanOrEqual(layout.cell.height);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
});

test('planning story checkbox toggles state without changing row treatment', async ({ page }) => {
    await installPlanningFixture(page, { plans: allFuture });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);

    await storyCheckbox(page, 'PLAN-2').click();
    await page.waitForTimeout(250);
    const unselected = await planningRowLayout(page, 'PLAN-2');
    expect(unselected.checkboxChecked).toBe(false);

    await storyCheckbox(page, 'PLAN-2').click();
    await page.waitForTimeout(250);
    const selected = await planningRowLayout(page, 'PLAN-2');
    expect(selected.checkboxChecked).toBe(true);
    expect(selected.className).toBe(unselected.className);
    expect(selected.backgroundColor).toBe(unselected.backgroundColor);
    expect(selected.boxShadow).toBe(unselected.boxShadow);
    expect(selected.row.height).toBe(unselected.row.height);
});

// Selection is saved with the shared plan (#331), not in the browser: a saved edit survives reloads until Select All replaces it.
test('manual future planning checkbox edits persist until Select All is clicked', async ({ page }) => {
    await installPlanningFixture(page, { plans: allFuture });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    await showStoryRows(page);

    await storyCheckbox(page, 'PLAN-2').click();
    await expect(selectedStat(page)).toHaveText(planned(2, '2.0'));
    await savePlan(page);
    await page.reload();
    await openFuturePlanning(page);
    await expect(selectedStat(page)).toHaveText(planned(2, '2.0'));

    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(selectedStat(page)).toHaveText(planned(3, '3.0'));
    await savePlan(page);
    await page.reload();
    await openFuturePlanning(page);
    await expect(selectedStat(page)).toHaveText(planned(3, '3.0'));
});

test('planning undo restores loaded selection after a bulk status action', async ({ page }) => {
    await installPlanningFixture(page, { plans: allFuture });
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await expect(selectedStat(page)).toHaveText(planned(3, '3.0'));
    // The bulk status action lives in the Include by status popover; Accepted is grouped with In Progress.
    await page.getByRole('button', { name: 'Include by status' }).click();
    await page.getByRole('button', { name: /^Remove all Accepted \+ In Progress/ }).click();
    await page.keyboard.press('Escape');
    await expect(selectedStat(page)).toHaveText(planned(2, '2.0'));
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(selectedStat(page)).toHaveText(planned(3, '3.0'));
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

// Each future Sprint has its own shared plan (#331): Select All saved in one Sprint never includes another Sprint's Stories.
test('select all remains scoped when switching future planning sprints', async ({ page }) => {
    const fixture = await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(selectedStat(page)).toHaveText(planned(3, '3.0'));
    await savePlan(page);
    await selectSprint(page, secondFutureSprintName);
    await expect(page.locator('.planning-review-table tbody tr').filter({ has: page.getByRole('link', { name: 'PLAN-EPIC-2', exact: true }) })).toBeVisible();
    await expect(planNote(page)).toHaveText('No saved plan yet. Include stories to preview capacity, then save your plan.');
    await showStoryRows(page);
    await expect(storyCheckbox(page, 'PLAN-4')).not.toBeChecked();
    await expect(storyCheckbox(page, 'PLAN-5')).not.toBeChecked();

    const saves = fixture.calls.filter(call => call.method === 'PATCH' && /\/review$/.test(call.pathname));
    expect(saves.map(call => call.pathname)).toEqual([`/api/eng/sprints/${futureSprintId}/review`]);
    expect(saves[0].body.inclusionChanges.map(change => change.issueId).sort()).toEqual(['PLAN-1', 'PLAN-2', 'PLAN-3'].map(storyId));

    await selectSprint(page, futureSprintName);
    await expect(selectedStat(page)).toHaveText(planned(3, '3.0'));
});

// Planning is the Table only (#323): the Epic capacity control is the optional Capacity column (hidden by default); its hover
// treatment is pinned in design_system_hover_eng.spec.js.
test('planning epic excluded-capacity toggle updates shared group config', async ({ page }, testInfo) => {
    const fixture = await installPlanningFixture(page);
    // Showing an optional column is a review-editing control: serve a saving-capable shared review.
    const review = createPlanningReviewMock();
    const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(review.response(route.request(), body)) });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => reply(route, { schemaVersion: 1, schemaRevision: 0, columns: [], layouts: {}, capabilities: { canRead: true, canSave: true } }));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => reply(route, { cells: [], unavailableIssueIds: [] }));
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);
    const showCapacityColumn = async () => {
        await page.getByRole('button', { name: '+ Add column', exact: true }).click();
        await page.getByRole('dialog', { name: 'Add review column', exact: true }).getByRole('button', { name: 'Capacity', exact: true }).click();
        await page.keyboard.press('Escape');
    };
    await showCapacityColumn();

    const epicRow = page.locator('.planning-review-table tbody tr').filter({ has: page.getByRole('link', { name: 'PLAN-EPIC', exact: true }) }).first();
    const included = epicRow.getByRole('button', { name: /Included/ });
    await included.hover();
    await expect(included).toHaveCSS('transform', 'none');
    // The Table chip keeps its light Included fill and readable ink and draws the inset hover ring inside the clipped cell.
    await expect(included).toHaveCSS('background-color', 'rgb(236, 253, 245)');
    await expect(included).toHaveCSS('color', 'rgb(22, 101, 52)');
    await expect.poll(() => included.evaluate(node => getComputedStyle(node).boxShadow)).toMatch(/inset/);
    await epicRow.screenshot({ path: testInfo.outputPath('included-hover.png') });
    await included.click();
    await expect(epicRow.getByRole('button', { name: /Excluded/ })).toBeVisible();

    const saveCalls = fixture.calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].body.baseRevision).toBe(1);
    expect(saveCalls[0].body.groups[0].excludedCapacityEpics).toEqual(['PLAN-EPIC']);
    expect(fixture.getGroupsConfig().groups[0].excludedCapacityEpics).toEqual(['PLAN-EPIC']);

    await page.reload();
    await openFuturePlanning(page);
    await showCapacityColumn();
    await expect(epicRow.getByRole('button', { name: /Excluded/ })).toBeVisible();
});

async function seedSearchPrefs(page, searchQuery) {
    await page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ searchQuery: value }));
    }, searchQuery);
}

function searchInput(page) {
    return page.getByRole('textbox', { name: 'Find in view' }).first();
}

async function storedSearchQuery(page) {
    return page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}').searchQuery);
}

test('a persisted search term is shown on load', async ({ page }) => {
    await installPlanningFixture(page);
    await seedSearchPrefs(page, 'persisted-term');
    await page.goto(appBaseUrl);
    await expect(searchInput(page)).toHaveValue('persisted-term');
});

test('a search term cleared before a sprint change is not restored', async ({ page }) => {
    await installPlanningFixture(page);
    await seedSearchPrefs(page, 'stale-term');
    await page.goto(appBaseUrl);
    await expect(searchInput(page)).toHaveValue('stale-term');

    await searchInput(page).fill('');
    await expect.poll(() => storedSearchQuery(page)).toBe('');
    await selectSprint(page, futureSprintName);
    await expect(page.locator('.sprint-dropdown-toggle').first()).toContainText(futureSprintName);
    await expect(searchInput(page)).toHaveValue('');
    await selectSprint(page, secondFutureSprintName);
    await expect(page.locator('.sprint-dropdown-toggle').first()).toContainText(secondFutureSprintName);
    await expect(searchInput(page)).toHaveValue('');
    expect(await storedSearchQuery(page)).toBe('');
});

test('a typed search term survives a sprint change', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await selectSprint(page, activeSprintName);

    await searchInput(page).fill('kept-term');
    await expect.poll(() => storedSearchQuery(page)).toBe('kept-term');
    await selectSprint(page, futureSprintName);
    await expect(page.locator('.sprint-dropdown-toggle').first()).toContainText(futureSprintName);
    await expect(searchInput(page)).toHaveValue('kept-term');
    expect(await storedSearchQuery(page)).toBe('kept-term');
});
