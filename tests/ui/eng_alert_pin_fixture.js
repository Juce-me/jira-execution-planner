// Route-mocked dashboard for the pinned alert specs (#209). Synthetic keys only (PIN-*).
// The active Sprint yields seven categories (Missing info, Blocked, Follow up, Stories required,
// Waiting, Empty epic, Ready to close); the future Sprint yields Backlog, Missing team and Missing
// labels (those three exist only for a future Sprint, Empty and Waiting only for a current one).
const { expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const sprintId = 34625;
const sprintName = '2026Q2 Sprint 42';
const otherSprint = { id: 34626, name: '2026Q2 Sprint 43', state: 'active' };
const longSummary = 'A deliberately long synthetic blocked story summary that must stay on one line and end in an ellipsis inside the pinned row at every width';

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
}

function story(key, status, summary, { epicKey = 'PIN-EPIC', storyPoints = 3, sprintState = 'active', teamId = 'team-alpha', fields = {} } = {}) {
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: 'High' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Synthetic Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: storyPoints,
            epicKey,
            parentSummary: `${epicKey} summary`,
            projectKey: 'PIN',
            teamId,
            teamName: teamId === 'team-beta' ? 'Beta Team' : 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: sprintState }],
            ...fields,
        },
    };
}

function epic(key, summary, { status = 'In Progress', sprintState = 'active', ...overrides } = {}) {
    return {
        key,
        summary,
        status: { name: status },
        priority: { name: 'High' },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'PIN',
        projectClass: 'product',
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        sprint: [{ id: sprintId, name: sprintName, state: sprintState }],
        ...overrides,
    };
}

const emptyCounts = { totalStories: 0, selectedStories: 0, selectedActionableStories: 0, futureOpenStories: 0, storyStatusCounts: {} };

function planningEpic(key, summary, labels, overrides = {}) {
    return epic(key, summary, { teamId: 'team-beta', teamName: 'Beta Team', labels, sprint: null, fields: { customfield_10101: null }, ...overrides });
}

function readinessEpic(key, summary, teams = [['team-alpha', 'Alpha Team']]) {
    return {
        key,
        summary,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'PIN',
        projectClass: 'product',
        projectTrack: 'product',
        initiative: null,
        missingTeams: teams.map(([id, name]) => ({ id, name, reason: 'no_stories' })),
    };
}

// The ten categories, each with two alerts; `primary` is the first row of the category.
const CATEGORIES = [
    { sectionId: 'eng-alert-missing', label: 'Missing info', sprint: 'active', keys: ['PIN-1', 'PIN-2'] },
    { sectionId: 'eng-alert-blocked', label: 'Blocked', sprint: 'active', keys: ['PIN-3', 'PIN-4'] },
    { sectionId: 'eng-alert-followup', label: 'Postponed', sprint: 'active', keys: ['PIN-5', 'PIN-6', 'PIN-FR1'] },
    { sectionId: 'eng-alert-needs-stories', label: 'Stories required', sprint: 'active', keys: ['PIN-R1', 'PIN-R2'] },
    { sectionId: 'eng-alert-waiting', label: 'Waiting', sprint: 'active', keys: ['PIN-W1', 'PIN-W2'] },
    { sectionId: 'eng-alert-empty', label: 'Empty epic', sprint: 'active', keys: ['PIN-E1', 'PIN-E2'] },
    { sectionId: 'eng-alert-done', label: 'Ready to close', sprint: 'active', keys: ['PIN-D1', 'PIN-D2'] },
    { sectionId: 'eng-alert-backlog', label: 'Backlog', sprint: 'future', keys: ['PIN-B1', 'PIN-B2'] },
    { sectionId: 'eng-alert-missing-team', label: 'Missing team', sprint: 'future', keys: ['PIN-T1', 'PIN-T2'] },
    { sectionId: 'eng-alert-missing-labels', label: 'Missing labels', sprint: 'future', keys: ['PIN-L1', 'PIN-L2'] },
];

