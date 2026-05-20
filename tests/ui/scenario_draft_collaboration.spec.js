const { test, expect } = require('@playwright/test');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(repoRoot, 'frontend', 'dist', 'dashboard.css'), 'utf8');
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';

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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

function scenarioPayload() {
    return {
        jira_base_url: 'https://jira.example',
        config: {
            start_date: '2026-04-01',
            quarter_end_date: '2026-06-30',
        },
        sprintBoundaries: {
            previous: { startDate: '2026-03-18' },
            selected: { startDate: '2026-04-01', endDate: '2026-04-15' },
            next: { endDate: '2026-04-29' },
        },
        summary: {
            late_items: [],
            critical_path: [],
            unschedulable: [],
            bottleneck_lanes: [],
        },
        dependencies: [],
        capacity_by_team: {
            'Scenario Team 1': { size: 4, devLead: 'Alpha Lead' },
        },
        issues: [{
            key: 'PROD-1',
            summary: 'Build product scenario path',
            epicKey: 'PROD-EPIC',
            epicSummary: 'Product delivery epic',
            team: 'Scenario Team 1',
            assignee: 'Alpha Owner',
            sp: 3,
            start: '2026-04-06',
            end: '2026-04-09',
        }],
    };
}

async function installDashboard(page, options = {}) {
    const currentUserEmail = options.currentUserEmail || 'profile@example.com';
    const currentUserId = options.currentUserId || currentUserEmail;
    const calls = {
        csrf: [],
        events: [],
        deferredEvents: [],
        deferredDrafts: [],
        deferredVersions: [],
        reloadFromJira: [],
        deferredReloadFromJira: [],
        rollback: [],
        deferredRollback: [],
        writebackPreview: [],
        deferredWritebackPreview: [],
        writeback: [],
        deferredWriteback: [],
        presence: [],
        locks: [],
        streams: [],
        unexpected: [],
    };
    let csrfCount = 0;
    const draftGetCounts = new Map();
    const eventQueues = new Map(Object.entries(options.eventQueues || {}));
    const draftIdByScope = {
        [`${selectedSprintId}:grp-default`]: 'draft-default',
        [`${selectedSprintId}:grp-alt`]: 'draft-alt',
    };

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
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));

    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();

        if (url.pathname === '/api/scenario/overrides') {
            calls.unexpected.push(`${method} ${url.pathname}`);
            return json(route, { error: 'legacy overrides route must not be called' }, 500);
        }
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json(route, {
                authMode: 'atlassian_oauth',
                authenticated: true,
                loginRequired: false,
                siteUrl: 'https://jira.example',
            });
        }
        if (url.pathname === '/api/auth/csrf') {
            csrfCount += 1;
            calls.csrf.push(csrfCount);
            return json(route, { csrfToken: `csrf-token-${csrfCount}` });
        }
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                authMode: 'atlassian_oauth',
                settingsAdminOnly: false,
                userCanEditSettings: true,
                userCanEditEpmConfig: true,
                environmentConfigExists: true,
                projectsConfigured: true,
                epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} },
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json(route, {
                version: 1,
                groups: [
                    { id: 'grp-default', name: 'Default', teamIds: ['team-alpha'], teamLabels: { 'team-alpha': 'alpha_label' } },
                    { id: 'grp-alt', name: 'Alternate', teamIds: ['team-alpha'], teamLabels: { 'team-alpha': 'alpha_label' } },
                ],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '5494', boardName: 'Synthetic Board', source: 'test' });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/capacity/config') return json(route, { project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json(route, { fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json(route, { issueTypes: ['Epic', 'Story'] });
        if (url.pathname === '/api/issue-types') return json(route, { issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') return json(route, { sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json(route, { issues: [], epics: {}, epicsInScope: [], names: {} });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/capacity') return json(route, { enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/me/connections/home-token') return json(route, { connected: false });
        if (url.pathname === '/api/scenario' && method === 'POST') return json(route, scenarioPayload());
        if (url.pathname === '/api/scenario/drafts' && method === 'GET') {
            const scopeKey = url.searchParams.get('scope_key') || `${selectedSprintId}:grp-default`;
            const draftId = draftIdByScope[scopeKey] || 'draft-default';
            const draftGetCount = (draftGetCounts.get(scopeKey) || 0) + 1;
            draftGetCounts.set(scopeKey, draftGetCount);
            if ((options.deferredDraftRefreshScopeKeys || []).includes(scopeKey) && draftGetCount > 1) {
                const pending = deferred();
                calls.deferredDrafts.push({ scopeKey, draftId, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload);
            }
            const includeRemoteVersion = options.remoteVersionOnHistoryRefresh && draftGetCount > 1;
            const activeDraft = includeRemoteVersion
                ? {
                    draftId,
                    name: 'Remote update',
                    versionNumber: 3,
                    draftRevision: 6,
                    overrides: { 'PROD-1': { start: '2026-04-12', end: '2026-04-15' } },
                    scopePayload: { groupId: scopeKey.endsWith('grp-alt') ? 'grp-alt' : 'grp-default', sprintId: String(selectedSprintId) },
                    updatedBy: 'Remote Editor',
                    updatedAt: '2026-05-19T10:45:00Z',
                }
                : {
                    draftId,
                    name: 'Current draft',
                    versionNumber: 2,
                    draftRevision: 5,
                    overrides: {},
                    scopePayload: { groupId: scopeKey.endsWith('grp-alt') ? 'grp-alt' : 'grp-default', sprintId: String(selectedSprintId) },
                    updatedBy: 'Remote Editor',
                    updatedAt: '2026-05-19T10:30:00Z',
                };
            const versions = includeRemoteVersion
                ? [
                    { draftId, versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0 },
                    { draftId, versionNumber: 3, draftRevision: 6, name: 'Remote update', overrideCount: 1, createdBy: 'Remote Editor', createdAt: '2026-05-19T10:45:00Z' },
                ]
                : [{ draftId, versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0 }];
            return json(route, {
                activeDraft,
                versions,
                storage: 'db',
            });
        }
        const versionMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/versions\/([^/]+)$/);
        if (versionMatch && method === 'GET') {
            const draftId = decodeURIComponent(versionMatch[1]);
            const versionNumber = Number(decodeURIComponent(versionMatch[2]) || 0);
            if ((options.deferredVersionDraftIds || []).includes(draftId)) {
                const pending = deferred();
                calls.deferredVersions.push({ draftId, versionNumber, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload);
            }
            return json(route, {
                draftId,
                versionNumber,
                draftRevision: 5,
                name: `Version ${versionNumber}`,
                overrides: versionNumber === 3
                    ? { 'PROD-1': { start: '2026-04-12', end: '2026-04-15' } }
                    : {},
                overrideCount: versionNumber === 3 ? 1 : 0,
                createdBy: 'Remote Editor',
                createdAt: '2026-05-19T10:30:00Z',
            });
        }
        const rollbackMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/rollback$/);
        if (rollbackMatch && method === 'POST') {
            const draftId = decodeURIComponent(rollbackMatch[1]);
            const body = requestBody(request);
            calls.rollback.push({ draftId, token: request.headers()['x-csrf-token'], body });
            if ((options.deferredRollbackDraftIds || []).includes(draftId)) {
                const pending = deferred();
                calls.deferredRollback.push({ draftId, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload);
            }
            return json(route, {
                activeDraft: {
                    draftId,
                    name: 'Rollback draft',
                    versionNumber: 3,
                    draftRevision: 6,
                    overrides: {},
                    scopePayload: { groupId: 'grp-default', sprintId: String(selectedSprintId) },
                    updatedBy: 'Local Planner',
                    updatedAt: '2026-05-19T11:00:00Z',
                },
                versions: [
                    { draftId, versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0 },
                    { draftId, versionNumber: 3, draftRevision: 6, name: 'Rollback draft', overrideCount: 0, createdBy: 'Local Planner', createdAt: '2026-05-19T11:00:00Z' },
                ],
                storage: 'db',
            });
        }
        const reloadFromJiraMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/reload-from-jira$/);
        if (reloadFromJiraMatch && method === 'POST') {
            const draftId = decodeURIComponent(reloadFromJiraMatch[1]);
            const body = requestBody(request);
            calls.reloadFromJira.push({ draftId, token: request.headers()['x-csrf-token'], body });
            if ((options.deferredReloadFromJiraDraftIds || []).includes(draftId)) {
                const pending = deferred();
                calls.deferredReloadFromJira.push({ draftId, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload);
            }
            if (options.reloadFromJiraConflict) {
                return json(route, {
                    error: 'scenario_draft_conflict',
                    message: 'The scenario draft changed before this write could be saved.',
                    conflict: {
                        reason: 'stale_base_draft_revision',
                        receivedBaseDraftRevision: body?.baseDraftRevision,
                        currentDraftRevision: 6,
                        currentVersionNumber: 3,
                    },
                    activeDraft: {
                        draftId,
                        name: 'Remote update',
                        versionNumber: 3,
                        draftRevision: 6,
                        overrides: { 'PROD-1': { start: '2026-04-12', end: '2026-04-15' } },
                        scopePayload: { groupId: 'grp-default', sprintId: String(selectedSprintId) },
                        updatedBy: 'Remote Editor',
                        updatedAt: '2026-05-19T10:45:00Z',
                    },
                    versions: [
                        { draftId, versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0 },
                        { draftId, versionNumber: 3, draftRevision: 6, name: 'Remote update', overrideCount: 1, createdBy: 'Remote Editor', createdAt: '2026-05-19T10:45:00Z' },
                    ],
                    storage: 'db',
                }, 409);
            }
            return json(route, {
                activeDraft: {
                    draftId,
                    name: 'Reloaded from Jira',
                    versionNumber: 3,
                    draftRevision: 6,
                    overrides: {},
                    scopePayload: { groupId: 'grp-default', sprintId: String(selectedSprintId) },
                    updatedBy: 'Local Planner',
                    updatedAt: '2026-05-19T11:00:00Z',
                },
                versions: [
                    { draftId, versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0 },
                    { draftId, versionNumber: 3, draftRevision: 6, name: 'Reloaded from Jira', source: 'reload_from_jira', overrideCount: 0, createdBy: 'Local Planner', createdAt: '2026-05-19T11:00:00Z' },
                ],
                storage: 'db',
            });
        }
        const writebackPreviewMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/writeback\/preview$/);
        if (writebackPreviewMatch && method === 'POST') {
            const draftId = decodeURIComponent(writebackPreviewMatch[1]);
            calls.writebackPreview.push({ draftId, token: request.headers()['x-csrf-token'], body: requestBody(request) });
            if ((options.deferredWritebackPreviewDraftIds || []).includes(draftId)) {
                const pending = deferred();
                calls.deferredWritebackPreview.push({ draftId, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload);
            }
            return json(route, {
                ok: true,
                dryRun: true,
                draftId,
                draftRevision: 5,
                changes: [],
            });
        }
        const writebackMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/writeback$/);
        if (writebackMatch && method === 'POST') {
            const draftId = decodeURIComponent(writebackMatch[1]);
            calls.writeback.push({ draftId, token: request.headers()['x-csrf-token'], body: requestBody(request) });
            if ((options.deferredWritebackDraftIds || []).includes(draftId)) {
                const pending = deferred();
                calls.deferredWriteback.push({ draftId, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload.body, payload.status || 200);
            }
            return json(route, {
                error: 'jira_writeback_gate_blocked',
                message: 'Scenario draft Jira write-back is blocked by the migration gate.',
            }, 403);
        }
        const eventsMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/events$/);
        if (eventsMatch && method === 'GET') {
            const draftId = decodeURIComponent(eventsMatch[1]);
            const since = Number(url.searchParams.get('since') || 0);
            calls.events.push({ draftId, since });
            if ((options.deferredEventDraftIds || []).includes(draftId)) {
                const pending = deferred();
                calls.deferredEvents.push({ draftId, since, resolve: pending.resolve, reject: pending.reject });
                const payload = await pending.promise;
                return json(route, payload);
            }
            const queue = eventQueues.get(draftId) || [];
            const events = queue.splice(0, queue.length);
            return json(route, {
                events,
                nextSince: events.length ? events[events.length - 1].eventNumber : since,
            });
        }
        const streamMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/events\/stream$/);
        if (streamMatch && method === 'GET') {
            calls.streams.push(decodeURIComponent(streamMatch[1]));
            return json(route, { error: 'sse disabled' }, 404);
        }
        const presenceMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/presence$/);
        if (presenceMatch && method === 'POST') {
            const body = requestBody(request);
            calls.presence.push({ draftId: decodeURIComponent(presenceMatch[1]), token: request.headers()['x-csrf-token'], body });
            if (options.presenceCsrfRetry && calls.presence.length === 1) {
                return json(route, { error: 'csrf_required', message: 'CSRF token required.' }, 403);
            }
            if (options.presenceCsrfAlwaysFail && calls.presence.length <= 2) {
                return json(route, { error: 'csrf_required', message: 'CSRF token required.' }, 403);
            }
            return json(route, {
                presence: { userId: currentUserId, displayName: currentUserEmail, mode: body?.mode || 'viewing', lastSeenAt: '2999-01-01T00:00:00Z' },
                event: { eventNumber: 10 + calls.presence.length, eventType: 'presence.updated', draftRevision: 5, payload: {} },
            });
        }
        const locksMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/locks$/);
        if (locksMatch && method === 'POST') {
            const body = requestBody(request);
            calls.locks.push({ draftId: decodeURIComponent(locksMatch[1]), token: request.headers()['x-csrf-token'], body });
            if (options.lockConflict && body?.action === 'acquire') {
                return json(route, {
                    error: 'scenario_draft_lock_held',
                    message: 'Scenario draft lock is held by another user.',
                    activeLock: {
                        resourceType: 'issue',
                        resourceId: body.resourceId,
                        holderDisplayName: 'Remote Editor',
                    },
                }, 409);
            }
            return json(route, {
                lock: {
                    resourceType: 'issue',
                    resourceId: body?.resourceId,
                    holderUserId: currentUserId,
                    holderDisplayName: currentUserEmail,
                    expiresAt: '2999-01-01T00:00:00Z',
                },
                event: { eventNumber: 20 + calls.locks.length, eventType: `lock.${body?.action || 'acquire'}`, draftRevision: 5, payload: {} },
            });
        }
        calls.unexpected.push(`${method} ${url.pathname}`);
        return json(route, { error: `Unexpected API request: ${method} ${url.pathname}` }, 500);
    });

    return calls;
}

