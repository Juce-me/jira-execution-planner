const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

const screenshotDir = '/tmp/codebase-structure-qa';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha', 'team-beta'];

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'ROOT-100', subGoalKey: 'CHILD-200' },
    issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story', 'Task'] },
    projects: {
        'active-1': { id: 'active-1', homeProjectId: 'active-1', name: 'Active Project', label: 'rnd_project_active' },
        'backlog-1': { id: 'backlog-1', homeProjectId: 'backlog-1', name: 'Backlog Project', label: 'rnd_project_backlog' },
        'archived-1': { id: 'archived-1', homeProjectId: 'archived-1', name: 'Archived Project', label: 'rnd_project_archived' },
    },
};

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function epmProject(tab) {
    return {
        id: `${tab}-1`,
        homeProjectId: `${tab}-1`,
        name: `${tab[0].toUpperCase()}${tab.slice(1)} Project`,
        displayName: `${tab[0].toUpperCase()}${tab.slice(1)} Project`,
        label: `rnd_project_${tab}`,
        stateValue: tab === 'archived' ? 'DONE' : tab === 'backlog' ? 'PAUSED' : 'ON_TRACK',
        stateLabel: tab === 'archived' ? 'Done' : tab === 'backlog' ? 'Paused' : 'On track',
        tabBucket: tab,
        latestUpdateDate: '2026-04-29',
        latestUpdateSnippet: `${tab} project update`,
        homeUrl: `https://home.atlassian.com/project/${tab}-1`,
        resolvedLinkage: { labels: [`rnd_project_${tab}`], epicKeys: [] },
        matchState: 'home-linked',
    };
}

