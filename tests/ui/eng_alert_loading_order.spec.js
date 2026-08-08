const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const teamIds = ['team-alpha'];

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
}

function taskPayload(project, { alert = false, label = '' } = {}) {
    const prefix = project === 'tech' ? 'TECH' : 'PROD';
    const epicKey = `${prefix}-EPIC`;
    return {
        issues: [{
            id: `${prefix}-1`,
            key: `${prefix}-1`,
            fields: {
                summary: `${label}${project} visible story`,
                status: { name: 'To Do' },
                priority: { name: 'High' },
                issuetype: { name: 'Story' },
                assignee: { displayName: 'Synthetic Owner' },
                updated: '2026-05-01T00:00:00.000+0000',
                customfield_10004: alert ? null : 3,
                epicKey,
                parentSummary: `${project} delivery epic`,
                projectKey: prefix,
                teamId: 'team-alpha',
                teamName: 'Alpha Team',
                sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            },
        }],
        epics: {
            [epicKey]: {
                key: epicKey,
                summary: `${project} delivery epic`,
                status: { name: 'In Progress' },
                teamId: 'team-alpha',
                teamName: 'Alpha Team',
                sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                ...(alert ? {
                    storyCount: 1,
                    totalStories: 1,
                    selectedStories: 1,
                    selectedActionableStories: 1,
                    futureOpenStories: 0,
                    storyStatusCounts: { 'To Do': 1 },
                } : {}),
            },
        },
        epicsInScope: [],
        names: {},
    };
}

function isAlertCall(call) {
    return call.pathname === '/api/missing-info'
        || call.pathname === '/api/backlog-epics'
        || (call.pathname === '/api/tasks-with-team-name'
            && (call.params.purpose === 'alerts' || call.params.purpose === 'ready-to-close'));
}

async function waitForCallCount(calls, predicate, count) {
    await expect.poll(() => calls.filter(predicate).length).toBe(count);
}

