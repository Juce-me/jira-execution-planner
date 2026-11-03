// Private quarter selection independent of the nullable physical Sprint (plan 3C), against mocked routes.
// Every value is synthetic. The dashboard is bundled from source so the production components run.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5951';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'work-quarter-selection');
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
const clone = value => JSON.parse(JSON.stringify(value));

async function mockApp(page, {
    prefs = { selectedView: 'eng' }, deliveryMissing = [], deliverySprints = [], legacySprints = [{ id: 7, name: '2026Q4', state: 'active' }],
    editor = true,
} = {}) {
    const state = {
        log: [], summaries: SUMMARIES(), missing: { legacy: [], delivery: deliveryMissing },
        catalogs: { legacy: clone(legacySprints), delivery: clone(deliverySprints) },
        sprintDelay: {}, catalogFail: {}, tasksDelay: 0, configRequests: 0,
    };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(({ stored }) => {
        if (!window.localStorage.getItem('jira_dashboard_ui_prefs_v1')) window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(stored));
    }, { stored: prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        state.log.push({ method: request.method(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()) });
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
                userCanEditSettings: editor, userCanEditEpmConfig: true, epm: shared.epm, adminContacts: ['Pat Admin'],
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
            if (state.catalogFail[id]) return json({ error: 'jira_unavailable' }, 503);
            if ((state.missing[id] || []).length) return json({ error: 'configuration_incomplete' }, 409);
            return json({ sprints: (state.catalogs[id] || []).map(row => ({ ...row, configurationId: id })), context: { configurationId: id, configurationRevision: Number(url.searchParams.get('configurationRevision')) } });
        }
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' }, 'team-dist': { id: 'team-dist', name: 'Distribution Team' } }, meta: {} });
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
const work = state => state.log.filter(call => ['/api/tasks-with-team-name', '/api/missing-info', '/api/eng/story-readiness'].includes(call.pathname));
// Waits until the initial multi-step load has stopped issuing requests.
async function quiesce(page, state, ms = 700) {
    let last = -1;
    while (last !== state.log.length) { last = state.log.length; await page.waitForTimeout(ms); }
}
const catalogCalls = state => state.log.filter(call => call.pathname === '/api/sprints');
// A catalog read always names one configuration with that configuration's own revision. The viewed configuration reads its
// catalog; the other configuration's catalog is read only with its own context to mark its Sprints' states in the dropdown.
const REVISIONS = { legacy: '3', delivery: '2' };
const expectOwnContext = (call) => {
    expect(Object.keys(REVISIONS)).toContain(call.params.configurationId);
    expect(call.params.configurationRevision).toBe(REVISIONS[call.params.configurationId]);
    expect(call.params.sprint).toBeUndefined();
};
const expectOwnContextCatalogCalls = state => catalogCalls(state).forEach(expectOwnContext);
async function openSelector(page) {
    await trigger(page).click();
    await expect(page.locator('.sprint-dropdown-panel')).toBeVisible();
}
const optionByQuarter = (page, quarter) => page.locator(`.sprint-dropdown-option[data-quarter="${quarter}"]`);
const noticeFor = (page, quarter) => page.locator(`[data-quarter-notice="${quarter}"]`);
async function start(page, options) {
    const state = await mockApp(page, options);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await quiet(page);
    return state;
}

test('cold load restores 2027Q1 with only Legacy 2026Q4 admitted: no fabricated id, no Sprint-bound work', async ({ page }) => {
    const state = await start(page, { prefs: { selectedView: 'eng', selectedSprint: 7, sprintName: '2026Q4', selectedQuarter: '2027Q1' } });
    await expect(trigger(page)).toHaveText('2027Q1');
    const notice = noticeFor(page, '2027Q1');
    await expect(notice).toContainText('No Jira Sprint has been observed for this quarter; refresh or choose a source Board.');
    await expect(notice.getByRole('button', { name: 'Open admin settings' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The retained 2026Q4 id is never sent; the viewed catalog is DELIVERY's and no catalog read is unscoped or cross-stamped.
    expect(work(state)).toEqual([]);
    expect(catalogCalls(state).filter(call => call.params.configurationId === 'delivery').length).toBeGreaterThan(0);
    expectOwnContextCatalogCalls(state);
    expect(state.log.filter(call => /^2027Q1$/.test(call.params.sprint || ''))).toEqual([]);
    await openSelector(page);
    const row = optionByQuarter(page, '2027Q1');
    await expect(row).toHaveText('2027Q1 — not observed');
    await expect(row).not.toHaveAttribute('data-sprint-id', /.*/);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    // Legacy's own catalog marks its Sprint's state; the row is a quarter, never Legacy's id.
    await expect(optionByQuarter(page, '2026Q4')).toHaveText('[A] 2026Q4');
    await expect(optionByQuarter(page, '2026Q4')).not.toHaveAttribute('data-sprint-id', /.*/);
    await page.screenshot({ path: path.join(shotDir, 'restored-2027q1-dropdown.png') });
    await page.keyboard.press('Escape');
    await page.locator('[data-quarter-notice]').scrollIntoViewIfNeeded();
    await notice.screenshot({ path: path.join(shotDir, 'restored-2027q1-notice.png') });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')).selectedQuarter)).toBe('2027Q1');
});

test('explicit exact-quarter search selects an unavailable quarter without Settings navigation or invented requests', async ({ page }) => {
    const state = await start(page, { deliveryMissing: ['scope.projects', 'fields.sprint.fieldId'] });
    await expect(trigger(page)).toHaveText('2026Q4');
    await expect.poll(() => work(state).filter(call => call.params.sprint === '7').length).toBeGreaterThan(0);
    await quiesce(page, state);
    const before = state.log.length;
    await openSelector(page);
    // Lowercase or padded input never adds a row; an exact canonical quarter does.
    await page.getByLabel('Filter sprints').fill('2030q1');
    await expect(optionByQuarter(page, '2030Q1')).toHaveCount(0);
    await page.getByLabel('Filter sprints').fill('2030Q1');
    // 2030Q1 resolves to DELIVERY, whose setup is incomplete here.
    await expect(optionByQuarter(page, '2030Q1')).toHaveText('2030Q1 — setup required');
    await page.getByLabel('Filter sprints').fill('2027Q1');
    const unavailable = optionByQuarter(page, '2027Q1');
    await expect(unavailable).toHaveText('2027Q1 — setup required');
    await unavailable.click();
    await expect(trigger(page)).toHaveText('2027Q1');
    const notice = noticeFor(page, '2027Q1');
    await expect(notice).toContainText('DELIVERY is not ready for 2027Q1.');
    await expect(notice).toContainText('Missing: Jira projects, Sprint field.');
    await expect(notice).toContainText('No source is set up');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const afterSelection = state.log.slice(before);
    for (const call of afterSelection) {
        if (call.pathname === '/api/sprints') expectOwnContext(call);
        else if (['/api/tasks-with-team-name', '/api/missing-info'].includes(call.pathname)) throw new Error(`Sprint-bound work request after selecting an unavailable quarter: ${JSON.stringify(call)}`);
    }
    await page.screenshot({ path: path.join(shotDir, 'setup-required-notice.png') });
    await notice.getByRole('button', { name: 'Open admin settings' }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
});

test('a later real source record for the unchanged quarter is admitted; removal clears only the admission', async ({ page }) => {
    const state = await start(page, { prefs: { selectedView: 'eng', selectedQuarter: '2027Q1', sprintName: '2027Q1' } });
    await expect(noticeFor(page, '2027Q1')).toBeVisible();
    expect(work(state)).toEqual([]);
    state.catalogs.delivery = [{ id: 91, name: '2027Q1', state: 'future' }];
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
    await expect(noticeFor(page, '2027Q1')).toHaveCount(0);
    await expect.poll(() => work(state).filter(call => call.params.sprint === '91').length).toBeGreaterThan(0);
    for (const call of work(state)) {
        expect(call.params.configurationId).toBe('delivery');
        expect(call.params.configurationRevision).toBe('2');
        expect(call.params.quarter).toBe('2027Q1');
    }
    await expect(trigger(page)).toHaveText('2027Q1');
    // Source removal: the quarter stays visible, the physical admission and its work stop.
    state.catalogs.delivery = [];
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
    await expect(noticeFor(page, '2027Q1')).toBeVisible();
    await expect(trigger(page)).toHaveText('2027Q1');
    // The refresh itself may have started work for the Sprint before the catalog answered; once the admission
    // is cleared nothing further is requested for it.
    await page.waitForTimeout(500);
    const settled = work(state).length;
    await page.waitForTimeout(700);
    expect(work(state).length).toBe(settled);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')).selectedQuarter)).toBe('2027Q1');
});

test('Legacy to DELIVERY to Legacy keeps each era on its own configuration and Sprint', async ({ page }) => {
    const state = await start(page, { deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect(trigger(page)).toHaveText('2026Q4');
    await expect.poll(() => work(state).filter(call => call.params.sprint === '7').length).toBeGreaterThan(0);
    await openSelector(page);
    await expect(optionByQuarter(page, '2027Q1')).toHaveText('[F] 2027Q1');
    await optionByQuarter(page, '2027Q1').click();
    await expect(trigger(page)).toHaveText('2027Q1');
    await expect.poll(() => work(state).filter(call => call.params.sprint === '91').length).toBeGreaterThan(0);
    await openSelector(page);
    await page.locator('.sprint-dropdown-option', { hasText: '2027Q1' }).first().waitFor();
    await optionByQuarter(page, '2026Q4').click();
    await expect(trigger(page)).toHaveText('2026Q4');
    await expect.poll(() => work(state).filter(call => call.params.configurationId === 'legacy').length).toBeGreaterThan(1);
    for (const call of work(state)) {
        if (call.params.sprint === '91') expect(call.params.configurationId).toBe('delivery');
        if (call.params.sprint === '7') expect(call.params.configurationId).toBe('legacy');
    }
    // Each configuration's catalog was read under its own revision.
    expect(new Set(catalogCalls(state).map(call => `${call.params.configurationId}:${call.params.configurationRevision}`))).toEqual(new Set(['legacy:3', 'delivery:2']));
});

test('a non-editor sees the other configuration\'s quarter only while its own catalog read observes it', async ({ page }) => {
    const state = await start(page, { editor: false, deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    state.catalogFail.delivery = true;
    await expect(trigger(page)).toHaveText('2026Q4');
    await quiesce(page, state);
    await openSelector(page);
    // DELIVERY's read failed: no marker survives and the unobserved quarter is not offered to a non-editor.
    await expect(optionByQuarter(page, '2027Q1')).toHaveCount(0);
    expectOwnContextCatalogCalls(state);
    expect(work(state).filter(call => call.params.configurationId === 'delivery')).toEqual([]);
});

test('a non-editor sees an observed sibling quarter with its Sprint state', async ({ page }) => {
    const state = await start(page, { editor: false, deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect(trigger(page)).toHaveText('2026Q4');
    await openSelector(page);
    await expect(optionByQuarter(page, '2027Q1')).toHaveText('[F] 2027Q1');
    await expect(optionByQuarter(page, '2027Q1')).not.toHaveAttribute('data-sprint-id', /.*/);
    expectOwnContextCatalogCalls(state);
    expect(work(state).filter(call => call.params.configurationId === 'delivery')).toEqual([]);
});

test('a delayed catalog or task response for a configuration the user left is rejected', async ({ page }) => {
    const state = await start(page, { deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect(trigger(page)).toHaveText('2026Q4');
    await expect.poll(() => work(state).filter(call => call.params.sprint === '7').length).toBeGreaterThan(0);
    state.sprintDelay.delivery = 700;
    await openSelector(page);
    await optionByQuarter(page, '2027Q1').click();
    await expect(trigger(page)).toHaveText('2027Q1');
    // Back to Legacy before the delayed DELIVERY catalog arrives.
    state.sprintDelay.delivery = 0;
    await openSelector(page);
    await optionByQuarter(page, '2026Q4').click();
    await expect(trigger(page)).toHaveText('2026Q4');
    await page.waitForTimeout(1000);
    await expect(trigger(page)).toHaveText('2026Q4');
    expect(work(state).filter(call => call.params.sprint === '91')).toEqual([]);
    await expect(noticeFor(page, '2027Q1')).toHaveCount(0);
});

test('copy link: an unavailable quarter has no Sprint-backed payload; an admitted Sprint keeps the v1 link without context', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const state = await start(page, { deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }] });
    await expect.poll(() => work(state).filter(call => call.params.sprint === '7').length).toBeGreaterThan(0);
    const share = page.getByRole('button', { name: 'Copy view link' }).first();
    await share.click();
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    if (copied) {
        expect(copied).not.toMatch(/configurationId|configurationRevision|quarter=/);
        expect(copied).toMatch(/^http/);
    }
    await openSelector(page);
    await optionByQuarter(page, '2027Q1').click();
    await expect.poll(() => work(state).filter(call => call.params.sprint === '91').length).toBeGreaterThan(0);
    // Move to a quarter nothing has observed.
    await openSelector(page);
    await page.getByLabel('Filter sprints').fill('2027Q2');
    await optionByQuarter(page, '2027Q2').click();
    await expect(noticeFor(page, '2027Q2')).toBeVisible();
    // The existing disabled-share guidance applies; nothing is encoded or copied.
    const disabled = page.getByRole('button', { name: 'Copy view link' }).first();
    await expect(disabled).toBeDisabled();
    await expect(disabled).toHaveAttribute('title', /Sharing is available once the view has loaded/);
});

async function departmentTeamResult(page, name) {
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByPlaceholder('Search teams to add...').fill(name);
    const result = dialog.locator('.team-search-result-item', { hasText: name });
    await expect(result).toBeVisible();
    return result;
}

test('Department Teams in a Legacy quarter keep their rule: a Team without work in the selected Sprint is not addable', async ({ page }) => {
    const state = await start(page, {});
    await expect(trigger(page)).toHaveText('2026Q4');
    await quiesce(page, state);
    await expect(await departmentTeamResult(page, 'Distribution Team')).toBeDisabled();
});

test('Department Teams stay one list: a DELIVERY quarter never greys out Teams its Epics do not carry yet', async ({ page }) => {
    const state = await start(page, { deliverySprints: [{ id: 91, name: '2027Q1', state: 'future' }], prefs: { selectedView: 'eng', selectedQuarter: '2027Q1', sprintName: '2027Q1' } });
    await expect(trigger(page)).toHaveText('2027Q1');
    await quiesce(page, state);
    const result = await departmentTeamResult(page, 'Distribution Team');
    await expect(result).toBeEnabled();
    await expect(result).not.toHaveAttribute('title', /.+/);
});
