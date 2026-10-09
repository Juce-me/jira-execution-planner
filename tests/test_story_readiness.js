const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

// Behavioral tests for the Planning edit fence on Story readiness reads (issue #250). The REAL hooks run on a minimal React
// runtime; only the API module is replaced, with deferred promises. A readiness read that started before a status or priority
// edit must not erase it, and every edit-state read it begins must be finished exactly once.
const engDir = path.resolve(__dirname, '../frontend/src/eng');
const settle = () => new Promise(resolve => setImmediate(resolve));
const flush = async (ticks = 6) => { for (let i = 0; i < ticks; i += 1) await settle(); };

const SCOPE = { groupId: 'group-alpha', sprintId: '3001', sprintName: 'Sprint 42', sprintState: 'active' };
const deferred = () => {
    const out = {};
    out.promise = new Promise((resolve, reject) => { out.resolve = resolve; out.reject = reject; });
    return out;
};
const readinessEpic = (key, status = 'To Do', priority = 'Medium') => ({
    key, projectClass: 'product', status: { name: status }, priority: { name: priority }, missingTeams: [],
});
const snapshotOf = (...epics) => ({ schemaVersion: 1, complete: true, scope: { ...SCOPE }, epics });

async function newEditState() {
    const { createEngIssueEditState } = await import('../frontend/src/eng/engIssueEditState.js');
    return createEngIssueEditState();
}

function readinessHarness(issueEditState, extra = {}) {
    const calls = { story: [], epic: [] };
    const api = {
        fetchStoryReadiness: (_url, options) => { const d = deferred(); calls.story.push({ options, ...d }); return d.promise; },
        fetchEpicReadiness: (_url, options) => { const d = deferred(); calls.epic.push({ options, ...d }); return d.promise; },
    };
    const mounted = mountBundledHook({
        entry: path.join(engDir, 'useStoryReadiness.js'),
        exportName: 'useStoryReadiness',
        modules: { '../api/engApi.js': api },
        makeProps: () => ({
            backendUrl: 'https://synthetic.invalid', enabled: true, primaryReady: true, ...SCOPE, issueEditState, ...extra,
        }),
    });
    return { calls, mounted };
}

const statusEdit = (state, key, prior, optimistic) => state.reservePlanningEdit({
    issueKey: key, field: 'status', prior: { name: prior }, optimistic: { name: optimistic }, scope: 'scope-a',
});

test('a department read that lands while a status edit is pending keeps the optimistic value', async () => {
    const state = await newEditState();
    const { calls, mounted } = readinessHarness(state);
    mounted.render();
    assert.equal(calls.story.length, 1);
    assert.equal(state.activeReadCount(), 1, 'the department read holds one edit-state read');

    const token = statusEdit(state, 'EPIC-1', 'To Do', 'In Progress');
    assert.ok(token);
    calls.story[0].resolve(snapshotOf(readinessEpic('EPIC-1', 'To Do'), readinessEpic('EPIC-2', 'To Do')));
    await flush();
    const { snapshot, status } = mounted.render();
    assert.equal(status, 'ready');
    assert.equal(snapshot.epics[0].status.name, 'In Progress', 'the pending edit stays on top of the read');
    assert.equal(snapshot.epics[1].status.name, 'To Do', 'an untouched Epic keeps what the read returned');
    assert.equal(state.activeReadCount(), 0, 'the read is finished after the commit');
    mounted.unmount();
});

test('a department read that started before a now-confirmed edit does not erase it', async () => {
    const state = await newEditState();
    const { calls, mounted } = readinessHarness(state);
    mounted.render();
    const token = statusEdit(state, 'EPIC-1', 'To Do', 'Done');
    state.settlePlanningConfirmed(token, { name: 'Done' });

    calls.story[0].resolve(snapshotOf(readinessEpic('EPIC-1', 'To Do')));
    await flush();
    assert.equal(mounted.render().snapshot.epics[0].status.name, 'Done', 'the confirmed value outranks an older read');
    assert.equal(state.activeReadCount(), 0);
    mounted.unmount();
});

