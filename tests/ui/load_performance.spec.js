const { test, expect } = require('@playwright/test');
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const { expectConfigBootstrapHoldsJiraWork, installDashboardFixture } = require('./epm_view_fixture');
const { hoverEvidence } = require('./design_system_hover_helpers');

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

const phaseSet = (wait, index, focused, rest) => ({ waitMs: wait, indexMs: index, focusedMs: focused, restMs: rest });
const boardWeek = (weekStart, parts, extra = {}) => {
    const total = parts.reduce((sum, value) => sum + value, 0);
    return { weekStart, loads: 12, medianMs: total, p95Ms: Math.round(total * 1.2), phases: phaseSet(...parts), medianJiraRequests: 18,
        retries: 0, medianPayloadBytes: 682270, breachCount: 12, errors: 0, cancelled: 0, partial: false, ...extra };
};
const boardSample = (loadId, recordedAt, parts, revision) => ({
    loadId, recordedAt, groupId: 'sample-group', sprintId: null, surface: 'eng_board', scopeType: 'component', outcome: 'success',
    durationMs: parts.reduce((sum, value) => sum + value, 0), phases: phaseSet(...parts), indexMs: parts[1],
    firstFocusedContentMs: parts[0] + parts[1] + parts[2], focusedCompleteMs: parts[1] + parts[2], issueCount: 449, epicCount: 165,
    payloadBytes: 682270, jiraRequests: 18, jiraPages: 11, jiraRetries: 0, cacheState: 'miss', completeness: 'complete',
    peakChildSearches: 2, revision, environment: 'staging', lanes: [],
});
const boardPayload = {
    enabled: true, contextual: false,
    summary: { sampleCount: 36, eligibleCount: 36, avgMs: 10000, p50Ms: 10000, p95Ms: 12000, breachCount: 36, errorCount: 0, cancelledCount: 0, cappedCount: 0, unknownCount: 0 },
    trend: [],
    weekly: { scopeType: 'component', mixedScopes: false, weeks: [
        boardWeek('2026-10-05', [4800, 1700, 1600, 1400]),
        boardWeek('2026-10-12', [5300, 1800, 1700, 1500]),
        boardWeek('2026-10-19', [5200, 1800, 1700, 1600], { partial: true, loads: 4 }),
    ] },
    filters: { groups: ['sample-group'], sprints: [], surfaces: ['eng_board', 'eng_sprint'], scopeTypes: ['component'], cacheStates: ['miss'], revisions: ['rev-old', 'rev-new'], scopeCohortDigests: [] },
    samples: [
        boardSample('load-a', '2026-10-21T13:41:00+00:00', [900, 1800, 900, 1100], 'rev-new'),
        boardSample('load-b', '2026-10-21T09:35:00+00:00', [5260, 1800, 1720, 2430], 'rev-old'),
        boardSample('load-c', '2026-10-20T11:03:00+00:00', [5200, 1800, 1800, 1700], 'rev-old'),
        boardSample('load-d', '2026-10-19T15:20:00+00:00', [5500, 1900, 1700, 1400], 'rev-old'),
        boardSample('load-e', '2026-10-13T10:00:00+00:00', [5300, 1800, 1700, 1500], 'rev-old'),
    ],
    truncated: false, samplesTruncated: false,
};

