const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const root = path.join(__dirname, '..', '..');
let js, css;
test.beforeAll(() => {
    fs.mkdirSync(path.join(root, 'tmp', '217-ui'), { recursive: true });
    js = esbuild.buildSync({ stdin: { resolveDir: root, loader: 'jsx', contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import PlanningReviewTable, { PlanningReviewScopeDialog } from './frontend/src/eng/PlanningReviewTable.jsx';
        import { createPlanningSprintReviewController } from './frontend/src/eng/usePlanningSprintReview.js';
        const stories = Array.from({length:window.longReview?60:3},(_,i)=>i+1).map(id => ({id:String(id),key:'DEMO-'+id,fields:{summary:'Story '+id,customfield_10004:id,teamId:'alpha',teamName:'Alpha',projectKey:'DEMO',status:{name:'To Do'},priority:{name:'High'}}}));
        const epics=[{key:'DEMO-10',epic:{id:'10',key:'DEMO-10',summary:'Epic summary',status:{name:'To Do'},priority:{name:'High'},teamName:'Own Team'},tasks:stories.slice(0,2),requirements:[]},{key:'DEMO-20',epic:{id:'20',key:'DEMO-20',summary:'Readiness Epic'},tasks:[],requirements:[{id:'required',team:{name:'Beta'}}]}];
        const columns=Array.from({length:8},(_,i)=>({id:'cost'+i,rowKind:'story',label:'Cost '+i,type:'number',aggregation:'sum',archived:false,order:i}));
        let saveCount=0; let savedSchema={schemaRevision:1,columns,layouts:{},capabilities:{canRead:true,canSave:true}};
        const controller=createPlanningSprintReviewController({fetchSchema:async()=>savedSchema,readValues:async(_,__,body)=>({cells:body.issueIds.flatMap(id=>columns.map(column=>({issueId:id,rowKind:body.rowKind,columnId:column.id,value:id==='1'?'2.000':'10.000',revision:1})))}),saveReview:async(_,__,payload)=>{saveCount++; savedSchema={...savedSchema,schemaRevision:savedSchema.schemaRevision+1,columns:controller.getState().columns,layouts:controller.getState().layouts}; return {...savedSchema,cells:payload.cellChanges.map(cell=>({...cell,revision:2}))}}});
        window.harness={state:()=>controller.getState(),saveCount:()=>saveCount,reload:()=>controller.refresh()};
        function App(){
            const state=React.useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
            const [selected,setSelected]=React.useState(new Set());
            const [visible,setVisible]=React.useState(true);
            React.useEffect(()=>{controller.setScope({sprintId:'100',contextKey:'actor',active:true,rows:[...stories.map(task=>({issueId:task.id,rowKind:'story'})),...epics.map(group=>({issueId:group.epic.id,rowKind:'epic'}))]});},[]);
            return <div className="container"><div id="reference">Header reference</div><button id="layout" onClick={()=>setVisible(!visible)}>Layout</button>{visible&&<PlanningReviewTable epicGroups={epics} visibleTasks={stories} selectedStoryKeys={selected} onToggleStory={task=>setSelected(previous=>{const next=new Set(previous);if(next.has(task.key))next.delete(task.key);else next.add(task.key);return next})} onSelectStories={(tasks,on)=>setSelected(previous=>{const next=new Set(previous);tasks.forEach(task=>on?next.add(task.key):next.delete(task.key));return next})} jiraUrl="https://jira.example" review={{...state,...controller}} admittedTeamCount={2} admittedProjectCount={2} renderFieldEditor={({row,field,value})=>field==='team'||field==='inclusion'?<button className={field==='inclusion'?'epic-stat-toggle '+(row.key==='DEMO-2'?'':'active'):'planning-action-button'} aria-label={field+' for '+row.key}>{field==='inclusion'?(row.key==='DEMO-2'?'Excluded':'Included'):row.team?.name||'Unknown Team'}</button>:value}/>}<PlanningReviewScopeDialog review={{...state,...controller}}/></div>
        }
        createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text;
    css = esbuild.buildSync({ entryPoints: [path.join(root, 'frontend/src/styles/dashboard.css')], bundle: true, write: false }).outputFiles[0].text;
});
async function install(page, longReview = false) {
    await page.setContent(`<style>${css} *,*::before,*::after{animation:none!important;transition:none!important}</style><div id="root"></div>`);
    await page.evaluate(value => {window.longReview=value},longReview);
    await page.addScriptTag({ content: js });
    await expect(page.getByRole('region', { name: 'Planning Sprint review' })).toBeVisible();
    await expect(page.getByText('Loading review…')).toHaveCount(0);
}

test('real selection and readiness/orphan rows, explicit metadata columns and shared controls', async ({ page }) => {
    await install(page);
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.getByRole('checkbox', { name: 'Select DEMO-10', exact: true }).check();
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select DEMO-1', exact: true })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Select DEMO-1', exact: true }).uncheck();
    await page.getByRole('radio', { name: 'Epics', exact: true }).click();
    expect(await page.getByRole('checkbox', { name: 'Select DEMO-10', exact: true }).evaluate(node => node.indeterminate)).toBe(true);
    await expect(page.getByRole('checkbox', { name: 'Select No Epic', exact: true })).toBeDisabled();
    await expect(page.getByRole('columnheader', {name:'Fields',exact:true})).toHaveCount(0);
    await expect(page.getByLabel('team for DEMO-10')).toBeVisible();
    await expect(page.getByLabel('inclusion for DEMO-10')).toHaveCount(0);
    await page.getByRole('button',{name:'Columns',exact:true}).click();
    await page.getByRole('checkbox',{name:'Capacity',exact:true}).check();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('inclusion for DEMO-10')).toBeVisible();
    const control = page.getByRole('radiogroup', { name: 'Planning review rows' });
    await expect(control).toHaveClass(/eng-mode-control/);
    expect(await control.evaluate(node => getComputedStyle(node).flexWrap)).toBe('nowrap');
    const geometry = await control.locator('button').evaluateAll(nodes => nodes.map(node => {const rect=node.getBoundingClientRect();return {top:rect.top,height:rect.height};}));
    expect(geometry[0].top).toBe(geometry[1].top); expect(geometry[0].height).toBeLessThanOrEqual(42);
});

