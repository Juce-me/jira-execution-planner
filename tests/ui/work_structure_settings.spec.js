// Production Project config editor (Admin -> Project config) against mocked API routes. Every value is
// synthetic; the app is the real dashboard source bundle, so this exercises the production components,
// not the mockup fixture.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://localhost:5951';
const shotDir = path.join(__dirname, '..', '..', 'tmp', 'work-config-production');
let sourceDashboardJs;

test.beforeAll(async () => {
    fs.mkdirSync(shotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

const FIELDS = [
    { id: 'customfield_19901', name: 'Sprint' },
    { id: 'customfield_19902', name: 'Story Points' },
    { id: 'customfield_19903', name: 'Epic Name' },
    { id: 'customfield_19904', name: 'Team' },
    { id: 'customfield_19905', name: 'Delivery Owner' },
    { id: 'customfield_19907', name: 'RnD_allocation_category' },
    { id: 'customfield_19908', name: 'Project Track' },
];
const TYPES = [
    { id: '19001', name: 'Story', hierarchyLevel: 0, projectIds: ['10'] },
    { id: '19002', name: 'Epic', hierarchyLevel: 1, projectIds: ['10'] },
    { id: '19003', name: 'Initiative', hierarchyLevel: 2, projectIds: ['10'] },
    { id: '19004', name: 'Objective', hierarchyLevel: 3, projectIds: ['10'] },
    { id: '19005', name: 'Strategy', hierarchyLevel: 4, projectIds: ['10'] },
    { id: '19007', name: 'Unknown hierarchy type', hierarchyLevel: null, projectIds: ['10'] },
];
const PROJECTS = [
    { key: 'OLD', name: 'Example legacy' }, { key: 'PLAN', name: 'Example delivery' }, { key: 'EXTRA', name: 'Example extra' },
];
const blank = () => ({ fieldId: '', fieldName: '' });
const sharedField = () => ({ fieldId: '', fieldName: '', mode: 'shared' });
const field = name => { const found = FIELDS.find(item => item.name === name); return { fieldId: found.id, fieldName: found.name }; };
const clone = value => JSON.parse(JSON.stringify(value));

function legacyEntry(overrides = {}) {
    return {
        id: 'legacy', name: 'Legacy', revision: 0, fromQuarter: null, throughQuarter: '2026Q4', model: 'legacy',
        scope: { projects: [{ key: 'OLD', type: 'product' }], boardId: '7001' },
        legacyIssueTypeNames: ['Story'], legacyDisplayTypes: { parent: null, ancestor: null },
        legacyHierarchyModes: { parent: 'compatibility', ancestor: 'compatibility' },
        hierarchy: { planningIssueTypeId: null, parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { sprint: field('Sprint'), storyPoints: field('Story Points'), parentName: field('Epic Name'), team: field('Team'), projectTrack: blank(), deliveryOwner: blank() },
        ...overrides,
    };
}
function deliveryEntry(overrides = {}) {
    return {
        id: 'delivery', name: 'DELIVERY', revision: 0, fromQuarter: '2027Q1', throughQuarter: null, model: 'rnd_2027',
        scope: { projects: [], boardId: '' },
        hierarchy: { planningIssueTypeId: null, parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        // As the server's virtual DELIVERY (`_blank_delivery`): Sprint, Story Points and Team share Legacy's fields.
        fields: { sprint: sharedField(), storyPoints: sharedField(), parentName: blank(), team: sharedField(), projectTrack: blank(), deliveryOwner: blank(), allocation: blank() },
        ...overrides,
    };
}
const virtualBundle = () => ({ version: 1, promotionRevision: null, configurations: [legacyEntry(), deliveryEntry()] });
function promotedBundle({ delivery = {}, legacy = {}, promotionRevision = 6 } = {}) {
    return {
        version: 1, promotionRevision,
        configurations: [legacyEntry({ revision: 1, ...legacy }), deliveryEntry({
            revision: 1,
            scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' },
            fields: { sprint: field('Sprint'), storyPoints: field('Story Points'), parentName: blank(), team: field('Team'), projectTrack: blank(), deliveryOwner: blank(), allocation: blank() },
            hierarchy: { planningIssueTypeId: '19002', parentIssueTypeId: '19003', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
            ...delivery,
        })],
    };
}

// A small stand-in for POST /api/work-structure/config: CAS on baseRevision, first-save promotion,
// per-entry revision bumps, plus injectable failures.
async function mockApp(page, {
    featureEnabled = true, promoted = false, revision = 3, bundle = virtualBundle(), typesDelay = 0, typesStatus = 200,
    types = TYPES, failPriorityOnce = false, summaries = [], analyticsEnabled = false,
    allocationOptions = { options: [], source: null, complete: false }, sprintValues = null,
} = {}) {
    const state = { summaries: clone(summaries), afterWorkPost: null, promoted, revision, bundle: clone(bundle), calls: [], workPosts: [], priorityPosts: 0, conflictOnce: null, rejectRetired: false, typesStatus, typesRequests: 0 };
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceDashboardJs }));
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'eng', selectedSprint: 42 }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        let body = null;
        try { body = request.postDataJSON(); } catch (_) { /* no body */ }
        state.calls.push({ method, pathname: url.pathname, search: url.search, body });
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        const p = url.pathname;
        if (p === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (p === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (p === '/api/admin/users') return json({ users: [{
            id: 'synthetic-admin', externalSubject: 'synthetic-admin-account',
            displayName: 'Synthetic Admin', accountType: 'admin', status: 'active',
            authConnections: [], projectAccess: [],
        }] });
        if (p === '/api/analytics/context') return json(analyticsEnabled ? { enabled: true, measurementId: 'G-SYNTHETIC', ga4UserId: 'synthetic-user', debugMode: false } : { enabled: false });
        if (p === '/api/version') return json({ enabled: false });
        if (p === '/api/config') {
            const shared = {
                version: 1, capacity: {}, statsPriorityWeights: [], epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} },
            };
            if (!featureEnabled && !state.promoted) {
                Object.assign(shared, {
                    projects: { selected: [{ key: 'OLD', type: 'product' }] }, board: { boardId: '7001', boardName: 'Legacy board' },
                    sprintField: field('Sprint'), parentNameField: field('Epic Name'), storyPointsField: field('Story Points'), teamField: field('Team'),
                    deliveryOwnerField: blank(), issueTypes: ['Story'],
                });
            }
            return json({
                jiraUrl: 'https://jira.example', authMode: 'atlassian_oauth', projectsConfigured: true, settingsAdminOnly: false,
                userCanEditSettings: true, userCanEditEpmConfig: true, epm: shared.epm,
                adminUserManagementAvailable: true, userIsToolAdmin: true,
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: shared.epm } },
                sharedConfig: shared, sharedConfigRevision: state.revision,
                workConfigurationsEnabled: featureEnabled, workConfigurationsPromoted: state.promoted,
                workConfigurationSummaries: state.summaries, adminSettingsMissingByConfiguration: {},
            });
        }
        if (p === '/api/work-structure/config' && method === 'GET') {
            return json({ workConfigurations: state.bundle, configRevision: state.revision, promoted: state.promoted, userCanEditSettings: true, featureEnabled });
        }
        if (p === '/api/work-structure/config' && method === 'POST') {
            state.workPosts.push(body);
            if (state.conflictOnce) {
                const next = state.conflictOnce;
                state.conflictOnce = null;
                state.bundle = clone(next.bundle);
                state.revision = next.revision;
                state.promoted = true;
                return json({ error: 'workspace_config_conflict', message: 'Shared settings changed while you were editing.', configRevision: state.revision, workConfigurations: state.bundle }, 409);
            }
            if (body.baseRevision !== state.revision) {
                return json({ error: 'workspace_config_conflict', configRevision: state.revision, workConfigurations: state.bundle }, 409);
            }
            const stored = state.bundle.configurations.find(entry => entry.id === 'legacy');
            const incoming = body.workConfigurations.configurations.find(entry => entry.id === 'legacy');
            if (state.rejectRetired && stored.legacyIssueTypeNames === null && incoming.legacyIssueTypeNames !== null) {
                return json({
                    error: 'invalid_work_configurations', status: 'error', configurationId: 'legacy', slot: 'planningIssueTypeId', paths: ['legacyIssueTypeNames'],
                    message: 'The planning name filter was retired by another editor; choose or clear the Jira type, or reload.',
                }, 400);
            }
            const changed = [];
            const configurations = body.workConfigurations.configurations.map(entry => {
                const before = state.bundle.configurations.find(item => item.id === entry.id);
                const same = state.promoted && JSON.stringify({ ...before, revision: 0 }) === JSON.stringify({ ...entry, revision: 0 });
                if (!same) changed.push(entry.id);
                return { ...entry, revision: state.promoted ? (same ? before.revision : before.revision + 1) : 1 };
            });
            state.revision += 1;
            state.bundle = { version: 1, promotionRevision: state.promoted ? state.bundle.promotionRevision : state.revision, configurations };
            state.promoted = true;
            state.afterWorkPost?.(state);
            return json({ workConfigurations: state.bundle, configRevision: state.revision, changedConfigurationIds: changed, promoted: true });
        }
        if (p === '/api/issue-types' && url.searchParams.get('configurationId')) {
            state.typesRequests += 1;
            if (typesDelay) await new Promise(resolve => setTimeout(resolve, typesDelay));
            if (state.typesStatus !== 200) return json({ error: 'upstream_unavailable', message: 'Unavailable.' }, state.typesStatus);
            return json({ issueTypes: types, configurationId: url.searchParams.get('configurationId'), configurationRevision: Number(url.searchParams.get('configurationRevision')) });
        }
        if (p === '/api/work-structure/allocation-options') return json(allocationOptions);
        if (p === '/api/work-structure/sprint-values') {
            if (sprintValues) return json({ sprintValues, sources: [], promoted: state.promoted });
            return json({ sprintValues: ['2027Q2', '2027Q1', '2026Q4', '2026Q3', '0000Q1'].map(value => ({ value, canonical: value !== '0000Q1', state: 'closed', sprintIds: [Number(value.slice(0, 4)) * 10 + Number(value.slice(-1))], configurationIds: ['legacy'] })), sources: [], promoted: state.promoted });
        }
        if (p === '/api/stats/priority-weights-config' && method === 'POST') {
            state.priorityPosts += 1;
            if (failPriorityOnce && state.priorityPosts === 1) return json({ error: 'save_failed', message: 'Priority weights could not be saved.' }, 500);
            return json({ weights: body.weights, source: 'config', configRevision: state.revision + 1 });
        }
        if (p === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (p === '/api/groups-config' && method === 'GET') {
            return json({
                version: 1, groups: [{ id: 'platform', name: 'Platform', teamIds: ['team-platform'] }], defaultGroupId: 'platform', configRevision: 2, source: 'workspace_db',
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], visibleGroupIds: ['platform'], activeGroupId: 'platform', effectiveVisibleGroupIds: ['platform'] },
            });
        }
        if (p === '/api/groups-config' && method === 'POST') {
            state.groupPosts = (state.groupPosts || 0) + 1;
            return json({ ...body, configRevision: 3, source: 'workspace_db' });
        }
        if (p === '/api/groups-preferences') return json({ preferences: {} });
        if (p === '/api/sprints') return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        if (p === '/api/team-catalog') return json({ catalog: { 'team-platform': { id: 'team-platform', name: 'Platform Team' } }, meta: {} });
        if (p === '/api/teams') return json({ teams: [{ id: 'team-platform', name: 'Platform Team' }] });
        if (p === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [] });
        if (p === '/api/missing-info') return json({ issues: [], epics: [] });
        if (p === '/api/projects') return json({ projects: PROJECTS });
        if (p === '/api/boards') return json({ boards: [{ id: '7001', name: 'Legacy board', type: 'scrum' }, { id: '7002', name: 'Delivery board', type: 'scrum' }] });
        if (p === '/api/fields') return json({ fields: FIELDS });
        if (p === '/api/epm/config') return json({ version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} });
        return json({});
    });
    return state;
}

