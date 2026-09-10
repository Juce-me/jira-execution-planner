const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

// The board's epic card (§6.2), its Tech/Product derivation (§4.4/D41 — unit-tested only, no
// facet UI exists yet to assert against), and board search (§8/D27). Task 11's own board/column
// geometry lives in eng_group_board_view.spec.js; this spec only covers what Task 12 adds: the
// three card rows, complete open-column rendering, and the epic-level search predicate wired into
// the board.

const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-group-board-card');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

// One open column ("Open", starred+focused) with 7 epics to exercise complete ordered rendering,
// plus a second ("Done") with one epic that never matches the Delivery-Owner search below, so
// search narrowing is visible in its header count too.
const BOARD_COLUMNS = [
    { id: 'col-1a2b3c4d', name: 'Open', colour: '#597ef7', star: true, min: null, max: null, statuses: ['To Do', 'In Progress'] },
    { id: 'col-2b3c4d5e', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'] },
];

// [key, status, priority, assignee|null, deliveryOwner|null, projectTrack|null, updated]
// PLAT-7's priority is deliberately the OTHER live shape — `{ name }`, the alerts-payload shape
// (§4.1) — rather than the plain string `data.epics` normally flattens to, so the fixture proves
// the card normalizes both rather than only ever exercising the shape it happens to be fed today.
const EPIC_SPECS = [
    ['PLAT-1', 'To Do', 'Blocker', 'Alice Adams', null, null, '2026-07-20T00:00:00.000+0000'],
    ['PLAT-2', 'To Do', 'Critical', 'Bob Brown', 'Nadia Perez', 'Committed', '2026-07-21T00:00:00.000+0000'],
    ['PLAT-3', 'In Progress', 'Major', 'Carol Chen', null, 'Flexible', '2026-07-22T00:00:00.000+0000'],
    ['PLAT-4', 'To Do', 'Minor', null, null, null, '2026-07-23T00:00:00.000+0000'],
    ['PLAT-5', 'To Do', 'Low', 'Eve Evans', null, null, '2026-07-24T00:00:00.000+0000'],
    ['PLAT-6', 'To Do', 'Trivial', 'Frank Ford', null, null, '2026-07-25T00:00:00.000+0000'],
    ['PLAT-7', 'To Do', { name: 'Critical' }, 'Grace Green', null, null, '2026-07-26T00:00:00.000+0000'],
    ['PLAT-8', 'Done', 'Major', 'Hank Hill', null, null, '2026-07-27T00:00:00.000+0000'],
];
const LONG_EPIC_SUMMARY = 'Replace expression-based enrichment targeting with deterministic request-scoped functions while preserving every existing compatibility boundary and diagnostic contract';

// Priority-sorted (highest first, ties by key): Blocker < Critical < Major < Minor < Low < Trivial.
const EXPECTED_ORDER = ['PLAT-1', 'PLAT-2', 'PLAT-7', 'PLAT-3', 'PLAT-4', 'PLAT-5', 'PLAT-6'];

function epicPayload(firstEpicAssignee = 'Alice Adams', firstEpicStatus = null) {
    const epics = {};
    EPIC_SPECS.forEach(([key, status, priority, assigneeName, deliveryOwnerName, projectTrack, updated], index) => {
        epics[key] = {
            key,
            summary: key === 'PLAT-1' ? LONG_EPIC_SUMMARY : `${key} epic summary`,
            status: index === 0 && firstEpicStatus ? firstEpicStatus : status,
            priority,
            assignee: assigneeName ? { displayName: index === 0 ? firstEpicAssignee : assigneeName } : null,
            projectTrack,
            updated,
        };
        // The key is present only when a Delivery Owner field is configured and the epic has
        // one — the backend omits it entirely otherwise, so the "Not set" case below is the
        // unconfigured payload, not a null-valued field.
        if (deliveryOwnerName) epics[key].deliveryOwner = { displayName: deliveryOwnerName };
    });
    return epics;
}

function storyPayload(firstStoryAssignee = 'Planner', firstEpicStoryPoints = null) {
    // PLAT-1 gets two stories (one Done, one In Progress) to exercise the progress bar; every
    // other epic gets exactly one story, just enough for groupTasksByEpic to produce a group.
    // PLAT-4's points are deliberately fractional (Fix 6) — a column whose epics sum to a
    // half-point total is exactly the case that would have caught the card (one decimal) and the
    // column header (whole number) disagreeing.
    const rows = [];
    EPIC_SPECS.forEach(([key], index) => {
        rows.push({
            id: `${key}-1`,
            key: `${key}-1`,
            fields: {
                summary: `${key} story 1`,
                status: { name: 'Done' },
                priority: { name: 'Major' },
                issuetype: { name: 'Story' },
                assignee: { displayName: index === 0 ? firstStoryAssignee : 'Planner' },
                updated: '2026-07-28T00:00:00.000+0000',
                customfield_10004: key === 'PLAT-1' && firstEpicStoryPoints !== null
                    ? firstEpicStoryPoints / 2
                    : key === 'PLAT-4' ? 4.5 : index + 1,
                epicKey: key,
                parentSummary: `${key} epic summary`,
                projectKey: 'PLAT',
                teamId: 'team-alpha',
                teamName: 'Alpha Team',
                sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            },
        });
        if (key === 'PLAT-1') {
            rows.push({
                id: `${key}-2`,
                key: `${key}-2`,
                fields: {
                    summary: `${key} story 2`,
                    status: { name: 'In Progress' },
                    priority: { name: 'Major' },
                    issuetype: { name: 'Story' },
                    assignee: { displayName: 'Planner' },
                    updated: '2026-07-28T00:00:00.000+0000',
                    customfield_10004: firstEpicStoryPoints !== null ? firstEpicStoryPoints / 2 : 3,
                    epicKey: key,
                    parentSummary: `${key} epic summary`,
                    projectKey: 'PLAT',
                    teamId: 'team-alpha',
                    teamName: 'Alpha Team',
                    sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                },
            });
        }
    });
    return rows;
}

async function installBoardFixture(page, fieldCalls = [], {
    storyAssigneeName = 'Planner',
    epicAssigneeName = 'Alice Adams',
    firstEpicStatus = null,
    firstEpicStoryPoints = null,
} = {}) {
    await installDashboardShell(page);
    await page.route('**/api/**', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let requestBody = null;
        try { requestBody = request.postData() ? JSON.parse(request.postData()) : null; } catch (_error) { requestBody = null; }
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'synthetic-csrf' });
        const editableMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/editable-fields$/);
        if (editableMatch) {
            fieldCalls.push({ method: request.method(), pathname: url.pathname, body: requestBody });
            const field = url.searchParams.get('field');
            return json({ issueKey: editableMatch[1], field, editable: true, currentValue: field === 'storyPoints' ? 1 : { accountId: 'old-owner', displayName: 'Alice Adams' }, baseUpdated: 'base-1', mappingRevision: 'map-1', me: field === 'storyPoints' ? null : { accountId: 'me', displayName: 'Current Person', eligibility: 'eligible' } });
        }
        if (/^\/api\/issues\/[^/]+\/user-options$/.test(url.pathname)) return json({ options: [] });
        if (/^\/api\/issues\/[^/]+\/field$/.test(url.pathname)) {
            fieldCalls.push({ method: request.method(), pathname: url.pathname, body: requestBody });
            return json({ result: 'success', value: requestBody?.field === 'storyPoints' ? requestBody.value : { accountId: requestBody?.value?.accountId, displayName: 'Current Person' }, mappingRevision: 'map-1' });
        }
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        }
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') {
            return json({
                authMode: 'atlassian_oauth',
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
            const epics = epicPayload(epicAssigneeName, firstEpicStatus);
            return json({
                issues: storyPayload(storyAssigneeName, firstEpicStoryPoints),
                epics,
                epicsInScope: Object.values(epics),
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openBoard(page, {
    width = 1280,
    height = 900,
    fieldCalls = [],
    storyAssigneeName = 'Planner',
    epicAssigneeName = 'Alice Adams',
    firstEpicStatus = null,
    firstEpicStoryPoints = null,
} = {}) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await installBoardFixture(page, fieldCalls, {
        storyAssigneeName,
        epicAssigneeName,
        firstEpicStatus,
        firstEpicStoryPoints,
    });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showBoard: true,
        showPlanning: false,
        showScenario: false,
        showAlertsPanel: false,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.eng-board .col', { timeout: 10000 });
    await settle(page);
}

async function settle(page) {
    await page.evaluate(() => { window.__boardSettle = null; });
    await page.waitForFunction(() => {
        const board = document.querySelector('.eng-board .board');
        if (!board) return false;
        const state = window.__boardSettle;
        if (!state || state.left !== board.scrollLeft) {
            window.__boardSettle = { left: board.scrollLeft, stable: 0 };
            return false;
        }
        state.stable += 1;
        return state.stable >= 2;
    }, null, { timeout: 5000, polling: 120 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function col(page, id) {
    return page.locator(`.eng-board .col[data-column-id="${id}"]`);
}

function openColumnCards(page) {
    return col(page, 'col-1a2b3c4d').locator('.col-body .ecard');
}

async function cardKeys(page) {
    return openColumnCards(page).evaluateAll((cards) => cards.map((card) => card.dataset.epicKey));
}

// The open column's count lives in its header (`.col-head .ct`); a folded column's `.col-head` is
// `display: none` (board.css), so its only VISIBLE count is the rail's `.cap .n`. Reads whichever
// is actually rendered rather than the hidden one, matching what a screen actually shows.
async function visibleColumnCount(page, id) {
    const target = col(page, id);
    const isOpen = await target.evaluate((el) => el.classList.contains('is-open') || el.classList.contains('is-focused'));
    return isOpen ? target.locator('.col-head .ct').innerText() : target.locator('.col-strip .cap .n').innerText();
}

async function railBarHeightPercent(page, id) {
    return col(page, id).locator('.col-strip .fill').evaluate((el) => el.style.height);
}

/* ── The three rows render with the specified content ───────────────────────────────────────── */

test('the card renders its three rows, and the track glyph only when set', async ({ page }) => {
    await openBoard(page);

    const withTrack = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-2"]');
    await expect(withTrack.locator('.epic-track-indicator')).toHaveCount(1);
    await expect(withTrack.locator('.epic-track-indicator')).toHaveAttribute('title', /Committed/);
    await expect(withTrack.locator('.etitle')).toHaveText('PLAT-2 epic summary');
    await expect(withTrack.locator('.ekey')).toHaveText('PLAT-2');
    await expect(withTrack.locator('.eperson').first()).toContainText('Bob Brown');
    await expect(withTrack.locator('.eperson').nth(1)).toContainText('Nadia Perez');

    const withoutTrack = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    await expect(withoutTrack.locator('.epic-track-indicator')).toHaveCount(0);
    // PLAT-1 has 2 stories, one Done: row 2 states the fraction.
    await expect(withoutTrack.locator('.erow2')).toContainText('1 of 2 stories');
});

test('Delivery owner shows "Not set" when the epic has none', async ({ page }) => {
    await openBoard(page);
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    await expect(card.locator('.eperson').nth(1).locator('b')).toHaveText('Not set');
    await expect(card.locator('.eperson').nth(1).locator('b')).toHaveClass(/is-empty/);
});

test('Board person controls neither open nor drag the card wrapper', async ({ page }) => {
    await openBoard(page);
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    const trigger = card.getByRole('button', { name: 'Assignee: Alice Adams' });
    await trigger.click();
    await expect(page.locator('.epic-panel')).toHaveCount(0);
    await expect(page.locator('.issue-person-editor-menu')).toBeVisible();
    expect(await trigger.evaluate(node => node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })))).toBe(false);
    await expect(page.locator('.epic-panel')).toHaveCount(0);
});

test('Board field success propagates from card to the open panel without a task-list refetch', async ({ page }) => {
    const fieldCalls = [];
    await openBoard(page, { fieldCalls });
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    await card.getByRole('button', { name: 'Assignee: Alice Adams' }).click();
    await page.getByRole('option', { name: /Current Person/ }).click();
    await expect(card.getByRole('button', { name: 'Assignee: Current Person' })).toBeVisible();
    expect(fieldCalls.filter(call => call.method === 'POST' && call.pathname.endsWith('/field'))).toHaveLength(1);
    await page.getByRole('button', { name: 'Filters' }).click();
    await card.locator('.ecard-open').click();
    await expect(page.locator('.epic-panel').getByRole('button', { name: 'Assignee: Current Person' })).toBeVisible();
});

test('Catch Up confirmation reaches Planning and Story Points recalculate its selected total', async ({ page }) => {
    const fieldCalls = [];
    await openBoard(page, { fieldCalls });
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    const story = page.locator('.task-item[data-issue-key="PLAT-1-1"]');
    await expect(story).toBeVisible();
    await expect(page.locator('.epic-delivery-owner')).toHaveCount(0);
    await page.screenshot({ path: path.join(screenshotDir, 'catch-up-inline-fields.png') });
    await story.getByRole('button', { name: 'Assignee: Planner' }).click();
    await page.getByRole('option', { name: /Current Person/ }).click();
    await expect(story.getByRole('button', { name: 'Assignee: Current Person' })).toBeVisible();

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.epic-delivery-owner')).toHaveCount(0);
    const planningStory = page.locator('.task-item[data-issue-key="PLAT-1-1"]');
    await expect(planningStory.getByRole('button', { name: 'Assignee: Current Person' })).toBeVisible();
    await page.getByRole('button', { name: 'Select All' }).click();
    const selected = page.locator('.planning-panel.open .planning-stat-value').first();
    const before = Number((await selected.innerText()).match(/·\s*([\d.]+)\s*SP/)?.[1]);
    const points = planningStory.getByRole('textbox', { name: 'Story Points' });
    await points.click();
    await expect(points).toBeEditable();
    await points.fill('2');
    await points.press('Enter');
    await expect(points).toHaveValue('2');
    await expect.poll(async () => Number((await selected.innerText()).match(/·\s*([\d.]+)\s*SP/)?.[1])).toBe(before + 1);
    await page.screenshot({ path: path.join(screenshotDir, 'planning-inline-story-points.png') });
    expect(fieldCalls.filter(call => call.method === 'POST' && call.pathname.endsWith('/field'))).toHaveLength(2);
});

test('Catch Up story renders the full assignee name before and during editing', async ({ page }) => {
    await openBoard(page, { width: 1874, height: 440, storyAssigneeName: 'Synthetic Planner' });
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    const story = page.locator('.task-item[data-issue-key="PLAT-1-1"]');
    const trigger = story.getByRole('combobox', { name: 'Assignee: Synthetic Planner' });

    const closedMetrics = await trigger.evaluate(element => {
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = style.font;
        const text = element.value;
        const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
        return {
            available: element.clientWidth,
            required: context.measureText(text).width + letterSpacing * Math.max(0, text.length - 1),
            scrollLeft: element.scrollLeft,
        };
    });
    expect(closedMetrics.available).toBeGreaterThanOrEqual(closedMetrics.required);
    expect(closedMetrics.scrollLeft).toBe(0);

    await trigger.click();
    const input = page.getByRole('combobox', { name: 'Search Assignee' });
    await expect(input).toHaveValue('Synthetic Planner');
    await expect.poll(() => input.evaluate(element => element.scrollLeft)).toBe(0);
    await page.screenshot({ path: path.join(screenshotDir, 'catch-up-full-assignee-1874x440.png') });
});

test('Catch Up epic meta keeps a long assignee on the status and Story Points row', async ({ page }) => {
    await openBoard(page, { width: 988, height: 442, epicAssigneeName: 'Alexanderson Petrovsky' });
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    const epicHeader = page.locator('.epic-block').first().locator('.epic-header');
    const geometry = await epicHeader.evaluate(element => {
        const titleRow = element.querySelector('.epic-title-row');
        const name = element.querySelector('.epic-name');
        const key = element.querySelector('.epic-key');
        const meta = element.querySelector('.epic-meta');
        const points = meta.querySelector('.epic-story-points');
        const assignee = meta.querySelector('input.issue-person-editor-trigger');
        const controls = [
            meta.querySelector('.epic-status-pill'),
            points,
            assignee,
        ];
        const box = node => {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        };
        return {
            header: box(element),
            titleRow: box(titleRow),
            name: box(name),
            key: box(key),
            meta: box(meta),
            controls: controls.map(control => {
                const rect = control.getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom, right: rect.right, height: rect.height };
            }),
            assigneeFits: assignee.scrollWidth <= assignee.clientWidth,
            metaFontSize: Number.parseFloat(getComputedStyle(meta).fontSize),
        };
    });

    expect(geometry.titleRow.top).toBeLessThan(geometry.meta.bottom);
    expect(geometry.meta.top).toBeLessThan(geometry.titleRow.bottom);
    expect(geometry.titleRow.right).toBeLessThanOrEqual(geometry.meta.left);
    expect(geometry.name.width).toBeGreaterThanOrEqual(300);
    expect(geometry.meta.right).toBeLessThanOrEqual(geometry.header.right + 1);
    expect(geometry.meta.height).toBeLessThanOrEqual(25);
    expect(geometry.controls.map(control => Math.round(control.height))).toEqual([24, 24, 24]);
    expect(geometry.assigneeFits).toBe(true);
    expect(geometry.metaFontSize).toBeLessThanOrEqual(12);
    expect(geometry.header.height).toBeLessThanOrEqual(48);
    await expect(epicHeader.locator('.epic-assignee')).toHaveCSS('text-transform', 'none');
    const headerImage = await epicHeader.screenshot({ path: path.join(screenshotDir, 'epic-header-visible-alignment.png') });
    const inkBottoms = await epicHeader.evaluate(async (header, base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        const origin = header.getBoundingClientRect();
        return ['.epic-name', '.epic-key', '.epic-status-pill', '.epic-story-points', 'input.issue-person-editor-trigger'].map(selector => {
            const box = header.querySelector(selector).getBoundingClientRect();
            const inset = selector === '.epic-status-pill' ? 8 : 1;
            let bottom = -1;
            for (let y = Math.ceil(box.top - origin.top) + 2; y < Math.floor(box.bottom - origin.top) - 2; y += 1) {
                for (let x = Math.ceil(box.left - origin.left) + inset; x < Math.floor(box.right - origin.left) - inset; x += 1) {
                    const i = (y * image.width + x) * 4;
                    const [r, g, b] = pixels.slice(i, i + 3);
                    const ink = selector === '.epic-status-pill' ? r > 230 && g > 230 && b > 230
                        : selector.startsWith('input') ? r > 150 && g > 70 && g < 180 && b < 70
                        : r < 150 && g < 150 && b < 150;
                    if (ink) bottom = y;
                }
            }
            return { selector, bottom };
        });
    }, headerImage.toString('base64'));
    expect(inkBottoms.every(item => item.bottom >= 0), JSON.stringify(inkBottoms)).toBe(true);
    expect(Math.max(...inkBottoms.map(item => item.bottom)) - Math.min(...inkBottoms.map(item => item.bottom)), JSON.stringify(inkBottoms)).toBeLessThanOrEqual(3);
    await page.screenshot({ path: path.join(screenshotDir, 'catch-up-epic-header-long-assignee-988x442.png') });
});

test('Catch Up desktop epic header keeps a long metadata row beside the title', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 600, epicAssigneeName: 'Alexanderson Maximilian Petrovsky-Smith' });
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    const rows = await page.locator('.epic-block').first().locator('.epic-header').evaluate(element => {
        const title = element.querySelector('.epic-title-row').getBoundingClientRect();
        const meta = element.querySelector('.epic-meta').getBoundingClientRect();
        const assignee = element.querySelector('input.issue-person-editor-trigger');
        const controls = [
            element.querySelector('.epic-status-pill'),
            element.querySelector('.epic-story-points'),
            assignee,
        ].map(control => {
            const box = control.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, height: box.height };
        });
        return {
            title: { top: title.top, bottom: title.bottom, right: title.right },
            meta: { top: meta.top, bottom: meta.bottom, left: meta.left, height: meta.height },
            controls,
            assigneeFits: assignee.scrollWidth <= assignee.clientWidth,
        };
    });

    expect(rows.title.top).toBeLessThan(rows.meta.bottom);
    expect(rows.meta.top).toBeLessThan(rows.title.bottom);
    expect(rows.title.right).toBeLessThanOrEqual(rows.meta.left);
    expect(rows.meta.height).toBeLessThanOrEqual(25);
    expect(rows.controls.map(control => Math.round(control.height))).toEqual([24, 24, 24]);
    expect(rows.assigneeFits).toBe(true);
    await page.screenshot({ path: path.join(screenshotDir, 'catch-up-epic-header-long-assignee-1440x600.png') });
});

