const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'tmp/work-structure-mockup');
const port = 5067;
const url = `http://localhost:${port}/assets/mockups/quarterly-work-structure-settings.html`;
let server;

test.beforeAll(async () => {
    fs.mkdirSync(output, { recursive: true });
    server = spawn(process.execPath, ['scripts/build_work_structure_mockup.cjs', '--serve', `--port=${port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        let logs = '';
        const timeout = setTimeout(() => reject(new Error('Mockup server did not start: ' + logs)), 15000);
        const finish = error => { clearTimeout(timeout); error ? reject(error) : resolve(); };
        server.stdout.on('data', chunk => { logs += chunk; if (logs.includes('Mockup ready at')) finish(); });
        server.stderr.on('data', chunk => { logs += chunk; });
        server.once('error', finish);
        server.once('exit', code => finish(new Error('Mockup server exited ' + code + ': ' + logs)));
    });
});
test.afterAll(async () => {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
});
const panel = page => page.locator('[data-fixture-panel]:visible');
const footer = page => page.locator('.group-modal-footer');
async function open(page, section = 'source') {
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(`${url}?configuration=delivery&section=${section}&admin=project`);
    await expect(panel(page).locator('.group-projects-layout')).toBeVisible();
    expect(failures).toEqual([]);
    return failures;
}
async function choose(page, id) { await page.locator(`[data-config=${id}]`).click(); }
async function tab(page, name) { await page.getByRole('tab', { name, exact: true }).click(); }
async function discard(page) {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Discard changes?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.locator('.group-modal')).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
}
async function editRange(page, label, value) {
    const input = panel(page).getByLabel(label, { exact: true });
    if (!await input.isVisible()) await panel(page).getByRole('button', { name: `Change ${label.toLowerCase()}`, exact: true }).click();
    await input.fill(value);
}

test('upper workspace tabs hide configuration chrome and restore per-configuration tabs and drafts', async ({ page }) => {
    await open(page);
    await expect(page.locator('#admin-tabs [role=tab]')).toHaveText(['Project config', 'Capacity', 'Priority weights', 'Access', 'Performance']);
    await expect(page.locator('#tabs [role=tab]')).toHaveText(['Scope', 'Source', 'Field mapping']);
    await panel(page).getByRole('button', { name: 'Remove sprint field', exact: true }).click();
    await panel(page).getByPlaceholder('Search fields...', { exact: true }).fill('Sp');
    await tab(page, 'Capacity');
    await expect(page.locator('#project-config-panel')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Test configuration', exact: true })).toHaveCount(0);
    await expect(page.locator('#workspace-panel')).toContainText('shared across all project configurations');
    await tab(page, 'Project config');
    await expect(panel(page).getByPlaceholder('Search fields...', { exact: true })).toHaveValue('Sp');
    await choose(page, 'legacy');
    await tab(page, 'Field mapping');
    await choose(page, 'delivery');
    await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).getByPlaceholder('Search fields...', { exact: true })).toHaveValue('Sp');
    await choose(page, 'legacy');
    await expect(page.getByRole('tab', { name: 'Field mapping', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('rename followed by field edits never replaces the newer configuration name', async ({ page }) => {
    await open(page);
    await choose(page, 'legacy');
    await page.getByRole('textbox', { name: 'Configuration name', exact: true }).fill('Legacy renamed');
    await panel(page).getByRole('button', { name: 'Remove sprint field', exact: true }).click();
    await panel(page).getByPlaceholder('Search fields...', { exact: true }).fill('sprint');
    await panel(page).getByPlaceholder('Search fields...', { exact: true }).press('Enter');
    await tab(page, 'Field mapping');
    await expect(page.getByRole('textbox', { name: 'Configuration name', exact: true })).toHaveValue('Legacy renamed');
    await expect(page.locator('#configuration-header h2')).toHaveText('Legacy renamed');
    await choose(page, 'delivery');
    await choose(page, 'legacy');
    await expect(page.getByRole('textbox', { name: 'Configuration name', exact: true })).toHaveValue('Legacy renamed');
});

test('explicit ID mappings allow renamed Jira types without changing structure or project scope', async ({ page }) => {
    await open(page, 'mapping');
    for (const name of ['Epic', 'Initiative', 'Objective', 'Strategy']) await expect(panel(page).getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Remove Epic', exact: true }).click();
    await expect(panel(page)).toHaveAttribute('data-model', 'rnd_2027');
    await expect(panel(page).getByLabel('Search Epic', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(footer(page)).toContainText('Incomplete mappings');
    await tab(page, 'Scope');
    await expect(panel(page)).toContainText('DELIVERY');
    await expect(panel(page).locator('.product-chip')).toHaveCount(0);
    await tab(page, 'Field mapping');
    await panel(page).getByLabel('Search Epic', { exact: true }).fill('Custom Epic');
    await panel(page).locator('.team-search-result-item:visible').filter({ hasText: 'Custom Epic' }).click();
    await expect(panel(page).locator('[data-mapping-key=planningIssueTypeId]')).toContainText('Custom Epic');
    await expect(panel(page)).toHaveAttribute('data-model', 'rnd_2027');
    await expect(panel(page).locator('.mapping-preview-card')).toContainText('Custom Epic Summary');
    await tab(page, 'Scope');
    await expect(panel(page)).toContainText('DELIVERY');
});

test('all hierarchy rows and extra Jira fields support selected, remove and keyboard search', async ({ page }) => {
    await open(page, 'mapping');
    for (const label of ['Epic', 'Initiative', 'Objective', 'Strategy', 'Project Track', 'RnD_allocation_category']) {
        await panel(page).getByRole('button', { name: `Remove ${label}`, exact: true }).click();
        const input = panel(page).getByLabel(`Search ${label}`, { exact: true });
        await input.fill(label);
        if (label === 'RnD_allocation_category') await panel(page).locator('.team-search-result-item:visible').filter({ hasText: label }).click();
        else await input.press('Enter');
        await expect(panel(page).getByRole('button', { name: `Remove ${label}`, exact: true })).toBeVisible();
    }
    await expect(page.locator('.group-modal-dirty')).toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Remove Strategy', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.group-modal-dirty')).toHaveCount(0);
    await choose(page, 'legacy');
    await expect(panel(page).getByRole('button', { name: 'Remove Story', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Remove RnD_allocation_category', exact: true })).toHaveCount(0);
});

test('ranges accept a different adjacent boundary and reject malformed, reversed, overlapping and gapped values', async ({ page }) => {
    await open(page, 'scope');
    await editRange(page, 'Start sprint', 'wrong');
    await expect(panel(page).getByLabel('Start sprint', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await editRange(page, 'Start sprint', '2027Q2');
    await expect(page.locator('.group-modal-validation')).toContainText('gap');
    await choose(page, 'legacy');
    await editRange(page, 'End sprint', '2027Q1');
    await expect(page.locator('.group-modal-validation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.group-modal-dirty')).toHaveCount(0);
    await choose(page, 'delivery');
    await editRange(page, 'Start sprint', '2027Q1');
    await expect(page.locator('.group-modal-validation')).toContainText('overlap');
    await editRange(page, 'Start sprint', '2027Q2');
    await editRange(page, 'End sprint', '2027Q1');
    await expect(page.locator('.group-modal-validation')).toContainText('precede');
    await editRange(page, 'End sprint', '');
    await expect(page.locator('.group-modal-validation')).toHaveCount(0);
    await expect(page.locator('#configuration-header')).not.toContainText('null');
});

test('real Cancel confirmation preserves edits on Keep editing and discards both drafts only on Discard', async ({ page }) => {
    await open(page);
    await page.getByRole('textbox', { name: 'Configuration name', exact: true }).fill('Delivery draft');
    await choose(page, 'legacy');
    await panel(page).getByRole('button', { name: 'Remove sprint field', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Discard changes?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(panel(page).getByPlaceholder('Search fields...', { exact: true })).toBeVisible();
    await discard(page);
    await expect(panel(page).getByRole('button', { name: 'Remove sprint field', exact: true })).toBeVisible();
    await choose(page, 'delivery');
    await expect(page.getByRole('textbox', { name: 'Configuration name', exact: true })).toHaveValue('DELIVERY');
});

test('Test configuration reports only saved synthetic readiness and never claims a live Jira check', async ({ page }) => {
    const apiCalls = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
    await open(page);
    await page.getByRole('button', { name: 'Test configuration', exact: true }).click();
    await expect(footer(page)).toContainText('Live Jira access and field contexts have not been tested');
    await panel(page).getByRole('button', { name: 'Remove sprint field', exact: true }).click();
    await page.getByRole('button', { name: 'Test configuration', exact: true }).click();
    await expect(footer(page)).toContainText('Save your changes before testing');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Test configuration', exact: true }).click();
    await expect(footer(page)).toContainText('saved configuration is incomplete');
    await tab(page, 'Capacity');
    await expect(page.getByRole('button', { name: 'Test configuration', exact: true })).toHaveCount(0);
    await tab(page, 'Project config');
    await expect(footer(page)).not.toContainText('saved configuration is incomplete');
    expect(apiCalls).toEqual([]);
});

test('Source keeps real field and scoped Board pickers, IDs and the restricted preview server', async ({ page, request }) => {
    const failures = await open(page);
    await panel(page).getByRole('button', { name: 'Show Jira technical IDs', exact: true }).click();
    await expect(panel(page).locator('.field-id-hint').first()).toBeVisible();
    await panel(page).getByRole('button', { name: 'Hide Jira technical IDs', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Clear sprint board', exact: true }).click();
    const search = panel(page).getByPlaceholder('Search boards...', { exact: true });
    await search.fill('Legacy');
    await expect(panel(page).getByText('No boards found', { exact: true })).toBeVisible();
    await search.fill('7002'); await search.press('Enter');
    await expect(page.locator('.group-modal-dirty')).toHaveCount(0);
    expect((await request.get(`http://localhost:${port}/.env`)).status()).toBe(404);
    expect((await request.get(`http://localhost:${port}/.git/config`)).status()).toBe(404);
    expect(failures).toEqual([]);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, 'source.png'), animations: 'disabled' });
});

