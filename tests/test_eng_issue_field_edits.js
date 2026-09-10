const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/engIssueFieldEditUtils.js');
}

async function loadController() {
    return import('../frontend/src/eng/useEngIssueFieldEdits.js');
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const metadata = (overrides = {}) => ({
    issueKey: 'DEMO-1', field: 'assignee', editable: true, reason: null,
    currentValue: { accountId: 'old', displayName: 'Old Owner' }, baseUpdated: 'base-1',
    mappingRevision: 'map-1', me: { accountId: 'me', displayName: 'Me', eligibility: 'eligible' },
    ...overrides,
});

test('story point lexical parsing accepts documented decimals and rejects coercible invalid drafts', async () => {
    const { parseStoryPointsDraft, formatStoryPointsValue } = await loadUtils();
    for (const [draft, value] of [['0', 0], ['1.5', 1.5], ['2', 2], ['3', 3], ['2.0', 2]]) {
        assert.deepEqual(parseStoryPointsDraft(draft), { valid: true, value });
    }
    for (const draft of ['', ' ', '-1', 'NaN', 'Infinity', '1.25', '1,5', '1e2', '.5', '2.']) {
        assert.deepEqual(parseStoryPointsDraft(draft), { valid: false, value: null }, draft);
    }
    assert.equal(formatStoryPointsValue(2.0), '2');
    assert.equal(formatStoryPointsValue(1.5), '1.5');
});

test('Unicode threshold and people normalization pin Me, dedupe accountId, and cap at five', async () => {
    const { hasIssueUserSearchThreshold, normalizeIssueUserSuggestions } = await loadUtils();
    assert.equal(hasIssueUserSearchThreshold('å𐐷'), false);
    assert.equal(hasIssueUserSearchThreshold('å𐐷界'), true);
    const me = { accountId: 'me', displayName: 'Current Person', eligibility: 'eligible' };
    assert.deepEqual(normalizeIssueUserSuggestions(me, [
        { accountId: 'a', displayName: 'A' }, me, { accountId: 'a', displayName: 'Duplicate' },
        { accountId: 'b', displayName: 'B' }, { accountId: 'c', displayName: 'C' },
        { accountId: 'd', displayName: 'D' }, { accountId: 'e', displayName: 'E' },
    ]).map(person => person.accountId), ['me', 'a', 'b', 'c', 'd']);
});

test('one active editor drops stale metadata and stale debounced search results', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const reads = [];
    const searches = [];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', debounceMs: 0,
        fetchEditableField: (...args) => { const d = deferred(); reads.push({ args, ...d }); return d.promise; },
        searchUsers: (...args) => { const d = deferred(); searches.push({ args, ...d }); return d.promise; },
        updateField: async () => ({}),
    });

    const first = controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee', sourceSurface: 'catch_up' });
    const second = controller.openEditor({ issueKey: 'DEMO-2', field: 'assignee', sourceSurface: 'planning' });
    reads[0].resolve(metadata({ issueKey: 'DEMO-1' }));
    reads[1].resolve(metadata({ issueKey: 'DEMO-2' }));
    await Promise.all([first, second]);
    assert.equal(controller.getState().activeEditor.issueKey, 'DEMO-2');

    const oldSearch = controller.search('Ada');
    await new Promise(resolve => setTimeout(resolve, 0));
    const newSearch = controller.search('Grace');
    await new Promise(resolve => setTimeout(resolve, 0));
    searches[0].resolve({ options: [{ accountId: 'ada', displayName: 'Ada' }] });
    searches[1].resolve({ options: [{ accountId: 'grace', displayName: 'Grace' }] });
    await Promise.all([oldSearch, newSearch]);
    assert.deepEqual(controller.getState().suggestions.map(person => person.accountId), ['me', 'grace']);
});

test('below-threshold searches make no request and 300ms debounce dispatches only the latest query', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const calls = [];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        fetchEditableField: async () => metadata(),
        searchUsers: async (_url, _key, payload) => { calls.push(payload.query); return { options: [] }; },
        updateField: async () => ({}),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.search('å𐐷');
    const first = controller.search('Ada');
    const second = controller.search('Grace');
    await new Promise(resolve => setTimeout(resolve, 320));
    await Promise.all([first, second]);
    assert.deepEqual(calls, ['Grace']);
});

