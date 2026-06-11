const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const screenshotDir = '/tmp/shared-department-groups-qa';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (_) {
        return request.postData();
    }
}

function defaultGroupPreferences(overrides = {}) {
    return {
        customized: false,
        preferenceExists: false,
        onboardingRequired: true,
        visibleGroupIds: [],
        activeGroupId: null,
        effectiveVisibleGroupIds: [],
        ...overrides,
    };
}

async function mockFirstRunDashboard(page, options = {}) {
    const calls = [];
    const groupsConfig = options.groupsConfig || {
        version: 1,
        groups: [
            { id: 'platform', name: 'Platform', teamIds: ['team-platform'] },
            { id: 'growth', name: 'Growth', teamIds: ['team-growth'] },
        ],
        defaultGroupId: 'platform',
        configRevision: 2,
        source: 'workspace_db',
    };
    const preferences = options.preferences || defaultGroupPreferences();
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
            params: Object.fromEntries(url.searchParams.entries()),
            body: requestBody(request),
        });
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: false });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                projectsConfigured: true,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                userCanEditEpmConfig: false,
            });
        }
        if (url.pathname === '/api/groups-config') {
            return json({
                ...groupsConfig,
                preferences,
            });
        }
        if (url.pathname === '/api/groups-preferences') {
            const body = requestBody(request) || {};
            return json({
                preferences: {
                    customized: true,
                    preferenceExists: true,
                    onboardingRequired: false,
                    visibleGroupIds: body.visibleGroupIds || ['platform'],
                    activeGroupId: body.activeGroupId || 'platform',
                    effectiveVisibleGroupIds: body.visibleGroupIds || ['platform'],
                },
            });
        }
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: 42, name: '2026Q2 Sprint 42', state: 'active' }] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            return json({ issues: [], epics: {}, epicsInScope: [] });
        }
        if (url.pathname === '/api/missing-info') {
            return json({ issues: [], epics: [] });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/board-config') return json({ boardId: '42', boardName: 'Synthetic Board' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [] });
        if (url.pathname === '/api/capacity/config') return json({});
        if (url.pathname.endsWith('-field/config')) return json({});
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Story'] });
        return json({});
    });
    return calls;
}

function overflowGroupConfig() {
    return {
        version: 1,
        groups: [{
            id: 'bidswitch',
            name: 'Bidswitch',
            teamIds: Array.from({ length: 12 }, (_, index) => `team-${index + 1}`),
            missingInfoComponents: Array.from({ length: 8 }, (_, index) => `ATS Component ${index + 1}`),
            excludedCapacityEpics: Array.from({ length: 28 }, (_, index) => `TECH-${26000 + index}`),
        }],
        defaultGroupId: 'bidswitch',
        configRevision: 4,
        source: 'workspace_db',
    };
}

test('first-run department selection blocks group-scoped task loads until preferences are saved', async ({ page }) => {
    const calls = await mockFirstRunDashboard(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('dialog', { name: 'Choose department groups' })).toBeVisible();
    await expect(page.getByLabel('Search groups')).toBeVisible();
    await expect(page.locator('.department-first-run-option-name')).toHaveText(['Growth', 'Platform']);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${screenshotDir}/first-run-selection.png`, fullPage: true });
    await expect(page.getByLabel('Platform')).toBeChecked();
    await page.waitForTimeout(250);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(0);

    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('dialog', { name: 'Choose department groups' })).toHaveCount(0);
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length).toBeGreaterThanOrEqual(2);
    const preferenceSave = calls.find(call => call.method === 'POST' && call.pathname === '/api/groups-preferences');
    expect(preferenceSave).toBeTruthy();
    expect(preferenceSave.body.visibleGroupIds).toEqual(['platform']);
    const taskCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name');
    expect(taskCalls.every(call => call.params.groupId === 'platform')).toBe(true);
    expect(taskCalls.every(call => call.params.teamIds === 'team-platform')).toBe(true);
});

test('department group editor keeps save visible when selected group content overflows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const groupsConfig = overflowGroupConfig();
    await mockFirstRunDashboard(page, {
        groupsConfig,
        preferences: defaultGroupPreferences({
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            visibleGroupIds: ['bidswitch'],
            activeGroupId: 'bidswitch',
            effectiveVisibleGroupIds: ['bidswitch'],
        }),
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();

    const dialog = page.locator('.group-modal');
    await expect(dialog.locator('.group-modal-tab.active', { hasText: 'Departments' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Team groups' })).toHaveAttribute('aria-selected', 'true');

    const saveButton = dialog.getByRole('button', { name: 'Save' });
    await dialog.getByPlaceholder('Group name').fill('Bidswitch updated');
    await expect(dialog.getByText(/Unsaved changes/)).toBeVisible();
    await expect(saveButton).toBeEnabled();

    const paneScrollable = await dialog.locator('.group-pane-right').evaluate((node) => (
        node.scrollHeight > node.clientHeight + 8
    ));
    expect(paneScrollable).toBe(true);

    const saveBox = await saveButton.boundingBox();
    const modalBox = await dialog.boundingBox();
    expect(saveBox).not.toBeNull();
    expect(modalBox).not.toBeNull();
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(modalBox.y + modalBox.height - 6);
    expect(saveBox.y).toBeGreaterThanOrEqual(modalBox.y);

    await page.screenshot({ path: `${screenshotDir}/settings-save-footer-visible.png`, fullPage: true });
});
