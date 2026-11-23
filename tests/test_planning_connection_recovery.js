const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

function mountRecovery({
    storageWorks = true, identityChanged = false, captureThrows = false,
    probeError, probeWait, authLocked = false, values = new Map(), visibility = 'visible', pendingWrite = false,
    outageError = new Error('synthetic outage'), principalMounted = true, attemptStorageWorks = true, scenario = null,
} = {}) {
    const oldWindow = global.window, oldDocument = global.document;
    const principal = { workspaceId: 'workspace-1', viewConfigId: 'view-1' };
    const messages = [], waitCalls = [];
    let reloads = 0, probes = 0, captures = 0, finishPendingWrite;
    const win = new EventTarget();
    win.sessionStorage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => {
            if (!storageWorks || (!attemptStorageWorks && key === 'jira_dashboard_connection_recovery_attempt_v1')) throw new Error('quota');
            values.set(key, value);
        },
        removeItem: key => values.delete(key),
    };
    win.setTimeout = setTimeout; win.clearTimeout = clearTimeout; win.location = { reload: () => reloads++ };
    global.window = win; global.document = new EventTarget(); document.visibilityState = visibility;
    const snapshot = {
        principal, outage: { id: '' }, view: { selectedView: 'eng', activeGroupId: 'group-1', selectedSprint: '101', engMode: 'statistics', scrollX: 0, scrollY: 0 }, droppedSettings: false, scenario,
        planning: { scope: { workspaceId: 'workspace-1', groupId: 'group-1', sprintId: '101', namespaceId: null }, selectedTeams: [], submission: null,
            draft: { inclusionChanges: [{ issueId: '8101', included: true, baseRevision: 0 }], initializePlan: true, basePlanRevision: 0, baseScopeProof: 'synthetic-proof', baseSchemaRevision: 0, baseViewRevision: 0, schemaChanges: [], cellChanges: [] } },
    };
    const owner = mountBundledHook({ entry: path.resolve('frontend/src/api/useConnectionRecovery.js'), exportName: 'useConnectionRecovery', modules: {
        './configApi.js': { fetchAppConfig: async () => {
            probes++;
            if (probeWait) await probeWait;
            if (probeError) throw probeError;
            return { viewConfig: identityChanged ? { ...principal, workspaceId: 'other' } : principal };
        } },
        './authRequired.js': { isAuthenticationRequiredError: () => false, readPendingAuthenticationRequired: () => authLocked ? { locked: true } : null },
        './http.js': {
            PerimeterSessionExpiredError: class PerimeterSessionExpiredError extends Error {
                name = 'PerimeterSessionExpiredError';
            },
            isPerimeterSessionExpiredError: error => error?.name === 'PerimeterSessionExpiredError',
            hasPendingMutations: () => pendingWrite && waitCalls.length === 0,
            waitForPendingMutations: timeout => new Promise(resolve => {
                waitCalls.push(timeout);
                finishPendingWrite = resolve;
            }),
        },
        '../dashboardRuntime.js': { getServerConnectionErrorMessage: () => 'unavailable', isBackendConnectionFailure: () => true },
    }, makeProps: () => ({ backendUrl: '', principalRef: { current: principalMounted ? principal : null }, snapshotRef: { current: () => { captures++; if (captureThrows) throw new Error('must not be exposed'); return snapshot; } }, setServerConnectionError: message => messages.push(message) }) });
    owner.render();
    if (outageError) owner.result.reportServerConnectionError(outageError);
    owner.render();
    return {
        owner, principal, values, messages, waitCalls,
        get reloads() { return reloads; }, get probes() { return probes; }, get captures() { return captures; },
        finishPendingWrite() { finishPendingWrite(); },
        lockAuthentication() { authLocked = true; },
        close() { owner.unmount(); global.window = oldWindow; global.document = oldDocument; },
    };
}

const perimeterError = { name: 'PerimeterSessionExpiredError' };

async function dispatchPerimeterExpiry() {
    await publishPerimeterExpiry();
    await flushRecovery();
}

async function publishPerimeterExpiry(beforeRecovery = () => {}) {
    const { PERIMETER_SESSION_EXPIRED_EVENT } = await import('../frontend/src/api/authRefreshContract.js');
    window.dispatchEvent(new Event(PERIMETER_SESSION_EXPIRED_EVENT));
    beforeRecovery();
}

