const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');
const PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const TEAM_SELECTION_KEY = 'jira_dashboard_team_selection_state_v1';
let dashboardJs;

// The Share control is a later task, so the spec reads the hook result from the page through a build-time probe on the real module:
// the bundle publishes what `useShareViewApply` returns as `window.__shareViewProbe`. No production code carries a test seam.
const HOOK_DECLARATION = 'export function useShareViewApply(options) {';
const shareViewProbe = {
    name: 'share-view-probe',
    setup(build) {
        build.onLoad({ filter: /[\\/]dashboard\.jsx$/ }, async args => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const declaration = "const [boardStrictScope, setBoardStrictScope] = useState('');";
            if (!source.includes(declaration)) throw new Error('Update the manual strict-scope initial-state probe');
            return { contents: source.replace(declaration,
                "const [boardStrictScope, setBoardStrictScope] = useState(window.__shareManualStrictScope || '');"), loader: 'jsx' };
        });
        build.onLoad({ filter: /[\\/]stats[\\/]useStatsState\.js$/ }, async args => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const declaration = 'const excludedCapacityForceRefreshRef = useRef(false);';
            if (!source.includes(declaration)) throw new Error('Update the manual Project Track initial-state probe');
            return { contents: source.replace(declaration,
                'const excludedCapacityForceRefreshRef = useRef(Boolean(window.__shareManualStatsRefresh));'), loader: 'js' };
        });
        build.onLoad({ filter: /shareView[\\/]useShareViewApply\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            if (!source.includes(HOOK_DECLARATION)) throw new Error('useShareViewApply is declared differently now: update the probe');
            return {
                contents: `${source.replace(HOOK_DECLARATION, 'function useShareViewApplyOriginal(options) {')}
export function useShareViewApply(options) {
    const result = useShareViewApplyOriginal(options);
    window.__shareViewProbe = result;
    return result;
}
`,
                loader: 'js',
            };
        });
    },
};

test.beforeAll(async () => {
    dashboardJs = (await esbuild.build({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
        plugins: [shareViewProbe],
    })).outputFiles[0].text;
});

// Synthetic data: two Departments with their own Teams, and an active, a future and a closed Sprint.
const SPRINTS = [
    { id: 41, name: 'Sprint 41', state: 'active', startDate: '2026-05-01' },
    { id: 42, name: 'Sprint 42', state: 'future', startDate: '2026-05-15' },
    { id: 40, name: 'Sprint 40', state: 'closed', startDate: '2026-04-15' },
];
const GROUPS = [
    { id: 'grp-a', name: 'Alpha', teamIds: ['team-a1', 'team-a2'] },
    { id: 'grp-b', name: 'Beta', teamIds: ['team-b1', 'team-b2'] },
];
const TEAM_NAMES = { 'team-a1': 'Alpha One', 'team-a2': 'Alpha Two', 'team-b1': 'Beta One', 'team-b2': 'Beta Two' };
const STATUSES = ['To Do', 'In Progress', 'Blocked'];

function storiesFor(groupId, sprintId) {
    const prefix = groupId === 'grp-b' ? 'BET' : 'ALP';
    const teams = GROUPS.find(group => group.id === groupId)?.teamIds || [];
    return STATUSES.flatMap((status, index) => teams.map((teamId, teamIndex) => {
        const number = index * 10 + teamIndex + 1;
        return {
            id: `${prefix}-${number}`, key: `${prefix}-${number}`,
            fields: {
                summary: `${prefix} story ${number}`, status: { name: status }, priority: { name: index === 2 ? 'Blocker' : 'Major' },
                issuetype: { name: 'Story' }, assignee: { displayName: 'Synthetic Owner' }, updated: '2026-05-01T00:00:00.000+0000',
                customfield_10004: 2, epicKey: `${prefix}-100`, parentSummary: `${prefix} delivery epic`, projectKey: prefix,
                teamId, teamName: TEAM_NAMES[teamId], sprint: [{ id: sprintId, name: `Sprint ${sprintId}`, state: 'active' }],
            },
        };
    }));
}

function epicFor(groupId, sprintId) {
    const prefix = groupId === 'grp-b' ? 'BET' : 'ALP';
    return {
        key: `${prefix}-100`, summary: `${prefix} delivery epic`, status: { name: 'In Progress' }, teamId: GROUPS.find(group => group.id === groupId).teamIds[0],
        teamName: TEAM_NAMES[GROUPS.find(group => group.id === groupId).teamIds[0]], sprint: [{ id: sprintId, name: `Sprint ${sprintId}`, state: 'active' }],
    };
}

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

