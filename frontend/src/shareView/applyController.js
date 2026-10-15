import {
    SHARE_VIEW_PHASES, beginShareViewStage, finishShareView, getShareViewSnapshot,
    markShareViewScopeCommitted, setPendingPlanningRowMode,
} from './store.js';
import { SHARE_VIEW_ALERT_KEYS, SHARE_VIEW_KEYS_BY_MODE } from './viewDefaults.js';
import {
    buildShareViewFieldPlan, resolveShareViewFacets, resolveShareViewFocus, resolveShareViewScope, resolveShareViewTeams,
} from './resolver.js';
import { revealShareViewFocus } from './focusReveal.js';
import { createApplyMachine, stepApplyMachine } from './applyMachine.js';
import { STATS_RANGE_KIND } from './captureState.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';
import { selectedTeamSelectionsEqual } from '../teamSelectionUtils.mjs';

// Drives one shareable-link apply. Each tick reads the committed App state through `readOptions()`, steps the
// pure machine and executes its actions with raw setters and refs only: never applyEngMode, the filter-reset
// helpers or the alert navigation helpers, whose analytics, resets and Jira fallbacks a link must not trigger.

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const has = (object, key) => Object.hasOwn(object, key);
const unique = values => [...new Set(values)];
const SURFACE_BY_MODE = new Map([['catch-up', 'catch_up'], ['planning', 'planning'], ['board', 'board'], ['statistics', 'statistics']]);
// The apply event's surface: the link's resolved mode, else the recipient's current ENG mode, else Catch Up.
const surfaceFor = (mode, currentMode) => SURFACE_BY_MODE.get(mode) ?? SURFACE_BY_MODE.get(currentMode) ?? 'catch_up';
const ANALYTICS_RESULT = Object.freeze({ done: 'success', partial: 'partial', dropped: 'rejected', cancelled: 'rejected' });
const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
// What an action that did not finish leaves unapplied.
const STEP_CATEGORIES = Object.freeze({ A: ['group', 'sprint'], B: ['mode', 'filters'], Cteams: ['teams'], Cfacets: ['filters'], D: ['focus'] });

export function readFacetOptionIds(model) {
    const ids = facetId => ((model?.facets || []).find(facet => facet.id === facetId)?.options || []).map(option => option.id);
    return { status: ids('status'), priority: ids('priority'), track: ids('track') };
}

// The resolver reads each Sprint's start date to order a Statistics range, so the catalog entries go in as they are.
const resolverContext = o => ({
    visibleGroups: o.visibleControlGroups || [],
    sprints: o.sprintCatalogState.availableSprints || [],
});

// Re-run before every stage, so a settings save or a refresh that removed the group or Sprint mid-apply stops the link.
export function resolveApplyPlan(o, state) {
    const scope = resolveShareViewScope(state, resolverContext(o));
    if (!scope.ok) return { ok: false, categories: scope.reported };
    // The resolved mode, not the link's: a Planning link for a closed Sprint that fell back to Catch Up is applied as Catch Up.
    const teams = resolveShareViewTeams(state, scope.group, scope.mode);
    return {
        ok: true, scope, teams, reported: [...scope.reported, ...teams.reported],
        plan: { c: { teams: teams.teams !== null, facets: SHARE_VIEW_KEYS_BY_MODE[scope.mode].includes('status') }, d: resolveShareViewFocus(state, scope.mode) !== null },
    };
}

function runStageA(o, state, { scope, teams }, scopeChange) {
    o.setSelectedView('eng');
    o.restoredInitialEpmViewRef.current = true;
    if (!scopeChange) return;
    o.setActiveGroupId(scope.group.id);
    o.commitSprintSelection(scope.sprint, {
        groupId: scope.group.id, teams: teams.teams ?? undefined,
        projectTrackRange: scope.mode === 'statistics' && state.stats === 'projectTrack',
    });
}