async function openSettings(page) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Admin' }).click();
    return dialog;
}
const projectTab = async dialog => { await dialog.getByRole('tab', { name: 'Project config' }).click(); await expect(dialog.locator('[data-work-config-editor]')).toBeVisible(); };
const nested = (dialog, name) => dialog.getByRole('tab', { name, exact: true });
const saveButton = dialog => dialog.getByRole('button', { name: /^Save$/ });
const row = (dialog, id) => dialog.locator(`[data-work-config="${id}"]`);
async function selectConfiguration(dialog, id) {
    const target = row(dialog, id);
    if (await target.locator('.group-list-select').count()) await target.locator('.group-list-select').click();
    await expect(target).toHaveClass(/active/);
}
// On compact screens the list is the shared Department drawer: open it, choose, and it closes itself.
async function chooseConfiguration(dialog, id, compact) {
    if (!compact) return selectConfiguration(dialog, id);
    await dialog.getByRole('button', { name: 'Configurations', exact: true }).click();
    await dialog.locator(`[data-work-config="${id}"] .group-list-select`).click();
    await expect(dialog.locator('.group-pane-left')).not.toHaveClass(/is-mobile-active/);
}
async function pickField(dialog, labelPattern, query, optionText) {
    const section = dialog.locator('.group-projects-subsection').filter({ has: dialog.page().locator('.team-selector-label', { hasText: labelPattern }) });
    await section.locator('.team-search-input').fill(query);
    await section.locator('.team-search-result-item', { hasText: optionText }).first().click();
}
const quiet = page => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });

test('first promotion: virtual bundle, inline rename, blank DELIVERY, one footer Save, whole-bundle first save', async ({ page }) => {
    const state = await mockApp(page);
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('tablist', { name: 'Admin settings sections' }).getByRole('tab')).toHaveText(['Project config', 'Capacity', 'Priority weights', 'Access']);
    await projectTab(dialog);
    await expect(row(dialog, 'legacy')).toHaveClass(/active/);
    await expect(nested(dialog, 'Scope')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('.group-list-item')).toHaveCount(2);
    await expect(saveButton(dialog)).toBeDisabled();

    await dialog.getByLabel('Configuration name').fill('Legacy 2026');
    await expect(dialog.locator('.group-modal-dirty')).toHaveText('Unsaved changes · 1');
    await selectConfiguration(dialog, 'delivery');
    await expect(dialog.locator('[data-setup-guidance]')).toContainText('DELIVERY is not ready');
    await dialog.getByPlaceholder('Search projects to add...').fill('PLAN');
    await dialog.locator('.team-search-result-item', { hasText: 'PLAN' }).getByRole('button', { name: 'Add' }).click();
    await expect(dialog.locator('.selected-teams-list .selected-team-chip', { hasText: 'PLAN' })).toHaveCount(1);
    // Sprint, Story Points and Team start shared with Legacy: nothing to pick.
    await nested(dialog, 'Source').click();
    await expect(dialog.locator('[data-field-share="sprint"]')).toContainText('Same as Legacy');
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-field-share="storyPoints"]')).toContainText('Same as Legacy');
    await expect(dialog.locator('[data-field-share="team"]')).toContainText('Team is one field for every configuration');
    // Exactly one structural Save in the footer on every nested and upper tab.
    for (const name of ['Scope', 'Source', 'Field mapping']) { await nested(dialog, name).click(); await expect(saveButton(dialog)).toHaveCount(1); }
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await expect(saveButton(dialog)).toHaveCount(1);
    await expect(dialog.locator('[data-work-config-editor]')).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Project config' }).click();
    await expect(row(dialog, 'delivery')).toHaveClass(/active/);
    await expect(nested(dialog, 'Field mapping')).toHaveAttribute('aria-selected', 'true');

    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
    const post = state.workPosts[0];
    expect(post.baseRevision).toBe(3);
    expect(post.legacyEdits).toEqual([{ path: 'name', value: 'Legacy 2026' }]);
    expect('clearProjectsForConfigurationIds' in post).toBe(false);
    const delivery = post.workConfigurations.configurations.find(entry => entry.id === 'delivery');
    expect(delivery.scope.projects).toEqual([{ key: 'PLAN', type: 'other' }]);
    for (const name of ['sprint', 'storyPoints', 'team']) expect(delivery.fields[name]).toEqual({ fieldId: '', fieldName: '', mode: 'shared' });
    expect(state.promoted).toBe(true);

    // The same save result names the incomplete configuration and rows on every upper tab.
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.getByRole('dialog').first();
    await reopened.getByRole('button', { name: 'Admin' }).click();
    await expect(reopened.locator('[data-work-config-save-feedback]')).toContainText('DELIVERY: missing Epic, Initiative');
    await reopened.getByRole('tab', { name: 'Capacity' }).click();
    await expect(reopened.locator('[data-work-config-save-feedback]')).toContainText('DELIVERY: missing Epic, Initiative');
});

test('DELIVERY refuses a second project for mouse and Enter and clears only when saved explicitly', async ({ page }) => {
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    const search = dialog.getByPlaceholder('Search projects to add...');
    await search.fill('EXTRA');
    await dialog.locator('.team-search-result-item', { hasText: 'EXTRA' }).getByRole('button', { name: 'Add' }).click();
    await expect(dialog.locator('[data-project-limit-message]')).toHaveText('DELIVERY uses one Jira project');
    await expect(dialog.locator('.selected-teams-list .selected-team-chip')).toHaveCount(1);
    await search.fill('');
    await expect(dialog.locator('[data-project-limit-message]')).toHaveCount(0);
    await search.fill('EXTRA');
    await search.press('Enter');
    await expect(dialog.locator('[data-project-limit-message]')).toHaveText('DELIVERY uses one Jira project');
    await expect(dialog.locator('.selected-teams-list .selected-team-chip')).toHaveCount(1);
    await expect(dialog.locator('.group-modal-dirty')).toHaveCount(0);

    // Removing the last project is a deliberate clear: a saveable incomplete draft with the explicit protocol.
    // The search popover covers the chips below it, so a user clears the search first.
    await search.fill('');
    await dialog.getByRole('button', { name: 'Remove project PLAN' }).click();
    await expect(dialog.locator('[data-setup-guidance]')).toBeVisible();
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
    expect(state.workPosts[0].clearProjectsForConfigurationIds).toEqual(['delivery']);
    expect('legacyEdits' in state.workPosts[0]).toBe(false);
});

