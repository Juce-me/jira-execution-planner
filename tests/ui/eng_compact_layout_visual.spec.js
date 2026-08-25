const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');
const { collectStickySnapshots } = require('./eng_sticky_stack_helpers');

const screenshotDir = 'test-results/eng-compact-layout-qa';
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha', 'team-beta'];

// The bar's fixed single-row height (styles/eng/filter-bar.css). D36 and §12.6 make this a
// number, not an impression: the first version of this bar stood 146px over three rows.
const BAR_ROW_HEIGHT = 42;
const BAR_TWO_ROW_HEIGHT = 80;
// Captured from the pre-change shared wrapper: the fixed 42px bar plus the existing 0.85rem
// spacer. Keeping this stable proves moving the spacer does not move the downstream sticky stack.
const FILTERBAR_WRAP_HEIGHT = 55.6;

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
});

function makeIssue({ key, project, index, status, priority, points, summary, sprintState = 'active', fields = {} }) {
    const epicKey = `${project}-EPIC`;
    const teamId = index % 2 === 0 ? 'team-alpha' : 'team-beta';
    const teamName = teamId === 'team-alpha' ? 'Alpha Team' : 'Beta Team';
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: status },
            priority: { name: priority },
            issuetype: { name: 'Story' },
            assignee: { displayName: `${teamName} Owner` },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: points,
            epicKey,
            parentSummary: `${project} compact layout epic`,
            projectKey: project,
            teamId,
            teamName,
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: sprintState }],
            ...fields,
        },
    };
}

function makeEpic(project, overrides = {}) {
    return {
        key: `${project}-EPIC`,
        summary: `${project} compact layout epic`,
        status: { name: 'In Progress' },
        assignee: { displayName: `${project} Lead` },
        teamId: project === 'PRODUCT' ? 'team-alpha' : 'team-beta',
        teamName: project === 'PRODUCT' ? 'Alpha Team' : 'Beta Team',
        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        ...overrides,
    };
}

// Deliberately spans several statuses and priorities so the Status facet has real workflow
// order, D20 has zero-count options to hide, and Status x Priority can compose.
const productTasks = [
    makeIssue({
        key: 'PRODUCT-1',
        project: 'PRODUCT',
        index: 1,
        status: 'In Progress',
        priority: 'High',
        points: 8,
        summary: 'Compact layout story with a readable but long title for filter visual QA',
    }),
    makeIssue({ key: 'PRODUCT-2', project: 'PRODUCT', index: 2, status: 'Done', priority: 'High', points: 3, summary: 'Completed product story' }),
    makeIssue({ key: 'PRODUCT-3', project: 'PRODUCT', index: 3, status: 'To Do', priority: 'Minor', points: 2, summary: 'Pending product story' }),
    makeIssue({ key: 'PRODUCT-4', project: 'PRODUCT', index: 4, status: 'Blocked', priority: 'Blocker', points: 5, summary: 'Blocked product story' }),
    makeIssue({ key: 'PRODUCT-5', project: 'PRODUCT', index: 5, status: 'Killed', priority: 'Low', points: 1, summary: 'Killed product story' }),
];
const techTasks = [
    makeIssue({ key: 'TECH-1', project: 'TECH', index: 1, status: 'Accepted', priority: 'Medium', points: 5, summary: 'Accepted tech story' }),
    makeIssue({
        key: 'TECH-2',
        project: 'TECH',
        index: 2,
        status: 'In Progress',
        priority: 'Critical',
        points: 5,
        summary: 'Compact tech story with enough text to exercise title wrapping',
    }),
];
const productEpic = makeEpic('PRODUCT');
const techEpic = makeEpic('TECH');
const closedSprintProductTasks = [
    makeIssue({ key: 'PRODUCT-10', project: 'PRODUCT', index: 2, status: 'Done', priority: 'High', points: 5, summary: 'Closed sprint done story', sprintState: 'closed' }),
    makeIssue({ key: 'PRODUCT-11', project: 'PRODUCT', index: 4, status: 'Killed', priority: 'Minor', points: 3, summary: 'Closed sprint killed story', sprintState: 'closed' }),
    makeIssue({ key: 'PRODUCT-12', project: 'PRODUCT', index: 6, status: 'In Progress', priority: 'Major', points: 2, summary: 'Closed sprint stale in progress story', sprintState: 'closed' }),
];
const alertMissingInfoTasks = [
    makeIssue({
        key: 'PRODUCT-ALERT-1',
        project: 'PRODUCT',
        index: 8,
        status: 'To Do',
        priority: 'High',
        points: null,
        summary: 'Compact layout missing estimate alert story',
        fields: { missingFields: ['Story Points'] },
    }),
];

async function waitForVisualSettled(page) {
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document.getAnimations({ subtree: true });
        if (animations.length > 0) {
            await Promise.race([
                Promise.all(animations.map(animation => animation.finished.catch(() => undefined))),
                new Promise(resolve => window.setTimeout(resolve, 1200)),
            ]);
        }
        await new Promise(requestAnimationFrame);
    });
}

async function measureFilterbarWrapper(page) {
    return page.locator('.filterbar-wrap').evaluate((wrap) => {
        const bar = wrap.querySelector(':scope > .filterbar');
        const wrapRect = wrap.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        const styles = getComputedStyle(wrap);
        return {
            topInset: barRect.top - wrapRect.top,
            bottomInset: wrapRect.bottom - barRect.bottom,
            paddingBottom: parseFloat(styles.paddingBottom) || 0,
            heightIdentity: wrapRect.height - barRect.height
                - (barRect.top - wrapRect.top)
                - (wrapRect.bottom - barRect.bottom),
            wrapperHeight: wrapRect.height,
        };
    });
}

async function measureInitiativeTooltipLayer(page, activation, screenshotName) {
    const grouping = page.getByRole('button', { name: 'Group by Initiative' });
    const tooltip = page.getByRole('tooltip');

    await page.mouse.move(0, 0);
    if (activation === 'hover') {
        await grouping.hover();
    } else {
        const sortToggle = page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle');
        await sortToggle.focus();
        await page.keyboard.press('Tab');
        await expect(grouping).toBeFocused();
    }
    await expect(tooltip).toHaveCSS('opacity', '1');
    await waitForVisualSettled(page);
    const layer = await tooltip.evaluate((node) => {
        const button = node.parentElement.querySelector('button[aria-label="Group by Initiative"]');
        const tooltipRect = node.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const previousPointerEvents = node.style.pointerEvents;
        node.style.pointerEvents = 'auto';
        const hit = document.elementFromPoint(
            tooltipRect.left + tooltipRect.width / 2,
            tooltipRect.top + tooltipRect.height / 2
        );
        node.style.pointerEvents = previousPointerEvents;
        return {
            belowButton: tooltipRect.top >= buttonRect.bottom,
            ownsHitPoint: Boolean(hit && node.contains(hit)),
        };
    });
    await page.screenshot({ path: `${screenshotDir}/${screenshotName}.png`, fullPage: false });
    return layer;
}

