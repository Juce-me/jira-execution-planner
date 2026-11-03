// Catch Up for a complete quarterly (DELIVERY, 2027Q1) configuration shows neither the readiness "configuration is incomplete"
// warning nor "Some dependencies could not be loaded", and every work request carries the DELIVERY context only. The mocked
// routes enforce the server contract: selectors in the query string, a `{keys, refresh}` dependency body. Synthetic values only.
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5962';
let sourceDashboardJs;

test.beforeAll(() => {
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
const DELIVERY_CONTEXT = { configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1' };
const SPRINT = { id: 91, name: '2027Q1', state: 'active' };
const WORK_PATHS = ['/api/tasks-with-team-name', '/api/missing-info', '/api/eng/story-readiness', '/api/dependencies'];
const DEPENDENCY_BODY_KEYS = new Set(['keys', 'refresh']);

const epic = (key, summary) => ({
    id: key, key, fields: {
        summary, status: { name: 'In Progress' }, priority: { name: 'Medium' }, issuetype: { id: '10002', name: 'Epic' },
        customfield_10004: 3, epicKey: 'PLAN-100', parentSummary: 'Sample initiative', projectKey: 'PLAN',
        teamId: 'team-platform', teamName: 'Platform Team', updated: '2027-01-12T12:00:00.000Z', sprint: [SPRINT],
    },
});

const selectorsOf = params => ({
    configurationId: params.configurationId, configurationRevision: params.configurationRevision, quarter: params.quarter,
});
// The server's admission: no selectors on a promoted workspace is `configuration_required`, another revision is stale.
function admission(params, legacy = false) {
    if (!params.configurationId || !params.quarter) return { status: 409, error: 'configuration_required' };
    const [id, revision] = legacy ? ['legacy', '3'] : ['delivery', '2'];
    if (params.configurationId !== id || params.configurationRevision !== revision) return { status: 409, error: 'configuration_scope_changed' };
    return null;
}

async function mockApp(page, { readinessReply = null, workTypes = null, legacy = false, epicCount = 2, readinessEpics = [], roleTypes = null, objective = null, prefs = {} } = {}) {
    const state = { log: [], configRequests: 0 };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(prefs => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, { ...(legacy ? { selectedView: 'eng', selectedSprint: 7, sprintName: '2026Q4', selectedQuarter: '2026Q4' }
        : { selectedView: 'eng', selectedSprint: 91, sprintName: '2027Q1', selectedQuarter: '2027Q1' }), ...prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const params = Object.fromEntries(url.searchParams.entries());
        const p = url.pathname;
        const body = request.method() === 'POST' ? request.postDataJSON() : null;
        state.log.push({ method: request.method(), pathname: p, params, body });
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/analytics/context' || p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            state.configRequests += 1;
            const shared = { version: 1, capacity: {}, statsPriorityWeights: [], epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm: shared.epm, adminContacts: ['Pat Admin'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: shared.epm } },
                sharedConfig: shared, sharedConfigRevision: 3,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: roleTypes ? SUMMARIES.map(summary => (summary.id === 'delivery' ? { ...summary, roleTypes } : summary)) : SUMMARIES,
                adminSettingsMissingByConfiguration: { legacy: [], delivery: [] },
            });
        }
        if (p === '/api/work-structure/config') return json({ workConfigurations: { version: 1, promotionRevision: 6, configurations: [] }, configRevision: 3, promoted: true, userCanEditSettings: true, featureEnabled: true });
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'], teamLabels: { 'team-platform': ['alias_platform'] } }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') {
            const id = params.configurationId || '';
            if (!id) return json({ error: 'configuration_required' }, 409);
            const rows = id === 'delivery' ? [SPRINT] : [{ id: 7, name: '2026Q4', state: 'closed' }];
            return json({ sprints: rows.map(row => ({ ...row, configurationId: id })), context: { configurationId: id, configurationRevision: Number(params.configurationRevision) } });
        }
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: 'team-platform', name: 'Platform Team' }] });
        if (WORK_PATHS.includes(p)) {
            const rejected = admission(params, legacy);
            if (rejected) return json({ error: rejected.error }, rejected.status);
        }
        if (p === '/api/tasks-with-team-name') {
            const visible = !params.purpose;
            return json({
                issues: visible ? [epic('PLAN-1', 'First sample epic'), epic('PLAN-2', 'Second sample epic'),
                    ...Array.from({ length: Math.max(0, epicCount - 2) }, (_, index) => epic(`PLAN-${index + 3}`, `Sample epic ${index + 3}`))] : [],
                epics: { 'PLAN-100': { key: 'PLAN-100', summary: 'Sample initiative', status: { name: 'In Progress' }, teamId: 'team-platform', teamName: 'Platform Team', ...(objective ? { initiative: objective } : {}) } },
                epicsInScope: [], names: {},
                // The server reports workTypes on full new-model reads only; Legacy never carries them.
                ...(visible && workTypes && !legacy ? { workTypes } : {}),
            });
        }
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/eng/story-readiness') {
            if (readinessReply) {
                state.configRequestsAtReadiness ??= state.configRequests;
                return json(readinessReply.body, readinessReply.status);
            }
            return json({ schemaVersion: 1, complete: true, epics: readinessEpics, scope: {
                groupId: params.groupId, sprintId: params.sprint, sprintName: params.sprintName, sprintState: params.sprintState,
            } });
        }
        if (p === '/api/dependencies') {
            if (!body || Object.keys(body).some(key => !DEPENDENCY_BODY_KEYS.has(key))) return json({ error: 'invalid_dependencies_request' }, 400);
            return json({ dependencies: { 'PLAN-1': [{
                key: 'PLAN-2', category: 'block', direction: 'inward', relation: 'is blocked by', status: 'In Progress',
                summary: 'Second sample epic', teamName: 'Platform Team', prereqKey: 'PLAN-2', dependentKey: 'PLAN-1',
            }] } });
        }
        if (p === '/api/projects' || p === '/api/boards') return json({ projects: [], boards: [] });
        return json({});
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    return state;
}

