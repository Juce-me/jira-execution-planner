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
                                <span class="epm-project-board-update">2026-04-29 · [on track] RFP AI bot and related deals AI work are progressing - build ready for client testing, rollout model defined.</span>
                            </div>
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
        const update = page.locator('.epm-project-board-update');

        await expect(header).toBeVisible();
        await expect(toggle.locator('a')).toHaveCount(0);
        await expect(toggle.locator('.epm-project-board-update')).toHaveCount(0);

        const headerBox = await header.boundingBox();
        const bodyBox = await body.boundingBox();
        const toggleBox = await toggle.boundingBox();
        const metaBox = await meta.boundingBox();
        const updateBox = await update.boundingBox();

        expect(headerBox).toBeTruthy();
        expect(bodyBox).toBeTruthy();
        expect(toggleBox).toBeTruthy();
        expect(metaBox).toBeTruthy();
        expect(updateBox).toBeTruthy();

        expect(boxesOverlap(toggleBox, metaBox)).toBe(false);
        expect(bodyBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 0.5);
        expect(updateBox.x + updateBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 0.5);

        await page.screenshot({ path: `/tmp/epm-portfolio-header-qa/${viewport.name}.png`, fullPage: true });
    });
}
