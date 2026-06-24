const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
];

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'CRITE-223', subGoalKey: 'CRITE-34' },
    projects: {
        'home-1': { id: 'home-1', homeProjectId: 'home-1', name: 'BidSwitch', label: 'rnd_project_bidswitch' },
    },
};

const homeProjectStatuses = [
    { value: 'DONE', label: 'Completed' },
    { value: 'ARCHIVED', label: 'Archived' },
    { value: 'ON_TRACK', label: 'On track' },
    { value: 'AT_RISK', label: 'At risk' },
    { value: 'PAUSED', label: 'Paused' },
];

const homeProjects = Array.from({ length: 18 }, (_, index) => ({
    id: `home-${index + 1}`,
    homeProjectId: `home-${index + 1}`,
    name: `Synthetic Project ${index + 1}`,
    homeUrl: '',
    stateValue: homeProjectStatuses[index % homeProjectStatuses.length].value,
    stateLabel: homeProjectStatuses[index % homeProjectStatuses.length].label,
    tabBucket: 'active',
    latestUpdateDate: '2026-04-27',
    latestUpdateSnippet: 'Synthetic update',
    label: index === 0 ? 'rnd_project_bidswitch' : '',
    resolvedLinkage: { labels: index === 0 ? ['rnd_project_bidswitch'] : [], epicKeys: [] },
    matchState: index === 0 ? 'jep-fallback' : 'metadata-only',
}));

async function mockSettings(page, overrides = {}) {
    await installDashboardShell(page);
    await page.route('**/api/**', route => {
        const requestUrl = new URL(route.request().url());
        const url = requestUrl.href;
        if (requestUrl.pathname === '/api/auth/refresh') {
            return route.fulfill({ status: 204, body: '' });
        }
        if (requestUrl.pathname === '/api/config') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    jiraUrl: 'https://jira.example',
                    projectsConfigured: true,
                    settingsAdminOnly: false,
                    userCanEditSettings: true,
                    userCanEditEpmConfig: true,
                    epm: { ...epmConfig, ...(overrides.config || {}) },
                }),
            });
        }
        if (requestUrl.pathname === '/api/me/connections/home-token') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    connected: true,
                    provider: 'atlassian_user_api_token',
                    credentialSubject: 'profile@example.com',
                    status: 'active',
                    needsReconnect: false,
                }),
            });
        }
        const handledBySpecificMock = [
            '/api/epm/config',
            '/api/epm/scope',
            '/api/epm/goals',
            '/api/epm/projects/configuration',
            '/api/jira/labels',
        ].some(path => url.includes(path));
        if (handledBySpecificMock) {
            return route.fallback();
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });
    await page.route('**/api/epm/config', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...epmConfig, ...(overrides.config || {}) }),
    }));
    await page.route('**/api/epm/scope', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cloudId: 'synthetic-cloud', error: '' }),
    }));
    await page.route('**/api/epm/goals**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            goals: [
                { id: 'root', key: 'CRITE-223', name: '[EPM] R&D bi weekly report hierarchy' },
                { id: 'child', key: 'CRITE-34', name: '[EPM] BidSwitch' },
            ],
            error: '',
        }),
    }));
    await page.route('**/api/epm/projects/configuration**', route => {
        if (overrides.projectError) {
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic failure' }) });
        }
        if (overrides.projectDelay) {
            return new Promise(resolve => {
                setTimeout(() => {
                    route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ projects: overrides.projects || homeProjects }),
                    }).then(resolve);
                }, overrides.projectDelay);
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ projects: overrides.projects || homeProjects }),
        });
    });
    await page.route('**/api/jira/labels**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ labels: ['rnd_project_bidswitch', 'rnd_project_long_label_for_visual_qa'] }),
    }));
}

async function openEpmSettings(page) {
    await page.goto('http://127.0.0.1:5050');
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'EPM' }).click();
    await dialog.getByRole('tab', { name: 'Scope' }).click();
}

