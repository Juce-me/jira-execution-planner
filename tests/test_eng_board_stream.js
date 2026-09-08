const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

function bundle() {
    return esbuild.buildSync({
        stdin: {
            resolveDir: path.join(__dirname, '..'),
            contents: `export * from './frontend/src/api/engBoardApi.js'; export { apiFetch } from './frontend/src/api/http.js';`,
        },
        bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
}

function harness(fetchImpl) {
    const events = [];
    const fetchCalls = [];
    const window = {
        location: { origin: 'https://planner.example.test' },
        listeners: new Map(),
        addEventListener(type, listener) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
        dispatchEvent(event) {
            events.push(event);
            for (const listener of this.listeners.get(event.type) || []) listener(event);
            return true;
        },
    };
    const sandbox = {
        window, location: window.location, CustomEvent, URL, URLSearchParams, Headers, Request, Response,
        ReadableStream, TextDecoder, TextEncoder, DOMException, AbortController,
        fetch: async (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
        performance, Date, module: { exports: {} }, exports: {}, console,
    };
    vm.runInContext(bundle(), vm.createContext(sandbox));
    return { exports: sandbox.module.exports, events, fetchCalls, window };
}

function frame(type, sequence, fields = {}) {
    return { protocolVersion: 1, generationId: 'generation-1', sequence, type, ...fields };
}

function start(sequence = 0) {
    return frame('start', sequence, {
        scope: 'all_work', scopeVersion: 'scope-v1', scopeCohortDigest: 'a'.repeat(64), columns: [],
    });
}

function complete(sequence = 1) {
    return frame('complete', sequence, {
        outcome: 'success', authoritative: true, epicCount: 0, childCount: 0,
        diagnostics: {
            indexMs: 1, focusedCompleteMs: null, durationMs: 2, jiraRequests: 1,
            jiraPages: 1, jiraRetries: 0, peakChildSearches: 0, cacheState: 'miss', completeness: 'complete',
        },
    });
}

function encoded(value) {
    return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function streamedResponse(chunks, { holdOpen = false, onCancel = () => {} } = {}) {
    let controller;
    const body = new ReadableStream({
        start(value) {
            controller = value;
            for (const chunk of chunks) controller.enqueue(chunk);
            if (!holdOpen) controller.close();
        },
        cancel(reason) { onCancel(reason); },
    });
    return {
        response: new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
        close: () => controller.close(),
        enqueue: chunk => controller.enqueue(chunk),
    };
}

test('held EOF delivers the first validated frame before completion', async () => {
    let cancelled = false;
    const stream = streamedResponse([encoded(start())], { holdOpen: true, onCancel: () => { cancelled = true; } });
    const api = harness(async () => stream.response);
    let firstFrame;
    const firstDelivered = new Promise(resolve => { firstFrame = resolve; });

    const request = api.exports.streamEngBoard({
        backendUrl: '', departmentId: 'department-1', scope: 'all_work', onFrame: firstFrame,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await firstDelivered)), start());
    stream.enqueue(encoded(complete()));
    assert.deepEqual(JSON.parse(JSON.stringify(await request)), complete());
    assert.equal(cancelled, true, 'terminal completion cancels the held reader');
});

test('split UTF-8 and NDJSON chunks are decoded without corruption', async () => {
    const unicodeStart = start();
    unicodeStart.columns = [{ id: 'todo', name: 'Plan 🚀', color: '#123456', statusNames: ['To Do'], terminal: false }];
    const bytes = encoded(unicodeStart);
    const rocket = new TextEncoder().encode('🚀');
    const splitAt = bytes.findIndex((value, index) => value === rocket[0] && bytes[index + 1] === rocket[1]) + 2;
    const response = streamedResponse([bytes.slice(0, splitAt), bytes.slice(splitAt), encoded(complete())]).response;
    const api = harness(async () => response);
    const delivered = [];
    await api.exports.streamEngBoard({ departmentId: 'department-1', scope: 'all_work', onFrame: value => delivered.push(value) });
    assert.equal(delivered[0].columns[0].name, 'Plan 🚀');
});

test('valid UTF-8 containing an escaped lone surrogate is rejected', async () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(start()).replace('scope-v1', 'scope-\\ud800')}\n`);
    const api = harness(async () => streamedResponse([bytes]).response);
    await assert.rejects(
        () => api.exports.streamEngBoard({ departmentId: 'department-1', scope: 'all_work' }),
        error => error.code === 'invalid_frame',
    );
});

test('strict framing rejects sequence, shape, UTF-8, frame and generation limits', async t => {
    const cases = [
        ['duplicate_sequence', [encoded(start()), encoded(frame('progress', 0, { columnId: 'todo', loadedChildren: 0, byEpic: [] }))]],
        ['invalid_frame', [encoded({ ...start(), unexpected: true })]],
        ['invalid_utf8', [Uint8Array.from([0xff, 0x0a])]],
        ['invalid_frame', [new Uint8Array([...encoded(start()), ...encoded(complete()), 0x78])]],
        ['frame_too_large', [new Uint8Array(33).fill(97)]],
        ['generation_too_large', [encoded(start()), encoded(complete())], { maxTotalBytes: encoded(start()).byteLength + encoded(complete()).byteLength - 1 }],
    ];
    for (const [code, chunks, limits = {}] of cases) {
        await t.test(code, async () => {
            const response = streamedResponse(chunks).response;
            const api = harness(async () => response);
            await assert.rejects(
                () => api.exports.streamEngBoard({
                    departmentId: 'department-1', scope: 'all_work',
                    maxFrameBytes: code === 'frame_too_large' ? 32 : undefined,
                    ...limits,
                }),
                error => error.code === code,
            );
        });
    }
});

test('frame and generation byte ceilings accept the exact bound and reject one byte over', async () => {
    const first = encoded(start());
    const terminal = encoded(complete());
    const total = first.byteLength + terminal.byteLength;
    const api = harness(async () => streamedResponse([first, terminal]).response);
    await api.exports.streamEngBoard({
        departmentId: 'department-1', scope: 'all_work',
        maxFrameBytes: Math.max(first.byteLength - 1, terminal.byteLength - 1), maxTotalBytes: total,
    });

    const overFrame = harness(async () => streamedResponse([first, terminal]).response);
    await assert.rejects(() => overFrame.exports.streamEngBoard({
        departmentId: 'department-1', scope: 'all_work', maxFrameBytes: first.byteLength - 2, maxTotalBytes: total,
    }), error => error.code === 'frame_too_large');

    const overTotal = harness(async () => streamedResponse([first, terminal]).response);
    await assert.rejects(() => overTotal.exports.streamEngBoard({
        departmentId: 'department-1', scope: 'all_work', maxFrameBytes: total, maxTotalBytes: total - 1,
    }), error => error.code === 'generation_too_large');
});

test('abort cancels the reader and prevents later frame delivery', async () => {
    let cancelled = false;
    const stream = streamedResponse([encoded(start())], { holdOpen: true, onCancel: () => { cancelled = true; } });
    const api = harness(async () => stream.response);
    const controller = new AbortController();
    const delivered = [];
    const request = api.exports.streamEngBoard({
        departmentId: 'department-1', scope: 'all_work', signal: controller.signal,
        onFrame: value => delivered.push(value),
    });
    while (delivered.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(() => request, error => error.name === 'AbortError');
    assert.equal(cancelled, true);
    assert.equal(delivered.length, 1);
});

test('abort during an async callback suppresses later frames buffered in the same chunk', async () => {
    const chunk = new Uint8Array([...encoded(start()), ...encoded(complete())]);
    const api = harness(async () => streamedResponse([chunk], { holdOpen: true }).response);
    const controller = new AbortController();
    const delivered = [];
    let releaseFirst;
    const request = api.exports.streamEngBoard({
        departmentId: 'department-1', scope: 'all_work', signal: controller.signal,
        onFrame: async value => {
            delivered.push(value);
            if (delivered.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
        },
    });
    while (!releaseFirst) await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    releaseFirst();
    await assert.rejects(() => request, error => error.name === 'AbortError');
    assert.equal(delivered.length, 1);
});

test('invalid content type cancels a held response body', async () => {
    let cancelled = false;
    const body = new ReadableStream({
        start(controller) { controller.enqueue(encoded(start())); },
        cancel() { cancelled = true; },
    });
    const api = harness(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    await assert.rejects(
        () => api.exports.streamEngBoard({ departmentId: 'department-1', scope: 'all_work' }),
        error => error.code === 'invalid_content_type',
    );
    assert.equal(cancelled, true);
});

test('EOF before a terminal frame fails closed', async () => {
    const api = harness(async () => streamedResponse([encoded(start())]).response);
    await assert.rejects(
        () => api.exports.streamEngBoard({ departmentId: 'department-1', scope: 'all_work' }),
        error => error.code === 'unexpected_eof',
    );
});

test('stream auth frame and sibling HTTP 401 use the same terminal global lock', async t => {
    await t.test('auth frame', async () => {
        const response = streamedResponse([
            encoded(start()), encoded(frame('error', 1, { code: 'auth_required' })),
        ]).response;
        const api = harness(async () => response);
        await assert.rejects(
            () => api.exports.streamEngBoard({ departmentId: 'department-1', scope: 'all_work' }),
            error => error.name === 'AuthenticationRequiredError',
        );
        assert.equal(api.events.length, 1);
    });

    await t.test('sibling 401 blocks the next delivery', async () => {
        const stream = streamedResponse([encoded(start())], { holdOpen: true });
        const api = harness(async url => url === '/api/sibling'
            ? new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 })
            : stream.response);
        const delivered = [];
        const request = api.exports.streamEngBoard({
            departmentId: 'department-1', scope: 'all_work', onFrame: value => delivered.push(value),
        });
        while (delivered.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
        await assert.rejects(() => api.exports.apiFetch('/api/sibling'), error => error.name === 'AuthenticationRequiredError');
        await assert.rejects(() => request, error => error.name === 'AuthenticationRequiredError');
        assert.equal(delivered.length, 1);
    });

    await t.test('sibling 401 during a callback suppresses later frames in the same chunk', async () => {
        const chunk = new Uint8Array([...encoded(start()), ...encoded(complete())]);
        const api = harness(async url => url === '/api/sibling'
            ? new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 })
            : streamedResponse([chunk], { holdOpen: true }).response);
        const delivered = [];
        let releaseFirst;
        const request = api.exports.streamEngBoard({
            departmentId: 'department-1', scope: 'all_work',
            onFrame: async value => {
                delivered.push(value);
                if (delivered.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
            },
        });
        while (!releaseFirst) await new Promise(resolve => setTimeout(resolve, 0));
        await assert.rejects(() => api.exports.apiFetch('/api/sibling'), error => error.name === 'AuthenticationRequiredError');
        releaseFirst();
        await assert.rejects(() => request, error => error.name === 'AuthenticationRequiredError');
        assert.equal(delivered.length, 1);
    });
});

test('control helper sends the closed request and validates the committed revision acknowledgement', async () => {
    const api = harness(async () => new Response(JSON.stringify({ accepted: true, revision: 7 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await api.exports.controlEngBoard({
        backendUrl: '', generationId: 'generation-1', action: 'focus', columnId: 'todo', csrfToken: 'csrf-1',
    });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { accepted: true, revision: 7 });
    const [url, options] = api.fetchCalls[0];
    assert.equal(url, '/api/eng/board/control');
    assert.deepEqual(JSON.parse(options.body), {
        generationId: 'generation-1', action: 'focus', columnId: 'todo',
    });
    assert.equal(options.headers.get('X-CSRF-Token'), 'csrf-1');
    assert.equal(options.headers.get('X-Requested-With'), 'jira-execution-planner');
});

test('control helper rejects malformed acknowledgements and non-closed requests', async t => {
    for (const payload of [
        undefined,
        { accepted: false, revision: 1 },
        { accepted: true, revision: 1.5 },
        { accepted: true, revision: 1, extra: true },
    ]) {
        await t.test(JSON.stringify(payload), async () => {
            const api = harness(async () => new Response(JSON.stringify(payload), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            }));
            await assert.rejects(
                () => api.exports.controlEngBoard({ generationId: 'generation-1', action: 'cancel' }),
                error => error.code === 'invalid_control_response',
            );
        });
    }
    for (const request of [
        { generationId: 'generation-1', action: 'cancel', columnId: 'todo' },
        { generationId: 'generation-1', action: 'focus' },
        { generationId: '', action: 'cancel' },
        { generationId: 'generation-1', action: 'pause' },
    ]) {
        const api = harness(async () => { throw new Error('fetch should not run'); });
        await assert.rejects(
            () => api.exports.controlEngBoard(request),
            error => error.code === 'invalid_control_request',
        );
        assert.equal(api.fetchCalls.length, 0);
    }
});
