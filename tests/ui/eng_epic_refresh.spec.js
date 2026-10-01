const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    installDashboardFixture,
    installDashboardShell,
    selectedSprintId: epmSprintId,
    selectedSprintName: epmSprintName,
} = require('./epm_home_token_fixture');

// Per-epic refresh (issue #213), Catch Up. The shell serves the pre-built frontend/dist/*, so run
// `npm run build` first. Parts 2 and 3 of this spec append below the final marker and reuse the
// helpers in the fixture section (they are plain functions in this file, not exported modules).

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

// reducedMotion is explicit: the glare tests (later parts) need real animations, and other board
// specs force 'reduce'. The viewport leaves room for the cap-8 test (a story card is about 74 px).
test.use({ reducedMotion: 'no-preference', viewport: { width: 1400, height: 1000 } });

// ---- fixture ----

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
    if (params.purpose === 'alerts' || params.purpose === 'ready-to-close' || params.purpose === 'epic-alerts' || lane === 'tech') {
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
async function hoverHeader(page, epicKey) {
    // Off-screen (or under the sticky stack, ~150 px): bring it to 40% of the viewport first.
    const scrolled = await epicHeader(page, epicKey).evaluate((node) => {
        const top = node.getBoundingClientRect().top;
        if (top >= 170 && top <= window.innerHeight - 80) return false;
        window.scrollBy(0, top - window.innerHeight * 0.4);
        return true;
    });
    if (scrolled) {
        // The page re-anchors itself once after a programmatic scroll (compact header): wait until it settles.
        await expect.poll(async () => {
            const first = await page.evaluate(() => window.scrollY);
            await page.waitForTimeout(200);
            return first === await page.evaluate(() => window.scrollY);
        }).toBe(true);
    }
    const box = await epicHeader(page, epicKey).boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
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

// ---- tests 1-8 ----

test('1. the refresh button is hidden at rest and shows on header hover and keyboard focus', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    await parkPointer(page);
    const button = refreshButton(page, 'EPIC-1');
    await expect(button).toHaveCount(1);

    const rest = await button.evaluate(node => { const style = getComputedStyle(node); return { opacity: style.opacity, pointerEvents: style.pointerEvents }; });
    expect(rest).toEqual({ opacity: '0', pointerEvents: 'none' });

    // Keyboard: tab forward from the epic status pill until the button takes focus; focus-within reveals it.
    await epicHeader(page, 'EPIC-1').locator('[data-status-transition-trigger]').first().focus();
    for (let step = 0; step < 6; step += 1) {
        if (await button.evaluate(node => node === document.activeElement)) break;
        await page.keyboard.press('Tab');
    }
    await expect(button).toBeFocused();
    await expect.poll(() => button.evaluate(node => { const style = getComputedStyle(node); return `${style.opacity}/${style.pointerEvents}`; })).toBe('1/auto');
    await button.blur();
    await parkPointer(page);
    await expect.poll(() => button.evaluate(node => getComputedStyle(node).opacity)).toBe('0');

    // Pointer: hover reveals it and a normal (not forced) click reaches the handler.
    await hoverHeader(page, 'EPIC-1');
    await expect.poll(() => button.evaluate(node => { const style = getComputedStyle(node); return `${style.opacity}/${style.pointerEvents}`; })).toBe('1/auto');
    await button.click();
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
});

test.describe('touch', () => {
    test.use({ hasTouch: true });

    test('2. the refresh button is visible at rest where hover is unavailable', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        await parkPointer(page);
        expect(await page.evaluate(() => window.matchMedia('(hover: none)').matches)).toBe(true);
        const state = await refreshButton(page, 'EPIC-1').evaluate(node => { const style = getComputedStyle(node); return { opacity: style.opacity, pointerEvents: style.pointerEvents }; });
        expect(state).toEqual({ opacity: '1', pointerEvents: 'auto' });
    });
});

// Rects of the header's direct children, rounded away from sub-pixel noise only by exact comparison.
async function headerGeometry(header) {
    return header.evaluate((node) => {
        const rectOf = (element) => {
            const rect = element.getBoundingClientRect();
            return [rect.left, rect.top, rect.width, rect.height];
        };
        const button = node.querySelector('.epic-refresh-button');
        const buttonRect = button.getBoundingClientRect();
        const headerRect = node.getBoundingClientRect();
        return {
            title: [...node.querySelectorAll('.epic-title-row > *')].map(rectOf),
            meta: [...node.querySelectorAll('.epic-meta > *')].map(rectOf),
            header: rectOf(node),
            overflow: node.scrollWidth - node.clientWidth,
            buttonInside: buttonRect.left >= headerRect.left && buttonRect.right <= headerRect.right
                && buttonRect.top >= headerRect.top && buttonRect.bottom <= headerRect.bottom,
        };
    });
}

for (const width of [1280, 1024, 390]) {
    test(`3. header geometry is identical with the button shown and hidden at ${width}px`, async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width, height: width === 390 ? 844 : 1000 });
        // EPIC-1 is a direct epic, EPIC-2 is grouped under an initiative.
        await expect(page.locator('.initiative-body > .epic-block[data-epic-key="EPIC-2"]')).toHaveCount(1);
        await expect(page.locator('.initiative-body > .epic-block[data-epic-key="EPIC-1"]')).toHaveCount(0);
        for (const epicKey of ['EPIC-1', 'EPIC-2']) {
            const header = epicHeader(page, epicKey);
            await header.scrollIntoViewIfNeeded();
            await parkPointer(page);
            await expect.poll(() => refreshButton(page, epicKey).evaluate(node => getComputedStyle(node).opacity)).toBe('0');
            const hidden = await headerGeometry(header);
            await hoverHeader(page, epicKey);
            await expect.poll(() => refreshButton(page, epicKey).evaluate(node => getComputedStyle(node).opacity)).toBe('1');
            const shown = await headerGeometry(header);
            expect(hidden.title.length, `${epicKey} title row has children`).toBeGreaterThan(0);
            expect(hidden.meta.length, `${epicKey} meta has children`).toBeGreaterThan(0);
            expect(shown.title, `${epicKey} title row children`).toEqual(hidden.title);
            expect(shown.meta, `${epicKey} meta children`).toEqual(hidden.meta);
            expect(shown.header, `${epicKey} header box`).toEqual(hidden.header);
            expect(shown.overflow, `${epicKey} header overflow`).toBeLessThanOrEqual(1);
            expect(shown.buttonInside, `${epicKey} button inside header`).toBe(true);
        }
        if (width === 390) {
            // The 760px-and-below padding rule is scoped to headers that own a refresh button.
            const paddings = await page.evaluate(() => {
                const withButton = document.querySelector('.epic-header:has(> .epic-refresh-button) .epic-title-row');
                const probe = document.createElement('div');
                probe.className = 'epic-header';
                probe.innerHTML = '<div class="epic-title-row">EPM-shaped header</div>';
                document.body.appendChild(probe);
                const without = getComputedStyle(probe.querySelector('.epic-title-row')).paddingRight;
                probe.remove();
                return { withButton: getComputedStyle(withButton).paddingRight, without };
            });
            expect(paddings).toEqual({ withButton: '32px', without: '0px' });
        }
    });
}

// Text-bearing measurements for the header with the button revealed. Painted text is measured with a Range
// (clipped to the element's own box), never with container boxes.
async function titleVersusButton(header) {
    return header.evaluate((node) => {
        const paintedRight = (element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return Math.min(range.getBoundingClientRect().right, element.getBoundingClientRect().right);
        };
        const buttonNode = node.querySelector('.epic-refresh-button');
        const buttonRect = buttonNode.getBoundingClientRect();
        const titleRow = node.querySelector('.epic-title-row');
        const rowRect = titleRow.getBoundingClientRect();
        const children = [...titleRow.children].map(child => ({
            name: String(child.className || child.tagName),
            right: paintedRight(child),
        }));
        const link = titleRow.querySelector('.epic-link');
        const assignee = node.querySelector('.epic-assignee-value .issue-person-editor-trigger');
        const clip = element => (element ? element.scrollWidth - element.clientWidth : null);
        return {
            buttonPosition: getComputedStyle(buttonNode).position,
            buttonLeft: buttonRect.left,
            titleRowPaddingRight: getComputedStyle(titleRow).paddingRight,
            titleRowContentRight: rowRect.right - parseFloat(getComputedStyle(titleRow).paddingRight),
            titleTextRight: link ? paintedRight(link) : null,
            children,
            // `.epic-name` ellipsizes by design (overflow hidden + text-overflow), so its own scrollWidth is not a
            // defect signal; the link that holds name and key, and the key itself, must not overflow.
            clip: { header: clip(node), titleRow: clip(titleRow), link: clip(link), key: clip(link?.querySelector('.epic-key')) },
            assigneeTextRight: assignee ? paintedRight(assignee) : null,
        };
    });
}

for (const width of [1280, 1024, 390]) {
    test(`3b. the absolute button never collides with the title text and nothing clips at ${width}px`, async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width, height: width === 390 ? 844 : 1000 });
        await expect(page.locator('.initiative-body > .epic-block[data-epic-key="EPIC-2"]')).toHaveCount(1);
        for (const epicKey of ['EPIC-1', 'EPIC-2']) {
            await revealRefreshButton(page, epicKey);
            const report = await titleVersusButton(epicHeader(page, epicKey));
            // The assignee overlay is accepted by the brief at these widths: recorded, not asserted.
            test.info().annotations.push({ type: `title/assignee vs button ${epicKey} @${width}`, description: JSON.stringify({ titleTextRight: report.titleTextRight, buttonLeft: report.buttonLeft, assigneeTextRight: report.assigneeTextRight }) });
            expect(report.buttonPosition, `${epicKey} button is absolutely positioned`).toBe('absolute');
            expect(report.titleTextRight, `${epicKey} title text exists`).not.toBeNull();
            for (const [name, overflow] of Object.entries(report.clip)) {
                if (overflow === null) continue;
                expect(overflow, `${epicKey} ${name} scrollWidth - clientWidth`).toBeLessThanOrEqual(1);
            }
            if (width === 390) {
                expect(report.titleRowPaddingRight, `${epicKey} title row reserves the button column`).toBe('32px');
                // Neither the title text nor any title-row item (priority, track, stat toggle) reaches the button.
                expect(report.titleTextRight, `${epicKey} title text right edge clear of the button`).toBeLessThanOrEqual(report.buttonLeft + 0.5);
                for (const child of report.children) {
                    expect(child.right, `${epicKey} title-row item ${child.name} clear of the button`).toBeLessThanOrEqual(Math.min(report.buttonLeft, report.titleRowContentRight) + 0.5);
                }
            }
        }
    });
}

// Computed-style report of the hovered button: colours as relative luminance plus the WCAG contrast ratio
// between the glyph colour and the background, so a dark-on-dark global `button:hover` surface cannot pass.
async function hoverStyleReport(button) {
    return button.evaluate((node) => {
        const channels = (value) => {
            const match = value.match(/rgba?\(([^)]+)\)/);
            return match ? match[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
        };
        const luminance = (rgb) => {
            const [red, green, blue] = rgb.map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        };
        const style = getComputedStyle(node);
        const svg = node.querySelector('svg');
        const path = svg?.querySelector('path');
        const stroke = path ? getComputedStyle(path).stroke : null;
        const glyph = channels(stroke && stroke !== 'none' ? stroke : style.color);
        const background = channels(style.backgroundColor);
        const bgLuminance = luminance(background);
        const glyphLuminance = luminance(glyph);
        const [lighter, darker] = bgLuminance > glyphLuminance ? [bgLuminance, glyphLuminance] : [glyphLuminance, bgLuminance];
        return {
            hovered: node.matches(':hover'),
            opacity: style.opacity,
            backgroundColor: style.backgroundColor,
            backgroundLuminance: bgLuminance,
            glyphColor: stroke && stroke !== 'none' ? stroke : style.color,
            contrast: (lighter + 0.05) / (darker + 0.05),
            transform: style.transform,
            boxShadow: style.boxShadow,
            letterSpacing: style.letterSpacing,
        };
    });
}

async function hoverButtonItself(page, button) {
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Settled state: the pointer is on the button, the opacity transition finished.
    await expect.poll(() => button.evaluate(node => node.matches(':hover') && getComputedStyle(node).opacity === '1')).toBe(true);
}

function expectReadableHover(report, label) {
    expect(report.hovered, `${label} is hovered`).toBe(true);
    expect(report.opacity, `${label} opacity settled`).toBe('1');
    expect(report.backgroundLuminance, `${label} background ${report.backgroundColor} is a light surface, not the dark global button:hover`).toBeGreaterThan(0.8);
    expect(report.contrast, `${label} glyph ${report.glyphColor} on ${report.backgroundColor}`).toBeGreaterThanOrEqual(3);
    expect(report.transform, `${label} transform`).toBe('none');
    expect(report.boxShadow, `${label} box-shadow`).toBe('none');
    expect(['0px', 'normal'], `${label} letter-spacing ${report.letterSpacing}`).toContain(report.letterSpacing);
}

for (const epicKey of ['EPIC-1', 'EPIC-2']) {
    test(`3c. the hovered refresh button keeps a light surface, readable glyph and no lift on ${epicKey}`, async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        const button = await revealRefreshButton(page, epicKey);
        await hoverButtonItself(page, button);
        expectReadableHover(await hoverStyleReport(button), `${epicKey} resting hover`);

        // aria-busy: hold the epic response so the busy state is reachable, then hover the busy button again.
        const hold = holdEpicResponse(ctx, epicKey);
        await button.click();
        await hold.seen;
        await expect(button).toHaveAttribute('aria-busy', 'true');
        await hoverButtonItself(page, button);
        const busy = await hoverStyleReport(button);
        // The busy glyph is an image, so only the button colour is measured against the surface here.
        expectReadableHover(busy, `${epicKey} aria-busy hover`);
        hold.release();
        await expect(button).not.toHaveAttribute('aria-busy', 'true');
    });
}

// Hit-testing report for the header's right-hand targets while the button is shown. The centre of each
// target must hit it or a descendant; the button/painted-text intersection is reported, not asserted
// (user-accepted overlay: the button may cover the end of the right-most item).
async function clickabilityReport(header) {
    return header.evaluate((node) => {
        const textRect = (element) => {
            if (element instanceof HTMLInputElement) {
                const style = getComputedStyle(element);
                const context = document.createElement('canvas').getContext('2d');
                context.font = style.font;
                const box = element.getBoundingClientRect();
                const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
                const width = Math.min(context.measureText(element.value).width, box.right - left);
                return { left, right: left + width, top: box.top, bottom: box.bottom };
            }
            const range = document.createRange();
            range.selectNodeContents(element);
            const rect = range.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        };
        const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const targets = {
            assignee: node.querySelector('.epic-assignee-value .issue-person-editor-trigger'),
            storyPoints: node.querySelector('.epic-story-points'),
            status: node.querySelector('.epic-status-pill'),
        };
        const buttonRect = node.querySelector('.epic-refresh-button').getBoundingClientRect();
        const report = {};
        for (const [name, element] of Object.entries(targets)) {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            report[name] = {
                centreHitsTarget: Boolean(hit) && (hit === element || element.contains(hit)),
                hit: hit ? `${hit.tagName}.${hit.className}` : null,
                buttonOverlapsBox: intersects(buttonRect, box),
                buttonOverlapsPaintedText: intersects(buttonRect, textRect(element)),
            };
        }
        return report;
    });
}

