const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const capacityArtifactDir = path.join(repoRoot, '.superpowers', 'sdd', 'EXEC-planning-capacity-editing', 'task-8-artifacts');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const sprintId = 3001;
const sprintName = '2026Q2';
const nextSprintId = 3002;
const nextSprintName = '2026Q3';
const planningScopeKey = `planning::${sprintId}::group-capacity`;
const selectedKeys = ['PLAN-ALPHA', 'PLAN-BETA', 'PLAN-GAMMA'];
let dashboardJs;
let dashboardCss;

test.beforeAll(() => {
    dashboardJs = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
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
    } catch (_error) {
        return null;
    }
}

function story(key, teamId, teamName, storyPoints, issueSprintId = sprintId, issueSprintName = sprintName) {
    return {
        id: key,
        key,
        fields: {
            summary: `${teamName} selected planning story`,
            status: { name: 'To Do' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: `${teamName} Owner` },
            customfield_10004: storyPoints,
            epicKey: 'PLAN-EPIC',
            parentSummary: 'Synthetic planning epic',
            projectKey: 'PLAN',
            teamId,
            teamName,
            sprint: [{ id: issueSprintId, name: issueSprintName, state: 'active' }],
            customfield_10101: [{ id: issueSprintId, name: issueSprintName, state: 'active' }],
        },
    };
}

const stories = [
    story('PLAN-ALPHA', 'team-alpha', 'Alpha', 8),
    story('PLAN-BETA', 'team-beta', 'Beta', 4),
    story('PLAN-GAMMA', 'team-gamma', 'Gamma', 2),
];

const nextStories = [
    story('PLAN-ALPHA', 'team-alpha', 'Alpha', 8, nextSprintId, nextSprintName),
    story('PLAN-BETA', 'team-beta', 'Beta', 4, nextSprintId, nextSprintName),
    story('PLAN-GAMMA', 'team-gamma', 'Gamma', 2, nextSprintId, nextSprintName),
];

function buildCapacityFixtureData(teamCount, longTeamLabel = false, actionlessLongTeam = false) {
    const teamNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].slice(0, teamCount);
    if (longTeamLabel) {
        teamNames[teamNames.length - 1] = 'Synthetic Capacity Reliability Enablement and Cross-Functional Delivery Operations Team';
    }
    const fixtureStory = (teamName, index, issueSprintId = sprintId, issueSprintName = sprintName) => {
        const isLongSyntheticTeam = teamName.startsWith('Synthetic Capacity');
        const fixture = story(
            isLongSyntheticTeam ? `PLAN-SYNTHETIC-${index + 1}` : `PLAN-${teamName.toUpperCase()}`,
            isLongSyntheticTeam ? `team-synthetic-${index + 1}` : `team-${teamName.toLowerCase()}`,
            teamName,
            Math.max(1, 8 - index),
            issueSprintId,
            issueSprintName,
        );
        if (isLongSyntheticTeam) {
            fixture.fields.summary = 'Synthetic selected planning story';
            fixture.fields.assignee = { displayName: 'Synthetic Owner' };
        }
        return fixture;
    };
    const fixtureStories = teamNames.map((teamName, index) => fixtureStory(teamName, index));
    const fixtureNextStories = teamNames.map((teamName, index) => fixtureStory(teamName, index, nextSprintId, nextSprintName));
    const capacities = Object.fromEntries(teamNames.map((teamName, index) => [
        teamName,
        index === 1 ? 0 : Math.max(0, 5.5 - index),
    ]));
    const entries = teamNames.map((teamName, index) => ({
        teamName,
        issueKey: `CAP-${101 + index}`,
        capacity: capacities[teamName],
    })).filter(entry => !actionlessLongTeam || entry.teamName !== teamNames.at(-1));
    return {
        teamNames,
        stories: fixtureStories,
        nextStories: fixtureNextStories,
        selectedKeys: fixtureStories.map(issue => issue.key),
        capacityPayload: {
            enabled: true,
            mutationEnabled: true,
            sprint: sprintName,
            capacities,
            entries,
        },
        nextCapacityPayload: {
            enabled: true,
            mutationEnabled: true,
            sprint: nextSprintName,
            capacities,
            entries,
        },
    };
}

const capacityPayload = {
    enabled: true,
    mutationEnabled: true,
    sprint: sprintName,
    capacities: { Alpha: 5.5, Beta: 0 },
    entries: [
        { teamName: 'Alpha', issueKey: 'CAP-101', capacity: 5.5 },
        { teamName: 'Beta', issueKey: 'CAP-102', capacity: 0 },
        { teamName: 'Gamma', issueKey: 'CAP-103', capacity: null },
    ],
};

const nextCapacityPayload = {
    enabled: true,
    mutationEnabled: true,
    sprint: nextSprintName,
    capacities: { Alpha: 6, Beta: 1, Gamma: 0 },
    entries: [
        { teamName: 'Alpha', issueKey: 'CAP-201', capacity: 6 },
        { teamName: 'Beta', issueKey: 'CAP-202', capacity: 1 },
        { teamName: 'Gamma', issueKey: 'CAP-203', capacity: 0 },
    ],
};

async function installCapacityFixture(page, options = {}) {
    const fixtureData = options.teamCount
        ? buildCapacityFixtureData(options.teamCount, options.longTeamLabel, options.actionlessLongTeam)
        : null;
    const calls = [];
    const state = {
        authMode: options.authMode || 'atlassian_oauth',
        jiraUrl: options.jiraUrl === undefined ? 'https://jira.example/' : options.jiraUrl,
        capacityProject: options.capacityProject === undefined ? 'CAP' : options.capacityProject,
        capacityConfigRequiresResolution: options.capacityConfigRequiresResolution === true,
        capacityPayload: structuredClone(options.capacityPayload || fixtureData?.capacityPayload || capacityPayload),
        nextCapacityPayload: structuredClone(options.nextCapacityPayload || fixtureData?.nextCapacityPayload || {
            enabled: true, mutationEnabled: true, sprint: nextSprintName, capacities: {}, entries: [],
        }),
        stories: fixtureData?.stories || stories,
        nextStories: fixtureData?.nextStories || nextStories,
        selectedKeys: fixtureData?.selectedKeys || selectedKeys,
        teamNames: fixtureData?.teamNames || ['Alpha', 'Beta', 'Gamma'],
        capacityGetStatus: options.capacityGetStatus || 200,
        capacityGetGate: null,
        patchResponse: options.patchResponse || ((body, issueKey) => ({
            issueKey,
            teamName: body.teamName,
            previousCapacity: body.expectedCapacity,
            capacity: body.capacity,
            result: 'success',
        })),
        patchStatus: options.patchStatus || 200,
    };

    if (options.controlCapacityPatches || options.controlCapacityReads) {
        await page.addInitScript(({ controlPatches, controlReads }) => {
            const nativeFetch = window.fetch.bind(window);
            const pendingPatches = [];
            const pendingReads = [];
            window.__capacityPatchTest = {
                requests: [],
                pending: pendingPatches,
                settle(index, body, status = 200) {
                    const request = pendingPatches[index];
                    if (!request || request.settled) throw new Error(`No unsettled capacity PATCH ${index}`);
                    request.settled = true;
                    request.resolve(new Response(JSON.stringify(body), {
                        status,
                        headers: { 'Content-Type': 'application/json' },
                    }));
                },
            };
            window.__capacityReadTest = {
                enabled: false,
                requests: [],
                pending: pendingReads,
                settle(index, body, status = 200) {
                    const request = pendingReads[index];
                    if (!request || request.settled) throw new Error(`No unsettled capacity GET ${index}`);
                    request.settled = true;
                    request.resolve(new Response(JSON.stringify(body), {
                        status,
                        headers: { 'Content-Type': 'application/json' },
                    }));
                },
            };
            window.fetch = (input, init = {}) => {
                const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
                const method = String(init.method || input?.method || 'GET').toUpperCase();
                if (controlPatches && method === 'PATCH' && url.pathname.startsWith('/api/capacity/')) {
                    const request = {
                        pathname: url.pathname,
                        body: JSON.parse(init.body || '{}'),
                        settled: false,
                    };
                    window.__capacityPatchTest.requests.push(request);
                    return new Promise(resolve => {
                        request.resolve = resolve;
                        pendingPatches.push(request);
                    });
                }
                if (
                    controlReads
                    && window.__capacityReadTest.enabled
                    && method === 'GET'
                    && url.pathname === '/api/capacity'
                ) {
                    const request = {
                        sprintName: url.searchParams.get('sprint'),
                        settled: false,
                    };
                    window.__capacityReadTest.requests.push(request);
                    return new Promise(resolve => {
                        request.resolve = resolve;
                        pendingReads.push(request);
                    });
                }
                return nativeFetch(input, init);
            };
        }, {
            controlPatches: Boolean(options.controlCapacityPatches),
            controlReads: Boolean(options.controlCapacityReads),
        });
    }

    await installDashboardShell(page);
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
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const body = requestBody(request);
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
            headers: request.headers(),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-capacity' });
        if (url.pathname === '/api/analytics/context') {
            return json(route, { enabled: true, measurementId: 'G-SYNTHETIC' });
        }
        if (url.pathname === '/api/me/connections/home-token') {
            return json(route, { connected: false, status: 'missing', needsReconnect: false });
        }
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: state.jiraUrl,
                capacityProject: state.capacityProject,
                capacityConfigRequiresResolution: state.capacityConfigRequiresResolution,
                authMode: state.authMode,
                projectsConfigured: true,
                environmentConfigExists: true,
                settingsAdminOnly: true,
                userCanEditSettings: false,
                userCanEditEpmConfig: false,
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json(route, {
                version: 1,
                configRevision: 1,
                source: 'workspace_db',
                defaultGroupId: 'group-capacity',
                groups: [{
                    id: 'group-capacity',
                    name: 'Capacity Department',
                    teamIds: state.stories.map(issue => issue.fields.teamId),
                    labels: ['capacity_test'],
                    excludedCapacityEpics: [],
                }],
                preferences: {
                    onboardingRequired: false,
                    customized: true,
                    visibleGroupIds: ['group-capacity'],
                    effectiveVisibleGroupIds: ['group-capacity'],
                    activeGroupId: 'group-capacity',
                },
            });
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '1', boardName: 'Synthetic' });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [] });
        if (url.pathname === '/api/sprints') {
            return json(route, { sprints: [
                { id: sprintId, name: sprintName, state: 'active' },
                { id: nextSprintId, name: nextSprintName, state: 'future' },
            ] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const purpose = url.searchParams.get('purpose');
            const project = url.searchParams.get('project');
            const requestedSprint = url.searchParams.get('sprint');
            const issuesBySprint = {
                [sprintId]: state.stories,
                [nextSprintId]: state.nextStories,
            };
            const issues = !purpose && project === 'product'
                ? (issuesBySprint[String(requestedSprint)] || [])
                : [];
            const epic = {
                key: 'PLAN-EPIC', summary: 'Synthetic planning epic', status: { name: 'In Progress' },
                teamId: 'team-alpha', teamName: 'Alpha', labels: ['capacity_test'],
            };
            return json(route, {
                issues,
                epics: issues.length ? { [epic.key]: epic } : {},
                epicsInScope: issues.length ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/capacity' && request.method() === 'GET') {
            if (state.capacityGetGate) await state.capacityGetGate;
            const payload = String(url.searchParams.get('sprint')) === nextSprintName
                ? state.nextCapacityPayload
                : state.capacityPayload;
            return json(route, payload, state.capacityGetStatus);
        }
        if (url.pathname.startsWith('/api/capacity/') && request.method() === 'PATCH') {
            const issueKey = decodeURIComponent(url.pathname.split('/').pop());
            const response = await (typeof state.patchResponse === 'function'
                ? state.patchResponse(body, issueKey, calls)
                : state.patchResponse);
            return json(route, response, state.patchStatus);
        }
        return json(route, {});
    });

    await page.addInitScript(({ prefs, scopeKey, nextScopeKey, keys }) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
        window.localStorage.setItem('jira_dashboard_planning_state_v1', JSON.stringify({
            [scopeKey]: { selectedTaskKeys: keys, selectedTeams: ['all'], selectionMode: 'manual' },
            [nextScopeKey]: { selectedTaskKeys: keys, selectedTeams: ['all'], selectionMode: 'manual' },
        }));
    }, {
        prefs: {
            selectedView: 'eng', selectedSprint: sprintId, sprintName,
            activeGroupId: 'group-capacity', showPlanning: true, showScenario: false,
            showStats: false, showBoard: false, selectedTeams: ['all'],
            ...(options.prefs || {}),
        },
        scopeKey: planningScopeKey,
        nextScopeKey: `planning::${nextSprintId}::group-capacity`,
        keys: state.selectedKeys,
    });
    return { calls, state };
}

