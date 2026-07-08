import { classifyCapacityIssue } from '../capacityClassification.mjs';

export function getCapacityStatus(selected, capacity) {
    if (!capacity) {
        return { label: '', text: '', status: '', title: '' };
    }
    const ratio = capacity > 0 ? selected / capacity : 0;
    const overPercent = Math.max(0, (ratio - 1) * 100);
    const underPercent = Math.max(0, (1 - ratio) * 100);
    const status = ratio > 1.2 ? 'over' : ratio < 0.9 ? 'under' : '';
    const suffix = ratio >= 1
        ? `${overPercent.toFixed(0)}% over`
        : `${underPercent.toFixed(0)}% under`;
    const shortLabel = ratio >= 1
        ? `${overPercent.toFixed(0)}% over`
        : `${underPercent.toFixed(0)}% under`;
    const minToRemove = ratio > 1.2 ? (ratio - 1.2) * capacity : 0;
    const minToAdd = ratio < 0.9 ? (0.9 - ratio) * capacity : 0;
    const title = ratio > 1.2
        ? `Please remove at least ${minToRemove.toFixed(1)} SP to reach 120%.`
        : ratio < 0.9
            ? `Please add at least ${minToAdd.toFixed(1)} SP to reach 90%.`
            : '';
    return {
        label: shortLabel,
        text: `${selected.toFixed(1)} selected | ${capacity.toFixed(1)} capacity | ${suffix}`,
        status,
        title
    };
}

// Layout math for the planning capacity bar. Kept as a pure function so the
// fill/marker geometry is unit-testable independently of the React render.
//
// The fill must never cross the Team Cap marker: whenever selected work exceeds
// capacity the fill is clipped at the cap (`fillPct === teamCapPct`) and the
// overshoot is shown as the variance zone. `isOver` is therefore the plain
// selected-vs-capacity comparison, NOT the ±20% warning threshold from
// getCapacityStatus — driving geometry off the warning threshold left a 0–20%
// overflow rendering the fill past the cap line with no overflow indicator.
export function computeCapacityBarLayout({
    totalCapacityAdjusted,
    estimatedCapacityAdjusted,
    selectedSP,
    capacityStatus,
}) {
    const scale = Math.max(totalCapacityAdjusted, selectedSP) * 1.15;
    const toPct = (v) => (scale > 0 ? Math.min(100, (v / scale) * 100) : 0);
    const selectedPct = toPct(selectedSP);
    const planningPct = toPct(estimatedCapacityAdjusted);
    const teamCapPct = toPct(totalCapacityAdjusted);
    const isOver = selectedSP > totalCapacityAdjusted;
    const isUnder = capacityStatus === 'under';
    const varianceOverPct = isOver ? selectedPct - teamCapPct : 0;
    const fillPct = isOver ? teamCapPct : selectedPct;
    const showPlanningMarker = Math.abs(estimatedCapacityAdjusted - totalCapacityAdjusted) > 0.05;
    return { scale, selectedPct, planningPct, teamCapPct, isOver, isUnder, varianceOverPct, fillPct, showPlanningMarker };
}

export function getTeamCapacityMeta(selected, capacity) {
    if (!capacity) return { text: '', status: '', title: '' };
    const delta = selected - capacity;
    if (delta <= 0) {
        return {
            text: `${Math.abs(delta).toFixed(1)} SP left`,
            status: '',
            title: ''
        };
    }
    const pct = capacity > 0 ? (delta / capacity) * 100 : 0;
    const status = pct >= 20 ? 'over' : '';
    return {
        text: `↑ ${delta.toFixed(1)} SP · ${pct.toFixed(0)}%`,
        status,
        title: 'Please remove some story points or add capacity.'
    };
}