for (const width of [1280, 1024, 800, 600]) {
    test(`4. assignee, Story Points and status stay clickable under the button at ${width}px`, async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width, height: 1000 });
        for (const epicKey of ['EPIC-1', 'EPIC-2']) {
            await revealRefreshButton(page, epicKey);
            const report = await clickabilityReport(epicHeader(page, epicKey));
            test.info().annotations.push({ type: `overlay ${epicKey} @${width}`, description: JSON.stringify(report) });
            for (const [name, entry] of Object.entries(report)) {
                expect(entry.centreHitsTarget, `${epicKey} ${name} centre hit ${entry.hit}`).toBe(true);
            }
        }
    });
}

for (const width of [1400, 1024, 390]) {
    test(`5. an open status menu layers above the refresh button at ${width}px`, async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width, height: width === 390 ? 844 : 1000 });
        await revealRefreshButton(page, 'EPIC-1');
        await epicHeader(page, 'EPIC-1').locator('[data-status-transition-trigger]').click();
        const menu = page.locator('.status-transition-menu[data-issue-key="EPIC-1"]');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.status-transition-option').first()).toBeVisible();
        const report = await menu.evaluate((menuNode) => {
            const buttonNode = document.querySelector('.epic-refresh-button[data-epic-refresh="EPIC-1"]');
            const menuRect = menuNode.getBoundingClientRect();
            const buttonRect = buttonNode.getBoundingClientRect();
            const overlap = {
                left: Math.max(menuRect.left, buttonRect.left), right: Math.min(menuRect.right, buttonRect.right),
                top: Math.max(menuRect.top, buttonRect.top), bottom: Math.min(menuRect.bottom, buttonRect.bottom),
            };
            const overlaps = overlap.left < overlap.right && overlap.top < overlap.bottom;
            const points = [];
            for (let column = 0; column <= 4; column += 1) {
                for (let row = 0; row <= 4; row += 1) {
                    points.push([menuRect.left + 8 + (menuRect.width - 16) * column / 4, menuRect.top + 8 + (menuRect.height - 16) * row / 4]);
                }
            }
            if (overlaps) points.push([(overlap.left + overlap.right) / 2, (overlap.top + overlap.bottom) / 2]);
            const covered = points.map(([x, y]) => ({ x, y, hit: document.elementFromPoint(x, y) }))
                .filter(({ hit }) => !hit || !(menuNode === hit || menuNode.contains(hit)))
                .map(({ x, y, hit }) => `${Math.round(x)},${Math.round(y)} ${hit ? `${hit.tagName}.${hit.className}` : 'none'}`);
            const header = buttonNode.closest('.epic-header');
            // The natural geometry never overlaps (the menu opens below the pill, the button sits in the
            // header's top-right corner), so also force the overlap: park the button under the menu's
            // centre. With the menu hidden the button must win the hit test (proving the overlap is real);
            // with the menu shown the menu must.
            const headerRect = header.getBoundingClientRect();
            const saved = buttonNode.getAttribute('style');
            Object.assign(buttonNode.style, {
                left: `${menuRect.left + menuRect.width / 2 - headerRect.left - buttonRect.width / 2}px`,
                right: 'auto',
                top: `${menuRect.top + menuRect.height / 2 - headerRect.top - buttonRect.height / 2}px`,
            });
            const centreX = menuRect.left + menuRect.width / 2;
            const centreY = menuRect.top + menuRect.height / 2;
            menuNode.style.visibility = 'hidden';
            const withoutMenu = document.elementFromPoint(centreX, centreY);
            menuNode.style.visibility = '';
            const withMenu = document.elementFromPoint(centreX, centreY);
            const forced = {
                buttonWinsWithoutMenu: Boolean(withoutMenu) && buttonNode.contains(withoutMenu),
                menuWinsWithMenu: Boolean(withMenu) && menuNode.contains(withMenu),
            };
            if (saved === null) buttonNode.removeAttribute('style'); else buttonNode.setAttribute('style', saved);
            return {
                overlaps,
                forced,
                covered,
                menuZ: getComputedStyle(menuNode).zIndex,
                buttonZ: getComputedStyle(buttonNode).zIndex,
                headerZ: getComputedStyle(header).zIndex,
                portalled: menuNode.classList.contains('is-portalled'),
            };
        });
        test.info().annotations.push({ type: `menu-vs-button @${width}`, description: JSON.stringify(report) });
        expect(report.covered).toEqual([]);
        expect(report.forced, 'forced overlap: the menu layer wins over the button').toEqual({ buttonWinsWithoutMenu: true, menuWinsWithMenu: true });
        // Whether or not the rects touch at this width, the menu sits on a higher layer than the button.
        expect(Number(report.menuZ)).toBeGreaterThan(Number(report.buttonZ));
    });
}

test('6. a click sends one epic-scoped request per lane and never shows the whole-screen loading state', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    // An open subtask panel of this epic is on the allowlist for reloads.
    await taskCard(page, 'E1-S01').locator('.story-subtasks-toggle').click();
    await expect(taskCard(page, 'E1-S01').locator('.story-subtasks-panel')).toBeVisible();

    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-refresh', async () => { await gate.promise; });
    const since = ctx.calls.length;
    await page.evaluate(() => {
        window.__loadingStateSeen = 0;
        new MutationObserver(() => { if (document.querySelector('.loading-state')) window.__loadingStateSeen += 1; }).observe(document.body, { childList: true, subtree: true, attributes: true });
    });

    await (await revealRefreshButton(page, 'EPIC-1')).click();
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expect(refreshButton(page, 'EPIC-1')).toHaveAttribute('aria-busy', 'true');
    gate.resolve();
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('aria-busy', 'true');

    const refreshes = epicRefreshCalls(ctx.calls);
    expect(refreshes.map(call => call.params.project).sort()).toEqual(['product', 'tech']);
    for (const call of refreshes) {
        expect(call.params.epicKeys).toBe('EPIC-1');
        expect(call.params.refresh).toBe('true');
        expect(call.params.purpose).toBe('epic-refresh');
    }
    expect(ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(2);
    expect(await page.evaluate(() => window.__loadingStateSeen), '.loading-state never rendered').toBe(0);
    assertScopedCalls(ctx.calls, since, 'EPIC-1', storyKeysOf(ctx.scenario, 'EPIC-1'));
});

test('7. the burst shows for at least 400 ms even when the response is instant', async ({ page }) => {
    await page.clock.install();
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    let finishedRefreshRequests = 0;
    page.on('requestfinished', (request) => { if (request.url().includes('purpose=epic-refresh')) finishedRefreshRequests += 1; });
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 2000);
    const button = await revealRefreshButton(page, 'EPIC-1');
    const clickedAt = await page.evaluate(() => Date.now());
    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('.loading-mark-xs')).toHaveCount(1);
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);

    // Both stubbed responses must have fully arrived (real time) before the "still busy" assertion,
    // otherwise it would hold trivially because the fetch itself was still pending.
    await expect.poll(() => finishedRefreshRequests).toBe(2);
    await page.waitForTimeout(150);
    await page.clock.fastForward(300);
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('.loading-mark-xs')).toHaveCount(1);

    await expect.poll(async () => {
        await page.clock.runFor(100);
        return button.getAttribute('aria-busy');
    }, { timeout: 10000 }).toBeNull();
    expect((await page.evaluate(() => Date.now())) - clickedAt, 'busy lasted at least 400 ms of page time').toBeGreaterThanOrEqual(400);
    await expect(button.locator('.loading-mark-xs')).toHaveCount(0);
    await expect(button.locator('svg path')).toHaveCount(2);
});

test('8. a changed story is replaced in place without losing scroll, filters or the header position', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);

    // Apply a Status filter (hide In Progress), which hides E2-S02, before the refresh.
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /in progress/i }).click();
    await page.keyboard.press('Escape');
    await expect(taskCard(page, 'E2-S02')).toHaveCount(0);
    const readout = (await page.locator('.filterbar-wrap').innerText()).replace(/\s+/g, ' ');

    await page.evaluate(() => {
        window.scrollTo(0, 200); // EPIC-1's header is still in normal flow here (not stuck), so its top is a real position
        document.querySelectorAll('.task-item').forEach((node, index) => { node.__nodeTag = index + 1; });
    });
    // The page re-anchors itself once after a programmatic scroll (compact header); wait for it to settle.
    await expect.poll(async () => {
        const first = await page.evaluate(() => window.scrollY);
        await page.waitForTimeout(200);
        return first === await page.evaluate(() => window.scrollY);
    }).toBe(true);
    const header = epicHeader(page, 'EPIC-1');
    const before = await page.evaluate(() => ({
        scrollY: window.scrollY,
        top: document.querySelector('.epic-block[data-epic-key="EPIC-1"] .epic-header').getBoundingClientRect().top,
        tag: document.querySelector('.task-item[data-task-key="E1-S02"]').__nodeTag,
    }));
    expect(before.tag).toBeGreaterThan(0);
    expect(before.top, 'the clicked header is in normal flow, not stuck').toBeGreaterThan(200);

    const changed = ctx.scenario.stories.find(story => story.key === 'E1-S02');
    changed.fields.summary = 'E1-S02 retitled by the server';
    changed.fields.customfield_10004 = 8;
    changed.fields.updated = '2026-05-09T00:00:00.000+0000';

    await (await revealRefreshButton(page, 'EPIC-1')).click();
    await expect(taskCard(page, 'E1-S02')).toContainText('E1-S02 retitled by the server');
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('aria-busy', 'true');

    const after = await page.evaluate(() => ({
        scrollY: window.scrollY,
        top: document.querySelector('.epic-block[data-epic-key="EPIC-1"] .epic-header').getBoundingClientRect().top,
        tag: document.querySelector('.task-item[data-task-key="E1-S02"]').__nodeTag,
        survivors: [...document.querySelectorAll('.task-item')].filter(node => node.__nodeTag).length,
    }));
    expect(after.tag, 'the changed story keeps its DOM node').toBe(before.tag);
    expect(after.survivors).toBe(14);
    expect(after.scrollY).toBe(before.scrollY);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    await expect(taskCard(page, 'E2-S02')).toHaveCount(0);
    expect((await page.locator('.filterbar-wrap').innerText()).replace(/\s+/g, ' ')).toBe(readout);
    await expect(header).toBeVisible();
});

// ---- tests 9-19 (part 2) ----

// Clicks the (hover-revealed) refresh button of one epic with a normal click.
async function clickRefresh(page, epicKey) {
    await (await revealRefreshButton(page, epicKey)).click();
}

// Waits for the epic's refresh to finish: busy cleared after the request(s) were issued.
async function expectRefreshSettled(page, epicKey) {
    await expect(refreshButton(page, epicKey)).not.toHaveAttribute('aria-busy', 'true');
}

// Retitles every story of an epic on the "server" so each one is a displayed change.
function retitleEpicStories(scenario, epicKey, suffix = 'retitled') {
    scenario.stories.filter(story => story.fields.epicKey === epicKey).forEach((story) => {
        story.fields.summary = `${story.key} ${suffix}`;
        story.fields.updated = '2026-05-09T00:00:00.000+0000';
    });
}

// Installs a one-shot observer that freezes every running animation at 900 ms the moment the first
// data-glare attribute appears, and records which cards and headers carried it at that instant.
async function installGlareFreezer(page) {
    await page.evaluate(() => {
        window.__glareFrozen = null;
        const observer = new MutationObserver(() => {
            if (!document.querySelector('[data-glare]')) return;
            observer.disconnect();
            document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 900; });
            window.__glareFrozen = {
                cards: [...document.querySelectorAll('.task-item[data-glare]')].map(node => node.getAttribute('data-task-key')),
                headers: [...document.querySelectorAll('.epic-header[data-glare]')].map(node => node.closest('[data-epic-key]')?.getAttribute('data-epic-key')),
            };
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-glare'] });
    });
}

const frozenGlare = page => page.evaluate(() => window.__glareFrozen);

const pseudoAnimation = (page, selector, pseudo) => page.evaluate(({ selector: sel, pseudo: pseudoName }) => {
    const style = getComputedStyle(document.querySelector(sel), pseudoName);
    return { name: style.animationName, duration: style.animationDuration, opacity: style.opacity };
}, { selector, pseudo });

test.describe('glare', () => {
    test.use({ viewport: { width: 1400, height: 1300 } });

    test('9. glare marks changed, mounted, in-viewport cards only and is capped at 8', async ({ page }, testInfo) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
        retitleEpicStories(ctx.scenario, 'EPIC-1'); // 12 changed cards; EPIC-2/EPIC-3 stay untouched
        await installGlareFreezer(page);
        await clickRefresh(page, 'EPIC-1');
        await page.waitForFunction(() => window.__glareFrozen !== null);

        const frozen = await frozenGlare(page);
        expect(frozen.cards, 'exactly 8 of the 12 changed cards glare').toHaveLength(8);
        expect(frozen.cards.every(key => key.startsWith('E1-'))).toBe(true);
        expect(frozen.headers).toEqual([]);
        // The 8 topmost cards win; the 4 lowest do not glare.
        const tops = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.task-item[data-task-key^="E1-"]')].map(node => [node.getAttribute('data-task-key'), node.getBoundingClientRect().top])));
        const glared = new Set(frozen.cards);
        expect(Object.keys(tops)).toHaveLength(12);
        const maxGlaredTop = Math.max(...frozen.cards.map(key => tops[key]));
        const minPlainTop = Math.min(...Object.keys(tops).filter(key => !glared.has(key)).map(key => tops[key]));
        expect(maxGlaredTop).toBeLessThan(minPlainTop);

        // Frozen at 900 ms the ring is mid-glint (never the end state) and the cards hold their final text.
        const ring = await pseudoAnimation(page, `.task-item[data-task-key="${frozen.cards[0]}"]`, '::before');
        expect(ring.name).toBe('epic-refresh-glint');
        expect(ring.duration).toBe('1.8s');
        expect(Number(ring.opacity)).toBeGreaterThan(0);
        await expect(page.locator('.task-item[data-glare]')).toHaveCount(8);
        await expect(taskCard(page, 'E1-S12')).toContainText('E1-S12 retitled');
        await page.screenshot({ path: testInfo.outputPath('glare-frozen-900ms.png') });
        await testInfo.attach('glare-frozen-900ms', { path: testInfo.outputPath('glare-frozen-900ms.png'), contentType: 'image/png' });
    });
});

