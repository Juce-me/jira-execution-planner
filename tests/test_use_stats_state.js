const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Frozen from the pre-extraction App declarations at 7e18428c.
const EXPECTED_RETURN_NAMES = [
    "statsView",
    "setStatsView",
    "statsGraphMode",
    "setStatsGraphMode",
    "burnoutData",
    "setBurnoutData",
    "burnoutLoading",
    "setBurnoutLoading",
    "burnoutError",
    "setBurnoutError",
    "burnoutAssigneeFilter",
    "setBurnoutAssigneeFilter",
    "burndownMetric",
    "setBurndownMetric",
    "cohortData",
    "setCohortData",
    "cohortLoading",
    "setCohortLoading",
    "cohortError",
    "setCohortError",
    "cohortStartQuarter",
    "setCohortStartQuarter",
    "cohortEndQuarter",
    "setCohortEndQuarter",
    "cohortGroupBy",
    "setCohortGroupBy",
    "cohortProjectFilter",
    "setCohortProjectFilter",
    "cohortAssigneeFilter",
    "setCohortAssigneeFilter",
    "cohortExcludeAdHoc",
    "setCohortExcludeAdHoc",
    "cohortExcludeCapacity",
    "setCohortExcludeCapacity",
    "cohortStatusToggles",
    "setCohortStatusToggles",
    "cohortSelectedRow",
    "setCohortSelectedRow",
    "excludedCapacityData",
    "setExcludedCapacityData",
    "excludedCapacityLoading",
    "setExcludedCapacityLoading",
    "excludedCapacityError",
    "setExcludedCapacityError",
    "excludedCapacityStartSprintId",
    "setExcludedCapacityStartSprintId",
    "excludedCapacityEndSprintId",
    "setExcludedCapacityEndSprintId",
    "excludedCapacitySelectedEpicKeys",
    "setExcludedCapacitySelectedEpicKeys",
    "excludedCapacityChartMode",
    "setExcludedCapacityChartMode",
    "excludedCapacityMetric",
    "setExcludedCapacityMetric",
    "effortSplitVisibleBuckets",
    "setEffortSplitVisibleBuckets",
    "excludedCapacityIsolatedTeam",
    "setExcludedCapacityIsolatedTeam",
    "excludedCapacityEpicDropdownOpen",
    "setExcludedCapacityEpicDropdownOpen",
    "excludedCapacityRefreshNonce",
    "setExcludedCapacityRefreshNonce",
    "issuePeopleStatsRevision",
    "setIssuePeopleStatsRevision",
    "excludedCapacityEpicDropdownRef",
    "projectTrackCapacitySide",
    "setProjectTrackCapacitySide",
    "projectTrackMode",
    "setProjectTrackMode",
    "projectTrackExcludeAdHoc",
    "setProjectTrackExcludeAdHoc",
    "projectTrackExcludeExcludedCapacity",
    "setProjectTrackExcludeExcludedCapacity",
    "projectTrackPhaseData",
    "setProjectTrackPhaseData",
    "projectTrackPhaseLoading",
    "setProjectTrackPhaseLoading",
    "projectTrackPhaseError",
    "setProjectTrackPhaseError",
    "projectTrackPhaseCacheRef",
    "projectTrackPhaseAbortRef",
    "burnoutTaskFilter",
    "setBurnoutTaskFilter",
    "burnoutCacheRef",
    "cohortCacheRef",
    "excludedCapacityCacheRef",
    "excludedCapacityForceRefreshRef"
];
const resolvers = {
    resolveStatsView: value => ['teams','priority','burnout','cohort','excludedCapacity','monoCrossShare','projectTrack'].includes(value) ? value : 'teams',
    resolveStatsGraphMode: value => ['weighted','absolute'].includes(value) ? value : 'weighted',
    resolveBurndownMetric: value => ['issueCount','storyPoints'].includes(value) ? value : 'storyPoints',
    resolveCohortGroupBy: value => ['month','quarter'].includes(value) ? value : 'quarter',
};
function renderHook(savedPrefs = {}) {
    const code = esbuild.buildSync({entryPoints:[path.join(__dirname,'../frontend/src/stats/useStatsState.js')],
        bundle:true,write:false,format:'cjs',platform:'node',external:['react']}).outputFiles[0].text;
    const module={exports:{}};
    new Function('module','exports','require',code)(module,module.exports,require);
    let result;
    function Probe() { result=module.exports.useStatsState({savedPrefsRef:{current:savedPrefs},...resolvers});return null; }
    const OriginalDate=Date;
    global.Date=class extends OriginalDate { constructor(...args){super(...(args.length?args:['2026-02-12T12:00:00Z']));} };
    try { assert.equal(renderToString(React.createElement(Probe)), ''); } finally { global.Date=OriginalDate; }
    return result;
}
const expectedEmpty = {
    statsView:'teams',statsGraphMode:'weighted',burnoutData:null,burnoutLoading:false,burnoutError:'',burnoutAssigneeFilter:'all',burndownMetric:'storyPoints',
    cohortData:null,cohortLoading:false,cohortError:'',cohortStartQuarter:'2026Q1',cohortEndQuarter:'2026Q1',cohortGroupBy:'quarter',
    cohortProjectFilter:'all',cohortAssigneeFilter:'all',cohortExcludeAdHoc:false,cohortExcludeCapacity:true,
    cohortStatusToggles:{done:true,open:true,killed:false,incomplete:false,postponed:false},cohortSelectedRow:null,
    excludedCapacityData:null,excludedCapacityLoading:false,excludedCapacityError:'',excludedCapacityStartSprintId:'',excludedCapacityEndSprintId:'',
    excludedCapacitySelectedEpicKeys:null,excludedCapacityChartMode:'teams',excludedCapacityMetric:'percent',
    effortSplitVisibleBuckets:{excludedCapacity:true,adHoc:true,product:true,tech:true},excludedCapacityIsolatedTeam:null,excludedCapacityEpicDropdownOpen:false,
    excludedCapacityRefreshNonce:0,issuePeopleStatsRevision:0,projectTrackCapacitySide:'product',projectTrackMode:'epic',
    projectTrackExcludeAdHoc:false,projectTrackExcludeExcludedCapacity:false,projectTrackPhaseData:null,projectTrackPhaseLoading:false,projectTrackPhaseError:'',burnoutTaskFilter:null,
};
function assertCells(result,expected) {
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key=>[key,result[key]])),expected);
    for(const name of EXPECTED_RETURN_NAMES.filter(name=>name.startsWith('set'))) assert.equal(typeof result[name],'function',name);
    assert.deepEqual(result.excludedCapacityEpicDropdownRef.current,null);
    assert.deepEqual(result.projectTrackPhaseCacheRef.current,{});
    assert.equal(result.projectTrackPhaseAbortRef.current,null);
    assert.deepEqual(result.burnoutCacheRef.current,{});
    assert.deepEqual(result.cohortCacheRef.current,{});
    assert.deepEqual(result.excludedCapacityCacheRef.current,{});
    assert.equal(result.excludedCapacityForceRefreshRef.current,false);
}
test('Stats state returns the frozen 87 flat names with exact empty initializers',()=>{
    const result=renderHook();assert.equal(EXPECTED_RETURN_NAMES.length,87);assert.deepEqual(Object.keys(result),EXPECTED_RETURN_NAMES);assertCells(result,expectedEmpty);
});
test('Stats state preserves partial saved preferences and original epic key normalization',()=>{
    assertCells(renderHook({statsView:'projectTrack',statsGraphMode:'absolute',burnoutAssigneeFilter:'person',burndownMetric:'issueCount',
        cohortStartQuarter:'2025Q3',cohortEndQuarter:'2025Q4',cohortGroupBy:'month',cohortProjectFilter:'AAA',cohortAssigneeFilter:'person',
        cohortExcludeAdHoc:true,cohortExcludeCapacity:false,cohortStatusToggles:{open:false,postponed:true},
        excludedCapacityStartSprintId:'s1',excludedCapacityEndSprintId:'s2',excludedCapacitySelectedEpicKeys:[' aaa-1 ',null,'',0,'AAA-1'],
        excludedCapacityChartMode:'group',excludedCapacityMetric:'storyPoints',projectTrackCapacitySide:'both',projectTrackMode:'team',
        projectTrackExcludeAdHoc:1,projectTrackExcludeExcludedCapacity:1}),
    {...expectedEmpty,statsView:'projectTrack',statsGraphMode:'absolute',burnoutAssigneeFilter:'person',burndownMetric:'issueCount',
        cohortStartQuarter:'2025Q3',cohortEndQuarter:'2025Q4',cohortGroupBy:'month',cohortProjectFilter:'AAA',cohortAssigneeFilter:'person',
        cohortExcludeAdHoc:true,cohortExcludeCapacity:false,cohortStatusToggles:{done:true,open:false,killed:false,incomplete:false,postponed:true},
        excludedCapacityStartSprintId:'s1',excludedCapacityEndSprintId:'s2',excludedCapacitySelectedEpicKeys:['AAA-1','AAA-1'],
        excludedCapacityChartMode:'group',excludedCapacityMetric:'storyPoints',projectTrackCapacitySide:'both',projectTrackMode:'team',
        projectTrackExcludeAdHoc:true,projectTrackExcludeExcludedCapacity:true});
});
test('invalid values and falsy fallbacks match App while empty epic selection remains empty',()=>{
    assertCells(renderHook({statsView:'invalid',statsGraphMode:'invalid',burnoutAssigneeFilter:0,burndownMetric:'invalid',cohortStartQuarter:'',cohortEndQuarter:0,
        cohortGroupBy:'invalid',cohortProjectFilter:false,cohortAssigneeFilter:'',cohortExcludeCapacity:0,excludedCapacityStartSprintId:0,
        excludedCapacityEndSprintId:false,excludedCapacitySelectedEpicKeys:[],excludedCapacityChartMode:'invalid',excludedCapacityMetric:'invalid',
        projectTrackCapacitySide:'invalid',projectTrackMode:'invalid'}),{...expectedEmpty,cohortExcludeCapacity:0,excludedCapacitySelectedEpicKeys:[]});
    assert.equal(renderHook({excludedCapacitySelectedEpicKeys:'AAA-1'}).excludedCapacitySelectedEpicKeys,null);
});
test('state owner contains no effects getters or dashboard import and keeps invalidation externally wired',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../frontend/src/stats/useStatsState.js'),'utf8');
    assert.equal(/useEffect|Object\.defineProperty|\bget\s+\w+\s*\(/.test(source),false);
    assert.equal(/from ['"][^'"]*dashboard/.test(source),false);
    assert.ok(source.includes("from '../cohort/cohortUtils.js'"));
    const app=fs.readFileSync(path.join(__dirname,'../frontend/src/dashboard.jsx'),'utf8');
    assert.match(app,/setIssuePeopleStatsRevision\(value => value \+ 1\)/);
    assert.match(app,/useStatsState\(\{ savedPrefsRef, resolveStatsView, resolveStatsGraphMode, resolveBurndownMetric, resolveCohortGroupBy \}\);\s*const isStatsSourceOnlyStatsView/);
});
