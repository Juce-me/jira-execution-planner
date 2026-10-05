const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const hookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioPlanner.js');
const draftHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioDraft.js');
const realtimeHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioRealtime.js');
const derivedHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioDerived.js');
const dragHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioDrag.js');
const historyHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioHistory.js');
const layoutHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioLayout.js');

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

const EXPECTED_DRAFT_RETURN_NAMES = `
fetchScenarioDraft
pauseScenarioRealtime
postScenarioRealtimeJson
pollScenarioDraftEvents
saveScenarioDraftVersion
fetchScenarioDraftVersion
rollbackScenarioDraft
reloadScenarioDraftFromJira
buildScenarioDraftScope
runScenario
scenarioScopeKey
scenarioHasUnsavedChanges
scenarioCanSaveDraft
scenarioActiveDraftId
isScenarioScopeDraftCurrent
scenarioActiveDraftReady
`.trim().split(/\s+/);

test('draft hook preserves its exact flat interface, server-render defaults and render-phase ref writes', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioDraft } from './useScenarioDraft.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(draftHookPath), sourcefile: 'scenarioDraftProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(draftHookPath, module);
    hookModule.filename = draftHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, draftHookPath);
    const noop = () => {};
    // Sentinel refs prove the hook's render-phase writes rather than the refs' initial values.
    const scenarioActiveDraftIdRef = { current: 'stale-draft' };
    const scenarioScopeKeyRef = { current: 'stale-scope' };
    let result;
    function Probe() {
        const scenarioState = hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' });
        result = hookModule.exports.useScenarioDraft({
            scenarioState: { ...scenarioState, scenarioActiveDraftIdRef, scenarioScopeKeyRef },
            BACKEND_URL: '',
            pendingConnectionRecoveryRef: { current: null },
            releaseConnectionRecoveryOwnership: noop,
            connectionRecoveryScenarioStartedRef: { current: false },
            setConnectionRecoveryNotice: noop, setConnectionRecoveryStatus: noop,
            connectionRecoveryStagedRevision: 0, selectedSprint: '42', availableSprints: [],
            sprintsLoading: false, groupsLoading: false, activeGroupId: 'g1',
            showScenario: false, pendingShellAuthResumeRef: { current: null },
            selectedSprintInfo: { name: 'Sprint 42' }, trackScenarioAction: noop, visibleControlGroups: [],
            selectedSprintState: '', isCompletedSprintSelected: false,
            registerSprintFetch: noop, cleanupSprintFetch: noop,
            activeGroup: { name: 'Group One' }, teamOptions: [], selectedTeamSet: new Set(),
            isAllTeamsSelected: true, excludedEpicSet: new Set(),
        });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    assert.deepEqual(Object.keys(result), EXPECTED_DRAFT_RETURN_NAMES);
    assert.equal(EXPECTED_DRAFT_RETURN_NAMES.length, 16);
    for (const name of EXPECTED_DRAFT_RETURN_NAMES) {
        assert.equal(Object.getOwnPropertyDescriptor(result, name).get, undefined);
    }
    for (const name of ['fetchScenarioDraft', 'pauseScenarioRealtime', 'postScenarioRealtimeJson',
        'pollScenarioDraftEvents', 'saveScenarioDraftVersion', 'fetchScenarioDraftVersion',
        'rollbackScenarioDraft', 'reloadScenarioDraftFromJira', 'buildScenarioDraftScope',
        'runScenario', 'isScenarioScopeDraftCurrent']) {
        assert.equal(typeof result[name], 'function', name);
    }
    assert.equal(result.scenarioScopeKey, '42:g1');
    assert.equal(result.scenarioHasUnsavedChanges, false);
    assert.equal(result.scenarioCanSaveDraft, false);
    assert.equal(result.scenarioActiveDraftId, '');
    assert.equal(result.scenarioActiveDraftReady, false);
    assert.equal(scenarioActiveDraftIdRef.current, '');
    assert.equal(scenarioScopeKeyRef.current, '42:g1');
    assert.deepEqual(result.buildScenarioDraftScope(), {
        groupId: 'g1', groupName: 'Group One', sprintId: '42', sprintName: 'Sprint 42',
    });
    assert.equal(result.isScenarioScopeDraftCurrent('42:g1'), true);
    assert.equal(result.isScenarioScopeDraftCurrent('42:g1', 'other-draft'), false);
    assert.equal(result.isScenarioScopeDraftCurrent('41:g1'), false);
});

const EXPECTED_REALTIME_RETURN_NAMES = `
acquireScenarioIssueLock
refreshScenarioIssueLock
releaseScenarioIssueLock
scenarioRemoteEditors
scenarioIssueLockWarnings
`.trim().split(/\s+/);

test('realtime hook preserves its exact flat interface, server-render defaults and no-network idle locks', async () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioRealtime } from './useScenarioRealtime.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(realtimeHookPath), sourcefile: 'scenarioRealtimeProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(realtimeHookPath, module);
    hookModule.filename = realtimeHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, realtimeHookPath);
    const calls = [];
    // Recorded even when a caller swallows the throw, so the final empty-calls assertion proves no network.
    const record = name => () => { calls.push(name); throw new Error(`${name} must not run`); };
    const savedFetch = globalThis.fetch;
    const savedEventSource = globalThis.EventSource;
    globalThis.fetch = record('fetch');
    globalThis.EventSource = function EventSource() { calls.push('EventSource'); throw new Error('EventSource must not open'); };
    const render = (stateOverrides = {}) => {
        let result;
        function Probe() {
            const scenarioState = hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' });
            result = hookModule.exports.useScenarioRealtime({
                scenarioState: { ...scenarioState, ...stateOverrides },
                BACKEND_URL: '',
                pauseScenarioRealtime: record('pauseScenarioRealtime'),
                postScenarioRealtimeJson: record('postScenarioRealtimeJson'),
                pollScenarioDraftEvents: record('pollScenarioDraftEvents'),
                scenarioScopeKey: '42:g1',
                scenarioActiveDraftId: '',
                scenarioActiveDraftReady: false,
            });
            return null;
        }
        assert.equal(renderToString(React.createElement(Probe)), '');
        return result;
    };
    try {
        const result = render();
        assert.deepEqual(Object.keys(result), EXPECTED_REALTIME_RETURN_NAMES);
        assert.equal(EXPECTED_REALTIME_RETURN_NAMES.length, 5);
        for (const name of EXPECTED_REALTIME_RETURN_NAMES) {
            assert.equal(Object.getOwnPropertyDescriptor(result, name).get, undefined);
        }
        for (const name of ['acquireScenarioIssueLock', 'refreshScenarioIssueLock', 'releaseScenarioIssueLock']) {
            assert.equal(typeof result[name], 'function', name);
            assert.equal(await result[name]('ISSUE-1'), undefined, name);
        }
        assert.deepEqual(result.scenarioRemoteEditors, []);
        assert.deepEqual(result.scenarioIssueLockWarnings, []);

        const expired = '2000-01-01T00:00:00Z';
        const seeded = render({
            scenarioCurrentUserIdentity: { userId: 'u-self', displayName: 'Self User' },
            scenarioDraftPresence: [
                { userId: 'u-self', displayName: 'Self User' },
                { userId: 'u-2', displayName: '  Remote Two  ' },
                { userId: 'u-3', displayName: 'Expired', expiresAt: expired },
                { userId: 'u-4', displayName: '' },
            ],
            scenarioDraftLocks: [
                { resourceType: 'issue', resourceId: 'ISSUE-1', holderUserId: 'u-2', holderDisplayName: 'Remote Two' },
                { resourceType: 'issue', resourceId: 'ISSUE-2', holderUserId: 'u-self' },
                { resourceType: 'issue', resourceId: 'ISSUE-3', holderUserId: 'u-9' },
                { resourceType: 'issue', resourceId: 'ISSUE-4', holderUserId: 'u-5', expiresAt: expired },
                { resourceType: 'epic', resourceId: 'EPIC-1', holderUserId: 'u-6' },
            ],
        });
        assert.deepEqual(seeded.scenarioRemoteEditors, [{ userId: 'u-2', displayName: 'Remote Two' }]);
        assert.deepEqual(seeded.scenarioIssueLockWarnings, [
            { issueKey: 'ISSUE-1', holderDisplayName: 'Remote Two' },
            { issueKey: 'ISSUE-3', holderDisplayName: 'Another editor' },
        ]);
        assert.deepEqual(calls, []);
    } finally {
        globalThis.fetch = savedFetch;
        globalThis.EventSource = savedEventSource;
    }
});

const EXPECTED_DERIVED_RETURN_NAMES = `
scenarioSummary
scenarioBaseUrl
scenarioDependencies
scenarioCapacityByTeam
scenarioIssues
scenarioSearchQuery
scenarioSearchMatchSet
scenarioExcludedIssueKeys
scenarioFocusSet
scenarioContextSet
scenarioIssueByKey
scenarioDeadline
scenarioViewStart
scenarioViewEnd
scenarioFocusIssueKeys
scenarioFocusContextKeys
scenarioTimelineIssues
scenarioTimelineWithSegments
scenarioTimelineIssueKeys
scenarioAssigneeConflicts
scenarioDepViolations
scenarioDepViolatedKeys
`.trim().split(/\s+/);

