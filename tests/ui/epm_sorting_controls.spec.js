const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'ROOT-100', subGoalKey: 'CHILD-200' },
    issueTypes: {
        initiative: ['Initiative'],
        epic: ['Epic'],
        leaf: ['Story', 'Task'],
    },
    projects: {},
};

const recentCompletedProject = {
    id: 'recent-completed',
    homeProjectId: 'recent-completed',
    name: 'Recently Completed Project',
    displayName: 'Recently Completed Project',
    label: 'rnd_project_recent_completed',
    stateValue: 'COMPLETED',
    stateLabel: 'Completed',
    tabBucket: 'archived',
    recentlyCompleted: true,
    lifecycleBucket: 'recently-completed',
    latestUpdateDate: '2026-05-24',
    latestUpdateSnippet: 'Released and ready for post-success monitoring.',
    resolvedLinkage: { labels: ['rnd_project_recent_completed'], epicKeys: [] },
    matchState: 'home-linked',
};

const criticalProject = {
    id: 'critical-open',
    homeProjectId: 'critical-open',
    name: 'Critical Open Project',
    displayName: 'Critical Open Project',
    label: 'rnd_project_critical_open',
    stateValue: 'ON_TRACK',
    stateLabel: 'On track',
    tabBucket: 'active',
    latestUpdateDate: '2026-05-20',
    latestUpdateSnippet: 'Needs attention on a critical epic.',
    resolvedLinkage: { labels: ['rnd_project_critical_open'], epicKeys: [] },
    matchState: 'home-linked',
};

const lowProject = {
    id: 'low-open',
    homeProjectId: 'low-open',
    name: 'Low Open Project',
    displayName: 'Low Open Project',
    label: 'rnd_project_low_open',
    stateValue: 'ON_TRACK',
    stateLabel: 'On track',
    tabBucket: 'active',
    latestUpdateDate: '2026-05-25',
    latestUpdateSnippet: 'Fresh update on lower-priority work.',
    resolvedLinkage: { labels: ['rnd_project_low_open'], epicKeys: [] },
    matchState: 'home-linked',
};

function rollup(project, epic) {
    return {
        project,
        rollup: {
            metadataOnly: false,
            emptyRollup: false,
            truncated: false,
            truncatedQueries: [],
            initiatives: {},
            rootEpics: {
                [epic.key]: {
                    issue: epic,
                    stories: [],
                },
            },
            orphanStories: [],
        },
    };
}

async function boardNames(page) {
    return page.locator('.epm-project-board-name').evaluateAll(nodes => (
        nodes.map(node => node.textContent.trim())
    ));
}

test('EPM sort control pins recently completed projects and reorders active boards', async ({ page }) => {
    await installDashboardShell(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'epm',
            epmTab: 'active',
            epmSelectedProjectId: '',
            selectedSprint: 42,
            sprintName: 'Sprint 42',
        }));
    });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const json = (body) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                authMode: 'basic',
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                userCanEditEpmConfig: true,
                epm: epmConfig,
            });
        }
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') return json({ authMode: 'basic', authenticated: true });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json({ version: 1, groups: [], defaultGroupId: '', source: 'test' });
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/board-config') return json({ boardId: '5494', boardName: 'Synthetic Board', source: 'test' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/capacity/config') return json({ project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json({ fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Epic', 'Story'] });
        if (url.pathname === '/api/issue-types') return json({ issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: 42, name: 'Sprint 42', state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        if (url.pathname === '/api/epm/projects') {
            return json({ projects: [lowProject, criticalProject, recentCompletedProject] });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            return json({
                projects: [
                    rollup(lowProject, { key: 'LOW-1', summary: 'Low work', issueType: 'Epic', status: 'In Progress', priority: 'Low' }),
                    rollup(criticalProject, { key: 'CRIT-1', summary: 'Critical work', issueType: 'Epic', status: 'To Do', priority: 'Critical' }),
                    rollup(recentCompletedProject, { key: 'DONE-1', summary: 'Finished work', issueType: 'Epic', status: 'Done', priority: 'Lowest' }),
                ],
                duplicates: {},
                truncated: false,
                fallback: true,
            });
        }
        return json({});
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.epm-project-board')).toHaveCount(3);
    const completedPill = page.locator('.epm-project-board-status-pill.completed');
    await expect(completedPill).toHaveText('Completed 🎉');
    await expect(completedPill).toHaveCSS('text-transform', 'uppercase');
    await expect(completedPill).toHaveCSS('background-color', 'rgb(82, 196, 26)');
    await expect.poll(() => boardNames(page)).toEqual([
        'Recently Completed Project',
        'Critical Open Project',
        'Low Open Project',
    ]);

    await page.getByRole('button', { name: 'Sort EPM projects' }).click();
    await page.locator('[data-epm-sort="updated-desc"]').click();
    await expect.poll(() => boardNames(page)).toEqual([
        'Recently Completed Project',
        'Low Open Project',
        'Critical Open Project',
    ]);

    await page.getByRole('button', { name: 'Sort EPM projects' }).click();
    await page.locator('[data-epm-sort="updated-asc"]').click();
    await expect.poll(() => boardNames(page)).toEqual([
        'Recently Completed Project',
        'Critical Open Project',
        'Low Open Project',
    ]);
    await page.screenshot({ path: '/tmp/epm-sort-control.png', fullPage: true });
});
