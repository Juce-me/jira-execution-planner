const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

const ENTRY = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngBoardData.js');

function loadModule() {
    const result = esbuild.buildSync({
        entryPoints: [ENTRY], bundle: true, write: false, platform: 'node', format: 'cjs',
        external: ['react'], loader: { '.js': 'jsx' },
    });
    const mod = new Module(ENTRY, module);
    mod.paths = Module._nodeModulePaths(path.dirname(ENTRY));
    mod._compile(result.outputFiles[0].text, ENTRY);
    return mod.exports;
}

function loadOwnerAndApi() {
    const result = esbuild.buildSync({
        stdin: {
            resolveDir: path.join(__dirname, '..'),
            contents: `export * from './frontend/src/eng/useEngBoardData.js'; export { consumeEngBoardResponse } from './frontend/src/api/engBoardApi.js';`,
            loader: 'jsx',
        },
        bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    });
    const entry = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngBoardData.js');
    const mod = new Module(entry, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entry));
    mod._compile(result.outputFiles[0].text, entry);
    return mod.exports;
}

function loadOwnerAndViewModel() {
    const result = esbuild.buildSync({
        stdin: {
            resolveDir: path.join(__dirname, '..'),
            contents: `export * from './frontend/src/eng/useEngBoardData.js'; export { buildStrictEngBoardViewModel } from './frontend/src/eng/engBoardViewModel.js';`,
            loader: 'jsx',
        },
        bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    });
    const entry = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngBoardData.js');
    const mod = new Module(entry, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entry));
    mod._compile(result.outputFiles[0].text, entry);
    return mod.exports;
}

function loadOwnerAndPerformance() {
    const result = esbuild.buildSync({
        stdin: {
            resolveDir: path.join(__dirname, '..'),
            contents: `export * from './frontend/src/eng/useEngBoardData.js'; export { createBoardLoadMeasurement } from './frontend/src/eng/loadPerformance.js';`,
            loader: 'jsx',
        },
        bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    });
    const entry = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngBoardData.js');
    const mod = new Module(entry, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entry));
    mod._compile(result.outputFiles[0].text, entry);
    return mod.exports;
}

function epic(key, columnId = 'todo') {
    return { key, columnId, summary: key, status: { id: '1', name: 'Todo' } };
}

function child(key, epicKey) {
    return { key, epicKey, summary: key, status: { id: '1', name: 'Todo' } };
}

function frame(generationId, sequence, type, fields = {}) {
    return { protocolVersion: 1, generationId, sequence, type, ...fields };
}

function start(generationId, scopeVersion = 'scope-v1', columnIds = ['todo']) {
    return frame(generationId, 0, 'start', {
        scope: 'sprint', scopeVersion, scopeCohortDigest: 'a'.repeat(64),
        columns: columnIds.map(id => ({ id, name: id, color: '#fff', statusNames: [id], terminal: false })),
    });
}

function reduce(mod, state, action) {
    return mod.engBoardDataReducer(state, action);
}

function wireEpic(key, columnId = 'todo') {
    return {
        key, summary: key, status: { id: '1', name: 'Todo' }, priority: null,
        assignee: null, deliveryOwner: null, projectTrack: 'product', updated: null,
        parent: null, columnId,
    };
}

function wireDiagnostics(completeness = 'complete') {
    return {
        indexMs: 1, focusedCompleteMs: 2, durationMs: 3, jiraRequests: 1,
        jiraPages: 1, jiraRetries: 0, peakChildSearches: 1, cacheState: 'miss', completeness,
    };
}

function bufferedBoardResponse(frames) {
    const text = frames.map(value => `${JSON.stringify(value)}\n`).join('');
    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function byteLimitTerminalResponse() {
    return bufferedBoardResponse([
        { ...start('byte-limit'), scope: 'component' },
        frame('byte-limit', 1, 'index', { epics: [wireEpic('ABC-1')], membership: 'candidate' }),
        frame('byte-limit', 2, 'error', { code: 'scope_too_large' }),
    ]);
}

test('first visit inherits the mandatory sprint once and each Department keeps independent scope', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    assert.deepEqual(state.scopesByGroup.a, { type: 'sprint', sprintId: 42 });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'select_group', groupId: 'b', inheritedSprintId: 77, revision: 'r1' });
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 99, revision: 'r1' });
    assert.deepEqual(state.scopesByGroup, {
        a: { type: 'all_work' }, b: { type: 'sprint', sprintId: 77 },
    });
});

test('missing first-visit sprint stays uninitialized and is not mistaken for All work', async () => {
    const mod = loadModule();
    let calls = 0;
    const owner = mod.createEngBoardDataOwner({ streamBoard: async () => { calls += 1; } });
    owner.selectGroup('a', null, 'r1');
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'uninitialized' });
    assert.equal(await owner.load(), 'uninitialized');
    assert.equal(calls, 0);
});

