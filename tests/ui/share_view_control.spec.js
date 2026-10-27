const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { catchUpPrefs, deferred, groupsConfigPayload, mockDashboard, openCatchUp } = require('./eng_epic_refresh_fixture');
const { hoverEvidence } = require('./design_system_hover_helpers');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const harnessUrl = `${appBaseUrl}/share-view-control-harness`;
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');
const SHARE_LABEL = 'Copy view link';
const DISMISS_MINIMUM_CONTRAST = 4.5;
const SYNTHETIC_URL = 'http://127.0.0.1:5050/?v=1&mode=catch-up&group=synthetic-group&sprint=3001';
const APP_URL_PREFIX = new RegExp(`^${appBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?v=1&mode=catch-up&group=group-alpha&sprint=3001(&|$)`);

let harnessHtml;

test.beforeAll(() => {
    const harnessJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'share_view_control_harness.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    // The real stylesheet bundle, built from source, so the cascade is the app's.
    const dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
    harnessHtml = '<!doctype html><html><head><meta charset="utf-8">'
        + `<style>${dashboardCss}</style></head><body><div id="harness-root"></div><script>${harnessJs}</script></body></html>`;
});

// Clipboard stubs are installed before navigation: `ok` records writes, `rejected` refuses them,
// `missing` models a non-secure origin where navigator.clipboard is undefined. Animations are always off (the header slides in on mount);
// transitions are off too unless a case measures them, as the hover cases do after the helper's settle wait.
async function openHarness(page, { width = 1440, height = 900, clipboard = 'ok', transitions = false } = {}) {
    await page.addInitScript((mode) => {
        window.__copied = [];
        window.__clipboardPending = [];
        const clipboardValue = {
            ok: { writeText: async (text) => { window.__copied.push(text); } },
            rejected: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
            missing: undefined,
            deferred: { writeText: text => new Promise((resolve, reject) => window.__clipboardPending.push({ text, resolve, reject })) },
        }[mode];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboardValue });
    }, clipboard);
    await page.route(harnessUrl, route => route.fulfill({ status: 200, contentType: 'text/html', body: harnessHtml }));
    await page.setViewportSize({ width, height });
    await page.goto(harnessUrl);
    await expect(page.getByRole('button', { name: SHARE_LABEL })).toHaveCount(2);
    await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important${transitions ? '' : ';transition:none!important'}}` });
}

// Hooks are data attributes and existing classes only: the Share control adds no class of its own.
const surfaceScope = (surface) => surface ? `[data-share-view="${surface}"]` : ':is([data-share-view="main"], [data-share-view="compact"])';
const shareButton = (page, surface) => page.locator(`${surfaceScope(surface)} > [data-share-view-control]`);
const shareNotice = (page, surface) => page.locator(`${surfaceScope(surface)} > :is(.jira-export-menu, .jira-export-toast)`);
const shareStatus = (page, surface) => page.locator(`${surfaceScope(surface)} > .planning-review-sr-only`);
const setHarness = (page, patch) => page.evaluate(next => window.__shareHarness.set(next), patch);
// The dataLayer also carries explicit nulls that clear sparse parameters between pushes; only the keys with a value are the payload.
const shareEvents = (page) => page.evaluate(() => window.dataLayer.filter(entry => entry && entry.event_name === 'share_view_action')
    .map(entry => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null && value !== undefined))));

test.describe('Share control: shared header icon-button contract', () => {
    test('both surfaces carry the shared header icon-button classes and nothing else, with the 38 by 38 geometry of their siblings', async ({ page }) => {
        await openHarness(page);
        const main = shareButton(page, 'main');
        const compact = shareButton(page, 'compact');
        for (const button of [main, compact]) {
            // Zero new classes: the shared IconButton variant and its registered header hook, exactly.
            await expect(button).toHaveAttribute('class', 'secondary compact header-icon-button');
        }
        const read = (button) => button.evaluate((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            const icon = node.querySelector('svg').getBoundingClientRect();
            return {
                width: rect.width, height: rect.height, iconWidth: icon.width, iconHeight: icon.height,
                borderRadius: style.borderRadius, backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.color,
                borderTopWidth: style.borderTopWidth, marginRight: style.marginRight,
            };
        });
        const refresh = await read(page.locator('.header-actions-row .refresh-icon'));
        const mainShare = await read(main);
        const compactShare = await read(compact);
        for (const share of [mainShare, compactShare]) {
            expect(share.width).toBe(38);
            expect(share.height).toBe(38);
            expect(share.iconWidth).toBeCloseTo(18, 3);
            expect(share.iconHeight).toBeCloseTo(18, 3);
            expect(share.marginRight).toBe('0px');
            for (const key of ['borderRadius', 'backgroundColor', 'borderColor', 'color', 'borderTopWidth']) expect(share[key], key).toBe(refresh[key]);
        }
        // The one rule set serves both surfaces: the compact control computes exactly what the main one does.
        expect(compactShare).toEqual(mainShare);
        // Order and adjacency: Search, Share, Jira export in the main row; Share right after Search in the compact row.
        await expect(page.locator('.header-actions-row > .control-search + [data-share-view] + .jira-export')).toHaveCount(1);
        await expect(page.locator('.header-actions-row .refresh-icon + .group-gear-button')).toHaveCount(1);
        await expect(page.locator('.compact-sticky-header > .compact-sticky-header-search + [data-share-view]')).toHaveCount(1);
        // Bottom edges line up with the neighbouring Search input on both surfaces.
        const bottoms = await page.evaluate(() => ['.header-actions-row', '.compact-sticky-header'].map((rowSelector) => {
            const row = document.querySelector(rowSelector);
            return Math.abs(row.querySelector('.search-input').getBoundingClientRect().bottom - row.querySelector('[data-share-view-control]').getBoundingClientRect().bottom);
        }));
        bottoms.forEach(delta => expect(delta).toBeLessThanOrEqual(1));
    });

    // Settled element-level evidence (design_system_hover_helpers): the stationary box, text and border, the foundation
    // overlay and ring, their painted pixels and the composed contrast, on the real stylesheet and the real component.
    test('hover paints the foundation overlay and ring inside the visible rounded border, like its Refresh sibling, on both surfaces', async ({ page }, testInfo) => {
        await openHarness(page, { transitions: true });
        const sibling = await hoverEvidence(page, page.locator('.header-actions-row .refresh-icon'), testInfo, 'share-harness-refresh', { foundation: true });
        for (const surface of ['main', 'compact']) {
            const { rest, hover } = await hoverEvidence(page, shareButton(page, surface), testInfo, `share-harness-${surface}`, { foundation: true });
            // The visible shape is a 1px solid border on a 10px rounded square, so the paint is the box-shadow overlay and ring that
            // follow it, never a full-size circle (circle paint is for unframed icons).
            expect(rest.box.slice(2), `${surface} frame`).toEqual([38, 38]);
            expect([hover.radius, hover.borderWidth, hover.borderStyle], `${surface} visible border shape`).toEqual(['10px', '1px', 'solid']);
            expect(Number.parseFloat(hover.radius), `${surface} is not a circle`).toBeLessThan(rest.box[2] / 2);
            expect(hover.backgroundImage, `${surface} no circle paint`).toBe('none');
            expect(hover.shadow, `${surface} overlay inside the border`).toMatch(/inset/);
            expect(hover.transform, `${surface} no lift`).toBe('none');
            expect(hover.transition, `${surface} no transition: all`).not.toMatch(/\ball\b/);
            // The same hover language as the existing sibling, on both surfaces.
            for (const key of ['shadow', 'radius', 'borderWidth', 'borderStyle', 'border', 'background', 'backgroundImage', 'transform', 'filter', 'opacity']) {
                expect(hover[key], `${surface} ${key} equals the Refresh sibling`).toBe(sibling.hover[key]);
            }
        }
    });
});

test.describe('Share control: copy outcomes', () => {
    test('a click copies the captured URL once, swaps the icon at a fixed 38 by 38 and reports one fixed event', async ({ page }) => {
        await openHarness(page);
        const button = shareButton(page, 'main');
        const status = shareStatus(page, 'main');
        await button.click();
        await expect(button.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
        await expect(status).toHaveText('View link copied');
        const box = await button.boundingBox();
        expect(box.width).toBeCloseTo(38, 1);
        expect(box.height).toBeCloseTo(38, 1);
        expect(await page.evaluate(() => window.__copied)).toEqual([SYNTHETIC_URL]);
        expect(await shareNotice(page).count()).toBe(0);
        await expect(button).toHaveAttribute('title', 'View link copied');
        expect(await shareEvents(page)).toEqual([{
            event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'share_view_action',
            feature_name: 'share_view', workflow_action: 'copy_link', result: 'success', source_surface: 'catch_up',
        }]);
        // The link icon returns by itself and the status text clears.
        await expect(button.locator('[data-share-view-icon="link"]')).toHaveCount(1, { timeout: 4000 });
        await expect(status).toHaveText('');
        expect(await page.evaluate(() => window.__shareHarness.calls.captures)).toBe(1);
    });

    test('over-cap dropped keys are named in the notice as categories, never as values', async ({ page }) => {
        await openHarness(page);
        await setHarness(page, { capture: { ok: true, url: SYNTHETIC_URL, dropped: ['find', 'alertTeam', 'sort'] } });
        await shareButton(page, 'main').click();
        const notice = shareNotice(page);
        await expect(notice.locator('p')).toHaveText('View link copied, without some details to keep it short: filters and highlighted item.');
        await expect(notice.getByRole('textbox')).toHaveCount(0);
        expect(await page.evaluate(() => window.__copied)).toEqual([SYNTHETIC_URL]);
        const events = await shareEvents(page);
        expect(events.map(event => event.result)).toEqual(['success']);
    });

    for (const clipboard of ['missing', 'rejected']) {
        test(`clipboard ${clipboard}: the notice shows the whole link in a selectable read-only field and reports a failure`, async ({ page }) => {
            await openHarness(page, { clipboard });
            const longUrl = `${SYNTHETIC_URL}&find=${'a'.repeat(1400)}`;
            await setHarness(page, { capture: { ok: true, url: longUrl, dropped: ['sort'] } });
            await shareButton(page, 'main').click();
            const notice = shareNotice(page);
            await expect(notice.locator('p')).toHaveText('The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters.');
            const field = notice.getByRole('textbox', { name: 'Link to copy' });
            await expect(field).toHaveAttribute('readonly', '');
            await expect(field).toHaveValue(longUrl);
            await expect(field).toBeFocused();
            expect(await field.evaluate(node => [node.selectionStart, node.selectionEnd, node.value.length])).toEqual([0, longUrl.length, longUrl.length]);
            expect(await page.evaluate(() => window.__copied)).toEqual([]);
            expect((await shareEvents(page)).map(event => event.result)).toEqual(['failure']);
            await expect(shareButton(page, 'main').locator('[data-share-view-icon="copied"]')).toHaveCount(0);
            await notice.getByRole('button', { name: 'Dismiss' }).click();
            await expect(notice).toHaveCount(0);
        });
    }

    for (const [reason, message] of [
        ['too_long', 'This view has too many selections to fit in one link, so nothing was copied.'],
        ['invalid_state', 'This view cannot be shared as a link right now, so nothing was copied.'],
    ]) {
        test(`a capture refused as ${reason} shows its message, copies nothing and shows no field`, async ({ page }) => {
            await openHarness(page);
            await setHarness(page, { capture: { ok: false, reason } });
            await shareButton(page, 'main').click();
            const notice = shareNotice(page);
            await expect(notice.locator('p')).toHaveText(message);
            await expect(notice.getByRole('textbox')).toHaveCount(0);
            expect(await page.evaluate(() => window.__copied)).toEqual([]);
            expect((await shareEvents(page)).map(event => event.result)).toEqual(['failure']);
        });
    }

    test('a disabled control stays inert and gains no hover delta on either surface', async ({ page }, testInfo) => {
        await openHarness(page);
        await setHarness(page, { disabled: true });
        for (const surface of ['main', 'compact']) {
            const button = shareButton(page, surface);
            await expect(button).toBeDisabled();
            await expect(button).toHaveAttribute('title', 'Sharing is available once the view has loaded');
            await expect(button).toHaveAttribute('aria-label', SHARE_LABEL);
            await button.click({ force: true });
            // The helper asserts that the hovered state equals the resting state for a disabled control.
            const { rest, hover } = await hoverEvidence(page, button, testInfo, `share-harness-disabled-${surface}`, { disabled: true });
            expect([rest.shadow, hover.shadow]).toEqual(['none', 'none']);
        }
        expect(await page.evaluate(() => window.__shareHarness.calls.captures)).toBe(0);
        expect(await shareEvents(page)).toEqual([]);
    });
});

const APPLY_NOTICES = [
    [{ kind: 'dropped', categories: ['group'] }, 'This link was not applied: its Department group is not available to you.'],
    [{ kind: 'dropped', categories: ['sprint'] }, 'This link was not applied: its Sprint is not available to you.'],
    [{ kind: 'dropped', categories: ['sprint', 'group'] }, 'This link was not applied: its Department group and Sprint are not available to you.'],
    [{ kind: 'dropped', categories: [] }, 'This link could not be applied right now, so your view was left as it was.'],
    [{ kind: 'partial', categories: ['teams', 'filters'] }, 'Part of this link was not applied: Teams and filters. Everything else was applied.'],
    [{ kind: 'partial', categories: ['focus', 'filters', 'teams', 'mode', 'bogus'] }, 'Part of this link was not applied: view mode, Teams, filters and highlighted item. Everything else was applied.'],
    [{ kind: 'invalid', categories: [] }, 'This link is not valid, so it was not applied. Ask the sender to copy it again.'],
    [{ kind: 'newer', categories: [] }, 'This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.'],
];

test.describe('Share control: apply notice', () => {
    for (const [notice, message] of APPLY_NOTICES) {
        test(`the ${notice.kind} notice for [${notice.categories.join(', ')}] reads exactly its copy, names categories only and dismisses through the hook`, async ({ page }) => {
            await openHarness(page);
            await setHarness(page, { notice });
            const banner = shareNotice(page);
            await expect(banner).toHaveCount(1);
            await expect(banner.locator('p')).toHaveText(message);
            await expect(banner).toHaveAttribute('role', 'status');
            // Genuine apply warnings reuse the existing compact export warning surface.
            await expect(banner).toHaveAttribute('class', 'jira-export-toast');
            await expect(banner.getByRole('textbox')).toHaveCount(0);
            await banner.getByRole('button', { name: 'Dismiss' }).click();
            await expect(banner).toHaveCount(0);
            expect(await page.evaluate(() => window.__shareHarness.calls.dismissed)).toBe(1);
            // The notice is not an analytics event.
            expect(await shareEvents(page)).toEqual([]);
        });
    }

    test('only the surface that is showing renders the notice, so exactly one is ever on screen', async ({ page }) => {
        await openHarness(page);
        await setHarness(page, { notice: { kind: 'partial', categories: ['teams'] } });
        await expect(shareNotice(page)).toHaveCount(1);
        await expect(shareNotice(page, 'main')).toHaveCount(1);
        await setHarness(page, { active: 'compact' });
        await expect(shareNotice(page)).toHaveCount(1);
        await expect(shareNotice(page, 'compact')).toHaveCount(1);
        await expect(shareNotice(page, 'main')).toHaveCount(0);
    });

    test('a Share failure clears when its surface stops showing', async ({ page }) => {
        await openHarness(page, { clipboard: 'missing' });
        await shareButton(page, 'main').click();
        await expect(shareNotice(page)).toHaveCount(1);
        await setHarness(page, { active: 'compact' });
        await expect(shareNotice(page)).toHaveCount(0);
        await setHarness(page, { active: 'main' });
        await expect(shareNotice(page)).toHaveCount(0);
    });

    test('a deferred clipboard rejection stays cleared after the active surface hides and returns', async ({ page }) => {
        await openHarness(page, { clipboard: 'deferred' });
        await shareButton(page, 'main').click();
        expect(await page.evaluate(() => window.__clipboardPending.length)).toBe(1);
        await setHarness(page, { active: 'compact' });
        await page.evaluate(() => window.__clipboardPending[0].reject(new Error('denied')));
        await setHarness(page, { active: 'main' });
        await expect(shareNotice(page)).toHaveCount(0);
        expect((await shareEvents(page)).map(event => event.result)).toEqual(['failure']);
    });

    test('an older clipboard rejection cannot replace the latest fallback URL', async ({ page }) => {
        await openHarness(page, { clipboard: 'deferred' });
        await shareButton(page, 'main').click();
        await setHarness(page, { capture: { ok: true, url: `${SYNTHETIC_URL}&find=latest`, dropped: [] } });
        await shareButton(page, 'main').click();
        await page.evaluate(() => window.__clipboardPending[1].reject(new Error('latest denied')));
        await expect(page.getByRole('textbox', { name: 'Link to copy' })).toHaveValue(`${SYNTHETIC_URL}&find=latest`);
        await page.evaluate(() => window.__clipboardPending[0].reject(new Error('older denied')));
        await expect(page.getByRole('textbox', { name: 'Link to copy' })).toHaveValue(`${SYNTHETIC_URL}&find=latest`);
        const events = await shareEvents(page);
        expect(events).toHaveLength(2);
        expect(JSON.stringify(events)).not.toContain(SYNTHETIC_URL);
    });

    // Element-level geometry (MRT020): the painted text, the field and the Dismiss button, not only the container box.
    for (const width of [1440, 1028, 760, 390, 375]) {
        for (const surface of ['main', 'compact']) {
            test(`the fallback notice stays inside the viewport and its header, unclipped and hit-testable, on ${surface} at ${width}px`, async ({ page }) => {
                await openHarness(page, { width, clipboard: 'missing' });
                await setHarness(page, { active: surface, capture: { ok: true, url: `${SYNTHETIC_URL}&find=${'a'.repeat(900)}`, dropped: [] } });
                await shareButton(page, surface).click();
                const notice = shareNotice(page);
                await expect(notice).toBeVisible();
                const metrics = await notice.evaluate((node, surfaceName) => {
                    const rect = node.getBoundingClientRect();
                    const host = node.closest(surfaceName === 'main' ? '.subtitle' : '.compact-sticky-header').getBoundingClientRect();
                    const share = node.parentElement.querySelector('[data-share-view-control]').getBoundingClientRect();
                    const paragraph = node.querySelector('p');
                    const range = document.createRange();
                    range.selectNodeContents(paragraph);
                    const paintedRight = Math.max(...[...range.getClientRects()].map(item => item.right));
                    const field = node.querySelector('input').getBoundingClientRect();
                    const dismiss = node.querySelector('button').getBoundingClientRect();
                    const hit = (x, y) => node.contains(document.elementFromPoint(x, y));
                    const paragraphStyle = getComputedStyle(paragraph);
                    return {
                        textTransform: paragraphStyle.textTransform, letterSpacing: paragraphStyle.letterSpacing,
                        left: rect.left, right: rect.right, top: rect.top, viewport: document.documentElement.clientWidth,
                        hostLeft: host.left, hostRight: host.right, shareBottom: share.bottom,
                        paragraphClip: paragraph.scrollWidth - paragraph.clientWidth, paintedRight,
                        fieldLeft: field.left, fieldRight: field.right, dismissLeft: dismiss.left, dismissRight: dismiss.right, dismissWidth: dismiss.width, dismissHeight: dismiss.height,
                        centreHit: hit(rect.left + rect.width / 2, rect.top + rect.height / 2),
                        dismissHit: hit(dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2),
                        fieldHit: hit(field.left + field.width / 2, field.top + field.height / 2),
                        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    };
                }, surface);
                expect(metrics.left).toBeGreaterThanOrEqual(metrics.hostLeft - 1);
                expect(metrics.right).toBeLessThanOrEqual(metrics.hostRight + 1);
                expect(metrics.left).toBeGreaterThanOrEqual(-1);
                expect(metrics.right).toBeLessThanOrEqual(metrics.viewport + 1);
                expect(metrics.top).toBeGreaterThanOrEqual(metrics.shareBottom);
                // The main header's .subtitle passes down uppercase, tracked text; the notice resets it.
                expect(metrics.textTransform).toBe('none');
                expect(['normal', '0px']).toContain(metrics.letterSpacing);
                expect(metrics.paragraphClip).toBeLessThanOrEqual(1);
                expect(metrics.paintedRight).toBeLessThanOrEqual(metrics.right);
                expect(metrics.fieldLeft).toBeGreaterThanOrEqual(metrics.left);
                expect(metrics.fieldRight).toBeLessThanOrEqual(metrics.right);
                expect(metrics.dismissLeft).toBeGreaterThanOrEqual(metrics.left);
                expect(metrics.dismissRight).toBeLessThanOrEqual(metrics.right);
                expect(metrics.dismissWidth).toBeGreaterThan(40);
                expect(metrics.dismissWidth).toBeLessThanOrEqual(110);
                expect(metrics.dismissHeight).toBeLessThanOrEqual(38);
                expect(metrics.centreHit && metrics.dismissHit && metrics.fieldHit, 'the notice is not covered by anything').toBe(true);
                // The notice is anchored in the viewport and adds no document overflow.
                expect(metrics.documentOverflow).toBeLessThanOrEqual(0);
            });
        }
    }

    test('the compact Dismiss button keeps the foundation overlay and ring, stationary and readable', async ({ page }, testInfo) => {
        await openHarness(page);
        await setHarness(page, { notice: { kind: 'invalid', categories: [] } });
        const dismiss = shareNotice(page).getByRole('button', { name: 'Dismiss' });
        const { hover } = await hoverEvidence(page, dismiss, testInfo, 'share-harness-dismiss', { foundation: true, minimumContrast: DISMISS_MINIMUM_CONTRAST });
        expect(hover.transform).toBe('none');
    });
});

// Absolute-pixel ink bounds of what a control paints inside its inset box, compared with the centre of
// that box (same method as eng_group_board_card.spec.js). Integer-aligned clips keep the result exact at
// the fractional positions flex layout produces. The inset is 5 px: with the 10px corner radius a 3 px inset
// puts the ground sample on the antialiased border, and every interior pixel then counts as ink.
async function paintedInkOffset(page, locator, inset = 5) {
    const rect = await locator.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height };
    });
    const x0 = Math.floor(rect.x) - 2;
    const y0 = Math.floor(rect.y) - 2;
    const width = Math.ceil(rect.x + rect.w) + 2 - x0;
    const height = Math.ceil(rect.y + rect.h) + 2 - y0;
    const image = await page.screenshot({ clip: { x: x0, y: y0, width, height }, animations: 'disabled' });
    return page.evaluate(async ({ base64, x0: originX, y0: originY, rect: box, inset: edge, width: clipWidth }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const scale = img.width / clipWidth;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        const data = context.getImageData(0, 0, img.width, img.height).data;
        const pixel = (x, y) => { const o = (y * img.width + x) * 4; return [data[o], data[o + 1], data[o + 2]]; };
        const left = Math.ceil((box.x + edge - originX) * scale);
        const top = Math.ceil((box.y + edge - originY) * scale);
        const right = Math.floor((box.x + box.w - edge - originX) * scale);
        const bottom = Math.floor((box.y + box.h - edge - originY) * scale);
        const ground = pixel(left, top);
        let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
        for (let y = top; y < bottom; y += 1) {
            for (let x = left; x < right; x += 1) {
                const p = pixel(x, y);
                if (Math.max(...p.map((channel, i) => Math.abs(channel - ground[i]))) > 30) {
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                }
            }
        }
        return {
            painted: maxX >= 0,
            inkWidth: (maxX - minX + 1) / scale,
            inkHeight: (maxY - minY + 1) / scale,
            dx: originX + ((minX + maxX + 1) / 2) / scale - (box.x + box.w / 2),
            dy: originY + ((minY + maxY + 1) / 2) / scale - (box.y + box.h / 2),
        };
    }, { base64: image.toString('base64'), x0, y0, rect, inset, width });
}

// The measured ink must be the glyph, not the whole frame: a degenerate "everything differs from the ground" result centres trivially.
const expectCentredGlyph = (ink, label) => {
    expect(ink.painted, `${label} paints`).toBe(true);
    for (const size of [ink.inkWidth, ink.inkHeight]) {
        expect(size, `${label} ink is the glyph, not the frame`).toBeGreaterThan(6);
        expect(size, `${label} ink is the glyph, not the frame`).toBeLessThan(22);
    }
    expect(Math.abs(ink.dx), `${label} horizontal offset`).toBeLessThanOrEqual(0.75);
    expect(Math.abs(ink.dy), `${label} vertical offset`).toBeLessThanOrEqual(0.75);
};

test.describe('Share control: painted glyph ink', () => {
    test.use({ deviceScaleFactor: 2 });

    // Glyph ink placement is only representative headed, in the engines the app is reviewed in. Run:
    //   npx playwright test tests/ui/share_view_control.spec.js --browser=firefox --headed -g "painted glyph ink"
    //   npx playwright test tests/ui/share_view_control.spec.js --browser=webkit --headed -g "painted glyph ink"
    test('the link and copied glyphs are centred in their 38 by 38 frame at rest and on hover, on both surfaces', async ({ page }, testInfo) => {
        test.skip(process.platform !== 'darwin', 'Glyph ink placement is reviewed on macOS.');
        test.skip(testInfo.project.use.headless !== false, 'Glyph ink placement is only representative headed.');
        await openHarness(page);
        await page.evaluate(() => document.fonts.ready);
        for (const surface of ['main', 'compact']) {
            await setHarness(page, { active: surface });
            const button = shareButton(page, surface);
            await button.scrollIntoViewIfNeeded();
            for (const state of ['rest', 'hover']) {
                if (state === 'hover') await button.hover(); else await page.mouse.move(2, 2);
                await page.waitForTimeout(300);
                const ink = await paintedInkOffset(page, button);
                expectCentredGlyph(ink, `${surface} link ${state}`);
            }
            // The copied glyph lasts two seconds after a click, so both of its states are measured at once.
            await button.click();
            await expect(button.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
            for (const state of ['hover', 'rest']) {
                if (state === 'rest') await page.mouse.move(2, 2);
                await page.waitForTimeout(250);
                const ink = await paintedInkOffset(page, button);
                expectCentredGlyph(ink, `${surface} copied ${state}`);
            }
            await expect(button.locator('[data-share-view-icon="link"]')).toHaveCount(1, { timeout: 4000 });
        }
    });
});

async function installClipboard(page, mode = 'ok') {
    await page.addInitScript((value) => {
        window.__copied = [];
        window.__clipboardPending = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: value === 'missing' ? undefined : { writeText: async (text) => { window.__copied.push(text); } },
        });
    }, mode);
}

const enableAnalytics = (ctx) => ctx.respond('/api/analytics/context', ({ json }) => json({ enabled: true }));

// Share controls inside the viewport and not under an aria-hidden ancestor, by surface.
const visibleShareSurfaces = (page) => page.evaluate(() => [...document.querySelectorAll('[data-share-view="main"] [data-share-view-control], [data-share-view="compact"] [data-share-view-control]')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden'
        && rect.bottom > 0 && rect.top < window.innerHeight && !node.closest('[aria-hidden="true"]');
}).map(node => (node.closest('.compact-sticky-header') ? 'compact' : 'main')));

// App cases: the real dashboard and the real useShareViewApply hook against the shared ENG fixture (build `frontend/dist` first).
test.describe('Share control: in the app', () => {
    test('a click in the main header copies the link for the open view and sends one private event', async ({ page }) => {
        await installClipboard(page);
        const ctx = await mockDashboard(page);
        enableAnalytics(ctx);
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        const button = shareButton(page, 'main');
        await expect(button).toBeEnabled();
        await button.click();
        await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
        expect((await page.evaluate(() => window.__copied))[0]).toMatch(APP_URL_PREFIX);
        await expect.poll(async () => (await shareEvents(page)).length).toBe(1);
        expect((await shareEvents(page))[0]).toEqual({
            event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'share_view_action', feature_name: 'share_view',
            workflow_action: 'copy_link', result: 'success', source_surface: 'catch_up',
        });
        const serialised = JSON.stringify(await page.evaluate(() => window.dataLayer));
        for (const fragment of ['http', '?v=', 'group-alpha', '3001']) expect(serialised, `no ${fragment} in any analytics payload`).not.toContain(fragment);
    });

    test('header copies view settings without a focus target at every scroll position', async ({ page }) => {
        await installClipboard(page);
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        const headerBottom = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().bottom + window.scrollY);
        const sampled = [];
        for (const y of [0, 40, Math.round(headerBottom / 2), Math.round(headerBottom) - 2, Math.round(headerBottom) + 2, 700, 1500]) {
            await page.evaluate(top => window.scrollTo(0, top), y);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForTimeout(150);
            const state = await page.evaluate(() => ({ scrollY: window.scrollY, compact: Boolean(document.querySelector('.compact-sticky-header.is-visible')) }));
            const visible = await visibleShareSurfaces(page);
            sampled.push({ ...state, visible });
            if (visible.length === 1) {
                await shareButton(page, visible[0]).click();
                expect((await page.evaluate(() => window.__copied)).at(-1)).not.toMatch(/&(?:epic|story|alertTeam)=/);
            }
            expect(visible.length, `scrollY ${state.scrollY}: ${visible}`).toBeLessThanOrEqual(1);
            if (state.compact) expect(visible, `scrollY ${state.scrollY}`).toEqual(['compact']);
            if (state.scrollY === 0) expect(visible).toEqual(['main']);
        }
        expect(sampled.some(item => item.compact)).toBe(true);
        // Header copies carry only view settings at either scroll position.
        await shareButton(page, 'compact').click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(0);
        await shareButton(page, 'main').click();
        await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(sampled.filter(item => item.visible.length).length + 2);
        const [fromCompact, fromMain] = (await page.evaluate(() => window.__copied)).slice(-2);
        expect(fromCompact).toMatch(APP_URL_PREFIX);
        expect(fromCompact).toBe(fromMain);
        expect(fromCompact).not.toMatch(/&(?:epic|story|alertTeam)=/);
    });

    // Mounted proof of the hover contract on the real dashboard: the main Share control and the compact one (after the scroll swap)
    // paint the same foundation overlay and ring inside the same rounded border as the neighbouring header icon buttons.
    test('the main and the compact Share controls hover like their header siblings in the real app', async ({ page }, testInfo) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        // Settled evidence: no entrance animation may move the header between the resting and the hovered measurement.
        await page.addStyleTag({ content: '* { animation: none !important; }' });
        const refresh = await hoverEvidence(page, page.locator('.header-actions-row .refresh-icon'), testInfo, 'share-app-refresh', { foundation: true });
        const main = await hoverEvidence(page, shareButton(page, 'main'), testInfo, 'share-app-main', { foundation: true });
        await page.evaluate(() => window.scrollTo(0, 900));
        await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
        const compact = await hoverEvidence(page, shareButton(page, 'compact'), testInfo, 'share-app-compact', { foundation: true });
        for (const [label, evidence] of [['main', main], ['compact', compact]]) {
            expect([evidence.hover.radius, evidence.hover.borderWidth, evidence.hover.borderStyle], `${label} visible border shape`).toEqual(['10px', '1px', 'solid']);
            expect(evidence.hover.backgroundImage, `${label} no circle paint`).toBe('none');
            expect(evidence.hover.transform, `${label} no lift`).toBe('none');
            expect(evidence.hover.transition, `${label} no transition: all`).not.toMatch(/\ball\b/);
            for (const key of ['shadow', 'radius', 'borderWidth', 'border', 'background', 'backgroundImage']) {
                expect(evidence.hover[key], `${label} ${key} equals the Refresh sibling`).toBe(refresh.hover[key]);
            }
        }
    });

    // Sticky layering (MRT009) and the header's no-overflow contract: the baseline is the same page with the Share wrappers hidden.
    test('Share adds no compact-header height, moves no sticky offset and adds no horizontal overflow', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width: 1440, height: 900, prefs: { showPlanning: true, planningLayout: 'list' } });
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
        const setShare = (shown) => page.evaluate((visible) => {
            let style = document.getElementById('share-baseline');
            if (!style) { style = document.createElement('style'); style.id = 'share-baseline'; document.head.appendChild(style); }
            style.textContent = visible ? '' : '[data-share-view] { display: none !important; }';
        }, shown);
        const measure = async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(200);
            const top = await page.evaluate(() => ({ header: document.querySelector('header').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
            await page.evaluate(() => window.scrollTo(0, 900));
            await page.waitForTimeout(300);
            const scrolled = await page.evaluate(() => {
                const container = getComputedStyle(document.querySelector('.container'));
                return {
                    compact: document.querySelector('.compact-sticky-header').getBoundingClientRect().height,
                    offsets: ['--compact-header-offset', '--planning-sticky-top', '--filterbar-sticky-top', '--epic-sticky-top'].map(name => container.getPropertyValue(name).trim()),
                };
            });
            return { ...top, ...scrolled };
        };
        for (const width of [1440, 1028, 900, 760, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await setShare(false);
            const baseline = await measure();
            await setShare(true);
            const withShare = await measure();
            expect(withShare.compact, `${width}px compact header height`).toBe(baseline.compact);
            expect(withShare.offsets, `${width}px sticky offsets`).toEqual(baseline.offsets);
            expect(withShare.overflow, `${width}px horizontal overflow`).toBeLessThanOrEqual(baseline.overflow);
            // One header line stays one line while it fits (the actions row may wrap below that).
            if (width >= 1028) expect(withShare.header, `${width}px header height`).toBe(baseline.header);
        }
    });

    test('the control is hidden in EPM and in Scenario and returns in the ENG modes', async ({ page }) => {
        const ctx = await mockDashboard(page);
        // EPM navigation needs the private checkbox, verified Home scopes and an `available` access decision.
        ctx.respond('/api/config', ({ json }) => json({ jiraUrl: 'https://jira.example', capacityProject: '', authMode: 'atlassian_oauth', projectsConfigured: true, userCanEditSettings: true, environmentConfigExists: true, epmViewEnabled: true, epmHomeReadAvailable: true }));
        ctx.respond('/api/epm/access', ({ json }) => json({ state: 'available', epmHomeReadAvailable: true }));
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        await expect(shareButton(page)).toHaveCount(1);
        await page.getByRole('radio', { name: 'EPM', exact: true }).click();
        await expect(page.getByRole('radio', { name: 'EPM', exact: true })).toBeChecked();
        await expect(shareButton(page)).toHaveCount(0);
        await page.getByRole('radio', { name: 'ENG', exact: true }).click();
        await expect(shareButton(page)).toHaveCount(1);
        const modes = page.locator('.view-selector .eng-mode-control');
        await modes.getByRole('radio', { name: 'Scenario' }).click();
        await expect(modes.getByRole('radio', { name: 'Scenario' })).toBeChecked();
        await expect(shareButton(page)).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 700));
        await expect(shareButton(page)).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await modes.getByRole('radio', { name: 'Catch Up' }).click();
        await expect(shareButton(page)).toHaveCount(1);
    });

    test('the control stays disabled while the Department groups are loading', async ({ page }) => {
        const ctx = await mockDashboard(page);
        const release = deferred();
        ctx.respond('/api/groups-config', async ({ json }) => { await release.promise; return json(groupsConfigPayload); });
        await page.addInitScript((prefs) => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs)), catchUpPrefs());
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
        const button = shareButton(page, 'main');
        await expect(button).toBeDisabled();
        release.resolve();
        await expect(page.locator('.epic-block[data-epic-key="EPIC-1"]')).toBeVisible();
        await expect(button).toBeEnabled();
    });

    test('an opened link that cannot be applied shows its notice under the control, and Dismiss closes it', async ({ page }) => {
        await mockDashboard(page);
        // The shared fixture routes `/` with a pattern that never matches a URL with a query.
        await page.route(url => url.href.startsWith(`${appBaseUrl}/?v=1&`), route => route.fulfill({ status: 200, contentType: 'text/html', body: dashboardHtml }));
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=missing-group&sprint=3001`);
        const notice = shareNotice(page, 'main');
        await expect(notice.locator('p')).toHaveText('This link was not applied: its Department group is not available to you.');
        await expect(shareNotice(page)).toHaveCount(1);
        await notice.getByRole('button', { name: 'Dismiss' }).click();
        await expect(shareNotice(page)).toHaveCount(0);
    });

    for (const mode of ['catch-up', 'planning']) {
        test(`the fallback notice is not covered by the sticky stack in ${mode} when the compact control is used`, async ({ page }) => {
            await installClipboard(page, 'missing');
            const ctx = await mockDashboard(page);
            await openCatchUp(page, ctx, { width: 1440, height: 900, prefs: mode === 'planning' ? { showPlanning: true, planningLayout: 'list' } : {} });
            await page.evaluate(() => window.scrollTo(0, 900));
            await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
            await shareButton(page, 'compact').click();
            const notice = shareNotice(page, 'compact');
            await expect(notice).toBeVisible();
            const hits = await notice.evaluate((node) => {
                const inside = (element) => {
                    const rect = element.getBoundingClientRect();
                    return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
                };
                return { notice: inside(node), field: inside(node.querySelector('input')), dismiss: inside(node.querySelector('button')) };
            });
            expect(hits).toEqual({ notice: true, field: true, dismiss: true });
            await notice.getByRole('button', { name: 'Dismiss' }).click();
            await expect(shareNotice(page)).toHaveCount(0);
        });
    }
});

