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

export function buildTeamOptionsForScope({
    capacityTasks = [],
    activeGroupTeamIds = [],
    teamNameLookup = {},
    getTeamInfo = () => ({})
} = {}) {
    const allTeams = { id: 'all', name: 'All Teams' };
    const configuredTeamIds = [];
    const configuredSeen = new Set();

    (activeGroupTeamIds || []).forEach((value) => {
        const id = String(value || '').trim();
        if (!id || configuredSeen.has(id)) return;
        configuredSeen.add(id);
        configuredTeamIds.push(id);
    });

    if (configuredTeamIds.length) {
        // Configured team IDs are authoritative for availability; display names come from the
        // team catalog lookup (teamNameById/teamCatalog), NOT group teamLabels (those are Jira
        // epic labels). Task-derived names are the fallback so names still render before the
        // catalog loads; the raw id is the last resort.
        const taskNames = {};
        (capacityTasks || []).forEach((task) => {
            const team = getTeamInfo(task) || {};
            const id = String(team.id || '').trim();
            if (!id || Object.prototype.hasOwnProperty.call(taskNames, id)) return;
            const name = String(team.name || '').trim();
            if (name) {
                taskNames[id] = name;
            }
        });
        return [
            allTeams,
            ...configuredTeamIds.map(id => ({
                id,
                name: String(teamNameLookup?.[id] || taskNames[id] || id).trim() || id
            }))
        ];
    }

    const taskTeams = [];
    const taskSeen = new Set();
    (capacityTasks || []).forEach((task) => {
        const team = getTeamInfo(task) || {};
        const id = String(team.id || 'unknown').trim() || 'unknown';
        if (taskSeen.has(id)) return;
        taskSeen.add(id);
        taskTeams.push({ id, name: String(team.name || id).trim() || id });
    });
    return [allTeams, ...taskTeams];
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
