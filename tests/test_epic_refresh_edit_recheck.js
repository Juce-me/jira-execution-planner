import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEpicRecheckScheduler, resolveEditEpicKeys } from '../frontend/src/eng/epicRefreshEditRecheck.js';

const story = (key, epicKey) => ({ key, fields: { epicKey } });
const flush = () => new Promise(resolve => setImmediate(resolve));

// ---- resolveEditEpicKeys -------------------------------------------------------------------------------------------------------------

test('resolver: a story resolves through each held source, in order', () => {
    const sources = ['productTasks', 'techTasks', 'loadedProductTasks', 'loadedTechTasks', 'readyToCloseProductTasks', 'readyToCloseTechTasks', 'missingPlanningInfoTasks'];
    sources.forEach((name, index) => {
        const out = resolveEditEpicKeys({ keys: ['S-1'], lists: { [name]: [story('S-1', `EPIC-${index}`)] } });
        assert.deepEqual(out, { epicKeys: [`EPIC-${index}`], unresolved: [] }, name);
    });
});

test('resolver: the first source that holds the key decides', () => {
    const out = resolveEditEpicKeys({ keys: ['S-1'], lists: { productTasks: [story('S-1', 'EPIC-A')], missingPlanningInfoTasks: [story('S-1', 'EPIC-B')] } });
    assert.deepEqual(out.epicKeys, ['EPIC-A']);
});

test('resolver: a sprintless story is found only through the Missing Info issues', () => {
    const out = resolveEditEpicKeys({ keys: ['S-9'], lists: { productTasks: [story('S-1', 'EPIC-1')], missingPlanningInfoTasks: [story('S-9', 'EPIC-2')] } });
    assert.deepEqual(out, { epicKeys: ['EPIC-2'], unresolved: [] });
});

test('resolver: an epic key known in epicDetails resolves to itself', () => {
    const out = resolveEditEpicKeys({ keys: ['EPIC-7'], lists: {}, epicDetails: { 'EPIC-7': { key: 'EPIC-7' } } });
    assert.deepEqual(out, { epicKeys: ['EPIC-7'], unresolved: [] });
});

test('resolver: a subtask resolves through its parent story and the lookup gets only that subtask key', () => {
    const asked = [];
    const parentStoryKeysFor = keys => { asked.push(keys); return keys[0] === 'SUB-1' ? ['S-1'] : []; };
    const out = resolveEditEpicKeys({ keys: ['SUB-1', 'SUB-2'], lists: { productTasks: [story('S-1', 'EPIC-1')] }, parentStoryKeysFor });
    assert.deepEqual(out, { epicKeys: ['EPIC-1'], unresolved: ['SUB-2'] });
    assert.deepEqual(asked, [['SUB-1'], ['SUB-2']]);
});

test('resolver: a subtask whose parent story has no epic or is unknown is unresolved', () => {
    const lists = { productTasks: [story('S-1', 'NO_EPIC'), story('S-2', '')] };
    for (const parent of ['S-1', 'S-2', 'S-404']) {
        const out = resolveEditEpicKeys({ keys: ['SUB-1'], lists, parentStoryKeysFor: () => [parent] });
        assert.deepEqual(out, { epicKeys: [], unresolved: ['SUB-1'] }, parent);
    }
});

test('resolver: NO_EPIC, empty-epic and unknown keys are unresolved', () => {
    const lists = { productTasks: [story('S-1', 'NO_EPIC'), story('S-2', ''), story('S-3', null), story('S-4', 'EPIC-1')] };
    const out = resolveEditEpicKeys({ keys: ['S-1', 'S-2', 'S-3', 'S-4', 'X-1'], lists });
    assert.deepEqual(out, { epicKeys: ['EPIC-1'], unresolved: ['S-1', 'S-2', 'S-3', 'X-1'] });
});

