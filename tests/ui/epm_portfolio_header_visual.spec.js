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
                                    <div class="epm-project-board-title-meta" aria-label="Project status and owner">
                                        <span class="status-pill task-status epic-status-pill done">On track</span>
                                        <span class="epm-project-board-owner" title="Owner: Ada Lovelace">
                                            <span class="epm-project-board-owner-avatar" aria-hidden="true">AL</span>
                                            <span class="epm-project-board-owner-name">Ada Lovelace</span>
                                        </span>
                                        <span class="epic-key" title="RnD_Project_RFP_AI">RnD_Project_RFP_AI</span>
                                    </div>
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
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row">
                            <article class="epm-project-board-update" aria-label="Latest Home update">
                                <a class="epm-project-board-update-meta epm-project-board-update-meta-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-324/updates/update-1">
                                    <span class="epm-project-board-update-date">yesterday</span>
                                    <span class="epm-project-board-update-author">Ada Lovelace</span>
                                </a>
                                <div class="epm-project-board-update-copy">
                                    <p><strong>RFP AI bot</strong> and related <em>deals AI</em> work are progressing.</p>
                                    <p>Build is ready for <a href="https://example.test/client-testing">client testing</a>; rollout model defined.</p>
                                </div>
                                <a class="epm-project-board-update-more" href="https://home.atlassian.com/o/example/s/example/project/CRITE-324/updates/update-1">More details</a>
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
                                    <div class="epm-project-board-title-meta" aria-label="Project status and owner">
                                        <span class="status-pill task-status epic-status-pill done">On track</span>
                                        <span class="epm-project-board-owner" title="Owner: Grace Hopper">
                                            <span class="epm-project-board-owner-avatar" aria-hidden="true">GH</span>
                                            <span class="epm-project-board-owner-name">Grace Hopper</span>
                                        </span>
                                        <span class="epic-key" title="rnd_project_bsw_enriched_deals_revenue_share_fee_model_long_label">rnd_project_bsw_enriched_deals_revenue_share_fee_model_long_label</span>
                                    </div>
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
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row is-stale">
                            <article class="epm-project-board-update is-stale" aria-label="Latest Home update">
                                <a class="epm-project-board-update-meta epm-project-board-update-meta-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-325/updates/update-2">
                                    <span class="epm-project-board-update-date">3 weeks ago</span>
                                    <span class="epm-project-board-update-author">Grace Hopper</span>
                                    <span class="epm-project-board-update-freshness is-stale">Stale update</span>
                                </a>
                                <div class="epm-project-board-update-copy">
                                    <ul>
                                        <li><strong>[release]</strong> Finance Gateway shipped support for the revenue-share fee model.</li>
                                        <li><strong>[at risk]</strong> Broad rollout remains blocked on duplication and yes-bid handling.</li>
                                    </ul>
                                </div>
                                <a class="epm-project-board-update-more" href="https://home.atlassian.com/o/example/s/example/project/CRITE-325/updates/update-2">More details</a>
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
                                    <div class="epm-project-board-title-meta" aria-label="Project status and owner">
                                        <span class="status-pill task-status epic-status-pill done">On track</span>
                                        <span class="epm-project-board-owner" title="Owner: Katherine Johnson">
                                            <span class="epm-project-board-owner-avatar" aria-hidden="true">KJ</span>
                                            <span class="epm-project-board-owner-name">Katherine Johnson</span>
                                        </span>
                                        <span class="epic-key" title="rnd_project_dynamic_floor_harness">rnd_project_dynamic_floor_harness</span>
                                    </div>
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
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row">
                            <article class="epm-project-board-update" aria-label="Latest Home update">
                                <a class="epm-project-board-update-meta epm-project-board-update-meta-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-326/updates/update-3">
                                    <span class="epm-project-board-update-date">today</span>
                                    <span class="epm-project-board-update-author">Katherine Johnson</span>
                                </a>
                                <span class="epm-project-board-update-copy">Rollout beyond 5% traffic is gated on coefficient work and clearer separation of profitable pairs.</span>
                                <a class="epm-project-board-update-more" href="https://home.atlassian.com/o/example/s/example/project/CRITE-326/updates/update-3">More details</a>
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
                    <section class="epm-project-board is-collapsed">
                        <div class="epm-project-board-header">
                            <div class="epm-project-board-title-block">
                                <div class="epm-project-board-title-row">
                                    <span class="epm-project-board-home-icon" aria-hidden="true">📊</span>
                                    <h3 class="epm-project-board-name">
                                        <a class="epm-project-board-name-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-327">Signal Quality Guardrail Pilot</a>
                                    </h3>
                                    <div class="epm-project-board-title-meta" aria-label="Project status and owner">
                                        <span class="status-pill task-status epic-status-pill postponed">At risk</span>
                                        <span class="epm-project-board-owner" title="Owner: Dorothy Vaughan">
                                            <span class="epm-project-board-owner-avatar" aria-hidden="true">DV</span>
                                            <span class="epm-project-board-owner-name">Dorothy Vaughan</span>
                                        </span>
                                        <span class="epic-key" title="rnd_project_signal_quality_guardrail">rnd_project_signal_quality_guardrail</span>
                                    </div>
                                </div>
                                <div class="epm-project-board-meta" aria-label="Project metadata">
                                    <span class="epm-project-board-target-date" title="Target date: May">
                                        <span class="epm-project-board-target-date-icon" aria-hidden="true">
                                            <svg viewBox="0 0 16 16">
                                                <path d="M4.5 1.75v2.5M11.5 1.75v2.5M2.75 6.25h10.5M3.5 3.25h9a1.5 1.5 0 0 1 1.5 1.5v7.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4.75a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
                                            </svg>
                                        </span>
                                        May
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="epm-project-board-update-row is-missing">
                            <article class="epm-project-board-update is-missing" aria-label="Home update status">
                                <div class="epm-project-board-update-meta">
                                    <span class="epm-project-board-update-freshness is-missing">No Home update</span>
                                </div>
                                <span class="epm-project-board-update-copy">Status is on track.</span>
                            </article>
                        </div>
                        <div class="epm-project-board-rollup-control">
                            <button type="button" class="epm-project-board-toggle" aria-expanded="false" aria-label="Show Jira rollup for Signal Quality Guardrail Pilot">
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
                                <div class="epic-title">Signal quality pilot <span class="issue-key">PRODUCT-29923</span></div>
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
        const titleMeta = board.locator('.epm-project-board-title-meta');
        const homeIcon = board.locator('.epm-project-board-home-icon');
        const title = board.locator('.epm-project-board-name');
        const nameLink = board.locator('.epm-project-board-name-link');
        const statusPill = board.locator('.epm-project-board-title-meta .status-pill');
        const labelPill = board.locator('.epm-project-board-title-meta .epic-key');
        const targetDate = board.locator('.epm-project-board-target-date');
        const owner = board.locator('.epm-project-board-owner');
        const ownerAvatar = board.locator('.epm-project-board-owner-avatar');
        const rollupControl = board.locator('.epm-project-board-rollup-control');
        const updateRow = board.locator('.epm-project-board-update-row');
        const update = board.locator('.epm-project-board-update').first();
        const updateMeta = board.locator('.epm-project-board-update-meta').first();
        const updateMetaLink = board.locator('.epm-project-board-update-meta-link').first();
        const updateDate = board.locator('.epm-project-board-update-date').first();
        const updateAuthor = board.locator('.epm-project-board-update-author').first();
        const updateCopyLink = board.locator('.epm-project-board-update-copy a').first();
        const updateMoreLink = board.locator('.epm-project-board-update-more').first();
        const collapsedBoard = page.locator('.epm-project-board.is-collapsed');
        const longCollapsedBoard = collapsedBoard.filter({ hasText: 'Dynamic Floor Harness With Pricing Analysis Rollout Controls' });
        const missingCollapsedBoard = collapsedBoard.filter({ hasText: 'Signal Quality Guardrail Pilot' });
        const collapsedUpdate = longCollapsedBoard.locator('.epm-project-board-update');
        const collapsedCopy = longCollapsedBoard.locator('.epm-project-board-update-copy');
        const collapsedBody = longCollapsedBoard.locator('.epm-project-board-body');

        await expect(header).toBeVisible();
        await expect(page.locator('.epm-project-board')).toHaveCount(4);
        await expect(collapsedBoard).toHaveCount(2);
        await expect(longCollapsedBoard.locator('.epm-project-board-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expect(missingCollapsedBoard.locator('.epm-project-board-toggle')).toHaveAttribute('aria-expanded', 'false');
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
        const titleMetaBox = await titleMeta.boundingBox();
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
        const collapsedBoardBox = await longCollapsedBoard.boundingBox();
        const collapsedUpdateBox = await collapsedUpdate.boundingBox();

        expect(headerBox).toBeTruthy();
        expect(bodyBox).toBeTruthy();
        expect(toggleBox).toBeTruthy();
        expect(chevronBox).toBeTruthy();
        expect(metaBox).toBeTruthy();
        expect(titleMetaBox).toBeTruthy();
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
        expect(boxesOverlap(statusBox, ownerBox)).toBe(false);
        expect(Math.abs((ownerBox.y + ownerBox.height / 2) - (statusBox.y + statusBox.height / 2))).toBeLessThanOrEqual(6);
        if (viewport.width >= 900) {
            expect(Math.abs((statusBox.y + statusBox.height / 2) - (titleBox.y + titleBox.height / 2))).toBeLessThanOrEqual(6);
            expect(statusBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
            expect(ownerBox.x).toBeGreaterThan(statusBox.x + statusBox.width);
            expect(labelBox.x).toBeGreaterThan(ownerBox.x + ownerBox.width);
            expect(labelBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
        } else {
            expect(titleMetaBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 0.5);
            expect(boxesOverlap(statusBox, titleBox)).toBe(false);
            expect(boxesOverlap(ownerBox, titleBox)).toBe(false);
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
        await expect(updateMetaLink).toHaveAttribute('href', 'https://home.atlassian.com/o/example/s/example/project/CRITE-324/updates/update-1');
        await expect(updateCopyLink).toHaveAttribute('href', 'https://example.test/client-testing');
        await expect(updateMoreLink).toHaveText('More details');
        await expect(updateMoreLink).toHaveAttribute('href', 'https://home.atlassian.com/o/example/s/example/project/CRITE-324/updates/update-1');
        await expect(page.locator('.epm-project-board-update-copy li')).toHaveCount(2);
        await expect(collapsedUpdate.locator('li')).toHaveCount(0);
        await expect(collapsedCopy).toContainText('profitable pairs');
        await expect(collapsedUpdate.locator('.epm-project-board-update-date')).toHaveText('today');
        await expect(collapsedUpdate.locator('.epm-project-board-update-author')).toHaveText('Katherine Johnson');
        await expect(collapsedUpdate.locator('.epm-project-board-update-more')).toHaveAttribute('href', 'https://home.atlassian.com/o/example/s/example/project/CRITE-326/updates/update-3');

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

        const staleUpdate = page.locator('.epm-project-board-update.is-stale');
        const staleFreshness = staleUpdate.locator('.epm-project-board-update-freshness');
        await expect(staleFreshness).toHaveText('Stale update');
        const staleDateColor = await staleUpdate.locator('.epm-project-board-update-date').evaluate((node) => (
            window.getComputedStyle(node).color
        ));
        const staleAuthorColor = await staleUpdate.locator('.epm-project-board-update-author').evaluate((node) => (
            window.getComputedStyle(node).color
        ));
        const staleCopyColor = await staleUpdate.locator('.epm-project-board-update-copy').evaluate((node) => (
            window.getComputedStyle(node).color
        ));
        const staleBadgeStyle = await staleFreshness.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                color: style.color,
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
            };
        });
        expect(staleDateColor).toBe('rgb(185, 28, 28)');
        expect(staleAuthorColor).not.toBe('rgb(185, 28, 28)');
        expect(staleCopyColor).not.toBe('rgb(185, 28, 28)');
        expect(staleBadgeStyle.color).not.toBe('rgb(185, 28, 28)');
        expect(staleBadgeStyle.backgroundColor).not.toBe('rgb(254, 242, 242)');
        expect(staleBadgeStyle.borderColor).not.toBe('rgb(254, 202, 202)');

        const missingUpdate = missingCollapsedBoard.locator('.epm-project-board-update.is-missing');
        await expect(missingUpdate).toHaveAttribute('aria-label', 'Home update status');
        const missingFreshness = missingUpdate.locator('.epm-project-board-update-freshness');
        await expect(missingFreshness).toHaveText('No Home update');
        const missingBadgeStyle = await missingFreshness.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                color: style.color,
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
            };
        });
        const missingCopyColor = await missingUpdate.locator('.epm-project-board-update-copy').evaluate((node) => (
            window.getComputedStyle(node).color
        ));
        expect(missingBadgeStyle.color).not.toBe('rgb(185, 28, 28)');
        expect(missingBadgeStyle.backgroundColor).not.toBe('rgb(254, 242, 242)');
        expect(missingBadgeStyle.borderColor).not.toBe('rgb(254, 202, 202)');
        expect(missingCopyColor).not.toBe('rgb(185, 28, 28)');

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

        const restingBackground = await toggle.evaluate(node => getComputedStyle(node).backgroundColor);
        await toggle.hover();
        await page.waitForTimeout(450);
        const hoverStyle = await toggle.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return {
                backgroundColor: style.backgroundColor,
                transform: style.transform,
                shadow: style.boxShadow,
            };
        });
        expect(hoverStyle.backgroundColor).toBe(restingBackground);
        expect(hoverStyle.shadow).toContain('999px');
        expect(hoverStyle.shadow).toContain('rgb(47, 128, 237)');
        expect(hoverStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(hoverStyle.transform).toBe('none');

        await page.screenshot({ path: `/tmp/epm-portfolio-header-qa/${viewport.name}.png`, fullPage: true });
    });
}