test.beforeAll(() => {
    script = buildSync({ stdin: { contents: `import * as React from 'react'; import {createRoot} from 'react-dom/client'; import PerformanceSettings from './frontend/src/settings/PerformanceSettings.jsx'; createRoot(document.getElementById('root')).render(<PerformanceSettings backendUrl="" />);`, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
    css = buildSync({ entryPoints: [path.join(root, 'frontend/src/styles/dashboard.css')], bundle: true, write: false }).outputFiles[0].text + fs.readFileSync(path.join(root, 'frontend/src/styles/settings/performance.css'), 'utf8');
    dashboardScript = buildSync({ entryPoints: [path.join(root, 'frontend/src/dashboard.jsx')], bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text;
});

async function openMeasuredDashboard(page, { admin = true, delayedConfig = false, debugEnabled = true } = {}) {
    const fixture = await installDashboardFixture(page);
    const paths = [];
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
    await page.route('**/api/eng/story-readiness?**', route => route.fulfill({
        json: { schemaVersion: 1, complete: true, scope: {}, epics: [] },
    }));
    await page.route('**/api/dependencies', async route => {
        dependencyCalls.push(route.request().postDataJSON());
        await gate;
        await route.fulfill({ json: { dependencies: {} } });
    });
    await page.route('**/api/performance/loads', async route => {
        samples.push(route.request().postDataJSON());
        await route.fulfill({ json: { saved: true } });
    });
    page.on('request', request => paths.push(new URL(request.url()).pathname));
    await page.goto(fixture.appBaseUrl);
    return { paths, samples, taskCalls, dependencyCalls, releaseDependencies, releaseConfig };
}

for (const debugEnabled of [true, false]) {
    test(`slow config holds every load until it arrives, then ${debugEnabled ? 'records' : 'discards'} the measured load`, async ({ page }) => {
        const state = await openMeasuredDashboard(page, { delayedConfig: true, debugEnabled });
        await expectConfigBootstrapHoldsJiraWork(page, () => state.paths);
        expect(state.taskCalls).toHaveLength(0);
        expect(state.dependencyCalls).toHaveLength(0);
        expect(state.samples).toHaveLength(0);

        const configResponse = page.waitForResponse(response => response.url().includes('/api/config?'));
        state.releaseConfig();
        await configResponse;
        await expect.poll(() => state.dependencyCalls.length).toBe(1);
        expect(state.taskCalls.filter(call => !call.purpose)).toHaveLength(2);
        expect(state.samples).toHaveLength(0);
        state.releaseDependencies();
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
        return { label: label.textContent.trim(), right: label.getBoundingClientRect().right, groupRight: group.getBoundingClientRect().right,
            scrollWidth: label.scrollWidth, clientWidth: label.clientWidth };
    }));
    expect(controls.map(control => control.label)).toEqual([
        'Group', 'Surface', 'Scope', 'Sprint', 'Cache', 'Revision', 'Configuration cohort',
    ]);
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
    await page.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>${css}</style></head><body><main style="max-width:900px;margin:20px auto;padding:20px;background:white" id="root"></main><script>${script}</script></body></html>` }));
    await page.goto(origin);
}

test('component report omits the blank Sprint filter', async ({ page }) => {
    const response = { ...payload, filters: {
        groups: ['sample-group'], sprints: ['42'], surfaces: ['eng_sprint', 'eng_board'],
        scopeTypes: ['all_work', 'component', 'sprint'], cacheStates: ['miss'],
        revisions: ['test-revision'], scopeCohortDigests: ['sample-cohort'],
    } };
    await openPanel(page, response);

    await expect(page.getByLabel('Performance sprint', { exact: true })).toHaveValue('');
    const reportRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api/admin/performance' && url.searchParams.get('scopeType') === 'component';
    });
    await page.getByLabel('Performance scope', { exact: true }).selectOption('component');

    const query = new URL((await reportRequest).url()).searchParams;
    expect(query.get('scopeType')).toBe('component');
    expect(query.has('sprintId')).toBe(false);
    expect(query.get('sprintId')).toBeNull();
});

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

async function openBoardWeeks(page, viewport = { width: 1000, height: 1100 }) {
    await page.setViewportSize(viewport);
    await openPanel(page, boardPayload);
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_board');
    await expect(page.getByRole('heading', { name: 'Where a Board load spends its time, by week' })).toBeVisible();
}

test('Board weekly view stacks four phases per week and follows the selected week', async ({ page }) => {
    await openBoardWeeks(page);
    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/board-weeks.png'), fullPage: true, animations: 'disabled' });
    await expect(page.locator('.performance-week-segment')).toHaveCount(12);
    await expect(page.locator('.performance-settings table').first().locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('.performance-summary')).toContainText('Week of Oct 19 (so far)');
    await expect(page.getByRole('heading', { name: 'Loads in the week of Oct 19 (so far)' })).toBeVisible();
    await expect(page.locator('.performance-loads tbody tr')).toHaveCount(5);   // four loads and one revision divider
    await expect(page.locator('.performance-revision-change')).toContainText('Revision changed: loads above ran on rev-new, loads below on rev-old');

    await page.getByRole('button', { name: 'Oct 12', exact: true }).click();
    await expect(page.locator('.performance-summary')).toContainText('Week of Oct 12:');
    await expect(page.locator('.performance-loads tbody tr')).toHaveCount(1);
    await expect(page.locator('.performance-week-selection')).toHaveCount(1);
    await page.locator('.performance-week-hit[data-week-hit="2026-10-05"]').click();
    await expect(page.locator('.performance-summary')).toContainText('Week of Oct 5:');
    await expect(page.getByText('Showing 0 of 12 loads.')).toBeVisible();

    // The legend isolates a phase and a second press restores every phase.
    const epicIndex = page.getByRole('button', { name: 'Epic index', exact: true });
    await epicIndex.click();
    await expect(page.locator('.performance-week-segment.is-dimmed')).toHaveCount(9);
    await expect(page.getByRole('button', { name: 'Focused column', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(epicIndex).toHaveAttribute('aria-pressed', 'true');
    await epicIndex.click();
    await expect(page.locator('.performance-week-segment.is-dimmed')).toHaveCount(0);
});

test('Board loads list sorts by total, expands details and keeps the revision divider only in time order', async ({ page }) => {
    await openBoardWeeks(page);
    const totals = () => page.locator('.performance-loads tbody tr:not(.performance-revision-change):not(.performance-load-detail) td.num:nth-child(3)').allTextContents();
    expect(await totals()).toEqual(['4.70s', '11.21s', '10.50s', '10.50s']);
    await page.getByRole('button', { name: 'Total', exact: true }).click();
    expect(await totals()).toEqual(['11.21s', '10.50s', '10.50s', '4.70s']);
    await expect(page.locator('.performance-revision-change')).toHaveCount(0);
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Total');
    await page.getByRole('button', { name: 'Total', exact: true }).click();
    expect(await totals()).toEqual(['4.70s', '10.50s', '10.50s', '11.21s']);

    const toggle = page.locator('.performance-load-toggle').first();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.performance-load-detail')).toContainText('peak child searches 2');
    await expect(page.locator('.performance-load-detail')).toContainText('666 KB');
});

test('Board weekly view asks for one scope when scopes are mixed', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openPanel(page, { ...boardPayload, weekly: { scopeType: null, mixedScopes: true, weeks: [] } });
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_board');
    await expect(page.getByRole('status')).toContainText('Choose one Scope');
    await expect(page.locator('.performance-week-chart')).toHaveCount(0);
});

test('weekly chart labels and marks stay inside the drawing, and the page never scrolls sideways', async ({ page }) => {
    for (const viewport of [{ width: 1000, height: 1100 }, { width: 390, height: 900 }]) {
        await openBoardWeeks(page, viewport);
        const clipped = await page.locator('.performance-week-svg').evaluate(svg => {
            const box = svg.getBoundingClientRect();
            return [...svg.querySelectorAll('text, path, rect:not(.performance-week-hit)')].map(node => ({ node: node.textContent || node.getAttribute('class'), rect: node.getBoundingClientRect() }))
                .filter(({ rect }) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5 || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5)
                .map(({ node }) => node);
        });
        expect(clipped, `${viewport.width}px`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${viewport.width}px page overflow`).toBeLessThanOrEqual(0);
        const columns = await page.locator('.performance-week-segment').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        expect(columns.every(height => height > 0)).toBe(true);
    }
});

test('weekly chart readout names every phase, stays inside the viewport and above the settings layer', async ({ page }) => {
    await openBoardWeeks(page, { width: 700, height: 900 });
    for (const week of ['2026-10-05', '2026-10-19']) {
        const hit = page.locator(`.performance-week-hit[data-week-hit="${week}"]`);
        const box = await hit.boundingBox();
        for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.5], [0.95, 0.95]]) {
            await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
            const bubble = page.locator('.performance-week-hover-bubble');
            await expect(bubble).toBeVisible();
            const rect = await bubble.boundingBox();
            const viewport = page.viewportSize();
            expect(rect.x, `${week} ${fx} left edge`).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.width, `${week} ${fx} right edge`).toBeLessThanOrEqual(viewport.width);
            expect(rect.y, `${week} ${fy} top edge`).toBeGreaterThanOrEqual(0);
            expect(rect.y + rect.height, `${week} ${fy} bottom edge`).toBeLessThanOrEqual(viewport.height);
            expect(rect.width, 'sized to content, not a wide fixed box').toBeLessThanOrEqual(260);
        }
    }
    const bubble = page.locator('.performance-week-hover-bubble');
    for (const text of ['Before first byte', 'Epic index', 'Focused column', 'Other columns + render', 'Median', 'Jira calls 18 · retries 0']) await expect(bubble).toContainText(text);
    expect(await bubble.evaluate(node => ({ pointerEvents: getComputedStyle(node).pointerEvents, zIndex: Number(getComputedStyle(node).zIndex) }))).toEqual({ pointerEvents: 'none', zIndex: expect.any(Number) });
    expect(await bubble.evaluate(node => Number(getComputedStyle(node).zIndex))).toBeGreaterThan(9100);
    expect(await page.locator('.performance-week-chart [title], .performance-week-chart title').count()).toBe(0);
    await page.mouse.move(2, 2);
    await expect(bubble).toHaveCount(0);
});

