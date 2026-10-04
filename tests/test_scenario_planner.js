const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const hookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioPlanner.js');

const EXPECTED_RETURN_NAMES = `
registerScenarioIssueRef
runScenario
toggleScenarioEditMode
handleScenarioBarMouseDown
scenarioBaseUrl
scenarioHasUnsavedChanges
scenarioCanSaveDraft
scenarioRemoteEditors
scenarioIssueLockWarnings
scenarioSearchQuery
scenarioSearchMatchSet
scenarioIssueByKey
scenarioViewStart
scenarioViewEnd
scenarioFocusIssueKeys
scenarioFocusContextKeys
scenarioAssigneeConflicts
scenarioDepViolations
scenarioDepViolatedKeys
scenarioUndo
scenarioRedo
scenarioOverrideCount
saveScenarioDraft
discardScenarioOverrides
openScenarioDraftHistory
closeScenarioDraftHistory
requestReloadActiveDraft
cancelReloadActiveDraft
runReloadActiveDraft
requestScenarioHistoryAction
cancelScenarioHistoryAction
requestScenarioReloadFromJira
cancelScenarioReloadFromJira
runScenarioReloadFromJira
previewScenarioDraftWriteback
checkScenarioDraftWritebackGate
runScenarioHistoryAction
scenarioLaneInfo
scenarioLateItems
scenarioDeadlineAtRisk
scenarioCriticalPathItems
scenarioUnschedulableItems
scenarioIssuesByLane
scenarioTicks
scenarioQuarterMarkers
SCENARIO_LANE_HEIGHT
scenarioBarGap
scenarioJiraEpicKeys
scenarioJiraStoryKeys
scenarioLaneMeta
scenarioLaneAssigneeGroups
scenarioPositions
scenarioEpicBars
scenarioEpicEdges
scenarioTodayLeft
scenarioVisibleLanes
scenarioUpstreamSet
scenarioDownstreamSet
scenarioBlockedSet
toggleScenarioLane
showScenarioTooltip
showScenarioTooltipFromElement
moveScenarioTooltip
hideScenarioTooltip
clearScenarioEpicFocus
focusScenarioEpic
scrollToScenarioIssue
`.trim().split(/\s+/);

test('planner hook preserves its exact flat interface and server-render defaults', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioPlanner } from './useScenarioPlanner.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(hookPath), sourcefile: 'scenarioPlannerProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(hookPath, module);
    hookModule.filename = hookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, hookPath);
    const noop = () => {};
    let result;
    function Probe() {
        const scenarioState = hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' });
        result = hookModule.exports.useScenarioPlanner({
            scenarioState, BACKEND_URL: '', EMPTY_ARRAY: [], EMPTY_OBJECT: {},
            perfEnabled: false, perfCountersRef: { current: {} },
            pendingConnectionRecoveryRef: { current: null },
            releaseConnectionRecoveryOwnership: noop,
            connectionRecoveryScenarioStartedRef: { current: false },
            setConnectionRecoveryNotice: noop, setConnectionRecoveryStatus: noop,
            connectionRecoveryStagedRevision: 0, selectedSprint: '', availableSprints: [],
            sprintsLoading: false, groupsLoading: false, activeGroupId: '', jiraUrl: '',
            showScenario: false, searchQuery: '', pendingShellAuthResumeRef: { current: null },
            selectedSprintInfo: null, trackScenarioAction: noop, visibleControlGroups: [],
            selectedSprintState: '', isCompletedSprintSelected: false,
            normalizeEpicKey: value => String(value || '').toUpperCase(),
            registerSprintFetch: noop, cleanupSprintFetch: noop,
            activeGroup: null, teamOptions: [], selectedTeamSet: new Set(),
            isAllTeamsSelected: true, excludedEpicSet: new Set(),
        });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    assert.deepEqual(Object.keys(result), EXPECTED_RETURN_NAMES);
    assert.equal(EXPECTED_RETURN_NAMES.length, 67);
    for (const name of EXPECTED_RETURN_NAMES) {
        assert.equal(Object.getOwnPropertyDescriptor(result, name).get, undefined);
    }
    assert.equal(result.scenarioBaseUrl, '');
    assert.equal(result.scenarioHasUnsavedChanges, false);
    assert.equal(result.scenarioCanSaveDraft, false);
    assert.equal(result.scenarioOverrideCount, 0);
    assert.equal(result.scenarioSearchQuery, '');
    assert.deepEqual(result.scenarioRemoteEditors, []);
    assert.deepEqual(result.scenarioIssueLockWarnings, []);
    assert.deepEqual(result.scenarioJiraEpicKeys, []);
    assert.deepEqual(result.scenarioJiraStoryKeys, []);
    for (const name of ['runScenario', 'scenarioUndo', 'scenarioRedo', 'saveScenarioDraft',
        'openScenarioDraftHistory', 'closeScenarioDraftHistory', 'focusScenarioEpic']) {
        assert.equal(typeof result[name], 'function');
    }
});

