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

function toSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    return new Set();
}

export function buildPlanningScopeKey({ sprintId, groupId } = {}) {
    return `planning::${toTrimmedString(sprintId)}::${toTrimmedString(groupId)}`;
}

function normalizePlanningState(storedState) {
    return {
        selectedTaskKeys: normalizeKeyList(storedState?.selectedTaskKeys),
        selectedTeamId: normalizeTeamId(storedState?.selectedTeamId)
    };
}

export function reconcilePlanningSelection(
    storedState,
    {
        validTaskKeys = new Set(),
        validTeamIds = new Set()
    } = {}
) {
    const normalized = normalizePlanningState(storedState);
    const validTaskKeySet = toSet(validTaskKeys);
    const validTeamIdSet = toSet(validTeamIds);

    const selectedTaskKeys = normalized.selectedTaskKeys.filter((key) => validTaskKeySet.has(key));
    const selectedTeamId = normalized.selectedTeamId !== 'all' && validTeamIdSet.has(normalized.selectedTeamId)
        ? normalized.selectedTeamId
        : 'all';

    return {
        selectedTaskKeys,
        selectedTeamId
    };
}
