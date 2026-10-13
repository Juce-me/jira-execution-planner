const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'dashboardRuntime.js')],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
}).outputFiles[0].text;
const sandbox = { module: { exports: {} }, exports: {}, console, AbortController };
vm.runInContext(source, vm.createContext(sandbox));
const {
    createSprintCatalogController,
    createSprintCatalogState,
    isBackendConnectionFailure,
    loadCachedSprintCatalog,
    reduceSprintCatalog,
    shouldReconcileSprintCatalogSource,
    sprintCatalogValidationKey,
} = sandbox.module.exports;

const SOURCE_A = { identity: 'sc1:a', browserContextId: 'bc1:a' };
const SOURCE_B = { identity: 'sc1:b', browserContextId: 'bc1:a' };
const validatedEnvelope = ({
    source = SOURCE_A,
    sprints = [{ id: 42, name: '2026Q3', state: 'active' }],
    state = 'fresh',
    refreshStatus = 'completed',
    refreshAttemptId = null,
    refreshStarted = false,
} = {}) => ({
    httpStatus: 200,
    sprints,
    cache: {
        backend: 'postgresql',
        ...source,
        state,
        validatedAt: '2026-09-14T12:00:30Z',
        catalogVersion: '33333333-3333-4333-8333-333333333333',
        refreshStatus,
        refreshAttemptId,
        refreshStarted,
    },
});

const responseEvent = (state, envelope) => ({
    type: 'RESPONSE',
    generation: state.generation,
    browserContextId: state.browserContextId,
    identity: state.identity,
    envelope,
});

test('cached Sprint catalog is reusable for 24 hours and rejects stale or empty data', () => {
    const now = Date.UTC(2026, 8, 12, 20, 0, 0);
    const valid = { sprintCatalog: { cachedAt: now - 1000, sprints: [{ id: 42, name: '2026Q3', state: 'active' }] } };
    assert.deepEqual(loadCachedSprintCatalog(valid, now).sprints.map(sprint => sprint.name), ['2026Q3']);
    assert.equal(loadCachedSprintCatalog({ sprintCatalog: { cachedAt: now - (24 * 60 * 60 * 1000), sprints: valid.sprintCatalog.sprints } }, now).sprints.length, 0);
    assert.equal(loadCachedSprintCatalog({ sprintCatalog: { cachedAt: now, sprints: [] } }, now).sprints.length, 0);
});

test('restored Sprint catalog remains display-only until server validation', () => {
    const state = createSprintCatalogState({
        displaySnapshot: { identity: 'sc1:a', cachedAt: 1, sprints: [{ id: 42, name: 'Saved' }] },
        savedSprintId: 42,
        savedSprintName: 'Saved',
    });
    assert.equal(state.authority, 'display_only');
    assert.equal(state.validatedSnapshot, null);
    assert.equal(state.availableSprints.length, 0);
    assert.equal(state.savedSprintName, 'Saved');
});

test('populated Board A to validated empty Board B clears authority', () => {
    let state = createSprintCatalogState({ savedSprintId: 42, savedSprintName: 'Saved' });
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope()));
    assert.equal(state.availableSprints.length, 1);
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_B });
    assert.equal(state.authority, 'invalid');
    assert.equal(state.availableSprints.length, 0);
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope({ source: SOURCE_B, sprints: [] })));
    assert.equal(state.authority, 'validated');
    assert.equal(state.selectedSprintId, null);
    assert.equal(state.validatedSnapshot.sprints.length, 0);
});

test('failed server envelope with validated payload establishes authority after display-only restore', () => {
    let state = createSprintCatalogState({ displaySnapshot: { sprints: [{ id: 42, name: 'Saved' }] } });
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope({ state: 'failed', refreshStatus: 'failed' })));
    assert.equal(state.authority, 'validated');
    assert.equal(state.status, 'error');
    assert.equal(state.availableSprints.length, 1);
});

test('failed payloadless envelope cannot establish authority', () => {
    let state = createSprintCatalogState({ displaySnapshot: { sprints: [{ id: 42, name: 'Saved' }] } });
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    state = reduceSprintCatalog(state, responseEvent(state, {
        httpStatus: 502,
        error: 'sprint_catalog_unavailable',
        cache: { ...SOURCE_A, state: 'failed', validatedAt: null, catalogVersion: null, refreshStatus: 'failed' },
    }));
    assert.notEqual(state.authority, 'validated');
    assert.equal(state.availableSprints.length, 0);
    assert.equal(state.status, 'error');
});