const epicCopy = (page, key) => page.getByRole('button', { name: `Copy link to Epic ${key}`, exact: true });
const explicitEvidence = path.join(repoRoot, 'tmp', 'share-view-tasks', 'explicit-visual');
async function openShareFixture(page, layout = 'list', withSynthetic = false) {
    await installClipboard(page);
    const ctx = await mockDashboard(page);
    if (withSynthetic) {
        const story = ctx.scenario.stories[0];
        ctx.scenario.stories.push({ ...story, id: 'ORPHAN-1', key: 'ORPHAN-1', fields: { ...story.fields, epicKey: null, parentSummary: '' } });
    }
    if (layout === 'list') await openCatchUp(page, ctx, { width: 1440, height: 900 });
    else {
        await page.addInitScript(prefs => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs)), catchUpPrefs({ showPlanning: true, planningLayout: 'table' }));
        await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
        await expect(page.locator('tr[data-row-kind="epic"][data-issue-key="EPIC-1"]')).toBeVisible();
    }
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    return ctx;
}
async function explicitShot(page, name) {
    fs.mkdirSync(explicitEvidence, { recursive: true });
    await page.screenshot({ path: path.join(explicitEvidence, `${process.env.JEP_EXPLICIT_STAGE || 'after'}-${name}.png`), animations: 'disabled' });
}

