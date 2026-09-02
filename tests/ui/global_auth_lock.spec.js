const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { activeHomeTokenConnection, installDashboardFixture } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const repoRoot = path.join(__dirname, '..', '..');
const recoveryLeaseKey = 'jira_dashboard_auth_recovery_lease_v1';
const recoverySuccessKey = 'jira_dashboard_auth_recovery_success_v1';
const recoveryAttemptKey = 'jira_dashboard_auth_recovery_attempt_v1';
const recoveryConsumedKey = 'jira_dashboard_auth_recovery_consumed_v1';
const authResumeKey = 'jira_dashboard_auth_resume_v1';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const groupId = 'group-alpha';
const teamId = 'team-alpha';
let freshDashboardJs;

test.beforeAll(() => {
    freshDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

function json(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
}

function configPayload() {
    return {
        jiraUrl: 'https://jira.example',
        capacityProject: '',
        authMode: 'atlassian_oauth',
        projectsConfigured: true,
        userCanEditSettings: true,
        userCanEditEpmConfig: true,
        environmentConfigExists: true,
        viewConfig: {
            workspaceId: 'workspace-test',
            viewConfigId: 'view-test',
            version: 1,
            view: {
                selectedView: 'eng',
                selectedSprint: activeSprintId,
                sprintName: activeSprintName,
                activeGroupId: groupId,
                showPlanning: false,
                showScenario: false,
            },
        },
    };
}

function groupsPayload() {
    return {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: groupId,
        groups: [{
            id: groupId,
            name: 'Alpha Department',
            teamIds: [teamId],
            labels: ['alpha_label'],
            excludedCapacityEpics: [],
        }],
        preferences: {
            onboardingRequired: false,
            onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            customized: true,
            visibleGroupIds: [groupId],
            effectiveVisibleGroupIds: [groupId],
            activeGroupId: groupId,
        },
    };
}

function planningStories() {
    return ['PLAN-1', 'PLAN-2', 'PLAN-3'].map((key, index) => ({
        id: key,
        key,
        fields: {
            summary: `${key} synthetic planning story`,
            status: { name: ['To Do', 'Pending', 'Accepted'][index] },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            customfield_10004: 1,
            epicKey: 'PLAN-EPIC',
            parentSummary: 'Synthetic planning epic',
            projectKey: 'PLAN',
            teamId,
            teamName: 'Alpha Team',
            sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
        },
    }));
}

function planningEpic() {
    return {
        key: 'PLAN-EPIC',
        summary: 'Synthetic planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId,
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
    };
}

async function installFreshDashboard(page) {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: freshDashboardJs,
    }));
}

function observeDocuments(page) {
    const documents = [];
    page.on('request', request => {
        if (request.resourceType() !== 'document') return;
        documents.push(new URL(request.url()).pathname);
    });
    return documents;
}

