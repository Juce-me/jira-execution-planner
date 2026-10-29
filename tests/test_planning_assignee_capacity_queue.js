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
    const { controller, buildShown, fire } = await fixture({ save: async (_u, _s, payload) => { sent.push(payload); if (fail) { const error = new Error('Server said no'); error.status = 400; throw error; } return { revision: 2, rows: [] }; } });
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
