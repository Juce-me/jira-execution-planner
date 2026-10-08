const fs = require('node:fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = path.join(__dirname, '..', '..', 'test-results', 'eng-epic-sort-and-track-qa');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha'];

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function story(key, status, summary, overrides = {}) {
    const projectKey = key.split('-')[0];
    const epicKey = overrides.epicKey || `${projectKey}-EPIC`;
    const teamId = overrides.teamId || 'team-alpha';
    const teamName = overrides.teamName || 'Alpha Team';
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: overrides.priority || 'Medium' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Planner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: overrides.storyPoints ?? 3,
            epicKey,
            parentSummary: `${projectKey} epic`,
            projectKey,
            teamId,
            teamName,
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
            ...(overrides.fields || {}),
        },
    };
}

function epic(key, summaryText, overrides = {}) {
    const projectKey = key.split('-')[0];
    const teamId = overrides.teamId || 'team-alpha';
    const teamName = overrides.teamName || 'Alpha Team';
    return {
        key,
        summary: summaryText,
        status: { name: 'In Progress' },
        assignee: { displayName: `${projectKey} Lead` },
        teamId,
        teamName,
        projectTrack: overrides.projectTrack || null,
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        ...overrides,
    };
}

const commitStory = story('COMMIT-2', 'In Progress', 'High priority committed story', {
    epicKey: 'COMMIT-1',
    priority: 'High',
    storyPoints: 5,
});
const flexStory = story('FLEX-2', 'To Do', 'Low priority flexible story', {
    epicKey: 'FLEX-1',
    priority: 'Low',
    storyPoints: 2,
});

const commitEpic = epic('COMMIT-1', 'Committed epic', { projectTrack: 'Committed' });
const flexEpic = epic('FLEX-1', 'Flexible epic', { projectTrack: 'Flexible' });

