const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

// Moving an epic by dragging its card (§6.4, §9.5, §10.1, §10.2, §10.3, D37, D42) — a second
// TRIGGER for the status transition the app already performs: same hook, same route, same menu,
// same optimistic patch and refresh. What is asserted here is the resolution (a column is a set of
// statuses), the refusal path, the unresolved-story gate, and the two guardrails the plan attaches
// to them: the drop menu is hit-testable with a PLAIN click, and drag never becomes the only way
// to change a status.

const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-group-board-drag');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

// Board reading order left to right. "Doing" is starred, so it is the focused/open column and
// every card starts on screen; every other column is a FOLDED rail, which is exactly the drop
// target §6.4 requires to work without unfolding.
const BOARD_COLUMNS = [
    { id: 'col-ready', name: 'Ready', colour: '#8c8c8c', star: false, min: null, max: null, statuses: ['To Do', 'Analysis'] },
    { id: 'col-doing', name: 'Doing', colour: '#597ef7', star: true, min: null, max: null, statuses: ['In Progress', 'Blocked'] },
    { id: 'col-wrap', name: 'Wrap up', colour: '#13c2c2', star: false, min: null, max: null, statuses: ['Release'] },
    { id: 'col-done', name: 'Done', colour: '#52c41a', star: false, min: null, max: 1, statuses: ['Done', 'Killed', 'Incomplete'] },
];

// What Jira offers for each epic RIGHT NOW. The intersection with a column's statuses is the whole
// subject of §6.4, so these deliberately overlap the columns only partially.
const OFFERED_TRANSITIONS = {
    // Done column holds Done/Killed/Incomplete; Jira offers Done and Killed but NOT Incomplete,
    // and offers Release/To Do which the Done column does not hold.
    'PLAT-1': ['Done', 'Killed', 'Release', 'To Do', 'Analysis'],
    'CORE-2': ['Done', 'Incomplete'],
    // Nothing WEB-3 can become is in Ready, Wrap up or Done — the refusal path.
    'WEB-3': ['Blocked'],
    'OPS-5': ['In Progress'],
};

// The board's own status catalog, as GET /api/board-config/statuses returns it. `Shipped` is a
// `done`-category status that is NOT one of the three literal resolution names, which is the only
// way to exercise D42's general case: without a category the gate would let it through silently.
const STATUS_CATALOG = [
    { id: '10000', name: 'To Do', statusCategoryKey: 'new' },
    { id: '10001', name: 'Analysis', statusCategoryKey: 'indeterminate' },
    { id: '10002', name: 'In Progress', statusCategoryKey: 'indeterminate' },
    { id: '10003', name: 'Blocked', statusCategoryKey: 'new' },
    { id: '10004', name: 'Release', statusCategoryKey: 'indeterminate' },
    { id: '10005', name: 'Done', statusCategoryKey: 'done' },
    { id: '10006', name: 'Killed', statusCategoryKey: 'done' },
    { id: '10007', name: 'Incomplete', statusCategoryKey: 'done' },
    { id: '10008', name: 'Shipped', statusCategoryKey: 'done' },
];

// [key, status, storyCount, doneStoryCount]
// PLAT-1 keeps three stories open, so a resolution status must confirm; CORE-2 has none open, so
// the same status must NOT confirm — "no confirmation for the correct case".
const EPIC_SPECS = [
    ['PLAT-1', 'In Progress', 5, 2],
    ['CORE-2', 'In Progress', 2, 2],
    ['WEB-3', 'In Progress', 1, 0],
    ['OPS-5', 'Done', 1, 1],
];

function epicPayload() {
    const epics = {};
    EPIC_SPECS.forEach(([key, status]) => {
        epics[key] = {
            key,
            summary: `${key} epic summary`,
            status,
            priority: 'Major',
            assignee: { displayName: 'Epic Owner' },
            deliveryOwner: null,
            projectTrack: null,
            updated: '2026-07-20T00:00:00.000+0000',
        };
    });
    return epics;
}

function storyPayload() {
    const stories = [];
    EPIC_SPECS.forEach(([epicKey, , total, done]) => {
        for (let index = 0; index < total; index += 1) {
            stories.push({
                id: `${epicKey}-s${index}`,
                key: `${epicKey}-s${index}`,
                fields: {
                    summary: `${epicKey} story ${index}`,
                    status: { name: index < done ? 'Done' : 'To Do' },
                    priority: { name: 'Major' },
                    issuetype: { name: 'Story' },
                    assignee: null,
                    updated: '2026-07-28T00:00:00.000+0000',
                    customfield_10004: 2,
                    epicKey,
                    parentSummary: `${epicKey} epic summary`,
                    projectKey: 'PLAT',
                    teamId: 'team-alpha',
                    teamName: 'Alpha Team',
                    sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                },
            });
        }
    });
    return stories;
}

