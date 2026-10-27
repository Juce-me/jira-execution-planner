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
        "cohortDisplayedIssues",
        "cohortScope",
        "cohortFetchedCount",
        "cohortAwaitingMode",
        "cohortLastNShortfall",
        "excludedCapacitySprintOptions",
        "excludedCapacitySprintRange",
        "effortSplitSprintLabel",
        "excludedCapacityEpicOptions",
        "projectTrackSeries",
        "projectTrackTotals",
        "projectTrackBreakdown",
        "projectTrackColumnSplit",
        "projectTrackSingleTeam",
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
    "automaticRefreshRef",
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
    "cohortMode",
    "cohortClosedStartQuarter",
    "cohortClosedEndQuarter",
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
    "cohortCacheRef",
    "cohortData",
    "cohortExcludeAdHoc",
    "cohortExcludeCapacity",
    "cohortGroupBy",
    "cohortLastN",
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
    "[showStats, statsView, cohortMode, cohortStartQuarter, cohortEndQuarter, cohortClosedStartQuarter, cohortClosedEndQuarter, cohortQueryKey, cohortScopedTeamSignature, burnoutScopedTeamSignature, activeGroupMissingComponents, adHocEpicSignature, groupPreferences.onboardingRequired, adminSettingsGate.status, issuePeopleStatsRevision]",
    "[cohortProjectFilter, cohortProjectOptions, cohortAwaitingMode]",
    "[cohortGridModel, cohortSelectedRow, cohortAwaitingMode]",
    "[ excludedCapacitySprintOptions, excludedCapacityDefaultRange, excludedCapacityStartSprintId, excludedCapacityEndSprintId ]",
    "[ showStats, statsView, excludedCapacityQueryKey, excludedCapacitySprintIdsSignature, excludedCapacityScopedTeamSignature, excludedCapacityEpicOptions, adHocEpicSignature, activeGroupId, activeGroupTeamIds.length, excludedCapacityRefreshNonce, groupPreferences.onboardingRequired, adminSettingsGate.status ]",
    "[ showStats, statsView, projectTrackMode, projectTrackPhaseSignature, ]",
    "[excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]",
    "[excludedCapacitySelectedEpicKeys, excludedCapacityEpicOptions]",
    "[statsView, excludedCapacityChartMode, excludedCapacityIsolatedTeam, excludedCapacityIsolatedSeries]",
    "[excludedCapacityEpicDropdownOpen]",
];
function loadHooks({ exposeAutomatic = false, reactRuntime = null } = {}) {
    const sourcePath = path.join(__dirname, '../frontend/src/stats/useStatsData.js');
    const input = exposeAutomatic ? { stdin: { contents: fs.readFileSync(sourcePath, 'utf8') + '\nexport {runAutomaticStatsRead};', resolveDir: path.dirname(sourcePath), sourcefile: sourcePath, loader: 'js' } } : { entryPoints: [sourcePath] };
    const code = esbuild.buildSync({...input,bundle:true,write:false,format:'cjs',platform:'node',external:['react']}).outputFiles[0].text;
    const module = {exports:{}};
    new Function('module','exports','require',code)(module,module.exports,name=>name==='react'&&reactRuntime?reactRuntime:require(name));
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
        isAllTeamsSelected:true, showStats:false, statsView:'teams', burnoutAssigneeFilter:'all', cohortProjectFilter:'all',
        cohortStartQuarter:'2026Q1', cohortEndQuarter:'2026Q1', cohortGroupBy:'quarter', cohortStatusToggles:{},
        cohortMode:'created', cohortLastN:30, cohortClosedStartQuarter:'2026Q1', cohortClosedEndQuarter:'2026Q1',
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
test('Statistics layers preserve all fourteen retained effect dependencies and remain separate', () => {
    const source=fs.readFileSync(path.join(__dirname,'../frontend/src/stats/useStatsData.js'),'utf8');
    assert.equal((source.match(/useEffect\(\(\) =>/g)||[]).length,14);
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

test('Project Track single-team summary follows header scope rather than populated rows', () => {
    const value = inputs();
    value.activeGroupTeamIds = ['team-alpha', 'team-beta'];
    assert.equal(renderLayer('B', value).projectTrackSingleTeam, false);
    value.scope.isAllTeamsSelected = false;
    value.scope.selectedTeamSet = new Set(['team-alpha']);
    assert.equal(renderLayer('B', value).projectTrackSingleTeam, true);
    value.scope.selectedTeamSet = new Set(['team-alpha', 'team-beta']);
    assert.equal(renderLayer('B', value).projectTrackSingleTeam, false);
    value.scope.selectedTeamSet = new Set();
    assert.equal(renderLayer('B', value).projectTrackSingleTeam, false);
    value.scope.isAllTeamsSelected = true;
    value.activeGroupTeamIds = ['team-alpha'];
    assert.equal(renderLayer('B', value).projectTrackSingleTeam, true);
});

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

for (const [source, cached, expected] of [['stats_burnout', false, 'unknown'], ['stats_cohort', false, 'forced'], ['stats_cohort', true, 'cached'], ['stats_excluded_capacity', false, 'forced']]) test(`silent automatic ${source} accepts once with ${expected} provenance`, async () => {
    const {runAutomaticStatsRead}=loadHooks({exposeAutomatic:true}), prior=global.window; global.window={setTimeout:(fn,ms)=>setTimeout(fn,ms===120?1:30000),clearTimeout};
    let leases=0, commits=0, settlements=0;
    const outcome=await new Promise(resolve=>runAutomaticStatsRead({job:{signal:new AbortController().signal,shouldApply:()=>true},settle(value){settlements++;resolve(value);}},source,{current:{beginRead(){leases++;return {};},finishRead(){leases--;},isCurrentAggregateRead:()=>true}},async()=>new Response(JSON.stringify({data:{issues:[]},cached})),()=>commits++));
    await new Promise(resolve=>setTimeout(resolve,5)); global.window=prior;
    assert.equal(outcome[0].checkKind,expected); assert.equal(commits,1);assert.equal(settlements,1);assert.equal(leases,0);
});
for (const retired of ['blur','cleanup','failure']) test(`automatic Stats ${retired} never publishes held data`, async () => {
    const {runAutomaticStatsRead}=loadHooks({exposeAutomatic:true}), prior=global.window; global.window={setTimeout:(fn,ms)=>setTimeout(fn,ms===120?1:30000),clearTimeout};
    let leases=0, commits=0, apply=true, release; const gate=new Promise(resolve=>release=resolve); const controller=new AbortController();
    let clean; const pending=new Promise(resolve=>{clean=runAutomaticStatsRead({job:{signal:controller.signal,shouldApply:()=>apply},settle:resolve},'stats_cohort',{current:{beginRead(){leases++;return {};},finishRead(){leases--;},isCurrentAggregateRead:()=>true}},async()=>{await gate;return new Response('{}',{status:retired==='failure'?500:200});},()=>commits++);});
    await new Promise(resolve=>setTimeout(resolve,5)); if(retired==='blur'){apply=false;controller.abort();}if(retired==='cleanup')clean(); release();
    const checks=await pending;await new Promise(resolve=>setTimeout(resolve,5));global.window=prior;
    assert.equal(commits,0);assert.equal(leases,0);assert.equal(checks[0].status,retired==='failure'?'failed':'ignored');
});

for (const view of ['burnout','cohort']) test(`Statistics ${view} manual identical cached payload clears automatic-only facet hold and records no nonexistent read`, async () => {
    const effects=[],refs=[];let cursor=0;
    const fakeReact={useMemo:fn=>fn(),useRef:initial=>refs[cursor++]||(refs[cursor-1]={current:initial}),useEffect:fn=>effects.push(fn)};
    const hooks=loadHooks({reactRuntime:fakeReact}),value=inputs(),changes=[];let recorded=0;
    Object.assign(value,{showStats:true,statsView:view,tasksFetched:true,burnoutAssigneeFilter:'missing',cohortProjectFilter:'missing',cohortQueryKey:'synthetic-cohort',burnoutQueryKey:'synthetic-burnout',burnoutIssueKeys:['DEMO-1'],burnoutScopedTeamIds:[],issueEditStateRef:{current:{beginRead:()=>({}),finishRead(){},isCurrentAggregateRead:()=>true}},setBurnoutAssigneeFilter:v=>changes.push(['burnout',v]),setCohortAssigneeFilter:v=>changes.push(['assignee',v]),setCohortProjectFilter:v=>changes.push(['project',v])});
    value.scope.capacityTasks=[{key:'DEMO-1',fields:{epicKey:'DEMO-E1',status:{name:'Open'},customfield_10004:3}}];value.scope.selectedSprintInfo={name:'Synthetic Sprint'};
    const payload=view==='burnout'?{issuesMeta:[],events:[],assignees:[]}:{issues:[],meta:{warnings:[]}};
    value.setBurnoutData=data=>value.burnoutData=data;value.setCohortData=data=>value.cohortData=data;
    let settleRead;const settled=new Promise(resolve=>settleRead=resolve);
    value.automaticRefreshRef={current:{source:view==='burnout'?'stats_burnout':'stats_cohort',job:{signal:new AbortController().signal,shouldApply:()=>true},settle:settleRead},createExplicitRecorder:()=>{recorded++;return ()=>{};}};
    const layer=view==='burnout'?'A':'B',render=()=>{cursor=0;effects.length=0;return hooks['useStatsDerived'+layer](value);};
    const priorFetch=global.fetch,priorWindow=global.window;
    global.fetch=async()=>new Response(JSON.stringify({data:payload,cached:false}));global.window={setTimeout:(fn,ms)=>setTimeout(fn,ms===120?1:30000),clearTimeout};
    try {
        render();const acquisition=effects.find(fn=>fn.toString().includes('const automatic')&&fn.toString().includes(view==='burnout'?'stats_burnout':'stats_cohort'));const cleanup=acquisition();await settled;
        render();effects.filter(fn=>fn.toString().includes(view==='burnout'?'automaticBurnoutDataRef.current === burnoutData':'automaticCohortDataRef.current === cohortData')).forEach(fn=>fn());assert.equal(changes.length,0,'automatic acceptance holds chosen facets');
        value.automaticRefreshRef.current=null;render();effects.find(fn=>fn.toString().includes('const automatic')&&fn.toString().includes(view==='burnout'?'stats_burnout':'stats_cohort'))();
        render();effects.filter(fn=>fn.toString().includes(view==='burnout'?'automaticBurnoutDataRef.current === burnoutData':'automaticCohortDataRef.current === cohortData')).forEach(fn=>fn());
        assert.ok(changes.length>0,'manual cache identity clears hold and resumes ordinary pruning');assert.equal(recorded,0,'cache-only acceptance has no network observation');cleanup();
    } finally {global.fetch=priorFetch;global.window=priorWindow;}
});

test('Project Track manual identical range-cache acceptance clears automatic phase/facet hold', async () => {
    const effects=[],refs=[];let cursor=0;
    const fakeReact={useMemo:fn=>fn(),useRef:initial=>refs[cursor++]||(refs[cursor-1]={current:initial}),useEffect:fn=>effects.push(fn)};
    const hooks=loadHooks({reactRuntime:fakeReact}),value=inputs(),selections=[];let phaseLoading=0;
    Object.assign(value,{showStats:true,statsView:'projectTrack',selectedSprint:'s1',availableSprints:[{id:'s1',name:'Synthetic Sprint',startDate:'2026-05-01',endDate:'2026-05-14'}],excludedCapacityStartSprintId:'s1',excludedCapacityEndSprintId:'s1',excludedCapacitySelectedEpicKeys:['MISSING'],projectTrackCapacitySide:'both',projectTrackExcludeExcludedCapacity:false,setExcludedCapacitySelectedEpicKeys:v=>selections.push(v),setProjectTrackPhaseLoading:v=>{if(v)phaseLoading++;},issueEditStateRef:{current:{beginRead:()=>({}),finishRead(){},isCurrentAggregateRead:()=>true}}});
    const payload={issues:[{key:'DEMO-1',fields:{epicKey:'DEMO-E1',epicStatus:'In Progress',epicProjectTrack:'Committed',customfield_10101:[{id:'s1',name:'Synthetic Sprint'}],customfield_10004:3,teamId:'synthetic-team',teamName:'Synthetic',status:{name:'Open'}}}],meta:{warnings:[]}};
    value.scope.selectedSprint='s1';value.scope.excludedEpicSet=new Set(['DEMO-E1']);value.scope.teamNameById=new Map([['synthetic-team','Synthetic']]);value.setExcludedCapacityData=data=>value.excludedCapacityData=data;
    let settleRead;const settled=new Promise(resolve=>settleRead=resolve);value.automaticRefreshRef={current:{source:'stats_excluded_capacity',job:{signal:new AbortController().signal,shouldApply:()=>true},settle:settleRead}};
    const render=()=>{cursor=0;effects.length=0;return hooks.useStatsDerivedB(value);},priorFetch=global.fetch,priorWindow=global.window;
    global.fetch=async()=>new Response(JSON.stringify({data:payload,cached:false}));global.window={setTimeout:(fn,ms)=>setTimeout(fn,ms===120?1:30000),clearTimeout};
    const acquisition=()=>effects.find(fn=>fn.toString().includes('const automatic')&&fn.toString().includes('stats_excluded_capacity'));
    const pruning=()=>effects.filter(fn=>fn.toString().includes('automaticExcludedDataRef.current?.data === excludedCapacityData')&&!fn.toString().includes('projectTrackPhaseSignature')).forEach(fn=>fn());
    try {
        render();const cleanup=acquisition()();await settled;render();pruning();assert.equal(selections.length,0);
        const held=value.excludedCapacityData;value.automaticRefreshRef.current=null;render();acquisition()();assert.equal(value.excludedCapacityData,held,'same cached range payload');render();pruning();assert.ok(selections.some(v=>Array.isArray(v)&&v.length===0));
        const phase=effects.find(fn=>fn.toString().includes('projectTrackPhaseSignature')&&fn.toString().includes('automaticExcludedDataRef'));const phaseCleanup=phase();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(phaseLoading,1,'deliberate cached-source lifecycle resumes phase path');phaseCleanup?.();cleanup();
    } finally {global.fetch=priorFetch;global.window=priorWindow;}
});

for (const retired of [false,true]) test(`Excluded automatic selected chunk ${retired?'retires without writes':'preserves untouched wider-range chunk'}`, async () => {
    const effects=[],fakeReact={useMemo:fn=>fn(),useRef:initial=>({current:initial}),useEffect:fn=>effects.push(fn)},hooks=loadHooks({reactRuntime:fakeReact}),value=inputs(),calls=[];let current=true,accepted=null;
    Object.assign(value,{showStats:true,statsView:'excludedCapacity',availableSprints:[{id:'s1',name:'First',startDate:'2026-04-01'},{id:'s2',name:'Selected',startDate:'2026-05-01'}],excludedCapacityStartSprintId:'s1',excludedCapacityEndSprintId:'s2',setExcludedCapacityData:data=>accepted=data,issueEditStateRef:{current:{beginRead:()=>({}),finishRead(){},isCurrentAggregateRead:()=>true}}});
    value.scope.selectedSprint='s2';value.scope.excludedEpicSet=new Set(['DEMO-E1']);const held={issues:[{key:'HELD-1',fields:{epicKey:'DEMO-E1',customfield_10004:5}}],meta:{warnings:[]}},remote={issues:[{key:'REMOTE-2',fields:{epicKey:'DEMO-E1',customfield_10004:11}}],meta:{warnings:[]}};
    value.excludedCapacityCacheRef.current['sprint::s1::all']=held;
    let settleRead;const settled=new Promise(resolve=>settleRead=resolve);value.automaticRefreshRef={current:{source:'stats_excluded_capacity',job:{signal:new AbortController().signal,shouldApply:()=>current},settle:settleRead}};
    const priorFetch=global.fetch,priorWindow=global.window;global.window={setTimeout:(fn,ms)=>setTimeout(fn,ms===120?1:30000),clearTimeout};global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));if(retired)current=false;return new Response(JSON.stringify({data:remote,cached:false}));};
    try {
        hooks.useStatsDerivedB(value);const cleanup=effects.find(fn=>fn.toString().includes('const automatic')&&fn.toString().includes('stats_excluded_capacity'))();const checks=await settled;
        assert.deepEqual(calls,[{sprintIds:['s2'],teamIds:[],refresh:true}]);assert.equal(value.excludedCapacityCacheRef.current['sprint::s1::all'],held);
        if(retired){assert.equal(accepted,null);assert.equal(value.excludedCapacityCacheRef.current['sprint::s2::all'],undefined);assert.equal(checks[0].status,'ignored');}
        else{assert.deepEqual(accepted.issues.map(issue=>issue.key).sort(),['HELD-1','REMOTE-2']);assert.equal(checks[0].checkKind,'forced');}
        cleanup();
    } finally {global.fetch=priorFetch;global.window=priorWindow;}
});

test('outside-range automatic Stats defers quietly: no read, no check, source settles without pending', async () => {
    const {createStatsFreshnessAdapter}=await import('../frontend/src/dashboardFreshnessAdapters.js'),{createDashboardFreshnessController}=await import('../frontend/src/dashboardFreshnessController.js');
    const effects=[],fakeReact={useMemo:fn=>fn(),useRef:initial=>({current:initial}),useEffect:fn=>effects.push(fn)},hooks=loadHooks({reactRuntime:fakeReact}),value=inputs(),priorFetch=global.fetch;let reads=0,commits=0,nonces=0;
    Object.assign(value,{showStats:true,statsView:'projectTrack',availableSprints:[{id:'s1',name:'Displayed',startDate:'2026-05-01'}],excludedCapacityStartSprintId:'s1',excludedCapacityEndSprintId:'s1',setExcludedCapacityData:()=>commits++});value.scope.selectedSprint='outside';value.automaticRefreshRef={current:null};
    const env={surface:'stats',contextKey:'synthetic-outside-range',sessionEpoch:1,focused:true,bootstrapReady:true,authReady:true,ownerBusy:false,blocked:false,terminalAuth:false};
    const input={statsView:'projectTrack',automaticRefreshRef:value.automaticRefreshRef,startStatsRefresh(){nonces++;effects.length=0;hooks.useStatsDerivedB(value);effects.find(fn=>fn.toString().includes('const automatic')&&fn.toString().includes('stats_excluded_capacity'))();}};
    const adapter=createStatsFreshnessAdapter(()=>input,{}),controller=createDashboardFreshnessController({readEnvironment:()=>env,readAdapter:()=>adapter,notify(){},now:()=>100});global.fetch=async()=>{reads++;throw new Error('unrelated Sprint must never be acquired');};
    try {
        let ended=false;const pending=controller.request({reason:'long_return',absenceStartedAtMs:0}).then(()=>ended=true);await new Promise(resolve=>setTimeout(resolve,30));
        assert.equal(ended,true,'no indefinitely running adapter');await pending;assert.equal(controller.getState().running,false);assert.equal(controller.getState().pending,false);assert.deepEqual(controller.getState().checks,{});assert.equal(reads,0);assert.equal(commits,0);assert.deepEqual(value.excludedCapacityCacheRef.current,{});assert.equal(nonces,1);for(let n=0;n<3;n++)await controller.update();assert.equal(nonces,1,'a denied (deferred) source stays settled; update never retries it');assert.equal(reads,0);assert.equal(controller.getState().running,false);assert.equal(controller.getState().pending,false);
    } finally {controller.dispose();global.fetch=priorFetch;}
});

function effectRuntime() {
    let cursor = 0;
    const slots = [], pending = [];
    return {
        react: {
            useRef(initial) { const id = cursor++; return slots[id] ||= { current: initial }; },
            useMemo(fn, deps) {
                const id = cursor++, old = slots[id];
                if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) slots[id] = { deps, value: fn() };
                return slots[id].value;
            },
            useEffect(fn, deps) {
                const id = cursor++, old = slots[id];
                if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) pending.push(() => {
                    old?.cleanup?.(); slots[id] = { deps, cleanup: fn() };
                });
            }
        },
        render(fn) { cursor = 0; fn(); pending.splice(0).forEach(effect => effect()); },
        close() { slots.forEach(slot => slot?.cleanup?.()); }
    };
}
function automaticStatsInputs(view) {
    const value = inputs();
    Object.assign(value, { showStats: true, statsView: view, tasksFetched: true, issuePeopleStatsRevision: 0, excludedCapacityRefreshNonce: 0,
        availableSprints: [{ id: 's1', name: 'First', startDate: '2026-04-01' }, { id: 's2', name: 'Selected', startDate: '2026-05-01' }],
        excludedCapacityStartSprintId: 's1', excludedCapacityEndSprintId: 's2', activeGroupTeamIds: ['synthetic-team'], activeGroupTeamSet: new Set(['synthetic-team']),
        issueEditStateRef: { current: { leases: 0, beginRead() { this.leases++; return {}; }, finishRead() { this.leases--; }, isCurrentAggregateRead: () => true } },
        automaticRefreshRef: { current: null } });
    Object.assign(value.scope, { selectedSprint: 's2', selectedSprintInfo: { name: 'Selected' }, excludedEpicSet: new Set(),
        capacityTasks: [{ key: 'DEMO-1', fields: { epicKey: 'DEMO-E1', status: { name: 'Open' }, customfield_10004: 3 } }] });
    return value;
}
const nextStatsTick = () => new Promise(resolve => setTimeout(resolve, 20));

