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
const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures/scenario-layout-oracle-example-sanitized.json'), 'utf8'));

const loadLayout = () => import(pathToFileURL(layoutPath).href);
const loadUtils = () => import(pathToFileURL(path.join(scenarioDir, 'scenarioUtils.js')).href);

// The search predicate stays in the hook and is passed into the search core.
const loadMatchesScenarioSearch = () => {
    const source = fs.readFileSync(derivedHookPath, 'utf8');
    const match = source.match(/const matchesScenarioSearch = \([\s\S]*?\n\s*\};/);
    assert.ok(match, 'Expected matchesScenarioSearch in useScenarioDerived.js');
    return vm.runInNewContext(`${match[0]}\nmatchesScenarioSearch`);
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
];
// Hook statements computed inline (not cores); recomputed here exactly as useScenarioDerived does.
const WIRING_STATEMENTS = ['scenarioRawIssues', 'scenarioConfig', 'scenarioSummary', 'scenarioBaseUrl',
    'scenarioDependencies', 'scenarioCapacityByTeam', 'scenarioSearchQuery', 'scenarioFocusKeys',
    'scenarioContextKeys', 'scenarioBaseStart', 'scenarioDeadline', 'scenarioViewStart', 'scenarioViewEnd',
    'scenarioFocusEpicKey'];

// Runs the 15 cores in hook statement order. `call(fn, args)` invokes one core; calls are recorded.
function runChain(inputs, { layout, parseScenarioDate, matchesScenarioSearch }, call = (fn, args) => layout[fn](args)) {
    const {
        EMPTY_ARRAY, EMPTY_OBJECT, jiraUrl, searchQuery, normalizeEpicKey, excludedEpicSet,
        scenarioData, scenarioEpicFocus, scenarioRangeOverride, scenarioOverrides, scenarioEditMode,
    } = inputs;
    const v = {};
    const calls = [];
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
    core('scenarioAssigneeConflicts', 'buildScenarioAssigneeConflicts', {
        scenarioTimelineIssues: v.scenarioTimelineIssues, excludedEpicSet, normalizeEpicKey });
    core('scenarioDepViolations', 'buildScenarioDepViolations', {
        scenarioEditMode, scenarioDependencies: v.scenarioDependencies, scenarioIssueByKey: v.scenarioIssueByKey });
    core('scenarioDepViolatedKeys', 'buildScenarioDepViolatedKeys', { scenarioDepViolations: v.scenarioDepViolations });
    return { values: v, calls };
}

const loadDeps = async () => ({
    layout: await loadLayout(),
    parseScenarioDate: (await loadUtils()).parseScenarioDate,
    matchesScenarioSearch: loadMatchesScenarioSearch(),
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

test('scenarioLayout exports exactly the 15 pure cores in hook statement order', async () => {
    const layout = await loadLayout();
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
    for (const testCase of fixture.cases) {
        const { calls } = runChain(decodeInputs(testCase), deps, (fn, args) => {
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
        assert.deepEqual(calls.map(c => c.fn), EXPECTED_CORES.map(([, fn]) => fn), testCase.name);
    }
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

test('useScenarioDerived server render matches every oracle case through its real wiring', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioDerived } from './useScenarioDerived.js';",
            resolveDir: scenarioDir, sourcefile: 'scenarioDerivedOracleProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(derivedHookPath, module);
    hookModule.filename = derivedHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, derivedHookPath);
    for (const testCase of fixture.cases) {
        const inputs = decodeInputs(testCase);
        const scenarioViewRangeRef = { current: 'stale' };
        let result;
        function Probe() {
            result = hookModule.exports.useScenarioDerived({
                scenarioState: {
                    scenarioData: inputs.scenarioData, scenarioEpicFocus: inputs.scenarioEpicFocus,
                    scenarioRangeOverride: inputs.scenarioRangeOverride, scenarioOverrides: inputs.scenarioOverrides,
                    scenarioEditMode: inputs.scenarioEditMode, scenarioViewRangeRef,
                },
                EMPTY_ARRAY: inputs.EMPTY_ARRAY, EMPTY_OBJECT: inputs.EMPTY_OBJECT, jiraUrl: inputs.jiraUrl,
                searchQuery: inputs.searchQuery, normalizeEpicKey: inputs.normalizeEpicKey, excludedEpicSet: inputs.excludedEpicSet,
            });
            return null;
        }
        assert.equal(renderToString(React.createElement(Probe)), '');
        assert.deepEqual(Object.keys(result), DERIVED_RETURN_NAMES, testCase.name);
        for (const name of DERIVED_RETURN_NAMES) {
            assert.deepStrictEqual(encode(result[name]), testCase.outputs[name], `${testCase.name} ${name}`);
        }
        assert.deepStrictEqual(encode(scenarioViewRangeRef.current),
            { start: testCase.outputs.scenarioViewStart, end: testCase.outputs.scenarioViewEnd }, `${testCase.name} view range ref`);
    }
});
