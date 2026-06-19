// Visual proof for the Ad Hoc capacity epic feature (plan Task 8.3).
//
// Captures the data-bearing Ad Hoc surfaces that the existing specs do not
// already populate with configured Ad Hoc epics:
//   1. Planning project split  -> Ad Hoc "product-adhoc" subsegment + "Incl. Ad Hoc" tooltip.
//   2. Stats effort split       -> non-zero "Ad Hoc" bucket plus "Ad Hoc Share" / "Product total" cards.
//   3. Stats Mono vs Cross      -> Ad Hoc stories stay inside Total SP / Cross Share.
//
// The Settings selector surface is already captured by
// tests/ui/shared_department_groups.spec.js (ad-hoc-epic-added.png), so it is
// not re-captured here.
//
// Reuses the established dashboard-shell + `**/api/**` route-mocking pattern.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = '/tmp/adhoc-visual-proof';
const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
// Planning auto-selection (Select All default) only applies to a future sprint,
// so the Planning split bar uses this future sprint to populate selected stories.
const futureSprintId = 40021;
const futureSprintName = '2026Q3 Sprint 1';
const groupTeamIds = ['team-alpha', 'team-beta'];
// PROD-ADHOC is configured as an Ad Hoc capacity epic; its stories must count as
// included Product capacity and be reported as Ad Hoc.
const adHocCapacityEpics = ['PROD-ADHOC'];
let dashboardJs;

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

function requestBody(request) {
    const postData = request.postData();
    if (!postData) return null;
    try {
        return JSON.parse(postData);
    } catch (err) {
        return postData;
    }
}

