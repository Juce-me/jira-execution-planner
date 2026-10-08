const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const KEYS = ['statsView', 'statsGraphMode', 'burnoutData', 'burnoutLoading', 'burnoutError',
    'burnoutAssigneeFilter', 'burndownMetric', 'cohortData', 'cohortLoading', 'cohortError',
    'cohortStartQuarter', 'cohortEndQuarter', 'cohortGroupBy', 'cohortProjectFilter',
    'cohortAssigneeFilter', 'cohortExcludeAdHoc', 'cohortExcludeCapacity', 'cohortStatusToggles', 'cohortSelectedRow'];
const SCENARIO_KEYS = ['scenarioData', 'scenarioError', 'scenarioLaneMode', 'scenarioCollapsedLanes',
    'scenarioEpicFocus', 'scenarioRangeOverride', 'scenarioScrollTop', 'scenarioScrollLeft',
    'scenarioViewportHeight', 'scenarioHoverKey', 'scenarioFlashKey', 'scenarioLayout', 'scenarioEdgeRender', 'scenarioTooltip'];
const resolvers = {
    resolveStatsView: value => ['teams','priority','burnout','cohort','excludedCapacity','monoCrossShare','projectTrack'].includes(value) ? value : 'teams',
    resolveStatsGraphMode: value => ['weighted','absolute'].includes(value) ? value : 'weighted',
    resolveBurndownMetric: value => ['issueCount','storyPoints'].includes(value) ? value : 'storyPoints',
    resolveCohortGroupBy: value => ['month','quarter'].includes(value) ? value : 'quarter',
};
function load(relative) {
    const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', relative)], bundle: true,
        write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module','exports','require',code)(module,module.exports,require);
    return module.exports;
}
function frozenTime(callback) {
    const OriginalDate = Date;
    global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-02-12T12:00:00Z'])); } };
    try { return callback(); } finally { global.Date = OriginalDate; }
}
const defaults = () => ({ statsView: 'teams', statsGraphMode: 'weighted', burnoutData: null,
    burnoutLoading: false, burnoutError: '', burnoutAssigneeFilter: 'all', burndownMetric: 'storyPoints',
    cohortData: null, cohortLoading: false, cohortError: '', cohortStartQuarter: '2026Q1', cohortEndQuarter: '2026Q1',
    cohortGroupBy: 'quarter', cohortProjectFilter: 'all', cohortAssigneeFilter: 'all', cohortExcludeAdHoc: false,
    cohortExcludeCapacity: true, cohortStatusToggles: { done:true,open:true,killed:false,incomplete:false,postponed:false }, cohortSelectedRow:null });

