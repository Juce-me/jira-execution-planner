import { parseFreshnessRetryAt } from './dashboardFreshnessController.js';
import { fetchDependencies as requestDependencies } from './api/engApi.js';
import { AuthenticationRequiredError, isAuthenticationRequiredError } from './api/authRequired.js';

export function resolveFreshnessSurface(input) {
    if (input.selectedView === 'epm') return 'epm';
    if (input.showScenario) return 'scenario';
    if (input.showStats) return 'stats';
    if (input.showBoard) return input.strictBoardActive ? 'strict_board' : 'board';
    return input.showPlanning ? 'planning' : 'catch_up';
}

export function readFreshnessScopeGuards(input) {
    const review = input.showPlanning && input.planningReview?.getState();
    const scenario = input.showScenario && (input.scenarioHasUnsavedChanges || input.scenarioEditMode || input.scenarioDragState || input.scenarioDragStateRef?.current
        || ['saving', 'loadingHistory', 'loadingVersionNumber', 'loadingActiveDraft', 'rollingBackVersionNumber', 'reloadingFromJira', 'pendingHistoryAction',
            'pendingActiveDraftReload', 'pendingReloadFromJira', 'writebackPreviewing', 'writebackChecking', 'conflict', 'staleDraft', 'pendingScopeChange'].some(key => input.scenarioDraftMeta?.[key]));
    const settings = (input.showGroupManage && input.isGroupDraftDirty) || input.groupSaving || input.epmConfigSaving || input.groupVisibilitySaving || input.workspaceConfigConflict || input.groupsConfigConflict;
    const pending = [input.pendingStatusIssueKeys, input.pendingPriorityIssueKeys, input.pendingProjectTrackIssueKeys, input.issueFieldEdits?.pendingIssueKeys];
    return { blocked: Boolean(scenario || settings || input.statusTransitionActiveKey || input.priorityTransitionActiveKey || input.projectTrackTransitionActiveKey
        || input.issueFieldEdits?.activeEditor || pending.some(keys => keys?.size) || input.issueEditState?.planningEntries().length
        || review?.dirty || review?.saving || review?.conflict || review?.unconfirmed || review?.pendingScopeChange
        || (input.showPlanning && (input.planningInteractionRef?.current || input.capacityInteractionRef?.current)) || input.pendingCapacityMutation || input.openPopover || input.isHeld?.() || input.surfaceBlocked || input.boardFreshnessRef?.current.interaction),
    epoch: input.loadEpochRef.current, version: input.groupLoadVersionRef.current, scopeKey: `${input.activeGroupId}|${input.selectedSprint}` };
}

export function readFreshnessEnvironment(input) {
    const surface = resolveFreshnessSurface(input);
    return { surface, contextKey: JSON.stringify([input.authResumePrincipalRef.current, input.connectionRecoveryPrincipalRef.current,
        input.jiraUrl, input.authResumeStagedRevision, input.sharedConfigRevision, input.groupsConfig?.configRevision,
        surface, input.activeGroupId, input.selectedSprint, input.activeGroupTeamIds, input.sourceScope,
        ...(surface === 'stats' ? [input.statsView, input.statsQueryScope] : []),
        ...(surface === 'epm' ? [input.savedEpmRootGoalKey, input.savedEpmSubGoalKeys, input.runtimeEpmSubGoalKeys, input.epmTab, input.epmSelectedProjectId] : [])]),
    bootstrapReady: Boolean(input.sharedConfigReady && input.acceptedBoardConfigRef.current && input.engWorkspaceConfigured),
    connectionOwned: input.connectionRecoveryBlocksRefresh || input.connectionUnavailableRef.current,
    terminalAuth: Boolean(input.terminalAuth), blocked: readFreshnessScopeGuards(input).blocked,
    ownerBusy: Boolean(input.showGroupManage || input.onboardingActive || (input.showScenario && input.scenarioLoading) || input.loading || input.productTasksLoading || input.techTasksLoading || input.groupsLoading || input.catalogLoading
        || (input.showPlanning && (input.planningReview?.getState().loading || input.capacityLoading)) || input.alertCohortRef.current || input.onboardingRequired || input.surfaceBusy || (surface === 'stats' && input.statsLoading) || (surface === 'epm' && input.epmLoading)) };
}

