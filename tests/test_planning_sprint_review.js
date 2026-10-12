const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/eng/usePlanningSprintReview.js');
const row = id => ({ issueId: String(id), rowKind: 'story', id: String(id), key: `DEMO-${id}` });
const column = { id: 'cost', rowKind: 'story', label: 'Cost', type: 'number', aggregation: 'sum', order: 0 };
const schema = (revision = 1) => ({ schemaRevision: revision, columns: [column], capabilities: { canRead: true, canSave: true } });
const scope = (rows = [row(1)]) => ({ sprintId: '100', contextKey: 'user-a', active: true, rows });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(overrides = {}) {
    const { createPlanningSprintReviewController } = await load();
    return createPlanningSprintReviewController({ fetchSchema: async () => schema(), readValues: async () => ({ cells: [] }), saveReview: async (_, sprintId, payload) => ({ sprintId, schemaRevision: 1, columns: [column], cells: payload.cellChanges.map(cell => ({ ...cell, revision: cell.baseRevision + 1 })) }), ...overrides });
}

test('activation fetches only once and retained hidden-row drafts survive view/scope changes', async () => {
    let reads = 0, schemas = 0;
    const c = await fixture({ fetchSchema: async () => { schemas++; return schema(); }, readValues: async () => { reads++; return { cells: [] }; } });
    await c.setScope({ ...scope(), active: false });
    assert.equal(schemas, 0);
    await c.setScope(scope());
    c.setCell(row(1), column, '0.5');
    await c.setScope({ ...scope([]), active: false });
    await c.setScope(scope());
    assert.equal(reads, 1); assert.equal(schemas, 1);
    assert.equal(c.getState().dirty, true);
    assert.equal(Object.values(c.getState().drafts)[0].value, '0.5');
    assert.equal(await c.save(), true); assert.equal(c.getState().dirty, false);
});

test('changing Sprint resets schemaLoaded and cache; changing authority retires all drafts', async () => {
    const requests = [];
    const c = await fixture({ fetchSchema: async (_, sprint) => { requests.push(sprint); return schema(Number(sprint)); } });
    await c.setScope(scope());
    await c.setScope({ ...scope(), sprintId: '200' });
    assert.deepEqual(requests, ['100', '200']); assert.equal(c.getState().schemaRevision, 200);
    c.setCell(row(1), column, '3');
    await c.setScope({ ...scope(), contextKey: 'user-b' });
    assert.equal(c.getState().dirty, false); assert.equal(c.getState().contextKey, 'user-b');
});

test('Save/Discard/Stay guard refuses failed saves and retains old Sprint draft', async () => {
    const c = await fixture({ saveReview: async () => { throw new Error('network failure'); } });
    await c.setScope(scope()); c.setCell(row(1), column, '5');
    let changed = false;
    const guarded = c.guardScopeChange(() => { changed = true; });
    assert.equal(c.getState().pendingScopeChange, true);
    assert.equal(await c.resolveScopeChange('save'), false); assert.equal(changed, false);
    assert.equal(c.getState().sprintId, '100'); assert.equal(c.getState().dirty, true);
    await c.resolveScopeChange('stay'); assert.equal(await guarded, false); assert.equal(changed, false);
    const discarded = c.guardScopeChange(() => { changed = true; });
    await c.resolveScopeChange('discard'); assert.equal(await discarded, true); assert.equal(changed, true); assert.equal(c.getState().dirty, false);
});

test('refresh preserves old baselines until deliberate reapply, then save uses current revision', async () => {
    let revision = 1; const payloads = [];
    const c = await fixture({ fetchSchema: async () => schema(revision), readValues: async () => ({ cells: [{ issueId: '1', rowKind: 'story', columnId: 'cost', value: '1.000', revision }] }), saveReview: async (_, __, payload) => { payloads.push(payload); return { columns: [column], schemaRevision: revision, cells: [] }; } });
    await c.setScope(scope());
    c.setCell(row(1), column, '1'); assert.equal(c.getState().dirty, false, 'fixed3dp equality is a no-op');
    c.setCell(row(1), column, '2'); revision = 3;
    await c.refresh();
    assert.equal(c.getState().schemaRevision, 1); assert.equal(c.getState().conflict.schemaConflict, true);
    assert.equal(Object.values(c.getState().drafts)[0].baseRevision, 1);
    assert.equal(await c.save(), false);
    await c.reapply(); assert.equal(c.getState().schemaRevision, 3);
    assert.equal(await c.save(), true); assert.equal(payloads[0].cellChanges[0].baseRevision, 3);
});

