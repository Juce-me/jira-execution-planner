function planningStoryPoints(task) {
    const sp = parseFloat(task.fields.customfield_10004 || 0);
    return Number.isNaN(sp) ? 0 : sp;
}

export function buildSelectedPlanningTasksList(tasks, excludedEpicSet, normalizeEpicKey) {
    return tasks.filter(task => {
        const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
        return !excludedEpicSet.has(epicKey);
    });
}

export function sumPlanningStoryPoints(tasks) {
    return tasks.reduce((sum, task) => sum + planningStoryPoints(task), 0);
}

export function buildSelectedTeamStats(tasks, getTeamInfo) {
    return tasks.reduce((acc, task) => {
        const teamInfo = getTeamInfo(task);
        if (!acc[teamInfo.id]) {
            acc[teamInfo.id] = { name: teamInfo.name, storyPoints: 0 };
        }
        acc[teamInfo.id].storyPoints += planningStoryPoints(task);
        return acc;
    }, {});
}

export function buildSelectedProjectStats(tasks, techProjectKeys) {
    return tasks.reduce((acc, task) => {
        const pk = task.fields?.projectKey || task.key.split('-')[0];
        const bucket = techProjectKeys.has(pk) ? 'TECH' : 'PRODUCT';
        if (!acc[bucket]) {
            acc[bucket] = 0;
        }
        acc[bucket] += planningStoryPoints(task);
        return acc;
    }, {});
}

export function buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys) {
    return tasks.reduce((acc, task) => {
        const teamInfo = getTeamInfo(task);
        const pk = task.fields?.projectKey || task.key.split('-')[0];
        const bucket = techProjectKeys.has(pk) ? 'tech' : 'product';
        if (!acc[teamInfo.id]) {
            acc[teamInfo.id] = { product: 0, tech: 0 };
        }
        acc[teamInfo.id][bucket] += planningStoryPoints(task);
        return acc;
    }, {});
}

export function buildExcludedProjectStats(tasks, excludedEpicSet, techProjectKeys, normalizeEpicKey) {
    return tasks.reduce((acc, task) => {
        const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
        if (!excludedEpicSet.has(epicKey)) return acc;
        const pk = task.fields?.projectKey || task.key.split('-')[0];
        const projectKey = techProjectKeys.has(pk) ? 'TECH' : 'PRODUCT';
        if (!acc[projectKey]) {
            acc[projectKey] = 0;
        }
        acc[projectKey] += planningStoryPoints(task);
        return acc;
    }, {});
}
