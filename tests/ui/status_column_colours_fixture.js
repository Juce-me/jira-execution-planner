// Synthetic ENG fixture for the Board column status colours (#244). Built on the shared dashboard shell
// and the EPM fixture routes: this module registers its own `/api/**` handler after them (the last
// registered route wins) and falls back to the shared routes for everything it does not own.
const path = require('node:path');
const esbuild = require('esbuild');
const { expect } = require('@playwright/test');
const { installDashboardFixture, activeHomeTokenConnection } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const GROUP_ID = 'group-alpha';
const UI_PREFS_KEY = 'jira_dashboard_ui_prefs_v1';

// Seven Jira statuses mapped one-to-one to the seven enum colours, in Board order (Done last).
// `In Review` has no built-in palette class and shares the blue column with `In Progress`, which
// makes that column a multi-status drop target. `Analysis` is held by no column, so its Epic lands in
// the first (starred, expanded) column by the Board placement rule.
const BOARD_COLUMNS = [
    { id: 'col-00000001', name: 'Open', colour: '#8c8c8c', star: true, min: null, max: null, statuses: ['To Do'] },
    { id: 'col-00000002', name: 'Accepted', colour: '#b37feb', star: false, min: null, max: null, statuses: ['Accepted'] },
    { id: 'col-00000003', name: 'Doing', colour: '#597ef7', star: false, min: null, max: null, statuses: ['In Progress', 'In Review'] },
    { id: 'col-00000004', name: 'Stuck', colour: '#13c2c2', star: false, min: null, max: null, statuses: ['Blocked'] },
    { id: 'col-00000005', name: 'Waiting', colour: '#e8a11d', star: false, min: null, max: null, statuses: ['Pending'] },
    { id: 'col-00000006', name: 'Shipping', colour: '#ff4d4f', star: false, min: null, max: null, statuses: ['Release'] },
    { id: 'col-00000007', name: 'Finished', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'] },
];
const STATUS_COLOUR = new Map(BOARD_COLUMNS.flatMap((column) => column.statuses.map((status) => [status, column.colour])));
const UNMAPPED_STATUSES = ['Analysis'];

function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return `rgb(${[0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).join(', ')})`;
}

// The inline style a mapped pill carries: the filter popover's tint with the primary text colour.
const tintInline = (hex) => `color-mix(in srgb, ${hex} 28%, var(--bg-secondary))`;

// Computed background and text colour of a probe element given the same declarations, so the browser
// resolves color-mix and the theme variables exactly as it does for a pill.
function tintFor(page, hex) {
    return page.evaluate((colour) => {
        const probe = document.createElement('span');
        probe.style.background = `color-mix(in srgb, ${colour} 28%, var(--bg-secondary))`;
        probe.style.color = 'var(--text-primary)';
        document.body.appendChild(probe);
        const style = getComputedStyle(probe);
        const result = { background: style.backgroundColor, color: style.color };
        probe.remove();
        return result;
    }, hex);
}

// [key, summary, status, initiative]
const EPIC_SPECS = [
    ['PLAT-1', 'Gateway rollout', 'In Progress', null],
    ['PLAT-2', 'Partner onboarding', 'In Review', { key: 'PLAT-100', summary: 'Partner execution layer' }],
    ['PLAT-3', 'Unmapped analysis epic', 'Analysis', null],
    ['PLAT-4', 'Open column epic', 'To Do', null],
];

// [key, epicKey, status, subtaskSummary?]
const STORY_SPECS = [
    ['PLAT-1-a', 'PLAT-1', 'To Do'],
    ['PLAT-1-b', 'PLAT-1', 'Accepted'],
    ['PLAT-1-c', 'PLAT-1', 'Blocked'],
    ['PLAT-2-a', 'PLAT-2', 'In Review'],
    ['PLAT-2-b', 'PLAT-2', 'Release'],
    ['PLAT-2-c', 'PLAT-2', 'Done'],
    ['PLAT-3-a', 'PLAT-3', 'Analysis'],
    ['PLAT-3-b', 'PLAT-3', 'Pending'],
    ['PLAT-3-c', 'PLAT-3', 'In Progress'],
    ['PLAT-4-a', 'PLAT-4', 'To Do'],
];
const SUBTASK_PARENT = 'PLAT-1-a';
const SUBTASK_SUMMARY = {
    total: 2, done: 0, inProgress: 1, waiting: 1, percentComplete: 0, statusCounts: { Analysis: 1, 'In Progress': 1 },
};

