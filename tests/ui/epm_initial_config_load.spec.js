const { test, expect } = require('@playwright/test');

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'ROOT-100', subGoalKey: 'CHILD-200' },
    issueTypes: {
        initiative: ['Initiative'],
        epic: ['Epic'],
        leaf: ['Story', 'Task', 'Sub-task', 'Subtask', 'Bug'],
    },
    projects: {
        'home-1': {
            id: 'home-1',
            homeProjectId: 'home-1',
            name: 'AI for RFP creation',
            label: 'rnd_project_rfp_ai',
        },
    },
};

const epmProject = {
    id: 'home-1',
    homeProjectId: 'home-1',
    name: 'AI for RFP creation',
    displayName: 'AI for RFP creation',
    label: 'rnd_project_rfp_ai',
    stateValue: 'ON_TRACK',
    stateLabel: 'On track',
    tabBucket: 'active',
    latestUpdateDate: '2026-04-29',
    latestUpdateSnippet: 'Project is ready for sprint review.',
    homeUrl: 'https://home.atlassian.com/project/home-1',
    resolvedLinkage: { labels: ['rnd_project_rfp_ai'], epicKeys: [] },
    matchState: 'home-linked',
};

async function mockDashboardLoad(page) {
    const calls = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'epm',
            epmTab: 'active',
            epmSelectedProjectId: '',
            selectedSprint: 34625,
        }));
    });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        calls.push(`${route.request().method()} ${url.pathname}`);
        const json = (body) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                projectsConfigured: true,
                epm: epmConfig,
            });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 34625, name: '2026Q2', state: 'active' }] });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            return json({
                projects: [{ project: epmProject, rollup: { emptyRollup: true } }],
                duplicates: {},
                truncated: false,
                fallback: true,
            });
        }
        if (url.pathname === '/api/epm/projects') {
            return json({ projects: [epmProject] });
        }
        return json({});
    });
    return calls;
}

test('EPM view loads saved config from initial user config without opening Settings', async ({ page }) => {
    const calls = await mockDashboardLoad(page);

    await page.goto('http://127.0.0.1:5050');

    await expect(page.locator('.epm-project-board-name', { hasText: 'AI for RFP creation' })).toBeVisible();
    await expect(page.getByText('No issues in this scope.')).toBeVisible();
    expect(calls).toContain('GET /api/config');
    expect(calls).toContain('GET /api/epm/projects/rollup/all');
    expect(calls).not.toContain('POST /api/epm/projects/configuration');
    await page.screenshot({ path: '/tmp/epm-initial-load-from-user-config.png', fullPage: true });
});
