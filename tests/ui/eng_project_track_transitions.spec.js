const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    installDashboardShell,
    installDashboardFixture,
} = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha'];
// The esbuild bundle strips CSS (loader '.css': 'empty'); the Project Track trigger/menu
// styles live in status-transitions.css (shared .issue-field/.project-track-transition
// selectors incl. the :has() z-index lift) and epics.css (button.epic-track-indicator).
// issues.css is included too, mirroring the priority harness, since it carries the shared
// interactive-icon button reset the priority trigger reuses.
const statusTransitionsCss = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'status-transitions.css'),
    'utf8',
);
const issuesCss = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'issues.css'),
    'utf8',
);
const epicsCss = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'epics.css'),
    'utf8',
);
const projectTrackMenuCss = `${statusTransitionsCss}\n${issuesCss}\n${epicsCss}`;
let dashboardJs;
const screenshotDir = path.join(repoRoot, 'test-results', 'project-track-visual');

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
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
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

function makeStory(key, epicKey, teamId = 'team-alpha', teamName = 'Alpha Team') {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic story`,
            status: { name: 'To Do' },
            priority: { name: 'Medium' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 1,
            epicKey,
            parentSummary: epicKey ? `${epicKey} epic` : null,
            projectKey: 'PROD',
            teamId,
            teamName,
            sprint: [{ id: activeSprintId, name: activeSprintName, state: 'active' }],
            subtaskSummary: null,
        },
    };
}

function makeEpic(key, projectTrack) {
    return {
        key,
        summary: `${key} epic`,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        projectTrack,
        sprint: [{ id: activeSprintId, name: activeSprintName, state: 'active' }],
    };
}

// Three real Epics (Committed, Flexible, and unidentified/null track) plus one task with no
// epicKey so a NO_EPIC group renders alongside them.
const committedEpic = makeEpic('COMMIT-1', 'Committed');
const flexibleEpic = makeEpic('FLEX-1', 'Flexible');
const unidentifiedEpic = makeEpic('UNKNOWN-1', null);
const committedStory = makeStory('COMMIT-2', 'COMMIT-1');
const flexibleStory = makeStory('FLEX-2', 'FLEX-1');
const unidentifiedStory = makeStory('UNKNOWN-2', 'UNKNOWN-1');
const noEpicStory = makeStory('LOOSE-1', null);

function defaultProjectTrackOptions() {
    return { options: [{ value: 'Flexible' }, { value: 'Committed' }], source: 'jira' };
}

function successProjectTrackWrite(body) {
    const from = body?.issueKey === 'FLEX-1' ? 'Flexible' : 'Committed';
    return { issueKey: body?.issueKey, result: 'success', fromTrack: from, toTrack: body?.targetTrack };
}

async function installEngProjectTrackFixture(page, {
    stories = null,
    epics = null,
    projectTrackDelayMs = 0,
    projectTrackWrite = successProjectTrackWrite,
    projectTrackWriteStatus = 200,
} = {}) {
    const calls = [];
    const writeState = { inFlight: 0, maxInFlight: 0 };
    const groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{ id: 'group-alpha', name: 'Alpha Department', teamIds: groupTeamIds, labels: ['alpha_label'], excludedCapacityEpics: [] }],
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
        calls.push({ method: request.method(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()), body });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/me/connections/home-token') {
            return json(route, { connected: false, provider: 'atlassian_user_api_token', status: 'missing', needsReconnect: false });
        }
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                authMode: 'atlassian_oauth',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') return json(route, groupsConfigPayload);
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') return json(route, groupsConfigPayload);
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [{ id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' }],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const defaultIssues = project === 'product' && !purpose
                ? [committedStory, flexibleStory, unidentifiedStory, noEpicStory]
                : [];
            const issues = (stories && project === 'product' && !purpose) ? stories : defaultIssues;
            const epicList = epics || [committedEpic, flexibleEpic, unidentifiedEpic];
            const epicsMap = {};
            epicList.forEach((epic) => { epicsMap[epic.key] = epic; });
            return json(route, {
                issues,
                epics: epicsMap,
                epicsInScope: project === 'product' ? epicList : [],
                names: {},
            });
        }
        if (url.pathname === '/api/issues/subtasks') return json(route, { parentKey: '', sprint: '', cached: false, summary: null, subtasks: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/issues/project-track/options') return json(route, defaultProjectTrackOptions());
        if (url.pathname === '/api/issues/project-track') {
            writeState.inFlight += 1;
            writeState.maxInFlight = Math.max(writeState.maxInFlight, writeState.inFlight);
            try {
                if (projectTrackDelayMs) {
                    await new Promise(resolve => setTimeout(resolve, projectTrackDelayMs));
                }
                if (projectTrackWriteStatus !== 200) {
                    return json(route, { error: 'jira_project_track_update_failed' }, projectTrackWriteStatus);
                }
                return json(route, projectTrackWrite(body));
            } finally {
                writeState.inFlight -= 1;
            }
        }
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return { calls, writeState };
}

async function setPrefs(page, prefs) {
    await page.addInitScript((value) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value));
    }, prefs);
}

function catchUpPrefs(extra = {}) {
    return { selectedView: 'eng', selectedSprint: activeSprintId, sprintName: activeSprintName, activeGroupId: 'group-alpha', showPlanning: false, showStats: false, showScenario: false, ...extra };
}

function trackTrigger(page, epicKey) {
    return page.locator(`button.epic-track-indicator[data-project-track-transition-trigger="true"][data-issue-key="${epicKey}"]`);
}

function trackMenu(page, epicKey) {
    return page.locator(`.project-track-transition-menu[data-issue-key="${epicKey}"]`);
}

function projectTrackOptionsCalls(calls) {
    return calls.filter(call => call.method === 'GET' && call.pathname === '/api/issues/project-track/options');
}

function projectTrackWriteCalls(calls) {
    return calls.filter(call => call.method === 'POST' && call.pathname === '/api/issues/project-track');
}

function taskListCalls(calls) {
    return calls.filter(call => call.pathname === '/api/tasks-with-team-name');
}

test('epic headers render 🔒 for Committed, 🤷 for Flexible, and ⚪ for unidentified tracks', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();

    const committedTrigger = trackTrigger(page, 'COMMIT-1');
    await expect(committedTrigger).toHaveText('🔒');
    await expect(committedTrigger).toHaveAttribute('aria-label', 'Project Track: Committed. Change Project Track');

    const flexibleTrigger = trackTrigger(page, 'FLEX-1');
    await expect(flexibleTrigger).toHaveText('🤷');
    await expect(flexibleTrigger).toHaveAttribute('aria-label', 'Project Track: Flexible. Change Project Track');

    const unidentifiedTrigger = trackTrigger(page, 'UNKNOWN-1');
    await expect(unidentifiedTrigger).toHaveText('⚪');
    await expect(unidentifiedTrigger).toHaveAttribute('aria-label', 'Project Track: Unidentified. Change Project Track');
});

test('track indicator is a native button with menu semantics on Catch Up and options load only on open', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();
    await page.addStyleTag({ content: projectTrackMenuCss });

    const trigger = trackTrigger(page, 'FLEX-1');
    await expect(trigger).toHaveCount(1);
    expect(await trigger.evaluate(el => el.tagName)).toBe('BUTTON');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    expect(projectTrackOptionsCalls(calls)).toHaveLength(0);

    await trigger.click();
    const menu = trackMenu(page, 'FLEX-1');
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => projectTrackOptionsCalls(calls).length).toBe(1);
    expect(projectTrackOptionsCalls(calls)[0].params.issueKey).toBe('FLEX-1');

    const firstOption = menu.locator('.project-track-transition-option').first();
    await expect(firstOption).toBeFocused();

    await trigger.click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('selecting the alternative track updates the header emoji and resorts track-sorted epics immediately', async ({ page }) => {
    // Seed the ENG epic sort mode to "Committed first" (track-committed). FLEX-1 starts
    // after COMMIT-1 in default fixture order and ranks after it under this sort too, until
    // it is flipped to Committed, at which point both are rank-0 and stay in original
    // (stable-sort) order — so flip UNKNOWN-1 (currently unidentified, rank 2, last) to
    // Committed instead: it must jump ahead of the still-Flexible FLEX-1 (rank 1).
    await setPrefs(page, catchUpPrefs({ engEpicSort: 'track-committed' }));
    const { calls } = await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();

    const keysBefore = await page.locator('.task-list .epic-block .epic-key').allInnerTexts();
    const iFlexBefore = keysBefore.findIndex(k => k.includes('FLEX-1'));
    const iUnknownBefore = keysBefore.findIndex(k => k.includes('UNKNOWN-1'));
    expect(iFlexBefore).toBeGreaterThanOrEqual(0);
    expect(iUnknownBefore).toBeGreaterThan(iFlexBefore);

    const initialTaskRequests = taskListCalls(calls).length;

    await trackTrigger(page, 'UNKNOWN-1').click();
    const menu = trackMenu(page, 'UNKNOWN-1');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Committed' }).click();

    await expect.poll(() => projectTrackWriteCalls(calls).length).toBe(1);
    await expect(trackTrigger(page, 'UNKNOWN-1')).toHaveText('🔒');

    const keysAfter = await page.locator('.task-list .epic-block .epic-key').allInnerTexts();
    const iFlexAfter = keysAfter.findIndex(k => k.includes('FLEX-1'));
    const iUnknownAfter = keysAfter.findIndex(k => k.includes('UNKNOWN-1'));
    expect(iUnknownAfter).toBeLessThan(iFlexAfter);

    // A single-Epic Project Track change patches local state only; it must not trigger any
    // task-list refetch.
    expect(taskListCalls(calls)).toHaveLength(initialTaskRequests);
});

test('current recognized track is omitted from the menu; unidentified shows both options', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();

    await trackTrigger(page, 'COMMIT-1').click();
    const committedMenu = trackMenu(page, 'COMMIT-1');
    await expect(committedMenu).toBeVisible();
    const committedLabels = await committedMenu.locator('.project-track-transition-option-label').allTextContents();
    expect(committedLabels).toEqual(['Flexible']);

    await page.keyboard.press('Escape');
    await expect(committedMenu).toHaveCount(0);

    await trackTrigger(page, 'UNKNOWN-1').click();
    const unknownMenu = trackMenu(page, 'UNKNOWN-1');
    await expect(unknownMenu).toBeVisible();
    const unknownLabels = await unknownMenu.locator('.project-track-transition-option-label').allTextContents();
    expect(unknownLabels.sort()).toEqual(['Committed', 'Flexible']);
});

test('failed write rolls back the emoji and keeps a retryable error in the open menu', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls, writeState } = await installEngProjectTrackFixture(page, {
        projectTrackDelayMs: 300,
        projectTrackWriteStatus: 502,
    });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();

    const trigger = trackTrigger(page, 'FLEX-1');
    await expect(trigger).toHaveText('🤷');
    await trigger.click();
    const menu = trackMenu(page, 'FLEX-1');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Committed' }).click();

    // Optimistic update applies immediately, before the write resolves.
    await expect.poll(() => writeState.inFlight).toBe(1);
    await expect(trigger).toHaveText('🔒');

    // The 502 rolls the emoji back and surfaces a retryable error in the still-open menu.
    await expect.poll(() => writeState.inFlight).toBe(0);
    await expect(trigger).toHaveText('🤷');
    await expect(menu.locator('.project-track-transition-menu-error')).toBeVisible();
    expect(projectTrackWriteCalls(calls)).toHaveLength(1);
});

test('Escape and outside pointer press dismiss the menu', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();
    await page.addStyleTag({ content: projectTrackMenuCss });

    const trigger = trackTrigger(page, 'FLEX-1');
    const menu = trackMenu(page, 'FLEX-1');

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.locator('.subtitle-secondary').click();
    await expect(menu).toHaveCount(0);
});

test('NO_EPIC group renders no track indicator and no write control', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="LOOSE-1"]')).toBeVisible();

    const noEpicBlock = page.locator('.epic-block', { hasText: 'Unassigned' });
    await expect(noEpicBlock).toHaveCount(1);
    await expect(noEpicBlock.locator('[data-project-track-transition-trigger]')).toHaveCount(0);
    await expect(noEpicBlock.locator('.epic-track-indicator')).toHaveCount(0);
});

test('menu options are clickable above sibling cards', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();
    await page.addStyleTag({ content: projectTrackMenuCss });

    // COMMIT-1 is not the last epic header on the page (FLEX-1 and UNKNOWN-1 follow it in
    // default priority-sort order); a normal (non-forced) click on its option proves the
    // .task-item:has(.project-track-transition-menu) z-index lift actually works.
    const keys = await page.locator('.task-list .epic-block .epic-key').allInnerTexts();
    const iCommit = keys.findIndex(k => k.includes('COMMIT-1'));
    expect(iCommit).toBeLessThan(keys.length - 1);

    await trackTrigger(page, 'COMMIT-1').click();
    const menu = trackMenu(page, 'COMMIT-1');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Flexible' }).click();

    await expect.poll(() => projectTrackWriteCalls(calls).length).toBe(1);
    await expect(trackTrigger(page, 'COMMIT-1')).toHaveText('🤷');
});

test('Statistics, Scenario, and Settings-open ENG surfaces never call Project Track APIs and render no interactive trigger', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    const { calls } = await installEngProjectTrackFixture(page);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();
    await expect(page.locator('[data-project-track-transition-trigger]')).toHaveCount(3);

    const modeControl = page.locator('.view-selector .eng-mode-control');
    await modeControl.getByRole('radio', { name: 'Statistics' }).click();
    await expect(page.locator('[data-project-track-transition-trigger]')).toHaveCount(0);

    await modeControl.getByRole('radio', { name: 'Scenario' }).click();
    await expect(page.locator('[data-project-track-transition-trigger]')).toHaveCount(0);

    await modeControl.getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.locator('[data-project-track-transition-trigger]')).toHaveCount(3);

    // Settings is a modal overlay: the indicator falls back to its passive span while open,
    // but the emoji is still visibly rendered (not removed).
    await page.getByRole('button', { name: /manage team groups/i }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await expect(page.locator('[data-project-track-transition-trigger]')).toHaveCount(0);
    await expect(page.locator('.epic-track-indicator').first()).toBeVisible();

    expect(calls.filter(c => c.pathname.startsWith('/api/issues/project-track'))).toHaveLength(0);
});

test('EPM project boards render no interactive Project Track trigger and never call the Project Track API', async ({ page }) => {
    await setPrefs(page, { selectedView: 'epm', epmTab: 'active', epmSelectedProjectId: '', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42' });
    const { calls } = await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        allProjectsRollup: (project) => ({
            projects: [{
                project,
                rollup: {
                    metadataOnly: false,
                    emptyRollup: false,
                    truncated: false,
                    truncatedQueries: [],
                    initiatives: {},
                    rootEpics: {
                        'EPM-EPIC': {
                            issue: { key: 'EPM-EPIC', summary: 'EPM epic', status: 'In Progress', issueType: 'Epic', storyPoints: 5, priority: 'High' },
                            stories: [{ key: 'EPM-1', summary: 'EPM story', status: 'To Do', issueType: 'Story', storyPoints: 2, priority: 'Medium' }],
                        },
                    },
                    orphanStories: [],
                },
            }],
            duplicates: {},
            truncated: false,
            fallback: false,
        }),
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.epm-project-board')).toHaveCount(1);
    await expect(page.locator('.task-item[data-task-key="EPM-1"]')).toHaveCount(1);
    await expect(page.locator('[data-project-track-transition-trigger]')).toHaveCount(0);
    expect(calls.filter(c => c.pathname.startsWith('/api/issues/project-track'))).toHaveLength(0);
});

test('visual verification: track indicators and menu at desktop and narrow widths', async ({ page }) => {
    await setPrefs(page, catchUpPrefs());
    await installEngProjectTrackFixture(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="COMMIT-2"]')).toBeVisible();
    await page.addStyleTag({ content: projectTrackMenuCss });
    // Settle any task-appear/entry animations before capturing element screenshots.
    await page.evaluate(() => document.querySelectorAll('*').forEach((el) => {
        el.style.animation = 'none';
        el.style.transition = 'none';
    }));

    await trackTrigger(page, 'COMMIT-1').screenshot({ path: path.join(screenshotDir, 'indicator-committed.png') });
    await trackTrigger(page, 'FLEX-1').screenshot({ path: path.join(screenshotDir, 'indicator-flexible.png') });
    await trackTrigger(page, 'UNKNOWN-1').screenshot({ path: path.join(screenshotDir, 'indicator-unidentified.png') });

    // The menu is position:absolute and overflows outside the small inline-flex trigger
    // wrapper's own box, so an element-level screenshot of the wrapper would clip it off.
    // Capture a page-level screenshot clipped to the union of the trigger + menu boxes instead.
    const captureTriggerAndMenu = async (filename) => {
        const trigger = trackTrigger(page, 'FLEX-1');
        const menu = trackMenu(page, 'FLEX-1');
        const [triggerBox, menuBox] = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);
        const x = Math.min(triggerBox.x, menuBox.x) - 8;
        const y = Math.min(triggerBox.y, menuBox.y) - 8;
        const right = Math.max(triggerBox.x + triggerBox.width, menuBox.x + menuBox.width) + 8;
        const bottom = Math.max(triggerBox.y + triggerBox.height, menuBox.y + menuBox.height) + 8;
        await page.screenshot({
            path: path.join(screenshotDir, filename),
            clip: { x, y, width: right - x, height: bottom - y },
        });
    };

    await trackTrigger(page, 'FLEX-1').click();
    const desktopMenu = trackMenu(page, 'FLEX-1');
    await expect(desktopMenu).toBeVisible();
    await captureTriggerAndMenu('menu-open-desktop-1280.png');
    await page.keyboard.press('Escape');
    await expect(desktopMenu).toHaveCount(0);

    await page.setViewportSize({ width: 760, height: 900 });
    await trackTrigger(page, 'FLEX-1').click();
    const narrowMenu = trackMenu(page, 'FLEX-1');
    await expect(narrowMenu).toBeVisible();
    await captureTriggerAndMenu('menu-open-narrow-760.png');
});
