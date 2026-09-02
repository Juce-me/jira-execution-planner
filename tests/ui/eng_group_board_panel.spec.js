const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

// The board's epic detail panel (§6.3, §9.2, §10.1, D12, D22, D32): how it opens and closes, the
// focus contract, the four description states, the session cache, the story rows' inherited
// classes, and the additive `.has-priority` modifier that must leave Catch Up's own
// `.story-subtask-row` untouched.

const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-group-board-panel');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

// Board reading order left to right. "Doing" is starred, so it is the focused/open column and its
// cards are on screen without any gesture.
const BOARD_COLUMNS = [
    { id: 'col-1a2b3c4d', name: 'Ready', colour: '#597ef7', star: false, min: null, max: null, statuses: ['To Do', 'Analysis'] },
    { id: 'col-2b3c4d5e', name: 'Doing', colour: '#ffa940', star: true, min: null, max: null, statuses: ['In Progress', 'Blocked'] },
    { id: 'col-3c4d5e6f', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'] },
];

// [key, priority, track, initiativeSummary]
const EPIC_SPECS = [
    ['PLAT-1', 'Blocker', 'Committed', 'Partner execution layer'],
    ['PLAT-2', 'Critical', null, null],
    ['PLAT-3', 'Major', 'Flexible', null],
    ['PLAT-4', 'Minor', null, null],
];

// [key, epicKey, status, assignee]
// PLAT-1's five stories deliberately span three columns and three owners so all three sort orders
// produce three DIFFERENT orders, and so Done can be shown to fall last.
const STORY_SPECS = [
    ['PLAT-1-a', 'PLAT-1', 'Done', 'Bob Brown'],
    ['PLAT-1-b', 'PLAT-1', 'To Do', 'Alice Adams'],
    ['PLAT-1-c', 'PLAT-1', 'In Progress', 'Bob Brown'],
    ['PLAT-1-d', 'PLAT-1', 'To Do', null],
    ['PLAT-1-e', 'PLAT-1', 'Blocked', 'Alice Adams'],
    ['PLAT-2-a', 'PLAT-2', 'In Progress', 'Carol Chen'],
    ['PLAT-3-a', 'PLAT-3', 'In Progress', 'Carol Chen'],
    ['PLAT-4-a', 'PLAT-4', 'In Progress', 'Carol Chen'],
];

const SMART_LINK_URL = 'https://docs.example.test/spec?section=quality';
const DESCRIPTION_HTML = `<p>Tech design: <a href="${SMART_LINK_URL}" target="_blank" rel="noopener noreferrer">${SMART_LINK_URL}</a></p>${'<p>Objective paragraph that is long enough to need clamping. </p>'.repeat(4)}<ul><li>One</li><li>Two</li></ul>${'<p>More body copy so the block exceeds 11.5rem. </p>'.repeat(8)}`;
const HEADING_DESCRIPTION_HTML = '<h1>Delivery objective</h1><p>Ship the scoped work without motion.</p>';
const TABLE_DESCRIPTION_HTML = `
    <h3>Scope (Child Stories)</h3>
    <div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">
        <table><tbody>
            <tr><th scope="col">#</th><th scope="col">Key</th><th scope="col">Component</th><th scope="col">Summary</th></tr>
            <tr><td>1</td><td>SYNTH-1</td><td>Gateway</td><td>Add deterministic span-linked logging to the gateway application</td></tr>
            <tr><td>2</td><td>SYNTH-2</td><td>Distribution</td><td>Propagate the trace context through distribution</td></tr>
        </tbody></table>
    </div>
    <div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">
        <table><tbody><tr><th scope="col">Owner</th><th scope="col">Outcome</th></tr><tr><td>Platform</td><td>Verified</td></tr></tbody></table>
    </div>`;

function epicPayload() {
    const epics = {};
    EPIC_SPECS.forEach(([key, priority, projectTrack, initiative]) => {
        epics[key] = {
            key,
            summary: `${key} epic summary`,
            status: 'In Progress',
            priority,
            assignee: { displayName: 'Epic Owner' },
            deliveryOwner: null,
            projectTrack,
            updated: '2026-07-20T00:00:00.000+0000',
            ...(initiative ? { initiative: { key: 'PLAT-100', summary: initiative } } : {}),
        };
    });
    return epics;
}

// PLAT-1-b carries a subtaskSummary so the SAME fixture can be opened in Catch Up, where its
// subtask panel is the other consumer of `.story-subtask-row` (D32).
const SUBTASK_SUMMARY = {
    total: 1,
    done: 0,
    inProgress: 1,
    waiting: 0,
    percentComplete: 0,
    statusCounts: { Analysis: 1 },
};

function storyPayload() {
    return STORY_SPECS.map(([key, epicKey, status, assignee]) => ({
        id: key,
        key,
        fields: {
            summary: `${key} story summary`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: assignee ? { displayName: assignee } : null,
            updated: '2026-07-28T00:00:00.000+0000',
            customfield_10004: 2,
            epicKey,
            parentSummary: `${epicKey} epic summary`,
            projectKey: 'PLAT',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            ...(key === 'PLAT-1-b' ? { subtaskSummary: SUBTASK_SUMMARY } : {}),
        },
    }));
}

function subtaskPayload() {
    return {
        parentKey: 'PLAT-1-b',
        sprint: String(selectedSprintId),
        cached: false,
        summary: SUBTASK_SUMMARY,
        subtasks: [{
            id: 'PLAT-1-b-1',
            key: 'PLAT-1-b-1',
            summary: 'Catch Up subtask',
            status: { name: 'Analysis' },
            progressPercent: null,
            assignee: { displayName: 'Alice Adams' },
            updated: '2026-07-28T00:00:00.000+0000',
        }],
    };
}

async function installBoardFixture(page, calls, {
    descriptionGate = null,
    descriptionHtml = DESCRIPTION_HTML,
    transitionStatuses = ['Done', 'To Do'],
} = {}) {
    await installDashboardShell(page);
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body: request.postData() || '',
        });
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
                    teamIds: ['team-alpha'],
                    teamLabels: { 'team-alpha': 'Alpha Team' },
                    board: { columns: BOARD_COLUMNS },
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
        if (url.pathname === '/api/issues/description') {
            const key = url.searchParams.get('key');
            if (key === 'PLAT-2') return json({ key, html: '', isEmpty: true });
            if (key === 'PLAT-3') {
                return json({ error: 'issue_description_fetch_failed', message: 'Jira returned status 500' }, 502);
            }
            if (key === 'PLAT-4' && descriptionGate) await descriptionGate;
            return json({ key, html: descriptionHtml, isEmpty: false });
        }
        if (url.pathname === '/api/issues/transitions/options') {
            return json({
                issues: [],
                targetStatuses: transitionStatuses.map((name) => ({
                    name,
                    availableCount: 1,
                    blockedCount: 0,
                })),
            });
        }
        if (url.pathname === '/api/issues/transitions') {
            return json({
                targetStatus: 'Done',
                results: [{ key: 'PLAT-1-b', result: 'success', toStatus: 'Done' }],
            });
        }
        if (url.pathname === '/api/issues/priorities/options') {
            return json({
                priorities: [
                    { id: '1', name: 'Blocker', rank: 1 },
                    { id: '3', name: 'Major', rank: 3 },
                    { id: '4', name: 'Minor', rank: 4 },
                ],
                source: 'jira',
            });
        }
        if (url.pathname === '/api/issues/priorities') {
            return json({
                targetPriority: { id: '4', name: 'Minor' },
                results: [{ key: 'PLAT-1-b', result: 'success' }],
            });
        }
        if (url.pathname === '/api/issues/project-track/options') {
            return json({ options: [{ value: 'Committed' }, { value: 'Flexible' }] });
        }
        if (url.pathname === '/api/issues/project-track') {
            return json({ result: 'success', fromTrack: 'Committed', toTrack: 'Flexible' });
        }
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'test-token' });
        if (url.pathname === '/api/issues/subtasks') return json(subtaskPayload());
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
        showPlanning: false,
        showScenario: false,
        showAlertsPanel: false,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
}

