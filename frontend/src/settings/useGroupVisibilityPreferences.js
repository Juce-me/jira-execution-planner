import React from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';

import { saveGroupPreferences as requestSaveGroupPreferences } from '../api/configApi.js';
import {
    buildFirstRunGroupPreferencesPayload,
    buildGroupPreferencesPayload,
    effectiveVisibleGroupIds,
    groupPreferencesSignature,
    normalizeGroupPreferences,
    resolveVisibleActiveGroupId,
    visibleGroupsForControls,
} from './groupVisibilityUtils.js';

const EMPTY_GROUP_PREFERENCES = {
    customized: false,
    preferenceExists: false,
    onboardingRequired: false,
    onboardingDone: true,
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
    const [favoriteGroupDraftId, setFavoriteGroupDraftId] = React.useState(null);
    const [firstRunFavoriteGroupId, setFirstRunFavoriteGroupId] = React.useState(null);
    const [firstRunSaving, setFirstRunSaving] = React.useState(false);
    const [firstRunError, setFirstRunError] = React.useState('');
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
        const initialFavoriteId = useBackendPreferences
            ? (groupPreferences.activeGroupId || null)
            : (groupPreferences.activeGroupId || currentActiveGroupId || null);
        setFavoriteGroupDraftId(initialFavoriteId);
        groupPreferencesBaselineRef.current = groupPreferencesSignature({
            visibleGroupIds: initialVisibleIds,
            activeGroupId: initialFavoriteId,
        });
    }, [groupPreferences, useBackendPreferences]);

    const groupPreferencesDraftSignature = React.useMemo(() => (
        groupPreferencesSignature({
            visibleGroupIds: visibleGroupDraftIds,
            activeGroupId: useBackendPreferences ? favoriteGroupDraftId : activeGroupId,
        })
    ), [visibleGroupDraftIds, favoriteGroupDraftId, activeGroupId, useBackendPreferences]);
    const isGroupVisibilityDraftDirty = React.useMemo(() => (
        groupPreferencesDraftSignature !== groupPreferencesBaselineRef.current
    ), [groupPreferencesDraftSignature]);

    const isGroupVisibleInControls = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        if (!normalizedId) return false;
        if (useBackendPreferences && favoriteGroupDraftId === normalizedId) return true;
        if (!useBackendPreferences && groupDraft?.defaultGroupId === normalizedId) return true;
        return visibleGroupDraftIds.includes(normalizedId);
    }, [favoriteGroupDraftId, groupDraft?.defaultGroupId, useBackendPreferences, visibleGroupDraftIds]);

    const toggleGroupVisibleInControls = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        if (!normalizedId) return;
        if (useBackendPreferences && favoriteGroupDraftId === normalizedId) return;
        if (!useBackendPreferences && groupDraft?.defaultGroupId === normalizedId) return;
        setVisibleGroupDraftIds(prev => {
            if (prev.includes(normalizedId)) {
                return prev.filter(id => id !== normalizedId);
            }
            return [...prev, normalizedId];
        });
        trackSettingsAction('departments', 'preference_change', {
            source_surface: 'settings',
        });
    }, [favoriteGroupDraftId, groupDraft?.defaultGroupId, trackSettingsAction, useBackendPreferences]);

    const setFavoriteGroupDraft = React.useCallback((groupId) => {
        if (!useBackendPreferences) return;
        const normalizedId = String(groupId || '').trim();
        const group = (groupDraft?.groups || []).find(candidate => candidate.id === normalizedId);
        const isEligible = (group?.teamIds || []).some(teamId => String(teamId || '').trim());
        if (!normalizedId || !isEligible || favoriteGroupDraftId === normalizedId) return;
        setFavoriteGroupDraftId(normalizedId);
        setVisibleGroupDraftIds(previous => previous.includes(normalizedId) ? previous : [...previous, normalizedId]);
        trackSettingsAction('departments', 'preference_change', { source_surface: 'settings' });
    }, [favoriteGroupDraftId, groupDraft?.groups, trackSettingsAction, useBackendPreferences]);

    const favoriteGroupValidationError = React.useMemo(() => {
        if (!useBackendPreferences) return '';
        const favorite = (groupDraft?.groups || []).find(group => group.id === favoriteGroupDraftId);
        if (!favoriteGroupDraftId || !visibleGroupDraftIds.includes(favoriteGroupDraftId)) {
            return 'Choose one visible group as your favorite.';
        }
        const hasTeams = (favorite?.teamIds || []).some(teamId => String(teamId || '').trim());
        return hasTeams ? '' : 'Configure teams before setting this group as your favorite.';
    }, [favoriteGroupDraftId, groupDraft?.groups, useBackendPreferences, visibleGroupDraftIds]);

    const selectFirstRunFavoriteGroup = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        const selectedGroup = (groupsConfig.groups || []).find(group => group.id === normalizedId);
        const isEligible = (selectedGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
        if (!normalizedId || !isEligible) return;
        setFirstRunFavoriteGroupId(normalizedId);
    }, [groupsConfig.groups]);

    const saveFirstRunGroupPreferences = React.useCallback(async ({ groupsSnapshot = groupsConfig, selectedGroupId = firstRunFavoriteGroupId } = {}) => {
        if (firstRunSaveInFlightRef.current) return { ok: false, inFlight: true };
        const selectedGroup = (groupsSnapshot.groups || []).find(group => group.id === selectedGroupId);
        const isEligible = (selectedGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
        if (!selectedGroupId || !isEligible) return { ok: false, invalidSelection: true };
        firstRunSaveInFlightRef.current = true;
        setFirstRunSaving(true);
        setFirstRunError('');
        try {
            const response = await requestSaveGroupPreferences(
                backendUrl,
                buildFirstRunGroupPreferencesPayload(selectedGroupId)
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
            const snapshotGroup = (snapshot.groups || []).find(group => group.id === selectedGroupId);
            const snapshotHasTeams = (snapshotGroup?.teamIds || []).some(teamId => String(teamId || '').trim());
            const preferencesMatch = groupPreferencesSignature(nextPreferences) === groupPreferencesSignature(snapshotPreferences);
            if (
                snapshot.source !== 'workspace_db'
                || !preferencesMatch
                || nextPreferences.onboardingRequired
                || nextPreferences.activeGroupId !== selectedGroupId
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
                group_count_bucket: bucketCount((groupsSnapshot.groups || []).length),
            });
            return { ok: true, groupsSnapshot: snapshot, preferences: nextPreferences };
        } catch (error) {
            if (isAuthenticationRequiredError(error)) return { ok: false, authRequired: true };
            setFirstRunError(error?.message || 'Failed to save departments.');
            trackSettingsAction('departments', 'save_result', { result: 'failure', source_surface: 'first_run' });
            return false;
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
                    onboardingDone: true,
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
                buildGroupPreferencesPayload(visibleGroupDraftIds, favoriteGroupDraftId)
            );
            if (!preferenceResponse.ok) {
                const errorPayload = await preferenceResponse.json().catch(() => ({}));
                const error = new Error(errorPayload.message || errorPayload.error || `Preference save failed (${preferenceResponse.status})`);
                error.status = preferenceResponse.status;
                error.code = errorPayload.error;
                error.loginUrl = errorPayload.loginUrl;
                throw error;
            }
            const preferencePayload = await preferenceResponse.json();
            const nextPreferences = normalizeGroupPreferences({
                preferences: preferencePayload.preferences || preferencePayload,
            }).preferences;
            const snapshot = preferencePayload.groupsConfigSnapshot
                ? normalizeGroupPreferences(preferencePayload.groupsConfigSnapshot)
                : null;
            if (snapshot) {
                applyPreferenceGroupsSnapshot?.({ ...snapshot, preferences: nextPreferences });
            }
            setGroupPreferences(nextPreferences);
            setVisibleGroupDraftIds(nextPreferences.visibleGroupIds || []);
            setFavoriteGroupDraftId(nextPreferences.activeGroupId || null);
            groupPreferencesBaselineRef.current = groupPreferencesSignature(nextPreferences);
            setActiveGroupId(nextPreferences.activeGroupId || null);
            trackSettingsAction('departments', 'preference_change', {
                result: 'success',
                selection_count_bucket: bucketCount(visibleGroupDraftIds.length),
            });
            return nextPreferences;
        } catch (error) {
            if (isAuthenticationRequiredError(error)) return null;
            throw error;
        } finally {
            setGroupPreferencesSaving(false);
        }
    }, [backendUrl, visibleGroupDraftIds, favoriteGroupDraftId, activeGroupId, setActiveGroupId, trackSettingsAction, bucketCount, useBackendPreferences, applyPreferenceGroupsSnapshot]);

    return {
        groupPreferences,
        setGroupPreferences,
        groupPreferencesBaselineRef,
        visibleGroupDraftIds,
        setVisibleGroupDraftIds,
        favoriteGroupDraftId,
        setFavoriteGroupDraftId,
        setFavoriteGroupDraft,
        favoriteGroupValidationError,
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
        firstRunSaving,
        firstRunError,
        persistGroupPreferences,
    };
}