test('resolver: several keys of one epic de-duplicate to one epic, and repeated keys count once', () => {
    const lists = { productTasks: [story('S-1', 'EPIC-1'), story('S-2', 'EPIC-1'), story('S-3', 'EPIC-2')] };
    const out = resolveEditEpicKeys({ keys: ['S-1', 'S-2', 'S-2', 'S-3', 'EPIC-1'], lists, epicDetails: { 'EPIC-1': {} } });
    assert.deepEqual(out, { epicKeys: ['EPIC-1', 'EPIC-2'], unresolved: [] });
});

test('resolver: no keys and missing inputs resolve to nothing', () => {
    assert.deepEqual(resolveEditEpicKeys({ keys: [] }), { epicKeys: [], unresolved: [] });
    assert.deepEqual(resolveEditEpicKeys({}), { epicKeys: [], unresolved: [] });
});

// ---- createEpicRecheckScheduler ----------------------------------------------------------------------------------------------------

function fakeClock() {
    let at = 0;
    let nextId = 1;
    const pending = new Map();
    return {
        setTimer: (fn, ms) => { const id = nextId++; pending.set(id, { fn, due: at + ms }); return id; },
        clearTimer: id => { pending.delete(id); },
        async advance(ms) {
            at += ms;
            await flush();
            for (const [id, timer] of [...pending]) {
                if (timer.due <= at) { pending.delete(id); timer.fn(); await flush(); }
            }
        },
        count: () => pending.size,
    };
}

// A re-check whose server answer is read when it starts and applied when it ends, like `recheckEpicAlerts`.
function harness({ cohort = null, isStale, answers = {} } = {}) {
    const clock = fakeClock();
    const server = { status: 'S0' };
    const applied = [];
    const runs = [];
    const gates = [];
    const scheduler = createEpicRecheckScheduler({
        setTimer: clock.setTimer, clearTimer: clock.clearTimer, cohort, isStale,
        run: async (epicKey, job) => {
            const read = server.status;
            const entry = { epicKey, calls: job.calls, ctx: job.ctx, read, concurrent: runs.filter(run => run.epicKey === epicKey && !run.done).length };
            runs.push(entry);
            const gate = answers[runs.length - 1];
            if (gate?.hold) await new Promise(resolve => gates.push(resolve));
            entry.done = true;
            if (gate?.throws) throw new Error('boom');
            if (!gate?.rateLimited) applied.push({ epicKey, state: read });
            return gate?.rateLimited ? { rateLimited: true, retryAfterSeconds: gate.retryAfterSeconds } : {};
        },
    });
    return { scheduler, clock, server, applied, runs, release: () => gates.shift()?.() };
}

test('scheduler: two edits on one epic end with the state of the second', async () => {
    const h = harness({ answers: { 0: { hold: true } } });
    const first = h.scheduler.request('EPIC-1', { calls: ['readyToClose', 'epicAlerts'], ctx: 1 });
    await flush();
    h.server.status = 'S1';
    const second = h.scheduler.request('EPIC-1', { calls: ['epicAlerts', 'readiness'], ctx: 2 });
    h.server.status = 'S2';
    await h.clock.advance(1000);
    assert.equal(h.runs.length, 1, 'the second request waits for the first');
    h.release();
    await Promise.all([first, second]);
    assert.equal(h.runs.length, 2);
    assert.equal(h.runs[0].read, 'S0');
    assert.equal(h.runs[1].read, 'S2', 'the trailing re-check reads the server after both edits');
    assert.deepEqual(h.runs[1].calls, ['readyToClose', 'epicAlerts', 'readiness']);
    assert.equal(h.runs[1].ctx, 2, 'the newest captured context wins');
    assert.deepEqual(h.applied.at(-1), { epicKey: 'EPIC-1', state: 'S2' });
});

