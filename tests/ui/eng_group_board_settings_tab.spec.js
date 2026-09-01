const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

// The Boards sub-tab and the Team groups "Configure board" pointer, mounted for real (unlike
// tests/ui/group_board_composer.spec.js, which renders the composer through a standalone harness
// because nothing mounted it yet). This spec exercises the real dashboard.jsx: the tab wiring,
// the Save gate (an empty column blocks Save, a Min/Max breach does not), and the round trip of
// `board` through POST /api/groups-config.

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = path.join(__dirname, '..', '..', 'test-results', 'eng-group-board-settings-tab');

let fixture;

test.beforeAll(async () => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    fixture = await import('../fixtures/groupBoardReference.mjs');
});

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (_) {
        return null;
    }
}

// Expands a { statusName: count } map into synthetic sprint-scoped epics, the same shape the
// dashboard buckets into `epicsByStatus` for the composer's Min/Max preview.
function epicsFromCounts(counts) {
    const epics = [];
    let n = 0;
    Object.entries(counts).forEach(([statusName, count]) => {
        for (let i = 0; i < count; i += 1) {
            n += 1;
            epics.push({ key: `EPC-${n}`, status: { name: statusName } });
        }
    });
    return epics;
}

function baseGroupsConfig() {
    return {
        version: 1,
        groups: [
            {
                id: 'northwind',
                name: 'Northwind',
                teamIds: ['team-a'],
                missingInfoComponents: [],
                excludedCapacityEpics: [],
                adHocCapacityEpics: [],
                teamLabels: {},
                board: fixture.referenceBoard(),
            },
            {
                id: 'southridge',
                name: 'Southridge',
                teamIds: ['team-b'],
                missingInfoComponents: [],
                excludedCapacityEpics: [],
                adHocCapacityEpics: [],
                teamLabels: {},
            },
        ],
        defaultGroupId: 'northwind',
        configRevision: 2,
        source: 'workspace_db',
        preferences: {
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['northwind', 'southridge'],
            activeGroupId: 'northwind',
            effectiveVisibleGroupIds: ['northwind', 'southridge'],
        },
    };
}

async function mockConfigSettings(page, { groupsConfig = baseGroupsConfig() } = {}) {
    const calls = [];
    const epicsInScope = epicsFromCounts(fixture.REFERENCE_EPICS_BY_STATUS);

    await installDashboardShell(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng',
            selectedSprint: 42,
        }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            body: requestBody(request),
        });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/me/connections/home-token') return json({
            connected: true,
            provider: 'atlassian_user_api_token',
            credentialSubject: 'profile@example.com',
            status: 'active',
            needsReconnect: false,
        });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example',
            projectsConfigured: true,
            settingsAdminOnly: false,
            userCanEditSettings: true,
            userCanEditEpmConfig: true,
            epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} },
        });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') return json(groupsConfig);
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            // Stateful, so a reload's GET reflects what was just saved (the round-trip test).
            const savedBody = requestBody(request);
            groupsConfig.groups = savedBody.groups;
            groupsConfig.defaultGroupId = savedBody.defaultGroupId;
            groupsConfig.configRevision = (groupsConfig.configRevision || 0) + 1;
            return json({
                ...savedBody,
                configRevision: groupsConfig.configRevision,
                source: 'workspace_db',
                preferences: groupsConfig.preferences,
            });
        }
        if (url.pathname === '/api/groups-preferences') return json({ preferences: groupsConfig.preferences });
        if (url.pathname === '/api/epm/config' && request.method() === 'GET') return json({
            version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {},
        });
        if (url.pathname === '/api/epm/scope') return json({ cloudId: 'synthetic-cloud', error: '' });
        if (url.pathname === '/api/epm/goals') return json({ goals: [], error: '' });
        if (url.pathname === '/api/epm/projects/configuration') return json({ projects: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [] });
        if (url.pathname === '/api/projects/selected') return json({ selected: [{ key: 'DEMO', type: 'product' }] });
        if (url.pathname === '/api/board-config' && request.method() === 'GET') return json({ boardId: fixture.REFERENCE_BOARD_ID, boardName: 'Delivery Board' });
        if (url.pathname === '/api/board-config/statuses') return json(fixture.referenceStatusesResponse());
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/capacity/config') return json({});
        if (url.pathname === '/api/sprint-field/config') return json({ fieldId: 'customfield_10020', fieldName: 'Sprint' });
        if (url.pathname === '/api/parent-name-field/config') return json({ fieldId: 'customfield_10021', fieldName: 'Parent Link' });
        if (url.pathname === '/api/story-points-field/config') return json({ fieldId: 'customfield_10022', fieldName: 'Story points' });
        if (url.pathname === '/api/team-field/config') return json({ fieldId: 'customfield_10023', fieldName: 'Team' });
        if (url.pathname === '/api/delivery-owner-field/config') return json({ fieldId: 'customfield_11147', fieldName: 'Delivery Owner' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });

    return calls;
}

