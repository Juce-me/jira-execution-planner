const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');
const ownerPath = path.resolve(__dirname, '../frontend/src/eng/useEngCapacity.js');
// Frozen before extraction from accepted Task 4; fixtures are synthetic.
const STATE_NAMES = ["capacityState", "setCapacityState", "capacityStateRef", "capacityLoading", "setCapacityLoading", "capacityReadRevision", "setCapacityReadRevision", "capacityReadError", "setCapacityReadError", "capacityDataStale", "setCapacityDataStale", "capacityReadModelRef", "capacityRefreshNonce", "setCapacityRefreshNonce", "capacityReadGenerationRef", "capacityReadAbortRef", "activeCapacityScopeRef", "capacityScopeHoldRef", "capacityScopePinRef", "capacityScopeKeyRef"];
const OUTPUT_NAMES = ["selectedAdHocProductSP", "excludedProjectStats", "capacityShareLabel", "teamCapacityEntries", "displayedTeamCapacityEntries", "capacityScopeSignature", "effectiveCapacityState", "capacityMutationEnabled", "handleCapacitySaved", "retryCapacity", "capacityTeamIds", "totalCapacityAdjusted", "estimatedCapacityAdjusted", "excludedCapacityAdjusted", "capacitySummary", "selectedProjectEntries", "selectedTeamEntries", "capacityTotals", "showTotalsRow", "formatCapacityValue"];

