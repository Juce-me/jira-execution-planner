// The oracle was generated under TZ=UTC and parseScenarioDate builds local-midnight Dates, so the
// zone must be pinned before any Date exists. node --test runs each file in its own process.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const scenarioDir = path.join(__dirname, '../frontend/src/scenario');
const realLayoutPath = path.join(scenarioDir, 'scenarioLayout.js');
// Negative-control override only: point the conformance tests at a mutated copy of the module.
const layoutPath = process.env.SCENARIO_LAYOUT_MODULE ? path.resolve(process.env.SCENARIO_LAYOUT_MODULE) : realLayoutPath;
const derivedHookPath = path.join(scenarioDir, 'useScenarioDerived.js');
const layoutHookPath = path.join(scenarioDir, 'useScenarioLayout.js');
const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures/scenario-layout-oracle-example-sanitized.json'), 'utf8'));

const loadLayout = () => import(pathToFileURL(layoutPath).href);
const loadUtils = () => import(pathToFileURL(path.join(scenarioDir, 'scenarioUtils.js')).href);
const loadLaneUtils = () => import(pathToFileURL(path.join(scenarioDir, 'scenarioLaneUtils.js')).href);
const loadExportUtils = () => import(pathToFileURL(path.join(scenarioDir, '../jiraExportUtils.mjs')).href);

// The search predicate stays in the hook and is passed into the search core.
const loadMatchesScenarioSearch = () => {
    const source = fs.readFileSync(derivedHookPath, 'utf8');
    const match = source.match(/const matchesScenarioSearch = \([\s\S]*?\n\s*\};/);
    assert.ok(match, 'Expected matchesScenarioSearch in useScenarioDerived.js');
    return vm.runInNewContext(`${match[0]}\nmatchesScenarioSearch`);
};

// The lane selector stays in useScenarioLayout.js as a closure over scenarioEpicFocus/scenarioLaneMode and is
// passed into four cores; rebuild that closure per case from the hook's own source.
const loadMakeLaneForIssue = () => {
    const source = fs.readFileSync(layoutHookPath, 'utf8');
    const match = source.match(/const scenarioLaneForIssue = \(issue\) => \{[\s\S]*?\n\s*\};/);
    assert.ok(match, 'Expected scenarioLaneForIssue in useScenarioLayout.js');
    return (scenarioEpicFocus, scenarioLaneMode) =>
        vm.runInNewContext(`${match[0]}\nscenarioLaneForIssue`, { scenarioEpicFocus, scenarioLaneMode });
};

// ------------------------------------------------------------------ fixture codec
// Decoder mirrors the fixture encoding; encoder mirrors the oracle generator's serialiser.
const fnCache = new Map();
function decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    if ('$undefined' in v) return undefined;
    if ('$number' in v) return { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }[v.$number];
    if ('$date' in v) return new Date(v.$date === 'Invalid Date' ? NaN : v.$date);
    if ('$map' in v) return new Map(v.$map.map(([k, x]) => [decode(k), decode(x)]));
    if ('$set' in v) return new Set(v.$set.map(decode));
    if ('$frozen' in v) return Object.freeze(decode(v.$frozen));
    if ('$fn' in v) {
        if (!fnCache.has(v.source)) fnCache.set(v.source, vm.runInThisContext(`(${v.source})`));
        return fnCache.get(v.source);
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = decode(v[k]);
    return o;
}
const isPlainObject = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
function encode(value, stack = []) {
    if (value === undefined) return { $undefined: true };
    if (value === null) return null;
    const t = typeof value;
    if (t === 'number') {
        if (Number.isNaN(value)) return { $number: 'NaN' };
        if (value === Infinity) return { $number: 'Infinity' };
        if (value === -Infinity) return { $number: '-Infinity' };
        if (Object.is(value, -0)) return { $number: '-0' };
        return value;
    }
    if (t === 'string' || t === 'boolean') return value;
    if (t === 'function') return { $fn: value.name || 'anonymous' };
    if (t !== 'object') throw new Error(`unexpected type ${t}`);
    if (stack.includes(value)) throw new Error('cycle');
    const next = [...stack, value];
    if (value instanceof Date) {
        const ms = value.getTime();
        return { $date: Number.isNaN(ms) ? 'Invalid Date' : value.toISOString() };
    }
    if (value instanceof Map) return { $map: [...value.entries()].map(([k, x]) => [encode(k, next), encode(x, next)]) };
    if (value instanceof Set) return { $set: [...value.values()].map(x => encode(x, next)) };
    if (Array.isArray(value)) {
        const arr = value.map(x => encode(x, next));
        return Object.isFrozen(value) ? { $frozen: arr } : arr;
    }
    if (!isPlainObject(value)) throw new Error(`unexpected object ${Object.prototype.toString.call(value)}`);
    const obj = {};
    for (const k of Object.keys(value)) obj[k] = encode(value[k], next);
    return Object.isFrozen(value) && Object.keys(value).length === 0 ? { $frozen: obj } : obj;
}
// Purity runs deep-freeze their inputs, which adds $frozen tags the unfrozen oracle run does not have.
const stripFrozen = (e) => {
    if (Array.isArray(e)) return e.map(stripFrozen);
    if (e && typeof e === 'object') {
        if ('$frozen' in e) return stripFrozen(e.$frozen);
        return Object.fromEntries(Object.entries(e).map(([k, x]) => [k, stripFrozen(x)]));
    }
    return e;
};
function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (value instanceof Map) value.forEach((x, k) => { deepFreeze(k, seen); deepFreeze(x, seen); });
    else if (value instanceof Set) value.forEach(x => deepFreeze(x, seen));
    else Object.values(value).forEach(x => deepFreeze(x, seen));
    return Object.freeze(value);
}
const decodeInputs = (testCase) => Object.fromEntries(Object.entries(testCase.inputs).map(([k, v]) => [k, decode(v)]));