async function installBoardFixture(page, calls, {
    columns = BOARD_COLUMNS,
    offered = OFFERED_TRANSITIONS,
    statusCatalog = STATUS_CATALOG,
    analyticsContext = { enabled: false },
    transitionGate = null,
    optionsGate = null,
    transitionFails = false,
} = {}) {
    await installDashboardShell(page);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let body = null;
        try {
            body = request.postData() ? JSON.parse(request.postData()) : null;
        } catch (error) {
            body = null;
        }
        calls.push({ method: request.method(), pathname: url.pathname, body });
        const json = (payload, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        }
        if (url.pathname === '/api/analytics/context') return json(analyticsContext);
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
                    teamIds: ['team-alpha'],
                    teamLabels: { 'team-alpha': 'Alpha Team' },
                    board: { columns },
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
            const purpose = url.searchParams.get('purpose');
            const project = url.searchParams.get('project');
            if (purpose === 'ready-to-close' || project === 'tech') {
                return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            }
            const epics = epicPayload();
            return json({ issues: storyPayload(), epics, epicsInScope: Object.values(epics), names: {} });
        }
        if (url.pathname === '/api/issues/statuses/catalog') return json({ statuses: statusCatalog });
        if (url.pathname === '/api/issues/transitions/options') {
            if (optionsGate) await optionsGate;
            const keys = (body && body.issueKeys) || [];
            const names = keys.flatMap((key) => offered[key] || []);
            return json({
                issues: keys.map((key) => ({
                    key,
                    issueType: 'Epic',
                    currentStatus: 'In Progress',
                    transitions: (offered[key] || []).map((name) => ({ name: `Go ${name}`, toStatus: name })),
                })),
                targetStatuses: [...new Set(names)].map((name) => ({ name, availableCount: 1, blockedCount: 0 })),
            });
        }
        if (url.pathname === '/api/issues/transitions') {
            if (transitionGate) await transitionGate;
            const keys = (body && body.issueKeys) || [];
            const targetStatus = (body && body.targetStatus) || '';
            if (transitionFails) {
                return json({ error: 'issue_transition_failed', message: 'Jira rejected the transition.' }, 502);
            }
            return json({
                targetStatus,
                results: keys.map((key) => ({ key, result: 'success', toStatus: targetStatus })),
            });
        }
        if (url.pathname === '/api/issues/priorities/options') return json({ priorities: [], source: 'jira' });
        if (url.pathname === '/api/issues/project-track/options') return json({ options: [] });
        if (url.pathname === '/api/issues/description') {
            return json({ key: url.searchParams.get('key'), html: '<p>Body</p>', isEmpty: false });
        }
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'test-token' });
        if (url.pathname === '/api/issues/subtasks') return json({ parentKey: '', subtasks: [], summary: null });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function loadDashboard(page, calls, options = {}) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: options.width || 1280, height: options.height || 900 });
    await installBoardFixture(page, calls, options);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showBoard: Boolean(options.showBoard ?? true),
        showPlanning: Boolean(options.showPlanning ?? false),
        showScenario: false,
        showAlertsPanel: false,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
}

async function openBoard(page, calls, options = {}) {
    await loadDashboard(page, calls, options);
    await page.waitForSelector('.eng-board .col', { timeout: 10000 });
    await expect(card(page, 'PLAT-1')).toBeVisible();
}

const card = (page, key) => page.locator(`.eng-board .ecard[data-epic-key="${key}"]`);
const column = (page, id) => page.locator(`.eng-board .col[data-column-id="${id}"]`);
const columnCount = (page, id) => column(page, id).locator('.col-head .ct');
const dropMenu = (page) => page.locator('.eng-board-drop-menu');
const menuOptions = (page) => dropMenu(page).locator('.status-transition-option');
const liveRegion = (page) => page.locator('.eng-board .board-say');

const transitionCalls = (calls) => calls.filter((call) => call.pathname === '/api/issues/transitions' && call.method === 'POST');
const optionCalls = (calls) => calls.filter((call) => call.pathname === '/api/issues/transitions/options');

