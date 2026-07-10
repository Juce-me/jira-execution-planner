const test = require('node:test');
const assert = require('node:assert/strict');

async function waitFor(predicate, message) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(message);
        await new Promise(resolve => setImmediate(resolve));
    }
}

function deferredJob(key, state) {
    return () => new Promise((resolve) => {
        state.active += 1;
        state.maxActive = Math.max(state.maxActive, state.active);
        state.started.push(key);
        state.release.push(() => {
            state.active -= 1;
            resolve(key);
        });
    });
}

test('issue mutation queue caps simultaneous requests without dropping queued work', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue({ maxConcurrency: 2 });
    const state = { active: 0, maxActive: 0, started: [], release: [] };

    const jobs = ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']
        .map(key => queue.enqueue(key, deferredJob(key, state)));

    await waitFor(() => state.started.length === 2, 'first two jobs did not start');
    assert.equal(state.maxActive, 2);
    assert.deepEqual(state.started, ['PROD-1', 'PROD-2']);

    state.release.shift()();
    await waitFor(() => state.started.length === 3, 'third job did not start after a slot opened');
    state.release.shift()();
    await waitFor(() => state.started.length === 4, 'fourth job did not start after a slot opened');
    while (state.release.length) state.release.shift()();

    assert.deepEqual(await Promise.all(jobs), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.equal(state.maxActive, 2);
});

test('issue mutation queue serializes status and priority writes for the same issue key', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue({ maxConcurrency: 2 });
    const state = { active: 0, maxActive: 0, started: [], release: [] };

    const firstStatus = queue.enqueue('PROD-1', deferredJob('PROD-1:status', state));
    const sameIssuePriority = queue.enqueue('PROD-1', deferredJob('PROD-1:priority', state));
    const otherIssueStatus = queue.enqueue('PROD-2', deferredJob('PROD-2:status', state));

    await waitFor(() => state.started.length === 2, 'initial jobs did not start');
    assert.deepEqual(state.started, ['PROD-1:status', 'PROD-2:status']);

    state.release.shift()();
    await waitFor(() => state.started.length === 3, 'same-issue job did not start after the prior write completed');
    assert.equal(state.started[2], 'PROD-1:priority');
    while (state.release.length) state.release.shift()();

    await Promise.all([firstStatus, sameIssuePriority, otherIssueStatus]);
    assert.equal(state.maxActive, 2);
});