test('partial manual range cannot become a forced automatic check without an accepted chart', async () => {
    const { createStatsFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const { createDashboardFreshnessController } = await import('../frontend/src/dashboardFreshnessController.js');
    const runtime = effectRuntime(), hooks = loadHooks({ reactRuntime: runtime.react }), value = automaticStatsInputs('excludedCapacity');
    value.scope.excludedEpicSet = new Set(['DEMO-E1']);
    let commits = 0, requests = [];
    value.setExcludedCapacityData = data => { commits++; value.excludedCapacityData = data; };
    const priorFetch = global.fetch, priorWindow = global.window;
    global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms === 120 ? 1 : ms), clearTimeout };
    global.fetch = async (url, options) => {
        const sprint = JSON.parse(options.body).sprintIds[0]; requests.push(sprint);
        return sprint === 's1' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ data: { issues: [], meta: { warnings: [] } }, cached: false }));
    };
    let controller;
    try {
        runtime.render(() => hooks.useStatsDerivedB(value)); await nextStatsTick();
        const held = value.excludedCapacityData;
        assert.ok(held, 'manual partial chart exists');
        assert.equal(value.excludedCapacityCacheRef.current['sprint::s1::synthetic-team'], undefined);
        commits = 0; requests = [];
        const environment = { surface: 'stats', contextKey: 'synthetic-range', sessionEpoch: 0, focused: true, bootstrapReady: true, authReady: true };
        const adapter = createStatsFreshnessAdapter(() => ({ statsView: value.statsView, automaticRefreshRef: value.automaticRefreshRef,
            startStatsRefresh() { value.excludedCapacityRefreshNonce++; runtime.render(() => hooks.useStatsDerivedB(value)); } }), {});
        controller = createDashboardFreshnessController({ readEnvironment: () => environment, readAdapter: () => adapter, notify() {}, now: Date.now });
        await controller.request({ reason: 'long_return', absenceStartedAtMs: 0 });
        assert.deepEqual(requests, ['s2'], 'one selected chunk only');
        assert.equal(commits, 0); assert.equal(value.excludedCapacityData, held);
        assert.equal(controller.getState().checks.stats_excluded_capacity?.checkKind === 'forced', false);
        assert.equal(controller.getState().failure !== null, true, 'failed visible-range acceptance settles once');
        assert.equal(value.issueEditStateRef.current.leases, 0);
    } finally { controller?.dispose(); runtime.close(); global.fetch = priorFetch; global.window = priorWindow; }
});