const work = state => state.log.filter(call => WORK_PATHS.includes(call.pathname));
const READINESS_INCOMPLETE = /readiness configuration is incomplete/i;
const DEPENDENCIES_FAILED = 'Some dependencies could not be loaded.';

test('a complete 2027Q1 DELIVERY quarter loads readiness and dependencies with no warning and only DELIVERY context', async ({ page }) => {
    const state = await mockApp(page);
    await expect(page.locator('.task-item').first()).toBeVisible();
    await expect.poll(() => work(state).filter(call => call.pathname === '/api/dependencies').length).toBeGreaterThan(0);
    await expect.poll(() => work(state).filter(call => call.pathname === '/api/eng/story-readiness').length).toBeGreaterThan(0);
    await expect(page.locator('.task-item button[data-dep-chip="blocked-by"]').first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('.story-readiness-notice')).toHaveCount(0);
    await expect(page.getByText(DEPENDENCIES_FAILED)).toHaveCount(0);
    await expect(page.getByText(READINESS_INCOMPLETE)).toHaveCount(0);
    for (const call of work(state)) {
        expect(selectorsOf(call.params), `${call.method} ${call.pathname}`).toEqual(DELIVERY_CONTEXT);
        if (call.pathname === '/api/dependencies') expect(Object.keys(call.body).sort()).toEqual(['keys']);
    }
    // No catalog read crosses configurations: each names one configuration with its own revision.
    for (const call of state.log.filter(entry => entry.pathname === '/api/sprints')) {
        expect({ legacy: '3', delivery: '2' }[call.params.configurationId]).toBe(call.params.configurationRevision);
    }
});

