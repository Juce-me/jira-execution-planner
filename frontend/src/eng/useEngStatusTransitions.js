import * as React from 'react';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from '../api/authRequired.js';
import { fetchIssueTransitionOptions, transitionIssues } from '../api/jiraIssueApi.js';
import { enqueueEngIssueMutation, enqueueEngIssueMutations } from './engIssueMutationQueue.js';
import {
    buildCatchUpStatusTargets,
    buildStatusActionAnalyticsParams,
    resolveSubtaskParentStoryKeys,
    summarizeTransitionResults,
} from './engStatusTransitionUtils.js';

const EMPTY_OPTIONS_REQUEST = { controller: null, signature: '' };

// Module-level cache shared by every hook instance/mount, so switching sprints, groups, or
// which Story/Epic/Subtask menu is open no longer forces a refetch for a target signature
// already seen this app session. Keyed by project/issue-type/current-status tuples so
// different issues that share a tuple reuse one fetch (degenerate context-less elements
// fall back to a per-issue-key signature; see transitionOptionCacheKey); invalidated
// per-tuple after a successful transition (see submitStatusTransition) instead of
// wholesale on scope changes.
const transitionOptionsCache = new Map();

// Option fetches started speculatively when a mouse rests on a status pill, so the click that
// follows finds them cached or already on the wire. Keyed by the same signature as the
// cache; capped because a pointer sweeping across a long list must not fan out Jira calls.
const MAX_PREFETCH_IN_FLIGHT = 2;
const transitionOptionsPrefetches = new Map();
// Signatures a prefetch filled that no menu open has consumed yet: the first open of one still
// reports status_options_open, as it would have had the open itself fetched the options.
const transitionOptionsPrefetched = new Set();

// Per-issue-key signature for degenerate elements: raw key strings, or targets carrying
// neither issueType nor currentStatus (e.g. submit's explicit-key fallback shape).
// Distinct from every project|type|status tuple, so a context-less element can never
// collapse into a shared "PREFIX||"/"||" bucket with other issues, and the
// success-invalidation below can re-derive it from the issue key alone.
function transitionOptionKeySignature(keyValue) {
    return `key:${String(keyValue || '').trim()}`;
}

// Exported for direct unit coverage of the cache-signature contract
// (tests/test_planning_action_source_guards.js).
export function transitionOptionCacheKey(targets) {
    return targets
        .map(target => {
            if (!target?.issueType && !target?.currentStatus) {
                // No workflow context: the tuple below would degenerate to a shared
                // "PREFIX||" (or "||" for raw strings) bucket across distinct issues
                // and serve cross-issue-stale options; key by the issue key instead.
                return transitionOptionKeySignature(target?.key || target);
            }
            return [
                target.projectKey || String(target.key || '').split('-')[0],
                target.issueType || '',
                target.currentStatus || '',
            ].join('|');
        })
        .sort()
        .join(',');
}

// Passive warm-up for a status pill the user is about to open. Skips cached, already-fetching and
// over-cap targets and never touches React state or analytics. A failure is swallowed and not
// cached, so an open after it retries; an open that joins the request while it is still on the
// wire shares its outcome, error included, instead of sending a second request.
export function prefetchTransitionOptions(backendUrl, targets) {
    const list = Array.isArray(targets) ? targets : [];
    const keys = Array.from(new Set(list.map((t) => String(t?.key || t || '').trim()).filter(Boolean))).sort();
    const signature = transitionOptionCacheKey(list);
    if (!keys.length
        || transitionOptionsCache.has(signature)
        || transitionOptionsPrefetches.has(signature)
        || transitionOptionsPrefetches.size >= MAX_PREFETCH_IN_FLIGHT
        || readPendingAuthenticationRequired()) {
        return null;
    }
    const request = fetchIssueTransitionOptions(backendUrl, keys).then((response) => {
        transitionOptionsCache.set(signature, response);
        transitionOptionsPrefetched.add(signature);
        return response;
    });
    transitionOptionsPrefetches.set(signature, request);
    return request.catch(() => null).finally(() => transitionOptionsPrefetches.delete(signature));
}

// Test/auth-recovery escape hatch mirroring clearPriorityOptionsCache in
// useEngPriorityTransitions.js.
export function clearTransitionOptionsCache() {
    transitionOptionsCache.clear();
    transitionOptionsPrefetched.clear();
}

