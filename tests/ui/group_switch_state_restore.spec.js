// Group A to B to A restores per-group App state, and the saved-preferences object keeps its 62 keys (B0b).
// Mocked pages only: the host just scopes localStorage, and it must never be the live 5050 server.
process.env.JEP_TEST_BASE_URL ||= 'http://localhost:5051';
const { test, expect } = require('@playwright/test');
const { appBaseUrl, installPinFixture, settle, sprintId, sprintName } = require('./eng_alert_pin_fixture');

const PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const savedPrefs = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), PREFS_KEY);

// FROZEN copy of the object passed to saveUiPrefs({...}) in the ui-prefs save useEffect of dashboard.jsx
// (62 keys, read from the source once at the B0b baseline). saveUiPrefs replaces the whole stored object, so a
// dropped key silently loses that preference; an added key must be added here on purpose. Keys marked "group"
// are also part of the per-group snapshot; the rest (device or session preferences) are not.
const FROZEN_SAVED_PREF_KEYS = [
    'selectedView', 'epmTab', 'epmSelectedProjectId', 'epmProjectSort', 'engEpicSort',
    'planningLayout', 'planningTeamsEffortExpanded', 'planningInheritedHintDismissals',
    'selectedSprint', 'sprintName', 'sprintCatalog', 'selectedTeams', 'activeGroupId',
    'showPlanning', 'showStats', 'showScenario', 'showBoard', 'showDependencies', 'showTech', 'showProduct',
    'engStatusFilter', 'engPriorityFilter', 'groupByInitiativeChoice', 'searchQuery',
    'statsView', 'statsGraphMode', 'burnoutAssigneeFilter', 'burndownMetric',
    'cohortStartQuarter', 'cohortEndQuarter', 'cohortMode', 'cohortClosedStartQuarter', 'cohortClosedEndQuarter',
    'cohortLastN', 'cohortGroupBy', 'cohortProjectFilter', 'cohortExcludeAdHoc', 'cohortExcludeCapacity', 'cohortStatusToggles',
    'excludedCapacityStartSprintId', 'excludedCapacityEndSprintId', 'excludedCapacitySelectedEpicKeys',
    'excludedCapacityChartMode', 'excludedCapacityMetric',
    'projectTrackCapacitySide', 'projectTrackMode', 'projectTrackExcludeAdHoc', 'projectTrackExcludeExcludedCapacity',
    'scenarioLaneMode', 'hideExcludedStats',
    'showMissingAlert', 'showBlockedAlert', 'showPostponedAlert', 'showBacklogAlert', 'showMissingTeamAlert',
    'showMissingLabelsAlert', 'showNeedsStoriesAlert', 'showWaitingAlert', 'showEmptyEpicAlert', 'showDoneEpicAlert',
    'showAlertsPanel', 'groupVisibilityPreferences',
];
// Keys that are not part of the per-group state (device/session preferences, caches and the group preference itself).
const NON_GROUP_PREF_KEYS = [
    'epmTab', 'epmSelectedProjectId', 'epmProjectSort', 'engEpicSort', 'planningLayout',
    'planningTeamsEffortExpanded', 'planningInheritedHintDismissals', 'selectedView', 'sprintName', 'sprintCatalog',
    'searchQuery', 'scenarioLaneMode', 'groupVisibilityPreferences',
];