test('dirty typing survives layout, Escape cancels, sorting waits until blur and save is explicit', async ({ page }) => {
    await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await page.getByRole('button', { name: 'Cost 0', exact: true }).click();
    const cell = page.getByRole('textbox', { name: 'Cost 0 for DEMO-1', exact: true });
    await cell.fill('99');
    expect(await page.locator('tbody tr').first().innerText()).toContain('DEMO-1');
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(true);
    expect(await page.evaluate(() => window.harness.saveCount())).toBe(0);
    await cell.press('Escape');
    await expect(cell).toHaveValue('2.000');
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(false);
    await cell.fill('99'); await page.locator('#layout').click(); await page.locator('#layout').click();
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Cost 0 for DEMO-1', exact: true })).toHaveValue('99');
    await page.getByRole('button', { name: 'Save review', exact: true }).click();
    expect(await page.evaluate(() => window.harness.saveCount())).toBe(1);
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(false);
});

test('390px creation fits, frozen keys and last-column reachability at desktop and zoom', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 }); await install(page);
    await page.getByRole('button', { name: '+ Add column', exact: true }).click();
    await page.getByLabel('Column name', { exact: true }).fill('Risk');
    await page.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Risk for DEMO-10', exact: true })).toBeFocused();
    const overflow = await page.evaluate(() => ({ body:document.documentElement.scrollWidth, width:window.innerWidth }));
    expect(overflow.body).toBeLessThanOrEqual(overflow.width);
    await page.screenshot({ path: path.join(root, 'tmp/217-ui/planning-review-narrow.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const scroller = page.locator('.planning-review-scroll');
    const before = await page.locator('tbody .planning-review-key').first().boundingBox();
    await scroller.evaluate(node => { node.scrollLeft = node.scrollWidth; });
    const after = await page.locator('tbody .planning-review-key').first().boundingBox();
    expect(Math.abs(before.x-after.x)).toBeLessThan(1);
    await expect(page.getByRole('textbox', { name: 'Cost 7 for DEMO-1', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Cost 7', exact: true }).hover();
    const hover = await page.getByRole('button', { name: 'Cost 7', exact: true }).evaluate(node => ({ background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color,transform:getComputedStyle(node).transform,shadow:getComputedStyle(node).boxShadow }));
    expect(hover.background).toBe('rgb(226, 232, 240)'); expect(hover.color).toBe('rgb(15, 23, 42)'); expect(hover.transform).toBe('none'); expect(hover.shadow).toBe('none');
    await page.screenshot({ path: path.join(root, 'tmp/217-ui/planning-review-desktop.png'), fullPage: true });
    // Browser zoom reduces the CSS layout viewport; a body CSS transform does not.
    await page.setViewportSize({ width: Math.round(1280 / 1.5), height: Math.round(900 / 1.5) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('column creation controls share a compact baseline and height', async ({page}) => {
    await install(page);
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const controls = await page.locator('.planning-review-add input, .planning-review-add select, .planning-review-add button').evaluateAll(nodes => nodes.map(node => {const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {tag:node.tagName,bottom:r.bottom,height:r.height,margin:s.margin};}));
    expect(Math.max(...controls.map(r=>r.bottom))-Math.min(...controls.map(r=>r.bottom)),JSON.stringify(controls)).toBeLessThan(1);
    expect(Math.max(...controls.map(r=>r.height))-Math.min(...controls.map(r=>r.height))).toBeLessThan(1);
    await page.screenshot({path:path.join(root,'tmp/217-ui/planning-review-controls.png'),fullPage:true});
});

for (const width of [390,1280]) test(`totals remain pinned and aligned while scrolling ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:850});await install(page,true);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const scroll=page.locator('.planning-review-scroll');
    const footer=page.locator('tfoot .planning-review-selection');
    await expect(footer).toBeInViewport();
    const before=await footer.boundingBox();
    await scroll.evaluate(node=>{node.scrollTop=500;node.scrollLeft=500});
    const after=await footer.boundingBox();
    expect(Math.abs(before.y-after.y)).toBeLessThan(1);
    await expect(footer).toBeInViewport();
    const totals=page.locator('tfoot .planning-review-storyPoints');
    await expect(totals).toHaveText('1830');
    const alignment=await page.locator('.planning-review-storyPoints').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));
    expect(Math.max(...alignment)-Math.min(...alignment)).toBeLessThan(1);
    await page.screenshot({path:path.join(root,`tmp/217-ui/planning-review-pinned-${width}.png`),fullPage:true});
});

for(const width of [390,1280]) test(`column tools open as anchored popups without moving the table at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:850});await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const table=page.locator('.planning-review-scroll');const before=await table.boundingBox();
    const add=page.getByRole('button',{name:'+ Add column',exact:true});const columns=page.getByRole('button',{name:'Columns',exact:true});
    await add.click();const creation=page.getByRole('dialog',{name:'Add review column',exact:true});await expect(creation).toBeVisible();
    expect(Math.abs((await table.boundingBox()).y-before.y)).toBeLessThan(1);
    await expect(creation.getByLabel('Column name',{exact:true})).toBeFocused();
    await creation.getByLabel('Column name',{exact:true}).fill('Risk');
    const popup=await creation.boundingBox();expect(popup.x).toBeGreaterThanOrEqual(0);expect(popup.x+popup.width).toBeLessThanOrEqual(width);expect(popup.y+popup.height).toBeLessThanOrEqual(850);
    await creation.getByLabel('Column name',{exact:true}).press('Escape');await expect(creation).toHaveCount(0);await expect(add).toBeFocused();
    await add.click();await columns.click();await expect(creation).toHaveCount(0);
    const management=page.getByRole('dialog',{name:'Review column management',exact:true});await expect(management).toBeVisible();
    expect(Math.abs((await table.boundingBox()).y-before.y)).toBeLessThan(1);
    const front=await management.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+12,r.top+12));});expect(front).toBe(true);
    await page.screenshot({path:path.join(root,`tmp/217-ui/planning-review-column-popup-${width}.png`),fullPage:true});
    const managerBounds=await management.boundingBox();expect(managerBounds.y).toBeGreaterThanOrEqual(0);expect(managerBounds.y+managerBounds.height).toBeLessThanOrEqual(850);
    await management.getByRole('textbox',{name:'Name for Cost 0',exact:true}).fill('Cost estimate');
    await page.locator('#reference').click();await expect(management).toHaveCount(0);
    expect(await page.evaluate(()=>window.harness.state().columns.find(column=>column.id==='cost0').label)).toBe('Cost estimate');
    await columns.click();await management.getByRole('button',{name:'Done',exact:true}).click();await expect(management).toHaveCount(0);await expect(columns).toBeFocused();
});

 test('drag custom columns between Jira columns, keyboard reorder and shared visibility survive reload', async ({page}) => {
    await page.setViewportSize({width:2400,height:900});
    await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const headers=()=>page.locator('thead th').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).filter(Boolean));
    await page.getByRole('button',{name:'Move Cost 0 column',exact:true}).dragTo(page.getByRole('columnheader',{name:'Status',exact:true}),{targetPosition:{x:4,y:15}});
    expect((await headers()).slice(0,4)).toEqual(['Key','Summary','Cost 0','Status']);
    expect(await page.evaluate(()=>window.harness.saveCount())).toBe(0);
    await page.getByRole('button',{name:'Move Cost 0 column',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    expect((await headers()).slice(0,4)).toEqual(['Key','Summary','Status','Cost 0']);
    await page.getByRole('button',{name:'Columns',exact:true}).click();
    await page.getByRole('checkbox',{name:'Assignee',exact:true}).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader',{name:'Assignee',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Save review',exact:true}).click();
    await page.evaluate(()=>window.harness.reload());
    expect((await headers()).slice(0,4)).toEqual(['Key','Summary','Status','Cost 0']);
    await expect(page.getByRole('columnheader',{name:'Assignee',exact:true})).toHaveCount(0);
    const value=page.getByRole('textbox',{name:'Cost 0 for DEMO-1',exact:true});
    await expect(value).toHaveValue('2.000');
    await page.screenshot({path:path.join(root,'tmp/217-ui/drag-shared-layout.png'),fullPage:true});
 });

