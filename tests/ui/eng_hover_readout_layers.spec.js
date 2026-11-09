const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { mockDashboard, appBaseUrl, catchUpPrefs, parkPointer, groupsConfigPayload } = require('./eng_epic_refresh_fixture');

// Hover readouts above ENG priority glyphs must paint on top of every sticky tier (the sticky `.epic-header`,
// `.filterbar-wrap` and the stuck Planning panel). The fixture serves the full built `frontend/dist/dashboard.css`,
// so the real stacking contexts are in play. The readout is the shared portaled `EpicHeaderValueReadout`; it is
// pointer-transparent, so the paint checks switch its pointer events on only for the hit test.
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const evidenceDir = process.env.JEP_READOUT_EVIDENCE_DIR || '';

const BOARD_COLUMNS = [
    { id: 'todo', name: 'To do', colour: '#597ef7', star: true, statuses: ['To Do', 'In Progress'], min: null, max: null },
    { id: 'done', name: 'Done', colour: '#52c41a', star: false, statuses: ['Done'], min: null, max: null },
];

async function open(page, prefs = {}, { ready = '.task-item[data-task-key="E1-S12"]', authMode = '' } = {}) {
    const ctx = await mockDashboard(page);
    if (authMode) ctx.respond('/api/config', ({ json }) => json({ jiraUrl: 'https://jira.example', capacityProject: '', authMode, projectsConfigured: true, userCanEditSettings: true, environmentConfigExists: true }));
    ctx.scenario.epics['EPIC-1'].priority = 'Blocker';
    ctx.respond('/api/issues/priorities/options', ({ json }) => json({ priorities: [{ id: '1', name: 'Highest', rank: 10 }, { id: '2', name: 'Low', rank: 50 }], source: 'jira' }));
    ctx.respond('/api/groups-config', ({ json }) => json({ ...groupsConfigPayload, groups: groupsConfigPayload.groups.map(group => ({ ...group, board: { columns: BOARD_COLUMNS } })) }));
    await page.addInitScript(value => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), catchUpPrefs(prefs));
    // Counts truncation observers attached to priority icons: an always-on readout mounts none (initial-load cost).
    await page.addInitScript(() => {
        window.__priorityIconObservers = 0;
        const Native = window.ResizeObserver;
        window.ResizeObserver = class extends Native {
            observe(target, options) {
                if (target?.classList?.contains('task-priority-icon')) window.__priorityIconObservers += 1;
                return super.observe(target, options);
            }
        };
    });
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
    await expect(page.locator(ready).first()).toBeAttached();
    await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
    return ctx;
}

const storyTrigger = (page, key) => page.locator(`.task-item[data-task-key="${key}"] button.task-priority-icon[data-priority]`);
const epicTrigger = (page, epicKey) => page.locator(`.epic-block[data-epic-key="${epicKey}"] > .epic-header button.task-priority-icon[data-priority]`).first();
const readout = page => page.locator('.epic-full-value-readout[role="tooltip"]');

async function shoot(page, trigger, name) {
    if (!evidenceDir) return;
    fs.mkdirSync(evidenceDir, { recursive: true });
    const box = await trigger.boundingBox();
    await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), clip: { x: Math.max(0, box.x - 160), y: Math.max(0, box.y - 70), width: 380, height: 140 } });
}

// Hovers the trigger with a real mouse, waits for the readout to settle, and returns what is painted at its top-edge
// centre (1px inset) and its four corners, plus its box against the viewport. A corner point sits 1px inside the
// rounded border's arc (radius r: r * (1 - 1/sqrt(2)) along each axis), since the square corner itself is unpainted.
async function hoverAndProbe(page, trigger, name) {
    await trigger.scrollIntoViewIfNeeded();
    const box = await trigger.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await shoot(page, trigger, name);
    const label = await trigger.getAttribute('data-priority');
    await expect(readout(page)).toHaveCount(1);
    await expect(readout(page)).toBeVisible();
    await expect(readout(page)).toHaveText(label);
    return probeReadout(page);
}

