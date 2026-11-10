// Task 4B/4C/4D (frontend): the one `rnd_2027` request lane, split Product/Tech by the server's Allocation stamp.
// Constants re-derive the Python reference fixture (tests/fixtures/work_structure_reference.py:
// NEW_MODEL_EXPECTED_PAIRS, SP oracle) in JS; Legacy stays pinned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const NEW = 'rnd_2027';
const sp = (key, value, { epic = 'PLAN-I1', status = 'To Do', stamp } = {}) => ({
    key,
    fields: { customfield_10004: value, epicKey: epic, projectKey: 'PLAN', teamId: 'team-a', teamName: 'Team A', status: { name: status },
        ...(stamp ? { projectClassification: stamp } : {}) },
});
const getTeamInfo = issue => ({ id: issue.fields.teamId, name: issue.fields.teamName });
const normalizeEpicKey = value => String(value || '').trim().toUpperCase();

// NEW_MODEL_EXPECTED_PAIRS (8-SP leaf under Initiative PLAN-I1)
const PAIRS = {
    ordinary: { excluded: [], adHoc: [], combined: 8, product: 8, tech: 0, adHocSp: 0, selectedTeam: 8, includedAllocation: 8, excludedReport: 0 },
    tech: { stamp: 'tech', excluded: [], adHoc: [], combined: 8, product: 0, tech: 8, adHocSp: 0, selectedTeam: 8, includedAllocation: 8, excludedReport: 0 },
    unmapped: { stamp: 'none', excluded: [], adHoc: [], combined: 8, product: 0, tech: 0, none: 8, adHocSp: 0, selectedTeam: 8, includedAllocation: 8, excludedReport: 0 },
    ad_hoc: { excluded: [], adHoc: ['PLAN-I1'], combined: 8, product: 8, tech: 0, adHocSp: 8, selectedTeam: 8, includedAllocation: 8, excludedReport: 0 },
    excluded: { excluded: ['PLAN-I1'], adHoc: [], combined: 0, product: 0, tech: 0, adHocSp: 0, selectedTeam: 8, includedAllocation: 0, excludedReport: 8 },
};
const SP_SOURCE_VALUES = [null, '', 8, '3.5', 'n/a'];
const SP_EXPECTED_TOTAL = 11.5;

async function load() {
    const [classification, stats, capacity] = await Promise.all([
        import('../frontend/src/capacityClassification.mjs'),
        import('../frontend/src/eng/planningSelectionStats.js'),
        import('../frontend/src/eng/planningCapacityUtils.js'),
    ]);
    return { ...classification, ...stats, ...capacity };
}

