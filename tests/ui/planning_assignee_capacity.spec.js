const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');
const { createPlanningReviewMock } = require('./planning_review_mock');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const earlierSprintName = '2026Q2 Sprint 9';
const caps = { canRead: true, canSave: true };

// The shared Planning review payload carries `plan` and `scopeProof` (#331); the mock adds them to every review response.
const sharedReviewMocks = new WeakMap();
const json = (route, body, status = 200) => {
    const planning = sharedReviewMocks.get(route.request().frame().page());
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(planning ? planning.response(route.request(), body, status) : body) });
};
const requestBody = request => { try { return request.postDataJSON(); } catch (error) { return null; } };

function story(key, accountId, name, sp, { team = 'team-alpha', status = 'To Do' } = {}) {
    return {
        id: String(8000 + Number(key.split('-').pop())),
        key,
        fields: {
            summary: `${key} synthetic story`, status: { name: status }, priority: { name: 'Major' }, issuetype: { name: 'Story' },
            assignee: { accountId, displayName: name },
            customfield_10004: sp, epicKey: 'PLAN-EPIC', parentSummary: 'Synthetic epic', projectKey: 'PLAN',
            teamId: team, teamName: team === 'team-alpha' ? 'Alpha Team' : 'Beta Team',
            sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
        },
    };
}
const stories = [
    story('PLAN-1', 'acc-ann', 'Ann Synthetic', 3),
    story('PLAN-2', 'acc-ann', 'Ann Synthetic', 2, { status: 'Accepted' }),
    story('PLAN-3', 'acc-bob', 'Bob Synthetic', 5, { status: 'Accepted' }),
    story('PLAN-4', null, null, 4),
    story('PLAN-5', 'acc-dee', 'Dee Synthetic', 1, { team: 'team-beta' }),
];
const epic = { id: '7001', key: 'PLAN-EPIC', summary: 'Synthetic epic', status: { name: 'In Progress' }, assignee: { displayName: 'Lead' }, teamId: 'team-alpha', teamName: 'Alpha Team', labels: ['alpha_label'], sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }] };

// A synthetic server for the assignee-capacity routes: last-write-wins per field, first write materialises the document.
// `holdGet` keeps every GET pending until `state.release()`; `patchStatus(n)` answers the n-th PATCH with an error status.
function capacityServer({ inherited = null, rows = [], capabilities = caps, delayPatch = 0, holdGet = false, patchStatus = null } = {}) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const state = { revision: rows.length ? 1 : 0, rows: rows.map(row => ({ ...row })), gets: 0, patches: [], release: () => release() };
    const handler = async route => {
        const request = route.request();
        if (request.method() === 'GET') {
            state.gets += 1;
            if (holdGet) await gate;
            return json(route, { teamId: 'team-alpha', sprintId: String(futureSprintId), revision: state.revision, rows: state.rows, inherited: state.revision ? null : inherited, capabilities });
        }
        const body = requestBody(request);
        state.patches.push({ body, headers: request.headers() });
        if (delayPatch) await new Promise(resolve => setTimeout(resolve, delayPatch));
        const status = patchStatus?.(state.patches.length);
        if (status) return json(route, { error: status === 400 ? 'invalid_review_request' : 'review_unavailable' }, status);
        if (!state.revision) {
            state.rows = (inherited?.rows || []).filter(row => !row.removed).map(row => ({ ...row, vacations: null, notes: null }));
        }
        for (const change of body.changes) {
            let row = state.rows.find(candidate => candidate.assigneeKey === change.assigneeKey);
            if (!row) { row = { assigneeKey: change.assigneeKey, displayName: change.displayName || change.assigneeKey, capacity: null, vacations: null, notes: null, removed: false }; state.rows.push(row); }
            for (const field of ['displayName', 'capacity', 'vacations', 'notes', 'removed']) if (field in change) row[field] = change[field];
        }
        state.revision += 1;
        return json(route, { teamId: 'team-alpha', sprintId: String(futureSprintId), revision: state.revision, rows: state.rows });
    };
    return { state, handler };
}

const defaultCapacity = sprint => ({ enabled: true, mutationEnabled: false, sprint, capacities: { 'Alpha Team': 20 }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: 20 }] });

// `capacity(sprintName)` answers GET /api/capacity; PATCH /api/capacity/<key> (the Jira write) is recorded and echoed.
// Add assignee search (#323): synthetic people matched by name; the response carries no email, like the real route.
const searchPeople = [
    { accountId: 'acc-ann', displayName: 'Ann Synthetic' },
    { accountId: 'acc-cy', displayName: 'Cy Former' },
    { accountId: 'acc-new', displayName: 'Nora Newcomer' },
];
const defaultPeople = query => ({ users: searchPeople.filter(person => person.displayName.toLowerCase().includes(String(query || '').toLowerCase())), reason: null });

async function install(page, { server, selectedTeams = ['team-alpha'], scopeTeamIds = ['team-alpha', 'team-beta'], prefs = {}, capacityProject = '', issues = stories, capacity = defaultCapacity, authMode = 'atlassian_oauth', analytics = false, people = defaultPeople, capacityPatch = null, epics = [epic] } = {}) {
    const calls = [];
    await installDashboardShell(page);
    // Planning counts only Stories included in the shared plan (#331); the previous default selection becomes a saved plan of every Story.
    sharedReviewMocks.set(page, createPlanningReviewMock({ initialPlans: { [futureSprintId]: { includedIssueIds: issues.map(issue => issue.id) } } }));
    await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), { selectedTeams, activeGroupId: 'group-alpha', ...prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({ method: request.method(), pathname: url.pathname, teams: url.searchParams.get('teams'), body: request.method() === 'GET' ? null : requestBody(request) });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/epm/access') return json(route, { state: 'disabled', epmHomeReadAvailable: false });
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example', capacityProject, authMode, epmViewEnabled: false, epmHomeReadAvailable: false,
                projectsConfigured: true, userCanEditSettings: true, environmentConfigExists: true,
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', version: 1, view: { selectedView: 'eng', selectedSprint: activeSprintId, sprintName: activeSprintName, activeGroupId: 'group-alpha', showPlanning: false, showScenario: false } },
            });
        }
        if (url.pathname === '/api/capacity') return json(route, capacity(url.searchParams.get('sprint')));
        if (url.pathname.startsWith('/api/capacity/') && request.method() === 'PATCH') {
            const body = requestBody(request);
            if (capacityPatch) return capacityPatch(route, body, decodeURIComponent(url.pathname.split('/').pop()));
            return json(route, { issueKey: decodeURIComponent(url.pathname.split('/').pop()), teamName: body.teamName, previousCapacity: body.expectedCapacity, capacity: body.capacity, result: 'success' });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json(route, {
                version: 1, configRevision: 1, source: 'workspace_db', defaultGroupId: 'group-alpha',
                groups: [{ id: 'group-alpha', name: 'Alpha Department', teamIds: scopeTeamIds, labels: ['alpha_label'], excludedCapacityEpics: [] }],
                preferences: { onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], customized: false, visibleGroupIds: [], effectiveVisibleGroupIds: ['group-alpha'], activeGroupId: 'group-alpha' },
            });
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '1', boardName: 'Synthetic board', configRevision: 1 });
        if (url.pathname === '/api/capacity/config') return json(route, { project: capacityProject, fieldId: capacityProject ? 'customfield_capacity' : '', fieldName: capacityProject ? 'Capacity' : '', mutationEnabled: Boolean(capacityProject), configRevision: 1 });
        if (/^\/api\/(sprint-field|parent-name-field|story-points-field|team-field|delivery-owner-field)\/config$/.test(url.pathname)) return json(route, { fieldId: '', fieldName: '', configRevision: 1 });
        if (url.pathname === '/api/issue-types/config') return json(route, { issueTypes: ['Story'], configRevision: 1 });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, { sprints: [
                { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                { id: 1999, name: earlierSprintName, state: 'closed', startDate: '2026-04-01' },
            ] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const product = url.searchParams.get('project') === 'product' && !url.searchParams.get('purpose');
            return json(route, { issues: product ? issues : [], epics: Object.fromEntries(epics.map(item => [item.key, item])), epicsInScope: product ? epics : [], names: {} });
        }
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity\/planned\/read$/.test(url.pathname)) return server.batch ? server.batch(route) : json(route, { sprintId: url.pathname.split('/')[4], capabilities: caps, teams: [] });
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity$/.test(url.pathname)) return server.handler(route);
        if (url.pathname === '/api/eng/assignee-capacity/user-options' && request.method() === 'POST') return json(route, people(requestBody(request)?.query));
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(url.pathname)) return json(route, { schemaVersion: 1, sprintId: String(futureSprintId), schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: true } });
        if (/\/review\/values\/read$/.test(url.pathname)) return json(route, { cells: [], unavailableIssueIds: [] });
        if (url.pathname === '/api/eng/story-readiness') return json(route, { schemaVersion: 1, complete: true,
            scope: { groupId: url.searchParams.get('groupId'), sprintId: url.searchParams.get('sprint'),
                sprintName: url.searchParams.get('sprintName'), sprintState: url.searchParams.get('sprintState') }, epics: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, analytics ? { enabled: true, measurementId: 'G-SYNTHETIC' } : { enabled: false });
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return { calls };
}

async function openPlanning(page) {
    await page.goto(appBaseUrl);
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await expect(toggle).toHaveAttribute('aria-disabled', 'false');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}

// The text a [data-tooltip] ::after shows: Firefox serialises the computed `content: attr(data-tooltip)` unresolved.
const shownTooltip = node => {
    const content = getComputedStyle(node, '::after').content;
    if (content === 'none' || content === 'normal') return '';
    return content === 'attr(data-tooltip)' ? node.getAttribute('data-tooltip') : content;
};
const strip = page => page.locator('[data-assignee-capacity]');
const stripToggle = page => strip(page).locator('.capacity-header-toggle');
const table = page => strip(page).locator('table.planning-assignee-table');
const rowOf = (page, key) => table(page).locator(`tbody tr[data-assignee-key="${key}"]`);
async function expand(page) { await stripToggle(page).click(); await expect(table(page)).toBeVisible(); }
const names = page => table(page).locator('tbody tr td.planning-assignee-name').evaluateAll(cells => cells.map(cell => cell.textContent.trim()));

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

test('request ledger: one Team reads the document once on load, collapsed; expansion, collapse and re-expansion read nothing', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    // D6: the read does not wait for the strip to be expanded.
    await expect.poll(() => server.state.gets).toBe(1);
    await page.waitForTimeout(400);
    const ledger = () => calls.filter(call => call.pathname.endsWith('/assignee-capacity'));
    expect(ledger().map(call => call.method)).toEqual(['GET']);
    await expand(page);
    await stripToggle(page).click(); await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await stripToggle(page).click(); await expect(table(page)).toBeVisible();
    await page.waitForTimeout(400);
    expect(ledger().map(call => call.method), 'expansion, collapse and re-expansion read nothing').toEqual(['GET']);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('jira_dashboard_planning_assignee_capacity_v1'))).toBe('{"expanded":true}');
    expect(await page.evaluate(() => localStorage.getItem('jep.planningAssigneeCapacityExpanded'))).toBeNull();
});

test('the strip starts expanded from the renamed preference key and ignores the pre-release one', async ({ page }) => {
    const server = capacityServer();
    await page.addInitScript(() => { localStorage.setItem('jep.planningAssigneeCapacityExpanded', '1'); });
    await install(page, { server });
    await openPlanning(page);
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => localStorage.setItem('jira_dashboard_planning_assignee_capacity_v1', '{"expanded":true}'));
    await page.reload();
    await openPlanning(page);
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'true');
});

// One page per selection: a second install on the same page keeps the first selection.
for (const selectedTeams of [['team-alpha', 'team-beta'], ['all']]) test(`${selectedTeams.length === 2 ? 'two Teams' : 'All Teams'} show a card for every displayed Team, read the stored numbers once in one batch and show no strip`, async ({ page }) => {
    {
        const server = capacityServer();
        const { calls } = await install(page, { server, selectedTeams });
        await openPlanning(page);
        await expect(page.locator('.planning-panel-team-details')).toHaveCount(1);
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(2);
        await expect(strip(page)).toHaveCount(0);
        await expect.poll(() => calls.filter(call => call.pathname.endsWith('/planned/read')).length, String(selectedTeams)).toBe(1);
        await page.waitForTimeout(300);
        expect(server.state.gets, 'no per-Team document read').toBe(0);
        expect(calls.filter(call => call.pathname.endsWith('/planned/read')).map(call => [...call.body.teamIds].sort())).toEqual([['team-alpha', 'team-beta']]);
    }
});

test('rows merge by person, the Unassigned row leads, and totals add up', async ({ page }) => {
    const server = capacityServer({ rows: [
        { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: '1', notes: 'away Friday', removed: false },
        { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false },
    ] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(rowOf(page, 'unassigned')).toHaveClass(/planning-review-zero-sp/);
    const list = await names(page);
    expect(list[0]).toBe('Unassigned');
    expect(list.slice(1)).toEqual(['Ann Synthetic', 'Bob Synthetic', 'Cy Former']);
    expect(new Set(list).size, 'no person appears twice').toBe(list.length);
    const cells = async key => rowOf(page, key).locator('td').evaluateAll(tds => tds.map(td => (td.querySelector('input')?.value ?? td.textContent).trim()));
    const ann = await cells('acc-ann');
    // Columns: Assignee, Planned capacity, Estimated effort, Vacations, Notes (no Total effort column).
    expect(await table(page).locator('thead th').evaluateAll(ths => ths.map(th => th.textContent.trim()))).toEqual(['Assignee', 'Planned capacity', 'Estimated effort', 'Vacations', 'Notes']);
    expect([ann[1], ann[2], ann[3], ann[4]]).toEqual(['8', '5 (under capacity)', '1', 'away Friday']);
    expect((await cells('unassigned'))[2]).toBe('4');
    expect(await rowOf(page, 'unassigned').locator('td').count()).toBe(5);
    // Every Story of the Team is checked: Estimated effort = people + Unassigned = 14; Planned capacity 11; Vacations 1.
    const totals = await table(page).locator('tfoot td').evaluateAll(tds => tds.map(td => td.textContent.trim()));
    expect(totals).toEqual(['Total', '11', '14 (over capacity)', '1', '']);
    // The identity: every row's Estimated effort plus Unassigned is the Total.
    const rowEffort = await table(page).locator('tbody tr').evaluateAll(trs => trs.map(tr => Number(tr.children[2].firstChild?.textContent || 0)));
    expect(rowEffort.reduce((sum, value) => sum + value, 0)).toBe(14);
    await expect(strip(page).getByText(/may be incomplete/)).toHaveCount(0);
});

test('inherited Capacity is gray with one hint, a Vacations edit keeps it, and only that field is sent', async ({ page }) => {
    const server = capacityServer({ inherited: { fromSprintId: '1999', rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '6', vacations: '9', notes: 'old', removed: false }] } });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(strip(page).getByText(`Inherited from ${earlierSprintName}. Editing any value saves this Sprint's own copy.`, { exact: true })).toHaveCount(1);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await expect(capacity).toHaveValue('6');
    await expect(capacity.locator('xpath=ancestor::td')).toHaveClass(/planning-assignee-inherited/);
    expect(await capacity.evaluate(node => getComputedStyle(node).color)).not.toBe(await rowOf(page, 'acc-bob').getByRole('textbox', { name: 'Vacations for Bob Synthetic' }).evaluate(node => getComputedStyle(node).color));
    // Inherited Vacations and Notes are not shown.
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Vacations for Ann Synthetic' })).toHaveValue('');
    // Tabbing across a gray cell sends nothing.
    await capacity.focus(); await capacity.press('Tab'); await page.waitForTimeout(400);
    expect(server.state.patches).toHaveLength(0);
    const vacations = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Vacations for Ann Synthetic' });
    await vacations.fill('2'); await vacations.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-ann', vacations: '2' }]);
    expect(server.state.patches[0].headers['x-csrf-token']).toBe('csrf-token');
    await expect(capacity).toHaveValue('6');
    await expect(capacity.locator('xpath=ancestor::td')).not.toHaveClass(/planning-assignee-inherited/);
    await expect(strip(page).getByText('Inherited from')).toHaveCount(0);
});

test('three quick edits across one row produce at most two PATCHes', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: null, vacations: null, notes: null, removed: false }], delayPatch: 150 });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const row = rowOf(page, 'acc-ann');
    await row.getByRole('textbox', { name: 'Capacity for Ann Synthetic' }).fill('7.5');
    await row.getByRole('textbox', { name: 'Vacations for Ann Synthetic' }).fill('1');
    await row.getByRole('textbox', { name: 'Notes for Ann Synthetic' }).fill('on call');
    await row.getByRole('textbox', { name: 'Notes for Ann Synthetic' }).press('Enter');
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    expect(server.state.patches.length).toBeLessThanOrEqual(2);
    expect(server.state.rows.find(entry => entry.assigneeKey === 'acc-ann')).toMatchObject({ capacity: '7.5', vacations: '1', notes: 'on call' });
    await expect(strip(page).locator('[role="alert"]')).toHaveCount(0);
});

test('an invalid draft stays in its cell with an error and is not sent; Escape cancels', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '4', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('12.345'); await capacity.press('Enter');
    await expect(capacity).toHaveAttribute('aria-invalid', 'true');
    await expect(capacity).toHaveValue('12.345');
    await expect(rowOf(page, 'acc-ann').locator('.planning-review-validation')).toHaveText(/two decimals/);
    await page.waitForTimeout(400);
    expect(server.state.patches).toHaveLength(0);
    await capacity.fill('9'); await capacity.press('Escape');
    await expect(capacity).toHaveValue('4');
    await page.waitForTimeout(400);
    expect(server.state.patches).toHaveLength(0);
});

test('Remove is unavailable for people with Stories; a removed person moves to the strip and restores with one tap', async ({ page }) => {
    const server = capacityServer({ rows: [
        { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false },
        { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false },
    ] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(rowOf(page, 'acc-ann').getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await expect(strip(page).locator('.planning-assignee-removed')).toHaveCount(0);
    await rowOf(page, 'acc-cy').getByRole('button', { name: 'Remove Cy Former' }).click();
    await expect(rowOf(page, 'acc-cy')).toHaveCount(0);
    await expect(strip(page).locator('.planning-assignee-removed')).toHaveText(/^Removed from this Sprint and later ones:\s*Cy Former$/);
    expect(await strip(page).locator('.planning-assignee-removed').textContent()).not.toContain('☹');
    expect(await strip(page).getByRole('button', { name: 'Restore Cy Former' }).evaluate(node => getComputedStyle(node).textDecorationLine)).toBe('underline');
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-cy', removed: true }]);
    await strip(page).getByRole('button', { name: 'Restore Cy Former' }).click();
    await expect(rowOf(page, 'acc-cy')).toHaveCount(1);
    await expect(rowOf(page, 'acc-cy').getByRole('textbox', { name: 'Capacity for Cy Former' })).toHaveValue('3');
    await expect(strip(page).locator('.planning-assignee-removed')).toHaveCount(0);
    await expect.poll(() => server.state.patches.at(-1).body.changes).toEqual([{ assigneeKey: 'acc-cy', removed: false }]);
});

test('read-only capability disables the inputs; read failure shows a retry', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }], capabilities: { canRead: true, canSave: false, reason: 'database_required' } });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(strip(page).getByText('Assignee capacity is read-only here.')).toBeVisible();
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toBeDisabled();
    await expect(strip(page).getByRole('combobox', { name: /Add assignee/ }), 'read-only hides Add assignee').toHaveCount(0);
});

test('geometry and a settled screenshot of every control kind', async ({ page }) => {
    const server = capacityServer({
        inherited: { fromSprintId: '1999', rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '6', vacations: null, notes: null, removed: false }, { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false }, { assigneeKey: 'acc-zed', displayName: 'Zed Removed With A Remarkably Long Display Name That Overflows', capacity: '2', vacations: null, notes: null, removed: true }] },
    });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    // A removed person only exists in a saved document: remove Cy so the sad-face strip shows in the specimen.
    await rowOf(page, 'acc-cy').getByRole('button', { name: 'Remove Cy Former' }).click();
    await expect(strip(page).locator('.planning-assignee-removed')).toBeVisible();
    await rowOf(page, 'acc-bob').getByRole('textbox', { name: 'Notes for Bob Synthetic' }).fill('A deliberately long note that does not fit in the notes column of this table at all');
    await rowOf(page, 'acc-bob').getByRole('textbox', { name: 'Notes for Bob Synthetic' }).press('Enter');
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    const measure = await page.evaluate(() => {
        const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
        const wrapper = document.querySelector('[data-assignee-capacity] .capacity-grid-wrapper');
        const wrap = box(wrapper);
        const inputs = [...document.querySelectorAll('[data-assignee-capacity] .planning-review-input')].map(node => ({ label: node.getAttribute('aria-label'), ...box(node), cell: box(node.closest('td')), align: getComputedStyle(node).textAlign }));
        const headers = [...document.querySelectorAll('[data-assignee-capacity] thead th')].map(node => ({ text: node.textContent.trim(), align: getComputedStyle(node).textAlign }));
        const body = [...document.querySelectorAll('[data-assignee-capacity] tbody td.planning-review-storyPoints')].map(node => getComputedStyle(node).textAlign);
        const nameCells = [...document.querySelectorAll('[data-assignee-capacity] .planning-assignee-person')].map(node => ({ box: box(node), cell: box(node.closest('td')), clipped: node.querySelector('.planning-review-truncated-value').scrollWidth > node.querySelector('.planning-review-truncated-value').clientWidth }));
        const remove = [...document.querySelectorAll('[data-assignee-capacity] .planning-review-column-action')].map(node => ({ ...box(node), cell: box(node.closest('td')) }));
        const toggle = box(document.querySelector('[data-assignee-capacity] .capacity-header-toggle'));
        return { wrap, inputs, headers, body, nameCells, remove, toggle, overflowX: wrapper.scrollWidth - wrapper.clientWidth };
    });
    for (const input of measure.inputs) {
        expect(input.height, input.label).toBeGreaterThanOrEqual(21); expect(input.height, input.label).toBeLessThanOrEqual(23);
        expect(input.left, input.label).toBeGreaterThanOrEqual(input.cell.left - 0.5); expect(input.right, input.label).toBeLessThanOrEqual(input.cell.right + 0.5);
        if (!input.label.startsWith('Notes')) expect(input.align, input.label).toBe('right');
    }
    expect(measure.headers.filter(header => ['Planned capacity', 'Estimated effort', 'Vacations'].includes(header.text)).map(header => header.align)).toEqual(['right', 'right', 'right']);
    expect(measure.headers.filter(header => ['Assignee', 'Notes'].includes(header.text)).map(header => header.align)).toEqual(['left', 'left']);
    expect(new Set(measure.body)).toEqual(new Set(['right']));
    for (const entry of measure.nameCells) { expect(entry.box.right).toBeLessThanOrEqual(entry.cell.right + 0.5); }
    for (const entry of measure.remove) { expect(entry.width).toBeCloseTo(24, 0); expect(entry.right).toBeLessThanOrEqual(entry.cell.right + 0.5); }
    expect(measure.toggle.height).toBeLessThanOrEqual(40);
    await page.screenshot({ path: 'tmp/323-ui/assignee-capacity-expanded.png', fullPage: false });
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/323-ui/assignee-capacity-strip.png' });
});

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`the compact panel and the pinned stack keep their height with one Team and the strip expanded at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const panel = await page.locator('.planning-panel').boundingBox();
    expect(panel.height).toBeLessThan(64);
    const stack = await page.locator('.planning-review-sticky-stack').boundingBox();
    expect(stack.height).toBeLessThanOrEqual(175);
});

test('hover on the strip toggle and the cell inputs changes only paint, never geometry', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const input = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    const before = await input.boundingBox(), toggleBefore = await stripToggle(page).boundingBox();
    await input.hover(); await stripToggle(page).hover();
    expect(await input.boundingBox()).toEqual(before);
    expect(await stripToggle(page).boundingBox()).toEqual(toggleBefore);
});

test('a touch tap toggles the strip, removes and restores', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await stripToggle(page).tap(); await expect(table(page)).toBeVisible();
    await rowOf(page, 'acc-cy').getByRole('button', { name: 'Remove Cy Former' }).tap();
    await strip(page).getByRole('button', { name: 'Restore Cy Former' }).tap();
    await expect(rowOf(page, 'acc-cy')).toHaveCount(1);
    await context.close();
});

// ---- underbar (#323 Task 5) -------------------------------------------------------------------

const underbarRows = [
    { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-bob', displayName: 'Bob Synthetic', capacity: '6', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: null, vacations: null, notes: null, removed: false },
];
// People Capacity 12 + 10 above Team Cap 20 (revision 4 drew a "+6 SP over" mark here; the strip is now Estimated effort,
// so it ends with the Selected fill and nothing is drawn past it).
const bigCapacityRows = [
    { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '12', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-bob', displayName: 'Bob Synthetic', capacity: '10', vacations: null, notes: null, removed: false },
];
const underbar = page => page.locator('.planning-panel [data-assignee-underbar]');
const segments = page => underbar(page).locator('.stacked-bar-segment');
const readout = page => page.locator('.stacked-bar-readout');
async function expectReadoutInViewport(page) {
    const viewport = page.viewportSize();
    await expect(readout(page)).toBeVisible();
    await expect.poll(async () => (await readout(page).boundingBox()) !== null).toBe(true);
    const box = await readout(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test('the underbar arrives with the document without expanding the strip, and its late arrival keeps the pinned height', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows, holdGet: true });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    // The compact overview hides the graphs (2026-11-06): open the details to see the bar.
    await showCapacityDetails(page);
    await expect(page.locator('.planning-panel-capacity-graph .capacity-bar-track')).toBeVisible();
    await expect.poll(() => server.state.gets).toBe(1);
    // Loading: no strip yet, and the expanded body says so.
    await expect(underbar(page)).toHaveCount(0);
    const before = { panel: (await page.locator('.planning-panel').boundingBox()).height, stack: (await page.locator('.planning-review-sticky-stack').boundingBox()).height };
    await stripToggle(page).click();
    await expect(strip(page).getByRole('status').filter({ hasText: 'Loading assignee capacity…' })).toBeVisible();
    await stripToggle(page).click();
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    server.state.release();
    await expect(underbar(page)).toHaveCount(1);
    await expect(segments(page)).toHaveCount(3);
    const after = { panel: (await page.locator('.planning-panel').boundingBox()).height, stack: (await page.locator('.planning-review-sticky-stack').boundingBox()).height };
    expect(after.panel).toBeCloseTo(before.panel, 0);
    expect(after.stack).toBeCloseTo(before.stack, 0);
    // With the strip arrived, the compact overview keeps the DoD 14 bounds.
    await page.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
    const compact = { panel: (await page.locator('.planning-panel').boundingBox()).height, stack: (await page.locator('.planning-review-sticky-stack').boundingBox()).height };
    expect(compact.panel).toBeLessThan(64);
    expect(compact.stack).toBeLessThanOrEqual(175);
    expect(server.state.gets).toBe(1);
});

test('DoD 3 and 9: the table\'s Selected total equals the bar\'s Selected for the Team, and the team number is read from the pinned bar', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    // The compact overview hides the graphs (2026-11-06): open the details with the visible button first.
    await showCapacityDetails(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    const footer = await table(page).locator('tfoot td').evaluateAll(tds => tds.map(td => td.textContent.trim()));
    const fillLabel = await page.locator('.planning-panel-capacity-graph .capacity-bar-fill .capacity-bar-fill-label').textContent();
    const [, barSelected] = /planned stories · ([\d.]+) SP/.exec(fillLabel);
    const [, teamNumber] = /Capacity\s*([\d.]+)/.exec(await page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label').textContent());
    expect(Number(footer[2])).toBe(Number(barSelected));
    expect(Number(barSelected)).toBe(14);
    // A segment's readout is about the person; the bar's Selected number is in the header-only readout past the last segment.
    await segments(page).nth(0).hover();
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expect(readout(page)).not.toContainText('Selected');
    // The team number lives on the pinned bar (Team Cap marker); in the table only the Totals row's
    // Planned capacity carries it, after the people's sum (operator review, #323).
    expect(Number(teamNumber)).toBe(20);
    await page.mouse.move(5, 400);
    await showCapacityDetails(page);
    await expect(page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label')).toHaveText(/Capacity\s*20\.0/);
    const headers = await table(page).locator('thead th').evaluateAll(ths => ths.map(th => th.textContent.trim()));
    expect(headers).toEqual(['Assignee', 'Planned capacity', 'Estimated effort', 'Vacations', 'Notes']);
    expect(footer[1], 'the people\'s Planned capacity sum out of the team number').toBe('14 / 20');
});

test('segments are one per person with Planned capacity or effort plus Unassigned, distinct, max(capacity, effort) wide on the bar axis; the readout stays on screen', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await showCapacityDetails(page);
    await expand(page);
    // Ann 5 and Bob 5 (Capacity 8 and 6), Unassigned 4; Cy has Capacity unset and nothing selected, so no segment.
    await expect(segments(page)).toHaveCount(3);
    const unassignedEffort = Number((await rowOf(page, 'unassigned').locator('td').nth(2).textContent()).trim());
    expect(unassignedEffort).toBe(4);
    const measure = await page.evaluate(() => {
        const track = document.querySelector('[data-assignee-underbar] .stacked-bar-track').getBoundingClientRect();
        const outer = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
        const cap = document.querySelector('.planning-panel-capacity-graph .capacity-bar-marker.teamcap').getBoundingClientRect();
        const fill = document.querySelector('.planning-panel-capacity-graph .capacity-bar-fill').getBoundingClientRect();
        const list = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')];
        return { trackWidth: track.width, trackHeight: track.height, outerBottom: outer.bottom, trackBottom: track.bottom, outerHeight: outer.height,
            capX: cap.left + cap.width / 2 - track.left, fillRight: fill.right, stripLeft: list[0].getBoundingClientRect().left, stripRight: list[list.length - 1].getBoundingClientRect().right, fillLeft: fill.left,
            segments: list.map(node => ({ label: node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, color: getComputedStyle(node).backgroundColor })) };
    });
    expect(measure.trackHeight).toBeGreaterThanOrEqual(4); expect(measure.trackHeight).toBeLessThanOrEqual(6);
    expect(measure.trackBottom).toBeLessThanOrEqual(measure.outerBottom + 0.5);
    expect(new Set(measure.segments.map(segment => segment.color)).size).toBe(3);
    expect(measure.segments.map(segment => segment.label).some(label => label.includes('Cy Former'))).toBe(false);
    // Axis max(capacity 20, selected 14, strip 8 + 6 + 4 = 18) x 1.15 = 23. Slice 9: Ann 5/23, Bob 5/23, Unassigned 4/23,
    // the strip ending with the Selected 14/23. Round 3: each person is max(capacity, effort) wide, Ann 8/23, Bob 6/23,
    // Unassigned (effort only) 4/23, so the strip ends at 18/23, past the fill and before the Team Cap at 20/23.
    expect(measure.segments[0].width / measure.trackWidth).toBeCloseTo(8 / 23, 2);
    expect(measure.segments[1].width / measure.trackWidth).toBeCloseTo(6 / 23, 2);
    expect(measure.segments[2].label).toContain('Unassigned (effort)');
    expect(measure.segments[2].width / measure.trackWidth).toBeCloseTo(unassignedEffort / 23, 2);
    expect(measure.capX / measure.trackWidth).toBeCloseTo(20 / 23, 2);
    expect((measure.stripRight - measure.stripLeft) / measure.trackWidth, 'the strip spans 18/23').toBeCloseTo(18 / 23, 2);
    expect(measure.stripRight, 'the strip runs past the Selected fill').toBeGreaterThan(measure.fillRight + 10);
    expect(Math.abs(measure.stripLeft - measure.fillLeft)).toBeLessThanOrEqual(1);
    await expect(underbar(page).locator('[data-assignee-overflow], .planning-assignee-overflow')).toHaveCount(0);
    const before = await page.locator('.planning-panel').boundingBox();
    await segments(page).nth(2).hover();
    await expect(readout(page)).toContainText('Unassigned (effort)');
    await expect(readout(page)).toContainText(`${unassignedEffort} SP effort`);
    await expect(readout(page)).toContainText('29% of selected');
    await expect(readout(page)).not.toContainText('Total');
    await expectReadoutInViewport(page);
    expect(await page.locator('.planning-panel').boundingBox()).toEqual(before);
    expect(await readout(page).evaluate(node => node.hasAttribute('title') || node.closest('[title]') !== null)).toBe(false);
    await segments(page).nth(0).hover();
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expect(readout(page)).toContainText('5 SP effort · 8 SP capacity');
    await expect(readout(page)).toContainText('3 SP capacity left');
    await expect(readout(page)).not.toContainText('% of selected');
    await expectReadoutInViewport(page);
    await page.mouse.move(5, 400);
    await expect(readout(page)).toHaveCount(0);
});

for (const [width, height] of [[1440, 900], [1280, 720]]) for (const [name, rows] of [['normal', underbarRows], ['people Capacity above Team Cap', bigCapacityRows]]) test(`the underbar adds no height to the compact panel or the pinned stack at ${width}x${height} (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = capacityServer({ rows, holdGet: true });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expect.poll(() => server.state.gets).toBe(1);
    const withoutBar = (await page.locator('.planning-panel').boundingBox()).height;
    server.state.release();
    await expand(page);
    await expect(underbar(page)).toHaveCount(1);
    const panel = await page.locator('.planning-panel').boundingBox();
    expect(panel.height).toBeLessThan(64);
    expect(panel.height).toBeCloseTo(withoutBar, 0);
    expect((await page.locator('.planning-review-sticky-stack').boundingBox()).height).toBeLessThanOrEqual(175);
});

test('tapping a segment shows its readout and a settled screenshot of the pinned panel is taken', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await showCapacityDetails(page);
    await stripToggle(page).tap(); await expect(table(page)).toBeVisible();
    await expect(segments(page)).toHaveCount(3);
    // Chromium's emulated tap moves its virtual mouse back to the last mouse position about 13 ms after the click,
    // which fires mouseleave on the tapped segment and clears the readout; park the virtual mouse on the segment so
    // the tap's readout is what stays (a real touch device has no mouse to move).
    const bob = await segments(page).nth(1).boundingBox();
    await page.mouse.move(bob.x + bob.width / 2, bob.y + bob.height / 2);
    await segments(page).nth(1).tap();
    await expect(readout(page)).toContainText('Bob Synthetic');
    await expectReadoutInViewport(page);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/323-ui/underbar-pinned-panel.png' });
    // Whole track: a tap above the strip, at Ann's x, shows Ann's readout.
    const ann = await segments(page).nth(0).boundingBox();
    const track = await page.locator('.planning-panel-capacity-graph .capacity-bar-track').boundingBox();
    await page.mouse.move(ann.x + ann.width / 2, track.y + 3);
    await page.touchscreen.tap(ann.x + ann.width / 2, track.y + 3);
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expectReadoutInViewport(page);
    await context.close();
});