// Mutable server state: a Story Points write through the real edit route changes what later reads return.
function createServerState({ sprintState = 'active', bulkAlerts = 0, dualKey = false, blockedKeys = null, longSummaries = false } = {}) {
    const future = sprintState === 'future';
    // `longSummaries` gives one alert per pin tone (missing, following, done) the long summary PIN-3 (blocked) always has.
    const long = (summary) => (longSummaries ? `${summary}: ${longSummary}` : summary);
    const storyPoints = new Map([['PIN-1', null]]);
    const primary = future
        ? [story('PIN-F1', 'To Do', 'Future sprint planned story', { sprintState })]
        : [
            story('PIN-1', 'To Do', long('Story without an estimate'), { storyPoints: null }),
            story('PIN-2', 'To Do', 'Story missing its priority'),
            story('PIN-3', 'Blocked', longSummary),
            story('PIN-4', 'Blocked', 'Second blocked story', dualKey ? { storyPoints: null } : {}),
            story('PIN-5', 'Postponed', 'Postponed story one'),
            story('PIN-6', 'Postponed', 'Postponed story two'),
            story('PIN-D1-S', 'Done', 'Finished story under ready epic one', { epicKey: 'PIN-D1' }),
            story('PIN-D2-S', 'Done', 'Finished story under ready epic two', { epicKey: 'PIN-D2' }),
            story('PIN-W1-S', 'Done', 'Finished story under waiting epic one', { epicKey: 'PIN-W1' }),
            story('PIN-W2-S', 'Done', 'Finished story under waiting epic two', { epicKey: 'PIN-W2' }),
            story('PIN-8', 'To Do', 'Planned story with initiative', { epicKey: 'PIN-EPIC2' }),
            // An In Progress Story makes In Progress a Status option, so a Done-hiding filter still admits In Progress Epics.
            story('PIN-9', 'In Progress', 'Story already in progress', { epicKey: 'PIN-EPIC2' }),
            ...Array.from({ length: bulkAlerts }, (_, index) => story(`PIN-X${index + 1}`, 'Blocked', `Bulk blocked story ${index + 1}`)),
        ];
    const keepBlocked = blockedKeys ? new Set(blockedKeys) : null;
    const filteredPrimary = keepBlocked
        ? primary.filter(task => task.fields.status.name !== 'Blocked' || keepBlocked.has(task.key))
        : primary;
    const fillerStories = future ? [] : Array.from({ length: 24 }, (_, index) => story(`PIN-F${index + 10}`, 'To Do', `Filler planned story ${index + 1}`, { epicKey: index % 2 ? 'PIN-EPIC' : 'PIN-EPIC2' }));
    return {
        sprintState,
        storyPoints,
        tasks: [...filteredPrimary, ...fillerStories],
        epics: {
            'PIN-EPIC': epic('PIN-EPIC', 'Primary delivery epic', { initiative: { key: 'PIN-INIT', summary: 'Synthetic initiative' } }),
            'PIN-EPIC2': epic('PIN-EPIC2', 'Second delivery epic', { initiative: { key: 'PIN-INIT', summary: 'Synthetic initiative' } }),
            'PIN-D1': epic('PIN-D1', long('Ready to close epic one')),
            'PIN-D2': epic('PIN-D2', 'Ready to close epic two'),
            'PIN-W1': epic('PIN-W1', long('Waiting epic one'), { status: 'Analysis' }),
            'PIN-W2': epic('PIN-W2', 'Waiting epic two', { status: 'Analysis' }),
        },
        alertEpics: future
            ? [
                planningEpic('PIN-T1', 'Missing team epic one', [`${sprintName}_candidate`, 'Beta Team'], { teamId: '', teamName: '' }),
                planningEpic('PIN-T2', 'Missing team epic two', [`${sprintName}_candidate`, 'Beta Team'], { teamId: '', teamName: '' }),
                planningEpic('PIN-L1', 'Missing labels epic one', [`${sprintName}_candidate`]),
                planningEpic('PIN-L2', 'Missing labels epic two', [`${sprintName}_candidate`]),
            ]
            : [
                epic('PIN-E1', 'Empty epic one', { status: 'Analysis', ...emptyCounts }),
                epic('PIN-E2', 'Empty epic two', { status: 'Analysis', ...emptyCounts }),
                epic('PIN-FR1', 'Future routed epic', { status: 'Analysis', ...emptyCounts, futureOpenStories: 2 }),
            ],
        backlogEpics: future
            ? [
                planningEpic('PIN-B1', 'Backlog epic one', [`${sprintName}_candidate_extra`, 'Beta Team']),
                planningEpic('PIN-B2', 'Backlog epic two', [`${sprintName}_candidate_extra`, 'Beta Team']),
            ]
            : [],
        readinessEpics: future ? [] : [readinessEpic('PIN-R1', 'Stories required epic one', [['team-alpha', 'Alpha Team'], ['team-beta', 'Beta Team']]), readinessEpic('PIN-R2', 'Stories required epic two')],
        readyEpics: future ? [] : ['PIN-D1', 'PIN-D2', 'PIN-W1', 'PIN-W2'],
    };
}