async function openPlanning(page, options = {}) {
    const fixture = await installCapacityFixture(page, options);
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(options.teamCount || 3);
    return fixture;
}

function capacityCalls(calls, method) {
    return calls.filter(call => call.method === method && (
        call.pathname === '/api/capacity' || call.pathname.startsWith('/api/capacity/')
    ));
}

async function selectSprint(page, name) {
    const toggle = page.locator('.sprint-dropdown-toggle').first();
    await toggle.click();
    if (await page.locator('.sprint-dropdown-option').count() === 0) await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: name }).click();
}

async function expectSolidAccentFocus(page, locator) {
    const focusStyle = await locator.evaluate(node => {
        const style = getComputedStyle(node);
        return {
            focusVisible: node.matches(':focus-visible'),
            outlineColor: style.outlineColor,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
        };
    });
    const accentColor = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    const diagnostic = JSON.stringify(focusStyle);
    expect(focusStyle.focusVisible, diagnostic).toBe(true);
    expect(focusStyle.outlineColor, diagnostic).toBe(accentColor);
    expect(focusStyle.outlineStyle, diagnostic).toBe('solid');
    expect(focusStyle.outlineWidth, diagnostic).toBe('2px');
}

async function captureCapacityScreenshot(page, testInfo, name, options = {}) {
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await Promise.race([
            Promise.all(document.getAnimations({ subtree: true })
                .map(animation => animation.finished.catch(() => undefined))),
            new Promise(resolve => window.setTimeout(resolve, 1200)),
        ]);
    });
    fs.mkdirSync(capacityArtifactDir, { recursive: true });
    await page.screenshot({ path: path.join(capacityArtifactDir, `${name}.png`), fullPage: Boolean(options.fullPage) });
}

test('capacity hover reveals safe Jira and edit controls without changing the idle cards', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);

    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    const rail = card.locator('.team-capacity-action-rail');
    await expect(rail).toHaveCount(1);
    const idle = await rail.evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        pointerEvents: getComputedStyle(node).pointerEvents,
    }));
    expect(idle).toEqual({ opacity: '0', pointerEvents: 'none' });

    const before = await card.boundingBox();
    await card.hover();
    await expect(rail).toHaveCSS('opacity', '1');
    await expect(rail).toHaveCSS('pointer-events', 'auto');
    await expect(rail.locator('a,button')).toHaveCount(2);

    const jira = card.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' });
    const pencil = card.getByRole('button', { name: 'Edit Alpha capacity' });
    await expect(jira).toHaveAttribute('href', 'https://jira.example/browse/CAP-101');
    await expect(jira).toHaveAttribute('target', '_blank');
    await expect(jira).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(pencil).toBeEnabled();
    await expect(pencil).toHaveClass(/icon-button--sm/);
    const railActionGeometry = await Promise.all([jira, pencil].map(action => action.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    })));
    expect(railActionGeometry).toEqual([
        { width: 24, height: 24 },
        { width: 24, height: 24 },
    ]);

    const geometry = await card.evaluate((node) => {
        const railRect = node.querySelector('.team-capacity-action-rail').getBoundingClientRect();
        const barRect = node.querySelector('.microbar').getBoundingClientRect();
        return { gap: barRect.top - railRect.bottom };
    });
    expect(geometry.gap).toBeGreaterThan(0);
    expect(await card.boundingBox()).toEqual(before);

    await jira.evaluate((link) => {
        link.addEventListener('click', event => event.preventDefault(), { capture: true, once: true });
        link.click();
    });
    await expect.poll(() => page.evaluate(() => window.dataLayer?.some(entry => (
        entry.event_name === 'external_link_opened'
        && entry.link_type === 'jira_issue_browse'
        && entry.source_surface === 'planning'
    )))).toBe(true);
    const analyticsPayload = await page.evaluate(() => window.dataLayer.find(entry => (
        entry.event_name === 'external_link_opened'
        && entry.link_type === 'jira_issue_browse'
        && entry.source_surface === 'planning'
    )));
    expect(JSON.stringify(analyticsPayload)).not.toContain('CAP-101');
    expect(JSON.stringify(analyticsPayload)).not.toContain('Alpha');

    for (const invalidBase of ['', 'jira.example', '//jira.example', 'ftp://jira.example']) {
        fixture.state.jiraUrl = invalidBase;
        await page.reload({ waitUntil: 'networkidle' });
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(3);
        const invalidCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
        await expect(invalidCard.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' })).toHaveCount(0);
        await expect(invalidCard.getByRole('button', { name: 'Edit Alpha capacity' })).toHaveCount(1);
    }
});

test('capacity Jira links discard configured query and fragment and reject credentials', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page, {
        jiraUrl: 'https://jira.example/legacy/path?source=config#capacity',
    });
    const linkName = 'Open Alpha capacity ticket in Jira';
    const alphaCard = () => page.locator('.team-stat-card', { hasText: 'Alpha' });

    const sanitizedLink = alphaCard().getByRole('link', { name: linkName });
    await expect(sanitizedLink).toHaveAttribute('href', 'https://jira.example/browse/CAP-101');
    const sanitizedParts = await sanitizedLink.evaluate(node => {
        const url = new URL(node.href);
        return { pathname: url.pathname, search: url.search, hash: url.hash };
    });
    expect(sanitizedParts).toEqual({ pathname: '/browse/CAP-101', search: '', hash: '' });

    fixture.state.jiraUrl = 'https://jira.example?source=config#capacity';
    await page.reload({ waitUntil: 'networkidle' });
    await expect(alphaCard().getByRole('link', { name: linkName }))
        .toHaveAttribute('href', 'https://jira.example/browse/CAP-101');

    for (const credentialBase of [
        'https://user@jira.example',
        'https://user:password@jira.example/path?source=config#capacity',
    ]) {
        fixture.state.jiraUrl = credentialBase;
        await page.reload({ waitUntil: 'networkidle' });
        await expect(alphaCard().getByRole('link', { name: linkName })).toHaveCount(0);
    }
});

