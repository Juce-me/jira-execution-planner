import test from 'node:test';
import assert from 'node:assert/strict';
import { EPIC_REFRESH, EPIC_REFRESH_RESULT, createEpicRefreshController } from '../frontend/src/eng/epicRefreshController.js';

const story = (key, fields = {}) => ({ key, fields: { summary: key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Story' }, epicKey: 'EPIC-1', customfield_10004: 1, updated: '1', ...fields } });
const okLane = (items, meta = {}) => ({ status: 'ok', items, meta: { epics: {}, capped: false, epicKeysMissing: [], ...meta } });

function harness(overrides = {}) {
    const state = { epoch: 1, version: 1, scopeKey: 'g|1', blocked: false };
    const held = {
        productTasks: [story('S-1')], techTasks: [], loadedProductTasks: [story('S-1')], loadedTechTasks: [],
        epicDetails: { 'EPIC-1': { key: 'EPIC-1', summary: 'E', status: 'In Progress', updated: '1' } },
        protectedKeys: new Set(), snapshotByKey: new Map(), userRemovedKeys: () => new Set(),
    };
    const calls = { states: [], applied: [], announced: [], tracked: [], order: [] };
    let clock = 1000;
    const controller = createEpicRefreshController({
        loadEpicRefresh: overrides.loadEpicRefresh || (async () => ({
            product: okLane([story('S-1', { status: { name: 'Done' } })]), tech: okLane([]),
        })),
        readGuards: () => ({ ...state }),
        readHeld: () => held,
        apply: overrides.apply ? update => overrides.apply(update, calls) : (async update => { calls.applied.push(update); calls.order.push('apply'); return { hiddenCount: 0 }; }),
        setEpicState: (key, value) => calls.states.push([key, value]),
        announce: outcome => { calls.announced.push(outcome); calls.order.push('announce'); },
        track: outcome => { calls.tracked.push(outcome); calls.order.push('track'); },
        now: () => clock,
        sleep: async ms => { clock += ms; },
    });
    return { controller, state, held, calls, tick: ms => { clock += ms; }, clockNow: () => clock };
}

test('blocked guard means no load and no state change', async () => {
    let loads = 0;
    const h = harness({ loadEpicRefresh: async () => { loads += 1; return { product: okLane([]), tech: okLane([]) }; } });
    h.state.blocked = true;
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.BLOCKED);
    assert.equal(loads, 0);
    assert.equal(h.calls.states.length, 0);
});

test('a changed story is applied once, announced and tracked', async () => {
    const h = harness();
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.CHANGED);
    assert.equal(h.calls.applied.length, 1);
    assert.deepEqual(h.calls.applied[0].changedKeys, ['S-1']);
    assert.deepEqual(h.calls.applied[0].changedFieldsByKey['S-1'], ['status']);
    assert.ok(h.calls.applied[0].mergeInputs.length >= 2);
    assert.deepEqual(h.calls.states.map(s => s[1]), ['busy', 'idle']);
    assert.equal(h.calls.announced.length, 1);
    assert.equal(h.calls.tracked.length, 1);
});

test('apply is awaited before the outcome is announced', async () => {
    const h = harness({ apply: async (update, calls) => { await new Promise(resolve => setTimeout(resolve, 5)); calls.order.push('apply-done'); return { hiddenCount: 0 }; } });
    await h.controller.refresh('EPIC-1');
    assert.deepEqual(h.calls.order, ['apply-done', 'announce', 'track']);
});

test('an unchanged epic applies nothing and reports unchanged', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: okLane([story('S-1')]), tech: okLane([]) }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.UNCHANGED);
    assert.equal(h.calls.applied.length, 0);
});

test('the busy mark shows at least the minimum time even when the response is instant', async () => {
    const h = harness();
    const start = h.clockNow();
    await h.controller.refresh('EPIC-1');
    assert.ok(EPIC_REFRESH.MIN_BUSY_MS >= 400);
    assert.ok(h.clockNow() - start >= EPIC_REFRESH.MIN_BUSY_MS);
});

test('an epoch change while fetching discards the result silently', async () => {
    const h = harness();
    const pending = h.controller.refresh('EPIC-1');
    h.state.epoch += 1;
    const out = await pending;
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.applied.length, 0);
    assert.equal(h.calls.announced.length, 0);
    assert.equal(h.calls.tracked.length, 0);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('a 401 lane discards the result and shows no error UI (the sign-in lock owns it)', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: { status: 'auth_required' }, tech: okLane([]) }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.announced.length, 0);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('all lanes ignored (strict Board active) is a discard, not "up to date"', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: { status: 'ignored' }, tech: { status: 'ignored' } }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.announced.length, 0);
});

