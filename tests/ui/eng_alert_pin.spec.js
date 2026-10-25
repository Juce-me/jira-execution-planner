// Pinned alert workflow (#209): one spec per Definition of Done behavior and layout item.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
    CATEGORIES, addReadyEpic, apiIdle, deferred, longSummary, openPinDashboard, otherSprint, settle,
} = require('./eng_alert_pin_fixture');

const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-alert-pin');
test.beforeAll(() => fs.mkdirSync(screenshotDir, { recursive: true }));

const category = sectionId => CATEGORIES.find(item => item.sectionId === sectionId);
const pin = page => page.locator('.alert-story--pinned');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alertRow = (page, sectionId, key) => page.locator(`#${sectionId} .alert-story`)
    .filter({ has: page.locator('.epic-key', { hasText: new RegExp(`^${escapeRegExp(key)}$`) }) });

// The row's primary navigate click: the summary link, the Stories required local button, or the future-routed Epic row.
async function clickPrimary(page, sectionId, key, { tap = false } = {}) {
    const row = alertRow(page, sectionId, key).first();
    if (key === 'PIN-FR1') {
        await row.locator('.alert-story-main').dispatchEvent('click');
        return;
    }
    const target = row.locator(sectionId === 'eng-alert-needs-stories' ? '.alert-story-local-link' : '.alert-story-link');
    if (tap) await target.tap();
    else await target.click();
}

async function expectPinned(page, { key, title, note }) {
    await expect(pin(page)).toHaveCount(1);
    await expect(pin(page).locator('.epic-key')).toHaveText(key);
    if (title) await expect(pin(page).locator('.alert-story-main')).toContainText(title);
    // The note is the category icon, then the label (follow-up 1).
    if (note) await expect(pin(page).locator('.alert-story-note')).toHaveText(new RegExp(`^\\S+ ${escapeRegExp(note)}$`));
}

// Viewport geometry of the sticky stack and the measured targets, read after settling.
function readStack(page, extra = {}) {
    return page.evaluate((selectors) => {
        const rect = (node) => {
            if (!node) return null;
            const box = node.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
        };
        const stuck = (node) => {
            if (!node) return false;
            const style = getComputedStyle(node);
            if (style.position !== 'sticky') return false;
            return node.getBoundingClientRect().top <= (Number.parseFloat(style.top) || 0) + 1;
        };
        const compact = document.querySelector('.compact-sticky-header.is-visible');
        const filterBar = document.querySelector('.filterbar-wrap');
        const pinNode = document.querySelector('[data-alert-pin]');
        // The visible stack above the content: compact header, filter bar and pin, stuck or still in flow.
        const stackBottom = [compact, filterBar, pinNode].filter(Boolean)
            .reduce((bottom, node) => Math.max(bottom, node.getBoundingClientRect().bottom), 0);
        return {
            scrollY: window.scrollY,
            compactVisible: Boolean(compact),
            compact: rect(compact),
            filterBar: rect(filterBar),
            filterBarStuck: stuck(filterBar),
            pin: rect(pinNode),
            pinStuck: stuck(pinNode),
            stackBottom,
            ...Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, rect(document.querySelector(selector))])),
        };
    }, extra);
}

// Records each animation frame in which confetti pieces were inserted (one burst = one frame cluster).
async function recordBursts(page) {
    await page.evaluate(() => {
        window.__confettiBursts = [];
        window.__confettiObserver?.disconnect();
        window.__confettiObserver = new MutationObserver((records) => {
            const added = records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1
                && (node.matches('.alert-confetti, .alert-celebration') || node.querySelector?.('.alert-confetti'))));
            if (added) window.__confettiBursts.push(performance.now());
        });
        window.__confettiObserver.observe(document.body, { childList: true, subtree: true });
    });
}
async function burstCount(page) {
    const times = await page.evaluate(() => window.__confettiBursts || []);
    return times.reduce((clusters, time, index) => (index === 0 || time - times[index - 1] > 100 ? clusters + 1 : clusters), 0);
}

// Counts every time the pinned row leaves the DOM or is replaced by a new node (a remount), from now on.
async function watchPin(page) {
    await page.evaluate(() => {
        window.__pinWatch?.disconnect();
        window.__pinChanges = { removed: 0, replaced: 0 };
        let last = document.querySelector('[data-alert-pin]');
        window.__pinWatch = new MutationObserver(() => {
            const now = document.querySelector('[data-alert-pin]');
            if (last && !now) window.__pinChanges.removed += 1;
            else if (last && now && now !== last) window.__pinChanges.replaced += 1;
            last = now;
        });
        window.__pinWatch.observe(document.body, { childList: true, subtree: true });
    });
}
const pinChanges = page => page.evaluate(() => window.__pinChanges);

const apiPath = (response, pathname, purpose) => {
    const url = new URL(response.url());
    if (url.pathname !== pathname) return false;
    if (purpose === undefined) return true;
    // The department cohort asks for every Epic in scope; an edit's recheck asks for that one Epic.
    return url.searchParams.get('purpose') === purpose && url.searchParams.get('project') === 'product'
        && (purpose !== 'ready-to-close' || String(url.searchParams.get('epicKeys') || '').includes(','));
};

