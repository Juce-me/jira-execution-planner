const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { mockDashboard, appBaseUrl, catchUpPrefs, parkPointer } = require('./eng_epic_refresh_fixture');

// Hover readouts above ENG priority glyphs must paint on top of every sticky tier (the sticky `.epic-header`,
// `.filterbar-wrap` and the stuck Planning panel). The fixture serves the full built `frontend/dist/dashboard.css`,
// so the real stacking contexts are in play. The readout is the shared portaled `EpicHeaderValueReadout`; it is
// pointer-transparent, so the paint checks switch its pointer events on only for the hit test.
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const evidenceDir = process.env.JEP_READOUT_EVIDENCE_DIR || '';

async function open(page, prefs = {}) {
    const ctx = await mockDashboard(page);
    ctx.respond('/api/issues/priorities/options', ({ json }) => json({ priorities: [{ id: '1', name: 'Highest', rank: 10 }, { id: '2', name: 'Low', rank: 50 }], source: 'jira' }));
    await page.addInitScript(value => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), catchUpPrefs(prefs));
    await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
    await expect(page.locator('.task-item[data-task-key="E1-S12"]')).toBeAttached();
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

test('Planning List readouts paint above the stuck Planning panel and Epic header', async ({ page }) => {
    await open(page, { showPlanning: true, planningLayout: 'list' });
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await stickEpicHeader(page, 'EPIC-1', 700);
    await expect(page.locator('.planning-panel.open')).toHaveClass(/\bstuck\b/);
    expectPaintedAndOnScreen(await hoverAndProbe(page, epicTrigger(page, 'EPIC-1'), 'planning-list-stuck-epic-header'));
    const key = await page.locator('.epic-block[data-epic-key="EPIC-1"]').evaluate((block) => {
        const bottom = block.querySelector(':scope > .epic-header').getBoundingClientRect().bottom;
        return [...block.querySelectorAll('.task-item')].find(item => item.querySelector('button.task-priority-icon').getBoundingClientRect().top > bottom + 1).dataset.taskKey;
    });
    expectPaintedAndOnScreen(await hoverAndProbe(page, storyTrigger(page, key), 'planning-list-story-under-stuck-header'));
});

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
    // Hovering an option's priority marker inside the menu raises no readout over the next option.
    await option.locator('.task-priority-icon').hover();
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
