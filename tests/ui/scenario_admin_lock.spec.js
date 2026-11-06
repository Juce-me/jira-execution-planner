// Scenario planner admin lock and new-model Scenario, against mocked routes. Every value is synthetic.
// The dashboard is bundled from source so the production components run.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5954';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'scenario-admin-lock');
let sourceDashboardJs;

test.beforeAll(async () => {
    fs.mkdirSync(shotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

const SUMMARIES = [
    { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' },
    { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null },
];
const CATALOGS = { legacy: [{ id: 7, name: '2026Q4', state: 'active' }], delivery: [{ id: 91, name: '2027Q1', state: 'active' }] };

// New-model Scenario source: Epics are the scheduled items, their parent Initiatives the lanes.
const scenarioPayload = () => ({
    jira_base_url: 'https://jira.example',
    config: { start_date: '2027-01-04', quarter_end_date: '2027-03-31', sprint: '2027Q1' },
    sprintBoundaries: null,
    summary: { late_items: [], critical_path: [], unschedulable: [], bottleneck_lanes: [] },
    dependencies: [{ from: 'PLAN-1', to: 'PLAN-2', type: 'block' }],
    capacity_by_team: { 'Platform Team': { size: 3 } },
    issues: [
        { key: 'PLAN-1', summary: 'Ingest pipeline epic', type: 'Epic', epicKey: 'PLAN-100', epicSummary: 'First initiative', team: 'Platform Team', assignee: 'Alex Example', sp: 5, start: '2027-01-04', end: '2027-01-29', scheduledReason: 'scheduled' },
        { key: 'PLAN-2', summary: 'Reporting epic', type: 'Epic', epicKey: 'PLAN-100', epicSummary: 'First initiative', team: 'Platform Team', assignee: 'Alex Example', sp: 3, start: '2027-02-01', end: '2027-02-19', scheduledReason: 'scheduled' },
        { key: 'PLAN-3', summary: 'Billing epic', type: 'Epic', epicKey: 'PLAN-200', epicSummary: 'Second initiative', team: 'Platform Team', assignee: 'Sam Example', sp: 2, start: '2027-01-11', end: '2027-01-22', scheduledReason: 'scheduled' },
    ],
});

async function mockApp(page, { editor, workspace, prefs = { selectedView: 'eng' } }) {
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(({ stored }) => {
        if (!window.localStorage.getItem('jira_dashboard_ui_prefs_v1')) window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(stored));
    }, { stored: prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const p = url.pathname;
        workspace.log.push({ method: request.method(), pathname: p, params: Object.fromEntries(url.searchParams.entries()), body: request.postDataJSON?.() ?? null });
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/admin/users') return json({ users: [{
            id: 'synthetic-admin', externalSubject: 'synthetic-admin-account',
            displayName: 'Synthetic Admin', accountType: 'admin', status: 'active',
            authConnections: [], projectAccess: [],
        }] });
        if (p === '/api/analytics/context' || p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            const epm = { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: true,
                userCanEditSettings: editor, userCanEditEpmConfig: true, adminUserManagementAvailable: true, userIsToolAdmin: editor,
                scenarioPlannerForEveryone: workspace.forEveryone, epm,
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm } },
                sharedConfig: { version: 1, capacity: {}, statsPriorityWeights: [], epm }, sharedConfigRevision: workspace.revision,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: SUMMARIES, adminSettingsMissingByConfiguration: { legacy: [], delivery: [] },
            });
        }
        if (p === '/api/scenario-access/config' && request.method() === 'POST') {
            if (!editor) return json({ error: 'admin_required' }, 403);
            const body = request.postDataJSON();
            if (body.baseRevision !== workspace.revision) return json({ error: 'workspace_config_conflict', currentRevision: workspace.revision }, 409);
            workspace.forEveryone = body.enabledForEveryone === true;
            workspace.revision += 1;
            return json({ enabledForEveryone: workspace.forEveryone, configRevision: workspace.revision });
        }
        if (p.startsWith('/api/scenario')) {
            if (!editor && !workspace.forEveryone) return json({ error: 'scenario_locked' }, 403);
            if (p === '/api/scenario' && request.method() === 'POST') return json(scenarioPayload());
            if (p === '/api/scenario/drafts' && request.method() === 'GET') return json({ storage: 'db', activeDraft: null, versions: [] });
            return json({});
        }
        if (p === '/api/work-structure/config') return json({ workConfigurations: { version: 1, promotionRevision: 6, configurations: [] }, configRevision: workspace.revision, promoted: true, userCanEditSettings: editor, featureEnabled: true });
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'] }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') {
            const id = url.searchParams.get('configurationId') || '';
            if (!id) return json({ error: 'configuration_required' }, 409);
            return json({ sprints: (CATALOGS[id] || []).map(row => ({ ...row, configurationId: id })), context: { configurationId: id, configurationRevision: Number(url.searchParams.get('configurationRevision')) } });
        }
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: 'team-platform', name: 'Platform Team' }] });
        if (p === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/projects') return json({ projects: [] });
        if (p === '/api/boards') return json({ boards: [] });
        if (p === '/api/fields') return json({ fields: [] });
        if (p === '/api/epm/config') return json({ version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} });
        return json({});
    });
}