test('partial Save keeps the failed draft and the retry never replays the committed bundle', async ({ page }) => {
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle(), failPriorityOnce: true });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await dialog.getByLabel('Configuration name').fill('Legacy 2026');
    await dialog.getByRole('tab', { name: 'Priority weights' }).click();
    await dialog.locator('input[aria-label$=" weight"]').first().fill('2.5');
    await expect(dialog.locator('.group-modal-dirty')).toHaveText('Unsaved changes · 2');
    await saveButton(dialog).click();
    await expect(dialog.locator('.group-modal-validation')).toContainText('Priority weights could not be saved.');
    expect(state.workPosts).toHaveLength(1);
    expect(state.priorityPosts).toBe(1);
    // Project config committed; only the failed section stays dirty, and nothing claims everything saved.
    await expect(dialog.locator('.group-modal-dirty')).toHaveText('Unsaved changes · 1');
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
    expect(state.priorityPosts).toBe(2);
    // The weights post used the revision the bundle save produced.
    expect(state.calls.filter(call => call.pathname === '/api/stats/priority-weights-config' && call.method === 'POST')[1].body.baseRevision).toBe(state.revision);
});

test('conflict: Keep mine retargets the whole bundle; a retired compatibility filter is a preserved-draft field error', async ({ page }) => {
    const remote = promotedBundle({ promotionRevision: 6 });
    remote.configurations[0] = legacyEntry({
        revision: 2, name: 'Legacy remote', legacyIssueTypeNames: null,
        hierarchy: { planningIssueTypeId: '19001', parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
    });
    const state = await mockApp(page, { promoted: true, revision: 7, bundle: promotedBundle() });
    state.rejectRetired = true;
    state.conflictOnce = { bundle: remote, revision: 9 };
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await dialog.getByLabel('Configuration name').fill('DELIVERY Q1');
    await saveButton(dialog).click();
    const validation = dialog.locator('.group-modal-validation');
    await expect(validation).toContainText('Shared settings changed while you were editing. Your changes are still unsaved.');
    await expect(validation).toContainText('Still unsaved: Project config.');
    await expect(dialog.getByTestId('workspace-config-conflict-actions').getByRole('button')).toHaveText(['Use latest', 'Keep mine']);
    expect(state.workPosts[0].baseRevision).toBe(7);

    // Keep mine: one re-POST on the latest revision; the draft still holds the retired captured filter.
    await dialog.getByRole('button', { name: 'Keep mine' }).click();
    await expect(validation).toContainText('The planning name filter was retired by another editor');
    expect(state.workPosts).toHaveLength(2);
    expect(state.workPosts[1].baseRevision).toBe(9);
    expect('legacyEdits' in state.workPosts[1]).toBe(false);
    const retried = state.workPosts[1].workConfigurations.configurations;
    expect(retried.find(entry => entry.id === 'delivery').name).toBe('DELIVERY Q1');
    expect(retried.find(entry => entry.id === 'legacy').revision).toBe(2);
    expect(retried.find(entry => entry.id === 'legacy').legacyIssueTypeNames).toEqual(['Story']);
    await expect(dialog.getByLabel('Configuration name')).toHaveValue('DELIVERY Q1');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();

    // Recovery is an explicit mapping repair on the named configuration and slot, not a merge.
    await selectConfiguration(dialog, 'legacy');
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-field-error="planningIssueTypeId"]')).toContainText('retired by another editor');
    // A single captured name is the Story card's own chip; its x opens the same retirement confirmation.
    await dialog.locator('[data-mapping-key="planningIssueTypeId"]').getByRole('button', { name: 'Remove Story' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change mapping' }).click();
    await dialog.locator('[data-mapping-key="planningIssueTypeId"] .team-search-input').fill('Story');
    await dialog.locator('[data-mapping-key="planningIssueTypeId"] .team-search-result-item', { hasText: 'Story' }).click();
    await expect(dialog.locator('[data-field-error="planningIssueTypeId"]')).toHaveCount(0);
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(state.workPosts).toHaveLength(3);
    const repaired = state.workPosts[2].workConfigurations.configurations.find(entry => entry.id === 'legacy');
    expect(repaired.legacyIssueTypeNames).toBeNull();
    expect(repaired.hierarchy.planningIssueTypeId).toBe('19001');
});

test('a compatibility-retired failure can also be recovered with an explicit Reload', async ({ page }) => {
    const remote = promotedBundle();
    remote.configurations[0] = legacyEntry({
        revision: 2, legacyIssueTypeNames: null,
        hierarchy: { planningIssueTypeId: '19001', parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
    });
    const state = await mockApp(page, { promoted: true, revision: 7, bundle: promotedBundle() });
    state.rejectRetired = true;
    state.conflictOnce = { bundle: remote, revision: 9 };
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await dialog.getByLabel('Configuration name').fill('Mine');
    await saveButton(dialog).click();
    await dialog.getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog.locator('.group-modal-validation')).toContainText('retired by another editor');
    await selectConfiguration(dialog, 'legacy');
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-field-error="planningIssueTypeId"]')).toBeVisible();
    // The draft is preserved until the user chooses: nothing was merged or force-written.
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    expect(state.workPosts).toHaveLength(2);
    await dialog.getByRole('button', { name: 'Reload latest (discard my changes)' }).click();
    await expect(dialog.locator('[data-field-error]')).toHaveCount(0);
    await expect(dialog.locator('[data-captured-filter]')).toHaveCount(0);
    await selectConfiguration(dialog, 'delivery');
    await expect(dialog.getByLabel('Configuration name')).toHaveValue('DELIVERY');
    await expect(dialog.locator('.group-modal-dirty')).toHaveCount(0);
    expect(state.workPosts).toHaveLength(2);
});

test('Use latest reloads the remote bundle and drops the local draft', async ({ page }) => {
    const remote = promotedBundle();
    remote.configurations[1].name = 'Remote DELIVERY';
    const state = await mockApp(page, { promoted: true, revision: 7, bundle: promotedBundle() });
    state.conflictOnce = { bundle: remote, revision: 9 };
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await dialog.getByLabel('Configuration name').fill('Mine');
    await saveButton(dialog).click();
    await dialog.getByRole('button', { name: 'Use latest' }).click();
    await expect(dialog.locator('[data-work-config="delivery"] .group-list-name-input, [data-work-config="delivery"] .group-list-name')).toHaveCount(1);
    await expect(dialog.getByLabel('Configuration name')).toHaveValue('Remote DELIVERY');
    await expect(dialog.locator('.group-modal-dirty')).toHaveCount(0);
});

test('hierarchy pickers: loading, error with retry, resolved, unresolved, duplicate and unknown levels', async ({ page }) => {
    const state = await mockApp(page, {
        promoted: true, revision: 6, typesDelay: 600,
        bundle: promotedBundle({ delivery: { hierarchy: { planningIssueTypeId: '19999', parentIssueTypeId: '19003', ancestorIssueTypeId: '19007', optionalAncestorIssueTypeId: null } } }),
        types: [...TYPES, { id: '19008', name: 'Epic', hierarchyLevel: 1, projectIds: ['10'] }, { id: '19009', name: 'Epic', hierarchyLevel: 1, projectIds: [] }],
    });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-catalog-state="loading"]')).toContainText('Saved IDs are preserved');
    await expect(dialog.locator('[data-mapping-key="parentIssueTypeId"]')).toContainText('19003');
    await expect(dialog.locator('[data-mapping-key="planningIssueTypeId"]')).toContainText('19999 · Not found in Jira');
    await expect(dialog.locator('[data-catalog-state]')).toHaveCount(0);
    await expect(dialog.locator('[data-mapping-key="parentIssueTypeId"]')).toContainText('Initiative');
    await expect(dialog.locator('[data-mapping-key="ancestorIssueTypeId"]')).toContainText('Unknown hierarchy type');
    await expect(dialog.locator('[data-mapping-key="planningIssueTypeId"] .team-selector-label')).toHaveText('Epic (required)');
    await expect(dialog.locator('[data-mapping-key="ancestorIssueTypeId"] .team-selector-label')).toHaveText('Objective');
    await expect(dialog.locator('[data-mapping-key="optionalAncestorIssueTypeId"] .team-selector-label')).toHaveText('Strategy');
    // Unresolved selections show the raw id and can be removed, never silently dropped.
    await dialog.getByRole('button', { name: 'Remove Epic', exact: true }).click();
    const planning = dialog.locator('[data-mapping-key="planningIssueTypeId"]');
    await planning.locator('.team-search-input').fill('Epic');
    await expect(planning.locator('.team-search-result-item')).toHaveText([/Epic \(19002\)/, /Epic \(19008\)/]);
    await planning.locator('.team-search-input').fill('zzz');
    await expect(planning.locator('.team-search-result-item.is-empty')).toHaveText(/No matching issue types at this level/);
    // Unknown-level types are never offered.
    await dialog.locator('[data-mapping-key="ancestorIssueTypeId"]').getByRole('button', { name: 'Remove Objective' }).click();
    await dialog.locator('[data-mapping-key="ancestorIssueTypeId"] .team-search-input').fill('Unknown');
    await expect(dialog.locator('[data-mapping-key="ancestorIssueTypeId"] .team-search-result-item.is-empty')).toBeVisible();
    // Required labels on the shared field rows.
    await expect(dialog.getByText('Story Points Field (required)')).toBeVisible();
    await expect(dialog.getByText('Parent Name Field', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Delivery Owner Field', { exact: true })).toBeVisible();
    await nested(dialog, 'Source').click();
    await expect(dialog.getByText('Sprint Field (required)')).toBeVisible();
    expect(state.typesRequests).toBeGreaterThan(0);
});

test('a failing catalog shows the retry banner and recovers', async ({ page }) => {
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle(), typesStatus: 503 });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-catalog-state="error"]')).toContainText('Could not load Jira issue types. Saved IDs are preserved.');
    await expect(dialog.locator('[data-mapping-key="planningIssueTypeId"]')).toContainText('19002 · Jira catalog unavailable');
    state.typesStatus = 200;
    await dialog.getByRole('button', { name: 'Retry Jira catalog' }).click();
    await expect(dialog.locator('[data-catalog-state]')).toHaveCount(0);
    await expect(dialog.locator('[data-mapping-key="planningIssueTypeId"]')).toContainText('Epic');
});

