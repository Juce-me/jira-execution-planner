const { test, expect } = require('@playwright/test');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(repoRoot, 'frontend', 'dist', 'dashboard.css'), 'utf8');
const screenshotDir = '/tmp/scenario-draft-history-qa';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const scopeKey = `${selectedSprintId}:grp-default`;

let dashboardJs;
const unexpectedApiRequestsByPage = new WeakMap();

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

test.afterEach(({ page }) => {
    expect(unexpectedApiRequestsByPage.get(page) || []).toEqual([]);
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

function expectCsrfHeader(headers) {
    const token = headers['x-csrf-token'];
    expect(token).toMatch(/^csrf-token-\d+$/);
    return token;
}

async function waitForVisualSettled(page) {
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const waitForAnimations = async () => {
            const animations = document.getAnimations({ subtree: true });
            if (animations.length === 0) return;
            await Promise.race([
                Promise.all(animations.map(animation => animation.finished.catch(() => undefined))),
                new Promise(resolve => window.setTimeout(resolve, 1200)),
            ]);
        };
        await waitForAnimations();
        await new Promise(requestAnimationFrame);
        await waitForAnimations();
    });
}

async function captureScenarioScreenshot(page, name) {
    await waitForVisualSettled(page);
    await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true });
}

function overlaps(a, b, tolerance = 0) {
    return !(
        a.right <= b.left + tolerance ||
        b.right <= a.left + tolerance ||
        a.bottom <= b.top + tolerance ||
        b.bottom <= a.top + tolerance
    );
}

async function expectNoHistoryManagementControls(dialog) {
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();
    const forbiddenControls = await dialog.locator('button, input, textarea, select, [role="button"]').evaluateAll(nodes => (
        nodes
            .map(node => ({
                tag: node.tagName.toLowerCase(),
                type: node.getAttribute('type') || '',
                name: node.getAttribute('name') || '',
                label: node.getAttribute('aria-label') || '',
                placeholder: node.getAttribute('placeholder') || '',
                text: node.textContent || '',
            }))
            .filter(control => {
                const haystack = [
                    control.type,
                    control.name,
                    control.label,
                    control.placeholder,
                    control.text,
                ].join(' ');
                return /(add|create|duplicate|delete|manage)\s+(team\s+)?group/i.test(haystack)
                    || /\b(api\s*)?token\b/i.test(haystack)
                    || control.type.toLowerCase() === 'password';
            })
    ));
    expect(forbiddenControls).toEqual([]);
}

async function expectScenarioStickyAndNoOverlap(page) {
    const timeline = page.locator('.scenario-timeline').first();
    const axis = page.locator('.scenario-axis').first();
    const lane = page.locator('.scenario-lane').first();
    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    await expect(timeline).toBeVisible();
    await expect(axis).toBeVisible();
    await expect(lane).toBeVisible();
    await expect(bar).toBeVisible();

    const stickySetup = await axis.evaluate((element) => {
        const timelineElement = element.closest('.scenario-timeline');
        timelineElement.scrollTop = 0;
        return getComputedStyle(element).position;
    });
    expect(stickySetup).toBe('sticky');
    const scrollState = await axis.evaluate((element) => {
        element.closest('.scenario-timeline').scrollTop = 160;
        const timelineElement = element.closest('.scenario-timeline');
        return {
            scrollTop: timelineElement.scrollTop,
            scrollHeight: timelineElement.scrollHeight,
            clientHeight: timelineElement.clientHeight,
        };
    });
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    expect(scrollState.scrollTop).toBeGreaterThan(0);
    await waitForVisualSettled(page);
    const stickyResult = await axis.evaluate((element) => {
        const timelineElement = element.closest('.scenario-timeline');
        const axisRect = element.getBoundingClientRect();
        const timelineRect = timelineElement.getBoundingClientRect();
        return {
            axisTop: axisRect.top,
            timelineTop: timelineRect.top,
        };
    });
    expect(stickyResult.axisTop).toBeGreaterThanOrEqual(stickyResult.timelineTop - 1);
    expect(stickyResult.axisTop).toBeLessThanOrEqual(stickyResult.timelineTop + 28);

    await axis.evaluate((element) => {
        element.closest('.scenario-timeline').scrollTop = 0;
    });
    await waitForVisualSettled(page);
    const layout = await page.evaluate(() => {
        const rectFor = selector => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            };
        };
        return {
            header: rectFor('.scenario-header'),
            controls: rectFor('.scenario-controls'),
            history: rectFor('.scenario-draft-history-panel'),
            timeline: rectFor('.scenario-timeline'),
            axis: rectFor('.scenario-axis'),
            lane: rectFor('.scenario-lane'),
            bar: rectFor('.scenario-bar'),
        };
    });
    expect(layout.header).toBeTruthy();
    expect(layout.controls).toBeTruthy();
    expect(layout.timeline).toBeTruthy();
    expect(layout.axis).toBeTruthy();
    expect(layout.lane).toBeTruthy();
    expect(layout.bar).toBeTruthy();
    expect(overlaps(layout.controls, layout.timeline), JSON.stringify(layout, null, 2)).toBe(false);
    expect(layout.axis.bottom).toBeLessThanOrEqual(layout.lane.top + 1);
    expect(overlaps(layout.axis, layout.bar), JSON.stringify(layout, null, 2)).toBe(false);
    if (layout.history) {
        expect(overlaps(layout.controls, layout.history), JSON.stringify(layout, null, 2)).toBe(false);
        expect(overlaps(layout.history, layout.timeline), JSON.stringify(layout, null, 2)).toBe(false);
    }
}

