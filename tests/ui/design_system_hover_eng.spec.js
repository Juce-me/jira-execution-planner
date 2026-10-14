const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { mockDashboard, appBaseUrl, catchUpPrefs, groupsConfigPayload } = require('./eng_epic_refresh_fixture');
const { hoverEvidence, evidenceDir, contrast } = require('./design_system_hover_helpers');

test.use({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce',
    deviceScaleFactor: async ({browserName},use)=>use(browserName==='chromium'?1:2),
});
async function openSurface(page, mode, {canEdit=true,canSave=true,reviewLayouts={},excludedCapacityEpics=null,beforeNavigate}= {}) {
    const ctx = await mockDashboard(page);
    ctx.respond('/api/issues/priorities/options',({json})=>json({priorities:[{id:'1',name:'Highest',rank:10},{id:'2',name:'Low',rank:50}],source:'jira'}));
    ctx.respond('/api/issues/project-track/options',({json})=>json({options:[{value:'Flexible'},{value:'Committed'}],source:'jira'}));
    if(process.env.JEP_HOVER_CSS_PATH) await page.route('**/frontend/dist/dashboard.css',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.JEP_HOVER_CSS_PATH,'utf8')}));
    if(!canEdit) ctx.respond('/api/config',({json})=>json({jiraUrl:'https://jira.example',capacityProject:'',authMode:'atlassian_oauth',projectsConfigured:true,userCanEditSettings:false,environmentConfigExists:true}));
    ctx.respond('/api/groups-config', ({ json }) => json({ ...groupsConfigPayload, groups: groupsConfigPayload.groups.map(group => ({ ...group, excludedCapacityEpics:canEdit?(excludedCapacityEpics||group.excludedCapacityEpics):['EPIC-3'], board: { columns: [{ id:'todo', name:'To do', colour:'#597ef7', star:true, statuses:['To Do','In Progress'], min:null, max:null }, { id:'done', name:'Done', colour:'#52c41a', star:false, statuses:['Done'], min:null, max:null }] } })) }));
    ctx.respond('/api/dependencies', ({ json }) => json({ dependencies: { 'E1-S01': [{ key:'E2-S01', category:'block', direction:'inward', dependentKey:'E1-S01', prereqKey:'E2-S01', status:'To Do' }] } }));
    ctx.respond(/\/api\/eng\/sprints\/[^/]+\/review/, ({ json }) => json({schemaRevision:1, columns:[], layouts:reviewLayouts, capabilities:{canRead:true,canSave},cells:[]}));
    await page.addInitScript(value => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(value)), catchUpPrefs({ showPlanning:mode.startsWith('planning'), planningLayout:mode==='planning-table'?'table':'list', showBoard:mode==='board' }));
    if(beforeNavigate) beforeNavigate(ctx);
    await page.goto(appBaseUrl, { waitUntil:'networkidle' });
    await expect(page.locator('.container')).toBeVisible();
    await page.addStyleTag({content:'* { animation: none !important; }'});
    return ctx;
}
for (const mode of ['catch-up','planning-list','planning-table','board']) {
    test(`${mode} real controls retain geometry, fills, contrast and click reachability`, async ({page}, testInfo) => {
        await openSurface(page,mode);
        testInfo.setTimeout(60000);
        const dir=evidenceDir(testInfo);
        await hoverEvidence(page,page.locator('.header-icon-button').first(),testInfo,`${mode}-transparent-header`,{foundation:true});
        await hoverEvidence(page,page.locator('.eng-mode-control .active').first(),testInfo,`${mode}-selected-mode`,{pill:true,selected:true,ringPseudo:true});
        await page.screenshot({path:path.join(dir,`${mode}-surface.png`),fullPage:true,animations:'disabled'});
        fs.writeFileSync(path.join(dir,`${mode}-mounted-controls.json`),JSON.stringify(await page.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().height).map(n=>({text:n.innerText,class:n.className,disabled:n.disabled}))),null,2));
        // Header controls are mounted through the actual dashboard, with normal event handlers.
        await page.getByRole('button',{name:'Open Jira issue menu',exact:true}).click();
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('Escape');
        const team=page.locator('.team-dropdown-toggle').first();
        await expect(team).toBeVisible(); await hoverEvidence(page,team,testInfo,`${mode}-team`,{foundation:true});
        await team.click();
        const teamOption=page.locator('.team-dropdown-option').nth(1);
        await hoverEvidence(page,teamOption,testInfo,`${mode}-team-option`,{rowTint:true,unchangedFill:false});
        await teamOption.click();
        await page.getByRole('textbox',{name:'Filter teams',exact:true}).focus();
        await page.keyboard.press('Escape');
        await expect(team).toHaveClass(/active-filter/);
        await hoverEvidence(page,team,testInfo,`${mode}-selected-team`,{pill:true,selected:true});
        await team.click();
        await page.locator('.team-dropdown-option').first().click();
        await page.getByRole('textbox',{name:'Filter teams',exact:true}).focus();
        await page.keyboard.press('Escape');
        const sprint=page.locator('.sprint-dropdown-toggle').first();
        await expect(sprint).toBeVisible(); await hoverEvidence(page,sprint,testInfo,`${mode}-sprint`,{foundation:true});
        await sprint.click();
        const openSprint=page.locator('.sprint-selector-control .sprint-dropdown-toggle.open').first();
        await expect(openSprint).toHaveJSProperty('tagName','DIV');
        await hoverEvidence(page,openSprint,testInfo,`${mode}-open-sprint`,{foundation:true});
        const sprintOption=page.locator('.sprint-selector-control .sprint-dropdown-option.selected').first();
        const sprintEvidence=await hoverEvidence(page,sprintOption,testInfo,`${mode}-sprint-option`,{unchangedFill:false});
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
            expect(sprintEvidence.hover.shadow).not.toContain('rgb(47, 128, 237)');
            expect(sprintEvidence.hover.shadow).not.toContain('999px');
            expect(await sprintOption.evaluate(node=>{const r=node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
        }
        await sprintOption.click();
        await expect(page.locator('.sprint-selector-control .sprint-dropdown-panel')).toHaveCount(0);
        // Closing restores the Sprint trigger on the next frame; finish that user journey before typing.
        await expect(sprint).toBeFocused();
        const search=page.locator('.search-input').first();
        await search.fill('synthetic');
        await expect(search).toHaveValue('synthetic');
        await hoverEvidence(page,page.locator('.search-clear').first(),testInfo,`${mode}-search-clear`,{icon:true});
        await page.locator('.search-clear').first().click();
        await expect(search).toHaveValue('');
        if(mode==='board') await page.getByRole('button',{name:'EPIC-1: Direct epic with a long assignee and many stories',exact:true}).click();
        const status=page.locator('button.status-pill').first();
        await expect(status).toBeVisible();
        await hoverEvidence(page,status,testInfo,`${mode}-status`,{pill:true,preserveContrast:true});
        await status.click();
        await expect(page.locator('.status-transition-menu').first()).toBeVisible();
        const menu=page.locator('.status-transition-menu').first();
        const option=menu.getByRole('menuitem').first();
        await expect(option).toBeVisible();
        await hoverEvidence(page,option,testInfo,`${mode}-menu-option`,{rowTint:true,unchangedFill:false});
        await option.click(); await expect(menu).toHaveCount(0);
        const submit=page.locator('.dependency-count').first();
        if(mode==='catch-up'||mode==='planning-list') await expect(submit).toBeVisible();
        if(await submit.count()) await hoverEvidence(page,submit,testInfo,`${mode}-dependency`,{pill:true,clipped:true,unchangedFill:false});
        if(mode==='planning-list') {
            const capacity=page.locator('.epic-stat-toggle').first(); await expect(capacity).toBeVisible();
            await hoverEvidence(page,capacity,testInfo,`${mode}-selected-capacity`,{pill:true});
        }
    });
}


