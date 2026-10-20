const { expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

const SPRINT_ID = 3001;
const SPRINT_NAME = '2026Q2 Sprint 42';
const GROUP_ID = 'group-alpha';
const LONG_ASSIGNEE = 'Alexandrina Featherstonehaugh-Villanueva';
const EPIC_ONE_STORY_COUNT = 12;

// One Promise the test resolves by hand; used to hold a response until the test releases it.
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function sprintRef() {
    return [{ id: SPRINT_ID, name: SPRINT_NAME, state: 'active' }];
}

// A story payload row as /api/tasks-with-team-name returns it. `projectKey` 'TECH' puts the story in
// the tech lane, anything else in the product lane.
function buildStory(key, epicKey, {
    status = 'To Do',
    summary = `${key} synthetic story`,
    points = 1,
    assignee = 'Story Owner',
    priority = 'Major',
    projectKey = 'PROD',
    updated = '2026-05-01T00:00:00.000+0000',
    subtasks = false,
} = {}) {
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: priority },
            issuetype: { name: 'Story' },
            assignee: assignee ? { displayName: assignee } : null,
            updated,
            customfield_10004: points,
            epicKey,
            parentSummary: `${epicKey} synthetic epic`,
            projectKey,
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: sprintRef(),
            subtaskSummary: subtasks
                ? { total: 2, done: 0, inProgress: 1, waiting: 1, percentComplete: 0, statusCounts: { 'To Do': 1, 'In Progress': 1 } }
                : null,
        },
    };
}

function buildEpic(key, { summary = `${key} synthetic epic`, status = 'In Progress', assignee = 'Epic Lead', initiative = null } = {}) {
    const epic = {
        key,
        summary,
        status: { name: status },
        assignee: assignee ? { displayName: assignee } : null,
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: sprintRef(),
    };
    if (initiative) epic.initiative = initiative;
    return epic;
}

// Three epics: EPIC-1 (direct, long assignee, 12 stories), EPIC-2 (grouped under INIT-1, 2 stories),
// EPIC-3 (direct, 1 story). `scenario.epics` is keyed by epic key; `scenario.stories` is the flat
// server-side story list. Tests mutate both between page load and click to model a server change.
function buildScenario() {
    const epics = {
        'EPIC-1': buildEpic('EPIC-1', { summary: 'Direct epic with a long assignee and many stories', assignee: LONG_ASSIGNEE }),
        'EPIC-2': buildEpic('EPIC-2', { summary: 'Initiative grouped epic', assignee: 'Beatrix Lead', initiative: { key: 'INIT-1', summary: 'Synthetic initiative' } }),
        'EPIC-3': buildEpic('EPIC-3', { summary: 'Second direct epic', assignee: 'Cormac Lead' }),
    };
    const stories = [];
    for (let index = 1; index <= EPIC_ONE_STORY_COUNT; index += 1) {
        const key = `E1-S${String(index).padStart(2, '0')}`;
        stories.push(buildStory(key, 'EPIC-1', { points: index % 3 + 1, subtasks: index === 1 }));
    }
    stories.push(buildStory('E2-S01', 'EPIC-2', { points: 2 }), buildStory('E2-S02', 'EPIC-2', { status: 'In Progress', points: 3 }));
    stories.push(buildStory('E3-S01', 'EPIC-3', { points: 1 }));
    return { epics, stories };
}

const storyKeysOf = (scenario, epicKey) => scenario.stories.filter(story => story.fields.epicKey === epicKey).map(story => story.key);

function subtaskPayload(parentKey) {
    return {
        parentKey,
        sprint: String(SPRINT_ID),
        cached: false,
        summary: { total: 2, done: 0, inProgress: 1, waiting: 1, percentComplete: 0, statusCounts: { 'To Do': 1, 'In Progress': 1 } },
        subtasks: [
            { id: `${parentKey}-A`, key: `${parentKey}-A`, summary: 'Subtask A', status: { name: 'To Do' }, assignee: { displayName: 'Sub Owner' }, updated: '2026-05-01T00:00:00.000+0000' },
            { id: `${parentKey}-B`, key: `${parentKey}-B`, summary: 'Subtask B', status: { name: 'In Progress' }, assignee: { displayName: 'Sub Owner' }, updated: '2026-05-02T00:00:00.000+0000' },
        ],
    };
}