function makeEngTask(project, index) {
    const prefix = project === 'product' ? 'PROD' : 'TECH';
    const epicKey = `${prefix}-EPIC`;
    const teamId = index % 2 === 0 ? 'team-alpha' : 'team-beta';
    const teamName = teamId === 'team-alpha' ? 'Alpha Team' : 'Beta Team';
    return {
        id: `${prefix}-${index}`,
        key: `${prefix}-${index}`,
        fields: {
            summary: `${project} sprint story ${index}`,
            status: { name: index % 5 === 0 ? 'In Progress' : 'To Do' },
            priority: { name: index % 3 === 0 ? 'High' : 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: `${teamName} Owner` },
            customfield_10004: 1,
            epicKey,
            parentSummary: `${project} delivery epic`,
            projectKey: prefix,
            teamId,
            teamName,
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    };
}

function makeEpic(project) {
    const prefix = project === 'product' ? 'PROD' : 'TECH';
    return {
        key: `${prefix}-EPIC`,
        summary: `${project} delivery epic`,
        status: { name: 'In Progress' },
        assignee: { displayName: `${project} lead` },
        teamId: project === 'product' ? 'team-alpha' : 'team-beta',
        teamName: project === 'product' ? 'Alpha Team' : 'Beta Team',
        labels: [project === 'product' ? 'alpha_label' : 'beta_label'],
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
    };
}

const productTasks = Array.from({ length: 12 }, (_, index) => makeEngTask('product', index + 1));
const techTasks = Array.from({ length: 12 }, (_, index) => makeEngTask('tech', index + 1));
const productEpic = makeEpic('product');
const techEpic = makeEpic('tech');

function makeEpmStory(tab, index, epicKey) {
    return {
        key: `${tab.toUpperCase()}-STORY-${index}`,
        summary: `${tab} portfolio story ${index}`,
        issueType: 'Story',
        status: index % 3 === 0 ? 'In Progress' : 'To Do',
        priority: 'Major',
        storyPoints: 1,
        assignee: 'Portfolio Owner',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        parentKey: epicKey,
    };
}

function epmRollup(tab) {
    if (tab === 'archived') {
        return { metadataOnly: true };
    }
    const epicKey = `${tab.toUpperCase()}-EPIC`;
    return {
        metadataOnly: false,
        emptyRollup: false,
        truncated: false,
        truncatedQueries: [],
        initiatives: {},
        rootEpics: {
            [epicKey]: {
                issue: {
                    key: epicKey,
                    summary: `${tab} portfolio epic`,
                    issueType: 'Epic',
                    status: 'In Progress',
                    assignee: 'Portfolio Lead',
                    teamId: 'team-alpha',
                    teamName: 'Alpha Team',
                },
                stories: Array.from({ length: 10 }, (_, index) => makeEpmStory(tab, index + 1, epicKey)),
            },
        },
        orphanStories: [],
    };
}

function scenarioPayload() {
    return {
        jira_base_url: 'https://jira.example',
        config: {
            start_date: '2026-04-01',
            quarter_end_date: '2026-06-30',
        },
        sprintBoundaries: {
            previous: { startDate: '2026-03-18' },
            selected: { startDate: '2026-04-01', endDate: '2026-04-15' },
            next: { endDate: '2026-04-29' },
        },
        summary: {
            late_items: [],
            critical_path: ['PROD-1'],
            unschedulable: [],
            bottleneck_lanes: [],
        },
        dependencies: [],
        capacity_by_team: {
            'Alpha Team': { size: 3, devLead: 'Alpha Lead' },
            'Beta Team': { size: 2, devLead: 'Beta Lead' },
        },
        issues: [
            {
                key: 'PROD-1',
                summary: 'Build product scenario path',
                epicKey: 'PROD-EPIC',
                epicSummary: 'Product delivery epic',
                team: 'Alpha Team',
                assignee: 'Alpha Owner',
                sp: 3,
                start: '2026-04-02',
                end: '2026-04-07',
            },
            {
                key: 'TECH-1',
                summary: 'Build tech scenario path',
                epicKey: 'TECH-EPIC',
                epicSummary: 'Tech delivery epic',
                team: 'Beta Team',
                assignee: 'Beta Owner',
                sp: 2,
                start: '2026-04-08',
                end: '2026-04-11',
            },
        ],
    };
}

function summarizeCalls(calls) {
    return calls.reduce((acc, call) => {
        const key = `${call.method} ${call.pathname}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function createDeferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function callsFor(calls, pathname, method = 'GET') {
    return calls.filter(call => call.method === method && call.pathname === pathname);
}

async function waitForCallCount(calls, predicate, expected, timeout = 7000) {
    await expect.poll(
        () => calls.filter(predicate).length,
        { timeout }
    ).toBe(expected);
}

async function expectWindowSticky(page, selector) {
    const locator = page.locator(selector).first();
    await expect(locator).toBeVisible();
    const setup = await locator.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
            position: style.position,
            scrollTarget: Math.max(0, window.scrollY + rect.top + 80),
        };
    });
    expect(setup.position).toBe('sticky');
    await page.evaluate((scrollTarget) => window.scrollTo(0, scrollTarget), setup.scrollTarget);
    await page.waitForTimeout(180);
    const result = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            top: rect.top,
            expectedTop: parseFloat(style.top) || 0,
        };
    });
    expect(Math.abs(result.top - result.expectedTop)).toBeLessThanOrEqual(8);
}

async function expectPlanningAboveEpic(page) {
    await page.locator('.epic-header').first().evaluate((element) => {
        const target = Math.max(0, window.scrollY + element.getBoundingClientRect().top + 120);
        window.scrollTo(0, target);
    });
    await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
        const planning = document.querySelector('.planning-panel.open');
        const epic = document.querySelector('.epic-header');
        const planningRect = planning.getBoundingClientRect();
        const epicRect = epic.getBoundingClientRect();
        return {
            planningZ: Number.parseInt(getComputedStyle(planning).zIndex, 10),
            epicZ: Number.parseInt(getComputedStyle(epic).zIndex, 10),
            planningBottom: planningRect.bottom,
            epicTop: epicRect.top,
        };
    });
    expect(layout.planningZ).toBeGreaterThan(layout.epicZ);
    expect(layout.epicTop).toBeGreaterThanOrEqual(layout.planningBottom - 10);
}

async function expectContainerSticky(page, selector, containerSelector) {
    const locator = page.locator(selector).first();
    await expect(locator).toBeVisible();
    const setup = await locator.evaluate((element, scrollerSelector) => {
        const scroller = element.closest(scrollerSelector) || document.querySelector(scrollerSelector);
        const style = getComputedStyle(element);
        scroller.scrollTop = 0;
        return {
            position: style.position,
        };
    }, containerSelector);
    expect(setup.position).toBe('sticky');
    await locator.evaluate((element, scrollerSelector) => {
        const scroller = element.closest(scrollerSelector) || document.querySelector(scrollerSelector);
        scroller.scrollTop = 160;
    }, containerSelector);
    await page.waitForTimeout(180);
    const result = await locator.evaluate((element, scrollerSelector) => {
        const scroller = element.closest(scrollerSelector) || document.querySelector(scrollerSelector);
        const rect = element.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return {
            top: rect.top,
            containerTop: scrollerRect.top,
        };
    }, containerSelector);
    expect(result.top).toBeGreaterThanOrEqual(result.containerTop - 1);
    expect(result.top).toBeLessThanOrEqual(result.containerTop + 28);
}

async function expectArchivedMetadataOnlyStickyContract(page) {
    await expect(page.locator('.epm-portfolio-board .epic-header')).toHaveCount(0);
    const header = page.locator('.epm-project-board-header').first();
    await expect(header).toBeVisible();
    const position = await header.evaluate((element) => getComputedStyle(element).position);
    expect(position).not.toBe('sticky');
    await page.evaluate(() => window.scrollTo(0, 240));
    await page.waitForTimeout(180);
    await expect(page.locator('.epm-portfolio-board .epic-header')).toHaveCount(0);
}

async function installApiMocks(page, calls, options = {}) {
    const configGate = options.delayConfig ? createDeferred() : null;
    const unexpectedCalls = [];
    const state = {
        configReleased: !configGate,
        rollupBeforeConfigRelease: false,
    };
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            search: url.search,
            params: Object.fromEntries(url.searchParams.entries()),
        });
        const json = (body, headers = {}) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers,
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/config') {
            if (configGate) {
                await configGate.promise;
            }
            return json({
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                projectsConfigured: true,
                epm: epmConfig,
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: [{
                    id: 'grp-default',
                    name: 'Default',
                    teamIds: groupTeamIds,
                    teamLabels: { 'team-alpha': 'alpha_label', 'team-beta': 'beta_label' },
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/board-config') return json({ boardId: '5494', boardName: 'Synthetic Board', source: 'test' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/capacity/config') return json({ project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json({ fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Epic'] });
        if (url.pathname === '/api/issue-types') return json({ issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const taskSource = project === 'tech' ? techTasks : productTasks;
            const epic = project === 'tech' ? techEpic : productEpic;
            const issues = purpose === 'ready-to-close' ? [] : taskSource;
            return json({
                issues,
                epics: { [epic.key]: epic },
                epicsInScope: [epic],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        if (url.pathname === '/api/scenario') return json(scenarioPayload());
        if (url.pathname === '/api/scenario/overrides') return json({ overrides: {} });
        if (url.pathname === '/api/epm/projects') {
            const tab = url.searchParams.get('tab') || 'active';
            return json({ projects: [epmProject(tab)] });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            if (!state.configReleased) {
                state.rollupBeforeConfigRelease = true;
            }
            const tab = url.searchParams.get('tab') || 'active';
            const project = epmProject(tab);
            return json({
                projects: [{ project, rollup: epmRollup(tab) }],
                duplicates: {},
                truncated: false,
                fallback: true,
            });
        }
        unexpectedCalls.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: `Unexpected API request in codebase structure smoke test: ${request.method()} ${url.pathname}` }),
        });
    });
    return {
        releaseConfig: () => {
            if (configGate) {
                state.configReleased = true;
                configGate.resolve();
            }
        },
        state,
        unexpectedCalls,
    };
}

test('ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showScenario: false,
    });

    await page.goto('http://127.0.0.1:5050/', { waitUntil: 'networkidle' });
    await expect(page.getByText('Catch Up')).toBeVisible();
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name', 4);
    await waitForCallCount(calls, call => call.pathname === '/api/missing-info', 1);
    await expect(page.locator('.epic-header').first()).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/catch-up.png`, fullPage: true });
    await expectWindowSticky(page, '.epic-header');

    const startupCounts = summarizeCalls(calls);
    expect(startupCounts['GET /api/config']).toBe(1);
    expect(startupCounts['GET /api/version']).toBe(1);
    expect(startupCounts['GET /api/groups-config']).toBe(1);
    expect(startupCounts['GET /api/projects/selected']).toBe(1);
    expect(startupCounts['GET /api/sprints']).toBe(1);
    expect(startupCounts['GET /api/stats/priority-weights-config']).toBe(1);
    expect(startupCounts['GET /api/issue-types'] || 0).toBe(0);
    [
        '/api/board-config',
        '/api/capacity/config',
        '/api/sprint-field/config',
        '/api/story-points-field/config',
        '/api/parent-name-field/config',
        '/api/team-field/config',
        '/api/issue-types/config',
    ].forEach(pathname => {
        expect(startupCounts[`GET ${pathname}`] || 0).toBe(0);
    });
    expect(startupCounts['POST /api/dependencies'] || 0).toBe(1);
    expect(startupCounts['POST /api/scenario'] || 0).toBe(0);
    expect(startupCounts['GET /api/teams'] || 0).toBe(0);
    expect(startupCounts['GET /api/teams/all'] || 0).toBe(0);
    expect(startupCounts['GET /api/backlog-epics'] || 0).toBe(0);

    const taskCalls = callsFor(calls, '/api/tasks-with-team-name');
    const visibleTaskCalls = taskCalls.filter(call => !call.params.purpose);
    expect(visibleTaskCalls).toHaveLength(2);
    expect(visibleTaskCalls.map(call => call.params.project).sort()).toEqual(['product', 'tech']);
    visibleTaskCalls.forEach(call => {
        expect(call.params.sprint).toBe(String(selectedSprintId));
        expect(call.params.teamIds).toBe(groupTeamIds.join(','));
    });

    const readyToCloseCalls = taskCalls.filter(call => call.params.purpose === 'ready-to-close');
    expect(readyToCloseCalls).toHaveLength(2);
    const readyToCloseByProject = Object.fromEntries(readyToCloseCalls.map(call => [call.params.project, call]));
    expect(readyToCloseByProject.product.params.sprint).toBe('');
    expect(readyToCloseByProject.product.params.epicKeys).toBe('PROD-EPIC');
    expect(readyToCloseByProject.tech.params.sprint).toBe('');
    expect(readyToCloseByProject.tech.params.epicKeys).toBe('TECH-EPIC');

    await page.getByRole('button', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${screenshotDir}/planning.png`, fullPage: true });
    await expectWindowSticky(page, '.planning-panel.open');
    await expectPlanningAboveEpic(page);

    await page.getByRole('button', { name: 'Scenario' }).click();
    await expect(page.getByText('Scenario Planner')).toBeVisible();
    await page.getByRole('button', { name: 'Run Scenario' }).click();
    await expect(page.locator('.scenario-axis')).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/scenario.png`, fullPage: true });
    await expectContainerSticky(page, '.scenario-axis', '.scenario-timeline');
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('EPM lifecycle tabs load after config with scoped rollup requests and sticky checks', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, { delayConfig: true });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });

    await page.goto('http://127.0.0.1:5050/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => callsFor(calls, '/api/config').length).toBe(1);
    expect(callsFor(calls, '/api/epm/projects/rollup/all')).toHaveLength(0);
    apiMocks.releaseConfig();
    await page.waitForLoadState('networkidle');
    expect(apiMocks.state.rollupBeforeConfigRelease).toBe(false);

    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Project' })).toBeVisible();
    await expect(page.locator('.epm-portfolio-board .epic-header').first()).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/epm-active.png`, fullPage: true });
    await expectWindowSticky(page, '.epm-portfolio-board .epic-header');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('radio', { name: 'Backlog' }).first().click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Backlog Project' })).toBeVisible();
    await expect(page.locator('.epm-portfolio-board .epic-header').first()).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/epm-backlog.png`, fullPage: true });
    await expectWindowSticky(page, '.epm-portfolio-board .epic-header');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('radio', { name: 'Archived' }).first().click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Archived Project' })).toBeVisible();
    await expectArchivedMetadataOnlyStickyContract(page);
    await page.screenshot({ path: `${screenshotDir}/epm-archived.png`, fullPage: true });

    const configIndex = calls.findIndex(call => call.method === 'GET' && call.pathname === '/api/config');
    const firstRollupIndex = calls.findIndex(call => call.method === 'GET' && call.pathname === '/api/epm/projects/rollup/all');
    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(firstRollupIndex).toBeGreaterThan(configIndex);

    const rollupCalls = callsFor(calls, '/api/epm/projects/rollup/all');
    const rollupByTab = Object.fromEntries(rollupCalls.map(call => [call.params.tab || 'active', call]));
    expect(rollupByTab.active.params.sprint).toBe(String(selectedSprintId));
    expect(rollupByTab.backlog.params.sprint).toBeUndefined();
    expect(rollupByTab.archived.params.sprint).toBeUndefined();

    ['active', 'backlog', 'archived'].forEach(tab => {
        const metadataCalls = callsFor(calls, '/api/epm/projects')
            .filter(call => (call.params.tab || 'active') === tab);
        const tabRollups = rollupCalls.filter(call => (call.params.tab || 'active') === tab);
        expect(metadataCalls.length).toBeLessThanOrEqual(1);
        expect(tabRollups).toHaveLength(1);
    });
    expect(apiMocks.unexpectedCalls).toEqual([]);
});