async function waitForScrollTop(page) {
    await page.waitForFunction(() => window.scrollY === 0);
    await settle(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

// Target top lands at or below the stack bottom and within 24px of it.
async function expectLanded(page, selector, { band = false } = {}) {
    await page.waitForFunction((sel) => Boolean(document.querySelector(sel)), selector);
    await settle(page);
    const stack = await readStack(page, { target: selector });
    expect(stack.target, `${selector} exists`).not.toBeNull();
    expect(stack.target.top, `${selector} is not under the sticky stack`).toBeGreaterThanOrEqual(stack.stackBottom - 0.5);
    if (!band) expect(stack.target.top - stack.stackBottom, `${selector} lands within 24px of the stack`).toBeLessThanOrEqual(24);
    return stack;
}

async function selectEngMode(page, name) {
    const radio = page.locator('.view-selector .eng-mode-control').getByRole('radio', { name, exact: true });
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
}

async function dismissFromList(page, sectionId, key) {
    await alertRow(page, sectionId, key).locator('.alert-remove').click();
    await expect(alertRow(page, sectionId, key)).toHaveCount(0);
}

test.describe('primary row click pins the alert', () => {
    for (const { sectionId, label, sprint, keys } of CATEGORIES) {
        test(`${label}: the primary row click pins that alert under the filter bar`, async ({ page }) => {
            await openPinDashboard(page, { sprintState: sprint });
            const title = (await alertRow(page, sectionId, keys[0]).first().locator('.alert-story-main').innerText()).replace(keys[0], '').trim();
            await clickPrimary(page, sectionId, keys[0]);
            await settle(page);
            await expectPinned(page, { key: keys[0], title: title.slice(0, 20), note: label });
            const stack = await readStack(page);
            expect(stack.pin.top - stack.filterBar.bottom).toBeGreaterThanOrEqual(-0.5);
            expect(stack.pin.top - stack.filterBar.bottom).toBeLessThanOrEqual(2.5);
            if (stack.pinStuck) expect(Math.abs(stack.pin.top - stack.filterBar.bottom)).toBeLessThanOrEqual(0.5);
        });
    }

    test('Postponed: the future-routed Epic row click pins that Epic', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-followup', 'PIN-FR1');
        await expectPinned(page, { key: 'PIN-FR1', title: 'Future routed epic', note: 'Postponed' });
    });
});

test.describe('action links pin the alert and still open', () => {
    const links = [
        { sectionId: 'eng-alert-missing', key: 'PIN-2', name: 'Fix fields →' },
        { sectionId: 'eng-alert-followup', key: 'PIN-5', name: 'Move to next sprint →' },
        { sectionId: 'eng-alert-followup', key: 'PIN-FR1', name: 'Future routed epic', selector: '.alert-story-link' },
        { sectionId: 'eng-alert-waiting', key: 'PIN-W1', name: 'Open epic →' },
        { sectionId: 'eng-alert-empty', key: 'PIN-E1', name: 'Create story →' },
        { sectionId: 'eng-alert-done', key: 'PIN-D1', name: 'Close epic →' },
        { sectionId: 'eng-alert-backlog', key: 'PIN-B1', name: 'Clean backlog stories →', sprint: 'future' },
    ];
    for (const { sectionId, key, name, selector, sprint } of links) {
        test(`${category(sectionId).label} ${key} "${name}" pins and opens Jira`, async ({ page }) => {
            await openPinDashboard(page, { sprintState: sprint || 'active' });
            const link = selector
                ? alertRow(page, sectionId, key).locator(selector)
                : alertRow(page, sectionId, key).locator('.alert-action', { hasText: name });
            await expect(link).toHaveAttribute('target', '_blank');
            await expect(link).toHaveAttribute('href', `https://jira.example/browse/${key}`);
            const [opened] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
            await opened.waitForLoadState();
            expect(opened.url()).toBe(`https://jira.example/browse/${key}`);
            await opened.close();
            await expectPinned(page, { key, note: category(sectionId).label });
        });
    }

    test('Missing info local "Fix fields →" pins and opens the Story Points editor', async ({ page }) => {
        await openPinDashboard(page);
        await alertRow(page, 'eng-alert-missing', 'PIN-1').locator('.alert-action', { hasText: 'Fix fields →' }).click();
        await expectPinned(page, { key: 'PIN-1', note: 'Missing info' });
        await expect(page.locator('.task-item[data-issue-key="PIN-1"]').getByRole('textbox', { name: 'Story Points' })).toBeFocused();
    });

    for (const sprintState of ['active', 'future']) {
        test(`${sprintState} Sprint: Blocked, Stories required, Missing team and Missing labels rows carry no action link`, async ({ page }) => {
            await openPinDashboard(page, { sprintState });
            const sections = sprintState === 'active' ? ['eng-alert-blocked', 'eng-alert-needs-stories'] : ['eng-alert-missing-team', 'eng-alert-missing-labels'];
            for (const sectionId of sections) {
                await expect(page.locator(`#${sectionId} .alert-story`).first()).toBeVisible();
                await expect(page.locator(`#${sectionId} .alert-story .alert-action`)).toHaveCount(0);
            }
        });
    }
});

test('a second click replaces the pin and exactly one pinned row ever exists', async ({ page }) => {
    await openPinDashboard(page);
    await page.evaluate(() => {
        window.__maxPins = 0;
        new MutationObserver(() => {
            window.__maxPins = Math.max(window.__maxPins, document.querySelectorAll('.alert-story--pinned').length);
        }).observe(document.body, { childList: true, subtree: true });
    });
    await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
    await expectPinned(page, { key: 'PIN-3', note: 'Blocked' });
    await page.getByRole('button', { name: 'Back to alerts' }).click();
    await settle(page);
    await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
    await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });
    await page.getByRole('button', { name: 'Back to alerts' }).click();
    await settle(page);
    await clickPrimary(page, 'eng-alert-needs-stories', 'PIN-R2');
    await expectPinned(page, { key: 'PIN-R2', note: 'Stories required' });
    expect(await page.evaluate(() => window.__maxPins)).toBe(1);
});

test.describe('Back to alerts', () => {
    test('lands the alerts shell under the pin, keeps the pin and dismisses nothing', async ({ page }) => {
        await openPinDashboard(page);
        const totalBefore = await page.locator('#eng-alert-panels .alert-story').count();
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
        await page.getByRole('button', { name: 'Back to alerts' }).click();
        const stack = await expectLanded(page, '.alerts-panel-shell');
        expect(stack.target.top).toBeGreaterThanOrEqual(stack.pin.bottom - 0.5);
        await expectPinned(page, { key: 'PIN-3', note: 'Blocked' });
        expect(await page.locator('#eng-alert-panels .alert-story').count()).toBe(totalBefore);
    });

    test('works with the alerts panel hidden and the category collapsed', async ({ page }) => {
        await openPinDashboard(page);
        const totalBefore = await page.locator('#eng-alert-panels .alert-story').count();
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await page.locator('#eng-alert-blocked .alert-toggle').click();
        await expect(page.locator('#eng-alert-blocked')).toHaveClass(/collapsed/);
        await page.getByRole('button', { name: /Hide Alerts/ }).click();
        await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
        await expectPinned(page, { key: 'PIN-3', note: 'Blocked' });
        await page.evaluate(() => window.scrollTo(0, 1600));
        await settle(page);
        await page.getByRole('button', { name: 'Back to alerts' }).click();
        await expect(page.locator('#eng-alert-panels')).toBeVisible();
        const stack = await expectLanded(page, '.alerts-panel-shell');
        expect(stack.target.top).toBeGreaterThanOrEqual(stack.pin.bottom - 0.5);
        await expectPinned(page, { key: 'PIN-3', note: 'Blocked' });
        await expect(alertRow(page, 'eng-alert-blocked', 'PIN-3')).toHaveCount(1);
        expect(await page.locator('#eng-alert-panels .alert-story').count()).toBe(totalBefore);
        // Back re-shows the panel and expands the pinned category before it scrolls.
        await expect(page.locator('#eng-alert-blocked')).not.toHaveClass(/collapsed/);
        await expect(page.locator('#eng-alert-blocked .alert-card-body')).not.toHaveClass(/collapsed/);
    });

    test('used at the page top, the shell is never covered once the compact header appears', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await page.getByRole('button', { name: 'Back to alerts' }).click();
        await expectLanded(page, '.alerts-panel-shell');
    });
});

test.describe('pinned × on a live alert', () => {
    test('dismisses exactly that alert, clears the pin and lands on its block', async ({ page }) => {
        await openPinDashboard(page);
        const totalBefore = await page.locator('#eng-alert-panels .alert-story').count();
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await recordBursts(page);
        await pin(page).locator('.alert-remove').click();
        await expect(pin(page)).toHaveCount(0);
        await expect(alertRow(page, 'eng-alert-blocked', 'PIN-3')).toHaveCount(0);
        await expect(alertRow(page, 'eng-alert-blocked', 'PIN-4')).toHaveCount(1);
        expect(await page.locator('#eng-alert-panels .alert-story').count()).toBe(totalBefore - 1);
        await expectLanded(page, '#eng-alert-blocked');
        expect(await burstCount(page)).toBe(0);
        await expect(page.locator('.alert-celebration .alert-confetti')).toHaveCount(0);
    });

    test('expands a collapsed block and a hidden panel before landing', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await settle(page);
        await page.getByRole('button', { name: 'Back to alerts' }).click();
        await settle(page);
        await page.locator('#eng-alert-done .alert-toggle').click();
        await expect(page.locator('#eng-alert-done')).toHaveClass(/collapsed/);
        await page.getByRole('button', { name: /Hide Alerts/ }).click();
        await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 2000));
        await settle(page);
        await pin(page).locator('.alert-remove').click();
        await expect(page.locator('#eng-alert-done')).toBeVisible();
        await expect(page.locator('#eng-alert-done')).not.toHaveClass(/collapsed/);
        await expect(alertRow(page, 'eng-alert-done', 'PIN-D1')).toHaveCount(0);
        await expectLanded(page, '#eng-alert-done');
    });

    test('used at the page top, the block is never covered once the compact header appears', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        expect((await readStack(page)).compactVisible).toBe(false);
        await pin(page).locator('.alert-remove').click();
        const stack = await expectLanded(page, '#eng-alert-blocked', { band: true });
        expect(stack.compactVisible).toBe(true);
        expect(stack.target.top - stack.stackBottom).toBeLessThanOrEqual(24 + stack.compact.height);
    });
});