async function installPlanningRecoveryPage(page, label, shared) {
    const state = {
        label,
        documents: observeDocuments(page),
        authTriggerRequestIds: [],
        oauthRequests: 0,
        authStatusCookies: [],
        armAuth401: false,
        heldHydration: false,
    };
    shared.pages[label] = state;
    await installFreshDashboard(page);
    await page.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, options = {}) => {
            const requestUrl = input instanceof Request ? input.url : String(input);
            if (
                window.__authTriggerRequestId
                && new URL(requestUrl, window.location.href).pathname === '/api/analytics/context'
            ) {
                const headers = new Headers(input instanceof Request ? input.headers : undefined);
                new Headers(options.headers || {}).forEach((value, name) => headers.set(name, value));
                headers.set('X-JEP-Test-Request-Id', window.__authTriggerRequestId);
                return nativeFetch(input, { ...options, headers });
            }
            return nativeFetch(input, options);
        };
    });
    await page.route('**/api/config**', route => {
        const cookie = route.request().headers().cookie || '';
        if (shared.authenticated && !cookie.includes('jep_auth=shared')) {
            return json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
        }
        return json(route, configPayload());
    });
    await page.route('**/api/groups-config', route => json(route, groupsPayload()));
    await page.route('**/api/sprints**', route => json(route, {
        sprints: [
            { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
            { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
        ],
    }));
    await page.route('**/api/tasks-with-team-name**', async route => {
        const url = new URL(route.request().url());
        const isFutureProductHydration = url.searchParams.get('project') === 'product'
            && !url.searchParams.get('purpose')
            && url.searchParams.get('sprint') === String(futureSprintId);
        if (
            shared.authenticated
            && shared.leaderLabel === label
            && isFutureProductHydration
            && !state.heldHydration
        ) {
            state.heldHydration = true;
            shared.leaderHydrationStarted.resolve();
            await shared.releaseLeaderHydration.promise;
        }
        const epic = planningEpic();
        return json(route, {
            issues: url.searchParams.get('project') === 'product' ? planningStories() : [],
            epics: { [epic.key]: epic },
            epicsInScope: url.searchParams.get('project') === 'product' ? [epic] : [],
            names: {},
        });
    });
    await page.route('**/api/analytics/context', route => {
        const requestId = route.request().headers()['x-jep-test-request-id'];
        if (requestId) state.authTriggerRequestIds.push(requestId);
        if (state.armAuth401) {
            state.armAuth401 = false;
            return json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
        }
        return json(route, { enabled: false });
    });
    await page.route('**/api/auth/status', route => {
        const cookie = route.request().headers().cookie || '';
        state.authStatusCookies.push(cookie);
        return json(route, {
            authMode: 'atlassian_oauth',
            authenticated: cookie.includes('jep_auth=shared'),
            email: 'profile@example.test',
            profile: { email: 'profile@example.test' },
        });
    });
    await page.route('**/login?reason=session_expired', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Sign in</title><a href="/api/auth/atlassian/login">Sign in with Atlassian</a>',
    }));
    await page.route('**/api/auth/atlassian/login', route => {
        state.oauthRequests += 1;
        shared.oauthRequests += 1;
        return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>Atlassian authorization</title>',
        });
    });
    await page.route(/\/api\/auth\/atlassian\/callback(?:\?.*)?$/, route => route.fulfill({
        status: 302,
        headers: { location: '/' },
        body: '',
    }));
    return state;
}

async function openFuturePlanning(page) {
    const sprintDropdown = page.locator('.sprint-dropdown').first();
    await sprintDropdown.locator('.sprint-dropdown-toggle').click();
    await sprintDropdown.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.task-item[data-task-key="PLAN-1"]')).toBeVisible();
}

function storyCheckbox(page, key) {
    return page.locator(`.task-item[data-task-key="${key}"] input.task-checkbox`);
}

async function triggerAuth401(page, state) {
    state.armAuth401 = true;
    await page.evaluate((label) => {
        window.__oldDocumentMarker = label;
        window.__authTriggerRequestId = `auth-trigger-${label}`;
        return window.JepAnalytics.refreshAnalyticsContext().catch(() => null);
    }, state.label);
    await expect(page.getByRole('alertdialog')).toBeVisible();
}

test('bootstrap 401 locks the mounted app behind one accessible sanitized recovery gate', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    let analyticsContextCalls = 0;
    let configCalls = 0;
    await page.route('**/api/analytics/context', async route => {
        analyticsContextCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ enabled: true, gtmContainerId: 'GTM-TEST' }),
        });
    });
    await page.route('**/api/config**', route => {
        configCalls += 1;
        return route.fulfill({ status: 401, contentType: 'text/plain', body: 'expired' });
    });
    await page.route('**/login?reason=session_expired', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<title>Sign in</title><h1>Sign in</h1>',
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    const gate = page.getByRole('alertdialog');
    await expect(gate).toBeVisible();
    await expect(page.getByText(/401/)).toHaveCount(0);
    const action = gate.getByRole('link', { name: 'Sign in again' });
    await expect(action).toBeFocused();
    await expect(action).toHaveAttribute('href', '/login?reason=session_expired');
    await expect(action).not.toHaveAttribute('target', /.+/);
    await expect(page.locator('#root > div[aria-hidden="true"]')).toHaveCount(1);
    expect(analyticsContextCalls).toBe(0);
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'app_error_shown' && entry?.error_code === 'auth_required'
    )))).toEqual([]);
    const blockedKeys = await page.evaluate(() => {
        let count = 0;
        document.addEventListener('keydown', () => { count += 1; });
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return count;
    });
    expect(blockedKeys).toBe(0);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login\?reason=session_expired$/);
    expect(page.context().pages()).toEqual([page]);
    expect(configCalls).toBe(1);
});

test('parallel 401 failures keep the first safe target and do not stack dialogs', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/config**', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: '/login?reason=missing_scope' }),
    }));
    await page.route('**/api/groups-config', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: 'https://evil.example/login' }),
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('alertdialog')).toHaveCount(1);
    await expect(page.getByRole('alertdialog').getByRole('link')).toHaveAttribute('href', '/login?reason=missing_scope');
});

