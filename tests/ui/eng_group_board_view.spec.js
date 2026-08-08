const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

// The Board view itself (§6.1, §6.1.2): columns, folded rails as the chart, focus and star,
// off-frame hints, breach glow, and the invariant that exactly one column is focused and open at
// all times (D43). Geometry is asserted on computed values, never on declarations — an undefined
// custom property drops a whole declaration silently, and this design has been bitten by that.

// tmp/, not test-results/: Playwright wipes its own output dir at the start of every run, so a
// screenshot written there is gone the moment any other spec runs. tmp/ is gitignored.
const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-group-board-view');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

// A trimmed §5.5 reference configuration: the same seven columns, the same colours, the same star,
// and the two properties the design turns on — a breach in each direction (Analysis under min,
// In progress over max) and a RED accent that does not breach (External block).
const BOARD_COLUMNS = [
    { id: 'col-1a2b3c4d', name: 'To do', colour: '#8c8c8c', star: false, min: null, max: null, statuses: ['To Do'] },
    { id: 'col-2b3c4d5e', name: 'Analysis', colour: '#b37feb', star: false, min: 4, max: null, statuses: ['Analysis'] },
    { id: 'col-3c4d5e6f', name: 'Ready to start', colour: '#597ef7', star: false, min: null, max: null, statuses: ['Awaiting Validation', 'Postponed', 'Pending'] },
    { id: 'col-4d5e6f70', name: 'Accepted in Q', colour: '#13c2c2', star: false, min: null, max: 12, statuses: ['Accepted'] },
    { id: 'col-5e6f7081', name: 'External block', colour: '#ff4d4f', star: false, min: null, max: 5, statuses: ['Blocked'] },
    { id: 'col-6f708192', name: 'In progress', colour: '#597ef7', star: true, min: null, max: 1, statuses: ['In Progress', 'Release'] },
    { id: 'col-708192a3', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done', 'Killed', 'Incomplete'] },
];

// key -> [status, priority]. Column epic counts: 2, 1, 1, 1, 1, 3, 1 -> scale max 3.
const EPIC_SPECS = [
    ['PLAT-1', 'To Do', 'Major'],
    ['PLAT-2', 'To Do', 'Blocker'],
    ['PLAT-3', 'Analysis', 'Minor'],
    ['PLAT-4', 'Awaiting Validation', 'Major'],
    ['PLAT-5', 'Accepted', 'Low'],
    ['PLAT-6', 'Blocked', 'Critical'],
    ['PLAT-7', 'In Progress', 'Trivial'],
    ['PLAT-8', 'In Progress', 'Blocker'],
    ['PLAT-9', 'Release', 'Major'],
    ['PLAT-10', 'Done', 'Minor'],
];

function epicPayload(specs = EPIC_SPECS) {
    const epics = {};
    specs.forEach(([key, status, priority]) => {
        epics[key] = {
            key,
            summary: `${key} epic summary`,
            status,
            priority,
            assignee: { displayName: 'Planner' },
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            projectTrack: null,
            updated: '2026-05-01T00:00:00.000+0000',
        };
    });
    return epics;
}

function storyPayload(specs = EPIC_SPECS) {
    return specs.map(([key], index) => ({
        id: `${key}-1`,
        key: `${key}-1`,
        fields: {
            summary: `${key} story`,
            status: { name: 'In Progress' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Planner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: index + 1,
            epicKey: key,
            parentSummary: `${key} epic summary`,
            projectKey: 'PLAT',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    }));
}

async function installBoardFixture(page, {
    board = { columns: BOARD_COLUMNS }, groups = null, epicSpecs = EPIC_SPECS,
} = {}) {
    await installDashboardShell(page);
    await page.route('**/api/**', (route) => {
        const request = route.request();
        const url = new URL(request.url());
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
                groups: groups || [{
                    id: 'grp-default',
                    name: 'Default',
                    teamIds: ['team-alpha'],
                    teamLabels: { 'team-alpha': 'Alpha Team' },
                    ...(board ? { board } : {}),
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
            const epics = epicPayload(epicSpecs);
            return json({ issues: storyPayload(epicSpecs), epics, epicsInScope: Object.values(epics), names: {} });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openBoard(page, {
    width = 1280, height = 900, board, groups, epicSpecs, reducedMotion,
} = {}) {
    if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await installBoardFixture(page, {
        ...(board === undefined ? {} : { board }),
        ...(groups === undefined ? {} : { groups }),
        ...(epicSpecs === undefined ? {} : { epicSpecs }),
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

// The board scrolls with `scroll-behavior: smooth`, so every focus change needs the scroll offset
// to stop moving before geometry means anything.
async function settle(page) {
    // The sentinel is reset per call and three consecutive equal samples are required: a stored
    // value left over from the previous settle would otherwise match a scroll that has not started
    // yet, and two samples can both land on the flat tail of an ease-out curve.
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

// THE invariant, asserted as a total rather than as a set of cases (D43).
async function expectExactlyOneFocused(page, label) {
    const state = await page.evaluate(() => ({
        focused: document.querySelectorAll('.eng-board .col.is-focused').length,
        columns: document.querySelectorAll('.eng-board .col').length,
        open: document.querySelectorAll('.eng-board .col.is-focused, .eng-board .col.is-open').length,
        focusedHasBody: Boolean(document.querySelector('.eng-board .col.is-focused .col-body')),
        focusedBodyVisible: (() => {
            const body = document.querySelector('.eng-board .col.is-focused .col-body');
            return body ? getComputedStyle(body).display !== 'none' : false;
        })(),
    }));
    expect(state.focused, `${label}: exactly one .col.is-focused`).toBe(1);
    expect(state.columns, `${label}: the board still renders columns`).toBeGreaterThan(0);
    expect(state.open, `${label}: the focused column is open`).toBeGreaterThanOrEqual(1);
    expect(state.focusedHasBody, `${label}: the focused column has a body`).toBe(true);
    expect(state.focusedBodyVisible, `${label}: the focused column's body is not display:none`).toBe(true);
}

function col(page, id) {
    return page.locator(`.eng-board .col[data-column-id="${id}"]`);
}

async function focusedId(page) {
    return page.evaluate(() => document.querySelector('.eng-board .col.is-focused')?.dataset.columnId || null);
}

async function boardGeometry(page) {
    return page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const columns = [...document.querySelectorAll('.eng-board .col')];
        const focused = document.querySelector('.eng-board .col.is-focused');
        const focusedRect = focused.getBoundingClientRect();
        return {
            docWidth: document.documentElement.clientWidth,
            docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            boardWidth: Math.round(board.getBoundingClientRect().width),
            boardLeft: Math.round(board.getBoundingClientRect().left),
            focusedWidth: focusedRect.width,
            focusedCentre: focusedRect.left + focusedRect.width / 2,
            distinctTops: [...new Set(columns.map((el) => Math.round(el.getBoundingClientRect().top)))].length,
            openWidths: columns
                .filter((el) => el.classList.contains('is-focused') || el.classList.contains('is-open'))
                .map((el) => Math.round(el.getBoundingClientRect().width)),
            railWidths: columns
                .filter((el) => !el.classList.contains('is-focused') && !el.classList.contains('is-open'))
                .map((el) => Math.round(el.getBoundingClientRect().width)),
        };
    });
}

/* ── The invariant, through every focus-affecting action ────────────────────────────────────── */

test('exactly one column is focused through load, focus, fold, unstar and eight folds', async ({ page }) => {
    await openBoard(page);

    // Initial load: the reference configuration stars In progress, so that is the focus.
    await expectExactlyOneFocused(page, 'initial load');
    expect(await focusedId(page)).toBe('col-6f708192');

    // Focusing another column: the star stays open beside it (D8).
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after focusing another column');
    expect(await focusedId(page)).toBe('col-1a2b3c4d');
    await expect(col(page, 'col-6f708192')).toHaveClass(/is-open/);

    // Folding the focused column: focus TRANSFERS to the star, never clears.
    await col(page, 'col-1a2b3c4d').locator('.col-head').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after folding the focused column');
    expect(await focusedId(page)).toBe('col-6f708192');

    // Unstarring the focused column leaves it focused, merely unpinned.
    await col(page, 'col-6f708192').locator('.col-star').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after unstarring the focused column');
    expect(await focusedId(page)).toBe('col-6f708192');
    await expect(col(page, 'col-6f708192')).not.toHaveClass(/is-starred/);

    // Folding the first column falls right — there is no left neighbour.
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    await col(page, 'col-1a2b3c4d').locator('.col-head').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after folding the first column');
    expect(await focusedId(page)).toBe('col-2b3c4d5e');

    // Eight consecutive folds — the sequence that produced the dead state before D43.
    for (let step = 0; step < 8; step += 1) {
        await page.locator('.eng-board .col.is-focused .col-head').click();
        await settle(page);
        await expectExactlyOneFocused(page, `after fold ${step + 1} of 8`);
    }
});

test('the Fold button is the keyboard path through the same header target', async ({ page }) => {
    // D26 makes the whole header the pointer target; the button inside it is what a keyboard can
    // reach, and its click bubbles to the same handler rather than duplicating it.
    await openBoard(page);
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-1a2b3c4d');

    await col(page, 'col-1a2b3c4d').locator('.fold').focus();
    await expect(col(page, 'col-1a2b3c4d').locator('.fold')).toBeFocused();
    await page.keyboard.press('Enter');
    await settle(page);
    await expectExactlyOneFocused(page, 'after folding with the keyboard');
    expect(await focusedId(page)).toBe('col-6f708192');
});

test('a starred column has no fold action and its header click is a no-op', async ({ page }) => {
    await openBoard(page);

    const starred = col(page, 'col-6f708192');
    await expect(starred).toHaveClass(/is-starred/);
    await expect(starred).toHaveClass(/is-focused/);

    // Withdrawn, not merely styled away: hidden visibility also takes it out of the tab order.
    const fold = await starred.locator('.fold').evaluate((el) => ({
        visibility: getComputedStyle(el).visibility,
        cursor: getComputedStyle(el.closest('.col-head')).cursor,
    }));
    expect(fold.visibility).toBe('hidden');
    expect(fold.cursor).toBe('default');

    // Clicking the header does nothing at all.
    await starred.locator('.col-head .nm').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-6f708192');
    await expectExactlyOneFocused(page, 'after clicking a starred header');

    // The star inside the header is its own control: it toggles and does not fold.
    await starred.locator('.col-star').click();
    await settle(page);
    await expect(starred).not.toHaveClass(/is-starred/);
    await expect(starred).toHaveClass(/is-focused/);
    await expectExactlyOneFocused(page, 'after the star toggled inside a header');
});

/* ── Geometry: one width, centred, never stacked, never overflowing the document ────────────── */

test('the focused column is centred and one fixed width at every tested viewport', async ({ page }) => {
    await openBoard(page);

    for (const width of [2560, 1920, 1440, 1280, 1040, 800, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const geometry = await boardGeometry(page);
        const expected = Math.min(660, Math.round(width * 0.92));

        expect(Math.round(geometry.focusedWidth), `open column width at ${width}`).toBe(expected);
        geometry.openWidths.forEach((openWidth) => {
            expect(openWidth, `every open column shares one width at ${width}`).toBe(expected);
        });
        expect(Math.abs(geometry.focusedCentre - geometry.docWidth / 2), `centred at ${width}`)
            .toBeLessThanOrEqual(1);
        expect(geometry.distinctTops, `board never stacks at ${width}`).toBe(1);
        expect(geometry.docOverflowX, `no document overflow at ${width}`).toBeLessThanOrEqual(1);
        geometry.railWidths.forEach((railWidth) => {
            expect(railWidth, `folded strip width at ${width}`).toBe(36);
        });
    }
});

// §12.11 asks for centring "for every column", and for the open width to be unchanged when a
// second column opens. The sweep above can prove neither: it never moves focus, and the reference
// star IS the initial focus, so `openWidths` holds a single element in every iteration and the
// equal-width assertion is vacuous. Focusing a non-starred column leaves the star open beside it,
// which is the two-open state.
test('every column centres within 1px when focused, and a second open column changes no width', async ({ page }) => {
    await openBoard(page, { width: 1440 });
    const expected = 660;
    const starId = 'col-6f708192';

    const ids = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col')]
        .map((el) => el.dataset.columnId));
    expect(ids).toHaveLength(7);

    // At load the starred column is the focus, and the only open one.
    const atLoad = await boardGeometry(page);
    expect(await focusedId(page)).toBe(starId);
    expect(atLoad.openWidths, 'one open column at load').toEqual([expected]);
    expect(Math.abs(atLoad.focusedCentre - atLoad.docWidth / 2), `${starId} centred`).toBeLessThanOrEqual(1);

    for (const id of ids.filter((entry) => entry !== starId)) {
        await col(page, id).locator('.col-strip').click();
        await settle(page);
        expect(await focusedId(page)).toBe(id);

        const geometry = await boardGeometry(page);
        expect(geometry.openWidths, `focus + star are both open with ${id} focused`)
            .toEqual([expected, expected]);
        expect(Math.abs(geometry.focusedCentre - geometry.docWidth / 2), `${id} centred`)
            .toBeLessThanOrEqual(1);
        expect(geometry.distinctTops, `${id}: still one row`).toBe(1);
        expect(geometry.docOverflowX, `${id}: no document overflow`).toBeLessThanOrEqual(1);
    }
});

test('at 1040 an open column is still 660, because the board is measured against the viewport', async ({ page }) => {
    // The container caps at 1040px; measuring the board against it would give the wrong answer here.
    await openBoard(page, { width: 1040 });
    const geometry = await boardGeometry(page);
    expect(Math.round(geometry.focusedWidth)).toBe(660);
    expect(geometry.boardWidth).toBe(geometry.docWidth);
    expect(geometry.boardLeft).toBe(0);
});

test('the board bleeds to the viewport while the controls row stays at container width, centred', async ({ page }) => {
    await openBoard(page, { width: 1440 });
    const measured = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const board = document.querySelector('.eng-board .board').getBoundingClientRect();
        const controls = document.querySelector('.view-filters').getBoundingClientRect();
        const container = document.querySelector('.container').getBoundingClientRect();
        return {
            docWidth,
            boardWidth: Math.round(board.width),
            boardLeft: Math.round(board.left),
            controlsWidth: Math.round(controls.width),
            containerWidth: Math.round(container.width),
            containerLeft: Math.round(container.left),
            containerRight: Math.round(docWidth - container.right),
            docOverflowX: document.documentElement.scrollWidth - docWidth,
        };
    });

    expect(measured.boardWidth).toBe(measured.docWidth);
    expect(measured.boardLeft).toBe(0);
    expect(measured.containerWidth).toBe(1040);
    expect(measured.controlsWidth).toBeLessThanOrEqual(measured.containerWidth);
    expect(measured.containerLeft).toBe(measured.containerRight);
    expect(measured.docOverflowX).toBeLessThanOrEqual(1);
});

/* ── The folded rails are the chart (D9) ────────────────────────────────────────────────────── */

test('folded rails are a 340px track with the bar hanging from the top, scaled to the largest column', async ({ page }) => {
    await openBoard(page);

    const rails = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col')]
        .filter((el) => !el.classList.contains('is-focused') && !el.classList.contains('is-open'))
        .map((el) => {
            const strip = el.querySelector('.col-strip');
            const fill = strip.querySelector('.fill');
            const stripRect = strip.getBoundingClientRect();
            const fillRect = fill.getBoundingClientRect();
            return {
                id: el.dataset.columnId,
                count: Number(strip.querySelector('.n').textContent),
                stripWidth: Math.round(stripRect.width),
                stripHeight: Math.round(stripRect.height),
                fillHeight: Math.round(fillRect.height),
                hangsFromTop: Math.abs(fillRect.top - stripRect.top) <= 2,
                label: strip.querySelector('.vert').textContent,
                labelTransform: getComputedStyle(strip.querySelector('.vert')).transform,
                labelWritingMode: getComputedStyle(strip.querySelector('.vert')).writingMode,
                labelFontSize: getComputedStyle(strip.querySelector('.vert')).fontSize,
                labelFontWeight: getComputedStyle(strip.querySelector('.vert')).fontWeight,
            };
        }));

    expect(rails.length).toBe(6);
    const scaleMax = 3;
    rails.forEach((rail) => {
        expect(rail.stripWidth, `${rail.id} strip width`).toBe(36);
        expect(rail.stripHeight, `${rail.id} track height`).toBe(340);
        expect(rail.hangsFromTop, `${rail.id} bar hangs from the top`).toBe(true);
        // Proportional to the largest column, within a rounding pixel.
        expect(Math.abs(rail.fillHeight - (rail.count / scaleMax) * 340), `${rail.id} bar length`)
            .toBeLessThanOrEqual(2);
        // D18: rotated 180deg on top of vertical-rl, so whole words read bottom-to-top.
        expect(rail.labelWritingMode, `${rail.id} label writing mode`).toBe('vertical-rl');
        expect(rail.labelTransform, `${rail.id} label rotation`).toBe('matrix(-1, 0, 0, -1, 0, 0)');
        expect(rail.labelFontSize, `${rail.id} label size`).toBe('11.84px'); // 0.74rem
        expect(rail.labelFontWeight, `${rail.id} label weight`).toBe('600');
    });

    // The full track equals the largest column, stated in the on-demand help rather than a
    // persistent configured-Board wallpaper.
    await page.getByRole('button', { name: 'How Group Board works' }).click();
    await expect(page.getByRole('dialog', { name: 'How Group Board works' }))
        .toContainText(`The tallest bar represents ${scaleMax} epics.`);
});

/* ── Off-frame hints are a control, not decoration ──────────────────────────────────────────── */

test('the off-frame hint appears only when a column is off-frame, counts them, and focuses the next one', async ({ page }) => {
    await openBoard(page, { width: 1280 });

    // One open column at 1280: everything fits, so neither hint is on.
    const atRest = await page.evaluate(() => ({
        left: document.querySelector('.eng-board .board-hint.left').classList.contains('is-on'),
        right: document.querySelector('.eng-board .board-hint.right').classList.contains('is-on'),
    }));
    expect(atRest.left).toBe(false);
    expect(atRest.right).toBe(false);

    // Focusing the first column opens two (focus + star), which pushes columns off the frame.
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);

    const hints = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board').getBoundingClientRect();
        // Corroborating, NOT independent: this repeats production's own edge rule, so a wrong
        // epsilon or a flipped direction would move both sides of the comparison together. The
        // fixture-derived literal below is the assertion that can actually fail on its own.
        const outside = { left: 0, right: 0 };
        document.querySelectorAll('.eng-board .col').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.right < board.left + 4) outside.left += 1;
            else if (rect.left > board.right - 4) outside.right += 1;
        });
        const right = document.querySelector('.eng-board .board-hint.right');
        return {
            outside,
            rightOn: right.classList.contains('is-on'),
            rightCount: Number(right.querySelector('b').textContent),
        };
    });
    // Derived from the fixture, not from the DOM: at 1280 with To do focused and In progress
    // starred, the row is 660 + 4x36 + 660 + 36 + 6x8 gaps = 1548 laid out from x=0 after a 310px
    // centring pad, so exactly one column — Done, the last — starts beyond the frame's right edge.
    expect(hints.rightCount).toBe(1);
    expect(hints.rightOn).toBe(true);
    expect(hints.outside.right).toBe(hints.rightCount);
    expect(hints.outside.left).toBe(0);

    // Clicking it focuses the next column in that direction — a control, not decoration.
    await page.locator('.eng-board .board-hint.right .pip').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-2b3c4d5e');
    await expectExactlyOneFocused(page, 'after clicking the right off-frame hint');
});

test('prefers-reduced-motion suppresses the hint nudge and the breach glow animation', async ({ page }) => {
    await openBoard(page, { width: 800, reducedMotion: true });
    const animations = await page.evaluate(() => ({
        pip: getComputedStyle(document.querySelector('.eng-board .board-hint .pip')).animationName,
        breach: getComputedStyle(document.querySelector('.eng-board .col.is-breach .col-strip')).animationName,
    }));
    expect(animations.pip).toBe('none');
    expect(animations.breach).toBe('none');
});

/* ── Breach glow, and the red accent it must stay distinguishable from (D24) ────────────────── */

test('a breach glows and states itself in words in both directions, and a red accent does not', async ({ page }) => {
    await openBoard(page);

    // Analysis: 1 epic against min 4.
    const analysis = col(page, 'col-2b3c4d5e');
    await expect(analysis).toHaveClass(/is-breach/);
    await expect(analysis.locator('.col-strip')).toHaveAttribute('title', /3 under min 4/);

    // In progress: 3 epics against max 1. It is the open column, so the words are on the header.
    const inProgress = col(page, 'col-6f708192');
    await expect(inProgress).toHaveClass(/is-breach/);
    await expect(inProgress.locator('.col-breach')).toContainText('2 over max 1');
    await expect(inProgress.locator('.col-breach')).toBeVisible();

    // External block is RED (#ff4d4f) and 1 epic against max 5: an accent, not a breach.
    const external = col(page, 'col-5e6f7081');
    await expect(external).not.toHaveClass(/is-breach/);

    const distinguishable = await page.evaluate(() => {
        const read = (id) => {
            const el = document.querySelector(`.eng-board .col[data-column-id="${id}"]`);
            const strip = el.querySelector('.col-strip');
            const fill = strip.querySelector('.fill');
            return {
                accent: getComputedStyle(el).getPropertyValue('--board-column-accent').trim(),
                shadow: getComputedStyle(strip).boxShadow,
                animation: getComputedStyle(strip).animationName,
                fillBackground: getComputedStyle(fill).backgroundColor,
                breachTextVisible: getComputedStyle(el.querySelector('.col-breach')).display !== 'none',
            };
        };
        return { external: read('col-5e6f7081'), analysis: read('col-2b3c4d5e') };
    });

    // Same red family, opposite signals: the accent is a fill, the breach is a border plus a glow.
    expect(distinguishable.external.accent).toBe('#ff4d4f');
    expect(distinguishable.external.shadow).toBe('none');
    expect(distinguishable.external.animation).toBe('none');
    expect(distinguishable.external.breachTextVisible).toBe(false);
    expect(distinguishable.analysis.shadow).not.toBe('none');
    expect(distinguishable.analysis.animation).toBe('board-breach-glow');
    expect(distinguishable.analysis.breachTextVisible).toBe(true);
    expect(distinguishable.external.fillBackground).not.toBe(distinguishable.analysis.fillBackground);
});

/* ── A group with no board config still renders exactly one focused column ──────────────────── */

test('configured Board replaces the instruction wallpaper with compact on-demand help', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 720, reducedMotion: true });

    await expect(page.locator('.eng-board .board-head-title')).toHaveCount(0);
    await expect(page.locator('.eng-board .board-head-sub')).toHaveCount(0);
    const helpTrigger = page.getByRole('button', { name: 'How Group Board works' });
    await expect(helpTrigger).toBeVisible();
    await expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: 'How Group Board works' })).toHaveCount(0);

    const closedGeometry = await page.evaluate(() => {
        const wrap = document.querySelector('.filterbar-wrap').getBoundingClientRect();
        const board = document.querySelector('.eng-board .board-scroll').getBoundingClientRect();
        const announcement = document.querySelector('.eng-board .board-say').getBoundingClientRect();
        return {
            gap: board.top - wrap.bottom,
            announcementWidth: announcement.width,
            announcementHeight: announcement.height,
        };
    });
    expect(Math.abs(closedGeometry.gap)).toBeLessThanOrEqual(1);
    expect(closedGeometry.announcementWidth).toBeLessThanOrEqual(1);
    expect(closedGeometry.announcementHeight).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${screenshotDir}/board-configured-help-closed-1280.png`, fullPage: false });

    await helpTrigger.click();
    const help = page.getByRole('dialog', { name: 'How Group Board works' });
    await expect(help).toBeVisible();
    await expect(help).toBeFocused();
    await expect(helpTrigger).toHaveAttribute('aria-expanded', 'true');
    const openGeometry = await help.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const copy = node.querySelector('.board-help-copy');
        return {
            width: rect.width,
            left: rect.left,
            right: rect.right,
            viewport: document.documentElement.clientWidth,
            textTransform: getComputedStyle(copy).textTransform,
            copyFontSize: parseFloat(getComputedStyle(copy).fontSize),
        };
    });
    expect(openGeometry.width).toBeLessThanOrEqual(512 + 1);
    expect(openGeometry.left).toBeGreaterThanOrEqual(11);
    expect(openGeometry.right).toBeLessThanOrEqual(openGeometry.viewport - 11);
    expect(openGeometry.textTransform).toBe('none');
    expect(openGeometry.copyFontSize).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: `${screenshotDir}/board-configured-help-open-1280.png`, fullPage: false });

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(helpTrigger).toBeFocused();

    await helpTrigger.click();
    const filtersTrigger = page.getByRole('button', { name: /^Filters/ });
    await filtersTrigger.click();
    await expect(help).toHaveCount(0);
    await expect(filtersTrigger).toBeFocused();
});

test('open Board help recalculates its width and viewport gutters after resize', async ({ page }) => {
    await openBoard(page, { width: 375, height: 720, reducedMotion: true });

    await page.getByRole('button', { name: 'How Group Board works' }).click();
    const help = page.getByRole('dialog', { name: 'How Group Board works' });
    await expect(help).toBeVisible();
    const readGeometry = () => help.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
            width: rect.width,
            left: rect.left,
            right: rect.right,
            viewport: document.documentElement.clientWidth,
        };
    });

    const narrow = await readGeometry();
    expect(narrow.width).toBeLessThanOrEqual(351 + 1);
    expect(narrow.left).toBeGreaterThanOrEqual(11);
    expect(narrow.right).toBeLessThanOrEqual(narrow.viewport - 11);

    await page.setViewportSize({ width: 900, height: 520 });
    await expect.poll(async () => (await readGeometry()).width).toBeGreaterThanOrEqual(511);
    await expect.poll(async () => {
        const geometry = await readGeometry();
        return geometry.viewport - geometry.right;
    }).toBeGreaterThanOrEqual(11);
    const landscape = await readGeometry();
    expect(landscape.width).toBeGreaterThanOrEqual(511);
    expect(landscape.width).toBeLessThanOrEqual(512 + 1);
    expect(landscape.left).toBeGreaterThanOrEqual(11);
    expect(landscape.right).toBeLessThanOrEqual(landscape.viewport - 11);

    await page.setViewportSize({ width: 320, height: 620 });
    await expect.poll(async () => (await readGeometry()).width).toBeLessThanOrEqual(296 + 1);
    await expect.poll(async () => {
        const geometry = await readGeometry();
        return geometry.viewport - geometry.right;
    }).toBeGreaterThanOrEqual(11);
    const compact = await readGeometry();
    expect(compact.width).toBeLessThanOrEqual(296 + 1);
    expect(compact.left).toBeGreaterThanOrEqual(11);
    expect(compact.right).toBeLessThanOrEqual(compact.viewport - 11);
    await page.screenshot({ path: `${screenshotDir}/board-configured-help-resized-320.png`, fullPage: false });
});

test('a never-configured group gets a first-run column that says so and offers the composer', async ({ page }) => {
    await openBoard(page, { board: null });
    await expectExactlyOneFocused(page, 'no board config');
    await expect(page.locator('.eng-board .col')).toHaveCount(1);
    await expect(page.locator('.eng-board .col.is-focused .col-head .ct')).toHaveText('10');

    // "Unmapped" means "your configuration forgot these statuses" — the wrong thing to say to
    // someone who has not configured anything (§6.1).
    await expect(page.locator('.eng-board .col.is-focused .col-head .nm')).not.toHaveText('Unmapped');
    await expect(page.locator('.eng-board')).not.toContainText('Unmapped');
    await expect(page.locator('.eng-board .board-first-run')).toBeVisible();
    await expect(page.locator('.eng-board .board-first-run')).toContainText('not set up');

    // The link is what makes the state actionable: it opens Settings -> Departments -> Boards.
    const configure = page.locator('.eng-board .board-configure');
    await expect(configure).toBeVisible();
    await configure.click();
    await expect(page.locator('#department-settings-boards-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#department-settings-boards-panel')).toBeVisible();
});

test('a configured board offers no first-run state, and names its leftovers Unmapped', async ({ page }) => {
    // One column, so nine of the ten epics have a status it does not hold.
    await openBoard(page, {
        board: { columns: [BOARD_COLUMNS[0]] },
    });
    await expectExactlyOneFocused(page, 'configured board with leftovers');
    await expect(page.locator('.eng-board .board-first-run')).toHaveCount(0);
    await expect(page.locator('.eng-board .board-configure')).toHaveCount(0);
    await expect(page.locator('.eng-board .col')).toHaveCount(2);
    await expect(page.locator('.eng-board .col').nth(1).locator('.col-strip .vert')).toHaveText('Unmapped');
});

/* ── Carried from Task 11: an affordance that promises nothing is a review stop (D38/D46) ───── */

test('star and Fold are withdrawn on a one-column board, and still render on a multi-column one', async ({ page }) => {
    // The first-run board (§6.1) is the one-column case: folding the only column is impossible
    // (the focus invariant forbids it) and starring it changes nothing visible.
    await openBoard(page, { board: null });
    await expect(page.locator('.eng-board .col')).toHaveCount(1);
    await expect(page.locator('.eng-board .col-star')).toHaveCount(0);
    await expect(page.locator('.eng-board .fold')).toHaveCount(0);

    // The reference configuration is multi-column: both controls render on every column.
    await openBoard(page);
    const columnCount = await page.locator('.eng-board .col').count();
    expect(columnCount).toBeGreaterThan(1);
    await expect(page.locator('.eng-board .col-star')).toHaveCount(columnCount);
    await expect(page.locator('.eng-board .fold')).toHaveCount(columnCount);
});

/* ── §6.1.1 / D28: the board sits under the compact sticky header, hit-tested ───────────────── */

test('the compact sticky header paints over the board, including the off-frame hint', async ({ page }) => {
    // Short viewport so the controls row scrolls away and the compact header takes over, and
    // narrow enough that the off-frame hint — the board's only positioned, z-indexed element — is on.
    await openBoard(page, { width: 800, height: 420, reducedMotion: true });
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(
        () => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'),
        null,
        { timeout: 5000 },
    );
    await settle(page);

    const layering = await page.evaluate(() => {
        const compactEl = document.querySelector('.compact-sticky-header');
        const compact = compactEl.getBoundingClientRect();
        const hint = document.querySelector('.eng-board .board-hint.is-on');
        const focused = document.querySelector('.eng-board .col.is-focused');
        // Hit-test over the focused column, not over the hint: the hint strip is deliberately
        // `pointer-events: none` (only its pip takes clicks), so elementFromPoint would skip it
        // however high its z-index went. The z-index comparison below is what pins the hint.
        const target = focused.getBoundingClientRect();
        const overlapTop = Math.max(compact.top, target.top);
        const overlapBottom = Math.min(compact.bottom, target.bottom);
        const probe = document.elementFromPoint(
            target.left + target.width / 2,
            (overlapTop + overlapBottom) / 2,
        );
        return {
            overlaps: overlapBottom > overlapTop,
            hitIsCompact: Boolean(probe?.closest('.compact-sticky-header')),
            hintZ: getComputedStyle(hint).zIndex,
            compactZ: getComputedStyle(compactEl).zIndex,
            docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(layering.overlaps, 'the compact header and the board actually overlap').toBe(true);
    expect(layering.hitIsCompact).toBe(true);
    expect(Number(layering.hintZ)).toBeLessThan(Number(layering.compactZ));
    expect(Number(layering.compactZ)).toBe(70); // --sticky-compact-z, resolved not declared
    expect(layering.docOverflowX).toBeLessThanOrEqual(1);
});

test('open headers and every collapsed rail pin below the live sticky stack without moving the board', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 10 }, (_, index) => [
            `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];

    await openBoard(page, {
        width: 800,
        height: 620,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });

    // The compact header changes existing page flow as it first appears. Establish its live
    // sticky stack before measuring whether promoting board chrome moves the board itself.
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const before = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const card = document.querySelector('.eng-board .col.is-focused .ecard');
        const rect = card.getBoundingClientRect();
        return {
            height: board.getBoundingClientRect().height,
            cardDocumentTop: rect.top + window.scrollY,
        };
    });

    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${screenshotDir}/board-pinned-800.png`, fullPage: false });

    const pinned = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const stickyTop = parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0;
        const filterBottom = document.querySelector('.filterbar-wrap').getBoundingClientRect().bottom;
        const chromes = [...board.querySelectorAll('.col')].map((column) => {
            const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
            const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
            const columnRect = column.getBoundingClientRect();
            const chromeRect = chrome.getBoundingClientRect();
            return {
                top: chromeRect.top,
                left: chromeRect.left,
                width: chromeRect.width,
                columnLeft: columnRect.left,
                columnWidth: columnRect.width,
                widthTransitions: chrome.getAnimations().filter((animation) => (
                    animation instanceof CSSTransition && animation.transitionProperty === 'width'
                )).length,
            };
        });
        const card = document.querySelector('.eng-board .col.is-focused .ecard').getBoundingClientRect();
        return {
            chromePinned: board.classList.contains('is-chrome-pinned'),
            stickyTop,
            filterBottom,
            chromes,
            height: board.getBoundingClientRect().height,
            cardDocumentTop: card.top + window.scrollY,
            docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(pinned.chromePinned).toBe(true);
    pinned.chromes.forEach((chrome, index) => {
        expect(chrome.widthTransitions, `chrome ${index} has no active width transition`).toBe(0);
        expect(Math.abs(chrome.top - pinned.stickyTop), `chrome ${index} top`).toBeLessThanOrEqual(1);
        expect(Math.abs(chrome.left - chrome.columnLeft), `chrome ${index} left`).toBeLessThanOrEqual(1);
        expect(Math.abs(chrome.width - chrome.columnWidth), `chrome ${index} width`).toBeLessThanOrEqual(1);
        expect(chrome.top, `chrome ${index} remains below the sticky filter surface`).toBeGreaterThanOrEqual(pinned.filterBottom - 1);
    });
    expect(Math.abs(pinned.height - before.height), 'board height remains stable').toBeLessThanOrEqual(1);
    expect(Math.abs(pinned.cardDocumentTop - before.cardDocumentTop), 'card document top remains stable').toBeLessThanOrEqual(1);
    expect(pinned.docOverflowX).toBeLessThanOrEqual(1);
});

test('only a pointer click on a folded rail reveals its first card below the live sticky header', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 32 }, (_, index) => [
            `PLAT-REVEAL-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];

    await openBoard(page, {
        width: 800,
        height: 620,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const before = await page.evaluate(() => ({
        scrollY: window.scrollY,
        boardScrollLeft: document.querySelector('.eng-board .board').scrollLeft,
    }));

    await col(page, 'col-5e6f7081').locator('.col-strip').click();
    await settle(page);

    const revealed = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const opened = document.querySelector('.eng-board .col[data-column-id="col-5e6f7081"]');
        const existingOpen = document.querySelector('.eng-board .col[data-column-id="col-6f708192"]');
        const header = opened.querySelector('.col-head');
        const openedCard = opened.querySelector('.ecard');
        const existingCard = existingOpen.querySelector('.ecard');
        const boardRect = board.getBoundingClientRect();
        const openedRect = opened.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return {
            scrollY: window.scrollY,
            boardScrollLeft: board.scrollLeft,
            stickyTop: parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
            headerTop: headerRect.top,
            headerBottom: headerRect.bottom,
            headerMarginBottom: parseFloat(getComputedStyle(header).marginBottom) || 0,
            openedCardTop: openedCard.getBoundingClientRect().top,
            existingCardTop: existingCard.getBoundingClientRect().top,
            openedCentre: openedRect.left + openedRect.width / 2,
            boardCentre: boardRect.left + board.clientWidth / 2,
        };
    });

    expect(revealed.scrollY, 'pointer opening a folded rail reveals the first epic above the old page position')
        .toBeLessThan(before.scrollY - 1);
    expect(Math.abs(revealed.headerTop - revealed.stickyTop), 'the opened column uses the live sticky stack')
        .toBeLessThanOrEqual(1);
    expect(Math.abs(revealed.openedCardTop - (revealed.headerBottom + revealed.headerMarginBottom)),
        'the first opened card begins immediately below its header').toBeLessThanOrEqual(1);
    expect(Math.abs(revealed.openedCardTop - revealed.existingCardTop),
        'both open columns begin at the same viewport top').toBeLessThanOrEqual(1);
    expect(Math.abs(revealed.openedCentre - revealed.boardCentre),
        'the existing horizontal centering remains intact').toBeLessThanOrEqual(1);
    expect(revealed.boardScrollLeft).not.toBe(before.boardScrollLeft);
    await page.screenshot({ path: `${screenshotDir}/board-folded-rail-reveal-800.png`, fullPage: false });

    const emptyBoard = {
        columns: [
            ...BOARD_COLUMNS.slice(0, 5),
            {
                id: 'col-empty-reveal', name: 'Empty reveal', colour: '#8c8c8c', star: false,
                min: null, max: null, statuses: ['Nothing'],
            },
            ...BOARD_COLUMNS.slice(5),
        ],
    };
    await openBoard(page, {
        width: 800,
        height: 620,
        reducedMotion: true,
        board: emptyBoard,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const beforeEmptyRail = await page.evaluate(() => window.scrollY);
    await col(page, 'col-empty-reveal').locator('.col-strip').click();
    await settle(page);
    expect(await page.evaluate(() => window.scrollY), 'an empty folded column leaves vertical position alone')
        .toBe(beforeEmptyRail);

    await openBoard(page, {
        width: 800,
        height: 620,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const beforeKeyboard = await page.evaluate(() => window.scrollY);
    const keyboardRail = col(page, 'col-5e6f7081').locator('.col-strip');
    await keyboardRail.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await page.evaluate(() => window.scrollY), 'keyboard focus leaves vertical position alone')
        .toBe(beforeKeyboard);
});

test('non-rail Board interactions never reveal the page vertically', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 32 }, (_, index) => [
            `PLAT-NO-REVEAL-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];
    const openPinnedBoard = async () => {
        await openBoard(page, {
            width: 800,
            height: 620,
            reducedMotion: true,
            epicSpecs: longSpecs,
        });
        await page.evaluate(() => {
            const sentinel = document.createElement('div');
            sentinel.className = 'board-no-reveal-sentinel';
            sentinel.style.height = '1000px';
            document.querySelector('.eng-board').after(sentinel);
        });
        await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
        await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    };
    const expectNoPostGestureReveal = async (label, selector, eventName, action) => {
        await page.evaluate(({ targetSelector, type }) => {
            const target = document.querySelector(targetSelector);
            window.__boardGestureScrollY = null;
            target.addEventListener(type, () => {
                window.__boardGestureScrollY = window.scrollY;
            }, { capture: true, once: true });
        }, { targetSelector: selector, type: eventName });
        const result = await action();
        await settle(page);
        const scroll = await page.evaluate(() => ({
            atGesture: window.__boardGestureScrollY,
            afterSettling: window.scrollY,
        }));
        expect(scroll.atGesture, `${label}: the real gesture reached the Board`).not.toBeNull();
        expect(scroll.afterSettling, label).toBe(scroll.atGesture);
        return result;
    };

    await openPinnedBoard();
    const star = col(page, 'col-6f708192').locator('.col-star');
    await expectNoPostGestureReveal(
        'changing the session star does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .col-star',
        'click',
        () => star.click(),
    );
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expectNoPostGestureReveal(
        'folding the focused header does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .col-head',
        'click',
        () => col(page, 'col-6f708192').locator('.col-head').click(),
    );
    expect(await focusedId(page)).toBe('col-5e6f7081');

    await openPinnedBoard();
    await expect(page.locator('.eng-board .board-hint.left .pip')).toBeVisible();
    await expectNoPostGestureReveal(
        'the previous-column off-frame hint does not trigger a later vertical reveal',
        '.eng-board .board-hint.left',
        'click',
        () => page.locator('.eng-board .board-hint.left .pip').click(),
    );
    expect(await focusedId(page)).toBe('col-5e6f7081');
    await expect(page.locator('.eng-board .board-hint.right .pip')).toBeVisible();
    await expectNoPostGestureReveal(
        'the next-column off-frame hint does not trigger a later vertical reveal',
        '.eng-board .board-hint.right',
        'click',
        () => page.locator('.eng-board .board-hint.right .pip').click(),
    );
    expect(await focusedId(page)).toBe('col-6f708192');

    await openPinnedBoard();
    const keyboardFold = col(page, 'col-6f708192').locator('.col-star');
    await expectNoPostGestureReveal(
        'releasing the star before keyboard folding does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .col-star',
        'click',
        () => keyboardFold.click(),
    );
    const fold = col(page, 'col-6f708192').locator('.fold');
    await fold.focus();
    await expectNoPostGestureReveal(
        'keyboard folding does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .fold',
        'click',
        () => page.keyboard.press('Enter'),
    );
    expect(await focusedId(page)).toBe('col-5e6f7081');

    await openPinnedBoard();
    const transitionWrites = [];
    await page.route('**/api/board-config/statuses', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            statuses: [{ id: '10003', name: 'Blocked', statusCategoryKey: 'new' }],
        }),
    }));
    await page.route('**/api/issues/transitions/options', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            issues: [{
                key: 'PLAT-8',
                issueType: 'Epic',
                currentStatus: 'In Progress',
                transitions: [{ name: 'Go Blocked', toStatus: 'Blocked' }],
            }],
            targetStatuses: [{ name: 'Blocked', availableCount: 1, blockedCount: 0 }],
        }),
    }));
    await page.route('**/api/issues/transitions', (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        transitionWrites.push(body);
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                targetStatus: body.targetStatus,
                results: body.issueKeys.map((key) => ({ key, result: 'success', toStatus: body.targetStatus })),
            }),
        });
    });
    const source = page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]');
    const target = col(page, 'col-5e6f7081');
    await expect(source).toHaveAttribute('draggable', 'true');
    const dragOutcome = await expectNoPostGestureReveal(
        'dragging a card onto a folded column does not trigger a later vertical reveal',
        '.eng-board .ecard[data-epic-key="PLAT-8"]',
        'dragstart',
        () => page.evaluate(() => {
            const dragSource = document.querySelector('.eng-board .ecard[data-epic-key="PLAT-8"]');
            const dropTarget = document.querySelector('.eng-board .col[data-column-id="col-5e6f7081"]');
            const dataTransfer = new DataTransfer();
            const rect = dropTarget.getBoundingClientRect();
            const make = (type) => new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: Math.round(rect.left + rect.width / 2),
                clientY: Math.round(rect.top + Math.min(rect.height / 2, 160)),
            });
            const start = make('dragstart');
            dragSource.dispatchEvent(start);
            dropTarget.dispatchEvent(make('dragenter'));
            const over = make('dragover');
            dropTarget.dispatchEvent(over);
            dropTarget.dispatchEvent(make('drop'));
            dragSource.dispatchEvent(make('dragend'));
            return { started: !start.defaultPrevented, overAccepted: over.defaultPrevented };
        }),
    );
    expect(dragOutcome).toEqual({ started: true, overAccepted: true });
    await expect.poll(() => transitionWrites.length).toBe(1);
    expect(transitionWrites).toEqual([{ issueKeys: ['PLAT-8'], targetStatus: 'Blocked' }]);
    await expect(source).toHaveCount(0);
    await expect(target.locator('.col-strip .n')).toHaveText('2');
});

test('pinned chrome stays interactive and releases each element at the board bottom', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 10 }, (_, index) => [
            `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];

    await openBoard(page, {
        width: 800,
        height: 620,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => {
        const sentinel = document.createElement('div');
        sentinel.className = 'board-release-sentinel';
        sentinel.textContent = 'Later page content';
        sentinel.style.height = '500px';
        document.querySelector('.eng-board').after(sentinel);
    });
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'));
    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    // The External block rail is visible beside the focused column and remains a live focus target
    // after the board promotes it to fixed chrome.
    await col(page, 'col-5e6f7081').locator('.col-strip').click();
    await settle(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await focusedId(page)).toBe('col-5e6f7081');

    const centred = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col')].map((column) => {
        const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
        const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
        const columnRect = column.getBoundingClientRect();
        const chromeRect = chrome.getBoundingClientRect();
        return {
            left: chromeRect.left,
            width: chromeRect.width,
            columnLeft: columnRect.left,
            columnWidth: columnRect.width,
        };
    }));
    centred.forEach((chrome, index) => {
        expect(Math.abs(chrome.left - chrome.columnLeft), `centred chrome ${index} left`).toBeLessThanOrEqual(1);
        expect(Math.abs(chrome.width - chrome.columnWidth), `centred chrome ${index} width`).toBeLessThanOrEqual(1);
    });

    const fold = col(page, 'col-5e6f7081').locator('.fold');
    await fold.focus();
    await expect(fold).toBeFocused();
    await page.keyboard.press('Enter');
    await settle(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await focusedId(page)).toBe('col-6f708192');

    const releaseAt = async (selector) => {
        await page.evaluate((targetSelector) => {
            const board = document.querySelector('.eng-board .board');
            const chrome = document.querySelector(targetSelector);
            const stickyTop = parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0;
            const targetBottom = stickyTop + chrome.getBoundingClientRect().height - 0.5;
            window.scrollTo(0, window.scrollY + board.getBoundingClientRect().bottom - targetBottom);
        }, selector);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    const readRelease = () => page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const boardBottom = board.getBoundingClientRect().bottom;
        const chromes = [...board.querySelectorAll('.col')].map((column) => {
            const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
            const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
            const rect = chrome.getBoundingClientRect();
            return { type: isOpen ? 'header' : 'rail', bottom: rect.bottom };
        });
        const sentinel = document.querySelector('.board-release-sentinel');
        const sentinelRect = sentinel.getBoundingClientRect();
        const probe = document.elementFromPoint(400, Math.ceil(sentinelRect.top + 8));
        return {
            boardBottom,
            chromes,
            laterContentHit: Boolean(probe?.closest('.board-release-sentinel')),
            laterContentCovered: Boolean(probe?.closest('.eng-board .board.is-chrome-pinned .col-head, .eng-board .board.is-chrome-pinned .col-strip')),
        };
    });

    await releaseAt('.eng-board .col:not(.is-open):not(.is-focused) .col-strip');
    const railRelease = await readRelease();
    railRelease.chromes.forEach((chrome, index) => {
        expect(chrome.bottom, `rail release chrome ${index} remains inside the board`).toBeLessThanOrEqual(railRelease.boardBottom + 1);
    });
    expect(railRelease.chromes.some((chrome) => (
        chrome.type === 'rail' && Math.abs(chrome.bottom - railRelease.boardBottom) <= 1
    ))).toBe(true);

    await releaseAt('.eng-board .col.is-focused .col-head');
    const headerRelease = await readRelease();
    headerRelease.chromes.forEach((chrome, index) => {
        expect(chrome.bottom, `header release chrome ${index} remains inside the board`).toBeLessThanOrEqual(headerRelease.boardBottom + 1);
    });
    expect(headerRelease.chromes.some((chrome) => (
        chrome.type === 'header' && Math.abs(chrome.bottom - headerRelease.boardBottom) <= 1
    ))).toBe(true);
    expect(headerRelease.laterContentHit).toBe(true);
    expect(headerRelease.laterContentCovered).toBe(false);
});

