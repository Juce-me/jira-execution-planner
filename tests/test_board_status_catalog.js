const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    const module = await import('../frontend/src/settings/boardStatusCatalog.js');
    module.clearBoardStatusCatalogCache();
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

const CATALOG = {
    boardId: '1042',
    projectKey: 'PLAT',
    statuses: [{ id: '10000', name: 'To Do' }],
};

test('loadBoardStatusCatalog fetches once per board id for the session', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(CATALOG));
    try {
        const first = await module.loadBoardStatusCatalog('http://backend', { boardId: '1042' });
        const second = await module.loadBoardStatusCatalog('http://backend', { boardId: '1042' });
        assert.deepEqual(first, CATALOG);
        assert.deepEqual(second, CATALOG);
        assert.equal(stub.calls.length, 1);
    } finally {
        stub.restore();
    }
});

test('loadBoardStatusCatalog refetches when the board id changes', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(CATALOG));
    try {
        await module.loadBoardStatusCatalog('http://backend', { boardId: '1042' });
        await module.loadBoardStatusCatalog('http://backend', { boardId: '2050' });
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});

test('loadBoardStatusCatalog refetches when the selected project scope changes', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(CATALOG));
    try {
        await module.loadBoardStatusCatalog('http://backend', {
            boardId: '1042',
            projectScopeKey: 'PLAT',
        });
        await module.loadBoardStatusCatalog('http://backend', {
            boardId: '1042',
            projectScopeKey: 'PLAT,TECH',
        });
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});

test('loadBoardStatusCatalog shares one in-flight request between concurrent callers', async () => {
    const module = await loadModule();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const stub = installFetch(async () => {
        await gate;
        return jsonResponse(CATALOG);
    });
    try {
        const both = Promise.all([
            module.loadBoardStatusCatalog('http://backend', { boardId: '1042' }),
            module.loadBoardStatusCatalog('http://backend', { boardId: '1042' }),
        ]);
        release();
        const [first, second] = await both;
        assert.deepEqual(first, CATALOG);
        assert.deepEqual(second, CATALOG);
        assert.equal(stub.calls.length, 1);
    } finally {
        stub.restore();
    }
});

test('loadBoardStatusCatalog does not cache a failure, so a retry refetches', async () => {
    const module = await loadModule();
    const stub = installFetch((call) => (call === 1
        ? jsonResponse({ error: 'board_statuses_fetch_failed', message: 'Jira returned status 500' }, 502)
        : jsonResponse(CATALOG)));
    try {
        await assert.rejects(() => module.loadBoardStatusCatalog('http://backend', { boardId: '1042' }));
        const retried = await module.loadBoardStatusCatalog('http://backend', { boardId: '1042' });
        assert.deepEqual(retried, CATALOG);
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});

test('loadBoardStatusCatalog surfaces no_board_configured as a coded error', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse({ error: 'no_board_configured' }, 400));
    try {
        await assert.rejects(
            () => module.loadBoardStatusCatalog('http://backend', { boardId: '' }),
            (error) => {
                assert.equal(error.code, 'no_board_configured');
                assert.equal(error.status, 400);
                return true;
            },
        );
    } finally {
        stub.restore();
    }
});

test('loadBoardStatusCatalog surfaces the 502 message', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(
        { error: 'board_statuses_fetch_failed', message: 'Jira returned status 500' },
        502,
    ));
    try {
        await assert.rejects(
            () => module.loadBoardStatusCatalog('http://backend', { boardId: '1042' }),
            (error) => {
                assert.equal(error.code, 'board_statuses_fetch_failed');
                assert.equal(error.status, 502);
                assert.match(error.message, /Jira returned status 500/);
                return true;
            },
        );
    } finally {
        stub.restore();
    }
});

test('clearBoardStatusCatalogCache forces the next load to refetch', async () => {
    const module = await loadModule();
    const stub = installFetch(() => jsonResponse(CATALOG));
    try {
        await module.loadBoardStatusCatalog('http://backend', { boardId: '1042' });
        module.clearBoardStatusCatalogCache();
        await module.loadBoardStatusCatalog('http://backend', { boardId: '1042' });
        assert.equal(stub.calls.length, 2);
    } finally {
        stub.restore();
    }
});