async function installEngCompactFixture(page, options = {}) {
    const sprintState = options.sprintState || 'active';
    const productIssueSource = options.productTasks || productTasks;
    const techIssueSource = options.techTasks || techTasks;
    const initiative = options.withInitiativeData
        ? { key: 'INIT-COMPACT', summary: 'Compact layout initiative' }
        : null;
    const productEpicForResponse = initiative ? makeEpic('PRODUCT', { initiative }) : productEpic;
    const techEpicForResponse = initiative ? makeEpic('TECH', { initiative }) : techEpic;
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
                    teamLabels: { 'team-alpha': 'Alpha Team', 'team-beta': 'Beta Team' },
                }],
                defaultGroupId: 'grp-default',
                source: 'test',
            });
        }
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: sprintState }] });
        }
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const tasks = project === 'tech' ? techIssueSource : productIssueSource;
            const epic = project === 'tech' ? techEpicForResponse : productEpicForResponse;
            return json({
                issues: purpose === 'ready-to-close' ? [] : tasks,
                epics: { [epic.key]: epic },
                epicsInScope: [epic],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') {
            return json({
                issues: alertMissingInfoTasks,
                epics: [],
                count: alertMissingInfoTasks.length,
                epicCount: 0,
            });
        }
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
}

async function openEngCatchUp(page, viewport, options = {}) {
    await page.setViewportSize(viewport);
    await installEngCompactFixture(page, options);
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
        activeGroupId: 'grp-default',
        showPlanning: false,
        showScenario: false,
        showAlertsPanel: true,
        ...(options.prefs || {}),
    });

    if (options.planningSelection) {
        await page.addInitScript(({ scopeKey, keys }) => {
            window.localStorage.setItem('jira_dashboard_planning_state_v1', JSON.stringify({
                [scopeKey]: { selectedTaskKeys: keys, selectedTeams: ['all'], selectionMode: 'manual' },
            }));
        }, { scopeKey: planningScopeKey, keys: options.planningSelection });
    }

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const expectedSurface = options.expectedSurface || 'catch-up';
    if (expectedSurface === 'planning') {
        await expect(page.locator('.planning-panel.open')).toBeVisible();
    } else {
        expect(expectedSurface).toBe('catch-up');
        await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    }
    await expect(page.locator('.filterbar')).toBeVisible();
    if (!options.expectEmptyList) {
        await expect(page.locator('.task-list:not(.epm-issue-board) .epic-block').first()).toBeVisible();
    }
    await waitForVisualSettled(page);
}

const planningScopeKey = `planning::${selectedSprintId}::grp-default`;

function persistedPlanningKeys(page) {
    return page.evaluate((scopeKey) => {
        const raw = window.localStorage.getItem('jira_dashboard_planning_state_v1');
        const scoped = raw ? (JSON.parse(raw)[scopeKey] || {}) : {};
        return (scoped.selectedTaskKeys || []).slice().sort();
    }, planningScopeKey);
}

const popover = (page) => page.locator('.popover');
const facetGroup = (page, facetId) => popover(page).locator(`.pop-group[data-facet="${facetId}"]`);
const facetOption = (page, facetId, optionId) => facetGroup(page, facetId).locator(`.pop-opt[data-option="${optionId}"]`);

async function openFilters(page) {
    if (await popover(page).count() === 0) {
        await page.locator('.fb-trigger').click();
    }
    await expect(popover(page)).toBeVisible();
}

async function closeFilters(page) {
    if (await popover(page).count() > 0) {
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
    }
}

// A plain click, never click({ force: true }): forcing is exactly what masks the layering bug
// D28's hit-test exists to catch (§10.2).
async function tickOption(page, facetId, optionId) {
    await openFilters(page);
    await facetOption(page, facetId, optionId).click();
}

// Sorted: these assertions are about which stories survive the facets, not about the epic
// ordering, which the Sort control owns and eng_epic_sort_and_track.spec.js covers.
function storyKeys(page) {
    return page.locator('.task-list:not(.epm-issue-board) .task-item').evaluateAll(
        items => items.map(item => item.getAttribute('data-task-key')).sort()
    );
}