async function openBoardsTab(page, dialog) {
    await dialog.getByRole('tab', { name: 'Boards' }).click();
    await expect(page.locator('#department-settings-boards-panel')).toBeVisible();
}

test('Boards is a leaf tab under Departments, distinct from the top-level tab bar', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    const boardsTab = dialog.getByRole('tab', { name: 'Boards' });
    await expect(boardsTab).toHaveAttribute('id', 'department-settings-boards-tab');
    // Boards must not also appear as a top-level tab (Admin / Departments / Connections / EPM).
    await expect(dialog.getByRole('button', { name: 'Boards', exact: true })).toHaveCount(0);

    await openBoardsTab(page, dialog);
    await expect(dialog.locator('.group-board-composer')).toBeVisible();
});

test('selecting a group in the Boards tab scopes the composer, and switching groups switches its columns', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);

    // Northwind (the default active group) has the 7-column reference board.
    await expect(dialog.locator('.board-column')).toHaveCount(7);

    await dialog.locator('.group-pane-list .group-list-item', { hasText: 'Southridge' }).click();
    // Southridge has no board: zero columns, and the composer's own empty-board message.
    await expect(dialog.locator('.board-column')).toHaveCount(0);
    await expect(dialog.getByText('This group has no board configured. Add a column to compose one.')).toBeVisible();

    await dialog.locator('.group-pane-list .group-list-item', { hasText: 'Northwind' }).click();
    await expect(dialog.locator('.board-column')).toHaveCount(7);
});

test('the Configure board line in Team groups summarizes and navigates, holding no controls', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Northwind is already active (defaultGroupId), so Team groups opens on it.
    const boardSection = dialog.locator('.component-selector-label', { hasText: /^Board$/ }).locator('xpath=..');
    await expect(boardSection.locator('.group-modal-meta')).toHaveText('7 columns');
    // Only the one navigation button — no inputs, no selects, no other buttons.
    await expect(boardSection.locator('button')).toHaveCount(1);
    await expect(boardSection.locator('input, select, textarea')).toHaveCount(0);

    await boardSection.getByRole('button', { name: 'Configure board →' }).click();
    await expect(dialog.locator('#department-settings-boards-panel')).toBeVisible();
    await expect(dialog.locator('.board-column')).toHaveCount(7);
});

test('a group with no board configured renders honestly in Team groups and in the Boards tab', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.locator('.group-pane-list .group-list-item', { hasText: 'Southridge' }).click();
    const boardSection = dialog.locator('.component-selector-label', { hasText: /^Board$/ }).locator('xpath=..');
    await expect(boardSection.locator('.group-modal-meta')).toHaveText('No board configured');

    await openBoardsTab(page, dialog);
    await expect(dialog.locator('.board-column')).toHaveCount(0);
    await expect(dialog.getByText('This group has no board configured. Add a column to compose one.')).toBeVisible();
});

test('an empty column blocks Save with the validation banner; a Min/Max breach does not', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);

    const saveButton = dialog.getByRole('button', { name: /^Save$/ });
    const validationBanner = dialog.locator('.group-modal-validation');
    // Positional, not hasText: the column name lives in an <input> value, which is invisible to
    // text-content matching — the reference fixture's first column is "To do" (statuses: ["To Do"]).
    const toDoColumn = dialog.locator('.board-column').first();

    // A harmless rename makes the draft dirty without touching any status, so the reference
    // config's two pre-existing breaches (Analysis under min, In progress over max) can be
    // observed not blocking Save on their own — Save starting disabled with "No changes to
    // save" would otherwise make this assertion vacuous.
    await toDoColumn.locator('.board-column-name').fill('To do!');
    await expect(dialog.locator('.board-column.is-breach')).toHaveCount(2);
    await expect(saveButton).toBeEnabled();
    await expect(validationBanner).toHaveCount(0);

    // Empty the same column by removing its only status.
    await toDoColumn.locator('.component-chip .remove-btn').first().click();
    await expect(toDoColumn).toHaveClass(/is-empty/);

    await expect(saveButton).toBeDisabled();
    await expect(validationBanner).toContainText('has no statuses');

    // Undo by putting the status back — Save must recover.
    await toDoColumn.getByRole('button', { name: '+ Add status' }).click();
    await toDoColumn.getByRole('button', { name: /To Do/ }).click();
    await expect(saveButton).toBeEnabled();
    await expect(validationBanner).toHaveCount(0);
});