test('Catch Up mobile epic metadata wraps without clipping any control or the full assignee', async ({ page }) => {
    await openBoard(page, {
        width: 390,
        height: 844,
        epicAssigneeName: 'Alexanderson Petrovsky',
        firstEpicStatus: 'In Progress',
        firstEpicStoryPoints: 24.6,
    });
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    const geometry = await page.locator('.epic-block').first().locator('.epic-header').evaluate(element => {
        const header = element.getBoundingClientRect();
        const meta = element.querySelector('.epic-meta');
        const metaBox = meta.getBoundingClientRect();
        const assignee = meta.querySelector('input.issue-person-editor-trigger');
        const style = getComputedStyle(assignee);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = style.font;
        const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
        const requiredTextWidth = context.measureText(assignee.value).width
            + letterSpacing * Math.max(0, assignee.value.length - 1);
        const controls = [
            meta.querySelector('.epic-status-pill'),
            meta.querySelector('.epic-story-points'),
            assignee,
        ].map(control => {
            const box = control.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
        });
        return {
            header: { left: header.left, right: header.right },
            meta: { height: metaBox.height, scrollWidth: meta.scrollWidth, clientWidth: meta.clientWidth },
            controls,
            assigneeTextFits: requiredTextWidth <= assignee.clientWidth,
        };
    });

    expect(geometry.meta.scrollWidth).toBeLessThanOrEqual(geometry.meta.clientWidth);
    expect(geometry.meta.height).toBeLessThanOrEqual(56);
    expect(geometry.controls.map(control => Math.round(control.height))).toEqual([24, 24, 24]);
    geometry.controls.forEach(control => {
        expect(control.left).toBeGreaterThanOrEqual(geometry.header.left - 1);
        expect(control.right).toBeLessThanOrEqual(geometry.header.right + 1);
    });
    const rows = geometry.controls.reduce((grouped, control) => {
        const rowKey = Math.round(control.top);
        grouped[rowKey] = [...(grouped[rowKey] || []), control];
        return grouped;
    }, {});
    Object.values(rows).forEach(row => {
        expect(Math.max(...row.map(control => control.bottom)) - Math.min(...row.map(control => control.bottom))).toBeLessThanOrEqual(1);
    });
    expect(geometry.assigneeTextFits).toBe(true);
    await page.screenshot({ path: path.join(screenshotDir, 'catch-up-epic-header-long-assignee-390x844.png') });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`settled Board field edit preserves card geometry at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await openBoard(page, viewport);
        const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
        const beforeHeight = await card.evaluate(node => node.getBoundingClientRect().height);
        await page.screenshot({ path: path.join(screenshotDir, `board-before-${viewport.width}x${viewport.height}.png`) });
        await card.getByRole('button', { name: 'Assignee: Alice Adams' }).click();
        const menu = page.locator('.issue-person-editor-menu');
        await expect(menu).toBeVisible();
        const menuBox = await menu.boundingBox();
        expect(menuBox).not.toBeNull();
        expect(menuBox.x).toBeGreaterThanOrEqual(7);
        expect(menuBox.y).toBeGreaterThanOrEqual(7);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 7);
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 7);
        await page.getByRole('option', { name: /Current Person/ }).click();
        await expect(card.getByRole('button', { name: 'Assignee: Current Person' })).toBeVisible();
        await settle(page);
        expect(Math.abs(await card.evaluate(node => node.getBoundingClientRect().height) - beforeHeight)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: path.join(screenshotDir, `board-after-${viewport.width}x${viewport.height}.png`) });
    });
}

/* ── Every control resolves to an existing app class, asserted by class ─────────────────────── */

test('every card control resolves to an existing app class', async ({ page }) => {
    await openBoard(page);
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-2"]');

    await expect(card.locator('.task-priority-icon')).toHaveCount(1);
    await expect(card.locator('.epic-track-indicator')).toHaveCount(1);
    await expect(card.locator('.status-pill.task-status')).toHaveCount(1);
    // The story-progress bar reuses the app's own subtask-progress classes, not a bespoke one.
    await expect(card.locator('.story-subtasks-progress-track')).toHaveCount(1);
});

/* ── The priority icon normalizes both live epic-priority shapes (§4.1) ──────────────────────── */

test('the priority icon normalizes the {name} epic-priority shape, not only the plain string', async ({ page }) => {
    await openBoard(page);
    // PLAT-7's fixture priority is `{ name: 'Critical' }` — the alerts-payload shape — rather
    // than the plain string `data.epics` normally flattens to. Unnormalized, String({name:...})
    // stringifies to "[object Object]" in both the data-priority attribute and the aria-label.
    const icon = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-7"] .task-priority-icon');
    await expect(icon).toHaveAttribute('data-priority', 'Critical');
    await expect(icon).toHaveAttribute('aria-label', 'Critical');
    await expect(icon).not.toHaveAttribute('data-priority', '[object Object]');
});

/* ── The card and its column header round story points the same way ─────────────────────────── */

test('the card and the column header agree on story-point rounding', async ({ page }) => {
    await openBoard(page);
    // PLAT-4's epic sums to a fractional 4.5 sp, and the seven Open epics sum to 31.5 — Math.round
    // would read "32" on the header while a card reads "4.5"; both must use the same precision.
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-4"]');
    await expect(card.locator('.push')).toHaveText('4.5 sp');
    await expect(col(page, 'col-1a2b3c4d').locator('.col-head .sp')).toHaveText('epics · 31.5 sp');
});

/* ── Ordering, complete rendering, and header/rail counts agreeing with the screen ─────────── */

test('all cards render in priority order without a pagination control', async ({ page }) => {
    await openBoard(page);

    expect(await cardKeys(page)).toEqual(EXPECTED_ORDER);
    expect(await visibleColumnCount(page, 'col-1a2b3c4d')).toBe('7');
    await expect(col(page, 'col-1a2b3c4d').locator('.col-more')).toHaveCount(0);
});

test('the epic count in the column header and the folded rail bar agree with the cards on screen', async ({ page }) => {
    await openBoard(page);
    // Open holds all 7 epics and is the largest column, so its rail (when folded) would be the
    // full-height reference; Done holds 1. Assert the header counts match the fixture directly.
    expect(await visibleColumnCount(page, 'col-1a2b3c4d')).toBe('7');
    expect(await visibleColumnCount(page, 'col-2b3c4d5e')).toBe('1');
    expect(await railBarHeightPercent(page, 'col-2b3c4d5e')).toBe(`${Math.round((1 / 7) * 100)}%`);
});

/* ── Search narrows the visible cards, including a Delivery-Owner-only match ─────────────────── */

test('search narrows cards by Delivery Owner and clearing it restores the full set', async ({ page }) => {
    await openBoard(page);

    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    await search.fill('perez');
    await settle(page);

    expect(await cardKeys(page)).toEqual(['PLAT-2']);
    expect(await visibleColumnCount(page, 'col-1a2b3c4d')).toBe('1');
    expect(await visibleColumnCount(page, 'col-2b3c4d5e')).toBe('0');

    await search.fill('');
    await settle(page);
    expect(await cardKeys(page)).toEqual(EXPECTED_ORDER);
    expect(await visibleColumnCount(page, 'col-1a2b3c4d')).toBe('7');
    expect(await visibleColumnCount(page, 'col-2b3c4d5e')).toBe('1');
});

test('search also narrows by key and by summary, case-insensitively', async ({ page }) => {
    await openBoard(page);

    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    await search.fill('plat-6');
    await settle(page);
    expect(await cardKeys(page)).toEqual(['PLAT-6']);

    await search.fill('PLAT-3 EPIC');
    await settle(page);
    expect(await cardKeys(page)).toEqual(['PLAT-3']);
});

// §12.10's third bullet. Search is a client-side predicate over epics already in scope (§8, §9.4),
// so typing must not reach the network at all — not a debounced fetch, not a re-scope.
test('typing in search issues no API request', async ({ page }) => {
    const apiCalls = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) apiCalls.push(`${request.method()} ${url.pathname}`);
    });
    await openBoard(page);
    await settle(page);

    const before = apiCalls.length;
    expect(before, 'the board must have loaded something, or this test proves nothing')
        .toBeGreaterThan(0);

    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    await search.pressSequentially('perez', { delay: 40 });
    await settle(page);
    expect(await cardKeys(page)).toEqual(['PLAT-2']);

    await search.fill('');
    await settle(page);
    expect(apiCalls.slice(before), 'search must not fetch').toEqual([]);
});

/* ── Text-bearing elements do not overflow their box (geometry, not just class presence) ─────── */

test('card text-bearing elements do not overflow their box', async ({ page }) => {
    await openBoard(page);
    const overflow = await openColumnCards(page).evaluateAll((cards) => cards.flatMap((card) => (
        [...card.querySelectorAll('.ekey, .eperson b, .erow2 span, .erow2 time')].map((el) => ({
            className: el.className,
            clips: el.scrollWidth > el.clientWidth + 1,
        }))
    )));
    // Guards against a vacuous pass on an empty result set — 5 cards x 5 selectors each.
    expect(overflow.length).toBeGreaterThanOrEqual(25);
    overflow.forEach(({ className, clips }) => {
        expect(clips, `"${className}" must not overflow its box`).toBe(false);
    });
});

test('a very long epic summary ellipsizes in one fixed-height card row', async ({ page }) => {
    await openBoard(page, { width: 960, height: 760 });
    const longCard = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    const shortCard = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-2"]');
    const geometry = await longCard.evaluate((card) => {
        const row = card.querySelector('.erow1');
        const title = card.querySelector('.etitle');
        const key = card.querySelector('.ekey');
        const cardRect = card.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const keyRect = key.getBoundingClientRect();
        const style = getComputedStyle(title);
        return {
            cardHeight: cardRect.height,
            cardOverflow: card.scrollWidth - card.clientWidth,
            rowOverflow: row.scrollWidth - row.clientWidth,
            titleClips: title.scrollWidth > title.clientWidth + 1,
            titleRight: titleRect.right,
            keyLeft: keyRect.left,
            whiteSpace: style.whiteSpace,
            textOverflow: style.textOverflow,
            overflowX: style.overflowX,
            flexGrow: style.flexGrow,
            flexBasis: style.flexBasis,
        };
    });
    const shortHeight = await shortCard.evaluate((card) => card.getBoundingClientRect().height);

    expect(geometry.titleClips).toBe(true);
    expect(geometry.whiteSpace).toBe('nowrap');
    expect(geometry.textOverflow).toBe('ellipsis');
    expect(geometry.overflowX).toBe('hidden');
    expect(geometry.flexGrow).toBe('1');
    expect(geometry.flexBasis).toBe('0%');
    expect(geometry.titleRight).toBeLessThanOrEqual(geometry.keyLeft + 1);
    expect(geometry.cardOverflow).toBeLessThanOrEqual(1);
    expect(geometry.rowOverflow).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.cardHeight - shortHeight)).toBeLessThanOrEqual(1);
    await expect(longCard.locator('.ecard-open')).toHaveAttribute('aria-label', `PLAT-1: ${LONG_EPIC_SUMMARY}`);
});

test('screenshot: a populated open column', async ({ page }) => {
    await openBoard(page);
    await col(page, 'col-1a2b3c4d').screenshot({ path: path.join(screenshotDir, 'board-card-column.png') });
});
