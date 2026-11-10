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

test('review API carries the group: encoded GET query, body keys on POST and PATCH, viewConflict forwarded', async () => {
    const oldFetch = global.fetch; const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        if (options.method === 'PATCH') return Response.json({ error: 'review_conflict', schemaConflict: false, viewConflict: true, cellConflicts: [] }, { status: 409 });
        return Response.json({ cells: [], unavailableIssueIds: [] });
    };
    try {
        const { fetchSprintReview, readSprintReviewValues, saveSprintReview } = await load();
        await fetchSprintReview('', '123', { groupId: 'group a/&?=#' });
        assert.equal(calls[0].url, `/api/eng/sprints/123/review?groupId=${encodeURIComponent('group a/&?=#')}`);
        assert.equal(calls[0].options.method, 'GET');
        await readSprintReviewValues('', '123', { groupId: 'g1', rowKind: 'story', issueIds: ['1'] });
        assert.equal(calls[2].url, '/api/eng/sprints/123/review/values/read');
        assert.deepEqual(JSON.parse(calls[2].options.body), { groupId: 'g1', rowKind: 'story', issueIds: ['1'] });
        await assert.rejects(saveSprintReview('', '123', { groupId: 'g1', baseSchemaRevision: 1, baseViewRevision: 0, schemaChanges: [], cellChanges: [] }), error => error.status === 409 && error.conflict.viewConflict === true && error.conflict.schemaConflict === false && Array.isArray(error.conflict.cellConflicts));
        assert.equal(calls[4].url, '/api/eng/sprints/123/review');
        assert.equal(JSON.parse(calls[4].options.body).groupId, 'g1');
        await fetchSprintReview('', '123');
        assert.equal(calls[5].url, '/api/eng/sprints/123/review', 'positional callers without a group keep working');
    } finally { global.fetch = oldFetch; }
});

test('review API forwards the group error codes from an {error} body', async () => {
    const oldFetch = global.fetch;
    for (const code of ['review_group_unknown', 'review_view_limit']) {
        global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic-csrf' }) : Response.json({ error: code }, { status: 400 });
        try {
            const { saveSprintReview } = await load();
            await assert.rejects(saveSprintReview('', '123', { groupId: 'g1' }), error => error.status === 400 && error.code === code && !error.unconfirmed);
        } finally { global.fetch = oldFetch; }
    }
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

test('v2 operations freeze their stamped payload and use namespace-only outcome lookup', async () => {
    const api = await load();
    const id = api.createPlanningOperationId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const input = { version: 2, operationId: id, groupId: 'g', inclusionChanges: [{ issueId: '1', included: true, baseRevision: 0 }] };
    const frozen = api.freezePlanningSavePayload(input);
    input.inclusionChanges[0].included = false;
    assert.equal(frozen.inclusionChanges[0].included, true);
    assert.ok(Object.isFrozen(frozen.inclusionChanges[0]));
    const oldFetch = global.fetch, calls = [];
    global.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ operationId: id, status: 'unknown' }); };
    try {
        await api.fetchPlanningSaveOperation('', '17', id, { groupId: 'g /', configurationId: 'namespace' });
        const parsed = new URL(calls[0].url, 'https://synthetic.example');
        assert.deepEqual([...parsed.searchParams], [['groupId', 'g /'], ['configurationId', 'namespace']]);
        assert.equal(calls[0].options.method, 'GET');
        assert.equal(calls[0].options.headers['X-CSRF-Token'], undefined);
    } finally { global.fetch = oldFetch; }
});

test('v2 treats malformed acknowledgements and unproven server failures as unconfirmed', async () => {
    const api = await load(), oldFetch = global.fetch;
    const payload = { version: 2, operationId: '019a413c-0000-7000-8000-000000000001', inclusionChanges: [{ issueId: '1', included: true, baseRevision: 0 }] };
    try {
        for (const response of [Response.json({}), Response.json({ error: 'internal' }, { status: 500 }), Response.json({ error: 'busy' }, { status: 503 })]) {
            global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic' }) : response;
            await assert.rejects(api.saveSprintReview('', '17', payload), error => error.unconfirmed === true);
        }
        global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic' }) : Response.json({ error: 'planning_deadline_exceeded', noCommit: true }, { status: 503 });
        await assert.rejects(api.saveSprintReview('', '17', payload), error => error.noCommit === true && !error.unconfirmed);
    } finally { global.fetch = oldFetch; }
});