test.describe('glare viewport rule', () => {
    test.use({ viewport: { width: 1400, height: 720 } });

    test('9b. a changed card below the fold does not glare', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        retitleEpicStories(ctx.scenario, 'EPIC-1');
        await installGlareFreezer(page);
        await clickRefresh(page, 'EPIC-1');
        await page.waitForFunction(() => window.__glareFrozen !== null);
        const frozen = await frozenGlare(page);
        const geometry = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.task-item[data-task-key^="E1-"]')].map(node => [node.getAttribute('data-task-key'), node.getBoundingClientRect().top])));
        const viewportBottom = await page.evaluate(() => window.innerHeight);
        const below = Object.keys(geometry).filter(key => geometry[key] >= viewportBottom);
        expect(below.length, 'some changed cards sit below the fold at 720 px').toBeGreaterThan(0);
        expect(frozen.cards.length).toBeGreaterThan(0);
        for (const key of below) expect(frozen.cards).not.toContain(key);
        for (const key of frozen.cards) expect(geometry[key]).toBeLessThan(viewportBottom);
    });
});

test('10. reduced motion swaps the sweeping beam for a tint on the card ring and the header sweep', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    ctx.scenario.stories.find(story => story.key === 'E1-S02').fields.summary = 'E1-S02 retitled';
    ctx.scenario.epics['EPIC-1'].summary = 'Direct epic retitled by the server';
    await installGlareFreezer(page);
    await clickRefresh(page, 'EPIC-1');
    await page.waitForFunction(() => window.__glareFrozen !== null);

    const frozen = await frozenGlare(page);
    expect(frozen.cards).toEqual(['E1-S02']);
    expect(frozen.headers).toEqual(['EPIC-1']);
    const ring = await pseudoAnimation(page, '.task-item[data-task-key="E1-S02"]', '::before');
    expect(ring.name).toBe('epic-refresh-tint');
    expect(ring.duration).toBe('1.2s');
    expect(Number(ring.opacity), 'tint holds its peak at 900 ms').toBeGreaterThan(0);
    const sweep = await pseudoAnimation(page, '.epic-block[data-epic-key="EPIC-1"] .epic-header', '::after');
    expect(sweep.name).toBe('epic-refresh-tint');
    expect(sweep.duration).toBe('1.2s');
    expect(Number(sweep.opacity)).toBeGreaterThan(0);
});

test('11. an unchanged epic shows no glare, no layout change and says it is up to date', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    const rects = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.epic-header, .task-item')].map((node, index) => {
        const box = node.getBoundingClientRect();
        return [`${index}:${node.getAttribute('data-task-key') || node.closest('[data-epic-key]')?.getAttribute('data-epic-key')}`, [box.x, box.y, box.width, box.height].map(Math.round)];
    })));
    await installGlareFreezer(page);
    await parkPointer(page);
    const before = await rects();
    await clickRefresh(page, 'EPIC-1');
    await expect(statusRegion(page)).toHaveText('Epic is up to date');
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(400);
    expect(await frozenGlare(page), 'no data-glare was ever set').toBeNull();
    await expect(page.locator('[data-glare]')).toHaveCount(0);
    await parkPointer(page);
    expect(await rects()).toEqual(before);
});

test('11b. the initial load never sets data-glare and a refresh glares only the changed card, not other epics or unchanged cards', async ({ page }) => {
    const ctx = await mockDashboard(page);
    // Recorded from the first document, before any script of the app runs.
    await page.addInitScript(() => {
        window.__glareEverSet = [];
        new MutationObserver((records) => {
            records.forEach((record) => {
                if (record.target.hasAttribute('data-glare')) {
                    window.__glareEverSet.push(record.target.getAttribute('data-task-key') || `header:${record.target.closest('[data-epic-key]')?.getAttribute('data-epic-key')}`);
                }
            });
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-glare'] });
    });
    await openCatchUp(page, ctx);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__glareEverSet), 'initial load never set data-glare').toEqual([]);

    // One story of EPIC-1 changes; EPIC-2 and EPIC-3 and the other EPIC-1 cards are untouched.
    ctx.scenario.stories.find(story => story.key === 'E1-S02').fields.summary = 'E1-S02 retitled';
    await clickRefresh(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-S02')).toContainText('E1-S02 retitled');
    await expect.poll(() => page.evaluate(() => window.__glareEverSet.length)).toBeGreaterThan(0);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__glareEverSet), 'only the changed card ever glared').toEqual(['E1-S02']);
});

test.describe('leaving and entering cards', () => {
test.use({ viewport: { width: 1400, height: 2200 } }); // the entering card is the 13th (about 1680 px down): it must be inside the viewport to glint

test('12. a leaving card dissolves with is-removing, an entering card fades in and then glints', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.scenario.stories = ctx.scenario.stories.filter(story => story.key !== 'E1-S05');
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { summary: 'E1-S13 arrives from the server', points: 2 }));
    await page.evaluate(() => {
        window.__leaving = null;
        window.__entering = null;
        window.__order = [];
        const read = (node, pseudo) => { const style = getComputedStyle(node, pseudo); return { name: style.animationName, duration: style.animationDuration, pointerEvents: style.pointerEvents }; };
        new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === 'childList') {
                    record.addedNodes.forEach((added) => {
                        const node = added.nodeType === 1 ? (added.matches?.('[data-task-key="E1-S13"]') ? added : added.querySelector?.('[data-task-key="E1-S13"]')) : null;
                        if (node && !window.__entering) { window.__entering = read(node); window.__order.push('mounted'); }
                    });
                } else if (record.target.getAttribute?.('data-task-key') === 'E1-S05' && record.attributeName === 'class' && record.target.classList.contains('is-removing') && !window.__leaving) {
                    window.__leaving = { ...read(record.target), disabledRemove: record.target.querySelector('.task-remove')?.disabled === true };
                    window.__order.push('removing');
                } else if (record.target.getAttribute?.('data-task-key') === 'E1-S13' && record.attributeName === 'data-glare' && record.target.hasAttribute('data-glare') && !window.__glint) {
                    window.__glint = read(record.target, '::before');
                    window.__order.push('glint');
                }
            }
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-glare'] });
    });
    await clickRefresh(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-S13')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__order.includes('glint'))).toBe(true);
    await expect(taskCard(page, 'E1-S05')).toHaveCount(0);

    const seen = await page.evaluate(() => ({ leaving: window.__leaving, entering: window.__entering, glint: window.__glint, order: window.__order }));
    expect(seen.leaving, 'the leaving card carried is-removing').not.toBeNull();
    expect(seen.leaving).toMatchObject({ name: 'task-remove-dissolve', duration: '0.24s', pointerEvents: 'none', disabledRemove: true });
    expect(seen.entering).toMatchObject({ name: 'task-appear', duration: '0.18s' });
    expect(seen.glint).toMatchObject({ name: 'epic-refresh-glint' });
    expect(seen.order.indexOf('mounted')).toBeLessThan(seen.order.indexOf('glint'));
    await expect(statusRegion(page)).toHaveText('2 stories updated');
});

});

test('13. a card the user removed stays removed after a refresh', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    const card = taskCard(page, 'E1-S04');
    await card.hover();
    await card.locator('.task-remove').click();
    await expect(card).toHaveCount(0);
    await expect(taskCard(page, 'E1-S03')).toHaveCount(1);
    await installGlareFreezer(page);
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expect(statusRegion(page)).toHaveText('Epic is up to date');
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-S04')).toHaveCount(0);
    expect(await frozenGlare(page)).toBeNull();
    await expect(page.locator('.epic-block[data-epic-key="EPIC-1"] .task-item')).toHaveCount(11);
});

const globalRefreshButton = page => page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });

test('14. a global Refresh during a per-epic refresh discards the epic result', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    // The epic response (held back) carries a change the full reload does not: if it were applied, E1-S02 would be retitled.
    const staleScenario = JSON.parse(JSON.stringify(ctx.scenario));
    staleScenario.stories.find(story => story.key === 'E1-S02').fields.summary = 'E1-S02 FROM THE STALE EPIC RESPONSE';
    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-refresh', async ({ call, json }) => {
        await gate.promise;
        return json(taskPayload(call.params, staleScenario));
    });
    await installGlareFreezer(page);
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expect(refreshButton(page, 'EPIC-1')).toHaveAttribute('aria-busy', 'true');

    const sinceGlobal = ctx.calls.length;
    await globalRefreshButton(page).click();
    await expect.poll(() => ctx.calls.slice(sinceGlobal).filter(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose !== 'epic-refresh').length).toBeGreaterThan(0);
    await expect(page.locator('.loading-state')).toHaveCount(0);
    await expect(taskCard(page, 'E1-S12')).toBeAttached();
    gate.resolve();
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('aria-busy', 'true');
    await page.waitForTimeout(500); // past MIN_BUSY_MS and the two-frame apply, so a wrongly applied result would be visible
    await expect(taskCard(page, 'E1-S02')).not.toContainText('FROM THE STALE EPIC RESPONSE');
    await expect(taskCard(page, 'E1-S02')).toContainText('E1-S02 synthetic story');
    await expect(statusRegion(page)).toHaveText('');
    expect(await frozenGlare(page)).toBeNull();
    await expect(page.locator('[data-glare]')).toHaveCount(0);
});

const statusTrigger = (page, kind, key) => page.locator(`[data-status-transition-trigger][data-issue-kind="${kind}"][data-issue-key="${key}"]`);
const statusMenu = (page, key) => page.locator(`.status-transition-menu[data-issue-key="${key}"]`);

// Changes one issue's status through the real status menu and waits for Jira to confirm it.
async function confirmStatusChange(page, ctx, { kind, key, target }) {
    const since = ctx.calls.length;
    await statusTrigger(page, kind, key).click();
    await statusMenu(page, key).getByRole('menuitem', { name: target }).click();
    await expect.poll(() => ctx.calls.slice(since).filter(call => call.method === 'POST' && call.pathname === '/api/issues/transitions').length).toBe(1);
    await expect(statusMenu(page, key).locator('.status-transition-menu-result')).toContainText('Updated 1 issue');
    await expect(statusTrigger(page, kind, key)).toHaveText(target);
    const size = page.viewportSize();
    await page.mouse.click(2, size.height - 2); // an outside click closes the menu
    await expect(statusMenu(page, key)).toHaveCount(0);
}

test('15a. a story status change confirmed while the epic fetch is pending is kept', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.scenario.stories.find(story => story.key === 'E1-S03').fields.summary = 'E1-S03 retitled by the server';
    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-refresh', async () => { await gate.promise; });
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expect(refreshButton(page, 'EPIC-1')).toHaveAttribute('aria-busy', 'true');

    // The held response still says E1-S02 is To Do; the user moves it to In Progress and Jira confirms.
    await confirmStatusChange(page, ctx, { kind: 'story', key: 'E1-S02', target: 'In Progress' });
    await installGlareFreezer(page);
    gate.resolve();
    await expect(taskCard(page, 'E1-S03')).toContainText('E1-S03 retitled by the server');
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(statusTrigger(page, 'story', 'E1-S02')).toHaveText('In Progress');
    await expect(statusRegion(page)).toHaveText('1 story updated');
    await page.waitForTimeout(300);
    await expect(statusTrigger(page, 'story', 'E1-S02')).toHaveText('In Progress');
    expect((await frozenGlare(page)).cards, 'only the story the server changed glints').toEqual(['E1-S03']);
});

test('15b. an epic status change confirmed while the epic fetch is pending is kept', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.respond('/api/issues/transitions/options', ({ call, json }) => json({
        issues: (call.body?.issueKeys || []).map(key => ({ key, issueType: 'Epic', currentStatus: 'In Progress', transitions: [] })),
        targetStatuses: [{ name: 'Blocked', availableCount: 1, blockedCount: 0 }, { name: 'Done', availableCount: 1, blockedCount: 0 }],
    }));
    ctx.scenario.stories.find(story => story.key === 'E1-S03').fields.summary = 'E1-S03 retitled by the server';
    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-refresh', async () => { await gate.promise; });
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);

    // The held response still says the epic is In Progress.
    await confirmStatusChange(page, ctx, { kind: 'epic', key: 'EPIC-1', target: 'Blocked' });
    gate.resolve();
    await expect(taskCard(page, 'E1-S03')).toContainText('E1-S03 retitled by the server');
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(300);
    await expect(statusTrigger(page, 'epic', 'EPIC-1')).toHaveText('Blocked');
    await expect(page.locator('.epic-header[data-glare]')).toHaveCount(0);
});

test('16. two epics refresh at once, a third click and a repeat click inside the cooldown issue nothing', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    const gates = { 'EPIC-1': deferred(), 'EPIC-2': deferred() };
    ctx.respond(call => call.params.purpose === 'epic-refresh', async ({ call }) => { await gates[call.params.epicKeys]?.promise; });

    await clickRefresh(page, 'EPIC-1');
    await clickRefresh(page, 'EPIC-2');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(4);
    const lanes = epicKey => epicRefreshCalls(ctx.calls).filter(call => call.params.epicKeys === epicKey).map(call => call.params.project).sort();
    expect(lanes('EPIC-1')).toEqual(['product', 'tech']);
    expect(lanes('EPIC-2')).toEqual(['product', 'tech']);
    await expect(refreshButton(page, 'EPIC-1')).toHaveAttribute('aria-busy', 'true');
    await expect(refreshButton(page, 'EPIC-2')).toHaveAttribute('aria-busy', 'true');

    // A third epic while two are in flight: normal click, no request, no busy state.
    await clickRefresh(page, 'EPIC-3');
    await page.waitForTimeout(500);
    expect(epicRefreshCalls(ctx.calls)).toHaveLength(4);
    await expect(refreshButton(page, 'EPIC-3')).not.toHaveAttribute('aria-busy', 'true');
    await expect(refreshButton(page, 'EPIC-3')).toHaveAttribute('data-state', 'idle');

    gates['EPIC-1'].resolve();
    gates['EPIC-2'].resolve();
    await expectRefreshSettled(page, 'EPIC-1');
    await expectRefreshSettled(page, 'EPIC-2');
    // Now a slot is free, but EPIC-1 refreshed less than 10 s ago: a second click issues nothing.
    await clickRefresh(page, 'EPIC-1');
    await page.waitForTimeout(500);
    expect(epicRefreshCalls(ctx.calls)).toHaveLength(4);
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('aria-busy', 'true');
    // The free slot still serves a different epic.
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(6);
});

const globalErrorSurfaces = page => page.locator('.error, .server-unavailable-banner, [role="alertdialog"]');
const REFRESH_FAILED_LABEL = 'Epic refresh failed. Try again.';

// Distinctive strings in the error body's server-internal fields; none may ever reach the DOM.
const LEAK_CANARIES = { details: 'LEAK-CANARY-DETAILS', jql_used: 'LEAK-CANARY-JQL-USED', message: 'LEAK-CANARY-MESSAGE' };

async function expectNoLeak(page) {
    const rendered = await page.evaluate(() => ({
        text: document.body.innerText,
        html: document.documentElement.outerHTML,
        status: document.querySelector('[data-epic-refresh-status]')?.textContent ?? '',
    }));
    for (const canary of Object.values(LEAK_CANARIES)) {
        expect(rendered.text, `${canary} in body text`).not.toContain(canary);
        expect(rendered.status, `${canary} in status region`).not.toContain(canary);
        expect(rendered.html, `${canary} anywhere in the DOM (attributes, titles, aria-labels)`).not.toContain(canary);
    }
}