function epicPayload(sprintId, sprintName, state) {
    const epics = {};
    EPIC_SPECS.forEach(([key, summary, status, initiative]) => {
        epics[key] = {
            key, summary, status, priority: 'Major', assignee: { displayName: 'Epic Owner' }, deliveryOwner: null,
            projectTrack: null, updated: '2026-07-20T00:00:00.000+0000', teamId: 'team-alpha', teamName: 'Alpha Team',
            labels: ['alpha_label'], sprint: [{ id: sprintId, name: sprintName, state }],
            ...(initiative ? { initiative } : {}),
        };
    });
    return epics;
}

function storyPayload(sprintId, sprintName, state) {
    return STORY_SPECS.map(([key, epicKey, status]) => ({
        id: key,
        key,
        fields: {
            summary: `${key} story summary`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            updated: '2026-07-28T00:00:00.000+0000',
            customfield_10004: 2,
            epicKey,
            parentSummary: `${epicKey} summary`,
            projectKey: 'PLAT',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state }],
            ...(key === SUBTASK_PARENT ? { subtaskSummary: SUBTASK_SUMMARY } : {}),
        },
    }));
}

function subtaskPayload() {
    return {
        parentKey: SUBTASK_PARENT,
        sprint: String(activeSprintId),
        cached: false,
        summary: SUBTASK_SUMMARY,
        subtasks: [
            { id: 'S-A', key: `${SUBTASK_PARENT}-1`, summary: 'Unmapped subtask', status: { name: 'Analysis' }, assignee: { displayName: 'Sub Owner' }, updated: '2026-07-28T00:00:00.000+0000' },
            { id: 'S-B', key: `${SUBTASK_PARENT}-2`, summary: 'Mapped subtask', status: { name: 'In Progress' }, assignee: { displayName: 'Sub Owner' }, updated: '2026-07-28T00:00:00.000+0000' },
        ],
    };
}

const TARGET_STATUSES = ['To Do', 'Accepted', 'In Progress', 'In Review', 'Blocked', 'Pending', 'Release', 'Done', 'Analysis']
    .map((name) => ({ name, availableCount: 1, blockedCount: 0 }));

function epmRollup(project) {
    return {
        projects: [{
            project,
            rollup: {
                metadataOnly: false, emptyRollup: false, truncated: false, truncatedQueries: [], initiatives: {},
                rootEpics: {
                    'EPM-EPIC': {
                        issue: { key: 'EPM-EPIC', summary: 'EPM epic', status: 'In Progress', issueType: 'Epic', storyPoints: 5 },
                        stories: [{ key: 'EPM-1', summary: 'EPM story', status: 'To Do', issueType: 'Story', storyPoints: 2 }],
                    },
                },
                orphanStories: [],
            },
        }],
        duplicates: {}, truncated: false, fallback: false,
    };
}

