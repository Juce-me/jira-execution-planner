const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../frontend/src/scenario/scenarioGroupState.js');

const EXPECTED_KEYS = [
    'scenarioData', 'scenarioError', 'scenarioLaneMode', 'scenarioCollapsedLanes', 'scenarioEpicFocus',
    'scenarioRangeOverride', 'scenarioScrollTop', 'scenarioScrollLeft', 'scenarioViewportHeight',
    'scenarioHoverKey', 'scenarioFlashKey', 'scenarioLayout', 'scenarioEdgeRender', 'scenarioTooltip',
];
const SETTER_NAMES = [...EXPECTED_KEYS, 'scenarioLoading'].map((key) => `set${key[0].toUpperCase()}${key.slice(1)}`);

function recordingSetters() {
    const calls = {};
    const setters = {};
    for (const name of SETTER_NAMES) setters[name] = (value) => { calls[name] = value; };
    return { calls, setters };
}

function nineRefs(overrides = {}) {
    return {
        scenarioIssueRefMap: { current: new Map([['A-1', {}]]) },
        scenarioEdgeUpdatePendingRef: { current: true },
        scenarioFocusRestoreRef: { current: { x: 1 } },
        scenarioSkipAutoCollapseRef: { current: true },
        scenarioTeamCollapseInitRef: { current: true },
        scenarioEdgeFrameRef: { current: 11 },
        scenarioScrollFrameRef: { current: 12 },
        scenarioResizeFrameRef: { current: 13 },
        scenarioPendingScrollRef: { current: { top: 1 } },
        ...overrides,
    };
}

test('group state keys match the 14 fields the App snapshot carries', async () => {
    const { SCENARIO_GROUP_STATE_KEYS } = await load();
    assert.deepEqual([...SCENARIO_GROUP_STATE_KEYS], EXPECTED_KEYS);
});

test('default group state mirrors the previous buildDefaultGroupState literal', async () => {
    const { buildDefaultScenarioGroupState } = await load();
    assert.deepEqual(buildDefaultScenarioGroupState('assignee'), {
        scenarioData: null,
        scenarioError: '',
        scenarioLaneMode: 'assignee',
        scenarioCollapsedLanes: {},
        scenarioEpicFocus: null,
        scenarioRangeOverride: null,
        scenarioScrollTop: 0,
        scenarioScrollLeft: 0,
        scenarioViewportHeight: 0,
        scenarioHoverKey: null,
        scenarioFlashKey: null,
        scenarioLayout: { width: 0, height: 0 },
        scenarioEdgeRender: { width: 0, height: 0, paths: [] },
        scenarioTooltip: {
            visible: false, x: 0, y: 0, summary: '', key: '', sp: null, note: '', assignee: null, team: null,
        },
    });
    assert.equal(buildDefaultScenarioGroupState(undefined).scenarioLaneMode, 'team');
});

test('applying a null snapshot calls all 15 setters with the old fallbacks', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, null);
    assert.deepEqual(Object.keys(calls).sort(), [...SETTER_NAMES].sort());
    assert.equal(calls.setScenarioData, null);
    assert.equal(calls.setScenarioError, '');
    assert.equal(calls.setScenarioLaneMode, 'team');
    assert.deepEqual(calls.setScenarioCollapsedLanes, {});
    assert.equal(calls.setScenarioEpicFocus, null);
    assert.equal(calls.setScenarioRangeOverride, null);
    assert.equal(calls.setScenarioScrollTop, 0);
    assert.equal(calls.setScenarioScrollLeft, 0);
    assert.equal(calls.setScenarioViewportHeight, 0);
    assert.equal(calls.setScenarioHoverKey, null);
    assert.equal(calls.setScenarioFlashKey, null);
    assert.deepEqual(calls.setScenarioLayout, { width: 0, height: 0 });
    assert.deepEqual(calls.setScenarioEdgeRender, { width: 0, height: 0, paths: [] });
    assert.equal(calls.setScenarioTooltip.visible, false);
    assert.equal(calls.setScenarioLoading, false);
});

test('applying a snapshot passes captured values through and always clears loading', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, { scenarioLaneMode: 'assignee', scenarioScrollTop: 40, scenarioError: 'x' });
    assert.equal(calls.setScenarioLaneMode, 'assignee');
    assert.equal(calls.setScenarioScrollTop, 40);
    assert.equal(calls.setScenarioError, 'x');
    assert.equal(calls.setScenarioLoading, false);
});

test('falsy snapshot values fall back with || (not ??), as the old applyGroupState did', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, { scenarioLaneMode: '', scenarioScrollTop: null, scenarioError: undefined });
    assert.equal(calls.setScenarioLaneMode, 'team');
    assert.equal(calls.setScenarioScrollTop, 0);
    assert.equal(calls.setScenarioError, '');
});

test('resetScenarioTransientRefs clears refs and cancels pending animation frames in order', async () => {
    const { resetScenarioTransientRefs } = await load();
    const cancelled = [];
    globalThis.window = { cancelAnimationFrame: (id) => cancelled.push(id) };
    try {
        const refs = nineRefs();
        resetScenarioTransientRefs(refs);
        assert.equal(refs.scenarioIssueRefMap.current.size, 0);
        assert.equal(refs.scenarioEdgeUpdatePendingRef.current, false);
        assert.equal(refs.scenarioFocusRestoreRef.current, null);
        assert.equal(refs.scenarioSkipAutoCollapseRef.current, false);
        assert.equal(refs.scenarioTeamCollapseInitRef.current, false);
        assert.equal(refs.scenarioEdgeFrameRef.current, null);
        assert.equal(refs.scenarioScrollFrameRef.current, null);
        assert.equal(refs.scenarioResizeFrameRef.current, null);
        assert.equal(refs.scenarioPendingScrollRef.current, null);
        assert.deepEqual(cancelled, [11, 12, 13]);
    } finally {
        delete globalThis.window;
    }
});

