const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const secondFutureSprintId = 5003;
const secondFutureSprintName = '2026Q3 Sprint 2';
const completedSprintId = 2001;
const completedSprintName = '2026Q1 Sprint 9';
const groupTeamIds = ['team-alpha'];
let dashboardJs;

test.beforeAll(() => {
    fs.mkdirSync(path.join(repoRoot, 'tmp', '217-ui'), { recursive: true });
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    dashboardJs = result.outputFiles[0].text;
});

function json(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function requestBody(request) {
    try {
        return request.postDataJSON();
    } catch (err) {
        return null;
    }
}

function makeStory(key, status, sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        id: String(8000 + Number(key.split('-').pop())),
        key,
        fields: {
            summary: `${key} synthetic future planning story`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            customfield_10004: 1,
            epicKey,
            parentSummary: 'Future planning epic',
            projectKey: 'PLAN',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
        },
    };
}

function makeEpic(sprintId = futureSprintId, sprintName = futureSprintName, epicKey = 'PLAN-EPIC') {
    return {
        id: '7001',
        key: epicKey,
        summary: 'Future planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: sprintId, name: sprintName, state: 'future' }],
    };
}

const futureStories = [
    makeStory('PLAN-1', 'To Do'),
    makeStory('PLAN-2', 'Pending'),
    makeStory('PLAN-3', 'Accepted'),
];
const secondFutureStories = [
    makeStory('PLAN-4', 'To Do', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
    makeStory('PLAN-5', 'Accepted', secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2'),
];
const completedStories = [
    makeStory('PLAN-1', 'Done', completedSprintId, completedSprintName),
    makeStory('PLAN-2', 'Done', completedSprintId, completedSprintName),
];

async function installPlanningFixture(page, {
    taskFailureMode = '',
    delayConfig = false,
    shellAuthDependency = '',
    onboardingRequired = false,
    authMode = 'basic',
    summary = '',
    scopeTeamIds = groupTeamIds,
    capacityProject = '',
    planningLayout = 'list',
    longTable = false,
} = {}) {
    const calls = [];
    let futureProductTaskAttempts = 0;
    let releaseConfig;
    const configRelease = delayConfig
        ? new Promise(resolve => { releaseConfig = resolve; })
        : Promise.resolve();
    let releaseShellAuth;
    const shellAuthRelease = shellAuthDependency
        ? new Promise(resolve => { releaseShellAuth = resolve; })
        : Promise.resolve();
    let groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{
            id: 'group-alpha',
            name: 'Alpha Department',
            teamIds: scopeTeamIds,
            labels: ['alpha_label'],
            excludedCapacityEpics: []
        }],
        preferences: {
            onboardingRequired,
            onboardingDone: !onboardingRequired,
            completedOnboardingModules: onboardingRequired
                ? []
                : ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            customized: false,
            visibleGroupIds: [],
            effectiveVisibleGroupIds: ['group-alpha'],
            activeGroupId: 'group-alpha',
        },
    };

    await installDashboardShell(page);
    if (planningLayout) await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({planningLayout: value})), planningLayout);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dashboardJs,
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const body = request.method() === 'POST' ? requestBody(request) : null;
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
            headers: request.headers(),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/me/connections/home-token') {
            if (shellAuthDependency === 'home-token') {
                await shellAuthRelease;
                return json(route, {
                    error: 'auth_required',
                    loginUrl: '/login?reason=session_expired',
                }, 401);
            }
            return json(route, {
                connected: false,
                provider: 'atlassian_user_api_token',
                status: 'missing',
                needsReconnect: false,
            });
        }
        if (url.pathname === '/api/config') {
            await configRelease;
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject,
                authMode,
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
                viewConfig: {
                    workspaceId: 'workspace-test',
                    viewConfigId: 'view-test',
                    version: 1,
                    view: {
                        selectedView: 'eng',
                        selectedSprint: activeSprintId,
                        sprintName: activeSprintName,
                        activeGroupId: 'group-alpha',
                        showPlanning: false,
                        showScenario: false,
                    },
                },
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') {
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            const payload = requestBody(request);
            if (payload.baseRevision !== groupsConfigPayload.configRevision) {
                return json(route, { error: 'group_config_conflict', current: groupsConfigPayload }, 409);
            }
            groupsConfigPayload = {
                version: payload.version || 1,
                source: 'workspace_db',
                configRevision: groupsConfigPayload.configRevision + 1,
                defaultGroupId: payload.defaultGroupId || '',
                groups: payload.groups || [],
                preferences: groupsConfigPayload.preferences,
            };
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [
                    { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                    { id: completedSprintId, name: completedSprintName, state: 'closed', startDate: '2026-03-01' },
                    { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                    { id: secondFutureSprintId, name: secondFutureSprintName, state: 'future', startDate: '2026-07-15' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const sprint = url.searchParams.get('sprint');
            if (project === 'product' && !purpose && String(sprint) === String(futureSprintId)) {
                futureProductTaskAttempts += 1;
                if (taskFailureMode === 'non-auth-once' && futureProductTaskAttempts === 1) {
                    return json(route, { error: 'synthetic_task_failure' }, 500);
                }
                if (taskFailureMode === 'auth-required') {
                    return json(route, {
                        error: 'auth_required',
                        loginUrl: '/login?reason=session_expired',
                    }, 401);
                }
            }
            const issues = project === 'product' && !purpose
                ? (String(sprint) === String(secondFutureSprintId)
                    ? secondFutureStories
                    : String(sprint) === String(completedSprintId) ? completedStories : longTable ? Array.from({length:60},(_,i)=>makeStory(`PLAN-${i+1}`,'To Do')) : futureStories)
                : [];
            const epic = String(sprint) === String(secondFutureSprintId)
                ? makeEpic(secondFutureSprintId, secondFutureSprintName, 'PLAN-EPIC-2')
                : String(sprint) === String(completedSprintId)
                    ? makeEpic(completedSprintId, completedSprintName)
                    : makeEpic();
            if (summary) epic.summary=summary;
            return json(route, {
                issues: summary ? issues.map(issue=>({...issue,fields:{...issue.fields,summary}})) : issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return {
        calls,
        getGroupsConfig: () => groupsConfigPayload,
        getFutureProductTaskAttempts: () => futureProductTaskAttempts,
        releaseConfig: () => releaseConfig?.(),
        releaseShellAuth: () => releaseShellAuth?.(),
    };
}


async function openPlanning(page, { expectStories = true } = {}) {
    await page.goto(appBaseUrl);
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await expect(toggle).toHaveAttribute('aria-disabled', 'false');
    await toggle.click();
    await page.locator('.sprint-dropdown-option', { hasText: futureSprintName }).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
    if (expectStories) await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}
async function bounds(page) {
    return page.evaluate(() => Object.fromEntries(['.header', '.planning-panel', '.filters-strip'].map(selector => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return [selector, r ? { x:r.x, width:r.width, y:r.y, height:r.height } : null];
    })));
}
test('Planning switch preserves selection, header geometry and loaded datasets', async ({ page }) => {
    const fixture = await installPlanningFixture(page);
    await page.route('**/api/eng/sprints/*/review', route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false,reason:'Shared review saving requires database-backed OAuth.'} }));
    await openPlanning(page);
    const before = await bounds(page);
    const loads = fixture.calls.filter(call => ['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies','/api/eng/board'].includes(call.pathname)).length;
    const selected = await page.locator('.task-list input.task-checkbox:checked').count();
    await page.screenshot({ path:'tmp/217-ui/planning-review-list-before.png',fullPage:true });
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await expect(page.getByRole('region',{name:'Planning Sprint review'})).toBeVisible();
    const after=await bounds(page);
    expect(after['.header']).toEqual(before['.header']);
    expect(after['.planning-panel'].x).toBe(before['.planning-panel'].x);expect(after['.planning-panel'].width).toBe(before['.planning-panel'].width);
    await expect(page.locator('.planning-panel')).toHaveClass(/planning-panel-compact/);
    expect(fixture.calls.filter(call => ['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies','/api/eng/board'].includes(call.pathname)).length).toBe(loads);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    expect(await page.locator('.planning-review-table tbody input[type=checkbox]:checked').count()).toBe(selected);
    // Without a saving-capable profile the column controls are present but disabled, as the old + Column button was.
    await expect(page.getByRole('button',{name:'+ Add column',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Status column options',exact:true})).toBeDisabled();
    await page.screenshot({ path:'tmp/217-ui/planning-review-table-after.png',fullPage:true });
    await page.getByRole('button',{name:'Show panel',exact:true}).click();
    await page.getByRole('button',{name:'Clear Selected',exact:true}).click();
    await expect(page.getByRole('button',{name:'Show Planning list',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Show Planning list',exact:true}).click();
    await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    expect(await page.locator('.task-list input.task-checkbox:checked').count()).toBe(0);
});

test('the app-header Refresh also reloads the shared review', async ({ page }) => {
    await installPlanningFixture(page);
    let reads = 0;
    await page.route('**/api/eng/sprints/*/review', route => { reads += 1; return json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }); });
    await page.route('**/api/eng/sprints/*/review/values/read', route => json(route, {cells:[],unavailableIssueIds:[]}));
    await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await expect.poll(() => reads).toBeGreaterThan(0);
    // A review that is still loading is already current, so the header Refresh leaves it alone; wait for it to settle first.
    await expect(page.locator('.planning-review-state-note',{hasText:'Loading…'})).toHaveCount(0);
    const before = reads;
    await page.getByRole('button',{name:'Refresh tasks and sprints from Jira',exact:true}).click();
    await expect.poll(() => reads).toBeGreaterThan(before);
});

test('dirty noninitial Sprint review survives Jira catalog refresh and guards an explicit Sprint change', async ({ page }) => {
    await installPlanningFixture(page);
    await page.route('**/api/eng/sprints/*/review', route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }));
    await page.route('**/api/eng/sprints/*/review/values/read', route => json(route, {cells:[],unavailableIssueIds:[]}));
    await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Synthetic review');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save review',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Refresh tasks and sprints from Jira',exact:true}).click();
    await expect(page.locator('.sprint-dropdown').first()).toContainText('2026Q3');
    await expect(page.getByRole('textbox',{name:'Synthetic review for PLAN-EPIC',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save review',exact:true})).toBeEnabled();
    const toggle = page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
    await toggle.click();
    await page.locator('.sprint-dropdown-option',{hasText:secondFutureSprintName}).click();
    await expect(page.getByRole('dialog',{name:'Save this Sprint review?'})).toBeVisible();
    await page.getByRole('button',{name:'Stay',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Synthetic review for PLAN-EPIC',exact:true})).toBeVisible();
});

test('catalog capability loss preserves drafts and recovery invalidates a queued scope clear', async ({ page }) => {
    await installPlanningFixture(page);
    let unavailable = false;
    await page.route('**/api/sprints*', route => unavailable
        ? json(route, {error:'sprint_board_required'}, 409)
        : json(route, {sprints:[{id:activeSprintId,name:activeSprintName,state:'active'},{id:futureSprintId,name:futureSprintName,state:'future'}],cache:{backend:'postgresql',identity:'sc1:synthetic-board',browserContextId:'bc1:synthetic-actor',catalogVersion:1,validatedAt:'2026-10-01T09:00:00Z'}}));
    await page.route('**/api/eng/sprints/*/review', route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }));
    await page.route('**/api/eng/sprints/*/review/values/read', route => json(route, {cells:[],unavailableIssueIds:[]}));
    await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Preserved draft');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    unavailable = true;
    await page.getByRole('button',{name:'Refresh tasks and sprints from Jira',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Save this Sprint review?'})).toBeVisible();
    unavailable = false;
    // Simulate a concurrent external catalog refresh finishing while the leave
    // decision remains pending, rather than interacting through the modal.
    await page.evaluate(() => document.querySelector('[aria-label="Refresh tasks and sprints from Jira"]').click());
    await expect(page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle')).toHaveAttribute('aria-disabled','false');
    await page.getByRole('dialog',{name:'Save this Sprint review?'}).getByRole('button',{name:'Discard',exact:true}).click();
    await expect(page.locator('.sprint-dropdown').first()).toContainText('2026Q3');
    await expect(page.getByRole('region',{name:'Planning Sprint review'})).toBeVisible();
});

test('review 401 locks the mounted dashboard and never replays the failed read', async ({ page }) => {
    await installPlanningFixture(page);
    let reviewReads = 0;
    await page.route('**/api/eng/sprints/*/review', route => {
        reviewReads++;
        return json(route, {error:'auth_required',loginUrl:'https://unsafe.example/login'}, 401);
    });
    await openPlanning(page);
    const selected = await page.locator('.task-list input.task-checkbox:checked').count();
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await expect(page.getByRole('alertdialog').getByRole('link',{name:'Sign in again'})).toHaveAttribute('href','/login?reason=session_expired');
    await expect(page.getByRole('region',{name:'Planning Sprint review',includeHidden:true})).toHaveCount(1);
    expect(await page.locator('.planning-review-table tbody input[type=checkbox]:checked').count()).toBe(selected > 0 ? 1 : 0);
    await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(reviewReads).toBe(1);
});

for (const authMode of ['basic', 'atlassian_oauth']) test(`table status chips retain shared presentation in ${authMode}`, async ({ page }) => {
    await installPlanningFixture(page, {authMode});
    await page.route('**/api/eng/sprints/*/review', route => json(route, {schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    const chip = page.locator('.planning-review-status .task-status').first();
    await expect(chip).toBeVisible();
    expect(await chip.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(30);
    await expect(chip).toHaveCSS('background-color','rgb(105, 192, 255)');
    if (authMode === 'atlassian_oauth') {
        await page.locator('.planning-review-scroll').evaluate(node=>node.scrollIntoView({block:'center'}));
        await chip.hover();
        await expect(chip).toHaveCSS('background-color','rgb(105, 192, 255)');
        await expect(chip).toHaveCSS('transform','none');
    }
});

 test('Stories expose Epic and explicit metadata, totals stay visible and Story Points save through Jira editor', async ({page}) => {
    await installPlanningFixture(page,{authMode:'atlassian_oauth'});
    await page.route('**/api/eng/sprints/*/review',route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    let saved;
    await page.route('**/api/issues/PLAN-1/editable-fields?*',route=>json(route,{editable:true,currentValue:1,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    await page.route('**/api/issues/PLAN-1/field',route=>{saved=route.request().postDataJSON();return json(route,{value:saved.value,result:'updated',mappingRevision:'synthetic'});});
    await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const table=page.locator('.planning-review-table');
    const points=table.locator('tbody tr').filter({has:page.getByRole('link',{name:'PLAN-1',exact:true})}).getByRole('textbox',{name:'Story Points',exact:true});
    await points.click();
    await expect(points).not.toHaveAttribute('readonly','');
    await points.fill('3');
    await expect(table.getByRole('button',{name:/^(Save|Cancel) Story Points/})).toHaveCount(0);
    await page.screenshot({path:'tmp/217-ui/planning-review-story-points-editor.png',fullPage:true});
    await points.press('Enter');
    await expect.poll(()=>saved?.value).toBe(3);
    await expect(points).toHaveValue('3');
    await points.click();await points.fill('5');
    await points.press('Escape');
    await expect(points).toHaveValue('3');
    expect(saved.value).toBe(3);
    for(const name of ['Epic','Assignee']) await expect(table.getByRole('columnheader',{name,exact:true})).toBeVisible();
    for(const name of ['Component','Project','Capacity','Project Track']) await expect(table.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    await expect(table.getByRole('columnheader',{name:'Fields',exact:true})).toHaveCount(0);
    await expect(table.locator('tbody .planning-review-epic').first().getByRole('link',{name:'Future planning epic',exact:true})).toHaveAttribute('href',/\/browse\/PLAN-EPIC$/);
    await expect(table.locator('tfoot .planning-review-selection')).toBeInViewport();
});

for (const authMode of ['basic','atlassian_oauth']) for(const width of [390,1280]) test(`summaries truncate and reveal the full text without losing editing in ${authMode} at ${width}px`, async ({page})=>{
    const summary='[D] Adding new fields in logs and updating the migration implementation for the next sprint review';
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{authMode,summary});
    await page.route('**/api/eng/sprints/*/review',route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',route=>json(route,{editable:true,currentValue:summary,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    await openPlanning(page);await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    const cell=page.locator('tbody .planning-review-summary').first();
    if(authMode==='atlassian_oauth') await expect(cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true})).toHaveText(summary);
    else await expect(cell).toHaveText(summary);
    const value=cell.locator('.planning-review-truncated-value');
    const target=authMode==='atlassian_oauth'?cell.locator('.issue-summary-editor-trigger'):value;
    expect(await target.evaluate(node=>({clipped:node.scrollWidth>node.clientWidth+1,ellipsis:getComputedStyle(node).textOverflow,whiteSpace:getComputedStyle(node).whiteSpace}))).toEqual({clipped:true,ellipsis:'ellipsis',whiteSpace:'nowrap'});
    await target.hover();const readout=page.getByRole('tooltip').filter({hasText:summary});await expect(readout).toBeVisible();
    expect(await readout.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&node.contains(document.elementFromPoint(r.left+5,r.top+5));})).toBe(true);
    await target.focus();await expect(readout).toBeVisible();await target.press('Escape');await expect(readout).toHaveCount(0);
    if(authMode==='atlassian_oauth'){
        const trigger=cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true});
        await trigger.focus();await trigger.press('Enter');
        const editor=page.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});await expect(editor).toHaveValue(summary);await expect(readout).toHaveCount(0);await editor.press('Escape');await expect(trigger).toBeFocused();
    }
    await page.screenshot({path:`tmp/217-ui/planning-review-summary-${authMode}-${width}.png`,fullPage:true});
});

for(const width of [390,1280]) test(`Summary edits inside its cell with Enter, blur and Escape at ${width}px`,async({page})=>{
    const summary='Original summary';let saved=[];
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{authMode:'atlassian_oauth',summary});
    await page.route('**/api/eng/sprints/*/review',route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',route=>json(route,{editable:true,currentValue:saved.at(-1)||summary,mappingRevision:'synthetic',baseUpdated:'synthetic'}));
    await page.route('**/api/issues/PLAN-EPIC/field',route=>{saved.push(route.request().postDataJSON().value);return json(route,{value:saved.at(-1),result:'updated',mappingRevision:'synthetic'});});
    await openPlanning(page);await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await page.locator('.planning-review-region').evaluate(node=>node.scrollIntoView({block:'start'}));
    const cell=page.locator('tbody .planning-review-summary').first();
    const trigger=cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true});
    const editor=cell.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});
    await trigger.click();await expect(editor).toBeEditable();
    await expect(page.getByRole('button',{name:'Save summary',exact:true})).toHaveCount(0);
    const bounds=await editor.boundingBox(),cellBounds=await cell.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(cellBounds.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(cellBounds.x+cellBounds.width);expect(bounds.width).toBeGreaterThan(cellBounds.width-24);
    await editor.fill('A long summary that should wrap across the full width of the editable cell without opening a floating panel or stretching beyond the column boundary.');
    expect(await editor.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThan(30);
    expect(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    await editor.fill('Edited in the cell');await page.screenshot({path:`tmp/217-ui/inline-summary-${width}.png`,fullPage:true});await editor.press('Enter');
    await expect(trigger).toHaveText('Edited in the cell');expect(saved).toEqual(['Edited in the cell']);
    await trigger.click();await expect(editor).toBeEditable();await editor.fill('Cancelled draft');await editor.press('Escape');
    await expect(trigger).toHaveText('Edited in the cell');await expect(trigger).toBeFocused();expect(saved).toHaveLength(1);
    await trigger.click();await expect(editor).toBeEditable();await editor.fill('');await editor.press('Enter');
    await expect(cell.getByRole('alert')).toContainText('1–255');expect(saved).toHaveLength(1);
    await editor.fill('Saved on blur');await page.locator('thead th.planning-review-selection').click({position:{x:2,y:2}});
    await expect(trigger).toHaveText('Saved on blur');expect(saved).toEqual(['Edited in the cell','Saved on blur']);
});

test('Summary conflict stays inside the cell and reloads before another edit',async({page})=>{
    let writes=0,reads=0;await installPlanningFixture(page,{authMode:'atlassian_oauth',summary:'Original summary'});
    await page.route('**/api/eng/sprints/*/review',route=>json(route,{schemaRevision:0,columns:[],capabilities:{canRead:false,canSave:false}}));
    await page.route('**/api/issues/PLAN-EPIC/editable-fields?*',route=>{reads++;return json(route,{editable:true,currentValue:reads===1?'Original summary':'Current Jira summary',mappingRevision:'synthetic',baseUpdated:'synthetic'});});
    await page.route('**/api/issues/PLAN-EPIC/field',route=>{writes++;return json(route,{error:'stale_issue'},409);});
    await openPlanning(page);await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    const cell=page.locator('tbody .planning-review-summary').first();
    await cell.getByRole('button',{name:'Edit summary for PLAN-EPIC',exact:true}).click();
    const editor=cell.getByRole('textbox',{name:'Summary for PLAN-EPIC',exact:true});
    await expect(editor).toBeEditable();await editor.fill('My draft');await editor.press('Enter');
    await expect(cell.getByRole('alert')).toContainText('changed in Jira');await expect(editor).toHaveValue('My draft');await expect(editor).not.toBeEditable();
    await editor.press('Enter');expect(writes).toBe(1);
    await cell.getByRole('button',{name:'Reload field',exact:true}).click();await expect(editor).toHaveValue('Current Jira summary');await expect(editor).toBeEditable();
    await editor.press('Escape');expect(writes).toBe(1);
});

test('table shows readiness-only Epics and placeholders when no Jira Stories exist',async({page})=>{
    await installPlanningFixture(page,{authMode:'basic'});
    await page.route('**/api/tasks-with-team-name?*',route=>json(route,{issues:[],epics:{},epicsInScope:[],names:{}}));
    await installUncreatedReadiness(page);
    await openPlanning(page,{expectStories:false});await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    const table=page.locator('.planning-review-table');
    await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);await expect(table).toContainText('1 Story awaited');
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const placeholder=table.locator('tbody tr').filter({hasText:'Story awaiting creation for Alpha Team'});
    await expect(placeholder).toHaveCount(1);await expect(placeholder).toContainText('Awaiting creation');await expect(placeholder.getByRole('checkbox')).toBeDisabled();
    await expect(placeholder.getByRole('link',{name:'Epic awaiting Stories',exact:true})).toHaveCount(1);await expect(table.locator('tfoot .planning-review-storyPoints')).toHaveText('0');
});

async function installUncreatedReadiness(page) {
    await page.route('**/api/eng/story-readiness?*',route=>{const params=new URL(route.request().url()).searchParams;return json(route,{schemaVersion:1,complete:true,scope:{groupId:params.get('groupId'),sprintId:params.get('sprint'),sprintName:params.get('sprintName'),sprintState:params.get('sprintState')},epics:[{id:'7999',key:'PLAN-EMPTY',summary:'Epic awaiting Stories',projectClass:'product',status:{name:'To Do'},missingTeams:[{id:'team-alpha',name:'Alpha Team',reason:'no_stories'}]}]});});
}

test('table keeps uncreated Stories through Story filters while List retains its filtering',async({page})=>{
    await installPlanningFixture(page,{authMode:'basic'});await installUncreatedReadiness(page);await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    const table=page.locator('.planning-review-table');await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);
    await page.locator('.filterbar .fb-trigger').click();
    const status=page.locator('.popover [data-facet="status"]');
    await status.locator('[data-option="Pending"]').click();
    await page.locator('.filterbar .fb-trigger').click();
    await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();await expect(table).toContainText('Story awaiting creation for Alpha Team');
    await expect(table.locator('tbody .planning-review-key').filter({hasText:'PLAN-2'})).toHaveCount(0);
    await page.getByRole('button',{name:'Show Planning list',exact:true}).click();
    await expect(page.locator('.task-list a[href$="/browse/PLAN-EMPTY"]')).toHaveCount(0);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();await expect(table.getByRole('link',{name:'PLAN-EMPTY',exact:true})).toHaveCount(1);
});

for(const scopeTeamIds of [['team-alpha'],['team-alpha','team-beta']]) test(`Table sticky summary compacts ${scopeTeamIds.length} Team scope and expands without losing selection`,async({page})=>{
    const fixture=await installPlanningFixture(page,{scopeTeamIds,capacityProject:'CAP'});
    await page.route('**/api/capacity?*',route=>json(route,{enabled:true,mutationEnabled:false,sprint:new URL(route.request().url()).searchParams.get('sprint'),capacities:{'Alpha Team':10,'Beta Team':8},entries:[{teamName:'Alpha Team',issueKey:'CAP-101',capacity:10},{teamName:'Beta Team',issueKey:'CAP-102',capacity:8}]}));
    await openPlanning(page);
    const panel=page.locator('.planning-panel');
    const selected=await page.locator('.task-list input.task-checkbox:checked').count();
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await expect(panel).toHaveClass(/planning-panel-compact/);await expect(panel.getByRole('button',{name:'Select All',exact:true})).toHaveCount(0);
    const row=await panel.boundingBox();expect(row.height).toBeLessThan(64);
    await expect(panel.locator('.capacity-bar-graph')).toHaveCount(1);
    for(const readout of await panel.locator('.planning-compact-readout').all()) expect(await readout.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    for(const selector of ['.capacity-bar-fill','.project-bar-fill.product']) {
        const fill=panel.locator(selector).first();await fill.hover();
        await page.screenshot({path:`tmp/217-ui/bar-hover-${scopeTeamIds.length}-${selector.includes('product')?'project':'capacity'}.png`});
        const label=fill.locator('..').locator('.planning-compact-readout');
        expect(await label.evaluate(node=>{
            // Include the normally pointer-transparent label in paint-order hit testing.
            node.style.pointerEvents='auto';
            const r=node.getBoundingClientRect();
            const top=document.elementFromPoint(r.left+4,r.top+r.height/2);
            node.style.pointerEvents='';
            return top===node;
        })).toBe(true);
        expect(await fill.evaluate(node=>getComputedStyle(node,'::after').content)).not.toBe('none');
    }
    const geometry=await panel.locator('.planning-panel-capacity-graph,.planning-panel-project-graph').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));expect(Math.abs(geometry[0]-geometry[1])).toBeLessThan(8);
    const beforeCalls=fixture.calls.filter(call=>['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies'].includes(call.pathname)).length;
    await panel.getByRole('button',{name:'Show panel',exact:true}).click();await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    const collapse=panel.getByRole('button',{name:'Collapse panel',exact:true});
    await expect(panel.locator('.planning-actions')).toContainText('Collapse panel');
    const collapseRect=await collapse.boundingBox(),selectRect=await panel.getByRole('button',{name:'Select All',exact:true}).boundingBox();
    expect(Math.abs(collapseRect.y-selectRect.y)).toBeLessThan(3);
    await page.screenshot({path:`tmp/217-ui/collapse-inline-${scopeTeamIds.length}-team.png`,fullPage:false});

    await panel.getByRole('button',{name:'Collapse panel',exact:true}).click();await page.getByRole('radio',{name:'Stories',exact:true}).click();
    expect(await page.locator('.planning-review-table tbody input[type=checkbox]:checked').count()).toBe(selected);
    expect(fixture.calls.filter(call=>['/api/tasks-with-team-name','/api/eng/story-readiness','/api/dependencies'].includes(call.pathname)).length).toBe(beforeCalls);
    await page.addStyleTag({content:'body{padding-bottom:1000px}'});
    await page.locator('.planning-review-region').evaluate(node=>node.scrollIntoView({block:'start'}));
    await expect(panel).toHaveClass(/stuck/);const sticky=await panel.boundingBox();expect(sticky.height).toBeLessThan(64);expect(sticky.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({path:`tmp/217-ui/compact-sticky-${scopeTeamIds.length}-team.png`,fullPage:false});
    await page.locator('.filterbar .fb-trigger').click();
    const popup=page.locator('.popover');await expect(popup).toBeVisible();expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.locator('.filterbar .fb-trigger').click();
    await panel.getByRole('button',{name:'Show Planning list',exact:true}).click();await expect(panel).not.toHaveClass(/planning-panel-compact/);
    await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();await expect(panel).toHaveCount(0);
});

test('compact Table panel fits narrow screens and restores normal Planning in Scenario',async({page})=>{
    await page.setViewportSize({width:390,height:900});await installPlanningFixture(page);await openPlanning(page);
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    const panel=page.locator('.planning-panel');await expect(panel).toHaveClass(/planning-panel-compact/);
    expect((await panel.boundingBox()).height).toBeLessThan(130);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await panel.getByRole('button',{name:'Show panel',exact:true}).click();await expect(panel.getByRole('button',{name:'Select All',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Collapse panel',exact:true}).click();await expect(panel.getByRole('button',{name:'Show panel',exact:true})).toBeVisible();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Scenario',exact:true}).click();await expect(panel).toHaveCount(0);
});

 test('Planning defaults to Table without a layout preference and preserves an explicit List choice', async ({page}) => {
    await installPlanningFixture(page,{planningLayout:null});await openPlanning(page,{expectStories:false});
    await expect(page.getByRole('region',{name:'Planning Sprint review'})).toBeVisible();
    await page.getByRole('button',{name:'Show Planning list',exact:true}).click();
    await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')||'{}').planningLayout)).toBe('list');
    await page.reload();await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    await expect(page.getByRole('button',{name:'Show Planning table',exact:true})).toBeVisible();
});

// Column menus and the Add popover are editing controls: give the review a saving-capable profile.
async function allowReviewSaving(page) {
    await page.route('**/api/eng/sprints/*/review', route => json(route, { schemaVersion:1,sprintId:String(futureSprintId),schemaRevision:0,columns:[],capabilities:{canRead:true,canSave:true} }));
    await page.route('**/api/eng/sprints/*/review/values/read', route => json(route, {cells:[],unavailableIssueIds:[]}));
}

for (const width of [1280, 390]) test(`first Table scroll activates the sticky Filters then capacity stack without losing state at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{planningLayout:null,scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);await openPlanning(page,{expectStories:false});
    await page.addStyleTag({content:'body{padding-bottom:1000px}'});await page.evaluate(()=>scrollTo(0,0));
    const stack=page.locator('.planning-review-sticky-stack'),filters=stack.locator('.filterbar-wrap'),panel=stack.locator('.planning-panel');
    await expect(stack).toBeVisible();const initial=await stack.boundingBox();expect(initial.y).toBeGreaterThan(0);
    await expect(page.locator('.planning-review-region > .planning-review-toolbar')).toHaveCount(1);
    await expect(stack.locator('.planning-review-toolbar')).toHaveCount(0);
    const normalToolbar=await page.locator('.planning-review-toolbar').boundingBox(),tableStart=await page.locator('.planning-review-scroll').boundingBox();
    expect(normalToolbar.y+normalToolbar.height).toBeLessThanOrEqual(tableStart.y);
    await page.screenshot({path:`tmp/217-ui/table-toolbar-normal-${width}.png`,fullPage:false});
    const selected=await page.locator('.planning-review-table tbody input:checked').count();
    await page.mouse.move(width-2,850);await page.mouse.wheel(0,12);await expect(page.locator('.compact-sticky-header')).toHaveClass(/is-visible/);
    await expect.poll(async()=>{const h=await page.locator('.compact-sticky-header').boundingBox(),s=await stack.boundingBox();return Math.abs(s.y-(h.y+h.height));}).toBeLessThan(2);
    const f=await filters.boundingBox(),p=await panel.boundingBox();expect(p.y).toBeGreaterThanOrEqual(f.y+f.height-1);
    await expect(panel).toHaveClass(/stuck/);expect(await page.locator('.planning-review-table tbody input:checked').count()).toBe(selected);
    await filters.locator('.fb-trigger').click();await expect(page.locator('.popover')).toBeVisible();await filters.locator('.fb-trigger').click();
    const toolbar=page.locator('.planning-review-toolbar');
    await page.locator('.planning-review-scroll').evaluate(node=>node.scrollIntoView({block:'start'}));
    await expect.poll(async()=>{const t=await toolbar.boundingBox(),s=await stack.boundingBox();return Math.max(0,s.y-t.y,t.y+t.height-(s.y+s.height));}).toBeLessThan(3);
    const t=await toolbar.boundingBox(),s=await stack.boundingBox();expect(Math.abs(t.x-s.x)).toBeLessThan(2);expect(Math.abs(t.width-s.width)).toBeLessThan(2);
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const columns=page.getByRole('dialog',{name:'Add review column'});await expect(columns).toBeVisible();
    expect(await columns.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');
    const menuButton=page.getByRole('button',{name:'Status column options',exact:true});await menuButton.scrollIntoViewIfNeeded();await menuButton.click();
    const menu=page.getByRole('dialog',{name:'Status column options'});await expect(menu).toBeVisible();
    expect(await menu.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({path:`tmp/217-ui/table-sticky-filter-first-${width}.png`,fullPage:false});
    await page.evaluate(()=>scrollTo(0,0));
    await expect(page.locator('.planning-review-region > .planning-review-toolbar')).toHaveCount(1);
    await expect(stack.locator('.planning-review-toolbar')).toHaveCount(0);
    expect(await page.locator('.planning-review-table tbody input:checked').count()).toBe(selected);
    await panel.getByRole('button',{name:'Show Planning list',exact:true}).click();await expect(stack).toHaveCount(0);
    await expect(page.locator('.task-list .task-item').first()).toBeVisible();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();await expect(panel).toHaveCount(0);
});

for (const width of [1280, 390]) test(`Catch Up shares the second controls row before alerts at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});await installPlanningFixture(page);await openPlanning(page);
    await page.locator('.view-selector .eng-mode-control').getByRole('radio',{name:'Catch Up',exact:true}).click();
    const filters=page.locator('.filterbar-wrap'),alerts=page.locator('.alerts-panel-shell');
    await expect(filters).toHaveCount(1);await expect(alerts).toBeVisible();await page.evaluate(()=>scrollTo(0,0));
    const f=await filters.boundingBox(),a=await alerts.boundingBox(),header=await page.locator('header').boundingBox();
    expect(f.y).toBeGreaterThanOrEqual(header.y+header.height);expect(f.y+f.height).toBeLessThanOrEqual(a.y);
    await filters.locator('.fb-trigger').click();const popup=page.locator('.popover');await expect(popup).toBeVisible();
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await filters.locator('.fb-trigger').click();await page.screenshot({path:`tmp/217-ui/catch-up-controls-${width}.png`,fullPage:false});
});

for (const width of [1280,390]) test(`document scroll docks table headings below the measured controls at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await installPlanningFixture(page,{planningLayout:'table',longTable:true,scopeTeamIds:['team-alpha','team-beta']});await allowReviewSaving(page);
    await openPlanning(page,{expectStories:false});
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const scroll=page.locator('.planning-review-scroll'), stack=page.locator('.planning-review-sticky-stack');
    const selected=await scroll.locator('tbody input:checked').count();
    expect(await scroll.evaluate(node=>node.scrollHeight-node.clientHeight)).toBeLessThanOrEqual(1);
    await scroll.evaluate(node=>scrollTo(0,scrollY+node.getBoundingClientRect().top+250));
    const heading=page.locator('.planning-review-docked-header');await expect(heading).toBeVisible();
    await expect.poll(async()=>{const h=await heading.boundingBox(),s=await stack.boundingBox();return Math.abs(h.y-s.y-s.height);}).toBeLessThan(2);
    expect(await scroll.evaluate(node=>{const h=document.querySelector('.planning-review-docked-header').getBoundingClientRect(),r=node.getBoundingClientRect();return !node.querySelector('tbody').contains(document.elementFromPoint(r.left+10,h.top-8));})).toBe(true);
    await stack.getByRole('button',{name:'Show panel',exact:true}).click();
    await expect.poll(async()=>{const h=await heading.boundingBox(),s=await stack.boundingBox();return Math.abs(h.y-s.y-s.height);}).toBeLessThan(2);
    await stack.getByRole('button',{name:'Collapse panel',exact:true}).click();
    await expect.poll(async()=>{const h=await heading.boundingBox(),s=await stack.boundingBox();return Math.abs(h.y-s.y-s.height);}).toBeLessThan(2);
    // The real header is hidden from assistive technology while docked, so these roles resolve to the docked copy.
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Add review column'});await expect(popup).toBeVisible();
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');
    const menuButton=heading.getByRole('button',{name:'Status column options',exact:true});await menuButton.scrollIntoViewIfNeeded();await menuButton.click();
    const menu=page.getByRole('dialog',{name:'Status column options'});await expect(menu).toBeVisible();
    expect(await menu.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({path:`tmp/217-ui/single-page-dashboard-${width}.png`,fullPage:false});
    expect(await scroll.locator('tbody input:checked').count()).toBe(selected);
    await page.locator('.compact-sticky-header').getByRole('radio',{name:'Catch Up',exact:true}).click();
    await expect(heading).toHaveCount(0);await expect(page.locator('.planning-review-docked-footer')).toHaveCount(0);
});