test('same-cell conflict and unknown outcome never replay and preserve drafts', async () => {
    let attempts = 0;
    const c = await fixture({ saveReview: async () => { attempts++; const error = new Error('timeout'); error.unconfirmed = true; throw error; } });
    await c.setScope(scope()); c.setCell(row(1), column, '4');
    assert.equal(await c.save(), false); assert.equal(c.getState().unconfirmed, true); assert.equal(c.getState().dirty, true);
    assert.equal(await c.save(), false); assert.equal(attempts, 1);
    await c.reapply(); assert.equal(c.getState().unconfirmed, false);
    const conflict = await fixture({ saveReview: async () => { const error = new Error('conflict'); error.status = 409; error.conflict = { schemaConflict: false, cellConflicts: [{ issueId: '1', columnId: 'cost', revision: 4, value: '8.000' }] }; throw error; } });
    await conflict.setScope(scope()); conflict.setCell(row(1), column, '4'); await conflict.save();
    assert.equal(conflict.getState().conflict.cellConflicts[0].revision, 4); assert.equal(conflict.getState().dirty, true);
});

test('invalid drafts remain local and block save; synthetic rows cannot create cells', async () => {
    const c = await fixture(); await c.setScope(scope());
    assert.equal(c.setCell({ ...row(1), synthetic: true }, column, '2').valid, false); assert.equal(c.getState().dirty, false);
    assert.equal(c.setCell(row(1), column, '1e3').valid, false); assert.equal(c.getState().dirty, true);
    assert.equal(await c.save(), false); assert.match(c.getState().error, /invalid/);
    assert.equal(Object.values(c.getState().drafts)[0].input, '1e3');
});

test('bounded reads report progress and progressive scope additions load after active request', async () => {
    const first = deferred(); const batches = [];
    const c = await fixture({ readValues: async (_, __, payload) => { batches.push(payload); if (batches.length === 1) await first.promise; return { cells: [] }; } });
    const start = c.setScope(scope([row(1)]));
    await new Promise(resolve => setImmediate(resolve));
    await c.setScope(scope(Array.from({ length: 502 }, (_, index) => row(index + 1))));
    first.resolve(); await start;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(batches.map(batch => batch.issueIds.length), [1, 500, 1]);
    assert.equal(c.getState().loading, false);
});

test('stale read cannot cross authority partition or reset current draft', async () => {
    const old = deferred();
    const c = await fixture({ fetchSchema: async (_, sprint) => sprint === '100' ? old.promise : schema(2) });
    const oldRequest = c.setScope(scope());
    await c.setScope({ ...scope(), sprintId: '200', contextKey: 'user-b' });
    c.setCell(row(1), column, '4'); old.resolve(schema(1)); await oldRequest;
    assert.equal(c.getState().sprintId, '200'); assert.equal(c.getState().schemaRevision, 2); assert.equal(c.getState().dirty, true);
});

test('413 response limits split read-only batches with complete progress and no write replay', async () => {
    const calls = [];
    const c = await fixture({ readValues: async (_, __, batch) => { calls.push(batch.issueIds.length); if (batch.issueIds.length > 2) { const error = new Error('response limit'); error.status = 413; throw error; } return { cells: [] }; } });
    await c.setScope(scope(Array.from({ length: 8 }, (_, id) => row(id))));
    assert.deepEqual(calls, [8, 4, 2, 2, 4, 2, 2]);
    assert.equal(c.getState().error, ''); assert.equal(c.getState().loading, false);
});

test('schema save advances current baseline so later add/discard retains saved columns', async () => {
    const c = await fixture({ fetchSchema: async () => ({ ...schema(), columns: [] }), saveReview: async (_, __, payload) => ({ schemaRevision: 2, columns: payload.schemaChanges.map(change => change.column), cells: [] }) });
    await c.setScope(scope());
    c.changeSchema({ action: 'add', column }); await c.save();
    c.changeSchema({ action: 'add', column: { ...column, id: 'other' } }); c.discard();
    assert.deepEqual(c.getState().columns.map(item => item.id), ['cost']);
});

