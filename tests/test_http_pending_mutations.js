const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadHttp(fetchImpl, events = []) {
    const source = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'api', 'http.js')],
        bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const window = {
        addEventListener() {}, removeEventListener() {},
        dispatchEvent(event) { events.push(event.type); },
    };
    const sandbox = {
        module: { exports: {} }, exports: {}, window, fetch: fetchImpl, console,
        setTimeout, clearTimeout, Event: class Event { constructor(type) { this.type = type; } },
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        DOMException, Headers,
    };
    vm.runInContext(source, vm.createContext(sandbox));
    return sandbox.module.exports;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const okResponse = () => ({ ok: true, status: 200, body: null, clone() { return this; } });
const opaqueRedirect = () => ({
    type: 'opaqueredirect', status: 0, ok: false,
    clone: () => ({
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => { throw new Error('opaque'); },
    }),
});

test('apiFetch sends redirect manual even when the caller asks to follow', async () => {
    let fetchInit;
    const http = loadHttp(async (_url, init) => {
        fetchInit = init;
        return okResponse();
    });
    await http.apiFetch('/api/config', { redirect: 'follow' });
    assert.equal(fetchInit.redirect, 'manual');
});

test('an opaque redirect rejects with PerimeterSessionExpiredError and dispatches the event once', async () => {
    const events = [];
    const http = loadHttp(async () => opaqueRedirect(), events);
    await assert.rejects(http.apiFetch('/api/config'), error => {
        assert.equal(error.name, 'PerimeterSessionExpiredError');
        assert.equal(error.code, 'perimeter_session_expired');
        assert.equal(error.message, 'The sign-in session expired.');
        assert.equal(http.isPerimeterSessionExpiredError(error), true);
        return true;
    });
    assert.deepEqual(events, ['jep:perimeter-session-expired']);
});

test('an application authentication lock takes precedence over an in-flight opaque redirect', async () => {
    const events = [];
    const pending = deferred();
    const http = loadHttp(url => url === '/api/config' ? pending.promise : new Response(null, { status: 401 }), events);
    const request = http.apiFetch('/api/config');
    await assert.rejects(http.apiFetch('/api/groups-config'), { name: 'AuthenticationRequiredError' });

    pending.resolve(opaqueRedirect());
    await assert.rejects(request, { name: 'AuthenticationRequiredError' });
    assert.deepEqual(events, ['jep:authentication-required']);
});

test('a redirected write still settles its pending-mutation count', async () => {
    const http = loadHttp(async () => opaqueRedirect());
    const request = http.apiFetch('/api/groups-config', { method: 'POST' });
    assert.equal(http.hasPendingMutations(), true);
    await assert.rejects(request, { name: 'PerimeterSessionExpiredError' });
    assert.equal(http.hasPendingMutations(), false);
});

test('apiFetchHeaders rejects an opaque redirect with the typed error', async () => {
    let fetchInit;
    const events = [];
    const http = loadHttp(async (_url, init) => {
        fetchInit = init;
        return opaqueRedirect();
    }, events);
    await assert.rejects(http.apiFetchHeaders('/api/eng/board', { redirect: 'follow' }), { name: 'PerimeterSessionExpiredError' });
    assert.equal(fetchInit.redirect, 'manual');
    assert.deepEqual(events, ['jep:perimeter-session-expired']);
});

test('reads never count as pending mutations', async () => {
    const http = loadHttp(async () => okResponse());
    const read = http.apiFetch('/api/config');
    assert.equal(http.hasPendingMutations(), false);
    await read;
    assert.equal(await http.waitForPendingMutations(10), true);
});

test('mutations stay pending until they settle, including on failure', async () => {
    const save = deferred();
    const http = loadHttp(() => save.promise);
    const request = http.apiFetch('/api/groups-config', { method: 'POST' });
    assert.equal(http.hasPendingMutations(), true);
    const waiting = http.waitForPendingMutations(1_000);
    save.reject(new TypeError('Failed to fetch'));
    await assert.rejects(request);
    assert.equal(await waiting, true);
    assert.equal(http.hasPendingMutations(), false);
});

test('waiting for pending mutations is bounded by the timeout', async () => {
    const http = loadHttp(() => new Promise(() => {}));
    void http.apiFetch('/api/scenario/drafts', { method: 'PUT' });
    assert.equal(await http.waitForPendingMutations(20), false);
    assert.equal(http.hasPendingMutations(), true);
});
