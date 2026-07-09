const fs = require('node:fs');
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
const groupTeamIds = ['team-alpha'];
// The esbuild bundle strips CSS (loader '.css': 'empty'); the priority menu styles live in
// status-transitions.css (shared .issue-field/.priority-transition selectors) and the
// interactive-icon button reset lives in issues.css. Inject both source files so the
// geometry/hover assertions validate the real source styling, not a stale dist build.
const statusTransitionsCss = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'status-transitions.css'),
    'utf8',
);
const issuesCss = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'issues.css'),
    'utf8',
);
const priorityMenuCss = `${statusTransitionsCss}\n${issuesCss}`;
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

// Stories start at "Medium" so the current-priority option is filtered out of the menu
// (mirroring how the status menu omits the current status) while "Major" stays selectable.
function makeStory(key, sprintId, sprintName, epicKey = 'PROD-EPIC') {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic story`,
            status: { name: 'To Do' },
            priority: { name: 'Medium' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 1,
            epicKey,
            parentSummary: 'Synthetic product epic',
            projectKey: 'PROD',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
            subtaskSummary: null,
        },
    };
}

function makeEpic(sprintId, sprintName) {
    return {
        key: 'PROD-EPIC',
        summary: 'Synthetic product epic',
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
    };
}

const priorityCatalog = {
    priorities: [
        { id: '1', name: 'Highest', statusColor: '#CD1317', iconUrl: 'https://jira.example/p1.svg', rank: 10 },
        { id: '2', name: 'High', statusColor: '#E9494A', iconUrl: 'https://jira.example/p2.svg', rank: 20 },
        { id: '3', name: 'Medium', statusColor: '#E97F33', iconUrl: 'https://jira.example/p3.svg', rank: 30 },
        { id: '4', name: 'Major', statusColor: '#F5CD47', iconUrl: 'https://jira.example/p4.svg', rank: 40 },
        { id: '5', name: 'Low', statusColor: '#2D8738', iconUrl: 'https://jira.example/p5.svg', rank: 50 },
    ],
    source: 'jira',
    cached: false,
};

function priorityWriteResponse(body) {
    const keys = body?.issueKeys || [];
    const targetId = String(body?.targetPriorityId || '');
    const target = priorityCatalog.priorities.find((p) => p.id === targetId);
    return {
        requested: keys.length,
        succeeded: keys.length,
        failed: 0,
        targetPriority: target ? { id: target.id, name: target.name } : { id: targetId, name: '' },
        results: keys.map((key) => ({ key, result: 'success', fromPriority: 'Medium', toPriority: target?.name || '' })),
    };
}

async function installEngPriorityFixture(page, { stories = null } = {}) {
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
                sprints: [{ id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' }],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const defaultIssues = project === 'product' && !purpose
                ? [makeStory('PROD-1', activeSprintId, activeSprintName), makeStory('PROD-2', activeSprintId, activeSprintName)]
                : [];
            const issues = (stories && project === 'product' && !purpose) ? stories : defaultIssues;
            const epic = makeEpic(activeSprintId, activeSprintName);
            return json(route, {
                issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/issues/subtasks') return json(route, { parentKey: '', sprint: '', cached: false, summary: null, subtasks: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/issues/priorities/options') return json(route, priorityCatalog);
        if (url.pathname === '/api/issues/priorities') return json(route, priorityWriteResponse(body));
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

function priorityTrigger(page, kind, key) {
    return page.locator(`[data-priority-transition-trigger][data-issue-kind="${kind}"][data-issue-key="${key}"]`);
}

function priorityMenu(page, key) {
    return page.locator(`.priority-transition-menu[data-issue-key="${key}"]`);
}

function priorityOptionsCalls(calls) {
    return calls.filter(call => call.method === 'GET' && call.pathname === '/api/issues/priorities/options');
}

function priorityWriteCalls(calls) {
    return calls.filter(call => call.method === 'POST' && call.pathname === '/api/issues/priorities');
}

test('priority icon opens compact app dropdown and fetches priorities once across icons', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngPriorityFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.addStyleTag({ content: priorityMenuCss });

    // The interactive trigger is a real native button that preserves the priority icon.
    const trigger1 = priorityTrigger(page, 'story', 'PROD-1');
    await expect(trigger1).toHaveCount(1);
    expect(await trigger1.evaluate(el => el.tagName)).toBe('BUTTON');
    await expect(trigger1).toHaveClass(/task-priority-icon/);

    await trigger1.click();
    const menu1 = priorityMenu(page, 'PROD-1');
    await expect(menu1).toBeVisible();
    // Options fetched exactly once on first open.
    await expect.poll(() => priorityOptionsCalls(calls).length).toBe(1);

    // Current priority (Medium) is omitted, mirroring how the status menu omits current.
    const labels = await menu1.locator('.priority-transition-option-label').allTextContents();
    expect(labels).toEqual(['Highest', 'High', 'Major', 'Low']);

    // Compact app-dropdown grammar: narrow panel, short rows, full-row hover, no chip cards.
    const menuBox = await menu1.boundingBox();
    expect(menuBox.width).toBeLessThanOrEqual(280);
    const firstOption = menu1.locator('.priority-transition-option').first();
    const firstOptionBox = await firstOption.boundingBox();
    expect(firstOptionBox.height).toBeLessThanOrEqual(36);
    await expect(firstOption).not.toHaveClass(/task-status/);
    await expect(firstOption.locator('.priority-transition-option-marker')).toHaveCount(1);

    const beforeHover = await firstOption.evaluate((node) => getComputedStyle(node).backgroundColor);
    await firstOption.hover();
    await expect.poll(async () => firstOption.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(beforeHover);

    // Close, then open a DIFFERENT icon: the module-level catalog cache means no refetch.
    await page.keyboard.press('Escape');
    await expect(menu1).toHaveCount(0);
    await priorityTrigger(page, 'story', 'PROD-2').click();
    await expect(priorityMenu(page, 'PROD-2')).toBeVisible();
    expect(priorityOptionsCalls(calls)).toHaveLength(1);
});

test('priority option click changes the clicked issue priority in one action', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngPriorityFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();

    await priorityTrigger(page, 'story', 'PROD-1').click();
    const menu1 = priorityMenu(page, 'PROD-1');
    await expect(menu1).toBeVisible();

    // A single normal click on the option submits immediately (no confirm, no apply button).
    await menu1.getByRole('menuitem', { name: 'Major' }).click();

    await expect.poll(() => priorityWriteCalls(calls).length).toBe(1);
    const mutation = priorityWriteCalls(calls)[0];
    expect(mutation.body.issueKeys).toEqual(['PROD-1']);
    expect(mutation.body.targetPriorityId).toBe('4');
    // The inline result note appears without any extra step.
    await expect(menu1.locator('.priority-transition-menu-result')).toContainText('Updated 1 issue');
});

test('EPM issue boards render inert priority icons and never call priority APIs', async ({ page }) => {
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
                            issue: { key: 'EPM-EPIC', summary: 'EPM epic', status: 'In Progress', issueType: 'Epic', storyPoints: 5, priority: 'High' },
                            stories: [{ key: 'EPM-1', summary: 'EPM story', status: 'To Do', issueType: 'Story', storyPoints: 2, priority: 'Medium' }],
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
    await expect(page.locator('.task-item[data-task-key="EPM-1"]')).toHaveCount(1);
    // EPM never renders an interactive priority trigger; the icon stays a plain span.
    await expect(page.locator('[data-priority-transition-trigger]')).toHaveCount(0);
    await expect(page.locator('.epm-project-board button.task-priority-icon')).toHaveCount(0);
    expect(calls.filter(c => c.pathname.startsWith('/api/issues/priorities'))).toHaveLength(0);
});