// Legacy output captured from the unchanged App body at the SC2 base before extraction.
const EXPECTED_IDLE_ACTION_STATE = {
    "loadingVersionNumber": null,
    "loadingActiveDraft": false,
    "rollingBackVersionNumber": null,
    "reloadingFromJira": false,
    "pendingHistoryAction": null,
    "pendingActiveDraftReload": false,
    "pendingReloadFromJira": false,
    "writebackPreviewing": false,
    "writebackChecking": false,
    "writebackPreview": null,
    "writebackBlocked": null
};

test('planner idle action state preserves the legacy pure helper output', () => {
    const source = fs.readFileSync(hookPath, 'utf8');
    const match = source.match(/const scenarioDraftIdleActionState = \(\) => \(\{[\s\S]*?\n\s*\}\);/);
    assert.ok(match, 'Expected the existing pure scenarioDraftIdleActionState body');
    const read = () => JSON.parse(vm.runInNewContext(`${match[0]}\nJSON.stringify(scenarioDraftIdleActionState())`));
    const first = read();
    assert.deepEqual(first, EXPECTED_IDLE_ACTION_STATE);
    assert.deepEqual(read(), EXPECTED_IDLE_ACTION_STATE);
});

// Synthetic fixtures and outputs captured from exact SC2-base App helper bodies.
const pureHelperCases = {
    matchesScenarioSearch: () => [
        [null, ''], [{ summary: 'Build Feature', key: 'DEMO-1' }, 'build'],
        [{ summary: 'Build Feature' }, 'Build'], [{ key: 'DEMO-1' }, 'demo'],
        [{ epicKey: 'EPIC-1', epicSummary: 'Road Map' }, 'road'],
        [{ epicKey: 'EPIC-1', epicSummary: 'Road Map' }, 'epic-1'],
        [{ assignee: { displayName: 'Visible Name', name: 'Hidden' } }, 'hidden'],
        [{ team: { name: 'Team Alpha' }, assignee: { displayName: 'Visible Name', name: 'Hidden' } }, 'visible'],
        [{ assignee: { displayName: '', name: 'Fallback' } }, 'fallback'],
        [{ team: 'Team String', assignee: 'String Owner' }, 'string'],
        [{ summary: 42 }, '42'], [{}, 'missing'], [null, 'missing'],
        [{ assignee: { name: 'Owner' }, team: { name: 'Team' } }, 'team'],
    ],
    areScenarioCollapsedLanesEqual: () => {
        const same = { A: true };
        return [[same, same], [null, undefined], [{}, null], [{ A: true, B: false }, { B: false, A: true }],
            [{ A: true }, { A: false }], [{ A: true }, {}], [{ A: true }, { B: true }],
            [{ A: undefined }, { B: undefined }], [{ A: null }, { A: undefined }]];
    },
    areScenarioEdgeRendersEqual: () => {
        const edge = { id: 'edge-a', d: 'M0 0 L1 1', isActive: true, isFaded: false, isContextEdge: false, type: 'dependency' };
        const frame = (paths = [{ ...edge }], width = 100, height = 50) => ({ width, height, paths });
        const pairs = [[frame(), frame()], [frame(), frame(undefined, 101)], [frame(), frame(undefined, 100, 51)],
            [frame(), frame([])], [frame([edge, { ...edge, id: 'edge-b' }]), frame([{ ...edge, id: 'edge-b' }, edge])]];
        for (const field of ['id', 'd', 'isActive', 'isFaded', 'isContextEdge', 'type']) {
            pairs.push([frame(), frame([{ ...edge, [field]: typeof edge[field] === 'boolean' ? !edge[field] : 'changed' }])]);
        }
        pairs.push([frame(), { ...frame([{ ...edge, ignored: 'metadata' }]), ignored: true }]);
        return pairs;
    },
};

const EXPECTED_PURE_HELPER_OUTPUTS = {
  "matchesScenarioSearch": [
    true,
    true,
    false,
    true,
    true,
    true,
    false,
    true,
    true,
    true,
    true,
    false,
    false,
    true
  ],
  "areScenarioCollapsedLanesEqual": [
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false
  ],
  "areScenarioEdgeRendersEqual": [
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true
  ]
};

for (const name of Object.keys(EXPECTED_PURE_HELPER_OUTPUTS)) {
    test(`${name} preserves the legacy deterministic helper oracle`, () => {
        const source = fs.readFileSync(hookPath, 'utf8');
        const match = source.match(new RegExp(`const ${name} = \\([\\s\\S]*?\\n\\s*\\};`));
        assert.ok(match, `Expected the existing pure ${name} body`);
        const helper = vm.runInNewContext(`${match[0]}\n${name}`);
        const actual = pureHelperCases[name]().map(args => helper(...args));
        assert.deepEqual(actual, EXPECTED_PURE_HELPER_OUTPUTS[name]);
    });
}
