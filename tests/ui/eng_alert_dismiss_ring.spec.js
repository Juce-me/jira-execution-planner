const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { CATEGORIES, openRingDashboard, ringReach, settle } = require('./eng_alert_dismiss_ring_fixture');

// The dismiss x sits in the last grid column of an alert row, whose card body clips with
// overflow: hidden. Its settled hover ring must stay inside both, and the glyph must be centred.
const viewports = [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'mobile', width: 375, height: 800 },
];
const screenshotDir = process.env.JEP_RING_SHOTS ? path.resolve(process.env.JEP_RING_SHOTS) : '';

async function measure(page, button) {
    return button.evaluate((el) => {
        const rect = (node) => node.getBoundingClientRect();
        const button = rect(el);
        const row = rect(el.closest('.alert-story'));
        const body = rect(el.closest('.alert-card-body'));
        const range = document.createRange();
        range.selectNodeContents(el);
        const glyph = rect(range);
        return {
            boxShadow: getComputedStyle(el).boxShadow,
            buttonRight: button.right,
            rowRight: row.right,
            bodyRight: body.right,
            glyphDx: (glyph.left + glyph.right) / 2 - (button.left + button.right) / 2,
            glyphDy: (glyph.top + glyph.bottom) / 2 - (button.top + button.bottom) / 2,
            width: button.width,
            height: button.height,
        };
    });
}

for (const viewport of viewports) {
    for (const sprint of ['active', 'future']) {
        test(`alert dismiss hover ring stays inside the row and card body (${sprint} sprint, ${viewport.name})`, async ({ page }) => {
            await openRingDashboard(page, sprint, viewport);
            const categories = CATEGORIES.filter(category => category.sprint === sprint);
            const failures = [];
            for (const category of categories) {
                const buttons = page.locator(`#${category.sectionId} .alert-card-body .alert-remove`);
                await expect(buttons.first(), `${category.label} renders a dismiss button`).toBeVisible();
                const count = await buttons.count();
                for (let index = 0; index < count; index += 1) {
                    const button = buttons.nth(index);
                    await button.scrollIntoViewIfNeeded();
                    await page.mouse.move(0, 0);
                    await button.hover();
                    await expect.poll(() => button.evaluate(el => getComputedStyle(el).boxShadow !== 'none' && el.getAnimations().length === 0)).toBe(true);
                    await settle(page);
                    const result = await measure(page, button);
                    result.reach = ringReach(result.boxShadow);
                    result.ringRight = result.buttonRight + result.reach;
                    expect(result.reach, `${category.label} hover ring spread`).toBeGreaterThan(0);
                    if (screenshotDir && index === 0) {
                        fs.mkdirSync(screenshotDir, { recursive: true });
                        const row = button.locator('xpath=ancestor::*[contains(@class,"alert-story")][1]');
                        await row.screenshot({ path: path.join(screenshotDir, `${category.sectionId}-${viewport.name}.png`) });
                    }
                    if (result.ringRight > result.rowRight + 0.01) failures.push(`${category.label}[${index}] ring ${result.ringRight.toFixed(2)} > row ${result.rowRight.toFixed(2)}`);
                    if (result.ringRight > result.bodyRight + 0.01) failures.push(`${category.label}[${index}] ring ${result.ringRight.toFixed(2)} > card body ${result.bodyRight.toFixed(2)}`);
                    if (Math.abs(result.glyphDx) > 1) failures.push(`${category.label}[${index}] glyph dx ${result.glyphDx.toFixed(2)}`);
                    if (Math.abs(result.glyphDy) > 1.5) failures.push(`${category.label}[${index}] glyph dy ${result.glyphDy.toFixed(2)}`);
                    // The control keeps its size: only its room changes.
                    expect(Math.abs(result.width - result.height), `${category.label} stays round`).toBeLessThan(0.5);
                }
            }
            expect(failures).toEqual([]);
        });
    }
}

test('ring reach ignores the inset hover overlay in either colour serialization', () => {
    const ring = '0px 0px 0px 1px rgb(47, 128, 237), 0px 0px 0px 3px rgba(47, 128, 237, 0.25)';
    const srgb = `color(srgb 0.5 0.5 0.5 / 0.08) 0px 0px 0px 999px inset, ${ring}`;
    const rgba = `rgba(15, 23, 42, 0.08) 0px 0px 0px 999px inset, ${ring}`;
    expect(ringReach(srgb)).toBe(3);
    expect(ringReach(rgba)).toBe(3);
    expect(ringReach('none')).toBe(0);
});