test('classifyCapacityIssue: the Allocation stamp decides Product/Tech/No Allocation, Ad Hoc follows it; Legacy output unchanged', async () => {
    const { classifyCapacityIssue, isTechIssue } = await load();
    const adHocEpicSet = new Set(['PLAN-I1']);
    const issue = sp('PLAN-E1', 8);
    const tech = sp('PLAN-E2', 8, { stamp: 'tech' });
    const product = sp('PLAN-E3', 8, { stamp: 'product' });
    assert.deepEqual(classifyCapacityIssue(tech, { adHocEpicSet: new Set() }), { projectType: 'tech', capacityType: 'tech', productSubtype: null });
    assert.deepEqual(classifyCapacityIssue(product, {}), { projectType: 'product', capacityType: 'product', productSubtype: 'standard' });
    assert.deepEqual(classifyCapacityIssue(issue, {}), { projectType: 'product', capacityType: 'product', productSubtype: 'standard' });
    assert.deepEqual(classifyCapacityIssue(tech, { adHocEpicSet }), { projectType: 'tech', capacityType: 'ad_hoc', productSubtype: null });
    assert.deepEqual(classifyCapacityIssue(sp('PLAN-E5', 8, { stamp: 'none' }), {}), { projectType: 'none', capacityType: 'none', productSubtype: null });
    // The stamp beats the project key both ways; a Board child carries it at the top level.
    assert.equal(classifyCapacityIssue(product, { techProjectKeys: new Set(['PLAN']) }).projectType, 'product');
    assert.equal(classifyCapacityIssue({ key: 'PLAN-E4', projectClassification: 'tech' }, {}).projectType, 'tech');
    assert.equal(isTechIssue(tech, new Set()), true);
    assert.equal(isTechIssue(product, new Set(['PLAN'])), false);
    assert.equal(isTechIssue(issue, new Set(['PLAN'])), true);
    assert.equal(isTechIssue({ key: 'OLD-1', fields: {} }, new Set(['OLD'])), true);
    // Legacy: pinned (LEGACY_CLASSIFICATION_EXPECTED).
    assert.deepEqual(classifyCapacityIssue(issue, { adHocEpicSet: new Set() }), { projectType: 'product', capacityType: 'product', productSubtype: 'standard' });
    assert.deepEqual(classifyCapacityIssue(issue, { workModel: 'legacy', adHocEpicSet }), { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' });
    assert.deepEqual(classifyCapacityIssue(issue, { techProjectKeys: new Set(['PLAN']) }), { projectType: 'tech', capacityType: 'tech', productSubtype: null });
});

for (const [name, pair] of Object.entries(PAIRS)) {
    test(`8-SP ${name} pair keeps the separate denominators and never doubles to 16 SP`, async () => {
        const u = await load();
        const tasks = [sp('PLAN-E1', 8, { stamp: pair.stamp })];
        const excludedEpicSet = new Set(pair.excluded);
        const adHocEpicSet = new Set(pair.adHoc);
        const techProjectKeys = new Set();
        const selectedTasksList = tasks; // overall selection keeps excluded work
        const selectedPlanningTasksList = u.buildSelectedPlanningTasksList(tasks, excludedEpicSet, normalizeEpicKey);

        assert.equal(u.buildSelectedTeamStats(selectedTasksList, getTeamInfo)['team-a'].storyPoints, pair.selectedTeam);
        const allocation = u.buildSelectedProjectStats(selectedPlanningTasksList, techProjectKeys, adHocEpicSet);
        assert.equal(allocation.PRODUCT || 0, pair.product);
        assert.equal(allocation.TECH || 0, pair.tech);
        assert.equal(allocation.NONE || 0, pair.none || 0);
        assert.equal(allocation.OTHER, undefined);
        const excludedReport = u.buildExcludedProjectStats(selectedTasksList, excludedEpicSet, techProjectKeys, normalizeEpicKey);
        assert.equal((excludedReport.PRODUCT || 0) + (excludedReport.TECH || 0) + (excludedReport.NONE || 0), pair.excludedReport);
        assert.equal(excludedReport.OTHER, undefined);
        const teamProject = u.buildSelectedTeamProjectStats(selectedPlanningTasksList, getTeamInfo, techProjectKeys, adHocEpicSet);
        assert.equal(teamProject['team-a']?.product || 0, pair.product);
        assert.equal(teamProject['team-a']?.tech || 0, pair.tech);
        assert.equal(teamProject['team-a']?.none || 0, pair.none || 0);
        assert.equal(teamProject['team-a']?.other, undefined);
        const adHocSp = selectedPlanningTasksList.reduce((sum, task) => sum + (u.classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet }).capacityType === 'ad_hoc' ? 8 : 0), 0);
        assert.equal(adHocSp, pair.adHocSp);
        assert.equal(pair.combined, pair.product + pair.tech + (pair.none || 0));
    });
}

test('Legacy project stats keep their PRODUCT/TECH buckets when no model is given', async () => {
    const u = await load();
    const tasks = [{ key: 'OLD-21', fields: { customfield_10004: 8, epicKey: 'OLD-E1', projectKey: 'OLD', teamId: 't', teamName: 'T' } }];
    assert.deepEqual(u.buildSelectedProjectStats(tasks, new Set()), { PRODUCT: 8 });
    assert.deepEqual(u.buildExcludedProjectStats(tasks, new Set(['OLD-E1']), new Set(), normalizeEpicKey), { PRODUCT: 8 });
    assert.deepEqual(u.buildSelectedTeamProjectStats(tasks, () => ({ id: 't', name: 'T' }), new Set()), { t: { product: 8, tech: 0 } });
});

