const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/eng/usePlanningSprintReview.js');
const row = id => ({ issueId: String(id), rowKind: 'story', id: String(id), key: `DEMO-${id}` });
const column = { id: 'cost', rowKind: 'story', label: 'Cost', type: 'number', aggregation: 'sum', order: 0 };
const schema = (revision = 1) => ({ schemaRevision: revision, columns: [column], capabilities: { canRead: true, canSave: true } });
const scope = (rows = [row(1)]) => ({ sprintId: '100', groupId: 'g1', contextKey: 'user-a', active: true, rows });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
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
    c.setCell(row(1), column, '2'); c.changeSchema({ action: 'rename', columnId: 'cost', label: 'Cost total' }); revision = 3;
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
    const first=make();await first.setScope({sprintId:'17',groupId:'g1',contextKey:'user-a',active:true});
    first.changeSchema({action:'layout',rowKind:'story',order:['storyPoints','status'],hidden:['assignee']});
    assert.deepEqual(first.getState().layouts.story.order,['storyPoints','status']);
    first.discard();assert.deepEqual(first.getState().layouts.story.order,['status','storyPoints']);
    first.changeSchema({action:'layout',rowKind:'story',order:['storyPoints','status'],hidden:['assignee']});await first.save();
    const second=make();await second.setScope({sprintId:'17',groupId:'g1',contextKey:'user-b',active:true});assert.deepEqual(second.getState().layouts,first.getState().layouts);
    first.dispose();second.dispose();
});

for (const layouts of [undefined, {}, {story:{order:['status','storyPoints'],hidden:[]}}]) test(`layout save without matching confirmation preserves the unsaved order (${JSON.stringify(layouts)})`,async()=>{
    const {createPlanningSprintReviewController}=await import('../frontend/src/eng/usePlanningSprintReview.js');
    const c=createPlanningSprintReviewController({fetchSchema:async()=>({schemaRevision:1,columns:[],layouts:{},capabilities:{canRead:true,canSave:true}}),readValues:async()=>({cells:[]}),saveReview:async()=>({schemaRevision:2,columns:[],layouts,cells:[]})});
    await c.setScope({sprintId:'17',groupId:'g1',contextKey:'user-a',active:true});
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
    const gate = deferred(); let automatic = false, held = true;
    const server = { value: '1.000', revision: 1, schemaRevision: 1 };
    const c = await fixture({
        fetchSchema: async () => schema(server.schemaRevision),
        readValues: async (_, __, batch) => { const snapshot = { ...server }; if (automatic && held) { held = false; await gate.promise; } return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: 'story', columnId: 'cost', value: snapshot.value, revision: snapshot.revision })) }; },
        saveReview: async (_, __, payload) => { Object.assign(server, { value: payload.cellChanges[0].value, revision: 2, schemaRevision: 2 }); return { columns: [column], schemaRevision: 2, cells: payload.cellChanges.map(cell => ({ ...cell, revision: 2 })) }; },
    });
    await c.setScope(scope()); automatic = true;
    const pending = c.refresh({ automatic: true, shouldApply: () => true }); await new Promise(resolve => setImmediate(resolve));
    c.setCell(row(1), column, '5'); assert.equal(await c.save(), true);
    assert.equal(c.getState().schemaRevision, 1, 'a cell-only 200 keeps the held schema revision');
    assert.equal(c.getState().currentSchemaRevision, 2, 'and records the response revision as current');
    gate.resolve();
    assert.deepEqual(await pending, { status: 'ignored' });
    await settle();
    const state = c.getState(), key = Object.keys(state.savedCells)[0];
    assert.equal(state.savedCells[key].value, '5'); assert.equal(state.savedCells[key].revision, 2);
    assert.equal(state.schemaRevision, 2, 'the forced refresh adopts the new revision'); assert.equal(state.currentSchemaRevision, 2);
});

async function inFlightAutomaticRead(overrides = {}) {
    const gate = deferred(); let automatic = false;
    const c = await fixture({
        fetchSchema: async () => schema(1),
        readValues: async (_, __, batch) => { const stale = automatic; if (stale) await gate.promise; return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: 'story', columnId: 'cost', value: stale ? '9.000' : '1.000', revision: stale ? 7 : 1 })) }; },
        ...overrides,
    });
    await c.setScope(scope()); automatic = true;
    const pending = c.refresh({ automatic: true, shouldApply: () => true }); await new Promise(resolve => setImmediate(resolve));
    return { c, gate, pending };
}