test('scheduler: requests while one is trailing merge into it (at most one in flight plus one trailing)', async () => {
    const h = harness({ answers: { 0: { hold: true } } });
    const requests = [
        h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 }),
        h.scheduler.request('EPIC-1', { calls: ['readyToClose'], ctx: 2 }),
        h.scheduler.request('EPIC-1', { calls: ['readiness'], ctx: 3 }),
        h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 4 }),
    ];
    await flush();
    h.release();
    const results = await Promise.all(requests);
    assert.equal(h.runs.length, 2);
    assert.deepEqual(h.runs[1].calls, ['readyToClose', 'epicAlerts', 'readiness']);
    assert.equal(h.runs[1].ctx, 4);
    assert.ok(results.every(result => result.ran));
    assert.ok(h.runs.every(run => run.concurrent === 0), 'never two runs of one epic at once');
});

test('scheduler: a rate_limited lane is retried once after the window, then given up', async () => {
    const h = harness({ answers: { 0: { rateLimited: true }, 1: { rateLimited: true } } });
    const result = await h.scheduler.request('EPIC-1', { calls: ['readyToClose', 'epicAlerts', 'readiness'], ctx: 1 });
    assert.equal(result.rateLimited, true);
    assert.equal(h.runs.length, 1);
    await h.clock.advance(7999);
    assert.equal(h.runs.length, 1, 'no retry inside the 8 s window');
    await h.clock.advance(1);
    assert.equal(h.runs.length, 2);
    assert.deepEqual(h.runs[1].calls, ['epicAlerts'], 'only the limited call is retried');
    await h.clock.advance(60000);
    assert.equal(h.runs.length, 2, 'a second rate limit is not retried');
    assert.equal(h.scheduler.busy('EPIC-1'), false);
    assert.equal(h.clock.count(), 0);
});

test('scheduler: retryAfterSeconds sets the window when present', async () => {
    const h = harness({ answers: { 0: { rateLimited: true, retryAfterSeconds: 3 } } });
    await h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 });
    await h.clock.advance(2999);
    assert.equal(h.runs.length, 1);
    await h.clock.advance(1);
    assert.equal(h.runs.length, 2);
    assert.deepEqual(h.applied, [{ epicKey: 'EPIC-1', state: 'S0' }]);
});

test('scheduler: a request during the retry window joins the retry and runs once with the newest context', async () => {
    const h = harness({ answers: { 0: { rateLimited: true } } });
    await h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 });
    h.server.status = 'S1';
    const second = h.scheduler.request('EPIC-1', { calls: ['readyToClose'], ctx: 2 });
    await h.clock.advance(8000);
    await second;
    assert.equal(h.runs.length, 2);
    assert.deepEqual(h.runs[1].calls, ['readyToClose', 'epicAlerts']);
    assert.equal(h.runs[1].ctx, 2);
    assert.equal(h.runs[1].read, 'S1');
});

test('scheduler: the refresh follow-up and an edit re-check of the same epic serialize; another epic is independent', async () => {
    const h = harness({ answers: { 0: { hold: true } } });
    const followUp = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: { source: 'refresh' } });
    await flush();
    const edit = h.scheduler.request('EPIC-1', { calls: ['readyToClose', 'epicAlerts', 'readiness'], ctx: { source: 'edit' } });
    const other = h.scheduler.request('EPIC-2', { calls: ['epicAlerts'], ctx: { source: 'edit' } });
    await other;
    assert.equal(h.runs.length, 2, 'EPIC-2 runs while EPIC-1 is held');
    assert.equal(h.runs[1].epicKey, 'EPIC-2');
    h.server.status = 'S1';
    h.release();
    await Promise.all([followUp, edit]);
    assert.deepEqual(h.runs.filter(run => run.epicKey === 'EPIC-1').map(run => run.ctx.source), ['refresh', 'edit']);
    assert.equal(h.runs[2].read, 'S1', 'the edit re-check starts after the follow-up ended');
    assert.ok(h.runs.every(run => run.concurrent === 0));
});

