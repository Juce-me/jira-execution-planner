const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const harnessUrl = `${appBaseUrl}/group-board-composer-harness`;
const screenshotDir = path.join(repoRoot, 'tmp', 'group-board-composer');

// The composer is not mounted anywhere yet — the Boards sub-tab is the next task — so these specs
// render it through tests/ui/group_board_composer_harness.jsx: the real component, the real
// stylesheet bundle (so the cascade is the app's, not a cherry-picked subset), and a stand-in for
// the consumer that will hold the group draft. The assertions that need the real settings modal
// (tab wiring, unified save, 409) belong to the task that mounts it.

let harnessJs;
let dashboardCss;
let fixture;

test.beforeAll(async () => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    harnessJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'group_board_composer_harness.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
    fixture = await import('../fixtures/groupBoardReference.mjs');
});

// The real .group-modal is a fixed-height scroll container (modal-shell.css:50-61). The harness
// lets it grow instead, so a screenshot captures the whole composer rather than one modal-height
// slice of it. The composer's own widths are untouched: .group-pane-right is still the production
// 70% of min(980px, 94vw), which is why the column row scrolls horizontally here exactly as it
// will in the modal.
const harnessOverrides = `
    .group-modal { height: auto; max-height: none; overflow: visible; }
    .group-modal-content, .group-pane-right { overflow: visible; }
`;

function harnessHtml(initialBoardJs = 'undefined', randomJs = 'undefined') {
    return `<!doctype html><html><head><meta charset="utf-8">`
        + `<style>${dashboardCss}</style><style>${harnessOverrides}</style></head>`
        + '<body><div class="group-modal">'
        + '<div id="harness-root"></div></div>'
        + `<script>window.__groupBoardHarnessInitialBoard = ${initialBoardJs};`
        + `window.__groupBoardHarnessRandom = ${randomJs};</script>`
        + `<script>${harnessJs}</script></body></html>`;
}

async function openComposer(page, { statuses = 'ok', initialBoard = 'undefined', random = 'undefined' } = {}) {
    const requests = { count: 0 };
    await page.route('**/api/board-config/statuses', (route) => {
        requests.count += 1;
        if (statuses === 'no_board') {
            return route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'no_board_configured' }),
            });
        }
        if (statuses === 'jira_down') {
            return route.fulfill({
                status: 502,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'board_statuses_fetch_failed', message: 'Jira returned status 500' }),
            });
        }
        if (statuses === 'unresolvable') {
            return route.fulfill({
                status: 502,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'board_statuses_unavailable',
                    message: 'Jira returned no usable statuses for project PLAT',
                }),
            });
        }
        if (statuses === 'forbidden') {
            return route.fulfill({
                status: 502,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'board_statuses_forbidden',
                    message: 'Jira refused the saved board read (status 403)',
                }),
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fixture.referenceStatusesResponse()),
        });
    });
    await page.route(harnessUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: harnessHtml(initialBoard, random),
    }));
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(harnessUrl);
    await page.waitForSelector('.board-column');
    return requests;
}

const columnNames = (page) => page.$$eval('.board-column-name', (nodes) => nodes.map((node) => node.value));
const boardState = (page) => page.evaluate(() => window.__groupBoardHarness.board);
const chipStatuses = (page, columnIndex) => page.$$eval(
    `.board-column:nth-of-type(${columnIndex + 1}) .selected-components-list .component-chip`,
    (nodes) => nodes.map((node) => node.dataset.status),
);


// Playwright's native drag interception picks the drag source from the pointer position *after*
// its synthetic move, not from the element the press landed on. That makes `dragTo` unable to
// drive a handle-gated drag: the press lands on the ⠿ grip, but the interception then starts the
// drag from whatever is under the pointer mid-move. So the chip gesture is driven the faithful
// way instead — a real pointer press on the grip (which is what the gate reads), then the DragEvent
// sequence a browser raises, with real coordinates. The handlers, the gate, the state and the DOM
// are all the real ones; only the browser's own drag loop is stood in for.
async function pressHandle(page, locator) {
    await locator.hover();
    await page.mouse.down();
}

async function dispatchDrag(page, sourceSelector, targetSelector, point = null) {
    const outcome = await page.evaluate(({ source, target, at }) => {
        const sourceNode = document.querySelector(source);
        const targetNode = document.querySelector(target);
        const dataTransfer = new DataTransfer();
        const make = (type) => new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: at ? at.x : 0,
            clientY: at ? at.y : 0,
        });
        const start = make('dragstart');
        sourceNode.dispatchEvent(start);
        if (start.defaultPrevented) {
            sourceNode.dispatchEvent(make('dragend'));
            return { started: false };
        }
        targetNode.dispatchEvent(make('dragenter'));
        targetNode.dispatchEvent(make('dragover'));
        targetNode.dispatchEvent(make('drop'));
        sourceNode.dispatchEvent(make('dragend'));
        return { started: true };
    }, { source: sourceSelector, target: targetSelector, at: point });
    await page.mouse.up();
    return outcome;
}

// getComputedStyle always reports colours as rgb(), so the fixture's hex has to be converted
// rather than the computed value parsed — that way the expectation is derived from §5.5's own
// data and a fixture edit cannot silently pass.
function hexToRgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/* ── The reference configuration renders, and its invariants hold ───────────────────────────── */

