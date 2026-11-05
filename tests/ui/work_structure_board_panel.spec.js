// Board detail panel person editors for both configurations, against a harness page (no Jira, no DB, no server).
// Legacy edits Story children and the Epic; the new model's planning children are Epics under an Initiative.
// Synthetic data only.
const path = require('path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const origin = 'http://localhost:5953';
let bundle;

test.beforeAll(() => {
    bundle = esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'work_structure_board_panel.entry.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty', '.js': 'jsx' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

async function openHarness(page) {
    await page.route(`${origin}/**`, async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/harness') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="panel"></div>' });
        if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'application/javascript', body: bundle });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/harness`);
    await page.addScriptTag({ url: `${origin}/harness.js` });
}

const rowFor = (page, key) => page.locator(`.story-subtask-row[data-story-key="${key}"]`);

async function openedFor(page, workModel, children, clickKeys) {
    await page.evaluate(({ workModel, children }) => {
        window.__mounted = window.__boardPanel.mount(workModel, children.map(([key, type, extra]) => window.__boardPanel.child(key, type, extra)));
    }, { workModel, children });
    for (const key of clickKeys) await rowFor(page, key).locator('.issue-person-editor-trigger').click();
    return page.evaluate(() => window.__mounted.opened);
}

test('Legacy: Story children and the Epic parent edit their own people; a non-Story child stays read-only', async ({ page }) => {
    await openHarness(page);
    const opened = await openedFor(page, 'legacy', [['OLD-1', 'Story'], ['OLD-2', 'Task']], ['OLD-1']);
    await expect(rowFor(page, 'OLD-2').locator('.issue-person-editor-trigger')).toHaveCount(0);
    await expect(rowFor(page, 'OLD-2').locator('.story-subtask-assignee')).toHaveText('Pat Synthetic');
    await page.locator('.eperson').filter({ hasText: 'Delivery owner' }).locator('.issue-person-editor-trigger').click();
    const all = await page.evaluate(() => window.__mounted.opened);
    expect(opened).toEqual([{ issueKey: 'OLD-1', field: 'assignee', issueKind: 'story', sourceSurface: 'board' }]);
    expect(all[1]).toEqual({ issueKey: 'PLAN-P1', field: 'deliveryOwner', issueKind: 'epic', sourceSurface: 'board' });
});

test('new model: Epic children edit their assignee and the Initiative parent its delivery owner; subtasks stay read-only', async ({ page }) => {
    await openHarness(page);
    const opened = await openedFor(page, 'rnd_2027', [['PLAN-1', 'Epic'], ['PLAN-2', 'Sub-task', { subtask: true }]], ['PLAN-1']);
    await expect(rowFor(page, 'PLAN-2').locator('.issue-person-editor-trigger')).toHaveCount(0);
    await page.locator('.eperson').filter({ hasText: 'Delivery owner' }).locator('.issue-person-editor-trigger').click();
    await page.locator('.eperson').filter({ hasText: 'Assignee' }).locator('.issue-person-editor-trigger').click();
    const all = await page.evaluate(() => window.__mounted.opened);
    expect(opened).toEqual([{ issueKey: 'PLAN-1', field: 'assignee', issueKind: 'epic', sourceSurface: 'board' }]);
    // The parent writes only its own key: the Initiative, never a child.
    expect(all.slice(1)).toEqual([
        { issueKey: 'PLAN-P1', field: 'deliveryOwner', issueKind: 'initiative', sourceSurface: 'board' },
        { issueKey: 'PLAN-P1', field: 'assignee', issueKind: 'initiative', sourceSurface: 'board' },
    ]);
});
