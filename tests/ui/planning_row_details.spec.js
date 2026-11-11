const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const root = path.join(__dirname, '..', '..');
let js, css;

test.beforeAll(() => {
    js = esbuild.buildSync({ stdin: { resolveDir: root, loader: 'jsx', contents: `
        import * as React from 'react';
        import {createRoot} from 'react-dom/client';
        import PlanningReviewTable from './frontend/src/eng/PlanningReviewTable.jsx';
        import {resolveEntityNames} from './frontend/src/eng/engWorkModel.js';
        const stories=[1,2].map(id=>({id:String(id),key:'SYN-'+id,fields:{summary:'Synthetic child '+id,status:{name:'To Do'},priority:{name:'High'},customfield_10004:id,issuetype:{name:window.mapped?'Epic':'Story'},subtaskSummary:id===1?{total:2,done:0,inProgress:1,waiting:1,percentComplete:0,statusCounts:{}}:null}}));
        const epics=[{key:'SYN-100',epic:{id:'100',key:'SYN-100',summary:'Synthetic parent',status:'To Do',priority:{name:'High'},issuetype:{name:window.mapped?'Initiative':'Epic'}},tasks:stories,requirements:[]}];
        const dependencies={'SYN-1':Array.from({length:25},(_,i)=>({key:'SYN-'+(i+2),category:'dependency',direction:'outward'}))};
        const review={contextKey:'initial-namespace',groupId:'synthetic',sprintId:'101',columns:[],cells:{},layouts:{},capabilities:{canRead:true,canSave:true},schemaRevision:1,isRowReadable:()=>true,changeSchema:()=>true,discard:()=>true};
        const details={backendUrl:'https://details.synthetic.invalid',sprintId:'101',dependencyData:dependencies,issueByKey:new Map(stories.map(issue=>[issue.key,issue])),dependencyIncomplete:window.incomplete,entityNames:resolveEntityNames(window.mapped?'rnd_2027':'legacy')};
        function App(){const[selected,setSelected]=React.useState(new Set());const[detailsState,setDetailsState]=React.useState(details);const[contextKey,setContextKey]=React.useState(review.contextKey);React.useEffect(()=>{window.changeReviewContext=setContextKey;window.refreshDetailsDependencies=keys=>setDetailsState(previous=>({...previous,dependencyData:{'SYN-1':keys.map(key=>({key,category:'dependency',direction:'outward'}))}}));},[]);return <PlanningReviewTable epicGroups={epics} visibleTasks={stories} review={{...review,contextKey}} selectedStoryKeys={selected} jiraUrl="https://jira.synthetic.invalid" workModel={window.mapped?'rnd_2027':'legacy'} rowDetailsContext={detailsState} onToggleStory={task=>setSelected(prev=>new Set(prev.has(task.key)?[...prev].filter(key=>key!==task.key):[...prev,task.key]))}/>}
        createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text;
    css = esbuild.buildSync({ entryPoints: [path.join(root, 'frontend/src/styles/dashboard.css')], bundle: true, write: false }).outputFiles[0].text;
});

async function install(page, { mapped = false, incomplete = false, lookup = null } = {}) {
    const requests = [];
    page.on('pageerror', error => { throw error; });
    await page.route('https://details.synthetic.invalid/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<style>${css} *,*::before,*::after{animation:none!important;transition:none!important}</style><div id="root"></div>` });
        requests.push({ method: request.method(), path: url.pathname, keys: url.searchParams.get('keys') });
        if (url.pathname === '/api/issues/lookup') {
            if (lookup) return lookup(route, url.searchParams.get('keys').split(','));
            return route.fulfill({ json: { issues: url.searchParams.get('keys').split(',').map(key => ({ key, summary: 'Related '+key, status: 'To Do', storyPoints: 1 })) } });
        }
        if (url.pathname === '/api/issues/subtasks') return route.fulfill({ json: { summary: { total: 2, done: 0, inProgress: 1, waiting: 1, percentComplete: 0, statusCounts: {} }, subtasks: [{ id: '201', key: 'SYN-201', summary: 'Synthetic subtask', status: { name: 'In Progress' }, updated: '2026-01-01' }] } });
        return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('https://details.synthetic.invalid/');
    await page.evaluate(({ mapped, incomplete }) => { window.mapped = mapped; window.incomplete = incomplete; }, { mapped, incomplete });
    await page.addScriptTag({ content: js });
    await expect(page.locator('.planning-review-table tbody tr')).toHaveCount(1);
    return requests;
}

test('Table details preserve row geometry, use read-only cards and return keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const requests = await install(page);
    const row = page.locator('.planning-review-table tbody tr').first();
    const before = await row.evaluate(node => ({ height: node.getBoundingClientRect().height, summary: node.querySelector('.planning-review-summary').getBoundingClientRect().width }));
    await page.screenshot({ path: path.join(root, 'tmp/planning-331-integration/details-table-1440-before-open.png') });
    const trigger = page.getByRole('button', { name: 'View details for SYN-100', exact: true });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Details for SYN-100', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Synthetic parent', { exact: true })).toBeVisible();
    await expect(panel.getByRole('checkbox')).toHaveCount(0);
    await expect(panel.locator('.status-transition-trigger,.priority-transition-trigger,.issue-person-editor-trigger,.task-remove')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Show next children', exact: true }).click();
    await expect(panel.getByText('Synthetic child 1', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(root, 'tmp/planning-331-integration/details-table-1440-open.png') });
    expect(requests).toEqual([]);
    const overlay = await panel.evaluate(node => { const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,above:node.contains(document.elementFromPoint(r.left+10,r.top+10))}; });
    expect(overlay.top).toBeGreaterThanOrEqual(0); expect(overlay.bottom).toBeLessThanOrEqual(900); expect(overlay.above).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
    expect(await row.evaluate(node => ({ height: node.getBoundingClientRect().height, summary: node.querySelector('.planning-review-summary').getBoundingClientRect().width }))).toEqual(before);
    expect(before.height).toBe(32);
});

