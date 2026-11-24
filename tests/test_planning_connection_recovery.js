const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

function mountRecovery({
    storageWorks = true, identityChanged = false, captureThrows = false,
    probeError, probeWait, authLocked = false, values = new Map(), visibility = 'visible', pendingWrite = false,
    outageError = new Error('synthetic outage'), principalMounted = true, attemptStorageWorks = true, scenario = null,
    dirtySettings = false, dirtyPlanning = true, planningIssueId = '8101', scenarioRecoveryOwners,
} = {}) {
    const oldWindow = global.window, oldDocument = global.document;
    const principal = { workspaceId: 'workspace-1', viewConfigId: 'view-1' };
    const messages = [], waitCalls = [];
    const capsuleKey = 'jira_dashboard_connection_recovery_v1';
    let reloads = 0, probes = 0, captures = 0, capsuleMutations = 0, finishPendingWrite;
    const win = new EventTarget();
    win.sessionStorage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => {
            if (key === capsuleKey) capsuleMutations++;
            if (!storageWorks || (!attemptStorageWorks && key === 'jira_dashboard_connection_recovery_attempt_v1')) throw new Error('quota');
            values.set(key, value);
        },
        removeItem: key => { if (key === capsuleKey) capsuleMutations++; values.delete(key); },
    };
    win.setTimeout = setTimeout; win.clearTimeout = clearTimeout; win.location = { reload: () => reloads++ };
    global.window = win; global.document = new EventTarget(); document.visibilityState = visibility;
    const snapshot = {
        principal, outage: { id: '' }, view: { selectedView: 'eng', activeGroupId: 'group-1', selectedSprint: '101', engMode: 'statistics', scrollX: 0, scrollY: 0 }, droppedSettings: dirtySettings, scenario,
        planning: dirtyPlanning ? { scope: { workspaceId: 'workspace-1', groupId: 'group-1', sprintId: '101', namespaceId: null }, selectedTeams: [], submission: null,
            draft: { inclusionChanges: [{ issueId: planningIssueId, included: true, baseRevision: 0 }], initializePlan: true, basePlanRevision: 0, baseScopeProof: 'synthetic-proof', baseSchemaRevision: 0, baseViewRevision: 0, schemaChanges: [], cellChanges: [] } } : null,
    };
    const owner = mountBundledHook({ entry: path.resolve('frontend/src/api/useConnectionRecovery.js'), exportName: 'useConnectionRecovery', modules: {
        ...(scenarioRecoveryOwners && { '../scenario/connectionScenarioRecovery.js': scenarioRecoveryOwners }),
        './configApi.js': { fetchAppConfig: async (_url, { signal }) => {
            probes++;
            if (probeWait) await probeWait;
            signal.throwIfAborted();
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
        get capsuleMutations() { return capsuleMutations; },
        allowStorage() { storageWorks = true; },
        finishPendingWrite() { finishPendingWrite(); },
        lockAuthentication() { authLocked = true; },
        close() { owner.unmount(); global.window = oldWindow; global.document = oldDocument; },
    };
}

const perimeterError = { name: 'PerimeterSessionExpiredError' };
const unreachableProbeError = new TypeError('NetworkError when attempting to fetch resource.');

function mockNavigator(onLine) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    if (onLine === undefined) {
        Reflect.deleteProperty(globalThis, 'navigator');
    } else {
        Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });
    }
    return () => {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else Reflect.deleteProperty(globalThis, 'navigator');
    };
}

test('a manual probe that cannot connect offers a reload', async () => {
    const h = mountRecovery({ probeError: unreachableProbeError });
    const restoreNavigator = mockNavigator(true);
    try {
        await h.owner.result.recover({ manual: true });
        const result = h.owner.render();
        assert.equal(result.status, 'reload_offered');
        assert.equal(result.blocksManualRefresh, true);
        assert.equal(h.reloads, 0);
        assert.equal(result.notice.message, 'The server is still unreachable. Retry when it is available.');

        await result.recover({ manual: true });
        assert.equal(h.probes, 1);
        assert.equal(h.reloads, 1);
        const stored = JSON.parse(h.values.get('jira_dashboard_connection_recovery_v1'));
        assert.equal(stored.planning.draft.inclusionChanges[0].issueId, '8101');
    } finally { restoreNavigator(); h.close(); }
});

test('reload_offered survives a later connection report', async () => {
    const h = mountRecovery({ probeError: unreachableProbeError });
    const restoreNavigator = mockNavigator(true);
    try {
        await h.owner.result.recover({ manual: true });
        h.owner.result.reportServerConnectionError(new Error('Failed to fetch'));
        assert.equal(h.owner.render().status, 'reload_offered');
    } finally { restoreNavigator(); h.close(); }
});

test('an offline browser is not offered a reload', async () => {
    const h = mountRecovery({ probeError: unreachableProbeError });
    const restoreNavigator = mockNavigator(false);
    try {
        await h.owner.result.recover({ manual: true });
        assert.equal(h.owner.render().status, 'unavailable');
    } finally { restoreNavigator(); h.close(); }
});