// ---- strip pointer ownership, stacking and row tint (#323) ---------------------------------------

test('whole-track hover: any height resolves the segment under the pointer, past the segments a header-only readout, markers win and keep their tooltips, the fill tooltip is gone', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    // The compact overview hides the graphs (2026-11-06): open the details with the visible button first.
    await showCapacityDetails(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    const fill = page.locator('.planning-panel .capacity-bar-fill');
    const marker = page.locator('.planning-panel .capacity-bar-marker.teamcap');
    // The strip replaces the fill's CSS tooltip: no data-tooltip, so no ::after.
    await expect(fill).not.toHaveAttribute('data-tooltip', /.*/);
    const geometry = await page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const track = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track');
        const wrapper = document.querySelector('[data-assignee-underbar]');
        return { track: rect(track), wrapper: rect(wrapper), segments: [...wrapper.querySelectorAll('.stacked-bar-segment')].map(rect),
            marker: rect(document.querySelector('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-line')) };
    });
    // The wrapper covers the full track height.
    expect(geometry.wrapper.top).toBeCloseTo(geometry.track.top, 0); expect(geometry.wrapper.bottom).toBeCloseTo(geometry.track.bottom, 0);
    expect(geometry.wrapper.width).toBeCloseTo(geometry.track.width, 0);
    const [ann, bob, unassigned] = geometry.segments;
    // At the top, the middle and the strip pixels of each segment, the readout names that segment.
    for (const [segment, name] of [[ann, 'Ann Synthetic'], [bob, 'Bob Synthetic'], [unassigned, 'Unassigned (effort)']]) {
        for (const y of [geometry.track.top + 2, geometry.track.top + geometry.track.height / 2, geometry.track.bottom - 2]) {
            await page.mouse.move(5, 400);
            await page.mouse.move(segment.left + segment.width / 2, y);
            await expect(readout(page)).toContainText(name);
        }
    }
    await expect(readout(page)).toContainText('29% of selected');
    // A person segment resolves with the round-3 readout (Bob: effort 5, capacity 6).
    await page.mouse.move(5, 400);
    await page.mouse.move(bob.left + bob.width / 2, geometry.track.top + 2);
    await expect(readout(page)).toHaveText(/Bob Synthetic\s*5 SP effort · 6 SP capacity\s*1 SP capacity left/);
    // Past the last segment and off the marker: the bar's Selected number and the team capacity source.
    const pastX = (unassigned.right + geometry.marker.left) / 2;
    expect(pastX).toBeGreaterThan(unassigned.right + 2);
    await page.mouse.move(pastX, geometry.track.top + 3);
    await expect(readout(page)).toHaveText(/^Selected 4 tasks · 14\.0 SP\s*Team capacity: Jira$/);
    await page.mouse.move(geometry.track.right - 3, geometry.track.top + 3);
    await expect(readout(page)).toHaveText(/^Selected 4 tasks · 14\.0 SP\s*Team capacity: Jira$/);
    // At the marker the marker wins (z-order asserted by hit testing at the strip's pixels too) and shows its tooltip.
    const markerX = geometry.marker.left + geometry.marker.width / 2;
    const winners = await page.evaluate(({ x, ys }) => ys.map(y => {
        const hit = document.elementFromPoint(x, y);
        return { marker: Boolean(hit?.closest('.capacity-bar-marker.teamcap')), strip: Boolean(hit?.closest('[data-assignee-underbar]')) };
    }), { x: markerX, ys: [geometry.track.top + 2, geometry.track.top + geometry.track.height / 2, geometry.track.bottom - 2] });
    expect(winners).toEqual([{ marker: true, strip: false }, { marker: true, strip: false }, { marker: true, strip: false }]);
    const zIndex = await page.evaluate(() => ({ marker: getComputedStyle(document.querySelector('.planning-panel .capacity-bar-marker.teamcap')).zIndex, strip: getComputedStyle(document.querySelector('[data-assignee-underbar]')).zIndex }));
    expect(zIndex).toEqual({ marker: '42', strip: '41' });
    await page.mouse.move(5, 400);
    await page.mouse.move(markerX, geometry.track.top + 3);
    await expect.poll(() => marker.evaluate(shownTooltip)).toContain('Estimated total team capacity');
    await expect(readout(page)).toHaveCount(0);
    // A segment's own pixels stay topmost under the strip (no fill above them).
    const topmost = await page.evaluate(() => [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === node;
    }));
    expect(topmost).toEqual([true, true, true]);
});

const overflowMark = page => underbar(page).locator('[data-assignee-overflow], .planning-assignee-overflow');
// The overview starts compact and hides the graphs; Show capacity details is a direct overview button (2026-11-06).
async function showCapacityDetails(page) {
    const show = page.getByRole('button', { name: 'Show capacity details', exact: true });
    // Already expanded (an earlier step showed the details): nothing to do.
    if (await show.count()) { await show.click(); await expect(page.getByRole('button', { name: 'Hide capacity details', exact: true })).toBeVisible(); }
}

test('people Capacity above Team Cap widens the shared axis: the strip is not clipped, no overflow mark, and the Team Cap marker stays on the axis, expanded and compact', async ({ page }) => {
    const server = capacityServer({ rows: bigCapacityRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    // Compact hides the graphs (2026-11-06); the details show them.
    await expect(page.locator('#planning-panel-details')).toBeHidden();
    await showCapacityDetails(page);
    await expand(page);
    // Capacity 12 + 10 + Unassigned 4 = 26 against Team Cap 20, Selected 14: the axis is 26 x 1.15 = 29.9 (slice 9: 23,
    // the strip ending with the fill at 14/23), so the strip ends at 26/29.9, past the Team Cap at 20/29.9.
    await expect(segments(page)).toHaveCount(3);
    await expect(page.locator('.planning-panel .capacity-bar-variance-zone.visible')).toHaveCount(0);
    await expect(page.locator('.planning-panel-capacity-graph .capacity-bar-fill .capacity-bar-fill-label')).toHaveText('4 planned stories · 14.0 SP');
    await expect(page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label')).toHaveText(/Capacity\s*20\.0 SP/);
    const measure = () => page.evaluate(() => {
        const list = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => node.getBoundingClientRect());
        const track = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
        const wrapper = document.querySelector('[data-assignee-underbar]').getBoundingClientRect();
        const cap = document.querySelector('.planning-panel .capacity-bar-marker.teamcap').getBoundingClientRect();
        const fill = document.querySelector('.planning-panel .capacity-bar-fill').getBoundingClientRect();
        return { stripEnd: list[list.length - 1].right, wrapperRight: wrapper.right, fillRatio: (fill.right - track.left) / track.width,
            ratio: (list[list.length - 1].right - track.left) / track.width, capRatio: (cap.left + cap.width / 2 - track.left) / track.width,
            widths: list.map(rect => rect.width / track.width), track: { top: track.top } };
    });
    for (const mode of ['expanded']) {
        await page.evaluate(() => document.activeElement?.blur()); await expect(page.locator('.planning-panel .capacity-bar-marker-label').first()).toBeVisible();
        await expect(page.locator('.planning-panel [data-assignee-overflow], .planning-panel .planning-assignee-overflow'), mode).toHaveCount(0);
        await expect(page.locator('.planning-panel').getByText(/SP over/), mode).toHaveCount(0);
        const m = await measure();
        expect(m.ratio, mode).toBeCloseTo(26 / 29.9, 2);
        expect(m.widths[0], mode).toBeCloseTo(12 / 29.9, 2);
        expect(m.widths[1], mode).toBeCloseTo(10 / 29.9, 2);
        expect(m.widths[2], mode).toBeCloseTo(4 / 29.9, 2);
        expect(m.capRatio, `${mode}: the Team Cap marker is on the same axis`).toBeCloseTo(20 / 29.9, 2);
        expect(m.fillRatio, `${mode}: the fill is on the same axis`).toBeCloseTo(14 / 29.9, 2);
        expect(m.stripEnd, `${mode}: the strip is not clipped`).toBeLessThan(m.wrapperRight - 1);
        await page.mouse.move(5, 400);
        await page.mouse.move(m.stripEnd - 3, m.track.top + 3);
        await expect(readout(page)).toContainText('Unassigned (effort)');
        await expect(readout(page)).not.toContainText('over Team Cap');
        await expectReadoutInViewport(page);
        await page.mouse.move(5, 400);
        await page.locator('.planning-panel').screenshot({ path: `tmp/slice10-shots/pinned-bar-big-capacity-${mode}.png`, animations: 'disabled' });
    }
});

test('over capacity: the strip spans the clipped fill and the bar\'s own over-capacity zone and runs on to the people\'s capacity', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    // Team Cap 10: selected 14 is above 120%, so the bar is over. The strip is Ann 8 + Bob 6 + Unassigned 4 = 18 on the
    // axis 18 x 1.15 = 20.7 (slice 9: it ended with the zone at 14), so it runs past the zone's end (14/20.7) to 18/20.7.
    await page.route('**/api/capacity?*', route => json(route, { enabled: true, mutationEnabled: false, sprint: new URL(route.request().url()).searchParams.get('sprint'), capacities: { 'Alpha Team': 10 }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: 10 }] }));
    await openPlanning(page);
    // The compact overview hides the graphs (2026-11-06): open the details with the visible button first.
    await showCapacityDetails(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    await expect(page.locator('.planning-panel .capacity-bar-variance-zone.visible')).toHaveCount(1);
    await expect(overflowMark(page)).toHaveCount(0);
    await expect(page.locator('.planning-panel-capacity-graph .capacity-bar-fill .capacity-bar-fill-label')).toHaveText('4 planned stories · 14.0 SP');
    await expect(page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label')).toHaveText(/Capacity\s*10\.0 SP/);
    const ends = await page.evaluate(() => {
        const list = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => node.getBoundingClientRect());
        const track = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
        const ratio = x => (x - track.left) / track.width;
        return { strip: ratio(list[list.length - 1].right), zone: ratio(document.querySelector('.planning-panel .capacity-bar-variance-zone.visible').getBoundingClientRect().right) };
    });
    expect(ends.zone).toBeCloseTo(14 / 20.7, 2);
    expect(ends.strip).toBeCloseTo(18 / 20.7, 2);
    await segments(page).nth(0).hover();
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expect(readout(page)).not.toContainText('over Team Cap');
    await showCapacityDetails(page);
    await expect(overflowMark(page)).toHaveCount(0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(5, 400);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice9-shots/pinned-bar-over-capacity.png', animations: 'disabled' });
    // The team card's bar on the shared scale: over capacity it no longer saturates (fill 14/(14 x 1.3), marker 10/(14 x 1.3)).
    const card = await page.locator('.team-stat-card .microbar').evaluate(bar => {
        const box = bar.getBoundingClientRect();
        return { fill: bar.querySelector('.microbar-fill').getBoundingClientRect().width / box.width,
            marker: (bar.querySelector('.microbar-marker').getBoundingClientRect().left + bar.querySelector('.microbar-marker').getBoundingClientRect().width / 2 - box.left) / box.width };
    });
    expect(card.fill).toBeCloseTo(1 / 1.3, 2);
    expect(card.marker).toBeCloseTo(10 / (14 * 1.3), 1);
    await page.mouse.move(5, 400);
    await page.locator('.team-stat-card').first().screenshot({ path: 'tmp/slice1-shots/card-bar-over.png', animations: 'disabled' });
});

for (const mode of ['compact', 'expanded']) test(`readouts stay inside the viewport at the left, right and top edges (${mode} panel, pinned and unpinned)`, async ({ page }) => {
    const server = capacityServer({ rows: bigCapacityRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    // The overview starts compact with the graphs hidden; both modes open the details with the visible button.
    if (mode === 'compact') await expect(page.locator('#planning-panel-details')).toBeHidden();
    await showCapacityDetails(page);
    await expect(segments(page)).toHaveCount(3);
    for (const scrolled of [false, true]) {
        if (scrolled) {
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await expect.poll(() => page.locator('.planning-panel').evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(200);
            // The pinned stack settles after the scroll (its position changes for a few frames): read the track only once
            // it is still across two frames and its top-left pixel hit-tests inside it, so the edge points are real.
            await expect.poll(() => page.evaluate(async () => {
                const track = () => document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
                const first = track();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const second = track();
                return first.top === second.top && Boolean(document.elementFromPoint(second.left + 2, second.top + 2)?.closest('.capacity-bar-track'));
            })).toBe(true);
        }
        const g = await page.evaluate(() => {
            const r = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
            const s = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => node.getBoundingClientRect());
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, stripEnd: s[s.length - 1].right };
        });
        // Left edge (first segment, 5 lines), the strip end (5 lines), the track's right end (header only), top row pixels.
        // 2px in: the track's 5px rounded corners clip hit-testing in Firefox, so a 1px corner pixel belongs to the graph there.
        for (const [x, y, text] of [[g.left + 2, g.top + 2, 'Ann Synthetic'], [g.stripEnd - 1, g.top + 2, 'Unassigned (effort)'], [g.right - 2, g.top + 2, 'Selected 4 tasks'], [g.left + 2, g.bottom - 2, 'Ann Synthetic']]) {
            await page.mouse.move(5, 5);
            await page.mouse.move(x, y);
            await expect(readout(page), `${mode} scrolled=${scrolled} x=${x}`).toContainText(text);
            await expectReadoutInViewport(page);
        }
        if (!scrolled) {
            await page.mouse.move(g.left + 2, g.top + 2);
            await page.screenshot({ path: `tmp/slice1-shots/strip-readout-${mode}.png`, clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(page.viewportSize().height, g.bottom + 200) }, animations: 'disabled' });
        }
    }
});

test('settled screenshots of the strip in the normal case, compact and expanded, and the card bar', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    await page.mouse.move(5, 400);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice1-shots/strip-normal-compact.png', animations: 'disabled' });
    await showCapacityDetails(page);
    await expect(page.locator('.planning-panel .capacity-bar-marker-label').first()).toBeVisible();
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice1-shots/strip-normal-expanded.png', animations: 'disabled' });
    await page.locator('.team-stat-card').first().screenshot({ path: 'tmp/slice1-shots/card-bar-normal.png', animations: 'disabled' });
});

test('each person row with a segment (Planned capacity or effort) is tinted with its colour; rows with neither and Unassigned keep their own surface; geometry is unchanged', async ({ page }) => {
    // Zoe has Capacity 5 but no Stories: a tinted-only segment, so her row is tinted too (slice 9: no segment, no tint).
    const server = capacityServer({ rows: [...underbarRows, { assigneeKey: 'acc-zoe', displayName: 'Zoe Capacity Only', capacity: '5', vacations: null, notes: null, removed: false }] });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(4);
    const measure = () => page.evaluate(() => {
        const probe = document.createElement('i');
        document.body.appendChild(probe);
        const resolve = value => { probe.style.background = value; return getComputedStyle(probe).backgroundColor; };
        const surface = getComputedStyle(document.querySelector('[data-assignee-capacity]')).getPropertyValue('--bg-secondary').trim();
        // The person colour: the segment's colour, or the colour its tinted layer mixes (tinted-only and capacity-on-the-bottom segments).
        const solid = node => { const value = node.style.getPropertyValue('--stacked-bar-color'); const mix = /color-mix\(in srgb, (\S+) /.exec(value); return resolve(mix ? mix[1] : value); };
        const segmentColors = Object.fromEntries([...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')]
            .map(node => [node.getAttribute('aria-label').replace(/^Assignee capacity /, '').split(': ')[0], solid(node)]));
        const rows = Object.fromEntries([...document.querySelectorAll('[data-assignee-capacity] tbody tr')].map(tr => {
            const box = node => { const r = node.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
            return [tr.dataset.assigneeKey, {
                tinted: tr.classList.contains('planning-assignee-tinted'), colorVar: tr.style.getPropertyValue('--planning-assignee-color'),
                cellBackgrounds: [...tr.children].map(td => getComputedStyle(td).backgroundColor), color: getComputedStyle(tr.children[2]).color,
                boxes: [box(tr), ...[...tr.children].map(box)],
                expectedMix: tr.style.getPropertyValue('--planning-assignee-color') ? resolve(`color-mix(in srgb, ${tr.style.getPropertyValue('--planning-assignee-color')} 12%, ${surface})`) : null,
                varColor: tr.style.getPropertyValue('--planning-assignee-color') ? resolve(tr.style.getPropertyValue('--planning-assignee-color')) : null,
                plain: resolve(surface), unassignedPlain: resolve('#fff1f0'),
            }];
        }));
        probe.remove();
        return { rows, segmentColors };
    });
    const withTint = await measure();
    expect(withTint.segmentColors['Ann Synthetic']).toBe(withTint.rows['acc-ann'].varColor);
    expect(withTint.segmentColors['Bob Synthetic']).toBe(withTint.rows['acc-bob'].varColor);
    expect(withTint.rows['acc-zoe'].varColor).toBeTruthy();
    for (const key of ['acc-ann', 'acc-bob', 'acc-zoe']) {
        expect(withTint.rows[key].tinted, key).toBe(true);
        expect(new Set(withTint.rows[key].cellBackgrounds), key).toEqual(new Set([withTint.rows[key].expectedMix]));
        expect(withTint.rows[key].expectedMix, key).not.toBe(withTint.rows[key].plain);
    }
    expect(withTint.rows['acc-ann'].expectedMix).not.toBe(withTint.rows['acc-bob'].expectedMix);
    // Neither Capacity nor Estimated effort (Cy): no segment, no tint. Unassigned keeps its warning-tone row.
    expect(withTint.rows['acc-cy'].tinted).toBe(false);
    expect(new Set(withTint.rows['acc-cy'].cellBackgrounds)).toEqual(new Set([withTint.rows['acc-cy'].plain]));
    expect(Object.keys(withTint.segmentColors)).not.toContain('Cy Former');
    expect(new Set(withTint.rows.unassigned.cellBackgrounds)).toEqual(new Set([withTint.rows.unassigned.unassignedPlain]));
    await page.mouse.move(5, 400);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/323-ui/assignee-tinted-rows.png', animations: 'disabled' });
    await strip(page).screenshot({ path: 'tmp/slice9-shots/strip-expanded-full-width.png', animations: 'disabled' });
    await page.screenshot({ path: 'tmp/323-ui/assignee-tinted-rows-with-panel.png', animations: 'disabled' });
    // Geometry: removing the tint class changes only paint.
    await page.evaluate(() => document.querySelectorAll('.planning-assignee-tinted').forEach(tr => tr.classList.remove('planning-assignee-tinted')));
    const withoutTint = await measure();
    for (const key of Object.keys(withTint.rows)) expect(withoutTint.rows[key].boxes, key).toEqual(withTint.rows[key].boxes);
    expect(withoutTint.rows['acc-ann'].cellBackgrounds[0]).toBe(withTint.rows['acc-ann'].plain);
    // Tinted text stays the inherited gray; the over/under cue colours are untouched.
    expect(withTint.rows['acc-ann'].color).toBe(withoutTint.rows['acc-ann'].color);
});

test('where the strip has no segment the team-cap marker stays hoverable down to the bottom edge of the track', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '2', vacations: null, notes: null, removed: false }] });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    // The compact overview hides the graphs (2026-11-06): open the details with the visible button first.
    await showCapacityDetails(page);
    await expand(page);
    await expect(underbar(page)).toHaveCount(1);
    const gap = await page.evaluate(() => {
        const bottom = document.querySelector('.planning-panel .capacity-bar-track').getBoundingClientRect().bottom - 2;
        const lastSegment = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].pop().getBoundingClientRect();
        const markerRect = document.querySelector('.planning-panel .capacity-bar-marker.teamcap').getBoundingClientRect();
        const x = markerRect.left + markerRect.width / 2;
        const hit = document.elementFromPoint(x, bottom);
        return { x, segmentEnd: lastSegment.right, onMarker: Boolean(hit && hit.closest('.capacity-bar-marker.teamcap')) };
    });
    expect(gap.x).toBeGreaterThan(gap.segmentEnd + 1);
    expect(gap.onMarker).toBe(true);

    const marker = page.locator('.planning-panel .capacity-bar-marker.teamcap');
    const box = await marker.boundingBox();
    await page.mouse.move(gap.x, box.y + box.height - 2);
    await expect.poll(() => marker.evaluate(shownTooltip)).toContain('Estimated total team capacity');
    expect(box.height).toBeGreaterThan(5);
});

// ---- Task 6b: cues, states, failures and copy (#323) ----------------------------------------------

const footerSelected = page => table(page).locator('tfoot td').nth(2);

test('the Totals cue compares the displayed Selected total, Unassigned included, with the sum of Capacity', async ({ page }) => {
    // Capacity 8 + 3 = 11; displayed Selected 14 (people 10 + Unassigned 4) is above 120% of 11, people alone (10) are not.
    const server = capacityServer({ rows: [
        { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false },
        { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false },
    ] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(footerSelected(page)).toHaveText(/^14/);
    await expect(footerSelected(page)).toHaveClass(/planning-assignee-over/);
    await expect(footerSelected(page).locator('.planning-review-sr-only')).toHaveText(' (over capacity)');
});

test('empty state: a Team with only Killed, unchecked Stories and no saved people', async ({ page }) => {
    const server = capacityServer();
    await install(page, { server, issues: [story('PLAN-1', 'acc-ann', 'Ann Synthetic', 3, { status: 'Killed' }), story('PLAN-2', 'acc-bob', 'Bob Synthetic', 2, { status: 'Killed' })] });
    await openPlanning(page);
    // Killed Stories still count in Selected while checked (as in the capacity bar), so uncheck them first, through the
    // Epic row: expanding the strip then switches the table to Stories (#323).
    await page.getByRole('checkbox', { name: 'Select PLAN-EPIC' }).first().click();
    await stripToggle(page).click();
    await expect(strip(page).getByText('No Stories or saved people for this Team in this Sprint.')).toBeVisible();
    await expect(table(page)).toHaveCount(0);
});

test('a failed save shows Not saved with Retry and Discard, also in the collapsed header; Retry saves', async ({ page }) => {
    let fail = true;
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }], patchStatus: () => (fail ? 503 : 0) });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('9'); await capacity.press('Enter');
    const alert = strip(page).locator('[data-assignee-save-failed]');
    await expect(alert).toContainText('Not saved');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Discard changes' })).toBeVisible();
    await expect(capacity).toHaveValue('9');
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Not saved');
    // Collapsed: the 28px header still says Not saved.
    await stripToggle(page).click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    const subtitle = strip(page).locator('.capacity-subtitle');
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toHaveText('Not saved');
    const header = await strip(page).boundingBox();
    expect(header.height).toBeLessThanOrEqual(28.5);
    const clip = await subtitle.evaluate(node => { const own = node.getBoundingClientRect(), panel = node.closest('[data-assignee-capacity]').getBoundingClientRect(); return { inside: own.top >= panel.top - 0.5 && own.bottom <= panel.bottom + 0.5 && own.right <= panel.right + 0.5 }; });
    expect(clip.inside).toBe(true);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/slice1-shots/collapsed-header-not-saved.png', animations: 'disabled' });
    await stripToggle(page).click();
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/slice1-shots/failed-not-saved.png', animations: 'disabled' });
    fail = false;
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await expect(alert).toHaveCount(0);
    expect(server.state.patches.at(-1).body.changes).toEqual([{ assigneeKey: 'acc-ann', capacity: '9' }]);
    expect(server.state.rows[0].capacity).toBe('9');
});

test('a refused change can be discarded and does not ride along with the next edit', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }], patchStatus: n => (n === 1 ? 400 : 0) });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('9'); await capacity.press('Enter');
    await expect(strip(page).locator('[data-assignee-save-failed]')).toBeVisible();
    const vacations = rowOf(page, 'acc-bob').getByRole('textbox', { name: 'Vacations for Bob Synthetic' });
    await vacations.fill('2'); await vacations.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(2);
    expect(server.state.patches[1].body.changes).toEqual([{ assigneeKey: 'acc-bob', displayName: 'Bob Synthetic', vacations: '2' }]);
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Not saved');
    await strip(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(strip(page).locator('[data-assignee-save-failed]')).toHaveCount(0);
    await expect(capacity).toHaveValue('8');
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('');
    await page.waitForTimeout(400);
    expect(server.state.patches).toHaveLength(2);
});

test('a save in progress shows Saving… in the collapsed header', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }], delayPatch: 1500 });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('9');
    // Collapsing commits the open edit first.
    await stripToggle(page).click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect(strip(page).locator('.capacity-subtitle')).toBeVisible();
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saving…');
    await expect(strip(page).locator('.capacity-subtitle')).toBeHidden();
    expect(server.state.patches).toHaveLength(1);
});

test('a failed background save is retained: returning to the Sprint shows Not saved with the draft and Retry', async ({ page }) => {
    let fail = true;
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }], patchStatus: () => (fail ? 503 : 0), delayPatch: 300 });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = () => rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity().fill('9'); await capacity().press('Enter');
    // Leave the Sprint inside the save window: the commit is flushed in the background and fails there.
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: activeSprintName }).click();
    await expect.poll(() => server.state.patches.length).toBe(1);
    await page.waitForTimeout(500);
    await expect(strip(page).locator('[data-assignee-save-failed]')).toHaveCount(0);
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await expect(strip(page).locator('[data-assignee-save-failed]')).toContainText('Not saved');
    await expect(capacity()).toHaveValue('9');
    fail = false;
    await strip(page).getByRole('button', { name: 'Retry' }).click();
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    expect(server.state.rows[0].capacity).toBe('9');
});

// Shared plan (#331): Team totals count every planned Story of the complete projection; filters only partition shown and
// hidden work. The overview summary says how many planned Stories the filters hide; Estimated effort still counts them,
// so the strip shows no "not counted" line.
test('planned Stories hidden by filters stay counted in Estimated effort and the overview summary says how many are hidden', async ({ page }) => {
    const server = capacityServer();
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(footerSelected(page)).toHaveText(/^14/);
    await page.locator('.search-input:visible').fill('PLAN-3');
    await expect(page.locator('.planning-actions > .planning-stats')).toContainText('3 hidden');
    await expect(strip(page).locator('[data-assignee-filter-hidden]')).toHaveCount(0);
    await expect(footerSelected(page)).toHaveText(/^14/);
});

test('settled screenshots: gray inherited values, the Unassigned row and the Removed strip', async ({ page }) => {
    const server = capacityServer({ inherited: { fromSprintId: '1999', rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '6', vacations: null, notes: null, removed: false }, { assigneeKey: 'acc-bob', displayName: 'Bob Synthetic', capacity: '5', vacations: null, notes: null, removed: false }] } });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(rowOf(page, 'acc-ann').locator('td.planning-assignee-inherited')).toHaveCount(1);
    await strip(page).scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5);
    await strip(page).screenshot({ path: 'tmp/slice1-shots/table-inherited-gray.png', animations: 'disabled' });
    const server2 = capacityServer({ rows: [
        { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: '1', notes: 'away Friday', removed: false },
        { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: true },
        { assigneeKey: 'acc-zed', displayName: 'Zed Former', capacity: '2', vacations: null, notes: null, removed: true },
    ] });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await install(page, { server: server2, capacityProject: 'CAP' });
    await openPlanning(page);
    await expect(rowOf(page, 'unassigned')).toBeVisible();
    await expect(strip(page).locator('.planning-assignee-removed')).toHaveText(/^Removed from this Sprint and later ones:\s*Cy Former,\s*Zed Former$/);
    await strip(page).scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5);
    await strip(page).screenshot({ path: 'tmp/slice1-shots/table-unassigned-removed.png', animations: 'disabled' });
});

// #251 freshness and DoD 12 request ledger.
const assigneeCalls = (calls, since = 0) => calls.slice(since).filter(call => call.pathname.endsWith('/assignee-capacity'));
async function pickTeam(page, name) {
    await page.locator('.team-dropdown-toggle:visible').click();
    await page.locator('.team-dropdown-panel:visible').getByText(name, { exact: true }).click();
    await page.keyboard.press('Escape');
}

test('request ledger: a Sprint switch reads at most once and a change from Team A to Team B at most once', async ({ page }) => {
    const server = capacityServer();
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await page.waitForLoadState('networkidle');
    let since = calls.length;
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: activeSprintName }).click();
    await expect(strip(page)).toBeVisible();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    const sprintSwitch = assigneeCalls(calls, since);
    expect(sprintSwitch.length, 'Sprint switch').toBeLessThanOrEqual(1);
    expect(sprintSwitch.every(call => call.method === 'GET')).toBe(true);
    since = calls.length;
    await pickTeam(page, 'Beta Team');
    await expect(strip(page)).toHaveCount(0);
    await pickTeam(page, 'Alpha Team');
    await expect(strip(page)).toBeVisible();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    const teamSwitch = assigneeCalls(calls, since);
    expect(teamSwitch.length, 'Team A to Team B').toBeLessThanOrEqual(1);
    expect(teamSwitch.every(call => call.method === 'GET')).toBe(true);
});

test('freshness: a return after more than 12 minutes re-reads the document once, shows the change and writes nothing', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toHaveValue('8');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    server.state.rows[0].capacity = '9'; server.state.revision += 1;
    const since = calls.length;
    await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name').length, 'the Planning freshness job ran').toBeGreaterThan(0);
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toHaveValue('9');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    expect(assigneeCalls(calls, since).map(call => call.method)).toEqual(['GET']);
    // The review's values read is a POST that carries issue ids and writes nothing; every other call is a GET.
    expect(calls.slice(since).filter(call => call.method !== 'GET' && !/\/review\/values\/read$/.test(call.pathname)), 'no non-GET in the automatic window').toEqual([]);
    await expect(strip(page).locator('[role="alert"]')).toHaveCount(0);
});

test('freshness: a busy strip is not re-read on return, and the edit in progress keeps its draft and focus', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = capacityServer({ delayPatch: 4000, rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('6'); await capacity.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    const notes = rowOf(page, 'acc-bob').getByRole('textbox', { name: 'Notes for Bob Synthetic' });
    await notes.click(); await notes.fill('typing');
    const since = calls.length;
    await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name').length, 'the Planning freshness job ran').toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(calls.slice(since).some(call => /\/review$/.test(call.pathname)), 'the Planning follow-up ran').toBe(true);
    expect(assigneeCalls(calls, since).filter(call => call.method === 'GET'), 'no read while the save runs').toEqual([]);
    await expect(notes).toBeFocused();
    await expect(notes).toHaveValue('typing');
    await expect(capacity).toHaveValue('6');
});

test('the header Refresh re-reads the assignee capacity document once', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    server.state.rows[0].capacity = '11'; server.state.revision += 1;
    const since = calls.length;
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toHaveValue('11');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    expect(assigneeCalls(calls, since).map(call => call.method)).toEqual(['GET']);
});

test('a new auth session re-reads the document without a loading state', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    server.state.rows[0].capacity = '12'; server.state.revision += 1;
    const since = calls.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('jep:auth-session-refreshed')));
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toHaveValue('12');
    expect(assigneeCalls(calls, since).filter(call => call.method === 'GET').length).toBeGreaterThanOrEqual(1);
    await expect(strip(page).getByText('Loading assignee capacity…')).toHaveCount(0);
});

// ---- Team capacity (not in Jira), #323 Task 8 ----

const sprintOrder = ['1999', String(activeSprintId), String(futureSprintId)];
// A per-Sprint synthetic store with the stored team number: whole-document inheritance from the nearest earlier Sprint,
// first write materialises (source `inherited`), and a guarded (`onlyIfSource`) write only updates an existing own document.
function plannedServer({ docs = {}, capabilities = caps } = {}) {
    const state = { docs: JSON.parse(JSON.stringify(docs)), gets: 0, patches: [] };
    const asInherited = planned => (planned ? { value: planned.value, source: 'inherited' } : null);
    const earlier = sprintId => {
        for (let index = sprintOrder.indexOf(sprintId) - 1; index >= 0; index -= 1) {
            const doc = state.docs[sprintOrder[index]];
            if (doc?.revision) return { fromSprintId: sprintOrder[index], rows: doc.rows.filter(row => !row.removed), planned: asInherited(doc.planned) };
        }
        return null;
    };
    const read = sprintId => {
        const own = state.docs[sprintId];
        return own?.revision
            ? { teamId: 'team-alpha', sprintId, revision: own.revision, rows: own.rows, planned: own.planned || null, inherited: null, capabilities }
            : { teamId: 'team-alpha', sprintId, revision: 0, rows: [], planned: null, inherited: earlier(sprintId), capabilities };
    };
    const handler = async route => {
        const request = route.request();
        const sprintId = decodeURIComponent(new URL(request.url()).pathname.split('/')[4]);
        if (request.method() === 'GET') { state.gets += 1; return json(route, read(sprintId)); }
        const body = requestBody(request);
        state.patches.push({ sprintId, body });
        let own = state.docs[sprintId];
        let planned = body.planned;
        if (planned?.onlyIfSource && !own?.revision) planned = undefined;
        if (!body.changes.length && planned === undefined) return json(route, read(sprintId));
        if (!own?.revision) {
            const source = earlier(sprintId);
            own = { revision: 0, rows: (source?.rows || []).map(row => ({ ...row, vacations: null, notes: null })), planned: source?.planned || null };
            state.docs[sprintId] = own;
        }
        for (const change of body.changes) {
            let row = own.rows.find(candidate => candidate.assigneeKey === change.assigneeKey);
            if (!row) { row = { assigneeKey: change.assigneeKey, displayName: change.displayName || change.assigneeKey, capacity: null, vacations: null, notes: null, removed: false }; own.rows.push(row); }
            for (const field of ['displayName', 'capacity', 'vacations', 'notes', 'removed']) if (field in change) row[field] = change[field];
        }
        if (planned && (!planned.onlyIfSource || planned.onlyIfSource.includes(own.planned?.source ?? null))) {
            own.planned = planned.value == null ? null : { value: planned.value, source: planned.source };
        }
        own.revision += 1;
        return json(route, read(sprintId));
    };
    return { state, handler };
}

