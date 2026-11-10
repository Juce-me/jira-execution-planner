// Task 4B/4C/4D UI proof for the combined `rnd_2027` lane, against fully mocked routes (no Jira, no DB, no server).
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

test('Projects (Product/Tech) facet is hidden for the combined model and present for Legacy', async ({ page }) => {
    await openHarness(page);
    for (const [workModel, expectedFacet] of [['rnd_2027', 0], [undefined, 1]]) {
        await page.evaluate(model => window.__oneLane.mount('filters', { workModel: model }), workModel);
        await page.getByRole('button', { name: /Filters/ }).click();
        await expect(page.locator('.pop-group[data-facet="projects"]')).toHaveCount(expectedFacet);
        await expect(page.locator('.pop-group[data-facet="status"]')).toHaveCount(1);
        await page.keyboard.press('Escape');
    }
});

for (const [pair, selected, adHoc, excluded] of [['ordinary', '8.0', null, null], ['ad_hoc', '8.0', '8.0', null], ['excluded', null, null, '8.0']]) {
    test(`combined split bar: ${pair} 8-SP pair shows one lane, never Product/Tech and never 16 SP`, async ({ page }) => {
        await openHarness(page);
        await page.evaluate(arg => window.__oneLane.mount('split', arg), { workModel: 'rnd_2027', pair });
        const bar = page.locator('#split');
        const text = (await bar.innerText()).replace(/\s+/g, ' ');
        expect(text).not.toMatch(/Product|Tech|16\.0/);
        if (selected) {
            await expect(page.locator('#split [data-work-lane="combined"]')).toHaveCount(1);
            expect(text).toContain(`Planned SP · ${selected} SP`);
            if (adHoc) expect(text).toContain(`Ad Hoc ${adHoc}`);
        } else {
            // Excluded work leaves the included allocation entirely; its 8 SP is the excluded report.
            const tooltip = await page.locator('#split .project-bar-fill.product').getAttribute('data-tooltip');
            expect(tooltip).toContain(`Excluded: ${excluded} SP`);
        }
    });
}

for (const compact of [false, true]) {
    test(`combined split bar (${compact ? 'compact' : 'full'}): no Product/Tech label, tooltip or 70/30 target marker anywhere in the DOM`, async ({ page }) => {
        await openHarness(page);
        await page.evaluate(arg => window.__oneLane.mount('split', arg), { workModel: 'rnd_2027', pair: 'ad_hoc', compact });
        await expect(page.locator('#split [data-work-lane="combined"]')).toHaveCount(1);
        await expect(page.locator('#split .capacity-bar-marker')).toHaveCount(0);
        await expect(page.locator('#split .planning-stat-label')).toHaveCount(0);
        const tooltips = await page.locator('#split [data-tooltip]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tooltip')));
        expect(tooltips.length).toBeGreaterThan(0);
        for (const tip of tooltips) expect(tip).not.toMatch(/Product|Tech|70|30%/);
    });
}

test('Legacy split bar still reports Product and Tech', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => window.__oneLane.mount('split', { workModel: undefined, pair: 'ordinary' }));
    const text = (await page.locator('#split').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Product');
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
