const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const sprintId = 34625;
const sprintName = '2026Q2 Sprint 42';

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
}

function story(key = 'MIX-1', overrides = {}) {
    const epicKey = overrides.epicKey || 'MIX-EPIC';
    return {
        id: key,
        key,
        fields: {
            summary: overrides.summary || 'Existing delivery story',
            status: { name: overrides.status || 'To Do' },
            priority: { name: 'High' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Synthetic Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 3,
            epicKey,
            parentSummary: overrides.epicSummary || 'Mixed coverage epic',
            projectKey: 'MIX',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: overrides.sprintState || 'active' }],
        },
    };
}

function readinessEpic(key, {
    summary = `${key} summary`,
    reason = 'no_stories',
    teamId = 'team-beta',
    teamName = 'Beta Team',
    initiative = null,
} = {}) {
    return {
        key,
        summary,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'MIX',
        projectClass: 'product',
        projectTrack: 'product',
        initiative,
        missingTeams: [{ id: teamId, name: teamName, reason }],
    };
}

function snapshot(epics, sprintState = 'active') {
    return {
        schemaVersion: 1,
        complete: true,
        scope: {
            groupId: 'grp-default',
            sprintId: String(sprintId),
            sprintName,
            sprintState,
        },
        epics,
    };
}

async function installFixture(page, {
    mode = 'catchUp',
    sprintState = 'active',
    productIssues = [],
    productEpics = {},
    readinessEpics = [],
    primaryGates = {},
    readinessGate = null,
    groupByInitiativeChoice = null,
    showAlertsPanel = true,
} = {}) {
    const calls = [];
    await installDashboardShell(page);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: sprintId,
        sprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showPlanning: mode === 'planning',
        showStats: false,
        showScenario: false,
        showBoard: false,
        showAlertsPanel,
        showNeedsStoriesAlert: true,
        groupByInitiativeChoice,
    });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        calls.push({ pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()) });
        const json = body => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example',
            authMode: 'atlassian_oauth',
            capacityProject: '',
            groupQueryTemplateEnabled: false,
            settingsAdminOnly: false,
            userCanEditSettings: true,
            projectsConfigured: true,
            epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
        });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json({
            version: 1,
            groups: [{
                id: 'grp-default',
                name: 'Default',
                teamIds: ['team-alpha', 'team-beta'],
                teamLabels: { 'team-alpha': 'Alpha Team', 'team-beta': 'Beta Team' },
            }],
            defaultGroupId: 'grp-default',
            source: 'test',
        });
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: sprintId, name: sprintName, state: sprintState }] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            if (!purpose && primaryGates[project]) await primaryGates[project].promise;
            if (purpose) return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            if (project === 'product') {
                return json({ issues: productIssues, epics: productEpics, epicsInScope: Object.values(productEpics), names: {} });
            }
            return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
        }
        if (url.pathname === '/api/eng/story-readiness') {
            if (readinessGate) await readinessGate.promise;
            return json(snapshot(readinessEpics, sprintState));
        }
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
    return calls;
}

async function waitForCall(calls, pathname, count = 1) {
    await expect.poll(() => calls.filter(call => call.pathname === pathname).length).toBe(count);
}

function productEpic(key = 'MIX-EPIC', summary = 'Mixed coverage epic') {
    return {
        key,
        summary,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'MIX',
        projectClass: 'product',
        projectTrack: 'product',
        sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
    };
}

test('defers readiness until both primary task responses paint in Catch Up', async ({ page }) => {
    const productGate = deferred();
    const techGate = deferred();
    const readinessGate = deferred();
    const issue = story();
    const calls = await installFixture(page, {
        productIssues: [issue],
        productEpics: { 'MIX-EPIC': productEpic() },
        readinessEpics: [readinessEpic('MIX-EPIC', { reason: 'team_uncovered' })],
        primaryGates: { product: productGate, tech: techGate },
        readinessGate,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose).length).toBe(2);
    expect(calls.some(call => call.pathname === '/api/eng/story-readiness')).toBe(false);

    productGate.resolve();
    await expect(page.getByText('Existing delivery story')).toBeVisible();
    expect(calls.some(call => call.pathname === '/api/eng/story-readiness')).toBe(false);

    techGate.resolve();
    await waitForCall(calls, '/api/eng/story-readiness');
    await expect(page.locator('.story-requirement-card')).toHaveCount(0);
    readinessGate.resolve();
    await expect(page.locator('.story-requirement-card')).toBeVisible();
});

