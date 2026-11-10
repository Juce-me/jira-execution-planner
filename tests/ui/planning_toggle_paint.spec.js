// #323 Task 8 Step 3: Story toggle to the next painted frame in Planning Table, head against the starting-head base.
// Opt-in, like the other runtime probes; the base tree must be extracted and built first (it is ignored output):
//   B=tmp/planning-323-every-team/toggle-base; mkdir -p $B && git archive 55ef631b | tar -x -C $B && (cd $B && npm ci && npm run build)
//   JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/planning_toggle_paint.spec.js --browser=chromium --workers=1
// Records p50/p95 only; no pass rule is set here (the operator signs off on the recorded numbers). Raw samples are written
// to tmp/planning-323-every-team/toggle-paint/. Synthetic data only; the host just scopes localStorage, never the live server.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_view_fixture');
const { createPlanningReviewMock } = require('./planning_review_mock');
const { buildRuntimeProbeBundle } = require('./runtime_probe_helpers');

const PROBE = process.env.JEP_RUNTIME_PROBE === '1';
const repoRoot = path.join(__dirname, '..', '..');
const roots = { head: repoRoot, base: path.join(repoRoot, 'tmp', 'planning-323-every-team', 'toggle-base') };
const outDir = path.join(repoRoot, 'tmp', 'planning-323-every-team', 'toggle-paint');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprint = { id: 3001, name: '2026Q2 Sprint 42', state: 'active', startDate: '2026-05-01' };
const futureSprint = { id: 4002, name: '2026Q3 Sprint 1', state: 'future', startDate: '2026-07-01' };
const COUNTS = [500, 2000, 5000];
const TOGGLES = 30;
const ROUNDS = 2; // Alternating runs per root and count: head, base, head, base.

test.skip(!PROBE, 'opt-in runtime probe (JEP_RUNTIME_PROBE=1)');
test.use({ viewport: { width: 1440, height: 900 } });

const epic = { id: '7001', key: 'PLAN-EPIC', summary: 'Synthetic epic', status: { name: 'In Progress' }, teamId: 'team-alpha', teamName: 'Alpha Team', labels: ['alpha_label'], sprint: [futureSprint] };
function synthetic(count) {
    return Array.from({ length: count }, (_, index) => {
        const person = index % 9, team = index % 10 === 9 ? 'team-beta' : 'team-alpha';
        return { id: String(10000 + index), key: `PLAN-${index + 10}`, fields: {
            summary: `PLAN-${index + 10} synthetic story`, status: { name: 'To Do' }, priority: { name: 'Major' }, issuetype: { name: 'Story' },
            assignee: person === 8 ? null : { accountId: `acc-p${person}`, displayName: `Person ${person} Synthetic` },
            customfield_10004: 1 + (index % 5), epicKey: 'PLAN-EPIC', parentSummary: 'Synthetic epic', projectKey: 'PLAN',
            teamId: team, teamName: team === 'team-alpha' ? 'Alpha Team' : 'Beta Team', sprint: [futureSprint],
        } };
    });
}

let bundles;
test.beforeAll(() => {
    if (!PROBE) return;
    for (const root of Object.values(roots)) if (!fs.existsSync(path.join(root, 'frontend', 'dist', 'dashboard.css'))) throw new Error(`build ${root} first (see the header)`);
    bundles = Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, buildRuntimeProbeBundle(root)]));
});