const ownDoc = planned => ({ revision: 1, rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '6', vacations: null, notes: null, removed: false }], planned });
const noTicket = sprint => ({ enabled: true, mutationEnabled: true, sprint, capacities: {}, entries: [] });
const ticket = value => sprint => ({ enabled: true, mutationEnabled: true, sprint, capacities: value == null ? {} : { 'Alpha Team': value }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: value }] });
const alphaCard = page => page.locator('.planning-team-capacity-cards .team-stat-card[data-capacity-team="team-alpha"]');
const plannedPencil = page => alphaCard(page).getByRole('button', { name: 'Edit Alpha Team team capacity' });
// The banner rows are gone (#323 Task 5, operator design 2026-11-09): a mismatch marks its card and, with a push handler
// (Task 6), adds a rail icon; no banner, Use ticket value or Not now.
const reconcileBanner = page => page.locator('[data-capacity-reconcile]');
const mismatchCards = page => page.locator('.planning-team-capacity-cards .team-stat-card[data-capacity-attention="mismatch"]');
const capacityTrack = page => page.locator('.planning-panel-capacity-graph .capacity-bar-track');
const teamCap = page => page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label');
const jiraWrites = calls => calls.filter(call => call.method !== 'GET' && call.pathname.startsWith('/api/capacity/'));
const assigneeWrites = (calls, since = 0) => assigneeCalls(calls, since).filter(call => call.method === 'PATCH');
const capacityEvents = page => page.evaluate(() => (window.dataLayer || []).filter(entry => String(entry?.workflow_action || '').startsWith('capacity_')).map(entry => entry.workflow_action));

async function openPlanningIn(page, sprintName) {
    await page.goto(appBaseUrl);
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await expect(toggle).toHaveAttribute('aria-disabled', 'false');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: sprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}
async function switchSprint(page, sprintName) {
    await page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle').click();
    await page.locator('.sprint-dropdown-option', { hasText: sprintName }).click();
}
async function pinnedHeights(page) {
    return { panel: (await page.locator('.planning-panel').boundingBox()).height, stack: (await page.locator('.planning-review-sticky-stack').boundingBox()).height };
}
async function hover(page, locator) { await locator.hover(); }
// The Table overview starts compact; the team cards live in its details.
async function showCards(page) {
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await showCapacityDetails(page);
    await expect(page.locator('.planning-team-capacity-cards')).toBeVisible();
}

for (const previousValue of [20.5, 0, 20.555]) test(`no ticket: editor inherits previous Planning Jira capacity ${previousValue} without visiting that Sprint`, async ({ page }) => {
    const server = plannedServer();
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: sprint => sprint === activeSprintName ? ticket(previousValue)(sprint) : noTicket(sprint) });
    await openPlanning(page);
    await showCards(page);
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await expect(input).toHaveValue(String(previousValue === 20.555 ? 20.56 : previousValue));
    await expect(input).toBeFocused();
    expect(assigneeWrites(calls)).toEqual([]);
    expect(jiraWrites(calls)).toEqual([]);
    if (previousValue === 20.5) await alphaCard(page).screenshot({ path: 'tmp/capacity-inheritance/editor-after.png', animations: 'disabled' });
    await input.fill('23');
    await input.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0]).toEqual({ sprintId: String(futureSprintId), body: { teamId: 'team-alpha', planned: { value: '23', source: 'user' }, changes: [] } });
    expect(server.state.docs[String(activeSprintId)]).toBeUndefined();
    expect(jiraWrites(calls)).toEqual([]);
});

test('no ticket: the previous Jira value wins over inherited stored capacity; the current Sprint own value wins on reopening', async ({ page }) => {
    const server = plannedServer({ docs: { [String(activeSprintId)]: ownDoc({ value: '12', source: 'user' }) } });
    let previousReads = 0;
    await install(page, { server, capacityProject: 'CAP', capacity: sprint => {
        if (sprint === activeSprintName) { previousReads += 1; return ticket(20)(sprint); }
        return noTicket(sprint);
    } });
    await openPlanning(page);
    await showCards(page);
    expect(previousReads).toBe(0);
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await expect(input).toHaveValue('20');
    await alphaCard(page).getByRole('button', { name: 'Save Alpha Team team capacity', exact: true }).click();
    await expect.poll(() => server.state.patches.length).toBe(1);
    await expect(alphaCard(page)).toHaveAttribute('data-planned-source', 'user');
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    await expect(input).toHaveValue('20');
    expect(previousReads).toBe(1);
});

for (const currentValue of [null, 0]) test(`ticket with ${currentValue === null ? 'blank' : 'zero'} capacity: editor inherits the active Sprint's Jira capacity, saves against the ticket value`, async ({ page }) => {
    const server = plannedServer();
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: sprint => sprint === activeSprintName ? ticket(20.5)(sprint) : ticket(currentValue)(sprint) });
    await openPlanning(page);
    await showCards(page);
    await hover(page, alphaCard(page));
    await alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' }).click();
    const jiraInput = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team Jira total planned capacity' });
    await expect(jiraInput).toHaveValue('20.5');
    expect(jiraWrites(calls), 'opening writes nothing').toEqual([]);
    await alphaCard(page).getByRole('button', { name: 'Save Alpha Team capacity' }).click();
    await expect.poll(() => jiraWrites(calls).length).toBe(1);
    expect(jiraWrites(calls)[0].body).toMatchObject({ capacity: 20.5, expectedCapacity: currentValue, teamName: 'Alpha Team' });
});

test('no ticket: a new Team stays blank when the previous Sprint has capacity only for another Team', async ({ page }) => {
    const server = plannedServer();
    await install(page, { server, capacityProject: 'CAP', capacity: sprint => sprint === activeSprintName
        ? { enabled: true, mutationEnabled: true, sprint, capacities: { 'Beta Team': 9 }, entries: [{ teamName: 'Beta Team', issueKey: 'CAP-202', capacity: 9 }] }
        : noTicket(sprint) });
    await openPlanning(page);
    await showCards(page);
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('');
    expect(server.state.patches).toEqual([]);
});

test('no ticket: cancel aborts a slow previous-sprint read and its late response cannot replace a reopened editor', async ({ page }) => {
    const server = plannedServer();
    await install(page, { server, capacityProject: 'CAP', capacity: noTicket });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let reads = 0;
    await page.route('**/api/capacity?**', async route => {
        const sprint = new URL(route.request().url()).searchParams.get('sprint');
        if (sprint !== activeSprintName) return route.fallback();
        reads += 1;
        if (reads === 1) { await held; return json(route, ticket(99)(sprint)).catch(() => {}); }
        return json(route, ticket(22)(sprint));
    });
    await openPlanning(page);
    await showCards(page);
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await expect(input).toBeDisabled();
    await expect.poll(() => reads).toBe(1);
    await alphaCard(page).getByRole('button', { name: 'Cancel Alpha Team team capacity edit' }).click();
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    await expect(input).toHaveValue('22');
    await input.fill('25');
    release();
    await page.waitForLoadState('networkidle');
    await expect(input).toHaveValue('25');
    expect(server.state.patches).toEqual([]);
});

test('no ticket: a failed previous-sprint read allows manual input and retries on reopening', async ({ page }) => {
    const server = plannedServer();
    await install(page, { server, capacityProject: 'CAP', capacity: noTicket });
    let reads = 0;
    await page.route('**/api/capacity?**', route => {
        const sprint = new URL(route.request().url()).searchParams.get('sprint');
        if (sprint !== activeSprintName) return route.fallback();
        reads += 1;
        return reads === 1 ? json(route, { error: 'jira_capacity_fetch_failed' }, 503) : json(route, ticket(18)(sprint));
    });
    await openPlanning(page);
    await showCards(page);
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await expect(input).toBeEnabled();
    await expect(alphaCard(page)).toContainText('Previous sprint capacity could not be loaded.');
    await input.fill('21');
    await expect(alphaCard(page).getByRole('button', { name: 'Save Alpha Team team capacity', exact: true })).toBeEnabled();
    await alphaCard(page).getByRole('button', { name: 'Cancel Alpha Team team capacity edit' }).click();
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    await expect(input).toHaveValue('18');
    expect(server.state.patches).toEqual([]);
});

test('no ticket: the lead types a team number, it saves to the store only, the bar and underbar appear, and the next Sprint shows it gray', async ({ page }) => {
    const server = plannedServer();
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: noTicket, authMode: 'atlassian_oauth', analytics: true });
    await openPlanningIn(page, activeSprintName);
    await showCards(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await expect(capacityTrack(page)).toHaveCount(0);
    await expect(underbar(page)).toHaveCount(0);
    await expect(alphaCard(page)).not.toHaveAttribute('data-capacity-source', /./);
    await hover(page, alphaCard(page));
    await expect(plannedPencil(page)).toBeEnabled();
    await expect(alphaCard(page).getByRole('link', { name: /capacity ticket in Jira/ })).toHaveCount(0);
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await expect(input).toBeFocused();
    await expect(alphaCard(page).locator('.team-capacity-editor-context')).toHaveText('Team capacity (not in Jira)');
    await alphaCard(page).screenshot({ path: 'tmp/slice3-shots/card-planned-editor-open.png', animations: 'disabled' });
    await input.fill('14');
    await input.press('Enter');
    await expect.poll(() => assigneeWrites(calls).length).toBe(1);
    expect(assigneeWrites(calls)[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'user' }, changes: [] });
    await expect(capacityTrack(page)).toBeVisible();
    // Nothing is selected in this Sprint, so the strip (Estimated effort by person) has no segment and is not drawn;
    // selecting the Stories draws it.
    await expect(underbar(page)).toHaveCount(0);
    await page.locator('.planning-panel').getByRole('button', { name: 'Select All', exact: true }).click();
    await expect(underbar(page)).toHaveCount(1);
    await expect(teamCap(page)).toHaveText(/Capacity\s*14\.0/);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-source', 'planned');
    await expect(alphaCard(page)).toHaveAttribute('data-planned-source', 'user');
    await expect(alphaCard(page).locator('.microbar-meta')).toContainText('Cap 14.0');
    await page.mouse.move(5, 600);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice3-shots/bar-underbar-no-ticket.png', animations: 'disabled' });
    const stripBox = await underbar(page).boundingBox();
    await page.mouse.move(stripBox.x + stripBox.width - 3, stripBox.y + 3);
    await expect(readout(page)).toContainText('Team capacity (not in Jira)');
    // The next Sprint has no document of its own: the number is inherited (gray) and still drives the bar.
    await page.mouse.move(5, 600);
    await switchSprint(page, futureSprintName);
    // Select All made this Sprint's plan dirty: the shared plan (#331) asks before leaving the scope; discard the inclusion change.
    await page.getByRole('dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(alphaCard(page)).toHaveAttribute('data-planned-source', 'inherited');
    await expect(teamCap(page)).toHaveText(/Capacity\s*14\.0/);
    await expect(page.locator('.team-capacity-read-status').filter({ hasText: 'have not been created yet for this future sprint' })).toContainText('Showing Team capacity (not in Jira) meanwhile.');
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    await expect(alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' })).toHaveValue('14');
    await page.keyboard.press('Escape');
    expect(assigneeWrites(calls)).toHaveLength(1);
    expect(jiraWrites(calls), 'nothing is written to Jira').toEqual([]);
    expect(await capacityEvents(page), 'the stored-number editor emits no capacity_* analytics').toEqual([]);
});

test('with a ticket Jira wins on screen: no stored-number pencil, the Jira number drives the bar, no banner for a jira source', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'jira' }) } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await showCards(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await expect(teamCap(page)).toHaveText(/Capacity\s*20\.0/);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-source', 'jira');
    await hover(page, alphaCard(page));
    await expect(plannedPencil(page)).toHaveCount(0);
    await expect(alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' })).toBeVisible();
    await expect(reconcileBanner(page)).toHaveCount(0);
    await expect(mismatchCards(page), 'a jira source is no mismatch').toHaveCount(0);
    const stripBox = await underbar(page).boundingBox();
    await page.mouse.move(stripBox.x + stripBox.width - 3, stripBox.y + 3);
    await expect(readout(page)).toContainText('Team capacity: Jira');
    await page.mouse.move(5, 600);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice3-shots/bar-underbar-with-ticket.png', animations: 'disabled' });
    expect(jiraWrites(calls)).toEqual([]);
});

test('a typed number that differs from the ticket marks the card and offers → with no banner; the Jira pencil save also settles it to jira', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth', analytics: true });
    await openPlanning(page);
    await showCards(page);
    await expect(mismatchCards(page)).toHaveCount(1);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-attention', 'mismatch');
    await expect(reconcileBanner(page)).toHaveCount(0);
    await expect(page.locator('.planning-team-capacity-cards').getByRole('button', { name: /Use ticket value|Not now|Write to ticket/ })).toHaveCount(0);
    await expect(teamCap(page), 'Jira wins on screen').toHaveText(/Capacity\s*20\.0/);
    await hover(page, alphaCard(page));
    await expect(alphaCard(page).getByRole('button', { name: 'Apply Alpha Team team capacity to Jira', exact: true }), 'the push is offered (Task 6)').toBeVisible();
    expect(jiraWrites(calls), 'offering the push writes nothing').toEqual([]);
    expect(await capacityEvents(page)).toEqual([]);
    await alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' }).click();
    const jiraInput = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team Jira total planned capacity' });
    await expect(jiraInput).toHaveValue('20');
    await jiraInput.fill('14');
    expect(jiraWrites(calls), 'opening and typing write nothing').toEqual([]);
    await alphaCard(page).getByRole('button', { name: 'Save Alpha Team capacity' }).click();
    await expect.poll(() => jiraWrites(calls).length).toBe(1);
    expect(jiraWrites(calls)[0].body).toMatchObject({ capacity: 14, expectedCapacity: 20, teamName: 'Alpha Team' });
    // The user's own Jira save settles the typed number: source user becomes {ticket value, jira}.
    await expect.poll(() => assigneeWrites(calls).length).toBe(1);
    expect(assigneeWrites(calls)[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'jira' }, changes: [] });
    await expect(mismatchCards(page)).toHaveCount(0);
    expect(await capacityEvents(page), 'only the existing Jira editor emits capacity_* events').toEqual(['capacity_edit_open', 'capacity_change_submit', 'capacity_change_result']);
});

test('equal numbers, and jira or inherited sources, mark no mismatch', async ({ page }) => {
    for (const docs of [
        { [String(futureSprintId)]: ownDoc({ value: '20.00', source: 'user' }) },
        { [String(futureSprintId)]: ownDoc({ value: '14', source: 'jira' }) },
        { [String(activeSprintId)]: ownDoc({ value: '14', source: 'user' }) },
    ]) {
        const server = plannedServer({ docs });
        await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth' });
        await openPlanning(page);
        await showCards(page);
        await expect.poll(() => server.state.gets).toBe(1);
        await expect(teamCap(page)).toHaveText(/Capacity\s*20\.0/);
        await page.waitForTimeout(300);
        await expect(mismatchCards(page), JSON.stringify(docs)).toHaveCount(0);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

test('a matched ticket with a blank value falls back to the stored number; the pencil edits Jira and the card is a mismatch', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    await install(page, { server, capacityProject: 'CAP', capacity: ticket(null), authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await showCards(page);
    await expect(teamCap(page)).toHaveText(/Capacity\s*14\.0/);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-source', 'planned');
    await hover(page, alphaCard(page));
    await expect(alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' })).toBeVisible();
    await expect(plannedPencil(page)).toHaveCount(0);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-attention', 'mismatch');
    await expect(reconcileBanner(page)).toHaveCount(0);
});

test('read-only user: no stored-number pencil, no mismatch and no mirror', async ({ page }) => {
    const readOnly = { canRead: true, canSave: false };
    const server = plannedServer({ capabilities: readOnly, docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await showCards(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expect(mismatchCards(page)).toHaveCount(0);
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(assigneeWrites(calls)).toEqual([]);
    const server2 = plannedServer({ capabilities: readOnly });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await install(page, { server: server2, capacityProject: 'CAP', capacity: noTicket, authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await showCards(page);
    await expect.poll(() => server2.state.gets).toBe(1);
    await hover(page, alphaCard(page));
    await expect(plannedPencil(page)).toHaveCount(0);
});

// The one-Team limitation is gone (#323 Task 5): with two Teams each card edits its own stored number, and no document is
// read until its editor opens.
test('two Teams: the stored-number pencil is available, and the Team document is read only when its editor opens', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    await install(page, { server, capacityProject: 'CAP', capacity: noTicket, authMode: 'atlassian_oauth', selectedTeams: ['team-alpha', 'team-beta'] });
    await openPlanning(page);
    await showCards(page);
    await expect(alphaCard(page)).toBeVisible();
    await page.waitForTimeout(400);
    expect(server.state.gets).toBe(0);
    await hover(page, alphaCard(page));
    await expect(plannedPencil(page)).toBeEnabled();
    await plannedPencil(page).click();
    await expect(alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' })).toBeFocused();
    await expect.poll(() => server.state.gets).toBe(1);
    await page.keyboard.press('Escape');
    expect(server.state.patches).toEqual([]);
});

test('request ledger: the mirror sends at most one guarded PATCH per user-initiated load, only when the ticket differs, and none in an automatic window', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'jira' }) } });
    let ticketValue = 20;
    // Exercise the supported OAuth/DB lifecycle, including its focus auth refresh,
    // without changing the at-most-one mirror and no-background-write ledger.
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: sprint => ticket(ticketValue)(sprint), analytics: true });
    await openPlanning(page);
    await showCards(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    // The cold load is user-initiated: it mirrors when the document is already loaded when the capacity read ends.
    const cold = assigneeWrites(calls);
    expect(cold.length).toBeLessThanOrEqual(1);
    cold.forEach(call => expect(call.body).toEqual({ teamId: 'team-alpha', planned: { value: '20', source: 'jira', onlyIfSource: [null, 'jira', 'inherited'] }, changes: [] }));
    // Automatic window: the ticket changed, and a return after more than 12 minutes re-reads capacity without the loading flag.
    ticketValue = 25;
    let since = calls.length;
    await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => calls.slice(since).some(call => call.pathname === '/api/capacity'), 'the automatic window re-read capacity').toBe(true);
    await expect(teamCap(page)).toHaveText(/Capacity\s*25\.0/);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(600);
    expect(assigneeWrites(calls, since), 'no non-GET in an automatic window').toEqual([]);
    // A user-initiated load (header Refresh) mirrors the differing ticket value once.
    since = calls.length;
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await expect.poll(() => assigneeWrites(calls, since).length).toBe(1);
    expect(assigneeWrites(calls, since)[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '25', source: 'jira', onlyIfSource: [null, 'jira', 'inherited'] }, changes: [] });
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    since = calls.length;
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(600);
    expect(assigneeWrites(calls, since), 'equal after the mirror: nothing more').toEqual([]);
    expect(jiraWrites(calls)).toEqual([]);
    expect(await capacityEvents(page), 'the mirror emits no capacity_* analytics').toEqual([]);
});

test('the late arrival of the amber bar from the stored number keeps the pinned stack inside the DoD 14 bounds at 1440x900 and 1280x720', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const held = async route => { if (route.request().method() === 'GET') await gate; return server.handler(route); };
        await install(page, { server: { handler: held }, capacityProject: 'CAP', capacity: noTicket, authMode: 'atlassian_oauth' });
        await openPlanning(page);
        await expect(alphaCard(page)).toHaveCount(1);
        await expect(capacityTrack(page)).toHaveCount(0);
        const before = await pinnedHeights(page);
        release();
        // The compact overview hides the graphs: the bar arrives in the details without changing the compact heights.
        await expect(capacityTrack(page)).toHaveCount(1);
        const after = await pinnedHeights(page);
        await showCapacityDetails(page);
        await expect(capacityTrack(page)).toBeVisible();
        for (const [label, heights] of [['before', before], ['after', after]]) {
            expect(heights.panel, `${label} ${viewport.width}`).toBeLessThan(64);
            expect(heights.stack, `${label} ${viewport.width}`).toBeLessThanOrEqual(175);
        }
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

// ---- Add assignee (#323 Task 9) ----------------------------------------------------------------------------------

const addTrigger = page => strip(page).getByRole('combobox', { name: 'Assignee to add: Add assignee' });
const peopleMenu = page => page.locator('.issue-person-editor-menu');
const searchCalls = calls => calls.filter(call => call.pathname === '/api/eng/assignee-capacity/user-options');

test('Add assignee: debounced search, select adds a row with the name snapshot and no Capacity, no email, and it survives reload', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server, people: query => ({ ...defaultPeople(query), users: defaultPeople(query).users.map(user => ({ ...user, emailAddress: 'leak@example.test' })) }) });
    await openPlanning(page);
    await expand(page);
    await expect(addTrigger(page)).toHaveCount(1);
    await addTrigger(page).click();
    const search = page.getByRole('combobox', { name: 'Search Assignee to add' });
    await expect(search).toBeFocused();
    await expect(peopleMenu(page)).toContainText('Type at least 3 characters');
    await search.pressSequentially('nor', { delay: 30 });
    await expect(peopleMenu(page).getByRole('option', { name: 'Nora Newcomer' })).toBeVisible();
    expect(searchCalls(calls), 'one debounced request for three keystrokes').toHaveLength(1);
    expect(searchCalls(calls)[0].body).toEqual({ query: 'nor' });
    await expect(peopleMenu(page)).not.toContainText('@');
    await page.screenshot({ path: 'tmp/slice4-shots/add-assignee-picker-open.png' });
    await peopleMenu(page).getByRole('option', { name: 'Nora Newcomer' }).click();
    await expect(peopleMenu(page)).toHaveCount(0);
    await expect(rowOf(page, 'acc-new')).toHaveCount(1);
    await expect(rowOf(page, 'acc-new').getByRole('textbox', { name: 'Capacity for Nora Newcomer' })).toHaveValue('');
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-new', displayName: 'Nora Newcomer' }]);
    expect(JSON.stringify(server.state.patches[0].body)).not.toContain('@');
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await page.reload();
    await openPlanning(page);
    if (await stripToggle(page).getAttribute('aria-expanded') !== 'true') await expand(page);
    await expect(rowOf(page, 'acc-new').locator('td.planning-assignee-name')).toHaveText('Nora Newcomer');
    // A person with Stories is already a row: picking them sends nothing and focuses their Capacity.
    await addTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search Assignee to add' }).fill('ann');
    await peopleMenu(page).getByRole('option', { name: 'Ann Synthetic' }).click();
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toBeFocused();
    await page.waitForTimeout(400);
    expect(server.state.patches).toHaveLength(1);
});

test('Add assignee: picking a removed person restores them', async ({ page }) => {
    const server = capacityServer({ rows: [
        { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false },
        { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: true },
    ] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(strip(page).locator('.planning-assignee-removed')).toContainText('Cy Former');
    await addTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search Assignee to add' }).fill('cy f');
    await peopleMenu(page).getByRole('option', { name: 'Cy Former' }).click();
    await expect(rowOf(page, 'acc-cy').getByRole('textbox', { name: 'Capacity for Cy Former' })).toHaveValue('3');
    await expect(strip(page).locator('.planning-assignee-removed')).toHaveCount(0);
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-cy', removed: false }]);
});

test('Add assignee: the empty state offers it and the added person becomes the first row', async ({ page }) => {
    const server = capacityServer();
    await install(page, { server, issues: stories.filter(entry => entry.fields.teamId !== 'team-alpha') });
    await openPlanning(page);
    await stripToggle(page).click();
    const empty = strip(page).getByText('No Stories or saved people for this Team in this Sprint.');
    await expect(empty).toBeVisible();
    await expect(addTrigger(page)).toBeVisible();
    await strip(page).screenshot({ path: 'tmp/slice4-shots/add-assignee-empty-state.png' });
    await addTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search Assignee to add' }).fill('nora');
    await peopleMenu(page).getByRole('option', { name: 'Nora Newcomer' }).click();
    await expect(rowOf(page, 'acc-new')).toHaveCount(1);
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-new', displayName: 'Nora Newcomer' }]);
});

test('Add assignee: no selected projects and a failed search show a message, not people', async ({ page }) => {
    let mode = 'none';
    const server = capacityServer();
    await install(page, { server, people: () => (mode === 'none' ? { users: [], reason: 'no_selected_projects' } : null) });
    await page.route('**/api/eng/assignee-capacity/user-options', route => (mode === 'none'
        ? json(route, { users: [], reason: 'no_selected_projects' })
        : json(route, { error: 'jira_rate_limited', retryAfterSeconds: 2 }, 429)));
    await openPlanning(page);
    await expand(page);
    await addTrigger(page).click();
    const search = page.getByRole('combobox', { name: 'Search Assignee to add' });
    await search.fill('ann');
    await expect(peopleMenu(page)).toContainText('No Product or Tech projects are selected to search in.');
    mode = 'rate';
    await search.fill('anna');
    await expect(peopleMenu(page).getByRole('alert')).toHaveText('Jira is busy. Try again in a moment.');
    await expect(peopleMenu(page).getByRole('option')).toHaveCount(0);
});

// DoD 13 render and compute counts (opt-in, as tests/ui/app_render_counts.spec.js; the probe bundle is built in memory):
//   JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/planning_assignee_capacity.spec.js -g "render counts" --browser=chromium
// teamTasks is the team list filter ("has Stories"); buildAssigneeRows runs once per derived view and accumulates Estimated effort.
test.describe('render counts (#323 DoD 13)', () => {
    test.skip(process.env.JEP_RUNTIME_PROBE !== '1', 'opt-in runtime probe (JEP_RUNTIME_PROBE=1)');
    let probeBundle;
    test.beforeAll(() => {
        let text = require('./runtime_probe_helpers').buildRuntimeProbeBundle();
        for (const name of ['teamTasks', 'buildAssigneeRows']) {
            const anchor = `function ${name}(`;
            if (text.split(anchor).length !== 2) throw new Error(`${anchor} must occur exactly once`);
            const next = text.replace(new RegExp(`(function ${name}\\([\\s\\S]*?\\)\\s*\\{)`), `$1 (window.__JEP_323_COUNTS__ ||= {}).${name} = (window.__JEP_323_COUNTS__.${name} || 0) + 1;`);
            if (next === text) throw new Error(`${name} counter was not injected`);
            text = next;
        }
        // The assignee capacity controllers, so a test can run the stored-number refresh alone (#323 Task 7).
        const map = 'var controllers = /* @__PURE__ */ new Map();';
        if (text.split(map).length !== 2) throw new Error(`${map} must occur exactly once`);
        probeBundle = text.replace(map, `${map}\nwindow.__JEP_323_CONTROLLERS__ = controllers;`);
    });
    const many = Array.from({ length: 3000 }, (_, index) => {
        const person = index % 9;
        return person === 8 ? story(`PLAN-${index + 10}`, null, null, 1 + (index % 5))
            : story(`PLAN-${index + 10}`, `acc-p${person}`, `Person ${person} Synthetic`, 1 + (index % 5), { team: index % 10 === 9 ? 'team-beta' : 'team-alpha' });
    });
    const read = page => page.evaluate(() => ({ renders: window.__JEP_EXTRACTION_PERF__().renders, ...(window.__JEP_323_COUNTS__ || {}) }));
    // Waits until App has not rendered for 750 ms (three equal reads 250 ms apart), so a measurement never counts the
    // renders of a load that is still settling (#323 Task 8: a fixed 500 ms after expanding the strip was not enough).
    async function quiesce(page) {
        let last = -1, stable = 0;
        for (let attempt = 0; attempt < 80; attempt += 1) {
            const { renders } = await read(page);
            if (renders === last) { stable += 1; if (stable >= 3) return; } else { stable = 0; last = renders; }
            await page.waitForTimeout(250);
        }
        throw new Error('App did not settle within 20 s');
    }
    async function measure(page, action) {
        await page.waitForTimeout(500);
        await quiesce(page);
        const before = await read(page);
        await action();
        await page.waitForTimeout(500);
        await quiesce(page);
        const after = await read(page);
        return { ...Object.fromEntries(['renders', 'teamTasks', 'buildAssigneeRows'].map(key => [key, (after[key] || 0) - (before[key] || 0)])), absolute: after };
    }
    async function openProbe(page, options) {
        await page.addInitScript(() => window.history.replaceState(null, '', '/?perf=1'));
        const fixture = await install(page, { issues: many, ...options });
        await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: probeBundle }));
        await openPlanning(page);
        return fixture;
    }
    const toggleFirstStory = async page => {
        const box = page.locator('.planning-review-table tbody input[type=checkbox]').first();
        const was = await box.isChecked();
        await box.click();
        await expect(box).toBeChecked({ checked: !was });
    };

    for (const [label, selectedTeams] of [['one Team, strip expanded', ['team-alpha']], ['two Teams, no strip', ['team-alpha', 'team-beta']]]) test(`render counts: a Story toggle with 3,000 Stories (${label})`, async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const server = capacityServer({ rows: [{ assigneeKey: 'acc-p0', displayName: 'Person 0 Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
        await openProbe(page, { server, selectedTeams });
        if (selectedTeams.length === 1) await expand(page);
        await page.getByRole('radio', { name: 'Stories', exact: true }).click();
        await expect(page.locator('.planning-review-table tbody input[type=checkbox]').first()).toBeVisible();
        const result = await measure(page, () => toggleFirstStory(page));
        const back = await measure(page, () => toggleFirstStory(page));
        console.log('DOD13_MEASURE', label, JSON.stringify({ toggle: result, toggleBack: back }));
        testInfo.annotations.push({ type: 'dod13', description: `${label} ${JSON.stringify({ toggle: result, toggleBack: back })}` });
        expect(result.teamTasks, 'the team list is not rebuilt by a toggle').toBe(0);
        expect(back.teamTasks).toBe(0);
        // Merge-base 1f8db143 measured 2 App renders for the second toggle in every run (the first toggle varies 5..10 in both).
        expect(back.renders, 'App renders on a settled Story toggle').toBeLessThanOrEqual(2);
    });

    test('render counts: a strip Capacity edit does not re-render App (the stored team number is unchanged)', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const server = capacityServer({ rows: [{ assigneeKey: 'acc-p0', displayName: 'Person 0 Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
        await openProbe(page, { server });
        await expand(page);
        const capacity = rowOf(page, 'acc-p0').getByRole('textbox', { name: 'Capacity for Person 0 Synthetic' });
        const result = await measure(page, async () => {
            await capacity.fill('9'); await capacity.press('Enter');
            await expect.poll(() => server.state.patches.length).toBe(1);
        });
        console.log('DOD13_MEASURE', 'strip edit', JSON.stringify(result));
        testInfo.annotations.push({ type: 'dod13', description: `strip edit ${JSON.stringify(result)}` });
        expect(result.renders, 'App renders on a strip edit').toBe(0);
        expect(result.teamTasks).toBe(0);
    });

    test('render counts: an unchanged stored-number refresh in two Teams renders App zero times; a changed number renders it', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6' } });
        await openProbe(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket, issues: stories });
        await showCards(page);
        await storedOn(page, 'team-beta', '6.0');
        const refresh = () => page.evaluate(() => [...window.__JEP_323_CONTROLLERS__.values()][0].refreshProjection({ automatic: true }));
        const reads = server.state.reads.length;
        const unchanged = await measure(page, async () => { expect(await refresh()).toEqual({ status: 'ok' }); });
        expect(server.state.reads.length, 'one batch read').toBe(reads + 1);
        storeOn(server, 'team-beta', '9');
        const changed = await measure(page, async () => { expect(await refresh()).toEqual({ status: 'ok' }); await storedOn(page, 'team-beta', '9.0'); });
        console.log('DOD13_MEASURE', 'stored-number refresh', JSON.stringify({ unchanged, changed }));
        testInfo.annotations.push({ type: 'dod13', description: `stored-number refresh ${JSON.stringify({ unchanged, changed })}` });
        expect(unchanged.renders, 'App renders on an unchanged projection').toBe(0);
        expect(changed.renders, 'the probe sees a changed number').toBeGreaterThan(0);
    });

    // #323 Task 8 Step 2 (DoD 9): App subscribes to the stored Team numbers, so one changed number is one App render.
    test('a stored Team number change re-renders App exactly once', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6' } });
        await openProbe(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket, issues: stories });
        await showCards(page);
        await storedOn(page, 'team-beta', '6.0');
        storeOn(server, 'team-beta', '9');
        const refreshed = await measure(page, async () => {
            expect(await page.evaluate(() => [...window.__JEP_323_CONTROLLERS__.values()][0].refreshProjection({ automatic: true }))).toEqual({ status: 'ok' });
            await storedOn(page, 'team-beta', '9.0');
        });
        // A card pencil commit: the editor is opened first, so only the commit and its save are measured.
        await teamCard(page, 'team-alpha').hover();
        await teamPencil(page, 'team-alpha', 'Alpha Team').click();
        const input = teamInput(page, 'team-alpha', 'Alpha Team');
        await expect(input).toBeFocused();
        await input.fill('15');
        const committed = await measure(page, async () => {
            await input.press('Enter');
            await expect.poll(() => teamPatches(server, 'team-alpha').length).toBe(1);
            await storedOn(page, 'team-alpha', '15.0');
        });
        console.log('DOD9_MEASURE', 'stored Team number change', JSON.stringify({ refreshed, committed }));
        testInfo.annotations.push({ type: 'dod9', description: `stored Team number change ${JSON.stringify({ refreshed, committed })}` });
        expect(refreshed.renders, 'App renders when a read changes one stored Team number').toBe(1);
        expect(committed.renders, 'App renders when a card commit changes one stored Team number').toBe(1);
    });

    test('a person\'s Capacity, Vacations or Notes edit and any save-state change render App zero times', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        let fail = false;
        const server = capacityServer({ rows: [{ assigneeKey: 'acc-p0', displayName: 'Person 0 Synthetic', capacity: '8', vacations: null, notes: null, removed: false }], patchStatus: () => (fail ? 503 : 0) });
        await openProbe(page, { server });
        await expand(page);
        const row = rowOf(page, 'acc-p0');
        const results = {};
        for (const [field, value] of [['Capacity', '9'], ['Vacations', '1'], ['Notes', 'synthetic note']]) {
            const box = row.getByRole('textbox', { name: `${field} for Person 0 Synthetic` });
            const patches = server.state.patches.length;
            results[field] = await measure(page, async () => {
                await box.fill(value); await box.press('Enter');
                await expect.poll(() => server.state.patches.length).toBe(patches + 1);
                await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
            });
        }
        // Save-state changes: a failed save (Not saved), then Retry (saving, then Saved).
        fail = true;
        const capacity = row.getByRole('textbox', { name: 'Capacity for Person 0 Synthetic' });
        results.failed = await measure(page, async () => {
            await capacity.fill('10'); await capacity.press('Enter');
            await expect(strip(page).locator('[data-assignee-save-failed]')).toContainText('Not saved');
        });
        fail = false;
        results.retried = await measure(page, async () => {
            await strip(page).locator('[data-assignee-save-failed]').getByRole('button', { name: 'Retry' }).click();
            await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
        });
        console.log('DOD9_MEASURE', 'person-row edits and save states', JSON.stringify(results));
        testInfo.annotations.push({ type: 'dod9', description: `person-row edits and save states ${JSON.stringify(results)}` });
        for (const [name, result] of Object.entries(results)) {
            expect(result.renders, `App renders on ${name}`).toBe(0);
            expect(result.teamTasks, `team list rebuilds on ${name}`).toBe(0);
        }
    });
});