test('Scope uses the real project search and preserves stored classifications independently of mappings', async ({ page }) => {
    await open(page, 'scope');
    await panel(page).getByRole('button', { name: 'Remove project DELIVERY', exact: true }).click();
    const search = panel(page).getByPlaceholder('Search projects to add...', { exact: true });
    await search.fill('DELIVERY');
    await panel(page).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(panel(page)).toContainText('DELIVERY');
    await expect(page.locator('.group-modal-dirty')).toHaveCount(0);
    await choose(page, 'legacy');
    await expect(panel(page).locator('.product-chip')).toContainText('ROADMAP');
    await expect(panel(page).locator('.tech-chip')).toHaveCount(2);
    await choose(page, 'delivery');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, 'scope.png'), animations: 'disabled' });
});

test('mapping preview shows actual Epic and Initiative names and retains linked hover feedback', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, 'mapping');
    await expect(panel(page).locator('.mapping-preview-card')).toContainText('Epic Summary');
    await expect(panel(page).locator('.mapping-preview-card')).toContainText('INITIATIVE-KEY');
    await expect(panel(page).locator('.mapping-preview-card')).not.toContainText('Story Summary');
    await panel(page).locator('.mapping-config-grid [data-map-key=storyPoints]').hover();
    await expect(panel(page).locator('.mapping-preview-card [data-map-key=storyPoints].is-linked-hover')).toHaveCount(2);
    await page.mouse.move(0, 0);
    await panel(page).getByRole('button', { name: 'Show Jira technical IDs', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'mapping.png'), animations: 'disabled' });
    await panel(page).locator('.mapping-preview-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'mapping-preview.png'), animations: 'disabled' });
});

