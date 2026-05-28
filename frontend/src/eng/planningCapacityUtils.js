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
