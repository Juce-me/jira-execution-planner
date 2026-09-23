const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'api', 'connectionRecoveryState.js');

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const sandbox = { module: { exports: {} }, exports: {}, TextEncoder, console };
    vm.runInContext(source, vm.createContext(sandbox));
    return sandbox.module.exports;
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
}

function recoverySnapshot() {
    return {
        principal: { workspaceId: ' workspace-1 ', viewConfigId: ' view-1 ' },
        outage: { id: ' outage-1 ' },
        view: {
            selectedView: 'eng', activeGroupId: ' group-1 ', selectedSprint: ' sprint-1 ',
            engMode: 'scenario', scrollX: 12, scrollY: 34,
        },
        droppedSettings: true,
        scenario: {
            scopeKey: 'sprint-1:group-1', activeDraftId: 'draft-1', baseDraftRevision: 4,
            savedOverrides: { 'PLAN-1': { start: '2026-09-22', end: '2026-09-23' } },
            localOverrides: { 'PLAN-1': { start: '2026-09-24', end: '2026-09-25' } },
            editMode: true, scrollTop: 45, scrollLeft: 67,
        },
    };
}

test('a same-principal Scenario recovery capsule round-trips through one tab store', () => {
    const api = loadModule();
    const storage = createStorage();
    const snapshot = recoverySnapshot();
    assert.equal(api.writeConnectionRecoveryState(storage, snapshot, 1_000), true);
    assert.deepEqual(JSON.parse(JSON.stringify(api.readConnectionRecoveryState(storage, snapshot.principal, 1_001))), {
        ...snapshot,
        version: 1,
        capturedAt: 1_000,
        principal: { workspaceId: 'workspace-1', viewConfigId: 'view-1' },
        outage: { id: 'outage-1' },
        view: { ...snapshot.view, activeGroupId: 'group-1', selectedSprint: 'sprint-1' },
    });
});

test('supports a position-only capsule without Scenario work or Settings values', () => {
    const api = loadModule();
    const snapshot = recoverySnapshot();
    snapshot.scenario = null;
    snapshot.droppedSettings = false;
    const storage = createStorage();
    assert.equal(api.writeConnectionRecoveryState(storage, snapshot, 1_000), true);
    const restored = api.readConnectionRecoveryState(storage, snapshot.principal, 1_001);
    assert.equal(restored.scenario, null);
    assert.equal(restored.droppedSettings, false);
    assert.equal(Object.hasOwn(restored, 'settings'), false);
});

test('principal mismatch, expiry, future capture, and malformed JSON clear the capsule', () => {
    const api = loadModule();
    const encoded = capturedAt => JSON.stringify({ ...recoverySnapshot(), version: 1, capturedAt });
    const cases = [
        { raw: '{bad json', principal: recoverySnapshot().principal, now: 1_001 },
        { raw: encoded(1_000), principal: { workspaceId: 'other', viewConfigId: 'view-1' }, now: 1_001 },
        { raw: encoded(1_000), principal: recoverySnapshot().principal, now: 1_000 + (30 * 60 * 1000) + 1 },
        { raw: encoded(2_000), principal: recoverySnapshot().principal, now: 1_999 },
    ];
    for (const item of cases) {
        const storage = createStorage({ [api.CONNECTION_RECOVERY_STORAGE_KEY]: item.raw });
        assert.equal(api.readConnectionRecoveryState(storage, item.principal, item.now), null);
        assert.equal(storage.getItem(api.CONNECTION_RECOVERY_STORAGE_KEY), null);
    }
});

