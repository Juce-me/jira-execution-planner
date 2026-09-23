import { normalizeScenarioDraftOverrides } from '../scenario/scenarioDraftOverrides.js';

export const CONNECTION_RECOVERY_STORAGE_KEY = 'jira_dashboard_connection_recovery_v1';
export const CONNECTION_RECOVERY_ATTEMPT_KEY = 'jira_dashboard_connection_recovery_attempt_v1';
export const CONNECTION_RECOVERY_VERSION = 1;
export const CONNECTION_RECOVERY_TTL_MS = 30 * 60 * 1000;
export const CONNECTION_RECOVERY_MAX_BYTES = 512 * 1024;

const SNAPSHOT_KEYS = ['droppedSettings', 'outage', 'principal', 'scenario', 'view'];
const STORED_KEYS = ['capturedAt', ...SNAPSHOT_KEYS, 'version'];
const PRINCIPAL_KEYS = ['viewConfigId', 'workspaceId'];
const OUTAGE_KEYS = ['id'];
const VIEW_KEYS = ['activeGroupId', 'engMode', 'scrollX', 'scrollY', 'selectedSprint', 'selectedView'];
const SCENARIO_KEYS = [
    'activeDraftId', 'baseDraftRevision', 'editMode', 'localOverrides', 'savedOverrides',
    'scopeKey', 'scrollLeft', 'scrollTop',
];
const OVERRIDE_KEYS = ['end', 'start'];
const ATTEMPT_KEYS = ['attemptedAt', 'outageId', 'version'];

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.prototype.toString.call(value) === '[object Object]';
}

function hasExactKeys(value, expected) {
    return isRecord(value)
        && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}

function boundedString(value, max = 256, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized && normalized.length <= max ? normalized : undefined;
}

function finitePosition(value) {
    return Number.isFinite(value) && value >= 0 && value <= 10_000_000 ? value : undefined;
}

function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizePrincipal(value) {
    if (!hasExactKeys(value, PRINCIPAL_KEYS)) return null;
    const workspaceId = boundedString(value.workspaceId);
    const viewConfigId = boundedString(value.viewConfigId);
    return workspaceId && viewConfigId ? { workspaceId, viewConfigId } : null;
}

function normalizeOutage(value) {
    if (!hasExactKeys(value, OUTAGE_KEYS)) return null;
    const id = boundedString(value.id, 128);
    return id ? { id } : null;
}

function normalizeView(value) {
    if (!hasExactKeys(value, VIEW_KEYS)) return null;
    const selectedView = boundedString(value.selectedView, 32);
    const activeGroupId = boundedString(value.activeGroupId, 256, { nullable: true });
    const selectedSprint = boundedString(value.selectedSprint, 256, { nullable: true });
    const engMode = boundedString(value.engMode, 32, { nullable: true });
    const scrollX = finitePosition(value.scrollX);
    const scrollY = finitePosition(value.scrollY);
    if (!selectedView || activeGroupId === undefined || selectedSprint === undefined
        || engMode === undefined || scrollX === undefined || scrollY === undefined) return null;
    return { selectedView, activeGroupId, selectedSprint, engMode, scrollX, scrollY };
}

function normalizeOverrideMap(value) {
    if (!isRecord(value) || Object.keys(value).length > 2_000) return null;
    for (const [issueKey, override] of Object.entries(value)) {
        if (!hasExactKeys(override, OVERRIDE_KEYS)) return null;
        if (typeof override.start !== 'string' || typeof override.end !== 'string') return null;
        const normalizedSingle = normalizeScenarioDraftOverrides({ [issueKey]: override });
        if (!Object.hasOwn(normalizedSingle, issueKey)) return null;
        if (normalizedSingle[issueKey].start !== override.start || normalizedSingle[issueKey].end !== override.end) return null;
    }
    return normalizeScenarioDraftOverrides(value);
}

function normalizeScenario(value) {
    if (value === null) return null;
    if (!hasExactKeys(value, SCENARIO_KEYS)) return undefined;
    const scopeKey = boundedString(value.scopeKey, 512);
    const activeDraftId = boundedString(value.activeDraftId, 256, { nullable: true });
    const baseDraftRevision = nonNegativeInteger(value.baseDraftRevision);
    const savedOverrides = normalizeOverrideMap(value.savedOverrides);
    const localOverrides = normalizeOverrideMap(value.localOverrides);
    const scrollTop = finitePosition(value.scrollTop);
    const scrollLeft = finitePosition(value.scrollLeft);
    if (!scopeKey || activeDraftId === undefined || baseDraftRevision === undefined
        || savedOverrides === null || localOverrides === null || typeof value.editMode !== 'boolean'
        || scrollTop === undefined || scrollLeft === undefined) return undefined;
    return {
        scopeKey, activeDraftId, baseDraftRevision, savedOverrides, localOverrides,
        editMode: value.editMode, scrollTop, scrollLeft,
    };
}