test('capacity Jira pencil Save and Cancel expose solid accent keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    const rail = card.locator('.team-capacity-action-rail');
    const jira = card.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' });
    const pencil = card.getByRole('button', { name: 'Edit Alpha capacity' });

    await pencil.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(jira).toBeFocused();
    await expectSolidAccentFocus(page, jira);
    await expect(rail).toHaveCSS('opacity', '1');
    await expect(rail).toHaveCSS('pointer-events', 'auto');
    const focusGeometry = await card.evaluate(node => {
        const railRect = node.querySelector('.team-capacity-action-rail').getBoundingClientRect();
        const barRect = node.querySelector('.microbar').getBoundingClientRect();
        return { gap: barRect.top - railRect.bottom, railHeight: railRect.height };
    });
    expect(focusGeometry.gap).toBeGreaterThan(0);
    expect(focusGeometry.railHeight).toBe(24);

    await page.keyboard.press('Tab');
    await expect(pencil).toBeFocused();
    await expectSolidAccentFocus(page, pencil);
    await page.keyboard.press('Enter');

    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await expect(input).toBeFocused();
    await input.fill('6');
    await page.keyboard.press('Tab');
    const save = card.getByRole('button', { name: 'Save Alpha capacity' });
    await expect(save).toBeFocused();
    await expectSolidAccentFocus(page, save);
    await page.keyboard.press('Tab');
    const cancel = card.getByRole('button', { name: 'Cancel Alpha capacity edit' });
    await expect(cancel).toBeFocused();
    await expectSolidAccentFocus(page, cancel);

    const editorGeometry = await card.locator('.team-capacity-editor-row').evaluate(row => (
        [...row.querySelectorAll('button')].map(node => ({
            height: node.getBoundingClientRect().height,
            top: node.getBoundingClientRect().top,
        }))
    ));
    expect(editorGeometry.map(item => item.height)).toEqual([28, 28]);
    expect(Math.round(editorGeometry[0].top)).toBe(Math.round(editorGeometry[1].top));
});

test('capacity edit and cancel keep one accessible 28px editor and restore focus', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const { calls } = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    const originalBox = await card.boundingBox();

    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(1);
    await expect(page.locator('.team-capacity-action-rail')).toHaveCount(0);
    await expect(card.locator('.microbar')).toHaveCount(0);
    await expect(page.locator('.microbar')).toHaveCount(2);

    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('5.5');
    const save = card.getByRole('button', { name: 'Save Alpha capacity' });
    const cancel = card.getByRole('button', { name: 'Cancel Alpha capacity edit' });
    await expect(save).toHaveClass(/icon-button--md/);
    await expect(cancel).toHaveClass(/icon-button--md/);
    await expect(save).toBeDisabled();
    await input.fill('');
    await expect(save).toBeDisabled();
    await input.fill('-1');
    await expect(save).toBeDisabled();
    await input.fill('6');
    await expect(save).toBeEnabled();

    const controls = await card.locator('.team-capacity-editor-row').evaluate((row) => {
        const nodes = [row.querySelector('input'), ...row.querySelectorAll('button')];
        const rects = nodes.map(node => node.getBoundingClientRect());
        return {
            heights: rects.map(rect => rect.height),
            tops: rects.map(rect => rect.top),
            inputWidth: rects[0].width,
            cardRight: row.closest('.team-stat-card').getBoundingClientRect().right,
            lastRight: rects[rects.length - 1].right,
        };
    });
    expect(controls.heights).toEqual([28, 28, 28]);
    expect(new Set(controls.tops.map(value => Math.round(value))).size).toBe(1);
    expect(controls.inputWidth).toBeLessThanOrEqual(84);
    expect(controls.lastRight).toBeLessThanOrEqual(controls.cardRight);

    await cancel.click();
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Edit Alpha capacity' })).toBeFocused();
    expect(capacityCalls(calls, 'PATCH')).toHaveLength(0);
    expect((await card.boundingBox()).width).toBe(originalBox.width);

    const gammaCard = page.locator('.team-stat-card', { hasText: 'Gamma' });
    await gammaCard.hover();
    await gammaCard.getByRole('button', { name: 'Edit Gamma capacity' }).click();
    const blankInput = gammaCard.getByRole('spinbutton', { name: 'Gamma Jira total planned capacity' });
    await expect(blankInput).toHaveValue('');
    await blankInput.press('Escape');
    await expect(gammaCard.getByRole('button', { name: 'Edit Gamma capacity' })).toBeFocused();
    expect(capacityCalls(calls, 'PATCH')).toHaveLength(0);

    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    await page.locator('.planning-team-capacity-heading').click();
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    expect(capacityCalls(calls, 'PATCH')).toHaveLength(0);
});

test('capacity save and conflict use the canonical four-field request and retain the draft', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('6.5');

    fixture.state.patchStatus = 409;
    fixture.state.patchResponse = { error: 'capacity_conflict', currentCapacity: 7 };
    await input.press('Enter');
    await expect(card.getByRole('status')).toContainText('Capacity changed in Jira to 7');
    await expect(input).toHaveValue('6.5');

    fixture.state.patchStatus = 200;
    fixture.state.patchResponse = (body, issueKey) => ({
        issueKey, teamName: body.teamName, previousCapacity: body.expectedCapacity,
        capacity: body.capacity, result: 'success',
    });
    await card.getByRole('button', { name: 'Save Alpha capacity' }).click();
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);

    const patchCalls = capacityCalls(fixture.calls, 'PATCH');
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[0].body).toEqual({
        sprintName, teamName: 'Alpha', expectedCapacity: 5.5, capacity: 6.5,
    });
    expect(patchCalls[1].body).toEqual({
        sprintName, teamName: 'Alpha', expectedCapacity: 7, capacity: 6.5,
    });
    expect(capacityCalls(fixture.calls, 'GET')).toHaveLength(1);
    const savedCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await expect(savedCard.locator('.microbar-meta')).toContainText('Cap 6.5');
    await expect(savedCard.getByRole('button', { name: 'Edit Alpha capacity' })).toBeFocused();
});

test('capacity save uses the canonical alias target and ambiguous aliases expose no actions', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const aliasPayload = {
        enabled: true,
        mutationEnabled: true,
        sprint: sprintName,
        capacities: { 'Alpha Core': 5.5, Beta: 0 },
        entries: [
            { teamName: 'Alpha Core', issueKey: 'CAP-201', capacity: 5.5 },
            { teamName: 'Beta', issueKey: 'CAP-102', capacity: 0 },
            { teamName: 'Gamma', issueKey: 'CAP-103', capacity: null },
        ],
    };
    const fixture = await openPlanning(page, { capacityPayload: aliasPayload });
    const alphaCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await alphaCard.hover();
    await alphaCard.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = alphaCard.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await expect(input).toHaveValue('5.5');
    await input.fill('6');
    await input.press('Enter');
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    expect(capacityCalls(fixture.calls, 'PATCH').at(-1).body).toEqual({
        sprintName,
        teamName: 'Alpha Core',
        expectedCapacity: 5.5,
        capacity: 6,
    });

    fixture.state.capacityPayload = {
        ...aliasPayload,
        capacities: { 'Alpha Core': 5.5, 'Alpha Platform': 7, Beta: 0 },
        entries: [
            { teamName: 'Alpha Core', issueKey: 'CAP-201', capacity: 5.5 },
            { teamName: 'Alpha Platform', issueKey: 'CAP-202', capacity: 7 },
            { teamName: 'Beta', issueKey: 'CAP-102', capacity: 0 },
            { teamName: 'Gamma', issueKey: 'CAP-103', capacity: null },
        ],
    };
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    await expect.poll(() => capacityCalls(fixture.calls, 'GET').length).toBeGreaterThan(1);
    const refreshedAlpha = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await expect(refreshedAlpha.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' })).toHaveCount(0);
    await expect(refreshedAlpha.getByRole('button', { name: 'Edit Alpha capacity' })).toHaveCount(0);
});

test('capacity save pending state prevents duplicate submit and cancellation', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    let resolvePatch;
    const patchGate = new Promise(resolve => { resolvePatch = resolve; });
    const fixture = await openPlanning(page, { patchResponse: () => patchGate });
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('9');
    await input.press('Enter');
    await expect(card.locator('form.team-capacity-editor')).toHaveAttribute('aria-busy', 'true');
    await expect(input).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Saving Alpha capacity' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Cancel Alpha capacity edit' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.locator('.planning-team-capacity-heading').click();
    await expect(card.locator('form.team-capacity-editor')).toHaveCount(1);
    expect(capacityCalls(fixture.calls, 'PATCH')).toHaveLength(1);

    resolvePatch({
        issueKey: 'CAP-101', teamName: 'Alpha', previousCapacity: 5.5,
        capacity: 9, result: 'success',
    });
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    expect(capacityCalls(fixture.calls, 'PATCH')).toHaveLength(1);
});