async function openScenario(page) {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showScenario: true,
    });
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await page.getByRole('button', { name: 'Run Scenario' }).click();
    await expect(page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first()).toBeVisible();
}

async function dragScenarioBar(page) {
    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(bar).toHaveClass(/editable/);
    const box = await bar.boundingBox();
    expect(box, 'scenario bar bounds').toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
}

async function switchScenarioToAlternateGroup(page, calls) {
    await page.getByLabel('Select group').click();
    await page.locator('.group-dropdown-option', { hasText: 'Alternate' }).click();
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await page.getByRole('button', { name: 'Run Scenario', exact: true }).click();
    await expect.poll(() => calls.events.some(call => call.draftId === 'draft-alt')).toBe(true);
}

test('presence strip renders remote user and polling stops after scope switch', async ({ page }) => {
    const calls = await installDashboard(page, {
        eventQueues: {
            'draft-default': [
                {
                    eventNumber: 1,
                    eventType: 'presence.updated',
                    draftRevision: 5,
                    payload: {
                        presence: {
                            displayName: 'Remote Editor',
                            mode: 'editing',
                            cursorPayload: { issueKey: 'PROD-1' },
                        },
                    },
                },
            ],
        },
    });
    await openScenario(page);

    await expect(page.getByText('Editing now')).toBeVisible();
    await expect(page.getByText('Remote Editor')).toBeVisible();
    expect(calls.streams).toEqual([]);
    const defaultPollsBeforeSwitch = calls.events.filter(call => call.draftId === 'draft-default').length;
    expect(defaultPollsBeforeSwitch).toBeGreaterThan(0);

    await page.getByLabel('Select group').click();
    await page.locator('.group-dropdown-option', { hasText: 'Alternate' }).click();
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await page.getByRole('button', { name: 'Run Scenario', exact: true }).click();
    await expect.poll(() => calls.events.some(call => call.draftId === 'draft-alt')).toBe(true);
    const defaultPollsAfterSwitch = calls.events.filter(call => call.draftId === 'draft-default').length;
    await page.waitForTimeout(5600);
    expect(calls.events.filter(call => call.draftId === 'draft-default')).toHaveLength(defaultPollsAfterSwitch);
    expect(calls.unexpected).toEqual([]);
});

