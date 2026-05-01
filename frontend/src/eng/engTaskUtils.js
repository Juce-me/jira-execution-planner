export const PRIORITY_ORDER = {
    'Blocker': 0,
    'Highest': 1,
    'Critical': 2,
    'High': 3,
    'Major': 4,
    'Medium': 5,
    'Minor': 6,
    'Low': 7,
    'Trivial': 8,
    'Lowest': 9
};

export function getTaskTeamInfo(task) {
    const team = task.fields?.team;
    const teamName = task.fields?.teamName || team?.name || team?.displayName || team?.teamName || 'Unknown Team';
    const teamId = task.fields?.teamId || team?.id || team?.teamId || team?.key || teamName;
    return { id: teamId, name: teamName };
}

export function getEpicTeamInfo(epic) {
    const teamName = epic?.teamName || epic?.team?.name || epic?.team?.displayName || 'Unknown Team';
    const teamId = epic?.teamId || epic?.team?.id || teamName;
    return { id: teamId, name: teamName };
}

export function groupTasksByTeam(tasks) {
    const groups = new Map();
    (tasks || []).forEach(task => {
        const teamName = getTaskTeamInfo(task).name;
        const items = groups.get(teamName) || [];
        items.push(task);
        groups.set(teamName, items);
    });
    return Array.from(groups.entries()).map(([teamName, items]) => ({ teamName, items }));
}

export function sortTasksByPriority(tasks, priorityOrder = PRIORITY_ORDER) {
    return (tasks || []).sort((a, b) => {
        const priorityA = priorityOrder[a.fields.priority?.name] || 999;
        const priorityB = priorityOrder[b.fields.priority?.name] || 999;
        return priorityA - priorityB;
    });
}

export function filterTasksForTeamSet(tasks, activeGroupTeamIds, activeGroupTeamSet) {
    if (!activeGroupTeamIds.length) return [];
    return (tasks || []).filter(task => activeGroupTeamSet.has(getTaskTeamInfo(task).id));
}

export function filterEpicsInScopeForTeamSet(epicsInScope, activeGroupTeamIds, activeGroupTeamSet) {
    return activeGroupTeamIds.length
        ? (epicsInScope || []).filter(epic => !epic?.teamId || activeGroupTeamSet.has(epic.teamId))
        : [];
}

export function filterEpicsByTaskEpicKeys(epics, tasks) {
    const epicKeys = new Set(
        (tasks || [])
            .map(task => task.fields?.epicKey)
            .filter(Boolean)
    );
    const filteredEpics = {};
    Object.entries(epics || {}).forEach(([key, epic]) => {
        if (epicKeys.has(key)) {
            filteredEpics[key] = epic;
        }
    });
    return filteredEpics;
}