test.describe('confetti and block gone', () => {
    for (const { sectionId, label, sprint, keys } of CATEGORIES) {
        test(`${label}: emptying the category bursts once and scrolls to the top`, async ({ page }) => {
            await openPinDashboard(page, { sprintState: sprint });
            for (const key of keys.slice(1)) {
                if (sectionId === 'eng-alert-needs-stories') {
                    for (const row of await alertRow(page, sectionId, key).all()) await row.locator('.alert-remove').click();
                    await expect(alertRow(page, sectionId, key)).toHaveCount(0);
                } else await dismissFromList(page, sectionId, key);
            }
            if (sectionId === 'eng-alert-needs-stories') {
                await alertRow(page, sectionId, keys[0]).nth(1).locator('.alert-remove').click();
                await expect(alertRow(page, sectionId, keys[0])).toHaveCount(1);
            }
            await page.waitForFunction(() => !document.querySelector('.alert-celebration .alert-confetti'), null, { timeout: 6000 });
            await clickPrimary(page, sectionId, keys[0]);
            await settle(page);
            await recordBursts(page);
            await pin(page).locator('.alert-remove').click();
            await expect(page.locator('.alert-celebration .alert-confetti').first()).toBeAttached();
            await expect(page.locator(`#${sectionId}`)).toHaveCount(0);
            await expect(pin(page)).toHaveCount(0);
            await waitForScrollTop(page);
            expect(await burstCount(page)).toBe(1);
        });
    }

    test('no confetti when a sibling alert remains', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-empty', 'PIN-E1');
        await settle(page);
        await recordBursts(page);
        await pin(page).locator('.alert-remove').click();
        await expectLanded(page, '#eng-alert-empty');
        expect(await burstCount(page)).toBe(0);
        await expect(page.locator('.alert-celebration .alert-confetti')).toHaveCount(0);
    });

    test('reduced motion: no confetti and the page still returns to the top', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPinDashboard(page);
        await dismissFromList(page, 'eng-alert-done', 'PIN-D2');
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await settle(page);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await recordBursts(page);
        await pin(page).locator('.alert-remove').click();
        await expect(page.locator('#eng-alert-done')).toHaveCount(0);
        await waitForScrollTop(page);
        expect(await burstCount(page)).toBe(0);
        await expect(page.locator('.alert-celebration .alert-confetti')).toHaveCount(0);
    });
});

test('resolved by a real Story Points edit: the pin stays, × records no dismissal, bursts once and returns to the top', async ({ page }) => {
    const { state, calls } = await openPinDashboard(page);
    await dismissFromList(page, 'eng-alert-missing', 'PIN-2');
    await clickPrimary(page, 'eng-alert-missing', 'PIN-1');
    const input = page.locator('.task-item[data-issue-key="PIN-1"]').getByRole('textbox', { name: 'Story Points' });
    await expect(input).toBeFocused();
    await input.fill('5');
    await input.press('Enter');
    await expect.poll(() => calls.filter(call => call.pathname === '/api/issues/PIN-1/field' && call.method === 'POST').length).toBe(1);
    await expect(page.locator('#eng-alert-missing')).toHaveCount(0);
    await expectPinned(page, { key: 'PIN-1', note: 'Missing info' });
    await settle(page);
    await recordBursts(page);
    await pin(page).locator('.alert-remove').click();
    await expect(pin(page)).toHaveCount(0);
    await expect(page.locator('.alert-celebration .alert-confetti').first()).toBeAttached();
    await waitForScrollTop(page);
    expect(await burstCount(page)).toBe(1);

    // Not dismissed: when Jira reports the estimate missing again, the alert returns.
    state.storyPoints.set('PIN-1', null);
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await expect(alertRow(page, 'eng-alert-missing', 'PIN-1')).toHaveCount(1);
    await expect(alertRow(page, 'eng-alert-missing', 'PIN-2')).toHaveCount(0);
});

test.describe('a key in two categories', () => {
    test('pinned under the category it empties: hidden in both, one burst, back to the top', async ({ page }) => {
        await openPinDashboard(page, { dualKey: true, blockedKeys: ['PIN-4'] });
        await expect(alertRow(page, 'eng-alert-missing', 'PIN-4')).toHaveCount(1);
        await expect(alertRow(page, 'eng-alert-blocked', 'PIN-4')).toHaveCount(1);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-4');
        await expectPinned(page, { key: 'PIN-4', note: 'Blocked' });
        await settle(page);
        await recordBursts(page);
        await pin(page).locator('.alert-remove').click();
        await expect(page.locator('#eng-alert-blocked')).toHaveCount(0);
        await expect(alertRow(page, 'eng-alert-missing', 'PIN-4')).toHaveCount(0);
        await expect(alertRow(page, 'eng-alert-missing', 'PIN-1')).toHaveCount(1);
        await waitForScrollTop(page);
        expect(await burstCount(page)).toBe(1);
    });

    test('pinned under the category that keeps siblings: hidden in both, no burst, lands on that block', async ({ page }) => {
        await openPinDashboard(page, { dualKey: true, blockedKeys: ['PIN-4'] });
        await clickPrimary(page, 'eng-alert-missing', 'PIN-4');
        await expectPinned(page, { key: 'PIN-4', note: 'Missing info' });
        await settle(page);
        await recordBursts(page);
        await pin(page).locator('.alert-remove').click();
        await expect(alertRow(page, 'eng-alert-missing', 'PIN-4')).toHaveCount(0);
        await expect(page.locator('#eng-alert-blocked')).toHaveCount(0);
        await expectLanded(page, '#eng-alert-missing');
        expect(await burstCount(page)).toBe(0);
    });
});

