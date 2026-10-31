const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const earlierSprintName = '2026Q2 Sprint 9';
const caps = { canRead: true, canSave: true };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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

async function install(page, { server, selectedTeams = ['team-alpha'], scopeTeamIds = ['team-alpha', 'team-beta'], prefs = {}, capacityProject = '', issues = stories, capacity = defaultCapacity, authMode = 'basic', analytics = false, people = defaultPeople } = {}) {
    const calls = [];
    await installDashboardShell(page);
    await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), { planningLayout: 'table', selectedTeams, activeGroupId: 'group-alpha', ...prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({ method: request.method(), pathname: url.pathname, body: request.method() === 'GET' ? null : requestBody(request) });
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
            return json(route, { issues: product ? issues : [], epics: { [epic.key]: epic }, epicsInScope: product ? [epic] : [], names: {} });
        }
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity$/.test(url.pathname)) return server.handler(route);
        if (url.pathname === '/api/eng/assignee-capacity/user-options' && request.method() === 'POST') return json(route, people(requestBody(request)?.query));
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(url.pathname)) return json(route, { schemaVersion: 1, sprintId: String(futureSprintId), schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: true } });
        if (/\/review\/values\/read$/.test(url.pathname)) return json(route, { cells: [], unavailableIssueIds: [] });
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

test('two Teams and All Teams keep the old cards and show no strip', async ({ page }) => {
    for (const selectedTeams of [['team-alpha', 'team-beta'], ['all']]) {
        const server = capacityServer();
        await install(page, { server, selectedTeams });
        await openPlanning(page);
        await expect(page.locator('.planning-panel-team-details')).toHaveCount(1);
        await expect(strip(page)).toHaveCount(0);
        expect(server.state.gets).toBe(0);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
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
    expect([ann[1], ann[3], ann[4], ann[5]]).toEqual(['8', '5', '1', 'away Friday']);
    expect((await cells('unassigned'))[3]).toBe('4');
    // Total effort (non-Killed Stories of the Team) = people + Unassigned = 14; Capacity 11; Vacations 1.
    const totals = await table(page).locator('tfoot td').evaluateAll(tds => tds.map(td => td.textContent.trim()));
    expect([totals[0], totals[1], totals[3], totals[4]]).toEqual(['Total', '11', '14', '1']);
    // The identity: every row's Total plus Unassigned is the Total.
    const rowTotals = await table(page).locator('tbody tr').evaluateAll(trs => trs.map(tr => Number(tr.children[3].textContent)));
    expect(rowTotals.reduce((sum, value) => sum + value, 0)).toBe(14);
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
    expect(measure.headers.filter(header => ['Capacity', 'Selected effort', 'Total effort', 'Vacations'].includes(header.text)).map(header => header.align)).toEqual(['right', 'right', 'right', 'right']);
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
// 12 + 10 + Unassigned 4 = 26 against Team Cap 20: overflows by 6.
const overflowRows = [
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
    expect(after.panel).toBeLessThan(64);
    expect(after.stack).toBeCloseTo(before.stack, 0);
    expect(after.stack).toBeLessThanOrEqual(175);
    expect(server.state.gets).toBe(1);
});

test('DoD 3 and 9: the table\'s Selected total equals the bar\'s Selected for the Team, and the team number is read from the pinned bar', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    const footer = await table(page).locator('tfoot td').evaluateAll(tds => tds.map(td => td.textContent.trim()));
    const compact = await page.locator('.planning-panel-capacity-graph .planning-compact-readout').textContent();
    const [, barSelected, teamNumber] = /tasks · ([\d.]+) SP \/ ([\d.]+) cap/.exec(compact);
    expect(Number(footer[2])).toBe(Number(barSelected));
    expect(Number(barSelected)).toBe(14);
    // The hover readout's header carries the same Selected number.
    await segments(page).nth(0).hover();
    await expect(readout(page)).toContainText(`Selected 4 tasks · ${Number(barSelected).toFixed(1)} SP`);
    // The team number lives on the pinned bar only: compact readout, Team Cap marker; no table column carries it.
    expect(Number(teamNumber)).toBe(20);
    await page.mouse.move(5, 400);
    await showPanel(page).click();
    await expect(page.locator('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label')).toHaveText(/Team Cap\s*20\.0/);
    const headers = await table(page).locator('thead th').evaluateAll(ths => ths.map(th => th.textContent.trim()));
    expect(headers).toEqual(['Assignee', 'Capacity', 'Selected effort', 'Total effort', 'Vacations', 'Notes']);
    expect(Number(footer[1]), 'the Capacity sum is the people, not the team number').toBe(14);
});

test('segments are one per person with Capacity plus Unassigned, distinct, on the bar axis (lined up with Team Cap), and the readout stays on screen', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    const unassignedTotal = Number((await rowOf(page, 'unassigned').locator('td').nth(3).textContent()).trim());
    const measure = await page.evaluate(() => {
        const track = document.querySelector('[data-assignee-underbar] .stacked-bar-track').getBoundingClientRect();
        const outer = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
        const cap = document.querySelector('.planning-panel-capacity-graph .capacity-bar-marker.teamcap').getBoundingClientRect();
        return { trackWidth: track.width, trackHeight: track.height, outerBottom: outer.bottom, trackBottom: track.bottom, outerHeight: outer.height,
            capX: cap.left + cap.width / 2 - track.left,
            segments: [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => ({ label: node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, color: getComputedStyle(node).backgroundColor })) };
    });
    expect(measure.trackHeight).toBeGreaterThanOrEqual(4); expect(measure.trackHeight).toBeLessThanOrEqual(6);
    expect(measure.trackBottom).toBeLessThanOrEqual(measure.outerBottom + 0.5);
    expect(new Set(measure.segments.map(segment => segment.color)).size).toBe(3);
    // Revision 4 axis: max(capacity 20, selected 14, people 8 + 6 + Unassigned 4) x 1.15 = 23 (revision 3 used 20 here),
    // and the segments are on the Team Cap marker's scale: Ann ends at 8/20 of the marker's x.
    expect(measure.segments[0].width / measure.trackWidth).toBeCloseTo(8 / 23, 2);
    expect(measure.segments[1].width / measure.trackWidth).toBeCloseTo(6 / 23, 2);
    expect(measure.segments[2].label).toContain('Unassigned (effort)');
    expect(measure.segments[2].width / measure.trackWidth).toBeCloseTo(unassignedTotal / 23, 2);
    expect(measure.capX / measure.trackWidth).toBeCloseTo(20 / 23, 2);
    expect(measure.segments[0].width / measure.capX).toBeCloseTo(8 / 20, 2);
    await expect(underbar(page).locator('[data-assignee-overflow]')).toHaveCount(0);
    const before = await page.locator('.planning-panel').boundingBox();
    await segments(page).nth(2).hover();
    await expect(readout(page)).toContainText('Unassigned (effort)');
    await expect(readout(page)).toContainText(`Total ${unassignedTotal}`);
    await expectReadoutInViewport(page);
    expect(await page.locator('.planning-panel').boundingBox()).toEqual(before);
    expect(await readout(page).evaluate(node => node.hasAttribute('title') || node.closest('[title]') !== null)).toBe(false);
    await segments(page).nth(0).hover();
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expect(readout(page)).toContainText('Capacity 8');
    await expectReadoutInViewport(page);
    await page.mouse.move(5, 400);
    await expect(readout(page)).toHaveCount(0);
});