const techStory = (index) => ({
    id: `TECH-${index}`, key: `TECH-${index}`,
    fields: {
        summary: `Synthetic tech story ${index}`, status: { name: 'To Do' }, priority: { name: 'Major' },
        issuetype: { name: 'Story' }, assignee: { displayName: 'Synthetic Owner' }, updated: '2026-05-01T00:00:00.000+0000',
        customfield_10004: 2, epicKey: 'TECH-EPIC', parentSummary: 'Synthetic tech epic', projectKey: 'TECH',
        teamId: 'team-alpha', teamName: 'Alpha Team', sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
    },
});
const techEpic = {
    key: 'TECH-EPIC', summary: 'Synthetic tech epic', status: { name: 'In Progress' }, priority: { name: 'High' },
    assignee: { displayName: 'Epic Owner' }, projectKey: 'TECH', projectClass: 'tech', teamId: 'team-alpha', teamName: 'Alpha Team',
    sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
};
const burnoutPayload = {
    data: {
        range: { startDate: '2026-04-01', endDate: '2026-04-15' },
        issuesMeta: [
            { issueKey: 'PIN-1', createdDate: '2026-03-27', teamAtStart: { id: 'team-alpha', name: 'Alpha Team' }, teamAtCreated: { id: 'team-alpha', name: 'Alpha Team' }, assignee: { id: 'alpha-owner', name: 'Alpha Owner' } },
            { issueKey: 'PIN-2', createdDate: '2026-04-03', teamAtStart: { id: 'team-alpha', name: 'Alpha Team' }, teamAtCreated: { id: 'team-alpha', name: 'Alpha Team' }, assignee: { id: 'beta-owner', name: 'Beta Owner' } },
        ],
        events: [{ issueKey: 'PIN-1', date: '2026-04-07', bucket: 'done', teamId: 'team-alpha', teamName: 'Alpha Team', assigneeName: 'Alpha Owner' }],
        assignees: [{ id: 'alpha-owner', name: 'Alpha Owner', events: 1 }, { id: 'beta-owner', name: 'Beta Owner', events: 1 }],
    },
};

// The pin fixture (Default and Second groups, one Product Sprint of PIN-* alerts) plus a Tech project and one dependency.
async function openDashboard(page, { prefs = {}, tech = false, burnout = false } = {}) {
    await installPinFixture(page, { prefs });
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/dependencies', route => json(route, { dependencies: {
        'PIN-8': [{ key: 'PIN-9', category: 'block', direction: 'inward', dependentKey: 'PIN-8', prereqKey: 'PIN-9', status: 'To Do' }],
    } }));
    if (tech) {
        await page.route('**/api/tasks-with-team-name**', (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.get('project') !== 'tech' || url.searchParams.get('purpose')
                || (url.searchParams.get('groupId') || 'grp-default') !== 'grp-default') return route.fallback();
            return json(route, { issues: [techStory(1), techStory(2)], epics: { 'TECH-EPIC': techEpic }, epicsInScope: [techEpic], names: {} });
        });
    }
    if (burnout) await page.route('**/api/stats/burnout', route => json(route, burnoutPayload));
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await settle(page);
}

async function switchGroup(page, name, id) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await page.locator('.view-selector .group-dropdown-toggle').click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: name }).click();
    await settle(page);
    await expect(page.locator('.view-selector .group-dropdown-toggle')).toContainText(name);
    await expect.poll(async () => (await savedPrefs(page)).activeGroupId).toBe(id);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(350);
    await settle(page);
}
const toA = page => switchGroup(page, 'Default', 'grp-default');
const toB = page => switchGroup(page, 'Second', 'grp-second');

async function openFilters(page) {
    const trigger = page.locator('.fb-trigger', { hasText: 'Filters' });
    await trigger.click();
    await expect(page.locator('.pop-host .popover[aria-label="Filters"]')).toBeVisible();
    await settle(page);
}
async function closeFilters(page) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.pop-host .popover')).toHaveCount(0);
}
const facetOption = (page, facet, option) => page.locator(`.pop-group[data-facet="${facet}"] [data-option="${option}"]`);