test('delayed first valid sprint initializes once and starts exactly one Board stream', async () => {
    const mod = loadModule();
    const calls = [];
    const owner = mod.createEngBoardDataOwner({
        streamBoard: async options => {
            calls.push(options);
            options.onFrame(start('g1'));
            options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'candidate' }));
            options.onFrame(frame('g1', 2, 'column', {
                columnId: 'todo', epics: [], children: [], authoritative: true,
            }));
            options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
            }));
        },
    });

    owner.selectGroup('a', null, 'r1');
    assert.equal(await owner.load(), 'uninitialized');
    assert.equal(calls.length, 0);

    const changed = owner.selectGroup('a', 42, 'r1');
    assert.equal(changed, true);
    assert.equal(await owner.load(), 'success');
    assert.equal(calls.length, 1);
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'sprint', sprintId: 42 });
    assert.equal(calls[0].departmentId, 'a');
    assert.equal(calls[0].scope, 'sprint');
    assert.equal(calls[0].sprintId, 42);

    const loaded = owner.getState();
    assert.equal(owner.selectGroup('a', 42, 'r1'), false);
    assert.equal(owner.selectGroup('a', 99, 'r1'), false);
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'sprint', sprintId: 42 });
    assert.equal(owner.getState().activeKey, loaded.activeKey);
    assert.equal(owner.getState().requestId, loaded.requestId);
    assert.equal(owner.getState().working, loaded.working);
    assert.equal(calls.length, 1);

    owner.selectGroup('b', null, 'r1');
    assert.equal(await owner.load(), 'uninitialized');
    assert.equal(owner.selectGroup('b', 77, 'r1'), true);
    assert.deepEqual(owner.getState().scopesByGroup, {
        a: { type: 'sprint', sprintId: 42 }, b: { type: 'sprint', sprintId: 77 },
    });
    owner.selectGroup('a', 100, 'r1');
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'sprint', sprintId: 42 });
    assert.equal(calls.length, 1);
});

test('explicit All work survives a later successful sprint catalog', async () => {
    const mod = loadModule();
    const calls = [];
    const owner = mod.createEngBoardDataOwner({
        streamBoard: async options => {
            calls.push(options);
            options.onFrame({ ...start('g1'), scope: 'all_work' });
            options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'authoritative' }));
            options.onFrame(frame('g1', 2, 'column', {
                columnId: 'todo', epics: [], children: [], authoritative: true,
            }));
            options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
            }));
        },
    });

    owner.selectGroup('a', null, 'r1');
    assert.equal(await owner.setScope({ type: 'all_work' }), 'success');
    const loaded = owner.getState();
    assert.equal(owner.selectGroup('a', 42, 'r1'), false);
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'all_work' });
    assert.equal(owner.getState().activeKey, loaded.activeKey);
    assert.equal(owner.getState().requestId, loaded.requestId);
    assert.equal(owner.getState().working, loaded.working);
    assert.equal(calls.length, 1);
});

test('Component scope is retained and requests an authoritative no-sprint stream', async () => {
    const mod = loadModule();
    const calls = [];
    const owner = mod.createEngBoardDataOwner({
        streamBoard: async options => {
            calls.push(options);
            options.onFrame({ ...start('g1'), scope: 'component' });
            options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'authoritative' }));
            options.onFrame(frame('g1', 2, 'column', {
                columnId: 'todo', epics: [], children: [], authoritative: true,
            }));
            options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
            }));
        },
    });

    owner.selectGroup('a', 42, 'r1');
    assert.equal(await owner.setScope({ type: 'component' }), 'success');
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'component' });
    assert.equal(calls[0].scope, 'component');
    assert.equal(calls[0].sprintId, undefined);
    assert.equal(owner.getState().working.membershipAuthoritative, true);
});

test('late frames from an old request or generation cannot publish into the active load', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('old') });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: start('new') });
    const unchanged = reduce(mod, state, {
        type: 'frame', requestId: 1,
        frame: frame('old', 1, 'index', { epics: [epic('OLD-1')], membership: 'authoritative' }),
    });
    assert.equal(unchanged, state);
    assert.deepEqual(unchanged.working.epicsByKey, {});
});

test('index Epics must reference a column declared by start', async t => {
    const mod = loadModule();
    for (const membership of ['candidate', 'authoritative']) {
        await t.test(membership, () => {
            let state = mod.createEngBoardDataState();
            state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
            state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
            state = reduce(mod, state, {
                type: 'frame', requestId: 1, frame: start('g1', 'scope-v1', ['board-unconfigured']),
            });
            state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
                epics: [epic('E-1', 'board-unmapped')], membership,
            }) });
            assert.equal(state.error?.code, 'invalid_frame');
        });
    }
});

test('column-frame Epics must reference the column carrying the frame', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, {
        type: 'frame', requestId: 1, frame: start('g1', 'scope-v1', ['todo', 'done']),
    });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('E-1', 'todo')], membership: 'candidate',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [epic('E-1', 'done')], children: [], authoritative: true,
    }) });
    assert.equal(state.error?.code, 'invalid_frame');
});

test('synthetic absent Board completes through its declared board-unconfigured column', async () => {
    const mod = loadModule();
    const owner = mod.createEngBoardDataOwner({
        streamBoard: async options => {
            options.onFrame(start('g1', 'scope-v1', ['board-unconfigured']));
            options.onFrame(frame('g1', 1, 'index', {
                epics: [epic('E-1', 'board-unconfigured')], membership: 'candidate',
            }));
            options.onFrame(frame('g1', 2, 'column', {
                columnId: 'board-unconfigured',
                epics: [epic('E-1', 'board-unconfigured')],
                children: [child('C-1', 'E-1')],
                authoritative: true,
            }));
            options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {},
            }));
        },
    });

    owner.selectGroup('a', 42, 'r1');
    assert.equal(await owner.load(), 'success');
    assert.equal(owner.getState().status, 'success');
    assert.deepEqual(owner.getState().working.columnEpicKeys, { 'board-unconfigured': ['E-1'] });
    assert.deepEqual(Object.keys(owner.getState().working.childrenByKey), ['C-1']);
});

test('changing Department invalidates the old request before its next frame', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
    state = reduce(mod, state, { type: 'select_group', groupId: 'b', inheritedSprintId: 77, revision: 'r1' });
    assert.equal(state.requestId, null);
    const unchanged = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('LATE')], membership: 'authoritative',
    }) });
    assert.equal(unchanged, state);
});

