import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { isCombinedWorkModel } from './engWorkModel.js';

function planningStoryPoints(task) {
    const sp = parseFloat(task.fields.customfield_10004 || 0);
    return Number.isNaN(sp) ? 0 : sp;
}

function createStoryPointTotal() {
    return { sum: 0, tenths: 0, allTenths: true };
}

function addStoryPoints(total, value) {
    total.sum += value;
    const scaled = value * 10;
    if (Number.isInteger(scaled)) total.tenths += scaled;
    else total.allTenths = false;
}

function storyPointTotalValue(total) {
    return total.allTenths ? total.tenths / 10 : total.sum;
}

export function buildSelectedPlanningTasksList(tasks, excludedEpicSet, normalizeEpicKey) {
    return tasks.filter(task => {
        const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
        return !excludedEpicSet.has(epicKey);
    });
}

export function sumPlanningStoryPoints(tasks) {
    const total = createStoryPointTotal();
    tasks.forEach(task => addStoryPoints(total, planningStoryPoints(task)));
    return storyPointTotalValue(total);
}

export function buildSelectedTeamStats(tasks, getTeamInfo) {
    const totals = tasks.reduce((acc, task) => {
        const teamInfo = getTeamInfo(task);
        if (!acc[teamInfo.id]) {
            acc[teamInfo.id] = { name: teamInfo.name, total: createStoryPointTotal() };
        }
        addStoryPoints(acc[teamInfo.id].total, planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [
        key, { name: value.name, storyPoints: storyPointTotalValue(value.total) },
    ]));
}

// The combined model (`rnd_2027`) has one lane: its allocation bucket is `OTHER`, never Product/Tech.
export function buildSelectedProjectStats(tasks, techProjectKeys, adHocEpicSet = new Set(), workModel) {
    const totals = tasks.reduce((acc, task) => {
        const { projectType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet, workModel });
        const bucket = projectType === 'tech' ? 'TECH' : projectType === 'other' ? 'OTHER' : 'PRODUCT';
        if (!acc[bucket]) {
            acc[bucket] = createStoryPointTotal();
        }
        addStoryPoints(acc[bucket], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, storyPointTotalValue(total)]));
}

export function buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys, adHocEpicSet = new Set(), workModel) {
    const combined = isCombinedWorkModel(workModel);
    const totals = tasks.reduce((acc, task) => {
        const teamInfo = getTeamInfo(task);
        const { projectType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet, workModel });
        const bucket = projectType === 'tech' ? 'tech' : projectType === 'other' ? 'other' : 'product';
        if (!acc[teamInfo.id]) {
            acc[teamInfo.id] = { product: createStoryPointTotal(), tech: createStoryPointTotal(), other: createStoryPointTotal() };
        }
        addStoryPoints(acc[teamInfo.id][bucket], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, {
        product: storyPointTotalValue(value.product), tech: storyPointTotalValue(value.tech),
        ...(combined ? { other: storyPointTotalValue(value.other) } : {}),
    }]));
}

export function buildExcludedProjectStats(tasks, excludedEpicSet, techProjectKeys, normalizeEpicKey, workModel) {
    const totals = tasks.reduce((acc, task) => {
        const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
        if (!excludedEpicSet.has(epicKey)) return acc;
        const pk = String(task.fields?.projectKey || task.key.split('-')[0]).toUpperCase();
        const projectKey = isCombinedWorkModel(workModel) ? 'OTHER' : techProjectKeys.has(pk) ? 'TECH' : 'PRODUCT';
        if (!acc[projectKey]) {
            acc[projectKey] = createStoryPointTotal();
        }
        addStoryPoints(acc[projectKey], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, storyPointTotalValue(total)]));
}