// ------------------------------------------------------------------ hook wiring
const EXPECTED_CORES = [
    ['scenarioSprintBounds', 'buildScenarioSprintBounds'],
    ['scenarioIssues', 'buildScenarioIssues'],
    ['scenarioEffectiveIssues', 'buildScenarioEffectiveIssues'],
    ['scenarioSearchMatchSet', 'buildScenarioSearchMatchSet'],
    ['scenarioFilteredIssues', 'buildScenarioFilteredIssues'],
    ['scenarioExcludedIssueKeys', 'buildScenarioExcludedIssueKeys'],
    ['scenarioIssueByKey', 'buildScenarioIssueByKey'],
    ['scenarioBaseEnd', 'buildScenarioBaseEnd'],
    ['scenarioFocusIssueKeys', 'buildScenarioFocusIssueKeys'],
    ['scenarioFocusContextKeys', 'buildScenarioFocusContextKeys'],
    ['scenarioTimelineIssues', 'buildScenarioTimelineIssues'],
    ['scenarioTimelineWithSegments', 'buildScenarioTimelineWithSegments'],
    ['scenarioAssigneeConflicts', 'buildScenarioAssigneeConflicts'],
    ['scenarioDepViolations', 'buildScenarioDepViolations'],
    ['scenarioDepViolatedKeys', 'buildScenarioDepViolatedKeys'],
    // SC3 H6: the useScenarioLayout cores, in useScenarioLayout.js memo order.
    ['scenarioLaneInfo', 'buildScenarioLaneInfo'],
    ['scenarioLateItems', 'buildScenarioLateItems'],
    ['scenarioCriticalPathItems', 'buildScenarioCriticalPathItems'],
    ['scenarioUnschedulableItems', 'buildScenarioUnschedulableItems'],
    ['scenarioTicks', 'buildScenarioTicks'],
    ['scenarioQuarterMarkers', 'buildScenarioQuarterMarkers'],
    ['scenarioLaneStacking', 'buildScenarioLaneStacking'],
    ['scenarioVisibleExportIssues', 'buildScenarioVisibleExportIssues'],
    ['scenarioLaneMeta', 'buildScenarioLaneMeta'],
    ['scenarioLaneAssigneeGroups', 'buildScenarioLaneAssigneeGroups'],
    ['scenarioPositions', 'buildScenarioPositions'],
    ['scenarioEdgeCandidates', 'buildScenarioEdgeCandidates'],
    ['scenarioEdgeIndex', 'buildScenarioEdgeIndex'],
    ['scenarioEpicBars', 'buildScenarioEpicBars'],
    ['scenarioEpicEdges', 'buildScenarioEpicEdges'],
    ['scenarioVisibleLanes', 'buildScenarioVisibleLanes'],
    ['scenarioActiveEdges', 'buildScenarioActiveEdges'],
    ['scenarioUpstreamSet', 'buildScenarioUpstreamSet'],
    ['scenarioDownstreamSet', 'buildScenarioDownstreamSet'],
    ['scenarioBlockedSet', 'buildScenarioBlockedSet'],
    ['scenarioFocusEdges', 'buildScenarioFocusEdges'],
];
// Hook statements computed inline (not cores); recomputed here exactly as useScenarioDerived and
// useScenarioLayout do.
const WIRING_STATEMENTS = ['scenarioRawIssues', 'scenarioConfig', 'scenarioSummary', 'scenarioBaseUrl',
    'scenarioDependencies', 'scenarioCapacityByTeam', 'scenarioSearchQuery', 'scenarioFocusKeys',
    'scenarioContextKeys', 'scenarioFocusSet', 'scenarioContextSet', 'scenarioBaseStart', 'scenarioDeadline',
    'scenarioViewStart', 'scenarioViewEnd', 'scenarioFocusEpicKey', 'scenarioTimelineIssueKeys',
    'scenarioSearchFilterEnabled', 'scenarioDeadlineAtRisk', 'scenarioLanes', 'scenarioIssuesByLane',
    'SCENARIO_LANE_HEIGHT', 'scenarioBarGap', 'scenarioJiraEpicKeys', 'scenarioJiraStoryKeys',
    'scenarioTodayLeft', 'scenarioBaselineEdges'];
