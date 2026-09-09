import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngBoardMutationCoordinator } from '../frontend/src/eng/engBoardMutationCoordinator.js';
import { strictEngBoardMutationProps } from '../frontend/src/eng/useStrictEngBoardIntegration.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test('different-key and different-type Board writes wait for the prior owner refresh', async () => {
    const coordinator = createEngBoardMutationCoordinator();
    const refresh = deferred();
    const order = [];
    const transaction = async (label, key, waitForRefresh = null) => {
        try {
            await coordinator.enqueue(key, async () => { order.push(`${label}:write`); });
            order.push(`${label}:refresh-start`);
            if (waitForRefresh) await waitForRefresh.promise;
            order.push(`${label}:refresh-end`);
        } finally {
            coordinator.complete();
        }
    };
    const status = transaction('status', 'ENG-1', refresh);
    await Promise.resolve();
    const priority = transaction('priority', 'ENG-2');
    const track = transaction('track', 'ENG-3');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(order, ['status:write', 'status:refresh-start']);
    refresh.resolve();
    await Promise.all([status, priority, track]);
    assert.deepEqual(order, [
        'status:write', 'status:refresh-start', 'status:refresh-end',
        'priority:write', 'priority:refresh-start', 'priority:refresh-end',
        'track:write', 'track:refresh-start', 'track:refresh-end',
    ]);
});

test('a failed Board write holds the lane through caller rollback', async () => {
    const coordinator = createEngBoardMutationCoordinator();
    const rollback = deferred();
    const order = [];
    const failed = (async () => {
        try {
            await coordinator.enqueue('ENG-1', async () => { order.push('status:write'); throw new Error('failed'); });
        } catch (_) {
            order.push('status:rollback-start');
            await rollback.promise;
            order.push('status:rollback-end');
        } finally { coordinator.complete(); }
    })();
    await Promise.resolve();
    const next = (async () => {
        try { await coordinator.enqueue('ENG-2', async () => { order.push('priority:write'); }); }
        finally { coordinator.complete(); }
    })();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(order, ['status:write', 'status:rollback-start']);
    rollback.resolve();
    await Promise.all([failed, next]);
    assert.deepEqual(order, ['status:write', 'status:rollback-start', 'status:rollback-end', 'priority:write']);
});

test('legacy Board status and priority successes retain local reconciliation without a reload', async () => {
    const calls = [];
    const props = strictEngBoardMutationProps({
        active: false,
        coordinator: null,
        refresh: async () => calls.push('strict-refresh'),
        sourceSurface: 'board',
        loadLegacy: () => calls.push('legacy-load'),
        retrySubtasks: ({ key }) => calls.push(`subtask:${key}`),
    });

    await props.status.onTransitionSuccessRefresh({ affectedSubtaskStoryKeys: ['ENG-1'] });
    await props.priority.onPrioritySuccessRefresh();

    assert.deepEqual(calls, ['subtask:ENG-1']);
});

test('strict Board status and priority successes refresh only the strict owner', async () => {
    const calls = [];
    const props = strictEngBoardMutationProps({
        active: true,
        coordinator: createEngBoardMutationCoordinator(),
        refresh: async () => calls.push('strict-refresh'),
        sourceSurface: 'board',
        loadLegacy: () => calls.push('legacy-load'),
        retrySubtasks: ({ key }) => calls.push(`subtask:${key}`),
    });

    await props.status.onTransitionSuccessRefresh({ affectedSubtaskStoryKeys: ['ENG-1'] });
    await props.priority.onPrioritySuccessRefresh();

    assert.deepEqual(calls, ['strict-refresh', 'strict-refresh']);
});