test('Home connection prerequisites retain targeted semantics without locking', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'epm' }));
    });
    await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        epmPrerequisite: true,
    });
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'EPM' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const settings = page.getByRole('dialog').first();
    await settings.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(settings.getByText('Not connected')).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
});

test('admin_required and csrf_required remain non-terminal application errors', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    for (const error of ['admin_required', 'csrf_required']) {
        await page.unroute('**/api/analytics/context');
        await page.route('**/api/analytics/context', route => route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error }),
        }));
        await page.evaluate(() => window.JepAnalytics.refreshAnalyticsContext());
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
    }
});

test('a latch published between render and external-store subscription is not missed', async ({ page }) => {
    await page.addInitScript(() => {
        const addEventListener = window.addEventListener.bind(window);
        let published = false;
        window.addEventListener = (type, listener, options) => {
            if (type === 'jep:authentication-required' && !published) {
                published = true;
                window.__JEP_AUTH_REQUIRED__ = Object.freeze({
                    locked: true,
                    loginUrl: '/login?reason=missing_scope',
                    reason: 'missing_scope',
                });
            }
            return addEventListener(type, listener, options);
        };
    });
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog').getByRole('link')).toHaveAttribute('href', '/login?reason=missing_scope');
});

test('focus refresh 401 before dashboard bootstrap is visible to the later root gate without redirect', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/auth/refresh', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: '//evil.example/login' }),
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog').getByRole('link')).toHaveAttribute('href', '/login?reason=session_expired');
    expect(new URL(page.url()).pathname).toBe('/');
});

test('an initialized enabled analytics session emits one privacy-safe auth lock event', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            enabled: true,
            gtmContainerId: 'GTM-TEST',
            ga4UserId: 'pseudonymous-user',
            debugMode: true,
        }),
    }));
    await page.route('https://www.googletagmanager.com/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.JepAnalytics))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).some(entry => entry?.event_name === 'page_view'))).toBe(true);

    await page.unroute('**/api/analytics/context');
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }),
    }));
    await page.evaluate(() => window.JepAnalytics.refreshAnalyticsContext().catch(() => {}));
    await expect(page.getByRole('alertdialog')).toBeVisible();

    const events = await page.evaluate(() => (window.dataLayer || []).filter(entry => (
        entry?.event_name === 'app_error_shown' && entry?.error_code === 'auth_required'
    )));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
        event: 'userevent',
        trigger: 'userevent',
        event_type: 'event',
        event_name: 'app_error_shown',
        feature_name: 'auth',
        error_area: 'auth',
        error_code: 'auth_required',
        recoverable_state: 'reauth',
        source_surface: 'app',
    });
    expect(JSON.stringify(events[0])).not.toMatch(/https?:|@|token|workspace|response|config/i);
});

test('an initialized disabled analytics session emits no auth event', async ({ page }) => {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: false }),
    }));
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.JepAnalytics))).toBe(true);
    await page.route('**/api/epm/projects**', route => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required' }),
    }));
    await page.getByRole('radio', { name: 'EPM', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await page.evaluate(() => (window.dataLayer || []).filter(entry => entry?.error_code === 'auth_required'))).toEqual([]);
});

