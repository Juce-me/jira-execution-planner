const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'jira-dashboard.html'), 'utf8');
const authFocusRefreshJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dist', 'auth-focus-refresh.js'), 'utf8');
const earlyBootstrapJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dist', 'early-bootstrap.js'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dist', 'dashboard.js'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dist', 'dashboard.css'), 'utf8');
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] },
    issueTypes: { initiative: ['Initiative'], epic: ['Epic'], leaf: ['Story', 'Task'] },
    projects: {
        'home-1': { id: 'home-1', homeProjectId: 'home-1', name: 'Connected Home Project', label: 'rnd_project_connected' },
    },
};

// EPM read readiness is the private checkbox + verified Home scopes + the access decision. An ENABLED OAuth fixture says so explicitly; production-like
// missing fields fail closed, so the fixture defaults are off.
function enabledEpmOptions(extra = {}) {
    return {
        epmViewEnabled: true,
        epmHomeReadAvailable: true,
        epmAccess: { state: 'available' },
        ...extra,
    };
}

function epmAccessBody(access) {
    const source = typeof access === 'string' ? { state: access } : (access || { state: 'disabled' });
    return { epmHomeReadAvailable: source.state === 'available', ...source };
}

function epmProject(tab = 'active') {
    const stateByTab = {
        active: ['ON_TRACK', 'On track'],
        backlog: ['PAUSED', 'Paused'],
        archived: ['DONE', 'Done'],
    };
    const [stateValue, stateLabel] = stateByTab[tab] || stateByTab.active;
    return {
        id: 'home-1',
        homeProjectId: 'home-1',
        name: 'Connected Home Project',
        displayName: 'Connected Home Project',
        label: 'rnd_project_connected',
        stateValue,
        stateLabel,
        tabBucket: tab,
        latestUpdateDate: '2026-05-11',
        latestUpdateSnippet: 'Connected project metadata loaded from Home.',
        homeUrl: 'https://home.example/project/home-1',
        resolvedLinkage: { labels: ['rnd_project_connected'], epicKeys: [] },
        matchState: 'home-linked',
        subGoalKeys: ['CHILD-200'],
        subGoals: [{ key: 'CHILD-200', name: 'Connected Child Goal' }],
    };
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

function resolveFixturePayload(value, ...args) {
    return typeof value === 'function' ? value(...args) : value;
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

async function installDashboardFixture(page, options = {}) {
    const calls = [];
    const authMode = options.authMode || 'atlassian_oauth';
    const epmState = {
        viewEnabled: options.epmViewEnabled === true,
        homeReadAvailable: options.epmHomeReadAvailable === true,
        loginUrl: options.epmHomeReadLoginUrl || '',
        access: options.epmAccess || { state: 'disabled' },
        preferenceFailure: options.epmPreferenceFailure || null,
        // Applied when a successful preference POST turns the checkbox on (consent granted meanwhile).
        afterEnable: options.epmAfterEnable || null,
        failure: options.epmFailure || null,
    };

    await installDashboardShell(page);

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

        const epmRead = url.pathname.startsWith('/api/epm/') && request.method() === 'GET';
        const injected = epmRead && epmState.failure ? epmState.failure(url, calls) : null;
        if (injected) {
            return route.fulfill({
                status: injected.status,
                contentType: 'application/json',
                headers: injected.headers || {},
                body: JSON.stringify(injected.body || {}),
            });
        }
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode, authenticated: true, email: 'profile@example.com', profile: { email: 'profile@example.com' } });
        }
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                authMode,
                settingsAdminOnly: options.settingsAdminOnly ?? false,
                userCanEditSettings: options.userCanEditSettings ?? true,
                userCanEditEpmConfig: options.userCanEditEpmConfig ?? true,
                environmentConfigExists: options.environmentConfigExists ?? true,
                projectsConfigured: true,
                epm: { ...epmConfig, ...(options.epmConfig || {}) },
                ...(options.omitEpmCapabilityFields ? {} : {
                    epmViewEnabled: epmState.viewEnabled,
                    epmHomeReadAvailable: epmState.homeReadAvailable,
                    ...(epmState.loginUrl ? { epmHomeReadLoginUrl: epmState.loginUrl } : {}),
                }),
                ...(options.configExtras || {}),
                viewConfig: {
                    workspaceId: 'workspace-test',
                    viewConfigId: 'view-test',
                    view: { epm: { ...epmConfig, ...(options.epmConfig || {}) } },
                },
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json({ version: 1, groups: [], defaultGroupId: '', source: 'test' });
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/board-config') return json({ boardId: '5494', boardName: 'Synthetic Board', source: 'test' });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/capacity/config') return json({ project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json({ fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json({ issueTypes: ['Epic', 'Story'] });
        if (url.pathname === '/api/issue-types') return json({ issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        if (url.pathname === '/api/epm/config') return json({ ...epmConfig, ...(options.epmConfig || {}) });
        if (url.pathname === '/api/epm/scope') return json({ cloudId: 'synthetic-cloud', error: '' });
        if (url.pathname === '/api/epm/access') {
            return json(epmAccessBody(typeof epmState.access === 'function' ? epmState.access(url) : epmState.access));
        }
        if (url.pathname === '/api/epm/preferences' && request.method() === 'POST') {
            if (epmState.preferenceFailure) {
                return json(epmState.preferenceFailure.body || { error: 'epm_preferences_failed' }, epmState.preferenceFailure.status || 500);
            }
            epmState.viewEnabled = requestBody(request)?.viewEnabled === true;
            if (epmState.viewEnabled && epmState.afterEnable) {
                if ('homeReadAvailable' in epmState.afterEnable) epmState.homeReadAvailable = epmState.afterEnable.homeReadAvailable;
                if ('access' in epmState.afterEnable) epmState.access = epmState.afterEnable.access;
                if ('loginUrl' in epmState.afterEnable) epmState.loginUrl = epmState.afterEnable.loginUrl;
            }
            return json({ epmViewEnabled: epmState.viewEnabled });
        }
        if (url.pathname === '/api/epm/goals') {
            if (url.searchParams.get('rootGoalKey')) {
                return json({
                    goals: options.epmSubGoals || [{ id: 'child', key: 'CHILD-200', name: 'Connected Child Goal' }],
                    error: '',
                });
            }
            return json({ goals: [{ id: 'root', key: 'ROOT-100', name: 'Connected Root Goal' }], error: '' });
        }
        const projectsFor = (tab) => (options.epmProjects ? options.epmProjects(tab) : [epmProject(tab)]);
        if (url.pathname === '/api/epm/projects/configuration') {
            return json({ projects: projectsFor('active'), homeProjectCount: projectsFor('active').length, cacheHit: false });
        }
        if (url.pathname === '/api/jira/labels') return json({ labels: ['rnd_project_connected'] });
        if (url.pathname === '/api/epm/projects') {
            return json({ projects: projectsFor(url.searchParams.get('tab') || 'active') });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            const project = epmProject(url.searchParams.get('tab') || 'active');
            const rollupPayload = resolveFixturePayload(options.allProjectsRollup, project, url);
            if (rollupPayload) return json(rollupPayload);
            return json({ projects: [emptyRollup(project)], duplicates: {}, truncated: false, fallback: true });
        }
        if (url.pathname.startsWith('/api/epm/projects/') && url.pathname.endsWith('/rollup')) {
            const project = epmProject(url.searchParams.get('tab') || 'active');
            const rollupPayload = resolveFixturePayload(options.projectRollup, project, url);
            return json(rollupPayload || emptyRollup(project).rollup);
        }
        return json({});
    });

    return {
        appBaseUrl,
        calls,
        epmState,
        setEpmAccess: (access) => { epmState.access = access; },
        setEpmFailure: (failure) => { epmState.failure = failure; },
        setEpmHomeReadAvailable: (value, loginUrl = '') => { epmState.homeReadAvailable = value === true; epmState.loginUrl = loginUrl; },
    };
}

async function installDashboardShell(page) {
    await page.route('**/frontend/dist/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        const relative = pathname.slice('/frontend/dist/'.length);
        if (!/^(?:chunks\/[A-Za-z0-9_-]+\.js|lazy-views-[a-f0-9]{64}\.json)$/.test(relative)) return route.fallback();
        const dist = path.resolve(__dirname, '../../frontend/dist');
        const filename = path.resolve(dist, relative);
        if (!filename.startsWith(dist + path.sep) || !fs.existsSync(filename)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: relative.endsWith('.json') ? 'application/json' : 'application/javascript', body: fs.readFileSync(filename) });
    });
    await page.route(/https?:\/\/[^/]+\/$/, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: dashboardHtml,
    }));
    await page.route('**/jira-dashboard.html', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: dashboardHtml,
    }));
    await page.route('**/frontend/dist/auth-focus-refresh.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: authFocusRefreshJs,
    }));
    // The early startup script starts /api/config and /api/groups-config at HTML parse; the app
    // adopts both, so each is still requested once and served by the page's /api routes.
    await page.route('**/frontend/dist/early-bootstrap.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: earlyBootstrapJs,
    }));
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    await page.route('**/frontend/dist/auth-focus-refresh.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: authFocusRefreshJs,
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: dashboardCss,
    }));
    await page.route('**/epm-burst.svg', route => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    }));
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
    }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
}