test('automatic read that lands after a user discard is ignored and does not regress saved cells', async () => {
    const { c, gate, pending } = await inFlightAutomaticRead();
    c.setCell(row(1), column, '5'); assert.equal(c.getState().dirty, true);
    assert.equal(c.discard(), true);
    gate.resolve();
    assert.deepEqual(await pending, { status: 'ignored' });
    const state = c.getState(), key = Object.keys(state.savedCells)[0];
    assert.equal(state.savedCells[key].value, '1.000'); assert.equal(state.savedCells[key].revision, 1);
    assert.deepEqual(state.drafts, {}); assert.equal(state.dirty, false);
});

test('automatic read that lands after a user column/layout edit is ignored and keeps the schema draft', async () => {
    const { c, gate, pending } = await inFlightAutomaticRead();
    const change = { action: 'layout', rowKind: 'story', order: ['cost'], hidden: [] };
    assert.equal(c.changeSchema(change), true);
    gate.resolve();
    assert.deepEqual(await pending, { status: 'ignored' });
    const state = c.getState(), key = Object.keys(state.savedCells)[0];
    assert.deepEqual(state.schemaChanges, [change]); assert.equal(state.dirty, true);
    assert.equal(state.savedCells[key].value, '1.000'); assert.equal(state.savedCells[key].revision, 1);
});

test('automatic read that lands after a 409 save conflict is ignored and preserves conflict and drafts', async () => {
    const conflict = { schemaConflict: false, cellConflicts: [{ issueId: '1', columnId: 'cost', revision: 4, value: '8.000' }] };
    const { c, gate, pending } = await inFlightAutomaticRead({ saveReview: async () => { const error = new Error('conflict'); error.status = 409; error.conflict = conflict; throw error; } });
    c.setCell(row(1), column, '5'); assert.equal(await c.save(), false);
    gate.resolve();
    assert.deepEqual(await pending, { status: 'ignored' });
    const state = c.getState(), key = Object.keys(state.savedCells)[0];
    assert.deepEqual(state.conflict, conflict); assert.equal(Object.values(state.drafts)[0].value, '5');
    assert.equal(state.savedCells[key].value, '1.000'); assert.equal(state.savedCells[key].revision, 1);
});

// #267: Department group scope, Sprint view revisions, first-save injection, group errors and forced loads.
const epicColumn = { id: 'risk', rowKind: 'epic', label: 'Risk', type: 'text', aggregation: 'none', order: 0 };
const inherited = { sprintId: '90', viewRevision: 4 };
const sourceLayouts = { epic: { order: ['risk', 'status'], hidden: [] }, story: { order: ['cost', 'status'], hidden: ['assignee'] } };
const viewSchema = (overrides = {}) => ({ ...schema(), columns: [column, epicColumn], viewRevision: 0, inheritedFrom: inherited, layouts: sourceLayouts, ...overrides });
const storyLayout = { action: 'layout', rowKind: 'story', order: ['status', 'cost'], hidden: [] };
const echoSave = payloads => async (_, __, payload) => {
    payloads.push(JSON.parse(JSON.stringify(payload)));
    const layouts = {}; for (const change of payload.schemaChanges) if (change.action === 'layout') layouts[change.rowKind] = { order: change.order, hidden: change.hidden };
    const hasLayout = Object.keys(layouts).length > 0;
    return { schemaRevision: 1, columns: [column, epicColumn], cells: payload.cellChanges.map(cell => ({ ...cell, revision: cell.baseRevision + 1 })), ...(hasLayout ? { layouts, viewRevision: 1, inheritedFrom: null } : {}) };
};

test('the group is part of the scope: GET option, read and write payloads, and load refuses an empty group', async () => {
    const gets = [], reads = [], payloads = [];
    const c = await fixture({ fetchSchema: async (_, sprint, options) => { gets.push(options.groupId); return schema(); }, readValues: async (_, __, batch) => { reads.push(batch); return { cells: [] }; }, saveReview: echoSave(payloads) });
    assert.equal(await c.setScope({ ...scope(), groupId: '' }), false);
    assert.equal(await c.setScope({ ...scope(), groupId: undefined }), false);
    assert.deepEqual(gets, [], 'no group means no request');
    await c.setScope(scope());
    assert.deepEqual(gets, ['g1']); assert.equal(reads[0].groupId, 'g1'); assert.equal(c.getState().groupId, 'g1');
    c.setCell(row(1), column, '3'); assert.equal(await c.save(), true);
    assert.equal(payloads[0].groupId, 'g1'); assert.equal(payloads[0].baseViewRevision, 0);
});

