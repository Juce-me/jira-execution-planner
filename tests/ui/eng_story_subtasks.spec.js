const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = '/tmp/eng-story-subtasks-qa';
const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha'];
let dashboardJs;
let dashboardCss;

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        outdir: 'out',
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    dashboardJs = result.outputFiles.find(file => file.path.endsWith('.js')).text;
    dashboardCss = result.outputFiles.find(file => file.path.endsWith('.css')).text;
});

function parentStory() {
    return {
        id: 'PROD-1',
        key: 'PROD-1',
        fields: {
            summary: 'Parent story with subtasks',
            status: { name: 'In Progress' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Synthetic Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 2,
            epicKey: 'PROD-EPIC',
            parentSummary: 'Product delivery epic',
            projectKey: 'PROD',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            subtaskSummary: {
                total: 3,
                done: 1,
                inProgress: 2,
                waiting: 0,
                percentComplete: 33.3,
                statusCounts: { Done: 1, Analysis: 1, Release: 1 },
            },
        },
    };
}

function productEpic() {
    return {
        key: 'PROD-EPIC',
        summary: 'Product delivery epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Product Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
    };
}

function subtaskPayload() {
    return {
        parentKey: 'PROD-1',
        sprint: String(selectedSprintId),
        cached: false,
        summary: {
            total: 3,
            done: 1,
            inProgress: 2,
            waiting: 0,
            percentComplete: 33.3,
            statusCounts: { Done: 1, Analysis: 1, Release: 1 },
        },
        subtasks: [
            {
                id: 'SUB-1',
                key: 'PROD-2',
                summary: 'Synthetic subtask',
                status: { name: 'Analysis' },
                progressPercent: null,
                assignee: { displayName: 'Synthetic Owner' },
                updated: '2026-05-01T00:00:00.000+0000',
            },
            {
                id: 'SUB-2',
                key: 'PROD-3',
                summary: 'Review subtask',
                status: { name: 'Done' },
                progressPercent: null,
                assignee: { displayName: 'Review Owner' },
                updated: '2026-05-02T00:00:00.000+0000',
            },
            {
                id: 'SUB-3',
                key: 'PROD-4',
                summary: 'Waiting subtask',
                status: { name: 'Release' },
                progressPercent: null,
                assignee: { displayName: 'Queue Owner' },
                updated: '2026-05-03T00:00:00.000+0000',
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

function callsFor(calls, pathname, method = 'GET') {
    return calls.filter(call => call.method === method && call.pathname === pathname);
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

function horizontalSpread(values) {
    return Math.max(...values) - Math.min(...values);
}

async function collectSubtaskRowMetrics(page) {
    return page.locator('.story-subtask-row').evaluateAll((rows) => rows.map((row) => {
        const rectFor = (selector) => {
            const node = row.querySelector(selector);
            if (!node) return null;
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
        const rowRect = row.getBoundingClientRect();
        return {
            row: {
                x: rowRect.x,
                y: rowRect.y,
                right: rowRect.right,
                bottom: rowRect.bottom,
                width: rowRect.width,
                height: rowRect.height,
            },
            name: rectFor('.story-subtask-name'),
            status: rectFor('.status-pill'),
            statusText: row.querySelector('.status-pill')?.textContent || '',
            statusClassName: row.querySelector('.status-pill')?.className || '',
            statusBackgroundColor: row.querySelector('.status-pill') ? getComputedStyle(row.querySelector('.status-pill')).backgroundColor : '',
            assignee: rectFor('.story-subtask-assignee'),
            updated: rectFor('.story-subtask-updated'),
        };
    }));
}

async function collectStorySubtaskControlMetrics(page) {
    return page.locator('.task-item[data-task-key="PROD-1"]').evaluate((card) => {
        const rectFor = (selector) => {
            const node = card.querySelector(selector);
            if (!node) return null;
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
        return {
            inlineToggle: rectFor('.task-inline-meta .story-subtasks-toggle'),
            statusStackToggle: rectFor('.task-status-stack .story-subtasks-toggle'),
            status: rectFor('.task-meta .task-status'),
            toggle: rectFor('.task-subtask-meta .story-subtasks-toggle'),
            updated: rectFor('.task-updated'),
            assignee: rectFor('.task-assignee'),
            team: rectFor('.task-team'),
            statusText: card.querySelector('.task-meta .task-status')?.textContent || '',
            statusLineCount: (() => {
                const node = card.querySelector('.task-meta .task-status');
                if (!node) return 0;
                const style = getComputedStyle(node);
                const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) * 1.2);
                return Math.round(node.getBoundingClientRect().height / lineHeight);
            })(),
        };
    });
}

async function expectUpdateConnectedSubtaskControl(page) {
    const metrics = await collectStorySubtaskControlMetrics(page);
    const verticalCenter = (rect) => rect.y + (rect.height / 2);
    expect(metrics.inlineToggle).toBeNull();
    expect(metrics.statusStackToggle).toBeNull();
    expect(metrics.status).toBeTruthy();
    expect(metrics.assignee).toBeTruthy();
    expect(metrics.updated).toBeTruthy();
    expect(metrics.toggle).toBeTruthy();
    expect(metrics.statusText.trim()).toBe('In Progress');
    expect(metrics.statusLineCount).toBe(1);
    expect(metrics.toggle.x).toBeGreaterThan(metrics.updated.right);
    expect(Math.abs(verticalCenter(metrics.assignee) - verticalCenter(metrics.status))).toBeLessThanOrEqual(2);
    expect(Math.abs(verticalCenter(metrics.updated) - verticalCenter(metrics.status))).toBeLessThanOrEqual(2);
    expect(Math.abs(verticalCenter(metrics.toggle) - verticalCenter(metrics.status))).toBeLessThanOrEqual(2);
}

async function expectDesktopSubtaskTableLayout(page) {
    const metrics = await collectSubtaskRowMetrics(page);
    expect(metrics).toHaveLength(3);
    expect(horizontalSpread(metrics.map(row => row.status.x))).toBeLessThanOrEqual(1);
    expect(horizontalSpread(metrics.map(row => row.status.width))).toBeLessThanOrEqual(2);
    expect(horizontalSpread(metrics.map(row => row.assignee.x))).toBeLessThanOrEqual(1);
    expect(horizontalSpread(metrics.map(row => row.updated.x))).toBeLessThanOrEqual(1);
    for (const row of metrics) {
        expect(row.name.x).toBeLessThan(row.status.x);
        expect(row.statusBackgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(row.statusBackgroundColor).not.toBe('transparent');
        expect(row.status.right).toBeLessThan(row.assignee.x);
        expect(row.assignee.right).toBeLessThan(row.updated.x);
        expect(row.updated.right).toBeLessThanOrEqual(row.row.right + 1);
    }
}

async function expectMobileSubtaskTableLayout(page) {
    const metrics = await collectSubtaskRowMetrics(page);
    expect(metrics).toHaveLength(3);
    expect(horizontalSpread(metrics.map(row => row.status.x))).toBeLessThanOrEqual(1);
    expect(horizontalSpread(metrics.map(row => row.status.width))).toBeLessThanOrEqual(2);
    expect(horizontalSpread(metrics.map(row => row.updated.x))).toBeLessThanOrEqual(1);
    for (const row of metrics) {
        expect(row.name.y).toBeLessThan(row.status.y);
        expect(Math.abs(row.status.y - row.updated.y)).toBeLessThanOrEqual(4);
        expect(row.assignee.width).toBe(0);
        expect(row.assignee.height).toBe(0);
        expect(row.name.right).toBeLessThanOrEqual(row.row.right + 1);
        expect(row.updated.right).toBeLessThanOrEqual(row.row.right + 1);
    }
    const overflow = await page.locator('.story-subtasks-panel').evaluate(node => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
}

async function installEngSubtasksFixture(page, calls, { subtaskResponse } = {}) {
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: dashboardCss,
    }));
    await page.route('**/api/**', route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
        });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
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
                    teamLabels: { 'team-alpha': 'Alpha Team' },
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
            const issues = project === 'product' && !purpose ? [parentStory()] : [];
            const epics = project === 'product' ? { 'PROD-EPIC': productEpic() } : {};
            return json({ issues, epics, epicsInScope: Object.values(epics), names: {} });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        if (url.pathname === '/api/issues/subtasks') {
            const response = subtaskResponse ? subtaskResponse(url) : subtaskPayload();
            if (response && Object.prototype.hasOwnProperty.call(response, 'body')) {
                return json(response.body, response.status || 200);
            }
            return json(response);
        }
        return json({});
    });
}

async function runSubtaskFlow(page, viewport, screenshotName) {
    const calls = [];
    await page.setViewportSize(viewport);
    await installEngSubtasksFixture(page, calls);
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
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    const startupCounts = summarizeCalls(calls);
    expect(startupCounts['GET /api/issues/subtasks'] || 0).toBe(0);
    const toggle = page.locator('.story-subtasks-toggle').first();
    await expect(toggle).toContainText('3 subtasks');
    await expect(page.locator('.story-subtasks-progress-percent').first()).toHaveText('33%');

    await toggle.click();
    await waitForCallCount(calls, call => call.pathname === '/api/issues/subtasks', 1);
    const subtaskCall = callsFor(calls, '/api/issues/subtasks')[0];
    expect(subtaskCall.params.parentKey).toBe('PROD-1');
    expect(subtaskCall.params.sprint).toBe(String(selectedSprintId));
    expect(subtaskCall.params.refresh).toBeUndefined();
    const rows = page.locator('.story-subtask-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Synthetic subtask');
    await expect(rows.nth(0)).toContainText('Analysis');
    await expect(rows.nth(0)).toContainText('Synthetic Owner');
    await expect(rows.nth(0)).toContainText('2026-05-01');
    await expect(rows.nth(1)).toContainText('Review subtask');
    await expect(rows.nth(1)).toContainText('Done');
    await expect(rows.nth(2)).toContainText('Waiting subtask');
    await expect(rows.nth(2)).toContainText('Release');

    await waitForVisualSettled(page);
    if (viewport.width > 760) {
        await expectUpdateConnectedSubtaskControl(page);
        await expectDesktopSubtaskTableLayout(page);
    }
    await page.screenshot({ path: `${screenshotDir}/${screenshotName}-expanded.png`, fullPage: true });

    await toggle.click();
    await expect(rows.first()).toBeHidden();
    await toggle.click();
    await expect(rows).toHaveCount(3);
    await waitForCallCount(calls, call => call.pathname === '/api/issues/subtasks', 1);
    for (const call of callsFor(calls, '/api/issues/subtasks')) {
        expect(call.params.refresh).toBeUndefined();
    }
}

for (const { name, viewport } of [
    { name: 'desktop', viewport: { width: 1280, height: 760 } },
    { name: 'narrow', viewport: { width: 390, height: 760 } },
]) {
    test(`ENG story subtasks load on demand and reuse cached rows on ${name}`, async ({ page }) => {
        await runSubtaskFlow(page, viewport, name);
    });
}

test('ENG story subtask retry refreshes failed rows', async ({ page }) => {
    const calls = [];
    let subtaskAttempts = 0;
    await page.setViewportSize({ width: 1280, height: 760 });
    await installEngSubtasksFixture(page, calls, {
        subtaskResponse: () => {
            subtaskAttempts += 1;
            if (subtaskAttempts === 1) {
                return { status: 500, body: { error: 'jira_unavailable' } };
            }
            return subtaskPayload();
        },
    });
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
    await page.locator('.story-subtasks-toggle').first().click();
    await waitForCallCount(calls, call => call.pathname === '/api/issues/subtasks', 1);
    await expect(page.locator('.story-subtasks-error')).toContainText('Failed to load subtasks.');

    await page.getByRole('button', { name: 'Retry' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/issues/subtasks', 2);
    const retryCall = callsFor(calls, '/api/issues/subtasks')[1];
    expect(retryCall.params.parentKey).toBe('PROD-1');
    expect(retryCall.params.sprint).toBe(String(selectedSprintId));
    expect(retryCall.params.refresh).toBe('true');
    await expect(page.locator('.story-subtask-row')).toHaveCount(3);
});