// ---- Undo (#323 Task 12) ---------------------------------------------------------------------------------

const undoButton = page => strip(page).getByRole('button', { name: 'Undo', exact: true });
const annRows = () => [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }];

test('Cmd/Ctrl+Z in the table reverses the last edit with one PATCH and no extra read; a settled screenshot shows the Undo control', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(undoButton(page)).toBeDisabled();
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('11'); await capacity.press('Tab');
    await expect.poll(() => server.state.patches.length).toBe(1);
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await expect(undoButton(page)).toBeEnabled();
    const gets = server.state.gets;
    // Focus is on the next (unedited) cell of the table.
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Vacations for Ann Synthetic' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(capacity).toHaveValue('8');
    await expect.poll(() => server.state.patches.length).toBe(2);
    expect(server.state.patches[1].body.changes).toEqual([{ assigneeKey: 'acc-ann', capacity: '8' }]);
    await expect(undoButton(page)).toBeDisabled();
    await page.waitForTimeout(400);
    expect(server.state.patches).toHaveLength(2);
    expect(server.state.gets, 'an undo reads nothing').toBe(gets);
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await capacity.fill('10'); await capacity.press('Tab');
    await expect(undoButton(page)).toBeEnabled();
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    const box = await undoButton(page).boundingBox();
    expect(box.height).toBeGreaterThan(0);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/slice7-shots/strip-with-undo.png', animations: 'disabled' });
});

// #323 Task 8 Step 4 (operator request 2026-11-06): Enter keeps focus in the table, on the committed cell, so Cmd/Ctrl+Z works.
test('after Enter commits a cell, Cmd/Ctrl+Z undoes it', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('11'); await capacity.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-ann', capacity: '11' }]);
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    // Focus sits on the committed cell's container: inside the table, not on the input and not on the page.
    const focus = await page.evaluate(() => { const node = document.activeElement; return { tag: node.tagName, inTable: Boolean(node.closest('table.planning-assignee-table')), holdsInput: node.querySelector('input')?.getAttribute('aria-label') || '' }; });
    expect(focus).toEqual({ tag: 'TD', inTable: true, holdsInput: 'Capacity for Ann Synthetic' });
    // The keyboard-focused cell draws the design-system focus ring (inset), not the browser's default outline.
    const ring = await page.evaluate(() => {
        const node = document.activeElement, style = getComputedStyle(node), probe = document.createElement('span');
        probe.style.color = 'var(--focus-ring-color)'; document.body.appendChild(probe);
        const token = getComputedStyle(probe).color; probe.remove();
        return { focusVisible: node.matches(':focus-visible'), outline: `${style.outlineStyle} ${style.outlineWidth}`, offset: style.outlineOffset, colorIsToken: style.outlineColor === token };
    });
    expect(ring, 'the focus token ring on the committed cell').toEqual({ focusVisible: true, outline: 'solid 2px', offset: '-2px', colorIsToken: true });
    await page.mouse.move(5, 600);
    await rowOf(page, 'acc-ann').screenshot({ path: 'tmp/planning-323-every-team/task8/focus-after-enter.png', animations: 'disabled' });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(capacity).toHaveValue('8');
    await expect.poll(() => server.state.patches.length).toBe(2);
    expect(server.state.patches[1].body.changes).toEqual([{ assigneeKey: 'acc-ann', capacity: '8' }]);
    await expect(undoButton(page)).toBeDisabled();
});

// The cell containers are focusable only so Enter can keep focus in the table; a pointer click on their padding shows no ring.
test('a pointer click on an assignee cell\'s padding shows no focus outline', async ({ page }, testInfo) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const input = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    const cell = rowOf(page, 'acc-ann').locator('td.planning-review-storyPoints').first();
    await expect(cell.getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toHaveCount(1);
    const [cellBox, inputBox] = [await cell.boundingBox(), await input.boundingBox()];
    const gap = inputBox.x - cellBox.x;
    expect(gap, 'the cell has padding left of its input').toBeGreaterThan(2);
    await page.mouse.click(cellBox.x + gap / 2, cellBox.y + cellBox.height / 2);
    await page.mouse.move(5, 600);
    const ring = await page.evaluate(() => { const node = document.activeElement, style = getComputedStyle(node);
        return { tag: node.tagName, focusVisible: node.matches(':focus-visible'), outline: style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0 ? 'none' : `${style.outlineStyle} ${style.outlineWidth}`, shadow: style.boxShadow }; });
    // The click focuses the cell container (Chromium, Firefox and WebKit), which paints no ring for a pointer focus.
    expect(ring, 'no ring on a pointer-focused cell').toEqual({ tag: 'TD', focusVisible: false, outline: 'none', shadow: 'none' });
    expect(server.state.patches).toHaveLength(0);
    await rowOf(page, 'acc-ann').screenshot({ path: `tmp/planning-323-every-team/task8/pointer-cell-click-${testInfo.project.name || 'default'}.png`, animations: 'disabled' });
});

test('while a cell is being edited, Cmd/Ctrl+Z is the input\'s native undo', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('11'); await capacity.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    await expect(undoButton(page)).toBeEnabled();
    const notes = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Notes for Ann Synthetic' });
    await notes.click();
    await page.keyboard.type('draft');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(notes, 'the input undid its own typing').not.toHaveValue('draft');
    await expect(notes).toBeFocused();
    await page.waitForTimeout(400);
    expect(server.state.patches, 'the table Undo did not run').toHaveLength(1);
    await expect(capacity).toHaveValue('11');
    await expect(undoButton(page)).toBeEnabled();
});

test('the shortcut is ignored while a cell is mid-edit, when focus is outside the table, and on key auto-repeat', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('11'); await capacity.press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    await expect(undoButton(page)).toBeEnabled();
    // Mid-edit: the input keeps its own native undo, the stack is untouched.
    const notes = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Notes for Ann Synthetic' });
    await notes.click(); await page.keyboard.type('draft');
    const midEdit = await notes.evaluate(node => { const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }); node.dispatchEvent(event); return event.defaultPrevented; });
    expect(midEdit, 'a mid-edit cell is not handled').toBe(false);
    await page.keyboard.press('Escape');
    await expect(notes).toHaveValue('');
    await expect(capacity).toHaveValue('11');
    await expect(undoButton(page)).toBeEnabled();
    // Auto-repeat on a clean cell is ignored.
    const repeat = await notes.evaluate(node => { node.focus(); const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, repeat: true, bubbles: true, cancelable: true }); node.dispatchEvent(event); return event.defaultPrevented; });
    expect(repeat).toBe(false);
    await expect(capacity).toHaveValue('11');
    // Focus outside the table: dispatched to the page (a real key press there would also run WebKit's page-level native undo).
    await notes.evaluate(node => node.blur());
    const outside = await page.evaluate(() => { const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(event); return event.defaultPrevented; });
    expect(outside).toBe(false);
    await page.waitForTimeout(400);
    await expect(capacity).toHaveValue('11');
    expect(server.state.patches).toHaveLength(1);
    await expect(undoButton(page)).toBeEnabled();
    // Inside the table, clean: handled and prevented.
    const handled = await notes.evaluate(node => { node.focus(); const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }); node.dispatchEvent(event); return event.defaultPrevented; });
    expect(handled).toBe(true);
    await expect(capacity).toHaveValue('8');
    await expect.poll(() => server.state.patches.length).toBe(2);
});

test('the Undo control works by tap', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: [...annRows(), { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await stripToggle(page).tap(); await expect(table(page)).toBeVisible();
    await rowOf(page, 'acc-cy').getByRole('button', { name: 'Remove Cy Former' }).tap();
    await expect(rowOf(page, 'acc-cy')).toHaveCount(0);
    await expect.poll(() => server.state.patches.length).toBe(1);
    await undoButton(page).tap();
    await expect(rowOf(page, 'acc-cy')).toHaveCount(1);
    await expect.poll(() => server.state.patches.length).toBe(2);
    expect(server.state.patches[1].body.changes).toEqual([{ assigneeKey: 'acc-cy', removed: false }]);
    await expect(undoButton(page)).toBeDisabled();
    await context.close();
});

// #323 Task 8 Step 5: the documented Undo semantics (docs/features/planning-sprint-review.md).
test('Undo of Add assignee sends removed: true, because there is no delete route', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await addTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search Assignee to add' }).pressSequentially('nor', { delay: 30 });
    await peopleMenu(page).getByRole('option', { name: 'Nora Newcomer' }).click();
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-new', displayName: 'Nora Newcomer' }]);
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await undoButton(page).click();
    await expect(rowOf(page, 'acc-new')).toHaveCount(0);
    await expect.poll(() => server.state.patches.length).toBe(2);
    expect(server.state.patches[1].body.changes).toEqual([{ assigneeKey: 'acc-new', removed: true }]);
    expect(server.state.rows.find(row => row.assigneeKey === 'acc-new')).toMatchObject({ removed: true });
    expect(calls.filter(call => call.method === 'DELETE'), 'no delete request').toEqual([]);
});

test('Undo restoring an inherited stored number sends it as source user and says the Sprint kept its own copy', async ({ page }) => {
    const server = plannedServer({ docs: { [String(activeSprintId)]: { revision: 1, rows: [], planned: { value: '12', source: 'user' } } } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: noTicket });
    await openPlanningIn(page, futureSprintName);
    await showCards(page);
    await expect(alphaCard(page)).toContainText('12.0');
    await expand(page);
    await hover(page, alphaCard(page));
    await plannedPencil(page).click();
    const input = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team team capacity (not in Jira)' });
    await input.fill('14');
    await input.press('Enter');
    await expect.poll(() => assigneeWrites(calls).length).toBe(1);
    expect(assigneeWrites(calls)[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'user' }, changes: [] });
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();
    await expect.poll(() => assigneeWrites(calls).length).toBe(2);
    expect(assigneeWrites(calls)[1].body, 'the inherited number is saved as this Sprint\'s own').toEqual({ teamId: 'team-alpha', planned: { value: '12', source: 'user' }, changes: [] });
    await expect(strip(page).locator('[data-assignee-undo-kept]')).toHaveText('Undo kept this Sprint\'s own copy with the inherited values.');
    await expect(alphaCard(page)).toContainText('12.0');
    expect(server.state.docs[String(futureSprintId)].revision, 'the Sprint keeps its own document').toBeGreaterThan(0);
});

test('read-only shows no Undo control', async ({ page }) => {
    const server = capacityServer({ rows: annRows(), capabilities: { canRead: true, canSave: false, reason: 'database_required' } });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(strip(page).getByText('Assignee capacity is read-only here.')).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0);
});

test('the undo stack is cleared after a Team switch and after a failed save', async ({ page }) => {
    let fail = false;
    const server = capacityServer({ rows: annRows(), patchStatus: () => (fail ? 503 : 0) });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = () => rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity().fill('11'); await capacity().press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(1);
    await expect(undoButton(page)).toBeEnabled();
    await pickTeam(page, 'Beta Team');
    await pickTeam(page, 'Alpha Team');
    await expect(strip(page)).toBeVisible();
    await pickTeam(page, 'Alpha Team');
    await pickTeam(page, 'Beta Team');
    await expect(table(page)).toBeVisible();
    await expect(undoButton(page), 'back on the first Team the stack is gone').toBeDisabled();
    await capacity().fill('12'); await capacity().press('Enter');
    await expect.poll(() => server.state.patches.length).toBe(2);
    await expect(undoButton(page)).toBeEnabled();
    fail = true;
    await capacity().fill('13'); await capacity().press('Enter');
    await expect(strip(page).locator('[data-assignee-save-failed]')).toContainText('Not saved');
    await expect(undoButton(page)).toBeDisabled();
});


// ---- strip header: toggle ring inset, Undo in the header, avatars (#323 operator review) -------------------------

const AVATAR_HOST = 'avatar-management--avatars.us-west-2.prod.public.atl-paas.net';
const PHOTO = `https://${AVATAR_HOST}/synthetic/photo/32`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const effortPanelOf = page => page.locator('.capacity-panel.open:not([data-assignee-capacity])');
// Both strip headers (Assignee Capacity and Planned Teams Effort) measured against their own panel.
const headerGeometry = page => page.evaluate(() => [...document.querySelectorAll('.capacity-panel.open')].map(panel => {
    const r = node => { if (!node) return null; const b = node.getBoundingClientRect(); return b.width ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height } : null; };
    const style = getComputedStyle(panel);
    const status = panel.querySelector('.capacity-subtitle');
    return {
        which: panel.hasAttribute('data-assignee-capacity') ? 'assignee' : 'effort',
        panel: r(panel), border: parseFloat(style.borderLeftWidth), padding: parseFloat(style.paddingLeft), overflow: style.overflow,
        toggle: r(panel.querySelector('.capacity-header-toggle')), title: r(panel.querySelector('.capacity-title')),
        status: status && status.textContent.trim() ? r(status) : null,
        grid: r(panel.querySelector('.capacity-grid-wrapper')),
        undo: r(panel.querySelector(':scope > .capacity-header > .planning-action-button')),
        nested: panel.querySelectorAll('.capacity-header-toggle button').length,
    };
}));
const expandEffort = async page => { await effortPanelOf(page).locator('.capacity-header-toggle').click(); await expect(effortPanelOf(page)).not.toHaveClass(/capacity-panel-collapsed/); };

test('both strip toggles keep their text in place while the hover ring clears it, collapsed and expanded', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    const check = (entry, collapsed) => {
        const label = `${entry.which} ${collapsed ? 'collapsed' : 'expanded'}`;
        const inner = { left: entry.panel.left + entry.border, right: entry.panel.right - entry.border };
        // The text sits on the panel's content edge, exactly where it was with the unpadded toggle.
        expect(entry.title.left, label).toBeCloseTo(inner.left + 12, 1);
        expect(entry.title.left - entry.toggle.left, label).toBeGreaterThanOrEqual(8);
        expect(entry.title.top - entry.toggle.top, label).toBeGreaterThanOrEqual(2);
        expect(entry.toggle.bottom - entry.title.bottom, label).toBeGreaterThanOrEqual(2);
        if (entry.status) expect(entry.toggle.right - entry.status.right, label).toBeGreaterThanOrEqual(8);
        if (collapsed) {
            expect(entry.panel.height, label).toBeCloseTo(28, 1);
            expect(entry.overflow, label).toBe('hidden');
            // Nothing of the toggle is clipped by the 28px strip.
            expect(entry.toggle.top, label).toBeGreaterThanOrEqual(entry.panel.top + entry.border - 0.5);
            expect(entry.toggle.bottom, label).toBeLessThanOrEqual(entry.panel.bottom - entry.border + 0.5);
            expect(entry.toggle.left, label).toBeGreaterThanOrEqual(inner.left - 0.5);
            expect(entry.toggle.right, label).toBeLessThanOrEqual(inner.right + 0.5);
            expect(entry.title.top - entry.panel.top, label).toBeCloseTo(entry.panel.bottom - entry.title.bottom, 0);
        } else {
            expect(entry.toggle.left, label).toBeCloseTo(inner.left, 1);
            expect(entry.title.top, label).toBeCloseTo(entry.panel.top + entry.border + 12, 1);
            // The header keeps its 0.5rem gap to the grid, so the panel height does not change.
            expect(entry.grid.top - entry.title.bottom, label).toBeCloseTo(8, 1);
        }
    };
    const collapsed = await headerGeometry(page);
    expect(collapsed.map(entry => entry.which)).toEqual(['assignee', 'effort']);
    for (const entry of collapsed) check(entry, true);
    await stripToggle(page).hover(); await page.waitForTimeout(250);
    expect(await headerGeometry(page), 'collapsed hover keeps geometry').toEqual(collapsed);
    const collapsedBox = await strip(page).boundingBox();
    await page.screenshot({ path: 'tmp/slice8-shots/hover-assignee-collapsed.png', clip: { x: collapsedBox.x - 4, y: collapsedBox.y - 4, width: collapsedBox.width + 8, height: collapsedBox.height + 8 }, animations: 'disabled', scale: 'device' });
    await page.mouse.move(0, 0);
    await expand(page); await expandEffort(page);
    const expanded = await headerGeometry(page);
    for (const entry of expanded) check(entry, false);
    expect(expanded.find(entry => entry.which === 'effort').status, 'the effort subtitle is measured').not.toBeNull();
    // Settled hover: paint only, the text does not move; zoomed element captures with animations disabled.
    for (const [which, toggle] of [['assignee', stripToggle(page)], ['effort', effortPanelOf(page).locator('.capacity-header-toggle')]]) {
        const before = await headerGeometry(page);
        await toggle.hover(); await page.waitForTimeout(250);
        const after = await headerGeometry(page);
        expect(after, `${which} hover keeps geometry`).toEqual(before);
        expect(await toggle.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
        const box = await toggle.boundingBox();
        await page.screenshot({ path: `tmp/slice8-shots/hover-${which}-expanded.png`, clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 }, animations: 'disabled', scale: 'device' });
    }
    await page.mouse.move(0, 0);
});

test('Undo sits in the expanded strip header right of the save status, never inside the toggle, and leaves the header height alone', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expect(undoButton(page), 'collapsed: no Undo').toHaveCount(0);
    await expand(page);
    await expect(undoButton(page)).toBeDisabled();
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('11'); await capacity.press('Enter');
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await expect(undoButton(page)).toBeEnabled();
    await expect(strip(page).locator('.planning-review-guidance').getByRole('button', { name: 'Undo', exact: true }), 'not under the table').toHaveCount(0);
    expect(await undoButton(page).evaluate(node => node.draggable)).toBe(false);
    const [entry] = (await headerGeometry(page)).filter(item => item.which === 'assignee');
    expect(entry.nested, 'no button nested in the toggle').toBe(0);
    const contentRight = entry.panel.right - entry.border - 12;
    expect(entry.undo.right).toBeLessThanOrEqual(contentRight + 0.5);
    expect(entry.undo.right).toBeGreaterThanOrEqual(contentRight - 0.5);
    expect((entry.undo.top + entry.undo.bottom) / 2).toBeCloseTo((entry.title.top + entry.title.bottom) / 2, 0);
    // The ring ends before Undo; the status keeps its 8px of ring clearance and sits just left of Undo.
    expect(entry.toggle.right).toBeLessThanOrEqual(entry.undo.left + 0.5);
    expect(entry.status.right).toBeLessThanOrEqual(entry.undo.left - 8);
    expect(entry.undo.left - entry.status.right).toBeLessThanOrEqual(24);
    expect(entry.toggle.right - entry.status.right).toBeGreaterThanOrEqual(8);
    expect(entry.title.top).toBeCloseTo(entry.panel.top + entry.border + 12, 1);
    expect(entry.grid.top - entry.title.bottom, 'header height unchanged').toBeCloseTo(8, 1);
    const header = strip(page).locator(':scope > .capacity-header');
    await stripToggle(page).hover(); await page.waitForTimeout(250);
    expect((await headerGeometry(page)).find(item => item.which === 'assignee'), 'hover keeps the header geometry').toEqual(entry);
    const box = await header.boundingBox();
    await page.screenshot({ path: 'tmp/slice8-shots/header-undo-status-hover.png', clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 }, animations: 'disabled', scale: 'device' });
    await page.mouse.move(0, 0);
    await undoButton(page).click();
    await expect(capacity).toHaveValue('8');
    await stripToggle(page).click();
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(undoButton(page), 'collapsed again: no Undo').toHaveCount(0);
    await expect(strip(page)).toHaveCSS('height', '28px');
});

