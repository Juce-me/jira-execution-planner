const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const dashboardCss = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dist', 'dashboard.css'), 'utf8');

function boxesOverlap(a, b) {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

async function loadHeaderFixture(page) {
    await page.setContent(`
        <!doctype html>
        <html>
        <head>
            <style>${dashboardCss}</style>
        </head>
        <body>
            <main class="dashboard-shell">
                <div class="task-list epm-issue-board epm-portfolio-board">
                    <section class="epm-project-board">
                        <div class="epm-project-board-header ">
                            <button type="button" class="epm-project-board-toggle" aria-expanded="true">
                                <span class="epm-project-board-chevron">
                                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                                        <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
                                    </svg>
                                </span>
                                <span class="epm-project-board-icon">
                                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                                        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"></rect>
                                        <path d="M3 9h18" stroke="currentColor" stroke-width="1.6"></path>
                                    </svg>
                                </span>
                                <span class="epm-project-board-name">AI for RFP creation</span>
                            </button>
                            <div class="epm-project-board-meta">
                                <span class="epm-project-board-label-pill">RnD_Project_RFP_AI</span>
                                <a class="epm-project-board-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-324">Home</a>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row">
                            <div class="epm-project-board-update">
                                <div class="epm-project-board-update-copy">
                                    <p><strong>RFP AI bot</strong> and related <em>deals AI</em> work are progressing.</p>
                                    <p>Build is ready for <a href="https://example.test/client-testing">client testing</a>; rollout model defined.</p>
                                </div>
                            </div>
                            <span class="epm-project-board-update-date">yesterday</span>
                        </div>
                        <div class="epm-project-board-body">
                            <div class="epic-card">
                                <div class="epic-title">AI for RFP creation <span class="issue-key">PRODUCT-29920</span></div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </body>
        </html>
    `);
}

for (const viewport of [
    { name: 'desktop', width: 1520, height: 900 },
    { name: 'narrow', width: 520, height: 720 },
]) {
    test(`EPM portfolio header metadata does not overlap project name on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loadHeaderFixture(page);

        const header = page.locator('.epm-project-board-header');
        const body = page.locator('.epm-project-board-body');
        const toggle = page.locator('.epm-project-board-toggle');
        const meta = page.locator('.epm-project-board-meta');
        const updateRow = page.locator('.epm-project-board-update-row');
        const update = page.locator('.epm-project-board-update').first();
        const updateDate = page.locator('.epm-project-board-update-date');

        await expect(header).toBeVisible();
        await expect(toggle.locator('a')).toHaveCount(0);
        await expect(toggle.locator('.epm-project-board-update')).toHaveCount(0);

        const headerBox = await header.boundingBox();
        const bodyBox = await body.boundingBox();
        const toggleBox = await toggle.boundingBox();
        const metaBox = await meta.boundingBox();
        const updateRowBox = await updateRow.boundingBox();
        const updateBox = await update.boundingBox();
        const updateDateBox = await updateDate.boundingBox();

        expect(headerBox).toBeTruthy();
        expect(bodyBox).toBeTruthy();
        expect(toggleBox).toBeTruthy();
        expect(metaBox).toBeTruthy();
        expect(updateRowBox).toBeTruthy();
        expect(updateBox).toBeTruthy();
        expect(updateDateBox).toBeTruthy();

        expect(boxesOverlap(toggleBox, metaBox)).toBe(false);
        expect(bodyBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 0.5);
        expect(updateRowBox.x + updateRowBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 0.5);
        expect(updateDateBox.x).toBeGreaterThan(updateBox.x + updateBox.width - 0.5);
        await expect(update.locator('strong')).toHaveText('RFP AI bot');
        await expect(update.locator('em')).toHaveText('deals AI');
        await expect(update.locator('a')).toHaveAttribute('href', 'https://example.test/client-testing');

        const updateStyle = await update.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                borderRadius: style.borderRadius,
                backgroundColor: style.backgroundColor,
                color: style.color,
                width: style.width,
                maxWidth: style.maxWidth,
            };
        });
        expect(updateStyle.borderRadius).toBe('8px');
        expect(updateStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(updateStyle.color).not.toBe('rgb(255, 255, 255)');

        await toggle.hover();
        await page.waitForTimeout(180);
        const hoverStyle = await toggle.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                backgroundColor: style.backgroundColor,
                transform: style.transform,
            };
        });
        expect(hoverStyle.backgroundColor).not.toBe('rgb(47, 47, 47)');
        expect(hoverStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(hoverStyle.transform).toBe('none');

        await page.screenshot({ path: `/tmp/epm-portfolio-header-qa/${viewport.name}.png`, fullPage: true });
    });
}
