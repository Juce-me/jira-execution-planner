import { saveGroupsConfig as requestSaveGroupsConfig } from '../api/configApi.js';
import { buildGroupsConfigWithExcludedCapacityToggle } from './groupConfigUtils.js';
import { buildSharedGroupsPayload } from './groupVisibilityUtils.js';

export async function saveSharedExcludedCapacityToggle({
    backendUrl,
    epicKey,
    activeGroupId,
    canEditSharedConfiguration,
    showGroupManage,
    isGroupDraftDirty,
    showPlanning,
    groupsConfig,
    applySavedGroupsConfig,
    setGroupDraftError,
    trackSettingsAction,
    groupStateRef,
    excludedCapacityCacheRef
} = {}) {
    const normalizedEpicKey = String(epicKey || '').trim().toUpperCase();
    if (!normalizedEpicKey || !activeGroupId) return;
    const sourceSurface = showPlanning ? 'planning' : 'statistics';
    if (!canEditSharedConfiguration) {
        setGroupDraftError('You do not have permission to edit shared department configuration.');
        trackSettingsAction('departments', 'toggle_excluded_capacity', {
            source_surface: sourceSurface,
            result: 'failure'
        });
        return;
    }
    if (showGroupManage && isGroupDraftDirty) {
        setGroupDraftError('Save or discard open Department settings changes before changing excluded capacity from the board.');
        trackSettingsAction('departments', 'toggle_excluded_capacity', {
            source_surface: sourceSurface,
            result: 'failure'
        });
        return;
    }

    const { config: nextGroupsConfig, changed, nextExcluded, error } = buildGroupsConfigWithExcludedCapacityToggle(
        groupsConfig,
        activeGroupId,
        normalizedEpicKey
    );
    if (error) {
        setGroupDraftError(error);
        trackSettingsAction('departments', 'toggle_excluded_capacity', {
            source_surface: sourceSurface,
            result: 'failure'
        });
        return;
    }
    if (!changed) return;

    setGroupDraftError('');
    trackSettingsAction('departments', 'toggle_excluded_capacity', {
        source_surface: sourceSurface,
        value_state: nextExcluded ? 'selected' : 'cleared'
    });

    try {
        const response = await requestSaveGroupsConfig(backendUrl, buildSharedGroupsPayload(nextGroupsConfig));
        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            if (response.status === 409 && errorPayload.current) {
                applySavedGroupsConfig(errorPayload.current);
                setGroupDraftError('Department groups were changed by another user. Reloaded latest group configuration; retry the excluded-capacity change.');
            } else {
                const errorMessage = errorPayload.message || (errorPayload.errors || []).join(' ') || errorPayload.error || `Save failed (${response.status})`;
                setGroupDraftError(errorMessage);
            }
            trackSettingsAction('departments', 'toggle_excluded_capacity_result', {
                source_surface: sourceSurface,
                result: 'failure'
            });
            return;
        }

        const payload = await response.json();
        applySavedGroupsConfig(payload);
        groupStateRef.current.delete(activeGroupId);
        excludedCapacityCacheRef.current = {};
        trackSettingsAction('departments', 'toggle_excluded_capacity_result', {
            source_surface: sourceSurface,
            result: 'success'
        });
    } catch (err) {
        setGroupDraftError(err.message || 'Failed to update excluded capacity.');
        trackSettingsAction('departments', 'toggle_excluded_capacity_result', {
            source_surface: sourceSurface,
            result: 'failure'
        });
    }
}
