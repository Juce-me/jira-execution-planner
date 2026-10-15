const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'shareView', 'applyMachine.js');

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', source)(module, module.exports);
    return module.exports;
}

const {
    APPLY_OVERALL_BUDGET_MS, APPLY_SETTLE_FALLBACK_MS, APPLY_STAGE_BUDGET_MS,
    createApplyMachine, stepApplyMachine,
} = loadModule();

test('the machine is pure: it imports nothing and reads no clock, timer, ref, DOM or random source', () => {
    const code = esbuild.transformSync(fs.readFileSync(MODULE_PATH, 'utf8'), { loader: 'js' }).code;
    assert.doesNotMatch(code, /\b(?:import|require|Date|performance|setTimeout|setInterval|requestAnimationFrame|document|window|Math\.random)\b/);
});

const FULL_PLAN = { c: { teams: true, facets: true }, d: true };
const READY_GATE = {
    configSettled: true, groupsLoading: false, groupsFailed: false, onboardingRequired: false,
    adminGate: 'clear', catalog: 'validated', capsulesPending: false, homeTokenReady: true,
};

// Nested groups merge one level deep so a test names only the fields it changes.
function makeInput(over = {}) {
    const base = {
        now: 0, commit: 1, paused: false, authLocked: false, reviewBusy: false, interrupt: null, reported: [],
        gate: READY_GATE, resolution: { ok: true, plan: FULL_PLAN }, scope: { equal: false },
        b: { groupApplied: true, planningHydrated: true, restoring: false, scopePending: false },
        c: { epoch: 0, lanesLoading: false, tasksFetched: false, lastLoadedMatches: false, teamsHydrated: false, expected: true },
        d: { cohortSettled: false, recoveryIdle: true, visible: true },
        focusResult: null,
    };
    const merged = { ...base, ...over };
    for (const key of ['gate', 'scope', 'b', 'c', 'd']) merged[key] = { ...base[key], ...(over[key] || {}) };
    return merged;
}

function simulate() {
    let state = createApplyMachine();
    let now = 0;
    return {
        get state() { return state; },
        step(over = {}, advance = 0) {
            now += advance;
            const out = stepApplyMachine(state, makeInput({ now, ...over }));
            state = out.state;
            return out.actions;
        },
    };
}

const LOADED = { epoch: 1, tasksFetched: true, lastLoadedMatches: true, teamsHydrated: true, expected: true };

// Drives a scope-changing link through A and B (and the commit that releases the hold).
function throughB(sim, { plan = FULL_PLAN, commitAtA = 1 } = {}) {
    assert.deepEqual(sim.step({ commit: commitAtA, resolution: { ok: true, plan } }), [{ type: 'run', stage: 'A', scopeChange: true }]);
    assert.deepEqual(sim.step({ commit: commitAtA + 1, scope: { equal: true } }), [{ type: 'run', stage: 'B' }]);
    assert.deepEqual(sim.step({ commit: commitAtA + 2, scope: { equal: true } }), [{ type: 'releaseHold' }]);
}

test('nothing is timed or applied before the shared config settles', () => {
    const sim = simulate();
    for (let tick = 0; tick < 5; tick += 1) assert.deepEqual(sim.step({ gate: { configSettled: false } }, 60000), []);
    assert.equal(sim.state.startActive, null);
    assert.deepEqual(sim.step({}, 1), [{ type: 'run', stage: 'A', scopeChange: true }]);
});

test('a missing readiness input keeps the link waiting', () => {
    for (const blocker of [
        { groupsLoading: true }, { onboardingRequired: true }, { adminGate: 'pending' },
        { catalog: 'pending' }, { capsulesPending: true }, { homeTokenReady: false },
    ]) {
        const sim = simulate();
        assert.deepEqual(sim.step({ gate: blocker }), [], JSON.stringify(blocker));
        assert.deepEqual(sim.step({ gate: blocker }, 1000), [], JSON.stringify(blocker));
        assert.deepEqual(sim.step({}, 1000), [{ type: 'run', stage: 'A', scopeChange: true }], JSON.stringify(blocker));
    }
});