// The shared fixture's `/` route only matches a bare origin, so the link URL gets its own route.
async function installDocumentRoutes(page) {
    await page.route(/https?:\/\/[^/]+\/\?v=[^#]*$/, route => route.fulfill({ status: 200, contentType: 'text/html', body: dashboardHtml }));
}

async function installLinkFixture(page, {
    groupsSource = 'workspace_db', preferences = {}, taskGate = null, taskAuthFailure = false, homeToken = { connected: false },
    prefs = {}, teamSelection = null, analytics = null, capsules = null, matrix = false, backendCache = null, strictScope = '', statsRefresh = false,
} = {}) {
    const calls = [];
    const requestCalls = new Map();
    page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return;
        const call = { method: request.method(), url: request.url(), pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()), body: request.postData(), aborted: false };
        requestCalls.set(request, call);
        calls.push(call);
    });
    page.on('requestfailed', request => { const call = requestCalls.get(request); if (call) call.aborted = true; });
    // Only the Workspace DB owns personal Department preferences; the JSON source has none.
    const groupsConfig = {
        version: 1, configRevision: 1, source: groupsSource, defaultGroupId: 'grp-a', groups: matrix ? GROUPS.map(group => ({ ...group, missingInfoComponents: ['Platform'], board: { columns: [{ id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false }] } })) : GROUPS,
        ...(groupsSource === 'workspace_db' ? {
            preferences: {
                onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
                customized: false, visibleGroupIds: [], effectiveVisibleGroupIds: GROUPS.map(group => group.id), activeGroupId: 'grp-a', ...preferences,
            },
        } : {}),
    };
    await installDashboardShell(page);
    await installDocumentRoutes(page);
    await page.addInitScript(({ prefsKey, teamKey, savedPrefs, savedTeams, savedCapsules, strictScope, statsRefresh }) => {
        window.__shareManualStatsRefresh = statsRefresh;
        window.__shareManualStrictScope = strictScope;
        if (window.sessionStorage.getItem('share_link_fixture_seeded')) return;
        window.sessionStorage.setItem('share_link_fixture_seeded', 'true');
        window.localStorage.setItem(prefsKey, JSON.stringify(savedPrefs));
        if (savedTeams) window.localStorage.setItem(teamKey, JSON.stringify(savedTeams));
        Object.entries(savedCapsules || {}).forEach(([key, value]) => window.sessionStorage.setItem(key, JSON.stringify(value)));
    }, { prefsKey: PREFS_KEY, teamKey: TEAM_SELECTION_KEY, savedPrefs: { selectedView: 'eng', planningLayout: 'list', selectedSprint: 41, sprintName: 'Sprint 41', activeGroupId: 'grp-a', ...prefs }, savedTeams: teamSelection, savedCapsules: capsules, strictScope, statsRefresh });
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: dashboardJs }));
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const call = requestCalls.get(request);
        const cacheUrl = new URL(url);
        cacheUrl.searchParams.delete('t'); // Existing request nonce is not part of the backend data-cache scope.
        cacheUrl.searchParams.delete('refresh');
        const cacheBody = request.postData() ? JSON.parse(request.postData()) : null;
        const refresh = call.params.refresh === 'true' || cacheBody?.refresh === true;
        if (cacheBody) delete cacheBody.refresh;
        const cacheKey = `${request.method()} ${cacheUrl.pathname}${cacheUrl.search} ${JSON.stringify(cacheBody)}`;
        call.cacheBypassed = refresh;
        const reply = (body, status = 200) => { call.completed = true; return json(route, body, status); };
        const cachedReply = body => {
            call.cacheHit = !refresh && Boolean(backendCache?.has(cacheKey));
            if (backendCache) {
                if (refresh || !backendCache.has(cacheKey)) backendCache.set(cacheKey, body);
                body = backendCache.get(cacheKey);
            }
            return reply({ ...body, cached: call.cacheHit });
        };
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return reply({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/auth/status') return reply({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        if (url.pathname === '/api/me/connections/home-token') return reply(homeToken);
        if (url.pathname === '/api/analytics/context') return reply(analytics || { enabled: false });
        if (url.pathname === '/api/config') {
            return reply({
                jiraUrl: 'https://jira.example', capacityProject: '', authMode: 'atlassian_oauth', groupQueryTemplateEnabled: false,
                settingsAdminOnly: false, userCanEditSettings: true, projectsConfigured: true, environmentConfigExists: true,
                ...(matrix ? { boardAllWorkAvailable: true, sharedConfig: { projects: { selected: ['SYN'] }, board: { boardId: '42' } }, sprintCatalogSource: MATRIX_SOURCE } : {}),
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: { version: 2, labelPrefix: '', scope: {}, projects: {} } } },
            });
        }
        if (url.pathname === '/api/version') return reply({ enabled: false });
        if (url.pathname === '/api/groups-config') return reply(groupsConfig);
        if (url.pathname === '/api/projects/selected') return reply({ selected: matrix ? ['SYN'] : [] });
        if (url.pathname === '/api/sprints') return matrix ? cachedReply({ sprints: SPRINTS, cache: {
            ...MATRIX_SOURCE, state: 'fresh', catalogVersion: '33333333-3333-4333-8333-333333333333',
            validatedAt: new Date().toISOString(), refreshStatus: 'idle', refreshAttemptId: null, refreshStarted: false, refreshFailed: false,
        } }) : reply({ sprints: SPRINTS });
        if (matrix && url.pathname === '/api/eng/board') {
            const scope = url.searchParams.get('scope');
            call.cacheHit = !refresh && Boolean(backendCache?.has(cacheKey));
            backendCache?.set(cacheKey, true);
            const base = (sequence, frame) => ({ protocolVersion: 1, generationId: 'synthetic-generation', sequence, ...frame });
            const frames = [
                base(0, { type: 'start', scope, scopeVersion: 'synthetic-scope', scopeCohortDigest: 'a'.repeat(64),
                    columns: [{ id: 'active', name: 'Active', color: '#597ef7', statusNames: ['In Progress'], terminal: false }] }),
                base(1, { type: 'index', epics: [], membership: scope === 'sprint' ? 'candidate' : 'authoritative' }),
                base(2, { type: 'column', columnId: 'active', epics: [], children: [], authoritative: true }),
                base(3, { type: 'complete', outcome: 'success', authoritative: true, epicCount: 0, childCount: 0,
                    diagnostics: { indexMs: 1, focusedCompleteMs: 2, durationMs: 3, jiraRequests: 1, jiraPages: 1, jiraRetries: 0,
                        peakChildSearches: 1, cacheState: call.cacheHit ? 'hit' : 'miss', completeness: 'complete' } }),
            ];
            call.completed = true;
            return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: frames.map(frame => JSON.stringify(frame)).join('\n') + '\n' });
        }
        if (matrix && /\/api\/eng\/sprints\/[^/]+\/review$/.test(url.pathname)) return cachedReply({ schemaVersion: 1,
            sprintId: url.pathname.split('/')[4], schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: false } });
        if (matrix && url.pathname.endsWith('/review/values/read')) return cachedReply({ cells: [], unavailableIssueIds: [] });
        if (matrix && url.pathname === '/api/stats/excluded-capacity-source') return cachedReply({ data: { issues: [], epics: {}, sprints: SPRINTS } });
        if (url.pathname === '/api/stats/priority-weights-config') return reply({ weights: [], source: 'test' });
        if (url.pathname === '/api/eng/story-readiness') return reply({ schemaVersion: 1, complete: true, scope: {}, epics: [] });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose') || '';
            const groupId = url.searchParams.get('groupId');
            const sprintId = Number(url.searchParams.get('sprint'));
            if (taskGate && !purpose) await taskGate.promise;
            if (taskAuthFailure && !purpose) return reply({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
            if (project !== 'product' || purpose) return matrix ? cachedReply({ issues: [], epics: {}, epicsInScope: [], names: {} }) : reply({ issues: [], epics: {}, epicsInScope: [], names: {} });
            const epic = epicFor(groupId, sprintId);
            return (matrix ? cachedReply : reply)({ issues: storiesFor(groupId, sprintId), epics: { [epic.key]: { ...epic, id: groupId === 'grp-b' ? '9200' : '9100' } }, epicsInScope: [{ ...epic, id: groupId === 'grp-b' ? '9200' : '9100' }], names: {} });
        }
        if (url.pathname === '/api/missing-info') return reply({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return reply({ epics: [] });
        if (url.pathname === '/api/capacity') return reply({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return reply({ dependencies: {} });
        if (url.pathname === '/api/issues/subtasks') return reply({ parentKey: '', sprint: '', cached: false, summary: null, subtasks: [] });
        return reply({});
    });
    return calls;
}

// Reads that use POST, plus the session refresh every load sends; none of them writes a view.
const READ_ONLY_POSTS = new Set(['/api/dependencies', '/api/performance/loads', '/api/auth/refresh']);
const isReadOnlyPost = call => READ_ONLY_POSTS.has(call.pathname) || call.pathname.startsWith('/api/stats/') || /\/values\/read$/.test(call.pathname);
const mutatingCalls = calls => calls.filter(call => call.method !== 'GET' && !isReadOnlyPost(call));
const signature = call => `${call.method} ${call.pathname}?${[...new URL(call.url).searchParams.keys()].sort().join('&')}${call.aborted ? ' aborted' : ''}`;
const apiSignatures = calls => calls.map(signature).sort();
const taskCalls = calls => calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose);

const readPrefs = page => page.evaluate(key => JSON.parse(window.localStorage.getItem(key) || '{}'), PREFS_KEY);
const engMode = (page, name) => page.locator('.view-selector .eng-mode-control').getByRole('radio', { name });
const teamLabel = page => page.locator('.view-selector .team-dropdown').first().locator('.team-dropdown-selection-label');
// Lead Times quarters are validated against a window that ends at the current quarter, so the test derives its own.
const quarterLabel = (offset = 0) => {
    const now = new Date();
    const index = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) + offset;
    return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
};
const groupToggle = page => page.locator('.group-dropdown-toggle').first();
const sprintToggle = page => page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
const settled = (page, calls) => expect.poll(() => calls.some(call => call.pathname === '/api/missing-info')).toBe(true);

