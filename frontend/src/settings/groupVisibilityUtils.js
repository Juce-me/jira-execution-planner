const normalizeId = (id) => String(id || '').trim();

const uniqueIds = (ids) => {
    const seen = new Set();
    const result = [];
    (Array.isArray(ids) ? ids : []).forEach((id) => {
        const normalized = normalizeId(id);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
};

const groupIds = (groupsConfig) =>
    (groupsConfig?.groups || []).map(group => normalizeId(group?.id)).filter(Boolean);

export const normalizeGroupPreferences = (payload) => {
    const normalized = { ...(payload || {}) };
    const preferences = normalized.preferences || normalized;
    normalized.preferences = {
        ...(preferences || {}),
        preferenceExists: Boolean(preferences?.preferenceExists),
        customized: Boolean(preferences?.customized),
        onboardingRequired: Boolean(preferences?.onboardingRequired),
        visibleGroupIds: uniqueIds(preferences?.visibleGroupIds),
        effectiveVisibleGroupIds: uniqueIds(preferences?.effectiveVisibleGroupIds),
        activeGroupId: normalizeId(preferences?.activeGroupId) || null,
    };
    return normalized;
};

export const effectiveVisibleGroupIds = (groupsConfig, preferences) => {
    const ids = groupIds(groupsConfig);
    if (preferences?.onboardingRequired) return [];
    if (!preferences?.customized) return ids;

    const knownIds = new Set(ids);
    const result = [];
    const defaultGroupId = normalizeId(groupsConfig?.defaultGroupId);
    if (defaultGroupId && knownIds.has(defaultGroupId)) {
        result.push(defaultGroupId);
    }
    uniqueIds(preferences?.visibleGroupIds).forEach((id) => {
        if (knownIds.has(id) && !result.includes(id)) {
            result.push(id);
        }
    });
    return result;
};

export const visibleGroupsForControls = (groupsConfig, preferences) => {
    const visibleIds = new Set(effectiveVisibleGroupIds(groupsConfig, preferences));
    return (groupsConfig?.groups || []).filter(group => visibleIds.has(normalizeId(group?.id)));
};

export const resolveVisibleActiveGroupId = (groupsConfig, visibleGroupIds, currentActiveGroupId) => {
    const visibleIds = uniqueIds(visibleGroupIds);
    const visibleSet = new Set(visibleIds);
    const activeId = normalizeId(currentActiveGroupId);
    if (activeId && visibleSet.has(activeId)) return activeId;

    const defaultGroupId = normalizeId(groupsConfig?.defaultGroupId);
    if (defaultGroupId && visibleSet.has(defaultGroupId)) return defaultGroupId;
    return visibleIds[0] || null;
};

export const buildGroupPreferencesPayload = (visibleGroupIds, activeGroupId) => ({
    visibleGroupIds: uniqueIds(visibleGroupIds),
    activeGroupId: normalizeId(activeGroupId) || null,
});

export const buildFirstRunGroupPreferencesPayload = (selectedGroupIds, defaultGroupId) => {
    const visibleGroupIds = uniqueIds([defaultGroupId, ...uniqueIds(selectedGroupIds)]);
    const selectedIds = uniqueIds(selectedGroupIds);
    return {
        visibleGroupIds,
        activeGroupId: selectedIds[0] || normalizeId(defaultGroupId) || null,
    };
};

export const buildSharedGroupsPayload = (groupDraft) => ({
    version: groupDraft?.version || 1,
    baseRevision: groupDraft?.configRevision,
    groups: groupDraft?.groups || [],
    defaultGroupId: groupDraft?.defaultGroupId || '',
});

export const groupPreferencesSignature = (preferences) => JSON.stringify({
    visibleGroupIds: uniqueIds(preferences?.visibleGroupIds).sort(),
    activeGroupId: normalizeId(preferences?.activeGroupId) || null,
});