test('a wide ADF table in an EPM Home update scrolls locally without widening the page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadHeaderFixture(page);

    const board = page.locator('.epm-project-board').first();
    const update = board.locator('.epm-project-board-update');
    const copy = update.locator('.epm-project-board-update-copy');
    await copy.evaluate((node) => {
        node.innerHTML = `
            <h3>Delivery milestones</h3>
            <div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">
                <table><tbody>
                    <tr><th scope="col">Milestone</th><th scope="col">Owner</th><th scope="col">Dependency</th><th scope="col">Outcome</th></tr>
                    <tr><td>Private beta</td><td>Platform</td><td>DeterministicGatewayCompatibilityBoundary</td><td>Ready for a synthetic narrow-screen review</td></tr>
                </tbody></table>
            </div>`;
    });

    const heading = copy.getByRole('heading', { name: 'Delivery milestones', level: 3 });
    const scroller = copy.locator('.adf-table-scroll');
    await expect(heading).toBeVisible();
    await expect(copy.getByRole('table')).toBeVisible();
    await expect(copy.getByRole('columnheader', { name: 'Dependency' })).toBeVisible();
    const geometry = await scroller.evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
    }));
    expect(geometry.overflowX).toBe('auto');
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth + 1);

    await scroller.focus();
    await expect(scroller).toBeFocused();
    await scroller.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    expect(await scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

    const containment = await page.evaluate(() => {
        const overflow = (selector) => {
            const node = document.querySelector(selector);
            return node.scrollWidth - node.clientWidth;
        };
        return {
            document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            board: overflow('.epm-project-board'),
            update: overflow('.epm-project-board-update'),
            copy: overflow('.epm-project-board-update-copy'),
        };
    });
    Object.entries(containment).forEach(([surface, overflow]) => {
        expect(overflow, `${surface} owns no table overflow`).toBeLessThanOrEqual(1);
    });

    const headingStyle = await heading.evaluate((node) => ({
        textTransform: getComputedStyle(node).textTransform,
        fontSize: parseFloat(getComputedStyle(node).fontSize),
    }));
    expect(headingStyle.textTransform).toBe('none');
    expect(headingStyle.fontSize).toBeGreaterThanOrEqual(14);
    await page.screenshot({ path: '/tmp/epm-portfolio-header-qa/update-table-narrow.png', fullPage: true });
});