// Playwright's native drag interception picks the drag source from the pointer position AFTER its
// synthetic move rather than from the element the press landed on, and `dragTo` can only express a
// completed drop — not the three shapes this feature needs: a dragover that must NOT be accepted,
// a dragend with no drop, and a drop whose clientX/clientY place a fixed menu. So the gesture is
// driven the faithful way instead: the DragEvent sequence a browser raises, dispatched on the real
// nodes with real coordinates read from the live target rect. Every handler, the resolution, the
// gate, the React state and the DOM are the real ones; only the browser's own drag loop is stood
// in for — and the last test in this file drives that loop end to end with `dragTo` as well.
//
// Task 7's composer helper additionally holds a real pointer press, because its chip drag is gated
// on the grip the press lands on. An epic card has no such gate: a press here only risks starting
// Chromium's OWN drag alongside the dispatched one (two drops, one of them deduped to a null
// options response) and synthesising a click that opens the epic panel. It is deliberately absent.
async function dragCard(page, epicKey, targetColumnId, { drop = true, end = true, at = null } = {}) {
    return page.evaluate(({ key, columnId, doDrop, doEnd, point }) => {
        const source = document.querySelector(`.eng-board .ecard[data-epic-key="${key}"]`);
        const target = columnId ? document.querySelector(`.eng-board .col[data-column-id="${columnId}"]`) : null;
        const dataTransfer = new DataTransfer();
        const box = target ? target.getBoundingClientRect() : null;
        const spot = point || (box
            ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + Math.min(box.height / 2, 160)) }
            : { x: 4, y: 4 });
        const make = (type) => new DragEvent(type, {
            bubbles: true, cancelable: true, dataTransfer, clientX: spot.x, clientY: spot.y,
        });

        const start = make('dragstart');
        source.dispatchEvent(start);
        if (start.defaultPrevented) {
            source.dispatchEvent(make('dragend'));
            return { started: false, spot };
        }
        let overAccepted = null;
        if (target) {
            target.dispatchEvent(make('dragenter'));
            const over = make('dragover');
            target.dispatchEvent(over);
            overAccepted = over.defaultPrevented;
            if (doDrop) target.dispatchEvent(make('drop'));
        }
        if (doEnd) source.dispatchEvent(make('dragend'));
        return { started: true, overAccepted, spot };
    }, { key: epicKey, columnId: targetColumnId, doDrop: drop, doEnd: end, point: at });
}

// The pointer leaving a column. `intoChild` is the case a naive handler gets wrong: dragleave also
// fires on the column when the pointer moves onto one of its own descendants, and clearing there
// would flicker the outline off while the pointer is still over a valid target.
async function dispatchDragLeave(page, columnId, { intoChild = false } = {}) {
    await page.evaluate(({ id, toChild }) => {
        const target = document.querySelector(`.eng-board .col[data-column-id="${id}"]`);
        target.dispatchEvent(new DragEvent('dragleave', {
            bubbles: true,
            cancelable: true,
            dataTransfer: new DataTransfer(),
            clientX: 2,
            clientY: 2,
            relatedTarget: toChild ? target.querySelector('.col-strip') : null,
        }));
    }, { id: columnId, toChild: intoChild });
}

// Ends a drag that was left open by `end: false`, from wherever the pointer is now.
async function endDrag(page, epicKey) {
    await page.evaluate((key) => {
        const source = document.querySelector(`.eng-board .ecard[data-epic-key="${key}"]`);
        source.dispatchEvent(new DragEvent('dragend', {
            bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), clientX: 2, clientY: 2,
        }));
    }, epicKey);
}

function deferred() {
    let release = () => {};
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
}

/* ── The card is a drag source, and the source column is inert ──────────────────────────────── */

test('the epic card is a draggable button and the source column is never a drop target', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await expect(card(page, 'PLAT-1')).toHaveJSProperty('tagName', 'BUTTON');
    await expect(card(page, 'PLAT-1')).toHaveAttribute('draggable', 'true');

    // Dropping an epic where it already is would be a no-op, so the source column neither accepts
    // the dragover (no preventDefault) nor highlights.
    const outcome = await dragCard(page, 'PLAT-1', 'col-doing');
    expect(outcome.overAccepted).toBe(false);
    await expect(page.locator('.eng-board .col.is-drop')).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
    await expect(card(page, 'PLAT-1')).toBeVisible();
    await expect(page.locator('.epic-panel')).toHaveCount(0);
});

