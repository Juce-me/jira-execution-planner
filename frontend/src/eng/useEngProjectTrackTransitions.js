import * as React from 'react';
import { fetchIssueProjectTrackOptions, updateIssueProjectTrack } from '../api/jiraIssueApi.js';
import { authRecoveryLoginUrl, redirectToAuthRecovery } from './useEngSprintData.js';
import { enqueueEngIssueMutation } from './engIssueMutationQueue.js';
import { buildProjectTrackActionAnalyticsParams } from './engProjectTrackTransitionUtils.js';

// React state for the ENG Catch Up/Planning Epic-header Project Track change control: active
// target, per-open option fetch, mutation submission, auth recovery, and result state. Mirrors
// useEngPriorityTransitions.js's single-issue control shape, with one deliberate difference:
// there is no module-level options cache here. Project Track options are per-issue editmeta
// (write-permission-gated) rather than a shared project/issue-type scheme, so caching across
// issues/sprints would risk serving a stale editability signal; every open re-fetches, and the
// write itself re-resolves server-side so that staleness is safe.
export function useEngProjectTrackTransitions({
    backendUrl,
    selectedSprint,
    sourceSurface,
    mutationScopeKey = '',
    trackIssueProjectTrackAction,
    onAuthRecoveryRequired,
    onApplyLocalProjectTrack,
}) {
    const [activeProjectTrackTarget, setActiveProjectTrackTarget] = React.useState(null);
    const [projectTrackOptions, setProjectTrackOptions] = React.useState(null);
    const [projectTrackOptionsLoading, setProjectTrackOptionsLoading] = React.useState(false);
    const [projectTrackSubmitting, setProjectTrackSubmitting] = React.useState(false);
    const [projectTrackError, setProjectTrackError] = React.useState('');
    const [projectTrackErrorCode, setProjectTrackErrorCode] = React.useState('');
    const [projectTrackResult, setProjectTrackResult] = React.useState(null);
    const [pendingIssueKeys, setPendingIssueKeys] = React.useState(() => new Set());
    const requestTokenRef = React.useRef(null);
    const activeProjectTrackTargetRef = React.useRef(null);
    const mutationScopeRef = React.useRef(mutationScopeKey);
    mutationScopeRef.current = mutationScopeKey;
    const pendingMutationKeysRef = React.useRef(new Set());

    // Active target, in-flight fetch tracking, and result/error state are scoped to one
    // sprint and Catch Up/Planning surface. In-flight writes keep their own scope token so a
    // late response cannot patch a newly selected sprint or group.
    React.useEffect(() => {
        setActiveProjectTrackTarget(null);
        activeProjectTrackTargetRef.current = null;
        requestTokenRef.current = null;
        setProjectTrackOptions(null);
        setProjectTrackOptionsLoading(false);
        setProjectTrackError('');
        setProjectTrackErrorCode('');
        setProjectTrackResult(null);
        setPendingIssueKeys(new Set());
        pendingMutationKeysRef.current.clear();
    }, [selectedSprint, sourceSurface, mutationScopeKey]);

    const closeProjectTrackControl = React.useCallback(() => {
        setActiveProjectTrackTarget(null);
        activeProjectTrackTargetRef.current = null;
        requestTokenRef.current = null;
        setProjectTrackOptionsLoading(false);
        setProjectTrackError('');
        setProjectTrackErrorCode('');
    }, []);

    const openProjectTrackControl = React.useCallback((epicKey, currentTrack) => {
        const key = String(epicKey || '').trim();
        if (!key) return;
        if (activeProjectTrackTargetRef.current?.key === key) {
            closeProjectTrackControl();
            return;
        }

        const target = { key, currentTrack: currentTrack || '' };
        setProjectTrackResult(null);
        setActiveProjectTrackTarget(target);
        activeProjectTrackTargetRef.current = target;
        setProjectTrackError('');
        setProjectTrackErrorCode('');

        const token = {};
        requestTokenRef.current = token;
        setProjectTrackOptions(null);
        setProjectTrackOptionsLoading(true);
        trackIssueProjectTrackAction('project_track_options_open', buildProjectTrackActionAnalyticsParams({ sourceSurface }));

        fetchIssueProjectTrackOptions(backendUrl, { issueKey: key })
            .then((payload) => {
                if (requestTokenRef.current !== token) return; // Superseded; drop the stale response.
                setProjectTrackOptions(payload);
            })
            .catch((err) => {
                if (requestTokenRef.current !== token) return; // Superseded; do not surface a stale error.
                if (authRecoveryLoginUrl(err)) {
                    onAuthRecoveryRequired?.();
                    redirectToAuthRecovery(err);
                }
                setProjectTrackError(err?.message || 'Failed to load Project Track options.');
                setProjectTrackErrorCode(err?.code || '');
            })
            .finally(() => {
                if (requestTokenRef.current === token) {
                    setProjectTrackOptionsLoading(false);
                    requestTokenRef.current = null;
                }
            });
    }, [backendUrl, sourceSurface, trackIssueProjectTrackAction, onAuthRecoveryRequired, closeProjectTrackControl]);

    const submitProjectTrackChange = React.useCallback(async (targetTrack, epicKey) => {
        const target = String(targetTrack || '').trim();
        const key = String(epicKey || '').trim();
        if (!target || !key) return null;

        const isCatchUp = sourceSurface === 'catch_up';
        if (isCatchUp && pendingMutationKeysRef.current.has(key)) return null;

        const priorTrack = activeProjectTrackTarget && activeProjectTrackTarget.key === key
            ? activeProjectTrackTarget.currentTrack
            : '';
        const mutationScope = mutationScopeKey;
        const analyticsBaseParams = buildProjectTrackActionAnalyticsParams({ sourceSurface, targetTrack: target });

        trackIssueProjectTrackAction('project_track_change_submit', analyticsBaseParams);
        setProjectTrackError('');
        setProjectTrackErrorCode('');

        if (isCatchUp) {
            pendingMutationKeysRef.current.add(key);
            onApplyLocalProjectTrack?.(key, target);
            setPendingIssueKeys((prev) => new Set(prev).add(key));
        } else {
            setProjectTrackSubmitting(true);
        }

        try {
            const runMutation = () => updateIssueProjectTrack(backendUrl, { issueKey: key, targetTrack: target });
            const response = await (isCatchUp ? enqueueEngIssueMutation(key, runMutation) : runMutation());
            const isCurrentMutation = !isCatchUp || mutationScopeRef.current === mutationScope;
            if (isCurrentMutation && (!isCatchUp || activeProjectTrackTargetRef.current?.key === key)) {
                setProjectTrackResult(response?.result || 'success');
            }
            trackIssueProjectTrackAction('project_track_change_result', { ...analyticsBaseParams, result: 'success' });
            if (isCatchUp && isCurrentMutation) {
                // Server canonical value: 'already_in_track' responses carry only fromTrack.
                onApplyLocalProjectTrack?.(key, response?.toTrack ?? response?.fromTrack);
            }
            return response;
        } catch (err) {
            if (authRecoveryLoginUrl(err)) {
                onAuthRecoveryRequired?.();
                redirectToAuthRecovery(err);
            }
            if (isCatchUp && mutationScopeRef.current === mutationScope) {
                onApplyLocalProjectTrack?.(key, priorTrack);
            }
            if ((!isCatchUp || mutationScopeRef.current === mutationScope) && (!isCatchUp || activeProjectTrackTargetRef.current?.key === key)) {
                setProjectTrackError(err?.message || 'Failed to change Project Track.');
                setProjectTrackErrorCode(err?.code || '');
            }
            trackIssueProjectTrackAction('project_track_change_result', { ...analyticsBaseParams, result: 'failure' });
            return null;
        } finally {
            if (isCatchUp) {
                if (mutationScopeRef.current === mutationScope) {
                    pendingMutationKeysRef.current.delete(key);
                    setPendingIssueKeys((prev) => {
                        const next = new Set(prev);
                        next.delete(key);
                        return next;
                    });
                }
            } else {
                setProjectTrackSubmitting(false);
            }
        }
    }, [activeProjectTrackTarget, sourceSurface, mutationScopeKey, backendUrl, trackIssueProjectTrackAction, onApplyLocalProjectTrack, onAuthRecoveryRequired]);

    return {
        activeProjectTrackTarget,
        openProjectTrackControl,
        closeProjectTrackControl,
        projectTrackOptions,
        projectTrackOptionsLoading,
        projectTrackSubmitting,
        projectTrackError,
        projectTrackErrorCode,
        projectTrackResult,
        pendingProjectTrackIssueKeys: pendingIssueKeys,
        submitProjectTrackChange,
    };
}