test('same-profile Planning tabs elect one OAuth leader and reload independently from the shared cookie', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const shared = {
        authenticated: false,
        leaderLabel: '',
        oauthRequests: 0,
        pages: {},
        leaderHydrationStarted: deferred(),
        releaseLeaderHydration: deferred(),
    };
    const stateA = await installPlanningRecoveryPage(pageA, 'A', shared);
    const stateB = await installPlanningRecoveryPage(pageB, 'B', shared);

    await Promise.all([
        pageA.goto(appBaseUrl, { waitUntil: 'domcontentloaded' }),
        pageB.goto(appBaseUrl, { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([openFuturePlanning(pageA), openFuturePlanning(pageB)]);
    await storyCheckbox(pageA, 'PLAN-2').click();
    await storyCheckbox(pageB, 'PLAN-1').click();

    await Promise.all([
        triggerAuth401(pageA, stateA),
        triggerAuth401(pageB, stateB),
    ]);
    const [capsuleA, capsuleB] = await Promise.all([
        pageA.evaluate(key => sessionStorage.getItem(key), authResumeKey),
        pageB.evaluate(key => sessionStorage.getItem(key), authResumeKey),
    ]);
    expect(capsuleA).not.toBeNull();
    expect(capsuleB).not.toBeNull();
    expect(capsuleA).not.toEqual(capsuleB);

    await Promise.all([
        pageA.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' }).click(),
        pageB.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' }).click(),
    ]);
    await expect.poll(() => [pageA, pageB].filter(page => (
        new URL(page.url()).pathname === '/login'
    )).length).toBe(1);

    const leader = new URL(pageA.url()).pathname === '/login' ? pageA : pageB;
    const follower = leader === pageA ? pageB : pageA;
    const leaderState = leader === pageA ? stateA : stateB;
    const followerState = follower === pageA ? stateA : stateB;
    shared.leaderLabel = leaderState.label;
    expect(stateA.documents.filter(pathname => pathname === '/login')).toHaveLength(leader === pageA ? 1 : 0);
    expect(stateB.documents.filter(pathname => pathname === '/login')).toHaveLength(leader === pageB ? 1 : 0);

    const liveLease = JSON.parse(await follower.evaluate(key => localStorage.getItem(key), recoveryLeaseKey));
    expect(Object.keys(liveLease).sort()).toEqual(['attemptId', 'startedAt']);
    const leaderAttempt = JSON.parse(await leader.evaluate(key => sessionStorage.getItem(key), recoveryAttemptKey));
    expect(leaderAttempt.attemptId).toBe(liveLease.attemptId);
    await expect(follower.getByText('Sign-in is continuing in another tab. This tab will resume automatically.')).toBeVisible();

    await leader.getByRole('link', { name: 'Sign in with Atlassian' }).click();
    expect(shared.oauthRequests).toBe(1);
    expect(leaderState.oauthRequests).toBe(1);
    expect(followerState.oauthRequests).toBe(0);

    await context.addCookies([{ name: 'jep_auth', value: 'shared', url: appBaseUrl }]);
    shared.authenticated = true;
    await leader.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await shared.leaderHydrationStarted.promise;

    await expect.poll(() => followerState.documents.filter(pathname => pathname === '/').length).toBe(2);
    await expect.poll(async () => {
        try {
            return await follower.evaluate(() => window.__oldDocumentMarker);
        } catch (error) {
            if (/Execution context was destroyed/.test(error.message)) return 'navigating';
            throw error;
        }
    }).toBeUndefined();
    expect(leaderState.heldHydration).toBe(true);
    expect(await leader.evaluate(key => localStorage.getItem(key), recoveryLeaseKey)).toBeNull();
    const publishedSuccess = JSON.parse(await follower.evaluate(key => localStorage.getItem(key), recoverySuccessKey));
    expect(publishedSuccess.attemptId).toBe(liveLease.attemptId);

    await expect(storyCheckbox(follower, follower === pageA ? 'PLAN-1' : 'PLAN-2')).toBeChecked();
    await expect(storyCheckbox(follower, follower === pageA ? 'PLAN-2' : 'PLAN-1')).not.toBeChecked();
    expect(shared.oauthRequests).toBe(1);

    shared.releaseLeaderHydration.resolve();
    await expect(storyCheckbox(pageA, 'PLAN-1')).toBeChecked();
    await expect(storyCheckbox(pageA, 'PLAN-2')).not.toBeChecked();
    await expect(storyCheckbox(pageA, 'PLAN-3')).toBeChecked();
    await expect(storyCheckbox(pageB, 'PLAN-1')).not.toBeChecked();
    await expect(storyCheckbox(pageB, 'PLAN-2')).toBeChecked();
    await expect(storyCheckbox(pageB, 'PLAN-3')).toBeChecked();

    await follower.getByRole('button', { name: 'Manage team groups' }).click();
    const settings = follower.getByRole('dialog').first();
    await settings.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect.poll(() => followerState.authStatusCookies.length).toBeGreaterThan(0);
    expect(followerState.authStatusCookies.at(-1)).toContain('jep_auth=shared');

    expect(stateA.authTriggerRequestIds).toEqual(['auth-trigger-A']);
    expect(stateB.authTriggerRequestIds).toEqual(['auth-trigger-B']);
    expect(shared.oauthRequests).toBe(1);
    expect(stateA.documents.filter(pathname => pathname === '/')).toHaveLength(2);
    expect(stateB.documents.filter(pathname => pathname === '/')).toHaveLength(2);
    expect(await pageA.evaluate(() => window.__oldDocumentMarker)).toBeUndefined();
    expect(await pageB.evaluate(() => window.__oldDocumentMarker)).toBeUndefined();
    expect(await pageA.evaluate(key => sessionStorage.getItem(key), recoveryConsumedKey)).toBe(liveLease.attemptId);
    expect(await pageB.evaluate(key => sessionStorage.getItem(key), recoveryConsumedKey)).toBe(liveLease.attemptId);
    await expect.poll(() => pageA.evaluate(key => sessionStorage.getItem(key), authResumeKey)).toBeNull();
    await expect.poll(() => pageB.evaluate(key => sessionStorage.getItem(key), authResumeKey)).toBeNull();
});

test('a bootstrap 401 queued ahead of completion cannot publish false recovery success', async ({ context }) => {
    const leader = await context.newPage();
    const follower = await context.newPage();
    const completionQueued = deferred();
    const leaderDocuments = observeDocuments(leader);
    const followerDocuments = observeDocuments(follower);
    const attemptId = 'attempt-bootstrap-race';
    const capturedAt = Date.now();
    const capsule = JSON.stringify({
        version: 1,
        capturedAt,
        principal: { workspaceId: 'workspace-test', viewConfigId: 'view-test' },
        view: {
            selectedView: 'eng',
            activeGroupId: groupId,
            selectedSprint: String(futureSprintId),
            engMode: 'planning',
            settingsOpen: false,
            settingsTab: 'teams',
        },
        planning: {
            scopeKey: `planning::${futureSprintId}::${groupId}`,
            selectedTaskKeys: ['PLAN-2'],
            selectedTeams: [teamId],
            selectionMode: 'manual',
        },
    });

    await leader.exposeFunction('__notifyAuthCompletionQueued', () => completionQueued.resolve());
    await leader.addInitScript(({
        attemptId,
        authResumeKey,
        capsule,
        capturedAt,
        recoveryAttemptKey,
        recoveryLeaseKey,
    }) => {
        localStorage.setItem(recoveryLeaseKey, JSON.stringify({ attemptId, startedAt: capturedAt }));
        sessionStorage.setItem(recoveryAttemptKey, JSON.stringify({ attemptId, startedAt: capturedAt }));
        sessionStorage.setItem(authResumeKey, capsule);
        window.__leaderOldDocumentMarker = true;

        const lockName = 'jira-dashboard-auth-recovery-v1';
        const nativeRequest = navigator.locks.request.bind(navigator.locks);
        let releaseHeldLock;
        const held = new Promise(resolve => { releaseHeldLock = resolve; });
        window.__releaseAuthCompletionLock = releaseHeldLock;
        void nativeRequest(lockName, { mode: 'exclusive' }, () => held);
        Object.defineProperty(navigator.locks, 'request', {
            configurable: true,
            value: (name, options, callback) => {
                if (name === lockName) void window.__notifyAuthCompletionQueued();
                return nativeRequest(name, options, callback);
            },
        });
    }, {
        attemptId,
        authResumeKey,
        capsule,
        capturedAt,
        recoveryAttemptKey,
        recoveryLeaseKey,
    });
    await installFreshDashboard(leader);
    let configCalls = 0;
    let group401Calls = 0;
    await leader.route('**/api/config**', route => {
        configCalls += 1;
        return json(route, configPayload());
    });
    await leader.route('**/api/groups-config', async route => {
        await completionQueued.promise;
        group401Calls += 1;
        return json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
    });

    await leader.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await completionQueued.promise;
    await expect(leader.getByRole('alertdialog')).toBeVisible();
    expect(configCalls).toBe(1);
    expect(group401Calls).toBe(1);
    expect(await leader.evaluate(key => sessionStorage.getItem(key), authResumeKey)).toBe(capsule);

    await follower.addInitScript(() => {
        window.__JEP_AUTH_REQUIRED__ = Object.freeze({
            locked: true,
            loginUrl: '/login?reason=session_expired',
            reason: 'session_expired',
            requestStartedAt: Date.now() - 10,
            lockedAt: Date.now() - 5,
        });
        window.__followerOldDocumentMarker = true;
    });
    await installFreshDashboard(follower);
    await follower.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect(follower.getByRole('alertdialog')).toBeVisible();
    expect(followerDocuments.filter(pathname => pathname === '/')).toHaveLength(1);

    await leader.evaluate(async () => {
        window.__releaseAuthCompletionLock();
        await navigator.locks.request('jira-dashboard-auth-recovery-v1', { mode: 'exclusive' }, () => undefined);
    });
    await follower.waitForTimeout(250);

    expect(await leader.evaluate(key => localStorage.getItem(key), recoverySuccessKey)).toBeNull();
    expect(await leader.evaluate(key => sessionStorage.getItem(key), authResumeKey)).toBe(capsule);
    expect(await leader.evaluate(() => window.__leaderOldDocumentMarker)).toBe(true);
    await expect(leader.getByRole('alertdialog')).toBeVisible();
    expect(leaderDocuments.filter(pathname => pathname === '/')).toHaveLength(1);
    expect(followerDocuments.filter(pathname => pathname === '/')).toHaveLength(1);
    expect(await follower.evaluate(() => window.__followerOldDocumentMarker)).toBe(true);
});

async function installPrelockedRecovery(page, mode) {
    await page.addInitScript(({ mode, recoverySuccessKey }) => {
        const seedKey = `auth_recovery_${mode}_seeded`;
        const firstDocument = !window.sessionStorage.getItem(seedKey);
        if (firstDocument) {
            window.sessionStorage.setItem(seedKey, 'true');
            const now = Date.now();
            window.__JEP_AUTH_REQUIRED__ = Object.freeze({
                locked: true,
                loginUrl: '/login?reason=session_expired',
                reason: 'session_expired',
                requestStartedAt: now - 10,
                lockedAt: now - 5,
            });
            window.__oldDocumentMarker = mode;
            if (mode === 'success-before-effect') {
                window.localStorage.setItem(recoverySuccessKey, JSON.stringify({
                    attemptId: 'attempt-before-effect',
                    completedAt: now,
                }));
            }
        }
        if (mode === 'success-after-listener') {
            const nativeAdd = window.addEventListener.bind(window);
            window.addEventListener = (type, listener, options) => {
                const result = nativeAdd(type, listener, options);
                if (type === 'storage'
                    && firstDocument
                    && !window.__successInjectedAfterListener) {
                    window.__successInjectedAfterListener = true;
                    const value = JSON.stringify({
                        attemptId: 'attempt-after-listener',
                        completedAt: Date.now(),
                    });
                    window.localStorage.setItem(recoverySuccessKey, value);
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: recoverySuccessKey,
                        newValue: value,
                        storageArea: window.localStorage,
                    }));
                }
                return result;
            };
        }
    }, { mode, recoverySuccessKey });
    const documents = observeDocuments(page);
    let oauthRequests = 0;
    await installFreshDashboard(page);
    await page.route('**/api/auth/atlassian/login', route => {
        oauthRequests += 1;
        return route.fulfill({ status: 204, body: '' });
    });
    return { documents, getOauthRequests: () => oauthRequests };
}

