const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/eng/planningRowDetailsModel.js');

test('flat parent and native child metadata adapt to read-only issue fields', async () => {
    const { planningDetailsIssue } = await load();
    const parent = planningDetailsIssue({ rowKind: 'epic', team: { name: 'Alpha' }, issue: { key: 'SYN-1', summary: 'Parent', status: 'To Do', assignee: 'Example person', storyPoints: 8 } });
    assert.deepEqual(parent.fields.status, { name: 'To Do' });
    assert.equal(parent.fields.summary, 'Parent');
    assert.equal(parent.fields.assignee.displayName, 'Example person');
    assert.equal(parent.fields.teamName, 'Alpha');
    assert.equal(parent.fields.customfield_10004, 8);
    const child = { key: 'SYN-2', fields: { summary: 'Child', status: { name: 'Done' }, issuetype: { name: 'Epic' } } };
    assert.equal(planningDetailsIssue(child).fields.issuetype.name, 'Epic');
    assert.equal(planningDetailsIssue({ synthetic: true }), null);
});

test('related category contains every deduplicated target including visible rows', async () => {
    const { planningRelatedKeys } = await load();
    const data = { 'SYN-1': [{ key: 'SYN-2', category: 'dependency', direction: 'outward' }, { key: 'SYN-2', category: 'dependency', direction: 'outward' }, { key: 'SYN-3', category: 'dependency', direction: 'inward' }, { key: 'SYN-4', category: 'block', prereqKey: 'SYN-4', dependentKey: 'SYN-1' }] };
    assert.deepEqual(planningRelatedKeys(data, 'SYN-1', 'depends-on'), ['SYN-2']);
    assert.deepEqual(planningRelatedKeys(data, 'SYN-1', 'dependents'), ['SYN-3']);
    assert.deepEqual(planningRelatedKeys(data, 'SYN-1', 'blocked-by'), ['SYN-4']);
    assert.deepEqual(planningRelatedKeys(data, 'SYN-1', 'invalid'), []);
});

test('explicit related batch reads at most20 and combines local and requested targets only', async () => {
    const { readPlanningRelatedBatch } = await load();
    const keys = Array.from({ length: 43 }, (_, n) => `SYN-${n + 1}`), requests = [];
    const known = new Map([['SYN-1', { key: 'SYN-1', fields: { summary: 'Visible target' } }]]);
    const request = async batch => { requests.push(batch); return Response.json({ issues: [...batch.filter(key => key !== 'SYN-4').map(key => ({ key, summary: key })), { key: 'OTHER-1', summary: 'Unrequested' }] }); };
    const first = await readPlanningRelatedBatch({ keys, knownIssues: known, request });
    assert.equal(requests[0].length, 19);
    assert.equal(first.nextOffset, 20);
    assert.equal(first.total, 43);
    assert.equal(first.issues[0].fields.summary, 'Visible target');
    assert.deepEqual(first.unavailableKeys, ['SYN-4']);
    assert.equal(first.issues.some(issue => issue.key === 'OTHER-1'), false);
    const second = await readPlanningRelatedBatch({ keys, offset: first.nextOffset, knownIssues: known, request });
    assert.equal(requests[1].length, 20);
    assert.equal(second.nextOffset, 40);
    const third = await readPlanningRelatedBatch({ keys, offset: second.nextOffset, request });
    assert.equal(requests[2].length, 3);
    assert.equal(third.nextOffset, 43);
});

test('fully known category sends no request; failures do not fabricate related values', async () => {
    const { readPlanningRelatedBatch } = await load();
    const knownIssues = new Map([['SYN-2', { key: 'SYN-2', fields: { summary: 'Known' } }]]);
    const request = async () => { throw new Error('Must not fetch'); };
    assert.equal((await readPlanningRelatedBatch({ keys: ['SYN-2'], knownIssues, request })).issues.length, 1);
    await assert.rejects(readPlanningRelatedBatch({ keys: ['SYN-3'], request: async () => Response.json({}, { status: 503 }) }), /could not be loaded/);
    await assert.rejects(readPlanningRelatedBatch({ keys: ['SYN-3'], request: async () => Response.json({}) }), /could not be loaded/);
});