test.describe('pin lifetime', () => {
    // Each step waits for the responses it triggers to arrive and render, then checks the pin never left the DOM meanwhile.
    test('survives Refresh (same-Sprint catalog re-read), a per-edit recheck, a background alert reload and hiding the panel', async ({ page }) => {
        const { state } = await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });
        await apiIdle(page, state);
        const expectPinHeld = async (step) => {
            await apiIdle(page, state);
            expect(await pinChanges(page), `${step}: the pin never left or remounted`).toEqual({ removed: 0, replaced: 0 });
            await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });
            await expect(alertRow(page, 'eng-alert-done', 'PIN-D1')).toHaveCount(1);
        };

        await watchPin(page);
        const refreshed = Promise.all([
            page.waitForResponse(response => apiPath(response, '/api/sprints')),
            page.waitForResponse(response => apiPath(response, '/api/tasks-with-team-name', null)),
            page.waitForResponse(response => apiPath(response, '/api/tasks-with-team-name', 'ready-to-close')),
            page.waitForResponse(response => apiPath(response, '/api/missing-info')),
        ]);
        await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
        await refreshed;
        await expectPinHeld('Refresh');

        await watchPin(page);
        const catalogReread = page.waitForResponse(response => apiPath(response, '/api/sprints'));
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await catalogReread;
        await expectPinHeld('pageshow catalog re-read');

        // Per-edit recheck: a status edit re-checks only its Epic.
        await watchPin(page);
        const rechecked = Promise.all([
            page.waitForResponse(response => apiPath(response, '/api/issues/transitions')),
            page.waitForResponse((response) => {
                const url = new URL(response.url());
                return url.pathname === '/api/tasks-with-team-name' && url.searchParams.get('purpose') === 'ready-to-close' && url.searchParams.get('epicKeys') === 'PIN-EPIC2';
            }),
        ]);
        await page.locator('[data-status-transition-trigger][data-issue-kind="story"][data-issue-key="PIN-8"]').click();
        await page.locator('.status-transition-menu[data-issue-key="PIN-8"]').getByRole('menuitem', { name: 'In Progress' }).click();
        await rechecked;
        await expectPinHeld('status recheck');

        // Background reload: a Story Points edit rearms the whole alert cohort.
        await watchPin(page);
        const reloaded = Promise.all([
            page.waitForResponse(response => apiPath(response, '/api/issues/PIN-8/field')),
            page.waitForResponse(response => apiPath(response, '/api/missing-info')),
            page.waitForResponse(response => apiPath(response, '/api/tasks-with-team-name', 'ready-to-close')),
        ]);
        const points = page.locator('.task-item[data-issue-key="PIN-8"]').getByRole('textbox', { name: 'Story Points' });
        await points.focus();
        await points.fill('8');
        await points.press('Enter');
        await reloaded;
        await expectPinHeld('Story Points cohort reload');

        await page.evaluate(() => window.scrollTo(0, 0));
        await watchPin(page);
        await page.getByRole('button', { name: /Hide Alerts/ }).click();
        await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
        await apiIdle(page, state);
        expect(await pinChanges(page)).toEqual({ removed: 0, replaced: 0 });
        await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });
    });

    test('survives a Team selection change and the filter clearing done by the alert click', async ({ page }) => {
        const { state } = await openPinDashboard(page);
        // A Done-hiding status filter hides PIN-D1's only Story; the click clears it before pinning.
        await page.getByRole('button', { name: 'Filters', exact: true }).click();
        await page.locator('.popover .pop-group[data-facet="status"] .pop-opt[data-option="Done"]').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('.task-item[data-issue-key="PIN-D1-S"]')).toHaveCount(0);
        await expect(alertRow(page, 'eng-alert-done', 'PIN-D1')).toHaveCount(1);
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await expect(pin(page)).toHaveCount(1);
        await watchPin(page);
        await expect(page.locator('.task-item[data-issue-key="PIN-D1-S"]')).toHaveCount(1);
        await apiIdle(page, state);
        expect(await pinChanges(page), 'the filter clearing never removed the pin').toEqual({ removed: 0, replaced: 0 });
        await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });

        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await watchPin(page);
        await page.locator('.view-selector .team-dropdown-toggle').click();
        await page.locator('.view-selector .team-dropdown-option', { hasText: 'Alpha Team' }).click();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}').selectedTeams)).not.toEqual(['all']);
        await apiIdle(page, state);
        expect(await pinChanges(page), 'the Team change never removed the pin').toEqual({ removed: 0, replaced: 0 });
        await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });
    });

    test('clears on leaving Catch Up', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await expectPinned(page, { key: 'PIN-D1' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await selectEngMode(page, 'Board');
        await expect(pin(page)).toHaveCount(0);
        await selectEngMode(page, 'Catch Up');
        await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
        await expect(pin(page)).toHaveCount(0);
    });

    test('clears on a user Sprint change', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await expectPinned(page, { key: 'PIN-D1' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await page.locator('.view-selector .sprint-dropdown-toggle').first().click();
        await page.locator('.sprint-dropdown-option', { hasText: otherSprint.name }).click();
        await expect(pin(page)).toHaveCount(0);
    });

    test('clears on a Department group change', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
        await expectPinned(page, { key: 'PIN-D1' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await page.locator('.view-selector .group-dropdown-toggle').click();
        await page.locator('.view-selector .group-dropdown-option', { hasText: 'Second' }).click();
        await expect(pin(page)).toHaveCount(0);
    });
});

test('reload pending: × records the dismissal and fires no confetti on the transient set', async ({ page }) => {
    const { state, calls } = await openPinDashboard(page);
    await dismissFromList(page, 'eng-alert-done', 'PIN-D2');
    await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
    await expectPinned(page, { key: 'PIN-D1' });
    await apiIdle(page, state);
    // Jira gains PIN-D3: its row can only appear once the released Ready to close response has rendered.
    addReadyEpic(state, 'PIN-D3', 'Ready to close epic three');
    const gate = deferred();
    state.alertGate = gate;
    const missingReads = calls.filter(call => call.pathname === '/api/missing-info').length;
    const readyReads = calls.filter(call => call.params.purpose === 'ready-to-close').length;
    const released = Promise.all([
        page.waitForResponse(response => apiPath(response, '/api/missing-info')),
        page.waitForResponse(response => apiPath(response, '/api/tasks-with-team-name', 'ready-to-close')),
    ]);
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await expect.poll(() => calls.filter(call => call.pathname === '/api/missing-info').length).toBeGreaterThan(missingReads);
    await expect.poll(() => calls.filter(call => call.params.purpose === 'ready-to-close').length).toBeGreaterThan(readyReads);
    expect(state.inflight, 'the alert cohort is still held').toBeGreaterThan(0);
    await expect(alertRow(page, 'eng-alert-done', 'PIN-D3')).toHaveCount(0);
    await recordBursts(page);
    await pin(page).locator('.alert-remove').click();
    await expect(pin(page)).toHaveCount(0);
    await settle(page);
    // A burst here means the close read the held rows as live and last (loading guard ignored).
    expect(await burstCount(page)).toBe(0);
    state.alertGate = null;
    gate.resolve();
    await released;
    await apiIdle(page, state);
    await expect(alertRow(page, 'eng-alert-done', 'PIN-D3')).toHaveCount(1);
    // The server still returns PIN-D1: it stays hidden only because the pending × recorded its dismissal.
    await expect(alertRow(page, 'eng-alert-done', 'PIN-D1')).toHaveCount(0);
    expect(await burstCount(page)).toBe(0);
});

test('hidden-by-filters target is revealed, pinned and not covered by the pin', async ({ page }) => {
    await openPinDashboard(page);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.locator('.popover .pop-group[data-facet="status"] .pop-opt[data-option="Done"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.task-item[data-issue-key="PIN-D1-S"]')).toHaveCount(0);
    const target = '[data-issue-key="PIN-D1"]';
    await expect(page.locator(target)).toHaveCount(0);
    await expect(alertRow(page, 'eng-alert-done', 'PIN-D1')).toHaveCount(1);
    await clickPrimary(page, 'eng-alert-done', 'PIN-D1');
    await expectPinned(page, { key: 'PIN-D1', note: 'Ready to close' });
    await settle(page);
    await expect(page.locator(target).first()).toBeVisible();
    const stack = await readStack(page, { target });
    expect(stack.pinStuck).toBe(true);
    expect(stack.target.top).toBeGreaterThanOrEqual(stack.pin.bottom - 0.5);
});