test('removed Board invalidates restored and validated choices', () => {
    let state = createSprintCatalogState({ displaySnapshot: { sprints: [{ id: 42, name: 'Saved' }] } });
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope()));
    state = reduceSprintCatalog(state, responseEvent(state, { httpStatus: 409, error: 'sprint_board_required' }));
    assert.equal(state.authority, 'invalid');
    assert.equal(state.availableSprints.length, 0);
    assert.equal(state.selectedSprintId, null);
});

test('delayed Board A success and failure cannot change Board B', () => {
    let state = createSprintCatalogState({});
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    const old = { generation: state.generation, browserContextId: state.browserContextId, identity: state.identity };
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_B });
    const boardB = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope({ source: SOURCE_B, sprints: [] })));
    assert.strictEqual(reduceSprintCatalog(boardB, { type: 'RESPONSE', ...old, envelope: validatedEnvelope() }), boardB);
    assert.strictEqual(reduceSprintCatalog(boardB, { type: 'FAILURE', ...old, error: new Error('late') }), boardB);
});

test('same-identity transient failure retains validated snapshot', () => {
    let state = createSprintCatalogState({});
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope()));
    const snapshot = state.validatedSnapshot;
    state = reduceSprintCatalog(state, { type: 'FAILURE', generation: state.generation, browserContextId: state.browserContextId, identity: state.identity });
    assert.equal(state.authority, 'validated');
    assert.strictEqual(state.validatedSnapshot, snapshot);
    assert.equal(state.status, 'error');
});

test('auth context change invalidates authority without changing shared ownership', () => {
    let state = createSprintCatalogState({});
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope()));
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: { ...SOURCE_A, browserContextId: 'bc1:b' } });
    assert.equal(state.identity, SOURCE_A.identity);
    assert.equal(state.authority, 'invalid');
    assert.equal(state.availableSprints.length, 0);
});

test('new generation suppresses stale finally and persistence', () => {
    let state = createSprintCatalogState({});
    state = reduceSprintCatalog(state, { type: 'SOURCE', source: SOURCE_A });
    const oldGeneration = state.generation;
    state = reduceSprintCatalog(state, { type: 'INVALIDATE', reason: 'save-start' });
    assert.strictEqual(reduceSprintCatalog(state, { type: 'FINISH', generation: oldGeneration }), state);
    assert.strictEqual(reduceSprintCatalog(state, { type: 'PERSISTED', generation: oldGeneration }), state);
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('config source accepted during the first read re-reads instead of stranding the catalog', async () => {
    const first = deferred();
    const calls = [];
    const controller = createSprintCatalogController({
        initialState: createSprintCatalogState({ displaySnapshot: { cachedAt: 1, sprints: [{ id: 42, name: '2026Q3', state: 'active' }] } }),
        read: (options) => {
            calls.push(options);
            return calls.length === 1 ? first.promise : Promise.resolve(validatedEnvelope());
        },
        setTimer: () => 1,
        clearTimer: () => {},
    });
    const initial = controller.readCurrent();
    controller.acceptSource(SOURCE_A);
    first.resolve(validatedEnvelope());
    await initial;
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(controller.getState().authority, 'validated');
    assert.equal(controller.getState().status, 'ready');
    controller.dispose();
});

test('completion exhaustion is terminal', async () => {
    let clock = 0;
    const timers = [];
    const calls = [];
    const controller = createSprintCatalogController({
        read: async (options) => {
            calls.push(options);
            return validatedEnvelope({ state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: '11111111-1111-4111-8111-111111111111', refreshStarted: calls.length === 1 });
        },
        now: () => clock,
        setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
        clearTimer: () => {},
    });
    controller.acceptSource(SOURCE_A);
    await controller.readCurrent();
    while (timers.length && calls.length <= 17) {
        const timer = timers.shift();
        clock += timer.delay;
        await timer.fn();
    }
    assert.equal(controller.getState().status, 'exhausted');
    const settledCalls = calls.length;
    while (timers.length) await timers.shift().fn();
    assert.equal(calls.length, settledCalls);
    controller.dispose();
});

test('completion abort at the hard deadline exhausts immediately without another timer or read', async () => {
    let clock = 0;
    let nextTimerId = 1;
    const timers = new Map();
    const calls = [];
    const controller = createSprintCatalogController({
        read: async (options) => {
            calls.push(options);
            if (calls.length === 1) {
                return validatedEnvelope({
                    state: 'refreshing',
                    refreshStatus: 'pending',
                    refreshAttemptId: '11111111-1111-4111-8111-111111111111',
                    refreshStarted: true,
                });
            }
            clock = 75000;
            throw Object.assign(new Error('deadline'), { name: 'AbortError' });
        },
        now: () => clock,
        setTimer: (fn, delay) => {
            const id = nextTimerId;
            nextTimerId += 1;
            timers.set(id, { fn, delay });
            return id;
        },
        clearTimer: id => timers.delete(id),
    });
    controller.acceptSource(SOURCE_A);
    await controller.readCurrent();
    const [observerTimerId, observerTimer] = timers.entries().next().value;
    timers.delete(observerTimerId);
    clock += observerTimer.delay;
    await observerTimer.fn();

    assert.equal(controller.getState().status, 'exhausted');
    assert.equal(calls.length, 2);
    assert.equal(timers.size, 0);
    controller.dispose();
});

test('Retry after failure or exhaustion sends one forced read and coalesces a live attempt', async () => {
    const pending = deferred();
    const calls = [];
    const controller = createSprintCatalogController({
        read: (options) => { calls.push(options); return pending.promise; },
        setTimer: () => 1,
        clearTimer: () => {},
    });
    controller.acceptSource(SOURCE_A);
    const first = controller.refresh();
    const second = controller.refresh();
    await Promise.resolve();
    assert.strictEqual(first, second);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].forceRefresh, true);
    pending.resolve(validatedEnvelope());
    await first;
    controller.dispose();
});