test('a group change resets drafts, loaded rows and review state even while dirty, and ignores deferRead', async () => {
    const gets = [];
    const c = await fixture({ fetchSchema: async (_, __, options) => { gets.push(options.groupId); return viewSchema({ schemaRevision: options.groupId === 'g2' ? 7 : 1 }); } });
    await c.setScope(scope()); c.setCell(row(1), column, '3'); assert.equal(c.getState().dirty, true);
    const pending = c.setScope({ ...scope(), groupId: 'g2', deferRead: true });
    assert.equal(c.getState().dirty, false); assert.equal(c.isRowReadable(row(1)), false);
    assert.equal(c.getState().groupId, 'g2'); assert.equal(c.getState().schemaLoaded, false);
    await pending;
    assert.deepEqual(gets, ['g1', 'g2']); assert.equal(c.getState().schemaRevision, 7); assert.equal(c.isRowReadable(row(1)), true);
});

test('a draft is bound to its group: a save in flight across a group change is retired', async () => {
    const saving = deferred(), payloads = [];
    const c = await fixture({ saveReview: async (_, __, payload) => { payloads.push(payload); return saving.promise; } });
    await c.setScope(scope()); c.setCell(row(1), column, '3');
    const oldSave = c.save();
    await c.setScope({ ...scope(), groupId: 'g2' });
    saving.resolve({ schemaRevision: 9, columns: [column], cells: [] }); assert.equal(await oldSave, false);
    assert.equal(payloads[0].groupId, 'g1'); assert.equal(c.getState().groupId, 'g2'); assert.equal(c.getState().schemaRevision, 1);
});

test('viewRevision and inheritedFrom follow load, dirty refresh, discard, loadCurrent and reset by direct assignment', async () => {
    let server = viewSchema();
    const c = await fixture({ fetchSchema: async () => server });
    await c.setScope(scope());
    assert.equal(c.getState().viewRevision, 0); assert.deepEqual(c.getState().inheritedFrom, inherited);
    c.setCell(row(1), column, '3');
    server = viewSchema({ viewRevision: 1, inheritedFrom: null, layouts: { story: { order: ['status'], hidden: [] } } });
    await c.refresh();
    const dirty = c.getState();
    assert.equal(dirty.conflict, null, 'a cell-only draft survives a view change');
    assert.equal(dirty.viewRevision, 0); assert.deepEqual(dirty.inheritedFrom, inherited, 'saved values are held while dirty');
    assert.equal(dirty.currentViewRevision, 1); assert.equal(dirty.currentInheritedFrom, null);
    c.discard();
    assert.equal(c.getState().viewRevision, 1); assert.equal(c.getState().inheritedFrom, null, 'discard clears the stale hint');
    c.setCell(row(1), column, '4'); server = viewSchema({ viewRevision: 2, inheritedFrom: null });
    assert.equal(await c.loadCurrent(), true);
    assert.equal(c.getState().viewRevision, 2); assert.equal(c.getState().inheritedFrom, null); assert.equal(c.getState().dirty, false);
    server = viewSchema({ viewRevision: undefined, inheritedFrom: undefined });
    await c.refresh();
    assert.equal(c.getState().viewRevision, 0, 'a missing viewRevision reads as 0'); assert.equal(c.getState().inheritedFrom, null, 'a missing inheritedFrom reads as null');
    server = viewSchema({ viewRevision: 3, inheritedFrom: null });
    await c.refresh(); assert.equal(c.getState().viewRevision, 3);
    const sprintSwitch = c.setScope({ ...scope(), sprintId: '200' });
    assert.equal(c.getState().viewRevision, 0); assert.equal(c.getState().inheritedFrom, null); assert.equal(c.getState().currentViewRevision, 0); assert.equal(c.getState().currentInheritedFrom, null);
    await sprintSwitch;
});

