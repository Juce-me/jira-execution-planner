const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadHttp(fetchImpl) {
    const source = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'api', 'http.js')],
        bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
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
