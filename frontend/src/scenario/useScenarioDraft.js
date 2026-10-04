import * as React from 'react';
import { normalizeScenarioDraftOverrides, scenarioDraftOverridesSignature } from './scenarioDraftOverrides.js';
import { applyScenarioConnectionRecovery, useConnectionScenarioRecovery } from './connectionScenarioRecovery.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { settingsDiscardedRecoveryNotice } from '../api/useConnectionRecovery.js';
import { fetchScenarioDraft as requestScenarioDraft, fetchScenarioDraftVersion as requestScenarioDraftVersion, fetchScenarioRun as requestScenarioRun, pollScenarioDraftEvents as requestScenarioDraftEvents, postScenarioRealtimeJson as requestScenarioRealtimeJson, reloadScenarioDraftFromJira as requestReloadScenarioDraftFromJira, rollbackScenarioDraft as requestRollbackScenarioDraft, saveScenarioDraftVersion as requestSaveScenarioDraftVersion } from '../api/scenarioApi.js';
import { fetchCsrfToken } from '../api/authApi.js';
import { analyticsToken, bucketCount } from '../analytics/dashboardAnalytics.js';
import { useEffect } from 'react';

export function useScenarioDraft({
    scenarioState,
    BACKEND_URL,
    pendingConnectionRecoveryRef,
    releaseConnectionRecoveryOwnership,
    connectionRecoveryScenarioStartedRef,
    setConnectionRecoveryNotice,
    setConnectionRecoveryStatus,
    connectionRecoveryStagedRevision,
    selectedSprint,
    availableSprints,
    sprintsLoading,
    groupsLoading,
    activeGroupId,
    showScenario,
    pendingShellAuthResumeRef,
    selectedSprintInfo,
    trackScenarioAction,
    visibleControlGroups,
    selectedSprintState,
    isCompletedSprintSelected,
    registerSprintFetch,
    cleanupSprintFetch,
    activeGroup,
    teamOptions,
    selectedTeamSet,
    isAllTeamsSelected,
    excludedEpicSet,
}) {
    const {
        setScenarioLoading,
        setScenarioError,
        scenarioData,
        setScenarioData,
        scenarioLaneMode,
        scenarioTimelineRef,
        scenarioOverrides,
        setScenarioOverrides,
        scenarioActiveDraftIdRef,
        scenarioScopeKeyRef,
        scenarioDraftMeta,
        setScenarioDraftMeta,
        setScenarioDraftEvents,
        setScenarioDraftPresence,
        setScenarioDraftLocks,
        setScenarioDraftRealtimeStatus,
        setScenarioDraftLastEventNumber,
        setScenarioEditMode,
        scenarioUndoStackRef,
        setScenarioUndoVersion,
        scenarioRealtimeCsrfRef,
    } = scenarioState;
    const fetchScenarioCsrfToken = () =>
        fetchCsrfToken(BACKEND_URL).then(({ csrfToken }) => csrfToken || '');

    const fetchScenarioDraft = (scopeKey, signal) =>
        requestScenarioDraft(BACKEND_URL, scopeKey, { signal });

    const fetchScenarioRealtimeCsrfToken = async (forceRefresh = false) => {
        if (!forceRefresh && scenarioRealtimeCsrfRef.current) {
            return scenarioRealtimeCsrfRef.current;
        }
        const token = await fetchScenarioCsrfToken();
        scenarioRealtimeCsrfRef.current = token;
        return token;
    };

    const pauseScenarioRealtime = (message) => {
        setScenarioDraftRealtimeStatus({
            mode: 'paused',
            paused: true,
            message: message || 'Realtime paused; keep editing local-only until the session is refreshed.'
        });
    };

    const postScenarioRealtimeJson = async (draftId, path, payload) => {
        const postWithToken = async (csrfToken) => {
            return requestScenarioRealtimeJson(BACKEND_URL, draftId, path, payload, { csrfToken });
        };
        try {
            return await postWithToken(await fetchScenarioRealtimeCsrfToken(false));
        } catch (err) {
            if (err.status === 403 && err.payload?.error === 'csrf_required') {
                try {
                    return await postWithToken(await fetchScenarioRealtimeCsrfToken(true));
                } catch (retryErr) {
                    if (isAuthenticationRequiredError(retryErr)) throw retryErr;
                    pauseScenarioRealtime('Realtime paused; session security expired. Keep editing local-only, then refresh or sign in again.');
                    throw retryErr;
                }
            }
            throw err;
        }
    };

    const pollScenarioDraftEvents = (draftId, sinceEventNumber, signal) =>
        requestScenarioDraftEvents(BACKEND_URL, draftId, sinceEventNumber, { signal });

    const saveScenarioDraftVersion = async (scopeKey, name, baseDraftRevision, scope, overrides) => {
        const payload = {
            scope_key: scopeKey,
            name,
            baseDraftRevision,
            scope,
            scenarioOverrides: normalizeScenarioDraftOverrides(overrides),
            overrides: normalizeScenarioDraftOverrides(overrides)
        };
        const postScenarioDraft = async (csrfToken) => {
            return requestSaveScenarioDraftVersion(BACKEND_URL, payload, { csrfToken });
        };
        const csrfToken = await fetchScenarioCsrfToken();
        try {
            return await postScenarioDraft(csrfToken);
        } catch (err) {
            if (err.status === 403 && err.payload?.error === 'csrf_required') {
                const freshCsrfToken = await fetchScenarioCsrfToken();
                try {
                    return await postScenarioDraft(freshCsrfToken);
                } catch (csrfRetry) {
                    if (isAuthenticationRequiredError(csrfRetry)) throw csrfRetry;
                    csrfRetry.message = 'Session security check expired. Try saving again.';
                    throw csrfRetry;
                }
            }
            throw err;
        }
    };

    const fetchScenarioDraftVersion = (draftId, versionNumber, signal) =>
        requestScenarioDraftVersion(BACKEND_URL, draftId, versionNumber, { signal });

    const rollbackScenarioDraft = async (draftId, targetVersionNumber, baseDraftRevision, signal) => {
        const csrfToken = await fetchScenarioCsrfToken();
        return requestRollbackScenarioDraft(
            BACKEND_URL,
            draftId,
            {
                targetVersionNumber,
                baseDraftRevision
            },
            { csrfToken, signal }
        );
    };

    const reloadScenarioDraftFromJira = async (draftId, baseDraftRevision, signal) => {
        const csrfToken = await fetchScenarioCsrfToken();
        return requestReloadScenarioDraftFromJira(
            BACKEND_URL,
            draftId,
            {
                baseDraftRevision
            },
            { csrfToken, signal }
        );
    };

    const buildScenarioDraftScope = () => ({
        groupId: activeGroupId || '',
        groupName: activeGroup?.name || '',
        sprintId: selectedSprint ? String(selectedSprint) : '',
        sprintName: selectedSprintInfo?.name || ''
    });

    const buildScenarioPayload = () => {
        const isActiveSprint = selectedSprintState === 'active';
        const anchorDate = isActiveSprint
            ? new Date().toISOString().slice(0, 10)
            : null;
        return {
            config: {
                lane_mode: scenarioLaneMode,
                anchor_date: anchorDate,
                excluded_capacity_epics: Array.from(excludedEpicSet)
            },
            filters: {
                sprint: selectedSprint || null,
                teams: scenarioTeamIds
            }
        };
    };

    const scenarioDraftIdleActionState = () => ({
        loadingVersionNumber: null,
        loadingActiveDraft: false,
        rollingBackVersionNumber: null,
        reloadingFromJira: false,
        pendingHistoryAction: null,
        pendingActiveDraftReload: false,
        pendingReloadFromJira: false,
        writebackPreviewing: false,
        writebackChecking: false,
        writebackPreview: null,
        writebackBlocked: null
    });

    const runScenario = async ({ recovery = null } = {}) => {
        if (!recovery) trackScenarioAction('compute', { lane_mode: analyticsToken(scenarioLaneMode), team_count_bucket: bucketCount(scenarioTeamIds.length) });
        if (!selectedSprint) {
            setScenarioError('Select a sprint to build a scenario.');
            if (!recovery) trackScenarioAction('compute_result', { result: 'failure', blocking_reason: 'missing_sprint' });
            return;
        }
        if (isCompletedSprintSelected) {
            setScenarioError('Scenario planner is disabled for completed sprints.');
            if (!recovery) trackScenarioAction('compute_result', { result: 'failure', blocking_reason: 'completed_sprint' });
            return;
        }
        if (!recovery && scenarioHasUnsavedChanges) {
            setScenarioDraftMeta(prev => ({
                ...prev,
                pendingScopeChange: { scopeKey: scenarioScopeKey },
                error: ''
            }));
            setScenarioError('Save or discard scenario draft changes before reloading scenario data.');
            trackScenarioAction('compute_result', { result: 'failure', blocking_reason: 'dirty_draft' });
            return;
        }
        setScenarioLoading(true);
        setScenarioError('');
        const controller = registerSprintFetch();
        try {
            const data = await requestScenarioRun(BACKEND_URL, buildScenarioPayload(), {
                signal: controller.signal
            });
            const scopePayload = buildScenarioDraftScope();
            setScenarioOverrides({});
            setScenarioDraftEvents([]);
            setScenarioDraftPresence([]);
            setScenarioDraftLocks([]);
            setScenarioDraftLastEventNumber(0);
            setScenarioDraftRealtimeStatus({ mode: 'idle', paused: false, message: '' });
            setScenarioDraftMeta(prev => ({
                ...prev,
                activeDraft: null,
                versions: [],
                loadedVersionNumber: null,
                baseDraftRevision: null,
                savedOverrides: {},
                scopePayload,
                scopeKey: scenarioScopeKey,
                dirtyState: 'clean',
                pendingScopeChange: null,
                loadingHistory: Boolean(scenarioScopeKey),
                ...scenarioDraftIdleActionState(),
                staleDraft: null,
                conflict: null,
                message: '',
                error: ''
            }));
            setScenarioData(data);
            // Reset scroll so stale content height doesn't leave empty space
            if (scenarioTimelineRef.current) {
                scenarioTimelineRef.current.scrollTop = 0;
            }
            if (!recovery) trackScenarioAction('compute_result', { result: 'success', issue_count_bucket: bucketCount((data?.issues || []).length) });
            // Load the active draft for this scope unless the user has dirty edits from another scope.
            if (scenarioScopeKey) {
                try {
                    const draftData = await fetchScenarioDraft(scenarioScopeKey, controller.signal);
                    const activeDraft = draftData.activeDraft || null;
                    const versions = Array.isArray(draftData.versions) ? draftData.versions : [];
                    if (recovery?.scenario) {
                        applyScenarioConnectionRecovery({
                            activeDraft, idleActionState: scenarioDraftIdleActionState(), recovery,
                            releaseOwnership: releaseConnectionRecoveryOwnership,
                            scenarioScopeKey, scopePayload, setConnectionRecoveryNotice,
                            setScenarioDraftMeta, setScenarioEditMode,
                            setScenarioOverrides, setScenarioUndoVersion, scenarioTimelineRef,
                            scenarioUndoStackRef, settingsDiscardedNotice: settingsDiscardedRecoveryNotice(), versions,
                        });
                        pendingConnectionRecoveryRef.current = null;
                    } else if (activeDraft) {
                        const overrides = normalizeScenarioDraftOverrides(activeDraft.overrides || {});
                        setScenarioOverrides(overrides);
                        setScenarioDraftMeta(prev => ({
                            ...prev,
                            activeDraft,
                            versions,
                            loadedVersionNumber: activeDraft.versionNumber || null,
                            baseDraftRevision: activeDraft.draftRevision || null,
                            savedOverrides: overrides,
                            scopePayload: activeDraft.scopePayload || scopePayload,
                            scopeKey: scenarioScopeKey,
                            dirtyState: 'clean',
                            pendingScopeChange: null,
                            loadingHistory: false,
                            ...scenarioDraftIdleActionState(),
                            staleDraft: null,
                            conflict: null,
                            message: '',
                            error: ''
                        }));
                    } else {
                        setScenarioOverrides({});
                        setScenarioDraftMeta(prev => ({
                            ...prev,
                            activeDraft: null,
                            versions,
                            loadedVersionNumber: null,
                            baseDraftRevision: null,
                            savedOverrides: {},
                            scopePayload,
                            scopeKey: scenarioScopeKey,
                            dirtyState: 'clean',
                            pendingScopeChange: null,
                            loadingHistory: false,
                            ...scenarioDraftIdleActionState(),
                            staleDraft: null,
                            conflict: null,
                            message: '',
                            error: ''
                        }));
                    }
                } catch (err) {
                    if (err.name === 'AbortError') throw err;
                    if (isAuthenticationRequiredError(err)) return;
                    setScenarioOverrides({});
                    setScenarioDraftMeta(prev => ({
                        ...prev,
                        activeDraft: null,
                        versions: [],
                        loadedVersionNumber: null,
                        baseDraftRevision: null,
                        savedOverrides: {},
                        scopePayload,
                        scopeKey: scenarioScopeKey,
                        dirtyState: 'clean',
                        pendingScopeChange: null,
                        loadingHistory: false,
                        ...scenarioDraftIdleActionState(),
                        staleDraft: null,
                        conflict: null,
                        error: err.message || 'Failed to load scenario draft.'
                    }));
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                return;
            }
            if (isAuthenticationRequiredError(err)) return;
            setScenarioError(err.message || 'Failed to run scenario.');
            if (!recovery) trackScenarioAction('compute_result', { result: 'failure' });
        } finally {
            cleanupSprintFetch(controller);
            setScenarioLoading(false);
        }
    };

    const scenarioTeamIds = React.useMemo(() => {
        if (isAllTeamsSelected) {
            return teamOptions.filter(team => team.id !== 'all').map(team => team.id);
        }
        return Array.from(selectedTeamSet);
    }, [isAllTeamsSelected, selectedTeamSet, teamOptions]);
    const scenarioScopeKey = React.useMemo(() => {
        const sprintId = selectedSprint ? String(selectedSprint) : '';
        const groupId = activeGroupId || 'default';
        return sprintId && groupId ? `${sprintId}:${groupId}` : '';
    }, [selectedSprint, activeGroupId]);
    const scenarioOverridesSignature = React.useMemo(
        () => scenarioDraftOverridesSignature(scenarioOverrides),
        [scenarioOverrides]
    );
    const savedScenarioOverridesSignature = React.useMemo(
        () => scenarioDraftOverridesSignature(scenarioDraftMeta.savedOverrides),
        [scenarioDraftMeta.savedOverrides]
    );
    useEffect(() => {
        const dirtyState = scenarioOverridesSignature === savedScenarioOverridesSignature ? 'clean' : 'dirty';
        setScenarioDraftMeta(prev => {
            if (prev.dirtyState === 'conflict_remote' && prev.conflict) return prev;
            return prev.dirtyState === dirtyState ? prev : { ...prev, dirtyState };
        });
    }, [scenarioOverridesSignature, savedScenarioOverridesSignature]);
    const scenarioHasUnsavedChanges = scenarioOverridesSignature !== savedScenarioOverridesSignature;
    useConnectionScenarioRecovery({
        activeGroupId, availableSprints, groupsLoading,
        pendingRecoveryRef: pendingConnectionRecoveryRef,
        pendingShellRef: pendingShellAuthResumeRef,
        runScenario, scenarioScopeKey,
        releaseOwnership: releaseConnectionRecoveryOwnership,
        scenarioStartedRef: connectionRecoveryScenarioStartedRef,
        selectedSprint, setNotice: setConnectionRecoveryNotice,
        setStatus: setConnectionRecoveryStatus, showScenario, sprintsLoading,
        stagedRevision: connectionRecoveryStagedRevision, visibleControlGroups,
    });
    const scenarioHasStoredDraftScope = Boolean(
        scenarioDraftMeta.scopeKey
        && scenarioDraftMeta.scopePayload
        && Object.keys(scenarioDraftMeta.scopePayload).length > 0
    );
    const scenarioCanSaveDraft = scenarioHasUnsavedChanges
        && !scenarioDraftMeta.loadingHistory
        && !scenarioDraftMeta.saving
        && scenarioDraftMeta.dirtyState !== 'conflict_remote'
        && !scenarioDraftMeta.conflict
        && Boolean((scenarioData && scenarioScopeKey) || scenarioHasStoredDraftScope);
    const scenarioActiveDraftId = scenarioDraftMeta.activeDraft?.draftId || '';
    scenarioActiveDraftIdRef.current = scenarioActiveDraftId;
    scenarioScopeKeyRef.current = scenarioScopeKey;
    const isScenarioScopeDraftCurrent = React.useCallback((expectedScopeKey, expectedDraftId = '') => {
        if (scenarioScopeKeyRef.current !== expectedScopeKey) return false;
        if (expectedDraftId && scenarioActiveDraftIdRef.current !== expectedDraftId) return false;
        return true;
    }, []);
    const scenarioActiveDraftReady = Boolean(
        showScenario
        && scenarioData
        && scenarioActiveDraftId
        && scenarioDraftMeta.scopeKey === scenarioScopeKey
    );
    return {
        fetchScenarioDraft,
        pauseScenarioRealtime,
        postScenarioRealtimeJson,
        pollScenarioDraftEvents,
        saveScenarioDraftVersion,
        fetchScenarioDraftVersion,
        rollbackScenarioDraft,
        reloadScenarioDraftFromJira,
        buildScenarioDraftScope,
        runScenario,
        scenarioScopeKey,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        scenarioActiveDraftId,
        isScenarioScopeDraftCurrent,
        scenarioActiveDraftReady,
    };
}
