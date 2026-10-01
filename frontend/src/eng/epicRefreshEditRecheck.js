// Pure pieces of the inline-edit alert re-check (issue #213, Task 13b): which epic an edited key belongs to, and the per-epic coalescer
// that serializes every epic-scoped alert re-check. No React, no I/O; time and the alert cohort are injected.

const text = value => String(value ?? '').trim();

// Held lists searched for a key, in order: sprint lists, ready-to-close story copies, Missing Info issues (a sprintless story lives only there).
const SOURCE_ORDER = [
    'productTasks', 'techTasks', 'loadedProductTasks', 'loadedTechTasks',
    'readyToCloseProductTasks', 'readyToCloseTechTasks', 'missingPlanningInfoTasks',
];
const NO_EPIC = 'NO_EPIC';

// Maps edited issue keys to the epics whose alerts must be re-checked. `lists` holds the arrays named in SOURCE_ORDER, `epicDetails` is the
// epic-details map (a key in it is an epic edited itself), `parentStoryKeysFor(keys)` answers the parent story keys of subtask keys.
// Stories without an epic (`NO_EPIC` or empty) and keys no source knows are `unresolved`; the caller falls back for them.
// Keys with an `already_in_status` outcome are excluded by the caller, not here.
export function resolveEditEpicKeys({ keys, lists = {}, epicDetails = {}, parentStoryKeysFor } = {}) {
    const epicKeys = new Set();
    const unresolved = [];
    const storyEpic = new Map();
    for (const name of SOURCE_ORDER) {
        for (const item of lists[name] || []) {
            const key = text(item?.key);
            if (key && !storyEpic.has(key)) storyEpic.set(key, text(item?.fields?.epicKey));
        }
    }
    // The epic key of a key held as a story: '' when the story has no epic; undefined when no source holds the key.
    const epicOf = key => {
        if (storyEpic.has(key)) return storyEpic.get(key);
        return Object.prototype.hasOwnProperty.call(epicDetails || {}, key) ? key : undefined;
    };
    const unique = Array.from(new Set((keys || []).map(text).filter(Boolean)));
    for (const key of unique) {
        let epicKey = epicOf(key);
        if (epicKey === undefined && parentStoryKeysFor) {
            // A subtask resolves through its parent story; the first parent that resolves to an epic wins.
            const parents = (parentStoryKeysFor([key]) || []).map(text).filter(Boolean);
            epicKey = parents.map(epicOf).find(found => found !== undefined && found !== '' && found !== NO_EPIC);
        }
        if (!epicKey || epicKey === NO_EPIC) unresolved.push(key);
        else epicKeys.add(epicKey);
    }
    return { epicKeys: Array.from(epicKeys), unresolved };
}

const CALL_ORDER = ['readyToClose', 'epicAlerts', 'missingInfo', 'backlog', 'readiness'];
const orderCalls = calls => CALL_ORDER.filter(call => calls.has(call)).concat([...calls].filter(call => !CALL_ORDER.includes(call)));

export const EPIC_RECHECK_RETRY_MS = 8000;

