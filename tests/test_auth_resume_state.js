const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'api', 'authResumeState.js');

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const sandbox = { module: { exports: {} }, exports: {}, TextEncoder, console };
    vm.runInContext(source, vm.createContext(sandbox));
    return sandbox.module.exports;
}

function createStorage(initial = null) {
    let value = initial;
    return {
        getItem: () => value,
        setItem: (_key, next) => { value = next; },
        removeItem: () => { value = null; },
    };
}

function planningSnapshot() {
    return {
        principal: { workspaceId: ' workspace-1 ', viewConfigId: ' view-1 ' },
        view: {
            selectedView: 'eng', activeGroupId: ' group-1 ', selectedSprint: ' sprint-1 ',
            engMode: 'planning', settingsOpen: true, settingsTab: 'scope',
        },
        planning: {
            scopeKey: ' project-1 ', selectedTaskKeys: ['TASK-2', ' TASK-1 ', 'TASK-2'],
            selectedTeams: ['team-1', ' team-2'], selectionMode: 'manual',
        },
    };
}

test('a matching Planning capsule round-trips through one tab store', () => {
    const { AUTH_RESUME_STORAGE_KEY, writeAuthResumeState, readAuthResumeState } = loadModule();
    const storage = createStorage();
    const snapshot = planningSnapshot();
    assert.equal(writeAuthResumeState(storage, snapshot, 1_000), true);
    assert.deepEqual(JSON.parse(JSON.stringify(readAuthResumeState(storage, snapshot.principal, 2_000))), {
        ...snapshot,
        version: 1,
        capturedAt: 1_000,
        principal: { workspaceId: 'workspace-1', viewConfigId: 'view-1' },
        view: { ...snapshot.view, activeGroupId: 'group-1', selectedSprint: 'sprint-1' },
        planning: { ...snapshot.planning, scopeKey: 'project-1', selectedTaskKeys: ['TASK-2', 'TASK-1'], selectedTeams: ['team-1', 'team-2'] },
    });
    assert.notEqual(storage.getItem(AUTH_RESUME_STORAGE_KEY), null);
});

test('identity mismatch clears without returning prior issue keys', () => {
    const { AUTH_RESUME_STORAGE_KEY, writeAuthResumeState, readAuthResumeState } = loadModule();
    const storage = createStorage();
    writeAuthResumeState(storage, planningSnapshot(), 1_000);
    assert.equal(readAuthResumeState(storage, { workspaceId: 'workspace-other', viewConfigId: 'view-other' }, 2_000), null);
    assert.equal(storage.getItem(AUTH_RESUME_STORAGE_KEY), null);
});

test('a matching capsule is not overwritten by a second capture', () => {
    const api = loadModule();
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, planningSnapshot(), 1_000), true);
    assert.equal(api.writeAuthResumeState(storage, { ...planningSnapshot(), view: { ...planningSnapshot().view, engMode: 'board' } }, 2_000), false);
    assert.equal(JSON.parse(storage.getItem(api.AUTH_RESUME_STORAGE_KEY)).capturedAt, 1_000);
});

test('invalid incoming captures do not clear or mutate an existing capsule', () => {
    const api = loadModule();
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, planningSnapshot(), 1_000), true);
    const before = storage.getItem(api.AUTH_RESUME_STORAGE_KEY);
    assert.equal(api.writeAuthResumeState(storage, { principal: {}, view: {}, planning: {} }, 2_000), false);
    assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), before);
    assert.equal(api.writeAuthResumeState(storage, { ...planningSnapshot(), principal: { workspaceId: 'other', viewConfigId: 'other' } }, 2_000), false);
    assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), before);
});

