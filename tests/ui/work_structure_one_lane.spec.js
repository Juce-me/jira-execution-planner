// Task 4B/4C/4D UI proof for the one `rnd_2027` request lane (split Product/Tech by the Allocation stamp), against fully mocked routes (no Jira, no DB, no server).
// The dashboard composition does not yet pass the work model to the ENG hooks/components, so the REAL components and the REAL
// useEngSprintData closure are mounted in a small harness page with the model injected (tests/ui/work_structure_one_lane.entry.jsx).
// Synthetic data only.
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const origin = 'http://localhost:5952';
let bundle;

test.beforeAll(() => {
    bundle = esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'work_structure_one_lane.entry.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty', '.js': 'jsx' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

async function openHarness(page) {
    const calls = [];
    await page.route(`${origin}/**`, async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/harness') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="filters"></div><div id="split"></div><div id="alerts"></div>' });
        }
        if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'application/javascript', body: bundle });
        if (url.pathname.startsWith('/api/')) {
            calls.push({ pathname: url.pathname, project: url.searchParams.get('project') });
            const payload = url.pathname === '/api/tasks-with-team-name'
                ? { issues: [{ key: 'PLAN-E1', fields: { customfield_10004: 8 } }], epics: {}, epicsInScope: [] }
                : { epics: [] };
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
        }
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/harness`);
    await page.addScriptTag({ url: `${origin}/harness.js` });
    return calls;
}

test('combined model: one project=all request, no Tech lane data, no retired-alert requests', async ({ page }) => {
    const calls = await openHarness(page);
    const outcome = await page.evaluate(async () => {
        const { api, state, lastLoadedSprintRef } = window.__oneLane.sprintData('rnd_2027');
        const group = api.loadGroupTasks();
        const outcomes = await Promise.all([group.product, group.tech]);
        const alerts = await api.loadAlertEpics();
        const backlog = await api.fetchBacklogEpics('product');
        return { outcomes, alerts, backlog, techLoaded: state.techLoaded, techTasks: state.techTasks.length, lastLoaded: lastLoadedSprintRef.current };
    });
    expect(outcome.outcomes).toEqual(['applied', 'applied']);
    expect(outcome.techLoaded).toEqual([]);
    expect(outcome.techTasks).toBe(0);
    expect(outcome.lastLoaded).toBe('1');
    expect(outcome.backlog).toEqual([]);
    // One group load + one alerts load, each a single project=all request; nothing else (no tech, no backlog).
    expect(calls.map(call => `${call.pathname}?project=${call.project}`)).toEqual([
        '/api/tasks-with-team-name?project=all', '/api/tasks-with-team-name?project=all',
    ]);
});

test('Legacy keeps its two lane requests and the Backlog source', async ({ page }) => {
    const calls = await openHarness(page);
    await page.evaluate(async () => {
        const { api } = window.__oneLane.sprintData(undefined);
        const group = api.loadGroupTasks();
        await Promise.all([group.product, group.tech]);
        await api.fetchBacklogEpics('tech');
    });
    expect(calls.map(call => call.project).sort()).toEqual(['product', 'tech', 'tech']);
    expect(calls.filter(call => call.pathname !== '/api/tasks-with-team-name').length).toBe(1);
});

test('Projects (Product/Tech) facet is shown for the new model, as for Legacy', async ({ page }) => {
    await openHarness(page);
    for (const workModel of ['rnd_2027', undefined]) {
        await page.evaluate(model => window.__oneLane.mount('filters', { workModel: model }), workModel);
        await page.getByRole('button', { name: /Filters/ }).click();
        await expect(page.locator('.pop-group[data-facet="projects"]')).toHaveCount(1);
        await expect(page.locator('.pop-group[data-facet="status"]')).toHaveCount(1);
        await page.keyboard.press('Escape');
    }
});

// The new model splits by the server's Allocation stamp; an unstamped Epic is Product (plan A2), Ad Hoc follows the stamp,
// and an unmapped ('none') stamp is No Allocation, never Product.
for (const [pair, stamp, label, adHoc, excluded] of [
    ['ordinary', undefined, 'Product 100% · 8.0 SP', null, null],
    ['ordinary', 'tech', 'Tech 100% · 8.0 SP', null, null],
    ['ordinary', 'none', 'No Allocation 100% · 8.0 SP', null, null],
    ['ad_hoc', 'tech', 'Tech 100% · 8.0 SP', null, null],
    ['excluded', undefined, null, null, 'Product'],
    ['excluded', 'none', null, null, 'None'],
]) {
    test(`new-model split bar: ${pair} 8-SP ${stamp || 'unstamped'} Epic splits Product/Tech and never doubles to 16 SP`, async ({ page }) => {
        await openHarness(page);
        await page.evaluate(arg => window.__oneLane.mount('split', arg), { pair, stamp });
        const text = (await page.locator('#split').innerText()).replace(/\s+/g, ' ');
        expect(text).not.toMatch(/16\.0/);
        await expect(page.locator('#split [data-work-lane="combined"]')).toHaveCount(0);
        if (label) {
            expect(text).toContain(label);
            if (adHoc) expect(text).toContain(`Ad Hoc ${adHoc}`);
            await expect(page.locator('#split .capacity-bar-marker')).toHaveCount(1);
        } else {
            // Excluded work leaves the included allocation entirely; its 8 SP is reported on its own side.
            const tooltip = await page.locator(`#split .project-bar-fill.${excluded.toLowerCase()}`).getAttribute('data-tooltip');
            expect(tooltip).toContain('Excluded: 8.0 SP');
        }
    });
}

