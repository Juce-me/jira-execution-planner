const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = path.join(__dirname, '..', '..', 'test-results', 'settings-unified-save-qa');

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

// Expands a { statusName: count } map into synthetic sprint-scoped epics, the shape the dashboard
// buckets into `epicsByStatus` for the composer.
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
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'], board: fixture.referenceBoard() },
        ],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
        preferences: {
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
            effectiveVisibleGroupIds: ['platform'],
        },
    };
}

// What another user's save left on the server: same group, a different first column name, and a
// revision ahead of the draft's baseRevision (2). Renaming the column is what makes "kept my
// draft" and "took theirs" distinguishable in the composer.
function conflictingServerConfig() {
    const config = baseGroupsConfig();
    config.groups[0].board.columns[0].name = 'Server Column';
    config.configRevision = 9;
    return config;
}

async function mockConfigSettings(page, {
    groupsConfig = baseGroupsConfig(),
    conflictCurrents = [],
    failGroupsSaveOnce = null,
    capacityConfig = {},
    priorityWeights = [],
    // Synthetic id: the Delivery Owner custom field id differs per Jira instance and the
    // product ships no default for it (O11).
    deliveryOwnerFieldConfig = { fieldId: 'customfield_20501', fieldName: 'Delivery Owner' },
    extraFields = [],
} = {}) {
    const calls = [];
    const epicsInScope = epicsFromCounts(fixture.REFERENCE_EPICS_BY_STATUS);
    let groupsPostCount = 0;
    const epmConfig = {
        version: 2,
        labelPrefix: 'rnd_project_',
        scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] },
        projects: {},
    };

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
            search: url.search,
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
            epm: epmConfig,
        });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') return json(groupsConfig);
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            groupsPostCount += 1;
            if (failGroupsSaveOnce && groupsPostCount === 1) {
                return json(failGroupsSaveOnce.body, failGroupsSaveOnce.status);
            }
            // The optimistic lock rejecting an attempt, exactly as
            // backend/services/shared_group_config.py:173-175 does. One entry per rejected POST.
            const conflict = conflictCurrents[groupsPostCount - 1];
            if (conflict) {
                return json({
                    error: 'group_config_conflict',
                    message: 'Team groups were changed by another user.',
                    current: conflict,
                }, 409);
            }
            return json({
                ...requestBody(request),
                configRevision: (conflictCurrents[conflictCurrents.length - 1]?.configRevision || 2) + 1,
                source: 'workspace_db',
                preferences: groupsConfig.preferences,
            });
        }
        if (url.pathname === '/api/groups-preferences') return json({ preferences: groupsConfig.preferences });
        if (url.pathname === '/api/epm/config' && request.method() === 'GET') return json(epmConfig);
        if (url.pathname === '/api/epm/config' && request.method() === 'POST') return json(requestBody(request));
        if (url.pathname === '/api/epm/scope') return json({ cloudId: 'synthetic-cloud', error: '' });
        if (url.pathname === '/api/epm/goals') {
            if (url.searchParams.get('rootGoalKey')) {
                return json({ goals: [{ id: 'child', key: 'CHILD-200', name: 'Child Goal' }], error: '' });
            }
            return json({ goals: [{ id: 'root', key: 'ROOT-100', name: 'Root Goal' }], error: '' });
        }
        if (url.pathname === '/api/epm/projects/configuration') return json({ projects: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [] });
        if (url.pathname === '/api/projects/selected') return json({ selected: [{ key: 'DEMO', type: 'product' }] });
        if (url.pathname === '/api/projects') return json({ projects: [{ key: 'DEMO', name: 'Demo' }, { key: 'EXTRA', name: 'Extra' }] });
        if (url.pathname === '/api/fields') {
            // The real /api/fields answers a `project` query from that project's createmeta
            // screens, which is a subset of the instance's field catalog: a custom field that
            // is not on the project's create screens is simply absent. The mapping pickers
            // configure instance-wide fields, so they must ask for the unscoped catalog.
            const scoped = [
                { id: 'customfield_10020', name: 'Sprint' },
                { id: 'customfield_10099', name: 'Sprint (new)' },
            ];
            if (url.searchParams.get('project')) return json({ fields: scoped, scoped: true });
            return json({
                fields: [...scoped, { id: 'customfield_20501', name: 'Delivery Owner' }, ...extraFields],
                scoped: false,
            });
        }
        if (url.pathname === '/api/board-config') return json({ boardId: fixture.REFERENCE_BOARD_ID, boardName: 'Synthetic Board' });
        if (url.pathname === '/api/board-config/statuses') return json(fixture.referenceStatusesResponse());
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: priorityWeights });
        if (url.pathname === '/api/capacity/config') return json(capacityConfig);
        if (url.pathname === '/api/sprint-field/config') return json({ fieldId: 'customfield_10020', fieldName: 'Sprint' });
        if (url.pathname === '/api/parent-name-field/config') return json({ fieldId: 'customfield_10021', fieldName: 'Parent Link' });
        if (url.pathname === '/api/story-points-field/config') return json({ fieldId: 'customfield_10022', fieldName: 'Story points' });
        if (url.pathname === '/api/team-field/config') return json({ fieldId: 'customfield_10023', fieldName: 'Team' });
        if (url.pathname === '/api/delivery-owner-field/config') return json(deliveryOwnerFieldConfig);
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });

    return calls;
}