// Jira gains one more Ready to close Epic (an In Progress Epic whose only Story is Done).
function addReadyEpic(state, key, summary) {
    state.epics[key] = epic(key, summary);
    state.readyEpics.push(key);
    state.tasks.push(story(`${key}-S`, 'Done', `Finished story under ${summary}`, { epicKey: key }));
}

function currentTasks(state) {
    return state.tasks.map(task => (state.storyPoints.has(task.key)
        ? { ...task, fields: { ...task.fields, customfield_10004: state.storyPoints.get(task.key) } }
        : task));
}

function missingInfoIssues(state) {
    return currentTasks(state).flatMap((task) => {
        if (task.key === 'PIN-2') return [{ ...task, fields: { ...task.fields, missingFields: ['Priority'] } }];
        if (task.fields.customfield_10004 == null && !['Done', 'Postponed'].includes(task.fields.status.name)) {
            return [{ ...task, fields: { ...task.fields, missingFields: ['Story Points'] } }];
        }
        return [];
    });
}

async function installPinFixture(page, {
    sprintState = 'active',
    viewport = { width: 1280, height: 800 },
    prefs = {},
    bulkAlerts = 0,
    dualKey = false,
    blockedKeys = null,
    longSummaries = false,
    analyticsEnabled = false,
    alertGate = null,
} = {}) {
    const state = createServerState({ sprintState, bulkAlerts, dualKey, blockedKeys, longSummaries });
    state.alertGate = alertGate;
    const calls = [];
    await page.setViewportSize(viewport);
    await installDashboardShell(page);
    await page.context().route('https://jira.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>jira</title>' }));
    await page.addInitScript((seed) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(seed));
        window.__opened = [];
        window.open = (url) => { window.__opened.push(String(url)); return null; };
    }, {
        selectedView: 'eng',
        planningLayout: 'list',
        selectedSprint: sprintId,
        sprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showPlanning: false,
        showStats: false,
        showScenario: false,
        showBoard: false,
        showAlertsPanel: true,
        groupByInitiativeChoice: false,
        ...prefs,
    });
    // Mocked API requests still being answered (a gated alert source counts until it is released).
    state.inflight = 0;
    const handle = async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const body = request.method() === 'POST' ? request.postDataJSON() : null;
        const call = { method: request.method(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()), body };
        calls.push(call);
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        const requestedSprint = url.searchParams.get('sprint');
        const otherSprintRequested = requestedSprint === String(otherSprint.id);
        const groupId = url.searchParams.get('groupId') || 'grp-default';
        const isAlertSource = url.pathname === '/api/missing-info' || url.pathname === '/api/backlog-epics'
            || (url.pathname === '/api/tasks-with-team-name' && url.searchParams.get('purpose'));
        if (isAlertSource && state.alertGate) await state.alertGate.promise;

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/analytics/context') return json({ enabled: analyticsEnabled });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        const fieldMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/(editable-fields|field)$/);
        if (fieldMatch && fieldMatch[2] === 'editable-fields') {
            return json({ issueKey: fieldMatch[1], field: 'storyPoints', editable: true, currentValue: state.storyPoints.get(fieldMatch[1]) ?? 3, baseUpdated: '2026-05-01T00:00:00.000+0000', mappingRevision: 'synthetic-story-points', me: null });
        }
        if (fieldMatch && request.method() === 'POST') {
            state.storyPoints.set(fieldMatch[1], body?.value ?? null);
            return json({ result: 'success', value: body?.value, mappingRevision: 'synthetic-story-points' });
        }
        if (url.pathname === '/api/issues/transitions/options') {
            const issueKeys = body?.issueKeys || [];
            return json({
                issues: issueKeys.map(key => ({ key, issueType: 'Story', currentStatus: 'To Do', transitions: [{ name: 'Start Progress', toStatus: 'In Progress' }] })),
                targetStatuses: [{ name: 'In Progress', availableCount: issueKeys.length, blockedCount: 0 }],
            });
        }
        if (url.pathname === '/api/issues/transitions') {
            const issueKeys = body?.issueKeys || [];
            return json({
                requested: issueKeys.length, succeeded: issueKeys.length, failed: 0, targetStatus: body?.targetStatus || 'In Progress',
                results: issueKeys.map(key => ({ key, result: 'success', fromStatus: 'To Do', toStatus: body?.targetStatus || 'In Progress' })),
            });
        }
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example',
            authMode: 'atlassian_oauth',
            capacityProject: '',
            groupQueryTemplateEnabled: false,
            settingsAdminOnly: false,
            userCanEditSettings: true,
            projectsConfigured: true,
            epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
        });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json({
            version: 1,
            groups: [
                { id: 'grp-default', name: 'Default', teamIds: ['team-alpha', 'team-beta'], teamLabels: { 'team-alpha': 'Alpha Team', 'team-beta': 'Beta Team' } },
                { id: 'grp-second', name: 'Second', teamIds: ['team-alpha'], teamLabels: { 'team-alpha': 'Alpha Team' } },
            ],
            defaultGroupId: 'grp-default',
            source: 'test',
        });
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: sprintId, name: sprintName, state: state.sprintState }, otherSprint] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/eng/story-readiness') {
            const selected = otherSprintRequested ? otherSprint : { id: sprintId, name: sprintName, state: state.sprintState };
            return json({
                schemaVersion: 1,
                complete: true,
                scope: { groupId, sprintId: String(selected.id), sprintName: selected.name, sprintState: selected.state },
                epics: otherSprintRequested || groupId !== 'grp-default' ? [] : state.readinessEpics,
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose') || '';
            const empty = { issues: [], epics: {}, epicsInScope: [], names: {} };
            if (project !== 'product' || otherSprintRequested || groupId !== 'grp-default') return json(empty);
            const tasks = currentTasks(state);
            if (purpose === 'alerts') return json({ issues: tasks, epics: state.epics, epicsInScope: [...(state.sprintState === 'future' ? [] : Object.values(state.epics)), ...state.alertEpics], names: {} });
            if (purpose === 'ready-to-close') {
                const ready = state.readyEpics.map(key => ({ ...state.epics[key], openChildCount: 0 }));
                return json({ issues: tasks.filter(task => state.readyEpics.includes(task.fields.epicKey)), epics: Object.fromEntries(ready.map(value => [value.key, value])), epicsInScope: ready, names: {} });
            }
            if (purpose) return json(empty);
            return json({ issues: tasks, epics: state.epics, epicsInScope: Object.values(state.epics), names: {} });
        }
        if (url.pathname === '/api/missing-info') {
            const issues = otherSprintRequested || groupId !== 'grp-default' ? [] : missingInfoIssues(state);
            return json({ issues, epics: [], count: issues.length, epicCount: 0 });
        }
        if (url.pathname === '/api/backlog-epics') return json({ epics: url.searchParams.get('project') === 'product' && !otherSprintRequested ? state.backlogEpics : [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    };
    await page.route('**/api/**', async (route) => {
        state.inflight += 1;
        try { await handle(route); } finally { state.inflight -= 1; }
    });
    return { state, calls };
}

// Animations settle, two frames pass, and window scrolling has stopped for several frames.
async function settle(page) {
    await page.evaluate(async () => {
        const frame = () => new Promise(requestAnimationFrame);
        await frame();
        await frame();
        const animations = document.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming?.().iterations !== Infinity);
        if (animations.length) {
            await Promise.race([
                Promise.all(animations.map(animation => animation.finished.catch(() => undefined))),
                new Promise(resolve => window.setTimeout(resolve, 1500)),
            ]);
        }
        let last = window.scrollY;
        let still = 0;
        const deadline = performance.now() + 3000;
        while (still < 6 && performance.now() < deadline) {
            await frame();
            if (window.scrollY === last) still += 1;
            else { still = 0; last = window.scrollY; }
        }
    });
}

// Every mocked API request the page has started is answered, then the page settles (renders, animations, scrolling).
async function apiIdle(page, state) {
    await settle(page);
    await expect.poll(() => state.inflight).toBe(0);
    await settle(page);
    await expect.poll(() => state.inflight).toBe(0);
}

async function openPinDashboard(page, options = {}) {
    const fixture = await installPinFixture(page, options);
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    await settle(page);
    return fixture;
}

module.exports = {
    CATEGORIES,
    addReadyEpic,
    apiIdle,
    appBaseUrl,
    deferred,
    installPinFixture,
    longSummary,
    openPinDashboard,
    otherSprint,
    settle,
    sprintId,
    sprintName,
};