test('Stats seam freezes the 19 ordered keys and empty/invalid saved preference defaults', () => frozenTime(() => {
    const seam = load('frontend/src/stats/statsGroupState.js');
    assert.deepEqual(seam.STATS_GROUP_STATE_KEYS, KEYS);
    assert.deepEqual(seam.buildDefaultStatsGroupState({}, resolvers), defaults());
    assert.deepEqual(seam.buildDefaultStatsGroupState({ statsView:'invalid', statsGraphMode:'invalid', burndownMetric:'invalid', cohortGroupBy:'invalid' }, resolvers), defaults());
}));
test('partial and falsy saved preferences retain the original truthy and nullish fallbacks', () => frozenTime(() => {
    const seam = load('frontend/src/stats/statsGroupState.js');
    assert.deepEqual(seam.buildDefaultStatsGroupState({ statsView:'cohort',statsGraphMode:'absolute',burndownMetric:'issueCount',
        burnoutAssigneeFilter:'',cohortStartQuarter:'2025Q2',cohortEndQuarter:'',cohortGroupBy:'month',cohortProjectFilter:'AAA',
        cohortAssigneeFilter:'person',cohortExcludeAdHoc:'yes',cohortExcludeCapacity:false,cohortStatusToggles:{done:false,killed:true} }, resolvers),
    { ...defaults(), statsView:'cohort',statsGraphMode:'absolute',burndownMetric:'issueCount',cohortStartQuarter:'2025Q2',
        cohortGroupBy:'month',cohortProjectFilter:'AAA',cohortAssigneeFilter:'person',cohortExcludeAdHoc:true,cohortExcludeCapacity:false,
        cohortStatusToggles:{done:false,open:true,killed:true,incomplete:false,postponed:false} });
}));
test('snapshot preserves exact actual values and excludes unrelated state', () => {
    const seam = load('frontend/src/stats/statsGroupState.js');
    const values = Object.fromEntries(KEYS.map((key,index) => [key,{index}]));
    const result = seam.snapshotStatsGroupState({...values,hideExcludedStats:false,scenarioData:{}});
    assert.deepEqual(Object.keys(result),KEYS);
    for (const key of KEYS) assert.equal(result[key],values[key]);
});
test('setter sequence resets loading and preserves exact original fallback expressions', () => frozenTime(() => {
    const seam = load('frontend/src/stats/statsGroupState.js');
    const calls=[];
    const setters=Object.fromEntries(KEYS.map(key => ['set'+key[0].toUpperCase()+key.slice(1),value => calls.push([key,value])]));
    seam.applyStatsGroupState({ ...defaults(), burnoutData:0,burnoutLoading:true,burnoutError:0,burnoutAssigneeFilter:false,
        cohortData:false,cohortLoading:true,cohortError:false,cohortStartQuarter:'',cohortEndQuarter:0,
        cohortProjectFilter:0,cohortAssigneeFilter:'',cohortExcludeAdHoc:1,cohortExcludeCapacity:0,cohortSelectedRow:false },setters,resolvers);
    assert.deepEqual(calls, Object.entries({...defaults(),cohortExcludeAdHoc:true,cohortExcludeCapacity:0}));
    calls.length=0;
    seam.applyStatsGroupState({...defaults(),burnoutData:{marker:'burnout'},cohortData:{marker:'cohort'},cohortSelectedRow:{marker:'row'}},setters,resolvers);
    assert.deepEqual(calls,Object.entries({...defaults(),burnoutData:{marker:'burnout'},cohortData:{marker:'cohort'},cohortSelectedRow:{marker:'row'}}));
}));
test('three cache clears replace their objects without changing force-refresh state', () => {
    const seam=load('frontend/src/stats/statsGroupState.js');
    const refs={burnoutCacheRef:{current:{old:1}},cohortCacheRef:{current:{old:2}},excludedCapacityCacheRef:{current:{old:3}},excludedCapacityForceRefreshRef:{current:true}};
    const previous=Object.values(refs).slice(0,3).map(ref=>ref.current);
    seam.resetStatsTransientRefs(refs);
    Object.values(refs).slice(0,3).forEach((ref,index)=>{assert.deepEqual(ref.current,{});assert.notEqual(ref.current,previous[index]);});
    assert.equal(refs.excludedCapacityForceRefreshRef.current,true);
});
test('composed group defaults snapshots and setter calls retain Stats then Scenario then hideExcludedStats', () => frozenTime(() => {
    const seam=load('frontend/src/stats/statsGroupState.js');
    const scenario=load('frontend/src/scenario/scenarioGroupState.js');
    const expected=[...KEYS,...SCENARIO_KEYS,'hideExcludedStats'];
    const composed={...seam.buildDefaultStatsGroupState({},resolvers),...scenario.buildDefaultScenarioGroupState(),hideExcludedStats:true};
    assert.deepEqual(Object.keys(composed),expected);
    assert.deepEqual(Object.keys({...seam.snapshotStatsGroupState(composed),...Object.fromEntries(SCENARIO_KEYS.map(key=>[key,composed[key]])),hideExcludedStats:composed.hideExcludedStats}),expected);
    const calls=[];const setters=Object.fromEntries([...KEYS,...SCENARIO_KEYS,'scenarioLoading','hideExcludedStats'].map(key=>['set'+key[0].toUpperCase()+key.slice(1),value=>calls.push([key,value])]));
    seam.applyStatsGroupState(composed,setters,resolvers);scenario.applyScenarioGroupState(setters,composed);setters.setHideExcludedStats(composed.hideExcludedStats);
    assert.deepEqual(calls.map(([key])=>key),[...KEYS,...SCENARIO_KEYS,'scenarioLoading','hideExcludedStats']);
    const app=fs.readFileSync(path.join(__dirname,'../frontend/src/dashboard.jsx'),'utf8');
    assert.match(app,/\.\.\.buildDefaultStatsGroupState\([\s\S]*?\.\.\.buildDefaultScenarioGroupState\(savedPrefsRef.current.scenarioLaneMode\),\s*hideExcludedStats:/);
    assert.match(app,/\.\.\.snapshotStatsGroupState\([\s\S]*?\.\.\.scenarioGroupValues,\s*hideExcludedStats,/);
    assert.match(app,/applyStatsGroupState\([\s\S]*?applyScenarioGroupState\([^\n]*\);\s*setHideExcludedStats\(nextState.hideExcludedStats \?\? true\)/);
    for(const key of KEYS) { assert.match(app,new RegExp('\\b'+key+'\\b')); assert.match(app,new RegExp('\\bset'+key[0].toUpperCase()+key.slice(1)+'\\b')); }
}));
