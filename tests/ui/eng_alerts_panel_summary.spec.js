const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = '/tmp/eng-alerts-panel-summary-qa';
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha', 'team-beta'];

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function story(key, status, summary, overrides = {}) {
    const projectKey = key.split('-')[0];
    const epicKey = overrides.epicKey || `${projectKey}-EPIC`;
    const teamId = overrides.teamId || (projectKey === 'TECH' ? 'team-beta' : 'team-alpha');
    const teamName = overrides.teamName || (teamId === 'team-beta' ? 'Beta Team' : 'Alpha Team');
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: 'High' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Planner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: overrides.storyPoints ?? 3,
            epicKey,
            parentSummary: `${projectKey} alerts summary epic`,
            projectKey,
            teamId,
            teamName,
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            ...(overrides.fields || {}),
        },
    };
}

function epic(projectKey, overrides = {}) {
    const teamId = overrides.teamId || (projectKey === 'TECH' ? 'team-beta' : 'team-alpha');
    const teamName = overrides.teamName || (teamId === 'team-beta' ? 'Beta Team' : 'Alpha Team');
    return {
        key: `${projectKey}-EPIC`,
        summary: `${projectKey} alerts summary epic`,
        status: { name: 'In Progress' },
        assignee: { displayName: `${projectKey} Lead` },
        teamId,
        teamName,
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        ...overrides,
    };
}

const missingStories = [
    story('PROD-1', 'To Do', 'Missing estimate story', {
        storyPoints: null,
        fields: { missingFields: ['Story Points'] },
    }),
    story('PROD-2', 'To Do', 'Missing owner story', {
        storyPoints: null,
        fields: { missingFields: ['Story Points'] },
    }),
];
const blockedStories = [
    story('PROD-3', 'Blocked', 'Blocked product story'),
    story('PROD-4', 'Blocked', 'Another blocked product story'),
    story('TECH-1', 'Blocked', 'Blocked tech story'),
    story('TECH-2', 'Blocked', 'Another blocked tech story'),
];
const readyToCloseStories = [
    story('PROD-10', 'Done', 'Completed product closeout story'),
    story('TECH-10', 'Done', 'Completed tech closeout story'),
];
const productTasks = [...missingStories, ...blockedStories.filter(task => task.key.startsWith('PROD-'))];
const techTasks = blockedStories.filter(task => task.key.startsWith('TECH-'));
const productEpic = epic('PROD');
const techEpic = epic('TECH');

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

async function installAlertsFixture(page) {
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
            const isTech = project === 'tech';
            const currentEpic = isTech ? techEpic : productEpic;
            const issues = purpose === 'ready-to-close'
                ? readyToCloseStories.filter(task => task.fields.epicKey === currentEpic.key)
                : (isTech ? techTasks : productTasks);
            return json({
                issues,
                epics: { [currentEpic.key]: currentEpic },
                epicsInScope: [currentEpic],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') {
            return json({
                issues: missingStories,
                epics: [],
                count: missingStories.length,
                epicCount: 0,
            });
        }
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openEng(page, viewport, showAlertsPanel = true) {
    await page.setViewportSize(viewport);
    await installAlertsFixture(page);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showScenario: false,
        showAlertsPanel,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    await waitForVisualSettled(page);
}

async function expectSummaryText(page) {
    const summary = page.locator('.alerts-panel-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('8 total');
    await expect(summary).toContainText(/2\s+Missing info/);
    await expect(summary).toContainText(/4\s+Blocked/);
    await expect(summary).toContainText(/2\s+Ready to close/);
}

async function expectNoToolbarOverflowOrOverlap(page) {
    const metrics = await page.evaluate(() => {
        const rectFor = (node) => {
            const rect = node.getBoundingClientRect();
            return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            };
        };
        const visible = (selector) => Array.from(document.querySelectorAll(selector))
            .filter(node => {
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            })
            .map(node => ({ selector: node.className, rect: rectFor(node) }));
        const toolbarChildren = visible('.alerts-panel-toolbar > .alerts-panel-toggle, .alerts-panel-toolbar > .alerts-panel-summary');
        const summaryPills = visible('.alerts-panel-summary-pill');
        const overlaps = [];
        const collectOverlaps = (entries) => {
            entries.forEach((entry, index) => {
                entries.slice(index + 1).forEach(other => {
                    const xOverlap = Math.min(entry.rect.right, other.rect.right) - Math.max(entry.rect.left, other.rect.left);
                    const yOverlap = Math.min(entry.rect.bottom, other.rect.bottom) - Math.max(entry.rect.top, other.rect.top);
                    if (xOverlap > 1 && yOverlap > 1) {
                        overlaps.push({ a: entry.selector, b: other.selector, xOverlap, yOverlap });
                    }
                });
            });
        };
        collectOverlaps(toolbarChildren);
        collectOverlaps(summaryPills);
        return {
            documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
            overlaps,
        };
    });
    expect(metrics.documentOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.overlaps).toEqual([]);
}

async function captureSummaryState(page, screenshotName) {
    await waitForVisualSettled(page);
    await expectSummaryText(page);
    await expectNoToolbarOverflowOrOverlap(page);
    await page.screenshot({ path: `${screenshotDir}/${screenshotName}.png`, fullPage: true });
}

test('ENG alerts summary stays visible on desktop while open and collapsed', async ({ page }) => {
    await openEng(page, { width: 1280, height: 760 }, true);

    const hideToggle = page.getByRole('button', { name: /Hide Alerts/ });
    await expect(hideToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#eng-alert-panels')).toBeVisible();
    await captureSummaryState(page, 'desktop-open');

    await hideToggle.click();

    const showToggle = page.getByRole('button', { name: /Show Alerts/ });
    await expect(showToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
    await captureSummaryState(page, 'desktop-collapsed');
});

test('ENG alerts summary wraps without overflow on narrow screens', async ({ page }) => {
    await openEng(page, { width: 390, height: 760 }, true);

    await expect(page.getByRole('button', { name: /Hide Alerts/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#eng-alert-panels')).toBeVisible();
    await captureSummaryState(page, 'narrow-open');

    await page.getByRole('button', { name: /Hide Alerts/ }).click();

    await expect(page.getByRole('button', { name: /Show Alerts/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
    await captureSummaryState(page, 'narrow-collapsed');
});