test('provisional progress is separate and a successful sprint generation reconciles membership atomically', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('E-1'), epic('E-NO-CHILD')], membership: 'candidate',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'progress', {
        columnId: 'todo', loadedChildren: 1,
        byEpic: [{ epicKey: 'E-1', loadedChildren: 1, statusCounts: { Todo: 1 } }],
    }) });
    assert.equal(state.working.membershipAuthoritative, false);
    assert.equal(state.working.childrenAuthoritative, false);
    assert.equal(state.working.progressByColumn.todo.loadedChildren, 1);
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'column', {
        columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 4, 'complete', {
        outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {},
    }) });
    assert.equal(state.status, 'success');
    assert.equal(state.working.membershipAuthoritative, true);
    assert.equal(state.working.childrenAuthoritative, true);
    assert.deepEqual(Object.keys(state.working.epicsByKey), ['E-1']);
    assert.deepEqual(state.working.progressByColumn, {});
});

test('column errors preserve other authoritative columns without granting global child authority', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1', 'scope-v1', ['todo', 'done']), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('E-1'), epic('E-NO-CHILD')], membership: 'authoritative',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'column_error', {
        columnId: 'done', code: 'jira_unavailable', retryable: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 4, 'complete', {
        outcome: 'partial_error', authoritative: false, failedColumnIds: ['done'], diagnostics: {},
    }) });
    assert.equal(state.status, 'partial_error');
    assert.equal(state.working.membershipAuthoritative, true);
    assert.equal(state.working.childrenAuthoritative, false);
    assert.equal(state.working.columnAuthority.todo, true);
    assert.equal(state.working.columnErrors.done.code, 'jira_unavailable');
    assert.deepEqual(state.working.columnEpicKeys.todo, ['E-1', 'E-NO-CHILD']);
    assert.equal(Object.hasOwn(state.working.childrenByKey['C-1'], '__boardColumnId'), false);
});

test('compatible refresh failure retains a stale complete snapshot but clears new provisional authority', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('E-1')], membership: 'candidate',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', {
        outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {},
    }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    assert.equal(state.staleSnapshot.stale, true);
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: start('g2') });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'progress', {
        columnId: 'todo', loadedChildren: 9, byEpic: [],
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 2, 'error', { code: 'jira_unavailable' }) });
    assert.equal(state.status, 'error');
    assert.deepEqual(Object.keys(state.staleSnapshot.epicsByKey), ['E-1']);
    assert.deepEqual(state.working.progressByColumn, {});
    assert.equal(state.working.childrenAuthoritative, false);
});

test('scope-version or group-revision changes discard incompatible stale snapshots', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [], membership: 'candidate',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [], children: [], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', {
        outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
    }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: start('g2', 'scope-v2') });
    assert.equal(state.staleSnapshot, null);
    state = reduce(mod, state, { type: 'group_revision_changed', groupId: 'a', revision: 'r2' });
    assert.equal(state.status, 'idle');
    assert.deepEqual(state.snapshots, {});
});

test('scope_changed clears the active compatible snapshot instead of offering it on retry', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [], membership: 'candidate' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [], children: [], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', {
        outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
    }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: start('g2') });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'error', { code: 'scope_changed' }) });
    assert.equal(state.staleSnapshot, null);
    assert.equal(state.snapshots[state.activeKey], undefined);
});

test('success is rejected unless index, declared columns, and canonical counts are complete', async t => {
    const mod = loadModule();
    const setup = (columns = ['todo']) => {
        let state = mod.createEngBoardDataState();
        state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
        state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
        return reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1', 'scope-v1', columns) });
    };
    const apply = (state, nextFrame) => reduce(mod, state, { type: 'frame', requestId: 1, frame: nextFrame });

    await t.test('missing index', () => {
        let state = setup();
        state = apply(state, frame('g1', 1, 'column', { columnId: 'todo', epics: [], children: [], authoritative: true }));
        state = apply(state, frame('g1', 2, 'complete', { outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {} }));
        assert.equal(state.error.code, 'invalid_frame');
    });
    await t.test('missing declared column', () => {
        let state = setup(['todo', 'done']);
        state = apply(state, frame('g1', 1, 'index', { epics: [], membership: 'candidate' }));
        state = apply(state, frame('g1', 2, 'column', { columnId: 'todo', epics: [], children: [], authoritative: true }));
        state = apply(state, frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {} }));
        assert.equal(state.error.code, 'invalid_frame');
    });
    await t.test('wrong canonical count', () => {
        let state = setup();
        state = apply(state, frame('g1', 1, 'index', { epics: [epic('E-1')], membership: 'candidate' }));
        state = apply(state, frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true }));
        state = apply(state, frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 0, diagnostics: {} }));
        assert.equal(state.error.code, 'invalid_frame');
    });
});

test('unknown and duplicate column frames fail the generation', async t => {
    const mod = loadModule();
    const setup = () => {
        let state = mod.createEngBoardDataState();
        state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
        state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
        return reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [], membership: 'candidate' }) });
    };
    await t.test('unknown', () => {
        const state = reduce(mod, setup(), { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
            columnId: 'unknown', epics: [], children: [], authoritative: true,
        }) });
        assert.equal(state.error.code, 'invalid_frame');
    });
    await t.test('duplicate', () => {
        let state = reduce(mod, setup(), { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
            columnId: 'todo', epics: [], children: [], authoritative: true,
        }) });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'column', {
            columnId: 'todo', epics: [], children: [], authoritative: true,
        }) });
        assert.equal(state.error.code, 'invalid_frame');
    });
});

test('start scope must match the requested scope', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, {
        type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' },
    });
    assert.equal(state.error.code, 'invalid_frame');
    assert.equal(state.working.membershipAuthoritative, false);
});

test('All work success requires an authoritative index', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [], membership: 'candidate',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [], children: [], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', {
        outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
    }) });
    assert.equal(state.error.code, 'invalid_frame');
    assert.equal(state.working.membershipAuthoritative, false);
});