async function assertPrelockedRecovery(page, mode, attemptId) {
    const state = await installPrelockedRecovery(page, mode);
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => state.documents.filter(pathname => pathname === '/').length).toBe(2);
    await expect.poll(async () => {
        try { return await page.evaluate(() => window.__oldDocumentMarker); } catch (error) { return 'navigating'; }
    }).toBeUndefined();
    expect(await page.evaluate(key => sessionStorage.getItem(key), recoveryConsumedKey)).toBe(attemptId);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(state.getOauthRequests()).toBe(0);
    await page.waitForTimeout(150);
    expect(state.documents.filter(pathname => pathname === '/')).toHaveLength(2);
}

test('a success marker present before the locked effect installs resumes exactly once', async ({ page }) => {
    await assertPrelockedRecovery(page, 'success-before-effect', 'attempt-before-effect');
});

test('a success written immediately after listener installation resumes exactly once', async ({ page }) => {
    await assertPrelockedRecovery(page, 'success-after-listener', 'attempt-after-listener');
});

test('a delayed 401 consumes success completed after that request started', async ({ page }) => {
    const requestStarted = deferred();
    const release401 = deferred();
    const documents = observeDocuments(page);
    let arm401 = false;
    let auth401Calls = 0;
    let oauthRequests = 0;
    await installFreshDashboard(page);
    await page.route('**/api/analytics/context', async route => {
        if (!arm401) return json(route, { enabled: false });
        arm401 = false;
        auth401Calls += 1;
        requestStarted.resolve();
        await release401.promise;
        return json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
    });
    await page.route('**/api/auth/atlassian/login', route => {
        oauthRequests += 1;
        return route.fulfill({ status: 204, body: '' });
    });
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.JepAnalytics))).toBe(true);

    arm401 = true;
    const refresh = page.evaluate(() => {
        window.__oldDocumentMarker = 'delayed-401';
        return window.JepAnalytics.refreshAnalyticsContext().catch(() => null);
    }).catch(error => {
        if (/Execution context was destroyed/.test(error.message)) return null;
        throw error;
    });
    await requestStarted.promise;
    await page.evaluate(key => {
        localStorage.setItem(key, JSON.stringify({
            attemptId: 'attempt-delayed-401',
            completedAt: Date.now(),
        }));
    }, recoverySuccessKey);
    release401.resolve();
    await refresh;

    await expect.poll(() => documents.filter(pathname => pathname === '/').length).toBe(2);
    expect(await page.evaluate(key => sessionStorage.getItem(key), recoveryConsumedKey)).toBe('attempt-delayed-401');
    expect(await page.evaluate(() => window.__oldDocumentMarker)).toBeUndefined();
    expect(auth401Calls).toBe(1);
    expect(oauthRequests).toBe(0);
    await page.waitForTimeout(150);
    expect(documents.filter(pathname => pathname === '/')).toHaveLength(2);
});

