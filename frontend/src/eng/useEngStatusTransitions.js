import * as React from 'react';
import { fetchIssueTransitionOptions, transitionIssues } from '../api/jiraIssueApi.js';
import { authRecoveryLoginUrl, redirectToAuthRecovery } from './useEngSprintData.js';
import {
    MAX_STATUS_TRANSITION_ISSUES,
    buildCatchUpStatusTargets,
    buildEngStatusTargets,
    buildStatusActionAnalyticsParams,
    resolveSubtaskParentStoryKeys,
    summarizeTransitionResults,
} from './engStatusTransitionUtils.js';

const EMPTY_OPTIONS_REQUEST = { controller: null, signature: '' };

// Module-level cache shared by every hook instance/mount, so switching sprints, groups, or
// which Story/Epic/Subtask menu is open no longer forces a refetch for a target signature
// already seen this app session. Keyed by project/issue-type/current-status tuples (never
// by raw issue key) so different issues that share a tuple reuse one fetch; invalidated
// per-tuple after a successful transition (see submitStatusTransition) instead of wholesale
// on scope changes.
const transitionOptionsCache = new Map();

function transitionOptionCacheKey(targets) {
    return targets
        .map(target => [
            target.projectKey || String(target.key || '').split('-')[0],
            target.issueType || '',
            target.currentStatus || '',
        ].join('|'))
        .sort()
        .join(',');
}

// Test/auth-recovery escape hatch mirroring clearPriorityOptionsCache in
// useEngPriorityTransitions.js.
export function clearTransitionOptionsCache() {
    transitionOptionsCache.clear();
}

