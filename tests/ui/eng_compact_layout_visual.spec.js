const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = '/tmp/eng-compact-layout-qa';
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha', 'team-beta'];

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function makeIssue({ key, project, index, status, priority, points, summary }) {
    const epicKey = `${project}-EPIC`;
    const teamId = index % 2 === 0 ? 'team-alpha' : 'team-beta';
    const teamName = teamId === 'team-alpha' ? 'Alpha Team' : 'Beta Team';
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: priority },
            issuetype: { name: 'Story' },
            assignee: { displayName: `${teamName} Owner` },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: points,
            epicKey,
            parentSummary: `${project} compact layout epic`,
            projectKey: project,
            teamId,
            teamName,
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    };
}

function makeEpic(project) {
    return {
        key: `${project}-EPIC`,
        summary: `${project} compact layout epic`,
        status: { name: 'In Progress' },
        assignee: { displayName: `${project} Lead` },
        teamId: project === 'PRODUCT' ? 'team-alpha' : 'team-beta',
        teamName: project === 'PRODUCT' ? 'Alpha Team' : 'Beta Team',
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
    };
}

const productTasks = [
    makeIssue({
        key: 'PRODUCT-1',
        project: 'PRODUCT',
        index: 1,
        status: 'In Progress',
        priority: 'High',
        points: 8,
        summary: 'Compact layout story with a readable but long title for filter visual QA',
    }),
    makeIssue({
        key: 'PRODUCT-2',
        project: 'PRODUCT',
        index: 2,
        status: 'Done',
        priority: 'High',
        points: 3,
        summary: 'Completed product story',
    }),
    makeIssue({
        key: 'PRODUCT-3',
        project: 'PRODUCT',
        index: 3,
        status: 'To Do',
        priority: 'Minor',
        points: 2,
        summary: 'Pending product story',
    }),
];
const techTasks = [
    makeIssue({
        key: 'TECH-1',
        project: 'TECH',
        index: 1,
        status: 'Accepted',
        priority: 'Medium',
        points: 5,
        summary: 'Accepted tech story',
    }),
    makeIssue({
        key: 'TECH-2',
        project: 'TECH',
        index: 2,
        status: 'In Progress',
        priority: 'High',
        points: 5,
        summary: 'Compact tech story with enough text to exercise title wrapping',
    }),
];
const productEpic = makeEpic('PRODUCT');
const techEpic = makeEpic('TECH');

async function waitForVisualSettled(page) {
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document.getAnimations({ subtree: true });
        if (animations.length > 0) {
            await Promise.race([
                Promise.all(animations.map(animation => animation.finished.catch(() => undefined))),
                new Promise(resolve => window.setTimeout(resolve, 1200)),
            ]);
        }
        await new Promise(requestAnimationFrame);
    });
}

