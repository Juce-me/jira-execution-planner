import { effectiveVisibleGroupIds, normalizeGroupPreferences, resolveVisibleActiveGroupId } from './groupVisibilityUtils.js';

export function normalizeGroupsConfig(config) {
    const rawGroups = Array.isArray(config?.groups) ? config.groups : [];
    const groups = rawGroups
        .map(group => ({
            id: String(group?.id || '').trim(),
            name: String(group?.name || '').trim(),
            teamIds: Array.isArray(group?.teamIds)
                ? group.teamIds.map(id => String(id || '').trim()).filter(Boolean)
                : [],
            missingInfoComponents: Array.isArray(group?.missingInfoComponents)
                ? group.missingInfoComponents.map(c => String(c || '').trim()).filter(Boolean)
                : (group?.missingInfoComponent ? [String(group.missingInfoComponent).trim()] : []),
            excludedCapacityEpics: Array.isArray(group?.excludedCapacityEpics)
                ? group.excludedCapacityEpics.map(key => String(key || '').trim().toUpperCase()).filter(Boolean)
                : [],
            teamLabels: Object.fromEntries(
                Object.entries(group?.teamLabels || {})
                    .map(([teamId, label]) => [String(teamId || '').trim(), String(label || '').trim()])
                    .filter(([teamId, label]) => teamId && label)
            ),
        }))
        .filter(group => group.id && group.name);
    return {
        version: Number(config?.version) || 1,
        groups,
        defaultGroupId: String(config?.defaultGroupId || '').trim(),
        configRevision: Number.isFinite(Number(config?.configRevision)) ? Number(config.configRevision) : null,
        source: String(config?.source || '').trim(),
        preferences: normalizeGroupPreferences({ preferences: config?.preferences || {} }).preferences,
    };
}

export function applyLocalGroupPreferences(config, prefs = {}) {
    const normalized = normalizeGroupsConfig(config);
    if (normalized.source === 'workspace_db') return normalized;
    const saved = prefs?.groupVisibilityPreferences || {};
    if (!Array.isArray(saved.visibleGroupIds)) return normalized;
    const draftPreferences = {
        customized: true,
        preferenceExists: true,
        onboardingRequired: false,
        visibleGroupIds: saved.visibleGroupIds,
        activeGroupId: saved.activeGroupId || null,
    };
    const effective = effectiveVisibleGroupIds(normalized, draftPreferences);
    return {
        ...normalized,
        preferences: {
            ...draftPreferences,
            activeGroupId: resolveVisibleActiveGroupId(normalized, effective, saved.activeGroupId),
            effectiveVisibleGroupIds: effective,
        },
    };
}

export function resolveInitialGroupId(config) {
    if (!config?.groups?.length) return null;
    if (config.defaultGroupId && config.groups.some(group => group.id === config.defaultGroupId)) {
        return config.defaultGroupId;
    }
    const defaultGroup = config.groups.find(group => group.name.toLowerCase() === 'default');
    if (defaultGroup) return defaultGroup.id;
    return config.groups[0].id;
}

export function buildGroupsConfigWithExcludedCapacityToggle(config, groupId, epicKey) {
    const targetGroupId = String(groupId || '').trim();
    const normalizedEpicKey = String(epicKey || '').trim().toUpperCase();
    if (!targetGroupId || !normalizedEpicKey) {
        return { config, changed: false, nextExcluded: false };
    }

    let changed = false;
    let nextExcluded = false;
    const groups = (config?.groups || []).map(group => {
        if (String(group?.id || '').trim() !== targetGroupId) return group;
        const existing = Array.isArray(group.excludedCapacityEpics)
            ? group.excludedCapacityEpics.map(key => String(key || '').trim().toUpperCase()).filter(Boolean)
            : [];
        const seen = new Set();
        const normalizedExisting = [];
        existing.forEach(key => {
            if (!key || seen.has(key)) return;
            seen.add(key);
            normalizedExisting.push(key);
        });
        const hasKey = seen.has(normalizedEpicKey);
        changed = true;
        nextExcluded = !hasKey;
        return {
            ...group,
            excludedCapacityEpics: hasKey
                ? normalizedExisting.filter(key => key !== normalizedEpicKey)
                : [...normalizedExisting, normalizedEpicKey]
        };
    });

    if (!changed) return { config, changed: false, nextExcluded: false };
    return {
        config: {
            ...config,
            groups
        },
        changed,
        nextExcluded
    };
}

export function buildGroupId(name, existingIds) {
    const base = String(name || 'group')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'group';
    let candidate = base;
    let index = 1;
    while (existingIds.has(candidate)) {
        candidate = `${base}-${index}`;
        index += 1;
    }
    return candidate;
}

export function parseTeamIdList(raw) {
    return String(raw || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

export function buildTeamCatalogList(catalog) {
    if (!catalog || typeof catalog !== 'object') return [];
    return Object.values(catalog)
        .filter(entry => entry && entry.id && entry.name)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeTeamCatalog(catalog, teams) {
    const next = { ...(catalog || {}) };
    (teams || []).forEach(team => {
        if (!team?.id || !team?.name) return;
        next[String(team.id)] = { id: String(team.id), name: String(team.name) };
    });
    return next;
}