function scenarioPayload() {
    const teams = Array.from({ length: 14 }, (_, index) => `Scenario Team ${index + 1}`);
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
        capacity_by_team: Object.fromEntries(teams.map((team, index) => [
            team,
            { size: 3 + (index % 2), devLead: `${team} Lead` },
        ])),
        issues: [
            {
                key: 'PROD-1',
                summary: 'Build product scenario path',
                epicKey: 'PROD-EPIC',
                epicSummary: 'Product delivery epic',
                team: teams[0],
                assignee: 'Alpha Owner',
                sp: 3,
                start: '2026-04-06',
                end: '2026-04-09',
            },
            ...teams.slice(1).map((team, index) => ({
                key: `PROD-${index + 2}`,
                summary: `Build scenario lane ${index + 2}`,
                epicKey: 'PROD-EPIC',
                epicSummary: 'Product delivery epic',
                team,
                assignee: `${team} Owner`,
                sp: 2,
                start: '2026-04-06',
                end: '2026-04-09',
            })),
        ],
    };
}

async function installDashboardFromSource(page, options = {}) {
    const draftPosts = [];
    const scenarioPosts = [];
    const versionRequests = [];
    const rollbackPosts = [];
    const unexpectedApiRequests = [];
    unexpectedApiRequestsByPage.set(page, unexpectedApiRequests);
    let csrfCount = 0;
    let draftMetadata = {
        activeDraft: {
            draftId: 'draft-1',
            name: 'Current draft',
            versionNumber: 2,
            draftRevision: 5,
            overrides: {},
            scopePayload: {
                groupId: 'grp-default',
                groupName: 'Default',
                sprintId: String(selectedSprintId),
                sprintName: selectedSprintName,
            },
            updatedBy: 'Remote Editor',
            updatedAt: '2026-05-19T10:30:00Z',
        },
        versions: [
            {
                draftId: 'draft-1',
                versionNumber: 1,
                draftRevision: 4,
                name: 'Old dates',
                overrideCount: 1,
                createdBy: 'Planner One',
                createdAt: '2026-05-18T09:00:00Z',
            },
            {
                draftId: 'draft-1',
                versionNumber: 2,
                draftRevision: 5,
                name: 'Current draft',
                overrideCount: 0,
                createdBy: 'Remote Editor',
                createdAt: '2026-05-19T10:30:00Z',
            },
        ],
        storage: 'db',
    };

    const setRemoteConflictMetadata = () => {
        draftMetadata = {
            activeDraft: {
                draftId: 'draft-1',
                name: 'Remote update',
                versionNumber: 3,
                draftRevision: 6,
                overrides: {},
                scopePayload: {
                    groupId: 'grp-default',
                    groupName: 'Default',
                    sprintId: String(selectedSprintId),
                    sprintName: selectedSprintName,
                },
                updatedBy: 'Remote Editor',
                updatedAt: '2026-05-19T10:45:00Z',
            },
            versions: [
                ...draftMetadata.versions.map(version => (
                    version.versionNumber === 2
                        ? { ...version, draftRevision: 5, name: 'Current draft', overrideCount: 0, createdBy: 'Remote Editor', createdAt: '2026-05-19T10:30:00Z' }
                        : version
                )),
                {
                    draftId: 'draft-1',
                    versionNumber: 3,
                    draftRevision: 6,
                    name: 'Remote update',
                    overrideCount: 0,
                    createdBy: 'Remote Editor',
                    createdAt: '2026-05-19T10:45:00Z',
                },
            ],
            storage: 'db',
        };
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
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
    }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));

    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();

        if (url.pathname === '/api/scenario/overrides') {
            unexpectedApiRequests.push(`${method} ${url.pathname}`);
            return json(route, { error: 'legacy scenario overrides route must not be called' }, 500);
        }
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json(route, { authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com', profile: { email: 'profile@example.com' } });
        }
        if (url.pathname === '/api/auth/csrf') {
            csrfCount += 1;
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
                groups: [{
                    id: 'grp-default',
                    name: 'Default',
                    teamIds: ['team-alpha'],
                    teamLabels: { 'team-alpha': 'alpha_label' },
                }],
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
        if (url.pathname === '/api/scenario' && method === 'POST') {
            scenarioPosts.push(requestBody(request));
            return json(route, scenarioPayload());
        }
        if (url.pathname === '/api/scenario/drafts' && method === 'GET') {
            return json(route, draftMetadata);
        }
        if (url.pathname === '/api/scenario/drafts/draft-1/versions/1' && method === 'GET') {
            versionRequests.push(1);
            const overrides = options.rollbackConflict
                ? { 'PROD-1': { start: '2026-04-25', end: '2026-04-28' } }
                : { 'PROD-1': { start: '2026-04-10', end: '2026-04-13' } };
            return json(route, {
                draftId: 'draft-1',
                versionNumber: 1,
                draftRevision: 4,
                name: 'Old dates',
                overrides,
                overrideCount: 1,
                createdBy: 'Planner One',
                createdAt: '2026-05-18T09:00:00Z',
            });
        }
        if (url.pathname === '/api/scenario/drafts/draft-1/rollback' && method === 'POST') {
            const headers = request.headers();
            const body = requestBody(request);
            rollbackPosts.push({ headers, body });
            if (options.rollbackConflict) {
                setRemoteConflictMetadata();
                return json(route, {
                    error: 'scenario_draft_conflict',
                    message: 'The scenario draft changed before this rollback could be saved.',
                    conflict: {
                        reason: 'stale_base_draft_revision',
                        receivedBaseDraftRevision: 5,
                        currentDraftRevision: 6,
                        currentVersionNumber: 3,
                    },
                    activeDraft: {
                        draftId: 'draft-1',
                        name: 'Remote update',
                        versionNumber: 3,
                        draftRevision: 6,
                        overrides: {},
                        updatedBy: 'Remote Editor',
                        updatedAt: '2026-05-19T10:45:00Z',
                    },
                    versions: [{ versionNumber: 3, draftRevision: 6, name: 'Remote update' }],
                    storage: 'db',
                }, 409);
            }
            return json(route, {
                activeDraft: {
                    draftId: 'draft-1',
                    name: 'Old dates',
                    versionNumber: 3,
                    draftRevision: 6,
                    overrides: { 'PROD-1': { start: '2026-04-10', end: '2026-04-13' } },
                    updatedBy: 'Planner One',
                    updatedAt: '2026-05-19T11:00:00Z',
                },
                versions: [
                    { versionNumber: 1, draftRevision: 4, name: 'Old dates', overrideCount: 1, createdBy: 'Planner One', createdAt: '2026-05-18T09:00:00Z' },
                    { versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0, createdBy: 'Remote Editor', createdAt: '2026-05-19T10:30:00Z' },
                    { versionNumber: 3, draftRevision: 6, name: 'Old dates', overrideCount: 1, createdBy: 'Planner One', createdAt: '2026-05-19T11:00:00Z' },
                ],
                storage: 'db',
            });
        }
        if (url.pathname === '/api/scenario/drafts' && method === 'POST') {
            const headers = request.headers();
            const body = requestBody(request);
            draftPosts.push({
                headers,
                body,
            });
            if (options.csrfRetry && draftPosts.length === 1) {
                return json(route, { error: 'csrf_required', message: 'CSRF token required.' }, 403);
            }
            setRemoteConflictMetadata();
            return json(route, {
                error: 'scenario_draft_conflict',
                message: 'The scenario draft changed before this write could be saved.',
                conflict: {
                    reason: 'stale_base_draft_revision',
                    receivedBaseDraftRevision: 5,
                    currentDraftRevision: 6,
                    currentVersionNumber: 3,
                },
                activeDraft: {
                    draftId: 'draft-1',
                    name: 'Remote update',
                    versionNumber: 3,
                    draftRevision: 6,
                    overrides: {},
                    updatedBy: 'Remote Editor',
                    updatedAt: '2026-05-19T10:45:00Z',
                },
                versions: [
                    { versionNumber: 2, draftRevision: 5, name: 'Current draft', overrideCount: 0, createdBy: 'Remote Editor', createdAt: '2026-05-19T10:30:00Z' },
                    { versionNumber: 3, draftRevision: 6, name: 'Remote update', overrideCount: 0, createdBy: 'Remote Editor', createdAt: '2026-05-19T10:45:00Z' },
                ],
                storage: 'db',
            }, 409);
        }
        const eventsMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/events$/);
        if (eventsMatch && method === 'GET') {
            const since = Number(url.searchParams.get('since') || 0);
            return json(route, { events: [], nextSince: since, isLast: true });
        }
        const presenceMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/presence$/);
        if (presenceMatch && method === 'POST') {
            const body = requestBody(request);
            return json(route, {
                presence: {
                    userId: 'profile@example.com',
                    displayName: 'profile@example.com',
                    mode: body?.mode || 'viewing',
                    lastSeenAt: '2999-01-01T00:00:00Z',
                },
                event: { eventNumber: 10, eventType: 'presence.updated', draftRevision: 5, payload: {} },
            });
        }
        const locksMatch = url.pathname.match(/^\/api\/scenario\/drafts\/([^/]+)\/locks$/);
        if (locksMatch && method === 'POST') {
            const body = requestBody(request);
            return json(route, {
                lock: {
                    resourceType: 'issue',
                    resourceId: body?.resourceId,
                    holderUserId: 'profile@example.com',
                    holderDisplayName: 'profile@example.com',
                    expiresAt: '2999-01-01T00:00:00Z',
                },
                event: { eventNumber: 20, eventType: `lock.${body?.action || 'acquire'}`, draftRevision: 5, payload: {} },
            });
        }
        unexpectedApiRequests.push(`${method} ${url.pathname}`);
        return json(route, {
            error: `Unexpected API request in scenario draft history test: ${method} ${url.pathname}`,
        }, 500);
    });

    return {
        draftPosts,
        rollbackPosts,
        scenarioPosts,
        versionRequests,
        csrfCount: () => csrfCount,
    };
}