test('mounted loading Team selector stays disabled without a hover delta', async ({page}, testInfo) => {
    const ctx=await mockDashboard(page);
    if(process.env.JEP_HOVER_CSS_PATH) await page.route('**/frontend/dist/dashboard.css',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.JEP_HOVER_CSS_PATH,'utf8')}));
    let release; const hold=new Promise(resolve=>{release=resolve;});
    ctx.respond('/api/tasks-with-team-name',async ({json})=>{await hold;return json({issues:[],epics:{},epicsInScope:[],names:{}});});
    await page.addInitScript(value=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify(value)),catchUpPrefs());
    await page.goto(appBaseUrl,{waitUntil:'domcontentloaded'});
    const team=page.locator('.team-dropdown-toggle');
    try {
        await expect(team).toBeVisible();
        await expect(team).toHaveAttribute('aria-disabled','true');
        await hoverEvidence(page,team,testInfo,'loading-disabled-team',{disabled:true});
    } finally {release();}
});

test('mounted Catch Up passive alert row retains its resting border and surface', async ({page},testInfo) => {
    const ctx=await mockDashboard(page);
    if(process.env.JEP_HOVER_CSS_PATH) await page.route('**/frontend/dist/dashboard.css',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.JEP_HOVER_CSS_PATH,'utf8')}));
    const story=ctx.scenario.stories[0]; story.fields.customfield_10004=null;
    ctx.respond('/api/missing-info',({json})=>json({issues:[{...story,fields:{...story.fields,customfield_10101:story.fields.sprint,missingFields:['Story Points']}}],epics:[],count:1,epicCount:0}));
    await page.addInitScript(value=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify(value)),catchUpPrefs());
    await page.goto(appBaseUrl,{waitUntil:'networkidle'});
    await page.addStyleTag({content:'* { animation: none !important; }'});
    await hoverEvidence(page,page.locator('.alerts-panel-toggle'),testInfo,'catch-up-alert-panel-toggle',{foundation:true});
    const summary=page.locator('button.alerts-panel-summary-pill').first();
    const summaryEvidence=await hoverEvidence(page,summary,testInfo,'catch-up-alert-summary',{pill:true,unchangedFill:false,semanticHover:{color:'rgb(250, 140, 22)',background:'rgba(250, 140, 22, 0.14)'}});
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        // Existing warning palette is deferred; pin its original hover ink/tint while proving the added ring.
        expect(summaryEvidence.hover.color).toBe('rgb(250, 140, 22)');
        expect(summaryEvidence.hover.background).toBe('rgba(250, 140, 22, 0.14)');
        expect(summaryEvidence.hover.shadow).toContain('rgb(47, 128, 237)');
    }
    await hoverEvidence(page,page.locator('#eng-alert-missing .alert-toggle'),testInfo,'catch-up-alert-category-toggle',{foundation:true});
    await hoverEvidence(page,page.locator('#eng-alert-missing a.alert-chip').first(),testInfo,'catch-up-interactive-alert-count',{pill:true,unchangedFill:false});
    const local=page.locator('#eng-alert-missing .alert-story-link').first();
    await hoverEvidence(page,local,testInfo,'catch-up-alert-local-link',{underline:true});
    const row=page.locator('#eng-alert-missing .alert-story').first();
    const evidence=await hoverEvidence(page,row,testInfo,'catch-up-alert-row');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(evidence.hover.transform).toBe('none');
        expect(evidence.hover.shadow).toBe(evidence.rest.shadow);
        expect(evidence.hover.border).toBe(evidence.rest.border);
    }
});