test('weekly view controls hover inside their own box and move nothing', async ({ page }, testInfo) => {
    await openBoardWeeks(page);
    await hoverEvidence(page, page.locator('.performance-sort').first(), testInfo, 'performance-sort-header', { foundation: true });
    await hoverEvidence(page, page.locator('.performance-week-pick').first(), testInfo, 'performance-week-pick', { foundation: true });
    await hoverEvidence(page, page.locator('.performance-load-toggle').first(), testInfo, 'performance-load-toggle', { foundation: true });
    const legend = page.locator('.performance-week-legend-item').first();
    const rest = await legend.boundingBox();
    await legend.hover();
    expect(await legend.boundingBox()).toEqual(rest);
    expect(await legend.evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, transform: getComputedStyle(node).transform }))).toEqual({ shadow: 'none', transform: 'none' });
});

test('secondary filters sit behind a disclosure that opens itself while one is active', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openPanel(page, boardPayload);
    const disclosure = page.locator('.performance-more-filters');
    await expect(disclosure).not.toHaveAttribute('open', '');
    await expect(page.getByLabel('Performance cache', { exact: true })).toBeHidden();
    await disclosure.locator('summary').click();
    await page.getByLabel('Performance cache', { exact: true }).selectOption('miss');
    await expect(disclosure.locator('summary')).toContainText('1 active');
    await expect(disclosure).toHaveAttribute('open', '');
});

