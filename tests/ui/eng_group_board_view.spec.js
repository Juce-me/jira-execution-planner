const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { expectConfigBootstrapHoldsJiraWork, installDashboardShell } = require('./epm_home_token_fixture');

// The Board view itself (§6.1, §6.1.2): columns, folded rails as the chart, focus and star,
// off-frame hints, breach glow, and the invariant that exactly one column is focused and open at
// all times (D43). Geometry is asserted on computed values, never on declarations — an undefined
// custom property drops a whole declaration silently, and this design has been bitten by that.

// tmp/, not test-results/: Playwright wipes its own output dir at the start of every run, so a
// screenshot written there is gone the moment any other spec runs. tmp/ is gitignored.
const screenshotDir = path.join(__dirname, '..', '..', 'tmp', 'eng-group-board-view');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
let sourceDashboardJs = '';

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    sourceDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', '..', 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"production"' },
    }).outputFiles[0].text;
});

// A trimmed §5.5 reference configuration: the same seven columns, the same colours, the same star,
// and the two properties the design turns on — a breach in each direction (Analysis under min,
// In progress over max) and a RED accent that does not breach (External block).
const BOARD_COLUMNS = [
    { id: 'col-1a2b3c4d', name: 'To do', colour: '#8c8c8c', star: false, min: null, max: null, statuses: ['To Do'] },
    { id: 'col-2b3c4d5e', name: 'Analysis', colour: '#b37feb', star: false, min: 4, max: null, statuses: ['Analysis'] },
    { id: 'col-3c4d5e6f', name: 'Ready to start', colour: '#597ef7', star: false, min: null, max: null, statuses: ['Awaiting Validation', 'Postponed', 'Pending'] },
    { id: 'col-4d5e6f70', name: 'Accepted in Q', colour: '#13c2c2', star: false, min: null, max: 12, statuses: ['Accepted'] },
    { id: 'col-5e6f7081', name: 'External block', colour: '#ff4d4f', star: false, min: null, max: 5, statuses: ['Blocked'] },
    { id: 'col-6f708192', name: 'In progress', colour: '#597ef7', star: true, min: null, max: 1, statuses: ['In Progress', 'Release'] },
    { id: 'col-708192a3', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done', 'Killed', 'Incomplete'] },
];

// key -> [status, priority]. Column epic counts: 2, 1, 1, 1, 1, 3, 1 -> scale max 3.
const EPIC_SPECS = [
    ['PLAT-1', 'To Do', 'Major'],
    ['PLAT-2', 'To Do', 'Blocker'],
    ['PLAT-3', 'Analysis', 'Minor'],
    ['PLAT-4', 'Awaiting Validation', 'Major'],
    ['PLAT-5', 'Accepted', 'Low'],
    ['PLAT-6', 'Blocked', 'Critical'],
    ['PLAT-7', 'In Progress', 'Trivial'],
    ['PLAT-8', 'In Progress', 'Blocker'],
    ['PLAT-9', 'Release', 'Major'],
    ['PLAT-10', 'Done', 'Minor'],
];

function epicPayload(specs = EPIC_SPECS) {
    const epics = {};
    specs.forEach(([key, status, priority]) => {
        epics[key] = {
            key,
            summary: `${key} epic summary`,
            status,
            priority,
            assignee: { displayName: 'Planner' },
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            projectTrack: null,
            updated: '2026-05-01T00:00:00.000+0000',
        };
    });
    return epics;
}

function storyPayload(specs = EPIC_SPECS) {
    return specs.map(([key], index) => ({
        id: `${key}-1`,
        key: `${key}-1`,
        fields: {
            summary: `${key} story`,
            status: { name: 'In Progress' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Planner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: index + 1,
            epicKey: key,
            parentSummary: `${key} epic summary`,
            projectKey: 'PLAT',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    }));
}

async function installBoardFixture(page, {
    board = { columns: BOARD_COLUMNS }, groups = null, epicSpecs = EPIC_SPECS,
    strictBoard = false, requests = null, sourceBundle = false, configDelayMs = 0, configResponseGate = null,
    configStatus = 200, taskResponseGate = null, boardResponseGate = null, strictEpicKeyForRequest = null,
    homeTokenDelayMs = 0, homeTokenFailureCount = 0,
    groupsResponseGate = null, groupsStatus = 200, groupsSource = 'test', groupPreferences = null,
    groupPreferencesResponseGate = null,
    sprintResponseGate = null, sprintResponder = null, sprints = null, sprintsStatus = 200, requestUrls = null, requestLog = null,
    selectedProjects = [{ key: 'PLAT', type: 'product' }], savedBoardId = '',
    projectSaveResponseGate = null, boardConfigSaveResponseGate = null,
    boardCapability = strictBoard, performanceLoads = null, performanceResponseGate = null,
    performanceStatus = 201, jiraProjects = [{ key: 'DRAFT', name: 'Draft Project' }],
    jiraBoards = [{ id: '99', name: 'Draft Board', type: 'scrum' }], analyticsEnabled = false,
    userCanEditSettings = true, settingsAdminOnly = false, sprintCatalogSource = null,
} = {}) {
    let strictBoardRequestCount = 0;
    let acceptedSelectedProjects = selectedProjects;
    let acceptedSavedBoardId = savedBoardId;
    let acceptedSavedBoardName = savedBoardId ? 'Synthetic Board' : '';
    let acceptedWorkspaceRevision = 1;
    let acceptedGroupsRevision = 1;
    let acceptedGroupsConfig = {
        version: 1,
        groups: groups ?? [{
            id: 'grp-default',
            name: 'Default',
            teamIds: ['team-alpha'],
            teamLabels: { 'team-alpha': 'Alpha Team' },
            ...(strictBoard ? { missingInfoComponents: ['Platform'] } : {}),
            ...(board ? { board } : {}),
        }],
        defaultGroupId: 'grp-default',
        configRevision: acceptedGroupsRevision,
        source: groupsSource,
    };
    let acceptedGroupPreferences = groupPreferences;
    let homeTokenRequestCount = 0;
    let configRequestCount = 0;
    let groupsRequestCount = 0;
    let sprintRequestCount = 0;
    await installDashboardShell(page);
    if (sourceBundle) {
        await page.unroute('**/frontend/dist/dashboard.js');
        await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: sourceDashboardJs,
        }));
    }
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requestUrls?.push(`${url.pathname}${url.search}`);
        requestLog?.push({
            url: request.url(),
            method: request.method(),
            body: request.postDataJSON?.() ?? null,
        });
        requests?.push(url.pathname === '/api/eng/board' ? `${url.pathname}${url.search}` : url.pathname);
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'synthetic-csrf' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        }
        if (url.pathname === '/api/analytics/context') return json({ enabled: analyticsEnabled });
        if (url.pathname === '/api/performance/context') return json({ enabled: true });
        if (url.pathname === '/api/performance/loads') {
            const observation = request.postDataJSON();
            performanceLoads?.push(observation);
            const observationGate = typeof performanceResponseGate === 'function'
                ? performanceResponseGate(observation)
                : performanceResponseGate;
            if (observationGate) await observationGate;
            if (performanceStatus !== 201) return json({ error: 'performance_unavailable' }, performanceStatus);
            return json({ recorded: true }, 201);
        }
        if (url.pathname === '/api/me/connections/home-token') {
            homeTokenRequestCount += 1;
            if (homeTokenDelayMs) await new Promise(resolve => setTimeout(resolve, homeTokenDelayMs));
            if (homeTokenRequestCount <= homeTokenFailureCount) return route.abort('failed');
            return json({ connected: false });
        }
        if (url.pathname === '/api/team-catalog') {
            return json({ catalog: { 'team-alpha': 'Alpha Team' }, meta: { source: 'test' } });
        }
        if (url.pathname === '/api/config') {
            configRequestCount += 1;
            const currentSprintCatalogSource = typeof sprintCatalogSource === 'function'
                ? sprintCatalogSource({
                    requestIndex: configRequestCount,
                    boardId: acceptedSavedBoardId,
                    workspaceRevision: acceptedWorkspaceRevision,
                })
                : sprintCatalogSource;
            const config = {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                settingsAdminOnly,
                userCanEditSettings,
                authMode: 'atlassian_oauth',
                boardAllWorkAvailable: boardCapability,
                projectsConfigured: acceptedSelectedProjects.length > 0,
                performanceDebugEnabled: true,
                sharedConfigRevision: acceptedWorkspaceRevision,
                sharedConfig: {
                    projects: { selected: acceptedSelectedProjects },
                    board: { boardId: acceptedSavedBoardId, boardName: acceptedSavedBoardName },
                    sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' },
                    parentNameField: { fieldId: 'customfield_10021', fieldName: 'Parent Link' },
                    storyPointsField: { fieldId: 'customfield_10022', fieldName: 'Story points' },
                    teamField: { fieldId: 'customfield_10023', fieldName: 'Team' },
                },
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
                ...(currentSprintCatalogSource ? { sprintCatalogSource: currentSprintCatalogSource } : {}),
            };
            const responseStatus = typeof configStatus === 'function'
                ? configStatus({ requestIndex: configRequestCount })
                : configStatus;
            const configGate = typeof configResponseGate === 'function'
                ? configResponseGate({ requestIndex: configRequestCount })
                : configResponseGate;
            if (configGate) await configGate;
            if (configDelayMs) await new Promise(resolve => setTimeout(resolve, configDelayMs));
            return responseStatus === 200 ? json(config) : json({ error: 'config_unavailable' }, responseStatus);
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') {
            groupsRequestCount += 1;
            const defaultPayload = {
                ...acceptedGroupsConfig,
                ...(acceptedGroupPreferences ? { preferences: acceptedGroupPreferences } : {}),
            };
            const responseStatus = typeof groupsStatus === 'function'
                ? groupsStatus({ requestIndex: groupsRequestCount })
                : groupsStatus;
            const groupsGate = typeof groupsResponseGate === 'function'
                ? groupsResponseGate({ requestIndex: groupsRequestCount })
                : groupsResponseGate;
            if (groupsGate) await groupsGate;
            if (request.method() === 'POST') {
                acceptedGroupsRevision += 1;
                acceptedGroupsConfig = {
                    ...request.postDataJSON(),
                    configRevision: acceptedGroupsRevision,
                    source: groupsSource,
                };
                return json(acceptedGroupsConfig);
            }
            return responseStatus === 200 ? json(defaultPayload) : json({ error: 'groups_unavailable' }, responseStatus);
        }
        if (url.pathname === '/api/groups-preferences') {
            const payload = request.postDataJSON();
            const preferencesGate = typeof groupPreferencesResponseGate === 'function'
                ? groupPreferencesResponseGate(payload)
                : groupPreferencesResponseGate;
            if (preferencesGate) await preferencesGate;
            acceptedGroupPreferences = {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                onboardingDone: true,
                visibleGroupIds: payload.visibleGroupIds || [],
                effectiveVisibleGroupIds: payload.visibleGroupIds || [],
                activeGroupId: payload.activeGroupId || null,
            };
            return json({ preferences: acceptedGroupPreferences });
        }
        if (url.pathname === '/api/projects/selected') {
            if (request.method() === 'POST') {
                const projectSaveGate = typeof projectSaveResponseGate === 'function'
                    ? projectSaveResponseGate(request.postDataJSON())
                    : projectSaveResponseGate;
                if (projectSaveGate) await projectSaveGate;
                acceptedSelectedProjects = request.postDataJSON().selected || [];
                acceptedWorkspaceRevision += 1;
            }
            return json({ selected: acceptedSelectedProjects, configRevision: acceptedWorkspaceRevision });
        }
        if (url.pathname === '/api/board-config') {
            if (request.method() === 'POST') {
                const submittedBoard = request.postDataJSON();
                const boardConfigSaveGate = typeof boardConfigSaveResponseGate === 'function'
                    ? boardConfigSaveResponseGate(submittedBoard)
                    : boardConfigSaveResponseGate;
                if (boardConfigSaveGate) await boardConfigSaveGate;
                acceptedSavedBoardId = String(submittedBoard.boardId || '');
                acceptedSavedBoardName = String(submittedBoard.boardName || '');
                acceptedWorkspaceRevision += 1;
            }
            return json({
                boardId: acceptedSavedBoardId,
                boardName: acceptedSavedBoardName,
                source: 'config',
                configRevision: acceptedWorkspaceRevision,
            });
        }
        if (url.pathname === '/api/projects') return json({ projects: jiraProjects });
        if (url.pathname === '/api/components') return json({ components: [{ id: 'platform', name: 'Platform' }] });
        if (url.pathname === '/api/boards') return json({ boards: jiraBoards });
        if (url.pathname === '/api/sprints') {
            sprintRequestCount += 1;
            if (sprintResponder) {
                const result = await sprintResponder({ url, request, requestIndex: sprintRequestCount });
                return json(result.body, result.status || 200);
            }
            const gate = typeof sprintResponseGate === 'function' ? sprintResponseGate() : sprintResponseGate;
            if (gate) await gate;
            if (sprintsStatus !== 200) return json({ error: 'sprints_unavailable' }, sprintsStatus);
            return json({ sprints: sprints ?? (strictBoard ? [
                { id: 34624, name: '2026Q2 Sprint 41', state: 'closed' },
                { id: selectedSprintId, name: selectedSprintName, state: 'active' },
                { id: 34626, name: '2026Q3 Sprint 43', state: 'future' },
            ] : [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }]) });
        }
        if (url.pathname === '/api/eng/board') {
            strictBoardRequestCount += 1;
            const boardGate = typeof boardResponseGate === 'function'
                ? boardResponseGate({ url, requestIndex: strictBoardRequestCount })
                : boardResponseGate;
            if (boardGate) await boardGate;
            if (strictBoard && !acceptedSelectedProjects.length && !String(acceptedSavedBoardId).trim()) {
                return json({ error: 'board_config_invalid' }, 409);
            }
            const scope = url.searchParams.get('scope') || 'sprint';
            const strictEpicKey = typeof strictEpicKeyForRequest === 'function'
                ? strictEpicKeyForRequest({ url, requestIndex: strictBoardRequestCount })
                : strictEpicKeyForRequest || 'STRICT-1';
            const generationId = `generation-${scope}-${strictBoardRequestCount}`;
            const base = (sequence, frame) => ({
                protocolVersion: 1, generationId, sequence, ...frame,
            });
            const epic = {
                key: strictEpicKey, summary: 'Strict Board epic', status: { id: '2', name: 'In Progress' },
                priority: { id: '1', name: 'Blocker' }, assignee: null, deliveryOwner: null,
                projectTrack: null, updated: null, parent: null, columnId: 'active',
            };
            const child = {
                key: `${strictEpicKey}-CHILD`, epicKey: strictEpicKey, summary: 'Eligible Bug',
                status: { id: '1', name: 'To Do' }, priority: null,
                issueType: { id: '10004', name: 'Bug' }, assignee: null, updated: null,
                storyPoints: 3, team: null, project: { id: '10000', name: 'Platform' },
                projectClassification: 'other', sprintIds: [selectedSprintId],
            };
            const frames = [
                base(0, {
                    type: 'start', scope, scopeVersion: `scope-${scope}`,
                    scopeCohortDigest: 'a'.repeat(64),
                    columns: [{ id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false }],
                }),
                base(1, { type: 'index', epics: [epic], membership: scope === 'sprint' ? 'candidate' : 'authoritative' }),
                base(2, { type: 'column', columnId: 'active', epics: [epic], children: [child], authoritative: true }),
                base(3, {
                    type: 'complete', outcome: 'success', authoritative: true, epicCount: 1, childCount: 1,
                    diagnostics: {
                        indexMs: 1, focusedCompleteMs: 2, durationMs: 3, jiraRequests: 2,
                        jiraPages: 2, jiraRetries: 0, peakChildSearches: 1,
                        cacheState: 'miss', completeness: 'complete',
                    },
                }),
            ];
            return route.fulfill({
                status: 200,
                contentType: 'application/x-ndjson',
                body: `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`,
            });
        }
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const taskGate = typeof taskResponseGate === 'function'
                ? taskResponseGate({ url, request })
                : taskResponseGate;
            if (taskGate) await taskGate;
            const purpose = url.searchParams.get('purpose');
            const project = url.searchParams.get('project');
            if (purpose === 'ready-to-close' || project === 'tech') {
                return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            }
            const epics = epicPayload(epicSpecs);
            return json({ issues: storyPayload(epicSpecs), epics, epicsInScope: Object.values(epics), names: {} });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openBoard(page, {
    width = 1280, height = 900, board, groups, epicSpecs, reducedMotion, strictBoard, requests, sourceBundle, configDelayMs,
    configResponseGate, configStatus, taskResponseGate, boardResponseGate, strictEpicKeyForRequest,
    homeTokenDelayMs, homeTokenFailureCount, groupsResponseGate, groupsStatus, groupsSource, groupPreferences, sprints, sprintResponder, requestUrls, requestLog,
    selectedProjects, savedBoardId, projectSaveResponseGate, boardConfigSaveResponseGate,
    boardCapability, performanceLoads, performanceResponseGate, performanceStatus,
    analyticsEnabled,
    userCanEditSettings, settingsAdminOnly, sprintCatalogSource,
    initialPrefs = {},
    expectBoardColumns = true,
} = {}) {
    if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await installBoardFixture(page, {
        ...(board === undefined ? {} : { board }),
        ...(groups === undefined ? {} : { groups }),
        ...(epicSpecs === undefined ? {} : { epicSpecs }),
        ...(strictBoard === undefined ? {} : { strictBoard }),
        ...(requests === undefined ? {} : { requests }),
        ...(sourceBundle === undefined ? {} : { sourceBundle }),
        ...(configDelayMs === undefined ? {} : { configDelayMs }),
        ...(configResponseGate === undefined ? {} : { configResponseGate }),
        ...(configStatus === undefined ? {} : { configStatus }),
        ...(taskResponseGate === undefined ? {} : { taskResponseGate }),
        ...(boardResponseGate === undefined ? {} : { boardResponseGate }),
        ...(strictEpicKeyForRequest === undefined ? {} : { strictEpicKeyForRequest }),
        ...(homeTokenDelayMs === undefined ? {} : { homeTokenDelayMs }),
        ...(homeTokenFailureCount === undefined ? {} : { homeTokenFailureCount }),
        ...(groupsResponseGate === undefined ? {} : { groupsResponseGate }),
        ...(groupsStatus === undefined ? {} : { groupsStatus }),
        ...(groupsSource === undefined ? {} : { groupsSource }),
        ...(groupPreferences === undefined ? {} : { groupPreferences }),
        ...(sprints === undefined ? {} : { sprints }),
        ...(sprintResponder === undefined ? {} : { sprintResponder }),
        ...(requestUrls === undefined ? {} : { requestUrls }),
        ...(requestLog === undefined ? {} : { requestLog }),
        ...(selectedProjects === undefined ? {} : { selectedProjects }),
        ...(savedBoardId === undefined ? {} : { savedBoardId }),
        ...(projectSaveResponseGate === undefined ? {} : { projectSaveResponseGate }),
        ...(boardConfigSaveResponseGate === undefined ? {} : { boardConfigSaveResponseGate }),
        ...(boardCapability === undefined ? {} : { boardCapability }),
        ...(performanceLoads === undefined ? {} : { performanceLoads }),
        ...(performanceResponseGate === undefined ? {} : { performanceResponseGate }),
        ...(performanceStatus === undefined ? {} : { performanceStatus }),
        ...(analyticsEnabled === undefined ? {} : { analyticsEnabled }),
        ...(userCanEditSettings === undefined ? {} : { userCanEditSettings }),
        ...(settingsAdminOnly === undefined ? {} : { settingsAdminOnly }),
        ...(sprintCatalogSource === undefined ? {} : { sprintCatalogSource }),
    });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showBoard: true,
        showPlanning: false,
        showScenario: false,
        showAlertsPanel: false,
        ...initialPrefs,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    if (expectBoardColumns) {
        await page.waitForSelector('.eng-board .col', { timeout: 10000 });
        await settle(page);
    }
}

const statsSourceRequests = (requestLog) => requestLog.filter(({ url, method }) => (
    method === 'POST' && new URL(url).pathname === '/api/stats/excluded-capacity-source'
));

const ordinarySprintRequests = (requestLog, sprintId) => requestLog.filter(({ url, method }) => {
    const parsed = new URL(url);
    return method === 'GET'
        && parsed.pathname === '/api/tasks-with-team-name'
        && parsed.searchParams.get('sprint') === String(sprintId);
});

async function expectOneStatsSprintReload(requestLog, sprintId, countBefore, { refresh = false } = {}) {
    await expect.poll(() => statsSourceRequests(requestLog).length).toBe(countBefore + 1);
    const newRequests = statsSourceRequests(requestLog).slice(countBefore);
    expect(newRequests).toHaveLength(1);
    expect(newRequests[0].body).toEqual({
        sprintIds: [String(sprintId)],
        teamIds: ['team-alpha'],
        ...(refresh ? { refresh: true } : {}),
    });
}

async function expectLockedSelectorInteractionBlocked(page, trigger) {
    const lockedApp = page.locator('#root > div[aria-hidden="true"]');
    await expect(lockedApp).toHaveCount(1);
    await expect(trigger).toHaveCount(0);
    const mountedTrigger = page.locator('.sprint-dropdown-toggle').first();
    const pointerError = await mountedTrigger.click({ timeout: 500 }).then(
        () => '',
        error => String(error?.message || error),
    );
    expect(pointerError).not.toBe('');
    const signIn = page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' });
    await expect(signIn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(signIn).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(signIn).toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Sprint options', exact: true })).toHaveCount(0);
}

const waitTwoFrames = page => page.evaluate(() => new Promise(resolve => (
    requestAnimationFrame(() => requestAnimationFrame(resolve))
)));

const SPRINT_SOURCE_A = {
    backend: 'postgresql',
    identity: 'sc1:synthetic-board-a',
    boardId: '42',
    browserContextId: 'bc1:synthetic-browser-a',
};
const SPRINT_SOURCE_B = {
    backend: 'postgresql',
    identity: 'sc1:synthetic-board-b',
    boardId: '99',
    browserContextId: 'bc1:synthetic-browser-a',
};
const SPRINT_SOURCE_AUTH_B = {
    ...SPRINT_SOURCE_A,
    browserContextId: 'bc1:synthetic-browser-b',
};

function sprintCatalogEnvelope({
    source = SPRINT_SOURCE_A,
    sprintList = [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
    state = 'fresh',
    refreshStatus = 'idle',
    refreshAttemptId = null,
    refreshStarted = false,
    refreshFailed = false,
    catalogVersion = '33333333-3333-4333-8333-333333333333',
} = {}) {
    return {
        sprints: sprintList,
        cache: {
            ...source,
            scopeDigest: null,
            state,
            catalogVersion,
            validatedAt: '2026-09-14T12:00:30Z',
            refreshStatus,
            refreshAttemptId,
            refreshStarted,
            refreshFailed,
            failureCode: refreshFailed ? 'jira_unavailable' : null,
        },
    };
}

async function installIncrementalStrictBoardResponse(page, requests) {
    await page.exposeFunction('recordIncrementalStrictBoardRequest', requestUrl => {
        requests.push(requestUrl);
    });
    await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();
        let intercepted = false;
        let controller = null;
        let cancelled = false;
        const generationId = 'generation-component-incremental';
        const frame = (sequence, value) => JSON.stringify({
            protocolVersion: 1,
            generationId,
            sequence,
            ...value,
        }) + '\n';
        const epic = {
            key: 'STRICT-PARTIAL-OLD', summary: 'Retired partial epic',
            status: { id: '2', name: 'In Progress' }, priority: { id: '1', name: 'Blocker' },
            assignee: null, deliveryOwner: null, projectTrack: null, updated: null,
            parent: null, columnId: 'active',
        };
        window.__releaseRetiredStrictFrames = () => {
            const result = { attempted: true, cancelled, enqueued: false };
            try {
                controller.enqueue(encoder.encode(frame(3, {
                    type: 'column', columnId: 'active', epics: [epic], authoritative: true,
                    children: [{
                        key: 'STRICT-PARTIAL-OLD-CHILD', epicKey: epic.key, summary: 'Late retired child',
                        status: { id: '1', name: 'To Do' }, priority: null,
                        issueType: { id: '10004', name: 'Bug' }, assignee: null, updated: null,
                        storyPoints: 5, team: null, project: { id: '10000', name: 'Platform' },
                        projectClassification: 'other', sprintIds: [34625],
                    }],
                })));
                controller.enqueue(encoder.encode(frame(4, {
                    type: 'complete', outcome: 'success', authoritative: true, epicCount: 1, childCount: 1,
                    diagnostics: {
                        indexMs: 11, focusedCompleteMs: 12, durationMs: 13, jiraRequests: 4,
                        jiraPages: 4, jiraRetries: 0, peakChildSearches: 1,
                        cacheState: 'miss', completeness: 'complete',
                    },
                })));
                controller.close();
                result.enqueued = true;
            } catch (_err) {
                // Cancellation is the expected transport-level retirement path.
            }
            return result;
        };
        window.fetch = async (input, init) => {
            const rawUrl = typeof input === 'string' ? input : input.url;
            const url = new URL(rawUrl, window.location.origin);
            if (!intercepted && url.pathname === '/api/eng/board' && url.searchParams.get('scope') === 'component') {
                intercepted = true;
                await window.recordIncrementalStrictBoardRequest(`${url.pathname}${url.search}`);
                const stream = new ReadableStream({
                    start(nextController) {
                        controller = nextController;
                        [
                            frame(0, {
                                type: 'start', scope: 'component', scopeVersion: 'scope-component-old',
                                scopeCohortDigest: 'b'.repeat(64),
                                columns: [{
                                    id: 'active', name: 'Active', color: '#597ef7',
                                    statusNames: ['In Progress'], terminal: false,
                                }],
                            }),
                            frame(1, { type: 'index', epics: [epic], membership: 'authoritative' }),
                            frame(2, {
                                type: 'progress', columnId: 'active', loadedChildren: 1,
                                byEpic: [{
                                    epicKey: epic.key, loadedChildren: 1,
                                    statusCounts: { 'To Do': 1 },
                                }],
                            }),
                        ].forEach(value => controller.enqueue(encoder.encode(value)));
                    },
                    cancel() {
                        cancelled = true;
                    },
                });
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'application/x-ndjson' },
                });
            }
            return originalFetch(input, init);
        };
    });
}

const expectActiveSprintOption = async (page, expectedName) => {
    const combobox = page.getByRole('combobox', { name: 'Filter sprints', exact: true });
    const activeId = await combobox.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const activeOption = page.locator(`#${activeId}`);
    await expect(activeOption).toHaveRole('option');
    await expect(activeOption).toHaveAttribute('type', 'button');
    await expect(activeOption).toHaveAttribute('tabindex', '-1');
    await expect(activeOption).toHaveAccessibleName(expectedName);
    return activeOption;
};

test('selector keyboard: ordinary', async ({ page }) => {
    const requestLog = [];
    await openBoard(page, { strictBoard: true, sourceBundle: true, requestLog });
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();

    await expect(trigger).toHaveAttribute('type', 'button');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'sprint-main-listbox');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const combobox = page.getByRole('combobox', { name: 'Filter sprints', exact: true });
    await expect(combobox).toBeFocused();
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('listbox', { name: 'Sprint options', exact: true })).toBeVisible();
    await combobox.fill('2026Q3 Sprint 43');
    await page.keyboard.press('ArrowDown');
    await expectActiveSprintOption(page, '2026Q3 Sprint 43');
    await page.keyboard.press('Enter');

    await expect(trigger).toContainText('2026Q3 Sprint 43');
    await expect(trigger).toBeFocused();
    await expect.poll(() => requestLog.some(({ url, method }) => {
        const parsed = new URL(url);
        return method === 'GET'
            && parsed.pathname === '/api/tasks-with-team-name'
            && parsed.searchParams.get('sprint') === '34626';
    })).toBe(true);

    await trigger.click();
    await page.keyboard.press('End');
    await expectActiveSprintOption(page, '2026Q3 Sprint 43');
    await page.keyboard.press('ArrowUp');
    await expectActiveSprintOption(page, selectedSprintName);
    await page.keyboard.press('Home');
    await expectActiveSprintOption(page, 'All work');
    await combobox.fill('does-not-exist');
    await expect(combobox).not.toHaveAttribute('aria-activedescendant');
    await expect(page.getByRole('status', { name: 'Sprint options status', exact: true }))
        .toHaveText('No matching sprints');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('listbox', { name: 'Sprint options', exact: true })).toHaveCount(0);
    await expect(trigger).not.toBeFocused();
});

test('selector keyboard: Component', async ({ page }) => {
    const requests = [];
    await openBoard(page, { strictBoard: true, sourceBundle: true, requests });
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();

    await trigger.focus();
    await page.keyboard.press('Enter');
    const combobox = page.getByRole('combobox', { name: 'Filter sprints', exact: true });
    await combobox.fill('Component');
    await page.keyboard.press('ArrowDown');
    await expectActiveSprintOption(page, 'Component');
    await page.keyboard.press('Enter');

    await expect(trigger).toContainText('Component');
    await expect(trigger).toBeFocused();
    await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
    const strictRequest = requests.find(path => path.includes('scope=component'));
    expect(new URLSearchParams(strictRequest.split('?')[1]).has('sprintId')).toBe(false);
});

test('selector keyboard: All work', async ({ page }) => {
    const requests = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requests,
        selectedProjects: [],
        savedBoardId: '',
    });
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();

    await trigger.focus();
    await page.keyboard.press('Enter');
    const combobox = page.getByRole('combobox', { name: 'Filter sprints', exact: true });
    await combobox.fill('All');
    await page.keyboard.press('Space');
    await page.keyboard.type('work');
    await expect(combobox).toHaveValue('All work');
    await page.keyboard.press('ArrowDown');
    const activeOption = await expectActiveSprintOption(page, 'All work');
    const descriptionId = await activeOption.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    await expect(page.locator(`#${descriptionId}`)).toContainText('Setup needed');
    await page.keyboard.press('Enter');

    await expect(trigger).toContainText('All work');
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('status', { name: 'Board scope status', exact: true })).toContainText(
        'Select Jira projects or a Jira source Board before loading this scope.'
    );
    expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toEqual([]);
});

for (const modeProfile of [
    { name: 'Catch Up', source: 'tasks' },
    { name: 'Planning', source: 'tasks' },
    { name: 'Board', source: 'tasks' },
    { name: 'Statistics', source: 'stats', initialPrefs: { statsView: 'projectTrack' } },
    { name: 'Scenario', source: 'tasks' },
]) {
    test(`selector modes: ${modeProfile.name} supports pointer and keyboard Sprint selection`, async ({ page }) => {
        const requestLog = [];
        const sprints = [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: 34624, name: '2026Q2 Sprint 41', state: 'active' },
            { id: 34626, name: '2026Q3 Sprint 43', state: 'active' },
        ];
        await openBoard(page, {
            strictBoard: true,
            sourceBundle: true,
            requestLog,
            sprints,
            initialPrefs: modeProfile.initialPrefs,
        });
        if (modeProfile.name !== 'Board') {
            await page.getByRole('radiogroup', { name: 'ENG view mode' })
                .getByRole('radio', { name: modeProfile.name, exact: true }).click();
        }
        await expect(page.getByRole('radiogroup', { name: 'ENG view mode' })
            .getByRole('radio', { name: modeProfile.name, exact: true })).toHaveAttribute('aria-checked', 'true');
        if (modeProfile.source === 'stats') {
            await expectOneStatsSprintReload(requestLog, selectedSprintId, 0);
        }

        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await trigger.click();
        const pointerOption = page.getByRole('option', { name: '2026Q2 Sprint 41', exact: true });
        await expect(pointerOption).toHaveAttribute('aria-selected', 'false');
        await pointerOption.click();
        await expect(trigger).toContainText('2026Q2 Sprint 41');
        await expect(trigger).toBeFocused();
        if (modeProfile.source === 'stats') {
            await expectOneStatsSprintReload(requestLog, 34624, 1, { refresh: true });
            expect(ordinarySprintRequests(requestLog, 34624)).toEqual([]);
        } else {
            await expect.poll(() => requestLog.some(({ url, method }) => {
                const parsed = new URL(url);
                return method === 'GET'
                    && parsed.pathname === '/api/tasks-with-team-name'
                    && parsed.searchParams.get('sprint') === '34624';
            })).toBe(true);
        }

        await trigger.focus();
        await page.keyboard.press('Enter');
        const combobox = page.getByRole('combobox', { name: 'Filter sprints', exact: true });
        await combobox.fill('2026Q3 Sprint 43');
        await page.keyboard.press('ArrowDown');
        await expectActiveSprintOption(page, '2026Q3 Sprint 43');
        await page.keyboard.press('Enter');
        await expect(trigger).toContainText('2026Q3 Sprint 43');
        await expect(trigger).toBeFocused();
        if (modeProfile.source === 'stats') {
            await expectOneStatsSprintReload(requestLog, 34626, 2, { refresh: true });
            expect(ordinarySprintRequests(requestLog, 34626)).toEqual([]);
        } else {
            await expect.poll(() => requestLog.some(({ url, method }) => {
                const parsed = new URL(url);
                return method === 'GET'
                    && parsed.pathname === '/api/tasks-with-team-name'
                    && parsed.searchParams.get('sprint') === '34626';
            })).toBe(true);
        }
        await expect.poll(() => page.evaluate(() => JSON.parse(
            localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'
        ).selectedSprint)).toBe(34626);
        if (modeProfile.name === 'Scenario') {
            expect(requestLog.filter(({ url, method }) => (
                method !== 'GET' && new URL(url).pathname.startsWith('/api/scenario')
            ))).toEqual([]);
            await expect(page.getByRole('button', { name: 'Run Scenario', exact: true })).toBeVisible();
        }
    });
}