test('an aborted old PATCH cannot release the next scope editor pending lock', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    await openPlanning(page, {
        controlCapacityPatches: true,
        nextCapacityPayload,
    });

    const firstCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await firstCard.hover();
    await firstCard.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const firstInput = firstCard.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await firstInput.fill('6');
    await firstInput.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__capacityPatchTest.requests.length)).toBe(1);

    await selectSprint(page, nextSprintName);
    await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(3);
    const nextCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await nextCard.hover();
    await nextCard.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const nextInput = nextCard.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await nextInput.fill('7');
    await nextInput.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__capacityPatchTest.requests.length)).toBe(2);
    await expect(nextCard.locator('form.team-capacity-editor')).toHaveAttribute('aria-busy', 'true');

    await page.evaluate(() => window.__capacityPatchTest.settle(0, {
        issueKey: 'CAP-101', teamName: 'Alpha', previousCapacity: 5.5,
        capacity: 6, result: 'success',
    }));
    await expect(nextCard.locator('form.team-capacity-editor')).toHaveAttribute('aria-busy', 'true');
    await page.locator('.planning-team-capacity-heading').click();
    await page.keyboard.press('Escape');
    await expect(nextCard.locator('form.team-capacity-editor')).toHaveCount(1);
    await expect(nextInput).toBeDisabled();

    await page.evaluate(() => window.__capacityPatchTest.settle(1, {
        issueKey: 'CAP-201', teamName: 'Alpha', previousCapacity: 6,
        capacity: 7, result: 'success',
    }));
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    await expect(page.locator('.team-stat-card', { hasText: 'Alpha' }).locator('.microbar-meta'))
        .toContainText('Cap 7.0');
});

test('old GET and PATCH settlements in the scope-switch turn cannot replace the new scope', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    await openPlanning(page, {
        controlCapacityPatches: true,
        controlCapacityReads: true,
        nextCapacityPayload,
    });
    const alphaCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await alphaCard.hover();
    await alphaCard.getByRole('button', { name: 'Edit Alpha capacity' }).click();

    await page.evaluate(() => { window.__capacityReadTest.enabled = true; });
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    await expect.poll(() => page.evaluate(() => window.__capacityReadTest.requests.length)).toBe(1);

    const input = alphaCard.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('9');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__capacityPatchTest.requests.length)).toBe(1);

    const sprintToggle = page.locator('.sprint-dropdown-toggle').first();
    await sprintToggle.click();
    await page.evaluate(({ name, lateRead }) => {
        const option = [...document.querySelectorAll('.sprint-dropdown-option')]
            .find(node => node.textContent.includes(name));
        if (!option) throw new Error(`Missing sprint option ${name}`);
        option.click();
        window.__capacityReadTest.settle(0, lateRead);
        window.__capacityPatchTest.settle(0, {
            issueKey: 'CAP-101', teamName: 'Alpha', previousCapacity: 5.5,
            capacity: 9, result: 'success',
        });
    }, {
        name: nextSprintName,
        lateRead: {
            enabled: true,
            mutationEnabled: true,
            sprint: sprintName,
            capacities: { Alpha: 50 },
            entries: [{ teamName: 'Alpha', issueKey: 'CAP-999', capacity: 50 }],
        },
    });

    await expect.poll(() => page.evaluate(name => (
        window.__capacityReadTest.requests.some(request => request.sprintName === name)
    ), nextSprintName)).toBe(true);
    await page.evaluate(({ name, payload }) => {
        window.__capacityReadTest.enabled = false;
        window.__capacityReadTest.requests.forEach((request, index) => {
            if (request.sprintName === name && !request.settled) {
                window.__capacityReadTest.settle(index, payload);
            }
        });
    }, { name: nextSprintName, payload: nextCapacityPayload });
    await expect(sprintToggle).toContainText(nextSprintName);
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    const nextAlpha = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await expect(nextAlpha.locator('.microbar-meta')).toContainText('Cap 6.0');
    await nextAlpha.hover();
    await expect(nextAlpha.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' }))
        .toHaveAttribute('href', 'https://jira.example/browse/CAP-201');
    await expect(page.getByText('Cap 50.0', { exact: false })).toHaveCount(0);
});

test('capacity auth expiry preserves the draft behind the global safe recovery gate', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('8');

    fixture.state.patchStatus = 401;
    fixture.state.patchResponse = { error: 'auth_required', loginUrl: '/login?reason=session_expired' };
    await input.press('Enter');
    const gate = page.getByRole('alertdialog');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login?reason=session_expired');
    await expect(card.locator('input.team-capacity-input')).toHaveValue('8');
    expect(new URL(page.url()).pathname).toBe('/');
});

test('capacity config errors preserve drafts without retry', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    fixture.state.patchStatus = 409;
    fixture.state.patchResponse = { error: 'capacity_config_missing' };
    await input.fill('8.5');
    const save = card.getByRole('button', { name: 'Save Alpha capacity' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(card.getByRole('status')).toContainText('Capacity editing is no longer configured');
    const requestCount = capacityCalls(fixture.calls, 'PATCH').length;
    await input.press('Enter');
    await expect.poll(() => capacityCalls(fixture.calls, 'PATCH').length).toBe(requestCount);
    await expect(input).toHaveValue('8.5');
});

test('unresolved bootstrap config still loads Capacity and exposes retry recovery', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page, {
        capacityProject: '',
        capacityConfigRequiresResolution: true,
        capacityGetStatus: 409,
        capacityPayload: { error: 'capacity_config_conflict' },
    });

    await expect(page.getByRole('button', { name: 'Retry capacity' })).toBeVisible();
    expect(capacityCalls(fixture.calls, 'GET')).toHaveLength(1);
});

test('capacity scope reread blocks a remapped open editor and shows stale retry state', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('8');

    fixture.state.capacityPayload.entries[0] = { teamName: 'Alpha', issueKey: 'CAP-999', capacity: 5.5 };
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    await expect(card.getByRole('status')).toContainText('different Jira capacity ticket');
    await expect(card.getByRole('button', { name: 'Save Alpha capacity' })).toBeDisabled();
    await input.press('Enter');
    expect(capacityCalls(fixture.calls, 'PATCH')).toHaveLength(0);

    await card.getByRole('button', { name: 'Cancel Alpha capacity edit' }).click();
    fixture.state.capacityGetStatus = 500;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    await expect(page.locator('.team-capacity-read-status')).toContainText('Showing last loaded values');
    await expect(page.getByRole('button', { name: 'Retry capacity' })).toBeEnabled();
    await expect(page.locator('.team-capacity-action-rail')).toHaveCount(0);
    await expect(page.locator('.team-stat-card', { hasText: 'Alpha' }).locator('.microbar-meta')).toContainText('Cap 5.5');
});

test('capacity edit explains adjusted Product-only capacity as Jira total capacity', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    await openPlanning(page, { prefs: { showProduct: true, showTech: false } });
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const capacityInput = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await expect(capacityInput).toHaveValue('5.5');
    await expect(capacityInput).toHaveAttribute('aria-label', 'Alpha Jira total planned capacity');
    await expect(card.locator('.team-capacity-editor-context')).toContainText('Product 70%');
    await expect(capacityInput).toHaveAccessibleDescription('Planning Product share 70%');
});

for (const { name, prefs, shareLabel } of [
    { name: 'Product-only', prefs: { showProduct: true, showTech: false }, shareLabel: 'Planning Product share 70%' },
    { name: 'Tech-only', prefs: { showProduct: false, showTech: true }, shareLabel: 'Planning Tech share 30%' },
]) {
    test(`adjusted ${name} editor context stays inside the Task 0 card baseline while submitting`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1028, height: 720 });
        const fixture = await openPlanning(page, {
            prefs,
            patchResponse: () => new Promise(() => {}),
        });
        const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
        const baseline = await card.evaluate(node => node.getBoundingClientRect().height);
        await card.hover();
        await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
        const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
        const context = card.locator('.team-capacity-editor-context');
        await expect(context).toHaveAttribute('role', 'note');
        await expect(input).toHaveAttribute('aria-describedby', await context.getAttribute('id'));
        await expect(input).toHaveAccessibleDescription(shareLabel);
        const editorGeometry = await card.evaluate(node => {
            const cardRect = node.getBoundingClientRect();
            const context = node.querySelector('.team-capacity-editor-context');
            const controls = [...node.querySelectorAll('.team-capacity-editor-row input, .team-capacity-editor-row button')]
                .map(control => control.getBoundingClientRect());
            return {
                card: cardRect,
                context: context.getBoundingClientRect(),
                contextScrollWidth: context.scrollWidth,
                contextClientWidth: context.clientWidth,
                contextScrollHeight: context.scrollHeight,
                contextClientHeight: context.clientHeight,
                controls,
            };
        });
        expect(Math.abs(editorGeometry.card.height - baseline), `${name} editor keeps Task 0 baseline`).toBeLessThanOrEqual(1);
        expect(editorGeometry.context.left).toBeGreaterThanOrEqual(editorGeometry.card.left);
        expect(editorGeometry.context.right).toBeLessThanOrEqual(editorGeometry.card.right);
        expect(editorGeometry.context.top).toBeGreaterThanOrEqual(editorGeometry.card.top);
        expect(editorGeometry.context.bottom).toBeLessThanOrEqual(editorGeometry.card.bottom);
        expect(editorGeometry.contextScrollWidth).toBeLessThanOrEqual(editorGeometry.contextClientWidth);
        expect(editorGeometry.contextScrollHeight).toBeLessThanOrEqual(editorGeometry.contextClientHeight);
        expect(editorGeometry.controls.map(rect => rect.height)).toEqual([28, 28, 28]);
        expect(new Set(editorGeometry.controls.map(rect => Math.round(rect.top))).size).toBe(1);
        await captureCapacityScreenshot(page, testInfo, `capacity-${name.toLowerCase()}-share-editor`);

        await input.fill('6');
        await input.press('Enter');
        await expect(card.locator('form.team-capacity-editor')).toHaveAttribute('aria-busy', 'true');
        const submittingHeight = await card.evaluate(node => node.getBoundingClientRect().height);
        expect(Math.abs(submittingHeight - baseline), `${name} submitting keeps Task 0 baseline`).toBeLessThanOrEqual(1);
        await expect.poll(() => capacityCalls(fixture.calls, 'PATCH').length).toBe(1);
    });
}

