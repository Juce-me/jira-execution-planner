// DELIVERY Catch Up: the Product/Tech facet is the Initiative Allocation facet, built like Project Track (counted per
// Initiative, zero-count options shown, both unticked = "No Allocation only"), and that empty selection survives a reload.
// Legacy keeps its Projects facet. Mocked routes and synthetic values only; the built dashboard (`npm run build`) is
// served by the shared shell.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5965';
const PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const SUMMARIES = [
    { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' },
    { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null,
        roleTypes: { planning: { id: '6', name: 'Epic', hierarchyLevel: 1 }, parent: { id: '11700', name: 'Initiative', hierarchyLevel: 2 }, ancestor: null, optionalAncestor: null } },
];
const SPRINTS = { delivery: { id: 91, name: '2027Q1', state: 'active' }, legacy: { id: 7, name: '2026Q4', state: 'active' } };
const TEAMS = [{ id: 'team-a', name: 'Alpha Team' }];

// Initiatives: PLAN-101 Product, PLAN-102 Tech, PLAN-103 No Allocation. [key, Initiative, stamp]
const INITIATIVES = { 'PLAN-101': 'product', 'PLAN-102': 'tech', 'PLAN-103': 'none' };
const ROWS = [['PLAN-1', 'PLAN-101', 'product'], ['PLAN-2', 'PLAN-101', 'product'], ['PLAN-3', 'PLAN-102', 'tech'], ['PLAN-4', 'PLAN-103', 'none']];
const issue = ([key, epicKey, stamp], sprint, delivery) => ({
    id: key.replace(/\D/g, ''), key, fields: {
        summary: `Synthetic ${key}`, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { id: '6', name: 'Epic' },
        customfield_10004: 3, epicKey, parentSummary: `Synthetic ${epicKey}`, projectKey: 'PLAN', teamId: 'team-a',
        teamName: 'Alpha Team', updated: '2027-01-12T12:00:00.000Z', sprint: [sprint],
        ...(delivery ? { projectClassification: stamp } : {}),
    },
});
const epics = delivery => Object.fromEntries(Object.entries(INITIATIVES).map(([key, allocationClass], index) => [key, {
    key, summary: `Synthetic ${key}`, status: { name: 'In Progress' }, projectTrack: index === 0 ? 'Committed' : null,
    ...(delivery ? { allocationClass } : {}),
}]));

async function mockApp(page, configurationId) {
    const sprint = SPRINTS[configurationId];
    const delivery = configurationId === 'delivery';
    await installDashboardShell(page);
    // Seeded once: a reload must read what the dashboard itself saved.
    await page.addInitScript(([key, stored]) => {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(stored));
    }, [PREFS_KEY, { selectedView: 'eng', selectedSprint: sprint.id, sprintName: sprint.name, selectedQuarter: sprint.name, showPlanning: false }]);
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const params = Object.fromEntries(url.searchParams.entries());
        const p = url.pathname;
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/analytics/context' || p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, capacityProject: 'CAP', techProjects: ['TECH'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: {} },
                sharedConfig: { version: 1, capacity: {}, statsPriorityWeights: [] }, sharedConfigRevision: 3,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: SUMMARIES, adminSettingsMissingByConfiguration: { legacy: [], delivery: [] },
            });
        }
        if (p === '/api/work-structure/config') return json({ workConfigurations: { version: 1, promotionRevision: 6, configurations: [] }, configRevision: 3, promoted: true, userCanEditSettings: true, featureEnabled: true });
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: TEAMS.map(team => team.id), teamLabels: {} }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true,
                    completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
                    visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') {
            const id = params.configurationId || '';
            if (!id) return json({ error: 'configuration_required' }, 409);
            return json({ sprints: [{ ...SPRINTS[id], configurationId: id }], context: { configurationId: id, configurationRevision: Number(params.configurationRevision) } });
        }
        if (p === '/api/team-catalog') return json({ catalog: Object.fromEntries(TEAMS.map(team => [team.id, team])), meta: {} });
        if (p === '/api/teams') return json({ teams: TEAMS });
        if (p === '/api/tasks-with-team-name') {
            const rows = params.purpose || params.project === 'tech' ? [] : ROWS.map(item => issue(item, sprint, delivery));
            return json({ issues: rows, epics: epics(delivery), epicsInScope: [], names: {} });
        }
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/eng/story-readiness') return json({ schemaVersion: 1, complete: true, epics: [], scope: { groupId: params.groupId, sprint: params.sprint } });
        if (p === '/api/dependencies') return json({ dependencies: {} });
        if (p === '/api/capacity') return json({ capacity: {}, targets: {}, issueCount: 0, mutationEnabled: false });
        return json({});
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await settle(page);
}

async function settle(page) {
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await expect(page.locator('.task-item[data-task-key="PLAN-1"], .task-item[data-task-key="PLAN-4"]').first()).toBeVisible();
}

const popover = page => page.locator('.popover');
const group = (page, facetId) => popover(page).locator(`.pop-group[data-facet="${facetId}"]`);
const option = (page, facetId, optionId) => group(page, facetId).locator(`.pop-opt[data-option="${optionId}"]`);
const visibleKeys = page => page.locator('.task-item[data-task-key]').evaluateAll(nodes => nodes.map(node => node.dataset.taskKey).sort());

async function openFilters(page) {
    if (await popover(page).count() === 0) await page.locator('.fb-trigger').click();
    await expect(popover(page)).toBeVisible();
}