test('the refresh conflict rule: cells never, layouts only on viewRevision, columns only on schemaRevision', async () => {
    let server = viewSchema({ viewRevision: 1, inheritedFrom: null });
    const make = async () => { server = viewSchema({ viewRevision: 1, inheritedFrom: null }); const c = await fixture({ fetchSchema: async () => server }); await c.setScope(scope()); return c; };
    const cells = await make(); cells.setCell(row(1), column, '3');
    server = viewSchema({ schemaRevision: 5, viewRevision: 2, inheritedFrom: null }); await cells.refresh();
    assert.equal(cells.getState().conflict, null); assert.equal(cells.getState().dirty, true);
    const layout = await make(); layout.changeSchema(storyLayout);
    server = viewSchema({ schemaRevision: 5, viewRevision: 1, inheritedFrom: null }); await layout.refresh();
    assert.equal(layout.getState().conflict, null, 'a column revision does not interrupt a layout draft');
    server = viewSchema({ schemaRevision: 5, viewRevision: 2, inheritedFrom: null }); await layout.refresh();
    assert.equal(layout.getState().conflict.viewConflict, true); assert.match(layout.getState().error, /draft is preserved/);
    const columns = await make(); columns.changeSchema({ action: 'rename', columnId: 'cost', label: 'Cost total' });
    server = viewSchema({ viewRevision: 2, inheritedFrom: null }); await columns.refresh();
    assert.equal(columns.getState().conflict, null, 'a view revision does not interrupt a column draft');
    server = viewSchema({ schemaRevision: 5, viewRevision: 2, inheritedFrom: null }); await columns.refresh();
    assert.equal(columns.getState().conflict.schemaConflict, true); assert.match(columns.getState().error, /draft is preserved/);
});

test('first layout save injects the inherited other kind inside save() only, never into schemaChanges', async () => {
    const payloads = []; let fail = true;
    const c = await fixture({ fetchSchema: async () => viewSchema(), saveReview: async (...args) => { if (fail) { fail = false; payloads.push(JSON.parse(JSON.stringify(args[2]))); throw new Error('network failure'); } return echoSave(payloads)(...args); } });
    await c.setScope(scope()); c.changeSchema(storyLayout);
    assert.equal(await c.save(), false);
    assert.deepEqual(payloads[0].schemaChanges, [storyLayout, { action: 'layout', rowKind: 'epic', order: ['risk', 'status'], hidden: [] }]);
    assert.deepEqual(c.getState().schemaChanges, [storyLayout], 'the injection is never stored');
    assert.equal(await c.save(), true);
    assert.equal(payloads[1].schemaChanges.length, 2); assert.equal(payloads[1].baseViewRevision, 0);
    assert.equal(c.getState().viewRevision, 1); assert.equal(c.getState().inheritedFrom, null);
});

test('injected layouts are intentionally not confirmed by layoutConfirmed', async () => {
    const c = await fixture({ fetchSchema: async () => viewSchema(), saveReview: async (_, __, payload) => ({ schemaRevision: 1, columns: [column, epicColumn], cells: [], layouts: { story: { order: storyLayout.order, hidden: storyLayout.hidden } }, viewRevision: 1, inheritedFrom: null }) });
    await c.setScope(scope()); c.changeSchema(storyLayout);
    assert.equal(await c.save(), true); assert.equal(c.getState().unconfirmed, false);
});

for (const [name, edit] of [
    ['cell edit', c => c.setCell(row(1), column, '3')],
    ['rename', c => c.changeSchema({ action: 'rename', columnId: 'cost', label: 'Cost total' })],
    ['archive', c => c.changeSchema({ action: 'archive', columnId: 'cost', archived: true })],
    ['total', c => c.changeSchema({ action: 'aggregation', columnId: 'cost', aggregation: 'none' })],
]) test(`a ${name} save in an inheriting Sprint never injects a layout`, async () => {
    const payloads = [];
    const c = await fixture({ fetchSchema: async () => viewSchema(), saveReview: echoSave(payloads) });
    await c.setScope(scope()); edit(c);
    assert.equal(await c.save(), true);
    assert.equal(payloads[0].schemaChanges.some(change => change.action === 'layout'), false);
    assert.deepEqual(c.getState().inheritedFrom, inherited, 'the Sprint keeps inheriting');
});

for (const [name, overrides] of [['own view', { viewRevision: 2, inheritedFrom: null }], ['no source', { viewRevision: 0, inheritedFrom: null }]]) test(`a layout save with ${name} does not inject`, async () => {
    const payloads = [];
    const c = await fixture({ fetchSchema: async () => viewSchema(overrides), saveReview: echoSave(payloads) });
    await c.setScope(scope()); c.changeSchema(storyLayout);
    assert.equal(await c.save(), true);
    assert.deepEqual(payloads[0].schemaChanges, [storyLayout]); assert.equal(payloads[0].baseViewRevision, overrides.viewRevision);
});

