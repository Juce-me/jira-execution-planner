const { test, expect } = require('@playwright/test');
const {
    BOARD_COLUMNS, STATUS_COLOUR, SUBTASK_PARENT, activeSprintId, activeSprintName, appBaseUrl, collectPills,
    expectPillColours, futureSprintId, futureSprintName, hexToRgb, installStatusColourFixture, tintFor, tintInline, waitForVisualSettled,
} = require('./status_column_colours_fixture');

// Everything here is synthetic. The flag is seeded through the mocked /api/groups-config.

async function openCatchUp(page, options = {}) {
    const fixture = await installStatusColourFixture(page, options);
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    await page.locator(`.task-item[data-task-key="${SUBTASK_PARENT}"] .story-subtasks-toggle`).click();
    await expect(page.locator('[data-issue-kind="subtask"], .story-subtask-row .status-pill')).not.toHaveCount(0);
    await waitForVisualSettled(page);
    return fixture;
}

async function openPlanningList(page, options = {}) {
    const fixture = await installStatusColourFixture(page, {
        ...options, prefs: { selectedSprint: futureSprintId, sprintName: futureSprintName },
    });
    await page.goto(appBaseUrl);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    await waitForVisualSettled(page);
    return fixture;
}

async function openPlanningTable(page, options = {}) {
    const fixture = await openPlanningList(page, options);
    await page.getByRole('button', { name: 'Show Planning table', exact: true }).click();
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await expect(page.locator('table.planning-review-table tbody tr').first()).toBeVisible();
    await waitForVisualSettled(page);
    return fixture;
}

