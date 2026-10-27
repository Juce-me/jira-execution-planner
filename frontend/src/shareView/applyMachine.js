// Pure apply machine for a shareable view link (issue #194). It owns ordering and timing only: the
// caller reads a plain readiness snapshot each tick, executes the returned actions and feeds the next
// snapshot back. It never reads a clock, a ref or the DOM, so every lifecycle row is testable with a
// fake clock.
//
// Stages (docs/plans/SUPPORT-shareable-view-links-design-194.md, "Apply machine"):
//   A scope, B fields, C data-dependent (Teams, then facets), D focus.
// One `run` action is issued per step so a stage's writes commit before the next stage reads state.
// Every stage budget is measured on the active clock, which stops while `input.paused`.

export const APPLY_OVERALL_BUDGET_MS = 90000;
// A: the readiness gate first opened -> Stage A runs. B, C, D: the previous stage finished -> this one runs.
export const APPLY_STAGE_BUDGET_MS = Object.freeze({ A: 5000, B: 5000, C: 20000, D: 20000 });
// A commit normally follows a stage's writes; when every write was a no-op none does, so the next
// step proceeds after this long instead of waiting for one.
export const APPLY_SETTLE_FALLBACK_MS = 250;

const unique = values => [...new Set(values)];

export function createApplyMachine() {
    return {
        finished: false, lastNow: null, lastPaused: false, active: 0, startActive: null,
        stage: 'A', armedActive: null, plan: null, owed: [], skipped: [],
        ran: { A: false, D: false }, scopeChange: false, aCommit: 0, epochAtA: 0,
        holdPending: false, bCommit: 0, bActive: 0, cPart: null, cCommit: 0, cActive: 0,
        dActive: 0, revealCancelled: false,
    };
}

// The categories each step of the chain owes; a step leaves the list when it runs or is skipped.
function owedSteps(plan) {
    return [
        { step: 'B', categories: ['mode', 'filters'] },
        ...(plan.c.teams ? [{ step: 'Ct', categories: ['teams'] }] : []),
        ...(plan.c.facets ? [{ step: 'Cf', categories: ['filters'] }] : []),
        ...(plan.d ? [{ step: 'D', categories: ['focus'] }] : []),
    ];
}