test('fast drops end the link immediately and name only what was already reported', () => {
    for (const gate of [{ groupsFailed: true }, { adminGate: 'missing' }, { catalog: 'failed' }]) {
        const sim = simulate();
        assert.deepEqual(
            sim.step({ gate, reported: ['teams'] }),
            [{ type: 'finish', result: 'dropped', categories: ['teams'] }],
            JSON.stringify(gate),
        );
        assert.deepEqual(sim.step({}), [], 'a finished machine issues nothing');
    }
});

test('an unresolved group or Sprint drops the link with the resolver categories', () => {
    const sim = simulate();
    assert.deepEqual(
        sim.step({ resolution: { ok: false, categories: ['sprint'] }, reported: ['mode'] }),
        [{ type: 'finish', result: 'dropped', categories: ['sprint', 'mode'] }],
    );
});

test('the link waits while the resolution is not available yet', () => {
    const sim = simulate();
    assert.deepEqual(sim.step({ resolution: null }), []);
    assert.deepEqual(sim.step({}), [{ type: 'run', stage: 'A', scopeChange: true }]);
});

test('a terminal auth lock drops the link at any stage and never reports a notice category', () => {
    const early = simulate();
    assert.deepEqual(early.step({ authLocked: true }), [{ type: 'finish', result: 'dropped', categories: [] }]);
    const late = simulate();
    throughB(late);
    assert.deepEqual(late.step({ authLocked: true }), [{ type: 'finish', result: 'dropped', categories: [] }]);
});

test('a dirty, saving or pending-scope Planning review cancels the link without a notice', () => {
    const before = simulate();
    assert.deepEqual(before.step({ reviewBusy: true }), [{ type: 'finish', result: 'cancelled', categories: [] }]);
    const during = simulate();
    throughB(during);
    assert.deepEqual(during.step({ reviewBusy: true, commit: 9 }), [{ type: 'finish', result: 'cancelled', categories: [] }]);
});

test('Stage A runs once and records whether the scope changes', () => {
    const changing = simulate();
    assert.deepEqual(changing.step(), [{ type: 'run', stage: 'A', scopeChange: true }]);
    assert.equal(changing.state.ran.A, true);
    const same = simulate();
    assert.deepEqual(same.step({ scope: { equal: true } }), [{ type: 'run', stage: 'A', scopeChange: false }]);
    assert.deepEqual(same.step({ scope: { equal: true }, b: { restoring: true } }), [], 'B waits; A is not repeated');
});

test('Stage A must run within its budget of the gate first opening, or the link is dropped', () => {
    const sim = simulate();
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }), []);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, 60000), []);
    assert.equal(sim.state.armedActive, null, 'the window opens with the gate, not with the config');
    assert.deepEqual(sim.step({ resolution: null }), [], 'gate open, resolution not yet available');
    assert.equal(sim.state.armedActive, 60000);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, APPLY_STAGE_BUDGET_MS.A - 1), []);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, 1), [{ type: 'finish', result: 'dropped', categories: [] }]);
});

test('Stage B waits for every part of its predicate, and for one commit when the scope changed', () => {
    const blockers = [
        { scope: { equal: false } }, { b: { groupApplied: false } }, { b: { planningHydrated: false } },
        { b: { restoring: true } }, { commit: 1 }, { b: { scopePending: true } },
    ];
    for (const blocker of blockers) {
        const sim = simulate();
        sim.step({ commit: 1 });
        assert.deepEqual(sim.step({ commit: 2, scope: { equal: true }, ...blocker, b: { ...blocker.b } }), [], JSON.stringify(blocker));
    }
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ commit: 2, scope: { equal: true } }), [{ type: 'run', stage: 'B' }]);
});

test('a same-scope link does not wait for a commit before Stage B', () => {
    const sim = simulate();
    sim.step({ commit: 4, scope: { equal: true } });
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true } }), [{ type: 'run', stage: 'B' }]);
});

test('Stage B waits while the Board scope readiness is pending and runs once it is not', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ commit: 2, scope: { equal: true }, b: { scopePending: true } }), []);
    assert.deepEqual(sim.step({ commit: 3, scope: { equal: true }, b: { scopePending: false } }), [{ type: 'run', stage: 'B' }]);
});