// A link keeps its own query out of analytics; the apply event is the only evidence of its terminal state.
// App-owned payloads use only these two triggers; vendor bookkeeping is outside this contract.
const analyticsEvents = page => page.evaluate(() => (window.dataLayer || []).filter(entry => entry && ['pageview', 'userevent'].includes(entry.event)));
const applyEvents = page => page.evaluate(() => (window.dataLayer || []).filter(entry => entry && entry.event_name === 'share_view_action'));
const ANALYTICS_ENABLED = { enabled: true, measurementId: 'G-SYNTHETIC', ga4UserId: 'synthetic-user', debugMode: false };

const FULL_LINK = '/?v=1&mode=catch-up&group=grp-b&sprint=42&teams=team-b1&find=story&status=only:In%20Progress,Blocked&lanes=product&sort=status&alerts=blocked';

test('a link for another Department and Sprint keeps its fields, Teams and filters through the group-state reset (V5)', async ({ page }) => {
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED,
        prefs: { searchQuery: 'saved search', showProduct: false, showTech: true, showMissingAlert: false, engEpicSort: 'priority', selectedTeams: ['team-a1'], engStatusFilter: { only: ['To Do'] } },
        teamSelection: { 'team-selection::42::grp-b': { selectedTeams: ['team-b2'], selectedTeamId: 'team-b2' } },
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    expect(page.url()).toBe(`${appBaseUrl}/`);
    await expect(page.getByRole('textbox', { name: 'Find in view' })).toHaveValue('story');
    await expect(teamLabel(page)).toHaveText('Beta One');
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    const prefs = await readPrefs(page);
    expect(prefs).toMatchObject({
        activeGroupId: 'grp-b', selectedSprint: 42, sprintName: 'Sprint 42', searchQuery: 'story', selectedTeams: ['team-b1'],
        engStatusFilter: { only: ['In Progress', 'Blocked'] }, showProduct: true, showTech: false, engEpicSort: 'status',
        showBlockedAlert: true, showMissingAlert: false, showPlanning: false, showStats: false, showScenario: false, showBoard: false,
    });
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
    expect((await applyEvents(page))[0]).toMatchObject({ workflow_action: 'apply_link', result: 'success', source_surface: 'catch_up' });
});