for (const [width, height] of [[1440, 900], [1280, 720]]) for (const [name, rows] of [['normal', underbarRows], ['overflow', overflowRows]]) test(`the underbar adds no height to the compact panel or the pinned stack at ${width}x${height} (${name})`, async ({ page }) => {
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
            await expect(readout(page)).toContainText('Selected 4 tasks · 14.0 SP');
        }
    }
    await expect(readout(page)).toContainText('Total 4 · Selected 4');
    await expect(readout(page)).toContainText('Team capacity: Jira');
    // Past the last segment and off the marker: the header-only readout.
    const pastX = (unassigned.right + geometry.marker.left) / 2;
    expect(pastX).toBeGreaterThan(unassigned.right + 2);
    await page.mouse.move(pastX, geometry.track.top + 3);
    await expect(readout(page)).toHaveText('Selected 4 tasks · 14.0 SP');
    await page.mouse.move(geometry.track.right - 3, geometry.track.top + 3);
    await expect(readout(page)).toHaveText('Selected 4 tasks · 14.0 SP');
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
    await expect.poll(() => marker.evaluate(shownTooltip)).toContain('Team capacity');
    await expect(readout(page)).toHaveCount(0);
    // A segment's own pixels stay topmost under the strip (no fill above them).
    const topmost = await page.evaluate(() => [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === node;
    }));
    expect(topmost).toEqual([true, true, true]);
});

