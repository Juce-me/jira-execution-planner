// Task 4D/5A/5D composition proof: the full dashboard against fully mocked routes (no Jira, no DB, no server, never
// port 5050). Every value is synthetic. The dashboard is bundled from source so the production components run.
//
// Covered: combined-model Catch Up/Planning table/Board rendering with the configuration stamp on every scoped request,
// own-key writes and a stale stamp that keeps its draft without replay, independent review layouts across an era round
// trip, the Allocation Board A-only/A+B sets rendered exactly as the server provided them, the viewed quarter on every
// scoped view, no automatic Settings navigation, and Legacy-era behavior unchanged.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5953';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'work-structure-transition');
let sourceDashboardJs;

test.beforeAll(async () => {
    fs.mkdirSync(shotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

const DIGEST = 'b'.repeat(32);
const SUMMARIES = () => ([
    { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' },
    { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null },
]);
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const body = request => { try { return request.postDataJSON(); } catch (error) { return null; } };
const quiet = page => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });

// Combined model: tasks are Epic leaves, `epics`/`epicsInScope` are the Initiative parents. Legacy: Stories under Epics.
const LEGACY_SPRINT = { id: 7, name: '2026Q4', state: 'active', startDate: '2026-10-01' };
const DELIVERY_SPRINT = { id: 91, name: '2027Q1', state: 'active', startDate: '2027-01-04' };
const leaf = (key, id, parentKey, parentSummary, sprint, kind, points, status = 'In Progress') => ({
    id: String(id), key,
    fields: {
        summary: `${key} synthetic ${kind}`, status: { name: status }, priority: { name: 'Major' }, issuetype: { name: kind },
        assignee: { displayName: 'Alpha Owner' }, customfield_10004: points, epicKey: parentKey, parentSummary,
        projectKey: 'PLAN', teamId: 'team-alpha', teamName: 'Alpha Team', sprint: [{ id: sprint.id, name: sprint.name, state: sprint.state }],
    },
});
const parentOf = (key, id, summary, sprint) => ({
    id: String(id), key, summary, status: { name: 'In Progress' }, assignee: { displayName: 'Alpha Lead' }, teamId: 'team-alpha',
    teamName: 'Alpha Team', labels: [], projectTrack: 'Committed', projectKey: 'PLAN', sprint: [{ id: sprint.id, name: sprint.name, state: sprint.state }],
});

const reviewSchema = (configurationId, quarter) => (configurationId === 'delivery'
    ? {
        schemaVersion: 1, sprintId: '91', groupId: 'platform', schemaRevision: 5, viewRevision: 2, inheritedFrom: null,
        configurationId: 'delivery', quarterOrdinal: 8109, capabilities: { canRead: true, canSave: true },
        columns: [
            { id: 'delivery-init-cost', rowKind: 'initiative', label: 'Delivery initiative cost', type: 'number', aggregation: 'sum', order: 0, archived: false },
            { id: 'delivery-epic-note', rowKind: 'epic', label: 'Delivery epic note', type: 'text', aggregation: 'none', order: 0, archived: false },
        ],
        layouts: { initiative: { order: ['status', 'storyPoints', 'delivery-init-cost'], hidden: [] }, epic: { order: ['status', 'initiative', 'delivery-epic-note'], hidden: [] } },
    }
    : {
        schemaVersion: 1, sprintId: '7', groupId: 'platform', schemaRevision: 9, viewRevision: 4, inheritedFrom: null,
        capabilities: { canRead: true, canSave: true },
        columns: [
            { id: 'legacy-epic-cost', rowKind: 'epic', label: 'Legacy epic cost', type: 'number', aggregation: 'sum', order: 0, archived: false },
            { id: 'legacy-story-note', rowKind: 'story', label: 'Legacy story note', type: 'text', aggregation: 'none', order: 0, archived: false },
        ],
        layouts: { epic: { order: ['status', 'storyPoints', 'legacy-epic-cost'], hidden: [] }, story: { order: ['status', 'epic', 'legacy-story-note'], hidden: [] } },
    });

function ndjson(frames) { return `${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`; }
function boardFrames({ scope, epics, children = [] }) {
    const generationId = 'gen-1';
    const base = { protocolVersion: 1, generationId };
    const columns = [
        { id: 'todo', name: 'To Do', color: '#597ef7', statusNames: ['To Do'], terminal: false },
        { id: 'progress', name: 'In Progress', color: '#fa8c16', statusNames: ['In Progress'], terminal: false },
        { id: 'done', name: 'Done', color: '#52c41a', statusNames: ['Done'], terminal: true },
    ];
    const frames = [
        { ...base, sequence: 0, type: 'start', scope, scopeVersion: 'v1', scopeCohortDigest: 'c'.repeat(64), columns },
        { ...base, sequence: 1, type: 'index', epics, membership: 'authoritative' },
    ];
    for (const column of columns) {
        frames.push({
            ...base, sequence: frames.length, type: 'column', columnId: column.id,
            epics: epics.filter(epic => epic.columnId === column.id), children: children.filter(item => item.columnId === column.id).map(({ columnId, ...rest }) => rest), authoritative: true,
        });
    }
    frames.push({
        ...base, sequence: frames.length, type: 'complete', outcome: 'success', authoritative: true, epicCount: epics.length, childCount: children.length,
        diagnostics: { indexMs: 1, focusedCompleteMs: 1, durationMs: 2, jiraRequests: 1, jiraPages: 1, jiraRetries: 0, peakChildSearches: 1, cacheState: 'miss', completeness: 'complete' },
    });
    return frames;
}
const boardEpic = (key, summary, columnId, status, parent) => ({
    key, summary, status: { id: status, name: status }, priority: null, assignee: null, deliveryOwner: null, projectTrack: 'Committed',
    updated: '2027-01-10T10:00:00.000+0000', parent, columnId,
});
const boardParent = (key, summary) => ({ key, summary, issueType: { id: '10002', name: 'Initiative' } });

async function mockApp(page, {
    prefs = { selectedView: 'eng', selectedQuarter: '2027Q1', selectedSprint: 91, sprintName: '2027Q1' },
    allocationTypes = [], teamIds = ['team-alpha'], boardSets = {}, writeStatus = 200,
} = {}) {
    const state = { log: [], writes: [], summaries: SUMMARIES(), layoutSaves: [], configRequests: 0, boardRequests: [], writeStatus };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(({ stored }) => {
        if (!window.localStorage.getItem('jira_dashboard_ui_prefs_v1')) window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(stored));
    }, { stored: prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const params = Object.fromEntries(url.searchParams.entries());
        const payload = request.method() === 'GET' ? null : body(request);
        state.log.push({ method: request.method(), pathname: url.pathname, params, body: payload });
        const p = url.pathname;
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (p === '/api/analytics/context' || p === '/api/version') return json(route, { enabled: false });
        if (p === '/api/config') {
            state.configRequests += 1;
            const shared = { version: 1, capacity: {}, statsPriorityWeights: [], epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
            return json(route, {
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, environmentConfigExists: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm: shared.epm, adminContacts: ['Pat Admin'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', version: 1, view: { epm: shared.epm, selectedView: 'eng', activeGroupId: 'platform' } },
                capacityProject: '', boardAllWorkAvailable: true,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: state.summaries, adminSettingsMissingByConfiguration: { legacy: [], delivery: [] },
            });
        }
        if (p === '/api/work-structure/config') return json(route, { workConfigurations: { version: 1, promotionRevision: 6, configurations: [] }, configRevision: 3, promoted: true, userCanEditSettings: true, featureEnabled: true });
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json(route, {
                version: 1, groups: [{
                    id: 'platform', name: 'Platform', teamIds, missingInfoComponents: [], allocationTypes, labels: [], excludedCapacityEpics: [],
                    board: { columns: [
                        { id: 'todo', name: 'To Do', colour: '#597ef7', star: true, min: null, max: null, statuses: ['To Do'] },
                        { id: 'progress', name: 'In Progress', colour: '#fa8c16', star: false, min: null, max: null, statuses: ['In Progress'] },
                        { id: 'done', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'] },
                    ] },
                }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: false, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: [], effectiveVisibleGroupIds: ['platform'], activeGroupId: 'platform' },
            });
        }
        if (p === '/api/groups-preferences') return json(route, { preferences: {} });
        if (p === '/api/projects/selected') return json(route, { selected: [{ key: 'PLAN', type: 'other' }], configRevision: 3 });
        if (p === '/api/board-config') return json(route, { boardId: '', boardName: '', source: 'config', configRevision: 3 });
        if (p === '/api/sprints') {
            const id = params.configurationId || '';
            return json(route, { sprints: id === 'delivery' ? [DELIVERY_SPRINT] : [LEGACY_SPRINT], context: { configurationId: id, configurationRevision: Number(params.configurationRevision) } });
        }
        if (p === '/api/team-catalog') return json(route, { catalog: { 'team-alpha': { id: 'team-alpha', name: 'Alpha Team' } }, meta: {} });
        if (p === '/api/teams') return json(route, { teams: [{ id: 'team-alpha', name: 'Alpha Team' }] });
        if (p === '/api/tasks-with-team-name') {
            const combined = params.configurationId === 'delivery';
            const sprint = combined ? DELIVERY_SPRINT : LEGACY_SPRINT;
            if (params.purpose === 'alerts' || (!combined && params.project === 'tech')) return json(route, { issues: [], epics: {}, epicsInScope: [], names: {} });
            const parent = combined
                ? parentOf('PLAN-100', 100, 'Delivery synthetic initiative', sprint)
                : parentOf('PLAN-100', 100, 'Legacy synthetic epic', sprint);
            const kind = combined ? 'Epic' : 'Story';
            const issues = [
                leaf('PLAN-E1', 201, parent.key, parent.summary, sprint, kind, 3), leaf('PLAN-E2', 202, parent.key, parent.summary, sprint, kind, 5, 'To Do'),
            ];
            return json(route, { issues, epics: { [parent.key]: parent }, epicsInScope: [parent], names: {} });
        }
        if (p === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (p === '/api/backlog-epics') return json(route, { epics: [] });
        if (p === '/api/dependencies') return json(route, { dependencies: {} });
        if (p === '/api/capacity') return json(route, { enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (p === '/api/eng/story-readiness') return teamIds.length
            ? json(route, { epics: [], stories: [], summary: {}, status: 'complete' })
            : json(route, { error: 'story_readiness_configuration_invalid', message: 'Story readiness configuration is incomplete.', reason: 'teams_missing' }, 409);
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(p) && request.method() === 'GET') return json(route, reviewSchema(params.configurationId === 'delivery' ? 'delivery' : 'legacy', params.quarter));
        if (/\/review\/values\/read$/.test(p)) return json(route, { cells: [], unavailableIssueIds: [] });
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(p) && request.method() === 'PATCH') {
            state.layoutSaves.push(payload);
            return json(route, { error: 'configuration_scope_changed', code: 'configuration_scope_changed' }, 409);
        }
        if (/\/editable-fields$/.test(p)) return json(route, { editable: true, currentValue: 3, mappingRevision: 'm1', baseUpdated: '2027-01-10T10:00:00.000+0000' });
        if (/\/api\/issues\/[^/]+\/field$/.test(p)) {
            state.writes.push({ pathname: p, body: payload });
            if (state.writeStatus === 409) return json(route, { error: 'configuration_scope_changed' }, 409);
            return json(route, { result: 'updated', value: payload.value });
        }
        if (p === '/api/issues/project-track/options') return json(route, { options: [{ value: 'Flexible' }, { value: 'Committed' }], source: 'jira' });
        if (p === '/api/issues/project-track') {
            state.writes.push({ pathname: p, body: payload });
            if (state.writeStatus === 409) return json(route, { error: 'configuration_scope_changed' }, 409);
            return json(route, { succeeded: 1, results: [{ issueKey: payload.issueKey, result: 'updated' }] });
        }
        if (p === '/api/eng/board') {
            state.boardRequests.push(params);
            const frames = (boardSets[params.scope] || []);
            return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson(frames) });
        }
        return json(route, {});
    });
    return state;
}

const trigger = page => page.locator('.sprint-dropdown-toggle').first();
const work = state => state.log.filter(call => call.pathname === '/api/tasks-with-team-name');
async function start(page, options) {
    const state = await mockApp(page, options);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await quiet(page);
    return state;
}
async function quiesce(page, state, ms = 600) {
    let last = -1;
    while (last !== state.log.length) { last = state.log.length; await page.waitForTimeout(ms); }
}
async function pickQuarter(page, quarter) {
    await trigger(page).click();
    await page.locator(`.sprint-dropdown-option[data-quarter="${quarter}"], .sprint-dropdown-option:has-text("${quarter}")`).first().click();
    await expect(trigger(page)).toHaveText(quarter);
}

test('Catch Up (combined): Epic leaves under an Initiative, one project=all lane, every request stamped', async ({ page }) => {
    const state = await start(page);
    await expect(trigger(page)).toHaveText('2027Q1');
    await expect(page.locator('.task-item').first()).toBeVisible();
    await quiesce(page, state);
    const scoped = work(state).filter(call => !call.params.purpose);
    expect(scoped.length).toBeGreaterThan(0);
    for (const call of work(state)) {
        expect(call.params.project).toBe('all');
        expect(call.params.configurationId).toBe('delivery');
        expect(call.params.configurationRevision).toBe('2');
        expect(call.params.quarter).toBe('2027Q1');
    }
    expect(state.log.filter(call => call.pathname === '/api/backlog-epics')).toEqual([]);
    expect(state.log.filter(call => call.pathname === '/api/tasks-with-team-name' && call.params.project === 'tech')).toEqual([]);
    await expect(page.locator('.task-item')).toHaveCount(2);
    await expect(page.locator('.epic-header').first()).toContainText('Delivery synthetic initiative');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: path.join(shotDir, 'catch-up-combined.png') });
});