test('Stories required identity is the requirement id, and the pin clears with dismissed requirements on scope change', async ({ page }) => {
    await openPinDashboard(page);
    await expect(alertRow(page, 'eng-alert-needs-stories', 'PIN-R1')).toHaveCount(2);
    const betaRow = page.locator('#eng-alert-needs-stories .alert-team-group[data-alert-team="team-beta"]');
    await betaRow.locator('.alert-story-local-link').click();
    await expectPinned(page, { key: 'PIN-R1', note: 'Stories required' });
    await settle(page);
    await pin(page).locator('.alert-remove').click();
    await expect(alertRow(page, 'eng-alert-needs-stories', 'PIN-R1')).toHaveCount(1);
    await expect(page.locator('#eng-alert-needs-stories .alert-team-group[data-alert-team="team-alpha"]')).toContainText('PIN-R1');
    await expect(betaRow).toHaveCount(0);

    // Pin again, then a Sprint change clears it in the same effect that resets dismissed requirements.
    await page.evaluate(() => window.scrollTo(0, 0));
    await clickPrimary(page, 'eng-alert-needs-stories', 'PIN-R2');
    await expectPinned(page, { key: 'PIN-R2' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await page.locator('.view-selector .sprint-dropdown-toggle').first().click();
    await page.locator('.sprint-dropdown-option', { hasText: otherSprint.name }).click();
    await expect(pin(page)).toHaveCount(0);
    await page.locator('.view-selector .sprint-dropdown-toggle').first().click();
    await page.locator('.sprint-dropdown-option', { hasText: '2026Q2 Sprint 42' }).click();
    await expect(alertRow(page, 'eng-alert-needs-stories', 'PIN-R1')).toHaveCount(2);
});

test.describe('pinned row layout', () => {
    for (const width of [1280, 375]) {
        test(`at ${width}px: 40px single-line row, back button left, 24px hit areas, × visible without hover`, async ({ page }) => {
            await openPinDashboard(page, { viewport: { width, height: 800 } });
            await page.screenshot({ path: path.join(screenshotDir, `before-pin-${width}.png`) });
            await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
            await settle(page);
            await page.mouse.move(1, 1);
            await settle(page);
            await expectPinned(page, { key: 'PIN-3', title: longSummary.slice(0, 20) });
            const metrics = await pin(page).evaluate((row) => {
                const style = getComputedStyle(row);
                const back = row.querySelector('.icon-button--sm');
                const main = row.querySelector('.alert-story-main');
                const note = row.querySelector('.alert-story-note');
                const remove = row.querySelector('.alert-remove');
                const box = node => node.getBoundingClientRect();
                const hit = (node) => {
                    const rect = box(node);
                    const hitNode = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return { width: rect.width, height: rect.height, hitsSelf: node === hitNode || node.contains(hitNode) };
                };
                const lineHeight = Number.parseFloat(getComputedStyle(main).lineHeight) || Number.parseFloat(getComputedStyle(main).fontSize) * 1.6;
                return {
                    height: box(row).height,
                    boxSizing: style.boxSizing,
                    borderTop: style.borderTopWidth,
                    padding: [style.paddingTop, style.paddingBottom],
                    rowOverflow: row.scrollWidth - row.clientWidth,
                    whiteSpace: style.whiteSpace,
                    mainOverflow: getComputedStyle(main).overflow,
                    mainEllipsis: getComputedStyle(main).textOverflow,
                    mainTruncates: main.scrollWidth > main.clientWidth,
                    mainSingleLine: box(main).height <= lineHeight + 1,
                    noteSingleLine: box(note).height <= lineHeight + 1,
                    backRightOfMainLeft: box(back).right <= box(main).left,
                    backClass: back.className,
                    backOverflow: back.scrollWidth - back.clientWidth,
                    back: hit(back),
                    remove: hit(remove),
                    removeOpacity: getComputedStyle(remove).opacity,
                    removeVisibility: getComputedStyle(remove).visibility,
                    background: style.backgroundColor,
                    zIndex: style.zIndex,
                    filterBarZ: getComputedStyle(document.documentElement).getPropertyValue('--sticky-filterbar-z').trim(),
                };
            });
            expect(metrics.height).toBe(40);
            expect(metrics.boxSizing).toBe('border-box');
            expect(metrics.borderTop).toBe('1px');
            expect(metrics.rowOverflow).toBeLessThanOrEqual(0);
            expect(metrics.whiteSpace).toBe('nowrap');
            expect(metrics.mainOverflow).toBe('hidden');
            expect(metrics.mainEllipsis).toBe('ellipsis');
            expect(metrics.mainTruncates).toBe(true);
            expect(metrics.mainSingleLine).toBe(true);
            expect(metrics.noteSingleLine).toBe(true);
            expect(metrics.backRightOfMainLeft).toBe(true);
            expect(metrics.backClass).toContain('icon-button--sm');
            expect(metrics.backOverflow).toBeLessThanOrEqual(0);
            expect(metrics.back.width).toBeGreaterThanOrEqual(24);
            expect(metrics.back.height).toBeGreaterThanOrEqual(24);
            expect(metrics.back.hitsSelf).toBe(true);
            expect(metrics.remove.width).toBeGreaterThanOrEqual(24);
            expect(metrics.remove.height).toBeGreaterThanOrEqual(24);
            expect(metrics.remove.hitsSelf).toBe(true);
            expect(metrics.removeOpacity).toBe('1');
            expect(metrics.removeVisibility).toBe('visible');
            expect(metrics.background).not.toBe('rgba(0, 0, 0, 0)');
            expect(metrics.zIndex).toBe(metrics.filterBarZ);
            const stack = await readStack(page);
            expect(stack.pinStuck).toBe(true);
            expect(Math.abs(stack.pin.top - stack.filterBar.bottom)).toBeLessThanOrEqual(0.5);
            await page.screenshot({ path: path.join(screenshotDir, `after-pin-${width}.png`) });
        });
    }

    for (const groupByInitiativeChoice of [false, true]) {
        test(`a stuck Epic header sits on the pin bottom and never paints over it (Group by Initiative ${groupByInitiativeChoice ? 'on' : 'off'})`, async ({ page }) => {
            await openPinDashboard(page, { prefs: { groupByInitiativeChoice } });
            await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
            await settle(page);
            const nested = await page.locator('.initiative-body .epic-header').count();
            expect(nested > 0).toBe(groupByInitiativeChoice);
            // Scroll a little into the first long Epic so its header is stuck.
            const header = page.locator(`${groupByInitiativeChoice ? '.initiative-body ' : ''}.epic-header`).filter({ hasText: 'Primary delivery epic' }).first();
            const headerDocTop = await header.evaluate(node => node.getBoundingClientRect().top + window.scrollY);
            const pinBottom = (await readStack(page)).pin.bottom;
            await page.evaluate(y => window.scrollTo(0, y), headerDocTop - pinBottom + 200);
            await settle(page);
            const stuck = await header.evaluate((node) => {
                const rect = node.getBoundingClientRect();
                const pinRect = document.querySelector('[data-alert-pin]').getBoundingClientRect();
                return { top: rect.top, pinBottom: pinRect.bottom, cssTop: getComputedStyle(node).top, containerTop: getComputedStyle(document.querySelector('.container')).getPropertyValue('--epic-sticky-top') };
            });
            expect(Math.abs(stuck.top - stuck.pinBottom)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(Number.parseFloat(stuck.cssTop) - Number.parseFloat(stuck.containerTop))).toBeLessThanOrEqual(0.01);

            // Push the header out under the pin: the end of its Epic block reaches the pin, so the header overlaps the pin's box.
            const blockBottom = await header.evaluate(node => node.parentElement.getBoundingClientRect().bottom + window.scrollY);
            await page.evaluate(([bottom, pinEdge]) => window.scrollTo(0, bottom - pinEdge - 10), [blockBottom, pinBottom]);
            await settle(page);
            const overlap = await header.evaluate((node) => {
                const headerRect = node.getBoundingClientRect();
                const pinNode = document.querySelector('[data-alert-pin]');
                const pinRect = pinNode.getBoundingClientRect();
                const y = Math.max(pinRect.top + 2, Math.min(headerRect.bottom - 2, pinRect.bottom - 2));
                const xs = [0.3, 0.5, 0.7].map(fraction => pinRect.left + pinRect.width * fraction);
                return {
                    overlaps: headerRect.bottom > pinRect.top + 1 && headerRect.top < pinRect.bottom - 1,
                    hits: xs.map(x => pinNode.contains(document.elementFromPoint(x, y))),
                };
            });
            expect(overlap.overlaps).toBe(true);
            expect(overlap.hits).toEqual([true, true, true]);
            // Without the pin's z-index the Epic header (z 50) paints over it: the tier is needed.
            const withoutZ = await header.evaluate((node) => {
                const pinNode = document.querySelector('[data-alert-pin]');
                pinNode.style.zIndex = 'auto';
                const headerRect = node.getBoundingClientRect();
                const pinRect = pinNode.getBoundingClientRect();
                const y = Math.max(pinRect.top + 2, Math.min(headerRect.bottom - 2, pinRect.bottom - 2));
                const hit = document.elementFromPoint(pinRect.left + pinRect.width * 0.5, y);
                pinNode.style.zIndex = '';
                return node.contains(hit);
            });
            expect(withoutZ).toBe(true);
        });
    }

    // Follow-up 2: the pin is a rounded bordered card like the filter bar card above it, on that card's left and right edges.
    for (const width of [1280, 1440]) {
        test(`at ${width}px the pin is a 10px rounded card with the app border on the filter bar card's edges, in flow and stuck`, async ({ page }) => {
            await openPinDashboard(page, { viewport: { width, height: 900 } });
            await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
            await settle(page);
            const readCard = () => pin(page).evaluate((row) => {
                const style = getComputedStyle(row);
                const probe = document.createElement('span');
                probe.style.color = 'var(--border)';
                document.body.append(probe);
                const border = getComputedStyle(probe).color;
                probe.remove();
                const box = row.getBoundingClientRect();
                const card = document.querySelector('.filterbar').getBoundingClientRect();
                // 2px in from each corner, outside the 10px rounded shape: the pin's own paint, never the content scrolling behind it.
                const corners = [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2], [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2]]
                    .map(([x, y]) => row.contains(document.elementFromPoint(x, y)));
                return {
                    radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
                    widths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                    styles: [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle],
                    colors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
                    border,
                    left: box.left, right: box.right, height: box.height, cardLeft: card.left, cardRight: card.right, corners,
                };
            });
            for (const where of ['flow', 'stuck']) {
                if (where === 'flow') await page.evaluate(() => window.scrollTo(0, 0));
                else await page.evaluate(() => window.scrollTo(0, document.querySelector('.epic-block').getBoundingClientRect().top + window.scrollY + 200));
                await settle(page);
                const stack = await readStack(page);
                expect(stack.pinStuck, where).toBe(where === 'stuck');
                const card = await readCard();
                expect(card.radii, where).toEqual(['10px', '10px', '10px', '10px']);
                expect(card.widths, where).toEqual(['1px', '1px', '1px', '1px']);
                expect(card.styles, where).toEqual(['solid', 'solid', 'solid', 'solid']);
                expect(card.colors, where).toEqual([card.border, card.border, card.border, card.border]);
                expect(Math.abs(card.left - card.cardLeft), `${where} left edge`).toBeLessThanOrEqual(1);
                expect(Math.abs(card.right - card.cardRight), `${where} right edge`).toBeLessThanOrEqual(1);
                expect(card.height, where).toBe(40);
                if (where === 'stuck') expect(card.corners, 'stuck corners hide the content behind').toEqual([true, true, true, true]);
            }
        });
    }

    test('header, filter bar and page shell do not move when the pin shows or hides, at the top and scrolled', async ({ page }) => {
        await openPinDashboard(page);
        const measure = () => page.evaluate(() => {
            const r = (selector) => {
                const node = document.querySelector(selector);
                if (!node) return null;
                const box = node.getBoundingClientRect();
                return [box.top, box.left, box.width, box.height].map(value => Math.round(value * 10) / 10);
            };
            // The page shell's own position (its height grows with the pin by design).
            return { header: r('.header'), compact: r('.compact-sticky-header'), filterBar: r('.filterbar-wrap'), container: r('.container').slice(0, 3) };
        });
        const atTop = await measure();
        await page.evaluate(() => window.scrollTo(0, 900));
        await settle(page);
        const scrolled = await measure();
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        // An Empty epic has no list target, so its click (dispatched, so Playwright does not scroll it into view) pins without scrolling.
        await alertRow(page, 'eng-alert-empty', 'PIN-E1').locator('.alert-story-link').dispatchEvent('click');
        await settle(page);
        await expectPinned(page, { key: 'PIN-E1' });
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect(await measure()).toEqual(atTop);
        await page.evaluate(() => window.scrollTo(0, 900));
        await settle(page);
        expect(await measure()).toEqual(scrolled);
        await pin(page).locator('.alert-remove').click();
        await expect(pin(page)).toHaveCount(0);
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        expect(await measure()).toEqual(atTop);
        await page.evaluate(() => window.scrollTo(0, 900));
        await settle(page);
        expect(await measure()).toEqual(scrolled);
    });

    test('pinHeight and --epic-sticky-top match the no-pin baseline in Board, Planning, Statistics and Scenario, in the leaving render', async ({ page }) => {
        const { state } = await openPinDashboard(page);
        const modes = ['Board', 'Planning', 'Statistics', 'Scenario'];
        const epicTop = () => page.evaluate(() => {
            const style = getComputedStyle(document.querySelector('.container'));
            return [style.getPropertyValue('--epic-sticky-top').trim(), style.getPropertyValue('--scenario-sticky-top').trim()].join(' ');
        });
        const baseline = {};
        for (const mode of modes) {
            await selectEngMode(page, mode);
            await apiIdle(page, state);
            await page.evaluate(() => window.scrollTo(0, 0));
            await settle(page);
            baseline[mode] = await epicTop();
            await selectEngMode(page, 'Catch Up');
            await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
        }
        for (const mode of modes) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await settle(page);
            await alertRow(page, 'eng-alert-empty', 'PIN-E1').locator('.alert-story-link').dispatchEvent('click');
            await expectPinned(page, { key: 'PIN-E1' });
            await page.evaluate(() => window.scrollTo(0, 0));
            await settle(page);
            // Every committed render: a non-Catch-Up mode never carries the pin's height or the pin itself.
            await page.evaluate(() => {
                window.__modeRenders = [];
                const container = document.querySelector('.container');
                const record = () => window.__modeRenders.push({
                    mode: document.querySelector('.view-selector .eng-mode-control [aria-checked="true"]')?.textContent?.trim(),
                    epicTop: [getComputedStyle(container).getPropertyValue('--epic-sticky-top').trim(), getComputedStyle(container).getPropertyValue('--scenario-sticky-top').trim()].join(' '),
                    pin: Boolean(document.querySelector('[data-alert-pin]')),
                });
                window.__modeObserver?.disconnect();
                window.__modeObserver = new MutationObserver(record);
                window.__modeObserver.observe(container, { attributes: true, childList: true, subtree: true });
            });
            await selectEngMode(page, mode);
            await apiIdle(page, state);
            await settle(page);
            await expect(pin(page)).toHaveCount(0);
            expect(await epicTop()).toBe(baseline[mode]);
            const renders = await page.evaluate(() => window.__modeRenders.filter(entry => entry.mode && entry.mode !== 'Catch Up'));
            expect(renders.length).toBeGreaterThan(0);
            for (const render of renders) {
                expect(render.pin, `${mode} render without the pin`).toBe(false);
                expect(render.epicTop, `${mode} render at the no-pin offsets`).toBe(baseline[mode]);
            }
            await selectEngMode(page, 'Catch Up');
            await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
            await expect(pin(page)).toHaveCount(0);
        }
    });

    test('more than 30 alerts: a deep row pins at 40px and Back lands on the shell', async ({ page }) => {
        await openPinDashboard(page, { bulkAlerts: 30 });
        expect(await page.locator('#eng-alert-panels .alert-story').count()).toBeGreaterThan(30);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-X30');
        await settle(page);
        await expectPinned(page, { key: 'PIN-X30', note: 'Blocked' });
        expect(await pin(page).evaluate(node => node.getBoundingClientRect().height)).toBe(40);
        await page.getByRole('button', { name: 'Back to alerts' }).click();
        await expectLanded(page, '.alerts-panel-shell');
    });
});