let bundlePromise;
function dashboardBundle() {
    bundlePromise = bundlePromise || esbuild.build({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).then((result) => result.outputFiles[0].text);
    return bundlePromise;
}

function groupsPayload({ revision, flag, columns }) {
    const board = columns ? { columns, doneEpicRetentionDays: 28, ...(flag === true ? { inheritColumnColours: true } : {}) } : null;
    return {
        version: 1,
        configRevision: revision,
        source: 'workspace_db',
        defaultGroupId: GROUP_ID,
        groups: [{
            id: GROUP_ID, name: 'Alpha Department', teamIds: ['team-alpha'], teamLabels: {}, labels: ['alpha_label'],
            excludedCapacityEpics: [], ...(board ? { board } : {}),
        }],
        preferences: {
            onboardingRequired: false, onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            customized: false, visibleGroupIds: [], effectiveVisibleGroupIds: [GROUP_ID], activeGroupId: GROUP_ID,
        },
    };
}

// `flag` / `columns` seed the saved Department Board; `setFlag` and `setColumns` change what the next
// GET returns. POST persists (revision bump) so Save and reload can be asserted.
async function installStatusColourFixture(page, {
    authMode = 'atlassian_oauth', userCanEditSettings = true, settingsAdminOnly = false,
    flag = false, columns = BOARD_COLUMNS, prefs = {}, recordPosts = false,
} = {}) {
    const state = { flag, columns, revision: 1 };
    const requests = [];
    const posts = [];
    const base = await installDashboardFixture(page, {
        authMode, connection: activeHomeTokenConnection(), settingsAdminOnly, userCanEditSettings,
        allProjectsRollup: epmRollup,
    });
    const js = await dashboardBundle();
    await page.route('**/frontend/dist/dashboard.js', (route) => route.fulfill({
        status: 200, contentType: 'application/javascript', body: js,
    }));
    await page.addInitScript(({ key, value }) => {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(value));
    }, {
        key: UI_PREFS_KEY,
        value: {
            selectedView: 'eng', planningLayout: 'list', selectedSprint: activeSprintId, sprintName: activeSprintName,
            activeGroupId: GROUP_ID, showPlanning: false, showStats: false, showScenario: false, showBoard: false,
            showAlertsPanel: false, ...prefs,
        },
    });
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push(`${request.method()} ${url.pathname}${url.search}`);
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        const pathname = url.pathname;
        if (pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example', capacityProject: '', groupQueryTemplateEnabled: false, authMode,
                settingsAdminOnly, userCanEditSettings, userCanEditEpmConfig: true, environmentConfigExists: true,
                projectsConfigured: true,
                epm: {
                    version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] },
                    issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story', 'Task'] },
                    projects: { 'home-1': { id: 'home-1', homeProjectId: 'home-1', name: 'Connected Home Project', label: 'rnd_project_connected' } },
                },
            });
        }
        if (pathname === '/api/groups-config' && request.method() === 'GET') {
            return json(groupsPayload({ revision: state.revision, flag: state.flag, columns: state.columns }));
        }
        if (pathname === '/api/groups-config' && request.method() === 'POST') {
            const body = request.postDataJSON();
            if (recordPosts) posts.push(body);
            if (body.baseRevision !== state.revision) {
                return json({ error: 'group_config_conflict', current: groupsPayload({ revision: state.revision, flag: state.flag, columns: state.columns }) }, 409);
            }
            const group = (body.groups || []).find((entry) => entry.id === GROUP_ID) || {};
            state.flag = group.board?.inheritColumnColours === true;
            state.columns = group.board?.columns || null;
            state.revision += 1;
            return json(groupsPayload({ revision: state.revision, flag: state.flag, columns: state.columns }));
        }
        if (pathname === '/api/sprints') {
            return json({ sprints: [
                { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
            ] });
        }
        if (pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            if (project !== 'product' || purpose) return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            const future = Number(url.searchParams.get('sprint')) === futureSprintId;
            const [sprintId, sprintName, sprintState] = future
                ? [futureSprintId, futureSprintName, 'future'] : [activeSprintId, activeSprintName, 'active'];
            const epics = epicPayload(sprintId, sprintName, sprintState);
            return json({ issues: storyPayload(sprintId, sprintName, sprintState), epics, epicsInScope: Object.values(epics), names: {} });
        }
        if (pathname === '/api/issues/subtasks') return json(subtaskPayload());
        if (pathname === '/api/issues/transitions/options') return json({ issues: [], targetStatuses: TARGET_STATUSES });
        if (pathname === '/api/issues/transitions') {
            return json({ targetStatus: 'Done', results: [{ key: SUBTASK_PARENT, result: 'success', toStatus: 'Done' }] });
        }
        if (pathname === '/api/issues/description') return json({ key: url.searchParams.get('key'), html: '', isEmpty: true });
        if (pathname === '/api/board-config/statuses') return json({ statuses: [], source: 'test' });
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(pathname)) {
            return json({ schemaVersion: 1, sprintId: String(futureSprintId), schemaRevision: 0, columns: [], capabilities: { canRead: false, canSave: false } });
        }
        if (/^\/api\/eng\/sprints\/[^/]+\/review\/values\/read$/.test(pathname)) return json({ cells: [], unavailableIssueIds: [] });
        if (pathname === '/api/eng/story-readiness') {
            return json({ schemaVersion: 1, complete: true, scope: { groupId: GROUP_ID, sprintId: String(futureSprintId), sprintName: futureSprintName, sprintState: 'future' }, epics: [] });
        }
        if (pathname === '/api/analytics/context') return json({ enabled: false });
        return route.fallback();
    });
    return {
        base,
        requests,
        posts,
        state,
        setFlag(value) { state.flag = value; },
        setColumns(value) { state.columns = value; },
    };
}