// useScenarioLayout keeps these early returns in its memo wrappers; the core is not called when they fire.
const GUARDED_CORES = { buildScenarioLaneStacking: 2, buildScenarioPositions: 3 };

// Runs the 36 cores in hook statement order. `call(fn, args)` invokes one core; calls are recorded, and
// `guarded` lists the cores whose hook-level early return fired instead.
function runChain(inputs, deps, call = (fn, args) => deps.layout[fn](args)) {
    const { parseScenarioDate, matchesScenarioSearch, makeLaneForIssue, buildLaneIssues,
        collectJiraExportKeysFromScenarioIssues, SCENARIO_BAR_GAP } = deps;
    const {
        EMPTY_ARRAY, EMPTY_OBJECT, jiraUrl, searchQuery, normalizeEpicKey, excludedEpicSet,
        scenarioData, scenarioEpicFocus, scenarioRangeOverride, scenarioOverrides, scenarioEditMode,
        scenarioLaneMode, scenarioShowConflictsOnly, scenarioLayout, scenarioCollapsedLanes, scenarioHoverKey,
        scenarioScrollTop, scenarioViewportHeight,
    } = inputs;
    const v = {};
    const calls = [];
    const guarded = [];
    const core = (stmt, fn, args) => { calls.push({ stmt, fn, args }); v[stmt] = call(fn, args); };
    v.scenarioRawIssues = scenarioData?.issues || EMPTY_ARRAY;
    v.scenarioConfig = scenarioData?.config || EMPTY_OBJECT;
    v.scenarioSummary = scenarioData?.summary || EMPTY_OBJECT;
    v.scenarioBaseUrl = scenarioData?.jira_base_url || jiraUrl || '';
    v.scenarioDependencies = scenarioData?.dependencies || EMPTY_ARRAY;
    v.scenarioCapacityByTeam = scenarioData?.capacity_by_team || EMPTY_OBJECT;
    core('scenarioSprintBounds', 'buildScenarioSprintBounds', { scenarioData });
    core('scenarioIssues', 'buildScenarioIssues', { scenarioRawIssues: v.scenarioRawIssues, scenarioCapacityByTeam: v.scenarioCapacityByTeam });
    core('scenarioEffectiveIssues', 'buildScenarioEffectiveIssues', { scenarioIssues: v.scenarioIssues, scenarioOverrides });
    v.scenarioSearchQuery = (searchQuery || '').trim().toLowerCase();
    core('scenarioSearchMatchSet', 'buildScenarioSearchMatchSet', {
        scenarioEffectiveIssues: v.scenarioEffectiveIssues, scenarioSearchQuery: v.scenarioSearchQuery, matchesScenarioSearch });
    core('scenarioFilteredIssues', 'buildScenarioFilteredIssues', {
        scenarioEffectiveIssues: v.scenarioEffectiveIssues, scenarioSearchQuery: v.scenarioSearchQuery, scenarioSearchMatchSet: v.scenarioSearchMatchSet });
    core('scenarioExcludedIssueKeys', 'buildScenarioExcludedIssueKeys', {
        scenarioEffectiveIssues: v.scenarioEffectiveIssues, excludedEpicSet, normalizeEpicKey });
    v.scenarioFocusKeys = scenarioData?.focus_set?.focused_issue_keys || EMPTY_ARRAY;
    v.scenarioContextKeys = scenarioData?.focus_set?.context_issue_keys || EMPTY_ARRAY;
    v.scenarioFocusSet = new Set(v.scenarioFocusKeys);
    v.scenarioContextSet = new Set(v.scenarioContextKeys);
    core('scenarioIssueByKey', 'buildScenarioIssueByKey', { scenarioEffectiveIssues: v.scenarioEffectiveIssues });
    v.scenarioBaseStart = parseScenarioDate(v.scenarioConfig.start_date);
    v.scenarioDeadline = parseScenarioDate(v.scenarioConfig.quarter_end_date);
    core('scenarioBaseEnd', 'buildScenarioBaseEnd', { scenarioDeadline: v.scenarioDeadline, scenarioEffectiveIssues: v.scenarioEffectiveIssues });
    v.scenarioViewStart = scenarioRangeOverride?.start || v.scenarioBaseStart;
    v.scenarioViewEnd = scenarioRangeOverride?.end || v.scenarioBaseEnd;
    v.scenarioFocusEpicKey = scenarioEpicFocus?.key || null;
    core('scenarioFocusIssueKeys', 'buildScenarioFocusIssueKeys', {
        scenarioEffectiveIssues: v.scenarioEffectiveIssues, scenarioFocusEpicKey: v.scenarioFocusEpicKey });
    core('scenarioFocusContextKeys', 'buildScenarioFocusContextKeys', {
        scenarioDependencies: v.scenarioDependencies, scenarioFocusIssueKeys: v.scenarioFocusIssueKeys, scenarioFocusEpicKey: v.scenarioFocusEpicKey });
    core('scenarioTimelineIssues', 'buildScenarioTimelineIssues', {
        scenarioEffectiveIssues: v.scenarioEffectiveIssues, scenarioFilteredIssues: v.scenarioFilteredIssues, scenarioEpicFocus,
        scenarioFocusIssueKeys: v.scenarioFocusIssueKeys, scenarioFocusContextKeys: v.scenarioFocusContextKeys });
    core('scenarioTimelineWithSegments', 'buildScenarioTimelineWithSegments', {
        scenarioTimelineIssues: v.scenarioTimelineIssues, scenarioExcludedIssueKeys: v.scenarioExcludedIssueKeys,
        scenarioSprintBounds: v.scenarioSprintBounds, scenarioViewStart: v.scenarioViewStart, scenarioDeadline: v.scenarioDeadline });
    v.scenarioTimelineIssueKeys = new Set(v.scenarioTimelineWithSegments.map(issue => issue.key));
    core('scenarioAssigneeConflicts', 'buildScenarioAssigneeConflicts', {
        scenarioTimelineIssues: v.scenarioTimelineIssues, excludedEpicSet, normalizeEpicKey });
    core('scenarioDepViolations', 'buildScenarioDepViolations', {
        scenarioEditMode, scenarioDependencies: v.scenarioDependencies, scenarioIssueByKey: v.scenarioIssueByKey });
    core('scenarioDepViolatedKeys', 'buildScenarioDepViolatedKeys', { scenarioDepViolations: v.scenarioDepViolations });

    // useScenarioLayout (H6), wired as its memo call sites pass the H3 values and the layout state.
    const scenarioLaneForIssue = makeLaneForIssue(scenarioEpicFocus, scenarioLaneMode);
    core('scenarioLaneInfo', 'buildScenarioLaneInfo', {
        scenarioTimelineIssues: v.scenarioTimelineIssues, scenarioLaneMode, scenarioCapacityByTeam: v.scenarioCapacityByTeam,
        scenarioEpicFocus, scenarioFocusIssueKeys: v.scenarioFocusIssueKeys, scenarioExcludedIssueKeys: v.scenarioExcludedIssueKeys,
        scenarioAssigneeConflicts: v.scenarioAssigneeConflicts, scenarioLaneForIssue });
    v.scenarioSearchFilterEnabled = Boolean(v.scenarioSearchQuery && !scenarioEpicFocus);
    const summaryArgs = () => ({
        scenarioSummary: v.scenarioSummary, scenarioExcludedIssueKeys: v.scenarioExcludedIssueKeys,
        scenarioSearchFilterEnabled: v.scenarioSearchFilterEnabled, scenarioSearchMatchSet: v.scenarioSearchMatchSet });
    core('scenarioLateItems', 'buildScenarioLateItems', summaryArgs());
    v.scenarioDeadlineAtRisk = v.scenarioLateItems.length > 0;
    core('scenarioCriticalPathItems', 'buildScenarioCriticalPathItems', summaryArgs());
    core('scenarioUnschedulableItems', 'buildScenarioUnschedulableItems', summaryArgs());
    v.scenarioLanes = Array.from(v.scenarioLaneInfo.keys()).sort((a, b) => a.localeCompare(b));
    v.scenarioIssuesByLane = buildLaneIssues(v.scenarioTimelineWithSegments, scenarioLaneMode, scenarioLaneForIssue);
    core('scenarioTicks', 'buildScenarioTicks', { scenarioViewStart: v.scenarioViewStart, scenarioViewEnd: v.scenarioViewEnd });
    core('scenarioQuarterMarkers', 'buildScenarioQuarterMarkers', {
        scenarioViewStart: v.scenarioViewStart, scenarioViewEnd: v.scenarioViewEnd, scenarioDeadline: v.scenarioDeadline });
    v.SCENARIO_LANE_HEIGHT = 52;
    v.scenarioBarGap = scenarioEpicFocus ? 16 : SCENARIO_BAR_GAP;
    // Hook-level early return (the perf counter/marks around the core only run with perfEnabled, false in every case).
    if (!v.scenarioLanes || v.scenarioLanes.length === 0) {
        guarded.push('buildScenarioLaneStacking');
        v.scenarioLaneStacking = {
            rowIndexByKey: new Map(), laneRowCounts: new Map(), laneVisibleRows: new Map(),
            laneHiddenCounts: new Map(), laneRowAssignees: new Map(),
        };
    } else {
        core('scenarioLaneStacking', 'buildScenarioLaneStacking', {
            scenarioLanes: v.scenarioLanes, scenarioIssuesByLane: v.scenarioIssuesByLane, scenarioViewStart: v.scenarioViewStart,
            scenarioCollapsedLanes, scenarioLaneMode, scenarioCapacityByTeam: v.scenarioCapacityByTeam,
            scenarioExcludedIssueKeys: v.scenarioExcludedIssueKeys, scenarioEpicFocus, excludedEpicSet, normalizeEpicKey });
    }
    core('scenarioVisibleExportIssues', 'buildScenarioVisibleExportIssues', {
        scenarioTimelineWithSegments: v.scenarioTimelineWithSegments, scenarioShowConflictsOnly,
        scenarioAssigneeConflicts: v.scenarioAssigneeConflicts, scenarioLaneStacking: v.scenarioLaneStacking, scenarioLaneForIssue });
    v.scenarioJiraEpicKeys = collectJiraExportKeysFromScenarioIssues(v.scenarioVisibleExportIssues, 'epics');
    v.scenarioJiraStoryKeys = collectJiraExportKeysFromScenarioIssues(v.scenarioVisibleExportIssues, 'stories');
    core('scenarioLaneMeta', 'buildScenarioLaneMeta', {
        scenarioLanes: v.scenarioLanes, scenarioLaneStacking: v.scenarioLaneStacking, scenarioCollapsedLanes, scenarioEpicFocus,
        scenarioBarGap: v.scenarioBarGap });
    core('scenarioLaneAssigneeGroups', 'buildScenarioLaneAssigneeGroups', {
        scenarioLaneMode, scenarioLanes: v.scenarioLanes, scenarioLaneStacking: v.scenarioLaneStacking });
    // Hook-level early returns, in the hook's order (its development-only console.debug block is off under the
    // fixture's production NODE_ENV and has no observable output).
    if (!v.scenarioViewStart || !v.scenarioViewEnd) {
        guarded.push('buildScenarioPositions');
        v.scenarioPositions = {};
    } else if (!scenarioLayout.width) {
        guarded.push('buildScenarioPositions');
        v.scenarioPositions = {};
    } else {
        core('scenarioPositions', 'buildScenarioPositions', {
            scenarioTimelineWithSegments: v.scenarioTimelineWithSegments, scenarioViewStart: v.scenarioViewStart,
            scenarioViewEnd: v.scenarioViewEnd, scenarioLayout, scenarioLaneMeta: v.scenarioLaneMeta, scenarioBarGap: v.scenarioBarGap,
            scenarioLaneStacking: v.scenarioLaneStacking, scenarioLaneForIssue });
    }
    core('scenarioEdgeCandidates', 'buildScenarioEdgeCandidates', {
        scenarioDependencies: v.scenarioDependencies, scenarioTimelineIssueKeys: v.scenarioTimelineIssueKeys });
    core('scenarioEdgeIndex', 'buildScenarioEdgeIndex', { scenarioEdgeCandidates: v.scenarioEdgeCandidates });
    core('scenarioEpicBars', 'buildScenarioEpicBars', {
        scenarioIssuesByLane: v.scenarioIssuesByLane, scenarioLanes: v.scenarioLanes, scenarioLaneMode,
        scenarioViewStart: v.scenarioViewStart, scenarioViewEnd: v.scenarioViewEnd, scenarioLayout, scenarioLaneMeta: v.scenarioLaneMeta,
        scenarioIssueByKey: v.scenarioIssueByKey, scenarioEpicFocus, excludedEpicSet, SCENARIO_LANE_HEIGHT: v.SCENARIO_LANE_HEIGHT,
        normalizeEpicKey });
    core('scenarioEpicEdges', 'buildScenarioEpicEdges', {
        scenarioDependencies: v.scenarioDependencies, scenarioLaneMeta: v.scenarioLaneMeta, scenarioLaneMode,
        scenarioIssueByKey: v.scenarioIssueByKey, scenarioEpicFocus });
    // scenarioTodayLeft reads a no-arg new Date(); the oracle ran under a frozen clock.
    v.scenarioTodayLeft = (() => {
        if (!v.scenarioViewStart || !v.scenarioViewEnd) return null;
        if (!scenarioLayout.width) return null;
        const today = new Date(fixture.provenance.frozenNow);
        today.setHours(0, 0, 0, 0);
        const totalMs = Math.max(1, v.scenarioViewEnd - v.scenarioViewStart);
        const ratio = (today - v.scenarioViewStart) / totalMs;
        if (ratio < 0 || ratio > 1) return null;
        return scenarioLayout.labelWidth + scenarioLayout.width * ratio;
    })();
    core('scenarioVisibleLanes', 'buildScenarioVisibleLanes', {
        scenarioLanes: v.scenarioLanes, scenarioLaneMeta: v.scenarioLaneMeta, scenarioScrollTop, scenarioViewportHeight });
    core('scenarioActiveEdges', 'buildScenarioActiveEdges', { scenarioEdgeCandidates: v.scenarioEdgeCandidates, scenarioHoverKey });
    core('scenarioUpstreamSet', 'buildScenarioUpstreamSet', { scenarioHoverKey, scenarioEdgeIndex: v.scenarioEdgeIndex });
    core('scenarioDownstreamSet', 'buildScenarioDownstreamSet', { scenarioHoverKey, scenarioEdgeIndex: v.scenarioEdgeIndex });
    core('scenarioBlockedSet', 'buildScenarioBlockedSet', { scenarioDependencies: v.scenarioDependencies });
    v.scenarioBaselineEdges = v.scenarioEdgeCandidates;
    core('scenarioFocusEdges', 'buildScenarioFocusEdges', {
        scenarioEpicFocus, scenarioEdgeCandidates: v.scenarioEdgeCandidates, scenarioFocusIssueKeys: v.scenarioFocusIssueKeys,
        scenarioFocusContextKeys: v.scenarioFocusContextKeys });
    return { values: v, calls, guarded };
}

