import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCapacityConfigPayload } from '../frontend/src/api/configApi.js';

test('capacity save payload is scoped to editable fields and an integer revision', () => {
    assert.deepEqual(buildCapacityConfigPayload({
        project: 'CAP',
        fieldId: 'customfield_10001',
        fieldName: 'Capacity',
        baseRevision: 7,
        workspaceId: 'forbidden',
        siteUrl: 'forbidden',
        fieldSchemaType: 'number',
    }), {
        project: 'CAP',
        fieldId: 'customfield_10001',
        fieldName: 'Capacity',
        baseRevision: 7,
    });
    assert.deepEqual(buildCapacityConfigPayload({ project: 'CAP', fieldId: 'customfield_10001', fieldName: 'Capacity', baseRevision: '7' }), {
        project: 'CAP', fieldId: 'customfield_10001', fieldName: 'Capacity',
    });
});

// Startup config read: bounded so a hung /api/config surfaces the server-connection banner (issue 207).
const { CONFIG_BOOTSTRAP_TIMEOUT_MS, ConfigBootstrapTimeoutError, fetchBootstrapConfig } = await import('../frontend/src/api/configApi.js');

const jsonResponse = payload => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: null,
    clone() { return this; },
    json: async () => payload,
});

const abortRejection = signal => new Promise((_, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
});

async function withFetch(fetchImpl, run) {
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
        return await run();
    } finally {
        globalThis.fetch = original;
    }
}

test('bootstrap config read rejects with a typed timeout error when the response never arrives', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await withFetch((url, options) => abortRejection(options.signal), async () => {
        const pending = fetchBootstrapConfig('http://backend');
        const outcome = assert.rejects(pending, error => error instanceof ConfigBootstrapTimeoutError
            && error.name === 'ConfigBootstrapTimeoutError');
        t.mock.timers.tick(CONFIG_BOOTSTRAP_TIMEOUT_MS);
        await outcome;
    });
});

test('bootstrap config read is also bounded when headers arrive but the body stalls', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await withFetch(async (url, options) => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {},
        clone() { return { arrayBuffer: () => abortRejection(options.signal) }; },
    }), async () => {
        const pending = fetchBootstrapConfig('http://backend');
        const outcome = assert.rejects(pending, error => error.name === 'ConfigBootstrapTimeoutError');
        t.mock.timers.tick(CONFIG_BOOTSTRAP_TIMEOUT_MS);
        await outcome;
    });
});

test('bootstrap config read that answers in time resolves normally and never aborts afterwards', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal;
    await withFetch(async (url, options) => {
        signal = options.signal;
        return jsonResponse({ userCanEditSettings: true });
    }, async () => {
        const config = await fetchBootstrapConfig('http://backend');
        assert.equal(config.userCanEditSettings, true);
        t.mock.timers.tick(CONFIG_BOOTSTRAP_TIMEOUT_MS * 2);
        assert.equal(signal.aborted, false);
    });
});

test('bootstrap config read leaves failures other than the timeout untouched', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    await withFetch(async () => { throw abort; }, async () => {
        await assert.rejects(fetchBootstrapConfig('http://backend'), error => error === abort);
    });
    const networkError = new TypeError('Failed to fetch');
    await withFetch(async () => { throw networkError; }, async () => {
        await assert.rejects(fetchBootstrapConfig('http://backend'), error => error === networkError);
    });
});