async function openBoardsTab(page, dialog) {
    await dialog.getByRole('tab', { name: 'Boards' }).click();
    await expect(page.locator('#department-settings-boards-panel')).toBeVisible();
}

// Renames the first board column, which is the cheapest edit that makes `groups[].board` dirty
// and is visible in the composer afterwards.
async function makeBoardDraftDirty(page, dialog, name) {
    await openBoardsTab(page, dialog);
    await dialog.locator('.board-column').first().locator('.board-column-name').fill(name);
}

function groupsPosts(calls) {
    return calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config');
}

test('a 409 keeps the dirty board draft instead of overwriting it, and says so', async ({ page }) => {
    await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    const conflictResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/groups-config');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    expect((await conflictResponse).status()).toBe(409);
    // Let the rejection handler's state updates flush; without this the assertions below can pass
    // against the pre-rejection render and prove nothing.
    await page.waitForTimeout(300);

    // The defect: applySavedGroupsConfig(errorPayload.current) replaced groupDraft with the server
    // config, so the composer re-seeded to "Server Column" and the user's layout was gone.
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Local Column');
    // ...and the baseline reset made the form stop reading as dirty, so there was nothing left to save.
    await expect(dialog.locator('.group-modal-dirty')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeEnabled();

    // Element-level, not a substring of the whole modal: the banner's own lines, in order.
    const banner = dialog.locator('.group-modal-validation');
    const lines = banner.locator(':scope > div:not(.group-modal-button-row)');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveText('• Team groups changed while you were editing. Your board layout is unsaved.');
    await expect(lines.nth(1)).toHaveText('• Nothing else was saved.');
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Discard mine' })).toBeVisible();
    // The modal stays open: losing the draft to a dismissed modal is the same defect.
    await expect(dialog).toBeVisible();

    // Fix 3: the exits render ahead of the footer in DOM order, so without a focus target here a
    // keyboard user tabbing forward from the Save click that produced this conflict sails past them
    // and has to Shift+Tab back. Focus must land in the alert itself when it appears.
    await expect(banner).toBeFocused();

    // No line or exit is clipped by the banner box.
    const clipped = await banner.locator(':scope > div, :scope button').evaluateAll((nodes) => nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => `${node.className || node.tagName}@${Math.round(node.getBoundingClientRect().width)}px`));
    expect(clipped).toEqual([]);
    await banner.screenshot({ path: `${screenshotDir}/groups-config-conflict-banner.png`, animations: 'disabled' });
    await dialog.screenshot({ path: `${screenshotDir}/groups-config-conflict-modal.png`, animations: 'disabled' });
});