test('long actionless capacity labels never reserve the action rail footprint on hover or touch', async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlanning(page, { teamCount: 1, longTeamLabel: true, actionlessLongTeam: true });
    const desktopCard = page.locator('.planning-team-capacity-cards .team-stat-card');
    await expect(desktopCard.locator('.team-capacity-action-rail')).toHaveCount(0);
    const desktopLabelRow = desktopCard.locator('.team-capacity-label-row');
    await desktopCard.hover();
    const desktopGeometry = await desktopLabelRow.evaluate(row => ({
        paddingRight: Number.parseFloat(getComputedStyle(row).paddingRight),
        label: row.querySelector('.team-stat-label').getBoundingClientRect(),
        row: row.getBoundingClientRect(),
        scrollWidth: row.querySelector('.team-stat-label').scrollWidth,
        clientWidth: row.querySelector('.team-stat-label').clientWidth,
    }));
    expect(desktopGeometry.paddingRight, 'actionless desktop label rail padding').toBe(0);
    expect(desktopGeometry.label.right).toBeLessThanOrEqual(desktopGeometry.row.right);
    expect(desktopGeometry.scrollWidth).toBeLessThanOrEqual(desktopGeometry.clientWidth);

    const touchContext = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 720 } });
    const touchPage = await touchContext.newPage();
    try {
        await openPlanning(touchPage, { teamCount: 1, longTeamLabel: true, actionlessLongTeam: true });
        const touchCard = touchPage.locator('.planning-team-capacity-cards .team-stat-card');
        const touchGeometry = await touchCard.locator('.team-capacity-label-row').evaluate(row => ({
            paddingRight: Number.parseFloat(getComputedStyle(row).paddingRight),
            label: row.querySelector('.team-stat-label').getBoundingClientRect(),
            row: row.getBoundingClientRect(),
            scrollWidth: row.querySelector('.team-stat-label').scrollWidth,
            clientWidth: row.querySelector('.team-stat-label').clientWidth,
            textOverflow: getComputedStyle(row.querySelector('.team-stat-label')).textOverflow,
        }));
        await expect(touchCard.locator('.team-capacity-action-rail')).toHaveCount(0);
        expect(touchGeometry.paddingRight, 'actionless touch label rail padding').toBe(0);
        expect(touchGeometry.label.right).toBeLessThanOrEqual(touchGeometry.row.right);
        expect(touchGeometry.scrollWidth).toBeGreaterThan(touchGeometry.clientWidth);
        expect(touchGeometry.textOverflow).toBe('ellipsis');
    } finally {
        await touchContext.close();
    }
});

test('hoverless touch keeps the capacity Jira and pencil controls visible and operable', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 720 } });
    const touchPage = await context.newPage();
    try {
        await openPlanning(touchPage);
        expect(await touchPage.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
        const card = touchPage.locator('.team-stat-card', { hasText: 'Alpha' });
        const rail = card.locator('.team-capacity-action-rail');
        await expect(rail).toHaveCSS('opacity', '1');
        await expect(rail).toHaveCSS('pointer-events', 'auto');
        await expect(card.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' })).toBeVisible();
        const touchGeometry = await card.evaluate(node => {
            const cardRect = node.getBoundingClientRect();
            const actionRects = [...node.querySelectorAll('.team-capacity-action')]
                .map(action => action.getBoundingClientRect());
            return { cardRect, actionRects };
        });
        touchGeometry.actionRects.forEach(rect => {
            expect(rect.left).toBeGreaterThanOrEqual(touchGeometry.cardRect.left);
            expect(rect.right).toBeLessThanOrEqual(touchGeometry.cardRect.right);
            expect(rect.bottom).toBeLessThanOrEqual(touchGeometry.cardRect.bottom);
        });
        await touchPage.screenshot({ path: path.join(capacityArtifactDir, 'capacity-hoverless-touch.png'), fullPage: true, timeout: 5000 });
        await card.evaluate(node => {
            window.scrollTo(0, Math.max(0, window.scrollY + node.getBoundingClientRect().top - 160));
        });
        await card.getByRole('button', { name: 'Edit Alpha capacity' }).tap({ timeout: 5000 });
        await expect(card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' })).toBeFocused();
        await expect(touchPage.locator('.team-capacity-action-rail')).toHaveCount(0);
    } finally {
        await touchPage.close();
    }
});

test('a successful reread that disables mutation locks the open draft but keeps the safe Jira link', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('8');

    fixture.state.capacityPayload.mutationEnabled = false;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    await expect(card.getByRole('status')).toContainText('Capacity editing is unavailable');
    await expect(input).toHaveValue('8');
    await expect(card.getByRole('button', { name: 'Save Alpha capacity' })).toBeDisabled();
    await input.press('Enter');
    expect(capacityCalls(fixture.calls, 'PATCH')).toHaveLength(0);

    await card.getByRole('button', { name: 'Cancel Alpha capacity edit' }).click();
    await card.hover();
    await expect(card.getByRole('link', { name: 'Open Alpha capacity ticket in Jira' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edit Alpha capacity' })).toHaveCount(0);
});

test('capacity Retry is busy and duplicate-safe until its one GET settles', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    fixture.state.capacityGetStatus = 500;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    const retry = page.getByRole('button', { name: 'Retry capacity' });
    await expect(retry).toBeEnabled();

    let resolveGet;
    fixture.state.capacityGetStatus = 200;
    fixture.state.capacityGetGate = new Promise(resolve => { resolveGet = resolve; });
    const beforeRetry = capacityCalls(fixture.calls, 'GET').length;
    await retry.click();
    const busyRetry = page.getByRole('button', { name: 'Retrying capacity' });
    await expect(busyRetry).toBeDisabled();
    await expect(busyRetry).toHaveText('Retrying capacity');
    await expect(page.locator('.team-capacity-read-status')).toHaveAttribute('aria-busy', 'true');
    await busyRetry.evaluate(button => {
        button.click();
        button.click();
    });
    expect(capacityCalls(fixture.calls, 'GET')).toHaveLength(beforeRetry + 1);

    fixture.state.capacityGetGate = null;
    resolveGet();
    await expect(page.locator('.team-capacity-read-status')).toHaveCount(0);
    expect(capacityCalls(fixture.calls, 'GET')).toHaveLength(beforeRetry + 1);
});

test('already-current saves reconcile numeric values and null conflicts keep the explicit baseline', async ({ page }) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page);
    const alphaCard = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await alphaCard.hover();
    await alphaCard.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    const alphaInput = alphaCard.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await alphaInput.fill('6');
    fixture.state.patchResponse = {
        issueKey: 'CAP-101', teamName: 'Alpha', previousCapacity: 6,
        capacity: 6, result: 'already_current',
    };
    await alphaInput.press('Enter');
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    await expect(page.locator('.team-stat-card', { hasText: 'Alpha' }).locator('.microbar-meta'))
        .toContainText('Cap 6.0');

    const gammaCard = page.locator('.team-stat-card', { hasText: 'Gamma' });
    await gammaCard.hover();
    await gammaCard.getByRole('button', { name: 'Edit Gamma capacity' }).click();
    const gammaInput = gammaCard.getByRole('spinbutton', { name: 'Gamma Jira total planned capacity' });
    await expect(gammaInput).toHaveValue('');
    await gammaInput.fill('3');
    fixture.state.patchResponse = {
        issueKey: 'CAP-103', teamName: 'Gamma', previousCapacity: 3,
        capacity: 3, result: 'already_current',
    };
    await gammaInput.press('Enter');
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    await expect(page.locator('.team-stat-card', { hasText: 'Gamma' }).locator('.microbar-meta'))
        .toContainText('Cap 3.0');

    await gammaCard.hover();
    await gammaCard.getByRole('button', { name: 'Edit Gamma capacity' }).click();
    const changedInput = gammaCard.getByRole('spinbutton', { name: 'Gamma Jira total planned capacity' });
    await changedInput.fill('4');
    fixture.state.patchStatus = 409;
    fixture.state.patchResponse = { error: 'capacity_conflict', currentCapacity: null };
    await changedInput.press('Enter');
    await expect(gammaCard.getByRole('status')).toContainText('Capacity is now blank in Jira');
    await expect(changedInput).toHaveValue('4');

    fixture.state.patchStatus = 200;
    fixture.state.patchResponse = {
        issueKey: 'CAP-103', teamName: 'Gamma', previousCapacity: 4,
        capacity: 4, result: 'already_current',
    };
    await gammaCard.getByRole('button', { name: 'Save Gamma capacity' }).click();
    await expect.poll(() => capacityCalls(fixture.calls, 'PATCH').length).toBe(4);
    const patchCalls = capacityCalls(fixture.calls, 'PATCH');
    expect(patchCalls.at(-1).body).toEqual({
        sprintName, teamName: 'Gamma', expectedCapacity: null, capacity: 4,
    });
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    await expect(page.locator('.team-stat-card', { hasText: 'Gamma' }).locator('.microbar-meta'))
        .toContainText('Cap 4.0');
});

