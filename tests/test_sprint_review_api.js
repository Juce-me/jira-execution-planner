const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/api/sprintReviewApi.js');

test('review API preserves CSRF/requested-with, scoped conflicts and never sends authority', async () => {
    const oldFetch = global.fetch; const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        return Response.json({ code: 'review_conflict', schemaConflict: false, cellConflicts: [{ issueId: '1', columnId: 'cost', value: '2.000', revision: 3 }] }, { status: 409 });
    };
    try {
        const { saveSprintReview } = await load();
        await assert.rejects(saveSprintReview('', '123', { baseSchemaRevision: 1, schemaChanges: [], cellChanges: [] }), error => error.status === 409 && error.conflict.cellConflicts[0].revision === 3);
        assert.equal(calls.length, 2);
        assert.equal(calls[1].options.method, 'PATCH');
        assert.equal(calls[1].options.headers['X-CSRF-Token'], 'synthetic-csrf');
        assert.equal(calls[1].options.headers['X-Requested-With'], 'jira-execution-planner');
        assert.deepEqual(JSON.parse(calls[1].options.body), { baseSchemaRevision: 1, schemaChanges: [], cellChanges: [] });
    } finally { global.fetch = oldFetch; }
});

test('401 goes through terminal global lock and subsequent reads/writes are never replayed', async () => {
    const oldFetch = global.fetch, oldWindow = global.window, oldEvent = global.CustomEvent;
    let calls = 0;
    global.window = new EventTarget(); window.location = { origin: 'https://app.example' };
    global.CustomEvent = class extends Event { constructor(type, init) { super(type); this.detail = init.detail; } };
    global.fetch = async () => { calls++; return Response.json({ error: 'auth_required', loginUrl: 'https://evil.example/login' }, { status: 401 }); };
    try {
        const { fetchSprintReview, saveSprintReview } = await load();
        await assert.rejects(fetchSprintReview('', '123'), error => error.name === 'AuthenticationRequiredError');
        assert.equal(window.__JEP_AUTH_REQUIRED__.loginUrl, '/login?reason=session_expired');
        await assert.rejects(fetchSprintReview('', '123'), error => error.name === 'AuthenticationRequiredError');
        await assert.rejects(saveSprintReview('', '123', {}), error => error.name === 'AuthenticationRequiredError');
        assert.equal(calls, 1);
    } finally { global.fetch = oldFetch; global.window = oldWindow; global.CustomEvent = oldEvent; }
});

test('timeouts preserve an unconfirmed mutation outcome without automatic retry', async () => {
    const oldFetch = global.fetch; let writes = 0;
    global.fetch = async (url, options = {}) => {
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        writes++;
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    };
    try {
        const { saveSprintReview } = await load();
        await assert.rejects(saveSprintReview('', '123', {}, { timeoutMs: 10 }), error => error.code === 'review_timeout' && error.unconfirmed === true);
        assert.equal(writes, 1);
    } finally { global.fetch = oldFetch; }
});

test('review timeout also bounds an unresponsive CSRF preflight without dispatching PATCH', async () => {
    const oldFetch = global.fetch; let writes = 0;
    global.fetch = async url => {
        if (url.endsWith('/api/auth/csrf')) return new Promise(() => {});
        writes++; return Response.json({});
    };
    try {
        const { saveSprintReview } = await load();
        await assert.rejects(saveSprintReview('', '123', {}, { timeoutMs: 10 }), error => error.code === 'review_timeout' && error.unconfirmed === false);
        assert.equal(writes, 0);
    } finally { global.fetch = oldFetch; }
});
