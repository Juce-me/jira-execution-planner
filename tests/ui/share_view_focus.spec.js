const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { renderAlertsPanel } = require('../share_view_alert_panel_fixture.js');

// The Share view focus modules against real CSS: the committed dashboard stylesheet, the REAL server-rendered alerts panel, and hand-written
// Epic, Story and Planning row markup that uses the production class and attribute names (the pill_hover.spec.js approach, no Flask).
const css = fs.readFileSync(path.join(__dirname, '../../frontend/dist/dashboard.css'), 'utf8');
const MODULES_ENTRY = "import { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from './shareView/focusCapture.js'; window.__share = { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN };";
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