const sameScope = (a, b) => a.epoch === b.epoch && a.version === b.version && a.scopeKey === b.scopeKey;
const descriptor = (source, lane, started, now) => ({ source, status: lane?.status || 'failed', checkKind: 'forced',
    coverage: lane?.coverage || 'unknown', requestStartedAtMs: started,
    ...(lane?.status === 'rate_limited' ? { retryAtMs: parseFreshnessRetryAt(String(lane.retryAfterSeconds), now()) } : {}) });

// A refused or superseded acquisition is resumable, never a settled failure.
const ignoredSources = job => (job.pendingSources || []).map(source => ({ source, status: 'ignored' }));

function captureEngAnchor(input) {
    const viewport = input.getViewport();
    const candidates = Array.from(document.querySelectorAll('.epic-block[data-epic-key]'));
    const block = candidates.find(node => { const rect = node.getBoundingClientRect(); return rect.bottom > viewport.top && rect.top < viewport.bottom; });
    return block ? { epicKey: block.dataset.epicKey } : null;
}

export function createCatchUpFreshnessAdapter(readCurrent, { now = Date.now, board = false, planning = false, scenario = false } = {}) {
    const attempts = new WeakMap();
    const getAttempt = (job, anchor) => {
        if (!attempts.has(job)) {
            const input = readCurrent();
            const state = input.epicRefresh.readState();
            attempts.set(job, { anchor, guards: readFreshnessScopeGuards(input), requestSnapshot: new Map([...state.loadedProductTasks, ...state.loadedTechTasks].map(item => [item.key, item])),
                epicSnapshot: state.epicDetails, changedKeys: [], fetchedStories: [] });
        }
        return attempts.get(job);
    };
    const guard = (job, attempt) => job.shouldApply() && sameScope(readFreshnessScopeGuards(readCurrent()), attempt.guards);
    return {
        sources: () => ['eng_product', 'eng_tech'],
        captureAnchor: () => board || scenario ? null : readCurrent().epicRefresh.captureAnchor?.() || captureEngAnchor(readCurrent()),
        async refreshAnchor(job, anchor) {
            const attempt = getAttempt(job, anchor);
            if (board || scenario) return [];
            if (!anchor || !/^[A-Z][A-Z0-9_]*-\d+$/i.test(anchor.epicKey) || !guard(job, attempt)) return [];
            const started = now();
            const outcome = await readCurrent().epicRefresh.refreshEpic(anchor.epicKey, { source: 'automatic', signal: job.anchorSignal,
                shouldApply: () => !job.anchorSignal.aborted && guard(job, attempt), deferFollowUps: true });
            if (!guard(job, attempt) || job.anchorSignal.aborted || !outcome.lanes) return [];
            attempt.changedKeys.push(...(outcome.changedKeys || []), ...(outcome.addedKeys || []), ...(outcome.silentKeys || []));
            return ['product', 'tech'].map(lane => descriptor(`eng_epic_${lane}`, outcome.lanes[lane], started, now));
        },
        async refreshScope(job, anchor) {
            const attempt = getAttempt(job, anchor);
            const started = now();
            const held = readCurrent().epicRefresh.readState();
            attempt.requestSnapshot = new Map([...held.loadedProductTasks, ...held.loadedTechTasks].map(item => [item.key, item]));
            attempt.epicSnapshot = held.epicDetails;
            attempt.scopeSnapshots = Object.fromEntries(['product', 'tech'].map(lane => [lane, new Map((held[`${lane}EpicsInScope`] || []).map(item => [item.key, item]))]));
            const lanes = await readCurrent().collectGroupRefresh(job, { sameScope: () => guard(job, attempt) });
            let bridge, accepted = false;
            const ownerBridge = board ? readCurrent().boardFreshnessRef?.current : null;
            try {
                if (!guard(job, attempt)) return ignoredSources(job);
                bridge = board ? ownerBridge?.beforeCommit?.(null, { state: held,
                    deniedLanes: ['product', 'tech'].filter(lane => lanes[lane]?.status === 'denied' && lanes[lane].projectAccessStatus === 'inaccessible'),
                    acceptedSourceKeys: Object.fromEntries(['product', 'tech'].map(lane => [lane, lanes[lane]?.status === 'ok'
                        ? [...(lanes[lane].items || []), ...(lanes[lane].meta?.epicsInScope || [])].flatMap(item => [item.key, item.fields?.epicKey].filter(Boolean)) : []])) }, () => guard(job, attempt)) : null;
                const changes = readCurrent().epicRefresh.applyScopeSnapshot(job, { ...attempt, lanes, epicKey: anchor?.epicKey, readinessSnapshot: readCurrent().storyReadiness?.snapshot });
                if (!changes) return ignoredSources(job);
                accepted = true;
                await changes.settled;
                if (board) await ownerBridge?.afterCommit?.(bridge, changes);
                if (!guard(job, attempt)) return ignoredSources(job);
                attempt.changedKeys.push(...changes.changedKeys, ...changes.addedKeys, ...changes.silentKeys);
                attempt.fetchedStories = changes.fetchedStories;
                attempt.deniedEpicKeys = new Set([...(attempt.deniedEpicKeys || []), ...(changes.deniedEpicKeys || [])]);
                return ['product', 'tech'].filter(lane => job.pendingSources.includes(`eng_${lane}`)).map(lane => descriptor(`eng_${lane}`, lanes[lane], started, now));
            } finally { if (bridge && !accepted) ownerBridge?.cancelCommit?.(bridge); lanes.release(); }
        },
        async followUp(job) {
            if (board || scenario) return [];
            const attempt = attempts.get(job);
            if (!attempt || !guard(job, attempt)) return;
            const input = readCurrent();
            const options = { forceRefresh: true, automatic: true, signal: job.signal, shouldApplyResult: () => guard(job, attempt) };
            // These owners hold failed replacement lanes; no nonce re-arms an unrelated effect.
            if (planning && input.planningLayout === 'table') {
                await input.planningReview.refresh({ automatic: true, signal: job.signal, shouldApply: () => guard(job, attempt) });
                if (guard(job, attempt)) await readCurrent().refreshCapacity({ signal: job.signal, shouldApply: () => guard(job, attempt) });
                return [];
            }
            if (!planning) await Promise.all([input.loadAlertEpics(options), input.fetchMissingPlanningInfo(input.selectedSprint, options),
                input.loadReadyToCloseProductTasks(options), input.loadReadyToCloseTechTasks(options)]);
            if (!guard(job, attempt)) return;
            if (attempt.anchor && !attempt.deniedEpicKeys?.has(attempt.anchor.epicKey) && /^[A-Z][A-Z0-9_]*-\d+$/i.test(attempt.anchor.epicKey)) {
                const readiness = await readCurrent().storyReadiness.loadEpic(attempt.anchor.epicKey, { signal: job.signal });
                try {
                    if (readiness.status === 'ok' && guard(job, attempt)) readCurrent().storyReadiness.mergeEpic(attempt.anchor.epicKey, readiness.payload,
                        { epicDetails: readCurrent().epicRefresh.readState().epicDetails[attempt.anchor.epicKey], readToken: readiness.readToken });
                } finally { readiness.release?.(); }
            }
            if (!guard(job, attempt)) return;
            const keys = [...new Set(attempt.changedKeys)].filter(Boolean);
            if (keys.length && (input.showDependencies || input.showBlockedAlert)) {
                const token = input.issueEditState.beginRead({ aggregate: true });
                try {
                    const response = await requestDependencies(input.backendUrl, keys, { signal: job.signal, refresh: true });
                    if (!response.ok) return;
                    const payload = await response.json();
                    if (guard(job, attempt) && input.issueEditState.isCurrentAggregateRead(token)) readCurrent().setDependencyData(prev => ({ ...prev, ...(payload.dependencies || {}) }));
                } catch (error) { if (isAuthenticationRequiredError(error)) throw error; }
                finally { input.issueEditState.finishRead(token); }
            }
            if (guard(job, attempt)) await readCurrent().invalidateStorySubtasks(keys, { job: { ...job, shouldApply: () => guard(job, attempt) },
                anchorKeys: new Set(attempt.fetchedStories.filter(item => item.fields?.epicKey === attempt.anchor?.epicKey).map(item => item.key)) });
        },
    };
}

