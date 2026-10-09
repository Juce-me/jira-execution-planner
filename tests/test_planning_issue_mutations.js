const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

// Behavioral harness for Planning priority/status edits (issue #250). It bundles the REAL hooks and
// the real mutation queue, replaces only React (a minimal runtime with state, refs, effects with
// cleanup, memo and callback), the Jira API module and the auth probe, and drives them with
// deferred API promises. Source regexes or server rendering cannot prove dispatch order, rollback
// or which refresh callbacks fire; this does.
const engDir = path.resolve(__dirname, '../frontend/src/eng');
const settle = () => new Promise(resolve => setImmediate(resolve));
async function flush(ticks = 6) {
    for (let i = 0; i < ticks; i += 1) await settle();
}

function createApi() {
    const writes = [];
    const transitions = [];
    const priorities = [
        { id: '1', name: 'Highest', rank: 10 },
        { id: '3', name: 'Medium', rank: 30 },
        { id: '4', name: 'Major', rank: 40 },
    ];
    return {
        writes,
        transitions,
        module: {
            fetchIssuePriorityOptions: async () => ({ priorities, source: 'jira', cached: false }),
            updateIssuePriorities: (_url, body) => new Promise((resolve, reject) => writes.push({ body, resolve, reject })),
            fetchIssueTransitionOptions: async () => ({ issues: [], targetStatuses: [] }),
            transitionIssues: (_url, body) => new Promise((resolve, reject) => transitions.push({ body, resolve, reject })),
        },
    };
}

function mountHook(file, exportName, api, makeProps) {
    const auth = {
        isAuthenticationRequiredError: error => error?.name === 'AuthenticationRequiredError',
        readPendingAuthenticationRequired: () => false,
    };
    return mountBundledHook({
        entry: path.join(engDir, file),
        exportName,
        modules: { '../api/jiraIssueApi.js': api.module, '../api/authRequired.js': auth },
        makeProps,
    });
}

function recorder() {
    return { applied: [], events: [], invalidated: [], refreshes: [] };
}

async function newEditState() {
    const { createEngIssueEditState } = await import('../frontend/src/eng/engIssueEditState.js');
    return createEngIssueEditState();
}

function priorityHarness(sourceSurface, extra = {}) {
    const api = createApi();
    const seen = recorder();
    const props = () => ({
        backendUrl: 'https://synthetic.invalid',
        selectedSprint: 3001,
        sourceSurface,
        mutationScopeKey: 'scope-a',
        trackIssuePriorityAction: (name, params) => seen.events.push([name, params]),
        onAuthRecoveryRequired: () => {},
        onApplyLocalPriority: (key, value, meta) => seen.applied.push([key, value, meta]),
        onAlertDataInvalidated: payload => seen.invalidated.push(payload),
        onPrioritySuccessRefresh: () => { seen.refreshes.push('scope-refresh'); },
        mutationCoordinator: null,
        ...extra,
    });
    const mounted = mountHook('useEngPriorityTransitions.js', 'useEngPriorityTransitions', api, props);
    return { api, seen, mounted };
}

const storyIssue = (key, priority = 'Medium') => ({
    key,
    fields: { priority: { name: priority }, issuetype: { name: 'Story' }, summary: `${key} synthetic story` },
});
const priorityResponse = (key, targetId = '4', targetName = 'Major') => ({
    requested: 1,
    succeeded: 1,
    failed: 0,
    targetPriority: { id: targetId, name: targetName },
    results: [{ key, result: 'success', fromPriority: 'Medium', toPriority: targetName }],
});
const rejectedPriorityResponse = key => ({
    requested: 1,
    succeeded: 0,
    failed: 1,
    targetPriority: { id: '4', name: 'Major' },
    results: [{ key, result: 'failure', error: 'priority_conflict' }],
});

async function openAndSubmitPriority(harness, key, priorityId = '4') {
    const { mounted } = harness;
    mounted.render();
    mounted.result.openPriorityControl(storyIssue(key), 'Story');
    await flush();
    mounted.render();
    const submitted = mounted.result.submitPriorityChange(priorityId, key);
    await flush();
    // Wrapped: returning the bare promise from an async function would make the caller await the
    // whole write, which only settles when the test resolves it.
    return { submitted };
}

test('Planning priority shows the choice before the write returns, writes one key and never refreshes the scope', async () => {
    const harness = priorityHarness('planning');
    const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');

    // The write is in flight and the optimistic value is already applied to that key only.
    assert.equal(harness.api.writes.length, 1);
    assert.deepEqual(harness.api.writes[0].body.issueKeys, ['PROD-1']);
    assert.equal(harness.api.writes[0].body.targetPriorityId, '4');
    assert.equal(harness.seen.applied.length >= 1, true, 'Planning must apply the new priority before the write returns');
    assert.equal(harness.seen.applied[0][0], 'PROD-1');
    assert.equal(harness.seen.applied[0][1].name, 'Major');

    harness.api.writes[0].resolve(priorityResponse('PROD-1'));
    await submitted;
    assert.deepEqual(harness.seen.refreshes, [], 'a successful Planning edit must not trigger a whole-scope refresh');
    assert.equal(harness.seen.applied.at(-1)[1].name, 'Major');
    harness.mounted.unmount();
});

test('Planning priority rejection restores the prior priority and never refreshes the scope', async () => {
    const harness = priorityHarness('planning');
    const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
    assert.equal(harness.seen.applied[0][1].name, 'Major');

    harness.api.writes[0].resolve(rejectedPriorityResponse('PROD-1'));
    await submitted;
    assert.deepEqual(harness.seen.applied.at(-1).slice(0, 2), ['PROD-1', { name: 'Medium' }]);
    assert.deepEqual(harness.seen.refreshes, []);
    harness.mounted.unmount();
});

