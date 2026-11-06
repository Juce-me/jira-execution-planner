import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { isCombinedWorkModel } from './engWorkModel.js';

function planningStoryPoints(task) {
    const sp = parseFloat(task.fields.customfield_10004 || 0);
    return Number.isNaN(sp) ? 0 : sp;
}

// Story Points carry up to two decimals, so totals accumulate integer hundredths and never drift (0.07 + 0.14 = 0.21).
function createStoryPointTotal() {
    return { sum: 0, hundredths: 0, allHundredths: true };
}

function addStoryPoints(total, value) {
    total.sum += value;
    const scaled = Math.round(value * 100);
    if (Math.abs(value * 100 - scaled) < 1e-6) total.hundredths += scaled;
    else total.allHundredths = false;
}

function storyPointTotalValue(total) {
    return total.allHundredths ? total.hundredths / 100 : total.sum;
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

// Team totals use the complete authorized projection; display facets only partition shown/hidden work.
export function buildPlanningSelectionSummary({ tasks, shownTasks, selectedTasks, selectedTeamIds, allTeams, getTeamInfo }) {
    const seen = new Set(), shownIds = new Set(shownTasks.map(task => String(task.id || '')));
    const selected = tasks.filter(task => {
        const id = String(task.id || '');
        if (!/^[1-9][0-9]*$/.test(id) || seen.has(id) || !selectedTasks[task.key]) return false;
        if (!allTeams && !selectedTeamIds.has(getTeamInfo(task).id)) return false;
        seen.add(id);
        return true;
    });
    const shown = selected.filter(task => shownIds.has(String(task.id)));
    const hidden = selected.filter(task => !shownIds.has(String(task.id)));
    const missingEstimateCount = selected.filter(task => task.fields.customfield_10004 == null || task.fields.customfield_10004 === '' || !Number.isFinite(parseFloat(task.fields.customfield_10004))).length;
    return { selectedTasks: selected, count: selected.length, sp: sumPlanningStoryPoints(selected), missingEstimateCount,
        shownCount: shown.length, shownSP: sumPlanningStoryPoints(shown), hiddenCount: hidden.length, hiddenSP: sumPlanningStoryPoints(hidden) };
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