test('Epic share discovery preserves title geometry and works by touch', async ({ browser }) => {
    for (const touch of [false, true]) {
        const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, hasTouch: touch });
        const page = await context.newPage();
        try {
            await openShareFixture(page);
            await page.setViewportSize({ width: touch ? 390 : 1440, height: 900 });
            const header = page.locator('.epic-block[data-epic-key="EPIC-1"] > .epic-header');
            await header.scrollIntoViewIfNeeded();
            await page.mouse.move(2, 2);
            await explicitShot(page, `list-${touch ? 'touch' : 'desktop'}-rest`);
            const action = epicCopy(page, 'EPIC-1');
            await expect(action).toBeAttached();
            const title = header.locator('.epic-link');
            const before = await title.boundingBox();
            const shape = await action.boundingBox();
            expect(shape.width).toBe(24); expect(shape.height).toBe(24);
            expect(await action.getAttribute('title')).toBe('Copy link to this Epic');
            if (!touch) {
                await expect(action).toHaveCSS('opacity', '0');
                await title.hover();
            }
            await expect(action).toHaveCSS('opacity', '1');
            const after = await title.boundingBox();
            expect(after).toEqual(before);
            const overlap = await header.evaluate(node => {
                const action = node.querySelector('[data-share-view-control]').getBoundingClientRect();
                const link = node.querySelector('.epic-name').getBoundingClientRect();
                const keyBox = node.querySelector('.epic-key').getBoundingClientRect();
                const refresh = node.querySelector('.epic-refresh-button').getBoundingClientRect();
                const intersects = other => action.left < other.right && action.right > other.left && action.top < other.bottom && action.bottom > other.top;
                const text = node.querySelector('.epic-name');
                return { link: intersects(link) || intersects(keyBox), refresh: intersects(refresh), textFits: text.scrollWidth <= text.clientWidth || getComputedStyle(text).textOverflow === 'ellipsis' };
            });
            expect(overlap).toEqual({ link: false, refresh: false, textFits: true });
            await explicitShot(page, `list-${touch ? 'touch' : 'desktop'}-discovered`);
            if (touch) await action.tap(); else await action.click();
            await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
            expect((await page.evaluate(() => window.__copied))[0]).toContain('&epic=EPIC-1');
            await expect(header.locator('[data-share-view="epic"] .planning-review-sr-only')).toHaveText('Epic EPIC-1 link copied');
            expect(await header.locator('.jira-export-toast, .jira-export-menu').count()).toBe(0);
            // The action sits after the summary and before the key, clear of both.
            const placed = await header.evaluate(node => {
                const button = node.querySelector('[data-share-view-control]').getBoundingClientRect();
                const key = node.querySelector('.epic-key').getBoundingClientRect();
                const name = node.querySelector('.epic-name');
                const nameBox = name.getBoundingClientRect();
                const visibleNameRight = nameBox.left + Math.min(name.scrollWidth, nameBox.width);
                return { afterSummary: button.left >= visibleNameRight - 1, beforeKey: button.right <= key.left + 1 };
            });
            // Below 761px the title row keeps the action after the key.
            if (!touch) expect(placed).toEqual({ afterSummary: true, beforeKey: true });
            await explicitShot(page, `list-${touch ? 'touch' : 'desktop'}-copied`);
        } finally { await context.close(); }
    }
});

