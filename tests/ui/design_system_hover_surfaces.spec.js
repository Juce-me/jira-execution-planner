const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { test: baseTest, expect } = require('@playwright/test');
const test = baseTest.extend({
    deviceScaleFactor: async ({ browserName }, use) => use(browserName === 'chromium' ? 1 : 2),
});
const { installDashboardFixture, activeHomeTokenConnection, selectedSprintId, selectedSprintName } = require('./epm_home_token_fixture');
const { hoverEvidence, evidenceDir, measure, measureDescendantText, contrast } = require('./design_system_hover_helpers');

const baseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

// Every primary case mounts the committed application and uses synthetic API responses.
// Whole application stylesheets preserve every ancestor cascade override. The opt-in
// baseline replay serves the exact Part 1 committed CSS for additional evidence only.
async function installSurface(page, mode = 'catch-up', options = {}) {
    await installDashboardFixture(page, { connection: activeHomeTokenConnection(), allProjectsRollup: options.allProjectsRollup, ...(options.fixtureOptions || {}) });
    if (process.env.JEP_HOVER_CSS_PATH) await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.JEP_HOVER_CSS_PATH, 'utf8') }));
    if (process.env.JEP_HOVER_BASELINE === '1') {
        const css = execFileSync('git', ['show', 'ce5911a96ab00e2284cb0f8c6bd0ede1584e7a69:frontend/dist/dashboard.css'], {
            cwd: path.join(__dirname, '../..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
        });
        await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({ contentType: 'text/css', body: css }));
    }
    await page.addInitScript(({ sprintId, sprintName, mode }) => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
            selectedView: 'eng', selectedSprint: sprintId, sprintName,
            activeGroupId: 'hover-group', selectedTeams: ['all'],
            showPlanning: false, showScenario: mode === 'scenario', showStats: mode === 'stats',
            statsView: 'teams',
        }));
    }, { sprintId: selectedSprintId, sprintName: selectedSprintName, mode });
    await page.route('**/api/groups-config', route => route.fulfill({ json: {
        version: 1, groups: options.groups || [{ id: 'hover-group', name: 'Synthetic Hover Department', teamIds: ['hover-team'], teamLabels: {}, excludedCapacityEpics: [] }],
        defaultGroupId: 'hover-group', source: options.groupSource || 'test', ...(options.groupsPreferences ? {preferences:options.groupsPreferences} : {}),
    } }));
    await page.route('**/api/tasks-with-team-name**', route => route.fulfill({ json: {
        issues: [{ id: 'HOVER-1', key: 'HOVER-1', fields: {
            summary: 'Synthetic hover story', status: { name: 'To Do' }, priority: { name: 'Major' },
            issuetype: { name: 'Story' }, assignee: { displayName: 'Synthetic Owner' },
            customfield_10004: 3, epicKey: 'HOVER-EPIC', parentSummary: 'Synthetic hover epic',
            projectKey: 'PROD', teamId: 'hover-team', teamName: 'Synthetic Hover Team',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        } }],
        epics: { 'HOVER-EPIC': { key: 'HOVER-EPIC', summary: 'Synthetic hover epic', status: { name: 'In Progress' }, teamId: 'hover-team', teamName: 'Synthetic Hover Team' } }, names: {},
    } }));
    await page.route('**/api/stats/burnout', route => route.fulfill({ json: { data: {
        range: { startDate: '2026-04-01', endDate: '2026-04-15' },
        issuesMeta: [{ issueKey: 'HOVER-1', createdDate: '2026-03-20', teamAtStart: { id: 'hover-team', name: 'Synthetic Hover Team' }, teamAtCreated: { id: 'hover-team', name: 'Synthetic Hover Team' }, assignee: { id: 'owner', name: 'Synthetic Owner' } }],
        events: [], assignees: [],
    } } }));
    if (options.beforeNavigate) await options.beforeNavigate(page);
    await page.goto(baseUrl, { waitUntil: options.waitUntil || 'networkidle' });
    await expect(page.locator('.eng-mode-control').first()).toBeVisible();
    await page.addStyleTag({content:'* { animation: none !important; }'});
}

async function surfaceHover(page, control, testInfo, label, options = {}) {
    const evidence = await hoverEvidence(page, control, testInfo, label, options);
    if (process.env.JEP_HOVER_CAPTURE_ONLY !== '1' && !evidence.rest.disabled) {
        expect(evidence.textContrast, `${label} readable resulting fill`).toBeGreaterThanOrEqual(4.5);
    }
    return evidence;
}

test.use({ viewport: { width: 1440, height: 1000 } });

test('EPM and Settings preserve inline fills, disabled footer and ordinary label menu clicks', async ({ page }, testInfo) => {
    await installSurface(page,'catch-up',{allProjectsRollup:project=>({projects:[{project,rollup:{metadataOnly:false,emptyRollup:false,truncated:false,truncatedQueries:[],initiatives:{},rootEpics:{'HOVER-EPIC':{issue:{key:'HOVER-EPIC',summary:'Synthetic rollup epic',status:'In Progress',issueType:'Epic',assignee:'Synthetic Owner'},stories:[{key:'HOVER-STORY',summary:'Synthetic rollup story',status:'To Do',issueType:'Story',priority:'High',storyPoints:3,assignee:'Synthetic Owner',updated:'2026-05-01T00:00:00Z'}]}},orphanStories:[]}}],duplicates:{},truncated:false,fallback:false})});
    await page.getByRole('radio', { name: 'EPM', exact: true }).click();
    await expect(page.getByText('Connected Home Project').first()).toBeVisible();
    await surfaceHover(page,page.locator('.header-icon-button.refresh-icon').first(),testInfo,'epm-shared-header',{foundation:true});
    await surfaceHover(page,page.locator('.view-mode-control .active').first(),testInfo,'epm-selected-view',{pill:true,selected:true,ringPseudo:true});
    await surfaceHover(page, page.getByRole('button', { name: 'Show Jira rollup for Connected Home Project', exact: true }), testInfo, 'epm-collapse', { foundation: true });
    await page.getByRole('button',{name:'Show Jira rollup for Connected Home Project',exact:true}).click();
    const sharedStory=page.locator('.epm-issue-board .task-item').first();
    const sharedEvidence=await hoverEvidence(page,sharedStory,testInfo,'epm-shared-passive-story');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(sharedEvidence.hover.shadow).toBe(sharedEvidence.rest.shadow);
        expect(sharedEvidence.hover.border).toBe(sharedEvidence.rest.border);
    }
    await hoverEvidence(page,page.locator('.epm-issue-board .epic-link').first(),testInfo,'epm-shared-epic-link',{underline:true});
    await hoverEvidence(page,sharedStory.locator('.task-key-link'),testInfo,'epm-shared-story-key');
    const sharedStatus=sharedStory.locator('.status-pill');
    const statusEvidence=await hoverEvidence(page,sharedStatus,testInfo,'epm-shared-passive-status');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(statusEvidence.hover.shadow).toBe(statusEvidence.rest.shadow);

    const settings = page.getByRole('button', { name: /EPM settings/i });
    expect(await settings.evaluate(node => { const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return node.contains(hit); })).toBe(true);
    await surfaceHover(page, settings, testInfo, 'epm-settings-gear', { foundation: true });
    await surfaceHover(page,page.locator('.header-icon-button.refresh-icon').first(),testInfo,'settings-shared-header',{foundation:true});
    await settings.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await surfaceHover(page, dialog.getByRole('button', { name: 'Save', exact: true }), testInfo, 'settings-disabled-save', { disabled: true });
    await dialog.getByRole('tab', { name: 'Projects', exact: true }).click();
    const inlineDelete = dialog.getByRole('button', { name: 'Delete Connected Home Project', exact: true });
    await expect(inlineDelete).toHaveAttribute('style', /background: rgb\(255, 255, 255\)/);
    await surfaceHover(page, inlineDelete, testInfo, 'settings-inline-filled-delete', { foundation: true });
    const add = dialog.getByRole('button', { name: 'Add custom Project', exact: true });
    await surfaceHover(page, add, testInfo, 'settings-secondary-add', { foundation: true });
    await add.click();
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await surfaceHover(page, save, testInfo, 'settings-filled-save', { foundation: true });
    const row = dialog.locator('.epm-project-settings-row').filter({ has: page.getByPlaceholder('Project name') });
    const choose = row.getByRole('button', { name: 'Choose label', exact: true });
    await surfaceHover(page, choose, testInfo, 'settings-inline-label', {});
    await choose.click();
    await expect(page.locator('.epm-label-menu-layer')).toBeVisible();
    await expect(page.locator('.epm-label-menu-layer')).toContainText('rnd_project_connected');
});