test('SP parser oracle: null, empty, 8, 3.5 and n/a aggregate to 11.5 and stay distinguishable internally', async () => {
    const u = await load();
    const tasks = SP_SOURCE_VALUES.map((value, index) => sp(`PLAN-${index + 1}`, value));
    assert.equal(u.sumPlanningStoryPoints(tasks), SP_EXPECTED_TOTAL);
    const { sumEpicStoryPoints, formatStoryPointsLabel, formatStoryPointsFixed } = await import('../frontend/src/eng/engTaskUtils.js');
    assert.equal(sumEpicStoryPoints(tasks), SP_EXPECTED_TOTAL);
    assert.deepEqual(tasks.map(task => task.fields.customfield_10004), SP_SOURCE_VALUES); // never rewritten
    assert.deepEqual(tasks.map(formatStoryPointsFixed), ['0.0', '0.0', '8.0', '3.5', '0.0']);
    assert.deepEqual(tasks.map(formatStoryPointsLabel), ['0 SP', '0 SP', '8 SP', '3.5 SP', '0 SP']);
});

test('new-model capacity: team stats and project capacity use the Product/Tech buckets and the 70/30 split', async () => {
    const u = await load();
    const task = sp('PLAN-E1', 8);
    const stats = u.buildTeamCapacityStats({
        showPlanning: true, capacityEnabled: true, capacityTasks: [task, sp('PLAN-E2', 5, { stamp: 'tech' })],
        normalizeStatus: value => String(value).toLowerCase(), getTeamInfo, techProjectKeys: new Set(), adHocEpicSet: new Set(),
    });
    assert.equal('other' in stats['team-a'], false);
    assert.deepEqual(stats['team-a'].product, { todoPending: 8, accepted: 0, postponed: 0 });
    assert.deepEqual(stats['team-a'].tech, { todoPending: 5, accepted: 0, postponed: 0 });
    const [entry] = u.buildTeamCapacityEntries(stats);
    assert.equal(entry.total.todoPending, 13);
    const capacity = u.buildProjectCapacity({
        showPlanning: true, capacityEnabled: true, displayedTeamOptions: [{ id: 'team-a', name: 'Team A' }],
        selectedTeamProjectStats: { 'team-a': { product: 8, tech: 0 } }, getTeamNetCapacity: () => 20,
        capacitySplit: { product: 0.7, tech: 0.3 }, showProduct: true, showTech: true,
    });
    assert.deepEqual(capacity, { PRODUCT: 14, TECH: 6 });
    // DELIVERY No Allocation work is its own bucket: counted in the Team total, never in Product; the split stays Product/Tech.
    const delivery = u.buildTeamCapacityStats({
        showPlanning: true, capacityEnabled: true, capacityTasks: [task, sp('PLAN-E2', 5, { stamp: 'tech' }), sp('PLAN-E3', 3, { stamp: 'none' })],
        normalizeStatus: value => String(value).toLowerCase(), getTeamInfo, techProjectKeys: new Set(), adHocEpicSet: new Set(),
    });
    assert.deepEqual(delivery['team-a'].product, { todoPending: 8, accepted: 0, postponed: 0 });
    assert.deepEqual(delivery['team-a'].none, { todoPending: 3, accepted: 0, postponed: 0 });
    const [deliveryEntry] = u.buildTeamCapacityEntries(delivery);
    assert.deepEqual(deliveryEntry.none, { todoPending: 3, accepted: 0, postponed: 0 });
    assert.equal(deliveryEntry.total.todoPending, 16);
    const deliveryTotals = u.buildCapacityTotals({ showPlanning: true, capacityEnabled: true, displayedTeamCapacityEntries: [deliveryEntry] });
    assert.deepEqual(deliveryTotals.none, { todoPending: 3, accepted: 0, postponed: 0 });
    assert.equal(deliveryTotals.total.todoPending, 16);
    assert.deepEqual(u.buildProjectCapacity({
        showPlanning: true, capacityEnabled: true, displayedTeamOptions: [{ id: 'team-a', name: 'Team A' }],
        selectedTeamProjectStats: { 'team-a': { product: 8, tech: 0, none: 30 } }, getTeamNetCapacity: () => 20,
        capacitySplit: { product: 0.7, tech: 0.3 }, showProduct: true, showTech: true,
    }), { PRODUCT: 14, TECH: 6 });
    const legacy = u.buildTeamCapacityStats({
        showPlanning: true, capacityEnabled: true, capacityTasks: [task], normalizeStatus: value => String(value).toLowerCase(),
        getTeamInfo, techProjectKeys: new Set(),
    });
    assert.equal('other' in legacy['team-a'], false);
    assert.equal('other' in u.buildTeamCapacityEntries(legacy)[0], false);
    assert.deepEqual(Object.keys(legacy['team-a']).sort(), ['name', 'product', 'tech']);
    assert.deepEqual(Object.keys(u.buildTeamCapacityEntries(legacy)[0]).sort(), ['id', 'name', 'product', 'tech', 'total']);
    assert.deepEqual(Object.keys(u.buildCapacityTotals({ showPlanning: true, capacityEnabled: true, displayedTeamCapacityEntries: u.buildTeamCapacityEntries(legacy) })).sort(), ['product', 'tech', 'total']);
});

