import * as React from 'react';
import { useRef, useState } from 'react';

import { bucketCount } from '../analytics/dashboardAnalytics.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    fetchAppConfig,
    saveGroupsConfig as requestSaveGroupsConfig,
} from '../api/configApi.js';
import { getConfigSaveRefreshTarget } from '../configSaveRefreshUtils.mjs';
import {
    buildFirstRunSettingsSaveOutcome,
    mergeFirstRunAdminSections,
    validateFirstRunPendingGroup,
    verifyFirstRunGroupsSaveSnapshot,
} from './FirstRunGroupConfigurationGuide.jsx';
import { normalizeGroupsConfig } from './groupConfigUtils.js';
import { validatePresentGroupBoards } from './groupBoardModel.js';
import { committedSectionLabels, rebaseSharedGroupsPayload } from './groupsConfigConflict.js';
import { committedWorkspaceSectionLabels } from './workspaceConfigConflict.js';
import { buildSharedGroupsPayload } from './groupVisibilityUtils.js';
import { ADMIN_SETTINGS_TAB_IDS } from './settingsTabIds.js';

export function useSharedConfigSaveState() {
    const [workspaceConfigConflict, setWorkspaceConfigConflict] = useState(null);
    const [sharedConfigRevision, setSharedConfigRevision] = useState(0);
    const sharedConfigRevisionRef = useRef(0);
    const [sharedConfigReady, setSharedConfigReady] = useState(false);
    const acceptedBoardConfigRef = useRef(false);
    const boardConfigReadGenerationRef = useRef(0);
    const boardConfigSaveReadFenceRef = useRef(0);
    const settingsDraftSnapshotRef = useRef({});
    const commitSharedConfigRevision = (payload) => {
        if (!Number.isInteger(payload?.configRevision)) return;
        sharedConfigRevisionRef.current = payload.configRevision;
        setSharedConfigRevision(payload.configRevision);
    };
    return {
        acceptedBoardConfigRef,
        boardConfigReadGenerationRef,
        boardConfigSaveReadFenceRef,
        commitSharedConfigRevision,
        setSharedConfigReady,
        setSharedConfigRevision,
        setWorkspaceConfigConflict,
        settingsDraftSnapshotRef,
        sharedConfigReady,
        sharedConfigRevision,
        sharedConfigRevisionRef,
        workspaceConfigConflict,
    };
}

