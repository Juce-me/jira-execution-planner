const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { mockDashboard, openCatchUp, epicBlock } = require('./eng_epic_refresh_fixture');

// Person avatars (issue #324): a photo fills the existing person-glyph slot with no new request and
// no layout change. Synthetic fixtures only; the avatar host is stubbed, nothing leaves the machine.
// The document is fulfilled by the fixture, so the real img-src from backend/security/headers.py is
// injected as a meta CSP to make a blocked host observable (securitypolicyviolation).

const ROOT = path.resolve(__dirname, '..', '..');
const PYTHON = process.env.JEP_TEST_PYTHON || path.join(ROOT, '.venv', 'bin', 'python');
const HOST = 'avatar-management--avatars.us-west-2.prod.public.atl-paas.net';
const PHOTO = `https://${HOST}/synthetic/photo/32`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const avatarHosts = () => JSON.parse(execFileSync(PYTHON, ['-c',
    'import json; from backend.security.avatar_urls import AVATAR_HOSTS; print(json.dumps(sorted(AVATAR_HOSTS)))'], { cwd: ROOT }).toString());
const imgSrc = () => execFileSync(PYTHON, ['-c',
    'from backend.security.headers import _content_security_policy as c; print([p.strip() for p in c().split(";") if p.strip().startswith("img-src")][0])'], { cwd: ROOT }).toString().trim();

test.use({ reducedMotion: 'reduce', viewport: { width: 1400, height: 1000 } });

function withAvatars(scenario) {
    for (const key of ['EPIC-1', 'EPIC-2']) scenario.epics[key].assignee.avatarUrl = PHOTO;
    for (const story of scenario.stories) if (story.fields.assignee) story.fields.assignee.avatarUrl = PHOTO;
    return scenario;
}

async function prepare(page, { avatars, imageStatus = 200, imageDelay = 0 }) {
    const { buildScenario } = require('./eng_epic_refresh_fixture');
    const scenario = avatars ? withAvatars(buildScenario()) : buildScenario();
    const imageRequests = [];
    const violations = [];
    await page.exposeFunction('reportViolation', blocked => violations.push(blocked));
    await page.addInitScript((policy) => {
        const meta = document.createElement('meta');
        meta.httpEquiv = 'Content-Security-Policy';
        meta.content = policy;
        document.head.appendChild(meta);
        document.addEventListener('securitypolicyviolation', event => window.reportViolation(event.blockedURI));
    }, imgSrc());
    await page.route(`https://${HOST}/**`, async (route) => {
        imageRequests.push(route.request().url());
        if (imageDelay) await new Promise(resolve => setTimeout(resolve, imageDelay));
        return imageStatus === 200
            ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
            : route.fulfill({ status: imageStatus, body: '' });
    });
    const ctx = await mockDashboard(page, { scenario });
    return { ctx, imageRequests, violations };
}

const geometry = (page) => page.evaluate(() => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n * 100) / 100); };
    const header = document.querySelector('.epic-block[data-epic-key="EPIC-2"] .epic-header');
    const story = document.querySelector('.task-item[data-task-key="E2-S01"]');
    return {
        epicHeader: rect(header),
        epicIcon: rect(header.querySelector('.task-assignee-icon')),
        epicName: rect(header.querySelector('.epic-assignee-value')),
        story: rect(story),
        storyIcon: rect(story.querySelector('.task-assignee-icon')),
        storyName: rect(story.querySelector('.task-assignee-icon').nextElementSibling),
        headerTop: getComputedStyle(header).top,
        headerPosition: getComputedStyle(header).position,
    };
});

// The `t` query param is a per-load cache-buster timestamp, so it is dropped before comparing.
// /api/auth/refresh is the browser-focus refresh: it follows window focus, not the page load, so it is excluded.
const requestMultiset = (calls) => calls.filter(call => call.pathname !== '/api/auth/refresh').map((call) => {
    const params = Object.entries(call.params).filter(([name]) => name !== 't').sort(([a], [b]) => a.localeCompare(b));
    return `${call.method} ${call.pathname} ${JSON.stringify(params)}`;
}).sort();

test('avatars add no /api request and every image request is on an allowlisted host', async ({ page }) => {
    const plain = await prepare(page, { avatars: false });
    await openCatchUp(page, plain.ctx);
    const baseline = requestMultiset(plain.ctx.calls);
    expect(plain.imageRequests).toEqual([]);

    const second = await page.context().newPage();
    const withPhoto = await prepare(second, { avatars: true });
    await openCatchUp(second, withPhoto.ctx);
    await expect(second.locator('.task-assignee-icon img').first()).toBeVisible();
    expect(requestMultiset(withPhoto.ctx.calls)).toEqual(baseline);

    const hosts = avatarHosts();
    expect(withPhoto.imageRequests.length).toBeGreaterThan(0);
    for (const url of withPhoto.imageRequests) expect(hosts).toContain(new URL(url).host);
    // One URL is reused by every row: the browser must not refetch it per row.
    expect(new Set(withPhoto.imageRequests).size).toBe(1);
    expect(withPhoto.violations).toEqual([]);
});