test('selector Project Track: explicit Sprint selection bypasses prewarmed source caches', async ({ page }) => {
    const requestLog = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requestLog,
        analyticsEnabled: true,
        sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: 34624, name: '2026Q2 Sprint 41', state: 'active' },
        ],
        initialPrefs: { statsView: 'projectTrack' },
    });
    await page.getByRole('radiogroup', { name: 'ENG view mode' })
        .getByRole('radio', { name: 'Statistics', exact: true }).click();
    await expectOneStatsSprintReload(requestLog, selectedSprintId, 0);

    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
    await trigger.click();
    await page.getByRole('option', { name: '2026Q2 Sprint 41', exact: true }).click();
    await expectOneStatsSprintReload(requestLog, 34624, 1, { refresh: true });

    await trigger.click();
    await page.getByRole('option', { name: selectedSprintName, exact: true }).click();
    await expectOneStatsSprintReload(requestLog, selectedSprintId, 2, { refresh: true });
    await page.waitForTimeout(250);
    expect(statsSourceRequests(requestLog)).toHaveLength(3);
});

test('selector Project Track: current Sprint repairs a divergent range once then becomes a no-op', async ({ page }) => {
    const requestLog = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requestLog,
        analyticsEnabled: true,
        sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: 34624, name: '2026Q2 Sprint 41', state: 'active' },
        ],
        initialPrefs: {
            statsView: 'projectTrack',
            excludedCapacityStartSprintId: '34624',
            excludedCapacityEndSprintId: '34624',
        },
    });
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).some(entry => (
        entry?.event_name === 'page_view'
    )))).toBe(true);
    await page.evaluate(() => { window.dataLayer.length = 0; });
    await page.getByRole('radiogroup', { name: 'ENG view mode' })
        .getByRole('radio', { name: 'Statistics', exact: true }).click();
    await expectOneStatsSprintReload(requestLog, 34624, 0);

    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
    await trigger.click();
    await page.getByRole('option', { name: selectedSprintName, exact: true }).click();
    await expectOneStatsSprintReload(requestLog, selectedSprintId, 1, { refresh: true });
    await expect.poll(() => page.evaluate(() => {
        const prefs = JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}');
        return [prefs.excludedCapacityStartSprintId, prefs.excludedCapacityEndSprintId];
    })).toEqual([String(selectedSprintId), String(selectedSprintId)]);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'filter_changed'
    )))).toEqual([]);

    await trigger.click();
    await page.getByRole('option', { name: selectedSprintName, exact: true }).click();
    await page.waitForTimeout(250);
    expect(statsSourceRequests(requestLog)).toHaveLength(2);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'filter_changed'
    )))).toEqual([]);
});

test('selector modes: task-backed Statistics keeps the ordinary Sprint task source', async ({ page }) => {
    const requestLog = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requestLog,
        sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: 34624, name: '2026Q2 Sprint 41', state: 'active' },
        ],
        initialPrefs: { statsView: 'teams' },
    });
    await page.getByRole('radiogroup', { name: 'ENG view mode' })
        .getByRole('radio', { name: 'Statistics', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
    await trigger.click();
    await page.getByRole('option', { name: '2026Q2 Sprint 41', exact: true }).click();
    await expect.poll(() => requestLog.some(({ url, method }) => {
        const parsed = new URL(url);
        return method === 'GET'
            && parsed.pathname === '/api/tasks-with-team-name'
            && parsed.searchParams.get('sprint') === '34624';
    })).toBe(true);
    expect(statsSourceRequests(requestLog)).toEqual([]);
});

test('selector modes: closed and future Sprint choices preserve mode eligibility', async ({ page }) => {
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: 34624, name: '2026Q2 Sprint 41', state: 'closed' },
            { id: 34626, name: '2026Q3 Sprint 43', state: 'future' },
        ],
    });
    const modes = page.getByRole('radiogroup', { name: 'ENG view mode' });
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();

    await trigger.click();
    await page.getByRole('option', { name: '2026Q2 Sprint 41', exact: true }).click();
    await expect(modes.getByRole('radio', { name: 'Planning', exact: true })).toBeDisabled();
    await expect(modes.getByRole('radio', { name: 'Scenario', exact: true })).toBeDisabled();
    await expect(modes.getByRole('radio', { name: 'Statistics', exact: true })).toBeEnabled();
    await expect(modes.getByRole('radio', { name: 'Board', exact: true })).toBeEnabled();

    await trigger.click();
    await page.getByRole('option', { name: '2026Q3 Sprint 43', exact: true }).click();
    await expect(modes.getByRole('radio', { name: 'Planning', exact: true })).toBeEnabled();
    await expect(modes.getByRole('radio', { name: 'Scenario', exact: true })).toBeEnabled();
    await settle(page);
    await modes.screenshot({ path: `${screenshotDir}/future-sprint-statistics-after.png` });
    const statistics = modes.getByRole('radio', { name: 'Statistics', exact: true });
    await expect(statistics).toBeEnabled();
    await expect(modes.getByRole('radio', { name: 'Board', exact: true })).toBeEnabled();
    await statistics.click();
    await expect(statistics).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radiogroup', { name: 'Statistics view', exact: true })).toBeVisible();
    await expect(trigger).toContainText('2026Q3 Sprint 43');

    // Statistics remains mounted when its header Sprint changes back to a future sprint.
    await trigger.click();
    await page.getByRole('option', { name: selectedSprintName, exact: true }).click();
    await trigger.click();
    await page.getByRole('option', { name: '2026Q3 Sprint 43', exact: true }).click();
    await expect(statistics).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radiogroup', { name: 'Statistics view', exact: true })).toBeVisible();
});

const selectorModePrefs = (modeName) => ({
    showBoard: modeName === 'Board',
    showPlanning: modeName === 'Planning',
    showStats: modeName === 'Statistics',
    showScenario: modeName === 'Scenario',
    ...(modeName === 'Statistics' ? { statsView: 'projectTrack' } : {}),
});

for (const modeName of ['Catch Up', 'Planning', 'Board', 'Statistics', 'Scenario']) {
    for (const configProfile of [
        { name: 'is delayed', delayed: true },
        { name: 'reports unavailable capability', boardCapability: false },
        { name: 'fails to load', configStatus: 503 },
    ]) {
        test(`selector config matrix: ${modeName} remains operable when Board config ${configProfile.name}`, async ({ page }) => {
            let releaseConfig;
            const configResponseGate = configProfile.delayed
                ? new Promise(resolve => { releaseConfig = resolve; })
                : null;
            const requestLog = [];
            const requests = [];
            const sprints = [
                { id: selectedSprintId, name: selectedSprintName, state: 'active' },
                { id: 34624, name: '2026Q2 Sprint 41', state: 'active' },
            ];
            const initialPrefs = selectorModePrefs(modeName);

            try {
                if (configProfile.delayed) {
                    await installBoardFixture(page, {
                        strictBoard: true,
                        sourceBundle: true,
                        requests,
                        requestLog,
                        sprints,
                        configResponseGate,
                    });
                    await page.addInitScript(({ initialPrefs }) => {
                        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
                            selectedView: 'eng',
                            selectedSprint: 34625,
                            sprintName: '2026Q2 Sprint 42',
                            activeGroupId: 'grp-default',
                            showAlertsPanel: false,
                            ...initialPrefs,
                        }));
                    }, { initialPrefs });
                    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
                    await expectConfigBootstrapHoldsJiraWork(page, () => requests);
                    releaseConfig();
                } else {
                    await openBoard(page, {
                        strictBoard: true,
                        sourceBundle: true,
                        requests,
                        requestLog,
                        sprints,
                        boardCapability: configProfile.boardCapability,
                        configStatus: configProfile.configStatus,
                        initialPrefs,
                        expectBoardColumns: modeName === 'Board',
                    });
                }

                const modes = page.getByRole('radiogroup', { name: 'ENG view mode' });
                const activeMode = modes.getByRole('radio', { name: modeName, exact: true });
                if (await activeMode.getAttribute('aria-checked') !== 'true') await activeMode.click();
                await expect(activeMode).toHaveAttribute('aria-checked', 'true');
                if (modeName === 'Statistics') {
                    await expectOneStatsSprintReload(requestLog, selectedSprintId, 0);
                }
                const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
                await expect(trigger).toBeEnabled();
                await trigger.click();
                await page.getByRole('option', { name: '2026Q2 Sprint 41', exact: true }).click();
                await expect(trigger).toContainText('2026Q2 Sprint 41');
                await expect.poll(() => page.evaluate(() => JSON.parse(
                    localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'
                ).selectedSprint)).toBe(34624);

                if (modeName === 'Statistics') {
                    await expectOneStatsSprintReload(requestLog, 34624, 1, { refresh: true });
                    expect(ordinarySprintRequests(requestLog, 34624)).toEqual([]);
                } else {
                    await expect.poll(() => requestLog.some(({ url, method }) => {
                        const parsed = new URL(url);
                        return method === 'GET'
                            && parsed.pathname === '/api/tasks-with-team-name'
                            && parsed.searchParams.get('sprint') === '34624';
                    })).toBe(true);
                }
                if (modeName === 'Board' && configProfile.delayed) {
                    expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toEqual([]);
                }
                if (modeName === 'Scenario') {
                    expect(requestLog.filter(({ url, method }) => (
                        method !== 'GET' && new URL(url).pathname.startsWith('/api/scenario')
                    ))).toEqual([]);
                }
            } finally {
                releaseConfig?.();
            }
        });
    }
}

test('selector analytics: accepted Board scope emits once and search or reselect emits nothing', async ({ page }) => {
    const requests = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requests,
        analyticsEnabled: true,
    });
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).some(entry => (
        entry?.event_name === 'page_view'
    )))).toBe(true);
    await page.evaluate(() => { window.dataLayer.length = 0; });

    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
    await trigger.click();
    const combobox = page.getByRole('combobox', { name: 'Filter sprints', exact: true });
    await combobox.fill('Component');
    await waitTwoFrames(page);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'filter_changed'
    )))).toEqual([]);

    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'filter_changed'
    )).length)).toBe(1);
    const events = await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'filter_changed'
    )));
    expect(events).toEqual([expect.objectContaining({
        event: 'userevent',
        trigger: 'userevent',
        event_type: 'event',
        event_name: 'filter_changed',
        feature_name: 'dashboard',
        filter_type: 'sprint',
        source_surface: 'board',
        scope_type: 'component',
        sprint_selection_state: 'component',
    })]);
    expect(Object.values(events[0]).some(value => String(value).includes('34625'))).toBe(false);

    await trigger.click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await waitTwoFrames(page);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'filter_changed'
    )).length)).toBe(1);
    expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
});

test('selector blocked state: Refresh retries configuration once and admin action opens Scope projects', async ({ page }) => {
    const requestLog = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requestLog,
        selectedProjects: [],
        savedBoardId: '',
    });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    const initialConfigReads = requestLog.filter(({ url }) => new URL(url).pathname === '/api/config').length;
    const initialGroupReads = requestLog.filter(({ url }) => new URL(url).pathname === '/api/groups-config').length;

    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).first();
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect.poll(() => requestLog.filter(({ url }) => new URL(url).pathname === '/api/config').length)
        .toBe(initialConfigReads + 1);
    await expect.poll(() => requestLog.filter(({ url }) => new URL(url).pathname === '/api/groups-config').length)
        .toBe(initialGroupReads + 1);
    expect(requestLog.filter(({ url }) => new URL(url).pathname === '/api/eng/board')).toEqual([]);

    await page.getByRole('button', { name: 'Select Jira projects', exact: true }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await expect(page.locator('#admin-settings-scope-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-settings-scope-panel')).toBeVisible();
});

test('selector blocked state: configuration error action coordinates one retry', async ({ page }) => {
    const requestLog = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requestLog,
        boardCapability: null,
        expectBoardColumns: false,
    });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    const initialConfigReads = requestLog.filter(({ url }) => new URL(url).pathname === '/api/config').length;
    const initialGroupReads = requestLog.filter(({ url }) => new URL(url).pathname === '/api/groups-config').length;
    await page.getByRole('button', { name: 'Retry configuration', exact: true }).click();
    await expect.poll(() => requestLog.filter(({ url }) => new URL(url).pathname === '/api/config').length)
        .toBe(initialConfigReads + 1);
    await expect.poll(() => requestLog.filter(({ url }) => new URL(url).pathname === '/api/groups-config').length)
        .toBe(initialGroupReads + 1);
    expect(requestLog.filter(({ url }) => new URL(url).pathname === '/api/eng/board')).toEqual([]);
});

test('selector blocked state: non-admin project setup gives administrator guidance only', async ({ page }) => {
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        selectedProjects: [],
        savedBoardId: '',
        userCanEditSettings: false,
        settingsAdminOnly: true,
    });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'All work', exact: true }).click();
    const status = page.getByRole('status', { name: 'Board scope status', exact: true });
    await expect(status).toContainText('Select Jira projects or a Jira source Board before loading this scope.');
    await expect(status).toContainText('Ask a workspace tool administrator to configure Jira scope.');
    await expect(status.getByRole('button', { name: 'Select Jira projects' })).toHaveCount(0);
    await waitTwoFrames(page);
    await page.screenshot({ path: path.join(screenshotDir, 'semantic-selector-blocked.png'), animations: 'disabled' });
});

test('selector blocked state: All work requires Department membership', async ({ page }) => {
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        groups: [{
            id: 'grp-default',
            name: 'Default',
            teamIds: [],
            missingInfoComponents: [],
            board: { columns: BOARD_COLUMNS },
        }],
        expectBoardColumns: false,
    });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'All work', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Board scope status', exact: true })).toContainText(
        'Add Teams or Components to this Department to use All work.'
    );
});

test('selector blocked state: Component setup opens Department Team groups', async ({ page }) => {
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        groups: [{
            id: 'grp-default',
            name: 'Default',
            teamIds: ['team-alpha'],
            teamLabels: { 'team-alpha': 'Alpha Team' },
            board: { columns: BOARD_COLUMNS },
        }],
    });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await page.getByRole('button', { name: 'Add Components', exact: true }).click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Departments', exact: true })).toHaveClass(/active/);
    await expect(dialog.getByRole('tab', { name: 'Team groups', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('selector blocked state: zero Departments action opens Department Team groups', async ({ page }) => {
    await openBoard(page, { strictBoard: true, sourceBundle: true, groups: [] });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await page.getByRole('button', { name: 'Choose a Department', exact: true }).click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Departments', exact: true })).toHaveClass(/active/);
    await expect(dialog.getByRole('tab', { name: 'Team groups', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('selector compact surface: remount closes stale panel and preserves geometry and hit testing', async ({ page }) => {
    await openBoard(page, { strictBoard: true, sourceBundle: true, ...FALLBACK_VIEWPORT, reducedMotion: true });
    const mainTrigger = page.locator('.view-selector').getByRole('button', { name: 'Select sprint', exact: true });
    const mainGeometry = await mainTrigger.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const icon = node.querySelector('svg').getBoundingClientRect();
        return { width: rect.width, height: rect.height, iconWidth: icon.width, iconHeight: icon.height };
    });
    await mainTrigger.click();
    await expect(page.getByRole('listbox', { name: 'Sprint options', exact: true })).toHaveCount(1);

    await page.evaluate(() => window.scrollTo(0, 500));
    const compactHeader = page.locator('.compact-sticky-header.is-visible');
    await expect(compactHeader).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Sprint options', exact: true })).toHaveCount(0);
    const compactTrigger = compactHeader.getByRole('button', { name: 'Select sprint', exact: true });
    const compactGeometry = await compactTrigger.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const icon = node.querySelector('svg').getBoundingClientRect();
        return { width: rect.width, height: rect.height, iconWidth: icon.width, iconHeight: icon.height };
    });
    expect(compactGeometry.height).toBeCloseTo(mainGeometry.height, 0);
    expect(compactGeometry.iconWidth).toBeCloseTo(mainGeometry.iconWidth, 1);
    expect(compactGeometry.iconHeight).toBeCloseTo(mainGeometry.iconHeight, 1);

    await compactTrigger.click();
    const listbox = page.getByRole('listbox', { name: 'Sprint options', exact: true });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option')).toHaveCount(5);
    expect(await listbox.getByRole('option').evaluateAll(options => options.every(option => (
        option.id.startsWith('sprint-compact-option-')
    )))).toBe(true);
    const openGeometry = await compactHeader.locator('.sprint-dropdown').evaluate(root => {
        const rootRect = root.getBoundingClientRect();
        const toggle = root.querySelector('.sprint-dropdown-toggle').getBoundingClientRect();
        const panel = root.querySelector('.sprint-dropdown-panel').getBoundingClientRect();
        const list = root.querySelector('.sprint-dropdown-list');
        const optionNodes = [...root.querySelectorAll('.sprint-dropdown-option')];
        const option = optionNodes[0].getBoundingClientRect();
        const hit = document.elementFromPoint(option.left + option.width / 2, option.top + option.height / 2);
        return {
            rootWidth: rootRect.width,
            toggleWidth: toggle.width,
            panelWidth: panel.width,
            panelLeft: panel.left,
            panelRight: panel.right,
            viewportWidth: window.innerWidth,
            listHorizontalOverflow: list.scrollWidth - list.clientWidth,
            optionsContained: optionNodes.every(node => {
                const rect = node.getBoundingClientRect();
                return rect.left >= panel.left && rect.right <= panel.right;
            }),
            hitOption: Boolean(hit?.closest('.sprint-dropdown-option')),
            panelZ: Number(getComputedStyle(root.querySelector('.sprint-dropdown-panel')).zIndex),
            boardZ: Number.parseFloat(getComputedStyle(document.querySelector('.eng-board')).zIndex) || 0,
        };
    });
    expect(openGeometry.panelWidth).toBeCloseTo(openGeometry.toggleWidth, 0);
    expect(openGeometry.panelLeft).toBeGreaterThanOrEqual(0);
    expect(openGeometry.panelRight).toBeLessThanOrEqual(openGeometry.viewportWidth);
    expect(openGeometry.listHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(openGeometry.optionsContained).toBe(true);
    expect(openGeometry.hitOption).toBe(true);
    expect(openGeometry.panelZ).toBeGreaterThan(openGeometry.boardZ);
    await page.screenshot({ path: path.join(screenshotDir, 'semantic-selector-compact.png'), animations: 'disabled' });
});

test('fallback authority endpoints mirror saved Board-only bootstrap revision and source', async ({ page }) => {
    await installBoardFixture(page, { sourceBundle: true, strictBoard: true, selectedProjects: [], savedBoardId: '42' });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const responses = await page.evaluate(async () => {
        const [projectsResponse, boardResponse] = await Promise.all([
            fetch('/api/projects/selected'), fetch('/api/board-config'),
        ]);
        return { projects: await projectsResponse.json(), board: await boardResponse.json() };
    });

    expect(responses.projects).toMatchObject({
        selected: [], configRevision: 1,
    });
    expect(responses.board).toMatchObject({
        boardId: '42', boardName: 'Synthetic Board', source: 'config', configRevision: 1,
    });
});

const boardAuthorityReadinessProfiles = [
    {
        name: 'saved projects',
        selectedProjects: [{ key: 'PLAT', type: 'product' }],
        savedBoardId: '',
        component: { ready: true },
        all_work: { ready: true },
    },
    {
        name: 'saved source Board',
        selectedProjects: [],
        savedBoardId: '42',
        component: { ready: true },
        all_work: { ready: true },
    },
    {
        name: 'missing authority',
        selectedProjects: [],
        savedBoardId: '',
        component: { reason: 'Select Jira projects or a Jira source Board before loading this scope.' },
        all_work: { reason: 'Select Jira projects or a Jira source Board before loading this scope.' },
    },
    {
        name: 'missing Department columns',
        board: { columns: [] },
        expectBoardColumns: false,
        component: { reason: 'Configure Board columns for this Department.' },
        all_work: { reason: 'Configure Board columns for this Department.' },
    },
    {
        name: 'Team-only Department',
        groups: [{
            id: 'grp-default',
            name: 'Default',
            teamIds: ['team-alpha'],
            teamLabels: { 'team-alpha': 'Alpha Team' },
            missingInfoComponents: [],
            board: { columns: BOARD_COLUMNS },
        }],
        component: { reason: 'Add Components to this Department to use Component scope.' },
        all_work: { ready: true },
    },
    {
        name: 'Components-only Department',
        groups: [{
            id: 'grp-default',
            name: 'Default',
            teamIds: [],
            teamLabels: {},
            missingInfoComponents: ['Platform'],
            board: { columns: BOARD_COLUMNS },
        }],
        expectBoardColumns: false,
        component: { ready: true },
        all_work: { ready: true },
    },
    {
        name: 'Department without membership',
        groups: [{
            id: 'grp-default',
            name: 'Default',
            teamIds: [],
            teamLabels: {},
            missingInfoComponents: [],
            board: { columns: BOARD_COLUMNS },
        }],
        expectBoardColumns: false,
        component: { reason: 'Add Components to this Department to use Component scope.' },
        all_work: { reason: 'Add Teams or Components to this Department to use All work.' },
    },
    {
        name: 'configuration pending',
        configPending: true,
        component: { ready: true },
        all_work: { ready: true },
    },
    {
        name: 'configuration error',
        configStatus: 503,
        component: { reason: 'Board configuration could not be loaded.' },
        all_work: { reason: 'Board configuration could not be loaded.' },
    },
    {
        name: 'false capability',
        boardCapability: false,
        component: { reason: 'Cross-sprint Board is unavailable in this environment. Choose a Sprint to continue.' },
        all_work: { reason: 'Cross-sprint Board is unavailable in this environment. Choose a Sprint to continue.' },
    },
    {
        name: 'no selected Department',
        groups: [],
        expectBoardColumns: false,
        component: { reason: 'Choose a Department to use this Board scope.' },
        all_work: { reason: 'Choose a Department to use this Board scope.' },
    },
];

for (const profile of boardAuthorityReadinessProfiles) {
    for (const scopeProfile of [
        { scope: 'component', label: 'Component' },
        { scope: 'all_work', label: 'All work' },
    ]) {
        test(`selector Board matrix: ${profile.name} × ${scopeProfile.label}`, async ({ page }) => {
            let releaseConfig;
            const configResponseGate = profile.configPending
                ? new Promise(resolve => { releaseConfig = resolve; })
                : null;
            const requestLog = [];
            const fixtureOptions = {
                strictBoard: true,
                sourceBundle: true,
                requestLog,
                selectedProjects: profile.selectedProjects,
                savedBoardId: profile.savedBoardId,
                board: profile.board,
                groups: profile.groups,
                boardCapability: profile.boardCapability,
                configStatus: profile.configStatus,
                configResponseGate,
            };

            try {
                if (profile.configPending) {
                    await installBoardFixture(page, fixtureOptions);
                    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
                        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
                            selectedView: 'eng',
                            selectedSprint: selectedSprintId,
                            sprintName: selectedSprintName,
                            activeGroupId: 'grp-default',
                            showBoard: true,
                            showPlanning: false,
                            showScenario: false,
                            showAlertsPanel: false,
                        }));
                    }, { selectedSprintId, selectedSprintName });
                    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
                    await expectConfigBootstrapHoldsJiraWork(page, () => requestLog.map(({ url }) => new URL(url).pathname));
                    releaseConfig();
                    releaseConfig = null;
                    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
                } else {
                    await openBoard(page, {
                        ...fixtureOptions,
                        expectBoardColumns: profile.expectBoardColumns ?? true,
                    });
                }

                const boardRequests = () => requestLog.filter(({ url, method }) => (
                    method === 'GET' && new URL(url).pathname === '/api/eng/board'
                ));
                const ordinaryRequests = () => requestLog.filter(({ url, method }) => (
                    method === 'GET' && new URL(url).pathname === '/api/tasks-with-team-name'
                ));
                const ordinaryCountBeforeSelection = ordinaryRequests().length;
                const expectation = profile[scopeProfile.scope];
                const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
                await expect(trigger).toBeEnabled();
                await trigger.click();
                await page.getByRole('option', { name: scopeProfile.label, exact: true }).click();
                await expect(trigger).toHaveText(scopeProfile.label);

                if (expectation.ready) {
                    await expect.poll(() => boardRequests().length).toBe(1);
                    const strictRequest = new URL(boardRequests()[0].url);
                    expect(strictRequest.searchParams.get('scope')).toBe(scopeProfile.scope);
                    expect(strictRequest.searchParams.has('sprintId')).toBe(false);
                    const card = page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]');
                    await expect(card).toBeVisible();
                    await expect(card).toContainText('Strict Board epic');
                    await expect(card).toContainText(/1 work item/i);
                    await waitTwoFrames(page);
                    expect(boardRequests()).toHaveLength(1);
                    expect(ordinaryRequests()).toHaveLength(ordinaryCountBeforeSelection);
                    return;
                }

                await expect(page.getByRole('status', { name: 'Board scope status', exact: true }))
                    .toContainText(expectation.reason);
                await waitTwoFrames(page);
                expect(boardRequests()).toHaveLength(0);
                expect(ordinaryRequests()).toHaveLength(ordinaryCountBeforeSelection);
                await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toHaveCount(0);
                await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toHaveCount(0);
            } finally {
                releaseConfig?.();
            }
        });
    }
}
for (const draftCase of [
    {
        name: 'project removal', selectedProjects: [{ key: 'PLAT', type: 'product' }], savedBoardId: '',
        edit: async dialog => {
            await dialog.getByRole('tab', { name: 'Scope projects' }).click();
            await dialog.getByRole('button', { name: 'Remove product project PLAT' }).click();
            await expect(dialog.getByText('No product projects.')).toBeVisible();
        },
    },
    {
        name: 'Sprint Board clearing', selectedProjects: [], savedBoardId: '42',
        edit: async dialog => {
            await dialog.getByRole('tab', { name: 'Jira source' }).click();
            await dialog.getByRole('button', { name: 'Clear sprint board' }).click();
            await expect(dialog.getByText('No board selected (fallback mode).')).toBeVisible();
        },
    },
]) {
    test(`unsaved Jira source ${draftCase.name} does not revoke persisted strict scope authority`, async ({ page }) => {
        await openBoard(page, { strictBoard: true, sourceBundle: true,
            selectedProjects: draftCase.selectedProjects, savedBoardId: draftCase.savedBoardId });
        await page.getByRole('button', { name: 'Manage team groups' }).click();
        const dialog = page.getByRole('dialog').first();
        await dialog.getByRole('button', { name: 'Admin' }).click();
        await draftCase.edit(dialog);

        await page.locator('.sprint-dropdown-toggle[aria-label="Select sprint"]').first().dispatchEvent('click');
        const componentOption = page.getByRole('option', { name: 'Component', exact: true });
        const allWorkOption = page.getByRole('option', { name: 'All work', exact: true });
        await expect(page.locator(`#${await componentOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
        await expect(page.locator(`#${await allWorkOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
    });
}

for (const draftCase of [
    {
        name: 'project addition', tab: 'Scope projects',
        edit: async dialog => {
            const search = dialog.getByPlaceholder('Search projects to add...');
            await search.fill('DRAFT');
            await dialog.locator('.project-result-item, .team-search-result-item').filter({ hasText: 'DRAFT' })
                .getByRole('button', { name: 'Product' }).click();
            await expect(dialog.getByRole('button', { name: 'Remove product project DRAFT' })).toBeVisible();
        },
    },
    {
        name: 'Sprint Board addition', tab: 'Jira source',
        edit: async dialog => {
            const search = dialog.getByPlaceholder('Search boards...');
            await search.fill('Draft');
            await dialog.locator('.team-search-result-item').filter({ hasText: 'Draft Board' }).click();
            await expect(dialog.getByRole('button', { name: 'Clear sprint board' })).toBeVisible();
        },
    },
]) {
    test(`unsaved Jira source ${draftCase.name} cannot grant strict scope authority`, async ({ page }) => {
        const requests = [];
        await openBoard(page, { strictBoard: true, sourceBundle: true, requests,
            selectedProjects: [], savedBoardId: '' });
        await page.getByRole('button', { name: 'Manage team groups' }).click();
        const dialog = page.getByRole('dialog').first();
        await dialog.getByRole('button', { name: 'Admin' }).click();
        await dialog.getByRole('tab', { name: draftCase.tab }).click();
        await draftCase.edit(dialog);

        await page.locator('.sprint-dropdown-toggle[aria-label="Select sprint"]').first().dispatchEvent('click');
        const panel = page.locator('.sprint-dropdown-panel');
        const componentOption = panel.getByRole('option', { name: 'Component', exact: true });
        await expect(componentOption).not.toHaveAttribute('aria-disabled');
        await expect(page.locator(`#${await componentOption.getAttribute('aria-describedby')}`)).toHaveText('Setup needed');
        await componentOption.dispatchEvent('click');
        await expect(page.getByRole('status', { name: 'Board scope status', exact: true })).toContainText(
            'Select Jira projects or a Jira source Board before loading this scope.'
        );
        await page.getByRole('button', { name: 'Select sprint', exact: true }).first().dispatchEvent('click');
        const allWorkOption = page.getByRole('option', { name: 'All work', exact: true });
        await expect(allWorkOption).not.toHaveAttribute('aria-disabled');
        await expect(page.locator(`#${await allWorkOption.getAttribute('aria-describedby')}`)).toHaveText('Setup needed');
        await allWorkOption.dispatchEvent('click');
        await expect(page.getByRole('button', { name: 'Select sprint', exact: true }).first()).toContainText('All work');
        await expect(page.getByRole('status', { name: 'Board scope status', exact: true })).toContainText(
            'Select Jira projects or a Jira source Board before loading this scope.'
        );
        await waitTwoFrames(page);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
    });
}

test('Board to Planning to Board preserves the saved Sprint snapshot without strict or duplicate task loads', async ({ page }) => {
    const requests = [];
    await openBoard(page, { strictBoard: true, sourceBundle: true, requests });
    const taskRequestCount = requests.filter(path => path === '/api/tasks-with-team-name').length;
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();

    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Planning' }).click();
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board' }).click();
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await waitTwoFrames(page);

    expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
    expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(taskRequestCount);
});

test('Board adds Component and All work to the existing Sprint selector without another scope control', async ({ page }) => {
    const requests = [];
    await openBoard(page, { strictBoard: true, requests, sourceBundle: true, configDelayMs: 250 });

    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await expect(page.locator('.eng-filter-bar').getByRole('button', { name: 'All work' })).toHaveCount(0);
    const sprintControl = page.getByRole('button', { name: 'Select sprint' }).first();
    await expect(sprintControl).toContainText(selectedSprintName);
    await page.screenshot({ path: path.join(screenshotDir, 'sprint-reuses-catch-up.png'), animations: 'disabled' });
    expect(requests.filter((path) => path === '/api/tasks-with-team-name').length).toBeGreaterThan(0);
    expect(requests.filter((path) => path.startsWith('/api/eng/board?')).length).toBe(0);

    await sprintControl.click();
    const scopeOptions = page.locator('.sprint-dropdown-panel .sprint-dropdown-option');
    await expect(scopeOptions.nth(0)).toHaveAccessibleName('All work');
    await expect(scopeOptions.nth(1)).toHaveAccessibleName('Component');
    await expect(scopeOptions.nth(2)).toContainText('2026Q2 Sprint 41');
    await page.screenshot({ path: path.join(screenshotDir, 'three-scope-sprint-selector.png'), animations: 'disabled' });
    await scopeOptions.nth(1).click();
    await expect.poll(() => requests.some((path) => path.includes('scope=component'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText('Component');
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'component-in-sprint-selector.png'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Select sprint' }).first().click();
    await page.getByText('All work', { exact: true }).first().click();
    await expect.poll(() => requests.some((path) => path.includes('scope=all_work'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText('All work');
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'all-work-in-sprint-selector.png'), animations: 'disabled' });
    const allWorkRequestCount = requests.filter((requestPath) => requestPath.includes('scope=all_work')).length;

    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
    await expect(page.locator('.task-item[data-task-key="PLAT-1-1"]')).toBeVisible();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board' }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
    await settle(page);
    expect(requests.filter((requestPath) => requestPath.includes('scope=all_work'))).toHaveLength(allWorkRequestCount);
});

test('catalog identity: saved label is visible but cannot authorize ENG before validation', async ({ page }) => {
    let activeSprintGate = null;
    let releaseSprints;
    const requests = [];
    await installBoardFixture(page, {
        requests, sourceBundle: true, strictBoard: true,
        sprintResponseGate: () => activeSprintGate,
    });
    await page.addInitScript(({ selectedSprintId }) => {
        if (localStorage.getItem('jira_dashboard_ui_prefs_v1')) return;
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
    await expect.poll(() => page.evaluate(() => JSON.parse(
        localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}',
    ).sprintName)).toBe(selectedSprintName);
    await expect.poll(() => page.evaluate(selectedSprintId => JSON.parse(
        localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}',
    ).sprintCatalog?.sprints?.find(sprint => String(sprint.id) === String(selectedSprintId))?.name, selectedSprintId)).toBe(selectedSprintName);

    activeSprintGate = new Promise(resolve => { releaseSprints = resolve; });
    requests.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });

    const sprintControl = page.getByRole('button', { name: 'Select sprint' }).first();
    await expect(sprintControl).toContainText(selectedSprintName);
    await expect(sprintControl).toHaveAttribute('aria-disabled', 'true');
    await expect.poll(() => requests.filter(path => path === '/api/sprints').length).toBe(1);
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toHaveCount(0);
    await waitTwoFrames(page);
    expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(0);
    expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
    await page.screenshot({ path: path.join(screenshotDir, 'cached-sprint-before-catalog.png'), animations: 'disabled' });

    releaseSprints();
    await expect(sprintControl).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await sprintControl.click();
    const allWorkOption = page.getByRole('option', { name: 'All work', exact: true });
    const componentOption = page.getByRole('option', { name: 'Component', exact: true });
    await expect(page.locator(`#${await allWorkOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
    await expect(page.locator(`#${await componentOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
    await allWorkOption.click();
    await expect.poll(() => requests.filter(path => path.includes('scope=all_work')).length).toBe(1);
});

test('catalog identity: removed Board 409 clears authority but keeps the saved display label', async ({ page }) => {
    const requestUrls = [];
    await installBoardFixture(page, {
        sourceBundle: true,
        strictBoard: true,
        savedBoardId: '42',
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async () => ({
            status: 409,
            body: { error: 'sprint_board_required' },
        }),
    });
    await page.addInitScript(({ selectedSprintId, selectedSprintName, source }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true,
            sprintCatalog: {
                version: 2, identity: source.identity, cachedAt: Date.now(),
                validatedAt: '2026-09-14T12:00:30Z', catalogVersion: 'old-version',
                sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            },
        }));
    }, { selectedSprintId, selectedSprintName, source: SPRINT_SOURCE_A });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
    await expect(trigger).toContainText(selectedSprintName);
    await expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Choose a Jira source Board in Settings.').first()).toBeVisible();
    expect(requestUrls.filter(value => value.startsWith('/api/sprints'))).toHaveLength(1);
    expect(requestUrls.filter(value => value.startsWith('/api/eng/board?'))).toHaveLength(0);
});

test('catalog identity: populated Board A to validated empty Board B clears choices and work', async ({ page }) => {
    const requestUrls = [];
    await openBoard(page, {
        sourceBundle: true,
        strictBoard: true,
        savedBoardId: '42',
        requestUrls,
        sprintCatalogSource: ({ requestIndex }) => requestIndex === 1 ? SPRINT_SOURCE_A : SPRINT_SOURCE_B,
        sprintResponder: async ({ requestIndex }) => ({ body: requestIndex === 1
            ? sprintCatalogEnvelope()
            : sprintCatalogEnvelope({ source: SPRINT_SOURCE_B, sprintList: [], catalogVersion: 'empty-board-b' }) }),
    });
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => requestUrls.filter(value => value.startsWith('/api/sprints')).length).toBe(2);
    const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
    await expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(
        localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}',
    ).sprintCatalog?.sprints?.length)).toBe(0);
});