async function openScenarioWithDirtyDraft(page) {
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
    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    await expect(bar).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(bar).toHaveClass(/editable/);
    const box = await bar.boundingBox();
    expect(box, 'scenario bar bounds').toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeEnabled();
}

test('history opened after Run Scenario keeps Scenario layout sticky and scoped', async ({ page }) => {
    await installDashboardFromSource(page);
    await openScenario(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.scenario-draft-history-row', { hasText: 'Version 2' }).getByText('Current')).toBeVisible();
    await expectNoHistoryManagementControls(dialog);
    await expectScenarioStickyAndNoOverlap(page);
    await captureScenarioScreenshot(page, 'current-version-drawer');

    await dialog.getByRole('button', { name: 'Close' }).click();

    await expect(dialog).toHaveCount(0);
    await expectScenarioStickyAndNoOverlap(page);
    await captureScenarioScreenshot(page, 'closed-drawer-state');
});

test('save conflict renders remote version details and keeps local draft edit', async ({ page }) => {
    const { draftPosts } = await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);

    await page.getByRole('button', { name: 'Save Draft' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toContainText('revision 6');
    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toContainText('version 3');
    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toContainText('Remote Editor');
    await expect(page.getByRole('button', { name: 'Review history' })).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    await captureScenarioScreenshot(page, 'save-conflict-banner');
    await page.getByRole('button', { name: 'Review history' }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expectNoHistoryManagementControls(dialog);
    await expect(dialog).toContainText('Version 3');
    const staleActiveRow = dialog.locator('.scenario-draft-history-row', { hasText: 'Version 2' });
    const remoteCurrentRow = dialog.locator('.scenario-draft-history-row', { hasText: 'Version 3' });
    await expect(remoteCurrentRow.getByText('Current')).toBeVisible();
    await expect(staleActiveRow.getByText('Current')).toHaveCount(0);
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeFocused();

    expect(draftPosts).toHaveLength(1);
    expect(draftPosts[0].headers['x-requested-with']).toBe('jira-execution-planner');
    expectCsrfHeader(draftPosts[0].headers);
    expect(draftPosts[0].body.scope_key).toBe(scopeKey);
    expect(draftPosts[0].body.baseDraftRevision).toBe(5);
    expect(draftPosts[0].body.overrides).toHaveProperty('PROD-1');
    expect(draftPosts[0].body.scenarioOverrides).toHaveProperty('PROD-1');
});

test('history rows render current and loaded version states', async ({ page }) => {
    await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);

    await page.getByRole('button', { name: 'History' }).click();

    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    await expect(dialog.getByText('Version 1')).toBeVisible();
    await expect(dialog.getByText('Planner One')).toBeVisible();
    await expect(dialog.getByText('2026-05-18T09:00:00Z')).toBeVisible();
    await expect(dialog.getByText('1 override')).toBeVisible();
    await expect(dialog.getByText('Version 2')).toBeVisible();
    await expect(dialog.getByText('Remote Editor')).toBeVisible();
    await expect(dialog.getByText('0 overrides')).toBeVisible();
    const currentRow = dialog.locator('.scenario-draft-history-row', { hasText: 'Version 2' });
    await expect(currentRow.getByText('Current')).toBeVisible();
    await expect(currentRow.getByText('Loaded')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
});

test('keyboard opens history, focuses the title, and Escape returns focus to History', async ({ page }) => {
    await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);

    const historyButton = page.getByRole('button', { name: 'History' });
    await historyButton.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#scenario-draft-history-title')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(historyButton).toBeFocused();
});

test('accessibility status regions distinguish success and conflict text', async ({ page }) => {
    await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);
    await page.getByRole('button', { name: 'Discard' }).click();

    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Reload version 1' }).click();

    await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Reloaded version 1 locally' })).toBeVisible();

    await page.getByRole('button', { name: 'Save Draft' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toBeVisible();
});

test('keyboard Escape outside history keeps drawer open and Ctrl+Z still undoes scenario edits', async ({ page }) => {
    await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);
    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    const dirtyBox = await bar.boundingBox();
    expect(dirtyBox, 'dirty scenario bar bounds').toBeTruthy();

    await page.getByRole('button', { name: 'History' }).click();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'History' }).focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyZ');
    await page.keyboard.up('Control');
    await expect.poll(async () => {
        const box = await bar.boundingBox();
        return Math.round(box.x);
    }).toBeLessThan(Math.round(dirtyBox.x - 20));
});

