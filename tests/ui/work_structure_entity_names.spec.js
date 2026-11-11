// A renamed DELIVERY configuration (planning `Deliverable` L1, parent `Theme` L2, ancestor `Objective` L3) names its work
// entities by those Jira types on Catch Up, the Planning table, the Board, Statistics and the tour. Inside each surface root
// the words Story/Epic appear only in "Story Points". Mocked routes, synthetic values only; the dashboard is bundled from source.
const fs = require('fs');
const path = require('path');
const esbuild = require('./fixture_bundles');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5963';
const shotDir = process.env.JEP_ENTITY_NAMES_SHOTS || '';
let sourceDashboardJs;

test.beforeAll(() => {
    if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

const RENAMED_ROLE_TYPES = {
    planning: { id: '6', name: 'Deliverable', hierarchyLevel: 1 }, parent: { id: '11700', name: 'Theme', hierarchyLevel: 2 },
    ancestor: { id: '12723', name: 'Objective', hierarchyLevel: 3 }, optionalAncestor: null,
};
const SUMMARIES = [
    { id: 'legacy', name: 'Legacy', revision: 3, model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' },
    { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null, roleTypes: RENAMED_ROLE_TYPES },
];
const SPRINT = { id: 91, name: '2027Q1', state: 'active' };
const BOARD = { columns: [{ id: 'col-todo', name: 'To Do', statuses: ['To Do'], colour: 'grey' }, { id: 'col-doing', name: 'In Progress', statuses: ['In Progress'], colour: 'blue', star: true }, { id: 'col-done', name: 'Done', statuses: ['Done'], colour: 'green' }] };
const ALL_MODULES = ['catch-up', 'configuration', 'planning', 'board', 'statistics'];

const row = (key, summary, parentKey = 'PLAN-100') => ({
    id: key.replace(/\D/g, ''), key, fields: {
        summary, status: { name: 'In Progress' }, priority: { name: 'Medium' }, issuetype: { id: '6', name: 'Deliverable' },
        customfield_10004: 3, epicKey: parentKey, parentSummary: 'Sample theme', projectKey: 'PLAN',
        teamId: 'team-platform', teamName: 'Platform Team', updated: '2027-01-12T12:00:00.000Z', sprint: [SPRINT],
        assignee: { displayName: 'Pat Example', accountId: 'pat' },
    },
});
const closed = (key, index) => ({
    key, summary: `Closed theme ${index}`, projectKey: 'PLAN', status: 'done', jiraStatus: 'Done',
    createdDate: '2027-01-05', terminalDate: `2027-02-0${index}`, leadTimeDays: 30 + index, assignee: { id: 'lead', name: 'Lead' },
});

// A 1x1 PNG stands in for Jira's type icon; without `icons` the route answers like an unavailable icon.
const ICON_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function mockApp(page, { prefs = {}, completedModules = ALL_MODULES, icons = false, childIconFailure = null } = {}) {
    const state = { log: [] };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(stored => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(stored)),
        { selectedView: 'eng', selectedSprint: 91, sprintName: '2027Q1', selectedQuarter: '2027Q1', groupByInitiativeChoice: true, ...prefs });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const params = Object.fromEntries(url.searchParams.entries());
        const p = url.pathname;
        state.log.push({ method: request.method(), pathname: p, params });
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        if (p.startsWith('/api/issue-type-icon/')) {
            if (!icons && childIconFailure && p === '/api/issue-type-icon/6') {
                await childIconFailure;
                // Exercise delayed network-error delivery after the role
                // wrappers have mounted; mounting is not fallback readiness.
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            return icons ? route.fulfill({ status: 200, contentType: 'image/png', body: ICON_PNG }) : json({ error: 'issue_type_icon_unavailable' }, 404);
        }
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/analytics/context' || p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            const shared = { version: 1, capacity: {}, statsPriorityWeights: [], epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm: shared.epm, adminContacts: ['Pat Admin'],
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: shared.epm } },
                sharedConfig: shared, sharedConfigRevision: 3, workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: SUMMARIES, adminSettingsMissingByConfiguration: { legacy: [], delivery: [] },
            });
        }
        if (p === '/api/work-structure/config') return json({ workConfigurations: { version: 1, promotionRevision: 6, configurations: [] }, configRevision: 3, promoted: true, userCanEditSettings: true, featureEnabled: true });
        if (p === '/api/groups-config' && request.method() === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'], teamLabels: { 'team-platform': ['alias_platform'] }, board: BOARD }],
                defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: completedModules, visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') {
            const id = params.configurationId || '';
            if (!id) return json({ error: 'configuration_required' }, 409);
            const rows = id === 'delivery' ? [SPRINT] : [{ id: 7, name: '2026Q4', state: 'closed' }];
            return json({ sprints: rows.map(item => ({ ...item, configurationId: id })), context: { configurationId: id, configurationRevision: Number(params.configurationRevision) } });
        }
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: 'team-platform', name: 'Platform Team' }] });
        if (p === '/api/tasks-with-team-name') {
            const visible = !params.purpose;
            return json({
                issues: visible ? [row('PLAN-1', 'First sample deliverable'), row('PLAN-2', 'Second sample deliverable'), row('PLAN-3', 'Third sample deliverable')] : [],
                epics: { 'PLAN-100': { key: 'PLAN-100', summary: 'Sample theme', status: { name: 'In Progress' }, priority: { name: 'High' }, teamId: 'team-platform', teamName: 'Platform Team', initiative: { key: 'OBJ-1', summary: 'Sample objective' } } },
                epicsInScope: [], names: {},
            });
        }
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/eng/story-readiness') return json({ schemaVersion: 1, complete: true, epics: [], scope: { groupId: params.groupId, sprintId: params.sprint } });
        if (p === '/api/dependencies') return json({ dependencies: {} });
        if (p === '/api/stats/epic-cohort' && request.method() === 'POST') {
            return json({ cached: false, data: { range: null, issues: [closed('PLAN-201', 1), closed('PLAN-202', 2)], meta: { warnings: [], mode: 'last_n', scope: 'components', windowCeiling: 200, windowFull: false } } });
        }
        if (p === '/api/projects' || p === '/api/boards') return json({ projects: [], boards: [] });
        return json({});
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    return state;
}

