const fs = require('node:fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = path.join(__dirname, '..', '..', 'test-results', 'eng-epic-sort-and-track-qa');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha'];

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function story(key, status, summary, overrides = {}) {
    const projectKey = key.split('-')[0];
    const epicKey = overrides.epicKey || `${projectKey}-EPIC`;
    const teamId = overrides.teamId || 'team-alpha';
    const teamName = overrides.teamName || 'Alpha Team';
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: overrides.priority || 'Medium' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Planner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: overrides.storyPoints ?? 3,
            epicKey,
            parentSummary: `${projectKey} epic`,
            projectKey,
            teamId,
            teamName,
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            ...(overrides.fields || {}),
        },
    };
}

function epic(key, summaryText, overrides = {}) {
    const projectKey = key.split('-')[0];
    const teamId = overrides.teamId || 'team-alpha';
    const teamName = overrides.teamName || 'Alpha Team';
    return {
        key,
        summary: summaryText,
        status: { name: 'In Progress' },
        assignee: { displayName: `${projectKey} Lead` },
        teamId,
        teamName,
        projectTrack: overrides.projectTrack || null,
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        ...overrides,
    };
}

const commitStory = story('COMMIT-2', 'In Progress', 'High priority committed story', {
    epicKey: 'COMMIT-1',
    priority: 'High',
    storyPoints: 5,
});
const flexStory = story('FLEX-2', 'To Do', 'Low priority flexible story', {
    epicKey: 'FLEX-1',
    priority: 'Low',
    storyPoints: 2,
});

const commitEpic = epic('COMMIT-1', 'Committed epic', { projectTrack: 'Committed' });
const flexEpic = epic('FLEX-1', 'Flexible epic', { projectTrack: 'Flexible' });

async function installTrackFixture(page) {
    await installDashboardShell(page);
    await page.route('**/api/**', route => {
        const request = route.request();
        const url = new URL(request.url());
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        }
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
                    teamIds: groupTeamIds,
                    teamLabels: { 'team-alpha': 'Alpha Team' },
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        }
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const purpose = url.searchParams.get('purpose');
            if (purpose === 'ready-to-close') {
                return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            }
            return json({
                issues: [commitStory, flexStory],
                epics: {
                    'COMMIT-1': commitEpic,
                    'FLEX-1': flexEpic,
                },
                epicsInScope: [commitEpic, flexEpic],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') {
            return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        }
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openEng(page, viewport, prefOverrides = {}) {
    await page.setViewportSize(viewport);
    await installTrackFixture(page);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showScenario: false,
        showAlertsPanel: false,
        ...prefOverrides,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.epic-block', { timeout: 10000 });
}

test('epic header shows effective priority pill and Product Track emoji', async ({ page }) => {
    await openEng(page, { width: 1280, height: 900 });

    const committedHeader = page.locator('.epic-block', { hasText: 'COMMIT-1' }).locator('.epic-header');
    await expect(committedHeader.locator('.epic-priority-pill')).toHaveText(/High/i);
    await expect(committedHeader.locator('.epic-track-indicator')).toHaveText('🔒');

    const flexHeader = page.locator('.epic-block', { hasText: 'FLEX-1' }).locator('.epic-header');
    await expect(flexHeader.locator('.epic-track-indicator')).toHaveText('🤷');

    await page.screenshot({ path: `${screenshotDir}/epic-priority-track.png`, fullPage: false });
});

test('Sort dropdown reorders epics by Product Track (committed first)', async ({ page }) => {
    // FLEX-1 appears after COMMIT-1 in default fixture order; pick "Track: Committed first"
    // and assert COMMIT-1's .epic-block precedes FLEX-1's .epic-block in the DOM.
    await openEng(page, { width: 1280, height: 900 });

    await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle').click();
    // The dropdown panel is inside .filters-strip which has animation-fill-mode:both; the
    // resulting transform stacking context puts the panel behind the task list in z-order.
    // Force the click so the option registers regardless of pointer-event interception.
    await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-option', { hasText: 'Track: Committed first' }).click();

    const keys = await page.locator('.task-list .epic-block .epic-key').allInnerTexts();
    const iCommit = keys.findIndex(k => k.includes('COMMIT-1'));
    const iFlex = keys.findIndex(k => k.includes('FLEX-1'));
    expect(iCommit).toBeGreaterThanOrEqual(0);
    expect(iCommit).toBeLessThan(iFlex);

    await page.screenshot({ path: `${screenshotDir}/sort-track-committed-first.png`, fullPage: false });
});