// A saved synthetic layout exposes the existing optional Capacity column without
// granting settings rights or changing the mounted control's disabled attribute.
test('read-only Planning Table capacity and empty Planning List Clear Selected have no hover delta',async({page},testInfo)=>{
    testInfo.setTimeout(60000);
    await openSurface(page,'planning-table',{canEdit:false,canSave:false,reviewLayouts:{epic:{hidden:[]}}});
    const capacity=page.locator('.planning-review-capacity .epic-stat-toggle').first();
    await expect(capacity).toBeVisible(); await expect(capacity).toBeDisabled();
    await hoverEvidence(page,capacity,testInfo,'planning-table-disabled-capacity',{disabled:true});
    const excluded=page.locator('.planning-review-capacity .epic-stat-toggle:not(.active)').first();
    await expect(excluded).toBeVisible();await expect(excluded).toBeDisabled();
    await hoverEvidence(page,excluded,testInfo,'planning-table-disabled-excluded-capacity',{disabled:true});
    const corner=page.getByRole('button',{name:'+ Add column',exact:true});
    await expect(corner).toBeDisabled();
    await hoverEvidence(page,corner,testInfo,'planning-table-disabled-corner',{disabled:true});
    const columnMenu=page.getByRole('button',{name:'Key column options',exact:true});
    await expect(columnMenu).toBeDisabled();
    await hoverEvidence(page,columnMenu,testInfo,'planning-table-disabled-column-menu',{disabled:true,restTarget:page.getByRole('button',{name:'Key',exact:true})});
    await page.getByRole('button',{name:'Show Planning list',exact:true}).click();
    const clear=page.getByRole('button',{name:'Clear Selected',exact:true});
    await expect(clear).toBeVisible(); await expect(clear).toBeDisabled();
    await hoverEvidence(page,clear,testInfo,'planning-list-disabled-clear',{disabled:true});
    for(const name of ['Undo','Postponed','Awaiting Val.']){
        const action=page.getByRole('button',{name,exact:true});await expect(action).toBeDisabled();
        await hoverEvidence(page,action,testInfo,`planning-list-disabled-${name}`,{disabled:true});
    }
});

test('mounted Sprint selector stays disabled while its catalog is loading',async({page},testInfo)=>{
    const ctx=await mockDashboard(page);
    if(process.env.JEP_HOVER_CSS_PATH) await page.route('**/frontend/dist/dashboard.css',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.JEP_HOVER_CSS_PATH,'utf8')}));
    let release; const hold=new Promise(resolve=>{release=resolve;});
    ctx.respond('/api/sprints',async({json})=>{await hold;return json({sprints:[]});});
    await page.addInitScript(value=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify(value)),catchUpPrefs());
    await page.goto(appBaseUrl,{waitUntil:'domcontentloaded'});
    const sprint=page.getByRole('button',{name:'Select sprint',exact:true});
    try{
        await expect(sprint).toBeVisible();await expect(sprint).toBeDisabled();
        await hoverEvidence(page,sprint,testInfo,'loading-disabled-sprint',{disabled:true});
    }finally{release();}
});

test('mounted Group selector stays disabled during Board configuration retry',async({page},testInfo)=>{
    const ctx=await mockDashboard(page);
    if(process.env.JEP_HOVER_CSS_PATH) await page.route('**/frontend/dist/dashboard.css',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.JEP_HOVER_CSS_PATH,'utf8')}));
    ctx.respond('/api/config',({json})=>json({jiraUrl:'https://jira.example',capacityProject:'',authMode:'atlassian_oauth',projectsConfigured:true,userCanEditSettings:true,environmentConfigExists:true,boardAllWorkAvailable:null}));
    const ids=[groupsConfigPayload.groups[0].id,'group-beta'];
    const payload={...groupsConfigPayload,groups:[groupsConfigPayload.groups[0],{...groupsConfigPayload.groups[0],id:ids[1],name:'Beta Department'}],preferences:{...groupsConfigPayload.preferences,visibleGroupIds:ids,effectiveVisibleGroupIds:ids}};
    let release;const hold=new Promise(resolve=>{release=resolve;});let groupReads=0;
    ctx.respond('/api/groups-config',async({json})=>{groupReads++;if(groupReads>1)await hold;return json(payload);});
    await page.addInitScript(value=>localStorage.setItem('jira_dashboard_ui_prefs_v1',JSON.stringify(value)),catchUpPrefs({showBoard:true}));
    await page.goto(appBaseUrl,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Select sprint',exact:true}).click();
    await page.getByRole('option',{name:'Component',exact:true}).click();
    await page.getByRole('button',{name:'Retry configuration',exact:true}).click();
    const group=page.getByRole('button',{name:'Select group',exact:true});
    try{
        await expect(group).toBeVisible();await expect(group).toHaveAttribute('aria-disabled','true');
        await hoverEvidence(page,group,testInfo,'retry-disabled-group',{disabled:true});
    }finally{release();}
    await expect(group).toHaveAttribute('aria-disabled','false');
    await hoverEvidence(page,group,testInfo,'retry-enabled-group',{foundation:true});
    await group.click();
    const option=page.locator('.group-dropdown-option').first();
    await hoverEvidence(page,option,testInfo,'retry-group-option',{rowTint:true,unchangedFill:false});
    await option.click();
    await expect(page.locator('.group-dropdown-panel')).toHaveCount(0);
});

test('mounted pinned-column menu keeps its locked move action unchanged on hover',async({page},testInfo)=>{
    await openSurface(page,'planning-table');
    await page.getByRole('button',{name:'Status column options',exact:true}).click();
    const locked=page.getByRole('dialog',{name:'Status column options',exact:true}).getByRole('button',{name:'Move left',exact:true});
    await expect(locked).toHaveAttribute('aria-disabled','true');
    await hoverEvidence(page,locked,testInfo,'planning-table-locked-move-left',{disabled:true});
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog',{name:'Status column options',exact:true})).toHaveCount(0);
});