test('no navigator means online', async () => {
    const h = mountRecovery({ probeError: unreachableProbeError });
    const restoreNavigator = mockNavigator(undefined);
    try {
        assert.equal('navigator' in globalThis, false);
        await h.owner.result.recover({ manual: true });
        assert.equal(h.owner.render().status, 'reload_offered');
    } finally { restoreNavigator(); h.close(); }
});

test('a probe timeout keeps its notice and offers no reload', async () => {
    const h = mountRecovery();
    const restoreNavigator = mockNavigator(true);
    window.setTimeout = (abort, timeout) => {
        assert.equal(timeout, 10_000);
        abort();
    };
    try {
        await h.owner.result.recover({ manual: true });
        const result = h.owner.render();
        assert.equal(result.status, 'unavailable');
        assert.equal(result.notice.message, 'The server did not answer within 10 seconds. Retry when it is available.');
    } finally { restoreNavigator(); h.close(); }
});

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

for (const eventType of ['focus', 'visibilitychange']) {
    test(`reload_offered survives a ${eventType} event without another probe`, async () => {
        const h = mountRecovery({ probeError: unreachableProbeError, visibility: 'hidden' });
        const restoreNavigator = mockNavigator(true);
        try {
            await h.owner.result.recover({ manual: true });
            assert.equal(h.owner.render().status, 'reload_offered');
            document.visibilityState = 'visible';
            const target = eventType === 'focus' ? window : document;
            target.dispatchEvent(new Event(eventType));
            await flushRecovery();
            assert.equal(h.probes, 1);
            assert.equal(h.reloads, 0);
            assert.equal(h.owner.render().status, 'reload_offered');
        } finally { restoreNavigator(); h.close(); }
    });
}

test('an offered reload before config mounts keeps the unconsumed capsule for later validation', async () => {
    const values = new Map();
    const capsuleKey = 'jira_dashboard_connection_recovery_v1';
    const first = mountRecovery({ values });
    let originalCapsule;
    try {
        await first.owner.result.recover({ manual: true });
        assert.equal(first.reloads, 1);
        originalCapsule = values.get(capsuleKey);
        assert.ok(originalCapsule);
    } finally { first.close(); }

    const second = mountRecovery({ probeError: unreachableProbeError, principalMounted: false, values });
    const restoreNavigator = mockNavigator(true);
    try {
        await second.owner.result.recover({ manual: true });
        assert.equal(second.owner.render().status, 'reload_offered');
        await second.owner.result.recover({ manual: true });
        assert.equal(second.reloads, 1);
        assert.equal(values.get(capsuleKey), originalCapsule);
    } finally { restoreNavigator(); second.close(); }

    const third = mountRecovery({ outageError: null, values });
    try {
        const restored = third.owner.result.consume(third.principal);
        assert.equal(restored.planning.draft.inclusionChanges[0].issueId, '8101');
        assert.equal(third.owner.result.consume({ ...third.principal, viewConfigId: 'other' }), null);
    } finally { third.close(); }
});

test('Reload and discard after failed preservation reloads without probing again', async () => {
    const h = mountRecovery({ probeError: unreachableProbeError, storageWorks: false });
    const restoreNavigator = mockNavigator(true);
    try {
        await h.owner.result.recover({ manual: true });
        assert.equal(h.owner.render().status, 'reload_offered');
        await h.owner.result.recover({ manual: true });
        assert.equal(h.owner.render().notice.kind, 'preservation_failed');
        assert.equal(h.reloads, 0);

        h.allowStorage();
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.probes, 1);
        assert.equal(h.reloads, 1);
        assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), false);
    } finally { restoreNavigator(); h.close(); }
});

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