test('a denied lane is left untouched and raises no error', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: okLane([story('S-1', { status: { name: 'Done' } })]), tech: { status: 'denied' } }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.CHANGED);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('a failed lane applies the good lane and leaves the epic in the error state', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: okLane([story('S-1', { status: { name: 'Done' } })]), tech: { status: 'failed' } }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.FAILURE);
    assert.equal(out.partial, true);
    assert.equal(h.calls.applied.length, 1);
    assert.equal(h.calls.states.at(-1)[1], 'error');
});

test('rate-limited lanes and a thrown load are failures with nothing applied, and retry is not blocked', async () => {
    for (const load of [async () => ({ product: { status: 'rate_limited' }, tech: { status: 'rate_limited' } }), async () => { throw new Error('boom'); }]) {
        const h = harness({ loadEpicRefresh: load });
        const out = await h.controller.refresh('EPIC-1');
        assert.equal(out.result, EPIC_REFRESH_RESULT.FAILURE);
        assert.equal(h.calls.applied.length, 0);
        assert.equal(h.calls.states.at(-1)[1], 'error');
        assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    }
});

test('a capped lane never removes cards; an uncapped lane does', async () => {
    const make = capped => harness({ loadEpicRefresh: async () => ({ product: okLane([], { capped }), tech: okLane([]) }) });
    const cappedOut = await make(true).controller.refresh('EPIC-1');
    assert.equal(cappedOut.removedKeys.length, 0);
    const openOut = await make(false).controller.refresh('EPIC-1');
    assert.deepEqual(openOut.removedKeys, ['S-1']);
});

test('an epic header edited since the click, or protected, is not overwritten by fetched data', async () => {
    const fetchedEpic = { key: 'EPIC-1', summary: 'E', status: 'Done', updated: '2' };
    const load = async () => ({ product: okLane([story('S-1')], { epics: { 'EPIC-1': fetchedEpic } }), tech: okLane([]) });
    const edited = harness({ loadEpicRefresh: load });
    const pending = edited.controller.refresh('EPIC-1');
    edited.held.epicDetails = { 'EPIC-1': { ...edited.held.epicDetails['EPIC-1'], status: 'Accepted' } };
    assert.equal((await pending).epicDetailsPatch, null);
    const protectedEpic = harness({ loadEpicRefresh: load });
    protectedEpic.held.protectedKeys = new Set(['EPIC-1']);
    assert.equal((await protectedEpic.controller.refresh('EPIC-1')).epicDetailsPatch, null);
    const plain = harness({ loadEpicRefresh: load });
    const out = await plain.controller.refresh('EPIC-1');
    assert.deepEqual(out.epicDetailsPatch, { 'EPIC-1': fetchedEpic });
    assert.equal(out.epicChanged, true);
});