// React state for ENG Catch Up single-issue status changes and Planning selected
// Epic/Subtask status targets, option loading, mutation submission, auth recovery, and
// result state. Planning Story selection keeps using the caller's existing selection map
// (passed in as `selectedStories`, the already-selected Story task list); this hook never
// reads or writes that map so Epics/Subtasks can never corrupt Planning capacity math.
export function useEngStatusTransitions({
    backendUrl,
    selectedStories,
    epicGroups,
    storySubtasksByKey,
    selectedSprint,
    sourceSurface,
    trackIssueStatusAction,
    onAuthRecoveryRequired,
    onTransitionSuccessRefresh,
}) {
    const [selectedEpicStatusTargets, setSelectedEpicStatusTargets] = React.useState(() => new Set());
    const [selectedSubtaskStatusTargets, setSelectedSubtaskStatusTargets] = React.useState(() => new Set());
    const [activeSingleIssueTarget, setActiveSingleIssueTarget] = React.useState(null);
    const [transitionOptions, setTransitionOptions] = React.useState(null);
    const [transitionOptionsLoading, setTransitionOptionsLoading] = React.useState(false);
    const [transitionError, setTransitionError] = React.useState('');
    const [transitionErrorCode, setTransitionErrorCode] = React.useState('');
    const [transitionResult, setTransitionResult] = React.useState(null);
    const optionsRequestRef = React.useRef(EMPTY_OPTIONS_REQUEST);

    const abortInFlightOptionsRequest = React.useCallback(() => {
        optionsRequestRef.current.controller?.abort();
        optionsRequestRef.current = EMPTY_OPTIONS_REQUEST;
    }, []);

    const clearNonStoryStatusTargets = React.useCallback(() => {
        setSelectedEpicStatusTargets(new Set());
        setSelectedSubtaskStatusTargets(new Set());
    }, []);

    // Selected status targets and any open menu/options/result are scoped to one sprint.
    React.useEffect(() => {
        clearNonStoryStatusTargets();
        setActiveSingleIssueTarget(null);
        abortInFlightOptionsRequest();
        // transitionOptionsCache is module-level and app-session scoped; it is invalidated
        // per-tuple after a successful transition (see submitStatusTransition), not
        // wholesale on every sprint change.
        setTransitionOptions(null);
        setTransitionOptionsLoading(false);
        setTransitionError('');
        setTransitionErrorCode('');
        setTransitionResult(null);
    }, [selectedSprint, clearNonStoryStatusTargets, abortInFlightOptionsRequest]);

    const toggleEpicStatusTarget = React.useCallback((epicKey) => {
        const key = String(epicKey || '').trim();
        if (!key) return;
        setSelectedEpicStatusTargets((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const toggleSubtaskStatusTarget = React.useCallback((subtaskKey) => {
        const key = String(subtaskKey || '').trim();
        if (!key) return;
        setSelectedSubtaskStatusTargets((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    // Fetches available transitions for the given targets (an array of {key, ...} targets
    // or raw keys). Aborts any in-flight request for a different target signature before
    // starting the new one, and dedupes a repeat call for the same in-flight signature.
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

        if (transitionOptionsCache.has(signature)) {
            const cached = transitionOptionsCache.get(signature);
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
        trackIssueStatusAction('status_options_open', buildStatusActionAnalyticsParams({
            sourceSurface,
            targets: list,
            selectedStories,
        }));

        try {
            const response = await fetchIssueTransitionOptions(backendUrl, keys, { signal: controller.signal });
            if (optionsRequestRef.current.controller !== controller) {
                return null; // Superseded by a newer request; drop this stale response.
            }
            transitionOptionsCache.set(signature, response);
            setTransitionOptions(response);
            return response;
        } catch (err) {
            if (err?.name === 'AbortError') {
                return null;
            }
            if (optionsRequestRef.current.controller !== controller) {
                return null; // Superseded; do not surface a stale error over a newer request.
            }
            if (authRecoveryLoginUrl(err)) {
                onAuthRecoveryRequired?.();
                clearTransitionOptionsCache();
                redirectToAuthRecovery(err);
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
        void loadTransitionOptions([target]);
    }, [loadTransitionOptions]);

    const closeSingleIssueStatusControl = React.useCallback(() => {
        setActiveSingleIssueTarget(null);
        abortInFlightOptionsRequest();
        setTransitionOptions(null);
        setTransitionOptionsLoading(false);
        setTransitionError('');
        setTransitionErrorCode('');
    }, [abortInFlightOptionsRequest]);

    // Catch Up passes one explicit target key and never reads/mutates Planning selection
    // state. Planning ignores any passed key and builds the composed target set from
    // selected Stories + selected Epics + selected Subtasks.
    const submitStatusTransition = React.useCallback(async (targetStatus, explicitTargetKey) => {
        const status = String(targetStatus || '').trim();
        if (!status) return null;

        const explicitKey = String(explicitTargetKey || '').trim();
        let targets;
        // Catch Up always acts on one explicit key. Planning defaults to the composed
        // target set, but also honors an explicit single key for its "Apply to this
        // issue only" recovery action (Step 6.4), regardless of surface.
        if (sourceSurface === 'catch_up' || explicitKey) {
            if (!explicitKey) return null;
            targets = [
                activeSingleIssueTarget && activeSingleIssueTarget.key === explicitKey
                    ? activeSingleIssueTarget
                    : { key: explicitKey, issueType: '', currentStatus: '', summary: '' }
            ];
        } else {
            targets = buildEngStatusTargets({
                selectedTasksList: selectedStories,
                selectedEpicKeys: Array.from(selectedEpicStatusTargets),
                selectedSubtaskKeys: Array.from(selectedSubtaskStatusTargets),
                epicGroups,
                storySubtasksByKey,
            });
            // Client-side cap guard (defense-in-depth; the menu also disables the batch
            // submit past the cap). Surface the same recoverable code the backend returns
            // and send no mutation request.
            if (targets.length > MAX_STATUS_TRANSITION_ISSUES) {
                setTransitionResult(null);
                setTransitionError('');
                setTransitionErrorCode('too_many_issues');
                return { error: 'too_many_issues', code: 'too_many_issues' };
            }
        }
        if (!targets.length) return null;

        const analyticsBaseParams = buildStatusActionAnalyticsParams({
            sourceSurface,
            targets,
            selectedStories,
            status,
        });

        trackIssueStatusAction('status_change_submit', analyticsBaseParams);
        setTransitionError('');
        setTransitionErrorCode('');

        try {
            const response = await transitionIssues(backendUrl, {
                issueKeys: targets.map((target) => target.key),
                targetStatus: status,
            });
            const summary = summarizeTransitionResults(response?.results);
            setTransitionResult({ ...summary, targetStatus: status });
            trackIssueStatusAction('status_change_result', { ...analyticsBaseParams, result: summary.result });
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
                const affectedTuples = new Set(
                    targets
                        .filter((target) => succeededKeySet.has(target.key))
                        .map((target) => transitionOptionCacheKey([target]))
                );
                if (affectedTuples.size) {
                    for (const cacheKey of transitionOptionsCache.keys()) {
                        if (cacheKey.split(',').some((tuple) => affectedTuples.has(tuple))) {
                            transitionOptionsCache.delete(cacheKey);
                        }
                    }
                }
                const affectedSubtaskStoryKeys = resolveSubtaskParentStoryKeys(succeededKeys, storySubtasksByKey);
                onTransitionSuccessRefresh?.({ affectedSubtaskStoryKeys });
            }
            return response;
        } catch (err) {
            if (authRecoveryLoginUrl(err)) {
                onAuthRecoveryRequired?.();
                clearTransitionOptionsCache();
                redirectToAuthRecovery(err);
            }
            setTransitionError(err?.message || 'Failed to change status.');
            setTransitionErrorCode(err?.code || '');
            trackIssueStatusAction('status_change_result', { ...analyticsBaseParams, result: 'failure' });
            return null;
        }
    }, [
        sourceSurface,
        activeSingleIssueTarget,
        selectedStories,
        selectedEpicStatusTargets,
        selectedSubtaskStatusTargets,
        epicGroups,
        storySubtasksByKey,
        trackIssueStatusAction,
        backendUrl,
        onTransitionSuccessRefresh,
        onAuthRecoveryRequired,
    ]);

    return {
        sourceSurface,
        selectedEpicStatusTargets,
        selectedSubtaskStatusTargets,
        activeSingleIssueTarget,
        openSingleIssueStatusControl,
        closeSingleIssueStatusControl,
        toggleEpicStatusTarget,
        toggleSubtaskStatusTarget,
        clearNonStoryStatusTargets,
        transitionOptions,
        transitionOptionsLoading,
        transitionError,
        transitionErrorCode,
        transitionResult,
        loadTransitionOptions,
        submitStatusTransition,
    };
}
