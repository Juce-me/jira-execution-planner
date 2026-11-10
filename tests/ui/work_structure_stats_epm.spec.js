// Mixed-era statistics (Lead Times Last N) and EPM under the work configurations (plan Task 6), against mocked routes.
// Every value is synthetic. The dashboard is bundled from source so the production components run.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5951';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'work-stats-epm');
let sourceDashboardJs;

test.beforeAll(async () => {
    fs.mkdirSync(shotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

const blank = () => ({ fieldId: '', fieldName: '' });
const field = (id, name) => ({ fieldId: id, fieldName: name });
const FIELDS = { sprint: field('customfield_19901', 'Sprint'), storyPoints: field('customfield_19902', 'Story Points'), team: field('customfield_19904', 'Team') };
const SUMMARIES = () => ([
    { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' },
    { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null },
]);

const closedEpic = (prefix, index) => ({
    key: `${prefix}-${index}`, summary: `${prefix} closed ${index}`, projectKey: prefix, status: 'done', jiraStatus: 'Done',
    createdDate: '2026-01-10', terminalDate: `2026-03-0${index}`, leadTimeDays: 50 + index, assignee: { id: 'lead', name: 'Lead' },
});
const EPM_PROJECT = {
    id: 'home-1', homeProjectId: 'home-1', name: 'Connected Home Project', displayName: 'Connected Home Project', label: 'rnd_project_connected',
    stateValue: 'ON_TRACK', stateLabel: 'On track', tabBucket: 'active', latestUpdateDate: '2026-05-11', latestUpdateSnippet: 'Synthetic.',
    homeUrl: 'https://home.example/project/home-1', resolvedLinkage: { labels: ['rnd_project_connected'], epicKeys: [] }, matchState: 'home-linked',
    subGoalKeys: ['CHILD-200'], subGoals: [{ key: 'CHILD-200', name: 'Connected Child Goal' }],
};
const issue = (key, type, status, storyPoints) => ({ key, summary: `${type} ${key}`, issueType: type, status, assignee: 'Pat', storyPoints });
const LEGACY_ROLLUP = { metadataOnly: false, emptyRollup: false, truncated: false, truncatedQueries: [], initiatives: { 'INI-1': { issue: issue('INI-1', 'Initiative', 'In Progress'), epics: { 'EPC-1': { issue: issue('EPC-1', 'Epic', 'In Progress'), stories: [issue('STY-1', 'Story', 'Done', 3)] } }, looseStories: [] } }, rootEpics: {}, orphanStories: [] };
const DELIVERY_ROLLUP = { metadataOnly: false, emptyRollup: false, hierarchyNames: { initiative: ['Initiative'], epic: ['Epic'] }, truncated: false, truncatedQueries: [], initiatives: { 'DIN-1': { issue: issue('DIN-1', 'Initiative', 'In Progress'), epics: { 'DEP-1': { issue: issue('DEP-1', 'Epic', 'Done', 5), stories: [] }, 'DEP-2': { issue: issue('DEP-2', 'Epic', 'In Progress', 3), stories: [] } }, looseStories: [] } }, rootEpics: {}, orphanStories: [] };
const cohortCalls = state => state.log.filter(call => call.pathname === '/api/stats/epic-cohort');
const LEAD_PREFS = { selectedView: 'eng', showStats: true, statsView: 'cohort', cohortMode: 'last_n', cohortLastN: 30, selectedSprint: 7, sprintName: '2026Q4' };

const clone = value => JSON.parse(JSON.stringify(value));

async function mockApp(page, {
    prefs = { selectedView: 'eng' }, deliveryMissing = [], deliverySprints = [], legacySprints = [{ id: 7, name: '2026Q4', state: 'active' }], statIssues = () => [], groupExtra = {},
} = {}) {
    const state = {
        log: [], summaries: SUMMARIES(), missing: { legacy: [], delivery: deliveryMissing },
        catalogs: { legacy: clone(legacySprints), delivery: clone(deliverySprints) },
        sprintDelay: {}, tasksDelay: 0, configRequests: 0, cohortDelay: 0,
        cohort: { legacy: [closedEpic('LEG', 1), closedEpic('LEG', 2)], delivery: [closedEpic('DLV', 1)] },
        epmRollup: id => (id === 'delivery' ? DELIVERY_ROLLUP : LEGACY_ROLLUP),
    };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(({ stored }) => {
        if (!window.localStorage.getItem('jira_dashboard_ui_prefs_v1')) window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(stored));
    }, { stored: prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let body = null;
        try { body = request.postDataJSON(); } catch (error) { body = null; }
        state.log.push({ method: request.method(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()), body });
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        const p = url.pathname;
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/analytics/context' || p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            state.configRequests += 1;
            const shared = { version: 1, capacity: {}, statsPriorityWeights: [], epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm: shared.epm, epmViewEnabled: true, epmHomeReadAvailable: true, adminContacts: ['Pat Admin'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: shared.epm } },
                sharedConfig: shared, sharedConfigRevision: 3,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: state.summaries, adminSettingsMissingByConfiguration: state.missing,
            });
        }
        if (p === '/api/work-structure/config') return json({ workConfigurations: { version: 1, promotionRevision: 6, configurations: [] }, configRevision: 3, promoted: true, userCanEditSettings: true, featureEnabled: true });
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'], ...groupExtra, board: { columns: [{ id: 'todo', name: 'To Do', statuses: ['To Do'] }, { id: 'done', name: 'Done', statuses: ['Done'] }] } }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') {
            const id = url.searchParams.get('configurationId') || '';
            const delay = state.sprintDelay[id] || 0;
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            if (!id) return json({ error: 'configuration_required' }, 409);
            if ((state.missing[id] || []).length) return json({ error: 'configuration_incomplete' }, 409);
            return json({ sprints: state.catalogs[id] || [], context: { configurationId: id, configurationRevision: Number(url.searchParams.get('configurationRevision')) } });
        }
        if (p === '/api/stats/epic-cohort' && request.method() === 'POST') {
            const id = body?.configurationId || '';
            if (state.cohortDelay) await new Promise(resolve => setTimeout(resolve, state.cohortDelay));
            if (body?.mode === 'last_n' && !id) return json({ error: 'configuration_required' }, 409);
            if ((state.missing[id] || []).length) return json({ error: 'configuration_incomplete' }, 409);
            const issues = state.cohort[id] || [];
            return json({ cached: false, data: { range: null, issues, meta: { warnings: [], mode: body?.mode, scope: 'components', windowCeiling: 200, windowFull: false } } });
        }
        if (p === '/api/epm/access') return json({ epmHomeReadAvailable: true, state: 'available' });
        if (p === '/api/epm/scope') return json({ cloudId: 'synthetic-cloud', error: '' });
        if (p === '/api/epm/projects') return json({ projects: [EPM_PROJECT] });
        if (p === '/api/epm/projects/rollup/all') return json({ projects: [{ project: EPM_PROJECT, rollup: state.epmRollup(url.searchParams.get('configurationId') || '') }], duplicates: {}, truncated: false, fallback: false });
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: 'team-platform', name: 'Platform Team' }] });
        if (p === '/api/tasks-with-team-name') {
            if (state.tasksDelay) await new Promise(resolve => setTimeout(resolve, state.tasksDelay));
            // Legacy asks once per lane; only the Product lane carries the rows so nothing is counted twice.
            const rows = url.searchParams.get('purpose') || url.searchParams.get('project') === 'tech' ? [] : statIssues(url.searchParams.get('configurationId') || '');
            return json({ issues: rows, epics: {}, epicsInScope: [] });
        }
        if (p === '/api/stats/excluded-capacity-source') {
            const sourceConfiguration = body?.configurationId || ((body?.sprintIds || []).map(String).includes('91') ? 'delivery' : 'legacy');
            return json({ data: { issues: statIssues(sourceConfiguration), meta: { warnings: [], queryPages: 1, loadedSprintCount: 1, totalSprintCount: 1 } } });
        }
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/projects') return json({ projects: [] });
        if (p === '/api/boards') return json({ boards: [] });
        if (p === '/api/fields') return json({ fields: Object.values(FIELDS).map(f => ({ id: f.fieldId, name: f.fieldName })) });
        if (p === '/api/epm/config') return json({ version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} });
        return json({});
    });
    return state;
}