test('Planning requests readiness without starting Catch Up alert sources', async ({ page }) => {
    const calls = await installFixture(page, {
        mode: 'planning',
        readinessEpics: [readinessEpic('ZERO-EPIC')],
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    await expect(page.locator('.story-requirement-card')).toBeVisible();
    await waitForCall(calls, '/api/eng/story-readiness');
    expect(calls.filter(call => (
        call.pathname === '/api/missing-info'
        || call.pathname === '/api/backlog-epics'
        || (call.pathname === '/api/tasks-with-team-name' && call.params.purpose)
    ))).toEqual([]);
});

test('epic status pills keep the established filled status treatment', async ({ page }) => {
    await installFixture(page, {
        productIssues: [story()],
        productEpics: { 'MIX-EPIC': productEpic() },
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const status = page.locator('.epic-status-pill.in-progress').first();
    await expect(status).toBeVisible();
    await expect(status).toHaveCSS('background-color', 'rgb(105, 192, 255)');
    await expect(status).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(status).toHaveCSS('border-top-width', '0px');
    await expect(status).toHaveCSS('font-size', '9.28px');
    await expect(status).toHaveCSS('height', '29.75px');
    await expect(status).toHaveCSS('padding-top', '2.88px');
    await expect(status).toHaveCSS('padding-right', '7.68px');
    await expect(status).toHaveCSS('min-width', 'auto');
    await expect(status).toHaveCSS('max-width', 'none');
});

test('Back to top stays above page content throughout scrolling', async ({ page }) => {
    const productIssues = [];
    const productEpics = {};
    for (let index = 0; index < 24; index += 1) {
        const epicKey = `MIX-EPIC-${index}`;
        productIssues.push(story(`MIX-${index}`, { epicKey, epicSummary: `Mixed coverage epic ${index}` }));
        productEpics[epicKey] = productEpic(epicKey, `Mixed coverage epic ${index}`);
    }
    await installFixture(page, { productIssues, productEpics, showAlertsPanel: false });
    await page.setViewportSize({ width: 800, height: 860 });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, 160));
    await expect(page.locator('.back-to-top')).toBeVisible();

    const overlaps = await page.evaluate(async () => {
        const failures = [];
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        for (let scrollY = 160; scrollY <= maxScroll; scrollY += 32) {
            window.scrollTo(0, scrollY);
            await new Promise(resolve => requestAnimationFrame(resolve));
            const button = document.querySelector('.back-to-top');
            if (!button) {
                failures.push({ scrollY, topClass: 'missing-back-to-top' });
                break;
            }
            const rect = button.getBoundingClientRect();
            const xValues = [rect.left + 4, rect.left + (rect.width / 2), rect.right - 4];
            const yValues = [rect.top + 4, rect.top + (rect.height / 2), rect.bottom - 4];
            for (const x of xValues) {
                for (const y of yValues) {
                    const top = document.elementFromPoint(x, y);
                    if (!button.contains(top)) {
                        failures.push({
                            scrollY,
                            x: Math.round(x),
                            y: Math.round(y),
                            topClass: top?.className || top?.tagName || null,
                        });
                    }
                }
            }
            if (failures.length) break;
        }
        return failures;
    });

    expect(overlaps).toEqual([]);
});

for (const sprintState of ['active', 'future']) {
    test(`${sprintState} requirement is an external Jira link with the matching urgency`, async ({ page }) => {
        await installFixture(page, {
            mode: 'planning',
            sprintState,
            readinessEpics: [readinessEpic('ZERO-EPIC')],
        });
        await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

        const card = page.locator('.story-requirement-card');
        await expect(card).toHaveClass(new RegExp(`story-requirement-${sprintState}`));
        await expect(card).toContainText('Team: Beta Team');
        await expect(card).toContainText(`Target sprint: ${sprintName}`);
        await expect(card).toContainText('Create in Jira.');
        await expect(card).not.toContainText("Open the Epic in Jira to create this Team's Story.");
        await expect(card).toContainText(sprintState === 'active' ? 'Current sprint · action needed' : 'Future sprint · plan ahead');
        await expect(card).toHaveAttribute('href', 'https://jira.example/browse/ZERO-EPIC');
        await expect(card).toHaveAttribute('target', '_blank');
        await expect(card).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(card).toHaveCSS('border-top-style', 'dashed');
    });
}

test('no-story Epics are dotted directly and inside Initiative grouping while mixed Epics are not', async ({ page }) => {
    const initiative = { key: 'INIT-1', summary: 'Checkout initiative' };
    await installFixture(page, {
        mode: 'planning',
        groupByInitiativeChoice: true,
        productIssues: [story()],
        productEpics: { 'MIX-EPIC': productEpic() },
        readinessEpics: [
            readinessEpic('DIRECT-ZERO'),
            readinessEpic('ZERO-EPIC', { initiative }),
            readinessEpic('ZERO-TWO', { initiative }),
            readinessEpic('MIX-EPIC', { reason: 'team_uncovered' }),
        ],
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const nestedZero = page.locator('.initiative-body > .epic-block[data-epic-key="ZERO-EPIC"]');
    await expect(nestedZero).toHaveClass(/epic-block-no-child-stories/);
    await expect(nestedZero).toHaveCSS('border-top-style', 'dotted');
    const directZero = page.locator('.epic-block[data-epic-key="DIRECT-ZERO"]');
    await expect(directZero).toHaveClass(/epic-block-no-child-stories/);
    await expect(directZero).toHaveCSS('border-top-style', 'dotted');
    await expect(page.locator('.initiative-body .epic-block[data-epic-key="DIRECT-ZERO"]')).toHaveCount(0);
    const mixed = page.locator('.epic-block[data-epic-key="MIX-EPIC"]');
    await expect(mixed).not.toHaveClass(/epic-block-no-child-stories/);
    await expect(mixed).not.toHaveCSS('border-top-style', 'dotted');
});

test('Planning puts requirement rows and requirement-bearing Epics first', async ({ page }) => {
    await installFixture(page, {
        mode: 'planning',
        productIssues: [story()],
        productEpics: { 'MIX-EPIC': productEpic() },
        readinessEpics: [
            readinessEpic('ZERO-EPIC'),
            readinessEpic('MIX-EPIC', { reason: 'team_uncovered' }),
        ],
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const mixedRows = page.locator('.epic-block[data-epic-key="MIX-EPIC"] > .story-requirement-card, .epic-block[data-epic-key="MIX-EPIC"] > .task-item');
    await expect(mixedRows).toHaveCount(2);
    await expect(mixedRows.nth(0)).toHaveClass(/story-requirement-card/);
    await expect(mixedRows.nth(1)).toHaveClass(/task-item/);
    await expect(page.locator('.epic-block').first()).toContainText('Story required');
    await expect(page.locator('.eng-empty-results')).toHaveCount(0);
    await expect(page.getByText(/1 stories · 2 required/i)).toBeVisible();
});

test('a ghost-only hierarchy is a non-empty ENG result', async ({ page }) => {
    await installFixture(page, {
        mode: 'planning',
        readinessEpics: [readinessEpic('ZERO-EPIC')],
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    await expect(page.locator('.story-requirement-card')).toHaveCount(1);
    await expect(page.locator('.eng-empty-results')).toHaveCount(0);
    await expect(page.getByText(/0 stories · 1 required/i)).toBeVisible();
});

test('keyboard activation and narrow layout preserve native link behavior and containment', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await installFixture(page, { mode: 'planning', readinessEpics: [readinessEpic('ZERO-EPIC')] });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const card = page.locator('.story-requirement-card');
    await card.evaluate(node => {
        window.__storyRequirementActivations = 0;
        node.addEventListener('click', event => {
            event.preventDefault();
            window.__storyRequirementActivations += 1;
        });
    });
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__storyRequirementActivations)).toBe(1);

    const geometry = await card.evaluate(node => {
        const cardRect = node.getBoundingClientRect();
        const epicRect = node.closest('.epic-block').getBoundingClientRect();
        return {
            cardLeft: cardRect.left,
            cardRight: cardRect.right,
            epicLeft: epicRect.left,
            epicRight: epicRect.right,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    expect(geometry.cardLeft).toBeGreaterThanOrEqual(geometry.epicLeft - 1);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.epicRight + 1);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
});

test('Stories Required reuses the existing alert row style and focuses the local ghost', async ({ page }) => {
    await installFixture(page, {
        productIssues: [
            story('MIX-1'),
            story('KILLED-1', { status: 'Killed', epicKey: 'KILLED-EPIC', epicSummary: 'Killed epic' }),
        ],
        productEpics: {
            'MIX-EPIC': productEpic(),
            'KILLED-EPIC': productEpic('KILLED-EPIC', 'Killed epic'),
        },
        readinessEpics: [readinessEpic('ZERO-EPIC')],
        showAlertsPanel: true,
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const section = page.locator('#eng-alert-needs-stories');
    const localAction = section.locator('.alert-story-local-link');
    await expect(localAction).toHaveJSProperty('tagName', 'BUTTON');
    await expect(section.locator('.alert-action')).toHaveCount(0);

    await localAction.hover();
    const styles = await localAction.evaluate((node) => {
        const computed = getComputedStyle(node);
        const note = getComputedStyle(node.nextElementSibling);
        return {
            backgroundColor: computed.backgroundColor,
            boxShadow: computed.boxShadow,
            transform: computed.transform,
            textTransform: computed.textTransform,
            letterSpacing: computed.letterSpacing,
            marginRight: computed.marginRight,
            fontFamily: computed.fontFamily,
            noteFontFamily: note.fontFamily,
        };
    });
    expect(styles).toMatchObject({
        backgroundColor: 'rgba(0, 0, 0, 0)',
        boxShadow: 'none',
        transform: 'none',
        textTransform: 'none',
        letterSpacing: 'normal',
        marginRight: '0px',
    });
    expect(styles.fontFamily).toBe(styles.noteFontFamily);

    const initialUrl = page.url();
    const ghost = page.locator('.story-requirement-card[data-epic-key="ZERO-EPIC"]');
    await expect(ghost).toHaveCount(0);
    await localAction.click();
    await expect(ghost).toBeVisible();
    await expect(ghost).toBeFocused();
    await expect(ghost).toHaveClass(/story-requirement-highlight/);
    expect(page.url()).toBe(initialUrl);
});