for (const viewport of viewports) {
    test.describe(`EPM settings visual states ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('scope loaded', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await expect(page.getByRole('tab', { name: 'Scope' })).toHaveAttribute('aria-selected', 'true');
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-scope-loaded.png`, fullPage: true });
        });

        test('scope content scrolls above pinned footer on short screens', async ({ page }) => {
            await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height, 560) });
            await mockSettings(page);
            await openEpmSettings(page);
            const dialog = page.getByRole('dialog');
            const scopePanel = page.locator('#epm-settings-scope-panel');
            await expect(scopePanel).toBeVisible();
            const scrollState = await scopePanel.evaluate((node) => {
                const styles = window.getComputedStyle(node);
                return {
                    overflowY: styles.overflowY,
                    clientHeight: node.clientHeight,
                    scrollHeight: node.scrollHeight,
                };
            });
            expect(['auto', 'scroll']).toContain(scrollState.overflowY);
            expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight + 8);
            const beforeScrollTop = await scopePanel.evaluate((node) => node.scrollTop);
            await scopePanel.evaluate((node) => { node.scrollTop = node.scrollHeight; });
            await expect.poll(() => scopePanel.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeScrollTop);
            const footerBox = await dialog.locator('.group-modal-footer').boundingBox();
            const dialogBox = await dialog.boundingBox();
            expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-scope-short-screen-scroll.png`, fullPage: true });
        });

        test('projects prerequisites', async ({ page }) => {
            await mockSettings(page, { config: { scope: { rootGoalKey: 'CRITE-223', subGoalKey: '' }, labelPrefix: '' } });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByText('Setup required')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Set sub-goal' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Set label prefix' })).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-prerequisites.png`, fullPage: true });
        });

        test.skip('projects loading skeleton', async ({ page }) => {
            await mockSettings(page, { projectDelay: 800 });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.locator('.epm-project-skeleton-row').first()).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-loading.png`, fullPage: true });
        });

        test('projects many rows and long labels', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByRole('textbox', { name: 'Project name for Synthetic Project 18' })).toHaveValue('Synthetic Project 18');
            await expect(page.getByText('No Jira label selected.').first()).toBeVisible();
            await expect(page.getByText('On track').first()).toBeVisible();
            await expect(page.getByText('Synthetic update').first()).toHaveCount(0);
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-many-rows.png`, fullPage: true });
        });

        test('projects status and label columns stay aligned', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const rows = page.locator('.epm-project-settings-row');
            await expect(rows.nth(3)).toBeVisible();
            const statusLefts = [];
            const labelLefts = [];
            for (const rowIndex of [0, 1, 2, 3]) {
                statusLefts.push((await rows.nth(rowIndex).locator('.epm-home-status-pill').boundingBox()).x);
                labelLefts.push((await rows.nth(rowIndex).locator('.epm-project-label-cell').boundingBox()).x);
            }
            expect(Math.max(...statusLefts) - Math.min(...statusLefts)).toBeLessThanOrEqual(1);
            expect(Math.max(...labelLefts) - Math.min(...labelLefts)).toBeLessThanOrEqual(1);
        });

        test('projects empty custom rows are deletable', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const rowsBefore = page.locator('.epm-project-settings-row');
            const countBefore = await rowsBefore.count();
            await page.getByRole('button', { name: 'Add custom Project' }).click();
            await expect(rowsBefore).toHaveCount(countBefore + 1);
            // The new custom row is the last one; its delete button has aria-label starting with "Delete "
            const lastRow = rowsBefore.last();
            const deleteBtn = lastRow.getByRole('button', { name: /^Delete / });
            await expect(deleteBtn).toBeVisible();
            await deleteBtn.scrollIntoViewIfNeeded();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-empty-custom-delete.png`, fullPage: true });
            await deleteBtn.click();
            await expect(rowsBefore).toHaveCount(countBefore);
        });

        test('projects scrolled label menu stays aligned', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const scrollRegion = page.locator('.epm-projects-scroll-region');
            await expect(scrollRegion).toBeVisible();
            await scrollRegion.evaluate(node => { node.scrollTop = node.scrollHeight; });
            // 2b regression guard: opening from "Choose label" button alone (no input click) must show the menu
            await page.getByRole('button', { name: 'Choose label' }).last().click();
            await expect(page.locator('.epm-label-menu-layer')).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-scrolled-label-menu.png`, fullPage: true });
        });

        test('projects label prefix pill and placeholder toggle (Change C)', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            // Open label search on an unlabeled row (any row without a label; rows 1-17 have no label)
            const rows = page.locator('.epm-project-settings-row');
            await expect(rows.nth(1)).toBeVisible();
            await rows.nth(1).getByRole('button', { name: 'Choose label' }).click();
            // Prefix pill must be visible with the normalized prefix
            await expect(rows.nth(1).locator('.epm-label-prefix-pill')).toBeVisible();
            await expect(rows.nth(1).locator('.epm-label-prefix-pill')).toContainText('rnd_project_');
            // The label search input is inside .team-search-wrapper (not the project name input)
            // Wait for it to settle out of the 'Searching labels...' transient state
            const labelInput = rows.nth(1).locator('.team-search-wrapper input.team-search-input');
            await expect(labelInput).toHaveAttribute('placeholder', 'Labels starting with rnd_project_…');
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-label-prefix-pill.png`, fullPage: true });
            // Click "Show all labels" — pill must disappear and placeholder must switch
            await rows.nth(1).getByRole('button', { name: 'Show all labels' }).click();
            await expect(rows.nth(1).locator('.epm-label-prefix-pill')).toHaveCount(0);
            await expect(labelInput).toHaveAttribute('placeholder', 'Search all Jira labels…');
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-label-show-all.png`, fullPage: true });
        });

        test('projects prefix strips trailing star before label request (2a guard)', async ({ page }) => {
            let capturedPrefixParam = null;
            // Override the labels route to capture the outgoing prefix param
            await mockSettings(page, { config: { labelPrefix: 'rnd_project_*' } });
            await page.route('**/api/jira/labels**', route => {
                const url = new URL(route.request().url());
                capturedPrefixParam = url.searchParams.get('prefix');
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ labels: ['rnd_project_bidswitch', 'rnd_project_long_label_for_visual_qa'] }),
                });
            });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const rows = page.locator('.epm-project-settings-row');
            await expect(rows.nth(1)).toBeVisible();
            await rows.nth(1).getByRole('button', { name: 'Choose label' }).click();
            await expect(page.locator('.epm-label-menu-layer')).toBeVisible();
            // The prefix sent to the backend must have no trailing *
            expect(capturedPrefixParam).toBe('rnd_project_');
            // Prefix pill must also show the stripped prefix
            await expect(rows.nth(1).locator('.epm-label-prefix-pill')).toContainText('rnd_project_');
        });

        test('projects per-row delete and Home reappear on refresh (Change D)', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const rows = page.locator('.epm-project-settings-row');
            const rowCount = await rows.count();
            expect(rowCount).toBeGreaterThan(0);
            // (a) Every row must have exactly one delete button with aria-label starting "Delete "
            for (let i = 0; i < Math.min(rowCount, 5); i++) {
                await expect(rows.nth(i).getByRole('button', { name: /^Delete / })).toHaveCount(1);
            }
            // (b) Delete an unlabeled Home row (row index 1, Home-discovered) — count drops by 1
            const initialCount = rowCount;
            const rowToDelete = rows.nth(1);
            const deleteBtn = rowToDelete.getByRole('button', { name: /^Delete / });
            await deleteBtn.click();
            await expect(rows).toHaveCount(initialCount - 1);
            // Section helper note about Jira Home must be visible
            await expect(page.getByText(/Removing a Home-discovered project only hides it until the next refresh/)).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-home-row-deleted.png`, fullPage: true });
            // (c) Forced refresh via "Refresh from Jira Home" should restore the deleted Home row
            await page.getByRole('button', { name: 'Refresh from Jira Home' }).click();
            await expect(rows).toHaveCount(initialCount, { timeout: 5000 });
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-home-row-restored.png`, fullPage: true });
        });

        test('projects error state', async ({ page }) => {
            await mockSettings(page, { projectError: true });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-error.png`, fullPage: true });
        });
    });
}