test('Board priority success still refreshes the scope once and Catch Up never does', async () => {
    for (const [surface, expected] of [['board', 1], ['catch_up', 0]]) {
        const harness = priorityHarness(surface);
        const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
        harness.api.writes[0].resolve(priorityResponse('PROD-1'));
        await submitted;
        assert.equal(harness.seen.refreshes.length, expected, `${surface} refresh count`);
        harness.mounted.unmount();
    }
});

test('only a confirmed Planning priority edit asks for a re-sort of its lane', async () => {
    for (const [surface, reorder] of [['planning', true], ['catch_up', false], ['board', false]]) {
        const harness = priorityHarness(surface);
        const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
        assert.equal(harness.seen.applied[0][2].reorder, undefined, `${surface}: the optimistic display never reorders`);
        assert.equal(harness.seen.applied[0][2].reveal, reorder, `${surface}: only Planning starts a reveal at the click`);
        harness.api.writes[0].resolve(priorityResponse('PROD-1'));
        await submitted;
        assert.equal(harness.seen.applied.at(-1)[2].phase, 'confirmed');
        assert.equal(harness.seen.applied.at(-1)[2].reorder, reorder, `${surface}: reorder flag on the confirmed settlement`);
        assert.equal(harness.seen.applied.at(-1)[2].reveal, reorder, `${surface}: only a Planning edit blinks and reveals once confirmed`);
        harness.mounted.unmount();
    }
    const rejected = priorityHarness('planning');
    const { submitted } = await openAndSubmitPriority(rejected, 'PROD-1');
    rejected.api.writes[0].resolve(rejectedPriorityResponse('PROD-1'));
    await submitted;
    assert.equal(rejected.seen.applied.some(call => call[2]?.reorder), false, 'a rejection never reorders');
    rejected.mounted.unmount();
});

function statusHarness(sourceSurface, extra = {}) {
    const api = createApi();
    const seen = { applied: [], events: [], refreshes: [], invalidated: [] };
    const props = () => ({
        backendUrl: 'https://synthetic.invalid',
        storySubtasksByKey: {},
        selectedSprint: 3001,
        sourceSurface,
        mutationScopeKey: 'scope-a',
        trackIssueStatusAction: (name, params) => seen.events.push([name, params]),
        onAuthRecoveryRequired: () => {},
        onApplyLocalStatus: (key, status, meta) => seen.applied.push([key, status, meta]),
        onAlertDataInvalidated: payload => seen.invalidated.push(payload),
        onTransitionSuccessRefresh: () => { seen.refreshes.push('scope-refresh'); },
        mutationCoordinator: null,
        ...extra,
    });
    const mounted = mountHook('useEngStatusTransitions.js', 'useEngStatusTransitions', api, props);
    return { api, seen, mounted };
}
const transitionResponse = (key, to = 'In Progress') => ({
    requested: 1,
    succeeded: 1,
    failed: 0,
    targetStatus: to,
    results: [{ key, result: 'success', fromStatus: 'To Do', toStatus: to }],
});

test('a status submit without an issue key writes nothing on every surface', async () => {
    for (const surface of ['planning', 'catch_up', 'board']) {
        const harness = statusHarness(surface);
        harness.mounted.render();
        const outcome = await harness.mounted.result.submitStatusTransition('In Progress');
        await flush();
        assert.equal(outcome, null, `${surface} keyless submit result`);
        assert.equal(harness.api.transitions.length, 0, `${surface} keyless submit must not write`);
        assert.deepEqual(harness.seen.applied, []);
        harness.mounted.unmount();
    }
});

test('a status write targets exactly the passed key whatever the Planning selection holds', async () => {
    const harness = statusHarness('planning');
    harness.mounted.render();
    const submitted = harness.mounted.result.submitStatusTransition('In Progress', 'PROD-1');
    await flush();
    assert.equal(harness.api.transitions.length, 1);
    assert.deepEqual(harness.api.transitions[0].body.issueKeys, ['PROD-1']);
    assert.deepEqual(harness.seen.applied[0].slice(0, 2), ['PROD-1', 'In Progress']);

    harness.api.transitions[0].resolve(transitionResponse('PROD-1'));
    await submitted;
    assert.deepEqual(harness.seen.refreshes, [], 'a Planning status edit must not refresh the scope');
    harness.mounted.unmount();
});

test('only a Planning status edit asks to be revealed, at the click and at its confirmation', async () => {
    for (const [surface, reveal] of [['planning', true], ['catch_up', false], ['board', false]]) {
        const harness = statusHarness(surface);
        harness.mounted.render();
        const submitted = harness.mounted.result.submitStatusTransition('In Progress', 'PROD-1');
        await flush();
        assert.equal(harness.seen.applied[0][2].reveal, reveal, `${surface}: optimistic meta`);
        harness.api.transitions[0].resolve(transitionResponse('PROD-1'));
        await submitted;
        assert.equal(harness.seen.applied.at(-1)[2].phase, 'confirmed');
        assert.equal(harness.seen.applied.at(-1)[2].reveal, reveal, `${surface}: confirmed meta`);
        harness.mounted.unmount();
    }
});

test('Board status success still refreshes the scope once', async () => {
    const harness = statusHarness('board');
    harness.mounted.render();
    const submitted = harness.mounted.result.submitStatusTransition('In Progress', 'PROD-1');
    await flush();
    harness.api.transitions[0].resolve(transitionResponse('PROD-1'));
    await submitted;
    assert.equal(harness.seen.refreshes.length, 1);
    harness.mounted.unmount();
});

