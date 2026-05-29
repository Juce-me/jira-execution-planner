const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    appBaseUrl,
    installDashboardFixture,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_home_token_fixture');

function progressRollup(project) {
    return {
        projects: [
            {
                project,
                rollup: {
                    metadataOnly: false,
                    emptyRollup: false,
                    truncated: false,
                    truncatedQueries: [],
                    initiatives: {},
                    rootEpics: {
                        'PRODUCT-100': {
                            issue: {
                                key: 'PRODUCT-100',
                                summary: 'Progress test epic',
                                status: 'In Progress',
                                issueType: 'Epic',
                                storyPoints: 99
                            },
                            stories: [
                                {
                                    key: 'PRODUCT-101',
                                    summary: 'Finished story',
                                    status: 'Done',
                                    issueType: 'Story',
                                    storyPoints: 2
                                },
                                {
                                    key: 'PRODUCT-102',
                                    summary: 'Incomplete story',
                                    status: 'Incomplete',
                                    issueType: 'Story',
                                    storyPoints: 1
                                },
                                {
                                    key: 'PRODUCT-103',
                                    summary: 'Open story',
                                    status: 'In Progress',
                                    issueType: 'Story',
                                    storyPoints: 3
                                },
                                {
                                    key: 'PRODUCT-105',
                                    summary: 'Waiting story',
                                    status: 'To Do',
                                    issueType: 'Story',
                                    storyPoints: 4
                                },
                                {
                                    key: 'PRODUCT-104',
                                    summary: 'Killed story',
                                    status: 'Killed',
                                    issueType: 'Story',
                                    storyPoints: 100
                                }
                            ]
                        }
                    },
                    orphanStories: []
                }
            }
        ],
        duplicates: {},
        truncated: false,
        fallback: false
    };
}

test('EPM project board shows progress beside Jira rollup with hover story-point split', async ({ page }) => {
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'epm',
        epmTab: 'active',
        epmSelectedProjectId: '',
        selectedSprint: selectedSprintId,
        sprintName: selectedSprintName,
    });
    await installDashboardFixture(page, {
        connection: activeHomeTokenConnection(),
        allProjectsRollup: progressRollup,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const board = page.locator('.epm-project-board').filter({ hasText: 'Connected Home Project' });
    await expect(board).toHaveCount(1);
    const progress = board.locator('.epm-project-progress');
    await expect(progress).toBeVisible();
    await expect(progress.locator('.epm-project-progress-percent')).toHaveText('30%');
    const doneSegment = progress.locator('.epm-project-progress-segment-done');
    const inProgressSegment = progress.locator('.epm-project-progress-segment-in-progress');
    await expect(doneSegment).toHaveAttribute('style', /width: 30%;/);
    await expect(inProgressSegment).toHaveAttribute('style', /width: 30%;/);
    const statusPill = progress.locator('.epm-project-progress-status');
    await expect(statusPill).toHaveText('In Progress');
    await expect(statusPill).toHaveClass(/status-pill/);
    await expect(statusPill).toHaveClass(/task-status/);
    await expect(statusPill).toHaveClass(/in-progress/);
    await expect.poll(async () => (
        statusPill.evaluate((node) => getComputedStyle(node).animationName)
    )).toBe('none');
    await expect.poll(async () => (
        statusPill.evaluate((node) => getComputedStyle(node).textTransform)
    )).toBe('uppercase');
    await expect.poll(async () => (
        statusPill.evaluate((node) => getComputedStyle(node).fontFamily)
    )).toContain('IBM Plex Mono');
    await expect(progress).toHaveClass(/is-in-progress/);
    await expect(doneSegment).not.toHaveClass(/is-in-progress/);
    await expect(inProgressSegment).toHaveClass(/is-in-progress/);
    await expect.poll(async () => (
        doneSegment.evaluate((node) => getComputedStyle(node).animationName)
    )).toBe('none');
    await expect.poll(async () => (
        inProgressSegment.evaluate((node) => getComputedStyle(node).animationName)
    )).toBe('epmProjectProgressShimmer');

    await progress.hover();
    await expect(progress.locator('.epm-project-progress-tooltip')).toBeVisible();
    await expect(progress.locator('.epm-project-progress-tooltip')).toContainText('Completed 3.0 SP / Total 10.0 SP');
    await expect(progress.locator('.epm-project-progress-tooltip')).toContainText('In progress 3.0 SP · Waiting 4.0 SP');
});