test('opening the link strips its keys from the URL before Tag Manager is requested (V3)', async ({ page }) => {
    await installLinkFixture(page, { analytics: { ...ANALYTICS_ENABLED, gtmContainerId: 'GTM-SYNTHETIC' } });
    await page.addInitScript(() => {
        window.__shareOrder = [];
        const replaceState = History.prototype.replaceState;
        History.prototype.replaceState = function patchedReplaceState(...args) {
            window.__shareOrder.push('replaceState');
            return replaceState.apply(this, args);
        };
        const appendChild = Node.prototype.appendChild;
        Node.prototype.appendChild = function patchedAppendChild(node) {
            if (node && node.tagName === 'SCRIPT' && node.dataset && node.dataset.analyticsGtm) window.__shareOrder.push('gtm');
            return appendChild.call(this, node);
        };
    });
    const gtmFrameUrls = [];
    await page.route('https://www.googletagmanager.com/gtm.js?id=GTM-SYNTHETIC', (route) => {
        gtmFrameUrls.push(route.request().frame().url());
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => gtmFrameUrls.length).toBe(1);
    const order = await page.evaluate(() => window.__shareOrder);
    expect(order.indexOf('replaceState')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('replaceState')).toBeLessThan(order.indexOf('gtm'));
    expect(new URL(gtmFrameUrls[0]).search).toBe('');
});

// A manual run starts from the link's resolved state. The Department comes from the groups config (the saved prefs alone do not move it);
// the Sprint, the mode flags and the fields come from the saved prefs.
const MANUAL_DEPARTMENT_B = { preferences: { activeGroupId: 'grp-b' } };
const MANUAL_SCOPE_B42 = { activeGroupId: 'grp-b', selectedSprint: 42, sprintName: 'Sprint 42' };
const reviewCalls = calls => calls.filter(call => /\/api\/eng\/sprints\/[^/]+\/review$/.test(call.pathname));

async function loadRun(browser, setup, entry) {
    const page = await browser.newPage();
    const calls = await installLinkFixture(page, setup);
    await page.goto(`${appBaseUrl}${entry}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return { page, calls };
}

test('a scope-changing link issues no default-scope load and the requests of a manual run pre-seeded to the same state (V6)', async ({ browser }) => {
    const link = await loadRun(browser, { prefs: { engEpicSort: 'priority' } }, FULL_LINK);
    const manual = await loadRun(browser, {
        ...MANUAL_DEPARTMENT_B,
        prefs: {
            ...MANUAL_SCOPE_B42, searchQuery: 'story', selectedTeams: ['team-b1'], showProduct: true, showTech: false,
            engEpicSort: 'status', engStatusFilter: { only: ['In Progress', 'Blocked'] }, showBlockedAlert: true,
        },
        teamSelection: { 'team-selection::42::grp-b': { selectedTeams: ['team-b1'], selectedTeamId: 'team-b1' } },
    }, '/');
    for (const run of [link, manual]) {
        expect(taskCalls(run.calls).length).toBeGreaterThan(0);
        expect(taskCalls(run.calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
    }
    expect(link.calls.some(call => call.params.groupId === 'grp-a' || call.params.sprint === '41')).toBe(false);
    expect(apiSignatures(link.calls)).toEqual(apiSignatures(manual.calls));
    await link.page.close();
    await manual.page.close();
});

// The Planning review reads the review schema for the Sprint it is mounted on, so the hold covers it too: a recipient who saved a Planning
// table never reads the review of the saved Sprint, and a Catch Up link never reads one at all.
for (const [title, entry, manualFlags] of [
    ['a Planning link', '/?v=1&mode=planning&group=grp-b&sprint=42', { showPlanning: true }],
    ['a Catch Up link', '/?v=1&mode=catch-up&group=grp-b&sprint=42', { showPlanning: false }],
]) {
    test(`${title} for a recipient with a saved Planning table issues the requests of a manual run and never reads the review of the saved Sprint (V6)`, async ({ browser }) => {
        const saved = { showPlanning: true, planningLayout: 'table' };
        const link = await loadRun(browser, { prefs: saved }, entry);
        const manual = await loadRun(browser, { ...MANUAL_DEPARTMENT_B, prefs: { ...MANUAL_SCOPE_B42, ...saved, ...manualFlags } }, '/');
        for (const run of [link, manual]) expect(taskCalls(run.calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
        expect(link.calls.some(call => call.params.groupId === 'grp-a' || call.params.sprint === '41' || call.pathname.includes('/sprints/41/'))).toBe(false);
        expect(reviewCalls(link.calls).map(call => call.pathname)).toEqual(reviewCalls(manual.calls).map(call => call.pathname));
        expect(apiSignatures(link.calls)).toEqual(apiSignatures(manual.calls));
        await link.page.close();
        await manual.page.close();
    });
}

test('the link overrides the staged auth and connection recovery capsules (V7)', async ({ page }) => {
    const capturedAt = Date.now();
    const principal = { workspaceId: 'workspace-test', viewConfigId: 'view-test' };
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED,
        capsules: {
            jira_dashboard_auth_resume_v1: {
                version: 1, capturedAt, principal,
                view: { selectedView: 'eng', activeGroupId: 'grp-a', selectedSprint: '41', engMode: 'catch-up', settingsOpen: false, settingsTab: 'teams' },
                planning: { scopeKey: 'planning::41::grp-a', selectedTaskKeys: [], selectedTeams: ['all'], selectionMode: 'manual' },
            },
            jira_dashboard_connection_recovery_v1: {
                version: 1, capturedAt, principal, outage: { id: 'outage-1' }, droppedSettings: false, scenario: null,
                view: { selectedView: 'eng', activeGroupId: 'grp-a', selectedSprint: '41', engMode: 'catch-up', scrollX: 0, scrollY: 0 },
            },
        },
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(groupToggle(page)).toContainText('Beta');
    await expect(sprintToggle(page)).toContainText('Sprint 42');
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, searchQuery: 'story' });
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_connection_recovery_v1'))).toBe(null);
    expect((await applyEvents(page))[0].result).toBe('success');
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
});

test('a same-scope Planning recovery capsule reuses its completed load and applies Teams facets and rows (V7, RF3)', async ({ page }) => {
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED, prefs: { showPlanning: true, planningLayout: 'table', selectedTeams: ['team-a2'] },
        capsules: { jira_dashboard_auth_resume_v1: {
            version: 1, capturedAt: Date.now(), principal: { workspaceId: 'workspace-test', viewConfigId: 'view-test' },
            view: { selectedView: 'eng', activeGroupId: 'grp-a', selectedSprint: '41', engMode: 'planning', settingsOpen: false, settingsTab: 'teams' },
            planning: { scopeKey: 'planning::41::grp-a', selectedTaskKeys: [], selectedTeams: ['team-a2'], selectionMode: 'manual' },
        } },
    });
    await page.goto(`${appBaseUrl}/?v=1&mode=planning&group=grp-a&sprint=41&teams=team-a1&status=only:Blocked&rows=stories`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result)), { timeout: 25000 }).toEqual(['success']);
    await expect(teamLabel(page)).toHaveText('Alpha One');
    expect(await readPrefs(page)).toMatchObject({ selectedTeams: ['team-a1'], engStatusFilter: { only: ['Blocked'] } });
    await expect(page.locator('[aria-label="Planning review rows"]').getByRole('radio', { name: 'Stories' })).toHaveAttribute('aria-checked', 'true');
    await page.waitForLoadState('networkidle');
    expect(taskCalls(calls)).toHaveLength(2);
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-a' && call.params.sprint === '41')).toBe(true);
});

test('a recipient whose saved view is EPM ends in the link ENG view (V15, RF2)', async ({ page }) => {
    const activeHomeToken = { connected: true, provider: 'atlassian_user_api_token', credentialSubject: 'profile@example.com', status: 'active', lastValidatedAt: '2026-05-11T09:00:00Z', needsReconnect: false };
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, homeToken: activeHomeToken, prefs: { selectedView: 'epm', showScenario: false } });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    await expect(groupToggle(page)).toContainText('Beta');
    await page.waitForTimeout(1500);
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    expect((await applyEvents(page))[0]).toMatchObject({ workflow_action: 'apply_link', result: 'success', source_surface: 'catch_up' });
    expect(await readPrefs(page)).toMatchObject({ selectedView: 'eng', showScenario: false, showPlanning: false, showStats: false, showBoard: false, activeGroupId: 'grp-b' });
});

test('a recipient whose saved flags are Scenario ends in the link ENG view (RF2)', async ({ page }) => {
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { selectedView: 'eng', showScenario: true } });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    await expect(groupToggle(page)).toContainText('Beta');
    await page.waitForTimeout(1500);
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    expect((await applyEvents(page))[0]).toMatchObject({ workflow_action: 'apply_link', result: 'success', source_surface: 'catch_up' });
    expect(await readPrefs(page)).toMatchObject({ selectedView: 'eng', showScenario: false, showPlanning: false, showStats: false, showBoard: false, activeGroupId: 'grp-b' });
});

test('a same-scope link skips the scope write but still applies its fields, Teams and facets with one load (RF3)', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { selectedTeams: ['team-a2'], engStatusFilter: { only: ['To Do'] }, showTech: false } });
    await page.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-a&sprint=41&teams=team-a1&find=story&status=only:Blocked`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(teamLabel(page)).toHaveText('Alpha One');
    await expect(page.getByRole('textbox', { name: 'Find in view' })).toHaveValue('story');
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-a', selectedSprint: 41, selectedTeams: ['team-a1'], engStatusFilter: { only: ['Blocked'] }, showTech: true });
    expect(taskCalls(calls).filter(call => call.params.groupId === 'grp-a' && call.params.sprint === '41').length).toBe(2);
    expect(calls.filter(call => call.pathname === '/api/sprints')).toHaveLength(1);
    expect((await applyEvents(page))[0].result).toBe('success');
});

test('opening a link performs no mutating request outside the read-only allowlist, and reaches no preference or write route (V1)', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await settled(page, calls);
    await page.waitForLoadState('networkidle');
    expect(mutatingCalls(calls)).toEqual([]);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences' || call.pathname.startsWith('/api/me/onboarding')
        || call.pathname.startsWith('/api/issues/') || (call.pathname === '/api/groups-config' && call.method !== 'GET'))).toEqual([]);
    const events = await analyticsEvents(page);
    expect(events.some(event => event.event === 'pageview')).toBe(true);
    expect(events.some(event => event.event === 'userevent')).toBe(true);
    expect((await applyEvents(page))[0]).toMatchObject({ workflow_action: 'apply_link', result: 'success', source_surface: 'catch_up' });
    // Fixed mode/surface enums are allowed; the link's scope, search and facet values are private.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/grp-b|team-b1|BET-|Beta|In Progress|Blocked/);
    expect(serialized).not.toContain(FULL_LINK);
    // A numeric duration can coincidentally equal the Sprint id; strings and every other field stay checked.
    const payloadValues = value => value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, entry]) => key === 'duration_ms' && typeof entry === 'number' ? [] : payloadValues(entry))
        : [value];
    const values = payloadValues(events);
    expect(values).not.toContain('story');
    expect(values).not.toContain(42);
    expect(values).not.toContain('42');
});