test('person rows show the loaded Story assignee photo in the issue-card slot, a glyph otherwise, with no extra request and unchanged rows', async ({ page }) => {
    const issues = stories.map(task => (task.fields.assignee?.accountId === 'acc-ann' ? { ...task, fields: { ...task.fields, assignee: { ...task.fields.assignee, avatarUrl: PHOTO } } } : task));
    const imageRequests = [];
    await page.route(`https://${AVATAR_HOST}/**`, route => { imageRequests.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
    const server = capacityServer({ rows: [...annRows(), { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server, issues });
    await openPlanning(page);
    await expand(page);
    const apiBefore = calls.map(call => `${call.method} ${call.pathname}`);
    const ann = rowOf(page, 'acc-ann').locator('.planning-assignee-person > .task-assignee-icon');
    await expect(ann.locator('img')).toHaveAttribute('src', PHOTO);
    await expect.poll(() => ann.locator('img').evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    for (const key of ['acc-bob', 'acc-cy']) {
        await expect(rowOf(page, key).locator('.planning-assignee-person > .task-assignee-icon svg'), `${key} keeps the glyph`).toHaveCount(1);
        await expect(rowOf(page, key).locator('.task-assignee-icon img')).toHaveCount(0);
    }
    // Unassigned: an empty slot of the same element, so its name lines up (no glyph, no photo).
    await expect(rowOf(page, 'unassigned').locator('.task-assignee-icon')).toHaveCount(1);
    await expect(rowOf(page, 'unassigned').locator('.task-assignee-icon svg, .task-assignee-icon img')).toHaveCount(0);
    const nameColumn = await table(page).locator('thead th.planning-assignee-name').evaluate(th => th.getBoundingClientRect().width);
    const rows = await table(page).evaluate(node => {
        const r = n => n.getBoundingClientRect();
        return {
            heights: [...node.querySelectorAll('tbody tr')].map(tr => ({ key: tr.dataset.assigneeKey, height: r(tr).height })),
            icons: [...node.querySelectorAll('tbody .task-assignee-icon')].map(icon => {
                const name = icon.parentElement.querySelector('.planning-review-truncated-value');
                const cell = icon.closest('td');
                return { width: r(icon).width, height: r(icon).height, iconMid: (r(icon).top + r(icon).bottom) / 2, nameMid: (r(name).top + r(name).bottom) / 2, inCell: r(icon).left >= r(cell).left && r(name).right <= r(cell).right + 0.5, cellWidth: r(cell).width };
            }),
        };
    });
    // Row heights are what they are without the slot (a row with Remove is taller either way); the slot is the card's 14px one.
    const hide = await page.addStyleTag({ content: '.planning-assignee-person > .task-assignee-icon{display:none!important}' });
    const without = await table(page).evaluate(node => [...node.querySelectorAll('tbody tr')].map(tr => ({ key: tr.dataset.assigneeKey, height: tr.getBoundingClientRect().height })));
    await hide.evaluate(node => node.remove());
    expect(rows.heights).toEqual(without);
    for (const icon of rows.icons) {
        expect(icon.width).toBeCloseTo(14, 1); expect(icon.height).toBeCloseTo(14, 1);
        expect(Math.abs(icon.iconMid - icon.nameMid)).toBeLessThanOrEqual(1);
        expect(icon.inCell).toBe(true); expect(icon.cellWidth).toBeCloseTo(nameColumn, 0);
    }
    await page.waitForTimeout(300);
    expect(calls.map(call => `${call.method} ${call.pathname}`), 'no API request for avatars').toEqual(apiBefore);
    expect(new Set(imageRequests)).toEqual(new Set([PHOTO]));
    // A person added in this session has no loaded Story and this search result carries no avatar: the glyph.
    await addTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search Assignee to add' }).pressSequentially('nor', { delay: 30 });
    await peopleMenu(page).getByRole('option', { name: 'Nora Newcomer' }).click();
    await expect(rowOf(page, 'acc-new').locator('.task-assignee-icon svg')).toHaveCount(1);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/slice8-shots/strip-expanded-undo-avatars.png', animations: 'disabled' });
});

// ---- operator review round 2: full-width table, Unassigned alignment, added-person avatar (#323) -------------------

const tableGeometry = page => page.evaluate(() => {
    const r = node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    const panel = document.querySelector('[data-assignee-capacity]');
    const style = getComputedStyle(panel);
    const tableNode = panel.querySelector('table.planning-assignee-table');
    const cells = selector => [...tableNode.querySelectorAll(selector)].map(r);
    return {
        contentRight: panel.getBoundingClientRect().right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        contentLeft: panel.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        table: r(tableNode), head: cells('thead th'), foot: cells('tfoot td'),
        rows: [...tableNode.querySelectorAll('tbody tr')].map(tr => ({ key: tr.dataset.assigneeKey, height: tr.getBoundingClientRect().height, cells: [...tr.children].map(r) })),
        nameX: [...tableNode.querySelectorAll('tbody tr')].map(tr => {
            const text = tr.querySelector('td.planning-assignee-name .planning-review-truncated-value, td.planning-assignee-name .planning-assignee-unassigned-name') || tr.querySelector('td.planning-assignee-name');
            const range = document.createRange(); range.selectNodeContents(text); const box = range.getBoundingClientRect();
            return { key: tr.dataset.assigneeKey, x: box.left };
        }),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wrapperOverflow: (node => node.scrollWidth - node.clientWidth)(panel.querySelector('.capacity-grid-wrapper')),
    };
});

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`the table fills the expanded strip's content width at ${width}x${height}, with header, totals and rows aligned`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = capacityServer({ rows: [
        { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: '1', notes: 'away Friday', removed: false },
        { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false },
    ] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const g = await tableGeometry(page);
    console.log('SLICE9_TABLE_GEOMETRY', width, JSON.stringify({ contentRight: g.contentRight, tableRight: g.table.right, tableWidth: g.table.width, rowHeights: g.rows.map(row => [row.key, row.height]), heads: g.head.map(cell => cell.width) }));
    expect(Math.abs(g.table.right - g.contentRight), 'table right edge on the panel content edge').toBeLessThanOrEqual(1);
    expect(Math.abs(g.table.left - g.contentLeft)).toBeLessThanOrEqual(1);
    expect(g.head.length).toBe(g.foot.length);
    g.head.forEach((cell, index) => {
        expect(Math.abs(cell.left - g.foot[index].left), `column ${index} left`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(cell.right - g.foot[index].right), `column ${index} right`).toBeLessThanOrEqual(0.5);
        for (const row of g.rows) expect(Math.abs(row.cells[index].left - cell.left), `${row.key} column ${index}`).toBeLessThanOrEqual(0.5);
    });
    expect(g.pageOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
    expect(g.wrapperOverflow).toBeLessThanOrEqual(0);
});

test('the Unassigned name lines up with the person names through an empty person slot', async ({ page }) => {
    const server = capacityServer({ rows: annRows() });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const slot = rowOf(page, 'unassigned').locator('.planning-assignee-person > .task-assignee-icon');
    await expect(slot).toHaveCount(1);
    await expect(slot.locator('svg, img')).toHaveCount(0);
    await expect(slot).toHaveAttribute('aria-hidden', 'true');
    const g = await tableGeometry(page);
    expect(g.nameX.map(entry => entry.key)).toEqual(['unassigned', 'acc-ann', 'acc-bob']);
    for (const entry of g.nameX) expect(Math.abs(entry.x - g.nameX[1].x), entry.key).toBeLessThanOrEqual(0.5);
    expect(g.rows.find(row => row.key === 'unassigned').height).toBe(32);
});

test('desktop touch removal keeps its 24px target and the table inside its wrapper', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: [...annRows(), { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: '3', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await stripToggle(page).tap(); await expect(table(page)).toBeVisible();
    const g = await tableGeometry(page);
    expect(g.pageOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
    expect(g.table.width).toBeGreaterThanOrEqual(680);
    const remove = rowOf(page, 'acc-cy').getByRole('button', { name: 'Remove Cy Former' });
    const box = await remove.boundingBox();
    expect(box.width).toBeCloseTo(24, 0); expect(box.height).toBeCloseTo(24, 0);
    await remove.tap();
    await expect(rowOf(page, 'acc-cy')).toHaveCount(0);
    await strip(page).screenshot({ path: 'tmp/slice9-shots/strip-desktop-touch.png', animations: 'disabled' });
    await context.close();
});

test('a person added this session shows the search result photo until reload; no email reaches the page', async ({ page }) => {
    const NORA = `https://${AVATAR_HOST}/synthetic/nora/32`;
    await page.route(`https://${AVATAR_HOST}/**`, route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    const people = query => ({ users: defaultPeople(query).users.map(user => (user.accountId === 'acc-new' ? { ...user, avatarUrl: NORA } : user)), reason: null });
    const server = capacityServer({ rows: annRows() });
    await install(page, { server, people });
    await openPlanning(page);
    await expand(page);
    await addTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search Assignee to add' }).pressSequentially('nor', { delay: 30 });
    await peopleMenu(page).getByRole('option', { name: 'Nora Newcomer' }).click();
    const nora = rowOf(page, 'acc-new').locator('.planning-assignee-person > .task-assignee-icon');
    await expect(nora.locator('img')).toHaveAttribute('src', NORA);
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches.at(-1).body.changes).toEqual([{ assigneeKey: 'acc-new', displayName: 'Nora Newcomer' }]);
    // Switching Team and back keeps the session's photo (the Map lives for the page session).
    await pickTeam(page, 'Beta Team'); await pickTeam(page, 'Alpha Team');
    await pickTeam(page, 'Alpha Team'); await pickTeam(page, 'Beta Team');
    await expect(table(page)).toBeVisible();
    await expect(rowOf(page, 'acc-new').locator('.task-assignee-icon img')).toHaveAttribute('src', NORA);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/slice9-shots/added-person-avatar.png', animations: 'disabled' });
    await page.reload();
    await openPlanning(page);
    await expect(table(page)).toBeVisible();
    await expect(rowOf(page, 'acc-new').locator('.task-assignee-icon svg'), 'after reload the glyph').toHaveCount(1);
    await expect(rowOf(page, 'acc-new').locator('.task-assignee-icon img')).toHaveCount(0);
});

// ---- operator review round 3: capacity marks and two-level person segments (#323) ----------------------------------

// Ann over (Capacity 3, effort 5 > 1.2 x 3: over mark; effort above capacity), Bob effort only (no Capacity: no mark),
// Cy neither, Eve spare capacity (Capacity 4, effort 2 < 0.8 x 4: no mark; effort below capacity), Fay at the upper
// boundary (Capacity 2.5, effort 3 = 1.2 x 2.5 exactly: on plan; effort above capacity), Zoe capacity only (Capacity 5,
// effort 0: no mark), Gus removed; Unassigned 4. Team Cap 20, Selected 19, strip 5 + 5 + 4 + 3 + 5 + 4 = 26, axis 29.9.
const layerStories = [...stories, story('PLAN-6', 'acc-eve', 'Eve Synthetic', 2), story('PLAN-7', 'acc-fay', 'Fay Synthetic', 3)];
const layerRows = [
    { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '3', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-bob', displayName: 'Bob Synthetic', capacity: null, vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: null, vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-eve', displayName: 'Eve Synthetic', capacity: '4', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-fay', displayName: 'Fay Synthetic', capacity: '2.5', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-zoe', displayName: 'Zoe Capacity Only', capacity: '5', vacations: null, notes: null, removed: false },
    { assigneeKey: 'acc-gus', displayName: 'Gus Removed', capacity: '1', vacations: null, notes: null, removed: true },
];
const ANN_SENTENCE = 'Effort 5 SP, capacity 3 SP: 2 SP over capacity';
const FAY_SENTENCE = 'Effort 3 SP of capacity 2.5 SP: on plan';
const markSlot = (page, key) => rowOf(page, key).locator('[data-assignee-mark]');
const markReadout = page => page.locator('.epic-full-value-readout');
async function expectBoxInViewport(page, locator) {
    const viewport = page.viewportSize();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}
const nameGeometry = page => page.evaluate(() => [...document.querySelectorAll('[data-assignee-capacity] tbody tr')].map(tr => {
    const r = node => { const b = node.getBoundingClientRect(); return { left: b.left, width: b.width, height: b.height, top: b.top }; };
    const text = tr.querySelector('td.planning-assignee-name .planning-review-truncated-value');
    const range = document.createRange(); range.selectNodeContents(text);
    return { key: tr.dataset.assigneeKey, height: tr.getBoundingClientRect().height, slot: r(tr.querySelector('[data-assignee-mark]')),
        avatar: r(tr.querySelector('.task-assignee-icon')), nameX: range.getBoundingClientRect().left, removable: Boolean(tr.querySelector('.planning-review-column-action')) };
}));

test('marks: on plan within 20% of capacity and over above 120%, none otherwise, in a fixed slot on every row that keeps names aligned and rows the same height', async ({ page }) => {
    const server = capacityServer({ rows: layerRows });
    await install(page, { server, capacityProject: 'CAP', issues: layerStories });
    await openPlanning(page);
    await expand(page);
    expect(await names(page)).toEqual(['Unassigned', 'Ann Synthetic', 'Bob Synthetic', 'Cy Former', 'Eve Synthetic', 'Fay Synthetic', 'Zoe Capacity Only']);
    // Ann over, Fay on plan (the 1.2 x boundary is inclusive); spare capacity (Eve, Zoe), no capacity (Bob, Cy),
    // Unassigned and the removed Gus get none.
    await expect(table(page).locator('[data-assignee-mark] button')).toHaveCount(2);
    await expect(markSlot(page, 'acc-ann')).toHaveAttribute('data-mark', 'over');
    await expect(markSlot(page, 'acc-fay')).toHaveAttribute('data-mark', 'on-plan');
    for (const [key, sentence] of [['acc-ann', ANN_SENTENCE], ['acc-fay', FAY_SENTENCE]]) {
        const mark = markSlot(page, key).getByRole('button', { name: sentence, exact: true });
        await expect(mark, key).toHaveCount(1);
        await expect(mark, key).not.toHaveAttribute('title', /.*/);
    }
    for (const key of ['unassigned', 'acc-bob', 'acc-cy', 'acc-eve', 'acc-zoe']) {
        await expect(markSlot(page, key), key).toHaveCount(1);
        await expect(markSlot(page, key).locator('*'), key).toHaveCount(0);
        await expect(markSlot(page, key), key).toHaveAttribute('aria-hidden', 'true');
        await expect(markSlot(page, key), key).not.toHaveAttribute('data-mark', /.*/);
    }
    // Ink is the --warn and --good tokens through currentColor; no emoji character anywhere in the cells.
    const tokens = await page.evaluate(() => {
        const probe = document.createElement('i'); document.body.appendChild(probe);
        const resolve = value => { probe.style.color = value; return getComputedStyle(probe).color; };
        const result = { warn: resolve('var(--warn)'), good: resolve('var(--good)'), white: resolve('var(--bg-secondary)') };
        probe.remove();
        return result;
    });
    const ink = key => markSlot(page, key).evaluate(node => {
        const svg = node.querySelector('svg');
        return { color: getComputedStyle(node.querySelector('button')).color, painted: [...svg.querySelectorAll('[stroke], [fill]')].filter(el => el !== svg)
            .map(el => el.getAttribute('stroke') || el.getAttribute('fill') || ''), check: svg.querySelector('path[style]') ? getComputedStyle(svg.querySelector('path[style]')).stroke : null,
            text: node.textContent };
    });
    const over = await ink('acc-ann'), onPlan = await ink('acc-fay');
    expect(over.color).toBe(tokens.warn);
    expect(new Set(over.painted)).toEqual(new Set(['currentColor']));
    expect(onPlan.color).toBe(tokens.good);
    expect(onPlan.check, 'the check is drawn in the surface white').toBe(tokens.white);
    expect(over.text + onPlan.text).toBe('');
    expect(await table(page).locator('tbody').textContent()).not.toMatch(/[\u2600-\u27bf\u{1f300}-\u{1faff}\u203c]/u);
    const g = await nameGeometry(page);
    // Before the slot existed: the same rows with every mark slot taken out, so the heights compare like for like.
    const withoutSlots = await page.evaluate(() => {
        const heights = () => [...document.querySelectorAll('[data-assignee-capacity] tbody tr')].map(tr => [tr.dataset.assigneeKey, tr.getBoundingClientRect().height]);
        const slots = [...document.querySelectorAll('[data-assignee-mark]')].map(node => [node.parentElement, node, node.nextSibling]);
        slots.forEach(([, node]) => node.remove());
        const without = heights();
        slots.forEach(([parent, node, next]) => parent.insertBefore(node, next));
        return without;
    });
    console.log('SLICE10_ROW_HEIGHTS', JSON.stringify({ withSlots: g.map(row => [row.key, row.height]), withoutSlots }));
    expect(g.map(row => [row.key, row.height]), 'the slot and marks change no row height').toEqual(withoutSlots);
    for (const row of g) {
        expect(row.slot.width, row.key).toBe(14);
        expect(Math.abs(row.slot.left - g[0].slot.left), `${row.key} slot x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.avatar.left - g[0].avatar.left), `${row.key} avatar x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.nameX - g[0].nameX), `${row.key} name x`).toBeLessThanOrEqual(0.5);
        // Rows keep the slice 9 heights: 32, and 35 where the 24px Remove sits (Cy and Zoe have no Stories). WebKit lays the
        // person rows out at 32.39 with or without the slot (asserted above), so allow half a pixel there.
        expect(Math.abs(row.height - (row.removable ? 35 : 32)), `${row.key} ${row.height}`).toBeLessThanOrEqual(0.5);
    }
    // Each icon fills its slot and its 24x24 hit area is centred on it.
    for (const key of ['acc-ann', 'acc-fay']) {
        const hit = await markSlot(page, key).locator('button').evaluate(node => {
            const slot = node.parentElement.getBoundingClientRect(), before = getComputedStyle(node, '::before'), svg = node.querySelector('svg').getBoundingClientRect();
            return { slot: [slot.left, slot.top, slot.width, slot.height], svg: [svg.left, svg.top, svg.width, svg.height], hitWidth: before.width, hitHeight: before.height, hitTop: before.top, hitLeft: before.left };
        });
        expect(hit.svg, key).toEqual(hit.slot);
        expect(hit, key).toMatchObject({ hitWidth: '24px', hitHeight: '24px', hitTop: '-5px', hitLeft: '-5px' });
    }
    await page.mouse.move(5, 400);
    await strip(page).scrollIntoViewIfNeeded();
    await table(page).locator('tbody').screenshot({ path: 'tmp/slice10-shots/table-marks.png', animations: 'disabled' });
});

test('a mark opens its in-app readout on hover and on keyboard focus, inside the viewport, and writes nothing', async ({ page, browserName }) => {
    const server = capacityServer({ rows: layerRows });
    // No capacity project, so no stored-number mirror PATCH: any write here would come from a mark.
    const { calls } = await install(page, { server, issues: layerStories });
    await openPlanning(page);
    await expand(page);
    const since = calls.length;
    for (const [key, sentence] of [['acc-ann', ANN_SENTENCE], ['acc-fay', FAY_SENTENCE]]) {
        const mark = markSlot(page, key).locator('button');
        const before = await rowOf(page, key).boundingBox();
        await mark.hover();
        await expect(markReadout(page), key).toHaveText(sentence);
        await expectBoxInViewport(page, markReadout(page));
        expect(await rowOf(page, key).boundingBox(), key).toEqual(before);
        await page.mouse.move(5, 400);
        await expect(markReadout(page), key).toHaveCount(0);
    }
    // Keyboard: from the strip toggle the next stop is Ann's mark (Undo is disabled, Unassigned has no control).
    await stripToggle(page).focus();
    // WebKit moves keyboard focus to buttons with Option+Tab.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(markSlot(page, 'acc-ann').locator('button')).toBeFocused();
    await expect(markReadout(page)).toHaveText(ANN_SENTENCE);
    await page.keyboard.press('Escape');
    await expect(markReadout(page)).toHaveCount(0);
    await markSlot(page, 'acc-ann').locator('button').blur();
    // At 1280x720 with the row at the bottom edge of the viewport the readouts still fit (they open above).
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const key of ['acc-ann', 'acc-fay']) {
        await page.mouse.move(5, 5);
        await expect(markReadout(page)).toHaveCount(0);
        await rowOf(page, key).evaluate(node => node.scrollIntoView({ block: 'end' }));
        await markSlot(page, key).locator('button').hover();
        await expectBoxInViewport(page, markReadout(page));
    }
    await page.waitForTimeout(300);
    expect(calls.slice(since).filter(call => call.method !== 'GET'), 'the marks write nothing').toEqual([]);
    expect(server.state.patches).toHaveLength(0);
});

test('a mark follows the mouse by hover only: a click neither pins the readout nor leaves focus or a ring on the mark', async ({ page, browserName }) => {
    const server = capacityServer({ rows: layerRows });
    await install(page, { server, issues: layerStories });
    await openPlanning(page);
    await expand(page);
    for (const [key, sentence] of [['acc-ann', ANN_SENTENCE], ['acc-fay', FAY_SENTENCE]]) {
        const mark = markSlot(page, key).locator('button');
        await page.mouse.move(5, 400);
        await expect(markReadout(page), key).toHaveCount(0);
        await mark.hover();
        await expect(markReadout(page), `${key}: hover opens`).toHaveText(sentence);
        await page.mouse.move(5, 400);
        await expect(markReadout(page), `${key}: leave closes`).toHaveCount(0);
        await mark.click();
        await expect(markReadout(page), `${key}: still hovered after the click`).toHaveText(sentence);
        const state = await mark.evaluate(node => ({ focused: document.activeElement === node, focusVisible: node.matches(':focus-visible'), ring: getComputedStyle(node, '::before').outlineStyle }));
        expect(state, `${key}: the click leaves no focus and no ring`).toEqual({ focused: false, focusVisible: false, ring: 'none' });
        await page.mouse.move(5, 400);
        await expect(markReadout(page), `${key}: click then leave leaves no readout`).toHaveCount(0);
        await page.waitForTimeout(200);
        await expect(markReadout(page), `${key}: nothing was pinned`).toHaveCount(0);
        // A double click is two clicks: still nothing pinned.
        await mark.dblclick();
        await page.mouse.move(5, 400);
        await page.waitForTimeout(200);
        await expect(markReadout(page), `${key}: double click pins nothing`).toHaveCount(0);
    }
    // Keyboard focus (Tab) shows the readout with the ring; blur hides it.
    const ann = markSlot(page, 'acc-ann').locator('button');
    await stripToggle(page).focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(ann).toBeFocused();
    await expect(markReadout(page)).toHaveText(ANN_SENTENCE);
    expect(await ann.evaluate(node => getComputedStyle(node, '::before').outlineStyle)).toBe('solid');
    await ann.blur();
    await expect(markReadout(page)).toHaveCount(0);
    expect(server.state.patches).toHaveLength(0);
});

test('a mark opens by tap and closes by a second tap, an outside tap or a scroll', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: layerRows });
    await install(page, { server, issues: layerStories });
    await openPlanning(page);
    await stripToggle(page).tap(); await expect(table(page)).toBeVisible();
    for (const [key, sentence] of [['acc-ann', ANN_SENTENCE], ['acc-fay', FAY_SENTENCE]]) {
        const mark = markSlot(page, key).locator('button');
        // Second tap on the mark.
        await mark.tap();
        await expect(markReadout(page), key).toHaveText(sentence);
        await expectBoxInViewport(page, markReadout(page));
        await page.waitForTimeout(200);
        await expect(markReadout(page), `${key}: a tap holds it with no hover`).toHaveText(sentence);
        await mark.tap();
        await expect(markReadout(page), key).toHaveCount(0);
        // An outside tap (on the strip title row, which only toggles on its own button).
        await mark.tap();
        await expect(markReadout(page), key).toHaveText(sentence);
        const empty = await rowOf(page, key).locator('td.planning-assignee-note').boundingBox();
        await page.touchscreen.tap(empty.x + empty.width - 4, empty.y + 4);
        await expect(markReadout(page), `${key}: outside tap closes`).toHaveCount(0);
        // A scroll.
        await mark.tap();
        await expect(markReadout(page), key).toHaveText(sentence);
        await page.evaluate(() => window.scrollBy(0, 40));
        await expect(markReadout(page), `${key}: scroll closes`).toHaveCount(0);
        await page.evaluate(() => window.scrollBy(0, -40));
    }
    expect(server.state.patches).toHaveLength(0);
    await context.close();
});

const layerGeometry = page => page.evaluate(() => {
    const probe = document.createElement('i'); document.body.appendChild(probe);
    const resolve = value => { probe.style.background = value; return getComputedStyle(probe).backgroundColor; };
    const track = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
    const wrapper = document.querySelector('[data-assignee-underbar]').getBoundingClientRect();
    const cap = document.querySelector('.planning-panel .capacity-bar-marker.teamcap').getBoundingClientRect();
    const surface = getComputedStyle(document.querySelector('[data-assignee-underbar]')).getPropertyValue('--bg-secondary').trim();
    const segmentsList = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => {
        const box = node.getBoundingClientRect();
        const overlay = node.querySelector(':scope > .stacked-bar-strip-part');
        const value = node.style.getPropertyValue('--stacked-bar-color');
        const raw = /color-mix\(in srgb, (\S+) /.exec(value)?.[1] || value;
        const style = overlay && getComputedStyle(overlay);
        return {
            name: node.getAttribute('aria-label').split(': ')[0].replace(/^Assignee capacity /, ''),
            width: box.width / track.width, left: box.left, right: box.right, height: box.height,
            background: getComputedStyle(node).backgroundColor, backgroundImage: getComputedStyle(node).backgroundImage,
            solid: resolve(`color-mix(in srgb, ${raw} 70%, ${surface})`), tint: resolve(`color-mix(in srgb, ${raw} 28%, ${surface})`),
            overlay: overlay ? { width: overlay.getBoundingClientRect().width / box.width, left: overlay.getBoundingClientRect().left - box.left, height: overlay.getBoundingClientRect().height,
                background: style.backgroundColor, position: style.position, parentIsSegment: overlay.parentElement === node, last: overlay === node.lastElementChild } : null,
        };
    });
    const stripTrack = getComputedStyle(document.querySelector('[data-assignee-underbar] .stacked-bar-track')).backgroundColor;
    const trackColor = getComputedStyle(document.querySelector('.planning-panel-capacity-graph .capacity-bar-track')).backgroundColor;
    probe.remove();
    return { segments: segmentsList, trackLeft: track.left, trackWidth: track.width, wrapperRight: wrapper.right, capRatio: (cap.left + cap.width / 2 - track.left) / track.width, stripTrack, trackColor };
});

// Computed colours come back as rgb() (0-255) or color(srgb ...) (0-1, for color-mix); compare both on 0-255.
const rgb = text => (text.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(channel => (text.startsWith('color(') ? channel * 255 : channel));
const colourDistance = (a, b) => { const [x, y] = [rgb(a), rgb(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

for (const mode of ['compact', 'expanded']) test(`person segments draw solid effort first, then tinted free capacity or striped effort beyond capacity (${mode} panel)`, async ({ page }) => {
    const server = capacityServer({ rows: layerRows });
    await install(page, { server, capacityProject: 'CAP', issues: layerStories });
    await openPlanning(page);
    await expand(page);
    // The overview starts compact with the graphs hidden; both modes open the details with the visible button.
    if (mode === 'compact') await expect(page.locator('#planning-panel-details')).toBeHidden();
    await showCapacityDetails(page); await page.evaluate(() => document.activeElement?.blur()); await expect(page.locator('.planning-panel .capacity-bar-marker-label').first()).toBeVisible();
    await expect(segments(page)).toHaveCount(6);
    const g = await layerGeometry(page);
    const by = Object.fromEntries(g.segments.map(segment => [segment.name, segment]));
    // Table order, Unassigned trailing; Cy (neither number) has no segment.
    expect(g.segments.map(segment => segment.name)).toEqual(['Ann Synthetic', 'Bob Synthetic', 'Eve Synthetic', 'Fay Synthetic', 'Zoe Capacity Only', 'Unassigned (effort)']);
    for (const segment of g.segments) { expect(segment.height, segment.name).toBe(5); if (segment.overlay) expect(segment.overlay.height, segment.name).toBe(5); }
    // Widths are max(capacity, effort) on the 29.9 axis; the strip ends at 26/29.9, inside the wrapper, past the Team Cap.
    for (const [name, sp] of [['Ann Synthetic', 5], ['Bob Synthetic', 5], ['Eve Synthetic', 4], ['Fay Synthetic', 3], ['Zoe Capacity Only', 5], ['Unassigned (effort)', 4]]) expect(by[name].width, name).toBeCloseTo(sp / 29.9, 2);
    const stripEnd = g.segments.at(-1).right;
    expect((stripEnd - g.trackLeft) / g.trackWidth).toBeCloseTo(26 / 29.9, 2);
    expect(stripEnd, 'not clipped').toBeLessThan(g.wrapperRight - 1);
    expect(g.capRatio, 'Team Cap on the shared axis').toBeCloseTo(20 / 29.9, 2);
    // Eve under capacity: tinted capacity (4) at the bottom, solid effort (2) on top from the left; the tinted rest is capacity left.
    expect(by['Eve Synthetic'].background).toBe(by['Eve Synthetic'].tint);
    expect(by['Eve Synthetic'].overlay).toMatchObject({ background: by['Eve Synthetic'].solid, position: 'absolute', parentIsSegment: true, last: true, left: 0 });
    expect(by['Eve Synthetic'].overlay.width).toBeCloseTo(2 / 4, 2);
    // Ann over (effort 5, capacity 3) and Fay over (effort 3, capacity 2.5): striped effort at the bottom, solid effort up to
    // capacity on top from the left, so the striped rest is the excess: the order is always solid first.
    for (const [name, ratio] of [['Ann Synthetic', 3 / 5], ['Fay Synthetic', 2.5 / 3]]) {
        expect(by[name].backgroundImage, name).toContain('repeating-linear-gradient(135deg');
        expect(by[name].overlay, name).toMatchObject({ background: by[name].solid, position: 'absolute', parentIsSegment: true, last: true, left: 0 });
        expect(by[name].overlay.width, name).toBeCloseTo(ratio, 2);
    }
    // Zoe capacity only: purely tinted; Bob effort only: purely solid; Unassigned: one solid --warn segment.
    expect(by['Zoe Capacity Only'].background).toBe(by['Zoe Capacity Only'].tint);
    expect(by['Zoe Capacity Only'].overlay).toBeNull();
    expect(by['Bob Synthetic'].background).toBe(by['Bob Synthetic'].solid);
    expect(by['Bob Synthetic'].overlay).toBeNull();
    expect(by['Unassigned (effort)'].overlay).toBeNull();
    expect(by['Unassigned (effort)'].background).toBe(by['Unassigned (effort)'].solid);
    // The tint is distinguishable from the empty track and from the solid layer.
    for (const name of ['Eve Synthetic', 'Zoe Capacity Only']) {
        expect(colourDistance(by[name].tint, g.trackColor), `${name} tint vs track`).toBeGreaterThan(40);
        expect(colourDistance(by[name].tint, by[name].solid), `${name} tint vs solid ${JSON.stringify([by[name].tint, by[name].solid, by[name].background])}`).toBeGreaterThan(40);
    }
    // Rows: every person with a segment is tinted, Cy (no segment) is not.
    for (const key of ['acc-ann', 'acc-bob', 'acc-eve', 'acc-fay', 'acc-zoe']) await expect(rowOf(page, key), key).toHaveClass(/planning-assignee-tinted/);
    await expect(rowOf(page, 'acc-cy')).not.toHaveClass(/planning-assignee-tinted/);
    // Whole-track hover resolves one segment per person, at the top of the track and on the strip pixels of either layer.
    const track = await page.locator('.planning-panel-capacity-graph .capacity-bar-track').boundingBox();
    for (const [name, lines] of [
        ['Ann Synthetic', ['5 SP effort · 3 SP capacity', '2 SP over capacity']],
        ['Eve Synthetic', ['2 SP effort · 4 SP capacity', '2 SP capacity left']],
        ['Fay Synthetic', ['3 SP effort · 2.5 SP capacity', '0.5 SP over capacity']],
        ['Zoe Capacity Only', ['0 SP effort · 5 SP capacity', '5 SP capacity left']],
        ['Bob Synthetic', ['5 SP effort']],
    ]) {
        const segment = by[name];
        for (const [x, y] of [[segment.left + 2, track.y + 2], [segment.right - 2, track.y + track.height - 2]]) {
            await page.mouse.move(5, 400);
            await page.mouse.move(x, y);
            await expect(readout(page)).toContainText(name);
            for (const line of lines) await expect(readout(page), `${name}: ${line}`).toContainText(line);
            await expectReadoutInViewport(page);
        }
    }
    await expect(readout(page)).not.toContainText('Planned capacity');
    await expect(readout(page)).not.toContainText('capacity left');
    await page.mouse.move(5, 400);
    await page.mouse.move(by['Unassigned (effort)'].left + 3, track.y + 3);
    await expect(readout(page)).toContainText('Unassigned (effort)');
    await expect(readout(page)).toContainText('4 SP effort');
    await expect(readout(page)).toContainText('21% of selected');
    await page.mouse.move(5, 400);
});

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`two-level segments keep the 5px strip, the compact panel and the pinned stack inside DoD 14 at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = capacityServer({ rows: layerRows, holdGet: true });
    await install(page, { server, capacityProject: 'CAP', issues: layerStories });
    await openPlanning(page);
    await expect.poll(() => server.state.gets).toBe(1);
    const withoutBar = (await page.locator('.planning-panel').boundingBox()).height;
    server.state.release();
    await expand(page);
    await expect(segments(page)).toHaveCount(6);
    const panel = await page.locator('.planning-panel').boundingBox();
    expect(panel.height).toBeLessThan(64);
    expect(panel.height).toBeCloseTo(withoutBar, 0);
    expect((await page.locator('.planning-review-sticky-stack').boundingBox()).height).toBeLessThanOrEqual(175);
    // The compact overview hides the graphs (2026-11-06): the strip and the marker are checked in the details.
    await showCapacityDetails(page);
    await page.evaluate(() => document.activeElement?.blur());
    expect((await underbar(page).locator('.stacked-bar-track').boundingBox()).height).toBe(5);
    // The marker still wins over the strip at its x, and the longest readout (6 lines, first segment at the left edge) fits.
    const markerLine = await page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-line').boundingBox();
    const track = await page.locator('.planning-panel-capacity-graph .capacity-bar-track').boundingBox();
    const hit = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.capacity-bar-marker.teamcap')), { x: markerLine.x + markerLine.width / 2, y: track.y + track.height - 2 });
    expect(hit).toBe(true);
    await page.mouse.move(track.x + 2, track.y + 2);
    await expect(readout(page)).toContainText('2 SP over capacity');
    await expectReadoutInViewport(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.mouse.move(5, 5);
    const pinned = await page.locator('.planning-panel-capacity-graph .capacity-bar-track').boundingBox();
    await page.mouse.move(pinned.x + 2, pinned.y + 2);
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expectReadoutInViewport(page);
});

test('zoomed settled screenshots of the two-level segments: over, effort only, under, boundary, capacity only and Unassigned', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
    const page = await context.newPage();
    const server = capacityServer({ rows: layerRows });
    await install(page, { server, capacityProject: 'CAP', issues: layerStories });
    await openPlanning(page);
    // The compact overview hides the graphs (2026-11-06): open the details with the visible button first.
    await showCapacityDetails(page);
    await expect(segments(page)).toHaveCount(6);
    await page.mouse.move(5, 400);
    const track = await page.locator('.planning-panel-capacity-graph .capacity-bar-track').boundingBox();
    await page.screenshot({ path: 'tmp/slice10-shots/strip-layers-track.png', clip: { x: track.x - 4, y: track.y - 4, width: track.width + 8, height: track.height + 8 }, animations: 'disabled' });
    const list = await segments(page).evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { name: node.getAttribute('aria-label').split(':')[0].replace(/^Assignee capacity /, '').split(' ')[0].toLowerCase(), x: r.left, y: r.top, width: r.width, height: r.height }; }));
    for (const segment of list) {
        await page.screenshot({ path: `tmp/slice10-shots/segment-${segment.name}.png`, clip: { x: segment.x - 2, y: segment.y - 6, width: segment.width + 4, height: segment.height + 8 }, animations: 'disabled' });
    }
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice10-shots/pinned-panel-layers.png', animations: 'disabled' });
    await stripToggle(page).click(); await expect(table(page)).toBeVisible();
    await page.mouse.move(5, 400);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/slice10-shots/strip-table-marks.png', animations: 'disabled' });
    for (const key of ['acc-ann', 'acc-fay']) {
        await page.mouse.move(5, 400);
        await expect(markReadout(page)).toHaveCount(0);
        await markSlot(page, key).locator('button').hover();
        await expect(markReadout(page)).toBeVisible();
        const row = await rowOf(page, key).boundingBox();
        const readoutBox = await markReadout(page).boundingBox();
        await page.screenshot({ path: `tmp/slice10-shots/mark-readout-${key.slice(4)}.png`, clip: { x: row.x, y: row.y - 4, width: Math.max(420, readoutBox.x + readoutBox.width - row.x + 8), height: readoutBox.y + readoutBox.height - row.y + 12 }, animations: 'disabled' });
    }
    await context.close();
});

// A mark icon's painted ink (pixels near its token colour) inside its 24px hover frame. The icons are inline SVG (no
// emoji font), so their placement is the same in every engine and this runs headless too.
const INK = { over: '(r, g, b) => r - Math.max(g, b) > 90', 'on-plan': '(r, g, b) => g - Math.max(r, b) > 60' };
async function markInk(page, frame, kind) {
    const x0 = Math.floor(frame.x), y0 = Math.floor(frame.y), width = Math.ceil(frame.x + frame.w) - x0, height = Math.ceil(frame.y + frame.h) - y0;
    const image = await page.screenshot({ clip: { x: x0, y: y0, width, height }, animations: 'disabled' });
    return page.evaluate(async ({ base64, x0: originX, y0: originY, frame: box, width: clipWidth, test: source }) => {
        const isInk = new Function(`return ${source}`)();
        const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
        const scale = img.width / clipWidth, canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
        const data = context.getImageData(0, 0, img.width, img.height).data;
        let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0, ground = null;
        for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) {
            const o = (y * img.width + x) * 4, [r, g, b] = [data[o], data[o + 1], data[o + 2]];
            if (isInk(r, g, b)) { count += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            if (x === Math.round(img.width / 2) && y === Math.round(2 * scale)) ground = [r, g, b];
        }
        return { count, scale, frameTop: ground, dx: originX + ((minX + maxX + 1) / 2) / scale - (box.x + box.w / 2), dy: originY + ((minY + maxY + 1) / 2) / scale - (box.y + box.h / 2),
            inkWidth: (maxX - minX + 1) / scale, inkHeight: (maxY - minY + 1) / scale };
    }, { base64: image.toString('base64'), x0, y0, frame, width, test: INK[kind] });
}

for (const scale of [1, 2]) test.describe(`mark icon ink at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale });
    test(`both mark icons are centred in their hover frame at rest, on hover and on focus at ${scale}x; hover paints a circle without moving them`, async ({ page, browserName }) => {
        const server = capacityServer({ rows: layerRows });
        await install(page, { server, issues: layerStories });
        await openPlanning(page);
        await expand(page);
        for (const [key, kind] of [['acc-ann', 'over'], ['acc-fay', 'on-plan']]) {
            const mark = markSlot(page, key).locator('button');
            const frameOf = () => mark.evaluate(node => { const b = node.getBoundingClientRect(); return { x: b.x - 5, y: b.y - 5, w: 24, h: 24 }; });
            const results = {};
            for (const state of ['rest', 'hover', 'focus']) {
                await page.mouse.move(5, 400);
                if (state === 'hover') await mark.hover();
                if (state === 'focus') { const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'; await mark.focus(); await page.keyboard.press(`Shift+${tab}`); await page.keyboard.press(tab); await expect(mark).toBeFocused(); }
                await page.waitForTimeout(150);
                const frame = await frameOf();
                const ink = await markInk(page, frame, kind);
                results[state] = { ...ink, box: await mark.boundingBox() };
                const label = `${kind} ${state} ${scale}x`;
                expect(ink.scale, label).toBe(scale);
                expect(ink.count, `${label}: the icon paints`).toBeGreaterThan(20 * scale * scale);
                // Ink centre within a device pixel of the frame centre (half a CSS pixel at 2x).
                expect(Math.abs(ink.dx), `${label} horizontal offset`).toBeLessThanOrEqual(1 / scale + 0.01);
                expect(Math.abs(ink.dy), `${label} vertical offset`).toBeLessThanOrEqual(1 / scale + 0.01);
                // The double exclamation is narrower than the rounded square (bars at 6-18 of 24 units, about 7px).
                expect(ink.inkWidth, label).toBeGreaterThan(kind === 'over' ? 6 : 10); expect(ink.inkWidth, label).toBeLessThanOrEqual(14);
                expect(ink.inkHeight, label).toBeGreaterThan(10); expect(ink.inkHeight, label).toBeLessThanOrEqual(14);
                await page.screenshot({ path: `tmp/slice10-shots/mark-${kind}-${state}-${scale}x.png`, clip: { x: frame.x - 4, y: frame.y - 4, width: frame.w + 8, height: frame.h + 8 }, animations: 'disabled' });
                await page.keyboard.press('Escape');
                await mark.blur();
            }
            // Hover changes paint only: same box, no transform, and the circle shows at the frame's top centre.
            expect(results.hover.box, kind).toEqual(results.rest.box);
            expect(results.hover.frameTop, kind).not.toEqual(results.rest.frameTop);
            expect(await mark.evaluate(node => getComputedStyle(node).transform), kind).toBe('none');
            // A deliberate 3px shift fails the same tolerance.
            await mark.evaluate(node => { node.querySelector('svg').style.transform = 'translateX(3px)'; });
            expect(Math.abs((await markInk(page, await frameOf(), kind)).dx), kind).toBeGreaterThan(1);
            await mark.evaluate(node => { node.querySelector('svg').style.transform = ''; });
        }
    });
});

// ---- Epics/Stories follow the strip (#323 operator review) ------------------------------------------------------
// Epics selected -> strip collapsed; expanding the strip from its header -> Stories selected. A chosen Epics (a click,
// a link's rows) collapses an open strip; the Epics default a table mount starts with yields to an open strip.

// Opened links carry a query, which the shared fixture's `/` route never matches.
const linkHtml = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'jira-dashboard.html'), 'utf8');
const rowsControl = page => page.getByRole('radiogroup', { name: 'Planning review rows' });
const rowsButton = (page, name) => rowsControl(page).getByRole('radio', { name, exact: true });
const reviewRowKinds = page => page.locator('.planning-review-table:not(.planning-review-docked-table) tbody tr[data-row-kind]').evaluateAll(rows => [...new Set(rows.map(row => row.dataset.rowKind))]);
const rowModeEvents = page => page.evaluate(() => (window.dataLayer || []).filter(entry => JSON.stringify(entry).includes('row_mode')).length);
const storedExpansion = page => page.evaluate(key => localStorage.getItem(key), 'jira_dashboard_planning_assignee_capacity_v1');
// Counts every switch to Stories and every collapse of the strip from now on, so a settled check sees any ping-pong.
async function countFlips(page) {
    await page.evaluate(() => {
        const counts = { stories: 0, epics: 0, collapses: 0, expansions: 0 };
        window.__rowFlips = counts;
        const watch = () => {
            const stories = document.querySelector('[aria-label="Planning review rows"] [role="radio"]:nth-child(2)');
            const panel = document.querySelector('[data-assignee-capacity]');
            return { stories: stories?.getAttribute('aria-checked') === 'true', collapsed: Boolean(panel?.classList.contains('capacity-panel-collapsed')) };
        };
        let last = watch();
        new MutationObserver(() => {
            const now = watch();
            if (now.stories !== last.stories) counts[now.stories ? 'stories' : 'epics'] += 1;
            if (now.collapsed !== last.collapsed) counts[now.collapsed ? 'collapses' : 'expansions'] += 1;
            last = now;
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-checked', 'class'], childList: true });
    });
}
const flips = async page => { await page.waitForTimeout(300); return page.evaluate(() => ({ ...window.__rowFlips })); };
const nonWriteCalls = (calls, since) => calls.slice(since).filter(call => call.method === 'GET').map(call => call.pathname);

test('expanding the strip with Epics active selects Stories once, through the quiet path: no event, no read, focus and selection kept', async ({ page, browserName }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server, analytics: true });
    await openPlanning(page);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['epic']);
    await expect.poll(() => server.state.gets).toBe(1);
    await page.waitForTimeout(400);
    const selectedBefore = await page.locator('.planning-panel').textContent();
    const since = calls.length;
    await countFlips(page);
    await expand(page);
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['story']);
    expect(await flips(page)).toEqual({ stories: 1, epics: 0, collapses: 0, expansions: 1 });
    // The switch moves no focus: the toggle keeps it (WebKit does not focus a clicked button, so nothing is focused there).
    if (browserName === 'webkit') expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    else await expect(stripToggle(page)).toBeFocused();
    expect(await rowModeEvents(page), 'the automatic switch emits no analytics event').toBe(0);
    expect(nonWriteCalls(calls, since), 'expansion and the automatic switch read nothing').toEqual([]);
    expect(server.state.gets).toBe(1);
    // Selection: every Story stays checked, and the overview reads the same.
    for (const key of ['PLAN-1', 'PLAN-2', 'PLAN-3', 'PLAN-4']) await expect(page.getByRole('checkbox', { name: `Select ${key}`, exact: true }).first()).toBeChecked();
    expect(await page.locator('.planning-panel').textContent()).toBe(selectedBefore);
    // The Filters row with Stories active, settled.
    await page.mouse.move(5, 5);
    // The controls join the Filters row's view-controls slot (display: contents), so capture the row that holds the slot.
    await page.locator('.fb-view-controls').locator('xpath=..').screenshot({ path: 'tmp/slice12-shots/filters-row-stories-after-expand.png', animations: 'disabled' });
    // Collapsing does not switch back; with Stories active a re-expansion changes nothing.
    await stripToggle(page).click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await stripToggle(page).click();
    await expect(table(page)).toBeVisible();
    expect(await flips(page)).toEqual({ stories: 1, epics: 0, collapses: 1, expansions: 2 });
    expect(await rowModeEvents(page)).toBe(0);
    expect(nonWriteCalls(calls, since)).toEqual([]);
});

test('switching to Epics while the strip is open collapses it to its 28px header once; expanding selects Stories again; no ping-pong', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server, analytics: true });
    await openPlanning(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await expand(page);
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(300);
    const since = calls.length;
    await countFlips(page);
    for (let round = 1; round <= 2; round += 1) {
        await rowsButton(page, 'Epics').click();
        await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
        await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
        expect((await strip(page).boundingBox()).height).toBeCloseTo(28, 1);
        await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
        await expect.poll(() => reviewRowKinds(page)).toEqual(['epic']);
        await expect.poll(() => storedExpansion(page)).toBe('{"expanded":false}');
        expect(await flips(page), `round ${round}: one switch to Epics, one collapse`).toEqual({ stories: round - 1, epics: round, collapses: round, expansions: round - 1 });
        expect(await rowModeEvents(page), 'only the clicks are tracked').toBe(round);
        await expand(page);
        await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
        expect(await flips(page), `round ${round}: one expansion, one switch to Stories`).toEqual({ stories: round, epics: round, collapses: round, expansions: round });
        expect(await rowModeEvents(page)).toBe(round);
    }
    // While Epics is active the strip stays collapsed until the user expands it.
    await rowsButton(page, 'Epics').click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await page.waitForTimeout(400);
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    expect(nonWriteCalls(calls, since), 'collapse, expansion and the switches read nothing').toEqual([]);
    expect(server.state.gets).toBe(1);
});

test('an open strip cell edit commits before the collapse that a switch to Epics causes', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('9');
    await expect(capacity).toBeFocused();
    await rowsButton(page, 'Epics').click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body.changes).toEqual([{ assigneeKey: 'acc-ann', capacity: '9' }]);
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Saved');
    await expand(page);
    await expect(capacity).toHaveValue('9');
});

test('a dirty review draft survives both directions: the switch to Stories is not skipped and the collapse loses nothing', async ({ page }) => {
    const server = capacityServer();
    await install(page, { server });
    await openPlanning(page);
    await page.getByRole('button', { name: '+ Add column', exact: true }).click();
    await page.getByLabel('Column name', { exact: true }).fill('Synthetic review');
    await page.getByRole('button', { name: 'Add column', exact: true }).click();
    const cell = page.getByRole('textbox', { name: 'Synthetic review for PLAN-EPIC', exact: true });
    await cell.fill('7'); await cell.press('Enter');
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
    await expand(page);
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.planning-review-dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
    await rowsButton(page, 'Epics').click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect(cell).toHaveValue('7');
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
});