test('capacity scope and read-only gates detach editors and keep unsafe actions unavailable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    const fixture = await openPlanning(page);
    const card = page.locator('.team-stat-card', { hasText: 'Beta' });
    await card.hover();
    await card.getByRole('button', { name: 'Edit Beta capacity' }).click();
    const input = card.getByRole('spinbutton', { name: 'Beta Jira total planned capacity' });
    await expect(input).toHaveValue('0');
    const responsive = await card.locator('.team-capacity-editor-row').evaluate((row) => {
        const inputRect = row.querySelector('input').getBoundingClientRect();
        const buttonRects = [...row.querySelectorAll('button')].map(node => node.getBoundingClientRect());
        return {
            inputWidth: inputRect.width,
            heights: [inputRect.height, ...buttonRects.map(rect => rect.height)],
            lastRight: buttonRects.at(-1).right,
            cardRight: row.closest('.team-stat-card').getBoundingClientRect().right,
        };
    });
    expect(responsive.inputWidth).toBeLessThan(84);
    expect(responsive.heights).toEqual([28, 28, 28]);
    expect(responsive.lastRight).toBeLessThanOrEqual(responsive.cardRight);

    const sprintToggle = page.locator('.sprint-dropdown-toggle').first();
    await sprintToggle.click();
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    if (await page.locator('.sprint-dropdown-option').count() === 0) {
        await sprintToggle.click();
    }
    await page.locator('.sprint-dropdown-option', { hasText: nextSprintName }).click();
    await expect(page.locator('form.team-capacity-editor')).toHaveCount(0);
    expect(capacityCalls(fixture.calls, 'PATCH')).toHaveLength(0);

    fixture.state.authMode = 'basic';
    await page.evaluate(({ id, name }) => {
        const prefs = JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}');
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            ...prefs,
            selectedSprint: id,
            sprintName: name,
        }));
    }, { id: sprintId, name: sprintName });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(3);
    await expect(page.locator('.team-capacity-action-rail')).toHaveCount(0);
});

test('an empty future sprint explains missing issues and refreshes only Capacity', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1028, height: 720 });
    const fixture = await openPlanning(page, {
        nextCapacityPayload: {
            enabled: true,
            mutationEnabled: true,
            sprint: nextSprintName,
            capacities: {},
            entries: [],
        },
    });

    await selectSprint(page, nextSprintName);
    const emptyStatus = page.locator('.team-capacity-read-status');
    await expect(emptyStatus).toContainText(
        'Team capacity Jira issues have not been created yet for this future sprint.',
    );
    const refreshButton = emptyStatus.getByRole('button', { name: 'Refresh capacity' });
    await expect(refreshButton).toBeEnabled();
    await captureCapacityScreenshot(page, testInfo, 'capacity-future-sprint-no-issues');

    await page.setViewportSize({ width: 375, height: 720 });
    await emptyStatus.scrollIntoViewIfNeeded();
    const mobileGeometry = await emptyStatus.evaluate(status => {
        const text = status.querySelector('span');
        const button = status.querySelector('button');
        const dimensions = node => ({
            rect: node.getBoundingClientRect(),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
        });
        return {
            status: dimensions(status),
            text: dimensions(text),
            button: dimensions(button),
            viewportWidth: window.innerWidth,
        };
    });
    for (const element of [mobileGeometry.status, mobileGeometry.text, mobileGeometry.button]) {
        expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
        expect(element.scrollHeight).toBeLessThanOrEqual(element.clientHeight);
        expect(element.rect.left).toBeGreaterThanOrEqual(0);
        expect(element.rect.right).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
    }
    await captureCapacityScreenshot(page, testInfo, 'capacity-future-sprint-no-issues-mobile', { fullPage: true });
    await page.setViewportSize({ width: 1028, height: 720 });

    const capacityGetsBefore = capacityCalls(fixture.calls, 'GET').length;
    const taskGetsBefore = fixture.calls.filter(call => call.method === 'GET'
        && call.pathname === '/api/tasks-with-team-name').length;
    const sprintGetsBefore = fixture.calls.filter(call => call.method === 'GET'
        && call.pathname === '/api/sprints').length;
    let finishRefresh;
    fixture.state.capacityGetGate = new Promise(resolve => { finishRefresh = resolve; });
    fixture.state.nextCapacityPayload = structuredClone(nextCapacityPayload);

    await refreshButton.click();
    const refreshingButton = emptyStatus.getByRole('button', { name: 'Refreshing capacity' });
    await expect(refreshingButton).toBeDisabled();
    await expect.poll(() => capacityCalls(fixture.calls, 'GET').length).toBe(capacityGetsBefore + 1);
    expect(fixture.calls.filter(call => call.method === 'GET'
        && call.pathname === '/api/tasks-with-team-name')).toHaveLength(taskGetsBefore);
    expect(fixture.calls.filter(call => call.method === 'GET'
        && call.pathname === '/api/sprints')).toHaveLength(sprintGetsBefore);

    finishRefresh();
    fixture.state.capacityGetGate = null;
    await expect(emptyStatus).toHaveCount(0);
    const alpha = page.locator('.team-stat-card', { hasText: 'Alpha' });
    await alpha.hover();
    await expect(alpha.getByRole('button', { name: 'Edit Alpha capacity' })).toBeVisible();
});