test('catalog identity: auth context change invalidates shared snapshot locally until revalidated', async ({ page }) => {
    let releaseAuthContext;
    const authContextGate = new Promise(resolve => { releaseAuthContext = resolve; });
    const requestUrls = [];
    await openBoard(page, {
        sourceBundle: true,
        strictBoard: true,
        savedBoardId: '42',
        requestUrls,
        sprintCatalogSource: ({ requestIndex }) => requestIndex === 1 ? SPRINT_SOURCE_A : SPRINT_SOURCE_AUTH_B,
        sprintResponder: async ({ requestIndex }) => {
            if (requestIndex === 1) return { body: sprintCatalogEnvelope() };
            await authContextGate;
            return { body: sprintCatalogEnvelope({ source: SPRINT_SOURCE_AUTH_B, catalogVersion: 'auth-b-version' }) };
        },
    });
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();

    try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect.poll(() => requestUrls.filter(value => value.startsWith('/api/sprints')).length).toBe(2);
        const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(trigger).toContainText(selectedSprintName);
        await expect(trigger).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toHaveCount(0);
        releaseAuthContext();
        releaseAuthContext = null;
        await expect(trigger).toHaveAttribute('aria-disabled', 'false');
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    } finally {
        releaseAuthContext?.();
    }
});

test('catalog identity: delayed stale response is ignored after document generation changes', async ({ page }) => {
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const requestUrls = [];
    const replacementSprint = { id: 34626, name: '2026Q3 Sprint 43', state: 'active' };
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ requestIndex }) => {
            if (requestIndex === 1) {
                await firstGate;
                return { body: sprintCatalogEnvelope() };
            }
            return { body: sprintCatalogEnvelope({ sprintList: [replacementSprint], catalogVersion: 'replacement-version' }) };
        },
    });
    await page.addInitScript(() => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', activeGroupId: 'grp-default', showBoard: false,
        }));
    });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requestUrls.filter(value => value.startsWith('/api/sprints')).length).toBe(1);
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide'));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await expect.poll(() => requestUrls.filter(value => value.startsWith('/api/sprints')).length).toBe(2);
        const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(trigger).toContainText(replacementSprint.name);
        releaseFirst();
        releaseFirst = null;
        await waitTwoFrames(page);
        await expect(trigger).toContainText(replacementSprint.name);
        await trigger.click();
        await expect(page.getByRole('option', { name: selectedSprintName, exact: true })).toHaveCount(0);
    } finally {
        releaseFirst?.();
    }
});

test('catalog refresh: held worker completion updates an open menu', async ({ page }) => {
    let releaseCompletion;
    const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
    const requestUrls = [];
    const attemptId = '11111111-1111-4111-8111-111111111111';
    const completedSprint = { id: 34626, name: '2026Q3 Sprint 43', state: 'future' };
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ url, requestIndex }) => {
            if (requestIndex === 1) {
                return { body: sprintCatalogEnvelope({
                    state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: attemptId,
                    refreshStarted: true,
                }) };
            }
            expect(url.searchParams.get('completionAttemptId')).toBe(attemptId);
            expect(url.searchParams.get('catalogIdentity')).toBe(SPRINT_SOURCE_A.identity);
            expect(url.searchParams.has('refresh')).toBe(false);
            await completionGate;
            return { body: sprintCatalogEnvelope({
                sprintList: [
                    { id: selectedSprintId, name: selectedSprintName, state: 'active' },
                    completedSprint,
                ],
                state: 'fresh', refreshStatus: 'completed', refreshAttemptId: attemptId,
                catalogVersion: 'completed-version',
            }) };
        },
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42',
        activeGroupId: 'grp-default', showBoard: false,
    })));

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(trigger).toHaveAttribute('aria-disabled', 'false');
        await trigger.click();
        await expect(page.getByRole('option', { name: selectedSprintName, exact: true })).toBeVisible();
        await expect.poll(() => requestUrls.filter(value => value.includes('completionAttemptId=')).length, { timeout: 5000 }).toBe(1);
        releaseCompletion();
        releaseCompletion = null;
        await expect(page.getByRole('option', { name: completedSprint.name, exact: true })).toBeVisible();
        expect(requestUrls.filter(value => value.includes('refresh=true'))).toHaveLength(0);
        expect(requestUrls.filter(value => value.includes('completionAttemptId='))).toHaveLength(1);
    } finally {
        releaseCompletion?.();
    }
});

test('catalog refresh: manual refresh coalesces onto an ordinary pending attempt', async ({ page }) => {
    let releaseCompletion;
    const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
    const requestUrls = [];
    const attemptId = '11111111-1111-4111-8111-111111111111';
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ requestIndex }) => {
            if (requestIndex === 1) return { body: sprintCatalogEnvelope({
                state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: attemptId,
                refreshStarted: true,
            }) };
            await completionGate;
            return { body: sprintCatalogEnvelope({
                refreshStatus: 'completed', refreshAttemptId: attemptId,
                catalogVersion: 'coalesced-version',
            }) };
        },
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42',
        activeGroupId: 'grp-default', showBoard: false,
    })));

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requestUrls.filter(value => value.includes('completionAttemptId=')).length, { timeout: 5000 }).toBe(1);
        await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).first().click();
        expect(requestUrls.filter(value => (
            value.startsWith('/api/sprints?') && value.includes('refresh=true')
        ))).toHaveLength(0);
        releaseCompletion();
        releaseCompletion = null;
        await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toHaveAttribute('aria-disabled', 'false');
        expect(requestUrls.filter(value => value.includes('completionAttemptId='))).toHaveLength(1);
    } finally {
        releaseCompletion?.();
    }
});

test('catalog refresh: deadline exhausts without more reads', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-14T12:00:00Z') });
    const requestUrls = [];
    const attemptId = '11111111-1111-4111-8111-111111111111';
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ requestIndex }) => ({ body: sprintCatalogEnvelope({
            state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: attemptId,
            refreshStarted: requestIndex === 1,
        }) }),
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42',
        activeGroupId: 'grp-default', showBoard: false,
    })));
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requestUrls.filter(value => value.startsWith('/api/sprints')).length).toBe(1);
    await page.clock.runFor(80000);
    await expect(page.getByText('Sprint refresh is taking longer than expected. Retry.').first()).toBeVisible();
    const completionCount = requestUrls.filter(value => value.includes('completionAttemptId=')).length;
    expect(completionCount).toBeLessThanOrEqual(16);
    const settledCount = requestUrls.length;
    await page.clock.runFor(10000);
    expect(requestUrls).toHaveLength(settledCount);
});

test('catalog refresh: initial failed validated snapshot remains usable', async ({ page }) => {
    const requestUrls = [];
    await openBoard(page, {
        sourceBundle: true,
        strictBoard: true,
        savedBoardId: '42',
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async () => ({ body: sprintCatalogEnvelope({
            state: 'failed', refreshStatus: 'failed', refreshFailed: true,
        }) }),
    });

    const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
    await expect(trigger).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByText('Sprint refresh failed. Retry.').first()).toBeVisible();
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    expect(requestUrls.filter(value => value.startsWith('/api/eng/board?'))).toHaveLength(0);
});

test('catalog refresh: same-identity failure preserves validated choices and work', async ({ page }) => {
    const requestUrls = [];
    await openBoard(page, {
        sourceBundle: true,
        strictBoard: true,
        savedBoardId: '42',
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ requestIndex }) => ({ body: requestIndex === 1
            ? sprintCatalogEnvelope()
            : sprintCatalogEnvelope({
                state: 'failed', refreshStatus: 'failed', refreshFailed: true,
                catalogVersion: 'same-identity-failed-version',
            }) }),
    });
    const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).first();
    await refresh.click();
    await expect.poll(() => requestUrls.filter(value => (
        value.startsWith('/api/sprints?') && value.includes('refresh=true')
    )).length).toBe(1);
    await expect(page.getByText('Sprint refresh failed. Retry.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
});

test('catalog refresh: Retry sends exactly one forced initiating request', async ({ page }) => {
    const requestUrls = [];
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ url, requestIndex }) => {
            if (requestIndex === 1) {
                return {
                    status: 502,
                    body: {
                        error: 'sprint_catalog_unavailable',
                        cache: {
                            ...SPRINT_SOURCE_A, state: 'failed', refreshStatus: 'failed',
                            validatedAt: null, catalogVersion: null, refreshFailed: true,
                        },
                    },
                };
            }
            expect(url.searchParams.get('refresh')).toBe('true');
            expect(url.searchParams.has('completionAttemptId')).toBe(false);
            return { body: sprintCatalogEnvelope() };
        },
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', activeGroupId: 'grp-default', showBoard: false,
    })));
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const retry = page.getByRole('button', { name: 'Retry', exact: true }).first();
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => requestUrls.filter(value => value.includes('refresh=true')).length).toBe(1);
    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toHaveAttribute('aria-disabled', 'false');
    expect(requestUrls.filter(value => value.includes('refresh=true'))).toHaveLength(1);
});

test('catalog refresh: repeated manual clicks share one forced request', async ({ page }) => {
    let releaseForce;
    const forceGate = new Promise(resolve => { releaseForce = resolve; });
    const requestUrls = [];
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ url, requestIndex }) => {
            if (requestIndex === 1) return { body: sprintCatalogEnvelope() };
            expect(url.searchParams.get('refresh')).toBe('true');
            await forceGate;
            return { body: sprintCatalogEnvelope({ catalogVersion: 'manual-version' }) };
        },
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42',
        activeGroupId: 'grp-default', showBoard: false,
    })));

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
        const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).first();
        await refresh.click();
        await refresh.click();
        await expect.poll(() => requestUrls.filter(value => (
            value.startsWith('/api/sprints?') && value.includes('refresh=true')
        )).length).toBe(1);
        releaseForce();
        releaseForce = null;
        await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toHaveAttribute('aria-disabled', 'false');
        expect(requestUrls.filter(value => (
            value.startsWith('/api/sprints?') && value.includes('refresh=true')
        ))).toHaveLength(1);
    } finally {
        releaseForce?.();
    }
});

test('catalog identity: auth lock cancels held completion and disables the selector', async ({ page }) => {
    let releaseCompletion;
    const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
    const requestUrls = [];
    const attemptId = '11111111-1111-4111-8111-111111111111';
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ requestIndex }) => {
            if (requestIndex === 1) return { body: sprintCatalogEnvelope({
                state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: attemptId,
                refreshStarted: true,
            }) };
            await completionGate;
            return { body: sprintCatalogEnvelope({ catalogVersion: 'late-auth-version' }) };
        },
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42',
        activeGroupId: 'grp-default', showBoard: false,
    })));
    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requestUrls.filter(value => value.includes('completionAttemptId=')).length, { timeout: 5000 }).toBe(1);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('jep:authentication-required', {
            detail: { locked: true, loginUrl: '/login?reason=session_expired' },
        })));
        await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toHaveAttribute('aria-disabled', 'true');
        releaseCompletion();
        releaseCompletion = null;
        const settledCount = requestUrls.length;
        await page.waitForTimeout(1200);
        expect(requestUrls).toHaveLength(settledCount);
        await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toHaveAttribute('aria-disabled', 'true');
    } finally {
        releaseCompletion?.();
    }
});

test('catalog refresh: document lifetime cancellation ignores held completion', async ({ page }) => {
    let releaseCompletion;
    const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
    const requestUrls = [];
    const attemptId = '11111111-1111-4111-8111-111111111111';
    const lateSprint = { id: 34626, name: 'Late completed sprint', state: 'future' };
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprintCatalogSource: SPRINT_SOURCE_A,
        sprintResponder: async ({ requestIndex }) => {
            if (requestIndex === 1) return { body: sprintCatalogEnvelope({
                state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: attemptId,
                refreshStarted: true,
            }) };
            await completionGate;
            return { body: sprintCatalogEnvelope({
                sprintList: [lateSprint], refreshStatus: 'completed', refreshAttemptId: attemptId,
                catalogVersion: 'late-lifetime-version',
            }) };
        },
    });
    await page.addInitScript(() => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: 34625, sprintName: '2026Q2 Sprint 42',
        activeGroupId: 'grp-default', showBoard: false,
    })));

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requestUrls.filter(value => value.includes('completionAttemptId=')).length, { timeout: 5000 }).toBe(1);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
        releaseCompletion();
        releaseCompletion = null;
        await waitTwoFrames(page);
        const trigger = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(trigger).toHaveAttribute('aria-disabled', 'true');
        await expect(trigger).not.toContainText(lateSprint.name);
        const settledCount = requestUrls.length;
        await page.waitForTimeout(1200);
        expect(requestUrls).toHaveLength(settledCount);
    } finally {
        releaseCompletion?.();
    }
});

test('saved Sprint Board authority stays guarded until a held sprint catalog is ready', async ({ page }) => {
    let releaseSprints;
    const sprintResponseGate = new Promise(resolve => { releaseSprints = resolve; });
    const requests = [];
    await installBoardFixture(page, { requests, sourceBundle: true, strictBoard: true,
        selectedProjects: [], savedBoardId: '42', sprintResponseGate });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requests.filter(path => path === '/api/sprints').length).toBe(1);
        const sprintControl = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(sprintControl).toContainText(selectedSprintName);
        await expect(sprintControl).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toHaveCount(0);
        await waitTwoFrames(page);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);

        releaseSprints();
        releaseSprints = null;
        await expect(sprintControl).toHaveAttribute('aria-disabled', 'false');
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await sprintControl.click();
        const panel = page.locator('.sprint-dropdown-panel');
        const allWorkOption = panel.getByRole('option', { name: 'All work', exact: true });
        const componentOption = panel.getByRole('option', { name: 'Component', exact: true });
        await expect(page.locator(`#${await allWorkOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
        await expect(page.locator(`#${await componentOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
        await componentOption.click();
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
    } finally {
        releaseSprints?.();
    }
});

test('delayed saved config holds the sprint catalog and every strict scope until it arrives', async ({ page }) => {
    let releaseConfig;
    const configResponseGate = new Promise(resolve => { releaseConfig = resolve; });
    const requests = [];
    await installBoardFixture(page, { requests, sourceBundle: true, strictBoard: true, configResponseGate });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expectConfigBootstrapHoldsJiraWork(page, () => requests);

        releaseConfig();
        releaseConfig = null;
        await expect.poll(() => requests.filter(path => path === '/api/sprints').length).toBe(1);
        const sprintControl = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(sprintControl).toHaveAttribute('aria-disabled', 'false');
        await sprintControl.click();
        const panel = page.locator('.sprint-dropdown-panel');
        const allWorkOption = panel.getByRole('option', { name: 'All work', exact: true });
        const componentOption = panel.getByRole('option', { name: 'Component', exact: true });
        await expect(page.locator(`#${await allWorkOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
        await expect(page.locator(`#${await componentOption.getAttribute('aria-describedby')}`)).toHaveText('Ready');
        await componentOption.click();
        await expect(sprintControl).toContainText('Component');
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
    } finally {
        releaseConfig?.();
    }
});

test('selector scheduling: ordinary load starts once the config bootstrap arrives, without a strict Board request', async ({ page }) => {
    let releaseConfig;
    const configResponseGate = new Promise(resolve => { releaseConfig = resolve; });
    const requests = [];
    await installBoardFixture(page, { requests, sourceBundle: true, strictBoard: true, configResponseGate });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expectConfigBootstrapHoldsJiraWork(page, () => requests);

        releaseConfig();
        releaseConfig = null;
        await expect.poll(() => requests.filter(path => path === '/api/tasks-with-team-name').length).toBe(2);
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
    } finally {
        releaseConfig?.();
    }
});

test('selector scheduling: blocked scope never falls back', async ({ page }) => {
    let releaseConfig;
    const configResponseGate = new Promise(resolve => { releaseConfig = resolve; });
    const requests = [];
    await installBoardFixture(page, {
        requests, sourceBundle: true, strictBoard: true, configResponseGate, selectedProjects: [],
    });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expectConfigBootstrapHoldsJiraWork(page, () => requests);

        releaseConfig();
        releaseConfig = null;
        await expect.poll(() => requests.filter(path => path === '/api/sprints').length).toBe(1);
        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await expect(trigger).toHaveAttribute('aria-disabled', 'false');
        await trigger.click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;
        await expect(page.getByRole('status', { name: 'Board scope status', exact: true })).toContainText(
            'Select Jira projects or a Jira source Board before loading this scope.'
        );
        await waitTwoFrames(page);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
    } finally {
        releaseConfig?.();
    }
});

test('selector scheduling: capability failure preserves intent', async ({ page }) => {
    let releaseConfig;
    const configResponseGate = new Promise(resolve => { releaseConfig = resolve; });
    const requests = [];
    await installBoardFixture(page, {
        requests, sourceBundle: true, strictBoard: true, configResponseGate, configStatus: 503,
    });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expectConfigBootstrapHoldsJiraWork(page, () => requests);

        // A failed config read clears the gate, so the ordinary catalog still loads.
        releaseConfig();
        releaseConfig = null;
        await expect.poll(() => requests.filter(path => path === '/api/sprints').length).toBe(1);
        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await expect(trigger).toHaveAttribute('aria-disabled', 'false');
        await trigger.click();
        await page.getByRole('option', { name: 'All work', exact: true }).click();
        const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;
        await expect(trigger).toContainText('All work');
        await expect(page.getByRole('status', { name: 'Board scope status', exact: true }))
            .toContainText('Board configuration could not be loaded.');
        await waitTwoFrames(page);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
    } finally {
        releaseConfig?.();
    }
});

test('selector scheduling: group revision retires old generation', async ({ page }) => {
    let releaseOldBoard;
    const oldBoardGate = new Promise(resolve => { releaseOldBoard = resolve; });
    const requests = [];
    await openBoard(page, {
        requests,
        sourceBundle: true,
        strictBoard: true,
        boardResponseGate: ({ requestIndex }) => requestIndex === 1 ? oldBoardGate : null,
        strictEpicKeyForRequest: ({ requestIndex }) => requestIndex === 1 ? 'STRICT-OLD' : 'STRICT-NEW',
    });

    try {
        await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);

        await page.getByRole('button', { name: 'Manage team groups', exact: true }).click();
        const dialog = page.getByRole('dialog').first();
        await dialog.getByRole('tab', { name: 'Boards', exact: true }).click();
        await dialog.locator('.board-column-name').first().fill('Backlog');
        await dialog.getByRole('button', { name: /^Save$/ }).click();

        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(2);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-NEW"]')).toBeVisible();
        releaseOldBoard();
        releaseOldBoard = null;
        await waitTwoFrames(page);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-OLD"]')).toHaveCount(0);
        expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(2);
    } finally {
        releaseOldBoard?.();
    }
});

for (const postSaveConfigRead of [
    { name: 'post-save config acceptance waits before replacement load', status: 200, authLocked: false },
    { name: 'post-save config failure retires affected generation', status: 503, authLocked: false },
    { name: 'post-save config 401 retires affected generation', status: 401, authLocked: true },
]) {
    test(`selector scheduling: ${postSaveConfigRead.name}`, async ({ page }) => {
        const group = (id, name) => ({
            id,
            name,
            teamIds: ['team-alpha'],
            teamLabels: { 'team-alpha': 'Alpha Team' },
            missingInfoComponents: ['Platform'],
            board: { columns: BOARD_COLUMNS },
        });
        let releaseOldBoard;
        const oldBoardGate = new Promise(resolve => { releaseOldBoard = resolve; });
        let releaseGroupPreferences;
        const groupPreferencesGate = new Promise(resolve => { releaseGroupPreferences = resolve; });
        let releasePostSaveConfig;
        const postSaveConfigGate = new Promise(resolve => { releasePostSaveConfig = resolve; });
        const requests = [];
        const performanceLoads = [];
        await openBoard(page, {
            requests,
            performanceLoads,
            sourceBundle: true,
            strictBoard: true,
            groups: [group('grp-default', 'Default'), group('grp-second', 'Second')],
            groupsSource: 'workspace_db',
            groupPreferences: {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                onboardingDone: true,
                visibleGroupIds: ['grp-default', 'grp-second'],
                effectiveVisibleGroupIds: ['grp-default', 'grp-second'],
                activeGroupId: 'grp-default',
            },
            boardResponseGate: ({ requestIndex }) => requestIndex === 1 ? oldBoardGate : null,
            strictEpicKeyForRequest: ({ requestIndex }) => requestIndex === 1 ? 'STRICT-SAVE-OLD' : 'STRICT-SAVE-NEW',
            groupPreferencesResponseGate: postSaveConfigRead.status === 200 ? groupPreferencesGate : null,
            configResponseGate: ({ requestIndex }) => requestIndex === 2 ? postSaveConfigGate : null,
            configStatus: ({ requestIndex }) => requestIndex === 2 ? postSaveConfigRead.status : 200,
        });

        try {
            const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
            await trigger.click();
            await page.getByRole('option', { name: 'Component', exact: true }).click();
            await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
            const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;

            await page.getByRole('button', { name: 'Manage team groups', exact: true }).click();
            const dialog = page.getByRole('dialog').first();
            if (postSaveConfigRead.status === 200) {
                await dialog.getByRole('tab', { name: 'Team groups', exact: true }).click();
                await dialog.getByRole('button', { name: 'Second', exact: true }).click();
                const visibility = dialog.getByRole('checkbox', { name: 'Show in Department selector', exact: true });
                await expect(visibility).toBeChecked();
                await visibility.uncheck();
            }
            await dialog.getByRole('tab', { name: 'Boards', exact: true }).click();
            if (postSaveConfigRead.status === 200) {
                await dialog.getByRole('button', { name: /^Default 7 columns$/ }).click();
            }
            await dialog.locator('.board-column-name').first().fill('Post-save backlog');
            await dialog.getByRole('button', { name: /^Save$/ }).click();

            if (postSaveConfigRead.status === 200) {
                await expect.poll(() => requests.filter(path => path === '/api/groups-preferences').length).toBe(1);
                await waitTwoFrames(page);
                expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
                expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
                releaseGroupPreferences();
                releaseGroupPreferences = null;
            }
            await expect.poll(() => requests.filter(path => path === '/api/config').length).toBe(2);
            await waitTwoFrames(page);
            expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
            expect(performanceLoads.filter(load => load.scopeType === 'component')).toHaveLength(0);

            releasePostSaveConfig();
            releasePostSaveConfig = null;
            if (postSaveConfigRead.status === 200) {
                await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(2);
                await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-SAVE-NEW"]')).toBeVisible();
            } else if (postSaveConfigRead.authLocked) {
                await expect(page.getByRole('alertdialog')).toContainText('Sign in required');
            } else {
                await expect(trigger).toContainText('Component');
                await expect(page.getByRole('status', { name: 'Board scope status', exact: true }))
                    .toContainText('Board configuration could not be loaded.');
            }

            releaseOldBoard();
            releaseOldBoard = null;
            await waitTwoFrames(page);
            await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-SAVE-OLD"]')).toHaveCount(0);
            expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);

            if (postSaveConfigRead.status === 200) {
                expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(2);
                await expect.poll(() => performanceLoads.filter(load => load.scopeType === 'component').length).toBe(1);
            } else {
                expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
                expect(performanceLoads.filter(load => load.scopeType === 'component')).toHaveLength(0);
            }

            if (postSaveConfigRead.status === 503) {
                await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).first().click();
                await expect.poll(() => requests.filter(path => path === '/api/config').length).toBe(3);
                await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(2);
                await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-SAVE-NEW"]')).toBeVisible();
                await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-SAVE-OLD"]')).toHaveCount(0);
            }
        } finally {
            releaseGroupPreferences?.();
            releasePostSaveConfig?.();
            releaseOldBoard?.();
        }
    });
}

test('selector scheduling: workspace combined save waits for config acceptance', async ({ page }) => {
    let releaseProjectSave;
    const projectSaveGate = new Promise(resolve => { releaseProjectSave = resolve; });
    let releaseBoardSave;
    const boardSaveGate = new Promise(resolve => { releaseBoardSave = resolve; });
    let releasePostSaveConfig;
    const postSaveConfigGate = new Promise(resolve => { releasePostSaveConfig = resolve; });
    const requests = [];
    const requestLog = [];
    const performanceLoads = [];
    await openBoard(page, {
        requests,
        requestLog,
        performanceLoads,
        sourceBundle: true,
        strictBoard: true,
        projectSaveResponseGate: projectSaveGate,
        boardConfigSaveResponseGate: boardSaveGate,
        configResponseGate: ({ requestIndex }) => requestIndex === 2 ? postSaveConfigGate : null,
        strictEpicKeyForRequest: ({ requestIndex }) => requestIndex === 1
            ? 'STRICT-WORKSPACE-OLD'
            : 'STRICT-WORKSPACE-NEW',
    });

    const strictRequests = () => requests.filter(path => path.includes('scope=component'));
    const postRequests = path => requestLog.filter(entry => (
        entry.method === 'POST' && new URL(entry.url).pathname === path
    ));

    try {
        await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-WORKSPACE-OLD"]')).toBeVisible();
        await expect.poll(() => performanceLoads.filter(load => load.scopeType === 'component').length).toBe(1);
        const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;

        await page.getByRole('button', { name: 'Manage team groups', exact: true }).click();
        const dialog = page.getByRole('dialog').first();
        await dialog.getByRole('button', { name: 'Admin', exact: true }).click();
        await dialog.getByRole('tab', { name: 'Scope projects', exact: true }).click();
        const projectSearch = dialog.getByPlaceholder('Search projects to add...');
        await projectSearch.fill('DRAFT');
        await dialog.locator('.project-result-item, .team-search-result-item').filter({ hasText: 'DRAFT' })
            .getByRole('button', { name: 'Product' }).click();
        await dialog.getByRole('tab', { name: 'Jira source', exact: true }).click();
        await dialog.getByPlaceholder('Search boards...').fill('Draft');
        await dialog.locator('.team-search-result-item').filter({ hasText: 'Draft Board' }).click();
        await dialog.getByRole('button', { name: /^Save$/ }).click();

        await expect.poll(() => postRequests('/api/projects/selected').length).toBe(1);
        await waitTwoFrames(page);
        expect(strictRequests()).toHaveLength(1);
        releaseProjectSave();
        releaseProjectSave = null;

        await expect.poll(() => postRequests('/api/board-config').length).toBe(1);
        await waitTwoFrames(page);
        expect(strictRequests()).toHaveLength(1);
        releaseBoardSave();
        releaseBoardSave = null;

        await expect.poll(() => requests.filter(path => path === '/api/config').length).toBe(2);
        await waitTwoFrames(page);
        expect(strictRequests()).toHaveLength(1);
        expect(performanceLoads.filter(load => load.scopeType === 'component')).toHaveLength(1);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);

        releasePostSaveConfig();
        releasePostSaveConfig = null;
        await expect.poll(() => strictRequests().length).toBe(2);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-WORKSPACE-NEW"]')).toBeVisible();
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-WORKSPACE-OLD"]')).toHaveCount(0);
        await expect.poll(() => performanceLoads.filter(load => load.scopeType === 'component').length).toBe(2);
        expect(postRequests('/api/projects/selected')).toHaveLength(1);
        expect(postRequests('/api/board-config')).toHaveLength(1);
        expect(requests.filter(path => path === '/api/config')).toHaveLength(2);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
    } finally {
        releaseProjectSave?.();
        releaseBoardSave?.();
        releasePostSaveConfig?.();
    }
});

