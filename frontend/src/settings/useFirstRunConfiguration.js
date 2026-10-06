import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import {
    FIRST_RUN_CONFIGURATION_GUIDE_STEPS,
    createFirstRunConfigurationSession,
    firstRunConfigurationSessionReducer,
} from './FirstRunGroupConfigurationGuide.jsx';
import { beginFirstRunGroupConfiguration, buildFirstRunGroupDraft } from './firstRunGroupConfiguration.js';
import { buildSharedGroupsPayload } from './groupVisibilityUtils.js';

export function useFirstRunConfigurationState() {
    const [firstRunSetupChoice, setFirstRunSetupChoice] = useState(null);
    const [firstRunConfigurationTargetGroupId, setFirstRunConfigurationTargetGroupId] = useState(null);
    const [firstRunConfigurationSession, dispatchFirstRunConfigurationSession] = React.useReducer(
        firstRunConfigurationSessionReducer,
        undefined,
        createFirstRunConfigurationSession
    );
    const firstRunConfigurationActive = !['idle', 'complete'].includes(firstRunConfigurationSession.status);
    const pendingFirstRunConfigurationRef = useRef(null);
    const pendingFirstRunGroupPreferencesRef = useRef(null);
    return {
        dispatchFirstRunConfigurationSession,
        firstRunConfigurationActive,
        firstRunConfigurationSession,
        firstRunConfigurationTargetGroupId,
        firstRunSetupChoice,
        pendingFirstRunConfigurationRef,
        pendingFirstRunGroupPreferencesRef,
        setFirstRunConfigurationTargetGroupId,
        setFirstRunSetupChoice,
    };
}