test('context change retires in-flight write and pending guard without blocking new authority', async () => {
    const saving = deferred();
    const c = await fixture({ saveReview: async () => saving.promise });
    await c.setScope(scope()); c.setCell(row(1), column, '3');
    const guarded = c.guardScopeChange(() => { throw new Error('stale guard must not run'); });
    const oldSave = c.save(); assert.equal(c.getState().saving, true);
    await c.setScope({ ...scope(), contextKey: 'user-b' });
    assert.equal(c.getState().saving, false); assert.equal(c.getState().loading, false);
    assert.equal(await guarded, false);
    saving.resolve({ schemaRevision: 5, columns: [column], cells: [] }); await oldSave;
    assert.equal(c.getState().contextKey, 'user-b'); assert.equal(c.getState().schemaRevision, 1);
});

test('deliberate recovery refresh includes hidden dirty rows and their current revisions', async () => {
    let revision = 1; const requests = [];
    const c = await fixture({ readValues: async (_, __, batch) => { requests.push(batch.issueIds); return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: 'story', columnId: 'cost', value: '1.000', revision })) }; } });
    await c.setScope(scope()); c.setCell(row(1), column, '4');
    await c.setScope(scope([row(2)])); revision = 4;
    await c.reapply();
    assert.ok(requests.at(-1).includes('1')); assert.equal(Object.values(c.getState().drafts)[0].baseRevision, 4);
});

test('shared layouts load, draft, save, discard and reload with the schema revision', async()=>{
    const {createPlanningSprintReviewController}=await import('../frontend/src/eng/usePlanningSprintReview.js');
    let stored={schemaRevision:1,columns:[],layouts:{story:{order:['status','storyPoints'],hidden:[]}},capabilities:{canRead:true,canSave:true}};
    const make=()=>createPlanningSprintReviewController({fetchSchema:async()=>stored,readValues:async()=>({cells:[]}),saveReview:async(_,__,payload)=>{const layout=payload.schemaChanges.find(change=>change.action==='layout');stored={...stored,schemaRevision:2,layouts:{story:{order:layout.order,hidden:layout.hidden}}};return stored}});
    const first=make();await first.setScope({sprintId:'17',contextKey:'user-a',active:true});
    first.changeSchema({action:'layout',rowKind:'story',order:['storyPoints','status'],hidden:['assignee']});
    assert.deepEqual(first.getState().layouts.story.order,['storyPoints','status']);
    first.discard();assert.deepEqual(first.getState().layouts.story.order,['status','storyPoints']);
    first.changeSchema({action:'layout',rowKind:'story',order:['storyPoints','status'],hidden:['assignee']});await first.save();
    const second=make();await second.setScope({sprintId:'17',contextKey:'user-b',active:true});assert.deepEqual(second.getState().layouts,first.getState().layouts);
    first.dispose();second.dispose();
});

for (const layouts of [undefined, {}, {story:{order:['status','storyPoints'],hidden:[]}}]) test(`layout save without matching confirmation preserves the unsaved order (${JSON.stringify(layouts)})`,async()=>{
    const {createPlanningSprintReviewController}=await import('../frontend/src/eng/usePlanningSprintReview.js');
    const c=createPlanningSprintReviewController({fetchSchema:async()=>({schemaRevision:1,columns:[],layouts:{},capabilities:{canRead:true,canSave:true}}),readValues:async()=>({cells:[]}),saveReview:async()=>({schemaRevision:2,columns:[],layouts,cells:[]})});
    await c.setScope({sprintId:'17',contextKey:'user-a',active:true});
    c.changeSchema({action:'layout',rowKind:'story',order:['storyPoints','status'],hidden:['assignee']});
    assert.equal(await c.save(),false);
    assert.equal(c.getState().dirty,true);
    assert.equal(c.getState().unconfirmed,true);
    assert.deepEqual(c.getState().layouts.story,{order:['storyPoints','status'],hidden:['assignee']});
    assert.equal(c.getState().schemaRevision,1);
    c.dispose();
});