test('history reload applies old dates locally without activating server version', async ({ page }) => {
    const { rollbackPosts, versionRequests } = await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);
    await page.getByRole('button', { name: 'Discard' }).click();
    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    const beforeBox = await bar.boundingBox();

    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Reload version 1' }).click();

    await expect(page.getByText('Reloaded version 1 locally. Save Draft to make it current.')).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Scenario draft history' });
    const loadedRow = dialog.locator('.scenario-draft-history-row', { hasText: 'Version 1' });
    const currentRow = dialog.locator('.scenario-draft-history-row', { hasText: 'Version 2' });
    await expect(loadedRow.getByText('Loaded')).toBeVisible();
    await expect(loadedRow.getByText('Current')).toHaveCount(0);
    await expect(currentRow.getByText('Current')).toBeVisible();
    await expect(currentRow.getByText('Loaded')).toHaveCount(0);
    const afterBox = await bar.boundingBox();
    expect(afterBox.x).toBeGreaterThan(beforeBox.x + 20);
    expect(versionRequests).toEqual([1]);
    expect(rollbackPosts).toHaveLength(0);
});

test('dirty history reload asks inline confirmation before replacing edits', async ({ page }) => {
    await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);

    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Reload version 1' }).click();

    await expect(page.getByText('Reload version 1 and replace local edits?')).toBeVisible();
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    const confirmation = page.locator('.scenario-draft-history-confirmation', { hasText: 'Reload version 1' });
    await expect(confirmation.getByRole('button', { name: 'Reload Version' })).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Continue reload version 1' })).toHaveCount(0);
    await captureScenarioScreenshot(page, 'dirty-reload-confirmation');
    await confirmation.getByRole('button', { name: 'Reload Version' }).click();
    await expect(page.getByText('Reloaded version 1 locally. Save Draft to make it current.')).toBeVisible();
});