export function buildCapacityTotalsSummary({
    capacityEnabled,
    displayedTeamOptions,
    getTeamCapacity,
    excludedCapacityByTeamId,
    capacityMultiplier
}) {
    const totalCapacityBase = capacityEnabled
        ? displayedTeamOptions.reduce((sum, team) => sum + getTeamCapacity(team.name), 0)
        : 0;
    const excludedCapacityTotal = capacityEnabled
        ? displayedTeamOptions.reduce((sum, team) => sum + (excludedCapacityByTeamId[team.id] || 0), 0)
        : 0;
    const estimatedCapacityRaw = Math.max(0, totalCapacityBase - excludedCapacityTotal);
    return {
        totalCapacityBase,
        excludedCapacityTotal,
        estimatedCapacityRaw,
        totalCapacityAdjusted: totalCapacityBase * capacityMultiplier,
        estimatedCapacityAdjusted: estimatedCapacityRaw * capacityMultiplier,
        excludedCapacityAdjusted: excludedCapacityTotal * capacityMultiplier
    };
}

export function buildProjectCapacity({
    showPlanning,
    capacityEnabled,
    displayedTeamOptions,
    selectedTeamProjectStats,
    getTeamNetCapacity,
    capacitySplit,
    showProduct,
    showTech
}) {
    if (!showPlanning || !capacityEnabled) {
        return { PRODUCT: 0, TECH: 0 };
    }
    const totals = displayedTeamOptions.reduce((acc, team) => {
        const teamPlanningCapacity = getTeamNetCapacity(team);
        if (!teamPlanningCapacity) return acc;
        const stats = selectedTeamProjectStats[team.id] || { product: 0, tech: 0 };
        const totalSelected = stats.product + stats.tech;
        const techHeavy = totalSelected > 0 ? stats.tech >= stats.product : false;
        const split = techHeavy ? { product: 0.2, tech: 0.8 } : capacitySplit;
        acc.PRODUCT += teamPlanningCapacity * split.product;
        acc.TECH += teamPlanningCapacity * split.tech;
        return acc;
    }, {
        PRODUCT: 0,
        TECH: 0
    });
    if (!showProduct) totals.PRODUCT = 0;
    if (!showTech) totals.TECH = 0;
    return totals;
}

function emptyCapacityBreakdown() {
    return { todoPending: 0, accepted: 0, postponed: 0 };
}

function emptyCapacityTotals() {
    return {
        product: emptyCapacityBreakdown(),
        tech: emptyCapacityBreakdown(),
        total: emptyCapacityBreakdown()
    };
}

export function buildTeamCapacityStats({
    showPlanning,
    capacityEnabled,
    capacityTasks,
    normalizeStatus,
    getTeamInfo,
    techProjectKeys,
    adHocEpicSet = new Set()
}) {
    if (!showPlanning || !capacityEnabled) return {};
    return capacityTasks.reduce((acc, task) => {
        const status = normalizeStatus(task.fields.status?.name);
        const sp = parseFloat(task.fields.customfield_10004 || 0);
        if (!sp) {
            return acc;
        }

        const teamInfo = getTeamInfo(task);
        if (!acc[teamInfo.id]) {
            acc[teamInfo.id] = {
                name: teamInfo.name,
                product: emptyCapacityBreakdown(),
                tech: emptyCapacityBreakdown()
            };
        }

        const bucket = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet }).projectType === 'tech' ? 'tech' : 'product';
        if (status === 'to do' || status === 'pending') {
            acc[teamInfo.id][bucket].todoPending += sp;
        }
        if (status === 'accepted') {
            acc[teamInfo.id][bucket].accepted += sp;
        }
        if (status === 'postponed') {
            acc[teamInfo.id][bucket].postponed += sp;
        }

        return acc;
    }, {});
}