async function openBoard(page, calls, options = {}) {
    await loadDashboard(page, calls, options);
    await page.waitForSelector('.eng-board .col', { timeout: 10000 });
}

function card(page, key) {
    return page.locator(`.eng-board .ecard[data-epic-key="${key}"]`);
}

const panel = (page) => page.locator('.epic-panel');

async function openPanel(page, key) {
    await card(page, key).click();
    await expect(panel(page)).toBeVisible();
}

function descriptionCalls(calls, key) {
    return calls.filter((call) => call.pathname === '/api/issues/description' && call.params.key === key);
}

// Row layout is read as the COMPUTED grid template, never the declaration: an undefined custom
// property or a dropped rule leaves the declaration in the stylesheet and the layout wrong.
async function rowTemplates(locator) {
    return locator.evaluateAll((rows) => rows.map((row) => {
        const cells = getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean);
        return { cells: cells.length, template: cells.join(' ') };
    }));
}

/* ── Opening and dismissing (§6.3, §10.1) ───────────────────────────────────────────────────── */

test('the epic card is a button that opens the panel on click and on Enter', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await expect(card(page, 'PLAT-1')).toHaveJSProperty('tagName', 'BUTTON');
    await openPanel(page, 'PLAT-1');
    await expect(panel(page).locator('.m-title')).toHaveText('PLAT-1 epic summary');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);

    await card(page, 'PLAT-1').focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
});