// ---- registry-backed lifecycle (issue #250 Tasks 2-3) ------------------------------------------
async function registryPriorityHarness(sourceSurface = 'planning', extra = {}) {
    const editState = await newEditState();
    return { editState, ...priorityHarness(sourceSurface, { issueEditState: editState, ...extra }) };
}
const lastApplied = harness => harness.seen.applied.at(-1);

test('a second priority edit of the same issue is refused while the first is pending', async () => {
    const harness = await registryPriorityHarness();
    const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
    harness.mounted.render();
    const second = await harness.mounted.result.submitPriorityChange('1', 'PROD-1');

    assert.equal(second, null);
    assert.equal(harness.api.writes.length, 1, 'no second write may start from a stale base');
    harness.api.writes[0].resolve(priorityResponse('PROD-1'));
    await submitted;
    harness.mounted.unmount();
});

test('every ambiguous outcome locks the field, shows the prior as provisional and never refreshes', async () => {
    const cases = [
        ['priority_update_failed', { requested: 1, succeeded: 0, failed: 1, targetPriority: { id: '4', name: 'Major' }, results: [{ key: 'PROD-1', result: 'failure', error: 'priority_update_failed' }] }],
        ['priority_update_timeout', { requested: 1, succeeded: 0, failed: 1, targetPriority: { id: '4', name: 'Major' }, results: [{ key: 'PROD-1', result: 'failure', error: 'priority_update_timeout' }] }],
        ['an unknown code', { requested: 1, succeeded: 0, failed: 1, targetPriority: { id: '4', name: 'Major' }, results: [{ key: 'PROD-1', result: 'failure', error: 'brand_new_error' }] }],
        ['a missing result', { requested: 1, succeeded: 1, failed: 0, targetPriority: { id: '4', name: 'Major' }, results: [] }],
        ['a duplicate result', { requested: 1, succeeded: 2, failed: 0, targetPriority: { id: '4', name: 'Major' }, results: [{ key: 'PROD-1', result: 'success' }, { key: 'PROD-1', result: 'success' }] }],
        ['a mismatched target id', { requested: 1, succeeded: 1, failed: 0, targetPriority: { id: '1', name: 'Highest' }, results: [{ key: 'PROD-1', result: 'success' }] }],
    ];
    for (const [label, response] of cases) {
        const harness = await registryPriorityHarness();
        const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
        harness.api.writes[0].resolve(response);
        await submitted;
        harness.mounted.render();

        assert.equal(harness.editState.planningPhase('PROD-1', 'priority'), 'locked', label);
        assert.deepEqual(lastApplied(harness).slice(0, 2), ['PROD-1', { name: 'Medium' }], `${label}: provisional prior`);
        assert.equal(lastApplied(harness)[2].phase, 'provisional', label);
        assert.equal(harness.mounted.result.priorityErrorCode, 'write_unconfirmed', label);
        assert.deepEqual(harness.seen.refreshes, [], label);
        // Closing the menu does not erase the lock: another edit of that field is refused with a message.
        harness.mounted.result.openPriorityControl(storyIssue('PROD-1', 'Medium'), 'Story');
        await flush();
        harness.mounted.render();
        assert.equal(await harness.mounted.result.submitPriorityChange('1', 'PROD-1'), null, label);
        assert.equal(harness.api.writes.length, 1, label);
        harness.mounted.render();
        assert.equal(harness.mounted.result.priorityErrorCode, 'write_unconfirmed', `${label}: refusal explains the lock`);
        harness.mounted.unmount();
    }
});

test('a thrown error after the job started is unconfirmed unless it is an enumerated rejection', async () => {
    const cases = [
        [{ status: 502, code: 'jira_priority_update_failed' }, 'locked', 'unknown'],
        [{ message: 'network down' }, 'locked', 'unknown'],
        [{ status: 403, code: 'csrf_required' }, null, 'failure'],
        [{ status: 400, code: 'invalid_priority_id' }, null, 'failure'],
    ];
    for (const [error, phase, analytics] of cases) {
        const harness = await registryPriorityHarness();
        const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
        harness.api.writes[0].reject(Object.assign(new Error(error.message || 'failed'), error));
        await submitted;
        assert.equal(harness.editState.planningPhase('PROD-1', 'priority'), phase, JSON.stringify(error));
        assert.equal(harness.seen.events.at(-1)[1].result, analytics, JSON.stringify(error));
        assert.equal(lastApplied(harness)[1].name, 'Medium', JSON.stringify(error));
        harness.mounted.unmount();
    }
});

test('a terminal auth error abandons the edit: no rollback, no lock and no replay', async () => {
    const harness = await registryPriorityHarness();
    const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
    const appliedBefore = harness.seen.applied.length;
    harness.api.writes[0].reject(Object.assign(new Error('auth required'), { name: 'AuthenticationRequiredError' }));
    assert.equal(await submitted, null);

    assert.equal(harness.seen.applied.length, appliedBefore, 'nothing is rolled back or published');
    assert.equal(harness.editState.planningPhase('PROD-1', 'priority'), 'abandoned');
    assert.equal(harness.api.writes.length, 1);
    assert.equal(harness.seen.events.at(-1)[1].result, 'unknown');
    harness.mounted.unmount();
});