async function expectErrorState(page, epicKey) {
    const button = refreshButton(page, epicKey);
    await expect(button).toHaveAttribute('data-state', 'error');
    await expect(button).toHaveAttribute('aria-label', REFRESH_FAILED_LABEL);
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
}

test('17a. a 401 uses the existing sign-in lock and adds no error UI of its own', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.respond(call => call.params.purpose === 'epic-refresh', ({ status }) => status(401, { error: 'auth_required', loginUrl: '/login?reason=session_expired', ...LEAK_CANARIES }));
    await clickRefresh(page, 'EPIC-1');
    await expect(page.getByRole('alertdialog')).toContainText('Sign in required');
    await expect(page.getByRole('alertdialog')).toHaveCount(1);
    await expect(page.locator('.error, .server-unavailable-banner')).toHaveCount(0);
    // Mounted feature state survives, the refresh button shows no error label, nothing was announced.
    await expect(taskCard(page, 'E1-S12')).toBeAttached();
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('data-state', 'error');
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('aria-label', REFRESH_FAILED_LABEL);
    await expect(statusRegion(page)).toHaveText('');
    expect(new URL(page.url()).pathname).toBe('/');
    await expectNoLeak(page);
});

test('17b. a 429 shows the fixed error label, no global banner and never retries on its own', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.respond(call => call.params.purpose === 'epic-refresh', ({ status }) => status(429, { error: 'epic_refresh_rate_limited', ...LEAK_CANARIES }));
    await clickRefresh(page, 'EPIC-1');
    await expectErrorState(page, 'EPIC-1');
    await expect(statusRegion(page)).toHaveText('Epic refresh failed');
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expectNoLeak(page);
    expect(epicRefreshCalls(ctx.calls)).toHaveLength(2);
    await page.waitForTimeout(1500);
    expect(epicRefreshCalls(ctx.calls), 'no automatic retry').toHaveLength(2);
    await expect(taskCard(page, 'E1-S12')).toBeAttached();
});

test('17c. an HTTP 500 shows the error state and no global banner', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.respond(call => call.params.purpose === 'epic-refresh', ({ status }) => status(500, { error: 'internal_error', ...LEAK_CANARIES }));
    await clickRefresh(page, 'EPIC-1');
    await expectErrorState(page, 'EPIC-1');
    await expect(statusRegion(page)).toHaveText('Epic refresh failed');
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expectNoLeak(page);
    await expect(taskCard(page, 'E1-S12')).toBeAttached();
    // The error is not sticky: the next click retries (explicitly, by the user).
    await refreshButton(page, 'EPIC-1').click();
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(4);
});

test('17d. a denied product lane (403) applies the tech lane silently', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.scenario.stories.push(buildStory('E1-T01', 'EPIC-1', { projectKey: 'TECH', summary: 'E1-T01 tech story arrives' }));
    ctx.respond(call => call.params.purpose === 'epic-refresh' && call.params.project === 'product', ({ status }) => status(403, { error: 'missing_project_access' }));
    await clickRefresh(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-T01')).toBeVisible();
    await expect(statusRegion(page)).toHaveText('1 story updated');
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(refreshButton(page, 'EPIC-1')).toHaveAttribute('data-state', 'idle');
    await expect(refreshButton(page, 'EPIC-1')).not.toHaveAttribute('aria-label', REFRESH_FAILED_LABEL);
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expect(taskCard(page, 'E1-S12')).toBeAttached(); // the denied lane's stories are untouched, not removed
});

test('17e. one failed lane shows the error state and still applies the other lane', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.scenario.stories.push(buildStory('E1-T01', 'EPIC-1', { projectKey: 'TECH', summary: 'E1-T01 tech story arrives' }));
    ctx.respond(call => call.params.purpose === 'epic-refresh' && call.params.project === 'product', ({ status }) => status(500, { error: 'internal_error' }));
    await clickRefresh(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-T01')).toBeVisible();
    await expectErrorState(page, 'EPIC-1');
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expect(taskCard(page, 'E1-S12')).toBeAttached(); // the failed lane removes nothing
});

test('18a. announcements: one story updated, up to date, and identical messages repeat', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    // A single live region, visually hidden, never aria-live.
    await expect(statusRegion(page)).toHaveCount(1);
    await expect(statusRegion(page)).toHaveAttribute('role', 'status');
    await expect(statusRegion(page)).not.toHaveAttribute('aria-live', /.*/);
    await expect(statusRegion(page)).toHaveText('');

    ctx.scenario.stories.find(story => story.key === 'E1-S02').fields.summary = 'E1-S02 retitled by the server';
    await clickRefresh(page, 'EPIC-1');
    await expect(statusRegion(page)).toHaveText('1 story updated');

    await clickRefresh(page, 'EPIC-2');
    await expect(statusRegion(page)).toHaveText('Epic is up to date');
    await page.evaluate(() => { document.querySelector('[data-epic-refresh-status]').__first = true; });
    await clickRefresh(page, 'EPIC-3');
    // Same text again: the node is replaced (keyed by announcement id) so assistive tech announces it again.
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-epic-refresh-status]').__first === true)).toBe(false);
    await expect(statusRegion(page)).toHaveText('Epic is up to date');
    await expect(statusRegion(page)).toHaveCount(1);
});

test('18b. announcements: N changes hidden by filters', async ({ page }) => {
    const ctx = await mockDashboard(page);
    ['E1-S01', 'E1-S02'].forEach((key) => { ctx.scenario.stories.find(story => story.key === key).fields.status = { name: 'In Progress' }; });
    await openCatchUp(page, ctx);
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /in progress/i }).click();
    await page.keyboard.press('Escape');
    await expect(taskCard(page, 'E1-S01')).toHaveCount(0);
    await expect(taskCard(page, 'E1-S02')).toHaveCount(0);

    ['E1-S01', 'E1-S02'].forEach((key) => { ctx.scenario.stories.find(story => story.key === key).fields.summary = `${key} retitled while filtered`; });
    await installGlareFreezer(page);
    await clickRefresh(page, 'EPIC-1');
    await expect(statusRegion(page)).toHaveText('2 changes hidden by filters');
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(300);
    expect(await frozenGlare(page), 'hidden changes do not glint').toBeNull();
});

test('19. a change hidden by the default Killed filter announces and does not glint', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    await expect(taskCard(page, 'E1-S02')).toBeVisible();
    ctx.scenario.stories.find(story => story.key === 'E1-S02').fields.status = { name: 'Killed' };
    await installGlareFreezer(page);
    await clickRefresh(page, 'EPIC-1');
    // Real behaviour, including the plan's literal grammar quirk for a single change.
    await expect(statusRegion(page)).toHaveText('1 changes hidden by filters');
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-S02')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await frozenGlare(page), 'the Killed story never glints').toBeNull();
    await expect(page.locator('[data-glare]')).toHaveCount(0);
});

// ---- tests 20-27 (part 3) ----

test('20. a click while the alert cohort is still loading issues no request and shows no busy state', async ({ page }) => {
    const ctx = await mockDashboard(page);
    const alertsGate = deferred();
    const alertsSeen = deferred();
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === 'alerts', async () => {
        alertsSeen.resolve();
        await alertsGate.promise;
    });
    await page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value));
    }, catchUpPrefs());
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    for (const epicKey of Object.keys(ctx.scenario.epics)) {
        await expect(epicBlock(page, epicKey)).toBeVisible();
    }
    await expect(taskCard(page, 'E1-S12')).toBeAttached();
    await alertsSeen.promise; // the alert cohort is now in flight and held

    const since = ctx.calls.length;
    const button = await revealRefreshButton(page, 'EPIC-1');
    await button.click();
    await page.waitForTimeout(800);
    expect(epicRefreshCalls(ctx.calls.slice(since)), 'no epic-refresh request while the alert cohort loads').toEqual([]);
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('.loading-mark-xs')).toHaveCount(0);

    alertsGate.resolve();
    await expect.poll(async () => {
        const probe = ctx.calls.length;
        await (await revealRefreshButton(page, 'EPIC-1')).click();
        await page.waitForTimeout(400);
        return epicRefreshCalls(ctx.calls.slice(probe)).length;
    }, { timeout: 20000 }).toBe(2);
});

test('21. a story that moved into the epic appears once, a story that moved out leaves only this epic', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    await expect(taskCard(page, 'E2-S01')).toHaveCount(1);
    await expect(taskCard(page, 'E1-S02')).toHaveCount(1);
    // Server state: E2-S01 moved from EPIC-2 into EPIC-1 (it is still held in EPIC-2 on screen) and E1-S02 moved to EPIC-3.
    const moveIn = ctx.scenario.stories.find(story => story.key === 'E2-S01');
    moveIn.fields.epicKey = 'EPIC-1';
    moveIn.fields.parentSummary = 'EPIC-1 synthetic epic';
    moveIn.fields.updated = '2026-05-09T00:00:00.000+0000';
    const moveOut = ctx.scenario.stories.find(story => story.key === 'E1-S02');
    moveOut.fields.epicKey = 'EPIC-3';
    moveOut.fields.parentSummary = 'EPIC-3 synthetic epic';
    moveOut.fields.updated = '2026-05-09T00:00:00.000+0000';

    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');

    await expect(taskCard(page, 'E1-S02')).toHaveCount(0);
    // The entering story is shown exactly once across the whole screen (no duplicate under EPIC-2 and EPIC-1).
    await expect(taskCard(page, 'E2-S01')).toHaveCount(1);
    await expect(epicBlock(page, 'EPIC-1').locator('.task-item[data-task-key="E2-S01"]')).toHaveCount(1);
    // Only this epic lost the departed story; the other epics keep what they held.
    await expect(epicBlock(page, 'EPIC-3').locator('.task-item')).toHaveCount(1);
    await expect(taskCard(page, 'E3-S01')).toHaveCount(1);
    await expect(taskCard(page, 'E2-S02')).toHaveCount(1);
});

async function openWithCappedLane(page, { capped }) {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.scenario.stories = ctx.scenario.stories.filter(story => story.key !== 'E1-S05');
    if (capped) {
        // The product lane answers with a capped (250 row) page that happens not to contain E1-S05.
        ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === 'epic-refresh' && call.params.project !== 'tech', async ({ json }) => {
            const rows = ctx.scenario.stories.filter(story => story.fields.epicKey === 'EPIC-1' && story.fields.projectKey !== 'TECH');
            const filler = [];
            for (let index = rows.length; index < 250; index += 1) filler.push(buildStory(`CAP-${index}`, 'EPIC-OTHER', { projectKey: 'PROD' }));
            return json({
                issues: [...rows, ...filler],
                epics: { 'EPIC-1': ctx.scenario.epics['EPIC-1'] },
                epicsInScope: [ctx.scenario.epics['EPIC-1']],
                names: {},
                capped: true,
                epicKeysMissing: [],
            });
        });
    }
    return ctx;
}

test('22a. a story absent from a capped (250 row) lane response is not removed', async ({ page }) => {
    const ctx = await openWithCappedLane(page, { capped: true });
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600); // longer than the 240 ms dissolve: a removal would have dropped the card by now
    await expect(taskCard(page, 'E1-S05')).toHaveCount(1);
    await expect(taskCard(page, 'E1-S05')).not.toHaveClass(/is-removing/);
    await expect(epicBlock(page, 'EPIC-1').locator('.task-item')).toHaveCount(EPIC_ONE_STORY_COUNT);
});

test('22b. the same story is removed when the lane response is not capped', async ({ page }) => {
    const ctx = await openWithCappedLane(page, { capped: false });
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-S05')).toHaveCount(0);
    await expect(epicBlock(page, 'EPIC-1').locator('.task-item')).toHaveCount(EPIC_ONE_STORY_COUNT - 1);
});

// Holds the product-lane epic-refresh response until the returned gate is resolved, so the test can move
// focus while the request is pending.
function holdEpicResponse(ctx, epicKey) {
    const gate = deferred();
    const seen = deferred();
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === 'epic-refresh' && call.params.epicKeys === epicKey, async () => {
        seen.resolve();
        await gate.promise;
    });
    return { release: gate.resolve, seen: seen.promise };
}

const activeElementReport = page => page.evaluate(() => {
    const active = document.activeElement;
    return {
        isBody: active === document.body || active === document.documentElement,
        refreshOf: active?.matches?.('.epic-refresh-button') ? active.getAttribute('data-epic-refresh') : null,
        insideBlock: active?.closest?.('[data-epic-key]')?.getAttribute('data-epic-key') ?? null,
    };
});

// Focuses the first element of `selector` inside a card and reports whether it took focus.
async function focusInsideCard(page, key, selector) {
    return taskCard(page, key).evaluate((card, sel) => {
        const target = card.querySelector(sel);
        target?.focus();
        return { focused: Boolean(target) && document.activeElement === target, tag: target?.tagName };
    }, selector);
}

// The epic keys in on-screen (DOM) order; the focus rescue follows this order, not the key numbering.
const epicDomOrder = page => page.evaluate(() => [...document.querySelectorAll('.epic-block[data-epic-key]')].map(node => node.getAttribute('data-epic-key')));

const withoutEpic = (scenario, epicKey) => { scenario.stories = scenario.stories.filter(story => story.fields.epicKey !== epicKey); };