test('the panel dismisses on an outside click and on Escape, returning focus to its card', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await openPanel(page, 'PLAT-2');
    await page.locator('.epic-panel-backdrop').click({ position: { x: 6, y: 6 } });
    await expect(panel(page)).toHaveCount(0);

    await openPanel(page, 'PLAT-2');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(card(page, 'PLAT-2')).toBeFocused();
});

test('focus moves into the panel on open and is trapped while it is open', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const inPanel = () => page.evaluate(() => {
        const active = document.activeElement;
        return Boolean(active && active.closest('.epic-panel'));
    });
    expect(await inPanel()).toBe(true);

    for (let step = 0; step < 30; step += 1) {
        await page.keyboard.press('Tab');
        expect(await inPanel()).toBe(true);
    }
    for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await inPanel()).toBe(true);
    }
});

test('Escape inside an open transition menu closes the menu, not the panel', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const row = panel(page).locator('.story-subtask-row[data-story-key="PLAT-1-b"]');
    const storyTrigger = row.locator('button.status-pill.task-status');
    await storyTrigger.click();
    const menu = panel(page).locator('.status-transition-menu[data-issue-key="PLAT-1-b"]');
    await expect(menu).toBeVisible();

    // Gate the race this test used to lose. Until the options resolve, focus is still on the
    // trigger and Escape bubbles to the panel — the easy path. The hard path is focus INSIDE
    // the menu, where the menu handles Escape itself; that is the only state worth asserting,
    // so wait for it deterministically instead of hoping a parallel sweep is slow enough.
    await expect(menu.locator('.status-transition-option').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    // §10.1: the menu must hand focus back to its trigger, not drop it on <body> — otherwise
    // the panel's own Escape/Tab handlers (bound to the panel element) stop receiving keys and
    // the trap is escapable in one gesture.
    await expect(storyTrigger).toBeFocused();

    // The panel is still keyboard-usable: Tab keeps cycling inside it.
    const inPanel = () => page.evaluate(() => Boolean(document.activeElement?.closest('.epic-panel')));
    await page.keyboard.press('Tab');
    expect(await inPanel()).toBe(true);

    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(card(page, 'PLAT-1')).toBeFocused();
});

test('normal Board panel menus keep first-option focus, trigger restoration, capture dismissal, and portal behavior', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const storyRow = panel(page).locator('.story-subtask-row[data-story-key="PLAT-1-b"]');
    const trigger = storyRow.locator('[data-status-transition-trigger]');
    await trigger.click();
    const menu = panel(page).locator('.status-transition-menu[data-issue-key="PLAT-1-b"]');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveClass(/is-portalled/);
    await expect(menu).not.toHaveClass(/is-preview-only/);
    await expect(menu).not.toHaveAttribute('data-onboarding-preview-owner', /.+/);
    await expect(menu).not.toHaveAttribute('aria-activedescendant', /.+/);
    await expect(menu.locator('button[role="menuitem"]').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(panel(page)).toBeVisible();

    await trigger.click();
    await expect(menu.locator('button[role="menuitem"]').first()).toBeFocused();
    await panel(page).locator('.m-title').click();
    await expect(menu).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    expect(calls.filter(call => call.pathname === '/api/issues/transitions')).toEqual([]);
});

/* ── The four description states (§9.2) ─────────────────────────────────────────────────────── */

test('the description block shows a skeleton while loading, and the story list stays usable', async ({ page }) => {
    const calls = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await openBoard(page, calls, { descriptionGate: gate });

    await openPanel(page, 'PLAT-4');
    await expect(panel(page).locator('.m-desc-skeleton')).toBeVisible();
    // The rest of the panel is already populated from data.epics and must not wait on the fetch.
    await expect(panel(page).locator('.m-title')).toHaveText('PLAT-4 epic summary');
    await expect(panel(page).locator('.story-subtask-row')).toHaveCount(1);

    release();
    await expect(panel(page).locator('.m-desc-body')).toBeVisible();
    await expect(panel(page).locator('.m-desc-skeleton')).toHaveCount(0);
});

