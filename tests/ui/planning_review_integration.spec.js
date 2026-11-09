const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');
const { hoverEvidence } = require('./design_system_hover_helpers');
const { createPlanningReviewMock } = require('./planning_review_mock');
const sharedReviewMocks = new WeakMap();

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const secondFutureSprintId = 5003;
const secondFutureSprintName = '2026Q3 Sprint 2';
const completedSprintId = 2001;
const completedSprintName = '2026Q1 Sprint 9';
const groupTeamIds = ['team-alpha'];
let dashboardJs, dashboardCss;

test.beforeAll(() => {
    fs.mkdirSync(path.join(repoRoot, 'tmp', '217-ui'), { recursive: true });
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    dashboardJs = result.outputFiles[0].text;
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true, write: false,
    }).outputFiles[0].text;
});

function json(route, body, status = 200) {
    const planning = sharedReviewMocks.get(route.request().frame().page());
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(planning ? planning.response(route.request(), body, status) : body),
    });
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

// Show/Hide capacity details is a direct overview button (2026-11-06).
async function clickPlanningOption(page, name) {
    await page.locator('.planning-panel').getByRole('button', { name, exact: true }).click();
}

// The Department group a review request is scoped to: the GET query, or the values-read/PATCH body.
function reviewGroupOf(request) {
    if (request.method() === 'GET') return new URL(request.url()).searchParams.get('groupId');
    return requestBody(request)?.groupId ?? null;
}

function makeStory(key, status, sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        id: String(8000 + Number(key.split('-').pop())),
        key,
        fields: {
            summary: `${key} synthetic future planning story`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            customfield_10004: 1,
            epicKey,
            parentSummary: 'Future planning epic',
            projectKey: 'PLAN',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
        },
    };
}

function makeEpic(sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        id: '7001',
        key: epicKey,
        summary: 'Future planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
    };
}