test("Chromium's own drag loop moves the epic, and does not open the panel on the way", async ({ page }) => {
    // The dispatched helper above stands in for the browser's drag loop so the refusal, the
    // cancelled drag and the drop point can be expressed at all. This one drives the real loop end
    // to end, so `draggable` and the handlers are proven under it too — including that a completed
    // drag is not also a click.
    const calls = [];
    await openBoard(page, calls);

    await card(page, 'PLAT-1').dragTo(column(page, 'col-wrap'));

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['PLAT-1'], targetStatus: 'Release' });
    await expect(page.locator('.epic-panel')).toHaveCount(0);
    await expect(page.locator('.eng-board .col.is-drop')).toHaveCount(0);
});

test('a target column highlights in its own colour, and the highlight clears on dragend even outside any column', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done', { drop: false, end: false });
    const target = column(page, 'col-done');
    await expect(target).toHaveClass(/is-drop/);
    // Its OWN column colour, read computed — an outline written from an undefined custom property
    // would leave the declaration in place and paint nothing.
    const outlineColour = await target.evaluate((node) => getComputedStyle(node).outlineColor);
    expect(outlineColour).toBe('rgb(82, 196, 26)');
    await expect(page.locator('.eng-board .col.is-drop')).toHaveCount(1);

    // The pointer ends nowhere near a column, and the highlight still clears.
    await endDrag(page, 'PLAT-1');
    await expect(page.locator('.eng-board .col.is-drop')).toHaveCount(0);
    await expect(page.locator('.eng-board .ecard.is-dragging')).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
});

/* ── Resolving the drop: one, several, none (§6.4) ──────────────────────────────────────────── */

test('one eligible status transitions straight through, with the dragged epic as the only key', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    // Wrap up holds one status (Release) and Jira offers it, so there is nothing to ask.
    await dragCard(page, 'PLAT-1', 'col-wrap');

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['PLAT-1'], targetStatus: 'Release' });
    await expect(dropMenu(page)).toHaveCount(0);
    await expect(liveRegion(page)).toHaveText('PLAT-1 → Release · Doing → Wrap up');
});

test('several eligible statuses open the menu scoped to the intersection, and nothing has moved yet', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    await expect(dropMenu(page)).toBeVisible();

    // The column holds Done · Killed · Incomplete and Jira offers Done · Killed · Release · To Do.
    // The menu is the intersection: Incomplete (column, not offered) and Release/To Do (offered,
    // not in the column) are both absent.
    await expect(menuOptions(page)).toHaveText(['Done', 'Killed']);
    // Ask, then commit: no write, and the card is still in its source column.
    expect(transitionCalls(calls)).toHaveLength(0);
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(3);
    await expect(columnCount(page, 'col-done')).toHaveText('1');

    await page.screenshot({ path: path.join(screenshotDir, 'scoped-drop-menu.png'), animations: 'disabled' });
});

test('no eligible status refuses: nothing moves, no write is issued, and the reason is stated', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    // WEB-3 can only become Blocked, which Ready does not hold.
    await dragCard(page, 'WEB-3', 'col-ready');

    await expect(liveRegion(page)).toHaveText('WEB-3 — Jira offers no transition into Ready. Nothing moved.');
    await expect(liveRegion(page)).toHaveClass(/is-error/);
    await expect(card(page, 'WEB-3')).toHaveClass(/is-rejected/);
    await expect(dropMenu(page)).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(3);
    await expect(columnCount(page, 'col-ready')).toHaveText('0');

    await page.screenshot({ path: path.join(screenshotDir, 'refused-drop.png'), animations: 'disabled' });
});

test('the card does not move on drop — nothing commits until a status is chosen', async ({ page }) => {
    const calls = [];
    const gate = deferred();
    await openBoard(page, calls, { optionsGate: gate.promise });

    // Ready holds To Do and Analysis, and Jira offers both, so this drop has to ask.
    await dragCard(page, 'PLAT-1', 'col-ready');

    // While Jira is still being asked, the drop has committed nothing.
    await expect.poll(() => optionCalls(calls).length).toBe(1);
    await expect(card(page, 'PLAT-1')).toBeVisible();
    await expect(columnCount(page, 'col-ready')).toHaveText('0');
    expect(transitionCalls(calls)).toHaveLength(0);

    gate.release();
    await expect(menuOptions(page)).toHaveText(['To Do', 'Analysis']);
    // The menu is open and STILL nothing has moved.
    await expect(card(page, 'PLAT-1')).toBeVisible();
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(3);
    await expect(columnCount(page, 'col-ready')).toHaveText('0');
    expect(transitionCalls(calls)).toHaveLength(0);

    await menuOptions(page).filter({ hasText: 'Analysis' }).click();
    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    await expect(columnCount(page, 'col-ready')).toHaveText('1');
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(2);
});