test('auth lock preserves mounted state and makes subsequent frames inert', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'error', { code: 'auth_required' }) });
    assert.equal(state.authLocked, true);
    assert.equal(state.status, 'auth_locked');
    const locked = state;
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'index', {
        epics: [epic('LATE')], membership: 'authoritative',
    }) });
    assert.equal(state, locked);
});

test('retirement and Strict Effects remount cancel work without destroying the mounted session', async () => {
    const mod = loadModule();
    const streams = [];
    const owner = mod.createEngBoardDataOwner({
        streamBoard: options => new Promise((resolve, reject) => streams.push({ options, resolve, reject })),
    });
    owner.selectGroup('a', 42, 'r1');
    const first = owner.load();
    streams[0].options.onFrame(start('g1'));
    owner.retire();
    assert.equal(streams[0].options.signal.aborted, true);
    assert.equal(owner.getState().status, 'idle');
    owner.dispose();
    assert.equal(owner.getState().mounted, false);
    owner.mount();
    assert.equal(owner.getState().mounted, true);
    assert.deepEqual(owner.getState().scopesByGroup.a, { type: 'sprint', sprintId: 42 });
    const second = owner.load();
    assert.equal(streams.length, 2);
    streams[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    owner.dispose();
    streams[1].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await Promise.all([first, second]);
});

test('focus changes stay local until retry creates one replacement request with current focus', async () => {
    const mod = loadModule();
    const streams = [];
    const owner = mod.createEngBoardDataOwner({
        streamBoard: options => new Promise((resolve, reject) => streams.push({ options, resolve, reject })),
    });
    owner.selectGroup('a', 42, 'r1');
    const first = owner.load();
    streams[0].options.onFrame(start('g1'));
    owner.setResolvedFocus('todo');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(streams.length, 1, 'focus must not start or control another request');
    const retry = owner.retry();
    assert.equal(streams.length, 2);
    assert.equal(streams[0].options.signal.aborted, true);
    assert.equal(streams[1].options.focusedColumnId, 'todo');
    owner.dispose();
    assert.equal(streams[1].options.signal.aborted, true);
    streams[1].options.onFrame(start('late'));
    assert.equal(owner.getState().mounted, false);
    streams[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    streams[1].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await Promise.all([first, retry]);
});

test('Board owner records one terminal measurement after focused content and counts wire bytes', async () => {
    const mod = loadModule();
    const calls = [];
    const recorder = {
        start: value => calls.push(['start', value.type]),
        addPayloadBytes: value => calls.push(['bytes', value]),
        focusedContentReady: () => calls.push(['focused']),
        finish: value => calls.push(['finish', value]),
        cancel: () => calls.push(['cancel']),
    };
    const owner = mod.createEngBoardDataOwner({
        createMeasurement: options => {
            calls.push(['create', options]);
            return recorder;
        },
        streamBoard: async options => {
            options.onFrame(start('g1', 'scope-v1', ['todo']), { payloadBytes: 101 });
            options.onFrame(frame('g1', 1, 'index', {
                epics: [epic('E-1')], membership: 'authoritative',
            }), { payloadBytes: 102 });
            options.onFrame(frame('g1', 2, 'column', {
                columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true,
            }), { payloadBytes: 103 });
            options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 1, childCount: 1,
                diagnostics: { indexMs: 10, focusedCompleteMs: 20, durationMs: 30 },
            }), { payloadBytes: 104 });
        },
    });
    owner.selectGroup('a', 42, 'r1');
    owner.setResolvedFocus('todo');
    assert.equal(await owner.load(), 'success');

    assert.deepEqual(calls[0], ['create', { groupId: 'a', scopeType: 'sprint', sprintId: 42 }]);
    assert.deepEqual(calls.filter(call => call[0] === 'bytes').map(call => call[1]), [101, 102, 103, 104]);
    assert.equal(calls.filter(call => call[0] === 'start').length, 1);
    assert.equal(calls.filter(call => call[0] === 'focused').length, 1);
    const finishes = calls.filter(call => call[0] === 'finish');
    assert.equal(finishes.length, 1);
    assert.deepEqual(finishes[0][1], {
        outcome: 'success',
        diagnostics: { indexMs: 10, focusedCompleteMs: 20, durationMs: 30 },
        epicCount: 1,
        issueCount: 1,
        dependencyDurationMs: null,
    });
    assert.equal(calls.filter(call => call[0] === 'cancel').length, 0);
});

test('replacing a Board stream cancels only the retired measurement', async () => {
    const mod = loadModule();
    const measurements = [];
    const streams = [];
    const owner = mod.createEngBoardDataOwner({
        createMeasurement: () => {
            const calls = [];
            measurements.push(calls);
            return {
                start: () => calls.push('start'), addPayloadBytes: () => {},
                focusedContentReady: () => {}, finish: () => calls.push('finish'),
                cancel: () => calls.push('cancel'),
            };
        },
        streamBoard: options => new Promise(resolve => streams.push({ options, resolve })),
    });
    owner.selectGroup('a', 42, 'r1');
    const first = owner.load();
    const second = owner.refresh();
    assert.deepEqual(measurements[0], ['cancel']);
    streams[0].resolve();
    streams[1].resolve();
    await Promise.all([first, second]);
    assert.equal(measurements[0].filter(value => value === 'finish').length, 0);
});

test('availability failure retains loaded epic index without granting child authority', () => {
    const mod = loadModule();
    for (const code of ['deadline_exceeded', 'jira_unavailable', 'unexpected_eof']) {
        let state = mod.createEngBoardDataState();
        state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42 });
        state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
        state = reduce(mod, state, { type: 'start_load', requestId: 1 });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
            epics: [epic('E-1')], membership: 'authoritative',
        }) });
        state = reduce(mod, state, { type: 'load_failed', requestId: 1, code });
        assert.equal(state.working.epicsByKey['E-1']?.key, 'E-1', code);
        assert.equal(state.working.childrenAuthoritative, false);
        assert.equal(state.status, 'error');
    }
});