const quiet = page => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
const modeControl = page => page.locator('.eng-mode-control').first();
async function open(page, options) {
    await mockApp(page, options);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await quiet(page);
    await expect(modeControl(page).getByRole('radio', { name: 'Catch Up' })).toBeVisible();
}

test('locked: a non-admin has no Scenario entry and a restored Scenario view falls back to Catch Up', async ({ page }) => {
    const workspace = { forEveryone: false, revision: 3, log: [] };
    await open(page, { editor: false, workspace, prefs: { selectedView: 'eng', showScenario: true } });
    await expect(modeControl(page).getByRole('radio', { name: 'Statistics' })).toBeVisible();
    await expect(modeControl(page).getByRole('radio', { name: 'Scenario' })).toHaveCount(0);
    await expect(modeControl(page).locator('[aria-checked="true"]')).toHaveText('Catch Up');
    await expect(page.locator('.scenario-panel')).toHaveCount(0);
    expect(workspace.log.filter(call => call.pathname.startsWith('/api/scenario'))).toEqual([]);
    await modeControl(page).screenshot({ path: path.join(shotDir, 'locked-mode-control.png') });
});

test('an admin unlocks Scenario from the Access tab footer Save; a non-admin then sees it', async ({ browser }) => {
    const workspace = { forEveryone: false, revision: 3, log: [] };
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await open(admin, { editor: true, workspace });
    await expect(modeControl(admin).getByRole('radio', { name: 'Scenario' })).toBeVisible();
    await admin.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = admin.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Access' }).click();
    const toggle = dialog.getByRole('checkbox', { name: 'Scenario planner for everyone' });
    await expect(toggle).not.toBeChecked();
    await expect(toggle.locator('xpath=..')).toHaveClass('group-visible-control');
    await toggle.check();
    await dialog.locator('.admin-access-settings').screenshot({ path: path.join(shotDir, 'access-tab-switch.png') });
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);
    // Its own section and payload: one admin write, nothing else from the administrator sections.
    const writes = workspace.log.filter(call => call.method === 'POST' && !['/api/auth/csrf', '/api/auth/refresh', '/api/team-catalog'].includes(call.pathname));
    expect(writes.map(call => call.pathname)).toEqual(['/api/scenario-access/config']);
    expect(writes[0].body).toEqual({ enabledForEveryone: true, baseRevision: 3 });
    expect(workspace.forEveryone).toBe(true);
    await adminContext.close();

    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await open(member, { editor: false, workspace });
    await expect(modeControl(member).getByRole('radio', { name: 'Scenario' })).toBeVisible();
    await memberContext.close();
});

test('new-model Scenario schedules Epics in Initiative lanes under its own draft namespace', async ({ page }) => {
    const workspace = { forEveryone: false, revision: 3, log: [] };
    await open(page, { editor: true, workspace, prefs: { selectedView: 'eng', selectedQuarter: '2027Q1', sprintName: '2027Q1' } });
    await expect(page.locator('.sprint-dropdown-toggle').first()).toHaveText('2027Q1');
    await modeControl(page).getByRole('radio', { name: 'Scenario' }).click();
    const parentToggle = page.locator('.scenario-toggle', { hasText: 'Initiative' });
    await expect(parentToggle).toBeVisible();
    await expect(page.locator('.scenario-toggle', { hasText: /^Epic$/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Run Scenario' }).click();
    await expect.poll(() => workspace.log.filter(call => call.pathname === '/api/scenario' && call.method === 'POST').length).toBe(1);
    const run = workspace.log.find(call => call.pathname === '/api/scenario' && call.method === 'POST');
    expect(String(run.body.filters.sprint)).toBe('91');
    await expect.poll(() => workspace.log.filter(call => call.pathname === '/api/scenario/drafts').map(call => call.params.scope_key)).toEqual(['delivery:91:platform']);
    await parentToggle.click();
    const labels = page.locator('.scenario-lane-title-text');
    await expect(labels).toHaveText(['First initiative', 'Second initiative']);
    for (const summary of ['Ingest pipeline epic', 'Reporting epic', 'Billing epic']) await expect(page.locator('.scenario-bar', { hasText: summary })).toBeVisible();
    await page.locator('.scenario-lanes').screenshot({ path: path.join(shotDir, 'initiative-lanes.png') });
});
