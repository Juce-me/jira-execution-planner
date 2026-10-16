const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { renderAlertsPanel } = require('../share_view_alert_panel_fixture.js');

// The Share view focus modules against real CSS: the committed dashboard stylesheet, the REAL server-rendered alerts panel, and hand-written
// Epic, Story and Planning row markup that uses the production class and attribute names (the pill_hover.spec.js approach, no Flask).
const css = fs.readFileSync(path.join(__dirname, '../../frontend/dist/dashboard.css'), 'utf8');
const MODULES_ENTRY = "import { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from './shareView/focusCapture.js'; import { revealShareViewFocus } from './shareView/focusReveal.js'; window.__share = { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN, revealShareViewFocus };";
const modules = esbuild.buildSync({
    stdin: { contents: MODULES_ENTRY, resolveDir: path.join(__dirname, '../../frontend/src'), loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
}).outputFiles[0].text;

const storyCard = key => `<div class="task-item priority-major" data-task-key="${key}" data-issue-key="${key}"><div class="task-header"><span class="task-title">${key}</span></div></div>`;
const epicBlock = (key, storyKeys) => `<div class="epic-block" data-epic-key="${key}">
    <div class="epic-header"><div class="epic-title"><div class="epic-title-row"><span class="epic-name">Synthetic ${key}</span><span class="epic-key">${key}</span></div></div><div class="epic-meta"><span class="epic-story-points">SP: 8.0</span></div></div>
    ${storyKeys.map(storyCard).join('')}</div>`;
const epics = Array.from({ length: 8 }, (_, index) => epicBlock(`PROJ-${index + 1}`, [1, 2, 3, 4].map(story => `PROJ-${index + 1}${story}`))).join('');

// The main header scrolls away; with `compact` the sticky compact header is up and pushes the filter bar and Epic headers down by its height.
function catchUpHtml({ compact = false, collapsed = [], ids = {}, names = {}, moreGroups = {} } = {}) {
    const offset = compact ? 60 : 0;
    return `<style>${css}</style>
    <div class="container" style="--compact-header-offset:${offset}px;--filterbar-sticky-top:${offset}px;--epic-sticky-top:${offset + 56}px">
        <header style="height:${compact ? 0 : 160}px"></header>
        ${compact ? '<div class="compact-sticky-header is-visible" style="position:sticky;top:0;height:60px;z-index:80"></div>' : ''}
        <div class="filterbar-wrap"><div class="filterbar"></div></div>
        ${renderAlertsPanel({ collapsed, ids, names, moreGroups })}
        <div class="task-list">${epics}</div>
        <div style="height:1500px"></div>
    </div>`;
}
function planningHtml(rowKind) {
    const rows = Array.from({ length: 80 }, (_, index) => `<tr data-planning-row-key="${9000 + index}" data-row-kind="${rowKind}" data-review-row="${rowKind}:${9000 + index}" data-issue-key="PROJ-${index + 1}"><td class="planning-review-selection"></td><td class="planning-review-key">PROJ-${index + 1}</td><td class="planning-review-summary">Synthetic</td></tr>`).join('');
    return `<style>${css}</style>
    <div class="container" style="--compact-header-offset:0px">
        <header style="height:120px"></header>
        <div class="planning-review-sticky-stack"><div class="filterbar-wrap"><div class="filterbar"></div></div></div>
        <section class="planning-review-region"><div class="planning-review-scroll"><table class="planning-review-table"><thead><tr><th></th><th>Key</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    </div>`;
}

async function load(page, html) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(html);
    await page.addScriptTag({ content: modules });
    // Let the card entrance animation finish: it moves boxes by a few pixels.
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState === 'finished'));
}
// Scrolls until the element's top (or bottom) edge sits `gap` px below the sticky stack (measured without Epic headers). The filter bar only
// sticks once the page has scrolled, so the stack is measured again after each jump.
async function scrollBelowStack(page, selector, gap, edge = 'top') {
    for (let pass = 0; pass < 3; pass += 1) {
        await page.evaluate(({ selector, gap, edge }) => {
            const position = document.querySelector(selector).getBoundingClientRect()[edge];
            window.scrollTo({ top: Math.max(0, window.scrollY + position - window.__share.measureShareViewStickyBottom({ epicHeaders: false }) - gap), behavior: 'instant' });
        }, { selector, gap, edge });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
}
const capture = (page, mode, rowsMode) => page.evaluate(({ mode, rowsMode }) => window.__share.captureShareViewFocus({ mode, rowsMode }), { mode, rowsMode });

for (const compact of [false, true]) {
    test.describe(`capture, ${compact ? 'compact header up' : 'main header'}`, () => {
        test('V20: a collapsed card keeps an on-screen group box but is never the target', async ({ page }) => {
            await load(page, catchUpHtml({ compact, collapsed: ['missing'] }));
            const group = await page.evaluate(() => {
                const rect = document.querySelector('#eng-alert-missing .alert-team-group').getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom, stackBottom: window.__share.measureShareViewStickyBottom(), margin: window.__share.SHARE_VIEW_FOCUS_MARGIN, viewport: window.innerHeight };
            });
            expect(group.bottom).toBeGreaterThan(group.stackBottom + group.margin + 1);
            expect(group.top).toBeLessThan(group.viewport);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'blocked', id: 't2' });
        });

        test('V20: followup Story groups and future-routed Epic groups name different anchors; a name-keyed group names no Team', async ({ page }) => {
            await load(page, catchUpHtml({ compact, ids: { emptyEpicTeams: 'Orbit' }, names: { emptyEpicTeams: 'Orbit' } }));
            await scrollBelowStack(page, '#eng-alert-followup .alert-team-group:not([data-alert-kind])', 6);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'followup', id: 't3' });
            await scrollBelowStack(page, '#eng-alert-followup .alert-team-group[data-alert-kind="epic"]', 6);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'followupEpics', id: 't3' });
            await scrollBelowStack(page, '#eng-alert-empty .alert-team-group', 6);
            expect(await capture(page, 'catch-up')).toBeNull();
        });

        test('a group showing only the landing margin below the stack is not named; two pixels more and it is', async ({ page }) => {
            await load(page, catchUpHtml({ compact, moreGroups: { blockedAlertTeams: ['t2b'] } }));
            const margin = await page.evaluate(() => window.__share.SHARE_VIEW_FOCUS_MARGIN);
            await scrollBelowStack(page, '#eng-alert-blocked .alert-team-group[data-alert-team="t2"]', margin, 'bottom');
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'blocked', id: 't2b' });
            await scrollBelowStack(page, '#eng-alert-blocked .alert-team-group[data-alert-team="t2"]', margin + 2, 'bottom');
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'blocked', id: 't2' });
        });

        test('an Epic whose header is in its natural position is the epic target; a pinned header names the first visible Story', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            await scrollBelowStack(page, '.epic-block[data-epic-key="PROJ-3"]', 10);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'epic', key: 'PROJ-3' });
            await scrollBelowStack(page, '.epic-block[data-epic-key="PROJ-3"]', -120);
            const pinned = await capture(page, 'catch-up');
            expect(pinned).toMatchObject({ kind: 'story' });
            expect(pinned.key).toMatch(/^PROJ-3[1-4]$/);
        });
    });
}