function json(route, body) {
    return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function makeStory({ key, epicKey, projectKey, teamId, teamName, points }) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic planning story`,
            status: { name: 'To Do' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: `${teamName} Owner` },
            customfield_10004: points,
            epicKey,
            parentSummary: `${epicKey} epic`,
            projectKey,
            teamId,
            teamName,
            sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
        },
    };
}

function makeEpic({ key, summary, teamId, teamName, label }) {
    return {
        key,
        summary,
        status: { name: 'In Progress' },
        assignee: { displayName: `${teamName} Lead` },
        teamId,
        teamName,
        labels: [label],
        sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
    };
}

// Three Product epics: one ordinary Product, one Tech, one configured Ad Hoc.
const productEpic = makeEpic({ key: 'PROD-EPIC', summary: 'Product delivery epic', teamId: 'team-alpha', teamName: 'Alpha Team', label: 'alpha_label' });
const techEpic = makeEpic({ key: 'TECH-EPIC', summary: 'Tech delivery epic', teamId: 'team-beta', teamName: 'Beta Team', label: 'beta_label' });
const adHocEpic = makeEpic({ key: 'PROD-ADHOC', summary: 'Business-as-usual / Ad Hoc epic', teamId: 'team-alpha', teamName: 'Alpha Team', label: 'alpha_label' });

const productStories = [
    makeStory({ key: 'PROD-1', epicKey: 'PROD-EPIC', projectKey: 'PROD', teamId: 'team-alpha', teamName: 'Alpha Team', points: 5 }),
    makeStory({ key: 'PROD-2', epicKey: 'PROD-EPIC', projectKey: 'PROD', teamId: 'team-beta', teamName: 'Beta Team', points: 3 }),
    makeStory({ key: 'ADHOC-1', epicKey: 'PROD-ADHOC', projectKey: 'PROD', teamId: 'team-alpha', teamName: 'Alpha Team', points: 4 }),
    makeStory({ key: 'ADHOC-2', epicKey: 'PROD-ADHOC', projectKey: 'PROD', teamId: 'team-beta', teamName: 'Beta Team', points: 2 }),
];
const techStories = [
    makeStory({ key: 'TECH-1', epicKey: 'TECH-EPIC', projectKey: 'TECH', teamId: 'team-beta', teamName: 'Beta Team', points: 3 }),
    makeStory({ key: 'TECH-2', epicKey: 'TECH-EPIC', projectKey: 'TECH', teamId: 'team-alpha', teamName: 'Alpha Team', points: 1 }),
];

// Excluded-capacity source issues for the Stats effort split / Mono vs Cross
// views. Each carries its parent epic in `epicKey` so the client can classify
// Ad Hoc vs Product vs Tech locally.
function makeSourceIssue({ key, epicKey, epicSummary, projectKey, teamId, teamName, points }) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} source story`,
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

const sourceIssues = [
    makeSourceIssue({ key: 'BAU-1', epicKey: 'BAU-EPIC', epicSummary: 'Excluded intake', projectKey: 'PROD', teamId: 'team-alpha', teamName: 'Alpha Team', points: 2 }),
    makeSourceIssue({ key: 'PROD-S1', epicKey: 'PROD-EPIC', epicSummary: 'Product delivery epic', projectKey: 'PROD', teamId: 'team-alpha', teamName: 'Alpha Team', points: 5 }),
    makeSourceIssue({ key: 'ADHOC-S1', epicKey: 'PROD-ADHOC', epicSummary: 'Business-as-usual / Ad Hoc epic', projectKey: 'PROD', teamId: 'team-alpha', teamName: 'Alpha Team', points: 4 }),
    makeSourceIssue({ key: 'TECH-S1', epicKey: 'TECH-EPIC', epicSummary: 'Tech delivery epic', projectKey: 'TECH', teamId: 'team-beta', teamName: 'Beta Team', points: 3 }),
    makeSourceIssue({ key: 'ADHOC-S2', epicKey: 'PROD-ADHOC', epicSummary: 'Business-as-usual / Ad Hoc epic', projectKey: 'PROD', teamId: 'team-beta', teamName: 'Beta Team', points: 2 }),
    makeSourceIssue({ key: 'PROD-S2', epicKey: 'PROD-EPIC', epicSummary: 'Product delivery epic', projectKey: 'PROD', teamId: 'team-beta', teamName: 'Beta Team', points: 4 }),
];

async function installApiMocks(page, calls) {
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    const unexpectedCalls = [];
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({ method: request.method(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()), body: requestBody(request) });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/me/connections/home-token') {
            return json(route, { connected: false, provider: 'atlassian_user_api_token', status: 'missing', needsReconnect: false });
        }
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                authMode: 'basic',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json(route, {
                version: 1,
                groups: [{
                    id: 'grp-default',
                    name: 'Default',
                    teamIds: groupTeamIds,
                    teamLabels: { 'team-alpha': 'alpha_label', 'team-beta': 'beta_label' },
                    excludedCapacityEpics: ['BAU-EPIC'],
                    adHocCapacityEpics,
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '5494', boardName: 'Synthetic Board', source: 'test' });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/capacity/config') return json(route, { project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json(route, { fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json(route, { issueTypes: ['Epic', 'Story'] });
        if (url.pathname === '/api/issue-types') return json(route, { issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') {
            return json(route, { sprints: [
                { id: selectedSprintId, name: selectedSprintName, state: 'active', startDate: '2026-05-01' },
                { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
            ] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const isTech = project === 'tech';
            const stories = purpose === 'ready-to-close' ? [] : (isTech ? techStories : productStories);
            const epicsInScope = isTech ? [techEpic] : [productEpic, adHocEpic];
            const epics = {};
            epicsInScope.forEach((epic) => { epics[epic.key] = epic; });
            return json(route, { issues: stories, epics, epicsInScope, names: {} });
        }
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/capacity') return json(route, { enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/stats/excluded-capacity-source') {
            return json(route, {
                data: {
                    issues: sourceIssues,
                    meta: { warnings: [], queryPages: 1, loadedSprintCount: 1, totalSprintCount: 1 },
                },
            });
        }
        unexpectedCalls.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected ${request.method()} ${url.pathname}` }) });
    });
    return { unexpectedCalls };
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

function setPrefs(page, prefs) {
    return page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value));
    }, prefs);
}

test('Planning project split renders the Ad Hoc Product subsegment for configured Ad Hoc epics', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls);
    await page.setViewportSize({ width: 1280, height: 900 });
    await setPrefs(page, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showPlanning: false,
        showScenario: false,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    // Mirror the proven planning entry flow: select the future sprint, then open
    // Planning so the default Select-All selection populates all stories.
    const sprintToggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await expect(sprintToggle).toHaveAttribute('aria-disabled', 'false');
    await sprintToggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.getByText('Selected SP by Project:')).toBeVisible();
    await expect(page.locator('.task-list .epic-block', { hasText: 'PROD-ADHOC' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select All' })).toHaveClass(/active/);

    const adHocSubsegment = page.locator('.project-bar-fill.product-adhoc');
    await expect(adHocSubsegment).toBeVisible();
    const tooltip = await adHocSubsegment.getAttribute('data-tooltip');
    expect(tooltip).toContain('Ad Hoc (included Product)');
    const productTooltip = await page.locator('.project-bar-fill.product').first().getAttribute('data-tooltip');
    expect(productTooltip).toContain('Incl. Ad Hoc');

    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/planning-project-split-adhoc.png`, fullPage: false });
    await page.locator('.planning-panel.open').screenshot({ path: `${screenshotDir}/planning-project-split-adhoc-panel.png` });
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Stats effort split shows a non-zero Ad Hoc bucket and Ad Hoc Share / Product total cards', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setPrefs(page, {
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
    await expect.poll(() => calls.filter(c => c.pathname === '/api/stats/excluded-capacity-source').length).toBeGreaterThanOrEqual(1);

    const summary = page.locator('.stats-view.open .excluded-capacity-summary');
    await expect(summary).toBeVisible();
    const adHocShare = summary.locator('.stats-card', { hasText: 'Ad Hoc Share' });
    await expect(adHocShare).toBeVisible();
    // Ad Hoc must be a non-zero share (6 of 20 source SP -> 30.00%).
    await expect(adHocShare).toContainText('30.00%');
    await expect(summary.locator('.stats-card', { hasText: 'Product total' })).toBeVisible();

    const chart = page.locator('.stats-view.open .effort-type-split-chart');
    await expect(chart).toBeVisible();
    await expect(chart.locator('.effort-type-split-legend-item.adHoc')).toBeVisible();
    await expect(chart.locator('.effort-type-split-segment.adHoc').first()).toBeVisible();

    await waitForVisualSettled(page);
    await page.locator('.stats-view.open').screenshot({ path: `${screenshotDir}/stats-effort-split-adhoc.png` });
    expect(apiMocks.unexpectedCalls).toEqual([]);
});

test('Stats Mono vs Cross keeps Ad Hoc stories inside Total SP and Cross Share', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setPrefs(page, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showStats: true,
        statsView: 'monoCrossShare',
        excludedCapacityStartSprintId: String(selectedSprintId),
        excludedCapacityEndSprintId: String(selectedSprintId),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect.poll(() => calls.filter(c => c.pathname === '/api/stats/excluded-capacity-source').length).toBeGreaterThanOrEqual(1);

    const view = page.locator('.stats-view.open');
    await expect(view).toContainText('Total SP');
    await expect(view).toContainText('Team Cross Share');
    await expect(view.locator('.excluded-capacity-line-chart')).toBeVisible();

    await waitForVisualSettled(page);
    await view.screenshot({ path: `${screenshotDir}/stats-mono-vs-cross-adhoc.png` });
    expect(apiMocks.unexpectedCalls).toEqual([]);
});