test('a stale already_in_priority after a write in this session is unconfirmed, a fresh one is confirmed', async () => {
    const alreadyIn = { requested: 1, succeeded: 1, failed: 0, targetPriority: { id: '1', name: 'Highest' }, results: [{ key: 'PROD-1', result: 'already_in_priority', fromPriority: 'Highest' }] };
    const fresh = await registryPriorityHarness();
    const freshRun = await openAndSubmitPriority(fresh, 'PROD-1', '1');
    fresh.api.writes[0].resolve(alreadyIn);
    await freshRun.submitted;
    assert.equal(fresh.editState.planningPhase('PROD-1', 'priority'), null, 'no earlier write: confirmed');
    fresh.mounted.unmount();

    const stale = await registryPriorityHarness();
    const first = await openAndSubmitPriority(stale, 'PROD-1', '4');
    stale.api.writes[0].resolve(priorityResponse('PROD-1'));
    await first.submitted;
    const second = await openAndSubmitPriority(stale, 'PROD-1', '1');
    stale.api.writes[1].resolve(alreadyIn);
    await second.submitted;
    assert.equal(stale.editState.planningPhase('PROD-1', 'priority'), 'locked', 'a write since the last evidenced read makes already_in untrustworthy');
    stale.mounted.unmount();
});

test('a response landing after a scope switch still settles its issue by key but never revives the old feedback', async () => {
    const harness = await registryPriorityHarness();
    const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
    harness.mounted.render({ mutationScopeKey: 'scope-b' });
    harness.mounted.render({ mutationScopeKey: 'scope-a' });
    harness.api.writes[0].resolve(priorityResponse('PROD-1'));
    await submitted;
    harness.mounted.render({ mutationScopeKey: 'scope-a' });

    assert.equal(lastApplied(harness)[1].name, 'Major', 'the confirmed value is published for the issue wherever it is cached');
    assert.equal(lastApplied(harness)[2].phase, 'confirmed');
    assert.equal(harness.mounted.result.priorityResult, null, 'A -> B -> A must not revive the first visit\'s result banner');
    assert.equal(harness.editState.planningPhase('PROD-1', 'priority'), null);
    harness.mounted.unmount();
});

test('a job still queued when the scope changes is cancelled and restores its optimistic value', async () => {
    const harness = await registryPriorityHarness();
    const keys = ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4', 'PROD-5'];
    const runs = [];
    for (const key of keys) runs.push((await openAndSubmitPriority(harness, key)).submitted);
    assert.equal(harness.api.writes.length, 4, 'the queue starts at most four writes');

    harness.mounted.render({ mutationScopeKey: 'scope-b' });
    await flush();
    assert.equal(harness.api.writes.length, 4, 'the fifth job never dispatches');
    assert.equal(harness.editState.planningPhase('PROD-5', 'priority'), null);
    const restore = harness.seen.applied.filter(([key, , meta]) => key === 'PROD-5' && meta?.phase === 'rejected');
    assert.equal(restore.length, 1);
    assert.deepEqual(restore[0][1], { name: 'Medium' });
    assert.equal(restore[0][2].expected.name, 'Major', 'the restore is guarded by the optimistic value');
    harness.api.writes.forEach((write, index) => write.resolve(priorityResponse(keys[index])));
    await Promise.all(runs);
    harness.mounted.unmount();
});

test('analytics: a submit is emitted when the job starts and every started job reports exactly one result', async () => {
    const harness = await registryPriorityHarness();
    const { submitted } = await openAndSubmitPriority(harness, 'PROD-1');
    const names = () => harness.seen.events.map(([name]) => name).filter(name => name !== 'priority_options_open');
    assert.deepEqual(names(), ['priority_change_submit']);
    harness.api.writes[0].resolve(priorityResponse('PROD-1'));
    await submitted;
    assert.deepEqual(names(), ['priority_change_submit', 'priority_change_result']);
    assert.equal(harness.seen.events.at(-1)[1].result, 'success');
    harness.mounted.unmount();
});

test('two different issues edit independently and each settles on its own response', async () => {
    const harness = await registryPriorityHarness();
    const first = await openAndSubmitPriority(harness, 'PROD-1');
    const second = await openAndSubmitPriority(harness, 'PROD-2', '1');
    assert.equal(harness.api.writes.length, 2);

    harness.api.writes[1].resolve(rejectedPriorityResponse('PROD-2'));
    await second.submitted;
    assert.equal(harness.editState.planningPhase('PROD-2', 'priority'), null);
    assert.equal(harness.editState.planningPhase('PROD-1', 'priority'), 'pending', 'the other edit is untouched');
    harness.api.writes[0].resolve(priorityResponse('PROD-1'));
    await first.submitted;
    assert.deepEqual(harness.seen.refreshes, []);
    harness.mounted.unmount();
});

// ---- status hook on the same registry (issue #250 Task 4) --------------------------------------
async function registryStatusHarness(sourceSurface = 'planning', extra = {}) {
    const editState = await newEditState();
    return { editState, ...statusHarness(sourceSurface, { issueEditState: editState, ...extra }) };
}
async function submitStatus(harness, key, status = 'In Progress', target = { key, issueType: 'Story', currentStatus: 'To Do', summary: '' }) {
    harness.mounted.render();
    harness.mounted.result.openSingleIssueStatusControl?.({ key, fields: { status: { name: target.currentStatus }, issuetype: { name: target.issueType } } }, target.issueType);
    await flush();
    harness.mounted.render();
    const submitted = harness.mounted.result.submitStatusTransition(status, key);
    await flush();
    return { submitted };
}