test('Burnout membership effect replacement retires one attempt without duplicate reads or late chart writes', async () => {
    const { createStatsFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const { createDashboardFreshnessController } = await import('../frontend/src/dashboardFreshnessController.js');
    const runtime = effectRuntime(), hooks = loadHooks({ reactRuntime: runtime.react }), value = automaticStatsInputs('burnout');
    let release, requests = 0, commits = 0;
    const bodies = [];
    const delayed = new Promise(resolve => release = resolve);
    value.setBurnoutData = () => commits++;
    const render = () => runtime.render(() => { Object.assign(value, hooks.useStatsDerivedA(value)); hooks.useStatsDerivedB(value); });
    const priorFetch = global.fetch, priorWindow = global.window;
    global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms === 120 ? 1 : ms), clearTimeout };
    global.fetch = async (url, options) => { requests++; bodies.push(JSON.parse(options.body)); await delayed; return new Response(JSON.stringify({ data: { issuesMeta: [], events: [], assignees: [] } })); };
    const environment = { surface: 'stats', contextKey: 'synthetic-burnout', sessionEpoch: 0, focused: true, bootstrapReady: true, authReady: true };
    const adapter = createStatsFreshnessAdapter(() => ({ statsView: 'burnout', automaticRefreshRef: value.automaticRefreshRef,
        startStatsRefresh() { value.issuePeopleStatsRevision++; render(); } }), { refreshScope: async () => ['eng_product', 'eng_tech'].map(source => ({ source, status: 'ok', checkKind: 'forced', coverage: 'unknown', requestStartedAtMs: Date.now() })) });
    const controller = createDashboardFreshnessController({ readEnvironment: () => environment, readAdapter: () => adapter, notify() {}, now: Date.now });
    try {
        const pending = controller.request({ reason: 'long_return', absenceStartedAtMs: 0 }); await nextStatsTick(); assert.equal(requests, 1);
        value.scope.capacityTasks = [...value.scope.capacityTasks, { key: 'DEMO-2', fields: { epicKey: 'DEMO-E1', status: { name: 'Open' }, customfield_10004: 5 } }];
        render(); release(); await pending; await nextStatsTick();
        assert.equal(requests, 2, 'one bounded replacement resumes automatically with current membership'); assert.equal(commits, 1, 'only current membership publishes');
        assert.deepEqual(bodies.map(body => body.issueKeys), [['DEMO-1'], ['DEMO-1', 'DEMO-2']]);
        assert.equal(controller.getState().running, false);
        assert.equal(value.automaticRefreshRef.current, null); assert.equal(value.issueEditStateRef.current.leases, 0);
        assert.equal(controller.getState().checks.stats_burnout.checkKind, 'unknown');
        assert.equal(value.issueEditStateRef.current.leases, 0);
    } finally { release(); controller.dispose(); runtime.close(); global.fetch = priorFetch; global.window = priorWindow; }
});

