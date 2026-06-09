const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const groupTeamIds = ['team-alpha'];
let dashboardJs;

test.beforeAll(() => {
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    dashboardJs = result.outputFiles[0].text;
});

function json(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

function makeStory(key, status) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic future planning story`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            customfield_10004: 1,
            epicKey: 'PLAN-EPIC',
            parentSummary: 'Future planning epic',
            projectKey: 'PLAN',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
        },
    };
}

function makeEpic() {
    return {
        key: 'PLAN-EPIC',
        summary: 'Future planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
    };
}

const futureStories = [
    makeStory('PLAN-1', 'To Do'),
    makeStory('PLAN-2', 'Pending'),
    makeStory('PLAN-3', 'Accepted'),
];

async function installPlanningFixture(page) {
    const calls = [];
    let groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{
            id: 'group-alpha',
            name: 'Alpha Department',
            teamIds: groupTeamIds,
            labels: ['alpha_label'],
            excludedCapacityEpics: []
        }],
        preferences: {
            onboardingRequired: false,
            customized: false,
            visibleGroupIds: [],
            effectiveVisibleGroupIds: ['group-alpha'],
            activeGroupId: 'group-alpha',
        },
    };

    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const body = request.method() === 'POST' ? requestBody(request) : null;
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
            headers: request.headers(),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/me/connections/home-token') {
            return json(route, {
                connected: false,
                provider: 'atlassian_user_api_token',
                status: 'missing',
                needsReconnect: false,
            });
        }
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                authMode: 'basic',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
                viewConfig: {
                    version: 1,
                    view: {
                        selectedView: 'eng',
                        selectedSprint: activeSprintId,
                        sprintName: activeSprintName,
                        activeGroupId: 'group-alpha',
                        showPlanning: false,
                        showScenario: false,
                    },
                },
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') {
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            const payload = requestBody(request);
            if (payload.baseRevision !== groupsConfigPayload.configRevision) {
                return json(route, { error: 'group_config_conflict', current: groupsConfigPayload }, 409);
            }
            groupsConfigPayload = {
                version: payload.version || 1,
                source: 'workspace_db',
                configRevision: groupsConfigPayload.configRevision + 1,
                defaultGroupId: payload.defaultGroupId || '',
                groups: payload.groups || [],
                preferences: groupsConfigPayload.preferences,
            };
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [
                    { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                    { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const issues = project === 'product' && !purpose ? futureStories : [];
            const epic = makeEpic();
            return json(route, {
                issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return { calls, getGroupsConfig: () => groupsConfigPayload };
}

async function openFuturePlanning(page) {
    const sprintDropdown = page.locator('.sprint-dropdown').first();
    const sprintToggle = sprintDropdown.locator('.sprint-dropdown-toggle');
    await expect(sprintToggle).toHaveAttribute('aria-disabled', 'false');
    await sprintToggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.task-list .epic-block', { hasText: 'PLAN-EPIC' })).toBeVisible();
}

function selectedStat(page) {
    return page.locator('.planning-panel.open .planning-stat-value').first();
}

function storyCheckbox(page, key) {
    return page.locator('.task-item', { hasText: key }).locator('input.task-checkbox');
}

test('new future planning sprint defaults to all selected stories', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
    await expect(page.getByRole('button', { name: 'Select All' })).toHaveClass(/active/);
});

test('manual future planning checkbox edits persist until Select All is clicked', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await storyCheckbox(page, 'PLAN-2').click();
    await expect(selectedStat(page)).toContainText('2 · 2.0 SP');
    await expect.poll(async () => page.evaluate(({ sprintId }) => {
        const payload = JSON.parse(window.localStorage.getItem('jira_dashboard_planning_state_v1') || '{}');
        const state = payload[`planning::${sprintId}::group-alpha`] || {};
        return {
            selectedTaskKeys: state.selectedTaskKeys || [],
            selectionMode: state.selectionMode || '',
        };
    }, { sprintId: futureSprintId })).toEqual({
        selectedTaskKeys: ['PLAN-1', 'PLAN-3'],
        selectionMode: 'manual',
    });
    await page.reload();
    await openFuturePlanning(page);
    await expect(selectedStat(page)).toContainText('2 · 2.0 SP');

    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
    await page.reload();
    await openFuturePlanning(page);
    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
});

test('planning undo restores loaded selection after a bulk status action', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
    await page.getByRole('button', { name: 'Accepted' }).click();
    await expect(selectedStat(page)).toContainText('2 · 2.0 SP');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('planning epic excluded-capacity toggle updates shared group config', async ({ page }) => {
    const fixture = await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    const epicBlock = page.locator('.task-list .epic-block', { hasText: 'PLAN-EPIC' }).first();
    await epicBlock.getByRole('button', { name: /Included/ }).click();
    await expect(epicBlock.getByRole('button', { name: /Excluded/ })).toBeVisible();

    const saveCalls = fixture.calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].body.baseRevision).toBe(1);
    expect(saveCalls[0].body.groups[0].excludedCapacityEpics).toEqual(['PLAN-EPIC']);
    expect(fixture.getGroupsConfig().groups[0].excludedCapacityEpics).toEqual(['PLAN-EPIC']);

    await page.reload();
    await openFuturePlanning(page);
    await expect(epicBlock.getByRole('button', { name: /Excluded/ })).toBeVisible();
});