for (const mode of ['catch-up','planning-list','planning-table','board']) {
    test(`${mode} mounted filter actions use rings, circles, underlines and unframed option rows`,async({page},testInfo)=>{
        testInfo.setTimeout(90000);
        await openSurface(page,mode);
        const trigger=page.locator('.filterbar .fb-trigger').first();
        await hoverEvidence(page,trigger,testInfo,`${mode}-filters-trigger`,{foundation:true});
        await trigger.click();
        const panel=page.getByRole('dialog',{name:'Filters',exact:true});
        const lockedOption=panel.locator('.pop-opt[aria-disabled="true"]').first();
        if(await lockedOption.count()) await hoverEvidence(page,lockedOption,testInfo,`${mode}-filter-locked-option`,{disabled:true});
        const group=panel.locator('.pop-group:has(.pop-all):has(.pop-opt:not([aria-disabled="true"]))').first();
        const option=group.locator('.pop-opt').first();
        await hoverEvidence(page,option,testInfo,`${mode}-filter-selected-option`,{rowTint:true,unchangedFill:false});
        await option.click();
        await hoverEvidence(page,option,testInfo,`${mode}-filter-unselected-option`,{rowTint:true,unchangedFill:false});
        const all=group.locator('.pop-all');
        await hoverEvidence(page,all,testInfo,`${mode}-filter-select-all`,{underline:true});
        await page.keyboard.press('Escape');
        const remove=page.locator('.fb-chips .chip:not([hidden]) .x').first();
        await hoverEvidence(page,remove,testInfo,`${mode}-filter-chip-remove`,{icon:true});
        await hoverEvidence(page,page.locator('.chip-clear'),testInfo,`${mode}-filter-clear-all`,{underline:true});
        await remove.click();
        await expect(page.locator('.chip-clear')).toHaveCount(0);
        const initiative=page.locator('.initiative-grouping-control .fb-trigger');
        if(await initiative.count()) {
            if(await initiative.getAttribute('aria-pressed')==='true') await initiative.click();
            await hoverEvidence(page,initiative,testInfo,`${mode}-initiative`,{foundation:true});
            await initiative.click();
            await expect(initiative).toHaveAttribute('aria-pressed','true');
            await hoverEvidence(page,initiative,testInfo,`${mode}-selected-initiative`,{pill:true,selected:true,iconOnly:true});
            await initiative.click();
        }
        await page.getByRole('button',{name:'Open Jira issue menu',exact:true}).click();
        const exportOption=page.locator('.jira-export-menu-item').first();
        await hoverEvidence(page,exportOption,testInfo,`${mode}-jira-option`,{rowTint:true,unchangedFill:false});
        // The real export handler opens a synthetic Jira page and closes the menu.
        const popupPromise=page.waitForEvent('popup');
        await exportOption.click();
        const popup=await popupPromise; await popup.close();
        await expect(page.locator('.jira-export-menu')).toHaveCount(0);
    });
}

test('mounted compact filter lane paints its more-chip ring within clipping and opens Filters',async({page},testInfo)=>{
    await openSurface(page,'catch-up');
    await page.locator('.filterbar .fb-trigger').first().click();
    const panel=page.getByRole('dialog',{name:'Filters',exact:true});
    const groups=panel.locator('.pop-group');
    for(let i=0;i<await groups.count();i++) {
        const options=groups.nth(i).locator('.pop-opt:not([aria-disabled="true"]):not(.radio)');
        if(await options.count()>1) await options.first().click();
    }
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:1000});
    const more=page.locator('.chip-more');
    await expect(more).toBeVisible();
    await hoverEvidence(page,more,testInfo,'compact-filter-more',{pill:true,clipped:true,selected:true});
    await more.click();await expect(panel).toBeVisible();
});

test('mounted dirty Planning Table Save keeps its dark fill and disabled saving actions stay unchanged',async({page},testInfo)=>{
    testInfo.setTimeout(60000);
    const ctx=await openSurface(page,'planning-table');
    let release;const hold=new Promise(resolve=>{release=resolve;});
    ctx.respond(/\/api\/eng\/sprints\/[^/]+\/review/,async({call,json})=>{
        if(call.method==='PATCH') await hold;
        const layouts={};
        for(const change of call.body?.schemaChanges||[]) if(change.action==='layout') layouts[change.rowKind]={order:change.order,hidden:change.hidden};
        return json({schemaRevision:call.method==='PATCH'?2:1,columns:[],layouts,capabilities:{canRead:true,canSave:true},cells:[]});
    });
    await page.getByRole('button',{name:'Priority column options',exact:true}).click();
    const hide=page.getByRole('dialog',{name:'Priority column options',exact:true}).getByRole('button',{name:'Hide column',exact:true});
    await hoverEvidence(page,hide,testInfo,'planning-table-hide-option',{rowTint:true,unchangedFill:false});
    await hide.click();
    const save=page.getByRole('button',{name:'Save review',exact:true});
    await expect(save).toBeEnabled();
    await hoverEvidence(page,save,testInfo,'planning-table-primary-save',{foundation:true});
    await hoverEvidence(page,page.getByRole('button',{name:'Discard',exact:true}),testInfo,'planning-table-discard',{foundation:true});
    await save.click();
    try {
        await expect(save).toBeDisabled();
        await hoverEvidence(page,save,testInfo,'planning-table-disabled-saving-primary',{disabled:true});
        await hoverEvidence(page,page.getByRole('button',{name:'Discard',exact:true}),testInfo,'planning-table-disabled-saving-discard',{disabled:true});
    }finally{release();}
    await expect(save).toHaveCount(0);
});

test.describe('touch filter fallback',()=>{
    test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:1000}});
    test('mounted Filters, option, clear and Jira menu remain tappable without hover rings',async({page},testInfo)=>{
        await openSurface(page,'catch-up');
        expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
        const trigger=page.locator('.filterbar .fb-trigger').first();
        const resting=await trigger.evaluate(node=>getComputedStyle(node).boxShadow);
        await trigger.tap();
        await expect(page.getByRole('dialog',{name:'Filters',exact:true})).toBeVisible();
        expect(await trigger.evaluate(node=>getComputedStyle(node).boxShadow)).toBe(resting);
        const option=page.locator('.popover .pop-opt:not([aria-disabled="true"]):not(.radio)').first();
        await option.tap();await page.keyboard.press('Escape');
        await page.locator('.chip-clear').tap();await expect(page.locator('.chip-clear')).toHaveCount(0);
        await page.getByRole('button',{name:'Open Jira issue menu',exact:true}).tap();
        await expect(page.getByRole('menu')).toBeVisible();
        await page.screenshot({path:path.join(evidenceDir(testInfo),'touch-filter-menu.png'),fullPage:true,animations:'disabled'});
    });
});

