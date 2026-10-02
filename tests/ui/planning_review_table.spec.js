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
        const epics=[{key:'DEMO-10',epic:{id:'10',key:'DEMO-10',summary:window.longNames?'Automate detailed calculations and adjustments across multiple supported integrations':'Epic summary',status:{name:'To Do'},priority:{name:'High'},teamName:'Own Team'},tasks:stories.slice(0,2),requirements:[]},{key:'DEMO-20',epic:{id:'20',key:'DEMO-20',summary:window.longNames?'Readiness Epic with a deliberately long title that must truncate beside its chip':'Readiness Epic'},tasks:[],requirements:[{id:'required',team:{name:'Beta'}}]}];
        const columns=Array.from({length:8},(_,i)=>({id:'cost'+i,rowKind:'story',label:'Cost '+i,type:'number',aggregation:'sum',archived:false,order:i}));
        let saveCount=0; let savedSchema={schemaRevision:1,columns,layouts:{},capabilities:{canRead:true,canSave:true}};
        const controller=createPlanningSprintReviewController({fetchSchema:async()=>savedSchema,readValues:async(_,__,body)=>({cells:body.issueIds.flatMap(id=>columns.map(column=>({issueId:id,rowKind:body.rowKind,columnId:column.id,value:id==='1'?'2.000':'10.000',revision:1})))}),saveReview:async(_,__,payload)=>{saveCount++; savedSchema={...savedSchema,schemaRevision:savedSchema.schemaRevision+1,columns:controller.getState().columns,layouts:controller.getState().layouts}; return {...savedSchema,cells:payload.cellChanges.map(cell=>({...cell,revision:2}))}}});
        window.reviewActions=[]; window.harness={state:()=>controller.getState(),saveCount:()=>saveCount,reload:()=>controller.refresh(),actions:()=>window.reviewActions};
        function App(){
            const state=React.useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
            const [selected,setSelected]=React.useState(new Set());
            const [visible,setVisible]=React.useState(true);
            React.useEffect(()=>{controller.setScope({sprintId:'100',contextKey:'actor',active:true,rows:[...stories.map(task=>({issueId:task.id,rowKind:'story'})),...epics.map(group=>({issueId:group.epic.id,rowKind:'epic'}))]});},[]);
            return <div className="container"><div id="reference">Header reference</div><button id="layout" onClick={()=>setVisible(!visible)}>Layout</button>{visible&&<PlanningReviewTable epicGroups={epics} visibleTasks={stories} selectedStoryKeys={selected} onToggleStory={task=>setSelected(previous=>{const next=new Set(previous);if(next.has(task.key))next.delete(task.key);else next.add(task.key);return next})} onSelectStories={(tasks,on)=>setSelected(previous=>{const next=new Set(previous);tasks.forEach(task=>on?next.add(task.key):next.delete(task.key));return next})} jiraUrl="https://jira.example" review={{...state,...controller}} onReviewAction={action=>window.reviewActions.push(action)} admittedTeamCount={2} admittedProjectCount={2} renderFieldEditor={({row,field,value})=>field==='team'||field==='inclusion'?<button className={field==='inclusion'?'epic-stat-toggle '+(row.key==='DEMO-2'?'':'active'):'planning-action-button'} aria-label={field+' for '+row.key}>{field==='inclusion'?(row.key==='DEMO-2'?'Excluded':'Included'):row.team?.name||'Unknown Team'}</button>:value}/>}<PlanningReviewScopeDialog review={{...state,...controller}}/></div>
        }
        createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text;
    css = esbuild.buildSync({ entryPoints: [path.join(root, 'frontend/src/styles/dashboard.css')], bundle: true, write: false }).outputFiles[0].text;
});
async function install(page, longReview = false, longNames = false, zeroStory = false) {
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css} *,*::before,*::after{animation:none!important;transition:none!important}</style><div id="root"></div>`);
    await page.evaluate(({longReview,longNames,zeroStory}) => {window.longReview=longReview;window.longNames=longNames;window.zeroStory=zeroStory},{longReview,longNames,zeroStory});
    await page.addScriptTag({ content: js });
    await expect(page.getByRole('region', { name: 'Planning Sprint review' })).toBeVisible();
    await expect(page.getByText('Loading review…')).toHaveCount(0);
}

const addDialog = page => page.getByRole('dialog', { name: 'Add review column', exact: true });
// The corner "+" opens the Add popover; its Show hidden list restores a hidden optional column.
async function showHiddenColumn(page, label) {
    await page.getByRole('button', { name: '+ Add column', exact: true }).click();
    await addDialog(page).getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
}
async function hideColumn(page, label) {
    await page.getByRole('button', { name: `${label} column options`, exact: true }).click();
    await page.getByRole('dialog', { name: `${label} column options`, exact: true }).getByRole('button', { name: 'Hide column', exact: true }).click();
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
    await showHiddenColumn(page,'Capacity');
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
    const add=page.getByRole('button',{name:'+ Add column',exact:true});
    await add.click();const creation=addDialog(page);await expect(creation).toBeVisible();
    expect(Math.abs((await table.boundingBox()).y-before.y)).toBeLessThan(1);
    await expect(creation.getByLabel('Column name',{exact:true})).toBeFocused();
    await creation.getByLabel('Column name',{exact:true}).fill('Risk');
    const popup=await creation.boundingBox();expect(popup.x).toBeGreaterThanOrEqual(0);expect(popup.x+popup.width).toBeLessThanOrEqual(width);expect(popup.y+popup.height).toBeLessThanOrEqual(850);
    expect(popup.width).toBeLessThanOrEqual(320);
    const frontOfCreation=await creation.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+12,r.top+12));});expect(frontOfCreation).toBe(true);
    await page.screenshot({path:path.join(root,`tmp/217-ui/planning-review-column-popup-${width}.png`),fullPage:true});
    await creation.getByLabel('Column name',{exact:true}).press('Escape');await expect(creation).toHaveCount(0);await expect(add).toBeFocused();
    // A column menu replaces the Add popover and is anchored the same way.
    await add.click();
    const chevron=page.getByRole('button',{name:'Priority column options',exact:true});await chevron.scrollIntoViewIfNeeded();await chevron.click();
    const management=page.getByRole('dialog',{name:'Priority column options',exact:true});await expect(management).toBeVisible();await expect(creation).toHaveCount(0);
    expect(Math.abs((await table.boundingBox()).y-before.y)).toBeLessThan(1);
    const front=await management.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+12,r.top+12));});expect(front).toBe(true);
    const managerBounds=await management.boundingBox();expect(managerBounds.x).toBeGreaterThanOrEqual(0);expect(managerBounds.x+managerBounds.width).toBeLessThanOrEqual(width);
    expect(managerBounds.y).toBeGreaterThanOrEqual(0);expect(managerBounds.y+managerBounds.height).toBeLessThanOrEqual(850);
    expect(managerBounds.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');await expect(management).toHaveCount(0);await expect(chevron).toBeFocused();
});

 test('drag custom columns between Jira columns, keyboard reorder and shared visibility survive reload', async ({page}) => {
    await page.setViewportSize({width:2400,height:900});
    await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const headers=()=>page.locator('thead th').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).filter(label=>label&&label!=='Select'));
    await page.getByRole('button',{name:'Move Cost 0 column',exact:true}).dragTo(page.getByRole('columnheader',{name:'Status',exact:true}),{targetPosition:{x:4,y:15}});
    expect((await headers()).slice(0,4)).toEqual(['Key','Summary','Cost 0','Status']);
    expect(await page.evaluate(()=>window.harness.saveCount())).toBe(0);
    await page.getByRole('button',{name:'Move Cost 0 column',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    expect((await headers()).slice(0,4)).toEqual(['Key','Summary','Status','Cost 0']);
    await hideColumn(page,'Assignee');
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
    // Select is the cell's accessible name; the only visible mark is the corner "+" button, which has no title text of its own.
    await expect(select).toHaveAttribute('aria-label','Select');
    await expect(select).toHaveText('');
    expect(await select.evaluate(node=>({children:[...node.children].map(child=>child.tagName+'.'+child.className.replace(/\s+/g,'.')),text:node.textContent.trim()}))).toEqual({children:[expect.stringMatching(/^SPAN\.planning-review-popover-anchor$/)],text:''});
    await expect(select.getByRole('button',{name:'+ Add column',exact:true})).toBeVisible();
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
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    for (const name of ['Project','Component','Capacity','Project Track']) { const row=addDialog(page).getByRole('button',{name,exact:true}); if (await row.count()) await row.click(); }
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

test('Add column popover is a compact form in the shared popover grammar with a single-line Show hidden list', async ({page}) => {
    await page.setViewportSize({width:1280,height:850});await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const popup=addDialog(page);
    await expect(popup.getByLabel('Column name',{exact:true})).toBeFocused();
    await expect(popup.locator('.pop-opt:focus-visible')).toHaveCount(0);
    expect((await popup.boundingBox()).width).toBeLessThanOrEqual(320);
    await expect(popup.locator('.pop-subject')).toHaveText('Add column · Stories');
    await expect(popup.locator('.pop-facet')).toHaveText(['Show hidden']);
    await expect(popup.getByText('Shared with everyone reviewing this Sprint.',{exact:true})).toBeVisible();
    await expect(popup.getByRole('button',{name:/^Move /})).toHaveCount(0);
    await expect(popup.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);
    await expect(popup.getByRole('textbox')).toHaveCount(1);
    const hidden=await popup.locator('.pop-list > button').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent.trim(),pressed:node.getAttribute('aria-pressed'),height:node.getBoundingClientRect().height})));
    expect(hidden.map(row=>row.text),JSON.stringify(hidden)).toEqual(['Project','Component','Capacity','Project Track']);
    expect(hidden.every(row=>row.pressed==='false')).toBe(true);
    expect(Math.max(...hidden.map(row=>row.height)),JSON.stringify(hidden)).toBeLessThan(32);
    expect(Math.max(...hidden.map(row=>row.height))-Math.min(...hidden.map(row=>row.height)),JSON.stringify(hidden)).toBeLessThan(3);
    // Archived review columns are not listed and cannot be restored here.
    await page.keyboard.press('Escape');
    await hideColumn(page,'Cost 7');await page.getByRole('button',{name:'Cost 6 column options',exact:true}).click();
    await page.getByRole('dialog',{name:'Cost 6 column options',exact:true}).getByRole('button',{name:'Archive column…',exact:true}).click();
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await expect(popup.getByRole('button',{name:'Cost 7',exact:true})).toHaveCount(1);
    await expect(popup.getByRole('button',{name:'Cost 6',exact:true})).toHaveCount(0);
    await expect(popup.getByText('archived',{exact:false})).toHaveCount(0);
    await page.screenshot({path:path.join(root,'tmp/217-ui/add-popover-after.png'),fullPage:true});
    await page.getByRole('radio',{name:'Epics',exact:true}).click();
    await expect(popup).toHaveCount(0);
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    await expect(addDialog(page).locator('.pop-subject')).toHaveText('Add column · Epics');
});

test('Show hidden restores and the header menu hides Jira and review columns as a draft layout change', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    for(const name of ['Assignee','Cost 3']) {
        await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
        await hideColumn(page,name);
        await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
        await page.getByRole('button',{name:'+ Add column',exact:true}).click();
        await addDialog(page).getByRole('button',{name,exact:true}).click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    }
    await hideColumn(page,'Cost 3');
    await expect(page.getByRole('columnheader',{name:'Cost 3',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>({dirty:window.harness.state().dirty,saves:window.harness.saveCount()}))).toEqual({dirty:true,saves:0});
});

test('review column rename is inline: Enter and blur save, Escape cancels and keeps the menu open', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const label=id=>page.evaluate(columnId=>window.harness.state().columns.find(column=>column.id===columnId).label,id);
    const open=async name=>{await page.getByRole('button',{name:`${name} column options`,exact:true}).click();const popup=page.getByRole('dialog',{name:`${name} column options`,exact:true});await popup.getByRole('button',{name:'Rename',exact:true}).click();return popup;};
    const field=(popup,name)=>popup.getByRole('textbox',{name:`Name for ${name}`,exact:true});
    let popup=await open('Cost 0');await expect(field(popup,'Cost 0')).toBeFocused();
    await field(popup,'Cost 0').fill('Cost estimate');await field(popup,'Cost 0').press('Enter');
    await expect(popup.getByRole('textbox')).toHaveCount(0);
    expect(await label('cost0')).toBe('Cost estimate');
    await expect(page.getByRole('columnheader',{name:'Cost estimate',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>({dirty:window.harness.state().dirty,actions:window.harness.actions()}))).toEqual({dirty:true,actions:expect.arrayContaining(['column_renamed'])});
    await page.keyboard.press('Escape');
    popup=await open('Cost 1');await field(popup,'Cost 1').fill('Discarded');await field(popup,'Cost 1').press('Escape');
    await expect(popup).toBeVisible();await expect(popup.getByRole('textbox')).toHaveCount(0);
    expect(await label('cost1')).toBe('Cost 1');
    await page.keyboard.press('Escape');
    popup=await open('Cost 2');await field(popup,'Cost 2').fill('Saved on blur');await popup.locator('.pop-subject').click();
    expect(await label('cost2')).toBe('Saved on blur');
    await page.keyboard.press('Escape');
    popup=await open('Cost 3');await field(popup,'Cost 3').fill('   ');await field(popup,'Cost 3').press('Enter');
    await expect(popup.getByRole('alert')).toContainText('1–80');
    expect(await label('cost3')).toBe('Cost 3');
    await page.keyboard.press('Escape');
    popup=await open('Cost 4');await field(popup,'Cost 4').fill('Saved outside');await page.locator('#reference').click();
    await expect(popup).toHaveCount(0);
    expect(await label('cost4')).toBe('Saved outside');
});

test('keyboard reorder steps over hidden optional columns instead of swapping with them', async ({page}) => {
    await page.setViewportSize({width:2400,height:900});
    await install(page);
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const headers=()=>page.locator('thead th').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).filter(label=>label&&label!=='Select'));
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
    const optional=['Component','Project','Capacity','Project Track'];
    for(const name of optional) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'+ Add column',exact:true}).click();
    const popup=addDialog(page);
    for(const name of optional) await expect(popup.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','false');
    for(const name of ['Key','Summary','Status','Priority']) await expect(popup.getByRole('button',{name,exact:true})).toHaveCount(0);
    for(const name of optional) await popup.getByRole('button',{name,exact:true}).click();
    await expect(popup.locator('.pop-facet')).toHaveCount(0);
    await page.keyboard.press('Escape');
    for(const name of optional) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    await page.getByRole('button',{name:'Save review',exact:true}).click();await page.evaluate(()=>window.harness.reload());
    for(const name of optional) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(1);
    for(const name of optional) await hideColumn(page,name);
    await page.getByRole('button',{name:'Save review',exact:true}).click();await page.evaluate(()=>window.harness.reload());
    for(const name of optional) await expect(page.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(root,`tmp/217-ui/optional-columns-${mode}.png`),fullPage:true});
});

test('Capacity hover and keyboard focus retain readable light Included and Excluded chips',async({page})=>{
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await showHiddenColumn(page,'Capacity');
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

test('an Epic awaiting a Story keeps a one-line row with a chip beside its title, even for a long title', async ({page}) => {
    await page.setViewportSize({width:1500,height:900});await install(page,false,true);
    const rows=page.locator('tbody tr');
    const heights=await rows.evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.getBoundingClientRect().height));
    expect(Math.abs(heights[0]-heights[1]),JSON.stringify(heights)).toBeLessThan(1.5);
    await expect(rows.nth(1).locator('.planning-review-awaiting')).toHaveText('1 Story awaited');
    const geometry=await rows.nth(1).evaluate(row=>{
        const cell=row.querySelector('td.planning-review-summary'),title=cell.querySelector('.planning-review-truncated-value'),chip=cell.querySelector('.planning-review-awaiting');
        const t=title.getBoundingClientRect(),c=chip.getBoundingClientRect(),w=cell.getBoundingClientRect();
        return {sameLine:c.top<t.bottom&&c.bottom>t.top,chipInside:c.left>=w.left&&c.right<=w.right,truncated:title.scrollWidth>title.clientWidth,secondLine:Boolean(cell.querySelector('.planning-review-requirement'))};
    });
    expect(geometry).toEqual({sameLine:true,chipInside:true,truncated:true,secondLine:false});
    await page.screenshot({path:path.join(root,'tmp/217-ui/awaiting-chip-long-title.png')});
});

test('an orphan Story keeps the normal row height and names its Epic only in the Epic column', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const rows=page.locator('tbody tr');
    const orphan=rows.filter({hasText:'DEMO-3'}),neighbour=rows.filter({hasText:'DEMO-1'});
    const heights=[(await orphan.boundingBox()).height,(await neighbour.boundingBox()).height];
    expect(Math.abs(heights[0]-heights[1]),JSON.stringify(heights)).toBeLessThan(1.5);
    await expect(orphan.locator('td.planning-review-summary')).not.toContainText('No Epic');
    await expect(orphan.locator('td.planning-review-epic')).toHaveText('No Epic');
});

test('heading click cycles ascending, descending, off and the index appears only with several criteria', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const cost0=page.locator('.planning-review-heading',{hasText:/^Cost 0/}),cost1=page.locator('.planning-review-heading',{hasText:/^Cost 1/});
    await cost0.click();await expect(cost0).toHaveText('Cost 0 ↑');
    await cost0.click();await expect(cost0).toHaveText('Cost 0 ↓');
    await cost0.click();await expect(cost0).toHaveText('Cost 0');
    await cost0.click();await cost1.click({modifiers:['Shift']});
    await expect(cost0).toHaveText('Cost 0 1↑');await expect(cost1).toHaveText('Cost 1 2↑');
});

test('Discard and Save review appear only while the review has changes', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const save=page.getByRole('button',{name:'Save review',exact:true}),discard=page.getByRole('button',{name:'Discard',exact:true});
    await expect(save).toHaveCount(0);await expect(discard).toHaveCount(0);
    await expect(page.getByText('Unsaved',{exact:true})).toHaveCount(0);
    const toolbar=page.locator('.planning-review-toolbar');
    const clean=(await toolbar.boundingBox()).height;
    await page.getByRole('textbox',{name:'Cost 0 for DEMO-1',exact:true}).fill('99');
    await expect(save).toBeVisible();await expect(discard).toBeVisible();
    expect((await toolbar.boundingBox()).height).toBe(clean);
    await discard.click();await page.getByRole('button',{name:'Keep',exact:true}).click();
    expect(await page.evaluate(()=>window.harness.state().dirty)).toBe(true);
    await discard.click();await discard.click();
    expect(await page.evaluate(()=>window.harness.state().dirty)).toBe(false);
    await expect(save).toHaveCount(0);await expect(discard).toHaveCount(0);
});

test('Save review sends one save and the review actions disappear', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    await page.getByRole('textbox',{name:'Cost 0 for DEMO-1',exact:true}).fill('99');
    await page.getByRole('button',{name:'Save review',exact:true}).click();
    await expect(page.getByRole('button',{name:'Save review',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>window.harness.saveCount())).toBe(1);
    expect(await page.evaluate(()=>window.harness.state().dirty)).toBe(false);
});

test('Key and Epic links use the ENG neutral link style instead of the browser default', async ({page}) => {
    await install(page);
    const style=link=>link.evaluate(node=>({link:getComputedStyle(node).color,cell:getComputedStyle(node.closest('td')).color,line:getComputedStyle(node).textDecorationLine}));
    const key=page.getByRole('link',{name:'DEMO-10',exact:true});
    await expect(key).toHaveClass(/task-key-link/);
    const keyStyle=await style(key);expect(keyStyle.link).toBe(keyStyle.cell);expect(keyStyle.line).toBe('none');
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const epic=page.getByRole('link',{name:'Epic summary',exact:true}).first();
    await expect(epic).toHaveClass(/task-key-link/);
    const epicStyle=await style(epic);expect(epicStyle.link).toBe(epicStyle.cell);expect(epicStyle.line).toBe('none');
});

test('uncreated Epic appears and its awaiting Story has a linked, noneditable placeholder',async({page})=>{
    await install(page);
    const epic=page.locator('tbody tr').filter({has:page.getByRole('link',{name:'DEMO-20',exact:true})});
    await expect(epic).toContainText('1 Story awaited');await expect(epic.getByRole('checkbox')).toBeDisabled();
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
    expect(cells['Cost 0'].width).toBeLessThanOrEqual(132);   // the 112px editor column plus the 20px column-menu lane
    for(const cell of Object.values(cells)) expect(cell.scroll).toBeLessThanOrEqual(cell.client+1);
});

for(const width of [390,1440]) test(`review toolbar holds only the row switch and its popups do not shift the table at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});await install(page);
    const toolbar=page.locator('.planning-review-toolbar');
    await expect(toolbar.getByText('Rows',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Drag column handles to reorder.',{exact:false})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Refresh review',exact:true})).toHaveCount(0);
    await expect(toolbar.getByRole('button',{name:'Save review',exact:true})).toHaveCount(0);
    await expect(toolbar.getByRole('button',{name:'Review options',exact:true})).toHaveCount(0);
    // Column work lives in the header: no toolbar "+ Column" or "Columns" buttons and no management dialog.
    await expect(toolbar.getByRole('button',{name:'+ Column',exact:true})).toHaveCount(0);
    await expect(toolbar.getByRole('button',{name:'Columns',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Columns',exact:true})).toHaveCount(0);
    await expect(toolbar.locator('button.planning-action-button')).toHaveCount(0);
    await expect(toolbar.getByRole('radiogroup',{name:'Planning review rows'})).toHaveClass(/eng-mode-control/);
    const table=page.locator('.planning-review-scroll'),before=await table.boundingBox();
    const corner=page.getByRole('button',{name:'+ Add column',exact:true});
    await corner.hover();
    expect(await corner.evaluate(node=>getComputedStyle(node).transform)).toBe('none');
    await corner.click();
    const popup=addDialog(page);await expect(popup).toBeVisible();
    expect((await table.boundingBox()).y).toBe(before.y);
    expect(await popup.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+10,r.top+10));})).toBe(true);
    await page.keyboard.press('Escape');await expect(corner).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:path.join(root,`tmp/217-ui/simple-toolbar-${width}.png`),fullPage:true});
    await corner.click();
    await page.getByLabel('Column name',{exact:true}).fill('Draft field');
    await page.getByRole('button',{name:'Add column',exact:true}).click();
    await expect(toolbar.getByRole('button',{name:'Save review',exact:true})).toBeEnabled();
    await page.screenshot({path:path.join(root,`tmp/217-ui/review-cluster-${width}.png`)});
    await toolbar.getByRole('button',{name:'Discard',exact:true}).click();
    await toolbar.getByRole('button',{name:'Discard',exact:true}).click();
    await expect(toolbar.getByRole('button',{name:'Save review',exact:true})).toHaveCount(0);
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


