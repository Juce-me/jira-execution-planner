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
const groupTeamIds = ['team-alpha', 'team-beta'];
// group.teamLabels maps team ID -> Jira EPIC LABEL (Future Planning epic matching / JQL), never a
// display name. Values are label slugs on purpose: team display names must come from task payloads
// (retained in-session by the teamOptions memo) or the warmed team catalog, never from teamLabels.
const groupTeamLabels = {
    'team-alpha': 'alpha_team_label',
    'team-beta': 'beta_team_label',
};
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
const screenshotDir = path.join(repoRoot, 'tmp', 'priority-team-filter');

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
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

function taskListRequests(calls) {
    return calls.filter(call => (
        call.pathname === '/api/tasks-with-team-name' && !call.params.purpose
    ));
}

// Stories start at "Medium" so the current-priority option is filtered out of the menu
// (mirroring how the status menu omits the current status) while "Major" stays selectable.
function makeStory(
    key,
    sprintId,
    sprintName,
    epicKey = 'PROD-EPIC',
    teamId = 'team-alpha',
    teamName = 'Alpha Team',
) {
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
            teamId,
            teamName,
            sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
            subtaskSummary: null,
        },
    };
}

function makeEpic(sprintId, sprintName, priority = 'High', key = 'PROD-EPIC') {
    return {
        key,
        summary: 'Synthetic product epic',
        status: { name: 'In Progress' },
        priority: priority ? { name: priority } : null,
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
    };
}

const HIGHEST = { id: '1', name: 'Highest', statusColor: '#CD1317', iconUrl: 'https://jira.example/p1.svg', rank: 10 };
const HIGH = { id: '2', name: 'High', statusColor: '#E9494A', iconUrl: 'https://jira.example/p2.svg', rank: 20 };
const MEDIUM = { id: '3', name: 'Medium', statusColor: '#E97F33', iconUrl: 'https://jira.example/p3.svg', rank: 30 };
const MAJOR = { id: '4', name: 'Major', statusColor: '#F5CD47', iconUrl: 'https://jira.example/p4.svg', rank: 40 };
const LOW = { id: '5', name: 'Low', statusColor: '#2D8738', iconUrl: 'https://jira.example/p5.svg', rank: 50 };

// The PROD Story scheme (issue's own editmeta-filtered priorities). Stories start at Medium,
// which the menu omits as "current", leaving Highest/High/Major/Low.
const priorityCatalog = {
    priorities: [HIGHEST, HIGH, MEDIUM, MAJOR, LOW],
    source: 'jira',
    cached: false,
};

// The PROD Epic scheme is DELIBERATELY different (no Major) so a per-project/issue-type
// refetch is observable and proves options are filtered to the clicked issue's real scheme.
const priorityEpicScheme = {
    priorities: [HIGHEST, HIGH, MEDIUM, LOW],
    source: 'jira',
    cached: false,
};

// Simulates the backend editmeta filtering: the app endpoint returns the issue's own
// (already-filtered) priority scheme, keyed here by the issueKey's project + inferred type.
function priorityOptionsForIssue(issueKey) {
    if (issueKey === 'PROD-EPIC') return priorityEpicScheme;
    return priorityCatalog;
}

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