const futureStories = [
    makeStory('PLAN-1', 'To Do'),
    makeStory('PLAN-2', 'Pending'),
    makeStory('PLAN-3', 'Accepted'),
];
const secondFutureStories = [
    makeStory('PLAN-4', 'To Do', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
    makeStory('PLAN-5', 'Accepted', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
];
const completedStories = [
    makeStory('PLAN-1', 'Done', completedSprintId, completedSprintName),
    makeStory('PLAN-2', 'Done', completedSprintId, completedSprintName),
];

async function installPlanningFixture(page, {
    taskFailureMode = '',
    delayConfig = false,
    shellAuthDependency = '',
    onboardingRequired = false,
    authMode = 'atlassian_oauth',
    summary = '',
    scopeTeamIds = groupTeamIds,
    capacityProject = '',
    planningLayout = 'table',
    longTable = false,
    groups = 1,
    selectedTeams = null,
    initialPlans = {},
} = {}) {
    const calls = [];
    let futureProductTaskAttempts = 0;
    let releaseConfig;
    const configRelease = delayConfig
        ? new Promise(resolve => { releaseConfig = resolve; })
        : Promise.resolve();
    let releaseShellAuth;
    const shellAuthRelease = shellAuthDependency
        ? new Promise(resolve => { releaseShellAuth = resolve; })
        : Promise.resolve();
    let groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{
            id: 'group-alpha',
            name: 'Alpha Department',
            teamIds: scopeTeamIds,
            labels: ['alpha_label'],
            excludedCapacityEpics: []
        }, ...(groups === 2 ? [{
            // `groups: 2` adds a second configured group so the header group control is usable; nothing is scoped to it.
            id: 'group-beta',
            name: 'Beta Department',
            teamIds: ['team-beta-only'],
            labels: ['beta_label'],
            excludedCapacityEpics: []
        }] : [])],
        preferences: {
            onboardingRequired,
            onboardingDone: !onboardingRequired,
            completedOnboardingModules: onboardingRequired
                ? []
                : ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            customized: false,
            visibleGroupIds: [],
            effectiveVisibleGroupIds: groups === 2 ? ['group-alpha', 'group-beta'] : ['group-alpha'],
            activeGroupId: 'group-alpha',
        },
    };

    await installDashboardShell(page);
    sharedReviewMocks.set(page, createPlanningReviewMock({ initialPlans }));
    // `planningLayout: null` seeds no preferences; 'list' seeds a stale List preference (Planning is the Table only, #323).
    if (planningLayout) await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), {...(planningLayout === 'list' ? { planningLayout } : {}), ...(selectedTeams ? {selectedTeams, activeGroupId: 'group-alpha'} : {})});
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200, contentType: 'text/css', body: dashboardCss,
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const body = request.method() === 'POST' ? requestBody(request) : null;
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
            headers: request.headers(),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/epm/access') {
            // The shell waits for this read when EPM is enabled: a late 401 lands after the groups loaded.
            if (shellAuthDependency === 'epm-access') {
                await shellAuthRelease;
                return json(route, {
                    error: 'auth_required',
                    loginUrl: '/login?reason=session_expired',
                }, 401);
            }
            return json(route, { state: 'disabled', epmHomeReadAvailable: false });
        }
        if (url.pathname === '/api/config') {
            await configRelease;
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject,
                authMode,
                epmViewEnabled: shellAuthDependency === 'epm-access',
                epmHomeReadAvailable: shellAuthDependency === 'epm-access',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
                viewConfig: {
                    workspaceId: 'workspace-test',
                    viewConfigId: 'view-test',
                    version: 1,
                    view: {
                        selectedView: 'eng',
                        selectedSprint: activeSprintId,
                        sprintName: activeSprintName,
                        activeGroupId: 'group-alpha',
                        showPlanning: false,
                        showScenario: false,
                    },
                },
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') {
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            const payload = requestBody(request);
            if (payload.baseRevision !== groupsConfigPayload.configRevision) {
                return json(route, { error: 'group_config_conflict', current: groupsConfigPayload }, 409);
            }
            groupsConfigPayload = {
                version: payload.version || 1,
                source: 'workspace_db',
                configRevision: groupsConfigPayload.configRevision + 1,
                defaultGroupId: payload.defaultGroupId || '',
                groups: payload.groups || [],
                preferences: groupsConfigPayload.preferences,
            };
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '1', boardName: 'Synthetic board', configRevision: 1 });
        if (url.pathname === '/api/capacity/config') return json(route, { project: capacityProject, fieldId: capacityProject ? 'customfield_capacity' : '', fieldName: capacityProject ? 'Capacity' : '', mutationEnabled: Boolean(capacityProject), configRevision: 1 });
        if (/^\/api\/(sprint-field|parent-name-field|story-points-field|team-field|delivery-owner-field)\/config$/.test(url.pathname)) return json(route, { fieldId: '', fieldName: '', configRevision: 1 });
        if (url.pathname === '/api/issue-types/config') return json(route, { issueTypes: ['Story'], configRevision: 1 });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [
                    { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                    { id: completedSprintId, name: completedSprintName, state: 'closed', startDate: '2026-03-01' },
                    { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                    { id: secondFutureSprintId, name: secondFutureSprintName, state: 'future', startDate: '2026-07-15' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const sprint = url.searchParams.get('sprint');
            if (project === 'product' && !purpose && String(sprint) === String(futureSprintId)) {
                futureProductTaskAttempts += 1;
                if (taskFailureMode === 'non-auth-once' && futureProductTaskAttempts === 1) {
                    return json(route, { error: 'synthetic_task_failure' }, 500);
                }
                if (taskFailureMode === 'auth-required') {
                    return json(route, {
                        error: 'auth_required',
                        loginUrl: '/login?reason=session_expired',
                    }, 401);
                }
            }
            const issues = project === 'product' && !purpose
                ? (String(sprint) === String(secondFutureSprintId)
                    ? secondFutureStories
                    : String(sprint) === String(completedSprintId) ? completedStories : longTable ? Array.from({length:60},(_,i)=>makeStory(`PLAN-${i+1}`,'To Do')) : futureStories)
                : [];
            const epic = String(sprint) === String(secondFutureSprintId)
                ? makeEpic(secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2')
                : String(sprint) === String(completedSprintId)
                    ? makeEpic(completedSprintId, completedSprintName)
                    : makeEpic();
            if (summary) epic.summary=summary;
            return json(route, {
                issues: summary ? issues.map(issue=>({...issue,fields:{...issue.fields,summary}})) : issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/eng/story-readiness') return json(route, { schemaVersion: 1, complete: true,
            scope: { groupId: url.searchParams.get('groupId'), sprintId: url.searchParams.get('sprint'),
                sprintName: url.searchParams.get('sprintName'), sprintState: url.searchParams.get('sprintState') }, epics: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        // The Assignee Capacity strip (#323) reads only after it is expanded; an unconfigured store answers empty rather than 404.
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity$/.test(url.pathname)) return json(route, { teamId: url.searchParams.get('teamId'), sprintId: url.pathname.split('/')[4], revision: 0, rows: [], inherited: null, capabilities: { canRead: true, canSave: true } });
        if (/^\/api\/eng\/sprints\/[^/]+\/review(?:\/values\/read|\/operations\/[^/]+)?$/.test(url.pathname)) return json(route, {});
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return {
        calls,
        getGroupsConfig: () => groupsConfigPayload,
        getFutureProductTaskAttempts: () => futureProductTaskAttempts,
        releaseConfig: () => releaseConfig?.(),
        releaseShellAuth: () => releaseShellAuth?.(),
    };
}


async function openPlanning(page, { expectStories = true } = {}) {
    await page.goto(appBaseUrl);
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await expect(toggle).toHaveAttribute('aria-disabled', 'false');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    if (expectStories) await expect(page.locator('.planning-review-table tbody tr').first()).toBeVisible();
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}
async function bounds(page) {
    return page.evaluate(() => Object.fromEntries(['.header', '.planning-panel', '.filters-strip'].map(selector => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return [selector, r ? { x:r.x, width:r.width, y:r.y, height:r.height } : null];
    })));
}

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`shared Planning controls retain stable labels, full-match actions and focus help at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const fixture = await installPlanningFixture(page, { longTable: true });
    await openPlanning(page, { expectStories: false });
    await page.getByRole('radio', { name: 'Stories', exact: true }).check();
    const panel = page.locator('.planning-panel');
    const select = panel.getByRole('button', { name: 'Select All', exact: true });
    const clear = panel.getByRole('button', { name: 'Clear Selection', exact: true });
    const undo = panel.getByRole('button', { name: 'Undo', exact: true });
    const checkboxes = page.locator('.planning-review-table tbody input[type=checkbox]');
    const scopeHelp = 'Applies to all stories matching the current Team and filters, including rows below.';
    await expect(select).toBeEnabled();
    await expect(clear).toBeDisabled();
    await expect(undo).toBeDisabled();
    await expect(checkboxes).toHaveCount(60);
    await expect(panel).toContainText('No saved plan yet. Include stories to preview capacity, then save your plan.');
    await expect(panel.locator('.planning-actions > .planning-stats')).toHaveText('Cap unavailable');
    await clear.evaluate(node => node.click());
    await expect(undo).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await expect(page.getByRole('tooltip').filter({ hasText: scopeHelp })).toBeVisible();
    expect(await select.evaluate(node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent)).toBe(scopeHelp);
    const originalHeight = await page.locator('.planning-review-table tbody tr').first().evaluate(node => node.getBoundingClientRect().height);
    await select.click();
    await expect(page.locator('.planning-review-table tbody input[type=checkbox]:checked')).toHaveCount(60);
    await expect(select).toBeDisabled();
    await select.evaluate(node => node.click());
    await expect(clear).toBeEnabled();
    await expect(undo).toBeEnabled();
    await expect(panel.locator('.planning-actions > .planning-stats')).toContainText('60 stories');
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await clear.focus();
    await expect(page.getByRole('tooltip').filter({ hasText: scopeHelp })).toHaveCount(1);
    await expect(page.getByRole('tooltip').filter({ hasText: scopeHelp })).toBeVisible();
    expect(await clear.evaluate(node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent)).toBe(scopeHelp);
    await undo.click();
    await expect(page.locator('.planning-review-table tbody input[type=checkbox]:checked')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Include by status', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Include by status', exact: true });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
    expect(await menu.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && node.contains(document.elementFromPoint(r.left + 12, r.top + 12)); })).toBe(true);
    await menu.getByRole('button', { name: 'Include all To Do / Pending, 0/60 included', exact: true }).click();
    await expect(page.locator('.planning-review-table tbody input[type=checkbox]:checked')).toHaveCount(60);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(panel).toContainText('Plan saved');
    expect(fixture.calls.filter(call => call.method === 'PATCH' && /\/review$/.test(call.pathname))).toHaveLength(1);
    await clickPlanningOption(page, 'Show capacity details');
    await expect(select).toBeVisible(); await expect(clear).toBeVisible(); await expect(undo).toBeVisible();
    await clickPlanningOption(page, 'Hide capacity details');
    await expect(select).toBeVisible(); await expect(clear).toBeVisible(); await expect(undo).toBeVisible();
    expect(await page.locator('.planning-review-table tbody tr').first().evaluate(node => node.getBoundingClientRect().height)).toBe(originalHeight);
    expect(originalHeight).toBeGreaterThanOrEqual(32);
    expect(originalHeight).toBeLessThan(33);
    await page.screenshot({ path: `tmp/217-ui/shared-planning-controls-${width}x${height}.png`, fullPage: false });
});

// Operator-approved overview row (2026-11-06, one row; short labels 2026-11-09): Select All, Clear Selection, Undo,
// "Status ▾", an icon-only Open in Jira, the short summary in the flexible gap and a right-aligned "Details"; accessible
// names keep the full meaning. No Planning options menu, no List toggle, no summary readout.
const overviewRowNames = ['Select All', 'Clear Selection', 'Undo', 'Include by status', 'Open planned stories in Jira', 'Show capacity details'];
// The summary slot: between the Jira button and the details button, on the row, every part shown whole (no ellipsis).
async function overviewSummaryGeometry(panel) {
    return panel.locator('.planning-actions > .planning-stats').evaluate(summary => {
        const r = summary.getBoundingClientRect(), row = summary.parentElement.getBoundingClientRect();
        const jira = summary.parentElement.querySelector('.planning-icon-button').getBoundingClientRect();
        const details = summary.parentElement.querySelector('.planning-panel-collapse')?.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, rowTop: row.top, rowBottom: row.bottom, jiraRight: jira.right, detailsLeft: details?.left ?? null,
            scrollWidth: summary.scrollWidth, clientWidth: summary.clientWidth, text: summary.textContent,
            parts: [...summary.children].map(span => { const b = span.getBoundingClientRect(); return { text: span.textContent, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }) };
    });
}
function expectSummaryInSlot(geometry, label) {
    expect(geometry.left, `${label}: after the Jira button`).toBeGreaterThanOrEqual(geometry.jiraRight);
    if (geometry.detailsLeft !== null) expect(geometry.right, `${label}: clear of the details button`).toBeLessThanOrEqual(geometry.detailsLeft);
    expect(geometry.top, `${label}: on the row`).toBeGreaterThanOrEqual(geometry.rowTop - 0.5);
    expect(geometry.bottom, `${label}: on the row`).toBeLessThanOrEqual(geometry.rowBottom + 0.5);
    expect(geometry.scrollWidth, `${label}: the summary is unclipped (${geometry.text})`).toBeLessThanOrEqual(geometry.clientWidth);
    for (const part of geometry.parts) {
        expect(part.left, `${label}: ${part.text} inside the slot`).toBeGreaterThanOrEqual(geometry.left - 0.5);
        expect(part.right, `${label}: ${part.text} inside the slot`).toBeLessThanOrEqual(geometry.right + 0.5);
    }
}
// Compact panel with a capacity error line under the row, measured 2026-11-09 at 1280x720.
const COMPACT_ERROR_HEIGHT = 72.8;
// Worst case (operator, 2026-11-09): the real summary element carries the longest copy; it must still fit unclipped.
const worstCaseSummary = ['209 stories', '220.0 SP', 'Cap 183.4 SP', '32 unestimated', '12 hidden'];
async function fillWorstCaseSummary(panel) {
    await panel.locator('.planning-actions > .planning-stats').evaluate((node, parts) => {
        node.replaceChildren(...parts.flatMap((part, index) => { const span = document.createElement('span'); span.textContent = part; return index ? [document.createTextNode(' · '), span] : [span]; }));
    }, worstCaseSummary);
}
async function overviewRowGeometry(panel) {
    return panel.locator('.planning-actions').first().evaluate(row => {
        const box = row.getBoundingClientRect();
        return [...row.querySelectorAll(':scope > button, :scope > .planning-review-popover-anchor > button')].map(button => {
            const r = button.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(button);
            const text = range.getBoundingClientRect();
            return { name: button.getAttribute('aria-label') || button.textContent.replace('▾', '').trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                rowLeft: box.left, rowRight: box.right, clipped: button.scrollWidth > button.clientWidth + 1,
                textInside: text.left >= r.left - 0.5 && text.right <= r.right + 0.5 && text.top >= r.top - 0.5 && text.bottom <= r.bottom + 0.5 };
        });
    });
}

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`Planning overview row: direct controls in order, right-aligned details, no options menu, List toggle or summary readout at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await installPlanningFixture(page, { initialPlans: { [futureSprintId]: { includedIssueIds: futureStories.map(story => story.id) } } });
    await openPlanning(page, { expectStories: false });
    const panel = page.locator('.planning-panel');
    await expect(panel).toHaveClass(/planning-panel-compact/);
    await expect(panel.locator('.planning-actions > .planning-stats')).toHaveText(/^3 stories · \d+\.\d SP · Cap (unavailable|\d+\.\d SP)$/);
    await page.mouse.move(5, height - 5);
    const rest = await overviewRowGeometry(panel);
    expect(rest.map(entry => entry.name)).toEqual(overviewRowNames);
    await expect(page.getByRole('button', { name: 'Planning options' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Show Planning (list|table)/ })).toHaveCount(0);
    await expect(page.locator('.planning-layout-toggle')).toHaveCount(0);
    const jira = panel.getByRole('button', { name: 'Open planned stories in Jira', exact: true });
    await expect(jira).toHaveClass(/planning-icon-button/);
    await expect(jira.locator('svg.jira-export-icon')).toHaveCount(1);
    await expect(jira).toBeEnabled();
    // Review I3: settled hover of the enabled framed icon button.
    await hoverEvidence(page, jira, testInfo, `open-in-jira-icon-${width}`, { foundation: true });
    await page.mouse.move(5, height - 5);
    const details = panel.getByRole('button', { name: 'Show capacity details', exact: true });
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toHaveAttribute('aria-controls', 'planning-panel-details');
    // One row: every control is centred on the same line (the icon button is shorter), nothing clips its label, and the
    // details button ends at the row's right edge.
    const centres = rest.map(entry => (entry.top + entry.bottom) / 2);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(1);
    expect(Math.min(...rest.map(entry => entry.bottom)) - Math.max(...rest.map(entry => entry.top)), 'every control overlaps one band').toBeGreaterThan(20);
    for (const entry of rest) { expect(entry.clipped, entry.name).toBe(false); expect(entry.textInside, entry.name).toBe(true); }
    expect(rest.at(-1).rowRight - rest.at(-1).right).toBeLessThan(1);
    // The plain summary fills the flexible gap on the same row, with no readout on hover or focus.
    const summary = panel.locator('.planning-actions > .planning-stats');
    expectSummaryInSlot(await overviewSummaryGeometry(panel), 'compact');
    expect(await summary.getAttribute('tabindex')).toBeNull();
    expect(await summary.getAttribute('aria-label')).toBeNull();
    await summary.hover(); await page.waitForTimeout(300);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.locator('.epic-full-value-readout')).toHaveCount(0);
    // The compact panel keeps its pre-change height (46.875px, measured at 9763c93a at both viewports).
    const compactHeight = (await panel.boundingBox()).height;
    expect(compactHeight).toBeLessThanOrEqual(46.9);
    // Settled hover and focus leave every row control's geometry unchanged.
    for (const name of overviewRowNames) {
        const control = panel.getByRole('button', { name, exact: true });
        const before = await control.boundingBox();
        await control.hover(); await page.waitForTimeout(150);
        expect(await control.boundingBox(), `${name} hover`).toEqual(before);
        await control.focus();
        expect(await control.boundingBox(), `${name} focus`).toEqual(before);
    }
    await page.mouse.move(5, height - 5);
    await details.click();
    await expect(panel.getByRole('button', { name: 'Hide capacity details', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('button', { name: 'Hide capacity details', exact: true })).toHaveText('Hide details');
    await expect(panel.locator('#planning-panel-details')).toBeVisible();
    const expanded = await overviewRowGeometry(panel);
    expect(expanded.map(entry => entry.name)).toEqual([...overviewRowNames.slice(0, -1), 'Hide capacity details']);
    expect(expanded.at(-1).rowRight - expanded.at(-1).right).toBeLessThan(1);
    for (const entry of expanded) expect(entry.clipped, entry.name).toBe(false);
    expectSummaryInSlot(await overviewSummaryGeometry(panel), 'expanded');
    await panel.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
    await expect(panel.locator('#planning-panel-details')).toBeHidden();
    expect((await panel.boundingBox()).height).toBe(compactHeight);
    // Open in Jira keeps its disabled rule: nothing planned matches the current filters.
    await page.locator('.search-input:visible').fill('no-matching-story');
    await expect(jira).toBeDisabled();
    // Short visible labels; the worst-case summary fits whole in the compact row at this viewport.
    await page.locator('.search-input:visible').fill('');
    await expect(panel.getByRole('button', { name: 'Include by status', exact: true })).toHaveText('Status ▾');
    await expect(details).toHaveText('Details');
    await fillWorstCaseSummary(panel);
    expectSummaryInSlot(await overviewSummaryGeometry(panel), 'worst case');
    for (const entry of await overviewRowGeometry(panel)) { expect(entry.clipped, entry.name).toBe(false); expect(entry.textInside, entry.name).toBe(true); }
    expect((await panel.boundingBox()).height).toBeLessThanOrEqual(46.9);
});

// Re-review (2026-11-09): the summary never shrinks beside a state note; the note is the only shrinkable item, one line,
// ellipsized as a last resort. Each realistic note keeps the single 46.875px row and stays clear of Details.
async function noteRowGeometry(panel) {
    return panel.locator('.planning-actions').first().evaluate(row => {
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const note = row.querySelector(':scope > .planning-review-state-note');
        return { row: rect(row), details: rect(row.querySelector('.planning-panel-collapse')), note: note && note.textContent ? rect(note) : null,
            noteText: note?.textContent || '', noteWhiteSpace: note ? getComputedStyle(note).whiteSpace : '',
            retry: note?.querySelector('button') ? { ...rect(note.querySelector('button')), clipped: note.querySelector('button').scrollWidth > note.querySelector('button').clientWidth } : null };
    });
}
async function expectNoteRow(panel, label, { height = 46.9, summary = true } = {}) {
    const geometry = await noteRowGeometry(panel);
    expect(geometry.note, `${label}: a note is shown`).not.toBeNull();
    expect(geometry.noteWhiteSpace, `${label}: the note is one line`).toBe('nowrap');
    expect(geometry.note.top, label).toBeGreaterThanOrEqual(geometry.row.top - 0.5); expect(geometry.note.bottom, label).toBeLessThanOrEqual(geometry.row.bottom + 0.5);
    expect(geometry.note.right, `${label}: the note stays clear of Details`).toBeLessThanOrEqual(geometry.details.left);
    expect(geometry.details.right, `${label}: Details stays right-aligned`).toBeCloseTo(geometry.row.right, 0);
    if (summary) expectSummaryInSlot(await overviewSummaryGeometry(panel), label);
    expect((await panel.boundingBox()).height, `${label}: one row`).toBeLessThanOrEqual(height);
    return geometry;
}

for (const [width, height] of [[1280, 720], [1440, 900]]) test(`state notes shrink beside the summary and never clip its values at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // 1. No saved plan: the long guidance note with its summary, then with the worst-case summary.
    await installPlanningFixture(page, {});
    await openPlanning(page, { expectStories: false });
    const panel = page.locator('.planning-panel');
    await expect(panel.locator('.planning-review-state-note')).toContainText('No saved plan yet.');
    await page.mouse.move(5, height - 5);
    await expectNoteRow(panel, 'no saved plan');
    await fillWorstCaseSummary(panel);
    await expectNoteRow(panel, 'no saved plan, worst-case summary');
    // 2. A saved plan: "Plan saved" with the worst-case summary.
    await page.reload(); await openPlanning(page, { expectStories: false });
    await panel.getByRole('button', { name: 'Select All', exact: true }).click();
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(panel.locator('.planning-review-state-note')).toHaveText('Plan saved');
    await fillWorstCaseSummary(panel);
    await page.mouse.move(5, height - 5);
    await expectNoteRow(panel, 'plan saved, worst-case summary');
    // 3. The plan cannot load: the error note with Retry (no summary while the plan is not ready).
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'review_unavailable' }) }));
    await page.reload(); await openPlanning(page, { expectStories: false });
    await expect(panel.locator('.planning-review-state-note')).toContainText('Plan could not be loaded.');
    await page.mouse.move(5, height - 5);
    const error = await expectNoteRow(panel, 'plan load error', { summary: false });
    expect(error.retry, 'Retry is shown').not.toBeNull();
    expect(error.retry.clipped).toBe(false);
    expect(error.retry.right, 'Retry is not cut off by the note').toBeLessThanOrEqual(error.note.right + 0.5);
    await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('Catch Up List keeps its own controls and stored choices and gains no Planning overview row', async ({ page }) => {
    // A stale saved List layout beside Catch Up's own stored Sort and Initiative choices: Catch Up List is unchanged (#323).
    await installPlanningFixture(page, { planningLayout: 'list' });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'), engEpicSort: 'status', groupByInitiativeChoice: false })));
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sort epics' })).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => { const prefs = JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'); return [prefs.engEpicSort, prefs.groupByInitiativeChoice]; })).toEqual(['status', false]);
    await expect(page.locator('.planning-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Include by status' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show capacity details' })).toHaveCount(0);
});

// Operator (2026-11-09): the popover may wrap whole toggles onto several lines, but each toggle is one line tall, never
// wraps, ellipsizes or overflows its label, sits inside the popover, and the popover sits inside the viewport.
for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]]) test(`Include by status toggles stay one line tall inside the popover and the viewport at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installPlanningFixture(page, { initialPlans: { [futureSprintId]: { includedIssueIds: [futureStories[0].id, futureStories[2].id] } } });
    await openPlanning(page, { expectStories: false });
    const panel = page.locator('.planning-panel');
    const lineHeight = (await panel.getByRole('button', { name: 'Undo', exact: true }).boundingBox()).height;
    await panel.getByRole('button', { name: 'Include by status', exact: true }).click();
    const popover = page.getByRole('dialog', { name: 'Include by status', exact: true });
    await expect(popover.locator('button.planning-action-button')).toHaveCount(4);
    const geometry = await popover.evaluate(node => {
        const p = node.getBoundingClientRect();
        return { popover: { left: p.left, right: p.right, top: p.top, bottom: p.bottom }, viewport: { width: innerWidth, height: innerHeight },
            toggles: [...node.querySelectorAll('button.planning-action-button')].map(button => { const r = button.getBoundingClientRect(), style = getComputedStyle(button);
                return { text: button.textContent, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace }; }) };
    });
    expect(geometry.popover.left).toBeGreaterThanOrEqual(0); expect(geometry.popover.top).toBeGreaterThanOrEqual(0);
    expect(geometry.popover.right).toBeLessThanOrEqual(geometry.viewport.width); expect(geometry.popover.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    for (const toggle of geometry.toggles) {
        expect(toggle.height, `${toggle.text} is one line tall`).toBeCloseTo(lineHeight, 0);
        expect(toggle.scrollWidth, `${toggle.text} label is not clipped`).toBeLessThanOrEqual(toggle.clientWidth);
        expect(toggle.textOverflow, toggle.text).not.toBe('ellipsis');
        expect(toggle.whiteSpace, toggle.text).toBe('nowrap');
        expect(toggle.left).toBeGreaterThanOrEqual(geometry.popover.left); expect(toggle.right).toBeLessThanOrEqual(geometry.popover.right);
        expect(toggle.top).toBeGreaterThanOrEqual(geometry.popover.top); expect(toggle.bottom).toBeLessThanOrEqual(geometry.popover.bottom);
    }
    await page.screenshot({ path: `tmp/217-ui/include-by-status-${width}x${height}.png`, fullPage: false });
});

test('Include by status: one line of status toggles with included/total counts that include the rest or remove all and stay open', async ({ page }, testInfo) => {
    const fixture = await installPlanningFixture(page, { initialPlans: { [futureSprintId]: { includedIssueIds: [futureStories[0].id, futureStories[2].id] } } });
    await openPlanning(page, { expectStories: false });
    await page.getByRole('radio', { name: 'Stories', exact: true }).check();
    const checked = page.locator('.planning-review-table tbody input[type=checkbox]:checked');
    await expect(checked).toHaveCount(2);
    const panel = page.locator('.planning-panel');
    await panel.getByRole('button', { name: 'Include by status', exact: true }).click();
    const popover = page.getByRole('dialog', { name: 'Include by status', exact: true });
    await expect(popover).toBeVisible();
    const toggles = popover.locator('button.planning-action-button');
    await expect(toggles).toHaveText(['Accepted + In Progress · 1/1', 'To Do / Pending · 1/2', 'Postponed · 0/0', 'Awaiting validation · 0/0']);
    const accepted = popover.getByRole('button', { name: 'Remove all Accepted + In Progress, 1/1 included', exact: true });
    const todo = popover.getByRole('button', { name: 'Include all To Do / Pending, 1/2 included', exact: true });
    await expect(accepted).toHaveAttribute('aria-pressed', 'true'); await expect(accepted).toHaveClass(/active/);
    await expect(todo).toHaveAttribute('aria-pressed', 'false'); await expect(todo).not.toHaveClass(/active/);
    await expect(popover.getByRole('button', { name: 'Include all Postponed, 0/0 included', exact: true })).toBeDisabled();
    await expect(popover.getByRole('button', { name: 'Include all Awaiting validation, 0/0 included', exact: true })).toBeDisabled();
    expect(await todo.evaluate(node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent))
        .toBe('Applies to all stories matching the current Team and filters, including rows below.');
    // One line inside the viewport; labels fit their buttons; settled hover and focus keep geometry.
    const geometry = await toggles.evaluateAll(buttons => buttons.map(button => {
        const r = button.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(button);
        const t = range.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, clipped: button.scrollWidth > button.clientWidth + 1, inside: t.left >= r.left - 0.5 && t.right <= r.right + 0.5 };
    }));
    expect(Math.max(...geometry.map(entry => entry.top)) - Math.min(...geometry.map(entry => entry.top))).toBeLessThan(1);
    for (const entry of geometry) { expect(entry.clipped).toBe(false); expect(entry.inside).toBe(true); }
    expect(await popover.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1; })).toBe(true);
    // Review I3: settled hover of the pressed and the unpressed toggle (the pressed one keeps its green fill and ink).
    await hoverEvidence(page, accepted, testInfo, 'include-by-status-pressed', { pill: true, selected: true, semanticHover: { color: 'rgb(56, 158, 13)', background: 'rgb(246, 255, 237)' } });
    await hoverEvidence(page, todo, testInfo, 'include-by-status-unpressed', { foundation: true });
    for (const control of [accepted, todo]) {
        const before = await control.boundingBox();
        await control.hover(); await page.waitForTimeout(150);
        expect(await control.boundingBox()).toEqual(before);
        await control.focus();
        expect(await control.boundingBox()).toEqual(before);
    }
    await page.screenshot({ path: 'tmp/217-ui/include-by-status-popover.png', fullPage: false });
    // Not fully included: the click includes the rest, and the popover stays open.
    await todo.click();
    await expect(checked).toHaveCount(3);
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Remove all To Do / Pending, 2/2 included', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Fully included: the click removes all of that group.
    await accepted.click();
    await expect(checked).toHaveCount(2);
    await expect(popover.getByRole('button', { name: 'Include all Accepted + In Progress, 0/1 included', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(panel).toContainText('Plan saved');
    expect(fixture.calls.filter(call => call.method === 'PATCH' && /\/review$/.test(call.pathname))).toHaveLength(1);
});

test('a capacity read error stays visible while the overview is compact', async ({ page }) => {
    await installPlanningFixture(page, { capacityProject: 'CAP' });
    await page.route('**/api/capacity?*', route => json(route, { error: 'capacity_unavailable' }, 500));
    await openPlanning(page, { expectStories: false });
    const panel = page.locator('.planning-panel');
    await expect(panel).toHaveClass(/planning-panel-compact/);
    const status = panel.locator('.planning-panel-capacity-status');
    await expect(status).toHaveText('Capacity unavailable — show capacity details to retry');
    await expect(status).toBeVisible();
    expect(await status.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    // The error adds one line under the row: the compact panel is pinned at that height, not the 46.9px row alone.
    expect((await panel.boundingBox()).height).toBeLessThanOrEqual(COMPACT_ERROR_HEIGHT);
    await panel.getByRole('button', { name: 'Show capacity details', exact: true }).click();
    await expect(status).toBeVisible();
});

test('the app-header Refresh also reloads the shared review', async ({ page }) => {
    await installPlanningFixture(page, {});
    let reads = 0;
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => { reads += 1; return json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }); });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => json(route, {cells:[],unavailableIssueIds:[]}));
    await openPlanning(page, { expectStories: false });
    await expect.poll(() => reads).toBeGreaterThan(0);
    // A review that is still loading is already current, so the header Refresh leaves it alone; wait for it to settle first.
    await expect(page.locator('.planning-review-state-note',{hasText:'Loading…'})).toHaveCount(0);
    const before = reads;
    await page.getByRole('button',{name:'Refresh tasks and sprints from Jira',exact:true}).click();
    await expect.poll(() => reads).toBeGreaterThan(before);
});