test('a min above its max is a schema error that blocks Save, distinct from a Min/Max breach', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);

    const saveButton = dialog.getByRole('button', { name: /^Save$/ });
    const validationBanner = dialog.locator('.group-modal-validation');
    const toDoColumn = dialog.locator('.board-column').first();
    const minInput = toDoColumn.locator('.board-column-limits input').first();
    const maxInput = toDoColumn.locator('.board-column-limits input').nth(1);

    // D24's other severity: unlike a Min/Max breach (asserted above never blocking Save), a
    // schema-invalid min > max is validateComposerBoard's own error and must block Save.
    await minInput.fill('10');
    await minInput.blur();
    await maxInput.fill('5');
    await maxInput.blur();

    await expect(saveButton).toBeDisabled();
    await expect(validationBanner).toContainText('has a min above its max');
});

test('editing columns round-trips through POST /api/groups-config and survives a reload', async ({ page }) => {
    const calls = await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    let dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);

    await dialog.locator('.board-column').first().locator('.board-column-name').fill('Backlog');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);

    const save = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(save).toBeTruthy();
    const savedGroup = save.body.groups.find(g => g.id === 'northwind');
    expect(savedGroup.board).toBeTruthy();
    expect(savedGroup.board.columns.find(c => c.name === 'Backlog')).toBeTruthy();

    // Survives a reload: the next GET returns the same saved shape, and the composer reflects it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Backlog');
});

test('Export JSON downloads only the selected saved group instead of the unsaved draft', async ({ page }) => {
    const calls = await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.locator('.group-pane-list .group-list-item', { hasText: 'Southridge' }).click();
    await dialog.getByRole('textbox', { name: 'Department name' }).fill('Unsaved draft name');
    await dialog.locator('summary', { hasText: 'Advanced' }).click();
    const initialGetCount = calls.filter(call => call.method === 'GET' && call.pathname === '/api/groups-config').length;
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await dialog.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;

    await expect.poll(() => calls.filter(call => call.method === 'GET' && call.pathname === '/api/groups-config').length)
        .toBe(initialGetCount + 1);
    expect(download.suggestedFilename()).toBe('group-southridge.json');
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported).toEqual({
        version: 1,
        group: {
            id: 'southridge',
            name: 'Southridge',
            teamIds: ['team-b'],
            missingInfoComponents: [],
            excludedCapacityEpics: [],
            adHocCapacityEpics: [],
            teamLabels: {},
        },
    });
});