test('a genuinely newer failed request does not consume an earlier success marker', async ({ page }) => {
    const documents = observeDocuments(page);
    let arm401 = false;
    let auth401Calls = 0;
    await installFreshDashboard(page);
    await page.route('**/api/analytics/context', route => {
        if (!arm401) return json(route, { enabled: false });
        arm401 = false;
        auth401Calls += 1;
        return json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
    });
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(key => {
        localStorage.setItem(key, JSON.stringify({
            attemptId: 'attempt-stale',
            completedAt: Date.now() - 1_000,
        }));
        window.__oldDocumentMarker = 'stale-success';
    }, recoverySuccessKey);

    arm401 = true;
    await page.evaluate(() => window.JepAnalytics.refreshAnalyticsContext().catch(() => null));

    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toBeVisible();
    expect(documents.filter(pathname => pathname === '/')).toHaveLength(1);
    expect(await page.evaluate(key => sessionStorage.getItem(key), recoveryConsumedKey)).toBeNull();
    expect(await page.evaluate(() => window.__oldDocumentMarker)).toBe('stale-success');
    expect(auth401Calls).toBe(1);
});

async function installBootstrapLockedPage(page, label, shared) {
    const state = {
        label,
        documents: observeDocuments(page),
        oauthRequests: 0,
    };
    await installFreshDashboard(page);
    await page.route('**/api/config**', route => {
        if (!shared.authenticated) {
            return json(route, { error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
        }
        return json(route, configPayload());
    });
    await page.route('**/login?reason=session_expired', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Sign in</title><a href="/api/auth/atlassian/login">Sign in with Atlassian</a>',
    }));
    await page.route('**/api/auth/atlassian/login', route => {
        state.oauthRequests += 1;
        shared.oauthRequests += 1;
        return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>Atlassian authorization</title>',
        });
    });
    await page.route(/\/api\/auth\/atlassian\/callback(?:\?.*)?$/, route => route.fulfill({
        status: 302,
        headers: { location: '/' },
        body: '',
    }));
    return state;
}