// Disables CSS animations and waits two frames, so screenshots and geometry are taken settled.
async function waitForVisualSettled(page) {
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// Every Jira status pill under `scope`. Excluded: the filter-bar popover pill, the "N Stories awaited"
// count badge, and the alert tags (not Jira status pills, Decision 1).
async function collectPills(page, scope = 'body') {
    const colours = Object.fromEntries(STATUS_COLOUR);
    return page.evaluate(({ selector, colours: byStatus }) => {
        const probe = (colour) => {
            const node = document.createElement('span');
            node.style.background = colour ? `color-mix(in srgb, ${colour} 28%, var(--bg-secondary))` : '';
            node.style.color = 'var(--text-primary)';
            document.body.appendChild(node);
            const style = getComputedStyle(node);
            const result = { background: style.backgroundColor, color: style.color };
            node.remove();
            return result;
        };
        const root = document.querySelector(selector) || document.body;
        const excluded = '.eng-filter-status-pill, .planning-review-awaiting, .alert-pill, .status-transition-option-marker';
        return [...root.querySelectorAll('.task-status, .status-pill')]
            .filter((node) => !node.matches(excluded) && !node.closest('.eng-filter-bar-popover, .eng-filter-popover'))
            .map((node) => {
                const style = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(node);
                const text = range.getBoundingClientRect();
                const expected = byStatus[node.textContent.trim()] ? probe(byStatus[node.textContent.trim()]) : null;
                return {
                    expected,
                    text: node.textContent.trim(),
                    tag: node.tagName,
                    inline: node.getAttribute('style'),
                    inlineBackground: node.style.background,
                    inlineColor: node.style.color,
                    background: style.backgroundColor,
                    color: style.color,
                    box: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100),
                    textBox: [text.x, text.y, text.width, text.height].map((value) => Math.round(value * 100) / 100),
                };
            });
    }, { selector: scope, colours });
}

// Asserts the colour contract for a set of collected pills. Flag on: a mapped status takes its column
// colour tint with the primary text colour; an unmapped one has no inline style at all. Flag off: nothing is inline.
function expectPillColours(pills, { flag }) {
    expect(pills.length).toBeGreaterThan(0);
    if (flag) expect(pills.some((pill) => STATUS_COLOUR.has(pill.text)), 'the sweep must include a mapped status').toBe(true);
    for (const pill of pills) {
        const colour = STATUS_COLOUR.get(pill.text);
        if (flag && colour) {
            expect(pill.background, `${pill.text} background`).toBe(pill.expected.background);
            expect(pill.color, `${pill.text} text`).toBe(pill.expected.color);
            expect(pill.inline, `${pill.text} inline`).toContain(tintInline(colour));
        } else {
            expect(pill.inline, `${pill.text} must carry no inline style`).toBeNull();
        }
    }
}

module.exports = {
    BOARD_COLUMNS, STATUS_COLOUR, UNMAPPED_STATUSES, GROUP_ID, UI_PREFS_KEY, appBaseUrl,
    activeSprintId, activeSprintName, futureSprintId, futureSprintName, SUBTASK_PARENT,
    collectPills, expectPillColours, hexToRgb, installStatusColourFixture, tintFor, tintInline, waitForVisualSettled,
};