test('scheduler: an error in one epic re-check does not stop another epic or the same epic trailing job', async () => {
    const h = harness({ answers: { 0: { throws: true } } });
    const a = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 });
    const b = h.scheduler.request('EPIC-2', { calls: ['epicAlerts'], ctx: 1 });
    const c = h.scheduler.request('EPIC-1', { calls: ['readiness'], ctx: 2 });
    await Promise.all([a, b, c]);
    assert.deepEqual(h.applied.map(entry => entry.epicKey).sort(), ['EPIC-1', 'EPIC-2']);
    assert.equal(h.runs.length, 3);
    assert.equal(h.scheduler.busy('EPIC-1') || h.scheduler.busy('EPIC-2'), false);
});

test('scheduler: a stale job is dropped without a run', async () => {
    const h = harness({ isStale: (epicKey, ctx) => ctx.version !== 2 });
    assert.deepEqual(await h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: { version: 1 } }), { ran: false, dropped: 'stale' });
    assert.equal(h.runs.length, 0);
    assert.equal((await h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: { version: 2 } })).ran, true);
});

test('scheduler: cancel (scope switch, unmount) drops the trailing job and the retry wait', async () => {
    const h = harness({ answers: { 0: { hold: true } } });
    const first = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 });
    await flush();
    const trailing = h.scheduler.request('EPIC-1', { calls: ['readiness'], ctx: 2 });
    h.scheduler.cancel();
    assert.deepEqual(await trailing, { ran: false, dropped: 'cancelled' });
    h.release();
    assert.equal((await first).ran, false);
    await flush();
    assert.equal(h.runs.length, 1, 'the trailing job never ran');

    const limited = harness({ answers: { 0: { rateLimited: true } } });
    await limited.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 });
    assert.equal(limited.clock.count(), 1);
    limited.scheduler.cancel();
    assert.equal(limited.clock.count(), 0, 'the retry timer is cleared');
    await limited.clock.advance(60000);
    assert.equal(limited.runs.length, 1);
});

test('scheduler: the scheduler is usable after a cancel', async () => {
    const h = harness({ answers: { 0: { hold: true } } });
    void h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1 });
    await flush();
    h.scheduler.cancel();
    const again = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 2 });
    h.release();
    assert.equal((await again).ran, true);
    assert.equal(h.runs.at(-1).ctx, 2);
});

// ---- alert cohort deferral -----------------------------------------------------------------------------------------------------

function fakeCohort() {
    const listeners = new Set();
    const cohort = {
        active: false,
        inFlight: () => cohort.active,
        subscribeSettle: cb => { listeners.add(cb); return () => listeners.delete(cb); },
        settle(info = { aborted: false }) { cohort.active = false; [...listeners].forEach(cb => cb(info)); },
        listeners: () => listeners.size,
    };
    return cohort;
}

test('cohort deferral: the re-check runs after the held cohort result, so the final state equals the post-edit state', async () => {
    const cohort = fakeCohort();
    cohort.active = true;
    const order = [];
    const h = harness({ cohort });
    // The cohort holds a pre-edit answer and lands when released; the re-check reads the server when it starts.
    const cohortAnswer = h.server.status;
    h.server.status = 'POST_EDIT';
    const edit = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1, awaitCohort: true });
    await flush();
    assert.equal(h.runs.length, 0, 'nothing runs while the cohort is in flight');
    assert.equal(cohort.listeners(), 1);
    order.push(`cohort:${cohortAnswer}`);
    cohort.settle();
    await edit;
    order.push(`recheck:${h.runs[0].read}`);
    assert.deepEqual(order, ['cohort:S0', 'recheck:POST_EDIT']);
    assert.deepEqual(h.applied.at(-1), { epicKey: 'EPIC-1', state: 'POST_EDIT' });
    assert.equal(cohort.listeners(), 0, 'the settle listener is released');
});