for (const compact of [false, true]) {
    test(`new-model split bar (${compact ? 'compact' : 'full'}): Product/Tech readout and the 70/30 target marker`, async ({ page }) => {
        await openHarness(page);
        await page.evaluate(arg => window.__oneLane.mount('split', arg), { pair: 'ordinary', stamp: 'tech', compact });
        await expect(page.locator('#split .capacity-bar-marker')).toHaveCount(1);
        await expect(page.locator('#split .capacity-bar-marker')).toHaveAttribute('data-tooltip', 'Product / Tech target: 70% / 30%');
        await expect(page.locator('#split .project-bar-fill.tech')).toHaveCount(1);
        await expect(page.locator('#split .planning-stat-label')).toHaveCount(compact ? 0 : 1);
        if (compact) await expect(page.locator('#split .planning-compact-readout')).toHaveText('Product 0.0 · Tech 8.0 SP');
    });
}

test('new-model split bar: a mixed selection shows both sides (screenshot)', async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 720, height: 240 });
    // The harness bundle carries no CSS; the built stylesheet styles the real component for the screenshot.
    await page.addStyleTag({ path: path.join(__dirname, '..', '..', 'frontend', 'dist', 'dashboard.css') });
    await page.addStyleTag({ content: '#split { padding: 16px; background: #fff; }' });
    await page.evaluate(() => window.__oneLane.mount('split', { pair: 'mixed' }));
    const text = (await page.locator('#split').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Product 62% · 8.0 SP');
    expect(text).toContain('Tech 38% · 5.0 SP');
    await page.locator('#split').screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'delivery-split-bar.png') });
});