for (const [view, gate] of [['burnout', 'onboarding'], ['cohort', 'onboarding'], ['cohort', 'pending'], ['excludedCapacity', 'onboarding'], ['excludedCapacity', 'missing'], ['excludedCapacity', 'no-config'], ['excludedCapacity', 'no-teams']]) {
    test(`automatic ${view} defers ${gate} without reads or clearing the held chart`, async () => {
        const runtime = effectRuntime(), hooks = loadHooks({ reactRuntime: runtime.react }), value = automaticStatsInputs(view);
        value.scope.excludedEpicSet = new Set(['DEMO-E1']);
        if (gate === 'onboarding') value.groupPreferences.onboardingRequired = true;
        if (gate === 'pending' || gate === 'missing') value.adminSettingsGate.status = gate;
        if (gate === 'no-config') value.scope.excludedEpicSet = new Set();
        if (gate === 'no-teams') { value.scope.activeGroupId = 'synthetic-group'; value.activeGroupTeamIds = []; }
        let reads = 0, commits = 0, settle;
        const outcome = new Promise(resolve => settle = resolve);
        const source = view === 'burnout' ? 'stats_burnout' : view === 'cohort' ? 'stats_cohort' : 'stats_excluded_capacity';
        value.automaticRefreshRef.current = { source, job: { signal: new AbortController().signal, shouldApply: () => true }, settle };
        value.setBurnoutData = value.setCohortData = value.setExcludedCapacityData = () => commits++;
        const priorFetch = global.fetch;
        global.fetch = async () => { reads++; throw new Error('blocked configuration must not acquire'); };
        try {
            runtime.render(() => hooks[view === 'burnout' ? 'useStatsDerivedA' : 'useStatsDerivedB'](value));
            assert.equal((await outcome)[0].status, 'ignored'); assert.equal(reads, 0); assert.equal(commits, 0);
        } finally { runtime.close(); global.fetch = priorFetch; }
    });
}