// DELIVERY Initiatives: I1 Product (two Epics), I2 Tech, I3 No Allocation, I4 unreadable (absent from the details map) = No Allocation.
const ALLOCATION_TASKS = [sp('PLAN-E1', 8, { epic: 'PLAN-I1', stamp: 'product' }), sp('PLAN-E2', 3, { epic: 'PLAN-I1', stamp: 'product' }),
    sp('PLAN-E3', 5, { epic: 'PLAN-I2', stamp: 'tech' }), sp('PLAN-E4', 2, { epic: 'PLAN-I3', stamp: 'none' }), sp('PLAN-E5', 1, { epic: 'PLAN-I4', stamp: 'none' })];
const ALLOCATION_DETAILS = { 'PLAN-I1': { key: 'PLAN-I1', allocationClass: 'product' }, 'PLAN-I2': { key: 'PLAN-I2', allocationClass: 'tech' },
    'PLAN-I3': { key: 'PLAN-I3', allocationClass: 'none' } };

async function allocationFilters(allocation) {
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const { isTechIssue } = await load();
    const model = buildEngCatchUpFacetModel({ tasks: ALLOCATION_TASKS, isTechTask: task => isTechIssue(task, new Set()), epicDetails: ALLOCATION_DETAILS, workModel: NEW });
    return { model, resolved: resolveEngCatchUpFilters({ model, allocation }) };
}

test('DELIVERY Allocation facet counts Initiatives and offers No Allocation', async () => {
    const { model, resolved } = await allocationFilters(undefined);
    assert.deepEqual(model.facets.map(facet => facet.id), ['status', 'priority', 'projects', 'track']);
    const facet = model.facets[2];
    assert.equal(facet.label, 'Allocation');
    assert.deepEqual(facet.options, [{ id: 'product', label: 'Product' }, { id: 'tech', label: 'Tech' }]);
    assert.equal(facet.allowEmpty, true);
    assert.equal(facet.showZeroCountOptions, true);
    assert.equal(facet.emptyLabel, 'No Allocation');
    assert.equal(facet.emptyDescription, 'No Allocation — showing epics under initiatives without a value');
    // Counted per Initiative (deduped by epicKey), not per Epic; the unreadable Initiative is No Allocation.
    assert.deepEqual(model.counts.projects, { product: 1, tech: 1 });
    assert.equal(facet.emptyTotal, 2);
    assert.equal(facet.neutralTotal, 4);
    const [, , projectsView] = resolved.facetViews;
    assert.equal(projectsView.isNeutral, true);
    assert.equal(projectsView.admittedTotal, 4);
    assert.deepEqual(ALLOCATION_TASKS.filter(task => resolved.admitsAllocation(resolved.allocationClassOf(task))).map(task => task.key),
        ALLOCATION_TASKS.map(task => task.key));
    // Zero-count options stay visible, like Project Track.
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const productOnly = buildEngCatchUpFacetModel({ tasks: ALLOCATION_TASKS.slice(0, 1), epicDetails: ALLOCATION_DETAILS, workModel: NEW });
    assert.deepEqual(resolveEngCatchUpFilters({ model: productOnly }).facetViews[2].visibleOptions.map(option => [option.id, option.count]), [['product', 1], ['tech', 0]]);
});