async function installFixture(page, {
    visibleGates = {},
    alertGate = null,
    alertCohorts = [],
    sprintState = 'active',
    sprintGate = null,
} = {}) {
    const calls = [];
    const alertSourceCounts = new Map();
    await installDashboardShell(page);
    page.on('requestfailed', request => {
        const call = [...calls].reverse().find(candidate => candidate.url === request.url() && !candidate.completed);
        if (call) call.aborted = true;
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const requestBody = request.method() === 'POST' ? request.postDataJSON() : null;
        const call = {
            method: request.method(),
            url: request.url(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
        };
        const source = url.pathname === '/api/tasks-with-team-name'
            ? url.searchParams.get('purpose') || ''
            : url.pathname;
        if (source === 'alerts' || source === 'ready-to-close' || source === '/api/missing-info' || source === '/api/backlog-epics') {
            const sourceCount = alertSourceCounts.get(source) || 0;
            call.alertCohort = (source === '/api/missing-info') ? sourceCount : Math.floor(sourceCount / 2);
            alertSourceCounts.set(source, sourceCount + 1);
        }
        calls.push(call);
        const json = body => {
            call.completed = true;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        };
        const waitOnGate = async gate => {
            if (!gate) return false;
            await gate.promise;
            return call.aborted === true;
        };

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                projectsConfigured: true,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: [{
                    id: 'grp-default',
                    name: 'Default',
                    teamIds,
                    teamLabels: { 'team-alpha': 'Alpha Team' },
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') {
            if (await waitOnGate(sprintGate)) return;
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: sprintState }] });
        }
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose') || '';
            if (!purpose && await waitOnGate(visibleGates[project])) return;
            const cohort = alertCohorts[call.alertCohort] || {};
            if (purpose && await waitOnGate(cohort.gate || alertGate)) return;
            if (purpose === 'ready-to-close') {
                if (cohort.label) {
                    const payload = taskPayload(project, { alert: true, label: cohort.label });
                    const epicKey = `${project === 'tech' ? 'TECH' : 'PROD'}-EPIC`;
                    payload.issues[0].fields.status = { name: 'Done' };
                    payload.epics[epicKey] = { ...payload.epics[epicKey], summary: `${cohort.label}${project} ready epic`, openChildCount: 0 };
                    payload.epicsInScope = [payload.epics[epicKey]];
                    return json(payload);
                }
                return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            }
            if (purpose === 'alerts' && cohort.label) {
                const payload = taskPayload(project, { alert: true, label: cohort.label });
                const emptyKey = `${project === 'tech' ? 'TECH' : 'PROD'}-${cohort.label.trim().toUpperCase()}-EMPTY`;
                payload.epicsInScope = [{
                    key: emptyKey,
                    summary: `${cohort.label}${project} empty epic`,
                    status: { name: 'Analysis' },
                    teamId: 'team-alpha',
                    teamName: 'Alpha Team',
                    totalStories: 0,
                    selectedStories: 0,
                    selectedActionableStories: 0,
                    futureOpenStories: 0,
                    storyStatusCounts: {},
                    sprint: [{ id: selectedSprintId, name: selectedSprintName, state: sprintState }],
                }];
                return json(payload);
            }
            return json(taskPayload(project, { alert: purpose === 'alerts' }));
        }
        if (url.pathname === '/api/missing-info') {
            const cohort = alertCohorts[call.alertCohort] || {};
            if (await waitOnGate(cohort.gate || alertGate)) return;
            const missingStory = taskPayload('product', { alert: true, label: cohort.label || '' }).issues[0];
            missingStory.fields.missingFields = ['Story Points'];
            return json({ issues: [missingStory], epics: [], count: 1, epicCount: 0 });
        }
        if (url.pathname === '/api/backlog-epics') {
            const cohort = alertCohorts[call.alertCohort] || {};
            if (await waitOnGate(cohort.gate || alertGate)) return;
            return json({ epics: cohort.backlogEpics || [] });
        }
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/issues/transitions/options') {
            return json({
                issues: (requestBody?.issueKeys || ['PROD-1']).map(key => ({
                    key,
                    issueType: 'Story',
                    currentStatus: 'To Do',
                    transitions: [{ name: 'Start Progress', toStatus: 'In Progress' }],
                })),
                targetStatuses: [{ name: 'In Progress', availableCount: (requestBody?.issueKeys || ['PROD-1']).length, blockedCount: 0 }],
            });
        }
        if (url.pathname === '/api/issues/transitions') {
            const issueKeys = requestBody?.issueKeys || ['PROD-1'];
            return json({
                requested: issueKeys.length,
                succeeded: issueKeys.length,
                failed: 0,
                targetStatus: requestBody?.targetStatus || 'In Progress',
                results: issueKeys.map(key => ({ key, result: 'success', fromStatus: 'To Do', toStatus: requestBody?.targetStatus || 'In Progress' })),
            });
        }
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacities: {} });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
    return calls;
}

async function seedMode(page, mode) {
    const modePrefs = {
        catchUp: {},
        board: { showBoard: true },
        planning: { showPlanning: true },
        statistics: { showStats: true },
        scenario: { showScenario: true },
    }[mode];
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showStats: false,
        showScenario: false,
        showBoard: false,
        ...modePrefs,
    });
}

async function selectEngMode(page, name) {
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name }).click();
    await expect(page.locator('.view-selector .eng-mode-control').getByRole('radio', { name }))
        .toHaveAttribute('aria-checked', 'true');
}

test('Catch Up paints visible tasks before starting progressive alert requests', async ({ page }) => {
    const productGate = deferred();
    const techGate = deferred();
    const alertGate = deferred();
    const calls = await installFixture(page, {
        visibleGates: { product: productGate, tech: techGate },
        alertGate,
    });
    await seedMode(page, 'catchUp');

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 2);
    expect(calls.filter(isAlertCall)).toEqual([]);

    productGate.resolve();
    await expect(page.getByText('product visible story')).toBeVisible();
    expect(calls.filter(isAlertCall)).toEqual([]);

    techGate.resolve();
    await expect(page.getByText('tech visible story')).toBeVisible();
    await waitForCallCount(calls, isAlertCall, 5);
    await expect(page.locator('.alerts-panel-toolbar')).toHaveCount(0);
    expect(calls.filter(isAlertCall).map(call => (
        call.pathname === '/api/tasks-with-team-name' ? call.params.purpose : call.pathname
    )).sort()).toEqual([
        '/api/missing-info',
        'alerts',
        'alerts',
        'ready-to-close',
        'ready-to-close',
    ]);

    alertGate.resolve();
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
});