async function installEngPriorityFixture(page, {
    stories = null,
    priorityDelayMs = 0,
    priorityWrite = priorityWriteResponse,
    omitSelectedTeamAfterPriority = false,
    epicPriority = 'High',
    extraEpicKeys = [],
    otherSprint = null,
    statefulWrites = false,
} = {}) {
    const calls = [];
    const priorityState = { inFlight: 0, maxInFlight: 0, successfulWrite: false };
    const appliedPriority = new Map(); // statefulWrites: what Jira would now return for a key whose write was applied
    const groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{ id: 'group-alpha', name: 'Alpha Department', teamIds: groupTeamIds, teamLabels: groupTeamLabels, labels: ['alpha_label'], excludedCapacityEpics: [] }],
        preferences: {
            onboardingRequired: false,
            onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
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
                sprints: [{ id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' }, ...(otherSprint ? [{ id: otherSprint.id, name: otherSprint.name, state: 'active', startDate: '2026-05-15' }] : [])],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const refreshedStories = omitSelectedTeamAfterPriority && priorityState.successfulWrite
                ? [makeStory('PROD-BETA-1', activeSprintId, activeSprintName, 'PROD-EPIC', 'team-beta', 'Beta Team')]
                : null;
            const defaultIssues = project === 'product' && !purpose
                ? (refreshedStories || [
                    makeStory('PROD-1', activeSprintId, activeSprintName),
                    makeStory('PROD-2', activeSprintId, activeSprintName),
                ])
                : [];
            const onOtherSprint = otherSprint && String(url.searchParams.get('sprint')) === String(otherSprint.id);
            const listed = onOtherSprint ? (project === 'product' && !purpose ? [makeStory('PROD-B-1', otherSprint.id, otherSprint.name)] : []) : (stories && project === 'product' && !purpose) ? stories : defaultIssues;
            const issues = listed.map(issue => (appliedPriority.has(issue.key) ? { ...issue, fields: { ...issue.fields, priority: { name: appliedPriority.get(issue.key) } } } : issue));
            const epic = makeEpic(activeSprintId, activeSprintName, epicPriority);
            const epics = [epic, ...extraEpicKeys.map(key => makeEpic(activeSprintId, activeSprintName, epicPriority, key))];
            return json(route, {
                issues,
                epics: Object.fromEntries(epics.map(item => [item.key, item])),
                epicsInScope: project === 'product' ? epics : [],
                names: {},
            });
        }
        const editableMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/editable-fields$/);
        if (editableMatch) return json(route, { issueKey: editableMatch[1], field: 'storyPoints', editable: true, currentValue: 1, baseUpdated: '2026-05-01T00:00:00.000+0000', mappingRevision: 'synthetic-story-points', me: null });
        if (url.pathname === '/api/issues/subtasks') return json(route, { parentKey: '', sprint: '', cached: false, summary: null, subtasks: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/issues/priorities/options') return json(route, priorityOptionsForIssue(url.searchParams.get('issueKey') || ''));
        if (url.pathname === '/api/issues/priorities') {
            priorityState.inFlight += 1;
            priorityState.maxInFlight = Math.max(priorityState.maxInFlight, priorityState.inFlight);
            try {
                if (priorityDelayMs) {
                    await new Promise(resolve => setTimeout(resolve, priorityDelayMs));
                }
                const responseBody = priorityWrite(body);
                if (responseBody?.succeeded > 0) priorityState.successfulWrite = true;
                if (statefulWrites && responseBody?.succeeded > 0) (body?.issueKeys || []).forEach(key => appliedPriority.set(key, responseBody.targetPriority?.name || 'Major'));
                return json(route, responseBody);
            } finally {
                priorityState.inFlight -= 1;
            }
        }
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return { calls, priorityState };
}

async function setPrefs(page, prefs) {
    await page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value));
    }, prefs);
}

function catchUpPrefs(extra = {}) {
    return { selectedView: 'eng', planningLayout: 'list', selectedSprint: activeSprintId, sprintName: activeSprintName, activeGroupId: 'group-alpha', showPlanning: false, showStats: false, showScenario: false, ...extra };
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
    // Options fetched exactly once on first open, scoped to the clicked issue's own scheme.
    await expect.poll(() => priorityOptionsCalls(calls).length).toBe(1);
    expect(priorityOptionsCalls(calls)[0].params.issueKey).toBe('PROD-1');

    // Current priority (Medium) is omitted, mirroring how the status menu omits current, and
    // the list is exactly the issue's PROD scheme (no site-wide extras).
    const labels = await menu1.locator('.priority-transition-option-label').allTextContents();
    expect(labels).toEqual(['Highest', 'High', 'Major', 'Low']);

    // Compact app-dropdown grammar: narrow panel, short rows, full-row hover, no chip cards.
    const menuBox = await menu1.boundingBox();
    expect(menuBox.width).toBeLessThanOrEqual(280);
    const firstOption = menu1.locator('.priority-transition-option').first();
    const firstOptionBox = await firstOption.boundingBox();
    expect(firstOptionBox.height).toBeLessThanOrEqual(36);
    await expect(firstOption).not.toHaveClass(/task-status/);
    // REQ-A: each option row renders the app's OWN priority icon (the same visual as the
    // trigger + task rows) carrying the option's real priority name in data-priority, not a
    // bare color dot. All four visible options are known priorities, so no dot markers remain.
    const firstOptionIcon = firstOption.locator('.task-priority-icon');
    await expect(firstOptionIcon).toHaveCount(1);
    await expect(firstOptionIcon).toHaveAttribute('data-priority', 'Highest');
    await expect(menu1.locator('.priority-transition-option .task-priority-icon')).toHaveCount(4);
    await expect(menu1.locator('.priority-transition-option-marker')).toHaveCount(0);

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

test('Catch Up applies rapid Story priority changes optimistically without task-list refetches', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls, priorityState } = await installEngPriorityFixture(page, { priorityDelayMs: 1000 });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const initialTaskRequests = taskListRequests(calls).length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');

    await page.locator('.subtitle-secondary').click();
    await expect(priorityMenu(page, 'PROD-1')).toHaveCount(0);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toBeDisabled();
    await expect(priorityTrigger(page, 'story', 'PROD-2')).toBeEnabled();
    await priorityTrigger(page, 'story', 'PROD-2').click();
    const secondOption = priorityMenu(page, 'PROD-2').getByText('High', { exact: true }).locator('..');
    await expect(secondOption).toBeEnabled();
    await secondOption.click();

    await expect.poll(() => priorityWriteCalls(calls).length).toBe(2);
    await expect(priorityTrigger(page, 'story', 'PROD-2')).toHaveAttribute('data-priority', 'High');
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect(priorityMenu(page, 'PROD-2').locator('.priority-transition-menu-result')).toContainText('Updated 1 issue');

    expect(taskListRequests(calls)).toHaveLength(initialTaskRequests);
});