test.describe('focus rescue when the epic block unmounts', () => {
    test('23a. focus on the refresh button of the last epic moves to the previous epic header button', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        const order = await epicDomOrder(page);
        const last = order[order.length - 1];
        const previous = order[order.length - 2];
        const lastCards = storyKeysOf(ctx.scenario, last);
        withoutEpic(ctx.scenario, last);
        const button = await revealRefreshButton(page, last);
        await button.click();
        await expect(button).toBeFocused();
        await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
        // The unmount happens after the dissolve (about 240 ms): wait for the block to go, then read focus.
        await expect(epicBlock(page, last)).toHaveCount(0, { timeout: 5000 });
        await expect(taskCard(page, lastCards[0])).toHaveCount(0);
        const active = await activeElementReport(page);
        expect(active.isBody, 'focus must not fall back to <body>').toBe(false);
        expect(active.refreshOf, 'last epic -> the previous epic header refresh button').toBe(previous);
        await expect(refreshButton(page, previous)).toBeFocused();
    });

    test('23b. focus on a card inside the block moves to the next epic header button', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        const order = await epicDomOrder(page);
        const first = order[0]; // the first epic on screen: its nearest surviving neighbour is the next one
        const next = order[1];
        const cardKey = storyKeysOf(ctx.scenario, first)[0];
        const hold = holdEpicResponse(ctx, first);
        withoutEpic(ctx.scenario, first);
        await clickRefresh(page, first);
        await hold.seen;
        // A focusable that stays enabled while the card dissolves: the card's key link.
        const focused = await focusInsideCard(page, cardKey, 'a[href]');
        expect(focused.focused, `a focusable inside the card took focus (${focused.tag})`).toBe(true);
        expect((await activeElementReport(page)).insideBlock).toBe(first);
        hold.release();
        await expect(epicBlock(page, first)).toHaveCount(0, { timeout: 5000 });
        const active = await activeElementReport(page);
        expect(active.isBody, 'focus must not fall back to <body>').toBe(false);
        expect(active.refreshOf, 'first epic -> the next epic header refresh button').toBe(next);
        await expect(refreshButton(page, next)).toBeFocused();
    });

    test('23d. focus on the remove button of a card inside the block moves to the next epic header button', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        const order = await epicDomOrder(page);
        const first = order[0];
        const next = order[1];
        const cardKey = storyKeysOf(ctx.scenario, first)[0];
        const hold = holdEpicResponse(ctx, first);
        withoutEpic(ctx.scenario, first);
        await clickRefresh(page, first);
        await hold.seen;
        const focused = await focusInsideCard(page, cardKey, 'button.task-remove');
        expect(focused.focused).toBe(true);
        hold.release();
        await expect(epicBlock(page, first)).toHaveCount(0, { timeout: 5000 });
        const active = await activeElementReport(page);
        expect(active.isBody, 'focus must not fall back to <body>').toBe(false);
        expect(active.refreshOf).toBe(next);
    });

    test('23c. focus moved outside the block before the drop is left untouched', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx);
        const order = await epicDomOrder(page);
        const last = order[order.length - 1];
        const outside = order[0]; // not the removed epic and not its nearest neighbour (the previous one)
        const hold = holdEpicResponse(ctx, last);
        withoutEpic(ctx.scenario, last);
        await clickRefresh(page, last);
        await hold.seen;
        await refreshButton(page, outside).focus();
        await expect(refreshButton(page, outside)).toBeFocused();
        hold.release();
        await expect(epicBlock(page, last)).toHaveCount(0, { timeout: 5000 });
        await page.waitForTimeout(400); // a late rescue would have run by now
        const active = await activeElementReport(page);
        expect(active.refreshOf).toBe(outside);
        await expect(refreshButton(page, outside)).toBeFocused();
    });
});

// Scrolls `clicked`'s header to about 300 px from the viewport top, clicks its refresh button after the server
// re-ordered the epics, and returns the header offset before/after and the epic order before/after.
// `pick(domOrder)` chooses the clicked epic; `prepare(ctx, clicked)` changes the server state; `extraStories` extends EPIC-3 so the document is long enough.
async function refreshAndMeasureAnchor(page, { pick, prepare, extraStories = 0 }) {
    const ctx = await mockDashboard(page);
    for (let index = 2; index <= extraStories + 1; index += 1) ctx.scenario.stories.push(buildStory(`E3-S0${index}`, 'EPIC-3', { points: 1 }));
    await openCatchUp(page, ctx);
    const before = await epicDomOrder(page);
    const clicked = pick(before);
    prepare(ctx, clicked);

    // Put the header near the top of the viewport (just under the sticky stack), so that when it moves the
    // document still has room above it: the scroll offset needed to keep it in place stays positive.
    await epicHeader(page, clicked).evaluate(node => window.scrollBy(0, node.getBoundingClientRect().top - 300));
    await expect.poll(async () => {
        const first = await page.evaluate(() => window.scrollY);
        await page.waitForTimeout(200);
        return first === await page.evaluate(() => window.scrollY);
    }).toBe(true);
    const button = await revealRefreshButton(page, clicked);
    const offsetBefore = await epicHeader(page, clicked).evaluate(node => node.getBoundingClientRect().top);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore, 'the page is scrolled, so a re-order can be compensated').toBeGreaterThan(300);
    expect(offsetBefore).toBeGreaterThan(170);
    await button.click();
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expectRefreshSettled(page, clicked);
    await page.waitForTimeout(500); // nothing may move the header again after the refresh settled

    const after = await epicDomOrder(page);
    const offsetAfter = await epicHeader(page, clicked).evaluate(node => node.getBoundingClientRect().top);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    return { clicked, before, after, offsetBefore, offsetAfter, scrollBefore, scrollAfter };
}

const blockerStory = (ctx, epicKey) => {
    const story = ctx.scenario.stories.find(candidate => candidate.fields.epicKey === epicKey);
    story.fields.priority = { name: 'Blocker' }; // outranks the Major stories of the other direct epic
    story.fields.updated = '2026-05-09T00:00:00.000+0000';
};

test('24a. the clicked epic moves DOWN after a priority change and its header stays at the same viewport offset', async ({ page }) => {
    // EPIC-1 (12 stories) drops to Minor and sinks below EPIC-3: its header is pushed down by one epic.
    const result = await refreshAndMeasureAnchor(page, {
        pick: () => 'EPIC-1',
        prepare: (ctx, clicked) => ctx.scenario.stories.filter(story => story.fields.epicKey === clicked).forEach((story) => {
            story.fields.priority = { name: 'Minor' };
            story.fields.updated = '2026-05-09T00:00:00.000+0000';
        }),
    });
    expect(result.after, 'the epics were re-ordered').not.toEqual(result.before);
    expect(result.after.indexOf(result.clicked), 'the clicked epic moved down').toBeGreaterThan(result.before.indexOf(result.clicked));
    expect(Math.abs(result.offsetAfter - result.offsetBefore), `header offset ${result.offsetBefore} -> ${result.offsetAfter}`).toBeLessThanOrEqual(1);
    expect(result.scrollAfter, 'the page was scrolled to compensate').toBeGreaterThan(result.scrollBefore);
});

test('24b. the clicked epic moves UP past a tall epic after a priority change and its header stays at the same viewport offset', async ({ page }) => {
    const result = await refreshAndMeasureAnchor(page, {
        pick: order => order[order.length - 1],
        prepare: (ctx, clicked) => blockerStory(ctx, clicked),
        extraStories: 8, // the document must extend below EPIC-3's header so it can sit at y=300
    });
    expect(result.clicked).toBe('EPIC-3');
    expect(result.after, 'the epics were re-ordered').not.toEqual(result.before);
    expect(result.after.indexOf(result.clicked), 'the clicked epic moved up').toBeLessThan(result.before.indexOf(result.clicked));
    expect(Math.abs(result.offsetAfter - result.offsetBefore), `header offset ${result.offsetBefore} -> ${result.offsetAfter}`).toBeLessThanOrEqual(1);
    expect(result.scrollAfter, 'the page was scrolled to compensate').toBeLessThan(result.scrollBefore);
});

// A populated EPM project (one epic, two stories) in the rollup shape the EPM board renders with IssueCard.
function epmPopulatedRollup(project) {
    return {
        project,
        rollup: {
            metadataOnly: false,
            emptyRollup: false,
            truncated: false,
            truncatedQueries: [],
            initiatives: {},
            rootEpics: {
                'EPM-100': {
                    issue: { key: 'EPM-100', summary: 'EPM epic with populated stories', status: 'In Progress', issueType: 'Epic', assignee: 'Portfolio Owner' },
                    stories: [
                        { key: 'EPM-101', summary: 'First EPM story', status: 'In Progress', issueType: 'Story', priority: 'High', storyPoints: 3, assignee: 'EPM Engineer', updated: '2026-05-22T10:00:00.000Z' },
                        { key: 'EPM-102', summary: 'Second EPM story', status: 'To Do', issueType: 'Story', priority: 'Medium', storyPoints: 5, assignee: 'EPM Engineer', updated: '2026-05-21T10:00:00.000Z' },
                    ],
                },
            },
            orphanStories: [],
        },
    };
}

test('25. IssueCard in EPM never gets data-glare and the per-epic refresh button is absent', async ({ page }) => {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, { selectedView: 'epm', epmTab: 'active', epmSelectedProjectId: '', selectedSprint: epmSprintId, sprintName: epmSprintName });
    await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        allProjectsRollup: project => ({ projects: [epmPopulatedRollup(project)], duplicates: {}, truncated: false, fallback: false }),
    });
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });

    const board = page.locator('.epm-issue-board');
    await expect(board).toHaveCount(1);
    const rollupToggle = page.getByRole('button', { name: /Show Jira rollup for / }).first();
    if (await rollupToggle.isVisible()) await rollupToggle.click();
    await expect(board.locator('.epic-block')).toBeVisible();
    // The IssueCard cards are really rendered (so the absence below is not vacuous).
    await expect(board.locator('.task-item[data-task-key="EPM-101"]')).toBeVisible();
    await expect(board.locator('.task-item[data-task-key="EPM-102"]')).toBeVisible();

    // Hover the EPM epic header too: nothing reveals a refresh affordance there.
    const header = board.locator('.epic-header').first();
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.waitForTimeout(300);

    await expect(page.locator('.epic-refresh-button')).toHaveCount(0);
    await expect(page.locator('[data-epic-refresh]')).toHaveCount(0);
    await expect(page.locator('[data-glare]')).toHaveCount(0);
    expect(await board.locator('.task-item').evaluateAll(nodes => nodes.filter(node => node.hasAttribute('data-glare')).length)).toBe(0);
});

const dependencyPosts = calls => calls.filter(call => call.method === 'POST' && call.pathname === '/api/dependencies');

test('27. a refresh that adds a story skips the department-wide dependencies fetch, and a later global Refresh still issues it', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    const initial = dependencyPosts(ctx.calls);
    expect(initial.length, 'dependencies are shown: the initial load fetched them department-wide').toBeGreaterThan(0);
    const allKeys = ctx.scenario.stories.map(story => story.key);
    expect(allKeys.every(key => initial[initial.length - 1].body.keys.includes(key)), 'the initial POST covers every loaded story').toBe(true);

    // The refresh adds E1-S13 to EPIC-1: the story-key signature of the department changes.
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { summary: 'E1-S13 arrives from the server', points: 2 }));
    const epicKeys = new Set(['EPIC-1', ...storyKeysOf(ctx.scenario, 'EPIC-1')]);
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expect(taskCard(page, 'E1-S13')).toHaveCount(1);
    await expectRefreshSettled(page, 'EPIC-1');
    // The epic-scoped dependencies POST is issued after the apply: wait for it, then give a department-wide fetch time to (wrongly) appear.
    await expect.poll(() => dependencyPosts(ctx.calls.slice(since)).filter(call => call.body?.refresh === true).length).toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    const afterClick = dependencyPosts(ctx.calls.slice(since));
    expect(afterClick.filter(call => call.body?.refresh !== true), 'no department-wide dependencies POST after the click').toEqual([]);
    for (const call of afterClick) {
        expect(call.body.refresh).toBe(true);
        expect(call.body.keys.every(key => epicKeys.has(key)), `keys ${call.body.keys.join(',')} belong to EPIC-1 only`).toBe(true);
        expect(call.body.keys).toContain('E1-S13');
    }

    // A stale skip must not swallow the next legitimate department-wide fetch.
    const beforeGlobal = ctx.calls.length;
    await globalRefreshButton(page).click();
    await expect.poll(() => dependencyPosts(ctx.calls.slice(beforeGlobal)).filter(call => call.body?.refresh !== true).length, { timeout: 15000 }).toBeGreaterThan(0);
    const wide = dependencyPosts(ctx.calls.slice(beforeGlobal)).filter(call => call.body?.refresh !== true).pop();
    ['E1-S13', 'E2-S01', 'E3-S01'].forEach(key => expect(wide.body.keys, `the global fetch covers ${key}`).toContain(key));
});

// ---- tests 28-33 (Task 8: client-derived alerts follow the refresh) ----

// A /api/missing-info entry as the endpoint emits it (nested fields.missingFields).
function missingInfoEntry(story, missingFields) {
    const { id, key, fields } = story;
    return { id, key, fields: { ...fields, customfield_10004: fields.customfield_10004, customfield_10101: fields.sprint, missingFields } };
}

// Serves /api/missing-info from the live scenario so the held entries reflect the server's state at load.
function serveMissingInfo(ctx, build) {
    ctx.respond('/api/missing-info', ({ json }) => json({ issues: build(ctx.scenario), epics: [], count: 0, epicCount: 0 }));
}

const missingRows = page => page.locator('#eng-alert-missing .alert-story');
const missingInfoCalls = calls => calls.filter(call => call.pathname === '/api/missing-info');

const alertRequestPaths = new Set(['/api/missing-info', '/api/backlog-epics', '/api/eng/story-readiness']);
const alertRequests = calls => calls.filter(call => alertRequestPaths.has(call.pathname)
    || (call.pathname === '/api/tasks-with-team-name' && call.params.purpose && call.params.purpose !== 'epic-refresh'));
const setStory = (ctx, key, fields) => Object.assign(ctx.scenario.stories.find(story => story.key === key).fields, fields);
const entryNamesFor = { 'E1-S02': ['Story Points'], 'E1-S04': ['Story Points'], 'E1-S05': ['Story Points'] };

// Three EPIC-1 stories start with empty Story Points; the held /api/missing-info entries mirror what the server said at load.
async function openWithMissingInfo(page) {
    const ctx = await mockDashboard(page);
    Object.keys(entryNamesFor).forEach(key => setStory(ctx, key, { customfield_10004: null }));
    serveMissingInfo(ctx, scenario => Object.keys(entryNamesFor).map(key => missingInfoEntry(scenario.stories.find(story => story.key === key), entryNamesFor[key])));
    await openCatchUp(page, ctx);
    await expect(missingRows(page)).toHaveCount(3);
    return ctx;
}

test('28. Story Points from empty to a value removes that story\'s Missing Info entry with no alert request', async ({ page }) => {
    const ctx = await openWithMissingInfo(page);
    setStory(ctx, 'E1-S02', { customfield_10004: 3 });
    setStory(ctx, 'E1-S05', { customfield_10004: 0 }); // still not estimated: the endpoint treats 0 as missing
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');

    await expect(missingRows(page)).toHaveCount(2);
    await expect(missingRows(page).filter({ hasText: 'E1-S02' })).toHaveCount(0);
    for (const key of ['E1-S04', 'E1-S05']) {
        const row = missingRows(page).filter({ hasText: key });
        await expect(row).toHaveCount(1);
        await expect(row.locator('.alert-pill.status')).toHaveText('Missing: Story Points');
    }
    await expect(missingRows(page).locator('.alert-pill.status').filter({ hasText: 'Assignee' })).toHaveCount(0);
    await page.waitForTimeout(600); // a late alert request would show up here
    expect(alertRequests(ctx.calls.slice(since)).map(call => `${call.method} ${call.pathname}${call.search}`)).toEqual([]);
    assertScopedCalls(ctx.calls, since, 'EPIC-1', storyKeysOf(ctx.scenario, 'EPIC-1'));
});

test('29. a refreshed story that reached a terminal status drops its Missing Info entry', async ({ page }) => {
    const ctx = await openWithMissingInfo(page);
    setStory(ctx, 'E1-S04', { status: { name: 'Done' } }); // still has no Story Points: only the terminal status removes it
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(missingRows(page).filter({ hasText: 'E1-S04' })).toHaveCount(0);
    await expect(missingRows(page)).toHaveCount(2);
    // Task 11: a status change now re-checks Ready to Close and the epic alert object for this epic (tests 34+); nothing else.
    expect(otherAlertCalls(ctx.calls.slice(since), 'EPIC-1', ['/api/eng/story-readiness'])).toEqual([]);
});