test('captured Legacy filter needs explicit retirement confirmation and a stale mapping callback cannot undo a rename', async ({ page }) => {
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle({ legacy: { legacyIssueTypeNames: ['Story', 'Task'] } }) });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-captured-filter]')).toContainText('Story, Task');
    await dialog.getByLabel('Configuration name').fill('Legacy renamed');
    await dialog.getByRole('button', { name: 'Change captured issue-type filter' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Keep captured filter' }).click();
    await expect(dialog.locator('[data-captured-filter]')).toBeVisible();
    await pickField(dialog, /Delivery Owner Field/, 'Delivery', 'Delivery Owner');
    await expect(dialog.getByLabel('Configuration name')).toHaveValue('Legacy renamed');
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    const saved = state.workPosts[0].workConfigurations.configurations[0];
    expect(saved.name).toBe('Legacy renamed');
    expect(saved.legacyIssueTypeNames).toEqual(['Story', 'Task']);
    expect(saved.fields.deliveryOwner.fieldName).toBe('Delivery Owner');
});

test('range validation blocks Save with inline errors; names are unique', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    const through = dialog.locator('[data-range-row="throughQuarter"]');
    await dialog.getByRole('button', { name: 'Remove Through Sprint' }).click();
    await expect(through.locator('.work-config-range-error')).toContainText('Choose a Through Sprint');
    await expect(saveButton(dialog)).toBeDisabled();
    await through.getByLabel('Search Through Sprint').fill('2026Q3');
    await through.locator('.team-search-result-item', { hasText: '2026Q3' }).click();
    await expect(through.locator('.work-config-range-error')).toContainText('leave a gap');
    await expect(dialog.locator('.group-modal-validation')).toContainText('Save is blocked by 2 issues.');
    await expect(saveButton(dialog)).toBeDisabled();
    await dialog.getByRole('button', { name: 'Remove Through Sprint' }).click();
    await through.getByLabel('Search Through Sprint').fill('2026Q4');
    await through.locator('.team-search-result-item', { hasText: '2026Q4' }).click();
    await expect(through.locator('.work-config-range-error')).toHaveCount(0);
    await dialog.getByLabel('Configuration name').fill('delivery');
    await expect(dialog.locator('.group-list-name-error')).toHaveText('Use a different name for each configuration.');
    await expect(saveButton(dialog)).toBeDisabled();
});

test('mount states: unpromoted+off keeps the flat editor; promoted+off is guidance only; enabled uses the editor', async ({ page }) => {
    const off = await mockApp(page, { featureEnabled: false });
    let dialog = await openSettings(page);
    await expect(dialog.getByRole('tablist', { name: 'Admin settings sections' }).getByRole('tab')).toHaveText(['Scope projects', 'Jira source', 'Field mapping', 'Capacity', 'Priority weights', 'Access']);
    await expect(dialog.getByPlaceholder('Search projects to add...')).toBeVisible();
    expect(off.calls.filter(call => call.pathname === '/api/work-structure/config')).toHaveLength(0);
});

test('mount states: promoted+off never mounts the old forms and disables structural writes', async ({ page }) => {
    const state = await mockApp(page, { featureEnabled: false, promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('tablist', { name: 'Admin settings sections' }).getByRole('tab')).toHaveText(['Project config', 'Capacity', 'Priority weights', 'Access']);
    await dialog.getByRole('tab', { name: 'Project config' }).click();
    await expect(dialog.locator('[data-work-config-unavailable]')).toContainText('Project configurations unavailable');
    await expect(dialog.getByPlaceholder('Search projects to add...')).toHaveCount(0);
    await expect(dialog.getByText('Sprint Field')).toHaveCount(0);
    await expect(dialog.locator('[data-work-config-editor]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Test configuration' })).toHaveCount(0);
    await expect(saveButton(dialog)).toBeDisabled();
    expect(state.calls.filter(call => call.pathname === '/api/work-structure/config')).toHaveLength(0);
    expect(state.workPosts).toHaveLength(0);
});

test('nested tab, search state and drafts survive upper tab round trips; Test reads only the saved configuration', async ({ page }) => {
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Source').click();
    await dialog.getByLabel('Configuration name').fill('DELIVERY Q1');
    await dialog.getByRole('tab', { name: 'Access' }).click();
    await expect(dialog.locator('[data-work-config-editor]')).toHaveCount(0);
    await expect(dialog.getByRole('tab', { name: 'Project config' })).toHaveAttribute('aria-selected', 'false');
    await dialog.getByRole('tab', { name: 'Project config' }).click();
    await expect(row(dialog, 'delivery')).toHaveClass(/active/);
    await expect(nested(dialog, 'Source')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByLabel('Configuration name')).toHaveValue('DELIVERY Q1');
    // Test with a dirty draft only explains; it makes no request.
    await dialog.getByRole('button', { name: 'Test configuration' }).click();
    await expect(dialog.getByText('Save your changes before testing the saved configuration.')).toBeVisible();
    expect(state.calls.filter(call => call.pathname === '/api/test')).toHaveLength(0);
});

test('Departments are unchanged: the shared drawer rules do not touch their modal geometry', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await expect(dialog.getByRole('tab', { name: 'Team groups' })).toBeVisible();
    const departmentBox = await page.locator('.group-modal').boundingBox();
    expect(Math.abs(departmentBox.width - 375 * 0.94)).toBeLessThan(1);
    expect(departmentBox.height).toBeLessThanOrEqual(667 * 0.9 + 1);
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await projectTab(dialog);
    const projectBox = await page.locator('.group-modal').boundingBox();
    expect(Math.abs(projectBox.width - (375 - 16))).toBeLessThan(1);
});