const catchUpWeek = (weekStart, list, full, extra = {}) => ({ weekStart, partial: false, loads: 12, listLoads: 14, errors: 1, cancelled: 2, capped: 0,
    cacheHitShare: 0.25, listLoaded: { avgMs: Math.round(list * 1.1), medianMs: list, p95Ms: Math.round(list * 1.7) },
    fullyLoaded: { avgMs: Math.round(full * 1.05), medianMs: full, p95Ms: Math.round(full * 1.4) }, ...extra });
const catchUpWeeks = [
    catchUpWeek('2026-09-14', 2400, 7600, { partial: true }), catchUpWeek('2026-09-21', 2800, 8200), catchUpWeek('2026-09-28', 3000, 9500),
    catchUpWeek('2026-10-05', 2900, 9000), catchUpWeek('2026-10-12', 4100, 12000), catchUpWeek('2026-10-19', 3300, 9800, { partial: true }),
];
const catchUpPayload = { ...payload, summary: { ...payload.summary, avgMs: null, p50Ms: null, p95Ms: null, mixedCohorts: true },
    filters: { ...payload.filters, surfaces: ['eng_sprint', 'eng_board'] }, catchUpWeekly: { weeks: catchUpWeeks } };
const catchUpSection = 'section[aria-label="Catch Up weekly load times"]';

async function openCatchUpWeeks(page, viewport = { width: 1000, height: 1100 }, data = catchUpPayload) {
    await page.setViewportSize(viewport);
    await openPanel(page, data);
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.getByRole('heading', { name: 'List loaded, by week' })).toBeVisible();
}

test('Catch Up weekly view plots both durations as three lines per week', async ({ page }) => {
    await openCatchUpWeeks(page);
    for (const chart of ['listLoaded', 'fullyLoaded']) {
        const svg = page.locator(`.performance-week-svg[data-chart="${chart}"]`);
        await expect(svg).toBeVisible();
        await expect(svg.locator('.performance-line-path')).toHaveCount(3);
        await expect(svg.locator('.performance-line-point')).toHaveCount(18);
        await expect(svg.locator('.performance-week-hit')).toHaveCount(6);
    }
    await expect(page.locator('.performance-trend')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent load evidence' })).toBeVisible();
    const rows = page.locator('.performance-settings table').first().locator('tbody tr');
    await expect(rows).toHaveCount(6);
    const cells = await rows.nth(1).locator('td').allTextContents();
    expect(cells.slice(0, 9)).toEqual(['Sep 21', '14', '3.08s', '2.80s', '4.76s', '12', '8.61s', '8.20s', '11.48s']);   // list before full
    expect(cells.slice(9)).toEqual(['25%', '1', '2', '0']);
    expect((await rows.nth(0).locator('td').first().textContent())).toBe('Sep 14*');
    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/catch-up-weeks.png'), fullPage: true, animations: 'disabled' });
});

test('Catch Up series are told apart by colour and by shape, in the chart and in the legend', async ({ page }) => {
    await openCatchUpWeeks(page);
    const svg = page.locator('.performance-week-svg[data-chart="listLoaded"]');
    const strokes = await svg.locator('.performance-line-path').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke));
    expect(new Set(strokes).size).toBe(3);
    expect(strokes).not.toContain('none');
    const fills = await svg.locator('.performance-line-point').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
    expect(fills).not.toContain('none');
    await expect(svg.locator('circle[data-point="avgMs"]')).toHaveCount(6);
    await expect(svg.locator('rect[data-point="medianMs"]')).toHaveCount(6);
    expect(await svg.locator('rect[data-point="medianMs"]').first().getAttribute('width')).toBe('7');
    expect(await svg.locator('rect[data-point="p95Ms"]').first().getAttribute('transform')).toContain('rotate(45');
    const swatches = await page.locator('.performance-week-legend .burnout-color').evaluateAll(nodes => nodes.map(node => ({ radius: getComputedStyle(node).borderRadius, transform: getComputedStyle(node).transform })));
    expect(swatches[0].radius).toBe('50%');                 // Average: circle
    expect(swatches[1].radius).not.toBe('50%');             // Median: square
    expect(swatches[2].transform).not.toBe('none');         // p95: diamond
});