test('the Back button is the unframed hint-dismiss control: transparent at rest, settled tint on hover, arrow visible', async ({ page }) => {
    await openPinDashboard(page);
    await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
    await settle(page);
    const back = page.getByRole('button', { name: 'Back to alerts' });
    await page.mouse.move(1, 1);
    await settle(page);
    const look = () => back.evaluate((node) => {
        const style = getComputedStyle(node);
        const arrow = node.querySelector('svg');
        return {
            className: node.className,
            background: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            border: style.borderTopColor,
            boxShadow: style.boxShadow,
            color: style.color,
            letterSpacing: style.letterSpacing,
            transition: style.transitionProperty,
            arrowStroke: getComputedStyle(arrow).stroke,
            arrowWidth: arrow.getBoundingClientRect().width,
            rowBackground: getComputedStyle(node.closest('[data-alert-pin]')).backgroundColor,
        };
    });
    const rest = await look();
    expect(rest.className).toContain('icon-button--sm');
    expect(rest.className).toContain('planning-review-column-action');
    expect(rest.background).toBe('rgba(0, 0, 0, 0)');
    expect(rest.backgroundImage).toBe('none');
    expect(rest.border).toBe('rgba(0, 0, 0, 0)');
    expect(rest.boxShadow).toBe('none');
    // text-transform stays the global button's uppercase, as on the Planning hint dismiss: the button holds only an SVG.
    expect(rest.letterSpacing).toBe('normal');
    expect(rest.transition).not.toBe('all');
    expect(rest.arrowStroke).toBe(rest.color);
    expect(rest.color).not.toBe(rest.rowBackground);
    expect(rest.arrowWidth).toBeGreaterThan(10);
    await pin(page).screenshot({ path: path.join(screenshotDir, 'back-rest-1280.png') });
    await back.hover();
    await settle(page);
    const hover = await look();
    expect(hover.backgroundImage).toBe('radial-gradient(circle closest-side, rgb(247, 245, 240) 100%, rgba(0, 0, 0, 0) 100%)');
    expect(hover.background).toBe('rgba(0, 0, 0, 0)');
    expect(hover.boxShadow).toBe('none');
    expect(hover.arrowStroke).toBe(hover.color);
    expect(hover.color).toBe(rest.color);
    await pin(page).screenshot({ path: path.join(screenshotDir, 'back-hover-1280.png') });
});

