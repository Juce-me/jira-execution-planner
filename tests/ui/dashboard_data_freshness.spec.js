const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { buildDashboardBundle } = require('./eng_board_dashboard_fixture');
const { deferred, mockDashboard, openCatchUp, taskCard, taskPayload, installLifecycleControl, buildScenario, revealRefreshButton, refreshButton } = require('./eng_epic_refresh_fixture');

// Current source is bundled independently of dist; the shell and CSS use the rebuilt dist.
test.use({ reducedMotion: 'no-preference', viewport: { width: 1400, height: 1000 } });
let dashboardBundle;
test.beforeAll(async () => {
    const root = path.resolve(__dirname, '../..');
    if (process.env.JEP_TASK8_BASELINE) {
        const fs = require('node:fs'), esbuild = require('esbuild');
        const baseline = path.join(root, 'tmp/freshness-251/task-8-baseline');
        const files = new Set(JSON.parse(fs.readFileSync(path.join(baseline, 'manifest.json'), 'utf8')).files.map(value => value.path));
        dashboardBundle = (await esbuild.build({ entryPoints:[path.join(root,'frontend/src/dashboard.jsx')], bundle:true, write:false, format:'iife', loader:{'.css':'empty'}, define:{'process.env.NODE_ENV':'"production"'},
            plugins:[{name:'task8-reviewed-baseline',setup(build){build.onLoad({filter:/\.(?:jsx|js)$/},args=>{const relative=path.relative(root,args.path);if(!files.has(relative))return null;return {contents:fs.readFileSync(path.join(baseline,relative),'utf8'),loader:relative.endsWith('.jsx')?'jsx':'js',resolveDir:path.dirname(args.path)};});}}] })).outputFiles[0].text;
    } else dashboardBundle = await buildDashboardBundle(root);
});

function recordResources(page) {
    const requests = [];
    page.on('request', request => requests.push({ pathname: new URL(request.url()).pathname, type: request.resourceType() }));
    return requests;
}
function counts(calls, resources) {
    return {
        primary: calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !['alerts', 'ready-to-close', 'epic-alerts'].includes(call.params.purpose)).length,
        scope: calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose).length,
        alerts: calls.filter(call => ['alerts', 'ready-to-close', 'epic-alerts'].includes(call.params.purpose)).length,
        catalog: calls.filter(call => call.pathname === '/api/sprints').length,
        readiness: calls.filter(call => call.pathname === '/api/eng/story-readiness').length,
        dependencies: calls.filter(call => call.pathname === '/api/dependencies').length,
        documents: resources.filter(request => request.type === 'document').length,
        assets: resources.filter(request => !request.pathname.startsWith('/api/') && request.type !== 'document').length,
    };
}
async function setup(page, options) {
    const lifecycle = await installLifecycleControl(page);
    const resources = recordResources(page);
    const ctx = await mockDashboard(page, options);
    if (options?.analyticsEnabled !== undefined) ctx.respond('/api/analytics/context', ({ json }) => json({ enabled: options.analyticsEnabled }));
    options?.configure?.(ctx);
    // Later routes win over installDashboardShell's dist route.
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: dashboardBundle }));
    await openCatchUp(page, ctx, { prefs: { groupByInitiativeChoice: false, ...(options?.prefs || {}) } });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    return { lifecycle, resources, ctx };
}
async function settle(page) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);
}
async function task9Screenshot(page, name) {
    const fs = require('node:fs'), dir = path.resolve(__dirname, '../../tmp/freshness-251/task-9-screenshots');
    fs.mkdirSync(dir, { recursive: true }); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}
async function evidence(testInfo, name, value) {
    await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
    console.log(`${name}: ${JSON.stringify(value)}`);
}

test('automatic Catch Up request timeline stays targeted-first, bounded and read-only', async ({ page }, testInfo) => {
    const { lifecycle, resources, ctx } = await setup(page);
    await settle(page);
    const timeline = []; let inFlight = 0, peak = 0;
    const primary = request => { const url = new URL(request.url()); return url.pathname === '/api/tasks-with-team-name' && !['alerts', 'ready-to-close', 'epic-alerts'].includes(url.searchParams.get('purpose')); };
    page.on('request', request => { if (primary(request)) { inFlight++; peak = Math.max(peak, inFlight); timeline.push({ event: 'request', query: new URL(request.url()).search }); } });
    page.on('response', response => { if (primary(response.request())) { inFlight--; timeline.push({ event: 'response', query: new URL(response.url()).search }); } });
    const since = ctx.calls.length, resourceSince = resources.length;
    ctx.scenario.stories.find(story => story.key === 'E3-S01').fields.summary = 'Synthetic accepted broad change';
    await lifecycle.returnAfter(13 * 60 * 1000);
    await expect(taskCard(page, 'E3-S01')).toContainText('Synthetic accepted broad change');
    await settle(page);
    const calls = ctx.calls.slice(since), primaryCalls = calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !['alerts', 'ready-to-close', 'epic-alerts'].includes(call.params.purpose));
    expect(primaryCalls).toHaveLength(4);
    expect(primaryCalls.slice(0, 2).map(call => call.params.purpose)).toEqual(['epic-refresh', 'epic-refresh']);
    expect(new Set(primaryCalls.slice(0, 2).map(call => call.params.epicKeys)).size).toBe(1);
    expect(primaryCalls.slice(2).every(call => !call.params.purpose)).toBe(true);
    expect(primaryCalls.every(call => call.params.refresh === 'true')).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(timeline.slice(0, 4).map(item => item.event)).toEqual(['request', 'request', 'response', 'response']);
    expect(counts(calls, resources.slice(resourceSince))).toMatchObject({ catalog: 0, documents: 0, assets: 0, readiness: 1 });
    expect(calls.filter(call => call.pathname === '/api/dependencies')).toHaveLength(1);
    expect(calls.filter(call => call.pathname === '/api/missing-info')).toHaveLength(1);
    for (const purpose of ['alerts', 'ready-to-close']) expect(calls.filter(call => call.params.purpose === purpose).length).toBeLessThanOrEqual(2);
    expect(calls.filter(call => call.pathname === '/api/eng/story-readiness').every(call => call.params.epicKeys || call.params.epicKey)).toBe(true);
    expect(calls.filter(call => !['GET', 'POST'].includes(call.method) || (call.method === 'POST' && !['/api/auth/refresh', '/api/dependencies'].includes(call.pathname)))).toEqual([]);
    expect(await page.locator('[data-glare]').count()).toBe(0);
    await evidence(testInfo, 'automatic-request-timeline', { timeline, peak, calls: calls.map(call => ({ pathname: call.pathname, method: call.method, purpose: call.params.purpose })) });
});

test('blur at the broad response retains held data and starts no guarded follow-ups', async ({ page }) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    const gate = deferred();
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, async () => { await gate.promise; });
    ctx.scenario.stories.find(story => story.key === 'E3-S01').fields.summary = 'Synthetic withheld broad summary';
    const since = ctx.calls.length;
    await lifecycle.returnAfter(13 * 60 * 1000);
    await expect.poll(() => counts(ctx.calls.slice(since), []).scope).toBe(2);
    await lifecycle.setState('hidden'); const blurred = ctx.calls.length; gate.resolve(); await settle(page);
    await expect(taskCard(page, 'E3-S01')).not.toContainText('Synthetic withheld broad summary');
    expect(counts(ctx.calls.slice(blurred), [])).toMatchObject({ primary: 0, alerts: 0, readiness: 0, dependencies: 0 });
});

test('scope rate limit retries only the failed lane once after Retry-After', async ({ page }) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    const started = Date.now(); let attempts = 0; const stamps = [];
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose && call.params.project === 'product', async ({ json }) => {
        stamps.push(Date.now()); attempts++;
        if (attempts === 1) return json({ error: 'epic_refresh_rate_limited', retryAfterSeconds: 1 }, 429);
    });
    const since = ctx.calls.length; await lifecycle.returnAfter(13 * 60 * 1000);
    await expect.poll(() => attempts).toBe(2); await settle(page);
    const broad = ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose);
    expect(broad.filter(call => call.params.project === 'product')).toHaveLength(2);
    expect(broad.filter(call => call.params.project === 'tech')).toHaveLength(1);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(950); expect(stamps[0]).toBeGreaterThanOrEqual(started);
});

test('terminal auth in broad stage locks the mounted app with no replay or follow-up', async ({ page }) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose && call.params.project === 'product', ({ json }) => json({ error: 'auth_required', loginUrl: '/auth/login' }, 401));
    const since = ctx.calls.length; await lifecycle.returnAfter(13 * 60 * 1000);
    await expect(page.getByRole('alertdialog').getByRole('link', { name: 'Sign in again' })).toBeVisible(); await settle(page);
    const calls = ctx.calls.slice(since);
    expect(counts(calls, [])).toMatchObject({ primary: 4, alerts: 0, readiness: 0, dependencies: 0, catalog: 0 });
    await lifecycle.setState('hidden'); await lifecycle.setState('focused'); await settle(page);
    expect(ctx.calls.length).toBe(since + calls.length);
});

for (const status of [403, 500]) test(`broad ${status} ${status === 403 ? 'removes inaccessible content' : 'holds failed content'} and preserves the surviving lane DOM`, async ({ page }) => {
    const scenario = buildScenario();
    scenario.stories.find(story => story.key === 'E3-S01').fields.projectKey = 'TECH';
    const { lifecycle, ctx } = await setup(page, { scenario, prefs: { showTech: true, showProduct: true } }); await settle(page);
    await taskCard(page, 'E3-S01').evaluate(node => { window.__freshnessSurvivingNode = node; });
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose && call.params.project === 'product', ({ json }) =>
        json(status === 403 ? { error: 'missing_project_access', projectAccessStatus: 'inaccessible' } : { error: 'upstream_failed' }, status));
    const since = ctx.calls.length; await lifecycle.returnAfter(13 * 60 * 1000);
    await expect.poll(() => counts(ctx.calls.slice(since), []).scope).toBe(2); await settle(page);
    await expect(taskCard(page, 'E1-S06')).toHaveCount(status === 403 ? 0 : 1);
    expect(await taskCard(page, 'E3-S01').evaluate(node => node === window.__freshnessSurvivingNode)).toBe(true);
});

test('blur during alert follow-up holds its replacement and starts no later readiness or dependency read', async ({ page }) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'alerts', async () => { await gate.promise; });
    const since = ctx.calls.length; await lifecycle.returnAfter(13 * 60 * 1000);
    await expect.poll(() => ctx.calls.slice(since).filter(call => call.params.purpose === 'alerts')).toHaveLength(2);
    await lifecycle.setState('hidden'); const blurred = ctx.calls.length; gate.resolve(); await settle(page);
    expect(counts(ctx.calls.slice(blurred), [])).toMatchObject({ readiness: 0, dependencies: 0, primary: 0 });
});

test('manual per-Epic click supersedes the automatic targeted stage and keeps manual announcement', async ({ page }) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    const gate = deferred();
    ctx.respond(call => call.params.purpose === 'epic-refresh', async () => { await gate.promise; });
    const since = ctx.calls.length; await lifecycle.returnAfter(13 * 60 * 1000);
    await expect.poll(() => ctx.refreshCalls().filter(call => ctx.calls.indexOf(call) >= since)).toHaveLength(2);
    await revealRefreshButton(page, 'EPIC-1'); await refreshButton(page, 'EPIC-1').click();
    await expect.poll(() => ctx.refreshCalls().filter(call => ctx.calls.indexOf(call) >= since)).toHaveLength(4);
    gate.resolve(); await expect(page.locator('[data-epic-refresh-status]')).toContainText('Epic is up to date'); await settle(page);
    expect(ctx.refreshCalls().filter(call => ctx.calls.indexOf(call) >= since)).toHaveLength(4);
});