test('manual refresh never treats ordinary read as completion', async () => {
    const ordinary = deferred();
    const forced = deferred();
    const calls = [];
    const controller = createSprintCatalogController({
        read: (options) => {
            calls.push(options);
            return calls.length === 1 ? ordinary.promise : forced.promise;
        },
        setTimer: () => 1,
        clearTimer: () => {},
    });
    controller.acceptSource(SOURCE_A);
    const normalPromise = controller.readCurrent();
    const refreshPromise = controller.refresh();
    await Promise.resolve();
    assert.equal(calls.length, 1);
    ordinary.resolve(validatedEnvelope());
    await normalPromise;
    await Promise.resolve();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].forceRefresh, true);
    forced.resolve(validatedEnvelope());
    await refreshPromise;
    controller.dispose();
});

test('global auth lock cancels completion ownership and invalidates authority', async () => {
    const timers = [];
    const controller = createSprintCatalogController({
        read: async () => validatedEnvelope({
            state: 'refreshing',
            refreshStatus: 'pending',
            refreshAttemptId: '11111111-1111-4111-8111-111111111111',
            refreshStarted: true,
        }),
        setTimer: fn => { timers.push(fn); return timers.length; },
        clearTimer: () => {},
    });
    controller.acceptSource(SOURCE_A);
    await controller.readCurrent();
    controller.authLock();
    assert.equal(controller.getState().authority, 'auth_locked');
    const callCount = timers.length;
    while (timers.length) await timers.shift()();
    assert.equal(timers.length, 0);
    assert.ok(callCount > 0);
    controller.dispose();
});

test('slow config source requires one reconciliation after newer Sprint validation', () => {
    let state = createSprintCatalogState({});
    const configStartGeneration = state.generation;
    state = reduceSprintCatalog(state, responseEvent(state, validatedEnvelope({ source: SOURCE_B })));
    assert.equal(shouldReconcileSprintCatalogSource(configStartGeneration, state, SOURCE_A), true);
    assert.equal(shouldReconcileSprintCatalogSource(state.generation, state, SOURCE_B), false);
});

test('display cache validation key changes only for accepted validation', () => {
    const snapshot = {
        identity: SOURCE_A.identity,
        browserContextId: SOURCE_A.browserContextId,
        validatedAt: '2026-09-14T12:00:30Z',
        catalogVersion: '33333333-3333-4333-8333-333333333333',
        sprints: [],
    };
    assert.equal(sprintCatalogValidationKey(snapshot), sprintCatalogValidationKey({ ...snapshot, sprints: [{ id: 1, name: 'ignored' }] }));
    assert.notEqual(sprintCatalogValidationKey({ sprints: [{ id: 1, name: 'Legacy' }] }), '');
    assert.equal(sprintCatalogValidationKey(null), '');
});