export function buildTeamCapacityEntries(teamCapacityStats) {
    return Object.entries(teamCapacityStats)
        .map(([id, info]) => ({
            id,
            name: info.name,
            product: info.product,
            tech: info.tech,
            total: {
                todoPending: info.product.todoPending + info.tech.todoPending,
                accepted: info.product.accepted + info.tech.accepted,
                postponed: info.product.postponed + info.tech.postponed
            }
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildTeamSpTotals(capacityTasks, getTeamInfo) {
    const totals = {};
    for (const task of capacityTasks) {
        const sp = parseFloat(task.fields?.customfield_10004 || 0);
        if (!sp) continue;
        const tid = getTeamInfo(task).id;
        totals[tid] = (totals[tid] || 0) + sp;
    }
    return totals;
}

export function buildDisplayedTeamOptions({
    teamOptions,
    isAllTeamsSelected,
    selectedTeamSet,
    teamSpTotals
}) {
    const base = !isAllTeamsSelected
        ? teamOptions.filter(team => team.id !== 'all' && selectedTeamSet.has(team.id))
        : teamOptions.filter(team => team.id !== 'all');
    return base.filter(team => (teamSpTotals[team.id] || 0) > 0);
}

export function buildExcludedCapacityByTeamId({
    capacityEnabled,
    showPlanning,
    capacityTasks,
    excludedEpicSet,
    normalizeEpicKey,
    getTeamInfo
}) {
    if (!capacityEnabled || !showPlanning) return {};
    return capacityTasks.reduce((acc, task) => {
        const epicKey = normalizeEpicKey(task.fields?.epicKey || 'NO_EPIC');
        if (!excludedEpicSet.has(epicKey)) return acc;
        const teamInfo = getTeamInfo(task);
        const sp = parseFloat(task.fields.customfield_10004 || 0);
        if (Number.isNaN(sp)) return acc;
        acc[teamInfo.id] = (acc[teamInfo.id] || 0) + sp;
        return acc;
    }, {});
}

export function buildSelectedProjectEntries({
    showPlanning,
    selectedProjectStats,
    capacityEnabled,
    projectCapacity
}) {
    if (!showPlanning) return [];
    return Object.entries(selectedProjectStats)
        .map(([id, storyPoints]) => ({
            id,
            name: id,
            storyPoints,
            capacity: capacityEnabled ? (projectCapacity[id] || 0) : null
        }))
        .sort((a, b) => {
            const order = (key) => {
                if (key === 'PRODUCT') return 0;
                if (key === 'TECH') return 1;
                return 99;
            };
            const diff = order(a.id) - order(b.id);
            if (diff !== 0) return diff;
            return a.name.localeCompare(b.name);
        });
}

export function buildSelectedTeamEntries({
    showPlanning,
    displayedTeamOptions,
    selectedTeamStats,
    capacityEnabled,
    getTeamCapacity,
    getTeamNetCapacity,
    capacityMultiplier
}) {
    if (!showPlanning) return [];
    return displayedTeamOptions.map((team) => ({
        id: team.id,
        name: team.name,
        storyPoints: selectedTeamStats[team.id]?.storyPoints || 0,
        teamCapacity: capacityEnabled ? getTeamCapacity(team.name) * capacityMultiplier : null,
        planningCapacity: capacityEnabled ? getTeamNetCapacity(team) * capacityMultiplier : null
    }));
}

export function buildCapacityTotals({
    showPlanning,
    capacityEnabled,
    displayedTeamCapacityEntries
}) {
    if (!showPlanning || !capacityEnabled) {
        return emptyCapacityTotals();
    }
    return displayedTeamCapacityEntries.reduce((acc, info) => {
        acc.product.todoPending += info.product.todoPending;
        acc.product.accepted += info.product.accepted;
        acc.product.postponed += info.product.postponed;
        acc.tech.todoPending += info.tech.todoPending;
        acc.tech.accepted += info.tech.accepted;
        acc.tech.postponed += info.tech.postponed;
        acc.total.todoPending += info.total.todoPending;
        acc.total.accepted += info.total.accepted;
        acc.total.postponed += info.total.postponed;
        return acc;
    }, emptyCapacityTotals());
}