test('v2 acknowledgement confirms exactly submitted IDs and revisioned values', async () => {
    const api = await load(), oldFetch = global.fetch;
    const payload = api.freezePlanningSavePayload({ version: 2, operationId: api.createPlanningOperationId(), groupId: 'g', inclusionChanges: [{ issueId: '1', included: true, baseRevision: 0 }], cellChanges: [] });
    const ack = { operationId: payload.operationId, plan: { exists: true, revision: 1 }, schemaRevision: 0, columns: [], cells: [], inclusionChanges: [{ issueId: '1', included: true, revision: 1 }] };
    try {
        global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic' }) : Response.json(ack);
        assert.deepEqual(await api.saveSprintReview('', '17', payload), ack);
        for (const changes of [[], [{ issueId: '2', included: true, revision: 1 }], [{ issueId: '1', included: false, revision: 1 }], [{ issueId: '1', included: true, revision: -1 }]]) {
            global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic' }) : Response.json({ ...ack, inclusionChanges: changes });
            await assert.rejects(api.saveSprintReview('', '17', payload), error => error.unconfirmed === true);
        }
    } finally { global.fetch = oldFetch; }
});

test('v2 deliberate replay never restamps a frozen configuration after context changes', async () => {
    const api = await load(), context = await import('../frontend/src/workStructure/requestContext.js');
    const oldFetch = global.fetch, calls = [];
    const original = { id: 'config-original', model: 'delivery', quarter: '2027Q1', revision: 1, digest: 'original' };
    context.setActiveWorkContext(original);
    const payload = api.freezePlanningSavePayload({ version: 2, operationId: api.createPlanningOperationId(), groupId: 'g', inclusionChanges: [], cellChanges: [] });
    context.setActiveWorkContext({ ...original, id: 'config-next', revision: 2, digest: 'next' });
    global.fetch = async (url, options = {}) => {
        if (url.endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic' });
        calls.push(JSON.parse(options.body));
        return Response.json({ operationId: payload.operationId, plan: { exists: true, revision: 1 }, schemaRevision: 0, columns: [], cells: [], inclusionChanges: [] });
    };
    try {
        await api.saveSprintReview('', '17', payload);
        await api.saveSprintReview('', '17', payload);
        assert.deepEqual(calls, [payload, payload]);
        assert.equal(calls[0].configuration.id, 'config-original');
    } finally { global.fetch = oldFetch; context.setActiveWorkContext(null); }
});

test('v2 cell acknowledgement requires exact text and equivalent decimal values', async () => {
    const api = await load(), oldFetch = global.fetch;
    try {
        for (const [type, submitted, acknowledged, valid] of [['text', 'expected', 'WRONG', false], ['text', '01', '1', false], ['number', '1.2', '1.200', true], ['number', '1.2', '1.201', false], ['text', null, '', false]]) {
            const payload = { version: 2, operationId: api.createPlanningOperationId(), inclusionChanges: [], cellChanges: [{ issueId: '1', rowKind: 'story', columnId: 'cost', value: submitted, baseRevision: 0 }] };
            const ack = { operationId: payload.operationId, plan: { exists: true, revision: 1 }, schemaRevision: 1, columns: [{ id: 'cost', rowKind: 'story', type }], cells: [{ issueId: '1', rowKind: 'story', columnId: 'cost', value: acknowledged, revision: 1 }], inclusionChanges: [] };
            global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic' }) : Response.json(ack);
            if (valid) assert.deepEqual(await api.saveSprintReview('', '17', payload), ack);
            else await assert.rejects(api.saveSprintReview('', '17', payload), error => error.unconfirmed === true);
        }
    } finally { global.fetch = oldFetch; }
});

test('v2 rejects impossible stored inclusion and unchanged review-cell revisions', async () => {
    const api = await load(), oldFetch = global.fetch;
    try {
        for (const cellCase of [false, true]) {
            const payload = { version: 2, operationId: api.createPlanningOperationId(), inclusionChanges: cellCase ? [] : [{ issueId: '1', included: true, baseRevision: 0 }], cellChanges: cellCase ? [{ issueId: '1', rowKind: 'story', columnId: 'note', value: 'same', baseRevision: 2 }] : [] };
            const ack = { operationId: payload.operationId, plan: { exists: true, revision: 1 }, schemaRevision: 1, columns: [{ id: 'note', rowKind: 'story', type: 'text' }], cells: cellCase ? [{ issueId: '1', rowKind: 'story', columnId: 'note', value: 'same', revision: 2 }] : [], inclusionChanges: cellCase ? [] : [{ issueId: '1', included: true, revision: 0 }] };
            global.fetch = async url => url.endsWith('/api/auth/csrf') ? Response.json({ csrfToken: 'synthetic' }) : Response.json(ack);
            await assert.rejects(api.saveSprintReview('', '17', payload), error => error.unconfirmed === true);
        }
    } finally { global.fetch = oldFetch; }
});
