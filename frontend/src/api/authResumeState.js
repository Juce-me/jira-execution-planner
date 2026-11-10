export const AUTH_RESUME_STORAGE_KEY = 'jira_dashboard_auth_resume_v1';
export const AUTH_RESUME_VERSION = 2;
export const AUTH_RESUME_TTL_MS = 30 * 60 * 1000;
export const AUTH_RESUME_MAX_BYTES = 640 * 1024;
export const AUTH_RESUME_DRAFT_MAX_BYTES = 256 * 1024;
const LEGACY_MAX_BYTES = 64 * 1024;

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

function normalizeLegacySnapshot(value, capturedAt, strict = false) {
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
        version: 1,
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

const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]';
const keysWithin = (value, required, optional = []) => isRecord(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const boundedId = value => isLegacyId(value) && value === value.trim();
// Match backend group_identity: Python code-point length, stripped edges and no Cc controls.
const groupIdentity = value => typeof value === 'string' && Array.from(value).length >= 1
    && Array.from(value).length <= 128 && !/\p{Cc}/u.test(value)
    && !/^\p{White_Space}|\p{White_Space}$/u.test(value);
const numericId = value => typeof value === 'string' && value.length <= 128 && /^[1-9][0-9]*$/.test(value);
const validRevision = value => Number.isInteger(value) && value >= 0 && value <= 2147483646;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const operationId = value => uuid(value) && value[14] === '7' && /^[89ab]$/.test(value[19]);
const boundedText = (value, limit) => typeof value === 'string' && Array.from(value).length <= limit;
const denseArray = value => Array.isArray(value) && Object.keys(value).length === value.length;
const idList = (values, limit) => denseArray(values) && values.length <= limit
    && values.every(value => typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_:\/-]+$/.test(value))
    && new Set(values).size === values.length;
const validLabel = value => boundedText(value, 80) && value.trim().length > 0;

function validSchemaChanges(changes, kinds) {
    if (!denseArray(changes) || changes.length > 120) return false;
    return changes.every(change => {
        if (!isRecord(change)) return false;
        if (change.action === 'add') {
            const column = change.column;
            return hasExactKeys(change, ['action', 'column'])
                && keysWithin(column, ['id', 'rowKind', 'label', 'type'], ['aggregation', 'archived', 'order', 'after'])
                && uuid(column.id) && kinds.includes(column.rowKind) && validLabel(column.label)
                && ['number', 'text'].includes(column.type)
                && (column.aggregation === undefined || ['sum', 'none'].includes(column.aggregation))
                && (column.type !== 'text' || column.aggregation === undefined || column.aggregation === 'none')
                && (column.archived === undefined || column.archived === false)
                && (column.order === undefined || validRevision(column.order))
                && (column.after === undefined || column.after === null || idList([column.after], 1));
        }
        if (change.action === 'layout') return hasExactKeys(change, ['action', 'rowKind', 'order', 'hidden'])
            && kinds.includes(change.rowKind) && idList(change.order, 254) && idList(change.hidden, 254);
        if (change.action === 'reorder') return hasExactKeys(change, ['action', 'rowKind', 'columnIds'])
            && kinds.includes(change.rowKind) && idList(change.columnIds, 240);
        const field = { rename: 'label', archive: 'archived', aggregation: 'aggregation' }[change.action];
        return Boolean(field && hasExactKeys(change, ['action', 'columnId', field]) && uuid(change.columnId)
            && (change.action === 'rename' ? validLabel(change.label)
                : change.action === 'archive' ? change.archived === true : ['sum', 'none'].includes(change.aggregation)));
    });
}

function validChanges(value, kinds, draft) {
    if (!denseArray(value.inclusionChanges) || value.inclusionChanges.length > 500
        || !denseArray(value.cellChanges) || value.cellChanges.length > 100
        || !validSchemaChanges(value.schemaChanges, kinds)) return false;
    const ids = new Set(), inclusionIds = new Set(), cells = new Set();
    for (const change of value.inclusionChanges) {
        if (!hasExactKeys(change, ['issueId', 'included', 'baseRevision']) || !numericId(change.issueId)
            || typeof change.included !== 'boolean' || !validRevision(change.baseRevision) || inclusionIds.has(change.issueId)) return false;
        inclusionIds.add(change.issueId); ids.add(change.issueId);
    }
    for (const cell of value.cellChanges) {
        if (!keysWithin(cell, ['issueId', 'rowKind', 'columnId', 'value', 'baseRevision'], draft ? ['input', 'valid'] : [])
            || !numericId(cell.issueId) || !kinds.includes(cell.rowKind) || !uuid(cell.columnId)
            || !validRevision(cell.baseRevision) || (cell.value !== null && !boundedText(cell.value, 500)
                && !(draft && cell.valid === false && typeof cell.input === 'string' && cell.value === cell.input))) return false;
        if (draft && (Object.hasOwn(cell, 'input') !== Object.hasOwn(cell, 'valid')
            || (Object.hasOwn(cell, 'input') && (typeof cell.input !== 'string' || typeof cell.valid !== 'boolean')))) return false;
        const key = `${cell.issueId}:${cell.rowKind}:${cell.columnId}`;
        if (cells.has(key)) return false;
        cells.add(key); ids.add(cell.issueId);
    }
    return ids.size <= 500;
}

