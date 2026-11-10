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

function createThrowingWriteStorage(initial) {
    const storage = createStorage(initial);
    storage.setItem = () => { throw new Error('quota'); };
    return storage;
}

function planningSnapshot() {
    return {
        principal: { workspaceId: ' workspace-1 ', viewConfigId: ' view-1 ' },
        view: {
            selectedView: 'eng', activeGroupId: ' group-1 ', selectedSprint: ' sprint-1 ',
            engMode: 'planning', settingsOpen: true, settingsTab: 'scope',
        },
        planning: {
            scopeKey: ' planning::sprint-1::group-1 ', selectedTaskKeys: ['TASK-2', ' TASK-1 ', 'TASK-2'],
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
        planning: { ...snapshot.planning, scopeKey: '', selectedTaskKeys: [], selectedTeams: ['team-1', 'team-2'] },
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
    const replacement = { ...planningSnapshot(), principal: { workspaceId: 'other', viewConfigId: 'other' }, view: { ...planningSnapshot().view, activeGroupId: 'new-group' } };
    assert.equal(api.writeAuthResumeState(storage, replacement, 2_000), true);
    const stored = JSON.parse(storage.getItem(api.AUTH_RESUME_STORAGE_KEY));
    assert.deepEqual(stored.principal, replacement.principal);
    assert.equal(stored.capturedAt, 2_000);
    assert.equal(stored.view.activeGroupId, 'new-group');
    assert.equal(stored.planning.selectedTaskKeys.includes('TASK-2'), true);
    assert.notEqual(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), before);
});

test('malformed, expired, oversized, and invalid capsules are rejected and cleared', () => {
    const api = loadModule();
    const principal = { workspaceId: 'w', viewConfigId: 'v' };
    const valid = {
        version: 1, capturedAt: 1_000, principal,
        view: { selectedView: 'eng', activeGroupId: '', selectedSprint: '', engMode: 'catch-up', settingsOpen: false, settingsTab: 'scope' },
        planning: { scopeKey: 'planning::sprint-1::group-1', selectedTaskKeys: [], selectedTeams: [], selectionMode: 'manual' },
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

test('write serialization keeps only the exact recovery allowlist', () => {
    const api = loadModule();
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, {
        apiToken: 'secret', access_token: 'secret', refresh_token: 'secret', Authorization: 'secret',
        email: 'person@example.test', responseBody: 'body', configDraft: 'draft', oauthState: 'state',
        principal: { workspaceId: 'w', viewConfigId: 'v' }, view: { selectedView: 'eng', engMode: 'catch-up', settingsOpen: false, settingsTab: 'scope' },
        planning: { scopeKey: 'planning::sprint-1::group-1', selectedTaskKeys: [], selectedTeams: [], selectionMode: 'manual' },
    }, 1_000), true);
    const raw = storage.getItem(api.AUTH_RESUME_STORAGE_KEY);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['capturedAt', 'planning', 'principal', 'version', 'view']);
});

test('rejects structurally invalid values in allowlisted fields', () => {
    const api = loadModule();
    const fields = [
        ['view', 'activeGroupId', 'person@example.test'], ['view', 'selectedSprint', 'bad@id'],
        ['planning', 'scopeKey', 'planning::sprint-1::group=1'], ['planning', 'selectedTaskKeys', ['not an issue']],
        ['planning', 'selectedTeams', ['team@example.test']], ['principal', 'workspaceId', 'access_token=secret'],
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
    snapshot.planning.scopeKey = 'planning::STATE-456::STATE-000';
    snapshot.planning.selectedTaskKeys = ['STATE-789'];
    snapshot.planning.selectedTeams = ['STATE-000'];
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, snapshot, 1_000), true);
    assert.equal(api.readAuthResumeState(storage, snapshot.principal, 2_000).view.activeGroupId, 'STATE-123');
});

test('accepts canonical opaque identifiers and empty shell scope', () => {
    const api = loadModule();
    const valid = planningSnapshot();
    valid.principal = { workspaceId: '123e4567-e89b-12d3-a456-426614174000', viewConfigId: 'view/legacy:2' };
    valid.view.activeGroupId = 'group/legacy:1';
    valid.view.selectedSprint = 'sprint/legacy:2';
    valid.planning.scopeKey = '';
    valid.planning.selectedTeams = ['all', 'team/legacy:1'];
    assert.equal(api.writeAuthResumeState(createStorage(), valid, 1_000), true);
});