test('derived hook preserves its exact flat interface, idle fallbacks, render-phase ref write and per-render dates', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioDerived } from './useScenarioDerived.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(derivedHookPath), sourcefile: 'scenarioDerivedProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(derivedHookPath, module);
    hookModule.filename = derivedHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, derivedHookPath);
    const EMPTY_ARRAY = Object.freeze([]);
    const EMPTY_OBJECT = Object.freeze({});
    const normalizeEpicKey = value => String(value || '').trim().toUpperCase();
    // Each Probe renders twice in one mount (a render-phase update), so memo caches survive the second pass.
    const render = ({ stateOverrides = {}, jiraUrl = '', searchQuery = '', excludedEpicSet = new Set() } = {}) => {
        const results = [];
        function Probe() {
            const [pass, setPass] = React.useState(0);
            const scenarioState = hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' });
            results.push(hookModule.exports.useScenarioDerived({
                scenarioState: { ...scenarioState, ...stateOverrides },
                EMPTY_ARRAY, EMPTY_OBJECT, jiraUrl, searchQuery, normalizeEpicKey, excludedEpicSet,
            }));
            if (pass === 0) setPass(1);
            return null;
        }
        assert.equal(renderToString(React.createElement(Probe)), '');
        assert.equal(results.length, 2);
        return results;
    };
    const day = (y, m, d) => new Date(y, m - 1, d).getTime();
    const keys = value => [...value];

    // Idle: null scenarioData falls back to the caller's frozen identities and empty derived values.
    const idleRef = { current: 'stale-range' };
    const [idle] = render({ stateOverrides: { scenarioViewRangeRef: idleRef }, jiraUrl: 'https://jira.example.test' });
    assert.deepEqual(Object.keys(idle), EXPECTED_DERIVED_RETURN_NAMES);
    assert.equal(EXPECTED_DERIVED_RETURN_NAMES.length, 22);
    for (const name of EXPECTED_DERIVED_RETURN_NAMES) {
        assert.equal(Object.getOwnPropertyDescriptor(idle, name).get, undefined);
    }
    assert.equal(idle.scenarioSummary, EMPTY_OBJECT);
    assert.equal(idle.scenarioCapacityByTeam, EMPTY_OBJECT);
    assert.equal(idle.scenarioDependencies, EMPTY_ARRAY);
    // scenarioRawIssues (EMPTY_ARRAY) passes straight through the issue and timeline cores.
    assert.equal(idle.scenarioIssues, EMPTY_ARRAY);
    assert.equal(idle.scenarioTimelineIssues, EMPTY_ARRAY);
    assert.equal(idle.scenarioTimelineWithSegments, EMPTY_ARRAY);
    assert.equal(idle.scenarioBaseUrl, 'https://jira.example.test');
    assert.equal(idle.scenarioSearchQuery, '');
    // scenarioConfig (EMPTY_OBJECT) has no dates.
    assert.equal(idle.scenarioDeadline, null);
    assert.equal(idle.scenarioViewStart, null);
    assert.equal(idle.scenarioViewEnd, null);
    for (const name of ['scenarioSearchMatchSet', 'scenarioExcludedIssueKeys', 'scenarioFocusSet', 'scenarioContextSet',
        'scenarioFocusIssueKeys', 'scenarioFocusContextKeys', 'scenarioTimelineIssueKeys', 'scenarioDepViolations',
        'scenarioDepViolatedKeys']) {
        assert.ok(idle[name] instanceof Set, name);
        assert.equal(idle[name].size, 0, name);
    }
    assert.ok(idle.scenarioIssueByKey instanceof Map);
    assert.equal(idle.scenarioIssueByKey.size, 0);
    assert.deepEqual(keys(idle.scenarioAssigneeConflicts.conflicts), []);
    assert.deepEqual([...idle.scenarioAssigneeConflicts.conflictDetails], []);
    assert.deepEqual(idleRef.current, { start: null, end: null });
    const [noUrl] = render({ searchQuery: '  MiXeD ' });
    assert.equal(noUrl.scenarioBaseUrl, '');
    assert.equal(noUrl.scenarioSearchQuery, 'mixed');

    // Synthetic plan: an assignee overlap, a DevLead task on an excluded Epic split at Sprint boundaries,
    // a violated dependency in edit mode, and an override that extends the view past the deadline.
    const issues = [
        { key: 'DEMO-1', summary: 'Build API', team: 'Alpha', assignee: 'Ana', epicKey: 'EPIC-1', epicSummary: 'Platform', start: '2026-01-05', end: '2026-01-20' },
        { key: 'DEMO-2', summary: 'Build UI', team: 'Alpha', assignee: 'Ana', epicKey: 'EPIC-1', epicSummary: 'Platform', start: '2026-01-12', end: '2026-01-26' },
        { key: 'DEMO-3', summary: 'Lead sync', team: 'Alpha', assignee: null, epicKey: 'epic-2', epicSummary: 'DevLead Management', start: '2026-01-05', end: '2026-02-10' },
        { key: 'DEMO-4', summary: 'Late item', team: 'Beta', assignee: 'Bo', epicKey: 'EPIC-3', start: '2026-03-20', end: '2026-04-10' },
    ];
    const scenarioData = {
        jira_base_url: 'https://jira.synthetic.test',
        config: { start_date: '2026-01-05', quarter_end_date: '2026-03-31' },
        summary: { total: 4 },
        capacity_by_team: { Alpha: { devLead: 'Lead Alpha' } },
        dependencies: [{ from: 'DEMO-1', to: 'DEMO-2' }],
        focus_set: { focused_issue_keys: ['DEMO-1'], context_issue_keys: ['DEMO-2'] },
        sprintBoundaries: {
            previous: { startDate: '2026-01-05' },
            selected: { startDate: '2026-01-19', endDate: '2026-02-02' },
            next: { endDate: '2026-02-16' },
        },
        issues,
    };
    const viewRangeRef = { current: 'stale-range' };
    const stateOverrides = {
        scenarioData, scenarioEditMode: true, scenarioViewRangeRef: viewRangeRef,
        scenarioOverrides: { 'DEMO-4': { end: '2026-04-20' } },
    };
    const excludedEpicSet = new Set(['EPIC-2']);
    const [r1, r2] = render({ stateOverrides, jiraUrl: 'https://jira.example.test', excludedEpicSet });
    assert.deepEqual(Object.keys(r1), EXPECTED_DERIVED_RETURN_NAMES);
    assert.equal(r1.scenarioBaseUrl, 'https://jira.synthetic.test');
    assert.equal(r1.scenarioSummary, scenarioData.summary);
    assert.equal(r1.scenarioDependencies, scenarioData.dependencies);
    assert.equal(r1.scenarioCapacityByTeam, scenarioData.capacity_by_team);
    assert.equal(r1.scenarioIssues.length, 4);
    assert.equal(r1.scenarioIssues[0], issues[0]);
    assert.deepEqual(r1.scenarioIssues[2], { ...issues[2], assignee: 'Lead Alpha' });
    assert.equal(r1.scenarioIssues[3].end, '2026-04-10');
    assert.deepEqual(keys(r1.scenarioIssueByKey.keys()), ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
    assert.deepEqual(r1.scenarioIssueByKey.get('DEMO-4'), { ...issues[3], end: '2026-04-20', dateSource: 'override' });
    assert.deepEqual(keys(r1.scenarioExcludedIssueKeys), ['DEMO-3']);
    assert.deepEqual(keys(r1.scenarioFocusSet), ['DEMO-1']);
    assert.deepEqual(keys(r1.scenarioContextSet), ['DEMO-2']);
    assert.equal(r1.scenarioDeadline.getTime(), day(2026, 3, 31));
    assert.equal(r1.scenarioViewStart.getTime(), day(2026, 1, 5));
    assert.equal(r1.scenarioViewEnd.getTime(), day(2026, 4, 20));
    assert.equal(r1.scenarioTimelineIssues.length, 4);
    assert.deepEqual(r1.scenarioTimelineWithSegments.map(i => [i.key, i.originalKey, i.start, i.end, i.assignee]), [
        ['DEMO-1', undefined, '2026-01-05', '2026-01-20', 'Ana'],
        ['DEMO-2', undefined, '2026-01-12', '2026-01-26', 'Ana'],
        ['DEMO-3__seg0', 'DEMO-3', '2026-01-05', '2026-01-19', 'Lead Alpha'],
        ['DEMO-3__seg1', 'DEMO-3', '2026-01-19', '2026-02-02', 'Lead Alpha'],
        ['DEMO-3__seg2', 'DEMO-3', '2026-02-02', '2026-02-10', 'Lead Alpha'],
        ['DEMO-4', undefined, '2026-03-20', '2026-04-20', 'Bo'],
    ]);
    assert.deepEqual(keys(r1.scenarioTimelineIssueKeys), r1.scenarioTimelineWithSegments.map(i => i.key));
    assert.deepEqual(keys(r1.scenarioAssigneeConflicts.conflicts), ['DEMO-1', 'DEMO-2']);
    assert.deepEqual([...r1.scenarioAssigneeConflicts.conflictDetails], [['DEMO-1', ['DEMO-2']], ['DEMO-2', ['DEMO-1']]]);
    assert.deepEqual(keys(r1.scenarioDepViolations), ['DEMO-1->DEMO-2']);
    assert.deepEqual(keys(r1.scenarioDepViolatedKeys), ['DEMO-1', 'DEMO-2']);
    assert.deepEqual(keys(r1.scenarioFocusIssueKeys), []);
    assert.deepEqual(keys(r1.scenarioSearchMatchSet), []);
    // The render-phase write replaces the stale ref value with the current view range objects.
    assert.equal(viewRangeRef.current.start, r2.scenarioViewStart);
    assert.equal(viewRangeRef.current.end, r2.scenarioViewEnd);
    assert.deepEqual(Object.keys(viewRangeRef.current), ['start', 'end']);
    // Unmemoised per-render dates: a fresh Date each render, which re-runs the memos keyed on them.
    assert.notEqual(r1.scenarioDeadline, r2.scenarioDeadline);
    assert.equal(r1.scenarioDeadline.getTime(), r2.scenarioDeadline.getTime());
    assert.notEqual(r1.scenarioViewStart, r2.scenarioViewStart);
    assert.notEqual(r1.scenarioViewEnd, r2.scenarioViewEnd);
    assert.notEqual(r1.scenarioTimelineWithSegments, r2.scenarioTimelineWithSegments);
    assert.deepEqual(r1.scenarioTimelineWithSegments, r2.scenarioTimelineWithSegments);
    for (const name of ['scenarioIssues', 'scenarioIssueByKey', 'scenarioExcludedIssueKeys', 'scenarioTimelineIssues',
        'scenarioAssigneeConflicts', 'scenarioDepViolations', 'scenarioFocusSet']) {
        assert.equal(r1[name], r2[name], `${name} memo survives a same-input render`);
    }

    // Search and Epic focus feed the timeline through the hook's own query normalisation.
    const [searched] = render({
        stateOverrides: { scenarioData, scenarioEpicFocus: { key: 'EPIC-1' } },
        searchQuery: '  PLATFORM ', excludedEpicSet,
    });
    assert.equal(searched.scenarioSearchQuery, 'platform');
    assert.deepEqual(keys(searched.scenarioSearchMatchSet), ['DEMO-1', 'DEMO-2']);
    assert.deepEqual(keys(searched.scenarioFocusIssueKeys), ['DEMO-1', 'DEMO-2']);
    assert.deepEqual(keys(searched.scenarioFocusContextKeys), []);
    assert.deepEqual(searched.scenarioTimelineIssues.map(i => i.key), ['DEMO-1', 'DEMO-2']);
    assert.deepEqual(keys(searched.scenarioDepViolations), []);
});