test('reapply after a viewConflict leaves another user\'s other-kind layout alone', async () => {
    const payloads = []; let server = viewSchema(), conflictOnce = true;
    const c = await fixture({ fetchSchema: async () => server, saveReview: async (...args) => {
        if (conflictOnce) { conflictOnce = false; server = viewSchema({ viewRevision: 1, inheritedFrom: null, layouts: { epic: { order: ['status', 'risk'], hidden: ['risk'] }, story: { order: ['status'], hidden: [] } } }); throw Object.assign(new Error('conflict'), { status: 409, conflict: { schemaConflict: false, viewConflict: true, cellConflicts: [] } }); }
        return echoSave(payloads)(...args);
    } });
    await c.setScope(scope()); c.changeSchema(storyLayout);
    assert.equal(await c.save(), false);
    assert.equal(c.getState().conflict.viewConflict, true); assert.match(c.getState().error, /shared review changed/);
    assert.equal(await c.reapply(), true);
    assert.equal(await c.save(), true);
    assert.deepEqual(payloads[0].schemaChanges, [storyLayout]); assert.equal(payloads[0].baseViewRevision, 1);
});

test('a 200 applies only the keys present and a cell-only response forces a refresh for a new column revision', async () => {
    let server = viewSchema({ viewRevision: 3, inheritedFrom: null }), gets = 0;
    const fresh = { ...column, id: 'fresh', label: 'Fresh' };
    const c = await fixture({ fetchSchema: async () => { gets++; return server; }, saveReview: async (_, __, payload) => {
        server = viewSchema({ schemaRevision: 2, columns: [column, epicColumn, fresh], viewRevision: 3, inheritedFrom: null });
        return { schemaRevision: 2, columns: server.columns, cells: payload.cellChanges.map(cell => ({ ...cell, revision: 1 })) };
    } });
    await c.setScope(scope());
    const layoutsBefore = c.getState().layouts;
    c.setCell(row(1), column, '3'); assert.equal(await c.save(), true);
    const after = c.getState();
    assert.deepEqual(after.layouts, layoutsBefore, 'absent layouts keep the held layouts');
    assert.equal(after.viewRevision, 3); assert.equal(after.schemaRevision, 1);
    assert.deepEqual(after.savedColumns.map(item => item.id), ['cost', 'risk'], 'a fresh column is not adopted before its cells are read');
    assert.deepEqual(after.currentColumns.map(item => item.id), ['cost', 'risk', 'fresh']); assert.equal(after.currentSchemaRevision, 2);
    await settle();
    assert.equal(gets, 2); assert.equal(c.getState().schemaRevision, 2); assert.deepEqual(c.getState().columns.map(item => item.id), ['cost', 'risk', 'fresh']);
});

for (const [code, message] of [['review_group_unknown', 'This Department group is no longer configured.'], ['review_view_limit', 'This group has reached its limit of saved Sprint views.']]) test(`${code} keeps the draft and blocks the group until discard, group change or reload`, async () => {
    let saves = 0;
    const c = await fixture({ saveReview: async () => { saves++; throw Object.assign(new Error('blocked'), { status: 400, code }); } });
    await c.setScope(scope()); c.setCell(row(1), column, '3');
    assert.equal(await c.save(), false);
    assert.equal(c.getState().groupBlocked, true); assert.equal(c.getState().error, message);
    assert.equal(c.getState().dirty, true); assert.equal(c.getState().unconfirmed, false); assert.equal(c.getState().conflict, null);
    assert.equal(await c.save(), false); assert.equal(saves, 1, 'Save stays disabled while blocked');
    c.discard(); assert.equal(c.getState().groupBlocked, false);
    c.setCell(row(1), column, '3'); await c.save(); assert.equal(c.getState().groupBlocked, true);
    assert.equal(await c.refresh(), true); assert.equal(c.getState().groupBlocked, false, 'a successful reload clears it');
    await c.save(); assert.equal(c.getState().groupBlocked, true);
    await c.setScope({ ...scope(), groupId: 'g2' }); assert.equal(c.getState().groupBlocked, false);
});

test('an authentication failure never sets groupBlocked', async () => {
    const c = await fixture({ saveReview: async () => { throw Object.assign(new Error('terminal'), { name: 'AuthenticationRequiredError', status: 401, code: 'review_group_unknown' }); } });
    await c.setScope(scope()); c.setCell(row(1), column, '3');
    assert.equal(await c.save(), false); assert.equal(c.getState().groupBlocked, false); assert.equal(c.getState().error, '');
});