test('rejects prose and payload-shaped identifiers structurally', () => {
    const api = loadModule();
    const cases = [
        ['principal', 'workspaceId', 'Person Name'], ['view', 'activeGroupId', 'Authorization: bearer secret'],
        ['view', 'selectedSprint', 'response body secret'], ['planning', 'scopeKey', 'planning::config draft::oauth state'],
        ['planning', 'selectedTeams', ['person name']],
    ];
    for (const [section, key, value] of cases) {
        const snapshot = planningSnapshot();
        snapshot[section][key] = value;
        assert.equal(api.writeAuthResumeState(createStorage(), snapshot, 1_000), false, `${section}.${key}`);
    }
});

test('read rejects any extra top-level or nested capsule keys and clears', () => {
    const api = loadModule();
    const base = JSON.parse(JSON.stringify(planningSnapshot()));
    const cases = [
        { extra: 'rawBody' }, { principal: { access_token: 'secret' } },
        { view: { draft: 'PII' } }, { planning: { rawBody: 'response data' } },
    ];
    for (const extra of cases) {
        const value = { version: 1, capturedAt: 1_000, principal: base.principal, view: base.view, planning: base.planning, ...extra,
            principal: { ...base.principal, ...extra.principal }, view: { ...base.view, ...extra.view }, planning: { ...base.planning, ...extra.planning } };
        const storage = createStorage(JSON.stringify(value));
        assert.equal(api.readAuthResumeState(storage, base.principal, 2_000), null);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
});

test('accepts canonical opaque IDs and Jira keys without vocabulary blacklisting', () => {
    const api = loadModule();
    const snapshot = planningSnapshot();
    snapshot.view.activeGroupId = 'STATE-123';
    snapshot.view.selectedSprint = 'BEARER-123';
    snapshot.planning.scopeKey = 'planning::PKCE-123::AUTHORIZATION-123';
    snapshot.planning.selectedTaskKeys = ['PKCE-123', 'STATE-123'];
    assert.equal(api.writeAuthResumeState(createStorage(), snapshot, 1_000), true);
});

test('allows empty shell scope with canonical group, team, and principal identifiers', () => {
    const api = loadModule();
    const snapshot = planningSnapshot();
    snapshot.principal = { workspaceId: 'cloud/site:legacy', viewConfigId: 'view/legacy' };
    snapshot.view.activeGroupId = 'group/legacy:1';
    snapshot.view.selectedSprint = 'sprint/legacy:2';
    snapshot.planning.scopeKey = '';
    snapshot.planning.selectedTeams = ['all', 'team/legacy:1'];
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, snapshot, 1_000), true);
    assert.equal(api.readAuthResumeState(storage, snapshot.principal, 2_000).planning.scopeKey, '');
});

test('replacement is atomic when incoming payload is oversized or storage write fails', () => {
    const api = loadModule();
    const oldSnapshot = { ...planningSnapshot(), planning: { ...planningSnapshot().planning, selectedTaskKeys: ['OLD-1'] } };
    const oversized = { ...planningSnapshot(), principal: { workspaceId: 'third', viewConfigId: 'third' },
        planning: { ...planningSnapshot().planning, selectedTaskKeys: Array.from({ length: 500 }, (_, i) => `${'TASK'.repeat(60)}-${i}`) } };
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, oldSnapshot, 1_000), true);
    const before = storage.getItem(api.AUTH_RESUME_STORAGE_KEY);
    const replacement = { ...planningSnapshot(), principal: { workspaceId: 'other', viewConfigId: 'other' },
        view: { ...planningSnapshot().view, activeGroupId: 'new-group' }, planning: { ...planningSnapshot().planning, selectedTaskKeys: ['NEW-1'] } };
    assert.equal(api.writeAuthResumeState(storage, replacement, 2_000), true);
    const storedReplacement = JSON.parse(storage.getItem(api.AUTH_RESUME_STORAGE_KEY));
    assert.deepEqual(storedReplacement.principal, replacement.principal);
    assert.equal(storedReplacement.capturedAt, 2_000);
    assert.equal(storedReplacement.view.activeGroupId, 'new-group');
    assert.deepEqual(storedReplacement.planning.selectedTaskKeys, ['NEW-1']);
    assert.equal(storedReplacement.planning.selectedTaskKeys.includes('OLD-1'), false);
    const replacementBytes = storage.getItem(api.AUTH_RESUME_STORAGE_KEY);
    assert.equal(api.writeAuthResumeState(storage, oversized, 3_000), false);
    assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), replacementBytes);
    const throwing = createThrowingWriteStorage(before);
    assert.equal(api.writeAuthResumeState(throwing, { ...oldSnapshot, principal: { workspaceId: 'other', viewConfigId: 'other' } }, 2_000), false);
    assert.equal(throwing.getItem(api.AUTH_RESUME_STORAGE_KEY), before);
});

