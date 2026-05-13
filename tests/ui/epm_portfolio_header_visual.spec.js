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
                        <div class="epm-project-board-header">
                            <div class="epm-project-board-title-block">
                                <div class="epm-project-board-title-row">
                                    <span class="epm-project-board-home-icon" aria-hidden="true">🤖</span>
                                    <h3 class="epm-project-board-name">
                                        <a class="epm-project-board-name-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-324">AI for RFP creation</a>
                                    </h3>
                                    <span class="status-pill task-status epm-project-board-status-pill on-track">On track</span>
                                    <span class="epm-project-board-label-pill">RnD_Project_RFP_AI</span>
                                </div>
                                <div class="epm-project-board-meta" aria-label="Project metadata">
                                    <span class="epm-project-board-target-date" title="Target date: Apr-Jun">
                                        <span class="epm-project-board-target-date-icon" aria-hidden="true">
                                            <svg viewBox="0 0 16 16">
                                                <path d="M4.5 1.75v2.5M11.5 1.75v2.5M2.75 6.25h10.5M3.5 3.25h9a1.5 1.5 0 0 1 1.5 1.5v7.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4.75a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
                                            </svg>
                                        </span>
                                        Apr-Jun
                                    </span>
                                    <span class="epm-project-board-owner" title="Owner: Ada Lovelace">
                                        <span class="epm-project-board-owner-avatar" aria-hidden="true">AL</span>
                                        <span class="epm-project-board-owner-name">Ada Lovelace</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row">
                            <article class="epm-project-board-update" aria-label="Latest Home update">
                                <div class="epm-project-board-update-meta">
                                    <span class="epm-project-board-update-date">yesterday</span>
                                    <span class="epm-project-board-update-author">Ada Lovelace</span>
                                </div>
                                <div class="epm-project-board-update-copy">
                                    <p><strong>RFP AI bot</strong> and related <em>deals AI</em> work are progressing.</p>
                                    <p>Build is ready for <a href="https://example.test/client-testing">client testing</a>; rollout model defined.</p>
                                </div>
                            </article>
                        </div>
                        <div class="epm-project-board-rollup-control">
                            <button type="button" class="epm-project-board-toggle" aria-expanded="true" aria-label="Hide Jira rollup for AI for RFP creation">
                                <span class="epm-project-board-chevron">
                                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                                        <path d="M5.5 3.75L9.75 8l-4.25 4.25" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
                                    </svg>
                                </span>
                                <span class="epm-project-board-toggle-label">Jira rollup</span>
                            </button>
                        </div>
                        <div class="epm-project-board-body">
                            <div class="epic-card">
                                <div class="epic-title">AI for RFP creation <span class="issue-key">PRODUCT-29920</span></div>
                            </div>
                        </div>
                    </section>
                    <section class="epm-project-board">
                        <div class="epm-project-board-header">
                            <div class="epm-project-board-title-block">
                                <div class="epm-project-board-title-row">
                                    <span class="epm-project-board-home-icon" aria-hidden="true">🛒</span>
                                    <h3 class="epm-project-board-name">
                                        <a class="epm-project-board-name-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-325">Data Partnership: Support Revenue Share Fee Model</a>
                                    </h3>
                                    <span class="status-pill task-status epm-project-board-status-pill on-track">On track</span>
                                    <span class="epm-project-board-label-pill">rnd_project_bsw_enriched_deals_revenue_share_fee_model_long_label</span>
                                </div>
                                <div class="epm-project-board-meta" aria-label="Project metadata">
                                    <span class="epm-project-board-target-date" title="Target date: April">
                                        <span class="epm-project-board-target-date-icon" aria-hidden="true">
                                            <svg viewBox="0 0 16 16">
                                                <path d="M4.5 1.75v2.5M11.5 1.75v2.5M2.75 6.25h10.5M3.5 3.25h9a1.5 1.5 0 0 1 1.5 1.5v7.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4.75a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
                                            </svg>
                                        </span>
                                        April
                                    </span>
                                    <span class="epm-project-board-owner" title="Owner: Grace Hopper">
                                        <span class="epm-project-board-owner-avatar" aria-hidden="true">GH</span>
                                        <span class="epm-project-board-owner-name">Grace Hopper</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row">
                            <article class="epm-project-board-update" aria-label="Latest Home update">
                                <div class="epm-project-board-update-meta">
                                    <span class="epm-project-board-update-date">1 week ago</span>
                                    <span class="epm-project-board-update-author">Grace Hopper</span>
                                </div>
                                <div class="epm-project-board-update-copy">
                                    <ul>
                                        <li><strong>[release]</strong> Finance Gateway shipped support for the revenue-share fee model.</li>
                                        <li><strong>[at risk]</strong> Broad rollout remains blocked on duplication and yes-bid handling.</li>
                                    </ul>
                                </div>
                            </article>
                        </div>
                        <div class="epm-project-board-rollup-control">
                            <button type="button" class="epm-project-board-toggle" aria-expanded="true" aria-label="Hide Jira rollup for Data Partnership: Support Revenue Share Fee Model">
                                <span class="epm-project-board-chevron">
                                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                                        <path d="M5.5 3.75L9.75 8l-4.25 4.25" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
                                    </svg>
                                </span>
                                <span class="epm-project-board-toggle-label">Jira rollup</span>
                            </button>
                        </div>
                        <div class="epm-project-board-body">
                            <div class="epic-card">
                                <div class="epic-title">Revenue share rollout <span class="issue-key">PRODUCT-29921</span></div>
                            </div>
                        </div>
                    </section>
                    <section class="epm-project-board is-collapsed">
                        <div class="epm-project-board-header">
                            <div class="epm-project-board-title-block">
                                <div class="epm-project-board-title-row">
                                    <span class="epm-project-board-home-icon" aria-hidden="true">💵</span>
                                    <h3 class="epm-project-board-name">
                                        <a class="epm-project-board-name-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-326">Dynamic Floor Harness With Pricing Analysis Rollout Controls</a>
                                    </h3>
                                    <span class="status-pill task-status epm-project-board-status-pill on-track">On track</span>
                                    <span class="epm-project-board-label-pill">rnd_project_dynamic_floor_harness</span>
                                </div>
                                <div class="epm-project-board-meta" aria-label="Project metadata">
                                    <span class="epm-project-board-target-date" title="Target date: Apr-Jun">
                                        <span class="epm-project-board-target-date-icon" aria-hidden="true">
                                            <svg viewBox="0 0 16 16">
                                                <path d="M4.5 1.75v2.5M11.5 1.75v2.5M2.75 6.25h10.5M3.5 3.25h9a1.5 1.5 0 0 1 1.5 1.5v7.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4.75a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
                                            </svg>
                                        </span>
                                        Apr-Jun
                                    </span>
                                    <span class="epm-project-board-owner" title="Owner: Katherine Johnson">
                                        <span class="epm-project-board-owner-avatar" aria-hidden="true">KJ</span>
                                        <span class="epm-project-board-owner-name">Katherine Johnson</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row">
                            <article class="epm-project-board-update" aria-label="Latest Home update">
                                <div class="epm-project-board-update-meta">
                                    <span class="epm-project-board-update-date">today</span>
                                    <span class="epm-project-board-update-author">Katherine Johnson</span>
                                </div>
                                <span class="epm-project-board-update-copy">Rollout beyond 5% traffic is gated on coefficient work and clearer separation of profitable pairs.</span>
                            </article>
                        </div>
                        <div class="epm-project-board-rollup-control">
                            <button type="button" class="epm-project-board-toggle" aria-expanded="false" aria-label="Show Jira rollup for Dynamic Floor Harness With Pricing Analysis Rollout Controls">
                                <span class="epm-project-board-chevron">
                                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                                        <path d="M5.5 3.75L9.75 8l-4.25 4.25" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
                                    </svg>
                                </span>
                                <span class="epm-project-board-toggle-label">Jira rollup</span>
                            </button>
                        </div>
                        <div class="epm-project-board-body">
                            <div class="epic-card">
                                <div class="epic-title">Floor harness rollout <span class="issue-key">PRODUCT-29922</span></div>
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
    { name: 'medium', width: 960, height: 760 },
    { name: 'narrow', width: 520, height: 720 },
]) {
    test(`EPM portfolio header metadata does not overlap project name on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loadHeaderFixture(page);

        const board = page.locator('.epm-project-board').first();
        const header = board.locator('.epm-project-board-header');
        const body = board.locator('.epm-project-board-body');
        const toggle = board.locator('.epm-project-board-toggle');
        const chevron = board.locator('.epm-project-board-chevron');
        const meta = board.locator('.epm-project-board-meta');
        const homeIcon = board.locator('.epm-project-board-home-icon');
        const title = board.locator('.epm-project-board-name');
        const nameLink = board.locator('.epm-project-board-name-link');
        const statusPill = board.locator('.epm-project-board-status-pill');
        const labelPill = board.locator('.epm-project-board-label-pill');
        const targetDate = board.locator('.epm-project-board-target-date');
        const owner = board.locator('.epm-project-board-owner');
        const ownerAvatar = board.locator('.epm-project-board-owner-avatar');
        const rollupControl = board.locator('.epm-project-board-rollup-control');
        const updateRow = board.locator('.epm-project-board-update-row');
        const update = board.locator('.epm-project-board-update').first();
        const updateMeta = board.locator('.epm-project-board-update-meta').first();
        const updateDate = board.locator('.epm-project-board-update-date').first();
        const updateAuthor = board.locator('.epm-project-board-update-author').first();
        const collapsedBoard = page.locator('.epm-project-board.is-collapsed');
        const collapsedUpdate = collapsedBoard.locator('.epm-project-board-update');
        const collapsedCopy = collapsedBoard.locator('.epm-project-board-update-copy');
        const collapsedBody = collapsedBoard.locator('.epm-project-board-body');

        await expect(header).toBeVisible();
        await expect(page.locator('.epm-project-board')).toHaveCount(3);
        await expect(collapsedBoard).toHaveCount(1);
        await expect(collapsedBoard.locator('.epm-project-board-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expect(header.locator('.epm-project-board-toggle')).toHaveCount(0);
        await expect(toggle).toHaveText('Jira rollup');
        await expect(toggle.locator('a')).toHaveCount(0);
        await expect(toggle.locator('.epm-project-board-update')).toHaveCount(0);
        await expect(toggle.locator('.epm-project-board-name')).toHaveCount(0);
        await expect(nameLink).toHaveAttribute('href', 'https://home.atlassian.com/o/example/s/example/project/CRITE-324');
        await expect(homeIcon).toHaveText('🤖');
        await expect(statusPill).toHaveText('On track');
        await expect(labelPill).toHaveText('RnD_Project_RFP_AI');
        await expect(statusPill).toHaveClass(/task-status/);
        await expect(targetDate).toContainText('Apr-Jun');
        await expect(ownerAvatar).toHaveText('AL');

        const headerBox = await header.boundingBox();
        const bodyBox = await body.boundingBox();
        const toggleBox = await toggle.boundingBox();
        const chevronBox = await chevron.boundingBox();
        const metaBox = await meta.boundingBox();
        const homeIconBox = await homeIcon.boundingBox();
        const titleBox = await title.boundingBox();
        const statusBox = await statusPill.boundingBox();
        const labelBox = await labelPill.boundingBox();
        const targetDateBox = await targetDate.boundingBox();
        const ownerBox = await owner.boundingBox();
        const ownerAvatarBox = await ownerAvatar.boundingBox();
        const rollupControlBox = await rollupControl.boundingBox();
        const updateRowBox = await updateRow.boundingBox();
        const updateBox = await update.boundingBox();
        const updateMetaBox = await updateMeta.boundingBox();
        const updateDateBox = await updateDate.boundingBox();
        const updateAuthorBox = await updateAuthor.boundingBox();
        const collapsedBoardBox = await collapsedBoard.boundingBox();
        const collapsedUpdateBox = await collapsedUpdate.boundingBox();

        expect(headerBox).toBeTruthy();
        expect(bodyBox).toBeTruthy();
        expect(toggleBox).toBeTruthy();
        expect(chevronBox).toBeTruthy();
        expect(metaBox).toBeTruthy();
        expect(homeIconBox).toBeTruthy();
        expect(titleBox).toBeTruthy();
        expect(statusBox).toBeTruthy();
        expect(labelBox).toBeTruthy();
        expect(targetDateBox).toBeTruthy();
        expect(ownerBox).toBeTruthy();
        expect(ownerAvatarBox).toBeTruthy();
        expect(rollupControlBox).toBeTruthy();
        expect(updateRowBox).toBeTruthy();
        expect(updateBox).toBeTruthy();
        expect(updateMetaBox).toBeTruthy();
        expect(updateDateBox).toBeTruthy();
        expect(updateAuthorBox).toBeTruthy();
        expect(collapsedBoardBox).toBeTruthy();
        expect(collapsedUpdateBox).toBeTruthy();

        expect(boxesOverlap(toggleBox, metaBox)).toBe(false);
        expect(boxesOverlap(titleBox, metaBox)).toBe(false);
        expect(homeIconBox.x + homeIconBox.width).toBeLessThanOrEqual(titleBox.x);
        expect(Math.abs((statusBox.y + statusBox.height / 2) - (titleBox.y + titleBox.height / 2))).toBeLessThanOrEqual(6);
        if (viewport.width >= 900) {
            expect(statusBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
            expect(labelBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
        } else {
            expect(boxesOverlap(labelBox, titleBox)).toBe(false);
        }
        expect(metaBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 0.5);
        expect(boxesOverlap(ownerBox, targetDateBox)).toBe(false);
        if (ownerBox.x > targetDateBox.x) {
            expect(ownerBox.x).toBeGreaterThan(targetDateBox.x + targetDateBox.width);
        } else {
            expect(ownerBox.y).toBeGreaterThanOrEqual(targetDateBox.y);
        }
        expect(ownerAvatarBox.width).toBeGreaterThanOrEqual(18);
        expect(updateBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
        expect(toggleBox.y).toBeGreaterThan(updateBox.y + updateBox.height);
        expect(bodyBox.y).toBeGreaterThanOrEqual(rollupControlBox.y + rollupControlBox.height - 0.5);
        expect(updateRowBox.x + updateRowBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 0.5);
        expect(updateAuthorBox.x).toBeGreaterThan(updateDateBox.x + updateDateBox.width);
        await expect(update.locator('strong')).toHaveText('RFP AI bot');
        await expect(update.locator('em')).toHaveText('deals AI');
        await expect(update.locator('a')).toHaveAttribute('href', 'https://example.test/client-testing');
        await expect(page.locator('.epm-project-board-update-copy li')).toHaveCount(2);
        await expect(collapsedUpdate.locator('li')).toHaveCount(0);
        await expect(collapsedCopy).toContainText('profitable pairs');

        const titleStyle = await title.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                fontFamily: style.fontFamily,
                letterSpacing: style.letterSpacing,
                textTransform: style.textTransform,
                whiteSpace: style.whiteSpace,
            };
        });
        expect(titleStyle.textTransform).toBe('none');
        expect(['0px', 'normal']).toContain(titleStyle.letterSpacing);
        expect(titleStyle.fontFamily).not.toContain('IBM Plex Mono');
        expect(titleStyle.whiteSpace).not.toBe('nowrap');

        const updateStyle = await update.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
                borderRadius: style.borderRadius,
                boxShadow: style.boxShadow,
                borderTopStyle: style.borderTopStyle,
                color: style.color,
                fontSizePx: Number.parseFloat(style.fontSize),
                maxWidthValue: style.maxWidth,
                maxWidthPx: Number.parseFloat(style.maxWidth),
            };
        });
        expect(updateStyle.boxShadow).toBe('none');
        expect(updateStyle.borderTopStyle).toBe('solid');
        expect(updateStyle.backgroundColor).toBe('rgb(251, 252, 254)');
        expect(updateStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(updateStyle.borderRadius).toBe('8px');
        expect(updateStyle.color).not.toBe('rgb(255, 255, 255)');
        expect(updateStyle.maxWidthValue).not.toBe('none');
        expect(Number.isFinite(updateStyle.maxWidthPx)).toBe(true);
        expect(updateStyle.maxWidthPx).toBeLessThanOrEqual(760);
        expect(updateStyle.fontSizePx).toBeGreaterThanOrEqual(14);
        expect(updateBox.width).toBeLessThanOrEqual(760);

        const updateMetaStyle = await updateMeta.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                position: style.position,
                backgroundColor: style.backgroundColor,
            };
        });
        expect(updateMetaStyle.position).toBe('static');
        expect(updateMetaStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');

        const authorSeparator = await updateAuthor.evaluate((node) => (
            window.getComputedStyle(node, '::before').content
        ));
        expect(authorSeparator).toBe('"·"');

        const boardBox = await board.boundingBox();
        expect(boardBox).toBeTruthy();
        const boardStyle = await board.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
                borderRadius: style.borderRadius,
            };
        });
        expect(boardStyle.backgroundColor).toBe('rgb(255, 255, 255)');
        expect(boardStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(boardStyle.borderRadius).toBe('8px');

        const toggleStyle = await toggle.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                borderRadius: style.borderRadius,
            };
        });
        expect(toggleStyle.borderRadius).toBe('8px');

        const railStyle = await body.evaluate((node) => {
            const style = window.getComputedStyle(node, '::before');
            return {
                content: style.content,
                left: Number.parseFloat(style.left),
                top: Number.parseFloat(style.top),
                width: Number.parseFloat(style.width),
            };
        });
        const railCenterX = bodyBox.x + railStyle.left + (railStyle.width / 2);
        const chevronCenterX = chevronBox.x + (chevronBox.width / 2);
        const railStartY = bodyBox.y + railStyle.top;
        expect(railStyle.content).not.toBe('none');
        expect(Math.abs(railCenterX - chevronCenterX)).toBeGreaterThanOrEqual(8);
        expect(railStartY).toBeGreaterThan(toggleBox.y + toggleBox.height + 8);

        const collapsedBodyDisplay = await collapsedBody.evaluate((node) => (
            window.getComputedStyle(node).display
        ));
        const collapsedCopyStyle = await collapsedCopy.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                overflow: style.overflow,
                textOverflow: style.textOverflow,
                whiteSpace: style.whiteSpace,
            };
        });
        const collapsedUpdateFit = await collapsedUpdate.evaluate((node) => ({
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
        }));
        expect(collapsedBodyDisplay).toBe('none');
        expect(collapsedCopyStyle.overflow).toBe('visible');
        expect(collapsedCopyStyle.textOverflow).toBe('clip');
        expect(collapsedCopyStyle.whiteSpace).toBe('normal');
        expect(collapsedUpdateFit.scrollHeight).toBeLessThanOrEqual(collapsedUpdateFit.clientHeight + 1);
        expect(collapsedBoardBox.height).toBeLessThan(boardBox.height);

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