export function createScenarioFreshnessAdapter(readCurrent) {
    return createCatchUpFreshnessAdapter(readCurrent, { scenario: true });
}

const deferredReadRegistries = new WeakMap();

// `stableOwner` outlives per-render adapter instances so deferred reads registered on one instance stay visible to the next.
export function createPlanningFreshnessAdapter(readCurrent, stableOwner = {}) {
    const primary = createCatchUpFreshnessAdapter(readCurrent, { planning: true });
    const holds = new WeakMap();
    if (!deferredReadRegistries.has(stableOwner)) deferredReadRegistries.set(stableOwner, new Map());
    const deferredReads = deferredReadRegistries.get(stableOwner);
    const hold = job => {
        if (holds.has(job)) return holds.get(job);
        const input = readCurrent(), capacity = input.capacityScopeHoldRef, review = input.planningAutomaticReadRef;
        if (capacity) capacity.current += 1;
        if (review) review.current += 1;
        let released = false;
        const release = () => { if (released) return; released = true; if (capacity) capacity.current -= 1; if (review) review.current -= 1; };
        const resume = () => { const owner = input.planningReview; if (owner?.resumeDeferredRead) deferredReads.set(owner.resumeDeferredRead, { owner, contextKey: job.contextKey }); };
        const retire = () => { release(); resume(); };
        const finish = (deferred = false) => { release(); job.signal.removeEventListener('abort', retire); if (deferred || !job.shouldApply()) resume(); else deferredReads.delete(input.planningReview?.resumeDeferredRead); };
        const entry = { release, finish };
        holds.set(job, entry); job.signal.addEventListener('abort', retire, { once: true });
        if (job.signal.aborted) retire();
        return entry;
    };
    return { ...primary,
        hasDeferredReads(contextKey) {
            for (const [key, entry] of deferredReads) if (entry.contextKey !== contextKey) deferredReads.delete(key);
            return deferredReads.size > 0;
        },
        async resumeDeferredReads(job) {
            for (const [key, entry] of deferredReads) {
                if (!job.shouldApply()) return;
                deferredReads.delete(key);
                if (entry.contextKey !== job.contextKey) continue;
                await entry.owner.resumeDeferredRead({ signal: job.signal, shouldApply: job.shouldApply });
                if (!job.shouldApply()) deferredReads.set(key, entry);
            }
        },
        async refreshAnchor(job, anchor) { const entry = hold(job); try { return await primary.refreshAnchor(job, anchor); } catch (error) { if (!job.shouldApply()) entry.finish(true); throw error; } },
        async refreshScope(job, anchor) {
            const entry = hold(job);
            try { const checks = await primary.refreshScope(job, anchor); if (!checks.some(check => check.status === 'ok')) entry.finish(true); return checks; }
            catch (error) { entry.finish(true); throw error; }
            finally { entry.release(); }
        },
        async followUp(job) { try { return await primary.followUp(job); } finally { holds.get(job)?.finish(); } },
    };
}