function writeRange(o, view, range) {
    const kind = has(STATS_RANGE_KIND, view) ? STATS_RANGE_KIND[view] : null;
    if (kind === 'quarter') {
        o.setCohortStartQuarter(range.from);
        o.setCohortEndQuarter(range.to);
    } else if (kind === 'sprint') {
        o.setExcludedCapacityStartSprintId(String(range.from));
        o.setExcludedCapacityEndSprintId(String(range.to));
    }
}

// Mode booleans first, then every key of the mode: its default or the link's value. Returns what the link leaves unapplied
// and the Planning rows mode to seed once the scope has loaded.
function runStageB(o, state, scope) {
    const boardScopeReady = (_groupId, token) => (token === 'component' ? o.engSprintSelectorState.componentReadiness : o.engSprintSelectorState.allWorkReadiness) === 'ready';
    const { apply, reported } = buildShareViewFieldPlan(state, scope, { ...resolverContext(o), boardScopeReady });
    o.setShowPlanning(scope.mode === 'planning');
    o.setShowStats(scope.mode === 'statistics');
    o.setShowScenario(false);
    o.setShowBoard(scope.mode === 'board');
    if (has(apply, 'find')) { o.setSearchInput(apply.find); o.setSearchQuery(apply.find); }
    if (has(apply, 'lanes')) { o.setShowProduct(apply.lanes.product); o.setShowTech(apply.lanes.tech); }
    if (has(apply, 'initiatives')) o.setGroupByInitiativeChoice(apply.initiatives);
    if (has(apply, 'sort')) o.setEngEpicSort(apply.sort);
    if (has(apply, 'layout')) o.setPlanningLayout(apply.layout);
    if (has(apply, 'stats')) o.setStatsView(apply.stats);
    if (apply.range) writeRange(o, apply.stats, apply.range);
    if (has(apply, 'alerts')) {
        o.setShowAlertsPanel(apply.alerts.panel);
        SHARE_VIEW_ALERT_KEYS.forEach(key => o.alertFlags[key][1](Boolean(apply.alerts.expanded[key])));
    }
    if (has(apply, 'scope')) o.setBoardStrictScope(apply.scope);
    return { reported, rows: has(apply, 'rows') ? apply.rows : null };
}

// A scope-changing link left the Team carry-forward for the hydrate effect to consume; this only corrects what it did not set.
function runStageCTeams(o, fresh) {
    const { teams } = fresh.teams;
    if (teams === null || selectedTeamSelectionsEqual(o.selectedTeams, teams)) return;
    o.persistTeamSelection(teams);
    o.setSelectedTeams(teams);
}

function runStageCFacets(o, state, mode) {
    const { apply, reported } = resolveShareViewFacets(state, readFacetOptionIds(o.engCatchUpFacetModel), mode);
    if (has(apply, 'status')) o.setEngStatusFilter(apply.status);
    if (has(apply, 'priority')) o.setEngPriorityFilter(apply.priority);
    if (has(apply, 'track')) o.setEngProjectTrackFilter(apply.track);
    return reported;
}

function readGate(o) {
    const catalog = o.sprintCatalogState;
    const validated = catalog.authority === 'validated';
    const unrecoverable = catalog.authority === 'auth_locked'
        || (!validated && !catalog.validatedSnapshot && (catalog.status === 'error' || catalog.status === 'exhausted'));
    return {
        configSettled: Boolean(o.sharedConfigReady), groupsLoading: Boolean(o.groupsLoading), groupsFailed: Boolean(o.groupsFailed),
        onboardingRequired: Boolean(o.onboardingRequired), adminGate: o.adminSettingsGate.status,
        catalog: validated ? ((catalog.availableSprints || []).length ? 'validated' : 'failed') : unrecoverable ? 'failed' : 'pending',
        capsulesPending: Boolean(o.pendingShellAuthResumeRef.current || o.pendingPlanningAuthResumeRef.current),
        homeTokenReady: !o.savedViewIsEpm || Boolean(o.homeTokenConnectionLoaded),
    };
}