test('an empty description reads "No description" in the group-modal-meta grammar', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-2');

    const empty = panel(page).locator('.m-desc .group-modal-meta');
    await expect(empty).toHaveText('No description');
    await expect(panel(page).locator('.m-desc-body')).toHaveCount(0);
    await expect(panel(page).locator('.m-desc-more')).toHaveCount(0);
    await page.screenshot({ path: `${screenshotDir}/panel-empty.png` });
});

test('a failed description shows the error and a Retry that re-requests, list still usable', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-3');

    await expect(panel(page).locator('.m-desc-error')).toBeVisible();
    await expect(panel(page).locator('.story-subtask-row')).toHaveCount(1);
    expect(descriptionCalls(calls, 'PLAT-3')).toHaveLength(1);

    await panel(page).locator('.m-desc-retry').click();
    await expect.poll(() => descriptionCalls(calls, 'PLAT-3').length).toBe(2);
    await expect(panel(page)).toBeVisible();
});

test('a loaded description is clamped to 11.5rem and Show full description expands it', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const body = panel(page).locator('.m-desc-body');
    await expect(body).toBeVisible();
    const smartLink = body.getByRole('link', { name: SMART_LINK_URL });
    await expect(smartLink).toBeVisible();
    await expect(smartLink).toHaveAttribute('href', SMART_LINK_URL);
    await expect(smartLink).toHaveAttribute('target', '_blank');
    await expect(smartLink).toHaveAttribute('rel', 'noopener noreferrer');
    const clampedHeight = await body.evaluate((node) => node.getBoundingClientRect().height);
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(clampedHeight).toBeLessThanOrEqual(11.5 * rem + 1);
    expect(await body.evaluate((node) => node.scrollHeight)).toBeGreaterThan(clampedHeight + 20);
    await page.screenshot({ path: `${screenshotDir}/panel-loaded.png` });

    // The sort label is the widest of the three and must not be clipped by the shared toggle's
    // own ellipsis — geometry, not appearance (MRT020).
    const sortLabel = panel(page).locator('.epic-panel-sort-dropdown .sprint-dropdown-toggle span').nth(1);
    expect(await sortLabel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);

    await panel(page).locator('.m-desc-more').click();
    await expect(panel(page).locator('.m-desc-more')).toHaveAttribute('aria-expanded', 'true');
    const expanded = await body.evaluate((node) => node.getBoundingClientRect().height);
    expect(expanded).toBeGreaterThan(clampedHeight);
    await page.screenshot({ path: `${screenshotDir}/panel-expanded.png` });
});

test('a description H1 appears without an entrance animation', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { descriptionHtml: HEADING_DESCRIPTION_HTML });
    await openPanel(page, 'PLAT-1');

    const heading = panel(page).locator('.m-desc-body').getByRole('heading', {
        name: 'Delivery objective',
        level: 1,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('animation-name', 'none');
    await page.screenshot({ path: `${screenshotDir}/panel-heading-without-motion.png` });
});

test('description tables keep semantic columns and scroll only the selected table', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { width: 1280, height: 820, descriptionHtml: TABLE_DESCRIPTION_HTML });
    await openPanel(page, 'PLAT-1');
    const body = panel(page).locator('.m-desc-body');
    const heading = body.getByRole('heading', { name: 'Scope (Child Stories)', level: 3 });
    await expect(heading).toBeVisible();
    await expect(body.getByRole('table')).toHaveCount(2);
    await expect(body.getByRole('columnheader', { name: 'Key' })).toBeVisible();
    await expect(body.getByRole('cell', { name: 'SYNTH-1' })).toBeVisible();
    const headingStyle = await heading.evaluate((node) => ({
        textTransform: getComputedStyle(node).textTransform,
        fontSize: parseFloat(getComputedStyle(node).fontSize),
    }));
    expect(headingStyle.textTransform).toBe('none');
    expect(headingStyle.fontSize).toBeGreaterThanOrEqual(14);
    await page.screenshot({ path: `${screenshotDir}/panel-table-desktop.png` });

    await page.setViewportSize({ width: 375, height: 812 });
    const wrappers = body.locator('.adf-table-scroll');
    await expect(wrappers).toHaveCount(2);
    await expect.poll(
        () => wrappers.first().evaluate((node) => node.scrollWidth - node.clientWidth),
        { message: 'the selected table owns real horizontal overflow after responsive layout settles' },
    ).toBeGreaterThan(1);
    const before = await wrappers.evaluateAll((nodes) => nodes.map((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft,
        overflowX: getComputedStyle(node).overflowX,
    })));
    expect(before[0].scrollWidth).toBeGreaterThan(before[0].clientWidth + 1);
    expect(before[0].overflowX).toBe('auto');
    expect(before[1].scrollLeft).toBe(0);

    await wrappers.first().focus();
    await expect(wrappers.first()).toBeFocused();
    await wrappers.first().evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    const after = await wrappers.evaluateAll((nodes) => nodes.map((node) => node.scrollLeft));
    expect(after[0]).toBeGreaterThan(0);
    expect(after[1]).toBe(0);

    const outerOverflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panel: document.querySelector('.epic-panel').scrollWidth - document.querySelector('.epic-panel').clientWidth,
        body: document.querySelector('.epic-panel .m-body').scrollWidth - document.querySelector('.epic-panel .m-body').clientWidth,
        description: document.querySelector('.m-desc-body').scrollWidth - document.querySelector('.m-desc-body').clientWidth,
    }));
    Object.entries(outerOverflow).forEach(([surface, overflow]) => {
        expect(overflow, `${surface} owns no table overflow`).toBeLessThanOrEqual(1);
    });
    await page.screenshot({ path: `${screenshotDir}/panel-table-mobile.png` });
});

