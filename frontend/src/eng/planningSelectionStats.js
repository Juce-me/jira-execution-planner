import { classifyCapacityIssue, projectClassOf } from '../capacityClassification.mjs';

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

// Upper-case bucket for a side; only DELIVERY (stamped 'none') work reaches NONE ("No Allocation").
const PROJECT_BUCKETS = { product: 'PRODUCT', tech: 'TECH', none: 'NONE' };

// The new model (`rnd_2027`) splits by the server's Allocation stamp into PRODUCT/TECH/NONE; Legacy keeps PRODUCT/TECH.
export function buildSelectedProjectStats(tasks, techProjectKeys, adHocEpicSet = new Set()) {
    const totals = tasks.reduce((acc, task) => {
        const { projectType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
        const bucket = PROJECT_BUCKETS[projectType];
        if (!acc[bucket]) {
            acc[bucket] = createStoryPointTotal();
        }
        addStoryPoints(acc[bucket], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, storyPointTotalValue(total)]));
}

// Ad Hoc story points per side bucket; Legacy Ad Hoc is always PRODUCT, DELIVERY Ad Hoc keeps its Allocation side.
export function buildSelectedAdHocStats(tasks, techProjectKeys, adHocEpicSet = new Set()) {
    const totals = tasks.reduce((acc, task) => {
        const { projectType, capacityType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
        if (capacityType !== 'ad_hoc') return acc;
        const bucket = PROJECT_BUCKETS[projectType];
        if (!acc[bucket]) acc[bucket] = createStoryPointTotal();
        addStoryPoints(acc[bucket], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, storyPointTotalValue(total)]));
}

export function buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys, adHocEpicSet = new Set()) {
    const totals = tasks.reduce((acc, task) => {
        const teamInfo = getTeamInfo(task);
        const { projectType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
        if (!acc[teamInfo.id]) {
            acc[teamInfo.id] = { product: createStoryPointTotal(), tech: createStoryPointTotal() };
        }
        if (!acc[teamInfo.id][projectType]) acc[teamInfo.id][projectType] = createStoryPointTotal(); // 'none' only in DELIVERY
        addStoryPoints(acc[teamInfo.id][projectType], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Object.fromEntries(
        Object.entries(value).map(([side, total]) => [side, storyPointTotalValue(total)]),
    )]));
}

export function buildExcludedProjectStats(tasks, excludedEpicSet, techProjectKeys, normalizeEpicKey) {
    const totals = tasks.reduce((acc, task) => {
        const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
        if (!excludedEpicSet.has(epicKey)) return acc;
        const projectKey = PROJECT_BUCKETS[projectClassOf(task, techProjectKeys)];
        if (!acc[projectKey]) {
            acc[projectKey] = createStoryPointTotal();
        }
        addStoryPoints(acc[projectKey], planningStoryPoints(task));
        return acc;
    }, {});
    return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, storyPointTotalValue(total)]));
}
