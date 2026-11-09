// The Planned Teams Effort table shows a No Allocation column group only for the DELIVERY model, so Product + Tech +
// No Allocation equals Total; Legacy keeps its Product/Tech/Total markup. Mocked routes and synthetic values only; the built
// dashboard (`npm run build`) is served by the shared shell.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5964';
const SUMMARIES = [
    { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' },
    { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null,
        roleTypes: { planning: { id: '6', name: 'Epic', hierarchyLevel: 1 }, parent: { id: '11700', name: 'Initiative', hierarchyLevel: 2 }, ancestor: null, optionalAncestor: null } },
];
const SPRINTS = { delivery: { id: 91, name: '2027Q1', state: 'active' }, legacy: { id: 7, name: '2026Q4', state: 'active' } };
const TEAMS = [{ id: 'team-a', name: 'Alpha Team' }, { id: 'team-b', name: 'Beta Team' }];

// [key, team, SP, status, DELIVERY stamp]
const ROWS = [
    ['PLAN-1', 'team-a', 3, 'To Do', 'product'], ['PLAN-2', 'team-a', 5, 'To Do', 'tech'], ['PLAN-3', 'team-a', 2, 'To Do', 'none'],
    ['PLAN-4', 'team-a', 1, 'Accepted', 'none'], ['PLAN-5', 'team-b', 4, 'Postponed', 'none'], ['PLAN-6', 'team-b', 2, 'Accepted', 'product'],
];
const issue = ([key, teamId, sp, status, stamp], sprint, delivery) => ({
    id: key.replace(/\D/g, ''), key, fields: {
        summary: `Synthetic ${key}`, status: { name: status }, priority: { name: 'Medium' }, issuetype: { id: '6', name: 'Epic' },
        customfield_10004: sp, epicKey: 'PLAN-100', parentSummary: 'Synthetic parent', projectKey: 'PLAN', teamId,
        teamName: TEAMS.find(team => team.id === teamId).name, updated: '2027-01-12T12:00:00.000Z', sprint: [sprint],
        ...(delivery ? { projectClassification: stamp } : {}),
    },
});

async function mockApp(page, configurationId) {
    const sprint = SPRINTS[configurationId];
    const delivery = configurationId === 'delivery';
    await installDashboardShell(page);
    await page.addInitScript(stored => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(stored)), {
        selectedView: 'eng', selectedSprint: sprint.id, sprintName: sprint.name, selectedQuarter: sprint.name,
        showPlanning: true, planningLayout: 'list',
    });
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
            const shared = { version: 1, capacity: {}, statsPriorityWeights: [] };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, capacityProject: 'CAP', techProjects: ['TECH'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: {} },
                sharedConfig: shared, sharedConfigRevision: 3, workConfigurationsEnabled: true, workConfigurationsPromoted: true,
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
            // Legacy asks once per lane; only the Product lane carries the rows so nothing is counted twice.
            const rows = params.purpose || params.project === 'tech' ? [] : ROWS.map(item => issue(item, sprint, delivery));
            return json({ issues: rows, epics: { 'PLAN-100': { key: 'PLAN-100', summary: 'Synthetic parent', status: { name: 'In Progress' } } }, epicsInScope: [], names: {} });
        }
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/eng/story-readiness') return json({ schemaVersion: 1, complete: true, epics: [], scope: { groupId: params.groupId, sprint: params.sprint } });
        if (p === '/api/dependencies') return json({ dependencies: {} });
        if (p === '/api/capacity') return json({ capacity: {}, targets: {}, issueCount: 0, mutationEnabled: false });
        return json({});
    });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
}

// Text of every cell of the table, by row, with the grid columns each cell occupies.
async function readTable(page) {
    const grid = page.locator('.capacity-panel .capacity-grid');
    await expect(grid.locator('.capacity-row.capacity-divider').first()).toBeVisible();
    return grid.evaluate(node => ({
        allocation: node.getAttribute('data-allocation'),
        groups: [...node.querySelectorAll('.capacity-group-row .capacity-group-cell')].map(cell => ({ text: cell.textContent.trim(), left: cell.getBoundingClientRect().left, right: cell.getBoundingClientRect().right })),
        rows: [...node.querySelectorAll('.capacity-row')].map(row => [...row.children].map(cell => {
            const box = cell.getBoundingClientRect();
            return { text: cell.textContent.replace('↗', '').trim(), left: box.left, right: box.right, clipped: cell.scrollWidth > cell.clientWidth + 1 };
        })),
    }));
}

test('DELIVERY: the No Allocation column group sits between Tech and Total and the sides sum to Total', async ({ page }) => {
    await mockApp(page, 'delivery');
    const table = await readTable(page);
    expect(table.allocation).toBe('delivery');
    expect(table.groups.map(group => group.text)).toEqual(['Product', 'Tech', 'No Allocation', 'Total']);
    // Group headings are laid out left to right without overlap.
    for (let index = 1; index < table.groups.length; index += 1) expect(table.groups[index].left).toBeGreaterThanOrEqual(table.groups[index - 1].right - 1);
    const [, header, ...bodyRows] = table.rows;
    expect(header.map(cell => cell.text)).toEqual(['Team', ...Array(4).fill(['To Do / Pending', 'Postponed', 'Accepted']).flat()]);
    const values = row => row.slice(1).map(cell => Number(cell.text));
    const byTeam = Object.fromEntries(bodyRows.map(row => [row[0].text, values(row)]));
    // [Product todo, postponed, accepted, Tech ..., No Allocation ..., Total ...]
    expect(byTeam['Alpha Team']).toEqual([3, 0, 0, 5, 0, 0, 2, 0, 1, 10, 0, 1]);
    expect(byTeam['Beta Team']).toEqual([0, 0, 2, 0, 0, 0, 0, 4, 0, 0, 4, 2]);
    expect(byTeam.Total).toEqual([3, 0, 2, 5, 0, 0, 2, 4, 1, 10, 4, 3]);
    for (const row of Object.values(byTeam)) {
        for (let metric = 0; metric < 3; metric += 1) expect(row[metric] + row[3 + metric] + row[6 + metric]).toBeCloseTo(row[9 + metric], 5);
    }
    // Every row uses the same 13 columns: each cell sits exactly under its header cell, and no cell clips its text.
    for (const row of bodyRows) {
        expect(row.length).toBe(13);
        row.forEach((cell, index) => {
            expect(Math.abs(cell.left - header[index].left)).toBeLessThanOrEqual(1);
            expect(cell.clipped).toBe(false);
        });
    }
    await page.locator('.capacity-panel').screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'delivery-teams-effort-no-allocation.png'), animations: 'disabled' });
    // Four column groups exceed the panel at desktop width; the existing wrapper scrolls horizontally (tap/swipe) to Total.
    await page.locator('.capacity-panel .capacity-grid-wrapper').evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await expect(page.locator('.capacity-panel .capacity-group-cell.total')).toBeInViewport();
    await page.locator('.capacity-panel').screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'screenshots', 'delivery-teams-effort-no-allocation-scrolled.png'), animations: 'disabled' });
});

test('Legacy: the table keeps only Product, Tech and Total', async ({ page }) => {
    await mockApp(page, 'legacy');
    const table = await readTable(page);
    expect(table.allocation).toBeNull();
    expect(table.groups.map(group => group.text)).toEqual(['Product', 'Tech', 'Total']);
    for (const row of table.rows.slice(1)) expect(row.length).toBe(10);
    await expect(page.locator('.capacity-panel')).not.toContainText('No Allocation');
});