test('touch: every pin control works by tap', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await openPinDashboard(page, { viewport: { width: 375, height: 800 } });
    await clickPrimary(page, 'eng-alert-blocked', 'PIN-3', { tap: true });
    await expectPinned(page, { key: 'PIN-3', note: 'Blocked' });
    await settle(page);
    expect(await pin(page).locator('.alert-remove').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    await page.getByRole('button', { name: 'Back to alerts' }).tap();
    await expectLanded(page, '.alerts-panel-shell');
    await expectPinned(page, { key: 'PIN-3' });
    await pin(page).locator('.alert-remove').tap();
    await expect(pin(page)).toHaveCount(0);
    await expect(alertRow(page, 'eng-alert-blocked', 'PIN-3')).toHaveCount(0);
    await expectLanded(page, '#eng-alert-blocked');
    await context.close();
});

test('pin controls push no dataLayer entry', async ({ page }) => {
    const { state } = await openPinDashboard(page, { analyticsEnabled: true });
    await expect.poll(() => page.evaluate(() => Array.isArray(window.dataLayer) && window.dataLayer.length > 0)).toBe(true);
    await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
    await expectPinned(page, { key: 'PIN-3' });
    await apiIdle(page, state);
    const before = await page.evaluate(() => window.dataLayer.length);
    await page.getByRole('button', { name: 'Back to alerts' }).click();
    await settle(page);
    await pin(page).locator('.alert-remove').click();
    await expect(pin(page)).toHaveCount(0);
    await settle(page);
    expect(await page.evaluate(() => window.dataLayer.length)).toBe(before);
});

// Follow-up 1: the pin carries its category's summary-pill tone and the card header's icon.
const TONE_COLORS = {
    missing: ['rgb(250, 140, 22)', 'rgba(250, 140, 22, 0.1)'], empty: ['rgb(250, 140, 22)', 'rgba(250, 140, 22, 0.1)'],
    blocked: ['rgb(212, 56, 13)', 'rgba(212, 56, 13, 0.1)'], following: ['rgb(67, 56, 202)', 'rgba(99, 102, 241, 0.1)'], done: ['rgb(35, 120, 4)', 'rgba(82, 196, 26, 0.1)'],
};
const SECTION_TONES = {
    'eng-alert-missing': 'missing', 'eng-alert-blocked': 'blocked', 'eng-alert-empty': 'empty', 'eng-alert-done': 'done',
    'eng-alert-followup': 'following', 'eng-alert-backlog': 'following', 'eng-alert-missing-team': 'following', 'eng-alert-missing-labels': 'following',
    'eng-alert-needs-stories': 'following', 'eng-alert-waiting': 'following',
};

function readTone(page) {
    return pin(page).evaluate((row) => {
        const style = getComputedStyle(row);
        const note = row.querySelector('.alert-story-note');
        const main = row.querySelector('.alert-story-main');
        const listMain = document.querySelector('#eng-alert-panels .alert-story:not(.alert-story--pinned) .alert-story-main');
        return {
            tone: row.dataset.tone, height: row.getBoundingClientRect().height, overflow: row.scrollWidth - row.clientWidth,
            noteText: note.textContent, noteColor: getComputedStyle(note).color, noteOverflow: note.scrollWidth > note.clientWidth,
            mainColor: getComputedStyle(main).color, keyColor: getComputedStyle(row.querySelector('.epic-key')).color,
            listMainColor: listMain ? getComputedStyle(listMain).color : null,
            textPrimary: (() => { const probe = document.createElement('span'); probe.style.color = 'var(--text-primary)'; row.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; })(),
            boxShadow: style.boxShadow, backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
        };
    });
}

