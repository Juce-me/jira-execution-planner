const test = require('node:test');
const assert = require('node:assert/strict');
const loadController = () => import('../frontend/src/eng/usePlanningAssigneeCapacity.js');
const loadModel = () => import('../frontend/src/eng/planningAssigneeCapacityModel.js');

const story = (key, accountId, name, sp) => ({ key, fields: { assignee: { accountId, displayName: name }, customfield_10004: sp, status: { name: 'To Do' } } });
const tasks = [story('A-1', 'u1', 'Ann', 3), story('A-2', 'u2', 'Bob', 2)];
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const caps = { canRead: true, canSave: true };
const doc = (overrides = {}) => ({ teamId: 't1', sprintId: '100', revision: 1, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5', vacations: null, notes: null, removed: false }], inherited: null, capabilities: caps, ...overrides });

async function fixture({ document = doc(), save, fetch } = {}) {
    const { createAssigneeCapacityController } = await loadController();
    const model = await loadModel();
    const calls = { gets: [], patches: [] };
    const timers = [];
    const controller = createAssigneeCapacityController({
        fetchCapacity: fetch || (async (...args) => { calls.gets.push(args); return document; }),
        saveCapacity: save || (async (_url, _sprint, payload, options) => { calls.patches.push({ payload, options }); return { revision: 2, rows: [] }; }),
        setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimer: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    });
    const buildShown = document => {
        const view = model.buildAssigneeRows({ document, teamTasksList: tasks, selectedTasks: [] });
        return { rows: view.rows, removedKeys: view.removed.map(entry => entry.key) };
    };
    const fire = async () => { const due = timers.splice(0).filter(timer => timer.fn); due.forEach(timer => timer.fn()); await settle(); };
    return { controller, calls, timers, buildShown, fire, model };
}

test('first expansion fetches once; a change of active alone does not refetch other scopes', async () => {
    const { controller, calls } = await fixture();
    controller.setScope({ sprintId: '100', teamId: 't1', active: false });
    await settle();
    assert.equal(calls.gets.length, 0);
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(calls.gets.length, 1);
    assert.equal(controller.getState().load, 'ready');
});

test('three quick commits across one row coalesce into one PATCH and no no-op request is sent', async () => {
    const { controller, calls, buildShown, fire } = await fixture();
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown), true);
    controller.commit({ key: 'u1', field: 'vacations', value: '1' }, buildShown);
    controller.commit({ key: 'u1', field: 'notes', value: 'away' }, buildShown);
    controller.commit({ key: 'u2', field: 'capacity', value: null }, buildShown); // equals shown (blank): no-op
    assert.equal(controller.getState().changes.length, 1);
    await fire();
    assert.equal(calls.patches.length, 1);
    assert.deepEqual(calls.patches[0].payload, { teamId: 't1', changes: [{ assigneeKey: 'u1', capacity: '6', vacations: '1', notes: 'away' }] });
    assert.equal(controller.getState().save, 'saved');
});

test('typing back to the stored value inside the window sends nothing', async () => {
    const { controller, calls, buildShown, fire } = await fixture();
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '9' }, buildShown);
    controller.commit({ key: 'u1', field: 'capacity', value: '5' }, buildShown);
    await fire();
    assert.equal(calls.patches.length, 0);
    assert.equal(controller.getState().changes.length, 0);
});

test('one request is in flight at a time; commits made meanwhile follow in a second request', async () => {
    const first = deferred();
    const patches = [];
    const { controller, buildShown, fire } = await fixture({ save: (_u, _s, payload) => { patches.push(payload); return patches.length === 1 ? first.promise : Promise.resolve({ revision: 3, rows: [] }); } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    await fire();
    assert.equal(patches.length, 1);
    controller.commit({ key: 'u1', field: 'notes', value: 'x' }, buildShown);
    await fire();
    assert.equal(patches.length, 1, 'the second commit waits for the in-flight request');
    first.resolve({ revision: 2, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '6', vacations: null, notes: null, removed: false }] });
    await settle();
    assert.equal(patches.length, 2);
    assert.equal(patches[1].changes[0].notes, 'x');
});