test('the hold is released one commit after Stage B, or after the settle fallback when nothing committed', () => {
    const byCommit = simulate();
    byCommit.step({ commit: 1 });
    byCommit.step({ commit: 2, scope: { equal: true } });
    assert.deepEqual(byCommit.step({ commit: 2, scope: { equal: true } }, APPLY_SETTLE_FALLBACK_MS - 1), []);
    assert.deepEqual(byCommit.step({ commit: 3, scope: { equal: true } }, 1), [{ type: 'releaseHold' }]);
    assert.deepEqual(byCommit.step({ commit: 4, scope: { equal: true } }), [], 'released once');

    const byFallback = simulate();
    byFallback.step({ commit: 1 });
    byFallback.step({ commit: 2, scope: { equal: true } });
    assert.deepEqual(byFallback.step({ commit: 2, scope: { equal: true } }, APPLY_SETTLE_FALLBACK_MS), [{ type: 'releaseHold' }]);
});

test('Stage B past its budget is skipped, reports mode and filters, and still releases the hold', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ commit: 2, b: { restoring: true } }, APPLY_STAGE_BUDGET_MS.B - 1), []);
    assert.deepEqual(sim.step({ commit: 3, b: { restoring: true } }, 1), [{ type: 'releaseHold' }]);
    assert.deepEqual(sim.state.skipped, ['mode', 'filters']);
    assert.equal(sim.state.stage, 'C');
});

test('Stage C waits until the scope is loaded: a newer epoch, idle lanes, fetched tasks, the right Sprint and a hydrated Team selection', () => {
    for (const blocker of [
        { epoch: 0 }, { lanesLoading: true }, { tasksFetched: false }, { lastLoadedMatches: false }, { teamsHydrated: false },
    ]) {
        const sim = simulate();
        throughB(sim);
        assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: { ...LOADED, ...blocker } }), [], JSON.stringify(blocker));
    }
});

test('the epoch must be newer than the one seen when Stage A ran', () => {
    const sim = simulate();
    sim.step({ commit: 1, c: { epoch: 3 } });
    sim.step({ commit: 2, scope: { equal: true }, c: { epoch: 3 } });
    sim.step({ commit: 3, scope: { equal: true }, c: { epoch: 3 } });
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: { ...LOADED, epoch: 3 } }), [], 'a load that finished before Stage A is not this scope');
    assert.deepEqual(sim.step({ commit: 5, scope: { equal: true }, c: { ...LOADED, epoch: 4 } }), [{ type: 'run', stage: 'C', part: 'teams' }]);
});

test('Stage C waits for the hold to be released after Stage B, then skips silently when the committed mode loads no tasks', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    sim.step({ commit: 2, scope: { equal: true } });
    assert.deepEqual(sim.step({ commit: 2, scope: { equal: true }, c: { ...LOADED, expected: false } }), [], 'Stage B has not committed yet');
    assert.deepEqual(sim.step({ commit: 3, scope: { equal: true }, c: { ...LOADED, expected: false } }), [{ type: 'releaseHold' }]);
    assert.equal(sim.state.stage, 'D', 'Teams and facets are not applied where no task list loads');
    assert.deepEqual(sim.state.skipped, [], 'a view that never loads tasks owes nothing');
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, d: { cohortSettled: true } }), [{ type: 'run', stage: 'D' }]);
});

test('Stage C applies Teams, then facets one commit later', () => {
    const sim = simulate();
    throughB(sim);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'teams' }]);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }), [], 'facets wait for a commit');
    assert.deepEqual(sim.step({ commit: 5, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'facets' }]);
    assert.equal(sim.state.stage, 'D');
});

test('the facets part proceeds after the settle fallback when the Team write committed nothing', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }, APPLY_SETTLE_FALLBACK_MS - 1), []);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }, 1), [{ type: 'run', stage: 'C', part: 'facets' }]);
});