test('cohort deferral: an aborted cohort restarts with post-edit data, so the pending re-check is dropped', async () => {
    const cohort = fakeCohort();
    cohort.active = true;
    const h = harness({ cohort });
    const edit = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1, awaitCohort: true });
    const merged = h.scheduler.request('EPIC-1', { calls: ['readiness'], ctx: 2, awaitCohort: true });
    await flush();
    cohort.settle({ aborted: true });
    assert.deepEqual(await edit, { ran: false, dropped: 'cohort_aborted' });
    assert.deepEqual(await merged, { ran: false, dropped: 'cohort_aborted' });
    assert.equal(h.runs.length, 0);
    assert.equal(h.scheduler.busy('EPIC-1'), false);
});

test('cohort deferral: a cohort that restarts right after settling is waited for again', async () => {
    const cohort = fakeCohort();
    cohort.active = true;
    const h = harness({ cohort });
    const edit = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1, awaitCohort: true });
    await flush();
    cohort.listeners();
    cohort.active = false;
    const listenersBefore = cohort.listeners();
    cohort.active = true; // a second cohort already started when the first one settles
    cohort.settle({ aborted: false });
    cohort.active = true;
    await flush();
    assert.equal(listenersBefore, 1);
    assert.equal(h.runs.length, 0, 'still deferred behind the second cohort');
    cohort.settle();
    await edit;
    assert.equal(h.runs.length, 1);
});

test('cohort deferral: edits queued behind a cohort merge into one re-check; a request without awaitCohort is not deferred when no cohort runs', async () => {
    const cohort = fakeCohort();
    cohort.active = true;
    const h = harness({ cohort });
    const first = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1, awaitCohort: true });
    const second = h.scheduler.request('EPIC-1', { calls: ['readyToClose'], ctx: 2, awaitCohort: true });
    await flush();
    cohort.settle();
    await Promise.all([first, second]);
    assert.equal(h.runs.length, 1);
    assert.deepEqual(h.runs[0].calls, ['readyToClose', 'epicAlerts']);
    assert.equal(h.runs[0].ctx, 2);

    const noWait = harness({ cohort: (() => { const c = fakeCohort(); c.active = true; return c; })() });
    const result = await noWait.scheduler.request('EPIC-9', { calls: ['epicAlerts'], ctx: 1 });
    assert.equal(result.ran, true, 'the refresh follow-up is not deferred');
});

test('cohort deferral: cancel while waiting for the cohort drops the job and releases the listener', async () => {
    const cohort = fakeCohort();
    cohort.active = true;
    const h = harness({ cohort });
    const edit = h.scheduler.request('EPIC-1', { calls: ['epicAlerts'], ctx: 1, awaitCohort: true });
    await flush();
    h.scheduler.cancel();
    assert.deepEqual(await edit, { ran: false, dropped: 'cancelled' });
    assert.equal(cohort.listeners(), 0);
    cohort.settle();
    await flush();
    assert.equal(h.runs.length, 0);
});

// ---- useEpicRefresh().recheckAlertsForEdit (the hook bundled for node, rendered once on the server) ----------------------------------

const require = createRequire(import.meta.url);
const hookEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src', 'eng', 'useEpicRefresh.js');

async function loadHook() {
    const esbuild = require('esbuild');
    const result = await esbuild.build({
        entryPoints: [hookEntry],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        external: ['react', 'react-dom'],
        loader: { '.jsx': 'jsx', '.js': 'jsx' },
        plugins: [{
            name: 'stub-issue-card',
            setup(build) {
                build.onResolve({ filter: /IssueCard\.jsx$/ }, () => ({ path: 'issue-card-stub', namespace: 'stub' }));
                build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const REMOVE_FADE_MS = 240;', loader: 'js' }));
            },
        }],
    });
    const mod = new Module(hookEntry);
    mod.paths = Module._nodeModulePaths(path.dirname(hookEntry));
    mod._compile(result.outputFiles[0].text, hookEntry);
    return mod.exports.useEpicRefresh;
}
const useEpicRefresh = await loadHook();

