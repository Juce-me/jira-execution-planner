import * as React from 'react';
import { fetchIssuePriorityOptions, updateIssuePriorities } from '../api/jiraIssueApi.js';
import { authRecoveryLoginUrl, redirectToAuthRecovery } from './useEngSprintData.js';
import {
    buildCatchUpPriorityTargets,
    buildPriorityActionAnalyticsParams,
    summarizePriorityTransitionResults,
} from './engPriorityTransitionUtils.js';

let priorityOptionsCache = null;
let priorityOptionsPromise = null;

export function clearPriorityOptionsCache() {
    priorityOptionsCache = null;
    priorityOptionsPromise = null;
}

async function loadPriorityOptionsOnce(backendUrl, signal) {
    if (priorityOptionsCache) return priorityOptionsCache;
    if (!priorityOptionsPromise) {
        priorityOptionsPromise = fetchIssuePriorityOptions(backendUrl, { signal })
            .then((payload) => {
                priorityOptionsCache = payload;
                return payload;
            })
            .finally(() => {
                priorityOptionsPromise = null;
            });
    }
    return priorityOptionsPromise;
}

// React state for ENG Catch Up/Planning Story card and Epic header priority changes: active
// target, one-fetch-per-app-session priority catalog loading, mutation submission, auth
// recovery, and result state. Mirrors useEngStatusTransitions.js's single-issue control
// shape; unlike status there is no Epic/Subtask batch selection surface here. The priority
// catalog fetch is module-shared (loadPriorityOptionsOnce), so this hook never creates an
// AbortController for it — aborting would cancel a fetch other hook instances may also be
// waiting on. A local staleness token instead guards against setting state after this
// particular open() call has been superseded or the menu closed.
export function useEngPriorityTransitions({
    backendUrl,
    selectedSprint,
    sourceSurface,
    trackIssuePriorityAction,
    onAuthRecoveryRequired,
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

        if (priorityOptionsCache) {
            requestTokenRef.current = null;
            setPriorityOptions(priorityOptionsCache);
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

        loadPriorityOptionsOnce(backendUrl)
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
            priorityOptions: priorityOptionsCache?.priorities,
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
                onPrioritySuccessRefresh?.({ issueKey: key, targetPriority: response?.targetPriority });
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
    }, [activePriorityTarget, sourceSurface, backendUrl, trackIssuePriorityAction, onPrioritySuccessRefresh, onAuthRecoveryRequired]);

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