test('second click while in flight and the third epic at two in flight are blocked; cooldown applies after success', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ loadEpicRefresh: async () => { await gate; return { product: okLane([story('S-1')]), tech: okLane([]) }; } });
    const first = h.controller.refresh('EPIC-1');
    assert.equal((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    const second = h.controller.refresh('EPIC-2');
    assert.equal((await h.controller.refresh('EPIC-3')).result, EPIC_REFRESH_RESULT.BLOCKED);
    release();
    await Promise.all([first, second]);
    assert.equal((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    h.tick(EPIC_REFRESH.COOLDOWN_MS + 1);
    assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
});

test('the cooldown is per scope, so a sprint or group change does not inherit it', async () => {
    const h = harness();
    await h.controller.refresh('EPIC-1');
    h.state.scopeKey = 'g|2';
    assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
});

test('hidden changes are reported when the apply callback says no changed card is visible', async () => {
    const h = harness({ apply: async () => ({ hiddenCount: 1 }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.HIDDEN);
});

// Loader (useEngSprintData.loadEpicRefresh): a plain function, so it runs here against a fake fetch.
async function runLoader(respond, { strictBoardActive = false } = {}) {
    const { useEngSprintData } = await import('../frontend/src/eng/useEngSprintData.js');
    const realFetch = globalThis.fetch;
    const realLog = console.log;
    const realError = console.error;
    const probe = { started: [], finished: [], connectionFailures: 0, writes: [] };
    const forbidden = name => () => { probe.writes.push(name); };
    globalThis.fetch = async url => respond(new URL(String(url), 'http://x').searchParams.get('project'));
    console.log = () => {};
    console.error = () => {};
    try {
        const api = useEngSprintData({
            backendUrl: 'http://x', selectedSprint: '7', selectedSprintName: 'S', activeGroupId: 'g',
            activeGroupTeamIds: ['t1'], activeGroupTeamSet: new Set(['t1']), activeGroupTeamLabels: {},
            pageLoadRefreshRef: { current: false }, registerSprintFetch: () => new AbortController(), cleanupSprintFetch() {},
            setLoading: forbidden('setLoading'), setError: forbidden('setError'), setEpicDetails: forbidden('setEpicDetails'),
            setProductTasksLoading: forbidden('setProductTasksLoading'), setTechTasksLoading: forbidden('setTechTasksLoading'),
            onServerConnectionFailure: () => { probe.connectionFailures += 1; return true; },
            strictBoardActive,
            issueEditState: {
                beginRead: () => { const token = { id: probe.started.length }; probe.started.push(token); return token; },
                finishRead: token => { if (token) probe.finished.push(token); },
                reconcileIssues: issues => issues,
                capturePlanningBases: () => {}, notePlanningRawRead: () => {}, overlayPlanningIssues: issues => issues,
            },
        });
        probe.lanes = await api.loadEpicRefresh({ epicKey: 'EPIC-1', shouldApplyResult: () => true });
    } finally {
        globalThis.fetch = realFetch;
        console.log = realLog;
        console.error = realError;
    }
    return probe;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('loader returns lane statuses and meta, and finishes every read token', async () => {
    const probe = await runLoader(project => (project === 'tech'
        ? json({ error: 'missing_project_access' }, 403)
        : json({ issues: [story('S-1', { team: { id: 't1' } })], epics: { 'EPIC-1': { summary: 'E' } }, capped: true, epicKeysMissing: ['EPIC-1'] })));
    assert.equal(probe.lanes.product.status, 'ok');
    assert.deepEqual(probe.lanes.product.meta, { epics: { 'EPIC-1': { summary: 'E', key: 'EPIC-1' } }, capped: true, epicKeysMissing: ['EPIC-1'] });
    assert.equal(probe.lanes.tech.status, 'denied');
    assert.equal(probe.started.length, 2);
    assert.deepEqual(new Set(probe.finished), new Set(probe.started));
    assert.deepEqual(probe.writes, []);
    assert.equal(probe.connectionFailures, 0);
});

test('an HTTP error response never reaches the global connection-failure handler', async () => {
    const probe = await runLoader(project => (project === 'tech'
        ? json({ error: 'epic_refresh_rate_limited', retryAfterSeconds: 5 }, 429)
        : json({ error: 'Failed to fetch issues' }, 500)));
    assert.equal(probe.lanes.product.status, 'failed');
    assert.equal(probe.lanes.tech.status, 'rate_limited');
    assert.equal(probe.connectionFailures, 0);
    assert.deepEqual(probe.writes, []);
    assert.deepEqual(new Set(probe.finished), new Set(probe.started));
});

test('HTTP 403, 429 and 500 responses never reach the handler, but a status-less network failure still does', async () => {
    for (const status of [403, 429, 500]) {
        const probe = await runLoader(() => json({ error: 'some_error' }, status));
        assert.equal(probe.connectionFailures, 0, `HTTP ${status} must not call onServerConnectionFailure`);
        assert.notEqual(probe.lanes.product.status, 'ok');
    }
    const outage = await runLoader(() => { throw new TypeError('Failed to fetch'); });
    assert.equal(outage.connectionFailures, 2, 'each lane reports the real network outage');
    assert.equal(outage.lanes.product.status, 'failed');
    assert.equal(outage.lanes.tech.status, 'failed');
    assert.deepEqual(new Set(outage.finished), new Set(outage.started));
});

test('a strict Board session makes no request and reports both lanes ignored', async () => {
    const probe = await runLoader(() => { throw new Error('no request expected'); }, { strictBoardActive: true });
    assert.deepEqual(probe.lanes, { product: { status: 'ignored' }, tech: { status: 'ignored' } });
    assert.equal(probe.started.length, 0);
});