/* ── Screenshots, settled ───────────────────────────────────────────────────────────────────── */

test('board renders at a wide and a narrow width', async ({ page }) => {
    await openBoard(page, { width: 1440, reducedMotion: true });
    await page.screenshot({ path: `${screenshotDir}/board-1440.png`, fullPage: false });

    await page.setViewportSize({ width: 800, height: 900 });
    await settle(page);
    await page.screenshot({ path: `${screenshotDir}/board-800.png`, fullPage: false });

    const geometryBefore = await boardGeometry(page);
    expect(geometryBefore.distinctTops).toBe(1);
    expect(geometryBefore.docOverflowX).toBeLessThanOrEqual(1);
});

// §12.2/§12.11: the computed transform is asserted per rail above, but the plan is explicit that
// "the transform value alone does not prove reading direction" — a clipped capture of one rail is
// the other half, and it is the only artifact a human can read the label off.
test('a clipped rail capture shows the label reading bottom-to-top', async ({ page }) => {
    await openBoard(page, { width: 1440, reducedMotion: true });

    const rail = col(page, 'col-1a2b3c4d').locator('.col-strip');
    const box = await rail.boundingBox();
    expect(box, 'the To do rail must be on screen to be clipped').not.toBeNull();
    await page.screenshot({
        path: `${screenshotDir}/rail-label-to-do.png`,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });

    // The capture is only evidence if it really is a vertical rail carrying the whole label.
    const label = await rail.locator('.vert').evaluate((node) => ({
        text: node.textContent,
        writingMode: getComputedStyle(node).writingMode,
        transform: getComputedStyle(node).transform,
        clipped: node.scrollWidth - node.clientWidth,
        taller: node.getBoundingClientRect().height > node.getBoundingClientRect().width,
    }));
    expect(label.text).toBe('To do');
    expect(label.writingMode).toBe('vertical-rl');
    expect(label.transform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    expect(label.clipped, 'the rail label must not be clipped').toBeLessThanOrEqual(1);
    expect(label.taller, 'a vertical label is taller than it is wide').toBe(true);
});

// tests/test_eng_board_styles.js proves every `var()` in board.css is DECLARED somewhere in the
// concatenated source — under any selector, which is weaker than it looks: a token declared on an
// unrelated block still counts, while at runtime the declaration reading it silently drops. Six
// phantom variables were found in this plan's assets, so the same list is re-checked here against
// the live cascade, which is the property that actually matters.
test('every custom property board.css reads resolves on the live board', async ({ page }) => {
    const boardCssSource = fs
        .readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'eng', 'board.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // Reads WITHOUT a fallback only: `var(--x, 3px)` cannot drop its declaration, so it is not the
    // failure mode this guards, and `--board-hint-nudge` is legitimately set on the pip alone.
    const names = [...new Set(
        [...boardCssSource.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((match) => match[1])
    )];
    expect(names.length, 'expected board.css to read custom properties').toBeGreaterThan(0);

    await openBoard(page, {
        width: 800,
        height: 620,
        reducedMotion: true,
        epicSpecs: [
            ...EPIC_SPECS,
            ...Array.from({ length: 10 }, (_, index) => [
                `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
            ]),
        ],
    });
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'));
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const resolve = (props) => page.evaluate((list) => {
        const hosts = [
            '.eng-board', '.eng-board .col', '.eng-board .col-strip', '.eng-board .ecard',
            '.eng-board .board-hint .pip',
        ]
            .map((selector) => document.querySelector(selector))
            .filter(Boolean);
        hosts.push(document.documentElement);
        return list.filter((name) => hosts
            .every((host) => getComputedStyle(host).getPropertyValue(name).trim() === ''));
    }, props);

    expect(await resolve(names), 'a var() that resolves nowhere drops its whole declaration').toEqual([]);
    // Non-vacuous: the same probe reports a token that genuinely does not exist.
    expect(await resolve(['--not-a-real-token'])).toEqual(['--not-a-real-token']);
});

// §12.2: the mockups carried `.shell`, `.seg`, `.field` and `.compact-inner` for several revisions
// while the document claimed real classes. None may reach production.
test('no mockup-only chrome class renders anywhere in Board', async ({ page }) => {
    await openBoard(page, { width: 1440 });

    const found = await page.evaluate(() => {
        const shadow = ['shell', 'seg', 'field', 'compact-inner'];
        return shadow.filter((name) => document.querySelectorAll(`.${name}`).length > 0);
    });
    expect(found, 'mockup-only chrome classes must not render').toEqual([]);

    // Non-vacuous: the same probe finds the classes the board really does use.
    const real = await page.evaluate(() => ['eng-board', 'col', 'col-strip', 'container']
        .filter((name) => document.querySelectorAll(`.${name}`).length > 0));
    expect(real).toEqual(['eng-board', 'col', 'col-strip', 'container']);
});

test('first-run board renders its own state', async ({ page }) => {
    await openBoard(page, { width: 1440, board: null, reducedMotion: true });
    await page.screenshot({ path: `${screenshotDir}/board-first-run-1440.png`, fullPage: false });

    const geometry = await boardGeometry(page);
    expect(geometry.distinctTops).toBe(1);
    expect(geometry.docOverflowX).toBeLessThanOrEqual(1);
});

// The regression that made the bleed CSS rather than JS: measured with NO settle, exactly as
// tests/ui/codebase_structure_smoke.spec.js measures after its own resizes. A JS-written pixel
// width leaves the board wider than the new viewport until its handler runs — 132px of document
// overflow going 1280 -> 1028, and 385px going 390 -> 375.
test('a resize never leaves the board wider than the viewport, even before anything settles', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 760 });
    for (const width of [1280, 1028, 760, 390, 375, 1440]) {
        await page.setViewportSize({ width, height: 760 });
        const measured = await page.evaluate(() => {
            const rect = document.querySelector('.eng-board .board').getBoundingClientRect();
            return {
                docWidth: document.documentElement.clientWidth,
                docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                left: Math.round(rect.left),
                width: Math.round(rect.width),
            };
        });
        expect(measured.docOverflowX, `document overflow immediately after resizing to ${width}`)
            .toBeLessThanOrEqual(1);
        expect(measured.left, `board pinned to the viewport edge at ${width}`).toBe(0);
        expect(measured.width, `board bleeds to the viewport at ${width}`).toBe(measured.docWidth);
    }
});

/* ── §12.9: focus and star are session view state and survive an unmount ────────────────────── */

// Both tests move focus AWAY from the default first, or they could not fail: the default is what
// a lost preference falls back to, so restoring "the default" proves nothing.
test('Board -> Statistics -> Board restores a non-default focused column', async ({ page }) => {
    await openBoard(page);
    expect(await focusedId(page)).toBe('col-6f708192'); // the starred default

    await col(page, 'col-3c4d5e6f').locator('.col-strip').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-3c4d5e6f');

    const modes = page.locator('.view-selector .eng-mode-control');
    await modes.getByRole('radio', { name: 'Statistics' }).click();
    await expect(page.locator('.eng-board')).toHaveCount(0);
    await modes.getByRole('radio', { name: 'Board' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);

    expect(await focusedId(page)).toBe('col-3c4d5e6f');
    await expectExactlyOneFocused(page, 'after a mode round-trip');
});

test('a group switch and back restores the focused column and the session star', async ({ page }) => {
    const group = (id, name) => ({
        id,
        name,
        teamIds: ['team-alpha'],
        teamLabels: { 'team-alpha': 'Alpha Team' },
        board: { columns: BOARD_COLUMNS },
    });
    await openBoard(page, { groups: [group('grp-default', 'Default'), group('grp-second', 'Second')] });

    // Move both preferences off their stored defaults.
    await col(page, 'col-6f708192').locator('.col-star').click();   // unstar the config star
    await settle(page);
    await col(page, 'col-708192a3').locator('.col-strip').click();  // focus the last column
    await settle(page);
    await col(page, 'col-708192a3').locator('.col-star').click();   // star it for the session
    await settle(page);
    expect(await focusedId(page)).toBe('col-708192a3');
    await expect(col(page, 'col-708192a3')).toHaveClass(/is-starred/);

    const groupToggle = page.locator('.view-selector .group-dropdown-toggle');
    await groupToggle.click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: 'Second' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    // A group that has never been opened starts from its own stored default, not the other's.
    expect(await focusedId(page)).toBe('col-6f708192');
    await expectExactlyOneFocused(page, 'after switching to a fresh group');

    await groupToggle.click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: 'Default' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    expect(await focusedId(page)).toBe('col-708192a3');
    await expect(col(page, 'col-708192a3')).toHaveClass(/is-starred/);
    await expect(col(page, 'col-6f708192')).not.toHaveClass(/is-starred/);
    await expectExactlyOneFocused(page, 'after switching back');
});

/* ── The star says what it is (§6.1): a session view preference, not shared config ──────────── */

test('the star control states that it is a session preference the composer overrides', async ({ page }) => {
    await openBoard(page);
    const star = col(page, 'col-6f708192').locator('.col-star');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toHaveAttribute('title', /this session/i);
    await expect(star).toHaveAttribute('title', /Group Board settings/i);
    await expect(star).toHaveAttribute('aria-label', /this session/i);

    await star.click();
    await settle(page);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(star).toHaveAttribute('title', /this session/i);
    await expect(star).toHaveAttribute('aria-label', /this session/i);
});

/* ── Accessibility and cleanup the review named ─────────────────────────────────────────────── */

test('the column header is a named region and adds no second tab stop beside Fold', async ({ page }) => {
    await openBoard(page);
    const head = col(page, 'col-6f708192').locator('.col-head');
    await expect(head).toHaveAttribute('role', 'group');
    await expect(head).toHaveAttribute('aria-label', /In progress/);
    // D26 keeps the whole header as the POINTER target; the keyboard target is Fold alone.
    expect(await head.evaluate((node) => node.getAttribute('tabindex'))).toBeNull();

    // A non-starred column's Fold names its column, so seven "Fold" buttons are not ambiguous.
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    await expect(col(page, 'col-1a2b3c4d').locator('.fold')).toHaveAttribute('aria-label', /To do/);
});

test('leaving Board removes the scrollbar-width custom property it published', async ({ page }) => {
    await openBoard(page);
    expect(await page.evaluate(
        () => document.documentElement.style.getPropertyValue('--board-scrollbar-width'),
    )).not.toBe('');

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.locator('.eng-board')).toHaveCount(0);
    expect(await page.evaluate(
        () => document.documentElement.style.getPropertyValue('--board-scrollbar-width'),
    )).toBe('');
});