for (const viewport of [{ width: 375, height: 667 }, { width: 667, height: 375 }, { width: 1024, height: 600 }]) {
    test(`one scroll owner and a reachable footer at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle({ legacy: { legacyIssueTypeNames: ['Story', 'Task'] } }) });
        const dialog = await openSettings(page);
        await projectTab(dialog);
        await quiet(page);
        const compact = viewport.width <= 820;
        if (compact) {
            await expect(dialog.getByRole('button', { name: 'Configurations', exact: true })).toBeVisible();
            await dialog.getByRole('button', { name: 'Configurations', exact: true }).click();
            await expect(dialog.locator('.group-pane-left')).toHaveClass(/is-mobile-active/);
            await dialog.locator('[data-work-config="delivery"] .group-list-select').click();
            await expect(dialog.locator('.group-pane-left')).not.toHaveClass(/is-mobile-active/);
        } else {
            await selectConfiguration(dialog, 'delivery');
        }
        for (const name of ['Scope', 'Source', 'Field mapping']) {
            await nested(dialog, name).click();
            const geometry = await page.evaluate(() => {
                const rect = element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }; };
                const content = document.querySelector('.group-modal-content');
                const panel = document.querySelector('.work-config-panel');
                const save = [...document.querySelectorAll('.group-modal-footer button')].find(button => button.textContent.trim() === 'Save');
                const cancel = [...document.querySelectorAll('.group-modal-footer button')].find(button => button.textContent.trim() === 'Cancel');
                const hit = element => { const box = element.getBoundingClientRect(); return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element; };
                return {
                    viewport: { width: window.innerWidth, height: window.innerHeight },
                    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
                    contentOverflow: content.scrollHeight - content.clientHeight,
                    panelOverflowY: getComputedStyle(panel).overflowY,
                    rightOverflowY: getComputedStyle(document.querySelector('.work-config-right')).overflowY,
                    panelRect: rect(panel), save: rect(save), saveHit: hit(save), cancelHit: hit(cancel),
                    footerBottom: rect(document.querySelector('.group-modal-footer')).bottom,
                };
            });
            expect(geometry.pageOverflow, `${name} horizontal page overflow`).toBeLessThanOrEqual(0);
            expect(geometry.contentOverflow, `${name} modal content must not be a second scroller`).toBeLessThanOrEqual(1);
            expect(geometry.panelOverflowY).toBe('auto');
            expect(geometry.rightOverflowY).toBe('hidden');
            expect(geometry.save.bottom, `${name} Save inside the viewport`).toBeLessThanOrEqual(geometry.viewport.height);
            expect(geometry.save.top).toBeGreaterThanOrEqual(0);
            expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewport.height + 0.5);
            expect(geometry.saveHit && geometry.cancelHit, `${name} footer buttons are the topmost elements`).toBe(true);
            expect(geometry.panelRect.bottom).toBeLessThanOrEqual(geometry.save.top + 1);
        }
        // The panel scrolls inside itself, including the ranges, and the footer stays put.
        await nested(dialog, 'Scope').click();
        const scrolled = await page.evaluate(() => {
            const panel = document.querySelector('.work-config-panel');
            const footer = document.querySelector('.group-modal-footer').getBoundingClientRect().top;
            panel.scrollTop = panel.scrollHeight;
            return { scrollable: panel.scrollHeight > panel.clientHeight, footerAfter: document.querySelector('.group-modal-footer').getBoundingClientRect().top, footer };
        });
        expect(scrolled.footerAfter).toBe(scrolled.footer);
        await page.screenshot({ path: path.join(shotDir, `geometry-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    });
}

for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
    test(`touch targets at ${viewport.width}: nested tabs, drawer close and Remove keep a usable hit area`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
        const dialog = await openSettings(page);
        await projectTab(dialog);
        await quiet(page);
        const minimum = async (locator, label) => {
            await locator.first().scrollIntoViewIfNeeded();
            const box = await locator.first().boundingBox();
            expect(box, label).not.toBeNull();
            expect(box.width, `${label} width`).toBeGreaterThanOrEqual(24);
            expect(box.height, `${label} height`).toBeGreaterThanOrEqual(24);
            const topmost = await locator.first().evaluate(element => {
                const rect = element.getBoundingClientRect();
                const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return element === at || element.contains(at);
            });
            expect(topmost, `${label} is not covered`).toBe(true);
        };
        for (const name of ['Scope', 'Source', 'Field mapping']) await minimum(nested(dialog, name), `${name} tab`);
        for (const name of ['Project config', 'Capacity', 'Priority weights']) await minimum(dialog.getByRole('tab', { name }), `${name} upper tab`);
        await chooseConfiguration(dialog, 'delivery', viewport.width <= 820);
        await nested(dialog, 'Scope').click();
        await minimum(dialog.getByRole('button', { name: 'Remove project PLAN' }), 'Remove project');
        if (viewport.width <= 820) {
            await dialog.getByRole('button', { name: 'Configurations', exact: true }).click();
            await minimum(dialog.locator('.group-pane-mobile-close'), 'drawer close');
            await dialog.locator('.group-pane-mobile-close').click();
            await expect(dialog.locator('.group-pane-left')).not.toHaveClass(/is-mobile-active/);
        }
        // Visible focus on the tab that has it.
        await nested(dialog, 'Scope').focus();
        await nested(dialog, 'Scope').press('ArrowRight');
        await expect(nested(dialog, 'Source')).toBeFocused();
        const outline = await nested(dialog, 'Source').evaluate(element => getComputedStyle(element).outlineStyle);
        expect(outline).not.toBe('none');
    });
}

// DELIVERY classifies Product/Tech by Allocation (plan Task A5): the Scope tab maps Allocation values with the
// Legacy project picker's controls. Synthetic values only.
const ALLOCATION_OPTIONS = { options: [{ value: 'Growth' }, { value: 'Platform' }], source: 'createmeta', complete: true };
const allocationBundle = (allocationTypes = []) => promotedBundle({ delivery: {
    fields: { sprint: field('Sprint'), storyPoints: field('Story Points'), parentName: blank(), team: field('Team'), projectTrack: blank(), deliveryOwner: blank(), allocation: field('RnD_allocation_category') },
    allocationTypes,
} });
const allocationPane = dialog => dialog.locator('[data-allocation-types]');
const allocationColumn = (dialog, label) => dialog.locator('.group-projects-subsection[data-allocation-type]').filter({ has: dialog.page().locator('.team-selector-label', { hasText: new RegExp(`^${label}$`) }) });

test('a Sprint value seen by both configurations is two labelled rows, and either stores the bare value', async ({ page }) => {
    const both = (value, ids) => ['legacy', 'delivery'].map((id, index) => ({ value, label: `${value} - ${id}`, canonical: true, state: 'future', sprintIds: [ids[index]], configurationIds: [id] }));
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle(), sprintValues: [
        ...both('2027Q2', [1102, 2202]), ...both('2027Q1', [1101, 2201]),
        { value: '2026Q4', label: '2026Q4', canonical: true, state: 'closed', sprintIds: [1004], configurationIds: ['legacy'] },
    ] });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    const through = dialog.locator('[data-range-row="throughQuarter"]');
    await dialog.getByRole('button', { name: 'Remove Through Sprint' }).click();
    await through.getByLabel('Search Through Sprint').fill('2027Q1');
    const rows = through.locator('.team-search-result-item');
    await expect(rows.locator('strong')).toHaveText(['2027Q1 - legacy', '2027Q1 - delivery']);
    await expect(rows.nth(1)).toContainText('Jira id 2201');
    const shots = path.join(__dirname, '..', '..', 'tmp', 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    await dialog.screenshot({ path: path.join(shots, 'scope-picker-suffix.png'), animations: 'disabled' });
    await rows.filter({ hasText: '2027Q1 - delivery' }).click();
    await expect(through.locator('.selected-team-chip .team-name')).toHaveText('2027Q1');

    await selectConfiguration(dialog, 'delivery');
    const from = dialog.locator('[data-range-row="fromQuarter"]');
    await dialog.getByRole('button', { name: 'Remove From Sprint' }).click();
    await from.getByLabel('Search From Sprint').fill('2027Q2');
    await from.locator('.team-search-result-item', { hasText: '2027Q2 - legacy' }).click();
    await expect(from.locator('.selected-team-chip .team-name')).toHaveText('2027Q2');
    await saveButton(dialog).click();
    await expect.poll(() => state.workPosts.length).toBe(1);
    const [legacy, delivery] = state.workPosts[0].workConfigurations.configurations;
    expect([legacy.throughQuarter, delivery.fromQuarter]).toEqual(['2027Q1', '2027Q2']);
    expect(JSON.stringify(state.workPosts[0])).not.toContain(' - legacy');
    expect(JSON.stringify(state.workPosts[0])).not.toContain(' - delivery');
});

test('DELIVERY Field mapping labels the Allocation field "Allocation"', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: allocationBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('.team-selector-label', { hasText: /^Allocation$/ })).toHaveCount(1);
    await expect(dialog.locator('.team-selector-label', { hasText: 'RnD_allocation_category' })).toHaveCount(0);
});