// What is painted at the visible readout's top-edge centre and four corners, plus its box against the viewport.
async function probeReadout(page) {
    return readout(page).evaluate((el) => {
        const previous = el.style.pointerEvents;
        el.style.pointerEvents = 'auto';
        const b = el.getBoundingClientRect();
        const c = parseFloat(getComputedStyle(el).borderTopLeftRadius) * (1 - Math.SQRT1_2) + 1;
        const points = { topCentre: [b.left + b.width / 2, b.top + 1], topLeft: [b.left + c, b.top + c], topRight: [b.right - c, b.top + c], bottomLeft: [b.left + c, b.bottom - c], bottomRight: [b.right - c, b.bottom - c] };
        const hits = {};
        for (const [point, [x, y]] of Object.entries(points)) {
            const hit = document.elementFromPoint(x, y);
            hits[point] = hit && (hit === el || el.contains(hit)) ? 'readout' : hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : null;
        }
        el.style.pointerEvents = previous;
        return { hits, box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, viewport: { width: window.innerWidth, height: window.innerHeight } };
    });
}

function expectPaintedAndOnScreen(result) {
    expect(result.hits).toEqual({ topCentre: 'readout', topLeft: 'readout', topRight: 'readout', bottomLeft: 'readout', bottomRight: 'readout' });
    expect(result.box.left).toBeGreaterThanOrEqual(0);
    expect(result.box.top).toBeGreaterThanOrEqual(0);
    expect(result.box.right).toBeLessThanOrEqual(result.viewport.width);
    expect(result.box.bottom).toBeLessThanOrEqual(result.viewport.height);
}

// Scrolls until the Epic's sticky header is stuck: its block has scrolled past while the header holds its offset.
async function stickEpicHeader(page, epicKey, by = 500) {
    await page.evaluate(distance => window.scrollTo(0, distance), by);
    // The page re-anchors once after a programmatic scroll (compact header): wait until it settles.
    await expect.poll(async () => {
        const first = await page.evaluate(() => window.scrollY);
        await page.waitForTimeout(200);
        return first === await page.evaluate(() => window.scrollY);
    }).toBe(true);
    const stuck = await page.locator(`.epic-block[data-epic-key="${epicKey}"]`).evaluate((block) => {
        const header = block.querySelector(':scope > .epic-header');
        return block.getBoundingClientRect().top < header.getBoundingClientRect().top - 1 && getComputedStyle(header).position === 'sticky';
    });
    expect(stuck).toBe(true);
}

test('Catch Up first Story priority readout paints above its sticky Epic header', async ({ page }) => {
    await open(page);
    expectPaintedAndOnScreen(await hoverAndProbe(page, storyTrigger(page, 'E1-S01'), 'catch-up-first-story'));
});

test('Catch Up Story priority readout near the viewport bottom stays painted and on screen', async ({ page }) => {
    await open(page);
    const trigger = storyTrigger(page, 'E1-S12');
    await trigger.scrollIntoViewIfNeeded();
    // Park the icon 12px above the viewport bottom; re-measure until the page stops re-anchoring after the scroll.
    const bottomGap = async () => { const box = await trigger.boundingBox(); return page.viewportSize().height - (box.y + box.height); };
    await expect.poll(async () => {
        const gap = await bottomGap();
        if (Math.abs(gap - 12) > 2) await page.evaluate(delta => window.scrollBy(0, delta), 12 - gap);
        await page.waitForTimeout(200);
        return Math.abs(await bottomGap() - 12) <= 2;
    }).toBe(true);
    const result = await hoverAndProbe(page, trigger, 'catch-up-bottom-story');
    expectPaintedAndOnScreen(result);
    expect(result.box.bottom).toBeLessThanOrEqual((await trigger.boundingBox()).y);
});