test('the saved-preferences object keeps exactly its frozen 62 keys', async ({ page }) => {
    // The frozen list itself: 62 distinct keys, at least 8 of them outside the per-group state.
    expect(FROZEN_SAVED_PREF_KEYS).toHaveLength(62);
    expect(new Set(FROZEN_SAVED_PREF_KEYS).size).toBe(62);
    expect(NON_GROUP_PREF_KEYS.length).toBeGreaterThanOrEqual(8);
    for (const key of NON_GROUP_PREF_KEYS) expect(FROZEN_SAVED_PREF_KEYS, key).toContain(key);

    await openDashboard(page, { tech: true });
    // One interaction makes the app save its whole object after load; read it through the app's own save effect.
    await page.locator('.alerts-panel-toggle').click();
    await settle(page);
    await expect(page.locator('.alerts-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    const prefs = await savedPrefs(page);
    const stored = Object.keys(prefs);
    // JSON drops undefined values, so a key the fixture leaves undefined cannot be seen; none may be missing.
    expect(FROZEN_SAVED_PREF_KEYS.filter(key => !stored.includes(key)), 'frozen keys missing from the saved object').toEqual([]);
    expect(stored.filter(key => !FROZEN_SAVED_PREF_KEYS.includes(key)), 'keys added to the saved object').toEqual([]);
    expect([...stored].sort()).toEqual([...FROZEN_SAVED_PREF_KEYS].sort());
    // Key by key: a present key keeps a typed (non-undefined) value after the seeded fixture state.
    for (const key of FROZEN_SAVED_PREF_KEYS) expect(Object.prototype.hasOwnProperty.call(prefs, key), key).toBe(true);
    expect(prefs.showAlertsPanel).toBe(false);
    expect(prefs.activeGroupId).toBe('grp-default');
    expect(prefs.groupVisibilityPreferences).toHaveProperty('visibleGroupIds');
});

test('A to B to A restores alert toggles, dismissed alerts, ENG filters, Tech/Product and dependency focus', async ({ page }) => {
    test.setTimeout(90000);
    await openDashboard(page, { tech: true });
    const card = id => page.locator(`#eng-alert-${id}`);
    await expect(card('blocked')).not.toHaveClass(/collapsed/);
    await expect(card('followup')).not.toHaveClass(/collapsed/);

    // Alert toggles (two categories) and a dismissed alert.
    await card('blocked').locator('.alert-toggle').click();
    await card('followup').locator('.alert-toggle').click();
    await settle(page);
    await expect(card('blocked')).toHaveClass(/collapsed/);
    await expect(card('followup')).toHaveClass(/collapsed/);
    await expect(card('missing')).not.toHaveClass(/collapsed/);
    await page.locator('#eng-alert-missing .alert-story').first().locator('.alert-remove').click();
    await settle(page);
    await expect(page.locator('#eng-alert-missing .alert-story')).toHaveCount(1);

    // ENG filters: a Status option off, and the Tech/Product Projects facet with Product off.
    await openFilters(page);
    await facetOption(page, 'status', 'Done').click();
    await expect(facetOption(page, 'status', 'Done')).toHaveAttribute('aria-pressed', 'false');
    await expect(facetOption(page, 'projects', 'tech')).toBeVisible();
    await facetOption(page, 'projects', 'product').click();
    await expect(facetOption(page, 'projects', 'product')).toHaveAttribute('aria-pressed', 'false');
    await closeFilters(page);
    await settle(page);
    // Product off leaves only Tech stories; turn Product back on so the dependency chip (Product stories) is visible.
    await openFilters(page);
    await facetOption(page, 'projects', 'product').click();
    await facetOption(page, 'projects', 'tech').click();
    await expect(facetOption(page, 'projects', 'product')).toHaveAttribute('aria-pressed', 'true');
    await expect(facetOption(page, 'projects', 'tech')).toHaveAttribute('aria-pressed', 'false');
    await closeFilters(page);
    await settle(page);

    // Dependency focus: the chip on a Story focuses its dependency chain.
    const chip = page.locator('[data-dep-chip]').first();
    const focusedKey = await chip.getAttribute('data-task-key');
    await chip.click();
    await settle(page);
    await expect(page.locator('.task-item.is-focused')).toHaveCount(1);
    await expect(page.locator('.task-item.is-focused')).toHaveAttribute('data-task-key', focusedKey);

    const before = await savedPrefs(page);
    expect(before.showBlockedAlert).toBe(false);
    expect(before.showPostponedAlert).toBe(false);
    expect(before.showMissingAlert).toBe(true);
    expect(before.showTech).toBe(false);
    expect(before.showProduct).toBe(true);

    await toB(page);
    await expect(page.locator('.task-item.is-focused')).toHaveCount(0);
    await toA(page);

    // Restored in A.
    await expect(card('blocked')).toHaveClass(/collapsed/);
    await expect(card('followup')).toHaveClass(/collapsed/);
    await expect(card('missing')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#eng-alert-missing .alert-story')).toHaveCount(1);
    await expect(page.locator('.task-item.is-focused')).toHaveCount(1);
    await expect(page.locator('.task-item.is-focused')).toHaveAttribute('data-task-key', focusedKey);
    await openFilters(page);
    await expect(facetOption(page, 'status', 'Done')).toHaveAttribute('aria-pressed', 'false');
    await expect(facetOption(page, 'projects', 'product')).toHaveAttribute('aria-pressed', 'true');
    await expect(facetOption(page, 'projects', 'tech')).toHaveAttribute('aria-pressed', 'false');
    await closeFilters(page);
    const after = await savedPrefs(page);
    for (const key of ['showBlockedAlert', 'showPostponedAlert', 'showMissingAlert', 'showTech', 'showProduct', 'engStatusFilter']) {
        expect(after[key], key).toEqual(before[key]);
    }
});

test('A to B to A restores selected Planning tasks', async ({ page }) => {
    test.setTimeout(60000);
    await openDashboard(page, { prefs: { showPlanning: true } });
    const box = key => page.getByRole('checkbox', { name: `Select ${key} for sprint planning`, exact: true });
    await box('PIN-1').check();
    await box('PIN-3').check();
    await settle(page);
    await expect(page.locator('.task-item.is-planning-selected')).toHaveCount(2);
    await toB(page);
    await expect(page.locator('.task-item.is-planning-selected')).toHaveCount(0);
    await toA(page);
    await expect(page.locator('.task-item.is-planning-selected')).toHaveCount(2);
    await expect(box('PIN-1')).toBeChecked();
    await expect(box('PIN-3')).toBeChecked();
    await expect(box('PIN-2')).not.toBeChecked();
});

test('a lone showAlertsPanel toggle survives A to B to A and reaches the saved preferences', async ({ page }) => {
    await openDashboard(page);
    const toggle = page.locator('.alerts-panel-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await settle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await savedPrefs(page)).showAlertsPanel).toBe(false);
    await toB(page);
    await toA(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await savedPrefs(page)).showAlertsPanel).toBe(false);
});

test('A to B to A keeps the deliberate quirk: the Burndown assignee resets to all', async ({ page }) => {
    test.setTimeout(60000);
    await openDashboard(page, { burnout: true, prefs: { showStats: true, statsView: 'burnout', burnoutAssigneeFilter: 'all' } });
    const assignee = () => page.locator('.stats-view.open .stats-control-group', { hasText: 'Assignee' }).locator('select');
    await expect(assignee()).toBeVisible();
    await assignee().selectOption('alpha-owner');
    await expect(assignee()).toHaveValue('alpha-owner');
    await expect.poll(async () => (await savedPrefs(page)).burnoutAssigneeFilter).toBe('alpha-owner');
    await toB(page);
    await toA(page);
    await expect(page.locator('.stats-panel.open .stats-view-toggle').getByRole('radio', { name: 'Burndown' })).toHaveAttribute('aria-checked', 'true');
    // Original App at d0f8bc79 resets a valid saved assignee while scoped data reloads; the refactor preserves it.
    await expect(assignee()).toHaveValue('all');
});