for (const [view, source, change] of [
    ['burnout', 'stats_burnout', value => { value.scope.selectedSprintInfo = { name: 'OtherSprint' }; }],
    ['cohort', 'stats_cohort', value => { value.cohortEndQuarter = '2026Q2'; value.cohortQueryKey = 'synthetic-cohort-2'; }],
    ['excludedCapacity', 'stats_excluded_capacity', value => { value.availableSprints = [...value.availableSprints, { id: 's3', name: 'Third', startDate: '2026-06-01' }]; value.excludedCapacityEndSprintId = 's3'; }],
]) for (const valid of [false, true]) {
    test(`user scope change during automatic ${view} job ${valid ? 'with a still-valid job is not double-fetched' : 'retired by the change falls through to the manual fetch'}`, async () => {
        const runtime = effectRuntime(), hooks = loadHooks({ reactRuntime: runtime.react }), value = automaticStatsInputs(view);
        if (view === 'excludedCapacity') value.scope.excludedEpicSet = new Set(['DEMO-E1']);
        const bodies = [];
        let apply = true;
        const render = () => runtime.render(() => { Object.assign(value, hooks.useStatsDerivedA(value)); hooks.useStatsDerivedB(value); });
        const priorFetch = global.fetch, priorWindow = global.window;
        global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms === 120 ? 1 : ms), clearTimeout };
        let release, gated = false; const gate = new Promise(resolve => release = resolve);
        global.fetch = async (url, options) => {
            bodies.push(JSON.parse(options.body));
            if (value.automaticRefreshRef.current && !gated) { gated = true; await gate; }
            return new Response(JSON.stringify({ data: view === 'burnout' ? { issuesMeta: [], events: [], assignees: [] } : { issues: [], meta: { warnings: [] } }, cached: false }));
        };
        try {
            render(); render(); await nextStatsTick();
            const base = bodies.length;
            value.automaticRefreshRef.current = { source, job: { signal: new AbortController().signal, shouldApply: () => apply }, settle() {} };
            value.issuePeopleStatsRevision++; value.excludedCapacityRefreshNonce++; render(); await nextStatsTick();
            assert.equal(bodies.length, base + 1, 'automatic job reads once');
            if (!valid) apply = false;
            change(value); render(); await nextStatsTick();
            if (valid) assert.equal(bodies.length, base + 1, 'valid job is not double-fetched');
            else {
                if (view === 'excludedCapacity') assert.ok(bodies.slice(base + 1).some(body => body.sprintIds.includes('s3')), 'new range chunk is fetched by the manual path');
                else assert.equal(bodies.length, base + 2, 'retired job falls through to the manual fetch');
                if (view === 'cohort') assert.notEqual(bodies[base + 1].refresh, true, 'second read is the manual path, not an automatic refresh');
                if (view === 'burnout') assert.equal(bodies[base + 1].sprint, 'OtherSprint');
            }
        } finally { release(); await nextStatsTick(); runtime.close(); await nextStatsTick(); global.fetch = priorFetch; global.window = priorWindow; }
    });
}

