import * as React from 'react';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from '../api/authRequired.js';
import { fetchIssuePriorityOptions, updateIssuePriorities } from '../api/jiraIssueApi.js';
import { enqueueEngIssueMutations } from './engIssueMutationQueue.js';
import { createEngIssueEditState } from './engIssueEditState.js';
import { UNCONFIRMED_WRITE_MESSAGE, classifyWriteError, findIssueResult } from './engStatusTransitionUtils.js';
import {
    buildCatchUpPriorityTargets,
    buildPriorityActionAnalyticsParams,
    classifyPriorityResult,
    priorityOptionCacheKey,
    summarizePriorityTransitionResults,
} from './engPriorityTransitionUtils.js';


// Per-project/issue-type priority scheme cache, shared by every hook instance/mount so
// switching sprints, groups, or which icon is open never refetches a scheme already seen this
// app session. Keyed by priorityOptionCacheKey (project|issueType). Only successful NON-EMPTY
// schemes are cached, so an uneditable issue's empty result never poisons the tuple for a
// different editable issue of the same project/type. priorityOptionsPromises dedups concurrent
// opens of one tuple; its in-flight entry is dropped on settle so a failed fetch is retried on
// the next open. Cleared wholesale only via clearPriorityOptionsCache (auth recovery / hard
// refresh / stale-catalog).
const priorityOptionsCache = new Map();
const priorityOptionsPromises = new Map();

export function clearPriorityOptionsCache() {
    priorityOptionsCache.clear();
    priorityOptionsPromises.clear();
}

// Loads (and per-tuple dedups/caches) the priority scheme for one cache key. `fetchOptions` is
// injectable for tests; production passes the real fetchIssuePriorityOptions with the issue's
// key so the backend filters the catalog to that issue's scheme via editmeta. Only a non-empty
// result is cached (see above). Exported for direct behavioral coverage of the cache contract.
export function loadPriorityOptionsForTuple(cacheKey, issueKey, backendUrl, fetchOptions = fetchIssuePriorityOptions) {
    if (priorityOptionsCache.has(cacheKey)) return Promise.resolve(priorityOptionsCache.get(cacheKey));
    if (priorityOptionsPromises.has(cacheKey)) return priorityOptionsPromises.get(cacheKey);
    const promise = Promise.resolve()
        .then(() => fetchOptions(backendUrl, { issueKey }))
        .then((payload) => {
            if (payload && Array.isArray(payload.priorities) && payload.priorities.length > 0) {
                priorityOptionsCache.set(cacheKey, payload);
            }
            return payload;
        })
        .finally(() => {
            priorityOptionsPromises.delete(cacheKey);
        });
    priorityOptionsPromises.set(cacheKey, promise);
    return promise;
}