const EXPECTED_DRAG_RETURN_NAMES = `
toggleScenarioEditMode
handleScenarioBarMouseDown
scenarioUndo
scenarioRedo
scenarioOverrideCount
`.trim().split(/\s+/);

test('drag hook preserves its exact flat interface, edit toggle, undo/redo semantics and idle mouse-down guards', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioDrag } from './useScenarioDrag.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(dragHookPath), sourcefile: 'scenarioDragProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(dragHookPath, module);
    hookModule.filename = dragHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, dragHookPath);
    // renderToString never runs effects, so the drag mousemove/mouseup and undo keydown effects are not
    // covered here; tests/ui/scenario_draft_history.spec.js and scenario_draft_collaboration.spec.js cover them.
    const globalCalls = [];
    const savedGlobals = {};
    for (const name of ['fetch', 'EventSource', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
        savedGlobals[name] = globalThis[name];
        globalThis[name] = function recordedGlobal() { globalCalls.push(name); throw new Error(`${name} must not run`); };
    }
    const calls = [];
    const spy = name => (...args) => { calls.push([name, ...args]); };
    const render = ({ stateOverrides = {}, scenarioHasUnsavedChanges = false, scenarioIssueByKey = new Map() } = {}) => {
        let result;
        let scenarioState;
        function Probe() {
            scenarioState = { ...hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' }), ...stateOverrides };
            result = hookModule.exports.useScenarioDrag({
                scenarioState,
                trackScenarioAction: spy('trackScenarioAction'),
                scenarioHasUnsavedChanges,
                acquireScenarioIssueLock: spy('acquireScenarioIssueLock'),
                refreshScenarioIssueLock: spy('refreshScenarioIssueLock'),
                releaseScenarioIssueLock: spy('releaseScenarioIssueLock'),
                scenarioIssueByKey,
            });
            return null;
        }
        assert.equal(renderToString(React.createElement(Probe)), '');
        return { result, scenarioState };
    };
    // Recording setters replace the real ones so updaters can be applied to a chosen previous value.
    const setters = () => ({
        setScenarioEditMode: spy('setScenarioEditMode'),
        setScenarioEpicFocus: spy('setScenarioEpicFocus'),
        setScenarioUndoVersion: spy('setScenarioUndoVersion'),
        setScenarioOverrides: spy('setScenarioOverrides'),
        setScenarioDragState: spy('setScenarioDragState'),
    });
    const takeCalls = () => calls.splice(0, calls.length);
    try {
        // (a) Exact interface and idle values.
        const { result: idle } = render();
        assert.deepEqual(Object.keys(idle), EXPECTED_DRAG_RETURN_NAMES);
        assert.equal(EXPECTED_DRAG_RETURN_NAMES.length, 5);
        for (const name of EXPECTED_DRAG_RETURN_NAMES) {
            assert.equal(Object.getOwnPropertyDescriptor(idle, name).get, undefined, name);
        }
        for (const name of ['toggleScenarioEditMode', 'handleScenarioBarMouseDown', 'scenarioUndo', 'scenarioRedo']) {
            assert.equal(typeof idle[name], 'function', name);
        }
        // (b) The override count is the number of overridden issue keys.
        assert.equal(idle.scenarioOverrideCount, 0);
        const { result: seeded } = render({ stateOverrides: { scenarioOverrides: {
            'DEMO-1': { start: '2026-01-05', end: '2026-01-20' }, 'DEMO-2': { end: '2026-02-01' }, 'DEMO-3': {},
        } } });
        assert.equal(seeded.scenarioOverrideCount, 3);
        assert.deepEqual(takeCalls(), []);

        // (c) Toggle: tracking and side effects run inside the edit-mode updater, keyed on the previous mode.
        const enterSetters = setters();
        const { result: enter, scenarioState: enterState } = render({ stateOverrides: enterSetters });
        const sentinelCmd = { issueKey: 'DEMO-1', oldStart: 'a', oldEnd: 'b', newStart: 'c', newEnd: 'd' };
        enterState.scenarioUndoStackRef.current.push(sentinelCmd);
        enter.toggleScenarioEditMode();
        const [[toggleName, enterUpdater], ...afterToggle] = takeCalls();
        assert.equal(toggleName, 'setScenarioEditMode');
        assert.deepEqual(afterToggle, []);
        assert.equal(enterUpdater(false), true);
        assert.deepEqual(takeCalls(), [
            ['trackScenarioAction', 'edit_start', { dirty_state: 'clean' }],
            ['setScenarioEpicFocus', null],
        ]);
        assert.equal(enterState.scenarioUndoStackRef.current.canUndo(), true, 'entering edit keeps the undo stack');

        const { result: exit, scenarioState: exitState } = render({ stateOverrides: setters(), scenarioHasUnsavedChanges: true });
        exitState.scenarioUndoStackRef.current.push(sentinelCmd);
        exitState.scenarioUndoStackRef.current.push({ ...sentinelCmd, issueKey: 'DEMO-2' });
        exitState.scenarioUndoStackRef.current.undo();
        exit.toggleScenarioEditMode();
        const [[, exitUpdater]] = takeCalls();
        assert.equal(exitUpdater(true), false);
        assert.deepEqual(takeCalls(), [
            ['trackScenarioAction', 'edit_stop', { dirty_state: 'dirty' }],
            ['setScenarioUndoVersion', 0],
        ]);
        assert.equal(exitState.scenarioUndoStackRef.current.canUndo(), false, 'exiting edit clears undo');
        assert.equal(exitState.scenarioUndoStackRef.current.canRedo(), false, 'exiting edit clears redo');

        // (c) Undo/redo against a seeded stack and the computed issue dates.
        const issueByKeyGets = [];
        const scenarioIssueByKey = new Map([
            ['DEMO-1', { key: 'DEMO-1', start: '2026-01-05', end: '2026-01-20' }],
            ['DEMO-2', { key: 'DEMO-2', start: '2026-02-03', end: '2026-02-12' }],
            ['DEMO-3', { key: 'DEMO-3', start: '2026-03-02', end: '2026-03-09' }],
        ]);
        const realGet = scenarioIssueByKey.get.bind(scenarioIssueByKey);
        scenarioIssueByKey.get = key => { issueByKeyGets.push(key); return realGet(key); };
        const { result: history, scenarioState: historyState } = render({ stateOverrides: setters(), scenarioIssueByKey });
        const stack = historyState.scenarioUndoStackRef.current;
        const cmdA = { issueKey: 'DEMO-1', oldStart: '2026-01-05', oldEnd: '2026-01-20', newStart: '2026-01-12', newEnd: '2026-01-27' };
        const cmdB = { issueKey: 'DEMO-2', oldStart: '2026-02-01', oldEnd: '2026-02-10', newStart: '2026-02-05', newEnd: '2026-02-14' };
        const cmdC = { issueKey: 'DEMO-3', oldStart: '2026-03-04', oldEnd: '2026-03-11', newStart: '2026-03-04', newEnd: '2026-03-11' };
        [cmdA, cmdB, cmdC].forEach(cmd => stack.push(cmd));
        const prev = Object.freeze({
            'DEMO-1': { start: '2026-01-12', end: '2026-01-27' },
            'DEMO-2': { start: '2026-02-05', end: '2026-02-14' },
            'DEMO-9': { start: '2026-05-01', end: '2026-05-08' },
        });
        const step = action => {
            history[action]();
            const recorded = takeCalls();
            if (recorded.length === 0) return null;
            assert.deepEqual(recorded.map(([name]) => name), ['setScenarioUndoVersion', 'setScenarioOverrides']);
            assert.equal(recorded[0][1](3), 4, `${action} bumps the undo version`);
            return recorded[1][1](prev);
        };
        // A no-op move keeps the overrides as an equal fresh copy without reading the computed issue.
        const afterC = step('scenarioUndo');
        assert.notEqual(afterC, prev);
        assert.deepEqual(afterC, prev);
        assert.deepEqual(issueByKeyGets, []);
        // Old dates that differ from the computed dates restore an explicit override.
        assert.deepEqual(step('scenarioUndo'), { ...prev, 'DEMO-2': { start: '2026-02-01', end: '2026-02-10' } });
        // Old dates equal to the computed dates drop the override entirely.
        const afterA = step('scenarioUndo');
        assert.deepEqual(afterA, { 'DEMO-2': prev['DEMO-2'], 'DEMO-9': prev['DEMO-9'] });
        assert.deepEqual(issueByKeyGets, ['DEMO-2', 'DEMO-1']);
        assert.equal(step('scenarioUndo'), null, 'an empty undo stack sets nothing');
        // Redo re-applies the new dates in undo order.
        assert.deepEqual(step('scenarioRedo'), { ...prev, 'DEMO-1': { start: '2026-01-12', end: '2026-01-27' } });
        assert.deepEqual(step('scenarioRedo'), { ...prev, 'DEMO-2': { start: '2026-02-05', end: '2026-02-14' } });
        assert.deepEqual(step('scenarioRedo'), { ...prev, 'DEMO-3': { start: '2026-03-04', end: '2026-03-11' } });
        assert.equal(step('scenarioRedo'), null, 'an empty redo stack sets nothing');
        assert.equal(Object.keys(prev).length, 3, 'updaters never mutate the previous overrides');

        // (c) Mouse-down guards: no drag state, lock or default prevention before the edit/button/SP/date checks pass.
        const makeEvent = (button, closest = () => null) => ({
            button, clientX: 10,
            preventDefault: spy('preventDefault'), stopPropagation: spy('stopPropagation'),
            currentTarget: { closest, getBoundingClientRect: spy('getBoundingClientRect') },
        });
        const draggable = { key: 'DEMO-1', sp: 3, start: '2026-01-05', end: '2026-01-20' };
        const dragRefs = () => ({
            scenarioDragStateRef: { current: 'untouched' },
            scenarioWasDraggedRef: { current: 'untouched' },
            scenarioDragLockRefreshRef: { current: 'untouched' },
        });
        const viewRefs = dragRefs();
        const { result: viewOnly } = render({ stateOverrides: { ...setters(), ...viewRefs } });
        assert.equal(viewOnly.handleScenarioBarMouseDown(makeEvent(0, spy('closest')), draggable), undefined);
        assert.deepEqual(takeCalls(), [], 'view mode ignores bar mouse-down');
        const editRefs = dragRefs();
        const { result: edit } = render({ stateOverrides: { ...setters(), ...editRefs, scenarioEditMode: true } });
        for (const [event, issue, label] of [
            [makeEvent(2, spy('closest')), draggable, 'non-primary button'],
            [makeEvent(1, spy('closest')), draggable, 'middle button'],
            [makeEvent(0, spy('closest')), { ...draggable, sp: 0 }, 'zero SP'],
            [makeEvent(0, spy('closest')), { ...draggable, sp: 'n/a' }, 'non-numeric SP'],
            [makeEvent(0, spy('closest')), { ...draggable, start: '' }, 'missing start'],
            [makeEvent(0, spy('closest')), { ...draggable, end: null }, 'missing end'],
        ]) {
            assert.equal(edit.handleScenarioBarMouseDown(event, issue), undefined, label);
            assert.deepEqual(takeCalls(), [], label);
        }
        // A bar outside a lane track stops the native event but never starts a drag or takes a lock.
        edit.handleScenarioBarMouseDown(makeEvent(0, selector => { calls.push(['closest', selector]); return null; }), draggable);
        assert.deepEqual(takeCalls(), [['preventDefault'], ['stopPropagation'], ['closest', '.scenario-lane-track']]);
        for (const refs of [viewRefs, editRefs]) {
            assert.deepEqual(Object.values(refs).map(ref => ref.current), ['untouched', 'untouched', 'untouched']);
        }

        // (d) No network, EventSource, timers or animation frames during render or the exercised calls.
        assert.deepEqual(globalCalls, []);
    } finally {
        for (const [name, value] of Object.entries(savedGlobals)) {
            globalThis[name] = value;
        }
    }
});