const overflowMark = page => underbar(page).locator('[data-assignee-overflow]');
const showPanel = page => page.locator('.planning-panel').getByRole('button', { name: 'Show panel' });

test('people plus Unassigned above Team Cap draw an overflow mark from the marker to the strip end, labelled "+6 SP over" in the expanded panel and in the compact readout', async ({ page }) => {
    const server = capacityServer({ rows: overflowRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    // 12 + 10 + Unassigned 4 = 26 against Team Cap 20; selected 14 is under, so the bar has no over zone of its own.
    await expect(overflowMark(page)).toHaveCount(1);
    await expect(page.locator('.planning-panel .capacity-bar-variance-zone.visible')).toHaveCount(0);
    // Compact: no label, the compact readout carries the overflow.
    await expect(overflowMark(page).locator('.capacity-bar-fill-label')).toHaveCount(0);
    await expect(page.locator('.planning-panel-capacity-graph .planning-compact-readout')).toHaveText('4 tasks · 14.0 SP / 20.0 cap · +6 SP over');
    expect(await page.locator('.planning-panel-capacity-graph .planning-compact-readout').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const measure = () => page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
        const segmentsList = [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(rect);
        const line = rect(document.querySelector('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-line'));
        const capLabel = document.querySelector('.planning-panel .capacity-bar-marker.teamcap .capacity-bar-marker-label');
        const label = document.querySelector('[data-assignee-overflow] .capacity-bar-fill-label');
        return { mark: rect(document.querySelector('[data-assignee-overflow]')), stripEnd: segmentsList[segmentsList.length - 1].right, capX: line.left + line.width / 2,
            track: rect(document.querySelector('.planning-panel-capacity-graph .capacity-bar-track')),
            capLabel: capLabel ? rect(capLabel) : null, label: label ? { ...rect(label), text: label.textContent, clipped: label.scrollWidth > label.clientWidth + 1 } : null };
    });
    for (const mode of ['compact', 'expanded']) {
        if (mode === 'expanded') { await showPanel(page).click(); await page.evaluate(() => document.activeElement?.blur()); await expect(overflowMark(page).locator('.capacity-bar-fill-label')).toHaveCount(1); }
        const m = await measure();
        expect(m.mark.left, mode).toBeCloseTo(m.capX, 0);
        expect(m.mark.right, mode).toBeCloseTo(m.stripEnd, 0);
        expect((m.mark.right - m.mark.left) / m.track.width, mode).toBeCloseTo(6 / (26 * 1.15), 2);
        if (mode === 'expanded') {
            expect(m.label.text).toBe('+6 SP over');
            // At the mark's end, inside the track, never overlapping the Team Cap label below the track.
            expect(m.label.left).toBeGreaterThanOrEqual(m.mark.right); expect(m.label.left).toBeLessThan(m.mark.right + 8);
            expect(m.label.top).toBeGreaterThanOrEqual(m.track.top - 0.5); expect(m.label.bottom).toBeLessThanOrEqual(m.track.bottom + 0.5);
            expect(m.label.right).toBeLessThanOrEqual(m.track.right);
            const overlaps = !(m.label.right <= m.capLabel.left || m.label.left >= m.capLabel.right || m.label.bottom <= m.capLabel.top || m.label.top >= m.capLabel.bottom);
            expect(overlaps).toBe(false);
            expect(m.label.clipped).toBe(false);
        }
        await page.mouse.move(5, 400);
        await page.mouse.move(m.stripEnd - 3, m.track.top + 3);
        await expect(readout(page)).toContainText('Unassigned (effort)');
        await expect(readout(page)).toContainText('+6 SP over Team Cap');
        await expectReadoutInViewport(page);
        await page.mouse.move(5, 400);
        await page.screenshot({ path: `tmp/slice1-shots/strip-overflow-${mode}.png`, clip: await page.locator('.planning-panel').boundingBox(), animations: 'disabled' });
    }
});

test('the overflow mark is hidden while the bar draws its own over-capacity zone', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    // Team Cap 10: selected 14 is above 120%, so the bar is over; people 8 + 6 + Unassigned 4 = 18 would overflow by 8.
    await page.route('**/api/capacity?*', route => json(route, { enabled: true, mutationEnabled: false, sprint: new URL(route.request().url()).searchParams.get('sprint'), capacities: { 'Alpha Team': 10 }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: 10 }] }));
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    await expect(page.locator('.planning-panel .capacity-bar-variance-zone.visible')).toHaveCount(1);
    await expect(overflowMark(page)).toHaveCount(0);
    await expect(page.locator('.planning-panel-capacity-graph .planning-compact-readout')).toHaveText('4 tasks · 14.0 SP / 10.0 cap');
    await segments(page).nth(0).hover();
    await expect(readout(page)).toContainText('Ann Synthetic');
    await expect(readout(page)).not.toContainText('over Team Cap');
    await showPanel(page).click();
    await expect(overflowMark(page)).toHaveCount(0);
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
    const server = capacityServer({ rows: overflowRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    if (mode === 'expanded') await showPanel(page).click();
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
        // Left edge (first segment, 6 lines), the strip end near the right (6 lines), the track's right end (header only), top row pixels.
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
    await showPanel(page).click();
    await expect(page.locator('.planning-panel .capacity-bar-marker-label').first()).toBeVisible();
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice1-shots/strip-normal-expanded.png', animations: 'disabled' });
    await page.locator('.team-stat-card').first().screenshot({ path: 'tmp/slice1-shots/card-bar-normal.png', animations: 'disabled' });
});

test('each person row is tinted with its underbar segment colour; rows without Capacity and Unassigned keep their own surface; geometry is unchanged', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    const measure = () => page.evaluate(() => {
        const probe = document.createElement('i');
        document.body.appendChild(probe);
        const resolve = value => { probe.style.background = value; return getComputedStyle(probe).backgroundColor; };
        const surface = getComputedStyle(document.querySelector('[data-assignee-capacity]')).getPropertyValue('--bg-secondary').trim();
        const segmentColors = Object.fromEntries([...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')]
            .map(node => [node.getAttribute('aria-label').replace(/^Assignee capacity /, '').split(': ')[0], getComputedStyle(node).backgroundColor]));
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
    for (const key of ['acc-ann', 'acc-bob']) {
        expect(withTint.rows[key].tinted, key).toBe(true);
        expect(new Set(withTint.rows[key].cellBackgrounds), key).toEqual(new Set([withTint.rows[key].expectedMix]));
        expect(withTint.rows[key].expectedMix, key).not.toBe(withTint.rows[key].plain);
    }
    expect(withTint.rows['acc-ann'].expectedMix).not.toBe(withTint.rows['acc-bob'].expectedMix);
    // No Capacity: no segment, no tint. Unassigned keeps its warning-tone row.
    expect(withTint.rows['acc-cy'].tinted).toBe(false);
    expect(new Set(withTint.rows['acc-cy'].cellBackgrounds)).toEqual(new Set([withTint.rows['acc-cy'].plain]));
    expect(new Set(withTint.rows.unassigned.cellBackgrounds)).toEqual(new Set([withTint.rows.unassigned.unassignedPlain]));
    await page.mouse.move(5, 400);
    await strip(page).scrollIntoViewIfNeeded();
    await strip(page).screenshot({ path: 'tmp/323-ui/assignee-tinted-rows.png', animations: 'disabled' });
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
    await expect.poll(() => marker.evaluate(shownTooltip)).toContain('Team capacity');
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
    // Killed Stories still count in Selected while checked (as in the capacity bar), so uncheck them first.
    await expand(page);
    await page.getByRole('checkbox', { name: 'Select PLAN-EPIC' }).first().click();
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

test('a muted line says when selected Stories of the Team are hidden by filters', async ({ page }) => {
    const server = capacityServer();
    await install(page, { server });
    await openPlanning(page);
    await expand(page);
    await expect(strip(page).locator('[data-assignee-filter-hidden]')).toHaveCount(0);
    await page.locator('.search-input:visible').fill('PLAN-3');
    await expect(strip(page).locator('[data-assignee-filter-hidden]')).toHaveText('3 selected Stories of this Team are hidden by filters and not counted in Selected effort.');
    await expect(strip(page).locator('[data-assignee-filter-hidden]')).toHaveClass(/planning-review-guidance/);
    await expect(footerSelected(page)).toHaveText(/^5/);
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
const reconcileBanner = page => page.locator('[data-capacity-reconcile]');
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
    if (await showPanel(page).count()) await showPanel(page).click();
    await expect(page.locator('.planning-team-capacity-cards')).toBeVisible();
}

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
    await expect(underbar(page)).toHaveCount(1);
    await expect(teamCap(page)).toHaveText(/Team Cap\s*14\.0/);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-source', 'planned');
    await expect(alphaCard(page)).toHaveAttribute('data-planned-source', 'user');
    await expect(alphaCard(page).locator('.microbar-meta')).toContainText('Cap 14.0');
    await page.mouse.move(5, 600);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice3-shots/bar-underbar-no-ticket.png', animations: 'disabled' });
    await underbar(page).hover({ position: { x: 4, y: 3 } });
    await expect(readout(page)).toContainText('Team capacity (not in Jira)');
    // The next Sprint has no document of its own: the number is inherited (gray) and still drives the bar.
    await page.mouse.move(5, 600);
    await switchSprint(page, futureSprintName);
    await expect(alphaCard(page)).toHaveAttribute('data-planned-source', 'inherited');
    await expect(teamCap(page)).toHaveText(/Team Cap\s*14\.0/);
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
    await expect(teamCap(page)).toHaveText(/Team Cap\s*20\.0/);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-source', 'jira');
    await hover(page, alphaCard(page));
    await expect(plannedPencil(page)).toHaveCount(0);
    await expect(alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' })).toBeVisible();
    await expect(reconcileBanner(page)).toHaveCount(0);
    await underbar(page).hover({ position: { x: 4, y: 3 } });
    await expect(readout(page)).toContainText('Team capacity: Jira');
    await page.mouse.move(5, 600);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice3-shots/bar-underbar-with-ticket.png', animations: 'disabled' });
    expect(jiraWrites(calls)).toEqual([]);
});

test('a typed number that differs from the ticket shows the banner with three actions; Write to ticket opens the prefilled Jira editor', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth', analytics: true });
    await openPlanning(page);
    await showCards(page);
    await expect(reconcileBanner(page)).toBeVisible();
    await expect(reconcileBanner(page)).toContainText('Alpha Team: Team capacity (not in Jira) is 14 SP; the Jira ticket says 20 SP.');
    await expect(reconcileBanner(page).getByRole('button')).toHaveText(['Write to ticket', 'Use ticket value', 'Not now']);
    await expect(teamCap(page), 'Jira wins on screen').toHaveText(/Team Cap\s*20\.0/);
    await page.locator('.planning-team-capacity-cards').screenshot({ path: 'tmp/slice3-shots/reconcile-banner.png', animations: 'disabled' });
    await page.mouse.move(5, 600);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/slice3-shots/bar-underbar-differing.png', animations: 'disabled' });
    expect(await capacityEvents(page)).toEqual([]);
    await reconcileBanner(page).getByRole('button', { name: 'Write to ticket' }).click();
    const jiraInput = alphaCard(page).getByRole('spinbutton', { name: 'Alpha Team Jira total planned capacity' });
    await expect(jiraInput).toHaveValue('14');
    expect(jiraWrites(calls), 'opening the editor writes nothing').toEqual([]);
    await alphaCard(page).getByRole('button', { name: 'Save Alpha Team capacity' }).click();
    await expect.poll(() => jiraWrites(calls).length).toBe(1);
    expect(jiraWrites(calls)[0].body).toMatchObject({ capacity: 14, expectedCapacity: 20, teamName: 'Alpha Team' });
    // The user's own Jira save settles the typed number: source user becomes {ticket value, jira}.
    await expect.poll(() => assigneeWrites(calls).length).toBe(1);
    expect(assigneeWrites(calls)[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '14', source: 'jira' }, changes: [] });
    await expect(reconcileBanner(page)).toHaveCount(0);
    expect(await capacityEvents(page), 'only the existing Jira editor emits capacity_* events').toEqual(['capacity_edit_open', 'capacity_change_submit', 'capacity_change_result']);
});

test('Use ticket value stores the ticket number as jira and Not now suppresses the banner, neither writing Jira', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth', analytics: true });
    await openPlanning(page);
    await showCards(page);
    await expect(reconcileBanner(page)).toBeVisible();
    await reconcileBanner(page).getByRole('button', { name: 'Not now' }).click();
    await expect(reconcileBanner(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(assigneeWrites(calls), 'Not now writes nothing').toEqual([]);
    // Not now holds per (Sprint, Team) until either number changes: a changed stored number brings it back.
    server.state.docs[String(futureSprintId)].planned = { value: '15', source: 'user' }; server.state.docs[String(futureSprintId)].revision += 1;
    await page.locator('[aria-label="Refresh tasks and sprints from Jira"]').click();
    await expect(reconcileBanner(page)).toContainText('is 15 SP');
    await reconcileBanner(page).getByRole('button', { name: 'Use ticket value' }).click();
    await expect.poll(() => assigneeWrites(calls).length).toBe(1);
    expect(assigneeWrites(calls)[0].body).toEqual({ teamId: 'team-alpha', planned: { value: '20', source: 'jira' }, changes: [] });
    await expect(reconcileBanner(page)).toHaveCount(0);
    expect(jiraWrites(calls)).toEqual([]);
    expect(await capacityEvents(page)).toEqual([]);
});

test('equal numbers, and jira or inherited sources, show no banner', async ({ page }) => {
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
        await expect(teamCap(page)).toHaveText(/Team Cap\s*20\.0/);
        await page.waitForTimeout(300);
        await expect(reconcileBanner(page), JSON.stringify(docs)).toHaveCount(0);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

test('a matched ticket with a blank value falls back to the stored number; the pencil edits Jira and the banner offers Write to ticket only', async ({ page }) => {
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    await install(page, { server, capacityProject: 'CAP', capacity: ticket(null), authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await showCards(page);
    await expect(teamCap(page)).toHaveText(/Team Cap\s*14\.0/);
    await expect(alphaCard(page)).toHaveAttribute('data-capacity-source', 'planned');
    await hover(page, alphaCard(page));
    await expect(alphaCard(page).getByRole('button', { name: 'Edit Alpha Team capacity' })).toBeVisible();
    await expect(plannedPencil(page)).toHaveCount(0);
    await expect(reconcileBanner(page)).toContainText('the Jira ticket has no value');
    await expect(reconcileBanner(page).getByRole('button')).toHaveText(['Write to ticket', 'Not now']);
});

test('read-only user: no stored-number pencil, no banner and no mirror', async ({ page }) => {
    const readOnly = { canRead: true, canSave: false };
    const server = plannedServer({ capabilities: readOnly, docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
    const { calls } = await install(page, { server, capacityProject: 'CAP', capacity: ticket(20), authMode: 'atlassian_oauth' });
    await openPlanning(page);
    await showCards(page);
    await expect.poll(() => server.state.gets).toBe(1);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
    await expect(reconcileBanner(page)).toHaveCount(0);
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

for (const [label, options] of [['List layout', { prefs: { planningLayout: 'list' } }], ['two Teams', { selectedTeams: ['team-alpha', 'team-beta'] }]]) test(`${label}: the stored number is not available, a stated limitation`, async ({ page }) => {
    {
        const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'user' }) } });
        await install(page, { server, capacityProject: 'CAP', capacity: noTicket, authMode: 'atlassian_oauth', ...options });
        await openPlanning(page);
        await showCards(page);
        await expect(alphaCard(page)).toBeVisible();
        await page.waitForTimeout(400);
        expect(server.state.gets, JSON.stringify(options)).toBe(0);
        await expect(capacityTrack(page)).toHaveCount(0);
        await expect(alphaCard(page)).not.toHaveAttribute('data-capacity-source', /./);
        await hover(page, alphaCard(page));
        await expect(plannedPencil(page)).toHaveCount(0);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
});

test('request ledger: the mirror sends at most one guarded PATCH per user-initiated load, only when the ticket differs, and none in an automatic window', async ({ page }) => {
    const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
    const lifecycle = await installLifecycleControl(page);
    const server = plannedServer({ docs: { [String(futureSprintId)]: ownDoc({ value: '14', source: 'jira' }) } });
    let ticketValue = 20;
    // Basic mode, as the other freshness tests here (with this fixture in OAuth mode the return triggered no re-read; not investigated).
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
    await expect(teamCap(page)).toHaveText(/Team Cap\s*25\.0/);
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
        await expect(capacityTrack(page)).toBeVisible();
        const after = await pinnedHeights(page);
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
// teamTasks is the Total list filter; buildAssigneeRows runs once per derived view and accumulates Total and Selected.
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
        probeBundle = text;
    });
    const many = Array.from({ length: 3000 }, (_, index) => {
        const person = index % 9;
        return person === 8 ? story(`PLAN-${index + 10}`, null, null, 1 + (index % 5))
            : story(`PLAN-${index + 10}`, `acc-p${person}`, `Person ${person} Synthetic`, 1 + (index % 5), { team: index % 10 === 9 ? 'team-beta' : 'team-alpha' });
    });
    const read = page => page.evaluate(() => ({ renders: window.__JEP_EXTRACTION_PERF__().renders, ...(window.__JEP_323_COUNTS__ || {}) }));
    async function measure(page, action) {
        await page.waitForTimeout(500);
        const before = await read(page);
        await action();
        await page.waitForTimeout(500);
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
        expect(result.teamTasks, 'the Total list is not rebuilt by a toggle').toBe(0);
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