test.describe('pinned category tone and icon', () => {
    for (const { sectionId, label, sprint, keys } of CATEGORIES) {
        test(`${label}: the pin shows the header icon and the ${SECTION_TONES[sectionId]} tone accent and tint`, async ({ page }) => {
            await openPinDashboard(page, { sprintState: sprint });
            const headerIcon = (await page.locator(`#${sectionId} .alert-title`).innerText()).split(' ')[0];
            await clickPrimary(page, sectionId, keys[0]);
            await settle(page);
            await expectPinned(page, { key: keys[0] });
            const tone = SECTION_TONES[sectionId];
            const [color, tint] = TONE_COLORS[tone];
            const read = await readTone(page);
            expect(read.tone).toBe(tone);
            expect(read.noteText).toBe(`${headerIcon} ${label}`);
            expect(read.noteColor).toBe(color);
            expect(read.boxShadow).toBe(`${color} 3px 0px 0px 0px inset`);
            expect(read.backgroundImage.startsWith(`linear-gradient(${tint}, ${tint})`)).toBe(true);
            // Opaque base under the tint: the page background, so stuck Epic headers never show through.
            expect(read.backgroundColor).toMatch(/^rgb\(/);
            expect(read.mainColor).toBe(read.textPrimary);
            expect(read.mainColor).not.toBe(color);
            expect(read.height).toBe(40);
        });
    }

    for (const width of [1280, 375]) {
        test(`at ${width}px every tone keeps the 40px row with a long summary, no overflow (screenshots)`, async ({ page }) => {
            await openPinDashboard(page, { viewport: { width, height: 800 }, longSummaries: true });
            for (const [sectionId, key, tone] of [['eng-alert-blocked', 'PIN-3', 'blocked'], ['eng-alert-missing', 'PIN-1', 'missing'], ['eng-alert-waiting', 'PIN-W1', 'following'], ['eng-alert-done', 'PIN-D1', 'done']]) {
                await page.evaluate(() => window.scrollTo(0, 0));
                await settle(page);
                await clickPrimary(page, sectionId, key);
                await settle(page);
                await page.mouse.move(1, 1);
                await settle(page);
                await expectPinned(page, { key });
                await page.screenshot({ path: path.join(screenshotDir, `tone-${tone}-${width}-${process.env.PIN_SHOT_LABEL || 'after'}.png`) });
                const read = await readTone(page);
                expect(read.tone).toBe(tone);
                expect(read.height).toBe(40);
                expect(read.overflow).toBeLessThanOrEqual(0);
                const mainTruncates = await pin(page).locator('.alert-story-main').evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis');
                expect(mainTruncates).toBe(true);
            }
        });
    }
});

// Follow-up 1: clicking the pin's title (alert-story-main) scrolls back to the alert's own row in the list.
const rowSelector = (sectionId, identity) => `#${sectionId} .alert-story[data-alert-id="${identity}"]`;
const listRowCount = page => page.locator('#eng-alert-panels .alert-story').count();
const pinMain = page => pin(page).locator('.alert-story-main');

async function scrollDeep(page) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await settle(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
}

test.describe('pin title locates the alert row', () => {
    test('after scrolling deep into the task list, lands that alert row under the stack; the pin stays and nothing is dismissed', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await openPinDashboard(page);
        const totalBefore = await listRowCount(page);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await scrollDeep(page);
        await watchPin(page);
        await pinMain(page).click();
        const stack = await expectLanded(page, rowSelector('eng-alert-blocked', 'PIN-3'));
        expect(stack.target.top).toBeGreaterThanOrEqual(stack.pin.bottom - 0.5);
        await expectPinned(page, { key: 'PIN-3', note: 'Blocked' });
        expect(await pinChanges(page)).toEqual({ removed: 0, replaced: 0 });
        expect(await listRowCount(page)).toBe(totalBefore);
        expect(errors).toEqual([]);
    });

    test('works with the alerts panel hidden and the category collapsed: it expands them first', async ({ page }) => {
        await openPinDashboard(page);
        const totalBefore = await listRowCount(page);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-4');
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await page.locator('#eng-alert-blocked .alert-toggle').click();
        await expect(page.locator('#eng-alert-blocked')).toHaveClass(/collapsed/);
        await page.getByRole('button', { name: /Hide Alerts/ }).click();
        await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
        await scrollDeep(page);
        await pinMain(page).click();
        await expect(page.locator('#eng-alert-panels')).toBeVisible();
        await expect(page.locator('#eng-alert-blocked .alert-card-body')).not.toHaveClass(/collapsed/);
        await expectLanded(page, rowSelector('eng-alert-blocked', 'PIN-4'));
        await expectPinned(page, { key: 'PIN-4', note: 'Blocked' });
        expect(await listRowCount(page)).toBe(totalBefore);
    });

    for (const [pinned, other] of [['eng-alert-blocked', 'eng-alert-missing'], ['eng-alert-missing', 'eng-alert-blocked']]) {
        test(`a key in two categories: pinned under ${category(pinned).label}, it lands that category's row`, async ({ page }) => {
            await openPinDashboard(page, { dualKey: true, blockedKeys: ['PIN-4'] });
            await expect(page.locator(rowSelector(other, 'PIN-4'))).toHaveCount(1);
            await clickPrimary(page, pinned, 'PIN-4');
            await settle(page);
            await scrollDeep(page);
            await pinMain(page).click();
            const stack = await expectLanded(page, rowSelector(pinned, 'PIN-4'));
            const otherTop = await page.locator(rowSelector(other, 'PIN-4')).evaluate(node => node.getBoundingClientRect().top);
            expect(Math.abs(otherTop - stack.target.top)).toBeGreaterThan(24);
            await expectPinned(page, { key: 'PIN-4', note: category(pinned).label });
        });
    }

    test('resolved by a real Story Points edit: the row is gone, so it lands on the block without throwing or dismissing', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const { calls } = await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-missing', 'PIN-1');
        const input = page.locator('.task-item[data-issue-key="PIN-1"]').getByRole('textbox', { name: 'Story Points' });
        await expect(input).toBeFocused();
        await input.fill('5');
        await input.press('Enter');
        await expect.poll(() => calls.filter(call => call.pathname === '/api/issues/PIN-1/field' && call.method === 'POST').length).toBe(1);
        await expect(page.locator(rowSelector('eng-alert-missing', 'PIN-1'))).toHaveCount(0);
        await expect(page.locator(rowSelector('eng-alert-missing', 'PIN-2'))).toHaveCount(1);
        await settle(page);
        const totalBefore = await listRowCount(page);
        await scrollDeep(page);
        await pinMain(page).click();
        await expectLanded(page, '#eng-alert-missing');
        await expectPinned(page, { key: 'PIN-1', note: 'Missing info' });
        expect(await listRowCount(page)).toBe(totalBefore);
        expect(errors).toEqual([]);
    });

    test('the category gone too: it lands on the alert list', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page);
        await dismissFromList(page, 'eng-alert-blocked', 'PIN-4');
        await dismissFromList(page, 'eng-alert-blocked', 'PIN-3');
        await expect(page.locator('#eng-alert-blocked')).toHaveCount(0);
        await expectPinned(page, { key: 'PIN-3' });
        await scrollDeep(page);
        await pinMain(page).click();
        await expectLanded(page, '.alerts-panel-shell');
        await expectPinned(page, { key: 'PIN-3' });
        expect(errors).toEqual([]);
    });

    test('keyboard: Enter on the focused title locates the row', async ({ page }) => {
        await openPinDashboard(page);
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3');
        await settle(page);
        await scrollDeep(page);
        await pinMain(page).focus();
        await page.keyboard.press('Enter');
        await expectLanded(page, rowSelector('eng-alert-blocked', 'PIN-3'));
        await expectPinned(page, { key: 'PIN-3' });
    });

    test('touch: tapping the title locates the row', async ({ browser }) => {
        const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });
        const page = await context.newPage();
        await openPinDashboard(page, { viewport: { width: 375, height: 800 } });
        await clickPrimary(page, 'eng-alert-blocked', 'PIN-3', { tap: true });
        await settle(page);
        await scrollDeep(page);
        await pinMain(page).tap();
        await expectLanded(page, rowSelector('eng-alert-blocked', 'PIN-3'));
        await expectPinned(page, { key: 'PIN-3' });
        await context.close();
    });

    for (const width of [1280, 375]) {
        test(`at ${width}px each tone's title lands its own row next to the pin (screenshots)`, async ({ page }) => {
            await openPinDashboard(page, { viewport: { width, height: 800 }, longSummaries: true });
            for (const [sectionId, key, tone] of [['eng-alert-blocked', 'PIN-3', 'blocked'], ['eng-alert-missing', 'PIN-1', 'missing'], ['eng-alert-waiting', 'PIN-W1', 'following'], ['eng-alert-done', 'PIN-D1', 'done']]) {
                await page.evaluate(() => window.scrollTo(0, 0));
                await settle(page);
                await clickPrimary(page, sectionId, key);
                await settle(page);
                await scrollDeep(page);
                await pinMain(page).click();
                await expectLanded(page, rowSelector(sectionId, key));
                await page.mouse.move(1, 1);
                await settle(page);
                await page.screenshot({ path: path.join(screenshotDir, `locate-${tone}-${width}.png`) });
            }
        });
    }
});