test('a status edit shows at once with its phase, and a rejection returns to Jira\'s current status guarded by the optimistic value', async () => {
    const harness = await registryStatusHarness();
    const { submitted } = await submitStatus(harness, 'PROD-1');
    assert.deepEqual(harness.seen.applied[0], ['PROD-1', 'In Progress', { phase: 'optimistic', reveal: true }]);

    harness.api.transitions[0].resolve({
        requested: 1, succeeded: 0, failed: 1, targetStatus: 'In Progress',
        results: [{ key: 'PROD-1', result: 'failure', error: 'transition_conflict', currentStatus: 'Analysis' }],
    });
    await submitted;
    assert.deepEqual(harness.seen.applied.at(-1), ['PROD-1', 'Analysis', { phase: 'rejected', expected: 'In Progress' }]);
    assert.equal(harness.editState.planningPhase('PROD-1', 'status'), null);
    assert.deepEqual(harness.seen.refreshes, []);
    harness.mounted.unmount();
});

test('an ambiguous status outcome locks the field and a second edit is refused with the lock message', async () => {
    for (const response of [
        { requested: 1, succeeded: 0, failed: 1, targetStatus: 'In Progress', results: [{ key: 'PROD-1', result: 'failure', error: 'transition_failed' }] },
        { requested: 1, succeeded: 0, failed: 1, targetStatus: 'In Progress', results: [{ key: 'PROD-1', result: 'failure', error: 'transition_timeout' }] },
        { requested: 1, succeeded: 1, failed: 0, targetStatus: 'In Progress', results: [] },
    ]) {
        const harness = await registryStatusHarness();
        const { submitted } = await submitStatus(harness, 'PROD-1');
        harness.api.transitions[0].resolve(response);
        await submitted;
        harness.mounted.render();

        assert.equal(harness.editState.planningPhase('PROD-1', 'status'), 'locked');
        assert.deepEqual(harness.seen.applied.at(-1), ['PROD-1', 'To Do', { phase: 'provisional', expected: 'In Progress' }]);
        assert.equal(harness.mounted.result.transitionErrorCode, 'write_unconfirmed');
        assert.equal(await harness.mounted.result.submitStatusTransition('Done', 'PROD-1'), null);
        assert.equal(harness.api.transitions.length, 1, 'no second write while locked');
        assert.equal(harness.seen.events.at(-1)[1].result, 'unknown');
        harness.mounted.unmount();
    }
});

test('a second status edit of a pending issue is refused, and a terminal auth error abandons without rollback', async () => {
    const harness = await registryStatusHarness();
    const { submitted } = await submitStatus(harness, 'PROD-1');
    assert.equal(await harness.mounted.result.submitStatusTransition('Done', 'PROD-1'), null);
    assert.equal(harness.api.transitions.length, 1);

    const appliedBefore = harness.seen.applied.length;
    harness.api.transitions[0].reject(Object.assign(new Error('auth required'), { name: 'AuthenticationRequiredError' }));
    assert.equal(await submitted, null);
    assert.equal(harness.seen.applied.length, appliedBefore);
    assert.equal(harness.editState.planningPhase('PROD-1', 'status'), 'abandoned');
    harness.mounted.unmount();
});

test('a status response landing after A -> B -> A settles by key but never revives the old feedback', async () => {
    const harness = await registryStatusHarness();
    const { submitted } = await submitStatus(harness, 'PROD-1');
    harness.mounted.render({ mutationScopeKey: 'scope-b' });
    harness.mounted.render({ mutationScopeKey: 'scope-a' });
    harness.api.transitions[0].resolve(transitionResponse('PROD-1'));
    await submitted;
    harness.mounted.render({ mutationScopeKey: 'scope-a' });

    assert.deepEqual(harness.seen.applied.at(-1), ['PROD-1', 'In Progress', { phase: 'confirmed', reveal: true }]);
    assert.equal(harness.mounted.result.transitionResult, null);
    harness.mounted.unmount();
});

test('status analytics: submit at job start, one result per started job, Board refreshes only on a confirmed outcome', async () => {
    const harness = await registryStatusHarness('board');
    const { submitted } = await submitStatus(harness, 'PROD-1');
    const names = () => harness.seen.events.map(([name]) => name).filter(name => name !== 'status_options_open');
    assert.deepEqual(names(), ['status_change_submit']);
    harness.api.transitions[0].resolve(transitionResponse('PROD-1'));
    await submitted;
    assert.deepEqual(names(), ['status_change_submit', 'status_change_result']);
    assert.equal(harness.seen.refreshes.length, 1);

    const failing = await registryStatusHarness('board');
    const failed = await submitStatus(failing, 'PROD-2');
    failing.api.transitions[0].reject(Object.assign(new Error('gateway'), { status: 502, code: 'jira_transition_failed' }));
    await failed.submitted;
    assert.deepEqual(failing.seen.refreshes, [], 'an unconfirmed write never triggers the Board refresh');
    harness.mounted.unmount();
    failing.mounted.unmount();
});

