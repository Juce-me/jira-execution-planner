const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const sprint = { id: 3001, name: 'Synthetic sprint', state: 'future' };
const columns = [{ id: 'doing', name: 'Doing', star: true, statuses: ['In Progress'], colour: '#597ef7' }, { id: 'ready', name: 'Ready', statuses: ['To Do'], colour: '#8c8c8c' }, { id: 'wrap', name: 'Wrap', statuses: ['Release'], colour: '#13c2c2' }];
const cases = [
    ['Catch Up Story', 'catch_up', 'story', 'SYNTH-1'],
    ['Catch Up subtask', 'catch_up', 'subtask', 'SYNTH-1-A'],
    ['Catch Up Epic', 'catch_up', 'epic', 'SYNTH-EPIC'],
    ['Planning list Story', 'list', 'story', 'SYNTH-1'],
    ['Planning list Epic', 'list', 'epic', 'SYNTH-EPIC'],
    ['Planning table Story', 'table', 'story', 'SYNTH-1'],
    ['Planning table Epic', 'table', 'epic', 'SYNTH-EPIC'],
    ['Board panel Story', 'board', 'story', 'SYNTH-1'],
    ['Board panel Epic', 'board', 'epic', 'SYNTH-EPIC'],
    ['Board drop', 'drop', 'epic', 'SYNTH-EPIC'],
];
async function fixture(page, surface) {
    const calls = [];
    const statuses = { 'SYNTH-EPIC': 'In Progress', 'SYNTH-1': 'To Do', 'SYNTH-2': 'To Do', 'SYNTH-1-A': 'To Do' };
    await installDashboardShell(page);
    await page.addInitScript(prefs => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs)), { selectedView: 'eng', selectedSprint: sprint.id, sprintName: sprint.name, activeGroupId: 'synthetic', planningLayout: surface === 'table' ? 'table' : 'list', showBoard: ['board', 'drop'].includes(surface), showPlanning: ['list', 'table'].includes(surface), showAlertsPanel: false });
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let body;
        try { body = request.postDataJSON(); } catch (_) { body = null; }
        calls.push({ pathname: url.pathname, method: request.method(), body });
        const json = payload => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'synthetic' });
        if (url.pathname === '/api/config') return json({ jiraUrl: 'https://jira.example.test', authMode: 'atlassian_oauth', userCanEditSettings: true, environmentConfigExists: true, projectsConfigured: true });
        if (url.pathname === '/api/groups-config') return json({ version: 1, configRevision: 1, defaultGroupId: 'synthetic', source: 'workspace_db', groups: [{ id: 'synthetic', name: 'Synthetic department', teamIds: ['synthetic-team'], labels: ['synthetic'], board: { columns } }], preferences: { onboardingDone: true, onboardingRequired: false, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], activeGroupId: 'synthetic', effectiveVisibleGroupIds: ['synthetic'] } });
        if (url.pathname === '/api/sprints') return json({ sprints: [sprint] });
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/tasks-with-team-name') {
            const epic = { key: 'SYNTH-EPIC', summary: 'Synthetic epic', status: statuses['SYNTH-EPIC'], teamId: 'synthetic-team', teamName: 'Synthetic team', sprint: [sprint] };
            const issues = ['SYNTH-1', 'SYNTH-2'].map(key => ({ id: key, key, fields: { summary: `${key} synthetic story`, status: { name: statuses[key] }, priority: { name: 'Major' }, issuetype: { name: 'Story' }, customfield_10004: 1, epicKey: epic.key, parentSummary: epic.summary, projectKey: 'SYNTH', teamId: 'synthetic-team', teamName: 'Synthetic team', sprint: [sprint], subtaskSummary: key === 'SYNTH-1' ? { total: 1, done: 0, inProgress: 0, waiting: 1, statusCounts: { 'To Do': 1 } } : null } }));
            return json(url.searchParams.get('project') === 'tech' || url.searchParams.get('purpose') ? { issues: [], epics: {}, epicsInScope: [], names: {} } : { issues, epics: { [epic.key]: epic }, epicsInScope: [epic], names: {} });
        }
        if (url.pathname === '/api/issues/subtasks') return json({ parentKey: 'SYNTH-1', subtasks: [{ key: 'SYNTH-1-A', summary: 'Synthetic subtask', status: { name: statuses['SYNTH-1-A'] }, issueType: 'Sub-task' }], summary: { total: 1, done: 0, waiting: 1, statusCounts: { 'To Do': 1 } } });
        if (url.pathname === '/api/issues/transitions/options') return json({ issues: [], targetStatuses: [{ name: 'Release', availableCount: 1, blockedCount: 0 }] });
        if (url.pathname === '/api/issues/transitions') {
            body.issueKeys.forEach(key => { statuses[key] = body.targetStatus; });
            return json({ requested: 1, succeeded: 1, failed: 0, targetStatus: body.targetStatus, results: body.issueKeys.map(key => ({ key, result: 'success', toStatus: body.targetStatus })) });
        }
        if (url.pathname === '/api/issues/description') return json({ key: 'SYNTH-EPIC', html: '<p>Synthetic description</p>', isEmpty: false });
        if (url.pathname === '/api/issues/statuses/catalog') return json({ statuses: ['To Do', 'In Progress', 'Release'].map(name => ({ name, statusCategoryKey: 'indeterminate' })) });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        return json({ enabled: false, connected: false, weights: [], capacity: [], teams: [], totalCapacity: 0 });
    });
    return { calls, statuses };
}
const trigger = (page, kind, key) => page.locator(`[data-status-transition-trigger][data-issue-kind="${kind}"][data-issue-key="${key}"]`);
for (const [label, surface, kind, key] of cases) {
    test(`${label} writes exactly its own issue and preserves every child/other issue`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const { calls, statuses } = await fixture(page, surface);
        await page.goto(appBaseUrl, { waitUntil: 'networkidle' });
        if (['list', 'table'].includes(surface)) {
            await expect(page.locator('.planning-panel.open')).toBeVisible();
            if (surface === 'list') await page.getByRole('button', { name: 'Select All', exact: true }).click();
            if (surface === 'table') {
                await page.getByRole('radio', { name: 'Stories', exact: true }).click();
                for (const storyKey of ['SYNTH-1', 'SYNTH-2']) await page.getByRole('checkbox', { name: `Select ${storyKey}`, exact: true }).check();
                if (kind === 'epic') await page.getByRole('radio', { name: 'Epics', exact: true }).click();
            }
        }
        if (surface === 'board') await page.locator('.ecard[data-epic-key="SYNTH-EPIC"]').click();
        if (kind === 'subtask') await page.locator('.task-item[data-task-key="SYNTH-1"] .story-subtasks-toggle').click();
        if (surface === 'drop') {
            await page.locator('.ecard[data-epic-key="SYNTH-EPIC"]').dragTo(page.locator('.col[data-column-id="wrap"]'));
        } else {
            await trigger(page, kind, key).click();
            await expect(page.locator(`.status-transition-menu[data-issue-key="${key}"]`)).toBeVisible();
            if (process.env.JEP_DESIGN_CAPTURE) {
                await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
                await page.mouse.move(0, 0);
                const dir = path.join(__dirname, '../../test-results/design-system-parity');
                fs.mkdirSync(dir, { recursive: true });
                const slug = label.toLowerCase().replaceAll(' ', '-');
                await page.screenshot({ path: path.join(dir, `${process.env.JEP_DESIGN_CAPTURE}-${slug}.png`), animations: 'disabled' });
                const geometry = await trigger(page, kind, key).evaluate(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { width: r.width, height: r.height, font: s.font, padding: s.padding, borderRadius: s.borderRadius, color: s.color, background: s.backgroundColor }; });
                fs.writeFileSync(path.join(dir, `${process.env.JEP_DESIGN_CAPTURE}-${slug}.json`), JSON.stringify(geometry, null, 2));
            }
            await page.locator(`.status-transition-menu[data-issue-key="${key}"]`).getByRole('menuitem', { name: 'Release', exact: true }).click();
        }
        await expect.poll(() => calls.filter(c => c.method === 'POST' && c.pathname === '/api/issues/transitions').length).toBe(1);
        expect(calls.filter(c => c.method === 'POST' && c.pathname === '/api/issues/transitions')[0].body).toEqual({ issueKeys: [key], targetStatus: 'Release' });
        if (surface === 'table' && kind === 'epic') await page.getByRole('radio', { name: 'Stories', exact: true }).click();
        if (surface === 'drop') await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up', exact: true }).click();
        for (const otherKey of ['SYNTH-1', 'SYNTH-2']) {
            await expect(trigger(page, 'story', otherKey)).toContainText(otherKey === key ? 'Release' : 'To Do');
        }
        if (kind === 'subtask') await expect(trigger(page, kind, key)).toContainText('Release');
        expect(statuses).toEqual({ 'SYNTH-EPIC': key === 'SYNTH-EPIC' ? 'Release' : 'In Progress', 'SYNTH-1': key === 'SYNTH-1' ? 'Release' : 'To Do', 'SYNTH-2': 'To Do', 'SYNTH-1-A': key === 'SYNTH-1-A' ? 'Release' : 'To Do' });
    });
}