const loadDeps = async () => ({
    layout: await loadLayout(),
    parseScenarioDate: (await loadUtils()).parseScenarioDate,
    SCENARIO_BAR_GAP: (await loadUtils()).SCENARIO_BAR_GAP,
    buildLaneIssues: (await loadLaneUtils()).buildLaneIssues,
    collectJiraExportKeysFromScenarioIssues: (await loadExportUtils()).collectJiraExportKeysFromScenarioIssues,
    matchesScenarioSearch: loadMatchesScenarioSearch(),
    makeLaneForIssue: loadMakeLaneForIssue(),
});

// ------------------------------------------------------------------ tests
test('scenario layout oracle runs under the pinned UTC zone', () => {
    assert.equal(fixture.provenance.tz, 'UTC');
    assert.equal(process.env.TZ, 'UTC');
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC');
    assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), 0);
    assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), 0);
    assert.equal(new Date('2026-01-15T00:00:00').toISOString(), '2026-01-15T00:00:00.000Z');
});

test('scenarioLayout exports exactly the 36 pure cores in hook statement order', async () => {
    const layout = await loadLayout();
    assert.equal(EXPECTED_CORES.length, 36);
    assert.deepEqual(Object.keys(layout).sort(), EXPECTED_CORES.map(([, fn]) => fn).sort());
    for (const [, fn] of EXPECTED_CORES) assert.equal(typeof layout[fn], 'function', fn);
    const coreStatements = EXPECTED_CORES.map(([stmt]) => stmt);
    assert.deepEqual(fixture.statements.filter(s => coreStatements.includes(s)), coreStatements);
    for (const stmt of [...coreStatements, ...WIRING_STATEMENTS]) assert.ok(fixture.statements.includes(stmt), stmt);
});