// Every text-bearing element in the bar, measured on itself. A container's bounding box cannot
// see overflowing nowrap text, which is how a filter-bar layout bug passed review before
// (MRT020).
async function measureBar(page, baselineOverflow = 1) {
    const metrics = await page.evaluate(() => {
        const bar = document.querySelector('.filterbar');
        const barRect = bar.getBoundingClientRect();
        const wrapRect = bar.closest('.filterbar-wrap').getBoundingClientRect();
        const viewControlsRect = bar.querySelector('.fb-view-controls')?.getBoundingClientRect();
        // Rows by clustering the children's vertical centres: align-items: center gives each
        // child a different `top`, so distinct tops would count four rows on a single line.
        const centres = [...bar.children]
            .map(child => child.getBoundingClientRect())
            .filter(rect => rect.height > 0)
            .map(rect => rect.top + rect.height / 2)
            .sort((a, b) => a - b);
        const rows = centres.reduce((lines, centre) => (
            lines.length && centre - lines[lines.length - 1] < 12 ? lines : [...lines, centre]
        ), []);
        const labelSelectors = [
            '.fb-trigger',
            '.fb-trigger .badge',
            '.fb-readout b',
            '.fb-readout .dim',
            '.chip:not([hidden]) .facet',
            '.chip:not([hidden]) .verb',
            '.chip:not([hidden]) .names',
            '.chip-more:not([hidden])',
            '.chip-clear',
            '.sprint-dropdown-toggle .cap',
            '.sprint-dropdown-toggle span:not(.cap)',
            '.initiative-grouping-control',
        ];
        const labels = labelSelectors.flatMap(selector => [...bar.querySelectorAll(selector)].map(node => ({
            selector,
            text: node.textContent.trim().slice(0, 40),
            clipped: node.scrollWidth - node.clientWidth,
            right: node.getBoundingClientRect().right,
            groupRight: node.closest('.pop-host, .fb-readout, .chip, .chip-clear, .fb-view-controls, .sprint-dropdown, .initiative-grouping-control')
                .getBoundingClientRect().right,
        })));
        const lane = bar.querySelector('.fb-chips');
        const more = bar.querySelector('.chip-more');
        return {
            height: barRect.height,
            width: barRect.width,
            leftInset: barRect.left - wrapRect.left,
            rightInset: wrapRect.right - barRect.right,
            viewControlsRightInset: viewControlsRect ? barRect.right - viewControlsRect.right : null,
            containerWidth: bar.closest('.container').getBoundingClientRect().width,
            rows: rows.length,
            labels,
            chipsTotal: bar.querySelectorAll('.chip:not(.chip-more)').length,
            chipsVisible: bar.querySelectorAll('.chip:not(.chip-more):not([hidden])').length,
            chipsHidden: bar.querySelectorAll('.chip:not(.chip-more)[hidden]').length,
            moreHidden: more ? more.hidden : null,
            moreText: more && !more.hidden ? more.textContent.trim() : '',
            laneOverflow: lane.scrollWidth - lane.clientWidth,
            moreClippedByLane: (() => {
                const node = bar.querySelector('.chip-more');
                if (!node || node.hidden) return 0;
                const rect = node.getBoundingClientRect();
                return Math.round(Math.max(0, rect.right - lane.getBoundingClientRect().right));
            })(),
            clear: (() => {
                const node = bar.querySelector('.chip-clear');
                if (!node) return null;
                const rect = node.getBoundingClientRect();
                const laneRect = lane.getBoundingClientRect();
                return {
                    width: Math.round(rect.width),
                    clippedByLane: Math.round(Math.max(0, rect.right - laneRect.right, laneRect.left - rect.left)),
                };
            })(),
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    return { ...metrics, baselineOverflow: Math.max(1, baselineOverflow) };
}

function expectNoClipping(metrics, { laneMayClip = false } = {}) {
    metrics.labels.forEach(label => {
        expect(label.clipped, `${label.selector} ("${label.text}") is clipped`).toBeLessThanOrEqual(1);
        expect(label.right, `${label.selector} ("${label.text}") overflows its group`)
            .toBeLessThanOrEqual(label.groupRight + 1);
    });
    // Clear all is the one control that never collapses (§7.6), so it must sit wholly inside
    // the lane's clip at every width — including the two where the lane does clip.
    expect(metrics.clear.clippedByLane, 'Clear all is clipped by the chips lane').toBe(0);
    if (!laneMayClip) {
        expect(metrics.laneOverflow).toBeLessThanOrEqual(1);
    }
    expect(metrics.documentOverflow).toBeLessThanOrEqual(metrics.baselineOverflow);
}

// Status, Priority and Projects all narrowed: the three-facet state §7.6 measures.
async function activateThreeFacets(page) {
    await tickOption(page, 'status', 'Done');
    await tickOption(page, 'priority', 'Minor');
    await tickOption(page, 'projects', 'tech');
    await closeFilters(page);
    await waitForVisualSettled(page);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(3);
    await expect(page.locator('.fb-trigger .badge')).toHaveText('3');
}

async function expectAlertPanelToggleStates(page) {
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    await expect(page.locator('.alert-panels')).toBeVisible();

    await page.locator('.alerts-panel-toggle').click();
    await waitForVisualSettled(page);
    await expect(page.locator('.alert-panels')).toBeHidden();

    await page.locator('.alerts-panel-toggle').click();
    await waitForVisualSettled(page);
    await expect(page.locator('.alert-panels')).toBeVisible();
}

async function expectSprintOptionsStaySingleLine(page) {
    await page.evaluate(() => window.scrollTo(0, 420));
    await expect(page.locator('.compact-sticky-header.is-visible')).toBeVisible();
    const sprintDropdown = page.locator('.compact-sticky-header .sprint-dropdown').first();
    await sprintDropdown.locator('.sprint-dropdown-toggle').click();
    await expect(sprintDropdown.locator('.sprint-dropdown-panel')).toBeVisible();
    const metrics = await sprintDropdown.locator('.sprint-dropdown-option').evaluateAll((options) => {
        return options.map(option => {
            const style = getComputedStyle(option);
            const range = document.createRange();
            range.selectNodeContents(option);
            const lineTops = Array.from(range.getClientRects())
                .filter(rect => rect.width > 0 && rect.height > 0)
                .map(rect => Math.round(rect.top));
            range.detach();
            return {
                lines: new Set(lineTops).size,
                overflowX: option.scrollWidth - option.clientWidth,
                whiteSpace: style.whiteSpace,
            };
        });
    });
    metrics.forEach(metric => {
        expect(metric.lines).toBe(1);
        expect(metric.overflowX).toBeLessThanOrEqual(1);
        expect(metric.whiteSpace).toBe('nowrap');
    });
    await page.screenshot({ path: `${screenshotDir}/desktop-sticky-sprint-dropdown.png`, fullPage: false });
}

test('the filter bar holds one row at desktop widths with every facet active', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await expectAlertPanelToggleStates(page);
    await activateThreeFacets(page);

    const wide = await measureBar(page);
    expect(wide.height).toBe(BAR_ROW_HEIGHT);
    expect(wide.rows).toBe(1);
    // The clear controls use their intended 16px icon slots, so the three-facet state fits at
    // 1440 without collapsing. The numbers are pinned rather than bounded: this is the row that
    // regressed to three rows once, and a `>= 1` here proves nothing.
    expect(wide.chipsTotal).toBe(3);
    expect(wide.chipsVisible).toBe(3);
    expect(wide.chipsHidden).toBe(0);
    expect(wide.moreText).toBe('');
    expect(Math.abs(wide.leftInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.rightInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.viewControlsRightInset)).toBeLessThanOrEqual(10);
    expectNoClipping(wide);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-1440.png` });

    for (const width of [1280, 960, 800]) {
        await page.setViewportSize({ width, height: 900 });
        await waitForVisualSettled(page);
        const metrics = await measureBar(page);
        expect(metrics.height, `bar height at ${width}`).toBe(BAR_ROW_HEIGHT);
        expect(metrics.rows, `bar rows at ${width}`).toBe(1);
        expect(metrics.chipsVisible + metrics.chipsHidden).toBe(3);
        expect(metrics.clear.width, `Clear all collapsed at ${width}`).toBeGreaterThan(0);
        expect(Math.abs(metrics.leftInset), `bar left inset at ${width}`).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.rightInset), `bar right inset at ${width}`).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.viewControlsRightInset), `view controls right inset at ${width}`).toBeLessThanOrEqual(10);
        expectNoClipping(metrics);
    }

    // D36: the lane collapses rather than the bar wrapping, and the count is the truth.
    await page.setViewportSize({ width: 960, height: 900 });
    await waitForVisualSettled(page);
    const narrow = await measureBar(page);
    expect(narrow.chipsHidden).toBeGreaterThan(0);
    // The width has to buy chips: 960 must show strictly fewer than 1440 did, which is the
    // part of §7.6's table the app's content-width bar can actually be held to.
    expect(narrow.chipsVisible).toBeLessThan(wide.chipsVisible);
    expect(narrow.moreText).toBe(`+${narrow.chipsHidden} more`);
    expect(narrow.height).toBe(BAR_ROW_HEIGHT);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-960.png` });
});