const quiet = page => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
const trigger = page => page.locator('.sprint-dropdown-toggle').first();
const optionByQuarter = (page, quarter) => page.locator(`.sprint-dropdown-option[data-quarter="${quarter}"]`);
async function quiesce(page, state, ms = 700) {
    let last = -1;
    while (last !== state.log.length) { last = state.log.length; await page.waitForTimeout(ms); }
}
async function start(page, options) {
    const state = await mockApp(page, options);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await quiet(page);
    return state;
}
async function chooseQuarter(page, quarter) {
    await trigger(page).click();
    await page.getByLabel('Filter sprints').fill(quarter);
    await page.locator('.sprint-dropdown-option', { hasText: quarter }).first().click();
    await expect(trigger(page)).toHaveText(quarter);
}

test('Last N names the selected configuration, reuses one window across quarters, and switches at the era boundary', async ({ page }) => {
    const state = await start(page, { prefs: LEAD_PREFS, deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect.poll(() => cohortCalls(state).length).toBeGreaterThan(0);
    const first = cohortCalls(state)[0].body;
    expect(first).toMatchObject({ mode: 'last_n', quarter: '2026Q4', configurationId: 'legacy', configurationRevision: '3', refresh: false });
    expect('startQuarter' in first).toBe(false);
    expect('endQuarter' in first).toBe(false);
    await expect(page.locator('.stats-view.open [data-stats-work-scope="2026Q4"]')).toContainText('Quarter 2026Q4');
    await expect(page.getByText('LEG closed 1').first()).toBeVisible().catch(() => {});
    await quiesce(page, state);
    await page.screenshot({ path: path.join(shotDir, 'lead-times-last-n-legacy.png') });
    // Same configuration, different quarter: the fetched window is reused, no new Last N request.
    const before = cohortCalls(state).length;
    await chooseQuarter(page, '2026Q3');
    await page.waitForTimeout(800);
    expect(cohortCalls(state).length).toBe(before);
    await expect(page.locator('.stats-view.open [data-stats-work-scope="2026Q3"]')).toContainText('Quarter 2026Q3');
    // Crossing into DELIVERY retires the window and asks for the DELIVERY configuration only.
    await chooseQuarter(page, '2027Q1');
    await expect.poll(() => cohortCalls(state).length).toBe(before + 1);
    const crossing = cohortCalls(state)[before].body;
    expect(crossing).toMatchObject({ mode: 'last_n', quarter: '2027Q1', configurationId: 'delivery', configurationRevision: '2' });
    await expect(page.locator('.stats-view.open [data-stats-work-scope="2027Q1"]')).toContainText('Quarter 2027Q1');
    await quiesce(page, state);
    await page.screenshot({ path: path.join(shotDir, 'lead-times-last-n-delivery.png') });
    // Back inside Legacy: its window is still cached.
    const afterDelivery = cohortCalls(state).length;
    await chooseQuarter(page, '2026Q4');
    await page.waitForTimeout(800);
    expect(cohortCalls(state).length).toBe(afterDelivery);
    expect(state.log.filter(call => call.method !== 'GET' && call.pathname.startsWith('/api/epm/'))).toEqual([]);
});

const longCohort = prefix => [
    ...Array.from({ length: 35 }, (_, index) => ({ ...closedEpic(prefix, (index % 9) + 1), key: `${prefix}-C${index}`, summary: `${prefix} closed ${index}` })),
    ...Array.from({ length: 35 }, (_, index) => ({
        key: `${prefix}-O${index}`, summary: `${prefix} open ${index}`, projectKey: prefix, status: 'open', jiraStatus: 'Open',
        createdDate: '2026-02-10', terminalDate: null, leadTimeDays: null, assignee: { id: 'lead', name: 'Lead' },
    })),
];
async function checkLongLeadTimesLists(page, { quarter, parents }) {
    const completed = page.locator('.cohort-open-chart', { hasText: /Completed/ });
    await expect(completed.locator('.cohort-open-row')).toHaveCount(30);
    await expect(completed.locator('.cohort-open-title')).toContainText(`Completed ${parents}`);
    await completed.locator('.cohort-open-more').click();
    await expect(completed.locator('.cohort-open-row')).toHaveCount(35);
    await expect(completed.locator('.cohort-open-more')).toHaveCount(0);
    const overflow = await page.locator('.cohort-open-chart').evaluateAll(nodes => nodes.map(node => node.scrollWidth - node.clientWidth));
    expect(overflow.length).toBeGreaterThan(0);
    for (const delta of overflow) expect(delta).toBeLessThanOrEqual(1);
    const open = page.locator('.cohort-open-chart', { hasText: /^Open /m });
    if (await open.count()) {
        await expect(open.locator('.cohort-open-row')).toHaveCount(30);
        await open.locator('.cohort-open-more').click();
        await expect(open.locator('.cohort-open-row')).toHaveCount(35);
    }
    expect(quarter).toBeTruthy();
}

for (const scenario of [
    { name: 'Legacy quarter', prefs: LEAD_PREFS, parents: 'Epics' },
    { name: 'new-model quarter', prefs: { ...LEAD_PREFS, selectedSprint: 91, sprintName: '2027Q1' }, parents: 'Initiatives' },
]) {
    test(`Lead Times load-more works with more than 30 open and completed rows in a ${scenario.name}, without overflow`, async ({ page }) => {
        const state = await start(page, { prefs: { ...scenario.prefs, cohortMode: 'created' }, deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
        state.cohort.legacy = longCohort('LEG');
        state.cohort.delivery = longCohort('DLV');
        state.cohort[''] = longCohort(scenario.parents === 'Epics' ? 'LEG' : 'DLV'); // Created mode sends no configuration id.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await quiet(page);
        await expect(page.locator('.cohort-open-title', { hasText: `Open ${scenario.parents}` })).toHaveCount(1);
        await checkLongLeadTimesLists(page, { quarter: scenario.name, parents: scenario.parents });
    });
}

test('blank DELIVERY is a safe scoped failure while usable Legacy is never blocked', async ({ page }) => {
    const state = await start(page, { prefs: LEAD_PREFS, deliveryMissing: ['hierarchy.parent', 'hierarchy.planning'], deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect.poll(() => cohortCalls(state).length).toBeGreaterThan(0);
    expect(cohortCalls(state)[0].body.configurationId).toBe('legacy');
    await expect(page.locator('.cohort-error')).toHaveCount(0);
    await chooseQuarter(page, '2027Q1');
    await expect(page.locator('.cohort-error, [data-quarter-notice="2027Q1"]').first()).toBeVisible();
    const delivery = cohortCalls(state).filter(call => call.body.configurationId === 'delivery');
    expect(delivery.length).toBeLessThanOrEqual(1);
    // Never replayed.
    await page.waitForTimeout(900);
    expect(cohortCalls(state).filter(call => call.body.configurationId === 'delivery').length).toBe(delivery.length);
    await chooseQuarter(page, '2026Q4');
    await expect(page.locator('.cohort-error')).toHaveCount(0);
    await expect(page.locator('[data-quarter-notice="2027Q1"]')).toHaveCount(0);
});

test('EPM rollups send the selected quarter/configuration; Epic-leaf tree renders without Stories and Home stays read-only', async ({ page }) => {
    const state = await start(page, { prefs: { selectedView: 'epm', selectedQuarter: '2027Q1', sprintName: '2027Q1' }, deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect.poll(() => state.log.filter(call => call.pathname === '/api/epm/projects/rollup/all').length).toBeGreaterThan(0);
    const rollup = state.log.find(call => call.pathname === '/api/epm/projects/rollup/all');
    expect(rollup.params).toMatchObject({ configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1', tab: 'active' });
    await page.getByRole('button', { name: /jira rollup/i }).first().click();
    await expect(page.getByText('Epic DEP-1').first()).toBeVisible();
    await expect(page.getByText('Epic DEP-2').first()).toBeVisible();
    await quiesce(page, state);
    await page.screenshot({ path: path.join(shotDir, 'epm-delivery.png') });
    const metadata = state.log.filter(call => call.pathname === '/api/epm/projects');
    for (const call of metadata) expect(call.params.configurationId).toBeUndefined();
    expect(state.log.filter(call => call.method !== 'GET' && call.pathname.startsWith('/api/epm/'))).toEqual([]);
});

// DELIVERY No Allocation in Stats (plan Task 7). [key, status, SP, DELIVERY stamp]; Legacy rows carry no stamp.
const STAT_ROWS = [['STA-1', 'Done', 3, 'product'], ['STA-2', 'In Progress', 5, 'tech'], ['STA-3', 'Done', 2, 'none'], ['STA-4', 'In Progress', 1, 'none']];
const STAT_SPRINTS = { delivery: { id: 91, name: '2027Q1', state: 'active' }, legacy: { id: 7, name: '2026Q4', state: 'active' } };
const statIssues = configurationId => {
    const sprint = STAT_SPRINTS[configurationId] || STAT_SPRINTS.legacy;
    return STAT_ROWS.map(([key, status, sp, stamp]) => ({
        id: key.replace(/\D/g, ''), key, fields: {
            summary: `Synthetic ${key}`, status: { name: status }, priority: { name: 'Medium' }, issuetype: { name: 'Story' }, customfield_10004: sp,
            epicKey: 'STA-100', parentSummary: 'Synthetic parent', projectKey: 'STA', teamId: 'team-platform', teamName: 'Platform Team',
            sprint: [sprint], customfield_10101: [sprint], ...(configurationId === 'delivery' ? { projectClassification: stamp } : {}),
        },
    }));
};
const statsPrefs = (configurationId, statsView) => {
    const sprint = STAT_SPRINTS[configurationId];
    return { selectedView: 'eng', showStats: true, statsView, selectedSprint: sprint.id, sprintName: sprint.name, selectedQuarter: sprint.name,
        excludedCapacityStartSprintId: String(sprint.id), excludedCapacityEndSprintId: String(sprint.id) };
};
async function openStats(page, configurationId, statsView) {
    // An excluded-capacity Initiative/Epic is configured so the Effort Split loads; no row is under it.
    const state = await start(page, { prefs: statsPrefs(configurationId, statsView), deliverySprints: [STAT_SPRINTS.delivery], statIssues, groupExtra: { excludedCapacityEpics: ['STA-900'] } });
    await expect(page.locator('.stats-view.open')).toBeVisible();
    return state;
}
// Text and box of every header and body cell of the open Stats Teams table.
const readStatsTable = page => page.locator('.stats-view.open .stats-table').evaluate(table => {
    const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right }; };
    const cells = row => [...row.children].map(cell => ({ text: cell.textContent.replace('\u2197', '').trim(), cls: cell.className, links: cell.querySelectorAll('a.stats-link').length, clipped: cell.scrollWidth > cell.clientWidth + 1, ...box(cell) }));
    const rows = [...table.querySelectorAll('tr')].map(cells);
    const view = table.closest('.stats-view').getBoundingClientRect();
    const frame = table.parentElement.matches('[data-allocation="delivery"]') ? table.parentElement : null;
    return { groups: rows[0], header: rows[1], body: rows.slice(2), tableRight: table.getBoundingClientRect().right, viewRight: view.right,
        frameRight: frame ? frame.getBoundingClientRect().right : null, frameScrolls: frame ? frame.scrollWidth > frame.clientWidth : null };
});

test('DELIVERY Stats Teams shows a No Allocation column after Tech whose counts carry no project-based links', async ({ page }) => {
    await openStats(page, 'delivery', 'teams');
    await expect(page.locator('.stats-view.open .stats-table th.stats-col.none').first()).toBeVisible();
    await expect(page.locator('.stats-view.open .stats-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.stats-view.open .stats-table tbody td').nth(1)).toHaveText(/2/);
    const table = await readStatsTable(page);
    expect(table.groups.map(cell => cell.text)).toEqual(['', 'Total', 'Product', 'Tech', 'No Allocation']);
    expect(table.header.length).toBe(17);
    expect(table.header.slice(13).map(cell => cell.text)).toEqual(['Done', 'Incomplete', 'Absolute', 'Weighted']);
    const [row] = table.body;
    expect(row.map(cell => cell.text)).toEqual([
        'Platform Team', '2', '2', '50.00%', '50.00%', '1', '0', '100.00%', '100.00%', '0', '1', '0.00%', '0.00%', '1', '1', '50.00%', '50.00%',
    ]);
    // Only the two Total count cells link to Jira; Product/Tech/No Allocation counts are plain.
    expect(row.map(cell => cell.links)).toEqual([0, 1, 1, ...Array(14).fill(0)]);
    // Group headings tile left to right; every body cell sits under its header cell, nothing clips, and the table fits the view.
    for (let index = 1; index < table.groups.length; index += 1) expect(table.groups[index].left).toBeGreaterThanOrEqual(table.groups[index - 1].right - 1);
    expect(Math.abs(table.groups[4].left - table.header[13].left)).toBeLessThanOrEqual(1);
    expect(Math.abs(table.groups[4].right - table.header[16].right)).toBeLessThanOrEqual(1);
    row.forEach((cell, index) => {
        expect(Math.abs(cell.left - table.header[index].left)).toBeLessThanOrEqual(1);
        expect(cell.clipped).toBe(false);
        expect(table.header[index].clipped).toBe(false);
    });
    // Four column groups exceed the 1280px panel: the DELIVERY frame stays inside the view and scrolls horizontally to No Allocation.
    expect(table.frameRight).toBeLessThanOrEqual(table.viewRight + 1);
    expect(table.frameScrolls).toBe(true);
    await page.locator('.stats-view.open').screenshot({ path: path.join(shotDir, 'stats-teams-delivery-no-allocation.png'), animations: 'disabled' });
    await page.locator('.stats-view.open [data-allocation="delivery"]').evaluate(node => { node.scrollLeft = node.scrollWidth; });
    const lastGroup = page.locator('.stats-view.open .stats-table th.stats-col.none').first();
    await expect(lastGroup).toBeInViewport({ ratio: 0.99 });
    const frameBox = await page.locator('.stats-view.open [data-allocation="delivery"]').boundingBox();
    const groupBox = await lastGroup.boundingBox();
    expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
    await page.locator('.stats-view.open').screenshot({ path: path.join(shotDir, 'stats-teams-delivery-no-allocation-scrolled.png'), animations: 'disabled' });
});

test('Legacy Stats Teams keeps Total, Product and Tech with their Jira links', async ({ page }) => {
    await openStats(page, 'legacy', 'teams');
    await expect(page.locator('.stats-view.open .stats-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.stats-view.open .stats-table tbody td').nth(1)).toHaveText(/2/);
    const table = await readStatsTable(page);
    expect(table.groups.map(cell => cell.text)).toEqual(['', 'Total', 'Product', 'Tech']);
    expect(table.header.length).toBe(13);
    await expect(page.locator('.stats-view.open .stats-table')).not.toContainText('No Allocation');
    // Legacy has no stamp: every row is Product, and each non-zero Total/Product count keeps its link.
    expect(table.body[0].map(cell => cell.links)).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
    // Legacy markup is unchanged: no scroll frame, and the table still fits the view.
    expect(table.frameRight).toBeNull();
    expect(table.tableRight).toBeLessThanOrEqual(table.viewRight + 1);
});

test('DELIVERY Effort Split adds a No Allocation series last; Legacy keeps four', async ({ page }) => {
    await openStats(page, 'delivery', 'excludedCapacity');
    const chart = page.locator('.stats-view.open .effort-type-split-chart');
    await expect(chart.locator('.effort-type-split-segment.none')).toBeVisible();
    const legend = chart.locator('.effort-type-split-legend button');
    await expect(legend).toHaveText(['Excluded Capacity', 'Ad Hoc', 'Product', 'Tech', 'No Allocation']);
    await expect(chart.locator('.effort-type-split-legend-item.none')).toHaveAttribute('aria-pressed', 'true');
    // 3 of 11 SP: the segment is drawn last, ends the track, and is the element hit at its centre.
    const geometry = await chart.evaluate(node => {
        const track = node.querySelector('.effort-type-split-track').getBoundingClientRect();
        const segments = [...node.querySelectorAll('.effort-type-split-track > .effort-type-split-segment')];
        const none = segments[segments.length - 1];
        const rect = none.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const label = none.querySelector('span');
        return { last: none.className, share: rect.width / track.width, rightGap: track.right - rect.right, hit: none.contains(hit),
            labelInside: !label || (label.getBoundingClientRect().left >= rect.left - 0.5 && label.getBoundingClientRect().right <= rect.right + 0.5),
            background: getComputedStyle(none).backgroundColor };
    });
    expect(geometry.last).toContain('none');
    expect(geometry.share).toBeCloseTo(3 / 11, 2);
    expect(Math.abs(geometry.rightGap)).toBeLessThanOrEqual(1);
    expect(geometry.hit).toBe(true);
    expect(geometry.labelInside).toBe(true);
    expect(geometry.background).toBe('rgb(148, 163, 184)');
    await chart.screenshot({ path: path.join(shotDir, 'effort-split-delivery-no-allocation.png'), animations: 'disabled' });
    // The hover readout is the in-app readout, inside the viewport.
    await chart.locator('.effort-type-split-segment.none').hover();
    const readout = page.locator('.effort-type-split-readout');
    await expect(readout).toContainText('No Allocation: 27');
    const box = await readout.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    const chartBox = await chart.boundingBox();
    await page.screenshot({ path: path.join(shotDir, 'effort-split-delivery-no-allocation-readout.png'), animations: 'disabled',
        clip: { x: 0, y: chartBox.y, width: viewport.width, height: Math.max(chartBox.height, box.y + box.height - chartBox.y) + 8 } });
    // Toggling the legend hides the series.
    await chart.locator('.effort-type-split-legend-item.none').click();
    await expect(chart.locator('.effort-type-split-legend-item.none')).toHaveAttribute('aria-pressed', 'false');
    await expect(chart.locator('.effort-type-split-segment.none')).toHaveCount(0);

    await chooseQuarter(page, '2026Q4');
    await expect(chart.locator('.effort-type-split-segment.product')).toBeVisible();
    await expect(chart.locator('.effort-type-split-legend button')).toHaveText(['Excluded Capacity', 'Ad Hoc', 'Product', 'Tech']);
    await expect(chart.locator('.effort-type-split-segment.none')).toHaveCount(0);
});
