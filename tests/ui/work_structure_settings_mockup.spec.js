const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'tmp/work-structure-mockup');
const port = 5063;
const url = `http://localhost:${port}/assets/mockups/quarterly-work-structure-settings.html`;
let server;

test.beforeAll(async () => {
    fs.mkdirSync(output, { recursive: true });
    server = spawn(process.execPath, ['scripts/build_work_structure_mockup.cjs', '--serve', `--port=${port}`], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
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

async function open(page, section = 'source') {
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(`${url}?configuration=delivery&section=${section}&admin=project`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-real-jira-settings] .group-projects-layout')).toBeVisible();
    expect(failures).toEqual([]);
    return failures;
}

test('workspace tabs stay above selected-configuration tabs and retain the draft', async ({ page }) => {
    await open(page);
    await expect(page.locator('#admin-tabs [role=tab]')).toHaveText(['Project config', 'Capacity', 'Priority weights', 'Access', 'Performance']);
    await expect(page.locator('#editor #tabs [role=tab]')).toHaveText(['Scope', 'Source', 'Field mapping']);
    await page.getByRole('button', { name: 'Remove sprint field', exact: true }).click();
    await expect(page.getByPlaceholder('Search fields...', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Capacity', exact: true }).click();
    await expect(page.locator('#project-config-panel')).toBeHidden();
    await expect(page.locator('#workspace-panel')).toContainText('shared across all project configurations');
    await page.getByRole('tab', { name: 'Project config', exact: true }).click();
    await expect(page.getByPlaceholder('Search fields...', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove sprint field', exact: true })).toBeVisible();
});

test('Source uses the real field and Board pickers without app requests', async ({ page, request }) => {
    const apiCalls = [];
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) apiCalls.push(req.url()); });
    const failures = await open(page);
    await expect(page.locator('.settings-source-grid')).toBeVisible();
    await expect(page.getByText('Sprint Board (optional)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show Jira technical IDs', exact: true }).click();
    await expect(page.locator('.field-id-hint').first()).toBeVisible();
    await page.getByRole('button', { name: 'Hide Jira technical IDs', exact: true }).click();
    await page.getByRole('button', { name: 'Remove sprint field', exact: true }).click();
    const search = page.getByPlaceholder('Search fields...', { exact: true });
    await search.fill('sprint');
    await search.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove sprint field', exact: true })).toBeVisible();
    await expect(page.locator('#dirty')).toBeHidden();
    await page.getByRole('button', { name: 'Clear sprint board', exact: true }).click();
    const boardSearch = page.getByPlaceholder('Search boards...', { exact: true });
    await boardSearch.fill('7002');
    await boardSearch.press('Enter');
    await expect(page.getByRole('button', { name: 'Clear sprint board', exact: true })).toBeVisible();
    await expect(page.locator('#dirty')).toBeHidden();
    expect(apiCalls).toEqual([]);
    expect(failures).toEqual([]);
    expect((await request.get(`http://localhost:${port}/.git/config`)).status()).toBe(404);
    expect((await request.get(`http://localhost:${port}/.env`)).status()).toBe(404);
    await page.screenshot({ path: path.join(output, 'source.png'), animations: 'disabled' });
});

test('Field mapping retains production preview and independent configuration drafts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const failures = await open(page, 'mapping');
    await expect(page.locator('.mapping-config-grid')).toBeVisible();
    await expect(page.locator('.mapping-parent-chip')).toBeVisible();
    await expect(page.locator('.mapping-sp-chip')).toBeVisible();
    await expect(page.locator('.mapping-preview-card')).toBeVisible();
    await page.screenshot({ path: path.join(output, 'mapping.png'), animations: 'disabled' });
    await page.locator('.mapping-config-grid [data-map-key=storyPoints]').hover();
    await expect(page.locator('.mapping-preview-card [data-map-key=storyPoints].is-linked-hover')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remove story points field', exact: true }).click();
    await expect(page.getByPlaceholder('Search fields...', { exact: true })).toBeVisible();
    await page.locator('[data-config=legacy]').click();
    await expect(page.locator('.mapping-sp-chip')).toBeVisible();
    await page.locator('[data-config=delivery]').click();
    await expect(page.getByPlaceholder('Search fields...', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#dirty')).toBeHidden();
    await page.getByPlaceholder('Search fields...', { exact: true }).fill('Story Points');
    await page.getByPlaceholder('Search fields...', { exact: true }).press('Enter');
    await expect(page.locator('.mapping-sp-chip')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByPlaceholder('Search fields...', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.mapping-sp-chip')).toBeVisible();
    expect(failures).toEqual([]);
    await page.locator('.mapping-preview-section').scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, 'mapping-preview.png'), animations: 'disabled' });
});

test('mobile configuration drawer reuses the existing layout and keeps controls reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await page.getByRole('button', { name: 'Configurations', exact: true }).click();
    await expect(page.locator('#configurations')).toHaveClass(/is-mobile-active/);
    await page.locator('[data-config=legacy]').click();
    await expect(page.locator('#configurations')).not.toHaveClass(/is-mobile-active/);
    await expect(page.getByRole('button', { name: 'Remove sprint field', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), animations: 'disabled' });
});


test('Scope keeps the quarter boundary and selected projects in each configuration', async ({ page }) => {
    await page.goto(`${url}?configuration=delivery&section=scope&admin=project`);
    await expect(page.locator('#settings-panel')).toContainText('2027Q1');
    await expect(page.locator('#settings-panel .selected-team-chip')).toContainText(['2027Q1', 'No end', 'DELIVERY']);
    await page.locator('[data-change=from]').click();
    await page.getByLabel('Start sprint', { exact: true }).selectOption('2027Q2');
    await expect(page.locator('#validation')).toContainText('Legacy through 2026Q4 and DELIVERY from 2027Q1');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#validation')).toBeHidden();
    await page.locator('[data-config=legacy]').click();
    await expect(page.locator('#settings-panel')).toContainText('2026Q4');
    await expect(page.locator('#settings-panel .selected-team-chip')).toContainText(['All earlier sprints', '2026Q4', 'ROADMAP', 'PLATFORM', 'FOUNDATION']);
    await page.locator('[data-config=delivery]').click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(output, 'scope.png'), animations: 'disabled' });
});