// Header lane: the grip and the column menu chevron live in the cell's right padding and show on hover or focus.
const headings = page => page.locator('thead th').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')).filter(label => label !== 'Select'));
const columnMenuButton = (page, label) => page.getByRole('button', { name: `${label} column options`, exact: true });
const columnMenu = (page, label) => page.getByRole('dialog', { name: `${label} column options`, exact: true });
const menuItems = popup => popup.locator('button.pop-opt .pop-opt-label').allTextContents();
function contrastRatio(foreground, background) {
    const luminance = rgb => { const [r, g, b] = rgb.map(value => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
}

test('lane controls are hidden at rest and revealed by hover without changing the header or table size', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const cell = page.getByRole('columnheader', { name: 'Priority', exact: true });
    const lane = cell.locator('.planning-review-colmenu, .planning-review-drag');
    await page.mouse.move(0, 0);
    await expect(lane).toHaveCount(2);
    for (const node of await lane.all()) expect(await node.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
    const table = page.locator('table.planning-review-table').first();
    const before = { width: (await table.boundingBox()).width, header: (await cell.boundingBox()).height };
    expect(before.header).toBe(32);
    await cell.hover();
    for (const node of await lane.all()) await expect.poll(() => node.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    expect({ width: (await table.boundingBox()).width, header: (await cell.boundingBox()).height }).toEqual(before);
    await page.screenshot({ path: path.join(root, 'tmp/217-ui/column-lane-hover-1440.png'), clip: { x: 440, y: 140, width: 720, height: 60 } });
    // Key and Summary are pinned: no lane.
    await expect(page.getByRole('columnheader', { name: 'Summary', exact: true }).locator('.planning-review-colmenu, .planning-review-drag')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Key', exact: true }).locator('.planning-review-colmenu, .planning-review-drag')).toHaveCount(0);
});

test('column menu items follow the column kind and opening it is reported', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await columnMenuButton(page, 'Priority').click();
    const popup = columnMenu(page, 'Priority');
    await expect(popup).toBeVisible();
    await expect(popup.locator('.pop-subject')).toHaveText('Priority');
    expect(await menuItems(popup)).toEqual(['Move left', 'Move right']);
    await expect(popup).toContainText('Shift-click a heading to sort by several columns.');
    await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0);
    await showHiddenColumn(page, 'Component');
    await columnMenuButton(page, 'Component').click();
    expect(await menuItems(columnMenu(page, 'Component'))).toEqual(['Move left', 'Move right', 'Hide column']);
    expect(await page.evaluate(() => window.harness.actions())).toContain('columns_opened');
});

test('Move left and Move right reorder like dragging and stay disabled at the ends', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const order = async () => (await headings(page)).filter(label => ['Status', 'Priority', 'Story Points'].includes(label));
    expect(await order()).toEqual(['Status', 'Priority', 'Story Points']);
    await columnMenuButton(page, 'Status').click();
    const first = columnMenu(page, 'Status');
    await expect(first.getByRole('button', { name: 'Move left', exact: true })).toBeDisabled();
    await first.getByRole('button', { name: 'Move right', exact: true }).click();
    expect(await order()).toEqual(['Priority', 'Status', 'Story Points']);
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(true);
    expect(await page.evaluate(() => window.harness.actions())).toContain('columns_reordered');
    await expect(first).toBeVisible();
    await first.getByRole('button', { name: 'Move left', exact: true }).click();
    expect(await order()).toEqual(['Status', 'Priority', 'Story Points']);
    await page.keyboard.press('Escape');
    // The last visible movable column cannot move right.
    const last = (await headings(page)).at(-1);
    await columnMenuButton(page, last).click();
    await expect(columnMenu(page, last).getByRole('button', { name: 'Move right', exact: true })).toBeDisabled();
});

test('Hide column hides an optional column, marks the draft and reports it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await showHiddenColumn(page, 'Component');
    await expect(page.getByRole('columnheader', { name: 'Component', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save review', exact: true }).click(); expect(await page.evaluate(() => window.harness.state().dirty)).toBe(false);
    await columnMenuButton(page, 'Component').click();
    await columnMenu(page, 'Component').getByRole('button', { name: 'Hide column', exact: true }).click();
    await expect(columnMenu(page, 'Component')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Component', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.harness.state().layouts.story.hidden)).toContain('components');
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(true);
    expect(await page.evaluate(() => window.harness.actions())).toContain('column_visibility_changed');
});

test('lane icon buttons keep a readable hover instead of the global dark surface', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const cell = page.getByRole('columnheader', { name: 'Priority', exact: true });
    for (const [label, locator] of [['column menu chevron', columnMenuButton(page, 'Priority')], ['column grip', page.getByRole('button', { name: 'Move Priority column', exact: true })]]) {
        await cell.hover(); await locator.hover();
        const read = () => locator.evaluate(node => {
            const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
            let surface = node; let background = parse(getComputedStyle(surface).backgroundColor);
            while ((background[3] ?? 1) === 0 && surface.parentElement) { surface = surface.parentElement; background = parse(getComputedStyle(surface).backgroundColor); }
            const style = getComputedStyle(node);
            return { background, color: parse(style.color), transform: style.transform, shadow: style.boxShadow, spacing: style.letterSpacing };
        });
        await expect.poll(async () => { const { background, color } = await read(); return (background[3] ?? 1) === 1 ? contrastRatio(color.slice(0, 3), background.slice(0, 3)) : 0; }, { message: `${label} hover contrast`, timeout: 2000 }).toBeGreaterThanOrEqual(4.5);
        const settled = await read();
        expect(settled.transform, `${label} does not lift`).toBe('none');
        expect(settled.shadow, `${label} has no drop shadow`).toBe('none');
        expect(['normal', '0px'], `${label} letter spacing`).toContain(settled.spacing);
    }
    // The menu rows reuse the Filters .pop-opt grammar and must not turn dark on hover either.
    await columnMenuButton(page, 'Priority').click();
    const option = columnMenu(page, 'Priority').getByRole('button', { name: 'Move right', exact: true });
    await option.hover();
    await expect.poll(() => option.evaluate(node => {
        const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
        const style = getComputedStyle(node), background = parse(style.backgroundColor), color = parse(style.color);
        return { dark: (background[3] ?? 1) !== 0 && background.slice(0, 3).every(channel => channel < 100), color: color.slice(0, 3).some(channel => channel < 100), transform: style.transform, shadow: style.boxShadow };
    })).toEqual({ dark: false, color: true, transform: 'none', shadow: 'none' });
});

test('the column menu opens from the docked header and from the last column at maximum scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 }); await install(page, true); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const scroller = page.locator('.planning-review-scroll');
    await scroller.evaluate(node => { node.scrollLeft = node.scrollWidth; });
    const last = (await headings(page)).at(-1);
    await columnMenuButton(page, last).hover(); await columnMenuButton(page, last).click();
    const popup = columnMenu(page, last);
    await expect(popup).toBeVisible();
    const box = await popup.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1280);
    await page.keyboard.press('Escape');
    await page.evaluate(() => scrollTo(0, 400));
    const docked = page.locator('.planning-review-docked-header');
    await expect(docked).toBeVisible();
    // The real copy is out of the tab order and hidden from assistive technology while its clone is shown.
    const real = page.locator('table.planning-review-table:not(.planning-review-docked-table) thead .planning-review-colmenu').first();
    await expect(real).toHaveAttribute('aria-hidden', 'true'); await expect(real).toHaveAttribute('tabindex', '-1');
    const chevron = docked.getByRole('button', { name: `${last} column options`, exact: true });
    await docked.locator('th', { hasText: last }).hover(); await chevron.click();
    const dockedPopup = columnMenu(page, last);
    await expect(dockedPopup).toBeVisible();
    const front = await dockedPopup.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.left + 12, r.top + 12)); });
    expect(front).toBe(true);
    // Flipping the dock closes the menu instead of leaving it on a vanished trigger.
    await page.evaluate(() => scrollTo(0, 0));
    await expect(columnMenu(page, last)).toHaveCount(0);
});