test('the link Department becomes the local favorite in JSON mode and never writes the server favorite in DB mode (V19)', async ({ browser }) => {
    const jsonPage = await browser.newPage();
    const jsonCalls = await installLinkFixture(jsonPage, { groupsSource: 'jsonfile', analytics: ANALYTICS_ENABLED });
    await jsonPage.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(jsonPage).then(events => events.length)).toBe(1);
    await expect.poll(async () => (await readPrefs(jsonPage)).groupVisibilityPreferences?.activeGroupId).toBe('grp-b');
    expect(jsonCalls.filter(call => call.pathname === '/api/groups-preferences')).toEqual([]);

    const dbPage = await browser.newPage();
    const dbCalls = await installLinkFixture(dbPage, { groupsSource: 'workspace_db', analytics: ANALYTICS_ENABLED });
    await dbPage.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(dbPage).then(events => events.length)).toBe(1);
    await expect(groupToggle(dbPage)).toContainText('Beta');
    await dbPage.waitForLoadState('networkidle');
    expect(dbCalls.filter(call => call.pathname === '/api/groups-preferences')).toEqual([]);
    expect((await readPrefs(dbPage)).groupVisibilityPreferences?.activeGroupId).toBe('grp-a');
    await jsonPage.close();
    await dbPage.close();
});

