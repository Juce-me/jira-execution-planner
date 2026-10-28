const { test, expect } = require('@playwright/test');
const {
    appBaseUrl,
    enabledEpmOptions,
    epmAccessCalls,
    epmMetadataCalls,
    epmProject,
    installDashboardFixture,
    openConnectionsSettings,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_view_fixture');

// OAuth public Home reads (EXEC-home-oauth-public-reads Task 4): the EPM view is gated by the private
// "Enable EPM view" checkbox, verified Home scopes and ONE bounded access read; Home is read only through OAuth and
// no Home token endpoint exists. Every fixture below is synthetic (example.invalid, fake ids).

const SCREENSHOT_DIR = 'tmp/h4c';
const SCOPE_URL = '/login?reason=missing_scope';

const epmPrefs = {
    selectedView: 'epm',
    epmTab: 'active',
    epmSelectedProjectId: '',
    selectedSprint: selectedSprintId,
    sprintName: selectedSprintName,
};

async function seedEpmView(page) {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, epmPrefs);
}

const secondProject = (tab) => ({
    ...epmProject(tab),
    id: 'home-2',
    homeProjectId: 'home-2',
    name: 'Second Home Project',
    displayName: 'Second Home Project',
    label: 'rnd_project_second',
    homeUrl: 'https://home.example.invalid/project/home-2',
    resolvedLinkage: { labels: ['rnd_project_second'], epicKeys: [] },
    subGoals: [{ key: 'CHILD-200', name: 'Connected Child Goal' }],
});

const homeProjects = (tab) => [epmProject(tab), secondProject(tab)];

function jiraRollup(epicKey, epicSummary, stories) {
    return {
        metadataOnly: false,
        emptyRollup: false,
        truncated: false,
        truncatedQueries: [],
        initiatives: {},
        rootEpics: {
            [epicKey]: {
                issue: { key: epicKey, summary: epicSummary, status: 'In Progress', issueType: 'Epic', storyPoints: 99 },
                stories,
            },
        },
        orphanStories: [],
    };
}

const story = (key, summary, status, storyPoints) => ({ key, summary, status, issueType: 'Story', storyPoints });

function nonEmptyRollup(project, url, { remote = false } = {}) {
    const first = project;
    const second = secondProject(url?.searchParams.get('tab') || 'active');
    return {
        projects: [
            {
                project: first,
                rollup: jiraRollup('SYN-100', 'Synthetic first Epic', [
                    story('SYN-101', remote ? 'Synthetic remote Story' : 'Synthetic done Story', 'Done', 2),
                    story('SYN-102', 'Synthetic open Story', 'In Progress', 3),
                    story('SYN-103', 'Synthetic waiting Story', 'To Do', 5),
                ]),
            },
            {
                project: second,
                rollup: jiraRollup('SYN-200', 'Synthetic second Epic', [
                    story('SYN-201', 'Synthetic second done Story', 'Done', 1),
                    story('SYN-202', 'Synthetic second waiting Story', 'To Do', 4),
                ]),
            },
        ],
        duplicates: {},
        truncated: false,
        fallback: false,
    };
}

const epmFixtureOptions = (extra = {}) => enabledEpmOptions({
    epmProjects: homeProjects,
    allProjectsRollup: (project, url) => nonEmptyRollup(project, url),
    ...extra,
});