function epmMetadataCalls(calls) {
    return calls.filter(call => (
        call.pathname === '/api/epm/goals' ||
        call.pathname === '/api/epm/projects' ||
        call.pathname === '/api/epm/projects/rollup/all' ||
        (call.pathname.startsWith('/api/epm/projects/') && call.pathname.endsWith('/rollup')) ||
        call.pathname === '/api/epm/projects/configuration'
    ));
}

function epmAccessCalls(calls) {
    return calls.filter(call => call.pathname === '/api/epm/access');
}

// The first /api/config read gates all ENG Jira work: while it is pending nothing loads and the
// Sprint selector stays unavailable. `paths` returns the request pathnames seen so far.
async function expectConfigBootstrapHoldsJiraWork(page, paths) {
    await expect.poll(() => paths().includes('/api/config')).toBe(true);
    await page.evaluate(() => new Promise(resolve => (
        requestAnimationFrame(() => requestAnimationFrame(resolve))
    )));
    expect(paths().filter(pathname => (
        pathname === '/api/sprints' || pathname === '/api/tasks-with-team-name'
            || pathname.startsWith('/api/eng/board') || pathname.startsWith('/api/stats/')
    ))).toEqual([]);
    await expect(page.getByRole('button', { name: 'Select sprint', exact: true }).first())
        .toHaveAttribute('aria-disabled', 'true');
}

async function openConnectionsSettings(page) {
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await dialog.locator('.user-connections-settings').waitFor({ state: 'visible' });
    return dialog;
}

module.exports = {
    appBaseUrl,
    enabledEpmOptions,
    epmAccessCalls,
    epmMetadataCalls,
    epmProject,
    emptyRollup,
    expectConfigBootstrapHoldsJiraWork,
    installDashboardFixture,
    installDashboardShell,
    openConnectionsSettings,
    selectedSprintId,
    selectedSprintName,
};