async function openBoard(page, options = {}) {
    const fixture = await installStatusColourFixture(page, { ...options, prefs: { showBoard: true } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(appBaseUrl);
    await page.waitForSelector('.eng-board .col', { timeout: 10000 });
    await waitForVisualSettled(page);
    return fixture;
}

const trigger = (page, kind, key) => page.locator(`[data-status-transition-trigger][data-issue-kind="${kind}"][data-issue-key="${key}"]`);

/* ── Sweeps: every included pill on every surface, flag on and off ─────────────────────────── */

for (const flag of [true, false]) {
    const label = flag ? 'on' : 'off';

    test(`Catch Up Epic (also initiative-grouped), Story and Subtask pills (flag ${label})`, async ({ page }) => {
        await openCatchUp(page, { flag });
        const pills = await collectPills(page, '.task-list');
        expectPillColours(pills, { flag });
        expect(pills.every((pill) => pill.tag === 'BUTTON'), 'OAuth editing profile: every pill is an interactive trigger').toBe(true);
        const grouped = await collectPills(page, '.initiative-body');
        expect(grouped.length, 'the initiative-grouped Epic renders its header pill').toBeGreaterThan(0);
        expectPillColours(grouped, { flag });
        // Decision 2: Stories take the colour of their status like any other issue type.
        const stories = await collectPills(page, '.task-item[data-task-key="PLAT-1-b"]');
        expect(stories.map((pill) => pill.text)).toContain('Accepted');
    });

    test(`passive profile with Settings open renders inert spans with the same colours (flag ${label})`, async ({ page }) => {
        await openCatchUp(page, { flag });
        await page.getByRole('button', { name: /manage team groups/i }).click();
        await expect(page.getByRole('dialog').first()).toBeVisible();
        await expect(page.locator('[data-status-transition-trigger]')).toHaveCount(0);
        const pills = await collectPills(page, '.task-list');
        expect(pills.every((pill) => pill.tag === 'SPAN')).toBe(true);
        expectPillColours(pills, { flag });
    });

    test(`basic-auth profile follows the same colours (flag ${label})`, async ({ page }) => {
        await openCatchUp(page, { flag, authMode: 'basic' });
        const pills = await collectPills(page, '.task-list');
        expect(pills.length).toBeGreaterThan(0);
        expectPillColours(pills, { flag });
    });

    test(`Planning list pills (flag ${label})`, async ({ page }) => {
        await openPlanningList(page, { flag });
        const pills = await collectPills(page, '.task-list');
        expectPillColours(pills, { flag });
    });

    test(`Planning Table status cells (flag ${label})`, async ({ page }) => {
        await openPlanningTable(page, { flag });
        const pills = await collectPills(page, 'table.planning-review-table');
        expect(pills.length).toBeGreaterThan(0);
        expectPillColours(pills, { flag });
        await page.getByRole('radio', { name: 'Epics', exact: true }).click();
        await waitForVisualSettled(page);
        expectPillColours(await collectPills(page, 'table.planning-review-table'), { flag });
    });

    test(`Planning Table passive status pills with a non-OAuth profile (flag ${label})`, async ({ page }) => {
        await openPlanningTable(page, { flag, authMode: 'basic' });
        const pills = await collectPills(page, 'table.planning-review-table');
        expect(pills.length).toBeGreaterThan(0);
        expect(pills.every((pill) => pill.tag === 'SPAN'), 'passive profile renders spans').toBe(true);
        expectPillColours(pills, { flag });
    });

    test(`Board open-Epic panel passive pills while Settings is open (flag ${label})`, async ({ page }) => {
        await openBoard(page, { flag });
        await page.getByRole('button', { name: /manage team groups/i }).click();
        await expect(page.getByRole('dialog').first()).toBeVisible();
        // The modal covers the card, so open the panel programmatically while Settings is open.
        await page.locator('.eng-board .ecard[data-epic-key="PLAT-4"] .ecard-open').evaluate((node) => node.click());
        await expect(page.locator('.epic-panel')).toBeVisible();
        await expect(page.locator('.epic-panel [data-status-transition-trigger]')).toHaveCount(0);
        const panel = await collectPills(page, '.epic-panel');
        expect(panel.length).toBeGreaterThan(1);
        expect(panel.every((pill) => pill.tag === 'SPAN'), 'inert profile renders spans').toBe(true);
        expectPillColours(panel, { flag });
    });

    test(`Board cards, open-Epic panel and drop menu (flag ${label})`, async ({ page }) => {
        await openBoard(page, { flag });
        const cards = await collectPills(page, '.eng-board');
        expect(cards.length).toBeGreaterThan(0);
        expectPillColours(cards, { flag });

        await page.locator('.eng-board .ecard[data-epic-key="PLAT-3"] .ecard-open').click();
        await expect(page.locator('.epic-panel')).toBeVisible();
        const panel = await collectPills(page, '.epic-panel');
        expect(panel.length, 'the panel shows the Epic pill and its Story pills').toBeGreaterThan(1);
        expectPillColours(panel, { flag });
        await page.keyboard.press('Escape');
        await expect(page.locator('.epic-panel')).toHaveCount(0);

        // Drop menu: a column holding two statuses asks which one. Status rows are coloured, background only.
        const dragged = await page.evaluate(() => {
            const source = document.querySelector('.eng-board .ecard[data-epic-key="PLAT-3"]');
            const target = document.querySelector('.eng-board .col[data-column-id="col-00000003"]');
            if (!source || !target) return { started: false, reason: 'missing source or target' };
            const dataTransfer = new DataTransfer();
            const box = target.getBoundingClientRect();
            const point = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + Math.min(box.height / 2, 160)) };
            const make = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...point });
            source.dispatchEvent(make('dragstart'));
            target.dispatchEvent(make('dragenter'));
            target.dispatchEvent(make('dragover'));
            target.dispatchEvent(make('drop'));
            return { started: true };
        });
        expect(dragged).toEqual({ started: true });
        const markers = page.locator('.status-transition-menu .status-transition-option-marker');
        await expect(markers.first()).toBeVisible();
        const rows = await markers.evaluateAll((nodes) => nodes.map((node) => ({
            label: node.closest('.status-transition-option')?.textContent.trim() || '',
            style: node.getAttribute('style'),
            warn: node.classList.contains('is-warn'),
        })));
        const statusRows = rows.filter((row) => STATUS_COLOUR.has(row.label));
        expect(statusRows.length).toBeGreaterThan(0);
        for (const row of statusRows) {
            if (flag) expect(row.style, row.label).toBe(`background: ${tintInline(STATUS_COLOUR.get(row.label))};`);
            else expect(row.style, row.label).toBeNull();
        }
        for (const row of rows.filter((entry) => !STATUS_COLOUR.has(entry.label))) expect(row.style, row.label).toBeNull();
    });
}

/* ── The status menu: trigger and option markers ───────────────────────────────────────────── */