// Intentionally red at the recorded Task 0 baseline; leave uncommitted until the owners fix it.
test('long return retains the reading Story after another Epic priority changes', async ({ page }, testInfo) => {
    const { lifecycle, resources, ctx } = await setup(page);
    const anchor = taskCard(page, 'E1-S06');
    await expect(taskCard(page, 'E3-S01')).toBeAttached();
    await anchor.evaluate(node => window.scrollBy(0, node.getBoundingClientRect().top - window.innerHeight / 2));
    await settle(page);
    const before = await anchor.evaluate(node => { window.__freshnessTestAnchor = node; return node.getBoundingClientRect().top; });
    await page.screenshot({ path: testInfo.outputPath('reading-before.png') });
    const gate = deferred();
    ctx.respond(call => call.pathname === '/api/tasks-with-team-name', async () => { await gate.promise; });
    const changedFields = ctx.scenario.stories.find(story => story.key === 'E3-S01').fields;
    changedFields.priority = { name: 'Blocker' };
    changedFields.summary = 'Synthetic remote priority witnessed';
    const since = ctx.calls.length;
    const resourceSince = resources.length;
    await lifecycle.returnAfter(13 * 60 * 1000);
    gate.resolve();
    // An applied remote update must be witnessed before desired identity/offset assertions.
    await expect.poll(() => ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose).length).toBeGreaterThanOrEqual(2);
    await expect(taskCard(page, 'E3-S01')).toContainText('Synthetic remote priority witnessed');
    await expect(page.locator('[data-priority-transition-trigger][data-issue-kind="story"][data-issue-key="E3-S01"]')).toHaveAttribute('data-priority', 'Blocker');
    await settle(page);
    const after = await anchor.evaluate(node => ({ top: node.getBoundingClientRect().top, identity: node === window.__freshnessTestAnchor }));
    const requests = counts(ctx.calls.slice(since), resources.slice(resourceSince));
    await evidence(testInfo, 'reading-metrics', { before, after, offset: Math.abs(after.top - before), requests });
    await page.screenshot({ path: testInfo.outputPath('reading-after.png') });
    expect(requests.documents).toBe(0);
    expect.soft(after.identity, 'reading Story DOM identity retained after witnessed update').toBe(true);
    expect.soft(Math.abs(after.top - before), 'settled reading offset in CSS pixels').toBeLessThanOrEqual(2);
});

for (const state of ['hidden', 'visible-unfocused']) {
    test(`delayed return response is retired while ${state} and resumes once on refocus`, async ({ page }, testInfo) => {
        const { lifecycle, resources, ctx } = await setup(page);
        const oldSummary = 'E1-S06 synthetic story';
        const newSummary = `Synthetic remote summary while ${state}`;
        const gate = deferred();
        let responsesSettled = 0;
        ctx.respond(call => call.pathname === '/api/tasks-with-team-name', async ({ call, json }) => {
            await gate.promise;
            try { await json(taskPayload(call.params, ctx.scenario)); } finally { responsesSettled += 1; }
        });
        ctx.scenario.stories.find(story => story.key === 'E1-S06').fields.summary = newSummary;
        const since = ctx.calls.length;
        const resourceSince = resources.length;
        await lifecycle.returnAfter(13 * 60 * 1000);
        await expect.poll(() => counts(ctx.calls.slice(since), []).primary).toBe(2);
        await lifecycle.setState(state);
        expect(await page.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }))).toEqual({ focused: false, visibility: state === 'hidden' ? 'hidden' : 'visible' });
        const blurSince = ctx.calls.length;
        gate.resolve();
        // Witness released primary responses before inspecting the old rendered content.
        await expect.poll(() => responsesSettled).toBeGreaterThanOrEqual(2);
        await settle(page);
        const whileAway = {
            oldSummary: await taskCard(page, 'E1-S06').getByText(oldSummary, { exact: true }).count(),
            newSummary: await taskCard(page, 'E1-S06').getByText(newSummary, { exact: true }).count(),
            afterBlur: counts(ctx.calls.slice(blurSince), []),
            returnRequests: counts(ctx.calls.slice(since), resources.slice(resourceSince)),
        };
        await page.screenshot({ path: testInfo.outputPath('response-while-away.png') });
        const refocusSince = ctx.calls.length;
        await lifecycle.setState('focused');
        // Allow the owner to resume; network-idle plus a settled interval checks burst duplication.
        await expect.configure({ soft: true }).poll(() => counts(ctx.calls.slice(refocusSince), []).scope, { message: 'one current-scope pair resumes on refocus' }).toBe(2);
        await settle(page);
        await page.waitForTimeout(500);
        const resumed = counts(ctx.calls.slice(refocusSince), []);
        await evidence(testInfo, 'delayed-response-metrics', { state, whileAway, resumed });
        expect.soft(whileAway.oldSummary, 'old summary remains after released response while away').toBe(1);
        expect.soft(whileAway.newSummary, 'remote summary cannot apply while away').toBe(0);
        expect.soft(whileAway.afterBlur.readiness).toBe(0);
        expect.soft(whileAway.afterBlur.dependencies).toBe(0);
        expect.soft(whileAway.afterBlur.alerts).toBe(0);
        expect.soft(whileAway.returnRequests.documents).toBe(0);
        expect.soft(resumed.scope, 'one current-scope pair resumes on refocus').toBe(2);
        expect.soft(resumed.primary, 'at most one anchor pair and one current-scope pair').toBeLessThanOrEqual(4);
        await expect(taskCard(page, 'E1-S06')).toContainText(newSummary);
    });
}

for (const native of ['auto', 'none']) for (const variant of ['status', 'removal', 'height']) {
    test(`long return retains the reading Story after an earlier Story ${variant} change${native === 'none' ? ' with native anchoring disabled' : ''}`, async ({ page }, testInfo) => {
        const { lifecycle, resources, ctx } = await setup(page);
        await page.addStyleTag({content:`html,body{overflow-anchor:${native}}`});
        const changed = taskCard(page, 'E1-S01');
        const anchor = taskCard(page, 'E1-S06');
        if (variant === 'height') {
            await changed.locator('.story-subtasks-toggle').click();
            await expect(changed.locator('.story-subtasks-panel')).toBeVisible();
        }
        await anchor.evaluate(node => window.scrollBy(0, node.getBoundingClientRect().top - window.innerHeight / 2));
        await settle(page);
        if (native === 'none') await anchor.dispatchEvent('pointerdown');
        const before = await anchor.evaluate(node => { window.__freshnessTestAnchor = node; return node.getBoundingClientRect().top; });
        const epic = page.locator('.epic-block[data-epic-key="EPIC-1"]');
        const heightBefore = await epic.evaluate(node => node.getBoundingClientRect().height);
        await page.screenshot({ path: testInfo.outputPath(`${variant}-before.png`) });
        const gate = deferred();
        ctx.respond(call => call.pathname === '/api/tasks-with-team-name', async () => { await gate.promise; });
        const fields = ctx.scenario.stories.find(story => story.key === 'E1-S01').fields;
        if (variant === 'status') fields.status = { name: 'Done' };
        else if (variant === 'removal') {
            ctx.scenario.stories = ctx.scenario.stories.filter(story => story.key !== 'E1-S01');
            ctx.scenario.stories.find(story => story.key === 'E3-S01').fields.summary = 'Synthetic remote removal witnessed';
        }
        else {
            fields.summary = 'Synthetic expanded remote height';
            const story = ctx.scenario.stories.find(story => story.key === 'E1-S01');
            ctx.scenario.stories.unshift({ ...story, key: 'E1-S00', id: 'E1-S00', fields: { ...story.fields, summary: 'Synthetic extra height row', subtaskSummary: null } });
        }
        const since = ctx.calls.length;
        const resourceSince = resources.length;
        await lifecycle.returnAfter(13 * 60 * 1000);
        gate.resolve();
        await expect.poll(() => ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose).length).toBeGreaterThanOrEqual(2);
        if (variant === 'status') await expect(changed).toContainText('Done');
        else if (variant === 'removal') {
            // A removal alone can occur during loading. The surviving anchor and a remote
            // summary witness prove the replacement scope was applied before measuring.
            await expect(changed).toHaveCount(0);
            await expect(anchor).toBeAttached();
            await expect(taskCard(page, 'E3-S01')).toContainText('Synthetic remote removal witnessed');
        } else {
            await expect(changed).toContainText('Synthetic expanded remote height');
            await expect(taskCard(page, 'E1-S00')).toBeAttached();
        }
        await settle(page);
        const after = await anchor.evaluate(node => ({ top: node.getBoundingClientRect().top, identity: node === window.__freshnessTestAnchor }));
        const heightAfter = await epic.evaluate(node => node.getBoundingClientRect().height);
        const requests = counts(ctx.calls.slice(since), resources.slice(resourceSince));
        await evidence(testInfo, 'variant-metrics', { variant, before, after, offset: Math.abs(after.top - before), heightBefore, heightAfter, requests });
        await page.screenshot({ path: testInfo.outputPath(`${variant}-after.png`) });
        if (variant === 'height') expect(heightAfter, 'rendered Epic height actually grows').toBeGreaterThan(heightBefore);
        expect(requests.documents).toBe(0);
        expect.soft(after.identity, 'reading Story DOM identity retained after witnessed update').toBe(true);
        expect.soft(Math.abs(after.top - before), 'settled reading offset in CSS pixels').toBeLessThanOrEqual(2);
    });
}

