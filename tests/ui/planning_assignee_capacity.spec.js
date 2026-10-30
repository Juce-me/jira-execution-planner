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
function capacityServer({ inherited = null, rows = [], capabilities = caps, delayPatch = 0 } = {}) {
    const state = { revision: rows.length ? 1 : 0, rows: rows.map(row => ({ ...row })), gets: 0, patches: [] };
    const handler = async route => {
        const request = route.request();
        if (request.method() === 'GET') {
            state.gets += 1;
            return json(route, { teamId: 'team-alpha', sprintId: String(futureSprintId), revision: state.revision, rows: state.rows, inherited: state.revision ? null : inherited, capabilities });
        }
        const body = requestBody(request);
        state.patches.push({ body, headers: request.headers() });
        if (delayPatch) await new Promise(resolve => setTimeout(resolve, delayPatch));
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

async function install(page, { server, selectedTeams = ['team-alpha'], scopeTeamIds = ['team-alpha', 'team-beta'], prefs = {}, capacityProject = '' } = {}) {
    const calls = [];
    await installDashboardShell(page);
    await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), { planningLayout: 'table', selectedTeams, activeGroupId: 'group-alpha', ...prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({ method: request.method(), pathname: url.pathname });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/epm/access') return json(route, { state: 'disabled', epmHomeReadAvailable: false });
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example', capacityProject, authMode: 'basic', epmViewEnabled: false, epmHomeReadAvailable: false,
                projectsConfigured: true, userCanEditSettings: true, environmentConfigExists: true,
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', version: 1, view: { selectedView: 'eng', selectedSprint: activeSprintId, sprintName: activeSprintName, activeGroupId: 'group-alpha', showPlanning: false, showScenario: false } },
            });
        }
        if (url.pathname === '/api/capacity') return json(route, { enabled: true, mutationEnabled: false, sprint: url.searchParams.get('sprint'), capacities: { 'Alpha Team': 20 }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: 20 }] });
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
            return json(route, { issues: product ? stories : [], epics: { [epic.key]: epic }, epicsInScope: product ? [epic] : [], names: {} });
        }
        if (/^\/api\/eng\/sprints\/[^/]+\/assignee-capacity$/.test(url.pathname)) return server.handler(route);
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(url.pathname)) return json(route, { schemaVersion: 1, sprintId: String(futureSprintId), schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: true } });
        if (/\/review\/values\/read$/.test(url.pathname)) return json(route, { cells: [], unavailableIssueIds: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
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

const strip = page => page.locator('[data-assignee-capacity]');
const stripToggle = page => strip(page).locator('.capacity-header-toggle');
const table = page => strip(page).locator('table.planning-assignee-table');
const rowOf = (page, key) => table(page).locator(`tbody tr[data-assignee-key="${key}"]`);
async function expand(page) { await stripToggle(page).click(); await expect(table(page)).toBeVisible(); }
const names = page => table(page).locator('tbody tr td.planning-assignee-name').evaluateAll(cells => cells.map(cell => cell.textContent.trim()));

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

test('one Team shows a collapsed strip that fetches on first expansion only', async ({ page }) => {
    const server = capacityServer({ rows: [{ assigneeKey: 'acc-ann', displayName: 'Ann Synthetic', capacity: '8', vacations: null, notes: null, removed: false }] });
    const { calls } = await install(page, { server });
    await openPlanning(page);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toHaveClass(/capacity-panel-collapsed/);
    await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    expect(calls.filter(call => call.pathname.endsWith('/assignee-capacity'))).toHaveLength(0);
    await expand(page);
    expect(server.state.gets).toBe(1);
    await stripToggle(page).click(); await expect(stripToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await stripToggle(page).click(); await expect(table(page)).toBeVisible();
    expect(server.state.gets, 'collapse and re-expand fetch nothing').toBe(1);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('jep.planningAssigneeCapacityExpanded'))).toBe('1');
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
    await expect(strip(page).getByText(`Inherited from ${earlierSprintName}`)).toHaveCount(1);
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
    await expect(strip(page).locator('.planning-assignee-removed')).toHaveText(/Removed from this Sprint:\s*Cy Former/);
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
const underbar = page => page.locator('.planning-panel [data-assignee-underbar]');
const segments = page => underbar(page).locator('.stacked-bar-segment');
const readout = page => page.locator('.stacked-bar-readout');
async function expectReadoutInViewport(page) {
    const viewport = page.viewportSize();
    const box = await readout(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test('the underbar is absent until the strip has been expanded once, then stays', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expect(page.locator('.planning-panel-capacity-graph .capacity-bar-track')).toBeVisible();
    await expect(underbar(page)).toHaveCount(0);
    await expand(page);
    await expect(underbar(page)).toHaveCount(1);
    await stripToggle(page).click();
    await expect(underbar(page)).toHaveCount(1);
});

test('segments are one per person with Capacity plus Unassigned, distinct, proportional, and the readout stays on screen', async ({ page }) => {
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    await expand(page);
    await expect(segments(page)).toHaveCount(3);
    const unassignedTotal = Number((await rowOf(page, 'unassigned').locator('td').nth(3).textContent()).trim());
    const measure = await page.evaluate(() => {
        const track = document.querySelector('[data-assignee-underbar] .stacked-bar-track').getBoundingClientRect();
        const outer = document.querySelector('.planning-panel-capacity-graph .capacity-bar-track').getBoundingClientRect();
        return { trackWidth: track.width, trackHeight: track.height, outerBottom: outer.bottom, trackBottom: track.bottom, outerHeight: outer.height,
            segments: [...document.querySelectorAll('[data-assignee-underbar] .stacked-bar-segment')].map(node => ({ label: node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, color: getComputedStyle(node).backgroundColor })) };
    });
    expect(measure.trackHeight).toBeGreaterThanOrEqual(4); expect(measure.trackHeight).toBeLessThanOrEqual(6);
    expect(measure.trackBottom).toBeLessThanOrEqual(measure.outerBottom + 0.5);
    expect(new Set(measure.segments.map(segment => segment.color)).size).toBe(3);
    expect(measure.segments[0].width / measure.trackWidth).toBeCloseTo(8 / 20, 2);
    expect(measure.segments[1].width / measure.trackWidth).toBeCloseTo(6 / 20, 2);
    expect(measure.segments[2].label).toContain('Unassigned (effort)');
    expect(measure.segments[2].width / measure.trackWidth).toBeCloseTo(unassignedTotal / 20, 2);
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

for (const [width, height] of [[1440, 900], [1280, 720]]) test(`the underbar adds no height to the compact panel or the pinned stack at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = capacityServer({ rows: underbarRows });
    await install(page, { server, capacityProject: 'CAP' });
    await openPlanning(page);
    const withoutBar = (await page.locator('.planning-panel').boundingBox()).height;
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
    await segments(page).nth(1).tap();
    await expect(readout(page)).toContainText('Bob Synthetic');
    await expectReadoutInViewport(page);
    await page.locator('.planning-panel').screenshot({ path: 'tmp/323-ui/underbar-pinned-panel.png' });
    await context.close();
});