test('presence ignores delayed old-scope polling response after scope switch', async ({ page }) => {
    const calls = await installDashboard(page, {
        deferredEventDraftIds: ['draft-default'],
    });
    await openScenario(page);
    await expect.poll(() => calls.deferredEvents.length).toBe(1);

    await page.getByLabel('Select group').click();
    await page.locator('.group-dropdown-option', { hasText: 'Alternate' }).click();
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await page.getByRole('button', { name: 'Run Scenario', exact: true }).click();
    await expect.poll(() => calls.events.some(call => call.draftId === 'draft-alt' && call.since === 0)).toBe(true);

    calls.deferredEvents[0].resolve({
        events: [
            {
                eventNumber: 90,
                eventType: 'presence.updated',
                draftRevision: 5,
                payload: {
                    presence: {
                        displayName: 'Old Scope Editor',
                        mode: 'editing',
                        cursorPayload: { issueKey: 'PROD-1' },
                    },
                },
            },
            {
                eventNumber: 91,
                eventType: 'lock.acquired',
                draftRevision: 5,
                payload: {
                    lock: {
                        resourceType: 'issue',
                        resourceId: 'PROD-1',
                        holderDisplayName: 'Old Scope Locker',
                    },
                },
            },
            {
                eventNumber: 92,
                eventType: 'draft.saved',
                draftRevision: 9,
                payload: { activeDraft: { versionNumber: 4, updatedBy: 'Old Scope Saver' } },
            },
        ],
        nextSince: 92,
    });
    await page.waitForTimeout(250);

    await expect(page.getByText('Old Scope Editor')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Old Scope Locker is editing PROD-1' })).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Newer draft available at revision 9' })).toHaveCount(0);
    await page.waitForTimeout(5600);
    expect(calls.events.some(call => call.draftId === 'draft-alt' && call.since === 92)).toBe(false);
    expect(calls.unexpected).toEqual([]);
});