async function installTrackFixture(page, grouped = false) {
    await installDashboardShell(page);
    await page.route('**/api/**', route => {
        const request = route.request();
        const url = new URL(request.url());
        const json = (body, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        }
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                groupQueryTemplateEnabled: false,
                settingsAdminOnly: false,
                userCanEditSettings: true,
                projectsConfigured: true,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') {
            return json({
                version: 1,
                groups: [{
                    id: 'grp-default',
                    name: 'Default',
                    teamIds: groupTeamIds,
                    teamLabels: { 'team-alpha': 'Alpha Team' },
                }, { id: 'grp-second', name: 'Second synthetic group', teamIds: groupTeamIds, teamLabels: { 'team-alpha': 'Alpha Team' } }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        }
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const purpose = url.searchParams.get('purpose');
            if (purpose === 'ready-to-close') {
                return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            }
            return json({
                issues: [commitStory, flexStory],
                epics: {
                    'COMMIT-1': grouped ? { ...commitEpic, initiative: { key: 'INIT-1', summary: 'Synthetic initiative' } } : commitEpic,
                    'FLEX-1': grouped ? { ...flexEpic, initiative: { key: 'INIT-1', summary: 'Synthetic initiative' } } : flexEpic,
                },
                epicsInScope: [commitEpic, flexEpic],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') {
            return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        }
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openEng(page, viewport, prefOverrides = {}) {
    await page.setViewportSize(viewport);
    await installTrackFixture(page, prefOverrides.groupByInitiative === true);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showScenario: false,
        showAlertsPanel: false,
        ...prefOverrides,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.epic-block', { timeout: 10000 });
}

test('epic header shows effective priority pill and Product Track emoji', async ({ page }) => {
    await openEng(page, { width: 1280, height: 900 });

    const committedHeader = page.locator('.epic-block', { hasText: 'COMMIT-1' }).locator('.epic-header');
    await expect(committedHeader.locator('.task-priority-icon[data-priority="High"]')).toBeVisible();
    await expect(committedHeader.locator('.epic-track-indicator')).toHaveText('🔒');

    const flexHeader = page.locator('.epic-block', { hasText: 'FLEX-1' }).locator('.epic-header');
    await expect(flexHeader.locator('.epic-track-indicator')).toHaveText('🤷');
    await expect(flexHeader.locator('.task-priority-icon[data-priority="Low"]')).toBeVisible();

    await page.screenshot({ path: `${screenshotDir}/epic-priority-track.png`, fullPage: false });
});

test('Sort dropdown reorders epics by Product Track (committed first)', async ({ page }) => {
    // FLEX-1 appears after COMMIT-1 in default fixture order; pick "Committed ⬇"
    // and assert COMMIT-1's .epic-block precedes FLEX-1's .epic-block in the DOM.
    await openEng(page, { width: 1280, height: 900 });

    await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle').click();
    // The dropdown panel is inside .filters-strip which has animation-fill-mode:both; the
    // resulting transform stacking context puts the panel behind the task list in z-order.
    // Force the click so the option registers regardless of pointer-event interception.
    await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-option', { hasText: 'Committed ⬇' }).click();

    const keys = await page.locator('.task-list .epic-block .epic-key').allInnerTexts();
    const iCommit = keys.findIndex(k => k.includes('COMMIT-1'));
    const iFlex = keys.findIndex(k => k.includes('FLEX-1'));
    expect(iCommit).toBeGreaterThanOrEqual(0);
    expect(iCommit).toBeLessThan(iFlex);

    await page.screenshot({ path: `${screenshotDir}/sort-track-committed-first.png`, fullPage: false });
});

// Opt-in local synthetic before/after proof; the fixture never reads a real Jira site.
test('ENG renderer extraction settled synthetic visual parity', async ({ page }) => {
    test.skip(!process.env.JEP_ENG_RENDERER_CAPTURE_DIR, 'local before/after capture only');
    const directory = path.resolve(process.env.JEP_ENG_RENDERER_CAPTURE_DIR);
    fs.mkdirSync(directory, { recursive: true });
    const capture = async (name, locator) => {
        await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
        await page.mouse.move(1, 1);
        await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
        fs.writeFileSync(path.join(directory, `${name}.html`), await locator.evaluate(node => node.outerHTML));
    };
    await openEng(page, { width: 1280, height: 900 });
    await capture('direct-header', page.locator('[data-epic-key="COMMIT-1"] .epic-header'));
    for (const [name, trigger] of [['sprint', '[aria-label="Select sprint"]'], ['group', '[aria-label="Select group"]'], ['team', '[aria-label="Filter teams"]']]) {
        await page.locator(`header ${trigger}`).click();
        await capture(`main-${name}`, page.locator('header'));
        await page.locator('.search-input').first().click();
    }
    await page.evaluate(() => { document.body.style.minHeight = '2200px'; window.scrollTo(0, 500); });
    const compact = page.locator('.compact-sticky-header');
    await expect(compact).toHaveClass(/is-visible/);
    for (const [name, trigger] of [['sprint', '[aria-label="Select sprint"]'], ['group', '[aria-label="Select group"]'], ['team', '[aria-label="Filter teams"]']]) {
        await compact.locator(trigger).click();
        await capture(`compact-${name}`, compact);
        await compact.locator('.search-input').click();
    }
    await openEng(page, { width: 1280, height: 900 }, { groupByInitiative: true });
    await expect(page.locator('.initiative-body .epic-block')).toHaveCount(2);
    await capture('initiative-header', page.locator('.initiative-body [data-epic-key="COMMIT-1"] .epic-header'));
});

for (const grouped of [false, true]) {
    test(`keyed Epic identity survives actual reversal and sibling filtering ${grouped ? 'initiative-grouped' : 'direct'}`, async ({ page }) => {
        await openEng(page, { width: 1280, height: 900 }, { groupByInitiative: grouped });
        if (grouped) await expect(page.locator('.initiative-body .epic-block')).toHaveCount(2);
        const blocks = page.locator('.task-list .epic-block');
        const originalKeys = await blocks.evaluateAll(nodes => nodes.map(node => node.dataset.epicKey));
        expect(originalKeys).toEqual(['COMMIT-1', 'FLEX-1']);
        const survivor = page.locator('[data-epic-key="COMMIT-1"]');
        const originalNode = await survivor.elementHandle();
        const originalLink = await survivor.locator('.epic-link').elementHandle();
        await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle').click();
        await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-option', { hasText: 'Flexible ⬇' }).click();
        await expect.poll(() => blocks.evaluateAll(nodes => nodes.map(node => node.dataset.epicKey))).toEqual(['FLEX-1', 'COMMIT-1']);
        expect(await survivor.evaluate((node, previous) => node.isSameNode(previous), originalNode)).toBe(true);
        expect(await survivor.locator('.epic-link').evaluate((node, previous) => node.isSameNode(previous), originalLink)).toBe(true);
        await originalLink.focus();
        expect(await originalLink.evaluate(node => document.activeElement === node)).toBe(true);
        await page.locator('header .search-input').fill('High priority committed story');
        await expect(blocks).toHaveCount(1);
        await expect(survivor).toBeVisible();
        expect(await survivor.evaluate((node, previous) => node.isSameNode(previous), originalNode)).toBe(true);
        await originalLink.focus();
        expect(await originalLink.evaluate(node => document.activeElement === node && node.isConnected)).toBe(true);
        // Sticky focus reads App's epicRefMap. Tall synthetic content makes that positive
        // path observable after the sibling was removed; stale ref deletion loses the class.
        await page.addStyleTag({ content: '.task-list .epic-block { min-height: 700px; } body { min-height: 2400px; }' });
        await survivor.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY + 40));
        await expect(survivor).toHaveClass(/epic-block-sticky-focus/);
        await expect(page.locator('.epic-block-sticky-focus')).toHaveCount(1);
        await originalNode.dispose();
        await originalLink.dispose();
    });
}