test('allocation facet empty selection admits only none', async () => {
    const { resolved } = await allocationFilters([]);
    const projectsView = resolved.facetViews[2];
    assert.equal(projectsView.isEmptySelection, true);
    assert.equal(projectsView.admittedTotal, 2);
    assert.deepEqual(ALLOCATION_TASKS.filter(task => resolved.admitsAllocation(resolved.allocationClassOf(task))).map(task => task.key), ['PLAN-E4', 'PLAN-E5']);
    assert.equal(resolved.admitsAllocation('product'), false);
    assert.equal(resolved.admitsAllocation('tech'), false);
    assert.equal(resolved.admitsAllocation('none'), true);
    const { describeFacetChip } = await import('../frontend/src/eng/engFilterFacets.js');
    assert.deepEqual(describeFacetChip(projectsView, resolved.facets[2]).title, 'Allocation — only No Allocation');
    const { readEngCatchUpFilterState } = await import('../frontend/src/eng/engCatchUpFilters.js');
    // Stored as the explicit empty list, never as the Legacy booleans.
    const empty = readEngCatchUpFilterState({ ...resolved.selection, projects: [] }, resolved.facetViews, {}, { allocation: true });
    assert.deepEqual(empty.allocation, []);
    assert.equal('showTech' in empty || 'showProduct' in empty, false);
    assert.deepEqual(readEngCatchUpFilterState({ ...resolved.selection, projects: ['tech'] }, resolved.facetViews, {}, { allocation: true }).allocation, ['tech']);
    assert.equal(readEngCatchUpFilterState({ ...resolved.selection, projects: ['product', 'tech'] }, resolved.facetViews, {}, { allocation: true }).allocation, undefined);
    const techOnly = (await allocationFilters(['tech'])).resolved;
    assert.deepEqual(ALLOCATION_TASKS.filter(task => techOnly.admitsAllocation(techOnly.allocationClassOf(task))).map(task => task.key), ['PLAN-E3']);
    // Readiness Epics carry `projectClass`; an unknown class is No Allocation.
    assert.equal(resolved.admitsAllocation(resolved.allocationClassOf({ projectClass: 'none' })), true);
    assert.equal(resolved.admitsAllocation(resolved.allocationClassOf({ projectClass: 'other' })), true);
});

test('Legacy Projects facet unchanged', async () => {
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters, readEngCatchUpFilterState } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const { isTechIssue } = await load();
    const techKeys = new Set(['TECH']);
    const tasks = [sp('PLAN-1', 8), { key: 'TECH-1', fields: { projectKey: 'TECH', epicKey: 'PLAN-I1', status: { name: 'To Do' } } }];
    const model = buildEngCatchUpFacetModel({ tasks, isTechTask: task => isTechIssue(task, techKeys), epicDetails: ALLOCATION_DETAILS });
    assert.deepEqual(model.facets[2], { id: 'projects', label: 'Projects', kind: 'multi', neutralTotal: 2, options: [{ id: 'tech', label: 'Tech' }, { id: 'product', label: 'Product' }] });
    assert.deepEqual(model.counts.projects, { tech: 1, product: 1 });
    const resolved = resolveEngCatchUpFilters({ model, showTech: false, allocation: [] });
    assert.equal(resolved.admitsProject(true), false);
    assert.equal(resolved.admitsProject(false), true);
    const next = readEngCatchUpFilterState(resolved.selection, resolved.facetViews);
    assert.deepEqual([next.showTech, next.showProduct, 'allocation' in next], [false, true, false]);
});