test('grouped Epic and Planning Epic row copy their own targets', async ({ page, browser }) => {
    await openShareFixture(page);
    const grouped = page.locator('.initiative-body .epic-block[data-epic-key="EPIC-2"]');
    await expect(grouped).toBeAttached();
    await grouped.locator('.epic-title-row').hover();
    await explicitShot(page, 'grouped-epic');
    await epicCopy(page, 'EPIC-2').click();
    expect((await page.evaluate(() => window.__copied))[0]).toContain('&epic=EPIC-2');
    const tableContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await tableContext.newPage();
    await openShareFixture(page, 'table');
    const row = page.locator('tr[data-row-kind="epic"][data-issue-key="EPIC-2"]');
    await expect(row).toBeVisible();
    await explicitShot(page, 'table-rest');
    const action = epicCopy(page, 'EPIC-2');
    await row.hover();
    await expect(action).toHaveCSS('opacity', '1');
    // A Planning table row is 32px tall, so its action is the 20px size that fits the row's content box.
    expect((await action.boundingBox()).height).toBe(20);
    await action.click();
    await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
    const url = (await page.evaluate(() => window.__copied))[0];
    expect(url).toContain('mode=planning'); expect(url).toContain('&epic=EPIC-2');
    await expect(page.locator('tr.planning-review-synthetic [data-share-view]')).toHaveCount(0);
    await explicitShot(page, 'table-copied');
    await tableContext.close();
});