test('blocked sessionStorage getter is fail-soft', () => {
    const api = loadModule();
    const win = Object.defineProperty({}, 'sessionStorage', { get() { throw new Error('blocked'); } });
    assert.equal(api.getAuthResumeStorage(win), null);
    assert.doesNotThrow(() => api.clearAuthResumeState(null));
    assert.equal(api.writeAuthResumeState(null, planningSnapshot(), 1_000), false);
    assert.equal(api.readAuthResumeState(null, planningSnapshot().principal, 1_000), null);
});

function sharedPlanningSnapshot() {
    const columnId = '11111111-1111-4111-8111-111111111111';
    const draft = {
        inclusionChanges: [{ issueId: '8101', included: true, baseRevision: 2 }], initializePlan: false,
        basePlanRevision: 4, baseScopeProof: 'synthetic-proof', baseSchemaRevision: 1, baseViewRevision: 0,
        schemaChanges: [], cellChanges: [{ issueId: '8101', rowKind: 'story', columnId, value: null, baseRevision: 1, input: 'bad number', valid: false }],
    };
    const payload = { version: 2, groupId: 'group-1', operationId: '019a413c-0000-7000-8000-000000000001', initializePlan: false,
        basePlanRevision: 4, baseScopeProof: 'synthetic-proof', baseSchemaRevision: 1, baseViewRevision: 0,
        inclusionChanges: [{ issueId: '8101', included: false, baseRevision: 2 }], schemaChanges: [], cellChanges: [] };
    return { version: 2, principal: { workspaceId: 'workspace-1', viewConfigId: 'view-1' },
        view: { selectedView: 'eng', activeGroupId: 'group-1', selectedSprint: '101', engMode: 'planning', settingsOpen: false, settingsTab: 'scope' },
        planning: { scope: { workspaceId: 'workspace-1', groupId: 'group-1', sprintId: '101', namespaceId: null }, draft, submission: { payload, sequence: 7 }, selectedTeams: ['team-1'] } };
}

test('v2 preserves scoped draft, invalid typed input and original frozen submission independently', () => {
    const api = loadModule(), snapshot = sharedPlanningSnapshot(), storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, snapshot, 1000), true);
    const restored = JSON.parse(JSON.stringify(api.readAuthResumeState(storage, snapshot.principal, 2000)));
    assert.deepEqual(restored, { ...snapshot, capturedAt: 1000 });
    assert.equal(restored.planning.draft.inclusionChanges[0].included, true);
    assert.equal(restored.planning.submission.payload.inclusionChanges[0].included, false);
});

test('v1 recovery is shell and Team intent only, never shared inclusion authority', () => {
    const api = loadModule(), snapshot = planningSnapshot(), storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, snapshot, 1000), true);
    const restored = api.readAuthResumeState(storage, snapshot.principal, 2000);
    assert.equal(restored.version, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.planning)), { scopeKey: '', selectedTaskKeys: [], selectedTeams: ['team-1', 'team-2'], selectionMode: 'manual' });
});