test('an incomplete Department names the unlabeled Team with the model-aware feature name', async ({ page }) => {
    await mockApp(page, { readinessReply: { status: 409, body: {
        error: 'story_readiness_configuration_invalid', message: 'Story readiness configuration is incomplete.',
        reason: 'team_labels_missing', teams: ['Platform Team'],
    } } });
    const notice = page.locator('.story-readiness-notice', { hasText: 'Epics Required needs a Team label' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('missing for Platform Team');
    await expect(notice).toContainText('Open Settings');
    await expect(page.getByText(DEPENDENCIES_FAILED)).toHaveCount(0);
});

test('a stale configuration answer re-reads the configuration silently instead of reporting it incomplete', async ({ page }) => {
    const state = await mockApp(page, { readinessReply: { status: 409, body: { error: 'configuration_scope_changed' } } });
    await expect.poll(() => work(state).filter(call => call.pathname === '/api/eng/story-readiness').length).toBeGreaterThan(0);
    // The stale answer asks the dashboard to re-read the configuration summaries (reportWorkContextStale).
    await expect.poll(() => state.configRequests).toBeGreaterThan(state.configRequestsAtReadiness);
    await page.waitForTimeout(500);
    await expect(page.locator('.story-readiness-notice')).toHaveCount(0);
});

const LINK_NOTICE = /in this quarter (has|have) a Jira parent that is not/;
const mismatches = (parentCount, ancestorCount, keys) => ({
    digest: 'digest-delivery', observed: { planning: 'Epic', parent: 'Initiative' },
    linkMismatches: { parentCount, ancestorCount, keys },
});

test('a DELIVERY Epic whose Jira parent is not an Initiative shows one notice and keeps the row', async ({ page }) => {
    await mockApp(page, { workTypes: mismatches(1, 0, ['PLAN-2']) });
    await expect(page.locator('.task-item').first()).toBeVisible();
    const notices = page.locator('.story-readiness-notice', { hasText: LINK_NOTICE });
    await expect(notices).toHaveCount(1);
    await expect(notices.first()).toHaveText(
        '1 Epic in this quarter has a Jira parent that is not an Initiative. An administrator can review Field mapping in Settings.');
    await expect(page.locator('.task-item', { hasText: 'Second sample epic' })).toBeVisible();
});

test('several mismatched links use the plural and an Initiative mismatch names the Objective', async ({ page }) => {
    await mockApp(page, { workTypes: mismatches(2, 1, ['PLAN-1', 'PLAN-2', 'PLAN-100']) });
    await expect(page.locator('.task-item').first()).toBeVisible();
    const notices = page.locator('.story-readiness-notice', { hasText: LINK_NOTICE });
    await expect(notices).toHaveText([
        '2 Epics in this quarter have a Jira parent that is not an Initiative. An administrator can review Field mapping in Settings.',
        '1 Initiative in this quarter has a Jira parent that is not an Objective. An administrator can review Field mapping in Settings.',
    ]);
});

test('a Legacy quarter shows no link notice', async ({ page }) => {
    const state = await mockApp(page, { legacy: true, workTypes: mismatches(1, 0, ['PLAN-2']) });
    await expect.poll(() => work(state).filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose).length).toBeGreaterThan(0);
    await expect(page.locator('.task-item').first()).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('.story-readiness-notice', { hasText: LINK_NOTICE })).toHaveCount(0);
});

// The user's DELIVERY bug: counts, alerts, the requirement card and the row icons follow the configured Jira types.
const readinessParent = (key, summary) => ({
    key, summary, status: { name: 'In Progress' }, priority: { name: 'High' }, projectKey: 'PLAN', projectClass: 'other', initiative: null,
    missingTeams: [{ id: 'team-data', name: 'Data Team', reason: 'no_stories' }],
});
const ALERT_PREFS = { showAlertsPanel: true, showNeedsStoriesAlert: true };
const OBJECTIVE = { key: 'OBJ-1', summary: 'Sample objective' };
const RENAMED_ROLE_TYPES = {
    planning: { id: '6', name: 'Deliverable', hierarchyLevel: 1 }, parent: { id: '11700', name: 'Theme', hierarchyLevel: 2 },
    ancestor: { id: '12723', name: 'Objective', hierarchyLevel: 3 }, optionalAncestor: null,
};
const requiredPill = page => page.locator('.alerts-panel-summary-pill', { hasText: 'required' });

