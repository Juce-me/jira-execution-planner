const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { collectStickySnapshots } = require('./eng_sticky_stack_helpers');
const { installDashboardShell } = require('./epm_home_token_fixture');

// Task 13 — mounting the shared filter bar in Board with the Board's own facet set (§7.1, §7.2,
// §7.3, §7.6, D13, D19-21, D33-35). The bar's own mechanics (popover fit, chip collapse math,
// the no-empty-set rule) are Task 4/5's; this spec only proves the Board's facet SET, its epic
// subject, and that it never leaks into or out of Catch Up's own bar.

const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-group-board-filters');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const BAR_ROW_HEIGHT = 42;
// Captured from the pre-change shared wrapper: the fixed 42px bar plus the existing 0.85rem
// spacer. Keeping this stable proves moving the spacer does not move the downstream sticky stack.
const FILTERBAR_WRAP_HEIGHT = 55.6;

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

const BOARD_COLUMNS = [
    { id: 'col-open', name: 'Open', colour: '#597ef7', star: true, min: null, max: null, statuses: ['To Do', 'In Progress'] },
    { id: 'col-done', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'] },
];

// Six epics chosen to exercise all four facets and D41's mixed Tech/Product case at once:
//   key   | status      | priority | projects       | assignee   | track
//   EPX-1 | To Do       | Blocker  | Tech only      | assigned   | Committed
//   EPX-2 | To Do       | Critical | Product only   | assigned   | Flexible
//   EPX-3 | In Progress | Critical | Tech + Product | unassigned | none
//   EPX-4 | In Progress | Major    | Product only   | unassigned | none
//   EPX-5 | Done        | Minor    | Tech only       | assigned   | Committed
//   EPX-6 | To Do       | Low      | Product only    | assigned   | none
const EPIC_SPECS = [
    ['EPX-1', 'To Do', 'Blocker', ['TECH'], 'Ann Adams', 'Committed'],
    ['EPX-2', 'To Do', 'Critical', ['PROD'], 'Bob Brown', 'Flexible'],
    ['EPX-3', 'In Progress', 'Critical', ['TECH', 'PROD'], null, null],
    ['EPX-4', 'In Progress', 'Major', ['PROD'], null, null],
    ['EPX-5', 'Done', 'Minor', ['TECH'], 'Cara Chen', 'Committed'],
    ['EPX-6', 'To Do', 'Low', ['PROD'], 'Dev Dutta', null],
];

function epicPayload(epicSpecs = EPIC_SPECS) {
    const epics = {};
    epicSpecs.forEach(([key, status, priority, , assigneeName, track]) => {
        epics[key] = {
            key,
            summary: `${key} epic summary`,
            status,
            priority,
            assignee: assigneeName ? { displayName: assigneeName } : null,
            deliveryOwner: null,
            projectTrack: track,
            updated: '2026-07-20T00:00:00.000+0000',
        };
    });
    return epics;
}

function storyPayload(epicSpecs = EPIC_SPECS) {
    const rows = [];
    epicSpecs.forEach(([key, status, priority, projectKeys]) => {
        projectKeys.forEach((projectKey, index) => {
            rows.push({
                id: `${key}-${index + 1}`,
                key: `${key}-${index + 1}`,
                fields: {
                    summary: `${key} story ${index + 1}`,
                    status: { name: status },
                    priority: { name: priority },
                    issuetype: { name: 'Story' },
                    assignee: { displayName: 'Planner' },
                    updated: '2026-07-20T00:00:00.000+0000',
                    customfield_10004: index + 1,
                    epicKey: key,
                    parentSummary: `${key} epic summary`,
                    projectKey,
                    teamId: 'team-alpha',
                    teamName: 'Alpha Team',
                    sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                },
            });
        });
    });
    return rows;
}

async function installBoardFixture(page, { analyticsContext = { enabled: false }, groups = null, epicSpecs = EPIC_SPECS } = {}) {
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
        if (url.pathname === '/api/analytics/context') return json(analyticsContext);
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: groups || [{
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

async function openBoard(page, { width = 1280, height = 900, analyticsContext, groups, epicSpecs } = {}) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await installBoardFixture(page, {
        ...(analyticsContext ? { analyticsContext } : {}),
        ...(groups ? { groups } : {}),
        ...(epicSpecs ? { epicSpecs } : {}),
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

async function waitForVisualSettled(page) {
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document.getAnimations({ subtree: true });
        if (animations.length > 0) {
            await Promise.race([
                Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
                new Promise((resolve) => window.setTimeout(resolve, 1200)),
            ]);
        }
        await new Promise(requestAnimationFrame);
    });
}

async function measureFilterbarWrapper(page) {
    return page.locator('.filterbar-wrap').evaluate((wrap) => {
        const bar = wrap.querySelector(':scope > .filterbar');
        const wrapRect = wrap.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        const styles = getComputedStyle(wrap);
        return {
            topInset: barRect.top - wrapRect.top,
            bottomInset: wrapRect.bottom - barRect.bottom,
            paddingBottom: parseFloat(styles.paddingBottom) || 0,
            heightIdentity: wrapRect.height - barRect.height
                - (barRect.top - wrapRect.top)
                - (wrapRect.bottom - barRect.bottom),
            wrapperHeight: wrapRect.height,
        };
    });
}

function col(page, id) {
    return page.locator(`.eng-board .col[data-column-id="${id}"]`);
}

function openColumnCards(page, id) {
    return col(page, id).locator('.col-body .ecard');
}

async function cardKeys(page, id) {
    return openColumnCards(page, id).evaluateAll((cards) => cards.map((card) => card.dataset.epicKey).sort());
}

// Whichever count is actually rendered: the open column's is `.col-head .ct`, a folded column's
// is `.col-head { display: none }` (board.css), so only the rail's `.cap .n` is visible for it.
async function visibleColumnCount(page, id) {
    const target = col(page, id);
    const isOpen = await target.evaluate((el) => el.classList.contains('is-open') || el.classList.contains('is-focused'));
    const text = await (isOpen ? target.locator('.col-head .ct') : target.locator('.col-strip .cap .n')).innerText();
    return Number(text);
}

async function railFillHeight(page, id) {
    return col(page, id).locator('.col-strip .fill').evaluate((el) => el.style.height);
}

const popover = (page) => page.locator('.popover');
const facetGroup = (page, facetId) => popover(page).locator(`.pop-group[data-facet="${facetId}"]`);
const facetOption = (page, facetId, optionId) => facetGroup(page, facetId).locator(`.pop-opt[data-option="${optionId}"]`);

async function openFilters(page) {
    if (await popover(page).count() === 0) {
        await page.locator('.fb-trigger').click();
    }
    await expect(popover(page)).toBeVisible();
}

async function closeFilters(page) {
    if (await popover(page).count() > 0) {
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
    }
}

// A plain click, never click({ force: true }) — forcing would mask the exact layering bug D28's
// hit-test exists to catch, and a locked option must genuinely refuse a real click.
async function tickOption(page, facetId, optionId) {
    await openFilters(page);
    await facetOption(page, facetId, optionId).click();
}

// textContent, not innerText: `.fb-readout .dim` is CSS text-transform: uppercase, and
// innerText returns the rendered (uppercase) text rather than the DOM's actual lowercase string.
async function readout(page) {
    const [count, unit] = await Promise.all([
        page.locator('.fb-readout b').textContent(),
        page.locator('.fb-readout .dim').textContent(),
    ]);
    return `${count} ${unit}`;
}

// Every text-bearing element in the bar, measured on itself — a container's bounding box cannot
// see overflowing nowrap text (MRT020).
async function measureBar(page, baselineOverflow = 1) {
    const metrics = await page.evaluate(() => {
        const bar = document.querySelector('.filterbar');
        const barRect = bar.getBoundingClientRect();
        const centres = [...bar.children]
            .map((child) => child.getBoundingClientRect())
            .filter((rect) => rect.height > 0)
            .map((rect) => rect.top + rect.height / 2)
            .sort((a, b) => a - b);
        const rows = centres.reduce((lines, centre) => (
            lines.length && centre - lines[lines.length - 1] < 12 ? lines : [...lines, centre]
        ), []);
        const labelSelectors = [
            '.fb-trigger',
            '.fb-trigger .badge',
            '.fb-readout b',
            '.fb-readout .dim',
            '.chip:not([hidden]) .facet',
            '.chip:not([hidden]) .verb',
            '.chip:not([hidden]) .names',
            '.chip-more:not([hidden])',
            '.chip-clear',
        ];
        const labels = labelSelectors.flatMap((selector) => [...bar.querySelectorAll(selector)].map((node) => ({
            selector,
            text: node.textContent.trim().slice(0, 40),
            clipped: node.scrollWidth - node.clientWidth,
            right: node.getBoundingClientRect().right,
            groupRight: node.closest('.pop-host, .fb-readout, .chip, .chip-clear').getBoundingClientRect().right,
        })));
        const lane = bar.querySelector('.fb-chips');
        const more = bar.querySelector('.chip-more');
        return {
            height: barRect.height,
            width: barRect.width,
            containerWidth: bar.closest('.container').getBoundingClientRect().width,
            rows: rows.length,
            labels,
            chipsTotal: bar.querySelectorAll('.chip:not(.chip-more)').length,
            chipsVisible: bar.querySelectorAll('.chip:not(.chip-more):not([hidden])').length,
            chipsHidden: bar.querySelectorAll('.chip:not(.chip-more)[hidden]').length,
            moreHidden: more ? more.hidden : null,
            moreText: more && !more.hidden ? more.textContent.trim() : '',
            laneOverflow: lane.scrollWidth - lane.clientWidth,
            clear: (() => {
                const node = bar.querySelector('.chip-clear');
                if (!node) return null;
                const rect = node.getBoundingClientRect();
                const laneRect = lane.getBoundingClientRect();
                return {
                    width: Math.round(rect.width),
                    clippedByLane: Math.round(Math.max(0, rect.right - laneRect.right, laneRect.left - rect.left)),
                };
            })(),
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    return { ...metrics, baselineOverflow: Math.max(1, baselineOverflow) };
}

function expectNoClipping(metrics) {
    metrics.labels.forEach((label) => {
        expect(label.clipped, `${label.selector} ("${label.text}") is clipped`).toBeLessThanOrEqual(1);
        expect(label.right, `${label.selector} ("${label.text}") overflows its group`)
            .toBeLessThanOrEqual(label.groupRight + 1);
    });
    expect(metrics.clear.clippedByLane, 'Clear all is clipped by the chips lane').toBe(0);
    expect(metrics.documentOverflow).toBeLessThanOrEqual(metrics.baselineOverflow);
}

/* ── §10.3: facet ticks, chip clears and +n more emit NO analytics ─────────────────────────────── */

// A real regression, only reachable now that Board has facets to tick: with search text active,
// trackSearch dedupes on a signature that includes the result count, so feeding it the
// facet-filtered count (instead of the search-only one) fires a new app_search on every tick.
test('a facet tick with search text active fires no new app_search event', async ({ page }) => {
    // The GTM script load and any GA request must be mocked too, or initAnalytics()'s lazy load
    // hits the real network. Registered before the first navigation, alongside installBoardFixture
    // serving /api/analytics/context itself — a route added after the fact would race an
    // already-resolved fetch, and a same-URL fetch can also be served from the browser's own HTTP
    // cache on a later reload, bypassing routing entirely; one code path from the start avoids both.
    const gtmRequests = [];
    await page.route('https://www.googletagmanager.com/gtm.js?id=GTM-TEST0000', (route) => {
        gtmRequests.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.route('https://www.google-analytics.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await openBoard(page, {
        analyticsContext: { enabled: true, gtmContainerId: 'GTM-TEST0000', ga4UserId: 'user-test', debugMode: false },
    });
    // The app's own bootstrap calls initAnalytics() once, gated by authMode; trackSearch's dedup
    // ref is written BEFORE the push is attempted, so a search fired before that async call
    // resolves would permanently poison the dedup signature with an event that never actually
    // reached dataLayer. Calling it directly (idempotent: it only re-applies the same context)
    // is the deterministic way to know analytics is armed before this test's real subject —
    // trackSearch's dedup behaviour — runs, rather than racing the app's own effect timing.
    await page.evaluate(() => window.JepAnalytics.initAnalytics());
    await expect.poll(() => gtmRequests.length).toBeGreaterThan(0);

    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    await search.fill('epx'); // matches every epic's key, so this narrows nothing on its own
    await waitForVisualSettled(page);

    const appSearchCount = () => page.evaluate(
        () => window.dataLayer.filter((entry) => entry && entry.event_name === 'app_search').length
    );
    await expect.poll(appSearchCount).toBeGreaterThan(0); // the search itself must still track
    const before = await appSearchCount();

    await tickOption(page, 'assignee', 'unassigned'); // narrows the FACET-filtered count, not the search-only one
    await tickOption(page, 'track', 'flexible');
    await tickOption(page, 'track', 'committed');
    await closeFilters(page);
    await waitForVisualSettled(page);

    const after = await appSearchCount();
    expect(after, 'a facet tick must fire no new app_search event').toBe(before);
    await page.locator('.chip-clear').click();
    expect(await appSearchCount(), 'resetting explicit No Project Track must emit no app_search').toBe(before);
});

/* ── D19/§12.3: the facet set differs by mode, and the test proves both sides ─────────────────── */

test('Board filters epics with no Status facet; Catch Up filters stories with Status and Project Track', async ({ page }) => {
    await openBoard(page);
    await openFilters(page);
    await expect(page.locator('.pop-subject')).toHaveText('Filtering epics');
    await expect(facetGroup(page, 'status')).toHaveCount(0);
    await expect(facetGroup(page, 'priority')).toHaveCount(1);
    await expect(facetGroup(page, 'projects')).toHaveCount(1);
    await expect(facetGroup(page, 'assignee')).toHaveCount(1);
    await expect(facetGroup(page, 'track')).toHaveCount(1);
    // §7.2's order, with Project Track last (D21).
    await expect(popover(page).locator('.pop-group')).toHaveCount(4);
    const facetOrder = await popover(page).locator('.pop-group').evaluateAll(
        (nodes) => nodes.map((node) => node.dataset.facet)
    );
    expect(facetOrder).toEqual(['priority', 'projects', 'assignee', 'track']);
    await closeFilters(page);

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await page.waitForSelector('.filterbar');
    await openFilters(page);
    await expect(page.locator('.pop-subject')).toHaveText('Filtering stories');
    await expect(facetGroup(page, 'status')).toHaveCount(1);
    await expect(facetGroup(page, 'priority')).toHaveCount(1);
    await expect(facetGroup(page, 'projects')).toHaveCount(1);
    await expect(facetGroup(page, 'assignee')).toHaveCount(0);
    await expect(facetGroup(page, 'track')).toHaveCount(1);
});

// §12.4's last row: every facet heading carries a total, and none of them is blank or NaN. The
// Project Track rows below assert the totals that are interesting; this one asserts that the
// other three exist at all, which is what an `admittedTotal` wired only into `track` would fail.
test('every facet heading carries a numeric total, on both surfaces', async ({ page }) => {
    await openBoard(page);
    await openFilters(page);

    const readTotals = async () => popover(page).locator('.pop-group').evaluateAll(
        (nodes) => nodes.map((node) => ({
            facet: node.dataset.facet,
            total: node.querySelector('.pop-total')?.textContent ?? null,
        }))
    );

    const boardTotals = await readTotals();
    expect(boardTotals.map((entry) => entry.facet)).toEqual(['priority', 'projects', 'assignee', 'track']);
    boardTotals.forEach(({ facet, total }) => {
        expect(total, `${facet} renders a total`).not.toBeNull();
        expect(total, `${facet}'s total is not blank`).not.toBe('');
        expect(Number.isFinite(Number(total)), `${facet}'s total "${total}" is a number`).toBe(true);
    });
    await closeFilters(page);

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await page.waitForSelector('.filterbar');
    await openFilters(page);

    const catchUpTotals = await readTotals();
    expect(catchUpTotals.map((entry) => entry.facet)).toEqual(['status', 'priority', 'projects', 'track']);
    catchUpTotals.forEach(({ facet, total }) => {
        expect(Number.isFinite(Number(total)), `Catch Up ${facet}'s total "${total}" is a number`).toBe(true);
    });
});

// §12.11's dropdown-layering bullet, hit-tested on the BOARD. The equivalent proof exists for
// Catch Up (eng_compact_layout_visual.spec.js), but the board is the surface whose full-bleed
// scroll container and sticky header are new here. elementFromPoint, then a plain click — never
// click({ force: true }), which is what masked this class of bug before.
test('the Board filter-bar popover paints over the board and takes a plain click', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 600 });
    const filterbarGeometry = await measureFilterbarWrapper(page);
    expect(filterbarGeometry.topInset, `Board filter-bar geometry: ${JSON.stringify(filterbarGeometry)}`).toBeLessThanOrEqual(1);
    expect(filterbarGeometry.bottomInset, `Board filter-bar geometry: ${JSON.stringify(filterbarGeometry)}`).toBeGreaterThan(1);
    expect(Math.abs(filterbarGeometry.bottomInset - filterbarGeometry.paddingBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(filterbarGeometry.heightIdentity)).toBeLessThanOrEqual(1);
    expect(Math.abs(filterbarGeometry.wrapperHeight - FILTERBAR_WRAP_HEIGHT)).toBeLessThanOrEqual(1);
    // Removing the configured Board wallpaper makes this compact fixture shorter than the sticky
    // threshold. Extend only the synthetic Board region so the layering assertion remains
    // non-vacuous without restoring production chrome.
    await page.evaluate(() => {
        const sentinel = document.createElement('div');
        sentinel.className = 'board-filter-sticky-sentinel';
        sentinel.style.height = '640px';
        document.querySelector('.eng-board').append(sentinel);
    });
    const snapshots = await collectStickySnapshots(page, waitForVisualSettled);
    const witnesses = snapshots.filter(result => result.compactVisible && result.filterbarPinned);
    expect(witnesses.length, 'expected a pinned compact-header/filter-bar Board witness').toBeGreaterThan(0);
    witnesses.forEach((result) => {
        expect(Math.abs(result.filterbarWrap.top - result.compact.bottom)).toBeLessThanOrEqual(1);
        expect(result.filterbarOwnsPoint, `filter bar lost its Board band at scroll ${result.scrollY}`).toBe(true);
    });
    await page.evaluate((y) => window.scrollTo(0, y), witnesses[0].scrollY);
    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/board-sticky-stack.png`, fullPage: false });

    await openFilters(page);

    const option = facetGroup(page, 'priority').locator('.pop-opt').first();
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    expect(box, 'the first facet option must be on screen').not.toBeNull();

    const hit = await page.evaluate(({ x, y }) => {
        const stack = document.elementsFromPoint(x, y);
        return {
            insidePopover: Boolean(stack[0] && stack[0].closest('.popover')),
            topClass: stack[0] ? stack[0].className : null,
            // Non-vacuity: the option must sit OVER the board, or "on top" proves nothing.
            boardBehind: stack.some((element) => element.classList.contains('eng-board')),
        };
    }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
    expect(hit.boardBehind, 'the popover must overlap the board for this to be a layering test').toBe(true);
    expect(hit.insidePopover, `the popover is covered by ${hit.topClass}`).toBe(true);

    const before = await option.getAttribute('aria-pressed');
    await option.click();
    await expect(option).not.toHaveAttribute('aria-pressed', before);
});

/* ── Filtering narrows cards, column counts and the folded rail together ──────────────────────── */

test('a facet narrows the open column cards, both column counts, and the folded rail together', async ({ page }) => {
    await openBoard(page);
    expect(await visibleColumnCount(page, 'col-open')).toBe(5);
    expect(await visibleColumnCount(page, 'col-done')).toBe(1);
    expect(await cardKeys(page, 'col-open')).toEqual(['EPX-1', 'EPX-2', 'EPX-3', 'EPX-4', 'EPX-6']);
    expect(await railFillHeight(page, 'col-done')).toBe('20%'); // 1 of scaleMax 5

    await tickOption(page, 'assignee', 'unassigned');
    await closeFilters(page);
    await waitForVisualSettled(page);

    expect(await cardKeys(page, 'col-open')).toEqual(['EPX-3', 'EPX-4']);
    expect(await visibleColumnCount(page, 'col-open')).toBe(2);
    expect(await visibleColumnCount(page, 'col-done')).toBe(0);
    expect(await railFillHeight(page, 'col-done')).toBe('0%'); // 0 of the new scaleMax 2
    expect(await readout(page)).toBe('2 of 6 epics');
});

/* ── §1's acceptance point 4, as amended: no SINGLE facet empties the board; a combination that
   empties it says so, rather than going silently blank (docs/plans/EXEC-eng-group-board.md,
   "Narrowed during execution, to what the plan actually specifies") ──────────────────────────── */

test('a combination that admits zero epics says so and ordinary facets still lock their final option', async ({ page }) => {
    await openBoard(page);
    await tickOption(page, 'priority', 'Critical');
    await tickOption(page, 'priority', 'Major');
    await tickOption(page, 'priority', 'Minor');
    await tickOption(page, 'priority', 'Low');
    await tickOption(page, 'assignee', 'unassigned');
    await closeFilters(page);
    await waitForVisualSettled(page);

    expect(await readout(page)).toBe('0 of 6 epics');
    // Not silently blank: an explicit empty-result note replaces the columns (D20/§7.3 are
    // per-facet; an intersection admitting nothing is a legitimate result, matching Catch Up's
    // own "empty result renders an explicit empty state" per §7.4).
    await expect(page.locator('.eng-board .col')).toHaveCount(0);
    await expect(page.locator('.empty-state.eng-empty-results')).toBeVisible();
    await expect(page.locator('.empty-state.eng-empty-results')).toContainText(/no epic/i);
    // Facets are active in this state, so the actionable second sentence appears. It is
    // conditional: the same empty state renders on a cold load and on an empty scope, where
    // naming the filters would assert a cause that is false.
    await expect(page.locator('.empty-state.eng-empty-results')).toContainText('Clear a filter');
    // The way out stays reachable: the bar (chips and Clear all) is a sibling of .eng-board, so
    // it is unaffected by the empty result.
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(2);
    await expect(page.locator('.chip-clear')).toBeVisible();

    await openFilters(page);
    const locked = facetOption(page, 'priority', 'Blocker');
    await expect(locked).toHaveAttribute('aria-disabled', 'true');
    await expect(locked).toHaveAttribute('title', /empty|nothing/i);
    // `aria-disabled` makes Playwright refuse a plain .click() on this element (it never
    // resolves "enabled") — that refusal, not a forced click, is the proof the lock is real.
    await expect(facetGroup(page, 'priority').locator('.pop-opt[aria-pressed="true"]')).toHaveCount(1);

    // Escaping via Clear all restores the board.
    await closeFilters(page);
    await page.locator('.chip-clear').click();
    await waitForVisualSettled(page);
    await expect(page.locator('.empty-state.eng-empty-results')).toHaveCount(0);
    await expect(page.locator('.eng-board .col')).toHaveCount(2);
    expect(await readout(page)).toBe('6 of 6 epics');
});

test('Project Track exposes fixed visuals and both unchecked means genuinely unset epics', async ({ page }) => {
    await openBoard(page);
    await openFilters(page);
    const track = facetGroup(page, 'track');
    await expect(track.locator('.pop-facet')).toHaveText('Project Track');
    await expect(track.locator('.pop-total')).toHaveText('6');
    const committed = facetOption(page, 'track', 'committed');
    const flexible = facetOption(page, 'track', 'flexible');
    await expect(committed.locator('.pop-opt-visual')).toHaveText('🔒');
    await expect(flexible.locator('.pop-opt-visual')).toHaveText('🤷');
    await expect(committed).toHaveAttribute('aria-pressed', 'true');
    await expect(flexible).toHaveAttribute('aria-pressed', 'true');
    await flexible.click();
    await committed.click();
    await expect(committed).toHaveAttribute('aria-pressed', 'false');
    await expect(flexible).toHaveAttribute('aria-pressed', 'false');
    await expect(track.locator('.pop-total')).toHaveText('3');
    await expect(track.getByRole('status')).toHaveText('No Project Track — showing epics without a value');
    await expect(track.locator('.pop-list')).toHaveAttribute('aria-describedby', /empty-description/);
    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/project-track-empty-desktop.png`, fullPage: false });
    await page.setViewportSize({ width: 375, height: 667 });
    await track.scrollIntoViewIfNeeded();
    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/project-track-empty-mobile.png`, fullPage: false });
    await closeFilters(page);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('Project TrackonlyNo Project Track');
    expect(await cardKeys(page, 'col-open')).toEqual(['EPX-3', 'EPX-4', 'EPX-6']);
    expect(await readout(page)).toBe('3 of 6 epics');
});

test('Project Track neutral heading preserves the approved 7 / 4 / 0 contract', async ({ page }) => {
    const specs = [
        ...Array.from({ length: 4 }, (_, index) => [`COM-${index}`, 'To Do', 'Major', ['PROD'], 'Owner', 'Committed']),
        ...Array.from({ length: 3 }, (_, index) => [`UNSET-${index}`, 'In Progress', 'Minor', ['PROD'], null, null]),
    ];
    await openBoard(page, { width: 1440, height: 900, epicSpecs: specs });
    await openFilters(page);
    const track = facetGroup(page, 'track');
    await expect(track.locator('.pop-total')).toHaveText('7');
    await expect(facetOption(page, 'track', 'committed').locator('.n')).toHaveText('4');
    await expect(facetOption(page, 'track', 'flexible').locator('.n')).toHaveText('0');
    await expect(facetOption(page, 'track', 'flexible')).toBeEnabled();
    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/project-track-neutral-7-4-0-desktop.png`, fullPage: false });
});

/* ── D33: delivery track's neutral state ───────────────────────────────────────────────────────── */

test("Project Track's neutral heading reads the full scope, not the 8+14-style option sum", async ({ page }) => {
    await openBoard(page);
    expect(await readout(page)).toBe('6 of 6 epics');
    await openFilters(page);
    // Neutral (both ticked, the default) renders no chip for any facet, Track included, and its
    // heading total is the FULL scope (6 — including EPX-3/4/6, which have no track at all) —
    // D33's plan-scale case is 8 + 14 against 87; here it would be an option-sum of 2 (1+1)
    // wrongly under-reporting the same way, against the real total of 6.
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(0);
    await expect(facetGroup(page, 'track').locator('.pop-total')).toHaveText('6');
    await closeFilters(page);

    await tickOption(page, 'track', 'flexible'); // unticks Flexible, leaving Committed only
    await closeFilters(page);
    await waitForVisualSettled(page);
    expect(await readout(page)).toBe('2 of 6 epics'); // EPX-1, EPX-5
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('Committed');
    await openFilters(page);
    await expect(facetGroup(page, 'track').locator('.pop-total')).toHaveText('2');
});

/* ── D19: no facet state carries across a mode round trip, and Board's own state survives it ──── */

test('switching Board -> Catch Up -> Board preserves explicit No Project Track only in Board', async ({ page }) => {
    await openBoard(page);
    await tickOption(page, 'track', 'flexible');
    await tickOption(page, 'track', 'committed');
    await closeFilters(page);
    await waitForVisualSettled(page);
    expect(await readout(page)).toBe('3 of 6 epics');
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('No Project Track');

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await page.waitForSelector('.filterbar');
    await waitForVisualSettled(page);
    // Catch Up has no Assignee facet at all, so it cannot be narrowed by it: every one of the
    // six epics' stories is admitted (none are Killed, Catch Up's only default exclusion).
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(0);
    const [catchUpCount] = (await readout(page)).split(' ');
    expect(Number(catchUpCount)).toBe(7); // one story per project key across the 6 epics

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Board' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    expect(await readout(page)).toBe('3 of 6 epics');
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('No Project Track');
});

// The other direction: a Catch Up facet must not leak into Board either, and Catch Up's own
// state survives the same round trip Board's does.
test('switching Catch Up -> Board -> Catch Up carries no facet state across, and restores the Catch Up chip', async ({ page }) => {
    await openBoard(page);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await page.waitForSelector('.filterbar');
    await waitForVisualSettled(page);

    await tickOption(page, 'priority', 'Low'); // unticks Low -> "Priority hidden Low"
    await closeFilters(page);
    await waitForVisualSettled(page);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('Low');
    const [catchUpNarrowed] = (await readout(page)).split(' ');
    expect(Number(catchUpNarrowed)).toBe(6); // 7 stories minus the one Low-priority story

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Board' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    // Board has no Priority narrowing of its own here, so it reads fully neutral — the Catch Up
    // exclusion above did not reach it.
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(0);
    expect(await readout(page)).toBe('6 of 6 epics');

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await page.waitForSelector('.filterbar');
    await waitForVisualSettled(page);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('Low');
    const [catchUpRestored] = (await readout(page)).split(' ');
    expect(Number(catchUpRestored)).toBe(6);
});

// Board holds half its session state per group (boardView) and half globally — this pins that
// engBoardFilterSelection is now on the per-group side too, the same way Catch Up's own
// engStatusFilter/engPriorityFilter/showTech/showProduct already are.
test('a group switch and back restores the Board facet selection, like the focused column', async ({ page }) => {
    const group = (id, name) => ({
        id,
        name,
        teamIds: ['team-alpha'],
        teamLabels: { 'team-alpha': 'Alpha Team' },
        board: { columns: BOARD_COLUMNS },
    });
    await openBoard(page, { groups: [group('grp-default', 'Default'), group('grp-second', 'Second')] });

    await tickOption(page, 'assignee', 'unassigned');
    await closeFilters(page);
    await waitForVisualSettled(page);
    expect(await readout(page)).toBe('2 of 6 epics');
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('Unassigned only');

    const groupToggle = page.locator('.view-selector .group-dropdown-toggle');
    await groupToggle.click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: 'Second' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    // A group that has never been visited starts from its own neutral default, not the other's.
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(0);
    expect(await readout(page)).toBe('6 of 6 epics');

    await groupToggle.click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: 'Default' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toContainText('Unassigned only');
    expect(await readout(page)).toBe('2 of 6 epics');
});

/* ── §7.6/D36: one row, the chips lane collapses, Clear all never does ────────────────────────── */

async function activateFourFacets(page) {
    await tickOption(page, 'priority', 'Low'); // excludes Low -> "Priority hidden Low"
    await tickOption(page, 'projects', 'product'); // "Projects only Product"
    await tickOption(page, 'assignee', 'unassigned'); // radio, no chip verb
    await tickOption(page, 'track', 'flexible'); // "Delivery track only Committed"
    await closeFilters(page);
    await waitForVisualSettled(page);
}

test('the bar holds one row at desktop widths with every facet active', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    await activateFourFacets(page);

    // Board's 30px help control now owns the view-controls lane, so one of the four chips
    // collapses into +1 more while the bar remains a single row.
    const wide = await measureBar(page);
    expect(wide.height).toBe(BAR_ROW_HEIGHT);
    expect(wide.rows).toBe(1);
    expect(wide.width).toBeLessThan(wide.containerWidth);
    expect(wide.chipsTotal).toBe(4);
    expect(wide.chipsVisible).toBe(3);
    expect(wide.chipsHidden).toBe(1);
    expect(wide.moreText).toBe('+1 more');
    expectNoClipping(wide);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-1440.png` });

    // The same compact single-row shape remains stable at 1280 and 960.
    await page.setViewportSize({ width: 1280, height: 900 });
    await waitForVisualSettled(page);
    const mid = await measureBar(page);
    expect(mid.height, 'bar height at 1280').toBe(BAR_ROW_HEIGHT);
    expect(mid.rows, 'bar rows at 1280').toBe(1);
    expect(mid.chipsVisible).toBe(3);
    expect(mid.chipsHidden).toBe(1);
    expect(mid.moreText).toBe('+1 more');
    expect(mid.clear.width, 'Clear all collapsed at 1280').toBeGreaterThan(0);
    expectNoClipping(mid);

    await page.setViewportSize({ width: 960, height: 900 });
    await waitForVisualSettled(page);
    const narrow = await measureBar(page);
    expect(narrow.height, 'bar height at 960').toBe(BAR_ROW_HEIGHT);
    expect(narrow.rows, 'bar rows at 960').toBe(1);
    expect(narrow.chipsVisible).toBe(3);
    expect(narrow.chipsHidden).toBe(1);
    expect(narrow.moreText).toBe('+1 more');
    expect(narrow.chipsVisible).toBe(wide.chipsVisible);
    expect(narrow.clear.width, 'Clear all collapsed at 960').toBeGreaterThan(0);
    expectNoClipping(narrow);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-960.png` });
});