test('scenario layout oracle cases are all exercised and every core is non-trivially covered', async () => {
    const deps = await loadDeps();
    assert.equal(fixture.cases.length, 18);
    assert.equal(new Set(fixture.cases.map(c => c.name)).size, 18);
    const isEmpty = (e) => {
        if (e === null || e === false || e === '') return true;
        if (Array.isArray(e)) return e.length === 0;
        if (typeof e !== 'object') return false;
        if ('$undefined' in e) return true;
        for (const tag of ['$frozen', '$set', '$map']) if (tag in e) return isEmpty(e[tag]);
        if ('$date' in e) return false;
        return Object.values(e).every(isEmpty);
    };
    const nonTrivial = Object.fromEntries(EXPECTED_CORES.map(([, fn]) => [fn, []]));
    const distinct = Object.fromEntries(EXPECTED_CORES.map(([, fn]) => [fn, new Set()]));
    const guardCounts = {};
    for (const testCase of fixture.cases) {
        const { calls, guarded } = runChain(decodeInputs(testCase), deps, (fn, args) => {
            const raw = deps.layout[fn](args);
            const out = encode(raw);
            const json = JSON.stringify(out);
            distinct[fn].add(json);
            // Non-trivial: a non-empty result that is not just one of the core's own inputs passed through.
            if (!isEmpty(out) && Object.values(args).every(a => JSON.stringify(encode(a)) !== json)) {
                nonTrivial[fn].push(testCase.name);
            }
            return raw;
        });
        assert.deepEqual(calls.map(c => c.fn),
            EXPECTED_CORES.map(([, fn]) => fn).filter(fn => !guarded.includes(fn)), testCase.name);
        guarded.forEach(fn => { guardCounts[fn] = (guardCounts[fn] || 0) + 1; });
    }
    // The early returns fire in exactly these many cases, so the cores themselves run in the other 16 / 15.
    assert.deepEqual(guardCounts, GUARDED_CORES);
    for (const [, fn] of EXPECTED_CORES) {
        assert.ok(nonTrivial[fn].length > 0, `${fn} has no non-trivial oracle case`);
        assert.ok(distinct[fn].size > 1, `${fn} output never varies across oracle cases`);
    }
});