test('30. an alert the user dismissed stays dismissed after a refresh', async ({ page }) => {
    const ctx = await openWithMissingInfo(page);
    await missingRows(page).filter({ hasText: 'E1-S04' }).locator('.alert-remove').click();
    await expect(missingRows(page)).toHaveCount(2);
    setStory(ctx, 'E1-S02', { customfield_10004: 3 });
    setStory(ctx, 'E1-S05', { summary: 'E1-S05 retitled by the server' }); // a changed entry the refresh rewrites in place
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(taskCard(page, 'E1-S05')).toContainText('E1-S05 retitled by the server');
    await expect(missingRows(page)).toHaveCount(1);
    await expect(missingRows(page).first()).toContainText('E1-S05 · E1-S05 retitled by the server');
    await expect(missingRows(page).filter({ hasText: 'E1-S04' })).toHaveCount(0);
});

test('31. an alert cohort started during the refresh owns the result, the per-epic alert update is discarded', async ({ page }) => {
    const ctx = await openWithMissingInfo(page);
    const epicGate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-refresh', async () => { await epicGate.promise; });
    setStory(ctx, 'E1-S02', { customfield_10004: 3 });
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls).length).toBe(2);
    await expect(refreshButton(page, 'EPIC-1')).toHaveAttribute('aria-busy', 'true');

    // A confirmed status change re-arms the alert cohort (version bump); its /api/missing-info answer is held back.
    const cohortGate = deferred();
    const sinceEdit = ctx.calls.length;
    ctx.respond('/api/missing-info', async () => { await cohortGate.promise; });
    await confirmStatusChange(page, ctx, { kind: 'story', key: 'E1-S03', target: 'In Progress' });
    await expect.poll(() => missingInfoCalls(ctx.calls.slice(sinceEdit)).length).toBeGreaterThan(0);
    epicGate.resolve();
    await expect(taskCard(page, 'E1-S02')).toBeAttached();
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(500);
    // Without the version check the refresh would already have removed the E1-S02 entry; the cohort has not answered yet.
    await expect(page.locator('#eng-alert-missing .alert-story').filter({ hasText: 'E1-S02' })).toHaveCount(1);
    cohortGate.resolve();
});

test('32. a Stories Required ghost disappears when the refresh adds an actionable story for that team', async ({ page }) => {
    const ctx = await mockDashboard(page);
    setStory(ctx, 'E3-S01', { status: { name: 'Blocked' } });
    ctx.respond('/api/eng/story-readiness', ({ json }) => json(readinessSnapshotFor([readinessEpicFor('EPIC-3', 'team-alpha', 'Alpha Team', 'selected_stories_not_actionable')])));
    await openCatchUp(page, ctx);
    const ghost = page.locator('.story-requirement-card[data-epic-key="EPIC-3"]');
    await expect(ghost).toHaveCount(1);

    ctx.scenario.stories.push(buildStory('E3-S02', 'EPIC-3', { points: 2 }));
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expect(taskCard(page, 'E3-S02')).toHaveCount(1);
    await expectRefreshSettled(page, 'EPIC-3');
    await expect(ghost).toHaveCount(0);
    // A membership change re-checks Ready to Close, the epic alert object, Missing Info and readiness for this epic only (no Backlog: active sprint).
    expect(otherAlertCalls(ctx.calls.slice(since), 'EPIC-3', ['/api/missing-info', '/api/eng/story-readiness'])).toEqual([]);
});

for (const mode of ['catch_up', 'planning']) {
    test(`33. ${mode}: a ghost is hidden by an actionable held story and kept for a blocked one`, async ({ page }) => {
        const ctx = await mockDashboard(page);
        setStory(ctx, 'E3-S01', { status: { name: 'Blocked' } });
        ctx.respond('/api/eng/story-readiness', ({ json }) => json(readinessSnapshotFor([
            readinessEpicFor('EPIC-3', 'team-alpha', 'Alpha Team', 'selected_stories_not_actionable'),
            readinessEpicFor('EPIC-2', 'team-alpha', 'Alpha Team', 'selected_stories_not_actionable'),
        ])));
        await openCatchUp(page, ctx, { prefs: { showPlanning: mode === 'planning' } });
        await expect(page.locator('.story-requirement-card[data-epic-key="EPIC-3"]')).toHaveCount(1);
        await expect(page.locator('.story-requirement-card[data-epic-key="EPIC-2"]')).toHaveCount(0); // EPIC-2 holds actionable stories
    });
}

function readinessEpicFor(key, teamId, teamName, reason) {
    return { key, summary: `${key} synthetic epic`, status: { name: 'In Progress' }, priority: { name: 'Major' }, assignee: { displayName: 'Epic Lead' },
        projectKey: 'PROD', projectClass: 'product', projectTrack: 'product', initiative: null, missingTeams: [{ id: teamId, name: teamName, reason }] };
}

function readinessSnapshotFor(epics) {
    return { schemaVersion: 1, complete: true, scope: { groupId: GROUP_ID, sprintId: String(SPRINT_ID), sprintName: SPRINT_NAME, sprintState: 'active' }, epics };
}

// ---- tests 34-40 (Task 11: scope-based alerts for one epic) ----

const taskRequests = (calls, purpose) => calls.filter(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === purpose);
const epicAlertCalls = calls => taskRequests(calls, 'epic-alerts');
const epicReadyToCloseCalls = (calls, epicKey) => taskRequests(calls, 'ready-to-close').filter(call => call.params.epicKeys === epicKey);
const describeCalls = calls => calls.map(call => `${call.method} ${call.pathname}${call.search.replace(/[?&]t=\d+/, '')}`);
const lanesOf = calls => calls.map(call => call.params.project).sort();
// Every alert-related request after `since` that is not an epic-scoped call for `epicKey`: Task 11's epic-alerts and ready-to-close pair, plus
// the endpoints named in `alsoAllowed` (Task 12: '/api/missing-info', '/api/backlog-epics', '/api/eng/story-readiness'). A request without
// the epic key is never allowed, so a department-wide request of any kind is always reported.
const otherAlertCalls = (calls, epicKey, alsoAllowed = []) => alertRequests(calls)
    .filter(call => !(call.params.epicKeys === epicKey && (['epic-alerts', 'ready-to-close'].includes(call.params.purpose) || alsoAllowed.includes(call.pathname))));
const emptyEpicRows = page => page.locator('#eng-alert-empty .alert-story');
const readyToCloseAlert = page => page.locator('#eng-alert-done');

// EPIC-3 has one Blocked story (not actionable) and the department scope says it has zero stories: an Empty Epic alert.
// `ctx.scope` is what the department alert load serves; `ctx.epicScope` is what the epic-scoped call serves (they may differ on purpose).
async function openWithEmptyEpicAlert(page) {
    const ctx = await mockDashboard(page);
    setStory(ctx, 'E3-S01', { status: { name: 'Blocked' } });
    const emptyEpic = { ...ctx.scenario.epics['EPIC-3'], status: { name: 'To Do' }, totalStories: 0, selectedStories: 0, futureOpenStories: 0 };
    ctx.scope = { 'EPIC-3': emptyEpic };
    ctx.epicScope = { 'EPIC-3': emptyEpic };
    ctx.respond(call => call.params.purpose === 'alerts' && call.params.project === 'product', ({ json }) => json({ issues: [], epics: {}, epicsInScope: Object.values(ctx.scope), names: {} }));
    ctx.respond(call => call.params.purpose === 'epic-alerts', ({ json, call }) => json({
        epicsInScope: call.params.project === 'product' && ctx.epicScope[call.params.epicKeys] ? [ctx.epicScope[call.params.epicKeys]] : [],
    }));
    await openCatchUp(page, ctx);
    await expect(emptyEpicRows(page)).toHaveCount(1);
    await expect(emptyEpicRows(page).first()).toContainText('EPIC-3');
    return ctx;
}

// Department ready-to-close and epic-scoped ready-to-close share this answer: the epics in `ctx.openChildren` with their open child count.
function serveReadyToClose(ctx) {
    ctx.respond(call => call.params.purpose === 'ready-to-close' && call.params.project === 'product', ({ json, call }) => {
        const keys = String(call.params.epicKeys || '').split(',');
        const known = keys.filter(key => ctx.openChildren[key] !== undefined);
        json({
            issues: ctx.scenario.stories.filter(story => known.includes(story.fields.epicKey)),
            epics: {},
            epicsInScope: known.map(key => ({ ...ctx.scenario.epics[key], openChildCount: ctx.openChildren[key] })),
            names: {},
        });
    });
}

test('34. a story status change makes exactly the epic-alerts, ready-to-close and one readiness call for that epic, in both lanes', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    setStory(ctx, 'E1-S02', { status: { name: 'In Progress' } });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicAlertCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await expect.poll(() => epicReadyToCloseCalls(ctx.calls.slice(since), 'EPIC-1').length).toBe(2);
    await page.waitForTimeout(600); // a late extra alert request would show up here

    const after = ctx.calls.slice(since);
    expect(lanesOf(epicAlertCalls(after))).toEqual(['product', 'tech']);
    expect(lanesOf(epicReadyToCloseCalls(after, 'EPIC-1'))).toEqual(['product', 'tech']);
    epicAlertCalls(after).forEach(call => expect(call.params.epicKeys).toBe('EPIC-1'));
    epicReadyToCloseCalls(after, 'EPIC-1').forEach(call => expect(call.params.sprint).toBe(''));
    // A status change also re-checks Stories Required for this epic (Task 12), but neither Missing Info nor Backlog.
    expect(describeCalls(otherAlertCalls(after, 'EPIC-1', ['/api/eng/story-readiness']))).toEqual([]);
    expect(epicReadinessCalls(after)).toHaveLength(1);
    assertScopedCalls(ctx.calls, since, 'EPIC-1', storyKeysOf(ctx.scenario, 'EPIC-1'));
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
});

test('34b. Epic Ready to Close appears once the refresh closes the last open story and the ready-to-close answer says so', async ({ page }) => {
    const ctx = await mockDashboard(page);
    ctx.openChildren = { 'EPIC-3': 1 };
    serveReadyToClose(ctx);
    await openCatchUp(page, ctx);
    await expect(readyToCloseAlert(page)).toHaveCount(0);

    setStory(ctx, 'E3-S01', { status: { name: 'Done' } });
    ctx.openChildren['EPIC-3'] = 0;
    await clickRefresh(page, 'EPIC-3');
    await expect(readyToCloseAlert(page)).toHaveCount(1);
    await expect(readyToCloseAlert(page)).toContainText('EPIC-3');
});

test('35a. a refresh that changes nothing makes no alert call', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600);
    expect(describeCalls(alertRequests(ctx.calls.slice(since)))).toEqual([]);
});

test('35b. Story Points, assignee and summary changes alone make no alert call', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    setStory(ctx, 'E1-S02', { customfield_10004: 8, summary: 'E1-S02 retitled', assignee: { displayName: 'Another Owner' } });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicRefreshCalls(ctx.calls.slice(since)).length).toBe(2);
    await expect(taskCard(page, 'E1-S02')).toContainText('E1-S02 retitled');
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600);
    expect(describeCalls(alertRequests(ctx.calls.slice(since)))).toEqual([]);
});

test('36. a department reload while the alert calls are in flight discards their result', async ({ page }) => {
    const ctx = await openWithEmptyEpicAlert(page);
    ctx.epicScope = {}; // the epic-scoped answer says the epic left scope; the department reload below still says it is empty
    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-alerts', async ({ json }) => { await gate.promise; return json({ epicsInScope: [] }); });
    setStory(ctx, 'E3-S01', { status: { name: 'Incomplete' } });
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicAlertCalls(ctx.calls).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-3');

    const sinceGlobal = ctx.calls.length;
    await globalRefreshButton(page).click();
    await expect.poll(() => taskRequests(ctx.calls.slice(sinceGlobal), 'alerts').length).toBe(2);
    await expect(emptyEpicRows(page)).toHaveCount(1);
    gate.resolve();
    await page.waitForTimeout(700); // the late answer would remove the row here
    await expect(emptyEpicRows(page)).toHaveCount(1);
});

test('37. an epic that leaves scope disappears from the Empty Epic alert', async ({ page }) => {
    const ctx = await openWithEmptyEpicAlert(page);
    delete ctx.epicScope['EPIC-3'];
    setStory(ctx, 'E3-S01', { status: { name: 'Incomplete' } });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicAlertCalls(ctx.calls.slice(since)).length).toBe(2);
    await expect(emptyEpicRows(page)).toHaveCount(0);
    await expectRefreshSettled(page, 'EPIC-3');
});

test('38. an epic that is still in scope keeps its place in the Empty Epic alert and takes its refreshed fields', async ({ page }) => {
    const ctx = await openWithEmptyEpicAlert(page);
    ctx.epicScope['EPIC-3'] = { ...ctx.epicScope['EPIC-3'], summary: 'EPIC-3 renamed by the server' };
    setStory(ctx, 'E3-S01', { status: { name: 'Incomplete' } });
    await clickRefresh(page, 'EPIC-3');
    await expect(emptyEpicRows(page).first()).toContainText('EPIC-3 renamed by the server');
    await expect(emptyEpicRows(page)).toHaveCount(1);
});

test('39. a failed epic-alerts call keeps the existing alerts and raises no banner', async ({ page }) => {
    const ctx = await openWithEmptyEpicAlert(page);
    ctx.respond(call => call.params.purpose === 'epic-alerts', ({ status }) => status(500, { error: 'internal_error', ...LEAK_CANARIES }));
    ctx.respond(call => call.params.purpose === 'ready-to-close' && call.params.project === 'tech', ({ status }) => status(403, { error: 'missing_project_access', ...LEAK_CANARIES }));
    setStory(ctx, 'E3-S01', { status: { name: 'Incomplete' } });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicAlertCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-3');
    await page.waitForTimeout(600);
    await expect(emptyEpicRows(page)).toHaveCount(1);
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expect(refreshButton(page, 'EPIC-3')).not.toHaveAttribute('data-state', 'error');
    await expect(statusRegion(page)).not.toHaveText('Epic refresh failed');
    await expectNoLeak(page);
    expect(epicAlertCalls(ctx.calls.slice(since)), 'a failed alert call is not retried').toHaveLength(2);
});

test('40. a lane whose alert call fails leaves its entries alone while the other lane is still merged', async ({ page }) => {
    const ctx = await openWithEmptyEpicAlert(page);
    // The tech lane fails; the product lane (which holds the epic) answers with a renamed epic and that is merged on its own.
    ctx.epicScope['EPIC-3'] = { ...ctx.epicScope['EPIC-3'], summary: 'EPIC-3 renamed while tech failed' };
    ctx.respond(call => call.params.purpose === 'epic-alerts' && call.params.project === 'tech', ({ status }) => status(500, { error: 'internal_error' }));
    setStory(ctx, 'E3-S01', { status: { name: 'Incomplete' } });
    await clickRefresh(page, 'EPIC-3');
    await expect(emptyEpicRows(page).first()).toContainText('EPIC-3 renamed while tech failed');
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expect(refreshButton(page, 'EPIC-3')).not.toHaveAttribute('data-state', 'error');
});