test('DELIVERY Scope maps Allocation values to Product and Tech with the project picker controls; Save posts allocationTypes only', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    const bundle = allocationBundle();
    const state = await mockApp(page, { promoted: true, revision: 6, bundle, allocationOptions: ALLOCATION_OPTIONS });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    await selectConfiguration(dialog, 'delivery');
    const pane = allocationPane(dialog);
    await expect(pane.locator('.team-selector-label').first()).toHaveText('Allocation');
    await expect(allocationColumn(dialog, 'Product').locator('.team-selector-empty')).toHaveCount(1);
    await expect(allocationColumn(dialog, 'Tech').locator('.team-selector-empty')).toHaveCount(1);

    const input = pane.locator('.team-search-input');
    await input.fill('Gro');
    const growth = pane.locator('.team-search-results .team-search-result-item', { hasText: 'Growth' });
    await expect(growth).toHaveCount(1);
    await expect(pane.locator('.team-search-results .team-search-result-item', { hasText: 'Platform' })).toHaveCount(0);
    const request = state.calls.filter(call => call.pathname === '/api/work-structure/allocation-options').pop();
    const params = new URLSearchParams(request.search);
    expect([params.get('fieldId'), params.get('projectKey'), params.get('issueTypeId'), params.get('query')]).toEqual(['customfield_19907', 'PLAN', '19002', 'Gro']);
    await expect(growth.locator('button.project-type-btn.product')).toHaveText('Product');
    await growth.locator('button.project-type-btn.tech').click();
    await expect(input).toHaveValue('');
    const techChip = allocationColumn(dialog, 'Tech').locator('.selected-team-chip.tech-chip', { hasText: 'Growth' });
    await expect(techChip).toHaveCount(1);

    await input.fill('Plat');
    await pane.locator('.team-search-result-item', { hasText: 'Platform' }).locator('button.project-type-btn.product').click();
    const productChip = allocationColumn(dialog, 'Product').locator('.selected-team-chip.product-chip', { hasText: 'Platform' });
    await expect(productChip).toHaveCount(1);
    // Already-mapped values are not offered again.
    await input.fill('Gro');
    await expect(pane.locator('.team-search-results .team-search-result-item', { hasText: 'Growth' })).toHaveCount(0);
    await input.fill('');

    // Element-level: every control carries its shared class, and no new class is introduced.
    for (const chip of [techChip, productChip]) {
        await expect(chip.locator('.team-name strong')).toHaveCount(1);
        await expect(chip.locator('button.remove-btn')).toHaveCount(1);
    }
    const classes = await dialog.locator('[data-allocation-types], [data-allocation-type]').evaluateAll(nodes => [...new Set(nodes.flatMap(node => [node, ...node.querySelectorAll('*')]).flatMap(node => [...node.classList]))].sort());
    expect(classes.filter(name => !['group-field-helper', 'group-projects-subsection', 'remove-btn', 'selected-team-chip', 'selected-teams-list', 'team-name', 'team-search-input', 'team-search-wrapper', 'team-selector-empty', 'team-selector-label', 'product-chip', 'tech-chip'].includes(name))).toEqual([]);
    await page.mouse.move(0, 0);
    await input.blur();
    const shots = path.join(__dirname, '..', '..', 'tmp', 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    await dialog.screenshot({ path: path.join(shots, 'delivery-scope-allocation-after.png'), animations: 'disabled' });
    await dialog.locator('.work-config-panel').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await dialog.screenshot({ path: path.join(shots, 'delivery-scope-allocation-after-scrolled.png'), animations: 'disabled' });

    await productChip.locator('button.remove-btn').click();
    await expect(productChip).toHaveCount(0);
    await saveButton(dialog).click();
    await expect.poll(() => state.workPosts.length).toBe(1);
    const posted = state.workPosts[0].workConfigurations.configurations;
    expect(posted[1].allocationTypes).toEqual([{ value: 'Growth', type: 'tech' }]);
    const { allocationTypes: _drop, ...restPosted } = posted[1];
    const { allocationTypes: _base, revision: _rev, ...restBase } = clone(bundle.configurations[1]);
    expect({ ...restPosted, revision: undefined }).toEqual({ ...restBase, revision: undefined });
    expect(posted[0]).toEqual(clone(bundle.configurations[0]));
});

test('Legacy Scope shows no Allocation picker', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: allocationBundle(), allocationOptions: ALLOCATION_OPTIONS });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'legacy');
    await expect(nested(dialog, 'Scope')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('.selected-team-chip', { hasText: 'OLD' })).toHaveCount(1);
    await expect(allocationPane(dialog)).toHaveCount(0);
});

test('an incomplete Allocation option list says typed values are allowed and offers the typed value', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: allocationBundle([{ value: 'Growth', type: 'product' }]), allocationOptions: { options: [{ value: 'Growth' }], source: 'autocomplete', complete: false } });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    const pane = allocationPane(dialog);
    await expect(allocationColumn(dialog, 'Product').locator('.selected-team-chip.product-chip', { hasText: 'Growth' })).toHaveCount(1);
    await pane.locator('.team-search-input').fill('Research');
    await expect(pane.locator('.group-field-helper', { hasText: 'type a value' })).toHaveCount(1);
    await pane.locator('.team-search-result-item', { hasText: 'Research' }).locator('button.project-type-btn.tech').click();
    await expect(allocationColumn(dialog, 'Tech').locator('.selected-team-chip.tech-chip', { hasText: 'Research' })).toHaveCount(1);
});

test('production screenshots: Scope, Source, Field mapping and the mobile drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle({ legacy: { legacyIssueTypeNames: ['Story', 'Task'] } }) });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    await selectConfiguration(dialog, 'delivery');
    for (const [name, file] of [['Scope', 'scope'], ['Source', 'source'], ['Field mapping', 'mapping']]) {
        await nested(dialog, name).click();
        await page.waitForTimeout(250);
        await dialog.screenshot({ path: path.join(shotDir, `delivery-${file}.png`), animations: 'disabled' });
    }
    await selectConfiguration(dialog, 'legacy');
    await nested(dialog, 'Field mapping').click();
    await page.waitForTimeout(250);
    await dialog.screenshot({ path: path.join(shotDir, 'legacy-mapping-captured-filter.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(250);
    await dialog.getByRole('button', { name: 'Configurations', exact: true }).click();
    await dialog.locator('[data-work-config="delivery"] .group-list-select').click();
    for (const [name, file] of [['Scope', 'scope'], ['Source', 'source'], ['Field mapping', 'mapping']]) {
        await nested(dialog, name).click();
        await page.waitForTimeout(250);
        await dialog.screenshot({ path: path.join(shotDir, `delivery-${file}-375.png`), animations: 'disabled' });
    }
    await dialog.getByRole('button', { name: 'Configurations', exact: true }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(shotDir, 'mobile-drawer-375.png'), animations: 'disabled' });
});

// --- Project config redesign: one global Jira IDs setting, one message per issue, collapsed preview ---------------

const idsToggle = dialog => dialog.getByRole('checkbox', { name: 'Jira IDs' });
const labelBoxes = dialog => dialog.locator('.work-config-panel .team-selector-label, .work-config-panel .selected-team-chip, .work-config-panel .group-field-helper, .work-config-panel .group-pane-title').evaluateAll(
    nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return [node.className, Math.round(box.x * 10) / 10, Math.round(box.y * 10) / 10, Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10]; }));

test('one global Jira IDs setting: no per-tab buttons, ids in a fixed slot, nothing moves when toggled, remembered per viewer', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    await selectConfiguration(dialog, 'delivery');
    await expect(idsToggle(dialog)).toHaveCount(1);
    await expect(idsToggle(dialog)).not.toBeChecked();
    for (const name of ['Scope', 'Source', 'Field mapping']) {
        await nested(dialog, name).click();
        await expect(dialog.getByRole('button', { name: /technical IDs/ })).toHaveCount(0);
    }
    for (const name of ['Source', 'Field mapping']) {
        await nested(dialog, name).click();
        await page.waitForTimeout(150);
        const before = await labelBoxes(dialog);
        const panelBefore = await dialog.locator('#work-config-panel').evaluate(node => [node.scrollHeight, node.scrollWidth]);
        await idsToggle(dialog).check();
        await page.waitForTimeout(150);
        const after = await labelBoxes(dialog);
        expect(after, `${name}: toggling Jira IDs moves nothing`).toEqual(before);
        expect(await dialog.locator('#work-config-panel').evaluate(node => [node.scrollHeight, node.scrollWidth])).toEqual(panelBefore);
        // Each id is printed once, in its slot, never inside the chip or the name.
        const visibleSlots = dialog.locator('.field-id-slot:not(.is-hidden)');
        expect(await visibleSlots.count()).toBeGreaterThan(0);
        // An id never paints over its label or chip.
        const collisions = await visibleSlots.evaluateAll(nodes => nodes.flatMap(node => {
            const box = node.getBoundingClientRect();
            const owner = node.closest('.group-projects-subsection');
            return [...owner.querySelectorAll('.team-selector-label, .selected-team-chip')].filter(other => {
                const o = other.getBoundingClientRect();
                return box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top;
            }).map(other => `${node.dataset.fieldId} over ${other.className}`);
        }));
        expect(collisions, `${name}: ids collide`).toEqual([]);
        await dialog.screenshot({ path: path.join(shotDir, `ids-on-${name.replace(' ', '-').toLowerCase()}.png`), animations: 'disabled' });
        await expect(dialog.locator('.selected-team-chip .field-id-hint')).toHaveCount(0);
        for (const text of await dialog.locator('.selected-team-chip').allInnerTexts()) expect(text).not.toMatch(/\(\d+\)/);
        // Hidden ids are laid out but invisible and unannounced.
        await idsToggle(dialog).uncheck();
        await expect(dialog.locator('.field-id-slot:not(.is-hidden)')).toHaveCount(0);
        expect(await dialog.locator('.field-id-slot').first().evaluate(node => getComputedStyle(node).visibility)).toBe('hidden');
    }
    await idsToggle(dialog).check();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.localStorage.getItem('jira_work_config_ids_v1'))).toBe('1');
    expect(await page.evaluate(() => Object.keys(JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}')).includes('workConfigIds'))).toBe(false);
});