const flushRecovery = () => new Promise(resolve => setImmediate(resolve));

test('perimeter expiry reloads although the probe is redirected and keeps the Planning capsule', async () => {
    const h = mountRecovery({ outageError: perimeterError, probeError: perimeterError });
    try {
        await h.owner.result.recover({ manual: false });
        assert.equal(h.reloads, 1);
        const stored = JSON.parse(h.values.get('jira_dashboard_connection_recovery_v1'));
        assert.equal(stored.planning.draft.inclusionChanges[0].issueId, '8101');
        assert.equal(h.messages.at(-1), 'Your sign-in session expired. Reloading to sign in again; unsaved changes are kept.');
    } finally { h.close(); }
});

test('a perimeter event on a visible page starts recovery without any call', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

test('a perimeter event on a hidden page waits for the visible return', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError, visibility: 'hidden' });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(h.reloads, 0);
        document.visibilityState = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        await flushRecovery();
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

for (const [probeResult, probeError] of [['redirects again', perimeterError], ['succeeds after sign-in', undefined]]) {
    test(`manual recovery preserves an unconsumed capsule when the probe ${probeResult}`, async () => {
        const values = new Map();
        const capsuleKey = 'jira_dashboard_connection_recovery_v1';
        const first = mountRecovery({ probeError: perimeterError, values });
        let originalCapsule;
        try {
            await dispatchPerimeterExpiry();
            assert.equal(first.reloads, 1);
            originalCapsule = values.get(capsuleKey);
            assert.ok(originalCapsule);
        } finally { first.close(); }
        const second = mountRecovery({ outageError: null, probeError, values, principalMounted: false });
        try {
            await dispatchPerimeterExpiry();
            second.owner.render();
            assert.equal(second.owner.result.status, 'manual_required');
            assert.equal(second.reloads, 0);
            assert.equal(second.owner.result.perimeterExpired, true);
            await second.owner.result.recover({ manual: true });
            assert.equal(second.reloads, 1);
            assert.equal(values.get(capsuleKey), originalCapsule);
        } finally { second.close(); }
        const third = mountRecovery({ outageError: null, values });
        try {
            const restored = third.owner.result.consume(third.principal);
            assert.equal(restored.planning.draft.inclusionChanges[0].issueId, '8101');
        } finally { third.close(); }
    });
}

test('a pending authentication lock wins over perimeter reload', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError, authLocked: true });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(h.reloads, 0);
    } finally { h.close(); }
});

test('a perimeter expiry waits for a pending write before reloading', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError, pendingWrite: true });
    try {
        await dispatchPerimeterExpiry();
        h.owner.render();
        assert.equal(h.owner.result.status, 'waiting_for_save');
        assert.deepEqual(h.waitCalls, [10_000]);
        assert.equal(h.reloads, 0);
        await dispatchPerimeterExpiry();
        assert.equal(h.owner.render().status, 'waiting_for_save');
        assert.equal(h.probes, 1);
        h.finishPendingWrite();
        await flushRecovery();
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

test('an authentication lock arriving during a pending write stops the perimeter reload', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError, pendingWrite: true });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(h.owner.render().status, 'waiting_for_save');
        h.lockAuthentication();
        h.finishPendingWrite();
        await flushRecovery();
        assert.equal(h.reloads, 0);
        assert.equal(h.values.size, 0);
    } finally { h.close(); }
});

test('queued perimeter recovery gives way to a newly started restoration', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError });
    try {
        await publishPerimeterExpiry(() => h.owner.result.setStatus('restoring'));
        await flushRecovery();
        assert.equal(h.owner.render().status, 'restoring');
        assert.equal(h.probes, 0);
        assert.equal(h.reloads, 0);
    } finally { h.close(); }
});

test('a perimeter outage found during restoration becomes retryable when restoration releases ownership', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError });
    try {
        h.owner.result.setStatus('restoring');
        await dispatchPerimeterExpiry();
        assert.equal(h.owner.render().status, 'restoring');
        assert.equal(h.probes, 0);
        assert.equal(h.reloads, 0);
        let availableEvents = 0;
        const { CONNECTION_AVAILABLE_EVENT } = await import('../frontend/src/api/authRefreshContract.js');
        window.addEventListener(CONNECTION_AVAILABLE_EVENT, () => availableEvents++);
        h.owner.result.releaseOwnership('idle');
        const result = h.owner.render();
        assert.equal(result.status, 'unavailable');
        assert.equal(result.unavailableRef.current, true);
        assert.equal(result.perimeterExpired, true);
        assert.equal(availableEvents, 0);
    } finally { h.close(); }
});