const LONG_LABEL = 'rnd_project_' + 'x'.repeat(48);
const STATUS_CASES = [
    { semantic: 'done', text: 'On track', background: 'rgb(82, 196, 26)' },
    { semantic: 'postponed', text: 'At risk', background: 'rgb(250, 140, 22)' },
    { semantic: 'blocked', text: 'Off track', background: 'rgb(255, 77, 79)' },
    { semantic: 'waiting', text: 'Pending', background: 'rgb(140, 140, 140)' },
];

async function loadTokenFixture(page) {
    const boards = STATUS_CASES.map((item, index) => `
        <section class="epm-project-board">
            <div class="epm-project-board-header">
                <div class="epm-project-board-title-block">
                    <div class="epm-project-board-title-row">
                        <h3 class="epm-project-board-name"><a class="epm-project-board-name-link" href="https://example.test/${index}">Synthetic project ${index}</a></h3>
                        <div class="epm-project-board-title-meta" aria-label="Project status and owner">
                            <span class="status-pill task-status epic-status-pill ${item.semantic}">${item.text}</span>
                            <span class="epm-project-board-owner" title="Owner: Ada Lovelace">
                                <span class="epm-project-board-owner-avatar" aria-hidden="true">AL</span>
                                <span class="epm-project-board-owner-name">Ada Lovelace</span>
                            </span>
                            <span class="epic-key" title="${index === 0 ? LONG_LABEL : 'rnd_project_short'}">${index === 0 ? LONG_LABEL : 'rnd_project_short'}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="epm-project-board-rollup-control">
                <div class="epm-project-progress is-in-progress" role="img" tabindex="0" aria-label="Project progress">
                    <span class="epm-project-progress-track" aria-hidden="true"></span>
                    <span class="epm-project-progress-percent">40%</span>
                    <span class="status-pill task-status in-progress epm-project-progress-status">In Progress</span>
                </div>
            </div>
        </section>`).join('');
    const engHeaders = STATUS_CASES.map((item) => `
        <div class="epic-block"><div class="epic-header"><div class="epic-meta"><span class="status-pill task-status epic-status-pill ${item.semantic}">${item.text}</span></div></div></div>`).join('');
    await page.setContent(`
        <!doctype html>
        <html><head><style>${dashboardCss}</style></head>
        <body>
            <main class="dashboard-shell">
                <div class="task-list" id="eng-fixture">${engHeaders}</div>
                <div class="task-list epm-issue-board epm-portfolio-board" id="epm-fixture">
                    ${boards}
                    <div class="epm-duplicates-callout" role="region" aria-label="Issues counted in multiple projects">
                        <div class="epm-duplicates-rows"><div class="epm-duplicates-row"><div class="epm-duplicates-projects">
                            <span class="epm-duplicates-project-chip">
                                <span class="epm-duplicates-project-name">Synthetic project 0</span>
                                <span class="epic-key" title="${LONG_LABEL}">${LONG_LABEL}</span>
                            </span>
                            <span class="epm-duplicates-project-chip">
                                <span class="epm-duplicates-project-name">Synthetic project 1</span>
                                <span class="epic-key" title="rnd_project_short">rnd_project_short</span>
                            </span>
                        </div></div></div>
                    </div>
                </div>
            </main>
        </body></html>
    `);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
}