test('mounted-session people cache restores discovered users and skips repeated Jira searches', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const searches = [];
    const writes = [];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', debounceMs: 0,
        getContextKey: () => 'site-a|auth-1',
        fetchEditableField: async () => metadata(),
        searchUsers: async (_url, _key, payload) => {
            searches.push(payload.query);
            return { options: [{ accountId: 'grace', displayName: 'Grace Hopper' }] };
        },
        updateField: async (_url, issueKey, payload) => {
            writes.push([issueKey, payload.value]);
            return { result: 'success', value: { accountId: 'grace', displayName: 'Grace Hopper' }, mappingRevision: 'map-1' };
        },
        enqueueMutation: async (_keys, run) => run(),
    });

    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.search('Grace');
    assert.deepEqual(controller.getState().suggestions.map(person => person.accountId), ['me', 'grace']);
    await controller.search('grace');
    assert.deepEqual(searches, ['Grace']);
    controller.closeEditor();

    await controller.openEditor({ issueKey: 'DEMO-2', field: 'assignee' });
    assert.deepEqual(controller.getState().suggestions.map(person => person.accountId), ['me', 'grace']);
    assert.equal(controller.getState().suggestions[1].eligibility, 'unverified');
    assert.deepEqual(searches, ['Grace']);
    await controller.submit({ accountId: 'grace' });
    assert.deepEqual(writes, [['DEMO-2', { accountId: 'grace' }]]);
});

test('authentication context changes clear mounted-session people searches', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let authGeneration = 1;
    let searches = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', debounceMs: 0,
        getContextKey: () => `site-a|auth-${authGeneration}`,
        fetchEditableField: async () => metadata(),
        searchUsers: async () => {
            searches += 1;
            return { options: [{ accountId: 'grace', displayName: 'Grace Hopper' }] };
        },
        updateField: async () => ({}),
    });

    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.search('Grace');
    authGeneration += 1;
    controller.contextChanged({ authChanged: true });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.search('Grace');
    assert.equal(searches, 2);
});

test('submit freezes context, keeps dispatched writes alive after close, and confirms through Task 2 seams', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const write = deferred();
    const mutations = [];
    const confirmations = [];
    let context = 'site-a|auth-1|scope-a';
    const issueEditState = {
        beginMutation: (...args) => { const value = { args }; mutations.push(value); return value; },
        confirmMutation: (...args) => { confirmations.push(args); return true; },
        markUnknown() {},
    };
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', issueEditState, getContextKey: () => context,
        fetchEditableField: async () => metadata(),
        searchUsers: async () => ({ options: [] }),
        updateField: (...args) => {
            assert.equal(args[2].baseUpdated, 'base-1');
            assert.deepEqual(args[2].value, { accountId: 'new' });
            assert.deepEqual(args[2].baseValue, { accountId: 'old' });
            return write.promise;
        },
        enqueueMutation: async (_keys, run, options) => {
            assert.equal(options.shouldStart(), true);
            return run();
        },
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee', sourceSurface: 'catch_up' });
    const saving = controller.submit({ accountId: 'new' });
    controller.closeEditor();
    assert.equal(controller.getState().pendingIssueKeys.has('DEMO-1'), true);
    write.resolve({ result: 'success', value: { accountId: 'new', displayName: 'New Owner' }, mappingRevision: 'map-1' });
    await saving;
    assert.equal(confirmations.length, 1);
    assert.equal(controller.getState().pendingIssueKeys.has('DEMO-1'), false);
    assert.equal(controller.getState().activeEditor, null);
    assert.equal(mutations.length, 1);
});