export function useFirstRunConfiguration({
    activeGroupDraft,
    activeGroupId,
    adminAccess,
    boardIdDraft,
    boardNameDraft,
    capacityFieldIdDraft,
    capacityFieldNameDraft,
    capacityProjectDraft,
    deliveryOwnerFieldIdDraft,
    deliveryOwnerFieldNameDraft,
    dispatchFirstRunConfigurationSession,
    epmConfigDraft,
    firstRunConfigurationActive,
    firstRunConfigurationSession,
    firstRunSetupChoice,
    getCloseGroupManage,
    getSaveAllSettings,
    groupDraftBaselineRef,
    groupPreferences,
    groupsConfig,
    groupsConfigConflict,
    issueTypesDraft,
    parentNameFieldIdDraft,
    parentNameFieldNameDraft,
    pendingFirstRunConfigurationRef,
    pendingFirstRunGroupPreferencesRef,
    priorityWeightsDraft,
    saveFirstRunGroupPreferences,
    selectedProjectsDraft,
    setActiveGroupId,
    setDepartmentSettingsTab,
    setFirstRunConfigurationTargetGroupId,
    setFirstRunSetupChoice,
    setGroupDraft,
    setGroupManageTab,
    setGroupPreferences,
    setGroupsConfig,
    setSharedConfigRevision,
    setShowGroupListMobile,
    setShowGroupManage,
    setWorkspaceConfigConflict,
    sharedConfigRevisionRef,
    showGroupManage,
    sprintFieldIdDraft,
    sprintFieldNameDraft,
    storyPointsFieldIdDraft,
    storyPointsFieldNameDraft,
    teamFieldIdDraft,
    teamFieldNameDraft,
    workspaceConfigConflict,
}) {
    const openFirstRunSetupChoice = React.useCallback(() => {
        setFirstRunSetupChoice(beginFirstRunGroupConfiguration({ mode: 'create' }));
    }, []);
    const openFirstRunConfigurationSettings = React.useCallback(() => {
        setGroupManageTab('teams');
        setDepartmentSettingsTab('teams');
        setShowGroupListMobile(true);
        setShowGroupManage(true);
    }, []);
    const closeFirstRunSetupChoice = React.useCallback(() => {
        setFirstRunSetupChoice(null);
    }, []);
    const captureFirstRunSettingsDrafts = React.useCallback(() => ({
        shared: groupsConfig,
        private: groupPreferences,
        activeGroupId,
        admin: {
            projects: selectedProjectsDraft,
            priorityWeights: priorityWeightsDraft,
            board: { boardId: boardIdDraft, boardName: boardNameDraft },
            capacity: { project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft },
            sprintField: { fieldId: sprintFieldIdDraft, fieldName: sprintFieldNameDraft },
            parentNameField: { fieldId: parentNameFieldIdDraft, fieldName: parentNameFieldNameDraft },
            storyPointsField: { fieldId: storyPointsFieldIdDraft, fieldName: storyPointsFieldNameDraft },
            teamField: { fieldId: teamFieldIdDraft, fieldName: teamFieldNameDraft },
            deliveryOwnerField: { fieldId: deliveryOwnerFieldIdDraft, fieldName: deliveryOwnerFieldNameDraft },
            issueTypes: issueTypesDraft,
            adminAccess: adminAccess.selectedUserIds,
        },
        epm: epmConfigDraft,
    }), [
        activeGroupId, adminAccess.selectedUserIds, boardIdDraft, boardNameDraft, capacityFieldIdDraft,
        capacityFieldNameDraft, capacityProjectDraft, deliveryOwnerFieldIdDraft, deliveryOwnerFieldNameDraft,
        epmConfigDraft, groupPreferences, groupsConfig, issueTypesDraft, parentNameFieldIdDraft,
        parentNameFieldNameDraft, priorityWeightsDraft, selectedProjectsDraft, sprintFieldIdDraft,
        sprintFieldNameDraft, storyPointsFieldIdDraft, storyPointsFieldNameDraft, teamFieldIdDraft, teamFieldNameDraft,
    ]);
    const configureFirstRunGroup = React.useCallback((sourceGroupId) => {
        pendingFirstRunConfigurationRef.current = beginFirstRunGroupConfiguration({
            mode: 'repair',
            sourceGroupId,
        });
        setFirstRunConfigurationTargetGroupId(sourceGroupId);
        setFirstRunSetupChoice(null);
        dispatchFirstRunConfigurationSession({
            type: 'start',
            mode: 'repair',
            pendingGroupId: sourceGroupId,
            drafts: captureFirstRunSettingsDrafts(),
        });
        openFirstRunConfigurationSettings();
    }, [captureFirstRunSettingsDrafts, openFirstRunConfigurationSettings]);
    const continueFirstRunSetupChoice = React.useCallback(() => {
        if (!firstRunSetupChoice) return;
        const sourceGroup = (groupsConfig.groups || []).find(group => group.id === firstRunSetupChoice.sourceGroupId) || null;
        const draft = buildFirstRunGroupDraft({
            ...firstRunSetupChoice,
            sourceGroup,
            existingGroups: groupsConfig.groups || [],
        });
        if (!draft) return;
        pendingFirstRunConfigurationRef.current = {
            ...firstRunSetupChoice,
            draft,
        };
        setFirstRunConfigurationTargetGroupId(draft.id);
        setFirstRunSetupChoice(null);
        dispatchFirstRunConfigurationSession({
            type: 'start',
            mode: firstRunSetupChoice.mode,
            pendingGroupId: draft.id,
            drafts: captureFirstRunSettingsDrafts(),
        });
        openFirstRunConfigurationSettings();
    }, [captureFirstRunSettingsDrafts, firstRunSetupChoice, groupsConfig.groups, openFirstRunConfigurationSettings]);
    useEffect(() => {
        if (!showGroupManage && firstRunConfigurationActive) {
            pendingFirstRunGroupPreferencesRef.current = null;
            setFirstRunConfigurationTargetGroupId(null);
        }
    }, [showGroupManage, firstRunConfigurationActive]);

    const advanceFirstRunConfigurationGuide = React.useCallback(() => {
        const index = FIRST_RUN_CONFIGURATION_GUIDE_STEPS.indexOf(firstRunConfigurationSession.guideStep);
        if (index < 0) return;
        if (index === FIRST_RUN_CONFIGURATION_GUIDE_STEPS.length - 1) {
            dispatchFirstRunConfigurationSession({ type: 'complete_guide' });
            return;
        }
        dispatchFirstRunConfigurationSession({
            type: 'set_guide_step',
            step: FIRST_RUN_CONFIGURATION_GUIDE_STEPS[index + 1],
        });
        if (firstRunConfigurationSession.guideStep === 'name') setShowGroupListMobile(false);
    }, [firstRunConfigurationSession.guideStep]);

    const backFirstRunConfigurationGuide = React.useCallback(() => {
        const index = FIRST_RUN_CONFIGURATION_GUIDE_STEPS.indexOf(firstRunConfigurationSession.guideStep);
        if (index <= 0) return;
        const previousStep = FIRST_RUN_CONFIGURATION_GUIDE_STEPS[index - 1];
        dispatchFirstRunConfigurationSession({
            type: 'set_guide_step',
            step: previousStep,
        });
        if (previousStep === 'name') setShowGroupListMobile(true);
    }, [firstRunConfigurationSession.guideStep]);

    const cancelFirstRunConfiguration = React.useCallback(() => {
        if (Object.values(firstRunConfigurationSession.committedSections || {}).some(Boolean)) return;
        const captured = firstRunConfigurationSession.capturedDrafts;
        if (captured?.shared) {
            setGroupsConfig(captured.shared);
            setGroupDraft(captured.shared);
            groupDraftBaselineRef.current = JSON.stringify(buildSharedGroupsPayload(captured.shared));
        }
        if (captured?.private) setGroupPreferences(captured.private);
        setActiveGroupId(captured?.activeGroupId || null);
        dispatchFirstRunConfigurationSession({ type: 'cancel' });
        const closeGroupManage = getCloseGroupManage();
        closeGroupManage();
    }, [firstRunConfigurationSession]);

    const retryFirstRunConfiguration = React.useCallback(async () => {
        if (firstRunConfigurationSession.status === 'preference_pending') {
            const preferenceResult = await saveFirstRunGroupPreferences({
                groupsSnapshot: firstRunConfigurationSession.latestNormalizedGroups,
                selectedGroupId: firstRunConfigurationSession.pendingGroupId,
            });
            if (preferenceResult?.authRequired || preferenceResult?.inFlight) return;
            if (!preferenceResult?.ok) {
                dispatchFirstRunConfigurationSession({
                    type: 'preference_save_failed', error: 'Your favorite Department could not be saved.',
                });
                return;
            }
            dispatchFirstRunConfigurationSession({ type: 'preference_saved' });
            const closeGroupManage = getCloseGroupManage();
            closeGroupManage();
            return;
        }
        if (workspaceConfigConflict?.currentRevision != null) {
            sharedConfigRevisionRef.current = Number(workspaceConfigConflict.currentRevision);
            setSharedConfigRevision(sharedConfigRevisionRef.current);
            setWorkspaceConfigConflict(null);
        }
        const saveAllSettings = getSaveAllSettings();
        await saveAllSettings({
            rebaseOnto: groupsConfigConflict?.current || null,
            firstRunSession: firstRunConfigurationSession,
        });
    }, [firstRunConfigurationSession, groupsConfigConflict, workspaceConfigConflict, saveFirstRunGroupPreferences]);

    const firstRunConfigurationGuideVisible = firstRunConfigurationActive
        && activeGroupDraft
        && (!firstRunConfigurationSession.guideComplete
            || ['sections_pending', 'preference_pending'].includes(firstRunConfigurationSession.status));
    const firstRunHasCommittedSection = firstRunConfigurationActive
        && Object.values(firstRunConfigurationSession.committedSections || {}).some(Boolean);
    return {
        advanceFirstRunConfigurationGuide,
        backFirstRunConfigurationGuide,
        cancelFirstRunConfiguration,
        closeFirstRunSetupChoice,
        configureFirstRunGroup,
        continueFirstRunSetupChoice,
        firstRunConfigurationGuideVisible,
        firstRunHasCommittedSection,
        openFirstRunSetupChoice,
        retryFirstRunConfiguration,
    };
}