test('clamped descriptions omit clipped tables from Tab order and restore them on expand', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { width: 1280, height: 820, descriptionHtml: TABLE_DESCRIPTION_HTML });
    await openPanel(page, 'PLAT-1');

    const body = panel(page).locator('.m-desc-body');
    const wrappers = body.locator('.adf-table-scroll');
    const firstTable = wrappers.first();
    const clippedTable = wrappers.nth(1);
    const more = panel(page).locator('.m-desc-more');
    await expect(wrappers).toHaveCount(2);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const tableVisibility = await wrappers.evaluateAll((nodes) => {
        const bodyRect = nodes[0].closest('.m-desc-body').getBoundingClientRect();
        return nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return {
                fullyVisible: rect.top >= bodyRect.top - 1 && rect.bottom <= bodyRect.bottom + 1,
            };
        });
    });
    expect(tableVisibility).toEqual([{ fullyVisible: true }, { fullyVisible: false }]);
    await expect(firstTable).toHaveAttribute('tabindex', '0');
    await expect(clippedTable).toHaveAttribute('tabindex', '-1');

    await firstTable.focus();
    await page.keyboard.press('Tab');
    await expect(more).toBeFocused();

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(firstTable).toHaveAttribute('tabindex', '0');
    await expect(clippedTable).toHaveAttribute('tabindex', '0');
    await firstTable.focus();
    await page.keyboard.press('Tab');
    await expect(clippedTable).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(more).toBeFocused();

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(firstTable).toHaveAttribute('tabindex', '0');
    await expect(clippedTable).toHaveAttribute('tabindex', '-1');
    await firstTable.focus();
    await page.keyboard.press('Tab');
    await expect(more).toBeFocused();
});

test('a second open of the same epic does not refetch the description', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);

    await openPanel(page, 'PLAT-1');
    await expect(panel(page).locator('.m-desc-body')).toBeVisible();
    expect(descriptionCalls(calls, 'PLAT-1')).toHaveLength(1);

    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);

    await openPanel(page, 'PLAT-1');
    await expect(panel(page).locator('.m-desc-body')).toBeVisible();
    await expect(panel(page).locator('.m-desc-skeleton')).toHaveCount(0);
    expect(descriptionCalls(calls, 'PLAT-1')).toHaveLength(1);
});

/* ── The panel's own geometry (§6.3) ────────────────────────────────────────────────────────── */

test('the panel caps at 92vh and scrolls internally', async ({ page }) => {
    const calls = [];
    // 780 rather than 700: §6.4 added the drag live region and its guidance line to the board
    // head, so the board itself no longer fits in 700px. The subject here is the PANEL's cap and
    // its internal scrolling; the last clause only needs a viewport the board fits in for the
    // document-scroll check to be about the panel at all.
    await openBoard(page, calls, { height: 780 });
    await openPanel(page, 'PLAT-1');

    const box = await panel(page).evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        viewport: window.innerHeight,
    }));
    expect(box.height).toBeLessThanOrEqual(box.viewport * 0.92 + 1);

    const body = panel(page).locator('.m-body');
    expect(await body.evaluate((node) => getComputedStyle(node).overflowY)).toBe('auto');
    // The document itself never scrolls behind the panel; the body does.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight
        || getComputedStyle(document.body).overflow === 'hidden')).toBe(true);
});