// Task5 table/container seam only: real mounted table and guarded owner commit.
// Automatic Planning adapter acquisition and its dirty journeys are exercised in Task7.
async function mountReadingTableHarness(page, options = {}) {
    const esbuild = require('esbuild');
    const fs = require('node:fs');
    const code = esbuild.buildSync({ stdin: { resolveDir: path.resolve(__dirname, '../../frontend/src'), sourcefile: 'reading-table-harness.jsx', loader: 'jsx', contents: `
        import * as React from 'react'; import {createRoot} from 'react-dom/client';
        import PlanningReviewTable from './eng/PlanningReviewTable.jsx';
        import {useEpicRefresh} from './eng/useEpicRefresh.js';
        import {useEngWorkHierarchy} from './eng/useEngWorkHierarchy.js';
        const departureCase = ${Boolean(options.departure)};
        const stories = Array.from({length:40}, (_,i)=>({key:'STORY-'+(i+1),id:'s'+(i+1),fields:{epicKey:'EPIC-'+(i+1),summary:'Synthetic Story '+(i+1),priority:{name:'Medium'},status:{name:'To Do'},customfield_10004:3,teamId:'t',teamName:'Synthetic Team'}}));
        if(${Boolean(options.noEpic)}) {stories[19].fields.epicKey=null;stories[19].fields.summary='A synthetic no-Epic reading Story';}
        const epics = Object.fromEntries(stories.map((s,i)=>[s.fields.epicKey,{key:s.fields.epicKey,id:'e'+(i+1),summary:'Synthetic Epic '+(i+1),priority:{name:'Medium'},status:{name:'To Do'}}]));
        const otherStories=departureCase?stories.slice(39):[];
        const initial={productTasks:departureCase?stories.slice(0,39):stories,loadedProductTasks:departureCase?stories.slice(0,39):stories,techTasks:otherStories,loadedTechTasks:otherStories,epicDetails:epics,productEpicsInScope:departureCase?Object.values(epics).slice(0,39):[],techEpicsInScope:departureCase?Object.values(epics).slice(39):[]};
        const guards={blocked:false,epoch:1,version:1,scopeKey:'synthetic|1'};
        const review={columns:[],cells:{},drafts:{},layouts:{epic:{hidden:[]},story:{hidden:[]}},capabilities:{canSave:true},changeSchema:()=>true};
        function Harness(){
            const [state,setState]=React.useState(initial),[completed,setCompleted]=React.useState(false);
            const hierarchy=useEngWorkHierarchy({visibleTasksForList:[...state.productTasks,...state.techTasks],epicDetails:state.epicDetails,showPlanning:true,selectedSprint:1,activeGroupId:'synthetic',groupByInitiativeChoice:false});
            const setters=Object.fromEntries(['productTasks','techTasks','loadedProductTasks','loadedTechTasks','productEpicsInScope','techEpicsInScope','readyToCloseProductTasks','readyToCloseTechTasks','readyToCloseProductEpicsInScope','readyToCloseTechEpicsInScope','epicDetails'].map(name=>['set'+name[0].toUpperCase()+name.slice(1),value=>setState(prev=>({...prev,[name]:typeof value==='function'?value(prev[name]):value}))]));
            const refresh=useEpicRefresh({getState:()=>state,setters,readScopeGuards:()=>guards,readGuards:()=>guards,getProtectedKeys:()=>new Set(),getViewport:()=>({top:document.querySelector('.planning-table-sticky-stack').getBoundingClientRect().bottom+32,bottom:innerHeight}),sourceSurface:'planning',priorityOrder:{Blocker:1,Medium:3}});
            const apply=async()=>{
                const nextStories=departureCase?state.productTasks.filter(s=>s.key!=='STORY-20'):state.productTasks.map(s=>s.key==='STORY-5'?{...s,fields:{...s.fields,summary:'Synthetic grown above anchor',components:Array.from({length:18},(_,i)=>({name:'Synthetic component '+i}))}}:s);
                if(!departureCase) nextStories.unshift({key:'STORY-0',id:'s0',fields:{...stories[0].fields,epicKey:'EPIC-0',priority:{name:'Blocker'},summary:'Synthetic comparator addition'}});
                const nextEpics=departureCase?state.epicDetails:{...state.epicDetails,'EPIC-0':{...epics['EPIC-1'],key:'EPIC-0',id:'e0',priority:{name:'Blocker'},summary:'Synthetic comparator addition'},'EPIC-5':{...epics['EPIC-5'],summary:'Synthetic grown above anchor',components:Array.from({length:18},(_,i)=>({name:'Synthetic component '+i}))}};
                const result=refresh.applyScopeSnapshot({shouldApply:()=>true},{guards,lanes:{product:{status:'ok',coverage:'complete',items:nextStories,meta:{epics:nextEpics,epicsInScope:Object.values(nextEpics)}},tech:{status:'ok',coverage:'complete',items:state.techTasks,meta:{epics:departureCase?{'EPIC-40':epics['EPIC-40']}:{},epicsInScope:departureCase?[epics['EPIC-40']]:[]}}}});
                await result.settled;setCompleted(true);
            };
            React.useEffect(()=>{
                const deny=async()=>{const authorizedOther=${Boolean(options.sharedNoEpic)}?[...state.techTasks,stories[19]]:state.techTasks;const result=refresh.applyScopeSnapshot({shouldApply:()=>true},{guards,lanes:{product:{status:'denied',projectAccessStatus:'inaccessible'},tech:{status:'ok',coverage:'complete',items:authorizedOther,meta:{epics:{'EPIC-40':epics['EPIC-40']},epicsInScope:[epics['EPIC-40']]}}}});await result.settled;setCompleted('denied');};
                window.addEventListener('synthetic:accept-reading',apply);window.addEventListener('synthetic:deny-reading',deny);return()=>{window.removeEventListener('synthetic:accept-reading',apply);window.removeEventListener('synthetic:deny-reading',deny);};
            },[state]);
            return <><div className="planning-table-sticky-stack" style={{position:'sticky',top:0,zIndex:100,height:90,background:'white'}}><strong>Synthetic Filters / capacity stack</strong></div><PlanningReviewTable epicGroups={hierarchy.epicGroups} visibleTasks={[...state.productTasks,...state.techTasks]} selectedStoryKeys={new Set(stories.map(s=>s.key))} review={review} getTeamInfo={()=>({id:'t',name:'Synthetic Team'})} admittedTeamCount={1} admittedProjectCount={1} renderFieldEditor={({row,field,value})=>field==='summary'&&(row.key==='EPIC-20'||row.key==='STORY-20')?<span>{value}<button onClick={apply}>Accept synthetic automatic update</button></span>:null}/><output data-canonical-stories={state.productTasks.length+state.techTasks.length}>{completed==='denied'?'Denied apply settled':completed?'Automatic apply settled':'Ready'}</output></>;
        }
        createRoot(document.getElementById('root')).render(<Harness/>);
    ` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text;
    await page.setContent(`<style>${fs.readFileSync(path.resolve(__dirname, '../../frontend/dist/dashboard.css'), 'utf8')}</style><div id="root"></div>`);
    await page.addScriptTag({ content: code });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important} body{min-height:2400px}' });
}
for (const mode of ['epic', 'story']) for (const native of ['auto', 'none']) test(`mounted table ${mode} compensates actual comparator height above reading row with native anchoring ${native}`, async ({page}, testInfo) => {
    await mountReadingTableHarness(page);
    if(mode==='story') await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.addStyleTag({content:`html,body,.planning-review-scroll{overflow-anchor:${native}}`});
    const key=mode==='epic'?'e20':'s20';
    const anchor=page.locator(`[data-planning-row-key="${key}"]`);
    await anchor.evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-400));
    await page.locator('.planning-review-scroll').evaluate(node=>{node.scrollLeft=120;});
    await settle(page);
    const before=await anchor.evaluate(node=>{window.__syntheticTableAnchor=node;return {top:node.getBoundingClientRect().top,above:[...node.parentNode.children].filter(row=>row.rowIndex<node.rowIndex).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0),body:node.parentNode.getBoundingClientRect().height};});
    const horizontal=await page.locator('.planning-review-scroll').evaluate(node=>node.scrollLeft);
    await page.screenshot({path:testInfo.outputPath('table-before.png')});
    const accept = anchor.getByRole('button',{name:'Accept synthetic automatic update'});
    await accept.evaluate(node=>node.focus({preventScroll:true}));
    await accept.dispatchEvent('click');
    await expect(page.locator('output')).toHaveText('Automatic apply settled');await settle(page);
    const after=await anchor.evaluate(node=>({top:node.getBoundingClientRect().top,above:[...node.parentNode.children].filter(row=>row.rowIndex<node.rowIndex).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0),body:node.parentNode.getBoundingClientRect().height,identity:node===window.__syntheticTableAnchor}));
    await expect(page.locator(`[data-planning-row-key="${mode==='epic'?'e0':'s0'}"]`)).toHaveCount(1);
    expect(after.body).toBeGreaterThan(before.body);expect(after.above).toBeGreaterThan(before.above);
    expect(after.identity).toBe(true);expect(Math.abs(after.top-before.top)).toBeLessThanOrEqual(2);
    expect(await page.locator('.planning-review-scroll').evaluate(node=>node.scrollLeft)).toBe(horizontal);
    expect(await page.locator('.planning-table-sticky-stack').evaluate(node=>node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(after.top);
    await evidence(testInfo,'table-reading-metrics',{mode,native,before,after,horizontal});await page.screenshot({path:testInfo.outputPath('table-after.png')});
});

test('authoritative reading Story departure stays read-only outside scoped counts then releases on navigation', async ({page}) => {
    const {lifecycle,ctx}=await setup(page);await settle(page);
    const anchor=taskCard(page,'E1-S06');
    await anchor.evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-400));await settle(page);
    await anchor.dispatchEvent('pointerdown');
    ctx.scenario.stories=ctx.scenario.stories.filter(story=>story.key!=='E1-S06');
    ctx.scenario.stories.find(story=>story.key==='E3-S01').fields.summary='Synthetic departure witnessed';
    await lifecycle.returnAfter(13*60*1000);
    await expect(taskCard(page,'E3-S01')).toContainText('Synthetic departure witnessed');await settle(page);
    await expect(anchor).toHaveAttribute('data-reading-departure','true');
    await expect(anchor).toContainText('No longer in the current scope.');
    await expect(anchor.locator('[data-status-transition-trigger],[data-priority-transition-trigger],input[type="checkbox"],[data-issue-person-editor-trigger],.task-remove,.story-subtasks-toggle')).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));
    await expect(anchor).toHaveCount(0);
});

test('current user scroll during held automatic read is retained without rewind', async ({page},testInfo) => {
    const {lifecycle,ctx}=await setup(page);await settle(page);
    const anchor=taskCard(page,'E1-S06');
    await anchor.evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-400));await settle(page);
    const gate=deferred();ctx.respond(call=>call.pathname==='/api/tasks-with-team-name',async()=>{await gate.promise;});
    const since=ctx.calls.length;await lifecycle.returnAfter(13*60*1000);
    await expect.poll(()=>ctx.calls.slice(since).filter(call=>call.params.purpose==='epic-refresh').length).toBe(2);
    await page.mouse.move(1350,600);await page.mouse.wheel(0,400);await settle(page);
    const newPosition=await page.evaluate(()=>scrollY);
    ctx.scenario.stories.find(story=>story.key==='E3-S01').fields.summary='Synthetic movement update witnessed';
    gate.resolve();await expect(taskCard(page,'E3-S01')).toContainText('Synthetic movement update witnessed');await settle(page);
    const after=await page.evaluate(()=>scrollY);expect(Math.abs(after-newPosition)).toBeLessThanOrEqual(2);
    await evidence(testInfo,'user-movement-fence',{newPosition,after});
});

test('denied reading Epic is removed immediately and authorized survivor keeps geometry', async ({page},testInfo) => {
    const scenario=buildScenario();scenario.stories.find(story=>story.key==='E3-S01').fields.projectKey='TECH';
    const {lifecycle,ctx}=await setup(page,{scenario,prefs:{showTech:true,showProduct:true},configure:ctx=>ctx.respond(call=>call.pathname==='/api/tasks-with-team-name'&&!call.params.purpose,({call,json})=>{
        const body=taskPayload(call.params,scenario),keys=new Set(body.issues.map(story=>story.fields.epicKey));
        return json({...body,epics:Object.fromEntries(Object.entries(body.epics).filter(([key])=>keys.has(key))),epicsInScope:body.epicsInScope.filter(epic=>keys.has(epic.key))});
    })});await settle(page);
    const denied=taskCard(page,'E1-S06'), survivor=taskCard(page,'E3-S01');
    await denied.evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-400));await settle(page);await denied.dispatchEvent('pointerdown');
    await survivor.evaluate(node=>{window.__authorizedSurvivor=node;});
    ctx.respond(call=>call.pathname==='/api/tasks-with-team-name'&&!call.params.purpose&&call.params.project==='product',({json})=>json({error:'missing_project_access',projectAccessStatus:'inaccessible'},403));
    const since=ctx.calls.length;await lifecycle.returnAfter(13*60*1000);
    await expect.poll(()=>ctx.calls.slice(since).filter(call=>!call.params.purpose&&call.pathname==='/api/tasks-with-team-name').length).toBe(2);await settle(page);
    await expect(denied).toHaveCount(0);await expect(page.locator('[data-reading-departure]')).toHaveCount(0);
    const after=await survivor.evaluate(node=>({top:node.getBoundingClientRect().top,identity:node===window.__authorizedSurvivor}));
    expect(after.identity).toBe(true);expect(after.top).toBeGreaterThanOrEqual(0);expect(after.top).toBeLessThan(1000);
    await evidence(testInfo,'denied-anchor-fallback',after);
});