for (const testCase of fixture.cases) {
    test(`scenario layout cores match oracle case ${testCase.name}`, async () => {
        const deps = await loadDeps();
        const { values } = runChain(decodeInputs(testCase), deps);
        for (const stmt of WIRING_STATEMENTS) {
            assert.deepStrictEqual(encode(values[stmt]), testCase.outputs[stmt], `${testCase.name} wiring ${stmt}`);
        }
        for (const [stmt, fn] of EXPECTED_CORES) {
            assert.ok(stmt in testCase.outputs, `${testCase.name} oracle lacks ${stmt}`);
            assert.deepStrictEqual(encode(values[stmt]), testCase.outputs[stmt], `${testCase.name} ${fn}`);
        }
    });
}

test('scenario layout cores are pure: repeatable and non-mutating on deep-frozen inputs', async () => {
    const deps = await loadDeps();
    for (const testCase of fixture.cases) {
        runChain(decodeInputs(testCase), deps, (fn, args) => {
            deepFreeze(args);
            const before = JSON.stringify(encode(args));
            const first = deps.layout[fn](args);
            const second = deps.layout[fn](args);
            const label = `${testCase.name} ${fn}`;
            assert.deepStrictEqual(encode(second), encode(first), `${label} repeat`);
            assert.equal(JSON.stringify(encode(args)), before, `${label} mutated its inputs`);
            const stmt = EXPECTED_CORES.find(([, f]) => f === fn)[0];
            assert.deepStrictEqual(stripFrozen(encode(first)), stripFrozen(testCase.outputs[stmt]), `${label} frozen-input oracle`);
            return first;
        });
    }
});