for (const [mode, query, radio, flags] of [
    ['planning', 'mode=planning&group=grp-b&sprint=42&layout=table', 'Planning', { showPlanning: true, planningLayout: 'table' }],
    ['board', 'mode=board&group=grp-a&sprint=41&find=story', 'Board', { showBoard: true, searchQuery: 'story' }],
    ['statistics', `mode=statistics&group=grp-a&sprint=41&stats=cohort&from=${quarterLabel(-1)}&to=${quarterLabel(0)}`, 'Statistics', { showStats: true, statsView: 'cohort', cohortStartQuarter: quarterLabel(-1), cohortEndQuarter: quarterLabel(0) }],
]) {
    test(`a ${mode} link applies its mode and fields whatever the recipient's saved mode`, async ({ page }) => {
        await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { showScenario: true } });
        await page.goto(`${appBaseUrl}/?v=1&${query}`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
        await expect(engMode(page, radio)).toHaveAttribute('aria-checked', 'true');
        expect(await readPrefs(page)).toMatchObject({ showScenario: false, ...flags });
        expect((await applyEvents(page))[0]).toMatchObject({ result: 'success', source_surface: mode });
    });
}

test('a deliberate interaction while the scope loads cancels the link and keeps what was applied (V16)', async ({ page }) => {
    const taskGate = deferred();
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, taskGate, prefs: { engStatusFilter: { only: ['To Do'] } } });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    await expect.poll(async () => (await readPrefs(page)).searchQuery).toBe('story');
    await page.mouse.click(2, 2);
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['rejected']);
    taskGate.resolve();
    await settled(page, calls);
    await page.waitForLoadState('networkidle');
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, engStatusFilter: { only: ['To Do'] } });
    expect(await applyEvents(page)).toHaveLength(1);
});

test('a terminal auth lock drops the pending link and leaves the lock unchanged (V16)', async ({ page }) => {
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, taskAuthFailure: true });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['rejected']);
    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
});

test('a first-run recipient is held through the Department popup, then the link is dropped and the Catch Up tour waits for it (RF1, V16)', async ({ page }) => {
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED,
        preferences: { onboardingRequired: true, onboardingDone: false, completedOnboardingModules: [], effectiveVisibleGroupIds: [], activeGroupId: null },
    });
    await page.route('**/api/groups-preferences', async (route) => {
        const body = route.request().postDataJSON() || {};
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: false, completedOnboardingModules: [], visibleGroupIds: body.visibleGroupIds, activeGroupId: body.activeGroupId, effectiveVisibleGroupIds: body.visibleGroupIds },
                groupsConfigSnapshot: {
                    version: 1, configRevision: 1, source: 'workspace_db', defaultGroupId: 'grp-a', groups: GROUPS,
                    preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: false, completedOnboardingModules: [], visibleGroupIds: body.visibleGroupIds, activeGroupId: body.activeGroupId, effectiveVisibleGroupIds: body.visibleGroupIds },
                },
            }),
        });
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(picker).toBeVisible();
    await page.waitForTimeout(1000);
    expect(taskCalls(calls)).toEqual([]);
    expect(await applyEvents(page)).toEqual([]);
    await picker.getByRole('radio', { name: /Alpha/ }).check();
    await picker.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['rejected']);
    await expect(groupToggle(page)).toHaveCount(0);
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-a')).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toBeVisible();
});

test('the Catch Up tour does not auto-start while the link is still applying (RF1)', async ({ page }) => {
    const taskGate = deferred();
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED, taskGate,
        preferences: { onboardingDone: false, completedOnboardingModules: [] },
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await applyEvents(page)).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    taskGate.resolve();
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toBeVisible();
});

test('a focus target that exists is revealed and one that does not is reported as partial (Stage D)', async ({ browser }) => {
    const found = await browser.newPage();
    await installLinkFixture(found, { analytics: ANALYTICS_ENABLED });
    await found.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-b&sprint=42&epic=BET-100`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(found).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(found.locator('.epic-block[data-epic-key="BET-100"]')).toBeVisible();

    const missing = await browser.newPage();
    await installLinkFixture(missing, { analytics: ANALYTICS_ENABLED });
    await missing.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-b&sprint=42&teams=team-b1&epic=BET-999`, { waitUntil: 'domcontentloaded' });
    // The reveal polls for a mounted target for up to eight seconds before it reports a miss.
    await expect.poll(() => applyEvents(missing).then(events => events.map(event => event.result)), { timeout: 20000 }).toEqual(['partial']);
    expect(await readPrefs(missing)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, selectedTeams: ['team-b1'] });
    await expect(teamLabel(missing)).toHaveText('Beta One');
    // A miss never opens Jira and never clears a filter: no filter event is emitted and the Teams stay as the link set them (V4).
    expect(await missing.evaluate(() => (window.dataLayer || []).filter(entry => entry && entry.event_name === 'filter_changed'))).toEqual([]);
    await found.close();
    await missing.close();
});

test('a Planning link switches a Planning table that is already open to the rows of the link', async ({ page }) => {
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { showPlanning: true, planningLayout: 'table' } });
    await page.goto(`${appBaseUrl}/?v=1&mode=planning&group=grp-a&sprint=41&rows=stories`, { waitUntil: 'domcontentloaded' });
    const rows = page.locator('[aria-label="Planning review rows"]');
    await expect(rows).toBeVisible();
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(rows.getByRole('radio', { name: 'Stories' })).toHaveAttribute('aria-checked', 'true');
    await expect(rows.getByRole('radio', { name: 'Epics' })).toHaveAttribute('aria-checked', 'false');
});