const groupsConfigPayload = {
    version: 1,
    configRevision: 1,
    source: 'workspace_db',
    defaultGroupId: GROUP_ID,
    groups: [{ id: GROUP_ID, name: 'Alpha Department', teamIds: ['team-alpha'], labels: ['alpha_label'], excludedCapacityEpics: [] }],
    preferences: {
        onboardingRequired: false,
        onboardingDone: true,
        completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
        customized: false,
        visibleGroupIds: [],
        effectiveVisibleGroupIds: [GROUP_ID],
        activeGroupId: GROUP_ID,
    },
};

// Installs the dashboard shell and every /api stub. Returns:
//   calls                       every /api request: { method, pathname, search, body, params }
//   respond(pattern, handler)   override one route; the newest override wins. `pattern` is a function
//                               (call) => boolean, a RegExp tested against pathname+search, or a
//                               string contained in pathname+search. `handler({ route, call, json,
//                               status })` returns a fulfilled route promise to answer, or undefined to
//                               fall through to the next override and then the default. Returns a
//                               function that removes the override.
//   scenario                    the mutable server state (see buildScenario)
//   refreshCalls()              the purpose=epic-refresh task requests
//   defaults                    { body(call) } the default JSON body for an epic-refresh/initial load
async function mockDashboard(page, { scenario = buildScenario() } = {}) {
    const calls = [];
    const overrides = [];
    await installDashboardShell(page);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let body = null;
        try { body = request.postData() ? JSON.parse(request.postData()) : null; } catch (_error) { body = null; }
        const call = {
            method: request.method(),
            pathname: url.pathname,
            search: url.search,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
        };
        calls.push(call);
        let answered = false;
        const json = (payload, statusCode = 200) => {
            answered = true;
            return route.fulfill({
                status: statusCode,
                contentType: 'application/json',
                body: JSON.stringify(payload),
            });
        };
        const status = (statusCode, payload = {}) => json(payload, statusCode);

        const target = `${call.pathname}${call.search}`;
        for (const override of overrides) {
            const matches = typeof override.pattern === 'function'
                ? override.pattern(call)
                : override.pattern instanceof RegExp ? override.pattern.test(target) : target.includes(override.pattern);
            if (!matches) continue;
            const handled = await override.handler({ route, call, json, status });
            if (handled !== undefined || answered) return handled;
        }
        return defaultResponse(route, call, json, scenario);
    });
    return {
        calls,
        scenario,
        respond(pattern, handler) {
            const override = { pattern, handler };
            overrides.unshift(override);
            return () => { const index = overrides.indexOf(override); if (index >= 0) overrides.splice(index, 1); };
        },
        refreshCalls: () => calls.filter(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === 'epic-refresh'),
    };
}

