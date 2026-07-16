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
const longSprintId = 34626;
const longSprintName = '2026Q3 Sprint 43 — International Platform Reliability and Migration';
const groupTeamIds = ['team-alpha', 'team-beta'];
let dashboardJs;
let statsUtils;

// Reuse the app's single Project Track color source in assertions. statsUtils.js is ESM
// (and pulls in ESM deps), so bundle it to a self-contained CJS module with the same
// esbuild the shell bundle uses, then eval it — this proves the phase chart uses
// resolveProjectTrackColor's output rather than a hardcoded hex duplicated in the test.
function loadStatsUtils() {
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'stats', 'statsUtils.js')],
        bundle: true,
        write: false,
        format: 'cjs',
    });
    const moduleShim = { exports: {} };
    new Function('module', 'exports', result.outputFiles[0].text)(moduleShim, moduleShim.exports);
    return moduleShim.exports;
}

function resolveProjectTrackColorFromSource(track) {
    return statsUtils.resolveProjectTrackColor(track);
}

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
    statsUtils = loadStatsUtils();
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

function makeExcludedCapacityIssue({ key, epicKey, epicSummary, teamId, teamName, points, projectKey, epicProjectTrack, epicAssignee }) {
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
            epicProjectTrack: epicProjectTrack || null,
            epicAssignee: epicAssignee ? { displayName: epicAssignee } : null,
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
        epicProjectTrack: 'Flexible',
        epicAssignee: 'Sam BAU',
    }),
    makeExcludedCapacityIssue({
        key: 'TECH-SHARE-1',
        epicKey: 'TECH-EPIC',
        epicSummary: 'Tech delivery epic',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        points: 3,
        projectKey: 'TECH',
        epicProjectTrack: 'Committed',
        epicAssignee: 'Tom Tech',
    }),
    makeExcludedCapacityIssue({
        key: 'PROD-SHARE-1',
        epicKey: 'PROD-EPIC',
        epicSummary: 'Product delivery epic',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        points: 5,
        projectKey: 'PROD',
        epicProjectTrack: 'Committed',
        epicAssignee: 'Pat Product',
    }),
    makeExcludedCapacityIssue({
        key: 'BAU-2',
        epicKey: 'BAU-EPIC',
        epicSummary: 'BAU Intake',
        teamId: 'team-beta',
        teamName: 'Beta Team',
        points: 1,
        projectKey: 'PROD',
        epicProjectTrack: 'Flexible',
        epicAssignee: 'Sam BAU',
    }),
    makeExcludedCapacityIssue({
        key: 'TECH-SHARE-2',
        epicKey: 'TECH-EPIC',
        epicSummary: 'Tech delivery epic',
        teamId: 'team-beta',
        teamName: 'Beta Team',
        points: 1,
        projectKey: 'TECH',
        epicProjectTrack: 'Committed',
        epicAssignee: 'Tom Tech',
    }),
    makeExcludedCapacityIssue({
        key: 'PROD-SHARE-2',
        epicKey: 'PROD-EPIC',
        epicSummary: 'Product delivery epic',
        teamId: 'team-beta',
        teamName: 'Beta Team',
        points: 8,
        projectKey: 'PROD',
        epicProjectTrack: 'Committed',
        epicAssignee: 'Pat Product',
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

// Independent ordinal check (not the app's own compareQuarterLabels) so the test does not
// share a bug with the implementation it is verifying.
function quarterLabelOrdinal(label) {
    const match = String(label || '').match(/^(\d{4})Q([1-4])$/);
    return match ? (Number(match[1]) * 4) + Number(match[2]) : null;
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
            return json({
                sprints: options.sprints || [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            });
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
        if (url.pathname === '/api/stats/project-track-phase-durations') {
            const body = request.postDataJSON() || {};
            const epicKeys = Array.isArray(body.epicKeys) ? body.epicKeys : [];
            return json({
                epics: epicKeys.map((key) => ({
                    key,
                    summary: `${key} summary`,
                    currentValue: 'Committed',
                    durations: { 'No track': 5, 'Committed': 20 },
                    created: '2026-01-01T00:00:00.000+0000',
                    transitions: [
                        { date: '2026-01-06T00:00:00.000+0000', from: null, to: 'Committed' },
                    ],
                })),
                meta: { truncated: false, processedEpicCount: epicKeys.length, warnings: [] },
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
        cohortStartQuarter: '2026Q1',
        cohortEndQuarter: '2026Q2',
        excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name', 4);
    const statsPanel = page.locator('.stats-panel.open');
    const statsTabs = statsPanel.locator('.stats-view-toggle');
    const legendColors = async (selector) => page.locator(selector).evaluateAll((items) => Object.fromEntries(
        items.map((item) => [item.textContent.trim(), getComputedStyle(item.querySelector('i')).backgroundColor])
    ));
    await expect(statsPanel).toBeVisible();
    await expect(statsTabs.getByRole('radio', { name: 'Teams' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.stats-view.open .stats-bars')).toBeVisible();
    await expect(page.locator('.stats-view.open .stats-table')).toContainText('Alpha Team');
    await captureSmokeScreenshot(page, 'statistics-teams');

    await statsTabs.getByRole('radio', { name: 'Priority' }).click();
    await expect(page.locator('.stats-view.open .priority-radar')).toBeVisible();
    await expect(page.locator('.stats-view.open .priority-legend')).toContainText('Alpha Team');
    await expect(page.locator('.stats-view.open .stats-table')).toContainText('Major');
    const priorityLegendColors = await legendColors('.stats-view.open .priority-legend > span');
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
    const burnoutLegendColors = await legendColors('.stats-view.open .burnout-legend > span');
    await captureSmokeScreenshot(page, 'statistics-burndown');

    await statsTabs.getByRole('radio', { name: 'Lead Times' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 1);
    const cohortSummary = page.locator('.stats-view.open .cohort-summary');
    await expect(cohortSummary).toContainText('Epics Overview');
    await expect(cohortSummary.getByRole('heading', { name: 'Workflow Status', exact: true })).toBeVisible();
    await expect(cohortSummary).toContainText('1 in progress · 0 postponed · 1 awaiting validation');
    const leadTimesJiraLink = cohortSummary.getByRole('link', { name: 'Open in progress, postponed, and awaiting validation epics in Jira' });
    await expect(leadTimesJiraLink).toBeVisible();
    const leadTimesJql = decodeURIComponent(new URL(await leadTimesJiraLink.getAttribute('href')).searchParams.get('jql'));
    expect(leadTimesJql).toBe('issuetype = "Epic" AND created >= "2026-01-01" AND created < "2026-07-01" AND status in ("In Progress", "Postponed", "Awaiting Validation")');
    await expect(page.locator('.stats-view.open')).toContainText('Cohort Heatmap');
    await expect(page.locator('.stats-view.open')).toContainText('In Progress');
    await expect(page.locator('.stats-view.open')).toContainText('Awaiting Validation');
    await expect(page.locator('.stats-view.open')).toContainText('Created within the selected Lead Times quarter range and still non-terminal today.');
    await expect(page.locator('.stats-view.open')).toContainText('Created within the selected Lead Times quarter range and reached a terminal status, with lead time shown.');
    const openLeadTimesSection = page.locator('.cohort-section', { hasText: 'Open Epics (All Cohorts)' }).first();
    const openLeadTimesJiraLink = openLeadTimesSection.getByRole('link', { name: 'Open all open epics in Jira' });
    await expect(openLeadTimesJiraLink).toBeVisible();
    const openLeadTimesJql = decodeURIComponent(new URL(await openLeadTimesJiraLink.getAttribute('href')).searchParams.get('jql'));
    expect(openLeadTimesJql).toContain('issuetype = "Epic"');
    expect(openLeadTimesJql).toContain('created >= "2026-01-01"');
    expect(openLeadTimesJql).toContain('created < "2026-07-01"');
    expect(openLeadTimesJql).toContain('status in ("In Progress", "Awaiting Validation")');
    expect(openLeadTimesJql).toContain('"Team[Team]" in ("team-alpha", "team-beta")');
    expect(openLeadTimesJql).not.toContain('key in');
    const completedLeadTimesSection = page.locator('.cohort-section', { hasText: 'Completed Epics — Lead Time (All Cohorts)' }).first();
    const completedLeadTimesJiraLink = completedLeadTimesSection.getByRole('link', { name: 'Open all completed epics in Jira' });
    await expect(completedLeadTimesJiraLink).toBeVisible();
    const completedLeadTimesJql = decodeURIComponent(new URL(await completedLeadTimesJiraLink.getAttribute('href')).searchParams.get('jql'));
    expect(completedLeadTimesJql).toContain('created >= "2026-01-01"');
    expect(completedLeadTimesJql).toContain('created < "2026-07-01"');
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
        startQuarter: '2026Q1',
        endQuarter: '2026Q2',
        teamIds: groupTeamIds,
        components: [],
        refresh: false,
    });
    await captureSmokeScreenshot(page, 'statistics-lead-times');

    await page.setViewportSize({ width: 1964, height: 900 });
    const cohortControls = page.locator('.stats-view.open .cohort-controls');
    const desktopControlLayout = await cohortControls.evaluate((node) => {
        const groups = Array.from(node.querySelectorAll(':scope > .stats-control-group'));
        const headings = Array.from(node.querySelectorAll(':scope > .stats-control-group > .controls-label'));
        const checkboxes = Array.from(node.querySelectorAll('[data-stats-capacity-filters] .project-track-checkbox'));
        const controls = [
            ...node.querySelectorAll('[data-stats-range="lead-times-quarter"] .sprint-dropdown-toggle'),
            node.querySelector('.eng-mode-control'),
            ...node.querySelectorAll(':scope > .stats-control-group > .scenario-input'),
            node.querySelector('.cohort-exclusion-options'),
        ].filter(Boolean);
        return {
            groupTops: groups.map((group) => Math.round(group.getBoundingClientRect().top)),
            headingTops: headings.map((heading) => Math.round(heading.getBoundingClientRect().top)),
            checkboxTops: checkboxes.map((checkbox) => Math.round(checkbox.getBoundingClientRect().top)),
            controlTops: controls.map((control) => Math.round(control.getBoundingClientRect().top)),
        };
    });
    expect(desktopControlLayout.groupTops).toHaveLength(5);
    expect(new Set(desktopControlLayout.groupTops).size).toBe(1);
    expect(desktopControlLayout.headingTops).toHaveLength(5);
    expect(new Set(desktopControlLayout.headingTops).size).toBe(1);
    expect(desktopControlLayout.checkboxTops).toHaveLength(2);
    expect(new Set(desktopControlLayout.checkboxTops).size).toBe(1);
    expect(desktopControlLayout.controlTops).toHaveLength(6);
    expect(new Set(desktopControlLayout.controlTops).size).toBe(1);
    await page.setViewportSize({ width: 1280, height: 760 });

    // The merged quarter range group must lay Start/End out side by side (not stacked)
    // with no clipped toggle text, and get enough width for both (MRT020).
    const leadTimesQuarterRange = page.locator('[data-stats-range="lead-times-quarter"]');
    const leadTimesQuarterGeometry = await leadTimesQuarterRange.evaluate((group) => {
        const toggles = Array.from(group.querySelectorAll('.sprint-dropdown-toggle'));
        return {
            groupWidth: group.getBoundingClientRect().width,
            tops: toggles.map((toggle) => toggle.getBoundingClientRect().top),
            overflow: toggles.map((toggle) => {
                const label = toggle.querySelector('span');
                return { scrollWidth: label.scrollWidth, clientWidth: label.clientWidth };
            }),
        };
    });
    expect(leadTimesQuarterGeometry.tops).toHaveLength(2);
    expect(leadTimesQuarterGeometry.tops[0]).toBe(leadTimesQuarterGeometry.tops[1]);
    for (const { scrollWidth, clientWidth } of leadTimesQuarterGeometry.overflow) {
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
    expect(leadTimesQuarterGeometry.groupWidth).toBeGreaterThanOrEqual(240);

    // End Quarter reconciliation: last-control-wins, one debounced request per change, and no
    // request is ever sent with an inverted (start > end) pair.
    const quarterRange = cohortControls.locator('[data-stats-range="lead-times-quarter"]');
    const quarterButton = (end) => quarterRange.getByRole('button', { name: `${end} quarter` });
    const pickQuarter = async (end, quarter) => {
        const button = quarterButton(end);
        await button.click();
        await quarterRange.getByRole('listbox', { name: `${end} quarter` })
            .getByRole('option', { name: quarter })
            .click();
    };
    const quarterValue = async (end) => (await quarterButton(end).locator('span').innerText()).trim();
    expect(await quarterValue('Start')).toBe('2026Q1');
    expect(await quarterValue('End')).toBe('2026Q2');

    await pickQuarter('Start', '2026Q3');
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 2);
    expect(await quarterValue('Start')).toBe('2026Q3');
    expect(await quarterValue('End')).toBe('2026Q3');
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST')[1].body).toMatchObject({
        startQuarter: '2026Q3',
        endQuarter: '2026Q3',
    });

    await pickQuarter('End', '2026Q1');
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 3);
    expect(await quarterValue('Start')).toBe('2026Q1');
    expect(await quarterValue('End')).toBe('2026Q1');
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST')[2].body).toMatchObject({
        startQuarter: '2026Q1',
        endQuarter: '2026Q1',
    });

    callsFor(calls, '/api/stats/epic-cohort', 'POST').forEach((call) => {
        expect(quarterLabelOrdinal(call.body.startQuarter)).toBeLessThanOrEqual(quarterLabelOrdinal(call.body.endQuarter));
    });

    // Keyboard support: ArrowDown opens the listbox on the selected option, arrows move focus,
    // Escape closes and returns focus to the toggle.
    const startQuarterButton = quarterButton('Start');
    await startQuarterButton.press('ArrowDown');
    const startListbox = quarterRange.getByRole('listbox', { name: 'Start quarter' });
    await expect(startListbox).toBeVisible();
    const selectedOption = startListbox.locator('[role="option"][aria-selected="true"]');
    await expect(selectedOption).toBeFocused();
    await selectedOption.press('ArrowDown');
    await expect(startListbox.locator('[role="option"]:focus')).toHaveCount(1);
    await startListbox.locator('[role="option"]:focus').press('Escape');
    await expect(startQuarterButton).toHaveAttribute('aria-expanded', 'false');
    await expect(startQuarterButton).toBeFocused();

    // Responsive proof: at 375px the quarter range reflows without horizontal overflow.
    // Overflow is asserted on the cohort controls row rather than the whole document:
    // the dashboard shell has a pre-existing 4px document overflow at 375px from the
    // header .eng-mode-control, unrelated to the stats controls under test here.
    await page.setViewportSize({ width: 375, height: 760 });
    const reflow = await quarterRange.evaluate((node) => {
        const controls = node.closest('.cohort-controls');
        const viewportWidth = document.documentElement.clientWidth;
        return {
            controlsOverflow: controls.scrollWidth > controls.clientWidth
                || Math.round(controls.getBoundingClientRect().right) > viewportWidth,
            controlsVisible: Array.from(node.querySelectorAll('.sprint-dropdown-toggle')).every((toggle) => {
                const rect = toggle.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= viewportWidth;
            }),
        };
    });
    expect(reflow.controlsOverflow).toBeFalsy();
    expect(reflow.controlsVisible).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 760 });

    // 2026Q3 (not 2026Q2) so this lands on a range never fetched before: the debounced
    // cohort effect short-circuits on a cohortQueryKey cache hit (cohortCacheRef), and
    // 2026Q1/2026Q2 was already cached from the very first load above.
    await pickQuarter('End', '2026Q3');
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', 4);
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST')[3].body).toMatchObject({
        startQuarter: '2026Q1',
        endQuarter: '2026Q3',
    });
    await captureSmokeScreenshot(page, 'statistics-lead-times-quarter-range');

    // Per-group persistence: the reconciled pair round-trips through jira_dashboard_ui_prefs_v1.
    await expect.poll(() => page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}');
        return { start: stored.cohortStartQuarter, end: stored.cohortEndQuarter };
    })).toEqual({ start: '2026Q1', end: '2026Q3' });

    // Re-seed the init script with the state actually persisted mid-test (rather than the
    // original fixture values) so the reload below proves restoration of the user's
    // interaction, not just of the test's initial seed.
    const persistedPrefs = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'));
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, persistedPrefs);
    const cohortCallCountBeforeReload = callsFor(calls, '/api/stats/epic-cohort', 'POST').length;
    await page.reload({ waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/stats/epic-cohort', cohortCallCountBeforeReload + 1);
    expect(await quarterValue('Start')).toBe('2026Q1');
    expect(await quarterValue('End')).toBe('2026Q3');
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST')[cohortCallCountBeforeReload].body).toMatchObject({
        startQuarter: '2026Q1',
        endQuarter: '2026Q3',
    });

    // Client-side Group By stays client-side: toggling it never re-fetches the cohort.
    const cohortRequestCountAfterReload = callsFor(calls, '/api/stats/epic-cohort', 'POST').length;
    const groupBy = cohortControls.locator('.stats-control-group', { hasText: 'Group By' }).getByRole('radiogroup');
    await expect(groupBy).toHaveClass(/eng-mode-control/);
    await expect(groupBy).not.toHaveClass(/stats-view-toggle/);
    await groupBy.getByRole('radio', { name: 'Month' }).click();
    await groupBy.getByRole('radio', { name: 'Quarter' }).click();
    await page.waitForTimeout(400);
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST').length).toBe(cohortRequestCountAfterReload);
    const groupByLayout = await groupBy.evaluate((node) => ({
        flexWrap: getComputedStyle(node).flexWrap,
        height: Math.round(node.getBoundingClientRect().height),
        buttonTops: Array.from(node.querySelectorAll('.segmented-control-button')).map((button) => Math.round(button.getBoundingClientRect().top)),
    }));
    expect(groupByLayout.flexWrap).toBe('nowrap');
    expect(groupByLayout.height).toBeLessThanOrEqual(42);
    expect(new Set(groupByLayout.buttonTops).size).toBe(1);

    await statsTabs.getByRole('radio', { name: 'Excluded Capacity' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/stats/excluded-capacity-source', 1);
    await expect(page.locator('.stats-view.open .effort-type-split-chart')).toBeVisible();

    // Excluded Capacity shares the StatsRangeControl range group; no native Start/End select remains.
    const excludedRange = page.locator('[data-stats-range="excluded-capacity-sprint"]');
    await expect(excludedRange).toBeVisible();
    await expect(excludedRange.locator('select')).toHaveCount(0);
    const excludedEnd = excludedRange.getByRole('button', { name: 'End sprint' });
    await excludedEnd.click();
    await expect(excludedEnd).toHaveAttribute('aria-expanded', 'true');

    await statsTabs.getByRole('radio', { name: 'Mono vs Cross' }).click();
    await expect(page.locator('.stats-view.open')).toContainText('Team Cross Share');
    await expect(page.locator('.stats-view.open .excluded-capacity-line-chart')).toBeVisible();
    const monoCrossRange = page.locator('[data-stats-range="mono-cross-sprint"]');
    await expect(monoCrossRange).toBeVisible();
    await expect(monoCrossRange.locator('select')).toHaveCount(0);
    await captureSmokeScreenshot(page, 'statistics-mono-cross');
    const monoCrossLegendColors = await legendColors('.stats-view.open .excluded-capacity-line-legend-item');

    // View-switch menu leak: returning to Excluded Capacity must not leave its End menu open.
    await statsTabs.getByRole('radio', { name: 'Excluded Capacity' }).click();
    await expect(excludedEnd).toHaveAttribute('aria-expanded', 'false');

    // Acceptance proof for the statistics color-consistency fix: Priority, Burndown, and
    // Mono vs Cross must resolve the same team to the same color via resolveStatsTeamColor.
    expect(burnoutLegendColors['Alpha Team']).toBe(priorityLegendColors['Alpha Team']);
    expect(monoCrossLegendColors['Alpha Team']).toBe(priorityLegendColors['Alpha Team']);
    expect(burnoutLegendColors['Beta Team']).toBe(priorityLegendColors['Beta Team']);
    expect(monoCrossLegendColors['Beta Team']).toBe(priorityLegendColors['Beta Team']);

    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('stats sprint range End panels keep long options inside the narrow viewport', async ({ page }) => {
    test.setTimeout(90000);
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        excludedCapacityEpics: ['BAU-EPIC'],
        sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: longSprintId, name: longSprintName, state: 'future' },
        ],
    });
    await page.setViewportSize({ width: 375, height: 760 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
        activeGroupId: 'grp-default', selectedTeams: ['all'], showStats: true,
        statsView: 'excludedCapacity', excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/stats/excluded-capacity-source', 1);
    const statsTabs = page.locator('.stats-panel.open .stats-view-toggle');
    const views = [
        { tab: 'Excluded Capacity', range: 'excluded-capacity-sprint', screenshot: 'statistics-excluded-capacity-range-375' },
        { tab: 'Mono vs Cross', range: 'mono-cross-sprint', screenshot: 'statistics-mono-cross-range-375' },
        { tab: 'Project Track', range: 'project-track-sprint', screenshot: 'statistics-project-track-range-375' },
    ];
    const panelResults = [];

    for (const view of views) {
        await page.setViewportSize({ width: 1280, height: 760 });
        await statsTabs.getByRole('radio', { name: view.tab, exact: true }).click();
        const range = page.locator(`.stats-view.open [data-stats-range="${view.range}"]`);
        await expect(range).toBeVisible();
        await page.setViewportSize({ width: 375, height: 760 });
        const endToggle = range.getByRole('button', { name: 'End sprint' });
        await endToggle.click();
        const longOption = range.getByRole('listbox', { name: 'End sprint' })
            .getByRole('option', { name: longSprintName });
        await expect(longOption).toBeVisible();
        const panelBounds = await longOption.evaluate((node) => {
            const panel = node.closest('.sprint-dropdown-panel');
            const rect = panel.getBoundingClientRect();
            return {
                left: Math.round(rect.left), right: Math.round(rect.right),
                viewport: document.documentElement.clientWidth,
            };
        });
        await captureSmokeScreenshot(page, view.screenshot);
        await longOption.click();
        panelResults.push({ tab: view.tab, ...panelBounds });
        await expect(endToggle).toHaveAttribute('aria-expanded', 'false');
    }

    for (const panelBounds of panelResults) {
        expect(panelBounds.left).toBeGreaterThanOrEqual(16);
        expect(panelBounds.right).toBeLessThanOrEqual(panelBounds.viewport - 16);
    }

    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Lead Times capacity exclusions re-slice locally and replace the legacy inclusive filter', async ({ page }) => {
    const calls = [];
    const issues = [
        { ...makeOpenCohortEpic(1), key: 'ADHOC-1', summary: 'Ad Hoc epic', capacityType: 'ad_hoc' },
        { ...makeOpenCohortEpic(2), key: 'BAU-EPIC', summary: 'Excluded capacity epic' },
        { ...makeOpenCohortEpic(3), key: 'PRODUCT-1', summary: 'Product epic', capacityType: 'product' },
    ];
    const apiMocks = await installApiMocks(page, calls, { cohortIssues: issues, excludedCapacityEpics: ['BAU-EPIC'] });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
        activeGroupId: 'grp-default', selectedTeams: ['all'], showStats: true, statsView: 'cohort',
        cohortStartQuarter: '2026Q1', cohortEndQuarter: '2026Q1', cohortCapacityFilter: 'ad_hoc',
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, (call) => call.pathname === '/api/stats/epic-cohort', 1);
    const view = page.locator('.stats-view.open');
    await expect(view.getByText('Exclude', { exact: true })).toBeVisible();
    await expect(view.getByText('Ad Hoc', { exact: true })).toBeVisible();
    await expect(view.getByText('Excluded Capacity', { exact: true })).toBeVisible();
    await expect(view.getByText('Exclude Ad Hoc', { exact: true })).toHaveCount(0);
    await expect(view.getByText('Exclude Excluded Capacity', { exact: true })).toHaveCount(0);
    const excludeAdHoc = view.getByRole('checkbox', { name: 'Exclude Ad Hoc' });
    const excludeExcluded = view.getByRole('checkbox', { name: 'Exclude Excluded Capacity' });
    await expect(excludeAdHoc).not.toBeChecked();
    await expect(excludeExcluded).toBeChecked();
    await expect(view.getByText('ADHOC-1', { exact: true })).toBeVisible();
    await expect(view.getByText('BAU-EPIC', { exact: true })).toHaveCount(0);
    const requestCount = callsFor(calls, '/api/stats/epic-cohort', 'POST').length;
    await excludeAdHoc.check();
    await expect(view.getByText('ADHOC-1', { exact: true })).toHaveCount(0);
    await excludeExcluded.uncheck();
    await expect(view.getByText('BAU-EPIC', { exact: true })).toBeVisible();
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST').length).toBe(requestCount);
    await expect.poll(() => page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}');
        return {
            excludeAdHoc: stored.cohortExcludeAdHoc,
            excludeCapacity: stored.cohortExcludeCapacity,
            hasLegacyKey: Object.prototype.hasOwnProperty.call(stored, 'cohortCapacityFilter'),
        };
    })).toEqual({ excludeAdHoc: true, excludeCapacity: false, hasLegacyKey: false });
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'));
    expect(saved).not.toHaveProperty('cohortCapacityFilter');
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, saved);
    await page.reload({ waitUntil: 'networkidle' });
    // Scoped to the open Lead Times panel: other stats subviews (e.g. Project Track)
    // stay mounted in the DOM (hidden via opacity/max-height, not display:none) and
    // expose their own identically-labeled "Exclude Ad Hoc" checkbox.
    await expect(view.getByRole('checkbox', { name: 'Exclude Ad Hoc' })).toBeChecked();
    await expect(view.getByRole('checkbox', { name: 'Exclude Excluded Capacity' })).not.toBeChecked();
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Project Track tab renders filter bar, mode title, totals, per-sprint and breakdown charts', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        excludedCapacityEpics: ['BAU-EPIC'],
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showStats: true,
        statsView: 'projectTrack',
        excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, call => call.pathname === '/api/stats/excluded-capacity-source', 1);

    const statsView = page.locator('.stats-view.open');
    await expect(statsView).toBeVisible();

    // Filter bar: shared sprint range control + capacity-side / mode segmented controls + exclusion toggles.
    const controls = statsView.locator('.project-track-controls');
    await expect(controls).toBeVisible();
    const rangeGroup = controls.locator('[data-stats-range="project-track-sprint"]');
    await expect(rangeGroup).toHaveAttribute('aria-label', 'Sprint range');
    await expect(rangeGroup.locator('.controls-label')).toHaveText('Sprint');
    const startToggle = rangeGroup.getByRole('button', { name: 'Start sprint' });
    await expect(startToggle).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
    await startToggle.click();
    await expect(startToggle).toHaveAttribute('aria-expanded', 'true');
    const listbox = rangeGroup.getByRole('listbox', { name: 'Start sprint' });
    const option = listbox.getByRole('option', { name: selectedSprintName });
    const geometry = await option.evaluate((node) => {
        const panel = node.closest('.sprint-dropdown-panel').getBoundingClientRect();
        const toggle = node.closest('.sprint-dropdown').querySelector('.sprint-dropdown-toggle').getBoundingClientRect();
        const point = { x: panel.left + Math.min(12, panel.width / 2), y: panel.top + Math.min(12, panel.height / 2) };
        return {
            opensBelow: panel.top >= toggle.bottom,
            topHitIsPanel: node.closest('.sprint-dropdown-panel').contains(document.elementFromPoint(point.x, point.y)),
        };
    });
    expect(geometry.opensBelow).toBeTruthy();
    expect(geometry.topHitIsPanel).toBeTruthy();
    await option.click(); // normal, never force
    await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(startToggle).toBeFocused();
    await startToggle.click();
    await controls.getByRole('radio', { name: 'Epic' }).focus();
    await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
    await startToggle.click();
    await controls.getByRole('radio', { name: 'Epic' }).click();
    await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
    await startToggle.press('Enter');
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: selectedSprintName }).press('Escape');
    await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(startToggle).toBeFocused();
    // Filter-bar groups never overlap: each control group's layout box stays clear of neighbours.
    const controlBoxes = await controls.evaluate((node) => {
        return Array.from(node.querySelectorAll(':scope > .stats-control-group')).map((group) => {
            const rect = group.getBoundingClientRect();
            return { top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right) };
        });
    });
    controlBoxes.forEach((box, index) => {
        const sameRowNeighbour = controlBoxes[index + 1];
        if (sameRowNeighbour && sameRowNeighbour.top === box.top) {
            expect(sameRowNeighbour.left).toBeGreaterThanOrEqual(box.right);
        }
    });
    // Real-rendering assertions: exclusion labels within their group and not overlapping the
    // MODE control — these catch overflowing nowrap text that getBoundingClientRect misses.
    // NOTE: a heading.scrollWidth > heading.clientWidth check was removed: a display:block
    // label with no overflow:hidden ancestor always has scrollWidth === clientWidth regardless
    // of the group width, so the check is tautologically false and cannot catch the
    // min-width:210px regression (with that regression groupClientWidth=210 > headingScrollWidth=71).
    // The two label assertions below are sufficient: they do fail on the broken layout.
    const renderChecks = await controls.evaluate((node) => {
        const exclusionGroup = node.querySelector('.project-track-exclusions');
        const modeGroup = Array.from(node.querySelectorAll(':scope > .stats-control-group')).find(
            (g) => g.querySelector('[aria-label="Mode"]')
        );
        const checkboxLabels = exclusionGroup
            ? Array.from(exclusionGroup.querySelectorAll('label.project-track-checkbox'))
            : [];
        const groupRight = exclusionGroup ? exclusionGroup.getBoundingClientRect().right : 0;
        const modeLeft = modeGroup ? modeGroup.getBoundingClientRect().left : Infinity;
        return {
            labelOverflows: checkboxLabels.map((lbl) => {
                const r = lbl.getBoundingClientRect().right;
                return { right: Math.round(r), groupRight: Math.round(groupRight), modeLeft: Math.round(modeLeft) };
            }),
        };
    });
    for (const lbl of renderChecks.labelOverflows) {
        expect(lbl.right, 'checkbox label must not overflow its group').toBeLessThanOrEqual(lbl.groupRight + 1);
        expect(lbl.right, 'checkbox label must not overlap MODE control').toBeLessThan(lbl.modeLeft);
    }
    const capacityControl = controls.getByRole('radiogroup', { name: 'Capacity side' });
    await expect(capacityControl).toHaveClass(/eng-mode-control/);
    await expect(capacityControl).not.toHaveClass(/stats-view-toggle/);
    await expect(capacityControl.getByRole('radio', { name: 'Product', exact: true })).toHaveAttribute('aria-checked', 'true');
    const modeControl = controls.getByRole('radiogroup', { name: 'Mode' });
    await expect(modeControl).toHaveClass(/eng-mode-control/);
    await expect(modeControl).not.toHaveClass(/stats-view-toggle/);
    await expect(modeControl.getByRole('radio', { name: 'Epic' })).toHaveAttribute('aria-checked', 'true');
    const segmentedChecks = await controls.evaluate((node) => {
        return Array.from(node.querySelectorAll('[role="radiogroup"]')).map((group) => {
            const groupRect = group.getBoundingClientRect();
            const buttonRects = Array.from(group.querySelectorAll('.segmented-control-button')).map((button) => button.getBoundingClientRect());
            const styles = window.getComputedStyle(group);
            return {
                ariaLabel: group.getAttribute('aria-label'),
                flexWrap: styles.flexWrap,
                height: Math.round(groupRect.height),
                buttonTops: buttonRects.map((rect) => Math.round(rect.top)),
            };
        });
    });
    for (const check of segmentedChecks.filter(item => item.ariaLabel === 'Capacity side' || item.ariaLabel === 'Mode')) {
        expect(check.flexWrap, `${check.ariaLabel} must use the shared single-row segmented control`).toBe('nowrap');
        expect(check.height, `${check.ariaLabel} must keep the shared segmented control height`).toBeLessThanOrEqual(42);
        expect(new Set(check.buttonTops).size, `${check.ariaLabel} buttons must stay on one row`).toBe(1);
    }
    await expect(controls.getByText('Exclude Ad Hoc')).toBeVisible();
    await expect(controls.getByText('Exclude Excluded Capacity')).toBeVisible();
    // Mode label is "Mode", never "Metric".
    await expect(statsView).not.toContainText('Metric');

    // Mode title defaults to EPIC MODE.
    await expect(statsView.locator('.project-track-mode-title')).toHaveText('EPIC MODE');

    // Totals bar: product side, Epic mode => Committed 13 SP, Flexible 3 SP, total 16 SP.
    const totalsBar = statsView.locator('.project-track-totals .stacked-bar');
    await expect(totalsBar).toBeVisible();
    const totalsSegments = totalsBar.locator('.stacked-bar-segment span');
    await expect(totalsSegments.filter({ hasText: 'Committed 13 SP' })).toBeVisible();
    await expect(totalsSegments.filter({ hasText: 'Flexible 3 SP' })).toBeVisible();
    await expect(statsView.locator('.project-track-totals .stacked-bar-row-total')).toHaveText('16 SP');
    await expect(statsView.locator('.project-track-legend')).toContainText('Committed');
    await expect(statsView.locator('.project-track-legend')).toContainText('Flexible');

    // Per-sprint chart is HIDDEN when only one sprint is selected (single-sprint fixture):
    // it would be redundant with the range totals bar above.
    await expect(statsView.locator('.project-track-sprint-chart')).toHaveCount(0);
    await expect(statsView.getByText('Story points per sprint')).toHaveCount(0);

    // Breakdown chart under "By assignee" heading (Epic mode), rows by assignee.
    await expect(statsView.getByText('By assignee')).toBeVisible();
    const breakdownRows = statsView.locator('.project-track-card', { hasText: 'By assignee' }).locator('.stacked-bar-row');
    await expect(breakdownRows).toHaveCount(2);
    await expect(statsView.locator('.project-track-card', { hasText: 'By assignee' })).toContainText('Pat Product');
    await expect(statsView.locator('.project-track-card', { hasText: 'By assignee' })).toContainText('Sam BAU');

    // Time-in-phase section: present in Epic mode, has heading and stacked-bar rows.
    await waitForCallCount(calls, call => call.pathname === '/api/stats/project-track-phase-durations', 1);
    const phaseSection = statsView.locator('.project-track-phase-section');
    await expect(phaseSection).toBeVisible();
    await expect(phaseSection.getByRole('heading', { name: 'Time in Project Track phase' })).toBeVisible();
    // The stacked-bar container must exist and have rows (mock returns one row per epic key).
    await expect(phaseSection.locator('.stacked-bar')).toBeVisible();
    // Summary stats (avg days) are shown.
    await expect(phaseSection.locator('.project-track-phase-summary')).toBeVisible();

    // Item 3: each epic row label is a clickable Jira link (anchor, new tab, /browse/).
    const phaseEpicLink = phaseSection.locator('.stacked-bar-row .stacked-bar-row-label').first();
    await expect(phaseEpicLink).toBeVisible();
    const phaseEpicTag = await phaseEpicLink.evaluate(node => node.tagName);
    expect(phaseEpicTag).toBe('A');
    const phaseEpicHref = await phaseEpicLink.getAttribute('href');
    expect(phaseEpicHref).toContain('/browse/');
    expect(await phaseEpicLink.getAttribute('target')).toBe('_blank');
    expect(await phaseEpicLink.getAttribute('rel')).toContain('noopener');

    // Item 2: the phase "No track" segment reads "No track" (not "NULL (NO VALUE)") and is
    // painted with the SAME color resolveProjectTrackColor returns for the SP "No track"
    // segment. The single color source is asserted, not a magenta hash color. The util is
    // ESM; transpile it to CJS with the same esbuild the shell bundle uses, then require it
    // so the test reuses the real color source instead of a hardcoded hex.
    const noTrackColor = resolveProjectTrackColorFromSource('No track');
    const noTrackSegment = phaseSection
        .locator('.stacked-bar-segment', { hasText: 'No track' })
        .first();
    await expect(noTrackSegment).toBeVisible();
    await expect(phaseSection).not.toContainText('NULL (NO VALUE)');
    const segmentColor = await noTrackSegment.evaluate((node, expectedHex) => {
        const toRgb = (hex) => {
            const value = hex.replace('#', '');
            const int = parseInt(value, 16);
            return `rgb(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255})`;
        };
        const declared = getComputedStyle(node).getPropertyValue('--stacked-bar-color').trim();
        return {
            declaredColor: declared,
            expectedRgb: toRgb(expectedHex),
            backgroundColor: getComputedStyle(node).backgroundColor,
        };
    }, noTrackColor);
    expect(segmentColor.declaredColor).toBe(noTrackColor);
    expect(segmentColor.backgroundColor).toBe(segmentColor.expectedRgb);

    await captureSmokeScreenshot(page, 'statistics-project-track-epic');

    // Toggle Capacity side -> Tech (only TECH-EPIC, Committed 4 SP, no Flexible).
    await capacityControl.getByRole('radio', { name: 'Tech', exact: true }).click();
    await expect(statsView.locator('.project-track-totals .stacked-bar-row-total')).toHaveText('4 SP');
    await expect(totalsSegments.filter({ hasText: 'Flexible' })).toHaveCount(0);

    // Toggle Capacity side -> Tech + Product (Committed 17, Flexible 3, total 20).
    await capacityControl.getByRole('radio', { name: 'Tech + Product' }).click();
    await expect(statsView.locator('.project-track-totals .stacked-bar-row-total')).toHaveText('20 SP');
    await expect(totalsSegments.filter({ hasText: 'Committed 17 SP' })).toBeVisible();

    // Switch Mode -> Team: title flips, heading switches to By team, rows now per team.
    await modeControl.getByRole('radio', { name: 'Team' }).click();
    await expect(statsView.locator('.project-track-mode-title')).toHaveText('TEAM MODE');
    await expect(statsView.getByText('By team')).toBeVisible();
    await expect(statsView.getByText('By assignee')).toHaveCount(0);
    const teamRows = statsView.locator('.project-track-card', { hasText: 'By team' }).locator('.stacked-bar-row');
    await expect(teamRows).toHaveCount(2);
    // Item 4: team rows are labelled by the story's real team NAME, not the group teamLabels id.
    const byTeamCard = statsView.locator('.project-track-card', { hasText: 'By team' });
    await expect(byTeamCard).toContainText('Alpha Team');
    await expect(byTeamCard).toContainText('Beta Team');
    await expect(byTeamCard).not.toContainText('alpha_label');
    await expect(byTeamCard).not.toContainText('beta_label');

    // Time-in-phase section: ABSENT in Team mode.
    await expect(statsView.locator('.project-track-phase-section')).toHaveCount(0);

    await captureSmokeScreenshot(page, 'statistics-project-track-team');
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
        cohortEndQuarter: '2026Q1',
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

    // Excluded Capacity renders exactly one StatsRangeControl range group with Start/End
    // buttons and no leftover native Start/End select.
    const rangeGroup = page.locator('[data-stats-range="excluded-capacity-sprint"]');
    await expect(rangeGroup).toHaveCount(1);
    await expect(rangeGroup.locator('select')).toHaveCount(0);
    await expect(rangeGroup.getByRole('button', { name: 'Start sprint' })).toBeVisible();
    await expect(rangeGroup.getByRole('button', { name: 'End sprint' })).toBeVisible();

    // The merged range group must lay Start/End out side by side (not stacked)
    // with no clipped toggle text, and get enough width for both (MRT020).
    const rangeGeometry = await rangeGroup.evaluate((group) => {
        const toggles = Array.from(group.querySelectorAll('.sprint-dropdown-toggle'));
        return {
            groupWidth: group.getBoundingClientRect().width,
            tops: toggles.map((toggle) => toggle.getBoundingClientRect().top),
            overflow: toggles.map((toggle) => {
                const label = toggle.querySelector('span');
                return { scrollWidth: label.scrollWidth, clientWidth: label.clientWidth };
            }),
        };
    });
    expect(rangeGeometry.tops).toHaveLength(2);
    expect(rangeGeometry.tops[0]).toBe(rangeGeometry.tops[1]);
    for (const { scrollWidth, clientWidth } of rangeGeometry.overflow) {
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
    expect(rangeGeometry.groupWidth).toBeGreaterThanOrEqual(240);

    const controlRowGeometry = await page.locator('.excluded-capacity-filter-controls').evaluate((row) => {
        const range = row.querySelector(':scope > [data-stats-range="excluded-capacity-sprint"]')?.getBoundingClientRect();
        const epic = row.querySelector(':scope > .excluded-capacity-epic-filter')?.getBoundingClientRect();
        const actions = row.querySelector(':scope > .excluded-capacity-actions')?.getBoundingClientRect();
        const segmentedControls = Array.from(row.querySelectorAll(':scope > .excluded-capacity-actions .segmented-control'));
        const rangeToggle = row.querySelector(':scope > [data-stats-range="excluded-capacity-sprint"] .sprint-dropdown-toggle')?.getBoundingClientRect();
        const epicToggle = row.querySelector(':scope > .excluded-capacity-epic-filter .team-dropdown-toggle')?.getBoundingClientRect();
        return {
            rowRight: row.getBoundingClientRect().right,
            lefts: [range?.left, epic?.left, actions?.left],
            actionsRight: actions?.right,
            controlTops: [rangeToggle?.top, epicToggle?.top, ...segmentedControls.map((control) => control.getBoundingClientRect().top)],
            clippedLabels: segmentedControls.flatMap((control) => Array.from(control.querySelectorAll('button')).map((button) => ({
                scrollWidth: button.scrollWidth,
                clientWidth: button.clientWidth,
            }))),
        };
    });
    expect(controlRowGeometry.lefts.every(Number.isFinite)).toBeTruthy();
    expect(controlRowGeometry.lefts[0]).toBeLessThan(controlRowGeometry.lefts[1]);
    expect(controlRowGeometry.lefts[1]).toBeLessThan(controlRowGeometry.lefts[2]);
    expect(controlRowGeometry.actionsRight).toBeLessThanOrEqual(controlRowGeometry.rowRight);
    expect(controlRowGeometry.controlTops).toHaveLength(4);
    expect(controlRowGeometry.controlTops.every(Number.isFinite)).toBeTruthy();
    expect(Math.max(...controlRowGeometry.controlTops) - Math.min(...controlRowGeometry.controlTops)).toBeLessThan(4);
    for (const { scrollWidth, clientWidth } of controlRowGeometry.clippedLabels) {
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }

    const summary = page.locator('.stats-view.open .excluded-capacity-summary');
    await expect(summary).toBeVisible();
    await expect(summary.locator('.stats-card', { hasText: 'Excluded Share' })).toContainText('15.00%');
    await expect(summary.locator('.stats-card', { hasText: 'Ad Hoc Share' })).toContainText('0.00%');
    await expect(summary.locator('.stats-card', { hasText: 'Product total' })).toContainText('65.00%');
    await expect(summary.locator('.stats-card', { hasText: 'Tech Share' })).toContainText('20.00%');
    // Excluded SP, Excluded Share, Ad Hoc Share, Product total, Tech Share; Range card removed.
    await expect(summary.locator('.stats-card')).toHaveCount(5);
    await expect(summary.locator('.stats-card', { hasText: 'Range' })).toHaveCount(0);
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
