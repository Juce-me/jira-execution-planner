const test = require('node:test');
const assert = require('node:assert/strict');

// Behavioural contract of the speculative status-options warm-up (prefetchTransitionOptions):
// one request per target signature, a hard in-flight cap, cache reuse, and silent failure.

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
        clone() { return this; },
    };
}

function installFetch(handler) {
    const calls = [];
    globalThis.fetch = (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body.issueKeys);
        return handler(body.issueKeys);
    };
    return calls;
}

const target = (key, status = 'To Do') => ({ key, issueType: 'Story', currentStatus: status });
const optionsFor = keys => jsonResponse({ issues: keys.map(key => ({ key, transitions: [] })), targetStatuses: [] });

async function load() {
    const module = await import('../frontend/src/eng/useEngStatusTransitions.js');
    module.clearTransitionOptionsCache();
    return module;
}

test('prefetch sends one request per signature and serves later prefetches from the cache', async () => {
    const { prefetchTransitionOptions } = await load();
    const calls = installFetch(keys => Promise.resolve(optionsFor(keys)));

    const first = prefetchTransitionOptions('', [target('PROD-1')]);
    assert.ok(first, 'a cold signature starts a request');
    assert.equal(prefetchTransitionOptions('', [target('PROD-2')]), null, 'same project/type/status joins the request already on the wire');
    await first;
    assert.equal(prefetchTransitionOptions('', [target('PROD-3')]), null, 'a cached signature sends nothing');
    assert.equal(calls.length, 1);
});

test('prefetch never has more than two requests in flight', async () => {
    const { prefetchTransitionOptions } = await load();
    const release = [];
    const calls = installFetch(keys => new Promise(resolve => release.push(() => resolve(optionsFor(keys)))));

    const a = prefetchTransitionOptions('', [target('PROD-1', 'To Do')]);
    const b = prefetchTransitionOptions('', [target('PROD-2', 'In Progress')]);
    const c = prefetchTransitionOptions('', [target('PROD-3', 'Done')]);
    assert.ok(a && b);
    assert.equal(c, null, 'the third distinct signature is skipped while two are in flight');
    assert.equal(calls.length, 2);

    release.forEach(fn => fn());
    await Promise.all([a, b]);
    assert.ok(prefetchTransitionOptions('', [target('PROD-3', 'Done')]), 'a slot frees up once a request settles');
    release.forEach(fn => fn());
});

test('a failed prefetch is silent, uncached and retried by the next prefetch', async () => {
    const { prefetchTransitionOptions } = await load();
    let fail = true;
    const calls = installFetch(keys => Promise.resolve(fail ? jsonResponse({ error: 'jira_transition_options_failed' }, 502) : optionsFor(keys)));

    assert.equal(await prefetchTransitionOptions('', [target('PROD-1')]), null);
    fail = false;
    const retry = prefetchTransitionOptions('', [target('PROD-1')]);
    assert.ok(retry, 'the failed signature is not cached');
    assert.ok(await retry);
    assert.equal(calls.length, 2);
});