test('v2 rejects unknown keys, mismatched scope, invalid identities and duplicate changes atomically', () => {
    const api = loadModule();
    const mutations = [
        value => { value.planning.secret = 'synthetic'; },
        value => { value.planning.scope.workspaceId = 'other'; },
        value => { value.planning.scope.sprintId = 'sprint-name'; },
        value => { value.planning.scope.namespaceId = ''; },
        value => { value.planning.draft.inclusionChanges[0].issueId = 'SYN-1'; },
        value => { value.planning.draft.inclusionChanges.push({ ...value.planning.draft.inclusionChanges[0] }); },
        value => { value.planning.draft.cellChanges[0].rawIssue = {}; },
        value => { delete value.planning.draft.cellChanges[0].valid; },
        value => { value.planning.submission.payload.operationId = '11111111-1111-4111-8111-111111111111'; },
        value => { value.planning.submission.payload.groupId = 'other'; },
        value => { value.planning.submission.payload.configuration = { id: 'other', revision: 1, quarter: '2027Q1', digest: null, token: 'synthetic' }; },
        value => { value.planning.draft.schemaChanges = [{ action: 'rename', columnId: 'not-a-uuid', label: 'Name' }]; },
        value => { value.planning.submission.payload.cellChanges = [{ ...value.planning.draft.cellChanges[0] }]; },
    ];
    for (const mutate of mutations) {
        const value = sharedPlanningSnapshot(); mutate(value);
        const storage = createStorage('preserve');
        assert.equal(api.writeAuthResumeState(storage, value, 1000), false);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), 'preserve');
        const raw = JSON.stringify({ ...value, capturedAt: 1000 });
        const readStorage = createStorage(raw);
        assert.equal(api.readAuthResumeState(readStorage, value.principal, 2000), null);
        assert.equal(readStorage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
});

test('v2 enforces combined identity count, cell count and byte limits without truncation', () => {
    const api = loadModule();
    const values = [];
    const many = sharedPlanningSnapshot();
    many.planning.draft.inclusionChanges = Array.from({ length: 500 }, (_, index) => ({ issueId: String(index + 1), included: true, baseRevision: 0 }));
    many.planning.draft.cellChanges[0].issueId = '9999'; values.push(many);
    const cells = sharedPlanningSnapshot();
    cells.planning.draft.cellChanges = Array.from({ length: 101 }, (_, index) => ({ issueId: String(index + 1), rowKind: 'story', columnId: '11111111-1111-4111-8111-111111111111', value: null, baseRevision: 0 })); values.push(cells);
    const bytes = sharedPlanningSnapshot(); bytes.planning.draft.cellChanges[0].input = '🧪'.repeat(70 * 1024); values.push(bytes);
    for (const value of values) {
        const storage = createStorage('preserve');
        assert.equal(api.writeAuthResumeState(storage, value, 1000), false);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), 'preserve');
    }
    const validLongInput = sharedPlanningSnapshot(); validLongInput.planning.draft.cellChanges[0].input = 'x'.repeat(2000);
    assert.equal(api.writeAuthResumeState(createStorage(), validLongInput, 1000), true, 'invalid typed input has a byte bound, no invented text-field bound');
});

test('v2 supports mapped native submission kinds and shell-only recovery', () => {
    const api = loadModule(), mapped = sharedPlanningSnapshot();
    mapped.planning.scope.namespaceId = 'configuration-1';
    mapped.planning.submission.payload.configuration = { id: 'configuration-1', revision: 2, quarter: '2027Q1', digest: 'synthetic-digest' };
    mapped.planning.submission.payload.cellChanges = [{ issueId: '8101', rowKind: 'initiative', columnId: '11111111-1111-4111-8111-111111111111', value: 'Note', baseRevision: 0 }];
    assert.equal(api.writeAuthResumeState(createStorage(), mapped, 1000), true);
    const shell = { ...sharedPlanningSnapshot(), planning: null };
    assert.equal(api.writeAuthResumeState(createStorage(), shell, 1000), true);
});

test('v2 stored capsules reject expiry, future clocks, principal mismatch and extra envelope fields', () => {
    const api = loadModule(), value = sharedPlanningSnapshot();
    for (const [capturedAt, principal, extra] of [[-1, value.principal, {}], [3000, value.principal, {}], [1000, { ...value.principal, viewConfigId: 'other' }, {}], [1000, value.principal, { rawResponse: {} }], [1000, value.principal, { version: 99 }]]) {
        const storage = createStorage(JSON.stringify({ ...value, capturedAt, ...extra }));
        assert.equal(api.readAuthResumeState(storage, principal, 2000), null);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), null);
    }
    const expired = createStorage(JSON.stringify({ ...value, capturedAt: 1000 }));
    assert.equal(api.readAuthResumeState(expired, value.principal, 1001 + api.AUTH_RESUME_TTL_MS), null);
});

