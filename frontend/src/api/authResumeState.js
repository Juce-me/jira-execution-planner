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

const SENSITIVE_TEXT = /(?:^|[^a-z])(api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|bearer|response[_-]?(?:body|data)|config[_-]?draft|oauth|pkce|state)(?:$|[^a-z])/i;
const EMAIL_TEXT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanString = (value, max = 255) => typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';

const isSafeString = value => value == null || (typeof value === 'string'
    && !EMAIL_TEXT.test(value.trim())
    && !SENSITIVE_TEXT.test(value));

const cleanList = (values, maxItems) => {
    if (!Array.isArray(values) || values.length > maxItems || values.some(value => !isSafeString(value))) {
        return null;
    }
    return [...new Set(values.map(value => cleanString(value)).filter(Boolean))];
};

function normalizePrincipal(value) {
    if (!isSafeString(value?.workspaceId) || !isSafeString(value?.viewConfigId)) return null;
    const workspaceId = cleanString(value?.workspaceId);
    const viewConfigId = cleanString(value?.viewConfigId);
    return workspaceId && viewConfigId ? { workspaceId, viewConfigId } : null;
}

function normalizeSnapshot(value, capturedAt) {
    const principal = normalizePrincipal(value?.principal);
    if (!principal) return null;
    const selectedView = value?.view?.selectedView;
    const engMode = value?.view?.engMode;
    const settingsTab = value?.view?.settingsTab;
    const selectionMode = value?.planning?.selectionMode;
    const selectedTaskKeys = cleanList(value?.planning?.selectedTaskKeys, 500);
    const selectedTeams = cleanList(value?.planning?.selectedTeams, 200);
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
        || !isSafeString(value?.view?.activeGroupId)
        || !isSafeString(value?.view?.selectedSprint)
        || !isSafeString(value?.planning?.scopeKey)
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
            if (existingPrincipal && readAuthResumeState(storage, existingPrincipal, now)) return false;
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
        const normalized = normalizeSnapshot(parsed, capturedAt);
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