test('stale history refresh response cannot replace new-scope draft metadata', async ({ page }) => {
    const calls = await installDashboard(page, {
        deferredDraftRefreshScopeKeys: [`${selectedSprintId}:grp-default`],
    });
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect.poll(() => calls.deferredDrafts.length).toBe(1);

    await page.getByLabel('Select group').click();
    await page.locator('.group-dropdown-option', { hasText: 'Alternate' }).click();
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await page.getByRole('button', { name: 'Run Scenario', exact: true }).click();
    await expect.poll(() => calls.events.some(call => call.draftId === 'draft-alt')).toBe(true);

    calls.deferredDrafts[0].resolve({
        activeDraft: {
            draftId: 'draft-default',
            name: 'Old scope remote',
            versionNumber: 9,
            draftRevision: 99,
            overrides: { 'PROD-1': { start: '2026-04-20', end: '2026-04-23' } },
            updatedBy: 'Old Scope Editor',
            updatedAt: '2026-05-19T12:00:00Z',
        },
        versions: [
            { draftId: 'draft-default', versionNumber: 9, draftRevision: 99, name: 'Old scope remote', overrideCount: 1, createdBy: 'Old Scope Editor', createdAt: '2026-05-19T12:00:00Z' },
        ],
        storage: 'db',
    });
    await page.waitForTimeout(250);

    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.scenario-draft-history-row', { hasText: 'Version 9' })).toHaveCount(0);
    await expect(dialog.locator('.scenario-draft-history-row', { hasText: 'Version 2' })).toBeVisible();
    expect(calls.unexpected).toEqual([]);
});