test('the filter bar takes at most two rows below 720px', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await activateThreeFacets(page);

    for (const width of [375, 360]) {
        await page.setViewportSize({ width, height: 760 });
        await waitForVisualSettled(page);
        const baseline = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        const metrics = await measureBar(page, baseline);
        expect(metrics.rows, `bar rows at ${width}`).toBe(2);
        expect(Math.round(metrics.height), `bar height at ${width}`).toBeLessThanOrEqual(BAR_TWO_ROW_HEIGHT);
        expect(metrics.clear.width, `Clear all collapsed at ${width}`).toBeGreaterThan(0);
        // At this width the lane cannot hold both "+n more" and Clear all; Clear all wins and
        // the residue falls on "+n more", whose only job is reopening the popover.
        expect(metrics.chipsHidden, `chips collapsed at ${width}`).toBe(3);
        expect(metrics.moreClippedByLane, `"+n more" clipping at ${width}`).toBeLessThanOrEqual(40);
        expectNoClipping(metrics, { laneMayClip: true });
    }
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-360.png` });

    await page.setViewportSize({ width: 375, height: 600 });
    await waitForVisualSettled(page);
    const narrowSnapshots = await collectStickySnapshots(page, waitForVisualSettled);
    const narrowPinned = narrowSnapshots.find(result => result.compactVisible && result.filterbarPinned && result.pinnedEpic);
    expect(narrowPinned, 'expected a narrow two-row pinned epic witness').toBeTruthy();
    expect(narrowPinned.filterbarWrap.height).toBeGreaterThan(narrowPinned.filterbar.height);
    expect(Math.abs(narrowPinned.epic.top - narrowPinned.filterbarWrap.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(
        (narrowPinned.epicStickyTop - narrowPinned.filterbarStickyTop) - narrowPinned.filterbarWrap.height
    )).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${screenshotDir}/catch-up-sticky-stack-375.png`, fullPage: false });
});

test('Catch Up exposes the compact, filter-bar, and pinned-epic sticky stack', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 600 });
    const filterbarGeometry = await measureFilterbarWrapper(page);
    expect(filterbarGeometry.topInset, `Catch Up filter-bar geometry: ${JSON.stringify(filterbarGeometry)}`).toBeLessThanOrEqual(1);
    expect(filterbarGeometry.bottomInset, `Catch Up filter-bar geometry: ${JSON.stringify(filterbarGeometry)}`).toBeGreaterThan(1);
    expect(Math.abs(filterbarGeometry.bottomInset - filterbarGeometry.paddingBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(filterbarGeometry.heightIdentity)).toBeLessThanOrEqual(1);
    expect(Math.abs(filterbarGeometry.wrapperHeight - FILTERBAR_WRAP_HEIGHT)).toBeLessThanOrEqual(1);
    const snapshots = await collectStickySnapshots(page, waitForVisualSettled);
    const stickyWitnesses = snapshots.filter(result => result.compactVisible && result.filterbarPinned);
    expect(stickyWitnesses.length, 'expected the compact header and filter bar to pin').toBeGreaterThan(0);
    stickyWitnesses.forEach((result) => {
        expect(Math.abs(result.filterbarWrap.top - result.compact.bottom)).toBeLessThanOrEqual(1);
        expect(result.filterbarOwnsPoint, `filter bar lost its band at scroll ${result.scrollY}`).toBe(true);
    });
    const pinned = stickyWitnesses.filter(result => result.pinnedEpic);
    expect(pinned.length, 'expected at least one pinned epic-header witness').toBeGreaterThan(0);
    pinned.forEach((result) => {
        expect(result.filterbarWrap.bottom).toBeLessThanOrEqual(result.epic.top + 1);
        expect(Math.abs(result.epic.top - result.filterbarWrap.bottom)).toBeLessThanOrEqual(1);
        expect(Math.abs((result.epicStickyTop - result.filterbarStickyTop) - result.filterbarWrap.height)).toBeLessThanOrEqual(1);
        expect(result.epicOwnsPoint, `epic header lost its band at scroll ${result.scrollY}`).toBe(true);
    });
    await page.screenshot({ path: `${screenshotDir}/catch-up-sticky-stack.png`, fullPage: false });
});

test('Planning orders compact, planning, filter bar, and pinned epic without overlap', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 600 }, {
        expectedSurface: 'planning',
        prefs: { showPlanning: true },
        planningSelection: ['PRODUCT-1', 'TECH-2'],
    });
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    const snapshots = await collectStickySnapshots(page, waitForVisualSettled);
    const witnesses = snapshots.filter(result => (
        result.compactVisible && result.planning && result.filterbarPinned && result.pinnedEpic
    ));
    expect(witnesses.length, 'expected a pinned four-layer Planning witness').toBeGreaterThan(0);
    witnesses.forEach((result) => {
        expect(Math.abs(result.planning.top - result.compact.bottom)).toBeLessThanOrEqual(1);
        expect(Math.abs(result.filterbarWrap.top - result.planning.bottom)).toBeLessThanOrEqual(1);
        expect(result.filterbarWrap.bottom).toBeLessThanOrEqual(result.epic.top + 1);
        expect(Math.abs(result.epic.top - result.filterbarWrap.bottom)).toBeLessThanOrEqual(1);
        expect(result.filterbarOwnsPoint).toBe(true);
        expect(result.epicOwnsPoint).toBe(true);
    });
    await page.screenshot({ path: `${screenshotDir}/planning-sticky-stack.png`, fullPage: false });

    await openFilters(page);
    const option = facetOption(page, 'status', 'Done');
    const optionOwnsPoint = await option.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.popover'));
    });
    expect(optionOwnsPoint).toBe(true);
    await option.click();
    await closeFilters(page);

    const sort = page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle');
    await sort.click();
    const sortOption = page.locator('.eng-epic-sort-dropdown .sprint-dropdown-option:not(.selected)').first();
    const sortOwnsPoint = await sortOption.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.sprint-dropdown-panel'));
    });
    expect(sortOwnsPoint).toBe(true);
    await sortOption.click();
});

test('Initiative tooltip clears higher sticky layers in Catch Up and Planning for hover and keyboard focus', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 600 }, { withInitiativeData: true });

    const pinCurrentSurface = async (planning) => {
        const snapshots = await collectStickySnapshots(page, waitForVisualSettled);
        const witness = snapshots.find(result => (
            result.compactVisible && result.filterbarPinned && (!planning || result.planning)
        ));
        expect(witness, `expected a pinned ${planning ? 'Planning' : 'Catch Up'} tooltip witness`).toBeTruthy();
        await page.evaluate(y => window.scrollTo(0, y), witness.scrollY);
        await waitForVisualSettled(page);
    };

    await pinCurrentSurface(false);
    const results = {
        catchUp: {
            hover: await measureInitiativeTooltipLayer(page, 'hover', 'initiative-grouping-tooltip-catch-up-hover'),
            focus: await measureInitiativeTooltipLayer(page, 'focus', 'initiative-grouping-tooltip-catch-up-focus'),
        },
    };

    await page.locator('.compact-sticky-header.is-visible .eng-mode-control')
        .getByRole('radio', { name: 'Planning' })
        .click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await pinCurrentSurface(true);
    results.planning = {
        hover: await measureInitiativeTooltipLayer(page, 'hover', 'initiative-grouping-tooltip-planning-hover'),
        focus: await measureInitiativeTooltipLayer(page, 'focus', 'initiative-grouping-tooltip-planning-focus'),
    };

    const visibleAboveContent = { belowButton: true, ownsHitPoint: true };
    expect(results).toEqual({
        catchUp: { hover: visibleAboveContent, focus: visibleAboveContent },
        planning: { hover: visibleAboveContent, focus: visibleAboveContent },
    });
});

