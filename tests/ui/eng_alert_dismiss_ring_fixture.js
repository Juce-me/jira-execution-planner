// Route-mocked dashboard for the alert dismiss-ring spec. Synthetic keys only (RING-*).
// An active Sprint yields seven alert categories; a future Sprint yields Backlog, Missing team and
// Missing labels, so the ten categories need two loads.
const { expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const sprintId = 34625;
const sprintName = '2026Q2 Sprint 42';

const CATEGORIES = [
    { sectionId: 'eng-alert-missing', label: 'Missing info', sprint: 'active' },
    { sectionId: 'eng-alert-blocked', label: 'Blocked', sprint: 'active' },
    { sectionId: 'eng-alert-followup', label: 'Postponed', sprint: 'active' },
    { sectionId: 'eng-alert-needs-stories', label: 'Stories required', sprint: 'active' },
    { sectionId: 'eng-alert-waiting', label: 'Waiting', sprint: 'active' },
    { sectionId: 'eng-alert-empty', label: 'Empty epic', sprint: 'active' },
    { sectionId: 'eng-alert-done', label: 'Ready to close', sprint: 'active' },
    { sectionId: 'eng-alert-backlog', label: 'Backlog', sprint: 'future' },
    { sectionId: 'eng-alert-missing-team', label: 'Missing team', sprint: 'future' },
    { sectionId: 'eng-alert-missing-labels', label: 'Missing labels', sprint: 'future' },
];

function story(key, status, summary, { epicKey = 'RING-EPIC', storyPoints = 3, sprintState = 'active', fields = {} } = {}) {
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
            projectKey: 'RING',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
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
        projectKey: 'RING',
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

function readinessEpic(key, summary) {
    return {
        key,
        summary,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'RING',
        projectClass: 'product',
        projectTrack: 'product',
        initiative: null,
        missingTeams: [{ id: 'team-alpha', name: 'Alpha Team', reason: 'no_stories' }],
    };
}

function createState(sprintState) {
    const future = sprintState === 'future';
    const tasks = future
        ? [story('RING-F1', 'To Do', 'Future sprint planned story', { sprintState })]
        : [
            story('RING-1', 'To Do', 'Story without an estimate', { storyPoints: null }),
            story('RING-3', 'Blocked', 'Blocked synthetic story'),
            story('RING-5', 'Postponed', 'Postponed synthetic story'),
            story('RING-D1-S', 'Done', 'Finished story under ready epic', { epicKey: 'RING-D1' }),
            story('RING-W1-S', 'Done', 'Finished story under waiting epic', { epicKey: 'RING-W1' }),
            ...Array.from({ length: 24 }, (_, index) => story(`RING-F${index + 10}`, 'To Do', `Filler planned story ${index + 1}`)),
        ];
    return {
        sprintState,
        tasks,
        epics: {
            'RING-EPIC': epic('RING-EPIC', 'Primary delivery epic'),
            'RING-D1': epic('RING-D1', 'Ready to close epic'),
            'RING-W1': epic('RING-W1', 'Waiting epic', { status: 'Analysis' }),
        },
        alertEpics: future
            ? [
                planningEpic('RING-T1', 'Missing team epic', [`${sprintName}_candidate`, 'Beta Team'], { teamId: '', teamName: '' }),
                planningEpic('RING-L1', 'Missing labels epic', [`${sprintName}_candidate`]),
            ]
            : [epic('RING-E1', 'Empty epic', { status: 'Analysis', ...emptyCounts })],
        backlogEpics: future ? [planningEpic('RING-B1', 'Backlog epic', [`${sprintName}_candidate_extra`, 'Beta Team'])] : [],
        readinessEpics: future ? [] : [readinessEpic('RING-R1', 'Stories required epic')],
        readyEpics: future ? [] : ['RING-D1', 'RING-W1'],
    };
}

async function installRingFixture(page, sprintState) {
    const state = createState(sprintState);
    await installDashboardShell(page);
    await page.addInitScript((seed) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(seed));
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
    });
    await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
        {
            if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
            if (url.pathname === '/api/auth/status') return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
            if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
            if (url.pathname === '/api/analytics/context') return json({ enabled: false });
            if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
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
                groups: [{ id: 'grp-default', name: 'Default', teamIds: ['team-alpha', 'team-beta'], teamLabels: { 'team-alpha': 'Alpha Team', 'team-beta': 'Beta Team' } }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
            if (url.pathname === '/api/projects/selected') return json({ selected: [] });
            if (url.pathname === '/api/sprints') return json({ sprints: [{ id: sprintId, name: sprintName, state: state.sprintState }] });
            if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
            if (url.pathname === '/api/eng/story-readiness') {
                return json({
                    schemaVersion: 1,
                    complete: true,
                    scope: { groupId: 'grp-default', sprintId: String(sprintId), sprintName, sprintState: state.sprintState },
                    epics: state.readinessEpics,
                });
            }
            if (url.pathname === '/api/tasks-with-team-name') {
                const purpose = url.searchParams.get('purpose') || '';
                const empty = { issues: [], epics: {}, epicsInScope: [], names: {} };
                if (url.searchParams.get('project') !== 'product') return json(empty);
                if (purpose === 'alerts') return json({ issues: state.tasks, epics: state.epics, epicsInScope: [...(state.sprintState === 'future' ? [] : Object.values(state.epics)), ...state.alertEpics], names: {} });
                if (purpose === 'ready-to-close') {
                    const ready = state.readyEpics.map(key => ({ ...state.epics[key], openChildCount: 0 }));
                    return json({ issues: state.tasks.filter(task => state.readyEpics.includes(task.fields.epicKey)), epics: Object.fromEntries(ready.map(value => [value.key, value])), epicsInScope: ready, names: {} });
                }
                if (purpose) return json(empty);
                return json({ issues: state.tasks, epics: state.epics, epicsInScope: Object.values(state.epics), names: {} });
            }
            if (url.pathname === '/api/missing-info') {
                const issues = state.tasks
                    .filter(task => task.fields.customfield_10004 == null && !['Done', 'Postponed'].includes(task.fields.status.name))
                    .map(task => ({ ...task, fields: { ...task.fields, missingFields: ['Story Points'] } }));
                return json({ issues, epics: [], count: issues.length, epicCount: 0 });
            }
            if (url.pathname === '/api/backlog-epics') return json({ epics: url.searchParams.get('project') === 'product' ? state.backlogEpics : [] });
            if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
            if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
            return json({});
        }
    });
    return state;
}

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
        await frame();
    });
}