test('forceLoading is set only for non-automatic forced loads', async () => {
    const seen = []; let c;
    c = await fixture({ readValues: async () => { seen.push(c.getState().forceLoading); return { cells: [] }; } });
    await c.setScope(scope()); assert.deepEqual(seen, [false], 'the first load is not forced');
    await c.setScope(scope([row(1), row(2)])); assert.deepEqual(seen, [false, false], 'an incremental load is not forced');
    await c.refresh(); assert.equal(seen.at(-1), true); assert.equal(c.getState().forceLoading, false);
    await c.refresh({ automatic: true, shouldApply: () => true }); assert.equal(seen.at(-1), false);
});

test('a manual refresh failing on a later batch restores the pre-refresh cells', async () => {
    let refreshing = false, batches = 0;
    const rows = Array.from({ length: 501 }, (_, index) => row(index + 1));
    const c = await fixture({ readValues: async (_, __, batch) => {
        if (refreshing && ++batches === 2) throw Object.assign(new Error('read failed'), { status: 503 });
        return { cells: batch.issueIds.map(issueId => ({ issueId, rowKind: 'story', columnId: 'cost', value: refreshing ? '9.000' : '1.000', revision: refreshing ? 2 : 1 })) };
    } });
    await c.setScope(scope(rows));
    const before = c.getState().savedCells;
    refreshing = true;
    assert.equal(await c.refresh(), false);
    const state = c.getState();
    assert.deepEqual(state.savedCells, before, 'no mixed-vintage cells remain');
    assert.equal(Object.values(state.cells).every(cell => cell.value === '1.000'), true);
    assert.equal(state.forceLoading, false); assert.match(state.error, /could not be loaded/);
    assert.equal(c.isRowReadable(row(501)), true);
});

// Department group scope (#267, Task C2).
const loadScope = () => import('../frontend/src/eng/usePlanningGroupScope.js');

