import * as React from 'react';
import { clearConnectionRecoveryState, getConnectionRecoveryStorage } from '../api/connectionRecoveryState.js';
import { normalizeScenarioDraftOverrides, overlayScenarioDraftDelta } from './scenarioDraftOverrides.js';

export function applyScenarioConnectionRecovery({
    activeDraft,
    idleActionState,
    recovery,
    releaseOwnership,
    scenarioScopeKey,
    scopePayload,
    setConnectionRecoveryNotice,
    setScenarioDraftMeta,
    setScenarioEditMode,
    setScenarioOverrides,
    setScenarioUndoVersion,
    scenarioTimelineRef,
    scenarioUndoStackRef,
    settingsDiscardedNotice,
    versions,
}) {
    const freshOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || {});
    const currentRevision = Number(activeDraft?.draftRevision || 0);
    const currentDraftId = String(activeDraft?.draftId || '');
    const revisionChanged = currentRevision !== recovery.scenario.baseDraftRevision
        || currentDraftId !== String(recovery.scenario.activeDraftId || '');
    setScenarioOverrides(overlayScenarioDraftDelta(
        freshOverrides,
        recovery.scenario.savedOverrides,
        recovery.scenario.localOverrides,
    ));
    setScenarioEditMode(recovery.scenario.editMode);
    scenarioUndoStackRef.current.clear();
    setScenarioUndoVersion(0);
    setScenarioDraftMeta(previous => ({
        ...previous,
        activeDraft,
        versions,
        loadedVersionNumber: activeDraft?.versionNumber || null,
        baseDraftRevision: activeDraft?.draftRevision || 0,
        savedOverrides: freshOverrides,
        scopePayload: activeDraft?.scopePayload || scopePayload,
        scopeKey: scenarioScopeKey,
        dirtyState: revisionChanged ? 'conflict_remote' : 'dirty',
        pendingScopeChange: null,
        loadingHistory: false,
        ...idleActionState,
        staleDraft: null,
        conflict: revisionChanged ? {
            currentDraftRevision: currentRevision,
            currentVersionNumber: activeDraft?.versionNumber || null,
            activeDraft,
            versions,
        } : null,
        message: revisionChanged
            ? 'The server draft changed while the connection was unavailable. Your local changes were restored for conflict resolution.'
            : 'Unsaved Scenario changes were restored after reconnecting.',
        error: '',
    }));
    clearConnectionRecoveryState(getConnectionRecoveryStorage(window));
    setConnectionRecoveryNotice(recovery.droppedSettings ? settingsDiscardedNotice : null);
    releaseOwnership('idle');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const timeline = scenarioTimelineRef.current;
        if (timeline) {
            timeline.scrollTop = Math.min(recovery.scenario.scrollTop, Math.max(0, timeline.scrollHeight - timeline.clientHeight));
            timeline.scrollLeft = Math.min(recovery.scenario.scrollLeft, Math.max(0, timeline.scrollWidth - timeline.clientWidth));
        }
        window.scrollTo({
            left: Math.min(recovery.view.scrollX, Math.max(0, document.documentElement.scrollWidth - window.innerWidth)),
            top: Math.min(recovery.view.scrollY, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)),
            behavior: 'auto',
        });
    }));
    return revisionChanged;
}

export function useConnectionScenarioRecovery({
    activeGroupId,
    availableSprints,
    groupsLoading,
    pendingRecoveryRef,
    pendingShellRef,
    runScenario,
    releaseOwnership,
    scenarioScopeKey,
    scenarioStartedRef,
    selectedSprint,
    setNotice,
    setStatus,
    showScenario,
    sprintsLoading,
    stagedRevision,
    visibleControlGroups,
}) {
    const attemptedRevisionRef = React.useRef(null);
    React.useEffect(() => {
        const recovery = pendingRecoveryRef.current;
        if (!recovery || groupsLoading || sprintsLoading || pendingShellRef.current) return;
        if (attemptedRevisionRef.current === stagedRevision) return;
        const requestedGroup = String(recovery.scenario?.groupId || recovery.view.activeGroupId || '');
        const requestedSprint = String(recovery.scenario?.sprintId || recovery.view.selectedSprint || '');
        const groupAvailable = visibleControlGroups.some(group => String(group.id) === requestedGroup);
        const sprintAvailable = availableSprints.some(sprint => String(sprint.id) === requestedSprint);
        const exactScope = groupAvailable && sprintAvailable
            && String(activeGroupId || '') === requestedGroup
            && String(selectedSprint || '') === requestedSprint;
        const blockForScope = () => {
            attemptedRevisionRef.current = stagedRevision;
            releaseOwnership('blocked_scope');
            setNotice({
                kind: 'blocked_scope',
                message: `${recovery.droppedSettings ? 'Unsaved configuration changes were discarded. ' : ''}Your unsaved Scenario changes are still available, but their group or sprint is not active. Restore that scope and choose Recover, or discard the recovery copy.`,
            });
        };
        if (!recovery.scenario) {
            attemptedRevisionRef.current = stagedRevision;
            pendingRecoveryRef.current = null;
            clearConnectionRecoveryState(getConnectionRecoveryStorage(window));
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                window.scrollTo({ left: recovery.view.scrollX, top: recovery.view.scrollY, behavior: 'auto' });
            }));
            releaseOwnership('idle');
            return;
        }
        const shellScopeSettled = String(activeGroupId || '') === String(recovery.view.activeGroupId || '')
            && String(selectedSprint || '') === String(recovery.view.selectedSprint || '');
        const scenarioModeExpected = recovery.view.engMode === 'scenario';
        if (!groupAvailable || !sprintAvailable) {
            blockForScope();
            return;
        }
        if (!shellScopeSettled || (scenarioModeExpected && !showScenario)) return;
        if (!exactScope || !showScenario || scenarioScopeKey !== recovery.scenario.scopeKey) {
            blockForScope();
            return;
        }
        if (scenarioStartedRef.current) return;
        attemptedRevisionRef.current = stagedRevision;
        scenarioStartedRef.current = true;
        setStatus('restoring');
        void runScenario({ recovery }).finally(() => {
            scenarioStartedRef.current = false;
            if (pendingRecoveryRef.current) {
                releaseOwnership('failed');
                setNotice({
                    kind: 'failed',
                    message: `${recovery.droppedSettings ? 'Unsaved configuration changes were discarded. ' : ''}Scenario recovery did not finish. Your recovery copy is still available for another explicit attempt.`,
                });
            }
        });
    }, [
        groupsLoading, sprintsLoading, visibleControlGroups, availableSprints,
        activeGroupId, selectedSprint, showScenario, scenarioScopeKey, stagedRevision,
    ]);
}
