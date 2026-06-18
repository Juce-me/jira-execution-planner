const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const screenshotDir = 'test-results/eng-compact-layout-qa';
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const groupTeamIds = ['team-alpha', 'team-beta'];

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
    makeIssue({
        key: 'PRODUCT-2',
        project: 'PRODUCT',
        index: 2,
        status: 'Done',
        priority: 'High',
        points: 3,
        summary: 'Completed product story',
    }),
    makeIssue({
        key: 'PRODUCT-3',
        project: 'PRODUCT',
        index: 3,
        status: 'To Do',
        priority: 'Minor',
        points: 2,
        summary: 'Pending product story',
    }),
];
const techTasks = [
    makeIssue({
        key: 'TECH-1',
        project: 'TECH',
        index: 1,
        status: 'Accepted',
        priority: 'Medium',
        points: 5,
        summary: 'Accepted tech story',
    }),
    makeIssue({
        key: 'TECH-2',
        project: 'TECH',
        index: 2,
        status: 'In Progress',
        priority: 'High',
        points: 5,
        summary: 'Compact tech story with enough text to exercise title wrapping',
    }),
];
const productEpic = makeEpic('PRODUCT');
const techEpic = makeEpic('TECH');
const closedSprintProductTasks = [
    makeIssue({
        key: 'PRODUCT-10',
        project: 'PRODUCT',
        index: 2,
        status: 'Done',
        priority: 'High',
        points: 5,
        summary: 'Closed sprint done story',
        sprintState: 'closed',
    }),
    makeIssue({
        key: 'PRODUCT-11',
        project: 'PRODUCT',
        index: 4,
        status: 'Killed',
        priority: 'Minor',
        points: 3,
        summary: 'Closed sprint killed story',
        sprintState: 'closed',
    }),
    makeIssue({
        key: 'PRODUCT-12',
        project: 'PRODUCT',
        index: 6,
        status: 'In Progress',
        priority: 'Major',
        points: 2,
        summary: 'Closed sprint stale in progress story',
        sprintState: 'closed',
    }),
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

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    await expect(page.locator('.filters-strip .status-filter-grid .stat-card')).toHaveCount(options.expectedStatCardCount || 6);
    await expect(page.locator('.task-list:not(.epm-issue-board) .epic-block').first()).toBeVisible();
    await waitForVisualSettled(page);
}

