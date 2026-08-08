const test = require('node:test');
const assert = require('node:assert/strict');

// §9.2: "A second open of the same epic in one session must not refetch." Task 3 deliberately
// added no server cache, so this is the client's job; the shape mirrors
// frontend/src/settings/boardStatusCatalog.js, the in-repo precedent.

async function loadModule() {
    const module = await import('../frontend/src/eng/engEpicDescriptionCache.js');
    module.clearEpicDescriptionCache();
    return module;
}

function installFetch(handler) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push(String(url));
        return handler(calls.length, url, options);
    };
    return {
        calls,
        restore() {
            globalThis.fetch = original;
        },
    };
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DESCRIPTION = { key: 'PLAT-1', html: '<p>Body</p>', isEmpty: false };

test('loadEpicDescription fetches once per issue key for the session', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(DESCRIPTION));
    try {
        const first = await module.loadEpicDescription('http://backend', { key: 'PLAT-1' });
        const second = await module.loadEpicDescription('http://backend', { key: 'PLAT-1' });
        assert.deepEqual(first, DESCRIPTION);
        assert.deepEqual(second, DESCRIPTION);
        assert.equal(stub.calls.length, 1);
    } finally {
        stub.restore();
    }
});

test('loadEpicDescription refetches for a different issue key', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(DESCRIPTION));
    try {
        await module.loadEpicDescription('http://backend', { key: 'PLAT-1' });
        await module.loadEpicDescription('http://backend', { key: 'PLAT-2' });
        assert.equal(stub.calls.length, 2);
        assert.match(stub.calls[1], /key=PLAT-2/);
    } finally {
        stub.restore();
    }
});

test('loadEpicDescription refetches the same issue after the auth partition advances', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(DESCRIPTION));
    try {
        await module.loadEpicDescription('http://backend', { key: 'PLAT-1' });
        module.advanceEpicDescriptionAuthPartition();
        await module.loadEpicDescription('http://backend', { key: 'PLAT-1' });
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});

test('loadEpicDescription shares one in-flight request between concurrent openers', async () => {
    const module = await loadModule();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const stub = installFetch(async () => {
        await gate;
        return jsonResponse(DESCRIPTION);
    });
    try {
        const both = Promise.all([
            module.loadEpicDescription('http://backend', { key: 'PLAT-1' }),
            module.loadEpicDescription('http://backend', { key: 'PLAT-1' }),
        ]);
        release();
        const [first, second] = await both;
        assert.deepEqual(first, DESCRIPTION);
        assert.deepEqual(second, DESCRIPTION);
        assert.equal(stub.calls.length, 1);
    } finally {
        stub.restore();
    }
});

test('loadEpicDescription does not cache a failure, so Retry refetches', async () => {
    const module = await loadModule();
    const stub = installFetch((call) => (call === 1
        ? jsonResponse({ error: 'issue_description_fetch_failed', message: 'Jira returned status 500' }, 502)
        : jsonResponse(DESCRIPTION)));
    try {
        await assert.rejects(() => module.loadEpicDescription('http://backend', { key: 'PLAT-1' }));
        const retried = await module.loadEpicDescription('http://backend', { key: 'PLAT-1' });
        assert.deepEqual(retried, DESCRIPTION);
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});

test('loadEpicDescription surfaces issue_not_found as a coded error', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse({ error: 'issue_not_found' }, 404));
    try {
        await assert.rejects(
            () => module.loadEpicDescription('http://backend', { key: 'PLAT-9' }),
            (error) => {
                assert.equal(error.code, 'issue_not_found');
                assert.equal(error.status, 404);
                return true;
            },
        );
    } finally {
        stub.restore();
    }
});
