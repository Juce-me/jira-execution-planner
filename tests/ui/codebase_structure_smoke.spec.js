const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = '/tmp/codebase-structure-qa';
const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha', 'team-beta'];
let dashboardJs;

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

function epmProject(tab, index = 1) {
    const suffix = index === 1 ? '' : ` ${index}`;
    return {
        id: `${tab}-${index}`,
        homeProjectId: `${tab}-${index}`,
        name: `${tab[0].toUpperCase()}${tab.slice(1)} Project${suffix}`,
        displayName: `${tab[0].toUpperCase()}${tab.slice(1)} Project${suffix}`,
        label: `rnd_project_${tab}_${index}`,
        stateValue: tab === 'archived' ? 'DONE' : tab === 'backlog' ? 'PAUSED' : 'ON_TRACK',
        stateLabel: tab === 'archived' ? 'Done' : tab === 'backlog' ? 'Paused' : 'On track',
        tabBucket: tab,
        latestUpdateDate: '2026-04-29',
        latestUpdateSnippet: `${tab} project${suffix} update`,
        homeUrl: `https://home.atlassian.com/project/${tab}-${index}`,
        resolvedLinkage: { labels: [`rnd_project_${tab}_${index}`], epicKeys: [] },
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

function makeOpenCohortEpic(index) {
    const projectKey = index % 2 === 0 ? 'PROD' : 'TECH';
    const day = String((index % 28) + 1).padStart(2, '0');
    return {
        key: `${projectKey}-OPEN-${index + 1}`,
        summary: `Open cohort epic ${index + 1}`,
        projectKey,
        status: 'open',
        jiraStatus: 'In Progress',
        createdDate: `2026-01-${day}`,
        terminalDate: null,
        leadTimeDays: null,
        assignee: { id: `${projectKey.toLowerCase()}-lead`, name: `${projectKey} Lead` },
    };
}

function makeCompletedCohortEpic(index) {
    const projectKey = index % 2 === 0 ? 'PROD' : 'TECH';
    const createdDay = String((index % 28) + 1).padStart(2, '0');
    const terminalDay = String((index % 28) + 1).padStart(2, '0');
    return {
        key: `${projectKey}-DONE-${index + 1}`,
        summary: `Completed cohort epic ${index + 1}`,
        projectKey,
        status: 'done',
        jiraStatus: 'Done',
        createdDate: `2026-01-${createdDay}`,
        terminalDate: `2026-04-${terminalDay}`,
        leadTimeDays: 90 + index,
        assignee: { id: `${projectKey.toLowerCase()}-lead`, name: `${projectKey} Lead` },
    };
}

function makeExcludedCapacityIssue({ key, epicKey, epicSummary, teamId, teamName, points, projectKey }) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} excluded capacity source story`,
            status: { name: 'To Do' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: `${teamName} Owner` },
            customfield_10004: points,
            epicKey,
            epicSummary,
            parentSummary: epicSummary,
            projectKey,
            teamId,
            teamName,
            customfield_10101: [{ id: selectedSprintId, name: selectedSprintName }],
        },
    };
}

const productTasks = Array.from({ length: 12 }, (_, index) => makeEngTask('product', index + 1));
const techTasks = Array.from({ length: 12 }, (_, index) => makeEngTask('tech', index + 1));
const expectedStatsIssueKeys = [...productTasks, ...techTasks].map(task => task.key).sort();
const productEpic = makeEpic('product');
const techEpic = makeEpic('tech');
const excludedCapacitySourceIssues = [
    makeExcludedCapacityIssue({
        key: 'BAU-1',
        epicKey: 'BAU-EPIC',
        epicSummary: 'BAU Intake',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        points: 2,
        projectKey: 'PROD',
    }),
    makeExcludedCapacityIssue({
        key: 'TECH-SHARE-1',
        epicKey: 'TECH-EPIC',
        epicSummary: 'Tech delivery epic',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        points: 3,
        projectKey: 'TECH',
    }),
    makeExcludedCapacityIssue({
        key: 'PROD-SHARE-1',
        epicKey: 'PROD-EPIC',
        epicSummary: 'Product delivery epic',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        points: 5,
        projectKey: 'PROD',
    }),
    makeExcludedCapacityIssue({
        key: 'BAU-2',
        epicKey: 'BAU-EPIC',
        epicSummary: 'BAU Intake',
        teamId: 'team-beta',
        teamName: 'Beta Team',
        points: 1,
        projectKey: 'PROD',
    }),
    makeExcludedCapacityIssue({
        key: 'TECH-SHARE-2',
        epicKey: 'TECH-EPIC',
        epicSummary: 'Tech delivery epic',
        teamId: 'team-beta',
        teamName: 'Beta Team',
        points: 1,
        projectKey: 'TECH',
    }),
    makeExcludedCapacityIssue({
        key: 'PROD-SHARE-2',
        epicKey: 'PROD-EPIC',
        epicSummary: 'Product delivery epic',
        teamId: 'team-beta',
        teamName: 'Beta Team',
        points: 8,
        projectKey: 'PROD',
    }),
];
const scenarioTeams = Array.from({ length: 14 }, (_, index) => (
    index === 0 ? 'Alpha Team' : index === 1 ? 'Beta Team' : `Scenario Team ${index + 1}`
));

function makeEpmStory(tab, index, epicKey, projectIndex = 1) {
    const suffix = projectIndex === 1 ? '' : `-${projectIndex}`;
    return {
        key: `${tab.toUpperCase()}${suffix}-STORY-${index}`,
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

function epmRollup(tab, projectIndex = 1) {
    if (tab === 'archived') {
        return { metadataOnly: true };
    }
    const suffix = projectIndex === 1 ? '' : `-${projectIndex}`;
    const epicKey = `${tab.toUpperCase()}${suffix}-EPIC`;
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
                stories: Array.from({ length: 10 }, (_, index) => makeEpmStory(tab, index + 1, epicKey, projectIndex)),
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
        capacity_by_team: Object.fromEntries(scenarioTeams.map((team, index) => [
            team,
            { size: 2 + (index % 3), devLead: `${team} Lead` },
        ])),
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
            ...scenarioTeams.slice(2).map((team, index) => ({
                key: `SCEN-${index + 1}`,
                summary: `Build scenario smoke lane ${index + 1}`,
                epicKey: 'PROD-EPIC',
                epicSummary: 'Product delivery epic',
                team,
                assignee: `${team} Owner`,
                sp: 1,
                start: '2026-04-08',
                end: '2026-04-11',
            })),
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

function requestBody(request) {
    const postData = request.postData();
    if (!postData) return null;
    try {
        return JSON.parse(postData);
    } catch (err) {
        return postData;
    }
}

async function waitForCallCount(calls, predicate, expected, timeout = 7000) {
    await expect.poll(
        () => calls.filter(predicate).length,
        { timeout }
    ).toBe(expected);
}

async function waitForVisualSettled(page) {
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const waitForAnimations = async () => {
            const animations = document.getAnimations({ subtree: true });
            if (animations.length === 0) return;
            await Promise.race([
                Promise.all(animations.map(animation => animation.finished.catch(() => undefined))),
                new Promise(resolve => window.setTimeout(resolve, 1200)),
            ]);
        };
        await waitForAnimations();
        await new Promise(requestAnimationFrame);
        await waitForAnimations();
    });
}

async function captureSmokeScreenshot(page, name) {
    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true });
}

async function expectJiraExportMenu(page) {
    const trigger = page.getByRole('button', { name: 'Open Jira issue menu' }).first();
    await expect(trigger).toBeVisible();
    const iconBox = await trigger.locator('.jira-export-icon').boundingBox();
    expect(iconBox).not.toBeNull();
    expect(iconBox.width).toBeGreaterThanOrEqual(18);
    expect(iconBox.height).toBeGreaterThanOrEqual(18);
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Open epics/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Open stories/ })).toBeVisible();
    const layerState = await menu.evaluate((menuNode) => {
        const rect = menuNode.getBoundingClientRect();
        const points = [
            { x: rect.left + rect.width / 2, y: rect.top + 16 },
            { x: rect.left + 24, y: rect.top + 24 },
            { x: rect.right - 24, y: rect.top + 24 },
        ];
        return points.map((point) => {
            const topNode = document.elementFromPoint(point.x, point.y);
            return {
                point,
                topClass: topNode?.className || '',
                topText: topNode?.textContent || '',
                topIsMenu: Boolean(topNode?.closest?.('.jira-export-menu')),
            };
        });
    });
    expect(layerState.every(point => point.topIsMenu), JSON.stringify(layerState, null, 2)).toBe(true);
    await page.mouse.click(8, 8);
    await expect(menu).toHaveCount(0);
}

async function expectTeamDropdownAboveStatsPanel(page) {
    const control = page.locator('.view-selector .team-dropdown').first();
    const toggle = control.locator('.team-dropdown-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const panel = control.locator('.team-dropdown-panel');
    await expect(panel).toBeVisible();
    const layerState = await panel.evaluate((panelNode) => {
        const rect = panelNode.getBoundingClientRect();
        const points = [
            { x: rect.left + rect.width / 2, y: rect.top + 18 },
            { x: rect.left + 24, y: rect.top + 36 },
            { x: rect.right - 24, y: rect.top + 36 },
        ];
        return points.map((point) => {
            const topNode = document.elementFromPoint(point.x, point.y);
            return {
                point,
                topClass: topNode?.className || '',
                topText: topNode?.textContent || '',
                topIsPanel: Boolean(topNode?.closest?.('.team-dropdown-panel')),
            };
        });
    });
    expect(layerState.every(point => point.topIsPanel), JSON.stringify(layerState, null, 2)).toBe(true);
    const overlapState = await panel.evaluate((panelNode) => {
        const statsPanel = document.querySelector('.stats-panel.open');
        const panelRect = panelNode.getBoundingClientRect();
        const statsRect = statsPanel?.getBoundingClientRect();
        if (!statsRect) return [{ skipped: true, reason: 'stats panel missing' }];
        const top = Math.max(panelRect.top, statsRect.top + 8);
        const bottom = Math.min(panelRect.bottom, statsRect.bottom - 8);
        if (bottom <= top) return [{ skipped: true, reason: 'no overlap' }];
        const y = top + ((bottom - top) / 2);
        const points = [
            { x: panelRect.left + panelRect.width / 2, y },
            { x: panelRect.left + 24, y },
            { x: panelRect.right - 24, y },
        ];
        return points.map((point) => {
            const topNode = document.elementFromPoint(point.x, point.y);
            return {
                point,
                topClass: topNode?.className || '',
                topText: topNode?.textContent || '',
                topIsPanel: Boolean(topNode?.closest?.('.team-dropdown-panel')),
            };
        });
    });
    expect(
        overlapState.every(point => point.skipped || point.topIsPanel),
        JSON.stringify(overlapState, null, 2)
    ).toBe(true);
    await page.mouse.click(8, 8);
}

async function expectEffortSplitReadoutTracksPointer(page) {
    const segment = page.locator('.effort-type-split-row', { hasText: 'Alpha Team' })
        .locator('.effort-type-split-segment.product')
        .first();
    await expect(segment).toBeVisible();
    const segmentBox = await segment.boundingBox();
    expect(segmentBox).not.toBeNull();
    const pointer = {
        x: segmentBox.x + segmentBox.width * 0.75,
        y: segmentBox.y + segmentBox.height / 2,
    };
    await page.mouse.move(pointer.x, pointer.y);
    const readout = page.locator('.effort-type-split-readout');
    await expect(readout).toBeVisible();
    const layout = await readout.evaluate((node, anchor) => {
        const rect = node.getBoundingClientRect();
        return {
            top: rect.top,
            bottom: rect.bottom,
            centerY: rect.top + rect.height / 2,
            width: rect.width,
            viewportHeight: window.innerHeight,
            distanceFromPointer: Math.abs((rect.top + rect.height / 2) - anchor.y),
        };
    }, pointer);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.width).toBeLessThanOrEqual(220);
    expect(layout.distanceFromPointer).toBeLessThanOrEqual(60);
}

async function expectLineChartReadoutStaysInsideStatsPanel(page) {
    const capture = page.locator('.excluded-capacity-line-hover-capture').first();
    await expect(capture).toBeVisible();
    await capture.scrollIntoViewIfNeeded();
    const captureBox = await capture.boundingBox();
    expect(captureBox).not.toBeNull();
    await page.mouse.move(captureBox.x + captureBox.width - 4, captureBox.y + captureBox.height / 2);
    const bubble = page.locator('.excluded-capacity-line-hover-bubble');
    await expect(bubble).toBeVisible();
    const layout = await bubble.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const panelRect = document.querySelector('.stats-panel.open')?.getBoundingClientRect();
        const chartRect = document.querySelector('.stats-view.open .excluded-capacity-line-chart')?.getBoundingClientRect();
        const zIndex = Number.parseInt(getComputedStyle(node).zIndex || '0', 10);
        return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            panelLeft: panelRect?.left,
            panelRight: panelRect?.right,
            chartLeft: chartRect?.left,
            chartRight: chartRect?.right,
            zIndex,
            text: node.textContent || '',
        };
    });
    expect(layout.width).toBeGreaterThanOrEqual(200);
    expect(layout.left).toBeGreaterThanOrEqual(layout.panelLeft);
    expect(layout.right).toBeLessThanOrEqual(layout.panelRight);
    expect(layout.left).toBeGreaterThanOrEqual(layout.chartLeft);
    expect(layout.right).toBeLessThanOrEqual(layout.chartRight);
    expect(layout.zIndex).toBeGreaterThan(80);
    expect(layout.text).toContain('Team');
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
    const scrollState = await locator.evaluate((element, scrollerSelector) => {
        const scroller = element.closest(scrollerSelector) || document.querySelector(scrollerSelector);
        scroller.scrollTop = 160;
        return {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
        };
    }, containerSelector);
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    expect(scrollState.scrollTop).toBeGreaterThan(0);
    await waitForVisualSettled(page);
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
    await installDashboardShell(page);
    if (!options.useCommittedDist) {
        await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: dashboardJs,
        }));
    }
    const configGate = options.delayConfig ? createDeferred() : null;
    const sprintGate = options.delaySprintsUntilEpmProjects ? createDeferred() : null;
    const epmProjectsGate = options.delaySprintsUntilEpmProjects ? createDeferred() : null;
    const epmProjectCount = options.epmProjectCount || 1;
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
            headers: request.headers(),
            body: requestBody(request),
        });
        const json = (body, headers = {}) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers,
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/me/connections/home-token') {
            return json({
                connected: true,
                provider: 'atlassian_user_api_token',
                credentialSubject: 'profile@example.com',
                status: 'active',
                needsReconnect: false,
            });
        }
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
                    excludedCapacityEpics: options.excludedCapacityEpics || [],
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/board-config') return json({ boardId: '5494', boardName: 'Synthetic Board', source: 'test' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/stats/burnout') {
            return json({
                data: {
                    range: { startDate: '2026-04-01', endDate: '2026-04-15' },
                    issuesMeta: [
                        {
                            issueKey: 'PROD-1',
                            createdDate: '2026-03-27',
                            teamAtStart: { id: 'team-beta', name: 'Beta Team' },
                            teamAtCreated: { id: 'team-beta', name: 'Beta Team' },
                            assignee: { id: 'beta-owner', name: 'Beta Team Owner' },
                        },
                        {
                            issueKey: 'PROD-2',
                            createdDate: '2026-04-03',
                            teamAtStart: { id: 'team-alpha', name: 'Alpha Team' },
                            teamAtCreated: { id: 'team-alpha', name: 'Alpha Team' },
                            assignee: { id: 'alpha-owner', name: 'Alpha Team Owner' },
                        },
                        {
                            issueKey: 'TECH-1',
                            createdDate: '2026-03-28',
                            teamAtStart: { id: 'team-beta', name: 'Beta Team' },
                            teamAtCreated: { id: 'team-beta', name: 'Beta Team' },
                            assignee: { id: 'beta-owner', name: 'Beta Team Owner' },
                        },
                        {
                            issueKey: 'TECH-2',
                            createdDate: '2026-04-04',
                            teamAtStart: { id: 'team-alpha', name: 'Alpha Team' },
                            teamAtCreated: { id: 'team-alpha', name: 'Alpha Team' },
                            assignee: { id: 'alpha-owner', name: 'Alpha Team Owner' },
                        },
                    ],
                    events: [
                        {
                            issueKey: 'PROD-1',
                            date: '2026-04-07',
                            bucket: 'done',
                            teamId: 'team-beta',
                            teamName: 'Beta Team',
                            assigneeName: 'Beta Team Owner',
                        },
                        {
                            issueKey: 'TECH-1',
                            date: '2026-04-09',
                            bucket: 'incomplete',
                            teamId: 'team-beta',
                            teamName: 'Beta Team',
                            assigneeName: 'Beta Team Owner',
                        },
                    ],
                    assignees: [
                        { id: 'alpha-owner', name: 'Alpha Team Owner', events: 1 },
                        { id: 'beta-owner', name: 'Beta Team Owner', events: 2 },
                    ],
                },
            });
        }
        if (url.pathname === '/api/stats/epic-cohort') {
            return json({
                data: {
                    range: { startDate: '2026-01-01', endDate: '2026-06-30' },
                    issues: options.cohortIssues || [
                        {
                            key: 'PROD-EPIC',
                            summary: 'Product delivery epic',
                            projectKey: 'PROD',
                            status: 'done',
                            createdDate: '2026-01-10',
                            terminalDate: '2026-04-10',
                            leadTimeDays: 90,
                            assignee: { id: 'alpha-lead', name: 'Alpha Lead' },
                        },
                        {
                            key: 'TECH-EPIC',
                            summary: 'Tech delivery epic',
                            projectKey: 'TECH',
                            status: 'open',
                            jiraStatus: 'In Progress',
                            createdDate: '2026-02-12',
                            terminalDate: null,
                            leadTimeDays: null,
                            assignee: { id: 'beta-lead', name: 'Beta Lead' },
                        },
                        {
                            key: 'VALIDATION-EPIC',
                            summary: 'Validation delivery epic',
                            projectKey: 'PROD',
                            status: 'open',
                            jiraStatus: 'Awaiting Validation',
                            createdDate: '2026-04-12',
                            terminalDate: null,
                            leadTimeDays: null,
                            assignee: { id: 'alpha-lead', name: 'Alpha Lead' },
                        },
                    ],
                    meta: { warnings: [] },
                },
            });
        }
        if (url.pathname === '/api/capacity/config') return json({ project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json({ fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Epic'] });
        if (url.pathname === '/api/issue-types') return json({ issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') {
            if (sprintGate) {
                await sprintGate.promise;
                setTimeout(() => epmProjectsGate.resolve(), 50);
            }
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        }
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
        if (url.pathname === '/api/stats/excluded-capacity-source') {
            return json({
                data: {
                    issues: excludedCapacitySourceIssues,
                    meta: {
                        warnings: [],
                        queryPages: 1,
                        loadedSprintCount: 1,
                        totalSprintCount: 1,
                    },
                },
            });
        }
        if (url.pathname === '/api/scenario/drafts') {
            return json({
                activeDraft: null,
                versions: [],
                storage: 'db',
            });
        }
        if (url.pathname === '/api/epm/projects') {
            if (sprintGate) {
                sprintGate.resolve();
                await epmProjectsGate.promise;
            }
            const tab = url.searchParams.get('tab') || 'active';
            return json({
                projects: Array.from({ length: epmProjectCount }, (_, index) => epmProject(tab, index + 1)),
            });
        }
        if (url.pathname === '/api/epm/goals') {
            return json({
                goals: [
                    { id: 'root', key: 'ROOT-100', name: 'Synthetic Root Goal' },
                    { id: 'child', key: 'CHILD-200', name: 'Synthetic Child Goal' },
                ],
                error: '',
            });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            if (!state.configReleased) {
                state.rollupBeforeConfigRelease = true;
            }
            const tab = url.searchParams.get('tab') || 'active';
            return json({
                projects: Array.from({ length: epmProjectCount }, (_, index) => {
                    const projectIndex = index + 1;
                    return {
                        project: epmProject(tab, projectIndex),
                        rollup: epmRollup(tab, projectIndex),
                    };
                }),
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
    await page.setViewportSize({ width: 1028, height: 720 });
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

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Catch Up')).toBeVisible();
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name', 4);
    await waitForCallCount(calls, call => call.pathname === '/api/missing-info', 1);
    await expect(page.locator('.epic-header').first()).toBeVisible();
    await expect(page.locator('.task-list > .epic-block').first().locator('.epic-status-pill')).toHaveText('In Progress');
    await expectJiraExportMenu(page);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Statistics' }).click();
    await expect(page.locator('.stats-panel.open')).toBeVisible();
    await expectTeamDropdownAboveStatsPanel(page);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.locator('.epic-header').first()).toBeVisible();
    await captureSmokeScreenshot(page, 'catch-up');
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

    const stickyEngModes = page.locator('.compact-sticky-header .eng-mode-control');
    await stickyEngModes.getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.getByText('Selected SP by Project:')).toBeVisible();
    const projectSplitBarVisible = await page.locator('.project-bar-graph').isVisible().catch(() => false);
    const projectSplitEmptyVisible = await page.getByText('No tasks selected').isVisible().catch(() => false);
    expect(projectSplitBarVisible || projectSplitEmptyVisible).toBeTruthy();
    await captureSmokeScreenshot(page, 'planning');
    await expectWindowSticky(page, '.planning-panel.open');
    await expectPlanningAboveEpic(page);

    await stickyEngModes.getByRole('radio', { name: 'Scenario' }).click();
    await expect(page.getByText('Scenario Planner')).toBeVisible();
    await page.getByRole('button', { name: 'Run Scenario' }).click();
    await expect(page.locator('.scenario-axis')).toBeVisible();
    await expectJiraExportMenu(page);
    await captureSmokeScreenshot(page, 'scenario');
    await expectContainerSticky(page, '.scenario-axis', '.scenario-timeline');
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Statistics subviews render extracted panels and preserve stats API ownership', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        excludedCapacityEpics: ['BAU-EPIC'],
        useCommittedDist: true,
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showPlanning: false,
        showScenario: false,
        showStats: true,
        statsView: 'teams',
        cohortStartQuarter: '2026Q2',
        excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name', 4);
    const statsPanel = page.locator('.stats-panel.open');
    const statsTabs = statsPanel.locator('.stats-view-toggle');
    await expect(statsPanel).toBeVisible();
    await expect(statsTabs.getByRole('radio', { name: 'Teams' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.stats-view.open .stats-bars')).toBeVisible();
    await expect(page.locator('.stats-view.open .stats-table')).toContainText('Alpha Team');
    await captureSmokeScreenshot(page, 'statistics-teams');

    await statsTabs.getByRole('radio', { name: 'Priority' }).click();
    await expect(page.locator('.stats-view.open .priority-radar')).toBeVisible();
    await expect(page.locator('.stats-view.open .priority-legend')).toContainText('Alpha Team');
    await expect(page.locator('.stats-view.open .stats-table')).toContainText('Major');
    await captureSmokeScreenshot(page, 'statistics-priority');

    await statsTabs.getByRole('radio', { name: 'Burndown' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/burnout', 1);
    await expect(page.locator('.stats-view.open .burnout-summary')).toContainText('Remaining');
    await expect(page.locator('.stats-view.open .burnout-chart')).toBeVisible();
    await expect(page.locator('.stats-view.open .burnout-legend')).toContainText('Alpha Team');
    const burnoutCall = callsFor(calls, '/api/stats/burnout', 'POST')[0];
    expect(burnoutCall.headers['x-requested-with']).toBe('jira-execution-planner');
    expect(burnoutCall.body).toMatchObject({
        sprint: selectedSprintName,
        teamIds: groupTeamIds,
        includePostSprintClosures: false,
    });
    expect([...burnoutCall.body.issueKeys].sort()).toEqual(expectedStatsIssueKeys);
    await captureSmokeScreenshot(page, 'statistics-burndown');

    await statsTabs.getByRole('radio', { name: 'Lead Times' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 1);
    const cohortSummary = page.locator('.stats-view.open .cohort-summary');
    await expect(cohortSummary).toContainText('Epics Overview');
    await expect(cohortSummary).toContainText('1 in progress · 0 postponed · 1 awaiting validation');
    const leadTimesJiraLink = cohortSummary.getByRole('link', { name: 'Open in progress, postponed, and awaiting validation epics in Jira' });
    await expect(leadTimesJiraLink).toBeVisible();
    const leadTimesJql = decodeURIComponent(new URL(await leadTimesJiraLink.getAttribute('href')).searchParams.get('jql'));
    expect(leadTimesJql).toBe('issuetype = "Epic" AND created >= "2026-04-01" AND status in ("In Progress", "Postponed", "Awaiting Validation")');
    await expect(page.locator('.stats-view.open')).toContainText('Cohort Heatmap');
    await expect(page.locator('.stats-view.open')).toContainText('In Progress');
    await expect(page.locator('.stats-view.open')).toContainText('Awaiting Validation');
    await expect(page.locator('.stats-view.open')).toContainText('Created on or after the selected Lead Times start quarter and still non-terminal today.');
    await expect(page.locator('.stats-view.open')).toContainText('Created on or after the selected Lead Times start quarter and reached a terminal status, with lead time shown.');
    const openLeadTimesSection = page.locator('.cohort-section', { hasText: 'Open Epics (All Cohorts)' }).first();
    const openLeadTimesJiraLink = openLeadTimesSection.getByRole('link', { name: 'Open all open epics in Jira' });
    await expect(openLeadTimesJiraLink).toBeVisible();
    const openLeadTimesJql = decodeURIComponent(new URL(await openLeadTimesJiraLink.getAttribute('href')).searchParams.get('jql'));
    expect(openLeadTimesJql).toContain('issuetype = "Epic"');
    expect(openLeadTimesJql).toContain('created >= "2026-04-01"');
    expect(openLeadTimesJql).toContain('status in ("In Progress", "Awaiting Validation")');
    expect(openLeadTimesJql).toContain('"Team[Team]" in ("team-alpha", "team-beta")');
    expect(openLeadTimesJql).not.toContain('key in');
    const completedLeadTimesSection = page.locator('.cohort-section', { hasText: 'Completed Epics — Lead Time (All Cohorts)' }).first();
    const completedLeadTimesJiraLink = completedLeadTimesSection.getByRole('link', { name: 'Open all completed epics in Jira' });
    await expect(completedLeadTimesJiraLink).toBeVisible();
    const completedLeadTimesJql = decodeURIComponent(new URL(await completedLeadTimesJiraLink.getAttribute('href')).searchParams.get('jql'));
    expect(completedLeadTimesJql).toContain('status in ("Done")');
    expect(completedLeadTimesJql).not.toContain('key in');
    const headingLayout = await openLeadTimesSection.locator('.cohort-open-heading').evaluate((heading) => {
        const title = heading.querySelector('.cohort-open-title')?.getBoundingClientRect();
        const description = heading.querySelector('.cohort-open-description')?.getBoundingClientRect();
        const button = heading.querySelector('.cohort-open-jira-button')?.getBoundingClientRect();
        return {
            sameLine: Boolean(title && description && Math.abs(title.top - description.top) < 4),
            buttonAfterText: Boolean(description && button && button.left >= description.left),
        };
    });
    expect(headingLayout.sameLine).toBeTruthy();
    expect(headingLayout.buttonAfterText).toBeTruthy();
    const cohortCall = callsFor(calls, '/api/stats/epic-cohort', 'POST')[0];
    expect(cohortCall.headers['x-requested-with']).toBe('jira-execution-planner');
    expect(cohortCall.body).toMatchObject({
        startQuarter: '2026Q2',
        teamIds: groupTeamIds,
        components: [],
        refresh: false,
    });
    await captureSmokeScreenshot(page, 'statistics-lead-times');

    await statsTabs.getByRole('radio', { name: 'Excluded Capacity' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/excluded-capacity-source', 1);
    await expect(page.locator('.stats-view.open .effort-type-split-chart')).toBeVisible();

    await statsTabs.getByRole('radio', { name: 'Mono vs Cross' }).click();
    await expect(page.locator('.stats-view.open')).toContainText('Team Cross Share');
    await expect(page.locator('.stats-view.open .excluded-capacity-line-chart')).toBeVisible();

    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Lead Times caps long epic lists with load more and keeps overflow scrollable', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        cohortIssues: [
            ...Array.from({ length: 45 }, (_, index) => makeOpenCohortEpic(index)),
            ...Array.from({ length: 45 }, (_, index) => makeCompletedCohortEpic(index)),
        ],
        useCommittedDist: true,
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showPlanning: false,
        showScenario: false,
        showStats: true,
        statsView: 'cohort',
        cohortStartQuarter: '2026Q1',
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 1);

    const openSection = page.locator('.cohort-section', { hasText: 'Open Epics (All Cohorts)' }).first();
    const openRows = openSection.locator('.cohort-open-row');
    await expect(openRows).toHaveCount(30);
    const loadMoreButton = openSection.getByRole('button', { name: /Load 15 more from 45 open epics/ });
    await expect(loadMoreButton).toBeVisible();

    const layout = await openRows.last().evaluate((lastRow) => {
        const statsPanel = document.querySelector('.stats-panel.open');
        const statsView = document.querySelector('.stats-view.open');
        const statsRect = statsPanel?.getBoundingClientRect();
        const rowRect = lastRow.getBoundingClientRect();
        return {
            statsMaxHeight: statsPanel ? getComputedStyle(statsPanel).maxHeight : '',
            statsViewMaxHeight: statsView ? getComputedStyle(statsView).maxHeight : '',
            statsViewOverflow: statsView ? getComputedStyle(statsView).overflow : '',
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            statsPanelHeight: statsRect?.height || 0,
            statsPanelBottom: statsRect ? statsRect.bottom + window.scrollY : 0,
            lastRowBottom: rowRect.bottom + window.scrollY,
        };
    });
    expect(layout.statsMaxHeight).toBe('none');
    expect(layout.statsViewMaxHeight).toBe('none');
    expect(layout.statsViewOverflow).toBe('visible');
    expect(layout.documentHeight).toBeGreaterThan(layout.viewportHeight);
    expect(layout.documentHeight).toBeGreaterThanOrEqual(layout.lastRowBottom);
    expect(layout.statsPanelBottom).toBeGreaterThanOrEqual(layout.lastRowBottom);

    await loadMoreButton.click();
    await expect(openRows).toHaveCount(45);

    const completedSection = page.locator('.cohort-section', { hasText: 'Completed Epics — Lead Time (All Cohorts)' }).first();
    const completedRows = completedSection.locator('.cohort-open-row');
    await expect(completedRows).toHaveCount(30);
    const completedLoadMoreButton = completedSection.getByRole('button', { name: /Load 15 more from 45 completed epics/ });
    await expect(completedLoadMoreButton).toBeVisible();
    await completedLoadMoreButton.click();
    await expect(completedRows).toHaveCount(45);

    await openRows.last().scrollIntoViewIfNeeded();
    await expect(openRows.last()).toBeVisible();
    await captureSmokeScreenshot(page, 'statistics-lead-times-open-scroll');

    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Excluded Capacity summary shows product and tech shares instead of source copy', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, { excludedCapacityEpics: ['BAU-EPIC'] });
    await page.setViewportSize({ width: 2048, height: 760 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showStats: true,
        statsView: 'excludedCapacity',
        excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/stats/excluded-capacity-source', 1);

    const summary = page.locator('.stats-view.open .excluded-capacity-summary');
    await expect(summary).toBeVisible();
    await expect(summary.locator('.stats-card', { hasText: 'Excluded Share' })).toContainText('15.00%');
    await expect(summary.locator('.stats-card', { hasText: 'Product Share' })).toContainText('65.00%');
    await expect(summary.locator('.stats-card', { hasText: 'Tech Share' })).toContainText('20.00%');
    await expect(summary.getByText('Source')).toHaveCount(0);
    await expect(summary.getByText('Planning config')).toHaveCount(0);
    await expect(summary.getByText('Excluded epic keys from team group settings')).toHaveCount(0);
    await expectTeamDropdownAboveStatsPanel(page);
    await expectEffortSplitReadoutTracksPointer(page);
    await expectLineChartReadoutStaysInsideStatsPanel(page);
    await captureSmokeScreenshot(page, 'excluded-capacity-share-summary');
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('team dropdown restores scoped team selection after page refresh', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls);
    await page.addInitScript(({ prefs, teamSelection }) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
        window.localStorage.setItem('jira_dashboard_team_selection_state_v1', JSON.stringify(teamSelection));
    }, {
        prefs: {
            selectedView: 'eng',
            selectedSprint: selectedSprintId,
            activeGroupId: 'grp-default',
            selectedTeams: ['all'],
            searchQuery: 'PROD-2',
            showPlanning: false,
            showScenario: false,
        },
        teamSelection: {
            [`team-selection::${selectedSprintId}::grp-default`]: {
                selectedTeams: ['team-alpha'],
                selectedTeamId: 'team-alpha',
            },
        },
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name', 4);
    const teamToggle = page.locator('.team-dropdown-toggle').first();
    await expect(teamToggle.locator('.team-dropdown-selection-label')).toHaveText('Alpha Team');
    await expect(teamToggle).toBeVisible();
    await expect(teamToggle).toHaveClass(/active-filter/);
    await expect(page.locator('.control-search').first()).toHaveClass(/active-filter/);
    await captureSmokeScreenshot(page, 'team-search-active-filters');
    await expect.poll(() => page.evaluate(() => {
        const raw = window.localStorage.getItem('jira_dashboard_team_selection_state_v1');
        const stored = JSON.parse(raw || '{}');
        return stored['team-selection::34625::grp-default']?.selectedTeams || [];
    })).toEqual(['team-alpha']);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(teamToggle.locator('.team-dropdown-selection-label')).toHaveText('Alpha Team');
    await expect(teamToggle).toBeVisible();
    await expect(teamToggle).toHaveClass(/active-filter/);
    await expect(page.locator('.control-search').first()).toHaveClass(/active-filter/);
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('EPM lifecycle tabs load after config with scoped rollup requests and sticky checks', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, { delayConfig: true });
    await page.setViewportSize({ width: 1028, height: 720 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => callsFor(calls, '/api/config').length).toBe(1);
    expect(callsFor(calls, '/api/epm/projects/rollup/all')).toHaveLength(0);
    apiMocks.releaseConfig();
    await page.waitForLoadState('networkidle');
    expect(apiMocks.state.rollupBeforeConfigRelease).toBe(false);

    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Project' })).toBeVisible();
    await page.getByRole('button', { name: 'Show Jira rollup for Active Project' }).first().click();
    await expect(page.locator('.epm-portfolio-board .epic-header').first()).toBeVisible();
    await expectJiraExportMenu(page);
    await page.screenshot({ path: `${screenshotDir}/epm-active.png`, fullPage: true });
    await expectWindowSticky(page, '.epm-portfolio-board .epic-header');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('radio', { name: 'Backlog' }).first().click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Backlog Project' })).toBeVisible();
    await page.getByRole('button', { name: 'Show Jira rollup for Backlog Project' }).first().click();
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

test('EPM all-project rollup retries after sprint selection arrives during project load', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, { delaySprintsUntilEpmProjects: true });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Project' })).toBeVisible();
    await expect(page.locator('.epm-project-board.is-collapsed')).toHaveCount(1);
    await expect(page.locator('.epm-portfolio-board .epic-header').first()).toBeHidden();

    const activeRollups = callsFor(calls, '/api/epm/projects/rollup/all')
        .filter(call => (call.params.tab || 'active') === 'active');
    expect(activeRollups).toHaveLength(1);
    expect(activeRollups[0].params.sprint).toBe(String(selectedSprintId));
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('EPM all-project board can collapse and expand all visible projects', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, { epmProjectCount: 3 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.epm-project-board')).toHaveCount(3);
    await expect(page.locator('.epm-project-board.is-collapsed')).toHaveCount(3);
    const collapseAllButton = page.getByRole('button', { name: 'Collapse all projects' }).first();
    const expandAllButton = page.getByRole('button', { name: 'Expand all projects' }).first();
    await expect(expandAllButton).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/epm-collapse-all-projects.png`, fullPage: true });

    const project2Board = page.locator('.epm-project-board', {
        has: page.locator('.epm-project-board-name', { hasText: 'Active Project 2' }),
    });
    await expect(project2Board).toHaveClass(/is-collapsed/);
    await page.evaluate(() => {
        window.__epmProjectScrollCalls = [];
        const originalScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function scrollIntoViewRecorder(options) {
            window.__epmProjectScrollCalls.push({
                className: this.getAttribute('class') || String(this.className || ''),
                text: String(this.textContent || '').slice(0, 120),
                behavior: options?.behavior,
                block: options?.block,
                inline: options?.inline,
            });
            if (typeof originalScrollIntoView === 'function') {
                const nextOptions = options && typeof options === 'object'
                    ? { ...options, behavior: 'auto' }
                    : options;
                originalScrollIntoView.call(this, nextOptions);
            }
        };
    });
    await project2Board.evaluate((node) => {
        window.scrollTo(0, document.body.scrollHeight);
        node.querySelector('.epm-project-board-toggle')?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        }));
    });
    await expect(page.locator('.epm-project-board.is-collapsed')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => (
        window.__epmProjectScrollCalls || []
    ).some(call => (
        call.className.includes('epm-project-board') &&
        call.text.includes('Active Project 2') &&
        call.behavior === 'smooth' &&
        call.block === 'start' &&
        call.inline === 'nearest'
    )))).toBe(true);

    await collapseAllButton.click();
    await expect(page.locator('.epm-project-board.is-collapsed')).toHaveCount(3);

    await expandAllButton.click();
    await expect(page.locator('.epm-project-board.is-collapsed')).toHaveCount(0);
    await expect(page.locator('.epm-project-board:not(.is-collapsed) .epic-header')).toHaveCount(3);

    await page.getByRole('button', { name: 'Active Project 2' }).click();
    await expect(page.locator('.epm-project-board.is-collapsed')).toHaveCount(1);
    await expect(collapseAllButton).toBeVisible();
    expect(apiMocks.unexpectedCalls).toEqual([]);
});