const DERIVED_RETURN_NAMES = ['scenarioSummary', 'scenarioBaseUrl', 'scenarioDependencies', 'scenarioCapacityByTeam',
    'scenarioIssues', 'scenarioSearchQuery', 'scenarioSearchMatchSet', 'scenarioExcludedIssueKeys', 'scenarioFocusSet',
    'scenarioContextSet', 'scenarioIssueByKey', 'scenarioDeadline', 'scenarioViewStart', 'scenarioViewEnd',
    'scenarioFocusIssueKeys', 'scenarioFocusContextKeys', 'scenarioTimelineIssues', 'scenarioTimelineWithSegments',
    'scenarioTimelineIssueKeys', 'scenarioAssigneeConflicts', 'scenarioDepViolations', 'scenarioDepViolatedKeys'];

const LAYOUT_RETURN_NAMES = ['registerScenarioIssueRef', 'scenarioLaneInfo', 'scenarioLateItems', 'scenarioDeadlineAtRisk',
    'scenarioCriticalPathItems', 'scenarioUnschedulableItems', 'scenarioIssuesByLane', 'scenarioTicks', 'scenarioQuarterMarkers',
    'SCENARIO_LANE_HEIGHT', 'scenarioBarGap', 'scenarioJiraEpicKeys', 'scenarioJiraStoryKeys', 'scenarioLaneMeta',
    'scenarioLaneAssigneeGroups', 'scenarioPositions', 'scenarioEpicBars', 'scenarioEpicEdges', 'scenarioTodayLeft',
    'scenarioVisibleLanes', 'scenarioUpstreamSet', 'scenarioDownstreamSet', 'scenarioBlockedSet', 'toggleScenarioLane',
    'showScenarioTooltip', 'showScenarioTooltipFromElement', 'moveScenarioTooltip', 'hideScenarioTooltip',
    'clearScenarioEpicFocus', 'focusScenarioEpic', 'scrollToScenarioIssue'];
// The returned layout values that are oracle statements (the other nine members are functions).
const LAYOUT_ORACLE_NAMES = LAYOUT_RETURN_NAMES.filter(name => fixture.statements.includes(name));
// The H3 values useScenarioPlanner forwards from useScenarioDerived into useScenarioLayout.
const LAYOUT_DERIVED_INPUTS = ['scenarioSummary', 'scenarioDependencies', 'scenarioCapacityByTeam', 'scenarioIssues',
    'scenarioSearchQuery', 'scenarioSearchMatchSet', 'scenarioExcludedIssueKeys', 'scenarioFocusSet', 'scenarioContextSet',
    'scenarioIssueByKey', 'scenarioDeadline', 'scenarioViewStart', 'scenarioViewEnd', 'scenarioFocusIssueKeys',
    'scenarioFocusContextKeys', 'scenarioTimelineIssues', 'scenarioTimelineWithSegments', 'scenarioTimelineIssueKeys',
    'scenarioAssigneeConflicts'];