test('the popover opens over the list and its options take a plain click', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 360));
    await waitForVisualSettled(page);
    await openFilters(page);

    // §12.3: the bar states its subject, and the facet set is Catch Up's.
    await expect(popover(page).locator('.pop-subject')).toHaveText('Filtering stories');
    await expect(popover(page).locator('.pop-group')).toHaveCount(3);
    await expect(popover(page).locator('.pop-facet')).toHaveText(['Status', 'Priority', 'Projects']);
    await expect(facetGroup(page, 'track')).toHaveCount(0);
    await expect(facetGroup(page, 'assignee')).toHaveCount(0);

    const option = facetOption(page, 'status', 'Done');
    const reachable = await option.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && node.contains(hit));
    });
    expect(reachable, 'a popover option was covered by the list below it').toBe(true);
    await option.click();
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(1);
});

test('the popover fits a short viewport and its last facet stays reachable', async ({ page }) => {
    await openEngCatchUp(page, { width: 375, height: 667 });
    // Baseline: this page already overflows 375 by a few px through the capacity grid and the
    // mode control, neither of which this change touches. The popover must add nothing.
    const baselineOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    await openFilters(page);
    const fit = await popover(page).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
            withinViewport: rect.bottom <= window.innerHeight + 1 && rect.right <= document.documentElement.clientWidth + 1,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    expect(fit.withinViewport).toBe(true);
    expect(fit.documentOverflow).toBeLessThanOrEqual(baselineOverflow);

    const last = facetGroup(page, 'projects').locator('.pop-opt').last();
    await last.scrollIntoViewIfNeeded();
    const reachable = await last.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && node.contains(hit));
    });
    expect(reachable, 'the last facet option is off screen at 375x667').toBe(true);
});

test('Status and Priority compose, which the old single select could not do', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    const everything = await storyKeys(page);
    expect(everything).toEqual(['PRODUCT-1', 'PRODUCT-2', 'PRODUCT-3', 'PRODUCT-4', 'TECH-1', 'TECH-2']);

    // Status = {In Progress, Blocked}: untick everything else.
    await openFilters(page);
    for (const status of ['To Do', 'Accepted', 'Done']) {
        await facetOption(page, 'status', status).click();
    }
    await closeFilters(page);
    const statusOnly = await storyKeys(page);
    expect(statusOnly).toEqual(['PRODUCT-1', 'PRODUCT-4', 'TECH-2']);

    // Priority = {Blocker, Major}: untick Critical, Minor and Low. TECH-2 is In Progress and
    // Critical, so it passes Status but not Priority — the combination has to be strictly
    // narrower than Status alone, not merely no wider.
    await openFilters(page);
    for (const priority of ['Critical', 'Minor', 'Low']) {
        await facetOption(page, 'priority', priority).click();
    }
    await closeFilters(page);
    const both = await storyKeys(page);
    expect(both).toEqual(['PRODUCT-1', 'PRODUCT-4']);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(2);
    await expect(page.locator('.fb-trigger .badge')).toHaveText('2');

    // Re-tick the statuses to leave Priority filtering alone: PRODUCT-2 is Done and Major, so
    // it passes Priority but not Status. The pair is strictly narrower than either facet.
    await openFilters(page);
    for (const status of ['To Do', 'Accepted', 'Done']) {
        await facetOption(page, 'status', status).click();
    }
    await closeFilters(page);
    const priorityOnly = await storyKeys(page);
    expect(priorityOnly).toEqual(['PRODUCT-1', 'PRODUCT-2', 'PRODUCT-4']);
    expect(both.length).toBeLessThan(statusOnly.length);
    expect(both.length).toBeLessThan(priorityOnly.length);
    // Status is back at its default Killed exclusion, which is a chip of its own.
    await expect(page.locator('.filterbar .chip .facet')).toHaveText(['Status', 'Priority']);
    await expect(page.locator('.filterbar .chip .names').first()).toHaveText('Killed');

    // Narrowing priority further proves the two dimensions really are independent.
    await openFilters(page);
    await facetOption(page, 'priority', 'Major').click();
    await closeFilters(page);
    expect(await storyKeys(page)).toEqual(['PRODUCT-4']);
    await expect(page.locator('.fb-readout b')).toHaveText('1');
});

test('a Status narrowing leaves the saved planning selection alone', async ({ page }) => {
    // Only the Done and Killed Display toggles ever reached baseFilteredTasks, and both were
    // exclusions. An `{ only: [...] }` narrowing must not prune — and then persist — a saved
    // planning selection, which is a user artifact no status filter could touch before.
    await openEngCatchUp(page, { width: 1440, height: 900 }, {
        planningSelection: ['PRODUCT-1', 'PRODUCT-2'],
    });
    expect(await persistedPlanningKeys(page)).toEqual(['PRODUCT-1', 'PRODUCT-2']);

    // Status = {In Progress}: PRODUCT-2 is Done, so it leaves the list.
    await openFilters(page);
    for (const status of ['To Do', 'Accepted', 'Blocked', 'Done']) {
        await facetOption(page, 'status', status).click();
    }
    await closeFilters(page);
    expect(await storyKeys(page)).toEqual(['PRODUCT-1', 'TECH-2']);
    expect(await persistedPlanningKeys(page)).toEqual(['PRODUCT-1', 'PRODUCT-2']);
});

test('the readout is the real filtered count and an empty result says so', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await expect(page.locator('.fb-readout b')).toHaveText('6');
    await expect(page.locator('.fb-readout .dim')).toHaveText('of 7 stories');

    // Killed is hidden by default but still counted in scope, so it can be ticked back on.
    await openFilters(page);
    await expect(facetOption(page, 'status', 'Killed')).toHaveCount(1);
    await facetOption(page, 'status', 'Killed').click();
    await closeFilters(page);
    await expect(page.locator('.fb-readout b')).toHaveText('7');
    await expect(page.locator('.task-list:not(.epm-issue-board)')).toContainText('Killed product story');

    // An epic with no matching story renders no header at all.
    await openFilters(page);
    await facetOption(page, 'projects', 'tech').click();
    await closeFilters(page);
    await expect(page.locator('.task-list:not(.epm-issue-board) .epic-block')).toHaveCount(1);
    await expect(page.locator('.epic-key')).toHaveText(/PRODUCT-EPIC/);
});

test('a status with no story in scope is absent from the facet', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 }, {
        productTasks: [productTasks[0]],
        techTasks: [],
    });
    await openFilters(page);
    const statuses = await facetGroup(page, 'status').locator('.pop-opt').evaluateAll(
        options => options.map(option => option.getAttribute('data-option'))
    );
    expect(statuses).toEqual(['In Progress']);
    // The one remaining option locks rather than emptying the facet (§7.3).
    await expect(facetOption(page, 'status', 'In Progress')).toHaveClass(/is-locked/);
    await expect(facetOption(page, 'status', 'In Progress')).toHaveAttribute('aria-disabled', 'true');
    await expect(facetOption(page, 'status', 'In Progress')).toHaveAttribute('title', /Keep at least one/);
    await expect(page.locator('.task-list:not(.epm-issue-board) .task-item')).toHaveCount(1);
});

