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

export function getFuturePlanningEpicTeamInfo(epic, { selectedTeamSet, teamLabels = {}, resolveTeamName, fallbackSelectedTeamName = '', teamNameById } = {}) {
    return getFuturePlanningEpicTeamInfos(epic, {
        selectedTeamSet,
        teamLabels,
        resolveTeamName,
        fallbackSelectedTeamName,
        teamNameById
    })[0] || getRawEpicTeamInfo(epic);
}

export function getFuturePlanningEpicTeamInfos(epic, { selectedTeamSet, teamLabels = {}, resolveTeamName, fallbackSelectedTeamName = '', teamNameById } = {}) {
    const rawTeam = getRawEpicTeamInfo(epic);
    const matchedTeamIds = getMatchedPlanningTeamIds(epic, teamLabels);
    const selectedTeamId = getSingleSelectedTeamId(selectedTeamSet);
    const lookupTeamName = (teamId) => {
        const normalized = String(teamId || '').trim();
        if (!normalized) return '';
        if (teamNameById instanceof Map && teamNameById.has(normalized)) {
            return String(teamNameById.get(normalized) || '').trim();
        }
        if (teamNameById && typeof teamNameById === 'object' && teamNameById[normalized]) {
            return String(teamNameById[normalized] || '').trim();
        }
        if (typeof resolveTeamName === 'function') {
            return String(resolveTeamName(normalized) || '').trim();
        }
        return normalized;
    };

    if (selectedTeamId) {
        const selectedTeamName = lookupTeamName(selectedTeamId);
        return [{
            id: selectedTeamId,
            name: (selectedTeamName && selectedTeamName !== selectedTeamId)
                ? selectedTeamName
                : (fallbackSelectedTeamName || selectedTeamId)
        }];
    }

    const visibleMatchedTeamIds = selectedTeamSet instanceof Set && selectedTeamSet.size > 1
        ? matchedTeamIds.filter((teamId) => selectedTeamSet.has(teamId))
        : matchedTeamIds;
    if (visibleMatchedTeamIds.length) {
        return visibleMatchedTeamIds.map((matchedTeamId) => {
            const matchedTeamName = lookupTeamName(matchedTeamId);
            return {
                id: matchedTeamId,
                name: matchedTeamName || matchedTeamId
            };
        });
    }

    return [rawTeam];
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
    if (matchedTeamIds.length >= 1) {
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

// Semantic JQL for a Needs Stories team group: the team's open epics for the
// selected sprint (matched by sprint id or sprint-value label), rather than a
// frozen `key in (...)` list. Returns the bare JQL; callers wrap it in a Jira URL.
export function buildNeedsStoriesTeamJql({ teamLabel, selectedSprint, selectedSprintName } = {}) {
    const label = String(teamLabel || '').trim();
    if (!label) return '';
    const clauses = ['issuetype = Epic', `labels = "${label}"`];
    const sprintClauses = [];
    const sprintId = String(selectedSprint || '').trim();
    const sprintName = String(selectedSprintName || '').trim();
    if (sprintId) sprintClauses.push(`Sprint = ${sprintId}`);
    if (sprintName) sprintClauses.push(`labels = "${sprintName}"`);
    if (sprintClauses.length === 1) {
        clauses.push(sprintClauses[0]);
    } else if (sprintClauses.length > 1) {
        clauses.push(`(${sprintClauses.join(' OR ')})`);
    }
    clauses.push('status not in ("Done","Killed","Incomplete")');
    return clauses.join(' AND ');
}