test('planning table: the first visible row is named by its issue key and the table names its rows mode', async ({ page }) => {
    for (const rowKind of ['epic', 'story']) {
        await load(page, planningHtml(rowKind));
        await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
        const captured = await capture(page, 'planning');
        expect(captured).toMatchObject({ kind: rowKind });
        expect(captured.key).toMatch(/^PROJ-\d+$/);
        expect(await page.evaluate(() => window.__share.readPlanningRowsMode())).toBe(rowKind);
        const row = await page.evaluate(key => { const rect = [...document.querySelectorAll('tr')].find(node => node.dataset.issueKey === key).getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, stackBottom: window.__share.measureShareViewStickyBottom(), margin: window.__share.SHARE_VIEW_FOCUS_MARGIN }; }, captured.key);
        expect(row.bottom).toBeGreaterThan(row.stackBottom + row.margin + 1);
        expect(row.top).toBeLessThan(800);
    }
});

// Where a reveal leaves the target relative to the stack: T + SHARE_VIEW_FOCUS_MARGIN, within the 1px the reveal tolerates (the capture's `+ 1`).
const landing = (page, selectorKind) => page.evaluate((kind) => {
    const find = {
        group: () => [...document.querySelectorAll('#eng-alert-blocked .alert-team-group')].find(node => node.dataset.alertTeam === 't2'),
        epic: () => [...document.querySelectorAll('.epic-block')].find(node => node.dataset.epicKey === 'PROJ-6'),
        story: () => [...document.querySelectorAll('.task-item')].find(node => node.dataset.taskKey === 'PROJ-73'),
        row: () => [...document.querySelectorAll('tr')].find(node => node.dataset.issueKey === 'PROJ-40'),
    }[kind];
    const node = find();
    const parentHeader = node.closest('.epic-block')?.querySelector('.epic-header')?.getBoundingClientRect();
    return {
        top: node.getBoundingClientRect().top, className: node.className, shareReveal: node.hasAttribute('data-share-reveal'), headerBottom: parentHeader?.bottom ?? null,
        stackBottom: window.__share.measureShareViewStickyBottom({ epicHeaders: kind === 'story' }), margin: window.__share.SHARE_VIEW_FOCUS_MARGIN,
        animations: document.getAnimations().map(animation => animation.animationName),
        cellAnimation: kind === 'row' ? getComputedStyle(node.cells[0], '::after').animationName : null,
    };
}, selectorKind);
const reveal = (page, target, mode) => page.evaluate(async ({ target, mode }) => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const focusBefore = document.activeElement;
    const result = await window.__share.revealShareViewFocus(target, { mode }).done;
    return { result, focusMoved: document.activeElement !== focusBefore };
}, { target, mode });

