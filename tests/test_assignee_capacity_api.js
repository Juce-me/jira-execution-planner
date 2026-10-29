const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/api/assigneeCapacityApi.js');

test('assignee capacity API: GET carries the team, PATCH carries CSRF and requested-with', async () => {
    const oldFetch = global.fetch; const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        if (options.method === 'PATCH') return Response.json({ rows: [], revision: 1 });
        return Response.json({ rows: [], revision: 0, inherited: null });
    };
    try {
        const { fetchAssigneeCapacity, saveAssigneeCapacity } = await load();
        await fetchAssigneeCapacity('', '123', 'team a/&?');
        assert.equal(calls[0].url, `/api/eng/sprints/123/assignee-capacity?teamId=${encodeURIComponent('team a/&?')}`);
        assert.equal(calls[0].options.method, 'GET');
        assert.equal(calls[0].options.headers['X-CSRF-Token'], undefined);
        const payload = { teamId: 't1', changes: [{ assigneeKey: 'u1', capacity: '5' }] };
        await saveAssigneeCapacity('', '123', payload);
        assert.equal(calls[2].url, '/api/eng/sprints/123/assignee-capacity');
        assert.equal(calls[2].options.method, 'PATCH');
        assert.equal(calls[2].options.headers['X-CSRF-Token'], 'synthetic-csrf');
        assert.equal(calls[2].options.headers['X-Requested-With'], 'jira-execution-planner');
        assert.deepEqual(JSON.parse(calls[2].options.body), payload);
    } finally { global.fetch = oldFetch; }
});

test('assignee capacity API: error status and code surface; a dispatched PATCH failure is unconfirmed', async () => {
    const oldFetch = global.fetch;
    let mode = 'status';
    global.fetch = async (url) => {
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        if (mode === 'status') return Response.json({ code: 'csrf_required' }, { status: 403 });
        throw new TypeError('network down');
    };
    try {
        const { saveAssigneeCapacity } = await load();
        await assert.rejects(saveAssigneeCapacity('', '1', { teamId: 't', changes: [] }), error => error.status === 403 && error.code === 'csrf_required' && !error.unconfirmed);
        mode = 'network';
        await assert.rejects(saveAssigneeCapacity('', '1', { teamId: 't', changes: [] }), error => error.unconfirmed === true);
    } finally { global.fetch = oldFetch; }
});
