function normalizeSelectedTeams(value) {
    if (Array.isArray(value)) {
        return value.length ? value : ['all'];
    }
    if (typeof value === 'string' && value.trim()) {
        return [value];
    }
    return ['all'];
}

export function selectedTeamSelectionsEqual(left, right) {
    const normalizedLeft = normalizeSelectedTeams(left);
    const normalizedRight = normalizeSelectedTeams(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

export function sanitizeSelectedTeamsForScope(selectedTeams, {
    activeGroupTeamIds = [],
    availableTeamIds = []
} = {}) {
    const normalized = normalizeSelectedTeams(selectedTeams);
    const groupTeamSet = new Set((activeGroupTeamIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    const availableTeamSet = new Set((availableTeamIds || []).map((id) => String(id || '').trim()).filter(Boolean));

    if (!groupTeamSet.size) {
        return ['all'];
    }
    if (normalized.includes('all')) {
        return ['all'];
    }

    const scopedToGroup = normalized.filter((teamId) => groupTeamSet.has(teamId));
    if (!scopedToGroup.length) {
        return ['all'];
    }

    if (!availableTeamSet.size) {
        return ['all'];
    }

    const scopedToSprint = scopedToGroup.filter((teamId) => availableTeamSet.has(teamId));
    return scopedToSprint.length ? scopedToSprint : ['all'];
}
