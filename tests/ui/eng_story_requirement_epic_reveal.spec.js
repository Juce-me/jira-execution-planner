const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

// Clicking a Stories Required alert lands the requirement's Epic header just below the sticky stack.
// Synthetic data only: many Epics with several Stories each so the list is several viewports long.

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const sprintId = 34625;
const sprintName = '2026Q2 Sprint 42';
const STORIES_PER_EPIC = 5;

function story(key, epicKey, { epicSummary = `${epicKey} summary`, teamId = 'team-alpha', teamName = 'Alpha Team' } = {}) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} delivery story`,
            status: { name: 'To Do' },
            priority: { name: 'High' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Synthetic Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 3,
            epicKey,
            parentSummary: epicSummary,
            projectKey: 'MIX',
            teamId,
            teamName,
            sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
        },
    };
}

function productEpic(key, { initiative = null, priority = 'High' } = {}) {
    return {
        key,
        summary: `${key} summary`,
        status: { name: 'In Progress' },
        priority: { name: priority },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'MIX',
        projectClass: 'product',
        projectTrack: 'product',
        initiative,
        sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
    };
}

function readinessEpic(key, { reason = 'no_stories', initiative = null } = {}) {
    return {
        key,
        summary: `${key} summary`,
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Epic Owner' },
        projectKey: 'MIX',
        projectClass: 'product',
        projectTrack: 'product',
        initiative,
        missingTeams: [{ id: 'team-beta', name: 'Beta Team', reason }],
    };
}

// `epics` lists the Epic keys with the Story count of each; the target carries the only requirement. Epics sort by priority, so a
// readiness-only target (priority High, appended after the Story Epics) sits after the High Epics and before the Low ones.
function buildScenario({ epics, target, targetReason = 'no_stories', initiative = null }) {
    const productIssues = [];
    const productEpics = {};
    for (const { key, stories, priority } of epics) {
        productEpics[key] = productEpic(key, { initiative, priority });
        for (let index = 1; index <= stories; index += 1) productIssues.push(story(`${key}-S${index}`, key));
    }
    return { productIssues, productEpics, readinessEpics: [readinessEpic(target, { reason: targetReason, initiative })] };
}

async function installFixture(page, { productIssues, productEpics, readinessEpics, groupByInitiativeChoice = null }) {
    await installDashboardShell(page);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng', planningLayout: 'list',
        selectedSprint: sprintId,
        sprintName,
        activeGroupId: 'grp-default',
        selectedTeams: ['all'],
        showPlanning: false,
        showStats: false,
        showScenario: false,
        showBoard: false,
        showAlertsPanel: true,
        showNeedsStoriesAlert: true,
        groupByInitiativeChoice,
    });
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
            groups: [{ id: 'grp-default', name: 'Default', teamIds: ['team-alpha', 'team-beta'], teamLabels: { 'team-alpha': 'Alpha Team', 'team-beta': 'Beta Team' } }],
            defaultGroupId: 'grp-default',
            source: 'test',
        });
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: sprintId, name: sprintName, state: 'active' }] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            if (url.searchParams.get('purpose')) return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            if (project === 'product') return json({ issues: productIssues, epics: productEpics, epicsInScope: Object.values(productEpics), names: {} });
            return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
        }
        if (url.pathname === '/api/eng/story-readiness') return json({
            schemaVersion: 1,
            complete: true,
            scope: { groupId: 'grp-default', sprintId: String(sprintId), sprintName, sprintState: 'active' },
            epics: readinessEpics,
        });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

// Waits until scrollY holds still for several consecutive frames (the reveal scrolls smoothly).
async function waitForScrollSettled(page) {
    await page.evaluate(() => new Promise((resolve) => {
        let last = window.scrollY;
        let stable = 0;
        const tick = () => {
            const now = window.scrollY;
            stable = Math.abs(now - last) < 0.5 ? stable + 1 : 0;
            last = now;
            if (stable >= 10) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }));
}

// Rendered geometry of the sticky stack and the target Epic, read from the real elements.
async function measureReveal(page, epicKey) {
    return page.evaluate((key) => {
        const stuck = (element) => {
            const style = getComputedStyle(element);
            if (style.position !== 'sticky' && style.position !== 'fixed') return false;
            if (style.display === 'none') return false;
            return element.getBoundingClientRect().top <= (Number.parseFloat(style.top) || 0) + 1;
        };
        const tiers = ['.compact-sticky-header.is-visible', '.planning-panel.open', '.filterbar-wrap', '[data-alert-pin]']
            .flatMap(selector => Array.from(document.querySelectorAll(selector)).map(element => ({ selector, element })))
            .filter(({ element }) => stuck(element));
        const stackBottom = tiers.reduce((bottom, { element }) => Math.max(bottom, element.getBoundingClientRect().bottom), 0);
        // The same logic as measureStickyBottom in alertEpicNavigation.js over the list the reveal passes it.
        const appStackBottom = ['.compact-sticky-header.is-visible', '.planning-panel.open', '.eng-filter-bar', '.filterbar-wrap', '[data-alert-pin]'].reduce((bottom, selector) => {
            document.querySelectorAll(selector).forEach((element) => {
                const style = getComputedStyle(element);
                if (style.position !== 'sticky' && style.position !== 'fixed') return;
                const rect = element.getBoundingClientRect();
                if (rect.top <= Math.max(1, Number.parseFloat(style.top) || 0) + 1) bottom = Math.max(bottom, rect.bottom);
            });
            return bottom;
        }, 0);
        const block = document.querySelector(`.epic-block[data-epic-key="${key}"]`);
        const header = block.querySelector(':scope > .epic-header');
        const card = block.querySelector('.story-requirement-card');
        const headerRect = header.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        // The Epic header painted right below the stack: the top-most element under its band.
        const probeY = stackBottom + 4;
        const hit = document.elementFromPoint(Math.round(headerRect.left + 40), Math.round(probeY));
        const coveringBlock = hit?.closest('.epic-block')?.getAttribute('data-epic-key') || null;
        const headerHit = document.elementFromPoint(Math.round(headerRect.left + 40), Math.round((headerRect.top + headerRect.bottom) / 2));
        const headerCoveredBy = headerHit?.closest('.epic-block')?.getAttribute('data-epic-key') || null;
        const stuckHeaders = Array.from(document.querySelectorAll('.epic-block > .epic-header'))
            .filter(element => stuck(element) && element.getBoundingClientRect().bottom > stackBottom)
            .map(element => element.closest('.epic-block').getAttribute('data-epic-key'));
        return {
            scrollY: window.scrollY,
            maxScroll: document.documentElement.scrollHeight - window.innerHeight,
            innerHeight: window.innerHeight,
            tiers: tiers.map(({ selector, element }) => ({ selector, bottom: element.getBoundingClientRect().bottom })),
            alertPinBars: document.querySelectorAll('[data-alert-pin]').length,
            stackBottom,
            appStackBottom,
            headerTop: headerRect.top,
            headerBottom: headerRect.bottom,
            cardTop: cardRect.top,
            cardBottom: cardRect.bottom,
            blockHeight: block.getBoundingClientRect().height,
            coveringBlock,
            headerCoveredBy,
            order: Array.from(document.querySelectorAll('.epic-block[data-epic-key]')).map(element => element.getAttribute('data-epic-key')),
            stuckHeaders,
            focused: document.activeElement === card,
            highlighted: card.classList.contains('story-requirement-highlight'),
        };
    }, epicKey);
}

async function clickRequirementAlert(page, epicKey) {
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('#eng-alert-needs-stories');
    await expect(section).toBeVisible();
    await expect(page.locator(`.epic-block[data-epic-key="${epicKey}"] .story-requirement-card`)).toBeVisible();
    const row = section.locator('.alert-story').filter({ hasText: epicKey });
    await row.locator('.alert-story-local-link').click();
    await waitForScrollSettled(page);
    return measureReveal(page, epicKey);
}

// `before` High-priority Epics render ahead of the readiness-only target, `after` Low-priority Epics behind it.
function epicList(before, after, stories = STORIES_PER_EPIC) {
    const make = (prefix, count, priority) => Array.from({ length: count }, (_, index) => ({ key: `${prefix}-${String(index + 1).padStart(2, '0')}`, stories, priority }));
    return [...make('REV', before, 'High'), ...make('LOW', after, 'Low')];
}

// The target's own header is fully visible below the stack, its requirement card is in view, and no other Epic covers it.
function expectHeaderVisible(geometry, epicKey) {
    expect(geometry.alertPinBars).toBe(1); // the click also pins the alert
    expect(Math.abs(geometry.appStackBottom - geometry.stackBottom)).toBeLessThanOrEqual(1);
    expect(geometry.headerTop).toBeGreaterThanOrEqual(geometry.stackBottom - 1);
    expect(geometry.headerBottom).toBeLessThanOrEqual(geometry.innerHeight);
    expect(geometry.headerCoveredBy).toBe(epicKey);
    expect(geometry.cardTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
    expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.innerHeight);
    expect(geometry.focused).toBe(true);
    expect(geometry.highlighted).toBe(true);
}

// Fits-in-viewport landing: the header sits right under the stack and no other Epic shows under the stack.
function expectHeaderBelowStack(geometry, epicKey) {
    expectHeaderVisible(geometry, epicKey);
    expect(geometry.headerTop - geometry.stackBottom).toBeLessThanOrEqual(24);
    expect(geometry.coveringBlock).toBe(epicKey);
    expect(geometry.stuckHeaders.filter(key => key !== epicKey)).toEqual([]);
}

test.use({ viewport: { width: 1280, height: 800 } });

test('a readiness-only Epic in the middle lands its header just below the sticky stack', async ({ page }) => {
    const target = 'REV-MID';
    await installFixture(page, buildScenario({ epics: epicList(5, 5), target }));
    const geometry = await clickRequirementAlert(page, target);
    expect(geometry.order.indexOf(target)).toBe(5);
    expectHeaderBelowStack(geometry, target);
});

test('the last Epic, limited by the document end, keeps its header visible below the stack', async ({ page }) => {
    const target = 'REV-LAST';
    await installFixture(page, buildScenario({ epics: epicList(10, 0), target }));
    const geometry = await clickRequirementAlert(page, target);
    expect(geometry.order.at(-1)).toBe(target);
    expectHeaderVisible(geometry, target);
    // Either it reached the stack, or the scroll went as far as the document allows.
    if (geometry.headerTop - geometry.stackBottom > 24) expect(geometry.scrollY).toBeGreaterThanOrEqual(geometry.maxScroll - 1);
});

test('the first Epic lands its header just below the sticky stack', async ({ page }) => {
    const target = 'REV-FIRST';
    await installFixture(page, buildScenario({ epics: epicList(0, 10), target }));
    const geometry = await clickRequirementAlert(page, target);
    expect(geometry.order[0]).toBe(target);
    expectHeaderBelowStack(geometry, target);
});

test('an Epic nested under an Initiative lands its header just below the sticky stack', async ({ page }) => {
    const target = 'REV-NESTED';
    const initiative = { key: 'INIT-1', summary: 'Synthetic initiative' };
    await installFixture(page, { ...buildScenario({ epics: epicList(5, 5), target, initiative }), groupByInitiativeChoice: true });
    const geometry = await clickRequirementAlert(page, target);
    await expect(page.locator(`.initiative-body > .epic-block[data-epic-key="${target}"]`)).toHaveCount(1);
    expectHeaderBelowStack(geometry, target);
});

test('a requirement inside a Story Epic that fits lands that Epic header below the stack', async ({ page }) => {
    const target = 'REV-03';
    await installFixture(page, buildScenario({ epics: epicList(6, 0, 1), target, targetReason: 'team_uncovered' }));
    const geometry = await clickRequirementAlert(page, target);
    expectHeaderBelowStack(geometry, target);
});

test('with the compact header still hidden at the landing, the header lands below the shorter stack', async ({ page }) => {
    const target = 'REV-SHORT';
    await installFixture(page, buildScenario({ epics: [{ key: 'LOW-01', stories: 1, priority: 'Low' }], target }));
    const geometry = await clickRequirementAlert(page, target);
    expect(geometry.order[0]).toBe(target);
    expect(geometry.tiers.map(tier => tier.selector)).not.toContain('.compact-sticky-header.is-visible');
    expectHeaderVisible(geometry, target);
    expect(geometry.stuckHeaders.filter(key => key !== target)).toEqual([]);
});

test('an Epic taller than the viewport centres its requirement card', async ({ page }) => {
    const target = 'REV-03';
    const epics = epicList(6, 0).map(epic => (epic.key === target ? { ...epic, stories: 30 } : epic));
    await installFixture(page, buildScenario({ epics, target, targetReason: 'team_uncovered' }));
    const geometry = await clickRequirementAlert(page, target);
    expect(geometry.blockHeight).toBeGreaterThan(geometry.innerHeight);
    const cardHeight = geometry.cardBottom - geometry.cardTop;
    const available = geometry.innerHeight - (geometry.stackBottom + 12);
    const expectedTop = geometry.stackBottom + 12 + Math.max(0, (available - cardHeight) / 2);
    expect(Math.abs(geometry.cardTop - expectedTop)).toBeLessThanOrEqual(24);
    expect(geometry.cardTop).toBeGreaterThanOrEqual(geometry.stackBottom);
    expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.innerHeight);
    expect(geometry.focused).toBe(true);
    expect(geometry.highlighted).toBe(true);
});

test('a scroll the reveal did not issue keeps the page where that scroll put it', async ({ page }) => {
    const target = 'REV-MID';
    await installFixture(page, buildScenario({ epics: epicList(5, 5), target }));
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('#eng-alert-needs-stories');
    await expect(page.locator(`.epic-block[data-epic-key="${target}"] .story-requirement-card`)).toBeVisible();
    // Click from just past the app header, so the reveal aims under the compact header that the top of the page does not have.
    await page.evaluate(() => window.scrollTo({ top: document.querySelector('header').getBoundingClientRect().bottom + window.scrollY + 1, behavior: 'instant' }));
    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
    await section.locator('.alert-story').filter({ hasText: target }).locator('.alert-story-local-link').click();
    // While the reveal travels, a script scrolls the page back to the top. The browser may still apply one step of the cancelled smooth
    // scroll, so the page is read one frame later; from then on, for longer than the reveal's frame cap, it must hold there.
    const trace = await page.evaluate(async () => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        await new Promise(requestAnimationFrame);
        const held = window.scrollY;
        let maxDrift = 0;
        for (let frame = 0; frame < 200; frame += 1) {
            await new Promise(requestAnimationFrame);
            maxDrift = Math.max(maxDrift, Math.abs(window.scrollY - held));
        }
        return { held, maxDrift, innerHeight: window.innerHeight };
    });
    expect(trace.held).toBeLessThan(trace.innerHeight / 2);
    expect(trace.maxDrift).toBe(0);
});
