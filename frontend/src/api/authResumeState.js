export const AUTH_RESUME_STORAGE_KEY = 'jira_dashboard_auth_resume_v1';
export const AUTH_RESUME_VERSION = 1;
export const AUTH_RESUME_TTL_MS = 30 * 60 * 1000;
export const AUTH_RESUME_MAX_BYTES = 64 * 1024;

export function getAuthResumeStorage(win = globalThis.window) {
    try { return win?.sessionStorage || null; } catch (error) { return null; }
}

const VIEW_IDS = new Set(['eng', 'epm']);
const ENG_MODES = new Set(['catch-up', 'planning', 'statistics', 'scenario', 'board']);
const SETTINGS_TABS = new Set([
    'scope', 'source', 'mapping', 'capacity', 'priorityWeights', 'access',
    'teams', 'labels', 'boards', 'epm', 'connections',
]);
const SELECTION_MODES = new Set(['manual', 'default_all']);

const cleanString = (value, max = 255) => typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';

const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const isLegacyId = value => typeof value === 'string' && value.trim().length > 0
    && value.trim().length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value.trim());
const isOptionalLegacyId = value => value == null || value === '' || isLegacyId(value);
const isScopeKey = value => {
    if (value === '') return true;
    if (typeof value !== 'string') return false;
    const match = /^planning::(.+)::(.+)$/.exec(value.trim());
    return Boolean(match && isLegacyId(match[1]) && isLegacyId(match[2]));
};

const cleanList = (values, maxItems, validator = isLegacyId) => {
    if (!Array.isArray(values) || values.length > maxItems || values.some(value => typeof value !== 'string' || !validator(value))) {
        return null;
    }
    return [...new Set(values.map(value => cleanString(value)).filter(Boolean))];
};

function normalizePrincipal(value) {
    if (!isLegacyId(value?.workspaceId) || !isLegacyId(value?.viewConfigId)) return null;
    const workspaceId = cleanString(value?.workspaceId);
    const viewConfigId = cleanString(value?.viewConfigId);
    return workspaceId && viewConfigId ? { workspaceId, viewConfigId } : null;
}

function hasExactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function normalizeSnapshot(value, capturedAt, strict = false) {
    if (strict && (!hasExactKeys(value, ['version', 'capturedAt', 'principal', 'view', 'planning'])
        || !hasExactKeys(value.principal, ['workspaceId', 'viewConfigId'])
        || !hasExactKeys(value.view, ['selectedView', 'activeGroupId', 'selectedSprint', 'engMode', 'settingsOpen', 'settingsTab'])
        || !hasExactKeys(value.planning, ['scopeKey', 'selectedTaskKeys', 'selectedTeams', 'selectionMode']))) return null;
    const principal = normalizePrincipal(value?.principal);
    if (!principal) return null;
    const selectedView = value?.view?.selectedView;
    const engMode = value?.view?.engMode;
    const settingsTab = value?.view?.settingsTab;
    const selectionMode = value?.planning?.selectionMode;
    const selectedTaskKeys = cleanList(value?.planning?.selectedTaskKeys, 500, value => JIRA_ISSUE_KEY.test(value.trim()));
    const selectedTeams = cleanList(value?.planning?.selectedTeams, 200, isLegacyId);
    const activeGroupId = cleanString(value?.view?.activeGroupId);
    const selectedSprint = cleanString(value?.view?.selectedSprint);
    const scopeKey = cleanString(value?.planning?.scopeKey, 512);
    if (
        !VIEW_IDS.has(selectedView)
        || !ENG_MODES.has(engMode)
        || !SETTINGS_TABS.has(settingsTab)
        || !SELECTION_MODES.has(selectionMode)
        || typeof value?.view?.settingsOpen !== 'boolean'
        || selectedTaskKeys === null
        || selectedTeams === null
        || !isOptionalLegacyId(value?.view?.activeGroupId)
        || !isOptionalLegacyId(value?.view?.selectedSprint)
        || !isScopeKey(value?.planning?.scopeKey)
    ) return null;
    return {
        version: AUTH_RESUME_VERSION,
        capturedAt,
        principal,
        view: {
            selectedView,
            activeGroupId,
            selectedSprint,
            engMode,
            settingsOpen: value?.view?.settingsOpen === true,
            settingsTab,
        },
        planning: {
            scopeKey,
            selectedTaskKeys,
            selectedTeams,
            selectionMode,
        },
    };
}

export function clearAuthResumeState(storage = getAuthResumeStorage()) {
    try { storage?.removeItem(AUTH_RESUME_STORAGE_KEY); } catch (error) { }
}

export function writeAuthResumeState(storage, snapshot, now = Date.now()) {
    try {
        if (!Number.isFinite(now) || now < 0) return false;
        const normalized = normalizeSnapshot(snapshot, now);
        if (!normalized || !storage) return false;
        let existing = '';
        try { existing = storage.getItem(AUTH_RESUME_STORAGE_KEY) || ''; } catch (error) { return false; }
        if (existing) {
            let existingPrincipal;
            try { existingPrincipal = JSON.parse(existing)?.principal; } catch (error) { existingPrincipal = null; }
            const existingState = existingPrincipal && readAuthResumeState(storage, existingPrincipal, now);
            if (existingState && existingState.principal.workspaceId === normalized.principal.workspaceId
                && existingState.principal.viewConfigId === normalized.principal.viewConfigId) return false;
        }
        const serialized = JSON.stringify(normalized);
        if (new TextEncoder().encode(serialized).byteLength > AUTH_RESUME_MAX_BYTES) return false;
        storage.setItem(AUTH_RESUME_STORAGE_KEY, serialized);
        return true;
    } catch (error) {
        return false;
    }
}

export function readAuthResumeState(storage, principal, now = Date.now()) {
    if (!Number.isFinite(now) || now < 0) return null;
    let raw = '';
    try { raw = storage?.getItem(AUTH_RESUME_STORAGE_KEY) || ''; } catch (error) { return null; }
    if (!raw || new TextEncoder().encode(raw).byteLength > AUTH_RESUME_MAX_BYTES) {
        clearAuthResumeState(storage);
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        const expected = normalizePrincipal(principal);
        const capturedAt = parsed?.capturedAt;
        const normalized = normalizeSnapshot(parsed, capturedAt, true);
        const validAge = typeof capturedAt === 'number'
            && Number.isFinite(capturedAt)
            && capturedAt >= 0
            && capturedAt <= now
            && now - capturedAt <= AUTH_RESUME_TTL_MS;
        const samePrincipal = expected && normalized
            && normalized.principal.workspaceId === expected.workspaceId
            && normalized.principal.viewConfigId === expected.viewConfigId;
        if (parsed?.version !== AUTH_RESUME_VERSION || !validAge || !samePrincipal) throw new Error('invalid_auth_resume');
        return normalized;
    } catch (error) {
        clearAuthResumeState(storage);
        return null;
    }
}