test('malformed, expired, oversized, and invalid capsules are rejected and cleared', () => {
    const api = loadModule();
    const principal = { workspaceId: 'w', viewConfigId: 'v' };
    const valid = {
        version: 1, capturedAt: 1_000, principal,
        view: { selectedView: 'eng', activeGroupId: '', selectedSprint: '', engMode: 'catch-up', settingsOpen: false, settingsTab: 'scope' },
        planning: { scopeKey: '', selectedTaskKeys: [], selectedTeams: [], selectionMode: 'manual' },
    };
    const cases = [
        '{bad json', JSON.stringify({ version: 2 }), JSON.stringify({ ...valid, capturedAt: -1 }),
        JSON.stringify({ ...valid, capturedAt: 2_000 }), JSON.stringify({ ...valid, capturedAt: 1 - (30 * 60 * 1000) }),
        JSON.stringify({ ...valid, principal: undefined }), JSON.stringify({ ...valid, view: { ...valid.view, selectedView: 'bad' } }),
        JSON.stringify({ ...valid, view: { ...valid.view, engMode: 'bad' } }), JSON.stringify({ ...valid, view: { ...valid.view, settingsTab: 'bad' } }),
        JSON.stringify({ ...valid, planning: { ...valid.planning, selectionMode: 'bad' } }),
        JSON.stringify({ ...valid, planning: { ...valid.planning, selectedTaskKeys: Array.from({ length: 501 }, (_, i) => `T-${i}`) } }),
        JSON.stringify({ ...valid, planning: { ...valid.planning, selectedTeams: Array.from({ length: 201 }, (_, i) => `team-${i}`) } }),
        'x'.repeat(64 * 1024 + 1),
    ];
    for (const raw of cases) {
        const storage = createStorage(raw);
        assert.equal(api.readAuthResumeState(storage, principal, 1_000), null);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
    const invalid = api.writeAuthResumeState(createStorage(), {
        principal: { workspaceId: 'w', viewConfigId: 'v' }, view: { selectedView: 'eng', engMode: 'bad' },
    }, 1_000);
    assert.equal(invalid, false);
    assert.equal(api.writeAuthResumeState(createStorage(), {
        principal: { workspaceId: 'w', viewConfigId: 'v' }, view: { selectedView: 'eng', engMode: 'catch-up', settingsOpen: false, settingsTab: 'scope' },
        planning: { ...planningSnapshot().planning, selectedTaskKeys: Array.from({ length: 501 }, (_, i) => `T-${i}`) },
    }, 1_000), false);
});

test('rejects malformed list shapes, invalid clocks, and UTF-8 payloads without mutation', () => {
    const api = loadModule();
    const base = planningSnapshot();
    for (const now of [NaN, Infinity, -1, '1000']) {
        const storage = createStorage();
        assert.equal(api.writeAuthResumeState(storage, base, now), false);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
    for (const planning of [
        { ...base.planning, selectedTaskKeys: 'TASK-1' },
        { ...base.planning, selectedTaskKeys: [1] },
        { ...base.planning, selectedTaskKeys: [null] },
        { ...base.planning, selectedTeams: 'team-1' },
        { ...base.planning, selectedTeams: [1] },
    ]) {
        const storage = createStorage();
        assert.equal(api.writeAuthResumeState(storage, { ...base, planning }, 1_000), false);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
    const storage = createStorage('keep');
    assert.equal(api.writeAuthResumeState(storage, {
        ...base, planning: { ...base.planning, selectedTaskKeys: Array.from({ length: 500 }, (_, i) => `${'é'.repeat(250)}-${i}`) },
    }, 1_000), false);
    assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), 'keep');
});

test('capsule serialization excludes credentials, PII, bodies, drafts, and OAuth state', () => {
    const api = loadModule();
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, {
        apiToken: 'secret', access_token: 'secret', refresh_token: 'secret', Authorization: 'secret',
        email: 'person@example.test', responseBody: 'body', configDraft: 'draft', oauthState: 'state',
        principal: { workspaceId: 'w', viewConfigId: 'v' }, view: { selectedView: 'eng', engMode: 'catch-up', settingsOpen: false, settingsTab: 'scope' },
        planning: { selectedTaskKeys: [], selectedTeams: [], selectionMode: 'manual' },
    }, 1_000), true);
    const raw = storage.getItem(api.AUTH_RESUME_STORAGE_KEY);
    for (const secret of ['apiToken', 'access_token', 'refresh_token', 'Authorization', 'person@example.test', 'body', 'draft', 'state']) {
        assert.equal(raw.includes(secret), false, secret);
    }
});

test('rejects sensitive markers even when placed in allowlisted fields', () => {
    const api = loadModule();
    const fields = [
        ['view', 'activeGroupId', 'person@example.test'], ['view', 'selectedSprint', 'Authorization: bearer secret'],
        ['planning', 'scopeKey', 'configDraft secret'], ['planning', 'selectedTaskKeys', ['responseBody']],
        ['planning', 'selectedTeams', ['oauth_pkce_state']], ['principal', 'workspaceId', 'access_token=secret'],
    ];
    for (const [section, key, value] of fields) {
        const snapshot = planningSnapshot();
        snapshot[section][key] = value;
        const storage = createStorage();
        assert.equal(api.writeAuthResumeState(storage, snapshot, 1_000), false, `${section}.${key}`);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
        const validStorage = createStorage();
        assert.equal(api.writeAuthResumeState(validStorage, planningSnapshot(), 1_000), true);
        const parsed = JSON.parse(validStorage.getItem(api.AUTH_RESUME_STORAGE_KEY));
        parsed[section][key] = value;
        validStorage.setItem(api.AUTH_RESUME_STORAGE_KEY, JSON.stringify(parsed));
        assert.equal(api.readAuthResumeState(validStorage, planningSnapshot().principal, 2_000), null, `${section}.${key} read`);
        assert.equal(validStorage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
});

test('rejects embedded emails but preserves opaque STATE identifiers', () => {
    const api = loadModule();
    const embedded = [
        ['planning', 'scopeKey', 'note person@example.test'],
        ['planning', 'selectedTaskKeys', ['note person@example.test']],
        ['planning', 'selectedTeams', ['note person@example.test']],
    ];
    for (const [section, key, value] of embedded) {
        const snapshot = planningSnapshot();
        snapshot[section][key] = value;
        assert.equal(api.writeAuthResumeState(createStorage(), snapshot, 1_000), false, `${section}.${key}`);
    }
    const snapshot = planningSnapshot();
    snapshot.view.activeGroupId = 'STATE-123';
    snapshot.planning.scopeKey = 'STATE-456';
    snapshot.planning.selectedTaskKeys = ['STATE-789'];
    snapshot.planning.selectedTeams = ['STATE-000'];
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, snapshot, 1_000), true);
    assert.equal(api.readAuthResumeState(storage, snapshot.principal, 2_000).view.activeGroupId, 'STATE-123');
});

test('blocked sessionStorage getter is fail-soft', () => {
    const api = loadModule();
    const win = Object.defineProperty({}, 'sessionStorage', { get() { throw new Error('blocked'); } });
    assert.equal(api.getAuthResumeStorage(win), null);
    assert.doesNotThrow(() => api.clearAuthResumeState(null));
    assert.equal(api.writeAuthResumeState(null, planningSnapshot(), 1_000), false);
    assert.equal(api.readAuthResumeState(null, planningSnapshot().principal, 1_000), null);
});