test('mount: a saved expanded strip and the table\'s Epics default select Stories once; a link\'s Stories keeps both; a link\'s Epics collapses the strip', async ({ page }) => {
    const server = capacityServer();
    await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('jira_dashboard_planning_assignee_capacity_v1', '{"expanded":true}'); } });
    const { calls } = await install(page, { server, analytics: true });
    await page.route(url => url.href.startsWith(`${appBaseUrl}/?v=1&`), route => route.fulfill({ status: 200, contentType: 'text/html', body: linkHtml }));
    await openPlanning(page);
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['story']);
    expect(await rowModeEvents(page)).toBe(0);
    // A Sprint switch remounts the table in its Epics default: the open strip keeps it on Stories, with no extra read.
    await countFlips(page);
    await switchSprint(page, activeSprintName);
    await switchSprint(page, futureSprintName);
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'true');
    expect((await flips(page)).collapses).toBe(0);
    expect(await rowModeEvents(page)).toBe(0);
    // A link with Stories rows: both kept.
    await page.goto(`${appBaseUrl}/?v=1&mode=planning&group=group-alpha&sprint=${futureSprintId}&teams=team-alpha&rows=stories`);
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(400);
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    // A link with the Epics rows: the link's rows win and the strip collapses, persisted.
    await page.goto(`${appBaseUrl}/?v=1&mode=planning&group=group-alpha&sprint=${futureSprintId}&teams=team-alpha`);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(400);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await storedExpansion(page)).toBe('{"expanded":false}');
    expect(calls.filter(call => call.method !== 'GET' && call.pathname.endsWith('/assignee-capacity'))).toEqual([]);
});

test('two Teams and All Teams: no strip, the rows stay Epics and the saved expansion is untouched', async ({ page }) => {
    for (const selectedTeams of [['team-alpha', 'team-beta'], ['all']]) {
        const server = capacityServer();
        await page.addInitScript(() => localStorage.setItem('jira_dashboard_planning_assignee_capacity_v1', '{"expanded":true}'));
        await install(page, { server, selectedTeams });
        await openPlanning(page);
        await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
        await expect(strip(page)).toHaveCount(0);
        await page.waitForTimeout(300);
        await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
        await rowsButton(page, 'Stories').click();
        await rowsButton(page, 'Epics').click();
        expect(await storedExpansion(page)).toBe('{"expanded":true}');
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

test('the pinned stack stays inside DoD 14 after the automatic switch and collapse at 1440x900 and 1280x720', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
        await install(page, { server });
        await openPlanning(page);
        const before = await pinnedHeights(page);
        await expand(page);
        await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
        await rowsButton(page, 'Epics').click();
        await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
        const after = await pinnedHeights(page);
        for (const [label, heights] of [['before', before], ['after', after]]) {
            expect(heights.panel, `${label} ${viewport.width}`).toBeLessThan(64);
            expect(heights.stack, `${label} ${viewport.width}`).toBeLessThanOrEqual(175);
        }
        expect(after.stack, 'the round trip leaves the pinned stack as it was').toBeCloseTo(before.stack, 1);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

// ---- operator review: Totals Planned capacity out of team capacity (#323) -----------------------------------------

const totalsCapacity = page => table(page).locator('tfoot td').nth(1);
const totalsReadout = page => page.locator('.epic-full-value-readout');
const peopleRows = (ann, cy) => [
    { assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: ann, vacations: '1', notes: 'away Friday', removed: false },
    { assigneeKey: 'acc-cy', displayName: 'Cy Former', capacity: cy, vacations: null, notes: null, removed: false },
];
const jiraTeam = value => sprint => ({ enabled: true, mutationEnabled: false, sprint, capacities: { 'Alpha Team': value }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: value }] });
const OVER_SENTENCE = "People's planned capacity 23 SP exceeds team capacity 20 SP by 3 SP";
// Every column's edges (head, foot) and the Totals Planned capacity text's painted box against its cell's content box.
const totalsGeometry = page => page.evaluate(() => {
    const tableNode = document.querySelector('[data-assignee-capacity] table.planning-assignee-table');
    const edges = selector => [...tableNode.querySelectorAll(selector)].map(node => { const b = node.getBoundingClientRect(); return [Math.round(b.left * 100) / 100, Math.round(b.right * 100) / 100]; });
    const cell = tableNode.querySelectorAll('tfoot td')[1];
    const style = getComputedStyle(cell), box = cell.getBoundingClientRect();
    // Painted text: the line boxes of the cell's text nodes only (the trigger's padded box is left out).
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const lines = new Set(), text = { left: Infinity, right: -Infinity };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const nodeRange = document.createRange(); nodeRange.selectNodeContents(node);
        [...nodeRange.getClientRects()].filter(rect => rect.width > 0).forEach(rect => { lines.add(Math.round(rect.top)); text.left = Math.min(text.left, rect.left); text.right = Math.max(text.right, rect.right); });
    }
    const trigger = cell.querySelector('button');
    return {
        head: edges('thead th'), foot: edges('tfoot td'),
        contentLeft: box.left + parseFloat(style.paddingLeft), contentRight: box.right - parseFloat(style.paddingRight),
        textLeft: text.left, textRight: text.right, lines: lines.size,
        cellOverflow: cell.scrollWidth - cell.clientWidth, triggerOverflow: trigger ? trigger.scrollWidth - trigger.clientWidth : 0,
        footHeight: tableNode.querySelector('tfoot tr').getBoundingClientRect().height,
    };
});

for (const [label, options, expected] of [
    ['a Jira ticket value', { capacity: defaultCapacity, capacityProject: 'CAP' }, '11 / 20'],
    ['no ticket and no stored number', { capacity: noTicket, capacityProject: 'CAP', authMode: 'atlassian_oauth' }, '11'],
]) test(`Totals Planned capacity with ${label} reads ${expected}, with no cue at or below the team number`, async ({ page }) => {
    const server = capacityServer({ rows: peopleRows('8', '3') });
    await install(page, { server, ...options });
    await openPlanning(page);
    await expand(page);
    await expect(totalsCapacity(page)).toHaveText(expected);
    await expect(totalsCapacity(page)).not.toHaveClass(/planning-assignee-over/);
    await expect(totalsCapacity(page).locator('button')).toHaveCount(0);
    await expect(totalsCapacity(page).locator('[title]')).toHaveCount(0);
    // The Planned effort cue is unchanged.
    await expect(table(page).locator('tfoot td').nth(2)).toHaveText('14 (over capacity)');
});

test('Totals Planned capacity with the stored team number and no ticket reads X / stored', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: { revision: 1, rows: peopleRows('8', '3'), planned: { value: '14', source: 'user' } } } });
    await install(page, { server, capacityProject: 'CAP', capacity: noTicket, authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await expand(page);
    await expect(totalsCapacity(page)).toHaveText('11 / 14');
    await expect(totalsCapacity(page)).not.toHaveClass(/planning-assignee-over/);
});

test('Totals Planned capacity equal to the team number shows no cue', async ({ page }) => {
    const server = capacityServer({ rows: peopleRows('12.5', '7.5') });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(totalsCapacity(page)).toHaveText('20 / 20');
    await expect(totalsCapacity(page)).not.toHaveClass(/planning-assignee-over/);
    await expect(totalsCapacity(page).locator('button')).toHaveCount(0);
});

test('Totals Planned capacity above the team number: over tone and a transient in-app readout on hover and keyboard focus that writes nothing', async ({ page, browserName }) => {
    const server = capacityServer({ rows: peopleRows('15', '8') });
    const { calls } = await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    const since = calls.length, patchesBefore = server.state.patches.length;
    const cell = totalsCapacity(page), trigger = cell.locator('button');
    await expect(cell).toHaveText('23 / 20');
    await expect(cell).toHaveClass(/planning-review-storyPoints planning-assignee-over/);
    await expect(trigger).toHaveClass('planning-review-text-button');
    await expect(trigger).toHaveAttribute('aria-label', OVER_SENTENCE);
    expect(await cell.evaluate(node => [node, ...node.querySelectorAll('*')].some(item => item.hasAttribute('title')))).toBe(false);
    // The tone is the over cue's (planning-assignee-over, #b91c1c at 600), painted by the trigger's text too.
    const tone = await cell.evaluate(node => [node, node.querySelector('button')].map(item => { const s = getComputedStyle(item); return `${s.color}|${s.fontWeight}`; }));
    expect(tone).toEqual(['rgb(185, 28, 28)|600', 'rgb(185, 28, 28)|600']);
    // Hover shows, leave hides.
    await trigger.hover();
    await expect(totalsReadout(page)).toHaveText(OVER_SENTENCE);
    await expectBoxInViewport(page, totalsReadout(page));
    await page.mouse.move(5, 400);
    await expect(totalsReadout(page)).toHaveCount(0);
    // A mouse click does not pin it and leaves no focus.
    await trigger.click();
    await expect(totalsReadout(page)).toHaveText(OVER_SENTENCE);
    expect(await trigger.evaluate(node => document.activeElement === node)).toBe(false);
    await page.mouse.move(5, 400);
    await page.waitForTimeout(200);
    await expect(totalsReadout(page), 'the click pinned nothing').toHaveCount(0);
    // Keyboard: Tab from the last row's Notes reaches the trigger and shows the readout; blur hides it.
    await rowOf(page, 'acc-cy').getByRole('textbox', { name: 'Notes for Cy Former' }).focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(trigger).toBeFocused();
    await expect(totalsReadout(page)).toHaveText(OVER_SENTENCE);
    await trigger.blur();
    await expect(totalsReadout(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(calls.slice(since).filter(call => call.method !== 'GET'), 'the cue writes nothing').toEqual([]);
    // Editing stays open: a Planned capacity cell still edits and saves.
    const input = rowOf(page, 'acc-cy').getByRole('textbox', { name: 'Capacity for Cy Former' });
    await expect(input).toBeEnabled();
    await input.fill('4'); await input.press('Enter');
    await expect(cell).toHaveText('19 / 20');
    await expect(cell).not.toHaveClass(/planning-assignee-over/);
    await expect.poll(() => server.state.patches.length).toBe(patchesBefore + 1);
});

test('Totals Planned capacity readout opens by tap and closes by an outside tap', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: peopleRows('15', '8') });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await stripToggle(page).tap(); await expect(table(page)).toBeVisible();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    const patchesBefore = server.state.patches.length;
    const trigger = totalsCapacity(page).locator('button');
    await trigger.tap();
    await expect(totalsReadout(page)).toHaveText(OVER_SENTENCE);
    await page.waitForTimeout(200);
    await expect(totalsReadout(page), 'a tap holds it').toHaveText(OVER_SENTENCE);
    const empty = await table(page).locator('tfoot td.planning-assignee-note').boundingBox();
    await page.touchscreen.tap(empty.x + empty.width - 4, empty.y + 4);
    await expect(totalsReadout(page), 'outside tap closes').toHaveCount(0);
    expect(server.state.patches).toHaveLength(patchesBefore);
    await context.close();
});

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`Totals Planned capacity "X / Y" stays on one line inside its cell at ${width}x${height}, columns and pinned stack unchanged`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: width < 768, viewport: { width, height } });
    const page = await context.newPage();
    const measure = async (rows, capacity) => {
        const server = capacityServer({ rows });
        await install(page, { server, capacity, capacityProject: 'CAP', authMode: 'atlassian_oauth' });
        await openPlanning(page);
        const stack = await pinnedHeights(page);
        // The expanded preference persists across the three loads of this page.
        if (await stripToggle(page).getAttribute('aria-expanded') !== 'true') { if (width < 768) await stripToggle(page).tap(); else await stripToggle(page).click(); }
        await expect(table(page)).toBeVisible();
        if (width >= 768) await page.mouse.move(1, 1);
        const geometry = await totalsGeometry(page);
        const text = (await totalsCapacity(page).textContent()).trim();
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        return { text, geometry, stack };
    };
    // Before (no team number: the sum alone, as the row read before) and after: a within case and a long over case.
    const before = await measure(peopleRows('100.25', '23.2'), noTicket);
    const within = await measure(peopleRows('8', '3'), defaultCapacity);
    const over = await measure(peopleRows('100.25', '23.2'), jiraTeam(120.55));
    console.log('SLICE13_TOTALS_GEOMETRY', width, JSON.stringify({ before: before.geometry, over: over.geometry }));
    expect([before.text, within.text, over.text]).toEqual(['123.45', '11 / 20', '123.45 / 120.55']);
    for (const [label, sample] of [['before', before], ['within', within], ['over', over]]) {
        const g = sample.geometry;
        expect(g.lines, `${label}: one line`).toBe(1);
        expect(g.textRight, `${label}: painted text ends inside the cell`).toBeLessThanOrEqual(g.contentRight + 0.5);
        expect(g.textLeft, `${label}: painted text starts inside the cell`).toBeGreaterThanOrEqual(g.contentLeft - 0.5);
        expect(g.cellOverflow, `${label}: cell does not clip`).toBeLessThanOrEqual(0);
        expect(g.triggerOverflow, `${label}: trigger does not clip`).toBeLessThanOrEqual(0);
        expect(g.head, `${label}: column edges as before`).toEqual(before.geometry.head);
        expect(g.foot, `${label}: totals edges as before`).toEqual(before.geometry.foot);
        expect(g.footHeight, `${label}: totals row height as before`).toBe(before.geometry.footHeight);
        if (width >= 1280) { expect(sample.stack.panel).toBeLessThan(64); expect(sample.stack.stack).toBeLessThanOrEqual(175); }
    }
    // The pinned stack does not hold the strip: the same team number leaves it the same, within or over.
    expect(over.stack.stack).toBeCloseTo(within.stack.stack, 1);
    expect(Math.abs(over.geometry.textRight - over.geometry.contentRight), 'right-aligned').toBeLessThanOrEqual(1);
    await context.close();
});

test('zoomed settled screenshots of the Totals row within and over the team number', async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    for (const [name, rows] of [['within', peopleRows('8', '3')], ['over', peopleRows('15', '8')]]) {
        const server = capacityServer({ rows });
        await install(page, { server, capacityProject: 'CAP' });
        await openPlanning(page);
        if (await stripToggle(page).getAttribute('aria-expanded') !== 'true') await expand(page);
        await expect(table(page)).toBeVisible();
        await page.mouse.move(1, 1);
        await page.waitForTimeout(200);
        const row = await table(page).locator('tfoot tr').boundingBox();
        const vacations = await table(page).locator('tfoot td').nth(3).boundingBox();
        const clip = { x: row.x, y: row.y - 40, width: vacations.x + vacations.width - row.x, height: row.height + 40 };
        await page.screenshot({ path: `tmp/slice13-shots/totals-${name}.png`, clip, animations: 'disabled' });
        if (name === 'over') {
            await totalsCapacity(page).locator('button').hover();
            await expect(totalsReadout(page)).toBeVisible();
            await page.waitForTimeout(200);
            await page.screenshot({ path: 'tmp/slice13-shots/totals-over-readout.png', clip: { ...clip, height: clip.height + 60 }, animations: 'disabled' });
        }
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
    await context.close();
});

// The over trigger's text and ink against its ring: `bare` drops the trigger's breathing-room padding and margins (the
// geometry before it), so text position, columns and row height compare in place. Ink comes from canvas text metrics
// in the trigger's own font at its baseline. Clearance is measured from the ring's solid line, not from the faint
// 25%-alpha halo that the hover ring adds 3px deep: the hover ring's solid blue line is 1px inside the button and the
// focus outline is a solid 2px at -2px, so the inner edge used is the deeper of the two, 2px inside the button.
const triggerGeometry = (page, bare) => page.evaluate(isBare => {
    const tableNode = document.querySelector('[data-assignee-capacity] table.planning-assignee-table');
    const button = tableNode.querySelector('tfoot td.planning-assignee-over > button');
    button.style.cssText = isBare ? 'padding:0;margin:0' : '';
    const edges = selector => [...tableNode.querySelectorAll(selector)].map(node => { const b = node.getBoundingClientRect(); return [b.left, b.right]; });
    const range = document.createRange(); range.selectNodeContents(button);
    const text = range.getBoundingClientRect();
    const probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    button.appendChild(probe); const baseline = probe.getBoundingClientRect().bottom; probe.remove();
    const style = getComputedStyle(button);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(button.textContent);
    const ink = { left: text.left - metrics.actualBoundingBoxLeft, right: text.left + metrics.actualBoundingBoxRight, top: baseline - metrics.actualBoundingBoxAscent, bottom: baseline + metrics.actualBoundingBoxDescent };
    const box = button.getBoundingClientRect(), cell = button.parentElement.getBoundingClientRect();
    const ring = { left: box.left + 2, right: box.right - 2, top: box.top + 2, bottom: box.bottom - 2 };
    return {
        textLeft: text.left, textRight: text.right, head: edges('thead th'), foot: edges('tfoot td'),
        rowHeight: tableNode.querySelector('tfoot tr').getBoundingClientRect().height,
        clearance: { left: ink.left - ring.left, right: ring.right - ink.right, top: ink.top - ring.top, bottom: ring.bottom - ink.bottom },
        insideCell: box.left >= cell.left - 0.01 && box.right <= cell.right + 0.01 && box.top >= cell.top - 0.01 && box.bottom <= cell.bottom + 0.01,
    };
}, bare);

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`the Totals over trigger's ring clears the text inside the control at ${width}x${height}, text, row and columns in place`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: width < 768, viewport: { width, height } });
    const page = await context.newPage();
    const server = capacityServer({ rows: peopleRows('100.25', '23.2') });
    await install(page, { server, capacity: jiraTeam(120.55), capacityProject: 'CAP' });
    await openPlanning(page);
    if (width < 768) await stripToggle(page).tap(); else await stripToggle(page).click();
    await expect(totalsCapacity(page)).toHaveText('123.45 / 120.55');
    const bare = await triggerGeometry(page, true);
    const padded = await triggerGeometry(page, false);
    console.log('SLICE13_TRIGGER_GEOMETRY', width, JSON.stringify({ bare, padded }));
    expect(padded.textLeft, 'text x unchanged').toBeCloseTo(bare.textLeft, 2);
    expect(padded.textRight, 'right edge unchanged').toBeCloseTo(bare.textRight, 2);
    expect(padded.rowHeight).toBe(32);
    expect(padded.head).toEqual(bare.head);
    expect(padded.foot).toEqual(bare.foot);
    expect(padded.insideCell, 'the padded button stays inside its cell').toBe(true);
    for (const side of ['left', 'right', 'top', 'bottom']) expect(padded.clearance[side], `the ring's solid line clears the ink by 4px on the ${side}`).toBeGreaterThanOrEqual(4);
    await context.close();
});

test('the Totals over trigger draws its hover and keyboard-focus rings inside the control (zoomed screenshots)', async ({ browser, browserName }) => {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const server = capacityServer({ rows: peopleRows('15', '8') });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    const trigger = totalsCapacity(page).locator('button');
    const box = await totalsCapacity(page).boundingBox();
    const clip = { x: box.x - 8, y: box.y - 4, width: box.width + 16, height: box.height + 8 };
    await trigger.hover();
    await expect(totalsReadout(page)).toBeVisible();
    const hovered = await trigger.evaluate(node => { const s = getComputedStyle(node); return { shadow: s.boxShadow, transform: s.transform, transition: s.transitionProperty }; });
    expect(hovered.shadow).toContain('inset');
    expect(hovered.shadow).not.toMatch(/(^|,\s*)rgb[^)]*\)\s+0px\s+0px\s+0px\s+[13]px(?!.*inset)/);
    expect(hovered.transform).toBe('none');
    expect(hovered.transition).not.toBe('all');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'tmp/slice13-shots/totals-trigger-hover.png', clip, animations: 'disabled' });
    await page.mouse.move(5, 400);
    await expect(totalsReadout(page)).toHaveCount(0);
    await rowOf(page, 'acc-cy').getByRole('textbox', { name: 'Notes for Cy Former' }).focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate(node => { const s = getComputedStyle(node); return [s.outlineStyle, s.outlineWidth, s.outlineOffset]; })).toEqual(['solid', '2px', '-2px']);
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'tmp/slice13-shots/totals-trigger-focus.png', clip, animations: 'disabled' });
    await context.close();
});

// ---- #323 Task 4: stored numbers and cards for every displayed Team ----------------------------------------------

const namedStory = (key, team, teamName, sp) => {
    const base = story(key, 'acc-ann', 'Ann Synthetic', sp, { team });
    return { ...base, fields: { ...base.fields, teamName } };
};
const gammaStories = [...stories, namedStory('PLAN-6', 'team-gamma', 'Gamma Team', 0)];
const teamCard = (page, teamId) => page.locator(`.planning-team-capacity-cards .team-stat-card[data-capacity-team="${teamId}"]`);
const storedOn = async (page, teamId, value) => {
    await expect(teamCard(page, teamId)).toHaveAttribute('data-capacity-source', 'planned');
    await expect(teamCard(page, teamId).locator('.microbar')).toHaveAttribute('aria-label', new RegExp(`against ${value.replace('.', '\\.')} team capacity \\(not in Jira\\)`));
};
const batchReads = (calls, since = 0) => calls.slice(since).filter(call => call.pathname.endsWith('/planned/read'));
const jiraReads = (calls, since = 0) => calls.slice(since).filter(call => call.method === 'GET' && call.pathname === '/api/capacity');
const taskReads = (calls, since = 0) => calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name');

// Stored numbers by Team: the full GET answers its `teamId`, the batch read answers every requested Team.
function numbersServer(planned = {}) {
    const state = { gets: 0, reads: [], patches: [] };
    const docOf = (sprintId, teamId) => (planned[teamId] == null
        ? { teamId, sprintId, revision: 0, rows: [], planned: null, inherited: null, capabilities: caps }
        : { teamId, sprintId, revision: 1, rows: [], planned: { value: planned[teamId], source: 'user' }, inherited: null, capabilities: caps });
    const handler = async route => {
        const request = route.request();
        const url = new URL(request.url());
        const sprintId = decodeURIComponent(url.pathname.split('/')[4]);
        if (request.method() === 'GET') { state.gets += 1; return json(route, docOf(sprintId, url.searchParams.get('teamId'))); }
        state.patches.push(requestBody(request));
        return json(route, { error: 'unexpected_write' }, 500);
    };
    const batch = async route => {
        const request = route.request();
        const sprintId = decodeURIComponent(new URL(request.url()).pathname.split('/')[4]);
        const teamIds = requestBody(request)?.teamIds || [];
        state.reads.push(teamIds);
        return json(route, { sprintId, capabilities: caps, teams: teamIds.map(teamId => { const { revision, planned: value, inherited } = docOf(sprintId, teamId); return { teamId, revision, planned: value, inherited }; }) });
    };
    return { state, handler, batch };
}

for (const selectedTeams of [['team-alpha', 'team-beta'], ['all']]) test(`${selectedTeams.length === 2 ? 'two Teams' : 'All Teams'}: each Team's stored number shows on its card with its own pencil, writing nothing until a save`, async ({ page }) => {
    {
        const server = numbersServer({ 'team-alpha': '14', 'team-beta': '6' });
        const { calls } = await install(page, { server, selectedTeams, capacityProject: 'CAP', capacity: noTicket });
        await openPlanning(page);
        await showCards(page);
        await storedOn(page, 'team-alpha', '14.0');
        await storedOn(page, 'team-beta', '6.0');
        for (const teamId of ['team-alpha', 'team-beta']) {
            await teamCard(page, teamId).hover();
            await expect(teamCard(page, teamId).getByRole('button', { name: /team capacity$/ }), 'each Team has its own stored-number pencil (Task 5)').toBeEnabled();
        }
        expect(server.state.patches, String(selectedTeams)).toEqual([]);
        expect(jiraWrites(calls)).toEqual([]);
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(2);
    }
});

for (const selectedTeams of [['team-alpha', 'team-gamma'], ['all']]) test(`zero-effort Teams get cards (${selectedTeams.length === 2 ? 'selected' : 'All Teams, with Sprint work'}) and show their stored number`, async ({ page }) => {
    {
        const server = numbersServer({ 'team-alpha': '14', 'team-gamma': '5' });
        await install(page, { server, selectedTeams, scopeTeamIds: ['team-alpha', 'team-beta', 'team-gamma'], capacityProject: 'CAP', capacity: noTicket, issues: gammaStories });
        await openPlanning(page);
        await showCards(page);
        await expect(teamCard(page, 'team-gamma'), String(selectedTeams)).toHaveCount(1);
        await storedOn(page, 'team-gamma', '5.0');
        await expect(teamCard(page, 'team-gamma').locator('.microbar-label')).toHaveText('0.0 SP');
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(selectedTeams.length === 2 ? 2 : 3);
    }
});