for(const mode of ['Epics','Stories']) test(`optional metadata hidden by default and explicit visibility persists in ${mode}`,async({page})=>{
    await install(page);
    await page.getByRole('radio',{name:mode,exact:true}).click();
    for(const name of ['Component','Project','Capacity']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Columns',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Review column management',exact:true});
    for(const name of ['Component','Project','Capacity']) {
        await expect(popup.getByRole('checkbox',{name,exact:true})).not.toBeChecked();
        await popup.getByRole('checkbox',{name,exact:true}).check();
    }
    for(const name of ['Key','Summary','Status','Priority']) await expect(popup.getByRole('checkbox',{name,exact:true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    for(const name of ['Component','Project','Capacity']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    await page.getByRole('button',{name:'Save review',exact:true}).click();await page.evaluate(()=>window.harness.reload());
    for(const name of ['Component','Project','Capacity']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    await page.getByRole('button',{name:'Columns',exact:true}).click();
    for(const name of ['Component','Project','Capacity']) await popup.getByRole('checkbox',{name,exact:true}).uncheck();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Save review',exact:true}).click();await page.evaluate(()=>window.harness.reload());
    for(const name of ['Component','Project','Capacity']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(root,`tmp/217-ui/optional-columns-${mode}.png`),fullPage:true});
});

test('Capacity hover and keyboard focus retain readable light Included and Excluded chips',async({page})=>{
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'Columns',exact:true}).click();await page.getByRole('checkbox',{name:'Capacity',exact:true}).check();await page.keyboard.press('Escape');
    for(const [key,background,color] of [['DEMO-1','rgb(220, 252, 231)','rgb(22, 101, 52)'],['DEMO-2','rgb(226, 232, 240)','rgb(51, 65, 85)']]){
        const control=page.getByRole('button',{name:'inclusion for '+key,exact:true});
        await control.hover();await expect(control).toHaveCSS('background-color',background);await expect(control).toHaveCSS('color',color);
        await expect(control).toHaveCSS('transform','none');await expect(control).toHaveCSS('box-shadow','none');await expect(control).toHaveCSS('filter','none');
        await page.mouse.move(0,0);await page.keyboard.press('Tab');await control.focus();
        await expect(control).toBeFocused();await expect(control).toHaveCSS('outline-style','solid');
        expect(await control.evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe('rgb(17, 17, 17)');
    }
    await page.getByRole('button',{name:'inclusion for DEMO-1',exact:true}).hover();
    await page.screenshot({path:path.join(root,'tmp/217-ui/capacity-hover-readable.png'),fullPage:true});
});

test('uncreated Epic appears and its awaiting Story has a linked, noneditable placeholder',async({page})=>{
    await install(page);
    const epic=page.locator('tbody tr').filter({has:page.getByRole('link',{name:'DEMO-20',exact:true})});
    await expect(epic).toContainText('1 uncreated Story');await expect(epic.getByRole('checkbox')).toBeDisabled();
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const placeholder=page.locator('tbody tr').filter({hasText:'Story awaiting creation for Beta'});
    await expect(placeholder).toHaveCount(1);await expect(placeholder).toContainText('Not created');await expect(placeholder).toContainText('Awaiting creation');
    await expect(placeholder.getByRole('link',{name:'DEMO-20',exact:true})).toHaveAttribute('href','https://jira.example/browse/DEMO-20');
    await expect(placeholder.getByRole('checkbox')).toBeDisabled();await expect(placeholder.getByRole('textbox')).toHaveCount(0);
    await expect(placeholder.locator('.planning-review-storyPoints')).toHaveText('—');await expect(page.locator('tfoot .planning-review-storyPoints')).toHaveText('6');
    await page.screenshot({path:path.join(root,'tmp/217-ui/uncreated-story-placeholder.png'),fullPage:true});
});

for (const width of [1440, 2400]) test(`column widths fit their content instead of spreading sparse fields at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const cells=await page.locator('thead th').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.getAttribute('aria-label')||node.textContent,{width:node.getBoundingClientRect().width,scroll:node.scrollWidth,client:node.clientWidth}])));
    await page.screenshot({path:path.join(root,`tmp/217-ui/column-widths-${width}.png`),fullPage:true});
    expect(cells.Status.width).toBeLessThanOrEqual(150);
    expect(cells.Priority.width).toBeLessThanOrEqual(110);
    expect(cells['Project Track'].width).toBeLessThanOrEqual(135);
    expect(cells['Cost 0'].width).toBeLessThanOrEqual(105);
    for(const cell of Object.values(cells)) expect(cell.scroll).toBeLessThanOrEqual(cell.client+1);
});

for(const width of [390,1440]) test(`review toolbar is compact and options do not shift the table at ${width}px`, async({page})=>{
    await page.setViewportSize({width,height:900});await install(page);
    const toolbar=page.locator('.planning-review-toolbar');
    await expect(toolbar.getByText('Rows',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Drag column handles to reorder.',{exact:false})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Refresh review',exact:true})).toHaveCount(0);
    const controls=await toolbar.locator('.segmented-control, .planning-action-button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {height:r.height,y:r.y};}));
    expect(Math.max(...controls.map(c=>c.height))-Math.min(...controls.map(c=>c.height))).toBeLessThan(1);
    if(width>600) expect(Math.max(...controls.map(c=>c.y))-Math.min(...controls.map(c=>c.y))).toBeLessThan(1);
    const table=page.locator('.planning-review-scroll'),before=await table.boundingBox();
    await toolbar.getByRole('button',{name:'Review options',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Review options',exact:true});await expect(popup).toBeVisible();
    await expect(popup.getByRole('button',{name:'Refresh review',exact:true})).toBeVisible();
    expect((await table.boundingBox()).y).toBe(before.y);
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');await expect(toolbar.getByRole('button',{name:'Review options',exact:true})).toBeFocused();
    await toolbar.getByRole('button',{name:'+ Add column',exact:true}).hover();
    expect(await toolbar.getByRole('button',{name:'+ Add column',exact:true}).evaluate(node=>getComputedStyle(node).transform)).toBe('none');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:path.join(root,`tmp/217-ui/simple-toolbar-${width}.png`),fullPage:true});
    await toolbar.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Draft field');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    await expect(toolbar.getByText('Unsaved',{exact:true})).toBeVisible();
    await expect(toolbar.getByRole('button',{name:'Save review',exact:true})).toBeEnabled();
    await toolbar.getByRole('button',{name:'Review options',exact:true}).click();
    await popup.getByRole('button',{name:'Discard draft',exact:true}).click();
    await expect(popup).toHaveCount(0);await expect(toolbar.getByText('Unsaved',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('columnheader',{name:'Draft field',exact:true})).toHaveCount(0);
});

test('numeric headers, values, editors and totals align right; text aligns left',async({page})=>{
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await page.getByLabel('Column name',{exact:true}).fill('Notes');await page.locator('.planning-review-add select').selectOption('text');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    for(const [selector,alignment] of [['.planning-review-numeric','right'],['.planning-review-text','left']]){
        const values=await page.locator('.planning-review-table '+selector).evaluateAll(nodes=>nodes.flatMap(node=>[getComputedStyle(node).textAlign,...Array.from(node.querySelectorAll('input')).map(input=>getComputedStyle(input).textAlign)]));
        expect(values.length).toBeGreaterThan(0);for(const value of values)expect(value).toBe(alignment);
    }
    await page.screenshot({path:path.join(root,'tmp/217-ui/table-number-alignment.png'),fullPage:true});
});