test('Catch Up rolls back a failed optimistic priority change without refetching task lists', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const failedPriorityWrite = body => ({
        requested: 1,
        succeeded: 0,
        failed: 1,
        targetPriority: { id: body.targetPriorityId, name: 'Major' },
        results: [{ key: body.issueKeys[0], result: 'failure', error: 'priority_forbidden' }],
    });
    const { calls, priorityState } = await installEngPriorityFixture(page, {
        priorityDelayMs: 500,
        priorityWrite: failedPriorityWrite,
    });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const initialTaskRequests = taskListRequests(calls).length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');

    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect(priorityMenu(page, 'PROD-1').locator('.priority-transition-menu-result')).toContainText('No issues updated');
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Medium');
    expect(taskListRequests(calls)).toHaveLength(initialTaskRequests);
});

test('epic header shows the epic OWN priority and its menu omits it while the child-derived value stays selectable', async ({ page }) => {
    // The header icon prefers the Epic's OWN priority (High in the fixture) over the most
    // urgent child Story priority (Medium). The menu edits that same own field, so it omits the
    // own value as "current". Submit still POSTs the epic key.
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngPriorityFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();

    // Trigger icon renders the Epic's own High, not the child-derived Medium.
    const epicTrigger = priorityTrigger(page, 'epic', 'PROD-EPIC');
    await expect(epicTrigger).toHaveCount(1);
    await expect(epicTrigger).toHaveAttribute('data-priority', 'High');

    await epicTrigger.click();
    const menu = priorityMenu(page, 'PROD-EPIC');
    await expect(menu).toBeVisible();

    // Omitted-as-current is the epic's OWN priority (High); the child-derived value (Medium)
    // stays selectable. Options are the epic's OWN scheme (this fixture's epic scheme omits
    // Major), proving the per-issue editmeta filter composes with the own-priority omit.
    const labels = await menu.locator('.priority-transition-option-label').allTextContents();
    expect(labels).toEqual(['Highest', 'Medium', 'Low']);
    expect(labels).not.toContain('High');
    expect(labels).not.toContain('Major');

    // Choosing another value is a real change; the mutation targets the epic key.
    await menu.getByRole('menuitem', { name: 'Medium' }).click();
    await expect.poll(() => priorityWriteCalls(calls).length).toBe(1);
    const mutation = priorityWriteCalls(calls)[0];
    expect(mutation.body.issueKeys).toEqual(['PROD-EPIC']);
    expect(mutation.body.targetPriorityId).toBe('3');
});

test('epic header falls back to the child-derived priority when the epic has none and its menu omits nothing', async ({ page }) => {
    // With no own priority the header shows the most urgent child Story priority (Medium), but
    // that value is not the field the menu edits, so no option is omitted as "current".
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngPriorityFixture(page, { epicPriority: null });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();

    const epicTrigger = priorityTrigger(page, 'epic', 'PROD-EPIC');
    await expect(epicTrigger).toHaveCount(1);
    await expect(epicTrigger).toHaveAttribute('data-priority', 'Medium');

    await epicTrigger.click();
    const menu = priorityMenu(page, 'PROD-EPIC');
    await expect(menu).toBeVisible();

    // The epic's OWN scheme, unfiltered: Medium is still listed because it is derived, not own.
    const labels = await menu.locator('.priority-transition-option-label').allTextContents();
    expect(labels).toEqual(['Highest', 'High', 'Medium', 'Low']);

    // Choosing the displayed derived value is a real change for an epic with no priority set.
    await menu.getByRole('menuitem', { name: 'Medium' }).click();
    await expect.poll(() => priorityWriteCalls(calls).length).toBe(1);
    const mutation = priorityWriteCalls(calls)[0];
    expect(mutation.body.issueKeys).toEqual(['PROD-EPIC']);
    expect(mutation.body.targetPriorityId).toBe('3');
});