test('the optimistic patch moves the card while the write is still in flight', async ({ page }) => {
    const calls = [];
    const gate = deferred();
    await openBoard(page, calls, { transitionGate: gate.promise });

    await dragCard(page, 'PLAT-1', 'col-wrap');
    await expect.poll(() => transitionCalls(calls).length).toBe(1);

    // The hook's own optimistic patch — the mechanism §13's widening exists for — lands before the
    // response, so a dragged card never sits still waiting for Jira and reads as a failed drop.
    await expect(columnCount(page, 'col-wrap')).toHaveText('1');
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(2);

    gate.release();
    await expect(columnCount(page, 'col-wrap')).toHaveText('1');
    await expect(liveRegion(page)).toHaveText('PLAT-1 → Release · Doing → Wrap up');
});

test('the outline clears when the pointer leaves every column mid-drag', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done', { drop: false, end: false });
    await expect(column(page, 'col-done')).toHaveClass(/is-drop/);

    // Moving onto one of the column's own descendants is not leaving it: the outline must hold.
    await dispatchDragLeave(page, 'col-done', { intoChild: true });
    await expect(column(page, 'col-done')).toHaveClass(/is-drop/);

    // Leaving it for the page behind clears the promise of a target the pointer is no longer over.
    await dispatchDragLeave(page, 'col-done');
    await expect(page.locator('.eng-board .col.is-drop')).toHaveCount(0);

    await endDrag(page, 'PLAT-1');
    expect(transitionCalls(calls)).toHaveLength(0);
});

test('a write that fails puts the card back in its source column', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { transitionFails: true });

    await dragCard(page, 'PLAT-1', 'col-wrap');
    await expect.poll(() => transitionCalls(calls).length).toBe(1);

    // The hook's optimistic patch is rolled back to the epic's REAL status — the drag borrows the
    // same single-issue target the status pill sets, so there is a status to roll back to.
    await expect(liveRegion(page)).toContainText('did not go through');
    await expect(card(page, 'PLAT-1')).toBeVisible();
    await expect(columnCount(page, 'col-doing')).toHaveText('3');
    await expect(columnCount(page, 'col-wrap')).toHaveText('0');
    await expect(page.locator('.eng-board .col[data-column-id="board-unmapped"]')).toHaveCount(0);
});

test('a folded rail accepts a drop without being unfolded first', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    // Wrap up is neither focused nor starred, so it renders as a rail with no body.
    await expect(column(page, 'col-wrap')).not.toHaveClass(/is-focused/);
    await expect(column(page, 'col-wrap')).not.toHaveClass(/is-open/);
    await expect(column(page, 'col-wrap').locator('.ecard')).toHaveCount(0);

    const rail = column(page, 'col-wrap').locator('.col-strip');
    const box = await rail.boundingBox();
    await dragCard(page, 'PLAT-1', 'col-wrap', { at: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 40) } });

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    await expect(columnCount(page, 'col-wrap')).toHaveText('1');
    await expect(column(page, 'col-wrap')).not.toHaveClass(/is-focused/);
});

test('counts, bar heights, the shared scale and a Max breach all re-derive after a move', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    const railHeight = (id) => column(page, id).locator('.col-strip .fill')
        .evaluate((node) => node.style.height);
    const helpTrigger = page.getByRole('button', { name: 'How Group Board works' });
    const help = page.getByRole('dialog', { name: 'How Group Board works' });

    await helpTrigger.click();
    await expect(help).toContainText('The tallest bar represents 3 epics.');
    await page.keyboard.press('Escape');
    expect(await railHeight('col-doing')).toBe('100%');
    expect(await railHeight('col-done')).toBe('33%');
    await expect(column(page, 'col-done')).not.toHaveClass(/is-breach/);

    // CORE-2's stories are all done, so a resolution status needs no confirmation (D42).
    await dragCard(page, 'CORE-2', 'col-done');
    await expect(dropMenu(page)).toBeVisible();
    await menuOptions(page).filter({ hasText: 'Done' }).click();

    await expect(columnCount(page, 'col-done')).toHaveText('2');
    await expect(columnCount(page, 'col-doing')).toHaveText('2');
    // The tallest column changed, so the shared scale and every bar re-derive, not just these two.
    await helpTrigger.click();
    await expect(help).toContainText('The tallest bar represents 2 epics.');
    await page.keyboard.press('Escape');
    expect(await railHeight('col-doing')).toBe('100%');
    expect(await railHeight('col-done')).toBe('100%');
    // Max is 1 and the column now holds 2 — the breach is a fact about the work, and it glows now.
    await expect(column(page, 'col-done')).toHaveClass(/is-breach/);
    await expect(column(page, 'col-done').locator('.col-breach')).toHaveText('⚠ 1 over max 1');
});