test('a rejected Jira person keeps the current value and never confirms a local change', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let confirmations = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        issueEditState: {
            beginMutation: () => ({}),
            confirmMutation: () => { confirmations += 1; },
            markUnknown() {},
        },
        fetchEditableField: async () => metadata(),
        searchUsers: async () => ({ options: [] }),
        updateField: async () => {
            throw Object.assign(new Error('synthetic rejection'), { code: 'target_unavailable' });
        },
        enqueueMutation: async (_keys, run) => run(),
    });

    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'missing' });

    assert.equal(confirmations, 0);
    assert.deepEqual(controller.getState().metadata.currentValue, { accountId: 'old', displayName: 'Old Owner' });
    assert.equal(controller.getState().status, 'draft');
    assert.equal(controller.getState().errorMessage, 'That person is no longer available for this field.');
});

test('same-site auth generation change drops a stale dispatched confirmation', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const write = deferred();
    const confirmations = [];
    let authGeneration = 1;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        getContextKey: () => `atlassian_oauth|https://jira.example.test|${authGeneration}`,
        issueEditState: {
            beginMutation: () => ({}),
            confirmMutation: (...args) => { confirmations.push(args); return true; },
            markUnknown() {},
        },
        fetchEditableField: async () => metadata(),
        searchUsers: async () => ({ options: [] }),
        updateField: async () => write.promise,
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const saving = controller.submit({ accountId: 'new' });
    authGeneration += 1;
    controller.contextChanged({ authChanged: true });
    write.resolve({ result: 'success', value: { accountId: 'new' }, mappingRevision: 'map-1' });
    await saving;
    assert.equal(confirmations.length, 0);
    assert.equal(controller.getState().pendingIssueKeys.size, 0);
    assert.equal(controller.getState().activeEditor, null);
});

test('same-site auth generation change drops a stale dispatched auth error without relocking', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const write = deferred();
    let authGeneration = 1;
    let authRecoveries = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        getContextKey: () => `atlassian_oauth|https://jira.example.test|${authGeneration}`,
        onAuthRecoveryRequired: () => { authRecoveries += 1; },
        issueEditState: { beginMutation: () => ({}), confirmMutation: () => true, markUnknown() {} },
        fetchEditableField: async () => metadata(), searchUsers: async () => ({ options: [] }),
        updateField: async () => write.promise,
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const saving = controller.submit({ accountId: 'new' });
    authGeneration += 1;
    controller.contextChanged({ authChanged: true });
    const error = new Error('old session');
    error.name = 'AuthenticationRequiredError';
    write.reject(error);
    await saving;
    assert.equal(authRecoveries, 0);
    assert.equal(controller.getState().status, 'closed');
});

test('queued scope changes cancel before dispatch while dispatched transport loss becomes unknown', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let context = 'site-a|auth-1|scope-a';
    let dispatches = 0;
    let markUnknownCount = 0;
    let queuedOptions;
    const queued = deferred();
    const issueEditState = { beginMutation: () => ({}), confirmMutation: () => true, markUnknown: () => { markUnknownCount += 1; } };
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', issueEditState, getContextKey: () => context,
        fetchEditableField: async () => metadata(), searchUsers: async () => ({ options: [] }),
        updateField: async () => { dispatches += 1; throw new TypeError('private transport text'); },
        enqueueMutation: (_keys, run, options) => { queuedOptions = options; return queued.promise.then(run); },
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const canceled = controller.submit({ accountId: 'new' });
    context = 'site-a|auth-1|scope-b';
    controller.contextChanged();
    queued.resolve();
    await canceled;
    assert.equal(queuedOptions.shouldStart(), false);
    assert.equal(dispatches, 0);

    context = 'site-a|auth-1|scope-b';
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    controller.configureQueue(async (_keys, run) => run());
    await controller.submit({ accountId: 'new' });
    assert.equal(markUnknownCount, 1);
    assert.equal(controller.getState().outcome?.status, 'unknown');
    assert.equal(controller.getState().errorMessage.includes('private transport text'), false);
});

test('an old rejected request cannot clear the current same-issue pending token', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const first = deferred();
    const second = deferred();
    const writes = [first, second];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', fetchEditableField: async () => metadata(), searchUsers: async () => ({ options: [] }),
        updateField: async () => writes.shift().promise,
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const oldSave = controller.submit({ accountId: 'one' });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const currentSave = controller.submit({ accountId: 'two' });
    first.reject(Object.assign(new Error('raw'), { code: 'jira_field_rejected' }));
    await oldSave;
    assert.equal(controller.getState().pendingIssueKeys.has('DEMO-1'), true);
    second.resolve({ result: 'success', value: { accountId: 'two' }, mappingRevision: 'map-1' });
    await currentSave;
    assert.equal(controller.getState().pendingIssueKeys.has('DEMO-1'), false);
});