for(const mode of ['catch-up','planning-list','board']) {
    test(`${mode} mounted issue icons, links and passive rows use their registered treatment`,async({page},testInfo)=>{
        testInfo.setTimeout(90000);
        await openSurface(page,mode);
        if(mode==='board') {
            const card=page.locator('.eng-board .ecard').first();
            const proof=await hoverEvidence(page,card,testInfo,'board-outer-card',{unchangedFill:true});
            if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(proof.hover.shadow).toContain('4px 12px');
            const open=card.locator('.ecard-open');
            const triggerProof=await hoverEvidence(page,open,testInfo,'board-inner-trigger');
            if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(triggerProof.hover.shadow).toBe('none');
            await open.click();
            await hoverEvidence(page,page.locator('.eng-board .m-close'),testInfo,'board-panel-close',{icon:true});
        } else {
            const row=page.locator('.task-item').first();
            const proof=await hoverEvidence(page,row,testInfo,`${mode}-passive-story`);
            if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
                expect(proof.hover.shadow).toBe(proof.rest.shadow);
                expect(proof.hover.border).toBe(proof.rest.border);
            }
            const remove=row.locator('.task-remove');
            await row.hover();
            await hoverEvidence(page,remove,testInfo,`${mode}-story-remove`,{foundation:true,restTarget:row.locator('.task-title')});
            await hoverEvidence(page,page.locator('.epic-link').first(),testInfo,`${mode}-epic-link`,{underline:true});
            const refresh=page.locator('.epic-refresh-button').first();
            await hoverEvidence(page,refresh,testInfo,`${mode}-epic-refresh`,{foundation:true,restTarget:page.locator('.epic-name').first()});
        }
        const priority=page.locator('button.task-priority-icon').first();
        await hoverEvidence(page,priority,testInfo,`${mode}-priority`,{icon:true});
        const pseudo=await priority.evaluate(node=>({image:getComputedStyle(node,'::before').backgroundImage,shadow:getComputedStyle(node,'::before').boxShadow}));
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
            expect(pseudo.image).toContain('radial-gradient'); expect(pseudo.shadow).toBe('none');
        }
        await priority.click();
        const priorityOptions=page.locator('.priority-transition-option');
        await expect(priorityOptions.first()).toBeFocused();
        // WebKit retains focus-visible tint on the first option; measure hover on an unfocused row.
        const option=priorityOptions.nth(1);
        await hoverEvidence(page,option,testInfo,`${mode}-priority-option`,{rowTint:true,unchangedFill:false});
        await page.keyboard.press('Escape');
        const track=page.locator('button.epic-track-indicator').first();
        await hoverEvidence(page,track,testInfo,`${mode}-track`,{icon:true});
        await track.click();
        await hoverEvidence(page,page.locator('.project-track-transition-option').first(),testInfo,`${mode}-track-option`,{rowTint:true,unchangedFill:false});
        await page.keyboard.press('Escape');
    });
}

test('mounted inline editors retain amber ink, underline feedback and disabled pending state',async({page},testInfo)=>{
    testInfo.setTimeout(90000);
    const ctx=await openSurface(page,'catch-up');
    const person=page.locator('.task-item input.issue-person-editor-trigger').first();
    const proof=await hoverEvidence(page,person,testInfo,'catch-up-person-inline');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        const border=await person.evaluate(node=>getComputedStyle(node).borderBottomColor);
        expect(border).toBe(proof.hover.color); expect(proof.hover.shadow).toBe('none');
        expect(proof.hover.color).toBe(proof.rest.color); expect(proof.hover.fill).toEqual(proof.rest.fill);
    }
    ctx.respond(/\/api\/issues\/[^/]+\/editable-fields/,({json})=>json({editable:true,currentValue:{accountId:'owner',displayName:'Story Owner'},me:{accountId:'me',displayName:'Synthetic Me'},mappingRevision:'synthetic-revision'}));
    await person.click();
    const option=page.locator('.issue-person-editor-option').first();
    await hoverEvidence(page,option,testInfo,'catch-up-person-selected-option',{unchangedFill:false});
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(await option.evaluate(node=>getComputedStyle(node).boxShadow)).toBe('none');
    let release;const hold=new Promise(resolve=>{release=resolve;});
    ctx.respond(/\/api\/issues\/[^/]+\/field$/,async({json})=>{await hold;return json({issueKey:'E1-S01',field:'assignee',value:{accountId:'me',displayName:'Synthetic Me'},result:'success'});});
    await option.click();
    try {
        await expect(person).toBeDisabled();
        await hoverEvidence(page,person,testInfo,'catch-up-disabled-pending-person',{disabled:true});
    } finally {release();}
});

test('mounted Story requirement, summary, subtasks and retries preserve their kinds',async({page},testInfo)=>{
    testInfo.setTimeout(90000);
    const ctx=await openSurface(page,'catch-up',{beforeNavigate:ctx=>{
        ctx.respond('/api/eng/story-readiness',({json})=>json({schemaVersion:1,complete:true,scope:{groupId:'group-alpha',sprintId:'3001',sprintName:'2026Q2 Sprint 42',sprintState:'active'},epics:[{key:'REQUIRED-1',summary:'Synthetic requirement epic',status:{name:'In Progress'},projectClass:'product',projectKey:'PROD',missingTeams:[{id:'team-alpha',name:'Alpha Team',reason:'no_stories'}]}]}));
        ctx.respond('/api/issues/subtasks',({json})=>json({error:'synthetic read unavailable'},502));
    }});
    const passiveCount=await hoverEvidence(page,page.locator('div.alert-chip').first(),testInfo,'catch-up-passive-alert-count');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {expect(passiveCount.hover.shadow).toBe(passiveCount.rest.shadow);expect(passiveCount.hover.background).toBe(passiveCount.rest.background);}
    const requirement=page.locator('.story-requirement-card').first();
    const proof=await hoverEvidence(page,requirement,testInfo,'catch-up-story-requirement');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(await requirement.locator('.story-requirement-title').evaluate(node=>getComputedStyle(node).textDecorationLine)).toContain('underline');
        expect(proof.hover.shadow).toBe(proof.rest.shadow);
    }
    await hoverEvidence(page,page.locator('.alert-story-local-link').first(),testInfo,'catch-up-requirement-alert-local-link',{underline:true});
    const subtasks=page.locator('.story-subtasks-toggle').first();
    const subtasksEvidence=await hoverEvidence(page,subtasks,testInfo,'catch-up-subtasks-summary',{pill:true,unchangedFill:false});
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(subtasksEvidence.hover.background).toBe('rgb(238, 244, 255)');
        expect(subtasksEvidence.hover.border).toBe('rgba(89, 126, 247, 0.42)');
        expect(subtasksEvidence.hover.color).toBe('rgb(26, 26, 26)');
    }
    await subtasks.click();
    await hoverEvidence(page,subtasks,testInfo,'catch-up-expanded-subtasks-summary',{pill:true,selected:true});
    const retry=page.locator('.story-subtasks-error button').first();
    await hoverEvidence(page,retry,testInfo,'catch-up-subtasks-retry',{foundation:true});
    await openSurface(page,'planning-table');
    const summary=page.locator('button.issue-summary-editor-trigger').first();
    const summaryEvidence=await hoverEvidence(page,summary,testInfo,'planning-table-inline-summary',{underline:true});
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(summaryEvidence.hover.color).toBe(summaryEvidence.rest.color);
        expect(summaryEvidence.textContrast).toBeGreaterThanOrEqual(4.5);
        expect(summaryEvidence.hover.textDecoration).toContain('underline');
        expect(summaryEvidence.hover.shadow).toBe('none');
    }
});