test('an unresolved Team name gets a card with no stored number and is not sent to the Jira capacity read', async ({ page }) => {
    const server = numbersServer({ 'team-alpha': '14', 'team-raw': '9' });
    const { calls } = await install(page, { server, selectedTeams: ['team-alpha', 'team-raw'], scopeTeamIds: ['team-alpha', 'team-beta', 'team-raw'], capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-alpha', '14.0');
    await expect(teamCard(page, 'team-raw')).toHaveCount(1);
    await expect(teamCard(page, 'team-raw')).not.toHaveAttribute('data-capacity-source', /./);
    await expect(teamCard(page, 'team-raw').locator('.microbar')).not.toHaveAttribute('aria-label', /against/);
    await expect.poll(() => jiraReads(calls).length).toBeGreaterThan(0);
    for (const read of jiraReads(calls)) expect(read.teams.split(',')).not.toContain('team-raw');
});

test('duplicate normalized Team names keep their cards but never offer a stored-number pencil', async ({ page }) => {
    const teamIds = ['team-alpha', 'team-duplicate', 'team-beta'];
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-duplicate': '6', 'team-beta': '0' } });
    const issues = [namedStory('PLAN-1', 'team-alpha', 'Alpha', 3),
        namedStory('PLAN-2', 'team-duplicate', 'Product - Alpha', 2), namedStory('PLAN-3', 'team-beta', 'Beta', 0)];
    const { calls } = await install(page, { server, selectedTeams: teamIds, scopeTeamIds: teamIds,
        issues, epics: [], capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-beta', '0.0');
    await teamCard(page, 'team-beta').hover();
    await expect(teamPencil(page, 'team-beta', 'Beta'), 'the batch save right is known and a valid Team remains editable').toBeEnabled();
    await teamCard(page, 'team-alpha').hover();
    const capturePhase = await teamPencil(page, 'team-alpha', 'Alpha').count() ? 'before' : 'after';
    await page.locator('.planning-team-capacity-cards').screenshot({ path: `tmp/capacity-review/duplicate-${capturePhase}.png`, animations: 'disabled' });
    for (const [teamId, name] of [['team-alpha', 'Alpha'], ['team-duplicate', 'Product - Alpha']]) {
        await expect(teamCard(page, teamId)).toBeVisible();
        await expect(teamCard(page, teamId).locator('.team-stat-label')).toHaveText(name);
        await expect(teamCard(page, teamId)).not.toHaveAttribute('data-capacity-source', /./);
        await expect(teamCard(page, teamId).locator('.microbar')).not.toHaveAttribute('aria-label', /against/);
        await teamCard(page, teamId).hover();
        await expect(teamPencil(page, teamId, name)).toHaveCount(0);
    }
    await typeTeamNumber(page, 'team-beta', 'Beta', '5');
    await storedOn(page, 'team-beta', '5.0');
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches.map(patch => patch.body.teamId), 'the valid Team saves only itself').toEqual(['team-beta']);
    expect(jiraWrites(calls)).toEqual([]);
});

test('request ledger: an All Teams startup has no per-Team fan-out: one batch read, no document GET, one Jira capacity read', async ({ page }) => {
    const startup = numbersServer({ 'team-alpha': '14' });
    const first = await install(page, { server: startup, selectedTeams: ['all'], scopeTeamIds: ['team-alpha', 'team-beta', 'team-gamma'], capacityProject: 'CAP', capacity: noTicket, issues: gammaStories });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-alpha', '14.0');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(startup.state.gets, 'no per-Team document read').toBe(0);
    expect(startup.state.reads.map(ids => [...ids].sort()), 'the zero-effort Gamma joins the one batch read').toEqual([['team-alpha', 'team-beta', 'team-gamma']]);
    expect(jiraReads(first.calls).map(call => call.teams), 'one Jira capacity read').toEqual(['Alpha Team,Beta Team,Gamma Team']);
});

test('request ledger: one Jira capacity read per settled scope and page-session data reused from one to two to All Teams', async ({ page }) => {
    // One Team, then two, then All Teams (which adds the zero-effort Gamma): one read of each kind per scope, no reload.
    const server = numbersServer({ 'team-alpha': '14', 'team-beta': '6', 'team-gamma': '5' });
    const { calls } = await install(page, { server, selectedTeams: ['team-alpha'], scopeTeamIds: ['team-alpha', 'team-beta', 'team-gamma'], capacityProject: 'CAP', capacity: noTicket, issues: gammaStories });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-alpha', '14.0');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(server.state.gets, 'one Team: the full document GET').toBe(1);
    expect(server.state.reads, 'one Team derives from the full GET').toEqual([]);
    expect(jiraReads(calls).map(call => call.teams)).toEqual(['Alpha Team']);
    const tasksAtStart = taskReads(calls).length;
    let since = calls.length;
    await pickTeam(page, 'Beta Team');
    await storedOn(page, 'team-beta', '6.0');
    await storedOn(page, 'team-alpha', '14.0');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(batchReads(calls, since).map(call => [...call.body.teamIds].sort()), 'two Teams: one batch read').toEqual([['team-alpha', 'team-beta']]);
    expect(jiraReads(calls, since).map(call => call.teams), 'two Teams: one Jira read').toEqual(['Alpha Team,Beta Team']);
    since = calls.length;
    await pickTeam(page, 'All Teams');
    await storedOn(page, 'team-gamma', '5.0');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(batchReads(calls, since).map(call => [...call.body.teamIds].sort()), 'All Teams: one batch read').toEqual([['team-alpha', 'team-beta', 'team-gamma']]);
    expect(jiraReads(calls, since).map(call => call.teams), 'All Teams: one Jira read').toEqual(['Alpha Team,Beta Team,Gamma Team']);
    expect(server.state.gets, 'no further document GET while widening').toBe(1);
    expect(taskReads(calls).length, 'widening re-reads no Stories').toBe(tasksAtStart);
    expect(server.state.patches).toEqual([]);
    expect(jiraWrites(calls)).toEqual([]);
});

// G1: twelve Teams (nine pointed, three with zero-point Sprint work). Settled card screenshots and the pinned stack.
const twelveTeamIds = Array.from({ length: 12 }, (_, index) => `team-${String(index + 1).padStart(2, '0')}`);
const twelveStories = twelveTeamIds.map((teamId, index) => namedStory(`PLAN-${index + 1}`, teamId, `Synthetic Team ${String(index + 1).padStart(2, '0')}`, index < 9 ? index + 1 : 0));
const twelveCapacity = sprint => ({ enabled: true, mutationEnabled: false, sprint,
    capacities: Object.fromEntries(twelveTeamIds.slice(0, 6).map((teamId, index) => [`Synthetic Team ${String(index + 1).padStart(2, '0')}`, 10 + index])),
    entries: twelveTeamIds.slice(0, 6).map((teamId, index) => ({ teamName: `Synthetic Team ${String(index + 1).padStart(2, '0')}`, issueKey: `CAP-${200 + index}`, capacity: 10 + index })) });

test('twelve Teams: cards for every Team with work, settled screenshots, and the pinned stack inside DoD 14 at 1440x900 and 1280x720', async ({ page }) => {
    const stored = Object.fromEntries(twelveTeamIds.slice(6).map((teamId, index) => [teamId, String(4 + index)]));
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(viewport);
        const server = numbersServer(stored);
        await install(page, { server, selectedTeams: ['all'], scopeTeamIds: twelveTeamIds, capacityProject: 'CAP', capacity: twelveCapacity, issues: twelveStories });
        await openPlanning(page);
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(12);
        await storedOn(page, 'team-12', '9.0');
        const compact = await pinnedHeights(page);
        expect(compact.panel, `compact ${viewport.width}`).toBeLessThan(64);
        expect(compact.stack, `compact ${viewport.width}`).toBeLessThanOrEqual(175);
        await showCards(page);
        await page.mouse.move(5, viewport.height - 5);
        await page.waitForTimeout(200);
        await page.locator('.planning-team-capacity-cards').screenshot({ path: `tmp/planning-323-every-team/task4/current/cards-12-teams-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
        await page.locator('.planning-panel').screenshot({ path: `tmp/planning-323-every-team/task4/current/panel-12-teams-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
        await showCards(page);
        await page.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
        await expect(page.locator('#planning-panel-details')).toBeHidden();
        expect(await pinnedHeights(page), `compact again ${viewport.width}`).toEqual(compact);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

// ---- #323 Task 5: per-Team card editing, status and reconciliation -----------------------------------------------

// Per-Team stored numbers for one Sprint (the others are empty): the full GET answers its `teamId`, the batch read every
// requested Team, and a PATCH writes only its body's `teamId` (a guarded `onlyIfSource` write only an existing own one).
// `patchStatus(teamId, n)` answers that Team's n-th PATCH with an error; `holdPatch(teamId, n)` may delay it.
function teamsServer({ planned = {}, rows = {}, capabilities = caps, patchStatus = null, holdPatch = null, holdGet = null, getStatus = null } = {}) {
    const state = { docs: {}, gets: [], reads: [], patches: [] };
    const keyOf = (sprintId, teamId) => `${sprintId}|${teamId}`;
    for (const teamId of new Set([...Object.keys(planned), ...Object.keys(rows)])) {
        const value = planned[teamId];
        state.docs[keyOf(futureSprintId, teamId)] = { revision: 1, rows: (rows[teamId] || []).map(row => ({ ...row })),
            planned: value == null ? null : typeof value === 'object' ? value : { value, source: 'user' } };
    }
    const docOf = (sprintId, teamId) => {
        const own = state.docs[keyOf(sprintId, teamId)];
        return own?.revision
            ? { teamId, sprintId, revision: own.revision, rows: own.rows, planned: own.planned, inherited: null, capabilities }
            : { teamId, sprintId, revision: 0, rows: [], planned: null, inherited: null, capabilities };
    };
    const handler = async route => {
        const request = route.request();
        const url = new URL(request.url());
        const sprintId = decodeURIComponent(url.pathname.split('/')[4]);
        if (request.method() === 'GET') {
            const teamId = url.searchParams.get('teamId');
            state.gets.push(teamId);
            if (holdGet) await holdGet(teamId);
            const status = getStatus?.(teamId);
            return status ? json(route, { error: 'review_unavailable' }, status) : json(route, docOf(sprintId, teamId));
        }
        const body = requestBody(request);
        state.patches.push({ sprintId, body });
        const n = state.patches.filter(patch => patch.body.teamId === body.teamId).length;
        if (holdPatch) await holdPatch(body.teamId, n);
        const status = patchStatus?.(body.teamId, n);
        if (status) return json(route, { error: status === 400 ? 'assignee_capacity_document_limit' : 'review_unavailable' }, status);
        const own = state.docs[keyOf(sprintId, body.teamId)] || { revision: 0, rows: [], planned: null };
        let next = body.planned;
        if (next?.onlyIfSource && !own.revision) next = undefined;
        if (!body.changes.length && next === undefined) return json(route, docOf(sprintId, body.teamId));
        for (const change of body.changes) {
            let row = own.rows.find(candidate => candidate.assigneeKey === change.assigneeKey);
            if (!row) { row = { assigneeKey: change.assigneeKey, displayName: change.displayName || change.assigneeKey, capacity: null, vacations: null, notes: null, removed: false }; own.rows.push(row); }
            for (const field of ['displayName', 'capacity', 'vacations', 'notes', 'removed']) if (field in change) row[field] = change[field];
        }
        if (next && (!next.onlyIfSource || next.onlyIfSource.includes(own.planned?.source ?? null))) own.planned = next.value == null ? null : { value: next.value, source: next.source };
        own.revision += 1;
        state.docs[keyOf(sprintId, body.teamId)] = own;
        return json(route, docOf(sprintId, body.teamId));
    };
    const batch = async route => {
        const request = route.request();
        const sprintId = decodeURIComponent(new URL(request.url()).pathname.split('/')[4]);
        const teamIds = requestBody(request)?.teamIds || [];
        state.reads.push(teamIds);
        return json(route, { sprintId, capabilities, teams: teamIds.map(teamId => { const { revision, planned: value, inherited } = docOf(sprintId, teamId); return { teamId, revision, planned: value, inherited }; }) });
    };
    const storedOf = teamId => state.docs[keyOf(futureSprintId, teamId)]?.planned || null;
    return { state, handler, batch, storedOf };
}

const teamPatches = (server, teamId) => server.state.patches.filter(patch => patch.body.teamId === teamId);
// Jira capacity tickets by Team name (CAP-101, CAP-102, ...), with mutation enabled.
const tickets = values => sprint => ({ enabled: true, mutationEnabled: true, sprint,
    capacities: Object.fromEntries(Object.entries(values).filter(([, value]) => value != null)),
    entries: Object.entries(values).map(([teamName, capacity], index) => ({ teamName, issueKey: `CAP-${101 + index}`, capacity })) });
const teamPencil = (page, teamId, name) => teamCard(page, teamId).getByRole('button', { name: `Edit ${name} team capacity` });
const teamInput = (page, teamId, name) => teamCard(page, teamId).getByRole('spinbutton', { name: `${name} team capacity (not in Jira)` });
const cardStatus = (page, teamId) => teamCard(page, teamId).locator('.team-capacity-status');
const railButton = (page, teamId, name) => teamCard(page, teamId).getByRole('button', { name, exact: true });
const valueReadout = page => page.locator('.epic-full-value-readout');
const cardHeights = page => page.evaluate(() => [...document.querySelectorAll('.planning-team-capacity-cards .team-stat-card')].map(card => Math.round(card.getBoundingClientRect().height * 100) / 100));
// Hovering a card reveals its rail (the pencil's own behaviour); a failed save adds ↻ Retry and × Discard there.
async function hoverRail(page, teamId, name) {
    await teamCard(page, teamId).hover();
    const button = railButton(page, teamId, name);
    await expect(button).toBeVisible();
    await button.hover();
    await expect(valueReadout(page)).toHaveCount(1);
    return button;
}
// Stored-number saves and failures are told in the overview row's existing state-note slot (#323 Task 5 fix round 2), never
// in an added line: the pinned stack keeps its height.
const overviewStatus = page => page.locator('.planning-panel .planning-actions > .planning-review-state-note', { hasText: /Team saves? failed|Saving \d+ Teams?…/ });
const addedStatusLine = page => page.locator('.planning-panel-capacity-status');
// The summary's values stay whole beside the note, and the note stays one line clear of Details (as the state-note geometry test).
async function expectNoteBesideSummary(page, label) {
    const geometry = await page.locator('.planning-panel .planning-actions').first().evaluate(row => {
        const rect = node => node.getBoundingClientRect();
        const summary = row.querySelector(':scope > .planning-stats'), note = row.querySelector(':scope > .planning-review-state-note'), details = row.querySelector('.planning-panel-collapse');
        const s = rect(summary);
        return { summaryUnclipped: summary.scrollWidth <= summary.clientWidth, partsInside: [...summary.children].every(part => rect(part).left >= s.left - 0.5 && rect(part).right <= s.right + 0.5),
            noteWhiteSpace: getComputedStyle(note).whiteSpace, noteClearOfDetails: rect(note).right <= rect(details).left, noteOnRow: rect(note).top >= rect(row).top - 0.5 && rect(note).bottom <= rect(row).bottom + 0.5 };
    });
    expect(geometry, label).toEqual({ summaryUnclipped: true, partsInside: true, noteWhiteSpace: 'nowrap', noteClearOfDetails: true, noteOnRow: true });
}
// The compact row is 46.9px; a status line adds one line under it (planning_review_integration's COMPACT_ERROR_HEIGHT).
// A control's label is on one line (every text rect shares one top) and is not clipped.
const singleLine = locator => locator.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size === 1 && node.scrollWidth <= node.clientWidth;
});
const twoTeams = ['team-alpha', 'team-beta'];
async function typeTeamNumber(page, teamId, name, value) {
    await teamCard(page, teamId).hover();
    await teamPencil(page, teamId, name).click();
    const input = teamInput(page, teamId, name);
    await expect(input).toBeFocused();
    await input.fill(value);
    await input.press('Enter');
    await expect(teamCard(page, teamId).locator('.team-capacity-editor')).toHaveCount(0);
}
async function hideDetails(page) {
    await page.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
    await expect(page.locator('#planning-panel-details')).toBeHidden();
}

test('two Teams: each card pencil saves only its own Team and Sprint, the two saves overlap and both land, the overview says Saving 2 Teams…, and one editor is open at a time', async ({ page }) => {
    let releasePatches;
    const held = new Promise(resolve => { releasePatches = resolve; });
    const server = teamsServer({ holdPatch: () => held });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket, analytics: true });
    await openPlanning(page);
    // The compact row before any capacity note, measured in this engine: a note never changes its height.
    const compactRow = (await page.locator('.planning-panel').boundingBox()).height;
    await showCards(page);
    await expect.poll(() => server.state.reads.length).toBe(1);
    expect(server.state.gets, 'no per-Team document read before an editor opens').toEqual([]);
    // One editor at a time: while Alpha's is open no other card offers a pencil; after Escape, Beta's opens alone.
    await teamCard(page, 'team-alpha').hover();
    await expect(teamPencil(page, 'team-alpha', 'Alpha Team')).toBeEnabled();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    await expect(teamInput(page, 'team-alpha', 'Alpha Team')).toBeFocused();
    await teamCard(page, 'team-beta').hover();
    await expect(teamPencil(page, 'team-beta', 'Beta Team')).toHaveCount(0);
    await expect(page.locator('.planning-team-capacity-cards .team-capacity-editor')).toHaveCount(1);
    await teamInput(page, 'team-alpha', 'Alpha Team').press('Escape');
    await teamCard(page, 'team-beta').hover();
    await teamPencil(page, 'team-beta', 'Beta Team').click();
    await expect(teamInput(page, 'team-beta', 'Beta Team')).toBeFocused();
    await expect(page.locator('.planning-team-capacity-cards .team-capacity-editor')).toHaveCount(1);
    await expect(teamInput(page, 'team-alpha', 'Alpha Team')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect([...server.state.gets].sort(), 'opening an editor reads only that Team').toEqual(['team-alpha', 'team-beta']);
    // Both saves are in flight together (neither is answered before both arrive); the expanded overview says so, then both land.
    await typeTeamNumber(page, 'team-alpha', 'Alpha Team', '14');
    await typeTeamNumber(page, 'team-beta', 'Beta Team', '6');
    await expect.poll(() => server.state.patches.length).toBe(2);
    await expect(overviewStatus(page)).toHaveText('Saving 2 Teams…');
    await expect(addedStatusLine(page)).toHaveCount(0);
    await expectNoteBesideSummary(page, 'saving, expanded');
    await page.mouse.move(5, 600);
    await page.locator('.planning-panel .planning-actions').first().screenshot({ path: 'tmp/planning-323-every-team/task5/spec-captures/action-row-saving-2-teams-expanded-1440x900.png', animations: 'disabled' });
    await hideDetails(page);
    await expect(overviewStatus(page)).toHaveText('Saving 2 Teams…');
    expect((await page.locator('.planning-panel').boundingBox()).height, 'compact row with the note').toBe(compactRow);
    await expectNoteBesideSummary(page, 'saving, compact');
    await page.locator('.planning-panel .planning-actions').first().screenshot({ path: 'tmp/planning-323-every-team/task5/spec-captures/action-row-saving-2-teams-compact-1440x900.png', animations: 'disabled' });
    await showCards(page);
    releasePatches();
    await expect(overviewStatus(page)).toHaveCount(0);
    await storedOn(page, 'team-alpha', '14.0');
    await storedOn(page, 'team-beta', '6.0');
    expect(teamPatches(server, 'team-alpha').map(patch => [patch.sprintId, patch.body])).toEqual([[String(futureSprintId), { teamId: 'team-alpha', planned: { value: '14', source: 'user' }, changes: [] }]]);
    expect(teamPatches(server, 'team-beta').map(patch => [patch.sprintId, patch.body])).toEqual([[String(futureSprintId), { teamId: 'team-beta', planned: { value: '6', source: 'user' }, changes: [] }]]);
    expect(server.storedOf('team-alpha')).toEqual({ value: '14', source: 'user' });
    expect(server.storedOf('team-beta')).toEqual({ value: '6', source: 'user' });
    await expect(page.locator('.planning-team-capacity-cards .team-capacity-status')).toHaveCount(0);
    expect(jiraWrites(calls), 'no PATCH /api/capacity without a Jira Save').toEqual([]);
    expect(await capacityEvents(page), 'the stored-number editors emit no capacity_* analytics').toEqual([]);
});


test('a failed save shows ↻ Retry and × Discard in that card\'s rail with the error readout, and in the overview expanded and compact, while the other Team saves; the card does not grow', async ({ page }) => {
    let failAlpha = true;
    const server = teamsServer({ patchStatus: teamId => (teamId === 'team-alpha' && failAlpha ? 503 : 0) });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    // The compact row before any capacity note, measured in this engine: a note never changes its height.
    const compactRow = (await page.locator('.planning-panel').boundingBox()).height;
    await showCards(page);
    await typeTeamNumber(page, 'team-alpha', 'Alpha Team', '14');
    await typeTeamNumber(page, 'team-beta', 'Beta Team', '6');
    await storedOn(page, 'team-beta', '6.0');
    await expect(teamCard(page, 'team-alpha')).toHaveAttribute('data-capacity-attention', 'failed');
    await expect(teamCard(page, 'team-beta')).not.toHaveAttribute('data-capacity-attention', /./);
    await expect(page.locator('.planning-team-capacity-cards .team-capacity-status'), 'no in-card status block').toHaveCount(0);
    await storedOn(page, 'team-alpha', '14.0');
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(5, 600);
    // Both cards now carry a stored number: the failed one is exactly as tall as the saved one.
    const before = await cardHeights(page);
    expect(before[0], 'a failure never grows the card').toBe(before[1]);
    await hoverRail(page, 'team-alpha', 'Retry');
    await expect(valueReadout(page)).toHaveText('Retry · Team capacity not saved.');
    await railButton(page, 'team-alpha', 'Discard changes').hover();
    // Moving to the next icon closes the first readout after its short close delay: one readout remains.
    await expect(valueReadout(page)).toHaveCount(1);
    await expect(valueReadout(page)).toHaveText('Discard changes · Team capacity not saved.');
    expect(await cardHeights(page)).toEqual(before);
    await expect(railButton(page, 'team-beta', 'Retry')).toHaveCount(0);
    // The overview line tells it while expanded (the rail shows only on hover) and while compact (the cards are hidden).
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    await expect(addedStatusLine(page)).toHaveCount(0);
    await page.mouse.move(5, 600);
    await page.waitForTimeout(200);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/planning-323-every-team/task5/spec-captures/panel-failed-expanded-1440x900.png', animations: 'disabled' });
    await hideDetails(page);
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    expect((await page.locator('.planning-panel').boundingBox()).height, 'compact row with the note').toBe(compactRow);
    await showCards(page);
    // Retry resends only Alpha's change.
    failAlpha = false;
    await teamCard(page, 'team-alpha').hover();
    await railButton(page, 'team-alpha', 'Retry').click();
    await expect(teamCard(page, 'team-alpha')).not.toHaveAttribute('data-capacity-attention', /./);
    await expect.poll(() => server.storedOf('team-alpha')).toEqual({ value: '14', source: 'user' });
    expect(teamPatches(server, 'team-alpha').at(-1).body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'user' }, changes: [] });
    // Discard drops the failed draft: the card shows the saved number again and nothing is sent.
    failAlpha = true;
    await typeTeamNumber(page, 'team-alpha', 'Alpha Team', '16');
    await expect(teamCard(page, 'team-alpha')).toHaveAttribute('data-capacity-attention', 'failed');
    await storedOn(page, 'team-alpha', '16.0');
    const sent = server.state.patches.length;
    await teamCard(page, 'team-alpha').hover();
    await railButton(page, 'team-alpha', 'Discard changes').click();
    await expect(teamCard(page, 'team-alpha')).not.toHaveAttribute('data-capacity-attention', /./);
    await storedOn(page, 'team-alpha', '14.0');
    await hideDetails(page);
    await expect(overviewStatus(page)).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(server.state.patches.length, 'Discard sends nothing').toBe(sent);
    expect(teamPatches(server, 'team-beta')).toHaveLength(1);
    expect(jiraWrites(calls)).toEqual([]);
});

test('one Team: the card × Discard drops only the stored-number draft and keeps the strip row draft', async ({ page }) => {
    const server = teamsServer({ rows: { 'team-alpha': [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '6', vacations: null, notes: null, removed: false }] }, patchStatus: () => 503 });
    await install(page, { server, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('9'); await capacity.press('Enter');
    await expect(strip(page).locator('[data-assignee-save-failed]')).toBeVisible();
    await showCards(page);
    await expect(alphaCard(page), 'a person-row failure stays in the strip').not.toHaveAttribute('data-capacity-attention', /./);
    await typeTeamNumber(page, 'team-alpha', 'Alpha Team', '14');
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-attention', 'failed');
    await alphaCard(page).hover();
    await railButton(page, 'team-alpha', 'Discard changes').click();
    await expect(alphaCard(page)).not.toHaveAttribute('data-capacity-attention', /./);
    await expect(alphaCard(page)).not.toHaveAttribute('data-capacity-source', /./);
    await expect(strip(page).locator('[data-assignee-save-failed]')).toBeVisible();
    await expect(capacity).toHaveValue('9');
});

test('D4: the document-limit 400 reads as that Team\'s visible rejection in the ↻ readout and the compact overview, while the other Team saves', async ({ page }) => {
    const server = teamsServer({ patchStatus: teamId => (teamId === 'team-alpha' ? 400 : 0) });
    await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await typeTeamNumber(page, 'team-alpha', 'Alpha Team', '14');
    await typeTeamNumber(page, 'team-beta', 'Beta Team', '6');
    await storedOn(page, 'team-beta', '6.0');
    await expect(teamCard(page, 'team-alpha')).toHaveAttribute('data-capacity-attention', 'failed');
    await hoverRail(page, 'team-alpha', 'Retry');
    await expect(valueReadout(page)).toHaveText('Retry · Team capacity not saved: the server refused it.');
    await hideDetails(page);
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    expect(server.storedOf('team-alpha')).toBeNull();
});

test('two Teams: each card whose typed number differs from its ticket is marked and offers → in its rail; no banner, no Use ticket value or Not now, and nothing is written before a click', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '9' } });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), analytics: true });
    await openPlanning(page);
    await showCards(page);
    await expect(mismatchCards(page)).toHaveCount(2);
    await expect(page.locator('[data-capacity-reconcile]')).toHaveCount(0);
    await expect(page.locator('.planning-team-capacity-cards').getByRole('button', { name: /Use ticket value|Not now|Write to ticket/ })).toHaveCount(0);
    for (const [teamId, name] of [['team-alpha', 'Alpha Team'], ['team-beta', 'Beta Team']]) {
        await teamCard(page, teamId).hover();
        await expect(teamCard(page, teamId).getByRole('button', { name: `Edit ${name} capacity` })).toBeVisible();
        await expect(teamCard(page, teamId).getByRole('button', { name: `Apply ${name} team capacity to Jira`, exact: true }), 'the push is offered').toBeVisible();
    }
    await page.waitForTimeout(300);
    expect(server.state.patches).toEqual([]);
    expect(server.state.gets, 'a mismatch reads no document').toEqual([]);
    expect(jiraWrites(calls), 'no PATCH /api/capacity').toEqual([]);
    expect(await capacityEvents(page)).toEqual([]);
});

test('two Teams: after a Jira editor save the Team\'s stored user number settles to jira; no PATCH /api/capacity before the Save', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), analytics: true });
    await openPlanning(page);
    await showCards(page);
    await expect(mismatchCards(page)).toHaveCount(1);
    await alphaCard(page).hover();
    await alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' }).click();
    const jiraInput = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team Jira total planned capacity' });
    await expect(jiraInput).toHaveValue('20');
    await jiraInput.fill('15');
    await page.waitForTimeout(300);
    expect(jiraWrites(calls), 'opening and typing write nothing').toEqual([]);
    expect(server.state.patches).toEqual([]);
    await alphaCard(page).getByRole('button', { name: 'Save Alpha Team capacity' }).click();
    await expect.poll(() => jiraWrites(calls).length).toBe(1);
    expect(jiraWrites(calls)[0].pathname).toBe('/api/capacity/CAP-101');
    expect(jiraWrites(calls)[0].body).toMatchObject({ capacity: 15, expectedCapacity: 20, teamName: 'Alpha Team' });
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '15', source: 'jira' }, changes: [] });
    expect(server.state.gets, 'only the edited Team read its document').toEqual(['team-alpha']);
    await expect(mismatchCards(page)).toHaveCount(0);
    expect(await capacityEvents(page)).toEqual(['capacity_edit_open', 'capacity_change_submit', 'capacity_change_result']);
});

test('I1: a person-row failure from One Team scope shows no ↻ or × on that Team\'s card in two Teams; the failure stays in the strip', async ({ page }) => {
    const server = teamsServer({ rows: { 'team-alpha': [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '6', vacations: null, notes: null, removed: false }] }, patchStatus: () => 503 });
    await install(page, { server, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await expand(page);
    const capacity = rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' });
    await capacity.fill('9'); await capacity.press('Enter');
    await expect(strip(page).locator('[data-assignee-save-failed]')).toBeVisible();
    await pickTeam(page, 'Beta Team');
    await expect(strip(page)).toHaveCount(0);
    await showCards(page);
    await expect(teamCard(page, 'team-alpha')).toHaveCount(1);
    await expect(teamCard(page, 'team-alpha')).not.toHaveAttribute('data-capacity-attention', /./);
    await teamCard(page, 'team-alpha').hover();
    await expect(railButton(page, 'team-alpha', 'Retry')).toHaveCount(0);
    await expect(railButton(page, 'team-alpha', 'Discard changes')).toHaveCount(0);
    await expect(overviewStatus(page), 'no stored number is failing').toHaveCount(0);
    // Back in One Team scope the strip still shows its own failure with the draft.
    await pickTeam(page, 'Beta Team');
    await expect(strip(page)).toBeVisible();
    await expect(strip(page).locator('.capacity-subtitle')).toHaveText('Not saved');
    if (!(await table(page).isVisible())) await expand(page);
    await expect(strip(page).locator('[data-assignee-save-failed]')).toBeVisible();
    await expect(rowOf(page, 'acc-ann').getByRole('textbox', { name: 'Capacity for Ann Synthetic' })).toHaveValue('9');
});

test('the rail never shows more than three icons: a failed settle on a ticketed Team shows ↻ · × · pencil without the Jira link', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14' }, patchStatus: teamId => (teamId === 'team-alpha' ? 503 : 0) });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }) });
    await openPlanning(page);
    await showCards(page);
    await alphaCard(page).hover();
    expect(await alphaCard(page).locator('.team-capacity-action-rail').evaluate(node => [...node.children].map(child => child.getAttribute('aria-label'))))
        .toEqual(['Open Alpha Team capacity ticket in Jira', 'Apply Alpha Team team capacity to Jira', 'Edit Alpha Team capacity']);
    await alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' }).click();
    await alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team Jira total planned capacity' }).fill('15');
    await alphaCard(page).getByRole('button', { name: 'Save Alpha Team capacity' }).click();
    await expect.poll(() => jiraWrites(calls).length).toBe(1);
    // The settle to jira fails: the card shows Retry and Discard in place of the Jira link.
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-attention', 'failed');
    await page.evaluate(() => document.activeElement?.blur());
    await alphaCard(page).hover();
    expect(await alphaCard(page).locator('.team-capacity-action-rail').evaluate(node => [...node.children].map(child => child.getAttribute('aria-label'))))
        .toEqual(['Retry', 'Discard changes', 'Edit Alpha Team capacity']);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-rail-icons', '3');
    expect(await alphaCard(page).evaluate(node => node.querySelector('.team-stat-label').getBoundingClientRect().right <= node.querySelector('.team-capacity-action-rail').getBoundingClientRect().left + 0.5)).toBe(true);
    expect(await page.locator('.planning-team-capacity-cards .team-capacity-action-rail').evaluateAll(rails => Math.max(...rails.map(rail => rail.children.length)))).toBeLessThanOrEqual(3);
});

test('a header Team-selection change while a card editor is open closes it without saving', async ({ page }) => {
    const server = teamsServer();
    await install(page, { server, selectedTeams: twoTeams, scopeTeamIds: ['team-alpha', 'team-beta', 'team-gamma'], capacityProject: 'CAP', capacity: noTicket, issues: gammaStories });
    await openPlanning(page);
    await showCards(page);
    await teamCard(page, 'team-alpha').hover();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    await teamInput(page, 'team-alpha', 'Alpha Team').fill('14');
    // No pointer: add Gamma to the selection through dispatched clicks, so only the scope change can close the editor.
    await page.locator('.team-dropdown-toggle:visible').dispatchEvent('click');
    await page.locator('.team-dropdown-panel:visible').getByText('Gamma Team', { exact: true }).dispatchEvent('click');
    await expect(teamCard(page, 'team-gamma')).toHaveCount(1);
    await expect(page.locator('.planning-team-capacity-cards .team-capacity-editor')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(server.state.patches, 'the open editor saved nothing after the Team change').toEqual([]);
});

test('a typed number is kept when its Team\'s document read fails: it is saved, or kept as a failed draft with ↻ Retry and × Discard', async ({ page }) => {
    let releaseGet;
    const getHeld = new Promise(resolve => { releaseGet = resolve; });
    let failPatch = true;
    const server = teamsServer({ holdGet: () => getHeld, getStatus: teamId => (teamId === 'team-alpha' ? 500 : 0), patchStatus: () => (failPatch ? 503 : 0) });
    await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    // The editor's document read is still running when the number is saved, and then fails.
    await teamCard(page, 'team-alpha').hover();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    await teamInput(page, 'team-alpha', 'Alpha Team').fill('14');
    await teamInput(page, 'team-alpha', 'Alpha Team').press('Enter');
    releaseGet();
    await expect.poll(() => teamPatches(server, 'team-alpha').length).toBe(1);
    expect(teamPatches(server, 'team-alpha')[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'user' }, changes: [] });
    await expect(teamCard(page, 'team-alpha')).toHaveAttribute('data-capacity-attention', 'failed');
    await storedOn(page, 'team-alpha', '14.0');
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    failPatch = false;
    await teamCard(page, 'team-alpha').hover();
    await railButton(page, 'team-alpha', 'Retry').click();
    await expect.poll(() => server.storedOf('team-alpha')).toEqual({ value: '14', source: 'user' });
    await expect(teamCard(page, 'team-alpha')).not.toHaveAttribute('data-capacity-attention', /./);
    await expect(overviewStatus(page)).toHaveCount(0);
});

test('a plan load error and its Retry outrank Team save status in the state note; the Team status returns once the plan loads', async ({ page }) => {
    let reviewFails = true;
    const server = teamsServer({ patchStatus: teamId => (teamId === 'team-alpha' ? 503 : 0) });
    await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    // The shared plan cannot be read (a later route wins over the install's), until the user retries.
    await page.route(/\/api\/eng\/sprints\/[^/?]+\/review(?:\?.*)?$/, route => (reviewFails && route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'review_unavailable' }) }) : route.fallback()));
    await openPlanning(page);
    const note = page.locator('.planning-panel .planning-actions > .planning-review-state-note');
    await expect(note).toContainText('Plan could not be loaded.');
    await showCards(page);
    await typeTeamNumber(page, 'team-alpha', 'Alpha Team', '14');
    await expect(teamCard(page, 'team-alpha')).toHaveAttribute('data-capacity-attention', 'failed');
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(5, 600);
    // The error and its Retry stay; the Team status does not displace them.
    await expect(note).toContainText('Plan could not be loaded.');
    await expect(overviewStatus(page)).toHaveCount(0);
    const retry = note.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    expect(await retry.evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === node; }), 'Retry is topmost').toBe(true);
    reviewFails = false;
    await retry.click();
    await expect(note).not.toContainText('Plan could not be loaded.');
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
});

test('request ledger: the per-Team mirror writes only an idle loaded owner after a user-initiated read, never after an automatic one, and never creates a document', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = teamsServer({ planned: { 'team-alpha': { value: '14', source: 'jira' }, 'team-beta': { value: '9', source: 'jira' } } });
    let values = { 'Alpha Team': 14, 'Beta Team': 9, 'Gamma Team': 3 };
    const { calls } = await install(page, { server, selectedTeams: ['team-alpha'], scopeTeamIds: ['team-alpha', 'team-beta', 'team-gamma'], capacityProject: 'CAP', capacity: sprint => tickets(values)(sprint), issues: gammaStories });
    await openPlanning(page);
    await showCards(page);
    await expect.poll(() => server.state.gets).toEqual(['team-alpha']);
    await pickTeam(page, 'Beta Team');
    await pickTeam(page, 'Gamma Team');
    await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(3);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(server.state.patches, 'equal tickets: nothing to mirror').toEqual([]);
    // Automatic window: the tickets changed and are re-read without the loading flag.
    values = { 'Alpha Team': 25, 'Beta Team': 35, 'Gamma Team': 4 };
    let since = calls.length;
    await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => calls.slice(since).some(call => call.pathname === '/api/capacity'), 'the automatic window re-read capacity').toBe(true);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(600);
    expect(server.state.patches, 'no mirror in an automatic window').toEqual([]);
    // A user-initiated read: only Alpha has a loaded owner (Beta and Gamma are batch records, Gamma has no document).
    since = calls.length;
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await expect.poll(() => server.state.patches.length).toBe(1);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(server.state.patches.map(patch => patch.body)).toEqual([{ teamId: 'team-alpha', planned: { value: '25', source: 'jira', onlyIfSource: [null, 'jira', 'inherited'] }, changes: [] }]);
    expect(server.state.gets, 'the mirror loads no other Team').toEqual(['team-alpha']);
    expect(server.storedOf('team-gamma'), 'no document is created').toBeNull();
    expect(jiraWrites(calls)).toEqual([]);
});