test('Keep mine re-POSTs the local board rebased onto the server revision', async ({ page }) => {
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await dialog.locator('.group-modal-validation').getByRole('button', { name: 'Keep mine' }).click();

    await expect(dialog).toHaveCount(0);
    const posts = groupsPosts(calls);
    expect(posts).toHaveLength(2);
    // Rebase, not retry: re-sending baseRevision 2 would 409 forever.
    expect(posts[0].body.baseRevision).toBe(2);
    expect(posts[1].body.baseRevision).toBe(9);
    // The user's groups win whole — the same columns, in the same order, with the same ids.
    const rejected = posts[0].body.groups.find(group => group.id === 'platform');
    const kept = posts[1].body.groups.find(group => group.id === 'platform');
    expect(kept.board.columns[0].name).toBe('Local Column');
    expect(kept.board.columns).toEqual(rejected.board.columns);
    expect(kept.teamIds).toEqual(rejected.teamIds);
});

test('a second conflict rebases again rather than replaying a revision the server already rejected', async ({ page }) => {
    const second = conflictingServerConfig();
    second.configRevision = 14;
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig(), second] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    const banner = dialog.locator('.group-modal-validation');
    await banner.getByRole('button', { name: 'Keep mine' }).click();
    // Rejected again, by someone who saved in between: the banner comes back rather than the
    // draft being lost on the second round.
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Local Column');
    await banner.getByRole('button', { name: 'Keep mine' }).click();

    await expect(dialog).toHaveCount(0);
    // Strictly advancing, never repeated: each attempt carries the newest revision the server
    // reported, which is why this terminates instead of looping on a stale one.
    expect(groupsPosts(calls).map(post => post.body.baseRevision)).toEqual([2, 9, 14]);
});

test('a non-409 save failure keeps the existing error path, with no conflict banner', async ({ page }) => {
    await mockConfigSettings(page, { failGroupsSaveOnce: { status: 500, body: { error: 'Server exploded' } } });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    const failedResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/groups-config');
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    expect((await failedResponse).status()).toBe(500);
    await page.waitForTimeout(300);

    // Today's behaviour, unchanged: the error text in the Team groups pane, no exits to choose
    // between, modal open, draft intact.
    await expect(dialog.locator('.group-modal-validation')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Keep mine' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Team groups' }).click();
    await expect(dialog.locator('.group-modal-warning')).toContainText('Server exploded');
    await expect(dialog).toBeVisible();
});

test('Discard mine applies the server config and clears the dirty state', async ({ page }) => {
    await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await dialog.locator('.group-modal-validation').getByRole('button', { name: 'Discard mine' }).click();

    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Server Column');
    await expect(dialog.locator('.group-modal-validation')).toHaveCount(0);
    await expect(dialog.locator('.group-modal-dirty')).toHaveCount(0);
    const saveButton = dialog.getByRole('button', { name: /^Save$/ });
    await expect(saveButton).toBeDisabled();
    await expect(saveButton).toHaveAttribute('title', 'No changes to save');
    // Deliberate choice, not a dismissal: the modal is still open on the server's board.
    await expect(dialog).toBeVisible();
});

test('the conflict banner names the sections that committed before the rejected groups POST', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        conflictCurrents: [conflictingServerConfig()],
        capacityConfig: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Capacity is section 4 of the twelve, committed by its own endpoint before the groups POST.
    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.locator('#admin-settings-capacity-panel').getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.locator('#admin-settings-capacity-panel').getByRole('button', { name: 'Remove capacity project' }).click();

    await dialog.getByRole('button', { name: 'Departments' }).click();
    await makeBoardDraftDirty(page, dialog, 'Local Column');
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    const banner = dialog.locator('.group-modal-validation');
    await expect(banner).toContainText('Capacity');
    await expect(banner).toContainText('already saved');
    // The rejected half is named too, or "saved" reads as if everything went through.
    await expect(banner).toContainText('Team groups changed while you were editing.');
    // The claim is checked against the wire, not just against its own label list.
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/capacity/config')).toHaveLength(1);
    expect(groupsPosts(calls)).toHaveLength(1);
});