test('a plan without Teams applies facets only, and one without either skips Stage C', () => {
    const facetsOnly = simulate();
    throughB(facetsOnly, { plan: { c: { teams: false, facets: true }, d: false } });
    assert.deepEqual(facetsOnly.step({ commit: 4, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'facets' }]);
    const teamsOnly = simulate();
    throughB(teamsOnly, { plan: { c: { teams: true, facets: false }, d: false } });
    assert.deepEqual(teamsOnly.step({ commit: 4, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'teams' }]);
    assert.deepEqual(teamsOnly.step({ commit: 5, scope: { equal: true }, c: LOADED }), [{ type: 'finish', result: 'done', categories: [] }]);
    const none = simulate();
    throughB(none, { plan: { c: { teams: false, facets: false }, d: false } });
    assert.deepEqual(none.step({ commit: 4, scope: { equal: true } }), [{ type: 'finish', result: 'done', categories: [] }]);
});

test('Stage C past its budget is skipped with the categories of the parts it still owed', () => {
    const both = simulate();
    throughB(both);
    assert.deepEqual(both.step({ commit: 4, scope: { equal: true } }, APPLY_STAGE_BUDGET_MS.C - 1), []);
    assert.deepEqual(both.step({ commit: 5, scope: { equal: true } }, 1), []);
    assert.deepEqual(both.state.skipped, ['teams', 'filters']);
    assert.equal(both.state.stage, 'D');

    const factsOwed = simulate();
    throughB(factsOwed);
    factsOwed.step({ commit: 4, scope: { equal: true }, c: LOADED });
    factsOwed.step({ commit: 4, scope: { equal: true }, c: { ...LOADED, lanesLoading: true } }, APPLY_STAGE_BUDGET_MS.C);
    assert.deepEqual(factsOwed.state.skipped, ['filters']);
});

test('Stage D needs the alert cohort settled, an idle recovery scroll and a visible document', () => {
    for (const blocker of [{ cohortSettled: false }, { recoveryIdle: false }, { visible: false }]) {
        const sim = simulate();
        throughB(sim);
        sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
        assert.deepEqual(sim.step({ commit: 6, scope: { equal: true }, d: { cohortSettled: true, recoveryIdle: true, visible: true, ...blocker } }), [], JSON.stringify(blocker));
    }
});

test('Stage D runs the reveal once and finishes on its result', () => {
    const reach = () => {
        const sim = simulate();
        throughB(sim);
        sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
        assert.deepEqual(sim.step({ commit: 6, d: { cohortSettled: true } }), [{ type: 'run', stage: 'D' }]);
        assert.deepEqual(sim.step({ commit: 7, d: { cohortSettled: true } }, 100), [], 'D is not repeated while the reveal is pending');
        return sim;
    };
    assert.deepEqual(reach().step({ focusResult: 'revealed' }), [{ type: 'finish', result: 'done', categories: [] }]);
    assert.deepEqual(reach().step({ focusResult: 'missing' }), [{ type: 'finish', result: 'partial', categories: ['focus'] }]);
    assert.deepEqual(reach().step({ focusResult: 'cancelled' }), [{ type: 'finish', result: 'done', categories: [] }]);
});

test('a link without a focus target finishes after Stage C and merges reported categories into the result', () => {
    const sim = simulate();
    throughB(sim, { plan: { c: { teams: true, facets: false }, d: false } });
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    assert.deepEqual(sim.step({ commit: 5, scope: { equal: true }, reported: ['teams', 'filters'] }), [
        { type: 'finish', result: 'partial', categories: ['teams', 'filters'] },
    ]);
});

test('Stage D past its budget is skipped and reports focus', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
    assert.deepEqual(sim.step({ commit: 6, d: { visible: false } }, APPLY_STAGE_BUDGET_MS.D - 1), []);
    assert.deepEqual(sim.step({ commit: 7, d: { visible: false } }, 1), [{ type: 'finish', result: 'partial', categories: ['focus'] }]);
});

test('a reveal that never reports back is cancelled at its own budget and reports focus', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 6, d: { cohortSettled: true } });
    assert.deepEqual(sim.step({ commit: 7 }, APPLY_STAGE_BUDGET_MS.D), [
        { type: 'cancelReveal' }, { type: 'finish', result: 'partial', categories: ['focus'] },
    ]);
});

