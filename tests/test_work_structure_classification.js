// Task 4B/4C/4D (frontend): the combined `rnd_2027` lane. Constants re-derive the Python reference fixture
// (tests/fixtures/work_structure_reference.py: NEW_MODEL_EXPECTED_PAIRS, SP oracle) in JS; Legacy stays pinned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const NEW = 'rnd_2027';
const sp = (key, value, { epic = 'PLAN-I1', status = 'To Do' } = {}) => ({
    key,
    fields: { customfield_10004: value, epicKey: epic, projectKey: 'PLAN', teamId: 'team-a', teamName: 'Team A', status: { name: status } },
});
const getTeamInfo = issue => ({ id: issue.fields.teamId, name: issue.fields.teamName });
const normalizeEpicKey = value => String(value || '').trim().toUpperCase();

// NEW_MODEL_EXPECTED_PAIRS (8-SP leaf under Initiative PLAN-I1)
const PAIRS = {
    ordinary: { excluded: [], adHoc: [], combined: 8, adHocSp: 0, selectedTeam: 8, includedAllocation: 8, excludedReport: 0 },
    ad_hoc: { excluded: [], adHoc: ['PLAN-I1'], combined: 8, adHocSp: 8, selectedTeam: 8, includedAllocation: 8, excludedReport: 0 },
    excluded: { excluded: ['PLAN-I1'], adHoc: [], combined: 0, adHocSp: 0, selectedTeam: 8, includedAllocation: 0, excludedReport: 8 },
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

test('classifyCapacityIssue: combined model never says Product/Tech; Legacy output unchanged', async () => {
    const { classifyCapacityIssue } = await load();
    const adHocEpicSet = new Set(['PLAN-I1']);
    const issue = sp('PLAN-E1', 8);
    assert.deepEqual(classifyCapacityIssue(issue, { workModel: NEW, adHocEpicSet: new Set() }),
        { projectType: 'other', capacityType: 'other', productSubtype: null });
    assert.deepEqual(classifyCapacityIssue(issue, { workModel: NEW, adHocEpicSet }),
        { projectType: 'other', capacityType: 'ad_hoc', productSubtype: null });
    // A Tech project key cannot reattribute combined work.
    assert.equal(classifyCapacityIssue(issue, { workModel: NEW, techProjectKeys: new Set(['PLAN']) }).projectType, 'other');
    // Legacy: pinned (LEGACY_CLASSIFICATION_EXPECTED).
    assert.deepEqual(classifyCapacityIssue(issue, { adHocEpicSet: new Set() }), { projectType: 'product', capacityType: 'product', productSubtype: 'standard' });
    assert.deepEqual(classifyCapacityIssue(issue, { workModel: 'legacy', adHocEpicSet }), { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' });
    assert.deepEqual(classifyCapacityIssue(issue, { techProjectKeys: new Set(['PLAN']) }), { projectType: 'tech', capacityType: 'tech', productSubtype: null });
});

for (const [name, pair] of Object.entries(PAIRS)) {
    test(`8-SP ${name} pair keeps the separate denominators and never doubles to 16 SP`, async () => {
        const u = await load();
        const tasks = [sp('PLAN-E1', 8)];
        const excludedEpicSet = new Set(pair.excluded);
        const adHocEpicSet = new Set(pair.adHoc);
        const techProjectKeys = new Set();
        const selectedTasksList = tasks; // overall selection keeps excluded work
        const selectedPlanningTasksList = u.buildSelectedPlanningTasksList(tasks, excludedEpicSet, normalizeEpicKey);

        assert.equal(u.buildSelectedTeamStats(selectedTasksList, getTeamInfo)['team-a'].storyPoints, pair.selectedTeam);
        const allocation = u.buildSelectedProjectStats(selectedPlanningTasksList, techProjectKeys, adHocEpicSet, NEW);
        assert.equal(allocation.OTHER || 0, pair.includedAllocation);
        assert.equal(allocation.PRODUCT, undefined);
        assert.equal(allocation.TECH, undefined);
        assert.equal((u.buildExcludedProjectStats(selectedTasksList, excludedEpicSet, techProjectKeys, normalizeEpicKey, NEW).OTHER) || 0, pair.excludedReport);
        const teamProject = u.buildSelectedTeamProjectStats(selectedPlanningTasksList, getTeamInfo, techProjectKeys, adHocEpicSet, NEW);
        assert.equal(teamProject['team-a']?.other || 0, pair.includedAllocation);
        assert.equal(teamProject['team-a']?.product || 0, 0);
        assert.equal(teamProject['team-a']?.tech || 0, 0);
        const adHocSp = selectedPlanningTasksList.reduce((sum, task) => sum + (u.classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet, workModel: NEW }).capacityType === 'ad_hoc' ? 8 : 0), 0);
        assert.equal(adHocSp, pair.adHocSp);
        assert.equal(pair.combined, pair.includedAllocation);
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

test('combined capacity: team stats use one `other` breakdown, project capacity one OTHER bucket', async () => {
    const u = await load();
    const task = sp('PLAN-E1', 8);
    const stats = u.buildTeamCapacityStats({
        showPlanning: true, capacityEnabled: true, capacityTasks: [task], normalizeStatus: value => String(value).toLowerCase(),
        getTeamInfo, techProjectKeys: new Set(), adHocEpicSet: new Set(), workModel: NEW,
    });
    assert.deepEqual(stats['team-a'].other, { todoPending: 8, accepted: 0, postponed: 0 });
    assert.equal(stats['team-a'].product.todoPending + stats['team-a'].tech.todoPending, 0);
    const [entry] = u.buildTeamCapacityEntries(stats);
    assert.equal(entry.total.todoPending, 8);
    const capacity = u.buildProjectCapacity({
        showPlanning: true, capacityEnabled: true, displayedTeamOptions: [{ id: 'team-a', name: 'Team A' }],
        selectedTeamProjectStats: {}, getTeamNetCapacity: () => 20, capacitySplit: { product: 0.7, tech: 0.3 }, showProduct: true, showTech: true, workModel: NEW,
    });
    assert.deepEqual(capacity, { OTHER: 20 });
    const legacy = u.buildTeamCapacityStats({
        showPlanning: true, capacityEnabled: true, capacityTasks: [task], normalizeStatus: value => String(value).toLowerCase(),
        getTeamInfo, techProjectKeys: new Set(),
    });
    assert.equal('other' in legacy['team-a'], false);
    assert.equal('other' in u.buildTeamCapacityEntries(legacy)[0], false);
});

test('combined Catch Up and Board filter models hide the Projects facet and never count Product/Tech', async () => {
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const { resolveEntityNames } = await import('../frontend/src/eng/engWorkModel.js');
    const { buildEngBoardFacetModel, resolveEngBoardFilters } = await import('../frontend/src/eng/engBoardFilters.js');
    const tasks = [sp('PLAN-E1', 8), sp('PLAN-E2', 5)];
    const catchUp = buildEngCatchUpFacetModel({ tasks, isTechTask: () => true, names: resolveEntityNames(NEW) });
    assert.equal(catchUp.facets.find(facet => facet.id === 'projects').hidden, true);
    assert.deepEqual(catchUp.counts.projects, { tech: 0, product: 0 });
    const resolved = resolveEngCatchUpFilters({ model: catchUp });
    assert.equal(resolved.admitsProject(true), true);
    assert.equal(resolved.readoutUnit, 'of 2 epics');
    const legacy = buildEngCatchUpFacetModel({ tasks, isTechTask: () => true });
    assert.equal(legacy.facets.find(facet => facet.id === 'projects').hidden, undefined);
    assert.equal(resolveEngCatchUpFilters({ model: legacy }).readoutUnit, 'of 2 stories');

    const groups = [{ key: 'PLAN-I1', epic: { key: 'PLAN-I1', summary: 'I' }, tasks: [sp('PLAN-E1', 8)] }];
    const board = buildEngBoardFacetModel({ epicGroups: groups, isTechTask: () => false, workModel: NEW });
    assert.equal(board.facets.find(facet => facet.id === 'projects').hidden, true);
    assert.deepEqual(board.counts.projects, { tech: 0, product: 0, other: 0 });
    const boardResolved = resolveEngBoardFilters({ model: board });
    assert.equal(boardResolved.admitsEpic(groups[0]), true);
    // One is singular in every configuration (the count rule); the subject names the parent level.
    assert.equal(boardResolved.readoutUnit, 'of 1 initiative');
    assert.equal(boardResolved.subject, 'Filtering initiatives');
    assert.equal(resolveEngBoardFilters({ model: buildEngBoardFacetModel({ epicGroups: groups }) }).readoutUnit, 'of 1 epic');
});

test('alert refresh calls: the combined model never asks for the retired Backlog request; Legacy unchanged', async () => {
    const { alertCallsFor, alertCallsForEdit } = await import('../frontend/src/eng/epicRefreshAlerts.js');
    const update = { addedKeys: ['S-1'], changedKeys: [], removedKeys: [] };
    assert.ok(alertCallsFor(update, { isFutureSprint: true, isCatchUp: true }).includes('backlog'));
    assert.equal(alertCallsFor(update, { isFutureSprint: true, isCatchUp: true, workModel: NEW }).includes('backlog'), false);
    assert.deepEqual(alertCallsForEdit({ field: 'status', isFutureSprint: true, isCatchUp: true }), ['readyToClose', 'epicAlerts', 'backlog', 'readiness']);
    assert.deepEqual(alertCallsForEdit({ field: 'status', isFutureSprint: true, isCatchUp: true, workModel: NEW }), ['readyToClose', 'epicAlerts', 'readiness']);
});

test('work hierarchy admits the combined lane `other` project class and Legacy still drops it', async () => {
    const { buildEngWorkHierarchy } = await import('../frontend/src/eng/engWorkHierarchy.js');
    const snapshot = { schemaVersion: 1, complete: true, scope: { groupId: 'g', sprintId: '1', sprintName: 'S', sprintState: 'active' },
        epics: [{ key: 'PLAN-I1', summary: 'I', projectClass: 'other', status: { name: 'To Do' }, missingTeams: [{ id: 't', name: 'T', reason: 'no_stories' }] }] };
    const args = { sprint: { id: '1', name: 'S', state: 'active' }, readinessSnapshot: snapshot, filters: { groupId: 'g' } };
    assert.equal(buildEngWorkHierarchy({ ...args, workModel: NEW }).requirements.length, 1);
    const legacy = buildEngWorkHierarchy(args);
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
