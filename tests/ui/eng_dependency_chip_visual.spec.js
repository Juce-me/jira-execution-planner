const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/eng-dependency-chip-qa';
const selectedSprintId = 42;
const selectedSprintName = 'Sprint 42';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function story(key, status, summary) {
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Ani Arzumanyan' },
            customfield_10004: 2.2,
            epicKey: 'PRODUCT-27078',
            parentSummary: 'Sync monitoring process reboot',
            projectKey: 'PRODUCT',
            teamId: 'team-rnd',
            teamName: 'R&D BSW UI',
            updated: '2026-03-27T12:00:00.000Z',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    };
}

test('ENG blocked-by chip turns green when blockers are done', async ({ page }) => {
    await installDashboardShell(page);
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
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = (body) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: [{ id: 'grp-default', name: 'Default', teamIds: ['team-rnd'], teamLabels: { 'team-rnd': 'R&D BSW UI' } }],
                defaultGroupId: 'grp-default',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const issues = project === 'product' && !url.searchParams.get('purpose')
                ? [story('PRODUCT-34047', 'Accepted', 'Develop a new Sync Slicer')]
                : [];
            return json({
                issues,
                epics: {
                    'PRODUCT-27078': {
                        key: 'PRODUCT-27078',
                        summary: 'Sync monitoring process reboot',
                        status: { name: 'In Progress' },
                        teamId: 'team-rnd',
                        teamName: 'R&D BSW UI',
                        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                    },
                },
                epicsInScope: [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/dependencies') {
            return json({
                dependencies: {
                    'PRODUCT-34047': [{
                        key: 'PRODUCT-31219',
                        category: 'block',
                        direction: 'inward',
                        relation: 'is blocked by',
                        status: 'Done',
                        summary: '[Bruges] Add logging for Sync Slicer',
                        teamName: 'R&D Perimeter',
                        assignee: 'Ani Arzumanyan',
                        prereqKey: 'PRODUCT-31219',
                        dependentKey: 'PRODUCT-34047',
                    }],
                },
            });
        }
        return json({});
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    const chip = page.locator('button[data-dep-chip="blocked-by"]').first();
    await expect(chip).toHaveText('UNBLOCKED 1');
    await expect(chip).toHaveCSS('color', 'rgb(22, 101, 52)');
    await page.screenshot({ path: `${screenshotDir}/unblocked-chip.png`, fullPage: true });
});

test('ENG header dependency pill sits below story meta without remove overlap', async ({ page }) => {
    await installDashboardShell(page);
    await page.setViewportSize({ width: 1440, height: 760 });
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
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = (body) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: [{ id: 'grp-default', name: 'Default', teamIds: ['team-rnd'], teamLabels: { 'team-rnd': 'R&D BSW UI' } }],
                defaultGroupId: 'grp-default',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const issues = project === 'product' && !url.searchParams.get('purpose')
                ? [story('PRODUCT-34047', 'In Progress', '[UI] Create service for AI models with a title long enough to prove the meta lane stays separate')]
                : [];
            return json({
                issues,
                epics: {
                    'PRODUCT-27078': {
                        key: 'PRODUCT-27078',
                        summary: 'Sync monitoring process reboot',
                        status: { name: 'In Progress' },
                        teamId: 'team-rnd',
                        teamName: 'R&D BSW UI',
                        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                    },
                },
                epicsInScope: [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/dependencies') {
            return json({
                dependencies: {
                    'PRODUCT-34047': [{
                        key: 'PRODUCT-35573',
                        category: 'dependency',
                        direction: 'inward',
                        relation: 'blocks',
                        status: 'In Progress',
                        summary: 'Dependent AI model rollout task',
                        teamName: 'R&D Distribution',
                        assignee: 'Magda Gyurjyan',
                    }],
                },
            });
        }
        return json({});
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    const task = page.locator('.task-item[data-task-key="PRODUCT-34047"]');
    await expect(task.locator('.dependency-pill.blocker')).toContainText('BLOCKS');
    await task.hover();
    await expect.poll(async () => task.locator('.task-remove').evaluate((button) => {
        return Number.parseFloat(getComputedStyle(button).opacity);
    })).toBeGreaterThan(0.9);
    const metrics = await task.evaluate((element) => {
        const rectFor = (selector) => {
            const node = element.querySelector(selector);
            const rect = node.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            };
        };
        const issueMeta = rectFor('.task-inline-meta');
        const pill = rectFor('.dependency-pill.blocker');
        const remove = rectFor('.task-remove');
        const taskMeta = rectFor('.task-meta');
        const title = rectFor('.task-title');
        const headerRight = rectFor('.task-header-right');
        const overlapsRemove = pill.x < remove.right &&
            pill.right > remove.x &&
            pill.y < remove.bottom &&
            pill.bottom > remove.y;
        return {
            issueMeta,
            pill,
            remove,
            taskMeta,
            title,
            headerRight,
            removeOpacity: Number.parseFloat(getComputedStyle(element.querySelector('.task-remove')).opacity),
            metaInHeaderRight: Boolean(element.querySelector('.task-header-right .task-inline-meta')),
            overlapsRemove,
        };
    });

    expect(metrics.metaInHeaderRight).toBe(true);
    expect(metrics.pill.y).toBeGreaterThanOrEqual(metrics.issueMeta.bottom);
    expect(metrics.pill.y - metrics.issueMeta.bottom).toBeLessThanOrEqual(8);
    expect(Math.abs(metrics.pill.right - metrics.headerRight.right)).toBeLessThanOrEqual(2);
    expect(metrics.taskMeta.y - metrics.title.bottom).toBeLessThanOrEqual(6);
    expect(Math.abs(metrics.pill.y - metrics.taskMeta.y)).toBeLessThanOrEqual(4);
    expect(metrics.overlapsRemove).toBe(false);
    expect(metrics.removeOpacity).toBeGreaterThan(0.9);
    await page.screenshot({ path: `${screenshotDir}/header-pill-no-remove-overlap.png`, fullPage: false });
});