test('rollback posts target version and baseDraftRevision then makes rollback current', async ({ page }) => {
    const { rollbackPosts, versionRequests } = await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);
    await page.getByRole('button', { name: 'Discard' }).click();

    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Rollback to version 1' }).click();

    await expect(page.getByText('Rolled back to version 1.')).toBeVisible();
    await expect(page.getByText('Version 3')).toBeVisible();
    expect(versionRequests).toEqual([1]);
    expect(rollbackPosts).toHaveLength(1);
    expect(rollbackPosts[0].headers['x-requested-with']).toBe('jira-execution-planner');
    expectCsrfHeader(rollbackPosts[0].headers);
    expect(rollbackPosts[0].body.targetVersionNumber).toBe(1);
    expect(rollbackPosts[0].body.baseDraftRevision).toBe(5);
});

test('dirty rollback asks inline confirmation before replacing edits', async ({ page }) => {
    const { rollbackPosts } = await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);

    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Rollback to version 1' }).click();

    await expect(page.getByText('Rollback to version 1 and replace local edits?')).toBeVisible();
    expect(rollbackPosts).toHaveLength(0);
    const confirmation = page.locator('.scenario-draft-history-confirmation', { hasText: 'Rollback to version 1' });
    await expect(confirmation.getByRole('button', { name: 'Rollback to Version' })).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Continue rollback to version 1' })).toHaveCount(0);
    await confirmation.getByRole('button', { name: 'Rollback to Version' }).click();
    await expect(page.getByText('Rolled back to version 1.')).toBeVisible();
    expect(rollbackPosts).toHaveLength(1);
});

