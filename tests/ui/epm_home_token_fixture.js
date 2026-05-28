const fs = require('fs');
const path = require('path');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'jira-dashboard.html'), 'utf8');
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

function activeHomeTokenConnection(subject = 'profile@example.com') {
    return {
        connected: true,
        provider: 'atlassian_user_api_token',
        credentialSubject: subject,
        status: 'active',
        lastValidatedAt: '2026-05-11T09:00:00Z',
        needsReconnect: false,
    };
}

function disconnectedHomeTokenConnection() {
    return { connected: false };
}

function isActiveHomeToken(connection) {
    return Boolean(connection?.connected && connection.status === 'active' && !connection.needsReconnect);
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
    const requiresHomeTokenConnection = authMode !== 'basic';
    let currentConnection = options.connection || disconnectedHomeTokenConnection();
    let epmPrerequisite = Boolean(options.epmPrerequisite);

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
        const homeTokenRequired = () => json({
            error: 'home_user_token_required',
            message: 'Connect your Atlassian API token to load EPM Home projects.',
            connectUrl: '/settings/connections/home-token',
        }, 409);

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode, authenticated: true, email: 'profile@example.com', profile: { email: 'profile@example.com' } });
        }
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/me/connections/home-token' && request.method() === 'GET') {
            return json(currentConnection);
        }
        if (url.pathname === '/api/me/connections/home-token' && request.method() === 'POST') {
            currentConnection = activeHomeTokenConnection('profile@example.com');
            epmPrerequisite = false;
            return json(currentConnection);
        }
        if (url.pathname === '/api/me/connections/home-token' && request.method() === 'DELETE') {
            currentConnection = disconnectedHomeTokenConnection();
            epmPrerequisite = true;
            return json(currentConnection);
        }
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
        if (url.pathname === '/api/epm/goals') {
            if (requiresHomeTokenConnection && (epmPrerequisite || !isActiveHomeToken(currentConnection))) {
                return json({
                    goals: [],
                    error: 'Connect your Atlassian API token to load EPM Home projects.',
                    errorCode: 'home_user_token_required',
                    connectUrl: '/settings/connections/home-token',
                });
            }
            if (url.searchParams.get('rootGoalKey')) {
                return json({ goals: [{ id: 'child', key: 'CHILD-200', name: 'Connected Child Goal' }], error: '' });
            }
            return json({ goals: [{ id: 'root', key: 'ROOT-100', name: 'Connected Root Goal' }], error: '' });
        }
        if (url.pathname === '/api/epm/projects/configuration') {
            if (requiresHomeTokenConnection && (epmPrerequisite || !isActiveHomeToken(currentConnection))) {
                currentConnection = disconnectedHomeTokenConnection();
                return homeTokenRequired();
            }
            return json({ projects: [epmProject('active')], homeProjectCount: 1, cacheHit: false });
        }
        if (url.pathname === '/api/jira/labels') return json({ labels: ['rnd_project_connected'] });
        if (url.pathname === '/api/epm/projects') {
            if (requiresHomeTokenConnection && (epmPrerequisite || !isActiveHomeToken(currentConnection))) {
                currentConnection = disconnectedHomeTokenConnection();
                return homeTokenRequired();
            }
            return json({ projects: [epmProject(url.searchParams.get('tab') || 'active')] });
        }
        if (url.pathname === '/api/epm/projects/rollup/all') {
            if (requiresHomeTokenConnection && (epmPrerequisite || !isActiveHomeToken(currentConnection))) {
                currentConnection = disconnectedHomeTokenConnection();
                return homeTokenRequired();
            }
            const project = epmProject(url.searchParams.get('tab') || 'active');
            const rollupPayload = resolveFixturePayload(options.allProjectsRollup, project, url);
            if (rollupPayload) return json(rollupPayload);
            return json({ projects: [emptyRollup(project)], duplicates: {}, truncated: false, fallback: true });
        }
        if (url.pathname.startsWith('/api/epm/projects/') && url.pathname.endsWith('/rollup')) {
            if (requiresHomeTokenConnection && (epmPrerequisite || !isActiveHomeToken(currentConnection))) {
                currentConnection = disconnectedHomeTokenConnection();
                return homeTokenRequired();
            }
            const project = epmProject(url.searchParams.get('tab') || 'active');
            const rollupPayload = resolveFixturePayload(options.projectRollup, project, url);
            return json(rollupPayload || emptyRollup(project).rollup);
        }
        return json({});
    });

    return {
        appBaseUrl,
        calls,
        getConnection: () => currentConnection,
        setConnection: (connection) => { currentConnection = connection || disconnectedHomeTokenConnection(); },
        setEpmPrerequisite: (value) => { epmPrerequisite = Boolean(value); },
    };
}

async function installDashboardShell(page) {
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
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
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

async function openConnectionsSettings(page) {
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: 'Connections' }).click();
    await page.getByText('Jira Home write access').waitFor({ state: 'visible' });
    return dialog;
}

module.exports = {
    appBaseUrl,
    activeHomeTokenConnection,
    disconnectedHomeTokenConnection,
    epmMetadataCalls,
    installDashboardFixture,
    installDashboardShell,
    openConnectionsSettings,
    selectedSprintId,
    selectedSprintName,
};