// React state for ENG single-issue status changes (every Story, Epic and Subtask pill on Catch
// Up, Planning and Board), option loading, mutation submission, auth recovery, and result
// state. A submit always acts on one explicit issue key; the Planning selection
// (`selectedStories`) feeds analytics only and never widens the write.
export function useEngStatusTransitions({
    backendUrl,
    selectedStories,
    storySubtasksByKey,
    selectedSprint,
    sourceSurface,
    mutationScopeKey = '',
    trackIssueStatusAction,
    onAuthRecoveryRequired,
    onApplyLocalStatus,
    onAlertDataInvalidated,
    onTransitionSuccessRefresh,
    mutationCoordinator = null,
}) {
    const [activeSingleIssueTarget, setActiveSingleIssueTarget] = React.useState(null);
    const [transitionOptions, setTransitionOptions] = React.useState(null);
    const [transitionOptionsLoading, setTransitionOptionsLoading] = React.useState(false);
    const [transitionError, setTransitionError] = React.useState('');
    const [transitionErrorCode, setTransitionErrorCode] = React.useState('');
    const [transitionResult, setTransitionResult] = React.useState(null);
    const [pendingIssueKeys, setPendingIssueKeys] = React.useState(() => new Set());
    const optionsRequestRef = React.useRef(EMPTY_OPTIONS_REQUEST);
    const activeSingleIssueTargetRef = React.useRef(null);
    const mutationScopeRef = React.useRef(mutationScopeKey);
    mutationScopeRef.current = mutationScopeKey;
    const pendingMutationKeysRef = React.useRef(new Set());
    const queuedMutationControllersRef = React.useRef(new Set());

    const abortInFlightOptionsRequest = React.useCallback(() => {
        optionsRequestRef.current.controller?.abort();
        optionsRequestRef.current = EMPTY_OPTIONS_REQUEST;
    }, []);

    // Any open menu/options/result is scoped to one sprint and Catch Up/Planning surface. In-flight writes keep their own scope token so a late
    // response cannot patch a newly selected sprint or group.
    React.useEffect(() => {
        setActiveSingleIssueTarget(null);
        activeSingleIssueTargetRef.current = null;
        abortInFlightOptionsRequest();
        // transitionOptionsCache is module-level and app-session scoped; it is invalidated
        // per-tuple after a successful transition (see submitStatusTransition), not
        // wholesale on every sprint change.
        setTransitionOptions(null);
        setTransitionOptionsLoading(false);
        setTransitionError('');
        setTransitionErrorCode('');
        setTransitionResult(null);
        queuedMutationControllersRef.current.forEach(controller => controller.abort());
        queuedMutationControllersRef.current.clear();
        setPendingIssueKeys(new Set());
        pendingMutationKeysRef.current.clear();
    }, [selectedSprint, sourceSurface, mutationScopeKey, abortInFlightOptionsRequest]);

    // Fetches available transitions for the given targets — an array of full
    // {key, issueType, currentStatus} targets from the target builders (the only shape
    // callers pass today). Raw string keys or type/status-less targets are tolerated
    // defensively and cache under a per-issue-key signature, never a shared tuple.
    // Aborts any in-flight request for a different target signature before starting
    // the new one, and dedupes a repeat call for the same in-flight signature.
    const loadTransitionOptions = React.useCallback(async (targets) => {
        const list = Array.isArray(targets) ? targets : [];
        const keys = Array.from(new Set(list.map((t) => String(t?.key || t || '').trim()).filter(Boolean))).sort();
        const signature = transitionOptionCacheKey(list);

        if (optionsRequestRef.current.controller) {
            if (optionsRequestRef.current.signature === signature) {
                return null;
            }
            optionsRequestRef.current.controller.abort();
            optionsRequestRef.current = EMPTY_OPTIONS_REQUEST;
        }

        if (!keys.length) {
            setTransitionOptions(null);
            setTransitionOptionsLoading(false);
            return null;
        }

        const trackOptionsOpen = () => trackIssueStatusAction('status_options_open', buildStatusActionAnalyticsParams({
            sourceSurface,
            targets: list,
            selectedStories,
        }));

        if (transitionOptionsCache.has(signature)) {
            const cached = transitionOptionsCache.get(signature);
            if (transitionOptionsPrefetched.delete(signature)) trackOptionsOpen();
            setTransitionOptions(cached);
            setTransitionOptionsLoading(false);
            setTransitionError('');
            setTransitionErrorCode('');
            return cached;
        }

        const controller = new AbortController();
        optionsRequestRef.current = { controller, signature };
        setTransitionOptionsLoading(true);
        setTransitionError('');
        setTransitionErrorCode('');
        trackOptionsOpen();

        try {
            // Join a prefetch already on the wire for this signature instead of sending a second
            // request; a failure of that shared request surfaces here like any other options error.
            const prefetched = transitionOptionsPrefetches.get(signature);
            const response = prefetched
                ? await prefetched
                : await fetchIssueTransitionOptions(backendUrl, keys, { signal: controller.signal });
            if (optionsRequestRef.current.controller !== controller) {
                return null; // Superseded by a newer request; drop this stale response.
            }
            transitionOptionsCache.set(signature, response);
            transitionOptionsPrefetched.delete(signature);
            setTransitionOptions(response);
            return response;
        } catch (err) {
            if (err?.name === 'AbortError') {
                return null;
            }
            if (isAuthenticationRequiredError(err)) return null;
            if (optionsRequestRef.current.controller !== controller) {
                return null; // Superseded; do not surface a stale error over a newer request.
            }
            setTransitionError(err?.message || 'Failed to load status options.');
            setTransitionErrorCode(err?.code || '');
            return null;
        } finally {
            if (optionsRequestRef.current.controller === controller) {
                setTransitionOptionsLoading(false);
            }
        }
    }, [backendUrl, sourceSurface, selectedStories, trackIssueStatusAction, onAuthRecoveryRequired]);

    const openSingleIssueStatusControl = React.useCallback((issue, fallbackIssueType) => {
        const target = buildCatchUpStatusTargets(issue, fallbackIssueType);
        if (!target) return;
        setTransitionResult(null);
        setActiveSingleIssueTarget(target);
        activeSingleIssueTargetRef.current = target;
        void loadTransitionOptions([target]);
    }, [loadTransitionOptions]);

    const prefetchSingleIssueStatusOptions = React.useCallback((issue, fallbackIssueType) => {
        const target = buildCatchUpStatusTargets(issue, fallbackIssueType);
        if (!target || optionsRequestRef.current.signature === transitionOptionCacheKey([target])) return;
        void prefetchTransitionOptions(backendUrl, [target]);
    }, [backendUrl]);

    const closeSingleIssueStatusControl = React.useCallback(() => {
        setActiveSingleIssueTarget(null);
        activeSingleIssueTargetRef.current = null;
        abortInFlightOptionsRequest();
        setTransitionOptions(null);
        setTransitionOptionsLoading(false);
        setTransitionError('');
        setTransitionErrorCode('');
    }, [abortInFlightOptionsRequest]);

    // Every surface passes one explicit target key; with no key nothing is written, so a pill
    // can never fall back to the Planning selection.
    const submitStatusTransition = React.useCallback(async (targetStatus, explicitTargetKey) => {
        const status = String(targetStatus || '').trim();
        if (!status) return null;

        const explicitKey = String(explicitTargetKey || '').trim();
        if (!explicitKey) return null;
        const targets = [
            activeSingleIssueTarget && activeSingleIssueTarget.key === explicitKey
                ? activeSingleIssueTarget
                : { key: explicitKey, issueType: '', currentStatus: '', summary: '' }
        ];

        const analyticsBaseParams = buildStatusActionAnalyticsParams({
            sourceSurface,
            targets,
            selectedStories,
            status,
        });

        trackIssueStatusAction('status_change_submit', analyticsBaseParams);
        setTransitionError('');
        setTransitionErrorCode('');

        // One explicit issue on every surface: take the optimistic local patch + per-key pending
        // set rather than a full scope refetch. On Board a dragged card waiting for a refetch
        // reads as a failed drop, and a board-local patch would be the parallel write path §9.5
        // forbids.
        const singleIssueTarget = targets[0];
        const singleIssueKey = singleIssueTarget.key;
        if (pendingMutationKeysRef.current.has(singleIssueKey)) return null;
        const mutationScope = mutationScopeKey;
        pendingMutationKeysRef.current.add(singleIssueKey);
        onApplyLocalStatus?.(singleIssueKey, status);
        setPendingIssueKeys((prev) => new Set(prev).add(singleIssueKey));

        let queueController = null;
        try {
            queueController = new AbortController();
            queuedMutationControllersRef.current.add(queueController);
            const runMutation = () => transitionIssues(backendUrl, {
                issueKeys: targets.map((target) => target.key),
                targetStatus: status,
            });
            const runQueuedMutation = async () => await enqueueEngIssueMutations(
                targets.map(target => target.key),
                runMutation,
                {
                    signal: queueController.signal,
                    shouldStart: () => mutationScopeRef.current === mutationScope && !readPendingAuthenticationRequired(),
                },
            );
            // Keep strict Board's coordinator as the outer transaction owner so its refresh
            // completes before the next Board mutation. The fallback remains named here for
            // the established coordinator contract, but non-Board writes call the multi-key
            // queue directly and therefore never double-reserve a key.
            const enqueueCoordinatedMutation = mutationCoordinator?.enqueue || enqueueEngIssueMutation;
            const response = await (sourceSurface !== 'planning' && mutationCoordinator
                ? enqueueCoordinatedMutation(singleIssueKey, runQueuedMutation)
                : runQueuedMutation());
            const summary = summarizeTransitionResults(response?.results);
            const isCurrentMutation = mutationScopeRef.current === mutationScope;
            if (isCurrentMutation && activeSingleIssueTargetRef.current?.key === singleIssueKey) {
                setTransitionResult({ ...summary, targetStatus: status });
            }
            trackIssueStatusAction('status_change_result', { ...analyticsBaseParams, result: summary.result });
            const issueResult = (response?.results || []).find(entry => entry?.key === singleIssueKey);
            const succeeded = issueResult?.result === 'success' || issueResult?.result === 'already_in_status';
            if (isCurrentMutation) {
                onApplyLocalStatus?.(
                    singleIssueKey,
                    succeeded
                        ? (issueResult?.toStatus || response?.targetStatus || status)
                        : (issueResult?.currentStatus || singleIssueTarget.currentStatus || ''),
                );
            }
            if (summary.succeeded > 0) {
                // Report which stories had a subtask succeed so the caller can refresh
                // only those expanded subtask rows (not a full reload). Raw keys stay
                // local here; they never reach an analytics payload.
                const succeededKeys = (response?.results || [])
                    .filter((entry) => entry?.result === 'success' || entry?.result === 'already_in_status')
                    .map((entry) => entry?.key)
                    .filter(Boolean);
                // Invalidate cached options responses that involved one of the
                // project/issueType/old-status tuples that just changed status, including
                // batch entries that combined a succeeded target with other still-unchanged
                // targets. Uses the pre-transition targets' currentStatus (unchanged by the
                // mutation response) via the same tuple derivation as transitionOptionCacheKey.
                const succeededKeySet = new Set(succeededKeys);
                const succeededTargets = targets.filter((target) => succeededKeySet.has(target.key));
                if (succeededTargets.some((target) => !target.issueType && !target.currentStatus)) {
                    // Submit's explicit-key fallback target carries only an issue key, so
                    // the tuple entries that covered that issue (cached by the open path
                    // under its real project|type|status) cannot be identified here. Clear
                    // the whole cache on this rare recovery path rather than risk serving
                    // stale options (worst case: one extra options refetch per menu open).
                    clearTransitionOptionsCache();
                } else if (succeededTargets.length) {
                    const affectedTuples = new Set();
                    succeededTargets.forEach((target) => {
                        affectedTuples.add(transitionOptionCacheKey([target]));
                        // Also drop any degenerate per-key entry cached for this issue by
                        // a raw-key/context-less options load.
                        affectedTuples.add(transitionOptionKeySignature(target.key));
                    });
                    for (const cacheKey of transitionOptionsCache.keys()) {
                        if (cacheKey.split(',').some((tuple) => affectedTuples.has(tuple))) {
                            transitionOptionsCache.delete(cacheKey);
                        }
                    }
                }
                const affectedSubtaskStoryKeys = resolveSubtaskParentStoryKeys(succeededKeys, storySubtasksByKey);
                if (isCurrentMutation) onAlertDataInvalidated?.({ keys: (response?.results || []).filter((entry) => entry?.result === 'success').map((entry) => entry?.key).filter(Boolean) });
                if (sourceSurface === 'board') {
                    await onTransitionSuccessRefresh?.({ affectedSubtaskStoryKeys });
                }
            }
            return response;
        } catch (err) {
            if (err?.name === 'AbortError') return null;
            if (isAuthenticationRequiredError(err)) return null;
            if (mutationScopeRef.current === mutationScope) {
                onApplyLocalStatus?.(singleIssueKey, singleIssueTarget.currentStatus || '');
            }
            if (mutationScopeRef.current === mutationScope && activeSingleIssueTargetRef.current?.key === singleIssueKey) {
                setTransitionError(err?.message || 'Failed to change status.');
                setTransitionErrorCode(err?.code || '');
            }
            trackIssueStatusAction('status_change_result', { ...analyticsBaseParams, result: 'failure' });
            return null;
        } finally {
            mutationCoordinator?.complete();
            if (queueController) queuedMutationControllersRef.current.delete(queueController);
            if (mutationScopeRef.current === mutationScope) {
                pendingMutationKeysRef.current.delete(singleIssueKey);
                setPendingIssueKeys((prev) => {
                    const next = new Set(prev);
                    next.delete(singleIssueKey);
                    return next;
                });
            }
        }
    }, [
        sourceSurface,
        activeSingleIssueTarget,
        selectedStories,
        storySubtasksByKey,
        mutationScopeKey,
        trackIssueStatusAction,
        backendUrl,
        onApplyLocalStatus,
        onAlertDataInvalidated,
        onTransitionSuccessRefresh,
        onAuthRecoveryRequired,
        mutationCoordinator,
    ]);

    return {
        sourceSurface,
        activeSingleIssueTarget,
        openSingleIssueStatusControl,
        prefetchSingleIssueStatusOptions,
        closeSingleIssueStatusControl,
        transitionOptions,
        transitionOptionsLoading,
        transitionError,
        transitionErrorCode,
        transitionResult,
        pendingIssueKeys,
        loadTransitionOptions,
        submitStatusTransition,
    };
}