// §7.6's ceiling is "never a third row, and the view controls may take a second below 720px".
// Board now passes the compact help control through viewControls, so it uses that allowed second
// row while every filter chip collapses and Clear all remains reachable.
test('the bar uses at most two rows below 720px with Board help and Clear all survives', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    await activateFourFacets(page);

    await page.setViewportSize({ width: 375, height: 760 });
    await waitForVisualSettled(page);
    const baseline = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    const metrics = await measureBar(page, baseline);
    expect(metrics.rows, 'bar rows at 375').toBe(2);
    expect(Math.abs(metrics.height - 80), 'bar height at 375 is the fixed two-row contract')
        .toBeLessThanOrEqual(1);
    expect(metrics.chipsHidden, 'every chip collapses at 375').toBe(4);
    expect(metrics.moreText).toBe('+4 more');
    expect(metrics.clear.width, 'Clear all collapsed at 375').toBeGreaterThan(0);
    expect(metrics.clear.clippedByLane, 'Clear all is clipped by the chips lane at 375').toBe(0);
    expect(metrics.documentOverflow).toBeLessThanOrEqual(metrics.baselineOverflow);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-375.png` });
});

/* ── D16: the bar (and the controls above it) stay at container width while the board is full-bleed ── */

test('the filter bar is container-width and centred while the board itself is full-bleed', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    const geometry = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const bar = document.querySelector('.filterbar');
        const container = bar.closest('.container').getBoundingClientRect();
        const board = document.querySelector('.eng-board .board').getBoundingClientRect();
        return {
            docWidth,
            containerWidth: Math.round(container.width),
            containerLeft: Math.round(container.left),
            containerRight: Math.round(docWidth - container.right),
            barWidth: Math.round(bar.getBoundingClientRect().width),
            barLeft: Math.round(bar.getBoundingClientRect().left),
            boardWidth: Math.round(board.width),
        };
    });
    expect(geometry.containerWidth).toBeLessThanOrEqual(1040);
    expect(geometry.barWidth).toBeLessThanOrEqual(geometry.containerWidth);
    expect(geometry.barLeft).toBeGreaterThanOrEqual(geometry.containerLeft - 1);
    // Centred: the CONTAINER's left gutter equals its right gutter — the same evidence
    // eng_group_board_view.spec.js pins for the controls row (`containerLeft === containerRight`)
    // — proving the 1040px box itself sits centred in a 1440px viewport, not merely that the bar
    // fits inside wherever the container happens to be.
    expect(geometry.containerLeft).toBe(geometry.containerRight);
    expect(geometry.containerLeft).toBeGreaterThan(0); // would be 0 for a false-positive full-width container
    // Full-bleed: the board is measurably wider than the container it sits inside.
    expect(geometry.boardWidth).toBeGreaterThan(geometry.containerWidth);
    expect(geometry.boardWidth).toBe(geometry.docWidth);
});

test('no horizontal document overflow with the bar mounted, at three widths', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    for (const width of [1440, 960, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await waitForVisualSettled(page);
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `document overflow at ${width}`).toBeLessThanOrEqual(1);
    }
});

/* ── Verification screenshot: the board with two facets active ────────────────────────────────── */

test('screenshot: the board with two facets active, plus element-level bar geometry', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    await tickOption(page, 'projects', 'product'); // unticks Product, leaving "Projects only Tech"
    await tickOption(page, 'track', 'flexible'); // unticks Flexible, leaving "Delivery track only Committed"
    await closeFilters(page);
    await waitForVisualSettled(page);

    const metrics = await measureBar(page);
    expect(metrics.height).toBe(BAR_ROW_HEIGHT);
    expect(metrics.rows).toBe(1);
    expect(metrics.chipsTotal).toBe(2);
    expect(metrics.chipsVisible).toBe(2);
    expect(metrics.chipsHidden).toBe(0);
    expectNoClipping(metrics);
    await expect(page.locator('.fb-trigger .badge')).toHaveText('2');
    expect(await readout(page)).toBe('2 of 6 epics'); // EPX-1, EPX-5: Tech-only, Committed

    // A viewport screenshot, not `.eng-board` alone: the bar is a sibling of `.eng-board` now
    // that it is mounted (§7.1), so only a shared-ancestor or viewport capture shows both.
    await page.screenshot({ path: `${screenshotDir}/board-two-facets-active.png` });
});