test('stale version reload response cannot apply overrides after scope switch', async ({ page }) => {
    const calls = await installDashboard(page, {
        deferredVersionDraftIds: ['draft-default'],
    });
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' })).toBeVisible();
    await page.getByRole('button', { name: 'Reload version 2' }).click();
    await expect.poll(() => calls.deferredVersions.length).toBe(1);

    await switchScenarioToAlternateGroup(page, calls);

    calls.deferredVersions[0].resolve({
        draftId: 'draft-default',
        versionNumber: 2,
        draftRevision: 5,
        name: 'Old scope version',
        overrides: { 'PROD-1': { start: '2026-04-20', end: '2026-04-23' } },
        overrideCount: 1,
        createdBy: 'Old Scope Editor',
        createdAt: '2026-05-19T12:00:00Z',
    });
    await page.waitForTimeout(250);

    await expect(page.getByText('Reloaded version 2 locally')).toHaveCount(0);
    await expect(page.locator('.scenario-dirty-indicator')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' }).getByRole('button', { name: 'Reload version 2' })).toBeEnabled();
    expect(calls.unexpected).toEqual([]);
});

test('stale rollback response leaves new-scope history controls enabled', async ({ page }) => {
    const calls = await installDashboard(page, {
        deferredRollbackDraftIds: ['draft-default'],
    });
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' })).toBeVisible();
    await page.getByRole('button', { name: 'Rollback to version 2' }).click();
    await expect.poll(() => calls.deferredRollback.length).toBe(1);

    await switchScenarioToAlternateGroup(page, calls);

    calls.deferredRollback[0].resolve({
        activeDraft: {
            draftId: 'draft-default',
            name: 'Old scope rollback',
            versionNumber: 3,
            draftRevision: 6,
            overrides: { 'PROD-1': { start: '2026-04-20', end: '2026-04-23' } },
            updatedBy: 'Old Scope Editor',
            updatedAt: '2026-05-19T12:00:00Z',
        },
        versions: [
            { draftId: 'draft-default', versionNumber: 3, draftRevision: 6, name: 'Old scope rollback', overrideCount: 1 },
        ],
        storage: 'db',
    });
    await page.waitForTimeout(250);

    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(page.getByText('Rolled back to version 2.')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Rollback to version 2' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Reload version 2' })).toBeEnabled();
    expect(calls.unexpected).toEqual([]);
});

