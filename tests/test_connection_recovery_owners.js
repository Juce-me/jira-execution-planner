const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRuntime, mountBundledHook } = require('./react_hook_harness');

function browserStorage() {
    const oldWindow = global.window, oldDocument = global.document;
    const values = new Map([['jira_dashboard_connection_recovery_v1', 'synthetic recovery backup']]);
    const released = [];
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    global.window = Object.assign(new EventTarget(), { sessionStorage: storage,
        requestAnimationFrame: callback => { callback(); return 1; }, scrollTo() {} });
    global.document = new EventTarget();
    return { values, storage, released, close() { global.window = oldWindow; global.document = oldDocument; } };
}

function validSnapshot() {
    return { principal: { workspaceId: 'workspace-1', viewConfigId: 'view-1' }, outage: { id: 'synthetic-outage' },
        view: { selectedView: 'eng', activeGroupId: 'g', selectedSprint: '17', engMode: 'planning', scrollX: 0, scrollY: 0 }, droppedSettings: false,
        scenario: { groupId: 'g', sprintId: '17', scopeKey: 'scenario-scope', activeDraftId: null, baseDraftRevision: 0,
            savedOverrides: {}, localOverrides: {}, editMode: false, scrollTop: 0, scrollLeft: 0 },
        planning: { scope: { workspaceId: 'workspace-1', groupId: 'g', sprintId: '17', namespaceId: null }, selectedTeams: [], submission: null,
            draft: { inclusionChanges: [{ issueId: '1', included: true, baseRevision: 0 }], initializePlan: true, basePlanRevision: 0,
                baseScopeProof: 'synthetic-proof', baseSchemaRevision: 0, baseViewRevision: 0, schemaChanges: [], cellChanges: [] } },
    };
}

function recovery({ planning = true, scenario = true } = {}) {
    return { planning: planning ? { draft: { inclusionChanges: [{ issueId: '1', included: true, baseRevision: 0 }] } } : null,
        scenario: scenario ? { groupId: 'g', sprintId: '17', scopeKey: 'scenario-scope' } : null,
        view: { activeGroupId: 'g', selectedSprint: '17', engMode: 'planning', scrollX: 0, scrollY: 0 } };
}

test('Planning-only reconnect retains its backup while baseline recovery is held or fails', () => {
    const h = browserStorage(), pendingRecoveryRef = { current: recovery({ scenario: false }) };
    const initial = pendingRecoveryRef.current;
    const hook = mountBundledHook({ entry: path.resolve('frontend/src/scenario/connectionScenarioRecovery.js'), exportName: 'useConnectionScenarioRecovery', makeProps: () => ({
        activeGroupId: 'g', selectedSprint: '17', availableSprints: [{ id: '17' }], visibleControlGroups: [{ id: 'g' }],
        groupsLoading: false, sprintsLoading: false, pendingRecoveryRef, pendingShellRef: { current: null },
        runScenario: async () => { throw new Error('Scenario must not run'); }, releaseOwnership: status => h.released.push(status),
        scenarioScopeKey: '', scenarioStartedRef: { current: false }, setNotice() {}, setStatus() {}, showScenario: false, stagedRevision: 1,
    }) });
    try {
        hook.render();
        assert.equal(pendingRecoveryRef.current, initial);
        assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), true);
        assert.deepEqual(h.released, []);
        hook.unmount();
        // A second document can still obtain the persisted copy after a failed first restore.
        assert.equal(h.values.get('jira_dashboard_connection_recovery_v1'), 'synthetic recovery backup');
    } finally { hook.unmount(); h.close(); }
});

for (const order of [['scenario', 'planning'], ['planning', 'scenario']]) {
    test(`reconnect clears the shared capsule only after ${order.join(' then ')}`, async () => {
        const { completeConnectionRecoveryOwner } = await import('../frontend/src/scenario/connectionScenarioRecovery.js');
        const h = browserStorage(), pendingRecoveryRef = { current: recovery() };
        try {
            const options = { pendingRecoveryRef, releaseOwnership: status => h.released.push(status) };
            assert.equal(completeConnectionRecoveryOwner({ ...options, owner: order[0] }), false);
            assert.ok(pendingRecoveryRef.current);
            assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), true);
            assert.equal(completeConnectionRecoveryOwner({ ...options, owner: order[1] }), true);
            assert.equal(pendingRecoveryRef.current, null);
            assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), false);
            assert.deepEqual(h.released, ['idle']);
            completeConnectionRecoveryOwner({ ...options, owner: order[1] });
            assert.deepEqual(h.released, ['idle']);
        } finally { h.close(); }
    });
}