// Two Teams (no assignee strip), so both roots read the same capacity surface: the batch read at head, nothing extra at base.
async function install(page, name, issues) {
    await installDashboardShell(page);
    const planning = createPlanningReviewMock({ initialPlans: { [futureSprint.id]: { includedIssueIds: issues.map(issue => issue.id) } } });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(planning.response(route.request(), body, status)) });
    await page.addInitScript(() => window.history.replaceState(null, '', '/?perf=1'));
    await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), { selectedTeams: ['team-alpha', 'team-beta'], activeGroupId: 'group-alpha', planningLayout: 'table' });
    await page.route('**/api/**', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/epm/access') return json(route, { state: 'disabled', epmHomeReadAvailable: false });
        if (url.pathname === '/api/config') return json(route, { jiraUrl: 'https://jira.example', capacityProject: '', authMode: 'atlassian_oauth', epmViewEnabled: false, epmHomeReadAvailable: false,
            projectsConfigured: true, userCanEditSettings: true, environmentConfigExists: true,
            viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', version: 1, view: { selectedView: 'eng', selectedSprint: activeSprint.id, sprintName: activeSprint.name, activeGroupId: 'group-alpha', showPlanning: false, showScenario: false } } });
        if (url.pathname === '/api/capacity') return json(route, { enabled: true, mutationEnabled: false, sprint: url.searchParams.get('sprint'), capacities: { 'Alpha Team': 20 }, entries: [{ teamName: 'Alpha Team', issueKey: 'CAP-101', capacity: 20 }] });
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config') return json(route, { version: 1, configRevision: 1, source: 'workspace_db', defaultGroupId: 'group-alpha',
            groups: [{ id: 'group-alpha', name: 'Alpha Department', teamIds: ['team-alpha', 'team-beta'], labels: ['alpha_label'], excludedCapacityEpics: [] }],
            preferences: { onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'], customized: false, visibleGroupIds: [], effectiveVisibleGroupIds: ['group-alpha'], activeGroupId: 'group-alpha' } });
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '1', boardName: 'Synthetic board', configRevision: 1 });
        if (url.pathname === '/api/capacity/config') return json(route, { project: '', fieldId: '', fieldName: '', mutationEnabled: false, configRevision: 1 });
        if (/^\/api\/(sprint-field|parent-name-field|story-points-field|team-field|delivery-owner-field)\/config$/.test(url.pathname)) return json(route, { fieldId: '', fieldName: '', configRevision: 1 });
        if (url.pathname === '/api/issue-types/config') return json(route, { issueTypes: ['Story'], configRevision: 1 });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') return json(route, { sprints: [activeSprint, futureSprint] });
        if (url.pathname === '/api/tasks-with-team-name') {
            const product = url.searchParams.get('project') === 'product' && !url.searchParams.get('purpose');
            return json(route, { issues: product ? issues : [], epics: { [epic.key]: epic }, epicsInScope: product ? [epic] : [], names: {} });
        }
        if (/\/assignee-capacity\/planned\/read$/.test(url.pathname)) return json(route, { sprintId: String(futureSprint.id), capabilities: { canRead: true, canSave: true }, teams: [] });
        if (/\/assignee-capacity$/.test(url.pathname)) return json(route, { teamId: 'team-alpha', sprintId: String(futureSprint.id), revision: 0, rows: [], inherited: null, capabilities: { canRead: true, canSave: true } });
        if (/^\/api\/eng\/sprints\/[^/]+\/review$/.test(url.pathname)) return json(route, { schemaVersion: 1, sprintId: String(futureSprint.id), schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: true } });
        if (/\/review\/values\/read$/.test(url.pathname)) return json(route, { cells: [], unavailableIssueIds: [] });
        if (url.pathname === '/api/eng/story-readiness') return json(route, { schemaVersion: 1, complete: true, scope: { groupId: url.searchParams.get('groupId'), sprintId: url.searchParams.get('sprint'), sprintName: url.searchParams.get('sprintName'), sprintState: url.searchParams.get('sprintState') }, epics: [] });
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: bundles[name] }));
    // Each root paints with its own built stylesheet.
    const css = fs.readFileSync(path.join(roots[name], 'frontend', 'dist', 'dashboard.css'), 'utf8');
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
}

async function openTableStories(page) {
    await page.goto(appBaseUrl);
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await expect(toggle).toHaveAttribute('aria-disabled', 'false');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprint.name }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    // The plan must have loaded (the checkbox is enabled), or a large table's first click lands on a disabled box.
    await expect(page.locator('.planning-review-table tbody input[type=checkbox]').first()).toBeEnabled({ timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
}

// One toggle: click the first Story checkbox inside the page and wait two animation frames, so the time covers the
// React update and the next painted frame. The checkbox must flip each time.
async function toggleSamples(page) {
    return page.evaluate(async count => {
        const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = () => document.querySelector('.planning-review-table tbody input[type=checkbox]');
        const samples = [];
        for (let index = 0; index < count; index += 1) {
            const was = box().checked;
            await nextPaint();
            const started = performance.now();
            box().click();
            await nextPaint();
            samples.push(performance.now() - started);
            if (box().checked === was) throw new Error(`toggle ${index} did not change the checkbox`);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return samples;
    }, TOGGLES);
}

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

for (const count of COUNTS) for (let round = 0; round < ROUNDS; round += 1) for (const name of ['head', 'base']) {
    test(`Story toggle to paint: ${count} Stories, ${name}, run ${round + 1}`, async ({ page }, testInfo) => {
        test.setTimeout(300000);
        await install(page, name, synthetic(count));
        await openTableStories(page);
        const samples = await toggleSamples(page);
        expect(samples).toHaveLength(TOGGLES);
        const result = { root: name, commit: name === 'base' ? '55ef631b' : 'head', count, run: round + 1, toggles: TOGGLES,
            p50: percentile(samples, 50), p95: percentile(samples, 95), samples };
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${count}-${name}-run${round + 1}.json`), JSON.stringify(result, null, 2));
        console.log('TOGGLE_PAINT', JSON.stringify({ root: name, count, run: round + 1, p50: result.p50, p95: result.p95 }));
        testInfo.annotations.push({ type: 'toggle-paint', description: JSON.stringify({ root: name, count, run: round + 1, p50: result.p50, p95: result.p95 }) });
    });
}