test('the status menu option markers take the column tint as background only', async ({ page }) => {
    await openCatchUp(page, { flag: true });
    await trigger(page, 'story', 'PLAT-1-a').click();
    const menu = page.locator('.status-transition-menu[data-issue-key="PLAT-1-a"]');
    await expect(menu).toBeVisible();
    const markers = await menu.locator('.status-transition-option').evaluateAll((options) => options.map((option) => {
        const marker = option.querySelector('.status-transition-option-marker');
        return { label: option.querySelector('.status-transition-option-label').textContent.trim(), inline: marker.getAttribute('style'), background: getComputedStyle(marker).backgroundColor };
    }));
    expect(markers.length).toBeGreaterThan(5);
    for (const marker of markers) {
        const colour = STATUS_COLOUR.get(marker.label);
        if (colour) {
            expect(marker.background, marker.label).toBe((await tintFor(page, colour)).background);
            expect(marker.inline, marker.label).toBe(`background: ${tintInline(colour)};`);
        } else {
            expect(marker.inline, marker.label).toBeNull();
        }
    }
});

/* ── Invariants ─────────────────────────────────────────────────────────────────────────────── */

// Built-in palette colours today, measured with the flag off (no inline style exists at all).
const BUILT_IN_GOLDEN = {
    'To Do': 'rgb(140, 140, 140)',
    Accepted: 'rgb(105, 192, 255)',
    'In Progress': 'rgb(105, 192, 255)',
    Blocked: 'rgb(255, 77, 79)',
    Pending: 'rgb(140, 140, 140)',
    Release: 'rgb(19, 194, 194)',
    Done: 'rgb(82, 196, 26)',
    Analysis: 'rgb(105, 192, 255)',
    'In Review': 'rgb(26, 26, 26)',
};

test('flag off equals today: the built-in palette colours, no inline style, same as a Department with no flag key', async ({ page }) => {
    await openCatchUp(page, { flag: false });
    const pills = await collectPills(page, '.task-list');
    for (const pill of pills) {
        expect(pill.inline, pill.text).toBeNull();
        expect(pill.background, pill.text).toBe(BUILT_IN_GOLDEN[pill.text]);
    }
    expect(new Set(pills.map((pill) => pill.text))).toEqual(new Set(Object.keys(BUILT_IN_GOLDEN)));
});

test('an unmapped status keeps its built-in colours with the flag on', async ({ page }) => {
    await openCatchUp(page, { flag: true });
    const pills = await collectPills(page, '.task-list');
    const unmapped = pills.filter((pill) => pill.text === 'Analysis');
    expect(unmapped.length).toBeGreaterThan(1);
    for (const pill of unmapped) {
        expect(pill.inline).toBeNull();
        expect(pill.background).toBe(BUILT_IN_GOLDEN.Analysis);
    }
});

test('a Department with no board is unchanged with or without the flag key', async ({ page }) => {
    await openCatchUp(page, { flag: true, columns: null });
    const pills = await collectPills(page, '.task-list');
    expectPillColours(pills, { flag: false });
});

async function filterStatusPill(page) {
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const pill = page.locator('.popover .pop-group[data-facet="status"] .pop-opt[data-option="In Progress"] .eng-filter-status-pill');
    await expect(pill).toHaveCount(1);
    await waitForVisualSettled(page);
    return pill.evaluate((node) => {
        const style = getComputedStyle(node);
        return { inline: node.getAttribute('style'), background: style.backgroundColor, color: style.color };
    });
}

test('the filter-bar Status popover keeps its existing soft tint in both states', async ({ page }) => {
    const fixture = await installStatusColourFixture(page, { flag: true });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    const on = await filterStatusPill(page);
    fixture.setFlag(false);
    await page.reload();
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    const off = await filterStatusPill(page);
    expect(on).toEqual(off);
    expect(on.inline).toContain('--eng-filter-status-colour');
    expect(on.inline).toContain('--eng-filter-status-colour');
});

test('EPM Story and Epic pills are unchanged with the flag on, and ENG recolours in the same session', async ({ page }) => {
    await installStatusColourFixture(page, {
        flag: true,
        prefs: { selectedView: 'epm', epmTab: 'active', epmSelectedProjectId: '' },
    });
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
    await expect(page.locator('.epm-project-board')).toHaveCount(1);
    await expect(page.locator('.task-item[data-task-key="EPM-1"] .status-pill')).toHaveCount(1);
    const epm = await collectPills(page, '.epm-project-board');
    expect(epm.length).toBeGreaterThan(1);
    for (const pill of epm) expect(pill.inline, pill.text).toBeNull();

    // Positive control: the same page, same flag, now in ENG, is recoloured.
    await page.evaluate((key) => {
        const prefs = JSON.parse(window.localStorage.getItem(key));
        window.localStorage.setItem(key, JSON.stringify({ ...prefs, selectedView: 'eng' }));
    }, 'jira_dashboard_ui_prefs_v1');
    await page.reload();
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    expectPillColours(await collectPills(page, '.task-list'), { flag: true });
});