const ENTITY = /\b(stor(y|ies)|epics?)\b/i;
// Visible text of a surface root with every "Story Points" (or "story-point") removed; nothing else may name a Story or an Epic.
async function expectNoLegacyWords(locator) {
    await expect(locator).toBeVisible();
    const text = (await locator.innerText()).replace(/story[ -]points?/gi, '');
    const hits = [...text.matchAll(new RegExp(ENTITY.source, 'gi'))].map(match => text.slice(Math.max(0, match.index - 60), match.index + 30).replace(/\s+/g, ' '));
    expect(hits).toEqual([]);
}
async function shot(page, name, locator = null) {
    if (!shotDir) return;
    await page.waitForTimeout(300);
    await (locator || page).screenshot({ path: path.join(shotDir, `${name}.png`), ...(locator ? {} : { fullPage: false }) });
}

test('Catch Up names the rows, parents and readout by the captured Jira types', async ({ page }) => {
    await mockApp(page);
    const list = page.locator('.task-list');
    await expect(page.locator('.task-item')).toHaveCount(3);
    await expect(page.getByText(/3 deliverables/i).first()).toBeVisible();
    await expect(page.locator('.task-item .story-icon').first()).toHaveAttribute('title', 'DELIVERABLE');
    await expect(page.locator('.epic-header .epic-icon').first()).toHaveAttribute('title', 'THEME');
    await expectNoLegacyWords(list);
    await shot(page, 'catch-up', list);
});

// The rendered svg box of each Catch Up type icon: a row, its parent header and the ancestor group line.
async function iconBoxes(page) {
    await expect(page.locator('.task-item')).toHaveCount(3);
    await expect(page.locator('.initiative-header .initiative-header-icon')).toHaveCount(1);
    return page.evaluate(() => Object.fromEntries([
        ['child', '.task-item .story-icon svg'], ['parent', '.epic-header .epic-icon svg'], ['ancestor', '.initiative-header .initiative-header-icon svg'],
    ].map(([role, selector]) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return [role, { width: box.width, height: box.height, image: document.querySelector(selector).querySelector('image')?.getAttribute('href') || null }];
    })));
}