test('native dependency clicks and subtask expansion load only explicit bounded batches locally', async ({ page }) => {
    const requests = await install(page, { incomplete: true });
    await page.getByRole('radio', { name: 'Stories', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select SYN-1', exact: true }).check();
    await page.getByRole('button', { name: 'View details for SYN-1', exact: true }).hover();
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: 'View details for SYN-1', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Details for SYN-1', exact: true });
    await expect(panel.getByText(/Dependency information is incomplete/)).toBeVisible();
    expect(requests).toEqual([]);
    await panel.getByRole('button', { name: 'Depends on 25 tasks', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('region', { name: 'Depends on related issues', exact: true }).locator('.task-item')).toHaveCount(20);
    expect(requests.filter(item=>item.path==='/api/issues/lookup').map(item=>item.keys.split(',').length)).toEqual([19]);
    await panel.getByRole('button', { name: 'Load next related issues', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Depends on related issues', exact: true }).locator('.task-item')).toHaveCount(25);
    expect(requests.filter(item=>item.path==='/api/issues/lookup').map(item=>item.keys.split(',').length)).toEqual([19,5]);
    await panel.getByRole('button', { name: 'Show subtasks for SYN-1', exact: true }).click();
    await expect(panel.getByText('Synthetic subtask', { exact: true })).toBeVisible();
    await expect(panel.getByText('Subtask results are incomplete. 1 of 2 loaded.', { exact: true })).toBeVisible();
    expect(requests.filter(item=>item.path==='/api/issues/subtasks')).toHaveLength(1);
    expect(requests.every(item=>item.method==='GET')).toBe(true);
    await panel.getByRole('button', { name: 'Close details', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select SYN-1', exact: true })).toBeChecked();
});

test('related lookup has one flight, preserves failures and retries unavailable work explicitly', async ({ page }) => {
    let release, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const requests = await install(page, { lookup: async (route, keys) => {
        calls++;
        if (calls === 1) { await gate; return route.fulfill({ status: 503, json: {} }); }
        return route.fulfill({ json: { issues: (calls === 2 ? keys.slice(0, 1) : keys).map(key => ({ key, summary: key })) } });
    } });
    await page.getByRole('radio', { name: 'Stories', exact: true }).check();
    await page.getByRole('button', { name: 'View details for SYN-1', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Details for SYN-1', exact: true });
    const chip = panel.getByRole('button', { name: 'Depends on 25 tasks', exact: true });
    await chip.click(); await expect.poll(() => calls).toBe(1);
    await chip.click(); expect(calls).toBe(1);
    release();
    await expect(panel.getByRole('alert')).toHaveText('Related issues could not be loaded. Retry this batch.');
    await panel.getByRole('button', { name: 'Retry related issues', exact: true }).click();
    await expect(panel.getByText('18 related issues are unavailable.', { exact: true })).toBeVisible();
    expect(calls).toBe(2);
    await panel.getByRole('button', { name: 'Retry related category', exact: true }).click();
    await expect(panel.getByText(/related issues are unavailable/)).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'Depends on related issues', exact: true }).locator('.task-item')).toHaveCount(20);
    expect(calls).toBe(3);
    expect(requests.every(request => request.method === 'GET' && request.keys.split(',').length <= 20)).toBe(true);
    await page.locator('.planning-review-controls').click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View details for SYN-1', exact: true })).toBeFocused();
});

test('mapped parent/child details and portal remain inside the desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await install(page, { mapped: true });
    await page.getByRole('button', { name: 'View details for SYN-100', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Details for SYN-100', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('2 Epics in the current view.', { exact: true })).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(1280);
});


test('related pagination retains its chosen snapshot across a dependency refresh', async ({ page }) => {
    const requests = await install(page);
    await page.getByRole('radio', { name: 'Stories', exact: true }).check();
    await page.getByRole('button', { name: 'View details for SYN-1', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Details for SYN-1', exact: true });
    await panel.getByRole('button', { name: 'Depends on 25 tasks', exact: true }).click();
    const region = panel.getByRole('region', { name: 'Depends on related issues', exact: true });
    await expect(region.locator('.task-item')).toHaveCount(20);
    await page.evaluate(() => window.refreshDetailsDependencies([
        ...Array.from({ length: 5 }, (_, index) => 'SYN-' + (1000 + index)),
        ...Array.from({ length: 25 }, (_, index) => 'SYN-' + (2 + index)),
    ]));
    await expect(panel.getByRole('button', { name: 'Depends on 30 tasks', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Load next related issues', exact: true }).click();
    await expect(region.locator('.task-item')).toHaveCount(25);
    expect(requests.filter(request => request.path === '/api/issues/lookup').map(request => request.keys.split(',').length)).toEqual([19, 5]);
    await expect(region.getByText('Related SYN-1000', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Load next related issues', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Depends on 30 tasks', exact: true }).click();
    await expect(region.locator('.task-item')).toHaveCount(20);
    await expect(region.getByText('Related SYN-1000', { exact: true })).toBeVisible();
});


test('a review namespace change closes details and aborts old lookups without taking focus', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const requests = await install(page, { lookup: async (route, keys) => {
        await gate;
        return route.fulfill({ json: { issues: keys.map(key => ({ key, summary: 'Old source '+key })) } }).catch(() => {});
    } });
    await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.detailsLookupAborted = false;
        window.fetch = (url, options) => {
            if (String(url).includes('/api/issues/lookup')) options.signal.addEventListener('abort', () => { window.detailsLookupAborted = true; }, { once: true });
            return originalFetch(url, options);
        };
    });
    const stories = page.getByRole('radio', { name: 'Stories', exact: true });
    await stories.check();
    await page.getByRole('button', { name: 'View details for SYN-1', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Details for SYN-1', exact: true });
    await panel.getByRole('button', { name: 'Depends on 25 tasks', exact: true }).click();
    await expect.poll(() => requests.filter(request => request.path === '/api/issues/lookup').length).toBe(1);
    // Preserve the same group, Sprint, row and source; only the review namespace changes.
    await stories.focus();
    await page.evaluate(() => window.changeReviewContext('replacement-namespace'));
    await expect(panel).toHaveCount(0);
    await expect(stories).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.detailsLookupAborted)).toBe(true);
    release();
    await page.getByRole('button', { name: 'View details for SYN-1', exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/^Old source /)).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'Depends on related issues', exact: true })).toHaveCount(0);
});