test('renders the §5.5 reference configuration', async ({ page }) => {
    await openComposer(page);

    expect(await columnNames(page)).toEqual([
        'To do', 'Analysis', 'Ready to start', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);

    const mapped = await page.$$eval('.board-column .selected-components-list .component-chip',
        (nodes) => nodes.map((node) => node.dataset.status));
    expect(mapped).toHaveLength(12);
    expect(new Set(mapped).size).toBe(12);

    // Pending remains mapped even though production has no status work-item count source.
    const pending = page.locator('.board-column .component-chip[data-status="Pending"]');
    await expect(pending).toHaveCount(1);
    await expect(pending.locator('.component-name')).toHaveText('Pending');
    await expect(page.locator('.board-unmapped .component-chip')).toHaveCount(0);

    // Exactly one starred column, and it is In progress.
    const starred = page.locator('.board-column-star[aria-pressed="true"]');
    await expect(starred).toHaveCount(1);
    await expect(starred).toHaveAttribute('aria-label', 'Release In progress');

    // Both breach directions, and neither blocks.
    await expect(page.locator('.board-column.is-breach')).toHaveCount(2);
    await expect(page.locator('.board-column').nth(1).locator('.group-modal-warning'))
        .toContainText('11 epics · 4 under min 15');
    await expect(page.locator('.board-column').nth(5).locator('.group-modal-warning'))
        .toContainText('26 epics · 6 over max 20');
    await expect(page.locator('.group-modal-validation')).toHaveCount(0);
    await expect(page.locator('#harness-save')).toBeEnabled();

    // A red accent is not a breach.
    const external = page.locator('.board-column').nth(4);
    await expect(external).not.toHaveClass(/is-breach/);
    expect(await external.evaluate((node) => getComputedStyle(node).borderTopColor)).toBe('rgb(255, 77, 79)');

    // §12.1 asks for EVERY column's computed accent, not one of them: a swatch wired to the wrong
    // column, or a colour that never reached CSS, only shows up when all seven are read back.
    // Measured on the swatch, not on the column's top border: a breaching column's border is
    // repainted with the warn red (which is why the two directions above are visible at all), so
    // the border would report the breach for columns 2 and 6 rather than their accent.
    const accents = await page.$$eval('.board-column .board-column-colour',
        (nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
    expect(accents).toEqual(fixture.REFERENCE_COLUMNS.map((column) => hexToRgb(column.colour)));
});

test('the composer inherits the settings classes and adds no modal of its own', async ({ page }) => {
    await openComposer(page);
    for (const selector of [
        '.component-selector', '.component-selector-label', '.selected-components-list',
        '.component-chip', '.component-name', '.remove-btn', '.group-modal-meta', '.group-modal-warning',
    ]) {
        expect(await page.locator(`.group-board-composer ${selector}`).count(),
            `${selector} must be present`).toBeGreaterThan(0);
    }
    // The composer must not introduce a second modal or backdrop of its own.
    expect(await page.locator('.group-board-composer .group-modal, .group-board-composer .modal-backdrop').count()).toBe(0);
    // The preview reuses the board's own column classes so it cannot drift from the board.
    await expect(page.locator('.board-preview .col')).toHaveCount(7);
    await expect(page.locator('.board-preview .col.is-focused')).toHaveCount(1);
    await expect(page.locator('.board-preview .col-strip .vert')).toHaveCount(7);
    await expect(page.locator('.board-preview .col-strip .fill')).toHaveCount(6);
});

test('layout: one row of columns, no clipped label, no document overflow', async ({ page }) => {
    await openComposer(page);

    // Every column shares one top — the row never wraps.
    const tops = await page.$$eval('.board-column', (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);

    // Element-level clip checks on the actual text-bearing elements, not container boxes.
    const clipped = await page.$$eval(
        '.board-column .group-modal-meta, .board-column .group-modal-warning, .board-add-status,'
        + ' .board-column-limits label, .board-column .component-name, .board-add-column',
        (nodes) => nodes
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => `${node.className}:${node.textContent.trim().slice(0, 40)}`),
    );
    expect(clipped).toEqual([]);

    // Every text-bearing element stays inside its own column's content box.
    const overflowing = await page.$$eval('.board-column', (columns) => {
        const bad = [];
        columns.forEach((column) => {
            const box = column.getBoundingClientRect();
            column.querySelectorAll('.group-modal-meta, .group-modal-warning, .board-add-status, .component-name')
                .forEach((node) => {
                    const rect = node.getBoundingClientRect();
                    if (rect.right > box.right + 1 || rect.left < box.left - 1) {
                        bad.push(`${node.className}:${node.textContent.trim().slice(0, 30)}`);
                    }
                });
        });
        return bad;
    });
    expect(overflowing).toEqual([]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);

    // Per-control geometry. eng/controls.css carries an aggressive global `button` rule
    // (0.875rem 2rem padding, black fill); any button here that forgets to reset it becomes a
    // block that blows its column apart. Assert every one, not only the reported instance.
    const oversized = await page.$$eval('.board-column button', (nodes) => nodes
        .filter((node) => {
            const rect = node.getBoundingClientRect();
            const column = node.closest('.board-column').getBoundingClientRect();
            return rect.height > 34 || rect.width > column.width;
        })
        .map((node) => `${node.className}:${Math.round(node.getBoundingClientRect().height)}px`));
    expect(oversized).toEqual([]);

    // Same clip check with a picker open, for EVERY column: which rows a picker offers differs
    // per column, so checking one picker checks one instance of the bug rather than the class.
    for (let index = 0; index < 7; index += 1) {
        const column = page.locator('.board-column').nth(index);
        await column.locator('.board-add-status').click();
        const clippedInPicker = await page.$$eval(
            '.board-pick .component-chip, .board-pick .component-name, .board-pick-empty',
            (nodes) => nodes
                .filter((node) => node.scrollWidth > node.clientWidth + 1)
                .map((node) => `${node.className}:${node.textContent.trim().slice(0, 40)}`),
        );
        expect(clippedInPicker, `column ${index}`).toEqual([]);
        const escapingRows = await page.$$eval('.board-pick', (picks) => {
            const bad = [];
            picks.forEach((pick) => {
                const box = pick.getBoundingClientRect();
                pick.querySelectorAll('.component-chip, .board-pick-from').forEach((node) => {
                    const rect = node.getBoundingClientRect();
                    if (rect.right > box.right + 1) bad.push(`${node.className}:${node.textContent.trim().slice(0, 30)}`);
                });
            });
            return bad;
        });
        expect(escapingRows, `column ${index}`).toEqual([]);
        // The provenance may truncate — with an ellipsis, and the whole string in the row's title
        // — but it must still say something. Squeezed to nothing it states nothing, which is the
        // one thing every picker row exists to do.
        const unreadable = await page.$$eval('.board-pick-from', (nodes) => nodes
            .filter((node) => node.getBoundingClientRect().width < 30)
            .map((node) => `${node.textContent}@${Math.round(node.getBoundingClientRect().width)}px`));
        expect(unreadable, `column ${index}`).toEqual([]);
        expect(await page.locator('.board-pick-from').first().evaluate((node) => getComputedStyle(node).textOverflow))
            .toBe('ellipsis');
        expect(await page.locator('.board-pick .component-chip').first().getAttribute('title'))
            .toMatch(/from |not in a column/);
        await column.locator('.board-add-status').click();
    }

    // The preview strips keep their flex-basis; a long name must not push one wider.
    const previewWidths = await page.$$eval('.board-preview .col', (nodes) => nodes.map((node) => ({
        focused: node.classList.contains('is-focused'),
        width: Math.round(node.getBoundingClientRect().width),
    })));
    expect(previewWidths.filter((column) => !column.focused).every((column) => column.width === 36)).toBe(true);
    expect(previewWidths.filter((column) => column.focused).every((column) => column.width === 190)).toBe(true);

    // An undefined custom property silently drops the whole declaration; assert the computed value.
    const breachShadow = await page.locator('.board-column.is-breach').first()
        .evaluate((node) => getComputedStyle(node).boxShadow);
    expect(breachShadow).toContain('rgb(207, 19, 34)');
    // color-mix in the preview must resolve, not fall back to the plain panel background.
    const focusedStrip = await page.locator('.board-preview .col.is-focused .col-strip')
        .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(focusedStrip).not.toBe('rgb(255, 255, 255)');
});

test('the reference configuration screenshot', async ({ page }) => {
    await openComposer(page);
    await page.locator('.group-board-composer').screenshot({
        path: path.join(screenshotDir, 'reference-configuration.png'),
        animations: 'disabled',
    });

    // The column row scrolls horizontally at the production pane width, so the tail of it is
    // captured too rather than left unseen.
    await page.locator('.board-columns').evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    await page.locator('.board-columns').screenshot({
        path: path.join(screenshotDir, 'columns-scrolled-right.png'),
        animations: 'disabled',
    });

    // The two affordances that were drawn but never wired, both open.
    await page.locator('.board-columns').evaluate((node) => { node.scrollLeft = 0; });
    await page.locator('.board-column').first().locator('.board-add-status').click();
    await page.locator('.board-column').nth(1).locator('.board-column-colour')
        .first()
        .click();
    await page.locator('.group-board-composer').screenshot({
        path: path.join(screenshotDir, 'picker-and-colour-grid.png'),
        animations: 'disabled',
    });

    for (const name of ['reference-configuration.png', 'columns-scrolled-right.png', 'picker-and-colour-grid.png']) {
        expect(fs.existsSync(path.join(screenshotDir, name)), name).toBe(true);
    }
});

/* ── D38: two assignment paths, and assigning moves rather than copies ──────────────────────── */

test('the picker is never dead and orders orphans first', async ({ page }) => {
    await openComposer(page);
    // All twelve statuses are mapped, yet each picker offers the statuses held elsewhere:
    // 12 minus its own held count, which is 9–11 options across this fixture.
    for (let index = 0; index < 7; index += 1) {
        const column = page.locator('.board-column').nth(index);
        await column.locator('.board-add-status').click();
        const held = await column.locator('.selected-components-list .component-chip').count();
        await expect(column.locator('.board-pick .component-chip')).toHaveCount(12 - held);
        await expect(column.locator('.board-pick .board-pick-from').first()).toHaveText(/^from /);
        await column.locator('.board-add-status').click();
    }

    // Orphan a status, then check it sorts above the "from <column>" rows.
    await page.locator('.board-column .component-chip[data-status="Postponed"] .remove-btn').click();
    const first = page.locator('.board-column').first();
    await first.locator('.board-add-status').click();
    const rows = await first.locator('.board-pick .component-chip').evaluateAll(
        (nodes) => nodes.map((node) => `${node.dataset.status}|${node.querySelector('.board-pick-from').textContent}`),
    );
    expect(rows[0]).toBe('Postponed|not in a column');
    expect(rows.slice(1).every((row) => row.includes('|from '))).toBe(true);
});

test('the picker scrolls inside itself instead of stretching the row', async ({ page }) => {
    await openComposer(page);
    const rowHeightBefore = await page.locator('.board-columns').evaluate((node) => node.getBoundingClientRect().height);
    const column = page.locator('.board-column').first();
    await column.locator('.board-add-status').click();
    const pick = column.locator('.board-pick');
    const box = await pick.evaluate((node) => ({
        maxHeight: getComputedStyle(node).maxHeight,
        height: node.getBoundingClientRect().height,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
    }));
    expect(box.maxHeight).toBe('190px');
    expect(box.overflowY).toBe('auto');
    expect(box.height).toBeLessThanOrEqual(190.5);
    expect(box.scrollHeight).toBeGreaterThan(box.height);
    // The picker renders in place inside its column (no popup, per §5.4), so the column does grow
    // — but by the capped height of a scrolling box, not by eleven rows. Without the cap this
    // column would grow by box.scrollHeight instead.
    const rowHeightAfter = await page.locator('.board-columns').evaluate((node) => node.getBoundingClientRect().height);
    expect(rowHeightAfter - rowHeightBefore).toBeLessThanOrEqual(box.height + 8);
    expect(rowHeightAfter - rowHeightBefore).toBeLessThan(box.scrollHeight);
});

test('clicking a picker row moves the status out of the column that held it', async ({ page }) => {
    await openComposer(page);
    const target = page.locator('.board-column').first();
    await target.locator('.board-add-status').click();
    await target.locator('.board-pick .component-chip[data-status="Release"]').click();

    expect(await chipStatuses(page, 0)).toEqual(['To Do', 'Release']);
    expect(await chipStatuses(page, 5)).toEqual(['In Progress']);
    const board = await boardState(page);
    const everywhere = board.columns.flatMap((column) => column.statuses);
    expect(everywhere.filter((status) => status === 'Release')).toHaveLength(1);
    // Focus returns to the control that opened the picker rather than falling to <body>.
    expect(await page.evaluate(() => document.activeElement.className)).toContain('board-add-status');
});

// The grip (§10.1) is deliberately not in the keyboard table and is not made focusable — it is a
// pointer-only accelerator for the drag gesture. + Add status and a chip's × are the keyboard
// paths, and this proves both ends of an assignment are reachable without ever touching the grip.
test('a status can be assigned and removed with only + Add status, ×, and the keyboard', async ({ page }) => {
    await openComposer(page);
    const target = page.locator('.board-column').first();

    await target.locator('.board-add-status').focus();
    await page.keyboard.press('Enter');
    await target.locator('.board-pick .component-chip[data-status="Release"]').focus();
    await page.keyboard.press('Enter');
    expect(await chipStatuses(page, 0)).toEqual(['To Do', 'Release']);
    expect(await chipStatuses(page, 5)).toEqual(['In Progress']);

    await target.locator('.component-chip[data-status="Release"] .remove-btn').focus();
    await page.keyboard.press('Enter');
    expect(await chipStatuses(page, 0)).toEqual(['To Do']);
    await expect(page.locator('.board-unmapped .component-chip[data-status="Release"]')).toHaveCount(1);
});

test('dragging a chip by its grip reaches the same state as the click path', async ({ page }) => {
    await openComposer(page);
    await pressHandle(page, page.locator('.component-chip[data-status="Release"] .chip-grip'));
    const outcome = await dispatchDrag(page,
        '.component-chip[data-status="Release"]',
        '.board-column:nth-of-type(1)');
    expect(outcome.started).toBe(true);
    expect(await chipStatuses(page, 0)).toEqual(['To Do', 'Release']);
    expect(await chipStatuses(page, 5)).toEqual(['In Progress']);
    // The drag state is cleared, so no target is left highlighted.
    await expect(page.locator('.board-column.is-drop, .board-unmapped.is-drop')).toHaveCount(0);
    await expect(page.locator('.group-board-composer.is-dragging-status')).toHaveCount(0);
});

test('a chip cannot be dragged by its body, only by its grip', async ({ page }) => {
    await openComposer(page);
    await pressHandle(page, page.locator('.component-chip[data-status="Release"] .component-name'));
    const outcome = await dispatchDrag(page,
        '.component-chip[data-status="Release"]',
        '.board-column:nth-of-type(1)');
    expect(outcome.started).toBe(false);
    expect(await chipStatuses(page, 0)).toEqual(['To Do']);
    expect(await chipStatuses(page, 5)).toEqual(['In Progress', 'Release']);
});

test('dragging a chip onto Not in a column sends it back to the pool', async ({ page }) => {
    await openComposer(page);
    await pressHandle(page, page.locator('.component-chip[data-status="Release"] .chip-grip'));
    await dispatchDrag(page, '.component-chip[data-status="Release"]', '.board-unmapped');
    expect(await chipStatuses(page, 5)).toEqual(['In Progress']);
    await expect(page.locator('.board-unmapped .component-chip[data-status="Release"]')).toHaveCount(1);
    await expect(page.locator('.board-unmapped.is-drop')).toHaveCount(0);
    await expect(page.locator('.board-column.is-drop')).toHaveCount(0);
});

test('a chip dragged from the leftover pool lands in the column it is dropped on', async ({ page }) => {
    await openComposer(page);
    await page.locator('.board-column .component-chip[data-status="Postponed"] .remove-btn').click();
    await pressHandle(page, page.locator('.board-unmapped .component-chip[data-status="Postponed"] .chip-grip'));
    await dispatchDrag(page,
        '.board-unmapped .component-chip[data-status="Postponed"]',
        '.board-column:nth-of-type(1)');
    expect(await chipStatuses(page, 0)).toEqual(['To Do', 'Postponed']);
    await expect(page.locator('.board-unmapped .component-chip')).toHaveCount(0);
});

test('the × on a chip sends it back to the pool too', async ({ page }) => {
    await openComposer(page);
    await page.locator('.board-column .component-chip[data-status="Killed"] .remove-btn').click();
    await expect(page.locator('.board-unmapped .component-chip[data-status="Killed"]')).toHaveCount(1);
    expect((await boardState(page)).columns[6].statuses).toEqual(['Done', 'Incomplete']);
});

test('every chip carries a grip and the grip is the grab affordance', async ({ page }) => {
    await openComposer(page);
    const chips = await page.$$eval('.board-column .component-chip', (nodes) => nodes.map((node) => ({
        hasGrip: Boolean(node.querySelector('.chip-grip')),
        gripCursor: node.querySelector('.chip-grip') ? getComputedStyle(node.querySelector('.chip-grip')).cursor : null,
        hasRemove: Boolean(node.querySelector('.remove-btn')),
    })));
    expect(chips).toHaveLength(12);
    expect(chips.every((chip) => chip.hasGrip && chip.gripCursor === 'grab' && chip.hasRemove)).toBe(true);
});

/* ── D46: column reorder, a second and separate drag system ─────────────────────────────────── */

// Kept alongside the dispatched reorder test: this one drives Chromium's own drag loop end to end.
test('dragging the handle reorders to the midpoint-derived index', async ({ page }) => {
    await openComposer(page);
    const handle = page.locator('.board-column').first().locator('.board-column-drag');
    const third = page.locator('.board-column').nth(2);
    const box = await third.boundingBox();
    await handle.dragTo(third, { targetPosition: { x: box.width - 4, y: 20 } });
    expect(await columnNames(page)).toEqual([
        'Analysis', 'Ready to start', 'To do', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);
    const board = await boardState(page);
    expect(board.columns.map((column) => column.name)).toEqual([
        'Analysis', 'Ready to start', 'To do', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);
    // Array order is the order: no `order` field is stored.
    expect(Object.keys(board.columns[0]).sort()).toEqual(['colour', 'id', 'max', 'min', 'name', 'star', 'statuses']);
});

test('Alt+Right and Alt+Left move a column and keep focus on the handle', async ({ page }) => {
    await openComposer(page);
    const handle = page.locator('.board-column').first().locator('.board-column-drag');
    await handle.focus();
    await page.keyboard.press('Alt+ArrowRight');
    expect(await columnNames(page)).toEqual([
        'Analysis', 'To do', 'Ready to start', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);
    expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).toBe('Reorder To do');
    await expect(page.locator('[aria-live="polite"]', { hasText: 'To do moved to position 2 of 7' })).toHaveCount(1);

    await page.keyboard.press('Alt+ArrowLeft');
    expect(await columnNames(page)).toEqual([
        'To do', 'Analysis', 'Ready to start', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);
    expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).toBe('Reorder To do');
});

test('Alt+Left on the first column is a no-op and does not lose focus', async ({ page }) => {
    await openComposer(page);
    const handle = page.locator('.board-column').first().locator('.board-column-drag');
    await handle.focus();
    await page.keyboard.press('Alt+ArrowLeft');
    expect((await columnNames(page))[0]).toBe('To do');
    expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).toBe('Reorder To do');
});

test('the two drag systems do not collide', async ({ page }) => {
    await openComposer(page);
    const before = await columnNames(page);

    // Dragging a chip must not reorder its column.
    const grip = page.locator('.board-column').nth(5).locator('.component-chip[data-status="Release"] .chip-grip');
    await grip.dragTo(page.locator('.board-column').first());
    expect(await columnNames(page)).toEqual(before);

    // Dragging the handle must not move a chip.
    const statusesBefore = await page.$$eval('.board-column .selected-components-list .component-chip',
        (nodes) => nodes.map((node) => node.dataset.status).sort());
    const handle = page.locator('.board-column').first().locator('.board-column-drag');
    await handle.dragTo(page.locator('.board-column').nth(3));
    const statusesAfter = await page.$$eval('.board-column .selected-components-list .component-chip',
        (nodes) => nodes.map((node) => node.dataset.status).sort());
    expect(statusesAfter).toEqual(statusesBefore);
    expect(await columnNames(page)).not.toEqual(before);
});

test('the column body is not a drag surface', async ({ page }) => {
    await openComposer(page);
    const before = await columnNames(page);
    await pressHandle(page, page.locator('.board-column').first().locator('.board-column-limits'));
    const outcome = await dispatchDrag(page, '.board-column:nth-of-type(1)', '.board-column:nth-of-type(5)');
    expect(outcome.started, 'a press on the column body must not start a reorder').toBe(false);
    expect(await columnNames(page)).toEqual(before);
});

test('a handle drag inserts before the column whose midpoint the pointer has not passed', async ({ page }) => {
    await openComposer(page);
    const third = await page.locator('.board-column').nth(2).boundingBox();
    await pressHandle(page, page.locator('.board-column').first().locator('.board-column-drag'));
    const outcome = await dispatchDrag(page, '.board-column:nth-of-type(1)', '.board-columns', {
        // Just past the third column's midpoint: the moved column lands after it.
        x: third.x + (third.width / 2) + 4,
        y: third.y + 20,
    });
    expect(outcome.started).toBe(true);
    expect(await columnNames(page)).toEqual([
        'Analysis', 'Ready to start', 'To do', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);
    expect((await boardState(page)).columns.map((column) => column.name)[2]).toBe('To do');
});

/* ── D46: the colour grid ───────────────────────────────────────────────────────────────────── */

test('the colour grid is keyboard-operable and stays inside the enum', async ({ page }) => {
    await openComposer(page);
    const column = page.locator('.board-column').first();
    await column.locator('.board-column-colour').first().click();
    const grid = column.locator('.board-pick-colours');
    await expect(grid).toHaveCount(1);
    await expect(grid.locator('[role="radio"]')).toHaveCount(7);
    await expect(grid.locator('[aria-checked="true"]')).toHaveCount(1);
    await expect(grid.locator('[aria-checked="true"]')).toHaveAttribute('aria-label', 'Grey');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).toBe('Blue');
    await page.keyboard.press('Enter');

    await expect(column.locator('.board-pick-colours')).toHaveCount(0);
    expect((await boardState(page)).columns[0].colour).toBe('#597ef7');
    expect(await column.evaluate((node) => getComputedStyle(node).borderTopColor)).toBe('rgb(89, 126, 247)');
    // Focus returns to the swatch that opened the grid.
    expect(await page.evaluate(() => document.activeElement.className)).toBe('board-column-colour');
});

test('Escape closes the colour grid without changing the colour', async ({ page }) => {
    await openComposer(page);
    const column = page.locator('.board-column').first();
    await column.locator('.board-column-colour').first().click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(column.locator('.board-pick-colours')).toHaveCount(0);
    expect((await boardState(page)).columns[0].colour).toBe('#8c8c8c');
});

test('every offered colour is one of the seven', async ({ page }) => {
    await openComposer(page);
    await page.locator('.board-column').first().locator('.board-column-colour').first().click();
    const offered = await page.$$eval('.board-pick-colours [role="radio"]',
        (nodes) => nodes.map((node) => node.style.getPropertyValue('--board-column-accent')));
    expect(offered).toEqual(['#8c8c8c', '#b37feb', '#597ef7', '#13c2c2', '#52c41a', '#e8a11d', '#ff4d4f']);
});

/* ── §5.8: the Min/Max grammar, parsed on blur ──────────────────────────────────────────────── */

async function minInput(page, index) {
    return page.locator('.board-column').nth(index).locator('.board-column-limits input').first();
}

async function maxInput(page, index) {
    return page.locator('.board-column').nth(index).locator('.board-column-limits input').nth(1);
}

test('an empty Min clears the threshold', async ({ page }) => {
    await openComposer(page);
    const input = await minInput(page, 1);
    await input.fill('');
    await input.blur();
    expect((await boardState(page)).columns[1].min).toBe(null);
    await expect(input).toHaveValue('');
});

test('a whole number in range is accepted, 0 included', async ({ page }) => {
    await openComposer(page);
    const input = await minInput(page, 0);
    await input.fill('0');
    await input.blur();
    expect((await boardState(page)).columns[0].min).toBe(0);
    await input.fill('9999');
    await input.blur();
    expect((await boardState(page)).columns[0].min).toBe(9999);
});

test('abc reverts on blur and never becomes 0', async ({ page }) => {
    await openComposer(page);
    // Column 3 ("Accepted in Q", max 12) does not breach — 7 epics is within its max — so on this
    // column .hot can only come from the rejected input. Assert it is false first; the sibling test
    // below covers the other half, that a breaching column's inputs stay clean.
    const input = await maxInput(page, 3);
    await expect(input).not.toHaveClass(/hot/);
    await input.fill('abc');
    await input.blur();
    await expect(input).toHaveValue('12');
    await expect(input).toHaveClass(/hot/);
    expect(await input.getAttribute('title')).toMatch(/whole number/);
    expect((await boardState(page)).columns[3].max).toBe(12);
});

test('a breaching column marks the column, never its Min/Max input', async ({ page }) => {
    await openComposer(page);
    // D24 keeps the two severities apart: .hot means "you typed something invalid", the breach
    // glow means "the work is outside the range you set". Conflating them made a valid config read
    // as invalid input, and made the rejected-input assertion above unfalsifiable.
    // Column 1 ("Analysis") is 4 under its min of 15; column 5 ("In progress") is 6 over its max
    // of 20. Both must glow, and neither input may be .hot.
    const analysis = page.locator('.board-column').nth(1);
    const inProgress = page.locator('.board-column').nth(5);
    await expect(analysis).toHaveClass(/is-breach/);
    await expect(inProgress).toHaveClass(/is-breach/);
    await expect(await minInput(page, 1)).not.toHaveClass(/hot/);
    await expect(await maxInput(page, 1)).not.toHaveClass(/hot/);
    await expect(await minInput(page, 5)).not.toHaveClass(/hot/);
    await expect(await maxInput(page, 5)).not.toHaveClass(/hot/);
});

test('5x, -3, 1.5 and 10000 all revert rather than coercing', async ({ page }) => {
    await openComposer(page);
    const input = await minInput(page, 1);
    for (const raw of ['5x', '-3', '1.5', '10000']) {
        await input.fill(raw);
        await input.blur();
        await expect(input, `${raw} must revert`).toHaveValue('15');
        expect((await boardState(page)).columns[1].min, `${raw} must not change the model`).toBe(15);
    }
    expect(await input.getAttribute('title')).toMatch(/9999/);
});

test('parsing happens on blur, not on a keystroke', async ({ page }) => {
    await openComposer(page);
    const input = await minInput(page, 1);
    await input.fill('');
    await input.blur();
    await input.click();
    await page.keyboard.type('12');
    // Mid-type the field still reads exactly what was typed and the model has not moved.
    await expect(input).toHaveValue('12');
    expect((await boardState(page)).columns[1].min).toBe(null);
    expect(await input.evaluate((node) => node.selectionStart)).toBe(2);
    await input.blur();
    expect((await boardState(page)).columns[1].min).toBe(12);
});

test('min above max marks both inputs and blocks Save', async ({ page }) => {
    await openComposer(page);
    const column = page.locator('.board-column').nth(3);
    const min = column.locator('.board-column-limits input').first();
    const max = column.locator('.board-column-limits input').nth(1);
    await min.fill('30');
    await min.blur();
    await expect(min).toHaveClass(/hot/);
    await expect(max).toHaveClass(/hot/);
    await expect(page.locator('.group-modal-validation')).toContainText('min above its max');
    await expect(page.locator('#harness-save')).toBeDisabled();
});

test('deleting a column with an unresolved Min/Max error clears the warning, not just the input', async ({ page }) => {
    await openComposer(page);
    const column = page.locator('.board-column').nth(1); // Analysis
    const input = column.locator('.board-column-limits input').first();
    await input.fill('abc');
    await input.blur();
    const warning = page.locator('.group-board-composer .group-modal-warning').filter({ hasText: /whole number/ });
    await expect(warning).toHaveCount(1);
    await expect(warning).toContainText('Analysis'); // names the column, not a bare message

    await column.locator('.remove-btn[title="Delete column"]').click();
    // With no input left to blur, only the delete itself can clear this — otherwise it would
    // warn for the rest of the session about a column that no longer exists.
    await expect(page.locator('.group-board-composer .group-modal-warning').filter({ hasText: /whole number/ }))
        .toHaveCount(0);
});

/* ── Two severities ─────────────────────────────────────────────────────────────────────────── */

test('an empty column blocks Save; a breach does not', async ({ page }) => {
    await openComposer(page);
    await expect(page.locator('#harness-save')).toBeEnabled();
    await expect(page.locator('.board-column.is-breach')).toHaveCount(2);

    await page.locator('.board-column').nth(1).locator('.component-chip[data-status="Analysis"] .remove-btn').click();
    await expect(page.locator('.board-column').nth(1)).toHaveClass(/is-empty/);
    await expect(page.locator('.board-column').nth(1)).toContainText('No statuses — will not render');
    await expect(page.locator('.group-modal-validation')).toContainText('Analysis');
    await expect(page.locator('#harness-save')).toBeDisabled();

    // Putting a status back clears it.
    await page.locator('.board-column').nth(1).locator('.board-add-status').click();
    await page.locator('.board-column').nth(1).locator('.board-pick .component-chip[data-status="Analysis"]').click();
    await expect(page.locator('#harness-save')).toBeEnabled();
});

test('deleting every column preserves an explicit empty board and blocks Save', async ({ page }) => {
    await openComposer(page);
    for (let index = 0; index < 7; index += 1) {
        await page.locator('.board-column .remove-btn[title="Delete column"]').first().click();
    }
    await expect(page.locator('.board-column')).toHaveCount(0);
    expect(await boardState(page)).toEqual({ columns: [] });
    await expect(page.locator('#harness-save')).toBeDisabled();
    await expect(page.locator('.group-modal-validation')).toContainText('A board needs at least one column.');
});

test('a new column gets an opaque lowercase hex id that is never reused', async ({ page }) => {
    // A real Math.random() draws from 2^32 ids, so five draws would pass this test whether or not
    // deleteColumn purges a retired id from usedIdsRef — a collision essentially never happens by
    // chance either way. A fixed random source forces the exact same raw hex on every draw, so a
    // purge becomes directly observable: the next add would get back the very id just deleted
    // instead of the next hex after it (createColumnId's deterministic fallback scan).
    await openComposer(page, { random: '() => 0.4' });
    await page.locator('.board-add-column').click();
    let board = await boardState(page);
    expect(board.columns).toHaveLength(8);
    const created = board.columns[7].id;
    expect(created).toMatch(/^col-[0-9a-f]{8}$/);

    await page.locator('.board-column').nth(7).locator('.remove-btn[title="Delete column"]').click();
    const seen = new Set([created]);
    for (let index = 0; index < 4; index += 1) {
        await page.locator('.board-add-column').click();
        board = await boardState(page);
        const id = board.columns[board.columns.length - 1].id;
        expect(id).toMatch(/^col-[0-9a-f]{8}$/);
        expect(seen.has(id), 'a deleted id must never come back').toBe(false);
        seen.add(id);
        await page.locator('.board-column').last().locator('.remove-btn[title="Delete column"]').click();
    }
});

test('the twelfth column is the last one that can be added', async ({ page }) => {
    await openComposer(page);
    for (let index = 0; index < 5; index += 1) await page.locator('.board-add-column').click();
    await expect(page.locator('.board-column')).toHaveCount(12);
    await expect(page.locator('.board-add-column')).toBeDisabled();
});

/* ── D44: live status checking is advisory ──────────────────────────────────────────────────── */

test('no_board_configured renders an honest state, not a blank composer', async ({ page }) => {
    await openComposer(page, { statuses: 'no_board' });
    await expect(page.locator('.board-column')).toHaveCount(7);
    await expect(page.locator('.group-board-composer .group-modal-warning')
        .filter({ hasText: 'No Jira board is configured yet' })).toHaveCount(1);
    await expect(page.locator('#harness-save')).toBeEnabled();
    // Moving a status between columns still works without a catalog.
    await page.locator('.board-column').first().locator('.board-add-status').click();
    await expect(page.locator('.board-column').first().locator('.board-pick .component-chip')).toHaveCount(11);
});

test('the Not-in-a-column pool tells no-board apart from a failed load', async ({ page }) => {
    await openComposer(page, { statuses: 'no_board' });
    const pool = page.locator('.board-unmapped');
    await expect(pool).toContainText('No Jira board is configured');
    await expect(pool).not.toContainText('could not be loaded');

    await openComposer(page, { statuses: 'unresolvable' });
    const failedPool = page.locator('.board-unmapped');
    await expect(failedPool).toContainText('could not be loaded');
    await expect(failedPool).not.toContainText('No Jira board is configured');
});

test('an empty project status set explains itself and names the project', async ({ page }) => {
    await openComposer(page, { statuses: 'unresolvable' });
    await expect(page.locator('.group-board-composer .group-modal-warning')
        .filter({ hasText: 'no usable statuses for project PLAT' })).toHaveCount(1);
    await expect(page.locator('#harness-save')).toBeEnabled();
});

test('a refused board read says it is a permissions answer', async ({ page }) => {
    await openComposer(page, { statuses: 'forbidden' });
    const warning = page.locator('.group-board-composer .group-modal-warning')
        .filter({ hasText: 'Jira refused the saved board read' });
    await expect(warning).toHaveCount(1);
    await expect(warning).toContainText('permission');
});

test('the add-status picker does not claim every status is placed when none loaded', async ({ page }) => {
    // One column and no catalog: there is nothing to offer, and the reason is that the
    // catalog failed — not that every status is already here.
    const board = JSON.stringify({
        columns: [{
            id: 'col-1a2b3c4d', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'],
        }],
    });
    await openComposer(page, { statuses: 'unresolvable', initialBoard: board });
    await page.locator('.board-column').first().locator('.board-add-status').click();
    const pick = page.locator('.board-column').first().locator('.board-pick');
    await expect(pick).not.toContainText('Every status is already in this column');
    await expect(pick).toContainText('could not be loaded');
});

test('a 502 states what failed and keeps the saved columns', async ({ page }) => {
    await openComposer(page, { statuses: 'jira_down' });
    await expect(page.locator('.board-column')).toHaveCount(7);
    await expect(page.locator('.group-board-composer .group-modal-warning')
        .filter({ hasText: 'Jira returned status 500' })).toHaveCount(1);
    await expect(page.locator('#harness-save')).toBeEnabled();
});

test('a saved status that is no longer on the board is flagged and kept', async ({ page }) => {
    const board = JSON.stringify({
        columns: [{
            id: 'col-1a2b3c4d',
            name: 'Done',
            colour: '#52c41a',
            star: false,
            min: null,
            max: null,
            statuses: ['Done', 'Retired'],
        }],
    });
    await openComposer(page, { initialBoard: board });
    await expect(page.locator('.component-chip[data-status="Retired"]')).toHaveCount(1);
    await expect(page.locator('.component-chip[data-status="Retired"]')).toHaveClass(/is-stale/);
    await expect(page.locator('.group-board-composer .group-modal-warning')
        .filter({ hasText: 'Retired is no longer on the board' })).toHaveCount(1);
    await expect(page.locator('#harness-save')).toBeEnabled();
    expect((await boardState(page)).columns[0].statuses).toEqual(['Done', 'Retired']);
});

test('the status catalog is fetched once per board id for the session', async ({ page }) => {
    const requests = await openComposer(page);
    expect(requests.count).toBe(1);
    await page.evaluate(() => window.__groupBoardHarnessRemount());
    await page.waitForSelector('.board-column');
    await expect(page.locator('.board-unmapped')).toContainText('Nothing left over');
    expect(requests.count).toBe(1);
});

// *Reset to default columns* (§5.5's second fixture). The derivation is eng/engBoardColumns.js's,
// shared with the board itself, so this asserts the wiring and the composer-side consequences —
// fresh ids, the star, the emitted board — not the grouping rule, which has its own unit tests.
test('Reset to default columns replaces the columns with the name-based default', async ({ page }) => {
    await openComposer(page, { initialBoard: JSON.stringify(fixture.referenceBoard()) });
    expect(await columnNames(page)).toHaveLength(7);
    const before = (await boardState(page)).columns.map((column) => column.id);

    await page.getByRole('button', { name: 'Reset to default columns' }).click();

    expect(await columnNames(page)).toEqual(
        fixture.REFERENCE_DEFAULT_COLUMNS.map((column) => column.name),
    );
    const board = await boardState(page);
    expect(board.columns.map((column) => column.statuses)).toEqual(
        fixture.REFERENCE_DEFAULT_COLUMNS.map((column) => column.statuses),
    );
    expect(board.columns.map((column) => column.colour)).toEqual(
        fixture.REFERENCE_DEFAULT_COLUMNS.map((column) => column.colour),
    );
    expect(board.columns.map((column) => column.star)).toEqual([false, true, false]);
    // Ids are generated, never reused from the columns the reset replaced (§5.6).
    board.columns.forEach((column) => {
        expect(column.id).toMatch(/^col-[0-9a-f]{8}$/);
        expect(before).not.toContain(column.id);
    });
    // Every status is still placed, so nothing lands in Unmapped.
    await expect(page.locator('.board-unmapped')).toContainText('Nothing left over');
    await expect(page.locator('#harness-save')).toBeEnabled();
});

test('Reset to default columns is disabled while the board statuses are unavailable', async ({ page }) => {
    await openComposer(page, {
        statuses: 'jira_down',
        initialBoard: JSON.stringify(fixture.referenceBoard()),
    });
    await expect(page.getByRole('button', { name: 'Reset to default columns' })).toBeDisabled();
    expect(await columnNames(page)).toHaveLength(7);
});
