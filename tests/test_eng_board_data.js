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
