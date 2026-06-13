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
const secondFutureSprintId = 5003;
const secondFutureSprintName = '2026Q3 Sprint 2';
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

function makeStory(key, status, sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
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
            epicKey,
            parentSummary: 'Future planning epic',
            projectKey: 'PLAN',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
        },
    };
}

function makeEpic(sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        key: epicKey,
        summary: 'Future planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
    };
}

const futureStories = [
    makeStory('PLAN-1', 'To Do'),
    makeStory('PLAN-2', 'Pending'),
    makeStory('PLAN-3', 'Accepted'),
];
const secondFutureStories = [
    makeStory('PLAN-4', 'To Do', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
    makeStory('PLAN-5', 'Accepted', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
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
                    { id: secondFutureSprintId, name: secondFutureSprintName, state: 'future', startDate: '2026-07-15' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const sprint = url.searchParams.get('sprint');
            const issues = project === 'product' && !purpose
                ? (String(sprint) === String(secondFutureSprintId) ? secondFutureStories : futureStories)
                : [];
            const epic = String(sprint) === String(secondFutureSprintId)
                ? makeEpic(secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2')
                : makeEpic();
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
    await selectSprint(page, futureSprintName);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.task-list .epic-block', { hasText: 'PLAN-EPIC' })).toBeVisible();
}

async function selectSprint(page, sprintName) {
    const sprintDropdown = page.locator('.sprint-dropdown').first();
    const sprintToggle = sprintDropdown.locator('.sprint-dropdown-toggle');
    await expect(sprintToggle).toHaveAttribute('aria-disabled', 'false');
    if ((await sprintToggle.textContent() || '').includes(sprintName)) {
        return;
    }
    await sprintToggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: sprintName }).click();
}

function selectedStat(page) {
    return page.locator('.planning-panel.open .planning-stat-value').first();
}

function storyCheckbox(page, key) {
    return page.locator('.task-item', { hasText: key }).locator('input.task-checkbox');
}

async function planningCardLayout(page, key) {
    return page.locator(`.task-item[data-task-key="${key}"]`).evaluate((card) => {
        const rectFor = (selector) => {
            const node = card.querySelector(selector);
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                centerY: rect.y + rect.height / 2,
            };
        };
        const planningMeta = card.querySelector('.planning-selection-meta');
        const checkbox = card.querySelector('.task-headline > .task-checkbox');
        const storyPoints = card.querySelector('.task-headline > .task-inline-sp');
        const keyLink = card.querySelector('.planning-selection-meta .task-key-link');
        const planningMetaStyle = planningMeta ? getComputedStyle(planningMeta) : null;
        const cardStyle = getComputedStyle(card);
        const titleAnchor = card.querySelector('.task-title a');
        const titleRange = card.ownerDocument.createRange();
        titleRange.selectNodeContents(titleAnchor);
        const titleTextRect = titleRange.getBoundingClientRect();
        const titleAnchorRect = titleAnchor.getBoundingClientRect();
        return {
            cardClassName: card.className,
            checkboxInHeadline: Boolean(card.querySelector('.task-headline > .task-checkbox')),
            storyPointsInHeadline: Boolean(card.querySelector('.task-headline > .task-inline-sp')),
            headerRightInlineMeta: Boolean(card.querySelector('.task-header-right .task-inline-meta')),
            planningMetaInTaskMeta: Boolean(card.querySelector('.task-meta .planning-selection-meta')),
            planningMetaChildClasses: Array.from(planningMeta?.children || []).map((node) => node.className || node.tagName.toLowerCase()),
            planningMetaText: planningMeta?.textContent || '',
            taskMetaHasCheckbox: Boolean(card.querySelector('.task-meta .task-checkbox')),
            taskMetaHasStoryPoints: Boolean(card.querySelector('.task-meta .task-inline-sp')),
            planningMetaMarginLeft: planningMetaStyle?.marginLeft || '',
            planningMetaWidth: planningMeta ? planningMeta.getBoundingClientRect().width : 0,
            checkboxAriaLabel: checkbox?.getAttribute('aria-label') || '',
            checkboxChecked: Boolean(checkbox?.checked),
            checkboxBorderRadius: checkbox ? getComputedStyle(checkbox).borderRadius : '',
            checkboxBoxShadow: checkbox ? getComputedStyle(checkbox).boxShadow : '',
            selectedBoxShadow: cardStyle.boxShadow,
            selectedBackgroundImage: cardStyle.backgroundImage,
            borderLeftColor: cardStyle.borderLeftColor,
            cardClientWidth: card.clientWidth,
            cardScrollWidth: card.scrollWidth,
            documentClientWidth: card.ownerDocument.documentElement.clientWidth,
            documentScrollWidth: card.ownerDocument.documentElement.scrollWidth,
            storyPoints: rectFor('.task-headline > .task-inline-sp'),
            checkbox: rectFor('.task-headline > .task-checkbox'),
            keyLink: rectFor('.planning-selection-meta .task-key-link'),
            titleAnchorExtraWidth: titleAnchorRect.width - titleTextRect.width,
        };
    });
}

test('new future planning sprint defaults to all selected stories', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
    await expect(page.getByRole('button', { name: 'Select All' })).toHaveClass(/active/);
});