export function stepApplyMachine(previous, input) {
    const state = { ...previous, ran: { ...previous.ran }, skipped: [...previous.skipped], owed: [...previous.owed] };
    const actions = [];
    const elapsed = state.lastNow === null ? 0 : Math.max(0, input.now - state.lastNow);
    if (!state.lastPaused) state.active += elapsed;
    state.lastNow = input.now;
    state.lastPaused = input.paused;
    if (state.finished) return { state, actions };

    const reported = input.reported || [];
    const wait = () => ({ state, actions });
    const finish = (result, categories) => {
        state.finished = true;
        actions.push({ type: 'finish', result, categories: unique(categories) });
        return { state, actions };
    };
    // A link dropped before Stage A names only what the resolver and the decoder reported: a group or Sprint the
    // recipient does not have. A link that could not start (groups failed, a timeout) names nothing.
    const drop = (categories = []) => finish('dropped', [...categories, ...reported]);
    const cancelReveal = () => {
        if (state.revealCancelled) return;
        state.revealCancelled = true;
        actions.push({ type: 'cancelReveal' });
    };
    const settle = () => {
        const categories = [...reported, ...state.skipped];
        return finish(categories.length ? 'partial' : 'done', categories);
    };
    const complete = step => { state.owed = state.owed.filter(entry => entry.step !== step); };
    const moveTo = (stage, skippedSteps = []) => {
        for (const step of skippedSteps) {
            state.skipped.push(...state.owed.find(entry => entry.step === step).categories);
            complete(step);
        }
        state.stage = stage;
        state.armedActive = state.active;
    };

    if (input.authLocked) return finish('dropped', []);
    if (input.reviewBusy) return finish('cancelled', []);
    if (!input.paused && input.interrupt) {
        if (state.ran.D) cancelReveal();
        else if (input.interrupt === 'deliberate') return finish('cancelled', []);
    }
    if (!input.gate.configSettled) return wait();
    if (state.startActive === null) state.startActive = state.active;
    // Accept reach only inside the original bounds. Removing D's debt preserves an earlier accepted
    // landing through cleanup; a newly delivered reach at expiry cannot hide the expired work.
    if (state.ran.D && input.focusReached && state.active - state.startActive < APPLY_OVERALL_BUDGET_MS
        && state.active - state.dActive < APPLY_STAGE_BUDGET_MS.D) complete('D');
    if (state.active - state.startActive >= APPLY_OVERALL_BUDGET_MS) {
        if (!state.ran.A) return drop();
        if (state.ran.D) cancelReveal();
        const categories = [...reported, ...state.skipped, ...state.owed.flatMap(entry => entry.categories)];
        return finish(categories.length ? 'partial' : 'done', categories);
    }
    if (input.paused) return wait();

    // Stage A: scope. Nothing else is meaningful until the link's own group and Sprint are in place.
    if (!state.ran.A) {
        const { gate } = input;
        if (gate.groupsFailed || gate.adminGate === 'missing' || gate.catalog === 'failed') return drop();
        const open = !gate.groupsLoading && !gate.onboardingRequired && gate.adminGate === 'clear'
            && gate.catalog === 'validated' && !gate.capsulesPending && gate.epmHomeReadReady;
        if (open && state.armedActive === null) state.armedActive = state.active;
        if (state.armedActive !== null && state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.A) return drop();
        if (!open) return wait();
        if (!input.resolution) return wait();
        if (!input.resolution.ok) return drop(input.resolution.categories);
        state.plan = input.resolution.plan;
        state.owed = owedSteps(state.plan);
        state.scopeChange = !input.scope.equal;
        state.ran.A = true;
        state.aCommit = input.commit;
        state.epochAtA = input.c.epoch;
        moveTo('B');
        actions.push({ type: 'run', stage: 'A', scopeChange: state.scopeChange });
        return { state, actions };
    }

    // The hold only exists to stop a default-scope load, so it outlives Stage B's writes until they commit.
    if (state.holdPending && (input.commit > state.bCommit || state.active - state.bActive >= APPLY_SETTLE_FALLBACK_MS)) {
        state.holdPending = false;
        actions.push({ type: 'releaseHold' });
    }

    if (state.stage === 'B') {
        const { b } = input;
        const settled = input.scope.equal && b.groupApplied && b.planningHydrated && !b.restoring
            && (!state.scopeChange || input.commit > state.aCommit) && !b.scopePending;
        if (state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.B) {
            moveTo('C', ['B']);
            actions.push({ type: 'releaseHold' });
        } else if (settled) {
            state.bCommit = input.commit;
            state.bActive = state.active;
            state.holdPending = true;
            complete('B');
            moveTo('C');
            actions.push({ type: 'run', stage: 'B' });
        }
        return { state, actions };
    }

    if (state.stage === 'C') {
        const { c } = state.plan;
        const scope = input.c;
        if (state.holdPending) return { state, actions };
        if ((!c.teams && !c.facets) || !scope.expected) {
            complete('Ct');
            complete('Cf');
            moveTo('D');
            return { state, actions };
        }
        if (state.cPart === null) state.cPart = c.teams ? 'teams' : 'facets';
        const epochReady = state.scopeChange ? scope.epoch > state.epochAtA : scope.epoch >= state.epochAtA;
        const loaded = input.scope.equal && epochReady && !scope.lanesLoading && scope.tasksFetched
            && scope.lastLoadedMatches && scope.teamsHydrated;
        const committed = input.commit > state.cCommit || state.active - state.cActive >= APPLY_SETTLE_FALLBACK_MS;
        if (state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.C) {
            moveTo('D', state.cPart === 'teams' ? ['Ct', ...(c.facets ? ['Cf'] : [])] : ['Cf']);
        } else if (loaded && state.cPart === 'teams') {
            state.cCommit = input.commit;
            state.cActive = state.active;
            complete('Ct');
            actions.push({ type: 'run', stage: 'C', part: 'teams' });
            if (c.facets) state.cPart = 'facets';
            else moveTo('D');
        } else if (loaded && state.cPart === 'facets' && (!c.teams || committed)) {
            complete('Cf');
            actions.push({ type: 'run', stage: 'C', part: 'facets' });
            moveTo('D');
        }
        return { state, actions };
    }

    // Stage D: focus. Applied stages are kept whatever happens here.
    if (!state.plan.d) return settle();
    if (!state.ran.D) {
        const { d } = input;
        if (state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.D) {
            moveTo('D', ['D']);
            return settle();
        }
        if (d.targetReady && d.scopeMatches && d.recoveryIdle && d.visible) {
            state.ran.D = true;
            state.dActive = state.active;
            actions.push({ type: 'run', stage: 'D' });
        }
        return { state, actions };
    }
    if (state.active - state.dActive >= APPLY_STAGE_BUDGET_MS.D) {
        cancelReveal();
        if (state.owed.some(entry => entry.step === 'D')) moveTo('D', ['D']);
        return settle();
    }
    if (input.focusResult === 'revealed' || input.focusResult === 'cancelled') return settle();
    if (input.focusResult === 'missing') { moveTo('D', ['D']); return settle(); }
    return { state, actions };
}
