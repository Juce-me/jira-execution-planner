const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToString } = require('react-dom/server');

// submitStatusTransition(status, key, { onSettled }) reports the classified outcome at most once,
// before the Board refresh, and stays silent for a job that never started.

async function mountHook({ coordinatorRun, onTransitionSuccessRefresh, fetchImpl } = {}) {
    const module = await import('../frontend/src/eng/useEngStatusTransitions.js');
    globalThis.fetch = fetchImpl || (() => new Promise(() => {}));
    const mutationCoordinator = {
        enqueue: (key, job) => coordinatorRun(job),
        complete: () => {},
    };
    let api = null;
    function Probe() {
        api = module.useEngStatusTransitions({
            backendUrl: '',
            trackIssueStatusAction: () => {},
            sourceSurface: 'board',
            mutationCoordinator,
            onTransitionSuccessRefresh,
        });
        return null;
    }
    renderToString(React.createElement(Probe));
    return api;
}

const success = { results: [{ key: 'PLAT-1', result: 'success', toStatus: 'Done' }] };

test('a confirmed write reports confirmed once, before the Board refresh', async () => {
    const events = [];
    const api = await mountHook({
        coordinatorRun: async () => success,
        onTransitionSuccessRefresh: async () => { events.push('refresh'); },
    });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, ['confirmed', 'refresh']);
});

test('a refresh that throws after a confirmed write does not report a second outcome', async () => {
    const events = [];
    const api = await mountHook({
        coordinatorRun: async () => success,
        onTransitionSuccessRefresh: async () => { throw new Error('refresh failed'); },
    });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, ['confirmed']);
});

test('a definitive failure result reports rejected', async () => {
    const events = [];
    const api = await mountHook({
        coordinatorRun: async () => ({ results: [{ key: 'PLAT-1', result: 'failure', error: 'transition_not_available' }] }),
    });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, ['rejected']);
});

test('a job aborted before it started is silent', async () => {
    const events = [];
    const api = await mountHook({
        coordinatorRun: async () => {
            const error = new Error('Issue mutation was canceled before dispatch.');
            error.name = 'AbortError';
            throw error;
        },
    });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, []);
});

test('a started job that fails definitively reports rejected', async () => {
    const events = [];
    const api = await mountHook({
        coordinatorRun: (job) => job(),
        fetchImpl: async (url) => (String(url).includes('/api/issues/transitions')
            ? new Response(JSON.stringify({ error: 'csrf_required' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
            : new Response(JSON.stringify({ csrfToken: 'token' }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, ['rejected']);
});

test('an error with no definitive code reports unconfirmed', async () => {
    const events = [];
    const api = await mountHook({
        coordinatorRun: async () => { throw Object.assign(new Error('network'), { status: 502 }); },
    });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, ['unconfirmed']);
});

test('a missing result reports unconfirmed', async () => {
    const events = [];
    const api = await mountHook({ coordinatorRun: async () => ({ results: [] }) });
    await api.submitStatusTransition('Done', 'PLAT-1', { onSettled: (outcome) => events.push(outcome) });
    assert.deepEqual(events, ['unconfirmed']);
});
