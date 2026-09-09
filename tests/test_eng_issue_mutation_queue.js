const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('multi-key reservations are atomic while disjoint jobs may run', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue();
    const state = { active: 0, maxActive: 0, started: [], release: [] };

    const ab = queue.enqueueMany(['PROD-B', 'PROD-A', 'PROD-A'], deferredJob('AB', state));
    const bc = queue.enqueueMany(['PROD-B', 'PROD-C'], deferredJob('BC', state));
    const d = queue.enqueue('PROD-D', deferredJob('D', state));

    await waitFor(() => state.started.length === 2, 'overlap/disjoint scheduling did not settle');
    assert.deepEqual(state.started, ['AB', 'D']);
    state.release.shift()();
    await waitFor(() => state.started.includes('BC'), 'overlapping job did not start after all keys released');
    while (state.release.length) state.release.shift()();
    assert.deepEqual(await Promise.all([ab, bc, d]), ['AB', 'BC', 'D']);
});

test('rejected jobs release every reserved key', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue();
    const expected = new Error('synthetic rejection');
    const first = queue.enqueueMany(['PROD-A', 'PROD-B'], async () => { throw expected; });
    const second = queue.enqueue('PROD-B', async () => 'released');

    await assert.rejects(first, error => error === expected);
    assert.equal(await second, 'released');
});

test('default queue concurrency never exceeds four active jobs', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue();
    const state = { active: 0, maxActive: 0, started: [], release: [] };
    const jobs = Array.from({ length: 6 }, (_, index) => (
        queue.enqueue(`PROD-${index + 1}`, deferredJob(`job-${index + 1}`, state))
    ));

    await waitFor(() => state.started.length === 4, 'default queue did not fill four slots');
    assert.equal(state.maxActive, 4);
    while (state.started.length < 6) {
        const nextStartedCount = state.started.length + 1;
        state.release.shift()();
        await waitFor(() => state.started.length >= nextStartedCount, 'queued job did not advance');
    }
    while (state.release.length) state.release.shift()();
    await Promise.all(jobs);
    assert.equal(state.maxActive, 4);
});

test('aborting a queued job prevents dispatch and rejects with AbortError', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue({ maxConcurrency: 1 });
    let releaseFirst;
    let canceledDispatches = 0;
    const first = queue.enqueue('PROD-A', () => new Promise(resolve => { releaseFirst = resolve; }));
    await waitFor(() => typeof releaseFirst === 'function', 'first job did not start');
    const controller = new AbortController();
    const canceled = queue.enqueue('PROD-B', async () => { canceledDispatches += 1; }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(canceled, error => error?.name === 'AbortError');
    releaseFirst('done');
    await first;
    assert.equal(canceledDispatches, 0);
});

test('pre-dispatch guard is rechecked in the dispatch turn', async () => {
    const { createIssueMutationQueue } = await import('../frontend/src/eng/engIssueMutationQueue.js');
    const queue = createIssueMutationQueue();
    let allowed = true;
    let dispatches = 0;
    const job = queue.enqueue('PROD-A', async () => { dispatches += 1; }, { shouldStart: () => allowed });
    allowed = false;
    await assert.rejects(job, error => error?.name === 'AbortError');
    assert.equal(dispatches, 0);
});

test('status, priority, and Project Track runners all use the shared queue with pre-dispatch guards', () => {
    for (const file of [
        'useEngStatusTransitions.js', 'useEngPriorityTransitions.js', 'useEngProjectTrackTransitions.js',
    ]) {
        const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng', file), 'utf8');
        assert.match(source, /await enqueueEngIssueMutations\(/, file);
        assert.match(source, /signal: queueController\.signal/, file);
        assert.match(source, /mutationScopeRef\.current === mutationScope && !readPendingAuthenticationRequired\(\)/, file);
        assert.doesNotMatch(source, /\? enqueueEngIssueMutation|: runMutation\(\)/, file);
    }
});
