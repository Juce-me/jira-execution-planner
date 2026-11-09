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

test('assignee capacity API: Add assignee search posts only the query with CSRF and keeps no email', async () => {
    const oldFetch = global.fetch; const calls = [];
    let mode = 'ok';
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        if (mode === 'rate') return Response.json({ error: 'jira_rate_limited', retryAfterSeconds: 2 }, { status: 429 });
        return Response.json({ users: [
            { accountId: 'u1', displayName: ' Ann ', emailAddress: 'ann@example.test', avatarUrl: 'https://avatar.example.test/u1' },
            { accountId: 'u3', displayName: 'Cy', avatarUrl: { nested: true } },
            { accountId: '', displayName: 'No id' },
            { accountId: 'u2', displayName: '' },
        ], reason: null });
    };
    try {
        const { searchAssignableUsers } = await load();
        const result = await searchAssignableUsers('', '  ann ');
        const post = calls.find(call => call.url === '/api/eng/assignee-capacity/user-options');
        assert.equal(post.options.method, 'POST');
        assert.equal(post.options.headers['X-CSRF-Token'], 'synthetic-csrf');
        assert.equal(post.options.headers['X-Requested-With'], 'jira-execution-planner');
        assert.deepEqual(JSON.parse(post.options.body), { query: 'ann' });
        // The server's allowlisted avatar URL is kept as given (PersonAvatar applies the host allowlist again); a non-string is dropped.
        assert.deepEqual(result, { users: [{ accountId: 'u1', displayName: 'Ann', avatarUrl: 'https://avatar.example.test/u1' }, { accountId: 'u3', displayName: 'Cy' }], reason: null });
        mode = 'rate';
        await assert.rejects(searchAssignableUsers('', 'ann'), error => error.status === 429 && error.code === 'jira_rate_limited');
        const aborted = new AbortController(); aborted.abort();
        await assert.rejects(searchAssignableUsers('', 'ann', { signal: aborted.signal }), error => error.name === 'AbortError');
    } finally { global.fetch = oldFetch; }
});

// Batch read of stored Team numbers (#323). The 401 case runs last: a 401 locks the module-global auth state.
function batchServer({ respond } = {}) {
    const oldFetch = global.fetch; const posts = []; let csrfCount = 0;
    global.fetch = async (url, options = {}) => {
        if (url.endsWith('/api/auth/csrf')) { csrfCount += 1; return Response.json({ csrfToken: `csrf-${csrfCount}` }); }
        const body = JSON.parse(options.body);
        posts.push({ url, options, body, token: options.headers['X-CSRF-Token'] });
        if (respond) { const custom = respond(body, posts.length); if (custom) return custom; }
        return Response.json({ sprintId: '9', capabilities: { canEdit: true }, teams: body.teamIds.map(teamId => ({ teamId, revision: 1, planned: '5', inherited: null })) });
    };
    return { posts, csrf: () => csrfCount, restore: () => { global.fetch = oldFetch; } };
}
const ids = (n, prefix = 't') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('readPlannedNumbers: two ids make one POST with CSRF and requested-with, and return capabilities', async () => {
    const server = batchServer();
    try {
        const { readPlannedNumbers } = await load();
        const result = await readPlannedNumbers('', '9', ['a', 'b']);
        assert.equal(server.posts.length, 1);
        assert.equal(server.posts[0].url, '/api/eng/sprints/9/assignee-capacity/planned/read');
        assert.deepEqual(server.posts[0].body, { teamIds: ['a', 'b'] });
        assert.equal(server.posts[0].token, 'csrf-1');
        assert.equal(server.posts[0].options.headers['X-Requested-With'], 'jira-execution-planner');
        assert.deepEqual(result, { sprintId: '9', capabilities: { canEdit: true }, byTeam: { a: { revision: 1, planned: '5', inherited: null }, b: { revision: 1, planned: '5', inherited: null } }, failedTeamIds: [] });
    } finally { server.restore(); }
});

test('readPlannedNumbers: 1,001 ids make 3 sequential chunks with no overlap and a token each', async () => {
    const server = batchServer();
    try {
        const { readPlannedNumbers } = await load();
        const all = ids(1001);
        const result = await readPlannedNumbers('', '9', all);
        assert.deepEqual(server.posts.map(post => post.body.teamIds.length), [500, 500, 1]);
        assert.deepEqual(server.posts.flatMap(post => post.body.teamIds), all);
        assert.deepEqual(server.posts.map(post => post.token), ['csrf-1', 'csrf-2', 'csrf-3']);
        assert.equal(Object.keys(result.byTeam).length, 1001);
    } finally { server.restore(); }
});