test('the Jira IDs setting is remembered on the next visit', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('jira_work_config_ids_v1', '1'));
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await expect(idsToggle(dialog)).toBeChecked();
});

test('same-named issue types are told apart by project, and the preview is one line until expanded', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Field mapping').click();
    const section = dialog.locator('.mapping-preview-section');
    await expect(section).toContainText('Epic under Initiative');
    await expect(section.locator('.epic-block')).toHaveCount(0);
    const collapsed = await section.boundingBox();
    expect(collapsed.height).toBeLessThan(90);
    await section.getByRole('button', { name: 'Show preview' }).click();
    await expect(section.locator('.epic-block')).toBeVisible();
    expect((await section.boundingBox()).height).toBeGreaterThan(collapsed.height + 100);
    await section.getByRole('button', { name: 'Hide preview' }).click();
    await expect(section.locator('.epic-block')).toHaveCount(0);
    // Sprint is named where its field lives: the Epic card points to Source, Source names the Sprint field and Board rules.
    await expect(dialog.locator('[data-mapping-key="planningIssueTypeId"]')).toContainText('the Sprint field is set in Source');
    await nested(dialog, 'Source').click();
    await expect(dialog.locator('.work-config-panel')).toContainText('No board: Sprints seen on this project’s issues.');
    await expect(dialog.locator('.work-config-panel')).toContainText('Board set: also Sprints on that board.');
});

test('each blocking issue is stated once at its field; the footer carries one count that opens the first issue', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    await dialog.getByRole('button', { name: 'Remove Through Sprint' }).click();
    const text = 'Choose a Through Sprint.';
    await expect(dialog.getByText(text, { exact: true })).toHaveCount(1);
    const footer = dialog.locator('.group-modal-validation');
    await expect(footer).toContainText('Save is blocked by 1 issue.');
    await expect(footer).not.toContainText('Through Sprint');
    await expect(saveButton(dialog)).toBeDisabled();
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Source').click();
    await footer.getByRole('button', { name: 'Show first' }).click();
    await expect(row(dialog, 'legacy')).toHaveClass(/active/);
    await expect(nested(dialog, 'Scope')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('[data-work-config-issue]')).toBeFocused();
    expect(text).toBeTruthy();
});

test('the one-time hint carries the live-data note, is dismissed for good, and the range is shown once', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await expect(dialog.locator('[data-work-config-hint]')).toContainText('past views read live Jira data');
    await expect(dialog.locator('.work-config-header')).not.toContainText('onward');
    await expect(dialog.getByText('configurations', { exact: false }).filter({ hasText: /^\d+ configurations$/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Got it' }).click();
    await expect(dialog.locator('[data-work-config-hint]')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('jira_work_config_hint_v1'))).toBe('1');
});

// --- Audit fixes: state-driven guidance instead of sentences -----------------------------------------------------

test('tabs flag what is still missing and clear as the draft fills in; issue types stay disabled until the project is saved', async ({ page }) => {
    await mockApp(page);
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    await selectConfiguration(dialog, 'delivery');
    const flagged = name => nested(dialog, name).locator('.work-config-tab-flag');
    // Source starts complete: the Sprint field is shared with Legacy and the Board is inherited.
    for (const name of ['Scope', 'Field mapping']) await expect(flagged(name)).toHaveCount(1);
    await expect(flagged('Source')).toHaveCount(0);
    await dialog.getByPlaceholder('Search projects to add...').fill('PLAN');
    await dialog.locator('.team-search-result-item', { hasText: 'PLAN' }).getByRole('button', { name: 'Add' }).click();
    await expect(flagged('Scope')).toHaveCount(0);
    // A deliberate clear of the shared Sprint field flags Source again.
    await nested(dialog, 'Source').click();
    await dialog.getByRole('button', { name: 'Remove sprint field' }).click();
    await expect(flagged('Source')).toHaveCount(1);
    await nested(dialog, 'Field mapping').click();
    const epic = dialog.locator('[data-mapping-key="planningIssueTypeId"] .team-search-input');
    await expect(epic).toBeDisabled();
    await expect(epic).toHaveAttribute('placeholder', 'Save a Jira project first');
    await expect(flagged('Field mapping')).toHaveCount(1);
    // Legacy ships complete: nothing is flagged.
    await selectConfiguration(dialog, 'legacy');
    for (const name of ['Scope', 'Source', 'Field mapping']) await expect(flagged(name)).toHaveCount(0);
});

test('a saved board shows its name after a reload, not "Board <id>"', async ({ page }) => {
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'legacy');
    await nested(dialog, 'Source').click();
    await expect(dialog.locator('.work-config-panel .selected-team-chip', { hasText: 'Legacy board' })).toBeVisible();
    await expect(dialog.locator('.work-config-panel .selected-team-chip', { hasText: 'Board 7001' })).toHaveCount(0);
});

test('a saved field that Jira no longer lists is shown as not found and flags its tab', async ({ page }) => {
    const bundle = promotedBundle();
    bundle.configurations[1].fields.storyPoints = { fieldId: 'customfield_99999', fieldName: 'Old Points', mode: 'own' };
    await mockApp(page, { promoted: true, revision: 6, bundle });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await expect(nested(dialog, 'Field mapping').locator('.work-config-tab-flag')).toHaveCount(1);
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('.work-config-panel .selected-team-chip', { hasText: 'Old Points · not found in Jira' })).toBeVisible();
    await expect(dialog.locator('.work-config-panel .mapping-team-chip')).not.toContainText('not found');
});

test('the first edit does not change the Settings header height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle() });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await quiet(page);
    const header = dialog.locator('.group-modal-header');
    const clean = await header.evaluate(node => node.getBoundingClientRect().height);
    await selectConfiguration(dialog, 'delivery');
    await row(dialog, 'delivery').locator('.group-list-name-input').fill('DELIVERY X');
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    expect(await header.evaluate(node => node.getBoundingClientRect().height)).toBe(clean);
    await expect(dialog.locator('#settings-onboarding-replay-disabled')).toBeVisible();
});

test('a blank DELIVERY Board shows the Legacy Board it inherits; choosing a Board overrides it and only that is saved', async ({ page }) => {
    await mockApp(page);
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await nested(dialog, 'Source').click();
    const inherited = dialog.locator('[data-inherited-board="7001"]');
    await expect(inherited).toContainText('Legacy board');
    await expect(inherited).toContainText('Inherited from Legacy. Choose a board above to override it here.');
    await expect(inherited.getByRole('button', { name: 'Clear sprint board' })).toHaveCount(0);
    await expect(dialog.getByText('No board selected (fallback mode).')).toHaveCount(0);
    // Display only: nothing is dirty until an admin chooses a Board.
    await expect(saveButton(dialog)).toBeDisabled();
    await dialog.getByPlaceholder('Search boards...').fill('Delivery');
    await dialog.locator('.team-search-result-item', { hasText: 'Delivery board' }).click();
    await expect(inherited).toHaveCount(0);
    await expect(dialog.locator('.selected-team-chip', { hasText: 'Delivery board' })).toBeVisible();
    await selectConfiguration(dialog, 'legacy');
    await nested(dialog, 'Source').click();
    await expect(dialog.locator('[data-inherited-board]')).toHaveCount(0);
    await expect(dialog.locator('.selected-team-chip', { hasText: 'Legacy board' })).toBeVisible();
});