/* ── The unresolved-story gate (D42) ────────────────────────────────────────────────────────── */

test('a status that is not a resolution moves with no extra step, however many stories are open', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    // PLAT-1 has three open stories, and Release is not a resolution status.
    await dragCard(page, 'PLAT-1', 'col-wrap');
    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    await expect(dropMenu(page)).toHaveCount(0);
});

test('a resolution status with every story done moves without a confirmation', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'CORE-2', 'col-done');
    await expect(menuOptions(page)).toHaveText(['Done', 'Incomplete']);
    await menuOptions(page).filter({ hasText: 'Done' }).first().click();

    // Straight to the write: no warning line, no second confirmation step.
    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['CORE-2'], targetStatus: 'Done' });
    await expect(page.locator('.eng-board-drop-warn')).toHaveCount(0);
});

test('a resolution status with open stories confirms once, inside the same menu', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    const menuHandle = await dropMenu(page).locator('.status-transition-menu').elementHandle();
    await menuOptions(page).filter({ hasText: 'Done' }).click();

    // One step further into the SAME menu — not a second popup, and no browser confirm().
    await expect(dropMenu(page)).toHaveCount(1);
    await expect(page.locator('.eng-board-drop-warn')).toHaveText('PLAT-1 has 3 open stories');
    await expect(menuOptions(page)).toHaveText(['Move to Done anyway', 'Keep it where it is']);
    expect(transitionCalls(calls)).toHaveLength(0);
    expect(await menuHandle.evaluate((node) => node.isConnected)).toBe(true);

    await page.screenshot({ path: path.join(screenshotDir, 'unresolved-story-confirmation.png'), animations: 'disabled' });

    // It warns, it never blocks: Jira allows it, so confirming performs it.
    await menuOptions(page).filter({ hasText: 'anyway' }).click();
    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['PLAT-1'], targetStatus: 'Done' });
    await expect(dropMenu(page)).toHaveCount(0);
});

test('the confirmation defaults to Keep it where it is, never the destructive answer', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    await menuOptions(page).filter({ hasText: 'Done' }).click();
    await expect(page.locator('.eng-board-drop-warn')).toBeVisible();

    // Enter on a warning must not perform the thing being warned about.
    await expect(menuOptions(page).filter({ hasText: 'Keep it where it is' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dropMenu(page)).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
    await expect(card(page, 'PLAT-1')).toBeFocused();
});

test('choosing a status returns focus to the card, like every other exit from the menu', async ({ page }) => {
    const calls = [];
    // Asserted on the failing write, because a SUCCESSFUL move legitimately unmounts the card as it
    // lands in another column — there is nothing left to focus. On a failure the card stays, and
    // focus must be on it rather than dropped to <body>.
    await openBoard(page, calls, { transitionFails: true });

    await dragCard(page, 'PLAT-1', 'col-ready');
    await menuOptions(page).filter({ hasText: 'Analysis' }).click();

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    await expect(liveRegion(page)).toContainText('did not go through');
    await expect(card(page, 'PLAT-1')).toBeFocused();
});

test('Keep it where it is leaves the epic exactly where it was and returns focus to the card', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    await menuOptions(page).filter({ hasText: 'Done' }).click();
    await menuOptions(page).filter({ hasText: 'Keep it where it is' }).click();

    await expect(dropMenu(page)).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(3);
    await expect(columnCount(page, 'col-done')).toHaveText('1');
    await expect(card(page, 'PLAT-1')).toBeFocused();
});