test('priority options refetch per project/issue-type tuple with the issue-scoped scheme', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngPriorityFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();

    // PROD-1 (PROD|Story) -> request 1, carrying the issue key for editmeta filtering.
    await priorityTrigger(page, 'story', 'PROD-1').click();
    await expect(priorityMenu(page, 'PROD-1')).toBeVisible();
    await expect.poll(() => priorityOptionsCalls(calls).length).toBe(1);
    expect(priorityOptionsCalls(calls)[0].params.issueKey).toBe('PROD-1');

    // A DIFFERENT tuple (PROD-EPIC = PROD|Epic) -> exactly one extra request carrying that
    // issue key, returning a DIFFERENT scheme (this fixture's epic scheme omits Major).
    await page.keyboard.press('Escape');
    await expect(priorityMenu(page, 'PROD-1')).toHaveCount(0);
    await priorityTrigger(page, 'epic', 'PROD-EPIC').click();
    await expect(priorityMenu(page, 'PROD-EPIC')).toBeVisible();
    await expect.poll(() => priorityOptionsCalls(calls).length).toBe(2);
    expect(priorityOptionsCalls(calls)[1].params.issueKey).toBe('PROD-EPIC');
    const epicLabels = await priorityMenu(page, 'PROD-EPIC').locator('.priority-transition-option-label').allTextContents();
    expect(epicLabels).not.toContain('Major');
});

test('outside-card click dismisses the priority menu; Escape, trigger toggle, and option click unaffected', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngPriorityFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.addStyleTag({ content: priorityMenuCss });

    const trigger = priorityTrigger(page, 'story', 'PROD-1');
    const menu = priorityMenu(page, 'PROD-1');

    // A NORMAL click far outside the card (the page subtitle) closes the menu. Pre-fix the
    // click-away backdrop was clamped to the card box by the task-appear transform, so an
    // outside-card click missed it and the menu hung around.
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('.priority-transition-option').first()).toBeFocused();
    await page.locator('.subtitle-secondary').click();
    await expect(menu).toHaveCount(0);
    // Pointer dismissal must NOT yank focus back to the trigger.
    await expect(trigger).not.toBeFocused();

    // The trigger still toggles the menu closed (an in-wrapper click must not be treated as
    // "outside" and must not close-then-reopen).
    await trigger.click();
    await expect(menu).toBeVisible();
    await trigger.click();
    await expect(menu).toHaveCount(0);

    // Escape still closes — and returns focus to the priority icon that opened the menu.
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('.priority-transition-option').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // A click INSIDE the menu (an option) is not treated as outside: it still submits.
    await trigger.click();
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Major' }).click();
    await expect(menu.locator('.priority-transition-menu-result')).toContainText('Updated 1 issue');
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

// A Planning edit may issue only its own option read and the one write (plus the CSRF token read):
// any other call after the click is a mutation-triggered read of the board, readiness or reviews.
const PLANNING_EDIT_CALLS = new Set(['/api/issues/priorities/options', '/api/issues/priorities', '/api/auth/csrf']);
const EDITOR_CALL = /^\/api\/issues\/[^/]+\/editable-fields$/;

function unexpectedCallsSince(calls, index) {
    return calls.slice(index).filter(call => !PLANNING_EDIT_CALLS.has(call.pathname)).map(call => `${call.method} ${call.pathname}`);
}

async function openPlanningTable(page) {
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await page.getByRole('button', { name: 'Show Planning table', exact: true }).click();
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toBeVisible();
}

const failedPriorityWrite = body => ({
    requested: 1,
    succeeded: 0,
    failed: 1,
    targetPriority: { id: body.targetPriorityId, name: 'Major' },
    results: [{ key: body.issueKeys[0], result: 'failure', error: 'priority_conflict' }],
});

