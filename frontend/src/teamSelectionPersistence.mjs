function toTrimmedString(value) {
    return String(value || '').trim();
}

function normalizeTeamIdList(value) {
    if (Array.isArray(value)) {
        const seen = new Set();
        const teamIds = [];
        value.forEach((item) => {
            const teamId = toTrimmedString(item) || 'all';
            if (seen.has(teamId)) return;
            seen.add(teamId);
            teamIds.push(teamId);
        });
        return teamIds.length ? teamIds : ['all'];
    }
    const teamId = toTrimmedString(value);
    return [teamId || 'all'];
}

function toSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    return new Set();
}

const TEAM_SELECTION_STORAGE_KEY = 'jira_dashboard_team_selection_state_v1';

export function buildTeamSelectionScopeKey({ sprintId, groupId } = {}) {
    return `team-selection::${toTrimmedString(sprintId)}::${toTrimmedString(groupId)}`;
}

function readScopeMap(storage) {
    if (!storage?.getItem) return {};
    try {
        const raw = storage.getItem(TEAM_SELECTION_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        return {};
    }
}

function writeScopeMap(storage, nextMap) {
    if (!storage?.setItem) return;
    try {
        storage.setItem(TEAM_SELECTION_STORAGE_KEY, JSON.stringify(nextMap || {}));
    } catch (err) {
        // Ignore storage failures in browser/private mode.
    }
}

function normalizeStoredTeamSelection(storedState) {
    return normalizeTeamIdList(storedState?.selectedTeams ?? storedState?.selectedTeamId ?? 'all');
}

export function loadTeamSelectionState(storage, scopeKey) {
    if (!scopeKey) return null;
    const scopeMap = readScopeMap(storage);
    const rawState = scopeMap[scopeKey];
    if (!rawState) return null;
    const selectedTeams = normalizeStoredTeamSelection(rawState);
    return {
        selectedTeams,
        selectedTeamId: selectedTeams[0] || 'all'
    };
}

export function saveTeamSelectionState(storage, scopeKey, state) {
    if (!scopeKey) return null;
    const scopeMap = readScopeMap(storage);
    const selectedTeams = normalizeStoredTeamSelection(state);
    scopeMap[scopeKey] = {
        selectedTeams,
        selectedTeamId: selectedTeams[0] || 'all'
    };
    writeScopeMap(storage, scopeMap);
    return scopeMap[scopeKey];
}

export function reconcileTeamSelectionState(storedState, {
    validTeamIds = new Set()
} = {}) {
    const normalized = normalizeStoredTeamSelection(storedState);
    const validTeamIdSet = toSet(validTeamIds);

    if (normalized.includes('all')) {
        return {
            selectedTeams: ['all'],
            selectedTeamId: 'all'
        };
    }

    const scopedTeams = normalized.filter((teamId) => validTeamIdSet.has(teamId));
    const nextSelectedTeams = scopedTeams.length ? scopedTeams : ['all'];
    return {
        selectedTeams: nextSelectedTeams,
        selectedTeamId: nextSelectedTeams[0] || 'all'
    };
}