async function openRingDashboard(page, sprintState, viewport) {
    await page.setViewportSize(viewport);
    const state = await installRingFixture(page, sprintState);
    await page.goto(`${appBaseUrl}/`);
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    await expect(page.locator(`#${CATEGORIES.find(category => category.sprint === sprintState).sectionId} .alert-remove`).first()).toBeVisible();
    await settle(page);
    return state;
}

// Splits a computed box-shadow into layers, ignoring commas inside colour functions.
function shadowLayers(value) {
    const layers = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] === '(') depth += 1;
        else if (value[i] === ')') depth -= 1;
        else if (value[i] === ',' && depth === 0) { layers.push(value.slice(start, i)); start = i + 1; }
    }
    layers.push(value.slice(start));
    return layers.map(layer => layer.trim()).filter(Boolean);
}

// How far the painted outer shadow reaches right of the box: x offset + spread of every non-inset layer.
function ringReach(boxShadow) {
    const reaches = shadowLayers(boxShadow).filter(layer => !/\binset\b/.test(layer)).map((layer) => {
        const lengths = layer.replace(/[a-z-]+\([^)]*\)|#[0-9a-f]+/gi, ' ').trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
        const [x = 0, , , spread = 0] = lengths;
        return x + spread;
    });
    return Math.max(0, ...reaches);
}

module.exports = { CATEGORIES, openRingDashboard, ringReach, settle };