export function useSharedConfigSave({
    BACKEND_URL,
    acceptedBoardConfigRef,
    acceptedGroupsConfigRef,
    activeGroupId,
    adminAccess,
    anyFieldConfigDirty,
    applyAdminSettingsGateConfig,
    applyCapacityLoaded,
    applyJiraIssueTypesLoaded,
    applyJiraProjectsAndBoardLoaded,
    applyPriorityWeightsLoaded,
    applySavePermissions,
    applySavedEpmConfig,
    applySavedGroupsConfig,
    authMode,
    boardConfigReadGenerationRef,
    boardConfigSaveReadFenceRef,
    canEditEpmConfiguration,
    canEditSharedConfiguration,
    capacityFieldIdDraft,
    capacityProjectDraft,
    closeGroupManage,
    commitSharedConfigRevision,
    dirtyFieldConfigCount,
    dispatchFirstRunConfigurationSession,
    epmConfigLoading,
    epmConfigSaving,
    favoriteGroupValidationError,
    firstRunConfigurationActive,
    firstRunConfigurationSession,
    getActiveDepartmentSettingsTab,
    getLoadConfig,
    getLoadSprints,
    groupDraft,
    groupDraftBaselineRef,
    groupDraftSignature,
    groupManageTab,
    groupSaving,
    groupStateRef,
    groupsConfig,
    groupsConfigConflict,
    groupsReadGenerationRef,
    groupsSaveReadFenceRef,
    invalidateSprintDataForConfigSave,
    invalidateTeamMembership,
    isBoardConfigDirty,
    isCapacityDraftDirty,
    isDeliveryOwnerFieldDirty,
    isEpmConfigDirty,
    isGroupVisibilityDraftDirty,
    isIssueTypesDraftDirty,
    isParentNameFieldDirty,
    isPriorityWeightsDirty,
    isProjectsDraftDirty,
    isSprintFieldDirty,
    isStoryPointsFieldDirty,
    isTeamFieldDirty,
    parentNameFieldIdDraft,
    persistGroupPreferences,
    priorityWeightsValidationError,
    queueConfigSaveRefresh,
    saveBoardConfig,
    saveCapacityConfig,
    saveDeliveryOwnerFieldConfig,
    saveEpmConfig,
    saveFirstRunGroupPreferences,
    saveIssueTypesConfig,
    saveParentNameFieldConfig,
    savePriorityWeightsConfig,
    saveProjectSelection,
    saveSprintFieldConfig,
    saveStoryPointsFieldConfig,
    saveTeamFieldConfig,
    seedSharedFieldConfigs,
    selectedProjectsDraft,
    selectedSprint,
    setActiveGroupDraftId,
    setAuthMode,
    setBoardAllWorkAvailable,
    setBoardBootstrapStatus,
    setBoardGroupsReadFailed,
    setBoardIdDraft,
    setBoardNameDraft,
    setCapacityEnabled,
    setCapacityFieldIdDraft,
    setCapacityFieldNameDraft,
    setCapacityProjectDraft,
    setDeliveryOwnerFieldIdDraft,
    setDeliveryOwnerFieldNameDraft,
    setEpmConfigDraft,
    setGroupDraft,
    setGroupDraftError,
    setGroupManageTab,
    setGroupPreferences,
    setGroupPreferencesSaving,
    setGroupSaving,
    setGroupsConfigConflict,
    setGroupsError,
    setGroupsLoading,
    setIssueTypesDraft,
    setParentNameFieldIdDraft,
    setParentNameFieldNameDraft,
    setPriorityWeightsDraft,
    setSelectedProjectsDraft,
    setSettingsSaveError,
    setSharedConfigReady,
    setSharedConfigRevision,
    setSprintFieldIdDraft,
    setSprintFieldNameDraft,
    setStoryPointsFieldIdDraft,
    setStoryPointsFieldNameDraft,
    setTeamFieldIdDraft,
    setTeamFieldNameDraft,
    setWorkspaceConfigConflict,
    sharedConfigReady,
    sharedConfigRevisionRef,
    showScenario,
    sprintCatalogControllerRef,
    sprintFieldIdDraft,
    storyPointsFieldIdDraft,
    teamFieldIdDraft,
    trackSettingsAction,
    workspaceConfigConflict,
}) {
    const settingsSaveInFlightRef = useRef(false);
    const settingsSaveReadFenceSequenceRef = useRef(0);

    const isAdminAccessDirty = adminAccess.isDirty;
    const isCoreSharedConfigurationDraftDirty = React.useMemo(() => {
        if (isProjectsDraftDirty) return true;
        if (isPriorityWeightsDirty) return true;
        if (isBoardConfigDirty) return true;
        if (isCapacityDraftDirty) return true;
        if (isIssueTypesDraftDirty) return true;
        if (anyFieldConfigDirty) return true;
        return false;
    }, [isProjectsDraftDirty, isPriorityWeightsDirty, isBoardConfigDirty, isCapacityDraftDirty, isIssueTypesDraftDirty, anyFieldConfigDirty]);
    const isSharedConfigurationDraftDirty = isCoreSharedConfigurationDraftDirty || isAdminAccessDirty;
    const isGroupDraftDirty = React.useMemo(() => {
        if (canEditSharedConfiguration && isSharedConfigurationDraftDirty) return true;
        if (canEditEpmConfiguration && isEpmConfigDirty) return true;
        if (isGroupVisibilityDraftDirty) return true;
        if (!groupDraft) return false;
        return groupDraftSignature !== groupDraftBaselineRef.current;
    }, [groupDraftSignature, groupDraft, canEditSharedConfiguration, canEditEpmConfiguration, isSharedConfigurationDraftDirty, isEpmConfigDirty, isGroupVisibilityDraftDirty]);
    const unsavedSectionsCount = React.useMemo(() => {
        return [
            canEditSharedConfiguration && isProjectsDraftDirty,
            canEditSharedConfiguration && isPriorityWeightsDirty,
            canEditSharedConfiguration && isBoardConfigDirty,
            canEditSharedConfiguration && isCapacityDraftDirty,
            canEditSharedConfiguration && isIssueTypesDraftDirty,
            canEditSharedConfiguration && isAdminAccessDirty,
            canEditEpmConfiguration && isEpmConfigDirty,
            Boolean(groupDraft && groupDraftSignature !== groupDraftBaselineRef.current),
            isGroupVisibilityDraftDirty
        ].filter(Boolean).length + (canEditSharedConfiguration ? dirtyFieldConfigCount : 0);
    }, [canEditSharedConfiguration, canEditEpmConfiguration, isProjectsDraftDirty, isPriorityWeightsDirty, isBoardConfigDirty, isCapacityDraftDirty, isIssueTypesDraftDirty, isAdminAccessDirty, dirtyFieldConfigCount, isEpmConfigDirty, groupDraft, groupDraftSignature, isGroupVisibilityDraftDirty]);
    const shouldValidateAdminSettings = canEditSharedConfiguration
        && ((ADMIN_SETTINGS_TAB_IDS.has(groupManageTab) && !['access', 'performance'].includes(groupManageTab)) || isCoreSharedConfigurationDraftDirty);
    const groupConfigValidationErrors = React.useMemo(() => {
        const errors = [];
        if (shouldValidateAdminSettings) {
            if (!selectedProjectsDraft.length) {
                errors.push('Add at least one dashboard project before saving.');
            }
            if (!sprintFieldIdDraft) {
                errors.push('Sprint field is required.');
            }
            if (!parentNameFieldIdDraft) {
                errors.push('Parent name field is required.');
            }
            if (!storyPointsFieldIdDraft) {
                errors.push('Story points field is required.');
            }
            if (!teamFieldIdDraft) {
                errors.push('Team field is required.');
            }
            if (capacityProjectDraft && !capacityFieldIdDraft) {
                errors.push('Capacity field is required when a capacity project is selected.');
            }
            if (!capacityProjectDraft && capacityFieldIdDraft) {
                errors.push('Capacity project is required when a capacity field is selected.');
            }
            if (priorityWeightsValidationError) {
                errors.push(priorityWeightsValidationError);
            }
        }
        (groupDraft?.groups || []).forEach(group => {
            const excluded = new Set((group?.excludedCapacityEpics || [])
                .map(key => String(key || '').trim().toUpperCase())
                .filter(Boolean));
            const overlap = (group?.adHocCapacityEpics || [])
                .map(key => String(key || '').trim().toUpperCase())
                .filter(key => key && excluded.has(key));
            if (overlap.length) {
                const groupName = String(group?.name || group?.id || 'Group').trim();
                errors.push(`${groupName}: ${overlap[0]} cannot be both excluded capacity and Ad Hoc capacity.`);
            }
        });
        if (favoriteGroupValidationError && !firstRunConfigurationActive) {
            errors.push(favoriteGroupValidationError);
        }
        errors.push(...validatePresentGroupBoards(groupDraft?.groups));
        return errors;
    }, [shouldValidateAdminSettings, selectedProjectsDraft, sprintFieldIdDraft, parentNameFieldIdDraft, storyPointsFieldIdDraft, teamFieldIdDraft, capacityProjectDraft, capacityFieldIdDraft, priorityWeightsValidationError, groupDraft, favoriteGroupValidationError, firstRunConfigurationActive]);
    const saveBlockedReason = React.useMemo(() => {
        if (groupSaving || epmConfigSaving) return 'Save in progress';
        if (firstRunConfigurationActive && !firstRunConfigurationSession.guideComplete) return 'Complete the configuration guide before saving';
        if (authMode === 'atlassian_oauth' && !sharedConfigReady) return 'Shared settings are loading';
        if (canEditEpmConfiguration && isEpmConfigDirty && epmConfigLoading) return 'EPM settings are loading';
        if (groupConfigValidationErrors.length > 0) return groupConfigValidationErrors[0];
        if (!isGroupDraftDirty) return 'No changes to save';
        return '';
    }, [groupSaving, epmConfigSaving, firstRunConfigurationActive, firstRunConfigurationSession.guideComplete, authMode, sharedConfigReady, canEditEpmConfiguration, isEpmConfigDirty, epmConfigLoading, groupConfigValidationErrors, isGroupDraftDirty]);

    const buildSettingsSaveOutcome = (overrides = {}) => buildFirstRunSettingsSaveOutcome(overrides);

    const saveGroupsConfig = async ({ closeOnSuccess = true, rebaseOnto = null, skipAdminSections = {} } = {}) => {
        const loadSprints = getLoadSprints();
        const adminSectionsToSave = {
            projects: canEditSharedConfiguration && isProjectsDraftDirty && !skipAdminSections.projects,
            priorityWeights: canEditSharedConfiguration && isPriorityWeightsDirty && !skipAdminSections.priorityWeights,
            board: canEditSharedConfiguration && isBoardConfigDirty && !skipAdminSections.board,
            capacity: canEditSharedConfiguration && isCapacityDraftDirty && !skipAdminSections.capacity,
            sprintField: canEditSharedConfiguration && isSprintFieldDirty && !skipAdminSections.sprintField,
            parentNameField: canEditSharedConfiguration && isParentNameFieldDirty && !skipAdminSections.parentNameField,
            storyPointsField: canEditSharedConfiguration && isStoryPointsFieldDirty && !skipAdminSections.storyPointsField,
            teamField: canEditSharedConfiguration && isTeamFieldDirty && !skipAdminSections.teamField,
            deliveryOwnerField: canEditSharedConfiguration && isDeliveryOwnerFieldDirty && !skipAdminSections.deliveryOwnerField,
            issueTypes: canEditSharedConfiguration && isIssueTypesDraftDirty && !skipAdminSections.issueTypes,
            adminAccess: canEditSharedConfiguration && isAdminAccessDirty && !skipAdminSections.adminAccess,
        };
        const savingAdminSettings = Object.values(adminSectionsToSave).some(Boolean);
        const boardAffectingAdminSave = Object.entries(adminSectionsToSave)
            .some(([section, pending]) => pending && section !== 'adminAccess');
        if (boardAffectingAdminSave) {
            sprintCatalogControllerRef.current.invalidate('settings-save');
            invalidateTeamMembership();
        }
        const recoverCatalogsAfterRejectedBoardSave = async () => {
            if (!boardAffectingAdminSave) return;
            setBoardBootstrapStatus('loading');
            try {
                const config = await fetchAppConfig(BACKEND_URL);
                const nextAdminSettingsGate = applyAdminSettingsGateConfig(config);
                sprintCatalogControllerRef.current.acceptSource(config.sprintCatalogSource || null);
                if (nextAdminSettingsGate.status === 'clear') await loadSprints(false);
                setBoardBootstrapStatus('ready');
            } catch (error) {
                if (!isAuthenticationRequiredError(error)) setBoardBootstrapStatus('error');
            }
        };
        const sharedGroupsChanged = Boolean(groupDraft && groupDraftSignature !== groupDraftBaselineRef.current);
        const pendingSections = { admin: savingAdminSettings, groups: sharedGroupsChanged, epm: false, preference: false };
        if (!groupDraft) {
            void recoverCatalogsAfterRejectedBoardSave();
            return buildSettingsSaveOutcome({ pendingSections, pendingAdminSections: adminSectionsToSave, error: 'Group settings are unavailable.' });
        }
        if (groupConfigValidationErrors.length > 0) {
            setGroupDraftError(groupConfigValidationErrors[0]);
            trackSettingsAction(groupManageTab, 'save_result', { result: 'failure', validation_count_bucket: bucketCount(groupConfigValidationErrors.length) });
            void recoverCatalogsAfterRejectedBoardSave();
            return buildSettingsSaveOutcome({ pendingSections, pendingAdminSections: adminSectionsToSave, error: groupConfigValidationErrors[0] });
        }
        const fencesBoardConfigReads = boardAffectingAdminSave || sharedGroupsChanged;
        const fencesGroupReads = sharedGroupsChanged;
        const saveReadFence = fencesBoardConfigReads || fencesGroupReads
            ? settingsSaveReadFenceSequenceRef.current + 1
            : 0;
        if (saveReadFence) settingsSaveReadFenceSequenceRef.current = saveReadFence;
        if (fencesBoardConfigReads) {
            boardConfigReadGenerationRef.current += 1;
            boardConfigSaveReadFenceRef.current = saveReadFence;
        }
        if (fencesGroupReads) {
            groupsReadGenerationRef.current += 1;
            groupsSaveReadFenceRef.current = saveReadFence;
        }
        const clearSaveReadFence = () => {
            if (!saveReadFence) return;
            if (boardConfigSaveReadFenceRef.current === saveReadFence) {
                boardConfigSaveReadFenceRef.current = 0;
                setSharedConfigReady(true);
            }
            if (groupsSaveReadFenceRef.current === saveReadFence) {
                groupsSaveReadFenceRef.current = 0;
                setGroupsLoading(false);
            }
        };
        setGroupSaving(true);
        setGroupDraftError('');
        setSettingsSaveError('');
        setGroupsConfigConflict(null);
        setWorkspaceConfigConflict(null);
        const committedAdminSections = {};
        let groupsCommitted = false;
        let analyticsSection = groupManageTab;
        const suppressRepeatedAdminAnalytics = firstRunConfigurationActive
            && savingAdminSettings
            && Object.values(firstRunConfigurationSession.committedAdminSections || {}).some(Boolean);
        try {
            const savingDepartmentSettings = sharedGroupsChanged || (!firstRunConfigurationActive && isGroupVisibilityDraftDirty);
            analyticsSection = savingAdminSettings ? 'admin' : (savingDepartmentSettings ? 'departments' : groupManageTab);
            if (!suppressRepeatedAdminAnalytics) {
                trackSettingsAction(analyticsSection, 'save', { dirty_state: isGroupDraftDirty ? 'dirty' : 'clean', validation_count_bucket: bucketCount(groupConfigValidationErrors.length) });
            }

            let projectsChanged = false;
            let priorityWeightsChanged = false;
            let boardChanged = false;
            let capacityChanged = false;
            let fieldConfigsChanged = false;
            let issueTypesChanged = false;

            if (!firstRunConfigurationActive && boardAffectingAdminSave) {
                acceptedBoardConfigRef.current = false;
                setBoardBootstrapStatus('loading');
            }

            if (savingAdminSettings) {
                // Save project selection if changed
                projectsChanged = adminSectionsToSave.projects;
                if (projectsChanged) {
                    await saveProjectSelection();
                    committedAdminSections.projects = true;
                }

                priorityWeightsChanged = adminSectionsToSave.priorityWeights;
                if (priorityWeightsChanged) {
                    await savePriorityWeightsConfig();
                    committedAdminSections.priorityWeights = true;
                }

                boardChanged = adminSectionsToSave.board;
                if (boardChanged) {
                    await saveBoardConfig();
                    committedAdminSections.board = true;
                }

                // Save capacity config if changed
                capacityChanged = adminSectionsToSave.capacity;
                if (capacityChanged) {
                    await saveCapacityConfig();
                    committedAdminSections.capacity = true;
                }

                // Save custom field configs if changed
                if (adminSectionsToSave.sprintField) { commitSharedConfigRevision(await saveSprintFieldConfig(sharedConfigRevisionRef.current)); committedAdminSections.sprintField = true; }
                if (adminSectionsToSave.parentNameField) { commitSharedConfigRevision(await saveParentNameFieldConfig(sharedConfigRevisionRef.current)); committedAdminSections.parentNameField = true; }
                if (adminSectionsToSave.storyPointsField) { commitSharedConfigRevision(await saveStoryPointsFieldConfig(sharedConfigRevisionRef.current)); committedAdminSections.storyPointsField = true; }
                if (adminSectionsToSave.teamField) { commitSharedConfigRevision(await saveTeamFieldConfig(sharedConfigRevisionRef.current)); committedAdminSections.teamField = true; }
                if (adminSectionsToSave.deliveryOwnerField) { commitSharedConfigRevision(await saveDeliveryOwnerFieldConfig(sharedConfigRevisionRef.current)); committedAdminSections.deliveryOwnerField = true; }
                fieldConfigsChanged = adminSectionsToSave.sprintField || adminSectionsToSave.parentNameField || adminSectionsToSave.storyPointsField || adminSectionsToSave.teamField || adminSectionsToSave.deliveryOwnerField;
                // Save issue types config if changed
                issueTypesChanged = adminSectionsToSave.issueTypes;
                if (issueTypesChanged) {
                    await saveIssueTypesConfig();
                    committedAdminSections.issueTypes = true;
                }

                if (adminSectionsToSave.adminAccess) {
                    await adminAccess.save();
                    committedAdminSections.adminAccess = true;
                }
            }

            // Capture the current active group's team IDs before saving
            const currentActiveGroup = activeGroupId ? (groupsConfig.groups || []).find(g => g.id === activeGroupId) : null;
            const currentTeamSignature = currentActiveGroup ? (currentActiveGroup.teamIds || []).join('|') : null;

            let normalized = groupsConfig;
            let payload = null;
            if (sharedGroupsChanged) {
                const draftPayload = buildSharedGroupsPayload(groupDraft);
                const submittedPayload = rebaseOnto ? rebaseSharedGroupsPayload(draftPayload, rebaseOnto) : draftPayload;
                const response = await requestSaveGroupsConfig(BACKEND_URL, submittedPayload);
                if (!response.ok) {
                    const errorPayload = await response.json().catch(() => ({}));
                    const errorMessage = errorPayload.message || (errorPayload.errors || []).join(' ') || errorPayload.error || `Save failed (${response.status})`;
                    if (response.status === 409 && errorPayload.current) {
                        // Keep the draft and ask (D45): applying the server config here
                        // destroyed the user's board layout and reset the dirty baseline,
                        // leaving nothing to retry with. Sections above already committed.
                        setGroupsConfigConflict({
                            current: errorPayload.current,
                            savedSections: committedSectionLabels({ projects: projectsChanged, priorityWeights: priorityWeightsChanged, board: boardChanged, capacity: capacityChanged, fieldConfigs: fieldConfigsChanged, issueTypes: issueTypesChanged })
                        });
                    }
                    const error = new Error(errorMessage);
                    error.status = response.status;
                    error.payload = errorPayload;
                    throw error;
                }
                payload = await response.json();
                const normalizedPayload = normalizeGroupsConfig(payload);
                const normalizedSubmittedPayload = {
                    ...normalizeGroupsConfig({
                        ...submittedPayload,
                        configRevision: submittedPayload.baseRevision,
                        source: 'workspace_db',
                    }),
                    baseRevision: submittedPayload.baseRevision,
                };
                const snapshotVerification = verifyFirstRunGroupsSaveSnapshot(
                    normalizedSubmittedPayload,
                    {
                        ...normalizedPayload,
                        configRevision: payload.configRevision,
                        source: payload.source,
                    },
                    firstRunConfigurationSession.pendingGroupId
                );
                if (firstRunConfigurationActive && !snapshotVerification.ok) {
                    throw new Error(snapshotVerification.error);
                }
                if (!firstRunConfigurationActive) {
                    acceptedBoardConfigRef.current = false;
                    setBoardBootstrapStatus('loading');
                }
                normalized = applySavedGroupsConfig(normalizedPayload);
                acceptedGroupsConfigRef.current = true;
                setBoardGroupsReadFailed(false);
                setGroupsError('');
                groupsCommitted = true;
            }
            const refreshTarget = getConfigSaveRefreshTarget({
                selectedSprint,
                showScenario
            });

            if (sharedGroupsChanged) {
                // Check if the active group's team IDs changed
                if (activeGroupId && currentTeamSignature !== null) {
                    const updatedActiveGroup = (normalized.groups || []).find(g => g.id === activeGroupId);
                    const updatedTeamSignature = updatedActiveGroup ? (updatedActiveGroup.teamIds || []).join('|') : null;

                    // If team IDs changed, invalidate the cache for this group to force data reload
                    if (currentTeamSignature !== updatedTeamSignature) {
                        groupStateRef.current.delete(activeGroupId);
                    }
                }

            }

            if (!firstRunConfigurationActive && savingDepartmentSettings && isGroupVisibilityDraftDirty) {
                await persistGroupPreferences(normalized);
            }

            // If projects or capacity changed, invalidate all group caches to refetch with new scope
            if (projectsChanged || priorityWeightsChanged || boardChanged || capacityChanged || issueTypesChanged || fieldConfigsChanged) {
                groupStateRef.current.clear();
            }
            const acceptedBoardConfigurationChanged = sharedGroupsChanged
                || projectsChanged
                || priorityWeightsChanged
                || boardChanged
                || capacityChanged
                || issueTypesChanged
                || fieldConfigsChanged;

            if (!firstRunConfigurationActive) {
                // Ordinary settings saves refresh derived configuration and dashboard data.
                // First-run waits for the private handoff so retries never refetch committed sections.
                const boardConfigReadGeneration = boardConfigReadGenerationRef.current + 1;
                boardConfigReadGenerationRef.current = boardConfigReadGeneration;
                const expectedSaveReadFence = fencesBoardConfigReads ? saveReadFence : 0;
                const shouldApplyBoardConfigRead = () => boardConfigReadGenerationRef.current === boardConfigReadGeneration
                    && boardConfigSaveReadFenceRef.current === expectedSaveReadFence;
                if (acceptedBoardConfigurationChanged) acceptedBoardConfigRef.current = false;
                setBoardBootstrapStatus('loading');
                try {
                    const cfg = await fetchAppConfig(BACKEND_URL);
                    if (shouldApplyBoardConfigRead()) {
                        clearSaveReadFence();
                        setAuthMode(cfg.authMode || '');
                        setCapacityEnabled(Boolean(cfg.capacityProject || cfg.capacityConfigRequiresResolution));
                        applySavePermissions(cfg);
                        setBoardAllWorkAvailable(cfg.boardAllWorkAvailable);
                        const nextAdminSettingsGate = applyAdminSettingsGateConfig(cfg);
                        sprintCatalogControllerRef.current.acceptSource(cfg.sprintCatalogSource || null);
                        acceptedBoardConfigRef.current = true;
                        setBoardBootstrapStatus('ready');
                        if (boardAffectingAdminSave && nextAdminSettingsGate.status === 'clear') await loadSprints(false);
                    }
                } catch (err) {
                    if (shouldApplyBoardConfigRead()) {
                        clearSaveReadFence();
                        acceptedBoardConfigRef.current = false;
                        setBoardBootstrapStatus('error');
                    }
                    if (isAuthenticationRequiredError(err)) throw err;
                    /* best-effort */
                }
                invalidateSprintDataForConfigSave(refreshTarget);
                queueConfigSaveRefresh(refreshTarget);

            }

            if (closeOnSuccess) {
                closeGroupManage();
            }
            if (!suppressRepeatedAdminAnalytics) trackSettingsAction(analyticsSection, 'save_result', { result: 'success' });
            return buildSettingsSaveOutcome({
                ok: true,
                normalizedGroups: normalized,
                committedSections: {
                    admin: Object.values(committedAdminSections).some(Boolean),
                    groups: sharedGroupsChanged,
                    epm: false,
                    preference: false,
                },
                pendingSections: { admin: false, groups: false, epm: false, preference: false },
                committedAdminSections,
                pendingAdminSections: {},
            });
        } catch (err) {
            clearSaveReadFence();
            if (!firstRunConfigurationActive && boardAffectingAdminSave) {
                setBoardBootstrapStatus('error');
            }
            const committedSections = {
                admin: Object.values(committedAdminSections).some(Boolean),
                groups: groupsCommitted,
                epm: false,
                preference: false,
            };
            const pendingAdminSections = Object.fromEntries(Object.entries(adminSectionsToSave)
                .filter(([key, pending]) => pending && !committedAdminSections[key]));
            const remainingSections = {
                admin: Object.values(pendingAdminSections).some(Boolean),
                groups: sharedGroupsChanged && !groupsCommitted,
                epm: false,
                preference: false,
            };
            if (isAuthenticationRequiredError(err)) {
                return buildSettingsSaveOutcome({ authRequired: true, committedSections, pendingSections: remainingSections, committedAdminSections, pendingAdminSections });
            }
            void recoverCatalogsAfterRejectedBoardSave();
            const isCapacityConfigConflict = err?.status === 409 && err?.payload?.error === 'capacity_config_conflict';
            const workspaceConflictPayload = isCapacityConfigConflict ? {
                error: 'workspace_config_conflict',
                message: 'Shared settings changed while you were editing. Your changes are still unsaved.',
                currentRevision: err.payload.current?.configRevision,
                current: {
                    section: 'capacity',
                    value: err.payload.current || {},
                    configRevision: err.payload.current?.configRevision,
                },
            } : err?.payload;
            if (err?.status === 409 && workspaceConflictPayload?.error === 'workspace_config_conflict') {
                const pendingSections = committedWorkspaceSectionLabels({
                    projects: isProjectsDraftDirty && !committedAdminSections.projects,
                    priorityWeights: isPriorityWeightsDirty && !committedAdminSections.priorityWeights,
                    board: isBoardConfigDirty && !committedAdminSections.board,
                    capacity: isCapacityDraftDirty && !committedAdminSections.capacity,
                    fieldConfigs: ['sprintField', 'parentNameField', 'storyPointsField', 'teamField', 'deliveryOwnerField']
                        .some(key => adminSectionsToSave[key] && !committedAdminSections[key]),
                    issueTypes: isIssueTypesDraftDirty && !committedAdminSections.issueTypes,
                });
                setWorkspaceConfigConflict({
                    ...workspaceConflictPayload,
                    savedSections: committedWorkspaceSectionLabels(committedAdminSections),
                    pendingSections,
                });
                if (!suppressRepeatedAdminAnalytics) {
                    trackSettingsAction('admin', 'save_result', {
                        result: 'failure',
                        conflict_state: 'remote',
                        conflict_count_bucket: '1_5',
                    });
                }
            }
            setGroupDraftError(err.message || 'Failed to save groups.');
            setSettingsSaveError(err.message || 'Failed to save groups.');
            if (err?.status !== 409 && !suppressRepeatedAdminAnalytics) {
                trackSettingsAction(analyticsSection, 'save_result', { result: 'failure' });
            }
            return buildSettingsSaveOutcome({
                conflict: err?.status === 409 || Boolean(groupsConfigConflict),
                committedSections,
                pendingSections: remainingSections,
                committedAdminSections,
                pendingAdminSections,
                error: err.message || 'Failed to save groups.',
            });
        } finally {
            clearSaveReadFence();
            setGroupPreferencesSaving(false);
            setGroupSaving(false);
        }
    };

    const saveAllSettingsOnce = async ({ rebaseOnto = null, firstRunSession = null } = {}) => {
        const activeDepartmentSettingsTab = getActiveDepartmentSettingsTab();
        if (groupManageTab === 'connections') return;
        if (firstRunSession) {
            const validation = validateFirstRunPendingGroup(groupDraft?.groups || [], firstRunSession.pendingGroupId);
            if (!validation.ok) {
                setActiveGroupDraftId(firstRunSession.pendingGroupId || null);
                setGroupDraftError(validation.error);
                dispatchFirstRunConfigurationSession({ type: 'validation_failed', step: validation.step, error: validation.error });
                return buildSettingsSaveOutcome({
                    pendingSections: { admin: false, groups: true, epm: isEpmConfigDirty, preference: true },
                    error: validation.error,
                });
            }
        }
        if (saveBlockedReason) {
            if (groupConfigValidationErrors.length > 0) setGroupDraftError(groupConfigValidationErrors[0]);
            return buildSettingsSaveOutcome({ error: saveBlockedReason });
        }
        const hasSharedSettingsChanges = canEditSharedConfiguration && isSharedConfigurationDraftDirty;
        const hasDepartmentSettingsChanges = Boolean(groupDraft && groupDraftSignature !== groupDraftBaselineRef.current) || isGroupVisibilityDraftDirty;
        const hasEpmSettingsChanges = canEditEpmConfiguration && isEpmConfigDirty;
        if (firstRunSession) dispatchFirstRunConfigurationSession({ type: 'save_sections_started' });
        let normalizedGroups = firstRunSession?.latestNormalizedGroups || groupsConfig;
        let committedSections = {
            admin: Boolean(firstRunSession?.committedSections?.admin),
            groups: Boolean(firstRunSession?.committedSections?.groups),
            epm: Boolean(firstRunSession?.committedSections?.epm),
            preference: Boolean(firstRunSession?.committedSections?.preference),
        };
        let committedAdminSections = { ...(firstRunSession?.committedAdminSections || {}) };
        try {
            let epmDraftUnchanged = true;
            if (hasSharedSettingsChanges || hasDepartmentSettingsChanges) {
                const saved = await saveGroupsConfig({
                    closeOnSuccess: false,
                    rebaseOnto,
                    skipAdminSections: firstRunSession?.committedAdminSections || {},
                });
                normalizedGroups = saved.normalizedGroups || normalizedGroups;
                committedSections = { ...committedSections, ...Object.fromEntries(
                    Object.entries(saved.committedSections || {}).map(([key, value]) => [key, Boolean(committedSections[key] || value)])
                ) };
                committedAdminSections = mergeFirstRunAdminSections(committedAdminSections, saved.committedAdminSections);
                if (firstRunSession && Object.values(saved.committedSections || {}).some(Boolean)) {
                    dispatchFirstRunConfigurationSession({
                        type: 'sections_progress',
                        committedSections: saved.committedSections,
                        committedAdminSections: saved.committedAdminSections,
                        pendingAdminSections: saved.pendingAdminSections,
                        normalizedGroups,
                    });
                }
                if (!saved.ok) {
                    if (saved.authRequired) {
                        return buildSettingsSaveOutcome({
                            authRequired: true,
                            normalizedGroups,
                            committedSections,
                            pendingSections: { ...saved.pendingSections, epm: hasEpmSettingsChanges, preference: Boolean(firstRunSession) },
                            committedAdminSections,
                            pendingAdminSections: saved.pendingAdminSections,
                        });
                    }
                    if (firstRunSession) {
                        setGroupManageTab(activeDepartmentSettingsTab);
                        dispatchFirstRunConfigurationSession({
                            type: 'save_sections_failed',
                            committedSections,
                            committedAdminSections,
                            pendingAdminSections: saved.pendingAdminSections,
                            normalizedGroups,
                            error: saved.error || 'Settings could not be saved.',
                        });
                    }
                    return buildSettingsSaveOutcome({
                        conflict: saved.conflict,
                        normalizedGroups,
                        committedSections,
                        pendingSections: { ...saved.pendingSections, epm: hasEpmSettingsChanges, preference: Boolean(firstRunSession) },
                        committedAdminSections,
                        pendingAdminSections: saved.pendingAdminSections,
                        error: saved.error,
                    });
                }
            }
            if (hasEpmSettingsChanges) epmDraftUnchanged = await saveEpmConfig();
            if (hasEpmSettingsChanges && !epmDraftUnchanged) {
                if (firstRunSession) {
                    setGroupManageTab(activeDepartmentSettingsTab);
                    dispatchFirstRunConfigurationSession({
                        type: 'save_sections_failed', committedSections, committedAdminSections, error: 'EPM settings could not be saved.',
                    });
                }
                return buildSettingsSaveOutcome({
                    normalizedGroups,
                    committedSections,
                    pendingSections: { epm: true, preference: Boolean(firstRunSession) },
                    error: 'EPM settings could not be saved.',
                });
            }
            if (hasEpmSettingsChanges) {
                committedSections.epm = true;
                if (firstRunSession) dispatchFirstRunConfigurationSession({
                    type: 'sections_progress', committedSections: { epm: true }, normalizedGroups,
                });
            }
            if (firstRunSession) {
                dispatchFirstRunConfigurationSession({
                    type: 'sections_saved', committedSections, normalizedGroups,
                    committedAdminSections,
                });
                const preferenceResult = await saveFirstRunGroupPreferences({
                    groupsSnapshot: normalizedGroups,
                    selectedGroupId: firstRunSession.pendingGroupId,
                });
                if (preferenceResult?.authRequired) {
                    return buildSettingsSaveOutcome({
                        authRequired: true,
                        normalizedGroups,
                        committedSections,
                        pendingSections: { preference: true },
                        committedAdminSections,
                    });
                }
                if (!preferenceResult?.ok) {
                    setGroupManageTab(activeDepartmentSettingsTab);
                    dispatchFirstRunConfigurationSession({
                        type: 'preference_save_failed', error: 'Your favorite Department could not be saved.',
                    });
                    return buildSettingsSaveOutcome({
                        normalizedGroups,
                        committedSections,
                        pendingSections: { preference: true },
                        committedAdminSections,
                        error: 'Your favorite Department could not be saved.',
                    });
                }
                dispatchFirstRunConfigurationSession({ type: 'preference_saved' });
                closeGroupManage();
                return buildSettingsSaveOutcome({
                    ok: true,
                    normalizedGroups,
                    committedSections: { ...committedSections, preference: true },
                    committedAdminSections,
                });
            }
            if (hasSharedSettingsChanges || hasDepartmentSettingsChanges || hasEpmSettingsChanges) closeGroupManage();
            return buildSettingsSaveOutcome({ ok: true, normalizedGroups, committedSections });
        } catch (error) {
            if (isAuthenticationRequiredError(error)) {
                return buildSettingsSaveOutcome({
                    authRequired: true,
                    normalizedGroups,
                    committedSections,
                    pendingSections: { epm: hasEpmSettingsChanges && !committedSections.epm, preference: Boolean(firstRunSession) },
                    committedAdminSections,
                });
            }
            if (firstRunSession) {
                setGroupManageTab(activeDepartmentSettingsTab);
                dispatchFirstRunConfigurationSession({
                    type: 'save_sections_failed', committedSections, normalizedGroups, error: error?.message,
                    committedAdminSections,
                });
            }
            return buildSettingsSaveOutcome({
                normalizedGroups,
                committedSections,
                pendingSections: { epm: hasEpmSettingsChanges && !committedSections.epm, preference: Boolean(firstRunSession) },
                committedAdminSections,
                error: error?.message || 'Settings could not be saved.',
            });
        }
    };

    const saveAllSettings = async (options = {}) => {
        if (settingsSaveInFlightRef.current) return buildSettingsSaveOutcome({ inFlight: true });
        settingsSaveInFlightRef.current = true;
        try {
            return await saveAllSettingsOnce(options);
        } finally {
            settingsSaveInFlightRef.current = false;
        }
    };

    const restoreSettingsDraftsToCommittedBaselines = React.useCallback(() => {
        const captured = firstRunConfigurationSession.capturedDrafts || {};
        const admin = captured.admin || {};
        const committed = firstRunConfigurationSession.committedAdminSections || {};
        if (!committed.projects && admin.projects) setSelectedProjectsDraft(admin.projects);
        if (!committed.priorityWeights && admin.priorityWeights) setPriorityWeightsDraft(admin.priorityWeights);
        if (!committed.board && admin.board) {
            setBoardIdDraft(admin.board.boardId || '');
            setBoardNameDraft(admin.board.boardName || '');
        }
        if (!committed.capacity && admin.capacity) {
            setCapacityProjectDraft(admin.capacity.project || '');
            setCapacityFieldIdDraft(admin.capacity.fieldId || '');
            setCapacityFieldNameDraft(admin.capacity.fieldName || '');
        }
        const restoreField = (key, setId, setName) => {
            if (committed[key] || !admin[key]) return;
            setId(admin[key].fieldId || '');
            setName(admin[key].fieldName || '');
        };
        restoreField('sprintField', setSprintFieldIdDraft, setSprintFieldNameDraft);
        restoreField('parentNameField', setParentNameFieldIdDraft, setParentNameFieldNameDraft);
        restoreField('storyPointsField', setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft);
        restoreField('teamField', setTeamFieldIdDraft, setTeamFieldNameDraft);
        restoreField('deliveryOwnerField', setDeliveryOwnerFieldIdDraft, setDeliveryOwnerFieldNameDraft);
        if (!committed.issueTypes && admin.issueTypes) setIssueTypesDraft(admin.issueTypes);
        if (!committed.adminAccess && admin.adminAccess) {
            const capturedIds = new Set(admin.adminAccess);
            const currentIds = new Set(adminAccess.selectedUserIds);
            new Set([...capturedIds, ...currentIds]).forEach(userId => {
                if (capturedIds.has(userId) !== currentIds.has(userId)) adminAccess.toggleUser(userId);
            });
        }
        if (!firstRunConfigurationSession.committedSections?.epm && captured.epm) setEpmConfigDraft(captured.epm);
        const capturedPrivate = captured.private;
        if (capturedPrivate) setGroupPreferences(capturedPrivate);
    }, [adminAccess, firstRunConfigurationSession]);

    const returnFromFirstRunConfigurationRecovery = React.useCallback((snapshotOverride = null) => {
        const snapshot = Array.isArray(snapshotOverride?.groups)
            ? snapshotOverride
            : firstRunConfigurationSession.latestNormalizedGroups;
        if (snapshot) applySavedGroupsConfig(snapshot);
        restoreSettingsDraftsToCommittedBaselines();
        dispatchFirstRunConfigurationSession({
            type: firstRunConfigurationSession.status === 'preference_pending'
                ? 'return_after_preference'
                : 'return_after_sections',
        });
        closeGroupManage();
    }, [firstRunConfigurationSession, restoreSettingsDraftsToCommittedBaselines]);

    // The two exits from a rejected groups POST. Keep mine re-runs the same unified save on
    // the revision the server reported, so the user's groups win and the re-POST cannot be
    // rejected for the revision it already knows about.
    const keepMineOnGroupsConfigConflict = async () => {
        const current = groupsConfigConflict?.current;
        if (!current) return;
        setGroupDraft(prev => (prev ? { ...prev, configRevision: current.configRevision } : prev));
        await saveAllSettings({
            rebaseOnto: current,
            firstRunSession: firstRunConfigurationActive ? firstRunConfigurationSession : null,
        });
    };

    const discardMineOnGroupsConfigConflict = () => {
        if (!groupsConfigConflict?.current) return;
        applySavedGroupsConfig(groupsConfigConflict.current);
        setGroupsConfigConflict(null);
        setGroupDraftError('');
        if (firstRunConfigurationActive) {
            dispatchFirstRunConfigurationSession({ type: 'rebase', normalizedGroups: groupsConfigConflict.current });
            returnFromFirstRunConfigurationRecovery(groupsConfigConflict.current);
        }
    };

    const keepMineOnWorkspaceConfigConflict = async () => {
        if (!workspaceConfigConflict) return;
        sharedConfigRevisionRef.current = Number(workspaceConfigConflict.currentRevision || 0);
        setSharedConfigRevision(sharedConfigRevisionRef.current);
        setWorkspaceConfigConflict(null);
        await saveAllSettings({
            firstRunSession: firstRunConfigurationActive ? firstRunConfigurationSession : null,
        });
    };

    const useLatestWorkspaceConfig = async () => {
        const loadConfig = getLoadConfig();
        setWorkspaceConfigConflict(null);
        setGroupDraftError('');
        await loadConfig({ preserveEpmDraft: isEpmConfigDirty, replaceWorkspaceDrafts: true });
        if (firstRunConfigurationActive) returnFromFirstRunConfigurationRecovery();
    };

    const applySharedConfigBootstrap = (config, shouldPreserveSettingsDraft, shouldPreserveEpmDraft) => {
        const sharedConfig = config.sharedConfig;
            applyJiraProjectsAndBoardLoaded(sharedConfig, shouldPreserveSettingsDraft);
            applyCapacityLoaded(sharedConfig, shouldPreserveSettingsDraft, config);
            applyPriorityWeightsLoaded(sharedConfig, shouldPreserveSettingsDraft);
            applyJiraIssueTypesLoaded(sharedConfig, shouldPreserveSettingsDraft);
            seedSharedFieldConfigs(sharedConfig, { shouldPreserveDraft: shouldPreserveSettingsDraft });
            const personalEpm = config.viewConfig?.view?.epm || config.epm;
            if (!shouldPreserveEpmDraft()) applySavedEpmConfig(personalEpm);
            sharedConfigRevisionRef.current = config.sharedConfigRevision;
            setSharedConfigRevision(config.sharedConfigRevision);
            setWorkspaceConfigConflict(null);
    };

    return {
        applySharedConfigBootstrap,
        discardMineOnGroupsConfigConflict,
        groupConfigValidationErrors,
        isGroupDraftDirty,
        keepMineOnGroupsConfigConflict,
        keepMineOnWorkspaceConfigConflict,
        returnFromFirstRunConfigurationRecovery,
        saveAllSettings,
        saveBlockedReason,
        unsavedSectionsCount,
        useLatestWorkspaceConfig,
    };
}