test('a deliberate interaction before Stage D starts cancels the link and keeps what was applied', () => {
    for (const phase of ['gate', 'afterA', 'afterB', 'waitingC', 'waitingD']) {
        const sim = simulate();
        if (phase === 'gate') sim.step({ gate: { catalog: 'pending' } });
        else {
            sim.step({ commit: 1 });
            if (phase !== 'afterA') sim.step({ commit: 2, scope: { equal: true } });
            if (phase === 'waitingD') {
                sim.step({ commit: 3, scope: { equal: true } });
                sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
                sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
            }
        }
        assert.deepEqual(sim.step({ interrupt: 'deliberate', commit: 6 }), [{ type: 'finish', result: 'cancelled', categories: [] }], phase);
    }
});

test('scrolling alone does not cancel before Stage D', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ interrupt: 'scroll', commit: 2 }), []);
});

test('during Stage D any interaction cancels only the reveal and the link still finishes with the applied stages', () => {
    for (const interrupt of ['deliberate', 'scroll']) {
        const sim = simulate();
        throughB(sim);
        sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 6, d: { cohortSettled: true } });
        assert.deepEqual(sim.step({ interrupt, commit: 7 }), [{ type: 'cancelReveal' }], interrupt);
        assert.deepEqual(sim.step({ interrupt, commit: 8 }), [], 'cancelled once');
        assert.deepEqual(sim.step({ commit: 9, focusResult: 'cancelled' }), [{ type: 'finish', result: 'done', categories: [] }]);
    }
});

test('while a tour or the first-run popup pauses the link nothing runs, interactions are ignored and the clock stops', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ paused: true, interrupt: 'deliberate', commit: 2, scope: { equal: true } }, 1000), []);
    const frozen = sim.state.active;
    for (let tick = 0; tick < 4; tick += 1) assert.deepEqual(sim.step({ paused: true, commit: 3 + tick, scope: { equal: true } }, APPLY_OVERALL_BUDGET_MS), []);
    assert.equal(sim.state.active, frozen, 'a paused interval adds no active time');
    assert.deepEqual(sim.step({ commit: 8, scope: { equal: true } }, 1), [{ type: 'run', stage: 'B' }]);
});

test('the active clock counts only the unpaused intervals', () => {
    const sim = simulate();
    sim.step({ gate: { onboardingRequired: true } });
    sim.step({ paused: true, gate: { onboardingRequired: true } }, 10000);
    sim.step({ paused: true, gate: { onboardingRequired: true } }, 600000);
    assert.equal(sim.state.active, 10000, 'the interval that began unpaused counts, later paused ones do not');
    assert.deepEqual(sim.step({}, 1), [{ type: 'run', stage: 'A', scopeChange: true }]);
});

test('the overall budget drops a link that never reached Stage A and names only what was already reported', () => {
    const sim = simulate();
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }), []);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, APPLY_OVERALL_BUDGET_MS - 1), []);
    assert.deepEqual(
        sim.step({ gate: { catalog: 'pending' }, reported: ['mode'] }, 1),
        [{ type: 'finish', result: 'dropped', categories: ['mode'] }],
    );
});

test('the overall budget ends an applying link as partial and names every step it still owed', () => {
    const sim = simulate();
    throughB(sim);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true } }, APPLY_OVERALL_BUDGET_MS), [
        { type: 'finish', result: 'partial', categories: ['teams', 'filters', 'focus'] },
    ]);
});

test('the overall budget also cancels a reveal that is still running', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 6, d: { cohortSettled: true } });
    assert.deepEqual(sim.step({ commit: 7 }, APPLY_OVERALL_BUDGET_MS), [
        { type: 'cancelReveal' }, { type: 'finish', result: 'partial', categories: ['focus'] },
    ]);
});