test('Status options read in workflow order, not alphabetically', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await openFilters(page);
    const statuses = await facetGroup(page, 'status').locator('.pop-opt').evaluateAll(
        options => options.map(option => option.getAttribute('data-option'))
    );
    expect(statuses).toEqual(['To Do', 'Accepted', 'Blocked', 'In Progress', 'Done', 'Killed']);
});

test('sort and grouping are view controls in the bar and render no chip', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 }, { withInitiativeData: true });

    const viewControls = page.locator('.filterbar .fb-view-controls');
    await expect(viewControls.locator('.eng-epic-sort-dropdown')).toHaveCount(1);
    await expect(viewControls.locator('.initiative-grouping-control')).toHaveCount(1);

    // Only the default "Status hidden Killed" chip is present; neither view control adds one.
    const chips = page.locator('.filterbar .chip:not(.chip-more)');
    await expect(chips).toHaveCount(1);
    await expect(page.locator('.fb-trigger .badge')).toHaveText('1');

    const grouping = viewControls.getByRole('button', { name: 'Group by Initiative' });
    const sortToggle = viewControls.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle');
    await expect(grouping).toHaveAttribute('aria-pressed', 'true');
    await expect(grouping).toHaveCSS('color', 'rgb(255, 171, 0)');
    await expect(grouping).toHaveCSS('border-color', 'rgb(255, 171, 0)');
    await expect(grouping).toHaveCSS('background-color', 'rgba(255, 171, 0, 0.12)');
    await waitForVisualSettled(page);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/initiative-grouping-on.png` });

    const measureGroupingGeometry = async () => Promise.all([grouping, sortToggle].map(locator => locator.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, center: rect.top + rect.height / 2 };
    })));
    const expectGroupedControlGeometry = (geometry) => {
        expect(geometry[0].width).toBe(30);
        expect(geometry[0].height).toBe(30);
        expect(Math.abs(geometry[0].center - geometry[1].center)).toBeLessThanOrEqual(1);
    };
    const groupedGeometry = await measureGroupingGeometry();
    expectGroupedControlGeometry(groupedGeometry);

    await grouping.hover();
    await expect(viewControls.getByRole('tooltip')).toHaveText('Group by Initiative — On');
    await expect(viewControls.getByRole('tooltip')).toHaveCSS('opacity', '1');
    await expect(page.locator('.initiative-header')).toBeVisible();
    await grouping.click();
    await expect(grouping).toHaveAttribute('aria-pressed', 'false');
    await expect(grouping).toHaveCSS('color', 'rgb(102, 102, 102)');
    await expect(grouping).toHaveCSS('border-color', 'rgb(224, 221, 215)');
    await expect(grouping).toHaveCSS('background-color', 'rgb(248, 247, 244)');
    await expect(viewControls.getByRole('tooltip')).toHaveText('Group by Initiative — Off');
    await expect(page.locator('.initiative-header')).toHaveCount(0);
    await expect(chips).toHaveCount(1);
    await expect(page.locator('.fb-trigger .badge')).toHaveText('1');
    await page.mouse.move(0, 0);
    await grouping.blur();
    await waitForVisualSettled(page);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/initiative-grouping-off.png` });
    const ungroupedGeometry = await measureGroupingGeometry();
    expect(ungroupedGeometry[0]).toEqual(groupedGeometry[0]);
    await page.mouse.move(0, 0);
    await grouping.focus();
    await expect(viewControls.getByRole('tooltip')).toHaveCSS('opacity', '1');

    await page.setViewportSize({ width: 1091, height: 800 });
    await waitForVisualSettled(page);
    await grouping.scrollIntoViewIfNeeded();
    await waitForVisualSettled(page);
    const mediumOffGeometry = await measureGroupingGeometry();
    expectGroupedControlGeometry(mediumOffGeometry);
    await grouping.click();
    await expect(grouping).toHaveAttribute('aria-pressed', 'true');
    const mediumOnGeometry = await measureGroupingGeometry();
    expectGroupedControlGeometry(mediumOnGeometry);
    expect(mediumOnGeometry[0]).toEqual(mediumOffGeometry[0]);
    await grouping.click();
    await expect(grouping).toHaveAttribute('aria-pressed', 'false');

    await page.setViewportSize({ width: 375, height: 800 });
    await waitForVisualSettled(page);
    await grouping.scrollIntoViewIfNeeded();
    await waitForVisualSettled(page);
    const measureNarrowGroupingRow = async () => viewControls.evaluate((controls) => {
        const filterbar = controls.closest('.filterbar');
        const sort = controls.querySelector('.eng-epic-sort-dropdown .sprint-dropdown-toggle');
        const groupingButton = controls.querySelector('button[aria-label="Group by Initiative"]');
        const firstRowBottom = Math.max(...[...filterbar.children]
            .filter(node => node !== controls)
            .map(node => node.getBoundingClientRect().bottom));
        const sortRect = sort.getBoundingClientRect();
        const groupingRect = groupingButton.getBoundingClientRect();
        return {
            firstRowBottom,
            sortTop: sortRect.top,
            sortCenter: sortRect.top + sortRect.height / 2,
            groupingCenter: groupingRect.top + groupingRect.height / 2,
        };
    });
    const narrowOffGeometry = await measureGroupingGeometry();
    expectGroupedControlGeometry(narrowOffGeometry);
    const narrowOffRow = await measureNarrowGroupingRow();
    expect(narrowOffRow.sortTop).toBeGreaterThan(narrowOffRow.firstRowBottom);
    expect(Math.abs(narrowOffRow.sortCenter - narrowOffRow.groupingCenter)).toBeLessThanOrEqual(1);
    await grouping.click();
    await expect(grouping).toHaveAttribute('aria-pressed', 'true');
    const narrowOnGeometry = await measureGroupingGeometry();
    expectGroupedControlGeometry(narrowOnGeometry);
    expect(narrowOnGeometry[0]).toEqual(narrowOffGeometry[0]);
    const narrowOnRow = await measureNarrowGroupingRow();
    expect(narrowOnRow.sortTop).toBeGreaterThan(narrowOnRow.firstRowBottom);
    expect(Math.abs(narrowOnRow.sortCenter - narrowOnRow.groupingCenter)).toBeLessThanOrEqual(1);
    expect((await measureBar(page)).rows).toBeLessThanOrEqual(2);

    // A plain click on the sort option: no force, so this also proves the panel is not
    // painted under the task list from inside the sticky bar.
    await viewControls.locator('.sprint-dropdown-toggle').click();
    await viewControls.locator('.sprint-dropdown-option', { hasText: 'Committed ⬇' }).click();
    await expect(viewControls.locator('.sprint-dropdown-toggle')).toContainText('Committed');
    await expect(chips).toHaveCount(1);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-view-controls.png` });
});

test('an explicit grouping choice is stored and survives initiative data arriving', async ({ page }) => {
    // §2: today a useEffect recomputed groupByInitiative from hasInitiativeData and threw the
    // user's choice away every time initiative data landed.
    await openEngCatchUp(page, { width: 1440, height: 900 }, { withInitiativeData: true });
    const grouping = page.getByRole('button', { name: 'Group by Initiative' });
    await expect(grouping).toHaveAttribute('aria-pressed', 'true');
    const initial = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')));
    expect(initial.groupByInitiativeChoice).toBeNull();

    await grouping.click();
    await expect(page.locator('.initiative-header')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(
        () => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')).groupByInitiativeChoice
    )).toBe(false);

    // Refetching re-derives hasInitiativeData; the explicit choice must outlive it.
    await page.locator('button[title="Refresh tasks and sprints from Jira"]').click();
    await expect(page.locator('.task-list:not(.epm-issue-board) .epic-block').first()).toBeVisible();
    await waitForVisualSettled(page);
    await expect(page.getByRole('button', { name: 'Group by Initiative' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.initiative-header')).toHaveCount(0);
});

test('Clear all returns every facet to its default and keeps the list', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await activateThreeFacets(page);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(3);

    await page.locator('.filterbar .chip-clear').click();
    await waitForVisualSettled(page);
    // Back to the default, which is Killed hidden — the same state as showKilled: false today.
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(1);
    await expect(page.locator('.filterbar .chip .names')).toHaveText('Killed');
    await expect(page.locator('.fb-readout b')).toHaveText('6');
    expect(await storyKeys(page)).toEqual(['PRODUCT-1', 'PRODUCT-2', 'PRODUCT-3', 'PRODUCT-4', 'TECH-1', 'TECH-2']);
});

test('killed work is hidden by default and ticking Killed brings it back', async ({ page }) => {
    await openEngCatchUp(page, { width: 1792, height: 900 }, {
        sprintState: 'closed',
        productTasks: closedSprintProductTasks,
        techTasks: [],
    });

    const taskList = page.locator('.task-list:not(.epm-issue-board)');
    await expect(taskList).toContainText('Closed sprint done story');
    await expect(taskList).toContainText('Closed sprint stale in progress story');
    await expect(taskList).not.toContainText('Closed sprint killed story');
    await expect(page.locator('.filterbar .chip .names')).toHaveText('Killed');
    await expect(page.locator('.filterbar .chip .verb')).toHaveText('hidden');

    await tickOption(page, 'status', 'Killed');
    await closeFilters(page);
    await expect(taskList).toContainText('Closed sprint killed story');
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(0);
});

test('a legacy killed statusFilter still shows every story after upgrading', async ({ page }) => {
    await openEngCatchUp(page, { width: 1792, height: 900 }, {
        sprintState: 'closed',
        productTasks: closedSprintProductTasks,
        techTasks: [],
        prefs: { statusFilter: 'killed', showKilled: false },
    });

    const taskList = page.locator('.task-list:not(.epm-issue-board)');
    await expect(taskList).toContainText('Closed sprint killed story');
    await expect(taskList).toContainText('Closed sprint done story');
    await expect(taskList).toContainText('Closed sprint stale in progress story');
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(0);

    const prefs = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')));
    expect(prefs.engStatusFilter).toBeNull();
    expect(prefs.engPriorityFilter).toBeNull();
});

test('a legacy high-priority statusFilter lands on the Priority facet', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 }, {
        prefs: { statusFilter: 'high-priority', showKilled: false },
    });

    // Blocker, Critical and Major only — the same stories the old single select showed.
    expect(await storyKeys(page)).toEqual(['PRODUCT-1', 'PRODUCT-2', 'PRODUCT-4', 'TECH-2']);
    await expect(page.locator('.filterbar .chip:not(.chip-more)')).toHaveCount(2);
    const prefs = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')));
    expect(prefs.engPriorityFilter).toEqual({ only: ['Blocker', 'Critical', 'Major'] });
    expect(prefs.engStatusFilter).toEqual({ hidden: ['Killed'] });
});

test('a legacy showDone false pref keeps Done and Incomplete hidden', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 }, {
        prefs: { showDone: false, showKilled: false },
    });
    expect(await storyKeys(page)).toEqual(['PRODUCT-1', 'PRODUCT-3', 'PRODUCT-4', 'TECH-1', 'TECH-2']);
    const prefs = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')));
    expect(prefs.engStatusFilter).toEqual({ hidden: ['Killed', 'Done', 'Incomplete'] });
});

test('a selection made in one scope does not strand the bar when the scope changes', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await openFilters(page);
    for (const status of ['To Do', 'Accepted', 'In Progress', 'Blocked']) {
        await facetOption(page, 'status', status).click();
    }
    await closeFilters(page);
    expect(await storyKeys(page)).toEqual(['PRODUCT-2']);

    // Search narrows the scope to stories whose only status is In Progress, so the stored
    // Done selection has nothing left to name. It must reconcile to neutral, not blank the list.
    await page.locator('.search-input').first().fill('Compact tech story');
    await expect(page.locator('.task-list:not(.epm-issue-board)')).toContainText('Compact tech story');
    await expect(page.locator('.task-list:not(.epm-issue-board) .task-item')).toHaveCount(1);
    expect(await storyKeys(page)).toEqual(['TECH-2']);
    await expect(page.locator('.fb-trigger .badge')).toHaveCount(0);
});

test('the inherited Catch Up rows are untouched by the new chrome', async ({ page }) => {
    // §12.5: the filtered result feeding the list is the only thing that changed.
    await openEngCatchUp(page, { width: 1440, height: 900 });
    const first = page.locator('.task-list:not(.epm-issue-board) .task-item').first();
    await expect(first.locator('.task-header .task-headline .task-title')).toHaveCount(1);
    await expect(first.locator('.task-meta .status-pill.task-status')).toHaveCount(1);
    await expect(first.locator('.task-meta .task-assignee')).toHaveCount(1);
    await expect(first.locator('.task-meta .task-updated')).toHaveCount(1);
    await expect(first.locator('.task-inline-meta')).toHaveCount(1);
    await expect(page.locator('.task-list:not(.epm-issue-board) .epic-block .epic-header').first()).toBeVisible();
    const rowTemplate = await page.locator('.task-item').first().evaluate((node) => {
        const row = document.createElement('div');
        row.className = 'story-subtask-row';
        node.appendChild(row);
        const areas = getComputedStyle(row).gridTemplateAreas;
        row.remove();
        return areas;
    });
    // A bare .story-subtask-row keeps its four cells: the priority cell is a .has-priority
    // modifier the Board adds, never a change to this base rule.
    expect(rowTemplate).not.toContain('pri');
    await expect(page.locator('.filterbar-wrap')).toBeVisible();
});

test('ENG epic rows stay readable on narrow screens', async ({ page }) => {
    await openEngCatchUp(page, { width: 390, height: 760 });
    const metrics = await page.evaluate(() => {
        const parsePx = (value) => Number.parseFloat(value) || 0;
        const firstStory = document.querySelector('.task-list:not(.epm-issue-board) > .epic-block > .task-item');
        const storyStyle = getComputedStyle(firstStory);
        const title = firstStory.querySelector('.task-title');
        const epicBlock = document.querySelector('.task-list:not(.epm-issue-board) > .epic-block');
        const activeModeButton = document.querySelector('.eng-mode-control .segmented-control-button.active');
        return {
            storyPaddingTop: parsePx(storyStyle.paddingTop),
            storyPaddingLeft: parsePx(storyStyle.paddingLeft),
            storyTitleFontSize: parsePx(getComputedStyle(title).fontSize),
            titleRight: title.getBoundingClientRect().right,
            storyRight: firstStory.getBoundingClientRect().right,
            epicPaddingTop: parsePx(getComputedStyle(epicBlock).paddingTop),
            epicNameWidth: epicBlock.querySelector('.epic-name').getBoundingClientRect().width,
            activeModeButtonWhiteSpace: getComputedStyle(activeModeButton).whiteSpace,
            activeModeButtonOverflow: activeModeButton.scrollWidth - activeModeButton.clientWidth,
            modeControl: (() => {
                const control = document.querySelector('.eng-mode-control');
                const row = control.parentElement;
                return {
                    overflowX: getComputedStyle(control).overflowX,
                    scrolls: control.scrollWidth - control.clientWidth,
                    spillsRight: control.getBoundingClientRect().right - row.getBoundingClientRect().right,
                    height: Math.round(control.getBoundingClientRect().height),
                };
            })(),
            alertOverflowX: (() => {
                const toolbar = document.querySelector('.alerts-panel-toolbar');
                return toolbar.scrollWidth - toolbar.clientWidth;
            })(),
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    expect(metrics.storyPaddingTop).toBeGreaterThanOrEqual(11);
    expect(metrics.storyPaddingTop).toBeLessThanOrEqual(12);
    expect(metrics.storyPaddingLeft).toBeGreaterThanOrEqual(15);
    expect(metrics.storyPaddingLeft).toBeLessThanOrEqual(16);
    expect(metrics.storyTitleFontSize).toBeGreaterThanOrEqual(15);
    expect(metrics.storyTitleFontSize).toBeLessThanOrEqual(16);
    expect(metrics.epicPaddingTop).toBeGreaterThanOrEqual(8);
    expect(metrics.epicPaddingTop).toBeLessThanOrEqual(9);
    expect(metrics.epicNameWidth).toBeGreaterThanOrEqual(110);
    expect(metrics.activeModeButtonWhiteSpace).toBe('nowrap');
    expect(metrics.activeModeButtonOverflow).toBeLessThanOrEqual(1);
    expect(metrics.alertOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.titleRight).toBeLessThanOrEqual(metrics.storyRight + 1);
    expect(metrics.overflowX).toBeLessThanOrEqual(1);
    // Five ENG modes are wider than this row, so the control scrolls internally instead of
    // pushing the document sideways — the overflowX assertion above is what that protects.
    expect(metrics.modeControl.overflowX).toBe('auto');
    expect(metrics.modeControl.scrolls).toBeGreaterThan(0);
    expect(metrics.modeControl.spillsRight).toBeLessThanOrEqual(1);
    expect(metrics.modeControl.height).toBe(38);
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-mobile.png` });
});

