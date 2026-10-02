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
        const stories = Array.from({length:window.longReview?60:3},(_,i)=>i+1).map(id => ({id:String(id),key:'DEMO-'+id,fields:{summary:'Story '+id,customfield_10004:window.zeroStory&&id===3?null:id,teamId:'alpha',teamName:window.longNames?(id===1?'Research Long Named Alpha Engineering Team':'Research Long Named Beta Engineering Team'):'Alpha',projectKey:'DEMO',status:{name:'To Do'},priority:{name:'High'}}}));
        const epics=[{key:'DEMO-10',epic:{id:'10',key:'DEMO-10',summary:window.longNames?'Automate detailed calculations and adjustments across multiple supported integrations':'Epic summary',status:{name:'To Do'},priority:{name:'High'},teamName:'Own Team'},tasks:stories.slice(0,2),requirements:[]},{key:'DEMO-20',epic:{id:'20',key:'DEMO-20',summary:'Readiness Epic'},tasks:[],requirements:[{id:'required',team:{name:'Beta'}}]}];
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
async function install(page, longReview = false, longNames = false, zeroStory = false) {
    await page.setContent(`<style>${css} *,*::before,*::after{animation:none!important;transition:none!important}</style><div id="root"></div>`);
    await page.evaluate(({longReview,longNames,zeroStory}) => {window.longReview=longReview;window.longNames=longNames;window.zeroStory=zeroStory},{longReview,longNames,zeroStory});
    await page.addScriptTag({ content: js });
    await expect(page.getByRole('region', { name: 'Planning Sprint review' })).toBeVisible();
    await expect(page.getByText('Loading review…')).toHaveCount(0);
}