test('useScenarioDerived and useScenarioLayout server render match every oracle case through their real wiring', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioDerived } from './useScenarioDerived.js'; export { useScenarioLayout } from './useScenarioLayout.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: scenarioDir, sourcefile: 'scenarioLayoutOracleProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(layoutHookPath, module);
    hookModule.filename = layoutHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, layoutHookPath);
    assert.equal(LAYOUT_RETURN_NAMES.length, 31);
    assert.equal(LAYOUT_ORACLE_NAMES.length, 22);
    // The oracle ran under a frozen clock (scenarioTodayLeft reads a no-arg new Date()) and a production NODE_ENV.
    const RealDate = Date;
    const frozenNow = RealDate.parse(fixture.provenance.frozenNow);
    class FrozenDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [frozenNow])); }
        static now() { return frozenNow; }
    }
    const savedNodeEnv = process.env.NODE_ENV;
    for (const testCase of fixture.cases) {
        const inputs = decodeInputs(testCase);
        const scenarioViewRangeRef = { current: 'stale' };
        const perfCountersRef = inputs.perfCountersRef;
        const perfCountersBefore = JSON.stringify(perfCountersRef);
        let derived;
        let result;
        function Probe() {
            const scenarioState = {
                ...hookModule.exports.useScenarioState({ initialLaneMode: inputs.scenarioLaneMode }),
                scenarioData: inputs.scenarioData, scenarioLaneMode: inputs.scenarioLaneMode,
                scenarioShowConflictsOnly: inputs.scenarioShowConflictsOnly, scenarioLayout: inputs.scenarioLayout,
                scenarioCollapsedLanes: inputs.scenarioCollapsedLanes, scenarioHoverKey: inputs.scenarioHoverKey,
                scenarioScrollTop: inputs.scenarioScrollTop, scenarioViewportHeight: inputs.scenarioViewportHeight,
                scenarioEpicFocus: inputs.scenarioEpicFocus, scenarioRangeOverride: inputs.scenarioRangeOverride,
                scenarioOverrides: inputs.scenarioOverrides, scenarioEditMode: inputs.scenarioEditMode, scenarioViewRangeRef,
            };
            derived = hookModule.exports.useScenarioDerived({
                scenarioState,
                EMPTY_ARRAY: inputs.EMPTY_ARRAY, EMPTY_OBJECT: inputs.EMPTY_OBJECT, jiraUrl: inputs.jiraUrl,
                searchQuery: inputs.searchQuery, normalizeEpicKey: inputs.normalizeEpicKey, excludedEpicSet: inputs.excludedEpicSet,
            });
            result = hookModule.exports.useScenarioLayout({
                scenarioState, perfEnabled: inputs.perfEnabled, perfCountersRef, showScenario: true,
                normalizeEpicKey: inputs.normalizeEpicKey, isAllTeamsSelected: inputs.isAllTeamsSelected,
                excludedEpicSet: inputs.excludedEpicSet,
                ...Object.fromEntries(LAYOUT_DERIVED_INPUTS.map(name => [name, derived[name]])),
            });
            return null;
        }
        globalThis.Date = FrozenDate;
        process.env.NODE_ENV = fixture.provenance.processEnvNodeEnv;
        try {
            assert.equal(renderToString(React.createElement(Probe)), '');
        } finally {
            globalThis.Date = RealDate;
            if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = savedNodeEnv;
        }
        assert.deepEqual(Object.keys(derived), DERIVED_RETURN_NAMES, testCase.name);
        for (const name of DERIVED_RETURN_NAMES) {
            assert.deepStrictEqual(encode(derived[name]), testCase.outputs[name], `${testCase.name} ${name}`);
        }
        assert.deepStrictEqual(encode(scenarioViewRangeRef.current),
            { start: testCase.outputs.scenarioViewStart, end: testCase.outputs.scenarioViewEnd }, `${testCase.name} view range ref`);
        assert.deepEqual(Object.keys(result), LAYOUT_RETURN_NAMES, testCase.name);
        for (const name of LAYOUT_RETURN_NAMES) {
            if (LAYOUT_ORACLE_NAMES.includes(name)) {
                assert.deepStrictEqual(encode(result[name]), testCase.outputs[name], `${testCase.name} layout ${name}`);
            } else {
                assert.equal(typeof result[name], 'function', `${testCase.name} layout ${name}`);
            }
        }
        assert.equal(JSON.stringify(perfCountersRef), perfCountersBefore, `${testCase.name} perf counters untouched with perf off`);
    }
});