test('Planning List priority change shows at once, sends one key and makes no other read', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls, priorityState } = await installEngPriorityFixture(page, { priorityDelayMs: 800 });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await page.waitForLoadState('networkidle');

    expect(priorityWriteCalls(calls)).toHaveLength(1);
    expect(priorityWriteCalls(calls)[0].body.issueKeys).toEqual(['PROD-1']);
    expect(unexpectedCallsSince(calls, mark)).toEqual([]);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
});

test('Planning Table priority change shows at once, sends one key and makes no other read', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls, priorityState } = await installEngPriorityFixture(page, { priorityDelayMs: 800 });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await openPlanningTable(page);
    await page.waitForLoadState('networkidle');
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await page.waitForLoadState('networkidle');

    expect(priorityWriteCalls(calls)).toHaveLength(1);
    expect(priorityWriteCalls(calls)[0].body.issueKeys).toEqual(['PROD-1']);
    expect(unexpectedCallsSince(calls, mark)).toEqual([]);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
});

test('Planning List rolls back a rejected priority change without any other read', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls, priorityState } = await installEngPriorityFixture(page, {
        priorityDelayMs: 500,
        priorityWrite: failedPriorityWrite,
    });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect(priorityMenu(page, 'PROD-1').locator('.priority-transition-menu-result')).toContainText('No issues updated');
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Medium');
    await page.waitForLoadState('networkidle');
    expect(unexpectedCallsSince(calls, mark)).toEqual([]);
});

test('Planning Table rolls back a rejected priority change without any other read', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls, priorityState } = await installEngPriorityFixture(page, {
        priorityDelayMs: 500,
        priorityWrite: failedPriorityWrite,
    });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await openPlanningTable(page);
    await page.waitForLoadState('networkidle');
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Medium');
    await page.waitForLoadState('networkidle');
    expect(unexpectedCallsSince(calls, mark)).toEqual([]);
});

test('Planning applies rapid independent Story priority changes without refetching', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls, priorityState } = await installEngPriorityFixture(page, { priorityDelayMs: 1000 });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    await page.locator('.subtitle-secondary').click();
    await expect(priorityMenu(page, 'PROD-1')).toHaveCount(0);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toBeDisabled();
    await expect(priorityTrigger(page, 'story', 'PROD-2')).toBeEnabled();

    await priorityTrigger(page, 'story', 'PROD-2').click();
    const secondOption = priorityMenu(page, 'PROD-2').getByText('High', { exact: true }).locator('..');
    await expect(secondOption).toBeEnabled();
    await secondOption.click();
    await expect(priorityTrigger(page, 'story', 'PROD-2')).toHaveAttribute('data-priority', 'High');
    await expect.poll(() => priorityWriteCalls(calls).length).toBe(2);
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await page.waitForLoadState('networkidle');

    expect(priorityWriteCalls(calls).map(call => call.body.issueKeys)).toEqual([['PROD-1'], ['PROD-2']]);
    expect(unexpectedCallsSince(calls, mark)).toEqual([]);
});

const planningStoryOrder = page => page.locator('[data-priority-transition-trigger][data-issue-kind="story"]')
    .evaluateAll(triggers => triggers.map(trigger => trigger.dataset.issueKey));

for (const layout of ['List', 'Table']) {
    for (const outcome of ['confirmed', 'rejected']) {
        test(`Planning ${layout} keeps a Story in place while its priority is pending and ${outcome === 'confirmed' ? 'moves it to its sorted place once Jira confirms' : 'never moves it when Jira rejects'}`, async ({ page }) => {
            await setPrefs(page, catchUpPrefs(layout === 'List' ? { showPlanning: true } : {}));
            const { calls, priorityState } = await installEngPriorityFixture(page, {
                priorityDelayMs: 900,
                priorityWrite: outcome === 'rejected' ? failedPriorityWrite : priorityWriteResponse,
                stories: ['PROD-1', 'PROD-2', 'PROD-3'].map(key => makeStory(key, activeSprintId, activeSprintName)),
            });
            await page.goto(appBaseUrl);
            await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
            if (layout === 'Table') {
                await openPlanningTable(page);
                // The Table orders rows by the reviewer's sort; without one it is key order, which a priority edit never changes.
                await page.locator('.planning-review-heading').filter({ hasText: 'Priority' }).first().click();
            }
            await page.waitForLoadState('networkidle');
            expect(await planningStoryOrder(page)).toEqual(['PROD-1', 'PROD-2', 'PROD-3']);
            const mark = calls.length;

            // PROD-3 goes from Medium to Major, which sorts above its Medium siblings.
            await priorityTrigger(page, 'story', 'PROD-3').click();
            await priorityMenu(page, 'PROD-3').getByRole('menuitem', { name: 'Major' }).click();
            await expect.poll(() => priorityState.inFlight).toBe(1);
            await expect(priorityTrigger(page, 'story', 'PROD-3')).toHaveAttribute('data-priority', 'Major');
            expect(await planningStoryOrder(page), 'the Story shows the new priority at once but stays where it is').toEqual(['PROD-1', 'PROD-2', 'PROD-3']);

            await expect.poll(() => priorityState.inFlight).toBe(0);
            await page.waitForLoadState('networkidle');
            if (outcome === 'confirmed') {
                await expect.poll(() => planningStoryOrder(page)).toEqual(['PROD-3', 'PROD-1', 'PROD-2']);
                await expect(priorityTrigger(page, 'story', 'PROD-3')).toHaveAttribute('data-priority', 'Major');
            } else {
                await expect(priorityTrigger(page, 'story', 'PROD-3')).toHaveAttribute('data-priority', 'Medium');
                expect(await planningStoryOrder(page)).toEqual(['PROD-1', 'PROD-2', 'PROD-3']);
            }
            expect(unexpectedCallsSince(calls, mark)).toEqual([]);
        });
    }
}