const columnsDialog = page => page.getByRole('dialog', { name: 'Review column management', exact: true });
async function openColumns(page) {
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    const popup = columnsDialog(page);
    await expect(popup).toBeVisible();
    return popup;
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
    await (await openColumns(page)).getByRole('button',{name:'Capacity',exact:true}).click();
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
    await expect(cell).toHaveValue('2');
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

test('column creation form is compact, reuses the shared segmented control and adds on Enter', async ({page}) => {
    await install(page);
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Add review column',exact:true});
    const name=popup.getByLabel('Column name',{exact:true});
    await expect(name).toBeFocused();
    expect((await popup.boundingBox()).width).toBeLessThanOrEqual(320);
    const type=popup.getByRole('radiogroup',{name:'Column type',exact:true});
    await expect(type).toHaveClass(/segmented-control/);await expect(type).toHaveClass(/eng-mode-control/);
    await expect(popup.getByRole('button',{name:'Cancel',exact:true})).toHaveCount(0);
    const geometry=await popup.evaluate(node=>{
        const rect=selector=>node.querySelector(selector).getBoundingClientRect();
        const tops=Array.from(node.querySelectorAll('.segmented-control-button'),button=>button.getBoundingClientRect().top);
        const control=rect('.segmented-control'),add=rect('.planning-review-add-row > .planning-action-button'),edge=node.getBoundingClientRect().right;
        return {tops,controlHeight:control.height,addHeight:add.height,controlMid:control.top+control.height/2,addMid:add.top+add.height/2,addRight:add.right,edge};
    });
    expect(Math.max(...geometry.tops)-Math.min(...geometry.tops),JSON.stringify(geometry)).toBeLessThan(1);
    expect(Math.abs(geometry.controlHeight-geometry.addHeight),JSON.stringify(geometry)).toBeLessThan(1);
    expect(Math.abs(geometry.controlMid-geometry.addMid),JSON.stringify(geometry)).toBeLessThan(1);
    expect(geometry.addRight,JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.edge);
    await name.fill('Notes');
    await popup.getByRole('radio',{name:'Text',exact:true}).click();
    await page.screenshot({path:path.join(root,'tmp/217-ui/planning-review-controls.png'),fullPage:true});
    await name.press('Enter');
    await expect(popup).toHaveCount(0);
    await expect(page.getByRole('columnheader',{name:'Notes',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>window.harness.state().columns.find(column=>column.label==='Notes').type)).toBe('text');
});

for (const width of [390,1280]) test(`page owns vertical scrolling with aligned docked headers and totals at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:850});await install(page,true);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const scroll=page.locator('.planning-review-scroll');
    await page.screenshot({path:path.join(root,`tmp/217-ui/planning-single-scroll-${width}.png`),fullPage:false});
    expect(await scroll.evaluate(node=>node.scrollHeight-node.clientHeight)).toBeLessThanOrEqual(1);
    const first=page.locator('tbody tr').first();const before=await first.boundingBox();const startY=await page.evaluate(()=>scrollY);
    await first.hover();await page.mouse.wheel(0,500);
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(startY+100);
    const after=await first.boundingBox();const distance=await page.evaluate(()=>scrollY)-startY;expect(before.y-after.y).toBeCloseTo(distance,0);
    expect(await scroll.evaluate(node=>node.scrollTop)).toBe(0);
    const header=page.locator('.planning-review-docked-header'),footer=page.locator('.planning-review-docked-footer');
    await expect(header).toBeInViewport();await expect(footer).toBeInViewport();
    const footerBounds=await footer.boundingBox();expect(footerBounds.y+footerBounds.height).toBeCloseTo(850,0);
    await scroll.evaluate(node=>{node.scrollLeft=500});
    await expect.poll(()=>header.evaluate(node=>node.scrollLeft)).toBe(await scroll.evaluate(node=>node.scrollLeft));
    await expect.poll(()=>footer.evaluate(node=>node.scrollLeft)).toBe(await scroll.evaluate(node=>node.scrollLeft));
    const positions=await page.locator('.planning-review-storyPoints').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().x));
    expect(Math.max(...positions)-Math.min(...positions)).toBeLessThan(1);
    await expect(footer.locator('.planning-review-storyPoints')).toHaveText('1830');
    const keyBefore=await header.locator('.planning-review-key').boundingBox();
    await footer.evaluate(node=>{node.scrollLeft=800});
    await expect.poll(()=>scroll.evaluate(node=>node.scrollLeft)).toBe(await footer.evaluate(node=>node.scrollLeft));
    await expect.poll(()=>header.evaluate(node=>node.scrollLeft)).toBe(await footer.evaluate(node=>node.scrollLeft));
    const keyAfter=await header.locator('.planning-review-key').boundingBox();expect(keyAfter.x).toBeCloseTo(keyBefore.x,0);
    await header.getByRole('button',{name:'Move Cost 0 column',exact:true}).press('ArrowRight');
    await expect.poll(()=>page.evaluate(()=>window.harness.state().layouts.story.order.indexOf('cost1')<window.harness.state().layouts.story.order.indexOf('cost0'))).toBe(true);
    await header.getByRole('button',{name:'Cost 0',exact:true}).click();
    await page.screenshot({path:path.join(root,`tmp/217-ui/planning-single-scroll-${width}.png`),fullPage:false});
    await page.evaluate(()=>scrollTo(0,0));await expect(header).toHaveCount(0);
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
    expect(managerBounds.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');await expect(management).toHaveCount(0);await expect(columns).toBeFocused();
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
    await (await openColumns(page)).getByRole('button',{name:'Assignee',exact:true}).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader',{name:'Assignee',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Save review',exact:true}).click();
    await page.evaluate(()=>window.harness.reload());
    expect((await headers()).slice(0,4)).toEqual(['Key','Summary','Status','Cost 0']);
    await expect(page.getByRole('columnheader',{name:'Assignee',exact:true})).toHaveCount(0);
    const value=page.getByRole('textbox',{name:'Cost 0 for DEMO-1',exact:true});
    await expect(value).toHaveValue('2');
    await page.screenshot({path:path.join(root,'tmp/217-ui/drag-shared-layout.png'),fullPage:true});
 });

// Measures, per column, the edge its heading label shares with the values and totals below it
// (left edge for text columns, right edge for numeric ones) and where the drag grip sits.
const alignmentAudit = () => {
    const table = document.querySelector('.planning-review-table');
    const heads = [...table.tHead.rows[0].cells], foot = [...table.tFoot.rows[0].cells];
    const row = [...table.tBodies[0].rows].find(item => !item.classList.contains('planning-review-synthetic'));
    const edgeOf = (cell, side) => {
        let edge = null;
        const take = value => { edge = edge === null ? value : side === 'left' ? Math.min(edge, value) : Math.max(edge, value); };
        const walk = node => {
            for (const child of node.childNodes) {
                if (child.nodeType === 3) { if (child.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(child); const rect = range.getBoundingClientRect(); take(side === 'left' ? rect.left : rect.right); } }
                else if (child.nodeType === 1 && child.tagName === 'INPUT') { const rect = child.getBoundingClientRect(); take(side === 'left' ? rect.left : rect.right); }
                else if (child.nodeType === 1 && (child.tagName.toLowerCase() === 'svg' || (!child.children.length && !child.textContent.trim()))) { const rect = child.getBoundingClientRect(); if (rect.width) take(side === 'left' ? rect.left : rect.right); }
                else if (child.nodeType === 1) {
                    const style = getComputedStyle(child);
                    if (style.borderTopStyle !== 'none' && style.borderTopWidth !== '0px' || style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.borderRadius !== '0px') { const rect = child.getBoundingClientRect(); take(side === 'left' ? rect.left : rect.right); }
                    else walk(child);
                }
            }
        };
        walk(cell);
        return edge;
    };
    return heads.map((th, index) => {
        if (th.classList.contains('planning-review-selection')) return null;
        const label = th.querySelector('.planning-review-heading'), grip = th.querySelector('.planning-review-drag');
        const range = document.createRange(); range.selectNodeContents(label);
        const text = range.getBoundingClientRect(), box = th.getBoundingClientRect(), thStyle = getComputedStyle(th);
        const contentLeft = box.left + parseFloat(thStyle.paddingLeft), contentRight = box.right - parseFloat(thStyle.paddingRight);
        const side = th.classList.contains('planning-review-numeric') ? 'right' : 'left';
        const head = side === 'left' ? text.left : text.right;
        const body = edgeOf(row.cells[index], side), total = edgeOf(foot[index], side);
        const gripBox = grip?.getBoundingClientRect();
        return { column: th.getAttribute('aria-label'), custom: th.classList.contains('planning-review-custom'), side, bodyDelta: body === null ? null : body - head, totalDelta: total === null ? null : total - head,
            gripSide: gripBox ? (gripBox.left >= text.right - 0.5 ? 'right' : 'other') : null,
            // The grip lives in the right-hand padding gutter, outside the content box that headings and values share.
            gripInGutter: gripBox ? gripBox.left >= contentRight - 0.5 && gripBox.right <= box.right + 0.5 : null,
            gripDy: gripBox ? gripBox.top + gripBox.height / 2 - (text.top + text.height / 2) : null,
            // How far a custom input's box pokes outside the content box (never under the grip).
            inputOvershoot: (() => { const input = row.cells[index].querySelector('input'); if (!input) return null; const rect = input.getBoundingClientRect(); return Math.max(contentLeft - rect.left, rect.right - contentRight, 0); })() };
    }).filter(Boolean);
};

test('the select header shows no title and the total cell shows a sigma, both keeping accessible names', async ({page}) => {
    await page.setViewportSize({width:2400,height:900});await install(page);
    const select=page.locator('thead th.planning-review-selection'),total=page.locator('tfoot th.planning-review-selection');
    await expect(select).toHaveText('Select');
    expect(await select.evaluate(node=>({children:node.children.length,hidden:node.firstElementChild.classList.contains('planning-review-sr-only'),size:[getComputedStyle(node.firstElementChild).width,getComputedStyle(node.firstElementChild).height]}))).toEqual({children:1,hidden:true,size:['1px','1px']});
    await expect(total).toHaveText('ΣTotal');
    expect(await total.evaluate(node=>({visible:node.firstElementChild.textContent,hiddenFromAT:node.firstElementChild.getAttribute('aria-hidden'),overflow:node.scrollWidth>node.clientWidth}))).toEqual({visible:'Σ',hiddenFromAT:'true',overflow:false});
    // Every column heading uses one typography.
    const typography=await page.locator('thead .planning-review-heading').evaluateAll(nodes=>[...new Set(nodes.map(node=>{const s=getComputedStyle(node);return [s.textTransform,s.fontWeight,s.fontSize,s.fontFamily].join('|');}))]);
    expect(typography).toHaveLength(1);
});

for (const mode of ['Epics', 'Stories']) test(`every ${mode} column shares one edge between its heading, values and totals, with the grip in the right gutter`, async ({page}) => {
    await page.setViewportSize({width:2400,height:900});await install(page);
    await page.getByRole('radio',{name:mode,exact:true}).click();
    if (mode === 'Epics') for (const [label,type] of [['Effort','Number'],['Notes','Text']]) {
        await page.getByRole('button',{name:'+ Add column',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:'Add review column',exact:true});
        await dialog.getByLabel('Column name',{exact:true}).fill(label);await dialog.getByRole('radio',{name:type,exact:true}).click();
        await dialog.getByRole('button',{name:'Add column',exact:true}).click();
    }
    const popup=await openColumns(page);
    for (const name of ['Project','Component','Capacity','Project Track']) { const toggle=popup.getByRole('button',{name,exact:true}); if (await toggle.count() && await toggle.getAttribute('aria-pressed')==='false') await toggle.click(); }
    await page.keyboard.press('Escape');
    if (mode === 'Epics') { await page.getByRole('textbox',{name:'Effort for DEMO-10',exact:true}).fill('12.5');await page.getByRole('textbox',{name:'Notes for DEMO-10',exact:true}).fill('hello');await page.locator('#reference').click(); }
    const columns=await page.evaluate(alignmentAudit);
    expect(columns.length).toBeGreaterThan(10);
    for (const column of columns) {
        const detail=JSON.stringify(column);
        if (column.bodyDelta !== null) expect(Math.abs(column.bodyDelta),detail).toBeLessThan(1);
        if (column.totalDelta !== null) expect(Math.abs(column.totalDelta),detail).toBeLessThan(1);
        if (column.gripSide) expect(column.gripSide,detail).toBe('right');
        if (column.gripInGutter !== null) expect(column.gripInGutter,detail).toBe(true);
        if (column.gripDy !== null) expect(Math.abs(column.gripDy),detail).toBeLessThan(2);
        if (column.inputOvershoot !== null) expect(column.inputOvershoot,detail).toBeLessThan(1);
    }
    expect(columns.filter(column => column.gripSide).length).toBeGreaterThan(8);
    await page.screenshot({path:path.join(root,`tmp/217-ui/column-alignment-${mode}.png`)});
});

test('real Epic and Story rows without points are tinted red; placeholders and groups are not', async ({page}) => {
    await install(page,false,false,true);
    const tint='rgb(255, 241, 240)';
    const state=()=>page.locator('tbody tr').evaluateAll(rows=>rows.map(row=>({text:row.textContent.slice(0,40),tinted:getComputedStyle(row.cells[2]).backgroundColor,cells:[...row.cells].every(cell=>getComputedStyle(cell).backgroundColor===getComputedStyle(row.cells[0]).backgroundColor),synthetic:row.classList.contains('planning-review-synthetic')})));
    // Epics: DEMO-10 has points, the readiness Epic has none, the No Epic group is synthetic.
    let rows=await state();
    expect(rows.map(row=>row.tinted===tint),JSON.stringify(rows)).toEqual([false,true,false]);
    expect(rows.every(row=>row.cells),JSON.stringify(rows)).toBe(true);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    rows=await state();
    const tinted=rows.filter(row=>row.tinted===tint);
    expect(tinted.map(row=>row.text.includes('DEMO-3')),JSON.stringify(rows)).toEqual([true]);
    expect(rows.filter(row=>row.synthetic).every(row=>row.tinted!==tint),JSON.stringify(rows)).toBe(true);
    await page.screenshot({path:path.join(root,'tmp/217-ui/zero-sp-tint.png'),fullPage:false});
});

test('Columns popup is a compact single-line checklist in the shared popover grammar', async ({page}) => {
    await page.setViewportSize({width:1280,height:850});await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const popup=await openColumns(page);
    await expect(popup).toBeFocused();
    await expect(popup.locator('.pop-opt:focus-visible')).toHaveCount(0);
    expect((await popup.boundingBox()).width).toBeLessThanOrEqual(320);
    await expect(popup.locator('.pop-subject')).toHaveText('Columns · Stories');
    await expect(popup.locator('.pop-facet')).toHaveText(['Jira fields','Review columns · shared']);
    await expect(popup.getByRole('button',{name:/^Move /})).toHaveCount(0);
    await expect(popup.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);
    await expect(popup.getByRole('textbox')).toHaveCount(0);
    const rows=await popup.locator('.pop-list > *').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent.trim().slice(0,20),height:node.getBoundingClientRect().height})));
    expect(rows.length).toBe(13);
    expect(Math.max(...rows.map(row=>row.height)),JSON.stringify(rows)).toBeLessThan(32);
    expect(Math.max(...rows.map(row=>row.height))-Math.min(...rows.map(row=>row.height)),JSON.stringify(rows)).toBeLessThan(3);
    await page.screenshot({path:path.join(root,'tmp/217-ui/columns-popup-after.png'),fullPage:true});
    await page.getByRole('radio',{name:'Epics',exact:true}).click();
    await expect(popup).toHaveCount(0);
    await page.getByRole('button',{name:'Columns',exact:true}).click();
    await expect(columnsDialog(page).locator('.pop-subject')).toHaveText('Columns · Epics');
});

test('Columns toggles show and hide Jira and review columns as a draft layout change', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const popup=await openColumns(page);
    for(const name of ['Assignee','Cost 3']) {
        const toggle=popup.getByRole('button',{name,exact:true});
        await expect(toggle).toHaveAttribute('aria-pressed','true');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed','false');
        await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
        await toggle.click();
        await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    }
    await popup.getByRole('button',{name:'Cost 3',exact:true}).click();
    await expect(page.getByRole('columnheader',{name:'Cost 3',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>({dirty:window.harness.state().dirty,saves:window.harness.saveCount()}))).toEqual({dirty:true,saves:0});
});

test('review column rename is inline: Enter and blur save, Escape cancels and keeps the popup open', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const popup=await openColumns(page);
    const label=id=>page.evaluate(columnId=>window.harness.state().columns.find(column=>column.id===columnId).label,id);
    const rename=name=>popup.getByRole('button',{name:`Rename ${name}`,exact:true});
    const field=name=>popup.getByRole('textbox',{name:`Name for ${name}`,exact:true});
    await rename('Cost 0').click();await expect(field('Cost 0')).toBeFocused();
    await field('Cost 0').fill('Cost estimate');await field('Cost 0').press('Enter');
    await expect(popup.getByRole('textbox')).toHaveCount(0);
    expect(await label('cost0')).toBe('Cost estimate');
    await expect(page.getByRole('columnheader',{name:'Cost estimate',exact:true})).toBeVisible();
    await rename('Cost 1').click();await field('Cost 1').fill('Discarded');await field('Cost 1').press('Escape');
    await expect(popup).toBeVisible();await expect(popup.getByRole('textbox')).toHaveCount(0);
    expect(await label('cost1')).toBe('Cost 1');
    await rename('Cost 2').click();await field('Cost 2').fill('Saved on blur');await popup.locator('.pop-subject').click();
    expect(await label('cost2')).toBe('Saved on blur');
    await rename('Cost 3').click();await field('Cost 3').fill('   ');await field('Cost 3').press('Enter');
    await expect(popup.getByRole('alert')).toContainText('1–80');
    expect(await label('cost3')).toBe('Cost 3');
    await rename('Cost 4').click();await field('Cost 4').fill('Saved outside');await page.locator('#reference').click();
    await expect(popup).toHaveCount(0);
    expect(await label('cost4')).toBe('Saved outside');
});

test('Total toggle controls the footer sum and is offered for number columns only', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const creation=page.getByRole('dialog',{name:'Add review column',exact:true});
    await creation.getByLabel('Column name',{exact:true}).fill('Notes');await creation.getByRole('radio',{name:'Text',exact:true}).click();
    await creation.getByRole('button',{name:'Add column',exact:true}).click();
    const popup=await openColumns(page);
    await expect(popup.getByRole('button',{name:'Total for Notes',exact:true})).toHaveCount(0);
    const total=popup.getByRole('button',{name:'Total for Cost 0',exact:true});
    await expect(total).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('tfoot .planning-review-cost0')).not.toHaveText('');
    await total.click();
    await expect(total).toHaveAttribute('aria-pressed','false');
    await expect(page.locator('tfoot .planning-review-cost0')).toHaveText('');
    await total.click();
    await expect(page.locator('tfoot .planning-review-cost0')).not.toHaveText('');
});

test('archiving a review column needs an inline confirmation', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const popup=await openColumns(page);
    const archive=popup.getByRole('button',{name:'Archive Cost 7',exact:true});
    await archive.click();
    await expect(popup.getByText('Archive “Cost 7”?')).toBeVisible();
    await popup.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(archive).toBeVisible();await expect(page.getByRole('columnheader',{name:'Cost 7',exact:true})).toHaveCount(1);
    await archive.click();await popup.getByRole('button',{name:'Archive',exact:true}).click();
    await expect(page.getByRole('columnheader',{name:'Cost 7',exact:true})).toHaveCount(0);
    await expect(popup.getByText('Cost 7 · archived')).toBeVisible();
    await expect(popup.getByRole('button',{name:'Cost 7',exact:true})).toHaveCount(0);
});

test('Columns popup rows and icon actions keep a readable light hover', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const popup=await openColumns(page);
    const targets=[popup.getByRole('button',{name:'Assignee',exact:true}),popup.getByRole('button',{name:'Total for Cost 0',exact:true}),popup.getByRole('button',{name:'Rename Cost 0',exact:true}),popup.getByRole('button',{name:'Archive Cost 0',exact:true})];
    for(const target of targets) {
        await target.hover();
        const style=await target.evaluate(node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,color:s.color,transform:s.transform,shadow:s.boxShadow};});
        expect(style,await target.getAttribute('aria-label')||'row').toEqual({background:'rgb(248, 247, 244)',color:'rgb(26, 26, 26)',transform:'none',shadow:'none'});
    }
});

test('keyboard reorder steps over hidden optional columns instead of swapping with them', async ({page}) => {
    await page.setViewportSize({width:2400,height:900});
    await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const headers=()=>page.locator('thead th').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).filter(Boolean));
    const before=await headers();
    expect(before.indexOf('Cost 0'),JSON.stringify(before)).toBe(before.indexOf('Assignee')+1);
    await page.getByRole('button',{name:'Move Cost 0 column',exact:true}).focus();
    await page.keyboard.press('ArrowLeft');
    const after=await headers();
    expect(after.indexOf('Cost 0'),JSON.stringify(after)).toBe(after.indexOf('Assignee')-1);
    await page.keyboard.press('ArrowRight');
    const back=await headers();
    expect(back.indexOf('Cost 0'),JSON.stringify(back)).toBe(back.indexOf('Assignee')+1);
});

for(const mode of ['Epics','Stories']) test(`optional metadata hidden by default and explicit visibility persists in ${mode}`,async({page})=>{
    await install(page);
    await page.getByRole('radio',{name:mode,exact:true}).click();
    for(const name of ['Component','Project','Capacity','Project Track']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    const popup=await openColumns(page);
    for(const name of ['Component','Project','Capacity','Project Track']) {
        await expect(popup.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','false');
        await popup.getByRole('button',{name,exact:true}).click();
        await expect(popup.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
    }
    for(const name of ['Key','Summary','Status','Priority']) await expect(popup.getByRole('button',{name,exact:true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    for(const name of ['Component','Project','Capacity','Project Track']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    await page.getByRole('button',{name:'Save review',exact:true}).click();await page.evaluate(()=>window.harness.reload());
    for(const name of ['Component','Project','Capacity','Project Track']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    await openColumns(page);
    for(const name of ['Component','Project','Capacity','Project Track']) await popup.getByRole('button',{name,exact:true}).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Save review',exact:true}).click();await page.evaluate(()=>window.harness.reload());
    for(const name of ['Component','Project','Capacity','Project Track']) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(root,`tmp/217-ui/optional-columns-${mode}.png`),fullPage:true});
});

test('Capacity hover and keyboard focus retain readable light Included and Excluded chips',async({page})=>{
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await (await openColumns(page)).getByRole('button',{name:'Capacity',exact:true}).click();await page.keyboard.press('Escape');
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
    await expect(placeholder.getByRole('link',{name:'Readiness Epic',exact:true})).toHaveAttribute('href','https://jira.example/browse/DEMO-20');
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
    expect(cells['Project Track']).toBeUndefined();
    expect(cells['Cost 0'].width).toBeLessThanOrEqual(112);
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
    await page.getByLabel('Column name',{exact:true}).fill('Notes');await page.getByRole('dialog',{name:'Add review column',exact:true}).getByRole('radio',{name:'Text',exact:true}).click();
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    for(const [selector,alignment] of [['.planning-review-numeric','right'],['.planning-review-text','left']]){
        const values=await page.locator('.planning-review-table '+selector).evaluateAll(nodes=>nodes.flatMap(node=>[getComputedStyle(node).textAlign,...Array.from(node.querySelectorAll('input')).map(input=>getComputedStyle(input).textAlign)]));
        expect(values.length).toBeGreaterThan(0);for(const value of values)expect(value).toBe(alignment);
    }
    await page.screenshot({path:path.join(root,'tmp/217-ui/table-number-alignment.png'),fullPage:true});
});

for(const width of [390,1280]) test(`Summary and Teams in scope show full clipped values on hover and focus at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});await install(page,false,true);
    for(const column of ['summary','teamsInScope']){
        const value=page.locator(`tbody .planning-review-${column} .planning-review-truncated-value`).first();
        await value.scrollIntoViewIfNeeded();const full=await value.textContent();
        expect(await value.evaluate(node=>node.scrollWidth>node.clientWidth+1)).toBe(true);
        await value.hover();const readout=page.getByRole('tooltip').filter({hasText:full});await expect(readout).toBeVisible();
        await value.focus();await expect(readout).toBeVisible();await value.press('Escape');await expect(readout).toHaveCount(0);
    }
    await page.locator('tbody .planning-review-summary .planning-review-truncated-value').first().hover();
    await page.screenshot({path:`tmp/217-ui/review-trimmed-${width}.png`,fullPage:false});
});

