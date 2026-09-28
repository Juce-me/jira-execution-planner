import { effectiveVisibleGroupIds, normalizeGroupPreferences, resolveVisibleActiveGroupId } from './groupVisibilityUtils.js';
import { ONBOARDING_MODULE_IDS } from '../onboarding/onboardingModules.js';
import { normalizeStoredBoard } from './groupBoardModel.js';

// Shared group payload version: bumped from 1 to 2 to carry one-to-three Jira
// label aliases per Team (`teamLabels[teamId]` as an array) instead of one
// scalar label. See docs/features/eng-workflows.md.
export const GROUPS_CONFIG_VERSION = 2;

// A legacy scalar (not an array) becomes its single-entry source list. A
// numeric legacy scalar (e.g. a hand-edited groups file with a bare `2026`)
// is coerced to its string form; non-string entries inside an array are
// still left as-is so they get rejected below.
function legacyScalarLabelSource(rawValue) {
    if (Array.isArray(rawValue)) return rawValue;
    if (rawValue === null || rawValue === undefined) return [];
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return [String(rawValue).trim()];
    return [rawValue];
}

// A Team's Jira label aliases: trim, drop blanks, and dedupe case-insensitively
// while preserving order and the first-seen spelling. Accepts the legacy
// scalar shape or the canonical array shape. Never mutates its input and
// never reports errors; use `validateTeamLabelAliases` when bounds/duplicate/
// type problems must be surfaced (Settings JSON import).
export function normalizeTeamLabelAliases(rawValue) {
    const source = legacyScalarLabelSource(rawValue);
    const seenLower = new Set();
    const aliases = [];
    source.forEach((entry) => {
        if (typeof entry !== 'string') return;
        const value = entry.trim();
        if (!value) return;
        const key = value.toLowerCase();
        if (seenLower.has(key)) return;
        seenLower.add(key);
        aliases.push(value);
    });
    return aliases;
}

// Settings JSON import validation only: same normalization as
// `normalizeTeamLabelAliases`, but surfaces the first label-free problem
// (invalid type, duplicate, or more than three aliases) instead of silently
// dropping/deduping it, so the operator's import is rejected rather than
// silently truncated.
export function validateTeamLabelAliases(rawValue) {
    const source = legacyScalarLabelSource(rawValue);
    let hasInvalidEntry = false;
    const trimmed = [];
    source.forEach((entry) => {
        if (typeof entry !== 'string') {
            hasInvalidEntry = true;
            return;
        }
        const value = entry.trim();
        if (value) trimmed.push(value);
    });

    const seenLower = new Set();
    let hasDuplicate = false;
    const aliases = [];
    trimmed.forEach((value) => {
        const key = value.toLowerCase();
        if (seenLower.has(key)) {
            hasDuplicate = true;
            return;
        }
        seenLower.add(key);
        aliases.push(value);
    });

    let error = null;
    if (hasInvalidEntry) error = 'has an invalid Jira label.';
    else if (hasDuplicate) error = 'has duplicate Jira labels.';
    else if (aliases.length > 3) error = 'has more than 3 Jira labels.';

    return { aliases, error };
}

export const TEAM_LABEL_ALIAS_LIMIT = 3;

// Settings editor add: returns a new map with `label` appended to the Team's
// aliases, or the untouched source map with status `duplicate`, `limit`, or
// `empty` so a stale selection never mutates the draft.
export function addTeamLabelAlias(teamLabels, teamId, label) {
    const source = teamLabels || {};
    const value = String(label || '').trim();
    if (!value) return { teamLabels: source, status: 'empty' };
    const aliases = normalizeTeamLabelAliases(source[teamId]);
    if (aliases.some(alias => alias.toLowerCase() === value.toLowerCase())) {
        return { teamLabels: source, status: 'duplicate' };
    }
    if (aliases.length >= TEAM_LABEL_ALIAS_LIMIT) return { teamLabels: source, status: 'limit' };
    return { teamLabels: { ...source, [teamId]: [...aliases, value] }, status: 'added' };
}

// Settings editor remove: drops only `label`; the Team's entry is removed with
// its last alias.
export function removeTeamLabelAlias(teamLabels, teamId, label) {
    const next = { ...(teamLabels || {}) };
    const remaining = normalizeTeamLabelAliases(next[teamId]).filter(alias => alias !== label);
    if (remaining.length) next[teamId] = remaining;
    else delete next[teamId];
    return next;
}

// Settings JSON import gate: the first label-free problem in an imported
// group's `teamLabels`, or null. Invalid imports are rejected, never truncated.
export function validateImportedTeamLabels(rawTeamLabels) {
    if (rawTeamLabels === undefined || rawTeamLabels === null) return null;
    if (typeof rawTeamLabels !== 'object' || Array.isArray(rawTeamLabels)) {
        return 'Import rejected: Team labels must map each Team to its Jira labels.';
    }
    for (const rawValue of Object.values(rawTeamLabels)) {
        const { error } = validateTeamLabelAliases(rawValue);
        if (error) return `Import rejected: a Team ${error}`;
    }
    return null;
}

// Ordered, case-insensitively distinct union of aliases across the requested
// Teams (all mapped Teams when `teamIds` is omitted).
export function flattenTeamLabelAliases(teamLabels, teamIds) {
    const map = teamLabels || {};
    const keys = Array.isArray(teamIds) && teamIds.length ? teamIds : Object.keys(map);
    const seenLower = new Set();
    const flattened = [];
    keys.forEach((teamId) => {
        const aliases = normalizeTeamLabelAliases(map[teamId]);
        aliases.forEach((value) => {
            const key = value.toLowerCase();
            if (seenLower.has(key)) return;
            seenLower.add(key);
            flattened.push(value);
        });
    });
    return flattened;
}

// A Team matches when any of its aliases is present in the Epic's Jira
// labels, case-insensitively (frontend Epic classification semantics).
export function epicMatchesTeamAliases(epicLabels, aliases) {
    const normalizedEpicLabels = new Set(
        (Array.isArray(epicLabels) ? epicLabels : [])
            .map((label) => String(label || '').trim().toLowerCase())
            .filter(Boolean)
    );
    return (Array.isArray(aliases) ? aliases : [])
        .some((alias) => normalizedEpicLabels.has(String(alias || '').trim().toLowerCase()));
}

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
                    .map(([teamId, rawValue]) => [String(teamId || '').trim(), normalizeTeamLabelAliases(rawValue)])
                    .filter(([teamId, aliases]) => teamId && aliases.length > 0)
            ),
            // Omitted rather than assigned `undefined`: Dashboard distinguishes an absent board
            // with hasOwnProperty, while an explicit empty columns array must remain present and
            // invalid so the unified Save gate blocks it.
            ...(Array.isArray(group?.board?.columns)
                ? { board: normalizeStoredBoard(group.board) }
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
        version: Number(config?.version) || GROUPS_CONFIG_VERSION,
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