test('Catch Up Epic header priority readout paints above the filter bar while the header is stuck', async ({ page }) => {
    await open(page);
    await stickEpicHeader(page, 'EPIC-1');
    expectPaintedAndOnScreen(await hoverAndProbe(page, epicTrigger(page, 'EPIC-1'), 'catch-up-stuck-epic-header'));
});

test('Catch Up Story under a stuck Epic header keeps its priority readout painted', async ({ page }) => {
    await open(page);
    await stickEpicHeader(page, 'EPIC-1');
    const key = await page.locator('.epic-block[data-epic-key="EPIC-1"]').evaluate((block) => {
        const bottom = block.querySelector(':scope > .epic-header').getBoundingClientRect().bottom;
        return [...block.querySelectorAll('.task-item')].find(item => item.querySelector('button.task-priority-icon').getBoundingClientRect().top > bottom + 1).dataset.taskKey;
    });
    expectPaintedAndOnScreen(await hoverAndProbe(page, storyTrigger(page, key), 'catch-up-story-under-stuck-header'));
});

// Planning is the Table only (#323): its readouts are pinned by the Planning Table tests below.

test('the priority readout never intercepts the pointer and closes when the menu opens', async ({ page }) => {
    await open(page);
    const trigger = storyTrigger(page, 'E1-S02');
    await hoverAndProbe(page, trigger, 'pointer-transparent');
    // Pointer-transparent: what lies under the readout's centre is the page, not the readout.
    const underCentre = await readout(page).evaluate((el) => {
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return Boolean(hit && (hit === el || el.contains(hit)));
    });
    expect(underCentre).toBe(false);
    await expect(trigger).toHaveAttribute('aria-label', 'Major');
    await trigger.click();
    const menu = page.locator('.priority-transition-menu[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(readout(page)).toHaveCount(0);
    const option = menu.getByRole('menuitem').first();
    await expect(option).toBeVisible();
    const optionOnTop = await option.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return Boolean(hit && (hit === el || el.contains(hit)));
    });
    expect(optionOnTop).toBe(true);
    // An option's priority marker sits beside its name, so hovering it raises no readout and the next option stays on top.
    await option.locator('.task-priority-icon').hover();
    await page.waitForTimeout(200);
    await expect(readout(page)).toHaveCount(0);
    const next = menu.getByRole('menuitem').nth(1);
    const nextOnTop = await next.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
        return Boolean(hit && (hit === el || el.contains(hit)));
    });
    expect(nextOnTop).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await parkPointer(page);
    await expect(readout(page)).toHaveCount(0);
});