test('review number cells show no trailing zeros and reject more than one decimal place', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const input=page.getByRole('textbox',{name:'Cost 0 for DEMO-1',exact:true});
    await expect(input).toHaveValue('2');
    await expect(page.getByRole('textbox',{name:'Cost 0 for DEMO-2',exact:true})).toHaveValue('10');
    await input.fill('1.25');
    await expect(page.getByRole('alert').filter({hasText:'one decimal place'})).toBeVisible();
    await input.fill('1.2');
    await expect(page.getByRole('alert').filter({hasText:'one decimal place'})).toHaveCount(0);
    await input.press('Enter');
    await expect(input).toHaveValue('1.2');
    expect(await page.evaluate(()=>window.harness.state().drafts)).toEqual(expect.objectContaining({}));
    await expect(page.locator('tfoot .planning-review-cost0')).toHaveText('21.2');
});

for(const width of [390,1280]) test(`custom number editors stay inside stable compact rows at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const input=page.getByRole('textbox',{name:'Cost 0 for DEMO-1',exact:true});
    const geometry=()=>input.evaluate(node=>{const cell=node.closest('td'),row=cell.parentElement,r=node.getBoundingClientRect(),c=cell.getBoundingClientRect();return {inputHeight:r.height,height:row.getBoundingClientRect().height,width:c.width,inside:r.left>=c.left&&r.right<=c.right,shadow:getComputedStyle(node).boxShadow};});
    const before=await geometry();
    await input.click();await input.fill('-999999999.9');
    const after=await geometry();expect(after.inside).toBe(true);expect(after.height).toBe(before.height);expect(after.width).toBe(before.width);
    expect(after.inputHeight).toBeLessThanOrEqual(21);expect(after.shadow).toBe('none');
    // The widest valid value fits its field without clipping, so no abbreviation is needed.
    expect(await input.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({path:path.join(root,`tmp/217-ui/custom-input-stable-${width}.png`),fullPage:false});
});