test('status analytics: selected_sp_bucket describes the one Story that was submitted, never the selection', async () => {
    const { bucketCount } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    const story = (key, points) => ({ key, fields: { issuetype: { name: 'Story' }, status: { name: 'To Do' }, summary: 'synthetic', customfield_10004: points } });
    const run = async (surface, issue, issueType) => {
        const harness = await registryStatusHarness(surface);
        harness.mounted.render();
        harness.mounted.result.openSingleIssueStatusControl(issue, issueType);
        await flush();
        harness.mounted.render();
        const submitted = harness.mounted.result.submitStatusTransition('In Progress', issue.key);
        await flush();
        harness.api.transitions[0].resolve(transitionResponse(issue.key));
        await submitted;
        const events = harness.seen.events.filter(([name]) => name !== 'status_options_open');
        harness.mounted.unmount();
        return events;
    };

    const planning = await run('planning', story('PROD-2', 13), 'Story');
    assert.deepEqual(planning.map(([name]) => name), ['status_change_submit', 'status_change_result']);
    planning.forEach(([, params]) => assert.equal(params.selected_sp_bucket, bucketCount(13), 'the clicked Story, even with other Stories selected elsewhere'));
    assert.equal(planning[1][1].result, 'success');

    const unpointed = await run('planning', story('PROD-4', null), 'Story');
    assert.equal(unpointed[0][1].selected_sp_bucket, bucketCount(0), 'a Story with no points buckets as zero');

    const epic = await run('planning', { key: 'PROD-9', fields: { issuetype: { name: 'Epic' }, status: { name: 'To Do' }, summary: 'synthetic' } }, 'Epic');
    assert.equal('selected_sp_bucket' in epic[0][1], false, 'an Epic-only action omits the parameter');

    const catchUp = await run('catch_up', story('PROD-2', 13), 'Story');
    assert.equal('selected_sp_bucket' in catchUp[0][1], false, 'Catch Up omits it');
    assert.equal(JSON.stringify(planning).includes('PROD-2'), false, 'no raw issue key reaches the analytics payload');
});

// ---- loader seam: base capture, overlay after the sort, lock release by raw evidence (Task 2) ---
const fs = require('node:fs');

async function loaderHarness(fetchEngTasks, { editState, activeGroupTeamIds = ['team-a'] } = {}) {
    const { sortTasksByPriority, PRIORITY_ORDER } = await import('../frontend/src/eng/engTaskUtils.js');
    const source = fs.readFileSync(path.join(engDir, 'useEngSprintData.js'), 'utf8')
        .replace(/^import\s+[^;]+;\s*$/gm, '')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    const dependencies = {
        requestBacklogEpics: async () => ({ epics: [] }),
        fetchEngTasks,
        isAuthenticationRequiredError: error => error?.name === 'AuthenticationRequiredError',
        refreshAuthSession: async () => ({ ok: false, status: 401, json: async () => ({}) }),
        PRIORITY_ORDER,
        filterEpicsByTaskEpicKeys: () => ({}),
        filterEpicsInScopeForTeamSet: epics => epics,
        filterTasksForTeamSet: tasks => tasks,
        sortTasksByPriority,
        flattenTeamLabelAliases: () => [],
    };
    const { useEngSprintData } = new Function(...Object.keys(dependencies), `${source}; return { useEngSprintData };`)(...Object.values(dependencies));
    const captured = { product: [], tech: [] };
    const noop = () => {};
    const api = useEngSprintData({
        backendUrl: 'http://localhost:5050',
        selectedSprint: '2026Q1',
        activeGroupId: '',
        activeGroupTeamIds,
        activeGroupTeamSet: new Set(),
        pageLoadRefreshRef: { current: false },
        sprintLoadRef: { current: {} },
        lastLoadedSprintRef: { current: '' },
        registerSprintFetch: () => ({ signal: { aborted: false } }),
        cleanupSprintFetch: noop,
        isFutureSprintSelected: false,
        loadedProductTasks: [],
        loadedTechTasks: [],
        setLoading: noop, setError: noop, setEpicDetails: noop,
        setProductTasks: tasks => captured.product.push(tasks),
        setTechTasks: tasks => captured.tech.push(tasks),
        setLoadedProductTasks: noop, setLoadedTechTasks: noop, setTasksFetched: noop, setTechLoaded: noop,
        setProductTasksLoading: noop, setTechTasksLoading: noop, setProductEpicsInScope: noop, setTechEpicsInScope: noop,
        setReadyToCloseProductTasks: noop, setReadyToCloseTechTasks: noop,
        setReadyToCloseProductEpicsInScope: noop, setReadyToCloseTechEpicsInScope: noop,
        issueEditState: editState,
    });
    return { api, captured };
}
const jsonResponse = body => new Response(JSON.stringify(body));
const rawStory = (key, priority, status = 'To Do') => ({ key, fields: { priority: { name: priority }, status: { name: status } } });

test('loader: a read that lands while an edit is pending keeps the optimistic value and never moves the pending Story', async () => {
    const editState = await newEditState();
    editState.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Low' }, optimistic: { name: 'Highest' }, scope: 'scope-a' });
    const { api, captured } = await loaderHarness(async () => jsonResponse({
        issues: [rawStory('DEMO-1', 'Low'), rawStory('DEMO-2', 'High'), rawStory('DEMO-3', 'Medium')],
    }), { editState });

    await api.loadProductTasks({ forceRefresh: true });
    const lane = captured.product.at(-1);
    assert.deepEqual(lane.map(issue => issue.key), ['DEMO-2', 'DEMO-3', 'DEMO-1'], 'ordered by the raw read, so the pending Story stays where its original priority puts it');
    assert.equal(lane.find(issue => issue.key === 'DEMO-1').fields.priority.name, 'Highest', 'but it still displays the optimistic value');
});

test('loader: the base of an open edit comes from the raw read, not from the overlaid array', async () => {
    const editState = await newEditState();
    const token = editState.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Low' }, optimistic: { name: 'Highest' }, scope: 'scope-a' });
    const { api } = await loaderHarness(async () => jsonResponse({ issues: [rawStory('DEMO-1', 'Medium')] }), { editState });

    await api.loadProductTasks({ forceRefresh: true });
    assert.deepEqual(editState.settlePlanningRejected(token).base, { name: 'Medium' }, 'a second (overlaid) pass must not turn the optimistic value into the base');
});

