// Project config Scope tab: boundaries are Jira Sprint values chosen from a range-agnostic list, not typed
// quarter text. Mocked routes, synthetic values; the app is the real dashboard source bundle.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5951';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'work-config-sprint-values');
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
const mapped = (id, name) => ({ fieldId: id, fieldName: name });
const clone = value => JSON.parse(JSON.stringify(value));
const idOf = value => Number(value.slice(0, 4)) * 10 + Number(value.slice(-1));
const VALUES = ['2030Q4', '2027Q2', '2027Q1', '2026Q4', '2026Q3', '2019Q1', '0000Q1'];
const sprintValueBody = (values = VALUES) => ({
    sprintValues: values.map(value => ({
        value, canonical: value !== '0000Q1', state: value >= '2027' ? 'future' : 'closed', sprintIds: [idOf(value)], configurationIds: ['delivery'],
    })),
    sources: [], promoted: true,
});

const bundle = () => ({
    version: 1, promotionRevision: 6,
    configurations: [{
        id: 'legacy', name: 'Legacy', revision: 1, fromQuarter: null, throughQuarter: '2026Q3', model: 'legacy',
        scope: { projects: [{ key: 'OLD', type: 'product' }], boardId: '7001' },
        legacyIssueTypeNames: ['Story'], legacyDisplayTypes: { parent: null, ancestor: null },
        legacyHierarchyModes: { parent: 'compatibility', ancestor: 'compatibility' },
        hierarchy: { planningIssueTypeId: null, parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { sprint: mapped('customfield_19901', 'Sprint'), storyPoints: mapped('customfield_19902', 'Story Points'), parentName: blank(), team: mapped('customfield_19904', 'Team'), projectTrack: blank(), deliveryOwner: blank() },
    }, {
        id: 'delivery', name: 'DELIVERY', revision: 1, fromQuarter: '2026Q4', throughQuarter: null, model: 'rnd_2027',
        scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '19095' },
        hierarchy: { planningIssueTypeId: '19002', parentIssueTypeId: '19003', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { sprint: mapped('customfield_19901', 'Sprint'), storyPoints: mapped('customfield_19902', 'Story Points'), parentName: blank(), team: mapped('customfield_19904', 'Team'), projectTrack: blank(), deliveryOwner: blank(), allocation: blank() },
    }],
});

async function mockApp(page, { sprintValuesStatus = 200, values = VALUES } = {}) {
    const state = { revision: 6, bundle: bundle(), workPosts: [], valueRequests: [] };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'eng', selectedSprint: 42 }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let body = null;
        try { body = request.postDataJSON(); } catch (_) { /* no body */ }
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        const p = url.pathname;
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/analytics/context' || p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            const epm = { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} };
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm,
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm } },
                sharedConfig: { version: 1, capacity: {}, statsPriorityWeights: [], epm }, sharedConfigRevision: state.revision,
                workConfigurationsEnabled: true, workConfigurationsPromoted: true,
                workConfigurationSummaries: [], adminSettingsMissingByConfiguration: {},
            });
        }
        if (p === '/api/work-structure/config' && request.method() === 'GET') {
            return json({ workConfigurations: state.bundle, configRevision: state.revision, promoted: true, userCanEditSettings: true, featureEnabled: true });
        }
        if (p === '/api/work-structure/config' && request.method() === 'POST') {
            state.workPosts.push(body);
            state.revision += 1;
            state.bundle = { ...clone(body.workConfigurations), promotionRevision: 6 };
            state.bundle.configurations.forEach(entry => { entry.revision += 1; });
            return json({ workConfigurations: state.bundle, configRevision: state.revision, changedConfigurationIds: ['legacy', 'delivery'], promoted: true });
        }
        if (p === '/api/work-structure/sprint-values') {
            state.valueRequests.push(url.search);
            if (sprintValuesStatus !== 200) return json({ error: 'sprint_values_read_failed', status: 'error', message: 'Sprint values could not be read.' }, sprintValuesStatus);
            return json(sprintValueBody(values));
        }
        if (p === '/api/issue-types') return json({ issueTypes: [], configurationId: url.searchParams.get('configurationId'), configurationRevision: Number(url.searchParams.get('configurationRevision')) });
        if (p === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (p === '/api/groups-config') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'] }], defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/sprints') return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: 'team-platform', name: 'Platform Team' }] });
        if (p === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/projects') return json({ projects: [{ key: 'OLD', name: 'Example legacy' }, { key: 'PLAN', name: 'Example delivery' }] });
        if (p === '/api/boards') return json({ boards: [] });
        if (p === '/api/fields') return json({ fields: [] });
        if (p === '/api/epm/config') return json({ version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} });
        return json({});
    });
    return state;
}