test('a read that starts after a confirmed edit is authoritative and shows what Jira returned', async () => {
    const state = await newEditState();
    const token = statusEdit(state, 'EPIC-1', 'To Do', 'Done');
    state.settlePlanningConfirmed(token, { name: 'Done' });
    const { calls, mounted } = readinessHarness(state);
    mounted.render();
    calls.story[0].resolve(snapshotOf(readinessEpic('EPIC-1', 'In Progress')));
    await flush();
    assert.equal(mounted.render().snapshot.epics[0].status.name, 'In Progress');
    mounted.unmount();
});

test('an epic field the read does not carry is not manufactured', async () => {
    const state = await newEditState();
    const { calls, mounted } = readinessHarness(state);
    mounted.render();
    statusEdit(state, 'EPIC-2', 'To Do', 'Done');
    const epic = readinessEpic('EPIC-1');
    calls.story[0].resolve(snapshotOf(epic));
    await flush();
    assert.equal(mounted.render().snapshot.epics[0], epic, 'an Epic with no edit keeps its identity and fields');
    mounted.unmount();
});

test('every department read finishes its edit-state read once: failure, abort and an invalid scope too', async () => {
    const state = await newEditState();
    const failing = readinessHarness(state);
    failing.mounted.render();
    failing.calls.story[0].reject(Object.assign(new Error('unavailable'), { status: 503 }));
    await flush();
    assert.equal(failing.mounted.render().status, 'unavailable');
    assert.equal(state.activeReadCount(), 0, 'a failed read is finished');
    failing.mounted.unmount();

    const aborted = readinessHarness(state);
    aborted.mounted.render();
    assert.equal(state.activeReadCount(), 1);
    aborted.mounted.unmount();
    aborted.calls.story[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await flush();
    assert.equal(state.activeReadCount(), 0, 'an aborted read is finished');

    const stale = readinessHarness(state);
    stale.mounted.render();
    stale.calls.story[0].resolve({ ...snapshotOf(readinessEpic('EPIC-1')), scope: { ...SCOPE, sprintId: '9' } });
    await flush();
    assert.equal(stale.mounted.render().status, 'invalid_scope');
    assert.equal(state.activeReadCount(), 0, 'an ignored result is finished');
    stale.mounted.unmount();
});

test('a read with no edit state behaves as before', async () => {
    const { calls, mounted } = readinessHarness(null);
    mounted.render();
    const snapshot = snapshotOf(readinessEpic('EPIC-1'));
    calls.story[0].resolve(snapshot);
    await flush();
    assert.equal(mounted.render().snapshot, snapshot);
    mounted.unmount();
});

test('a per-Epic answer retains its edit-state read until released and fences the merge', async () => {
    const state = await newEditState();
    const { calls, mounted } = readinessHarness(state);
    mounted.render();
    calls.story[0].resolve(snapshotOf(readinessEpic('EPIC-1', 'To Do')));
    await flush();
    mounted.render();
    assert.equal(state.activeReadCount(), 0);

    const loading = mounted.result.loadEpic('EPIC-1');
    await flush();
    assert.equal(state.activeReadCount(), 1, 'the per-Epic read holds an edit-state read while in flight');
    const token = statusEdit(state, 'EPIC-1', 'To Do', 'In Progress');
    assert.ok(token);
    calls.epic[0].resolve(snapshotOf(readinessEpic('EPIC-1', 'To Do')));
    const handle = await loading;
    assert.equal(handle.status, 'ok');
    assert.equal(state.activeReadCount(), 1, 'an ok answer keeps its read until the consumer releases it');

    mounted.result.mergeEpic('EPIC-1', handle.payload, { readToken: handle.readToken });
    const merged = mounted.render().snapshot.epics[0];
    assert.equal(merged.status.name, 'In Progress', 'the pending edit survives a per-Epic payload that predates it');
    handle.release();
    assert.equal(state.activeReadCount(), 0);
    mounted.unmount();
});

test('a per-Epic answer that is not ok has already finished its read', async () => {
    const state = await newEditState();
    const { calls, mounted } = readinessHarness(state);
    mounted.render();
    calls.story[0].resolve(snapshotOf(readinessEpic('EPIC-1')));
    await flush();
    mounted.render();

    const failing = mounted.result.loadEpic('EPIC-1');
    await flush();
    calls.epic[0].reject(new Error('boom'));
    assert.equal((await failing).status, 'failed');
    assert.equal(state.activeReadCount(), 0);

    const wrongScope = mounted.result.loadEpic('EPIC-1');
    await flush();
    calls.epic[1].resolve({ ...snapshotOf(readinessEpic('EPIC-1')), scope: { ...SCOPE, groupId: 'other' } });
    assert.equal((await wrongScope).status, 'failed');
    assert.equal(state.activeReadCount(), 0);

    const aborted = mounted.result.loadEpic('EPIC-1');
    await flush();
    calls.epic[2].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    assert.equal((await aborted).status, 'ignored');
    assert.equal(state.activeReadCount(), 0);
    mounted.unmount();
});

// The real consumer: useEpicRefresh.recheckEpicAlerts must finish the retained read exactly once on every exit.
function recheckHarness({ guards = { epoch: 1, version: 1, scopeKey: 's' }, mergeReadinessEpic = () => {}, omitMerge = false } = {}) {
    const state = { guards: { ...guards }, alertVersion: 1, merges: [], releases: 0 };
    const mounted = mountBundledHook({
        entry: path.join(engDir, 'useEpicRefresh.js'),
        exportName: 'useEpicRefresh',
        modules: {
            'react-dom': { flushSync: fn => fn() },
            '../issues/IssueCard.jsx': { REMOVE_FADE_MS: 0 },
        },
        makeProps: () => ({
            getState: () => ({ epicDetails: {} }),
            getProtectedKeys: () => new Set(),
            setters: {},
            readGuards: () => ({ ...state.guards }),
            getAlertVersion: () => state.alertVersion,
            isFutureSprint: false,
            sourceSurface: 'catch_up',
            track: () => {},
            loadEpicRefresh: async () => ({}),
            loadEpicReadiness: async () => ({ status: 'ok', payload: { epics: [] }, readToken: { id: 0 }, release: () => { state.releases += 1; } }),
            mergeReadinessEpic: omitMerge ? undefined : (...args) => { state.merges.push(args); mergeReadinessEpic(...args); },
        }),
    });
    return { state, mounted };
}

test('recheckEpicAlerts releases the retained readiness read once when it merges the answer', async () => {
    const { state, mounted } = recheckHarness();
    mounted.render();
    await mounted.result.recheckEpicAlerts('EPIC-1', ['readiness']);
    assert.equal(state.merges.length, 1);
    assert.deepEqual(state.merges[0][2].readToken, { id: 0 }, 'the merge receives the read the answer was fenced by');
    assert.equal(state.releases, 1);
    mounted.unmount();
});

test('recheckEpicAlerts releases the retained read when a stale alert version discards the answer', async () => {
    const { state, mounted } = recheckHarness();
    mounted.render();
    const pending = mounted.result.recheckEpicAlerts('EPIC-1', ['readiness']);
    state.alertVersion = 2; // leaving Catch Up re-arms the cohort while the answer is in flight
    const outcome = await pending;
    assert.deepEqual(outcome, { discarded: true });
    assert.equal(state.merges.length, 0, 'a discarded answer is never merged');
    assert.equal(state.releases, 1, 'but its edit-state read is finished');
    mounted.unmount();
});

test('recheckEpicAlerts releases the retained read after a scope change and after a merge callback that throws', async () => {
    const scope = recheckHarness();
    scope.mounted.render();
    const pending = scope.mounted.result.recheckEpicAlerts('EPIC-1', ['readiness']);
    scope.state.guards.scopeKey = 'other';
    assert.deepEqual(await pending, { discarded: true });
    assert.equal(scope.state.releases, 1);
    scope.mounted.unmount();

    const throwing = recheckHarness({ mergeReadinessEpic: () => { throw new Error('merge failed'); } });
    throwing.mounted.render();
    await assert.rejects(() => throwing.mounted.result.recheckEpicAlerts('EPIC-1', ['readiness']), /merge failed/);
    assert.equal(throwing.state.releases, 1);
    throwing.mounted.unmount();

    const missing = recheckHarness({ omitMerge: true });
    missing.mounted.render();
    await missing.mounted.result.recheckEpicAlerts('EPIC-1', ['readiness']);
    assert.equal(missing.state.releases, 1, 'a missing merge callback still finishes the read');
    missing.mounted.unmount();
});
