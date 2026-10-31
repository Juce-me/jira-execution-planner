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
    prefs = { selectedView: 'eng' }, deliveryMissing = [], deliverySprints = [], legacySprints = [{ id: 7, name: '2026Q4', state: 'active' }],
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
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'], board: { columns: [{ id: 'todo', name: 'To Do', statuses: ['To Do'] }, { id: 'done', name: 'Done', statuses: ['Done'] }] } }],
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
            return json({ issues: [], epics: {}, epicsInScope: [] });
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