test('new-model Board filter model shows the Allocation facet from the Initiative class', async () => {
    const { resolveEntityNames } = await import('../frontend/src/eng/engWorkModel.js');
    const { buildEngBoardFacetModel, resolveEngBoardFilters } = await import('../frontend/src/eng/engBoardFilters.js');
    const { isTechIssue } = await load();
    const isTechTask = task => isTechIssue(task, new Set());
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    assert.equal(resolveEngCatchUpFilters({ model: buildEngCatchUpFacetModel({ tasks: ALLOCATION_TASKS, isTechTask, names: resolveEntityNames(NEW), workModel: NEW }) }).readoutUnit, 'of 5 epics');
    assert.equal(resolveEngCatchUpFilters({ model: buildEngCatchUpFacetModel({ tasks: ALLOCATION_TASKS, isTechTask: () => true }) }).readoutUnit, 'of 5 stories');

    const groups = [{ key: 'PLAN-I1', epic: { key: 'PLAN-I1', summary: 'I', projectClassification: 'tech' }, tasks: [sp('PLAN-E1', 8, { stamp: 'tech' })] },
        { key: 'PLAN-I2', epic: { key: 'PLAN-I2', summary: 'J', allocationClass: 'product' }, tasks: [] },
        { key: 'PLAN-I3', epic: { key: 'PLAN-I3', summary: 'K' }, tasks: [sp('PLAN-E3', 2, { epic: 'PLAN-I3', stamp: 'none' })] }];
    const board = buildEngBoardFacetModel({ epicGroups: groups, isTechTask, workModel: NEW });
    const projects = board.facets.find(facet => facet.id === 'projects');
    assert.equal(projects.label, 'Allocation');
    assert.deepEqual(projects.options.map(option => option.id), ['product', 'tech']);
    assert.equal(projects.emptyLabel, 'No Allocation');
    assert.equal(projects.emptyDescription, 'No Allocation — showing initiatives without a value');
    // An Initiative with no children still shows its own class (Review Focus 1).
    assert.deepEqual(board.counts.projects, { product: 1, tech: 1 });
    assert.equal(projects.emptyTotal, 1);
    const keys = selection => groups.filter(resolveEngBoardFilters({ model: board, selection }).admitsEpic).map(group => group.key);
    assert.deepEqual(keys({}), ['PLAN-I1', 'PLAN-I2', 'PLAN-I3']);
    assert.deepEqual(keys({ projects: ['product'] }), ['PLAN-I2']);
    assert.deepEqual(keys({ projects: [] }), ['PLAN-I3']);
    groups.pop();
    const single = resolveEngBoardFilters({ model: buildEngBoardFacetModel({ epicGroups: groups.slice(0, 1), isTechTask, workModel: NEW }) });
    // One is singular in every configuration (the count rule); the subject names the parent level.
    assert.equal(single.readoutUnit, 'of 1 initiative');
    assert.equal(single.subject, 'Filtering initiatives');
    assert.equal(resolveEngBoardFilters({ model: buildEngBoardFacetModel({ epicGroups: groups.slice(0, 1) }) }).readoutUnit, 'of 1 epic');
    const legacyProjects = buildEngBoardFacetModel({ epicGroups: groups, isTechTask }).facets.find(facet => facet.id === 'projects');
    assert.equal(legacyProjects.label, 'Projects');
    assert.equal(legacyProjects.allowEmpty, undefined);
});

test('alert refresh calls: the combined model never asks for the retired Backlog request; Legacy unchanged', async () => {
    const { alertCallsFor, alertCallsForEdit } = await import('../frontend/src/eng/epicRefreshAlerts.js');
    const update = { addedKeys: ['S-1'], changedKeys: [], removedKeys: [] };
    assert.ok(alertCallsFor(update, { isFutureSprint: true, isCatchUp: true }).includes('backlog'));
    assert.equal(alertCallsFor(update, { isFutureSprint: true, isCatchUp: true, workModel: NEW }).includes('backlog'), false);
    assert.deepEqual(alertCallsForEdit({ field: 'status', isFutureSprint: true, isCatchUp: true }), ['readyToClose', 'epicAlerts', 'backlog', 'readiness']);
    assert.deepEqual(alertCallsForEdit({ field: 'status', isFutureSprint: true, isCatchUp: true, workModel: NEW }), ['readyToClose', 'epicAlerts', 'readiness']);
});