test('stale reload-from-Jira response leaves new-scope reload control enabled', async ({ page }) => {
    const calls = await installDashboard(page, {
        deferredReloadFromJiraDraftIds: ['draft-default'],
    });
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload from Jira' }).click();
    await expect.poll(() => calls.deferredReloadFromJira.length).toBe(1);

    await switchScenarioToAlternateGroup(page, calls);

    calls.deferredReloadFromJira[0].resolve({
        activeDraft: {
            draftId: 'draft-default',
            name: 'Old scope Jira reload',
            versionNumber: 3,
            draftRevision: 6,
            overrides: {},
            updatedBy: 'Old Scope Editor',
            updatedAt: '2026-05-19T12:00:00Z',
        },
        versions: [
            { draftId: 'draft-default', versionNumber: 3, draftRevision: 6, name: 'Old scope Jira reload', overrideCount: 0 },
        ],
        storage: 'db',
    });
    await page.waitForTimeout(250);

    await expect(page.getByText('Reloaded from Jira into version 3.')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' }).getByRole('button', { name: 'Reload from Jira' })).toBeEnabled();
    expect(calls.unexpected).toEqual([]);
});

test('lock warning shows same-issue advisory conflict during drag', async ({ page }) => {
    await installDashboard(page, { lockConflict: true });
    await openScenario(page);

    await dragScenarioBar(page);

    await expect(page.getByRole('alert').filter({ hasText: 'Remote Editor is editing PROD-1' })).toBeVisible();
});

test('lock lifecycle does not release advisory lock before mouseup', async ({ page }) => {
    const calls = await installDashboard(page);
    await openScenario(page);

    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(bar).toHaveClass(/editable/);
    const box = await bar.boundingBox();
    expect(box, 'scenario bar bounds').toBeTruthy();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => calls.locks.some(call => call.body?.action === 'acquire')).toBe(true);
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 6 });
    await page.waitForTimeout(250);
    expect(calls.locks.map(call => call.body?.action)).not.toContain('release');
    await page.mouse.up();
    await expect.poll(() => calls.locks.some(call => call.body?.action === 'release')).toBe(true);
});