async function installEngCompactFixture(page) {
    await installDashboardShell(page);
    await page.route('**/api/**', route => {
        const request = route.request();
        const url = new URL(request.url());
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        }
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                projectsConfigured: true,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
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
                    teamLabels: { 'team-alpha': 'Alpha Team', 'team-beta': 'Beta Team' },
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        }
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const tasks = project === 'tech' ? techTasks : productTasks;
            const epic = project === 'tech' ? techEpic : productEpic;
            return json({
                issues: purpose === 'ready-to-close' ? [] : tasks,
                epics: { [epic.key]: epic },
                epicsInScope: [epic],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openEngCatchUp(page, viewport) {
    await page.setViewportSize(viewport);
    await installEngCompactFixture(page);
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
    await expect(page.locator('.filters-strip .stat-card')).toHaveCount(6);
    await expect(page.locator('.task-list:not(.epm-issue-board) > .epic-block').first()).toBeVisible();
    await waitForVisualSettled(page);
}

async function expectCompactLayout(page, screenshotName) {
    const metrics = await page.evaluate(() => {
        const parsePx = (value) => Number.parseFloat(value) || 0;
        const lineCount = (node) => {
            const style = getComputedStyle(node);
            const lineHeight = parsePx(style.lineHeight) || (parsePx(style.fontSize) * 1.2);
            return Math.round(node.getBoundingClientRect().height / lineHeight);
        };
        const stats = document.querySelector('.filters-strip .stats');
        const cards = Array.from(document.querySelectorAll('.filters-strip .stat-card'));
        const longLabel = document.querySelector('.filters-strip .todo-accepted .stat-label');
        const firstStory = document.querySelector('.task-list:not(.epm-issue-board) > .epic-block > .task-item');
        const storyStyle = getComputedStyle(firstStory);
        const title = firstStory.querySelector('.task-title');
        const titleStyle = getComputedStyle(title);
        const epicBlock = document.querySelector('.task-list:not(.epm-issue-board) > .epic-block');
        const epicStyle = getComputedStyle(epicBlock);
        const epicName = epicBlock.querySelector('.epic-name');
        const activeModeButton = document.querySelector('.eng-mode-control .segmented-control-button.active');
        const activeModeButtonStyle = getComputedStyle(activeModeButton);
        return {
            statsDisplay: getComputedStyle(stats).display,
            statsFlexWrap: getComputedStyle(stats).flexWrap,
            cardWidths: cards.map(card => card.getBoundingClientRect().width),
            cardHeights: cards.map(card => card.getBoundingClientRect().height),
            labelFontSize: parsePx(getComputedStyle(longLabel).fontSize),
            noteFontSize: parsePx(getComputedStyle(document.querySelector('.filters-strip .todo-accepted .stats-note')).fontSize),
            longLabelLines: lineCount(longLabel),
            storyPaddingTop: parsePx(storyStyle.paddingTop),
            storyPaddingLeft: parsePx(storyStyle.paddingLeft),
            storyTitleFontSize: parsePx(titleStyle.fontSize),
            titleRight: title.getBoundingClientRect().right,
            storyRight: firstStory.getBoundingClientRect().right,
            epicNameWidth: epicName.getBoundingClientRect().width,
            epicPaddingTop: parsePx(epicStyle.paddingTop),
            activeModeButtonWhiteSpace: activeModeButtonStyle.whiteSpace,
            activeModeButtonOverflow: activeModeButton.scrollWidth - activeModeButton.clientWidth,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(metrics.statsDisplay).toBe('flex');
    expect(metrics.statsFlexWrap).toBe('wrap');
    expect(Math.max(...metrics.cardWidths)).toBeLessThanOrEqual(203);
    expect(Math.max(...metrics.cardHeights)).toBeLessThanOrEqual(58);
    expect(metrics.labelFontSize).toBeGreaterThanOrEqual(9);
    expect(metrics.noteFontSize).toBeGreaterThanOrEqual(9);
    expect(metrics.longLabelLines).toBeLessThanOrEqual(2);
    expect(metrics.storyPaddingTop).toBeGreaterThanOrEqual(11);
    expect(metrics.storyPaddingTop).toBeLessThanOrEqual(12);
    expect(metrics.storyPaddingLeft).toBeGreaterThanOrEqual(15);
    expect(metrics.storyPaddingLeft).toBeLessThanOrEqual(16);
    expect(metrics.storyTitleFontSize).toBeGreaterThanOrEqual(15);
    expect(metrics.storyTitleFontSize).toBeLessThanOrEqual(16);
    expect(metrics.epicPaddingTop).toBeGreaterThanOrEqual(8);
    expect(metrics.epicPaddingTop).toBeLessThanOrEqual(9);
    expect(metrics.epicNameWidth).toBeGreaterThanOrEqual(110);
    expect(metrics.activeModeButtonWhiteSpace).toBe('nowrap');
    expect(metrics.activeModeButtonOverflow).toBeLessThanOrEqual(1);
    expect(metrics.titleRight).toBeLessThanOrEqual(metrics.storyRight + 1);
    expect(metrics.overflowX).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${screenshotDir}/${screenshotName}.png`, fullPage: true });
}

test('ENG compact filters and epic rows stay readable on desktop', async ({ page }) => {
    await openEngCatchUp(page, { width: 1028, height: 720 });
    await expectCompactLayout(page, 'desktop');
});

test('ENG compact filters and epic rows stay readable on narrow screens', async ({ page }) => {
    await openEngCatchUp(page, { width: 390, height: 760 });
    await expectCompactLayout(page, 'mobile');
});