async function expectCompactLayout(page, screenshotName, { expectedCardRows = 1 } = {}) {
    await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
    const metrics = await page.evaluate(() => {
        const parsePx = (value) => Number.parseFloat(value) || 0;
        const lineCount = (node) => {
            const style = getComputedStyle(node);
            const lineHeight = parsePx(style.lineHeight) || (parsePx(style.fontSize) * 1.2);
            return Math.round(node.getBoundingClientRect().height / lineHeight);
        };
        const maxAdjacentGap = (rects) => {
            const rows = new Map();
            rects.forEach((rect) => {
                const key = Math.round(rect.top);
                rows.set(key, [...(rows.get(key) || []), rect]);
            });
            return Math.max(0, ...Array.from(rows.values()).flatMap((row) => {
                const sorted = row.slice().sort((a, b) => a.left - b.left);
                return sorted.slice(1).map((rect, index) => rect.left - sorted[index].right);
            }));
        };
        const filterStrip = document.querySelector('.filters-strip');
        const stats = document.querySelector('.filters-strip .status-filter-grid');
        const cards = Array.from(document.querySelectorAll('.filters-strip .status-filter-grid .stat-card'));
        const displayControls = document.querySelector('.display-filter-grid');
        const alertToolbar = document.querySelector('.alerts-panel-toolbar');
        const longLabel = document.querySelector('.filters-strip .todo-accepted .stat-label');
        const labelLines = cards.map(card => lineCount(card.querySelector('.stat-label')));
        const labelOverflows = cards.map(card => {
            const label = card.querySelector('.stat-label');
            return label.scrollWidth - label.clientWidth;
        });
        const cardAlignments = cards.map(card => {
            const cardRect = card.getBoundingClientRect();
            const valueRect = card.querySelector('.stat-value').getBoundingClientRect();
            const labelRect = card.querySelector('.stat-label').getBoundingClientRect();
            const noteRect = card.querySelector('.stats-note').getBoundingClientRect();
            return {
                valueLeft: valueRect.left - cardRect.left,
                valueWidth: valueRect.width,
                valueTopOffset: Math.abs((valueRect.top + valueRect.height / 2) - (cardRect.top + cardRect.height / 2)),
                labelNoteOffset: Math.abs((labelRect.left + labelRect.width / 2) - (noteRect.left + noteRect.width / 2)),
                labelLeftOfValue: (labelRect.left + labelRect.width / 2) - (valueRect.left + valueRect.width / 2),
                valueLabelGap: labelRect.left - valueRect.right,
            };
        });
        const firstStory = document.querySelector('.task-list:not(.epm-issue-board) > .epic-block > .task-item');
        const storyStyle = getComputedStyle(firstStory);
        const title = firstStory.querySelector('.task-title');
        const titleStyle = getComputedStyle(title);
        const epicBlock = document.querySelector('.task-list:not(.epm-issue-board) > .epic-block');
        const epicStyle = getComputedStyle(epicBlock);
        const epicName = epicBlock.querySelector('.epic-name');
        const activeModeButton = document.querySelector('.eng-mode-control .segmented-control-button.active');
        const activeModeButtonStyle = getComputedStyle(activeModeButton);
        const cardRows = new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size;
        const statsRect = stats.getBoundingClientRect();
        const cardRects = cards.map(card => card.getBoundingClientRect());
        const firstCardRect = cardRects[0];
        return {
            statsDisplay: getComputedStyle(stats).display,
            statsColumnGap: parsePx(getComputedStyle(stats).columnGap),
            maxStatGap: maxAdjacentGap(cardRects),
            cardRows,
            firstCardLeftGap: firstCardRect.left - statsRect.left,
            cardWidths: cards.map(card => card.getBoundingClientRect().width),
            cardHeights: cards.map(card => card.getBoundingClientRect().height),
            labelFontSize: parsePx(getComputedStyle(longLabel).fontSize),
            noteFontSize: parsePx(getComputedStyle(document.querySelector('.filters-strip .todo-accepted .stats-note')).fontSize),
            labelLines,
            labelOverflows,
            maxLabelLines: Math.max(...labelLines),
            maxLabelOverflow: Math.max(...labelOverflows),
            cardAlignments,
            filterOverflowX: filterStrip.scrollWidth - filterStrip.clientWidth,
            displayOverflowX: displayControls.scrollWidth - displayControls.clientWidth,
            alertOverflowX: alertToolbar.scrollWidth - alertToolbar.clientWidth,
            storyPaddingTop: parsePx(storyStyle.paddingTop),
            storyPaddingLeft: parsePx(storyStyle.paddingLeft),
            storyTitleFontSize: parsePx(titleStyle.fontSize),
            titleRight: title.getBoundingClientRect().right,
            storyRight: firstStory.getBoundingClientRect().right,
            epicNameWidth: epicName.getBoundingClientRect().width,
            epicPaddingTop: parsePx(epicStyle.paddingTop),
            activeModeButtonWhiteSpace: activeModeButtonStyle.whiteSpace,
            activeModeButtonOverflow: activeModeButton.scrollWidth - activeModeButton.clientWidth,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

    expect(metrics.statsDisplay).toBe('grid');
    expect(metrics.statsColumnGap).toBeLessThanOrEqual(12);
    expect(metrics.maxStatGap).toBeLessThanOrEqual(12);
    expect(metrics.cardRows).toBe(expectedCardRows);
    expect(metrics.firstCardLeftGap).toBeLessThanOrEqual(1);
    expect(Math.max(...metrics.cardWidths)).toBeLessThanOrEqual(208);
    expect(Math.min(...metrics.cardWidths)).toBeGreaterThanOrEqual(110);
    expect(Math.max(...metrics.cardHeights)).toBeLessThanOrEqual(58);
    expect(metrics.labelFontSize).toBeGreaterThanOrEqual(9);
    expect(metrics.noteFontSize).toBeGreaterThanOrEqual(9);
    expect(metrics.filterOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.displayOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.alertOverflowX).toBeLessThanOrEqual(1);
    expect(metrics.maxLabelLines).toBe(1);
    expect(metrics.maxLabelOverflow).toBeLessThanOrEqual(1);
    metrics.cardAlignments.forEach(alignment => {
        expect(alignment.valueLeft).toBeGreaterThanOrEqual(8);
        expect(alignment.valueLeft).toBeLessThanOrEqual(28);
        expect(alignment.valueWidth).toBeLessThanOrEqual(30);
        expect(alignment.valueTopOffset).toBeLessThanOrEqual(2);
        expect(alignment.labelNoteOffset).toBeLessThanOrEqual(2);
        expect(alignment.labelLeftOfValue).toBeGreaterThan(38);
        expect(alignment.valueLabelGap).toBeGreaterThanOrEqual(6);
        expect(alignment.valueLabelGap).toBeLessThanOrEqual(14);
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
    expect(metrics.titleRight).toBeLessThanOrEqual(metrics.storyRight + 1);
    expect(metrics.overflowX).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${screenshotDir}/${screenshotName}.png`, fullPage: true });
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

test('ENG compact filters and epic rows stay readable on desktop', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 760 });
    await expectAlertPanelToggleStates(page);
    await expectCompactLayout(page, 'desktop');
    await expectSprintOptionsStaySingleLine(page);
});

test('ENG compact filters and epic rows stay readable on narrow screens', async ({ page }) => {
    await openEngCatchUp(page, { width: 390, height: 760 });
    await expectCompactLayout(page, 'mobile', { expectedCardRows: 3 });
});

test('Initiative grouping is a View control beside Display controls', async ({ page }) => {
    await openEngCatchUp(page, { width: 1440, height: 760 }, { withInitiativeData: true });

    const displayViewRow = page.locator('.filters-strip .display-view-row');
    await expect(displayViewRow.locator('.display-controls-section .filters-label')).toHaveText('Display');
    await expect(displayViewRow.locator('.display-view-divider')).toHaveCount(0);
    await expect(displayViewRow.locator('.view-controls-section .filters-label')).toHaveText('View');

    const initiativeToggle = displayViewRow.locator('.view-control-grid .initiative-toggle');
    await expect(initiativeToggle).toBeVisible();
    await expect(initiativeToggle).toHaveClass(/view-toggle-card/);
    await expect(initiativeToggle).not.toHaveClass(/display-filter-card/);
    await expect(page.locator('.display-filter-grid .initiative-toggle')).toHaveCount(0);
    const initiativeIconColor = await initiativeToggle.locator('.initiative-toggle-icon').evaluate((icon) => {
        return getComputedStyle(icon).color;
    });
    expect(initiativeIconColor).toBe('rgb(255, 171, 0)');
    const displayCardRows = await page.locator('.display-view-row .display-filter-grid .display-filter-card').evaluateAll((cards) => {
        return new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size;
    });
    expect(displayCardRows).toBe(1);
    const controlGaps = await page.evaluate(() => {
        const rowGaps = (selector) => {
            const rects = Array.from(document.querySelectorAll(selector))
                .map(card => card.getBoundingClientRect())
                .filter(rect => rect.width > 0 && rect.height > 0);
            const firstRowTop = Math.round(rects[0].top);
            const row = rects
                .filter(rect => Math.abs(Math.round(rect.top) - firstRowTop) <= 1)
                .sort((a, b) => a.left - b.left);
            return row.slice(1).map((rect, index) => rect.left - row[index].right);
        };
        return {
            status: rowGaps('.status-filter-grid .stat-card'),
            display: rowGaps('.display-filter-grid .display-filter-card'),
        };
    });
    const statusGap = controlGaps.status[0];
    expect(controlGaps.display.length).toBeGreaterThan(0);
    controlGaps.display.forEach(gap => {
        expect(Math.abs(gap - statusGap)).toBeLessThanOrEqual(1);
    });
    await expect(displayViewRow.locator('.display-closed-work .stat-label')).toHaveText('Done');
    const cardGeometry = await page.locator('.filters-strip .stat-card').evaluateAll((cards) => {
        return cards.map(card => {
            const cardRect = card.getBoundingClientRect();
            const valueRect = card.querySelector('.stat-value').getBoundingClientRect();
            const labelRect = card.querySelector('.stat-label').getBoundingClientRect();
            const noteRect = card.querySelector('.stats-note').getBoundingClientRect();
            return {
                width: cardRect.width,
                height: cardRect.height,
                valueLeft: valueRect.left - cardRect.left,
                valueWidth: valueRect.width,
                labelLeft: labelRect.left - cardRect.left,
                noteLeft: noteRect.left - cardRect.left,
                labelWidth: labelRect.width,
                noteWidth: noteRect.width,
            };
        });
    });
    const maxDelta = (values) => Math.max(...values) - Math.min(...values);
    expect(maxDelta(cardGeometry.map(card => card.width))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.height))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.valueLeft))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.valueWidth))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.labelLeft))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.noteLeft))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.labelWidth))).toBeLessThanOrEqual(1);
    expect(maxDelta(cardGeometry.map(card => card.noteWidth))).toBeLessThanOrEqual(1);

    const layoutBeforeToggle = await page.locator('.filters-strip .stat-card').evaluateAll((cards) => {
        return cards.map(card => {
            const cardRect = card.getBoundingClientRect();
            const valueRect = card.querySelector('.stat-value').getBoundingClientRect();
            const labelRect = card.querySelector('.stat-label').getBoundingClientRect();
            const noteRect = card.querySelector('.stats-note').getBoundingClientRect();
            return {
                left: cardRect.left,
                width: cardRect.width,
                height: cardRect.height,
                valueLeft: valueRect.left - cardRect.left,
                labelLeft: labelRect.left - cardRect.left,
                noteLeft: noteRect.left - cardRect.left,
            };
        });
    });
    const techToggle = displayViewRow.locator('.display-tech');
    await techToggle.click();
    await waitForVisualSettled(page);
    const layoutAfterToggle = await page.locator('.filters-strip .stat-card').evaluateAll((cards) => {
        return cards.map(card => {
            const cardRect = card.getBoundingClientRect();
            const valueRect = card.querySelector('.stat-value').getBoundingClientRect();
            const labelRect = card.querySelector('.stat-label').getBoundingClientRect();
            const noteRect = card.querySelector('.stats-note').getBoundingClientRect();
            return {
                left: cardRect.left,
                width: cardRect.width,
                height: cardRect.height,
                valueLeft: valueRect.left - cardRect.left,
                labelLeft: labelRect.left - cardRect.left,
                noteLeft: noteRect.left - cardRect.left,
            };
        });
    });
    expect(layoutAfterToggle).toHaveLength(layoutBeforeToggle.length);
    layoutBeforeToggle.forEach((before, index) => {
        const after = layoutAfterToggle[index];
        expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.valueLeft - before.valueLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.labelLeft - before.labelLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.noteLeft - before.noteLeft)).toBeLessThanOrEqual(1);
    });
    const displayToggleStyles = await page.evaluate(() => {
        const hiddenTech = document.querySelector('.display-tech');
        const shownProduct = document.querySelector('.display-product');
        const hiddenTechStyle = getComputedStyle(hiddenTech);
        const shownProductStyle = getComputedStyle(shownProduct);
        return {
            hiddenTechBackground: hiddenTechStyle.backgroundColor,
            hiddenTechBoxShadow: hiddenTechStyle.boxShadow,
            shownProductBackground: shownProductStyle.backgroundColor,
        };
    });
    expect(displayToggleStyles.hiddenTechBackground).toBe(displayToggleStyles.shownProductBackground);
    expect(displayToggleStyles.hiddenTechBoxShadow).toBe('none');
    await techToggle.click();
    await waitForVisualSettled(page);
    await expect(initiativeToggle).toContainText('Grouped');
    await expect(page.locator('.initiative-header')).toBeVisible();

    await initiativeToggle.click();
    await expect(initiativeToggle).toContainText('Flat');
    await expect(page.locator('.initiative-header')).toHaveCount(0);
    await page.screenshot({ path: `${screenshotDir}/desktop-display-view-controls.png`, fullPage: true });
});

test('Killed Display toggle includes killed work without a Show only card', async ({ page }) => {
    await openEngCatchUp(page, { width: 1792, height: 900 }, {
        sprintState: 'closed',
        productTasks: closedSprintProductTasks,
        techTasks: [],
        expectedStatCardCount: 6,
    });
    await expectCompactLayout(page, 'closed-sprint-filter-stats', { expectedCardRows: 1 });

    await expect(page.locator('.filters-strip .status-filter-grid .stat-card.killed')).toHaveCount(0);

    const killedToggle = page.locator('.display-filter-grid .display-killed');
    await expect(killedToggle).toBeVisible();
    await expect(killedToggle).not.toHaveClass(/applied-filter/);

    const taskList = page.locator('.task-list:not(.epm-issue-board)');
    await expect(taskList).toContainText('Closed sprint done story');
    await expect(taskList).toContainText('Closed sprint stale in progress story');
    await expect(taskList).not.toContainText('Closed sprint killed story');

    await killedToggle.click();

    await expect(killedToggle).toHaveClass(/applied-filter/);
    await expect(killedToggle).toHaveClass(/is-visible/);
    await expect(taskList).toContainText('Closed sprint killed story');
    await expect(taskList).toContainText('Closed sprint done story');
    await expect(taskList).toContainText('Closed sprint stale in progress story');
    await page.screenshot({ path: `${screenshotDir}/closed-sprint-display-killed.png`, fullPage: true });
});

test('legacy Killed status filter migrates to the Display Killed toggle', async ({ page }) => {
    await openEngCatchUp(page, { width: 1792, height: 900 }, {
        sprintState: 'closed',
        productTasks: closedSprintProductTasks,
        techTasks: [],
        expectedStatCardCount: 6,
        prefs: {
            statusFilter: 'killed',
            showKilled: false,
        },
    });

    await expect(page.locator('.filters-strip .status-filter-grid .stat-card.killed')).toHaveCount(0);

    const killedToggle = page.locator('.display-filter-grid .display-killed');
    await expect(killedToggle).toHaveClass(/applied-filter/);
    await expect(killedToggle).toHaveClass(/is-visible/);

    const taskList = page.locator('.task-list:not(.epm-issue-board)');
    await expect(taskList).toContainText('Closed sprint killed story');
    await expect(taskList).toContainText('Closed sprint done story');
    await expect(taskList).toContainText('Closed sprint stale in progress story');

    const prefs = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')));
    expect(prefs.statusFilter).toBeNull();
    expect(prefs.showKilled).toBe(true);
});