test('Import JSON updates only a newly created selected group and preserves sibling groups', async ({ page }) => {
    const calls = await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    let dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: '+ Add group' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Department name' })).toHaveValue('New Group');
    await dialog.locator('summary', { hasText: 'Advanced' }).click();
    await dialog.getByRole('button', { name: 'Import JSON' }).click();
    await dialog.locator('textarea').fill(JSON.stringify({
        version: 1,
        group: {
            id: 'source-group',
            name: 'Source group',
            teamIds: ['team-c'],
            missingInfoComponents: ['Needs refinement'],
            excludedCapacityEpics: ['DEMO-1'],
            adHocCapacityEpics: ['DEMO-2'],
            teamLabels: { 'team-c': 'team-c-label' },
        },
    }));
    await dialog.getByRole('button', { name: 'Apply Import' }).click();

    await page.waitForTimeout(200);
    expect(calls.filter(call => call.method === 'POST' && call.pathname !== '/api/auth/refresh')).toHaveLength(0);
    await expect(dialog.locator('.group-pane-list .group-list-item')).toHaveCount(3);
    await expect(dialog.locator('.group-pane-list .group-list-item', { hasText: 'Northwind' })).toBeVisible();
    await expect(dialog.locator('.group-pane-list .group-list-item', { hasText: 'Southridge' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Department name' })).toHaveValue('New Group');
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);

    const save = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(save.body).toEqual({
        version: 1,
        baseRevision: 2,
        groups: [
            {
                id: 'northwind',
                name: 'Northwind',
                teamIds: ['team-a'],
                missingInfoComponents: [],
                excludedCapacityEpics: [],
                adHocCapacityEpics: [],
                teamLabels: {},
                board: fixture.referenceBoard(),
            },
            {
                id: 'southridge',
                name: 'Southridge',
                teamIds: ['team-b'],
                missingInfoComponents: [],
                excludedCapacityEpics: [],
                adHocCapacityEpics: [],
                teamLabels: {},
            },
            {
                id: 'new-group',
                name: 'New Group',
                teamIds: ['team-c'],
                missingInfoComponents: ['Needs refinement'],
                excludedCapacityEpics: ['DEMO-1'],
                adHocCapacityEpics: ['DEMO-2'],
                teamLabels: { 'team-c': 'team-c-label' },
            },
        ],
        defaultGroupId: 'northwind',
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    dialog = page.getByRole('dialog').first();
    await expect(dialog.locator('.group-pane-list .group-list-item')).toHaveCount(3);
    await expect(dialog.locator('.group-pane-list .group-list-item', { hasText: 'New Group' })).toBeVisible();
});

test('deleting every column preserves an explicit empty board and blocks Save', async ({ page }) => {
    const calls = await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);

    for (let i = 0; i < 7; i += 1) {
        await dialog.locator('.board-column .remove-btn[title="Delete column"]').first().click();
    }
    await expect(dialog.locator('.board-column')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeDisabled();
    await expect(dialog.locator('.group-modal-validation')).toContainText('A board needs at least one column.');
    expect(calls.some(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toBe(false);
});

test('reference configuration screenshot with element-level text-clip assertions', async ({ page }) => {
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);
    await expect(dialog.locator('.board-column')).toHaveCount(7);

    // Let CSS transitions settle before capturing.
    await page.waitForTimeout(300);

    const clipped = await dialog.locator(
        '.group-modal-meta, .group-modal-warning, .board-add-status, .board-column-limits label, .component-name, .board-add-column'
    ).evaluateAll((nodes) => nodes
        .filter((node) => node.offsetParent !== null)
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => `${node.className}@${Math.round(node.getBoundingClientRect().width)}px`));
    expect(clipped).toEqual([]);

    await dialog.screenshot({ path: `${screenshotDir}/boards-tab-reference-configuration.png`, animations: 'disabled' });
});

test('the Boards split uses the real 30/70 panes, and the composer pane scrolls to reach its full content', async ({ page }) => {
    // A short viewport guarantees the reference board's stacked sections (columns, unmapped pool,
    // preview, messages) overflow the fixed-height modal, regardless of how much content the
    // reference fixture happens to carry.
    await page.setViewportSize({ width: 1280, height: 480 });
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);
    await expect(dialog.locator('.board-column')).toHaveCount(7);
    await page.waitForTimeout(300);

    // The 30/70 split Team groups uses (.group-pane-left / .group-pane-right), not an accidental
    // near-even split from two classes with no stylesheet rule.
    const leftPane = dialog.locator('.group-pane-left');
    const rightPane = dialog.locator('.group-pane-right');
    const [leftBox, rightBox] = await Promise.all([leftPane.boundingBox(), rightPane.boundingBox()]);
    const totalWidth = leftBox.width + rightBox.width;
    expect(leftBox.width / totalWidth).toBeGreaterThan(0.25);
    expect(leftBox.width / totalWidth).toBeLessThan(0.35);
    expect(rightBox.width / totalWidth).toBeGreaterThan(0.65);
    expect(rightBox.width / totalWidth).toBeLessThan(0.75);

    // The composer pane itself must be the scrolling container (overflow-y: auto), not the
    // overflow: hidden modal body above it — otherwise content past the fold is unreachable.
    const [scrollHeight, clientHeight] = await rightPane.evaluate((node) => [node.scrollHeight, node.clientHeight]);
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // Reachability, proven by interaction, not just geometry: scroll to and click + Add column.
    const addColumnButton = dialog.locator('.board-add-column');
    await addColumnButton.scrollIntoViewIfNeeded();
    await addColumnButton.click();
    await expect(dialog.locator('.board-column')).toHaveCount(8);
});

test('at a narrow viewport, the Boards tab group list is reachable via the mobile Groups button and returns to the composer on pick', async ({ page }) => {
    // No spec in the suite exercised a narrow viewport on any group pane before this test: at
    // <=820px .group-pane-left defaults to translateX(-105%) (off-screen) and, unlike Team
    // groups, the Boards tab had no trigger that ever set showGroupListMobile to true.
    await page.setViewportSize({ width: 375, height: 760 });
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);

    const leftPane = dialog.locator('.group-pane-left');
    const groupsButton = dialog.locator('.group-pane-right .group-pane-mobile-header').getByRole('button', { name: 'Groups' });

    // Off-screen by default. A negative x confirms translateX(-105%) is really in effect, not
    // merely that the is-mobile-active class string happens to be absent.
    await expect(leftPane).not.toHaveClass(/is-mobile-active/);
    const hiddenBox = await leftPane.boundingBox();
    expect(hiddenBox.x).toBeLessThan(0);

    await expect(groupsButton).toBeVisible();
    await groupsButton.click();
    await expect(leftPane).toHaveClass(/is-mobile-active/);

    // Let the 0.25s transform transition finish before reading geometry, or the box is caught
    // mid-slide and still reads deeply negative.
    await page.waitForTimeout(300);
    const visibleBox = await leftPane.boundingBox();
    expect(visibleBox.x).toBeGreaterThanOrEqual(0);

    // The existing exit path (setShowGroupListMobile(false) on selection, line 54) returns to the
    // composer, now scoped to the picked group — reachable in both directions.
    await dialog.locator('.group-pane-list .group-list-item', { hasText: 'Southridge' }).click();
    await expect(leftPane).not.toHaveClass(/is-mobile-active/);
    await expect(dialog.getByText('This group has no board configured. Add a column to compose one.')).toBeVisible();
});

// normalizeGroupsConfig (groupConfigUtils.js) shallow-copies an imported board's columns without
// normalizing members, so any element shape valid JSON allows can reach
// fromStoredBoard/validateComposerBoard as-is. These two rows are the ones that actually throw
// pre-fix: `column` itself null (fromStoredBoard's own `column.id`), and — the row below this
// table — a well-formed column whose `statuses` array holds a non-string entry, which survives
// unfiltered into <StatusPill label={status}> and crashes React on render. (A string/number/
// boolean/array column, or a well-formed object with wrong-typed scalar fields, was already safe
// before this fix — JS property access on a non-null object or an autoboxed primitive never
// throws — so those shapes are covered as contract/totality assertions in
// tests/test_group_board_model.js rather than padded into this table as if they reproduced a
// crash here.)
const malformedImportedColumnShapes = [
    ['an object missing statuses', { name: 'A' }],
    ['a null column', null],
];

malformedImportedColumnShapes.forEach(([label, columnShape]) => {
    test(`a malformed imported board (${label}) shows a validation message instead of crashing the app`, async ({ page }) => {
        await mockConfigSettings(page);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Manage team groups' }).click();
        const dialog = page.getByRole('dialog').first();

        await dialog.locator('summary', { hasText: 'Advanced' }).click();
        await dialog.getByRole('button', { name: 'Import JSON' }).click();
        const malformed = JSON.stringify({
            groups: [{ id: 'x', name: 'Imported group', board: { columns: [columnShape] } }],
        });
        await dialog.locator('textarea').fill(malformed);
        await dialog.getByRole('button', { name: 'Apply Import' }).click();

        // Must not white-screen: the dialog and its Save gate stay present and responsive, with a
        // validation message rather than a silent crash.
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeDisabled();
        await expect(dialog.locator('.group-modal-validation')).toContainText('has no statuses');
    });
});

test('a non-string status entry in an imported column shows the board instead of crashing composer render', async ({ page }) => {
    // Distinct from the table above: this column is otherwise well-formed (has a name), so it
    // never trips the validation-memo crash — the crash this closes is one hop further, inside
    // GroupBoardSettings actually rendering the column's statuses as <StatusPill> children.
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.locator('summary', { hasText: 'Advanced' }).click();
    await dialog.getByRole('button', { name: 'Import JSON' }).click();
    const malformed = JSON.stringify({
        group: { id: 'x', name: 'Imported group', board: { columns: [{ name: 'A', statuses: [{}] }] } },
    });
    await dialog.locator('textarea').fill(malformed);
    await dialog.getByRole('button', { name: 'Apply Import' }).click();
    await expect(dialog).toBeVisible();

    await dialog.getByRole('tab', { name: 'Boards' }).click();
    await expect(dialog.locator('#department-settings-boards-panel')).toBeVisible();
    // The malformed status was dropped, not coerced into a fake string status: one empty column.
    await expect(dialog.locator('.board-column')).toHaveCount(1);
    await expect(dialog.locator('.board-column').first()).toHaveClass(/is-empty/);
    expect(pageErrors).toEqual([]);
});