test('cumulative component candidate indexes are replaced by the complete All work union', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42 });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1 });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    for (const [sequence, membership, epics] of [
        [1, 'candidate', [epic('E-1')]],
        [2, 'candidate', [epic('E-1'), epic('E-2')]],
        [3, 'authoritative', [epic('E-1'), epic('E-2'), epic('E-3')]],
    ]) {
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', sequence, 'index', { epics, membership }) });
    }
    assert.equal(state.status, 'loading');
    assert.equal(state.working.membershipAuthoritative, true);
    assert.deepEqual(Object.keys(state.working.epicsByKey), ['E-1', 'E-2', 'E-3']);
});

test('scope_too_large retains cold All work candidates without granting authority or caching', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('E-1')], membership: 'candidate',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'error', { code: 'scope_too_large' }) });

    assert.equal(state.status, 'error');
    assert.equal(state.error.code, 'scope_too_large');
    assert.equal(state.working.candidateEpicsByKey['E-1']?.key, 'E-1');
    assert.equal(state.working.membershipAuthoritative, false);
    assert.equal(state.working.childrenAuthoritative, false);
    assert.equal(state.snapshots[state.activeKey], undefined);
});

test('scope_too_large retains authoritative index and completed columns as partial working data', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1', 'scope-v1', ['todo', 'done']), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
        epics: [epic('E-1')], membership: 'authoritative',
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', {
        columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true,
    }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'error', { code: 'scope_too_large' }) });

    assert.equal(state.status, 'error');
    assert.equal(state.working.epicsByKey['E-1']?.key, 'E-1');
    assert.equal(state.working.childrenByKey['C-1']?.key, 'C-1');
    assert.equal(state.working.columnAuthority.todo, true);
    assert.equal(state.working.childrenAuthoritative, false);
    assert.equal(state.snapshots[state.activeKey], undefined);
});

test('compatible refresh hard limit retains the complete stale snapshot and keeps partial work separate', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1, refresh: false });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('E-1')], membership: 'authoritative' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {} }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: { ...start('g2'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'index', { epics: [epic('E-1'), epic('E-2')], membership: 'candidate' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 2, 'error', { code: 'scope_too_large' }) });

    assert.equal(state.status, 'error');
    assert.equal(state.error.code, 'scope_too_large');
    assert.deepEqual(Object.keys(state.staleSnapshot.epicsByKey), ['E-1']);
    assert.deepEqual(Object.keys(state.staleSnapshot.childrenByKey), ['C-1']);
    assert.deepEqual(Object.keys(state.working.candidateEpicsByKey), ['E-1', 'E-2']);
    assert.equal(state.snapshots[state.activeKey].epicsByKey['E-2'], undefined);
    assert.equal(state.working.childrenAuthoritative, false);
});

test('compatible retry success atomically replaces the stale snapshot after a hard limit', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1 });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('E-1')], membership: 'authoritative' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('E-1')], children: [child('C-1', 'E-1')], authoritative: true }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {} }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: { ...start('g2'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'index', { epics: [epic('E-1'), epic('E-2')], membership: 'candidate' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 2, 'error', { code: 'scope_too_large' }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 3, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 3, frame: { ...start('g3'), scope: 'all_work' } });
    assert.deepEqual(Object.keys(state.staleSnapshot.epicsByKey), ['E-1']);
    state = reduce(mod, state, { type: 'frame', requestId: 3, frame: frame('g3', 1, 'index', { epics: [epic('E-2')], membership: 'authoritative' }) });
    assert.deepEqual(Object.keys((state.staleSnapshot || state.working).epicsByKey), ['E-1']);
    assert.deepEqual(Object.keys(state.snapshots[state.activeKey].epicsByKey), ['E-1']);
    assert.deepEqual(Object.keys(state.working.epicsByKey), ['E-2']);
    state = reduce(mod, state, { type: 'frame', requestId: 3, frame: frame('g3', 2, 'column', { columnId: 'todo', epics: [epic('E-2')], children: [child('C-2', 'E-2')], authoritative: true }) });
    assert.deepEqual(Object.keys((state.staleSnapshot || state.working).epicsByKey), ['E-1']);
    assert.deepEqual(Object.keys((state.staleSnapshot || state.working).childrenByKey), ['C-1']);
    assert.deepEqual(Object.keys(state.snapshots[state.activeKey].epicsByKey), ['E-1']);
    assert.deepEqual(Object.keys(state.working.epicsByKey), ['E-2']);
    assert.deepEqual(Object.keys(state.working.childrenByKey), ['C-2']);
    state = reduce(mod, state, { type: 'frame', requestId: 3, frame: frame('g3', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {} }) });
    assert.equal(state.status, 'success');
    assert.equal(state.staleSnapshot, null);
    assert.deepEqual(Object.keys(state.snapshots[state.activeKey].epicsByKey), ['E-2']);
    assert.deepEqual(Object.keys(state.snapshots[state.activeKey].childrenByKey), ['C-2']);
});

test('retry after a cold hard limit replaces partial data only after complete success', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1 });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('OLD')], membership: 'candidate' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'error', { code: 'scope_too_large' }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2 });
    assert.equal(state.working.candidateEpicsByKey.OLD, undefined);
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: { ...start('g2'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'index', { epics: [epic('NEW')], membership: 'authoritative' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 2, 'column', { columnId: 'todo', epics: [epic('NEW')], children: [], authoritative: true }) });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 0, diagnostics: {} }) });
    assert.equal(state.status, 'success');
    assert.deepEqual(Object.keys(state.snapshots[state.activeKey].epicsByKey), ['NEW']);
});