test('capacity reference states remain settled, bounded, and visible in Planning', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openPlanning(page);
    const alpha = page.locator('.team-stat-card', { hasText: 'Alpha' });
    const beta = page.locator('.team-stat-card', { hasText: 'Beta' });
    const expectReadStatusBounds = async (stateName) => {
        const geometry = await page.locator('.team-capacity-read-status').evaluate(status => {
            const text = status.querySelector('span');
            const button = status.querySelector('button');
            const dimensions = node => ({
                rect: node.getBoundingClientRect(),
                scrollWidth: node.scrollWidth,
                clientWidth: node.clientWidth,
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
            });
            return {
                status: dimensions(status),
                text: dimensions(text),
                button: dimensions(button),
                planning: status.closest('.planning-panel').getBoundingClientRect(),
                viewport: { width: window.innerWidth, height: window.innerHeight },
            };
        });
        [geometry.status, geometry.text, geometry.button].forEach((element, index) => {
            expect(element.scrollWidth, `${stateName} element ${index} horizontal clip`).toBeLessThanOrEqual(element.clientWidth);
            expect(element.scrollHeight, `${stateName} element ${index} vertical clip`).toBeLessThanOrEqual(element.clientHeight);
        });
        [geometry.text, geometry.button].forEach((element, index) => {
            expect(element.rect.left, `${stateName} child ${index} left`).toBeGreaterThanOrEqual(geometry.status.rect.left);
            expect(element.rect.right, `${stateName} child ${index} right`).toBeLessThanOrEqual(geometry.status.rect.right);
            expect(element.rect.top, `${stateName} child ${index} top`).toBeGreaterThanOrEqual(geometry.status.rect.top);
            expect(element.rect.bottom, `${stateName} child ${index} bottom`).toBeLessThanOrEqual(geometry.status.rect.bottom);
        });
        expect(geometry.status.rect.left, `${stateName} status inside Planning left`)
            .toBeGreaterThanOrEqual(geometry.planning.left);
        expect(geometry.status.rect.right, `${stateName} status inside Planning right`)
            .toBeLessThanOrEqual(geometry.planning.right);
        expect(geometry.status.rect.top, `${stateName} status inside Planning top`)
            .toBeGreaterThanOrEqual(geometry.planning.top);
        expect(geometry.status.rect.bottom, `${stateName} status inside Planning bottom`)
            .toBeLessThanOrEqual(geometry.planning.bottom);
        expect(geometry.status.rect.left, `${stateName} status inside viewport left`).toBeGreaterThanOrEqual(0);
        expect(geometry.status.rect.right, `${stateName} status inside viewport right`)
            .toBeLessThanOrEqual(geometry.viewport.width);
        expect(geometry.status.rect.top, `${stateName} status inside viewport top`).toBeGreaterThanOrEqual(0);
        expect(geometry.status.rect.bottom, `${stateName} status inside viewport bottom`)
            .toBeLessThanOrEqual(geometry.viewport.height);
    };

    await captureCapacityScreenshot(page, testInfo, 'capacity-default-idle');
    await alpha.hover();
    await captureCapacityScreenshot(page, testInfo, 'capacity-alpha-hovered');
    await beta.hover();
    await captureCapacityScreenshot(page, testInfo, 'capacity-beta-zero');

    await alpha.hover();
    await alpha.getByRole('button', { name: 'Edit Alpha capacity' }).click();
    await captureCapacityScreenshot(page, testInfo, 'capacity-alpha-editing');
    const input = alpha.getByRole('spinbutton', { name: 'Alpha Jira total planned capacity' });
    await input.fill('6');
    fixture.state.patchStatus = 409;
    fixture.state.patchResponse = { error: 'capacity_conflict', currentCapacity: 7 };
    await alpha.getByRole('button', { name: 'Save Alpha capacity' }).click();
    await expect(alpha.getByRole('status')).toContainText('Capacity changed in Jira to 7');
    const conflictGeometry = await alpha.getByRole('status').evaluate(status => ({
        scrollWidth: status.scrollWidth,
        clientWidth: status.clientWidth,
        scrollHeight: status.scrollHeight,
        clientHeight: status.clientHeight,
        status: status.getBoundingClientRect(),
        card: status.closest('.team-stat-card').getBoundingClientRect(),
    }));
    expect(conflictGeometry.scrollWidth).toBeLessThanOrEqual(conflictGeometry.clientWidth);
    expect(conflictGeometry.scrollHeight).toBeLessThanOrEqual(conflictGeometry.clientHeight);
    expect(conflictGeometry.status.left).toBeGreaterThanOrEqual(conflictGeometry.card.left);
    expect(conflictGeometry.status.right).toBeLessThanOrEqual(conflictGeometry.card.right);
    await captureCapacityScreenshot(page, testInfo, 'capacity-conflict');

    await page.locator('.epic-header').first().evaluate(element => {
        window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top + 120);
    });
    await captureCapacityScreenshot(page, testInfo, 'capacity-planning-stuck-error');

    await alpha.getByRole('button', { name: 'Cancel Alpha capacity edit' }).click();
    fixture.state.capacityGetStatus = 500;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira' }).evaluate(button => button.click());
    await expect(page.getByRole('button', { name: 'Retry capacity' })).toBeVisible();
    await page.locator('.team-capacity-read-status').scrollIntoViewIfNeeded();
    await expectReadStatusBounds('desktop Retry');
    await captureCapacityScreenshot(page, testInfo, 'capacity-stale-retry');

    await page.locator('.planning-panel.open').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const stickyTop = Number.parseFloat(getComputedStyle(element).top) || 0;
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - stickyTop + 80));
    });
    await page.waitForTimeout(180);
    await expectReadStatusBounds('sticky Planning Retry');

    await page.setViewportSize({ width: 375, height: 720 });
    await page.locator('.team-capacity-read-status').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectReadStatusBounds('mobile Retry');
    await captureCapacityScreenshot(page, testInfo, 'capacity-mobile-stale-retry', { fullPage: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.team-capacity-read-status').scrollIntoViewIfNeeded();
    let resolveRetry;
    fixture.state.capacityGetStatus = 200;
    fixture.state.capacityGetGate = new Promise(resolve => { resolveRetry = resolve; });
    await page.getByRole('button', { name: 'Retry capacity' }).click();
    const retrying = page.getByRole('button', { name: 'Retrying capacity' });
    await expect(retrying).toBeDisabled();
    await expect(retrying).toHaveText('Retrying capacity');
    await expectReadStatusBounds('desktop Retrying');
    await page.locator('.planning-panel.open').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const stickyTop = Number.parseFloat(getComputedStyle(element).top) || 0;
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - stickyTop + 80));
    });
    await page.waitForTimeout(180);
    await expectReadStatusBounds('sticky Planning Retrying');
    await page.setViewportSize({ width: 375, height: 720 });
    await page.locator('.team-capacity-read-status').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectReadStatusBounds('mobile Retrying');
    await captureCapacityScreenshot(page, testInfo, 'capacity-stale-retrying');
    fixture.state.capacityGetGate = null;
    resolveRetry();
});

test('a long synthetic capacity team label truncates only within its label slot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlanning(page, { teamCount: 6, longTeamLabel: true });
    const label = page.locator('.planning-team-capacity-cards .team-stat-label').last();
    const labelGeometry = await label.evaluate(node => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        textOverflow: getComputedStyle(node).textOverflow,
        whiteSpace: getComputedStyle(node).whiteSpace,
    }));
    expect(labelGeometry.scrollWidth).toBeGreaterThan(labelGeometry.clientWidth);
    expect(labelGeometry.textOverflow).toBe('ellipsis');
    expect(labelGeometry.whiteSpace).toBe('nowrap');
});