const scenarioDraft = {
    groupId: 'group-1', sprintId: '101', scopeKey: 'scenario-scope', activeDraftId: null, baseDraftRevision: 0,
    savedOverrides: {}, localOverrides: {}, editMode: false, scrollTop: 0, scrollLeft: 0,
};

test('a newer perimeter outage remains retryable after Scenario finishes ahead of Planning', async () => {
    const values = new Map();
    const capsuleKey = 'jira_dashboard_connection_recovery_v1';
    const first = mountRecovery({ probeError: perimeterError, scenario: scenarioDraft, values });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(first.reloads, 1);
    } finally { first.close(); }
    const originalCapsule = values.get(capsuleKey);
    const second = mountRecovery({ outageError: null, probeError: perimeterError, scenario: scenarioDraft, values });
    try {
        const { consume, markBootstrapHealthy, scenarioStartedRef, setStatus, recover } = second.owner.result;
        const pending = consume(second.principal);
        assert.ok(pending.scenario && pending.planning);
        for (const part of ['config', 'groups', 'sprints']) markBootstrapHealthy(part);
        scenarioStartedRef.current = true;
        setStatus('restoring');
        await dispatchPerimeterExpiry();
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await flushRecovery();
        assert.equal(second.owner.render().status, 'restoring');
        assert.equal(second.probes, 0);
        assert.equal(second.reloads, 0);
        assert.equal(values.get(capsuleKey), originalCapsule);

        // Scenario settles without releasing the shared capsule while Planning still owns it.
        scenarioStartedRef.current = false;
        const result = second.owner.render();
        assert.equal(result.status, 'unavailable');
        assert.equal(result.unavailableRef.current, true);
        assert.equal(result.pendingRef.current, pending);
        assert.equal(values.get(capsuleKey), originalCapsule);
        assert.equal(second.probes, 0);
        await recover({ manual: true });
        assert.equal(second.reloads, 1);
    } finally { second.close(); }
});

test('a perimeter probe yields to Scenario restoration that starts while the probe is pending', async () => {
    const values = new Map();
    const capsuleKey = 'jira_dashboard_connection_recovery_v1';
    const first = mountRecovery({ probeError: perimeterError, scenario: scenarioDraft, values });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(first.reloads, 1);
    } finally { first.close(); }
    const originalCapsule = values.get(capsuleKey);

    let finishProbe, finishScenario;
    const probeWait = new Promise(resolve => { finishProbe = resolve; });
    const scenarioWait = new Promise(resolve => { finishScenario = resolve; });
    const second = mountRecovery({ outageError: null, probeError: perimeterError, probeWait, values });
    const recovery = second.owner.result;
    const scenario = mountBundledHook({
        entry: path.resolve('frontend/src/scenario/connectionScenarioRecovery.js'),
        exportName: 'useConnectionScenarioRecovery',
        makeProps: () => ({
            activeGroupId: 'group-1', availableSprints: [{ id: '101' }], groupsLoading: false,
            pendingRecoveryRef: recovery.pendingRef, pendingShellRef: { current: null },
            runScenario: () => scenarioWait, releaseOwnership: recovery.releaseOwnership,
            scenarioScopeKey: 'scenario-scope', scenarioStartedRef: recovery.scenarioStartedRef,
            selectedSprint: '101', setNotice: recovery.setNotice, setStatus: recovery.setStatus,
            showScenario: true, sprintsLoading: false, stagedRevision: 1, visibleControlGroups: [{ id: 'group-1' }],
        }),
    });
    try {
        assert.ok(recovery.consume(second.principal)?.scenario);
        for (const part of ['config', 'groups', 'sprints']) recovery.markBootstrapHealthy(part);
        await dispatchPerimeterExpiry();
        assert.equal(second.probes, 1);
        assert.equal(second.owner.render().status, 'checking');
        scenario.render();
        assert.equal(recovery.scenarioStartedRef.current, true);
        finishProbe();
        await flushRecovery();
        assert.equal(second.captures, 0);
        assert.equal(values.get(capsuleKey), originalCapsule);
        assert.equal(second.reloads, 0);
    } finally {
        finishProbe();
        finishScenario();
        await flushRecovery();
        scenario.unmount();
        second.close();
    }
});