test('the hard-coded Done card tint is identical flag on versus off', async ({ page }) => {
    const fixture = await openCatchUp(page, { flag: true });
    const read = () => page.locator('.task-item[data-task-key="PLAT-2-c"]').evaluate((node) => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, border: style.borderLeftColor, classes: node.className };
    });
    const on = await read();
    fixture.setFlag(false);
    await page.reload();
    await expect(page.locator('.task-item[data-task-key="PLAT-2-c"]')).toBeVisible();
    await waitForVisualSettled(page);
    expect(await read()).toEqual(on);
    expect(on.classes).toContain('status-done');
});

test('pill geometry, text ranges and the ENG request multiset are identical flag on versus off', async ({ page }) => {
    const fixture = await installStatusColourFixture(page, { flag: true });
    const load = async () => {
        const from = fixture.requests.length;
        await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
        await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
        await page.locator(`.task-item[data-task-key="${SUBTASK_PARENT}"] .story-subtasks-toggle`).click();
        await expect(page.locator('.story-subtask-row .status-pill').first()).toBeVisible();
        await waitForVisualSettled(page);
        const pills = await collectPills(page, '.task-list');
        const headers = await page.locator('.epic-header').evaluateAll((nodes) => nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100);
        }));
        // Cache-busting `t=` values and the focus-driven auth refresh are not data requests.
        const requests = fixture.requests.slice(from)
            .filter((request) => !request.startsWith('POST /api/auth/refresh'))
            .map((request) => request.replace(/([?&])t=\d+/, '$1t=_'))
            .sort();
        return { pills: pills.map(({ text, box, textBox }) => ({ text, box, textBox })), headers, requests };
    };
    const on = await load();
    fixture.setFlag(false);
    const off = await load();
    expect(on.pills.length).toBeGreaterThan(5);
    expect(on.pills).toEqual(off.pills);
    expect(on.headers).toEqual(off.headers);
    expect(on.requests).toEqual(off.requests);
    expect(on.requests.some((request) => request.includes('/api/tasks-with-team-name'))).toBe(true);
});

/* ── Hover and focus on the interactive pill ───────────────────────────────────────────────── */

test('hover keeps the column tint, its text colour and the existing hover rules for all seven colours', async ({ page }) => {
    const fixture = await openCatchUp(page, { flag: true });
    const storiesByStatus = { 'To Do': 'PLAT-1-a', Accepted: 'PLAT-1-b', Blocked: 'PLAT-1-c', 'In Review': 'PLAT-2-a', Release: 'PLAT-2-b', Done: 'PLAT-2-c', Pending: 'PLAT-3-b' };
    const readHover = async () => {
        const result = {};
        for (const [status, key] of Object.entries(storiesByStatus)) {
            const pill = trigger(page, 'story', key);
            await pill.scrollIntoViewIfNeeded();
            await page.mouse.move(0, 0);
            await waitForVisualSettled(page);
            const rest = await pill.evaluate((node) => ({ transform: getComputedStyle(node).transform, shadow: getComputedStyle(node).boxShadow }));
            await pill.hover();
            await waitForVisualSettled(page);
            result[status] = await pill.evaluate((node, restState) => {
                const style = getComputedStyle(node);
                return {
                    background: style.backgroundColor, color: style.color, filter: style.filter,
                    transform: style.transform, shadow: style.boxShadow, restTransform: restState.transform, restShadow: restState.shadow,
                };
            }, rest);
        }
        return result;
    };
    const on = await readHover();
    expect(Object.keys(on)).toHaveLength(7);
    expect(new Set(Object.values(on).map((entry) => entry.background)).size).toBe(7);
    for (const [status, entry] of Object.entries(on)) {
        const tint = await tintFor(page, STATUS_COLOUR.get(status));
        expect(entry.background, status).toBe(tint.background);
        expect(entry.color, status).toBe(tint.color);
        expect(entry.filter, status).toBe('brightness(0.94)');
    }
    fixture.setFlag(false);
    await page.reload();
    await expect(trigger(page, 'story', 'PLAT-1-a')).toBeVisible();
    const off = await readHover();
    for (const status of Object.keys(on)) {
        expect(on[status].filter, status).toBe(off[status].filter);
        expect(on[status].transform, status).toBe(off[status].transform);
        expect(on[status].shadow, status).toBe(off[status].shadow);
    }
});