test('Planning List holds the order while an editor is open and settles it when the editor closes', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls, priorityState } = await installEngPriorityFixture(page, {
        priorityDelayMs: 1200,
        stories: ['PROD-1', 'PROD-2', 'PROD-3'].map(key => makeStory(key, activeSprintId, activeSprintName)),
    });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const points = page.locator('.task-item[data-task-key="PROD-1"]').getByRole('textbox', { name: 'Story Points' });
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-3').click();
    await priorityMenu(page, 'PROD-3').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    // A sibling's editor opens while PROD-3's priority is still on the wire.
    await points.click();
    await expect(points).toBeEditable();
    await points.fill('7');

    await expect.poll(() => priorityState.inFlight).toBe(0);
    await page.waitForLoadState('networkidle');
    await expect(priorityTrigger(page, 'story', 'PROD-3')).toHaveAttribute('data-priority', 'Major');
    expect(await planningStoryOrder(page), 'a confirmed edit never re-sorts under an open editor').toEqual(['PROD-1', 'PROD-2', 'PROD-3']);
    await expect(points).toBeFocused();
    await expect(points).toHaveValue('7');

    await points.press('Escape');
    await expect.poll(() => planningStoryOrder(page)).toEqual(['PROD-3', 'PROD-1', 'PROD-2']);
    expect(calls.slice(mark).filter(call => !PLANNING_EDIT_CALLS.has(call.pathname) && !EDITOR_CALL.test(call.pathname)).map(call => `${call.method} ${call.pathname}`)).toEqual([]);
});

const epicsCss = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'epics.css'), 'utf8');

test('Planning List blinks a confirmed Story and scrolls to it only when it moved out of view and the user has not scrolled', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const stories = Array.from({ length: 40 }, (_, index) => makeStory(`PROD-${index + 1}`, activeSprintId, activeSprintName));
    const { priorityState } = await installEngPriorityFixture(page, { priorityDelayMs: 600, stories });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.addStyleTag({ content: epicsCss });
    await page.waitForLoadState('networkidle');
    const card = key => page.locator(`.task-item[data-task-key="${key}"]`);
    const inView = key => card(key).evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight + 1; });
    const edit = async (key) => {
        await priorityTrigger(page, 'story', key).click();
        await priorityMenu(page, key).getByRole('menuitem', { name: 'Major' }).click();
        await expect.poll(() => priorityState.inFlight).toBe(1);
    };

    // Moving within view: the card blinks with the shared tint and the page stays put.
    await edit('PROD-2');
    const resting = await page.evaluate(() => window.scrollY);
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect(card('PROD-2')).toHaveClass(/epic-flash/);
    expect(await page.evaluate(() => document.getAnimations().some(animation => animation.animationName === 'epicFlash'))).toBe(true);
    expect(await page.evaluate(() => window.scrollY), 'a card that stays in view does not move the page').toBe(resting);
    await expect(card('PROD-2')).not.toHaveClass(/epic-flash/);

    // At the bottom, the card jumps to the top: the page follows it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(card('PROD-40')).toBeVisible();
    const bottom = await page.evaluate(() => window.scrollY);
    await edit('PROD-40');
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect.poll(() => inView('PROD-40')).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(bottom);

    // The reader scrolls away after the click: the card blinks, the page stays where the reader left it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(card('PROD-39')).toBeVisible();
    await edit('PROD-39');
    await page.evaluate(() => window.scrollBy(0, -300));
    // The card the reader is looking at: it must stay exactly where it is on screen, whatever moves above it.
    const watched = await page.evaluate(() => {
        const element = Array.from(document.querySelectorAll('.task-item[data-task-key]')).find(candidate => candidate.getBoundingClientRect().top > 200);
        return { key: element.dataset.taskKey, top: element.getBoundingClientRect().top };
    });
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await expect(card('PROD-39')).toHaveClass(/epic-flash/);
    await page.waitForTimeout(500);
    // One moved card is ~85px tall; the few pixels left are the edited card's own menu settling above, not a reorder shift.
    expect(Math.abs(await card(watched.key).evaluate(element => element.getBoundingClientRect().top) - watched.top)).toBeLessThanOrEqual(8);
});