test('automatic refresh stages schema and all batches silently and commits once', async () => {
    const gate = deferred(); let automatic = false, calls = 0;
    const c = await fixture({ fetchSchema: async () => schema(automatic ? 2 : 1), readValues: async (_, __, batch) => {
        if (automatic && ++calls === 2) await gate.promise;
        return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: batch.rowKind, columnId: 'cost', value: automatic ? '8' : '1', revision: automatic ? 2 : 1 })), unavailableIssueIds: automatic ? [batch.issueIds[0]] : [] };
    } });
    await c.setScope(scope(Array.from({ length: 501 }, (_, i) => row(i + 1))));
    const held = c.getState(); let emissions = 0; c.subscribe(() => emissions++); automatic = true;
    const pending = c.refresh({ automatic: true, shouldApply: () => true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(c.getState(), held); assert.equal(emissions, 0);
    gate.resolve(); assert.deepEqual(await pending, { status: 'ok' });
    assert.equal(emissions, 1); assert.equal(c.getState().schemaRevision, 2); assert.equal(c.getState().unavailableIssueIds.length, 2);
});
for (const block of ['dirty', 'saving', 'conflict', 'unconfirmed', 'pendingScopeChange']) test(`automatic read rejects current ${block} at acceptance without rewriting base`, async () => {
    const gate = deferred(), saving = deferred(); let automatic = false;
    const c = await fixture({ fetchSchema: async () => schema(automatic ? 2 : 1), readValues: async () => { if (automatic) await gate.promise; return { cells: [] }; }, saveReview: async () => {
        if (block === 'saving') return saving.promise;
        throw Object.assign(new Error('save outcome'), block === 'conflict' ? { status: 409, conflict: { schemaConflict: true } } : { unconfirmed: true });
    } });
    await c.setScope(scope()); automatic = true;
    const pending = c.refresh({ automatic: true, shouldApply: () => true }); await new Promise(resolve => setImmediate(resolve));
    c.setCell(row(1), column, '7');
    if (block === 'saving') void c.save();
    if (block === 'pendingScopeChange') void c.guardScopeChange(() => {});
    if (block === 'conflict' || block === 'unconfirmed') await c.save();
    const held = c.getState(); gate.resolve();
    assert.deepEqual(await pending, { status: 'ignored' }); assert.equal(c.getState(), held);
    assert.equal(held.schemaRevision, 1); assert.equal(Object.values(held.drafts)[0].baseRevision, 0);
    c.dispose(); saving.resolve({ schemaRevision: 2, columns: [column], cells: [] });
});
test('automatic failures retain state and terminal auth rejects without replay', async () => {
    let failure; const c = await fixture({ fetchSchema: async () => { if (failure) throw failure; return schema(); } }); await c.setScope(scope());
    const held = c.getState();
    for (const status of [429, 503]) { failure = Object.assign(new Error('read failed'), { status }); assert.deepEqual(await c.refresh({ automatic: true, shouldApply: () => true }), { status: 'failed' }); assert.equal(c.getState(), held); }
    failure = Object.assign(new Error('terminal'), { name: 'AuthenticationRequiredError', status: 401 });
    await assert.rejects(c.refresh({ automatic: true, shouldApply: () => true }), failure);
});
test('queued forced automatic read retains options and reads synchronously current row admission', async () => {
    const gate = deferred(); let reads = 0, schemas = 0; const requests = [];
    const c = await fixture({ fetchSchema: async () => { schemas++; return schema(); }, readValues: async (_, __, batch) => { requests.push(batch.issueIds); if (++reads === 1) await gate.promise; return { cells: [] }; } });
    const initial = c.setScope(scope()); await new Promise(resolve => setImmediate(resolve));
    const pending = c.refresh({ automatic: true, shouldApply: () => true });
    c.setRows([row(1), row(2)]); await c.setScope({ ...scope([row(1), row(2)]), deferRead: true });
    gate.resolve(); await initial; assert.deepEqual(await pending, { status: 'ok' });
    assert.equal(schemas, 2); assert.deepEqual(requests, [['1'], ['1', '2']]); assert.equal(c.getState().loading, false);
});
test('silent automatic 413 splitting and lost read capability accept no intermediate state', async () => {
    let automatic = false, canRead = true; const sizes = [];
    const c = await fixture({ fetchSchema: async () => ({ ...schema(), capabilities: { canRead, canSave: canRead } }), readValues: async (_, __, batch) => {
        if (automatic) { sizes.push(batch.issueIds.length); if (batch.issueIds.length > 2) throw Object.assign(new Error('split'), { status: 413 }); }
        return { cells: [] };
    } }); await c.setScope(scope([row(1), row(2), row(3), row(4)]));
    let count = 0; c.subscribe(() => count++); automatic = true;
    assert.deepEqual(await c.refresh({ automatic: true, shouldApply: () => true }), { status: 'ok' }); assert.deepEqual(sizes, [4, 2, 2]); assert.equal(count, 1);
    canRead = false; const before = sizes.length; assert.deepEqual(await c.refresh({ automatic: true, shouldApply: () => true }), { status: 'ok' }); assert.equal(sizes.length, before); assert.equal(c.getState().capabilities.canSave, false);
});
for (const manualFirst of [false, true]) test(`queued manual ownership survives automatic ${manualFirst ? 'following' : 'preceding'} request`, async () => {
    const gate = deferred(); let schemas = 0, reads = 0;
    const c = await fixture({ fetchSchema: async () => { schemas++; return schema(); }, readValues: async () => { if (++reads === 1) await gate.promise; return { cells: [] }; } });
    const initial = c.setScope(scope()); await new Promise(resolve => setImmediate(resolve));
    const abort = new AbortController(); let automatic;
    if (manualFirst) { assert.equal(await c.refresh(), false); automatic = c.refresh({ automatic: true, signal: abort.signal, shouldApply: () => true }); }
    else { automatic = c.refresh({ automatic: true, signal: abort.signal, shouldApply: () => true }); assert.equal(await c.refresh(), false); }
    abort.abort(); assert.deepEqual(await automatic, { status: 'ignored' }); gate.resolve(); await initial; await new Promise(resolve => setImmediate(resolve));
    assert.equal(schemas, 2); assert.equal(reads, 2); assert.equal(c.getState().loading, false);
});
test('cancelled queued automatic read settles before held manual acquisition completes', async () => {
    const gate = deferred(); let reads = 0;
    const c = await fixture({ readValues: async () => { reads++; await gate.promise; return { cells: [] }; } }); const initial = c.setScope(scope()); await new Promise(resolve => setImmediate(resolve));
    const abort = new AbortController(), pending = c.refresh({ automatic: true, signal: abort.signal, shouldApply: () => true }); abort.abort();
    assert.deepEqual(await pending, { status: 'ignored' }); gate.resolve(); await initial; await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
});
test('accepted access removal deletes loaded cells and refuses edits, then explicit recovery restores access', async () => {
    let unavailable = false;
    const c = await fixture({ readValues: async () => ({ cells: unavailable ? [] : [{ issueId: '1', rowKind: 'story', columnId: 'cost', value: '2', revision: 1 }], unavailableIssueIds: unavailable ? ['1'] : [] }) });
    await c.setScope(scope()); unavailable = true; assert.deepEqual(await c.refresh({ automatic: true, shouldApply: () => true }), { status: 'ok' });
    assert.deepEqual(c.getState().unavailableIssueIds, ['1']); assert.equal(c.getState().cells['story:1:cost'], undefined); assert.equal(c.setCell(row(1), column, '5').valid, false);
    unavailable = false; assert.equal(await c.refresh(), true); assert.deepEqual(c.getState().unavailableIssueIds, []); assert.equal(c.setCell(row(1), column, '5').valid, true);
});
test('a genuine user scope change loads despite a captured automatic-primary defer flag', async () => {
    const sprints = []; const c = await fixture({ fetchSchema: async (_, sprint) => { sprints.push(sprint); return schema(); } }); await c.setScope(scope());
    await c.setScope({ ...scope(), sprintId: '200', deferRead: true }); assert.deepEqual(sprints, ['100', '200']); assert.equal(c.getState().schemaLoaded, true);
});
test('manual row admission after queued automatic cancellation still loads current rows', async () => {
    const gate = deferred(); let reads = 0; const requests = [];
    const c = await fixture({ readValues: async (_, __, batch) => { requests.push(batch.issueIds); if (++reads === 1) await gate.promise; return { cells: [] }; } });
    const initial = c.setScope(scope()); await new Promise(resolve => setImmediate(resolve)); const abort = new AbortController();
    const automatic = c.refresh({ automatic: true, signal: abort.signal, shouldApply: () => true }); abort.abort(); assert.deepEqual(await automatic, { status: 'ignored' });
    await c.setScope(scope([row(1), row(2)])); gate.resolve(); await initial; await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, [['1'], ['1', '2']]); assert.equal(c.setCell(row(3), column, '2').valid, false);
});

