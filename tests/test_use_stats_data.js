const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');
// Frozen before the move at 13075f93; synthetic SSR proves interfaces, browser baselines prove reads.
const EXPECTED = {
    "A": [
        "effectiveStatsData",
        "burnoutTaskTeamByIssueKey",
        "burnoutTaskStatusByIssueKey",
        "burnoutIssueWeightByKey",
        "burnoutScopedTeamIds",
        "burnoutScopedTeamSignature",
        "cohortScopedTeamSignature",
        "burnoutQueryKey",
        "cohortQueryKey"
    ],
    "B": [
        "cohortQuarterOptions",
        "cohortProjectOptions",
        "cohortAssigneeOptions",
        "cohortSummary",
        "cohortWorkflowStatusTotal",
        "cohortGridModel",
        "cohortOpenBars",
        "cohortCompletedBars",
        "cohortAverageLeadDays",
        "cohortMedianLeadDays",
        "cohortWarnings",
        "cohortStatusControls",
        "cohortSelectedRowLabel",
        "excludedCapacitySprintOptions",
        "excludedCapacitySprintRange",
        "effortSplitSprintLabel",
        "excludedCapacityEpicOptions",
        "projectTrackSeries",
        "projectTrackTotals",
        "projectTrackBreakdown",
        "projectTrackColumnSplit",
        "projectTrackRangeLabel",
        "projectTrackPhaseEpics",
        "projectTrackPhaseSummary",
        "excludedCapacityEpicCatalog",
        "excludedCapacityEffectiveFilters",
        "excludedCapacityFilterLabel",
        "effortSplitRows",
        "excludedCapacityRows",
        "excludedCapacityLineSeries",
        "excludedCapacityModeOverall",
        "excludedCapacityModeSprintRows",
        "excludedCapacityModeTeamLineSeries",
        "effortSplitTotals",
        "excludedCapacityWarnings",
        "formatExcludedPoints",
        "toggleExcludedCapacityEpicKey",
        "clearExcludedCapacityEpicSelection",
        "selectAllExcludedCapacityEpics",
        "toggleEffortSplitBucket"
    ],
    "C": [
        "priorityTeamIds",
        "priorityRows",
        "priorityRadar",
        "statsTeamRows",
        "statsBarColumns",
        "statsTotals",
        "burnoutAssigneeOptions",
        "burnoutChartModel",
        "burnoutTotals",
        "burndownMetricIsStoryPoints",
        "formatBurndownValue",
        "buildBurnoutTaskFilter",
        "canRenderStatsPanel",
        "isLeadTimesFocusMode"
    ]
};
const INPUT_NAMES = [
    "BACKEND_URL",
    "activeGroupMissingComponents",
    "activeGroupTeamIds",
    "activeGroupTeamSet",
    "adHocEpicSet",
    "adHocEpicSignature",
    "burnoutAssigneeFilter",
    "burnoutCacheRef",
    "burnoutData",
    "capacityTasks",
    "cohortEndQuarter",
    "cohortStartQuarter",
    "excludedEpicSet",
    "getTeamInfo",
    "groupPreferences",
    "isAllTeamsSelected",
    "isCompletedSprintSelected",
    "issueEditStateRef",
    "issuePeopleStatsRevision",
    "normalizeEpicKey",
    "normalizeStatus",
    "perfCountersRef",
    "perfEnabled",
    "selectedSprintInfo",
    "selectedTeamSet",
    "setBurnoutAssigneeFilter",
    "setBurnoutData",
    "setBurnoutError",
    "setBurnoutLoading",
    "showStats",
    "statsView",
    "tasksFetched",
    "techProjectKeys",
    "EMPTY_ARRAY",
    "EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY",
    "activeGroup",
    "activeGroupAdHocCapacityEpics",
    "activeGroupId",
    "adminSettingsGate",
    "availableSprints",
    "burnoutQueryKey",
    "burnoutScopedTeamIds",
    "burnoutScopedTeamSignature",
    "cohortAssigneeFilter",
    "cohortCacheRef",
    "cohortData",
    "cohortExcludeAdHoc",
    "cohortExcludeCapacity",
    "cohortGroupBy",
    "cohortProjectFilter",
    "cohortQueryKey",
    "cohortScopedTeamSignature",
    "cohortSelectedRow",
    "cohortStatusToggles",
    "excludedCapacityCacheRef",
    "excludedCapacityChartMode",
    "excludedCapacityData",
    "excludedCapacityEndSprintId",
    "excludedCapacityEpicDropdownOpen",
    "excludedCapacityEpicDropdownRef",
    "excludedCapacityForceRefreshRef",
    "excludedCapacityIsolatedTeam",
    "excludedCapacityRefreshNonce",
    "excludedCapacitySelectedEpicKeys",
    "excludedCapacityStartSprintId",
    "projectTrackCapacitySide",
    "projectTrackExcludeAdHoc",
    "projectTrackExcludeExcludedCapacity",
    "projectTrackMode",
    "projectTrackPhaseAbortRef",
    "projectTrackPhaseCacheRef",
    "projectTrackPhaseData",
    "selectedSprint",
    "setBurnoutTaskFilter",
    "setCohortAssigneeFilter",
    "setCohortData",
    "setCohortError",
    "setCohortLoading",
    "setCohortProjectFilter",
    "setCohortSelectedRow",
    "setEffortSplitVisibleBuckets",
    "setExcludedCapacityData",
    "setExcludedCapacityEndSprintId",
    "setExcludedCapacityEpicDropdownOpen",
    "setExcludedCapacityError",
    "setExcludedCapacityIsolatedTeam",
    "setExcludedCapacityLoading",
    "setExcludedCapacitySelectedEpicKeys",
    "setExcludedCapacityStartSprintId",
    "setProjectTrackPhaseData",
    "setProjectTrackPhaseError",
    "setProjectTrackPhaseLoading",
    "teamNameById",
    "teamOptions",
    "trackApiResult",
    "burndownMetric",
    "burnoutChartRef",
    "burnoutIssueWeightByKey",
    "burnoutTaskStatusByIssueKey",
    "burnoutTaskTeamByIssueKey",
    "effectivePriorityWeightMap",
    "effectiveStatsData",
    "isBurnoutClosedStatus",
    "priorityAxis",
    "priorityOrder",
    "resolveStatsTeamColor"
];
const EFFECT_DEPS = [
    "[ showStats, statsView, selectedSprintInfo?.name, tasksFetched, burnoutQueryKey, burnoutScopedTeamSignature, burnoutIssueKeysSignature, isCompletedSprintSelected, groupPreferences.onboardingRequired, issuePeopleStatsRevision ]",
    "[burnoutData, burnoutAssigneeFilter]",
    "[showStats, statsView]",
    "[selectedSprintInfo?.name, burnoutAssigneeFilter, burnoutQueryKey]",
    "[showStats, statsView, cohortStartQuarter, cohortEndQuarter, cohortQueryKey, cohortScopedTeamSignature, burnoutScopedTeamSignature, activeGroupMissingComponents, adHocEpicSignature, groupPreferences.onboardingRequired, adminSettingsGate.status, issuePeopleStatsRevision]",
    "[cohortProjectFilter, cohortProjectOptions]",
    "[cohortAssigneeFilter, cohortAssigneeOptions]",
    "[cohortGridModel, cohortSelectedRow]",
    "[ excludedCapacitySprintOptions, excludedCapacityDefaultRange, excludedCapacityStartSprintId, excludedCapacityEndSprintId ]",
    "[ showStats, statsView, excludedCapacityQueryKey, excludedCapacitySprintIdsSignature, excludedCapacityScopedTeamSignature, excludedCapacityEpicOptions, adHocEpicSignature, activeGroupId, activeGroupTeamIds.length, excludedCapacityRefreshNonce, groupPreferences.onboardingRequired, adminSettingsGate.status ]",
    "[ showStats, statsView, projectTrackMode, projectTrackPhaseSignature, ]",
    "[excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]",
    "[excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]",
    "[statsView, excludedCapacityChartMode, excludedCapacityIsolatedTeam, excludedCapacityIsolatedSeries]",
    "[excludedCapacityEpicDropdownOpen]",
];
function loadHooks() {
    const code = esbuild.buildSync({entryPoints:[path.join(__dirname,'../frontend/src/stats/useStatsData.js')],bundle:true,write:false,format:'cjs',platform:'node',external:['react']}).outputFiles[0].text;
    const module = {exports:{}};
    new Function('module','exports','require',code)(module,module.exports,require);
    return module.exports;
}
function inputs() {
    const value = Object.fromEntries(INPUT_NAMES.map(name => [name, name.startsWith('set') ? () => {} : name.endsWith('Ref') ? {current:{}} : null]));
    Object.assign(value, {
        BACKEND_URL:'http://synthetic', EMPTY_ARRAY:[], EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY:3,
        activeGroupTeamIds:[], activeGroupMissingComponents:[], activeGroupAdHocCapacityEpics:[], activeGroupTeamSet:new Set(),
        selectedTeamSet:new Set(), techProjectKeys:new Set(), excludedEpicSet:new Set(), adHocEpicSet:new Set(),
        teamNameById:new Map(), teamOptions:[], capacityTasks:[], availableSprints:[],
        burnoutTaskTeamByIssueKey:new Map(), burnoutTaskStatusByIssueKey:new Map(), burnoutIssueWeightByKey:new Map(),
        burnoutScopedTeamIds:[], groupPreferences:{onboardingRequired:false}, adminSettingsGate:{status:'clear'},
        isAllTeamsSelected:true, showStats:false, statsView:'teams', burnoutAssigneeFilter:'all', cohortAssigneeFilter:'all', cohortProjectFilter:'all',
        cohortStartQuarter:'2026Q1', cohortEndQuarter:'2026Q1', cohortGroupBy:'quarter', cohortStatusToggles:{},
        cohortExcludeAdHoc:false, cohortExcludeCapacity:true, projectTrackMode:'epic', projectTrackCapacitySide:'all',
        excludedCapacityStartSprintId:'', excludedCapacityEndSprintId:'', burndownMetric:'storyPoints',
        priorityAxis:[], priorityOrder:{}, effectivePriorityWeightMap:{},
        getTeamInfo:()=>({id:'synthetic-team',name:'Synthetic'}), normalizeStatus:x=>x, normalizeEpicKey:x=>x,
        isBurnoutClosedStatus:()=>false, resolveStatsTeamColor:()=> '#123456', trackApiResult:()=>{},
    });
    value.scope = Object.fromEntries(["activeGroupId","selectedSprint","selectedSprintInfo","isAllTeamsSelected","selectedTeamSet","teamNameById","teamOptions","capacityTasks","techProjectKeys","excludedEpicSet","adHocEpicSet","adHocEpicSignature"].map(name=>[name,value[name]]));
    return value;
}
for (const layer of ['A','B','C']) test('Statistics layer '+layer+' preserves its exact flat return contract', () => {
    const hooks=loadHooks(); let result;
    function Probe(){ result=hooks['useStatsDerived'+layer](inputs());return null; }
    assert.equal(renderToString(React.createElement(Probe)), '');
    assert.deepEqual(Object.keys(result).sort(), EXPECTED[layer].slice().sort());
    if(layer==='A') {assert.equal(result.effectiveStatsData,null);assert.equal(result.burnoutTaskTeamByIssueKey.size,0);}
    if(layer==='B') {assert.deepEqual(result.excludedCapacitySprintRange,[]);assert.equal(result.effortSplitSprintLabel,'No sprint range selected');}
    if(layer==='C') {assert.equal(result.canRenderStatsPanel,false);assert.equal(result.isLeadTimesFocusMode,false);}
});
test('Statistics layers preserve all fifteen retained effect dependencies and remain separate', () => {
    const source=fs.readFileSync(path.join(__dirname,'../frontend/src/stats/useStatsData.js'),'utf8');
    assert.equal((source.match(/useEffect\(\(\) =>/g)||[]).length,15);
    for(const dep of EFFECT_DEPS) assert.ok(source.replace(/\s+/g,' ').includes(dep), 'Missing frozen dependency '+dep);
    for(const layer of ['A','B','C']) assert.equal((source.match(new RegExp('useStatsDerived'+layer+'\\(', 'g'))||[]).length,1);
    assert.ok(source.includes('perfCountersRef.current.statsBuild'));
    for(const term of ['requestBurnoutStats(', 'requestEpicCohortStats(', 'requestExcludedCapacityStatsSource(', 'requestProjectTrackPhaseDurations(', 'isCurrentAggregateRead(readToken)', 'EXCLUDED_CAPACITY_STATS_SOURCE_CONCURRENCY']) assert.ok(source.includes(term),term);
    for(const term of ['localStorage','sessionStorage','Authorization','X-CSRF-Token','X-Requested-With','fetch(']) assert.equal(source.includes(term),false,term);
});

function renderLayer(layer, value) {
    const hooks = loadHooks();
    let result;
    function Probe() { result = hooks['useStatsDerived' + layer](value); return null; }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

test('Statistics layer A derives maps from included scoped tasks and preserves query scope', () => {
    const value = inputs();
    value.scope.capacityTasks = [
        { key:'DEMO-1', fields:{epicKey:'DEMO-E1',status:{name:'Open'},customfield_10004:3} },
        { key:'DEMO-2', fields:{epicKey:'DEMO-E2',status:{name:'Done'},customfield_10004:8} },
    ];
    value.scope.excludedEpicSet = new Set(['DEMO-E2']);
    value.scope.selectedSprintInfo = {name:'Synthetic Sprint'};
    value.activeGroupTeamIds = ['synthetic-team'];
    value.activeGroupTeamSet = new Set(value.activeGroupTeamIds);
    const result = renderLayer('A', value);
    assert.deepEqual([...result.burnoutIssueWeightByKey], [['DEMO-1',3]]);
    assert.deepEqual([...result.burnoutTaskStatusByIssueKey], [['DEMO-1','Open']]);
    assert.deepEqual([...result.burnoutTaskTeamByIssueKey], [['DEMO-1',{id:'synthetic-team',name:'Synthetic'}]]);
    assert.deepEqual(result.burnoutScopedTeamIds, ['synthetic-team']);
    assert.equal(result.burnoutQueryKey, 'Synthetic Sprint::inSprint::synthetic-team::DEMO-1');
    assert.equal(result.cohortQueryKey, '2026Q1::2026Q1::synthetic-team::no-components::no-adhoc');
});

test('Statistics layer B preserves explicit sprint range and sorted excluded epic options', () => {
    const value = inputs();
    value.availableSprints = [
        {id:'s2',name:'Second',startDate:'2026-02-01',endDate:'2026-02-14'},
        {id:'s1',name:'First',startDate:'2026-01-01',endDate:'2026-01-14'},
    ];
    value.excludedCapacityStartSprintId = 's1';
    value.excludedCapacityEndSprintId = 's2';
    value.scope.excludedEpicSet = new Set(['DEMO-E2','NO_EPIC','DEMO-E1']);
    value.excludedCapacitySelectedEpicKeys = ['DEMO-E1','DEMO-E2'];
    const result = renderLayer('B', value);
    assert.deepEqual(result.excludedCapacitySprintRange.map(sprint=>sprint.id), ['s1','s2']);
    assert.equal(result.effortSplitSprintLabel, 'First - Second');
    assert.deepEqual(result.excludedCapacityEpicOptions, ['DEMO-E1','DEMO-E2']);
    assert.deepEqual(result.excludedCapacityEffectiveFilters, ['DEMO-E1','DEMO-E2']);
});

test('Statistics layer C preserves Lead Times task-list focus and burndown formatting', () => {
    const value = inputs();
    value.showStats = true;
    value.statsView = 'cohort';
    const result = renderLayer('C', value);
    assert.equal(result.canRenderStatsPanel, true);
    assert.equal(result.isLeadTimesFocusMode, true);
    assert.equal(result.burndownMetricIsStoryPoints, true);
    assert.equal(result.formatBurndownValue(1.25), '1.3');
});