function normalizeSnapshot(value, stored = false) {
    if (!hasExactKeys(value, stored ? STORED_KEYS : SNAPSHOT_KEYS)) return null;
    const principal = normalizePrincipal(value.principal);
    const outage = normalizeOutage(value.outage);
    const view = normalizeView(value.view);
    const scenario = normalizeScenario(value.scenario);
    if (!principal || !outage || !view || scenario === undefined || typeof value.droppedSettings !== 'boolean') return null;
    const normalized = { principal, outage, view, droppedSettings: value.droppedSettings, scenario };
    if (!stored) return normalized;
    if (value.version !== CONNECTION_RECOVERY_VERSION || !Number.isFinite(value.capturedAt) || value.capturedAt < 0) return null;
    return { version: value.version, capturedAt: value.capturedAt, ...normalized };
}

function validNow(now) {
    return Number.isFinite(now) && now >= 0;
}

function encodedBytes(value) {
    return new TextEncoder().encode(value).byteLength;
}

export function getConnectionRecoveryStorage(win = globalThis.window) {
    try {
        return win?.sessionStorage || null;
    } catch (error) {
        return null;
    }
}

export function writeConnectionRecoveryState(storage, snapshot, now = Date.now()) {
    if (!storage || !validNow(now)) return false;
    const normalized = normalizeSnapshot(snapshot, false);
    if (!normalized) return false;
    const encoded = JSON.stringify({ version: CONNECTION_RECOVERY_VERSION, capturedAt: now, ...normalized });
    if (encodedBytes(encoded) > CONNECTION_RECOVERY_MAX_BYTES) return false;
    try {
        storage.setItem(CONNECTION_RECOVERY_STORAGE_KEY, encoded);
        return true;
    } catch (error) {
        return false;
    }
}

export function readConnectionRecoveryState(storage, principal, now = Date.now()) {
    if (!storage || !validNow(now)) return null;
    let raw;
    try {
        raw = storage.getItem(CONNECTION_RECOVERY_STORAGE_KEY);
        if (!raw || encodedBytes(raw) > CONNECTION_RECOVERY_MAX_BYTES) throw new Error('invalid recovery capsule');
        const normalized = normalizeSnapshot(JSON.parse(raw), true);
        const expectedPrincipal = normalizePrincipal(principal);
        if (!normalized || !expectedPrincipal || normalized.capturedAt > now
            || now - normalized.capturedAt > CONNECTION_RECOVERY_TTL_MS
            || normalized.principal.workspaceId !== expectedPrincipal.workspaceId
            || normalized.principal.viewConfigId !== expectedPrincipal.viewConfigId) {
            throw new Error('invalid recovery capsule');
        }
        return normalized;
    } catch (error) {
        clearConnectionRecoveryState(storage);
        return null;
    }
}

export function clearConnectionRecoveryState(storage = getConnectionRecoveryStorage()) {
    try {
        storage?.removeItem(CONNECTION_RECOVERY_STORAGE_KEY);
    } catch (error) {
        // Recovery storage is best-effort outside a dirty Scenario preservation boundary.
    }
}

export function markConnectionRecoveryAttempt(storage, outageId, now = Date.now()) {
    const normalizedId = boundedString(outageId, 128);
    if (!storage || !normalizedId || !validNow(now)) return false;
    try {
        storage.setItem(CONNECTION_RECOVERY_ATTEMPT_KEY, JSON.stringify({
            version: CONNECTION_RECOVERY_VERSION,
            outageId: normalizedId,
            attemptedAt: now,
        }));
        return true;
    } catch (error) {
        return false;
    }
}

export function readConnectionRecoveryAttempt(storage, now = Date.now()) {
    if (!storage || !validNow(now)) return null;
    try {
        const value = JSON.parse(storage.getItem(CONNECTION_RECOVERY_ATTEMPT_KEY) || 'null');
        if (!hasExactKeys(value, ATTEMPT_KEYS) || value.version !== CONNECTION_RECOVERY_VERSION
            || !boundedString(value.outageId, 128) || !validNow(value.attemptedAt)
            || value.attemptedAt > now || now - value.attemptedAt > CONNECTION_RECOVERY_TTL_MS) {
            throw new Error('invalid recovery attempt');
        }
        return value;
    } catch (error) {
        clearConnectionRecoveryAttempt(storage);
        return null;
    }
}

export function canAutomaticallyRecoverConnection(storage, outageId, now = Date.now()) {
    const attempted = readConnectionRecoveryAttempt(storage, now);
    return !attempted || attempted.outageId !== String(outageId || '').trim();
}

export function clearConnectionRecoveryAttempt(storage = getConnectionRecoveryStorage()) {
    try {
        storage?.removeItem(CONNECTION_RECOVERY_ATTEMPT_KEY);
    } catch (error) {
        // The next explicit Retry remains available if storage is blocked.
    }
}