const callKey = (call) => `${call.method} ${call.pathname}`;
const keysOf = (calls, filter = () => true) => calls.filter(filter).map(callKey);
const countOf = (calls, method, pathname) => calls.filter(call => call.method === method && call.pathname === pathname).length;
const indexOfCall = (calls, method, pathname) => calls.findIndex(call => call.method === method && call.pathname === pathname);
const isEpmRead = (call) => call.pathname.startsWith('/api/epm/') && call.pathname !== '/api/epm/preferences';
const sortedMultiset = (calls, filter) => {
    const counts = {};
    for (const key of keysOf(calls, filter)) counts[key] = (counts[key] || 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

async function waitForEpmBoards(page) {
    await expect(page.locator('.epm-project-board-name', { hasText: 'Connected Home Project' })).toBeVisible();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Second Home Project' })).toBeVisible();
}

async function settle(page) {
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// The Settings entry is the EPM gear while the EPM view is selected, the department gear otherwise.
async function openConnections(page) {
    const epmGear = page.getByRole('button', { name: 'Open EPM settings' });
    if (await epmGear.isVisible().catch(() => false)) {
        await epmGear.click();
        const dialog = page.getByRole('dialog').first();
        await dialog.getByRole('button', { name: 'Connections' }).click();
        await dialog.locator('.user-connections-settings').waitFor({ state: 'visible' });
        return dialog;
    }
    return openConnectionsSettings(page);
}

const epmCard = (dialog) => dialog.locator('section[aria-labelledby="epm-view-title"]');
const epmCheckbox = (dialog) => dialog.getByRole('checkbox', { name: 'Enable EPM view' });
const footerSave = (dialog) => dialog.locator('.group-modal-footer').getByRole('button', { name: /^Save$/ });
const dirtyBadge = (dialog) => dialog.locator('.group-modal-dirty');

// The shared fixtures leave a baseline unsaved Department draft, so Close may ask to discard; both end closed.
async function closeSettings(page, dialog) {
    await dialog.getByRole('button', { name: 'Close' }).click();
    const discard = page.getByRole('button', { name: 'Discard' });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
}
const closeAndDiscard = closeSettings;

const startupContract = (calls) => sortedMultiset(calls, call => (
    call.pathname === '/api/config' || call.pathname === '/api/epm/access'
    || call.pathname.startsWith('/api/epm/') || call.pathname.startsWith('/api/me/connections/')
));

// ---------------------------------------------------------------------------------------------------------
// Non-empty Goals / Home / Jira rows and the bounded request multiset
// ---------------------------------------------------------------------------------------------------------

test('an enabled OAuth user sees non-empty Home projects and Jira rows from one bounded request set', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, epmFixtureOptions({ userCanEditEpmConfig: true }));

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForEpmBoards(page);

    // Home rows: both projects with their state and Jira rows under the exact label rollup.
    const firstBoard = page.locator('.epm-project-board').filter({ hasText: 'Connected Home Project' });
    const secondBoard = page.locator('.epm-project-board').filter({ hasText: 'Second Home Project' });
    await expect(firstBoard).toHaveCount(1);
    await expect(secondBoard).toHaveCount(1);
    await firstBoard.getByRole('button', { name: 'Show Jira rollup for Connected Home Project' }).click();
    await secondBoard.getByRole('button', { name: 'Show Jira rollup for Second Home Project' }).click();
    for (const key of ['SYN-101', 'SYN-102', 'SYN-103']) {
        await expect(firstBoard.locator(`.task-item[data-task-key="${key}"]`)).toHaveCount(1);
    }
    for (const key of ['SYN-201', 'SYN-202']) {
        await expect(secondBoard.locator(`.task-item[data-task-key="${key}"]`)).toHaveCount(1);
    }
    await expect(firstBoard.locator('.task-item[data-task-key="SYN-102"]')).toContainText('Synthetic open Story');
    // Story Points roll up per project (2 of 10 done in the first, 1 of 5 in the second).
    const firstProgress = firstBoard.locator('.epm-project-progress');
    await firstProgress.hover();
    await expect(firstProgress.locator('.epm-project-progress-tooltip')).toContainText('Completed 2.0 SP / Total 10.0 SP');
    await page.mouse.move(0, 0);
    const secondProgress = secondBoard.locator('.epm-project-progress');
    await secondProgress.hover();
    await expect(secondProgress.locator('.epm-project-progress-tooltip')).toContainText('Completed 1.0 SP / Total 5.0 SP');

    // One access read, no Home token request, and no per-project enriched fan-out.
    expect(countOf(fixture.calls, 'GET', '/api/config')).toBe(1);
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);
    expect(fixture.calls.filter(call => call.pathname.startsWith('/api/me/connections/'))).toEqual([]);
    expect(fixture.calls.filter(call => /^\/api\/epm\/projects\/[^/]+\/rollup$/.test(call.pathname))).toEqual([]);
    expect(countOf(fixture.calls, 'GET', '/api/epm/projects/rollup/all')).toBe(1);
    expect(countOf(fixture.calls, 'GET', '/api/epm/projects')).toBe(1);
    expect(countOf(fixture.calls, 'GET', '/api/epm/goals')).toBe(1);
    await settle(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/oauth-reads-non-empty-epm.png`, animations: 'disabled' });

    // Goals: the Settings EPM scope reads the same user's Home goals.
    await page.getByRole('button', { name: 'Open EPM settings' }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await expect(dialog.getByText('Connected Root Goal (ROOT-100)')).toBeVisible();
    await expect(dialog.getByText('Connected Child Goal (CHILD-200)')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const discard = page.getByRole('button', { name: 'Discard' });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('startup request multiset: config, one access read, warm metadata before one aggregate rollup', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, epmFixtureOptions());

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForEpmBoards(page);

    const multiset = startupContract(fixture.calls);
    expect(multiset['GET /api/config']).toBe(1);
    expect(multiset['GET /api/epm/access']).toBe(1);
    expect(multiset['GET /api/epm/goals']).toBe(1);
    expect(multiset['GET /api/epm/projects']).toBe(1);
    expect(multiset['GET /api/epm/projects/rollup/all']).toBe(1);
    expect(multiset).toEqual({
        'GET /api/config': 1,
        'GET /api/epm/access': 1,
        'GET /api/epm/goals': 1,
        'GET /api/epm/projects': 1,
        'GET /api/epm/projects/rollup/all': 1,
    });
    expect(Object.keys(multiset).filter(key => key.includes('/api/me/connections/'))).toEqual([]);
    // Access resolves first, the metadata warm precedes the rollup that depends on it.
    const calls = fixture.calls;
    const access = indexOfCall(calls, 'GET', '/api/epm/access');
    const projects = indexOfCall(calls, 'GET', '/api/epm/projects');
    const rollup = indexOfCall(calls, 'GET', '/api/epm/projects/rollup/all');
    expect(access).toBeGreaterThan(indexOfCall(calls, 'GET', '/api/config'));
    expect(projects).toBeGreaterThan(access);
    expect(rollup).toBeGreaterThan(projects);
    // No EPM read may happen before the access decision settled.
    expect(calls.slice(0, access).filter(isEpmRead)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------
// Checkbox: dirty badge, footer Save only while dirty, Discard, failed save, success, reload
// ---------------------------------------------------------------------------------------------------------

test('Enable EPM view: dirty badge, footer Save only while dirty, Discard, Save then config refresh and access read, reload', async ({ page }) => {
    const fixture = await installDashboardFixture(page, {
        epmAfterEnable: { homeReadAvailable: true, access: { state: 'available' } },
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch).toHaveCount(0);

    let dialog = await openConnections(page);
    await expect(epmCheckbox(dialog)).not.toBeChecked();
    await expect(epmCard(dialog).locator('.user-connection-status')).toHaveText('Off');
    // Clean Connections keeps its existing chrome: no dirty badge and no footer Save.
    await expect(dirtyBadge(dialog)).toHaveCount(0);
    await expect(footerSave(dialog)).toHaveCount(0);

    // A checked box is a draft, not evidence of consent: dirty badge + Save, status still Off, no scope link.
    await epmCheckbox(dialog).check();
    await expect(dirtyBadge(dialog)).toContainText('Unsaved changes');
    await expect(footerSave(dialog)).toBeEnabled();
    await expect(epmCard(dialog).locator('.user-connection-status')).toHaveText('Off');
    await expect(dialog.getByRole('link', { name: 'Update Atlassian permissions' })).toHaveCount(0);
    // Returning the draft to the saved value is clean again.
    await epmCheckbox(dialog).uncheck();
    await expect(dirtyBadge(dialog)).toHaveCount(0);
    await expect(footerSave(dialog)).toHaveCount(0);

    // Discard drops the draft without any preference request.
    await epmCheckbox(dialog).check();
    await closeAndDiscard(page, dialog);
    dialog = await openConnections(page);
    await expect(epmCheckbox(dialog)).not.toBeChecked();
    await expect(dirtyBadge(dialog)).toHaveCount(0);
    expect(countOf(fixture.calls, 'POST', '/api/epm/preferences')).toBe(0);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);

    // Save posts exactly {viewEnabled}, closes Settings, then refreshes config once and reads access once.
    await epmCheckbox(dialog).check();
    const beforeSave = fixture.calls.length;
    await footerSave(dialog).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    const afterSave = fixture.calls.slice(beforeSave);
    const posts = afterSave.filter(call => call.method === 'POST' && call.pathname !== '/api/auth/refresh');
    expect(posts.map(callKey)).toEqual(['POST /api/epm/preferences']);
    expect(posts[0].body).toEqual({ viewEnabled: true });
    const postIndex = afterSave.findIndex(call => call.pathname === '/api/epm/preferences');
    expect(countOf(afterSave.slice(postIndex), 'GET', '/api/config')).toBe(1);
    expect(epmAccessCalls(afterSave)).toHaveLength(1);
    expect(indexOfCall(afterSave, 'GET', '/api/epm/access')).toBeGreaterThan(postIndex);
    expect(afterSave.filter(call => call.pathname.startsWith('/api/me/connections/'))).toEqual([]);

    dialog = await openConnections(page);
    await expect(epmCheckbox(dialog)).toBeChecked();
    await expect(epmCard(dialog).locator('.user-connection-status')).toHaveText('Available');
    await expect(dirtyBadge(dialog)).toHaveCount(0);
    await expect(footerSave(dialog)).toHaveCount(0);
    await closeSettings(page, dialog);

    // Reload: the saved preference survives and is read from config again; one more access read.
    const beforeReload = epmAccessCalls(fixture.calls).length;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeVisible();
    expect(epmAccessCalls(fixture.calls).length).toBe(beforeReload + 1);
    dialog = await openConnections(page);
    await expect(epmCheckbox(dialog)).toBeChecked();
    await expect(dirtyBadge(dialog)).toHaveCount(0);
});

test('Enable EPM view: a failed save keeps the draft with an error and does not refresh config or read access', async ({ page }) => {
    const fixture = await installDashboardFixture(page, {
        epmPreferenceFailure: { status: 500, body: { error: 'epm_preferences_failed', message: 'The EPM view preference could not be stored.' } },
        epmAfterEnable: { homeReadAvailable: true, access: { state: 'available' } },
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const dialog = await openConnections(page);

    await epmCheckbox(dialog).check();
    const beforeSave = fixture.calls.length;
    await footerSave(dialog).click();
    await expect(epmCard(dialog).getByRole('alert')).toContainText('The EPM view preference could not be stored.');
    await expect(epmCheckbox(dialog)).toBeChecked();
    await expect(dirtyBadge(dialog)).toContainText('Unsaved changes');
    await expect(footerSave(dialog)).toBeEnabled();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const afterFailure = fixture.calls.slice(beforeSave);
    expect(afterFailure.filter(call => call.pathname === '/api/epm/preferences')).toHaveLength(1);
    expect(afterFailure.slice(afterFailure.findIndex(call => call.pathname === '/api/epm/preferences') + 1).filter(call => call.pathname === '/api/config')).toEqual([]);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);

    // Editing the draft clears the stale error; recovery then saves normally.
    await epmCheckbox(dialog).uncheck();
    await expect(epmCard(dialog).getByRole('alert')).toHaveCount(0);
    await epmCheckbox(dialog).check();
    fixture.epmState.preferenceFailure = null;
    await footerSave(dialog).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' }).getByRole('radio', { name: 'EPM' })).toBeVisible();
    expect(countOf(fixture.calls, 'POST', '/api/epm/preferences')).toBe(2);
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);
});

test('Enable EPM view: the scope-update link appears only after the enabled value is saved', async ({ page }) => {
    const fixture = await installDashboardFixture(page, {
        epmAfterEnable: { homeReadAvailable: false, loginUrl: SCOPE_URL, access: { state: 'scope_missing' } },
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    let dialog = await openConnections(page);
    const linkIn = (root) => root.getByRole('link', { name: 'Update Atlassian permissions' });

    await epmCheckbox(dialog).check();
    await expect(linkIn(dialog)).toHaveCount(0);
    await footerSave(dialog).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    dialog = await openConnections(page);
    await expect(epmCheckbox(dialog)).toBeChecked();
    await expect(linkIn(dialog)).toBeVisible();
    await expect(linkIn(dialog)).toHaveAttribute('href', SCOPE_URL);
    // Scopes are missing: still no navigation, and no Home access or EPM read was made.
    await closeSettings(page, dialog);
    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' })).toHaveCount(0);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
    expect(epmMetadataCalls(fixture.calls)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------
// Missing scopes, denied and empty Home visibility
// ---------------------------------------------------------------------------------------------------------

test('enabled user without Home scopes: hidden navigation, Settings reachable with the scope-update link, no Home traffic', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, {
        epmViewEnabled: true,
        epmHomeReadAvailable: false,
        epmHomeReadLoginUrl: SCOPE_URL,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' })).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
    expect(epmMetadataCalls(fixture.calls)).toEqual([]);
    expect(fixture.calls.filter(call => call.pathname.startsWith('/api/me/connections/'))).toEqual([]);

    const dialog = await openConnections(page);
    await expect(epmCheckbox(dialog)).toBeChecked();
    const link = dialog.getByRole('link', { name: 'Update Atlassian permissions' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', SCOPE_URL);
});

// PRODUCT BUG (Part B, not fixed here: frontend/src is out of this task's scope). For an enabled user whose Home scopes
// are missing no access read is made, so dashboard.jsx passes `access: null` and the card shows "Checking" forever
// instead of the implemented `scope_missing` copy ("Permission needed" + "has not been granted yet").
test('enabled user without Home scopes: the checkbox card states the missing permission instead of an endless check', async ({ page }) => {
    await seedEpmView(page);
    await installDashboardFixture(page, { epmViewEnabled: true, epmHomeReadAvailable: false, epmHomeReadLoginUrl: SCOPE_URL });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const dialog = await openConnections(page);
    await expect(epmCard(dialog).locator('.user-connection-status')).toHaveText('Permission needed');
    await expect(epmCard(dialog)).toContainText('Atlassian Home read permission has not been granted yet.');
});

test('an unsafe or mistyped scope-update link is never rendered (fail closed)', async ({ page }) => {
    await seedEpmView(page);
    await installDashboardFixture(page, {
        epmViewEnabled: true,
        epmHomeReadAvailable: false,
        epmHomeReadLoginUrl: 'https://evil.example.invalid/login',
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const dialog = await openConnections(page);
    await expect(dialog.getByRole('link', { name: 'Update Atlassian permissions' })).toHaveCount(0);
});

test('production-like missing or mistyped capability fields fail closed', async ({ page }) => {
    await seedEpmView(page);
    const fixture = await installDashboardFixture(page, { omitEpmCapabilityFields: true });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' })).toHaveCount(0);
    expect(epmAccessCalls(fixture.calls)).toEqual([]);
    expect(epmMetadataCalls(fixture.calls)).toEqual([]);

    // Mistyped values ("true" strings) are not booleans: still hidden, still no Home traffic.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await seedEpmView(page);
    const mistyped = await installDashboardFixture(page, { configExtras: { epmViewEnabled: 'true', epmHomeReadAvailable: 1 } });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('radiogroup', { name: 'Dashboard view' })).toHaveCount(0);
    expect(epmAccessCalls(mistyped.calls)).toEqual([]);
});

for (const [state, label, copy] of [
    ['denied', 'No access', 'Atlassian Home did not grant access to the configured EPM scope.'],
    ['empty', 'No goals found', 'No accessible Atlassian Home goal matches the configured EPM scope.'],
    ['unavailable', 'Unavailable', 'Atlassian Home could not be checked right now.'],
]) {
    test(`access ${state}: hidden navigation, no terminal lock, useful Settings copy and no raw provider text`, async ({ page }) => {
        await seedEpmView(page);
        const fixture = await installDashboardFixture(page, enabledEpmOptions({
            epmAccess: { state, message: 'RAWPROVIDER <script>alert(1)</script> {"errors":[{"extensions":{"errorType":"FORBIDDEN"}}]}' },
        }));
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

        await expect(page.getByRole('radiogroup', { name: 'Dashboard view' })).toHaveCount(0);
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        expect(new URL(page.url()).pathname).toBe('/');
        expect(epmAccessCalls(fixture.calls)).toHaveLength(1);
        // The saved EPM view falls back to ENG without any EPM metadata or rollup read.
        expect(epmMetadataCalls(fixture.calls)).toEqual([]);
        await expect(page.getByRole('button', { name: 'Select sprint', exact: true }).first()).toBeVisible();

        const dialog = await openConnections(page);
        await expect(epmCard(dialog).locator('.user-connection-status')).toHaveText(label);
        await expect(epmCard(dialog)).toContainText(copy);
        await expect(dialog).not.toContainText('RAWPROVIDER');
        await expect(dialog).not.toContainText('FORBIDDEN');
        await expect(epmCheckbox(dialog)).toBeChecked();
    });
}

test('typed goals and scope failures in Settings show useful copy and never the raw provider payload', async ({ page }) => {
    const raw = { message: 'RAWPROVIDER missing read:goal:goals', loginUrl: SCOPE_URL };
    const fixture = await installDashboardFixture(page, {
        userCanEditEpmConfig: true,
        epmConfig: { scope: { rootGoalKey: '', subGoalKeys: [] } },
        epmFailure: (url) => {
            if (url.pathname === '/api/epm/goals') return { status: 409, body: { error: 'epm_scope_required', ...raw } };
            if (url.pathname === '/api/epm/scope') return { status: 502, body: { error: 'home_read_failed', ...raw } };
            return null;
        },
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await expect(dialog).toContainText('Atlassian Home could not be read. Try again later.');
    await dialog.getByPlaceholder('Search main goals...').click();
    await expect(dialog).toContainText('Atlassian Home read permission is needed. Update your Atlassian permissions in Settings > Connections.');
    await expect(dialog).not.toContainText('RAWPROVIDER');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(countOf(fixture.calls, 'GET', '/api/epm/goals')).toBeGreaterThanOrEqual(1);
    expect(countOf(fixture.calls, 'GET', '/api/epm/scope')).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------------------------------------
// Typed read failures: retained content, Retry-After, home vs Jira denial, global auth lock
// ---------------------------------------------------------------------------------------------------------

const refreshButton = (page) => page.getByRole('button', { name: 'Refresh EPM projects and issues from Jira' });

async function openLoadedEpm(page, extra = {}) {
    await seedEpmView(page);
    await page.clock.install();
    const fixture = await installDashboardFixture(page, epmFixtureOptions(extra));
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForEpmBoards(page);
    const firstBoard = page.locator('.epm-project-board').filter({ hasText: 'Connected Home Project' });
    await firstBoard.getByRole('button', { name: 'Show Jira rollup for Connected Home Project' }).click();
    await expect(firstBoard.locator('.task-item[data-task-key="SYN-102"]')).toBeVisible();
    return { fixture, firstBoard };
}

const epmRefreshReads = (calls, since) => calls.slice(since).filter(call => call.pathname === '/api/epm/projects' || call.pathname === '/api/epm/projects/rollup/all');

for (const [name, status, error, headers] of [
    ['rate_limited with a Retry-After', 503, 'home_rate_limited', { 'Retry-After': '120' }],
    ['jira rate_limited', 503, 'jira_rate_limited', { 'Retry-After': '5' }],
    ['429', 429, 'rate_limited', { 'Retry-After': '9' }],
    ['jira_access_denied', 403, 'jira_access_denied', {}],
]) {
    test(`explicit refresh ${name} keeps loaded rows, schedules no retry and keeps navigation`, async ({ page }) => {
        const { fixture, firstBoard } = await openLoadedEpm(page);
        const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
        const since = fixture.calls.length;
        fixture.setEpmFailure((url) => (url.pathname.startsWith('/api/epm/projects')
            ? { status, headers, body: { error, message: 'RAWPROVIDER failure text' } }
            : null));

        await refreshButton(page).click();
        await expect.poll(() => epmRefreshReads(fixture.calls, since).length).toBeGreaterThanOrEqual(1);
        await settle(page);
        const afterFirst = epmRefreshReads(fixture.calls, since).length;

        // Loaded content stays; a typed read failure is neither a lock nor a sign-in loop.
        await expect(firstBoard.locator('.task-item[data-task-key="SYN-102"]')).toBeVisible();
        await expect(page.locator('.epm-project-board-name', { hasText: 'Second Home Project' })).toBeVisible();
        await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeChecked();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('RAWPROVIDER');
        // retryAtMs stays null: advancing past the capped 30s Retry-After window triggers nothing.
        await page.clock.fastForward(61 * 1000);
        await page.waitForLoadState('networkidle');
        expect(epmRefreshReads(fixture.calls, since).length).toBe(afterFirst);
        // Home availability is untouched by a rate limit or a Jira-only denial.
        expect(epmAccessCalls(fixture.calls)).toHaveLength(1);

        // The explicit refresh stays available and recovers once the read succeeds.
        fixture.setEpmFailure(null);
        await expect(refreshButton(page)).toBeEnabled();
        await refreshButton(page).click();
        await expect.poll(() => epmRefreshReads(fixture.calls, since).length).toBeGreaterThan(afterFirst);
        await expect(firstBoard.locator('.task-item[data-task-key="SYN-102"]')).toBeVisible();
    });
}

test('a plain failed explicit refresh (home_read_failed) clears the rows, never locks, keeps navigation and recovers', async ({ page }) => {
    const { fixture, firstBoard } = await openLoadedEpm(page);
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    fixture.setEpmFailure((url) => (url.pathname.startsWith('/api/epm/projects')
        ? { status: 502, body: { error: 'home_read_failed', message: 'RAWPROVIDER upstream failure' } }
        : null));

    await refreshButton(page).click();
    // Only throttled or denied reads retain content; a plain failure keeps the existing explicit-refresh behaviour.
    await expect(page.locator('.epm-project-board-name')).toHaveCount(0);
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeChecked();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('RAWPROVIDER');
    expect(epmAccessCalls(fixture.calls)).toHaveLength(1);

    fixture.setEpmFailure(null);
    await refreshButton(page).click();
    await waitForEpmBoards(page);
    const show = firstBoard.getByRole('button', { name: 'Show Jira rollup for Connected Home Project' });
    if (await show.isVisible().catch(() => false)) await show.click();
    await expect(firstBoard.locator('.task-item[data-task-key="SYN-102"]')).toBeVisible();
});

test('Retry-After is parsed and capped in the Settings goals copy and schedules no retry', async ({ page }) => {
    await page.clock.install();
    const fixture = await installDashboardFixture(page, {
        userCanEditEpmConfig: true,
        epmConfig: { scope: { rootGoalKey: '', subGoalKeys: [] } },
        epmFailure: (url) => (url.pathname === '/api/epm/goals'
            ? { status: 503, headers: { 'Retry-After': '120' }, body: { error: 'home_rate_limited', message: 'RAWPROVIDER throttled' } }
            : null),
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
    await dialog.getByPlaceholder('Search main goals...').click();
    await expect(dialog).toContainText('Atlassian Home is rate limiting requests. Try again in 30s.');
    await expect(dialog).not.toContainText('RAWPROVIDER');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const before = countOf(fixture.calls, 'GET', '/api/epm/goals');
    await page.clock.fastForward(61 * 1000);
    await page.waitForLoadState('networkidle');
    expect(countOf(fixture.calls, 'GET', '/api/epm/goals')).toBe(before);
});

test('home_access_denied from a read hides navigation and falls back to ENG without a lock; the access decision is retired', async ({ page }) => {
    const { fixture } = await openLoadedEpm(page);
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch.getByRole('radio', { name: 'EPM' })).toBeChecked();
    const accessBefore = epmAccessCalls(fixture.calls).length;
    fixture.setEpmFailure((url) => (url.pathname.startsWith('/api/epm/projects')
        ? { status: 403, body: { error: 'home_access_denied', message: 'RAWPROVIDER forbidden' } }
        : null));

    await refreshButton(page).click();
    await expect(viewSwitch).toHaveCount(0);
    await expect(page.locator('.epm-project-board-name')).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('body')).not.toContainText('RAWPROVIDER');
    await expect(page.getByRole('button', { name: 'Select sprint', exact: true }).first()).toBeVisible();
    // The denial does not trigger a fresh access read by itself (no loop) and Settings stays reachable.
    await page.waitForLoadState('networkidle');
    expect(epmAccessCalls(fixture.calls).length).toBe(accessBefore);
    const dialog = await openConnections(page);
    await expect(epmCard(dialog).locator('.user-connection-status')).toHaveText('No access');
    await expect(epmCheckbox(dialog)).toBeChecked();
});

test('a real API 401 on an EPM read locks the mounted app once and never replays the failed request', async ({ page }) => {
    const { fixture, firstBoard } = await openLoadedEpm(page);
    const since = fixture.calls.length;
    fixture.setEpmFailure((url) => (url.pathname.startsWith('/api/epm/projects')
        ? { status: 401, body: { error: 'auth_required', loginUrl: '/login?reason=session_expired' } }
        : null));

    await refreshButton(page).click();
    const gate = page.getByRole('alertdialog');
    await expect(gate).toHaveCount(1);
    await expect(gate).toContainText('Sign in required');
    await expect(gate.getByRole('link')).toHaveAttribute('href', '/login?reason=session_expired');
    // The mounted app is preserved behind the gate; nothing is raw, replayed or unlocked in place.
    await expect(firstBoard.locator('.task-item[data-task-key="SYN-102"]')).toBeAttached();
    expect(new URL(page.url()).pathname).toBe('/');
    const reads = epmRefreshReads(fixture.calls, since).length;
    fixture.setEpmFailure(null);
    await page.clock.fastForward(61 * 1000);
    await page.waitForLoadState('networkidle');
    expect(epmRefreshReads(fixture.calls, since).length).toBe(reads);
    await expect(gate).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText('Failed to load EPM');
});

// ---------------------------------------------------------------------------------------------------------
// Geometry and settled synthetic screenshots of the registered checkbox card and the controls it moves
// (the EPM card is the only Connections card). Engine-neutral so the same spec runs headed in
// Firefox/WebKit (`--browser=firefox|webkit --headed`) for the engines the app is reviewed in.
// ---------------------------------------------------------------------------------------------------------

const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
];

const geometryStates = [
    ['off', {}, { dirty: true }],
    ['available', { enabled: true }, {}],
    ['scope-missing', { epmViewEnabled: true, epmHomeReadAvailable: false, epmHomeReadLoginUrl: SCOPE_URL }, { link: true }],
    ['denied', { enabled: true, epmAccess: { state: 'denied' } }, {}],
];

async function measureConnections(dialog) {
    return dialog.evaluate((root) => {
        const rect = (node) => {
            if (!node) return null;
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        };
        const textRect = (node) => {
            if (!node) return null;
            const range = document.createRange();
            range.selectNodeContents(node);
            const boxes = [...range.getClientRects()];
            if (!boxes.length) return null;
            return {
                left: Math.min(...boxes.map(box => box.left)), right: Math.max(...boxes.map(box => box.right)),
                top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)),
            };
        };
        const clip = (node) => (node ? { scroll: node.scrollWidth, client: node.clientWidth } : null);
        const style = (node, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(node)[key]]));
        const epm = root.querySelector('section[aria-labelledby="epm-view-title"]');
        const list = root.querySelector('.group-pane-list');
        const content = root.querySelector('.group-modal-content');
        const footer = root.querySelector('.group-modal-footer');
        const modal = root.querySelector('.group-modal');
        const label = epm.querySelector('.group-visible-control');
        const labelText = label.querySelector('span');
        const helper = epm.querySelector('.group-visible-helper');
        const checkbox = epm.querySelector('input[type="checkbox"]');
        const pill = epm.querySelector('.user-connection-status');
        const title = epm.querySelector('#epm-view-title');
        const link = epm.querySelector('a');
        const copy = epm.querySelector('[role="status"]');
        const save = footer.querySelector('button:not([data-first-run-settings-cancel])');
        const badge = root.querySelector('.group-modal-dirty');
        const cardKeys = ['borderTopWidth', 'borderRadius', 'paddingTop', 'paddingLeft', 'backgroundColor', 'borderTopColor'];
        const pillKeys = ['fontSize', 'fontWeight', 'minHeight', 'height', 'borderRadius', 'paddingLeft', 'whiteSpace'];
        return {
            viewport: { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
            modal: rect(modal), content: rect(content), contentClip: clip(content), list: rect(list), gap: parseFloat(getComputedStyle(list).rowGap) || 0,
            footer: rect(footer), save: rect(save), badge: rect(badge),
            epm: rect(epm), epmClip: clip(epm), cardCount: root.querySelectorAll('.user-connection-card').length,
            pill: rect(pill), pillStyle: style(pill, pillKeys), pillClip: clip(pill),
            title: textRect(title), label: rect(label), labelText: textRect(labelText), labelClip: clip(labelText), labelHeight: label.getBoundingClientRect().height,
            helper: textRect(helper), helperClip: clip(helper), checkbox: rect(checkbox),
            link: rect(link), linkText: textRect(link), copy: textRect(copy), copyClip: clip(copy),
            checkboxCount: epm.querySelectorAll('input[type="checkbox"]').length,
            labelClasses: label.className, cardClasses: epm.className, pillClasses: pill.className,
        };
    });
}

for (const viewport of viewports) {
    test.describe(`EPM checkbox card geometry ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        for (const [state, fixtureOptions, flags] of geometryStates) {
            test(`Connections ${state}: card, checkbox, status pill and stay inside their container with the EPM card alone`, async ({ page }, testInfo) => {
                const options = fixtureOptions.enabled ? enabledEpmOptions(fixtureOptions.epmAccess ? { epmAccess: fixtureOptions.epmAccess } : {}) : fixtureOptions;
                await installDashboardFixture(page, options);
                await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
                const dialog = await openConnections(page);
                if (flags.dirty) await epmCheckbox(dialog).check();
                await settle(page);
                await expect(epmCard(dialog)).toBeVisible();
                const m = await measureConnections(dialog);
                const eps = 1.5;

                // One registered checkbox in the registered card/pill/label hooks; nothing bespoke.
                expect(m.checkboxCount).toBe(1);
                expect(m.cardCount).toBe(1);
                expect(m.cardClasses).toContain('user-connection-card');
                expect(m.labelClasses).toContain('group-visible-control');
                expect(m.pillClasses).toContain('user-connection-status');
                // No overflow or clipped text anywhere in the container, page or modal.
                expect(m.viewport.scroll).toBeLessThanOrEqual(m.viewport.width);
                expect(m.contentClip.scroll).toBeLessThanOrEqual(m.contentClip.client + 1);
                for (const name of ['epmClip', 'pillClip', 'labelClip', 'helperClip', 'copyClip']) {
                    if (m[name]) expect(m[name].scroll, name).toBeLessThanOrEqual(m[name].client + 1);
                }
                expect(m.epm.left).toBeGreaterThanOrEqual(m.content.left - eps);
                expect(m.epm.right).toBeLessThanOrEqual(m.content.right + eps);
                expect(m.modal.right).toBeLessThanOrEqual(m.viewport.width + eps);

                // Text-bearing elements stay inside the card and clear of each other (MRT020/021: ink, not boxes).
                for (const name of ['pill', 'checkbox', 'label']) {
                    expect(m[name].left, name).toBeGreaterThanOrEqual(m.epm.left - eps);
                    expect(m[name].right, name).toBeLessThanOrEqual(m.epm.right + eps);
                    expect(m[name].top, name).toBeGreaterThanOrEqual(m.epm.top - eps);
                    expect(m[name].bottom, name).toBeLessThanOrEqual(m.epm.bottom + eps);
                }
                for (const name of ['title', 'labelText', 'helper', 'linkText', 'copy']) {
                    if (!m[name]) continue;
                    expect(m[name].left, name).toBeGreaterThanOrEqual(m.epm.left - eps);
                    expect(m[name].right, name).toBeLessThanOrEqual(m.epm.right + eps);
                    expect(m[name].bottom, name).toBeLessThanOrEqual(m.epm.bottom + eps);
                }
                expect(m.pill.left).toBeGreaterThanOrEqual(m.title.right - eps); // status never overlaps the heading
                expect(m.labelText.left).toBeGreaterThanOrEqual(m.checkbox.right - eps);
                expect(m.helper.top).toBeGreaterThanOrEqual(m.labelText.bottom - eps);
                expect(m.labelHeight).toBeGreaterThanOrEqual(44 - eps); // touch target, tap works everywhere
                if (m.copy) expect(m.copy.top).toBeGreaterThanOrEqual(m.helper.bottom - eps);
                if (flags.link) {
                    expect(m.link).not.toBeNull();
                    expect(m.link.left).toBeGreaterThanOrEqual(m.epm.left - eps);
                    expect(m.link.right).toBeLessThanOrEqual(m.epm.right + eps);
                    expect(m.linkText.top).toBeGreaterThanOrEqual((m.copy || m.helper).bottom - eps);
                } else {
                    expect(m.link).toBeNull();
                }

                if (flags.dirty) {
                    // Dirty Connections: badge in the header, footer Save inside the modal and clear of the content.
                    expect(m.badge).not.toBeNull();
                    expect(m.badge.right).toBeLessThanOrEqual(m.modal.right + eps);
                    expect(m.save).not.toBeNull();
                    expect(m.save.left).toBeGreaterThanOrEqual(m.modal.left - eps);
                    expect(m.save.right).toBeLessThanOrEqual(m.modal.right + eps);
                    expect(m.save.bottom).toBeLessThanOrEqual(m.modal.bottom + eps);
                    expect(m.content.bottom).toBeLessThanOrEqual(m.footer.top + eps);
                }

                // Hover/focus feedback never moves layout: no transform, no `transition: all`, rect unchanged.
                const probes = [epmCheckbox(dialog).locator('xpath=ancestor::label[1]'), ...(flags.link ? [dialog.getByRole('link', { name: 'Update Atlassian permissions' })] : [])];
                for (const probe of probes) {
                    const before = await probe.boundingBox();
                    await probe.hover();
                    await settle(page);
                    const during = await probe.boundingBox();
                    const computed = await probe.evaluate(node => ({ transform: getComputedStyle(node).transform, transition: getComputedStyle(node).transitionProperty }));
                    expect(computed.transform).toBe('none');
                    expect(computed.transition).not.toBe('all');
                    expect(Math.abs(during.x - before.x) + Math.abs(during.y - before.y) + Math.abs(during.width - before.width) + Math.abs(during.height - before.height)).toBeLessThanOrEqual(0.5);
                }
                await page.mouse.move(0, 0);
                await epmCheckbox(dialog).focus();
                await settle(page);
                await page.screenshot({ path: `${SCREENSHOT_DIR}/oauth-reads-connections-${state}-${viewport.name}.png`, animations: 'disabled' });
            });
        }
    });
}