test('mounted compact Board off-frame hint rings its visible pill without framing the overlay',async({page},testInfo)=>{
    await page.setViewportSize({width:390,height:1000});
    await openSurface(page,'board',{beforeNavigate:ctx=>ctx.respond('/api/groups-config',({json})=>json({...groupsConfigPayload,groups:groupsConfigPayload.groups.map(group=>({...group,board:{columns:[{id:'todo',name:'To Do',colour:'#597ef7',star:true,statuses:['To Do'],min:null,max:null},{id:'progress',name:'In Progress',colour:'#69c0ff',star:false,statuses:['In Progress'],min:null,max:null},{id:'done',name:'Done',colour:'#52c41a',star:false,statuses:['Done'],min:null,max:null}]}}))}))});
    const hint=page.locator('.eng-board .board-hint.right.is-on');
    await expect(hint).toBeVisible();
    const pip=hint.locator('.pip');
    await hoverEvidence(page,pip,testInfo,'board-off-frame-pip',{pill:true});
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(await hint.evaluate(node=>getComputedStyle(node).boxShadow)).toBe('none');
    await pip.click();
});

test.describe('touch issue actions',()=>{
    test.use({hasTouch:true,isMobile:true,viewport:{width:430,height:1000}});
    test('mounted Story remove remains tappable without hover effects',async({page},testInfo)=>{
        await openSurface(page,'catch-up');
        expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
        const row=page.locator('.task-item').first();
        const key=await row.getAttribute('data-task-key');
        const remove=row.locator('.task-remove');
        await expect(remove).toBeVisible();
        expect(await remove.evaluate(node=>getComputedStyle(node).opacity)).toBe('1');
        await page.screenshot({path:path.join(evidenceDir(testInfo),'touch-story-remove.png'),fullPage:false,animations:'disabled'});
        expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
        await remove.tap();
        await expect(page.locator(`.task-item[data-task-key="${key}"]`)).toHaveCount(0);
        expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
    });
    test('mounted Board activation remains tappable without hover effects',async({page},testInfo)=>{
        await openSurface(page,'board');
        expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
        const card=page.locator('.ecard').first();
        await page.waitForTimeout(450);
        const rest=await card.evaluate(node=>({shadow:getComputedStyle(node).boxShadow,border:getComputedStyle(node).borderColor}));
        await card.locator('.ecard-open').tap();
        await expect(page.locator('.epic-panel')).toBeVisible();
        await page.waitForTimeout(450);
        expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(await card.evaluate(node=>({shadow:getComputedStyle(node).boxShadow,border:getComputedStyle(node).borderColor}))).toEqual(rest);
    });
});

for(const mode of ['planning-list','planning-table']) test(`${mode} Planning ownership controls retain their kinds and geometry`,async({page},testInfo)=>{
    testInfo.setTimeout(120000);
    await openSurface(page,mode,{reviewLayouts:{epic:{hidden:[]}},excludedCapacityEpics:['EPIC-3']});
    const layout=page.locator('.planning-layout-toggle:visible').first();
    await hoverEvidence(page,layout,testInfo,`${mode}-layout`,mode==='planning-table'?{pill:true,selected:true,iconOnly:true}:{foundation:true});
    expect(await layout.evaluate(node=>getComputedStyle(node).backgroundImage)).toBe('none');
    if(mode==='planning-list') {
        const jira=page.getByRole('button',{name:'Open selected stories in Jira',exact:true});
        await hoverEvidence(page,jira,testInfo,'planning-list-disabled-jira',{disabled:true});
        await hoverEvidence(page,page.locator('.task-checkbox').first(),testInfo,'planning-list-task-checkbox',{pill:true});
        const accepted=page.getByRole('button',{name:'Accepted',exact:true});
        await hoverEvidence(page,accepted,testInfo,'planning-list-unselected-accepted',{foundation:true});
        await accepted.click();
        await expect(accepted).toHaveClass(/active/);
        await hoverEvidence(page,accepted,testInfo,'planning-list-selected-accepted',{pill:true,selected:true,semanticHover:{color:'rgb(56, 158, 13)',background:'rgb(246, 255, 237)'}});
        const all=page.getByRole('button',{name:'Select All',exact:true});
        await hoverEvidence(page,all,testInfo,'planning-list-select-all',{foundation:true});
        await all.click();
        await expect(jira).toBeEnabled();
        await hoverEvidence(page,jira,testInfo,'planning-list-framed-jira',{foundation:true});
        expect(await jira.evaluate(node=>getComputedStyle(node).backgroundImage)).toBe('none');
        await hoverEvidence(page,page.getByRole('button',{name:'Clear Selected',exact:true}),testInfo,'planning-list-clear-selected',{foundation:true});
    } else {
        const rowKind=page.getByRole('radiogroup',{name:'Planning review rows'}).getByRole('radio',{checked:true});
        await hoverEvidence(page,rowKind,testInfo,'planning-table-selected-row-kind',{pill:true,selected:true,ringPseudo:true});
        const heading=page.getByRole('button',{name:'Status',exact:true});
        await hoverEvidence(page,heading,testInfo,'planning-table-sort',{foundation:true,clipped:true});
        const included=page.locator('.planning-review-capacity .epic-stat-toggle.active').first();
        await hoverEvidence(page,included,testInfo,'planning-table-included',{pill:true,selected:true,clipped:true});
        await hoverEvidence(page,page.locator('.planning-review-capacity .epic-stat-toggle:not(.active)').first(),testInfo,'planning-table-excluded',{pill:true,clipped:true});
        const summary=page.locator('button.issue-summary-editor-trigger').first();
        await hoverEvidence(page,summary,testInfo,'planning-table-summary',{underline:true});
        const cell=page.locator('thead th.planning-review-status');
        await cell.hover();
        const chevron=page.getByRole('button',{name:'Status column options',exact:true});
        await hoverEvidence(page,chevron,testInfo,'planning-table-chevron',{icon:true,restTarget:heading});
        await hoverEvidence(page,page.getByRole('button',{name:'Move Status column',exact:true}),testInfo,'planning-table-drag',{icon:true,restTarget:heading});
        await hoverEvidence(page,page.getByRole('button',{name:'+ Add column',exact:true}),testInfo,'planning-table-corner',{icon:true});
        await chevron.click();
        const menu=page.getByRole('dialog',{name:'Status column options',exact:true});
        const hide=menu.getByRole('button',{name:'Hide column',exact:true});
        await hoverEvidence(page,hide,testInfo,'planning-table-hide',{rowTint:true,unchangedFill:false});
        await hide.click();
        await expect(menu).toHaveCount(0);
        await page.getByRole('button',{name:'Key column options',exact:true}).click();
        await page.getByRole('dialog',{name:'Key column options',exact:true}).getByRole('button',{name:'Hide column',exact:true}).click();
        await hoverEvidence(page,page.locator('.planning-review-jira-link').first(),testInfo,'planning-table-hidden-key-jira',{icon:true});
    }
    await page.screenshot({path:path.join(evidenceDir(testInfo),`${mode}-planning-surface.png`),animations:'disabled'});
});