test('automatic Catch Up preserves applied filters, search, Team, expansion and Initiative grouping', async ({page},testInfo)=>{
    const {lifecycle,ctx}=await setup(page,{prefs:{searchQuery:'synthetic',selectedTeams:['team-alpha'],groupByInitiativeChoice:true}});
    await page.getByRole('button',{name:'Filters',exact:true}).click();
    await page.getByRole('group',{name:'Status',exact:true}).getByRole('button',{name:/in progress/i}).click();
    await page.keyboard.press('Escape');
    await expect(taskCard(page,'E2-S02')).toHaveCount(0);
    const story=taskCard(page,'E1-S01');
    await story.locator('.story-subtasks-toggle').click();
    await expect(story.locator('.story-subtasks-panel')).toBeVisible();
    await expect(page.getByRole('button',{name:'Group by Initiative',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.search-input:visible')).toHaveValue('synthetic');
    await expect(page.locator('.team-dropdown-selection-label:visible')).toHaveText('Alpha Team');
    const readout=(await page.locator('.filterbar-wrap').innerText()).replace(/\s+/g,' ');
    const selectedBefore=await page.locator('.task-checkbox:checked').count();
    const since=ctx.calls.length;
    ctx.scenario.stories.find(item=>item.key==='E1-S01').fields.summary='Synthetic automatically preserved expanded Story';
    await lifecycle.returnAfter(13*60*1000);
    await expect(story).toContainText('Synthetic automatically preserved expanded Story');await settle(page);
    await expect(story.locator('.story-subtasks-panel')).toBeVisible();
    await expect(taskCard(page,'E2-S02')).toHaveCount(0);
    await expect(page.locator('.search-input:visible')).toHaveValue('synthetic');
    await expect(page.locator('.team-dropdown-selection-label:visible')).toHaveText('Alpha Team');
    await expect(page.getByRole('button',{name:'Group by Initiative',exact:true})).toHaveAttribute('aria-pressed','true');
    expect((await page.locator('.filterbar-wrap').innerText()).replace(/\s+/g,' ')).toBe(readout);
    expect(await page.locator('.task-checkbox:checked').count()).toBe(selectedBefore);
    expect(selectedBefore,'Catch Up exposes no Planning selection controls').toBe(0);
    expect(ctx.calls.slice(since).filter(call=>!call.params.purpose&&call.pathname==='/api/tasks-with-team-name')).toHaveLength(2);
    await evidence(testInfo,'automatic-held-presentation',{search:'synthetic',team:'Alpha Team',groupByInitiative:true,statusHidden:'In Progress',expanded:'E1-S01',planningSelectionControls:selectedBefore});
});

test('ordinary Board automatic scope refresh keeps card identity and the open detail pane', async ({ page }, testInfo) => {
    page.on('pageerror', error => console.log(`Board page error: ${error.stack}`));
    const { groupsConfigPayload } = require('./eng_epic_refresh_fixture');
    const { lifecycle, ctx } = await setup(page, { configure: ctx => ctx.respond('/api/groups-config', ({ json }) => json({
        ...groupsConfigPayload, groups: groupsConfigPayload.groups.map(group => ({ ...group, board: { columns: [
            { id: 'todo', name: 'To Do', colour: '#456789', statuses: ['To Do'] },
            { id: 'doing', name: 'Doing', colour: '#789abc', statuses: ['In Progress'], star: true },
        ] } })) })) });
    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board', exact: true }).click();
    const card = page.locator('.ecard[data-epic-key="EPIC-1"]');
    await expect(card).toBeVisible();
    await card.locator('.ecard-open').click();
    const panel = page.locator('.epic-panel');
    await expect(panel).toBeVisible();
    await panel.locator('[data-story-key="E1-S06"]').scrollIntoViewIfNeeded();
    await settle(page);
    const identity = await card.elementHandle();
    const before = await panel.locator('[data-story-key="E1-S06"]').boundingBox();
    const since = ctx.calls.length;
    ctx.scenario.stories.find(item => item.key === 'E1-S06').fields.summary = 'Synthetic Board automatic accepted';
    await lifecycle.returnAfter(13 * 60 * 1000);
    await expect(panel.locator('[data-story-key="E1-S06"]')).toContainText('Synthetic Board automatic accepted');
    await settle(page);
    const after = await panel.locator('[data-story-key="E1-S06"]').boundingBox();
    expect(await card.evaluate((node, previous) => node === previous, identity)).toBe(true);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    await expect(panel).toBeVisible();
    const calls = ctx.calls.slice(since);
    expect(calls.filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(2);
    expect(calls.filter(call => call.params.purpose === 'epic-refresh')).toHaveLength(0);
    expect(calls.filter(call => ['/api/dependencies', '/api/eng/story-readiness', '/api/missing-info', '/api/eng/board'].includes(call.pathname))).toHaveLength(0);
    await evidence(testInfo, 'ordinary-board-reading', { before: before.y, after: after.y, primary: 2 });
});

for(const mode of ['story','epic']) for(const native of ['auto','none']) test(`mounted Table departed middle ${mode} remains read-only at distinct-ID row slot then explicit deny removes it native ${native}`,async({page},testInfo)=>{
    await mountReadingTableHarness(page,{departure:true});
    if(mode==='story') await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.addStyleTag({content:`html,body,.planning-review-scroll{overflow-anchor:${native}}`});
    const row=page.locator(`[data-planning-row-key="${mode==='story'?'s20':'e20'}"]`);
    await row.evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-400));await settle(page);
    const before=await row.evaluate(node=>({top:node.getBoundingClientRect().top,index:node.rowIndex}));
    await page.screenshot({path:testInfo.outputPath('departure-before.png')});
    const accept=row.getByRole('button',{name:'Accept synthetic automatic update'});await accept.evaluate(node=>node.focus({preventScroll:true}));await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:accept-reading')));
    await expect(page.locator('output')).toHaveText('Automatic apply settled');await settle(page);
    const retained=row.locator('[data-reading-departure="true"]');await expect(retained).toBeVisible();await expect(retained).toContainText(mode==='story'?'STORY-20':'EPIC-20');
    await retained.locator('.task-title').dispatchEvent('pointerdown');await expect(retained).toBeVisible();
    await retained.locator('.task-key-link').first().evaluate(node=>node.focus({preventScroll:true}));await expect(retained).toBeVisible();
    await expect(retained).toContainText('No longer in the current scope.');
    await expect(row.locator('input,button,[data-status-transition-trigger],[data-priority-transition-trigger],.planning-review-input')).toHaveCount(0);
    const after=await row.evaluate(node=>({top:node.getBoundingClientRect().top,index:node.rowIndex}));expect(after.index).toBe(before.index);expect(Math.abs(after.top-before.top)).toBeLessThanOrEqual(2);
    await expect(page.locator('output')).toHaveAttribute('data-canonical-stories','39');
    await expect(page.locator('.planning-review-table > tfoot .planning-review-storyPoints').first()).toHaveText('117');
    await expect(page.locator('.planning-review-table > tfoot .planning-review-accepted').first()).toHaveText('117');
    expect(await page.locator('.planning-review-table > tbody input[type="checkbox"]').count()).toBe(39);
    await page.screenshot({path:testInfo.outputPath('departure-after.png')});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:deny-reading')));
    await expect(page.locator('output')).toHaveText('Denied apply settled');await settle(page);
    await expect(row).toHaveCount(0);await expect(page.locator('[data-reading-departure]')).toHaveCount(0);
    await expect(page.locator(`[data-planning-row-key="${mode==='story'?'s40':'e40'}"]`)).toBeVisible();
    await expect(page.locator('output')).toHaveAttribute('data-canonical-stories','1');
    await evidence(testInfo,'table-departure-denial',{mode,native,before,after,retainedIssueKey:mode==='story'?'STORY-20':'EPIC-20',geometryId:mode==='story'?'s20':'e20',canonicalStories:39,storyPoints:117,authorizedSurvivor:'40'});
});

test('mounted Table deliberate other-row interaction releases retained departure immediately',async({page})=>{
    await mountReadingTableHarness(page,{departure:true});await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const row=page.locator('[data-planning-row-key="s20"]');await row.evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-400));await settle(page);
    await row.getByRole('button',{name:'Accept synthetic automatic update'}).evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:accept-reading')));await expect(page.locator('output')).toHaveText('Automatic apply settled');await settle(page);
    await expect(row.locator('[data-reading-departure]')).toBeVisible();
    await page.locator('[data-planning-row-key="s21"] .planning-review-summary').dispatchEvent('pointerdown');await expect(row).toHaveCount(0);
    await expect(page.locator('output')).toHaveAttribute('data-canonical-stories','39');
});

test('mounted Table denied no-Epic Story cannot survive as authorized departure',async({page})=>{
    await mountReadingTableHarness(page,{departure:true,noEpic:true});await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'Summary',exact:true}).first().click();
    const row=page.locator('[data-planning-row-key="s20"]');await row.getByRole('button',{name:'Accept synthetic automatic update'}).evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:deny-reading')));await expect(page.locator('output')).toHaveText('Denied apply settled');await settle(page);
    await expect(row).toHaveCount(0);await expect(page.locator('[data-reading-departure]')).toHaveCount(0);
    await expect(page.locator('[data-planning-row-key="s40"]')).toBeVisible();
});

test('mounted Table no-Epic Story authorized in surviving lane retains its canonical identity',async({page})=>{
    await mountReadingTableHarness(page,{departure:true,noEpic:true,sharedNoEpic:true});await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'Summary',exact:true}).first().click();
    const row=page.locator('[data-planning-row-key="s20"]').first();await row.getByRole('button',{name:'Accept synthetic automatic update'}).evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:deny-reading')));await expect(page.locator('output')).toHaveText('Denied apply settled');await settle(page);
    await expect(page.locator('[data-planning-row-key="s20"]')).toBeVisible();await expect(page.locator('[data-planning-row-key="s20"]')).toHaveCount(1);
    await expect(page.locator('[data-reading-departure]')).toHaveCount(0);await expect(page.locator('output')).toHaveAttribute('data-canonical-stories','2');
});

test('mounted Table departed no-Epic Story is purged by later denial of its source lane',async({page})=>{
    await mountReadingTableHarness(page,{departure:true,noEpic:true});await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'Summary',exact:true}).first().click();
    const row=page.locator('[data-planning-row-key="s20"]');await row.getByRole('button',{name:'Accept synthetic automatic update'}).evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:accept-reading')));await expect(page.locator('output')).toHaveText('Automatic apply settled');await settle(page);
    await expect(row.locator('[data-reading-departure]')).toBeVisible();await expect(page.locator('output')).toHaveAttribute('data-canonical-stories','39');
    await row.locator('.task-key-link').evaluate(node=>node.focus({preventScroll:true}));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('synthetic:deny-reading')));await expect(page.locator('output')).toHaveText('Denied apply settled');await settle(page);
    await expect(row).toHaveCount(0);await expect(page.locator('[data-reading-departure]')).toHaveCount(0);await expect(page.locator('[data-planning-row-key="s40"]')).toBeVisible();
});