const EXPECTED_HISTORY_RETURN_NAMES = `
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
`.trim().split(/\s+/);

test('history hook preserves its exact flat interface, discard/close/request/cancel updaters and no-network idle guards', async () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioHistory } from './useScenarioHistory.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(historyHookPath), sourcefile: 'scenarioHistoryProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(historyHookPath, module);
    hookModule.filename = historyHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, historyHookPath);
    // renderToString never runs effects, so the history-open focus and Escape keydown effects are not
    // covered here; tests/ui/scenario_draft_history.spec.js covers them.
    const globalCalls = [];
    const savedGlobals = {};
    for (const name of ['fetch', 'EventSource', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
        savedGlobals[name] = globalThis[name];
        globalThis[name] = function recordedGlobal() { globalCalls.push(name); throw new Error(`${name} must not run`); };
    }
    const calls = [];
    const spy = name => (...args) => { calls.push([name, ...args]); };
    // H1 draft callbacks are recorded even when a caller swallows the throw, so empty calls prove no request.
    const network = name => (...args) => { calls.push([name, ...args]); throw new Error(`${name} must not run`); };
    const takeCalls = () => calls.splice(0, calls.length);
    const render = ({ stateOverrides = {}, scenarioScopeKey = '', scenarioHasUnsavedChanges = false, scenarioCanSaveDraft = false } = {}) => {
        let result;
        let scenarioState;
        function Probe() {
            // Recording setters replace the real ones so updaters can be applied to a chosen previous value.
            scenarioState = {
                ...hookModule.exports.useScenarioState({ initialLaneMode: 'assignee' }),
                setScenarioOverrides: spy('setScenarioOverrides'),
                setScenarioDraftMeta: spy('setScenarioDraftMeta'),
                setScenarioUndoVersion: spy('setScenarioUndoVersion'),
                ...stateOverrides,
            };
            result = hookModule.exports.useScenarioHistory({
                scenarioState,
                trackScenarioAction: spy('trackScenarioAction'),
                saveScenarioDraftVersion: network('saveScenarioDraftVersion'),
                buildScenarioDraftScope: network('buildScenarioDraftScope'),
                fetchScenarioDraft: network('fetchScenarioDraft'),
                fetchScenarioDraftVersion: network('fetchScenarioDraftVersion'),
                rollbackScenarioDraft: network('rollbackScenarioDraft'),
                reloadScenarioDraftFromJira: network('reloadScenarioDraftFromJira'),
                postScenarioRealtimeJson: network('postScenarioRealtimeJson'),
                // Falsy, so a guard-less path records its calls and then bails out as a stale scope.
                isScenarioScopeDraftCurrent: spy('isScenarioScopeDraftCurrent'),
                scenarioScopeKey, scenarioCanSaveDraft, scenarioHasUnsavedChanges,
            });
            return null;
        }
        assert.equal(renderToString(React.createElement(Probe)), '');
        return { result, scenarioState };
    };
    // A loaded draft with pending, stale and conflict metadata; frozen so updaters must copy, never mutate.
    const loadedMeta = Object.freeze({
        activeDraft: { draftId: 'draft-1', versionNumber: 3, draftRevision: 'rev-3' },
        versions: [{ versionNumber: 3 }, { versionNumber: 2 }],
        loadedVersionNumber: 3, baseDraftRevision: 'rev-3',
        savedOverrides: { 'DEMO-1': { start: '2026-01-05', end: '2026-01-20' } },
        scopePayload: { sprintId: '42', groupId: 'g1' }, scopeKey: '42:g1',
        dirtyState: 'dirty_local', pendingScopeChange: { scopeKey: '43:g1' }, historyOpen: true,
        pendingHistoryAction: { type: 'reload', versionNumber: 2 },
        pendingActiveDraftReload: true, pendingReloadFromJira: true,
        staleDraft: { draftRevision: 'rev-4' }, conflict: { kind: 'remote' },
        message: 'Previous message', error: 'Previous error',
    });
    const applySingleMetaUpdate = label => {
        const recorded = takeCalls();
        assert.deepEqual(recorded.map(([name]) => name), ['setScenarioDraftMeta'], label);
        return recorded[0][1](loadedMeta);
    };
    try {
        // (a) Exact interface: plain values, all functions.
        const { result: idle } = render();
        assert.deepEqual(Object.keys(idle), EXPECTED_HISTORY_RETURN_NAMES);
        assert.equal(EXPECTED_HISTORY_RETURN_NAMES.length, 15);
        for (const name of EXPECTED_HISTORY_RETURN_NAMES) {
            assert.equal(Object.getOwnPropertyDescriptor(idle, name).get, undefined, name);
            assert.equal(typeof idle[name], 'function', name);
        }
        assert.deepEqual(takeCalls(), []);

        // (b) Discard restores normalized saved overrides, clears undo and keeps the loaded draft metadata.
        const { result: clean, scenarioState: cleanState } = render({ stateOverrides: { scenarioDraftMeta: loadedMeta } });
        cleanState.scenarioUndoStackRef.current.push({ issueKey: 'DEMO-1' });
        assert.equal(clean.discardScenarioOverrides(), undefined);
        assert.deepEqual(takeCalls(), [], 'discard without unsaved changes is a no-op');
        assert.equal(cleanState.scenarioUndoStackRef.current.canUndo(), true);
        const discardMeta = { ...loadedMeta, savedOverrides: {
            'DEMO-1': { start: '2026-01-05', end: '2026-01-20', extra: 'dropped' },
            'DEMO-2': { start: 'not-a-date', end: '' }, 'bad key': { start: '2026-01-05' },
        } };
        const { result: dirty, scenarioState: dirtyState } = render({
            stateOverrides: { scenarioDraftMeta: discardMeta }, scenarioHasUnsavedChanges: true,
        });
        dirtyState.scenarioUndoStackRef.current.push({ issueKey: 'DEMO-1' });
        dirtyState.scenarioUndoStackRef.current.push({ issueKey: 'DEMO-2' });
        dirtyState.scenarioUndoStackRef.current.undo();
        dirty.discardScenarioOverrides();
        const [[overridesName, restored], [metaName, discardUpdater], ...afterDiscard] = takeCalls();
        assert.equal(overridesName, 'setScenarioOverrides');
        assert.deepEqual(restored, { 'DEMO-1': { start: '2026-01-05', end: '2026-01-20' } });
        assert.equal(metaName, 'setScenarioDraftMeta');
        assert.deepEqual(afterDiscard, [['setScenarioUndoVersion', 0]]);
        assert.deepEqual(discardUpdater(loadedMeta), {
            ...loadedMeta, dirtyState: 'clean', pendingScopeChange: null, staleDraft: null,
            conflict: null, message: '', error: '',
        });
        assert.equal(dirtyState.scenarioUndoStackRef.current.canUndo(), false, 'discard clears undo');
        assert.equal(dirtyState.scenarioUndoStackRef.current.canRedo(), false, 'discard clears redo');

        // (b) Save guards: no scope or no save permission returns before tracking or any metadata update.
        const { result: unsavable } = render({ stateOverrides: { scenarioDraftMeta: loadedMeta }, scenarioScopeKey: '42:g1' });
        assert.equal(await unsavable.saveScenarioDraft(), undefined);
        assert.deepEqual(takeCalls(), [], 'save without permission does nothing');
        const { result: scopeless } = render({ scenarioCanSaveDraft: true, scenarioHasUnsavedChanges: true });
        assert.equal(await scopeless.saveScenarioDraft(), undefined);
        assert.deepEqual(takeCalls(), [], 'save without a scope does nothing');

        // (b) Close resets the open/pending flags and returns focus to the History button when it can focus.
        const { result: closer } = render({ stateOverrides: { scenarioHistoryButtonRef: { current: { focus: spy('focus') } } } });
        closer.closeScenarioDraftHistory();
        const [[closeName, closeUpdater], ...afterClose] = takeCalls();
        assert.equal(closeName, 'setScenarioDraftMeta');
        assert.deepEqual(afterClose, [['focus']]);
        assert.deepEqual(closeUpdater(loadedMeta), { ...loadedMeta, historyOpen: false, pendingHistoryAction: null });
        render({ stateOverrides: { scenarioHistoryButtonRef: { current: {} } } }).result.closeScenarioDraftHistory();
        applySingleMetaUpdate('close without a focusable button only updates metadata');

        // (b) With unsaved changes each request only records a pending confirmation; cancel clears it.
        const { result: pending } = render({ stateOverrides: { scenarioDraftMeta: loadedMeta }, scenarioScopeKey: '42:g1', scenarioHasUnsavedChanges: true });
        pending.requestScenarioHistoryAction('rollback', 2);
        assert.deepEqual(applySingleMetaUpdate('history request'),
            { ...loadedMeta, pendingHistoryAction: { type: 'rollback', versionNumber: 2 }, error: '' });
        pending.cancelScenarioHistoryAction();
        assert.deepEqual(applySingleMetaUpdate('history cancel'), { ...loadedMeta, pendingHistoryAction: null });
        pending.requestScenarioReloadFromJira();
        assert.deepEqual(applySingleMetaUpdate('Jira reload request'), { ...loadedMeta, pendingReloadFromJira: true, error: '' });
        pending.cancelScenarioReloadFromJira();
        assert.deepEqual(applySingleMetaUpdate('Jira reload cancel'), { ...loadedMeta, pendingReloadFromJira: false });
        pending.requestReloadActiveDraft();
        assert.deepEqual(applySingleMetaUpdate('active reload request'), { ...loadedMeta, pendingActiveDraftReload: true, error: '' });
        pending.cancelReloadActiveDraft();
        assert.deepEqual(applySingleMetaUpdate('active reload cancel'), { ...loadedMeta, pendingActiveDraftReload: false });

        // (b) Idle guards: without a draft id, scope, version or base revision nothing is tracked, set or fetched,
        // and a previous action controller is neither aborted nor replaced.
        const actionController = { abort: spy('actionAbort') };
        const scenarioHistoryActionControllerRef = { current: actionController };
        const { result: draftless } = render({ stateOverrides: { scenarioHistoryActionControllerRef } });
        draftless.requestScenarioHistoryAction('reload', 2);
        draftless.requestScenarioReloadFromJira();
        draftless.requestReloadActiveDraft();
        assert.deepEqual(takeCalls(), [], 'clean requests run the idle guards directly');
        for (const [label, run] of [
            ['history action without a draft', () => draftless.runScenarioHistoryAction({ type: 'reload', versionNumber: 2 })],
            ['active reload without a scope', () => draftless.runReloadActiveDraft()],
            ['Jira reload without a draft', () => draftless.runScenarioReloadFromJira()],
            ['write-back preview without a draft', () => draftless.previewScenarioDraftWriteback()],
            ['write-back gate without a draft', () => draftless.checkScenarioDraftWritebackGate()],
        ]) {
            assert.equal(await run(), undefined, label);
            assert.deepEqual(takeCalls(), [], label);
        }
        const conflictOnlyMeta = { ...loadedMeta, activeDraft: null, baseDraftRevision: null, conflict: { activeDraft: { draftId: 'draft-1' } } };
        const { result: unversioned } = render({ stateOverrides: { scenarioDraftMeta: conflictOnlyMeta, scenarioHistoryActionControllerRef } });
        for (const [label, run] of [
            ['history action without a version', () => unversioned.runScenarioHistoryAction({ type: 'rollback', versionNumber: 0 })],
            ['history action without an action', () => unversioned.runScenarioHistoryAction()],
            ['Jira reload without a base revision', () => unversioned.runScenarioReloadFromJira()],
        ]) {
            assert.equal(await run(), undefined, label);
            assert.deepEqual(takeCalls(), [], label);
        }
        assert.equal(scenarioHistoryActionControllerRef.current, actionController);

        // (b) Opening history without a scope tracks, aborts the previous refresh, opens the panel and stops before fetch.
        const scenarioHistoryRefreshControllerRef = { current: { abort: spy('refreshAbort') } };
        const { result: opener } = render({ stateOverrides: { scenarioHistoryRefreshControllerRef } });
        assert.equal(await opener.openScenarioDraftHistory(), undefined);
        const [trackCall, abortCall, [openName, openUpdater], ...afterOpen] = takeCalls();
        assert.deepEqual(trackCall, ['trackScenarioAction', 'history_open']);
        assert.deepEqual(abortCall, ['refreshAbort']);
        assert.equal(openName, 'setScenarioDraftMeta');
        assert.deepEqual(afterOpen, [], 'no fetchScenarioDraft without a scope');
        assert.deepEqual(openUpdater(loadedMeta), {
            ...loadedMeta, historyOpen: true, pendingHistoryAction: null, loadingHistory: false, error: '',
        });
        assert.ok(scenarioHistoryRefreshControllerRef.current instanceof AbortController);
        assert.equal(scenarioHistoryRefreshControllerRef.current.signal.aborted, false);

        // (c) No network, EventSource, timers or animation frames during render or the exercised calls.
        assert.deepEqual(globalCalls, []);
    } finally {
        for (const [name, value] of Object.entries(savedGlobals)) {
            globalThis[name] = value;
        }
    }
});