test('Catch Up (Legacy era): unchanged two-lane requests, Backlog source kept, Legacy stamp names the Legacy configuration', async ({ page }) => {
    const state = await start(page, { prefs: { selectedView: 'eng', selectedQuarter: '2026Q4', selectedSprint: 7, sprintName: '2026Q4' } });
    await expect(page.locator('.task-item').first()).toBeVisible();
    await quiesce(page, state);
    const lanes = new Set(work(state).filter(call => !call.params.purpose).map(call => call.params.project));
    expect(lanes).toEqual(new Set(['product', 'tech']));
    for (const call of work(state)) expect(call.params.configurationId).toBe('legacy');
    await expect(page.locator('.epic-header').first()).toContainText('Legacy synthetic epic');
    await page.screenshot({ path: path.join(shotDir, 'catch-up-legacy.png') });
});

test('own-key writes: Story Points on the Epic leaf and Project Track on the Initiative carry the stamp and their own key', async ({ page }) => {
    const state = await start(page);
    await expect(page.locator('.task-item').first()).toBeVisible();
    await quiesce(page, state);
    // Project Track belongs to the Initiative header.
    const trackButton = page.locator('.epic-header').first().locator('[data-project-track-transition-trigger]').first();
    await trackButton.click();
    await page.locator('.project-track-transition-option', { hasText: 'Flexible' }).click();
    await expect.poll(() => state.writes.filter(write => write.pathname === '/api/issues/project-track').length).toBe(1);
    const track = state.writes.find(write => write.pathname === '/api/issues/project-track');
    expect(track.body.issueKey).toBe('PLAN-100');
    expect(track.body.configuration).toEqual({ id: 'delivery', revision: 2, quarter: '2027Q1', digest: null });
    const options = state.log.find(call => call.pathname === '/api/issues/project-track/options');
    expect(options.params).toMatchObject({ issueKey: 'PLAN-100', configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1' });
});

test('a stale stamp keeps the Story Points draft, refreshes the configuration once and never replays the write', async ({ page }) => {
    const state = await start(page, { writeStatus: 409 });
    await expect(page.locator('.task-item').first()).toBeVisible();
    await quiesce(page, state);
    const before = state.configRequests;
    const input = page.locator('.task-item').first().locator('.task-inline-sp').first();
    await input.click();
    const editor = page.getByRole('textbox', { name: 'Story Points' }).first();
    await expect(editor).toBeVisible();
    await editor.fill('13');
    await editor.press('Enter');
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].pathname).toBe('/api/issues/PLAN-E1/field');
    expect(state.writes[0].body.configuration).toEqual({ id: 'delivery', revision: 2, quarter: '2027Q1', digest: null });
    await expect.poll(() => state.configRequests).toBeGreaterThan(before);
    await page.waitForTimeout(800);
    expect(state.writes.length).toBe(1);
    // The draft survives: the inline editor still holds the typed value and shows safe copy, not the raw code.
    await expect(editor).toHaveValue('13');
    await expect(page.locator('.story-points-editor-feedback')).toContainText('kept but was not saved');
    await expect(page.locator('body')).not.toContainText('configuration_scope_changed');
});

