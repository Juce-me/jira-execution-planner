const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardFixture, selectedSprintId, selectedSprintName } = require('./epm_home_token_fixture');

const root = path.resolve(__dirname, '../..');
const NOTICE_TEXT = 'Some dependencies could not be loaded.';
const READINESS_TEXT = 'Story readiness is temporarily unavailable. Jira Stories remain visible.';

function story(key, summary) {
    return {
        id: key,
        key,
        fields: {
            summary,
            status: { name: 'In Progress' },
            priority: { name: 'Medium' },
            issuetype: { name: 'Story' },
            customfield_10004: 2,
            epicKey: 'TEST-100',
            parentSummary: 'Sample epic',
            projectKey: 'TEST',
            teamId: 'sample-team',
            teamName: 'Sample Team',
            updated: '2026-03-27T12:00:00.000Z',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    };
}

const blockedBy = (key, blockerKey) => ({
    key: blockerKey,
    category: 'block',
    direction: 'inward',
    relation: 'is blocked by',
    status: 'In Progress',
    summary: `Sample blocker ${blockerKey}`,
    teamName: 'Sample Team',
    prereqKey: blockerKey,
    dependentKey: key,
});

const partialMap = { 'TEST-1': [blockedBy('TEST-1', 'TEST-9')] };
const completeMap = { ...partialMap, 'TEST-2': [blockedBy('TEST-2', 'TEST-8')] };

// Opens Catch Up with two Stories. `replies` answers /api/dependencies call by call (the last entry repeats):
// { status, json } is fulfilled, { abort: true } fails the request.
async function openCatchUp(page, { replies, readiness = 'ready', otherSprint = null }) {
    const fixture = await installDashboardFixture(page);
    const dependencyCalls = [];
    await page.addInitScript((prefs) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, { selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName });
    await page.route('**/api/groups-config', route => route.fulfill({ json: {
        version: 1, groups: [{ id: 'sample-group', name: 'Sample Department', teamIds: ['sample-team'] }],
        defaultGroupId: 'sample-group', source: 'workspace_db', preferences: {
            customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            visibleGroupIds: ['sample-group'], activeGroupId: 'sample-group', effectiveVisibleGroupIds: ['sample-group'],
        },
    } }));
    if (otherSprint) {
        await page.route(/\/api\/sprints(\?|$)/, route => route.fulfill({ json: { sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' }, otherSprint,
        ] } }));
    }
    await page.route('**/api/tasks-with-team-name?**', route => {
        const params = new URL(route.request().url()).searchParams;
        const lane = params.get('project') === 'product' && !params.get('purpose') && params.get('sprint') === String(selectedSprintId);
        return route.fulfill({ json: {
            issues: lane ? [story('TEST-1', 'First sample story'), story('TEST-2', 'Second sample story')] : [],
            epics: { 'TEST-100': { key: 'TEST-100', summary: 'Sample epic', status: { name: 'In Progress' }, teamId: 'sample-team', teamName: 'Sample Team',
                sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] } },
            epicsInScope: [], names: {},
        } });
    });
    await page.route('**/api/eng/story-readiness?**', route => {
        if (readiness === 'unavailable') return route.fulfill({ status: 503, json: { error: 'story_readiness_unavailable' } });
        const params = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: { schemaVersion: 1, complete: true, epics: [], scope: {
            groupId: params.get('groupId'), sprintId: params.get('sprint'), sprintName: params.get('sprintName'), sprintState: params.get('sprintState'),
        } } });
    });
    await page.route('**/api/dependencies', route => {
        const reply = replies[Math.min(dependencyCalls.length, replies.length - 1)];
        dependencyCalls.push(route.request().postDataJSON());
        return reply.abort ? route.abort('connectionfailed') : route.fulfill(reply);
    });
    await page.goto(fixture.appBaseUrl);
    return { dependencyCalls };
}

const depNotice = page => page.locator('.story-readiness-notice', { hasText: NOTICE_TEXT });
const depChips = page => page.locator('.task-item button[data-dep-chip="blocked-by"]');
const incompleteReply = { json: { dependencies: partialMap, incomplete: true, reason: 'deadline' } };