function renderHook(overrides = {}) {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const calls = [];
    const world = { version: 5, scope: 'g|1', sourceSurface: 'catch_up', cohortActive: false };
    const listeners = new Set();
    const state = {
        productTasks: [story('S-1', 'EPIC-1'), story('S-2', 'EPIC-1'), story('S-3', 'EPIC-2'), story('S-4', 'NO_EPIC')],
        techTasks: [], loadedProductTasks: [], loadedTechTasks: [], readyToCloseProductTasks: [], readyToCloseTechTasks: [],
        missingPlanningInfoTasks: [story('S-9', 'EPIC-3')], epicDetails: { 'EPIC-1': {}, 'EPIC-2': {}, 'EPIC-3': {}, 'EPIC-4': {} },
    };
    const lanesFor = overrides.lanesFor || (() => ({}));
    const inputs = {
        getState: () => state,
        setters: new Proxy({}, { get: () => updater => updater }),
        readGuards: () => ({ blocked: false, epoch: 1, version: 1, scopeKey: world.scope }),
        getAlertVersion: () => world.version,
        getProtectedKeys: () => new Set(),
        loadEpicAlerts: async ({ epicKey, calls: asked }) => { calls.push({ epicKey, calls: asked, version: world.version }); return lanesFor(epicKey, calls.length); },
        loadEpicReadiness: async () => null,
        mergeReadinessEpic: () => {},
        loadEpicRefresh: async () => ({}),
        track: () => {},
        isFutureSprint: false,
        get sourceSurface() { return world.sourceSurface; },
        getSubtaskParentStoryKeys: keys => (keys[0] === 'SUB-1' ? ['S-3'] : []),
        alertCohortInFlight: () => world.cohortActive,
        subscribeAlertCohortSettle: cb => { listeners.add(cb); return () => listeners.delete(cb); },
        ...overrides.inputs,
    };
    const holder = {};
    const Probe = () => { holder.api = useEpicRefresh(inputs); return null; };
    renderToStaticMarkup(React.createElement(Probe));
    return {
        api: holder.api, calls, world,
        settleCohort: info => { world.cohortActive = false; [...listeners].forEach(cb => cb(info)); },
        listeners: () => listeners.size,
    };
}

test('hook: a Catch Up status edit re-checks each resolved epic once with the status calls', async () => {
    const h = renderHook();
    const result = h.api.recheckAlertsForEdit({ keys: ['S-1', 'S-2', 'S-3', 'EPIC-4', 'SUB-1'], field: 'status' });
    assert.deepEqual(result, { handled: true, unresolved: [] });
    await flush();
    assert.deepEqual(h.calls.map(call => call.epicKey).sort(), ['EPIC-1', 'EPIC-2', 'EPIC-4']);
    assert.ok(h.calls.every(call => JSON.stringify(call.calls) === JSON.stringify(['readyToClose', 'epicAlerts'])), 'readiness goes through the readiness loader, not the lane loader');
});

test('hook: a future sprint adds the Backlog call', async () => {
    const h = renderHook({ inputs: { isFutureSprint: true } });
    h.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    await flush();
    assert.deepEqual(h.calls[0].calls, ['readyToClose', 'epicAlerts', 'backlog']);
});

test('hook: a priority edit in Catch Up is handled and issues no request', async () => {
    const h = renderHook();
    assert.deepEqual(h.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'priority' }), { handled: true, unresolved: [] });
    await flush();
    assert.equal(h.calls.length, 0);
});

test('hook: outside Catch Up, with an unknown field or without keys nothing is scheduled and the caller falls back', async () => {
    const planning = renderHook();
    planning.world.sourceSurface = 'planning';
    assert.deepEqual(planning.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' }), { handled: false, unresolved: [] });
    assert.deepEqual(planning.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'priority' }), { handled: false, unresolved: [] });
    const h = renderHook();
    assert.deepEqual(h.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'assignee' }), { handled: false, unresolved: [] });
    assert.deepEqual(h.api.recheckAlertsForEdit({ keys: [], field: 'status' }), { handled: false, unresolved: [] });
    assert.deepEqual(h.api.recheckAlertsForEdit({ field: 'status' }), { handled: false, unresolved: [] });
    await flush();
    assert.equal(planning.calls.length + h.calls.length, 0);
});

