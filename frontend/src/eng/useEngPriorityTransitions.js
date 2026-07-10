import * as React from 'react';
import { fetchIssuePriorityOptions, updateIssuePriorities } from '../api/jiraIssueApi.js';
import { authRecoveryLoginUrl, redirectToAuthRecovery } from './useEngSprintData.js';
import {
    buildCatchUpPriorityTargets,
    buildPriorityActionAnalyticsParams,
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
    trackIssuePriorityAction,
    onAuthRecoveryRequired,
    onApplyLocalPriority,
    onPrioritySuccessRefresh,
}) {
    const [activePriorityTarget, setActivePriorityTarget] = React.useState(null);
    const [priorityOptions, setPriorityOptions] = React.useState(null);
    const [priorityOptionsLoading, setPriorityOptionsLoading] = React.useState(false);
    const [prioritySubmitting, setPrioritySubmitting] = React.useState(false);
    const [priorityError, setPriorityError] = React.useState('');
    const [priorityErrorCode, setPriorityErrorCode] = React.useState('');
    const [priorityResult, setPriorityResult] = React.useState(null);
    const requestTokenRef = React.useRef(null);

    // Active target, in-flight fetch tracking, and result/error state are scoped to one
    // sprint; the priority catalog cache itself is app-session scoped and survives sprint
    // changes (cleared only via clearPriorityOptionsCache on auth recovery/hard refresh).
    React.useEffect(() => {
        setActivePriorityTarget(null);
        requestTokenRef.current = null;
        setPriorityOptions(null);
        setPriorityOptionsLoading(false);
        setPriorityError('');
        setPriorityErrorCode('');
        setPriorityResult(null);
    }, [selectedSprint]);

    const closePriorityControl = React.useCallback(() => {
        setActivePriorityTarget(null);
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
                if (authRecoveryLoginUrl(err)) {
                    onAuthRecoveryRequired?.();
                    clearPriorityOptionsCache();
                    redirectToAuthRecovery(err);
                }
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
        const analyticsBaseParams = buildPriorityActionAnalyticsParams({
            sourceSurface,
            targets: [target],
            priorityId: targetPriorityId,
            // The active menu's shown scheme (the tuple's cached payload) resolves the target
            // priority's rank -> low-cardinality bucket. No raw id/name leaves this builder.
            priorityOptions: priorityOptions?.priorities,
        });

        trackIssuePriorityAction('priority_change_submit', analyticsBaseParams);
        setPrioritySubmitting(true);
        setPriorityError('');
        setPriorityErrorCode('');

        try {
            const response = await updateIssuePriorities(backendUrl, {
                issueKeys: [key],
                targetPriorityId,
            });
            const summary = summarizePriorityTransitionResults(response?.results);
            setPriorityResult({ ...summary, targetPriorityId });
            trackIssuePriorityAction('priority_change_result', { ...analyticsBaseParams, result: summary.result });
            if (summary.succeeded > 0) {
                // Apply the new priority to the in-memory issue immediately (icon/card color
                // do not wait on the refetch below), then reuse the same refresh callback
                // shape as status. Priority edits never affect subtasks in this slice, so
                // affectedSubtaskStoryKeys is always empty (see the plan's Feasibility Answer).
                onApplyLocalPriority?.(key, response?.targetPriority);
                onPrioritySuccessRefresh?.({ affectedSubtaskStoryKeys: [] });
            }
            return response;
        } catch (err) {
            if (authRecoveryLoginUrl(err)) {
                onAuthRecoveryRequired?.();
                clearPriorityOptionsCache();
                redirectToAuthRecovery(err);
            }
            if (err?.code === 'priority_catalog_stale') {
                clearPriorityOptionsCache();
            }
            setPriorityError(err?.message || 'Failed to change priority.');
            setPriorityErrorCode(err?.code || '');
            trackIssuePriorityAction('priority_change_result', { ...analyticsBaseParams, result: 'failure' });
            return null;
        } finally {
            setPrioritySubmitting(false);
        }
    }, [activePriorityTarget, priorityOptions, sourceSurface, backendUrl, trackIssuePriorityAction, onApplyLocalPriority, onPrioritySuccessRefresh, onAuthRecoveryRequired]);

    return {
        activePriorityTarget,
        openPriorityControl,
        closePriorityControl,
        priorityOptions,
        priorityOptionsLoading,
        prioritySubmitting,
        priorityError,
        priorityErrorCode,
        priorityResult,
        submitPriorityChange,
    };
}