for (const preferenceConfigRead of [
    { name: 'preference-only save preserves identical accepted generation', status: 200, authLocked: false },
    { name: 'preference-only save failure retires accepted generation', status: 503, authLocked: false },
    { name: 'preference-only save 401 gates accepted generation', status: 401, authLocked: true },
]) {
    test(`selector scheduling: ${preferenceConfigRead.name}`, async ({ page }) => {
        const group = (id, name) => ({
            id,
            name,
            teamIds: ['team-alpha'],
            teamLabels: { 'team-alpha': 'Alpha Team' },
            missingInfoComponents: ['Platform'],
            board: { columns: BOARD_COLUMNS },
        });
        let releasePostSaveConfig;
        const postSaveConfigGate = new Promise(resolve => { releasePostSaveConfig = resolve; });
        const requests = [];
        const requestLog = [];
        const performanceLoads = [];
        await openBoard(page, {
            requests,
            requestLog,
            performanceLoads,
            sourceBundle: true,
            strictBoard: true,
            groups: [group('grp-default', 'Default'), group('grp-second', 'Second')],
            groupsSource: 'workspace_db',
            groupPreferences: {
                customized: true,
                preferenceExists: true,
                onboardingRequired: false,
                onboardingDone: true,
                visibleGroupIds: ['grp-default', 'grp-second'],
                effectiveVisibleGroupIds: ['grp-default', 'grp-second'],
                activeGroupId: 'grp-default',
            },
            configResponseGate: ({ requestIndex }) => requestIndex === 2 ? postSaveConfigGate : null,
            configStatus: ({ requestIndex }) => requestIndex === 2 ? preferenceConfigRead.status : 200,
        });

        try {
            const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
            await trigger.click();
            await page.getByRole('option', { name: 'Component', exact: true }).click();
            const strictCard = page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]');
            await expect(strictCard).toBeVisible();
            await expect.poll(() => performanceLoads.filter(load => load.scopeType === 'component').length).toBe(1);
            const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;

            await page.getByRole('button', { name: 'Manage team groups', exact: true }).click();
            const dialog = page.getByRole('dialog').first();
            await dialog.getByRole('button', { name: 'Second', exact: true }).click();
            const visibility = dialog.getByRole('checkbox', { name: 'Show in Department selector', exact: true });
            await expect(visibility).toBeChecked();
            await visibility.uncheck();
            const requestCountBeforeSave = requestLog.length;
            await dialog.getByRole('button', { name: /^Save$/ }).click();

            await expect.poll(() => requests.filter(path => path === '/api/groups-preferences').length).toBe(1);
            await expect.poll(() => requests.filter(path => path === '/api/config').length).toBe(2);
            expect(requestLog.slice(requestCountBeforeSave)
                .filter(entry => entry.method === 'POST')
                .map(entry => new URL(entry.url).pathname)).toEqual(['/api/groups-preferences']);
            await waitTwoFrames(page);
            expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);

            releasePostSaveConfig();
            releasePostSaveConfig = null;
            if (preferenceConfigRead.status === 200) {
                await page.waitForLoadState('networkidle');
                await expect(strictCard).toBeVisible();
            } else if (preferenceConfigRead.authLocked) {
                await expect(page.getByRole('alertdialog')).toContainText('Sign in required');
            } else {
                await expect(trigger).toContainText('Component');
                await expect(page.getByRole('status', { name: 'Board scope status', exact: true }))
                    .toContainText('Board configuration could not be loaded.');
                await expect(strictCard).toHaveCount(0);
            }
            await waitTwoFrames(page);
            expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
            expect(performanceLoads.filter(load => load.scopeType === 'component')).toHaveLength(1);
            expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
        } finally {
            releasePostSaveConfig?.();
        }
    });
}

test('selector scheduling: Department change preserves intent and retires stale work', async ({ page }) => {
    const group = (id, name, components) => ({
        id,
        name,
        teamIds: ['team-alpha'],
        teamLabels: { 'team-alpha': 'Alpha Team' },
        missingInfoComponents: components,
        board: { columns: BOARD_COLUMNS },
    });
    let releaseOldBoard;
    const oldBoardGate = new Promise(resolve => { releaseOldBoard = resolve; });
    const requests = [];
    await openBoard(page, {
        requests,
        sourceBundle: true,
        strictBoard: true,
        groups: [group('grp-default', 'Default', ['Platform']), group('grp-invalid', 'Invalid', [])],
        boardResponseGate: ({ requestIndex }) => requestIndex === 1 ? oldBoardGate : null,
        strictEpicKeyForRequest: ({ requestIndex }) => requestIndex === 1 ? 'STRICT-OLD' : 'STRICT-NEW',
    });

    try {
        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await trigger.click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
        const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;

        const groupToggle = page.locator('.view-selector .group-dropdown-toggle');
        await groupToggle.click();
        await page.locator('.view-selector .group-dropdown-option', { hasText: 'Invalid' }).click();
        await expect(trigger).toContainText('Component');
        await expect(page.getByRole('status', { name: 'Board scope status', exact: true }))
            .toContainText('Add Components to this Department to use Component scope.');
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);

        await groupToggle.click();
        await page.locator('.view-selector .group-dropdown-option', { hasText: 'Default' }).click();
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(2);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-NEW"]')).toBeVisible();
        releaseOldBoard();
        releaseOldBoard = null;
        await waitTwoFrames(page);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-OLD"]')).toHaveCount(0);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
    } finally {
        releaseOldBoard?.();
    }
});

test('selector scheduling: incrementally delivered retired frames cannot publish or cache', async ({ page }) => {
    const requests = [];
    const performanceLoads = [];
    await installBoardFixture(page, {
        requests,
        performanceLoads,
        sourceBundle: true,
        strictBoard: true,
        strictEpicKeyForRequest: ({ requestIndex }) => requestIndex === 1
            ? 'STRICT-NEW-ALL'
            : 'STRICT-FRESH-COMPONENT',
    });
    await installIncrementalStrictBoardResponse(page, requests);
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
    await trigger.click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-PARTIAL-OLD"]')).toBeVisible();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-PARTIAL-OLD"]'))
        .toContainText('loaded so far');
    const ordinaryCountAtSelection = requests.filter(path => path === '/api/tasks-with-team-name').length;
    expect(requests.filter(path => path.includes('/api/eng/board?'))).toHaveLength(1);

    await trigger.click();
    await page.getByRole('option', { name: 'All work', exact: true }).click();
    await expect.poll(() => requests.filter(path => path.includes('/api/eng/board?')).length).toBe(2);
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-NEW-ALL"]')).toBeVisible();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-PARTIAL-OLD"]')).toHaveCount(0);

    const releaseResult = await page.evaluate(() => window.__releaseRetiredStrictFrames());
    expect(releaseResult.attempted).toBe(true);
    expect(releaseResult.cancelled).toBe(true);
    await waitTwoFrames(page);
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-NEW-ALL"]')).toBeVisible();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-PARTIAL-OLD"]')).toHaveCount(0);
    expect(performanceLoads.filter(load => load.scopeType === 'component')).toHaveLength(0);
    await expect.poll(() => performanceLoads.filter(load => load.scopeType === 'all_work').length).toBe(1);

    await trigger.click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await expect.poll(() => requests.filter(path => path.includes('/api/eng/board?')).length).toBe(3);
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-FRESH-COMPONENT"]')).toBeVisible();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-PARTIAL-OLD"]')).toHaveCount(0);
    await expect.poll(() => performanceLoads.filter(load => load.scopeType === 'component').length).toBe(1);
    expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCountAtSelection);
});

test('selector scheduling: Retry connection probes config once and hard reloads instead of rereading in place', async ({ page }) => {
    const requests = [];
    let documents = 0;
    page.on('request', request => {
        if (request.resourceType() === 'document') documents += 1;
    });
    await openBoard(page, {
        requests,
        sourceBundle: true,
        strictBoard: true,
        homeTokenDelayMs: 1500,
        homeTokenFailureCount: 1,
    });
    await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
    const requestsBefore = requests.length;
    const documentsBefore = documents;

    await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await expect.poll(() => documents).toBe(documentsBefore + 1);
    expect(requests.slice(requestsBefore)).toContain('/api/config');
    await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('jira_dashboard_connection_recovery_attempt_v1'))).toBeNull();
});

test('selector scheduling: Retry waits for an in-flight Department save before reloading once', async ({ page }) => {
    let releaseGroupSave;
    const groupSaveGate = new Promise(resolve => { releaseGroupSave = resolve; });
    const requests = [];
    const requestLog = [];
    let documents = 0;
    page.on('request', request => {
        if (request.resourceType() === 'document') documents += 1;
    });
    await openBoard(page, {
        requests,
        requestLog,
        sourceBundle: true,
        strictBoard: true,
        groupsSource: 'workspace_db',
        groupPreferences: {
            customized: true,
            preferenceExists: true,
            onboardingRequired: false,
            onboardingDone: true,
            visibleGroupIds: ['grp-default'],
            effectiveVisibleGroupIds: ['grp-default'],
            activeGroupId: 'grp-default',
        },
        groupsResponseGate: ({ requestIndex }) => requestIndex === 2 ? groupSaveGate : null,
        homeTokenDelayMs: 1500,
        homeTokenFailureCount: 1,
    });
    const groupSaves = () => requestLog.filter(entry => (
        entry.method === 'POST' && new URL(entry.url).pathname === '/api/groups-config'
    ));

    try {
        await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Manage team groups', exact: true }).click();
        const dialog = page.getByRole('dialog').first();
        await dialog.getByRole('tab', { name: 'Boards', exact: true }).click();
        await dialog.locator('.board-column-name').first().fill('Pending save backlog');
        await dialog.getByRole('button', { name: /^Save$/ }).click();
        await expect.poll(() => groupSaves().length).toBe(1);
        const documentsBefore = documents;

        await page.getByRole('button', { name: 'Retry connection', exact: true }).evaluate(button => button.click());
        await expect(page.getByText('Waiting for a pending save to finish before reloading.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Waiting for save…', exact: true })).toBeDisabled();
        expect(documents).toBe(documentsBefore);

        releaseGroupSave();
        releaseGroupSave = null;
        await expect.poll(() => documents).toBe(documentsBefore + 1);
        expect(groupSaves()).toHaveLength(1);
    } finally {
        releaseGroupSave?.();
    }
});

for (const probeFailure of [
    { status: 503, name: 'failed Retry probe keeps the Board and does not reload', authLocked: false },
    { status: 401, name: 'Retry probe 401 locks without reloading', authLocked: true },
]) {
    test(`selector scheduling: ${probeFailure.name}`, async ({ page }) => {
        const requests = [];
        let documents = 0;
        page.on('request', request => {
            if (request.resourceType() === 'document') documents += 1;
        });
        await openBoard(page, {
            requests,
            sourceBundle: true,
            strictBoard: true,
            configStatus: ({ requestIndex }) => requestIndex === 2 ? probeFailure.status : 200,
            homeTokenDelayMs: 1500,
            homeTokenFailureCount: 1,
        });
        await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
        const documentsBefore = documents;
        const strictBefore = requests.filter(path => path.includes('scope=component')).length;

        await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
        await expect.poll(() => requests.filter(path => path === '/api/config').length).toBe(2);
        if (probeFailure.authLocked) {
            await expect(page.getByRole('alertdialog')).toContainText('Sign in required');
        } else {
            await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeEnabled();
            await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
        }
        await page.waitForLoadState('networkidle');
        expect(documents).toBe(documentsBefore);
        expect(requests.filter(path => path === '/api/groups-config')).toHaveLength(1);
        expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(strictBefore);
    });
}

test('selector scheduling: revoked configuration blocks and repaired configuration loads once', async ({ page }) => {
    const requests = [];
    await openBoard(page, {
        requests,
        sourceBundle: true,
        strictBoard: true,
        strictEpicKeyForRequest: ({ requestIndex }) => requestIndex === 1 ? 'STRICT-BEFORE' : 'STRICT-AFTER',
    });
    await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
    await page.getByRole('option', { name: 'Component', exact: true }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-BEFORE"]')).toBeVisible();
    expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);

    await page.getByRole('button', { name: 'Manage team groups', exact: true }).click();
    let dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Team groups', exact: true }).click();
    await dialog.locator('.component-chip', { hasText: 'Platform' }).getByRole('button').click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.getByRole('status', { name: 'Board scope status', exact: true })).toContainText(
        'Add Components to this Department to use Component scope.'
    );
    await waitTwoFrames(page);
    expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);

    await page.getByRole('button', { name: 'Add Components', exact: true }).click();
    dialog = page.getByRole('dialog').first();
    const search = dialog.getByPlaceholder('Search components...');
    await search.fill('Platform');
    await dialog.locator('.component-search-result-item', { hasText: 'Platform' }).click();
    await dialog.getByRole('button', { name: /^Save$/ }).click();

    await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(2);
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-AFTER"]')).toBeVisible();
    expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(2);
});

test('selector scheduling: in-flight ordinary Board reuse', async ({ page }) => {
    let releaseTasks;
    const taskResponseGate = new Promise(resolve => { releaseTasks = resolve; });
    const requests = [];
    await installBoardFixture(page, { requests, sourceBundle: true, strictBoard: true, taskResponseGate });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requests.filter(path => path === '/api/tasks-with-team-name').length).toBe(2);
        const modes = page.getByRole('radiogroup', { name: 'ENG view mode' });
        await modes.getByRole('radio', { name: 'Planning' }).click();
        await modes.getByRole('radio', { name: 'Board' }).click();
        await waitTwoFrames(page);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(2);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);

        releaseTasks();
        releaseTasks = null;
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    } finally {
        releaseTasks?.();
    }
});

test('selector round trips: held Catch Up lane continues through ordinary Board entry', async ({ page }) => {
    let releaseTasks;
    const taskResponseGate = new Promise(resolve => { releaseTasks = resolve; });
    const requests = [];
    await installBoardFixture(page, { requests, sourceBundle: true, strictBoard: true, taskResponseGate });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: false, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => requests.filter(path => path === '/api/tasks-with-team-name').length).toBe(2);
        await page.getByRole('radiogroup', { name: 'ENG view mode' })
            .getByRole('radio', { name: 'Board', exact: true }).click();
        await waitTwoFrames(page);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(2);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);

        releaseTasks();
        releaseTasks = null;
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(2);
    } finally {
        releaseTasks?.();
    }
});

for (const scopeProfile of [
    { scope: 'component', label: 'Component' },
    { scope: 'all_work', label: 'All work' },
]) {
    test(`selector round trips: ready ${scopeProfile.label} returns to the saved ordinary Sprint`, async ({ page }) => {
        const requests = [];
        await openBoard(page, { strictBoard: true, sourceBundle: true, requests });
        const ordinaryCount = requests.filter(path => path === '/api/tasks-with-team-name').length;
        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await trigger.click();
        await page.getByRole('option', { name: scopeProfile.label, exact: true }).click();
        await expect.poll(() => requests.filter(path => path.includes(`scope=${scopeProfile.scope}`)).length).toBe(1);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();

        await trigger.click();
        await page.getByRole('option', { name: selectedSprintName, exact: true }).click();
        await expect(trigger).toContainText(selectedSprintName);
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await waitTwoFrames(page);
        expect(requests.filter(path => path.includes(`scope=${scopeProfile.scope}`))).toHaveLength(1);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCount);
        await expect.poll(() => page.evaluate(() => JSON.parse(
            localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'
        ).selectedSprint)).toBe(selectedSprintId);
    });
}

for (const siblingMode of ['Catch Up', 'Statistics', 'Scenario']) {
    test(`selector round trips: ordinary Board to ${siblingMode} to Board restores its cached Sprint`, async ({ page }) => {
        const requests = [];
        const requestLog = [];
        await openBoard(page, {
            strictBoard: true,
            sourceBundle: true,
            requests,
            requestLog,
            initialPrefs: siblingMode === 'Statistics' ? { statsView: 'projectTrack' } : {},
        });
        const ordinaryLaneCount = () => requestLog.filter(({ url, method }) => {
            const parsed = new URL(url);
            return method === 'GET'
                && parsed.pathname === '/api/tasks-with-team-name'
                && !parsed.searchParams.has('purpose');
        }).length;
        const initialOrdinaryLaneCount = ordinaryLaneCount();
        const modes = page.getByRole('radiogroup', { name: 'ENG view mode' });
        await modes.getByRole('radio', { name: siblingMode, exact: true }).click();
        await expect(page.getByRole('button', { name: 'Select sprint', exact: true }).first())
            .toContainText(selectedSprintName);
        await modes.getByRole('radio', { name: 'Board', exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await waitTwoFrames(page);
        expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
        expect(ordinaryLaneCount()).toBe(initialOrdinaryLaneCount);
        if (siblingMode === 'Scenario') {
            expect(requestLog.filter(({ url, method }) => (
                method !== 'GET' && new URL(url).pathname.startsWith('/api/scenario')
            ))).toEqual([]);
        }
    });
}

for (const siblingMode of ['Catch Up', 'Planning', 'Statistics', 'Scenario']) {
    test(`selector round trips: strict Component to ${siblingMode} to Board restores ordinary Sprint`, async ({ page }) => {
        const requests = [];
        const requestLog = [];
        await openBoard(page, {
            strictBoard: true,
            sourceBundle: true,
            requests,
            requestLog,
            initialPrefs: siblingMode === 'Statistics' ? { statsView: 'projectTrack' } : {},
        });
        const ordinaryLaneCount = () => requestLog.filter(({ url, method }) => {
            const parsed = new URL(url);
            return method === 'GET'
                && parsed.pathname === '/api/tasks-with-team-name'
                && !parsed.searchParams.has('purpose');
        }).length;
        const initialOrdinaryLaneCount = ordinaryLaneCount();
        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await trigger.click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();

        const modes = page.getByRole('radiogroup', { name: 'ENG view mode' });
        await modes.getByRole('radio', { name: siblingMode, exact: true }).click();
        await expect(trigger).toContainText(selectedSprintName);
        await modes.getByRole('radio', { name: 'Board', exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await waitTwoFrames(page);
        expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
        expect(ordinaryLaneCount()).toBe(initialOrdinaryLaneCount);
        expect(requests.some(path => path.includes('scope=sprint'))).toBe(false);
    });
}

test('selector round trips: rapid Component to All work to ordinary retires both strict generations', async ({ page }) => {
    let releaseComponent;
    const componentGate = new Promise(resolve => { releaseComponent = resolve; });
    const requests = [];
    await openBoard(page, {
        strictBoard: true,
        sourceBundle: true,
        requests,
        boardResponseGate: ({ url }) => url.searchParams.get('scope') === 'component' ? componentGate : null,
    });
    const ordinaryCount = requests.filter(path => path === '/api/tasks-with-team-name').length;
    const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();

    try {
        await trigger.click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect.poll(() => requests.filter(path => path.includes('scope=component')).length).toBe(1);
        await trigger.click();
        await page.getByRole('option', { name: 'All work', exact: true }).click();
        await expect.poll(() => requests.filter(path => path.includes('scope=all_work')).length).toBe(1);
        await trigger.click();
        await page.getByRole('option', { name: selectedSprintName, exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();

        releaseComponent();
        releaseComponent = null;
        await waitTwoFrames(page);
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toHaveCount(0);
        expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
        expect(requests.filter(path => path.includes('scope=all_work'))).toHaveLength(1);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCount);
    } finally {
        releaseComponent?.();
    }
});

test('selector auth matrix: strict stream 401 locks globally and retires a delayed older scope', async ({ page }) => {
    let releaseComponent;
    const componentGate = new Promise(resolve => { releaseComponent = resolve; });
    const strictAttempts = [];
    const requests = [];
    await installBoardFixture(page, {
        requests,
        sourceBundle: true,
        strictBoard: true,
        analyticsEnabled: true,
    });
    await page.route('**/api/eng/board?**', async route => {
        const url = new URL(route.request().url());
        const scope = url.searchParams.get('scope');
        strictAttempts.push(scope);
        if (scope === 'component') {
            await componentGate;
            try {
                await route.fallback();
            } catch (_error) {
                // The auth lock or scope retirement may already have cancelled the request.
            }
            return;
        }
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'authentication_required' }),
        });
    });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });

    try {
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
        await expect.poll(() => page.evaluate(() => (window.dataLayer || []).some(entry => (
            entry?.event_name === 'page_view'
        )))).toBe(true);
        await page.evaluate(() => { window.dataLayer.length = 0; });
        const ordinaryCount = requests.filter(path => path === '/api/tasks-with-team-name').length;
        const trigger = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
        await trigger.click();
        await page.getByRole('option', { name: 'Component', exact: true }).click();
        await expect.poll(() => strictAttempts.filter(scope => scope === 'component').length).toBe(1);
        await trigger.click();
        await page.getByRole('option', { name: 'All work', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toContainText('Sign in required');
        await expect.poll(() => page.evaluate(() => (window.dataLayer || []).filter(entry => (
            entry?.event_name === 'filter_changed'
        )).length)).toBe(2);
        await page.evaluate(() => { window.dataLayer.length = 0; });
        await expectLockedSelectorInteractionBlocked(page, trigger);

        releaseComponent();
        releaseComponent = null;
        await waitTwoFrames(page);
        await expect(page.getByRole('alertdialog')).toContainText('Sign in required');
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toHaveCount(0);
        expect(strictAttempts.filter(scope => scope === 'component')).toHaveLength(1);
        expect(strictAttempts.filter(scope => scope === 'all_work')).toHaveLength(1);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(ordinaryCount);
        expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
            entry?.event_name === 'filter_changed'
        )))).toEqual([]);
    } finally {
        releaseComponent?.();
    }
});

for (const scope of ['component', 'all_work']) {
    test(`${scope} records one terminal Board observation separately from the initial Sprint load`, async ({ page }) => {
        const performanceLoads = [];
        const requests = [];
        await openBoard(page, { strictBoard: true, sourceBundle: true, requests, performanceLoads });
        await expect.poll(() => performanceLoads.filter(sample => sample.surface === 'eng_sprint').length).toBe(1);

        await page.getByRole('button', { name: 'Select sprint' }).first().click();
        await page.locator('.sprint-dropdown-panel').getByText(
            scope === 'component' ? 'Component' : 'All work', { exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
        await expect.poll(() => performanceLoads.filter(sample => sample.surface === 'eng_board').length).toBe(1);

        const boardSample = performanceLoads.find(sample => sample.surface === 'eng_board');
        expect(boardSample).toMatchObject({
            surface: 'eng_board', scopeType: scope, sprintId: null, outcome: 'success',
            epicCount: 1, issueCount: 1, jiraRequests: 2, jiraPages: 2, jiraRetries: 0,
            cacheState: 'miss', completeness: 'complete', peakChildSearches: 1,
        });
        expect(boardSample.indexMs).toBe(1);
        expect(boardSample.focusedCompleteMs).toBe(2);
        expect(JSON.stringify(boardSample)).not.toContain('STRICT-1');
        expect(JSON.stringify(boardSample)).not.toContain('Eligible Bug');
        expect(requests.filter(path => path.includes(`scope=${scope}`))).toHaveLength(1);
    });
}

test('a held Board observation response does not block completed Board controls or duplicate generation', async ({ page }) => {
    let releaseObservation;
    const performanceResponseGate = new Promise(resolve => { releaseObservation = resolve; });
    const performanceLoads = [];
    const requests = [];
    try {
        await openBoard(page, { strictBoard: true, sourceBundle: true, requests, performanceLoads,
            performanceResponseGate: observation => observation.surface === 'eng_board' ? performanceResponseGate : null });
        await page.getByRole('button', { name: 'Select sprint' }).first().click();
        await page.locator('.sprint-dropdown-panel').getByText('All work', { exact: true }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
        await expect.poll(() => performanceLoads.filter(sample => sample.surface === 'eng_board').length).toBe(1);
        await expect(page.locator('.fb-readout')).toContainText('1 of 1 epics');

        await page.getByRole('button', { name: 'Select sprint' }).first().click();
        await page.locator('.sprint-dropdown-panel').getByText(selectedSprintName, { exact: false }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Catch Up' }).click();
        await expect(page.locator('.task-item[data-task-key="PLAT-1-1"]')).toBeVisible();
        await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board' }).click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await waitTwoFrames(page);

        expect(requests.filter(path => path.includes('scope=all_work'))).toHaveLength(1);
        expect(performanceLoads.filter(sample => sample.surface === 'eng_board')).toHaveLength(1);
    } finally {
        releaseObservation?.();
    }
});

test('a rejected Board observation does not break Board completion or selector recovery', async ({ page }) => {
    const performanceLoads = [];
    const requests = [];
    await openBoard(page, { strictBoard: true, sourceBundle: true, requests, performanceLoads,
        performanceStatus: 503 });
    await page.getByRole('button', { name: 'Select sprint' }).first().click();
    await page.locator('.sprint-dropdown-panel').getByText('Component', { exact: true }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]')).toBeVisible();
    await expect.poll(() => performanceLoads.filter(sample => sample.surface === 'eng_board').length).toBe(1);
    await expect(page.locator('.fb-readout')).toContainText('1 of 1 epics');

    await page.getByRole('button', { name: 'Select sprint' }).first().click();
    await page.locator('.sprint-dropdown-panel').getByText(selectedSprintName, { exact: false }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await waitTwoFrames(page);
    expect(requests.filter(path => path.includes('scope=component'))).toHaveLength(1);
    expect(performanceLoads.filter(sample => sample.surface === 'eng_board')).toHaveLength(1);
});

test('keeps the ENG dashboard behind sprint readiness while the catalog is loading', async ({ page }) => {
    let releaseSprints;
    const sprintResponseGate = new Promise(resolve => { releaseSprints = resolve; });
    const requests = [];
    await installBoardFixture(page, { requests, sourceBundle: true, sprintResponseGate });
    await page.addInitScript(() => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: null, sprintName: '',
            activeGroupId: 'grp-default', showBoard: false,
            showPlanning: false, showScenario: false,
        }));
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requests.filter(path => path === '/api/sprints').length).toBe(1);

    const sprintControl = page.locator('.sprint-dropdown-toggle').first();
    await expect(sprintControl).toHaveAttribute('aria-disabled', 'true');
    await expect(sprintControl).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('heading', { name: 'Loading sprints' })).toBeVisible();
    await expect(page.locator('.task-item')).toHaveCount(0);

    releaseSprints();
});

for (const sprintCatalog of [
    { description: 'an empty', fixture: { sprints: [] }, error: null },
    { description: 'a failed', fixture: { sprintsStatus: 503 }, error: 'Sprint catalog is unavailable. Retry.' },
]) {
    test(`keeps the ENG dashboard blocked after ${sprintCatalog.description} sprint catalog`, async ({ page }) => {
        await installBoardFixture(page, { sourceBundle: true, ...sprintCatalog.fixture });
        await page.addInitScript(() => {
            localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
                selectedView: 'eng', selectedSprint: null, sprintName: '',
                activeGroupId: 'grp-default', showBoard: false,
                showPlanning: false, showScenario: false,
            }));
        });

        await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

        const sprintControl = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(sprintControl).toHaveAttribute('aria-disabled', 'true');
        await expect(sprintControl).toHaveAttribute('tabindex', '-1');
        if (sprintCatalog.error) {
            await expect(page.getByText(sprintCatalog.error, { exact: false })).toBeVisible();
        } else {
            await expect(page.getByText('No tasks found', { exact: false })).toBeVisible();
        }
        await expect(page.locator('.task-item')).toHaveCount(0);
    });
}

test('selects the current sprint on first load when no cached sprint exists', async ({ page }) => {
    const requestUrls = [];
    const currentSprint = { id: 34626, name: '2026Q3 Sprint 42', state: 'active' };
    await installBoardFixture(page, {
        sourceBundle: true,
        requestUrls,
        sprints: [
            { id: 34624, name: '2026Q2', state: 'closed' },
            currentSprint,
            { id: 34627, name: '2026Q4', state: 'future' },
        ],
    });
    await page.addInitScript(() => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', activeGroupId: 'grp-default', showBoard: true,
            showPlanning: false, showScenario: false,
        }));
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(currentSprint.name);
    await expect.poll(() => requestUrls.some(path => (
        path.startsWith('/api/tasks-with-team-name?')
        && new URLSearchParams(path.split('?')[1]).get('sprint') === String(currentSprint.id)
    ))).toBe(true);
    expect(requestUrls.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
});

test('Catch Up to Board reuses the loaded sprint snapshot without another Jira data request', async ({ page }) => {
    const requests = [];
    await installBoardFixture(page, { strictBoard: true, requests, sourceBundle: true });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: false, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.task-item[data-task-key="PLAT-1-1"]')).toBeVisible();
    const loadedRequests = requests.filter(path => path === '/api/tasks-with-team-name').length;

    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board' }).click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await settle(page);

    expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(loadedRequests);
    expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
});

test('Catch Up authoritative empty snapshot stays authoritative when Board opens', async ({ page }) => {
    const requests = [];
    await installBoardFixture(page, { strictBoard: true, requests, sourceBundle: true, epicSpecs: [] });
    await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
            activeGroupId: 'grp-default', showBoard: false, showPlanning: false, showScenario: false,
        }));
    }, { selectedSprintId, selectedSprintName });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.getByText('No tasks found', { exact: false })).toBeVisible();
    const loadedRequests = requests.filter(path => path === '/api/tasks-with-team-name').length;

    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board' }).click();
    await expect(page.getByText('No epics found', { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(loadedRequests);
    expect(requests.filter(path => path.startsWith('/api/eng/board?'))).toHaveLength(0);
});

for (const strictFailure of [
    { scope: 'component', label: 'Component' },
    { scope: 'all_work', label: 'All work' },
]) {
    test(`failed ${strictFailure.label} load keeps the shared Sprint selector available and restores sprint data`, async ({ page }) => {
        const requests = [];
        await installBoardFixture(page, { strictBoard: true, requests, sourceBundle: true });
        await page.route('**/api/eng/board?**', async route => {
            const url = new URL(route.request().url());
            requests.push(`${url.pathname}${url.search}`);
            await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'board_config_invalid' }) });
        });
        await page.addInitScript(({ selectedSprintId, selectedSprintName }) => {
            localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
                selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
                activeGroupId: 'grp-default', showBoard: true, showPlanning: false, showScenario: false,
            }));
        }, { selectedSprintId, selectedSprintName });
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
        const sprintControl = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        const sprintRequestCount = requests.filter(path => path === '/api/tasks-with-team-name').length;
        await sprintControl.click();
        await page.getByText(strictFailure.label, { exact: true }).first().click();
        await expect(page.locator('.error')).toContainText('Board configuration could not be used. Review Board setup and retry.');
        await expect(page.locator('.error')).not.toContainText('board config invalid');
        await expect(page.getByText('Loaded so far')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(strictFailure.label);
        await page.screenshot({ path: path.join(screenshotDir, `strict-error-${strictFailure.scope}.png`), animations: 'disabled' });
        await expect.poll(() => requests.some(path => path.includes(`scope=${strictFailure.scope}`))).toBe(true);
        await page.getByRole('button', { name: 'Select sprint' }).first().click();
        await page.getByText(selectedSprintName, { exact: false }).first().click();
        await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Select sprint' }).first()).toContainText(selectedSprintName);
        await expect(page.locator('.error')).toHaveCount(0);
        await settle(page);
        expect(requests.filter(path => path === '/api/tasks-with-team-name')).toHaveLength(sprintRequestCount);
        await page.screenshot({ path: path.join(screenshotDir, `strict-recovered-${strictFailure.scope}.png`), animations: 'disabled' });
    });
}