test('presence and lock warnings filter current authenticated user without fixture email', async ({ page }) => {
    await installDashboard(page, {
        currentUserEmail: 'planner.two@example.com',
        currentUserId: 'account-planner-two',
        eventQueues: {
            'draft-default': [
                {
                    eventNumber: 1,
                    eventType: 'presence.updated',
                    draftRevision: 5,
                    payload: {
                        presence: {
                            userId: 'account-planner-two',
                            displayName: 'planner.two@example.com',
                            mode: 'editing',
                        },
                    },
                },
                {
                    eventNumber: 2,
                    eventType: 'presence.updated',
                    draftRevision: 5,
                    payload: {
                        presence: {
                            userId: 'account-remote',
                            displayName: 'Remote Editor',
                            mode: 'editing',
                        },
                    },
                },
                {
                    eventNumber: 3,
                    eventType: 'lock.acquired',
                    draftRevision: 5,
                    payload: {
                        lock: {
                            resourceType: 'issue',
                            resourceId: 'PROD-1',
                            holderUserId: 'account-planner-two',
                            holderDisplayName: 'planner.two@example.com',
                        },
                    },
                },
                {
                    eventNumber: 4,
                    eventType: 'lock.acquired',
                    draftRevision: 5,
                    payload: {
                        lock: {
                            resourceType: 'issue',
                            resourceId: 'PROD-1',
                            holderUserId: 'account-remote',
                            holderDisplayName: 'Remote Locker',
                        },
                    },
                },
            ],
        },
    });
    await openScenario(page);
    await expect.poll(() => page.locator('.scenario-dirty-indicator').count()).toBe(0);

    await expect(page.getByText('Editing now')).toBeVisible();
    await expect(page.getByText('Remote Editor')).toBeVisible();
    await expect(page.getByText('planner.two@example.com')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Remote Locker is editing PROD-1' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'planner.two@example.com is editing PROD-1' })).toHaveCount(0);
});

test('presence ignores expired historical collaborators and locks from initial poll', async ({ page }) => {
    const recentLastSeenAt = new Date(Date.now() - 5000).toISOString();
    await installDashboard(page, {
        eventQueues: {
            'draft-default': [
                {
                    eventNumber: 1,
                    eventType: 'presence.updated',
                    draftRevision: 5,
                    payload: {
                        presence: {
                            userId: 'expired-presence',
                            displayName: 'Expired Editor',
                            mode: 'editing',
                            lastSeenAt: '2000-01-01T00:00:00Z',
                        },
                    },
                },
                {
                    eventNumber: 2,
                    eventType: 'lock.acquired',
                    draftRevision: 5,
                    payload: {
                        lock: {
                            resourceType: 'issue',
                            resourceId: 'PROD-1',
                            holderUserId: 'expired-lock',
                            holderDisplayName: 'Expired Locker',
                            expiresAt: '2000-01-01T00:00:00Z',
                        },
                    },
                },
                {
                    eventNumber: 3,
                    eventType: 'presence.updated',
                    draftRevision: 5,
                    payload: {
                        presence: {
                            userId: 'active-presence',
                            displayName: 'Recent Editor',
                            mode: 'editing',
                            lastSeenAt: recentLastSeenAt,
                        },
                    },
                },
                {
                    eventNumber: 4,
                    eventType: 'lock.acquired',
                    draftRevision: 5,
                    payload: {
                        lock: {
                            resourceType: 'issue',
                            resourceId: 'PROD-1',
                            holderUserId: 'active-lock',
                            holderDisplayName: 'Active Locker',
                            expiresAt: '2999-01-01T00:00:00Z',
                        },
                    },
                },
            ],
        },
    });
    await openScenario(page);

    await expect(page.getByText('Recent Editor')).toBeVisible();
    await expect(page.getByText('Expired Editor')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Active Locker is editing PROD-1' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Expired Locker is editing PROD-1' })).toHaveCount(0);
});