test('the full chain runs strictly in order, one run action per step, and finishes done', () => {
    const sim = simulate();
    const runs = [];
    const record = actions => actions.filter(action => action.type === 'run').forEach(action => runs.push(`${action.stage}${action.part || ''}`));
    record(sim.step({ commit: 1 }));
    record(sim.step({ commit: 2, scope: { equal: true } }));
    record(sim.step({ commit: 3, scope: { equal: true } }));
    record(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }));
    record(sim.step({ commit: 5, scope: { equal: true }, c: LOADED }));
    record(sim.step({ commit: 6, d: { cohortSettled: true } }));
    assert.deepEqual(runs, ['A', 'B', 'Cteams', 'Cfacets', 'D']);
    assert.deepEqual(sim.step({ commit: 7, focusResult: 'revealed' }), [{ type: 'finish', result: 'done', categories: [] }]);
    assert.deepEqual(sim.step({ commit: 8 }), [], 'a finished machine is inert');
});

test('every stage budget and the overall budget match the design', () => {
    assert.deepEqual({ ...APPLY_STAGE_BUDGET_MS }, { A: 5000, B: 5000, C: 20000, D: 20000 });
    assert.equal(APPLY_OVERALL_BUDGET_MS, 90000);
});

// Readiness arriving at the active-time deadline is already too late to run a stage.
for (const offset of [-1, 0, 1]) {
    const boundary = offset < 0 ? 'immediately before' : offset === 0 ? 'at' : 'after';
    test(`Stage A resolution ${boundary} its deadline respects the armed window`, () => {
        for (const closes of [false, true]) {
            const sim = simulate();
            assert.deepEqual(sim.step({ resolution: null }), []);
            if (closes) assert.deepEqual(sim.step({ gate: { catalog: 'pending' }, resolution: null }, 1), []);
            const actions = sim.step({}, APPLY_STAGE_BUDGET_MS.A + offset - (closes ? 1 : 0));
            assert.deepEqual(actions, offset < 0
                ? [{ type: 'run', stage: 'A', scopeChange: true }]
                : [{ type: 'finish', result: 'dropped', categories: [] }]);
        }
    });

    test(`Stage A unresolved with an open gate ${boundary} its deadline cannot run late`, () => {
        const sim = simulate();
        assert.deepEqual(sim.step({ resolution: null }), []);
        assert.deepEqual(sim.step({ resolution: null }, APPLY_STAGE_BUDGET_MS.A + offset), offset < 0
            ? [] : [{ type: 'finish', result: 'dropped', categories: [] }]);
        if (offset < 0) assert.deepEqual(sim.step({ resolution: null }, 1), [{ type: 'finish', result: 'dropped', categories: [] }]);
        assert.deepEqual(sim.step({}, 1), [], 'late resolution cannot revive a dropped link');
    });

    test(`Stage B first readiness ${boundary} its deadline respects expiry and releases the hold`, () => {
        const sim = simulate();
        sim.step();
        assert.deepEqual(sim.step({ commit: 2, scope: { equal: true } }, APPLY_STAGE_BUDGET_MS.B + offset), offset < 0
            ? [{ type: 'run', stage: 'B' }] : [{ type: 'releaseHold' }]);
        assert.deepEqual(sim.state.skipped, offset < 0 ? [] : ['mode', 'filters']);
        assert.equal(sim.state.stage, 'C');
        assert.deepEqual(sim.step({ commit: 3, scope: { equal: true } }), offset < 0 ? [{ type: 'releaseHold' }] : []);
    });

    test(`Stage C first readiness ${boundary} its deadline skips only owed work`, () => {
        for (const teams of [false, true]) {
            const sim = simulate();
            throughB(sim, { plan: { c: { teams, facets: true }, d: true } });
            assert.deepEqual(sim.step({ commit: 4, c: LOADED }, APPLY_STAGE_BUDGET_MS.C + offset), offset < 0
                ? [{ type: 'run', stage: 'C', part: teams ? 'teams' : 'facets' }] : []);
            assert.deepEqual(sim.state.skipped, offset < 0 ? [] : [...(teams ? ['teams'] : []), 'filters']);
            if (offset >= 0) assert.equal(sim.state.stage, 'D');
        }
    });

    test(`Stage C facets readiness ${boundary} its deadline never reports Teams already applied`, () => {
        const sim = simulate();
        throughB(sim);
        assert.deepEqual(sim.step({ commit: 4, c: LOADED }, APPLY_STAGE_BUDGET_MS.C - 2), [{ type: 'run', stage: 'C', part: 'teams' }]);
        assert.deepEqual(sim.step({ commit: 5, c: LOADED }, 2 + offset), offset < 0
            ? [{ type: 'run', stage: 'C', part: 'facets' }] : []);
        assert.deepEqual(sim.state.skipped, offset < 0 ? [] : ['filters']);
        assert.equal(sim.state.stage, 'D');
    });

    test(`Stage D first readiness ${boundary} its deadline preserves focus reporting`, () => {
        const sim = simulate();
        throughB(sim, { plan: { c: { teams: false, facets: false }, d: true } });
        assert.deepEqual(sim.step(), []);
        assert.deepEqual(sim.step({ d: { cohortSettled: true } }, APPLY_STAGE_BUDGET_MS.D + offset), offset < 0
            ? [{ type: 'run', stage: 'D' }] : [{ type: 'finish', result: 'partial', categories: ['focus'] }]);
    });
}