test('work hierarchy admits DELIVERY readiness rows by Allocation class, incl. none; Legacy still drops none', async () => {
    const { buildEngWorkHierarchy } = await import('../frontend/src/eng/engWorkHierarchy.js');
    const readiness = (key, projectClass) => ({ key, summary: key, projectClass, status: { name: 'To Do' }, missingTeams: [{ id: 't', name: 'T', reason: 'no_stories' }] });
    const snapshot = { schemaVersion: 1, complete: true, scope: { groupId: 'g', sprintId: '1', sprintName: 'S', sprintState: 'active' },
        epics: [readiness('PLAN-I1', 'none'), readiness('PLAN-I2', 'tech'), readiness('PLAN-I3', 'product')] };
    const args = { sprint: { id: '1', name: 'S', state: 'active' }, readinessSnapshot: snapshot, filters: { groupId: 'g' } };
    const keys = filters => buildEngWorkHierarchy({ ...args, filters: { groupId: 'g', ...filters }, workModel: NEW }).requirements.map(item => item.epicKey ?? item.epic?.key);
    assert.equal(buildEngWorkHierarchy({ ...args, workModel: NEW }).requirements.length, 3);
    // Showing only No Allocation keeps the `none` Initiative row and drops the Product/Tech ones.
    const { resolved } = await allocationFilters([]);
    assert.deepEqual(keys({ admitsAllocation: resolved.admitsAllocation }), ['PLAN-I1']);
    const tech = (await allocationFilters(['tech'])).resolved;
    assert.deepEqual(keys({ admitsAllocation: tech.admitsAllocation }), ['PLAN-I2']);
    const legacySnapshot = { ...snapshot, epics: [readiness('PLAN-I1', 'none')] };
    const legacy = buildEngWorkHierarchy({ ...args, readinessSnapshot: legacySnapshot });
    assert.equal(legacy.requirements.length, 0);
    assert.ok(legacy.diagnostics.some(item => item.code === 'project_class_invalid'));
});

test('role-aware names: Epic/Initiative for the combined model, Story/Epic for Legacy', async () => {
    const { workEntityNames, isCombinedWorkModel, normalizeWorkModel } = await import('../frontend/src/eng/engWorkModel.js');
    assert.deepEqual(workEntityNames(NEW), { child: 'Epic', childPlural: 'Epics', parent: 'Initiative', parentPlural: 'Initiatives' });
    assert.deepEqual(workEntityNames(undefined), { child: 'Story', childPlural: 'Stories', parent: 'Epic', parentPlural: 'Epics' });
    assert.equal(isCombinedWorkModel('legacy'), false);
    assert.equal(normalizeWorkModel('anything'), 'legacy');
});