const PILL_PROPS = ['fontSize', 'fontFamily', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopLeftRadius', 'backgroundColor', 'color'];

for (const viewport of [
    { name: 'desktop', width: 1520, height: 900 },
    { name: 'mobile 390px', width: 390, height: 800 },
]) {
    test(`EPM header pills and labels use ENG design-system tokens on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loadTokenFixture(page);

        const read = (locator, props) => locator.evaluate((node, names) => {
            const style = window.getComputedStyle(node);
            return Object.fromEntries(names.map((name) => [name, style[name]]));
        }, props);

        // (1) + (4): every header status pill matches the ENG epic status pill of the same semantic class.
        for (const item of STATUS_CASES) {
            const header = page.locator(`#epm-fixture .epm-project-board-title-meta .status-pill.task-status.epic-status-pill.${item.semantic}`);
            const eng = page.locator(`#eng-fixture .epic-header .epic-meta .status-pill.task-status.epic-status-pill.${item.semantic}`);
            await expect(header, item.semantic).toHaveCount(1);
            await expect(header).toHaveText(item.text);
            const headerStyle = await read(header, PILL_PROPS);
            const engStyle = await read(eng, PILL_PROPS);
            // Only the primary family is compared: ENG's `.epic-meta` stack falls back to Arial, the EPM one to monospace.
            const primaryFamily = (style) => ({ ...style, fontFamily: style.fontFamily.split(',')[0] });
            expect(primaryFamily(headerStyle), `${item.semantic} pill equals ENG pill`).toEqual(primaryFamily(engStyle));
            expect(headerStyle.borderTopLeftRadius).toBe('8px');
            expect(headerStyle.backgroundColor).toBe(item.background);
            const box = await header.boundingBox();
            const ownerBox = await header.locator('xpath=following-sibling::*[1]').boundingBox();
            expect(box.x + box.width, `${item.semantic} pill clear of owner`).toBeLessThanOrEqual(ownerBox.x + 0.5);
        }
        await expect(page.locator('#epm-fixture .epm-project-board-status-pill, #epm-fixture .epm-project-board-label-pill, #epm-fixture .epm-duplicates-project-label')).toHaveCount(0);

        // (4): the progress In Progress pill still renders as a status pill.
        const progressPills = page.locator('#epm-fixture .epm-project-progress-status.task-status.in-progress');
        await expect(progressPills).toHaveCount(STATUS_CASES.length);
        for (let i = 0; i < STATUS_CASES.length; i += 1) {
            const pill = progressPills.nth(i);
            await expect(pill).toBeVisible();
            const style = await read(pill, ['backgroundColor', 'textTransform', 'borderTopLeftRadius']);
            expect(style.backgroundColor).toBe('rgb(105, 192, 255)');
            expect(style.textTransform).toBe('uppercase');
            expect(style.borderTopLeftRadius).toBe('8px');
        }

        // (2) + (4): header labels and duplicates-callout labels are plain mono text, no chip.
        const labelSelectors = [
            '#epm-fixture .epm-project-board-title-meta .epic-key',
            '#epm-fixture .epm-duplicates-project-chip .epic-key',
        ];
        for (const selector of labelSelectors) {
            const labels = page.locator(selector);
            const count = await labels.count();
            expect(count, selector).toBeGreaterThan(0);
            for (let i = 0; i < count; i += 1) {
                const label = labels.nth(i);
                const style = await read(label, ['fontFamily', 'color', 'borderTopWidth', 'borderTopStyle', 'backgroundColor', 'boxShadow']);
                expect(style.fontFamily, selector).toContain('IBM Plex Mono');
                expect(style.color, selector).toBe('rgb(102, 102, 102)');
                expect(style.borderTopWidth === '0px' || style.borderTopStyle === 'none', selector).toBe(true);
                expect(style.backgroundColor, selector).toBe('rgba(0, 0, 0, 0)');
                expect(style.boxShadow, selector).toBe('none');
            }
        }

        // Long (60-char) label ellipsizes inside its container and the title meta does not overflow.
        expect(LONG_LABEL.length).toBe(60);
        for (const selector of labelSelectors) {
            const longLabel = page.locator(selector).first();
            await expect(longLabel).toHaveText(LONG_LABEL);
            const clip = await longLabel.evaluate((node) => {
                const style = window.getComputedStyle(node);
                return { textOverflow: style.textOverflow, overflow: style.overflow, whiteSpace: style.whiteSpace, clipped: node.scrollWidth > node.clientWidth };
            });
            if (selector.includes('title-meta')) {
                expect(clip.textOverflow, selector).toBe('ellipsis');
                expect(clip.overflow, selector).toBe('hidden');
            }
            expect(clip.whiteSpace, selector).toBe('nowrap');
            const box = await longLabel.boundingBox();
            expect(box.x + box.width, `${selector} stays in viewport`).toBeLessThanOrEqual(viewport.width + 0.5);
        }
        const metas = page.locator('#epm-fixture .epm-project-board-title-meta');
        const metaCount = await metas.count();
        for (let i = 0; i < metaCount; i += 1) {
            const overflow = await metas.nth(i).evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
            expect(overflow.scrollWidth, `title meta ${i}`).toBeLessThanOrEqual(overflow.clientWidth);
        }
        const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(documentOverflow).toBeLessThanOrEqual(1);

        // (3): owner name keeps its case while the surrounding meta is uppercase mono.
        const ownerNames = page.locator('#epm-fixture .epm-project-board-owner-name');
        for (let i = 0; i < await ownerNames.count(); i += 1) {
            const style = await read(ownerNames.nth(i), ['textTransform']);
            expect(style.textTransform).toBe('none');
        }
        await expect(ownerNames.first()).toHaveText('Ada Lovelace');
        expect((await read(metas.first(), ['textTransform', 'fontFamily', 'letterSpacing'])).textTransform).toBe('uppercase');
    });
}