test('Epic Table discovery keeps row geometry and touch fallback operable with no Story or synthetic action', async ({ browser }) => {
    for (const touch of [false, true]) {
        const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, hasTouch: touch });
        const page = await context.newPage();
        try {
            await openShareFixture(page, 'table', true);
            await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
            const row = page.locator('tr[data-row-kind="epic"][data-issue-key="EPIC-1"]');
            const action = epicCopy(page, 'EPIC-1');
            await row.scrollIntoViewIfNeeded();
            await page.mouse.move(2, 2);
            const before = await row.boundingBox();
            const title = row.locator('.planning-review-truncated-value').first();
            const titleBox = await title.boundingBox();
            if (!touch) { await expect(action).toHaveCSS('opacity', '0'); await row.hover(); }
            await expect(action).toHaveCSS('opacity', '1');
            expect(await row.boundingBox()).toEqual(before);
            expect(await title.boundingBox()).toEqual(titleBox);
            if (touch) await action.tap(); else await action.click();
            await page.mouse.move(2, 2);
            await expect(action).toHaveCSS('opacity', '1');
            const notice = row.locator('.jira-export-menu');
            await expect(notice.getByRole('textbox')).toHaveValue(/&epic=EPIC-1/);
            expect(await notice.evaluate(node => { const field = node.querySelector('input').getBoundingClientRect(); return node.contains(document.elementFromPoint(field.x + field.width / 2, field.y + field.height / 2)); })).toBe(true);
            await explicitShot(page, `table-${touch ? 'touch' : 'desktop'}-fallback`);
            await notice.getByRole('button', { name: 'Dismiss' }).click();
            await expect(page.locator('tr.planning-review-synthetic')).not.toHaveCount(0);
            await expect(page.locator('tr.planning-review-synthetic [data-share-view]')).toHaveCount(0);
            await page.getByRole('radio', { name: 'Stories', exact: true }).click();
            await expect(page.locator('tr[data-row-kind="story"]')).not.toHaveCount(0);
            await expect(page.locator('tr[data-row-kind="story"] [data-share-view]')).toHaveCount(0);
        } finally { await context.close(); }
    }
});