for (const layout of ['pane', 'document', 'touch']) {
    test.describe(`ordinary Board ${layout} reading`, () => {
        if (layout === 'touch') test.use({ hasTouch: true });
        test(`automatic Board ${layout} scope update retains actual card geometry`, async ({ page }, testInfo) => {
            const { buildEpic, buildStory, groupsConfigPayload } = require('./eng_epic_refresh_fixture');
            const scenario = buildScenario();
            for (let i = 4; i <= 36; i++) {
                const key = `SYN-${i}`;
                scenario.epics[key] = buildEpic(key, { summary: `Synthetic Board card ${String(i).padStart(2, '0')}` });
                scenario.stories.push(buildStory(`WORK-${i}`, key));
            }
            if (layout === 'document') await page.setViewportSize({ width: 700, height: 900 });
            const { ctx, lifecycle } = await setup(page, { scenario, configure: ctx => ctx.respond('/api/groups-config', ({ json }) => json({
                ...groupsConfigPayload, groups: groupsConfigPayload.groups.map(group => ({ ...group, board: { columns: [
                    { id: 'doing', name: 'Doing', colour: '#789abc', statuses: ['In Progress'], star: true },
                    { id: 'done', name: 'Done', colour: '#abcdef', statuses: ['Done'] },
                ] } })) })) });
            await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Board', exact: true }).click();
            const root = page.locator('.eng-board'), card = page.locator('.ecard[data-epic-key="SYN-20"]');
            await expect(root).toHaveClass(layout === 'pane' ? /is-pane-mode/ : /^((?!is-pane-mode).)*$/);
            await card.scrollIntoViewIfNeeded(); await card.locator('.ecard-open').evaluate(node => node.focus({ preventScroll: true })); await settle(page);
            const node = await card.elementHandle(), before = await card.boundingBox();
            const position = await page.locator('.board').evaluate(board => ({ left: board.scrollLeft, documentTop: window.scrollY,
                panes: [...board.querySelectorAll('.col-body')].map(pane => pane.scrollTop) }));
            await page.screenshot({ path: `tmp/freshness-251/board-${layout}-before.png`, animations: 'disabled' });
            const since = ctx.calls.length;
            ctx.scenario.epics['SYN-20'].summary = 'Synthetic Board accepted remote card';
            ctx.scenario.epics['SYN-36'].priority = { name: 'Blocker' };
            ctx.scenario.stories.find(item => item.key === 'WORK-20').fields.summary = 'Synthetic changed detail';
            await lifecycle.returnAfter(13 * 60 * 1000);
            await expect(card).toContainText('Synthetic Board accepted remote card'); await settle(page);
            const after = await card.boundingBox();
            expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
            expect(await card.evaluate((current, prior) => current === prior, node)).toBe(true);
            const current = await page.locator('.board').evaluate(board => ({ left: board.scrollLeft, documentTop: window.scrollY,
                panes: [...board.querySelectorAll('.col-body')].map(pane => pane.scrollTop) }));
            expect(Math.abs(current.left - position.left)).toBeLessThanOrEqual(2);
            expect(ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name')).toHaveLength(2);
            expect(ctx.calls.slice(since).filter(call => call.params.purpose === 'epic-refresh')).toHaveLength(0);
            await expect(root.locator('.col.is-focused')).toHaveAttribute('data-column-id', 'doing');
            await expect(root.locator('.col[data-column-id="done"]')).not.toHaveClass(/is-open/);
            await page.screenshot({ path: `tmp/freshness-251/board-${layout}-after.png`, animations: 'disabled' });
            await evidence(testInfo, `board-${layout}-geometry`, { before: before.y, after: after.y, delta: Math.abs(after.y - before.y), position, current });
        });
    });
}

test('automatic ordinary Board preserves non-neutral facets and current scope while accepting remote values',async({page})=>{
    const {groupsConfigPayload}=require('./eng_epic_refresh_fixture');
    const scenario=buildScenario();
    for(const epic of Object.values(scenario.epics))epic.priority={name:'Major'};
    scenario.epics['EPIC-3'].priority={name:'Blocker'};
    const {ctx,lifecycle}=await setup(page,{scenario,configure:ctx=>ctx.respond('/api/groups-config',({json})=>json({
        ...groupsConfigPayload,groups:groupsConfigPayload.groups.map(group=>({...group,board:{columns:[
            {id:'doing',name:'Doing',colour:'#789abc',statuses:['In Progress'],star:true},
            {id:'done',name:'Done',colour:'#abcdef',statuses:['Done']},
        ]}}))}))});
    await page.getByRole('radiogroup',{name:'ENG view mode'}).getByRole('radio',{name:'Board',exact:true}).click();
    const scope=await page.getByRole('button',{name:'Select sprint'}).first().innerText();
    await page.getByRole('button',{name:/^Filters(?: \d+)?$/}).click();
    const priority=page.getByRole('dialog',{name:'Filters',exact:true}).getByRole('group',{name:'Priority',exact:true});
    await priority.getByRole('button',{name:/Blocker/}).click();
    await expect(priority.getByRole('button',{name:/Major/})).toHaveAttribute('aria-pressed','true');
    await page.keyboard.press('Escape');
    const card=page.locator('.ecard[data-epic-key="EPIC-1"]');await expect(card).toBeVisible();
    ctx.scenario.epics['EPIC-1'].summary='Synthetic accepted with held Major facet';
    ctx.scenario.epics['EPIC-2'].priority={name:'Critical'};
    const since=ctx.calls.length;await lifecycle.returnAfter(13*60*1000);
    await expect(card).toContainText('Synthetic accepted with held Major facet');
    await expect(page.locator('.ecard[data-epic-key="EPIC-2"]')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Select sprint'}).first()).toHaveText(scope);
    await expect(page.locator('.col.is-focused')).toHaveAttribute('data-column-id','doing');
    await expect(page.locator('.col[data-column-id="done"]')).not.toHaveClass(/is-open/);
    await page.getByRole('button',{name:/^Filters(?:\s*\d+)?$/}).click();
    await expect(priority.getByRole('button',{name:/Major/})).toHaveAttribute('aria-pressed','true');
    await expect(priority.getByRole('button',{name:/Blocker/})).toHaveAttribute('aria-pressed','false');
    await expect(priority.getByRole('button',{name:/Critical/})).toHaveAttribute('aria-pressed','false');
    expect(ctx.calls.slice(since).filter(call=>call.pathname==='/api/tasks-with-team-name')).toHaveLength(2);
    expect(ctx.calls.slice(since).filter(call=>call.params.purpose==='epic-refresh')).toHaveLength(0);
});

test('automatic Planning List owns return and keeps its primary/readiness/dependency ceilings without alerts', async ({ page }, testInfo) => {
    const { lifecycle, resources, ctx } = await setup(page, { prefs: { planningLayout: 'list' } });
    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Planning', exact: true }).click(); await settle(page);
    await page.getByRole('checkbox', { name: 'Select E3-S01 for sprint planning', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select E2-S01 for sprint planning', exact: true }).uncheck(); await settle(page);
    const selection = await page.locator('.task-list .task-item[data-issue-key]').evaluateAll(rows => Object.fromEntries(rows.filter(row => row.querySelector('input.task-checkbox')).map(row => [row.dataset.issueKey, row.querySelector('input.task-checkbox').checked])));
    expect(Object.values(selection)).toContain(true); expect(Object.values(selection)).toContain(false);
    expect(selection['E3-S01']).toBe(true); expect(selection['E2-S01']).toBe(false);
    const since = ctx.calls.length, resourceSince = resources.length;
    ctx.scenario.stories.find(story => story.key === 'E3-S01').fields.summary = 'Synthetic Planning List accepted return';
    await lifecycle.returnAfter(13 * 60000); await expect(taskCard(page, 'E3-S01')).toContainText('Synthetic Planning List accepted return'); await settle(page);
    const calls = ctx.calls.slice(since), observed = counts(calls, resources.slice(resourceSince));
    expect(observed).toMatchObject({ primary: 4, scope: 2, readiness: 1, dependencies: 1, alerts: 0, catalog: 0, documents: 0, assets: 0 });
    expect(calls.filter(call => ['/api/capacity', '/api/missing-info'].includes(call.pathname) || call.pathname.includes('/review'))).toHaveLength(0);
    const retainedSelection = await page.locator('.task-list .task-item[data-issue-key]').evaluateAll(rows => Object.fromEntries(rows.filter(row => row.querySelector('input.task-checkbox')).map(row => [row.dataset.issueKey, row.querySelector('input.task-checkbox').checked])));
    for (const [key, checked] of Object.entries(selection)) expect(retainedSelection[key], `surviving List row ${key}`).toBe(checked);
    expect(calls.filter(call => !['GET', 'POST'].includes(call.method) || call.method === 'POST' && !['/api/auth/refresh', '/api/dependencies'].includes(call.pathname))).toHaveLength(0);
    await evidence(testInfo, 'planning-list-request-ceilings', observed);
});

const { installDashboardFixture: installEpmFreshnessFixture, activeHomeTokenConnection } = require('./epm_home_token_fixture');
function epmFreshnessRollup(project, remote = false) {
    const rollup = { initiatives:{}, rootEpics:{'SYN-100':{ issue:{key:'SYN-100',summary:remote?'Synthetic remote Epic':'Synthetic held Epic',status:'In Progress',issueType:'Epic'},
        stories:[{key:'SYN-101',summary:remote?'Synthetic remote Story':'Synthetic held Story',status:remote?'Done':'In Progress',issueType:'Story',storyPoints:3,assignee:'Synthetic Owner'},
            ...(remote?[{key:'SYN-102',summary:'Synthetic newly discovered Story',status:'To Do',issueType:'Story',storyPoints:2}]:[])]}}, orphanStories:[], metadataOnly:false,emptyRollup:false,truncated:false };
    return {projects:[{project,rollup}],duplicates:{},truncated:false,fallback:false};
}
async function setupEpmFreshness(page) {
    const lifecycle=await installLifecycleControl(page);
    const ctx=await installEpmFreshnessFixture(page,{connection:activeHomeTokenConnection(),allProjectsRollup:project=>epmFreshnessRollup(project)});
    await page.route('**/frontend/dist/dashboard.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:dashboardBundle}));
    await page.addInitScript(()=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify({selectedView:'epm',epmTab:'active',selectedSprint:34625})));
    await page.goto(ctx.appBaseUrl);await expect(page.locator('.epm-project-board-name')).toBeVisible();await settle(page);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
    return {ctx,lifecycle};
}
for (const failure of [null,500,409,'null']) test(`automatic EPM ${failure || 'success'} keeps held project and sequences metadata before one rollup`,async({page},testInfo)=>{
    const {ctx,lifecycle}=await setupEpmFreshness(page);
    await page.getByRole('button',{name:'Show Jira rollup for Connected Home Project'}).click();
    const epic=page.locator('.epic-block[data-epic-key="SYN-100"]');
    if(!await page.locator('.task-item[data-task-key="SYN-101"]').isVisible()) await epic.locator('.epic-header').click();
    await expect(page.locator('.task-item[data-task-key="SYN-101"]')).toContainText('Synthetic held Story');await settle(page);
    const card=page.locator('.epm-project-board').first();const top=await card.evaluate(node=>{window.__epmHeldNode=node;return node.getBoundingClientRect().top;});
    await page.screenshot({path:testInfo.outputPath('epm-before.png')});
    const requests=[];const gate=deferred();
    await page.route('**/api/epm/projects**',async route=>{
        const url=new URL(route.request().url());requests.push(url);if(url.pathname==='/api/epm/projects'){
            await gate.promise;
            return route.fulfill({status:typeof failure==='number'?failure:200,contentType:'application/json',body:JSON.stringify(failure==='null'?null:failure===409?{error:'home_user_token_required'}:failure?{error:'upstream_failed'}:{projects:[{id:'home-1',homeProjectId:'home-1',name:'Connected Home Project',displayName:'Connected Home Project',label:'rnd_project_connected',tabBucket:'active',matchState:'home-linked',stateLabel:'On track',homeUrl:'https://home.example/project/home-1',latestUpdateDate:'2026-10-09',latestUpdateSnippet:'Synthetic remote Home metadata'}],cacheHit:false})});
        }
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(epmFreshnessRollup({id:'home-1',name:'Connected Home Project',label:'rnd_project_connected',stateLabel:'On track',homeUrl:'https://home.example/project/home-1',latestUpdateDate:'2026-10-09',latestUpdateSnippet:'Synthetic remote Home metadata'},true))});
    });
    const since=ctx.calls.length;await lifecycle.advance(1);await lifecycle.returnAfter(13*60*1000);await expect.poll(()=>requests.length).toBe(1);
    await expect(card).toContainText('Synthetic held Story');expect(await card.evaluate(node=>node===window.__epmHeldNode)).toBe(true);
    gate.resolve();await settle(page);
    await expect(card).toContainText(failure?'Synthetic held Story':'Synthetic remote Story');
    if(!failure){await expect(card).toContainText('Synthetic remote Home metadata');await expect(card).toContainText('Synthetic remote Epic');await expect(card).toContainText('Synthetic newly discovered Story');}
    expect(ctx.calls.slice(since).filter(call=>call.pathname==='/api/dependencies')).toHaveLength(0);expect(await card.evaluate(node=>node===window.__epmHeldNode)).toBe(true);
    expect(Math.abs(await card.evaluate(node=>node.getBoundingClientRect().top)-top)).toBeLessThanOrEqual(2);
    expect(requests.map(url=>url.pathname)).toEqual(failure?['/api/epm/projects']:['/api/epm/projects','/api/epm/projects/rollup/all']);
    expect(requests[0].searchParams.get('refresh')).toBe(null);if(!failure)expect(requests[1].searchParams.get('sprint')).toBe('34625');
    expect(ctx.calls.slice(since).filter(call=>call.pathname==='/api/tasks-with-team-name')).toHaveLength(0);
    await expect(page.getByRole('button',{name:'Hide Jira rollup for Connected Home Project'})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('epm-after.png')});
});

async function setupStatsFreshness(page, view) {
    const {catchUpPrefs,appBaseUrl,groupsConfigPayload,SPRINT_ID}=require('./eng_epic_refresh_fixture');
    const lifecycle=await installLifecycleControl(page),ctx=await mockDashboard(page);
    ctx.respond('/api/groups-config',({json})=>json({...groupsConfigPayload,groups:groupsConfigPayload.groups.map(group=>({...group,excludedCapacityEpics:['EPIC-1']}))}));
    const source=view==='cohort'?'/api/stats/epic-cohort':['excludedCapacity','monoCrossShare','projectTrack'].includes(view)?'/api/stats/excluded-capacity-source':view==='burnout'?'/api/stats/burnout':null;
    let remote = false;
    ctx.scenario.stories.forEach(story => Object.assign(story.fields, {customfield_10101:story.fields.sprint,epicProjectTrack:'Committed',epicStatus:'In Progress',epicAssignee:{displayName:'Synthetic Epic Lead'}}));
    ctx.scenario.stories.find(story=>story.key==='E2-S01').fields.status={name:'Done'};
    ctx.scenario.stories.find(story=>story.key==='E2-S02').fields.projectKey='TECH';
    const data=()=> view==='burnout'?{range:{startDate:'2026-05-01',endDate:'2026-05-14'},issuesMeta:ctx.scenario.stories.map(story=>({issueKey:story.key,createdDate:'2026-04-27',teamAtStart:{id:'team-alpha',name:'Alpha Team'},assignee:{id:'synthetic-owner',name:'Synthetic Owner'}})),events:[{issueKey:'E2-S01',date:'2026-05-04',bucket:'done',teamId:'team-alpha',teamName:'Alpha Team'},...(remote?[{issueKey:'E3-S01',date:'2026-05-07',bucket:'done',teamId:'team-alpha',teamName:'Alpha Team'}]:[])],assignees:[{id:'synthetic-owner',name:'Synthetic Owner'}]}:
        view==='cohort'?{range:{startDate:'2026-01-01',endDate:'2026-06-30'},issues:[{key:'SYN-1',summary:'Synthetic open cohort Epic',projectKey:'PROD',status:'open',jiraStatus:'In Progress',createdDate:'2026-01-10',assignee:{id:'synthetic-owner',name:'Synthetic Owner'}},{key:'SYN-2',summary:'Synthetic done cohort Epic',projectKey:'PROD',status:'done',jiraStatus:'Done',createdDate:'2026-01-10',terminalDate:'2026-01-20',leadTimeDays:10,assignee:{id:'synthetic-owner',name:'Synthetic Owner'}},...(remote?[{key:'SYN-3',summary:'Synthetic remote cohort Epic',projectKey:'PROD',status:'done',jiraStatus:'Done',createdDate:'2026-01-10',terminalDate:'2026-01-30',leadTimeDays:20,assignee:{id:'synthetic-owner',name:'Synthetic Owner'}}]:[])],meta:{warnings:[]}}:
        {issues:ctx.scenario.stories,meta:{warnings:[]}};
    if(source)ctx.respond(source,({json})=>json({data:data(),cached:false}));
    ctx.respond('/api/stats/project-track-phase-durations',({json})=>json({epics:[{key:'EPIC-3',summary:'Synthetic held phase Epic',created:'2026-04-01',currentValue:'Committed',durations:{'No track':3,Committed:8},transitions:[{date:'2026-04-04',from:null,to:'Committed'}]}],meta:{processedEpicCount:1,truncated:false}}));
    const activateRemote=()=>{remote=true;const story=ctx.scenario.stories.find(story=>story.key==='E3-S01');Object.assign(story.fields,{summary:'Synthetic accepted Statistics Story',status:{name:'Done'},customfield_10004:11});ctx.scenario.stories.find(story=>story.key==='E1-S01').fields.customfield_10004=12;if(view==='burnout')ctx.scenario.stories.push({...story,id:'E3-S02',key:'E3-S02',fields:{...story.fields,summary:'Synthetic newly discovered Burnout scope Story',status:{name:'To Do'},customfield_10004:1}});};
    await page.route('**/frontend/dist/dashboard.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:dashboardBundle}));
    await page.addInitScript(value=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify(value)),catchUpPrefs({showStats:true,statsView:view,groupByInitiativeChoice:false,cohortStartQuarter:'2026Q1',cohortEndQuarter:'2026Q2',excludedCapacityStartSprintId:String(SPRINT_ID),excludedCapacityEndSprintId:String(SPRINT_ID),projectTrackMode:'epic',projectTrackCapacitySide:'both',projectTrackExcludeExcludedCapacity:false,showProduct:true,showTech:true}));
    await page.goto(appBaseUrl);await expect(page.locator('.stats-view.open')).toBeVisible();await settle(page);
    if(source)await expect.poll(()=>ctx.calls.filter(call=>call.pathname===source).length).toBeGreaterThan(0);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
    return {ctx,lifecycle,source,activateRemote};
}
const statsWitnesses = {
    teams:{nodes:'.stats-bar-fill,.stats-table tbody tr',metric:'.stats-table tbody tr:first-child td.total .postponed-cell span',before:'1',after:'2'},
    priority:{nodes:'.priority-radar,.stats-table tbody tr',metric:'.stats-table tbody tr',before:null,after:null},
    burnout:{nodes:'.burnout-area-chart,.burnout-team-line',metric:'.burnout-summary .stats-card:nth-child(3) .stat-value',before:'2.0',after:'13.0'},
    cohort:{nodes:'.cohort-grid,.cohort-cell.has-value',metric:'.cohort-summary .stats-card:first-child .stat-value',before:'2',after:'3'},
    excludedCapacity:{nodes:'.effort-type-split-track,.excluded-capacity-line-chart svg',metric:'.excluded-capacity-summary .stats-card:first-child .stat-value',before:'24.0',after:'34.0'},
    monoCrossShare:{nodes:'.epic-mode-track,.excluded-capacity-line-chart svg',metric:'.excluded-capacity-summary .stats-card:nth-child(3) .stat-value',before:'30.0',after:'50.0'},
    projectTrack:{nodes:'.project-track-totals .stacked-bar-track,.project-track-phase-chart .stacked-bar-track',metric:'.project-track-totals .stacked-bar-row-total',before:'30 SP',after:'50 SP'}
};
for(const view of ['teams','priority','burnout','cohort','excludedCapacity','monoCrossShare','projectTrack'])test(`automatic Statistics ${view} reads only active source silently and preserves controls`,async({page},testInfo)=>{
    const {ctx,lifecycle,source,activateRemote}=await setupStatsFreshness(page,view),witness=statsWitnesses[view];
    const panel=page.locator('.stats-view.open'),metric=panel.locator(witness.metric).first();
    if(witness.before)await expect(metric).toHaveText(witness.before);
    const metricBefore=await metric.innerText();expect(await panel.locator(witness.nodes).count()).toBeGreaterThan(0);
    const before=await panel.evaluate((node,selector)=>{
        window.__statsHeldNodes=[node,...node.querySelectorAll(selector)];
        window.__statsInnerScroll=[...node.querySelectorAll('*')].filter(n=>n.clientWidth>0&&n.scrollWidth>n.clientWidth+2||n.clientHeight>0&&n.scrollHeight>n.clientHeight+2).filter(n=>['auto','scroll'].some(v=>[getComputedStyle(n).overflowX,getComputedStyle(n).overflowY].includes(v)));
        window.__statsInnerScroll.forEach(n=>{n.scrollLeft=Math.min(31,n.scrollWidth-n.clientWidth);n.scrollTop=Math.min(31,n.scrollHeight-n.clientHeight);});
        return {controls:[...node.querySelectorAll('input,select,button[aria-pressed],button[aria-expanded]')].map(n=>[n.getAttribute('aria-label'),n.value,n.checked,n.getAttribute('aria-pressed'),n.getAttribute('aria-expanded')]),scroll:window.__statsInnerScroll.map(n=>[n.scrollLeft,n.scrollTop])};
    },witness.nodes);
    if(before.scroll.length)expect(before.scroll.some(([x,y])=>x>0||y>0)).toBe(true);
    const heldPhase=view==='projectTrack'?await panel.locator('.project-track-phase-section').innerText():null;
    await page.screenshot({path:testInfo.outputPath('stats-before.png')});const since=ctx.calls.length,gate=deferred();
    ctx.respond(call=>call.pathname===(source||'/api/tasks-with-team-name')&&!call.params.purpose,async()=>{await gate.promise;});
    activateRemote();await lifecycle.returnAfter(13*60*1000);
    await expect.poll(()=>ctx.calls.slice(since).filter(call=>call.pathname===(source||'/api/tasks-with-team-name')).length).toBeGreaterThan(0);
    await expect(panel).not.toContainText(/Loading/);expect(await metric.innerText()).toBe(metricBefore);gate.resolve();
    if(witness.after)await expect(metric).toHaveText(witness.after);else await expect(metric).not.toHaveText(metricBefore);
    await settle(page);await expect(panel).not.toContainText(/Loading/);
    if(view==='priority')await expect(panel.locator('.priority-radar text').filter({hasText:/^16\.0$/})).toHaveCount(1);
    const calls=ctx.calls.slice(since);
    expect(calls.filter(call=>call.pathname.startsWith('/api/stats/')&&call.pathname!==source)).toHaveLength(0);
    expect(calls.filter(call=>call.pathname==='/api/tasks-with-team-name')).toHaveLength(['teams','priority','burnout'].includes(view)?2:0);
    expect(calls.filter(call=>['/api/missing-info','/api/dependencies','/api/backlog-epics','/api/sprints'].includes(call.pathname))).toHaveLength(0);
    if(source){expect(calls.filter(call=>call.pathname===source)).toHaveLength(1);const body=calls.find(call=>call.pathname===source).body;if(view==='burnout')expect(body.refresh).toBeUndefined();if(view==='cohort')expect(body.refresh).toBe(false);if(['excludedCapacity','monoCrossShare','projectTrack'].includes(view))expect(body).toMatchObject({sprintIds:[String(require('./eng_epic_refresh_fixture').SPRINT_ID)],refresh:true});}
    expect(await panel.evaluate(node=>window.__statsHeldNodes.length>1&&window.__statsHeldNodes.every(held=>held.isConnected&&(held===node||node.contains(held))))).toBe(true);
    const after=await panel.evaluate(node=>({controls:[...node.querySelectorAll('input,select,button[aria-pressed],button[aria-expanded]')].map(n=>[n.getAttribute('aria-label'),n.value,n.checked,n.getAttribute('aria-pressed'),n.getAttribute('aria-expanded')]),scroll:window.__statsInnerScroll.map(n=>[n.scrollLeft,n.scrollTop])}));expect(after).toEqual(before);
    if(heldPhase)expect(await panel.locator('.project-track-phase-section').innerText()).toBe(heldPhase);
    await evidence(testInfo,'stats-accepted-witness',{view,before:metricBefore,after:await metric.innerText(),retainedNodes:await panel.locator(witness.nodes).count(),innerScroll:before.scroll});
    await page.screenshot({path:testInfo.outputPath('stats-after.png')});
});
for(const view of ['burnout','cohort','excludedCapacity','monoCrossShare','projectTrack'])test(`automatic Statistics ${view} holds loaded charts on recoverable failure`,async({page})=>{
    const {ctx,lifecycle,source}=await setupStatsFreshness(page,view);const panel=page.locator('.stats-view.open');const before=await panel.innerText();
    ctx.respond(source,({json})=>json({error:'synthetic_upstream_failure'},500));const since=ctx.calls.length;
    await lifecycle.returnAfter(13*60*1000);await expect.poll(()=>ctx.calls.slice(since).filter(call=>call.pathname===source).length).toBe(1);await settle(page);
    expect(await panel.innerText()).toBe(before);await expect(panel).not.toContainText(/Loading|synthetic_upstream_failure/);
});

async function ignoreReadAbortForLateResponse(page, pathname) {
    await page.evaluate(pathname=>{const original=window.fetch;window.fetch=(url,options={})=>original(url,String(url).includes(pathname)?{...options,signal:undefined}:options);},pathname);
}
for(const view of ['burnout','cohort','excludedCapacity','monoCrossShare','projectTrack'])test(`automatic Statistics ${view} retires on blur and a late real401 locks without replay`,async({page})=>{
    const {ctx,lifecycle,source}=await setupStatsFreshness(page,view);await ignoreReadAbortForLateResponse(page,source);
    const panel=page.locator('.stats-view.open'),before=await panel.innerText(),gate=deferred();
    const remove=ctx.respond(source,async({json})=>{await gate.promise;return json({data:{issues:[],range:{startDate:'2026-01-01',endDate:'2026-01-02'},events:[],assignees:[]},cached:false});});
    let since=ctx.calls.length;await lifecycle.advance(1);await lifecycle.returnAfter(13*60*1000);await expect.poll(()=>ctx.calls.slice(since).filter(call=>call.pathname===source).length).toBe(1);await lifecycle.setState('hidden');gate.resolve();await settle(page);
    expect(await panel.innerText()).toBe(before);remove();await lifecycle.setState('focused');await settle(page);
    const terminal=deferred();ctx.respond(source,async({json})=>{await terminal.promise;return json({error:'auth_required',loginUrl:'/login?reason=session_expired'},401);});
    since=ctx.calls.length;await lifecycle.advance(1);await lifecycle.returnAfter(13*60*1000);await expect.poll(()=>ctx.calls.slice(since).filter(call=>call.pathname===source).length).toBe(1);await lifecycle.setState('hidden');terminal.resolve();
    await expect(page.getByRole('alertdialog').getByRole('link',{name:'Sign in again'})).toBeVisible();await settle(page);
    const locked=ctx.calls.length;await lifecycle.setState('focused');await lifecycle.returnAfter(13*60*1000);await settle(page);expect(ctx.calls.length).toBe(locked);
});
test('automatic EPM retired metadata real401 locks held app without rollup or replay',async({page})=>{
    const {ctx,lifecycle}=await setupEpmFreshness(page);await ignoreReadAbortForLateResponse(page,'/api/epm/projects');
    const gate=deferred(),requests=[];
    await page.route('**/api/epm/projects**',async route=>{requests.push(new URL(route.request().url()).pathname);await gate.promise;return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'auth_required',loginUrl:'/login?reason=session_expired'})});});
    await lifecycle.returnAfter(13*60*1000);await expect.poll(()=>requests.length).toBe(1);await lifecycle.setState('hidden');gate.resolve();
    await expect(page.getByRole('alertdialog').getByRole('link',{name:'Sign in again'})).toBeVisible();await settle(page);
    const locked=ctx.calls.length;await lifecycle.setState('focused');await lifecycle.returnAfter(13*60*1000);await settle(page);expect(ctx.calls.length).toBe(locked);expect(requests).toEqual(['/api/epm/projects']);
});