// The board scrolls with `scroll-behavior: smooth`, so every focus change needs the scroll offset
// to stop moving before geometry means anything.
async function settle(page) {
    // The sentinel is reset per call and three consecutive equal samples are required: a stored
    // value left over from the previous settle would otherwise match a scroll that has not started
    // yet, and two samples can both land on the flat tail of an ease-out curve.
    await page.evaluate(() => { window.__boardSettle = null; });
    await page.waitForFunction(() => {
        const board = document.querySelector('.eng-board .board');
        if (!board) return false;
        const state = window.__boardSettle;
        if (!state || state.left !== board.scrollLeft) {
            window.__boardSettle = { left: board.scrollLeft, stable: 0 };
            return false;
        }
        state.stable += 1;
        return state.stable >= 2;
    }, null, { timeout: 5000, polling: 120 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// THE invariant, asserted as a total rather than as a set of cases (D43).
async function expectExactlyOneFocused(page, label) {
    const state = await page.evaluate(() => ({
        focused: document.querySelectorAll('.eng-board .col.is-focused').length,
        columns: document.querySelectorAll('.eng-board .col').length,
        open: document.querySelectorAll('.eng-board .col.is-focused, .eng-board .col.is-open').length,
        focusedHasBody: Boolean(document.querySelector('.eng-board .col.is-focused .col-body')),
        focusedBodyVisible: (() => {
            const body = document.querySelector('.eng-board .col.is-focused .col-body');
            return body ? getComputedStyle(body).display !== 'none' : false;
        })(),
    }));
    expect(state.focused, `${label}: exactly one .col.is-focused`).toBe(1);
    expect(state.columns, `${label}: the board still renders columns`).toBeGreaterThan(0);
    expect(state.open, `${label}: the focused column is open`).toBeGreaterThanOrEqual(1);
    expect(state.focusedHasBody, `${label}: the focused column has a body`).toBe(true);
    expect(state.focusedBodyVisible, `${label}: the focused column's body is not display:none`).toBe(true);
}

function col(page, id) {
    return page.locator(`.eng-board .col[data-column-id="${id}"]`);
}

async function focusedId(page) {
    return page.evaluate(() => document.querySelector('.eng-board .col.is-focused')?.dataset.columnId || null);
}

// Pane mode (docs/agents/features/2026-09-24-executed-board-column-scroll-panes.md). A viewport
// that fails the height gate with margin, for tests that assert the page-scroll/pinned-chrome model.
const FALLBACK_VIEWPORT = { width: 800, height: 380 };
const PANE_EPSILON = 1;

async function isPaneMode(page) {
    return page.evaluate(() => Boolean(document.querySelector('.eng-board.is-pane-mode')));
}

async function boardGeometry(page) {
    return page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const columns = [...document.querySelectorAll('.eng-board .col')];
        const focused = document.querySelector('.eng-board .col.is-focused');
        const focusedRect = focused.getBoundingClientRect();
        return {
            docWidth: document.documentElement.getBoundingClientRect().width,
            docOverflowX: document.documentElement.scrollWidth - document.documentElement.getBoundingClientRect().width,
            boardWidth: Math.round(board.getBoundingClientRect().width),
            boardLeft: Math.round(board.getBoundingClientRect().left),
            focusedWidth: focusedRect.width,
            focusedCentre: focusedRect.left + focusedRect.width / 2,
            distinctTops: [...new Set(columns.map((el) => Math.round(el.getBoundingClientRect().top)))].length,
            openWidths: columns
                .filter((el) => el.classList.contains('is-focused') || el.classList.contains('is-open'))
                .map((el) => Math.round(el.getBoundingClientRect().width)),
            railWidths: columns
                .filter((el) => !el.classList.contains('is-focused') && !el.classList.contains('is-open'))
                .map((el) => Math.round(el.getBoundingClientRect().width)),
        };
    });
}

const READY_ID = 'col-3c4d5e6f';
const IN_PROGRESS_ID = 'col-6f708192';
const TODO_ID = 'col-1a2b3c4d';

// Two open columns (In progress is the starred default; Ready to start is focused beside it),
// each well over 30 epics so both panes overflow (MRT018).
function longColumnSpecs(count = 32) {
    return [
        ...EPIC_SPECS,
        ...Array.from({ length: count }, (_, index) => [`PLAT-IP-${index + 1}`, 'In Progress', 'Major']),
        ...Array.from({ length: count }, (_, index) => [`PLAT-RS-${index + 1}`, 'Awaiting Validation', 'Major']),
    ];
}

// Keyboard activation: event.detail is 0, so the rail-click page reveal does not run.
async function openSecondColumn(page) {
    await col(page, READY_ID).locator('.col-strip').focus();
    await page.keyboard.press('Enter');
    await settle(page);
}

async function paneState(page) {
    return page.evaluate(() => {
        const root = document.querySelector('.eng-board');
        const board = root.querySelector('.board');
        const boardRect = board.getBoundingClientRect();
        const columns = [...board.querySelectorAll('.col')].map((column) => {
            const rect = column.getBoundingClientRect();
            const open = column.classList.contains('is-open') || column.classList.contains('is-focused');
            const body = column.querySelector('.col-body');
            const name = column.querySelector('.col-head .nm');
            return {
                id: column.dataset.columnId,
                open,
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                scrollTop: open ? body.scrollTop : null,
                headTop: open ? column.querySelector('.col-head').getBoundingClientRect().top : null,
                firstCardWidth: open ? body.querySelector('.ecard')?.getBoundingClientRect().width ?? null : null,
                nameRect: open ? name.getBoundingClientRect().toJSON() : null,
            };
        });
        return {
            paneMode: root.classList.contains('is-pane-mode'),
            alertCount: root.querySelectorAll('.board-data-state').length,
            scrollY: window.scrollY,
            maxScroll: document.scrollingElement.scrollHeight - window.innerHeight,
            innerHeight: window.innerHeight,
            headerTop: document.querySelector('header').getBoundingClientRect().top,
            filterBarTop: document.querySelector('.filterbar-wrap').getBoundingClientRect().top,
            boardTop: boardRect.top,
            boardBottom: boardRect.bottom,
            boardContentBottom: boardRect.top + board.clientTop + board.clientHeight,
            compactVisible: Boolean(document.querySelector('.compact-sticky-header.is-visible')),
            columns,
        };
    });
}

function openScrollTops(state) {
    return Object.fromEntries(state.columns.filter((c) => c.open).map((c) => [c.id, c.scrollTop]));
}

function openHeadTops(state) {
    return Object.fromEntries(state.columns.filter((c) => c.open).map((c) => [c.id, c.headTop]));
}

// Three equal consecutive samples of the page and every open body, like settle() for scrollLeft.
async function settleScroll(page) {
    await page.evaluate(() => { window.__paneSettle = null; });
    await page.waitForFunction(() => {
        const sample = JSON.stringify([
            window.scrollY,
            ...[...document.querySelectorAll('.eng-board .col-body')].map((body) => body.scrollTop),
            document.querySelector('.eng-board')?.className,
        ]);
        const state = window.__paneSettle;
        if (!state || state.sample !== sample) {
            window.__paneSettle = { sample, stable: 0 };
            return false;
        }
        state.stable += 1;
        return state.stable >= 2;
    }, null, { timeout: 5000, polling: 120 });
}

// Moves the pointer onto a visible point of the target, waits out the previous gesture's latch,
// then wheels once.
async function wheelOver(page, locator, deltaY) {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    const x = (Math.max(box.x, 0) + Math.min(box.x + box.width, viewport.width)) / 2;
    const y = Math.min(Math.max(box.y + Math.min(80, box.height / 2), 10), viewport.height - 20);
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    await page.mouse.wheel(0, deltaY);
    await settleScroll(page);
}

/* ── Pane mode: a fixed-height page with independently scrolling columns ───────────────────── */

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    test(`pane mode at ${viewport.width}x${viewport.height}: the page never scrolls and the board fills the viewport`, async ({ page }) => {
        await openBoard(page, { ...viewport, reducedMotion: true, epicSpecs: longColumnSpecs() });
        await openSecondColumn(page);
        const start = await paneState(page);
        await page.screenshot({ path: `${screenshotDir}/board-pane-${viewport.width}.png`, fullPage: false });

        expect(start.paneMode).toBe(true);
        expect(start.alertCount, 'pane mode shows no small-screen alert').toBe(0);
        expect(start.scrollY).toBe(0);
        expect(start.maxScroll).toBeLessThanOrEqual(PANE_EPSILON);
        expect(Math.abs(start.boardBottom - start.innerHeight)).toBeLessThanOrEqual(PANE_EPSILON);
        start.columns.filter((column) => column.open).forEach((column) => {
            expect(Math.abs(column.bottom - start.boardContentBottom), `${column.id} bottom`).toBeLessThanOrEqual(PANE_EPSILON);
        });

        // Nothing above or inside the board moves, whatever is under the wheel.
        for (const target of [
            col(page, READY_ID).locator('.col-body'),
            col(page, TODO_ID).locator('.col-strip'),
            page.locator('.filterbar-wrap'),
            col(page, READY_ID).locator('.col-body'),
        ]) {
            for (const deltaY of [600, -200, 2000]) {
                await wheelOver(page, target, deltaY);
                const state = await paneState(page);
                expect(state.scrollY).toBe(0);
                expect(state.headerTop).toBe(start.headerTop);
                expect(state.filterBarTop).toBe(start.filterBarTop);
                expect(openHeadTops(state)).toEqual(openHeadTops(start));
                expect(state.compactVisible, 'the compact header never appears in pane mode').toBe(false);
            }
        }
    });
}

test('pane mode: a wheel scrolls only the column under the pointer, from the first gesture', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    const start = await paneState(page);
    expect(openScrollTops(start)).toEqual({ [IN_PROGRESS_ID]: 0, [READY_ID]: 0 });

    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 300);
    const afterReady = await paneState(page);
    expect(openScrollTops(afterReady)[READY_ID]).toBeGreaterThan(0);
    expect(openScrollTops(afterReady)[IN_PROGRESS_ID]).toBe(0);
    expect(afterReady.scrollY).toBe(0);

    await wheelOver(page, col(page, IN_PROGRESS_ID).locator('.col-body'), 300);
    const afterProgress = await paneState(page);
    expect(openScrollTops(afterProgress)[IN_PROGRESS_ID]).toBeGreaterThan(0);
    expect(openScrollTops(afterProgress)[READY_ID]).toBe(openScrollTops(afterReady)[READY_ID]);
    expect(afterProgress.scrollY).toBe(0);
});

test('pane mode: titles stay inside their panes and cards keep one width while a column scrolls', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    const top = await paneState(page);
    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 600);
    const scrolled = await paneState(page);
    expect(openScrollTops(scrolled)[READY_ID]).toBeGreaterThan(0);

    for (const state of [top, scrolled]) {
        state.columns.filter((c) => c.open).forEach((column) => {
            expect(column.nameRect.left, `${column.id} title left`).toBeGreaterThanOrEqual(column.left + 1);
            expect(column.nameRect.right, `${column.id} title right`).toBeLessThanOrEqual(column.right - 1);
            expect(column.nameRect.top, `${column.id} title top`).toBeGreaterThanOrEqual(column.top);
        });
    }
    const titleHits = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col.is-open .nm, .eng-board .col.is-focused .nm')]
        .map((name) => {
            const rect = name.getBoundingClientRect();
            return Boolean(document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2)?.closest('.col-head'));
        }));
    expect(titleHits.every(Boolean)).toBe(true);
    const widths = (state) => Object.fromEntries(state.columns.filter((c) => c.open).map((c) => [c.id, c.firstCardWidth]));
    expect(widths(scrolled)).toEqual(widths(top));
});

for (const [label, viewport] of [['pane mode', { width: 1440, height: 900 }], ['fallback', FALLBACK_VIEWPORT]]) {
    test(`${label}: rails are the fixed 340px track and keep their fill ratios`, async ({ page }) => {
        await openBoard(page, { ...viewport, reducedMotion: true });
        expect(await isPaneMode(page)).toBe(label === 'pane mode');
        const rails = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col:not(.is-open):not(.is-focused) .col-strip')]
            .map((strip) => {
                const fill = strip.querySelector('.fill');
                return {
                    height: strip.getBoundingClientRect().height,
                    declared: parseFloat(fill.style.height) / 100,
                    painted: fill.getBoundingClientRect().height / strip.clientHeight,
                };
            }));
        expect(rails.length).toBeGreaterThan(0);
        rails.forEach(({ height, declared, painted }) => {
            expect(height).toBe(340);
            expect(Math.abs(declared - painted)).toBeLessThanOrEqual(0.01);
        });
    });
}

test('pane mode: a pointer click on a rail only focuses the column, which opens at its top', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    // Scroll Ready to start, fold it, then reopen it with a real click on its rail.
    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 400);
    expect(openScrollTops(await paneState(page))[READY_ID]).toBeGreaterThan(0);
    await col(page, READY_ID).locator('.fold').click();
    await settle(page);
    const strip = await col(page, READY_ID).locator('.col-strip').boundingBox();
    await page.mouse.click(strip.x + strip.width / 2, strip.y + 40);
    await settle(page);
    await settleScroll(page);
    const state = await paneState(page);
    expect(await focusedId(page)).toBe(READY_ID);
    expect(openScrollTops(state)[READY_ID]).toBe(0);
    expect(state.scrollY).toBe(0);
});

test('pane mode: open columns keep their scroll position; a folded column reopens at its top', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 400);
    const scrolled = openScrollTops(await paneState(page))[READY_ID];
    expect(scrolled).toBeGreaterThan(0);

    // A rail has nothing to scroll, and neither has the page.
    await wheelOver(page, col(page, TODO_ID).locator('.col-strip'), -200);
    await wheelOver(page, col(page, TODO_ID).locator('.col-strip'), 400);
    const afterRail = await paneState(page);
    expect(afterRail.scrollY).toBe(0);
    expect(openScrollTops(afterRail)[READY_ID]).toBe(scrolled);

    await col(page, READY_ID).locator('.fold').click();
    await settle(page);
    await openSecondColumn(page);
    expect(openScrollTops(await paneState(page))[READY_ID]).toBe(0);
});

test('pane mode: focus into a card below a column fold scrolls that column, never the page', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    const start = await paneState(page);
    // Programmatic focus without preventScroll: the browser scrolls whatever it must to show it.
    await col(page, READY_ID).locator('.ecard .ecard-open').last().focus();
    await settleScroll(page);
    const afterFocus = await paneState(page);
    expect(openScrollTops(afterFocus)[READY_ID]).toBeGreaterThan(0);
    expect(afterFocus.scrollY).toBe(0);
    expect(afterFocus.headerTop).toBe(start.headerTop);

    // Tab onward from there stays inside the pane too.
    await page.keyboard.press('Tab');
    await settleScroll(page);
    const afterTab = await paneState(page);
    expect(afterTab.scrollY).toBe(0);
    expect(afterTab.headerTop).toBe(start.headerTop);
});

test('pane mode: a pointer click on a card in a scrolled column opens it', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    const target = await page.evaluate((id) => {
        const body = document.querySelector(`.eng-board .col[data-column-id="${id}"] .col-body`);
        body.scrollTop = 200;
        const bodyRect = body.getBoundingClientRect();
        const bottom = Math.min(bodyRect.bottom, window.innerHeight);
        const button = [...body.querySelectorAll('.ecard .ecard-open')].find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return rect.top >= bodyRect.top && rect.bottom <= bottom;
        });
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, READY_ID);
    // A human press: the button takes focus on mousedown and the release comes frames later.
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const scrollDuringPress = await page.evaluate(() => window.scrollY);
    await page.mouse.up();
    expect(scrollDuringPress).toBe(0);
    await expect(page.locator('.epic-panel')).toBeVisible();
});

test('pane mode: a breached open column carries the unclipped breach ring on its pane', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    const read = await page.evaluate((id) => {
        const column = document.querySelector(`.eng-board .col[data-column-id="${id}"]`);
        const body = column.querySelector('.col-body');
        return {
            paneShadow: getComputedStyle(column).boxShadow,
            paneAnimation: getComputedStyle(column).animationName,
            bodyShadow: getComputedStyle(body).boxShadow,
        };
    }, IN_PROGRESS_ID);
    expect(read.paneShadow).not.toBe('none');
    expect(read.paneAnimation).toBe('board-breach-glow');
    expect(read.bodyShadow).toBe('none');
    await page.screenshot({ path: `${screenshotDir}/board-pane-breach.png`, fullPage: false });
});

/* ── Small-screen alert: every viewport pane mode cannot serve ─────────────────────────────── */

async function smallScreenAlertState(page) {
    return page.evaluate(() => {
        const root = document.querySelector('.eng-board');
        const alerts = [...root.querySelectorAll('.board-data-state')];
        const alert = alerts[0];
        const boardScroll = root.querySelector('.board-scroll');
        return {
            count: alerts.length,
            paneMode: root.classList.contains('is-pane-mode'),
            role: alert?.getAttribute('role') ?? null,
            inBoardBeforeScroll: Boolean(alert && alert.parentElement === root
                && (alert.compareDocumentPosition(boardScroll) & Node.DOCUMENT_POSITION_FOLLOWING)),
            aboveBoard: alert ? alert.getBoundingClientRect().bottom <= boardScroll.getBoundingClientRect().top : false,
        };
    });
}

const boardActionEvents = (page) => page.evaluate(() => (window.dataLayer || [])
    .filter((entry) => entry?.event_name === 'board_action')
    .map((entry) => Object.fromEntries(Object.entries(entry).filter(([key, value]) =>
        value !== undefined && !(key === 'ga4_user_id' && value === null)))));

async function expectSmallScreenRequestFlow(page, reason, screenshot) {
    const alert = page.locator('.eng-board .board-data-state');
    await expect(alert).toContainText('Board needs a larger screen.');
    const state = await smallScreenAlertState(page);
    expect(state).toEqual({ count: 1, paneMode: false, role: 'status', inBoardBeforeScroll: true, aboveBoard: true });
    if (screenshot) await page.screenshot({ path: `${screenshotDir}/${screenshot}`, fullPage: false });

    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).some((entry) => entry?.event_name === 'page_view'))).toBe(true);
    const button = alert.getByRole('button', { name: 'Request small-screen support' });
    await expect(button).toHaveClass(/secondary/);
    await expect(button).toHaveClass(/compact/);
    await button.click();
    await expect(alert).toContainText('Thanks, noted');
    await expect(alert.getByRole('button')).toHaveCount(0);
    await expect.poll(() => boardActionEvents(page)).toEqual([{
        event: 'userevent',
        trigger: 'userevent',
        event_type: 'event',
        event_name: 'board_action',
        feature_name: 'eng_board',
        workflow_action: 'small_screen_support_request',
        reason,
        source_surface: 'board',
    }]);
}

test('a short desktop viewport keeps the page-scroll board under a small-screen alert that reports short', async ({ page }) => {
    await openBoard(page, { ...FALLBACK_VIEWPORT, reducedMotion: true, analyticsEnabled: true });
    await expectSmallScreenRequestFlow(page, 'short', 'board-alert-short.png');
    // Still the old model: the page scrolls and pins the column chrome.
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(page.locator('.eng-board .board.is-chrome-pinned')).toHaveCount(1);
});

test('a 760px viewport shows the small-screen alert with reason narrow, above the old board', async ({ page }) => {
    await openBoard(page, { width: 760, height: 900, reducedMotion: true, analyticsEnabled: true });
    await expectSmallScreenRequestFlow(page, 'narrow', 'board-alert-narrow.png');
});

test('pane mode shows no small-screen alert and sends no board_action', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900, analyticsEnabled: true });
    expect(await isPaneMode(page)).toBe(true);
    await expect(page.locator('.eng-board .board-data-state')).toHaveCount(0);
    expect(await boardActionEvents(page)).toEqual([]);
});

test.describe('touch tablet', () => {
    test.use({ isMobile: true, hasTouch: true });

    test('a landscape touch tablet keeps the page-scroll model and reports touch', async ({ page }) => {
        await openBoard(page, { width: 1024, height: 768, analyticsEnabled: true });
        expect(await isPaneMode(page)).toBe(false);
        await expectSmallScreenRequestFlow(page, 'touch');
    });
});

/* ── The invariant, through every focus-affecting action ────────────────────────────────────── */

test('pane mode leak class: nothing from a column paints over the filter bar, the top bar or outside its pane', async ({ page }) => {
    // The reported state: wide desktop, starred In progress open beside the focused column,
    // partially scrolled.
    await openBoard(page, { width: 2000, height: 1060, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await wheelOver(page, col(page, IN_PROGRESS_ID).locator('.col-body'), 500);
    const state = await paneState(page);
    expect(state.paneMode).toBe(true);
    expect(openScrollTops(state)[IN_PROGRESS_ID]).toBeGreaterThan(0);
    await page.screenshot({ path: `${screenshotDir}/board-pane-leak-class.png`, fullPage: false });

    const { found: leaks, paneCount, cardCount } = await page.evaluate(() => {
        const found = [];
        let paneCount = 0;
        let cardCount = 0;
        const probe = (x, y, label) => {
            const hit = document.elementFromPoint(x, y);
            if (hit?.closest('.ecard')) found.push(label);
        };
        const filterBar = document.querySelector('.filterbar-wrap').getBoundingClientRect();
        for (let x = 20; x < window.innerWidth; x += 40) {
            probe(x, filterBar.top + filterBar.height / 2, `filter bar @${x}`);
            probe(x, 2, `top edge @${x}`);
        }
        document.querySelectorAll('.eng-board .col.is-open, .eng-board .col.is-focused').forEach((column) => {
            paneCount += 1;
            const rect = column.getBoundingClientRect();
            probe(rect.left + rect.width / 2, rect.top - 2, `${column.dataset.columnId} above`);
            probe(rect.left - 2, rect.top + rect.height / 2, `${column.dataset.columnId} left`);
            probe(rect.right + 2, rect.top + rect.height / 2, `${column.dataset.columnId} right`);
            column.querySelectorAll('.ecard').forEach((card) => {
                cardCount += 1;
                const cardRect = card.getBoundingClientRect();
                const body = column.querySelector('.col-body').getBoundingClientRect();
                const visibleTop = Math.max(cardRect.top, body.top);
                const visibleBottom = Math.min(cardRect.bottom, body.bottom);
                if (visibleBottom > visibleTop && (cardRect.left < rect.left || cardRect.right > rect.right)) {
                    found.push(`${card.dataset.epicKey} overflows its pane horizontally`);
                }
            });
        });
        return { found, paneCount, cardCount };
    });
    expect(paneCount).toBe(2);
    expect(cardCount).toBeGreaterThan(0);
    expect(leaks).toEqual([]);

    // Overlays still paint above the panes, each opened with a normal click.
    await page.getByRole('button', { name: 'Filters' }).click();
    const popoverOption = page.locator('.popover .pop-opt').first();
    await expect(popoverOption).toBeVisible();
    await popoverOption.click();
    await page.keyboard.press('Escape');
    await col(page, IN_PROGRESS_ID).locator('.ecard .ecard-open').first().click();
    await expect(page.locator('.epic-panel')).toBeVisible();
    const panelOnTop = await page.evaluate(() => {
        const rect = document.querySelector('.epic-panel').getBoundingClientRect();
        return Boolean(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20)?.closest('.epic-panel'));
    });
    expect(panelOnTop).toBe(true);
});

test('exactly one column is focused through load, focus, fold, unstar and eight folds', async ({ page }) => {
    await openBoard(page);

    // Initial load: the reference configuration stars In progress, so that is the focus.
    await expectExactlyOneFocused(page, 'initial load');
    expect(await focusedId(page)).toBe('col-6f708192');

    // Focusing another column: the star stays open beside it (D8).
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after focusing another column');
    expect(await focusedId(page)).toBe('col-1a2b3c4d');
    await expect(col(page, 'col-6f708192')).toHaveClass(/is-open/);

    // Folding the focused column: focus TRANSFERS to the star, never clears.
    await col(page, 'col-1a2b3c4d').locator('.col-head').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after folding the focused column');
    expect(await focusedId(page)).toBe('col-6f708192');

    // Unstarring the focused column leaves it focused, merely unpinned.
    await col(page, 'col-6f708192').locator('.col-star').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after unstarring the focused column');
    expect(await focusedId(page)).toBe('col-6f708192');
    await expect(col(page, 'col-6f708192')).not.toHaveClass(/is-starred/);

    // Folding the first column falls right — there is no left neighbour.
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    await col(page, 'col-1a2b3c4d').locator('.col-head').click();
    await settle(page);
    await expectExactlyOneFocused(page, 'after folding the first column');
    expect(await focusedId(page)).toBe('col-2b3c4d5e');

    // Eight consecutive folds — the sequence that produced the dead state before D43.
    for (let step = 0; step < 8; step += 1) {
        await page.locator('.eng-board .col.is-focused .col-head').click();
        await settle(page);
        await expectExactlyOneFocused(page, `after fold ${step + 1} of 8`);
    }
});

test('the Fold button is the keyboard path through the same header target', async ({ page }) => {
    // D26 makes the whole header the pointer target; the button inside it is what a keyboard can
    // reach, and its click bubbles to the same handler rather than duplicating it.
    await openBoard(page);
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-1a2b3c4d');

    await col(page, 'col-1a2b3c4d').locator('.fold').focus();
    await expect(col(page, 'col-1a2b3c4d').locator('.fold')).toBeFocused();
    await page.keyboard.press('Enter');
    await settle(page);
    await expectExactlyOneFocused(page, 'after folding with the keyboard');
    expect(await focusedId(page)).toBe('col-6f708192');
});

test('a starred column has no fold action and its header click is a no-op', async ({ page }) => {
    await openBoard(page);

    const starred = col(page, 'col-6f708192');
    await expect(starred).toHaveClass(/is-starred/);
    await expect(starred).toHaveClass(/is-focused/);

    // Withdrawn, not merely styled away: hidden visibility also takes it out of the tab order.
    const fold = await starred.locator('.fold').evaluate((el) => ({
        visibility: getComputedStyle(el).visibility,
        cursor: getComputedStyle(el.closest('.col-head')).cursor,
    }));
    expect(fold.visibility).toBe('hidden');
    expect(fold.cursor).toBe('default');

    // Clicking the header does nothing at all.
    await starred.locator('.col-head .nm').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-6f708192');
    await expectExactlyOneFocused(page, 'after clicking a starred header');

    // The star inside the header is its own control: it toggles and does not fold.
    await starred.locator('.col-star').click();
    await settle(page);
    await expect(starred).not.toHaveClass(/is-starred/);
    await expect(starred).toHaveClass(/is-focused/);
    await expectExactlyOneFocused(page, 'after the star toggled inside a header');
});

/* ── Geometry: one width, centred, never stacked, never overflowing the document ────────────── */

test('the focused column is centred and one fixed width at every tested viewport', async ({ page }) => {
    await openBoard(page);

    for (const width of [2560, 1920, 1440, 1280, 1040, 800, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const geometry = await boardGeometry(page);
        const expected = Math.min(660, Math.round(width * 0.92));

        expect(Math.round(geometry.focusedWidth), `open column width at ${width}`).toBe(expected);
        geometry.openWidths.forEach((openWidth) => {
            expect(openWidth, `every open column shares one width at ${width}`).toBe(expected);
        });
        expect(Math.abs(geometry.focusedCentre - geometry.docWidth / 2), `centred at ${width}`)
            .toBeLessThanOrEqual(1);
        expect(geometry.distinctTops, `board never stacks at ${width}`).toBe(1);
        expect(geometry.docOverflowX, `no document overflow at ${width}`).toBeLessThanOrEqual(1);
        geometry.railWidths.forEach((railWidth) => {
            expect(railWidth, `folded strip width at ${width}`).toBe(36);
        });
    }
});

// §12.11 asks for centring "for every column", and for the open width to be unchanged when a
// second column opens. The sweep above can prove neither: it never moves focus, and the reference
// star IS the initial focus, so `openWidths` holds a single element in every iteration and the
// equal-width assertion is vacuous. Focusing a non-starred column leaves the star open beside it,
// which is the two-open state.
test('every column centres within 1px when focused, and a second open column changes no width', async ({ page }) => {
    await openBoard(page, { width: 1440 });
    const expected = 660;
    const starId = 'col-6f708192';

    const ids = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col')]
        .map((el) => el.dataset.columnId));
    expect(ids).toHaveLength(7);

    // At load the starred column is the focus, and the only open one.
    const atLoad = await boardGeometry(page);
    expect(await focusedId(page)).toBe(starId);
    expect(atLoad.openWidths, 'one open column at load').toEqual([expected]);
    expect(Math.abs(atLoad.focusedCentre - atLoad.docWidth / 2), `${starId} centred`).toBeLessThanOrEqual(1);

    for (const id of ids.filter((entry) => entry !== starId)) {
        await col(page, id).locator('.col-strip').click();
        await settle(page);
        expect(await focusedId(page)).toBe(id);

        const geometry = await boardGeometry(page);
        expect(geometry.openWidths, `focus + star are both open with ${id} focused`)
            .toEqual([expected, expected]);
        expect(Math.abs(geometry.focusedCentre - geometry.docWidth / 2), `${id} centred`)
            .toBeLessThanOrEqual(1);
        expect(geometry.distinctTops, `${id}: still one row`).toBe(1);
        expect(geometry.docOverflowX, `${id}: no document overflow`).toBeLessThanOrEqual(1);
    }
});

test('at 1040 an open column is still 660, because the board is measured against the viewport', async ({ page }) => {
    // The container caps at 1040px; measuring the board against it would give the wrong answer here.
    await openBoard(page, { width: 1040 });
    const geometry = await boardGeometry(page);
    expect(Math.round(geometry.focusedWidth)).toBe(660);
    expect(geometry.boardWidth).toBe(geometry.docWidth);
    expect(geometry.boardLeft).toBe(0);
});

test('the board bleeds to the viewport while the controls row stays at container width, centred', async ({ page }) => {
    await openBoard(page, { width: 1440 });
    const measured = await page.evaluate(() => {
        const docWidth = document.documentElement.getBoundingClientRect().width;
        const board = document.querySelector('.eng-board .board').getBoundingClientRect();
        const controls = document.querySelector('.view-filters').getBoundingClientRect();
        const container = document.querySelector('.container').getBoundingClientRect();
        return {
            docWidth,
            boardWidth: Math.round(board.width),
            boardLeft: Math.round(board.left),
            controlsWidth: Math.round(controls.width),
            containerWidth: Math.round(container.width),
            containerLeft: Math.round(container.left),
            containerRight: Math.round(docWidth - container.right),
            docOverflowX: document.documentElement.scrollWidth - docWidth,
        };
    });

    expect(measured.boardWidth).toBe(measured.docWidth);
    expect(measured.boardLeft).toBe(0);
    expect(measured.containerWidth).toBe(1040);
    expect(measured.controlsWidth).toBeLessThanOrEqual(measured.containerWidth);
    expect(measured.containerLeft).toBe(measured.containerRight);
    expect(measured.docOverflowX).toBeLessThanOrEqual(1);
});

test('switching view modes never moves the centred container or the header controls', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900 });
    const frame = () => page.evaluate(() => {
        const edges = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top };
        };
        return {
            container: edges('.container'),
            subtitle: edges('.subtitle-main'),
            search: edges('.header-actions-row .control-search'),
            modes: edges('.view-selector .eng-mode-control'),
        };
    });
    const settled = async () => {
        await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await Promise.all(document.getAnimations({ subtree: true })
                .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
                .map(animation => animation.finished.catch(() => undefined)));
        });
        await page.waitForTimeout(400);
    };
    await settled();
    const board = await frame();

    for (const mode of ['Catch Up', 'Planning', 'Statistics', 'Scenario', 'Board']) {
        await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: mode }).click();
        await settled();
        expect(await frame(), `${mode} keeps every header edge where Board has it`).toEqual(board);
    }
});

test('focusing the search field never moves the title block or the rows below the header', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900 });
    const frame = () => page.evaluate(() => {
        const box = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        };
        return {
            header: box('header'),
            title: box('.subtitle-main'),
            logo: box('.subtitle-logo'),
            url: box('.subtitle-secondary'),
            search: { ...box('.header-actions-row .control-search'), right: document.querySelector('.header-actions-row .control-search').getBoundingClientRect().right },
            below: box('.view-selector'),
        };
    });
    const settled = async () => {
        await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await Promise.all(document.getAnimations({ subtree: true })
                .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
                .map(animation => animation.finished.catch(() => undefined)));
        });
        await page.waitForTimeout(400);
    };
    for (const width of [1280, 1100, 1028, 960, 800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('body').click({ position: { x: 2, y: 400 } });
        await settled();
        const idle = await frame();
        await page.getByRole('textbox', { name: 'Find in view' }).first().focus();
        await settled();
        const focused = await frame();
        if (width === 1280) {
            await page.screenshot({ path: path.join(screenshotDir, 'header-search-focused.png'), clip: { x: 0, y: 0, width: 1280, height: 140 }, animations: 'disabled' });
            expect(focused.search.width - idle.search.width, 'the focused field still widens, over the space to its left').toBe(140);
        }
        expect(focused.search.right, `${width}px: the focused field keeps its right edge`).toBe(idle.search.right);
        expect(focused.search.width, `${width}px: the focused field widens`).toBeGreaterThan(idle.search.width);
        expect(focused.title, `${width}px: the title block stays put while the search field is focused`).toEqual(idle.title);
        expect(focused.below, `${width}px: the controls row stays put`).toEqual(idle.below);
        expect(focused.header, `${width}px: the header keeps its box`).toEqual(idle.header);
    }
});

/* ── The folded rails are the chart (D9) ────────────────────────────────────────────────────── */

test('folded rails are a 340px track with the bar hanging from the top, scaled to the largest column', async ({ page }) => {
    await openBoard(page, FALLBACK_VIEWPORT);

    const rails = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col')]
        .filter((el) => !el.classList.contains('is-focused') && !el.classList.contains('is-open'))
        .map((el) => {
            const strip = el.querySelector('.col-strip');
            const fill = strip.querySelector('.fill');
            const stripRect = strip.getBoundingClientRect();
            const fillRect = fill.getBoundingClientRect();
            return {
                id: el.dataset.columnId,
                count: Number(strip.querySelector('.n').textContent),
                stripWidth: Math.round(stripRect.width),
                stripHeight: Math.round(stripRect.height),
                fillHeight: Math.round(fillRect.height),
                hangsFromTop: Math.abs(fillRect.top - stripRect.top) <= 2,
                label: strip.querySelector('.vert').textContent,
                labelTransform: getComputedStyle(strip.querySelector('.vert')).transform,
                labelWritingMode: getComputedStyle(strip.querySelector('.vert')).writingMode,
                labelFontSize: getComputedStyle(strip.querySelector('.vert')).fontSize,
                labelFontWeight: getComputedStyle(strip.querySelector('.vert')).fontWeight,
            };
        }));

    expect(rails.length).toBe(6);
    const scaleMax = 3;
    rails.forEach((rail) => {
        expect(rail.stripWidth, `${rail.id} strip width`).toBe(36);
        expect(rail.stripHeight, `${rail.id} track height`).toBe(340);
        expect(rail.hangsFromTop, `${rail.id} bar hangs from the top`).toBe(true);
        // Proportional to the largest column, within a rounding pixel.
        expect(Math.abs(rail.fillHeight - (rail.count / scaleMax) * 340), `${rail.id} bar length`)
            .toBeLessThanOrEqual(2);
        // D18: rotated 180deg on top of vertical-rl, so whole words read bottom-to-top.
        expect(rail.labelWritingMode, `${rail.id} label writing mode`).toBe('vertical-rl');
        expect(rail.labelTransform, `${rail.id} label rotation`).toBe('matrix(-1, 0, 0, -1, 0, 0)');
        expect(rail.labelFontSize, `${rail.id} label size`).toBe('11.84px'); // 0.74rem
        expect(rail.labelFontWeight, `${rail.id} label weight`).toBe('600');
    });

    // The full track equals the largest column, stated in the on-demand help rather than a
    // persistent configured-Board wallpaper.
    await page.getByRole('button', { name: 'How Group Board works' }).click();
    await expect(page.getByRole('dialog', { name: 'How Group Board works' }))
        .toContainText(`The tallest bar represents ${scaleMax} epics.`);
});