test('the compact sticky header keeps its sprint options on one line', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 760 });
    await expectSprintOptionsStaySingleLine(page);
});

test('every control in the bar is legible and free of the global button styling', async ({ page }) => {
    // The app paints bare buttons as solid dark CTAs (eng/controls.css:176). A control that
    // inherits it renders --bg-primary text on the bar's white surface and carries a stray
    // 1rem right margin. Asserted per control, because a reported bug is a class of bug.
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await activateThreeFacets(page);
    await openFilters(page);
    const controls = await page.evaluate(() => {
        const selectors = ['.fb-trigger', '.chip .x', '.chip-more', '.chip-clear', '.pop-opt', '.pop-all'];
        return selectors.flatMap(selector => [...document.querySelectorAll(selector)].slice(0, 2).map(node => {
            const style = getComputedStyle(node);
            return {
                selector,
                color: style.color,
                marginRight: style.marginRight,
                clipped: node.scrollWidth - node.clientWidth,
            };
        }));
    });
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach(control => {
        // --bg-primary is the page background; text in it is invisible on the bar.
        expect(control.color, `${control.selector} uses the CTA text colour`).not.toBe('rgb(248, 247, 244)');
        expect(Number.parseFloat(control.marginRight), `${control.selector} keeps the CTA margin`).toBeLessThanOrEqual(0);
        expect(control.clipped, `${control.selector} is clipped`).toBeLessThanOrEqual(1);
    });
});