test('the first edit of a gray inherited row sends only the edited field, and the row stays whole afterwards', async () => {
    const inherited = doc({ revision: 0, rows: [], inherited: { fromSprintId: '99', rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5', vacations: '2', notes: 'n', removed: false }] } });
    const { controller, calls, buildShown, fire, model } = await fixture({ document: inherited });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '5' }, buildShown); // tabbing across a gray cell
    await fire();
    assert.equal(calls.patches.length, 0);
    controller.commit({ key: 'u1', field: 'vacations', value: '3' }, buildShown);
    const shown = model.buildAssigneeRows({ document: model.applyChangesToDocument(controller.getState().document, controller.getState().changes), teamTasksList: tasks, selectedTasks: [] });
    const ann = shown.rows.find(row => row.key === 'u1');
    assert.equal(ann.capacity, '5', 'Capacity is kept when only Vacations is edited');
    assert.equal(ann.vacations, '3');
    assert.equal(ann.inherited, false);
    await fire();
    assert.deepEqual(calls.patches[0].payload.changes, [{ assigneeKey: 'u1', vacations: '3' }]);
});

test('an unconfirmed PATCH is recovered by reload and a resend of only the differing fields', async () => {
    let patches = 0;
    const sent = [];
    const reloaded = doc({ revision: 2, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '6', vacations: null, notes: null, removed: false }] });
    const { controller, buildShown, fire } = await fixture({
        save: async (_u, _s, payload) => { patches += 1; sent.push(payload); if (patches === 1) { const error = new Error('lost'); error.unconfirmed = true; throw error; } return { revision: 3, rows: [] }; },
        fetch: async () => reloaded,
    });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    controller.commit({ key: 'u1', field: 'notes', value: 'hi' }, buildShown);
    await fire();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].changes, [{ assigneeKey: 'u1', notes: 'hi' }], 'capacity already stored: only notes is resent');
    assert.equal(controller.getState().save, 'saved');
});

test('an unconfirmed PATCH whose fields are all stored finishes without a second request', async () => {
    let patches = 0;
    const stored = doc({ revision: 2, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '6', vacations: null, notes: null, removed: false }] });
    let reads = 0;
    const { controller, buildShown, fire } = await fixture({
        save: async () => { patches += 1; const error = new Error('lost'); error.unconfirmed = true; throw error; },
        fetch: async () => (++reads === 1 ? doc() : stored),
    });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    await fire();
    assert.equal(patches, 1);
    assert.equal(controller.getState().save, 'saved');
});