test('Planning capacity rail icons and inline fields retain reveal and edit geometry',async({page},testInfo)=>{
    testInfo.setTimeout(90000);
    await openSurface(page,'planning-list',{beforeNavigate:ctx=>{
        ctx.respond('/api/config',({json})=>json({jiraUrl:'https://jira.example',capacityProject:'CAP',authMode:'atlassian_oauth',projectsConfigured:true,userCanEditSettings:true,environmentConfigExists:true}));
        ctx.respond('/api/capacity',({json})=>json({enabled:true,mutationEnabled:true,sprint:'2026Q2 Sprint 42',capacities:{'Alpha Team':5.5,'Beta Team':3},entries:[{teamName:'Alpha Team',issueKey:'CAP-101',capacity:5.5},{teamName:'Beta Team',issueKey:'CAP-102',capacity:3}]}));
    }});
    const card=page.locator('.planning-team-capacity-cards .team-stat-card').filter({has:page.locator('.team-stat-label',{hasText:'Alpha Team'})});
    await expect(card).toBeVisible();await card.hover();
    const pencil=page.getByRole('button',{name:'Edit Alpha Team capacity',exact:true});
    await hoverEvidence(page,pencil,testInfo,'planning-capacity-pencil',{foundation:true,restTarget:card});
    await hoverEvidence(page,page.getByRole('link',{name:'Open Alpha Team capacity ticket in Jira',exact:true}),testInfo,'planning-capacity-jira',{foundation:true,restTarget:card});
    await pencil.click();
    const save=page.getByRole('button',{name:'Save Alpha Team capacity',exact:true});
    await expect(save).toBeDisabled();
    await hoverEvidence(page,save,testInfo,'planning-capacity-disabled-save',{disabled:true});
    await card.locator('.team-capacity-input').fill('6.5');
    await expect(save).toBeEnabled();
    await hoverEvidence(page,save,testInfo,'planning-capacity-enabled-save',{foundation:true});
    await hoverEvidence(page,page.getByRole('button',{name:'Cancel Alpha Team capacity edit',exact:true}),testInfo,'planning-capacity-cancel',{foundation:true});
    await page.getByRole('button',{name:'Cancel Alpha Team capacity edit',exact:true}).click();
    await page.screenshot({path:path.join(evidenceDir(testInfo),'planning-capacity-rail.png'),animations:'disabled'});
    await page.getByRole('button',{name:'Show Planning table',exact:true}).click();
    await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const person=page.locator('input.issue-person-editor-trigger').first();
    await page.addStyleTag({content:'html {scroll-behavior:auto!important;} * {transition:none!important;}'});
    await person.scrollIntoViewIfNeeded();await page.waitForTimeout(600);
    const personEvidence=await hoverEvidence(page,person,testInfo,'planning-table-inline-person');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        await expect(person).toHaveCSS('border-bottom-color',personEvidence.rest.color);
        expect(personEvidence.hover.color).toBe(personEvidence.rest.color);
        expect(personEvidence.hover.shadow).toBe('none');
        expect(personEvidence.textContrast).toBeGreaterThanOrEqual(4.5);
    }
});

test('Planning Table shared summary recovery action uses ordinary feedback',async({page},testInfo)=>{
    testInfo.setTimeout(90000);
    await openSurface(page,'planning-table',{beforeNavigate:ctx=>{
        ctx.respond(call=>/\/api\/issues\/[^/]+\/editable-fields$/.test(call.pathname),({json})=>json({editable:true,currentValue:'Synthetic summary',mappingRevision:'synthetic',baseUpdated:'synthetic'}));
        ctx.respond(call=>/\/api\/issues\/[^/]+\/field$/.test(call.pathname)&&call.method==='POST',({status})=>status(409,{error:'stale_issue'}));
    }});
    const trigger=page.locator('button.issue-summary-editor-trigger').first();
    await expect(trigger).toBeVisible();await trigger.click();
    const editor=page.locator('textarea.issue-summary-editor-input').first();
    await expect(editor).toBeEditable();await editor.fill('Synthetic draft');await editor.press('Enter');
    const recovery=page.getByRole('button',{name:'Reload field',exact:true});
    await expect(recovery).toBeVisible();
    await hoverEvidence(page,recovery,testInfo,'planning-table-summary-reload',{foundation:true});
    await page.screenshot({path:path.join(evidenceDir(testInfo),'planning-table-summary-recovery.png'),animations:'disabled'});
});