async function openScope(page) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Project config' }).click();
    await expect(dialog.locator('[data-work-config-editor]')).toBeVisible();
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    return dialog;
}
const rangeRow = (dialog, key) => dialog.locator(`[data-range-row="${key}"]`);
const saveButton = dialog => dialog.getByRole('button', { name: /^Save$/ });
async function chooseValue(dialog, key, label, value) {
    const row = rangeRow(dialog, key);
    await row.getByLabel(`Search ${label}`).fill(value);
    await row.locator('.team-search-result-item', { hasText: value }).first().click();
}

test('From and Through are chosen from observed Sprint values, never typed; the list is read once without a quarter', async ({ page }) => {
    const state = await mockApp(page);
    const dialog = await openScope(page);
    await expect(dialog.locator('input[placeholder="YYYYQn"]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Change (start|end)/ })).toHaveCount(0);
    await expect(rangeRow(dialog, 'throughQuarter').locator('.selected-team-chip')).toHaveText(/2026Q3/);
    expect(state.valueRequests).toEqual(['']);

    // A boundary outside the saved range (2027Q1 is beyond Legacy's 2026Q3) is selectable.
    await dialog.getByRole('button', { name: 'Remove Through Sprint' }).click();
    await rangeRow(dialog, 'throughQuarter').getByLabel('Search Through Sprint').fill('');
    await rangeRow(dialog, 'throughQuarter').getByLabel('Search Through Sprint').focus();
    await expect(rangeRow(dialog, 'throughQuarter').locator('.team-search-result-item')).toHaveCount(VALUES.length);
    await rangeRow(dialog, 'throughQuarter').locator('.team-search-result-item', { hasText: '2027Q1' }).click();
    await expect(rangeRow(dialog, 'throughQuarter').locator('.selected-team-chip')).toHaveText(/2027Q1/);
    await expect(rangeRow(dialog, 'throughQuarter').locator('.work-config-range-error')).toContainText('overlap');
    await expect(saveButton(dialog)).toBeDisabled();

    await dialog.locator('[data-work-config="delivery"] .group-list-select').click();
    await dialog.getByRole('button', { name: 'Remove From Sprint' }).click();
    await chooseValue(dialog, 'fromQuarter', 'From Sprint', '2030Q4');
    await expect(rangeRow(dialog, 'fromQuarter').locator('.selected-team-chip')).toHaveText(/2030Q4/);
    await expect(dialog.locator('.work-config-range-error')).toContainText('without a gap');
    await expect(saveButton(dialog)).toBeDisabled();
    await dialog.getByRole('button', { name: 'Remove From Sprint' }).click();
    await chooseValue(dialog, 'fromQuarter', 'From Sprint', '2027Q2');
    await expect(rangeRow(dialog, 'fromQuarter').locator('.selected-team-chip')).toHaveText(/2027Q2/);
    await expect(dialog.locator('.work-config-range-error')).toHaveCount(0);
    await expect(saveButton(dialog)).toBeEnabled();
    await dialog.locator('[data-work-config="legacy"] .group-list-select').click();
    await page.waitForTimeout(250);
    await dialog.screenshot({ path: path.join(shotDir, 'scope-legacy-picker.png'), animations: 'disabled' });
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    const [saved] = state.workPosts;
    const byId = Object.fromEntries(saved.workConfigurations.configurations.map(entry => [entry.id, entry]));
    expect([byId.legacy.fromQuarter, byId.legacy.throughQuarter]).toEqual([null, '2027Q1']);
    expect([byId.delivery.fromQuarter, byId.delivery.throughQuarter]).toEqual(['2027Q2', null]);
});

test('open ends stay fixed choices; a non-canonical value is listed but cannot become a boundary', async ({ page }) => {
    await mockApp(page);
    const dialog = await openScope(page);
    const legacyFrom = rangeRow(dialog, 'fromQuarter');
    await expect(legacyFrom.locator('.selected-team-chip')).toHaveText('No start (all earlier Sprints)');
    await expect(legacyFrom.locator('.team-search-input, .remove-btn')).toHaveCount(0);
    await dialog.locator('[data-work-config="delivery"] .group-list-select').click();
    const deliveryThrough = rangeRow(dialog, 'throughQuarter');
    await expect(deliveryThrough.locator('.selected-team-chip')).toHaveText('No end');
    await expect(deliveryThrough.locator('.team-search-input, .remove-btn')).toHaveCount(0);

    await expect(dialog.locator('[data-sprint-values-note]')).toContainText('cannot be used as a boundary');
    await dialog.getByRole('button', { name: 'Remove From Sprint' }).click();
    const from = rangeRow(dialog, 'fromQuarter');
    await from.getByLabel('Search From Sprint').fill('0000');
    const invalid = from.locator('.team-search-result-item', { hasText: '0000Q1' });
    await expect(invalid).toHaveAttribute('aria-disabled', 'true');
    await expect(invalid).toContainText('not a valid boundary');
    await invalid.click();
    await expect(from.getByLabel('Search From Sprint')).toBeVisible();
    await expect(from.locator('.selected-team-chip')).toHaveCount(0);
    await from.getByLabel('Search From Sprint').press('Enter');
    await expect(from.locator('.selected-team-chip')).toHaveCount(0);
});

test('load failure and an empty list explain themselves and keep saved boundaries', async ({ page }) => {
    await mockApp(page, { sprintValuesStatus: 500 });
    let dialog = await openScope(page);
    await expect(dialog.locator('[data-sprint-values-state="error"]')).toContainText('Could not load Sprint values');
    await expect(dialog.locator('[data-sprint-values-state="error"]').getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(rangeRow(dialog, 'throughQuarter').locator('.selected-team-chip')).toHaveText(/2026Q3/);
    await expect(saveButton(dialog)).toBeDisabled();
});

test('an empty list names the cause', async ({ page }) => {
    await mockApp(page, { values: [] });
    const dialog = await openScope(page);
    await expect(dialog.locator('[data-sprint-values-state="empty"]')).toContainText('No Jira Sprint has been observed yet');
});

for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
    test(`Sprint pickers keep usable touch targets and a reachable footer at ${viewport.width}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await mockApp(page);
        const dialog = await openScope(page);
        if (viewport.width <= 820) {
            await dialog.getByRole('button', { name: 'Configurations', exact: true }).click();
            await dialog.locator('[data-work-config="delivery"] .group-list-select').click();
        } else {
            await dialog.locator('[data-work-config="delivery"] .group-list-select').click();
        }
        const topmost = async (locator, label) => {
            const box = await locator.first().boundingBox();
            expect(box, label).not.toBeNull();
            expect(box.width, `${label} width`).toBeGreaterThanOrEqual(24);
            expect(box.height, `${label} height`).toBeGreaterThanOrEqual(24);
            expect(await locator.first().evaluate(element => {
                const rect = element.getBoundingClientRect();
                const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return element === at || element.contains(at);
            }), `${label} is not covered`).toBe(true);
        };
        await topmost(dialog.getByRole('button', { name: 'Remove From Sprint' }), 'Remove From Sprint');
        await dialog.getByRole('button', { name: 'Remove From Sprint' }).click();
        const from = rangeRow(dialog, 'fromQuarter');
        await topmost(from.getByLabel('Search From Sprint'), 'search input');
        await from.getByLabel('Search From Sprint').focus();
        await expect(from.locator('.team-search-result-item').first()).toBeVisible();
        await topmost(from.locator('.team-search-result-item').first(), 'first option');
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(shotDir, `scope-picker-open-${viewport.width}.png`), animations: 'disabled' });
        await from.locator('.team-search-result-item', { hasText: '2026Q4' }).click();
        const geometry = await page.evaluate(() => {
            const footer = document.querySelector('.group-modal-footer');
            const save = [...footer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel');
            const box = save.getBoundingClientRect();
            return {
                pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
                panelOverflow: (() => { const panel = document.querySelector('.work-config-panel'); return panel.scrollWidth - panel.clientWidth; })(),
                footerBottom: footer.getBoundingClientRect().bottom, height: window.innerHeight,
                cancelHit: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === save,
            };
        });
        expect(geometry.pageOverflow).toBeLessThanOrEqual(0);
        expect(geometry.panelOverflow).toBeLessThanOrEqual(0);
        expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.height + 0.5);
        expect(geometry.cancelHit).toBe(true);
        await page.screenshot({ path: path.join(shotDir, `scope-settled-${viewport.width}.png`), animations: 'disabled' });
    });
}
