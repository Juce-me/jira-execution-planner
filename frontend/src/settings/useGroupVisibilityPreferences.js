import React from 'react';

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
    trackSettingsAction,
    bucketCount,
    useBackendPreferences = true,
}) {
    const [groupPreferences, setGroupPreferences] = React.useState(EMPTY_GROUP_PREFERENCES);
    const [groupPreferencesSaving, setGroupPreferencesSaving] = React.useState(false);
    const [visibleGroupDraftIds, setVisibleGroupDraftIds] = React.useState([]);
    const [firstRunSelectedGroupIds, setFirstRunSelectedGroupIds] = React.useState([]);
    const [firstRunSaving, setFirstRunSaving] = React.useState(false);
    const [firstRunError, setFirstRunError] = React.useState('');
    const groupPreferencesBaselineRef = React.useRef('');

    const firstRunGroupsSignature = React.useMemo(() => (
        (groupsConfig.groups || []).map(group => group.id).join('|')
    ), [groupsConfig.groups]);

    React.useEffect(() => {
        if (!groupPreferences.onboardingRequired) {
            setFirstRunSelectedGroupIds([]);
            setFirstRunError('');
            return;
        }
        const defaultGroupId = String(groupsConfig.defaultGroupId || '').trim();
        const hasDefault = defaultGroupId && (groupsConfig.groups || []).some(group => group.id === defaultGroupId);
        const initial = hasDefault
            ? [defaultGroupId]
            : ((groupsConfig.groups || []).length === 1 ? [groupsConfig.groups[0].id] : []);
        setFirstRunSelectedGroupIds(initial);
        setFirstRunError('');
    }, [groupPreferences.onboardingRequired, firstRunGroupsSignature, groupsConfig.defaultGroupId]);

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

    const toggleFirstRunGroup = React.useCallback((groupId) => {
        const normalizedId = String(groupId || '').trim();
        if (!normalizedId) return;
        setFirstRunSelectedGroupIds(prev => (
            prev.includes(normalizedId)
                ? prev.filter(id => id !== normalizedId)
                : [...prev, normalizedId]
        ));
    }, []);

    const saveFirstRunGroupPreferences = React.useCallback(async () => {
        if (!firstRunSelectedGroupIds.length) return;
        setFirstRunSaving(true);
        setFirstRunError('');
        try {
            const response = await requestSaveGroupPreferences(
                backendUrl,
                buildFirstRunGroupPreferencesPayload(firstRunSelectedGroupIds, groupsConfig.defaultGroupId)
            );
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || errorPayload.error || `Preference save failed (${response.status})`);
            }
            const payload = await response.json();
            const nextPreferences = normalizeGroupPreferences({
                preferences: payload.preferences || payload,
            }).preferences;
            setGroupPreferences(nextPreferences);
            setVisibleGroupDraftIds(nextPreferences.visibleGroupIds || []);
            groupPreferencesBaselineRef.current = groupPreferencesSignature(nextPreferences);
            setActiveGroupId(prev => {
                const effectiveIds = effectiveVisibleGroupIds(groupsConfig, nextPreferences);
                return resolveVisibleActiveGroupId(groupsConfig, effectiveIds, nextPreferences.activeGroupId || prev);
            });
            trackSettingsAction('departments', 'first_run_selection', {
                selected_count_bucket: bucketCount(firstRunSelectedGroupIds.length),
                group_count_bucket: bucketCount((groupsConfig.groups || []).length),
            });
        } catch (error) {
            setFirstRunError(error?.message || 'Failed to save departments.');
            trackSettingsAction('departments', 'save_result', { result: 'failure', source_surface: 'first_run' });
        } finally {
            setFirstRunSaving(false);
        }
    }, [backendUrl, firstRunSelectedGroupIds, groupsConfig, setActiveGroupId, trackSettingsAction, bucketCount]);

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
        setGroupPreferences(prev => ({ ...prev, onboardingRequired: false }));
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
        firstRunSelectedGroupIds,
        toggleFirstRunGroup,
        saveFirstRunGroupPreferences,
        openFirstRunAddGroup,
        firstRunSaving,
        firstRunError,
        persistGroupPreferences,
    };
}