test('readPlannedNumbers: multi-byte ids split by UTF-8 bytes under 128 KiB', async () => {
    const server = batchServer();
    try {
        const { readPlannedNumbers } = await load();
        const all = Array.from({ length: 300 }, (_, i) => `${'\u00e9'.repeat(400)}${i}`);
        await readPlannedNumbers('', '9', all);
        assert.ok(server.posts.length > 1);
        for (const post of server.posts) assert.ok(new TextEncoder().encode(JSON.stringify(post.body)).length <= 128 * 1024);
        assert.deepEqual(server.posts.flatMap(post => post.body.teamIds), all);
    } finally { server.restore(); }
});

test('readPlannedNumbers: a 413 on a 500-id chunk halves to 250 + 250', async () => {
    const server = batchServer({ respond: (body, n) => n === 1 ? Response.json({ error: 'review_request_limit' }, { status: 413 }) : null });
    try {
        const { readPlannedNumbers } = await load();
        const result = await readPlannedNumbers('', '9', ids(500));
        assert.deepEqual(server.posts.map(post => post.body.teamIds.length), [500, 250, 250]);
        assert.equal(Object.keys(result.byTeam).length, 500);
        assert.deepEqual(result.failedTeamIds, []);
    } finally { server.restore(); }
});

test('readPlannedNumbers: a single id that still gets 413 is failed without a retry loop', async () => {
    const server = batchServer({ respond: body => body.teamIds.includes('bad') ? Response.json({ error: 'review_request_limit' }, { status: 413 }) : null });
    try {
        const { readPlannedNumbers } = await load();
        const result = await readPlannedNumbers('', '9', ['ok1', 'bad', 'ok2']);
        assert.deepEqual(result.failedTeamIds, ['bad']);
        assert.deepEqual(Object.keys(result.byTeam).sort(), ['ok1', 'ok2']);
        // [ok1,bad,ok2] -> [ok1] + [bad,ok2]; [bad,ok2] -> [bad] + [ok2]; [bad] terminal.
        assert.equal(server.posts.filter(post => post.body.teamIds.length === 1 && post.body.teamIds[0] === 'bad').length, 1);
        assert.ok(server.posts.length <= 5);
    } finally { server.restore(); }
});

test('readPlannedNumbers: a pre-dispatch 403 csrf_required is retried once with a fresh token, then fails visibly', async () => {
    let server = batchServer({ respond: (body, n) => n === 1 ? Response.json({ code: 'csrf_required' }, { status: 403 }) : null });
    try {
        const { readPlannedNumbers } = await load();
        const result = await readPlannedNumbers('', '9', ['a']);
        assert.equal(server.posts.length, 2);
        assert.deepEqual(server.posts.map(post => post.token), ['csrf-1', 'csrf-2']);
        assert.deepEqual(Object.keys(result.byTeam), ['a']);
    } finally { server.restore(); }
    server = batchServer({ respond: () => Response.json({ code: 'csrf_required' }, { status: 403 }) });
    try {
        const { readPlannedNumbers } = await load();
        await assert.rejects(readPlannedNumbers('', '9', ids(600)), error => error.status === 403 && error.code === 'csrf_required');
        assert.equal(server.posts.length, 2);
    } finally { server.restore(); }
});

test('readPlannedNumbers: abort stops the sequence', async () => {
    const controller = new AbortController();
    const server = batchServer({ respond: (body, n) => { if (n === 1) controller.abort(); return null; } });
    try {
        const { readPlannedNumbers } = await load();
        await assert.rejects(readPlannedNumbers('', '9', ids(1001), { signal: controller.signal }), error => error.name === 'AbortError');
        assert.equal(server.posts.length, 1);
        const pre = new AbortController(); pre.abort();
        await assert.rejects(readPlannedNumbers('', '9', ['a'], { signal: pre.signal }), error => error.name === 'AbortError');
        assert.equal(server.posts.length, 1);
    } finally { server.restore(); }
});

test('readPlannedNumbers: a 401 rejects with the auth-required error and sends no further chunk', async () => {
    const server = batchServer({ respond: () => Response.json({ error: 'auth_required' }, { status: 401 }) });
    try {
        const { readPlannedNumbers } = await load();
        await assert.rejects(readPlannedNumbers('', '9', ids(1001)), error => error.name === 'AuthenticationRequiredError');
        assert.equal(server.posts.length, 1);
    } finally { server.restore(); }
});