test('DELIVERY shares the Legacy Sprint, Story Points and Team fields; Sprint and Story Points can be overridden or cleared, Team is always the one shared field', async ({ page }) => {
    const shared = () => ({ fieldId: '', fieldName: '', mode: 'shared' });
    const bundle = promotedBundle({ delivery: { fields: { sprint: shared(), storyPoints: shared(), parentName: blank(), team: shared(), projectTrack: blank(), deliveryOwner: blank(), allocation: blank() } } });
    const state = await mockApp(page, { promoted: true, bundle });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    // Initial setup: nothing to pick; Legacy's fields show as DELIVERY's, marked shared.
    await nested(dialog, 'Source').click();
    await expect(dialog.locator('[data-field-share="sprint"]')).toHaveText('Same as Legacy. Remove it to give DELIVERY its own field.');
    await nested(dialog, 'Field mapping').click();
    // Team: one field for every configuration, shown without remove or search.
    const teamRow = dialog.locator('[data-map-key="team"]');
    await expect(teamRow.locator('[data-field-share="team"]')).toHaveText("Team is one field for every configuration: Legacy's.");
    await expect(teamRow.locator('.mapping-team-chip')).toContainText('Team');
    await expect(teamRow.getByRole('button', { name: 'Remove team field' })).toHaveCount(0);
    await expect(teamRow.locator('.team-search-input')).toHaveCount(0);
    await expect(saveButton(dialog)).toBeDisabled();
    // Override: remove the shared Story Points value, pick DELIVERY's own field.
    const pointsRow = dialog.locator('[data-map-key="storyPoints"]');
    await pointsRow.getByRole('button', { name: 'Remove story points field' }).click();
    await expect(pointsRow.locator('[data-field-share="storyPoints"]')).toContainText('DELIVERY uses its own field.');
    await pickField(dialog, /Story Points Field/, 'Delivery', 'Delivery Owner');
    // Deliberate clear of the Sprint field: own and blank, which is missing rather than shared.
    await nested(dialog, 'Source').click();
    await dialog.getByRole('button', { name: 'Remove sprint field' }).click();
    await expect(dialog.locator('[data-field-share="sprint"]').getByRole('button', { name: 'Same as Legacy' })).toBeVisible();
    await saveButton(dialog).click();
    await expect.poll(() => state.workPosts.length).toBe(1);
    const sent = state.workPosts[0].workConfigurations.configurations.find(entry => entry.id === 'delivery').fields;
    expect(sent.team).toEqual(shared());
    expect(sent.storyPoints).toEqual({ fieldId: 'customfield_19905', fieldName: 'Delivery Owner', mode: 'own' });
    expect(sent.sprint).toEqual({ fieldId: '', fieldName: '', mode: 'own' });
    // Reload: the saved states read back as they were chosen.
    await page.reload();
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.getByRole('dialog').first();
    await reopened.getByRole('button', { name: 'Admin' }).click();
    await projectTab(reopened);
    await selectConfiguration(reopened, 'delivery');
    await nested(reopened, 'Field mapping').click();
    await expect(reopened.locator('[data-map-key="storyPoints"] .mapping-sp-chip')).toContainText('Delivery Owner');
    await nested(reopened, 'Source').click();
    await expect(reopened.locator('[data-field-share="sprint"]')).toContainText('DELIVERY uses its own field.');
    // Back to shared through the explicit action.
    await reopened.locator('[data-field-share="sprint"]').getByRole('button', { name: 'Same as Legacy' }).click();
    await expect(reopened.locator('[data-field-share="sprint"]')).toContainText('Same as Legacy');
});

test('a saved workspace without captured Jira type names asks for one Save of the unchanged bundle, then settles', async ({ page }) => {
    const bundle = promotedBundle();
    const summary = (id, roleTypes) => ({ id, name: id === 'legacy' ? 'Legacy' : 'DELIVERY', revision: 1, model: id === 'legacy' ? 'legacy' : 'rnd_2027', roleTypes });
    const legacyNames = { planning: { id: null, name: 'Story', hierarchyLevel: 0 }, parent: { id: null, name: 'Epic', hierarchyLevel: 1 }, ancestor: { id: null, name: 'Initiative', hierarchyLevel: 2 }, optionalAncestor: null };
    const state = await mockApp(page, {
        promoted: true, revision: 6, bundle,
        summaries: [summary('legacy', legacyNames), summary('delivery', { planning: null, parent: null, ancestor: null, optionalAncestor: null })],
    });
    // The server's names-only path: the unchanged bundle is stored as is and the names are captured.
    state.afterWorkPost = current => {
        current.summaries = [summary('legacy', legacyNames), summary('delivery', {
            planning: { id: '19002', name: 'Epic', hierarchyLevel: 1 }, parent: { id: '19003', name: 'Initiative', hierarchyLevel: 2 }, ancestor: null, optionalAncestor: null,
        })];
    };
    const dialog = await openSettings(page);
    await projectTab(dialog);
    // Legacy keeps its compatibility names: with only its catalog loaded there is nothing to capture.
    await nested(dialog, 'Field mapping').click();
    await expect(dialog.locator('[data-catalog-state]')).toHaveCount(0);
    await expect(dialog.locator('[data-work-config-type-names]')).toHaveCount(0);
    await expect(saveButton(dialog)).toBeDisabled();
    await selectConfiguration(dialog, 'delivery');
    await expect(dialog.locator('[data-work-config-type-names]')).toHaveText('Jira type names need saving.');
    await expect(dialog.locator('[data-work-config-type-names]')).toHaveClass('group-field-helper work-config-note');
    await expect(dialog.locator('[data-settings-save-note]')).toHaveText('Jira type names need saving: DELIVERY.');
    await selectConfiguration(dialog, 'legacy');
    await expect(dialog.locator('[data-work-config-type-names]')).toHaveCount(0);
    await expect(dialog.locator('[data-settings-save-note]')).toHaveText('Jira type names need saving: DELIVERY.');
    await selectConfiguration(dialog, 'delivery');
    await expect(saveButton(dialog)).toBeEnabled();
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
    expect(state.workPosts[0].workConfigurations).toEqual(bundle);
    expect(state.workPosts[0].clearProjectsForConfigurationIds).toEqual([]);

    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.getByRole('dialog').first();
    await reopened.getByRole('button', { name: 'Admin' }).click();
    await projectTab(reopened);
    await selectConfiguration(reopened, 'delivery');
    await nested(reopened, 'Field mapping').click();
    // The catalog is loaded and the captured names match it, so nothing is left to save.
    await expect(reopened.locator('[data-catalog-state]')).toHaveCount(0);
    await expect(reopened.locator('[data-mapping-key="parentIssueTypeId"]')).toContainText('Initiative');
    await expect(reopened.locator('[data-work-config-type-names]')).toHaveCount(0);
    await expect(saveButton(reopened)).toBeDisabled();
    await expect(reopened.locator('[data-settings-save-note]')).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
});

const uncapturedSummaries = () => [
    { id: 'legacy', name: 'Legacy', revision: 1, model: 'legacy', roleTypes: { planning: { id: null, name: 'Story', hierarchyLevel: 0 }, parent: { id: null, name: 'Epic', hierarchyLevel: 1 }, ancestor: { id: null, name: 'Initiative', hierarchyLevel: 2 }, optionalAncestor: null } },
    { id: 'delivery', name: 'DELIVERY', revision: 1, model: 'rnd_2027', roleTypes: { planning: null, parent: null, ancestor: null, optionalAncestor: null } },
];
async function openWithPendingNames(page, options = {}) {
    const state = await mockApp(page, { promoted: true, revision: 6, bundle: promotedBundle(), summaries: uncapturedSummaries(), ...options });
    const dialog = await openSettings(page);
    await projectTab(dialog);
    await selectConfiguration(dialog, 'delivery');
    await expect(dialog.locator('[data-work-config-type-names]')).toBeVisible();
    return { state, dialog };
}

test('Discard acknowledges uncaptured type names for the session: reopening asks nothing', async ({ page }) => {
    const { state, dialog } = await openWithPendingNames(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const reopened = page.getByRole('dialog').first();
    await reopened.getByRole('button', { name: 'Departments' }).click();
    await expect(reopened.getByRole('tab', { name: 'Team groups' })).toBeVisible();
    await expect(saveButton(reopened)).toBeDisabled();
    await expect(reopened.locator('.group-modal-dirty')).toHaveCount(0);
    await expect(reopened.locator('[data-settings-save-note]')).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Admin' }).click();
    await projectTab(reopened);
    await selectConfiguration(reopened, 'delivery');
    await expect(reopened.locator('[data-work-config-type-names]')).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
    await expect(reopened).toHaveCount(0);
    expect(state.workPosts).toHaveLength(0);
});

test('a names-only Save posts the bundle without Board side effects or admin analytics', async ({ page }) => {
    const { state, dialog } = await openWithPendingNames(page, { analyticsEnabled: true });
    const before = state.calls.length;
    await saveButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
    await page.waitForTimeout(300);
    const delta = state.calls.slice(before).map(call => call.pathname);
    expect(delta.filter(path => path === '/api/config')).toHaveLength(1);
    expect(delta.filter(path => path === '/api/sprints')).toEqual([]);
    const sections = await page.evaluate(() => (window.dataLayer || [])
        .filter(entry => entry?.event_name === 'settings_action' && ['save', 'save_result'].includes(entry.workflow_action))
        .map(entry => entry.section));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections).not.toContain('admin');
});

test('an unrelated Departments Save carries pending type names without Board side effects or admin analytics', async ({ page }) => {
    const { state, dialog } = await openWithPendingNames(page, { analyticsEnabled: true });
    await dialog.getByRole('button', { name: 'Departments' }).click();
    await dialog.locator('.group-list-item.active input').first().fill('Platform renamed');
    const before = state.calls.length;
    await saveButton(dialog).click();
    await expect(page.locator('.group-modal')).toHaveCount(0);
    expect(state.workPosts).toHaveLength(1);
    expect(state.workPosts[0].workConfigurations).toEqual(promotedBundle());
    expect(state.groupPosts).toBe(1);
    await page.waitForTimeout(300);
    const delta = state.calls.slice(before).map(call => call.pathname);
    expect(delta.filter(path => path === '/api/sprints')).toEqual([]);
    const sections = await page.evaluate(() => (window.dataLayer || [])
        .filter(entry => entry?.event_name === 'settings_action' && ['save', 'save_result'].includes(entry.workflow_action))
        .map(entry => entry.section));
    expect(sections).toContain('departments');
    expect(sections).not.toContain('admin');
});