test('name validation stays local and long names cannot expand the header', async ({ page }) => {
    await open(page);
    const input = page.getByRole('textbox', { name: 'Configuration name', exact: true });
    await input.fill('');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await input.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${describedBy}"]`)).toContainText('Enter a configuration name');
    await input.fill('A configuration name that is deliberately longer than the available header width '.repeat(4));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#configuration-header h2')).toHaveCSS('text-overflow', 'ellipsis');
});

test('mobile drawer, tab scrolling, remove targets and footer remain reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await page.getByRole('button', { name: 'Configurations', exact: true }).click();
    await expect(page.locator('#configurations')).toHaveClass(/is-mobile-active/);
    const back = page.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toHaveCSS('color', 'rgb(26, 26, 26)');
    await back.click();
    await page.getByRole('button', { name: 'Configurations', exact: true }).click();
    await choose(page, 'legacy');
    await expect(page.locator('#configurations')).not.toHaveClass(/is-mobile-active/);
    const remove = panel(page).getByRole('button', { name: 'Remove sprint field', exact: true });
    await expect(remove).toBeInViewport();
    const box = await remove.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24); expect(box.height).toBeGreaterThanOrEqual(24);
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    const testBox = await page.getByRole('button', { name: 'Test configuration', exact: true }).boundingBox();
    expect(testBox.x).toBeGreaterThanOrEqual(0);
    expect(testBox.x + testBox.width).toBeLessThanOrEqual(375);
    const performance = page.getByRole('tab', { name: 'Performance', exact: true });
    await performance.scrollIntoViewIfNeeded(); await expect(performance).toBeInViewport();
    await performance.click(); await tab(page, 'Project config');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, 'mobile.png'), animations: 'disabled' });
});