test('dirty noninitial Sprint review survives Jira catalog refresh and guards an explicit Sprint change', async ({ page }) => {
    await installPlanningFixture(page, {});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => json(route, {cells:[],unavailableIssueIds:[]}));
    await openPlanning(page, { expectStories: false });
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Synthetic review');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save plan',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Refresh tasks and sprints from Jira',exact:true}).click();
    await expect(page.locator('.sprint-dropdown').first()).toContainText('2026Q3');
    await expect(page.getByRole('textbox',{name:'Synthetic review for PLAN-EPIC',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save plan',exact:true})).toBeEnabled();
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await toggle.click();
    await page.locator('.sprint-dropdown-option',{hasText:secondFutureSprintName}).click();
    await expect(page.getByRole('dialog',{name:'Save this plan?'})).toBeVisible();
    await page.getByRole('button',{name:'Stay',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Synthetic review for PLAN-EPIC',exact:true})).toBeVisible();
});

test('catalog capability loss preserves drafts and recovery invalidates a queued scope clear', async ({ page }) => {
    await installPlanningFixture(page, {});
    let unavailable = false;
    await page.route('**/api/sprints*', route => unavailable
        ? json(route, {error:'sprint_board_required'}, 409)
        : json(route, {sprints:[{id:activeSprintId,name:activeSprintName,state:'active'},{id:futureSprintId,name:futureSprintName,state:'future'}],cache:{backend:'postgresql',identity:'sc1:synthetic-board',browserContextId:'bc1:synthetic-actor',catalogVersion:1,validatedAt:'2026-10-01T09:00:00Z'}}));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => json(route, {cells:[],unavailableIssueIds:[]}));
    await openPlanning(page, { expectStories: false });
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Preserved draft');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    unavailable = true;
    await page.getByRole('button',{name:'Refresh tasks and sprints from Jira',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Save this plan?'})).toBeVisible();
    unavailable = false;
    // Simulate a concurrent external catalog refresh finishing while the leave
    // decision remains pending, rather than interacting through the modal.
    await page.evaluate(() => document.querySelector('[aria-label="Refresh tasks and sprints from Jira"]').click());
    await expect(page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle')).toHaveAttribute('aria-disabled','false');
    await page.getByRole('dialog',{name:'Save this plan?'}).getByRole('button',{name:'Discard changes',exact:true}).click();
    await expect(page.locator('.sprint-dropdown').first()).toContainText('2026Q3');
    await expect(page.getByRole('region',{name:'Planning Sprint review'})).toBeVisible();
});

test('review 401 locks the mounted dashboard and never replays the failed read', async ({ page }) => {
    await installPlanningFixture(page, { initialPlans: { [futureSprintId]: { includedIssueIds: futureStories.map(story => story.id) } } });
    let reviewReads = 0, expired = false;
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => {
        reviewReads++;
        return expired ? json(route, {error:'auth_required',loginUrl:'https://unsafe.example/login'}, 401)
            : json(route, { schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: true } });
    });
    await openPlanning(page, { expectStories: false });
    await expect(page.locator('.planning-review-table tbody input[type=checkbox]:checked')).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    const before = reviewReads;
    expired = true;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
    await expect(page.getByRole('alertdialog').getByRole('link',{name:'Sign in again'})).toHaveAttribute('href','/login?reason=session_expired');
    await expect(page.getByRole('region',{name:'Planning Sprint review',includeHidden:true})).toHaveCount(1);
    expect(await page.locator('.planning-review-table tbody input[type=checkbox]:checked').count()).toBe(1);
    await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(reviewReads).toBe(before + 1);
});

for (const passive of [true, false]) test(`table status chips retain shared presentation with Settings ${passive ? 'open' : 'closed'}`, async ({ page }) => {
    await installPlanningFixture(page, {});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => json(route, {schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await openPlanning(page, { expectStories: false });
    if (passive) await page.getByRole('button', { name: /manage team groups/i }).click();
    const chip = page.locator('.planning-review-status .task-status').first();
    await expect(chip).toBeVisible();
    expect(await chip.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(30);
    await expect(chip).toHaveCSS('background-color','rgb(105, 192, 255)');
    if (!passive) {
        await page.locator('.planning-review-scroll').evaluate(node=>node.scrollIntoView({block:'center'}));
        await chip.hover();
        await expect(chip).toHaveCSS('background-color','rgb(105, 192, 255)');
        await expect(chip).toHaveCSS('transform','none');
    }
});

for (const width of [390, 1280]) test(`Story rows match compact Epic row height with the real Jira editor at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installPlanningFixture(page, { authMode: 'atlassian_oauth' });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => json(route, { schemaRevision: 0, columns: [], capabilities: { canRead: false, canSave: false } }));
    await page.route('**/api/issues/PLAN-1/editable-fields?*', route => json(route, { editable: true, currentValue: 1, mappingRevision: 'synthetic', baseUpdated: 'synthetic' }));
    let savedPoints;
    await page.route('**/api/issues/PLAN-1/field', route => {
        savedPoints = route.request().postDataJSON().value;
        return json(route, { value: savedPoints, result: 'updated', mappingRevision: 'synthetic' });
    });
    await openPlanning(page, { expectStories: false });
    const table = page.locator('.planning-review-table');
    const epic = table.locator('tbody tr[data-issue-key="PLAN-EPIC"]');
    const epicHeight = await epic.evaluate(node => node.getBoundingClientRect().height);
    expect(epicHeight).toBeGreaterThanOrEqual(32);
    expect(epicHeight).toBeLessThan(33);
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const story = table.locator('tbody tr[data-issue-key="PLAN-1"]');
    const points = story.getByRole('textbox', { name: 'Story Points', exact: true });
    await story.scrollIntoViewIfNeeded();
    const geometry = await story.evaluate(node => {
        const input = node.querySelector('.story-points-editor');
        const cell = input.closest('td');
        return { rowHeight: node.getBoundingClientRect().height, inputHeight: input.getBoundingClientRect().height, inputWidth: input.getBoundingClientRect().width,
            wrapperRight: input.parentElement.getBoundingClientRect().right, cellContentRight: cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight) };
    });
    await testInfo.attach('row geometry', { body: JSON.stringify({ epicHeight, ...geometry }), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath(`story-row-${width}.png`) });
    expect(geometry.rowHeight).toBe(epicHeight);
    expect(geometry.inputHeight).toBe(21);
    expect(geometry.inputWidth).toBe(42);
    // Firefox serializes subpixel right-edge coordinates with float precision differences.
    expect(geometry.wrapperRight).toBeCloseTo(geometry.cellContentRight, 3);
    await expect(points).toHaveAttribute('readonly', '');
    await points.hover();
    expect(await story.evaluate(node => node.getBoundingClientRect().height)).toBe(epicHeight);
    await points.click();
    await expect(points).toBeEditable();
    await expect(points).toBeFocused();
    await points.fill('0');
    expect(await story.evaluate(node => node.getBoundingClientRect().height)).toBe(epicHeight);
    await points.press('Escape');
    await expect(points).toHaveValue('1');
    expect(await story.evaluate(node => node.getBoundingClientRect().height)).toBe(epicHeight);
    await points.click();
    await expect(points).toBeEditable();
    await points.fill('0');
    await points.press('Enter');
    await expect(points).toHaveValue('0');
    await expect(story).toHaveClass(/planning-review-zero-sp/);
    expect(savedPoints).toBe(0);
    expect(await story.evaluate(node => node.getBoundingClientRect().height)).toBe(epicHeight);
});

 test('Stories expose Epic and explicit metadata, totals stay visible and Story Points save through Jira editor', async ({page}) => {
    await installPlanningFixture(page,{authMode:'atlassian_oauth'});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    let saved;
    await page.route('**/api/issues/PLAN-1/editable-fields?*',route=>json(route,{editable:true,currentValue:1,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    await page.route('**/api/issues/PLAN-1/field',route=>{saved=route.request().postDataJSON();return json(route,{value:saved.value,result:'updated',mappingRevision:'synthetic'});});
    await openPlanning(page, { expectStories: false });
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const table=page.locator('.planning-review-table');
    const points=table.locator('tbody tr').filter({has:page.getByRole('link',{name:'PLAN-1',exact:true})}).getByRole('textbox',{name:'Story Points',exact:true});
    await points.click();
    await expect(points).not.toHaveAttribute('readonly','');
    await points.fill('3');
    await expect(table.getByRole('button',{name:/^(Save|Cancel) Story Points/})).toHaveCount(0);
    await page.screenshot({path:'tmp/217-ui/planning-review-story-points-editor.png',fullPage:true});
    await points.press('Enter');
    await expect.poll(()=>saved?.value).toBe(3);
    await expect(points).toHaveValue('3');
    await points.click();await points.fill('5');
    await points.press('Escape');
    await expect(points).toHaveValue('3');
    expect(saved.value).toBe(3);
    for(const name of ['Epic','Assignee']) await expect(table.getByRole('columnheader',{name,exact:true})).toBeVisible();
    for(const name of ['Component','Project','Capacity','Project Track']) await expect(table.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    // Header cells stay one line tall: popover anchors inside them must not add a line box.
    const headerHeights=await page.locator('table.planning-review-table:not(.planning-review-docked-table) thead th').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
    expect(Math.max(...headerHeights),JSON.stringify(headerHeights)).toBeLessThanOrEqual(34);
    await expect(table.getByRole('columnheader',{name:'Fields',exact:true})).toHaveCount(0);
    await expect(table.locator('tbody .planning-review-epic').first().getByRole('link',{name:'Future planning epic',exact:true})).toHaveAttribute('href',/\/browse\/PLAN-EPIC$/);
    await expect(table.locator('tfoot .planning-review-selection')).toBeInViewport();
});

test('Planning table Story Points save two decimals, round a third before the single POST, reject negatives and cancel on Escape', async ({page}) => {
    await installPlanningFixture(page,{authMode:'atlassian_oauth'});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-1/editable-fields?*',route=>json(route,{editable:true,currentValue:1,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    const bodies=[];
    await page.route('**/api/issues/PLAN-1/field',route=>{const body=route.request().postDataJSON();bodies.push(body);return json(route,{value:body.value,result:'updated',mappingRevision:'synthetic'});});
    await openPlanning(page, { expectStories: false });
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const table=page.locator('.planning-review-table');
    const points=table.locator('tbody tr[data-issue-key="PLAN-1"]').getByRole('textbox',{name:'Story Points',exact:true});
    const feedback=table.locator('tbody tr[data-issue-key="PLAN-1"] .story-points-editor-feedback');
    await points.click();await expect(points).toBeEditable();
    await points.fill('0.75');await points.press('Enter');
    await expect.poll(()=>bodies.length).toBe(1);
    expect(bodies[0].value).toBe(0.75);
    await expect(points).toHaveValue('0.75');
    await expect(points).toHaveAttribute('aria-invalid','false');
    await expect(feedback).toHaveCount(0);
    await points.click();await expect(points).toBeEditable();
    await points.fill('0.755');await points.press('Enter');
    await expect.poll(()=>bodies.length).toBe(2);
    expect(bodies[1].value).toBe(0.76);
    await expect(points).toHaveValue('0.76');
    await points.click();await expect(points).toBeEditable();
    await points.fill('-1');await points.press('Enter');
    await expect(feedback).toHaveText('Enter a non-negative number.');
    await expect(points).toHaveAttribute('aria-invalid','true');
    await points.press('Escape');
    await expect(points).toHaveValue('0.76');
    expect(bodies).toHaveLength(2);
});

for (const passive of [true,false]) for(const width of [390,1280]) test(`summaries truncate and reveal the full text with Settings ${passive ? 'open' : 'closed'} at ${width}px`, async ({page})=>{
    const summary='[D] Adding new fields in logs and updating the migration implementation for the next sprint review';
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{authMode:'atlassian_oauth',summary});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',route=>json(route,{editable:true,currentValue:summary,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    await openPlanning(page, { expectStories: false });
    const cell=page.locator('tbody .planning-review-summary').first();
    if(passive) {
        await page.getByRole('button',{name:/manage team groups/i}).click();
        await expect(page.getByRole('dialog').first()).toBeVisible();
        await expect(cell).toHaveText(summary);
    } else await expect(cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true})).toHaveText(summary);
    const value=cell.locator('.planning-review-truncated-value');
    const target=passive?value:cell.locator('.issue-summary-editor-trigger');
    expect(await target.evaluate(node=>({clipped:node.scrollWidth>node.clientWidth+1,ellipsis:getComputedStyle(node).textOverflow,whiteSpace:getComputedStyle(node).whiteSpace}))).toEqual({clipped:true,ellipsis:'ellipsis',whiteSpace:'nowrap'});
    if(passive) await target.focus(); else await target.hover();
    const readout=page.getByRole('tooltip').filter({hasText:summary});await expect(readout).toBeVisible();
    expect(await readout.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&node.contains(document.elementFromPoint(r.left+5,r.top+5));})).toBe(true);
    await target.focus();await expect(readout).toBeVisible();await target.press('Escape');await expect(readout).toHaveCount(0);
    if(!passive){
        const trigger=cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true});
        await trigger.focus();await trigger.press('Enter');
        const editor=page.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});await expect(editor).toHaveValue(summary);await expect(readout).toHaveCount(0);await editor.press('Escape');await expect(trigger).toBeFocused();
    }
    await page.screenshot({path:`tmp/217-ui/planning-review-summary-${passive?'passive':'editing'}-${width}.png`,fullPage:true});
});

for(const width of [390,1280]) test(`Summary edits inside its cell with Enter, blur and Escape at ${width}px`,async({page},testInfo)=>{
    const summary='Original summary';let saved=[];
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{authMode:'atlassian_oauth',summary});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',route=>json(route,{editable:true,currentValue:saved.at(-1)||summary,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    await page.route('**/api/issues/PLAN-EPIC/field',route=>{saved.push(route.request().postDataJSON().value);return json(route,{value:saved.at(-1),result:'updated',mappingRevision:'synthetic'});});
    await openPlanning(page,{expectStories:false});
    await page.locator('.planning-review-region').evaluate(node=>node.scrollIntoView({block:'start'}));
    const cell=page.locator('tbody .planning-review-summary').first();
    const trigger=cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true});
    const editor=cell.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});
    // Editable Summary keeps neutral 400-weight ink; hover underlines without a button frame or geometry change.
    const summaryHover=await hoverEvidence(page,trigger,testInfo,`planning-summary-${width}`,{underline:true});
    expect(summaryHover.rest.color).toBe('rgb(26, 26, 26)');
    expect(summaryHover.hover.color).toBe(summaryHover.rest.color);
    expect(await trigger.evaluate(node=>getComputedStyle(node).fontWeight)).toBe('400');
    expect(summaryHover.hover.background).toBe('rgba(0, 0, 0, 0)');
    await trigger.click();await expect(editor).toBeEditable();
    await expect(page.getByRole('button',{name:'Save summary',exact:true})).toHaveCount(0);
    const bounds=await editor.boundingBox(),cellBounds=await cell.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(cellBounds.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(cellBounds.x+cellBounds.width);expect(bounds.width).toBeGreaterThan(cellBounds.width-24);
    await editor.fill('A long summary that should wrap across the full width of the editable cell without opening a floating panel or stretching beyond the column boundary.');
    expect(await editor.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThan(30);
    expect(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    await editor.fill('Edited in the cell');await page.screenshot({path:`tmp/217-ui/inline-summary-${width}.png`,fullPage:true});await editor.press('Enter');
    await expect(trigger).toHaveText('Edited in the cell');expect(saved).toEqual(['Edited in the cell']);
    await trigger.click();await expect(editor).toBeEditable();await editor.fill('Cancelled draft');await editor.press('Escape');
    await expect(trigger).toHaveText('Edited in the cell');await expect(trigger).toBeFocused();expect(saved).toHaveLength(1);
    await trigger.click();await expect(editor).toBeEditable();await editor.fill('');await editor.press('Enter');
    await expect(cell.getByRole('alert')).toContainText('1–255');expect(saved).toHaveLength(1);
    await editor.fill('Saved on blur');await page.mouse.click(2,2);
    await expect(trigger).toHaveText('Saved on blur');expect(saved).toEqual(['Edited in the cell','Saved on blur']);
});

test('Summary loading and saving show a spinner inside the input and never change the row height',async({page})=>{
    const summary='Original summary';let release,hold;const gate=new Promise(resolve=>{release=resolve});const saveGate=new Promise(resolve=>{hold=resolve});
    await page.setViewportSize({width:1280,height:900});
    await installPlanningFixture(page,{authMode:'atlassian_oauth',summary});
    await page.route('**/epm-burst.svg',route=>route.fulfill({path:'assets/epm-burst.svg',contentType:'image/svg+xml'}));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',async route=>{await gate;return json(route,{editable:true,currentValue:summary,mappingRevision:'synthetic',baseUpdated:'synthetic'});});
    await page.route('**/api/issues/PLAN-EPIC/field',async route=>{await saveGate;return json(route,{value:'Edited',result:'updated',mappingRevision:'synthetic'});});
    await openPlanning(page, { expectStories: false });
    const row=page.locator('tbody tr').first(),cell=row.locator('.planning-review-summary');
    const trigger=cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true});
    const rest=(await row.boundingBox()).height;
    await trigger.click();
    const editor=cell.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});
    const busy=cell.getByRole('status',{name:'Loading summary',exact:true});
    await expect(busy).toBeVisible();
    await expect(page.getByText('Loading summary…')).toHaveCount(0);
    // The spinner sits inside the input's right edge.
    const inside=await page.evaluate(()=>{const spinner=document.querySelector('.issue-summary-editor-busy').getBoundingClientRect(),input=document.querySelector('textarea.issue-summary-editor-input').getBoundingClientRect();return spinner.left>=input.left&&spinner.right<=input.right&&spinner.top>=input.top&&spinner.bottom<=input.bottom&&input.right-spinner.right<12;});
    expect(inside).toBe(true);
    await cell.screenshot({path:'tmp/245/summary-loading.png'});
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(rest+1);
    release();await expect(editor).toBeEditable();await expect(busy).toHaveCount(0);
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(rest+1);
    await editor.fill('Edited');await editor.press('Enter');
    await expect(cell.getByRole('status',{name:'Saving summary',exact:true})).toBeVisible();
    await expect(page.getByText('Saving…')).toHaveCount(0);
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(rest+1);
    hold();
});

test('Summary conflict stays inside the cell and reloads before another edit',async({page})=>{
    let writes=0,reads=0;await installPlanningFixture(page,{authMode:'atlassian_oauth',summary:'Original summary'});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',route=>{reads++;return json(route,{editable:true,currentValue:reads===1?'Original summary':'Current Jira summary',mappingRevision:'synthetic',baseUpdated:'synthetic'});});
    await page.route('**/api/issues/PLAN-EPIC/field',route=>{writes++;return json(route,{error:'stale_issue'},409);});
    await openPlanning(page, { expectStories: false });
    const cell=page.locator('tbody .planning-review-summary').first();
    await cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true}).click();
    const editor=cell.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});
    await expect(editor).toBeEditable();await editor.fill('My draft');await editor.press('Enter');
    await expect(cell.getByRole('alert')).toContainText('changed in Jira');await expect(editor).toHaveValue('My draft');await expect(editor).not.toBeEditable();
    await editor.press('Enter');expect(writes).toBe(1);
    await cell.getByRole('button',{name:'Reload field',exact:true}).click();await expect(editor).toHaveValue('Current Jira summary');await expect(editor).toBeEditable();
    await editor.press('Escape');expect(writes).toBe(1);
});

test('table shows readiness-only Epics and placeholders when no Jira Stories exist',async({page})=>{
    await installPlanningFixture(page,{authMode:'atlassian_oauth'});
    await page.route('**/api/tasks-with-team-name?*',route=>json(route,{issues:[],epics:{},epicsInScope:[],names:{}}));
    await installUncreatedReadiness(page);
    await openPlanning(page,{expectStories:false});
    const table=page.locator('.planning-review-table');
    await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);await expect(table).toContainText('1 Story awaited');
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const placeholder=table.locator('tbody tr').filter({hasText:'Story awaiting creation for Alpha Team'});
    await expect(placeholder).toHaveCount(1);await expect(placeholder).toContainText('Awaiting creation');await expect(placeholder.getByRole('checkbox')).toBeDisabled();
    await expect(placeholder.getByRole('link',{name:'Epic awaiting Stories',exact:true})).toHaveCount(1);await expect(table.locator('tfoot .planning-review-storyPoints')).toHaveText('0');
});

async function installUncreatedReadiness(page) {
    await page.route('**/api/eng/story-readiness?*',route=>{const params=new URL(route.request().url()).searchParams;return json(route,{schemaVersion:1,complete:true,scope:{groupId:params.get('groupId'),sprintId:params.get('sprint'),sprintName:params.get('sprintName'),sprintState:params.get('sprintState')},epics:[{id:'7999',key:'PLAN-EMPTY',summary:'Epic awaiting Stories',projectClass:'product',status:{name:'To Do'},missingTeams:[{id:'team-alpha',name:'Alpha Team',reason:'no_stories'}]}]});});
}

test('table keeps uncreated Stories through Story filters',async({page})=>{
    await installPlanningFixture(page,{authMode:'atlassian_oauth'});await installUncreatedReadiness(page);await openPlanning(page,{expectStories:false});
    const table=page.locator('.planning-review-table');await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);
    await page.locator('.filterbar .fb-trigger').click();
    const status=page.locator('.popover [data-facet="status"]');
    await status.locator('[data-option="Pending"]').click();
    await page.locator('.filterbar .fb-trigger').click();
    await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();await expect(table).toContainText('Story awaiting creation for Alpha Team');
    await expect(table.locator('tbody .planning-review-key').filter({hasText:'PLAN-2'})).toHaveCount(0);
});

for(const [scopeTeamIds,selectedTeams] of [[['team-alpha'],null],[['team-alpha','team-beta'],null],[['team-alpha','team-beta'],['team-alpha']]]) test(`Table sticky summary compacts ${scopeTeamIds.length} Team scope${selectedTeams?' with one Team selected':''} and expands without losing selection`,async({page})=>{
    const fixture=await installPlanningFixture(page,{scopeTeamIds,selectedTeams,capacityProject:'CAP',initialPlans:{[futureSprintId]:{includedIssueIds:futureStories.map(story=>story.id)}}});
    await page.route('**/api/capacity?*',route=>json(route,{enabled:true,mutationEnabled:false,sprint:new URL(route.request().url()).searchParams.get('sprint'),capacities:{'Alpha Team':10,'Beta Team':8},entries:[{teamName:'Alpha Team',issueKey:'CAP-101',capacity:10},{teamName:'Beta Team',issueKey:'CAP-102',capacity:8}]}));
    await openPlanning(page,{expectStories:false});
    const panel=page.locator('.planning-panel');
    const selected=futureStories.length;
    await expect(panel).toHaveClass(/planning-panel-compact/);await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    // One Team selected: the collapsed assignee strip is in the stack (the strip itself is #323).
    await expect(page.locator('[data-assignee-capacity]')).toHaveCount(selectedTeams?1:0);
    const row=await panel.boundingBox();expect(row.height).toBeLessThan(64);
    await expect(panel.locator('#planning-panel-details')).toBeHidden();
    await expect(panel.locator('.planning-actions > .planning-stats')).toContainText(`${selected} stories`);
    await expect(panel.locator('.planning-actions > .planning-stats')).toContainText(' SP · Cap ');
    expectSummaryInSlot(await overviewSummaryGeometry(panel),'sticky summary');
    const beforeCalls=fixture.calls.filter(call=>['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies'].includes(call.pathname)).length;
    await clickPlanningOption(page, 'Show capacity details');
    await expect(panel.locator('#planning-panel-details')).toBeVisible();
    await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    await expect(panel.locator('.capacity-bar-graph')).toHaveCount(1);
    for(const selector of ['.capacity-bar-fill','.project-bar-fill.product']) {
        const fill=panel.locator(selector).first();
        const strip=selector==='.capacity-bar-fill'&&await panel.locator('[data-assignee-underbar]').count()>0;
        const before=await fill.boundingBox();
        if(strip){const box=await panel.locator('[data-assignee-underbar] .stacked-bar-track').boundingBox();await page.mouse.move(box.x+box.width-2,box.y+box.height/2);}else await fill.hover();
        expect(await fill.boundingBox()).toEqual(before);
        await page.screenshot({path:`tmp/217-ui/bar-hover-${scopeTeamIds.length}${selectedTeams?'-one':''}-${selector.includes('product')?'project':'capacity'}.png`});
        const label=fill.locator('.capacity-bar-fill-label');
        await expect(label).toBeVisible();
        expect(await label.evaluate(node=>{
            node.style.pointerEvents='auto';
            const under=document.querySelector('[data-assignee-underbar]');if(under)under.style.pointerEvents='none';
            const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.left+4,r.top+r.height/2);
            node.style.pointerEvents='';if(under)under.style.pointerEvents='';
            return top===node;
        })).toBe(true);
        if(strip){await expect(page.locator('.stacked-bar-readout')).toContainText('Selected');expect(await fill.getAttribute('data-tooltip')).toBeNull();}
        else expect(await fill.evaluate(node=>getComputedStyle(node,'::after').content)).not.toBe('none');
    }
    const collapse=panel.getByRole('button',{name:'Hide capacity details',exact:true});
    await expect(collapse).toBeVisible();
    expect(await collapse.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);
    await page.screenshot({path:`tmp/217-ui/collapse-menu-${scopeTeamIds.length}-team.png`,fullPage:false});

    await clickPlanningOption(page, 'Hide capacity details');await page.getByRole('radio',{name:'Stories',exact:true}).click();
    expect(await page.locator('.planning-review-table tbody input[type=checkbox]:checked').count()).toBe(selected);
    expect(fixture.calls.filter(call=>['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies'].includes(call.pathname)).length).toBe(beforeCalls);
    await page.addStyleTag({content:'body{padding-bottom:1000px}'});
    await page.locator('.planning-review-region').evaluate(node=>node.scrollIntoView({block:'start'}));
    await expect(panel).toHaveClass(/stuck/);const sticky=await panel.boundingBox();expect(sticky.height).toBeLessThan(64);expect(sticky.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({path:`tmp/217-ui/compact-sticky-${scopeTeamIds.length}-team.png`,fullPage:false});
    await page.locator('.filterbar .fb-trigger').click();
    const popup=page.locator('.popover');await expect(popup).toBeVisible();expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.locator('.filterbar .fb-trigger').click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();await expect(panel).toHaveCount(0);
});

test('compact Table panel fits narrow screens and restores normal Planning in Scenario',async({page})=>{
    await page.setViewportSize({width:390,height:900});await installPlanningFixture(page,{});await openPlanning(page,{expectStories:false});
    const panel=page.locator('.planning-panel');await expect(panel).toHaveClass(/planning-panel-compact/);
    await expect(panel.locator('.planning-actions > .planning-stats')).toHaveText('Cap unavailable');
    const primary=panel.locator('.planning-actions button');
    // Six direct controls (2026-11-06); at 390px the row wraps inside the panel instead of overflowing it.
    await expect(primary).toHaveCount(6);
    const panelBox=await panel.boundingBox();
    for(const control of await primary.all()) {
        const rect=await control.boundingBox();
        expect(rect.width).toBeGreaterThanOrEqual(24);expect(rect.height).toBeGreaterThanOrEqual(24);
        expect(rect.x).toBeGreaterThanOrEqual(panelBox.x);expect(rect.x+rect.width).toBeLessThanOrEqual(panelBox.x+panelBox.width);
        expect(await control.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
        await control.hover();expect(await control.boundingBox()).toEqual(rect);
    }
    await page.mouse.move(0,0);
    const compactGeometry=await panel.evaluate(node=>[node,...node.children,...node.querySelectorAll('.planning-actions button')].map(element=>{
        const r=element.getBoundingClientRect(),style=getComputedStyle(element);
        return {className:element.className,display:style.display,text:element.textContent.trim().slice(0,180),x:r.x,y:r.y,width:r.width,height:r.height,
            padding:style.padding,font:style.font,fontSize:style.fontSize,lineHeight:style.lineHeight,gap:style.gap,columnGap:style.columnGap,boxSizing:style.boxSizing};
    }));
    fs.writeFileSync(path.join(repoRoot,'tmp','217-ui','shared-planning-narrow-390.json'),JSON.stringify(compactGeometry,null,2));
    await page.screenshot({path:'tmp/217-ui/shared-planning-narrow-390.png',fullPage:false});
    expect((await panel.boundingBox()).height).toBeLessThan(130);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await clickPlanningOption(page, 'Show capacity details');await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    await clickPlanningOption(page, 'Hide capacity details');await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Show capacity details',exact:true})).toBeVisible();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Scenario',exact:true}).click();await expect(panel).toHaveCount(0);
});

// Planning List is retired (#323, G2 2026-11-06): no preference and a saved List preference both open Table, and no layout is stored.
for (const planningLayout of [null, 'list']) test(`Planning opens Table ${planningLayout ? 'from a saved List preference' : 'without a layout preference'}, offers no List toggle and stores no layout`, async ({page}) => {
    await installPlanningFixture(page,{planningLayout});await openPlanning(page);
    await expect(page.getByRole('region',{name:'Planning Sprint review'})).toBeVisible();
    await expect(page.locator('.planning-panel')).toHaveClass(/planning-panel-compact/);
    await expect(page.locator('.task-list')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Show Planning (list|table)/})).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')||'{}').showPlanning)).toBe(true);
    expect(await page.evaluate(()=>Object.hasOwn(JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')||'{}'),'planningLayout'))).toBe(false);
    // A saved Planning view whose preferences still carry List reopens straight into Table.
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')||'{}'));
    await page.addInitScript(value=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify(value)),{...saved,planningLayout:'list'});
    await page.reload();await expect(page.getByRole('region',{name:'Planning Sprint review'})).toBeVisible();
    await expect(page.locator('.planning-panel')).toHaveClass(/planning-panel-compact/);
    await expect(page.locator('.task-list')).toHaveCount(0);
});

// Column menus and the Add popover are editing controls: give the review a saving-capable profile.
async function allowReviewSaving(page) {
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => json(route, {cells:[],unavailableIssueIds:[]}));
}

for (const width of [1280, 390]) test(`first Table scroll activates the sticky Filters then capacity stack without losing state at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{planningLayout:null,scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    await page.addStyleTag({content:'body{padding-bottom:1000px}'});await page.evaluate(()=>scrollTo(0,0));
    const stack=page.locator('.planning-review-sticky-stack'),filters=stack.locator('.filterbar-wrap'),panel=stack.locator('.planning-panel');
    await expect(stack).toBeVisible();const initial=await stack.boundingBox();expect(initial.y).toBeGreaterThan(0);
    // The Epics|Stories switch lives in the Filters row from the start: one node, one position, before and after every scroll.
    await expect(page.locator('.planning-review-toolbar, .planning-review-toolbar-slot')).toHaveCount(0);
    const rowSwitch=filters.getByRole('radiogroup',{name:'Planning review rows'});await expect(rowSwitch).toHaveCount(1);
    await rowSwitch.evaluate(node=>{node.dataset.probe='row-switch';});
    const switchLeft=(await rowSwitch.boundingBox()).x;
    await page.screenshot({path:`tmp/217-ui/table-filters-row-normal-${width}.png`,fullPage:false});
    const selected=await page.locator('.planning-review-table tbody input:checked').count();
    await page.mouse.move(width-2,850);await page.mouse.wheel(0,12);await expect(page.locator('.compact-sticky-header')).toHaveClass(/is-visible/);
    await expect.poll(async()=>{const h=await page.locator('.compact-sticky-header').boundingBox(),s=await stack.boundingBox();return Math.abs(s.y-(h.y+h.height));}).toBeLessThan(2);
    const f=await filters.boundingBox(),p=await panel.boundingBox();expect(p.y).toBeGreaterThanOrEqual(f.y+f.height-1);
    await expect(panel).toHaveClass(/stuck/);expect(await page.locator('.planning-review-table tbody input:checked').count()).toBe(selected);
    await filters.locator('.fb-trigger').click();await expect(page.locator('.popover')).toBeVisible();await filters.locator('.fb-trigger').click();
    await page.locator('.planning-review-scroll').evaluate(node=>node.scrollIntoView({block:'start'}));
    await expect(filters.locator('[data-probe="row-switch"]')).toHaveCount(1);
    expect(Math.abs((await filters.locator('[data-probe="row-switch"]').boundingBox()).x-switchLeft)).toBeLessThan(1);
    // Popup layering over the sticky stack is asserted on the docked header in the next test, where the corner is reachable in every browser.
    await page.screenshot({path:`tmp/217-ui/table-sticky-filter-first-${width}.png`,fullPage:false});
    await page.evaluate(()=>scrollTo(0,0));
    await expect(filters.locator('[data-probe="row-switch"]')).toHaveCount(1);
    expect(Math.abs((await filters.locator('[data-probe="row-switch"]').boundingBox()).x-switchLeft)).toBeLessThan(1);
    expect(await page.locator('.planning-review-table tbody input:checked').count()).toBe(selected);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();await expect(panel).toHaveCount(0);
});

for (const width of [1280, 390]) test(`Table mode has no toolbar tier: the row switch is the shared compact control in the Filters row, and Sort leaves Table view only at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    await expect(page.locator('.planning-review-toolbar, .planning-review-toolbar-slot')).toHaveCount(0);
    const controls=page.locator('.filterbar-wrap .fb-view-controls');
    const rowSwitch=controls.getByRole('radiogroup',{name:'Planning review rows'});
    await expect(rowSwitch).toHaveCount(1);
    await expect(rowSwitch).toHaveClass(/eng-mode-control/);await expect(rowSwitch).toHaveClass(/segmented-control-compact/);
    const look=await rowSwitch.evaluate(node=>{const s=getComputedStyle(node),buttons=[...node.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {top:r.top,height:r.height,right:r.right,scroll:b.scrollWidth-b.clientWidth};});return {wrap:s.flexWrap,height:node.getBoundingClientRect().height,buttons};});
    expect(look.wrap).toBe('nowrap');expect(look.height).toBeLessThanOrEqual(31);
    expect(Math.max(...look.buttons.map(b=>b.top))-Math.min(...look.buttons.map(b=>b.top))).toBeLessThan(1);
    for(const b of look.buttons) expect(b.scroll).toBeLessThanOrEqual(0);
    // Sort epics is not rendered in Table view (it never did anything there); it is back in Catch Up.
    await expect(page.getByRole('button',{name:'Sort epics'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Group by Initiative'})).toHaveCount(0);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();
    await expect(page.getByRole('button',{name:'Sort epics'})).toHaveCount(1);
});

for (const [width,height] of [[1440,900],[1280,720]]) for (const selectedTeams of [null,['team-alpha']]) test(`the pinned stack with the table header docked is at most 175px at ${width}x${height}${selectedTeams?' with one Team selected':''}`,async({page})=>{
    await page.setViewportSize({width,height});
    await installPlanningFixture(page,{longTable:true,scopeTeamIds:['team-alpha','team-beta'],selectedTeams});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.locator('.planning-review-scroll').evaluate(node=>scrollTo(0,scrollY+node.getBoundingClientRect().top+250));
    const docked=page.locator('.planning-review-docked-header');await expect(docked).toBeVisible();
    await expect(page.locator('.compact-sticky-header')).toHaveClass(/is-visible/);
    const measured = await page.evaluate(() => {
        const box = selector => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom,
                fontSize: style.fontSize, lineHeight: style.lineHeight, text: node.textContent.trim().slice(0, 250) };
        };
        return Object.fromEntries(['.compact-sticky-header.is-visible', '.planning-review-sticky-stack .filterbar-wrap',
            '.planning-panel', '.planning-actions', '.planning-actions > .planning-stats', '.planning-actions > .planning-review-state-note',
            '[data-assignee-capacity]', '.capacity-panel', '.planning-review-docked-header'].map(selector => [selector, box(selector)]));
    });
    fs.writeFileSync(path.join(repoRoot, 'tmp', '217-ui', `shared-sticky-geometry-${width}x${height}${selectedTeams ? '-one-team' : ''}.json`), JSON.stringify(measured, null, 2));
    await page.screenshot({ path: `tmp/217-ui/shared-sticky-geometry-${width}x${height}${selectedTeams ? '-one-team' : ''}.png`, fullPage: false });
    await expect.poll(async()=>{const d=await docked.boundingBox();return Math.round(d.y+d.height);}).toBeLessThanOrEqual(175);
    await expect(page.locator('[data-assignee-capacity]')).toHaveCount(selectedTeams?1:0);
    const parts=await page.evaluate(()=>{const box=s=>{const n=document.querySelector(s);return n?Math.round(n.getBoundingClientRect().height*10)/10:null;};return {header:box('.compact-sticky-header.is-visible'),filters:box('.planning-review-sticky-stack .filterbar-wrap'),overview:box('.planning-review-sticky-stack .planning-panel'),docked:box('.planning-review-docked-header')};});
    const bottom=await docked.boundingBox();
    expect(bottom.y+bottom.height,JSON.stringify(parts)).toBeLessThanOrEqual(175);
});

// Planned Teams Effort: a 28px strip in Table view (collapsed by default).
const effortPanel = page => page.locator('.capacity-panel');
const effortToggle = page => effortPanel(page).locator('.capacity-header');
const firstRowTop = page => page.locator('.planning-review-table tbody tr').first().evaluate(node => node.getBoundingClientRect().top + scrollY);

test('Planned Teams Effort is a collapsed strip in Table view, expands without refetching, and remembers the choice',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    // No saved layout: Table is the default, and the page's own saved preferences survive the reloads below.
    const fixture=await installPlanningFixture(page,{planningLayout:null,scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    const panel=effortPanel(page),toggle=effortToggle(page);
    await expect(panel).toHaveClass(/capacity-panel-collapsed/);
    await expect(toggle).toHaveJSProperty('tagName','BUTTON');await expect(toggle).toHaveAttribute('aria-expanded','false');
    const strip=await panel.boundingBox();expect(strip.height).toBeLessThanOrEqual(32);
    // Mounted but hidden while collapsed.
    await expect(panel.locator('.capacity-grid-wrapper')).toHaveCount(1);await expect(panel.locator('.capacity-grid-wrapper')).toBeHidden();
    const collapsedTop=await firstRowTop(page);
    const loads=()=>fixture.calls.filter(call=>['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies','/api/eng/board','/api/capacity'].includes(call.pathname)).length;
    const before=loads();
    await toggle.click();
    await expect(panel).not.toHaveClass(/capacity-panel-collapsed/);await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(panel.locator('.capacity-grid-wrapper')).toBeVisible();
    await expect(panel.getByText('Planned Teams Effort (Story Points)')).toBeVisible();
    expect(loads()).toBe(before);
    const expandedTop=await firstRowTop(page);
    expect(expandedTop-collapsedTop,JSON.stringify({collapsedTop,expandedTop})).toBeGreaterThanOrEqual(100);
    await page.screenshot({path:'tmp/217-ui/c3-effort-expanded.png',fullPage:false});
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')||'{}').planningTeamsEffortExpanded)).toBe(true);
    await page.reload();await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(effortPanel(page)).not.toHaveClass(/capacity-panel-collapsed/);
    await effortToggle(page).click();await expect(effortPanel(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')||'{}').planningTeamsEffortExpanded)).toBe(false);
    await page.reload();await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(effortPanel(page)).toHaveClass(/capacity-panel-collapsed/);
    await page.screenshot({path:'tmp/217-ui/c3-effort-collapsed.png',fullPage:false});
});

test('the Planned Teams Effort toggle keeps a readable, stationary hover',async({page},testInfo)=>{
    await page.setViewportSize({width:1440,height:900});
    await installPlanningFixture(page,{scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    const toggle=effortToggle(page);
    await hoverEvidence(page,toggle,testInfo,'planning-effort-header',{foundation:true,clipped:true,readableDescendants:true});
    const read=()=>toggle.evaluate(node=>{
        const parse=v=>(v.match(/[\d.]+/g)||[]).map(Number);
        let surface=node,bg=parse(getComputedStyle(surface).backgroundColor);
        while((bg[3]??1)===0&&surface.parentElement){surface=surface.parentElement;bg=parse(getComputedStyle(surface).backgroundColor);}
        const style=getComputedStyle(node),lum=rgb=>{const [r,g,b]=rgb.map(v=>{const c=v/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
        const title=getComputedStyle(node.querySelector('.capacity-title')),fg=parse(title.color).slice(0,3),[hi,lo]=[lum(fg),lum(bg.slice(0,3))].sort((x,y)=>y-x);
        return {contrast:(hi+0.05)/(lo+0.05),transform:style.transform,shadow:style.boxShadow,spacing:style.letterSpacing,cursor:style.cursor};
    });
    await expect.poll(async()=>(await read()).contrast).toBeGreaterThanOrEqual(4.5);
    const settled=await read();expect(settled.transform).toBe('none');expect(settled.cursor).toBe('pointer');
    expect(['normal','0px']).toContain(settled.spacing);
});

test('the docked header follows the sticky stack when its offset changes without any scroll or resize',async({page})=>{
    await page.setViewportSize({width:1280,height:800});
    await installPlanningFixture(page,{longTable:true,scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.locator('.planning-review-scroll').evaluate(node=>scrollTo(0,scrollY+node.getBoundingClientRect().top+250));
    const docked=page.locator('.planning-review-docked-header'),stack=page.locator('.planning-review-sticky-stack');
    await expect(docked).toBeVisible();
    const gap=async()=>{const d=await docked.boundingBox(),s=await stack.boundingBox();return Math.abs(d.y-(s.y+s.height));};
    await expect.poll(gap).toBeLessThan(2);
    // The compact header appearing (or the filter bar changing height) moves the stack by changing this variable; nothing scrolls.
    await stack.evaluate(node=>{node.closest('.container').style.setProperty('--compact-header-offset','24px');});
    await expect.poll(async()=>(await stack.boundingBox()).y).toBeGreaterThan(20);
    await expect.poll(gap).toBeLessThan(2);
});

test('Discard and Save sit at the right end of the Filters row only while the review is dirty, and no popup is covered by them',async({page})=>{
    await page.setViewportSize({width:1280,height:900});
    await installPlanningFixture(page,{scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    const row=page.locator('.filterbar-wrap .filterbar'),controls=row.locator('.fb-view-controls');
    await expect(controls.getByRole('button',{name:'Save plan',exact:true})).toHaveCount(0);
    await expect(controls.getByRole('button',{name:'Discard changes',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Risk');await page.getByRole('button',{name:'Add column',exact:true}).click();
    const save=controls.getByRole('button',{name:'Save plan',exact:true}),discard=controls.getByRole('button',{name:'Discard changes',exact:true});
    await expect(save).toBeVisible();await expect(discard).toBeVisible();
    await page.locator('.filterbar-wrap').screenshot({path:'tmp/217-ui/c1-filters-row-dirty-1280.png'});
    await expect(save).toHaveClass(/fb-trigger-primary/);await expect(discard).toHaveClass(/fb-trigger(?!-)/);
    const geometry=await page.evaluate(()=>{const r=n=>n.getBoundingClientRect(),bar=r(document.querySelector('.filterbar')),mode=r(document.querySelector('[aria-label="Planning review rows"]')),discard=[...document.querySelectorAll('.fb-view-controls button')].find(b=>b.textContent.trim()==='Discard changes'),save=[...document.querySelectorAll('.fb-view-controls button')].find(b=>b.getAttribute('aria-label')==='Save plan'),d=r(discard),s=r(save),filters=r(document.querySelector('.filterbar .pop-host .fb-trigger'));return {barRight:bar.right,barTop:bar.top,barBottom:bar.bottom,modeRight:mode.right,discardLeft:d.left,saveRight:s.right,saveTop:s.top,saveBottom:s.bottom,saveText:save.scrollWidth-save.clientWidth,filtersRight:filters.right,modeLeft:mode.left,height:bar.height};});
    expect(geometry.barRight-geometry.saveRight,JSON.stringify(geometry)).toBeLessThan(14);
    expect(geometry.discardLeft,JSON.stringify(geometry)).toBeGreaterThan(geometry.modeRight);
    expect(geometry.modeLeft,JSON.stringify(geometry)).toBeGreaterThan(geometry.filtersRight);
    expect(geometry.saveTop).toBeGreaterThanOrEqual(geometry.barTop);expect(geometry.saveBottom).toBeLessThanOrEqual(geometry.barBottom);
    expect(geometry.saveText).toBeLessThanOrEqual(0);expect(geometry.height).toBeLessThanOrEqual(43);
    // Discard (outline) and Save (the one filled action) keep readable text on hover instead of the global dark surface.
    for(const [label,button] of [['Discard',discard],['Save',save]]){
        await page.mouse.move(0,0);const restSpacing=await button.evaluate(node=>getComputedStyle(node).letterSpacing);
        await button.hover();
        const read=()=>button.evaluate(node=>{
            const parse=v=>(v.match(/[\d.]+/g)||[]).map(Number);
            let surface=node,bg=parse(getComputedStyle(surface).backgroundColor);
            while((bg[3]??1)===0&&surface.parentElement){surface=surface.parentElement;bg=parse(getComputedStyle(surface).backgroundColor);}
            const style=getComputedStyle(node),lum=rgb=>{const [r,g,b]=rgb.map(v=>{const c=v/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
            const fg=parse(style.color).slice(0,3),back=bg.slice(0,3),[hi,lo]=[lum(fg),lum(back)].sort((x,y)=>y-x);
            return {contrast:(hi+0.05)/(lo+0.05),transform:style.transform,spacing:style.letterSpacing};
        });
        await expect.poll(async()=>(await read()).contrast,{message:`${label} hover contrast`}).toBeGreaterThanOrEqual(4.5);
        const settled=await read();expect(settled.transform,label).toBe('none');expect(settled.spacing,label).toBe(restSpacing);
    }
    // The Filters popover opens in front of the cluster.
    await row.locator('.fb-trigger').first().click();
    const popup=page.locator('.popover');await expect(popup).toBeVisible();
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+12,r.top+12));})).toBe(true);
    await row.locator('.fb-trigger').first().click();
    await discard.click();await controls.getByRole('button',{name:'Discard changes',exact:true}).first().click();
    await expect(save).toHaveCount(0);
});

for (const width of [1280, 390]) test(`Catch Up shares the second controls row before alerts at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});await installPlanningFixture(page);await openPlanning(page);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();
    const filters=page.locator('.filterbar-wrap'),alerts=page.locator('.alerts-panel-shell');
    await expect(filters).toHaveCount(1);await expect(alerts).toBeVisible();await page.evaluate(()=>scrollTo(0,0));
    const f=await filters.boundingBox(),a=await alerts.boundingBox(),header=await page.locator('header').boundingBox();
    expect(f.y).toBeGreaterThanOrEqual(header.y+header.height);expect(f.y+f.height).toBeLessThanOrEqual(a.y);
    await filters.locator('.fb-trigger').click();const popup=page.locator('.popover');await expect(popup).toBeVisible();
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await filters.locator('.fb-trigger').click();await page.screenshot({path:`tmp/217-ui/catch-up-controls-${width}.png`,fullPage:false});
});

for (const width of [1280,390]) test(`document scroll docks table headings below the measured controls at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{longTable:true,scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);
    await openPlanning(page,{expectStories:false});
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const scroll=page.locator('.planning-review-scroll'), stack=page.locator('.planning-review-sticky-stack');
    const selected=await scroll.locator('tbody input:checked').count();
    expect(await scroll.evaluate(node=>node.scrollHeight-node.clientHeight)).toBeLessThanOrEqual(1);
    await scroll.evaluate(node=>scrollTo(0,scrollY+node.getBoundingClientRect().top+250));
    const heading=page.locator('.planning-review-docked-header');await expect(heading).toBeVisible();
    await expect.poll(async()=>{const h=await heading.boundingBox(),s=await stack.boundingBox();return Math.abs(h.y-s.y-s.height);}).toBeLessThan(2);
    expect(await scroll.evaluate(node=>{const h=document.querySelector('.planning-review-docked-header').getBoundingClientRect(),r=node.getBoundingClientRect();return !node.querySelector('tbody').contains(document.elementFromPoint(r.left+10,h.top-8));})).toBe(true);
    await clickPlanningOption(page, 'Show capacity details');
    await expect.poll(async()=>{const h=await heading.boundingBox(),s=await stack.boundingBox();return Math.abs(h.y-s.y-s.height);}).toBeLessThan(2);
    await clickPlanningOption(page, 'Hide capacity details');
    await expect.poll(async()=>{const h=await heading.boundingBox(),s=await stack.boundingBox();return Math.abs(h.y-s.y-s.height);}).toBeLessThan(2);
    // The real header is hidden from assistive technology while docked, so these roles resolve to the docked copy.
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Add review column'});await expect(popup).toBeVisible();
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');
    const menuButton=heading.getByRole('button',{name:'Status column options',exact:true});await menuButton.scrollIntoViewIfNeeded();await menuButton.click();
    const menu=page.getByRole('dialog',{name:'Status column options'});await expect(menu).toBeVisible();
    expect(await menu.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({path:`tmp/217-ui/single-page-dashboard-${width}.png`,fullPage:false});
    expect(await scroll.locator('tbody input:checked').count()).toBe(selected);
    await page.locator('.compact-sticky-header').getByRole('radio',{name:'Catch Up',exact:true}).click();
    await expect(heading).toHaveCount(0);await expect(page.locator('.planning-review-docked-footer')).toHaveCount(0);
});

// Review columns are per Department group: group-alpha has the Epic "Cost" column, any other group has none. `derived: true`
// adds a Story number sum column (a rollup on Epic rows); it stays off so the existing Epic-mode tests see no derived columns.
async function automaticPlanningFixture(page, { longTable = false, derived = false, groups = 1 } = {}) {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const fixture = await installPlanningFixture(page, { longTable, groups, initialPlans: { [futureSprintId]: {
        includedIssueIds: longTable ? Array.from({ length: 60 }, (_, index) => String(8001 + index)) : futureStories.map(story => story.id),
    } } });
    const state = { remote: false, readGate: null, schemaStatus: 200, readStatus: 200, schemaReads: 0, values: [], primary: [], saveCalls: [], saveGate: null, saveStatus: 200, canRead: true, unavailable: [], limit: null, reviewGroups: [] };
    const alphaColumns = [{ id: 'cost', rowKind: 'epic', label: 'Cost', type: 'number', aggregation: 'sum', order: 0 }, ...(derived ? [{ id: 'effort', rowKind: 'story', label: 'Effort', type: 'number', aggregation: 'sum', order: 1 }] : [])];
    const columnsFor = groupId => groupId === 'group-alpha' ? alphaColumns : [];
    await page.route('**/api/capacity*', route => json(route, { enabled: false }));
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, async route => {
        const groupId = reviewGroupOf(route.request()); state.reviewGroups.push(groupId); const columns = columnsFor(groupId);
        if (route.request().method() === 'PATCH') { const payload = requestBody(route.request()); state.saveCalls.push(payload); if (state.saveGate) await state.saveGate; if (state.saveStatus === 'network') return route.abort('failed'); return json(route, state.saveStatus === 409 ? { error: 'review_conflict', schemaConflict: false, cellConflicts: [{ issueId: '7001', columnId: 'cost' }] } : { schemaRevision: 1, columns, layouts: {}, cells: payload.cellChanges.map(cell => ({ ...cell, revision: 2 })) }, state.saveStatus); }
        state.schemaReads++; return json(route, { schemaRevision: state.remote ? 2 : 1, columns, layouts: {}, capabilities: { canRead: state.canRead, canSave: state.canRead } }, state.schemaStatus);
    });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, async route => {
        const batch = requestBody(route.request()); state.values.push(batch); state.reviewGroups.push(batch.groupId);
        if (state.readGate) await state.readGate;
        if (state.limit && batch.issueIds.length > state.limit) return json(route, { error: 'response_limit' }, 413);
        return json(route, { cells: batch.rowKind === 'epic' && columnsFor(batch.groupId).length ? [{ rowKind: 'epic', issueId: '7001', columnId: 'cost', value: state.remote ? '8' : '1', revision: state.remote ? 2 : 1 }] : [], unavailableIssueIds: state.unavailable }, state.readStatus);
    });
    await page.route('**/api/tasks-with-team-name*', route => {
        const url = new URL(route.request().url());
        if (!state.remote || url.searchParams.get('purpose')) return route.fallback();
        state.primary.push(Object.fromEntries(url.searchParams));
        const product = url.searchParams.get('project') === 'product';
        const rows = longTable ? Array.from({ length: 61 }, (_, i) => makeStory(`PLAN-${i + 1}`, 'To Do')) : [makeStory('PLAN-1', 'To Do'), makeStory('PLAN-2', 'To Do'), makeStory('PLAN-3', 'To Do'), makeStory('PLAN-4', 'To Do')];
        const epic = makeEpic(); epic.summary = 'Accepted automatic Epic';
        return json(route, { issues: product ? rows : [], epics: product ? { [epic.key]: epic } : {}, epicsInScope: product ? [epic] : [], names: {} });
    });
    await openPlanning(page, { expectStories: false });
    await expect(page.getByRole('textbox', { name: 'Cost for PLAN-EPIC', exact: true })).toBeVisible();
    await expect(page.locator('.planning-review-state-note', { hasText: 'Loading…' })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    return { lifecycle, fixture, state };
}

test('the dashboard table shows derived columns by default: a Story sum on Epics (S) and the Epic value on its Stories (E)', async ({ page }) => {
    const { state } = await automaticPlanningFixture(page, { derived: true });
    const values = state.values.length;
    const scroll = page.locator('.planning-review-scroll');
    const rollup = scroll.locator('thead th[aria-label="Effort, Story property"]');
    await expect(rollup).toHaveCount(1);
    await expect(rollup.locator('.planning-review-derived-marker')).toHaveText('S');
    expect(await rollup.locator('.planning-review-derived-marker').evaluate(node => node.nextElementSibling?.nextElementSibling?.classList.contains('planning-review-heading'))).toBe(true);
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const inherited = scroll.locator('thead th[aria-label="Cost, Epic property"]');
    await expect(inherited.locator('.planning-review-derived-marker')).toHaveText('E');
    const storyRow = scroll.locator('tbody tr[data-row-kind="story"][data-epic-key="PLAN-EPIC"]').first();
    await expect(storyRow.locator('td.planning-review-cost')).toHaveText('1');
    expect(await storyRow.locator('td.planning-review-cost input').count()).toBe(0);
    expect(state.values.length).toBe(values);
});

test('automatic Planning current-row reconciliation stages one forced review with no indirect loading', async ({ page }, testInfo) => {
    const { lifecycle, state } = await automaticPlanningFixture(page);
    const { deferred } = require('./eng_epic_refresh_fixture'); const gate = deferred();
    const values = state.values.length, schemas = state.schemaReads; state.remote = true; state.readGate = gate.promise;
    await page.evaluate(() => { window.reviewLoadingObserved = false; const observer = new MutationObserver(() => { if ([...document.querySelectorAll('.planning-review-state-note')].some(node => /Loading/.test(node.textContent))) window.reviewLoadingObserved = true; }); observer.observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await page.screenshot({ path: 'tmp/freshness-251/task-7-table-before.png', animations: 'disabled' });
    await lifecycle.returnAfter(13 * 60000);
    await expect(page.locator('tbody .planning-review-summary').first()).toContainText('Accepted automatic Epic');
    await expect.poll(() => state.values.length).toBe(values + 1);
    await expect(page.locator('.planning-review-state-note', { hasText: 'Loading…' })).toHaveCount(0);
    gate.resolve(); await expect.poll(() => state.values.length).toBe(values + 2); await page.waitForLoadState('networkidle');
    expect(state.schemaReads - schemas).toBe(1); expect(state.values.slice(values).map(batch => batch.rowKind)).toEqual(['story', 'epic']);
    expect(state.values.slice(values).find(batch => batch.rowKind === 'story').issueIds).toEqual(expect.arrayContaining(['8001', '8002', '8003', '8004'])); expect(state.primary).toHaveLength(2);
    expect(await page.evaluate(() => window.reviewLoadingObserved)).toBe(false);
    await page.screenshot({ path: 'tmp/freshness-251/task-7-table-after.png', animations: 'disabled' });
    await testInfo.attach('current-admitted-review-batches', { body: JSON.stringify(state.values.slice(values)), contentType: 'application/json' });
});

test('focused clean Planning input defers return, keeps node/value/focus and drains on blur', async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page); const input = page.getByRole('textbox', { name: 'Cost for PLAN-EPIC', exact: true });
    await input.focus(); const node = await input.elementHandle(), value = await input.inputValue(); state.remote = true;
    await page.screenshot({ path: 'tmp/freshness-251/task-7-input-before.png', animations: 'disabled' });
    await lifecycle.returnAfter(13 * 60000); await page.waitForTimeout(200);
    expect(state.primary).toHaveLength(0); expect(await input.inputValue()).toBe(value); await expect(input).toBeFocused();
    expect(await input.evaluate((element, prior) => element === prior, node)).toBe(true);
    await page.screenshot({ path: 'tmp/freshness-251/task-7-input-held-after.png', animations: 'disabled' });
    await input.evaluate(element => element.blur()); await expect.poll(() => state.primary.length).toBe(2);
});

test('dirty Planning layout and scope dialog retain one intent through Stay and Discard', async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page);
    await page.getByRole('button', { name: '+ Add column', exact: true }).click(); await page.getByLabel('Column name', { exact: true }).fill('Local column'); await page.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled(); state.remote = true;
    await lifecycle.returnAfter(13 * 60000); await page.waitForTimeout(150); expect(state.primary).toHaveLength(0);
    await page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle').click(); await page.locator('.sprint-dropdown-option', { hasText: secondFutureSprintName }).click();
    await expect(page.getByRole('dialog', { name: 'Save this plan?' })).toBeVisible(); await page.waitForTimeout(100); expect(state.primary).toHaveLength(0);
    await page.getByRole('button', { name: 'Stay', exact: true }).click(); expect(state.primary).toHaveLength(0);
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(page.getByText('Discard unsaved changes?', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect.poll(() => state.primary.length).toBe(2);
    await expect(page.getByRole('textbox', { name: 'Local column for PLAN-EPIC', exact: true })).toHaveCount(0);
});

for (const status of [429, 500, 401]) test(`automatic Planning review ${status} retains held UI and never replays`, async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page); state.remote = true; state.schemaStatus = status;
    const before = state.schemaReads; await lifecycle.returnAfter(13 * 60000); await expect.poll(() => state.schemaReads).toBe(before + 1); await page.waitForTimeout(200);
    if (status === 401) { await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toBeVisible(); await lifecycle.returnAfter(24 * 60 * 60000); await page.waitForTimeout(100); expect(state.schemaReads).toBe(before + 1); }
    else {
        await expect(page.getByRole('textbox', { name: 'Cost for PLAN-EPIC', exact: true })).toHaveValue('1');
        await expect(page.locator('.planning-review-state-note', { hasText: 'Plan could not be loaded.' })).toBeVisible();
        await expect(page.locator('.planning-panel').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        expect(state.schemaReads).toBe(before + 1);
    }
});

test('automatic Planning save-in-flight waits for confirmation then checks once without replay', async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page); const { deferred } = require('./eng_epic_refresh_fixture'); const gate = deferred(); state.saveGate = gate.promise;
    await page.getByRole('textbox', { name: 'Cost for PLAN-EPIC' }).fill('7'); await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect.poll(() => state.saveCalls.length).toBe(1); state.remote = true; await lifecycle.returnAfter(13 * 60000); await page.waitForTimeout(100); expect(state.primary).toHaveLength(0);
    gate.resolve(); await expect.poll(() => state.primary.length).toBe(2); expect(state.saveCalls).toHaveLength(1); expect(state.saveCalls[0].cellChanges[0].baseRevision).toBe(1);
});
for (const failure of [409, 'network']) test(`automatic Planning ${failure} save preserves draft until deliberate recovery`, async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page); await page.getByRole('textbox', { name: 'Cost for PLAN-EPIC' }).fill('7'); state.saveStatus = failure;
    await page.getByRole('button', { name: 'Save plan', exact: true }).click(); await expect(page.getByRole('button', { name: 'Load current and discard draft', exact: true })).toBeVisible();
    state.remote = true; await lifecycle.returnAfter(13 * 60000); await page.waitForTimeout(100); expect(state.primary).toHaveLength(0); expect(state.saveCalls).toHaveLength(1);
    await expect(page.getByRole('textbox', { name: 'Cost for PLAN-EPIC' })).toHaveValue('7');
    await page.getByRole('button', { name: 'Load current and discard draft', exact: true }).click(); await expect.poll(() => state.primary.length).toBe(2); expect(state.saveCalls).toHaveLength(1);
});
test('automatic Planning read splits 413 batches with their CSRF reads and no loading surface', async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page); const values = state.values.length; state.remote = true; state.limit = 2;
    const csrf = []; page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/csrf') csrf.push(request); });
    await lifecycle.returnAfter(13 * 60000); await expect.poll(() => state.values.length).toBe(values + 4);
    expect(state.values.slice(values).map(batch => batch.issueIds.length)).toEqual([4, 2, 2, 1]); expect(csrf).toHaveLength(4);
    await expect(page.locator('.planning-review-state-note', { hasText: 'Loading…' })).toHaveCount(0);
});
for (const access of ['capability', 'issue']) test(`automatic Planning accepted ${access} access removal disables review editing`, async ({ page }) => {
    const { lifecycle, state } = await automaticPlanningFixture(page); state.remote = true;
    if (access === 'capability') state.canRead = false; else state.unavailable = ['7001'];
    await lifecycle.returnAfter(13 * 60000); await expect(page.locator('tbody .planning-review-summary').first()).toContainText('Accepted automatic Epic');
    if (access === 'capability') await expect(page.getByRole('textbox', { name: 'Cost for PLAN-EPIC' })).toBeDisabled();
    else { await expect(page.getByRole('textbox', { name: 'Cost for PLAN-EPIC' })).toHaveCount(0); await expect(page.getByLabel('No review value', { exact: true })).toBeVisible(); }
});

test('automatic Planning table retains document anchor, horizontal offset, selection and deliberate read-time scroll', async ({ page }, testInfo) => {
    const { lifecycle, state } = await automaticPlanningFixture(page, { longTable: true }); const { deferred } = require('./eng_epic_refresh_fixture');
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await page.locator('tbody tr[data-issue-key="PLAN-1"]').getByRole('checkbox').check();
    await page.locator('tbody tr[data-issue-key="PLAN-2"]').getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toHaveCount(0);
    const row = page.locator('tbody tr[data-issue-key="PLAN-35"]'); await row.scrollIntoViewIfNeeded();
    const scroller = page.locator('.planning-review-scroll'); await scroller.evaluate(node => { node.scrollLeft = node.scrollWidth - node.clientWidth; }); await page.waitForTimeout(150);
    const node = await row.elementHandle(), before = await row.boundingBox(), left = await scroller.evaluate(node => node.scrollLeft), selection = await page.locator('tbody tr[data-issue-key]').evaluateAll(rows => Object.fromEntries(rows.filter(row => row.querySelector('input[type=checkbox]')).map(row => [row.dataset.issueKey, row.querySelector('input[type=checkbox]').checked])));
    expect(Object.values(selection)).toContain(true); expect(Object.values(selection)).toContain(false);
    expect(selection['PLAN-1']).toBe(true); expect(selection['PLAN-2']).toBe(false);
    state.remote = true; const gate = deferred(); state.readGate = gate.promise; const values = state.values.length;
    await lifecycle.returnAfter(13 * 60000); await expect.poll(() => state.values.length).toBe(values + 1);
    const afterPrimary = await row.boundingBox(); expect(Math.abs(afterPrimary.y - before.y)).toBeLessThanOrEqual(2); expect(await scroller.evaluate(node => node.scrollLeft)).toBe(left);
    await page.mouse.move(1100, 650); await page.mouse.wheel(0, 220); await page.waitForTimeout(150); const deliberate = await page.evaluate(() => window.scrollY);
    await testInfo.attach('planning-table-before-follow-up', { body: await page.screenshot(), contentType: 'image/png' });
    gate.resolve(); await expect.poll(() => state.values.length).toBe(values + 2); await page.waitForTimeout(150);
    await testInfo.attach('planning-table-after-follow-up', { body: await page.screenshot(), contentType: 'image/png' });
    expect(await page.evaluate(() => window.scrollY)).toBe(deliberate); expect(await scroller.evaluate(node => node.scrollLeft)).toBe(left); const retainedSelection = await page.locator('tbody tr[data-issue-key]').evaluateAll(rows => Object.fromEntries(rows.filter(row => row.querySelector('input[type=checkbox]')).map(row => [row.dataset.issueKey, row.querySelector('input[type=checkbox]').checked])));
    for (const [key, checked] of Object.entries(selection)) expect(retainedSelection[key], `surviving Table row ${key}`).toBe(checked);
    expect(await row.evaluate((element, prior) => element === prior, node)).toBe(true);
    await testInfo.attach('planning-table-reading-positions', { body: JSON.stringify({ before: before.y, afterPrimary: afterPrimary.y, left, deliberate, current: await page.evaluate(() => window.scrollY) }), contentType: 'application/json' });
});

test('the priority menu on the last Planning row overlays the table fully on screen without resizing it', async ({page}) => {
    await installPlanningFixture(page,{authMode:'atlassian_oauth'});
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/,route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    const priorities=['Blocker','Critical','Major','Minor','Low','Trivial'].map((name,index)=>({id:String(index+1),name}));
    await page.route('**/api/issues/priorities/options*',route=>json(route,{priorities}));
    await openPlanning(page, { expectStories: false });
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const scroller=page.locator('.planning-review-scroll');
    const trigger=scroller.locator('tbody tr').last().locator('[data-priority-transition-trigger]');
    await trigger.scrollIntoViewIfNeeded();
    const before=await scroller.evaluate(node=>({scrollHeight:node.scrollHeight,clientHeight:node.clientHeight}));
    await trigger.click();
    const menu=page.locator('.priority-transition-menu');
    await expect(menu.getByRole('menuitem')).not.toHaveCount(0);
    await expect(menu).toHaveClass(/is-portalled/);
    expect(await menu.evaluate(node=>node.parentElement===document.body)).toBe(true);
    const box=await menu.boundingBox();
    const viewport=page.viewportSize();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
    expect(await scroller.evaluate(node=>({scrollHeight:node.scrollHeight,clientHeight:node.clientHeight}))).toEqual(before);
    await menu.getByRole('menuitem').first().click();
    await expect(menu).toHaveCount(0);
});

// #267: inherited views per Department group and Sprint. Sprint 4002 inherits the active Sprint's view and 5003 inherits
// 4002's, for every group, until a layout save gives the Sprint its own view. Columns are empty, so nothing else changes.
async function inheritedViewFixture(page, { groups = 2, longTable = false, analytics = false, preferences = null } = {}) {
    const fixture = await installPlanningFixture(page, { groups, longTable, planningLayout: null, scopeTeamIds: ['team-alpha', 'team-beta'] });
    const state = { gets: [], patches: [], patchError: null, own: {}, sources: { [futureSprintId]: { sprintId: String(activeSprintId), viewRevision: 1 }, [secondFutureSprintId]: { sprintId: String(futureSprintId), viewRevision: 2 } }, preferencePosts: [] };
    const sprintOf = request => new URL(request.url()).pathname.split('/')[4];
    const view = (groupId, sprintId) => state.own[`${groupId}:${sprintId}`] ? { viewRevision: state.own[`${groupId}:${sprintId}`], inheritedFrom: null } : { viewRevision: 0, inheritedFrom: state.sources[sprintId] || null };
    if (analytics) await page.route('**/api/analytics/context', route => json(route, { enabled: true }));
    await page.route('**/api/groups-preferences', route => { const payload = requestBody(route.request()); state.preferencePosts.push(payload); return json(route, { preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: payload.visibleGroupIds, activeGroupId: payload.activeGroupId, effectiveVisibleGroupIds: ['group-alpha', 'group-beta'] } }); });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => {
        const request = route.request(), sprintId = sprintOf(request), groupId = reviewGroupOf(request);
        if (request.method() === 'PATCH') {
            const payload = requestBody(request); state.patches.push({ sprintId, groupId, payload });
            if (state.patchError) return json(route, { error: state.patchError }, 400);
            const layouts = Object.fromEntries(payload.schemaChanges.filter(change => change.action === 'layout').map(change => [change.rowKind, { order: change.order, hidden: change.hidden }]));
            if (Object.keys(layouts).length) state.own[`${groupId}:${sprintId}`] = (state.own[`${groupId}:${sprintId}`] || 0) + 1;
            return json(route, { schemaVersion: 1, sprintId, groupId, schemaRevision: 1, columns: [], cells: [], ...(Object.keys(layouts).length ? { layouts, ...view(groupId, sprintId) } : {}) });
        }
        state.gets.push({ sprintId, groupId });
        return json(route, { schemaVersion: 1, sprintId, groupId, schemaRevision: 1, columns: [], layouts: {}, ...view(groupId, sprintId), capabilities: { canRead: true, canSave: true } });
    });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => json(route, { cells: [], unavailableIssueIds: [] }));
    return { fixture, state };
}
const hintLine = page => page.locator('.planning-review-hint');
const selectSprint = async (page, name) => { await page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle').click(); await page.locator('.sprint-dropdown-option', { hasText: name }).click(); };
const selectGroup = async (page, name) => { await page.locator('.view-selector .group-dropdown-toggle').click(); await page.locator('.view-selector .group-dropdown-option', { hasText: name }).click(); };
const savedPrefs = page => page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'));
const lastGet = state => state.gets.at(-1);

test('the inherited-view hint names its source Sprint; its dismissal survives Sprint and group switches and reload, and returns when the source is re-saved', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { state } = await inheritedViewFixture(page);
    await openPlanning(page, { expectStories: false });
    await expect(hintLine(page)).toHaveText(`Layout inherited from ${activeSprintName}.`);
    expect(lastGet(state)).toEqual({ sprintId: String(futureSprintId), groupId: 'group-alpha' });
    await page.getByRole('button', { name: 'Dismiss layout hint', exact: true }).click();
    await expect(hintLine(page)).toHaveCount(0);
    await expect.poll(async () => (await savedPrefs(page)).planningInheritedHintDismissals).toEqual({ [`${futureSprintId}:group-alpha`]: { sourceSprintId: String(activeSprintId), viewRevision: 1 } });
    // Another Sprint has its own hint; coming back keeps this one dismissed.
    await selectSprint(page, secondFutureSprintName);
    await expect(hintLine(page)).toHaveText(`Layout inherited from ${futureSprintName}.`);
    await selectSprint(page, futureSprintName);
    await expect.poll(() => lastGet(state)).toEqual({ sprintId: String(futureSprintId), groupId: 'group-alpha' });
    await expect(page.locator('.planning-review-table')).toBeVisible(); await expect(hintLine(page)).toHaveCount(0);
    // Another group has its own hint for the same Sprint.
    await selectGroup(page, 'Beta Department');
    await expect.poll(() => lastGet(state)).toEqual({ sprintId: String(futureSprintId), groupId: 'group-beta' });
    await expect(hintLine(page)).toHaveText(`Layout inherited from ${activeSprintName}.`);
    await selectGroup(page, 'Alpha Department');
    await expect.poll(() => lastGet(state)).toEqual({ sprintId: String(futureSprintId), groupId: 'group-alpha' });
    await expect(hintLine(page)).toHaveCount(0);
    // A reload keeps the dismissal (no init script rewrites the saved preferences here).
    const gets = state.gets.length;
    await page.reload(); await expect(page.locator('.planning-review-table')).toBeVisible();
    await expect.poll(() => state.gets.length).toBeGreaterThan(gets);
    expect(lastGet(state)).toEqual({ sprintId: String(futureSprintId), groupId: 'group-alpha' });
    await expect(page.locator('.planning-review-state-note', { hasText: 'Loading…' })).toHaveCount(0);
    await expect(hintLine(page)).toHaveCount(0);
    // Re-saving the source Sprint's view brings the hint back.
    state.sources[futureSprintId] = { sprintId: String(activeSprintId), viewRevision: 2 };
    await page.reload(); await expect(page.locator('.planning-review-table')).toBeVisible();
    await expect(hintLine(page)).toHaveText(`Layout inherited from ${activeSprintName}.`);
});

for (const width of [1280, 390]) test(`the docked table header stays below the sticky stack with the hint shown and after it is dismissed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // 390px uses the one-group fixture: with two visible groups the compact header's search covers Catch Up (docs/TODO.md).
    await inheritedViewFixture(page, { groups: width === 390 ? 1 : 2, longTable: true });
    await openPlanning(page, { expectStories: false });
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const scroll = page.locator('.planning-review-scroll'), stack = page.locator('.planning-review-sticky-stack'), heading = page.locator('.planning-review-docked-header');
    const gap = async () => { const h = await heading.boundingBox(), s = await stack.boundingBox(); return Math.abs(h.y - s.y - s.height); };
    for (const state of ['shown', 'dismissed']) {
        await page.evaluate(() => scrollTo(0, 0));
        if (state === 'shown') await expect(hintLine(page)).toHaveCount(1);
        else { await page.getByRole('button', { name: 'Dismiss layout hint', exact: true }).click(); await expect(hintLine(page)).toHaveCount(0); }
        const hintGeometry = state === 'shown' ? await hintLine(page).evaluate(node => { const r = node.getBoundingClientRect(), s = document.querySelector('.planning-review-scroll').getBoundingClientRect(); return { height: Math.round(r.height), above: r.bottom <= s.top, inside: r.left >= 0 && r.right <= innerWidth }; }) : null;
        if (hintGeometry) expect(hintGeometry).toEqual({ height: 24, above: true, inside: true });
        await scroll.evaluate(node => scrollTo(0, scrollY + node.getBoundingClientRect().top + 250));
        await expect(heading).toBeVisible();
        await expect.poll(gap, state).toBeLessThan(2);
        await page.screenshot({ path: `tmp/267-ui/dashboard-docked-hint-${state}-${width}.png`, fullPage: false, animations: 'disabled' });
    }
});

test('a header group change while the review is dirty prompts: Stay keeps the draft and reports nothing, Discard and Save proceed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { state } = await inheritedViewFixture(page, { analytics: true });
    await openPlanning(page, { expectStories: false });
    const groupEvents = () => page.evaluate(() => (window.dataLayer || []).filter(entry => entry?.event_name === 'filter_changed' && entry?.filter_type === 'group').length);
    const dialog = page.getByRole('dialog', { name: 'Save this plan?' });
    const save = page.getByRole('button', { name: 'Save plan', exact: true });
    const addColumn = async label => { await page.getByRole('button', { name: '+ Add column', exact: true }).click(); await page.getByLabel('Column name', { exact: true }).fill(label); await page.getByRole('button', { name: 'Add column', exact: true }).click(); await expect(save).toBeEnabled(); };
    await addColumn('Local column');
    const events = await groupEvents();
    await selectGroup(page, 'Beta Department');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Save or discard all pending Team changes before leaving this scope.');
    await expect(dialog).toContainText('shared review columns and values span Sprints');
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.view-selector .group-dropdown-toggle')).toContainText('Alpha Department');
    await expect(save).toBeEnabled();
    expect(await groupEvents()).toBe(events);
    expect(state.gets.filter(get => get.groupId === 'group-beta')).toHaveLength(0);
    // Discard proceeds to the other group and reports the change once.
    await selectGroup(page, 'Beta Department');
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.locator('.view-selector .group-dropdown-toggle')).toContainText('Beta Department');
    await expect.poll(() => lastGet(state)?.groupId).toBe('group-beta');
    await expect(save).toHaveCount(0);
    expect(await groupEvents()).toBe(events + 1);
    expect(state.patches).toHaveLength(0);
    // Save proceeds and saves the draft under the group it was made in.
    await addColumn('Beta column');
    await selectGroup(page, 'Alpha Department');
    await dialog.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.locator('.view-selector .group-dropdown-toggle')).toContainText('Alpha Department');
    expect(state.patches.map(patch => patch.groupId)).toEqual(['group-beta']);
    expect(state.patches[0].payload.groupId).toBe('group-beta');
    await expect.poll(() => lastGet(state)?.groupId).toBe('group-alpha');
    expect(await groupEvents()).toBe(events + 2);
});