async function expectOneRowHeaders(page, selector) {
    const headers = page.locator(selector);
    await expect(headers.first()).toBeVisible();
    for (const header of await headers.all()) {
        const metrics = await header.evaluate(element => {
            const row = [...element.querySelectorAll('.epic-title-row > *, .epic-meta > *')]
                .filter(node => getComputedStyle(node).display !== 'none').map(node => node.getBoundingClientRect());
            const icon = element.querySelector('.epic-icon').getBoundingClientRect();
            const name = element.querySelector('.epic-name').getBoundingClientRect();
            return {
                overflow: element.scrollWidth - element.clientWidth,
                topSpread: Math.max(...row.map(box => box.top)) - Math.min(...row.map(box => box.top)),
                iconHeight: icon.height, centerDelta: Math.abs((icon.top + icon.bottom) / 2 - (name.top + name.bottom) / 2),
            };
        });
        expect(metrics.overflow).toBeLessThanOrEqual(1);
        expect(metrics.topSpread).toBeLessThanOrEqual(8);
        expect(metrics.iconHeight).toBe(24);
        expect(metrics.centerDelta).toBeLessThanOrEqual(2);
    }
}

test('DELIVERY Catch Up names its counts, alerts, requirement card and icons by the configured types', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockApp(page, { epicCount: 5, readinessEpics: [readinessParent('PLAN-100', 'Sample initiative')], objective: OBJECTIVE,
        prefs: { ...ALERT_PREFS, groupByInitiativeChoice: true } });
    await expect(page.locator('.task-item')).toHaveCount(5);
    await expect(page.getByText(/5 epics · 1 required/i)).toBeVisible();
    await expect(requiredPill(page)).toHaveText('1 Epic required');
    const card = page.locator('.story-requirement-card');
    await expect(card.locator('.story-requirement-title')).toHaveText('Epic required');
    await expect(card).toHaveAttribute('aria-label',
        'PLAN-100, Sample initiative: Epic required for Data Team, target sprint 2027Q1. Opens the Initiative in Jira to create the Epic.');
    await expect(page.locator('#eng-alert-needs-stories .alert-story-note')).toHaveText('No Epics yet for this sprint.');
    await expect(page.locator('.task-item .story-icon').first()).toHaveAttribute('title', 'EPIC');
    await expect(page.locator('.epic-header .epic-icon').first()).toHaveAttribute('title', 'INITIATIVE');
    await expect(page.locator('.epic-header .epic-icon .initiative-icon')).toHaveCount(1);
    await expect(page.locator('.initiative-header .initiative-header-icon')).toHaveAttribute('title', 'OBJECTIVE');
    await expectOneRowHeaders(page, '.initiative-body .epic-block > .epic-header');
});

test('DELIVERY direct Initiative headers keep one row and two requirements use the plural pill', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockApp(page, { epicCount: 5, readinessEpics: [readinessParent('PLAN-100', 'Sample initiative'), readinessParent('PLAN-200', 'Other initiative')],
        prefs: ALERT_PREFS });
    await expect(page.getByText(/5 epics · 2 required/i)).toBeVisible();
    await expect(requiredPill(page)).toHaveText('2 Epics required');
    await expectOneRowHeaders(page, '.task-list > .epic-block > .epic-header, .task-list > div > .epic-block > .epic-header');
});

test('a renamed DELIVERY configuration shows the captured Jira type names', async ({ page }) => {
    await mockApp(page, { epicCount: 5, readinessEpics: [readinessParent('PLAN-100', 'Sample initiative')], roleTypes: RENAMED_ROLE_TYPES, objective: OBJECTIVE,
        prefs: { ...ALERT_PREFS, groupByInitiativeChoice: true } });
    await expect(page.getByText(/5 deliverables · 1 required/i)).toBeVisible();
    await expect(requiredPill(page)).toHaveText('1 Deliverable required');
    await expect(page.locator('.story-requirement-title')).toHaveText('Deliverable required');
    await expect(page.locator('.story-requirement-card')).toHaveAttribute('aria-label', /Deliverable required for Data Team, target sprint 2027Q1\. Opens the Theme in Jira to create the Deliverable\.$/);
    await expect(page.locator('.task-item .story-icon').first()).toHaveAttribute('title', 'DELIVERABLE');
    await expect(page.locator('.epic-header .epic-icon').first()).toHaveAttribute('title', 'THEME');
    await expect(page.locator('#eng-alert-needs-stories .alert-story-note')).toHaveText('No Deliverables yet for this sprint.');
});