test('incompatible scope version drops the old snapshot before retaining new partial candidates', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1 });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('OLD')], membership: 'authoritative' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('OLD')], children: [], authoritative: true }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 0, diagnostics: {} }) });
    state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: { ...start('g2', 'scope-v2'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'index', { epics: [epic('NEW')], membership: 'candidate' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 2, 'error', { code: 'scope_too_large' }) });
    assert.equal(state.status, 'error');
    assert.equal(state.error.code, 'scope_too_large');
    assert.equal(state.staleSnapshot, null);
    assert.equal(state.snapshots[state.activeKey], undefined);
    assert.deepEqual(Object.keys(state.working.candidateEpicsByKey), ['NEW']);
});

test('cross-sprint column authority is rejected until All work membership is final', () => {
    const mod = loadModule();
    let state = mod.createEngBoardDataState();
    state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
    state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
    state = reduce(mod, state, { type: 'start_load', requestId: 1 });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('E-1')], membership: 'candidate' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('E-1')], children: [], authoritative: true }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'index', { epics: [epic('E-1'), epic('E-2')], membership: 'authoritative' }) });
    state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 4, 'complete', { outcome: 'success', authoritative: true, epicCount: 2, childCount: 0, diagnostics: {} }) });
    assert.equal(state.status, 'error');
    assert.equal(state.error.code, 'invalid_frame');
    assert.equal(state.snapshots[state.activeKey], undefined);
});

test('cross-sprint child frames require authoritative membership while Sprint keeps legacy ordering', async t => {
    const mod = loadModule();
    const childFrames = [
        ['progress', { columnId: 'todo', loadedChildren: 1, byEpic: [] }],
        ['column', { columnId: 'todo', epics: [epic('E-1')], children: [], authoritative: true }],
        ['column_error', { columnId: 'todo', code: 'jira_unavailable', retryable: true }],
    ];
    for (const scopeType of ['all_work', 'component']) {
        for (const [type, fields] of childFrames) {
            await t.test(`${scopeType} rejects ${type} after only a candidate index`, () => {
                let state = mod.createEngBoardDataState();
                state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
                state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: scopeType } });
                state = reduce(mod, state, { type: 'start_load', requestId: 1 });
                state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: scopeType } });
                state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', {
                    epics: [epic('E-1')], membership: 'candidate',
                }) });
                state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, type, fields) });
                assert.equal(state.status, 'error');
                assert.equal(state.error.code, 'invalid_frame');
            });
        }
    }
    await t.test('Sprint still accepts progress before an index', () => {
        let state = mod.createEngBoardDataState();
        state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
        state = reduce(mod, state, { type: 'start_load', requestId: 1 });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: start('g1') });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'progress', {
            columnId: 'todo', loadedChildren: 1, byEpic: [],
        }) });
        assert.equal(state.status, 'loading');
        assert.equal(state.working.progressByColumn.todo.loadedChildren, 1);
    });
});

test('owner display source gives the view model cold partial cards but keeps compatible stale authority', () => {
    const mod = loadOwnerAndViewModel();
    const buildState = ({ stale }) => {
        let state = mod.createEngBoardDataState();
        state = reduce(mod, state, { type: 'select_group', groupId: 'a', inheritedSprintId: 42, revision: 'r1' });
        state = reduce(mod, state, { type: 'set_scope', groupId: 'a', scope: { type: 'all_work' } });
        state = reduce(mod, state, { type: 'start_load', requestId: 1 });
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: { ...start('g1'), scope: 'all_work' } });
        if (stale) {
            state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('OLD')], membership: 'authoritative' }) });
            state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('OLD')], children: [child('OLD-1', 'OLD')], authoritative: true }) });
            state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 1, diagnostics: {} }) });
            state = reduce(mod, state, { type: 'start_load', requestId: 2, refresh: true });
            state = reduce(mod, state, { type: 'frame', requestId: 2, frame: { ...start('g2'), scope: 'all_work' } });
            state = reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 1, 'index', { epics: [epic('NEW')], membership: 'candidate' }) });
            return reduce(mod, state, { type: 'frame', requestId: 2, frame: frame('g2', 2, 'error', { code: 'scope_too_large' }) });
        }
        state = reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 1, 'index', { epics: [epic('NEW')], membership: 'candidate' }) });
        return reduce(mod, state, { type: 'frame', requestId: 1, frame: frame('g1', 2, 'error', { code: 'scope_too_large' }) });
    };

    const coldState = buildState({ stale: false });
    const coldModel = mod.buildStrictEngBoardViewModel(coldState.staleSnapshot || coldState.working);
    assert.deepEqual(coldModel.epicGroups.map(group => group.key), ['NEW']);
    assert.equal(coldModel.authoritative, false);
    assert.equal(coldModel.childrenAuthoritative, false);

    const staleState = buildState({ stale: true });
    const staleModel = mod.buildStrictEngBoardViewModel(staleState.staleSnapshot || staleState.working);
    assert.deepEqual(staleModel.epicGroups.map(group => group.key), ['OLD']);
    assert.equal(staleModel.authoritative, true);
    assert.equal(staleModel.childrenAuthoritative, true);
});

test('buffered parser frames reduce through the owner while focused telemetry is unresolved', async () => {
    const mod = loadOwnerAndApi();
    let release;
    const focused = new Promise(resolve => { release = resolve; });
    const frames = [
        { ...start('g1'), scope: 'all_work' },
        frame('g1', 1, 'index', { epics: [wireEpic('E-1')], membership: 'authoritative' }),
        frame('g1', 2, 'column', { columnId: 'todo', epics: [wireEpic('E-1')], children: [], authoritative: true }),
        frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 0, diagnostics: wireDiagnostics() }),
    ];
    const owner = mod.createEngBoardDataOwner({
        createMeasurement: () => ({
            start() {}, addPayloadBytes() {}, focusedContentReady: () => focused,
            finish() {}, cancel() {},
        }),
        streamBoard: options => mod.consumeEngBoardResponse(bufferedBoardResponse(frames), options),
    });
    owner.selectGroup('a', 42, 'r1');
    const loading = owner.setScope({ type: 'all_work' });
    let observedStatus;
    try {
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        observedStatus = owner.getState().status;
    } finally {
        release();
        await loading;
    }
    assert.equal(observedStatus, 'success');
});