test('DELIVERY draws each configured Jira type icon in the glyph box, and an unavailable icon falls back to the glyph', async ({ page }) => {
    const state = await mockApp(page, { icons: true });
    const jira = await iconBoxes(page);
    expect(Object.values(jira).map(box => box.image)).toEqual(['/api/issue-type-icon/6', '/api/issue-type-icon/11700', '/api/issue-type-icon/12723']);
    await expect(page.locator('.task-item .story-icon').first()).toHaveAttribute('title', 'DELIVERABLE');
    await expect(page.locator('.initiative-header .initiative-header-icon')).toHaveAttribute('title', 'OBJECTIVE');
    expect(state.log.filter(entry => entry.pathname.startsWith('/api/issue-type-icon/')).length).toBeGreaterThanOrEqual(3);
    await shot(page, 'type-icons', page.locator('.task-list'));

    const fallbackPage = await page.context().newPage();
    let releaseChildIcon;
    const childIconFailure = new Promise(resolve => { releaseChildIcon = resolve; });
    await mockApp(fallbackPage, { childIconFailure });
    await expect(fallbackPage.locator('.task-item')).toHaveCount(3);
    await expect(fallbackPage.locator('.epic-header .epic-icon svg')).toHaveCount(1);
    await expect(fallbackPage.locator('.initiative-header .initiative-header-icon')).toHaveCount(1);
    await expect(fallbackPage.locator('.task-item .story-icon svg image')).toHaveCount(3);
    releaseChildIcon();
    await expect(fallbackPage.locator('.task-item .story-icon svg image, .epic-header .epic-icon svg image, .initiative-header .initiative-header-icon svg image')).toHaveCount(0);
    const glyph = await iconBoxes(fallbackPage);
    expect(Object.values(glyph).map(box => box.image)).toEqual([null, null, null]);
    await expect(fallbackPage.locator('.task-item .story-icon path[d^="m10.271"]').first()).toBeAttached();
    await expect(fallbackPage.locator('.epic-header .epic-icon .initiative-icon')).toHaveCount(1);
    for (const role of ['child', 'parent', 'ancestor']) {
        expect({ role, width: jira[role].width, height: jira[role].height }).toEqual({ role, width: glyph[role].width, height: glyph[role].height });
    }
    await fallbackPage.close();
});

test('the Planning table names its row kinds and parent column by the captured types', async ({ page }) => {
    await mockApp(page, { prefs: { showPlanning: true } });
    const region = page.locator('.planning-review-region');
    await expect(region).toBeVisible();
    const rows = page.getByRole('radiogroup', { name: 'Planning review rows' }).or(page.locator('.planning-review-region .eng-mode-control'));
    await expect(page.locator('.eng-mode-control', { hasText: 'Themes' }).first()).toBeVisible();
    await expect(page.locator('.eng-mode-control', { hasText: 'Deliverables' }).first()).toBeVisible();
    await expect(rows.first()).toBeVisible();
    await expectNoLegacyWords(region);
    await shot(page, 'planning-table');
});

test('the Board names its cards, readout and help by the captured parent type', async ({ page }) => {
    await mockApp(page, { prefs: { showBoard: true } });
    const board = page.locator('.eng-board');
    await expect(board).toBeVisible();
    await expect(page.locator('.fb-readout')).toContainText('of 1 theme');
    await expect(board.getByText('theme · 9.0 sp', { exact: true })).toBeVisible();
    await expect(board.getByRole('button', { name: 'Focus To Do, 0 themes, 0.0 story points' })).toBeVisible();
    await expect(board.locator('.ecard', { hasText: 'Sample theme' })).toContainText('0 of 3 deliverables');
    await expect(board.getByRole('button', { name: 'Copy link to Theme PLAN-100' })).toBeVisible();
    await expectNoLegacyWords(board);
    await shot(page, 'board');
});

test('Statistics Lead Times names the parent type in titles, lists and controls', async ({ page }) => {
    await mockApp(page, { prefs: { showStats: true, statsView: 'cohort', cohortMode: 'last_n', cohortLastN: 30 } });
    const panel = page.locator('.stats-panel.open');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Themes Overview')).toBeVisible();
    await expect(panel.locator('.cohort-open-title', { hasText: 'Completed Themes' })).toBeVisible();
    await expect(panel.getByLabel('Number of themes')).toBeVisible();
    await expectNoLegacyWords(panel);
    await shot(page, 'statistics');
});

test('the tour names the ancestor, parent and child of the renamed configuration', async ({ page }) => {
    await mockApp(page, { completedModules: ['configuration', 'planning', 'board', 'statistics'] });
    await expect(page.locator('.task-item')).toHaveCount(3);
    const dialog = page.getByRole('dialog').filter({ hasText: /Step \d+ of \d+|Next/ }).first();
    await expect(dialog).toBeVisible();
    const titles = [];
    for (let index = 0; index < 12; index += 1) {
        const heading = (await dialog.locator('h2, h3').first().innerText()).trim();
        titles.push(heading);
        if (/See the delivery/.test(heading)) break;
        const next = dialog.getByRole('button', { name: /^Next$/ });
        if (!(await next.count())) break;
        await next.click();
    }
    expect(titles).toEqual(expect.arrayContaining(['Start with the Objective', 'Follow the Theme', 'See the delivery Deliverables']));
    await expect(dialog).toContainText('Deliverables are the delivery work grouped under a Theme.');
});