test('a queued claim reconciles success once after its pending Web Lock settles', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const shared = { authenticated: false, oauthRequests: 0 };
    const stateA = await installBootstrapLockedPage(pageA, 'A', shared);
    const stateB = await installBootstrapLockedPage(pageB, 'B', shared);
    await Promise.all([
        pageA.goto(appBaseUrl, { waitUntil: 'domcontentloaded' }),
        pageB.goto(appBaseUrl, { waitUntil: 'domcontentloaded' }),
    ]);
    await expect(pageA.getByRole('alertdialog')).toBeVisible();
    await expect(pageB.getByRole('alertdialog')).toBeVisible();
    await pageA.evaluate(() => { window.__oldDocumentMarker = 'pending-leader'; });
    await pageB.evaluate(() => { window.__oldDocumentMarker = 'pending-follower'; });
    await pageB.evaluate(() => {
        const nativeRequest = navigator.locks.request.bind(navigator.locks);
        let releaseQueuedClaim;
        const queuedClaim = new Promise(resolve => { releaseQueuedClaim = resolve; });
        let holdNextRequest = true;
        Object.defineProperty(navigator.locks, 'request', {
            configurable: true,
            value: (...args) => {
                if (!holdNextRequest) return nativeRequest(...args);
                holdNextRequest = false;
                return queuedClaim.then(() => nativeRequest(...args));
            },
        });
        window.__releaseQueuedAuthClaim = releaseQueuedClaim;
    });

    await pageA.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' }).click();
    await expect(pageA).toHaveURL(/\/login\?reason=session_expired$/);
    await pageB.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' }).click();
    await expect(pageB.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toHaveAttribute('aria-disabled', 'true');

    await pageA.getByRole('link', { name: 'Sign in with Atlassian' }).click();
    expect(shared.oauthRequests).toBe(1);
    await context.addCookies([{ name: 'jep_auth', value: 'shared', url: appBaseUrl }]);
    shared.authenticated = true;
    await pageA.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => pageA.evaluate(key => localStorage.getItem(key), recoverySuccessKey)).not.toBeNull();
    expect(await pageB.evaluate(() => window.__oldDocumentMarker)).toBe('pending-follower');
    expect(stateB.documents.filter(pathname => pathname === '/')).toHaveLength(1);

    await pageB.evaluate(() => window.__releaseQueuedAuthClaim());
    await expect.poll(() => stateB.documents.filter(pathname => pathname === '/').length).toBe(2);
    await expect.poll(() => pageB.evaluate(() => window.__oldDocumentMarker)).toBeUndefined();
    expect(stateB.documents.filter(pathname => pathname === '/login')).toHaveLength(0);
    expect(stateB.oauthRequests).toBe(0);
    expect(await pageB.evaluate(key => sessionStorage.getItem(key), recoveryConsumedKey)).not.toBeNull();
    await pageB.waitForTimeout(150);
    expect(stateB.documents.filter(pathname => pathname === '/')).toHaveLength(2);
    expect(stateA.oauthRequests).toBe(1);
});