test('Check Jira reconciles unknown only for the frozen non-null mapping revision', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let loaded = metadata();
    const confirmations = [];
    const issueEditState = {
        beginMutation: () => ({}), markUnknown() {},
        confirmMutation: (...args) => { confirmations.push(args); return true; },
    };
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', issueEditState,
        fetchEditableField: async () => loaded, searchUsers: async () => ({ options: [] }),
        updateField: async () => { throw Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' }); },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'new' });
    loaded = metadata({ currentValue: { accountId: 'observed' }, mappingRevision: 'map-2' });
    await controller.checkJira();
    assert.equal(confirmations.length, 0);
    assert.equal(controller.getState().outcome.status, 'unknown');
    loaded = metadata({ currentValue: { accountId: 'observed' }, mappingRevision: 'map-1' });
    await controller.checkJira();
    assert.equal(confirmations.length, 1);
    assert.equal(controller.getState().outcome.status, 'observed');
});

test('Check Jira drops a response that resolves after the auth generation changes', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const reconciliation = deferred();
    let authGeneration = 1;
    let readCount = 0;
    let confirmations = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        getContextKey: () => `site-a|${authGeneration}`,
        issueEditState: {
            beginMutation: () => ({}), markUnknown() {},
            confirmMutation: () => { confirmations += 1; return true; },
        },
        fetchEditableField: async () => {
            readCount += 1;
            return readCount === 1 ? metadata() : reconciliation.promise;
        },
        searchUsers: async () => ({ options: [] }),
        updateField: async () => { throw Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' }); },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'new' });
    const checking = controller.checkJira();
    authGeneration += 1;
    controller.contextChanged({ authChanged: true });
    reconciliation.resolve(metadata({ currentValue: { accountId: 'stale-observation' } }));
    await checking;
    assert.equal(confirmations, 0);
    assert.equal(controller.getState().status, 'closed');
});

test('two different-issue unknown writes can each be checked independently', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const writes = new Map([['DEMO-1', deferred()], ['DEMO-2', deferred()]]);
    const observed = new Map([['DEMO-1', 'observed-one'], ['DEMO-2', 'observed-two']]);
    const confirmations = [];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        issueEditState: {
            beginMutation: issueKey => ({ issueKey }), markUnknown() {},
            confirmMutation: (mutation, value) => { confirmations.push([mutation.issueKey, value.accountId]); return true; },
        },
        fetchEditableField: async (_url, issueKey) => metadata({
            issueKey,
            currentValue: { accountId: observed.get(issueKey), displayName: issueKey },
        }),
        searchUsers: async () => ({ options: [] }),
        updateField: async (_url, issueKey) => writes.get(issueKey).promise,
        enqueueMutation: async (_keys, run) => run(),
    });

    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const first = controller.submit({ accountId: 'new-one' });
    await controller.openEditor({ issueKey: 'DEMO-2', field: 'assignee' });
    const second = controller.submit({ accountId: 'new-two' });
    for (const write of writes.values()) write.reject(Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' }));
    await Promise.all([first, second]);

    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.checkJira();
    await controller.openEditor({ issueKey: 'DEMO-2', field: 'assignee' });
    await controller.checkJira();
    assert.deepEqual(confirmations, [['DEMO-1', 'observed-one'], ['DEMO-2', 'observed-two']]);
});