test('Catch Up weekly charts and the blended-cohort notice follow the Surface', async ({ page }) => {
    await openPanel(page, catchUpPayload);                                    // Surface "All": daily chart, legacy notice
    await expect(page.locator('.performance-trend')).toBeVisible();
    await expect(page.locator('.performance-week-svg[data-chart]')).toHaveCount(0);
    await expect(page.getByText('Choose one surface, scope, cache, revision and configuration cohort', { exact: false })).toBeVisible();
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.locator('.performance-week-svg[data-chart]')).toHaveCount(2);
    await expect(page.getByText('Choose one surface, scope, cache, revision and configuration cohort', { exact: false })).toHaveCount(0);
});

test('Catch Up drops the legacy summary line and its disclosure, and keeps the counts line; Surface All keeps all three', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 1100 });
    await openPanel(page, catchUpPayload);                                    // Surface "All"
    const summaryLine = page.locator('.performance-settings p').filter({ hasText: /^Average .* · p50 .* · p95 / });
    const disclosure = page.locator('.performance-settings summary').filter({ hasText: 'About these measurements' });
    const counts = page.getByText('5 loads above 4s · 1 errors · 1 cancelled · 2 capped · 21 completeness unverified', { exact: true });
    await expect(page.locator('.performance-trend')).toBeVisible();
    await expect(summaryLine).toHaveCount(1);
    await expect(disclosure).toHaveCount(1);
    await expect(counts).toBeVisible();
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.getByRole('heading', { name: 'List loaded, by week' })).toBeVisible();
    await expect(summaryLine).toHaveCount(0);
    await expect(page.locator('.performance-summary')).toHaveCount(0);
    await expect(page.getByText('About these measurements')).toHaveCount(0);
    await expect(counts).toBeVisible();
    await expect(page.getByText('Contextual timings — completeness unverified.', { exact: true })).toBeVisible();
});

