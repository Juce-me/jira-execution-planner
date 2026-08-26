import React from 'react';

import { saveGroupPreferences as requestSaveGroupPreferences } from '../api/configApi.js';
import {
    buildFirstRunGroupPreferencesPayload,
    buildGroupPreferencesPayload,
    effectiveVisibleGroupIds,
    groupPreferencesSignature,
    normalizeGroupPreferences,
    resolveVisibleActiveGroupId,
    safeAppLoginUrl,
    visibleGroupsForControls,
} from './groupVisibilityUtils.js';

const EMPTY_GROUP_PREFERENCES = {
    customized: false,
    preferenceExists: false,
    onboardingRequired: false,
    visibleGroupIds: [],
    effectiveVisibleGroupIds: [],
    activeGroupId: null,
};

export function useGroupVisibilityPreferences({
    backendUrl,
    groupsConfig,
    groupsLoading,
    groupDraft,
    activeGroupId,
    setActiveGroupId,
    setShowGroupManage,
    setGroupManageTab,
    setDepartmentSettingsTab,
    applyPreferenceGroupsSnapshot,
    trackSettingsAction,
    bucketCount,
    useBackendPreferences = true,
}) {
    const [groupPreferences, setGroupPreferences] = React.useState(EMPTY_GROUP_PREFERENCES);
    const [groupPreferencesSaving, setGroupPreferencesSaving] = React.useState(false);
    const [visibleGroupDraftIds, setVisibleGroupDraftIds] = React.useState([]);
    const [firstRunFavoriteGroupId, setFirstRunFavoriteGroupId] = React.useState(null);
    const [firstRunSaving, setFirstRunSaving] = React.useState(false);
    const [firstRunError, setFirstRunError] = React.useState('');
    const [firstRunRecoveryLoginUrl, setFirstRunRecoveryLoginUrl] = React.useState('');
    const firstRunSaveInFlightRef = React.useRef(false);
    const groupPreferencesBaselineRef = React.useRef('');

    const firstRunGroupsSignature = React.useMemo(() => (
        (groupsConfig.groups || []).map(group => (
            `${group.id}:${(group.teamIds || []).map(teamId => String(teamId || '').trim()).filter(Boolean).join(',')}`
        )).join('|')
    ), [groupsConfig.groups]);

    React.useEffect(() => {
        if (!groupPreferences.onboardingRequired) {
            setFirstRunFavoriteGroupId(null);
            setFirstRunError('');
            setFirstRunRecoveryLoginUrl('');
            return;
        }
        setFirstRunFavoriteGroupId(previous => {
            const selectedGroup = (groupsConfig.groups || []).find(group => group.id === previous);
            const remainsEligible = (selectedGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
            return remainsEligible ? previous : null;
        });
    }, [groupPreferences.onboardingRequired, firstRunGroupsSignature, groupsConfig.groups]);

    const effectiveGroupIds = React.useMemo(() => (
        effectiveVisibleGroupIds(groupsConfig, groupPreferences)
    ), [groupsConfig, groupPreferences]);
    const visibleControlGroups = React.useMemo(() => (
        visibleGroupsForControls(groupsConfig, groupPreferences)
    ), [groupsConfig, groupPreferences]);

    React.useEffect(() => {
        if (groupsLoading) return;
        const nextActiveGroupId = resolveVisibleActiveGroupId(groupsConfig, effectiveGroupIds, activeGroupId);
        if (nextActiveGroupId !== activeGroupId) {
            setActiveGroupId(nextActiveGroupId);
        }
    }, [groupsLoading, groupsConfig, effectiveGroupIds, activeGroupId, setActiveGroupId]);

    const initializeGroupPreferencesDraft = React.useCallback((normalized, currentActiveGroupId) => {
        const initialVisibleIds = groupPreferences.customized
            ? (groupPreferences.visibleGroupIds || [])
            : (normalized.groups || []).map(group => group.id);
        setVisibleGroupDraftIds(initialVisibleIds);
        groupPreferencesBaselineRef.current = groupPreferencesSignature({
            visibleGroupIds: initialVisibleIds,
            activeGroupId: groupPreferences.activeGroupId || currentActiveGroupId,
        });
    }, [groupPreferences]);

    const groupPreferencesDraftSignature = React.useMemo(() => (
        groupPreferencesSignature({
            visibleGroupIds: visibleGroupDraftIds,
            activeGroupId,
        })
    ), [visibleGroupDraftIds, activeGroupId]);
    const isGroupVisibilityDraftDirty = React.useMemo(() => (
        groupPreferencesDraftSignature !== groupPreferencesBaselineRef.current
    ), [groupPreferencesDraftSignature]);

    const isGroupVisibleInControls = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        if (!normalizedId) return false;
        if (groupDraft?.defaultGroupId === normalizedId) return true;
        return visibleGroupDraftIds.includes(normalizedId);
    }, [groupDraft?.defaultGroupId, visibleGroupDraftIds]);

    const toggleGroupVisibleInControls = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        if (!normalizedId || groupDraft?.defaultGroupId === normalizedId) return;
        setVisibleGroupDraftIds(prev => {
            if (prev.includes(normalizedId)) {
                return prev.filter(id => id !== normalizedId);
            }
            return [...prev, normalizedId];
        });
        trackSettingsAction('departments', 'preference_change', {
            source_surface: 'settings',
        });
    }, [groupDraft?.defaultGroupId, trackSettingsAction]);

    const selectFirstRunFavoriteGroup = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        const selectedGroup = (groupsConfig.groups || []).find(group => group.id === normalizedId);
        const isEligible = (selectedGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
        if (!normalizedId || !isEligible) return;
        setFirstRunFavoriteGroupId(normalizedId);
        setFirstRunRecoveryLoginUrl('');
    }, [groupsConfig.groups]);

    const saveFirstRunGroupPreferences = React.useCallback(async () => {
        if (firstRunSaveInFlightRef.current) return;
        const selectedGroup = (groupsConfig.groups || []).find(group => group.id === firstRunFavoriteGroupId);
        const isEligible = (selectedGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
        if (!firstRunFavoriteGroupId || !isEligible) return;
        firstRunSaveInFlightRef.current = true;
        setFirstRunSaving(true);
        setFirstRunError('');
        setFirstRunRecoveryLoginUrl('');
        try {
            const response = await requestSaveGroupPreferences(
                backendUrl,
                buildFirstRunGroupPreferencesPayload(firstRunFavoriteGroupId)
            );
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                const error = new Error(errorPayload.message || errorPayload.error || `Preference save failed (${response.status})`);
                error.status = response.status;
                error.code = errorPayload.error;
                error.loginUrl = errorPayload.loginUrl;
                throw error;
            }
            const payload = await response.json();
            const nextPreferences = normalizeGroupPreferences({
                preferences: payload.preferences,
            }).preferences;
            const snapshot = normalizeGroupPreferences(payload.groupsConfigSnapshot || {});
            const snapshotPreferences = snapshot.preferences;
            const snapshotGroup = (snapshot.groups || []).find(group => group.id === firstRunFavoriteGroupId);
            const snapshotHasTeams = (snapshotGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
            const preferencesMatch = groupPreferencesSignature(nextPreferences) === groupPreferencesSignature(snapshotPreferences);
            if (
                snapshot.source !== 'workspace_db'
                || !preferencesMatch
                || nextPreferences.onboardingRequired
                || nextPreferences.activeGroupId !== firstRunFavoriteGroupId
                || !snapshotHasTeams
            ) {
                throw new Error('Saved group scope could not be verified. Please retry.');
            }
            applyPreferenceGroupsSnapshot?.({ ...snapshot, preferences: nextPreferences });
            setGroupPreferences(nextPreferences);
            setVisibleGroupDraftIds(nextPreferences.visibleGroupIds || []);
            groupPreferencesBaselineRef.current = groupPreferencesSignature(nextPreferences);
            setActiveGroupId(nextPreferences.activeGroupId);
            trackSettingsAction('departments', 'first_run_selection', {
                group_count_bucket: bucketCount((groupsConfig.groups || []).length),
            });
        } catch (error) {
            setFirstRunError(error?.message || 'Failed to save departments.');
            setFirstRunRecoveryLoginUrl(error?.status === 401 ? safeAppLoginUrl(error?.loginUrl) : '');
            trackSettingsAction('departments', 'save_result', { result: 'failure', source_surface: 'first_run' });
        } finally {
            firstRunSaveInFlightRef.current = false;
            setFirstRunSaving(false);
        }
    }, [backendUrl, firstRunFavoriteGroupId, groupsConfig, setActiveGroupId, trackSettingsAction, bucketCount, applyPreferenceGroupsSnapshot]);

    const persistGroupPreferences = React.useCallback(async (normalized) => {
        setGroupPreferencesSaving(true);
        try {
            if (!useBackendPreferences) {
                const payload = buildGroupPreferencesPayload(visibleGroupDraftIds, activeGroupId);
                const draftPreferences = {
                    customized: true,
                    preferenceExists: true,
                    onboardingRequired: false,
                    visibleGroupIds: payload.visibleGroupIds,
                    activeGroupId: payload.activeGroupId,
                };
                const effectiveIds = effectiveVisibleGroupIds(normalized, draftPreferences);
                const nextPreferences = {
                    ...draftPreferences,
                    activeGroupId: resolveVisibleActiveGroupId(normalized, effectiveIds, payload.activeGroupId),
                    effectiveVisibleGroupIds: effectiveIds,
                };
                setGroupPreferences(nextPreferences);
                setVisibleGroupDraftIds(nextPreferences.visibleGroupIds || []);
                groupPreferencesBaselineRef.current = groupPreferencesSignature(nextPreferences);
                setActiveGroupId(prev => resolveVisibleActiveGroupId(normalized, effectiveIds, nextPreferences.activeGroupId || prev));
                trackSettingsAction('departments', 'preference_change', {
                    result: 'success',
                    selection_count_bucket: bucketCount(visibleGroupDraftIds.length),
                });
                return nextPreferences;
            }
            const preferenceResponse = await requestSaveGroupPreferences(
                backendUrl,
                buildGroupPreferencesPayload(visibleGroupDraftIds, activeGroupId)
            );
            if (!preferenceResponse.ok) {
                const errorPayload = await preferenceResponse.json().catch(() => ({}));
                throw new Error(errorPayload.message || errorPayload.error || `Preference save failed (${preferenceResponse.status})`);
            }
            const preferencePayload = await preferenceResponse.json();
            const nextPreferences = normalizeGroupPreferences({
                preferences: preferencePayload.preferences || preferencePayload,
            }).preferences;
            setGroupPreferences(nextPreferences);
            setVisibleGroupDraftIds(nextPreferences.visibleGroupIds || []);
            groupPreferencesBaselineRef.current = groupPreferencesSignature(nextPreferences);
            setActiveGroupId(prev => {
                const effectiveIds = effectiveVisibleGroupIds(normalized, nextPreferences);
                return resolveVisibleActiveGroupId(normalized, effectiveIds, nextPreferences.activeGroupId || prev);
            });
            trackSettingsAction('departments', 'preference_change', {
                result: 'success',
                selection_count_bucket: bucketCount(visibleGroupDraftIds.length),
            });
            return nextPreferences;
        } finally {
            setGroupPreferencesSaving(false);
        }
    }, [backendUrl, visibleGroupDraftIds, activeGroupId, setActiveGroupId, trackSettingsAction, bucketCount, useBackendPreferences]);

    const openFirstRunAddGroup = React.useCallback(() => {
        setGroupManageTab('teams');
        setDepartmentSettingsTab('teams');
        setShowGroupManage(true);
    }, [setDepartmentSettingsTab, setGroupManageTab, setShowGroupManage]);

    return {
        groupPreferences,
        setGroupPreferences,
        groupPreferencesBaselineRef,
        visibleGroupDraftIds,
        setVisibleGroupDraftIds,
        groupPreferencesSaving,
        setGroupPreferencesSaving,
        groupVisibilitySaving: groupPreferencesSaving,
        isGroupVisibilityDraftDirty,
        effectiveGroupIds,
        visibleControlGroups,
        initializeGroupPreferencesDraft,
        isGroupVisibleInControls,
        toggleGroupVisibleInControls,
        firstRunFavoriteGroupId,
        selectFirstRunFavoriteGroup,
        saveFirstRunGroupPreferences,
        openFirstRunAddGroup,
        firstRunSaving,
        firstRunError,
        firstRunRecoveryLoginUrl,
        persistGroupPreferences,
    };
}