/* ── The story rows inherit Catch Up's classes (D22) ────────────────────────────────────────── */

test('every story control resolves to an existing app class, priority asserted as the button', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const row = panel(page).locator('.story-subtask-row').first();
    // The bare .task-priority-icon is a non-interactive span; only the menu's wrapper renders the
    // button, so the assertion is on the BUTTON, not the class alone.
    const trigger = row.locator('span.priority-transition > button.task-priority-icon');
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('data-priority-transition-trigger', 'true');
    await expect(trigger).toHaveAttribute('data-priority', 'Major');

    await expect(row.locator('button.status-pill.task-status')).toHaveCount(1);
    await expect(row.locator('a.story-subtask-name')).toHaveCount(1);
    await expect(row.locator('span.story-subtask-assignee')).toHaveCount(1);
    await expect(row.locator('time.story-subtask-updated')).toHaveCount(1);
    // Exactly the five cells of the table, so story points stay absent from the row (§6.3).
    expect(await row.evaluate((node) => node.children.length)).toBe(5);
});

test('the Board panel row computes five grid cells and Catch Up\'s computes four', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const rows = panel(page).locator('.story-subtask-row');
    await expect(rows.first()).toHaveClass(/has-priority/);
    const templates = await rowTemplates(rows);
    expect(templates.length).toBe(5);
    templates.forEach((row) => expect(row.cells).toBe(5));
    // Column-aligned: every row computes the identical template.
    expect(new Set(templates.map((row) => row.template)).size).toBe(1);

    // And the same page, with the modifier removed, computes the app's existing four-cell row —
    // proof the BASE rule was not changed to make the panel work.
    const bare = await rows.first().evaluate((row) => {
        row.classList.remove('has-priority');
        const cells = getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length;
        row.classList.add('has-priority');
        return cells;
    });
    expect(bare).toBe(4);
});

// Below 761px the row folds to "pri name" / "status status updated". The status control is
// PriorityTransitionMenu's sibling wrapper `span.status-transition`, which carries no grid-area of
// its own — Catch Up's base row happens to auto-place it into the right cell, and the modifier
// must not leave that to luck: auto-placement drops it into the 1.1rem `pri` column instead of the
// two-column `status` area, so the pill overflows its cell.
test('the panel row keeps the status control in its own area below 761px', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { width: 375, height: 812 });
    await openPanel(page, 'PLAT-1');

    const row = panel(page).locator('.story-subtask-row').first();
    const geometry = await row.evaluate((node) => {
        const status = node.querySelector('.status-transition');
        const updated = node.querySelector('.story-subtask-updated');
        return {
            cells: getComputedStyle(node).gridTemplateColumns.split(' ').filter(Boolean).length,
            statusArea: getComputedStyle(status).gridArea,
            priorityArea: getComputedStyle(node.querySelector('.priority-transition')).gridArea,
            statusRight: status.getBoundingClientRect().right,
            statusWidth: status.getBoundingClientRect().width,
            pillWidth: status.querySelector('.status-pill').getBoundingClientRect().width,
            updatedLeft: updated.getBoundingClientRect().left,
        };
    });

    expect(geometry.cells).toBe(3);
    expect(geometry.priorityArea).toBe('pri');
    expect(geometry.statusArea).toBe('status');
    // The pill fits its cell rather than spilling out of it, and never reaches the updated cell.
    expect(geometry.statusWidth).toBeGreaterThanOrEqual(geometry.pillWidth - 1);
    expect(geometry.statusRight).toBeLessThanOrEqual(geometry.updatedLeft + 1);
    await page.screenshot({ path: `${screenshotDir}/panel-mobile.png` });
});

test('Catch Up\'s own subtask panel still computes the four-cell row, unchanged', async ({ page }) => {
    const calls = [];
    await loadDashboard(page, calls, { showBoard: false });
    await page.waitForSelector('.task-item[data-task-key="PLAT-1-b"]', { timeout: 10000 });

    await page.locator('.task-item[data-task-key="PLAT-1-b"] .story-subtasks-toggle').click();
    const rows = page.locator('.story-subtasks-panel .story-subtask-row');
    await expect(rows).toHaveCount(1);

    await expect(rows.first()).not.toHaveClass(/has-priority/);
    const templates = await rowTemplates(rows);
    expect(templates[0].cells).toBe(4);
    // The row that Catch Up renders carries no priority cell at all.
    await expect(rows.first().locator('.task-priority-icon')).toHaveCount(0);
    expect(await rows.first().evaluate((node) => node.children.length)).toBe(4);
});