test('scope closure preserves dispatched unknown recovery while auth change clears it', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let write = deferred();
    let authGeneration = 1;
    let observedValue = 'old';
    let confirmations = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        getContextKey: () => `site-a|${authGeneration}`,
        issueEditState: {
            beginMutation: () => ({}), markUnknown() {},
            confirmMutation: () => { confirmations += 1; return true; },
        },
        fetchEditableField: async () => metadata({ currentValue: { accountId: observedValue } }),
        searchUsers: async () => ({ options: [] }),
        updateField: async () => {
            if (write) return write.promise;
            throw Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' });
        },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const saving = controller.submit({ accountId: 'new' });
    controller.contextChanged();
    write.reject(Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' }));
    await saving;
    observedValue = 'observed';
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.checkJira();
    assert.equal(confirmations, 1);

    write = null;
    await controller.submit({ accountId: 'newer' });
    authGeneration += 1;
    controller.contextChanged({ authChanged: true });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.checkJira();
    assert.equal(confirmations, 1);
});

test('conflict Reload replaces the baseline and returns the editor to ready', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let loaded = metadata();
    let writes = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', fetchEditableField: async () => loaded, searchUsers: async () => ({ options: [] }),
        updateField: async () => { writes += 1; throw Object.assign(new Error('raw conflict'), { code: 'stale_issue' }); },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'new' });
    assert.equal(controller.getState().status, 'conflict');
    await controller.submit({ accountId: 'blocked-before-reload' });
    assert.equal(writes, 1);
    loaded = metadata({ currentValue: { accountId: 'latest', displayName: 'Latest' }, baseUpdated: 'base-2' });
    await controller.reload();
    assert.equal(controller.getState().status, 'ready');
    assert.equal(controller.getState().metadata.currentValue.accountId, 'latest');
    await controller.submit({ accountId: 'allowed-after-reload' });
    assert.equal(writes, 2);
});

test('failed conflict Reload preserves actionable conflict state and announces the read error', async () => {
    const { createEngIssueFieldEditController, issueFieldErrorMessage } = await loadController();
    let reads = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        fetchEditableField: async () => {
            reads += 1;
            if (reads === 1) return metadata();
            throw Object.assign(new Error('private read text'), { code: 'jira_read_failed' });
        },
        searchUsers: async () => ({ options: [] }),
        updateField: async () => { throw Object.assign(new Error('conflict'), { code: 'stale_issue' }); },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'new' });
    await controller.reload();
    assert.equal(controller.getState().status, 'conflict');
    assert.equal(controller.getState().outcome.status, 'conflict');
    assert.equal(controller.getState().errorCode, 'jira_read_failed');
    assert.equal(controller.getState().errorMessage, issueFieldErrorMessage('jira_read_failed'));
    assert.equal(controller.getState().errorMessage.includes('private read text'), false);
});

test('unknown submit is blocked until matching Check Jira succeeds', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let writes = 0;
    let rejectWrite = true;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        issueEditState: { beginMutation: () => ({}), markUnknown() {}, confirmMutation: () => true },
        fetchEditableField: async () => metadata({ currentValue: { accountId: 'observed' } }),
        searchUsers: async () => ({ options: [] }),
        updateField: async () => {
            writes += 1;
            if (rejectWrite) throw Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' });
            return { result: 'success', value: { accountId: 'after-check' }, mappingRevision: 'map-1' };
        },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'new' });
    await controller.submit({ accountId: 'blocked' });
    assert.equal(writes, 1);
    await controller.checkJira();
    rejectWrite = false;
    await controller.submit({ accountId: 'after-check' });
    assert.equal(writes, 2);
});

test('an unrelated issue unknown does not block the active editor', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const writes = [];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        issueEditState: { beginMutation: issueKey => ({ issueKey }), markUnknown() {}, confirmMutation: () => true },
        fetchEditableField: async (_url, issueKey) => metadata({ issueKey }),
        searchUsers: async () => ({ options: [] }),
        updateField: async (_url, issueKey) => {
            writes.push(issueKey);
            if (issueKey === 'DEMO-1') throw Object.assign(new Error('unknown'), { code: 'write_outcome_unknown' });
            return { result: 'success', value: { accountId: 'new-two' }, mappingRevision: 'map-1' };
        },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await controller.submit({ accountId: 'new-one' });
    await controller.openEditor({ issueKey: 'DEMO-2', field: 'assignee' });
    await controller.submit({ accountId: 'new-two' });
    assert.deepEqual(writes, ['DEMO-1', 'DEMO-2']);
});