test.describe('touch', () => {
    test.use({ hasTouch: true });
    test('a Planning Table priority edit works by tap alone and the confirmed row blinks and moves into place', async ({ page, browserName }) => {
        test.skip(browserName === 'firefox', 'Firefox does not support touch emulation');
        await setPrefs(page, catchUpPrefs());
        const { priorityState } = await installEngPriorityFixture(page, {
            priorityDelayMs: 600,
            stories: ['PROD-1', 'PROD-2', 'PROD-3'].map(key => makeStory(key, activeSprintId, activeSprintName)),
        });
        await page.goto(appBaseUrl);
        await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
        await openPlanningTable(page);
        await page.locator('.planning-review-heading').filter({ hasText: 'Priority' }).first().tap();
        await expect.poll(() => planningStoryOrder(page)).toEqual(['PROD-1', 'PROD-2', 'PROD-3']);

        await priorityTrigger(page, 'story', 'PROD-3').tap();
        await priorityMenu(page, 'PROD-3').getByRole('menuitem', { name: 'Major' }).tap();
        await expect.poll(() => priorityState.inFlight).toBe(1);
        expect(await planningStoryOrder(page)).toEqual(['PROD-1', 'PROD-2', 'PROD-3']);
        await expect.poll(() => priorityState.inFlight).toBe(0);
        await expect.poll(() => planningStoryOrder(page)).toEqual(['PROD-3', 'PROD-1', 'PROD-2']);
        await expect(page.locator('tbody tr[data-issue-key="PROD-3"]')).toHaveClass(/planning-review-confirmed/);
    });
});

test('Planning keeps a pending priority edit through a Sprint switch away and back, and shows the confirmed value on every return', async ({ page }) => {
    const otherSprint = { id: 3002, name: '2026Q2 Sprint 43' };
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    const { calls, priorityState } = await installEngPriorityFixture(page, { priorityDelayMs: 2000, otherSprint, statefulWrites: true });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const choose = async (name) => {
        const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
        await expect(toggle).toHaveAttribute('aria-disabled', 'false');
        await toggle.click();
        await page.locator('.sprint-dropdown-option', { hasText: name }).click();
    };

    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await page.locator('.subtitle-secondary').click();
    await expect(priorityMenu(page, 'PROD-1')).toHaveCount(0);

    // A -> B -> A while the write is still on the wire.
    await choose(otherSprint.name);
    await expect(page.locator('.task-item[data-task-key="PROD-B-1"]')).toBeVisible();
    await choose(activeSprintName);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await expect(priorityTrigger(page, 'story', 'PROD-1'), 'the pending value is still shown after returning').toHaveAttribute('data-priority', 'Major');
    expect(priorityWriteCalls(calls)).toHaveLength(1);

    // The write confirms while A is mounted again: the confirmed value stays, nothing is re-sent.
    await expect.poll(() => priorityState.inFlight).toBe(0);
    await page.waitForLoadState('networkidle');
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    expect(priorityWriteCalls(calls)).toHaveLength(1);

    // Away and back once more: the cached Sprint shows the confirmed value, never the stale Medium.
    await choose(otherSprint.name);
    await expect(page.locator('.task-item[data-task-key="PROD-B-1"]')).toBeVisible();
    await choose(activeSprintName);
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
});