// One re-check in flight per epic plus at most one trailing re-check. A request that arrives while one runs merges into the trailing job
// (calls are united with those of the run in flight, the newest `ctx` wins), so two edits on one epic end with the answer to the second. A `rateLimited` outcome waits
// `retryAfterSeconds` (8 s when absent) and retries the `epicAlerts` call once; a request that arrives meanwhile merges in and runs once.
//   run(epicKey, { calls, ctx }) -> Promise<{ rateLimited?, retryAfterSeconds? } | void>
//   isStale(epicKey, ctx) -> boolean   checked right before every run (scope switch, newer alert version): a stale job is dropped
//   cohort: { inFlight(), subscribeSettle(cb: ({ aborted }) => void) -> unsubscribe }   jobs with `awaitCohort` wait for it to settle;
//       a cohort that was aborted restarts and reads post-edit data, so the waiting jobs are dropped
// `request` resolves { ran, dropped?, rateLimited? } when its job's first run ends or the job is dropped. `cancel()` drops every pending
// job and timer (the hook calls it on unmount only; a scope switch is caught by `isStale` when a job starts); the scheduler is reusable afterwards.
export function createEpicRecheckScheduler({
    run, isStale = () => false, cohort = null, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id),
    defaultRetryMs = EPIC_RECHECK_RETRY_MS,
}) {
    const epics = new Map();
    const timers = new Set();
    const cohortWaiters = new Set();
    let generation = 0;

    const settle = (job, result) => { job.waiters.splice(0).forEach(resolve => resolve(result)); };
    const dropJob = (job, reason) => settle(job, { ran: false, dropped: reason });

    const sleep = ms => new Promise(resolve => {
        const entry = { resolve };
        entry.id = setTimer(() => { timers.delete(entry); resolve(true); }, ms);
        timers.add(entry);
    });

    // Resolves true when the cohort settled normally, false when it was aborted or the scheduler was cancelled.
    const waitCohortSettle = () => new Promise(resolve => {
        const waiter = { resolve, off: null };
        waiter.off = cohort.subscribeSettle(info => {
            waiter.off?.();
            cohortWaiters.delete(waiter);
            resolve(info?.aborted !== true);
        });
        cohortWaiters.add(waiter);
    });

    const merge = (job, calls, ctx, awaitCohort) => {
        calls.forEach(call => job.calls.add(call));
        if (ctx !== undefined) job.ctx = ctx;
        job.awaitCohort = job.awaitCohort || awaitCohort;
    };

    async function drain(epicKey, state, gen) {
        try {
            while (state.next && gen === generation) {
                while (state.next?.awaitCohort && cohort?.inFlight()) {
                    const settled = await waitCohortSettle();
                    if (gen !== generation) return;
                    if (!settled) { dropJob(state.next, 'cohort_aborted'); state.next = null; }
                }
                const job = state.next;
                if (!job) break;
                state.next = null;
                let stale = true;
                try { stale = isStale(epicKey, job.ctx) === true; } catch { stale = true; }
                if (stale) { dropJob(job, 'stale'); continue; }
                let outcome;
                state.running = job;
                try { outcome = (await run(epicKey, { calls: orderCalls(job.calls), ctx: job.ctx })) || {}; } catch { outcome = {}; }
                state.running = null;
                if (gen !== generation) { dropJob(job, 'cancelled'); return; }
                settle(job, { ran: true, rateLimited: outcome.rateLimited === true });
                if (outcome.rateLimited === true && !job.retried) {
                    const waitMs = Number.isFinite(outcome.retryAfterSeconds) && outcome.retryAfterSeconds > 0 ? outcome.retryAfterSeconds * 1000 : defaultRetryMs;
                    await sleep(waitMs);
                    if (gen !== generation) return;
                    // A request that arrived during the wait is a fresh job (its own single retry); the retry joins it.
                    if (state.next) merge(state.next, ['epicAlerts'], undefined, job.awaitCohort);
                    else state.next = { calls: new Set(['epicAlerts']), ctx: job.ctx, awaitCohort: job.awaitCohort, retried: true, waiters: [] };
                }
            }
        } finally {
            if (epics.get(epicKey) === state) epics.delete(epicKey);
        }
    }

    return {
        request(epicKey, { calls, ctx, awaitCohort = false } = {}) {
            const wanted = new Set(calls || []);
            if (!wanted.size) return Promise.resolve({ ran: false, dropped: 'no_calls' });
            return new Promise(resolve => {
                let state = epics.get(epicKey);
                if (!state) {
                    state = { next: null, running: null };
                    epics.set(epicKey, state);
                    state.next = { calls: new Set(), ctx, awaitCohort, retried: false, waiters: [] };
                    merge(state.next, wanted, ctx, awaitCohort);
                    state.next.waiters.push(resolve);
                    void drain(epicKey, state, generation);
                    return;
                }
                // The retry job (retried: true) must not swallow a user request into a no-retry job.
                if (!state.next || state.next.retried) {
                    const fresh = { calls: new Set(), ctx, awaitCohort, retried: false, waiters: [] };
                    if (state.next) merge(fresh, state.next.calls, undefined, state.next.awaitCohort);
                    state.next = fresh;
                }
                // The run in flight may have read the server before this edit landed, so its calls run again in the trailing job.
                if (state.running) merge(state.next, state.running.calls, undefined, false);
                merge(state.next, wanted, ctx, awaitCohort);
                state.next.waiters.push(resolve);
            });
        },
        cancel() {
            generation += 1;
            timers.forEach(entry => { clearTimer(entry.id); entry.resolve(false); });
            timers.clear();
            cohortWaiters.forEach(waiter => { waiter.off?.(); waiter.resolve(false); });
            cohortWaiters.clear();
            epics.forEach(state => { if (state.next) dropJob(state.next, 'cancelled'); state.next = null; });
            epics.clear();
        },
        // Test and diagnostics only: true while an epic has a run, a retry wait or a trailing job.
        busy: epicKey => epics.has(epicKey),
    };
}