test('Escape dismisses the confirmation, leaves the epic in place and returns focus to the card', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    await menuOptions(page).filter({ hasText: 'Done' }).click();
    await expect(page.locator('.eng-board-drop-warn')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(dropMenu(page)).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
    await expect(column(page, 'col-doing').locator('.ecard')).toHaveCount(3);
    await expect(card(page, 'PLAT-1')).toBeFocused();
});

test('the gate fires for a done-category status that is not one of the three literal names', async ({ page }) => {
    const calls = [];
    // D42's general case: "resolved" is the `done` statusCategory, not a hard-coded name list. A
    // board whose resolution column is `Shipped` must gate exactly like one whose column is `Done`
    // — and the board only ever holds status NAMES, so the category has to be resolved against the
    // status catalog before the gate can see it.
    const columns = BOARD_COLUMNS.map((entry) => (
        entry.id === 'col-done' ? { ...entry, name: 'Shipped', max: null, statuses: ['Shipped'] } : entry
    ));
    await openBoard(page, calls, { columns, offered: { ...OFFERED_TRANSITIONS, 'PLAT-1': ['Shipped'] } });

    await dragCard(page, 'PLAT-1', 'col-done');

    await expect(page.locator('.eng-board-drop-warn')).toHaveText('PLAT-1 has 3 open stories');
    await expect(menuOptions(page)).toHaveText(['Move to Shipped anyway', 'Keep it where it is']);
    expect(transitionCalls(calls)).toHaveLength(0);

    // And it still warns rather than blocks.
    await menuOptions(page).filter({ hasText: 'anyway' }).click();
    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['PLAT-1'], targetStatus: 'Shipped' });
});

test('a done-category status with every story done still moves without a confirmation', async ({ page }) => {
    const calls = [];
    const columns = BOARD_COLUMNS.map((entry) => (
        entry.id === 'col-done' ? { ...entry, name: 'Shipped', max: null, statuses: ['Shipped'] } : entry
    ));
    await openBoard(page, calls, { columns, offered: { ...OFFERED_TRANSITIONS, 'CORE-2': ['Shipped'] } });

    // The general case must not over-fire either: CORE-2 has no open stories.
    await dragCard(page, 'CORE-2', 'col-done');

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['CORE-2'], targetStatus: 'Shipped' });
    await expect(page.locator('.eng-board-drop-warn')).toHaveCount(0);
});

test('the gate is reached from a single-status column too', async ({ page }) => {
    const calls = [];
    // The same board, except Done holds exactly one status — the gate is a property of the
    // destination status, not of how the status was chosen.
    const columns = BOARD_COLUMNS.map((entry) => (
        entry.id === 'col-done' ? { ...entry, statuses: ['Done'] } : entry
    ));
    await openBoard(page, calls, { columns });

    await dragCard(page, 'PLAT-1', 'col-done');

    // No status list step: the confirmation is the first thing the menu shows.
    await expect(page.locator('.eng-board-drop-warn')).toHaveText('PLAT-1 has 3 open stories');
    await expect(menuOptions(page)).toHaveText(['Move to Done anyway', 'Keep it where it is']);
    expect(transitionCalls(calls)).toHaveLength(0);
});

/* ── Guardrails (§10.1, §10.2, §9.5, §10.3) ─────────────────────────────────────────────────── */

test('the drop menu is not clipped by the board scroll container and is clickable with a plain click', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    await expect(dropMenu(page)).toBeVisible();

    // Appended to <body> and positioned fixed, so the board's overflow-x scroller cannot clip it.
    expect(await dropMenu(page).evaluate((node) => node.parentElement === document.body)).toBe(true);
    expect(await dropMenu(page).evaluate((node) => Boolean(node.closest('.board-scroll')))).toBe(false);
    const panel = dropMenu(page).locator('.status-transition-menu');
    expect(await panel.evaluate((node) => getComputedStyle(node.parentElement).position)).toBe('fixed');
    const clipped = await panel.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
            rect.width === 0 || rect.height === 0
            || rect.left < 0 || rect.top < 0
            || rect.right > document.documentElement.clientWidth
            || rect.bottom > window.innerHeight
        );
    });
    expect(clipped).toBe(false);

    // Hit-test with elementFromPoint, then a PLAIN click: click({ force: true }) would mask exactly
    // the layering bug this asserts and is forbidden in these specs (§10.2).
    const option = menuOptions(page).first();
    const box = await option.boundingBox();
    const onTop = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && hit.closest('.eng-board-drop-menu'));
    }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
    expect(onTop).toBe(true);
    await option.click();
    await expect(page.locator('.eng-board-drop-warn')).toBeVisible();
});