// React state for ENG Catch Up/Planning Story card and Epic header priority changes: active
// target, once-per-project/issue-type priority scheme loading, mutation submission, auth
// recovery, and result state. Mirrors useEngStatusTransitions.js's single-issue control
// shape; unlike status there is no Epic/Subtask batch selection surface here. The priority
// scheme fetch is module-shared (loadPriorityOptionsForTuple), so this hook never creates an
// AbortController for it — aborting would cancel a fetch other hook instances may also be
// waiting on. A local staleness token instead guards against setting state after this
// particular open() call has been superseded or the menu closed.
export function useEngPriorityTransitions({
    backendUrl,
    selectedSprint,
    sourceSurface,
    mutationScopeKey = '',
    trackIssuePriorityAction,
    onAuthRecoveryRequired,
    onApplyLocalPriority,
    onAlertDataInvalidated,
    onPrioritySuccessRefresh,
    mutationCoordinator = null,
    issueEditState = null,
}) {
    const [activePriorityTarget, setActivePriorityTarget] = React.useState(null);
    const [priorityOptions, setPriorityOptions] = React.useState(null);
    const [priorityOptionsLoading, setPriorityOptionsLoading] = React.useState(false);
    const [priorityError, setPriorityError] = React.useState('');
    const [priorityErrorCode, setPriorityErrorCode] = React.useState('');
    const [priorityResult, setPriorityResult] = React.useState(null);
    const [pendingIssueKeys, setPendingIssueKeys] = React.useState(() => new Set());
    const requestTokenRef = React.useRef(null);
    const activePriorityTargetRef = React.useRef(null);
    const mutationScopeRef = React.useRef(mutationScopeKey);
    mutationScopeRef.current = mutationScopeKey;
    const pendingMutationKeysRef = React.useRef(new Set());
    const queuedMutationControllersRef = React.useRef(new Set());
    // Reservations, overlays, bases and locks live in the shared edit state (App passes it so Catch Up,
    // Planning and Board see the same open edits); a private one keeps the hook usable on its own.
    const fallbackEditStateRef = React.useRef(null);
    if (!issueEditState && !fallbackEditStateRef.current) fallbackEditStateRef.current = createEngIssueEditState();
    const editState = issueEditState || fallbackEditStateRef.current;
    // Counts scope changes, so a response that arrives after A -> B -> A can never revive the feedback
    // (menus, banners, result area) of the earlier visit. Value settlement is by issue key instead.
    const scopeVisitRef = React.useRef(0);

    // Active target, in-flight fetch tracking, and result/error state are scoped to one
    // sprint and Catch Up/Planning surface; the priority catalog cache itself is app-session
    // scoped and survives sprint changes. In-flight writes keep their own scope token so a
    // late response cannot patch a newly selected sprint or group.
    React.useEffect(() => {
        scopeVisitRef.current += 1;
        setActivePriorityTarget(null);
        activePriorityTargetRef.current = null;
        requestTokenRef.current = null;
        setPriorityOptions(null);
        setPriorityOptionsLoading(false);
        setPriorityError('');
        setPriorityErrorCode('');
        setPriorityResult(null);
        queuedMutationControllersRef.current.forEach(controller => controller.abort());
        queuedMutationControllersRef.current.clear();
        setPendingIssueKeys(new Set());
        pendingMutationKeysRef.current.clear();
    }, [selectedSprint, sourceSurface, mutationScopeKey]);

    const closePriorityControl = React.useCallback(() => {
        setActivePriorityTarget(null);
        activePriorityTargetRef.current = null;
        requestTokenRef.current = null;
        setPriorityOptionsLoading(false);
        setPriorityError('');
        setPriorityErrorCode('');
    }, []);

    const openPriorityControl = React.useCallback((issue, fallbackIssueType) => {
        const target = buildCatchUpPriorityTargets(issue, fallbackIssueType);
        if (!target) return;
        setPriorityResult(null);
        setActivePriorityTarget(target);
        activePriorityTargetRef.current = target;
        setPriorityError('');
        setPriorityErrorCode('');

        const cacheKey = priorityOptionCacheKey(target);
        if (priorityOptionsCache.has(cacheKey)) {
            requestTokenRef.current = null;
            setPriorityOptions(priorityOptionsCache.get(cacheKey));
            setPriorityOptionsLoading(false);
            return;
        }

        const token = {};
        requestTokenRef.current = token;
        setPriorityOptions(null);
        setPriorityOptionsLoading(true);
        trackIssuePriorityAction('priority_options_open', buildPriorityActionAnalyticsParams({
            sourceSurface,
            targets: [target],
        }));

        loadPriorityOptionsForTuple(cacheKey, target.key, backendUrl)
            .then((payload) => {
                if (requestTokenRef.current !== token) return; // Superseded; drop the stale response.
                setPriorityOptions(payload);
            })
            .catch((err) => {
                if (requestTokenRef.current !== token) return; // Superseded; do not surface a stale error.
                if (isAuthenticationRequiredError(err)) return;
                if (err?.code === 'priority_catalog_stale') {
                    clearPriorityOptionsCache();
                }
                setPriorityError(err?.message || 'Failed to load priority options.');
                setPriorityErrorCode(err?.code || '');
            })
            .finally(() => {
                if (requestTokenRef.current === token) {
                    setPriorityOptionsLoading(false);
                    requestTokenRef.current = null;
                }
            });
    }, [backendUrl, sourceSurface, trackIssuePriorityAction, onAuthRecoveryRequired]);

    const submitPriorityChange = React.useCallback(async (priorityId, issueKey) => {
        const targetPriorityId = String(priorityId || '').trim();
        const key = String(issueKey || '').trim();
        if (!targetPriorityId || !key) return null;

        const target = activePriorityTarget && activePriorityTarget.key === key
            ? activePriorityTarget
            : { key, issueType: '', currentPriority: '', summary: '' };
        if (pendingMutationKeysRef.current.has(key)) return null;
        const mutationScope = mutationScopeKey;
        const visit = scopeVisitRef.current;
        const prior = { name: target.currentPriority || '' };
        const selectedPriority = (priorityOptions?.priorities || [])
            .find(option => String(option?.id || '') === targetPriorityId);

        // One open edit per issue/field across every surface. A pending or unconfirmed (locked) edit
        // refuses another one, so a second action can never start from a stale base.
        const token = editState.reservePlanningEdit({
            issueKey: key, field: 'priority', prior, optimistic: selectedPriority || prior, scope: mutationScope,
        });
        if (!token) {
            if (editState.planningPhase(key, 'priority') === 'locked' && activePriorityTargetRef.current?.key === key) {
                setPriorityError(UNCONFIRMED_WRITE_MESSAGE);
                setPriorityErrorCode('write_unconfirmed');
            }
            return null;
        }
        const analyticsBaseParams = buildPriorityActionAnalyticsParams({
            sourceSurface,
            targets: [target],
            priorityId: targetPriorityId,
            // The active menu's shown scheme (the tuple's cached payload) resolves the target
            // priority's rank -> low-cardinality bucket. No raw id/name leaves this builder.
            priorityOptions: priorityOptions?.priorities,
        });
        // The choice is made: the popup has done its job. The new value shows at once and the outcome settles by key, so it closes now
        // (only when it is this issue's popup; a Board drop has none). A locked field above keeps it open to show why.
        if (activePriorityTargetRef.current?.key === key) closePriorityControl();
        const sameVisit = () => scopeVisitRef.current === visit;
        // Feedback state (result, error) is set while no popup is open (the Planning bar reads it) or this issue's popup is, never into another issue's open popup.
        const isCurrentVisit = () => sameVisit() && (!activePriorityTargetRef.current || activePriorityTargetRef.current.key === key);

        setPriorityError('');
        setPriorityErrorCode('');
        pendingMutationKeysRef.current.add(key);
        if (selectedPriority) onApplyLocalPriority?.(key, selectedPriority, { phase: 'optimistic', reveal: sourceSurface === 'planning' });
        setPendingIssueKeys((prev) => new Set(prev).add(key));

        // Applies a settled outcome to the issue by KEY, whichever scope is mounted now: a confirmed value
        // is published everywhere, a rejection returns to the base only where the optimistic value still
        // shows, and an unconfirmed edit shows its prior as a provisional value behind a lock.
        const settle = (outcome, value) => {
            if (outcome === 'confirmed') {
                editState.settlePlanningConfirmed(token, value);
                onApplyLocalPriority?.(key, value, { phase: 'confirmed', reorder: sourceSurface === 'planning', reveal: sourceSurface === 'planning' });
            } else if (outcome === 'rejected') {
                const settled = editState.settlePlanningRejected(token);
                if (settled) onApplyLocalPriority?.(key, settled.base ?? prior, { phase: 'rejected', expected: settled.optimistic });
            } else if (editState.settlePlanningUnconfirmed(token)) {
                onApplyLocalPriority?.(key, prior, { phase: 'provisional', expected: selectedPriority || prior });
            }
        };

        let queueController = null;
        let started = false;
        try {
            queueController = new AbortController();
            queuedMutationControllersRef.current.add(queueController);
            const runMutation = () => {
                started = true;
                trackIssuePriorityAction('priority_change_submit', analyticsBaseParams);
                return updateIssuePriorities(backendUrl, {
                    issueKeys: [key],
                    targetPriorityId,
                });
            };
            const runQueuedMutation = async () => await enqueueEngIssueMutations([key], runMutation, {
                signal: queueController.signal,
                shouldStart: () => mutationScopeRef.current === mutationScope && !readPendingAuthenticationRequired(),
            });
            const response = await (sourceSurface !== 'planning' && mutationCoordinator
                ? mutationCoordinator.enqueue(key, runQueuedMutation)
                : runQueuedMutation());
            const summary = summarizePriorityTransitionResults(response?.results);
            const classified = classifyPriorityResult(response, key, {
                requestedPriorityId: targetPriorityId,
                selectedPriority,
                staleAlreadyIn: editState.hasUnevidencedPlanningWrite(key, 'priority'),
            });
            settle(classified.outcome, classified.value);
            const current = isCurrentVisit();
            if (current && classified.outcome !== 'unconfirmed') setPriorityResult({ ...summary, targetPriorityId });
            if (current && classified.outcome === 'unconfirmed') {
                setPriorityError(UNCONFIRMED_WRITE_MESSAGE);
                setPriorityErrorCode('write_unconfirmed');
            }
            trackIssuePriorityAction('priority_change_result', {
                ...analyticsBaseParams,
                result: classified.outcome === 'confirmed' ? 'success' : classified.outcome === 'rejected' ? 'failure' : 'unknown',
            });
            if (sameVisit() && findIssueResult(response, key).entry?.result === 'success') onAlertDataInvalidated?.({ keys: [key] });
            if (classified.outcome === 'confirmed' && sourceSurface === 'board') {
                await onPrioritySuccessRefresh?.({ affectedSubtaskStoryKeys: [] });
            }
            return response;
        } catch (err) {
            // A terminal 401 (including the auth lock that aborts queued jobs) abandons the edit: no
            // rollback, no lock, no cache write, no replay. The projection stays frozen until the page
            // navigates, so the selection cannot be pruned for an optimistic value.
            if (isAuthenticationRequiredError(err) || (err?.name === 'AbortError' && readPendingAuthenticationRequired())) {
                editState.abandonPlanningEdit(token);
                if (started) trackIssuePriorityAction('priority_change_result', { ...analyticsBaseParams, result: 'unknown' });
                return null;
            }
            if (err?.code === 'priority_catalog_stale') {
                clearPriorityOptionsCache();
            }
            const outcome = classifyWriteError(err);
            settle(outcome);
            if (outcome === 'unconfirmed' && isCurrentVisit()) {
                setPriorityError(UNCONFIRMED_WRITE_MESSAGE);
                setPriorityErrorCode('write_unconfirmed');
            } else if (outcome === 'rejected' && started && isCurrentVisit()) {
                setPriorityError(err?.message || 'Failed to change priority.');
                setPriorityErrorCode(err?.code || '');
            }
            if (started) {
                trackIssuePriorityAction('priority_change_result', { ...analyticsBaseParams, result: outcome === 'rejected' ? 'failure' : 'unknown' });
            }
            return null;
        } finally {
            mutationCoordinator?.complete();
            if (queueController) queuedMutationControllersRef.current.delete(queueController);
            pendingMutationKeysRef.current.delete(key);
            if (scopeVisitRef.current === visit) {
                setPendingIssueKeys((prev) => {
                    const next = new Set(prev);
                    next.delete(key);
                    return next;
                });
            }
        }
    }, [activePriorityTarget, priorityOptions, closePriorityControl, sourceSurface, mutationScopeKey, backendUrl, trackIssuePriorityAction, onApplyLocalPriority, onAlertDataInvalidated, onPrioritySuccessRefresh, onAuthRecoveryRequired, mutationCoordinator, editState]);

    return {
        activePriorityTarget,
        openPriorityControl,
        closePriorityControl,
        priorityOptions,
        priorityOptionsLoading,
        // Every surface now tracks its edits per issue key (pendingIssueKeys); kept only because the
        // frozen Epic interface still threads this prop.
        prioritySubmitting: false,
        priorityError,
        priorityErrorCode,
        priorityResult,
        pendingIssueKeys,
        submitPriorityChange,
    };
}