test('loader: only an operator Refresh releases a lock, and only from raw evidence for its own scope', async () => {
    const lockedEdit = async () => {
        const editState = await newEditState();
        const token = editState.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Low' }, optimistic: { name: 'Highest' }, scope: 'scope-a' });
        editState.settlePlanningUnconfirmed(token);
        return editState;
    };
    const fetchWith = issues => async () => jsonResponse({ issues });

    const ordinary = await lockedEdit();
    await (await loaderHarness(fetchWith([rawStory('DEMO-1', 'Medium')]), { editState: ordinary })).api.loadProductTasks({ forceRefresh: true });
    assert.equal(ordinary.planningPhase('DEMO-1', 'priority'), 'locked', 'an ordinary load never releases a lock');

    const otherScope = await lockedEdit();
    await (await loaderHarness(fetchWith([rawStory('DEMO-1', 'Medium')]), { editState: otherScope })).api.loadProductTasks({ forceRefresh: true, operatorRefresh: { scope: 'scope-b' } });
    assert.equal(otherScope.planningPhase('DEMO-1', 'priority'), 'locked', 'evidence for another scope is not evidence');

    const absent = await lockedEdit();
    await (await loaderHarness(fetchWith([rawStory('DEMO-9', 'Low')]), { editState: absent })).api.loadProductTasks({ forceRefresh: true, operatorRefresh: { scope: 'scope-a' } });
    assert.equal(absent.planningPhase('DEMO-1', 'priority'), 'locked', 'absence from a load proves nothing (the task list is capped)');

    const released = await lockedEdit();
    const { api, captured } = await loaderHarness(fetchWith([rawStory('DEMO-1', 'Medium')]), { editState: released });
    await api.loadProductTasks({ forceRefresh: true, operatorRefresh: { scope: 'scope-a' } });
    assert.equal(released.planningPhase('DEMO-1', 'priority'), null);
    assert.equal(captured.product.at(-1)[0].fields.priority.name, 'Medium', 'a released key shows what Jira returned, not the provisional prior');
});

test('loader: a failed lane cannot release the locks of its own keys, and an ignored load changes nothing', async () => {
    const editState = await newEditState();
    const token = editState.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Low' }, optimistic: { name: 'Highest' }, scope: 'scope-a' });
    editState.settlePlanningUnconfirmed(token);
    const failing = await loaderHarness(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }), { editState });
    await failing.api.loadTechTasks({ forceRefresh: true, operatorRefresh: { scope: 'scope-a' } });
    assert.equal(editState.planningPhase('DEMO-1', 'priority'), 'locked');

    const ignored = await loaderHarness(async () => jsonResponse({ issues: [rawStory('DEMO-1', 'Medium')] }), { editState });
    await ignored.api.loadProductTasks({ forceRefresh: true, operatorRefresh: { scope: 'scope-a' }, shouldApplyResult: () => false });
    assert.equal(editState.planningPhase('DEMO-1', 'priority'), 'locked', 'an older Refresh load is ignored and releases nothing');
    assert.equal(ignored.captured.product.length, 0);
});

test('loader: a committed read after a write is the evidence that makes already_in_* trustworthy again', async () => {
    const editState = await newEditState();
    const token = editState.reservePlanningEdit({ issueKey: 'DEMO-1', field: 'priority', prior: { name: 'Low' }, optimistic: { name: 'Highest' }, scope: 'scope-a' });
    editState.settlePlanningConfirmed(token, { name: 'Highest' });
    assert.equal(editState.hasUnevidencedPlanningWrite('DEMO-1', 'priority'), true);

    const { api } = await loaderHarness(async () => jsonResponse({ issues: [rawStory('DEMO-1', 'Highest')] }), { editState });
    await api.loadProductTasks({ forceRefresh: true });
    assert.equal(editState.hasUnevidencedPlanningWrite('DEMO-1', 'priority'), false);
});

function planningEditsHarness(issueEditState) {
    const released = [];
    const mounted = mountBundledHook({
        entry: path.join(engDir, 'usePlanningIssueEdits.js'),
        exportName: 'usePlanningIssueEdits',
        makeProps: () => ({ issueEditState, onReorderReleased: key => released.push(key) }),
    });
    mounted.render();
    return { mounted, released };
}
const reserveStatus = (state, key, prior, optimistic) => state.reservePlanningEdit({ issueKey: key, field: 'status', prior: { name: prior }, optimistic: { name: optimistic }, scope: 's' });

test('Planning originals follow the open edits and keep their identity between changes', async () => {
    const state = await newEditState();
    const { mounted } = planningEditsHarness(state);
    const first = mounted.render().planningOriginals;
    assert.equal(first.size, 0);
    assert.equal(mounted.render().planningOriginals, first, 'no change, same identity');

    const token = reserveStatus(state, 'PROD-1', 'To Do', 'Done');
    assert.equal(mounted.render().planningOriginals.get('PROD-1').status.name, 'To Do');
    state.settlePlanningConfirmed(token, { name: 'Done' });
    assert.equal(mounted.render().planningOriginals.size, 0, 'a settled edit stops projecting when no editor is open');
    mounted.unmount();
});

test('an edit that settles while an editor is open keeps projecting by its original until the last editor closes', async () => {
    const state = await newEditState();
    const { mounted, released } = planningEditsHarness(state);
    const token = reserveStatus(state, 'PROD-1', 'To Do', 'Done');
    mounted.render();
    mounted.result.holdEditor('fields', 'PROD-2');
    mounted.render();

    state.settlePlanningConfirmed(token, { name: 'Done' });
    assert.equal(mounted.render().planningOriginals.get('PROD-1').status.name, 'To Do', 'the confirmed edit stays where it was while the editor is open');

    const second = reserveStatus(state, 'PROD-3', 'To Do', 'Killed');
    mounted.render();
    state.settlePlanningRejected(second);
    assert.equal(mounted.render().planningOriginals.get('PROD-3').status.name, 'To Do', 'a rejection during the hold is retained too (it equals the display)');

    mounted.result.holdEditor('fields', '');
    assert.equal(mounted.render().planningOriginals.size, 0, 'closing the editor releases every retained original at once');
    assert.deepEqual(released, []);
    mounted.unmount();
});