// The default stub for one request. Epic-refresh returns the epic's stories (per lane) plus `epics`;
// every other task request returns the full scope (product lane) or nothing (tech, alerts, ready-to-close).
function defaultResponse(route, call, json, scenario) {
    const { pathname, params } = call;
    if (pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
    if (pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
    if (pathname === '/api/auth/status') return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
    if (pathname === '/api/me/connections/home-token') return json({ connected: false, provider: 'atlassian_user_api_token', status: 'missing', needsReconnect: false });
    if (pathname === '/api/config') {
        return json({
            jiraUrl: 'https://jira.example',
            capacityProject: '',
            authMode: 'atlassian_oauth',
            projectsConfigured: true,
            userCanEditSettings: true,
            environmentConfigExists: true,
        });
    }
    if (pathname === '/api/version') return json({ enabled: false });
    if (pathname === '/api/groups-config') return json(groupsConfigPayload);
    if (pathname === '/api/projects/selected') return json({ selected: [] });
    if (pathname === '/api/board-config') return json({ boardId: '101', boardName: 'Synthetic Board', source: 'test' });
    if (pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
    if (pathname === '/api/sprints') return json({ sprints: [{ id: SPRINT_ID, name: SPRINT_NAME, state: 'active', startDate: '2026-05-01' }] });
    if (pathname === '/api/tasks-with-team-name') return json(taskPayload(params, scenario));
    if (pathname === '/api/eng/story-readiness') return json({ schemaVersion: 1, complete: true, scope: { groupId: GROUP_ID, sprintId: String(SPRINT_ID), sprintName: SPRINT_NAME, sprintState: 'active' }, epics: [] });
    if (pathname === '/api/issues/subtasks') return json(subtaskPayload(params.parentKey));
    if (pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
    if (pathname === '/api/backlog-epics') return json({ epics: [] });
    if (pathname === '/api/dependencies') return json({ dependencies: {} });
    if (pathname === '/api/analytics/context') return json({ enabled: false });
    if (pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
    if (pathname === '/api/issues/transitions/options') {
        return json({
            issues: (call.body?.issueKeys || []).map(key => ({ key, issueType: 'Story', currentStatus: 'To Do', transitions: [] })),
            targetStatuses: [
                { name: 'In Progress', availableCount: 1, blockedCount: 0 },
                { name: 'Done', availableCount: 1, blockedCount: 0 },
            ],
        });
    }
    if (pathname === '/api/issues/transitions' && call.method === 'POST') {
        const keys = call.body?.issueKeys || [];
        const targetStatus = call.body?.targetStatus || '';
        return json({
            requested: keys.length,
            succeeded: keys.length,
            failed: 0,
            targetStatus,
            results: keys.map(key => ({ key, result: 'success', fromStatus: 'To Do', toStatus: targetStatus })),
        });
    }
    return json({ error: `Unexpected ${call.method} ${pathname}` }, 404);
}

function taskPayload(params, scenario) {
    const lane = params.project === 'tech' ? 'tech' : 'product';
    const inLane = story => (story.fields.projectKey === 'TECH') === (lane === 'tech');
    if (params.purpose === 'epic-refresh') {
        const epicKey = params.epicKeys;
        const issues = scenario.stories.filter(story => story.fields.epicKey === epicKey && inLane(story));
        const epic = scenario.epics[epicKey];
        return {
            issues,
            epics: issues.length && epic ? { [epicKey]: epic } : {},
            epicsInScope: issues.length && epic ? [epic] : [],
            names: {},
            capped: false,
            epicKeysMissing: [],
        };
    }
    if (params.purpose === 'alerts' || params.purpose === 'ready-to-close' || params.purpose === 'epic-alerts') {
        return { issues: [], epics: {}, epicsInScope: [], names: {} };
    }
    const epics = Object.values(scenario.epics);
    return { issues: scenario.stories.filter(inLane), epics: scenario.epics, epicsInScope: epics, names: {} };
}

function catchUpPrefs(extra = {}) {
    return {
        selectedView: 'eng',
        selectedSprint: SPRINT_ID,
        sprintName: SPRINT_NAME,
        activeGroupId: GROUP_ID,
        showPlanning: false,
        // These cases exercise the per-epic refresh buttons on the epic list; Planning defaults to the Table, which has no epic headers.
        planningLayout: 'list',
        showStats: false,
        showScenario: false,
        ...extra,
    };
}

// Opens Catch Up and waits until every epic and the first epic's last story are rendered.
async function openCatchUp(page, ctx, { width, height, prefs } = {}) {
    if (width || height) await page.setViewportSize({ width: width || 1400, height: height || 1000 });
    await page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value));
    }, catchUpPrefs(prefs));
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
    for (const epicKey of Object.keys(ctx.scenario.epics)) {
        await expect(page.locator(`.epic-block[data-epic-key="${epicKey}"]`)).toBeVisible();
    }
    await expect(page.locator('.task-item[data-task-key="E1-S12"]')).toBeAttached();
}

const epicBlock = (page, epicKey) => page.locator(`.epic-block[data-epic-key="${epicKey}"]`);
const epicHeader = (page, epicKey) => epicBlock(page, epicKey).locator('> .epic-header, .epic-header').first();
const refreshButton = (page, epicKey) => page.locator(`.epic-refresh-button[data-epic-refresh="${epicKey}"]`);
const taskCard = (page, key) => page.locator(`.task-item[data-task-key="${key}"]`);
const statusRegion = page => page.locator('[data-epic-refresh-status]');

// Parks the pointer on a neutral spot (bottom-left of the viewport) so no header is hovered.
async function parkPointer(page) {
    const size = page.viewportSize();
    await page.mouse.move(2, size.height - 2);
}

// Moves the real pointer over the header. Locator.hover() would scroll a sticky-stacked header into
// "view" first, which changes the scroll position the tests assert on.
async function hoverHeader(page, epicKey, { atButton = false } = {}) {
    // Off-screen (or under the sticky stack, ~150 px): bring it to 40% of the viewport first. The loop re-measures because the page
    // re-anchors after a programmatic scroll and the Planning stack (panel + filter bar, 260-470 px) is only measurable once it is stuck.
    const attempts = await page.locator('.planning-panel.open').count() ? 4 : 1; // Catch Up keeps its single scroll
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const scrolled = await epicHeader(page, epicKey).evaluate((node) => {
            const top = node.getBoundingClientRect().top;
            const stack = document.querySelector('.planning-panel.open')
                ? Math.max(...['.planning-panel.open', '.filterbar-wrap'].map(selector => document.querySelector(selector)?.getBoundingClientRect().bottom || 0)) + 20
                : 170;
            if (top >= stack && top <= window.innerHeight - 80) return false;
            window.scrollBy(0, top - Math.min(window.innerHeight * 0.6, Math.max(window.innerHeight * 0.4, stack + 60)));
            return true;
        });
        if (!scrolled) break;
        // The page re-anchors itself once after a programmatic scroll (compact header): wait until it settles.
        await expect.poll(async () => {
            const first = await page.evaluate(() => window.scrollY);
            await page.waitForTimeout(200);
            return first === await page.evaluate(() => window.scrollY);
        }).toBe(true);
    }
    const box = await epicHeader(page, epicKey).boundingBox();
    // `atButton` parks the pointer on the refresh button's corner: nothing else in the header (e.g. the Planning stat toggle) reacts to it.
    await page.mouse.move(atButton ? box.x + box.width - 18 : box.x + box.width * 0.4, atButton ? box.y + 16 : box.y + box.height / 2);
}