test('parseable byte-limit terminal reduces through the owner and retains its candidate', async () => {
    const mod = loadOwnerAndApi();
    const response = byteLimitTerminalResponse();
    const owner = mod.createEngBoardDataOwner({
        streamBoard: options => mod.consumeEngBoardResponse(response, options),
    });
    owner.selectGroup('a', 42, 'r1');
    assert.equal(await owner.setScope({ type: 'component' }), 'error');
    const state = owner.getState();
    assert.equal(state.status, 'error');
    assert.equal(state.error.code, 'scope_too_large');
    assert.deepEqual(Object.keys(state.working.candidateEpicsByKey), ['ABC-1']);
    assert.equal(state.working.childrenAuthoritative, false);
    assert.equal(state.snapshots[state.activeKey], undefined);
});

test('optional Board measurement throws and rejections never become data failures', async t => {
    const mod = loadModule();
    const cases = [
        ['start throws', { start: () => { throw new Error('telemetry'); } }],
        ['payload throws', { addPayloadBytes: () => { throw new Error('telemetry'); } }],
        ['focused rejects', { focusedContentReady: () => Promise.reject(new Error('telemetry')) }],
        ['finish rejects', { finish: () => Promise.reject(new Error('telemetry')) }],
    ];
    for (const [name, failing] of cases) {
        await t.test(name, async () => {
            const measurement = {
                start() {}, addPayloadBytes() {}, focusedContentReady() {}, finish() {}, cancel() {},
                ...failing,
            };
            const owner = mod.createEngBoardDataOwner({
                createMeasurement: () => measurement,
                streamBoard: async options => {
                    await options.onFrame(start('g1'));
                    await options.onFrame(frame('g1', 1, 'index', { epics: [epic('E-1')], membership: 'candidate' }));
                    await options.onFrame(frame('g1', 2, 'column', { columnId: 'todo', epics: [epic('E-1')], children: [], authoritative: true }));
                    await options.onFrame(frame('g1', 3, 'complete', { outcome: 'success', authoritative: true, epicCount: 1, childCount: 0, diagnostics: {} }));
                },
            });
            owner.selectGroup('a', 42, 'r1');
            assert.equal(await owner.load(), 'success');
            assert.equal(owner.getState().status, 'success');
        });
    }
});

test('a held terminal observer finishes once and cannot interfere with a newer request', async () => {
    const mod = loadModule();
    const streams = [];
    const calls = [];
    let releaseFinish;
    const heldFinish = new Promise(resolve => { releaseFinish = resolve; });
    const owner = mod.createEngBoardDataOwner({
        createMeasurement: () => {
            const id = calls.filter(call => call[0] === 'create').length + 1;
            calls.push(['create', id]);
            return {
                start() {}, addPayloadBytes() {}, focusedContentReady() {},
                finish: () => {
                    calls.push(['finish', id]);
                    return id === 1 ? heldFinish : undefined;
                },
                cancel: () => calls.push(['cancel', id]),
            };
        },
        streamBoard: options => new Promise(resolve => streams.push({ options, resolve })),
    });
    owner.selectGroup('a', 42, 'r1');
    const first = owner.load();
    await streams[0].options.onFrame(start('g1'));
    await streams[0].options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'authoritative' }));
    await streams[0].options.onFrame(frame('g1', 2, 'column', { columnId: 'todo', epics: [], children: [], authoritative: true }));
    const terminalObservation = streams[0].options.onFrame(frame('g1', 3, 'complete', {
        outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(owner.getState().status, 'success');

    const second = owner.refresh();
    assert.deepEqual(calls.filter(call => call[0] === 'finish'), [['finish', 1]]);
    assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', 1]]);
    releaseFinish();
    await terminalObservation;
    await new Promise(resolve => setImmediate(resolve));
    await streams[1].options.onFrame(start('g2'));
    assert.equal(owner.getState().generationId, 'g2');

    owner.dispose();
    streams[0].resolve();
    streams[1].resolve();
    await Promise.all([first, second]);
    assert.deepEqual(calls.filter(call => call[0] === 'finish'), [['finish', 1]]);
    assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', 1], ['cancel', 2]]);
});

test('held cancellation and late observer rejection cannot affect replacement or leak unhandled rejection', async () => {
    const mod = loadModule();
    const streams = [];
    const calls = [];
    let rejectCancel;
    const heldCancel = new Promise((resolve, reject) => { rejectCancel = reject; });
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const owner = mod.createEngBoardDataOwner({
        createMeasurement: () => {
            const id = calls.filter(call => call[0] === 'create').length + 1;
            calls.push(['create', id]);
            return {
                start() {}, addPayloadBytes() {}, focusedContentReady() {}, finish() {},
                cancel: () => {
                    calls.push(['cancel', id]);
                    return id === 1 ? heldCancel : undefined;
                },
            };
        },
        streamBoard: options => new Promise((resolve, reject) => streams.push({ options, resolve, reject })),
    });
    try {
        owner.selectGroup('a', 42, 'r1');
        const first = owner.load();
        const second = owner.refresh();
        assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', 1]]);
        rejectCancel(new Error('late optional cancellation'));
        await new Promise(resolve => setImmediate(resolve));
        await streams[1].options.onFrame(start('g2'));
        assert.equal(owner.getState().generationId, 'g2');
        assert.deepEqual(unhandled, []);
        streams[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        owner.dispose();
        streams[1].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        await Promise.all([first, second]);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('auth lock and unmount retire measurements without emitting terminal samples', async t => {
    const mod = loadModule();
    for (const mode of ['auth frame', 'auth throw', 'unmount']) {
        await t.test(mode, async () => {
            const calls = [];
            let stream;
            const owner = mod.createEngBoardDataOwner({
                onAuthRequired: () => calls.push('auth'),
                createMeasurement: () => ({
                    start() {}, addPayloadBytes() {}, focusedContentReady() {},
                    finish: () => calls.push('finish'), cancel: () => calls.push('cancel'),
                }),
                streamBoard: options => new Promise((resolve, reject) => { stream = { options, resolve, reject }; }),
            });
            owner.selectGroup('a', 42, 'r1');
            const loading = owner.load();
            if (mode === 'auth frame') {
                await stream.options.onFrame(start('g1'));
                await stream.options.onFrame(frame('g1', 1, 'error', { code: 'auth_required' }));
                stream.resolve();
            } else if (mode === 'auth throw') {
                stream.reject(Object.assign(new Error('auth'), { code: 'auth_required' }));
            } else {
                owner.dispose();
                stream.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            }
            await loading;
            assert.equal(calls.filter(value => value === 'finish').length, 0);
            assert.equal(calls.filter(value => value === 'cancel').length, 1);
            assert.equal(calls.filter(value => value === 'auth').length, mode === 'unmount' ? 0 : 1);
        });
    }
});

test('a throwing measurement factory is observational and does not prevent Board success', async () => {
    const mod = loadModule();
    const owner = mod.createEngBoardDataOwner({
        createMeasurement: () => { throw new Error('optional factory failed'); },
        streamBoard: async options => {
            await options.onFrame(start('g1'));
            await options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'authoritative' }));
            await options.onFrame(frame('g1', 2, 'column', { columnId: 'todo', epics: [], children: [], authoritative: true }));
            await options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
            }));
        },
    });
    owner.selectGroup('a', 42, 'r1');
    assert.equal(await owner.load(), 'success');
});