test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    test.skip(({ browserName }) => browserName === 'firefox', 'Firefox does not support mobile emulation (isMobile)');
    test('the lane shows without hover and every menu action works by tap', async ({ page }) => {
        await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
        expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
        const chevron = columnMenuButton(page, 'Priority');
        await chevron.scrollIntoViewIfNeeded();
        expect(await chevron.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
        expect(await page.getByRole('button', { name: 'Move Priority column', exact: true }).evaluate(node => getComputedStyle(node).opacity)).toBe('1');
        await chevron.tap();
        const popup = columnMenu(page, 'Priority');
        await expect(popup).toBeVisible();
        const before = (await headings(page)).indexOf('Priority');
        await popup.getByRole('button', { name: 'Move right', exact: true }).tap();
        expect((await headings(page)).indexOf('Priority')).toBe(before + 1);
    });
    test('the corner + opens the Add popover by tap and Show hidden restores a column by tap', async ({ page }) => {
        await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
        await page.getByRole('button', { name: '+ Add column', exact: true }).tap();
        const popup = addDialog(page);
        await expect(popup).toBeVisible();
        const box = await popup.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
        await popup.getByRole('button', { name: 'Capacity', exact: true }).tap();
        await expect(page.getByRole('columnheader', { name: 'Capacity', exact: true })).toHaveCount(1);
    });
    test('no boundary + is rendered under touch', async ({ page }) => {
        await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
        expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
        const boundary = await page.locator('.planning-review-boundary').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).display));
        expect(boundary).toEqual(['none']);
    });
});