/* ── Sorting reorders rows and never restyles them (D12) ────────────────────────────────────── */

test('the three sort orders reorder rows without changing the row layout', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const rows = panel(page).locator('.story-subtask-row');
    const keys = () => rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.storyKey));
    const layout = async () => JSON.stringify(await rowTemplates(rows));

    const baselineLayout = await layout();
    // Default: assignee, then status (status in board column order).
    expect(await keys()).toEqual(['PLAT-1-b', 'PLAT-1-e', 'PLAT-1-c', 'PLAT-1-a', 'PLAT-1-d']);

    // Exact matches: "Assignee, then status" contains both other option labels, and Playwright's
    // hasText is a case-insensitive substring.
    const sortControl = panel(page).locator('.epic-panel-sort-dropdown');
    await expect(sortControl).toBeVisible();
    await expect(sortControl).not.toHaveClass(/header-filter-dropdown/);
    const sortOption = (label) => sortControl.locator('.sprint-dropdown-option')
        .filter({ hasText: new RegExp(`^${label}$`) });

    await sortControl.locator('.sprint-dropdown-toggle').click();
    await expect(sortControl.locator('.sprint-dropdown-panel')).toBeVisible();
    await sortOption('Status').click();
    // Board column order is Ready | Doing | Done, so Done falls last — never alphabetical.
    expect(await keys()).toEqual(['PLAT-1-b', 'PLAT-1-d', 'PLAT-1-c', 'PLAT-1-e', 'PLAT-1-a']);
    expect(await layout()).toBe(baselineLayout);

    await sortControl.locator('.sprint-dropdown-toggle').click();
    await sortOption('Assignee').click();
    expect(await keys()).toEqual(['PLAT-1-b', 'PLAT-1-e', 'PLAT-1-a', 'PLAT-1-c', 'PLAT-1-d']);
    expect(await layout()).toBe(baselineLayout);
});

/* ── A pill click really transitions (§9.5's handed-forward hazard) ─────────────────────────── */

test('every status menu in the panel stays above the modal with readable reachable options', async ({ page }) => {
    const calls = [];
    const transitionStatuses = [
        'Pending',
        'To Do',
        'Awaiting Validation',
        'Postponed',
        'Blocked',
        'Analysis',
        'Accepted',
        'Release',
        'Done',
        'Killed',
        'Incomplete',
    ];
    await openBoard(page, calls, { height: 640, transitionStatuses });
    await openPanel(page, 'PLAT-1');

    const assertMenuIsUsable = async (menu) => {
        await expect(menu).toBeVisible();
        await expect(menu.locator('.status-transition-option').first()).toBeFocused();

        const geometry = await menu.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const backdrop = document.querySelector('.epic-panel-backdrop');
            const options = Array.from(node.querySelectorAll('.status-transition-option'));
            return {
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                viewportWidth: document.documentElement.clientWidth,
                viewportHeight: window.innerHeight,
                zIndex: Number.parseInt(getComputedStyle(node).zIndex, 10) || 0,
                backdropZIndex: Number.parseInt(getComputedStyle(backdrop).zIndex, 10) || 0,
                clippedLabels: options.filter((option) => {
                    const label = option.querySelector('.status-transition-option-label');
                    return label.scrollWidth > label.clientWidth + 1;
                }).length,
                reversedRows: options.filter((option) => {
                    const marker = option.querySelector('.status-transition-option-marker').getBoundingClientRect();
                    const label = option.querySelector('.status-transition-option-label').getBoundingClientRect();
                    return marker.right > label.left + 1;
                }).length,
            };
        });

        expect(geometry.top).toBeGreaterThanOrEqual(8);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 8 + 1);
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 8 + 1);
        expect(geometry.zIndex).toBeGreaterThan(geometry.backdropZIndex);
        expect(geometry.clippedLabels).toBe(0);
        expect(geometry.reversedRows).toBe(0);

        const lastOption = menu.locator('.status-transition-option').last();
        await lastOption.scrollIntoViewIfNeeded();
        const lastOptionIsReachable = await lastOption.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(hit && node.contains(hit));
        });
        expect(lastOptionIsReachable, 'the last workflow status is clipped or covered').toBe(true);
    };

    const storyRow = panel(page).locator('.story-subtask-row[data-story-key="PLAT-1-b"]');
    await storyRow.scrollIntoViewIfNeeded();
    await storyRow.locator('button.status-pill.task-status').click();
    await assertMenuIsUsable(panel(page).locator('.status-transition-menu[data-issue-key="PLAT-1-b"]'));
    await page.screenshot({ path: `${screenshotDir}/panel-story-status-menu.png` });

    await page.keyboard.press('Escape');
    const epicTrigger = panel(page).locator('.m-controls button.status-pill.task-status');
    await epicTrigger.click();
    await assertMenuIsUsable(panel(page).locator('.status-transition-menu[data-issue-key="PLAT-1"]'));
    await page.screenshot({ path: `${screenshotDir}/panel-epic-status-menu.png` });
});

