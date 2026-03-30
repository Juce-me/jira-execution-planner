function toTrimmedString(value) {
    return String(value || '').trim();
}

function normalizeKeyList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const keys = [];
    value.forEach((item) => {
        const key = toTrimmedString(item);
        if (!key || seen.has(key)) return;
        seen.add(key);
        keys.push(key);
    });
    return keys;
}

function normalizeTeamId(value) {
    const teamId = toTrimmedString(value);
    return teamId || 'all';
}

function normalizeTeamIdList(value) {
    if (Array.isArray(value)) {
        const seen = new Set();
        const teamIds = [];
        value.forEach((item) => {
            const teamId = normalizeTeamId(item);
            if (!teamId || seen.has(teamId)) return;
            seen.add(teamId);
            teamIds.push(teamId);
        });
        return teamIds.length ? teamIds : ['all'];
    }
    return [normalizeTeamId(value)];
}

function toSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    return new Set();
}

const PLANNING_STORAGE_KEY = 'jira_dashboard_planning_state_v1';

export function buildPlanningScopeKey({ sprintId, groupId } = {}) {
    return `planning::${toTrimmedString(sprintId)}::${toTrimmedString(groupId)}`;
}

function normalizePlanningState(storedState) {
    const selectedTeams = normalizeTeamIdList(storedState?.selectedTeams ?? storedState?.selectedTeamId ?? 'all');
    return {
        selectedTaskKeys: normalizeKeyList(storedState?.selectedTaskKeys),
        selectedTeams,
        selectedTeamId: selectedTeams.length === 1 ? selectedTeams[0] : selectedTeams[0] || 'all'
    };
}

function readPlanningScopeMap(storage) {
    if (!storage?.getItem) return {};
    try {
        const raw = storage.getItem(PLANNING_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        return {};
    }
}

function writePlanningScopeMap(storage, nextMap) {
    if (!storage?.setItem) return;
    try {
        storage.setItem(PLANNING_STORAGE_KEY, JSON.stringify(nextMap || {}));
    } catch (err) {
        // ignore storage failures
    }
}

function normalizeStoredScopeState(storedState) {
    const normalized = normalizePlanningState(storedState);
    return {
        selectedTaskKeys: normalized.selectedTaskKeys,
        selectedTeams: normalized.selectedTeams,
        selectedTeamId: normalized.selectedTeamId
    };
}

function normalizeReconciledPlanningState(storedState, {
    validTaskKeys = new Set(),
    validTeamIds = new Set()
} = {}) {
    const normalized = normalizePlanningState(storedState);
    const validTaskKeySet = toSet(validTaskKeys);
    const validTeamIdSet = toSet(validTeamIds);

    const selectedTaskKeys = normalized.selectedTaskKeys.filter((key) => validTaskKeySet.has(key));
    const selectedTeams = normalized.selectedTeams.filter((teamId) => teamId === 'all' || validTeamIdSet.has(teamId));
    const nextSelectedTeams = selectedTeams.length ? selectedTeams : ['all'];
    const selectedTeamId = nextSelectedTeams.length === 1 ? nextSelectedTeams[0] : nextSelectedTeams[0] || 'all';

    return {
        selectedTaskKeys,
        selectedTeams: nextSelectedTeams,
        selectedTeamId
    };
}

export function loadPlanningState(storage, scopeKey) {
    const stateMap = readPlanningScopeMap(storage);
    const rawState = scopeKey ? stateMap[scopeKey] : null;
    if (!rawState) return null;
    return normalizeStoredScopeState(rawState);
}

export function hasPlanningState(storage, scopeKey) {
    if (!scopeKey) return false;
    const stateMap = readPlanningScopeMap(storage);
    return Object.prototype.hasOwnProperty.call(stateMap, scopeKey);
}

export function savePlanningState(storage, scopeKey, state) {
    if (!scopeKey) return null;
    const stateMap = readPlanningScopeMap(storage);
    stateMap[scopeKey] = normalizeStoredScopeState(state);
    writePlanningScopeMap(storage, stateMap);
    return stateMap[scopeKey];
}

export function resolvePlanningTeamSelection({
    scopedState,
    liveSelectedTeams,
    savedPrefsSelectedTeams,
    savedPrefsSelectedTeam
} = {}) {
    if (scopedState) {
        return normalizeTeamIdList(scopedState?.selectedTeams ?? scopedState?.selectedTeamId ?? 'all');
    }
    if (typeof liveSelectedTeams !== 'undefined' && liveSelectedTeams !== null) {
        return normalizeTeamIdList(liveSelectedTeams);
    }
    return normalizeTeamIdList(savedPrefsSelectedTeams ?? savedPrefsSelectedTeam ?? 'all');
}

export function reconcilePlanningSelection(
    storedState,
    {
        validTaskKeys = new Set(),
        validTeamIds = new Set()
    } = {}
) {
    return normalizeReconciledPlanningState(storedState, {
        validTaskKeys,
        validTeamIds
    });
}

export function hydratePlanningState({
    storedState,
    sprintId,
    groupId,
    validTaskKeys,
    validTeamIds
} = {}) {
    return reconcilePlanningSelection(
        {
            ...normalizePlanningState(storedState),
            sprintId: toTrimmedString(sprintId),
            groupId: toTrimmedString(groupId)
        },
        {
            validTaskKeys,
            validTeamIds
        }
    );
}