test('a failed save keeps the draft visible and rides along with the next commit', async () => {
    let fail = true;
    const sent = [];
    const { controller, buildShown, fire } = await fixture({ save: async (_u, _s, payload) => { sent.push(payload); if (fail) { const error = new Error('Server said no'); error.status = 503; throw error; } return { revision: 2, rows: [] }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    await fire();
    assert.equal(controller.getState().save, 'failed');
    assert.equal(controller.getState().error, 'Server said no');
    assert.equal(controller.getState().changes[0].capacity, '6');
    fail = false;
    controller.commit({ key: 'u1', field: 'notes', value: 'x' }, buildShown);
    await fire();
    assert.deepEqual(sent[1].changes, [{ assigneeKey: 'u1', capacity: '6', notes: 'x' }]);
    assert.equal(controller.getState().save, 'saved');
});

test('a 401 keeps the drafts and stops the queue without a failure banner', async () => {
    const { controller, buildShown, fire } = await fixture({ save: async () => { const error = new Error('signed out'); error.name = 'AuthenticationRequiredError'; throw error; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    await fire();
    assert.equal(controller.getState().save, 'idle');
    assert.equal(controller.getState().changes[0].capacity, '6');
    assert.equal(controller.commit({ key: 'u1', field: 'capacity', value: '7' }, buildShown), false);
});

test('a scope change flushes unsaved commits for the old scope and drops late responses for it', async () => {
    const gate = deferred();
    const patches = [];
    const { controller, buildShown, fire, timers } = await fixture({ save: (_u, sprintId, payload) => { patches.push({ sprintId, payload }); return gate.promise; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    controller.setScope({ sprintId: '100', teamId: 't2', active: true });
    await settle();
    assert.equal(patches.length, 1, 'flushed at once, not after the 200 ms window');
    assert.equal(patches[0].payload.teamId, 't1');
    assert.equal(controller.getState().teamId, 't2');
    assert.deepEqual(controller.getState().changes, []);
    gate.resolve({ revision: 2, rows: [] });
    await settle();
    assert.equal(controller.getState().teamId, 't2');
    assert.equal(controller.getState().save, 'idle', 'the old scope\'s response does not touch this scope');
    assert.ok(timers.length >= 0);
});

test('a read answered after a scope change is dropped', async () => {
    const slow = deferred();
    let call = 0;
    const { controller, fire } = await fixture({ fetch: () => (++call === 1 ? slow.promise : Promise.resolve(doc({ teamId: 't2' }))) });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    controller.setScope({ sprintId: '100', teamId: 't2', active: true });
    await fire();
    slow.resolve(doc({ rows: [{ assigneeKey: 'late', displayName: 'Late', capacity: '1', vacations: null, notes: null, removed: false }] }));
    await settle();
    assert.equal(controller.getState().teamId, 't2');
    assert.ok(!controller.getState().document.rows.some(row => row.assigneeKey === 'late'));
});

test('read-only and read-failure states', async () => {
    const readOnly = await fixture({ document: doc({ capabilities: { canRead: true, canSave: false, reason: 'database_required' } }) });
    readOnly.controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(readOnly.controller.commit({ key: 'u1', field: 'capacity', value: '6' }, readOnly.buildShown), false);
    const broken = await fixture({ fetch: async () => { throw new Error('boom'); } });
    broken.controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(broken.controller.getState().load, 'error');
});

test('the CSRF cache object is shared by every PATCH of the queue', async () => {
    const seen = [];
    const { controller, buildShown, fire } = await fixture({ save: async (_u, _s, _p, options) => { seen.push(options.csrf); options.csrf.token = 'synthetic'; return { revision: 2, rows: [] }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown); await fire();
    controller.commit({ key: 'u1', field: 'capacity', value: '7' }, buildShown); await fire();
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
});

test('a change the server refuses (400) waits for Retry or Discard and never rides along with later commits', async () => {
    const sent = [];
    const { controller, buildShown, fire } = await fixture({ save: async (_u, _s, payload) => {
        sent.push(payload);
        if (payload.changes.some(change => change.notes === 'bad')) { const error = new Error('Refused'); error.status = 400; throw error; }
        return { revision: sent.length + 1, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: payload.changes[0].capacity ?? '5', vacations: null, notes: null, removed: false }] };
    } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'notes', value: 'bad' }, buildShown);
    await fire();
    assert.equal(controller.getState().save, 'failed');
    assert.equal(controller.getState().changes[0].notes, 'bad', 'the refused draft stays visible');
    controller.commit({ key: 'u2', field: 'capacity', value: '4' }, buildShown);
    await fire();
    assert.deepEqual(sent[1].changes, [{ assigneeKey: 'u2', displayName: 'Bob', capacity: '4' }], 'the refused change is not resent with a later batch');
    assert.equal(controller.getState().save, 'failed', 'still Not saved while a refused change waits');
    assert.ok(controller.isBusy());
    controller.discard();
    assert.equal(controller.getState().save, 'idle');
    assert.equal(controller.getState().error, '');
    assert.deepEqual(controller.getState().changes, []);
    assert.equal(controller.isBusy(), false);
    await fire();
    assert.equal(sent.length, 2, 'discard sends nothing');
});

test('a newer commit of a refused field replaces it; Retry resends refused changes', async () => {
    let refuse = true;
    const sent = [];
    const { controller, buildShown, fire } = await fixture({ save: async (_u, _s, payload) => { sent.push(payload); if (refuse) { const error = new Error('Refused'); error.status = 400; throw error; } return { revision: 2, rows: [] }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'notes', value: 'bad' }, buildShown);
    await fire();
    refuse = false;
    controller.commit({ key: 'u1', field: 'notes', value: 'good' }, buildShown);
    await fire();
    assert.deepEqual(sent[1].changes, [{ assigneeKey: 'u1', notes: 'good' }]);
    assert.equal(controller.getState().save, 'saved');
    refuse = true;
    controller.commit({ key: 'u1', field: 'vacations', value: '2' }, buildShown);
    await fire();
    assert.equal(controller.getState().save, 'failed');
    refuse = false;
    controller.retry();
    await settle();
    assert.deepEqual(sent.at(-1).changes, [{ assigneeKey: 'u1', displayName: 'Ann', vacations: '2' }]);
    assert.equal(controller.getState().save, 'saved');
});

test('an invalid displayName snapshot is cleaned before sending, so it cannot fail the batch', async () => {
    const sent = [];
    const { controller, fire } = await fixture({ save: async (_u, _s, payload) => { sent.push(payload); return { revision: 2, rows: [] }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    const shown = () => ({ rows: [{ key: 'u9', storyName: `Long\u0007${'y'.repeat(250)}`, storedName: null, capacity: null }], removedKeys: [] });
    controller.commit({ key: 'u9', field: 'capacity', value: '3' }, shown);
    await fire();
    const [change] = sent[0].changes;
    assert.equal(change.displayName.length, 200);
    assert.equal(/[\u0000-\u001f]/.test(change.displayName), false);
});

test('a failed background save is kept per scope: a revisit shows Not saved with the drafts and Retry; at most five scopes are kept', async () => {
    let fail = true;
    const sent = [];
    const { controller, buildShown, fire } = await fixture({ save: async (_u, sprintId, payload) => { sent.push({ sprintId, payload }); if (fail) { const error = new Error('Server unavailable'); error.status = 503; throw error; } return { revision: 2, rows: [] }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    controller.setScope({ sprintId: '100', teamId: 't2', active: true });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(controller.getState().save, 'idle', 'the left scope\'s failure does not show here');
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    assert.equal(controller.getState().save, 'failed');
    assert.equal(controller.getState().error, 'Server unavailable');
    assert.equal(controller.getState().changes[0].capacity, '6');
    fail = false;
    controller.retry();
    await settle();
    assert.equal(controller.getState().save, 'saved');
    assert.deepEqual(sent.at(-1).payload.changes, [{ assigneeKey: 'u1', capacity: '6' }]);
    // Six failed scopes: the oldest is dropped.
    fail = true;
    for (const team of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
        controller.setScope({ sprintId: '100', teamId: team, active: true });
        await fire();
        controller.commit({ key: 'u1', field: 'capacity', value: '7' }, buildShown);
    }
    controller.setScope({ sprintId: '100', teamId: 'done', active: true });
    await settle();
    await fire();
    controller.setScope({ sprintId: '100', teamId: 'a6', active: true });
    assert.equal(controller.getState().save, 'failed');
    controller.setScope({ sprintId: '100', teamId: 'a1', active: true });
    assert.equal(controller.getState().save, 'idle', 'the sixth-oldest failed scope is no longer kept');
    assert.deepEqual(controller.getState().changes, []);
});

test('returning to a scope whose save is still running reuses its queue: one request, and the late response shows there', async () => {
    const gate = deferred();
    const sent = [];
    const { controller, buildShown } = await fixture({ save: (_u, _s, payload) => { sent.push(payload); return gate.promise; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    controller.setScope({ sprintId: '100', teamId: 't2', active: true });
    await settle();
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    assert.equal(controller.getState().save, 'saving');
    gate.resolve({ revision: 2, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '6', vacations: null, notes: null, removed: false }] });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(controller.getState().save, 'saved');
    assert.equal(controller.getState().document.rows[0].capacity, '6');
});

test('a 403 csrf_required clears the cached token and resends once with a fresh one', async () => {
    const tokens = [];
    let calls = 0;
    const { controller, buildShown, fire } = await fixture({ save: async (_u, _s, _p, options) => {
        calls += 1;
        tokens.push(options.csrf.token);
        if (calls === 1) { options.csrf.token = 'stale'; const error = new Error('csrf'); error.status = 403; error.code = 'csrf_required'; throw error; }
        options.csrf.token = 'fresh';
        return { revision: 2, rows: [] };
    } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commit({ key: 'u1', field: 'capacity', value: '6' }, buildShown);
    await fire();
    assert.equal(calls, 2);
    assert.deepEqual(tokens, [null, null], 'the second attempt starts without the rejected token');
    assert.equal(controller.getState().save, 'saved');
    controller.commit({ key: 'u1', field: 'capacity', value: '7' }, buildShown);
    await fire();
    assert.equal(tokens.at(-1), 'fresh', 'the refetched token is reused by the queue');
});

test('D6: the document is read once per one-Team scope whether or not the strip is expanded', async () => {
    const { controller, calls } = await fixture();
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(calls.gets.length, 1);
    controller.setScope({ sprintId: '100', teamId: '', active: false });
    await settle();
    assert.equal(calls.gets.length, 1, 'no scope (two Teams or All) reads nothing');
});

// #251 freshness: controller.refresh({ signal, shouldApply, automatic }).
async function refreshFixture(options = {}) {
    let next = doc();
    const reads = [];
    const f = await fixture({ ...options, fetch: async (...args) => { reads.push(args); const gate = options.gate?.(reads.length); if (gate) await gate; if (options.fail?.(reads.length)) throw Object.assign(new Error('boom'), { status: 503 }); return next; } });
    let publishes = 0;
    f.controller.subscribe(() => { publishes += 1; });
    f.controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    return { ...f, reads, setNext: value => { next = value; }, publishes: () => publishes };
}

test('refresh is ignored without a scope, without a document, while loading and while busy', async () => {
    const { createAssigneeCapacityController } = await loadController();
    const idle = createAssigneeCapacityController({ fetchCapacity: async () => doc() });
    assert.deepEqual(await idle.refresh({ automatic: true }), { status: 'ignored' }, 'no scope');
    const hold = deferred();
    const loading = createAssigneeCapacityController({ fetchCapacity: () => hold.promise, setTimer: () => 0, clearTimer: () => {} });
    loading.setScope({ sprintId: '100', teamId: 't1', active: true });
    assert.equal(loading.getState().load, 'loading');
    assert.deepEqual(await loading.refresh({ automatic: true }), { status: 'ignored' }, 'no document while loading');
    hold.resolve(doc()); await settle();
    const busy = await refreshFixture();
    busy.controller.commit({ key: 'u1', field: 'capacity', value: '6' }, busy.buildShown);
    const before = busy.reads.length;
    assert.deepEqual(await busy.controller.refresh({ automatic: true }), { status: 'ignored' }, 'pending drafts');
    assert.equal(busy.reads.length, before, 'no read while busy');
});

test('refresh publishes a changed document once, marked automatic, and keeps no-op re-reads silent', async () => {
    const f = await refreshFixture();
    const start = f.publishes();
    assert.deepEqual(await f.controller.refresh({ automatic: true }), { status: 'ok' });
    assert.equal(f.publishes(), start, 'same revision, planned and inherited: no publish');
    f.setNext(doc({ revision: 2, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '7', vacations: null, notes: null, removed: false }] }));
    assert.deepEqual(await f.controller.refresh({ automatic: true }), { status: 'ok' });
    assert.equal(f.publishes(), start + 1);
    assert.equal(f.controller.getState().document.rows[0].capacity, '7');
    assert.equal(f.controller.getState().origin, 'automatic');
    f.setNext(doc({ revision: 2, planned: { value: '20', source: 'user' }, rows: [] }));
    await f.controller.refresh({ automatic: false });
    assert.equal(f.publishes(), start + 2, 'a changed planned value publishes');
    assert.equal(f.controller.getState().origin, '', 'a manual refresh is not marked automatic');
    f.setNext(doc({ revision: 2, planned: { value: '20', source: 'user' }, inherited: { fromSprintId: '90', rows: [], planned: null }, rows: [] }));
    await f.controller.refresh({ automatic: true });
    assert.equal(f.publishes(), start + 3, 'a changed inherited block publishes');
});

test('a failed refresh keeps the held document and raises no loading or error state', async () => {
    const f = await refreshFixture({ fail: n => n > 1 });
    const held = f.controller.getState();
    assert.deepEqual(await f.controller.refresh({ automatic: true }), { status: 'failed' });
    const after = f.controller.getState();
    assert.equal(after.document, held.document);
    assert.equal(after.load, 'ready');
    assert.equal(after.error, '');
    assert.equal(after.save, 'idle');
});

test('a refresh response is dropped when the scope changed, shouldApply turned false, the signal aborted or a write started', async () => {
    for (const interrupt of ['scope', 'shouldApply', 'abort', 'edit']) {
        const gate = deferred();
        const f = await refreshFixture({ gate: n => (n === 2 ? gate.promise : null) });
        f.setNext(doc({ revision: 5, rows: [] }));
        let apply = true;
        const abort = new AbortController();
        const pending = f.controller.refresh({ automatic: true, signal: abort.signal, shouldApply: () => apply });
        if (interrupt === 'scope') f.controller.setScope({ sprintId: '101', teamId: 't1', active: true });
        if (interrupt === 'shouldApply') apply = false;
        if (interrupt === 'abort') abort.abort();
        if (interrupt === 'edit') f.controller.commit({ key: 'u1', field: 'notes', value: 'typing' }, f.buildShown);
        gate.resolve();
        assert.deepEqual(await pending, { status: 'ignored' }, interrupt);
        if (interrupt !== 'scope') {
            assert.equal(f.controller.getState().document.revision, 1, `${interrupt}: the held document stays`);
        }
        if (interrupt === 'edit') {
            assert.deepEqual(f.controller.getState().changes.map(change => change.notes), ['typing'], 'the edit in progress is preserved');
            assert.equal(f.controller.isBusy(), true);
        }
    }
});

test('only one refresh runs at a time', async () => {
    const gate = deferred();
    const f = await refreshFixture({ gate: n => (n === 2 ? gate.promise : null) });
    const first = f.controller.refresh({ automatic: true });
    assert.deepEqual(await f.controller.refresh({ automatic: true }), { status: 'ignored' });
    gate.resolve();
    assert.deepEqual(await first, { status: 'ok' });
    assert.equal(f.reads.length, 2);
});

test('a new auth session clears the cache and re-reads the current scope, holding the shown document', async () => {
    const f = await refreshFixture();
    f.controller.setScope({ sprintId: '101', teamId: 't1', active: true });
    f.timers.splice(0).forEach(timer => timer.fn?.());
    await settle();
    const reads = f.reads.length;
    const held = f.controller.getState().document;
    f.controller.resetSession();
    assert.equal(f.controller.getState().load, 'ready', 'no loading state while re-reading');
    assert.equal(f.controller.getState().document, held);
    await settle();
    assert.equal(f.reads.length, reads + 1, 'the current scope is re-read');
    f.controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    assert.equal(f.controller.getState().document, null, 'a scope read under the old session is not reused from cache');
});

// ---- Team capacity (not in Jira), #323 Task 8 ----

test('a planned commit sends one planned-only PATCH with changes: [], and an equal number sends nothing', async () => {
    const { controller, calls, fire } = await fixture({ document: doc({ planned: { value: '12', source: 'user' } }), save: async (_url, _sprint, payload) => { calls.patches.push({ payload }); return { revision: 2, rows: [], planned: payload.planned.value == null ? null : { value: payload.planned.value, source: payload.planned.source } }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.commitPlanned('12.00', 'user'), true);
    await fire();
    assert.equal(calls.patches.length, 0, 'equal after rounding: nothing sent');
    controller.commitPlanned('14.5', 'user');
    assert.equal(controller.getState().plannedSave, 'saving');
    await fire();
    assert.deepEqual(calls.patches.map(call => call.payload), [{ teamId: 't1', planned: { value: '14.5', source: 'user' }, changes: [] }]);
    assert.deepEqual(controller.getState().document.planned, { value: '14.5', source: 'user' });
    assert.equal(controller.getState().plannedSave, '');
    controller.commitPlanned(null);
    await fire();
    assert.deepEqual(calls.patches.at(-1).payload, { teamId: 't1', planned: { value: null }, changes: [] });
});

test('a planned commit rides with row changes in one PATCH; the gray number stays shown while it is pending', async () => {
    const inherited = { fromSprintId: '90', rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5', removed: false }], planned: { value: '12', source: 'inherited' } };
    const save = deferred();
    const { controller, calls, buildShown, fire, model } = await fixture({ document: doc({ revision: 0, rows: [], planned: null, inherited }), save: async (_url, _sprint, payload) => { calls.patches.push({ payload }); return save.promise; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.deepEqual(controller.getPlannedSnapshot(), { sprintId: '100', teamId: 't1', value: 12, source: 'inherited' });
    controller.commit({ key: 'u1', field: 'vacations', value: '1' }, buildShown);
    const shown = model.applyChangesToDocument(controller.getState().document, controller.getState().changes);
    assert.deepEqual(model.effectivePlanned(shown), { value: '12', source: 'inherited' }, 'a pending row commit keeps the gray number');
    assert.equal(controller.getPlannedSnapshot().value, 12);
    controller.commitPlanned('12', 'user');
    assert.equal(controller.getState().changes.length, 1, 'typing the gray number creates nothing');
    controller.commitPlanned('20', 'user');
    await fire();
    assert.deepEqual(calls.patches[0].payload, { teamId: 't1', planned: { value: '20', source: 'user' }, changes: [{ assigneeKey: 'u1', vacations: '1' }] });
    save.resolve({ revision: 1, rows: [], planned: { value: '20', source: 'user' } });
    await settle();
    assert.deepEqual(controller.getPlannedSnapshot(), { sprintId: '100', teamId: 't1', value: 20, source: 'user' });
});

test('a failed planned commit is retained as failed and resent by Retry; an unconfirmed one is recovered', async () => {
    let attempt = 0;
    const { controller, calls, fire } = await fixture({
        document: doc({ planned: null }),
        save: async (_url, _sprint, payload) => { calls.patches.push({ payload }); attempt += 1; if (attempt === 1) throw Object.assign(new Error('down'), { status: 503 }); if (attempt === 2) throw Object.assign(new Error('lost'), { unconfirmed: true }); return { revision: 3, rows: [], planned: { value: '8', source: 'user' } }; },
        fetch: async () => doc({ planned: null }),
    });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    controller.commitPlanned('8');
    await fire();
    assert.equal(controller.getState().save, 'failed');
    assert.equal(controller.getState().plannedSave, 'failed');
    assert.equal(controller.getPlannedSnapshot().value, 8, 'the failed draft stays shown');
    controller.retry();
    await settle();
    assert.deepEqual(calls.patches.map(call => call.payload.planned), [{ value: '8', source: 'user' }, { value: '8', source: 'user' }, { value: '8', source: 'user' }], 'unconfirmed: re-read, then resent once');
    assert.equal(controller.getState().save, 'saved');
    assert.equal(controller.getState().plannedSave, '');
});

test('mirror: one guarded PATCH into an own document only when the ticket differs; never over a typed number, never while busy', async () => {
    const { controller, calls, buildShown, fire } = await fixture({ document: doc({ planned: { value: '12', source: 'jira' } }), save: async (_url, _sprint, payload) => { calls.patches.push({ payload }); return { revision: 2, rows: [], planned: { value: payload.planned?.value ?? '12', source: 'jira' } }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.mirrorPlanned(12.004), false, 'equal after rounding');
    assert.equal(controller.mirrorPlanned(10001), false, 'outside 0..10000');
    assert.equal(controller.mirrorPlanned(20.555), true);
    await settle();
    assert.deepEqual(calls.patches.map(call => call.payload), [{ teamId: 't1', planned: { value: '20.56', source: 'jira', onlyIfSource: [null, 'jira', 'inherited'] }, changes: [] }]);
    assert.equal(controller.getState().save, 'idle', 'silent: no saving or saved state');
    controller.commit({ key: 'u1', field: 'capacity', value: '9' }, buildShown);
    assert.equal(controller.mirrorPlanned(30), false, 'a pending commit blocks it');
    await fire();
    assert.equal(calls.patches.length, 2);
});

test('mirror never creates a document, never runs read-only, never overwrites a user number, and a failure is dropped silently', async () => {
    for (const [name, document] of [
        ['no own document', doc({ revision: 0, rows: [], planned: null, inherited: { fromSprintId: '9', rows: [], planned: { value: '5', source: 'inherited' } } })],
        ['read-only', doc({ capabilities: { canRead: true, canSave: false } })],
        ['user number', doc({ planned: { value: '5', source: 'user' } })],
    ]) {
        const { controller, calls } = await fixture({ document });
        controller.setScope({ sprintId: '100', teamId: 't1', active: true });
        await settle();
        assert.equal(controller.mirrorPlanned(20), false, name);
        assert.equal(calls.patches.length, 0, name);
    }
    const { controller, calls, buildShown, fire } = await fixture({ document: doc({ planned: null }), save: async (_url, _sprint, payload) => { calls.patches.push({ payload }); if (payload.planned?.source === 'jira') throw Object.assign(new Error('down'), { status: 503 }); return { revision: 2, rows: [] }; } });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.mirrorPlanned(20), true, 'an absent number in an own document counts as differing');
    controller.commit({ key: 'u1', field: 'capacity', value: '9' }, buildShown);
    await settle();
    assert.notEqual(controller.getState().save, 'failed', 'a failed mirror never sets failed');
    assert.deepEqual([controller.getState().error, controller.getState().plannedSave], ['', ''], 'a failed mirror sets no error and no planned state');
    await fire();
    assert.equal(controller.getState().save, 'saved', 'the commit made meanwhile is saved; no Not saved');
    assert.deepEqual(calls.patches.map(call => Boolean(call.payload.planned)), [true, false], 'the commit made during the mirror follows it; the mirror is not replayed');
});

test('the planned snapshot keeps its identity until the number changes, and is null without a scope or after dispose', async () => {
    const { controller, buildShown } = await fixture({ document: doc({ planned: { value: '7', source: 'user' } }) });
    assert.equal(controller.getPlannedSnapshot(), null);
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    const first = controller.getPlannedSnapshot();
    assert.deepEqual(first, { sprintId: '100', teamId: 't1', value: 7, source: 'user' });
    controller.commit({ key: 'u1', field: 'notes', value: 'x' }, buildShown);
    assert.equal(controller.getPlannedSnapshot(), first, 'a row edit does not change the snapshot');
    controller.dispose();
    assert.equal(controller.getPlannedSnapshot(), null);
    assert.equal(controller.getState().scopeKey, '');
});

test('the controller is held above the provider: one per backend', async () => {
    const { getAssigneeCapacityController } = await loadController();
    assert.equal(getAssigneeCapacityController('http://a'), getAssigneeCapacityController('http://a'));
    assert.notEqual(getAssigneeCapacityController('http://a'), getAssigneeCapacityController('http://b'));
});

test('stored-number paths never import or reach the Jira capacity write', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    for (const file of ['usePlanningAssigneeCapacity.js', 'planningAssigneeCapacityModel.js', 'PlanningAssigneeCapacity.jsx']) {
        const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng', file), 'utf8');
        assert.doesNotMatch(source, /capacityApi|updateCapacity|updateCapacityRequest/, file);
    }
    const cards = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng/PlanningTeamCapacityCards.jsx'), 'utf8');
    assert.equal((cards.match(/updateCapacityRequest\(/g) || []).length, 1, 'one Jira call site, the existing editor Save');
    const planned = cards.slice(cards.indexOf('const openPlannedEditor'), cards.indexOf('const cancelEditor'))
        + cards.slice(cards.indexOf('const submitPlannedEditor'), cards.indexOf('const submitEditor'));
    assert.doesNotMatch(planned, /onAnalyticsAction|updateCapacityRequest/, 'the stored-number editor emits no capacity_* event and never writes Jira');
});

test('Add assignee: a new person is one PATCH with the name snapshot and no Capacity; existing is a no-op; removed is Restore', async () => {
    const removedDoc = doc({ rows: [
        { assigneeKey: 'u1', displayName: 'Ann', capacity: '5', vacations: null, notes: null, removed: false },
        { assigneeKey: 'u9', displayName: 'Old', capacity: '2', vacations: null, notes: null, removed: true },
    ] });
    const { controller, calls, buildShown, fire } = await fixture({ document: removedDoc });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.addPerson({ accountId: 'u1', displayName: 'Ann' }, buildShown), 'exists');
    assert.equal(controller.addPerson({ accountId: 'u2', displayName: 'Bob' }, buildShown), 'exists', 'a person with Stories is already a row');
    assert.equal(controller.addPerson({ accountId: '', displayName: 'Nobody' }, buildShown), false);
    assert.equal(controller.getState().changes.length, 0);
    assert.equal(controller.addPerson({ accountId: 'u7', displayName: 'Cy' }, buildShown), 'add');
    assert.equal(controller.addPerson({ accountId: 'u9', displayName: 'Old' }, buildShown), 'restore');
    assert.equal(controller.addPerson({ accountId: 'u7', displayName: 'Cy' }, buildShown), 'exists', 'the pending row is shown at once');
    await fire();
    assert.equal(calls.patches.length, 1);
    assert.deepEqual(calls.patches[0].payload, { teamId: 't1', changes: [{ assigneeKey: 'u7', displayName: 'Cy' }, { assigneeKey: 'u9', removed: false }] });
});

test('Add assignee into an inherited Sprint materialises it with the new person (one first write)', async () => {
    const inheritedDoc = doc({ revision: 0, rows: [], inherited: { fromSprintId: '90', planned: null, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5', removed: false }] } });
    const { controller, calls, buildShown, fire } = await fixture({ document: inheritedDoc });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.addPerson({ accountId: 'u1', displayName: 'Ann' }, buildShown), 'exists', 'an inherited person is already a row');
    assert.equal(controller.addPerson({ accountId: 'u7', displayName: 'Cy' }, buildShown), 'add');
    await fire();
    assert.deepEqual(calls.patches[0].payload.changes, [{ assigneeKey: 'u7', displayName: 'Cy' }]);
});

test('Add assignee is refused read-only', async () => {
    const { controller, buildShown } = await fixture({ document: doc({ capabilities: { canRead: true, canSave: false } }) });
    controller.setScope({ sprintId: '100', teamId: 't1', active: true });
    await settle();
    assert.equal(controller.addPerson({ accountId: 'u7', displayName: 'Cy' }, buildShown), false);
});