test('new-model split bar shows Product, Tech and No Allocation (screenshot)', async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 720, height: 240 });
    await page.addStyleTag({ path: path.join(__dirname, '..', '..', 'frontend', 'dist', 'dashboard.css') });
    await page.addStyleTag({ content: '#split { padding: 16px; background: #fff; }' });
    await page.evaluate(() => window.__oneLane.mount('split', { pair: 'allocation' }));
    const text = (await page.locator('#split').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Product 35% · 8.0 SP');
    expect(text).toContain('Tech 35% · 8.0 SP');
    expect(text).toContain('No Allocation 30% · 7.0 SP');
    const none = page.locator('#split .project-bar-fill.none');
    await expect(none).toHaveAttribute('data-tooltip', 'No Allocation: 7.0 SP (30% of selected).');
    await expect(page.locator('#split .project-bar-fill.tech')).toHaveAttribute('data-tooltip', /Incl\. Ad Hoc: 3\.0 SP\./);
    await expect(page.locator('#split .project-bar-fill.product-adhoc')).toHaveCount(0);
    // Let the fill transition settle before measuring and capturing.
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(`#split ${selector}`).getBoundingClientRect();
        const track = box('.capacity-bar-track');
        const label = document.querySelector('#split .project-bar-fill.none .capacity-bar-fill-label');
        const techLabel = document.querySelector('#split .project-bar-fill.tech .capacity-bar-fill-label');
        const marker = box('.capacity-bar-marker');
        return {
            track: { left: track.left, right: track.right, width: track.width },
            product: box('.project-bar-fill.product'), tech: box('.project-bar-fill.tech'), none: box('.project-bar-fill.none'),
            adHoc: box('.project-bar-fill.tech-adhoc'), markerCenter: marker.left + marker.width / 2,
            label: label.getBoundingClientRect(), labelClipped: label.scrollWidth > label.clientWidth,
            techLabel: techLabel.getBoundingClientRect(),
        };
    });
    const { track, product, tech, none: noneBox, adHoc, markerCenter, label } = geometry;
    // The three segments tile the bar in order Product, Tech, No Allocation and their widths sum to the bar.
    expect(Math.abs(product.width + tech.width + noneBox.width - track.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(product.left - track.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(tech.left - product.right)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(noneBox.left - tech.right)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(noneBox.right - track.right)).toBeLessThanOrEqual(0.5);
    // The 70% target is 70% of the whole bar, not of Product + Tech.
    expect(Math.abs(markerCenter - (track.left + track.width * 0.7))).toBeLessThanOrEqual(1);
    // The Tech Ad Hoc subsegment starts the Tech side, covers exactly its Ad Hoc share (3 of 8 SP)
    // and stays clear of the right-aligned Tech label.
    expect(Math.abs(adHoc.left - tech.left)).toBeLessThanOrEqual(0.5);
    expect(adHoc.right).toBeLessThanOrEqual(tech.right + 0.5);
    expect(Math.abs(adHoc.width - tech.width * 3 / 8)).toBeLessThanOrEqual(1);
    expect(geometry.techLabel.left).toBeGreaterThanOrEqual(adHoc.right);
    expect(geometry.techLabel.right).toBeLessThanOrEqual(tech.right);
    // The No Allocation label fits inside its segment.
    expect(geometry.labelClipped).toBe(false);
    expect(label.left).toBeGreaterThanOrEqual(noneBox.left);
    expect(label.right).toBeLessThanOrEqual(noneBox.right);
    await page.locator('#split').screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'delivery-split-bar-no-allocation.png'), animations: 'disabled' });
});

test('new-model split bar: a 100% Ad Hoc Tech side keeps its label painted above the Ad Hoc subsegment', async ({ page }) => {
    await openHarness(page);
    await page.setViewportSize({ width: 720, height: 240 });
    await page.addStyleTag({ path: path.join(__dirname, '..', '..', 'frontend', 'dist', 'dashboard.css') });
    await page.evaluate(() => window.__oneLane.mount('split', { pair: 'ad_hoc', stamp: 'tech' }));
    await expect(page.locator('#split .project-bar-fill.tech-adhoc')).toHaveCount(1);
    const hit = await page.evaluate(() => {
        const label = document.querySelector('#split .project-bar-fill.tech .capacity-bar-fill-label');
        const box = label.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { topIsLabel: top === label || label.contains(top), topClass: top?.className || '' };
    });
    expect(hit.topIsLabel, `label covered by ${hit.topClass}`).toBe(true);
});

test('new-model compact split bar names No Allocation in its readout', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__oneLane.mount('split', { pair: 'allocation', compact: true }));
    await expect(page.locator('#split .planning-compact-readout')).toHaveText('Product 8.0 · Tech 8.0 · No Allocation 7.0 SP');
});

test('Legacy split bar still reports Product and Tech', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__oneLane.mount('split', { pair: 'ordinary' }));
    const text = (await page.locator('#split').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Product');
    expect(text).not.toContain('No Allocation');
    await expect(page.locator('#split .project-bar-fill.none')).toHaveCount(0);
    await expect(page.locator('#split [data-work-lane="combined"]')).toHaveCount(0);
    await expect(page.locator('#split .capacity-bar-marker')).toHaveCount(1);
});

test('alerts: the three parent-hygiene panels are retired for the combined model and kept for Legacy; titles use actual names', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__oneLane.mount('alerts', { workModel: 'rnd_2027' }));
    for (const id of ['eng-alert-backlog', 'eng-alert-missing-team', 'eng-alert-missing-labels']) {
        await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
    await expect(page.locator('#eng-alert-empty .alert-title')).toContainText('Empty Initiative');
    await expect(page.locator('.alerts-panel-summary-pill', { hasText: /Backlog|Missing team|Missing labels/i })).toHaveCount(0);
    await expect(page.locator('.alerts-panel-summary-pill', { hasText: 'Empty initiative' })).toHaveCount(1);

    await page.evaluate(() => window.__oneLane.mount('alerts', { workModel: undefined }));
    for (const id of ['eng-alert-backlog', 'eng-alert-missing-team', 'eng-alert-missing-labels']) {
        await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(page.locator('#eng-alert-empty .alert-title')).toContainText('Empty Epic');
});