// ---- Lead Times modes (Task 6): request shape, keys, mode/data mismatch, Last N after filters ----
const cohortEpic = (key, { project = 'PROD', created = '2026-01-10', terminal = '2026-02-10', status = 'Done' } = {}) => ({
    key, projectKey: project, createdDate: created, terminalDate: terminal, status, jiraStatus: status, leadTimeDays: 30,
});
const closedStatusToggles = { done: true, open: false, killed: false, incomplete: false, postponed: false };
const lastNPayload = (issues, meta = {}) => ({ range: null, issues, meta: { warnings: [], mode: 'last_n', scope: 'components', windowCeiling: 200, windowFull: true, ...meta } });
const dayOf = (offset) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);

test('cohortQueryKey keeps the Created key and prefixes the closed modes; N is never part of a key', () => {
    const keyOf = (overrides) => renderLayer('A', Object.assign(inputs(), { cohortStartQuarter: '2026Q1', cohortEndQuarter: '2026Q2', cohortClosedStartQuarter: '2025Q4', cohortClosedEndQuarter: '2026Q1', cohortLastN: 30 }, overrides)).cohortQueryKey;
    const created = keyOf({ cohortMode: 'created' });
    assert.ok(created.startsWith('2026Q1::2026Q2::'), created);
    const suffix = created.split('::').slice(2).join('::');
    assert.equal(keyOf({ cohortMode: 'closed' }), `closed::2025Q4::2026Q1::${suffix}`);
    assert.equal(keyOf({ cohortMode: 'last_n' }), `last_n::::::${suffix}`);
    assert.equal(keyOf({ cohortMode: 'last_n', cohortLastN: 60 }), keyOf({ cohortMode: 'last_n', cohortLastN: 30 }));
});

test('Lead Times status chips: Created keeps five, the closed modes keep Done, Killed and Incomplete', () => {
    const keys = (mode) => renderLayer('B', Object.assign(inputs(), { cohortMode: mode, cohortLastN: 30, cohortClosedStartQuarter: '2026Q1', cohortClosedEndQuarter: '2026Q1' })).cohortStatusControls.map((item) => item.key);
    assert.deepEqual(keys('created'), ['done', 'open', 'killed', 'incomplete', 'postponed']);
    assert.deepEqual(keys('closed'), ['done', 'killed', 'incomplete']);
    assert.deepEqual(keys('last_n'), ['done', 'killed', 'incomplete']);
});

test('Last N shows the newest N Epics that pass the filters and reports a shortfall only with a full window', () => {
    const closedAndKilled = [
        ...Array.from({ length: 60 }, (_, index) => cohortEpic(`D-${index}`, { terminal: dayOf(index) })),
        ...Array.from({ length: 10 }, (_, index) => cohortEpic(`K-${index}`, { terminal: dayOf(100 + index), status: 'Killed' })),
    ];
    const render = (issues, overrides = {}, meta = {}) => renderLayer('B', Object.assign(inputs(), {
        cohortMode: 'last_n', cohortLastN: 30, cohortData: lastNPayload(issues, meta), cohortStatusToggles: closedStatusToggles,
        cohortExcludeCapacity: false, ...overrides,
    }));
    const full = render(closedAndKilled);
    assert.equal(full.cohortDisplayedIssues.length, 30);
    assert.deepEqual(full.cohortDisplayedIssues.slice(0, 2).map((item) => item.key), ['D-59', 'D-58']);
    assert.ok(full.cohortDisplayedIssues.every((item) => item.status === 'Done'), 'Killed toggled off must not use up N');
    assert.equal(full.cohortLastNShortfall, null);
    assert.equal(full.cohortSummary.total, 30);
    assert.equal(full.cohortFetchedCount, 70);
    assert.equal(full.cohortScope, 'components');

    const short = Array.from({ length: 40 }, (_, index) => cohortEpic(index < 20 ? `D-${index}` : `K-${index}`, { terminal: dayOf(index), status: index < 20 ? 'Done' : 'Killed' }));
    assert.deepEqual(render(short, {}, { windowCeiling: 120 }).cohortLastNShortfall, { shown: 20, requested: 30, ceiling: 120 });
    assert.equal(render(short, {}, { windowFull: false }).cohortLastNShortfall, null);
    assert.equal(render(short, { cohortMode: 'closed' }, { mode: 'closed', windowFull: true }).cohortLastNShortfall, null);
});