test.describe('Epic Share: painted glyph ink', () => {
    test.use({ deviceScaleFactor: 2 });
    for (const layout of ['list', 'table']) {
        test(`the reused link and copied glyphs stay centred in the small Epic frame in ${layout}`, async ({ page }, testInfo) => {
            test.skip(process.platform !== 'darwin', 'Glyph ink placement is reviewed on macOS.');
            test.skip(testInfo.project.use.headless !== false, 'Glyph ink placement is only representative headed.');
            await openShareFixture(page, layout);
            const action = epicCopy(page, 'EPIC-1');
            await action.scrollIntoViewIfNeeded();
            await action.focus();
            expectCentredGlyph(await paintedInkOffset(page, action), `${layout} link`);
            await action.click();
            await expect(action.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
            expectCentredGlyph(await paintedInkOffset(page, action), `${layout} copied`);
        });
    }
});


test('a newer Epic copy owns feedback across separate controls and the header', async ({ page }) => {
    await openHarness(page, { clipboard: 'deferred' });
    await setHarness(page, { showEpics: true });
    const first = epicCopy(page, 'SYN-1'); const second = epicCopy(page, 'SYN-2');
    await first.focus(); await first.click();
    await second.focus(); await second.click();
    await page.evaluate(() => window.__clipboardPending[1].resolve());
    await expect(second.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
    await page.evaluate(() => window.__clipboardPending[0].reject(new Error('older write refused')));
    await expect(second.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
    await expect(page.locator('[data-share-view="epic"] .planning-review-sr-only')).toHaveText(['', 'Epic SYN-2 link copied']);
    expect(await page.locator('[data-share-view="epic"] :is(.jira-export-menu, .jira-export-toast)').count()).toBe(0);
    await shareButton(page, 'main').click();
    await page.evaluate(() => window.__clipboardPending[2].resolve());
    await expect(page.locator('[data-share-view="epic"] .planning-review-sr-only')).toHaveText(['', '']);
    await expect(shareStatus(page, 'main')).toHaveText('View link copied');
    expect(await shareNotice(page).count()).toBe(0);
    expect((await shareEvents(page)).map(event => event.result)).toEqual(['success', 'failure', 'success']);
    expect(JSON.stringify(await shareEvents(page))).not.toContain('SYN-');
});

test('ordinary copy success leaves work unobscured on main, compact and Epic controls', async ({ page }) => {
    await openHarness(page);
    await setHarness(page, { showEpics: true });
    for (const surface of ['main', 'compact', 'epic']) {
        await setHarness(page, { active: surface });
        const root = page.locator(`[data-share-view="${surface}"]`).first();
        const button = root.locator('[data-share-view-control]');
        await button.focus();
        const before = await button.boundingBox();
        await button.click();
        await expect(button.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
        const directory = path.join(repoRoot, 'tmp/share-view-tasks/feedback-visual');
        fs.mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: path.join(directory, `${process.env.JEP_FEEDBACK_STAGE || 'after'}-${surface}-success.png`), animations: 'disabled' });
        await expect(root.locator('.planning-review-sr-only')).toHaveText(surface === 'epic' ? 'Epic SYN-1 link copied' : 'View link copied');
        expect(await root.locator('.server-unavailable-banner, .jira-export-menu, .jira-export-toast, input, button:not([data-share-view-control])').count()).toBe(0);
        expect(await button.boundingBox()).toEqual(before);
    }
});


test('Share feedback reuses export surfaces and compact actions by semantic kind', async ({ page }) => {
    await openHarness(page, { clipboard: 'missing' });
    await setHarness(page, { referenceControls: true });
    const style = locator => locator.evaluate(node => {
        const value = getComputedStyle(node);
        return Object.fromEntries(['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius', 'boxShadow', 'padding', 'fontSize', 'fontFamily', 'lineHeight', 'color', 'display', 'textTransform', 'letterSpacing'].map(key => [key, value[key]]));
    });
    await page.getByRole('button', { name: 'Open Jira issue menu' }).click();
    const menu = page.locator('.jira-export > .jira-export-menu');
    const menuItems = page.locator('.jira-export-menu-item');
    // Original menu typography inherited from its host. Preserve the actual Jira controls and menu bounds.
    const inherited = await page.addStyleTag({ content: '.jira-export-menu { font-family: inherit !important; font-size: inherit !important; line-height: inherit !important; color: inherit !important; text-transform: inherit !important; letter-spacing: inherit !important; }' });
    const menuGeometry = () => menu.evaluate(node => {
        const bounds = element => { const rect = element.getBoundingClientRect(); const css = getComputedStyle(element); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, font: css.fontFamily, size: css.fontSize, line: css.lineHeight, color: css.color, background: css.backgroundColor, border: css.border, padding: css.padding, shadow: css.boxShadow, textTransform: css.textTransform, letterSpacing: css.letterSpacing }; };
        return { box: { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }, items: [...node.children].map(bounds) };
    });
    const originalGeometry = await menuGeometry();
    await inherited.evaluate(node => node.remove());
    expect(await menuGeometry()).toEqual(originalGeometry);
    const menuStyle = await style(menu);
    const itemStyle = await style(menuItems.first());
    const directory = path.join(repoRoot, 'tmp/share-view-tasks/feedback-visual');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `menu-reference-${process.env.JEP_FEEDBACK_STAGE || 'after'}.json`), JSON.stringify({ menuStyle, itemStyle, originalGeometry, geometry: await menuGeometry() }, null, 2));
    for (const property of ['fontFamily', 'fontSize', 'lineHeight']) expect(menuStyle[property], property).toBe(itemStyle[property]);
    await page.getByRole('menuitem', { name: 'Open epics' }).click();
    const warningStyle = await style(page.locator('.jira-export > .jira-export-toast'));
    await shareButton(page, 'main').click();
    const manual = shareNotice(page, 'main');
    await expect(manual).toHaveClass('jira-export-menu');
    // Native display, palette and canonical body typography all come from the shared menu surface.
    expect(await style(manual)).toEqual(menuStyle);
    expect(await style(manual.getByRole('button', { name: 'Dismiss' }))).toEqual(await style(page.locator('[data-feedback-reference="compact"] > button')));
    await manual.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('button', { name: 'Open Jira issue menu' }).click();
    await page.getByRole('menuitem', { name: 'Open epics' }).click();
    await setHarness(page, { capture: { ok: false, reason: 'too_long' } });
    await shareButton(page, 'main').click();
    const warning = shareNotice(page, 'main');
    await expect(warning).toHaveClass('jira-export-toast');
    expect(await style(warning)).toEqual(warningStyle);
    expect(await style(warning.getByRole('button', { name: 'Dismiss' }))).toEqual(await style(page.locator('[data-feedback-reference="compact"] > button')));
});