test('every facet clear control stays compact, centered, and bubble-free on hover', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 900 });
    await activateThreeFacets(page);

    const clearControls = page.locator('.filterbar .chip .x');
    await expect(clearControls).toHaveCount(3);

    const geometry = await clearControls.evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        const glyph = range.getBoundingClientRect();
        return {
            label: node.getAttribute('aria-label'),
            width: rect.width,
            height: rect.height,
            paddingInline: Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
            letterSpacing: style.letterSpacing === 'normal' ? 0 : Number.parseFloat(style.letterSpacing),
            glyphCenterOffsetX: Math.abs((glyph.left + glyph.width / 2) - (rect.left + rect.width / 2)),
            glyphCenterOffsetY: Math.abs((glyph.top + glyph.height / 2) - (rect.top + rect.height / 2)),
        };
    }));

    geometry.forEach(control => {
        expect(control.width, `${control.label} is wider than its icon slot`).toBe(16);
        expect(control.height, `${control.label} is taller than its icon slot`).toBe(16);
        expect(control.paddingInline, `${control.label} keeps global button padding`).toBe(0);
        expect(control.letterSpacing, `${control.label} keeps global button letter spacing`).toBe(0);
        expect(control.glyphCenterOffsetX, `${control.label} glyph is horizontally offset`).toBeLessThanOrEqual(1);
        expect(control.glyphCenterOffsetY, `${control.label} glyph is vertically offset`).toBeLessThanOrEqual(1);
    });

    for (const control of await clearControls.all()) {
        await control.hover();
        const hoverStyle = await control.evaluate(node => {
            const style = getComputedStyle(node);
            return {
                backgroundColor: style.backgroundColor,
                boxShadow: style.boxShadow,
                transform: style.transform,
            };
        });
        expect(hoverStyle.backgroundColor, 'facet clear hover paints a bubble').toBe('rgba(0, 0, 0, 0)');
        expect(hoverStyle.boxShadow, 'facet clear hover keeps the global CTA shadow').toBe('none');
        expect(hoverStyle.transform, 'facet clear hover keeps the global CTA lift').toBe('none');
    }

    await clearControls.first().hover();
    await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/filter-bar-clear-controls-hover.png` });
});