test('the earliest original wins when the same field is edited again during a hold', async () => {
    const state = await newEditState();
    const { mounted } = planningEditsHarness(state);
    mounted.render();
    mounted.result.holdEditor('fields', 'PROD-9');
    const first = reserveStatus(state, 'PROD-1', 'To Do', 'In Progress');
    mounted.render();
    state.settlePlanningConfirmed(first, { name: 'In Progress' });
    mounted.render();
    const again = reserveStatus(state, 'PROD-1', 'In Progress', 'Done');
    assert.equal(mounted.render().planningOriginals.get('PROD-1').status.name, 'To Do', 'the retained original outranks the live prior');
    state.settlePlanningConfirmed(again, { name: 'Done' });
    assert.equal(mounted.render().planningOriginals.get('PROD-1').status.name, 'To Do');
    mounted.unmount();
});

test('a lane re-sort is deferred while any editor is open and runs once, for each key, when the last one closes', async () => {
    const state = await newEditState();
    const { mounted, released } = planningEditsHarness(state);
    mounted.render();
    assert.equal(mounted.result.deferReorder('PROD-1'), false, 'nothing is held: the caller re-sorts now');

    mounted.result.holdEditor('fields', 'PROD-2');
    mounted.result.holdEditor('table', 'PROD-3');
    assert.equal(mounted.result.deferReorder('PROD-1'), true);
    assert.equal(mounted.result.deferReorder('PROD-1'), true, 'a key deferred twice is released once');
    assert.equal(mounted.result.deferReorder('PROD-4'), true);

    mounted.result.holdEditor('fields', '');
    assert.deepEqual(released, [], 'the table editor still holds the order');
    mounted.result.holdEditor('table', '');
    assert.deepEqual(released, ['PROD-1', 'PROD-4']);
    assert.equal(mounted.result.deferReorder('PROD-5'), false);
    mounted.unmount();
});

function subtaskHarness(issueEditState, scope = 'scope-a') {
    const loads = [];
    const mounted = mountBundledHook({
        entry: path.resolve(__dirname, '../frontend/src/issues/useStorySubtasks.js'),
        exportName: 'useStorySubtasks',
        modules: {
            '../api/engApi.js': { fetchStorySubtasks: (_url, options) => { const pending = {}; pending.promise = new Promise((resolve) => { pending.resolve = body => resolve({ ok: true, json: async () => body }); }); loads.push({ options, ...pending }); return pending.promise; } },
            '../api/authRequired.js': { isAuthenticationRequiredError: () => false },
        },
        makeProps: () => ({ backendUrl: 'https://synthetic.invalid', selectedSprint: 3001, issueEditState, getMutationScope: () => scope }),
    });
    mounted.render();
    return { mounted, loads };
}

test('a Subtask lock is released only by a fresh reload of its parent\'s subtask list that carries the field, in the scope it was made in', async () => {
    const state = await newEditState();
    const lockedStatus = (key, scope = 'scope-a') => {
        const token = state.reservePlanningEdit({ issueKey: key, field: 'status', prior: { name: 'To Do' }, optimistic: { name: 'Done' }, scope });
        state.settlePlanningUnconfirmed(token);
        return token;
    };
    const subtask = (key, status = 'To Do') => ({ key, status: { name: status } });
    const { mounted, loads } = subtaskHarness(state);
    lockedStatus('PROD-1-A');
    assert.equal(state.planningPhase('PROD-1-A', 'status'), 'locked');

    // A server-cached list is not evidence.
    mounted.result.retryStorySubtasks({ key: 'PROD-1', fields: {} });
    await flush();
    loads[0].resolve({ summary: null, subtasks: [subtask('PROD-1-A')], cached: true });
    await flush();
    assert.equal(state.planningPhase('PROD-1-A', 'status'), 'locked', 'a cached list leaves the lock in place');

    // A fresh list that does not carry the key is not evidence either.
    mounted.result.retryStorySubtasks({ key: 'PROD-1', fields: {} });
    await flush();
    loads[1].resolve({ summary: null, subtasks: [subtask('PROD-1-B')], cached: false });
    await flush();
    assert.equal(state.planningPhase('PROD-1-A', 'status'), 'locked', 'absence proves nothing');

    // A fresh list that carries the key releases it.
    mounted.result.retryStorySubtasks({ key: 'PROD-1', fields: {} });
    await flush();
    loads[2].resolve({ summary: null, subtasks: [subtask('PROD-1-A', 'Done')], cached: false });
    await flush();
    assert.equal(state.planningPhase('PROD-1-A', 'status'), null, 'a fresh list carrying the field releases the lock');
    mounted.unmount();

    // The same list read in another scope never releases a lock made elsewhere.
    const other = subtaskHarness(state, 'scope-b');
    lockedStatus('PROD-2-A');
    other.mounted.result.retryStorySubtasks({ key: 'PROD-2', fields: {} });
    await flush();
    other.loads[0].resolve({ summary: null, subtasks: [subtask('PROD-2-A')], cached: false });
    await flush();
    assert.equal(state.planningPhase('PROD-2-A', 'status'), 'locked', 'a lock is released only from its own origin scope');
    other.mounted.unmount();
});