test('a status pill click in the panel performs a real transition rather than no-opping', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const row = panel(page).locator('.story-subtask-row[data-story-key="PLAT-1-b"]');
    await row.locator('button.status-pill.task-status').click();
    const menu = panel(page).locator('.status-transition-menu[data-issue-key="PLAT-1-b"]');
    await expect(menu).toBeVisible();
    await menu.locator('.status-transition-option', { hasText: 'Done' }).first().click();

    await expect.poll(() => calls.filter((call) => call.pathname === '/api/issues/transitions'
        && call.method === 'POST').length).toBe(1);
    const write = calls.find((call) => call.pathname === '/api/issues/transitions' && call.method === 'POST');
    // The one issue the user clicked — not an empty target set, and not the Planning selection.
    expect(JSON.parse(write.body)).toMatchObject({ issueKeys: ['PLAT-1-b'], targetStatus: 'Done' });

    // Board now takes the hook's single-issue path (§13's one permitted generalization, shipped
    // with card drag-and-drop): the change lands through the optimistic local patch, exactly as
    // Catch Up's does, and NOT through a full scope refetch. Task 14 asserted the opposite because
    // the board was still falling into the hook's batch arm at the time.
    await expect(row.locator('button.status-pill.task-status')).toHaveText('Done');
    // A settling window for the absence assertion below: the patch landing above proves the write
    // resolved, but a refetch dispatched in the same success path would still be in flight.
    await page.waitForTimeout(300);
    expect(calls.filter((call) => call.pathname === '/api/tasks-with-team-name'
        && call.params.refresh === 'true')).toHaveLength(0);
});

test('a priority change from a panel story row performs a real write', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const row = panel(page).locator('.story-subtask-row[data-story-key="PLAT-1-b"]');
    await row.locator('button.task-priority-icon').click();
    const menu = panel(page).locator('.priority-transition-menu[data-issue-key="PLAT-1-b"]');
    await expect(menu).toBeVisible();
    await menu.locator('.priority-transition-option').filter({ hasText: /^Minor$/ }).click();

    await expect.poll(() => calls.filter((call) => call.pathname === '/api/issues/priorities'
        && call.method === 'POST').length).toBe(1);
    const write = calls.find((call) => call.pathname === '/api/issues/priorities' && call.method === 'POST');
    expect(JSON.parse(write.body)).toMatchObject({ issueKeys: ['PLAT-1-b'], targetPriorityId: '4' });
});

test('a Project Track change from the panel header performs a real write', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    await panel(page).locator('.m-controls button.epic-track-indicator').click();
    const menu = panel(page).locator('.project-track-transition-menu[data-issue-key="PLAT-1"]');
    await expect(menu).toBeVisible();
    await menu.locator('.project-track-transition-option').filter({ hasText: /Flexible/ }).click();

    await expect.poll(() => calls.filter((call) => call.pathname === '/api/issues/project-track'
        && call.method === 'POST').length).toBe(1);
    const write = calls.find((call) => call.pathname === '/api/issues/project-track' && call.method === 'POST');
    expect(JSON.parse(write.body)).toMatchObject({ issueKey: 'PLAT-1', targetTrack: 'Flexible' });
});

test('the panel header renders the app\'s own three epic controls as real triggers', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await openPanel(page, 'PLAT-1');

    const controls = panel(page).locator('.m-controls');
    await expect(controls.locator('button.task-priority-icon[data-priority-transition-trigger="true"]')).toHaveCount(1);
    await expect(controls.locator('button.epic-track-indicator[data-project-track-transition-trigger="true"]')).toHaveCount(1);
    await expect(controls.locator('button.status-pill.task-status[data-status-transition-trigger="true"]')).toHaveCount(1);
    // No new labelled dropdown wrapping a control that already exists (§6.3).
    await expect(controls.locator('select')).toHaveCount(0);
});
