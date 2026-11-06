// Sprint admission follows the configuration revision (stale-revision regression), against mocked routes that, like the
// real catalog route, answer 409 configuration_scope_changed to a stale configurationRevision.
// Every value is synthetic. The dashboard is bundled from source so the production components run.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5951';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'work-sprint-admission');
let sourceDashboardJs;

test.beforeAll(async () => {
    fs.mkdirSync(shotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

const field = (id, name) => ({ fieldId: id, fieldName: name });
const FIELDS = { sprint: field('customfield_19901', 'Sprint'), storyPoints: field('customfield_19902', 'Story Points'), team: field('customfield_19904', 'Team') };

async function mockApp(page, { prefs = { selectedView: 'eng', selectedQuarter: '2027Q1', sprintName: '2027Q1' }, rekeyedTeam = false } = {}) {
    const state = { log: [], revision: 2, legacyName: 'Legacy', posts: 0, sprints: [{ id: 45459, name: '2027Q1', state: 'active' }] };
    const bundle = () => ({
        version: 1, promotionRevision: 6,
        configurations: [{
            id: 'legacy', name: state.legacyName, revision: 3, fromQuarter: null, throughQuarter: '2026Q3', model: 'legacy',
            scope: { projects: [{ key: 'OLD', type: 'product' }], boardId: '7001' },
            legacyIssueTypeNames: ['Story'], legacyDisplayTypes: { parent: null, ancestor: null },
            legacyHierarchyModes: { parent: 'compatibility', ancestor: 'compatibility' },
            hierarchy: { planningIssueTypeId: null, parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
            fields: { sprint: field('customfield_19901', 'Sprint'), storyPoints: field('customfield_19902', 'Story Points'), parentName: { fieldId: '', fieldName: '' }, team: field('customfield_19904', 'Team'), projectTrack: { fieldId: '', fieldName: '' }, deliveryOwner: { fieldId: '', fieldName: '' } },
        }, {
            id: 'delivery', name: 'DELIVERY', revision: state.revision, fromQuarter: '2026Q4', throughQuarter: null, model: 'rnd_2027',
            scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '19095' },
            hierarchy: { planningIssueTypeId: '19002', parentIssueTypeId: '19003', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
            fields: { sprint: field('customfield_19901', 'Sprint'), storyPoints: field('customfield_19902', 'Story Points'), parentName: { fieldId: '', fieldName: '' }, team: field('customfield_19904', 'Team'), projectTrack: { fieldId: '', fieldName: '' }, deliveryOwner: { fieldId: '', fieldName: '' }, allocation: { fieldId: '', fieldName: '' } },
        }],
    });
    const summaries = () => ([
        { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q3' },
        { id: 'delivery', name: 'DELIVERY', revision: state.revision, model: 'rnd_2027', fromQuarter: '2026Q4', throughQuarter: null },
    ]);
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
            const shared = { version: 1, capacity: {}, statsPriorityWeights: [], epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm: shared.epm, adminContacts: ['Pat Admin'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: shared.epm } },
                sharedConfig: shared, sharedConfigRevision: 3,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: summaries(), adminSettingsMissingByConfiguration: { legacy: [], delivery: [] },
            });
        }
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'] }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/work-structure/config' && request.method() === 'GET') {
            return json({ workConfigurations: bundle(), configRevision: 3, promoted: true, userCanEditSettings: true, featureEnabled: true });
        }
        if (p === '/api/work-structure/config' && request.method() === 'POST') {
            // A Save bumps the revision of every changed configuration; the catalog route then refuses the old stamp.
            state.posts += 1;
            state.legacyName = request.postDataJSON().workConfigurations.configurations[0].name;
            state.revision += 1;
            return json({ workConfigurations: bundle(), configRevision: 4, changedConfigurationIds: ['legacy', 'delivery'], promoted: true });
        }
        if (p === '/api/work-structure/sprint-values') return json({ sprintValues: [], sources: [], promoted: true });
        if (p === '/api/issue-types') return json({ issueTypes: [], configurationId: url.searchParams.get('configurationId'), configurationRevision: Number(url.searchParams.get('configurationRevision')) });
        if (p === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') {
            const id = url.searchParams.get('configurationId') || '';
            if (!id) return json({ error: 'configuration_required' }, 409);
            // The real route compares the stamped revision with the stored one.
            const current = id === 'delivery' ? state.revision : 3;
            if (Number(url.searchParams.get('configurationRevision')) !== current) return json({ error: 'configuration_scope_changed' }, 409);
            return json({ sprints: id === 'delivery' ? state.sprints : [], context: { configurationId: id, configurationRevision: current } });
        }
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' }, ...(rekeyedTeam ? { 'team-new': { id: 'team-new', name: 'Platform Team' } } : {}) }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: rekeyedTeam ? 'team-new' : 'team-platform', name: 'Platform Team' }] });
        if (p === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
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
const notice = page => page.locator('[data-quarter-notice="2027Q1"]');
const work = state => state.log.filter(call => call.pathname === '/api/tasks-with-team-name');
const refresh = page => page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
async function start(page, options) {
    const state = await mockApp(page, options);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await quiet(page);
    return state;
}

test('a configured old Team ID warns when the selected Sprint has its same-name replacement', async ({ page }) => {
    await start(page, { rekeyedTeam: true });
    await expect.poll(() => page.locator('.sprint-dropdown-toggle').first().textContent()).toContain('2027Q1');
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    const warning = dialog.getByRole('status').filter({ hasText: 'Platform Team: this Team ID was not seen' });
    await expect(warning).toBeVisible();
    const chip = dialog.locator('.selected-team-chip').filter({ hasText: 'Platform Team' });
    await expect(chip).toContainText('not in selected Sprint');
    const warningNode = await warning.elementHandle();
    const chipNote = await chip.locator('.group-modal-meta').elementHandle();
    await warningNode.evaluate(node => { node.style.display = 'none'; });
    await chipNote.evaluate(node => { node.style.display = 'none'; });
    await dialog.screenshot({ path: path.join(shotDir, 'team-warning-before.png'), animations: 'disabled' });
    await warningNode.evaluate(node => { node.style.display = ''; });
    await chipNote.evaluate(node => { node.style.display = ''; });
    await dialog.screenshot({ path: path.join(shotDir, 'team-warning-after.png'), animations: 'disabled' });
});

test('cold load admits the Sprint the DELIVERY catalog holds for the viewed quarter', async ({ page }) => {
    const state = await start(page);
    await expect(trigger(page)).toHaveText('2027Q1');
    await expect.poll(() => work(state).filter(call => call.params.sprint === '45459').length).toBeGreaterThan(0);
    await expect(notice(page)).toHaveCount(0);
});

test('an external revision bump is picked up by the next Refresh without a page reload', async ({ page }) => {
    const state = await start(page);
    await expect.poll(() => work(state).filter(call => call.params.sprint === '45459').length).toBeGreaterThan(0);
    state.revision = 3;
    state.sprints = [{ id: 45459, name: '2027Q1', state: 'active' }, { id: 45460, name: '2027Q2', state: 'future' }];
    await refresh(page);
    await expect.poll(() => state.log.filter(call => call.pathname === '/api/sprints' && call.params.configurationRevision === '3').length).toBeGreaterThan(0);
    await expect(notice(page)).toHaveCount(0);
    await expect(trigger(page)).toHaveText('2027Q1');
    expect(state.log.filter(call => call.pathname === '/api/config').length).toBeGreaterThan(1);
});

test('a held stale revision recovers once and never loops on the configuration read', async ({ page }) => {
    const state = await start(page);
    await expect.poll(() => work(state).length).toBeGreaterThan(0);
    state.revision = 3;
    await refresh(page);
    await expect(notice(page)).toHaveCount(0);
    const reads = () => state.log.filter(call => call.pathname === '/api/config' || call.pathname === '/api/sprints').length;
    let last = -1;
    while (last !== reads()) { last = reads(); await page.waitForTimeout(700); }
    await page.waitForTimeout(1200);
    expect(reads()).toBe(last);
});

test('a Project config Save that bumps the revision admits the Sprint without a page reload', async ({ page }) => {
    const state = await start(page);
    await expect.poll(() => work(state).filter(call => call.params.sprint === '45459').length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Project config' }).click();
    await dialog.getByLabel('Configuration name').fill('Legacy 2026');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.posts).toBe(1);
    await expect.poll(() => state.log.filter(call => call.pathname === '/api/sprints' && call.params.configurationRevision === '3').length).toBeGreaterThan(0);
    await expect(notice(page)).toHaveCount(0);
    await expect(trigger(page)).toHaveText('2027Q1');
    await expect.poll(() => work(state).filter(call => call.params.configurationRevision === '3').length).toBeGreaterThan(0);
});