const EXPECTED_LAYOUT_RETURN_NAMES = `
registerScenarioIssueRef
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

const EXPECTED_LAYOUT_FUNCTION_NAMES = ['registerScenarioIssueRef', 'toggleScenarioLane', 'showScenarioTooltip',
    'showScenarioTooltipFromElement', 'moveScenarioTooltip', 'hideScenarioTooltip', 'clearScenarioEpicFocus',
    'focusScenarioEpic', 'scrollToScenarioIssue'];

// The H3 values useScenarioPlanner forwards from useScenarioDerived into useScenarioLayout.
const LAYOUT_DERIVED_INPUT_NAMES = ['scenarioSummary', 'scenarioDependencies', 'scenarioCapacityByTeam', 'scenarioIssues',
    'scenarioSearchQuery', 'scenarioSearchMatchSet', 'scenarioExcludedIssueKeys', 'scenarioFocusSet', 'scenarioContextSet',
    'scenarioIssueByKey', 'scenarioDeadline', 'scenarioViewStart', 'scenarioViewEnd', 'scenarioFocusIssueKeys',
    'scenarioFocusContextKeys', 'scenarioTimelineIssues', 'scenarioTimelineWithSegments', 'scenarioTimelineIssueKeys',
    'scenarioAssigneeConflicts'];

test('layout hook preserves its exact flat interface, perf and debug instrumentation, ref callback and DOM-free updaters', () => {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: {
            contents: "export { useScenarioLayout } from './useScenarioLayout.js'; export { useScenarioDerived } from './useScenarioDerived.js'; export { useScenarioState } from './useScenarioState.js';",
            resolveDir: path.dirname(layoutHookPath), sourcefile: 'scenarioLayoutProbe.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const hookModule = new Module(layoutHookPath, module);
    hookModule.filename = layoutHookPath;
    hookModule.paths = module.paths;
    hookModule._compile(compiled, layoutHookPath);
    // renderToString never runs effects, so the nine layout effects (lane auto-collapse, collapse-init reset,
    // layout/scroll measurement, the three edge-update schedulers, pending scroll, focus scroll and the Escape
    // key) and the rAF edge computation are not covered here; tests/ui/scenario_draft_history.spec.js and
    // tests/ui/scenario_focus_positions.spec.js cover them.
    const globalCalls = [];
    const savedGlobals = {};
    for (const name of ['fetch', 'EventSource', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
        savedGlobals[name] = globalThis[name];
        globalThis[name] = function recordedGlobal() { globalCalls.push(name); throw new Error(`${name} must not run`); };
    }
    // performance.* and console.debug are recorded rather than thrown, so instrumentation order is observable.
    const perfCalls = [];
    const perfMethods = ['mark', 'measure', 'clearMarks', 'clearMeasures'];
    let perfCountersRef = null;
    for (const name of perfMethods) {
        performance[name] = (...args) => { perfCalls.push([name, ...args, perfCountersRef?.current.laneStacking]); };
    }
    const savedDebug = console.debug;
    const debugCalls = [];
    console.debug = (...args) => { debugCalls.push(args); };
    const savedNodeEnv = process.env.NODE_ENV;
    const calls = [];
    const spy = name => (...args) => { calls.push([name, ...args]); };
    const takeCalls = () => calls.splice(0, calls.length);
    const EMPTY_ARRAY = Object.freeze([]);
    const EMPTY_OBJECT = Object.freeze({});
    const normalizeEpicKey = value => String(value || '').trim().toUpperCase();
    const render = ({ stateOverrides = {}, perfEnabled = false, counters = { laneStacking: 0 }, nodeEnv } = {}) => {
        let result;
        let derived;
        let scenarioState;
        perfCountersRef = { current: counters };
        const layoutPerfCountersRef = perfCountersRef;
        function Probe() {
            scenarioState = { ...hookModule.exports.useScenarioState({ initialLaneMode: 'team' }), ...stateOverrides };
            derived = hookModule.exports.useScenarioDerived({
                scenarioState, EMPTY_ARRAY, EMPTY_OBJECT, jiraUrl: '', searchQuery: '', normalizeEpicKey, excludedEpicSet: new Set(),
            });
            result = hookModule.exports.useScenarioLayout({
                scenarioState, perfEnabled, perfCountersRef: layoutPerfCountersRef, showScenario: true, normalizeEpicKey,
                isAllTeamsSelected: false, excludedEpicSet: new Set(),
                ...Object.fromEntries(LAYOUT_DERIVED_INPUT_NAMES.map(name => [name, derived[name]])),
            });
            return null;
        }
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
        try {
            assert.equal(renderToString(React.createElement(Probe)), '');
        } finally {
            if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = savedNodeEnv;
        }
        return { result, derived, scenarioState };
    };
    const DAY_MS = 24 * 60 * 60 * 1000;
    const day = (y, m, d) => new Date(y, m - 1, d).getTime();
    const issues = [
        { key: 'DEMO-1', summary: 'Build API', team: 'Alpha', assignee: 'Ana', epicKey: 'EPIC-1', epicSummary: 'Platform', start: '2026-01-05', end: '2026-01-20', sp: 3, status: 'Accepted' },
        { key: 'DEMO-2', summary: 'Build UI', team: 'Alpha', assignee: 'Bo', epicKey: 'EPIC-1', epicSummary: 'Platform', start: '2026-01-12', end: '2026-01-26', sp: 2, status: 'In Progress' },
        { key: 'DEMO-3', summary: 'Docs', team: 'Beta', assignee: 'Cy', epicKey: 'EPIC-2', start: '2026-02-02', end: '2026-02-09', sp: 1, status: 'To Do' },
        { key: 'DEMO-4', summary: 'Rollout', team: 'Beta', assignee: 'Cy', epicKey: 'EPIC-2', start: '2026-02-16', end: '2026-03-16', sp: 5, status: 'To Do' },
    ];
    const scenarioData = {
        config: { start_date: '2026-01-05', quarter_end_date: '2026-03-31' },
        dependencies: [{ from: 'DEMO-1', to: 'DEMO-2', type: 'block' }],
        issues,
    };
    const scenarioLayout = { width: 1000, height: 400, labelWidth: 200 };
    const visibleTip = Object.freeze({ visible: true, x: 5, y: 6, key: 'DEMO-1' });
    const hiddenTip = Object.freeze({ visible: false, x: 0, y: 0, key: '' });
    try {
        // (a) Exact interface: plain values, function members are functions; idle (no data) early returns.
        const { result: idle } = render({ perfEnabled: true, counters: { laneStacking: 7 }, nodeEnv: 'development' });
        assert.deepEqual(Object.keys(idle), EXPECTED_LAYOUT_RETURN_NAMES);
        assert.equal(EXPECTED_LAYOUT_RETURN_NAMES.length, 31);
        for (const name of EXPECTED_LAYOUT_RETURN_NAMES) {
            assert.equal(Object.getOwnPropertyDescriptor(idle, name).get, undefined, name);
            assert.equal(typeof idle[name] === 'function', EXPECTED_LAYOUT_FUNCTION_NAMES.includes(name), name);
        }
        assert.equal(idle.SCENARIO_LANE_HEIGHT, 52);
        assert.equal(idle.scenarioBarGap, 10);
        assert.equal(idle.scenarioDeadlineAtRisk, false);
        assert.equal(idle.scenarioLaneInfo.size, 0);
        assert.equal(idle.scenarioIssuesByLane.size, 0);
        assert.equal(idle.scenarioLaneMeta.meta.size, 0);
        assert.equal(idle.scenarioLaneMeta.totalHeight, 0);
        assert.deepEqual(idle.scenarioPositions, {});
        assert.equal(idle.scenarioTodayLeft, null);
        for (const name of ['scenarioLateItems', 'scenarioCriticalPathItems', 'scenarioUnschedulableItems', 'scenarioTicks',
            'scenarioQuarterMarkers', 'scenarioJiraEpicKeys', 'scenarioJiraStoryKeys', 'scenarioEpicBars', 'scenarioEpicEdges',
            'scenarioVisibleLanes']) {
            assert.deepEqual(idle[name], [], name);
        }
        // Empty lanes return the early stacking literal before the perf counter and marks; positions return {}
        // before the development debug block.
        assert.deepEqual(perfCountersRef.current, { laneStacking: 7 });
        assert.deepEqual(perfCalls.splice(0), []);
        assert.deepEqual(debugCalls.splice(0), []);

        // (b) With lanes, perf on: one laneStacking increment before the start mark, then the original mark/measure/clear order.
        const counters = { laneStacking: 4, layoutReads: 0, scrollReads: 0, edgeComputes: 0, edgeRequests: 0, edgeFrames: 0 };
        const { result: timed } = render({ stateOverrides: { scenarioData, scenarioLayout }, perfEnabled: true, counters });
        assert.deepEqual(perfCountersRef.current,
            { laneStacking: 5, layoutReads: 0, scrollReads: 0, edgeComputes: 0, edgeRequests: 0, edgeFrames: 0 });
        assert.deepEqual(perfCalls.splice(0), [
            ['mark', 'scenarioLaneStacking:start', 5],
            ['mark', 'scenarioLaneStacking:end', 5],
            ['measure', 'scenarioLaneStacking', 'scenarioLaneStacking:start', 'scenarioLaneStacking:end', 5],
            ['clearMarks', 'scenarioLaneStacking:start', 5],
            ['clearMarks', 'scenarioLaneStacking:end', 5],
            ['clearMeasures', 'scenarioLaneStacking', 5],
        ]);
        assert.deepEqual([...timed.scenarioLaneInfo.keys()], ['Alpha', 'Beta']);
        assert.deepEqual([...timed.scenarioLaneMeta.meta.keys()], ['Alpha', 'Beta']);
        assert.deepEqual(Object.keys(timed.scenarioPositions), ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4']);
        assert.deepEqual([...timed.scenarioBlockedSet], ['DEMO-2']);
        // Not development: the positions debug block stays silent even with an Accepted task.
        assert.deepEqual(debugCalls.splice(0), []);

        // (b) Perf off: no counter change and no performance calls.
        const { result: untimed } = render({ stateOverrides: { scenarioData, scenarioLayout }, nodeEnv: 'production' });
        assert.deepEqual(perfCountersRef.current, { laneStacking: 0 });
        assert.deepEqual(perfCalls.splice(0), []);
        assert.deepEqual(debugCalls.splice(0), []);
        assert.deepEqual(untimed.scenarioPositions, timed.scenarioPositions);

        // (b) Development NODE_ENV with an Accepted task and a measured width: the two original debug lines.
        const { derived: devDerived } = render({ stateOverrides: { scenarioData, scenarioLayout }, nodeEnv: 'development' });
        assert.equal(debugCalls.length, 2);
        const [[acceptedLabel, accepted], [rangeLabel, range]] = debugCalls.splice(0);
        assert.equal(acceptedLabel, '[Scenario] Accepted tasks:');
        assert.deepEqual(accepted, [{ key: 'DEMO-1', start: '2026-01-05', end: '2026-01-20', scheduledReason: undefined }]);
        assert.equal(rangeLabel, '[Scenario] View range:');
        assert.deepEqual(Object.keys(range), ['start', 'end', 'today']);
        assert.equal(range.start, devDerived.scenarioViewStart);
        assert.equal(range.end, devDerived.scenarioViewEnd);
        assert.ok(range.today instanceof Date);
        // ...but not without an Accepted task, and not when the positions early return fires first.
        render({ stateOverrides: { scenarioData: { ...scenarioData, issues: issues.map(i => ({ ...i, status: 'To Do' })) }, scenarioLayout }, nodeEnv: 'development' });
        assert.deepEqual(debugCalls.splice(0), []);
        const { result: unmeasured } = render({ stateOverrides: { scenarioData }, nodeEnv: 'development' });
        assert.deepEqual(unmeasured.scenarioPositions, {});
        assert.equal(unmeasured.scenarioTodayLeft, null);
        assert.deepEqual(debugCalls.splice(0), []);
        assert.deepEqual(perfCalls.splice(0), []);

        // (c) registerScenarioIssueRef: the ref callback stores a node under its key and deletes it on null,
        // reading the ref's current Map at call time.
        const { result: refs, scenarioState: refState } = render();
        const refMap = refState.scenarioIssueRefMap.current;
        const other = { id: 'other' };
        refMap.set('DEMO-9', other);
        const refCallback = refs.registerScenarioIssueRef('DEMO-1');
        assert.equal(typeof refCallback, 'function');
        const node = { id: 'node-1' };
        assert.equal(refCallback(node), undefined);
        assert.deepEqual([...refMap], [['DEMO-9', other], ['DEMO-1', node]]);
        refCallback(null);
        assert.deepEqual([...refMap], [['DEMO-9', other]]);
        const swapped = new Map();
        refState.scenarioIssueRefMap.current = swapped;
        refCallback(node);
        assert.deepEqual([...swapped], [['DEMO-1', node]]);
        assert.deepEqual([...refMap], [['DEMO-9', other]]);

        // (c) Lane toggle and tooltip updaters, with recording setters.
        const setters = () => ({
            setScenarioCollapsedLanes: spy('setScenarioCollapsedLanes'),
            setScenarioTooltip: spy('setScenarioTooltip'),
            setScenarioEpicFocus: spy('setScenarioEpicFocus'),
            setScenarioRangeOverride: spy('setScenarioRangeOverride'),
            setScenarioLaneMode: spy('setScenarioLaneMode'),
            setScenarioFlashKey: spy('setScenarioFlashKey'),
        });
        const scenarioTooltipAnchorRef = { current: 'anchor' };
        const { result: ui } = render({ stateOverrides: { ...setters(), scenarioTooltipAnchorRef } });
        ui.toggleScenarioLane('Alpha');
        const [[toggleName, toggleUpdater], ...afterToggle] = takeCalls();
        assert.equal(toggleName, 'setScenarioCollapsedLanes');
        assert.deepEqual(afterToggle, []);
        const collapsed = Object.freeze({ Alpha: true, Beta: false });
        assert.deepEqual(toggleUpdater(collapsed), { Alpha: false, Beta: false });
        assert.deepEqual(toggleUpdater(null), { Alpha: true });
        ui.toggleScenarioLane('Beta');
        assert.deepEqual(takeCalls()[0][1](Object.freeze({ Alpha: true })), { Alpha: true, Beta: true });

        ui.hideScenarioTooltip();
        assert.equal(scenarioTooltipAnchorRef.current, null);
        const [[hideName, hideUpdater], ...afterHide] = takeCalls();
        assert.equal(hideName, 'setScenarioTooltip');
        assert.deepEqual(afterHide, []);
        assert.deepEqual(hideUpdater(visibleTip), { ...visibleTip, visible: false });
        assert.equal(hideUpdater(hiddenTip), hiddenTip);

        // Move: no anchor sets nothing; a hidden tooltip keeps its identity without measuring the anchor.
        ui.moveScenarioTooltip();
        assert.deepEqual(takeCalls(), []);
        scenarioTooltipAnchorRef.current = {};
        ui.moveScenarioTooltip();
        const [[moveName, moveUpdater], ...afterMove] = takeCalls();
        assert.equal(moveName, 'setScenarioTooltip');
        assert.deepEqual(afterMove, []);
        assert.equal(moveUpdater(hiddenTip), hiddenTip);

        // Show guards: no payload or element returns before touching the anchor or the tooltip.
        scenarioTooltipAnchorRef.current = 'kept';
        ui.showScenarioTooltip({ clientX: 1, clientY: 1 }, null);
        ui.showScenarioTooltipFromElement(null, { key: 'DEMO-1' });
        ui.showScenarioTooltipFromElement({ id: 'element' }, null);
        assert.deepEqual(takeCalls(), []);
        assert.equal(scenarioTooltipAnchorRef.current, 'kept');
        // Pointer fallback (event without currentTarget, unmeasured 240x56 tooltip) against a stub viewport.
        const savedWindow = globalThis.window;
        try {
            for (const [viewport, event, expected] of [
                [{ innerWidth: 1000, innerHeight: 800 }, { clientX: 100, clientY: 200 }, { x: 110, y: 134 }],
                [{ innerWidth: 1000, innerHeight: 800 }, { clientX: 900, clientY: 20 }, { x: 650, y: 30 }],
                [{ innerWidth: 1000, innerHeight: 700 }, { clientX: 5, clientY: 790 }, { x: 15, y: 632 }],
            ]) {
                globalThis.window = viewport;
                ui.showScenarioTooltip(event, { key: 'DEMO-1', summary: 'Build API' });
                assert.equal(scenarioTooltipAnchorRef.current, null);
                assert.deepEqual(takeCalls(), [['setScenarioTooltip', { key: 'DEMO-1', summary: 'Build API', visible: true, ...expected }]]);
            }
        } finally {
            if (savedWindow === undefined) delete globalThis.window;
            else globalThis.window = savedWindow;
        }

        // (c) Clearing Epic focus restores the saved lane mode, collapsed lanes, range and scroll, then drops the restore.
        const epicFocus = { key: 'EPIC-1', summary: 'Platform' };
        const savedRange = { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) };
        const restoreCollapsed = { Alpha: true };
        const focusRefs = (restore) => ({
            scenarioFocusRestoreRef: { current: restore },
            scenarioSkipAutoCollapseRef: { current: false },
            scenarioTooltipAnchorRef: { current: 'anchor' },
            scenarioPendingScrollRef: { current: null },
            scenarioTimelineRef: { current: { scrollTop: 120, scrollTo: spy('scrollTo') } },
        });
        const focused = (restore, extra = {}) => {
            const refsFor = focusRefs(restore);
            const { result } = render({ stateOverrides: {
                ...setters(), ...refsFor, scenarioData, scenarioEpicFocus: epicFocus, scenarioLaneMode: 'epic', ...extra,
            } });
            return { result, refsFor };
        };
        const tooltipStep = (recorded, index) => {
            assert.equal(recorded[index][0], 'setScenarioTooltip');
            assert.equal(recorded[index][1](hiddenTip), hiddenTip);
            recorded[index] = ['setScenarioTooltip'];
        };
        const restoring = focused({ laneMode: 'team', collapsedLanes: restoreCollapsed, scrollTop: 40, rangeOverride: savedRange });
        restoring.result.clearScenarioEpicFocus();
        const restoredCalls = takeCalls();
        tooltipStep(restoredCalls, 1);
        assert.deepEqual(restoredCalls, [
            ['setScenarioEpicFocus', null], ['setScenarioTooltip'], ['setScenarioRangeOverride', savedRange],
            ['setScenarioLaneMode', 'team'], ['setScenarioCollapsedLanes', restoreCollapsed],
            ['scrollTo', { top: 40, behavior: 'auto' }],
        ]);
        assert.equal(restoredCalls[2][1], savedRange);
        assert.equal(restoredCalls[4][1], restoreCollapsed);
        assert.equal(restoring.refsFor.scenarioFocusRestoreRef.current, null);
        assert.equal(restoring.refsFor.scenarioTooltipAnchorRef.current, null);
        assert.equal(restoring.refsFor.scenarioSkipAutoCollapseRef.current, false);
        // An Epic-mode restore skips the next auto-collapse and keeps the current lane mode.
        const epicRestore = focused({ laneMode: 'epic', scrollTop: 'n/a' });
        epicRestore.result.clearScenarioEpicFocus();
        const epicRestoreCalls = takeCalls();
        tooltipStep(epicRestoreCalls, 1);
        assert.deepEqual(epicRestoreCalls, [['setScenarioEpicFocus', null], ['setScenarioTooltip'], ['setScenarioRangeOverride', null]]);
        assert.equal(epicRestore.refsFor.scenarioSkipAutoCollapseRef.current, true);
        assert.equal(epicRestore.refsFor.scenarioFocusRestoreRef.current, null);
        // No restore: focus, tooltip and range only.
        const bare = focused(null);
        bare.result.clearScenarioEpicFocus();
        const bareCalls = takeCalls();
        tooltipStep(bareCalls, 1);
        assert.deepEqual(bareCalls, [['setScenarioEpicFocus', null], ['setScenarioTooltip'], ['setScenarioRangeOverride', null]]);
        assert.equal(bare.refsFor.scenarioSkipAutoCollapseRef.current, false);
        // Without focus, clear is a no-op that keeps the restore.
        const unfocusedRefs = focusRefs('kept-restore');
        const { result: unfocused } = render({ stateOverrides: { ...setters(), ...unfocusedRefs, scenarioData } });
        unfocused.clearScenarioEpicFocus();
        assert.deepEqual(takeCalls(), []);
        assert.equal(unfocusedRefs.scenarioFocusRestoreRef.current, 'kept-restore');

        // (c) Focusing an Epic saves the restore point, switches to Epic lanes and pads the Epic's date range.
        const teamRefs = focusRefs(null);
        const { result: team } = render({ stateOverrides: {
            ...setters(), ...teamRefs, scenarioData, scenarioCollapsedLanes: restoreCollapsed, scenarioRangeOverride: savedRange,
        } });
        team.focusScenarioEpic('', 'Ignored');
        assert.deepEqual(takeCalls(), []);
        team.focusScenarioEpic('EPIC-1', 'Issue. Platform');
        assert.deepEqual(teamRefs.scenarioFocusRestoreRef.current,
            { laneMode: 'team', collapsedLanes: { Alpha: true }, scrollTop: 120, rangeOverride: savedRange });
        assert.notEqual(teamRefs.scenarioFocusRestoreRef.current.collapsedLanes, restoreCollapsed);
        const [focusCall, modeCall, [rangeName, epicRange], ...afterFocus] = takeCalls();
        assert.deepEqual(focusCall, ['setScenarioEpicFocus', { key: 'EPIC-1', summary: 'Platform' }]);
        assert.deepEqual(modeCall, ['setScenarioLaneMode', 'epic']);
        assert.equal(rangeName, 'setScenarioRangeOverride');
        assert.deepEqual(afterFocus, []);
        // A three-week Epic gets the two-day minimum padding.
        assert.equal(epicRange.start.getTime(), day(2026, 1, 5) - 2 * DAY_MS);
        assert.equal(epicRange.end.getTime(), day(2026, 1, 26) + 2 * DAY_MS);
        // A longer Epic is padded by 6% of its span.
        team.focusScenarioEpic('EPIC-2', '');
        const [[, epic2Focus], , [, epic2Range]] = takeCalls();
        assert.deepEqual(epic2Focus, { key: 'EPIC-2', summary: 'EPIC-2' });
        const span = day(2026, 3, 16) - day(2026, 2, 2);
        assert.ok(span * 0.06 > 2 * DAY_MS);
        assert.equal(epic2Range.start.getTime(), day(2026, 2, 2) - span * 0.06);
        assert.equal(epic2Range.end.getTime(), day(2026, 3, 16) + span * 0.06);
        // An Epic without dated issues clears the range override.
        team.focusScenarioEpic('EPIC-9', 'Empty');
        assert.deepEqual(takeCalls(), [
            ['setScenarioEpicFocus', { key: 'EPIC-9', summary: 'Empty' }], ['setScenarioLaneMode', 'epic'], ['setScenarioRangeOverride', null],
        ]);
        // While focused: the same Epic clears focus; another Epic keeps the original restore point and Epic lanes.
        const sameRefs = focused({ laneMode: 'team' });
        sameRefs.result.focusScenarioEpic('EPIC-1', 'Platform');
        const sameCalls = takeCalls();
        assert.deepEqual(sameCalls.map(([name]) => name), ['setScenarioEpicFocus', 'setScenarioTooltip', 'setScenarioRangeOverride', 'setScenarioLaneMode']);
        assert.equal(sameCalls[0][1], null);
        const switchRefs = focused('original-restore');
        switchRefs.result.focusScenarioEpic('EPIC-2', 'Docs');
        assert.equal(switchRefs.refsFor.scenarioFocusRestoreRef.current, 'original-restore');
        assert.deepEqual(takeCalls().map(([name, value]) => [name, name === 'setScenarioRangeOverride' ? typeof value : value]), [
            ['setScenarioEpicFocus', { key: 'EPIC-2', summary: 'Docs' }], ['setScenarioRangeOverride', 'object'],
        ]);

        // (c) scrollToScenarioIssue: while focused it parks the key and clears focus; otherwise unknown issues and a
        // missing timeline return before any window scroll, flash or timer.
        const parked = focused(null);
        parked.result.scrollToScenarioIssue('DEMO-1');
        assert.equal(parked.refsFor.scenarioPendingScrollRef.current, 'DEMO-1');
        assert.deepEqual(takeCalls().map(([name]) => name), ['setScenarioEpicFocus', 'setScenarioTooltip', 'setScenarioRangeOverride']);
        const { result: plain } = render({ stateOverrides: { ...setters(), scenarioData, scenarioTimelineRef: { current: null } } });
        plain.scrollToScenarioIssue('DEMO-404');
        plain.scrollToScenarioIssue('DEMO-1');
        assert.deepEqual(takeCalls(), []);

        // (d) No network, EventSource, timers or animation frames during render or the exercised calls.
        assert.deepEqual(globalCalls, []);
        assert.deepEqual(perfCalls, []);
        assert.deepEqual(debugCalls, []);
    } finally {
        for (const [name, value] of Object.entries(savedGlobals)) {
            globalThis[name] = value;
        }
        for (const name of perfMethods) delete performance[name];
        console.debug = savedDebug;
        if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedNodeEnv;
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
    const source = fs.readFileSync(draftHookPath, 'utf8');
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

// matchesScenarioSearch moved with its only reader into the derived hook (SC3 H3); the two equality helpers
// moved with the auto-collapse effect and the edge scheduler into the layout hook (SC3 H6).
const pureHelperSourcePaths = {
    matchesScenarioSearch: derivedHookPath,
    areScenarioCollapsedLanesEqual: layoutHookPath,
    areScenarioEdgeRendersEqual: layoutHookPath,
};

for (const name of Object.keys(EXPECTED_PURE_HELPER_OUTPUTS)) {
    test(`${name} preserves the legacy deterministic helper oracle`, () => {
        const source = fs.readFileSync(pureHelperSourcePaths[name] || hookPath, 'utf8');
        const match = source.match(new RegExp(`const ${name} = \\([\\s\\S]*?\\n\\s*\\};`));
        assert.ok(match, `Expected the existing pure ${name} body`);
        const helper = vm.runInNewContext(`${match[0]}\n${name}`);
        const actual = pureHelperCases[name]().map(args => helper(...args));
        assert.deepEqual(actual, EXPECTED_PURE_HELPER_OUTPUTS[name]);
    });
}