test('hook: an unresolved key schedules nothing and is reported for the department fallback', async () => {
    const h = renderHook();
    assert.deepEqual(h.api.recheckAlertsForEdit({ keys: ['S-1', 'S-4', 'X-404'], field: 'status' }), { handled: false, unresolved: ['S-4', 'X-404'] });
    await flush();
    assert.equal(h.calls.length, 0, 'the fallback reload makes a partial scoped re-check redundant');
});

test('hook: with a cohort in flight the re-check waits, then runs after the cohort result', async () => {
    const h = renderHook();
    h.world.cohortActive = true;
    h.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    await flush();
    assert.equal(h.calls.length, 0);
    assert.equal(h.listeners(), 1);
    h.settleCohort({ aborted: false });
    await flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.listeners(), 0);
});

test('hook: an aborted cohort drops the pending re-check', async () => {
    const h = renderHook();
    h.world.cohortActive = true;
    h.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    await flush();
    h.settleCohort({ aborted: true });
    await flush();
    assert.equal(h.calls.length, 0);
});

test('hook: a re-armed cohort (alert version bumped) or a scope switch before the job starts drops it', async () => {
    const bumped = renderHook();
    bumped.world.cohortActive = true;
    bumped.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    bumped.world.version += 1;
    bumped.settleCohort({ aborted: false });
    await flush();
    assert.equal(bumped.calls.length, 0);

    const switched = renderHook();
    switched.world.cohortActive = true;
    switched.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    switched.world.scope = 'other|2';
    switched.settleCohort({ aborted: false });
    await flush();
    assert.equal(switched.calls.length, 0);
});

test('hook: edits on one epic run in turn, never concurrently, and queued edits merge into one trailing re-check', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let active = 0;
    let peak = 0;
    const seen = [];
    const slow = renderHook({ inputs: { loadEpicAlerts: async ({ epicKey }) => {
        active += 1;
        peak = Math.max(peak, active);
        seen.push(epicKey);
        if (seen.length === 1) await gate;
        active -= 1;
        return {};
    } } });
    slow.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    await flush();
    slow.api.recheckAlertsForEdit({ keys: ['S-2'], field: 'status' });
    slow.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    await flush();
    assert.equal(seen.length, 1);
    release();
    await flush();
    await flush();
    assert.equal(seen.length, 2);
    assert.equal(peak, 1);
});

test('hook: a rate_limited epic alert object is retried once after the window, and the retry asks only for it', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const limited = { product: { epicAlerts: { status: 'rate_limited' } }, tech: { epicAlerts: { status: 'rate_limited' } } };
    const h = renderHook({ lanesFor: () => limited });
    h.api.recheckAlertsForEdit({ keys: ['S-1'], field: 'status' });
    await flush();
    assert.equal(h.calls.length, 1);
    t.mock.timers.tick(7999);
    await flush();
    assert.equal(h.calls.length, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[1].calls, ['epicAlerts']);
    t.mock.timers.tick(60000);
    await flush();
    assert.equal(h.calls.length, 2, 'given up after one retry');
});

test('hook source: the refresh follow-up and the edit re-check share the one per-epic scheduler', () => {
    const source = readFileSync(hookEntry, 'utf8');
    assert.equal((source.match(/createEpicRecheckScheduler\(/g) || []).length, 1, 'one per-epic in-flight map');
    assert.equal((source.match(/schedulerRef\.current\.request\(/g) || []).length, 2, 'the follow-up and the edit re-check both request through it');
    assert.equal(/void recheckEpicAlerts\(/.test(source), false, 'no unscheduled fire-and-forget re-check');
    assert.equal((source.match(/[^.]recheckEpicAlerts\(/g) || []).length, 1, 'recheckEpicAlerts is called only by the scheduler run');
});