test('planning story selection controls align with story-point metadata', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    const layout = await planningCardLayout(page, 'PLAN-1');
    expect(layout.cardClassName).toContain('is-planning-selectable');
    expect(layout.cardClassName).toContain('is-planning-selected');
    expect(layout.checkboxInHeadline).toBe(true);
    expect(layout.storyPointsInHeadline).toBe(true);
    expect(layout.headerRightInlineMeta).toBe(false);
    expect(layout.planningMetaInTaskMeta).toBe(true);
    expect(layout.planningMetaChildClasses).toEqual(['task-key-link']);
    expect(layout.planningMetaText.trim()).toBe('PLAN-1');
    expect(layout.taskMetaHasCheckbox).toBe(false);
    expect(layout.taskMetaHasStoryPoints).toBe(false);
    expect(layout.checkboxAriaLabel).toBe('Select PLAN-1 for sprint planning');
    expect(layout.checkboxChecked).toBe(true);
    expect(layout.storyPoints).toBeTruthy();
    expect(layout.checkbox).toBeTruthy();
    expect(layout.keyLink).toBeTruthy();
    expect(layout.checkbox.x).toBeGreaterThan(layout.storyPoints.right);
    expect(Math.abs(layout.checkbox.centerY - layout.storyPoints.centerY)).toBeLessThanOrEqual(4);
    expect(layout.titleAnchorExtraWidth).toBeLessThanOrEqual(3);
    expect(Number.parseFloat(layout.checkboxBorderRadius)).toBeGreaterThanOrEqual(6);
    expect(layout.selectedBoxShadow).not.toBe('none');
    expect(layout.selectedBoxShadow).toContain('47, 128, 237');
    expect(layout.selectedBackgroundImage).toContain('47, 128, 237');
    expect(layout.borderLeftColor).not.toBe('rgb(82, 196, 26)');
});

test('planning story checkbox toggles selected card treatment', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await storyCheckbox(page, 'PLAN-2').click();
    const unselected = await planningCardLayout(page, 'PLAN-2');
    expect(unselected.cardClassName).not.toContain('is-planning-selected');
    expect(unselected.checkboxChecked).toBe(false);

    await storyCheckbox(page, 'PLAN-2').click();
    const selected = await planningCardLayout(page, 'PLAN-2');
    expect(selected.cardClassName).toContain('is-planning-selected');
    expect(selected.checkboxChecked).toBe(true);
    expect(selected.selectedBoxShadow).not.toBe('none');
    expect(selected.selectedBackgroundImage).not.toBe('none');
    expect(selected.borderLeftColor).not.toBe('rgb(82, 196, 26)');
});

test('planning selection meta wraps without horizontal overflow on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    const layout = await planningCardLayout(page, 'PLAN-1');
    expect(layout.planningMetaInTaskMeta).toBe(true);
    expect(layout.taskMetaHasCheckbox).toBe(false);
    expect(layout.taskMetaHasStoryPoints).toBe(false);
    expect(layout.checkbox).toBeTruthy();
    expect(layout.storyPoints).toBeTruthy();
    expect(layout.keyLink).toBeTruthy();
    expect(layout.planningMetaMarginLeft).toBe('0px');
    expect(layout.planningMetaWidth).toBeLessThanOrEqual(layout.cardClientWidth);
    expect(layout.cardScrollWidth - layout.cardClientWidth).toBeLessThanOrEqual(1);
    expect(layout.documentScrollWidth - layout.documentClientWidth).toBeLessThanOrEqual(1);
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
    await page.getByRole('button', { name: 'Accepted', exact: true }).click();
    await expect(selectedStat(page)).toContainText('2 · 2.0 SP');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(selectedStat(page)).toContainText('3 · 3.0 SP');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('select all remains scoped when switching future planning sprints', async ({ page }) => {
    await installPlanningFixture(page);
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await page.getByRole('button', { name: 'Select All' }).click();
    await selectSprint(page, secondFutureSprintName);
    await expect(page.locator('.task-list .epic-block', { hasText: 'PLAN-EPIC-2' })).toBeVisible();
    await expect(selectedStat(page)).toContainText('2 · 2.0 SP');

    await expect.poll(async () => page.evaluate(({ firstSprintId, secondSprintId }) => {
        const payload = JSON.parse(window.localStorage.getItem('jira_dashboard_planning_state_v1') || '{}');
        const first = payload[`planning::${firstSprintId}::group-alpha`] || {};
        const second = payload[`planning::${secondSprintId}::group-alpha`] || {};
        return {
            firstTaskKeys: first.selectedTaskKeys || [],
            firstMode: first.selectionMode || '',
            secondTaskKeys: second.selectedTaskKeys || [],
            secondMode: second.selectionMode || '',
        };
    }, { firstSprintId: futureSprintId, secondSprintId: secondFutureSprintId })).toEqual({
        firstTaskKeys: ['PLAN-1', 'PLAN-2', 'PLAN-3'],
        firstMode: 'default_all',
        secondTaskKeys: ['PLAN-4', 'PLAN-5'],
        secondMode: 'default_all',
    });
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