test('a Settings Save that changes the active group while the review is dirty prompts; Stay sends no preference write and keeps Settings open', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { state } = await inheritedViewFixture(page);
    await openPlanning(page, { expectStories: false });
    await page.getByRole('button', { name: '+ Add column', exact: true }).click(); await page.getByLabel('Column name', { exact: true }).fill('Local column'); await page.getByRole('button', { name: 'Add column', exact: true }).click();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const settings = page.locator('.group-modal');
    await settings.locator('.group-list-item', { hasText: 'Beta Department' }).click();
    await settings.locator('.group-list-item.active').getByRole('button', { name: 'Set Beta Department as your favorite Department' }).click();
    await settings.getByRole('button', { name: /^Save$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Save this plan?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Settings were not saved: the Planning review has unsaved changes.')).toBeVisible();
    expect(state.preferencePosts).toHaveLength(0);
    // Discard lets the same Save proceed.
    await settings.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect.poll(() => state.preferencePosts.length).toBe(1);
    expect(state.preferencePosts[0].activeGroupId).toBe('group-beta');
    await expect.poll(() => lastGet(state)?.groupId).toBe('group-beta');
    expect(state.patches).toHaveLength(0);
});

// AC 14 (UI half). The id reuse itself (add "New Group", rename, delete, add again from the default flow gives `new-group`
// again) is pinned in node by tests/test_planning_sprint_review.js on buildGroupId; this drives the catalog through the
// same states and proves the review reads and writes follow the group id, not its name or a visibility preference.
test('a re-created group id reattaches its review columns and values, and hiding the group from the selector does not stop reads or writes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const base = { version: 1, source: 'workspace_db', defaultGroupId: 'group-alpha', configRevision: 1 };
    const alpha = { id: 'group-alpha', name: 'Alpha Department', teamIds: ['team-alpha'], labels: ['alpha_label'], excludedCapacityEpics: [] };
    const slot = name => ({ id: 'new-group', name, teamIds: ['team-alpha'], labels: ['alpha_label'], excludedCapacityEpics: [] });
    const preferences = (visibleGroupIds, effective) => ({ onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], customized: visibleGroupIds.length > 0, visibleGroupIds, effectiveVisibleGroupIds: effective, activeGroupId: 'group-alpha' });
    let catalog = { ...base, groups: [alpha, slot('Platform')], preferences: preferences([], ['group-alpha', 'new-group']) };
    const gets = [], patches = [];
    await installPlanningFixture(page, { planningLayout: null, scopeTeamIds: ['team-alpha', 'team-beta'] });
    await page.route('**/api/groups-config', route => route.request().method() === 'GET' ? json(route, catalog) : route.fallback());
    const risk = { id: 'risk', rowKind: 'epic', label: 'Risk', type: 'number', aggregation: 'sum', archived: false, order: 0 };
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => {
        const request = route.request(), groupId = reviewGroupOf(request);
        if (request.method() === 'PATCH') { const payload = requestBody(request); patches.push(payload); return json(route, { schemaVersion: 1, groupId, schemaRevision: 1, columns: groupId === 'new-group' ? [risk] : [], cells: payload.cellChanges.map(cell => ({ ...cell, revision: 2 })) }); }
        gets.push(groupId);
        return json(route, { schemaVersion: 1, groupId, schemaRevision: 1, viewRevision: 0, inheritedFrom: null, columns: groupId === 'new-group' ? [risk] : [], layouts: {}, capabilities: { canRead: true, canSave: true } });
    });
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review\/values\/read(?:\?.*)?$/, route => { const body = requestBody(route.request()); return json(route, { cells: body.groupId === 'new-group' && body.rowKind === 'epic' ? [{ issueId: '7001', rowKind: 'epic', columnId: 'risk', value: '5', revision: 1 }] : [], unavailableIssueIds: [] }); });
    const riskCell = page.getByRole('textbox', { name: 'Risk for PLAN-EPIC', exact: true });
    await openPlanning(page, { expectStories: false });
    // The renamed creation slot ("Platform", id new-group) holds a Risk value.
    await selectGroup(page, 'Platform');
    await expect(riskCell).toHaveValue('5');
    expect(gets.at(-1)).toBe('new-group');
    // Deleted: the review never asks for it.
    catalog = { ...catalog, configRevision: 2, groups: [alpha], preferences: preferences([], ['group-alpha']) };
    await page.reload(); await expect(page.locator('.planning-review-table')).toBeVisible();
    await expect.poll(() => gets.at(-1)).toBe('group-alpha');
    const afterDelete = gets.length;
    // Re-created from the default flow: the same id under the default name reads the same columns and values.
    catalog = { ...catalog, configRevision: 3, groups: [alpha, slot('New Group')], preferences: preferences([], ['group-alpha', 'new-group']) };
    await page.reload(); await expect(page.locator('.planning-review-table')).toBeVisible();
    expect(gets.slice(afterDelete)).not.toContain('new-group');
    await selectGroup(page, 'New Group');
    await expect(riskCell).toHaveValue('5');
    expect(gets.at(-1)).toBe('new-group');
    await riskCell.fill('6'); await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0].groupId).toBe('new-group');
    // A visibility preference hiding the other group from the selector does not change which group the review reads and writes.
    catalog = { ...catalog, configRevision: 4, preferences: { ...preferences(['new-group'], ['new-group']), activeGroupId: 'new-group' } };
    const beforeHide = gets.length;
    await page.reload(); await expect(page.locator('.planning-review-table')).toBeVisible();
    await expect.poll(() => gets.length).toBeGreaterThan(beforeHide);
    expect(gets.slice(beforeHide)).not.toContain('group-alpha');
    await expect(riskCell).toHaveValue('6');
    expect(gets.at(-1)).toBe('new-group');
    await riskCell.fill('7'); await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1].groupId).toBe('new-group');
});