export function statsFreshnessSources(view) {
    if (view === 'cohort') return ['stats_cohort'];
    if (['excludedCapacity', 'monoCrossShare', 'projectTrack'].includes(view)) return ['stats_excluded_capacity'];
    return ['eng_product', 'eng_tech', ...(view === 'burnout' ? ['stats_burnout'] : [])];
}

export function createStatsFreshnessAdapter(readCurrent, primary) {
    return { sources: () => statsFreshnessSources(readCurrent().statsView), captureAnchor: () => null,
        refreshAnchor: async () => [], followUp: async () => [],
        async refreshScope(job) {
            const input = readCurrent(), ref = input.automaticRefreshRef;
            // Hold effect-driven Burnout reads while the ENG snapshot is being accepted.
            const hold = { job, source: null, settle: () => {} };
            ref.current = hold;
            try {
                const checks = job.pendingSources.some(source => source.startsWith('eng_')) ? await primary.refreshScope(job, null) : [];
                const source = statsFreshnessSources(readCurrent().statsView).find(value => value.startsWith('stats_') && job.pendingSources.includes(value));
                if (!source || !job.shouldApply()) return checks;
                const outcome = await new Promise((resolve, reject) => {
                    let settled = false;
                    const settle = (value, error) => { if (settled) return; settled = true; job.signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
                    const abort = () => settle([]);
                    ref.current = { job, source, settle };
                    job.signal.addEventListener('abort', abort, { once: true });
                    if (job.signal.aborted) abort(); else readCurrent().startStatsRefresh(source);
                });
                return [...checks, ...outcome];
            } finally { if (ref.current?.job === job) ref.current = null; }
        } };
}

export function createEpmFreshnessAdapter(readCurrent) {
    return { sources: () => ['epm_projects', 'epm_rollup'], captureAnchor: () => readCurrent().captureEpmAnchor?.() || null,
        refreshAnchor: async () => [], followUp: async () => [],
        async refreshScope(job, anchor) {
            if (!job.shouldApply()) return [];
            const checks = await readCurrent().refreshEpmView({ job, issueEditState: readCurrent().issueEditState, beforeCommit: readCurrent().beforeEpmCommit });
            if (job.shouldApply() && checks.some(check => check.status === 'ok')) await readCurrent().restoreEpmAnchor?.(job, anchor);
            return checks;
        } };
}

export function createDashboardFreshnessOwners(freshness, inputs) {
    const readCurrent = () => freshness.ownersRef.current.inputs;
    freshness.automaticRefreshRef.createExplicitRecorder = source => {
        const marker = freshness.automaticRefreshRef.explicitMarker;
        if (!marker || marker.source !== source || marker.contextKey !== readFreshnessEnvironment(readCurrent()).contextKey) return null;
        const retire = () => { if (freshness.automaticRefreshRef.explicitMarker === marker) freshness.automaticRefreshRef.explicitMarker = null; };
        const record = (payload, requestStartedAtMs, coverage = 'unknown') => {
            if (freshness.automaticRefreshRef.explicitMarker !== marker || marker.contextKey !== readFreshnessEnvironment(readCurrent()).contextKey || readCurrent().terminalAuth) return;
            freshness.acceptChecks({ contextKey: marker.contextKey, checks: [{ source, status: 'ok', requestStartedAtMs, coverage,
                checkKind: source === 'stats_burnout' ? 'unknown' : payload.cached === true ? 'cached' : payload.cached === false ? 'forced' : 'unknown' }] });
            retire();
        };
        record.retire = retire;
        return record;
    };
    const adapter = createCatchUpFreshnessAdapter(readCurrent);
    const planning = createPlanningFreshnessAdapter(readCurrent, freshness.automaticRefreshRef), scenario = createScenarioFreshnessAdapter(readCurrent);
    const board = createCatchUpFreshnessAdapter(readCurrent, { board: true });
    const stats = createStatsFreshnessAdapter(readCurrent, board), epm = createEpmFreshnessAdapter(readCurrent);
    const strict = { sources: () => ['eng_board'], captureAnchor: () => null, refreshAnchor: async () => [], followUp: async () => [],
        async refreshScope(job) {
            const started = Date.now();
            if (!job.shouldApply()) return [];
            const outcome = await readCurrent().strictBoard.refresh({ source: 'automatic', signal: job.signal, shouldApply: job.shouldApply });
            if (outcome === 'auth_locked') throw new AuthenticationRequiredError();
            if (!job.shouldApply()) return [];
            return [{ source: 'eng_board', status: outcome === 'success' ? 'ok' : outcome === 'ignored' ? 'ignored' : outcome === 'denied' ? 'denied' : 'failed',
                checkKind: 'forced', coverage: outcome === 'success' ? 'complete' : 'unknown', requestStartedAtMs: started }];
        } }; 
    for (const owner of [adapter, planning, scenario, board, strict, stats, epm]) {
        const followUp = owner.followUp;
        owner.followUp = async job => {
            const result = await followUp(job);
            if (job.shouldApply()) await readCurrent().refreshDueSprintCatalog?.(job);
            return result;
        };
    }
    return { inputs, readEnvironment: () => readFreshnessEnvironment(readCurrent()), resolveFreshnessSurface: () => resolveFreshnessSurface(readCurrent()),
        readAdapter: surface => ({ catch_up: adapter, planning, scenario, board, strict_board: strict, stats, epm })[surface] || null,
        recordManualEpicRefresh(result) {
            const contextKey = readFreshnessEnvironment(readCurrent()).contextKey;
            void result.then(outcome => {
                if (['discarded', 'blocked'].includes(outcome.result) || !outcome.lanes) return;
                const checks = ['product', 'tech'].filter(lane => outcome.lanes[lane]?.status === 'ok').map(lane => ({
                    source: `eng_epic_${lane}`, status: 'ok', checkKind: 'forced', requestStartedAtMs: outcome.requestStartedAtMs,
                    coverage: outcome.lanes[lane].meta?.capped || outcome.lanes[lane].meta?.epicKeysMissing?.length ? 'partial' : 'unknown' }));
                freshness.acceptChecks({ contextKey, checks });
            }).catch(() => {});
        },
        recordExplicitRefresh(surface, result) {
            readCurrent().boardFreshnessRef?.current.release?.();
            if (surface === 'stats') {
                const source = statsFreshnessSources(readCurrent().statsView).find(value => value.startsWith('stats_'));
                if (source) freshness.automaticRefreshRef.explicitMarker = { source, contextKey: readFreshnessEnvironment(readCurrent()).contextKey };
                if (result?.statsSource) return;
            }
            if (surface === 'epm' && result?.then) {
                const contextKey = readFreshnessEnvironment(readCurrent()).contextKey;
                void result.then(checks => { if (Array.isArray(checks)) freshness.acceptChecks({ contextKey, checks }); }).catch(() => {});
                return;
            }
            if (surface === 'strict_board' && result?.then) {
                const started = Date.now(), contextKey = readFreshnessEnvironment(readCurrent()).contextKey;
                void result.then(outcome => { if (outcome === 'success') freshness.acceptChecks({ contextKey, checks: [{ source: 'eng_board', status: 'ok', checkKind: 'forced', coverage: 'complete', requestStartedAtMs: started }] }); }).catch(() => {});
                return;
            }
            for (const [key, source] of [['review', 'planning_review'], ['capacity', 'planning_capacity']]) if (surface === 'planning' && result?.[key]?.then) {
                const started = Date.now(), contextKey = readFreshnessEnvironment(readCurrent()).contextKey;
                void result[key].then(outcome => { if (outcome === true || outcome?.status === 'ok') freshness.acceptChecks({ contextKey, checks: [{ source, status: 'ok', checkKind: 'forced', coverage: 'unknown', requestStartedAtMs: started }] }); }).catch(() => {});
            }
            // A catalog/configuration Promise is not evidence of a dispatched ENG lane.
            if ((!['catch_up', 'planning', 'scenario', 'board', 'stats'].includes(surface) || (surface === 'stats' && !statsFreshnessSources(readCurrent().statsView).includes('eng_product'))) || !result?.product?.then || !result?.tech?.then || !('primaryReady' in result)) return;
            const started = Date.now();
            const contextKey = readFreshnessEnvironment(readCurrent()).contextKey;
            for (const lane of ['product', 'tech']) void result[lane].then(outcome => {
                if (outcome === 'applied') freshness.acceptChecks({ contextKey, checks: [{ source: `eng_${lane}`, status: 'ok', checkKind: 'forced', coverage: 'unknown', requestStartedAtMs: started }] });
            }).catch(() => {});
        } };
}
