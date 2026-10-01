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
    c.setCell(row(1), column, '0.125');
    await c.setScope({ ...scope([]), active: false });
    await c.setScope(scope());
    assert.equal(reads, 1); assert.equal(schemas, 1);
    assert.equal(c.getState().dirty, true);
    assert.equal(Object.values(c.getState().drafts)[0].value, '0.125');
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