// A future sprint: the department scope also holds EPIC-9, an epic that is in scope only by its label (no story in this sprint) and has no team.
const FUTURE_SPRINT_ID = 3002;
const FUTURE_SPRINT_NAME = '2026Q3 Sprint 43';
const backlogRows = page => page.locator('#eng-alert-backlog .alert-story');

async function openFutureSprintWithLabelOnlyEpic(page) {
    const ctx = await mockDashboard(page);
    const labelOnly = { key: 'EPIC-9', summary: 'EPIC-9 label only epic', status: { name: 'To Do' }, assignee: null, teamId: '', teamName: '', labels: ['alpha_label'], sprint: [], totalStories: 0 };
    ctx.scope = { 'EPIC-9': labelOnly };
    ctx.respond('/api/sprints', ({ json }) => json({ sprints: [
        { id: SPRINT_ID, name: SPRINT_NAME, state: 'active', startDate: '2026-05-01' },
        { id: FUTURE_SPRINT_ID, name: FUTURE_SPRINT_NAME, state: 'future', startDate: '2026-08-01' },
    ] }));
    ctx.respond(call => call.params.purpose === 'alerts' && call.params.project === 'product', ({ json }) => json({ issues: [], epics: {}, epicsInScope: Object.values(ctx.scope), names: {} }));
    // The epic-scoped call for EPIC-1 answers with EPIC-1 itself (it is in scope by its label too); EPIC-9 is never asked about.
    ctx.respond(call => call.params.purpose === 'epic-alerts', ({ json, call }) => json({
        epicsInScope: call.params.project === 'product' && call.params.epicKeys === 'EPIC-1' ? [{ ...ctx.scenario.epics['EPIC-1'], totalStories: 12 }] : [],
    }));
    await openCatchUp(page, ctx, { prefs: { selectedSprint: FUTURE_SPRINT_ID, sprintName: FUTURE_SPRINT_NAME } });
    return ctx;
}

test('42. in a future sprint a label-only epic keeps its alert, and even a Story Points change re-checks the epic alert object', async ({ page }) => {
    const ctx = await openFutureSprintWithLabelOnlyEpic(page);
    await expect(backlogRows(page)).toHaveCount(1);
    await expect(backlogRows(page).first()).toContainText('EPIC-9');
    setStory(ctx, 'E1-S02', { customfield_10004: 8 });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => epicAlertCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600);
    expect(lanesOf(epicAlertCalls(ctx.calls.slice(since)))).toEqual(['product', 'tech']);
    expect(epicReadyToCloseCalls(ctx.calls.slice(since), 'EPIC-1'), 'Story Points alone does not re-check Ready to Close').toEqual([]);
    await expect(backlogRows(page)).toHaveCount(1);
    await expect(backlogRows(page).first()).toContainText('EPIC-9');
});

// ---- review fix: removal from partial data (MRT019), Ready to Close entry of one epic ----

// EPIC-3 holds a Ready to Close entry in the product lane: the epic entry (visible as the Ready to Close alert) and a story copy
// (`readyToCloseProductTasks`). The story copies have no visible surface: their only consumer, the Waiting for Stories alert, is
// unreachable today because `analysisWaitingEpics` passes the story array as the options argument of `epicMatchesSelectedSprint`
// (pre-existing, dashboard.jsx). So the copies are counted in the React state of the mounted app. The copy uses a synthetic key,
// so only the ready-to-close answer can create or remove it.
const readyToCloseEntryRows = page => readyToCloseAlert(page).locator('.alert-story');
const heldCopyCount = page => page.evaluate(() => {
    const host = document.getElementById('root');
    const containerKey = Object.keys(host).find(name => name.startsWith('__reactContainer$'));
    const seen = new Set();
    const stack = [host[containerKey]];
    let count = 0;
    while (stack.length) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        for (let hook = fiber.memoizedState; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
            if (Array.isArray(hook.memoizedState)) count += hook.memoizedState.filter(item => item?.key === 'E3-HELD').length;
        }
        stack.push(fiber.child, fiber.sibling);
    }
    return count;
});

async function openWithHeldReadyToCloseEntry(page) {
    const ctx = await mockDashboard(page);
    const heldCopy = buildStory('E3-HELD', 'EPIC-3', { status: 'Done', projectKey: 'PROD' });
    ctx.swallowed = false;
    ctx.respond(call => call.params.purpose === 'ready-to-close' && call.params.project === 'product', ({ json }) => json(ctx.swallowed
        ? { issues: [], epics: {}, epicsInScope: [], names: {} }
        : { issues: [heldCopy], epics: {}, epicsInScope: [{ ...ctx.scenario.epics['EPIC-3'], openChildCount: 0 }], names: {} }));
    await openCatchUp(page, ctx);
    await expect(readyToCloseEntryRows(page)).toHaveCount(1);
    await expect(readyToCloseAlert(page)).toContainText('EPIC-3');
    await expect.poll(() => heldCopyCount(page)).toBe(1);
    return ctx;
}

test('43. a swallowed ready-to-close failure (200, empty issues and epics) with a failed epic-alerts call keeps the held Ready to Close entry and its stories', async ({ page }) => {
    const ctx = await openWithHeldReadyToCloseEntry(page);
    ctx.swallowed = true;
    ctx.respond(call => call.params.purpose === 'epic-alerts', ({ status }) => status(500, { error: 'internal_error', ...LEAK_CANARIES }));
    setStory(ctx, 'E3-S01', { status: { name: 'In Progress' } });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicReadyToCloseCalls(ctx.calls.slice(since), 'EPIC-3').length).toBe(2);
    await expect.poll(() => epicAlertCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-3');
    await page.waitForTimeout(700); // the lane merges land after the calls settle
    await expect(readyToCloseEntryRows(page)).toHaveCount(1);
    await expect(readyToCloseAlert(page)).toContainText('EPIC-3');
    expect(await heldCopyCount(page)).toBe(1);
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
});

test('44. an ok empty epic-alerts answer (epic out of scope) removes the held Ready to Close entry and its stories', async ({ page }) => {
    const ctx = await openWithHeldReadyToCloseEntry(page);
    ctx.swallowed = true;
    ctx.respond(call => call.params.purpose === 'epic-alerts', ({ json }) => json({ epicsInScope: [] }));
    setStory(ctx, 'E3-S01', { status: { name: 'In Progress' } });
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicReadyToCloseCalls(ctx.calls.slice(since), 'EPIC-3').length).toBe(2);
    await expect(readyToCloseEntryRows(page)).toHaveCount(0);
    await expect.poll(() => heldCopyCount(page)).toBe(0);
    await expectRefreshSettled(page, 'EPIC-3');
});

// ---- tests 45-57 (Task 12: Missing Info, Backlog and Stories Required for one epic) ----

const readinessCalls = calls => calls.filter(call => call.pathname === '/api/eng/story-readiness');
const epicReadinessCalls = calls => readinessCalls(calls).filter(call => call.params.epicKeys);
const backlogCalls = calls => calls.filter(call => call.pathname === '/api/backlog-epics');
const ghostCards = (page, epicKey) => page.locator(`.story-requirement-card[data-epic-key="${epicKey}"]`);
const BETA_MISSING = { id: 'team-beta', name: 'Beta Team', reason: 'team_uncovered' };

// EPIC-2 and EPIC-3 hold only non-actionable stories, so the client rule keeps the Stories Required ghost of each. `ctx.ghosts` is what the
// server says per epic: the department request (no epicKeys) serves them all, the per-epic request serves just the one asked for.
async function openWithGhosts(page, { prefs, prepare } = {}) {
    const ctx = await mockDashboard(page);
    prepare?.(ctx);
    ['E2-S01', 'E2-S02', 'E3-S01'].forEach(key => setStory(ctx, key, { status: { name: 'Blocked' } }));
    ctx.ghosts = {
        'EPIC-2': readinessEpicFor('EPIC-2', 'team-alpha', 'Alpha Team', 'selected_stories_not_actionable'),
        'EPIC-3': readinessEpicFor('EPIC-3', 'team-alpha', 'Alpha Team', 'selected_stories_not_actionable'),
    };
    ctx.respond(call => call.pathname === '/api/eng/story-readiness', ({ json, call }) => {
        const keys = call.params.epicKeys ? [call.params.epicKeys] : Object.keys(ctx.ghosts);
        return json(readinessSnapshotFor(keys.map(key => ctx.ghosts[key]).filter(Boolean)));
    });
    await openCatchUp(page, ctx, { prefs });
    await expect(ghostCards(page, 'EPIC-2')).toHaveCount(1);
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(1);
    return ctx;
}

// Adds a Blocked story to EPIC-3 on the "server": a membership change that keeps the client rule from hiding the ghost.
const addBlockedEpic3Story = ctx => ctx.scenario.stories.push(buildStory('E3-S02', 'EPIC-3', { status: 'Blocked', points: 2 }));

// Records whether the ghost of `epicKey` was ever absent from the DOM while the observer ran.
async function watchGhostBlink(page, epicKey) {
    await page.evaluate((key) => {
        window.__ghostBlink = false;
        const selector = `.story-requirement-card[data-epic-key="${key}"]`;
        new MutationObserver(() => { if (!document.querySelector(selector)) window.__ghostBlink = true; })
            .observe(document.body, { childList: true, subtree: true, attributes: true });
    }, epicKey);
}

test('45. a membership change updates only that epic\'s Stories Required ghost, with scoped requests and no blanking of other epics', async ({ page }) => {
    const ctx = await openWithGhosts(page);
    addBlockedEpic3Story(ctx);
    ctx.ghosts['EPIC-3'] = { ...ctx.ghosts['EPIC-3'], missingTeams: [...ctx.ghosts['EPIC-3'].missingTeams, BETA_MISSING] };
    const gate = deferred();
    ctx.respond(call => call.pathname === '/api/eng/story-readiness' && call.params.epicKeys, async () => { await gate.promise; });
    await watchGhostBlink(page, 'EPIC-2');
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicReadinessCalls(ctx.calls.slice(since)).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-3');
    // The per-epic call is in flight: every ghost is still shown, nothing was blanked.
    await expect(ghostCards(page, 'EPIC-2')).toHaveCount(1);
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(1);
    gate.resolve();
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(2);
    await expect(ghostCards(page, 'EPIC-2')).toHaveCount(1);
    await page.waitForTimeout(600);

    const after = ctx.calls.slice(since);
    expect(readinessCalls(after).map(call => call.params.epicKeys), 'no department-wide readiness request').toEqual(['EPIC-3']);
    expect(await page.evaluate(() => window.__ghostBlink), 'the other epic\'s ghost never blinked').toBe(false);
    const missing = missingInfoCalls(after);
    expect(missing).toHaveLength(1);
    expect(missing[0].params).toMatchObject({ epicKeys: 'EPIC-3', refresh: 'true', sprint: String(SPRINT_ID) });
    expect(backlogCalls(after), 'the sprint is active: no Backlog call').toEqual([]);
    expect(describeCalls(otherAlertCalls(after, 'EPIC-3', ['/api/missing-info', '/api/eng/story-readiness']))).toEqual([]);
    assertScopedCalls(ctx.calls, since, 'EPIC-3', storyKeysOf(ctx.scenario, 'EPIC-3'));
});

test('46. a per-epic readiness answer without the epic removes only that epic\'s ghost', async ({ page }) => {
    const ctx = await openWithGhosts(page);
    addBlockedEpic3Story(ctx);
    delete ctx.ghosts['EPIC-3'];
    await watchGhostBlink(page, 'EPIC-2');
    await clickRefresh(page, 'EPIC-3');
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(0);
    await expect(ghostCards(page, 'EPIC-2')).toHaveCount(1);
    expect(await page.evaluate(() => window.__ghostBlink)).toBe(false);
});

for (const failing of [500, 403, 429]) {
    test(`47. a per-epic readiness call that fails with ${failing} leaves the ghosts untouched, raises no banner and is not retried`, async ({ page }) => {
        const ctx = await openWithGhosts(page);
        addBlockedEpic3Story(ctx);
        delete ctx.ghosts['EPIC-3']; // a successful answer would remove the ghost: only the failure keeps it
        ctx.respond(call => call.pathname === '/api/eng/story-readiness' && call.params.epicKeys, ({ status }) => status(failing, { error: 'story_readiness_unavailable', ...LEAK_CANARIES }));
        const since = ctx.calls.length;
        await clickRefresh(page, 'EPIC-3');
        await expect.poll(() => epicReadinessCalls(ctx.calls.slice(since)).length).toBe(1);
        await expectRefreshSettled(page, 'EPIC-3');
        await expect(taskCard(page, 'E3-S02')).toHaveCount(1);
        await page.waitForTimeout(700);
        await expect(ghostCards(page, 'EPIC-3')).toHaveCount(1);
        await expect(ghostCards(page, 'EPIC-2')).toHaveCount(1);
        await expect(globalErrorSurfaces(page)).toHaveCount(0);
        await expect(refreshButton(page, 'EPIC-3')).not.toHaveAttribute('data-state', 'error');
        await expect(statusRegion(page)).not.toHaveText('Epic refresh failed');
        await expectNoLeak(page);
        expect(epicReadinessCalls(ctx.calls.slice(since)), 'a failed call is not retried').toHaveLength(1);
    });
}

test('48. a story status change re-checks readiness but not Missing Info or Backlog; a team change re-checks Missing Info and readiness only', async ({ page }) => {
    test.setTimeout(60000);
    // The group holds a second team, so a story that changes team stays in the group (a team outside it would leave the epic's lists).
    const ctx = await openWithGhosts(page, { prepare: (mock) => mock.respond('/api/groups-config', ({ json }) => json({
        ...groupsConfigPayload, groups: [{ ...groupsConfigPayload.groups[0], teamIds: ['team-alpha', 'team-beta'] }],
    })) });
    setStory(ctx, 'E3-S01', { status: { name: 'Incomplete' } });
    let since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicReadinessCalls(ctx.calls.slice(since)).length).toBe(1);
    await expect.poll(() => epicAlertCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-3');
    await page.waitForTimeout(600);
    expect(missingInfoCalls(ctx.calls.slice(since)), 'a status change needs no Missing Info call').toEqual([]);
    expect(backlogCalls(ctx.calls.slice(since))).toEqual([]);

    // Team: only Missing Info and readiness, not the epic-alerts / ready-to-close pair.
    setStory(ctx, 'E3-S01', { teamId: 'team-beta', teamName: 'Beta Team' });
    await parkPointer(page);
    await page.waitForTimeout(10500); // the per-epic refresh cooldown
    since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicReadinessCalls(ctx.calls.slice(since)).length).toBe(1);
    await expect.poll(() => missingInfoCalls(ctx.calls.slice(since)).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-3');
    await page.waitForTimeout(600);
    expect(epicAlertCalls(ctx.calls.slice(since))).toEqual([]);
    expect(epicReadyToCloseCalls(ctx.calls.slice(since), 'EPIC-3')).toEqual([]);
    expect(backlogCalls(ctx.calls.slice(since))).toEqual([]);
    assertScopedCalls(ctx.calls, since, 'EPIC-3', storyKeysOf(ctx.scenario, 'EPIC-3'));
});