test('compact Statistics retains a real nonzero inner view-control scroll through populated acceptance',async({page},testInfo)=>{
    await page.setViewportSize({width:600,height:900});
    const {ctx,lifecycle,activateRemote}=await setupStatsFreshness(page,'projectTrack');
    const controls=page.locator('.stats-view-toggle'),panel=page.locator('.stats-view.open');
    const before=await controls.evaluate(node=>{window.__compactStatsScroller=node;node.scrollLeft=40;return {left:node.scrollLeft,width:node.clientWidth,contentWidth:node.scrollWidth,overflow:getComputedStyle(node).overflowX};});
    expect(before.contentWidth).toBeGreaterThan(before.width);expect(before.left).toBeGreaterThan(0);
    const chartGeometry=await panel.locator('.project-track-totals,.project-track-phase-chart').evaluateAll(nodes=>nodes.map(node=>({className:node.className,width:node.clientWidth,contentWidth:node.scrollWidth,height:node.clientHeight,contentHeight:node.scrollHeight,overflowX:getComputedStyle(node).overflowX,overflowY:getComputedStyle(node).overflowY})));
    await expect(panel.locator('.project-track-totals .stacked-bar-row-total')).toHaveText('30 SP');
    await page.screenshot({path:testInfo.outputPath('stats-compact-before.png')});const since=ctx.calls.length;activateRemote();await lifecycle.returnAfter(13*60*1000);
    await expect(panel.locator('.project-track-totals .stacked-bar-row-total')).toHaveText('50 SP');await settle(page);
    expect(await controls.evaluate(node=>node===window.__compactStatsScroller)).toBe(true);expect(await controls.evaluate(node=>node.scrollLeft)).toBe(before.left);
    expect(ctx.calls.slice(since).filter(call=>call.pathname==='/api/stats/excluded-capacity-source')).toHaveLength(1);expect(ctx.calls.slice(since).filter(call=>call.pathname==='/api/stats/project-track-phase-durations')).toHaveLength(0);
    await evidence(testInfo,'compact-stats-real-inner-scroll',{before,after:await controls.evaluate(node=>node.scrollLeft),chartGeometry});await page.screenshot({path:testInfo.outputPath('stats-compact-after.png')});
});