test('a header Sprint change while a card editor is open closes it without saving', async ({ page }) => {
    const server = teamsServer();
    await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await teamCard(page, 'team-alpha').hover();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    await teamInput(page, 'team-alpha', 'Alpha Team').fill('14');
    // No pointer: the editor's outside-pointer close is not what closes it.
    await page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle').dispatchEvent('click');
    await page.locator('.sprint-dropdown-option', { hasText: activeSprintName }).dispatchEvent('click');
    await expect(page.locator('.planning-team-capacity-cards .team-capacity-editor')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(400);
    expect(server.state.patches, 'the open editor saved nothing after the scope change').toEqual([]);
});

test('settled hover, focus and geometry: card pencils, editor controls, ↻ Retry and × Discard', async ({ page }) => {
    const server = teamsServer({ patchStatus: teamId => (teamId === 'team-gamma' ? 503 : 0) });
    await install(page, { server, selectedTeams: ['team-alpha', 'team-beta', 'team-gamma'], scopeTeamIds: ['team-alpha', 'team-beta', 'team-gamma'], capacityProject: 'CAP', capacity: noTicket, issues: gammaStories });
    await openPlanning(page);
    await showCards(page);
    const inBox = async (locator, container) => {
        const [own, box] = [await locator.boundingBox(), await container.boundingBox()];
        expect(own.x).toBeGreaterThanOrEqual(box.x - 0.5); expect(own.x + own.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
        expect(own.y).toBeGreaterThanOrEqual(box.y - 0.5); expect(own.y + own.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    };
    // Hover paints the overlay and ring and moves nothing; keyboard focus draws the card controls' solid outline.
    const settled = async (locator, card) => {
        await card.hover();
        await expect(locator).toBeVisible();
        const box = await locator.boundingBox();
        expect(box.width).toBeCloseTo(24, 0); expect(box.height).toBeCloseTo(24, 0);
        await inBox(locator, card);
        await locator.hover();
        await page.waitForTimeout(150);
        expect(await locator.boundingBox()).toEqual(box);
        expect(await locator.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
        // macOS WebKit reaches buttons with Option+Tab only.
        const tab = page.context().browser().browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
        await locator.focus();
        await page.keyboard.press(`Shift+${tab}`); await page.keyboard.press(tab);
        await expect(locator).toBeFocused();
        expect(await locator.evaluate(node => { const style = getComputedStyle(node); return [style.outlineStyle, style.outlineWidth]; })).toEqual(['solid', '2px']);
    };
    const titleClearOfRail = teamId => page.evaluate(id => {
        const card = document.querySelector(`.team-stat-card[data-capacity-team="${id}"]`);
        const title = card.querySelector('.team-stat-label').getBoundingClientRect(), rail = card.querySelector('.team-capacity-action-rail').getBoundingClientRect();
        return title.right <= rail.left + 0.5;
    }, teamId);
    for (const [teamId, name] of [['team-alpha', 'Alpha Team'], ['team-gamma', 'Gamma Team']]) await settled(teamPencil(page, teamId, name), teamCard(page, teamId));
    // Editor controls: one 28px row inside the card.
    await teamCard(page, 'team-alpha').hover();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    const editorRow = teamCard(page, 'team-alpha').locator('.team-capacity-editor-row');
    const controls = [teamInput(page, 'team-alpha', 'Alpha Team'), teamCard(page, 'team-alpha').getByRole('button', { name: 'Save Alpha Team team capacity' }), teamCard(page, 'team-alpha').getByRole('button', { name: 'Cancel Alpha Team team capacity edit' })];
    const rowBox = await editorRow.boundingBox();
    expect(rowBox.height).toBeCloseTo(28, 0);
    for (const control of controls) {
        const box = await control.boundingBox();
        expect(Math.abs((box.y + box.height / 2) - (rowBox.y + rowBox.height / 2))).toBeLessThanOrEqual(1);
        await inBox(control, teamCard(page, 'team-alpha'));
    }
    await controls[0].fill('5');
    const cancelBox = await controls[2].boundingBox();
    await controls[2].hover();
    expect(await controls[2].boundingBox()).toEqual(cancelBox);
    expect(await controls[2].evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
    await page.mouse.move(5, 600);
    await page.locator('.planning-team-capacity-cards').screenshot({ path: 'tmp/planning-323-every-team/task5/spec-captures/cards-editor-open-1440x900.png', animations: 'disabled' });
    await controls[0].press('Escape');
    // ↻ Retry and × Discard on a failed card: the pencil's size, frame, hover and focus, in the rail beside it.
    await typeTeamNumber(page, 'team-gamma', 'Gamma Team', '7');
    await expect(teamCard(page, 'team-gamma')).toHaveAttribute('data-capacity-attention', 'failed');
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(5, 600);
    expect(await teamCard(page, 'team-gamma').locator('.team-capacity-action-rail').evaluate(node => getComputedStyle(node).opacity), 'idle: the rail stays hidden').toBe('0');
    for (const label of ['Retry', 'Discard changes']) await settled(railButton(page, 'team-gamma', label), teamCard(page, 'team-gamma'));
    await teamCard(page, 'team-gamma').hover();
    expect(await titleClearOfRail('team-gamma'), 'three rail icons stay clear of the title').toBe(true);
    const rail = await teamCard(page, 'team-gamma').locator('.team-capacity-action-rail').evaluate(node => [...node.querySelectorAll('button')].map(button => button.getAttribute('aria-label')));
    expect(rail).toEqual(['Retry', 'Discard changes', 'Edit Gamma Team team capacity']);
    await page.evaluate(() => document.activeElement?.blur());
    await railButton(page, 'team-gamma', 'Retry').hover();
    await expect(valueReadout(page)).toHaveCount(1);
    await expect(valueReadout(page)).toBeVisible();
    await page.waitForTimeout(200);
    const [card, readout] = [await teamCard(page, 'team-gamma').boundingBox(), await valueReadout(page).boundingBox()];
    const clip = { x: Math.min(card.x, readout.x) - 8, y: Math.min(card.y, readout.y) - 8 };
    clip.width = Math.max(card.x + card.width, readout.x + readout.width) + 8 - clip.x; clip.height = Math.max(card.y + card.height, readout.y + readout.height) + 8 - clip.y;
    await page.screenshot({ path: 'tmp/planning-323-every-team/task5/spec-captures/card-failed-hover-1440x900.png', clip, scale: 'device' });
});

// G1: twelve Teams. Team 12 has no ticket (it can fail a typed number); the others have tickets.
const g1Name = index => `Synthetic Team ${String(index + 1).padStart(2, '0')}`;
const g1Tickets = sprint => ({ enabled: true, mutationEnabled: true, sprint,
    capacities: Object.fromEntries(twelveTeamIds.slice(0, 11).map((teamId, index) => [g1Name(index), 10 + index])),
    entries: twelveTeamIds.slice(0, 11).map((teamId, index) => ({ teamName: g1Name(index), issueKey: `CAP-${200 + index}`, capacity: 10 + index })) });
const g1Equal = Object.fromEntries(twelveTeamIds.slice(0, 11).map((teamId, index) => [teamId, { value: String(10 + index), source: 'jira' }]));
const g1Differ = Object.fromEntries(twelveTeamIds.slice(0, 11).map((teamId, index) => [teamId, String(index + 1)]));

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) test(`twelve Teams at ${viewport.width}x${viewport.height}: the card height is identical idle, hovered, mismatched, failed and editing; idle titles are whole; the pinned stack is unchanged compact and expanded`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    const titlesWhole = () => page.evaluate(() => [...document.querySelectorAll('.planning-team-capacity-cards .team-stat-label')].every(node => node.scrollWidth <= node.clientWidth));
    const rest = async () => { await page.evaluate(() => document.activeElement?.blur()); await page.mouse.move(5, viewport.height - 5); await page.waitForTimeout(200); };
    const openWith = async (planned, patchStatus = null) => {
        const server = teamsServer({ planned, patchStatus });
        await install(page, { server, selectedTeams: ['all'], scopeTeamIds: twelveTeamIds, capacityProject: 'CAP', capacity: g1Tickets, issues: twelveStories });
        await openPlanning(page);
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(12);
        await page.waitForLoadState('networkidle');
        const compact = await pinnedHeights(page);
        await showCards(page);
        await rest();
        return { server, compact, expanded: await pinnedHeights(page) };
    };
    // Baseline: every stored number equals its ticket.
    const base = await openWith(g1Equal);
    const baseline = await cardHeights(page);
    expect(base.compact.panel).toBeLessThan(64);
    expect(base.compact.stack).toBeLessThanOrEqual(175);
    expect(await titlesWhole(), 'baseline titles').toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // Eleven mismatches; Team 12 then fails a typed number.
    const run = await openWith(g1Differ, teamId => (teamId === 'team-12' ? 503 : 0));
    await expect(mismatchCards(page)).toHaveCount(11);
    expect(await cardHeights(page), 'mismatch').toEqual(baseline);
    expect(await titlesWhole(), 'idle titles with mismatches').toBe(true);
    expect(run.compact, 'compact stack with mismatches').toEqual(base.compact);
    expect(run.expanded, 'expanded stack with mismatches').toEqual(base.expanded);
    await page.locator('.planning-team-capacity-cards').screenshot({ path: `tmp/planning-323-every-team/task5/spec-captures/cards-12-idle-${size}.png`, animations: 'disabled' });
    await teamCard(page, 'team-02').hover();
    await page.waitForTimeout(150);
    expect(await cardHeights(page), 'hovered').toEqual(baseline);
    await page.locator('.planning-team-capacity-cards').screenshot({ path: `tmp/planning-323-every-team/task5/spec-captures/cards-12-hover-${size}.png`, animations: 'disabled' });
    await teamCard(page, 'team-01').hover();
    await teamCard(page, 'team-01').getByRole('button', { name: 'Edit Synthetic Team 01 capacity' }).click();
    await expect(teamCard(page, 'team-01').locator('.team-capacity-editor')).toHaveCount(1);
    await expect(teamCard(page, 'team-01').getByRole('spinbutton', { name: 'Synthetic Team 01 Jira total planned capacity', exact: true })).toBeFocused();
    // Team cards never grow (#323 Task 8 R3): an open editor keeps every card, its own included, at the idle height.
    expect(await cardHeights(page), 'editing').toEqual(baseline);
    await page.keyboard.press('Escape');
    await expect(teamCard(page, 'team-01').locator('.team-capacity-editor')).toHaveCount(0);
    await typeTeamNumber(page, 'team-12', 'Synthetic Team 12', '7');
    await expect(teamCard(page, 'team-12')).toHaveAttribute('data-capacity-attention', 'failed');
    await rest();
    expect(await cardHeights(page), 'failed').toEqual(baseline);
    expect(await titlesWhole(), 'idle titles with a failure').toBe(true);
    // The failure is told in the action row's state note: the pinned stack keeps its exact height, expanded and compact.
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    await expect(addedStatusLine(page)).toHaveCount(0);
    expect(await pinnedHeights(page), 'expanded stack with the note').toEqual(base.expanded);
    await expectNoteBesideSummary(page, `failed, expanded ${size}`);
    await teamCard(page, 'team-12').hover();
    await page.waitForTimeout(150);
    expect(await cardHeights(page), 'failed and hovered').toEqual(baseline);
    await page.locator('.planning-team-capacity-cards').screenshot({ path: `tmp/planning-323-every-team/task5/spec-captures/cards-12-failed-hover-${size}.png`, animations: 'disabled' });
    await rest();
    await page.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    const compactFailed = await pinnedHeights(page);
    expect(compactFailed, 'compact stack with the note').toEqual(base.compact);
    expect(compactFailed.panel).toBe(base.compact.panel);
    await expectNoteBesideSummary(page, `failed, compact ${size}`);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// ---- #323 Task 6: the card's → pushes its Team's stored number to that Team's own matched ticket in one click ----
const pushOf = (page, teamId, name) => teamCard(page, teamId).getByRole('button', { name: `Apply ${name} team capacity to Jira`, exact: true });
const pushStatus = page => page.locator('.planning-panel .planning-actions > .planning-review-state-note', { hasText: /Jira push(es)? (failed|needs? review)|Applying \d+ Teams? to Jira…/ });
const pushEvents = page => page.evaluate(() => (window.dataLayer || []).filter(entry => entry?.workflow_action === 'capacity_reconcile_push').map(entry => entry.result));
// A held PATCH /api/capacity answer: the test releases it with a status and body.
function heldJira() {
    const held = [];
    const handler = (route, body, issueKey) => new Promise(resolve => { held.push({ body, issueKey, answer: (status, response) => resolve(json(route, response, status)) }); });
    return { held, handler };
}
// Visible in-app readouts and the card's own value tooltip (its ::after) while a rail control is hovered.
const oneReadout = (page, teamId) => page.evaluate(id => ({
    readouts: [...document.querySelectorAll('.epic-full-value-readout')].filter(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && getComputedStyle(node).visibility !== 'hidden'; }).length,
    cardTooltip: getComputedStyle(document.querySelector(`.planning-team-capacity-cards .team-stat-card[data-capacity-team="${id}"]`), '::after').content,
}), teamId);
async function hoverPushOf(page, teamId, name) {
    await teamCard(page, teamId).hover();
    const button = pushOf(page, teamId, name);
    await expect(button).toBeVisible();
    await button.hover();
    await expect(valueReadout(page)).toHaveCount(1);
    return button;
}

for (const result of ['success', 'already_current']) test(`one click on → sends one PATCH to that Team's own ticket; ${result} updates the ticket, settles the stored number to jira and removes the →`, async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '9' } });
    const jira = heldJira();
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), analytics: true, capacityPatch: jira.handler });
    await openPlanning(page);
    await showCards(page);
    await expect(mismatchCards(page)).toHaveCount(2);
    const button = await hoverPushOf(page, 'team-alpha', 'Alpha Team');
    await expect(valueReadout(page)).toHaveText('Apply 14 SP to Jira (ticket 20 SP)');
    await page.waitForTimeout(200);
    expect(jiraWrites(calls), 'hover writes nothing').toEqual([]);
    await button.click();
    await expect.poll(() => jiraWrites(calls).length).toBe(1);
    expect(jiraWrites(calls)[0].pathname).toBe('/api/capacity/CAP-101');
    expect(jiraWrites(calls)[0].body).toEqual({ sprintName: futureSprintName, teamName: 'Alpha Team', expectedCapacity: 20, capacity: 14 });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(pushStatus(page)).toHaveText('Applying 1 Team to Jira…');
    jira.held[0].answer(200, { issueKey: 'CAP-101', teamName: 'Alpha Team', previousCapacity: result === 'success' ? 20 : 14, capacity: 14, result });
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'jira' }, changes: [] });
    await expect(mismatchCards(page)).toHaveCount(1);
    await expect(teamCard(page, 'team-alpha')).not.toHaveAttribute('data-capacity-attention', /./);
    await teamCard(page, 'team-alpha').hover();
    await expect(pushOf(page, 'team-alpha', 'Alpha Team')).toHaveCount(0);
    await expect(teamCard(page, 'team-alpha').locator('.microbar-meta')).toContainText('Cap 14.0');
    await expect(pushStatus(page)).toHaveCount(0);
    expect(jiraWrites(calls), 'Beta is never written').toHaveLength(1);
    expect(await capacityEvents(page)).toEqual(['capacity_reconcile_push']);
    expect(await pushEvents(page)).toEqual(['success']);
});

test('a 409 capacity_conflict shows the current ticket value on the → readout and in the overview, never claims nothing was written, and the next click expects it', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    const jira = heldJira();
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), analytics: true, capacityPatch: jira.handler });
    await openPlanning(page);
    await showCards(page);
    await (await hoverPushOf(page, 'team-alpha', 'Alpha Team')).click();
    await expect.poll(() => jira.held.length).toBe(1);
    jira.held[0].answer(409, { error: 'capacity_conflict', currentCapacity: 22 });
    await expect(pushOf(page, 'team-alpha', 'Alpha Team')).toHaveAttribute('data-push-state', 'conflict');
    await expect(pushStatus(page)).toHaveText('1 Jira push needs review');
    await page.mouse.move(5, 600);
    const button = await hoverPushOf(page, 'team-alpha', 'Alpha Team');
    await expect(valueReadout(page)).toHaveText('Capacity changed in Jira to 22.0. Apply 14 SP again to replace it.');
    await expect(valueReadout(page)).not.toHaveText(/nothing|not written|prevented/i);
    expect(server.state.patches, 'a conflict settles nothing').toEqual([]);
    await button.click();
    await expect.poll(() => jira.held.length).toBe(2);
    expect(jira.held[1].body).toEqual({ sprintName: futureSprintName, teamName: 'Alpha Team', expectedCapacity: 22, capacity: 14 });
    expect(jiraWrites(calls)).toHaveLength(2);
    expect(await pushEvents(page)).toEqual(['conflict']);
});

test('a 401 from the push enters the terminal sign-in recovery and is never replayed', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), analytics: true,
        capacityPatch: route => json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401) });
    await openPlanning(page);
    await showCards(page);
    await (await hoverPushOf(page, 'team-alpha', 'Alpha Team')).click();
    const gate = page.getByRole('alertdialog');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    await page.waitForTimeout(400);
    expect(jiraWrites(calls), 'no replay').toHaveLength(1);
    expect(server.state.patches).toEqual([]);
    expect(await pushEvents(page)).toEqual([]);
});

test('a user without the capacity mutation right gets no → on a mismatched card', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: sprint => ({ ...tickets({ 'Alpha Team': 20, 'Beta Team': 30 })(sprint), mutationEnabled: false }) });
    await openPlanning(page);
    await showCards(page);
    await teamCard(page, 'team-alpha').hover();
    await expect(teamCard(page, 'team-alpha').getByRole('button', { name: /^Apply / })).toHaveCount(0);
});

// G1: twelve Teams with eleven mismatches; the → idle, pending and conflict never change a card or the pinned stack.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) test(`twelve Teams at ${viewport.width}x${viewport.height}: the → idle, pending and in conflict keeps every card and the pinned stack at the idle height`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    const rest = async () => { await page.evaluate(() => document.activeElement?.blur()); await page.mouse.move(5, viewport.height - 5); await page.waitForTimeout(200); };
    const jira = heldJira();
    const server = teamsServer({ planned: g1Differ });
    await install(page, { server, selectedTeams: ['all'], scopeTeamIds: twelveTeamIds, capacityProject: 'CAP', capacity: g1Tickets, issues: twelveStories, capacityPatch: jira.handler });
    await openPlanning(page);
    await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(12);
    await page.waitForLoadState('networkidle');
    const compact = await pinnedHeights(page);
    await showCards(page);
    await rest();
    const expanded = await pinnedHeights(page);
    const baseline = await cardHeights(page);
    await expect(mismatchCards(page)).toHaveCount(11);
    const shot = async name => {
        const [card, readout] = [await teamCard(page, 'team-02').boundingBox(), await valueReadout(page).boundingBox()];
        expect(readout.x).toBeGreaterThanOrEqual(0); expect(readout.x + readout.width).toBeLessThanOrEqual(viewport.width);
        if (viewport.width === 1440) await page.screenshot({ path: `tmp/planning-323-every-team/task6/after/${name}.png`, fullPage: false });
        else await page.locator('.planning-team-capacity-cards').screenshot({ path: `tmp/planning-323-every-team/task6/spec-captures/${name}-${size}.png`, animations: 'disabled' });
        return card;
    };
    // Idle → on hover: Jira · → · pencil, the pencil's frame, a hover ring and a solid focus outline.
    const settled = async (button, ring) => {
        const box = await button.boundingBox();
        expect(box.width).toBeCloseTo(24, 0); expect(box.height).toBeCloseTo(24, 0);
        await button.hover();
        await page.waitForTimeout(150);
        expect(await button.boundingBox()).toEqual(box);
        expect(await button.evaluate(node => getComputedStyle(node).boxShadow) !== 'none', 'hover paint').toBe(ring);
        // macOS WebKit reaches buttons with Option+Tab only.
        const tab = page.context().browser().browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
        await button.focus();
        await page.keyboard.press(`Shift+${tab}`); await page.keyboard.press(tab);
        await expect(button).toBeFocused();
        expect(await button.evaluate(node => { const style = getComputedStyle(node); return [style.outlineStyle, style.outlineWidth]; })).toEqual(['solid', '2px']);
    };
    let button = await hoverPushOf(page, 'team-02', g1Name(1));
    expect(await teamCard(page, 'team-02').locator('.team-capacity-action-rail').evaluate(node => [...node.children].map(child => child.getAttribute('aria-label'))))
        .toEqual([`Open ${g1Name(1)} capacity ticket in Jira`, `Apply ${g1Name(1)} team capacity to Jira`, `Edit ${g1Name(1)} capacity`]);
    expect(await cardHeights(page), 'hovered →').toEqual(baseline);
    await expect(valueReadout(page)).toHaveText('Apply 2 SP to Jira (ticket 11 SP)');
    expect(await oneReadout(page, 'team-02'), 'with → hovered only its readout shows').toEqual({ readouts: 1, cardTooltip: 'none' });
    await shot('card-hover-push');
    await settled(button, true);
    await rest();
    // Pending: unavailable, "Applying…", the card and stack unchanged, the note in the existing slot.
    button = await hoverPushOf(page, 'team-02', g1Name(1));
    await button.click();
    await expect.poll(() => jira.held.length).toBe(1);
    expect(jira.held[0].issueKey).toBe('CAP-201');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await button.hover();
    await expect(valueReadout(page)).toHaveText('Applying…');
    expect(await cardHeights(page), 'pending').toEqual(baseline);
    await expect(pushStatus(page)).toHaveText('Applying 1 Team to Jira…');
    expect(await singleLine(pushStatus(page)), 'the pending note is whole').toBe(true);
    await shot('card-push-pending');
    await settled(button, false);
    await rest();
    expect(await pinnedHeights(page), 'expanded stack while pending').toEqual(expanded);
    await expectNoteBesideSummary(page, `pending, expanded ${size}`);
    await page.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
    await expect(pushStatus(page)).toHaveText('Applying 1 Team to Jira…');
    expect(await pinnedHeights(page), 'compact stack while pending').toEqual(compact);
    await expectNoteBesideSummary(page, `pending, compact ${size}`);
    await showCapacityDetails(page);
    await rest();
    // Conflict: the current ticket value on the readout; the card and stack unchanged.
    jira.held[0].answer(409, { error: 'capacity_conflict', currentCapacity: 12 });
    await expect(pushOf(page, 'team-02', g1Name(1))).toHaveAttribute('data-push-state', 'conflict');
    button = await hoverPushOf(page, 'team-02', g1Name(1));
    await expect(valueReadout(page)).toHaveText('Capacity changed in Jira to 12.0. Apply 2 SP again to replace it.');
    await expect(teamCard(page, 'team-02').locator('.microbar-meta'), 'the card shows Jira\'s current value').toContainText('Cap 12.0');
    expect(await oneReadout(page, 'team-02'), 'with → hovered only its readout shows').toEqual({ readouts: 1, cardTooltip: 'none' });
    expect(await cardHeights(page), 'conflict').toEqual(baseline);
    await shot('card-push-conflict');
    await settled(button, true);
    await rest();
    expect(await cardHeights(page), 'conflict at rest').toEqual(baseline);
    await expect(pushStatus(page)).toHaveText('1 Jira push needs review');
    expect(await singleLine(pushStatus(page)), 'the conflict note is whole').toBe(true);
    expect(await pinnedHeights(page), 'expanded stack with the conflict note').toEqual(expanded);
    await expectNoteBesideSummary(page, `conflict, expanded ${size}`);
    await page.getByRole('button', { name: 'Hide capacity details', exact: true }).click();
    await expect(pushStatus(page)).toHaveText('1 Jira push needs review');
    expect(await pinnedHeights(page), 'compact stack with the conflict note').toEqual(compact);
    await expectNoteBesideSummary(page, `conflict, compact ${size}`);
    expect(await page.locator('.planning-team-capacity-cards .team-capacity-action-rail').evaluateAll(rails => Math.max(...rails.map(rail => rail.children.length)))).toBeLessThanOrEqual(3);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('after a push conflict the card\'s Cap line shows Jira\'s current value, nothing is stored, and the Jira pencil expects that value', async ({ page }) => {
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    const jira = heldJira();
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), capacityPatch: jira.handler });
    await openPlanning(page);
    await showCards(page);
    await expect(teamCard(page, 'team-alpha').locator('.microbar-meta')).toContainText('Cap 20.0');
    await (await hoverPushOf(page, 'team-alpha', 'Alpha Team')).click();
    await expect.poll(() => jira.held.length).toBe(1);
    jira.held[0].answer(409, { error: 'capacity_conflict', currentCapacity: 22 });
    await expect(pushOf(page, 'team-alpha', 'Alpha Team')).toHaveAttribute('data-push-state', 'conflict');
    await expect(teamCard(page, 'team-alpha').locator('.microbar-meta')).toContainText('Cap 22.0');
    await page.waitForTimeout(200);
    expect(server.state.patches, 'display only: the stored number is not written').toEqual([]);
    await teamCard(page, 'team-alpha').hover();
    await teamCard(page, 'team-alpha').getByRole('button', { name: 'Edit Alpha Team capacity' }).click();
    const input = teamCard(page, 'team-alpha').getByRole('spinbutton', { name: 'Alpha Team Jira total planned capacity' });
    await expect(input).toHaveValue('22');
    await input.fill('15');
    await teamCard(page, 'team-alpha').getByRole('button', { name: 'Save Alpha Team capacity' }).click();
    await expect.poll(() => jira.held.length).toBe(2);
    expect(jira.held[1].body).toMatchObject({ capacity: 15, expectedCapacity: 22, teamName: 'Alpha Team' });
    expect(jiraWrites(calls)).toHaveLength(2);
    // The editor's save lands: the conflict is over, the card shows Jira's new value and → follows the new comparison.
    jira.held[1].answer(200, { issueKey: 'CAP-101', teamName: 'Alpha Team', previousCapacity: 22, capacity: 15, result: 'success' });
    await expect(teamCard(page, 'team-alpha').locator('.team-capacity-editor')).toHaveCount(0);
    await expect(teamCard(page, 'team-alpha').locator('.microbar-meta')).toContainText('Cap 15.0');
    await expect(pushStatus(page), 'the push note is gone').toHaveCount(0);
    await expect.poll(() => server.state.patches.length).toBe(1);
    expect(server.state.patches[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '15', source: 'jira' }, changes: [] });
    await expect(mismatchCards(page)).toHaveCount(0);
    await page.mouse.move(5, 600);
    await teamCard(page, 'team-alpha').hover();
    await expect(pushOf(page, 'team-alpha', 'Alpha Team'), 'stored 15 equals Jira 15: no push').toHaveCount(0);
    expect(jiraWrites(calls)).toHaveLength(2);
});

test('leaving Planning while a push is in flight and another Team\'s editor is open does not block the automatic Planning refresh afterwards', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    const jira = heldJira();
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: tickets({ 'Alpha Team': 20, 'Beta Team': 30 }), capacityPatch: jira.handler });
    await openPlanning(page);
    await showCards(page);
    await page.waitForLoadState('networkidle');
    await (await hoverPushOf(page, 'team-alpha', 'Alpha Team')).click();
    await expect.poll(() => jira.held.length).toBe(1);
    await teamCard(page, 'team-beta').hover();
    await teamCard(page, 'team-beta').getByRole('button', { name: 'Edit Beta Team capacity' }).click();
    await expect(teamCard(page, 'team-beta').locator('.team-capacity-editor')).toHaveCount(1);
    // Let the editor's scheduled autofocus finish before moving focus to the mode control.
    await expect(teamCard(page, 'team-beta').getByRole('spinbutton', { name: 'Beta Team Jira total planned capacity' })).toBeFocused();
    // Leave by keyboard, so no outside pointer-down closes Beta's editor first.
    const modes = page.locator('.view-selector .eng-mode-control');
    await modes.getByRole('radio', { name: 'Catch Up', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.planning-team-capacity-cards')).toHaveCount(0);
    jira.held[0].answer(200, { issueKey: 'CAP-101', teamName: 'Alpha Team', capacity: 14, result: 'success' });
    await page.waitForTimeout(200);
    await modes.getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const since = calls.length;
    await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name').length, 'the automatic Planning refresh runs').toBeGreaterThan(0);
});


// ---- #323 Task 7: refresh and scope changes that preserve working state ----------------------------------------

// Another writer stores `value` for a Team in the selected Sprint (the next full GET and batch read see it).
function storeOn(server, teamId, value) {
    const key = `${futureSprintId}|${teamId}`;
    const own = server.state.docs[key] || { revision: 0, rows: [], planned: null };
    own.planned = { value, source: 'user' }; own.revision += 1;
    server.state.docs[key] = own;
}
const headerRefresh = page => page.locator('[aria-label="Refresh tasks and sprints from Jira"]');
const settled = async page => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(300); };
const threeTeams = ['team-alpha', 'team-beta', 'team-gamma'];

test('request ledger: two Teams\' automatic follow-up and header Refresh each read the stored numbers with one batch read and no document GET', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6' } });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-beta', '6.0');
    await settled(page);
    // The automatic window first: in this fixture a return right after a header Refresh starts no Planning refresh.
    let since = calls.length;
    storeOn(server, 'team-alpha', '15');
    await lifecycle.returnAfter(13 * 60000);
    await storedOn(page, 'team-alpha', '15.0');
    await settled(page);
    expect(batchReads(calls, since).map(call => [...call.body.teamIds].sort()), 'automatic follow-up: one batch read').toEqual([twoTeams]);
    expect(assigneeCalls(calls, since), 'automatic follow-up: no document GET').toEqual([]);
    since = calls.length;
    storeOn(server, 'team-beta', '9');
    await headerRefresh(page).click();
    await storedOn(page, 'team-beta', '9.0');
    await settled(page);
    expect(batchReads(calls, since).map(call => [...call.body.teamIds].sort()), 'header Refresh: one batch read').toEqual([twoTeams]);
    expect(assigneeCalls(calls, since), 'header Refresh: no document GET').toEqual([]);
    expect(calls.filter(call => call.method === 'PATCH'), 'nothing is written').toEqual([]);
});

test('request ledger: one Team\'s automatic follow-up and header Refresh each use its full GET and no batch read', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = teamsServer({ planned: { 'team-alpha': '14' } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-alpha', '14.0');
    await settled(page);
    let since = calls.length;
    storeOn(server, 'team-alpha', '17');
    await lifecycle.returnAfter(13 * 60000);
    await storedOn(page, 'team-alpha', '17.0');
    await settled(page);
    expect(assigneeCalls(calls, since).map(call => call.method), 'automatic follow-up: one full GET').toEqual(['GET']);
    expect(batchReads(calls, since)).toEqual([]);
    since = calls.length;
    storeOn(server, 'team-alpha', '16');
    await headerRefresh(page).click();
    await storedOn(page, 'team-alpha', '16.0');
    await settled(page);
    expect(assigneeCalls(calls, since).map(call => call.method), 'header Refresh: one full GET').toEqual(['GET']);
    expect(batchReads(calls, since)).toEqual([]);
});

test('header Refresh with one editor open, another Team failed and the rest clean: the clean Team refreshes, the editor keeps its text, focus and scroll, and the failed draft stays', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6', 'team-gamma': '5' }, patchStatus: teamId => (teamId === 'team-beta' ? 503 : 0) });
    const { calls } = await install(page, { server, selectedTeams: threeTeams, scopeTeamIds: threeTeams, capacityProject: 'CAP', capacity: noTicket, issues: gammaStories });
    await openPlanning(page);
    await showCards(page);
    await typeTeamNumber(page, 'team-beta', 'Beta Team', '7');
    await expect(teamCard(page, 'team-beta')).toHaveAttribute('data-capacity-attention', 'failed');
    await teamCard(page, 'team-alpha').hover();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    const input = teamInput(page, 'team-alpha', 'Alpha Team');
    await input.fill('12');
    await expect(input).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 120));
    const scrollY = await page.evaluate(() => window.scrollY);
    await settled(page);
    const patches = server.state.patches.length;
    const since = calls.length;
    storeOn(server, 'team-alpha', '20'); storeOn(server, 'team-beta', '30'); storeOn(server, 'team-gamma', '8');
    // No pointer: the Refresh is clicked without moving focus out of the open editor.
    await headerRefresh(page).dispatchEvent('click');
    await storedOn(page, 'team-gamma', '8.0');
    await settled(page);
    expect(batchReads(calls, since), 'the header Refresh is not blocked by a busy Team').toHaveLength(1);
    await expect(input, 'the editor stays open with its text').toHaveValue('12');
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => window.scrollY), 'the scroll position is kept').toBe(scrollY);
    // The open editor hides every card's rail state; the overview note still tells the failure, and the card shows the draft.
    await expect(overviewStatus(page)).toHaveText('1 Team save failed: hover a card to retry');
    await storedOn(page, 'team-beta', '7.0');
    await input.press('Escape');
    await expect(teamCard(page, 'team-beta')).toHaveAttribute('data-capacity-attention', 'failed');
    await storedOn(page, 'team-alpha', '20.0');
    expect(server.state.patches.length, 'the refresh writes nothing').toBe(patches);
    expect(jiraWrites(calls)).toEqual([]);
});

test('an automatic follow-up while a card editor is open does not run, and runs once the editor closes', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6' } });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    await showCards(page);
    await storedOn(page, 'team-beta', '6.0');
    await settled(page);
    await teamCard(page, 'team-alpha').hover();
    await teamPencil(page, 'team-alpha', 'Alpha Team').click();
    const input = teamInput(page, 'team-alpha', 'Alpha Team');
    await input.fill('12');
    const since = calls.length;
    storeOn(server, 'team-beta', '9');
    await lifecycle.returnAfter(13 * 60000);
    await page.waitForTimeout(800);
    expect(taskReads(calls, since), 'the open editor blocks the automatic Planning refresh').toEqual([]);
    expect(batchReads(calls, since)).toEqual([]);
    await expect(input).toHaveValue('12');
    await input.press('Escape');
    await expect(teamCard(page, 'team-alpha').locator('.team-capacity-editor')).toHaveCount(0);
    await storedOn(page, 'team-beta', '9.0');
    await settled(page);
    expect(batchReads(calls, since), 'it runs after the editor closes').toHaveLength(1);
    expect(server.state.patches).toEqual([]);
});

test('a failed stored-number read keeps the numbers, says so in the overview state note and enables no pencil; the next Refresh clears the note and recovers with no PATCH', async ({ page }) => {
    let failRead = false;
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6' } });
    const batch = server.batch;
    server.batch = route => (failRead ? json(route, { error: 'review_unavailable' }, 503) : batch(route));
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket });
    await openPlanning(page);
    // The compact row before any capacity note, measured in this engine: a note never changes its height.
    const compactRow = (await page.locator('.planning-panel').boundingBox()).height;
    await showCards(page);
    await storedOn(page, 'team-alpha', '14.0');
    await teamCard(page, 'team-alpha').hover();
    await expect(teamPencil(page, 'team-alpha', 'Alpha Team')).toBeEnabled();
    await settled(page);
    failRead = true;
    const since = calls.length;
    await headerRefresh(page).click();
    await expect.poll(() => batchReads(calls, since).length).toBe(1);
    await settled(page);
    for (const [teamId, name, value] of [['team-alpha', 'Alpha Team', '14.0'], ['team-beta', 'Beta Team', '6.0']]) {
        await storedOn(page, teamId, value);
        await teamCard(page, teamId).hover();
        await expect(teamPencil(page, teamId, name), `${teamId}: no pencil is enabled over a failed read`).toBeDisabled();
    }
    // The failure is told in the action row's existing state note (no added line), expanded and compact.
    const note = page.locator('.planning-panel .planning-actions > .planning-review-state-note');
    await expect(note).toHaveText('Capacity could not be refreshed. Retry before editing.');
    await expect(addedStatusLine(page)).toHaveCount(0);
    await hideDetails(page);
    await expect(note).toHaveText('Capacity could not be refreshed. Retry before editing.');
    expect((await page.locator('.planning-panel').boundingBox()).height, 'compact row with the note').toBe(compactRow);
    await showCards(page);
    failRead = false;
    storeOn(server, 'team-beta', '9');
    await headerRefresh(page).click();
    await storedOn(page, 'team-beta', '9.0');
    await expect(page.locator('.planning-panel .planning-actions > .planning-review-state-note', { hasText: 'could not be refreshed' }), 'a successful read clears the note').toHaveCount(0);
    await teamCard(page, 'team-alpha').hover();
    await expect(teamPencil(page, 'team-alpha', 'Alpha Team')).toBeEnabled();
    await settled(page);
    expect(server.state.patches, 'recovery writes nothing').toEqual([]);
    expect(calls.filter(call => call.method === 'PATCH')).toEqual([]);
});

// MRT009: an automatic refresh that changes a Team's stored number keeps the pinned stack, the docked header and the
// reading position, for Epic and for Story rows.
const manyEpics = Array.from({ length: 30 }, (_, index) => ({ ...epic, id: String(7100 + index), key: `PLAN-E${index + 1}`, summary: `Synthetic epic ${index + 1}` }));
const manyEpicStories = manyEpics.flatMap((item, index) => [0, 1].map(offset => {
    const base = story(`PLAN-${100 + index * 2 + offset}`, 'acc-ann', 'Ann Synthetic', 1 + offset, { team: offset ? 'team-beta' : 'team-alpha' });
    return { ...base, fields: { ...base.fields, epicKey: item.key, parentSummary: item.summary } };
}));
for (const rows of ['Epics', 'Stories']) test(`an automatic stored-number refresh keeps the sticky offsets and the reading position (${rows} rows, 1280x720)`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = teamsServer({ planned: { 'team-alpha': '14', 'team-beta': '6' } });
    const { calls } = await install(page, { server, selectedTeams: twoTeams, capacityProject: 'CAP', capacity: noTicket, issues: manyEpicStories, epics: manyEpics });
    await openPlanning(page);
    await page.getByRole('radio', { name: rows, exact: true }).click();
    await expect(page.locator('.planning-review-table tbody tr[data-issue-key]').nth(20)).toBeAttached();
    await settled(page);
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(page.locator('.planning-review-docked-header')).toBeVisible();
    const read = () => page.evaluate(() => {
        const stack = document.querySelector('.planning-review-sticky-stack').getBoundingClientRect();
        const docked = document.querySelector('.planning-review-docked-header').getBoundingClientRect();
        const row = [...document.querySelectorAll('table.planning-review-table:not(.planning-review-docked-table) tbody tr[data-issue-key]')].find(node => node.getBoundingClientRect().top >= docked.bottom);
        return { stackTop: Math.round(stack.top), stackBottom: Math.round(stack.bottom), dockedTop: Math.round(docked.top), scrollY: Math.round(window.scrollY), key: row.dataset.issueKey, rowTop: Math.round(row.getBoundingClientRect().top) };
    });
    // The docked header re-measures on the next frame after the scroll moves the stack (WebKit reads it a frame later).
    await expect.poll(async () => { const { dockedTop, stackBottom } = await read(); return dockedTop === stackBottom; }, 'the docked header sits under the stack').toBe(true);
    const before = await read();
    await expect(page.locator('.planning-panel .planning-actions > .planning-stats')).toContainText('Cap 20.0 SP');
    const since = calls.length;
    storeOn(server, 'team-beta', '9');
    await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => batchReads(calls, since).length, 'the automatic follow-up read the stored numbers').toBe(1);
    // The new number is rendered: the card and the compact overview's Cap total.
    await storedOn(page, 'team-beta', '9.0');
    await expect(page.locator('.planning-panel .planning-actions > .planning-stats')).toContainText('Cap 23.0 SP');
    await settled(page);
    expect(await read(), `${rows}: pinned stack, docked header and reading position`).toEqual(before);
    await page.screenshot({ path: `tmp/planning-323-every-team/task7/reading-position-${rows.toLowerCase()}-1280x720.png`, animations: 'disabled' });
});

// Task R (#323): the Epics/Stories choice survives data reloads (the table unmounts while ENG loads); a page reload starts over.
const refreshHeader = page => page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
async function expectStoriesRows(page) {
    await expect(rowsButton(page, 'Stories')).toHaveAttribute('aria-checked', 'true');
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['story']);
}

test('a chosen Stories view survives the header Refresh and a Sprint switch and back, with no row-mode event from the restore', async ({ page }) => {
    const server = capacityServer();
    await install(page, { server, analytics: true });
    await openPlanning(page);
    await rowsButton(page, 'Stories').click();
    await expectStoriesRows(page);
    await expect.poll(() => rowModeEvents(page)).toBe(1);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await refreshHeader(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expectStoriesRows(page);
    expect(await rowModeEvents(page), 'the restore after Refresh emits nothing').toBe(1);
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: activeSprintName }).click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expectStoriesRows(page);
    expect(await rowModeEvents(page), 'the restore after a Sprint switch emits nothing').toBe(1);
});

test('a chosen Epics view with the strip collapsed stays Epics after a reload; no choice stays the Epics default', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    await install(page, { server, analytics: true });
    await openPlanning(page);
    // No choice made: Epics after a data reload.
    await refreshHeader(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['epic']);
    // Open the strip (Stories), then choose Epics: the strip collapses and the choice is Epics.
    await expand(page);
    await expectStoriesRows(page);
    await rowsButton(page, 'Epics').click();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await refreshHeader(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['epic']);
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
});

test('each new choice, Stories then Epics, is the one a data reload restores', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    await install(page, { server, analytics: true });
    await openPlanning(page);
    await rowsButton(page, 'Stories').click();
    await expectStoriesRows(page);
    await refreshHeader(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expectStoriesRows(page);
    await rowsButton(page, 'Epics').click();
    await expect.poll(() => reviewRowKinds(page)).toEqual(['epic']);
    await refreshHeader(page);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expect(rowsButton(page, 'Epics')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => reviewRowKinds(page)).toEqual(['epic']);
});