const DRAFT_FIELDS = ['inclusionChanges', 'initializePlan', 'basePlanRevision', 'baseScopeProof', 'baseSchemaRevision', 'baseViewRevision', 'schemaChanges', 'cellChanges'];
const validBases = value => typeof value.initializePlan === 'boolean' && validRevision(value.basePlanRevision)
    && typeof value.baseScopeProof === 'string' && value.baseScopeProof.length > 0 && value.baseScopeProof.length <= 512
    && validRevision(value.baseSchemaRevision) && validRevision(value.baseViewRevision);

function validConfiguration(value, namespaceId) {
    return hasExactKeys(value, ['id', 'revision', 'quarter', 'digest']) && boundedId(value.id)
        && (namespaceId === null ? value.id === 'legacy' : value.id === namespaceId)
        && validRevision(value.revision) && typeof value.quarter === 'string' && /^[0-9]{4}Q[1-4]$/.test(value.quarter)
        && !value.quarter.startsWith('0000')
        && (value.digest === null || typeof value.digest === 'string' && value.digest.length > 0 && value.digest.length <= 512);
}

function normalizeSharedSnapshot(value, capturedAt, strict) {
    if (!keysWithin(value, ['version', 'principal', 'view', 'planning'], ['capturedAt'])
        || strict && !Object.hasOwn(value, 'capturedAt')
        || !hasExactKeys(value.principal, ['workspaceId', 'viewConfigId'])
        || !boundedId(value.principal.workspaceId) || !boundedId(value.principal.viewConfigId)
        || !hasExactKeys(value.view, ['selectedView', 'activeGroupId', 'selectedSprint', 'engMode', 'settingsOpen', 'settingsTab'])) return null;
    const view = value.view;
    if (!VIEW_IDS.has(view.selectedView) || !ENG_MODES.has(view.engMode) || !SETTINGS_TABS.has(view.settingsTab)
        || typeof view.settingsOpen !== 'boolean'
        || !(view.activeGroupId === '' || groupIdentity(view.activeGroupId))
        || !(view.selectedSprint === '' || boundedId(view.selectedSprint))) return null;
    const planning = value.planning;
    if (planning !== null) {
        if (!hasExactKeys(planning, ['scope', 'draft', 'submission', 'selectedTeams'])
            || !hasExactKeys(planning.scope, ['workspaceId', 'groupId', 'sprintId', 'namespaceId'])) return null;
        const { scope, draft, submission, selectedTeams } = planning;
        if (scope.workspaceId !== value.principal.workspaceId || !groupIdentity(scope.groupId) || !numericId(scope.sprintId)
            || scope.groupId !== view.activeGroupId || scope.sprintId !== view.selectedSprint
            || !(scope.namespaceId === null || boundedId(scope.namespaceId))
            || !denseArray(selectedTeams) || selectedTeams.length > 200 || !selectedTeams.every(boundedId)
            || new Set(selectedTeams).size !== selectedTeams.length
            || !hasExactKeys(draft, DRAFT_FIELDS) || bytes(draft) > AUTH_RESUME_DRAFT_MAX_BYTES
            || !validBases(draft) || !validChanges(draft, ['epic', 'story'], true)) return null;
        if (submission !== null) {
            if (!hasExactKeys(submission, ['payload', 'sequence']) || !Number.isSafeInteger(submission.sequence) || submission.sequence < 0) return null;
            const payload = submission.payload;
            if (!keysWithin(payload, ['version', 'groupId', 'operationId', ...DRAFT_FIELDS], ['configuration'])
                || payload.version !== 2 || payload.groupId !== scope.groupId || !operationId(payload.operationId)
                || bytes(payload) > AUTH_RESUME_DRAFT_MAX_BYTES || !validBases(payload)
                || !validChanges(payload, scope.namespaceId === null ? ['epic', 'story'] : ['initiative', 'epic'], false)
                || (payload.configuration !== undefined ? !validConfiguration(payload.configuration, scope.namespaceId) : scope.namespaceId !== null)) return null;
        }
    }
    return JSON.parse(JSON.stringify({ version: 2, capturedAt, principal: value.principal, view, planning }));
}

const normalizeSnapshot = (value, capturedAt, strict = false) => value?.version === 2
    ? normalizeSharedSnapshot(value, capturedAt, strict)
    : value?.version === undefined || value?.version === 1 ? normalizeLegacySnapshot(value, capturedAt, strict) : null;

// The outage capsule uses the same bounded Planning contract without copying its validator.
export function normalizeSharedPlanningRecovery(planning, principal) {
    if (planning === null) return null;
    try {
        const normalized = normalizeSharedSnapshot({
            version: 2, principal,
            view: { selectedView: 'eng', activeGroupId: planning?.scope?.groupId, selectedSprint: planning?.scope?.sprintId,
                engMode: 'planning', settingsOpen: false, settingsTab: 'teams' },
            planning,
        }, 0, false);
        return normalized ? normalized.planning : undefined;
    } catch (error) { return undefined; }
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
        if (new TextEncoder().encode(serialized).byteLength > (normalized.version === 1 ? LEGACY_MAX_BYTES : AUTH_RESUME_MAX_BYTES)) return false;
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
        if (![1, AUTH_RESUME_VERSION].includes(parsed?.version) || parsed.version === 1 && new TextEncoder().encode(raw).byteLength > LEGACY_MAX_BYTES
            || !validAge || !samePrincipal) throw new Error('invalid_auth_resume');
        // Historical keys lack a workspace/configuration stamp. Only shell and Team intent may resume.
        return parsed.version === 1 ? { ...normalized, planning: { scopeKey: '', selectedTaskKeys: [], selectedTeams: normalized.planning.selectedTeams, selectionMode: 'manual' } } : normalized;
    } catch (error) {
        clearAuthResumeState(storage);
        return null;
    }
}
