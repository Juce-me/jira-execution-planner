const { test, expect } = require('@playwright/test');
const {
    activeHomeTokenConnection,
    appBaseUrl,
    installDashboardFixture,
    selectedSprintId,
    selectedSprintName,
} = require('./epm_home_token_fixture');

function populatedRollup(project) {
    return {
        projects: [populatedProjectRollup(project)],
        duplicates: {},
        truncated: false,
        fallback: false,
    };
}

function populatedProjectRollup(project) {
    return {
        project,
        rollup: {
            metadataOnly: false,
            emptyRollup: false,
            truncated: false,
            truncatedQueries: [],
            initiatives: {},
            rootEpics: {
                'EPM-100': {
                    issue: {
                        key: 'EPM-100',
                        summary: 'EPM compatibility epic with populated stories',
                        status: 'In Progress',
                        issueType: 'Epic',
                        assignee: 'Portfolio Owner',
                    },
                    stories: [
                        {
                            key: 'EPM-101',
                            summary: 'Visible EPM story keeps default issue-card spacing',
                            status: 'In Progress',
                            issueType: 'Story',
                            priority: 'High',
                            storyPoints: 3,
                            assignee: 'EPM Engineer',
                            updated: '2026-05-22T10:00:00.000Z',
                        },
                        {
                            key: 'EPM-102',
                            summary: 'Second visible EPM story keeps default row rhythm',
                            status: 'To Do',
                            issueType: 'Story',
                            priority: 'Medium',
                            storyPoints: 5,
                            assignee: 'EPM Engineer',
                            updated: '2026-05-21T10:00:00.000Z',
                        },
                    ],
                },
            },
            orphanStories: [],
        },
    };
}

async function expectDefaultIssueCardDensity(page, screenshotPath) {
    const board = page.locator('.epm-issue-board');
    await expect(board).toHaveCount(1);
    await expect(board.locator('.epic-block')).toBeVisible();
    const firstStory = board.locator('.task-item[data-task-key="EPM-101"]');
    await expect(firstStory).toBeVisible();

    const styles = await firstStory.evaluate((node) => {
        const style = window.getComputedStyle(node);
        const titleStyle = window.getComputedStyle(node.querySelector('.task-title'));
        return {
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            marginBottom: style.marginBottom,
            titleFontSize: titleStyle.fontSize,
        };
    });
    expect(styles.paddingTop).toBe('16px');
    expect(styles.paddingRight).toBe('20px');
    expect(styles.paddingBottom).toBe('16px');
    expect(styles.paddingLeft).toBe('20px');
    expect(styles.marginBottom).toBe('14.4px');
    expect(styles.titleFontSize).toBe('16.8px');

    await page.screenshot({ path: screenshotPath, fullPage: false });
}

test('EPM portfolio issue board keeps default IssueCard density when ENG compact CSS is present', async ({ page }) => {
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
        allProjectsRollup: populatedRollup,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await expectDefaultIssueCardDensity(page, '/tmp/epm-issue-board-compact-scope.png');
});

test('EPM selected-project issue board keeps default IssueCard density when ENG compact CSS is present', async ({ page }) => {
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
        allProjectsRollup: () => ({
            projects: [],
            duplicates: {},
            truncated: false,
            fallback: false,
        }),
        projectRollup: (project) => populatedProjectRollup(project).rollup,
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Select Project' }).click();
    await page.locator('.sprint-dropdown-option[data-project-id="home-1"]').click();
    await expectDefaultIssueCardDensity(page, '/tmp/epm-selected-issue-board-compact-scope.png');
});