for (const teamCount of [1, 6, 7]) {
    test(`capacity cards keep labels and action rails inside ${teamCount}-team grid cells`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        let resolvePendingPatch;
        const fixture = await openPlanning(page, {
            teamCount,
            longTeamLabel: true,
            patchResponse: () => new Promise(resolve => { resolvePendingPatch = resolve; }),
        });

        const cards = page.locator('.planning-team-capacity-cards .team-stat-card');
        await expect(cards).toHaveCount(teamCount);
        const firstCard = teamCount === 1
            ? cards.first()
            : cards.filter({ hasText: 'Alpha' }).first();
        const firstTeamName = (await firstCard.locator('.team-stat-label').textContent()).trim();

        const measureGrid = () => cards.evaluateAll(nodes => {
            const grid = nodes[0]?.parentElement;
            const gridStyle = getComputedStyle(grid);
            const gridRect = grid.getBoundingClientRect();
            const columns = gridStyle.gridTemplateColumns.split(' ').map(Number.parseFloat);
            const rows = gridStyle.gridTemplateRows.split(' ').map(Number.parseFloat);
            const columnGap = Number.parseFloat(gridStyle.columnGap) || 0;
            const rowGap = Number.parseFloat(gridStyle.rowGap) || 0;
            const cellFor = (index) => {
                const column = index % columns.length;
                const row = Math.floor(index / columns.length);
                const left = gridRect.left + columns.slice(0, column).reduce((total, width) => total + width, 0) + (column * columnGap);
                const top = gridRect.top + rows.slice(0, row).reduce((total, height) => total + height, 0) + (row * rowGap);
                return { row, column, left, top, right: left + columns[column], bottom: top + rows[row] };
            };
            return nodes.map((card, index) => {
                const rect = card.getBoundingClientRect();
                const label = card.querySelector('.team-stat-label');
                const rail = card.querySelector('.team-capacity-action-rail');
                const microbar = card.querySelector('.microbar');
                const texts = [...card.querySelectorAll('.microbar-meta, .team-capacity-editor-context, [role="status"]')]
                    .map(node => ({ text: node.textContent.trim(), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
                return {
                    rect,
                    cell: cellFor(index),
                    scrollWidth: card.scrollWidth,
                    clientWidth: card.clientWidth,
                    scrollHeight: card.scrollHeight,
                    clientHeight: card.clientHeight,
                    label: {
                        text: label.textContent.trim(),
                        rect: label.getBoundingClientRect(),
                        scrollWidth: label.scrollWidth,
                        clientWidth: label.clientWidth,
                        textOverflow: getComputedStyle(label).textOverflow,
                        whiteSpace: getComputedStyle(label).whiteSpace,
                    },
                    rail: rail ? {
                        rect: rail.getBoundingClientRect(),
                        opacity: Number.parseFloat(getComputedStyle(rail).opacity),
                    } : null,
                    microbar: microbar ? microbar.getBoundingClientRect() : null,
                    actions: [...card.querySelectorAll('.team-capacity-action')].map(action => action.getBoundingClientRect()),
                    texts,
                };
            });
        });
        const expectGridGeometry = (stateName, geometry, railState) => {
            const rows = new Map();
            geometry.forEach(card => {
                expect(card.rect.left, `${stateName} card left`).toBeGreaterThanOrEqual(card.cell.left - 1);
                expect(card.rect.right, `${stateName} card right`).toBeLessThanOrEqual(card.cell.right + 1);
                expect(card.rect.top, `${stateName} card top`).toBeGreaterThanOrEqual(card.cell.top - 1);
                expect(card.rect.bottom, `${stateName} card bottom`).toBeLessThanOrEqual(card.cell.bottom + 1);
                expect(card.scrollWidth, `${stateName} card horizontal overflow`).toBeLessThanOrEqual(card.clientWidth);
                expect(card.scrollHeight, `${stateName} card vertical overflow`).toBeLessThanOrEqual(card.clientHeight);
                rows.set(card.cell.row, [...(rows.get(card.cell.row) || []), card.rect.height]);
                card.texts.forEach(text => {
                    expect(text.scrollWidth, `${stateName} ${text.text} horizontal overflow`).toBeLessThanOrEqual(text.clientWidth);
                    expect(text.scrollHeight, `${stateName} ${text.text} vertical overflow`).toBeLessThanOrEqual(text.clientHeight);
                });
                if (card.label.scrollWidth > card.label.clientWidth) {
                    expect(card.label.textOverflow).toBe('ellipsis');
                    expect(card.label.whiteSpace).toBe('nowrap');
                } else {
                    expect(card.label.scrollWidth).toBeLessThanOrEqual(card.label.clientWidth);
                }
                if (railState === 'visible') {
                    expect(card.rail, `${stateName} action rail`).not.toBeNull();
                    if (card.rail.opacity > 0) {
                        expect(card.label.rect.right, `${stateName} label clears visible rail`).toBeLessThan(card.rail.rect.left);
                        expect(card.rail.rect.left - card.label.rect.right, `${stateName} label-to-rail gap`).toBeGreaterThan(0);
                        expect(card.microbar.top - card.rail.rect.bottom, `${stateName} rail-to-microbar gap`).toBeGreaterThan(0);
                    } else {
                        expect(card.rail.opacity, `${stateName} non-hovered rail opacity`).toBe(0);
                    }
                    card.actions.forEach(action => {
                        expect(action.left).toBeGreaterThanOrEqual(card.rect.left);
                        expect(action.right).toBeLessThanOrEqual(card.rect.right);
                        expect(action.top).toBeGreaterThanOrEqual(card.rect.top);
                        expect(action.bottom).toBeLessThanOrEqual(card.rect.bottom);
                    });
                } else if (railState === 'hidden') {
                    expect(card.rail, `${stateName} hidden rail`).not.toBeNull();
                    expect(card.rail.opacity, `${stateName} hidden rail opacity`).toBe(0);
                } else {
                    expect(card.rail, `${stateName} rail absent`).toBeNull();
                }
            });
            rows.forEach(heights => expect(Math.max(...heights) - Math.min(...heights), `${stateName} grid row alignment`).toBeLessThanOrEqual(1));
        };

        const defaultGeometry = await measureGrid();
        expectGridGeometry('default', defaultGeometry, 'hidden');
        // Task 0's original label/microbar/meta card stack measures 58.64px at the 16px root.
        const taskZeroIdleRowHeight = 58.64;
        const rowHeights = geometry => Object.fromEntries([...new Set(geometry.map(card => card.cell.row))]
            .map(row => [row, Math.max(...geometry.filter(card => card.cell.row === row).map(card => card.rect.height))]));
        Object.values(rowHeights(defaultGeometry)).forEach((height, row) => {
            expect(height, `default row ${row} matches the Task 0 idle-card baseline`)
                .toBeCloseTo(taskZeroIdleRowHeight, 1);
        });
        const compareToDefault = (stateName, geometry, { rowGrowth = 1 } = {}) => {
            const defaultByTeam = new Map(defaultGeometry.map(card => [card.label.text, card]));
            geometry.forEach(card => {
                const baseline = defaultByTeam.get(card.label.text);
                expect(Math.abs(card.rect.width - baseline.rect.width), `${stateName} ${card.label.text} card width`).toBeLessThanOrEqual(1);
            });
            const baselineRows = rowHeights(defaultGeometry);
            const currentRows = rowHeights(geometry);
            Object.entries(baselineRows).forEach(([row, height]) => {
                expect(currentRows[row], `${stateName} row ${row} shrink`).toBeGreaterThanOrEqual(height - 1);
                expect(currentRows[row] - height, `${stateName} row ${row} growth`).toBeLessThanOrEqual(rowGrowth);
            });
        };

        await firstCard.hover();
        await expect(firstCard.locator('.team-capacity-action-rail')).toHaveCSS('opacity', '1');
        const hoverGeometry = await measureGrid();
        expectGridGeometry('hover', hoverGeometry, 'visible');
        compareToDefault('hover', hoverGeometry);
        const hoveredCard = hoverGeometry.find(card => card.label.text === firstTeamName);
        expect(hoveredCard.rail.opacity, 'hovered action rail opacity').toBeGreaterThan(0);

        await firstCard.getByRole('button', { name: `Edit ${firstTeamName} capacity` }).click();
        const desktopEditor = await firstCard.locator('.team-capacity-editor-row').evaluate(row => {
            const card = row.closest('.team-stat-card').getBoundingClientRect();
            const wrapper = row.getBoundingClientRect();
            const controls = [row.querySelector('input'), ...row.querySelectorAll('button')].map(node => node.getBoundingClientRect());
            return { card, wrapper, controls };
        });
        expect(desktopEditor.controls[0].width).toBeLessThanOrEqual(84);
        expect(desktopEditor.controls.map(rect => rect.height)).toEqual([28, 28, 28]);
        expect(new Set(desktopEditor.controls.map(rect => Math.round(rect.top))).size).toBe(1);
        expect(desktopEditor.wrapper.left).toBeGreaterThanOrEqual(desktopEditor.card.left);
        expect(desktopEditor.wrapper.right).toBeLessThanOrEqual(desktopEditor.card.right);
        const editingGeometry = await measureGrid();
        expectGridGeometry('editing', editingGeometry, 'absent');
        compareToDefault('editing', editingGeometry);

        const input = firstCard.getByRole('spinbutton', { name: `${firstTeamName} Jira total planned capacity` });
        await input.fill('6');
        await input.press('Enter');
        await expect(firstCard.locator('form.team-capacity-editor')).toHaveAttribute('aria-busy', 'true');
        const pendingGeometry = await measureGrid();
        expectGridGeometry('submitting', pendingGeometry, 'absent');
        compareToDefault('submitting', pendingGeometry);
        await expect.poll(() => typeof resolvePendingPatch).toBe('function');
        resolvePendingPatch({ issueKey: 'CAP-101', teamName: firstTeamName, previousCapacity: 5.5, capacity: 6, result: 'success' });
        await expect(firstCard.locator('form.team-capacity-editor')).toHaveCount(0);
        const successGeometry = await measureGrid();
        expectGridGeometry('success', successGeometry, 'visible');
        compareToDefault('success', successGeometry);

        await firstCard.hover();
        fixture.state.patchStatus = 409;
        fixture.state.patchResponse = { error: 'capacity_conflict', currentCapacity: 7 };
        await firstCard.getByRole('button', { name: `Edit ${firstTeamName} capacity` }).click();
        await firstCard.getByRole('spinbutton', { name: `${firstTeamName} Jira total planned capacity` }).fill('8');
        await firstCard.getByRole('button', { name: `Save ${firstTeamName} capacity` }).click();
        await expect(firstCard.getByRole('status')).toContainText('Capacity changed in Jira to 7');
        const conflictGeometry = await measureGrid();
        expectGridGeometry('conflict', conflictGeometry, 'absent');
        compareToDefault('conflict', conflictGeometry, { rowGrowth: 120 });
        await captureCapacityScreenshot(page, testInfo, `capacity-geometry-${teamCount}-desktop-conflict`);

        await page.setViewportSize({ width: 375, height: 720 });
        await firstCard.getByRole('button', { name: `Cancel ${firstTeamName} capacity edit` }).click();
        await firstCard.hover();
        await firstCard.getByRole('button', { name: `Edit ${firstTeamName} capacity` }).click();
        await expect(page.locator('form.team-capacity-editor')).toHaveCount(1);
        await expect(page.locator('.team-capacity-action-rail')).toHaveCount(0);
        expectGridGeometry('mobile editing', await measureGrid(), 'absent');
        const mobileGeometry = await firstCard.locator('.team-capacity-editor-row').evaluate(row => {
            const card = row.closest('.team-stat-card');
            const grid = card.parentElement;
            const controls = [row.querySelector('input'), ...row.querySelectorAll('button')];
            const rects = controls.map(control => control.getBoundingClientRect());
            return {
                gridScrollWidth: grid.scrollWidth,
                gridClientWidth: grid.clientWidth,
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                columnCount: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
                card: card.getBoundingClientRect(),
                rects,
            };
        });
        expect(mobileGeometry.gridScrollWidth).toBeLessThanOrEqual(mobileGeometry.gridClientWidth);
        expect(mobileGeometry.documentWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
        expect(mobileGeometry.columnCount).toBeLessThanOrEqual(2);
        expect(mobileGeometry.rects[0].width).toBeLessThan(desktopEditor.controls[0].width);
        expect(mobileGeometry.rects.map(rect => rect.height)).toEqual([28, 28, 28]);
        expect(new Set(mobileGeometry.rects.map(rect => Math.round(rect.top))).size).toBe(1);
        expect(new Set(mobileGeometry.rects.map(rect => Math.round(rect.bottom))).size).toBe(1);
        mobileGeometry.rects.forEach(rect => {
            expect(rect.left).toBeGreaterThanOrEqual(mobileGeometry.card.left);
            expect(rect.right).toBeLessThanOrEqual(mobileGeometry.card.right);
        });
        await captureCapacityScreenshot(page, testInfo, `capacity-geometry-${teamCount}-mobile-edit`);
    });
}
