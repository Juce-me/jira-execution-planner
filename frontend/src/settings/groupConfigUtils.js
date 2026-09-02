import { effectiveVisibleGroupIds, normalizeGroupPreferences, resolveVisibleActiveGroupId } from './groupVisibilityUtils.js';
import { ONBOARDING_MODULE_IDS } from '../onboarding/onboardingModules.js';

const normalizeEpicKeys = (values) => {
    const source = Array.isArray(values) ? values : (typeof values === 'string' && values.trim() ? [values] : []);
    const seen = new Set();
    const normalized = [];
    source.forEach((value) => {
        const key = String(value || '').trim().toUpperCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        normalized.push(key);
    });
    return normalized;
};

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
            excludedCapacityEpics: normalizeEpicKeys(group?.excludedCapacityEpics),
            adHocCapacityEpics: normalizeEpicKeys(group?.adHocCapacityEpics),
            teamLabels: Object.fromEntries(
                Object.entries(group?.teamLabels || {})
                    .map(([teamId, label]) => [String(teamId || '').trim(), String(label || '').trim()])
                    .filter(([teamId, label]) => teamId && label)
            ),
            // Omitted rather than assigned `undefined`: Dashboard distinguishes an absent board
            // with hasOwnProperty, while an explicit empty columns array must remain present and
            // invalid so the unified Save gate blocks it.
            ...(Array.isArray(group?.board?.columns)
                ? { board: { columns: [...group.board.columns] } }
                : {}),
        }))
        .filter(group => group.id && group.name);
    const source = String(config?.source || '').trim();
    const normalizedPreferences = normalizeGroupPreferences({ preferences: config?.preferences || {} }).preferences;
    const preferences = source === 'workspace_db'
        ? normalizedPreferences
        : {
            ...normalizedPreferences,
            completedOnboardingModules: [...ONBOARDING_MODULE_IDS],
            onboardingDone: true,
        };
    return {
        version: Number(config?.version) || 1,
        groups,
        defaultGroupId: String(config?.defaultGroupId || '').trim(),
        configRevision: Number.isFinite(Number(config?.configRevision)) ? Number(config.configRevision) : null,
        source,
        preferences,
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
        completedOnboardingModules: [...ONBOARDING_MODULE_IDS],
        onboardingDone: true,
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

    const blockedGroup = (config?.groups || []).find(group => {
        if (String(group?.id || '').trim() !== targetGroupId) return false;
        const excluded = new Set(normalizeEpicKeys(group.excludedCapacityEpics));
        const adHoc = new Set(normalizeEpicKeys(group.adHocCapacityEpics));
        return !excluded.has(normalizedEpicKey) && adHoc.has(normalizedEpicKey);
    });
    if (blockedGroup) {
        return {
            config,
            changed: false,
            nextExcluded: false,
            error: `${normalizedEpicKey} is configured as Ad Hoc capacity for this group. Remove it from Ad Hoc capacity before excluding it.`
        };
    }

    let changed = false;
    let nextExcluded = false;
    const groups = (config?.groups || []).map(group => {
        if (String(group?.id || '').trim() !== targetGroupId) return group;
        const existing = normalizeEpicKeys(group.excludedCapacityEpics);
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

// The one-line Board summary shared by the Team groups pointer entry and the Boards tab's own
// group list rows, so the two surfaces can never drift into different wording for the same group.
export function formatGroupBoardSummary(board) {
    const columnCount = Array.isArray(board?.columns) ? board.columns.length : 0;
    if (!columnCount) return 'No board configured';
    return `${columnCount} column${columnCount === 1 ? '' : 's'}`;
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
