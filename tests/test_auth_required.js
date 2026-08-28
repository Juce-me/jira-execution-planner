const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const AUTH_REQUIRED_PATH = path.join(__dirname, '..', 'frontend', 'src', 'api', 'authRequired.js');
const HTTP_PATH = path.join(__dirname, '..', 'frontend', 'src', 'api', 'http.js');

class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

function bundle(entryPoint) {
    return esbuild.buildSync({
        entryPoints: [entryPoint], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
}

function createHarness(entryPoint = AUTH_REQUIRED_PATH, fetchImpl = async () => ({ ok: true, status: 200 })) {
    const events = [];
    const fetchCalls = [];
    const apiResults = [];
    const fakeWindow = {
        location: { origin: 'https://planner.example.test' },
        CustomEvent,
        dispatchEvent(event) { events.push(event); return true; },
    };
    const sandbox = {
        window: fakeWindow, location: fakeWindow.location, CustomEvent, URL, Headers, Request, Response,
        performance: { now: () => 1 },
        fetch: async (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
        JepAnalytics: { trackApiResult: (surface, params) => apiResults.push({ surface, params }) },
        module: { exports: {} }, exports: {}, console,
    };
    vm.runInContext(bundle(entryPoint), vm.createContext(sandbox));
    return { exports: sandbox.module.exports, window: fakeWindow, events, fetchCalls, apiResults };
}

test('login URL sanitizer accepts only exact same-origin recovery entry URLs', () => {
    const { exports } = createHarness();
    assert.equal(exports.sanitizeLoginUrl('/login'), '/login');
    assert.equal(exports.sanitizeLoginUrl('/login?reason=session_expired'), '/login?reason=session_expired');
    assert.equal(exports.sanitizeLoginUrl('https://planner.example.test/login?reason=missing_scope'), '/login?reason=missing_scope');
    for (const unsafe of [
        '', '//evil.example/login', 'https://evil.example/login', 'https://user:pass@planner.example.test/login',
        '/other', '/login?reason=other', '/login?next=/api', '/login#fragment', 'not a url',
    ]) assert.equal(exports.sanitizeLoginUrl(unsafe), '/login?reason=session_expired');
});

test('publishing is terminal, idempotent, and shares only the first sanitized target', () => {
    const harness = createHarness();
    const first = harness.exports.publishAuthenticationRequired({ loginUrl: '/login?reason=missing_scope' });
    const second = harness.exports.publishAuthenticationRequired({ loginUrl: '/login' });
    assert.equal(JSON.stringify(first), JSON.stringify({ locked: true, loginUrl: '/login?reason=missing_scope', reason: 'missing_scope' }));
    assert.equal(second, first);
    assert.equal(harness.exports.readPendingAuthenticationRequired(), first);
    assert.equal(harness.events.length, 1);
    assert.equal(JSON.stringify(harness.window).includes('token'), false);
});

test('apiFetch locks on every 401 including malformed bodies', async () => {
    const harness = createHarness(HTTP_PATH, async () => new Response('not-json', { status: 401 }));
    await assert.rejects(() => harness.exports.apiFetch('/api/config'), harness.exports.AuthenticationRequiredError);
    assert.equal(harness.events[0].detail.loginUrl, '/login?reason=session_expired');
});

test('apiFetch locks on exact structured auth_required but not distinct 403 and 409 errors', async () => {
    const authHarness = createHarness(HTTP_PATH, async () => new Response(JSON.stringify({
        error: 'auth_required', loginUrl: 'https://planner.example.test/login?reason=missing_scope',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(() => authHarness.exports.apiFetch('/api/config'), error => error.status === 500);

    for (const [status, error] of [[403, 'admin_required'], [403, 'csrf_required'], [409, 'home_user_token_required']]) {
        const harness = createHarness(HTTP_PATH, async () => new Response(JSON.stringify({ error }), {
            status, headers: { 'Content-Type': 'application/json' },
        }));
        const response = await harness.exports.apiFetch('/api/config');
        assert.equal(response.status, status);
        assert.equal(harness.events.length, 0);
    }
});

test('apiFetch suppresses requests after lock and rejects an older 200 response', async () => {
    let resolveOlder;
    const harness = createHarness(HTTP_PATH, async (url) => {
        if (url === '/api/older') return new Promise((resolve) => { resolveOlder = resolve; });
        return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 });
    });
    const older = harness.exports.apiFetch('/api/older');
    await assert.rejects(() => harness.exports.apiFetch('/api/lock'), harness.exports.AuthenticationRequiredError);
    resolveOlder(new Response('{}', { status: 200 }));
    await assert.rejects(() => older, error => error.status === 200);
    await assert.rejects(() => harness.exports.apiFetch('/api/suppressed'), harness.exports.AuthenticationRequiredError);
    assert.equal(harness.fetchCalls.length, 2);
});

test('tracked apiFetch rejects an older delayed body after lock and records its real 200 status', async () => {
    let finishOlderBody;
    const olderBody = new ReadableStream({
        start(controller) {
            finishOlderBody = () => {
                controller.enqueue(new TextEncoder().encode('{"value":"stale"}'));
                controller.close();
            };
        },
    });
    const harness = createHarness(HTTP_PATH, async (url) => {
        if (url === '/api/older') {
            return new Response(olderBody, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 });
    });

    const older = harness.exports.trackedFetch('delayed_body', '/api/older');
    await assert.rejects(() => harness.exports.apiFetch('/api/lock'), harness.exports.AuthenticationRequiredError);
    finishOlderBody();

    await assert.rejects(() => older, error => error.name === 'AuthenticationRequiredError' && error.status === 200);
    assert.equal(harness.apiResults.at(-1).params.status, 200);
});

test('tracked apiFetch converts a delayed network rejection after lock to typed auth with status 0', async () => {
    let rejectOlder;
    const harness = createHarness(HTTP_PATH, async (url) => {
        if (url === '/api/older') {
            return new Promise((resolve, reject) => { rejectOlder = reject; });
        }
        return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 });
    });

    const older = harness.exports.trackedFetch('delayed_network', '/api/older');
    await assert.rejects(() => harness.exports.apiFetch('/api/lock'), harness.exports.AuthenticationRequiredError);
    rejectOlder(new TypeError('synthetic network failure'));

    await assert.rejects(() => older, error => error.name === 'AuthenticationRequiredError' && error.status === 0);
    assert.equal(harness.apiResults.at(-1).params.status, 0);
});

test('tracked apiFetch converts a delayed body failure after lock to typed auth with response status', async () => {
    let rejectOlderBody;
    const olderBody = new ReadableStream({
        start(controller) {
            rejectOlderBody = () => controller.error(new TypeError('synthetic body failure'));
        },
    });
    const harness = createHarness(HTTP_PATH, async (url) => {
        if (url === '/api/older') return new Response(olderBody, { status: 206 });
        return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401 });
    });

    const older = harness.exports.trackedFetch('delayed_body_failure', '/api/older');
    await assert.rejects(() => harness.exports.apiFetch('/api/lock'), harness.exports.AuthenticationRequiredError);
    rejectOlderBody();

    await assert.rejects(() => older, error => error.name === 'AuthenticationRequiredError' && error.status === 206);
    assert.equal(harness.apiResults.at(-1).params.status, 206);
});

test('trackedFetch records the originating auth response status', async () => {
    const harness = createHarness(HTTP_PATH, async () => new Response(JSON.stringify({ error: 'auth_required' }), {
        status: 418,
        headers: { 'Content-Type': 'application/json' },
    }));
    await assert.rejects(() => harness.exports.trackedFetch('config_bootstrap', '/api/config'), error => error.status === 418);
    assert.equal(harness.apiResults.at(-1).params.status, 418);
});