test('Catch Up legend isolates one series in both charts, lines and markers, and a second press restores them', async ({ page }) => {
    await openCatchUpWeeks(page);
    const median = page.getByRole('button', { name: 'Median', exact: true });
    await median.click();
    await expect(page.locator('.performance-line-path.is-dimmed')).toHaveCount(4);      // two other series in two charts
    await expect(page.locator('.performance-line-point.is-dimmed')).toHaveCount(24);    // 6 weeks x 2 series x 2 charts
    await expect.poll(() => page.locator('.performance-line-path.is-dimmed').first().evaluate(node => getComputedStyle(node).opacity)).toBe('0.25');
    await expect(page.getByRole('button', { name: 'p95', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(median).toHaveAttribute('aria-pressed', 'true');
    await median.click();
    await expect(page.locator('.performance-line-path.is-dimmed, .performance-line-point.is-dimmed')).toHaveCount(0);
});

test('Catch Up weekly labels and marks stay inside each drawing, and the page never scrolls sideways, with six weeks', async ({ page }) => {
    for (const viewport of [{ width: 1000, height: 1100 }, { width: 390, height: 900 }]) {
        await openCatchUpWeeks(page, viewport);
        for (const chart of ['listLoaded', 'fullyLoaded']) {
            const clipped = await page.locator(`.performance-week-svg[data-chart="${chart}"]`).evaluate(svg => {
                const box = svg.getBoundingClientRect();
                return [...svg.querySelectorAll('text, polyline, circle, rect:not(.performance-week-hit)')]
                    .map(node => ({ node: node.textContent || node.getAttribute('class'), rect: node.getBoundingClientRect() }))
                    .filter(({ rect }) => rect.left < box.left - 0.5 || rect.right > box.right + 0.5 || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5)
                    .map(({ node }) => node);
            });
            expect(clipped, `${chart} ${viewport.width}px`).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${viewport.width}px page overflow`).toBeLessThanOrEqual(0);
        // The panel scrolls on its own (overflow-y: auto), so a sideways overflow inside it would not reach the page:
        // check the panel and every ancestor up to the document root (this harness mounts the panel without the settings dialog).
        const sideways = await page.locator('.performance-settings').evaluate(panel => {
            const found = [];
            for (let node = panel; node; node = node.parentElement) {
                found.push({ node: `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className ? `.${node.className}` : ''}`,
                    overflow: node.scrollWidth - node.clientWidth });
            }
            return found;
        });
        expect(sideways.length, 'panel, its ancestors and the document root').toBeGreaterThanOrEqual(4);
        expect(sideways.filter(entry => entry.overflow > 0), `${viewport.width}px sideways overflow`).toEqual([]);
    }
});

test('the 2s and 4s reference labels never overlap and stay inside each Catch Up chart, on a 60 s and a 120 s axis', async ({ page }) => {
    for (const slowest of [120000, 60000]) {
        const weeks = catchUpWeeks.map((week, index) => index === 4
            ? { ...week, fullyLoaded: { ...week.fullyLoaded, p95Ms: slowest } } : week);
        for (const viewport of [{ width: 1000, height: 1100 }, { width: 390, height: 900 }]) {
            await openCatchUpWeeks(page, viewport, { ...catchUpPayload, catchUpWeekly: { weeks } });
            for (const chart of ['listLoaded', 'fullyLoaded']) {
                const where = `${slowest} ms ${viewport.width}px ${chart}`;
                const svg = page.locator(`.performance-week-svg[data-chart="${chart}"]`);
                const { labels, box } = await svg.evaluate(node => ({
                    labels: [...node.querySelectorAll('.performance-reference text')].map(text => ({ label: text.textContent, ...text.getBoundingClientRect().toJSON() })),
                    box: node.getBoundingClientRect().toJSON(),
                }));
                expect(labels.map(label => label.label), where).toEqual(['2s target', '4s SLO']);
                const [target, slo] = labels;
                expect(target.height, `${where} painted text`).toBeGreaterThan(0);
                const apart = target.bottom <= slo.top || slo.bottom <= target.top || target.right <= slo.left || slo.right <= target.left;
                expect(apart, `${where} labels overlap: 2s ${target.top}-${target.bottom}, 4s ${slo.top}-${slo.bottom}`).toBe(true);
                for (const label of labels) {
                    expect(label.top, `${where} ${label.label} top`).toBeGreaterThanOrEqual(box.top - 0.5);
                    expect(label.bottom, `${where} ${label.label} bottom`).toBeLessThanOrEqual(box.bottom + 0.5);
                    expect(label.left, `${where} ${label.label} left`).toBeGreaterThanOrEqual(box.left - 0.5);
                    expect(label.right, `${where} ${label.label} right`).toBeLessThanOrEqual(box.right + 0.5);
                }
            }
            if (slowest === 120000 && viewport.width === 1000) {
                fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
                await page.locator('.performance-week-svg[data-chart="fullyLoaded"]').screenshot({ path: path.join(root, 'tmp/load-performance/catch-up-reference-labels-120s.png'), animations: 'disabled' });
            }
        }
    }
});

test('Catch Up weekly readout shows its own chart\'s numbers, stays inside the viewport and above the settings layer', async ({ page }) => {
    await openCatchUpWeeks(page, { width: 700, height: 900 });
    await expect(page.locator('.performance-week-chart')).toHaveCount(2);
    const expected = {
        listLoaded: { first: ['Week of Sep 14 · 14 loads', 'Average: 2.64s', 'Median: 2.40s', 'p95: 4.08s'], last: ['Week of Oct 19 · 14 loads', 'Average: 3.63s', 'Median: 3.30s', 'p95: 5.61s'] },
        fullyLoaded: { first: ['Week of Sep 14 · 12 loads', 'Average: 7.98s', 'Median: 7.60s', 'p95: 10.64s'], last: ['Week of Oct 19 · 12 loads', 'Average: 10.29s', 'Median: 9.80s', 'p95: 13.72s'] },
    };
    for (const chart of ['listLoaded', 'fullyLoaded']) {
        for (const which of ['first', 'last']) {
            const hit = page.locator(`.performance-week-svg[data-chart="${chart}"] .performance-week-hit`)[which]();
            await hit.evaluate(node => node.scrollIntoView({ block: 'center' }));
            const box = await hit.boundingBox();
            for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.5], [0.95, 0.95]]) {
                await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
                const bubble = page.locator('.performance-week-hover-bubble');
                await expect(bubble).toBeVisible();
                const rect = await bubble.boundingBox();
                const viewport = page.viewportSize();
                expect(rect.x, `${chart} ${which} left`).toBeGreaterThanOrEqual(0);
                expect(rect.x + rect.width, `${chart} ${which} right`).toBeLessThanOrEqual(viewport.width);
                expect(rect.y, `${chart} ${which} top`).toBeGreaterThanOrEqual(0);
                expect(rect.y + rect.height, `${chart} ${which} bottom`).toBeLessThanOrEqual(viewport.height);
                expect(rect.width).toBeLessThanOrEqual(260);   // the shared Board bubble class fixes this width
            }
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.02);
            const topAtStart = (await page.locator('.performance-week-hover-bubble').boundingBox()).y;
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.98);
            const topAtEnd = (await page.locator('.performance-week-hover-bubble').boundingBox()).y;
            expect(topAtEnd - topAtStart, `${chart} ${which} readout follows the pointer`).toBeGreaterThan(40);
            const bubble = page.locator('.performance-week-hover-bubble');
            for (const text of expected[chart][which]) await expect(bubble).toContainText(text);
            await expect(bubble.getByText('Errors 1 · cancelled 2 · capped 0 · cache hit 25%')).toBeVisible();
            await expect(bubble.getByText('Preliminary: fewer than 20 loads')).toBeVisible();
            expect(await bubble.evaluate(node => ({ pointerEvents: getComputedStyle(node).pointerEvents, zIndex: Number(getComputedStyle(node).zIndex) })))
                .toEqual({ pointerEvents: 'none', zIndex: expect.any(Number) });
            expect(await bubble.evaluate(node => Number(getComputedStyle(node).zIndex))).toBeGreaterThan(9100);
            await page.mouse.move(2, 2);
            await expect(bubble).toHaveCount(0);
        }
    }
    expect(await page.locator(`${catchUpSection} [title], ${catchUpSection} title`).count()).toBe(0);
});

test('Catch Up readout rows are never cut off and the readout stays inside the viewport, with large counts too', async ({ page }) => {
    const large = { errors: 128, cancelled: 64, capped: 32, cacheHitShare: 1 };
    const largeCountPayload = { ...catchUpPayload, catchUpWeekly: { weeks: [
        catchUpWeek('2026-09-07', 2600, 8000, { ...large, partial: true }), ...catchUpWeeks.slice(1, -1), catchUpWeek('2026-10-19', 3300, 9800, { ...large, partial: true }),
    ] } };
    for (const [data, counts] of [[catchUpPayload, 'Errors 1 · cancelled 2 · capped 0 · cache hit 25%'], [largeCountPayload, 'Errors 128 · cancelled 64 · capped 32 · cache hit 100%']]) {
        for (const viewport of [{ width: 390, height: 900 }, { width: 700, height: 900 }]) {
            await openCatchUpWeeks(page, viewport, data);
            for (const chart of ['listLoaded', 'fullyLoaded']) {
                for (const which of ['first', 'last']) {
                    const hit = page.locator(`.performance-week-svg[data-chart="${chart}"] .performance-week-hit`)[which]();
                    await hit.evaluate(node => node.scrollIntoView({ block: 'center' }));
                    const box = await hit.boundingBox();
                    for (const [fx, fy] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) {
                        const where = `${counts} ${viewport.width}px ${chart} ${which} ${fx},${fy}`;
                        await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
                        const bubble = page.locator('.performance-week-hover-bubble');
                        await expect(bubble).toBeVisible();
                        await expect(bubble).toContainText(counts);
                        await expect(bubble).toContainText('Preliminary: fewer than 20 loads');
                        const rect = await bubble.boundingBox();
                        expect(rect.x, `${where} left`).toBeGreaterThanOrEqual(0);
                        expect(rect.x + rect.width, `${where} right`).toBeLessThanOrEqual(viewport.width);
                        expect(rect.y, `${where} top`).toBeGreaterThanOrEqual(0);
                        expect(rect.y + rect.height, `${where} bottom`).toBeLessThanOrEqual(viewport.height);
                        const cut = await bubble.evaluate(node => {
                            const right = node.getBoundingClientRect().right;
                            return [...node.querySelectorAll('.burnout-hover-title, .burnout-hover-row, .burnout-hover-row span')]
                                .filter(element => element.scrollWidth > element.clientWidth || element.getBoundingClientRect().right > right + 0.5)
                                .map(element => element.textContent);
                        });
                        expect(cut, `${where} truncated rows`).toEqual([]);
                    }
                }
            }
            if (data === largeCountPayload && viewport.width === 700) {
                fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
                await page.locator('.performance-week-hover-bubble').screenshot({ path: path.join(root, 'tmp/load-performance/catch-up-readout-large-counts.png'), animations: 'disabled' });
            }
        }
    }
});

test('a click alone opens the Catch Up readout, so touch needs no hover', async ({ page }) => {
    await openCatchUpWeeks(page, { width: 700, height: 900 });
    const hit = page.locator('.performance-week-svg[data-chart="listLoaded"] .performance-week-hit').nth(2);
    await hit.scrollIntoViewIfNeeded();
    await hit.evaluate(node => {
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + 12 }));
    });
    await expect(page.locator('.performance-week-hover-bubble')).toContainText('Week of Sep 28');
});

test.describe('touch', () => {
    test.use({ hasTouch: true });
    test('tapping a week opens the Catch Up readout on a phone-width panel', async ({ page }) => {
        await openCatchUpWeeks(page, { width: 390, height: 900 });
        const hit = page.locator('.performance-week-svg[data-chart="fullyLoaded"] .performance-week-hit').nth(4);
        await hit.scrollIntoViewIfNeeded();
        await hit.tap();
        await expect(page.locator('.performance-week-hover-bubble')).toContainText('Week of Oct 12');
    });
});

test('Catch Up legend items hover inside their own box and move nothing', async ({ page }) => {
    await openCatchUpWeeks(page);
    for (const label of ['Average', 'Median', 'p95']) {
        const item = page.getByRole('button', { name: label, exact: true });
        const rest = await item.boundingBox();
        await item.hover();
        expect(await item.boundingBox()).toEqual(rest);
        expect(await item.evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, transform: getComputedStyle(node).transform }))).toEqual({ shadow: 'none', transform: 'none' });
    }
});

test('Catch Up weekly view says so when the selection has no load', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await openPanel(page, { ...catchUpPayload, catchUpWeekly: { weeks: [] } });
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.getByRole('status').filter({ hasText: 'No Catch Up loads in this selection yet.' })).toBeVisible();
    await expect(page.locator('.performance-week-svg[data-chart]')).toHaveCount(0);
});

const epmMetric = (median, spread) => ({ avgMs: Math.round(median * 1.1), medianMs: median, p95Ms: Math.round(median * spread) });
const epmWeek = (weekStart, listed, rolled, extra = {}) => ({ weekStart, partial: false, loads: 9, listLoads: 11, errors: 1, cancelled: 1,
    projectsListed: epmMetric(listed, 1.6), rollupLoaded: epmMetric(rolled, 1.8), ...extra });
const epmPayload = { ...payload, summary: { ...payload.summary, avgMs: null, p50Ms: null, p95Ms: null, mixedCohorts: true },
    filters: { ...payload.filters, surfaces: ['epm', 'eng_sprint'], scopeTypes: ['active', 'backlog'], projects: [
        { id: 'synthetic-a', name: 'Synthetic Alpha' }, { id: 'synthetic-b', name: 'Synthetic Beta With A Rather Long Display Name' }] },
    epmWeekly: { weeks: [epmWeek('2026-10-05', 700, 2600), epmWeek('2026-10-12', 900, 4100), epmWeek('2026-10-19', 800, 3300, { partial: true })] },
    epmProjects: [{ projectId: 'synthetic-b', name: 'Synthetic Beta With A Rather Long Display Name', loads: 9, avgMs: 4400, medianMs: 3900, p95Ms: 7200 },
        { projectId: 'synthetic-a', name: 'Synthetic Alpha', loads: 9, avgMs: 900, medianMs: 800, p95Ms: 1400 }] };

test('EPM weekly view charts both measurements, filters by project and stays inside its chart at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openPanel(page, epmPayload);
    await page.getByLabel('Performance surface', { exact: true }).selectOption('epm');
    await expect(page.getByLabel('Performance group', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Projects listed, by week' })).toBeVisible();
    for (const chart of ['projectsListed', 'rollupLoaded']) {
        const svg = page.locator(`.performance-week-svg[data-chart="${chart}"]`);
        await expect(svg).toBeVisible();
        await expect(svg.locator('.performance-line-path')).toHaveCount(3);
        await expect(svg.locator('.performance-line-point')).toHaveCount(9);
        const clipped = await svg.evaluate(node => {
            const box = node.getBoundingClientRect();
            return [...node.querySelectorAll('text')].filter(text => {
                const rect = text.getBoundingClientRect();
                return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
            }).map(text => text.textContent);
        });
        expect(clipped, `${chart} text outside its chart`).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole('heading', { name: 'Recent load evidence' })).toHaveCount(0);
    const projectRows = page.locator('details:has(summary:text("Rollup time by project")) tbody tr');
    await expect(projectRows).toHaveCount(2);
    expect(await projectRows.nth(0).locator('th').textContent()).toContain('Synthetic Beta');
    expect((await projectRows.nth(1).locator('td').allTextContents())).toEqual(['9', '0.90s', '0.80s', '1.40s']);

    const filtered = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api/admin/performance' && url.searchParams.get('projectId') === 'synthetic-a';
    });
    await page.getByLabel('Performance project', { exact: true }).selectOption('synthetic-a');
    expect(new URL((await filtered).url()).searchParams.get('surface')).toBe('epm');
    await page.getByLabel('Performance surface', { exact: true }).selectOption('eng_sprint');
    await expect(page.getByLabel('Performance group', { exact: true })).toBeVisible();
    const cleared = page.waitForRequest(request => request.url().includes('/api/admin/performance') && !request.url().includes('projectId'));
    await page.getByLabel('Performance surface', { exact: true }).selectOption('');
    await cleared;
});
