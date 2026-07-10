const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/engIssueLocalUpdates.js');
}

test('local issue field update patches only the selected Story and preserves other references', async () => {
    const { applyLocalIssueFieldUpdate } = await loadUtils();
    const first = { key: 'PROD-1', fields: { status: { name: 'To Do' }, priority: { name: 'Medium' } } };
    const second = { key: 'PROD-2', fields: { status: { name: 'To Do' }, priority: { name: 'High' } } };
    const issues = [first, second];

    const updated = applyLocalIssueFieldUpdate(issues, 'PROD-1', 'status', { name: 'In Progress' });

    assert.notEqual(updated, issues);
    assert.equal(updated[0].fields.status.name, 'In Progress');
    assert.equal(updated[0].fields.priority, first.fields.priority);
    assert.equal(updated[1], second);
    assert.equal(applyLocalIssueFieldUpdate(issues, 'UNKNOWN-1', 'status', { name: 'Done' }), issues);
});

test('local issue field update patches flat Epic rows and keyed Epic details only for one key', async () => {
    const { applyLocalIssueFieldUpdate, applyLocalEpicDetailsFieldUpdate } = await loadUtils();
    const epicOne = { key: 'PROD-EPIC', status: { name: 'In Progress' }, priority: { name: 'High' } };
    const epicTwo = { key: 'TECH-EPIC', status: { name: 'To Do' }, priority: { name: 'Medium' } };

    const rows = applyLocalIssueFieldUpdate([epicOne, epicTwo], 'PROD-EPIC', 'priority', { name: 'Low' });
    assert.equal(rows[0].priority.name, 'Low');
    assert.equal(rows[0].status, epicOne.status);
    assert.equal(rows[1], epicTwo);

    const details = { 'PROD-EPIC': epicOne, 'TECH-EPIC': epicTwo };
    const updatedDetails = applyLocalEpicDetailsFieldUpdate(details, 'PROD-EPIC', 'status', { name: 'Done' });
    assert.equal(updatedDetails['PROD-EPIC'].status.name, 'Done');
    assert.equal(updatedDetails['TECH-EPIC'], epicTwo);
    assert.equal(applyLocalEpicDetailsFieldUpdate(details, 'UNKNOWN-1', 'status', { name: 'Done' }), details);
});

test('local subtask field update patches the matching expanded row without refetching its parent', async () => {
    const { applyLocalSubtaskFieldUpdate } = await loadUtils();
    const state = {
        'PROD-1': {
            expanded: true,
            items: [
                { key: 'PROD-1-A', status: { name: 'To Do' } },
                { key: 'PROD-1-B', status: { name: 'In Progress' } },
            ],
        },
        'PROD-2': { expanded: true, items: [{ key: 'PROD-2-A', status: { name: 'To Do' } }] },
    };

    const updated = applyLocalSubtaskFieldUpdate(state, 'PROD-1-A', 'status', { name: 'Done' });

    assert.equal(updated['PROD-1'].items[0].status.name, 'Done');
    assert.equal(updated['PROD-1'].items[1], state['PROD-1'].items[1]);
    assert.equal(updated['PROD-2'], state['PROD-2']);
    assert.equal(applyLocalSubtaskFieldUpdate(state, 'UNKNOWN-1', 'status', { name: 'Done' }), state);
});