for (const mode of ['Epics', 'Stories']) test(`grip and chevron sit side by side in the cell's padding lane, clear of every heading, in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 900 }); await install(page); await page.getByRole('radio', { name: mode, exact: true }).click();
    await showHiddenColumn(page, 'Capacity');
    const lanes = await page.locator('thead th.planning-review-movable').evaluateAll(cells => cells.map(th => {
        const box = th.getBoundingClientRect(), style = getComputedStyle(th), label = th.querySelector('.planning-review-heading');
        const range = document.createRange(); range.selectNodeContents(label); const text = range.getBoundingClientRect();
        const grip = th.querySelector('.planning-review-drag').getBoundingClientRect(), chevron = th.querySelector('.planning-review-colmenu').getBoundingClientRect();
        return { column: th.getAttribute('aria-label'), height: box.height, textRight: text.right, contentRight: box.right - parseFloat(style.paddingRight), lane: parseFloat(style.paddingRight),
            gripLeft: grip.left, gripRight: grip.right, chevronLeft: chevron.left, chevronRight: chevron.right, chevronWidth: chevron.width, chevronHeight: chevron.height,
            chevronDy: chevron.top + chevron.height / 2 - (box.top + box.height / 2), cellRight: box.right, clipped: label.scrollWidth > label.clientWidth + 1 };
    }));
    expect(lanes.length).toBeGreaterThan(5);
    for (const lane of lanes) {
        const note = JSON.stringify(lane);
        expect(lane.lane, note).toBe(34); expect(lane.height, note).toBe(32);
        expect(lane.textRight, note).toBeLessThanOrEqual(lane.contentRight + 0.5);
        expect(lane.gripLeft, note).toBeGreaterThanOrEqual(lane.contentRight - 0.5);
        expect(lane.chevronLeft, note).toBeGreaterThanOrEqual(lane.gripRight - 0.5);
        expect(lane.chevronRight, note).toBeLessThanOrEqual(lane.cellRight + 0.5);
        expect([lane.chevronWidth, lane.chevronHeight], note).toEqual([24, 24]);
        expect(Math.abs(lane.chevronDy), note).toBeLessThan(1);
        expect(lane.clipped, note).toBe(false);
    }
});

// Review (custom) columns: Rename, Show total and Archive live in the same header menu.
async function addTextColumn(page, name) {
    await page.getByRole('button', { name: '+ Add column', exact: true }).click();
    await page.getByLabel('Column name', { exact: true }).fill(name);
    await page.getByRole('dialog', { name: 'Add review column', exact: true }).getByRole('radio', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Add column', exact: true }).click();
}

test('review column menus list Rename, Show total (numbers only), moves, Hide and Archive', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await columnMenuButton(page, 'Cost 0').click();
    const popup = columnMenu(page, 'Cost 0');
    await expect(popup.locator('.pop-subject')).toHaveText('Cost 0 · Shared');
    expect(await menuItems(popup)).toEqual(['Rename', 'Show total', 'Move left', 'Move right', 'Hide column', 'Archive column…']);
    await expect(popup.getByRole('button', { name: 'Show total', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await addTextColumn(page, 'Notes');
    await columnMenuButton(page, 'Notes').click();
    expect(await menuItems(columnMenu(page, 'Notes'))).toEqual(['Rename', 'Move left', 'Move right', 'Hide column', 'Archive column…']);
});

test('Show total toggles the footer total and reports it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const total = page.locator('tfoot .planning-review-cost0');
    await expect(total).toHaveText('22');
    await columnMenuButton(page, 'Cost 0').click();
    const toggle = columnMenu(page, 'Cost 0').getByRole('button', { name: 'Show total', exact: true });
    await toggle.click();
    await expect(total).toHaveText(''); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(total).toHaveText('22'); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.harness.actions().filter(action => action === 'column_aggregation_changed').length)).toBe(2);
});

test('Archive column… asks first, Cancel keeps the column and Archive removes it and closes the menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await columnMenuButton(page, 'Cost 7').click();
    const popup = columnMenu(page, 'Cost 7');
    await popup.getByRole('button', { name: 'Archive column…', exact: true }).click();
    await expect(popup.getByText('Archive “Cost 7”?')).toBeVisible();
    await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(popup.getByText('Archive “Cost 7”?')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Cost 7', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.harness.state().columns.find(column => column.id === 'cost7').archived)).toBe(false);
    await popup.getByRole('button', { name: 'Archive column…', exact: true }).click();
    await popup.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(popup).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Cost 7', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.harness.state().columns.find(column => column.id === 'cost7').archived)).toBe(true);
    expect(await page.evaluate(() => window.harness.actions())).toContain('column_archived');
});

test('every column menu row keeps a readable hover, including the locked and pressed rows', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await columnMenuButton(page, 'Cost 0').click();
    const rows = columnMenu(page, 'Cost 0').locator('button.pop-opt');
    expect(await rows.count()).toBe(6);
    for (let index = 0; index < 6; index += 1) {
        const row = rows.nth(index); await row.hover();
        await expect.poll(() => row.evaluate(node => {
            const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
            const style = getComputedStyle(node), background = parse(style.backgroundColor), color = parse(style.color);
            return { darkSurface: (background[3] ?? 1) !== 0 && background.slice(0, 3).every(channel => channel < 100), darkInk: color.slice(0, 3).every(channel => channel > 200), transform: style.transform, shadow: style.boxShadow, spacing: style.letterSpacing };
        }), { message: `row ${index}` }).toMatchObject({ darkSurface: false, darkInk: false, transform: 'none', shadow: 'none' });
    }
});


// Corner "+": the one place to add a column and to show hidden ones.
test('the corner + sits in the select header cell, stays reachable at both scroll ends and keeps the header 32px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const corner = page.getByRole('button', { name: '+ Add column', exact: true });
    const cell = page.locator('thead th.planning-review-selection');
    await expect(cell).toContainText('');
    await expect(corner).toBeInViewport({ ratio: 1 });
    expect((await cell.boundingBox()).height).toBe(32);
    const scroller = page.locator('.planning-review-scroll');
    await scroller.evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await expect(corner).toBeInViewport({ ratio: 1 });
    const [box, host] = [await corner.boundingBox(), await cell.boundingBox()];
    expect([box.width, box.height]).toEqual([24, 24]);
    expect(box.x).toBeGreaterThanOrEqual(host.x); expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width);
    expect(Math.abs(box.y + box.height / 2 - (host.y + host.height / 2))).toBeLessThan(1);
});

test('the Add popover holds the form, the shared note and Show hidden, and adding at the corner appends', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await page.getByRole('button', { name: '+ Add column', exact: true }).click();
    const popup = addDialog(page);
    await expect(popup.getByLabel('Column name', { exact: true })).toBeFocused();
    const type = popup.getByRole('radiogroup', { name: 'Column type', exact: true });
    await expect(type).toHaveClass(/eng-mode-control/);
    await expect(popup.getByRole('button', { name: 'Add column', exact: true })).toBeVisible();
    await expect(popup.getByText('Shared with everyone reviewing this Sprint.', { exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'Capacity', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Capacity', exact: true })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Capacity', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.harness.state().layouts.story.hidden)).not.toContain('capacity');
    expect(await page.evaluate(() => window.harness.actions())).toEqual(expect.arrayContaining(['add_column_opened', 'column_visibility_changed']));
    await popup.getByLabel('Column name', { exact: true }).fill('Risk');
    await popup.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(popup).toHaveCount(0);
    expect((await headings(page)).at(-1)).toBe('Risk');
    expect(await page.evaluate(() => window.harness.actions())).toContain('column_added');
});

test('the corner + keeps a readable hover', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await install(page);
    const corner = page.getByRole('button', { name: '+ Add column', exact: true });
    await corner.hover();
    const read = () => corner.evaluate(node => {
        const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
        const style = getComputedStyle(node), background = parse(style.backgroundColor), color = parse(style.color);
        return { dark: (background[3] ?? 1) !== 0 && background.slice(0, 3).every(channel => channel < 100), light: color.slice(0, 3).every(channel => channel > 200), transform: style.transform, shadow: style.boxShadow, spacing: style.letterSpacing };
    });
    await expect.poll(read).toMatchObject({ dark: false, light: false, transform: 'none', shadow: 'none' });
    expect(['normal', '0px']).toContain((await read()).spacing);
});

// Boundary "+": a pointer-only accelerator that opens the Add popover at a header boundary.
const liveBoundaries = page => page.evaluate(() => {
    const docked = document.querySelector('.planning-review-docked-header');
    const row = (docked ? docked.querySelector('thead tr') : document.querySelector('table.planning-review-table thead tr'));
    return [...row.cells].filter(cell => cell.dataset.columnId && cell.dataset.columnId !== 'key').map(cell => {
        const rect = cell.getBoundingClientRect();
        return { id: cell.dataset.columnId, label: cell.getAttribute('aria-label'), right: rect.right, top: rect.top, height: rect.height };
    });
});
// The overlay container is zero-width, so visibility is read from its hit area.
const overlay = page => page.locator('.planning-review-boundary-hit');
const overlayHit = page => page.locator('.planning-review-boundary-hit');
async function moveToBoundary(page, boundary, dx) {
    await page.mouse.move(boundary.right + dx, boundary.top + boundary.height / 2, { steps: 2 });
}

for (const mode of ['Epics', 'Stories']) test(`a boundary + appears within 5px of every valid boundary in ${mode} mode, covers the edge on both sides and hides at 10px`, async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 900 }); await install(page); await page.getByRole('radio', { name: mode, exact: true }).click();
    const boundaries = await liveBoundaries(page);
    expect(boundaries.length).toBeGreaterThan(6);
    expect(boundaries[0].id).toBe('summary');
    for (const boundary of boundaries) {
        const note = JSON.stringify(boundary);
        await page.mouse.move(boundary.right + 10, boundary.top + 16);
        await expect(overlay(page), note).toBeHidden();
        await moveToBoundary(page, boundary, 3);
        await expect(overlay(page), note).toBeVisible();
        const hit = await overlayHit(page).boundingBox();
        expect(Math.abs(hit.width - 16), note).toBeLessThan(0.5); expect(Math.abs(hit.height - 24), note).toBeLessThan(0.5);
        expect(Math.abs(hit.x + hit.width / 2 - boundary.right), note).toBeLessThan(1);
        // The glyph itself sits inside the dot, which sits inside the hit area.
        const glyph = await overlayHit(page).evaluate(node => { const dot = node.querySelector('.planning-review-boundary-dot'), range = document.createRange(); range.selectNodeContents(dot); const text = range.getBoundingClientRect(), box = dot.getBoundingClientRect(); return { text: dot.textContent, inside: text.left >= box.left - 0.5 && text.right <= box.right + 0.5 && text.top >= box.top - 2 && text.bottom <= box.bottom + 2, aria: dot.getAttribute('aria-hidden') }; });
        expect(glyph, note).toEqual({ text: '+', inside: true, aria: 'true' });
        for (const side of [-4, 4]) {
            const hitTarget = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.planning-review-boundary-hit'), { x: boundary.right + side, y: boundary.top + 16 });
            expect(hitTarget, `${note} ${side}`).toBe(true);
        }
        // The left cell marks itself and gives up its chevron while the + owns the edge.
        const left = page.locator(`table.planning-review-table thead th[data-column-id="${boundary.id}"]`);
        await expect(left, note).toHaveClass(/planning-review-boundary-hot/);
        const chevron = left.locator('.planning-review-colmenu');
        if (await chevron.count()) expect(await chevron.evaluate(node => getComputedStyle(node).opacity), note).toBe('0');
        // 10px away: absent again, and the hysteresis keeps it at 8px once engaged.
        await page.mouse.move(boundary.right + 8, boundary.top + 16);
        await expect(overlay(page), note).toBeVisible();
        await page.mouse.move(boundary.right + 10, boundary.top + 16);
        await expect(overlay(page), note).toBeHidden();
        await expect(left, note).not.toHaveClass(/planning-review-boundary-hot/);
    }
});

test('clicking a boundary + opens the Add popover and the new column lands directly after the left neighbour', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const order = async () => (await headings(page)).filter(label => label !== 'Key' && label !== 'Summary');
    const boundary = id => liveBoundaries(page).then(list => list.find(item => item.id === id));
    // After Priority.
    await moveToBoundary(page, await boundary('priority'), 2);
    await overlayHit(page).click();
    const popup = addDialog(page);
    await expect(popup).toBeVisible(); await expect(overlay(page)).toBeHidden();
    expect(await page.evaluate(() => window.harness.actions())).toContain('add_column_opened');
    const popupBox = await popup.boundingBox(), edge = (await boundary('priority')).right;
    expect(popupBox.x).toBeLessThanOrEqual(edge + 1); expect(popupBox.x + popupBox.width).toBeGreaterThan(edge);
    await popup.getByLabel('Column name', { exact: true }).fill('Risk'); await popup.getByRole('button', { name: 'Add column', exact: true }).click();
    const afterPriority = await order();
    expect(afterPriority.slice(0, 4)).toEqual(['Status', 'Priority', 'Risk', 'Story Points']);
    // After Summary: first movable column.
    await moveToBoundary(page, await boundary('summary'), -2);
    await overlayHit(page).click();
    await addDialog(page).getByLabel('Column name', { exact: true }).fill('First'); await addDialog(page).getByRole('button', { name: 'Add column', exact: true }).click();
    expect((await order()).slice(0, 3)).toEqual(['First', 'Status', 'Priority']);
    // Show hidden from a boundary also places the restored column there.
    await moveToBoundary(page, await boundary('status'), 2);
    await overlayHit(page).click();
    await addDialog(page).getByRole('button', { name: 'Capacity', exact: true }).click();
    expect((await order()).slice(0, 4)).toEqual(['First', 'Status', 'Capacity', 'Priority']);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(true);
    // The corner still appends.
    await page.getByRole('button', { name: '+ Add column', exact: true }).click();
    await addDialog(page).getByLabel('Column name', { exact: true }).fill('Last'); await addDialog(page).getByRole('button', { name: 'Add column', exact: true }).click();
    expect((await headings(page)).at(-1)).toBe('Last');
});

test('the boundary + is suspended while a popover is open, after scrolling and while a grip is dragged', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const target = (await liveBoundaries(page)).find(item => item.id === 'priority');
    await moveToBoundary(page, target, 2); await expect(overlay(page)).toBeVisible();
    // Dragging a grip: hidden for the whole drag, back after it ends.
    const grip = page.getByRole('button', { name: 'Move Status column', exact: true });
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await grip.dispatchEvent('dragstart', { dataTransfer: transfer });
    await expect(overlay(page)).toBeHidden();
    await page.mouse.move(target.right + 2, target.top + 15); await page.mouse.move(target.right + 3, target.top + 16);
    await expect(overlay(page)).toBeHidden();
    await grip.dispatchEvent('dragend', { dataTransfer: transfer });
    await page.mouse.move(target.right + 2, target.top + 15); await page.mouse.move(target.right + 3, target.top + 16);
    await expect(overlay(page)).toBeVisible();
    // Scrolling the table hides it until the pointer moves again.
    await page.locator('.planning-review-scroll').evaluate(node => { node.scrollLeft += 1; node.dispatchEvent(new Event('scroll')); });
    await expect(overlay(page)).toBeHidden();
    // A column menu keeps it away.
    await page.getByRole('button', { name: 'Status column options', exact: true }).click();
    await moveToBoundary(page, target, 2); await expect(overlay(page)).toBeHidden();
    await page.keyboard.press('Escape');
    // Outside the header row it never shows.
    await page.mouse.move(target.right + 1, target.top + 120); await expect(overlay(page)).toBeHidden();
});

test('the boundary + keeps a readable, flat hover', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 900 }); await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const target = (await liveBoundaries(page)).find(item => item.id === 'status');
    await moveToBoundary(page, target, 1); await expect(overlay(page)).toBeVisible();
    const center = await overlayHit(page).boundingBox(); await page.mouse.move(center.x + 8, center.y + 12);
    const read = () => overlayHit(page).evaluate(node => { const style = getComputedStyle(node), dot = getComputedStyle(node.querySelector('.planning-review-boundary-dot')); return { background: style.backgroundColor, transform: style.transform, shadow: style.boxShadow, spacing: style.letterSpacing, dotBackground: dot.backgroundColor, dotColor: dot.color, dotSpacing: dot.letterSpacing }; });
    await expect.poll(read).toMatchObject({ background: 'rgba(0, 0, 0, 0)', transform: 'none', shadow: 'none', dotBackground: 'rgb(59, 130, 246)', dotColor: 'rgb(255, 255, 255)' });
    const settled = await read(); expect(['normal', '0px']).toContain(settled.spacing); expect(['normal', '0px']).toContain(settled.dotSpacing);
    await page.screenshot({ path: path.join(root, 'tmp/217-ui/boundary-plus-2400.png'), clip: { x: Math.max(0, target.right - 300), y: target.top - 8, width: 600, height: 60 } });
});

test('the boundary + works on the docked header', async ({ page }) => {
    await page.setViewportSize({ width: 2400, height: 700 }); await install(page, true); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    await page.evaluate(() => scrollTo(0, 400));
    await expect(page.locator('.planning-review-docked-header')).toBeVisible();
    const target = (await liveBoundaries(page)).find(item => item.id === 'priority');
    await moveToBoundary(page, target, 2); await expect(overlay(page)).toBeVisible();
    const hit = await overlayHit(page).boundingBox();
    expect(Math.abs(hit.y + 12 - (target.top + 16))).toBeLessThan(1);
    await overlayHit(page).click();
    const popup = addDialog(page); await expect(popup).toBeVisible();
    expect(await popup.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.left + 12, r.top + 12)); })).toBe(true);
    await popup.getByLabel('Column name', { exact: true }).fill('Docked'); await popup.getByRole('button', { name: 'Add column', exact: true }).click();
    const list = (await headings(page)).filter(label => label !== 'Key' && label !== 'Summary');
    expect(list.slice(0, 3)).toEqual(['Status', 'Priority', 'Docked']);
});