test('expired stages with no work still skip silently', () => {
    for (const offset of [0, 1]) {
        for (const c of [{ teams: false, facets: false }, { teams: true, facets: true }]) {
            const sim = simulate();
            sim.step({ resolution: { ok: true, plan: { c, d: false } } });
            sim.step({ commit: 2, scope: { equal: true } });
            assert.deepEqual(sim.step({ commit: 3, c: { expected: false } }, APPLY_STAGE_BUDGET_MS.C + offset), [{ type: 'releaseHold' }]);
            assert.deepEqual(sim.state.skipped, []);
            assert.deepEqual(sim.step({}, APPLY_STAGE_BUDGET_MS.D + offset), [{ type: 'finish', result: 'done', categories: [] }]);
        }
    }
});

test('random readiness never breaks the machine invariants', () => {
    let seed = 20261014;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const chance = probability => random() < probability;
    const order = ['A', 'B', 'Cteams', 'Cfacets', 'D'];
    for (let run = 0; run < 300; run += 1) {
        const plan = { c: { teams: chance(0.7), facets: chance(0.7) }, d: chance(0.6) };
        const sim = simulate();
        const seen = [];
        let releases = 0;
        let finishes = 0;
        for (let step = 0; step < 120; step += 1) {
            const wasFinished = sim.state.finished;
            const actions = sim.step({
                commit: step, paused: chance(0.05), authLocked: chance(0.004), reviewBusy: chance(0.004),
                interrupt: chance(0.01) ? (chance(0.5) ? 'deliberate' : 'scroll') : null,
                resolution: chance(0.9) ? { ok: true, plan } : { ok: false, categories: ['group'] },
                gate: { configSettled: chance(0.9), groupsLoading: chance(0.2), catalog: chance(0.7) ? 'validated' : 'pending', onboardingRequired: chance(0.1) },
                scope: { equal: chance(0.5) },
                b: { groupApplied: chance(0.8), planningHydrated: chance(0.8), restoring: chance(0.2), scopePending: chance(0.1) },
                c: { epoch: Math.floor(step / 10), lanesLoading: chance(0.2), tasksFetched: chance(0.8), lastLoadedMatches: chance(0.8), teamsHydrated: chance(0.8), expected: chance(0.9) },
                d: { cohortSettled: chance(0.5), recoveryIdle: chance(0.8), visible: chance(0.8) },
                focusResult: chance(0.1) ? 'revealed' : null,
                reported: chance(0.1) ? ['teams'] : [],
            }, chance(0.1) ? 5000 : 40);
            if (wasFinished) assert.deepEqual(actions, [], 'a finished machine stays inert');
            assert.ok(actions.filter(action => action.type === 'run').length <= 1, 'at most one stage runs per step');
            for (const action of actions) {
                if (action.type === 'run') seen.push(`${action.stage}${action.part || ''}`);
                if (action.type === 'releaseHold') releases += 1;
                if (action.type === 'finish') finishes += 1;
            }
        }
        assert.ok(releases <= 1 + (seen.includes('B') ? 0 : 1), 'the hold is released at most once per path');
        assert.ok(finishes <= 1, 'one terminal action');
        assert.deepEqual(seen, order.filter(stage => seen.includes(stage)), 'stages run once, in order');
    }
});