for (const compact of [false, true]) {
    test.describe(`reveal, ${compact ? 'compact header up' : 'main header'}`, () => {
        test('an alert group lands at T + 12 and paints the hold-then-fade share overlay without moving focus', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            expect(await reveal(page, { kind: 'alertTeam', anchor: 'blocked', id: 't2' }, 'catch-up')).toEqual({ result: 'revealed', focusMoved: false });
            const landed = await landing(page, 'group');
            expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
            expect(landed.shareReveal).toBe(true);
            expect(landed.animations).toContain('shareViewReveal');
        });

        test('an Epic block lands at T + 12 and paints the hold-then-fade share overlay', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            expect((await reveal(page, { kind: 'epic', key: 'PROJ-6' }, 'catch-up')).result).toBe('revealed');
            const landed = await landing(page, 'epic');
            expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
            expect(landed.shareReveal).toBe(true);
            expect(landed.animations).toContain('shareViewReveal');
        });

        test('a Story card lands below its pinned parent header and paints the task-highlight pulse', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            expect((await reveal(page, { kind: 'story', key: 'PROJ-73' }, 'catch-up')).result).toBe('revealed');
            const landed = await landing(page, 'story');
            expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
            expect(landed.top).toBeGreaterThanOrEqual(landed.headerBottom);
            expect(landed.className).toContain('task-highlight');
            expect(landed.animations).toContain('taskHighlightPulse');
        });

        test('a real wheel event cancels a reveal in flight', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            await page.evaluate(() => {
                window.__share.revealShareViewFocus({ kind: 'alertTeam', anchor: 'blocked', id: 't2' }, { mode: 'catch-up' }).done.then((value) => { window.__revealResult = value; });
            });
            await page.mouse.move(400, 400);
            await page.mouse.wheel(0, 40);
            await page.waitForFunction(() => window.__revealResult !== undefined);
            expect(await page.evaluate(() => window.__revealResult)).toBe('cancelled');
        });
    });
}

test('planning table: a row lands below the sticky stack at T + 12 and paints the row blink', async ({ page }) => {
    await load(page, planningHtml('epic'));
    expect((await reveal(page, { kind: 'epic', key: 'PROJ-40' }, 'planning')).result).toBe('revealed');
    const landed = await landing(page, 'row');
    expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
    expect(landed.shareReveal).toBe(true);
    expect(landed.cellAnimation).toBe('planningShareReveal');
});

// The reveal listens like the apply guard: only events the reader produced count, and a bare modifier key is not one of them.
test('events a script dispatched and a bare modifier key leave a pending reveal alone, and a real non-modifier key cancels it', async ({ page }) => {
    await load(page, catchUpHtml());
    await page.evaluate(() => {
        // The target is not in the page, so the reveal stays pending for its whole budget.
        window.__share.revealShareViewFocus({ kind: 'alertTeam', anchor: 'blocked', id: 'absent' }, { mode: 'catch-up' }).done.then((value) => { window.__revealResult = value; });
        for (const type of ['wheel', 'touchmove', 'pointerdown', 'touchstart']) document.dispatchEvent(new Event(type, { bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    await page.keyboard.press('Shift');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__revealResult)).toBeUndefined();
    await page.keyboard.press('a');
    await page.waitForFunction(() => window.__revealResult !== undefined);
    expect(await page.evaluate(() => window.__revealResult)).toBe('cancelled');
});

// Forwarding a received link: capturing right after a reveal must name the revealed target, not the sibling above it (alert groups sit 9.6 px
// apart and table rows touch, so a sliver of the one above would show if the capture counted it).
for (const compact of [false, true]) {
    test(`round trip, ${compact ? 'compact header up' : 'main header'}: capture after reveal names the same alert group, Epic block or Story card`, async ({ page }) => {
        await load(page, catchUpHtml({ compact, moreGroups: { blockedAlertTeams: ['t2b', 't2c'] } }));
        for (const target of [
            { kind: 'alertTeam', anchor: 'blocked', id: 't2b' }, { kind: 'alertTeam', anchor: 'blocked', id: 't2c' },
            { kind: 'epic', key: 'PROJ-6' }, { kind: 'story', key: 'PROJ-71' }, { kind: 'story', key: 'PROJ-73' },
        ]) {
            expect((await reveal(page, target, 'catch-up')).result, JSON.stringify(target)).toBe('revealed');
            expect(await capture(page, 'catch-up'), JSON.stringify(target)).toEqual(target);
        }
    });
}

test('round trip, planning table: capture after reveal names the same row, not the adjacent row above it', async ({ page }) => {
    for (const rowKind of ['epic', 'story']) {
        await load(page, planningHtml(rowKind));
        const target = { kind: rowKind, key: 'PROJ-40' };
        expect((await reveal(page, target, 'planning')).result, rowKind).toBe('revealed');
        expect(await capture(page, 'planning'), rowKind).toEqual(target);
    }
});