test('a low folded-rail count stays readable with a short fill', async ({ page }) => {
    const epicSpecs = [
        ...Array.from({ length: 19 }, (_, index) => [`PLAT-${index + 1}`, 'In Progress', 'Major']),
        ['PLAT-20', 'Blocked', 'Major'],
    ];
    await openBoard(page, { epicSpecs });

    const contrast = await col(page, 'col-5e6f7081').locator('.col-strip').evaluate((strip) => {
        const count = strip.querySelector('.n');
        const label = strip.querySelector('.vert');
        return {
            count: count.textContent,
            countColor: getComputedStyle(count).color,
            primaryTextColor: getComputedStyle(label).color,
        };
    });

    expect(contrast.count).toBe('1');
    expect(contrast.countColor).toBe(contrast.primaryTextColor);
    await page.screenshot({ path: `${screenshotDir}/board-low-count-contrast-1280.png`, fullPage: false });
});

/* ── Off-frame hints are a control, not decoration ──────────────────────────────────────────── */

test('the off-frame hint appears only when a column is off-frame, counts them, and focuses the next one', async ({ page }) => {
    await openBoard(page, { width: 1280 });

    // One open column at 1280: everything fits, so neither hint is on.
    const atRest = await page.evaluate(() => ({
        left: document.querySelector('.eng-board .board-hint.left').classList.contains('is-on'),
        right: document.querySelector('.eng-board .board-hint.right').classList.contains('is-on'),
    }));
    expect(atRest.left).toBe(false);
    expect(atRest.right).toBe(false);

    // Focusing the first column opens two (focus + star), which pushes columns off the frame.
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);

    const hints = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board').getBoundingClientRect();
        // Corroborating, NOT independent: this repeats production's own edge rule, so a wrong
        // epsilon or a flipped direction would move both sides of the comparison together. The
        // fixture-derived literal below is the assertion that can actually fail on its own.
        const outside = { left: 0, right: 0 };
        document.querySelectorAll('.eng-board .col').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.right < board.left + 4) outside.left += 1;
            else if (rect.left > board.right - 4) outside.right += 1;
        });
        const right = document.querySelector('.eng-board .board-hint.right');
        return {
            outside,
            rightOn: right.classList.contains('is-on'),
            rightCount: Number(right.querySelector('b').textContent),
        };
    });
    // Derived from the fixture, not from the DOM: at 1280 with To do focused and In progress
    // starred, the row is 660 + 4x36 + 660 + 36 + 6x8 gaps = 1548 laid out from x=0 after a 310px
    // centring pad, so exactly one column — Done, the last — starts beyond the frame's right edge.
    expect(hints.rightCount).toBe(1);
    expect(hints.rightOn).toBe(true);
    expect(hints.outside.right).toBe(hints.rightCount);
    expect(hints.outside.left).toBe(0);

    // Clicking it focuses the next column in that direction — a control, not decoration.
    await page.locator('.eng-board .board-hint.right .pip').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-2b3c4d5e');
    await expectExactlyOneFocused(page, 'after clicking the right off-frame hint');
});

test('prefers-reduced-motion suppresses the hint nudge and the breach glow animation', async ({ page }) => {
    await openBoard(page, { width: 800, reducedMotion: true });
    const animations = await page.evaluate(() => ({
        pip: getComputedStyle(document.querySelector('.eng-board .board-hint .pip')).animationName,
        breach: getComputedStyle(document.querySelector('.eng-board .col.is-breach .col-strip')).animationName,
    }));
    expect(animations.pip).toBe('none');
    expect(animations.breach).toBe('none');
});

/* ── Breach glow, and the red accent it must stay distinguishable from (D24) ────────────────── */

test('a breach glows and states itself in words in both directions, and a red accent does not', async ({ page }) => {
    await openBoard(page);

    // Analysis: 1 epic against min 4.
    const analysis = col(page, 'col-2b3c4d5e');
    await expect(analysis).toHaveClass(/is-breach/);
    await expect(analysis.locator('.col-strip')).toHaveAttribute('title', /3 under min 4/);

    // In progress: 3 epics against max 1. It is the open column, so the words are on the header.
    const inProgress = col(page, 'col-6f708192');
    await expect(inProgress).toHaveClass(/is-breach/);
    await expect(inProgress.locator('.col-breach')).toContainText('2 over max 1');
    await expect(inProgress.locator('.col-breach')).toBeVisible();

    // External block is RED (#ff4d4f) and 1 epic against max 5: an accent, not a breach.
    const external = col(page, 'col-5e6f7081');
    await expect(external).not.toHaveClass(/is-breach/);

    const distinguishable = await page.evaluate(() => {
        const read = (id) => {
            const el = document.querySelector(`.eng-board .col[data-column-id="${id}"]`);
            const strip = el.querySelector('.col-strip');
            const fill = strip.querySelector('.fill');
            return {
                accent: getComputedStyle(el).getPropertyValue('--board-column-accent').trim(),
                shadow: getComputedStyle(strip).boxShadow,
                animation: getComputedStyle(strip).animationName,
                fillBackground: getComputedStyle(fill).backgroundColor,
                breachTextVisible: getComputedStyle(el.querySelector('.col-breach')).display !== 'none',
            };
        };
        return { external: read('col-5e6f7081'), analysis: read('col-2b3c4d5e') };
    });

    // Same red family, opposite signals: the accent is a fill, the breach is a border plus a glow.
    expect(distinguishable.external.accent).toBe('#ff4d4f');
    expect(distinguishable.external.shadow).toBe('none');
    expect(distinguishable.external.animation).toBe('none');
    expect(distinguishable.external.breachTextVisible).toBe(false);
    expect(distinguishable.analysis.shadow).not.toBe('none');
    expect(distinguishable.analysis.animation).toBe('board-breach-glow');
    expect(distinguishable.analysis.breachTextVisible).toBe(true);
    expect(distinguishable.external.fillBackground).not.toBe(distinguishable.analysis.fillBackground);
});

/* ── A group with no board config still renders exactly one focused column ──────────────────── */

test('configured Board replaces the instruction wallpaper with compact on-demand help', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 720, reducedMotion: true });

    await expect(page.locator('.eng-board .board-head-title')).toHaveCount(0);
    await expect(page.locator('.eng-board .board-head-sub')).toHaveCount(0);
    const helpTrigger = page.getByRole('button', { name: 'How Group Board works' });
    await expect(helpTrigger).toBeVisible();
    await expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: 'How Group Board works' })).toHaveCount(0);

    const closedGeometry = await page.evaluate(() => {
        const wrap = document.querySelector('.filterbar-wrap').getBoundingClientRect();
        const board = document.querySelector('.eng-board .board-scroll').getBoundingClientRect();
        const announcement = document.querySelector('.eng-board .board-say').getBoundingClientRect();
        return {
            gap: board.top - wrap.bottom,
            announcementWidth: announcement.width,
            announcementHeight: announcement.height,
        };
    });
    expect(Math.abs(closedGeometry.gap)).toBeLessThanOrEqual(1);
    expect(closedGeometry.announcementWidth).toBeLessThanOrEqual(1);
    expect(closedGeometry.announcementHeight).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${screenshotDir}/board-configured-help-closed-1280.png`, fullPage: false });

    await helpTrigger.click();
    const help = page.getByRole('dialog', { name: 'How Group Board works' });
    await expect(help).toBeVisible();
    await expect(help).toBeFocused();
    await expect(helpTrigger).toHaveAttribute('aria-expanded', 'true');
    const openGeometry = await help.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const copy = node.querySelector('.board-help-copy');
        return {
            width: rect.width,
            left: rect.left,
            right: rect.right,
            viewport: document.documentElement.clientWidth,
            textTransform: getComputedStyle(copy).textTransform,
            copyFontSize: parseFloat(getComputedStyle(copy).fontSize),
        };
    });
    expect(openGeometry.width).toBeLessThanOrEqual(512 + 1);
    expect(openGeometry.left).toBeGreaterThanOrEqual(11);
    expect(openGeometry.right).toBeLessThanOrEqual(openGeometry.viewport - 11);
    expect(openGeometry.textTransform).toBe('none');
    expect(openGeometry.copyFontSize).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: `${screenshotDir}/board-configured-help-open-1280.png`, fullPage: false });

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(helpTrigger).toBeFocused();

    await helpTrigger.click();
    const filtersTrigger = page.getByRole('button', { name: /^Filters/ });
    await filtersTrigger.click();
    await expect(help).toHaveCount(0);
    await expect(filtersTrigger).toBeFocused();
});

test('Board help icon is centered within its trigger', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 720, reducedMotion: true });

    const trigger = page.getByRole('button', { name: 'How Group Board works' });
    const icon = trigger.locator('.board-help-icon');
    await expect(icon).toBeVisible();

    const geometry = await trigger.evaluate((node) => {
        const triggerRect = node.getBoundingClientRect();
        const iconRect = node.querySelector('.board-help-icon').getBoundingClientRect();
        return {
            horizontalOffset: (iconRect.left + iconRect.width / 2)
                - (triggerRect.left + triggerRect.width / 2),
            verticalOffset: (iconRect.top + iconRect.height / 2)
                - (triggerRect.top + triggerRect.height / 2),
        };
    });
    expect(Math.abs(geometry.horizontalOffset)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.verticalOffset)).toBeLessThanOrEqual(0.5);
    await page.screenshot({ path: `${screenshotDir}/board-help-icon-centered-1280.png`, fullPage: false });
});

test('open Board help recalculates its width and viewport gutters after resize', async ({ page }) => {
    await openBoard(page, { width: 375, height: 720, reducedMotion: true });

    await page.getByRole('button', { name: 'How Group Board works' }).click();
    const help = page.getByRole('dialog', { name: 'How Group Board works' });
    await expect(help).toBeVisible();
    const readGeometry = () => help.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
            width: rect.width,
            left: rect.left,
            right: rect.right,
            viewport: document.documentElement.clientWidth,
        };
    });

    const narrow = await readGeometry();
    expect(narrow.width).toBeLessThanOrEqual(351 + 1);
    expect(narrow.left).toBeGreaterThanOrEqual(11);
    expect(narrow.right).toBeLessThanOrEqual(narrow.viewport - 11);

    await page.setViewportSize({ width: 900, height: 520 });
    await expect.poll(async () => (await readGeometry()).width).toBeGreaterThanOrEqual(511);
    await expect.poll(async () => {
        const geometry = await readGeometry();
        return geometry.left >= 11 && geometry.right <= geometry.viewport - 11;
    }).toBe(true);
    const landscape = await readGeometry();
    expect(landscape.width).toBeGreaterThanOrEqual(511);
    expect(landscape.width).toBeLessThanOrEqual(512 + 1);
    expect(landscape.left).toBeGreaterThanOrEqual(11);
    expect(landscape.right).toBeLessThanOrEqual(landscape.viewport - 11);

    await page.setViewportSize({ width: 320, height: 620 });
    await expect.poll(async () => (await readGeometry()).width).toBeLessThanOrEqual(296 + 1);
    await expect.poll(async () => {
        const geometry = await readGeometry();
        return geometry.left >= 11 && geometry.right <= geometry.viewport - 11;
    }).toBe(true);
    const compact = await readGeometry();
    expect(compact.width).toBeLessThanOrEqual(296 + 1);
    expect(compact.left).toBeGreaterThanOrEqual(11);
    expect(compact.right).toBeLessThanOrEqual(compact.viewport - 11);
    await page.screenshot({ path: `${screenshotDir}/board-configured-help-resized-320.png`, fullPage: false });
});

test('a never-configured group gets a first-run column that says so and offers the composer', async ({ page }) => {
    await openBoard(page, { board: null });
    await expectExactlyOneFocused(page, 'no board config');
    await expect(page.locator('.eng-board .col')).toHaveCount(1);
    await expect(page.locator('.eng-board .col.is-focused .col-head .ct')).toHaveText('10');

    // "Unmapped" means "your configuration forgot these statuses" — the wrong thing to say to
    // someone who has not configured anything (§6.1).
    await expect(page.locator('.eng-board .col.is-focused .col-head .nm')).not.toHaveText('Unmapped');
    await expect(page.locator('.eng-board')).not.toContainText('Unmapped');
    await expect(page.locator('.eng-board .board-first-run')).toBeVisible();
    await expect(page.locator('.eng-board .board-first-run')).toContainText('not set up');

    // The link is what makes the state actionable: it opens Settings -> Departments -> Boards.
    const configure = page.locator('.eng-board .board-configure');
    await expect(configure).toBeVisible();
    await configure.click();
    await expect(page.locator('#department-settings-boards-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#department-settings-boards-panel')).toBeVisible();
});

test('a configured board offers no first-run state, and places statuses no column holds in its first column', async ({ page }) => {
    // One column, so nine of the ten epics have a status it does not hold. Since #202 there is no
    // synthetic Unmapped column: that work is To Do work and renders in the first column.
    await openBoard(page, {
        board: { columns: [BOARD_COLUMNS[0]] },
    });
    await expectExactlyOneFocused(page, 'configured board with leftovers');
    await expect(page.locator('.eng-board .board-first-run')).toHaveCount(0);
    await expect(page.locator('.eng-board .board-configure')).toHaveCount(0);
    await expect(page.locator('.eng-board .col')).toHaveCount(1);
    await expect(col(page, BOARD_COLUMNS[0].id).locator('.col-head .ct')).toHaveText(String(EPIC_SPECS.length));
    await expect(col(page, BOARD_COLUMNS[0].id).locator('.ecard')).toHaveCount(EPIC_SPECS.length);
    await expect(page.locator('.eng-board')).not.toContainText('Unmapped');
});

/* ── Carried from Task 11: an affordance that promises nothing is a review stop (D38/D46) ───── */

test('star and Fold are withdrawn on a one-column board, and still render on a multi-column one', async ({ page }) => {
    // The first-run board (§6.1) is the one-column case: folding the only column is impossible
    // (the focus invariant forbids it) and starring it changes nothing visible.
    await openBoard(page, { board: null });
    await expect(page.locator('.eng-board .col')).toHaveCount(1);
    await expect(page.locator('.eng-board .col-star')).toHaveCount(0);
    await expect(page.locator('.eng-board .fold')).toHaveCount(0);

    // The reference configuration is multi-column: both controls render on every column.
    await openBoard(page);
    const columnCount = await page.locator('.eng-board .col').count();
    expect(columnCount).toBeGreaterThan(1);
    await expect(page.locator('.eng-board .col-star')).toHaveCount(columnCount);
    await expect(page.locator('.eng-board .fold')).toHaveCount(columnCount);
});

/* ── §6.1.1 / D28: the board sits under the compact sticky header, hit-tested ───────────────── */

test('the compact sticky header paints over the board, including the off-frame hint', async ({ page }) => {
    // Short viewport so the controls row scrolls away and the compact header takes over, and
    // narrow enough that the off-frame hint — the board's only positioned, z-indexed element — is on.
    await openBoard(page, { ...FALLBACK_VIEWPORT, reducedMotion: true });
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(
        () => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'),
        null,
        { timeout: 5000 },
    );
    await settle(page);

    const layering = await page.evaluate(() => {
        const compactEl = document.querySelector('.compact-sticky-header');
        const compact = compactEl.getBoundingClientRect();
        const hint = document.querySelector('.eng-board .board-hint.is-on');
        const focused = document.querySelector('.eng-board .col.is-focused');
        // Hit-test over the focused column, not over the hint: the hint strip is deliberately
        // `pointer-events: none` (only its pip takes clicks), so elementFromPoint would skip it
        // however high its z-index went. The z-index comparison below is what pins the hint.
        const target = focused.getBoundingClientRect();
        const overlapTop = Math.max(compact.top, target.top);
        const overlapBottom = Math.min(compact.bottom, target.bottom);
        const probe = document.elementFromPoint(
            target.left + target.width / 2,
            (overlapTop + overlapBottom) / 2,
        );
        return {
            overlaps: overlapBottom > overlapTop,
            hitIsCompact: Boolean(probe?.closest('.compact-sticky-header')),
            hintZ: getComputedStyle(hint).zIndex,
            compactZ: getComputedStyle(compactEl).zIndex,
            docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(layering.overlaps, 'the compact header and the board actually overlap').toBe(true);
    expect(layering.hitIsCompact).toBe(true);
    expect(Number(layering.hintZ)).toBeLessThan(Number(layering.compactZ));
    expect(Number(layering.compactZ)).toBe(70); // --sticky-compact-z, resolved not declared
    expect(layering.docOverflowX).toBeLessThanOrEqual(1);
});

test('open headers and every collapsed rail pin below the live sticky stack without moving the board', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 10 }, (_, index) => [
            `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];

    await openBoard(page, {
        ...FALLBACK_VIEWPORT,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });

    // The compact header changes existing page flow as it first appears. Establish its live
    // sticky stack before measuring whether promoting board chrome moves the board itself.
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const before = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const card = document.querySelector('.eng-board .col.is-focused .ecard');
        const rect = card.getBoundingClientRect();
        return {
            height: board.getBoundingClientRect().height,
            cardDocumentTop: rect.top + window.scrollY,
        };
    });

    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${screenshotDir}/board-pinned-800.png`, fullPage: false });

    const pinned = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const stickyTop = parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0;
        const filterBottom = document.querySelector('.filterbar-wrap').getBoundingClientRect().bottom;
        const chromes = [...board.querySelectorAll('.col')].map((column) => {
            const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
            const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
            const columnRect = column.getBoundingClientRect();
            const chromeRect = chrome.getBoundingClientRect();
            return {
                top: chromeRect.top,
                left: chromeRect.left,
                width: chromeRect.width,
                columnLeft: columnRect.left,
                columnWidth: columnRect.width,
                widthTransitions: chrome.getAnimations().filter((animation) => (
                    animation instanceof CSSTransition && animation.transitionProperty === 'width'
                )).length,
            };
        });
        const card = document.querySelector('.eng-board .col.is-focused .ecard').getBoundingClientRect();
        return {
            chromePinned: board.classList.contains('is-chrome-pinned'),
            stickyTop,
            filterBottom,
            chromes,
            height: board.getBoundingClientRect().height,
            cardDocumentTop: card.top + window.scrollY,
            docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(pinned.chromePinned).toBe(true);
    pinned.chromes.forEach((chrome, index) => {
        expect(chrome.widthTransitions, `chrome ${index} has no active width transition`).toBe(0);
        expect(Math.abs(chrome.top - pinned.stickyTop), `chrome ${index} top`).toBeLessThanOrEqual(1);
        expect(Math.abs(chrome.left - chrome.columnLeft), `chrome ${index} left`).toBeLessThanOrEqual(1);
        expect(Math.abs(chrome.width - chrome.columnWidth), `chrome ${index} width`).toBeLessThanOrEqual(1);
        expect(chrome.top, `chrome ${index} remains below the sticky filter surface`).toBeGreaterThanOrEqual(pinned.filterBottom - 1);
    });
    expect(Math.abs(pinned.height - before.height), 'board height remains stable').toBeLessThanOrEqual(1);
    expect(Math.abs(pinned.cardDocumentTop - before.cardDocumentTop), 'card document top remains stable').toBeLessThanOrEqual(1);
    expect(pinned.docOverflowX).toBeLessThanOrEqual(1);
});

test('only a pointer click on a folded rail reveals its first card below the live sticky header', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 32 }, (_, index) => [
            `PLAT-REVEAL-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];

    await openBoard(page, {
        ...FALLBACK_VIEWPORT,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const before = await page.evaluate(() => ({
        scrollY: window.scrollY,
        boardScrollLeft: document.querySelector('.eng-board .board').scrollLeft,
    }));

    await col(page, 'col-5e6f7081').locator('.col-strip').click();
    await settle(page);

    const revealed = await page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const opened = document.querySelector('.eng-board .col[data-column-id="col-5e6f7081"]');
        const existingOpen = document.querySelector('.eng-board .col[data-column-id="col-6f708192"]');
        const header = opened.querySelector('.col-head');
        const openedCard = opened.querySelector('.ecard');
        const existingCard = existingOpen.querySelector('.ecard');
        const boardRect = board.getBoundingClientRect();
        const openedRect = opened.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return {
            scrollY: window.scrollY,
            boardScrollLeft: board.scrollLeft,
            stickyTop: parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
            headerTop: headerRect.top,
            headerBottom: headerRect.bottom,
            headerMarginBottom: parseFloat(getComputedStyle(header).marginBottom) || 0,
            openedCardTop: openedCard.getBoundingClientRect().top,
            existingCardTop: existingCard.getBoundingClientRect().top,
            openedCentre: openedRect.left + openedRect.width / 2,
            boardCentre: boardRect.left + board.clientWidth / 2,
        };
    });

    expect(revealed.scrollY, 'pointer opening a folded rail reveals the first epic above the old page position')
        .toBeLessThan(before.scrollY - 1);
    expect(Math.abs(revealed.headerTop - revealed.stickyTop), 'the opened column uses the live sticky stack')
        .toBeLessThanOrEqual(1);
    expect(Math.abs(revealed.openedCardTop - (revealed.headerBottom + revealed.headerMarginBottom)),
        'the first opened card begins immediately below its header').toBeLessThanOrEqual(1);
    expect(Math.abs(revealed.openedCardTop - revealed.existingCardTop),
        'both open columns begin at the same viewport top').toBeLessThanOrEqual(1);
    expect(Math.abs(revealed.openedCentre - revealed.boardCentre),
        'the existing horizontal centering remains intact').toBeLessThanOrEqual(1);
    expect(revealed.boardScrollLeft).not.toBe(before.boardScrollLeft);
    await page.screenshot({ path: `${screenshotDir}/board-folded-rail-reveal-800.png`, fullPage: false });

    const emptyBoard = {
        columns: [
            ...BOARD_COLUMNS.slice(0, 5),
            {
                id: 'col-empty-reveal', name: 'Empty reveal', colour: '#8c8c8c', star: false,
                min: null, max: null, statuses: ['Nothing'],
            },
            ...BOARD_COLUMNS.slice(5),
        ],
    };
    await openBoard(page, {
        ...FALLBACK_VIEWPORT,
        reducedMotion: true,
        board: emptyBoard,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const beforeEmptyRail = await page.evaluate(() => window.scrollY);
    await col(page, 'col-empty-reveal').locator('.col-strip').click();
    await settle(page);
    expect(await page.evaluate(() => window.scrollY), 'an empty folded column leaves vertical position alone')
        .toBe(beforeEmptyRail);

    await openBoard(page, {
        ...FALLBACK_VIEWPORT,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const beforeKeyboard = await page.evaluate(() => window.scrollY);
    const keyboardRail = col(page, 'col-5e6f7081').locator('.col-strip');
    await keyboardRail.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await page.evaluate(() => window.scrollY), 'keyboard focus leaves vertical position alone')
        .toBe(beforeKeyboard);
});

test('non-rail Board interactions never reveal the page vertically', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 32 }, (_, index) => [
            `PLAT-NO-REVEAL-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];
    const openPinnedBoard = async () => {
        // Width-gated fallback: 380px-tall FALLBACK_VIEWPORT leaves no clear band for the hint pips.
        await openBoard(page, {
            width: 760,
            height: 620,
            reducedMotion: true,
            epicSpecs: longSpecs,
        });
        await page.evaluate(() => {
            const sentinel = document.createElement('div');
            sentinel.className = 'board-no-reveal-sentinel';
            sentinel.style.height = '1000px';
            document.querySelector('.eng-board').after(sentinel);
        });
        await page.evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
        await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    };
    const expectNoPostGestureReveal = async (label, selector, eventName, action) => {
        await page.evaluate(({ targetSelector, type }) => {
            const target = document.querySelector(targetSelector);
            window.__boardGestureScrollY = null;
            target.addEventListener(type, () => {
                window.__boardGestureScrollY = window.scrollY;
            }, { capture: true, once: true });
        }, { targetSelector: selector, type: eventName });
        const result = await action();
        await settle(page);
        const scroll = await page.evaluate(() => ({
            atGesture: window.__boardGestureScrollY,
            afterSettling: window.scrollY,
        }));
        expect(scroll.atGesture, `${label}: the real gesture reached the Board`).not.toBeNull();
        expect(scroll.afterSettling, label).toBe(scroll.atGesture);
        return result;
    };

    await openPinnedBoard();
    const star = col(page, 'col-6f708192').locator('.col-star');
    await expectNoPostGestureReveal(
        'changing the session star does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .col-star',
        'click',
        () => star.click(),
    );
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expectNoPostGestureReveal(
        'folding the focused header does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .col-head',
        'click',
        () => col(page, 'col-6f708192').locator('.col-head').click(),
    );
    expect(await focusedId(page)).toBe('col-5e6f7081');

    await openPinnedBoard();
    await expect(page.locator('.eng-board .board-hint.left .pip')).toBeVisible();
    await expectNoPostGestureReveal(
        'the previous-column off-frame hint does not trigger a later vertical reveal',
        '.eng-board .board-hint.left',
        'click',
        () => page.locator('.eng-board .board-hint.left .pip').click(),
    );
    expect(await focusedId(page)).toBe('col-5e6f7081');
    await expect(page.locator('.eng-board .board-hint.right .pip')).toBeVisible();
    await expectNoPostGestureReveal(
        'the next-column off-frame hint does not trigger a later vertical reveal',
        '.eng-board .board-hint.right',
        'click',
        () => page.locator('.eng-board .board-hint.right .pip').click(),
    );
    expect(await focusedId(page)).toBe('col-6f708192');

    await openPinnedBoard();
    const keyboardFold = col(page, 'col-6f708192').locator('.col-star');
    await expectNoPostGestureReveal(
        'releasing the star before keyboard folding does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .col-star',
        'click',
        () => keyboardFold.click(),
    );
    const fold = col(page, 'col-6f708192').locator('.fold');
    await fold.focus();
    await expectNoPostGestureReveal(
        'keyboard folding does not trigger a later vertical reveal',
        '.eng-board .col[data-column-id="col-6f708192"] .fold',
        'click',
        () => page.keyboard.press('Enter'),
    );
    expect(await focusedId(page)).toBe('col-5e6f7081');

    await openPinnedBoard();
    const transitionOptionBodies = [];
    const transitionWrites = [];
    await page.route('**/api/board-config/statuses', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            statuses: [{ id: '10003', name: 'Blocked', statusCategoryKey: 'new' }],
        }),
    }));
    await page.route('**/api/issues/transitions/options', (route) => {
        transitionOptionBodies.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                issues: [{
                    key: 'PLAT-8',
                    issueType: 'Epic',
                    currentStatus: 'In Progress',
                    transitions: [{ name: 'Go Blocked', toStatus: 'Blocked' }],
                }],
                targetStatuses: [{ name: 'Blocked', availableCount: 1, blockedCount: 0 }],
            }),
        });
    });
    await page.route('**/api/issues/transitions', (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        transitionWrites.push(body);
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                targetStatus: body.targetStatus,
                results: body.issueKeys.map((key) => ({ key, result: 'success', toStatus: body.targetStatus })),
            }),
        });
    });
    const source = page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]');
    const target = col(page, 'col-5e6f7081');
    await expect(source).toHaveAttribute('draggable', 'true');
    const dragOutcome = await expectNoPostGestureReveal(
        'dragging a card onto a folded column does not trigger a later vertical reveal',
        '.eng-board .ecard[data-epic-key="PLAT-8"]',
        'dragstart',
        () => page.evaluate(() => {
            const dragSource = document.querySelector('.eng-board .ecard[data-epic-key="PLAT-8"]');
            const dropTarget = document.querySelector('.eng-board .col[data-column-id="col-5e6f7081"]');
            const dataTransfer = new DataTransfer();
            const rect = dropTarget.getBoundingClientRect();
            const make = (type) => new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientX: Math.round(rect.left + rect.width / 2),
                clientY: Math.round(rect.top + Math.min(rect.height / 2, 160)),
            });
            const start = make('dragstart');
            dragSource.dispatchEvent(start);
            dropTarget.dispatchEvent(make('dragenter'));
            const over = make('dragover');
            dropTarget.dispatchEvent(over);
            dropTarget.dispatchEvent(make('drop'));
            dragSource.dispatchEvent(make('dragend'));
            return { started: !start.defaultPrevented, overAccepted: over.defaultPrevented };
        }),
    );
    expect(dragOutcome).toEqual({ started: true, overAccepted: true });
    await expect.poll(() => transitionWrites.length).toBe(1);
    expect(transitionOptionBodies).toEqual([{ issueKeys: ['PLAT-8'] }]);
    expect(transitionWrites).toEqual([{ issueKeys: ['PLAT-8'], targetStatus: 'Blocked' }]);
    await expect(source).toHaveCount(0);
    await expect(target.locator('.col-strip .n')).toHaveText('2');
});

test('pinned chrome stays interactive and releases each element at the board bottom', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 10 }, (_, index) => [
            `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
        ]),
    ];

    await openBoard(page, {
        ...FALLBACK_VIEWPORT,
        reducedMotion: true,
        epicSpecs: longSpecs,
    });
    await page.evaluate(() => {
        const sentinel = document.createElement('div');
        sentinel.className = 'board-release-sentinel';
        sentinel.textContent = 'Later page content';
        sentinel.style.height = '500px';
        document.querySelector('.eng-board').after(sentinel);
    });
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'));
    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    // The External block rail is visible beside the focused column and remains a live focus target
    // after the board promotes it to fixed chrome.
    await col(page, 'col-5e6f7081').locator('.col-strip').click();
    await settle(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await focusedId(page)).toBe('col-5e6f7081');

    const centred = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col')].map((column) => {
        const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
        const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
        const columnRect = column.getBoundingClientRect();
        const chromeRect = chrome.getBoundingClientRect();
        return {
            left: chromeRect.left,
            width: chromeRect.width,
            columnLeft: columnRect.left,
            columnWidth: columnRect.width,
        };
    }));
    centred.forEach((chrome, index) => {
        expect(Math.abs(chrome.left - chrome.columnLeft), `centred chrome ${index} left`).toBeLessThanOrEqual(1);
        expect(Math.abs(chrome.width - chrome.columnWidth), `centred chrome ${index} width`).toBeLessThanOrEqual(1);
    });

    const fold = col(page, 'col-5e6f7081').locator('.fold');
    await fold.focus();
    await expect(fold).toBeFocused();
    await page.keyboard.press('Enter');
    await settle(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await focusedId(page)).toBe('col-6f708192');

    const releaseAt = async (selector) => {
        await page.evaluate((targetSelector) => {
            const board = document.querySelector('.eng-board .board');
            const chrome = document.querySelector(targetSelector);
            const stickyTop = parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0;
            const targetBottom = stickyTop + chrome.getBoundingClientRect().height - 0.5;
            window.scrollTo(0, window.scrollY + board.getBoundingClientRect().bottom - targetBottom);
        }, selector);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    const readRelease = () => page.evaluate(() => {
        const board = document.querySelector('.eng-board .board');
        const boardBottom = board.getBoundingClientRect().bottom;
        const chromes = [...board.querySelectorAll('.col')].map((column) => {
            const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
            const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
            const rect = chrome.getBoundingClientRect();
            return { type: isOpen ? 'header' : 'rail', bottom: rect.bottom };
        });
        const sentinel = document.querySelector('.board-release-sentinel');
        const sentinelRect = sentinel.getBoundingClientRect();
        const probe = document.elementFromPoint(400, Math.ceil(sentinelRect.top + 8));
        return {
            boardBottom,
            chromes,
            laterContentHit: Boolean(probe?.closest('.board-release-sentinel')),
            laterContentCovered: Boolean(probe?.closest('.eng-board .board.is-chrome-pinned .col-head, .eng-board .board.is-chrome-pinned .col-strip')),
        };
    });

    await releaseAt('.eng-board .col:not(.is-open):not(.is-focused) .col-strip');
    const railRelease = await readRelease();
    railRelease.chromes.forEach((chrome, index) => {
        expect(chrome.bottom, `rail release chrome ${index} remains inside the board`).toBeLessThanOrEqual(railRelease.boardBottom + 1);
    });
    expect(railRelease.chromes.some((chrome) => (
        chrome.type === 'rail' && Math.abs(chrome.bottom - railRelease.boardBottom) <= 1
    ))).toBe(true);

    await releaseAt('.eng-board .col.is-focused .col-head');
    const headerRelease = await readRelease();
    headerRelease.chromes.forEach((chrome, index) => {
        expect(chrome.bottom, `header release chrome ${index} remains inside the board`).toBeLessThanOrEqual(headerRelease.boardBottom + 1);
    });
    expect(headerRelease.chromes.some((chrome) => (
        chrome.type === 'header' && Math.abs(chrome.bottom - headerRelease.boardBottom) <= 1
    ))).toBe(true);
    expect(headerRelease.laterContentHit).toBe(true);
    expect(headerRelease.laterContentCovered).toBe(false);
});