test('Catch Up waits for sprint metadata and sends its name with alert enrichment', async ({ page }) => {
    const sprintGate = deferred();
    const calls = await installFixture(page, { sprintGate });
    await seedMode(page, 'catchUp');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });

    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 2);
    expect(calls.filter(isAlertCall)).toEqual([]);
    sprintGate.resolve();
    await waitForCallCount(calls, isAlertCall, 5);

    const enrichmentCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name' && call.params.purpose === 'alerts');
    expect(enrichmentCalls).toHaveLength(2);
    expect(enrichmentCalls.map(call => call.params.sprintName)).toEqual([selectedSprintName, selectedSprintName]);
});

for (const mode of ['board', 'planning', 'statistics']) {
    test(`${mode} initial mode neither requests nor renders Catch Up alerts`, async ({ page }) => {
        const calls = await installFixture(page);
        await seedMode(page, mode);

        await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
        await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 2);
        expect(calls.filter(isAlertCall)).toEqual([]);
        await expect(page.locator('.alerts-panel-toolbar')).toHaveCount(0);
        await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
    });
}

test('scenario entered during initial task loading neither requests nor renders Catch Up alerts', async ({ page }) => {
    const productGate = deferred();
    const techGate = deferred();
    const calls = await installFixture(page, {
        visibleGates: { product: productGate, tech: techGate },
    });
    await seedMode(page, 'catchUp');

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 2);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Scenario' }).click();
    await expect(page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Scenario' }))
        .toHaveAttribute('aria-checked', 'true');

    productGate.resolve();
    techGate.resolve();
    await page.waitForLoadState('networkidle');
    expect(calls.filter(isAlertCall)).toEqual([]);
    await expect(page.locator('.alerts-panel-toolbar')).toHaveCount(0);
    await expect(page.locator('#eng-alert-panels')).toHaveCount(0);
});

test('Board refresh re-arms deferred alerts for the next Catch Up entry', async ({ page }) => {
    const calls = await installFixture(page);
    await seedMode(page, 'catchUp');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, isAlertCall, 5);

    await selectEngMode(page, 'Board');
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 4);
    expect(calls.filter(isAlertCall)).toHaveLength(5);

    await selectEngMode(page, 'Catch Up');
    await waitForCallCount(calls, isAlertCall, 10);
});

test('Planning mutation re-arms deferred alerts for the next Catch Up entry', async ({ page }) => {
    const calls = await installFixture(page);
    await seedMode(page, 'catchUp');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, isAlertCall, 5);

    await selectEngMode(page, 'Planning');
    await page.getByRole('button', { name: 'Select All' }).click();
    const statusTrigger = page.locator('[data-status-transition-trigger][data-issue-kind="story"][data-issue-key="PROD-1"]');
    await statusTrigger.click();
    await page.locator('.status-transition-menu[data-issue-key="PROD-1"]')
        .getByRole('menuitem', { name: 'In Progress' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/issues/transitions' && call.method === 'POST', 1);
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 4);
    expect(calls.filter(isAlertCall)).toHaveLength(5);

    await selectEngMode(page, 'Catch Up');
    await waitForCallCount(calls, isAlertCall, 10);
});

test('future-sprint backlog is Catch Up-only and waits for both visible task responses', async ({ page }) => {
    const productGate = deferred();
    const techGate = deferred();
    const calls = await installFixture(page, {
        visibleGates: { product: productGate, tech: techGate },
        sprintState: 'future',
    });
    await seedMode(page, 'planning');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 2);
    expect(calls.filter(call => call.pathname === '/api/backlog-epics')).toEqual([]);

    await selectEngMode(page, 'Catch Up');
    productGate.resolve();
    await expect(page.getByText('product visible story')).toBeVisible();
    expect(calls.filter(call => call.pathname === '/api/backlog-epics')).toEqual([]);

    techGate.resolve();
    await expect(page.getByText('tech visible story')).toBeVisible();
    await waitForCallCount(calls, call => call.pathname === '/api/backlog-epics', 2);
    await waitForCallCount(calls, isAlertCall, 7);
});