for (const mode of ['catch-up','planning-list','planning-table','board']) test(`${mode} Stats-owned capacity has its actual mounted contract`,async({page},testInfo)=>{
    await openSurface(page,mode,{reviewLayouts:{epic:{hidden:[]}},excludedCapacityEpics:['EPIC-3']});
    if(mode==='catch-up'||mode==='board') {
        await expect(page.locator('.epic-stat-toggle:visible')).toHaveCount(0);
        return;
    }
    const included=page.locator('.epic-stat-toggle.active:visible').first();
    const excluded=page.locator('.epic-stat-toggle:not(.active):visible').first();
    await hoverEvidence(page,included,testInfo,`${mode}-stats-owned-included`,{pill:true,selected:true,clipped:mode==='planning-table'});
    fs.writeFileSync(path.join(evidenceDir(testInfo),`${mode}-excluded-ancestor-opacity.json`),JSON.stringify(await excluded.evaluate(node=>{const chain=[]; for(let p=node;p;p=p.parentElement) {const style=getComputedStyle(p); chain.push({className:p.className,opacity:style.opacity,fill:style.backgroundColor,color:style.color});} return chain;}),null,2));
    if(mode==='planning-table') {
        await hoverEvidence(page,excluded,testInfo,`${mode}-stats-owned-excluded`,{pill:true,clipped:true});
    } else {
        // Exact pre-existing excluded-Epic opacity debt: preserve it, while every
        // ordinary control retains the strict general ring/readability checks.
        const evidence=await hoverEvidence(page,excluded,testInfo,`${mode}-stats-owned-excluded`);
        expect(evidence.hover.shadow).toBe('rgb(47, 128, 237) 0px 0px 0px 1px, rgba(47, 128, 237, 0.25) 0px 0px 0px 3px');
        expect(evidence.hover.filter).toBe('brightness(0.94)');
        expect(evidence.hover.color).toBe('rgb(102, 102, 102)');
        expect(evidence.hover.background).toBe('rgb(255, 255, 255)');
        expect(await excluded.locator('xpath=ancestor::*[contains(@class,"epic-excluded")]').evaluate(node=>getComputedStyle(node).opacity)).toBe('0.55');
        expect(await page.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(248, 247, 244)');
        const box=evidence.hover.box;
        const png=await page.screenshot({clip:{x:box[0]-3,y:box[1]-3,width:box[2]+6,height:box[3]+6},animations:'disabled'});
        const samples=await page.evaluate(async data=>{
            const img=new Image();img.src=data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            const counts={ink:0,fill:0,ring:0};
            for(let i=0;i<pixels.length;i+=4)for(const [key,rgb] of Object.entries({ink:[164,163,162],fill:[244,243,242],ring:[136,177,232]}))if(rgb.every((value,index)=>Math.abs(pixels[i+index]-value)<=1))counts[key]++;
            return counts;
        },'data:image/png;base64,'+png.toString('base64'));
        expect(samples.ink).toBeGreaterThan(4); expect(samples.fill).toBeGreaterThan(4); expect(samples.ring).toBeGreaterThan(4);
        expect(contrast([164,163,162],[244,243,242])).toBeCloseTo(2.272307781750222,8);
        expect(contrast([136,177,232],[248,247,244])).toBeCloseTo(2.063155996174732,8);
        fs.writeFileSync(path.join(evidenceDir(testInfo),'planning-list-excluded-composed-paint.json'),JSON.stringify({samples,textContrast:contrast([164,163,162],[244,243,242]),ringContrast:contrast([136,177,232],[248,247,244])},null,2));
    }
});

test('Planning Table Stats-owned disclosure preserves collapsed and expanded text geometry',async({page},testInfo)=>{
    await openSurface(page,'planning-table',{beforeNavigate:ctx=>{
        ctx.respond('/api/config',({json})=>json({jiraUrl:'https://jira.example',capacityProject:'CAP',authMode:'atlassian_oauth',projectsConfigured:true,userCanEditSettings:true,environmentConfigExists:true}));
        ctx.respond('/api/capacity',({json})=>json({enabled:true,mutationEnabled:true,capacities:{'Alpha Team':5},entries:[{teamName:'Alpha Team',issueKey:'CAP-SYNTHETIC',capacity:5}]}));
    }});
    const toggle=page.locator('.capacity-header-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await hoverEvidence(page,toggle,testInfo,'stats-effort-collapsed',{foundation:true,clipped:true,readableDescendants:true});
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('.capacity-grid-wrapper')).toBeVisible();
    await page.waitForTimeout(800); // Settle the existing 600ms panel expansion before measuring hover.
    await hoverEvidence(page,toggle,testInfo,'stats-effort-expanded',{foundation:true,clipped:true,readableDescendants:true});
    for(const hook of ['todo-link','postponed-link','accepted-link']) {
        const arrow=page.locator(`.capacity-grid .${hook}`).first();
        await expect(arrow).toHaveText('↗');
        await arrow.scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
        const arrowEvidence=await hoverEvidence(page,arrow,testInfo,`stats-capacity-${hook}`,{icon:true});
        expect(arrowEvidence.textContrast).toBeGreaterThanOrEqual(3); // Actual semantic arrow glyph without readable words.
        expect(arrowEvidence.hover.color).toBe('rgb(212, 56, 13)');
    }
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-effort-disclosure.png'),animations:'disabled'});
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','false');
});

// Framed header icons shade within their rounded-square border, without a full-size circle.
test('framed header icon hover follows the button shape with subtle shading', async ({page},testInfo)=>{
    await openSurface(page,'catch-up');
    const planning=page.locator('.eng-mode-control .segmented-control-button:not(.active)').first();
    await hoverEvidence(page,planning,testInfo,'subtle-planning-mode',{foundation:true});
    expect(await planning.evaluate(node=>getComputedStyle(node).getPropertyValue('--overlay-pct').trim())).toBe('8');
    const controls=page.locator('.header-actions-row button.header-icon-button');
    await expect(controls).toHaveCount(3);
    for(let index=0;index<3;index++){
        const control=controls.nth(index);
        const result=await hoverEvidence(page,control,testInfo,`framed-header-${index}`,{foundation:true});
        expect(result.hover.backgroundImage).toBe('none');
        expect(await control.evaluate(node=>getComputedStyle(node).getPropertyValue('--overlay-pct').trim())).toBe('8');
    }
});