test('pending real Board finish is silently suppressed by supersede, unmount, or auth lock', async t => {
    const mod = loadOwnerAndPerformance();
    for (const mode of ['supersede', 'unmount', 'auth lock']) {
        await t.test(mode, async () => {
            const samples = [];
            const paints = [];
            const streams = [];
            const owner = mod.createEngBoardDataOwner({
                createMeasurement: options => mod.createBoardLoadMeasurement({
                    ...options, enabled: true, emit: sample => samples.push(sample),
                    afterPaint: () => new Promise(resolve => paints.push(resolve)),
                }),
                streamBoard: options => new Promise((resolve, reject) => streams.push({ options, resolve, reject })),
            });
            owner.selectGroup('a', 42, 'r1');
            const first = owner.load();
            await streams[0].options.onFrame(start('g1'));
            await streams[0].options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'authoritative' }));
            await streams[0].options.onFrame(frame('g1', 2, 'column', {
                columnId: 'todo', epics: [], children: [], authoritative: true,
            }));
            await streams[0].options.onFrame(frame('g1', 3, 'complete', {
                outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
            }));
            assert.equal(owner.getState().status, 'success');
            assert.equal(paints.length, 2, 'focused content and terminal paint should both be pending');

            let replacement = null;
            if (mode === 'supersede') {
                streams[0].resolve();
                await first;
                replacement = owner.refresh();
            } else if (mode === 'unmount') {
                streams[0].resolve();
                await first;
                owner.dispose();
            } else {
                streams[0].reject(Object.assign(new Error('auth'), { code: 'auth_required' }));
                await first;
            }
            for (const release of paints.splice(0)) release();
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(samples, [], `${mode} must not emit a cancelled or terminal performance sample`);
            if (replacement) {
                owner.dispose();
                streams[1].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                await replacement;
            }
        });
    }
});

test('sync throws and rejected promises from every optional Board observer stay contained', async t => {
    const mod = loadModule();
    const methods = ['start', 'addPayloadBytes', 'focusedContentReady', 'finish', 'cancel'];
    for (const rejection of ['throw', 'reject']) {
        for (const method of methods) {
            await t.test(`${method} ${rejection}`, async () => {
                const streams = [];
                const measurement = {
                    start() {}, addPayloadBytes() {}, focusedContentReady() {}, finish() {}, cancel() {},
                };
                measurement[method] = () => {
                    if (rejection === 'throw') throw new Error(`${method} optional failure`);
                    return Promise.reject(new Error(`${method} optional rejection`));
                };
                const owner = mod.createEngBoardDataOwner({
                    createMeasurement: () => measurement,
                    streamBoard: options => new Promise((resolve, reject) => streams.push({ options, resolve, reject })),
                });
                owner.selectGroup('a', 42, 'r1');
                const loading = owner.load();
                if (method === 'cancel') {
                    owner.dispose();
                    streams[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                    assert.equal(await loading, 'ignored');
                } else {
                    await streams[0].options.onFrame(start('g1'), { payloadBytes: 10 });
                    await streams[0].options.onFrame(frame('g1', 1, 'index', { epics: [], membership: 'authoritative' }));
                    await streams[0].options.onFrame(frame('g1', 2, 'column', {
                        columnId: 'todo', epics: [], children: [], authoritative: true,
                    }));
                    await streams[0].options.onFrame(frame('g1', 3, 'complete', {
                        outcome: 'success', authoritative: true, epicCount: 0, childCount: 0, diagnostics: {},
                    }));
                    streams[0].resolve();
                    assert.equal(await loading, 'success');
                }
                await new Promise(resolve => setImmediate(resolve));
            });
        }
    }
});