test('duplicate direct submit calls enqueue only one write', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const write = deferred();
    let writes = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        fetchEditableField: async () => metadata(), searchUsers: async () => ({ options: [] }),
        updateField: async () => { writes += 1; return write.promise; },
        enqueueMutation: async (_keys, run) => run(),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    const first = controller.submit({ accountId: 'new' });
    const duplicate = controller.submit({ accountId: 'duplicate' });
    assert.equal(await duplicate, null);
    assert.equal(writes, 1);
    write.resolve({ result: 'success', value: { accountId: 'new' }, mappingRevision: 'map-1' });
    await first;
    assert.equal(writes, 1);
});

test('auth lock prevents queued dispatch and an API auth failure terminally closes the editor', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    let locked = false;
    let dispatches = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root', isAuthLocked: () => locked,
        fetchEditableField: async () => metadata(), searchUsers: async () => ({ options: [] }),
        updateField: async () => { dispatches += 1; },
        enqueueMutation: async (_keys, run, options) => {
            if (!options.shouldStart()) {
                const error = new Error('cancel'); error.name = 'AbortError'; throw error;
            }
            return run();
        },
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    locked = true;
    await controller.submit({ accountId: 'new' });
    assert.equal(dispatches, 0);

    // Use a second controller for the typed auth response path.
    const authController = createEngIssueFieldEditController({
        backendUrl: '/root', fetchEditableField: async () => metadata(), searchUsers: async () => ({ options: [] }),
        updateField: async () => { const error = new Error('private'); error.name = 'AuthenticationRequiredError'; throw error; },
        enqueueMutation: async (_keys, run) => run(),
    });
    await authController.openEditor({ issueKey: 'DEMO-1', field: 'assignee' });
    await authController.submit({ accountId: 'new' });
    assert.equal(authController.getState().status, 'auth-required');
    assert.equal(authController.getState().activeEditor, null);
    assert.equal(authController.getState().errorMessage.includes('private'), false);
});

test('unchanged activation emits bounded submit and result analytics without a Jira write', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const actions = [];
    let writes = 0;
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        fetchEditableField: async () => metadata(),
        searchUsers: async () => ({ options: [] }),
        updateField: async () => { writes += 1; },
        onAction: (workflowAction, editor, result) => actions.push({ workflowAction, field: editor.field, issueKind: editor.issueKind, sourceSurface: editor.sourceSurface, result }),
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee', issueKind: 'story', sourceSurface: 'catch_up' });
    controller.closeEditor('unchanged');
    assert.equal(writes, 0);
    assert.deepEqual(actions, [
        { workflowAction: 'open', field: 'assignee', issueKind: 'story', sourceSurface: 'catch_up', result: undefined },
        { workflowAction: 'submit', field: 'assignee', issueKind: 'story', sourceSurface: 'catch_up', result: undefined },
        { workflowAction: 'result', field: 'assignee', issueKind: 'story', sourceSurface: 'catch_up', result: 'unchanged' },
    ]);
});

test('same-issue field submit waits behind a status reservation in the shared mutation queue', async () => {
    const { createEngIssueFieldEditController } = await loadController();
    const { enqueueEngIssueMutations } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const statusGate = deferred();
    const events = [];
    const controller = createEngIssueFieldEditController({
        backendUrl: '/root',
        fetchEditableField: async () => metadata(),
        searchUsers: async () => ({ options: [] }),
        updateField: async () => {
            events.push('field-start');
            return { result: 'success', value: { accountId: 'new', displayName: 'New Owner' }, mappingRevision: 'map-1' };
        },
    });
    await controller.openEditor({ issueKey: 'DEMO-1', field: 'assignee', issueKind: 'story', sourceSurface: 'catch_up' });
    const statusWrite = enqueueEngIssueMutations(['DEMO-1'], async () => {
        events.push('status-start');
        await statusGate.promise;
        events.push('status-end');
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    const fieldWrite = controller.submit({ accountId: 'new' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(events, ['status-start']);
    statusGate.resolve();
    await Promise.all([statusWrite, fieldWrite]);
    assert.deepEqual(events, ['status-start', 'status-end', 'field-start']);
});