async function expectCompactFeedback(notice) {
    await expect(notice).toBeVisible();
    if (await notice.getAttribute('class') === 'jira-export-menu') {
        await expect(notice).toHaveCSS('font-family', '"IBM Plex Mono", monospace');
        await expect(notice).toHaveCSS('font-size', '14px');
        await expect(notice).toHaveCSS('line-height', 'normal');
        await expect(notice).toHaveCSS('color', 'rgb(102, 102, 102)');
        await expect(notice).toHaveCSS('text-transform', 'none');
        expect(['normal', '0px']).toContain(await notice.evaluate(node => getComputedStyle(node).letterSpacing));
    }
    // Native tap paint was present at134ms and gone at268ms in the controlled browser probe.
    // Preserve that feedback; settle its paint before geometry and synthetic visual evidence.
    if (await notice.evaluate(() => navigator.maxTouchPoints > 0)) await notice.page().waitForTimeout(300);
    // Trial action waits for the real sticky/header layout to settle and proves the compact action is unobscured.
    await notice.getByRole('button', { name: 'Dismiss' }).click({ trial: true });
    const metrics = await notice.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const dismiss = node.querySelector('button');
        const box = dismiss.getBoundingClientRect();
        const field = node.querySelector('input');
        const hit = element => {
            const bounds = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
        };
        const points = element => {
            const bounds = element.getBoundingClientRect();
            return [[bounds.left + 3, bounds.top + bounds.height / 2], [bounds.right - 3, bounds.top + bounds.height / 2],
                [bounds.left + bounds.width / 2, bounds.top + 3], [bounds.left + bounds.width / 2, bounds.bottom - 3],
                [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2]];
        };
        const inputHits = !field ? [] : points(field).map(([x, y]) => ({ x, y, own: field.contains(document.elementFromPoint(x, y)), cover: document.elementFromPoint(x, y)?.tagName }));
        const paragraph = node.querySelector('p');
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const textHits = [...range.getClientRects()].flatMap(bounds => [bounds.left + 1, (bounds.left + bounds.right) / 2, bounds.right - 1]
            .map(x => ({ x, y: (bounds.top + bounds.bottom) / 2, own: paragraph.contains(document.elementFromPoint(x, (bounds.top + bounds.bottom) / 2)) })));
        const back = document.querySelector('.back-to-top')?.getBoundingClientRect();
        const overlapsBackToTop = Boolean(back?.width && back?.height && rect.left < back.right && rect.right > back.left && rect.top < back.bottom && rect.bottom > back.top);
        const panelOcclusion = [];
        for (let x = rect.left + 4; x < rect.right - 4; x += 8) for (let y = rect.top + 4; y < rect.bottom - 4; y += 8) {
            const cover = document.elementFromPoint(x, y);
            if (!node.contains(cover)) panelOcclusion.push({ x, y, cover: cover?.outerHTML.slice(0, 240) });
        }
        return {
            panelOcclusion,
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewport: document.documentElement.clientWidth,
            backToTop: back ? { top: back.top, bottom: back.bottom, left: back.left, right: back.right, width: back.width, height: back.height } : null,
            inputHits, textHits, overlapsBackToTop,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            dismissWidth: box.width, dismissHeight: box.height, dismissHit: hit(dismiss),
            dismissTop: box.top, dismissCover: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.outerHTML.slice(0, 240),
            fieldHit: !field || hit(field), clipped: node.scrollWidth - node.clientWidth,
        };
    });
    const directory = path.join(repoRoot, 'tmp/share-view-tasks/feedback-visual');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'latest-feedback-bounds.json'), JSON.stringify(metrics, null, 2));
    expect(metrics.overlapsBackToTop, JSON.stringify(metrics)).toBe(false);
    expect(metrics.panelOcclusion, JSON.stringify(metrics)).toEqual([]);
    expect(metrics.inputHits.every(hit => hit.own), JSON.stringify(metrics)).toBe(true);
    expect(metrics.textHits.every(hit => hit.own), JSON.stringify(metrics)).toBe(true);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.clipped).toBeLessThanOrEqual(1);
    expect(metrics.dismissWidth).toBeGreaterThan(40);
    expect(metrics.dismissWidth).toBeLessThanOrEqual(110);
    expect(metrics.dismissHeight).toBeLessThanOrEqual(38);
    expect(metrics.dismissHit && metrics.fieldHit, JSON.stringify(metrics)).toBe(true);
}