// Hovers the header (the button is pointer-events:none at rest) and returns the now-visible button.
async function revealRefreshButton(page, epicKey) {
    await hoverHeader(page, epicKey);
    const button = refreshButton(page, epicKey);
    await expect.poll(() => button.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    return button;
}

function epicRefreshCalls(calls) {
    return calls.filter(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === 'epic-refresh');
}

// Every request issued after `since` (an index into ctx.calls) must carry epicKeys=<epicKey> or be on the
// allowlist: POST /api/dependencies with only that epic's keys, and subtask reloads for that epic's stories.
function assertScopedCalls(calls, since, epicKey, storyKeys) {
    const owned = new Set([epicKey, ...storyKeys]);
    const offenders = calls.slice(since).filter((call) => {
        if (call.params.epicKeys === epicKey) return false;
        if (call.method === 'POST' && call.pathname === '/api/dependencies') return !(call.body?.keys || []).every(key => owned.has(key));
        if (call.pathname === '/api/issues/subtasks') return !owned.has(call.params.parentKey);
        return true;
    });
    expect(offenders.map(call => `${call.method} ${call.pathname}${call.search}`)).toEqual([]);
}

// Test-only browser lifecycle and clock controls, installed before navigation.
async function installLifecycleControl(page) {
    await page.addInitScript(() => {
        const baseline = Date.now();
        let offsetMs = 0;
        let focused = true;
        let visibility = 'visible';
        Date.now = () => baseline + offsetMs;
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
        window.__freshnessLifecycle = {
            advance(ms) { offsetMs += ms; },
            setState(state) {
                const nextFocused = state === 'focused';
                const nextVisibility = state === 'hidden' ? 'hidden' : 'visible';
                const focusChanged = nextFocused !== focused;
                const visibilityChanged = nextVisibility !== visibility;
                focused = nextFocused;
                visibility = nextVisibility;
                if (focusChanged) window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
                if (visibilityChanged) document.dispatchEvent(new Event('visibilitychange'));
            },
            returnAfter(ms) {
                const absenceStartedAtMs = Date.now();
                offsetMs += ms;
                window.dispatchEvent(new CustomEvent('jep:auth-long-absence-return', {
                    detail: { unfocusedMs: ms, absenceStartedAtMs, observedAtMs: Date.now() },
                }));
            },
        };
    });
    return {
        advance: ms => page.evaluate(ms => window.__freshnessLifecycle.advance(ms), ms),
        setState: state => page.evaluate(state => window.__freshnessLifecycle.setState(state), state),
        returnAfter: ms => page.evaluate(ms => window.__freshnessLifecycle.returnAfter(ms), ms),
    };
}

module.exports = {
    appBaseUrl, SPRINT_ID, SPRINT_NAME, GROUP_ID, EPIC_ONE_STORY_COUNT, deferred, buildStory, buildEpic, buildScenario, storyKeysOf, groupsConfigPayload, mockDashboard, taskPayload, catchUpPrefs, openCatchUp, epicBlock, epicHeader, refreshButton, taskCard, statusRegion, parkPointer, hoverHeader, revealRefreshButton, epicRefreshCalls, assertScopedCalls, installLifecycleControl,
};