// Fix 1: EPM settings save after the groups POST inside saveAllSettings, so a rejected groups POST
// never reaches it — dirty EPM was also a change, and it was also skipped, exactly like the group
// draft itself. The old fallback line claimed groups/board "were the only change" whenever nothing
// had committed through the admin-gated endpoints, which is false here: EPM is a second unsaved
// change the banner never named.
test('the conflict banner names EPM settings as pending instead of claiming groups were the only change', async ({ page }) => {
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');

    await dialog.getByRole('button', { name: /^Save$/ }).click();

    const banner = dialog.locator('.group-modal-validation');
    const lines = banner.locator(':scope > div:not(.group-modal-button-row)');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(1)).toHaveText('• EPM settings is also unsaved.');
    await expect(banner).not.toContainText('only change');
    // EPM never reached its own endpoint: saveAllSettings returns as soon as saveGroupsConfig throws.
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/epm/config')).toHaveLength(0);
});

// Fix 2: the trigger is any dirty group draft (D45), not only a dirty board, but the mandated
// "Your board layout is unsaved." sentence was written for the board-only trigger. A user who edits
// only teamIds must not be told about a board they never touched.
test('the conflict headline names what changed instead of a board the user never touched', async ({ page }) => {
    await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig()] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Dirty teamIds only — every other conflict test in this file dirties the board too.
    await dialog.locator('.selected-team-chip .remove-btn').first().click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    const banner = dialog.locator('.group-modal-validation');
    const lines = banner.locator(':scope > div:not(.group-modal-button-row)');
    await expect(lines.nth(0)).toHaveText('• Team groups changed while you were editing. Your changes are unsaved.');
    await expect(banner).not.toContainText('board layout');
});