function load(react = React, request = () => { throw new Error('SSR must not fetch'); }) {
    const code = esbuild.buildSync({ entryPoints: [ownerPath], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', '../api/capacityApi.js'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, name => name === 'react' ? react : name === '../api/capacityApi.js' ? { fetchCapacity: request } : require(name));
    return module.exports;
}
const signature = '{"sprintName":"Sprint 7","teams":["team a","team b"]}';
const task = (key, teamId, teamName, sp, epicKey = 'PROD-1') => ({ key, fields: { teamId, teamName, customfield_10004: sp, epicKey, projectKey: 'PROD', status: { name: 'In Progress' } } });
function inputs(state, overrides = {}) {
    const tasks = [task('PROD-11', 'team-a', 'Team A', 8), task('PROD-12', 'team-b', 'Team B', 5)];
    return {
        scope: { activeGroupId: 'group-a', selectedSprintInfo: { name: 'Sprint 7' }, isAllTeamsSelected: true, selectedTeamSet: new Set(['team-a', 'team-b']), teamOptions: [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }], capacityTasks: tasks, techProjectKeys: new Set(['TECH']), excludedEpicSet: new Set(), adHocEpicSet: new Set(), adHocEpicSignature: '' },
        ...state, showPlanning: true, capacityEnabled: true, showProduct: true, showTech: false,
        selectedTasksList: tasks, selectedPlanningTasksList: tasks, selectedSP: 13,
        getTeamInfo: task => ({ id: task.fields.teamId, name: task.fields.teamName }),
        normalizeStatus: value => String(value || '').toLowerCase(), normalizeEpicKey: value => String(value || ''),
        BACKEND_URL: 'https://synthetic.invalid', loadEpochRef: { current: 1 }, epicGroups: [], epicRefMap: { current: new Map() }, ...overrides,
    };
}
function ssr(overrides = {}) {
    const hooks = load(); let state, result;
    function Probe() { state = hooks.useEngCapacityState(); result = hooks.useEngCapacity(inputs(state, overrides)); return null; }
    renderToString(React.createElement(Probe));
    assert.deepEqual(Object.keys(state).sort(), STATE_NAMES.slice().sort());
    assert.deepEqual(Object.keys(result).sort(), OUTPUT_NAMES.slice().sort());
    return { state, result };
}
test('mounted state exposes exactly twenty cells/refs and the initial atomic model', () => {
    const { state } = ssr();
    assert.deepEqual(state.capacityState, { capacityByTeam: {}, capacityTargetsByTeam: {}, capacityIssueCount: null, mutationEnabled: false, scopeSignature: '' });
    assert.equal(state.capacityStateRef.current, state.capacityState);
    assert.deepEqual(state.capacityReadModelRef.current, { capacityState: state.capacityState, capacityLoading: false, capacityReadRevision: 0, capacityReadError: '', capacityDataStale: false });
    assert.equal(state.capacityRefreshNonce, 0); assert.equal(state.capacityReadGenerationRef.current, 0);
    assert.equal(state.capacityReadAbortRef.current, null); assert.equal(state.capacityScopeHoldRef.current, false);
});
test('SSR freezes twenty outputs and adjusted totals/selected Team entries', () => {
    const capacityState = { capacityByTeam: { 'team a': 10, 'team b': 20 }, capacityTargetsByTeam: {}, capacityIssueCount: 2, mutationEnabled: true, scopeSignature: signature };
    const { result } = ssr({ capacityState });
    assert.equal(result.capacityScopeSignature, signature);
    assert.deepEqual([result.totalCapacityAdjusted, result.estimatedCapacityAdjusted, result.excludedCapacityAdjusted], [21, 21, 0]);
    assert.deepEqual(result.selectedTeamEntries.map(row => [row.id, row.storyPoints, row.teamCapacity, row.planningCapacity]), [['team-a', 8, 7, 7], ['team-b', 5, 14, 14]]);
    assert.deepEqual(result.capacityTeamIds, ['team-a', 'team-b']);
    assert.equal(result.capacityMutationEnabled, true); assert.equal(result.formatCapacityValue(1.25), '1.3');
});
// Controlled hook runner executes the real owner effect, reducers and API binding.
// React browser lifecycle, mounted editor and hold-window proof remain in Playwright.
function controlled() {
    const cells = []; let index = 0, effect;
    const react = { useState(initial) { const slot = index++; if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial; return [cells[slot], value => { cells[slot] = typeof value === 'function' ? value(cells[slot]) : value; }]; }, useRef(initial) { const slot = index++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot]; }, useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => { effect = fn; } };
    const reads = [];
    const hooks = load(react, (url, options) => new Promise((resolve, reject) => reads.push({ url, options, resolve, reject })));
    let state, result;
    function render(overrides = {}) { index = 0; state = hooks.useEngCapacityState(); result = hooks.useEngCapacity(inputs(state, overrides)); return { state, result }; }
    return { render, run: () => effect(), reads };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('read effect preserves scoped GET payload, success revision, save reconciliation and retry', async () => {
    const run = controlled(); let current = run.render(); const cleanup = run.run();
    assert.equal(run.reads.length, 1); const read = run.reads[0];
    assert.equal(read.url, 'https://synthetic.invalid');
    assert.deepEqual(read.options.teams, ['Team A', 'Team B']); assert.equal(read.options.sprintName, 'Sprint 7');
    assert.equal(read.options.signal.aborted, false);
    read.resolve({ ok: true, json: async () => ({ enabled: true, capacities: { 'Team A': 10 }, entries: [{ issueKey: 'CAP-1', teamName: 'Team A', capacity: 10 }], mutationEnabled: true }) }); await settle();
    current = run.render(); assert.equal(current.state.capacityReadRevision, 1); assert.equal(current.state.capacityLoading, false); assert.equal(current.result.capacityMutationEnabled, true);
    current.result.handleCapacitySaved({ scopeSignature: 'foreign', issueKey: 'CAP-1', teamName: 'Team A', capacity: 99 });
    assert.equal(run.render().state.capacityState.capacityByTeam['team a'], 10);
    current.result.handleCapacitySaved({ scopeSignature: signature, issueKey: 'CAP-1', teamName: 'Team A', capacity: 12 });
    current = run.render(); assert.equal(current.state.capacityState.capacityByTeam['team a'], 12); assert.equal(current.state.capacityReadRevision, 1);
    current.result.retryCapacity(); assert.equal(run.render().state.capacityRefreshNonce, 1);
    cleanup(); assert.equal(read.options.signal.aborted, true);
});
test('cleanup cancels reads and stale settlements cannot advance state; retry failure stays stale', async () => {
    const run = controlled(); run.render(); const cleanup = run.run(); cleanup();
    run.reads[0].resolve({ ok: true, json: async () => ({ enabled: true, capacities: { 'Team A': 99 } }) }); await settle();
    assert.equal(run.render().state.capacityReadRevision, 0);
    run.run(); run.reads[1].resolve({ ok: true, json: async () => ({ enabled: true, capacities: { 'Team A': 10 } }) }); await settle();
    run.render(); run.run(); run.reads[2].reject(new Error('offline')); await settle();
    const { state } = run.render(); assert.equal(state.capacityReadRevision, 1); assert.equal(state.capacityDataStale, true); assert.equal(state.capacityLoading, false); assert.equal(state.capacityState.capacityByTeam['team a'], 10);
});
test('state has no effects and lifecycle keeps its scalar dependencies and App mutation boundary', () => {
    const source = fs.readFileSync(ownerPath, 'utf8');
    assert.equal((source.match(/\buseEffect\(/g) || []).length, 1);
    assert.doesNotMatch(source.slice(source.indexOf('export function useEngCapacityState'), source.indexOf('export function useEngCapacity(')), /useEffect/);
    assert.match(source, /\[capacityEnabled, showPlanning, capacityScopeSignature, capacityRefreshNonce\]/);
    assert.doesNotMatch(source, /updateCapacity|dashboard\.jsx/);
});