test('closed modes ignore a persisted open or Postponed toggle', () => {
    const issues = [cohortEpic('D-1'), cohortEpic('P-1', { status: 'Postponed' }), cohortEpic('O-1', { status: 'open', terminal: null })];
    const result = renderLayer('B', Object.assign(inputs(), {
        cohortMode: 'closed', cohortClosedStartQuarter: '2026Q1', cohortClosedEndQuarter: '2026Q1',
        cohortData: { range: null, issues, meta: { warnings: [], mode: 'closed', scope: 'components' } },
        cohortStatusToggles: { done: true, open: true, killed: true, incomplete: true, postponed: true }, cohortExcludeCapacity: false,
    }));
    assert.deepEqual(result.cohortDisplayedIssues.map((item) => item.key), ['D-1']);
});

test('data from another mode is never used: mismatch in either direction awaits the right data', () => {
    const createdPayload = { range: { startDate: '2026-01-01', endDate: '2026-03-31' }, issues: [cohortEpic('C-1', { status: 'open', terminal: null })], meta: { warnings: ['created warning'] } };
    const closedUnderCreated = renderLayer('B', Object.assign(inputs(), { cohortMode: 'closed', cohortData: createdPayload, cohortStatusToggles: closedStatusToggles }));
    assert.equal(closedUnderCreated.cohortAwaitingMode, true);
    assert.deepEqual(closedUnderCreated.cohortDisplayedIssues, []);
    assert.equal(closedUnderCreated.cohortFetchedCount, 0);
    assert.deepEqual(closedUnderCreated.cohortWarnings, []);
    assert.equal(closedUnderCreated.cohortLastNShortfall, null);
    const createdUnderClosed = renderLayer('B', Object.assign(inputs(), { cohortMode: 'created', cohortData: lastNPayload([cohortEpic('D-1')]), cohortStatusToggles: { done: true, open: true } }));
    assert.equal(createdUnderClosed.cohortAwaitingMode, true);
    assert.deepEqual(createdUnderClosed.cohortDisplayedIssues, []);
    const matching = renderLayer('B', Object.assign(inputs(), { cohortMode: 'created', cohortData: createdPayload, cohortStatusToggles: { done: true, open: true } }));
    assert.equal(matching.cohortAwaitingMode, false);
    assert.equal(matching.cohortFetchedCount, 1);
    assert.equal(renderLayer('B', Object.assign(inputs(), { cohortMode: 'created', cohortData: null })).cohortAwaitingMode, false);
});

test('closed-mode heatmap rows span the displayed Epics and keep long-lived Epics in the overflow column', () => {
    const issues = [
        cohortEpic('A-1', { project: 'A', created: '2023-02-10', terminal: '2026-02-01' }),
        cohortEpic('B-1', { project: 'B', created: '2025-08-01', terminal: '2025-09-01' }),
        cohortEpic('B-2', { project: 'B', created: '2026-01-20', terminal: '2026-02-20' }),
    ];
    const render = (project) => renderLayer('B', Object.assign(inputs(), {
        cohortMode: 'closed', cohortClosedStartQuarter: '2026Q1', cohortClosedEndQuarter: '2026Q1', cohortProjectFilter: project,
        cohortData: { range: null, issues, meta: { warnings: [], mode: 'closed', scope: 'components' } },
        cohortStatusToggles: closedStatusToggles, cohortExcludeCapacity: false,
    })).cohortGridModel;
    const all = render('all');
    assert.equal(all.rows[0].key, '2023Q1');
    assert.equal(all.rows[all.rows.length - 1].key, '2026Q1');
    assert.equal(all.columns[all.columns.length - 1].label, 'Q+12+');
    const onlyB = render('B');
    assert.equal(onlyB.rows[0].key, '2025Q3', 'the span follows the displayed Epics, not the server window');
    assert.equal(onlyB.columns.some((column) => column.overflow), false);
});

