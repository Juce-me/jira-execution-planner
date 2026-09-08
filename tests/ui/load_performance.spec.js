const { test, expect } = require('@playwright/test');
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const { installDashboardFixture } = require('./epm_home_token_fixture');

const root = path.resolve(__dirname, '../..');
const origin = 'http://performance.test';
let script;
let css;
let dashboardScript;
const payload = {
    enabled: true, contextual: true,
    summary: { sampleCount: 25, eligibleCount: 0, avgMs: 6000, p50Ms: 5000, p95Ms: 12000, breachCount: 5, errorCount: 1, cancelledCount: 1, cappedCount: 2, unknownCount: 21 },
    trend: [{ date: '2026-09-08', sampleCount: 21, avgMs: 6000, p95Ms: 12000 }],
    filters: { groups: ['sample-group'], sprints: ['42'], revisions: ['test-revision'] },
    samples: [{ loadId: 'sample-load', recordedAt: '2026-09-08T12:00:00Z', groupId: 'sample-group', sprintId: '42', surface: 'eng_sprint', outcome: 'success', durationMs: 12000, firstContentMs: 1500, revision: 'test-revision', environment: 'test', lanes: [
        { project: 'Product', durationMs: 11000, issueCount: 320, epicCount: 20, storyCount: 300, payloadBytes: 42000, cacheState: 'miss', completeness: 'unknown', stages: { jira: 10000 }, jiraRequests: 4, jiraPages: 4, jiraRetries: 0 },
    ] }],
};