test('blocked storage getters preserve the gate and use sanitized same-tab recovery', async ({ page, context }) => {
    const pageErrors = [];
    const documents = observeDocuments(page);
    let authenticated = false;
    let configCalls = 0;
    let analyticsCalls = 0;
    let armAuth401 = false;
    const blockNextStorageReads = () => page.evaluate(() => {
        const values = {};
        for (const property of ['localStorage', 'sessionStorage']) {
            const value = window[property];
            values[property] = value;
            Object.defineProperty(window, property, {
                configurable: true,
                get() {
                    Object.defineProperty(window, property, { configurable: true, value });
                    throw new DOMException('blocked', 'SecurityError');
                },
            });
        }
        window.__restoreBlockedStorage = () => {
            for (const [property, value] of Object.entries(values)) {
                Object.defineProperty(window, property, { configurable: true, value });
            }
        };
    });
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));
    await installFreshDashboard(page);
    await page.route('**/api/config**', async route => {
        configCalls += 1;
        if (authenticated) await blockNextStorageReads();
        return json(route, { ...configPayload(), authMode: 'basic' });
    });
    await page.route('**/api/analytics/context', route => {
        analyticsCalls += 1;
        if (!armAuth401) return json(route, { enabled: false });
        armAuth401 = false;
        return json(route, { error: 'auth_required', loginUrl: 'https://evil.example.test/login' }, 401);
    });
    await page.route('**/login?reason=session_expired', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Sign in</title><a href="/api/auth/atlassian/login">Sign in with Atlassian</a>',
    }));
    await page.route('**/api/auth/atlassian/login', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Atlassian authorization</title>',
    }));
    await page.route(/\/api\/auth\/atlassian\/callback(?:\?.*)?$/, route => route.fulfill({
        status: 302,
        headers: { location: '/' },
        body: '',
    }));

    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Manage team groups' })).toBeVisible();
    await expect.poll(() => analyticsCalls).toBeGreaterThan(0);
    await blockNextStorageReads();
    armAuth401 = true;
    await page.evaluate(() => window.JepAnalytics.refreshAnalyticsContext().catch(() => null));
    await expect.poll(() => page.evaluate(() => window.__JEP_AUTH_REQUIRED__?.locked)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
        window.__restoreBlockedStorage();
        resolve();
    })));
    expect(pageErrors).toEqual([]);
    const gate = page.getByRole('alertdialog');
    await expect(gate).toBeVisible();
    expect(await page.evaluate(key => sessionStorage.getItem(key), authResumeKey)).toBeNull();
    await blockNextStorageReads();
    const action = gate.getByRole('link', { name: 'Sign in again' });
    await expect(action).toHaveAttribute('href', '/login?reason=session_expired');
    await action.click();
    await expect(page).toHaveURL(/\/login\?reason=session_expired$/);
    expect(context.pages()).toEqual([page]);

    await page.getByRole('link', { name: 'Sign in with Atlassian' }).click();
    await context.addCookies([{ name: 'jep_auth', value: 'shared', url: appBaseUrl }]);
    authenticated = true;
    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Manage team groups' })).toBeVisible();
    expect(configCalls).toBe(2);
    expect(documents.filter(pathname => pathname === '/')).toHaveLength(2);
    expect(pageErrors).toEqual([]);
});