test('Planning table (combined): Initiatives/Epics, native review kinds, stamped review calls; era round trip keeps independent layouts', async ({ page }) => {
    const state = await start(page, { prefs: { selectedView: 'eng', selectedQuarter: '2027Q1', selectedSprint: 91, sprintName: '2027Q1', showPlanning: true } });
    await expect(page.locator('.task-item, .planning-review-region').first()).toBeVisible();
    const region = page.getByRole('region', { name: 'Planning Sprint review' });
    if (!(await region.isVisible())) await page.getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(region).toBeVisible();
    await quiesce(page, state);
    const mode = page.getByRole('radiogroup', { name: 'Planning review rows' });
    await expect(mode.getByRole('radio', { name: 'Initiatives' })).toBeVisible();
    await expect(mode.getByRole('radio', { name: 'Epics' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Delivery initiative cost/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Legacy epic cost/ })).toHaveCount(0);
    const gets = state.log.filter(call => /\/review$/.test(call.pathname) && call.method === 'GET');
    expect(gets.length).toBeGreaterThan(0);
    for (const call of gets) expect(call.params).toMatchObject({ groupId: 'platform', configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1' });
    const reads = state.log.filter(call => /values\/read$/.test(call.pathname));
    expect(new Set(reads.map(call => call.body.rowKind))).toEqual(new Set(['initiative', 'epic']));
    for (const call of reads) expect(call.body.configuration).toEqual({ id: 'delivery', revision: 2, quarter: '2027Q1', digest: null });
    await page.screenshot({ path: path.join(shotDir, 'planning-table-combined-initiatives.png') });
    await mode.getByRole('radio', { name: 'Epics' }).click();
    await expect(page.getByRole('columnheader', { name: /Delivery epic note/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Initiative', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(shotDir, 'planning-table-combined-epics.png') });
    // Round trip: Legacy era loads Legacy's own namespace, then DELIVERY again its own; nothing is copied between them.
    await pickQuarter(page, '2026Q4');
    await expect(page.getByRole('columnheader', { name: /Legacy epic cost|Legacy story note/ }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Delivery/ })).toHaveCount(0);
    const legacyGets = state.log.filter(call => /\/review$/.test(call.pathname) && call.method === 'GET' && call.params.configurationId === 'legacy');
    expect(legacyGets.length).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(shotDir, 'planning-table-legacy-era.png') });
    await pickQuarter(page, '2027Q1');
    await expect(page.getByRole('columnheader', { name: /Delivery/ }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Legacy/ })).toHaveCount(0);
    expect(state.log.filter(call => call.method === 'PATCH')).toEqual([]);
});

test('Allocation Board: A-only versus A+B render exactly the server-provided Initiative set, under the viewed quarter, with a stamped stream', async ({ page }) => {
    const aOnly = boardFrames({
        scope: 'allocation', epics: [boardEpic('PLAN-100', 'Initiative A synthetic', 'todo', 'To Do', boardParent('PLAN-1', 'Parent A'))],
        children: [],
    });
    const aPlusB = boardFrames({
        scope: 'allocation', epics: [
            boardEpic('PLAN-100', 'Initiative A synthetic', 'todo', 'To Do', boardParent('PLAN-1', 'Parent A')),
            boardEpic('PLAN-101', 'Initiative B synthetic', 'todo', 'To Do', boardParent('PLAN-2', 'Parent B')),
        ],
    });
    const sets = { allocation: aOnly };
    const state = await start(page, { allocationTypes: [{ value: 'Platform', type: 'product' }], boardSets: sets, prefs: { selectedView: 'eng', selectedQuarter: '2027Q1', selectedSprint: 91, sprintName: '2027Q1', engMode: 'board' } });
    await page.getByRole('radio', { name: 'Board', exact: true }).click();
    await trigger(page).click();
    await page.getByRole('option', { name: 'Allocation', exact: true }).click();
    await expect.poll(() => state.boardRequests.length).toBeGreaterThan(0);
    const request = state.boardRequests[0];
    expect(request).toMatchObject({ scope: 'allocation', configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1' });
    expect('configurationDigest' in request).toBe(false);
    expect('sprintId' in request).toBe(false);
    await expect(trigger(page)).toHaveText('Allocation');
    await expect(page.locator('[data-board-quarter]')).toContainText('Quarter 2027Q1');
    await expect(page.locator('.ecard')).toHaveCount(1);
    await expect(page.locator('.ecard').first()).toContainText('Initiative A synthetic');
    await page.screenshot({ path: path.join(shotDir, 'board-allocation-a-only.png') });
    // The server now answers the A+B expansion: the board renders precisely that set, no client-side widening.
    sets.allocation = aPlusB;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
    await expect(page.locator('.ecard')).toHaveCount(2);
    await expect(page.locator('.ecard', { hasText: 'Initiative B synthetic' })).toHaveCount(1);
    expect(state.boardRequests.every(call => call.scope === 'allocation')).toBe(true);
    await page.screenshot({ path: path.join(shotDir, 'board-allocation-a-plus-b.png') });
});

test('Allocation-only Department: switching from Allocation Board to Sprint never falls back to an unscoped task request', async ({ page }) => {
    const state = await start(page, {
        teamIds: [], allocationTypes: [{ value: 'Platform', type: 'product' }],
        boardSets: { allocation: boardFrames({ scope: 'allocation', epics: [boardEpic('PLAN-100', 'Allocation-only initiative', 'todo', 'To Do', null)] }) },
    });
    await page.getByRole('radio', { name: 'Board', exact: true }).click();
    await trigger(page).click();
    await page.getByRole('option', { name: 'Allocation', exact: true }).click();
    await expect(trigger(page)).toHaveText('Allocation');
    await expect(page.locator('.ecard')).toHaveCount(1);
    await quiesce(page, state);
    expect(state.boardRequests.length).toBeGreaterThan(0);
    expect(state.boardRequests.every(call => call.scope === 'allocation')).toBe(true);
    expect(work(state)).toEqual([]);

    await pickQuarter(page, '2027Q1');
    await quiesce(page, state);
    await expect(page.locator('.ecard')).toHaveCount(0);
    expect(work(state)).toEqual([]);
    expect(state.boardRequests.every(call => call.scope === 'allocation')).toBe(true);
    await page.getByRole('radio', { name: 'Catch Up', exact: true }).click();
    await expect(page.locator('.story-readiness-notice')).toContainText('Epics Required needs at least one Team in this Department. Open Settings to add Teams to the Department.');
    await quiesce(page, state);
    expect(work(state)).toEqual([]);
    await page.screenshot({ path: path.join(shotDir, 'board-allocation-only-sprint.png') });
});

test('quarter stays visible in each scoped view and no Settings dialog opens by itself', async ({ page }) => {
    const state = await start(page);
    await expect(trigger(page)).toHaveText('2027Q1');
    await quiesce(page, state);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const name of ['Planning', 'Catch Up']) {
        await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name, exact: true }).click();
        await expect(trigger(page)).toHaveText('2027Q1');
        await expect(page.getByRole('dialog')).toHaveCount(0);
    }
});