test('49. stale readiness assignee never shadows an epic assignee the refresh cleared', async ({ page }) => {
    const ctx = await openWithGhosts(page);
    const assignee = epicHeader(page, 'EPIC-3').locator('.epic-assignee .issue-person-editor-trigger');
    await expect(assignee).toHaveValue('Cormac Lead');
    ctx.scenario.epics['EPIC-3'].assignee = null; // cleared in Jira; the held ghost payload still says 'Epic Lead'
    await clickRefresh(page, 'EPIC-3');
    await expectRefreshSettled(page, 'EPIC-3');
    await page.waitForTimeout(600);
    await expect(assignee).not.toHaveValue('Cormac Lead');
    await expect(assignee).not.toHaveValue('Epic Lead');
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(1);
});

test('50. a department reload while the readiness call is in flight discards its result', async ({ page }) => {
    const ctx = await openWithGhosts(page);
    addBlockedEpic3Story(ctx);
    const gate = deferred();
    ctx.respond(call => call.pathname === '/api/eng/story-readiness' && call.params.epicKeys, async ({ json }) => { await gate.promise; return json(readinessSnapshotFor([])); });
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => epicReadinessCalls(ctx.calls).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-3');

    const sinceGlobal = ctx.calls.length;
    await globalRefreshButton(page).click();
    await expect.poll(() => readinessCalls(ctx.calls.slice(sinceGlobal)).filter(call => !call.params.epicKeys).length).toBeGreaterThan(0);
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(1);
    gate.resolve();
    await page.waitForTimeout(700); // the late answer would remove the ghost here
    await expect(ghostCards(page, 'EPIC-3')).toHaveCount(1);
});

// The server's Missing Info answer per epic: `ctx.missing` maps a story key to the names it reports; `ctx.missingEpics` lists the epics in scope.
async function openWithEpicAwareMissingInfo(page) {
    const ctx = await mockDashboard(page);
    ctx.missing = { 'E1-S02': ['Story Points'], 'E1-S04': ['Story Points'], 'E1-S05': ['Story Points'], 'E3-S01': ['Story Points'] };
    ['E1-S02', 'E1-S04', 'E1-S05', 'E3-S01'].forEach(key => setStory(ctx, key, { customfield_10004: null }));
    ctx.missingEpics = { 'EPIC-1': true, 'EPIC-3': true };
    ctx.respond('/api/missing-info', ({ json, call }) => {
        const epicKey = call.params.epicKeys;
        const issues = Object.entries(ctx.missing)
            .map(([key, names]) => missingInfoEntry(ctx.scenario.stories.find(story => story.key === key), names))
            .filter(row => !epicKey || row.fields.epicKey === epicKey);
        const epics = Object.keys(ctx.missingEpics).filter(key => ctx.missingEpics[key] && (!epicKey || key === epicKey))
            .map(key => ({ key, summary: ctx.scenario.epics[key].summary, status: ctx.scenario.epics[key].status }));
        return json({ issues, epics, count: issues.length, epicCount: epics.length });
    });
    await openCatchUp(page, ctx);
    await expect(missingRows(page)).toHaveCount(4);
    return ctx;
}

// The Missing Info alert also lists stories the client finds incomplete in the visible lists, so a row cannot tell the server-held entries
// (`missingPlanningInfoTasks`) apart from the client-derived ones. Like `heldCopyCount`, this reads the mounted app's hook state: it returns
// the keys of the held Missing Info entries (the only state array whose items carry `fields.missingFields`).
const heldMissingKeys = page => page.evaluate(() => {
    const host = document.getElementById('root');
    const containerKey = Object.keys(host).find(name => name.startsWith('__reactContainer$'));
    const seen = new Set();
    const stack = [host[containerKey]];
    const keys = new Set();
    while (stack.length) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        for (let hook = fiber.memoizedState; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
            const state = hook.memoizedState;
            if (Array.isArray(state) && state.length && state.every(item => Array.isArray(item?.fields?.missingFields))) state.forEach(item => keys.add(item.key));
        }
        stack.push(fiber.child, fiber.sibling);
    }
    return [...keys].sort();
});
const HELD_BEFORE = ['E1-S02', 'E1-S04', 'E1-S05', 'E3-S01'];

test('51. a story added to the epic appears in Missing Info from an epic-scoped call; other epics\' entries stay', async ({ page }) => {
    const ctx = await openWithEpicAwareMissingInfo(page);
    expect(await heldMissingKeys(page)).toEqual(HELD_BEFORE);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: null }));
    ctx.missing['E1-S13'] = ['Story Points'];
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => heldMissingKeys(page)).toEqual([...HELD_BEFORE, 'E1-S13'].sort());
    await expectRefreshSettled(page, 'EPIC-1');
    await expect(missingRows(page).filter({ hasText: 'E1-S13' }).locator('.alert-pill.status')).toHaveText('Missing: Story Points');
    const calls = missingInfoCalls(ctx.calls.slice(since));
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({ epicKeys: 'EPIC-1', refresh: 'true', sprint: String(SPRINT_ID) });
    expect(describeCalls(otherAlertCalls(ctx.calls.slice(since), 'EPIC-1', ['/api/missing-info', '/api/eng/story-readiness']))).toEqual([]);
    assertScopedCalls(ctx.calls, since, 'EPIC-1', storyKeysOf(ctx.scenario, 'EPIC-1'));
});

test('52. an epic-scoped Missing Info answer that omits held issues keeps them (partial data), a failed call keeps them too', async ({ page }) => {
    const ctx = await openWithEpicAwareMissingInfo(page);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: 2 }));
    ctx.missing = {}; // the server says nothing is missing any more, but the epic is still in scope
    let since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => missingInfoCalls(ctx.calls.slice(since)).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600);
    expect(await heldMissingKeys(page)).toEqual(HELD_BEFORE);

    // A failed call: the same.
    ctx.scenario.stories.push(buildStory('E3-S02', 'EPIC-3', { points: 2 }));
    ctx.respond('/api/missing-info', ({ status, call }) => (call.params.epicKeys ? status(500, { error: 'internal_error', ...LEAK_CANARIES }) : undefined));
    since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-3');
    await expect.poll(() => missingInfoCalls(ctx.calls.slice(since)).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-3');
    await page.waitForTimeout(600);
    expect(await heldMissingKeys(page)).toEqual(HELD_BEFORE);
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expect(statusRegion(page)).not.toHaveText('Epic refresh failed');
    await expectNoLeak(page);
    expect(missingInfoCalls(ctx.calls.slice(since)), 'a failed call is not retried').toHaveLength(1);
});

test('53. an epic that left the Missing Info scope loses its issues; other epics\' issues stay', async ({ page }) => {
    const ctx = await openWithEpicAwareMissingInfo(page);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: 2 }));
    ctx.missing = { 'E3-S01': ['Story Points'] };
    ctx.missingEpics = { 'EPIC-3': true }; // EPIC-1 is no longer in scope: the epic search of the scoped call answers nothing
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => heldMissingKeys(page)).toEqual(['E3-S01']);
});

test('54. a department reload while the Missing Info call is in flight discards its result', async ({ page }) => {
    const ctx = await openWithEpicAwareMissingInfo(page);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: null }));
    ctx.missing['E1-S13'] = ['Story Points'];
    const gate = deferred();
    const release = ctx.respond(call => call.pathname === '/api/missing-info' && call.params.epicKeys, async () => { await gate.promise; });
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => missingInfoCalls(ctx.calls).filter(call => call.params.epicKeys).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-1');
    // The department reload below does not know about E1-S13 (the server answer is rewound), so a late merge would add its entry.
    delete ctx.missing['E1-S13'];
    const sinceGlobal = ctx.calls.length;
    await globalRefreshButton(page).click();
    await expect.poll(() => missingInfoCalls(ctx.calls.slice(sinceGlobal)).filter(call => !call.params.epicKeys).length).toBeGreaterThan(0);
    await expect.poll(() => heldMissingKeys(page)).toEqual(HELD_BEFORE);
    ctx.missing['E1-S13'] = ['Story Points'];
    gate.resolve();
    release();
    await page.waitForTimeout(700);
    expect(await heldMissingKeys(page)).toEqual(HELD_BEFORE);
});

// ---- Backlog (future sprint only) ----

// Future sprint with a remote Backlog entry for EPIC-1 (the epic has no sprint value) served by an epic-aware /api/backlog-epics.
async function openFutureSprintWithBacklogEntry(page) {
    const ctx = await mockDashboard(page);
    ctx.backlog = { 'EPIC-1': { key: 'EPIC-1', summary: 'EPIC-1 backlog entry', status: { name: 'To Do' }, assignee: { displayName: 'Epic Lead' }, components: ['C'], labels: [], teamId: 'team-alpha', teamName: 'Alpha Team', fields: { customfield_10101: [] }, cleanupStoryCount: 2 } };
    ctx.respond('/api/sprints', ({ json }) => json({ sprints: [
        { id: SPRINT_ID, name: SPRINT_NAME, state: 'active', startDate: '2026-05-01' },
        { id: FUTURE_SPRINT_ID, name: FUTURE_SPRINT_NAME, state: 'future', startDate: '2026-08-01' },
    ] }));
    ctx.respond('/api/backlog-epics', ({ json, call }) => json({ epics: Object.values(ctx.backlog).filter(epic => !call.params.epicKeys || epic.key === call.params.epicKeys) }));
    ctx.epicInScope = true;
    ctx.respond(call => call.params.purpose === 'epic-alerts', ({ json, call }) => json({
        epicsInScope: ctx.epicInScope && call.params.project === 'product' && call.params.epicKeys === 'EPIC-1' ? [{ ...ctx.scenario.epics['EPIC-1'], totalStories: 12 }] : [],
    }));
    await openCatchUp(page, ctx, { prefs: { selectedSprint: FUTURE_SPRINT_ID, sprintName: FUTURE_SPRINT_NAME } });
    await expect(backlogRows(page)).toHaveCount(1);
    await expect(backlogRows(page).first()).toContainText('EPIC-1 backlog entry');
    return ctx;
}

test('55. in a future sprint a membership change issues one epic-scoped Backlog call per lane and the entry is replaced in place', async ({ page }) => {
    const ctx = await openFutureSprintWithBacklogEntry(page);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: 2 }));
    ctx.backlog['EPIC-1'] = { ...ctx.backlog['EPIC-1'], summary: 'EPIC-1 backlog entry refreshed' };
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect(backlogRows(page).first()).toContainText('EPIC-1 backlog entry refreshed');
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600);
    await expect(backlogRows(page)).toHaveCount(1);
    const calls = backlogCalls(ctx.calls.slice(since));
    expect(calls.map(call => call.params.project).sort()).toEqual(['product', 'tech']);
    calls.forEach(call => expect(call.params.epicKeys).toBe('EPIC-1'));
    expect(describeCalls(otherAlertCalls(ctx.calls.slice(since), 'EPIC-1', ['/api/missing-info', '/api/eng/story-readiness', '/api/backlog-epics']))).toEqual([]);
    assertScopedCalls(ctx.calls, since, 'EPIC-1', storyKeysOf(ctx.scenario, 'EPIC-1'));
});

test('56. an empty Backlog answer keeps the entry unless the epic-alerts call proves the epic left scope; a failed call keeps it', async ({ page }) => {
    test.setTimeout(90000);
    const ctx = await openFutureSprintWithBacklogEntry(page);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: 2 }));
    ctx.backlog = {}; // the endpoint answers 200 with nothing (also what it does when its own epic search fails)
    let since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => backlogCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(700);
    await expect(backlogRows(page)).toHaveCount(1);

    // A failed Backlog call keeps the entry as well.
    ctx.scenario.stories.push(buildStory('E1-S14', 'EPIC-1', { points: 2 }));
    const failBacklog = ctx.respond('/api/backlog-epics', ({ status, call }) => (call.params.epicKeys ? status(500, { error: 'internal_error', ...LEAK_CANARIES }) : undefined));
    await page.waitForTimeout(10500); // the per-epic refresh cooldown
    since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => backlogCalls(ctx.calls.slice(since)).length).toBe(2);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(700);
    await expect(backlogRows(page)).toHaveCount(1);
    await expect(globalErrorSurfaces(page)).toHaveCount(0);
    await expectNoLeak(page);

    // The epic left scope (a successful empty epic-alerts answer): the entry goes.
    failBacklog();
    ctx.epicInScope = false;
    ctx.scenario.stories.push(buildStory('E1-S15', 'EPIC-1', { points: 2 }));
    await page.waitForTimeout(10500);
    await clickRefresh(page, 'EPIC-1');
    await expect(backlogRows(page)).toHaveCount(0);
});

test('57. in an active sprint a membership change issues no Backlog call', async ({ page }) => {
    const ctx = await mockDashboard(page);
    await openCatchUp(page, ctx);
    ctx.scenario.stories.push(buildStory('E1-S13', 'EPIC-1', { points: 2 }));
    const since = ctx.calls.length;
    await clickRefresh(page, 'EPIC-1');
    await expect.poll(() => missingInfoCalls(ctx.calls.slice(since)).length).toBe(1);
    await expectRefreshSettled(page, 'EPIC-1');
    await page.waitForTimeout(600);
    expect(backlogCalls(ctx.calls.slice(since))).toEqual([]);
});

test('58. a held readiness initiative never shadows the omitted initiative key of refreshed epic details', async ({ page }) => {
    const ctx = await openWithGhosts(page);
    ctx.ghosts['EPIC-2'] = { ...ctx.ghosts['EPIC-2'], initiative: { key: 'INIT-1', summary: 'Synthetic initiative' } };
    await page.reload({ waitUntil: 'networkidle' });
    await expect(ghostCards(page, 'EPIC-2')).toHaveCount(1);
    await expect(page.locator('.initiative-body > .epic-block[data-epic-key="EPIC-2"]')).toHaveCount(1);
    delete ctx.scenario.epics['EPIC-2'].initiative; // the server omits the key when the epic has no Initiative parent
    ctx.respond(call => call.pathname === '/api/eng/story-readiness' && call.params.epicKeys, ({ status }) => status(500, { error: 'story_readiness_unavailable' }));
    await clickRefresh(page, 'EPIC-2');
    await expectRefreshSettled(page, 'EPIC-2');
    await expect(page.locator('.initiative-body > .epic-block[data-epic-key="EPIC-2"]')).toHaveCount(0);
    await expect(epicBlock(page, 'EPIC-2')).toBeVisible();
});

// ---- test 26 (load_performance run) is a command, see the report ----
