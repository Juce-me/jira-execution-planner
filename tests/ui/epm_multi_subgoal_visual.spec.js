const { test, expect } = require('@playwright/test');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/epm-multi-subgoal-qa';

function project(tab, key, label) {
    const stateByTab = {
        active: ['ON_TRACK', 'On track'],
        backlog: ['PAUSED', 'Paused'],
        archived: ['DONE', 'Done'],
    };
    const [stateValue, stateLabel] = stateByTab[tab] || stateByTab.active;
    const subGoalName = key === 'CHILD-A' ? '[EPM] BidSwitch' : '[EPM] AI Labs';
    return {
        id: `${tab}-${key.toLowerCase()}`,
        homeProjectId: `${tab}-${key.toLowerCase()}`,
        name: `${tab[0].toUpperCase()}${tab.slice(1)} ${label}`,
        displayName: `${tab[0].toUpperCase()}${tab.slice(1)} ${label}`,
        label: `rnd_project_${tab}_${key.toLowerCase()}`,
        stateValue,
        stateLabel,
        tabBucket: tab,
        latestUpdateDate: '2026-05-04',
        latestUpdateSnippet: `${label} update`,
        homeUrl: `https://home.example/${tab}-${key.toLowerCase()}`,
        resolvedLinkage: { labels: [`rnd_project_${tab}_${key.toLowerCase()}`], epicKeys: [] },
        matchState: 'home-linked',
        subGoalKeys: [key],
        subGoals: [{ key, name: subGoalName }],
    };
}

function projectsFor(url) {
    const tab = url.searchParams.get('tab') || 'active';
    const narrowed = (url.searchParams.get('subGoalKeys') || '').split(',').filter(Boolean);
    const keys = narrowed.length ? narrowed : ['CHILD-A', 'CHILD-B'];
    return keys.map((key) => project(tab, key, key === 'CHILD-A' ? 'Alpha' : 'Beta'));
}

function emptyRollup(project) {
    return {
        project,
        rollup: {
            metadataOnly: false,
            emptyRollup: true,
            truncated: false,
            truncatedQueries: [],
            initiatives: {},
            rootEpics: {},
            orphanStories: [],
        },
    };
}

test('EPM multi sub-goal visual smoke', async ({ page }) => {
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
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                epm: {
                    version: 2,
                    labelPrefix: 'rnd_project_',
                    scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-A', 'CHILD-B'] },
                    issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story', 'Task'] },
                    projects: {},
                },
            });
        }
        if (url.pathname === '/api/auth/refresh') {
            return route.fulfill({ status: 204, body: '' });
        }
        if (url.pathname === '/api/me/connections/home-token') {
            return json({
                connected: true,
                provider: 'atlassian_user_api_token',
                credentialSubject: 'profile@example.com',
                status: 'active',
                needsReconnect: false,
            });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 42, name: 'Sprint 42', state: 'active' }] });
        }
        if (url.pathname === '/api/epm/projects') {
            return json({ projects: projectsFor(url) });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            return json({
                projects: projectsFor(url).map(emptyRollup),
                duplicates: {},
                truncated: false,
                fallback: true,
            });
        }
        return json({});
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Alpha' })).toBeVisible();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Beta' })).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/active-multiple-subgoals.png`, fullPage: true });

    await page.getByRole('button', { name: 'Filter EPM sub-goals' }).click();
    await expect(page.locator('.epm-subgoal-option-name', { hasText: 'BidSwitch' })).toBeVisible();
    await expect(page.locator('.epm-subgoal-option-key', { hasText: 'CHILD-A' })).toBeVisible();
    await expect(page.locator('.epm-subgoal-option-name', { hasText: '[EPM]' })).toHaveCount(0);
    await page.screenshot({ path: `${screenshotDir}/active-subgoal-dropdown-open.png`, fullPage: true });
    await page.locator('[data-sub-goal-key="CHILD-A"]').click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Alpha' })).toBeVisible();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Active Beta' })).toHaveCount(0);
    await page.screenshot({ path: `${screenshotDir}/active-narrowed-subgoal.png`, fullPage: true });

    await page.getByRole('radio', { name: 'Backlog' }).first().click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Backlog Alpha' })).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/backlog-narrowed-subgoal.png`, fullPage: true });

    await page.getByRole('radio', { name: 'Archived' }).first().click();
    await expect(page.locator('.epm-project-board-name', { hasText: 'Archived Alpha' })).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/archived-narrowed-subgoal.png`, fullPage: true });
});

test('EPM sub-goal filter resolves saved sibling names before narrowing', async ({ page }) => {
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
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                epm: {
                    version: 2,
                    labelPrefix: 'rnd_project_',
                    scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-A', 'CHILD-B'] },
                    issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story', 'Task'] },
                    projects: {},
                },
            });
        }
        if (url.pathname === '/api/auth/refresh') {
            return route.fulfill({ status: 204, body: '' });
        }
        if (url.pathname === '/api/me/connections/home-token') {
            return json({
                connected: true,
                provider: 'atlassian_user_api_token',
                credentialSubject: 'profile@example.com',
                status: 'active',
                needsReconnect: false,
            });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 42, name: 'Sprint 42', state: 'active' }] });
        }
        if (url.pathname === '/api/epm/goals' && url.searchParams.get('rootGoalKey') === 'ROOT-100') {
            return json({
                goals: [
                    { key: 'CHILD-A', name: '[EPM] BidSwitch' },
                    { key: 'CHILD-B', name: '[EPM] AI Labs' },
                ],
            });
        }
        if (url.pathname === '/api/epm/projects') {
            const narrowed = (url.searchParams.get('subGoalKeys') || '').split(',').filter(Boolean);
            return json({ projects: narrowed.length ? projectsFor(url) : [project('active', 'CHILD-A', 'Alpha')] });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            const narrowed = (url.searchParams.get('subGoalKeys') || '').split(',').filter(Boolean);
            const projects = narrowed.length ? projectsFor(url) : [project('active', 'CHILD-A', 'Alpha')];
            return json({
                projects: projects.map(emptyRollup),
                duplicates: {},
                truncated: false,
                fallback: true,
            });
        }
        return json({});
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Filter EPM sub-goals' }).click();
    await expect(page.locator('[data-sub-goal-key="CHILD-B"] .epm-subgoal-option-name')).toHaveText('AI Labs');
    await expect(page.locator('[data-sub-goal-key="CHILD-B"] .epm-subgoal-option-key')).toHaveText('CHILD-B');
    await page.screenshot({ path: `${screenshotDir}/saved-sibling-subgoal-name.png`, fullPage: true });
});