test('Planning List moves an Epic to its sorted place only once a Story priority edit is confirmed', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true }));
    // Neither Epic has its own priority, so each sorts by its most urgent child: both Medium, ordered by load order.
    const { calls, priorityState } = await installEngPriorityFixture(page, {
        priorityDelayMs: 900,
        epicPriority: null,
        extraEpicKeys: ['PROD-EPIC-2'],
        stories: [
            makeStory('PROD-1', activeSprintId, activeSprintName, 'PROD-EPIC'),
            makeStory('PROD-2', activeSprintId, activeSprintName, 'PROD-EPIC-2'),
        ],
    });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const epicOrder = () => page.locator('[data-epic-key]').evaluateAll(blocks => blocks.map(block => block.dataset.epicKey));
    expect(await epicOrder()).toEqual(['PROD-EPIC', 'PROD-EPIC-2']);
    const mark = calls.length;

    await priorityTrigger(page, 'story', 'PROD-2').click();
    await priorityMenu(page, 'PROD-2').getByRole('menuitem', { name: 'Major' }).click();
    await expect.poll(() => priorityState.inFlight).toBe(1);
    await expect(priorityTrigger(page, 'story', 'PROD-2')).toHaveAttribute('data-priority', 'Major');
    expect(await epicOrder(), 'the Epic stays put while the edit is pending').toEqual(['PROD-EPIC', 'PROD-EPIC-2']);

    await expect.poll(() => priorityState.inFlight).toBe(0);
    await page.waitForLoadState('networkidle');
    await expect.poll(epicOrder).toEqual(['PROD-EPIC-2', 'PROD-EPIC']);
    expect(unexpectedCallsSince(calls, mark)).toEqual([]);
});

test('Planning priority edit keeps a configured single-team filter, and an explicit Refresh that omits that team preserves it too', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true, selectedTeams: ['team-alpha'] }));
    await page.addInitScript(({ scopeKey }) => {
        window.localStorage.setItem('jira_dashboard_team_selection_state_v1', JSON.stringify({
            [scopeKey]: {
                selectedTeams: ['team-alpha'],
                selectedTeamId: 'team-alpha',
            },
        }));
    }, { scopeKey: `team-selection::${activeSprintId}::group-alpha` });

    const { calls } = await installEngPriorityFixture(page, {
        omitSelectedTeamAfterPriority: true,
    });
    await page.goto(appBaseUrl);

    const teamToggle = page.locator('.view-selector .team-dropdown-toggle').first();
    const teamLabel = teamToggle.locator('.team-dropdown-selection-label');
    await expect(teamLabel).toHaveText('Alpha Team');
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'before-refresh.png'), fullPage: false });

    const initialTaskRequestCount = calls.filter(call => call.pathname === '/api/tasks-with-team-name').length;
    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();

    // The edit itself never reloads the board: PROD-1 stays, shows its new priority and the filter holds.
    await expect(priorityTrigger(page, 'story', 'PROD-1')).toHaveAttribute('data-priority', 'Major');
    await expect.poll(() => priorityWriteCalls(calls).length).toBe(1);
    await page.waitForLoadState('networkidle');
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(initialTaskRequestCount);
    await expect(teamLabel).toHaveText('Alpha Team');

    // An explicit Refresh reloads the board, and the refreshed payload omits the selected team.
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length)
        .toBeGreaterThan(initialTaskRequestCount);
    // The refreshed payload drops PROD-1 (Alpha) and returns only a Beta story, so proving the
    // Alpha row is gone confirms the following assertions run against post-refresh state.
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toHaveCount(0);
    // Alpha's display name survives via in-session retention of task-derived names (the pre-refresh
    // payload named it); Beta's name comes from the refreshed tasks. teamLabels never name teams.
    await expect(teamLabel).toHaveText('Alpha Team');

    // Interacting with PROD-1's priority menu scrolls the page down past the sticky header,
    // which is unrelated Planning-surface behavior (the header swaps to its compact-sticky
    // form). Scroll back to the top control bar before exercising the team dropdown so this
    // assertion targets the filter-preservation fix, not incidental scroll position.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(0);
    await teamToggle.click();
    await expect(page.locator('.team-dropdown-panel')).toContainText('Alpha Team');
    await expect(page.locator('.team-dropdown-panel')).toContainText('Beta Team');
    await page.screenshot({ path: path.join(screenshotDir, 'after-refresh.png'), fullPage: false });

    await expect.poll(() => page.evaluate((scopeKey) => {
        const state = JSON.parse(window.localStorage.getItem('jira_dashboard_team_selection_state_v1') || '{}');
        return state[scopeKey]?.selectedTeams || [];
    }, `team-selection::${activeSprintId}::group-alpha`)).toEqual(['team-alpha']);
});