test('rollback conflict preserves local edits and renders conflict recovery', async ({ page }) => {
    const { rollbackPosts } = await installDashboardFromSource(page, { rollbackConflict: true });
    await openScenarioWithDirtyDraft(page);
    const bar = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    const dirtyBox = await bar.boundingBox();

    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Rollback to version 1' }).click();
    await page.locator('.scenario-draft-history-confirmation', { hasText: 'Rollback to version 1' })
        .getByRole('button', { name: 'Rollback to Version' })
        .click();

    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toContainText('revision 6');
    await expect(page.locator('.scenario-dirty-indicator', { hasText: '1 override' })).toBeVisible();
    const conflictBox = await bar.boundingBox();
    expect(Math.abs(conflictBox.x - dirtyBox.x)).toBeLessThan(2);
    expect(rollbackPosts).toHaveLength(1);
    expect(rollbackPosts[0].headers['x-requested-with']).toBe('jira-execution-planner');
    expectCsrfHeader(rollbackPosts[0].headers);
});

test('dirty same-scope Run Scenario is blocked and keeps local draft edit', async ({ page }) => {
    const { scenarioPosts } = await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);
    expect(scenarioPosts).toHaveLength(1);

    await page.getByRole('button', { name: 'Run Scenario' }).click();

    await expect(page.getByText('Save or discard scenario draft changes before reloading scenario data.')).toBeVisible();
    await expect(page.getByText('1 override')).toBeVisible();
    expect(scenarioPosts).toHaveLength(1);
});

test('save conflict retries once after csrf_required before surfacing conflict', async ({ page }) => {
    const { draftPosts, csrfCount } = await installDashboardFromSource(page, { csrfRetry: true });
    await openScenarioWithDirtyDraft(page);

    await page.getByRole('button', { name: 'Save Draft' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Scenario draft conflict' })).toContainText('revision 6');
    expect(draftPosts).toHaveLength(2);
    expect(csrfCount()).toBeGreaterThanOrEqual(2);
    expect(draftPosts[0].headers['x-requested-with']).toBe('jira-execution-planner');
    expect(draftPosts[1].headers['x-requested-with']).toBe('jira-execution-planner');
    const firstDraftToken = expectCsrfHeader(draftPosts[0].headers);
    const secondDraftToken = expectCsrfHeader(draftPosts[1].headers);
    expect(secondDraftToken).not.toBe(firstDraftToken);
    expect(draftPosts[1].body.scope_key).toBe(scopeKey);
    expect(draftPosts[1].body.baseDraftRevision).toBe(5);
    expect(draftPosts[1].body.overrides).toHaveProperty('PROD-1');
});