test('exact schemas reject Settings values, credentials, unknown keys, and noncanonical overrides', () => {
    const api = loadModule();
    const cases = [
        { ...recoverySnapshot(), settings: { groups: [] } },
        { ...recoverySnapshot(), email: 'person@example.test' },
        { ...recoverySnapshot(), apiToken: 'secret' },
        { ...recoverySnapshot(), response: { body: 'raw' } },
        { ...recoverySnapshot(), view: { ...recoverySnapshot().view, settingsTab: 'teams' } },
        { ...recoverySnapshot(), scenario: { ...recoverySnapshot().scenario, summary: 'private' } },
        { ...recoverySnapshot(), scenario: { ...recoverySnapshot().scenario, localOverrides: { 'PLAN-1': { start_date: '2026-09-22' } } } },
        { ...recoverySnapshot(), scenario: { ...recoverySnapshot().scenario, localOverrides: { invalid: { start: '2026-09-22', end: '' } } } },
    ];
    for (const snapshot of cases) {
        const storage = createStorage();
        assert.equal(api.writeConnectionRecoveryState(storage, snapshot, 1_000), false);
        assert.equal(storage.getItem(api.CONNECTION_RECOVERY_STORAGE_KEY), null);
    }
});

test('invalid clocks, positions, revisions, oversized data, and storage failures preserve prior data', () => {
    const api = loadModule();
    for (const now of [NaN, Infinity, -1, '1000']) {
        const storage = createStorage({ [api.CONNECTION_RECOVERY_STORAGE_KEY]: 'keep' });
        assert.equal(api.writeConnectionRecoveryState(storage, recoverySnapshot(), now), false);
        assert.equal(storage.getItem(api.CONNECTION_RECOVERY_STORAGE_KEY), 'keep');
    }
    for (const snapshot of [
        { ...recoverySnapshot(), view: { ...recoverySnapshot().view, scrollY: Infinity } },
        { ...recoverySnapshot(), scenario: { ...recoverySnapshot().scenario, baseDraftRevision: -1 } },
    ]) assert.equal(api.writeConnectionRecoveryState(createStorage(), snapshot, 1_000), false);

    const oversized = recoverySnapshot();
    oversized.scenario.activeDraftId = 'x'.repeat(api.CONNECTION_RECOVERY_MAX_BYTES);
    const storage = createStorage({ [api.CONNECTION_RECOVERY_STORAGE_KEY]: 'previous' });
    assert.equal(api.writeConnectionRecoveryState(storage, oversized, 1_000), false);
    assert.equal(storage.getItem(api.CONNECTION_RECOVERY_STORAGE_KEY), 'previous');

    const throwing = createStorage({ [api.CONNECTION_RECOVERY_STORAGE_KEY]: 'previous' });
    throwing.setItem = () => { throw new Error('quota'); };
    assert.equal(api.writeConnectionRecoveryState(throwing, recoverySnapshot(), 1_000), false);
    assert.equal(throwing.getItem(api.CONNECTION_RECOVERY_STORAGE_KEY), 'previous');
});

test('outage attempt marker survives documents and permits one automatic attempt per outage', () => {
    const api = loadModule();
    const storage = createStorage();
    assert.equal(api.markConnectionRecoveryAttempt(storage, 'outage-1', 1_000), true);
    assert.deepEqual(JSON.parse(JSON.stringify(api.readConnectionRecoveryAttempt(storage, 1_001))), {
        version: 1, outageId: 'outage-1', attemptedAt: 1_000,
    });
    assert.equal(api.canAutomaticallyRecoverConnection(storage, 'outage-1', 1_001), false);
    assert.equal(api.canAutomaticallyRecoverConnection(storage, 'outage-2', 1_001), true);
    api.clearConnectionRecoveryAttempt(storage);
    assert.equal(api.readConnectionRecoveryAttempt(storage, 1_001), null);
});

test('blocked sessionStorage and repeated clears are fail-soft', () => {
    const api = loadModule();
    const win = Object.defineProperty({}, 'sessionStorage', { get() { throw new Error('blocked'); } });
    assert.equal(api.getConnectionRecoveryStorage(win), null);
    assert.doesNotThrow(() => api.clearConnectionRecoveryState(null));
    assert.doesNotThrow(() => api.clearConnectionRecoveryAttempt(null));
    assert.equal(api.writeConnectionRecoveryState(null, recoverySnapshot(), 1_000), false);
    assert.equal(api.readConnectionRecoveryState(null, recoverySnapshot().principal, 1_000), null);
});
