const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const hookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioPlanner.js');
const draftHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioDraft.js');
const realtimeHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioRealtime.js');
const derivedHookPath = path.join(__dirname, '../frontend/src/scenario/useScenarioDerived.js');

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

// matchesScenarioSearch moved with its only reader into the derived hook (SC3 H3).
const pureHelperSourcePaths = { matchesScenarioSearch: derivedHookPath };

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