// Every text-bearing element of a facet group: its box, and whether its text overflows it.
async function readGroup(page, facetId) {
    return group(page, facetId).evaluate(node => {
        const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
        const text = [...node.querySelectorAll('.pop-facet, .pop-total, .pop-all, .pop-opt-label, .pop-opt .n, .pop-neutral')].map(element => ({
            cls: element.className, text: element.textContent.trim(), box: box(element), clipped: element.scrollWidth > element.clientWidth + 1,
        }));
        const options = [...node.querySelectorAll('.pop-opt')].map(element => ({
            id: element.dataset.option, text: element.textContent.trim(), box: box(element), check: box(element.querySelector('.box')),
            count: box(element.querySelector('.n')), content: box(element.querySelector('.pop-opt-content')), visual: Boolean(element.querySelector('.pop-opt-visual')),
        }));
        return { box: box(node), options, text };
    });
}

function expectInside(inner, outer) {
    expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
    expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
    expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.5);
    expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.5);
}

test('Allocation facet shows Product, Tech and No Allocation for the new model', async ({ page }) => {
    await mockApp(page, 'delivery');
    await openFilters(page);
    await expect(group(page, 'projects').locator('.pop-facet')).toHaveText('Allocation');
    // Counted per Initiative: two Product Epics are one Product Initiative.
    await expect(option(page, 'projects', 'product')).toContainText('Product');
    await expect(option(page, 'projects', 'product').locator('.n')).toHaveText('1');
    await expect(option(page, 'projects', 'tech').locator('.n')).toHaveText('1');
    await expect(group(page, 'projects').locator('.pop-total')).toHaveText('3');

    // The same component and geometry as Project Track: same column, same option row height, every text element inside.
    const allocation = await readGroup(page, 'projects');
    const track = await readGroup(page, 'track');
    expect(allocation.options.map(item => item.id)).toEqual(['product', 'tech']);
    expect(Math.abs(allocation.box.left - track.box.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(allocation.box.width - track.box.width)).toBeLessThanOrEqual(0.5);
    // Same row width, checkbox column and count column as Project Track. Project Track rows are taller only by their
    // emoji slot; Allocation, like Legacy Projects, has no option visual, and the Legacy test pins the two to one height.
    allocation.options.forEach((item, index) => {
        const reference = track.options[index];
        expect(item.visual).toBe(false);
        expect(reference.visual).toBe(true);
        expect(Math.abs(item.box.width - reference.box.width)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(item.check.left - reference.check.left)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(item.check.width - reference.check.width)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(item.count.right - reference.count.right)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(item.box.height - allocation.options[0].box.height)).toBeLessThanOrEqual(0.5);
    });
    for (const [facet, read] of [['projects', allocation], ['track', track]]) {
        for (const { box, clipped, text } of read.text) {
            expect(clipped, `${facet}: ${text}`).toBe(false);
            expectInside(box, read.box);
        }
    }
    await popover(page).screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'delivery-allocation-facet-neutral.png'), animations: 'disabled' });

    // Both unticked (a normal click each) is "No Allocation only", like No Project Track.
    await option(page, 'projects', 'product').click();
    await option(page, 'projects', 'tech').click();
    await expect(group(page, 'projects').locator('.pop-neutral')).toHaveText('No Allocation — showing epics under initiatives without a value');
    await expect(group(page, 'projects').locator('.pop-total')).toHaveText('1');
    const empty = await readGroup(page, 'projects');
    for (const { box, clipped, text } of empty.text) {
        expect(clipped, text).toBe(false);
        expectInside(box, empty.box);
    }
    await popover(page).screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'delivery-allocation-facet-empty.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.locator('.fb-chips .chip:not(.chip-more)')).toHaveAttribute('title', 'Allocation — only No Allocation');
    expect(await visibleKeys(page)).toEqual(['PLAN-4']);
});

test('allocation facet empty selection persists', async ({ page }) => {
    await mockApp(page, 'delivery');
    await openFilters(page);
    await option(page, 'projects', 'product').click();
    await option(page, 'projects', 'tech').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fb-chips .chip:not(.chip-more)')).toHaveAttribute('title', 'Allocation — only No Allocation');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    // Reload keeps "No Allocation only".
    await expect(page.locator('.fb-chips .chip:not(.chip-more)')).toHaveAttribute('title', 'Allocation — only No Allocation');
    expect(await visibleKeys(page)).toEqual(['PLAN-4']);
    await openFilters(page);
    await expect(option(page, 'projects', 'product')).toHaveAttribute('aria-pressed', 'false');
    await expect(option(page, 'projects', 'tech')).toHaveAttribute('aria-pressed', 'false');
    await expect(group(page, 'projects').locator('.pop-neutral')).toContainText('No Allocation');
});

test('Legacy keeps the Projects facet and never shows No Allocation', async ({ page, browser }) => {
    await mockApp(page, 'legacy');
    await openFilters(page);
    await expect(group(page, 'projects').locator('.pop-facet')).toHaveText('Projects');
    await expect(popover(page)).not.toContainText('No Allocation');
    const legacy = await readGroup(page, 'projects');
    // Its rows have the height of the DELIVERY Allocation rows, measured here in a separate context.
    const context = await browser.newContext();
    const deliveryPage = await context.newPage();
    await mockApp(deliveryPage, 'delivery');
    await openFilters(deliveryPage);
    const allocation = await readGroup(deliveryPage, 'projects');
    await context.close();
    expect(allocation.options.length).toBe(2);
    for (const item of legacy.options) expect(Math.abs(item.box.height - allocation.options[0].box.height)).toBeLessThanOrEqual(0.5);
    await popover(page).screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'legacy-projects-facet.png'), animations: 'disabled' });
    expect(await visibleKeys(page)).toEqual(['PLAN-1', 'PLAN-2', 'PLAN-3', 'PLAN-4']);
});