async function noticeMetrics(locator) {
    return locator.evaluate((element) => {
        const style = getComputedStyle(element);
        const text = element.querySelector('span');
        const button = element.querySelector('button');
        const buttonStyle = button ? getComputedStyle(button) : null;
        const pick = (computed, names) => Object.fromEntries(names.map(name => [name, computed[name]]));
        const box = pick(style, [
            'display', 'alignItems', 'justifyContent', 'columnGap', 'marginBottom', 'color', 'backgroundColor', 'fontFamily', 'fontSize',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
            'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
        ]);
        const rect = element.getBoundingClientRect();
        return {
            className: element.className,
            role: element.getAttribute('role'),
            box,
            button: buttonStyle && {
                className: button.className,
                ...pick(buttonStyle, ['fontSize', 'fontFamily', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopLeftRadius', 'borderTopWidth', 'height']),
            },
            geometry: {
                left: rect.left, width: rect.width,
                textClipped: text.scrollWidth > text.clientWidth,
                buttonInside: button ? button.getBoundingClientRect().right <= rect.right && button.getBoundingClientRect().left >= rect.left : null,
            },
        };
    });
}

test('an incomplete dependencies answer shows the shared notice with Retry and keeps the partial chips', async ({ page }) => {
    const state = await openCatchUp(page, { replies: [incompleteReply], readiness: 'unavailable' });
    const notice = depNotice(page);
    const readinessNotice = page.locator('.story-readiness-notice', { hasText: READINESS_TEXT });
    await expect(notice).toBeVisible();
    await expect(readinessNotice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toHaveText(`${NOTICE_TEXT}Retry`);
    await expect(notice.locator('span')).toHaveText(NOTICE_TEXT);
    expect(state.dependencyCalls).toHaveLength(1);

    // MRT020 / MRT021: the registered hook, not a copy. Same class, same computed box, same Retry control, same lane.
    await expect(notice).toHaveClass('story-readiness-notice');
    await expect(readinessNotice).toHaveClass('story-readiness-notice');
    const dependencyMetrics = await noticeMetrics(notice);
    const readinessMetrics = await noticeMetrics(readinessNotice);
    expect(dependencyMetrics.box).toEqual(readinessMetrics.box);
    expect(dependencyMetrics.button.className).toBe('secondary compact');
    expect(dependencyMetrics.button).toEqual(readinessMetrics.button);
    expect(dependencyMetrics.geometry.left).toBe(readinessMetrics.geometry.left);
    expect(dependencyMetrics.geometry.width).toBe(readinessMetrics.geometry.width);
    expect(dependencyMetrics.geometry.textClipped).toBe(false);
    expect(dependencyMetrics.geometry.buttonInside).toBe(true);

    // The partial answer is applied: the Story it covers has its chip, the one it does not has none.
    await expect(page.locator('.task-item[data-task-key="TEST-1"] button[data-dep-chip="blocked-by"]')).toBeVisible();
    await expect(page.locator('.task-item[data-task-key="TEST-2"] button[data-dep-chip="blocked-by"]')).toHaveCount(0);
    await expect(depChips(page)).toHaveCount(1);

    fs.mkdirSync(path.join(root, 'tmp/load-performance'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp/load-performance/dependency-incomplete-notice.png'), animations: 'disabled' });
});

test('Retry asks again, a complete answer clears the notice and applies the full data', async ({ page }) => {
    const state = await openCatchUp(page, { replies: [incompleteReply, { json: { dependencies: completeMap } }] });
    await expect(depNotice(page)).toBeVisible();
    await expect(depChips(page)).toHaveCount(1);
    const retry = depNotice(page).getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toHaveClass('secondary compact');
    await retry.click();
    await expect.poll(() => state.dependencyCalls.length).toBe(2);
    expect(state.dependencyCalls[1].keys).toEqual(state.dependencyCalls[0].keys);
    await expect(depNotice(page)).toHaveCount(0);
    await expect(page.getByText(NOTICE_TEXT)).toHaveCount(0);
    await expect(page.locator('.task-item[data-task-key="TEST-2"] button[data-dep-chip="blocked-by"]')).toBeVisible();
    await expect(depChips(page)).toHaveCount(2);
    expect(state.dependencyCalls).toHaveLength(2);
});

test('a failed Retry keeps the notice and a later complete answer clears it', async ({ page }) => {
    const state = await openCatchUp(page, { replies: [incompleteReply, incompleteReply, { json: { dependencies: completeMap } }] });
    await expect(depNotice(page)).toBeVisible();
    await depNotice(page).getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => state.dependencyCalls.length).toBe(2);
    await expect(depNotice(page)).toBeVisible();
    await depNotice(page).getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => state.dependencyCalls.length).toBe(3);
    await expect(depNotice(page)).toHaveCount(0);
    await expect(depChips(page)).toHaveCount(2);
});

test('a complete answer shows no notice', async ({ page }) => {
    const state = await openCatchUp(page, { replies: [{ json: { dependencies: completeMap } }] });
    await expect(depChips(page)).toHaveCount(2);
    expect(state.dependencyCalls).toHaveLength(1);
    await expect(page.getByText(NOTICE_TEXT)).toHaveCount(0);
});

test('a 500 answer shows the notice too', async ({ page }) => {
    const state = await openCatchUp(page, { replies: [{ status: 500, json: { error: 'dependencies_unavailable' } }] });
    await expect(depNotice(page)).toBeVisible();
    await expect(depNotice(page)).toHaveAttribute('role', 'status');
    await expect(depNotice(page).getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(depChips(page)).toHaveCount(0);
    expect(state.dependencyCalls.length).toBeGreaterThanOrEqual(1);
});

test('a failed request shows the notice', async ({ page }) => {
    await openCatchUp(page, { replies: [{ abort: true }] });
    await expect(depNotice(page)).toBeVisible();
    await expect(depChips(page)).toHaveCount(0);
});

test('the notice does not outlive its scope: a Sprint without Stories shows none', async ({ page }) => {
    const otherSprint = { id: selectedSprintId + 1, name: '2026Q2 Sprint 43', state: 'active' };
    await openCatchUp(page, { replies: [incompleteReply], otherSprint });
    await expect(depNotice(page)).toBeVisible();
    await page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle').click();
    await page.locator('.sprint-dropdown-option', { hasText: otherSprint.name }).click();
    await expect(page.getByText('No tasks found')).toBeVisible();
    await expect(page.locator('.task-item')).toHaveCount(0);
    await expect(page.getByText(NOTICE_TEXT)).toHaveCount(0);
});

test('a 401 is not a notice: it locks the document as before', async ({ page }) => {
    const state = await openCatchUp(page, { replies: [{ status: 401, json: { error: 'auth_required' } }] });
    await expect.poll(() => page.evaluate(() => window.__JEP_AUTH_REQUIRED__?.locked)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByText(NOTICE_TEXT)).toHaveCount(0);
    await expect(page.locator('.story-readiness-notice', { hasText: NOTICE_TEXT })).toHaveCount(0);
    expect(state.dependencyCalls).toHaveLength(1);
});