test.beforeAll(() => {
    script = buildSync({ stdin: { contents: `import * as React from 'react'; import {createRoot} from 'react-dom/client'; import PerformanceSettings from './frontend/src/settings/PerformanceSettings.jsx'; createRoot(document.getElementById('root')).render(<PerformanceSettings backendUrl="" />);`, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
    css = buildSync({ entryPoints: [path.join(root, 'frontend/src/styles/dashboard.css')], bundle: true, write: false }).outputFiles[0].text + fs.readFileSync(path.join(root, 'frontend/src/styles/settings/performance.css'), 'utf8');
    dashboardScript = buildSync({ entryPoints: [path.join(root, 'frontend/src/dashboard.jsx')], bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text;
});

async function openMeasuredDashboard(page, { admin = true, delayedConfig = false, debugEnabled = true } = {}) {
    const fixture = await installDashboardFixture(page);
    const samples = [];
    const taskCalls = [];
    const dependencyCalls = [];
    let releaseDependencies;
    const gate = new Promise(resolve => { releaseDependencies = resolve; });
    let releaseConfig;
    const configGate = new Promise(resolve => { releaseConfig = resolve; });
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ contentType: 'application/javascript', body: dashboardScript }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({ contentType: 'text/css', body: css }));
    await page.addInitScript(() => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'eng', selectedSprint: 34625 }));
    });
    await page.route('**/api/config?**', async route => {
        if (delayedConfig) await configGate;
        return route.fulfill({ json: {
        jiraUrl: 'https://jira.example.test', authMode: 'atlassian_oauth', settingsAdminOnly: false,
        userCanEditSettings: true, environmentConfigExists: true, projectsConfigured: true,
        performanceDebugEnabled: debugEnabled, performanceAdminAvailable: admin,
    } }); });
    await page.route('**/api/groups-config', route => route.fulfill({ json: {
        version: 1, groups: [{ id: 'sample-group', name: 'Sample Department', teamIds: ['sample-team'] }],
        defaultGroupId: 'sample-group', source: 'workspace_db', preferences: {
            customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            visibleGroupIds: ['sample-group'], activeGroupId: 'sample-group', effectiveVisibleGroupIds: ['sample-group'],
        },
    } }));
    await page.route('**/api/tasks-with-team-name?**', route => {
        const params = Object.fromEntries(new URL(route.request().url()).searchParams);
        taskCalls.push(params);
        const key = params.project === 'tech' ? 'TEST-2' : 'TEST-1';
        return route.fulfill({ json: { issues: [{ key, fields: { summary: `Sample ${params.project} story`, teamId: 'sample-team', teamName: 'Sample Team', issuetype: { name: 'Story' }, status: { name: 'In Progress' }, priority: { name: 'Medium' }, issuelinks: [] } }], epics: {}, epicsInScope: [], loadMetrics: { completeness: 'unknown', cacheState: 'miss', jiraRequests: 1, jiraPages: 1, jiraRetries: 0 } } });
    });
    await page.route('**/api/dependencies', async route => {
        dependencyCalls.push(route.request().postDataJSON());
        await gate;
        await route.fulfill({ json: { dependencies: {} } });
    });
    await page.route('**/api/performance/loads', async route => {
        samples.push(route.request().postDataJSON());
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto(fixture.appBaseUrl);
    return { samples, taskCalls, dependencyCalls, releaseDependencies, releaseConfig };
}

for (const debugEnabled of [true, false]) {
    test(`slow config does not block data load and ${debugEnabled ? 'enables' : 'discards'} pending observation`, async ({ page }) => {
        const state = await openMeasuredDashboard(page, { delayedConfig: true, debugEnabled });
        await expect.poll(() => state.dependencyCalls.length).toBe(1);
        expect(state.taskCalls.filter(call => !call.purpose)).toHaveLength(2);
        state.releaseDependencies();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(state.samples).toHaveLength(0);
        const configResponse = page.waitForResponse(response => response.url().includes('/api/config?'));
        state.releaseConfig();
        await configResponse;
        if (debugEnabled) {
            await expect.poll(() => state.samples.length).toBe(1);
            expect(state.samples[0].lanes).toHaveLength(2);
        } else {
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            expect(state.samples).toHaveLength(0);
        }
        expect(state.taskCalls.filter(call => !call.purpose)).toHaveLength(2);
    });
}

test('real dashboard emits one measured load after both lanes and delayed dependencies', async ({ page }) => {
    const state = await openMeasuredDashboard(page);
    await expect.poll(() => state.dependencyCalls.length).toBe(1);
    expect(state.samples).toHaveLength(0);
    expect(state.taskCalls.filter(call => !call.purpose)).toHaveLength(2);
    expect(state.taskCalls.filter(call => !call.purpose).map(call => call.debugTimings)).toEqual(['true', 'true']);
    state.releaseDependencies();
    await expect.poll(() => state.samples.length).toBe(1);
    expect(state.samples[0].outcome).toBe('success');
    expect(state.samples[0].lanes.map(lane => lane.project).sort()).toEqual(['product', 'tech']);
    expect(state.samples[0].dependencyDurationMs).toBeGreaterThan(0);
    expect(state.dependencyCalls).toHaveLength(1);
    await page.route('**/api/admin/performance?**', route => route.fulfill({ json: payload }));
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Performance', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Load performance' })).toBeVisible();
    await expect(dialog.getByRole('img', { name: /Daily average/ })).toBeVisible();
    const performancePanel = dialog.locator('.performance-settings');
    const controls = await performancePanel.locator('.stats-control-group').evaluateAll(groups => groups.map(group => {
        const label = group.querySelector('label');
        return { right: label.getBoundingClientRect().right, groupRight: group.getBoundingClientRect().right,
            scrollWidth: label.scrollWidth, clientWidth: label.clientWidth };
    }));
    expect(controls).toHaveLength(4);
    for (const control of controls) {
        expect(control.right).toBeLessThanOrEqual(control.groupRight);
        expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
    }
    expect(await performancePanel.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    await dialog.locator('.performance-sample summary').scrollIntoViewIfNeeded();
    await dialog.locator('.performance-sample summary').click();
    const issueCountCell = dialog.getByRole('cell', { name: '320', exact: true });
    await issueCountCell.scrollIntoViewIfNeeded();
    await expect(issueCountCell).toBeVisible();
    const panelBounds = await performancePanel.boundingBox();
    const cellBounds = await issueCountCell.boundingBox();
    expect(cellBounds.y + cellBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height);
    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/admin-dashboard-details.png'), fullPage: true, animations: 'disabled' });
    await performancePanel.evaluate(element => { element.scrollTop = 0; });
    expect(state.samples).toHaveLength(1);
    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/admin-dashboard.png'), fullPage: true, animations: 'disabled' });
});