test('isBackendConnectionFailure classifies the config bootstrap timeout but not other aborts', () => {
    const timeout = new Error('Config did not respond');
    timeout.name = 'ConfigBootstrapTimeoutError';
    assert.equal(isBackendConnectionFailure(timeout), true);
    const supersededRead = new Error('The operation was aborted.');
    supersededRead.name = 'AbortError';
    assert.equal(isBackendConnectionFailure(supersededRead), false);
    assert.equal(isBackendConnectionFailure(new TypeError('Failed to fetch')), true);
    assert.equal(isBackendConnectionFailure(new Error('Config error 503')), false);
    assert.equal(isBackendConnectionFailure(null), false);
});


test('due automatic catalog read preserves a removed selected Sprint; manual Refresh retains normal fallback', async () => {
    const reads = [];
    const controller = createSprintCatalogController({
        initialState: createSprintCatalogState({ savedSprintId: 42 }),
        now: () => Date.parse('2026-09-16T12:00:30Z'),
        read: async options => { reads.push(options); return validatedEnvelope({ sprints: reads.length === 1 ? [{ id: 42, name: 'Saved', state: 'active' }] : [{ id: 99, name: 'Next', state: 'active' }] }); },
    });
    await controller.readCurrent();
    await controller.readDue({ selectedSprintId: 42, signal: new AbortController().signal, shouldApply: () => true });
    assert.equal(reads.length, 2);
    assert.equal(reads[1].forceRefresh, false);
    assert.equal(reads[1].automatic, true);
    assert.equal(controller.getState().selectedSprintId, 42);
    assert.equal(controller.getState().selectionPreserved, true);
    assert.equal(controller.getState().availableSprints[0].id, 99);
    await controller.refresh();
    assert.equal(controller.getState().selectedSprintId, 99);
    assert.equal(controller.getState().selectionPreserved, false);
    controller.dispose();
});

test('automatic catalog read is absent before due and retains the validated snapshot on failure', async () => {
    let nowMs = Date.parse('2026-09-14T12:00:31Z'), reads = 0;
    const controller = createSprintCatalogController({ now: () => nowMs, read: async () => {
        reads += 1;
        if (reads > 1) throw new Error('synthetic upstream unavailable');
        return validatedEnvelope();
    } });
    await controller.readCurrent();
    const held = controller.getState();
    await controller.readDue({ selectedSprintId: 42, shouldApply: () => true });
    assert.equal(reads, 1);
    nowMs += 24 * 60 * 60 * 1000;
    await controller.readDue({ selectedSprintId: 42, shouldApply: () => true });
    assert.equal(reads, 2);
    assert.equal(controller.getState(), held);
    controller.dispose();
});

test('retired automatic catalog response cannot apply, but a late401 remains terminal', async () => {
    for (const authFailure of [false, true]) {
        let release, calls = 0, current = true;
        const controller = createSprintCatalogController({ now: () => Date.parse('2026-09-16T12:00:30Z'), read: async () => {
            calls += 1;
            if (calls === 1) return validatedEnvelope();
            return new Promise(resolve => { release = () => resolve(authFailure ? { httpStatus: 401, error: 'auth_required' } : validatedEnvelope({ sprints: [{ id: 99, name: 'Next' }] })); });
        } });
        await controller.readCurrent();
        const held = controller.getState(), abort = new AbortController();
        const pending = controller.readDue({ selectedSprintId: 42, signal: abort.signal, shouldApply: () => current });
        await Promise.resolve();
        current = false; abort.abort(); release(); await pending;
        if (authFailure) assert.equal(controller.getState().authority, 'auth_locked');
        else assert.equal(controller.getState(), held);
        controller.dispose();
    }
});


test('BFCache catalog invalidation holds selection for display without retaining request authority', async () => {
    let calls = 0;
    const controller = createSprintCatalogController({ initialState: createSprintCatalogState({ savedSprintId: 42 }), read: async () => {
        calls += 1;
        return validatedEnvelope({ sprints: calls === 1 ? [{ id: 42, name: 'Held' }] : [{ id: 99, name: 'Next' }] });
    } });
    await controller.readCurrent();
    controller.invalidate('pagehide', { preserveSelection: true });
    controller.invalidate('pageshow', { preserveSelection: true });
    assert.equal(controller.getState().authority, 'invalid');
    assert.equal(controller.getState().validatedSnapshot, null);
    assert.equal(controller.getState().availableSprints[0].id, 42);
    await controller.readCurrent({ preserveSelection: true, selectedSprintId: 42 });
    assert.equal(controller.getState().authority, 'validated');
    assert.equal(controller.getState().selectedSprintId, 42);
    controller.acceptSource(SOURCE_B);
    assert.equal(controller.getState().selectionPreserved, false);
    assert.equal(controller.getState().availableSprints.length, 0);
    controller.dispose();
});

