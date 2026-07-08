const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    installDashboardShell,
    installDashboardFixture,
} = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
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
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

function makeStory(key, status, sprintId, sprintName, epicKey = 'PROD-EPIC') {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic story`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 1,
            epicKey,
            parentSummary: 'Synthetic product epic',
            projectKey: 'PROD',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: sprintId === activeSprintId ? 'active' : 'future' }],
            subtaskSummary: key === 'PROD-1'
                ? { total: 2, done: 0, inProgress: 1, waiting: 1, percentComplete: 0, statusCounts: { 'To Do': 1, 'In Progress': 1 } }
                : null,
        },
    };
}

function makeEpic(sprintId, sprintName) {
    return {
        key: 'PROD-EPIC',
        summary: 'Synthetic product epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: sprintId === activeSprintId ? 'active' : 'future' }],
    };
}

function subtaskPayload(sprintId) {
    return {
        parentKey: 'PROD-1',
        sprint: String(sprintId),
        cached: false,
        summary: { total: 2, done: 0, inProgress: 1, waiting: 1, percentComplete: 0, statusCounts: { 'To Do': 1, 'In Progress': 1 } },
        subtasks: [
            { id: 'S-A', key: 'PROD-1-A', summary: 'Subtask A', status: { name: 'To Do' }, assignee: { displayName: 'Sub Owner' }, updated: '2026-05-01T00:00:00.000+0000' },
            { id: 'S-B', key: 'PROD-1-B', summary: 'Subtask B', status: { name: 'In Progress' }, assignee: { displayName: 'Sub Owner' }, updated: '2026-05-02T00:00:00.000+0000' },
        ],
    };
}

const defaultOptionsBody = {
    issues: [{ key: 'PROD-1', issueType: 'Story', currentStatus: 'To Do', transitions: [{ name: 'Start Progress', toStatus: 'In Progress' }] }],
    targetStatuses: [
        { name: 'In Progress', availableCount: 1, blockedCount: 0 },
        { name: 'Accepted', availableCount: 1, blockedCount: 0 },
        { name: 'Done', availableCount: 1, blockedCount: 0 },
    ],
};

function successTransition(body) {
    const keys = body?.issueKeys || [];
    return {
        requested: keys.length,
        succeeded: keys.length,
        failed: 0,
        targetStatus: body?.targetStatus || '',
        results: keys.map((key) => ({ key, result: 'success', fromStatus: 'To Do', toStatus: body?.targetStatus || '' })),
    };
}

function partialTransition(body) {
    const keys = body?.issueKeys || [];
    return {
        requested: keys.length,
        succeeded: 1,
        failed: Math.max(0, keys.length - 1),
        targetStatus: body?.targetStatus || '',
        results: keys.map((key, index) => (index === 0
            ? { key, result: 'success', fromStatus: 'To Do', toStatus: body?.targetStatus || '' }
            : { key, result: 'failure', error: 'transition_not_available', currentStatus: 'To Do' })),
    };
}

// Installs the ENG Catch Up / Planning fixture. `options`/`transitions` let a test
// override the transition option and mutation responses. All fixtures are synthetic.
async function installEngStatusFixture(page, {
    optionsStatus = 200,
    optionsBody = defaultOptionsBody,
    transitions = successTransition,
} = {}) {
    const calls = [];
    const groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{ id: 'group-alpha', name: 'Alpha Department', teamIds: groupTeamIds, labels: ['alpha_label'], excludedCapacityEpics: [] }],
        preferences: {
            onboardingRequired: false,
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
        const body = request.method() === 'POST' ? requestBody(request) : null;
        calls.push({ method: request.method(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()), body });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/me/connections/home-token') {
            return json(route, { connected: false, provider: 'atlassian_user_api_token', status: 'missing', needsReconnect: false });
        }
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                authMode: 'atlassian_oauth',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') return json(route, groupsConfigPayload);
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') return json(route, groupsConfigPayload);
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [
                    { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                    { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const sprint = Number(url.searchParams.get('sprint')) || activeSprintId;
            const sprintName = sprint === futureSprintId ? futureSprintName : activeSprintName;
            const issues = project === 'product' && !purpose
                ? [makeStory('PROD-1', 'To Do', sprint, sprintName), makeStory('PROD-2', 'To Do', sprint, sprintName)]
                : [];
            const epic = makeEpic(sprint, sprintName);
            return json(route, {
                issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/issues/subtasks') return json(route, subtaskPayload(Number(url.searchParams.get('sprint')) || activeSprintId));
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/issues/transitions/options') {
            const payload = typeof optionsBody === 'function' ? optionsBody(body) : optionsBody;
            return json(route, payload, optionsStatus);
        }
        if (url.pathname === '/api/issues/transitions') {
            return json(route, transitions(body));
        }
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return { calls };
}

async function setPrefs(page, prefs) {
    await page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value));
    }, prefs);
}

function catchUpPrefs(extra = {}) {
    return { selectedView: 'eng', selectedSprint: activeSprintId, sprintName: activeSprintName, activeGroupId: 'group-alpha', showPlanning: false, showStats: false, showScenario: false, ...extra };
}

function trigger(page, kind, key) {
    return page.locator(`[data-status-transition-trigger][data-issue-kind="${kind}"][data-issue-key="${key}"]`);
}

function menu(page, key) {
    return page.locator(`.status-transition-menu[data-issue-key="${key}"]`);
}

function transitionCalls(calls) {
    return calls.filter(call => call.method === 'POST' && call.pathname === '/api/issues/transitions');
}

async function openPlanning(page) {
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.task-list .epic-block', { hasText: 'PROD-EPIC' })).toBeVisible();
    // Deterministically select both stories so the composed status-target count is stable.
    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(page.locator('.planning-panel.open .planning-stat-value').first()).toContainText('2 · 2.0 SP');
}

test('Catch Up epic, story, and subtask status pills are real button triggers with no separate change-status button', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngStatusFixture(page);
    await page.goto(appBaseUrl);

    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();

    const epicPill = trigger(page, 'epic', 'PROD-EPIC');
    const storyPill = trigger(page, 'story', 'PROD-1');
    await expect(epicPill).toHaveCount(1);
    await expect(storyPill).toHaveCount(1);
    // Real native buttons (MRT020: prove the pill is a real clickable button).
    expect(await epicPill.evaluate(el => el.tagName)).toBe('BUTTON');
    expect(await storyPill.evaluate(el => el.tagName)).toBe('BUTTON');
    await expect(storyPill).toHaveClass(/status-pill/);

    // No separate "Change status" button anywhere beside the pills.
    await expect(page.getByRole('button', { name: /change status/i })).toHaveCount(0);

    // Expand subtasks and confirm the subtask pill is also a real button trigger.
    await page.locator('.task-item[data-task-key="PROD-1"] .story-subtasks-toggle').click();
    const subtaskPill = trigger(page, 'subtask', 'PROD-1-A');
    await expect(subtaskPill).toHaveCount(1);
    expect(await subtaskPill.evaluate(el => el.tagName)).toBe('BUTTON');

    // A normal (non-forced) click opens the anchored menu.
    await storyPill.click();
    await expect(menu(page, 'PROD-1')).toBeVisible();
});

test('Catch Up status change sends exactly one issue key in the mutation body', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngStatusFixture(page);
    await page.goto(appBaseUrl);

    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await trigger(page, 'story', 'PROD-1').click();
    await expect(menu(page, 'PROD-1')).toBeVisible();

    // Options are fetched for exactly the clicked issue.
    await expect.poll(() => calls.filter(c => c.pathname === '/api/issues/transitions/options').length).toBeGreaterThan(0);
    const optionsCall = calls.find(c => c.pathname === '/api/issues/transitions/options');
    expect(optionsCall.body.issueKeys).toEqual(['PROD-1']);

    const select = menu(page, 'PROD-1').locator('.status-transition-select');
    await expect(select).toBeEnabled();
    await select.selectOption({ value: 'In Progress' });
    await menu(page, 'PROD-1').locator('.status-transition-submit').click();

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    const mutation = transitionCalls(calls)[0];
    expect(mutation.body.issueKeys).toEqual(['PROD-1']);
    expect(mutation.body.targetStatus).toBe('In Progress');
});

test('Planning action bar shows target count feedback and adds no status-change button', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await openPlanning(page);

    // Two stories default-selected -> composed target count of 2, surfaced in the action bar.
    await expect(page.locator('.planning-actions .planning-status-feedback')).toContainText('2 status targets selected');
    // The action bar keeps its existing controls and adds no status-change button.
    await expect(page.getByRole('button', { name: 'Select All' })).toBeVisible();
    await expect(page.locator('.planning-actions').getByRole('button', { name: /change status/i })).toHaveCount(0);
});

test('Planning batch status change sends all selected Story, Epic, and Subtask keys in one body', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    const { calls } = await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await openPlanning(page);

    // Mark the Epic into the batch via its menu (must not toggle excluded capacity).
    await trigger(page, 'epic', 'PROD-EPIC').click();
    await menu(page, 'PROD-EPIC').locator('.status-transition-target-toggle').check();
    await page.keyboard.press('Escape');
    await expect(menu(page, 'PROD-EPIC')).toHaveCount(0);

    // Expand subtasks and mark a Subtask into the batch via its menu.
    await page.locator('.task-item[data-task-key="PROD-1"] .story-subtasks-toggle').click();
    await trigger(page, 'subtask', 'PROD-1-A').click();
    await menu(page, 'PROD-1-A').locator('.status-transition-target-toggle').check();
    await page.keyboard.press('Escape');
    await expect(menu(page, 'PROD-1-A')).toHaveCount(0);

    // Composed count is now 2 stories + 1 epic + 1 subtask = 4.
    await trigger(page, 'story', 'PROD-1').click();
    const storyMenu = menu(page, 'PROD-1');
    await expect(storyMenu.locator('.status-transition-submit')).toContainText('Apply to selected targets (4)');
    await storyMenu.locator('.status-transition-select').selectOption({ value: 'Accepted' });
    await storyMenu.locator('.status-transition-submit').click();

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    const mutation = transitionCalls(calls)[0];
    expect([...mutation.body.issueKeys].sort()).toEqual(['PROD-1', 'PROD-1-A', 'PROD-2', 'PROD-EPIC']);
    expect(mutation.body.targetStatus).toBe('Accepted');
});

test('Planning epic status target does not toggle excluded capacity', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    const { calls } = await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await openPlanning(page);

    const epicBlock = page.locator('.task-list .epic-block', { hasText: 'PROD-EPIC' }).first();
    await expect(epicBlock.getByRole('button', { name: /Included/ })).toBeVisible();

    await trigger(page, 'epic', 'PROD-EPIC').click();
    await menu(page, 'PROD-EPIC').locator('.status-transition-target-toggle').check();

    // Marking the Epic as a status target must not flip the excluded-capacity control
    // or persist a group-config change.
    await expect(epicBlock.getByRole('button', { name: /Included/ })).toBeVisible();
    expect(calls.filter(c => c.method === 'POST' && c.pathname === '/api/groups-config')).toHaveLength(0);
    await expect(page.locator('.planning-actions .planning-status-feedback')).toContainText('3 status targets selected');
});

test('Planning subtask status target does not change selected story points', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await openPlanning(page);

    const selectedStat = page.locator('.planning-panel.open .planning-stat-value').first();
    await expect(selectedStat).toContainText('2 · 2.0 SP');

    await page.locator('.task-item[data-task-key="PROD-1"] .story-subtasks-toggle').click();
    await trigger(page, 'subtask', 'PROD-1-A').click();
    await menu(page, 'PROD-1-A').locator('.status-transition-target-toggle').check();

    // Subtask target membership must not affect Story selected story points.
    await expect(selectedStat).toContainText('2 · 2.0 SP');
    await expect(page.locator('.planning-actions .planning-status-feedback')).toContainText('3 status targets selected');
});

test('Planning partial success shows a result summary and keeps failed targets selected', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    const { calls } = await installEngStatusFixture(page, { transitions: partialTransition });
    await page.goto(appBaseUrl);
    await openPlanning(page);

    await trigger(page, 'story', 'PROD-1').click();
    const storyMenu = menu(page, 'PROD-1');
    await storyMenu.locator('.status-transition-select').selectOption({ value: 'Accepted' });
    await storyMenu.locator('.status-transition-submit').click();

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    await expect(storyMenu.locator('.status-transition-menu-result')).toContainText('1 failed');
    // The action bar reports the partial result, and the selection stays intact for retry.
    await expect(page.locator('.planning-actions .planning-status-feedback')).toContainText('1 failed');
    await expect(page.locator('.planning-panel.open .planning-stat-value').first()).toContainText('2 · 2.0 SP');
});

test('Planning too_many_issues shows a recoverable message and sends no mutation request', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    const { calls } = await installEngStatusFixture(page, { optionsStatus: 400, optionsBody: { error: 'too_many_issues' } });
    await page.goto(appBaseUrl);
    await openPlanning(page);

    await trigger(page, 'story', 'PROD-1').click();
    const storyMenu = menu(page, 'PROD-1');
    await expect(storyMenu.locator('.status-transition-menu-error.is-too-many')).toContainText('Narrow your selection');
    // No submit control is offered, so no mutation can be sent.
    await expect(storyMenu.locator('.status-transition-submit')).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(transitionCalls(calls)).toHaveLength(0);
});

test('Statistics and Scenario ENG views render inert status pills (no triggers)', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    // Catch Up exposes the epic + 2 story triggers.
    await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(3);

    const modeControl = page.locator('.view-selector .eng-mode-control');
    await modeControl.getByRole('radio', { name: 'Statistics' }).click();
    await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(0);

    await modeControl.getByRole('radio', { name: 'Scenario' }).click();
    await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(0);

    expect(calls.filter(c => c.pathname.startsWith('/api/issues/transitions'))).toHaveLength(0);
});

test('Opening the Settings modal makes ENG Catch Up status pills inert', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(3);

    await page.getByRole('button', { name: /manage team groups/i }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    // Settings is a modal overlay: status pills must go inert while it is open.
    await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(0);
    expect(calls.filter(c => c.pathname.startsWith('/api/issues/transitions'))).toHaveLength(0);
});

test('EPM project boards render inert status pills, no triggers, and never call the transition API', async ({ page }) => {
    await setPrefs(page, { selectedView: 'epm', epmTab: 'active', epmSelectedProjectId: '', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42' });
    const { calls } = await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        allProjectsRollup: (project) => ({
            projects: [{
                project,
                rollup: {
                    metadataOnly: false,
                    emptyRollup: false,
                    truncated: false,
                    truncatedQueries: [],
                    initiatives: {},
                    rootEpics: {
                        'EPM-EPIC': {
                            issue: { key: 'EPM-EPIC', summary: 'EPM epic', status: 'In Progress', issueType: 'Epic', storyPoints: 5 },
                            stories: [{ key: 'EPM-1', summary: 'EPM story', status: 'To Do', issueType: 'Story', storyPoints: 2 }],
                        },
                    },
                    orphanStories: [],
                },
            }],
            duplicates: {},
            truncated: false,
            fallback: false,
        }),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.epm-project-board')).toHaveCount(1);
    // EPM issue cards render, but their status pills are inert spans, not triggers.
    await expect(page.locator('.task-item[data-task-key="EPM-1"] .status-pill')).toHaveCount(1);
    await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(0);
    await expect(page.locator('.epm-project-board button.status-pill')).toHaveCount(0);
    expect(calls.filter(c => c.pathname.startsWith('/api/issues/transitions'))).toHaveLength(0);
});

test('sticky order keeps planning-panel above the epic header while a status menu is open', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ selectedSprint: futureSprintId, sprintName: futureSprintName }));
    await installEngStatusFixture(page);
    await page.goto(appBaseUrl);
    await openPlanning(page);

    const readLayering = () => page.evaluate(() => {
        const panel = document.querySelector('.planning-panel.open');
        const epicHeader = document.querySelector('.epic-header');
        const zOf = (el) => (el ? Number.parseInt(getComputedStyle(el).zIndex, 10) : NaN);
        return {
            panelPosition: panel ? getComputedStyle(panel).position : '',
            epicPosition: epicHeader ? getComputedStyle(epicHeader).position : '',
            panelZ: zOf(panel),
            epicZ: zOf(epicHeader),
        };
    });

    const before = await readLayering();
    expect(before.panelPosition).toBe('sticky');
    expect(before.epicPosition).toBe('sticky');
    expect(before.panelZ).toBeGreaterThan(before.epicZ);

    await trigger(page, 'story', 'PROD-1').click();
    await expect(menu(page, 'PROD-1')).toBeVisible();
    const during = await readLayering();
    expect(during.panelPosition).toBe('sticky');
    expect(during.epicPosition).toBe('sticky');
    expect(during.panelZ).toBeGreaterThan(during.epicZ);
});