const isApplyPaused = o => Boolean(o.onboardingRequired || o.tourRunning);

export function createApplyController({ readOptions, now = clock }) {
    let machine = createApplyMachine();
    let commit = 0;
    let interrupt = null;
    let focusResult = null;
    let reveal = null;
    let revealCancelled = false;
    let seeded = false;
    let locked = null;
    let resolved = null;
    let planningRows = null;
    let pendingTrack = null;
    let trackQueued = false;
    const reported = new Set();
    const addReported = categories => (categories || []).forEach(category => reported.add(category));

    const queueTrack = (result, sourceSurface) => {
        if (trackQueued) return;
        trackQueued = true;
        pendingTrack = { workflowAction: 'apply_link', result: ANALYTICS_RESULT[result], sourceSurface };
    };

    const buildInput = (o, state) => {
        const preScope = !machine.ran.A;
        resolved = preScope ? resolveApplyPlan(o, state) : resolved;
        const target = preScope ? (resolved.ok ? { groupId: resolved.scope.group.id, sprintId: String(resolved.scope.sprint.id) } : null) : locked.target;
        const mode = preScope ? resolved.scope?.mode : locked.mode;
        const boardToken = mode === 'board' && (state.scope === 'component' || state.scope === 'all_work') ? state.scope : null;
        const readiness = boardToken === 'component' ? o.engSprintSelectorState.componentReadiness : o.engSprintSelectorState.allWorkReadiness;
        const teamsHydrated = Boolean(o.teamSelectionScopeKey) && o.teamSelectionHydratedScopeRef.current === o.teamSelectionScopeKey;
        return {
            now: now(), commit, paused: isApplyPaused(o), authLocked: Boolean(readPendingAuthenticationRequired()),
            reviewBusy: Boolean(o.planningReviewBusy), interrupt, reported: [...reported],
            gate: readGate(o),
            resolution: preScope ? (resolved.ok ? { ok: true, plan: resolved.plan } : { ok: false, categories: resolved.categories }) : null,
            scope: { equal: Boolean(target) && String(o.activeGroupId) === target.groupId && String(o.selectedSprint) === target.sprintId },
            b: {
                groupApplied: o.activeGroupRef.current === o.activeGroupId,
                planningHydrated: Boolean(o.planningScopeKey) && o.planningHydratedScopeRef.current === o.planningScopeKey,
                restoring: Boolean(o.restoringGroupRef.current),
                scopePending: Boolean(boardToken) && (readiness === 'catalog_pending' || readiness === 'loading'),
            },
            c: {
                epoch: o.loadEpochRef.current, lanesLoading: Boolean(o.tasksLoading), tasksFetched: Boolean(o.tasksFetched),
                lastLoadedMatches: Boolean(target) && String(o.lastLoadedSprintRef.current ?? '') === target.sprintId,
                teamsHydrated, expected: Boolean(o.engLoadsTasks),
            },
            d: {
                cohortSettled: mode === 'catch-up' ? o.catchUpAlertLoadRef.current === o.catchUpAlertScopeKey && o.alertCohortRef.current === null : true,
                recoveryIdle: !o.pendingConnectionRecoveryRef.current, visible: isVisible(),
            },
            focusResult,
        };
    };

    const conclude = ({ result, categories }) => {
        revealCancelled = true;
        reveal?.cancel();
        // The store ends an apply once; only the call that ended it reports the apply event.
        if (!finishShareView(result, categories)) return;
        queueTrack(result, surfaceFor(locked?.mode, readOptions().activeEngMode));
    };

    const abort = (categories) => {
        machine = { ...machine, finished: true };
        conclude({ result: 'partial', categories: unique([...reported, ...categories]) });
    };

    // Returns false when the link no longer resolves, which ends it.
    const runStage = (action, o, state) => {
        // The Planning table is unmounted by the first ENG load, which the hold delays until after Stage B, so its Epics/Stories
        // rows are seeded once that load is done. The seed comes first: the table remounts when Stage C begins (a key on the table).
        if (action.stage === 'C' && planningRows) { setPendingPlanningRowMode(planningRows); planningRows = null; }
        beginShareViewStage(action.stage);
        const fresh = action.stage === 'A' ? resolved : resolveApplyPlan(o, state);
        if (!fresh.ok) { abort(fresh.categories); return false; }
        addReported(fresh.reported);
        if (action.stage === 'A') {
            locked = { target: { groupId: fresh.scope.group.id, sprintId: String(fresh.scope.sprint.id) }, mode: fresh.scope.mode };
            runStageA(o, state, fresh, action.scopeChange);
        } else if (action.stage === 'B') {
            const applied = runStageB(o, state, fresh.scope);
            addReported(applied.reported);
            planningRows = applied.rows;
        } else if (action.stage === 'C') {
            if (action.part === 'teams') runStageCTeams(o, fresh);
            else addReported(runStageCFacets(o, state, fresh.scope.mode));
        } else {
            const target = resolveShareViewFocus(state, fresh.scope.mode);
            if (!target) { focusResult = 'missing'; return true; }
            // Cancelled by the machine, by an interaction the guard reported since the last tick, or by the terminal auth lock.
            reveal = revealShareViewFocus(target, { mode: fresh.scope.mode, isCancelled: () => revealCancelled || interrupt !== null || Boolean(readPendingAuthenticationRequired()) });
            reveal.done.catch(() => 'missing').then((result) => { focusResult = result; controller.evaluate(); });
        }
        return true;
    };

    const controller = {
        noteCommit() { commit += 1; },
        noteInterrupt(kind) { if (kind === 'deliberate' || interrupt === null) interrupt = kind; },
        isPaused: () => isApplyPaused(readOptions()),
        evaluate() {
            const snapshot = getShareViewSnapshot();
            const active = snapshot.phase === SHARE_VIEW_PHASES.PENDING || snapshot.phase === SHARE_VIEW_PHASES.RUNNING;
            if (!active) {
                if (snapshot.phase === SHARE_VIEW_PHASES.DROPPED && !snapshot.entry) queueTrack('dropped', surfaceFor(undefined, readOptions().activeEngMode));
                return;
            }
            if (machine.finished || !snapshot.entry) return;
            if (!seeded) { seeded = true; addReported(snapshot.entry.reported); }
            const state = snapshot.entry.state;
            let failing = null;
            try {
                const o = readOptions();
                const input = buildInput(o, state);
                interrupt = null;
                const stepped = stepApplyMachine(machine, input);
                machine = stepped.state;
                for (const action of stepped.actions) {
                    if (action.type === 'releaseHold') markShareViewScopeCommitted();
                    else if (action.type === 'cancelReveal') { revealCancelled = true; reveal?.cancel(); }
                    else if (action.type === 'run') { failing = action; if (!runStage(action, o, state)) break; failing = null; }
                    else conclude(action);
                }
            } catch (error) {
                // A link must never take the dashboard down: stop applying and keep whatever was already written.
                console.error('Shareable link apply failed', error);
                machine = { ...machine, finished: true };
                const unfinished = [...(failing ? STEP_CATEGORIES[`${failing.stage}${failing.part || ''}`] : []), ...machine.skipped, ...machine.owed.flatMap(entry => entry.categories)];
                conclude({ result: machine.ran.A ? 'partial' : 'dropped', categories: unique([...reported, ...unfinished]) });
            }
        },
        // The apply event is sent once, and only when analytics is ready (earlier events are dropped).
        flushTrack(track, analyticsReady) {
            if (!pendingTrack || !analyticsReady) return;
            track(pendingTrack);
            pendingTrack = null;
        },
    };
    return controller;
}