test('the focus-visible outline is the same flag on versus off', async ({ page }) => {
    const fixture = await openCatchUp(page, { flag: true });
    const readFocus = async () => {
        await trigger(page, 'story', 'PLAT-1-a').focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        return trigger(page, 'story', 'PLAT-1-a').evaluate((node) => {
            const style = getComputedStyle(node);
            return { focused: document.activeElement === node, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineColor: style.outlineColor };
        });
    };
    const on = await readFocus();
    expect(on.focused).toBe(true);
    expect(on.outlineStyle).not.toBe('none');
    fixture.setFlag(false);
    await page.reload();
    await expect(trigger(page, 'story', 'PLAT-1-a')).toBeVisible();
    expect(await readFocus()).toEqual(on);
});

/* ── Settings: Save recolours the pills with no reload; the composer previews its own draft ──── */

async function openBoardsSettings(page) {
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('tab', { name: 'Boards' }).click();
    await expect(page.locator('#department-settings-boards-panel')).toBeVisible();
    return dialog;
}

const composerChip = (dialog, status) => dialog.locator(`.group-board-composer .board-column .component-chip[data-status="${status}"] .status-pill`);
const inlineOf = (locator) => locator.evaluate((node) => node.getAttribute('style'));
const storyPill = (page, key) => trigger(page, 'story', key);

test('Save recolours the pills without a reload and the setting persists across a reload', async ({ page }) => {
    const fixture = await installStatusColourFixture(page, { flag: false });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    expectPillColours(await collectPills(page, '.task-list'), { flag: false });

    const dialog = await openBoardsSettings(page);
    const checkbox = dialog.getByRole('checkbox', { name: 'Use column colours for statuses' });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await dialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixture.state.flag).toBe(true);
    // No reload: the shared config in memory is what recolours the pills.
    await expect(storyPill(page, 'PLAT-1-a')).toHaveCSS('background-color', (await tintFor(page, '#8c8c8c')).background);
    expectPillColours(await collectPills(page, '.task-list'), { flag: true });

    await page.reload();
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    // The initial bootstrap, not opening Settings, supplies the saved flag.
    expectPillColours(await collectPills(page, '.task-list'), { flag: true });
    const reopened = await openBoardsSettings(page);
    await expect(reopened.getByRole('checkbox', { name: 'Use column colours for statuses' })).toBeChecked();
});

test('the composer previews its draft independently of the saved state', async ({ page }) => {
    // Saved ON, draft OFF: chips uncoloured while the pills behind the modal stay coloured.
    await installStatusColourFixture(page, { flag: true });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    let dialog = await openBoardsSettings(page);
    expect(await inlineOf(composerChip(dialog, 'To Do'))).toContain('background');
    await dialog.getByRole('checkbox', { name: 'Use column colours for statuses' }).uncheck();
    expect(await inlineOf(composerChip(dialog, 'To Do')) || null).toBeNull();
    expectPillColours(await collectPills(page, '.task-list'), { flag: true });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // Saved OFF, draft ON: chips coloured while the pills behind stay built-in until Save.
    await installStatusColourFixture(page, { flag: false });
    await page.goto(appBaseUrl);
    await expect(page.locator('.task-item[data-task-key="PLAT-1-a"]')).toBeVisible();
    dialog = await openBoardsSettings(page);
    expect(await inlineOf(composerChip(dialog, 'To Do')) || null).toBeNull();
    await dialog.getByRole('checkbox', { name: 'Use column colours for statuses' }).check();
    await expect(composerChip(dialog, 'To Do')).toHaveCSS('background-color', (await tintFor(page, '#8c8c8c')).background);
    await expect(composerChip(dialog, 'In Progress')).toHaveCSS('background-color', (await tintFor(page, '#597ef7')).background);
    expectPillColours(await collectPills(page, '.task-list'), { flag: false });
});