test('background bootstrap preserves owner progress and the original valid backup until both restore', async () => {
    const storageApi = await import('../frontend/src/api/connectionRecoveryState.js');
    const { completeConnectionRecoveryOwner, isConnectionRecoveryOwnerComplete } = await import('../frontend/src/scenario/connectionScenarioRecovery.js');
    const h = browserStorage(), snapshot = validSnapshot();
    assert.equal(storageApi.writeConnectionRecoveryState(h.storage, snapshot), true);
    const originalBytes = h.values.get(storageApi.CONNECTION_RECOVERY_STORAGE_KEY);
    const hook = mountBundledHook({ entry: path.resolve('frontend/src/api/useConnectionRecovery.js'), exportName: 'useConnectionRecovery',
        makeProps: () => ({ backendUrl: '', principalRef: { current: snapshot.principal }, snapshotRef: { current: null }, setServerConnectionError() {} }) });
    try {
        hook.render();
        const first = hook.result.consume(snapshot.principal);
        hook.render();
        const pendingRecoveryRef = hook.result.pendingRef;
        assert.equal(completeConnectionRecoveryOwner({ pendingRecoveryRef, owner: 'planning', releaseOwnership() {}, recovery: first }), false);
        assert.equal(h.values.get(storageApi.CONNECTION_RECOVERY_STORAGE_KEY), originalBytes);
        const again = hook.result.consume(snapshot.principal);
        assert.equal(again, first);
        assert.equal(isConnectionRecoveryOwnerComplete(again, 'planning'), true);
        // A new document still sees both original app-owned drafts if the remaining owner failed.
        const nextDocumentCopy = storageApi.readConnectionRecoveryState(h.storage, snapshot.principal);
        assert.ok(nextDocumentCopy.scenario);
        assert.equal(nextDocumentCopy.planning.draft.inclusionChanges[0].included, true);
        assert.equal(h.values.get(storageApi.CONNECTION_RECOVERY_STORAGE_KEY), originalBytes);
        Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('Synthetic denial'); } });
        assert.equal(hook.result.consume(snapshot.principal), first, 'storage failure does not erase the validated mounted copy');
        Object.defineProperty(window, 'sessionStorage', { configurable: true, value: h.storage });
        assert.equal(completeConnectionRecoveryOwner({ pendingRecoveryRef, owner: 'scenario', releaseOwnership: status => h.released.push(status), recovery: first }), true);
        assert.equal(h.values.has(storageApi.CONNECTION_RECOVERY_STORAGE_KEY), false);
        assert.deepEqual(h.released, ['idle']);
    } finally { hook.unmount(); h.close(); }
});

test('an earlier asynchronous owner cannot complete a replacement recovery copy', async () => {
    const { completeConnectionRecoveryOwner, isConnectionRecoveryOwnerComplete } = await import('../frontend/src/scenario/connectionScenarioRecovery.js');
    const h = browserStorage(), original = recovery(), replacement = recovery(), pendingRecoveryRef = { current: replacement };
    try {
        assert.equal(completeConnectionRecoveryOwner({ pendingRecoveryRef, owner: 'scenario', recovery: original, releaseOwnership: status => h.released.push(status) }), false);
        assert.equal(pendingRecoveryRef.current, replacement);
        assert.equal(isConnectionRecoveryOwnerComplete(replacement, 'scenario'), false);
        assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), true);
        assert.deepEqual(h.released, []);
    } finally { h.close(); }
});

test('a Scenario owner already restored once is not reapplied while Planning remains pending', async () => {
    const runtime = createRuntime();
    const code = require('esbuild').buildSync({ entryPoints: [path.resolve('frontend/src/scenario/connectionScenarioRecovery.js')],
        bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, () => runtime.react);
    const h = browserStorage(), pendingRecoveryRef = { current: recovery() };
    let runs = 0, failures = 0;
    const props = { activeGroupId: 'g', selectedSprint: '17', availableSprints: [{ id: '17' }], visibleControlGroups: [{ id: 'g' }],
        groupsLoading: false, sprintsLoading: false, pendingRecoveryRef, pendingShellRef: { current: null },
        runScenario: async ({ recovery: current }) => { runs++; module.exports.completeConnectionRecoveryOwner({ pendingRecoveryRef, owner: 'scenario', recovery: current, releaseOwnership() {} }); },
        releaseOwnership() {}, scenarioScopeKey: 'scenario-scope', scenarioStartedRef: { current: false },
        setNotice: notice => { if (notice.kind === 'failed') failures++; }, setStatus() {}, showScenario: true, stagedRevision: 1 };
    const render = overrides => { runtime.begin(); module.exports.useConnectionScenarioRecovery({ ...props, ...overrides }); runtime.commit(); };
    try {
        render(); await Promise.resolve();
        assert.equal(runs, 1);
        assert.equal(failures, 0);
        render({ stagedRevision: 2 }); await Promise.resolve();
        assert.equal(runs, 1, 'explicit retry for the remaining owner must not overwrite later Scenario edits');
        assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), true);
    } finally { runtime.unmount(); h.close(); }
});