test('manual and warning feedback controls stay compact and hit-testable on touch main and compact headers', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    try {
        await openHarness(page, { width: 390, clipboard: 'missing' });
        for (const surface of ['main', 'compact']) {
            for (const manual of [true, false]) {
                await setHarness(page, { active: surface, capture: manual
                    ? { ok: true, url: `${SYNTHETIC_URL}&find=${'a'.repeat(1400)}`, dropped: [] }
                    : { ok: false, reason: 'too_long' } });
                await shareButton(page, surface).tap();
                const notice = shareNotice(page, surface);
                await expectCompactFeedback(notice);
                if (manual) {
                    const field = notice.getByRole('textbox');
                    await expect(field).toBeFocused();
                    expect(await field.evaluate(node => node.selectionEnd - node.selectionStart)).toBe((await field.inputValue()).length);
                }
                const directory = path.join(repoRoot, 'tmp/share-view-tasks/feedback-visual');
                fs.mkdirSync(directory, { recursive: true });
                await page.screenshot({ path: path.join(directory, `after-touch-${surface}-${manual ? 'manual' : 'warning'}.png`), animations: 'disabled' });
                await notice.getByRole('button', { name: 'Dismiss' }).tap();
                await expect(notice).toHaveCount(0);
            }
        }
    } finally { await context.close(); }
});

test('Epic List and Table manual feedback keeps the URL and compact dismissal above the sticky layers', async ({ browser }) => {
    for (const layout of ['list', 'table']) for (const touch of [false, true]) {
        const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, hasTouch: touch });
        const page = await context.newPage();
        try {
            await openShareFixture(page, layout);
            await page.setViewportSize({ width: touch ? 390 : 1440, height: 900 });
            await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
            const action = epicCopy(page, 'EPIC-1');
            await action.scrollIntoViewIfNeeded();
            await action.focus();
            if (touch) await action.tap(); else await action.click();
            const notice = page.locator('[data-share-view="epic"] > .jira-export-menu');
            const directory = path.join(repoRoot, 'tmp/share-view-tasks/feedback-visual');
            fs.mkdirSync(directory, { recursive: true });
            await expectCompactFeedback(notice);
            await expect(notice.getByRole('textbox')).toHaveValue(/&epic=EPIC-1/);
            await page.screenshot({ path: path.join(directory, `after-${layout}-${touch ? 'touch' : 'desktop'}-manual.png`), animations: 'disabled' });
            if (touch) await notice.getByRole('button', { name: 'Dismiss' }).tap(); else await notice.getByRole('button', { name: 'Dismiss' }).click();
            await expect(notice).toHaveCount(0);
        } finally { await context.close(); }
    }
});


test('genuine warnings match the Jira warning typography and wrapping across main compact List Epic and Table Epic hosts on desktop and touch', async ({ browser }) => {
    test.setTimeout(120000);
    const typography = locator => locator.evaluate(node => {
        const css = getComputedStyle(node);
        return Object.fromEntries(['fontFamily', 'fontSize', 'lineHeight', 'color', 'textTransform', 'letterSpacing'].map(key => [key, css[key]]));
    });
    const directory = path.join(repoRoot, 'tmp/share-view-tasks/warning-font-visual');
    fs.mkdirSync(directory, { recursive: true });
    for (const touch of [false, true]) {
        const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, hasTouch: touch });
        const referencePage = await context.newPage();
        try {
            // Use the existing mounted Jira overflow warning in its canonical main-header context.
            await openHarness(referencePage, { width: touch ? 390 : 1440 });
            await setHarness(referencePage, { referenceControls: true });
            await referencePage.getByRole('button', { name: 'Open Jira issue menu' }).click();
            await referencePage.getByRole('menuitem', { name: 'Open epics' }).click();
            const reference = await typography(referencePage.locator('.jira-export > .jira-export-toast'));
            expect(reference.fontFamily).toBe('"IBM Plex Mono", monospace');
            await referencePage.close();
            const geometry = [];
            for (const host of ['main', 'compact', 'list', 'table']) {
                const page = await context.newPage();
                const ctx = await mockDashboard(page);
                // A synthetic group beyond the codec's existing 255-character limit produces a
                // genuine invalid_state refusal without replacing the Share component or capture hook.
                const groupId = 'synthetic-group-'.repeat(18);
                ctx.respond('/api/groups-config', ({ json }) => json({
                    ...groupsConfigPayload, defaultGroupId: groupId,
                    groups: [{ ...groupsConfigPayload.groups[0], id: groupId }],
                    preferences: { ...groupsConfigPayload.preferences, activeGroupId: groupId, effectiveVisibleGroupIds: [groupId] },
                }));
                await page.addInitScript(prefs => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs)), catchUpPrefs({
                    activeGroupId: groupId, showPlanning: host === 'table', planningLayout: host === 'table' ? 'table' : 'list',
                }));
                await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
                await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
                const action = host === 'main' || host === 'compact' ? shareButton(page, host) : epicCopy(page, 'EPIC-1');
                if (host === 'compact') {
                    await page.evaluate(() => window.scrollTo(0, 900));
                    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
                } else await action.scrollIntoViewIfNeeded();
                await action.focus();
                if (touch) await action.tap(); else await action.click();
                const notice = shareNotice(page, host === 'list' || host === 'table' ? 'epic' : host);
                await expect(notice).toHaveClass('jira-export-toast');
                await expect(notice.locator('p')).toHaveText('This view cannot be shared as a link right now, so nothing was copied.');
                expect.soft(await typography(notice), `${host}/${touch ? 'touch' : 'desktop'} canonical warning`).toEqual(reference);
                expect.soft(await typography(notice.locator('p')), `${host} actual text inheritance`).toEqual(reference);
                await expectCompactFeedback(notice);
                const textBounds = await notice.locator('p').evaluate(node => {
                    const range = document.createRange(); range.selectNodeContents(node);
                    const box = node.getBoundingClientRect();
                    const lines = [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => ({ width: rect.width, height: rect.height, left: rect.left - box.left, right: rect.right - box.left }));
                    return { width: box.width, height: box.height, lines };
                });
                expect(textBounds.lines.length).toBeGreaterThan(1);
                for (const line of textBounds.lines) {
                    expect(line.left).toBeGreaterThanOrEqual(0);
                    expect(line.right).toBeLessThanOrEqual(textBounds.width + 1);
                }
                geometry.push({ host, ...textBounds });
                await page.screenshot({ path: path.join(directory, `${process.env.JEP_WARNING_FONT_STAGE || 'after'}-${touch ? 'touch' : 'desktop'}-${host}.png`), animations: 'disabled' });
                if (touch) await notice.getByRole('button', { name: 'Dismiss' }).tap(); else await notice.getByRole('button', { name: 'Dismiss' }).click();
                await expect(notice).toHaveCount(0);
                await page.close();
            }
            // All hosts have the same bounded 18rem warning width: the same genuine sentence
            // must wrap identically, including its actual rendered line fragments and paragraph box.
            for (const value of geometry.slice(1)) {
                const { host, ...bounds } = value;
                const { host: referenceHost, ...mainBounds } = geometry[0];
                expect.soft(bounds, `${host} wrapping matches ${referenceHost}`).toEqual(mainBounds);
            }
            fs.writeFileSync(path.join(directory, `${process.env.JEP_WARNING_FONT_STAGE || 'after'}-${touch ? 'touch' : 'desktop'}-geometry.json`), JSON.stringify({ reference, geometry }, null, 2));
        } finally { await context.close(); }
    }
});

test('an alert group count text is its copy-link control, always visible, and copies only that group card', async ({ page }) => {
    await installClipboard(page);
    const ctx = await mockDashboard(page);
    const story = ctx.scenario.stories[0];
    story.fields.customfield_10004 = null;
    ctx.respond('/api/missing-info', ({ json }) => json({ issues: [{ ...story, fields: { ...story.fields, customfield_10101: story.fields.sprint, missingFields: ['Story Points'] } }], epics: [], count: 1, epicCount: 0 }));
    await openCatchUp(page, ctx, { width: 1440, height: 900 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    const group = page.locator('#eng-alert-missing .alert-team-group[data-alert-team]').first();
    await expect(group).toBeVisible();
    const action = group.locator('[data-share-view-control]');
    await expect(group.locator('[data-share-view-control]')).toHaveCount(1);
    await expect(action).toHaveClass(/alert-team-count/);
    await expect(action).toHaveCSS('opacity', '1');
    expect((await action.boundingBox()).height).toBeLessThanOrEqual(24);
    await action.click();
    await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
    expect((await page.evaluate(() => window.__copied))[0]).toMatch(/&alertTeam=[A-Za-z]+:/);
    expect((await page.evaluate(() => window.__copied))[0]).toMatch(/[?&]alerts=missing(&|$)/);
    await expect(action).toHaveAttribute('title', 'Alert group link copied');
    await explicitShot(page, 'alert-group-copied');
});