test('negative control: the paint probe reports a readout covered by a sticky tier', async ({ page }) => {
    await open(page);
    await stickEpicHeader(page, 'EPIC-1');
    expectPaintedAndOnScreen(await hoverAndProbe(page, epicTrigger(page, 'EPIC-1'), 'negative-control-before'));
    // Drop the readout below the sticky filter bar's stacking level and place it over the bar: the probe must see the bar.
    await readout(page).evaluate((el) => {
        const bar = document.querySelector('.filterbar-wrap').getBoundingClientRect();
        el.style.zIndex = '1';
        el.style.top = `${bar.top + 2}px`;
    });
    const covered = await probeReadout(page);
    const hits = Object.values(covered.hits);
    expect(hits.filter(hit => hit === 'readout')).toEqual([]);
    const inBar = await readout(page).evaluate((el) => {
        const b = el.getBoundingClientRect();
        return [[b.left + b.width / 2, b.top + 1], [b.left + 4, b.bottom - 4]].map(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.filterbar-wrap')));
    });
    expect(inBar, JSON.stringify(covered.hits)).toEqual([true, true]);
});

test('an always-on priority readout mounts no truncation observer on any icon', async ({ page }) => {
    await open(page);
    expect(await page.locator('.task-priority-icon').count()).toBeGreaterThan(10);
    expect(await page.evaluate(() => window.__priorityIconObservers)).toBe(0);
});

test('Board card passive priority readout paints, passes the pointer and leaves the card click opening its panel', async ({ page }) => {
    await open(page, { showBoard: true }, { ready: '.ecard[data-epic-key="EPIC-1"]' });
    const card = page.locator('.ecard[data-epic-key="EPIC-1"]');
    const icon = card.locator('.ecard-open .task-priority-icon[data-priority]');
    await expect(icon).toHaveAttribute('data-priority', 'Blocker');
    expect(await icon.evaluate(node => node.tagName)).toBe('SPAN');
    expectPaintedAndOnScreen(await hoverAndProbe(page, icon, 'board-card-passive'));
    expect(await page.evaluate(() => window.__priorityIconObservers)).toBe(0);
    // The click lands on the icon inside .ecard-open: the card still opens its panel.
    await icon.click();
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('Planning Table editable priority cell readout paints above the docked table header', async ({ page }) => {
    await open(page, { showPlanning: true, planningLayout: 'table' }, { ready: 'table button.task-priority-icon[data-priority]' });
    const icon = page.locator('table tbody button.task-priority-icon[data-priority]').first();
    expectPaintedAndOnScreen(await hoverAndProbe(page, icon, 'planning-table-editable-cell'));
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(300);
    const docked = await page.locator('table tbody button.task-priority-icon[data-priority]').evaluateAll(nodes => {
        const header = document.querySelector('table thead')?.getBoundingClientRect();
        return nodes.findIndex(node => node.getBoundingClientRect().top > (header?.bottom || 0) + 4 && node.getBoundingClientRect().bottom < window.innerHeight - 60);
    });
    expect(docked).toBeGreaterThanOrEqual(0);
    expectPaintedAndOnScreen(await hoverAndProbe(page, page.locator('table tbody button.task-priority-icon[data-priority]').nth(docked), 'planning-table-cell-scrolled'));
});

test('read-only Planning Table priority cell shows the name beside the icon and mounts no duplicate readout', async ({ page }) => {
    // A non-OAuth session renders the read-only cell: the icon followed by the priority name.
    await open(page, { showPlanning: true, planningLayout: 'table' }, { ready: 'table .task-priority-icon[data-priority]', authMode: 'jira_basic' });
    const icon = page.locator('table tbody .task-priority-icon[data-priority]').first();
    expect(await icon.evaluate(node => node.tagName)).toBe('SPAN');
    const label = await icon.getAttribute('data-priority');
    await expect(icon.locator('xpath=..')).toContainText(label);
    await icon.scrollIntoViewIfNeeded();
    const box = await icon.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await expect(readout(page)).toHaveCount(0);
});

test.describe('touch', () => {
    test.use({ hasTouch: true });

    test('a tap on a Board card priority icon pins its label, opens the panel unchanged and keeps the card draggable', async ({ page }) => {
        await open(page, { showBoard: true }, { ready: '.ecard[data-epic-key="EPIC-1"]' });
        const card = page.locator('.ecard[data-epic-key="EPIC-1"]');
        const icon = card.locator('.ecard-open .task-priority-icon[data-priority]');
        await page.evaluate(() => {
            window.__prevented = [];
            for (const type of ['pointerdown', 'touchstart', 'mousedown']) {
                window.addEventListener(type, event => { if (event.target.closest?.('.task-priority-icon')) window.__prevented.push(`${type}:${event.defaultPrevented}`); });
            }
        });
        await icon.tap();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(readout(page)).toHaveText('Blocker');
        expect(await page.evaluate(() => window.__prevented.filter(entry => entry.endsWith(':true')))).toEqual([]);
        // Drag starts from the icon exactly as from the card's plain title text.
        const dragFrom = selector => card.locator(selector).evaluate(node => node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })));
        expect(await dragFrom('.ecard-open .task-priority-icon')).toBe(await dragFrom('.etitle'));
        // An outside tap closes the pinned label.
        await page.touchscreen.tap(5, 5);
        await expect(readout(page)).toHaveCount(0);
    });
});