test('resetScenarioTransientRefs does not cancel frames that are not pending', async () => {
    const { resetScenarioTransientRefs } = await load();
    const cancelled = [];
    globalThis.window = { cancelAnimationFrame: (id) => cancelled.push(id) };
    try {
        const refs = nineRefs({
            scenarioEdgeFrameRef: { current: null },
            scenarioScrollFrameRef: { current: null },
            scenarioResizeFrameRef: { current: null },
        });
        resetScenarioTransientRefs(refs);
        assert.deepEqual(cancelled, []);
    } finally {
        delete globalThis.window;
    }
});

const EXPECTED_STATE_RETURN_NAMES = `
scenarioCurrentUserIdentity
setScenarioCurrentUserIdentity
scenarioLoading
setScenarioLoading
scenarioError
setScenarioError
scenarioData
setScenarioData
scenarioLaneMode
setScenarioLaneMode
scenarioShowConflictsOnly
setScenarioShowConflictsOnly
scenarioTimelineRef
scenarioLayout
setScenarioLayout
scenarioCollapsedLanes
setScenarioCollapsedLanes
scenarioCollapsedCards
setScenarioCollapsedCards
scenarioSummaryHidden
setScenarioSummaryHidden
scenarioHoverKey
setScenarioHoverKey
scenarioFlashKey
setScenarioFlashKey
scenarioScrollTop
setScenarioScrollTop
scenarioScrollLeft
setScenarioScrollLeft
scenarioViewportHeight
setScenarioViewportHeight
scenarioEpicFocus
setScenarioEpicFocus
scenarioRangeOverride
setScenarioRangeOverride
scenarioFocusRestoreRef
scenarioSkipAutoCollapseRef
scenarioTeamCollapseInitRef
scenarioHistoryButtonRef
scenarioHistoryPanelRef
scenarioHistoryTitleRef
scenarioOverrides
setScenarioOverrides
scenarioActiveDraftIdRef
scenarioScopeKeyRef
scenarioDraftMeta
setScenarioDraftMeta
scenarioDraftEvents
setScenarioDraftEvents
scenarioDraftPresence
setScenarioDraftPresence
scenarioDraftLocks
setScenarioDraftLocks
scenarioDraftRealtimeStatus
setScenarioDraftRealtimeStatus
scenarioDraftLastEventNumber
setScenarioDraftLastEventNumber
scenarioEditMode
setScenarioEditMode
scenarioUndoStackRef
scenarioUndoVersion
setScenarioUndoVersion
scenarioDragState
setScenarioDragState
scenarioDragStateRef
scenarioDragFrameRef
scenarioDragLockRefreshRef
scenarioRealtimeCsrfRef
scenarioHistoryRefreshControllerRef
scenarioHistoryActionControllerRef
scenarioViewRangeRef
scenarioWasDraggedRef
scenarioEdgeUpdatePendingRef
scenarioEdgeFrameRef
scenarioScrollFrameRef
scenarioResizeFrameRef
scenarioPendingScrollRef
scenarioTooltip
setScenarioTooltip
scenarioTooltipRef
scenarioTooltipAnchorRef
scenarioIssueRefMap
scenarioEdgeRender
setScenarioEdgeRender
scenarioRefreshNonceRef
scenarioGroupValues
`.trim().split(/\s+/);

test('state hook preserves its exact flat interface and server-render defaults', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const path = require('node:path');
    const Module = require('node:module');
    const fs = require('node:fs');
    const hookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioState.js');
    const source = fs.readFileSync(hookPath, 'utf8');
    assert.doesNotMatch(source, /\buse(?:Effect|LayoutEffect|InsertionEffect)\b/);
    const compiled = esbuild.buildSync({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs',
        platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(hookPath, module);
    hookModule.filename = hookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, hookPath);
    let state;
    function Probe() {
        state = hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    assert.deepEqual(Object.keys(state), EXPECTED_STATE_RETURN_NAMES);
    for (const name of EXPECTED_STATE_RETURN_NAMES) {
        assert.equal(Object.getOwnPropertyDescriptor(state, name).get, undefined);
    }
    assert.equal(state.scenarioLaneMode, 'assignee');
    assert.equal(state.scenarioLoading, false);
    assert.equal(state.scenarioData, null);
    assert.equal(state.scenarioError, '');
    assert.equal(state.scenarioEditMode, false);
    assert.equal(state.scenarioSummaryHidden, true);
    assert.equal(state.scenarioUndoVersion, 0);
    assert.deepEqual(state.scenarioCurrentUserIdentity, { userId: '', displayName: '' });
    assert.deepEqual(state.scenarioDraftEvents, []);
    assert.deepEqual(state.scenarioOverrides, {});
    assert.equal(state.scenarioDraftMeta.dirtyState, 'clean');
    assert.equal(state.scenarioTimelineRef.current, null);
    assert.equal(state.scenarioRefreshNonceRef.current, 0);
    assert(state.scenarioIssueRefMap.current instanceof Map);
    assert.equal(state.scenarioIssueRefMap.current.size, 0);
    assert.deepEqual(Object.keys(state.scenarioGroupValues), EXPECTED_KEYS);
    for (const key of EXPECTED_KEYS) assert.equal(state.scenarioGroupValues[key], state[key]);
});
