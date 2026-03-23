function normalizeLabel(value) {
    return String(value || '').trim().toLowerCase();
}

function getEpicLabels(epic) {
    return new Set((epic?.labels || []).map((label) => normalizeLabel(label)).filter(Boolean));
}

function getSingleSelectedTeamId(selectedTeamSet) {
    if (!(selectedTeamSet instanceof Set) || selectedTeamSet.size !== 1) return '';
    return String(Array.from(selectedTeamSet)[0] || '').trim();
}

function getRawEpicTeamInfo(epic) {
    const teamName = epic?.teamName || epic?.team?.name || epic?.team?.displayName || 'Unknown Team';
    const teamId = epic?.teamId || epic?.team?.id || teamName;
    return { id: teamId, name: teamName };
}

function getMatchedPlanningTeamIds(epic, teamLabels) {
    const labels = getEpicLabels(epic);
    if (!labels.size) return [];

    return Object.entries(teamLabels || {})
        .filter(([teamId, label]) => teamId && labels.has(normalizeLabel(label)))
        .map(([teamId]) => String(teamId).trim())
        .filter(Boolean);
}

export function getFuturePlanningEpicTeamInfo(epic, { selectedTeamSet, teamLabels = {}, resolveTeamName, fallbackSelectedTeamName = '' } = {}) {
    const rawTeam = getRawEpicTeamInfo(epic);
    const matchedTeamIds = getMatchedPlanningTeamIds(epic, teamLabels);
    const selectedTeamId = getSingleSelectedTeamId(selectedTeamSet);

    if (selectedTeamId) {
        const selectedTeamName = typeof resolveTeamName === 'function'
            ? resolveTeamName(selectedTeamId)
            : selectedTeamId;
        return {
            id: selectedTeamId,
            name: (selectedTeamName && selectedTeamName !== selectedTeamId)
                ? selectedTeamName
                : (fallbackSelectedTeamName || selectedTeamId)
        };
    }

    if (rawTeam.id && matchedTeamIds.includes(rawTeam.id)) {
        return rawTeam;
    }

    if (matchedTeamIds.length === 1) {
        const matchedTeamId = matchedTeamIds[0];
        const matchedTeamName = typeof resolveTeamName === 'function'
            ? resolveTeamName(matchedTeamId)
            : matchedTeamId;
        return {
            id: matchedTeamId,
            name: matchedTeamName || matchedTeamId
        };
    }

    return rawTeam;
}

export function getFuturePlanningExpectedTeamLabel(epic, {
    selectedTeamSet,
    teamLabels = {}
} = {}) {
    const selectedTeamId = getSingleSelectedTeamId(selectedTeamSet);
    if (selectedTeamId) {
        return String(teamLabels[selectedTeamId] || '').trim();
    }

    const rawTeam = getRawEpicTeamInfo(epic);
    if (rawTeam.id && teamLabels[rawTeam.id]) {
        return String(teamLabels[rawTeam.id] || '').trim();
    }

    const matchedTeamIds = getMatchedPlanningTeamIds(epic, teamLabels);
    if (matchedTeamIds.length === 1) {
        return String(teamLabels[matchedTeamIds[0]] || '').trim();
    }

    return '';
}

export function epicMatchesFuturePlanningTeamSelection(epic, {
    isAllTeamsSelected = false,
    selectedTeamSet,
    teamLabels = {}
} = {}) {
    if (isAllTeamsSelected) return true;
    if (!(selectedTeamSet instanceof Set) || !selectedTeamSet.size) return false;

    const rawTeam = getRawEpicTeamInfo(epic);
    if (rawTeam.id && selectedTeamSet.has(rawTeam.id)) {
        return true;
    }

    return getMatchedPlanningTeamIds(epic, teamLabels).some((teamId) => selectedTeamSet.has(teamId));
}