test('v2 valid capsules retain the first capture and storage failures preserve prior bytes', () => {
    const api = loadModule(), value = sharedPlanningSnapshot(), storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, value, 1000), true);
    const prior = storage.getItem(api.AUTH_RESUME_STORAGE_KEY);
    const later = sharedPlanningSnapshot(); later.planning.draft.inclusionChanges[0].included = false;
    assert.equal(api.writeAuthResumeState(storage, later, 2000), false);
    assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), prior);
    const replacement = sharedPlanningSnapshot(); replacement.principal.viewConfigId = 'other';
    assert.equal(api.writeAuthResumeState(createThrowingWriteStorage(prior), replacement, 2000), false);
    assert.equal(api.writeAuthResumeState(null, value, 1000), false);
});

test('v2 rejects sparse arrays rather than writing a capsule that cannot be read', () => {
    const api = loadModule();
    for (const field of ['schemaChanges', 'inclusionChanges', 'cellChanges', 'selectedTeams']) {
        const value = sharedPlanningSnapshot();
        if (field === 'selectedTeams') value.planning.selectedTeams = new Array(1);
        else value.planning.draft[field] = new Array(1);
        assert.equal(api.writeAuthResumeState(createStorage(), value, 1000), false, field);
    }
});

test('v2 retains invalid overlong text drafts but rejects them in frozen wire submissions', async () => {
    const { validateReviewValue } = await import('../frontend/src/eng/planningReviewTableModel.js');
    const api = loadModule(), value = sharedPlanningSnapshot(), input = 'x'.repeat(501);
    const parsed = validateReviewValue({ type: 'text' }, input);
    assert.equal(parsed.valid, false);
    const cell = value.planning.draft.cellChanges[0];
    Object.assign(cell, { value: parsed.value, input, valid: parsed.valid });
    const storage = createStorage();
    assert.equal(api.writeAuthResumeState(storage, value, 1000), true);
    const restored = api.readAuthResumeState(storage, value.principal, 2000).planning.draft.cellChanges[0];
    assert.equal(restored.value, input);
    assert.equal(restored.input, input);
    assert.equal(restored.valid, false);
    value.planning.submission.payload.cellChanges = [{
        issueId: cell.issueId, rowKind: cell.rowKind, columnId: cell.columnId,
        value: parsed.value, baseRevision: cell.baseRevision,
    }];
    assert.equal(api.writeAuthResumeState(createStorage(), value, 1000), false);
    value.planning.submission = null;
    cell.input = 'different typed input';
    assert.equal(api.writeAuthResumeState(createStorage(), value, 1000), false);
});

test('v2 group identities preserve spaces, Unicode and backend code-point bounds', () => {
    const api = loadModule();
    for (const groupId of ['group x', 'отдел 🧪', '🧪'.repeat(128), '\uFEFFgroup']) {
        const value = sharedPlanningSnapshot();
        value.view.activeGroupId = groupId;
        value.planning.scope.groupId = groupId;
        value.planning.submission.payload.groupId = groupId;
        const storage = createStorage();
        assert.equal(api.writeAuthResumeState(storage, value, 1000), true);
        const restored = api.readAuthResumeState(storage, value.principal, 2000);
        assert.equal(restored.view.activeGroupId, groupId);
        assert.equal(restored.planning.scope.groupId, groupId);
        assert.equal(restored.planning.submission.payload.groupId, groupId);
    }
});

test('v2 rejects invalid group identities and retains exact scope binding', () => {
    const api = loadModule();
    for (const groupId of ['', ' group', 'group ', '\u00A0group', 'group\u3000', 'group\u0000x', 'group\u0085x', '🧪'.repeat(129)]) {
        const value = sharedPlanningSnapshot();
        value.view.activeGroupId = groupId;
        value.planning.scope.groupId = groupId;
        value.planning.submission.payload.groupId = groupId;
        const storage = createStorage('preserve');
        assert.equal(api.writeAuthResumeState(storage, value, 1000), false);
        assert.equal(storage.getItem(api.AUTH_RESUME_STORAGE_KEY), 'preserve');
        const stored = createStorage(JSON.stringify({ ...value, capturedAt: 1000 }));
        assert.equal(api.readAuthResumeState(stored, value.principal, 2000), null);
    }
    for (const mutate of [
        value => { value.view.activeGroupId = 'different group'; },
        value => { value.planning.submission.payload.groupId = 'different group'; },
        value => { value.planning.scope.workspaceId = 'other-workspace'; },
    ]) {
        const value = sharedPlanningSnapshot();
        mutate(value);
        assert.equal(api.writeAuthResumeState(createStorage(), value, 1000), false);
    }
});