test('retired automatic primary resumes only unread admitted rows before allowing revisioned edits', async () => {
    const reads = []; let saved;
    const c = await fixture({
        readValues: async (_, __, batch) => { reads.push(batch.issueIds); return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: batch.rowKind, columnId: 'cost', value: '5', revision: 7 })) }; },
        saveReview: async (_, __, payload) => { saved = payload; return { ...schema(), cells: [] }; },
    });
    await c.setScope(scope([row(1)]));
    await c.setScope({ ...scope([row(1), row(2)]), deferRead: true });
    assert.equal(c.isRowReadable(row(2)), false);
    assert.equal(c.setCell(row(2), schema().columns[0], '8').valid, false);
    assert.deepEqual(await c.resumeDeferredRead(), { status: 'ok' });
    assert.deepEqual(reads, [['1'], ['2']]);
    assert.equal(c.isRowReadable(row(2)), true);
    c.setCell(row(2), schema().columns[0], '8'); await c.save();
    assert.equal(saved.cellChanges[0].baseRevision, 7);
});

test('deferred row recovery retires on a late foreground guard change without publishing', async () => {
    const gate = deferred(); let held = false, applicable = true;
    const c = await fixture({ readValues: async (_, __, batch) => {
        if (held) await gate.promise;
        return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: batch.rowKind, columnId: 'cost', value: '5', revision: 7 })) };
    } });
    await c.setScope(scope([row(1)])); await c.setScope({ ...scope([row(1), row(2)]), deferRead: true }); held = true;
    const before = c.getState(), abort = new AbortController();
    const recovery = c.resumeDeferredRead({ signal: abort.signal, shouldApply: () => applicable });
    await new Promise(resolve => setImmediate(resolve)); applicable = false; abort.abort(); gate.resolve();
    assert.deepEqual(await recovery, { status: 'ignored' });
    assert.equal(c.getState(), before); assert.equal(c.isRowReadable(row(2)), false);
    applicable = true; held = false;
    assert.deepEqual(await c.resumeDeferredRead({ shouldApply: () => applicable }), { status: 'ok' });
    assert.equal(c.isRowReadable(row(2)), true);
});

test('automatic read that lands after a completed user save does not regress saved cells or revision', async () => {
    const gate = deferred(); let automatic = false;
    const c = await fixture({
        fetchSchema: async () => schema(1),
        readValues: async (_, __, batch) => { if (automatic) await gate.promise; return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: 'story', columnId: 'cost', value: '1.000', revision: 1 })) }; },
        saveReview: async (_, __, payload) => ({ columns: [column], schemaRevision: 2, cells: payload.cellChanges.map(cell => ({ ...cell, revision: 2 })) }),
    });
    await c.setScope(scope()); automatic = true;
    const pending = c.refresh({ automatic: true, shouldApply: () => true }); await new Promise(resolve => setImmediate(resolve));
    c.setCell(row(1), column, '5'); assert.equal(await c.save(), true);
    gate.resolve();
    assert.deepEqual(await pending, { status: 'ignored' });
    const state = c.getState(), key = Object.keys(state.savedCells)[0];
    assert.equal(state.savedCells[key].value, '5'); assert.equal(state.savedCells[key].revision, 2);
    assert.equal(state.schemaRevision, 2); assert.equal(state.currentSchemaRevision, 2);
});