// --- useEngSprintData: one request, no phantom Tech lane ------------------------------------------
function harness(workModel) {
    const source = fs.readFileSync('frontend/src/eng/useEngSprintData.js', 'utf8')
        .replace(/^import\s+[^;]+;\s*$/gm, '').replaceAll('export const ', 'const ').replaceAll('export function ', 'function ');
    const requests = [], calls = { backlog: 0 };
    const response = () => new Response(JSON.stringify({ issues: [{ key: 'PLAN-E1', fields: { customfield_10004: 8 } }], epics: {}, epicsInScope: [] }));
    const dependencies = {
        // The hook's own state, outside a React render: initial values, no-op setters.
        React: { useState: initial => [initial, () => {}], useMemo: factory => factory() },
        fetchEngTasks: async (url, options) => { requests.push(options.project); return response(); },
        fetchEpicRefresh: async (url, options) => { requests.push(options.project); return response(); },
        fetchBacklogEpics: async () => { calls.backlog += 1; return { epics: [] }; },
        fetchEpicAlertBundle: async () => response(), fetchEpicBacklog: async () => { calls.backlog += 1; return { epics: [] }; },
        fetchEpicMissingInfo: async () => response(), fetchEpicReadyToClose: async () => response(),
        requestBacklogEpics: async () => { calls.backlog += 1; return { epics: [] }; },
        isAuthenticationRequiredError: () => false, recordPerformanceLoad: async () => {},
        createGroupLoadMeasurement: () => ({ enabled: false, contentReady() {}, finish() {}, cancel() {}, dependencies() {}, lane() {} }),
        laneMetrics: () => ({}), PRIORITY_ORDER: [], filterEpicsByTaskEpicKeys: epics => epics, filterEpicsInScopeForTeamSet: items => items,
        filterTasksForTeamSet: items => items, sortTasksByPriority: items => items, flattenTeamLabelAliases: () => [],
    };
    const hook = new Function(...Object.keys(dependencies), `${source}; return useEngSprintData;`)(...Object.values(dependencies));
    const state = { techLoaded: [], tech: [], product: [] };
    const props = {
        workModel, backendUrl: 'https://synthetic.invalid', selectedSprint: '1', activeGroupId: 'g', activeGroupTeamIds: ['t'],
        activeGroupTeamSet: new Set(['t']), pageLoadRefreshRef: { current: false }, sprintLoadRef: { current: { sprintId: null, product: false, tech: false } },
        lastLoadedSprintRef: { current: null }, registerSprintFetch: () => new AbortController(), cleanupSprintFetch: () => {},
        isFutureSprintSelected: true, loadedProductTasks: [], loadedTechTasks: [],
        setTechLoaded: value => state.techLoaded.push(value), setTechTasks: value => state.tech.push(value), setLoadedTechTasks: value => state.tech.push(value),
        setProductTasks: value => state.product.push(value), setLoadedProductTasks: () => {},
    };
    for (const key of ['setLoading', 'setError', 'setEpicDetails', 'setProductEpicsInScope', 'setTechEpicsInScope', 'setTasksFetched',
        'setProductTasksLoading', 'setTechTasksLoading', 'setReadyToCloseProductTasks', 'setReadyToCloseTechTasks',
        'setReadyToCloseProductEpicsInScope', 'setReadyToCloseTechEpicsInScope']) props[key] = () => {};
    return { api: hook(props), props, requests, calls, state };
}

test('combined model: the department load is ONE project=all request and never touches Tech state', async () => {
    const h = harness(NEW);
    const group = h.api.loadGroupTasks();
    assert.deepEqual(await Promise.all([group.product, group.tech]), ['applied', 'applied']);
    assert.deepEqual(h.requests, ['all']);
    assert.deepEqual(h.state.techLoaded, []);
    assert.deepEqual(h.state.tech, []);
    assert.equal(h.state.product.length, 1);
    assert.equal(h.props.lastLoadedSprintRef.current, '1', 'the single lane completes the sprint load');
});

test('combined model: alerts load is one request, the retired Backlog source is never requested', async () => {
    const h = harness(NEW);
    const outcomes = await h.api.loadAlertEpics();
    assert.deepEqual(h.requests, ['all']);
    assert.deepEqual(outcomes, { product: 'applied', tech: 'applied' });
    assert.deepEqual(await h.api.fetchBacklogEpics('product'), []);
    assert.equal(h.calls.backlog, 0);
    const lanes = await h.api.loadEpicAlerts({ epicKey: 'PLAN-I1', calls: ['epicAlerts', 'readyToClose', 'backlog'] });
    assert.deepEqual(Object.keys(lanes.tech), []);
    assert.equal(lanes.product.backlog, undefined);
    assert.equal(h.calls.backlog, 0);
});

test('Legacy keeps its Product + Tech requests exactly', async () => {
    const h = harness(undefined);
    const group = h.api.loadGroupTasks();
    await Promise.all([group.product, group.tech]);
    assert.deepEqual([...h.requests].sort(), ['product', 'tech']);
    h.requests.length = 0;
    await h.api.loadAlertEpics();
    assert.deepEqual([...h.requests].sort(), ['product', 'tech']);
    h.requests.length = 0;
    await h.api.fetchBacklogEpics('tech');
    assert.equal(h.calls.backlog, 1);
});