test('a source-only Statistics link for another Department loads no Catch Up tasks for any scope', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED });
    await page.goto(`${appBaseUrl}/?v=1&mode=statistics&group=grp-b&sprint=41&stats=projectTrack&from=41&to=41`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(engMode(page, 'Statistics')).toHaveAttribute('aria-checked', 'true');
    await page.waitForLoadState('networkidle');
    expect(taskCalls(calls)).toEqual([]);
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 41, showStats: true, statsView: 'projectTrack', excludedCapacityStartSprintId: '41', excludedCapacityEndSprintId: '41' });
});

test('a link equal to the recipient current view writes nothing new and still completes with one load', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED });
    await page.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-a&sprint=41`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await settled(page, calls);
    expect(taskCalls(calls).filter(call => call.params.groupId === 'grp-a' && call.params.sprint === '41')).toHaveLength(2);
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-a', selectedSprint: 41, searchQuery: '', showPlanning: false });
});

const shareState = page => page.evaluate(() => (window.__shareViewProbe ? { disabled: window.__shareViewProbe.shareDisabled, terminal: window.__shareViewProbe.applyTerminal } : null));

test('Share stays disabled while a link applies and is enabled once the view has settled', async ({ page }) => {
    const taskGate = deferred();
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, taskGate });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    expect(await shareState(page)).toEqual({ disabled: true, terminal: false });
    taskGate.resolve();
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect.poll(() => shareState(page)).toEqual({ disabled: false, terminal: true });
});

test('Share is enabled in a source-only Statistics view, which loads no task list and so never hydrates the Team selection', async ({ browser }) => {
    const saved = await browser.newPage();
    const savedCalls = await installLinkFixture(saved, { prefs: { showStats: true, statsView: 'projectTrack', excludedCapacityStartSprintId: '41', excludedCapacityEndSprintId: '41' } });
    await saved.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(engMode(saved, 'Statistics')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => shareState(saved)).toEqual({ disabled: false, terminal: true });
    expect(taskCalls(savedCalls)).toEqual([]);

    const linked = await browser.newPage();
    const linkedCalls = await installLinkFixture(linked, { analytics: ANALYTICS_ENABLED });
    await linked.goto(`${appBaseUrl}/?v=1&mode=statistics&group=grp-b&sprint=41&stats=projectTrack&from=41&to=41`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(linked).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect.poll(() => shareState(linked)).toEqual({ disabled: false, terminal: true });
    expect(taskCalls(linkedCalls)).toEqual([]);
    await saved.close();
    await linked.close();
});

// Test-only initial-state probes above preseed the same state written by the real manual controls:
// selectBoardScope -> setBoardStrictScope(scope), and commitSprintSelection's projectTrackRange ->
// excludedCapacityForceRefreshRef.current = true. They change no effect, request or cache implementation.
// AC4: explicit backend cache priming and persisted display-cache seeding, while the existing
// catalog controller still validates its source before either manual navigation or a link can load.
const MATRIX_SOURCE = { backend: 'postgresql', identity: 'sc1:synthetic-share', boardId: '42', browserContextId: 'bc1:synthetic-share' };
const MATRIX_CASES = [
    { name: 'Catch Up', mode: 'catch-up', flags: {}, endpoint: '/api/tasks-with-team-name' },
    { name: 'Planning', mode: 'planning', flags: { showPlanning: true, planningLayout: 'table' }, endpoint: '/api/tasks-with-team-name' },
    { name: 'ordinary Board', mode: 'board', flags: { showBoard: true }, endpoint: '/api/tasks-with-team-name' },
    ...['component', 'all_work'].map(scope => ({ name: `strict Board ${scope}`, mode: 'board', query: `&scope=${scope}`,
        flags: { showBoard: true }, endpoint: '/api/eng/board', strict: scope })),
    { name: 'task-loading Statistics', mode: 'statistics', flags: { showStats: true, statsView: 'teams' }, endpoint: '/api/tasks-with-team-name' },
    { name: 'source-only Statistics Project Track', mode: 'statistics', query: '&stats=projectTrack&from=42&to=42',
        flags: { showStats: true, statsView: 'projectTrack', excludedCapacityStartSprintId: '42', excludedCapacityEndSprintId: '42' }, endpoint: '/api/stats/excluded-capacity-source', sourceOnly: true },
];
const normalizedBody = body => {
    if (Array.isArray(body)) return body.map(normalizedBody).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (body && typeof body === 'object') return Object.fromEntries(Object.keys(body).sort().map(key => [key, normalizedBody(body[key])]));
    return body;
};
const scopedPostBodies = calls => calls.filter(call => call.method === 'POST' && call.pathname !== '/api/performance/loads')
    .map(call => `${call.pathname} ${JSON.stringify(normalizedBody(call.body ? JSON.parse(call.body) : null))}`).sort();

async function matrixRun(browser, scenario, { linked = false, backendCache = new Map(), sprintCatalog } = {}) {
    const page = await browser.newPage();
    const manualPrefs = { ...MANUAL_SCOPE_B42, ...scenario.flags };
    // Match the raw session state the real selectBoardScope/commitSprintSelection controls write;
    // it has no persisted preference key. Only the initial value changes in the synthetic bundle.
    const calls = await installLinkFixture(page, { matrix: true, backendCache, analytics: ANALYTICS_ENABLED,
        ...(linked ? {} : MANUAL_DEPARTMENT_B), strictScope: linked ? '' : scenario.strict || '', statsRefresh: !linked && Boolean(scenario.sourceOnly),
        prefs: { ...(linked ? { selectedSprint: 40, sprintName: 'Sprint 40' } : manualPrefs), ...(sprintCatalog ? { sprintCatalog } : {}) },
    });
    await page.goto(`${appBaseUrl}${linked ? `/?v=1&mode=${scenario.mode}&group=grp-b&sprint=42${scenario.query || ''}` : '/'}`, { waitUntil: 'domcontentloaded' });
    if (linked) await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(engMode(page, scenario.mode === 'catch-up' ? 'Catch Up' : scenario.mode === 'statistics' ? 'Statistics' : scenario.mode === 'board' ? 'Board' : 'Planning')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => calls.some(call => call.pathname === scenario.endpoint && call.completed)).toBe(true);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return { page, calls, linked };
}

for (const scenario of MATRIX_CASES) {
    for (const cache of ['cold', 'warm']) {
        test(`AC4 ${scenario.name} ${cache}: link and manual API request multisets match`, async ({ browser }) => {
            const backendCache = new Map();
            let sprintCatalog;
            if (cache === 'warm') {
                const primed = await matrixRun(browser, scenario, { backendCache });
                sprintCatalog = (await readPrefs(primed.page)).sprintCatalog;
                expect(sprintCatalog).toMatchObject({ version: 2, identity: MATRIX_SOURCE.identity, catalogVersion: '33333333-3333-4333-8333-333333333333' });
                expect(sprintCatalog.validatedAt).toBeTruthy();
                await primed.page.close();
            }
            // Identical warmed snapshots; neither measured run can warm the other.
            const link = await matrixRun(browser, scenario, { linked: true, backendCache: new Map(backendCache), sprintCatalog });
            const manual = await matrixRun(browser, scenario, { backendCache: new Map(backendCache), sprintCatalog });
            for (const run of [link, manual]) {
                expect(mutatingCalls(run.calls)).toEqual([]);
                expect(run.calls.filter(call => call.params.groupId === 'grp-a' || call.params.departmentId === 'grp-a'
                    || call.params.sprint === '40' || call.params.sprintId === '40' || call.pathname.includes('/sprints/40/'))).toEqual([]);
                for (const call of run.calls) {
                    if (call.params.sprint) expect(call.params.sprint).toBe('42');
                    if (call.params.sprintId) expect(call.params.sprintId).toBe('42');
                    if (call.params.teamIds) expect(call.params.teamIds.split(',').every(id => ['team-b1', 'team-b2'].includes(id))).toBe(true);
                }
                const scoped = run.calls.filter(call => call.pathname === scenario.endpoint);
                expect(scoped.every(call => call.cacheHit === (cache === 'warm' && !call.cacheBypassed))).toBe(true);
                // Warm source-only initial navigation deliberately bypasses its data cache on both paths.
                // The warmed catalog is still consumed and validated; never relabel a forced source miss as a hit.
                const catalog = run.calls.find(call => call.pathname === '/api/sprints');
                expect(catalog.cacheHit).toBe(cache === 'warm');
                expect((await readPrefs(run.page)).sprintCatalog.identity).toBe(MATRIX_SOURCE.identity);
                expect(await readPrefs(run.page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, ...scenario.flags });
                if (scenario.strict) {
                    expect(scoped).toHaveLength(1);
                    expect(scoped[0].params).toMatchObject({ departmentId: 'grp-b', scope: scenario.strict });
                    expect(scoped[0].params.sprintId).toBeUndefined();
                    expect(taskCalls(run.calls)).toEqual([]);
                    await expect(run.page.locator('.eng-board')).toHaveCount(1);
                } else if (scenario.sourceOnly) {
                    expect(taskCalls(run.calls)).toEqual([]);
                    expect(scoped.every(call => call.cacheBypassed && !call.cacheHit)).toBe(true);
                    expect(scoped.map(call => JSON.parse(call.body))).toEqual([{ sprintIds: ['42'], teamIds: ['team-b1', 'team-b2'], refresh: true }]);
                    await expect(run.page.getByText('Excluded capacity fetch failed', { exact: false })).toHaveCount(0);
                } else {
                    expect(taskCalls(run.calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
                }
                for (const call of run.calls.filter(call => call.pathname === '/api/dependencies')) {
                    expect(JSON.parse(call.body).keys.every(key => key.startsWith('BET-'))).toBe(true);
                }
                if (scenario.mode === 'planning') {
                    expect(reviewCalls(run.calls)).toHaveLength(1);
                    const values = run.calls.filter(call => call.pathname === '/api/eng/sprints/42/review/values/read');
                    expect(values.length).toBeGreaterThan(0);
                    expect(values.every(call => JSON.parse(call.body).issueIds.every(id => id === '9200' || id.startsWith('BET-')))).toBe(true);
                }
            }
            expect(apiSignatures(link.calls)).toEqual(apiSignatures(manual.calls));
            expect(scopedPostBodies(link.calls)).toEqual(scopedPostBodies(manual.calls));
            await link.page.close();
            await manual.page.close();
        });
    }
}

test('AC4 request normalization preserves duplicate query names and aborted request entries', () => {
    const call = { method: 'GET', pathname: '/api/synthetic-read', url: `${appBaseUrl}/api/synthetic-read?team=one&team=two&sprint=42`, aborted: true };
    expect(apiSignatures([call, call])).toEqual(['GET /api/synthetic-read?sprint&team&team aborted', 'GET /api/synthetic-read?sprint&team&team aborted']);
});

test('AC4 logger counts two real aborted requests to the same URL separately', async ({ page }) => {
    const calls = await installLinkFixture(page);
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.route('**/api/synthetic-read?*', route => route.abort());
    await page.evaluate(async () => {
        const url = '/api/synthetic-read?team=one&team=two&sprint=42';
        await Promise.all([fetch(url).catch(() => {}), fetch(url).catch(() => {})]);
    });
    const aborted = () => calls.filter(call => call.pathname === '/api/synthetic-read');
    await expect.poll(() => aborted().filter(call => call.aborted).length).toBe(2);
    expect(apiSignatures(aborted())).toEqual(['GET /api/synthetic-read?sprint&team&team aborted', 'GET /api/synthetic-read?sprint&team&team aborted']);
});