/* ── Screenshots, settled ───────────────────────────────────────────────────────────────────── */

test('board renders at a wide and a narrow width', async ({ page }) => {
    await openBoard(page, { width: 1440, reducedMotion: true });
    await page.screenshot({ path: `${screenshotDir}/board-1440.png`, fullPage: false });

    await page.setViewportSize({ width: 800, height: 900 });
    await settle(page);
    await page.screenshot({ path: `${screenshotDir}/board-800.png`, fullPage: false });

    const geometryBefore = await boardGeometry(page);
    expect(geometryBefore.distinctTops).toBe(1);
    expect(geometryBefore.docOverflowX).toBeLessThanOrEqual(1);
});

// §12.2/§12.11: the computed transform is asserted per rail above, but the plan is explicit that
// "the transform value alone does not prove reading direction" — a clipped capture of one rail is
// the other half, and it is the only artifact a human can read the label off.
test('a clipped rail capture shows the label reading bottom-to-top', async ({ page }) => {
    await openBoard(page, { width: 1440, reducedMotion: true });

    const rail = col(page, 'col-1a2b3c4d').locator('.col-strip');
    const box = await rail.boundingBox();
    expect(box, 'the To do rail must be on screen to be clipped').not.toBeNull();
    await page.screenshot({
        path: `${screenshotDir}/rail-label-to-do.png`,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });

    // The capture is only evidence if it really is a vertical rail carrying the whole label.
    const label = await rail.locator('.vert').evaluate((node) => ({
        text: node.textContent,
        writingMode: getComputedStyle(node).writingMode,
        transform: getComputedStyle(node).transform,
        clipped: node.scrollWidth - node.clientWidth,
        taller: node.getBoundingClientRect().height > node.getBoundingClientRect().width,
    }));
    expect(label.text).toBe('To do');
    expect(label.writingMode).toBe('vertical-rl');
    expect(label.transform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    expect(label.clipped, 'the rail label must not be clipped').toBeLessThanOrEqual(1);
    expect(label.taller, 'a vertical label is taller than it is wide').toBe(true);
});

// tests/test_eng_board_styles.js proves every `var()` in board.css is DECLARED somewhere in the
// concatenated source — under any selector, which is weaker than it looks: a token declared on an
// unrelated block still counts, while at runtime the declaration reading it silently drops. Six
// phantom variables were found in this plan's assets, so the same list is re-checked here against
// the live cascade, which is the property that actually matters.
test('every custom property board.css reads resolves on the live board', async ({ page }) => {
    const boardCssSource = fs
        .readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'eng', 'board.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // Reads WITHOUT a fallback only: `var(--x, 3px)` cannot drop its declaration, so it is not the
    // failure mode this guards, and `--board-hint-nudge` is legitimately set on the pip alone.
    const names = [...new Set(
        [...boardCssSource.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((match) => match[1])
    )];
    expect(names.length, 'expected board.css to read custom properties').toBeGreaterThan(0);

    await openBoard(page, {
        ...FALLBACK_VIEWPORT,
        reducedMotion: true,
        epicSpecs: [
            ...EPIC_SPECS,
            ...Array.from({ length: 10 }, (_, index) => [
                `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
            ]),
        ],
    });
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector('.compact-sticky-header')?.classList.contains('is-visible'));
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('.eng-board .board')?.classList.contains('is-chrome-pinned'));
    const resolve = (props) => page.evaluate((list) => {
        const hosts = [
            '.eng-board', '.eng-board .col', '.eng-board .col-strip', '.eng-board .ecard',
            '.eng-board .board-hint .pip',
        ]
            .map((selector) => document.querySelector(selector))
            .filter(Boolean);
        hosts.push(document.documentElement);
        return list.filter((name) => hosts
            .every((host) => getComputedStyle(host).getPropertyValue(name).trim() === ''));
    }, props);

    expect(await resolve(names), 'a var() that resolves nowhere drops its whole declaration').toEqual([]);
    // Non-vacuous: the same probe reports a token that genuinely does not exist.
    expect(await resolve(['--not-a-real-token'])).toEqual(['--not-a-real-token']);
});

// §12.2: the mockups carried `.shell`, `.seg`, `.field` and `.compact-inner` for several revisions
// while the document claimed real classes. None may reach production.
test('no mockup-only chrome class renders anywhere in Board', async ({ page }) => {
    await openBoard(page, { width: 1440 });

    const found = await page.evaluate(() => {
        const shadow = ['shell', 'seg', 'field', 'compact-inner'];
        return shadow.filter((name) => document.querySelectorAll(`.${name}`).length > 0);
    });
    expect(found, 'mockup-only chrome classes must not render').toEqual([]);

    // Non-vacuous: the same probe finds the classes the board really does use.
    const real = await page.evaluate(() => ['eng-board', 'col', 'col-strip', 'container']
        .filter((name) => document.querySelectorAll(`.${name}`).length > 0));
    expect(real).toEqual(['eng-board', 'col', 'col-strip', 'container']);
});

test('first-run board renders its own state', async ({ page }) => {
    await openBoard(page, { width: 1440, board: null, reducedMotion: true });
    await page.screenshot({ path: `${screenshotDir}/board-first-run-1440.png`, fullPage: false });

    const geometry = await boardGeometry(page);
    expect(geometry.distinctTops).toBe(1);
    expect(geometry.docOverflowX).toBeLessThanOrEqual(1);
});

// The regression that made the bleed CSS rather than JS: measured with NO settle, exactly as
// tests/ui/codebase_structure_smoke.spec.js measures after its own resizes. A JS-written pixel
// width leaves the board wider than the new viewport until its handler runs — 132px of document
// overflow going 1280 -> 1028, and 385px going 390 -> 375.
test('a resize never leaves the board wider than the viewport, even before anything settles', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 760 });
    for (const width of [1280, 1028, 760, 390, 375, 1440]) {
        await page.setViewportSize({ width, height: 760 });
        const measured = await page.evaluate(() => {
            const rect = document.querySelector('.eng-board .board').getBoundingClientRect();
            return {
                docWidth: document.documentElement.getBoundingClientRect().width,
                docOverflowX: document.documentElement.scrollWidth - document.documentElement.getBoundingClientRect().width,
                left: Math.round(rect.left),
                width: Math.round(rect.width),
            };
        });
        expect(measured.docOverflowX, `document overflow immediately after resizing to ${width}`)
            .toBeLessThanOrEqual(1);
        expect(measured.left, `board pinned to the viewport edge at ${width}`).toBe(0);
        expect(measured.width, `board bleeds to the viewport at ${width}`).toBe(measured.docWidth);
    }
});

test('pane mode turns on only for a wide fine-pointer viewport with enough height', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900 });
    expect(await isPaneMode(page)).toBe(true);

    await page.setViewportSize(FALLBACK_VIEWPORT);
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(0);

    await page.setViewportSize({ width: 420, height: 900 });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(1);
    await expect(page.locator('.eng-board .board-data-state')).toHaveCount(0);
});

test('the pane-mode height gate sits at the board top plus rail height, with hysteresis', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900 });
    const boundary = await page.evaluate(() => {
        const boardTop = document.querySelector('.eng-board .board').getBoundingClientRect().top + window.scrollY;
        const rail = parseFloat(getComputedStyle(document.querySelector('.eng-board')).getPropertyValue('--board-strip-h'));
        return Math.ceil(boardTop + rail);
    });
    await page.setViewportSize({ width: 1280, height: boundary });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: boundary - 5 });
    await expect(page.locator('.eng-board.is-pane-mode'), 'hysteresis keeps pane mode').toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: boundary - 10 });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(0);
    await expect(page.locator('.eng-board .board-data-state')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: boundary - 1 });
    await expect(page.locator('.eng-board.is-pane-mode'), 'turning on needs the full height').toHaveCount(0);
    // The alert that only renders while the gate fails must not hold the gate shut.
    await page.setViewportSize({ width: 1280, height: boundary });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(1);
    await expect(page.locator('.eng-board .board-data-state')).toHaveCount(0);
});

test('Board pane mode never shows the compact header and Catch Up still gets it', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 32 }, (_, index) => [`PLAT-IP-${index + 1}`, 'In Progress', 'Major']),
    ];
    await openBoard(page, { width: 1280, height: 700, reducedMotion: true, epicSpecs: longSpecs });
    expect(await isPaneMode(page)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.mouse.move(640, 60);
    await page.mouse.wheel(0, 2000);
    await waitTwoFrames(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(0);

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.locator('.eng-board')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
});

/* ── §12.9: focus and star are session view state and survive an unmount ────────────────────── */

// Both tests move focus AWAY from the default first, or they could not fail: the default is what
// a lost preference falls back to, so restoring "the default" proves nothing.
test('Board -> Statistics -> Board restores a non-default focused column', async ({ page }) => {
    await openBoard(page);
    expect(await focusedId(page)).toBe('col-6f708192'); // the starred default

    await col(page, 'col-3c4d5e6f').locator('.col-strip').click();
    await settle(page);
    expect(await focusedId(page)).toBe('col-3c4d5e6f');

    const modes = page.locator('.view-selector .eng-mode-control');
    await modes.getByRole('radio', { name: 'Statistics' }).click();
    await expect(page.locator('.eng-board')).toHaveCount(0);
    await modes.getByRole('radio', { name: 'Board' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);

    expect(await focusedId(page)).toBe('col-3c4d5e6f');
    await expectExactlyOneFocused(page, 'after a mode round-trip');
});

test('a group switch and back restores the focused column and the session star', async ({ page }) => {
    const group = (id, name) => ({
        id,
        name,
        teamIds: ['team-alpha'],
        teamLabels: { 'team-alpha': 'Alpha Team' },
        board: { columns: BOARD_COLUMNS },
    });
    await openBoard(page, { groups: [group('grp-default', 'Default'), group('grp-second', 'Second')] });

    // Move both preferences off their stored defaults.
    await col(page, 'col-6f708192').locator('.col-star').click();   // unstar the config star
    await settle(page);
    await col(page, 'col-708192a3').locator('.col-strip').click();  // focus the last column
    await settle(page);
    await col(page, 'col-708192a3').locator('.col-star').click();   // star it for the session
    await settle(page);
    expect(await focusedId(page)).toBe('col-708192a3');
    await expect(col(page, 'col-708192a3')).toHaveClass(/is-starred/);

    const groupToggle = page.locator('.view-selector .group-dropdown-toggle');
    await groupToggle.click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: 'Second' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    // A group that has never been opened starts from its own stored default, not the other's.
    expect(await focusedId(page)).toBe('col-6f708192');
    await expectExactlyOneFocused(page, 'after switching to a fresh group');

    await groupToggle.click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: 'Default' }).click();
    await page.waitForSelector('.eng-board .col');
    await settle(page);
    expect(await focusedId(page)).toBe('col-708192a3');
    await expect(col(page, 'col-708192a3')).toHaveClass(/is-starred/);
    await expect(col(page, 'col-6f708192')).not.toHaveClass(/is-starred/);
    await expectExactlyOneFocused(page, 'after switching back');
});

/* ── The star says what it is (§6.1): a session view preference, not shared config ──────────── */

test('the star control states that it is a session preference the composer overrides', async ({ page }) => {
    await openBoard(page);
    const star = col(page, 'col-6f708192').locator('.col-star');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toHaveAttribute('title', /this session/i);
    await expect(star).toHaveAttribute('title', /Group Board settings/i);
    await expect(star).toHaveAttribute('aria-label', /this session/i);

    await star.click();
    await settle(page);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(star).toHaveAttribute('title', /this session/i);
    await expect(star).toHaveAttribute('aria-label', /this session/i);
});

/* ── Accessibility and cleanup the review named ─────────────────────────────────────────────── */

test('the column header is a named region and adds no second tab stop beside Fold', async ({ page }) => {
    await openBoard(page);
    const head = col(page, 'col-6f708192').locator('.col-head');
    await expect(head).toHaveAttribute('role', 'group');
    await expect(head).toHaveAttribute('aria-label', /In progress/);
    // D26 keeps the whole header as the POINTER target; the keyboard target is Fold alone.
    expect(await head.evaluate((node) => node.getAttribute('tabindex'))).toBeNull();

    // A non-starred column's Fold names its column, so seven "Fold" buttons are not ambiguous.
    await col(page, 'col-1a2b3c4d').locator('.col-strip').click();
    await settle(page);
    await expect(col(page, 'col-1a2b3c4d').locator('.fold')).toHaveAttribute('aria-label', /To do/);
});

test('leaving Board removes the scrollbar-width and gutter-width custom properties it published', async ({ page }) => {
    await openBoard(page);
    const published = () => page.evaluate(() => ['--board-scrollbar-width', '--board-gutter-width']
        .map(name => document.documentElement.style.getPropertyValue(name)));
    expect((await published()).every(value => value !== '')).toBe(true);

    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.locator('.eng-board')).toHaveCount(0);
    expect(await published()).toEqual(['', '']);
});

test('All work preserves bounded partial cards after a hard limit and retries only on request', async ({ page }) => {
    await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        window.boardFetchCount = 0;
        window.fetch = (input, options) => {
            if (String(input).includes('/api/eng/board?')) {
                window.boardFetchCount += 1;
                const body = new ReadableStream({
                    start(controller) {
                        window.pushBoardFrame = frame => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
                    },
                });
                return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }));
            }
            return originalFetch(input, options);
        };
    });
    await openBoard(page, { strictBoard: true, sourceBundle: true, reducedMotion: false });
    const savedSprintRequestCount = await page.evaluate(() => window.boardFetchCount);
    await page.getByRole('button', { name: 'Select sprint' }).first().click();
    await page.getByText('All work', { exact: true }).first().click();
    await page.waitForFunction(() => typeof window.pushBoardFrame === 'function');
    const epic = { key: 'EXAMPLE-1', summary: 'Component epic loads first', status: { id: '2', name: 'In Progress' },
        priority: null, assignee: null, deliveryOwner: null, projectTrack: null, updated: null, parent: null, columnId: 'active' };
    const send = (sequence, body) => page.evaluate(frame => window.pushBoardFrame(frame), {
        protocolVersion: 1, generationId: 'progressive-test', sequence, ...body,
    });
    await send(0, { type: 'start', scope: 'all_work', scopeVersion: 'test-v1', scopeCohortDigest: 'a'.repeat(64),
        columns: [
            { id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false },
            { id: 'done', name: 'Done', color: '#52c41a', statusNames: ['Done'], terminal: true },
        ] });
    await send(1, { type: 'index', epics: [epic], membership: 'candidate' });
    const card = page.locator('.ecard[data-epic-key="EXAMPLE-1"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Loading work items');
    await expect(card).not.toContainText('0 of 0');
    await expect(card.locator('.erow2')).toHaveAttribute('aria-busy', 'true');
    await expect(card.locator('.erow2 > .status-pill')).toHaveCount(1);
    await expect(card.locator('.erow2 > .estories')).toContainText('Loading work items');
    expect(await card.locator('.board-loading-bar').first().evaluate(el => getComputedStyle(el).animationName)).toBe('board-loading-shimmer');
    await page.screenshot({ path: path.join(screenshotDir, 'progressive-epic-pending.png'), animations: 'disabled' });
    await card.locator('.ecard-open').click();
    const panel = page.getByRole('dialog');
    await expect(panel.locator('.board-child-loading .board-loading-bar')).toHaveCount(3);
    await expect(panel.locator('.board-child-loading')).toContainText('Loading work items');
    await expect(panel.locator('.board-child-loading')).toHaveAttribute('aria-busy', 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await panel.locator('.board-loading-bar').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await page.screenshot({ path: path.join(screenshotDir, 'progressive-epic-panel.png'), animations: 'disabled' });
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await send(2, { type: 'index', epics: [epic], membership: 'authoritative' });
    await send(3, { type: 'progress', columnId: 'active', loadedChildren: 4,
        byEpic: [{ epicKey: 'EXAMPLE-1', loadedChildren: 4, statusCounts: { Done: 2, 'In Progress': 1, Killed: 1 } }] });
    await send(4, { type: 'column', columnId: 'done', epics: [], children: [], authoritative: true });
    // Killed leaves the total (issue #253): Done 2 and In Progress 1 of the 3 that remain.
    await expect(card).toContainText('2 of 3+ work items');
    expect(await card.locator('.story-subtasks-progress-done').evaluate((el) => el.style.width)).toBe('66.667%');
    expect(await card.locator('.story-subtasks-progress-in-progress').evaluate((el) => el.style.width)).toBe('33.333%');
    await expect(page.getByRole('button', { name: 'Filters', exact: false }).first()).toBeDisabled();
    await page.screenshot({ path: path.join(screenshotDir, 'progressive-epic-stats.png'), animations: 'disabled' });
    await send(5, { type: 'error', code: 'scope_too_large' });
    await expect(card).toBeVisible();
    await expect(page.locator('.board-data-state')).toHaveText(/Loaded so far — Board limit reached; this result is incomplete\.Retry/);
    await expect(card.locator('.erow2')).toHaveAttribute('aria-busy', 'false');
    await expect(card.locator('.board-loading-bar')).toHaveCount(0);
    await expect(col(page, 'active').locator('.col-head .sp')).toContainText('SP unavailable');
    await card.locator('.ecard-open').click();
    await expect(page.getByRole('dialog')).toContainText('Component epic loads first');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.screenshot({ path: path.join(screenshotDir, 'progressive-epic-limit.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 800, height: 900 });
    expect(await page.locator('.board-data-state').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
    })).toBe(true);
    await page.screenshot({ path: path.join(screenshotDir, 'progressive-epic-limit-800.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 900 });

    const exportButton = page.getByRole('button', { name: 'Open Jira issue menu' });
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    await expect(page.getByRole('menuitem', { name: /Open epics/ })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: /Open work items/ })).toBeDisabled();
    await page.keyboard.press('Escape');

    const fetchesAfterLimit = await page.evaluate(() => window.boardFetchCount);
    expect(fetchesAfterLimit).toBe(savedSprintRequestCount + 1);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.boardFetchCount)).toBe(fetchesAfterLimit);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.boardFetchCount)).toBe(fetchesAfterLimit + 1);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.boardFetchCount)).toBe(fetchesAfterLimit + 1);

    await page.getByRole('button', { name: 'Select sprint' }).first().click();
    await page.getByText(selectedSprintName, { exact: false }).first().click();
    await expect(page.locator('.eng-board .ecard[data-epic-key="PLAT-8"]')).toBeVisible();
    await expect(page.locator('.board-data-state')).toHaveCount(0);
});

test('All work keeps a complete snapshot through a limited refresh and replaces it atomically on retry', async ({ page }) => {
    await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        window.boardStreams = [];
        window.openedJiraUrls = [];
        window.open = url => {
            window.openedJiraUrls.push(String(url));
            return null;
        };
        window.fetch = (input, options) => {
            if (String(input).includes('/api/eng/board?')) {
                const streamIndex = window.boardStreams.length;
                const body = new ReadableStream({
                    start(controller) {
                        window.boardStreams[streamIndex] = frame => controller.enqueue(
                            new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
                    },
                });
                return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }));
            }
            return originalFetch(input, options);
        };
    });
    await openBoard(page, { strictBoard: true, sourceBundle: true, reducedMotion: true });
    await page.getByRole('button', { name: 'Select sprint' }).first().click();
    await page.getByText('All work', { exact: true }).first().click();
    await page.waitForFunction(() => window.boardStreams.length === 1);

    const column = { id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false };
    const makeEpic = key => ({ key, summary: `${key} summary`, status: { id: '2', name: 'In Progress' },
        priority: null, assignee: null, deliveryOwner: null, projectTrack: null, updated: null, parent: null, columnId: 'active' });
    const makeChild = (key, epicKey) => ({ key, epicKey, summary: `${key} summary`, status: { id: '1', name: 'To Do' },
        priority: null, issueType: { id: '10004', name: 'Bug' }, assignee: null, updated: null,
        storyPoints: 3, team: null, project: { id: '10000', name: 'Platform' }, projectClassification: 'other', sprintIds: [] });
    const send = (streamIndex, generationId, sequence, body) => page.evaluate(({ streamIndex, frame }) => {
        window.boardStreams[streamIndex](frame);
    }, { streamIndex, frame: { protocolVersion: 1, generationId, sequence, ...body } });
    const complete = (epicCount, childCount) => ({ type: 'complete', outcome: 'success', authoritative: true,
        epicCount, childCount, diagnostics: { indexMs: 1, focusedCompleteMs: 2, durationMs: 3, jiraRequests: 1,
            jiraPages: 1, jiraRetries: 0, peakChildSearches: 1, cacheState: 'miss', completeness: 'complete' } });

    const oldEpic = makeEpic('OLD-1');
    const oldChild = makeChild('WORK-1', 'OLD-1');
    await send(0, 'g-old', 0, { type: 'start', scope: 'all_work', scopeVersion: 'scope-v1',
        scopeCohortDigest: 'a'.repeat(64), columns: [column] });
    await send(0, 'g-old', 1, { type: 'index', epics: [oldEpic], membership: 'authoritative' });
    await send(0, 'g-old', 2, { type: 'column', columnId: 'active', epics: [oldEpic], children: [oldChild], authoritative: true });
    await send(0, 'g-old', 3, complete(1, 1));
    await expect(page.locator('.ecard[data-epic-key="OLD-1"]')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await page.waitForFunction(() => window.boardStreams.length === 2);
    const newEpic = makeEpic('NEW-1');
    const newChild = makeChild('WORK-2', 'NEW-1');
    await send(1, 'g-limited', 0, { type: 'start', scope: 'all_work', scopeVersion: 'scope-v1',
        scopeCohortDigest: 'b'.repeat(64), columns: [column] });
    await send(1, 'g-limited', 1, { type: 'index', epics: [oldEpic, newEpic], membership: 'candidate' });
    await send(1, 'g-limited', 2, { type: 'index', epics: [oldEpic, newEpic], membership: 'authoritative' });
    await send(1, 'g-limited', 3, { type: 'column', columnId: 'active', epics: [oldEpic, newEpic],
        children: [oldChild, newChild], authoritative: true });
    await send(1, 'g-limited', 4, { type: 'error', code: 'scope_too_large' });
    await expect(page.locator('.board-data-state')).toContainText(
        'Showing last complete Board data. Refresh reached the Board limit.');
    await expect(page.locator('.ecard[data-epic-key="OLD-1"]')).toBeVisible();
    await expect(page.locator('.ecard[data-epic-key="NEW-1"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Filters', exact: false }).first()).toBeEnabled();
    await expect(page.locator('.fb-readout')).toHaveText('1 of 1 epics');
    await page.getByRole('button', { name: 'Filters', exact: false }).first().click();
    await expect(page.locator('.pop-group[data-facet="priority"] .pop-total')).toHaveText('1');
    await page.getByRole('button', { name: 'Filters', exact: false }).first().click();
    await page.getByRole('button', { name: 'Open Jira issue menu' }).click();
    await expect(page.getByRole('menuitem', { name: /Open epics/ })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: /Open work items/ })).toBeEnabled();
    await page.getByRole('menuitem', { name: /Open work items/ }).click();
    const exportedUrl = await page.evaluate(() => window.openedJiraUrls.at(-1));
    expect(decodeURIComponent(exportedUrl)).toContain('key in (WORK-1)');
    expect(decodeURIComponent(exportedUrl)).not.toContain('WORK-2');
    await page.screenshot({ path: path.join(screenshotDir, 'progressive-refresh-limit-stale.png'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.boardStreams.length === 3);
    await send(2, 'g-retry', 0, { type: 'start', scope: 'all_work', scopeVersion: 'scope-v1',
        scopeCohortDigest: 'c'.repeat(64), columns: [column] });
    await send(2, 'g-retry', 1, { type: 'index', epics: [newEpic], membership: 'authoritative' });
    await expect(page.locator('.ecard[data-epic-key="OLD-1"]')).toBeVisible();
    await expect(page.locator('.ecard[data-epic-key="NEW-1"]')).toHaveCount(0);
    await send(2, 'g-retry', 2, { type: 'column', columnId: 'active', epics: [newEpic], children: [newChild], authoritative: true });
    await send(2, 'g-retry', 3, complete(1, 1));
    await expect(page.locator('.ecard[data-epic-key="NEW-1"]')).toBeVisible();
    await expect(page.locator('.ecard[data-epic-key="OLD-1"]')).toHaveCount(0);
    await expect(page.locator('.board-data-state')).toHaveCount(0);

    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).click();
    await page.waitForFunction(() => window.boardStreams.length === 4);
    const changedEpic = makeEpic('CHANGED-1');
    await send(3, 'g-changed', 0, { type: 'start', scope: 'all_work', scopeVersion: 'scope-v2',
        scopeCohortDigest: 'c'.repeat(64), columns: [column] });
    await send(3, 'g-changed', 1, { type: 'index', epics: [changedEpic], membership: 'candidate' });
    await send(3, 'g-changed', 2, { type: 'error', code: 'scope_too_large' });
    await expect(page.locator('.board-data-state')).toContainText(
        'Loaded so far — Board limit reached; this result is incomplete.');
    await expect(page.locator('.ecard[data-epic-key="CHANGED-1"]')).toBeVisible();
    await expect(page.locator('.ecard[data-epic-key="NEW-1"]')).toHaveCount(0);
});

for (const delayedFrame of ['complete', 'start', 'index', 'progress', 'column', 'blur_complete', 'column_error', 'partial_error', 'scope_too_large', 'deadline_exceeded', 'scope_changed', 'network', 'auth_required', 'manual', 'private_deny', 'private_forbidden', ...['scope','config'].flatMap(kind=>['start','index','progress','column','complete'].map(frame=>kind+'_'+frame))]) {
    test(`automatic strict Board stages ${delayedFrame} silently and preserves open detail`, async ({ page }, testInfo) => {
        const { installLifecycleControl } = require('./eng_epic_refresh_fixture');
        const lifecycle = await installLifecycleControl(page);
        await page.addInitScript(() => {
            const original = window.fetch.bind(window);
            window.syntheticBoardStreams = [];
            window.fetch = (input, options) => {
                if (!String(input).includes('/api/eng/board?')) return original(input, options);
                if(window.syntheticBoardHttpDenial){window.syntheticBoardDeniedRequests=(window.syntheticBoardDeniedRequests||0)+1;return Promise.resolve(new Response(JSON.stringify({error:window.syntheticBoardHttpDenial}),{status:403,headers:{'Content-Type':'application/json'}}));}
                const entry = { aborted: false, url: String(input) };
                const body = new ReadableStream({ start(controller) {
                    entry.send = frame => { if (entry.cancelled) { entry.dropped = (entry.dropped || 0) + 1; return; } controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`)); };
                    entry.close = () => { if (!entry.cancelled) controller.close(); };
                    entry.fail = () => { if (!entry.cancelled) controller.error(new Error('Synthetic network loss')); };
                }, cancel() { entry.cancelled = true; } });
                options.signal.addEventListener('abort', () => { entry.aborted = true; });
                window.syntheticBoardStreams.push(entry);
                return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }));
            };
        });
        const performanceLoads=[];
        await openBoard(page, { strictBoard: true, sourceBundle: true, reducedMotion: true, performanceLoads });
        await page.getByRole('button', { name: 'Select sprint' }).first().click();
        await page.getByText('All work', { exact: true }).first().click();
        await page.waitForFunction(() => window.syntheticBoardStreams.length === 1);
        const column = { id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false };
        const epic = { key: 'SYN-1', summary: 'Synthetic held Board Epic', status: { id: '2', name: 'In Progress' }, priority: null,
            assignee: null, deliveryOwner: null, projectTrack: null, updated: null, parent: null, columnId: 'active' };
        const children = Array.from({ length: 12 }, (_, i) => ({ key: `SYN-${i + 2}`, epicKey: 'SYN-1', summary: `Synthetic Story ${i}`, status: { id: '1', name: 'To Do' },
            priority: null, issueType: { id: '10004', name: 'Story' }, assignee: null, updated: null, storyPoints: 3,
            team: null, project: { id: '10000', name: 'Synthetic' }, projectClassification: 'product', sprintIds: [] }));
        const frames = index => [
            { type: 'start', scope: 'all_work', scopeVersion: `rotated-${index}`, scopeCohortDigest: 'a'.repeat(64), columns: [column] },
            { type: 'index', epics: [epic], membership: 'authoritative' },
            { type: 'column', columnId: 'active', epics: [{ ...epic, summary: index ? 'Synthetic accepted Board Epic' : epic.summary }], children, authoritative: true },
            { type: 'complete', outcome: 'success', authoritative: true, epicCount: 1, childCount: children.length,
                diagnostics: { indexMs: 1, focusedCompleteMs: 2, durationMs: 3, jiraRequests: 1, jiraPages: 1, jiraRetries: 0, peakChildSearches: 1, cacheState: 'miss', completeness: 'complete' } },
        ];
        const send = async (index, sequence, body = frames(index)[sequence]) => page.evaluate(({ index, sequence, body }) => {
            window.syntheticBoardStreams[index].send({ protocolVersion: 1, generationId: `synthetic-${index}`, sequence, ...body });
            if (['complete','error'].includes(body.type)) window.syntheticBoardStreams[index].close();
        }, { index, sequence, body });
        for (let sequence = 0; sequence < 4; sequence++) await send(0, sequence);
        const card = page.locator('.ecard[data-epic-key="SYN-1"]');
        await expect(card).toContainText(epic.summary);
        await card.locator('.ecard-open').click();
        const detail = page.locator('.epic-panel [data-story-key="SYN-8"]');
        await detail.scrollIntoViewIfNeeded();
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
        const before = await detail.boundingBox(), node = await card.elementHandle();
        await page.screenshot({ path: path.join(screenshotDir, `freshness-${delayedFrame}-before.png`), animations: 'disabled' });
        await lifecycle.returnAfter(13 * 60 * 1000);
        await page.waitForFunction(() => window.syntheticBoardStreams.length === 2);
        const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' });
        await expect(refresh).toBeEnabled();
        const heldFrame=delayedFrame.replace(/^(scope|config)_/,'');
        const changingContext=/^(scope|config)_/.test(delayedFrame);
        const retired=['start','index','progress','column','blur_complete'].includes(delayedFrame);
        if(heldFrame!=='start') await send(1,0);
        if(!['start','index'].includes(heldFrame)) await send(1,1,delayedFrame.startsWith('private_')?{type:'index',epics:[],membership:'authoritative'}:frames(1)[1]);
        if (delayedFrame === 'complete') {
            await send(1, 2);
            await expect(card).toContainText(epic.summary);
            await expect(page.locator('.board-data-state')).toHaveCount(0);
            await send(1, 3);
            await expect(card).toContainText('Synthetic accepted Board Epic');
        } else if(changingContext){
            if(heldFrame==='complete')await send(1,2);
            await expect(card).toContainText(epic.summary);await expect(refresh).toBeEnabled();
            await page.keyboard.press('Escape');
            if(delayedFrame.startsWith('scope_')){
                await page.getByRole('button',{name:'Select sprint'}).first().click();
                await page.getByRole('option',{name:'Component',exact:true}).click();
            }else{
                await page.getByRole('button',{name:'Manage team groups',exact:true}).click();
                const dialog=page.getByRole('dialog').first();await dialog.getByRole('tab',{name:'Boards',exact:true}).click();
                await dialog.locator('.board-column-name').first().fill('Synthetic accepted configuration');
                await dialog.getByRole('button',{name:/^Save$/}).click();
            }
            await page.waitForFunction(()=>window.syntheticBoardStreams.length===3);
            await expect.poll(()=>page.evaluate(()=>window.syntheticBoardStreams[1].aborted)).toBe(true);
            if(heldFrame==='start')await send(1,0);
            if(['start','index'].includes(heldFrame))await send(1,1);
            if(heldFrame==='progress')await send(1,2,{type:'progress',columnId:'active',loadedChildren:1,byEpic:[{epicKey:'SYN-1',loadedChildren:1,statusCounts:{'To Do':1}}]});
            else if(heldFrame!=='complete')await send(1,2);
            await send(1,3);
            for(let sequence=0;sequence<4;sequence++){
                const body=frames(2)[sequence];
                if(sequence===0){body.scope=delayedFrame.startsWith('scope_')?'component':'all_work';body.scopeCohortDigest='b'.repeat(64);}
                if(sequence===2)body.epics=[{...epic,summary:'Synthetic current context accepted'}];
                await send(2,sequence,body);
            }
            await expect(card).toContainText('Synthetic current context accepted');await expect(refresh).toBeEnabled();
            expect(await page.evaluate(()=>window.syntheticBoardStreams.length)).toBe(3);
            await expect(page.locator('.epic-panel')).toHaveCount(0);
            if(delayedFrame.startsWith('scope_'))await expect(page.getByRole('button',{name:'Select sprint'}).first()).toContainText('Component');
            return;
        } else if(delayedFrame.startsWith('private_')){
            // Accept actual scope departure before the later whole-Board denial.
            await send(1,2,{type:'column',columnId:'active',epics:[],children:[],authoritative:true});
            await send(1,3,{...frames(1)[3],epicCount:0,childCount:0});
            await expect(card).toHaveCount(0);await expect(page.locator('[data-board-reading-departure]')).toBeVisible();
            await expect(detail).toBeVisible();
            await expect(page.getByRole('button',{name:'Open Jira issue menu',exact:true})).toBeDisabled();
            await expect.poll(()=>performanceLoads.length).toBe(2);await waitTwoFrames(page);
            await page.evaluate(code=>{window.syntheticBoardHttpDenial=code;},delayedFrame==='private_deny'?'board_permission_denied':'jira_forbidden');
            await lifecycle.advance(1);await lifecycle.returnAfter(13*60*1000);
            await expect.poll(()=>page.evaluate(()=>window.syntheticBoardDeniedRequests||0)).toBe(1);
            if(delayedFrame==='private_deny') await expect(page.locator('.epic-panel')).toHaveCount(0);
            else await expect(detail).toBeVisible();
            await expect(refresh).toBeEnabled();expect(await page.evaluate(()=>window.syntheticBoardStreams.length)).toBe(2);
            return;
        } else if(retired){
            if(delayedFrame==='blur_complete') await send(1,2);
            await lifecycle.setState({ focused: false });
            if(delayedFrame==='start') await send(1,0);
            if(['start','index'].includes(delayedFrame)) await send(1,1);
            if(delayedFrame==='progress') await send(1,2,{type:'progress',columnId:'active',loadedChildren:1,byEpic:[{epicKey:'SYN-1',loadedChildren:1,statusCounts:{'To Do':1}}]});
            else if(delayedFrame!=='blur_complete') await send(1,2);
            await send(1,3);
            await expect(card).toContainText(epic.summary);
            await expect.poll(() => page.evaluate(() => window.syntheticBoardStreams[1].aborted)).toBe(true);
        } else if(delayedFrame==='manual'){
            await page.keyboard.press('Escape');
            await refresh.click(); await page.waitForFunction(()=>window.syntheticBoardStreams.length===3);
            await expect.poll(()=>page.evaluate(()=>window.syntheticBoardStreams[1].aborted)).toBe(true);
            for(let sequence=0;sequence<4;sequence++) await send(2,sequence);
            await expect(card).toContainText('Synthetic accepted Board Epic');
            await card.locator('.ecard-open').click();await detail.scrollIntoViewIfNeeded();
        } else if(delayedFrame==='network'){
            await page.evaluate(()=>window.syntheticBoardStreams[1].fail());
        } else if(['column_error','partial_error'].includes(delayedFrame)){
            await send(1,2,{type:'column_error',columnId:'active',code:'jira_unavailable',retryable:true});
            await send(1,3,{type:'complete',outcome:'partial_error',authoritative:false,failedColumnIds:['active'],diagnostics:{...frames(1)[3].diagnostics,completeness:'partial'}});
        } else {
            await send(1,2,{type:'error',code:delayedFrame});
        }
        if(delayedFrame==='auth_required'){
            await expect(page.getByRole('alertdialog').getByRole('heading',{name:'Sign in required'})).toBeVisible();
            expect(await page.evaluate(()=>window.syntheticBoardStreams.length)).toBe(2);
            return;
        }
        if(delayedFrame!=='complete' && delayedFrame!=='manual') await expect(card).toContainText(epic.summary);
        await expect(page.locator('.board-data-state')).toHaveCount(0);
        await page.waitForTimeout(300);
        const after = await detail.boundingBox();
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
        if(delayedFrame!=='manual') expect(await card.evaluate((current, previous) => current === previous, node)).toBe(true);
        await expect(page.locator('.epic-panel')).toBeVisible();
        await expect(refresh).toBeEnabled();
        expect(await page.evaluate(() => window.syntheticBoardStreams.length)).toBe(delayedFrame==='manual'?3:2);
        await page.screenshot({ path: path.join(screenshotDir, `freshness-${delayedFrame}-after.png`), animations: 'disabled' });
        console.log(`strict Board ${delayedFrame}: ${JSON.stringify({ before: before.y, after: after.y, delta: Math.abs(after.y - before.y) })}`);
    });
}