test('BFCache restore with no selection yet falls back to the normal selection instead of leaving the selector empty', async () => {
    const controller = createSprintCatalogController({ read: async () => validatedEnvelope({ sprints: [{ id: 99, name: 'Next', state: 'active' }] }) });
    controller.invalidate('pageshow', { preserveSelection: true });
    await controller.readCurrent({ preserveSelection: true, selectedSprintId: null });
    assert.equal(controller.getState().authority, 'validated');
    assert.equal(controller.getState().selectedSprintId, 99);
    assert.equal(controller.getState().selectionPreserved, false);
    controller.dispose();
});

test('catalog terminal auth cannot be invalidated or redispatched by pageshow or Refresh', async () => {
    let calls = 0;
    const controller = createSprintCatalogController({ read: async () => { calls += 1; return validatedEnvelope(); } });
    await controller.readCurrent();
    controller.authLock();
    const locked = controller.getState();
    controller.invalidate('pageshow', { preserveSelection: true });
    controller.acceptSource(SOURCE_B);
    await controller.readCurrent();
    await controller.refresh();
    assert.equal(controller.getState(), locked);
    assert.equal(calls, 1);
    controller.dispose();
});


function automaticCatalogClock(read) {
    let clock = Date.parse('2026-09-16T12:00:30Z'), nextId = 0;
    const timers = new Map();
    const controller = createSprintCatalogController({ read, now: () => clock,
        setTimer: (fn, delay) => { timers.set(++nextId, { fn, delay }); return nextId; },
        clearTimer: id => timers.delete(id),
    });
    return { controller, timers, advance: ms => { clock += ms; }, poll: () => {
        const entry = [...timers].find(([, timer]) => timer.delay === 1000);
        assert.ok(entry, 'a current completion owns its polling timer');
        timers.delete(entry[0]); return entry[1].fn();
    } };
}
const pendingCatalogEnvelope = () => validatedEnvelope({ state: 'refreshing', refreshStatus: 'pending', refreshAttemptId: '11111111-1111-4111-8111-111111111111' });

test('retired catalog completion cannot cancel a replacement observer in the same generation', async () => {
    let calls = 0, current = true, releaseOld;
    const fixture = automaticCatalogClock(async () => {
        calls += 1;
        if (calls === 1) return validatedEnvelope();
        if (calls === 3) return new Promise(resolve => { releaseOld = resolve; });
        return pendingCatalogEnvelope();
    });
    await fixture.controller.readCurrent();
    const abort = new AbortController();
    const old = fixture.controller.readDue({ selectedSprintId: 42, signal: abort.signal, shouldApply: () => current });
    await new Promise(resolve => setImmediate(resolve));
    const oldPoll = fixture.poll();
    await new Promise(resolve => setImmediate(resolve));
    current = false; abort.abort(); await old;
    let replacementSettled = false;
    const replacement = fixture.controller.readDue({ selectedSprintId: 42, signal: new AbortController().signal, shouldApply: () => true }).then(() => { replacementSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    releaseOld(validatedEnvelope()); await oldPoll;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replacementSettled, false);
    assert.equal([...fixture.timers.values()].filter(timer => timer.delay === 1000).length, 1);
    fixture.controller.dispose(); await replacement;
    assert.equal(fixture.timers.size, 0);
});

test('catalog completion401 remains terminal at the hard deadline', async () => {
    let calls = 0;
    const fixture = automaticCatalogClock(async () => {
        calls += 1;
        if (calls === 1) return validatedEnvelope();
        if (calls === 2) return pendingCatalogEnvelope();
        fixture.advance(75000);
        return { httpStatus: 401, error: 'auth_required' };
    });
    await fixture.controller.readCurrent();
    const pending = fixture.controller.readDue({ selectedSprintId: 42, signal: new AbortController().signal, shouldApply: () => true });
    await new Promise(resolve => setImmediate(resolve));
    await fixture.poll(); await pending;
    assert.equal(fixture.controller.getState().authority, 'auth_locked');
    assert.equal(fixture.timers.size, 0);
    fixture.controller.dispose();
});
