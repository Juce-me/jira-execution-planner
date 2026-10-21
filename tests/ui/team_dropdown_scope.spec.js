const { test, expect } = require('@playwright/test');
const {
    appBaseUrl, SPRINT_ID, SPRINT_NAME, GROUP_ID, deferred, groupsConfigPayload, mockDashboard, catchUpPrefs, openCatchUp,
} = require('./eng_epic_refresh_fixture');

// The Teams dropdown lists "All Teams" first and then teams alphabetically, and offers only teams that have a Story or an
// awaited Story in the selected Sprint. Team ids equal their names so the synthetic fixture needs no team catalog.
const TEAM_IDS = ['R&D Distribution', 'R&D Perimeter', 'R&D AAEW', 'R&D Reliability', 'R&D Renovation'];

const readinessPayload = () => ({
    schemaVersion: 1,
    complete: true,
    scope: { groupId: GROUP_ID, sprintId: String(SPRINT_ID), sprintName: SPRINT_NAME, sprintState: 'active' },
    epics: [{
        key: 'EPIC-9', summary: 'Epic awaiting a Story', projectClass: 'product', projectKey: 'PROD',
        status: { name: 'In Progress' }, priority: { name: 'Major' },
        missingTeams: [{ id: 'R&D Reliability', name: 'R&D Reliability', reason: 'no_stories' }],
    }],
});

async function openDashboard(page, { holdReadiness = false } = {}) {
    const ctx = await mockDashboard(page);
    const readinessGate = deferred();
    ctx.respond('/api/groups-config', ({ json }) => json({
        ...groupsConfigPayload,
        groups: [{ ...groupsConfigPayload.groups[0], teamIds: TEAM_IDS }],
    }));
    ctx.respond('/api/eng/story-readiness', async ({ json }) => {
        if (holdReadiness) await readinessGate.promise;
        return json(readinessPayload());
    });
    // EPIC-2 belongs to AAEW; every other Story to Perimeter. Distribution and Renovation have no work at all.
    ctx.scenario.stories.forEach((story) => {
        const team = story.fields.epicKey === 'EPIC-2' ? 'R&D AAEW' : 'R&D Perimeter';
        story.fields.teamId = team;
        story.fields.teamName = team;
    });
    if (holdReadiness) {
        // openCatchUp waits for network idle, which a held readiness request would never reach.
        await page.addInitScript(value => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), catchUpPrefs());
        await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.task-item[data-task-key="E1-S12"]')).toBeAttached();
    } else await openCatchUp(page, ctx);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    return { ctx, releaseReadiness: readinessGate.resolve };
}

const teamNames = page => page.locator('.view-selector .team-dropdown-panel .team-dropdown-option').allTextContents();

async function openTeamDropdown(page) {
    await page.locator('.view-selector .team-dropdown-toggle').click();
    await expect(page.locator('.view-selector .team-dropdown-panel')).toBeVisible();
}

test('Teams dropdown lists teams alphabetically and only those with Stories or awaited Stories in the Sprint', async ({ page }) => {
    await openDashboard(page);
    await openTeamDropdown(page);

    await expect.poll(() => teamNames(page)).toEqual(['All Teams', 'R&D AAEW', 'R&D Perimeter', 'R&D Reliability']);
    const reliability = page.locator('.view-selector .team-dropdown-option', { hasText: 'R&D Reliability' });
    await reliability.locator('input').check(); // a normal click: the awaited-only team stays selectable
    await expect(reliability.locator('input')).toBeChecked();
});

test('Teams dropdown keeps every team, alphabetically, until the awaited Stories are known', async ({ page }) => {
    const { releaseReadiness } = await openDashboard(page, { holdReadiness: true });
    await openTeamDropdown(page);

    expect(await teamNames(page)).toEqual(['All Teams', 'R&D AAEW', 'R&D Distribution', 'R&D Perimeter', 'R&D Reliability', 'R&D Renovation']);
    releaseReadiness();
    await expect.poll(() => teamNames(page)).toEqual(['All Teams', 'R&D AAEW', 'R&D Perimeter', 'R&D Reliability']);
});

test('Teams dropdown filtering keeps the toggle width reservation and selection label', async ({ page }) => {
    await openDashboard(page);
    const toggle = page.locator('.view-selector .team-dropdown-toggle');
    // The hidden width label keeps measuring the longest configured team, so the toggle never resizes when options are dropped.
    await expect(toggle.locator('.team-dropdown-width-label')).toHaveText('R&D Distribution');
    await openTeamDropdown(page);
    const option = page.locator('.view-selector .team-dropdown-option', { hasText: 'R&D AAEW' });
    await option.locator('input').check();
    await page.mouse.click(8, 8);
    await expect(toggle.locator('.team-dropdown-selection-label')).toHaveText('R&D AAEW');
});