test('the manual reload notice remains accurate if the perimeter status changes', async () => {
    const h = mountRecovery({ outageError: null, attemptStorageWorks: false });
    try {
        await dispatchPerimeterExpiry();
        const result = h.owner.render();
        assert.equal(result.status, 'manual_required');
        assert.equal(result.perimeterExpired, true);
        assert.equal(result.notice.message, 'Automatic recovery could not create a reload-loop guard. Use the button to reload explicitly.');
        assert.equal(h.reloads, 0);
        result.reportServerConnectionError(new Error('Failed to fetch'));
        const ordinaryOutage = h.owner.render();
        assert.equal(ordinaryOutage.status, 'manual_required');
        assert.equal(ordinaryOutage.perimeterExpired, false);
        assert.equal(ordinaryOutage.notice.message, result.notice.message);
    } finally { h.close(); }
});

test('a perimeter expiry that cannot store dirty Planning keeps the page', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError, storageWorks: false });
    try {
        await dispatchPerimeterExpiry();
        h.owner.render();
        assert.equal(h.owner.result.notice?.kind, 'preservation_failed');
        assert.equal(h.reloads, 0);
        for (let i = 0; i < 3; i++) await dispatchPerimeterExpiry();
        assert.equal(h.probes, 1);
    } finally { h.close(); }
});

test('perimeterExpired resets on a later ordinary outage and when the outage ends', () => {
    const h = mountRecovery({ outageError: perimeterError });
    try {
        assert.equal(h.owner.result.perimeterExpired, true);
        for (const part of ['config', 'groups', 'sprints']) h.owner.result.markBootstrapHealthy(part);
        assert.equal(h.owner.render().perimeterExpired, false);

        h.owner.result.reportServerConnectionError(perimeterError);
        assert.equal(h.owner.render().perimeterExpired, true);
        h.owner.result.reportServerConnectionError(new Error('Failed to fetch'));
        assert.equal(h.owner.render().perimeterExpired, false);
    } finally { h.close(); }
});

test('outage reload retains dirty Planning even when Statistics is open', async () => {
    const h = mountRecovery();
    try {
        await h.owner.result.recover({ manual: true });
        assert.equal(h.reloads, 1);
        const stored = JSON.parse(h.values.get('jira_dashboard_connection_recovery_v1'));
        assert.equal(stored.view.engMode, 'statistics');
        assert.equal(stored.planning.draft.inclusionChanges[0].issueId, '8101');
    } finally { h.close(); }
});

test('failed Planning retention keeps the mounted page until explicit discard', async () => {
    const h = mountRecovery({ storageWorks: false });
    try {
        await h.owner.result.recover({ manual: true }); h.owner.render();
        assert.equal(h.reloads, 0);
        assert.equal(h.owner.result.notice.kind, 'preservation_failed');
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

test('a changed principal requires explicit discard of Planning', async () => {
    const h = mountRecovery({ identityChanged: true });
    try {
        await h.owner.result.recover({ manual: true }); h.owner.render();
        assert.equal(h.reloads, 0);
        assert.equal(h.owner.result.notice.kind, 'discard_required');
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.reloads, 1);
        assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), false);
    } finally { h.close(); }
});

test('an unavailable capture fails closed with sanitized feedback', async () => {
    const h = mountRecovery({ captureThrows: true });
    try {
        await h.owner.result.recover({ manual: true }); h.owner.render();
        assert.equal(h.reloads, 0);
        assert.equal(h.owner.result.notice.kind, 'preservation_failed');
        assert.doesNotMatch(h.owner.result.notice.message, /must not be exposed/);
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

test('preservation failure exposes an explicit Reload and discard action', () => {
    const esbuild = require('esbuild');
    const code = esbuild.buildSync({ entryPoints: [path.resolve('frontend/src/components/ConnectionRecoveryNotice.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, () => ({ createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }));
    let discards = 0;
    const tree = module.exports.default({ notice: { kind: 'preservation_failed', message: 'Could not preserve work.' }, onReloadDiscard: () => discards++ });
    const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(nodes)];
    const action = nodes(tree).find(node => node.type === 'button' && node.props.children.join('') === 'Reload and discard');
    assert.ok(action);
    assert.equal(discards, 0);
    action.props.onClick();
    assert.equal(discards, 1);
});