test('stale draftRevision shows recovery actions and keeps dirty local edits', async ({ page }) => {
    await installDashboard(page, {
        remoteVersionOnHistoryRefresh: true,
        eventQueues: {
            'draft-default': [
                {
                    eventNumber: 2,
                    eventType: 'draft.saved',
                    draftRevision: 6,
                    payload: { versionNumber: 3, updatedBy: 'Remote Editor' },
                },
            ],
        },
    });
    await openScenario(page);
    await dragScenarioBar(page);

    await expect(page.getByRole('alert').filter({ hasText: 'Newer draft available' })).toContainText('revision 6');
    await expect(page.getByRole('button', { name: 'Review history' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload active draft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep editing locally' })).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();

    await page.getByRole('button', { name: 'Review history' }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    const remoteVersionRow = dialog.locator('.scenario-draft-history-row', { hasText: 'Version 3' });
    await expect(remoteVersionRow).toContainText('Remote Editor');
    await expect(remoteVersionRow).toContainText('Current');
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
});

test('dirty rollback asks before replacing local edits', async ({ page }) => {
    const calls = await installDashboard(page);
    await openScenario(page);
    await dragScenarioBar(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Rollback to version 2' }).click();

    await expect(dialog.getByText('Rollback to version 2 and replace local edits?')).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    expect(calls.rollback).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByText('Rollback to version 2 and replace local edits?')).toHaveCount(0);
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();

    await page.getByRole('button', { name: 'Rollback to version 2' }).click();
    await dialog.getByRole('button', { name: 'Rollback to Version', exact: true }).click();
    await expect(page.getByText('Rolled back to version 2.')).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator')).toHaveCount(0);
    expect(calls.rollback).toHaveLength(1);
    expect(calls.rollback[0].body.baseDraftRevision).toBe(5);
});

test('dirty remote reload asks before replacing local edits', async ({ page }) => {
    await installDashboard(page, {
        remoteVersionOnHistoryRefresh: true,
        eventQueues: {
            'draft-default': [
                {
                    eventNumber: 2,
                    eventType: 'draft.saved',
                    draftRevision: 6,
                    payload: { versionNumber: 3, updatedBy: 'Remote Editor' },
                },
            ],
        },
    });
    await openScenario(page);
    await dragScenarioBar(page);

    await expect(page.getByRole('alert').filter({ hasText: 'Newer draft available' })).toContainText('revision 6');
    await page.getByRole('button', { name: 'Reload active draft' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Reload active draft and replace local edits?' })).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel active draft reload' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Reload active draft and replace local edits?' })).toHaveCount(0);
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();

    await page.getByRole('button', { name: 'Reload active draft' }).click();
    await page.getByRole('button', { name: 'Confirm reload active draft' }).click();
    await expect(page.getByText('Reloaded active draft revision 6.')).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
});

test('reload from Jira stale base shows conflict recovery without overwriting edits', async ({ page }) => {
    const calls = await installDashboard(page, { reloadFromJiraConflict: true });
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload from Jira' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toContainText('revision 6');
    await expect(dialog.locator('.scenario-draft-history-row', { hasText: 'Version 3' })).toContainText('Remote Editor');
    expect(calls.reloadFromJira).toHaveLength(1);
    expect(calls.reloadFromJira[0].body.baseDraftRevision).toBe(5);

    await dialog.getByRole('button', { name: 'Reload version 3' }).click();
    await expect(page.getByText('Reloaded version 3 locally. Save Draft to make it current.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Build product scenario path override/ })).toBeVisible();
});

test('write-back stays preview-only and blocked by the gate', async ({ page }) => {
    const calls = await installDashboard(page);
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    const rollbackButton = dialog.getByRole('button', { name: 'Rollback to version 2' });
    const previewButton = dialog.getByRole('button', { name: 'Preview Jira write-back' });
    await expect(rollbackButton).toBeVisible();
    await expect(previewButton).toBeVisible();
    expect(await rollbackButton.evaluate((rollback, preview) => (
        Boolean(rollback.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING)
    ), await previewButton.elementHandle())).toBe(true);

    await previewButton.click();
    await expect(dialog.getByText('Jira write-back preview is dry-run only. 0 changes would be prepared.')).toBeVisible();
    expect(calls.writebackPreview).toHaveLength(1);

    await expect(dialog.getByRole('button', { name: 'Write Back to Jira' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Check write-back gate' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft Jira write-back is blocked by the migration gate.' })).toBeVisible();
    expect(calls.writeback).toHaveLength(1);
});

test('write-back preview and gate responses after scope switch do not mutate new scope', async ({ page }) => {
    const calls = await installDashboard(page, {
        deferredWritebackPreviewDraftIds: ['draft-default'],
        deferredWritebackDraftIds: ['draft-default'],
    });
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Preview Jira write-back' }).click();
    await dialog.getByRole('button', { name: 'Check write-back gate' }).click();
    await expect.poll(() => calls.deferredWritebackPreview.length).toBe(1);
    await expect.poll(() => calls.deferredWriteback.length).toBe(1);

    await page.getByLabel('Select group').click();
    await page.locator('.group-dropdown-option', { hasText: 'Alternate' }).click();
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await page.getByRole('button', { name: 'Run Scenario', exact: true }).click();
    await expect.poll(() => calls.events.some(call => call.draftId === 'draft-alt')).toBe(true);

    calls.deferredWritebackPreview[0].resolve({
        ok: true,
        dryRun: true,
        draftId: 'draft-default',
        draftRevision: 5,
        changes: [{ issueKey: 'PROD-1' }],
    });
    calls.deferredWriteback[0].resolve({
        status: 403,
        body: {
            error: 'jira_writeback_gate_blocked',
            message: 'Old scope write-back gate response',
        },
    });
    await page.waitForTimeout(250);

    await expect(page.getByRole('dialog', { name: 'Scenario draft history' })).toBeVisible();
    await expect(page.getByText('Jira write-back preview is dry-run only. 1 changes would be prepared.')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Old scope write-back gate response' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' }).getByRole('button', { name: 'Preview Jira write-back' })).toBeEnabled();
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' }).getByRole('button', { name: 'Check write-back gate' })).toBeEnabled();
    expect(calls.unexpected).toEqual([]);
});

test('presence heartbeat retries csrf once and then pauses after repeated csrf failure', async ({ page }) => {
    const calls = await installDashboard(page, { presenceCsrfAlwaysFail: true });
    await openScenario(page);

    await expect(page.getByRole('status').filter({ hasText: 'Realtime paused' })).toContainText('local-only');
    expect(calls.presence).toHaveLength(2);
    expect(calls.csrf).toEqual([1, 2]);
    expect(calls.presence[0].token).toBe('csrf-token-1');
    expect(calls.presence[1].token).toBe('csrf-token-2');
    await dragScenarioBar(page);
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    expect(calls.unexpected).toEqual([]);
});