test('automatic EPM authoritative empty metadata and aggregate remove held All Projects canonical data',async({page})=>{
    const {lifecycle}=await setupEpmFreshness(page),requests=[];
    await page.route('**/api/epm/projects**',route=>{const url=new URL(route.request().url());requests.push(url.pathname);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname==='/api/epm/projects'?{projects:[],cacheHit:false}:{projects:[],duplicates:{},truncated:false,fallback:false})});});
    await lifecycle.returnAfter(13*60*1000);await expect(page.locator('.epm-project-board')).toHaveCount(0);await settle(page);
    expect(requests).toEqual(['/api/epm/projects','/api/epm/projects/rollup/all']);await expect(page.locator('.task-item[data-task-key="SYN-101"]')).toHaveCount(0);
});

test('automatic Statistics generic403 holds accepted chart without resource-denial inference',async({page})=>{
    const {ctx,lifecycle,source}=await setupStatsFreshness(page,'cohort'),panel=page.locator('.stats-view.open'),before=await panel.innerText();
    ctx.respond(source,({json})=>json({error:'synthetic_forbidden'},403));const since=ctx.calls.length;await lifecycle.returnAfter(13*60*1000);await expect.poll(()=>ctx.calls.slice(since).filter(call=>call.pathname===source).length).toBe(1);await settle(page);
    expect(await panel.innerText()).toBe(before);await expect(panel).not.toContainText(/Loading|synthetic_forbidden/);
});

test('Task9 status records scope checks, keeps running copy and explicit Refresh clears pending', async ({ page }, testInfo) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    const status = page.locator('[data-dashboard-freshness-status]');
    await expect(status).toHaveCount(0);
    const sinceAuth = ctx.calls.length;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('jep:auth-session-refresh'))); await settle(page);
    await expect(status).toHaveCount(0); expect(ctx.calls.length).toBe(sinceAuth);
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    await expect(page.locator('.group-modal-backdrop')).toBeVisible();
    const since = ctx.calls.length; await lifecycle.returnAfter(13 * 60000); await settle(page);
    await expect(status).toHaveText('Updates pending'); expect(counts(ctx.calls.slice(since), []).primary).toBe(0); await task9Screenshot(page, 'status-pending-settings');
    await page.locator('.group-modal-backdrop').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(status).toHaveText(/Checked 0s ago; coverage unknown/);
    await settle(page); await lifecycle.advance(1); await lifecycle.setState('blurred'); await lifecycle.returnAfter(13 * 60000); await expect(status).toHaveText('Updates pending');
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click(); await expect(status).toHaveText(/Checked .* ago; coverage unknown/);
    await evidence(testInfo, 'task9-explicit-status', { text: await status.textContent(), primary: counts(ctx.calls.slice(since), []).primary });
});

test('Task9 failure copy outranks pending and running retains the last rendered readout', async ({ page }) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    const status = page.locator('[data-dashboard-freshness-status]');
    await lifecycle.returnAfter(13 * 60000); await expect(status).toHaveText(/Checked .* ago; coverage unknown/);
    await task9Screenshot(page, 'status-checked-unknown'); const previous = await status.textContent(); const gate = deferred();
    const remove = ctx.respond(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose, async ({ json }) => { await gate.promise; return json({ error: 'upstream_failed' }, 500); });
    const since = ctx.calls.length; await lifecycle.advance(1); await lifecycle.returnAfter(13 * 60000);
    await expect.poll(() => counts(ctx.calls.slice(since), []).scope).toBe(2); await expect(status).toHaveText(previous); await task9Screenshot(page, 'status-running-held');
    gate.resolve(); await expect(status).toHaveText('Could not check; showing previous data'); await task9Screenshot(page, 'status-failed'); remove();
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
    await expect(status).toHaveText(/Checked .* ago; coverage unknown/);
});