test('nonadmin cannot see Performance even when general settings editing is open', async ({ page }) => {
    const state = await openMeasuredDashboard(page, { admin: false });
    state.releaseDependencies();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin', exact: true }).click();
    await expect(dialog.getByRole('tab', { name: 'Scope projects', exact: true })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Performance', exact: true })).toHaveCount(0);
});

async function openPanel(page, response = payload) {
    await page.route(`${origin}/api/admin/performance?**`, route => route.fulfill({ json: response }));
    await page.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: `<html><head><style>${css}</style></head><body><main style="max-width:900px;margin:20px auto;padding:20px;background:white" id="root"></main><script>${script}</script></body></html>` }));
    await page.goto(origin);
}

test('admin chart retains a 12-second spike and exposes scoped lane evidence', async ({ page }) => {
    await openPanel(page);
    await expect(page.getByText('Contextual timings — completeness unverified.', { exact: false })).toBeVisible();
    await page.getByLabel('Performance group', { exact: true }).selectOption('sample-group');
    await expect(page.getByRole('heading', { name: 'Recent load evidence' })).toBeVisible();
    await page.locator('.performance-sample summary').click();
    await expect(page.getByText('First lane rendered: 1.50s')).toBeVisible();
    await expect(page.getByRole('cell', { name: '320', exact: true })).toBeVisible();
    await expect(page.getByText('Product stages: jira: 10.00s')).toBeVisible();
    const positions = await page.locator('svg circle').evaluateAll(circles => circles.map(circle => ({ cy: Number(circle.getAttribute('cy')), box: circle.getBoundingClientRect().toJSON(), parent: circle.ownerSVGElement.getBoundingClientRect().toJSON() })));
    expect(positions).toHaveLength(2);
    for (const point of positions) {
        expect(point.cy).toBeGreaterThanOrEqual(24);
        expect(point.box.top).toBeGreaterThanOrEqual(point.parent.top);
        expect(point.box.bottom).toBeLessThanOrEqual(point.parent.bottom);
    }
    await page.getByText('Daily values', { exact: true }).click();
    await expect(page.getByRole('cell', { name: '12.00s', exact: true })).toBeVisible();
    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/admin-spike.png'), fullPage: true, animations: 'disabled' });
});

test('401 engages global auth recovery without rendering a local error', async ({ page }) => {
    await openPanel(page);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.route(`${origin}/api/admin/performance?**`, route => route.fulfill({ status: 401, json: { error: 'auth_required' } }));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__JEP_AUTH_REQUIRED__?.locked)).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const enabled of [true, false]) {
    test(`empty performance history is concise with collection ${enabled ? 'enabled' : 'disabled'}`, async ({ page }) => {
        await openPanel(page, { enabled, summary: { sampleCount: 0, eligibleCount: 0 }, samples: [], trend: [] });
        await expect(page.getByRole('status')).toHaveText(enabled
            ? 'No loads recorded in this selection yet. Open ENG and refresh a group to collect a measurement.'
            : 'Collection is paused or database storage is unavailable.');
        await expect(page.locator('.performance-summary')).toHaveCount(0);
        await expect(page.locator('.performance-settings p').filter({ hasText: 'Unknown' })).toHaveCount(0);
        const fontSize = await page.locator('.performance-settings p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
        expect(fontSize).toBeLessThanOrEqual(14);
        fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
        await page.screenshot({ path: path.join(root, `tmp/load-performance/empty-${enabled}.png`), fullPage: true, animations: 'disabled' });
    });
}