function bundleHook(entry) {
    const pathModule = require('node:path');
    const code = require('esbuild').buildSync({ entryPoints: [pathModule.join(__dirname, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

function renderProbe(useHook, args) {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    let result;
    function Probe() { result = useHook(args); return null; }
    renderToString(React.createElement(Probe));
    return result;
}

test('a guarded group change while the review is dirty applies only after the guard proceeds, and Stay changes nothing', async () => {
    const { guardGroupChange } = await loadScope();
    const c = await fixture();
    await c.setScope(scope()); await settle();
    c.setCell(row(1), column, '5');
    assert.equal(c.getState().dirty, true);
    const guardRef = { current: c.guardScopeChange };
    const applied = [], tracked = [];
    const stay = guardGroupChange({ guardRef, currentGroupId: 'g1', next: 'g2', setActiveGroupId: value => applied.push(value), onCommit: () => tracked.push('group') });
    assert.equal(c.getState().pendingScopeChange, true);
    assert.equal(await c.resolveScopeChange('stay'), false);
    assert.equal(await stay, false);
    assert.deepEqual(applied, []); assert.deepEqual(tracked, [], 'Stay reports nothing');
    const discard = guardGroupChange({ guardRef, currentGroupId: 'g1', next: previous => `${previous}-next`, setActiveGroupId: value => applied.push(value), onCommit: () => tracked.push('group') });
    assert.equal(await c.resolveScopeChange('discard'), true);
    assert.equal(await discard, true);
    assert.equal(typeof applied[0], 'function', 'a functional updater is passed through');
    assert.equal(applied[0]('g1'), 'g1-next'); assert.deepEqual(tracked, ['group']);
});

test('choosing the current group never prompts, and a missing guard applies at once', async () => {
    const { guardGroupChange } = await loadScope();
    let prompts = 0;
    const guardRef = { current: () => { prompts += 1; return Promise.resolve(false); } };
    const applied = [];
    assert.equal(await guardGroupChange({ guardRef, currentGroupId: 'g1', next: 'g1', setActiveGroupId: value => applied.push(value) }), true);
    assert.equal(await guardGroupChange({ guardRef, currentGroupId: 'g1', next: () => 'g1', setActiveGroupId: value => applied.push(value) }), true);
    assert.equal(prompts, 0);
    assert.equal(await guardGroupChange({ guardRef: { current: null }, currentGroupId: 'g1', next: 'g2', setActiveGroupId: value => applied.push(value) }), true);
    assert.deepEqual(applied.filter(value => typeof value === 'string'), ['g1', 'g2']);
});

test('a group switch from an automatic writer discards the dirty draft like a context change', async () => {
    const c = await fixture();
    await c.setScope(scope()); await settle();
    c.setCell(row(1), column, '5');
    await c.setScope({ ...scope(), groupId: 'g2' }); await settle();
    assert.equal(c.getState().dirty, false); assert.equal(c.getState().groupId, 'g2');
});

test('a transiently null active group keeps the previous review scope and is not a group change (AC 13)', async () => {
    const { nextReviewGroupId, usePlanningGroupScope } = await loadScope();
    assert.equal(nextReviewGroupId('', { id: 'g1' }), 'g1');
    assert.equal(nextReviewGroupId('g1', null), 'g1');
    assert.equal(nextReviewGroupId('g1', { id: 'g2' }), 'g2');
    const { usePlanningGroupScope: hook } = bundleHook('../frontend/src/eng/usePlanningGroupScope.js');
    assert.equal(typeof usePlanningGroupScope, 'function');
    const base = { planningReviewGuardRef: { current: null }, activeGroupId: 'g1', setActiveGroupId: () => {}, savedPrefs: {} };
    assert.deepEqual((({ reviewGroupId, reviewGroupReady }) => ({ reviewGroupId, reviewGroupReady }))(renderProbe(hook, { ...base, activeGroup: { id: 'g1' }, groupsLoading: false })), { reviewGroupId: 'g1', reviewGroupReady: true });
    assert.equal(renderProbe(hook, { ...base, activeGroup: { id: 'g1' }, groupsLoading: true }).reviewGroupReady, false, 'groups loading keeps the review inactive');
    assert.equal(renderProbe(hook, { ...base, activeGroup: null, groupsLoading: false }).reviewGroupReady, false, 'no resolved group keeps the review inactive');
    // The controller keeps its scope (and the draft) while inactive under the same group.
    const c = await fixture();
    await c.setScope(scope()); await settle();
    c.setCell(row(1), column, '5');
    await c.setScope({ ...scope(), active: false }); await settle();
    assert.equal(c.getState().dirty, true); assert.equal(c.getState().groupId, 'g1');
});

test('inherited-hint dismissals keep the newest 50, an overwrite counts as newest, and they survive a preferences write', async () => {
    const { INHERITED_HINT_DISMISSAL_LIMIT, normalizeInheritedHintDismissals, recordInheritedHintDismissal, isInheritedHintDismissed } = await loadScope();
    assert.equal(INHERITED_HINT_DISMISSAL_LIMIT, 50);
    let map = {};
    for (let sprint = 1; sprint <= 50; sprint++) map = recordInheritedHintDismissal(map, { groupId: 'g1', sprintId: String(sprint), inheritedFrom: { sprintId: '0', viewRevision: 1 } });
    map = recordInheritedHintDismissal(map, { groupId: 'g1', sprintId: '1', inheritedFrom: { sprintId: '0', viewRevision: 2 } });
    map = recordInheritedHintDismissal(map, { groupId: 'g2', sprintId: '1', inheritedFrom: { sprintId: '0', viewRevision: 1 } });
    assert.equal(Object.keys(map).length, 50);
    const at = sprintId => ({ groupId: 'g1', sprintId, inheritedFrom: { sprintId: '0', viewRevision: sprintId === '1' ? 2 : 1 } });
    assert.equal(isInheritedHintDismissed(map, at('1')), true, 'the overwritten entry is newest and kept');
    assert.equal(isInheritedHintDismissed(map, at('2')), false, 'the oldest entry is dropped');
    assert.equal(isInheritedHintDismissed(map, at('3')), true);
    assert.equal(isInheritedHintDismissed(map, { groupId: 'g2', sprintId: '1', inheritedFrom: { sprintId: '0', viewRevision: 1 } }), true);
    // A saveUiPrefs write is a JSON round trip of the whole preferences object.
    const stored = {};
    global.window = { localStorage: { setItem: (key, value) => { stored[key] = value; }, getItem: key => stored[key] ?? null } };
    try {
        const { saveUiPrefs, loadUiPrefs } = bundleHook('../frontend/src/dashboardRuntime.js');
        saveUiPrefs({ planningLayout: 'table', planningInheritedHintDismissals: map });
        saveUiPrefs({ planningLayout: 'list', planningInheritedHintDismissals: map });
        assert.deepEqual(normalizeInheritedHintDismissals(loadUiPrefs().planningInheritedHintDismissals), map);
    } finally { delete global.window; }
    assert.deepEqual(normalizeInheritedHintDismissals(null), {});
    assert.deepEqual(normalizeInheritedHintDismissals({ bad: 1, '5:g1': { sourceSprintId: '4', viewRevision: 'x' }, '6:g1': { sourceSprintId: '4', viewRevision: 3 } }), { '6:g1': { sourceSprintId: '4', viewRevision: 3 } });
});

test('a dismissed hint returns when the source Sprint or its viewRevision changes', async () => {
    const { recordInheritedHintDismissal, isInheritedHintDismissed } = await loadScope();
    const map = recordInheritedHintDismissal({}, { groupId: 'g1', sprintId: '20', inheritedFrom: { sprintId: '10', viewRevision: 3 } });
    assert.equal(isInheritedHintDismissed(map, { groupId: 'g1', sprintId: '20', inheritedFrom: { sprintId: '10', viewRevision: 3 } }), true);
    assert.equal(isInheritedHintDismissed(map, { groupId: 'g1', sprintId: '20', inheritedFrom: { sprintId: '10', viewRevision: 4 } }), false);
    assert.equal(isInheritedHintDismissed(map, { groupId: 'g1', sprintId: '20', inheritedFrom: { sprintId: '12', viewRevision: 3 } }), false);
    assert.equal(isInheritedHintDismissed(map, { groupId: 'g2', sprintId: '20', inheritedFrom: { sprintId: '10', viewRevision: 3 } }), false);
    assert.equal(isInheritedHintDismissed(map, { groupId: 'g1', sprintId: '20', inheritedFrom: null }), false);
    assert.deepEqual(recordInheritedHintDismissal(map, { groupId: 'g1', sprintId: '21', inheritedFrom: null }), map, 'nothing to dismiss without a source');
});

test('the hook seeds dismissals from saved preferences', async () => {
    const { usePlanningGroupScope: hook } = bundleHook('../frontend/src/eng/usePlanningGroupScope.js');
    const saved = { '20:g1': { sourceSprintId: '10', viewRevision: 3 } };
    const result = renderProbe(hook, { planningReviewGuardRef: { current: null }, activeGroup: { id: 'g1' }, groupsLoading: false, activeGroupId: 'g1', setActiveGroupId: () => {}, savedPrefs: { planningInheritedHintDismissals: saved } });
    assert.deepEqual(result.inheritedHintDismissals, saved);
    assert.equal(typeof result.dismissInheritedHint, 'function');
});

test('a Settings Save that changes the active group while the review is dirty prompts, and Stay aborts before the save request', async () => {
    const { useGroupVisibilityPreferences } = bundleHook('../frontend/src/settings/useGroupVisibilityPreferences.js');
    const realFetch = global.fetch;
    let requests = 0, prompts = 0, answer = false;
    global.fetch = async () => { requests += 1; return { ok: false, status: 500, json: async () => ({}) }; };
    try {
        const groups = { groups: [{ id: 'g1', teamIds: ['t1'] }, { id: 'g2', teamIds: ['t2'] }] };
        const args = {
            backendUrl: '', groupsConfig: groups, groupsLoading: false, groupDraft: groups, activeGroupId: 'g1', setActiveGroupId: () => {},
            applyPreferenceGroupsSnapshot: () => {}, trackSettingsAction: () => {}, bucketCount: () => '1', useBackendPreferences: true,
            groupChangeGuardRef: { current: () => { prompts += 1; return Promise.resolve(answer); } },
        };
        const hook = renderProbe(useGroupVisibilityPreferences, args);
        // The first-run save targets another group: Stay returns without any request.
        assert.deepEqual(await hook.saveFirstRunGroupPreferences({ groupsSnapshot: groups, selectedGroupId: 'g2' }), { ok: false, stayed: true });
        assert.equal(prompts, 1); assert.equal(requests, 0);
        // The Settings Save path: the favorite draft is the server-side active group after the save.
        await assert.rejects(hook.persistGroupPreferences(groups), /not saved/);
        assert.equal(prompts, 2); assert.equal(requests, 0, 'Stay sends no preference request');
        answer = true;
        await hook.saveFirstRunGroupPreferences({ groupsSnapshot: groups, selectedGroupId: 'g2' });
        assert.equal(prompts, 3); assert.ok(requests > 0, 'Save or Discard continues to the preference request');
        // Saving the current group never prompts.
        const before = prompts;
        await hook.saveFirstRunGroupPreferences({ groupsSnapshot: groups, selectedGroupId: 'g1' });
        assert.equal(prompts, before);
    } finally { global.fetch = realFetch; }
});