for (const width of [1440, 430]) test(`EPM project actions and progress readout preserve geometry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({width, height:1000});
    const projects = ['home-1','home-2'].map((id,index)=>({id,homeProjectId:id,name:index?'Second Synthetic Home Project':'Connected Home Project',displayName:index?'Second Synthetic Home Project':'Connected Home Project',label:index?'rnd_project_second':'rnd_project_connected',stateValue:'ON_TRACK',stateLabel:'On track',tabBucket:'active',homeUrl:`https://home.example/project/${id}`,subGoalKeys:['CHILD-200'],latestUpdateDate:'2026-05-11',latestUpdateSnippet:'Synthetic project update.',latestUpdateAuthor:'Synthetic Owner',latestUpdateUrl:`https://home.example/project/${id}/update`}));
    const rollup={metadataOnly:false,emptyRollup:false,truncated:false,truncatedQueries:[],initiatives:{},rootEpics:{'HOVER-EPIC':{issue:{key:'HOVER-EPIC',summary:'Synthetic rollup epic',status:'In Progress',issueType:'Epic',assignee:'Synthetic Owner'},stories:[{key:'HOVER-STORY',summary:'Synthetic rollup story',status:'In Progress',issueType:'Story',priority:'High',storyPoints:3,assignee:'Synthetic Owner'}]}},orphanStories:[]};
    await installSurface(page,'catch-up',{allProjectsRollup:{projects:projects.map(project=>({project,rollup})),duplicates:{'HOVER-STORY':['home-1','home-2']},truncated:false,fallback:false},beforeNavigate:async page=>{
        await page.route(/\/api\/epm\/projects\?/,route=>route.fulfill({json:{projects}}));
    }});
    await page.getByRole('radio',{name:'EPM',exact:true}).click();
    const board=page.locator('.epm-project-board').first();
    await expect(board).toBeVisible();
    const collapseAll=page.locator('.epm-project-collapse-all-button').filter({visible:true}).first();
    await hoverEvidence(page,collapseAll,testInfo,`epm-collapse-all-${width}`,{foundation:true,minimumContrast:3});
    await collapseAll.click();
    await expect(board).not.toHaveClass(/is-collapsed/);
    await hoverEvidence(page,collapseAll,testInfo,`epm-collapse-all-expanded-${width}`,{foundation:true,minimumContrast:3});
    await collapseAll.click();
    await expect(board).toHaveClass(/is-collapsed/);
    const toggle=board.locator('.epm-project-board-toggle');
    await hoverEvidence(page,toggle,testInfo,`epm-toggle-collapsed-${width}`,{foundation:true});
    await toggle.click();
    await expect(board).not.toHaveClass(/is-collapsed/);
    await hoverEvidence(page,toggle,testInfo,`epm-toggle-expanded-${width}`,{foundation:true});
    await hoverEvidence(page,board.locator('.epm-project-board-name-link'),testInfo,`epm-name-link-${width}`,{underline:true});
    await hoverEvidence(page,board.locator('.epm-project-board-update-meta-link'),testInfo,`epm-update-link-${width}`,{underline:true});
    for(const selector of ['.epm-project-board-label-pill','.epm-project-board-status-pill']) {
        const evidence=await hoverEvidence(page,board.locator(selector),testInfo,`epm-passive-${selector}-${width}`);
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(evidence.hover).toEqual(evidence.rest);
    }
    const progress=board.locator('.epm-project-progress');
    await progress.scrollIntoViewIfNeeded();
    await progress.hover(); await page.waitForTimeout(450);
    const bubble=progress.locator('[role="tooltip"]');
    await expect(bubble).toBeVisible(); await expect(bubble).toContainText('In progress');
    const readout=await measure(bubble), owner=await progress.boundingBox();
    expect(contrast(readout.text,readout.fill)).toBeGreaterThanOrEqual(4.5);
    expect(readout.box[0]).toBeGreaterThanOrEqual(0);
    expect(readout.box[0]+readout.box[2]).toBeLessThanOrEqual(width);
    if(width>640) expect(readout.box[1]+readout.box[3]).toBeLessThan(owner.y);
    else expect(readout.box[1]).toBeGreaterThan(owner.y+owner.height);
    expect(readout.shadow).toBe('rgba(9, 30, 66, 0.14) 0px 8px 18px 0px');
    await page.screenshot({path:`${evidenceDir(testInfo)}/epm-progress-${width}.png`,animations:'disabled'});
    fs.writeFileSync(`${evidenceDir(testInfo)}/epm-progress-${width}.json`,JSON.stringify({readout,owner},null,2));
    const duplicate=page.locator('.epm-duplicates-callout');
    await hoverEvidence(page,duplicate.getByRole('button',{name:'Fix labels in Settings',exact:true}),testInfo,`epm-duplicate-fix-${width}`,{foundation:true});
    await duplicate.locator('summary').click();
    await expect(duplicate.locator('details')).toHaveAttribute('open','');
    await hoverEvidence(page,duplicate.locator('li a'),testInfo,`epm-duplicate-link-${width}`,{underline:true});
    const chip=await hoverEvidence(page,duplicate.locator('.epm-duplicates-project-chip').first(),testInfo,`epm-duplicate-passive-chip-${width}`);
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(chip.hover).toEqual(chip.rest);
    await duplicate.getByRole('button',{name:'Fix labels in Settings',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('Settings footer Cancel removes the actual lift-hover movement', async ({ page }, testInfo) => {
    await installSurface(page);
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog');
    const cancel = dialog.locator('.group-modal-footer .secondary.compact.lift-hover');
    await expect(cancel).toBeVisible();
    await expect(cancel).toHaveText('Cancel');
    await surfaceHover(page, cancel, testInfo, 'settings-lift-hover-cancel', { foundation: true });
    await cancel.click();
    await expect(dialog).toBeHidden();
});

test('Scenario selected and disabled controls preserve fills and text geometry', async ({ page }, testInfo) => {
    await installSurface(page, 'scenario');
    await page.getByRole('radio', { name: 'Scenario', exact: true }).click();
    const panel = page.locator('.scenario-panel');
    await expect(panel).toBeVisible();
    await surfaceHover(page,page.locator('.header-icon-button.refresh-icon').first(),testInfo,'scenario-shared-header',{foundation:true});
    await surfaceHover(page,page.locator('.eng-mode-control .active').first(),testInfo,'scenario-shared-selected',{pill:true,selected:true,ringPseudo:true});
    await surfaceHover(page, panel.getByRole('button', { name: 'Run Scenario', exact: true }), testInfo, 'scenario-secondary-run', { foundation: true });
    await surfaceHover(page, panel.getByRole('button', { name: 'Team', exact: true }), testInfo, 'scenario-selected-team', { pill: true, selected: true });
    await surfaceHover(page, panel.getByRole('button', { name: 'Epic', exact: true }), testInfo, 'scenario-transparent-epic', { foundation: true });
    await surfaceHover(page, panel.getByRole('button', { name: 'Edit', exact: true }), testInfo, 'scenario-disabled-edit', { disabled: true });
    await panel.getByRole('button', { name: 'Epic', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Epic', exact: true })).toHaveClass(/active/);
});

test('Statistics graph cards preserve selected elevation and actual descendant readability', async ({ page }, testInfo) => {
    await installSurface(page, 'stats');
    await page.getByRole('radio', { name: 'Statistics', exact: true }).click();
    const panel = page.locator('.stats-panel.open');
    const selected = panel.locator('.stats-card.selectable.active');
    const ordinary = panel.locator('.stats-card.selectable:not(.active)');
    await surfaceHover(page, selected, testInfo, 'stats-selected-graph-card', {pill:true, selected:true, ringPseudo:true, readableDescendants:true});
    await surfaceHover(page, ordinary, testInfo, 'stats-ordinary-graph-card', {foundation:true, readableDescendants:true});
    const nextHeading = await ordinary.locator('h4').textContent();
    await ordinary.click();
    await expect(panel.locator('.stats-card.selectable.active h4')).toHaveText(nextHeading);
    const passive = panel.locator('.stats-summary > .stats-card:not(.selectable)').first();
    const passiveEvidence = await hoverEvidence(page, passive, testInfo, 'stats-passive-card', {readableDescendants:true});
    expect(passiveEvidence.hover).toEqual(passiveEvidence.rest);
    await page.screenshot({path: path.join(evidenceDir(testInfo),'stats-graph-cards.png'), animations:'disabled'});
    const arrow=panel.locator('.stats-view.open .stats-link').first();
    await expect(arrow).toHaveText('↗');
    const arrowEvidence=await hoverEvidence(page,arrow,testInfo,'stats-team-arrow',{icon:true});
    expect(arrowEvidence.textContrast).toBeGreaterThanOrEqual(3); // Actual arrow glyph, without readable words.
    expect(arrowEvidence.hover.color).toBe('rgb(212, 56, 13)');
    const capacity=page.locator('.epic-stat-toggle.active').first();
    await hoverEvidence(page,capacity,testInfo,'stats-under-list-capacity',{pill:true,selected:true});
});

test('Statistics cohort pills, range menus and native selectors retain real controls', async ({ page }, testInfo) => {
    await installSurface(page, 'stats');
    await page.getByRole('radio', { name: 'Statistics', exact: true }).click();
    const panel = page.locator('.stats-panel.open');
    await panel.locator('.stats-view-toggle').getByRole('radio', {name:'Lead Times', exact:true}).click();
    const view = panel.locator('.stats-view.open');
    const selected = view.locator('.cohort-status-actions .stats-toggle.active').first();
    await surfaceHover(page, selected, testInfo, 'stats-cohort-selected', {pill:true,selected:true});
    await selected.click();
    await surfaceHover(page, view.locator('.cohort-status-actions .stats-toggle:not(.active)').first(), testInfo, 'stats-cohort-ordinary', {foundation:true});
    const start = view.getByRole('button',{name:'Start quarter',exact:true});
    await surfaceHover(page,start,testInfo,'stats-quarter-range',{foundation:true});
    await start.click();
    const ordinaryOption = view.locator('.sprint-dropdown-option:not(.selected)').first();
    await ordinaryOption.hover(); await page.mouse.move(1,1);
    await page.waitForTimeout(800); // Settle the existing menu/list scroll before the before/after measurement.
    await surfaceHover(page,ordinaryOption,testInfo,'stats-quarter-menu',{rowTint:true,unchangedFill:false});
    await ordinaryOption.click();
    await expect(start).toHaveAttribute('aria-expanded','false');
    await surfaceHover(page,view.getByRole('combobox',{name:'Project',exact:true}),testInfo,'stats-cohort-native-select',{});
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-cohort-controls.png'),animations:'disabled'});
});

test('Statistics chart controls and real Burndown readout stay readable and contained', async ({ page }, testInfo) => {
    await installSurface(page, 'stats');
    await page.getByRole('radio', { name: 'Statistics', exact: true }).click();
    const panel = page.locator('.stats-panel.open');
    const tabs = panel.locator('.stats-view-toggle');
    await expect(panel).toBeVisible();
    await surfaceHover(page,page.locator('.header-icon-button.refresh-icon').first(),testInfo,'stats-shared-header',{foundation:true});
    await surfaceHover(page,page.locator('.view-selector .eng-mode-control .active').first(),testInfo,'stats-shared-selected',{pill:true,selected:true,ringPseudo:true});
    await surfaceHover(page, tabs.getByRole('radio', { name: 'Teams', exact: true }), testInfo, 'stats-selected-teams', {});
    await surfaceHover(page, tabs.getByRole('radio', { name: 'Burndown', exact: true }), testInfo, 'stats-light-burndown', { unchangedFill: false });
    await tabs.getByRole('radio', { name: 'Burndown', exact: true }).click();
    const capture = page.locator('.stats-view.open .burnout-hover-capture');
    await expect(capture).toBeVisible();
    const box = await capture.boundingBox();
    const pointer = { x: box.x + box.width - 8, y: box.y + box.height / 2 };
    await page.mouse.move(pointer.x, pointer.y);
    const bubble = page.locator('.stats-view.open .burnout-hover-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText('Total:');
    const readout = await measure(bubble);
    expect(contrast(readout.text, readout.fill)).toBeGreaterThanOrEqual(4.5);
    const bubbleBox = await bubble.boundingBox();
    const chartBox = await page.locator('.stats-view.open .burnout-chart').boundingBox();
    expect(bubbleBox.x).toBeGreaterThanOrEqual(chartBox.x - 1);
    expect(bubbleBox.x + bubbleBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width + 1);
    expect(Math.abs(bubbleBox.x - pointer.x)).toBeLessThan(360);
    await page.screenshot({ path: `${evidenceDir(testInfo)}/stats-burndown-readout.png` });
    await surfaceHover(page, panel.locator('.burnout-legend span').first(), testInfo, 'stats-chart-legend', {});
    await capture.click({ position: { x: box.width - 8, y: box.height / 2 } });
    const clear = panel.getByRole('button', { name: 'Clear', exact: true });
    await expect(clear).toBeVisible();
    await surfaceHover(page, clear, testInfo, 'stats-chart-clear', { foundation: true });
    await clear.click();
    await expect(clear).toBeHidden();
});


test('Statistics actual Effort Split and Project Track readouts preserve chart grammar',async({page},testInfo)=>{
    testInfo.setTimeout(60000);
    const issues=['Flexible','Committed'].map((track,index)=>({id:`CHART-${index}`,key:`CHART-${index}`,fields:{summary:'Synthetic chart story',status:{name:'To Do'},issuetype:{name:'Story'},assignee:{displayName:'Synthetic Owner'},customfield_10004:index+3,epicKey:`CHART-EPIC-${index}`,epicSummary:'Synthetic chart epic',epicStatus:'In Progress',epicProjectTrack:track,epicAssignee:{displayName:'Synthetic Owner'},projectKey:'PROD',teamId:'hover-team',teamName:'Synthetic Hover Team',customfield_10101:[{id:selectedSprintId,name:selectedSprintName}]}}));
    issues.push({...issues[1],id:'CHART-EARLIER',key:'CHART-EARLIER',fields:{...issues[1].fields,epicKey:'CHART-EPIC-EARLIER',customfield_10101:[{id:34624,name:'2026Q2 Sprint 41'}]}});
    await installSurface(page,'stats',{groups:[{id:'hover-group',name:'Synthetic Hover Department',teamIds:['hover-team'],teamLabels:{},excludedCapacityEpics:['CHART-EPIC-0']}],beforeNavigate:async page=>{
        await page.route('**/api/sprints',route=>route.fulfill({json:{sprints:[{id:34624,name:'2026Q2 Sprint 41',state:'closed'},{id:selectedSprintId,name:selectedSprintName,state:'active'}]}}));
        await page.route('**/api/stats/project-track-phase-durations',route=>route.fulfill({json:{epics:(route.request().postDataJSON().epicKeys||[]).map(key=>({key,summary:'Synthetic phase epic',currentValue:'Committed',durations:{'No track':2,Committed:3}})),meta:{warnings:[]}}}));
        await page.route('**/api/stats/excluded-capacity-source',route=>route.fulfill({json:{data:{issues,meta:{warnings:[],loadedSprintCount:1,totalSprintCount:1}}}}));
    }});
    await page.getByRole('radio',{name:'Statistics',exact:true}).click();
    const panel=page.locator('.stats-panel.open');
    await panel.locator('.stats-view-toggle').getByRole('radio',{name:'Excluded Capacity',exact:true}).click();
    const segment=panel.locator('.stats-view.open .effort-type-split-segment').first();
    await expect(segment).toBeVisible();
    await segment.scrollIntoViewIfNeeded(); await page.waitForTimeout(450); // Settle entrance and scroll before recording chart geometry.
    await page.mouse.move(1,1); const rest=await measure(segment);
    await segment.hover(); await page.waitForTimeout(250);
    const hovered=await measure(segment);
    expect(hovered.box).toEqual(rest.box); expect(hovered.ranges).toEqual(rest.ranges);
    expect(hovered.background).toBe(rest.background); expect(hovered.shadow).toBe('none');
    const effortReadout=page.locator('.effort-type-split-readout');
    await expect(effortReadout).toBeVisible();
    for(const sample of await measureDescendantText(effortReadout)) expect(sample.contrast).toBeGreaterThanOrEqual(4.5);
    const pointerBox=await segment.boundingBox(); const bubble=await effortReadout.boundingBox();
    expect(bubble.x).toBeGreaterThanOrEqual(0); expect(bubble.x+bubble.width).toBeLessThanOrEqual(1440);
    expect(Math.abs(bubble.y-(pointerBox.y+pointerBox.height/2))).toBeLessThan(120);
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-effort-readout.png'),animations:'disabled'});
    const legend=panel.locator('.stats-view.open .effort-type-split-legend-item.product');
    await legend.click(); await expect(legend).toHaveAttribute('aria-pressed','false');
    await expect(legend).toHaveClass(/dimmed/);
    await legend.click(); await expect(legend).toHaveAttribute('aria-pressed','true');
    const lineLegend=panel.locator('.stats-view.open .excluded-capacity-line-legend-item').first();
    await expect(lineLegend).toBeVisible();
    const lineLegendEvidence=await hoverEvidence(page,lineLegend,testInfo,'stats-excluded-chart-legend',{unchangedFill:false});
    expect(lineLegendEvidence.hover.shadow).toBe('rgba(31, 111, 235, 0.08) 0px 0px 0px 3px');
    expect(lineLegendEvidence.hover.background).toBe('rgba(31, 111, 235, 0.06)');
    expect(lineLegendEvidence.hover.color).toBe('rgb(26, 26, 26)');
    await lineLegend.click(); await expect(lineLegend).toHaveClass(/is-isolated/);
    await hoverEvidence(page,lineLegend,testInfo,'stats-excluded-isolated-legend',{unchangedFill:false});
    const reset=panel.locator('.stats-view.open .excluded-capacity-line-legend-reset');
    await hoverEvidence(page,reset,testInfo,'stats-excluded-show-all',{underline:true});
    await reset.click(); await expect(reset).toHaveCount(0); await expect(lineLegend).not.toHaveClass(/is-isolated/);
    const lineCapture=panel.locator('.stats-view.open .excluded-capacity-line-hover-capture');
    await lineCapture.scrollIntoViewIfNeeded(); const lineBox=await lineCapture.boundingBox();
    await page.mouse.move(lineBox.x+lineBox.width-5,lineBox.y+lineBox.height/2);
    const lineBubble=page.locator('.excluded-capacity-line-hover-bubble');
    await expect(lineBubble).toBeVisible();
    // The retained muted detail row is an opacity group; inspect its exact
    // existing palette separately, rather than approximating it as opaque ink.
    for(const owner of ['.burnout-hover-title','.burnout-hover-row:not(.muted)']) {
        for(const sample of await measureDescendantText(lineBubble.locator(owner))) expect(sample.contrast).toBeGreaterThanOrEqual(4.5);
    }
    const muted=lineBubble.locator('.burnout-hover-row.muted');
    expect(await muted.evaluate(node=>({opacity:getComputedStyle(node).opacity,color:getComputedStyle(node).color}))).toEqual({opacity:'0.7',color:'rgb(102, 102, 102)'});
    const lineBubbleBox=await lineBubble.boundingBox(); const panelBox=await panel.boundingBox();
    expect(lineBubbleBox.x).toBeGreaterThanOrEqual(panelBox.x); expect(lineBubbleBox.x+lineBubbleBox.width).toBeLessThanOrEqual(panelBox.x+panelBox.width);
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-excluded-line-readout.png'),animations:'disabled'});
    await panel.locator('.stats-view-toggle').getByRole('radio',{name:'Project Track',exact:true}).click();
    const trackSegment=panel.locator('.stats-view.open .stacked-bar-segment').first();
    await expect(trackSegment).toBeVisible();
    await page.waitForTimeout(450); // Settle the existing stats-view entrance transform.
    await page.mouse.move(1,1); const trackRest=await measure(trackSegment);
    await trackSegment.hover(); await page.waitForTimeout(250); const trackHover=await measure(trackSegment);
    expect(trackHover.box).toEqual(trackRest.box); expect(trackHover.ranges).toEqual(trackRest.ranges);
    expect(trackHover.background).toBe(trackRest.background);
    expect(trackHover.shadow).toContain('999px'); expect(trackHover.shadow).toContain('0.08');
    const trackReadout=page.locator('.stacked-bar-readout');
    await expect(trackReadout).toBeVisible();
    for(const sample of await measureDescendantText(trackReadout)) expect(sample.contrast).toBeGreaterThanOrEqual(4.5);
    const trackBox=await trackReadout.boundingBox();
    expect(trackBox.x).toBeGreaterThanOrEqual(0); expect(trackBox.x+trackBox.width).toBeLessThanOrEqual(1440);
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-project-track-readout.png'),animations:'disabled'});
    const phaseLink=panel.locator('.stats-view.open a.project-track-phase-epic-link').first();
    await hoverEvidence(page,phaseLink,testInfo,'stats-project-track-phase-link',{underline:true});
    await expect(page.locator('.stacked-bar-readout')).toContainText('Synthetic phase epic');
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-project-track-phase-readout.png'),animations:'disabled'});
    await panel.locator('.stats-view.open').getByRole('radio',{name:'Team',exact:true}).click();
    await page.waitForTimeout(450);
    const strip=panel.locator('.stats-view.open .stacked-bar-strip').first();
    const stripEvidence=await hoverEvidence(page,strip,testInfo,'stats-project-track-strip');
    expect(stripEvidence.hover.shadow).toBe('rgba(26, 26, 26, 0.18) 0px 2px 6px 0px');
    expect(stripEvidence.hover.box).toEqual(stripEvidence.rest.box);
    await expect(page.locator('.stacked-bar-readout')).toBeVisible();
    const start=panel.locator('.stats-view.open').getByRole('button',{name:'Start sprint',exact:true});
    await start.click(); await panel.locator('.stats-view.open').getByRole('option',{name:'2026Q2 Sprint 41',exact:true}).click();
    const sprintLegend=panel.locator('.stats-view.open .project-track-sprint-legend-item').first();
    await expect(sprintLegend).toBeVisible(); await page.waitForTimeout(450);
    await hoverEvidence(page,sprintLegend,testInfo,'stats-project-track-sprint-legend',{foundation:true});
    const sprintSegment=panel.locator('.stats-view.open .project-track-sprint-segment').last();
    await sprintSegment.scrollIntoViewIfNeeded(); await sprintSegment.hover();
    const sprintBubble=page.locator('.project-track-sprint-hover-bubble');
    await expect(sprintBubble).toBeVisible();
    const sprintBubbleBox=await sprintBubble.boundingBox();
    expect(sprintBubbleBox.x).toBeGreaterThanOrEqual(0); expect(sprintBubbleBox.x+sprintBubbleBox.width).toBeLessThanOrEqual(1440);
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-project-track-sprint-readout.png'),animations:'disabled'});
});

test('Statistics actual cohort row Clear and issue links retain underline and readouts',async({page},testInfo)=>{
    await installSurface(page,'stats',{beforeNavigate:async page=>{
        await page.route('**/api/stats/epic-cohort',route=>route.fulfill({json:{data:{range:{startDate:'2026-01-01',endDate:'2026-12-31'},issues:Array.from({length:31},(_,index)=>({key:`COHORT-${index+1}`,summary:'Synthetic cohort epic',projectKey:'PROD',status:'open',jiraStatus:'In Progress',createdDate:'2026-10-01',terminalDate:null,leadTimeDays:null,assignee:{id:'synthetic-owner',name:'Synthetic Owner'}})),meta:{warnings:[]}}}}));
    }});
    await page.getByRole('radio',{name:'Statistics',exact:true}).click();
    const panel=page.locator('.stats-panel.open');
    await panel.locator('.stats-view-toggle').getByRole('radio',{name:'Lead Times',exact:true}).click();
    const view=panel.locator('.stats-view.open');
    await expect(view.locator('.cohort-open-link').first()).toBeVisible();
    await hoverEvidence(page,view.locator('.stats-card-link'),testInfo,'stats-cohort-workflow-status-link',{underline:true});
    const jira=view.locator('.cohort-open-jira-button').first();
    await hoverEvidence(page,jira,testInfo,'stats-cohort-jira-button',{foundation:true});
    const more=view.locator('.cohort-open-more').first();
    await hoverEvidence(page,more,testInfo,'stats-cohort-load-more',{foundation:true});
    await expect(view.locator('.cohort-open-link')).toHaveCount(30);
    await more.click(); await expect(view.locator('.cohort-open-link')).toHaveCount(31);
    await expect(more).toHaveCount(0);
    await view.locator('.cohort-open-link').first().scrollIntoViewIfNeeded(); await page.waitForTimeout(450);
    const link=view.locator('.cohort-open-link').first();
    await hoverEvidence(page,link.locator('.cohort-open-key'),testInfo,'stats-cohort-issue-key',{underline:true});
    await hoverEvidence(page,link.locator('.cohort-open-summary'),testInfo,'stats-cohort-issue-summary',{underline:true});
    const cell=view.locator('.cohort-row-title').first();
    await cell.click(); await expect(view.locator('.cohort-selected-chip')).toBeVisible();
    await hoverEvidence(page,view.getByRole('button',{name:'Clear',exact:true}),testInfo,'stats-cohort-row-clear',{underline:true});
    await view.getByRole('button',{name:'Clear',exact:true}).click();
    await expect(view.locator('.cohort-selected-chip')).toHaveCount(0);
    await page.screenshot({path:path.join(evidenceDir(testInfo),'stats-cohort-links.png'),animations:'disabled'});
});

test('touch Settings and Scenario actions remain reachable without hover', async ({ browser, browserName }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, ...(browserName === 'firefox' ? {} : { isMobile: true }) });
    const page = await context.newPage();
    try {
        await installSurface(page, 'scenario');
        expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
        await page.getByRole('radio', { name: 'Scenario', exact: true }).tap();
        const panel = page.locator('.scenario-panel');
        const epic = panel.getByRole('button', { name: 'Epic', exact: true });
        await epic.tap();
        await expect(epic).toHaveClass(/active/);
        await surfaceHover(page, panel.getByRole('button', { name: 'Run Scenario', exact: true }), testInfo, 'touch-scenario-run', { unchangedFill: true });
        await page.getByRole('button', { name: /manage team groups/i }).tap();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'EPM', exact: true }).tap();
        await expect(page.getByRole('tab', { name: 'Projects', exact: true })).toBeVisible();
    } finally { await context.close(); }
});


function holdResponse() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

test('disabled Settings Group labels tab retains resting muted text with no groups', async ({ page }, testInfo) => {
    await installSurface(page, 'catch-up', { groups: [] });
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    const labels = dialog.getByRole('tab', { name: 'Group labels', exact: true });
    await expect(labels).toBeDisabled();
    await surfaceHover(page, labels, testInfo, 'settings-disabled-group-labels', { disabled: true });
});

test('disabled Settings Add column retains its border and text at the twelve-column limit', async ({ page }, testInfo) => {
    const columns = Array.from({ length: 12 }, (_, index) => ({
        id: `col-${index.toString(16).padStart(8, '0')}`, name: `Synthetic column ${index + 1}`,
        colour: '#8c8c8c', star: false, min: null, max: null, statuses: [`Synthetic status ${index + 1}`],
    }));
    await installSurface(page, 'catch-up', { groups: [{
        id: 'hover-group', name: 'Synthetic Hover Department', teamIds: ['hover-team'],
        teamLabels: {}, excludedCapacityEpics: [], board: { columns },
    }] });
    await page.getByRole('button', { name: /manage team groups/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Boards', exact: true }).click();
    const add = dialog.getByRole('button', { name: '+ Add column', exact: true });
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute('title', 'A board can have at most 12 columns.');
    await surfaceHover(page, add, testInfo, 'settings-disabled-add-column', { disabled: true });
});

test('disabled connected Home Revoke retains its danger border during the real pending delete', async ({ page }, testInfo) => {
    await installSurface(page);
    const held = holdResponse();
    await page.route('**/api/me/connections/home-token', async route => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        await held.promise;
        return route.fulfill({ json: { connected: false } });
    });
    try {
        await page.getByRole('button', { name: /manage team groups/i }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Connections', exact: true }).click();
        const revoke = dialog.getByRole('button', { name: 'Revoke', exact: true });
        await expect(revoke).toBeEnabled();
        await revoke.click();
        await expect(revoke).toBeDisabled();
        await surfaceHover(page, revoke, testInfo, 'settings-disabled-revoke', { disabled: true });
        held.release();
        await expect(revoke).toBeHidden();
    } finally { held.release(); }
});

test('disabled inactive Scenario History retains its resting fill while actual drafts load', async ({ page }, testInfo) => {
    await installSurface(page, 'scenario');
    const held = holdResponse();
    await page.route('**/api/scenario', route => route.fulfill({ json: {
        jira_base_url: 'https://jira.example', config: { start_date: '2026-04-01', quarter_end_date: '2026-06-30' },
        sprintBoundaries: { selected: { startDate: '2026-04-01', endDate: '2026-04-15' } },
        issues: [], dependencies: [], capacity_by_team: {}, summary: { late_items: [], critical_path: [], unschedulable: [], bottleneck_lanes: [] },
    } }));
    await page.route('**/api/scenario/drafts**', async route => {
        await held.promise;
        return route.fulfill({ json: { activeDraft: null, versions: [] } });
    });
    try {
        await page.getByRole('radio', { name: 'Scenario', exact: true }).click();
        await page.locator('.scenario-panel').getByRole('button', { name: 'Run Scenario', exact: true }).click();
        const history = page.locator('.scenario-panel').getByRole('button', { name: 'History', exact: true });
        await expect(history).toBeDisabled();
        await surfaceHover(page, history, testInfo, 'scenario-disabled-history', { disabled: true });
        held.release();
        await expect(history).toBeEnabled();
        await history.click();
        await expect(page.getByRole('dialog', { name: 'Scenario draft history' })).toBeVisible();
    } finally { held.release(); }
});

test('disabled shared header Refresh and Manage keep resting styles during real startup loading', async ({ page }, testInfo) => {
    const held = holdResponse();
    try {
        await installSurface(page, 'catch-up', {
            waitUntil: 'domcontentloaded',
            beforeNavigate: async () => {
                await page.route('**/api/groups-config', async route => {
                    await held.promise;
                    return route.fulfill({ json: { version: 1, groups: [], defaultGroupId: '', source: 'test' } });
                });
                await page.route('**/api/tasks-with-team-name**', async route => {
                    await held.promise;
                    return route.fulfill({ json: { issues: [], epics: {}, epicsInScope: [], names: {} } });
                });
            },
        });
        await page.waitForTimeout(1000); // Let the real shell entrance animation settle while API responses stay held.
        const refresh = page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true });
        const manage = page.getByRole('button', { name: 'Manage team groups', exact: true });
        await expect(refresh).toBeDisabled();
        await expect(manage).toBeDisabled();
        await surfaceHover(page, refresh, testInfo, 'header-disabled-refresh', { disabled: true });
        await surfaceHover(page, manage, testInfo, 'header-disabled-manage', { disabled: true });
        held.release();
        await expect(manage).toBeEnabled();
    } finally { held.release(); }
});

// Settings ownership campaign: real mounted tabs/composer, synthetic scoped data.
test('Settings mounted action kinds preserve selected, passive and Board controls', async ({ page, browserName }, testInfo) => {
    test.setTimeout(60000); // Each action captures settled rest, hover and ring pixels.
    const reference = await import('../fixtures/groupBoardReference.mjs');
    const groups = [{ id:'hover-group', name:'Synthetic Hover Department', teamIds:['hover-team'], teamLabels:{}, board:reference.referenceBoard() },
        { id:'second-group', name:'Second Synthetic Department', teamIds:['second-team'], teamLabels:{} }];
    await installSurface(page,'catch-up',{groups,beforeNavigate:async page=>{
        await page.route('**/api/board-config/statuses',route=>route.fulfill({json:reference.referenceStatusesResponse()}));
    }});
    await page.getByRole('button',{name:'Manage team groups',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Departments',exact:true}).click();
    await hoverEvidence(page,dialog.locator('.group-modal-tab.active').first(),testInfo,'settings-selected-tab',{tab:true,selectedTab:true});
    await hoverEvidence(page,dialog.getByRole('tab',{name:'Boards',exact:true}),testInfo,'settings-inactive-tab',{tab:true});
    const passive=dialog.locator('div.group-list-item').first();
    const passiveEvidence=await hoverEvidence(page,passive,testInfo,'settings-passive-group-wrapper');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(passiveEvidence.hover).toEqual(passiveEvidence.rest);
    await hoverEvidence(page,dialog.locator('.group-list-select').first(),testInfo,'settings-group-inline-select',{underline:true});
    await hoverEvidence(page,dialog.locator('button.group-list-star[aria-pressed="false"]').first(),testInfo,'settings-group-star',{icon:true});
    await hoverEvidence(page,dialog.locator('button.group-list-star[aria-pressed="true"]').first(),testInfo,'settings-selected-group-star',{pill:true,selected:true,iconOnly:true});
    await dialog.getByRole('tab',{name:'Group labels',exact:true}).click();
    await hoverEvidence(page,dialog.locator('button.group-list-item:not(.active)').first(),testInfo,'settings-labels-inactive-group',{foundation:true,readableDescendants:true});
    await dialog.getByRole('tab',{name:'Boards',exact:true}).click();
    const first=dialog.locator('.board-column').first();
    await hoverEvidence(page,dialog.locator('button.group-list-item.active').first(),testInfo,'settings-board-selected-group',{pill:true,selected:true,readableDescendants:true});
    await hoverEvidence(page,dialog.locator('button.group-list-item:not(.active)').first(),testInfo,'settings-board-inactive-group',{foundation:true,readableDescendants:true});
    for(const [selector,label] of [['.board-column-drag','drag'],['.board-column-star','star'],['.board-column-top .remove-btn','delete'],['.component-chip .remove-btn','status-remove'],['.chip-grip','grip']]) {
        const icon=await hoverEvidence(page,first.locator(selector).first(),testInfo,`settings-board-${label}`,{icon:true});
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1' && ['drag','grip'].includes(label)) {
            expect(icon.hover.color).toBe('rgb(212, 56, 13)');
            expect(icon.textContrast).toBeGreaterThanOrEqual(3);
        }
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1' && label==='star') {
            // Existing semantic gold glyph contrast debt: preserve its exact old hover ink.
            expect(icon.rest.color).toBe('rgb(191, 191, 191)');
            expect(icon.hover.color).toBe('rgb(232, 179, 57)');
        }
    }
    const boardStar=first.locator('.board-column-star');
    await boardStar.click();
    await expect(boardStar).toHaveAttribute('aria-pressed','true');
    await hoverEvidence(page,boardStar,testInfo,'settings-selected-board-star',{pill:true,selected:true,iconOnly:true});
    await boardStar.click();
    const swatch=first.locator('.board-column-colour').first();
    await hoverEvidence(page,swatch,testInfo,'settings-board-swatch',{pill:true,iconOnly:true,selected:true});
    await swatch.click();
    const grid=first.getByRole('radiogroup');
    await hoverEvidence(page,grid.locator('[aria-checked="true"]'),testInfo,'settings-selected-swatch',{pill:true,selected:true,iconOnly:true,ringPseudo:true});
    await hoverEvidence(page,grid.locator('[aria-checked="false"]').first(),testInfo,'settings-option-swatch',{pill:true,selected:true,iconOnly:true});
    await first.locator('.board-column-name').click();
    await first.locator('.board-column-name').hover();
    await expect(first.locator('.board-column-name')).toBeFocused();
    await expect(first.locator('.board-column-name')).toHaveCSS('border-color','rgb(212, 56, 13)');
    await expect(first.locator('.board-add-status')).toHaveAttribute('aria-expanded','false');
    await hoverEvidence(page,first.locator('.board-add-status'),testInfo,'settings-closed-status-trigger',{foundation:true});
    await first.locator('.board-add-status').click();
    await hoverEvidence(page,first.locator('.board-add-status'),testInfo,'settings-expanded-status-trigger',{pill:true,selected:true,semanticHover:{color:'rgb(212, 56, 13)',background:'rgba(0, 0, 0, 0)'}});
    const option=first.locator('.board-pick button.component-chip').filter({hasText:'Pending'});
    await hoverEvidence(page,option,testInfo,'settings-board-status-option',{pill:true,clipped:true});
    await option.click();
    const add=dialog.getByRole('button',{name:'+ Add column',exact:true});
    await hoverEvidence(page,add,testInfo,'settings-board-add-column',{foundation:true});
    await expect(dialog.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
    await hoverEvidence(page,dialog.getByRole('button',{name:'Save',exact:true}),testInfo,'settings-board-dirty-save',{foundation:true});
    await page.screenshot({path:`${evidenceDir(testInfo)}/settings-board-surface.png`,animations:'disabled'});
    await dialog.locator('button.group-list-item.active').focus();
    // Safari uses Option+Tab to include native buttons in its default macOS tab order.
    await page.keyboard.press(browserName==='webkit' ? 'Alt+Tab' : 'Tab');
    const focusedGroup=dialog.locator('button.group-list-item:not(.active)').first();
    await expect(focusedGroup).toBeFocused();
    await expect(focusedGroup).toHaveCSS('background-color','rgb(247, 245, 240)');
    await expect(focusedGroup).toHaveCSS('color','rgb(26, 26, 26)');
    await expect(focusedGroup).toHaveCSS('outline-style','solid');
    await expect(focusedGroup).toHaveCSS('outline-width','2px');
    await expect(focusedGroup).toHaveCSS('outline-offset','2px');

});

test('Settings Admin project semantic chips and passive result rows retain their exact palette', async ({page},testInfo)=>{
    await installSurface(page,'catch-up',{beforeNavigate:async page=>{
        await page.route('**/api/projects**',route=>route.fulfill({json:{projects:[{key:'SYNTH',name:'Synthetic project'}]}}));
    }});
    await page.getByRole('button',{name:'Manage team groups',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Admin',exact:true}).click();
    await dialog.getByRole('tab',{name:'Scope projects',exact:true}).click();
    await dialog.getByPlaceholder('Search projects to add...').fill('Synthetic');
    await expect(dialog.locator('.project-type-btn.product')).toBeVisible();
    const row=dialog.locator('.team-search-result-item:has(.project-result-actions)').first();
    const evidence=await hoverEvidence(page,row,testInfo,'settings-passive-project-result');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(evidence.hover).toEqual(evidence.rest);
    for(const [kind,color,background] of [['product','rgb(22, 119, 255)','rgba(22, 119, 255, 0.12)'],['tech','rgb(250, 84, 28)','rgba(250, 84, 28, 0.1)']]) {
        await hoverEvidence(page,dialog.locator(`.project-type-btn.${kind}`),testInfo,`settings-semantic-${kind}`,{pill:true,unchangedFill:false,semanticHover:{color,background}});
    }
    await dialog.locator('.project-type-btn.product').click();
    await expect(dialog.locator('.selected-team-chip.product-chip')).toContainText('SYNTH');
    await hoverEvidence(page,dialog.locator('.selected-team-chip.product-chip .remove-btn'),testInfo,'settings-admin-project-remove',{icon:true});
});

test('Settings first-run eligible labels, disabled wrappers and saving actions keep their actual eligibility',async({page},testInfo)=>{
    const groups=[{id:'hover-group',name:'Synthetic Hover Department',teamIds:['hover-team']},{id:'second-group',name:'Second Synthetic Department',teamIds:['second-team']},{id:'empty',name:'Empty Synthetic Department',teamIds:[]}];
    const preferences={customized:false,preferenceExists:false,onboardingRequired:true,onboardingDone:true,completedOnboardingModules:['catch-up','configuration','planning','board','statistics'],visibleGroupIds:[],activeGroupId:null,effectiveVisibleGroupIds:[]};
    const held=holdResponse();
    await installSurface(page,'catch-up',{groups,groupsPreferences:preferences,groupSource:'workspace_db',beforeNavigate:async page=>{
        await page.route('**/api/groups-preferences',async route=>{await held.promise;return route.fulfill({status:500,json:{error:'preference_save_failed',message:'Synthetic retry'}});});
    }});
    try {
        const picker=page.getByRole('dialog',{name:'Choose your Department'});
        const label=picker.locator('.department-first-run-option-main.eligible').first();
        await hoverEvidence(page,label,testInfo,'settings-first-run-eligible-label',{rowTint:true,unchangedFill:false,readableDescendants:true});
        const empty=picker.locator('.department-first-run-option.disabled');
        const passive=await hoverEvidence(page,empty,testInfo,'settings-first-run-disabled-wrapper');
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(passive.hover).toEqual(passive.rest);
        await label.click();
        const selected=picker.locator('.department-first-run-option.selected');
        const retained=await hoverEvidence(page,selected,testInfo,'settings-first-run-selected-wrapper');
        if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') expect(retained.hover).toEqual(retained.rest);
        const continueButton=picker.getByRole('button',{name:'Continue',exact:true});
        await hoverEvidence(page,continueButton,testInfo,'settings-first-run-continue',{foundation:true});
        await continueButton.click();
        await hoverEvidence(page,picker.getByRole('button',{name:'Saving...',exact:true}),testInfo,'settings-first-run-saving',{disabled:true});
        held.release();
        await expect(picker.getByRole('alert')).toHaveText('Synthetic retry');
    } finally {held.release();}
});

test('Settings actual onboarding actions retain readable approved red hover and pending behavior',async({page},testInfo)=>{
    const pendingGate=holdResponse();const onboardingWrites=[];
    const groups=[{id:'hover-group',name:'Synthetic Hover Department',teamIds:['hover-team']}];
    const preferences={customized:false,preferenceExists:false,onboardingRequired:true,onboardingDone:false,completedOnboardingModules:[],visibleGroupIds:[],activeGroupId:null,effectiveVisibleGroupIds:[]};
    const saved={...preferences,customized:true,preferenceExists:true,onboardingRequired:false,visibleGroupIds:['hover-group'],activeGroupId:'hover-group',effectiveVisibleGroupIds:['hover-group']};
    await installSurface(page,'catch-up',{groups,groupsPreferences:preferences,groupSource:'workspace_db',beforeNavigate:async page=>{
        await page.route('**/api/groups-preferences',route=>route.fulfill({json:{preferences:saved,groupsConfigSnapshot:{version:1,groups,defaultGroupId:'hover-group',source:'workspace_db',configRevision:2,preferences:saved}}}));
        await page.route('**/api/me/onboarding',async route=>{
            if(route.request().method()==='POST') {
                onboardingWrites.push(route.request().postDataJSON());
                await pendingGate.promise;
            }
            return route.fulfill({json:{completedOnboardingModules:['catch-up'],onboardingDone:false}});
        });
    }});
    const picker=page.getByRole('dialog',{name:'Choose your Department'});
    await picker.getByRole('radio').first().check();
    await picker.getByRole('button',{name:'Continue',exact:true}).click();
    const tour=page.locator('.onboarding-tour-card');
    await expect(tour).toBeVisible();
    const skip=tour.locator('.onboarding-tour-action-skip-all');
    const red=await hoverEvidence(page,skip,testInfo,'settings-tour-skip-all-current',{pill:true,unchangedFill:false});
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(red.rest.background).toBe('rgb(255, 77, 79)');
        expect(red.rest.color).toBe('rgb(255, 255, 255)');
        expect(red.hover.background).toBe('rgb(217, 54, 62)');
        expect(red.hover.border).toBe('rgb(217, 54, 62)');
        expect(red.hover.color).toBe('rgb(255, 255, 255)');
        expect(red.hover.shadow).not.toContain('999px');
        expect(red.textContrast).toBeGreaterThanOrEqual(4.5);
    }
    for(const [selector,label] of [['.onboarding-tour-action-next','next']]) {
        await hoverEvidence(page,tour.locator(selector),testInfo,`settings-tour-${label}`,{foundation:true});
    }
    for(let step=0;step<8 && !(await tour.locator('.onboarding-tour-action-skip-section').count());step++) {
        await tour.locator('.onboarding-tour-action-next').click();
    }
    await hoverEvidence(page,tour.locator('.onboarding-tour-action-skip-section'),testInfo,'settings-tour-skip-section',{foundation:true});
    try {
        await skip.click();
        await expect(skip).toBeDisabled();
        await hoverEvidence(page,skip,testInfo,'settings-tour-disabled-pending-skip',{disabled:true});
        expect(onboardingWrites).toEqual([{completedModule:'catch-up'}]);
        pendingGate.release();
        await expect(tour).toBeHidden();
    } finally {pendingGate.release();}
});

test('Settings footer Save preserves disabled pending styles and scoped group payload',async({page},testInfo)=>{
    const groups=[{id:'hover-group',name:'Synthetic Hover Department',teamIds:['hover-team'],teamLabels:{},excludedCapacityEpics:[]}];
    const held=holdResponse();let savedBody;
    await installSurface(page,'catch-up',{groups,beforeNavigate:async page=>{
        await page.route('**/api/groups-config',async route=>{
            if(route.request().method()!=='POST') return route.fallback();
            savedBody=route.request().postDataJSON();await held.promise;
            return route.fulfill({json:{version:2,groups:savedBody.groups,defaultGroupId:savedBody.defaultGroupId,source:'test',configRevision:2}});
        });
    }});
    try {
        await page.getByRole('button',{name:'Manage team groups',exact:true}).click();
        const dialog=page.getByRole('dialog');
        await dialog.getByRole('button',{name:'Departments',exact:true}).click();
        await dialog.getByRole('textbox',{name:'Department name',exact:true}).fill('Renamed Synthetic Department');
        const save=dialog.getByRole('button',{name:'Save',exact:true});
        await expect(save).toBeEnabled();await save.click();
        const pending=dialog.locator('.group-modal-footer button').last();
        await expect(pending).toBeDisabled();
        await hoverEvidence(page,pending,testInfo,'settings-footer-pending-save',{disabled:true});
        expect(savedBody.groups[0].name).toBe('Renamed Synthetic Department');
        expect(savedBody).not.toHaveProperty('epm');expect(savedBody).not.toHaveProperty('selectedProjects');
        held.release();await expect(dialog).toBeHidden();
    } finally {held.release();}
});

test('Settings normal-user rights and Board loading preserve action and disabled control states',async({page},testInfo)=>{
    const held=holdResponse();
    await installSurface(page,'catch-up',{fixtureOptions:{userCanEditSettings:false,userCanEditEpmConfig:false,settingsAdminOnly:true},beforeNavigate:async page=>{
        await page.route('**/api/board-config/statuses',async route=>{await held.promise;return route.fulfill({json:{statuses:[{id:'1',name:'To Do'},{id:'2',name:'In Progress'},{id:'3',name:'Done'}]}});});
    }});
    try {
        await page.getByRole('button',{name:'Manage team groups',exact:true}).click();
        const dialog=page.getByRole('dialog');
        await expect(dialog.getByRole('button',{name:'Admin',exact:true})).toHaveCount(0);
        await expect(dialog.getByRole('button',{name:'EPM',exact:true})).toHaveCount(0);
        await dialog.getByRole('tab',{name:'Boards',exact:true}).click();
        const reset=dialog.getByRole('button',{name:'Reset to default columns',exact:true});
        await expect(reset).toBeDisabled();
        await hoverEvidence(page,reset,testInfo,'settings-loading-reset-disabled',{disabled:true});
        held.release();await expect(reset).toBeEnabled();
        await hoverEvidence(page,reset,testInfo,'settings-loaded-reset',{foundation:true});
    } finally {held.release();}
});

async function installScenarioHoverJourney(page) {
    await installSurface(page, 'scenario', {beforeNavigate: async page => {
        await page.route('**/api/scenario', route => route.fulfill({json: {
            jira_base_url:'https://jira.example', config:{start_date:'2026-04-01',quarter_end_date:'2026-06-30'},
            sprintBoundaries:{selected:{startDate:'2026-04-01',endDate:'2026-04-15'}},
            issues:[
                {key:'HOVER-1',summary:'Synthetic Scenario work',epicKey:'HOVER-EPIC',epicSummary:'Synthetic hover epic',team:'Synthetic Hover Team',assignee:'Synthetic Owner',sp:3,start:'2026-04-06',end:'2026-04-09'},
                {key:'HOVER-3',summary:'Synthetic late work',epicKey:'HOVER-RISK',epicSummary:'Synthetic risk epic',team:'Synthetic Risk Team',assignee:'Synthetic Risk Owner',sp:2,start:'2026-04-12',end:'2026-04-18',isLate:true},
                {key:'HOVER-2',summary:'Overlapping Scenario work',epicKey:'HOVER-EPIC',epicSummary:'Synthetic hover epic',team:'Synthetic Hover Team',assignee:'Synthetic Owner',sp:2,start:'2026-04-07',end:'2026-04-10'},
            ], dependencies:[],capacity_by_team:{'Synthetic Hover Team':{size:3},'Synthetic Risk Team':{size:2}},
            summary:{late_items:['HOVER-1'],critical_path:['HOVER-1'],unschedulable:['HOVER-2'],bottleneck_lanes:[]},
        }}));
        await page.route('**/api/scenario/drafts**',route=>route.fulfill({json:{
            activeDraft:{draftId:'hover-draft',versionNumber:2,draftRevision:2,overrides:{},updatedBy:'Synthetic Planner'},
            versions:[{versionNumber:1,draftRevision:1,createdBy:'Synthetic Planner',createdAt:'2026-04-01T10:00:00Z',overrideCount:0}],storage:'db',
        }}));
    }});
    await page.getByRole('radio',{name:'Scenario',exact:true}).click();
    const panel=page.locator('.scenario-panel');
    await panel.getByRole('button',{name:'Run Scenario',exact:true}).click();
    await expect(panel.locator('.scenario-lane-label').first()).toBeVisible();
    await expect(panel.getByRole('button',{name:'History',exact:true})).toBeEnabled();
    return panel;
}

async function focusScenarioControl(page,control,browserName) {
    await page.locator('.search-input').first().focus();
    for(let i=0;i<60;i++) {
        await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab');
        if(await control.evaluate(node=>node===document.activeElement)) break;
    }
    await expect(control).toBeFocused();
    await page.waitForTimeout(450);
}

async function scenarioLaneHover(page,lane,testInfo,label) {
    const evidence=await hoverEvidence(page,lane,testInfo,label,{
        pill:true,clipped:true,readableDescendants:true,unchangedFill:false,
        semanticHover:{background:'rgba(59, 130, 246, 0.08)',color:'rgb(15, 23, 42)'},
    });
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        // Operator-approved original semantic palette/composition; no relaxed
        // ordinary-text threshold. Each actual text owner is checked separately.
        for(const sample of evidence.textSamples) {
            expect(sample.fill.map(value=>Number(value.toFixed(6)))).toEqual([239.32,245,254.28]);
            const palette=sample.className==='scenario-lane-status ok' ? ['rgb(56, 158, 13)',3.162065717622173]
                :sample.className==='scenario-lane-status risk' ? ['rgb(212, 56, 13)',4.387435114360316]
                :sample.className==='scenario-lane-conflicts' ? ['rgb(207, 19, 34)',5.087645275663024] : null;
            if(palette) {
                expect(sample.color).toBe(palette[0]);
                expect(sample.contrast).toBeCloseTo(palette[1],12);
            } else expect(sample.contrast,`${label}: ${sample.text} readable`).toBeGreaterThanOrEqual(4.5);
        }
        expect(evidence.hover.shadow).toContain('inset');
        expect(evidence.hover.shadow).not.toContain('999px');
    }
    return evidence;
}

test('Scenario native lane, task actions, clickable headings and inline focus exit use their actual kinds',async ({page,browserName},testInfo)=>{
    const panel=await installScenarioHoverJourney(page);
    const lane=panel.locator('.scenario-lane-label').first();
    await scenarioLaneHover(page,lane,testInfo,'scenario-lane-ok');
    const riskLane=panel.locator('.scenario-lane-label').filter({hasText:'Synthetic Risk Team'});
    await scenarioLaneHover(page,riskLane,testInfo,'scenario-lane-risk');
    await focusScenarioControl(page,lane,browserName);
    expect(await lane.evaluate(node=>node.matches(':focus-visible'))).toBe(true);
    const laneFocus=await measure(lane);
    expect(laneFocus.background).toBe('rgba(59, 130, 246, 0.08)');
    expect(laneFocus.shadow).toBe('rgba(59, 130, 246, 0.18) 0px 0px 0px 1px inset');
    await lane.hover(); await page.waitForTimeout(450);
    expect((await measure(lane)).shadow).toBe(laneFocus.shadow);
    await lane.click();
    await expect(lane).toHaveAttribute('aria-expanded','true');
    // Clicking an already keyboard-focused button preserves focus-visible in
    // native browsers. Focus the existing search field to inspect pointer hover.
    await page.locator('.search-input').first().click();
    expect(await lane.evaluate(node=>node.matches(':focus-visible'))).toBe(false);
    await scenarioLaneHover(page,lane,testInfo,'scenario-lane-expanded');
    await riskLane.click(); await expect(riskLane).toHaveAttribute('aria-expanded','true');
    await page.locator('.search-input').first().click();
    await scenarioLaneHover(page,riskLane,testInfo,'scenario-lane-risk-expanded');
    await panel.getByRole('button',{name:'Show Summary',exact:true}).click();
    const headings=panel.locator('h4.scenario-card-toggle');
    for(let i=0;i<await headings.count();i++) {
        const heading=headings.nth(i);
        await hoverEvidence(page,heading,testInfo,`scenario-clickable-heading-${i}`,{underline:true});
        await heading.click(); await expect(heading.locator('.scenario-card-chevron')).toHaveText('▸');
        await heading.click(); await expect(heading.locator('.scenario-card-chevron')).toHaveText('▾');
    }
    const task=panel.locator('.scenario-link').filter({hasText:'Synthetic Scenario work'}).first();
    await hoverEvidence(page,task,testInfo,'scenario-task-action',{foundation:true,readableDescendants:true});
    await focusScenarioControl(page,task,browserName);
    expect(await task.evaluate(node=>node.matches(':focus-visible'))).toBe(true);
    const taskFocus=await measure(task);
    expect(taskFocus.background).toBe('rgba(16, 185, 129, 0.14)');
    expect(taskFocus.shadow).toBe('rgba(16, 185, 129, 0.24) 0px 0px 0px 1px inset');
    expect(taskFocus.color).toBe('rgb(15, 23, 42)');
    expect(taskFocus.textDecoration).toBe('none');
    await task.click();
    const bar=panel.locator('.scenario-bar').filter({hasText:'Synthetic Scenario work'}).first();
    const barEvidence=await hoverEvidence(page,bar,testInfo,'scenario-semantic-bar');
    if(process.env.JEP_HOVER_CAPTURE_ONLY!=='1') {
        expect(barEvidence.hover.background).toBe(barEvidence.rest.background);
        expect(barEvidence.hover.shadow).toBe(barEvidence.rest.shadow);
    }
    await expect(panel.locator('.scenario-tooltip.visible')).toBeVisible();
    await expect(panel.locator('.scenario-tooltip.visible')).toContainText('Synthetic Scenario work');
    await panel.getByRole('button',{name:'Epic',exact:true}).click();
    await panel.locator('.scenario-epic-bar').first().click();
    const focusedLane=panel.locator('.scenario-lane-label').first();
    await expect(focusedLane).toBeDisabled();
    await hoverEvidence(page,focusedLane,testInfo,'scenario-disabled-focused-lane',{disabled:true});
    const exit=panel.locator('.scenario-focus-exit');
    await hoverEvidence(page,exit,testInfo,'scenario-inline-focus-exit',{underline:true});
    await exit.click(); await expect(exit).toHaveCount(0);
    await panel.getByRole('button',{name:'History',exact:true}).click();
    const history=page.getByRole('dialog',{name:'Scenario draft history'});
    await hoverEvidence(page,history.getByRole('button',{name:'Reload version 1',exact:true}),testInfo,'scenario-history-reload',{foundation:true});
    await hoverEvidence(page,history.getByRole('button',{name:'Rollback to version 1',exact:true}),testInfo,'scenario-history-rollback',{foundation:true});
    await hoverEvidence(page,history.getByRole('button',{name:'Reload from Jira',exact:true}),testInfo,'scenario-draft-reload',{foundation:true});
    await hoverEvidence(page,history.getByRole('button',{name:'Close',exact:true}),testInfo,'scenario-history-close',{foundation:true});
    await history.getByRole('button',{name:'Close',exact:true}).click();
    await expect(history).not.toBeVisible();
});

test('touch Scenario native lane, headings, history and focus exit remain reachable',async ({browser,browserName},testInfo)=>{
    const context=await browser.newContext({viewport:{width:430,height:932},hasTouch:true,...(browserName==='firefox'?{}:{isMobile:true})});
    const page=await context.newPage();
    try {
        const panel=await installScenarioHoverJourney(page);
        expect(await page.evaluate(()=>matchMedia('(hover:hover)').matches)).toBe(false);
        const lane=panel.locator('.scenario-lane-label').first();
        const rest=await measure(lane); await lane.tap(); await page.waitForTimeout(450);
        await expect(lane).toHaveAttribute('aria-expanded','true');
        const tapped=await measure(lane); expect(tapped.shadow).toBe(rest.shadow); expect(tapped.background).toBe(rest.background);
        await panel.getByRole('button',{name:'Show Summary',exact:true}).tap();
        const heading=panel.locator('h4.scenario-card-toggle').first();
        await heading.tap(); await expect(heading.locator('.scenario-card-chevron')).toHaveText('▸');
        await heading.tap(); await expect(heading.locator('.scenario-card-chevron')).toHaveText('▾');
        await panel.getByRole('button',{name:'Epic',exact:true}).tap();
        const epic=panel.locator('.scenario-epic-bar').first();
        await epic.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
        const epicCenter=await epic.evaluate(node=>{
            const rect=node.getBoundingClientRect();
            const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
            return {width:rect.width,height:rect.height,exposed:hit===node||node.contains(hit)};
        });
        expect(epicCenter.exposed,'visible Epic bar center receives the touch').toBe(true);
        await epic.tap({position:{x:epicCenter.width/2,y:epicCenter.height/2}});
        const exit=panel.locator('.scenario-focus-exit'); await expect(exit).toBeVisible(); await exit.tap(); await expect(exit).toHaveCount(0);
        await panel.getByRole('button',{name:'History',exact:true}).tap();
        const history=page.getByRole('dialog',{name:'Scenario draft history'}); await expect(history).toBeVisible();
        const close=history.getByRole('button',{name:'Close',exact:true}); const closeRest=await measure(close);
        expect(closeRest.shadow).toBe('none'); await close.tap(); await expect(history).not.toBeVisible();
        expect(await page.evaluate(()=>matchMedia('(hover:hover)').matches)).toBe(false);
        await page.screenshot({path:path.join(evidenceDir(testInfo),'scenario-touch-surface.png'),animations:'disabled'});
    } finally {await context.close();}
});

test('Scenario history native pending and recovery-confirmation actions preserve their real states',async ({page},testInfo)=>{
    const panel=await installScenarioHoverJourney(page);
    const held=holdResponse();
    await page.route('**/api/scenario/drafts/hover-draft/versions/1',async route=>{
        await held.promise;
        return route.fulfill({json:{versionNumber:1,overrides:{'HOVER-1':{start:'2026-04-08',end:'2026-04-11'}}}});
    });
    try {
        await panel.getByRole('button',{name:'History',exact:true}).click();
        const history=page.getByRole('dialog',{name:'Scenario draft history'});
        const reload=history.getByRole('button',{name:'Reload version 1',exact:true});
        await reload.click(); await expect(reload).toBeDisabled();
        await hoverEvidence(page,reload,testInfo,'scenario-pending-native-reload',{disabled:true});
        await hoverEvidence(page,history.getByRole('button',{name:'Rollback to version 1',exact:true}),testInfo,'scenario-pending-native-rollback',{disabled:true});
        held.release(); await expect(reload).toBeEnabled();
        await expect(panel).toContainText('Reloaded version 1 locally');
        await history.getByRole('button',{name:'Reload from Jira',exact:true}).click();
        const confirm=history.getByRole('button',{name:'Confirm reload from Jira',exact:true});
        await hoverEvidence(page,confirm,testInfo,'scenario-recovery-confirm',{foundation:true});
        const cancel=history.getByRole('button',{name:'Cancel',exact:true});
        await hoverEvidence(page,cancel,testInfo,'scenario-recovery-cancel',{foundation:true});
        await cancel.click(); await expect(confirm).toHaveCount(0);
        await expect(panel).toContainText('Reloaded version 1 locally');
    } finally {held.release();}
});

// All settings tab rows share the same border-only vocabulary.
test('Settings tab rows keep underline hover without a boxed button frame',async({page},testInfo)=>{
    testInfo.setTimeout(90000);
    await installSurface(page,'catch-up');
    await page.getByRole('button',{name:'Manage team groups',exact:true}).click();
    const dialog=page.getByRole('dialog');
    for(const section of ['Departments','Admin','EPM']){
        await dialog.getByRole('button',{name:section,exact:true}).click();
        const rows=dialog.locator('.group-modal-tabs:visible');
        for(let row=0;row<await rows.count();row++){
            // The root row is checked once; each section's child rows are checked separately.
            if(row===0 && section!=='Departments')continue;
            const tabs=rows.nth(row).locator('.group-modal-tab');
            for(let index=0;index<await tabs.count();index++){
                const tab=tabs.nth(index);const selected=await tab.evaluate(n=>n.classList.contains('active'));
                await hoverEvidence(page,tab,testInfo,`settings-tabs-${section}-${row}-${index}`,{tab:true,selectedTab:selected});
            }
        }
    }
});