test('geometry is unchanged before the image loads, after it loads and after a 404 fallback', async ({ page, browser }) => {
    const plain = await prepare(page, { avatars: false });
    await openCatchUp(page, plain.ctx);
    const baseline = await geometry(page);

    const delayedPage = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' })).newPage();
    const delayed = await prepare(delayedPage, { avatars: true, imageDelay: 1500 });
    await openCatchUp(delayedPage, delayed.ctx);
    expect(await geometry(delayedPage)).toEqual(baseline);
    await expect(delayedPage.locator('.epic-block[data-epic-key="EPIC-2"] .epic-header .task-assignee-icon img')).toBeVisible();
    expect(await geometry(delayedPage)).toEqual(baseline);
    const ink = await delayedPage.locator('.epic-block[data-epic-key="EPIC-2"] .epic-header .task-assignee-icon img').evaluate(img => {
        const rect = img.getBoundingClientRect();
        return { width: rect.width, height: rect.height, radius: getComputedStyle(img).borderRadius, fit: getComputedStyle(img).objectFit };
    });
    expect(ink).toEqual({ width: 20, height: 20, radius: '999px', fit: 'cover' });
    expect(await delayedPage.locator('.task-item[data-task-key="E2-S01"] .task-assignee-icon img').evaluate(img => img.getBoundingClientRect().width)).toBe(14);

    const failedPage = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' })).newPage();
    const failed = await prepare(failedPage, { avatars: true, imageStatus: 404 });
    await openCatchUp(failedPage, failed.ctx);
    await expect(failedPage.locator('.task-assignee-icon svg').first()).toBeVisible();
    // Lazy images below the fold have not been requested yet (Firefox), so only the slots in view are asserted.
    for (const slot of ['.task-item[data-task-key="E2-S01"] .task-assignee-icon', '.epic-block[data-epic-key="EPIC-2"] .epic-header .task-assignee-icon']) {
        await expect(failedPage.locator(`${slot} svg`)).toBeVisible();
        await expect(failedPage.locator(`${slot} img`)).toHaveCount(0);
    }
    expect(await geometry(failedPage)).toEqual(baseline);
    // One failure is learned once: later rows do not request the broken URL again.
    expect(new Set(failed.imageRequests).size).toBe(1);
});

test('a URL outside the allowlist never becomes an image request', async ({ page }) => {
    const { buildScenario } = require('./eng_epic_refresh_fixture');
    const scenario = buildScenario();
    scenario.epics['EPIC-1'].assignee.avatarUrl = 'https://evil.example.test/a.png';
    scenario.epics['EPIC-2'].assignee.avatarUrl = 'http://' + HOST + '/a.png';
    scenario.epics['EPIC-3'].assignee.avatarUrl = 'javascript:alert(1)';
    const requests = [];
    page.on('request', request => { if (request.resourceType() === 'image' && new URL(request.url()).host !== new URL(page.url()).host) requests.push(request.url()); });
    const ctx = await mockDashboard(page, { scenario });
    await openCatchUp(page, ctx);
    await expect(epicBlock(page, 'EPIC-1').locator('.task-assignee-icon svg').first()).toBeVisible();
    expect(requests).toEqual([]);
});

// Painted-ink check at 2x. The geometry equality above cannot see where the pixels land inside the slot;
// this measures the painted magenta stub image and the painted glyph against the slot box, per engine
// (run with --headed --browser=firefox and --browser=webkit; headless Chromium differs by about 2px).
const MAGENTA = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP4z/AfK2IYWhIA0ad/gXfwoGMAAAAASUVORK5CYII=', 'base64');

test.describe('painted ink at 2x', () => {
    test.use({ deviceScaleFactor: 2 });

    async function ink(page, locator) {
        const box = await locator.boundingBox();
        const png = await page.screenshot({ clip: { x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6 } });
        return page.evaluate(async ({ data, slot }) => {
            const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0);
            const { data: px } = context.getImageData(0, 0, bitmap.width, bitmap.height);
            const scale = bitmap.width / (slot.width + 6);
            let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
            for (let y = 0; y < bitmap.height; y += 1) for (let x = 0; x < bitmap.width; x += 1) {
                const i = (y * bitmap.width + x) * 4;
                const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
                const painted = (r > 200 && b > 200 && g < 100) || (Math.abs(r - 102) < 70 && Math.abs(g - 102) < 70 && Math.abs(b - 102) < 70 && r < 200);
                if (painted) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
            }
            return { scale, centreDx: ((minX + maxX + 1) / 2) / scale - 3 - slot.width / 2, centreDy: ((minY + maxY + 1) / 2) / scale - 3 - slot.height / 2, width: (maxX - minX + 1) / scale, height: (maxY - minY + 1) / scale };
        }, { data: png.toString('base64'), slot: { width: box.width, height: box.height } });
    }

    for (const photo of [true, false]) {
        test(`story and Epic slot ink is centred (${photo ? 'photo' : 'fallback glyph'})`, async ({ page }) => {
            const prepared = await prepare(page, { avatars: photo });
            await page.unroute(`https://${HOST}/**`);
            await page.route(`https://${HOST}/**`, route => route.fulfill({ status: 200, contentType: 'image/png', body: MAGENTA }));
            await openCatchUp(page, prepared.ctx);
            if (photo) await expect.poll(() => page.evaluate(() => ['.task-item[data-task-key="E2-S01"] .task-assignee-icon img', '.epic-block[data-epic-key="EPIC-2"] .epic-header .task-assignee-icon img'].every(selector => { const img = document.querySelector(selector); return img && img.complete && img.naturalWidth > 0; }))).toBe(true);
            await page.evaluate(() => document.fonts.ready);
            const story = await ink(page, page.locator('.task-item[data-task-key="E2-S01"] .task-assignee-icon'));
            const epic = await ink(page, page.locator('.epic-block[data-epic-key="EPIC-2"] .epic-header .task-assignee-icon'));
            console.log(JSON.stringify({ engine: test.info().project.name, photo, story, epic }));
            expect(story.scale).toBe(2);
            expect(Math.abs(story.centreDx)).toBeLessThanOrEqual(1);
            expect(Math.abs(story.centreDy)).toBeLessThanOrEqual(1);
            expect(Math.abs(epic.centreDx)).toBeLessThanOrEqual(1.5);
            expect(Math.abs(epic.centreDy)).toBeLessThanOrEqual(2.5);
        });
    }
});