// Fix 4: a plain footer Save while a conflict is open replays the stale baseRevision and must 409
// again rather than silently rebasing — auto-rebasing the ordinary Save is exactly the choice "Keep
// mine" exists to make explicit. Nothing pinned this before.
test('a plain Save while a conflict is open 409s again and the banner returns with the newer revision', async ({ page }) => {
    const second = conflictingServerConfig();
    second.configRevision = 14;
    const calls = await mockConfigSettings(page, { conflictCurrents: [conflictingServerConfig(), second] });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    const banner = dialog.locator('.group-modal-validation');
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();

    // Not Keep mine: the plain footer Save, which still carries the original stale baseRevision (2).
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(banner.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await expect(dialog.locator('.board-column').first().locator('.board-column-name')).toHaveValue('Local Column');

    const posts = groupsPosts(calls);
    expect(posts).toHaveLength(2);
    expect(posts[0].body.baseRevision).toBe(2);
    expect(posts[1].body.baseRevision).toBe(2);
    // The banner now carries the second rejection's newer revision (14), not the first's (9) —
    // proof the retry actually 409ed again instead of the first banner simply staying on screen.
    await banner.getByRole('button', { name: 'Keep mine' }).click();
    await expect(dialog).toHaveCount(0);
    expect(groupsPosts(calls).map(post => post.body.baseRevision)).toEqual([2, 2, 14]);
});

test('the unified save persists every dirty section together, group board included', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        capacityConfig: { project: 'DEMO', fieldId: 'customfield_10050', fieldName: 'Capacity' },
        priorityWeights: [{ priority: 'P1', weight: 0.5 }],
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    // Departments: the group itself and its board, both inside the one groups payload.
    await dialog.getByPlaceholder('Group name').fill('Platform Core');
    await makeBoardDraftDirty(page, dialog, 'Local Column');

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Scope projects' }).click();
    await dialog.getByPlaceholder('Search projects to add...').fill('EXTRA');
    await dialog.locator('.team-search-result-item', { hasText: 'EXTRA' }).getByRole('button', { name: 'Product' }).click();

    // The global board id — the other thing called "board config", saved by its own endpoint.
    await dialog.getByRole('tab', { name: 'Jira source' }).click();
    await dialog.getByRole('button', { name: 'Clear sprint board' }).click();

    await dialog.getByRole('tab', { name: 'Field mapping' }).click();
    await dialog.getByRole('button', { name: 'Remove delivery owner field' }).click();
    await dialog.getByRole('button', { name: 'Remove issue type Story' }).click();

    await dialog.getByRole('tab', { name: 'Capacity' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity field' }).click();
    await dialog.getByRole('button', { name: 'Remove capacity project' }).click();

    await dialog.getByRole('tab', { name: 'Priority weights' }).click();
    await dialog.getByLabel('P1 weight').fill('0.75');

    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');

    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);

    const posts = pathname => calls.filter(call => call.method === 'POST' && call.pathname === pathname);
    expect(posts('/api/projects/selected')).toHaveLength(1);
    expect(posts('/api/stats/priority-weights-config')).toHaveLength(1);
    expect(posts('/api/board-config')).toHaveLength(1);
    expect(posts('/api/capacity/config')).toHaveLength(1);
    expect(posts('/api/delivery-owner-field/config')).toHaveLength(1);
    expect(posts('/api/issue-types/config')).toHaveLength(1);
    expect(posts('/api/epm/config')).toHaveLength(1);

    // Each endpoint payload stays scoped to its own section, and the board rides the groups one.
    expect(posts('/api/board-config')[0].body).toEqual({ boardId: '', boardName: '' });
    expect(posts('/api/capacity/config')[0].body).toEqual({ project: '', fieldId: '', fieldName: '' });
    expect(posts('/api/epm/config')[0].body.labelPrefix).toBe('rnd_project_core_');
    const groupsBody = posts('/api/groups-config')[0].body;
    expect(groupsBody.groups[0].name).toBe('Platform Core');
    expect(groupsBody.groups[0].board.columns[0].name).toBe('Local Column');
    expect(groupsBody.board).toBeUndefined();
});

test('settings save persists dirty department and EPM sections together', async ({ page }) => {
    const calls = await mockConfigSettings(page);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByPlaceholder('Group name').fill('Platform Core');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.locator('[data-epm-scope-field="labelPrefix"]').fill('rnd_project_core_');

    await dialog.getByRole('button', { name: /Save/ }).click();

    await expect(dialog).toHaveCount(0);
    const departmentSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    const epmSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/epm/config');
    expect(departmentSave).toBeTruthy();
    expect(epmSave).toBeTruthy();
    expect(departmentSave.body.groups[0].name).toBe('Platform Core');
    expect(epmSave.body.labelPrefix).toBe('rnd_project_core_');
});

test('the mapping pickers search the whole field catalog, not the capacity project’s screens', async ({ page }) => {
    // The live defect: with a capacity project configured, the field catalog was fetched
    // scoped to that project's createmeta screens, so an instance-wide custom field that is
    // not on those screens could never be found — Delivery Owner among them.
    const calls = await mockConfigSettings(page, {
        capacityConfig: { project: 'CAP', fieldId: 'customfield_10409', fieldName: 'Team capacity' },
        deliveryOwnerFieldConfig: { fieldId: '', fieldName: '' },
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    const entry = dialog.locator('.mapping-config-grid [data-map-key="deliveryOwner"]');
    await entry.locator('.team-search-input').fill('Delivery Owner');
    await expect(entry.locator('.team-search-result-item')).toHaveCount(1);
    await expect(entry.locator('.team-search-result-item').first()).toContainText('Delivery Owner');

    const fieldCalls = calls.filter(call => call.pathname === '/api/fields');
    expect(fieldCalls.length).toBeGreaterThan(0);
    expect(fieldCalls.every(call => !call.search.includes('project='))).toBe(true);
});

test('a truncated field search says so instead of silently dropping matches', async ({ page }) => {
    await mockConfigSettings(page, { deliveryOwnerFieldConfig: { fieldId: '', fieldName: '' } });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    // The stub catalog has 3 fields, so an empty query is not truncated and must say nothing.
    const entry = dialog.locator('.mapping-config-grid [data-map-key="deliveryOwner"]');
    await entry.locator('.team-search-input').click();
    await expect(entry.locator('.team-search-result-item')).toHaveCount(3);
    await expect(entry.locator('.team-search-more')).toHaveCount(0);
});

test('a field search past the cap names how many matches it is hiding', async ({ page }) => {
    const extraFields = [];
    for (let i = 0; i < 25; i += 1) extraFields.push({ id: `customfield_3${i}`, name: `Owner Field ${i}` });
    await mockConfigSettings(page, { extraFields, deliveryOwnerFieldConfig: { fieldId: '', fieldName: '' } });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    // 26 fields match "owner" (the 25 above plus Delivery Owner); 20 are shown.
    const entry = dialog.locator('.mapping-config-grid [data-map-key="deliveryOwner"]');
    await entry.locator('.team-search-input').fill('owner');
    await expect(entry.locator('.team-search-result-item')).toHaveCount(20);
    await expect(entry.locator('.team-search-more')).toHaveText('+6 more matches — keep typing to narrow.');

    // A notice you only see after scrolling past 20 rows is still a silent truncation, so it is
    // sticky at the foot of the scroll container: assert it is inside the panel's visible box
    // with the list unscrolled, not merely present in the DOM.
    const geometry = await entry.evaluate((node) => {
        const panel = node.querySelector('.team-search-results');
        const more = node.querySelector('.team-search-more');
        const panelBox = panel.getBoundingClientRect();
        const moreBox = more.getBoundingClientRect();
        return {
            scrollTop: panel.scrollTop,
            scrollable: panel.scrollHeight > panel.clientHeight,
            visible: moreBox.top >= panelBox.top - 1 && moreBox.bottom <= panelBox.bottom + 1,
        };
    });
    expect(geometry.scrollTop).toBe(0);
    expect(geometry.scrollable).toBe(true);
    expect(geometry.visible).toBe(true);
});

test('Field mapping tab renders Delivery Owner Field as a fifth entry styled like its siblings', async ({ page }) => {
    await mockConfigSettings(page);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();

    await dialog.getByRole('button', { name: 'Admin' }).click();
    await dialog.getByRole('tab', { name: 'Field mapping' }).click();

    const grid = dialog.locator('.mapping-config-grid');
    await expect(grid).toBeVisible();

    const entries = grid.locator(':scope > [data-map-key]');
    await expect(entries).toHaveCount(5);
    await expect(entries.nth(4)).toHaveAttribute('data-map-key', 'deliveryOwner');

    const deliveryOwnerEntry = grid.locator('[data-map-key="deliveryOwner"]');
    await expect(deliveryOwnerEntry.locator('.team-selector-label')).toHaveText('Delivery Owner Field');
    const deliveryOwnerChip = deliveryOwnerEntry.locator('.selected-team-chip');
    await expect(deliveryOwnerChip).toBeVisible();
    await expect(deliveryOwnerChip).toHaveClass(/mapping-delivery-owner-chip/);
    await expect(deliveryOwnerChip).toContainText('Delivery Owner');

    const teamEntry = grid.locator('[data-map-key="team"]');
    const teamChip = teamEntry.locator('.selected-team-chip');
    await expect(teamChip).toBeVisible();

    // Fix 2 regression guard: a class matching zero CSS rules still passes a
    // declaration-level check, so assert the computed pixel, not just the class name.
    const deliveryOwnerBorderColor = await deliveryOwnerChip.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
    const teamBorderColor = await teamChip.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
    expect(deliveryOwnerBorderColor).toBe('rgba(20, 184, 166, 0.72)');
    expect(deliveryOwnerBorderColor).not.toBe(teamBorderColor);

    // Fix 1 regression guard: Delivery Owner is an epic field with no counterpart in the
    // story preview, so hovering its config card must NOT trigger the preview's
    // dim-everything-highlight-nothing state.
    const previewDimmable = dialog.locator('.mapping-preview-dimmable').first();
    await deliveryOwnerEntry.hover();
    await page.waitForTimeout(300); // let the 0.15s dim/highlight transition settle
    await expect(previewDimmable).toHaveCSS('opacity', '1');

    // A sibling that IS linked (Team Field) must still dim the preview and highlight its
    // own linked element, proving this differs from the Delivery Owner case above rather
    // than asserting a tautology.
    const previewTeamLink = dialog.locator('.mapping-preview-card .task-team[data-map-key="team"]');
    await teamEntry.hover();
    await page.waitForTimeout(300);
    await expect(previewDimmable).toHaveCSS('opacity', '0.62');
    await expect(previewTeamLink).toHaveCSS('opacity', '1');

    // Wait for the tab-switch transition to settle before capturing the screenshot.
    await page.waitForTimeout(300);
    await dialog.screenshot({ path: `${screenshotDir}/field-mapping-delivery-owner.png` });
});
