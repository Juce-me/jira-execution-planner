const { test, expect } = require('@playwright/test');
const { enabledEpmOptions, appBaseUrl, installDashboardFixture, selectedSprintId, selectedSprintName } = require('./epm_view_fixture');

// Person avatars (issue #324), EPM: the owner circle and the Epic assignee glyph slot. Synthetic data;
// the avatar host is stubbed. Geometry must equal the same render without photos.

const HOST = 'avatar-management--avatars.us-west-2.prod.public.atl-paas.net';
const PHOTO = `https://${HOST}/synthetic/photo/32`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function rollupWith({ avatars }) {
    return (project) => ({
        projects: [{
            project: { ...project, ownerName: 'Ada Example', ...(avatars ? { ownerAvatarUrl: PHOTO } : {}) },
            rollup: {
                metadataOnly: false, emptyRollup: false, truncated: false, truncatedQueries: [], initiatives: {},
                rootEpics: {
                    'PRODUCT-100': {
                        issue: { key: 'PRODUCT-100', summary: 'Avatar test epic', status: 'In Progress', issueType: 'Epic', storyPoints: 5,
                            assignee: 'Grace Example', ...(avatars ? { assigneeAvatarUrl: PHOTO } : {}) },
                        stories: [{ key: 'PRODUCT-101', summary: 'A story', status: 'To Do', issueType: 'Story', storyPoints: 2, assignee: 'Linus Example' }],
                    },
                },
                orphanStories: [],
            },
        }],
        duplicates: {}, truncated: false, fallback: false,
    });
}

async function open(page, { avatars, imageStatus = 200 }) {
    const imageRequests = [];
    await page.route(`https://${HOST}/**`, (route) => {
        imageRequests.push(route.request().url());
        return imageStatus === 200 ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: imageStatus, body: '' });
    });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, { selectedView: 'epm', epmTab: 'active', epmSelectedProjectId: '', selectedSprint: selectedSprintId, sprintName: selectedSprintName });
    await installDashboardFixture(page, { ...enabledEpmOptions(), allProjectsRollup: rollupWith({ avatars }) });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const board = page.locator('.epm-project-board').filter({ hasText: 'Connected Home Project' });
    await expect(board).toHaveCount(1);
    const toggle = board.getByRole('button', { name: /Show Jira rollup/ });
    if (await toggle.count()) await toggle.click();
    await expect(board.locator('.epic-header .epic-assignee').first()).toBeVisible();
    return { board, imageRequests };
}

const geometry = (board) => board.evaluate((node) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n * 100) / 100); };
    return {
        owner: rect(node.querySelector('.epm-project-board-owner')),
        ownerAvatar: rect(node.querySelector('.epm-project-board-owner-avatar')),
        ownerName: rect(node.querySelector('.epm-project-board-owner-name')),
        epicHeader: rect(node.querySelector('.epic-header')),
        epicIcon: rect(node.querySelector('.epic-assignee .task-assignee-icon')),
        epicName: rect(node.querySelector('.epic-assignee > span:last-child')),
    };
});

test('EPM owner circle and Epic assignee show photos with unchanged geometry and fall back on 404', async ({ browser }) => {
    const ctx = () => browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
    const plain = await (await ctx()).newPage();
    const base = await open(plain, { avatars: false });
    const baseline = await geometry(base.board);
    expect(base.imageRequests).toEqual([]);

    const photoPage = await (await ctx()).newPage();
    const photo = await open(photoPage, { avatars: true });
    await expect(photo.board.locator('.epm-project-board-owner-avatar img')).toBeVisible();
    await expect(photo.board.locator('.epic-assignee .task-assignee-icon img')).toBeVisible();
    await expect(photo.board.locator('.epm-project-board-owner-avatar')).not.toHaveText('AE');
    expect(await geometry(photo.board)).toEqual(baseline);
    for (const url of photo.imageRequests) expect(new URL(url).host).toBe(HOST);

    const failedPage = await (await ctx()).newPage();
    const failed = await open(failedPage, { avatars: true, imageStatus: 404 });
    await expect(failed.board.locator('.epm-project-board-owner-avatar')).toHaveText('AE');
    await expect(failed.board.locator('.epic-assignee .task-assignee-icon svg')).toBeVisible();
    expect(await geometry(failed.board)).toEqual(baseline);
});
