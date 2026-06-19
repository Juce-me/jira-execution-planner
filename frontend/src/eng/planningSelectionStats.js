import { classifyCapacityIssue } from '../capacityClassification.mjs';

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

export function buildSelectedProjectStats(tasks, techProjectKeys, adHocEpicSet = new Set()) {
    return tasks.reduce((acc, task) => {
        const { projectType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
        const bucket = projectType === 'tech' ? 'TECH' : 'PRODUCT';
        if (!acc[bucket]) {
            acc[bucket] = 0;
        }
        acc[bucket] += planningStoryPoints(task);
        return acc;
    }, {});
}

export function buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys, adHocEpicSet = new Set()) {
    return tasks.reduce((acc, task) => {
        const teamInfo = getTeamInfo(task);
        const { projectType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
        const bucket = projectType === 'tech' ? 'tech' : 'product';
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
        const pk = String(task.fields?.projectKey || task.key.split('-')[0]).toUpperCase();
        const projectKey = techProjectKeys.has(pk) ? 'TECH' : 'PRODUCT';
        if (!acc[projectKey]) {
            acc[projectKey] = 0;
        }
        acc[projectKey] += planningStoryPoints(task);
        return acc;
    }, {});
}