test('a perimeter outage found during restoration resumes once when restoration releases ownership', async () => {
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
        await flushRecovery();
        assert.equal(h.probes, 1);
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

const scenarioDraft = {
    groupId: 'group-1', sprintId: '101', scopeKey: 'scenario-scope', activeDraftId: null, baseDraftRevision: 0,
    savedOverrides: {}, localOverrides: {}, editMode: false, scrollTop: 0, scrollLeft: 0,
};
const stagedScenarioDraft = { ...scenarioDraft, localOverrides: { 'PLAN-1': { start: '2026-09-24', end: '2026-09-25' } } };

for (const [label, scenario, planningIssueId] of [
    ['missing', null],
    ['conflicting', { ...scenarioDraft, localOverrides: { 'PLAN-1': { start: '2026-09-26', end: '2026-09-27' } } }],
    ['identical', stagedScenarioDraft],
    ['missing with newer Planning work', null, '8102'],
]) {
    test(`an uninstalled Scenario draft survives a mounted capture that is ${label}`, async () => {
        const values = new Map();
        const capsuleKey = 'jira_dashboard_connection_recovery_v1';
        const first = mountRecovery({ probeError: perimeterError, scenario: stagedScenarioDraft, values });
        try {
            await dispatchPerimeterExpiry();
            assert.equal(first.reloads, 1);
        } finally { first.close(); }

        const second = mountRecovery({ outageError: null, probeError: perimeterError, scenario, planningIssueId, values });
        try {
            const { consume, markBootstrapHealthy, recover } = second.owner.result;
            const pending = consume(second.principal);
            assert.deepEqual(pending.scenario.localOverrides, stagedScenarioDraft.localOverrides);
            for (const part of ['config', 'groups', 'sprints']) markBootstrapHealthy(part);
            const beforeOutage = new Map(values);
            assert.equal(beforeOutage.size, 1);
            await dispatchPerimeterExpiry();
            if (label === 'missing' || label === 'identical') {
                assert.equal(second.reloads, 1);
                assert.equal(second.capsuleMutations, 0);
                assert.equal(values.get(capsuleKey), beforeOutage.get(capsuleKey));
                return;
            }
            const result = second.owner.render();
            assert.equal(second.reloads, 0);
            assert.equal(second.capsuleMutations, 0);
            assert.deepEqual(values, beforeOutage);
            assert.equal(result.pendingRef.current, pending);
            assert.equal(result.notice.kind, 'preservation_failed');
            assert.match(result.notice.message, /staged Scenario draft is still in this tab/);
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            await flushRecovery();
            assert.equal(second.probes, 1);

            await recover({ manual: true, discardUnsaved: true });
            assert.equal(second.reloads, 1);
            assert.deepEqual(JSON.parse(values.get(capsuleKey)).scenario?.localOverrides ?? null, scenario?.localOverrides ?? null);
        } finally { second.close(); }
    });
}

test('a newer perimeter outage resumes after Scenario finishes ahead of Planning', async () => {
    const scenarioRecoveryOwners = await import('../frontend/src/scenario/connectionScenarioRecovery.js');
    const values = new Map();
    const capsuleKey = 'jira_dashboard_connection_recovery_v1';
    const first = mountRecovery({ probeError: perimeterError, scenario: scenarioDraft, values });
    try {
        await dispatchPerimeterExpiry();
        assert.equal(first.reloads, 1);
    } finally { first.close(); }
    const originalCapsule = values.get(capsuleKey);
    const second = mountRecovery({ outageError: null, probeError: perimeterError, scenarioRecoveryOwners, values });
    try {
        const { consume, markBootstrapHealthy, pendingRef, releaseOwnership, scenarioStartedRef, setStatus } = second.owner.result;
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
        assert.equal(scenarioRecoveryOwners.completeConnectionRecoveryOwner({
            pendingRecoveryRef: pendingRef, owner: 'scenario', releaseOwnership, recovery: pending,
        }), false);
        scenarioStartedRef.current = false;
        const result = second.owner.render();
        assert.equal(result.status, 'unavailable');
        assert.equal(result.unavailableRef.current, true);
        assert.equal(result.pendingRef.current, pending);
        assert.equal(values.get(capsuleKey), originalCapsule);
        assert.equal(second.probes, 0);
        await flushRecovery();
        assert.equal(second.probes, 1);
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

test('automatic recovery waits for explicit action when dirty Settings cannot be preserved', async () => {
    const h = mountRecovery({ outageError: null, probeError: perimeterError, storageWorks: false, dirtySettings: true, dirtyPlanning: false });
    try {
        await dispatchPerimeterExpiry();
        let result = h.owner.render();
        assert.equal(result.status, 'discard_required');
        const notice = result.notice;
        assert.equal(notice.kind, 'discard_required');
        assert.equal(h.probes, 1);

        for (let i = 0; i < 2; i++) {
            await dispatchPerimeterExpiry();
            assert.equal(h.owner.render().status, 'discard_required');
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            await flushRecovery();
        }
        result = h.owner.render();
        assert.equal(h.probes, 1);
        assert.equal(h.reloads, 0);
        assert.equal(result.status, 'discard_required');
        assert.equal(result.notice, notice);

        await result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.probes, 2);
        assert.equal(h.reloads, 1);
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

function loadRecoveryComponent(name) {
    const esbuild = require('esbuild');
    const code = esbuild.buildSync({ entryPoints: [path.resolve(`frontend/src/components/${name}.jsx`)], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, () => ({ createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }));
    return module.exports.default;
}

test('a blocked perimeter recovery gives no assurance that work was preserved', () => {
    const renderBanner = loadRecoveryComponent('ServerUnavailableBanner');
    for (const status of ['discard_required', 'unavailable']) {
        const banner = renderBanner({ perimeterExpired: true, status, message: 'Reloading to sign in again; unsaved changes are kept.' });
        const [detail] = banner.props.children[0].props.children.filter(node => node?.type === 'p');
        assert.equal(detail.props.children.join(''), 'Your sign-in session expired. Reload the page to sign in again.');
    }
});

test('preservation failure exposes an explicit Reload and discard action', () => {
    const renderNotice = loadRecoveryComponent('ConnectionRecoveryNotice');
    let discards = 0;
    const tree = renderNotice({ notice: { kind: 'preservation_failed', message: 'Could not preserve work.' }, onReloadDiscard: () => discards++ });
    const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(nodes)];
    const action = nodes(tree).find(node => node.type === 'button' && node.props.children.join('') === 'Reload and discard');
    assert.ok(action);
    assert.equal(discards, 0);
    action.props.onClick();
    assert.equal(discards, 1);
});