test('a card stops being draggable while the Settings modal makes the transition surface inert', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await expect(card(page, 'PLAT-1')).toHaveAttribute('draggable', 'true');

    await page.getByRole('button', { name: /manage team groups/i }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();

    // Drag is a trigger for the same surface the status pill lives on, so it goes inert with it
    // rather than advertising a gesture that would be refused.
    await expect(card(page, 'PLAT-1')).toHaveAttribute('draggable', 'false');
    await dragCard(page, 'PLAT-1', 'col-wrap');
    await expect(dropMenu(page)).toHaveCount(0);
    expect(transitionCalls(calls)).toHaveLength(0);
    expect(optionCalls(calls)).toHaveLength(0);
});

test('the epic panel status pill still performs a transition — drag is not the only path', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await card(page, 'CORE-2').click();
    await expect(page.locator('.epic-panel')).toBeVisible();
    await page.locator('.epic-panel [data-status-transition-trigger="true"][data-issue-key="CORE-2"]').click();
    const panelMenu = page.locator('.epic-panel .status-transition-menu');
    await expect(panelMenu).toBeVisible();
    await panelMenu.getByRole('menuitem', { name: 'Done' }).click();

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['CORE-2'], targetStatus: 'Done' });
});

test('a drag never writes to the Planning selection', async ({ page }) => {
    const calls = [];
    // Land in Planning, select every visible story, then switch to Board and drag one card. The
    // hook's Planning arm would send those story keys; the board must send the dragged epic only.
    await loadDashboard(page, calls, { showBoard: false, showPlanning: true });
    await page.locator('.planning-panel.open').waitFor();
    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(page.locator('.planning-panel.open .planning-stat-value').first()).not.toHaveText('0 · 0.0 SP');

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Board' }).click();
    await page.waitForSelector('.eng-board .col');
    await dragCard(page, 'PLAT-1', 'col-wrap');

    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    expect(transitionCalls(calls)[0].body).toEqual({ issueKeys: ['PLAT-1'], targetStatus: 'Release' });
});

test('a board transition reports source_surface board; a refused drag submits and results in nothing', async ({ page }) => {
    const calls = [];
    const gtmRequests = [];
    await page.route('https://www.googletagmanager.com/**', (route) => {
        gtmRequests.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.route('https://www.google-analytics.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await openBoard(page, calls, {
        analyticsContext: { enabled: true, gtmContainerId: 'GTM-TEST0000', ga4UserId: 'user-test', debugMode: false },
    });
    await page.evaluate(() => window.JepAnalytics.initAnalytics());
    await expect.poll(() => gtmRequests.length).toBeGreaterThan(0);

    const statusEvents = () => page.evaluate(() => (window.dataLayer || [])
        .filter((entry) => entry && entry.event_name === 'issue_status_action')
        .map((entry) => ({ action: entry.workflow_action, surface: entry.source_surface })));

    // §10.3's no-event allowlist: a refused drag is a non-event.
    await dragCard(page, 'WEB-3', 'col-ready');
    await expect(liveRegion(page)).toContainText('Nothing moved.');
    expect((await statusEvents()).filter((entry) => entry.action !== 'status_options_open')).toEqual([]);

    await dragCard(page, 'PLAT-1', 'col-wrap');
    await expect.poll(() => transitionCalls(calls).length).toBe(1);
    await expect.poll(async () => (await statusEvents()).some((entry) => entry.action === 'status_change_result')).toBe(true);
    const submitted = (await statusEvents()).filter((entry) => entry.action !== 'status_options_open');
    expect(submitted.length).toBeGreaterThan(0);
    submitted.forEach((entry) => expect(entry.surface).toBe('board'));
});

test('the options request is the shared endpoint, asked once per dragged epic', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await dragCard(page, 'PLAT-1', 'col-done');
    await expect(dropMenu(page)).toBeVisible();
    expect(optionCalls(calls)).toHaveLength(1);
    expect(optionCalls(calls)[0].body).toEqual({ issueKeys: ['PLAT-1'] });
    await page.keyboard.press('Escape');

    // The hook's module-level cache serves the second drag of the same epic — the board adds no
    // second options path of its own.
    await dragCard(page, 'PLAT-1', 'col-done');
    await expect(dropMenu(page)).toBeVisible();
    expect(optionCalls(calls)).toHaveLength(1);
});