test('older overlapping alert cohort cannot overwrite newer Catch Up results', async ({ page }) => {
    const staleGate = deferred();
    const calls = await installFixture(page, {
        alertCohorts: [
            { gate: staleGate, label: 'Stale ' },
            { label: 'Fresh ' },
        ],
    });
    await seedMode(page, 'catchUp');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForCallCount(calls, isAlertCall, 5);

    await selectEngMode(page, 'Board');
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await waitForCallCount(calls, call => isAlertCall(call) && call.alertCohort === 0 && call.aborted, 5);
    await waitForCallCount(calls, call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, 4);
    await selectEngMode(page, 'Catch Up');
    await waitForCallCount(calls, isAlertCall, 10);

    await expect(page.locator('#eng-alert-missing').getByRole('button', { name: /Fresh product visible story/ })).toBeVisible();
    await expect(page.locator('#eng-alert-empty').getByRole('button', { name: /Fresh product empty epic/ })).toBeVisible();
    await expect(page.locator('#eng-alert-done').getByRole('button', { name: /Fresh product ready epic/ })).toBeVisible();
    staleGate.resolve();
    await expect(page.getByText('Stale product visible story')).toHaveCount(0);
    await expect(page.getByText('Stale product empty epic')).toHaveCount(0);
    await expect(page.getByText('Stale product ready epic')).toHaveCount(0);
    await expect(page.locator('#eng-alert-missing').getByRole('button', { name: /Fresh product visible story/ })).toBeVisible();
    await expect(page.locator('#eng-alert-empty').getByRole('button', { name: /Fresh product empty epic/ })).toBeVisible();
    await expect(page.locator('#eng-alert-done').getByRole('button', { name: /Fresh product ready epic/ })).toBeVisible();
});

test('leaving Catch Up during alert loading starts a replacement cohort on re-entry', async ({ page }) => {
    const abandonedGate = deferred();
    const calls = await installFixture(page, {
        alertCohorts: [
            { gate: abandonedGate, label: 'Abandoned ' },
            { label: 'Resumed ' },
        ],
    });
    await seedMode(page, 'catchUp');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForCallCount(calls, isAlertCall, 5);

    await selectEngMode(page, 'Board');
    await waitForCallCount(calls, call => isAlertCall(call) && call.alertCohort === 0 && call.aborted, 5);
    expect(calls.filter(isAlertCall)).toHaveLength(5);
    await selectEngMode(page, 'Catch Up');
    await waitForCallCount(calls, isAlertCall, 10);

    await expect(page.locator('#eng-alert-missing').getByRole('button', { name: /Resumed product visible story/ })).toBeVisible();
    abandonedGate.resolve();
    await expect(page.getByText('Abandoned product visible story')).toHaveCount(0);
    await expect(page.locator('#eng-alert-missing').getByRole('button', { name: /Resumed product visible story/ })).toBeVisible();
});

test('Catch Up status mutation aborts and replaces its in-flight alert cohort without refetching visible tasks', async ({ page }) => {
    const preMutationGate = deferred();
    const calls = await installFixture(page, {
        alertCohorts: [
            { gate: preMutationGate, label: 'Pre-mutation ' },
            { label: 'Post-mutation ' },
        ],
    });
    await seedMode(page, 'catchUp');
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForCallCount(calls, isAlertCall, 5);

    const statusTrigger = page.locator('[data-status-transition-trigger][data-issue-kind="story"][data-issue-key="PROD-1"]');
    await statusTrigger.click();
    await page.locator('.status-transition-menu[data-issue-key="PROD-1"]')
        .getByRole('menuitem', { name: 'In Progress' }).click();
    await waitForCallCount(calls, call => call.pathname === '/api/issues/transitions' && call.method === 'POST', 1);
    await waitForCallCount(calls, call => isAlertCall(call) && call.alertCohort === 0 && call.aborted, 5);
    await waitForCallCount(calls, isAlertCall, 10);

    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose)).toHaveLength(2);
    await expect(page.locator('#eng-alert-missing').getByRole('button', { name: /Post-mutation product visible story/ })).toBeVisible();
    preMutationGate.resolve();
    await expect(page.getByText('Pre-mutation product visible story')).toHaveCount(0);
});