async function mountBoardCommitHarness(page, { dual = false, readingDone = false, storyCount = 16, documentShift = false } = {}) {
    const source = `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
        import EngBoardView from './frontend/src/eng/EngBoardView.jsx';
        import {buildEngBoardFacetModel,resolveEngBoardFilters} from './frontend/src/eng/engBoardFilters.js';
        const columns=Array.from({length:7},(_,i)=>({id:'col-'+i,name:'Column '+i,statuses:['Status '+i],colour:'#597ef7',star:i===0}));
        const initial=Array.from({length:36},(_,i)=>({key:'SYN-'+(i+1),epic:{key:'SYN-'+(i+1),summary:'Synthetic Epic '+(i+1),status:{name:'Status '+(i<18?0:1)}},
            tasks:Array.from({length:i===0?${storyCount}:1},(_,j)=>({key:'WORK-'+(i+1)+'-'+j,fields:{epicKey:'SYN-'+(i+1),summary:'Synthetic Story '+j,status:{name:j===5&&${readingDone}?'Done':'To Do'},issuetype:{name:'Story'},customfield_10004:3}})),storyPoints:${readingDone ? "(i===0?16:1)*3" : "3"}}));
        const initialTasks=initial.flatMap(group=>group.tasks); const noop=()=>{};const board={columns};
        function App(){const [groups,setGroups]=React.useState(initial),[view,setView]=React.useState({configStarredId:'col-0',starredId:'col-0',focusedId:'col-1'}),[result,setResult]=React.useState('ready'),[spacer,setSpacer]=React.useState(400);
            const filters=resolveEngBoardFilters({model:buildEngBoardFacetModel({epicGroups:groups})});
            const current=React.useRef(groups);current.current=groups;const bridge=React.useRef({getViewport:()=>({top:0,bottom:innerHeight})});
            React.useEffect(()=>{let phase=0;const run=async event=>{const detail=event.detail||{};const prior=current.current;
                const state=phase?{loadedProductTasks:[],loadedTechTasks:[]}: {loadedProductTasks:initialTasks,loadedTechTasks:${dual ? 'initialTasks' : '[]'}};
                const deniedLanes=detail.deny?[detail.deny]:[];
                const capture=bridge.current.beforeCommit(null,{state,deniedLanes},()=>true);
                let next=prior;
                if(detail.depart) next=prior.filter(group=>group.key!=='SYN-1');
                if(detail.noEpic) next=prior.map(group=>group.key==='SYN-1'?{...group,storyPoints:${readingDone ? '45' : 'group.storyPoints'},tasks:group.tasks.filter(task=>task.key!=='WORK-1-5')}:group);
                if(detail.grow) next=[{...initial[0],key:'ADDED-1',epic:{...initial[0].epic,key:'ADDED-1',summary:'Synthetic added before anchor'}},...prior];
                if(detail.reorder) next=prior.map(group=>group.key==='SYN-1'?{...group,tasks:group.tasks.map(task=>task.key==='WORK-1-5'?{...task,fields:{...task.fields,assignee:{displayName:'A synthetic person'},status:{name:'Done'}}}:task)}:group);
                flushSync(()=>{setGroups(next);if(detail.shift)setSpacer(700);});
                if(detail.move){setResult('held');await new Promise(resolve=>window.addEventListener('synthetic:board-settle',resolve,{once:true}));}
                await bridge.current.afterCommit(capture,{deniedLanes});phase++;
                setResult('settled-'+phase);
            };window.addEventListener('synthetic:board-commit',run);return()=>window.removeEventListener('synthetic:board-commit',run);},[]);
            return <>{${documentShift}&&<div style={{height:spacer}}/>}<output data-canonical-count={groups.length} data-canonical-story-count={groups.flatMap(group=>group.tasks).length}>{result}</output><EngBoardView board={board} epicGroups={groups} view={view} onViewChange={setView}
                engFilters={filters} onFacetChange={noop} freshnessBridge={bridge} onInteractionChange={noop} transitionsEnabled={true} statusTransitions={{pendingIssueKeys:new Set()}}
                issueFieldEdits={{pendingIssueKeys:new Set()}} jiraUrl="https://jira.example" backendUrl=""/></>;
        }createRoot(document.getElementById('root')).render(<App/>);`;
    const bundle = (await esbuild.build({ stdin: { contents: source, resolveDir: path.join(__dirname, '../..'), loader: 'jsx' }, bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text;
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }));
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ key: 'SYN-1', html: '', isEmpty: true }) }));
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await expect(page.locator('.ecard[data-epic-key="SYN-1"]')).toBeAttached();
}

test('Board commit restores one pane while respecting independent user pane and horizontal movement', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await mountBoardCommitHarness(page);
    const left = page.locator('.col[data-column-id="col-0"] .col-body'), right = page.locator('.col[data-column-id="col-1"] .col-body');
    await expect(page.locator('.eng-board')).toHaveClass(/is-pane-mode/);
    await left.evaluate(pane => { pane.scrollTop = 320; }); await right.evaluate(pane => { pane.scrollTop = 280; });
    const anchorKey=await left.evaluate(pane=>Array.from(pane.querySelectorAll('.ecard')).find(node=>node.getBoundingClientRect().bottom>pane.getBoundingClientRect().top)?.dataset.epicKey);
    const anchor = left.locator('.ecard[data-epic-key="'+anchorKey+'"]');
    const before = await anchor.boundingBox();
    await expect.poll(() => page.locator('.board').evaluate(board => board.scrollWidth - board.clientWidth)).toBeGreaterThan(100);
    await page.locator('.board').evaluate(board => board.scrollTo({left:40,behavior:'instant'}));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic:board-commit', { detail: { grow: true, move: true } })));
    await expect(page.locator('output')).toHaveText('held');
    await right.hover(); await page.mouse.wheel(0,90);
    await expect.poll(()=>right.evaluate(pane=>pane.scrollTop)).toBeGreaterThan(280);
    await page.mouse.wheel(60,0);
    await expect.poll(()=>page.locator('.board').evaluate(board=>board.scrollLeft)).toBeGreaterThan(40);
    await page.waitForTimeout(200);
    const expected={top:await right.evaluate(pane=>pane.scrollTop),left:await page.locator('.board').evaluate(board=>board.scrollLeft)};
    await page.evaluate(()=>window.dispatchEvent(new Event('synthetic:board-settle')));
    await expect(page.locator('output')).toHaveText('settled-1');
    expect(await right.evaluate(pane => pane.scrollTop)).toBe(expected.top);
    expect(await page.locator('.board').evaluate(board => board.scrollLeft)).toBe(expected.left);
    const after = await anchor.boundingBox();
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    console.log(`independent Board movement: ${JSON.stringify({ before: before.y, after: after.y, user: expected })}`);
});

for (const dual of [false, true]) {
    test(`departed Board detail ${dual ? 'retains another lane then purges cumulative denial' : 'purges later private source denial'}`, async ({ page }) => {
        await mountBoardCommitHarness(page, { dual });
        await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
        const panel = page.locator('.epic-panel');
        await panel.locator('[data-story-key="WORK-1-5"]').scrollIntoViewIfNeeded();
        await panel.locator('[data-story-key="WORK-1-5"] a').evaluate(node => node.focus({ preventScroll: true }));
        const before = await panel.locator('[data-story-key="WORK-1-5"]').boundingBox();
        await page.screenshot({path:path.join(screenshotDir,`board-departure-${dual?'dual':'single'}-before.png`),animations:'disabled'});
        const paneBefore=await panel.evaluate(panel=>{const body=panel.querySelector('.m-body');return {scroll:body.scrollTop,max:body.scrollHeight-body.clientHeight,origin:body.getBoundingClientRect().top};});
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic:board-commit', { detail: { depart: true } })));
        await expect(page.locator('output')).toHaveText('settled-1');
        await expect(panel).toBeVisible(); await expect(page.locator('[data-board-reading-departure]')).toBeVisible();
        await expect(page.locator('.ecard[data-epic-key="SYN-1"]')).toHaveCount(0);
        await expect(page.locator('output')).toHaveAttribute('data-canonical-count', '35');
        await expect(panel.locator('.issue-person-editor-trigger,[data-status-transition-trigger]')).toHaveCount(0);
        const after = await panel.locator('[data-story-key="WORK-1-5"]').boundingBox();
        console.log('departed Board geometry',await panel.evaluate(panel=>{const body=panel.querySelector('.m-body');return {scroll:body.scrollTop,max:body.scrollHeight-body.clientHeight,head:panel.querySelector('.m-head').getBoundingClientRect().height,bodyTop:body.getBoundingClientRect().top};}),{before:before.y,after:after.y,paneBefore});
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
        await page.screenshot({path:path.join(screenshotDir,`board-departure-${dual?'dual':'single'}-after.png`),animations:'disabled'});
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic:board-commit', { detail: { deny: 'product' } })));
        await expect(page.locator('output')).toHaveText('settled-2');
        if (dual) {
            await expect(panel).toBeVisible();
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic:board-commit', { detail: { deny: 'tech' } })));
            await expect(page.locator('output')).toHaveText('settled-3');
        }
        await expect(panel).toHaveCount(0); await expect(page.locator('[data-board-reading-departure]')).toHaveCount(0);
    });
}

test('Board retains a departed reading Story in its detail slot and purges explicit issue denial', async ({ page }) => {
    await mountBoardCommitHarness(page);
    await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
    const story = page.locator('.epic-panel [data-story-key="WORK-1-5"]');
    await story.scrollIntoViewIfNeeded(); await story.locator('a').evaluate(node => node.focus({ preventScroll: true }));
    const before = await story.boundingBox();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic:board-commit', { detail: { noEpic: true } })));
    await expect(page.locator('output')).toHaveText('settled-1'); await expect(story).toBeVisible();
    await expect(page.locator('[data-board-reading-departure]')).toBeVisible();
    expect(Math.abs((await story.boundingBox()).y - before.y)).toBeLessThanOrEqual(2);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic:board-commit', { detail: { deny: 'product' } })));
    await expect(page.locator('output')).toHaveText('settled-2'); await expect(story).toHaveCount(0);
});


test('held Board reading order releases without suppressing a deliberate other-card click',async({page})=>{
    await mountBoardCommitHarness(page);
    const body=page.locator('.col[data-column-id="col-0"] .col-body');
    await body.evaluate(pane=>{pane.scrollTop=320;});
    await page.locator('.board').evaluate(board=>board.scrollTo({left:0,behavior:'instant'}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:{grow:true}})));
    await expect(page.locator('output')).toHaveText('settled-1');
    await page.locator('.ecard[data-epic-key="SYN-15"] .ecard-open').click();
    await expect(page.locator('.epic-panel')).toBeVisible();
    await expect(page.locator('.epic-panel .m-title')).toHaveText('Synthetic Epic 15');
});


for (const whole of [false, true]) {
test(`departed Board reading ${whole ? 'Epic' : 'Story'} stays outside canonical detail counts and completion progress`,async({page})=>{
    await mountBoardCommitHarness(page,{readingDone:true});
    await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
    const panel=page.locator('.epic-panel'),story=panel.locator('[data-story-key="WORK-1-5"]');
    await expect(panel.locator('.m-sec-head .m-sec-label').last()).toHaveText('16 stories · 48.0 sp');
    await expect(panel.locator('.m-sp')).toHaveText('48.0 sp · 1 of 16 stories done');
    await story.scrollIntoViewIfNeeded();await story.locator('a').evaluate(node=>node.focus({preventScroll:true}));
    await page.screenshot({path:path.join(screenshotDir,`board-canonical-${whole?'epic':'story'}-before.png`),animations:'disabled'});
    await page.evaluate(whole=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:whole?{depart:true}:{noEpic:true}})),whole);
    await expect(page.locator('output')).toHaveText('settled-1');
    await expect(page.locator('output')).toHaveAttribute('data-canonical-story-count',whole?'35':'50');
    if(whole) await expect(page.locator('.ecard[data-epic-key="SYN-1"]')).toHaveCount(0);
    else await expect(page.locator('.ecard[data-epic-key="SYN-1"] .erow2')).toContainText('0 of 15 stories');
    await expect(story).toBeVisible();
    await expect(page.locator('[data-board-reading-departure]')).toHaveText(whole?'Epic SYN-1 left the current Board scope.':'Story WORK-1-5 left the current Board scope.');
    await expect(story.locator('.story-subtask-name')).toContainText('Outside scope · Synthetic Story 5');
    await expect(panel.locator('.m-sec-head .m-sec-label').last()).toHaveText(whole?'0 stories · 0.0 sp':'15 stories · 45.0 sp');
    await expect(panel.locator('.m-sp')).toHaveText(whole?'0.0 sp · 0 of 0 stories done':'45.0 sp · 0 of 15 stories done');
    await expect(panel.locator('.issue-person-editor-trigger,[data-status-transition-trigger]')).toHaveCount(0);
    await page.screenshot({path:path.join(screenshotDir,`board-canonical-${whole?'epic':'story'}-after.png`),animations:'disabled'});
});
}

for(const touch of [false,true]){
test(`Board ${touch?'touch':'document'} commit performs nonzero window compensation`,async({page,browser})=>{
    let context;
    if(touch){context=await browser.newContext({viewport:{width:600,height:800},hasTouch:true});page=await context.newPage();}
    else await page.setViewportSize({width:600,height:800});
    try{
        await mountBoardCommitHarness(page,{documentShift:true});
        await expect(page.getByRole('region',{name:'Group board',exact:true})).not.toHaveClass(/is-pane-mode/);
        const card=page.locator('.ecard[data-epic-key="SYN-1"]');await card.scrollIntoViewIfNeeded();
        await card.locator('.ecard-open').evaluate(node=>node.focus({preventScroll:true}));
        const offsets=await page.evaluate(async()=>{const values=[];for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);values.push(document.querySelector('.board').scrollLeft);}return values;});
        expect(new Set(offsets).size).toBe(1);
        await page.evaluate(()=>{document.documentElement.style.overflowAnchor='none';document.body.style.overflowAnchor='none';});
        const before=await card.boundingBox(),scrollBefore=await page.evaluate(()=>scrollY),leftBefore=offsets[0];
        await page.screenshot({path:path.join(screenshotDir,`board-nonzero-${touch?'touch':'document'}-before.png`),animations:'disabled'});
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:{shift:true}})));
        await expect(page.locator('output')).toHaveText('settled-1');
        const after=await card.boundingBox(),scrollAfter=await page.evaluate(()=>scrollY);
        const leftAfter=await page.locator('.board').evaluate(node=>node.scrollLeft);
        console.log('nonzero window correction',{touch,before:before.y,after:after.y,scrollBefore,scrollAfter,xBefore:before.x,xAfter:after.x,leftBefore,leftAfter});
        expect(scrollAfter-scrollBefore).toBeGreaterThan(250);expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(2);
        expect(leftAfter).toBe(leftBefore);expect(Math.abs(after.x-before.x)).toBeLessThanOrEqual(2);
        await page.screenshot({path:path.join(screenshotDir,`board-nonzero-${touch?'touch':'document'}-after.png`),animations:'disabled'});
    }finally{await context?.close();}
});}

for(const activation of ['mouse','Enter',' ']){
test(`Board holds actual displayed panel comparator order until deliberate ${activation==='mouse'?'Sort':`keyboard ${activation===' ' ? 'Space' : activation} Sort`} releases it`,async({page})=>{
    await mountBoardCommitHarness(page);await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
    const panel=page.locator('.epic-panel'),story=panel.locator('[data-story-key="WORK-1-5"]');
    await story.scrollIntoViewIfNeeded();await story.locator('a').evaluate(node=>node.focus({preventScroll:true}));
    const keys=()=>panel.locator('[data-story-key]').evaluateAll(nodes=>nodes.map(node=>node.dataset.storyKey));
    const beforeKeys=await keys(),before=await story.boundingBox(),node=await story.elementHandle();
    await page.screenshot({path:path.join(screenshotDir,'board-comparator-before.png'),animations:'disabled'});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:{reorder:true}})));
    await expect(page.locator('output')).toHaveText('settled-1');
    expect(await keys()).toEqual(beforeKeys);expect(Math.abs((await story.boundingBox()).y-before.y)).toBeLessThanOrEqual(2);
    expect(await story.evaluate((current,old)=>current===old,node)).toBe(true);await expect(story.locator('a')).toBeFocused();
    await page.screenshot({path:path.join(screenshotDir,'board-comparator-after.png'),animations:'disabled'});
    const toggle=panel.getByRole('button',{name:'Sort stories',exact:true}),option=panel.locator('.sprint-dropdown-option').filter({hasText:'Assignee, then status'});
    if(activation==='mouse'){await toggle.click();await option.click();}
    else{await toggle.press(activation);await option.press(activation);}
    await expect.poll(async()=>(await keys())[0]).toBe('WORK-1-5');
});
}

for(const whole of [false,true]){
test(`Board private ${whole?'Epic':'Story'} retires when its actual panel anchor scrolls out`,async({page})=>{
    await mountBoardCommitHarness(page,{storyCount:60});await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
    const panel=page.locator('.epic-panel'),story=panel.locator('[data-story-key="WORK-1-5"]');
    await story.scrollIntoViewIfNeeded();await story.locator('a').evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(whole=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:whole?{depart:true}:{noEpic:true}})),whole);
    await expect(page.locator('output')).toHaveText('settled-1');await expect(story).toBeVisible();
    await expect(page.locator('[data-board-reading-departure]')).toBeVisible();
    await panel.locator('.m-body').hover();await page.mouse.wheel(0,-1200);
    if(whole)await expect(panel).toHaveCount(0);else{await expect(story).toHaveCount(0);await expect(panel).toBeVisible();}
    await expect(page.locator('[data-board-reading-departure]')).toHaveCount(0);
});}

test('Board respects actual panel keyboard movement during held settlement',async({page})=>{
    await mountBoardCommitHarness(page,{storyCount:60});await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
    const body=page.locator('.epic-panel .m-body'),story=body.locator('[data-story-key="WORK-1-5"]');
    await story.scrollIntoViewIfNeeded();await story.locator('a').evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:{move:true}})));
    await expect(page.locator('output')).toHaveText('held');const initial=await body.evaluate(node=>node.scrollTop);
    await page.keyboard.press('End');await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(initial+100);
    await page.waitForTimeout(200);const desired=await body.evaluate(node=>node.scrollTop);
    await page.evaluate(()=>window.dispatchEvent(new Event('synthetic:board-settle')));await expect(page.locator('output')).toHaveText('settled-1');
    expect(await body.evaluate(node=>node.scrollTop)).toBe(desired);
});

test('Board retires private Story scrolled out while settlement is held without treating correction as movement',async({page})=>{
    await mountBoardCommitHarness(page,{storyCount:60});await page.locator('.ecard[data-epic-key="SYN-1"] .ecard-open').click();
    const panel=page.locator('.epic-panel'),body=panel.locator('.m-body'),story=body.locator('[data-story-key="WORK-1-5"]');
    await story.scrollIntoViewIfNeeded();await story.locator('a').evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:board-commit',{detail:{noEpic:true,move:true}})));
    await expect(page.locator('output')).toHaveText('held');await expect(story).toBeVisible();
    await body.hover();await page.mouse.wheel(0,-1200);await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBe(0);
    const bounds=await story.evaluate(node=>({rowTop:node.getBoundingClientRect().top,paneBottom:node.closest('.m-body').getBoundingClientRect().bottom}));
    expect(bounds.rowTop).toBeGreaterThan(bounds.paneBottom);await expect(story).toHaveCount(1);
    await page.evaluate(()=>window.dispatchEvent(new Event('synthetic:board-settle')));await expect(page.locator('output')).toHaveText('settled-1');
    await expect(story).toHaveCount(0);await expect(panel).toBeVisible();
    const scroll=await body.evaluate(node=>({top:node.scrollTop,max:node.scrollHeight-node.clientHeight}));expect(scroll.top).toBeGreaterThanOrEqual(0);expect(scroll.top).toBeLessThanOrEqual(scroll.max);
});

for (const scope of ['Component', 'All work']) test(`simulated persisted ${scope} Board waits for catalog validation and resumes one silent stream`, async ({ page }, testInfo) => {
    const { installLifecycleControl, deferred } = require('./eng_epic_refresh_fixture');
    await installLifecycleControl(page);
    const requestLog = [], resources = [], gate = deferred(); let holdCatalog = false;
    page.on('request', request => resources.push({ pathname: new URL(request.url()).pathname, type: request.resourceType() }));
    await openBoard(page, { strictBoard: true, sourceBundle: true, requestLog,
        sprintResponder: async () => {
            if (holdCatalog) await gate.promise;
            return { body: { sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] } };
        } });
    const selector = page.getByRole('button', { name: 'Select sprint', exact: true }).first();
    await selector.click(); await page.getByRole('option', { name: scope, exact: true }).click();
    const card = page.locator('.eng-board .ecard[data-epic-key="STRICT-1"]'); await expect(card).toBeVisible();
    await card.locator('.ecard-open').click(); const panel = page.locator('.epic-panel'); await expect(panel).toBeVisible();
    await settle(page);
    const cardNode = await card.elementHandle(), panelNode = await panel.elementHandle(), panelText = await panel.innerText();
    const selection = await selector.innerText(), preferences = await page.evaluate(() => localStorage.getItem('jira_dashboard_ui_prefs_v1'));
    const paneScroll = await panel.locator('.m-body').evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop }));
    const since = requestLog.length, resourceSince = resources.length; holdCatalog = true;
    const callsFor = pathname => requestLog.slice(since).filter(call => new URL(call.url).pathname === pathname);
    await page.evaluate(() => {
        window.__freshnessLifecycle.advance(13 * 60000);
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => callsFor('/api/sprints').length).toBe(1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForTimeout(250);
    try {
        expect(callsFor('/api/eng/board')).toHaveLength(0);
        expect(await card.evaluate((node, prior) => node === prior, cardNode)).toBe(true);
        expect(await panel.evaluate((node, prior) => node === prior, panelNode)).toBe(true); expect(await panel.innerText()).toBe(panelText);
    } finally { gate.resolve(); }
    await expect.poll(() => callsFor('/api/eng/board').length).toBe(1); await settle(page);
    expect(callsFor('/api/eng/board')).toHaveLength(1); expect(callsFor('/api/sprints')).toHaveLength(1);
    expect(callsFor('/api/tasks-with-team-name')).toHaveLength(0);
    expect(requestLog.slice(since).filter(call => call.method !== 'GET')).toEqual([]);
    expect(callsFor('/api/performance/loads')).toHaveLength(0);
    expect(resources.slice(resourceSince).filter(request => request.type === 'document' || !request.pathname.startsWith('/api/'))).toEqual([]);
    expect(await card.evaluate((node, prior) => node === prior, cardNode)).toBe(true);
    expect(await panel.evaluate((node, prior) => node === prior, panelNode)).toBe(true); expect(await panel.innerText()).toBe(panelText);
    expect(await panel.locator('.m-body').evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop }))).toEqual(paneScroll);
    expect(await selector.innerText()).toBe(selection);
    expect(await page.evaluate(() => localStorage.getItem('jira_dashboard_ui_prefs_v1'))).toBe(preferences);
    await testInfo.attach('strict-persisted-return', { body: JSON.stringify({ scope, catalogReads: 1, heldBoardReads: 0, acceptedBoardReads: 1, simulated: true, realBFCacheObserved: false }), contentType: 'application/json' });
});


for (const width of [1280, 820]) {
    for (const breached of [true, false]) {
        const id = 'col-2b3c4d5e';
        test(`folded control hover paints all edges inside the control at ${width}, breach ${breached}`, async ({ page }) => {
            const board = { columns: BOARD_COLUMNS.map(column => column.id === id ? { ...column, min: breached ? 4 : null } : column) };
            await openBoard(page, { width, reducedMotion: true, board });
            const control = col(page, id).locator('.col-strip');
            await control.scrollIntoViewIfNeeded();
            await settle(page);
            const before = await control.boundingBox();
            const title = await control.getAttribute('title');
            const restingShadow = await control.evaluate(node => getComputedStyle(node).boxShadow);
            await control.hover();
            await settle(page);
            await page.screenshot({ path: `${screenshotDir}/${process.env.JEP_HOVER_PHASE || 'after'}-control-hover-${width}-${breached}.png`, animations: 'disabled' });
            const hover = await control.evaluate(node => {
                const style = getComputedStyle(node);
                const ring = getComputedStyle(node, '::after');
                return {
                    shadow: style.boxShadow,
                    ring: ring.boxShadow,
                    radius: ring.borderRadius,
                    controlRadius: style.borderRadius,
                    top: ring.top, right: ring.right, bottom: ring.bottom, left: ring.left,
                    pointerEvents: ring.pointerEvents,
                    layer: Number(ring.zIndex),
                    labelLayer: Number(getComputedStyle(node.querySelector('.cap')).zIndex),
                };
            });
            expect(hover.shadow).toBe(breached ? restingShadow : 'none');
            expect(hover.ring).toMatch(/999px inset/);
            expect(hover.ring).toContain('rgb(47, 128, 237) 0px 0px 0px 1px inset');
            expect(hover.ring).toContain('rgba(47, 128, 237, 0.25) 0px 0px 0px 3px inset');
            expect([hover.top, hover.right, hover.bottom, hover.left]).toEqual(['0px', '0px', '0px', '0px']);
            expect(hover.radius).toBe(hover.controlRadius);
            expect(hover.pointerEvents).toBe('none');
            expect(hover.layer).toBeGreaterThan(hover.labelLayer);
            expect(await control.boundingBox()).toEqual(before);
            await expect(control).toHaveAttribute('title', title);
            await control.click();
            await expect(page.locator('.col.is-focused')).toHaveAttribute('data-column-id', id);
        });
    }
}

test('a Board Epic card shares its own Epic, column and filters, and the link reveals that card', async ({ page }) => {
    await page.addInitScript(() => {
        window.__copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } });
        window.__reveals = [];
        new MutationObserver((records) => {
            for (const record of records) {
                if (record.attributeName === 'data-share-reveal' && record.target.hasAttribute('data-share-reveal')) window.__reveals.push(record.target.dataset.epicKey || '');
            }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-share-reveal'] });
    });
    await openBoard(page);
    const card = page.locator('.eng-board .col.is-focused .ecard').first();
    await expect(card).toBeVisible();
    const epicKey = await card.getAttribute('data-epic-key');
    const columnId = await page.locator('.eng-board .col.is-focused').getAttribute('data-column-id');
    await card.hover();
    const action = card.locator('[data-share-view-control]');
    await expect(action).toBeVisible();
    // The action sits after the summary and before the key, clear of both, and the card keeps its fixed height.
    const placed = await card.evaluate(node => {
        const button = node.querySelector('[data-share-view-control]').getBoundingClientRect();
        const key = node.querySelector('.ekey').getBoundingClientRect();
        const title = node.querySelector('.etitle').getBoundingClientRect();
        return { beforeKey: button.right <= key.left + 1, afterTitleStart: button.left >= title.left, noTitleOverlap: button.left >= title.right - 1 || button.right <= title.left + 1 };
    });
    expect(placed.beforeKey).toBe(true);
    expect(placed.afterTitleStart).toBe(true);
    await action.click();
    await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
    const url = (await page.evaluate(() => window.__copied))[0];
    const query = new URL(url).search;
    expect(query).toContain('mode=board');
    expect(query).toContain(`&epic=${epicKey}`);
    expect(query).toContain(`&bcolumn=${encodeURIComponent(columnId)}`);
    expect(await card.locator('.ecard-open [data-share-view-control]').count()).toBe(0);

    // Opening the link lands on that column and paints the reveal on that card.
    await page.evaluate(() => { window.__reveals.length = 0; });
    // The shared fixture's `/` route only matches a bare origin, so the link URL is served the dashboard document directly.
    await page.route(/https?:\/\/[^/]+\/\?v=[^#]*$/, route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '..', '..', 'jira-dashboard.html'), 'utf8') }));
    await page.goto(`${appBaseUrl}/${query}`, { waitUntil: 'networkidle' });
    await expect.poll(() => page.evaluate(() => window.__reveals)).toContain(epicKey);
    await expect(page.locator('.eng-board .col.is-focused')).toHaveAttribute('data-column-id', columnId);
});