test('Task9 age rendering across 61 minutes acquires nothing and pauses hidden or blurred', async ({ page }, testInfo) => {
    const { lifecycle, ctx } = await setup(page); await settle(page);
    await lifecycle.returnAfter(13 * 60000); const status = page.locator('[data-dashboard-freshness-status]'); await expect(status).toHaveText(/Checked 0s ago/);
    await settle(page); const since = ctx.calls.length;
    await lifecycle.advance(61 * 60000); await expect(status).toHaveText('Checked 1h ago; coverage unknown'); expect(ctx.calls.length).toBe(since);
    await lifecycle.setState('blurred'); const held = await status.textContent(); await lifecycle.advance(25 * 3600000); await page.waitForTimeout(1200); await expect(status).toHaveText(held);
    await lifecycle.setState('hidden'); await page.waitForTimeout(1200); expect(ctx.calls.length).toBe(since);
    await evidence(testInfo, 'task9-age-no-acquisition', { focusedAge: '1h', reads: ctx.calls.length - since, held });
});

test('Task9 enabled analytics proves one manual adoption event before automatic reliability-only records', async ({ page }, testInfo) => {
    const { lifecycle, ctx } = await setup(page, { analyticsEnabled: true }); await settle(page);
    await revealRefreshButton(page, 'EPIC-1'); await refreshButton(page, 'EPIC-1').click();
    await expect.poll(() => page.evaluate(() => (window.dataLayer || []).filter(entry => entry.event_name === 'epic_refresh_action').length)).toBe(1); await settle(page);
    const before = await page.evaluate(() => window.dataLayer.length);
    await lifecycle.returnAfter(13 * 60000); await expect(page.locator('[data-dashboard-freshness-status]')).toHaveText(/Checked .* ago/); await settle(page);
    const entries = await page.evaluate(before => window.dataLayer.slice(before), before);
    expect(entries.length).toBeGreaterThan(0); expect(entries.every(entry => entry.event === 'userevent' && entry.event_name === 'api_result')).toBe(true);
    expect(entries.some(entry => entry.api_surface === 'epic_refresh')).toBe(true);
    expect(entries.filter(entry => entry.event_name === 'epic_refresh_action')).toHaveLength(0);
    for (const entry of entries) {
        expect(Object.keys(entry).some(key => /issue.?key|issue.?id|account|summary|email|coordinate|timestamp|checked_at|absence|context|session_epoch|^has_|event_group|ga4_event_name/i.test(key))).toBe(false);
        expect(JSON.stringify(entry)).not.toMatch(/EPIC-\d|E\d-S\d|Alpha Team|synthetic story|group-alpha|team-alpha/);
    }
    await evidence(testInfo, 'task9-enabled-dataLayer', { manualAdoptionEvents: 1, automaticEntries: entries });
});

test('Task9 unknown-provenance EPM attempt shows checked-but-unconfirmed copy without claiming forced freshness', async ({ page }) => {
    const { lifecycle } = await setupEpmFreshness(page); await settle(page);
    await expect(page.locator('[data-dashboard-freshness-status]')).toHaveCount(0);
    await lifecycle.advance(1); await lifecycle.returnAfter(13 * 60000);
    await expect(page.locator('[data-dashboard-freshness-status]')).toHaveText(/^Checked .* ago; freshness unconfirmed$/);
    await task9Screenshot(page, 'status-unverified');
});

test('Task9 display-only filter Team sort and Initiative grouping changes acquire nothing', async ({ page }) => {
    const { ctx } = await setup(page); await settle(page); const since=ctx.calls.length;
    await page.getByRole('button',{name:'Filters',exact:true}).click();await page.getByRole('group',{name:'Status',exact:true}).getByRole('button',{name:/in progress/i}).click();await page.keyboard.press('Escape');
    await page.locator('.team-dropdown-toggle:visible').click();await page.locator('.team-dropdown-panel:visible').getByText('Alpha Team',{exact:true}).click();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Group by Initiative',exact:true}).click();
    await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle:visible').click();await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-option', {hasText:'Flexible ⬇'}).click();
    await settle(page);expect(ctx.calls.length).toBe(since);await expect(page.locator('[data-dashboard-freshness-status]')).toHaveCount(0);
});



test('automatic EPM removal retains the selected Project identity and displays unavailable instead of All projects', async ({ page }) => {
    const { lifecycle } = await setupEpmFreshness(page);
    const picker = page.locator('.epm-project-dropdown').first();
    await expect(picker.locator('.sprint-dropdown-toggle')).toContainText('All projects');
    await picker.locator('.sprint-dropdown-toggle').click();
    await picker.locator('[data-project-id="home-1"]').click();
    await expect(picker.locator('.sprint-dropdown-toggle')).toContainText('Connected Home Project');
    await settle(page);
    const calls = [];
    await page.route('**/api/epm/projects**', route => {
        calls.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [], cacheHit: false }) });
    });
    await lifecycle.advance(1);
    await lifecycle.returnAfter(13 * 60000);
    await expect(picker.locator('.sprint-dropdown-toggle')).toContainText('Project unavailable');
    await expect(page.locator('.epm-project-board')).toHaveCount(0);
    await settle(page);
    expect(calls).toEqual(['/api/epm/projects']);
    expect(await picker.locator('.sprint-dropdown-toggle').innerText()).not.toContain('All projects');
});


test('automatic due Sprint catalog read retains a removed selection and shows scope guidance', async ({ page }) => {
    const { SPRINT_ID, SPRINT_NAME } = require('./eng_epic_refresh_fixture');
    let removed = false;
    const validatedAt = new Date().toISOString();
    const { ctx, lifecycle } = await setup(page, { configure: fixture => {
        fixture.respond('/api/sprints', ({ json }) => json({
            sprints: removed ? [{ id: SPRINT_ID + 1, name: 'Synthetic next Sprint', state: 'active' }] : [{ id: SPRINT_ID, name: SPRINT_NAME, state: 'active' }],
            cache: { validatedAt, catalogVersion: 'synthetic-version' },
        }));
    } });
    await settle(page);
    const selectedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')).selectedSprint);
    removed = true;
    const since = ctx.calls.length;
    await lifecycle.returnAfter(24 * 60 * 60000 + 1000);
    await expect(page.getByText('Selected Sprint is unavailable. Choose a Sprint or refresh the catalog.')).toBeVisible();
    await settle(page);
    const catalogs = ctx.calls.slice(since).filter(call => call.pathname === '/api/sprints');
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].params.refresh).toBeUndefined();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')).selectedSprint)).toBe(selectedBefore);
    await expect(taskCard(page, 'E3-S01')).toBeVisible();
});

async function planningSelectionStorage(page) {
    return page.evaluate(() => ({
        planning: JSON.parse(localStorage.getItem('jira_dashboard_planning_state_v1') || '{}')['planning::3001::group-alpha'],
        teams: JSON.parse(localStorage.getItem('jira_dashboard_team_selection_state_v1') || '{}')['team-selection::3001::group-alpha'],
    }));
}

test('automatic Planning keeps a selected Story that left the Sprint until a manual Refresh reconciles it', async ({ page }, testInfo) => {
    const { ctx, lifecycle } = await setup(page, { prefs: { planningLayout: 'list' } });
    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Planning', exact: true }).click(); await settle(page);
    await page.getByRole('checkbox', { name: 'Select E3-S01 for sprint planning', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select E2-S01 for sprint planning', exact: true }).check(); await settle(page);
    const before = await planningSelectionStorage(page);
    expect(before.planning.selectedTaskKeys).toContain('E3-S01');
    await taskCard(page, 'E1-S01').scrollIntoViewIfNeeded(); await settle(page);
    const since = ctx.calls.length;
    ctx.scenario.stories = ctx.scenario.stories.filter(story => story.key !== 'E3-S01');
    ctx.scenario.stories.find(story => story.key === 'E2-S01').fields.summary = 'Synthetic accepted disappearance witness';
    await lifecycle.returnAfter(13 * 60000);
    await expect(taskCard(page, 'E2-S01')).toContainText('Synthetic accepted disappearance witness'); await settle(page);
    // Ordinary automatic reads cannot prove complete Sprint membership, so a Story absent from the answer is held, not removed.
    await expect(taskCard(page, 'E3-S01')).toHaveCount(1);
    await expect(page.getByRole('checkbox', { name: 'Select E3-S01 for sprint planning', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Select E2-S01 for sprint planning', exact: true })).toBeChecked();
    expect(await planningSelectionStorage(page)).toEqual(before);
    expect(ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose)).toHaveLength(2);
    await task9Screenshot(page, 'planning-disappearing-selected-story');
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click(); await settle(page);
    await expect(taskCard(page, 'E3-S01')).toHaveCount(0);
    const manual = await planningSelectionStorage(page);
    expect(manual.planning.selectedTaskKeys).not.toContain('E3-S01');
    expect(manual.planning.selectedTaskKeys).toContain('E2-S01');
    await evidence(testInfo, 'automatic-disappearing-story-selection', { before, automatic: before, manual });
});

test('automatic Planning preserves a selected Team after its last Story leaves and manual Refresh keeps normal reconciliation', async ({ page }, testInfo) => {
    const { groupsConfigPayload } = require('./eng_epic_refresh_fixture');
    const scenario = buildScenario();
    Object.assign(scenario.stories.find(story => story.key === 'E3-S01').fields, { teamId: 'team-beta', teamName: 'Beta Team' });
    const { ctx, lifecycle } = await setup(page, { scenario, prefs: { planningLayout: 'list' }, configure: fixture => fixture.respond('/api/groups-config', ({ json }) => json({
        ...groupsConfigPayload, groups: groupsConfigPayload.groups.map(group => ({ ...group, teamIds: ['team-alpha', 'team-beta'] })),
    })) });
    await page.getByRole('radiogroup', { name: 'ENG view mode' }).getByRole('radio', { name: 'Planning', exact: true }).click(); await settle(page);
    await page.getByRole('button', { name: 'Filter teams', exact: true }).click();
    await page.locator('.team-dropdown-panel:visible').getByRole('checkbox', { name: 'Beta Team', exact: true }).check();
    await page.locator('.view-selector .controls-label').click(); await settle(page);
    await expect(page.locator('.team-dropdown-selection-label:visible')).toHaveText('Beta Team');
    await page.getByRole('checkbox', { name: 'Select E3-S01 for sprint planning', exact: true }).check(); await settle(page);
    const before = await planningSelectionStorage(page);
    expect(before.teams.selectedTeams).toEqual(['team-beta']);
    Object.assign(ctx.scenario.stories.find(story => story.key === 'E3-S01').fields, { teamId: 'team-alpha', teamName: 'Alpha Team', summary: 'Synthetic remotely changed Team' });
    const since = ctx.calls.length;
    await lifecycle.returnAfter(13 * 60000); await settle(page);
    await expect.poll(() => ctx.calls.slice(since).filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose)).toHaveLength(2);
    expect(await planningSelectionStorage(page)).toEqual(before);
    await expect(page.locator('.team-dropdown-toggle:visible')).toHaveClass(/active-filter/);
    await page.getByRole('button', { name: 'Filter teams', exact: true }).click();
    await expect(page.locator('.team-dropdown-panel:visible').getByRole('checkbox', { name: 'Beta Team', exact: true })).toBeChecked();
    await page.locator('.view-selector .controls-label').click();
    await task9Screenshot(page, 'planning-disappearing-selected-team');
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click(); await settle(page);
    await expect(page.locator('.team-dropdown-selection-label:visible')).toHaveText('Beta Team');
    const manual = await planningSelectionStorage(page);
    expect(manual.teams.selectedTeams).toEqual(['team-beta']);
    expect(manual.planning.selectedTeams).toEqual(['team-beta']);
    expect(manual.planning.selectedTaskKeys).not.toContain('E3-S01');
    await evidence(testInfo, 'automatic-disappearing-team-selection', { before, automatic: before, manual });
});