test('Project filter survives Created to Closed and back, and is still pruned when its data is for the right mode', () => {
    const effects = [], fakeReact = { useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }), useEffect: (fn) => effects.push(fn) };
    const hooks = loadHooks({ reactRuntime: fakeReact });
    // `fetched` is whether the data in hand is what the current query loaded: the hook files every payload under cohortQueryKey.
    const run = (overrides, { fetched = true } = {}) => {
        effects.length = 0;
        const value = Object.assign(inputs(), { cohortQueryKey: 'synthetic-cohort' }, overrides);
        if (fetched && value.cohortData) value.cohortCacheRef.current[value.cohortQueryKey] = value.cohortData;
        const cleared = [];
        value.setCohortProjectFilter = (next) => cleared.push(next);
        hooks.useStatsDerivedB(value);
        const pruneEffects = effects.filter((fn) => /setCohortProjectFilter\(["']all["']\)/.test(fn.toString()));
        assert.equal(pruneEffects.length, 1, 'the Project prune effect must be found');
        pruneEffects.forEach((fn) => fn());
        return cleared;
    };
    const createdPayload = { range: null, issues: [cohortEpic('C-1', { project: 'PROD' })], meta: { warnings: [] } };
    const closedPayload = { range: null, issues: [cohortEpic('X-1', { project: 'OTHER' })], meta: { warnings: [], mode: 'closed', scope: 'components' } };
    assert.deepEqual(run({ cohortMode: 'closed', cohortProjectFilter: 'PROD', cohortData: createdPayload }), [], 'Created data under Closed must not reset Project');
    assert.deepEqual(run({ cohortMode: 'created', cohortProjectFilter: 'PROD', cohortData: closedPayload }), [], 'Closed data under Created must not reset Project');
    assert.deepEqual(run({ cohortMode: 'closed', cohortProjectFilter: 'PROD', cohortData: closedPayload }), ['all'], 'a project missing from matching data is still pruned');
    assert.deepEqual(run({ cohortMode: 'created', cohortProjectFilter: 'PROD', cohortData: createdPayload }), []);
    // A Project chosen before its data arrives (a saved choice on a cold start, or a shared link) is not judged against no data or the old range's data.
    assert.deepEqual(run({ cohortMode: 'created', cohortProjectFilter: 'PROD', cohortData: null }), [], 'no data yet');
    assert.deepEqual(run({ cohortMode: 'closed', cohortProjectFilter: 'PROD', cohortData: closedPayload }, { fetched: false }), [], 'data of the previous range while the new one loads');
});

test('Lead Times status vocabulary of a link is the toggle set each mode shows', () => {
    const { LEAD_TIMES_STATUS_KEYS } = (() => {
        const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../frontend/src/cohort/cohortUtils.js')], bundle: true, write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text;
        const module = { exports: {} };
        new Function('module', 'exports', code)(module, module.exports);
        return module.exports;
    })();
    for (const mode of ['created', 'closed', 'last_n']) {
        const controls = renderLayer('B', Object.assign(inputs(), { cohortMode: mode })).cohortStatusControls;
        assert.deepEqual(controls.map((item) => item.key), [...LEAD_TIMES_STATUS_KEYS[mode]], mode);
    }
});

for (const mode of ['created', 'closed', 'last_n']) test(`cohort ${mode} reads send one request shape, explicit and automatic`, async () => {
    const buildBodies = async (automatic) => {
        const effects = [], fakeReact = { useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }), useEffect: (fn) => effects.push(fn) };
        const hooks = loadHooks({ reactRuntime: fakeReact }), value = inputs(), bodies = [];
        let settle; const settled = new Promise((resolve) => { settle = resolve; });
        Object.assign(value, {
            showStats: true, statsView: 'cohort', cohortMode: mode, cohortLastN: 50, cohortQueryKey: `key-${mode}`,
            cohortStartQuarter: '2026Q1', cohortEndQuarter: '2026Q2', cohortClosedStartQuarter: '2025Q4', cohortClosedEndQuarter: '2026Q1',
            burnoutScopedTeamIds: ['T1'], activeGroupMissingComponents: ['Alpha'], activeGroupAdHocCapacityEpics: ['TECH-9'],
            issueEditStateRef: { current: { beginRead: () => ({}), finishRead() {}, isCurrentAggregateRead: () => true } },
            automaticRefreshRef: { current: automatic ? { source: 'stats_cohort', job: { signal: new AbortController().signal, shouldApply: () => true }, settle } : null },
        });
        const priorFetch = global.fetch, priorWindow = global.window;
        global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms === 120 ? 1 : 30000), clearTimeout };
        global.fetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ data: { issues: [], meta: { warnings: [] } }, cached: false })); };
        try {
            hooks.useStatsDerivedB(value);
            const cleanup = effects.find((fn) => fn.toString().includes('const fetchCohort'))();
            if (automatic) await settled; else await new Promise((resolve) => setTimeout(resolve, 30));
            cleanup?.();
        } finally { global.fetch = priorFetch; global.window = priorWindow; }
        return bodies;
    };
    const explicit = await buildBodies(false), automatic = await buildBodies(true);
    const shared = { teamIds: ['T1'], components: ['Alpha'], adHocCapacityEpics: ['TECH-9'], refresh: false };
    const expected = mode === 'created' ? { startQuarter: '2026Q1', endQuarter: '2026Q2', ...shared }
        : mode === 'closed' ? { mode: 'closed', startQuarter: '2025Q4', endQuarter: '2026Q1', ...shared }
            : { mode: 'last_n', ...shared };
    assert.equal(explicit.length, 1);
    assert.equal(automatic.length, 1);
    assert.equal(JSON.stringify(explicit[0]), JSON.stringify(expected));
    assert.equal(JSON.stringify(automatic[0]), JSON.stringify(expected));
});

test('cohort reads reuse a cached mode instead of fetching again and need quarters only for Created and Closed', async () => {
    const effects = [], fakeReact = { useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }), useEffect: (fn) => effects.push(fn) };
    const hooks = loadHooks({ reactRuntime: fakeReact }), value = inputs(), errors = [];
    value.automaticRefreshRef = { current: null };
    Object.assign(value, { showStats: true, statsView: 'cohort', cohortMode: 'last_n', cohortQueryKey: 'last_n::::::sig', cohortStartQuarter: '', cohortEndQuarter: '', cohortClosedStartQuarter: '', cohortClosedEndQuarter: '' });
    value.cohortCacheRef.current['last_n::::::sig'] = { issues: [], meta: { mode: 'last_n', warnings: [] } };
    value.setCohortError = (message) => errors.push(message);
    const priorFetch = global.fetch; let fetches = 0; global.fetch = async () => { fetches++; return new Response('{}'); };
    try {
        hooks.useStatsDerivedB(value);
        effects.find((fn) => fn.toString().includes('const fetchCohort'))();
        await new Promise((resolve) => setTimeout(resolve, 20));
    } finally { global.fetch = priorFetch; }
    assert.equal(fetches, 0, 'a cached Last N window is not fetched again');
    assert.equal(errors.includes('Start and end quarter are required.'), false, 'Last N needs no quarters');

    effects.length = 0; errors.length = 0;
    Object.assign(value, { cohortMode: 'closed', cohortQueryKey: '' });
    hooks.useStatsDerivedB(value);
    effects.find((fn) => fn.toString().includes('const fetchCohort'))();
    assert.ok(errors.includes('Start and end quarter are required.'), 'Closed still needs its quarters');
});
